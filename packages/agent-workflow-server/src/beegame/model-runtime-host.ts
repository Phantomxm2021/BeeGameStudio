import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  resolveApprovedOutboundTarget,
  type ApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import type { RuntimeModelConfig } from '@bee-game-studio/agent-workflow'
import { getWorkerBaseEnvironment } from './query-engine-process-runner'

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

export class BeeGameModelRuntimeError extends Error {
  constructor(
    message: string,
    readonly stage: BeeGameModelRuntimeFailureStage,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'BeeGameModelRuntimeError'
  }
}

export function serializeStructuredModelToolResult(value: unknown, expectedName: string): string {
  if (!value || typeof value !== 'object' || !('content' in value)) {
    throw new Error('Structured model result is missing the required tool call')
  }
  const resultRecord = value as Record<string, unknown>
  if (resultRecord?.stop_reason === 'max_tokens') {
    throw new Error('Structured model provider output was truncated before tool arguments completed')
  }
  const content = (value as { content?: unknown }).content
  if (!Array.isArray(content)) {
    throw new Error('Structured model result is missing the required tool call')
  }
  const toolUses = content.filter(block => {
    if (!block || typeof block !== 'object') return false
    const record = block as Record<string, unknown>
    return record.type === 'tool_use' && record.name === expectedName
  }) as Array<{ input?: unknown }>
  if (toolUses.length !== 1 || toolUses[0]?.input === undefined) {
    throw new Error(`Structured model result must contain exactly one ${expectedName} tool call`)
  }
  const toolInput = toolUses[0].input
  let canonicalInput = toolInput
  if (
    toolInput &&
    typeof toolInput === 'object' &&
    !Array.isArray(toolInput) &&
    Object.prototype.hasOwnProperty.call(toolInput, 'raw_arguments')
  ) {
    const inputRecord = toolInput as Record<string, unknown>
    const canonicalFields = Object.fromEntries(
      Object.entries(inputRecord).filter(([key]) => key !== 'raw_arguments'),
    )
    if (Object.keys(canonicalFields).length > 0) {
      // Some Anthropic-compatible gateways return parsed tool fields together
      // with their own raw diagnostic. The parsed fields are the canonical
      // contract; the diagnostic must never cross this boundary.
      canonicalInput = canonicalFields
    } else {
      const rawArguments = inputRecord.raw_arguments
      if (typeof rawArguments !== 'string') {
        throw new Error('Structured model tool arguments are not valid JSON')
      }
      try {
        canonicalInput = JSON.parse(rawArguments)
      } catch (error) {
        throw new Error('Structured model tool arguments are not valid JSON', { cause: error })
      }
    }
  }
  return JSON.stringify(canonicalInput)
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
      message: string
      stage: BeeGameModelRuntimeFailureStage
    }

const WORKER_PATH = fileURLToPath(
  new URL('./model-runtime-worker.ts', import.meta.url),
)

const RUNTIME_PROVIDER_URL_KEYS = [
  'ANTHROPIC_BASE_URL',
  'OPENAI_BASE_URL',
  'GEMINI_BASE_URL',
  'GROK_BASE_URL',
] as const

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
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS',
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'ANTHROPIC_UNIX_SOCKET',
] as const

// The model worker must use the same verified network path as the host. Keep
// this list explicit so provider credentials and arbitrary process settings do
// not cross the isolation boundary.
export function getModelRuntimeWorkerEnvironment(): Record<string, string> {
  return {
    ...getWorkerBaseEnvironment(),
    ...Object.fromEntries(
      MODEL_RUNTIME_TRANSPORT_ENV_KEYS.flatMap(key => {
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

  const generateWithUsage = async (
    input: BeeGameModelGenerateInput,
  ): Promise<BeeGameModelGeneration> => {
    const approvedOutboundTargets: Record<string, ApprovedOutboundTarget> = {}
    for (const key of RUNTIME_PROVIDER_URL_KEYS) {
      const value = input.runtimeEnv[key]
      if (!value) continue
      const target = await resolveOutboundTarget(
        value,
        options.outboundTargetPolicyOptions,
      )
      if (!target) throw new Error('Outbound URL is not permitted')
      approvedOutboundTargets[key] = target
    }
    if (Object.keys(approvedOutboundTargets).length === 0) {
      throw new Error('The selected model config has no runtime endpoint')
    }

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
    const child = Bun.spawn([process.execPath, WORKER_PATH], {
      env: getModelRuntimeWorkerEnvironment(),
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      ipc(raw) {
        const message = raw as ModelRuntimeWorkerResponse
        if (message.requestId !== requestId || settled) return
        settled = true
        child.kill()
        if (message.type === 'model.result') {
          resolve({
            content: message.content,
            ...(message.usage ? { usage: message.usage } : {}),
          })
        } else {
          reject(new BeeGameModelRuntimeError(message.message, message.stage))
        }
      },
    })
    child.exited.then(code => {
      if (settled) return
      settled = true
      reject(new BeeGameModelRuntimeError(`Model runtime process exited (${code})`, 'model_request'))
    })
    child.send({
      type: 'model.generate',
      requestId,
      input,
    } satisfies ModelRuntimeWorkerRequest)
  })
}
