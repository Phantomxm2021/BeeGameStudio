import {providerConfig} from '../model-providers/config'
import type { ProviderHttpErrorDiagnostics } from '../model-providers/http-error'
import { withBgsAccountUse } from '../bgs/account-activity'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  resolveApprovedOutboundTarget,
  type ApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import type { RuntimeModelConfig } from '@bee-game-studio/agent-workflow'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'

export type BeeGameModelContent =
  | string
  | Array<
    | { type: 'text'; text: string }
    | {
      type: 'image'
      source: {
        type: 'base64'
        media_type: 'image/png' | 'image/jpeg' | 'image/webp'
        data: string
      }
    }
  >

export type BeeGameModelMessage = {
  role: 'user' | 'assistant'
  content: BeeGameModelContent
}

export type BeeGameModelGenerateInput = {
  cwd: string
  /** Durable model provider bound to this request; it must beat local settings. */
  modelType?: RuntimeModelConfig['modelType']
  runtimeEnv: Record<string, string>
  systemPrompt: string
  messages: BeeGameModelMessage[]
  structuredOutput?: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }
  maxTokens?: number
  temperature?: number
  querySource: string
}

export type BeeGameModelUsage = {
  /** Supplier receipt is a known lower bound, possibly with no reported tokens. */
  incomplete?: true
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

export type BeeGameModelGeneration = {
  content: string
  usage?: BeeGameModelUsage
}

export type BeeGameModelRuntimeFailureStage =
  | 'model_request'
  | 'model_response'

export type BeeGameModelRuntimeFailureCode = 'request-failed' | 'request-timeout' | 'upstream-http-error' | 'network-error' | 'invalid-json' | 'structured-output-missing' | 'max-output-tokens' | 'content-filter' | 'incomplete-response' | 'worker-exited'

export class BeeGameModelRuntimeError extends Error {
  readonly usage?: BeeGameModelUsage
  readonly failureCode?: BeeGameModelRuntimeFailureCode
  readonly diagnosticId?: string
  readonly httpStatus?: number
  readonly networkCode?: string
  readonly providerDiagnostics?: Readonly<ProviderHttpErrorDiagnostics>
  constructor(
    message: string,
    readonly stage: BeeGameModelRuntimeFailureStage,
    options?: { cause?: unknown; usage?: BeeGameModelUsage; failureCode?: BeeGameModelRuntimeFailureCode; diagnosticId?: string; httpStatus?: number; networkCode?: string; providerDiagnostics?: Readonly<ProviderHttpErrorDiagnostics> },
  ) {
    super(message, options)
    this.name = 'BeeGameModelRuntimeError'
    this.usage = options?.usage
    this.failureCode = options?.failureCode
    this.diagnosticId = options?.diagnosticId
    this.httpStatus = options?.httpStatus
    this.networkCode = options?.networkCode
    this.providerDiagnostics = options?.providerDiagnostics
  }
}

export type BeeGameModelRuntimeHost = {
  generate(input: BeeGameModelGenerateInput): Promise<string>
  generateWithUsage?: (
    input: BeeGameModelGenerateInput,
  ) => Promise<BeeGameModelGeneration>
}

type SerializedApprovedTarget = {
  url: string
  addresses: string[]
  trustedDevelopmentProxy?: true
}

export type ModelRuntimeWorkerRequest = {
  type: 'model.generate'
  requestId: string
  input: Omit<BeeGameModelGenerateInput, 'runtimeEnv'> & {
    runtimeEnv: Record<string, string>
    approvedOutboundTargets: Record<string, SerializedApprovedTarget>
  }
}

export type ModelRuntimeWorkerResponse =
  | {
      type: 'model.result'
      requestId: string
      content: string
      usage?: BeeGameModelUsage
    }
  | {
      type: 'model.error'
      requestId: string
      usage?: BeeGameModelUsage
      message: string
      stage: BeeGameModelRuntimeFailureStage
      failureCode: BeeGameModelRuntimeFailureCode
      httpStatus?: number
      networkCode?: string
      providerDiagnostics?: Readonly<ProviderHttpErrorDiagnostics>
    }

const WORKER_PATH = fileURLToPath(
  new URL('./model-runtime-worker.ts', import.meta.url),
)

const MODEL_RUNTIME_TRANSPORT_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'BEEGAME_CLIENT_CERT',
  'BEEGAME_CLIENT_KEY',
  'BEEGAME_CLIENT_KEY_PASSPHRASE',
] as const

// Share the approved transport and operator-selected Bgs executable only;
// provider credentials and arbitrary settings stay outside this environment.
export function getModelRuntimeWorkerEnvironment(): Record<string, string> {
  return {
    ...getSafeRuntimeProcessEnvironment(),
    ...(process.env.BEEGAME_BGS_PATH ? { BEEGAME_BGS_PATH: process.env.BEEGAME_BGS_PATH } : {}),
    ...Object.fromEntries(
      MODEL_RUNTIME_TRANSPORT_ENV_KEYS.flatMap(key => {
        // Bun can expose proxy variables through getters without enumerating
        // them. Read the existing transport whitelist directly, not a spread.
        const value = process.env[key]
        return value === undefined ? [] : [[key, value]]
      }),
    ),
  }
}

export function createProcessIsolatedModelRuntimeHost(options: {
  outboundTargetPolicyOptions: OutboundTargetPolicyOptions
  resolveOutboundTarget?: typeof resolveApprovedOutboundTarget
  runWorker?: (
    input: ModelRuntimeWorkerRequest['input'],
  ) => Promise<string | BeeGameModelGeneration>
}): BeeGameModelRuntimeHost {
  const resolveOutboundTarget =
    options.resolveOutboundTarget ?? resolveApprovedOutboundTarget
  const executeWorker = options.runWorker ?? runWorker

  const execute = async (
    input: BeeGameModelGenerateInput,
  ): Promise<BeeGameModelGeneration> => {
    if (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2))
      throw Error('Model temperature must be a finite number between 0 and 2')
    if (input.temperature !== undefined && input.runtimeEnv.OPENAI_AUTH_MODE === 'chatgpt')
      throw Error('ChatGPT subscription requests do not support an explicit temperature')
    const approvedOutboundTargets: Record<string, ApprovedOutboundTarget> = {}
    const endpoint=input.runtimeEnv.OPENAI_AUTH_MODE==='chatgpt'
      ? 'https://chatgpt.com/backend-api/codex/responses'
      : providerConfig(input.runtimeEnv,input.modelType,{requireApiKey:false}).baseUrl
    const target=await resolveOutboundTarget(endpoint,options.outboundTargetPolicyOptions)
    if(!target)throw Error('Outbound URL is not permitted')
    approvedOutboundTargets.OPENAI_BASE_URL=target

    const result = await executeWorker({
      ...input,
      approvedOutboundTargets: Object.fromEntries(
        Object.entries(approvedOutboundTargets).map(([key, target]) => [
          key,
          {
            url: target.url.toString(),
            addresses: [...target.addresses],
            ...(target.trustedDevelopmentProxy
              ? { trustedDevelopmentProxy: true as const }
              : {}),
          },
        ]),
      ),
    })
    return typeof result === 'string' ? { content: result } : result
  }
  const generateWithUsage = (input: BeeGameModelGenerateInput) => input.runtimeEnv.OPENAI_AUTH_MODE === 'chatgpt'
    ? withBgsAccountUse(input.runtimeEnv.BEEGAME_CONFIG_DIR!, () => execute(input))
    : execute(input)
  return {
    generate: async input => (await generateWithUsage(input)).content,
    generateWithUsage,
  }
}

async function runWorker(
  input: ModelRuntimeWorkerRequest['input'],
): Promise<BeeGameModelGeneration> {
  const requestId = randomUUID()
  return new Promise<BeeGameModelGeneration>((resolve, reject) => {
    let settled = false
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const child = Bun.spawn([process.execPath, WORKER_PATH], {
      env: getModelRuntimeWorkerEnvironment(),
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      ipc(raw) {
        const message = raw as ModelRuntimeWorkerResponse
        if (message.requestId !== requestId || settled) return
        settled = true
        clearTimeout(watchdog)
        child.kill()
        if (message.type === 'model.result') {
          resolve({
            content: message.content,
            ...(message.usage ? { usage: message.usage } : {}),
          })
        } else {
          console.warn('[model-runtime]', { diagnosticId: requestId, querySource: input.querySource,
            failureCode: message.failureCode, httpStatus: message.httpStatus,
            providerDiagnostics: message.providerDiagnostics,
            ...(message.failureCode === 'structured-output-missing' ? {responseSummary:message.message} : {}) })
          reject(new BeeGameModelRuntimeError(message.message, message.stage, { usage: message.usage, failureCode: message.failureCode, diagnosticId: requestId, httpStatus: message.httpStatus, networkCode: message.networkCode, providerDiagnostics: message.providerDiagnostics }))
        }
      },
    })
    // The worker has a 120-second request deadline. Bound the process too,
    // because a stuck transport/IPC cleanup must not leave intake running forever.
    watchdog = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new BeeGameModelRuntimeError('Model runtime timed out', 'model_request', { failureCode: 'request-timeout', diagnosticId: requestId }))
    }, 130_000)
    child.exited.then(code => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      reject(new BeeGameModelRuntimeError(`Model runtime process exited (${code})`, 'model_request', { failureCode: 'worker-exited', diagnosticId: requestId }))
    })
    child.send({
      type: 'model.generate',
      requestId,
      input,
    } satisfies ModelRuntimeWorkerRequest)
  })
}
