import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  resolveApprovedOutboundTarget,
  type ApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import type { RuntimeModelConfig } from '@bee-game-studio/agent-workflow'
import { getWorkerBaseEnvironment } from './query-engine-process-runner'
import {
  assertNativeBatchProvider,
  type BeeGameModelBatchRequest,
  type BeeGameModelBatchResult,
  type BeeGameModelBatchRetrieveContext,
  type BeeGameModelBatchRuntime,
} from './model-runtime-batch'

export type {
  BeeGameModelBatchRequest,
  BeeGameModelBatchResult,
  BeeGameModelBatchRetrieveContext,
  BeeGameModelBatchRuntime,
} from './model-runtime-batch'

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
  batch?: BeeGameModelBatchRuntime
  assertBatchProvider?: (modelType: string | undefined) => Promise<void>
}

type SerializedApprovedTarget = {
  url: string
  addresses: string[]
  trustedDevelopmentProxy?: true
}

export type ModelRuntimeWorkerRequest = {
  type: 'model.generate'
  requestId: string
  input: SerializedModelRuntimeInput
} | {
  type: 'model.batch.submit'
  requestId: string
  inputs: Array<{ customId: string; input: SerializedModelRuntimeInput }>
} | {
  type: 'model.batch.retrieve'
  requestId: string
  providerBatchId: string
  context: SerializedModelRuntimeBatchContext
}

export type ModelRuntimeWorkerResponse =
  | {
      type: 'model.result'
      requestId: string
      content: string
      usage?: BeeGameModelUsage
    }
  | {
      type: 'model.batch.submitted'
      requestId: string
      providerBatchId: string
    }
  | {
      type: 'model.batch.retrieved'
      requestId: string
      status: 'processing' | 'ended'
      results?: BeeGameModelBatchResult[]
    }
  | {
      type: 'model.error'
      requestId: string
      message: string
      stage: BeeGameModelRuntimeFailureStage
    }

type SerializedModelRuntimeInput = Omit<BeeGameModelGenerateInput, 'runtimeEnv'> & {
  runtimeEnv: Record<string, string>
  approvedOutboundTargets: Record<string, SerializedApprovedTarget>
}

export type ModelRuntimeWorkerGenerateInput = SerializedModelRuntimeInput

type SerializedModelRuntimeBatchContext = Omit<
  BeeGameModelBatchRetrieveContext,
  'runtimeEnv'
> & {
  runtimeEnv: Record<string, string>
  approvedOutboundTargets: Record<string, SerializedApprovedTarget>
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
    input: SerializedModelRuntimeInput,
  ) => Promise<string | BeeGameModelGeneration>
  runBatchWorker?: (
    requests: readonly BeeGameModelBatchRequest[],
  ) => Promise<{ providerBatchId: string }>
  retrieveBatchWorker?: (
    providerBatchId: string,
    context: BeeGameModelBatchRetrieveContext,
  ) => Promise<{
    status: 'processing' | 'ended'
    results?: readonly BeeGameModelBatchResult[]
  }>
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
  const assertBatchProvider = async (modelType: string | undefined): Promise<void> => {
    assertNativeBatchProvider(modelType)
  }
  const submitBatch = async (
    requests: readonly BeeGameModelBatchRequest[],
  ): Promise<{ providerBatchId: string }> => {
    if (requests.length === 0) throw new Error('Native provider batch requires at least one request')
    for (const request of requests) {
      assertNativeBatchProvider(request.input.modelType)
    }
    if (options.runBatchWorker) return options.runBatchWorker(requests)
    const serialized = await Promise.all(requests.map(async request => ({
      customId: request.customId,
      input: await serializeRuntimeInput(request.input, resolveOutboundTarget, options.outboundTargetPolicyOptions),
    })))
    return runBatchWorker(serialized)
  }
  const retrieveBatch = async (
    providerBatchId: string,
    context: BeeGameModelBatchRetrieveContext,
  ): Promise<{
    status: 'processing' | 'ended'
    results?: readonly BeeGameModelBatchResult[]
  }> => {
    assertNativeBatchProvider(context.modelType)
    if (options.retrieveBatchWorker) return options.retrieveBatchWorker(providerBatchId, context)
    const serializedContext = await serializeBatchContext(
      context,
      resolveOutboundTarget,
      options.outboundTargetPolicyOptions,
    )
    return runBatchRetrieveWorker(providerBatchId, serializedContext)
  }
  return {
    generate: async input => (await generateWithUsage(input)).content,
    generateWithUsage,
    batch: { submit: submitBatch, retrieve: retrieveBatch },
    assertBatchProvider,
  }
}

async function serializeRuntimeInput(
  input: BeeGameModelGenerateInput,
  resolveOutboundTarget: typeof resolveApprovedOutboundTarget,
  policy: OutboundTargetPolicyOptions,
): Promise<SerializedModelRuntimeInput> {
  const approvedOutboundTargets = await resolveApprovedOutboundTargets(input.runtimeEnv, resolveOutboundTarget, policy)
  return {
    ...input,
    approvedOutboundTargets,
  }
}

async function serializeBatchContext(
  context: BeeGameModelBatchRetrieveContext,
  resolveOutboundTarget: typeof resolveApprovedOutboundTarget,
  policy: OutboundTargetPolicyOptions,
): Promise<SerializedModelRuntimeBatchContext> {
  return {
    ...context,
    approvedOutboundTargets: await resolveApprovedOutboundTargets(context.runtimeEnv, resolveOutboundTarget, policy),
  }
}

async function resolveApprovedOutboundTargets(
  runtimeEnv: Record<string, string>,
  resolveOutboundTarget: typeof resolveApprovedOutboundTarget,
  policy: OutboundTargetPolicyOptions,
): Promise<Record<string, SerializedApprovedTarget>> {
  const approvedOutboundTargets: Record<string, SerializedApprovedTarget> = {}
  for (const key of RUNTIME_PROVIDER_URL_KEYS) {
    const value = runtimeEnv[key]
    if (!value) continue
    const target = await resolveOutboundTarget(value, policy)
    if (!target) throw new Error('Outbound URL is not permitted')
    approvedOutboundTargets[key] = {
      url: target.url.toString(),
      addresses: [...target.addresses],
      ...(target.trustedDevelopmentProxy ? { trustedDevelopmentProxy: true as const } : {}),
    }
  }
  if (Object.keys(approvedOutboundTargets).length === 0) {
    throw new Error('The selected model config has no runtime endpoint')
  }
  return approvedOutboundTargets
}

async function runWorker(
  input: SerializedModelRuntimeInput,
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
        } else if (message.type === 'model.error') {
          reject(new BeeGameModelRuntimeError(message.message, message.stage))
        } else {
          reject(new BeeGameModelRuntimeError('Model runtime returned an invalid response', 'model_response'))
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

async function runBatchWorker(
  inputs: Array<{ customId: string; input: SerializedModelRuntimeInput }>,
): Promise<{ providerBatchId: string }> {
  const requestId = randomUUID()
  return new Promise<{ providerBatchId: string }>((resolve, reject) => {
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
        if (message.type === 'model.batch.submitted') {
          resolve({ providerBatchId: message.providerBatchId })
        } else if (message.type === 'model.error') {
          reject(new BeeGameModelRuntimeError(message.message, message.stage))
        } else {
          reject(new BeeGameModelRuntimeError('Model runtime returned an invalid batch submission response', 'model_response'))
        }
      },
    })
    child.exited.then(code => {
      if (settled) return
      settled = true
      reject(new BeeGameModelRuntimeError(`Model runtime process exited (${code})`, 'model_request'))
    })
    child.send({ type: 'model.batch.submit', requestId, inputs } satisfies ModelRuntimeWorkerRequest)
  })
}

async function runBatchRetrieveWorker(
  providerBatchId: string,
  context: SerializedModelRuntimeBatchContext,
): Promise<{ status: 'processing' | 'ended'; results?: BeeGameModelBatchResult[] }> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
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
        if (message.type === 'model.batch.retrieved') {
          resolve({ status: message.status, ...(message.results ? { results: message.results } : {}) })
        } else if (message.type === 'model.error') {
          reject(new BeeGameModelRuntimeError(message.message, message.stage))
        } else {
          reject(new BeeGameModelRuntimeError('Model runtime returned an invalid batch retrieval response', 'model_response'))
        }
      },
    })
    child.exited.then(code => {
      if (settled) return
      settled = true
      reject(new BeeGameModelRuntimeError(`Model runtime process exited (${code})`, 'model_request'))
    })
    child.send({ type: 'model.batch.retrieve', requestId, providerBatchId, context } satisfies ModelRuntimeWorkerRequest)
  })
}
