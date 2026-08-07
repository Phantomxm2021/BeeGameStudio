import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import {
  createBeeGamePinnedFetch,
  ensureBeeGameMacroGlobals,
} from './query-engine-runner'
import { getTLSFetchOptions } from '../../../../src/utils/mtls.js'
import type {
  BeeGameModelRuntimeFailureStage,
  BeeGameModelUsage,
  BeeGameModelBatchResult,
  BeeGameModelGenerateInput,
  ModelRuntimeWorkerRequest,
  ModelRuntimeWorkerResponse,
} from './model-runtime-host'
import { serializeStructuredModelToolResult } from './model-runtime-host'

process.on('message', raw => {
  void handleMessage(raw as ModelRuntimeWorkerRequest)
})

async function handleMessage(message: ModelRuntimeWorkerRequest): Promise<void> {
  if (message.type === 'model.batch.submit') {
    await handleBatchSubmit(message)
    return
  }
  if (message.type === 'model.batch.retrieve') {
    await handleBatchRetrieve(message)
    return
  }
  if (message.type !== 'model.generate') return
  const previousCwd = process.cwd()
  const previousFetch = globalThis.fetch
  const previousEnv = new Map<string, string | undefined>()
  const targets = Object.fromEntries(
    Object.entries(message.input.approvedOutboundTargets).map(([key, target]) => [
      key,
      createApprovedTarget(
        target.url,
        target.addresses,
        target.trustedDevelopmentProxy,
      ),
    ]),
  )
  let pinnedFetch: ReturnType<typeof createBeeGamePinnedFetch> | undefined
  let failureStage: BeeGameModelRuntimeFailureStage = 'model_request'

  try {
    if (message.input.modelType) {
      previousEnv.set('BEEGAME_RUNTIME_MODEL_TYPE', process.env.BEEGAME_RUNTIME_MODEL_TYPE)
      process.env.BEEGAME_RUNTIME_MODEL_TYPE = message.input.modelType
    }
    for (const [key, value] of Object.entries(message.input.runtimeEnv)) {
      previousEnv.set(key, process.env[key])
      process.env[key] = value
    }
    pinnedFetch = createBeeGamePinnedFetch(previousFetch, targets, {
      tls: getTLSFetchOptions().tls,
    })
    process.chdir(message.input.cwd)
    globalThis.fetch = pinnedFetch
    ensureBeeGameMacroGlobals()

    // sideQuery is a Claude Code native service and intentionally rejects any
    // configuration read before the native configuration gate is enabled.
    // This isolated entrypoint bypasses the CLI bootstrap, so mirror the same
    // minimal native initialization used by the bridge and query-engine paths.
    const configModule = await loadRootModule('utils/config.js')
    getFunction(configModule, 'enableConfigs')()
    const [sideQueryModule, modelModule] = await Promise.all([
      loadRootModule('utils/sideQuery.js'),
      loadRootModule('utils/model/model.js'),
    ])
    const sideQuery = getFunction(sideQueryModule, 'sideQuery')
    const getDefaultSonnetModel = getFunction(
      modelModule,
      'getDefaultSonnetModel',
    )
    const result = await sideQuery({
      model: String(getDefaultSonnetModel()),
      system: message.input.systemPrompt,
      messages: message.input.messages,
      ...(message.input.maxTokens !== undefined
        ? { max_tokens: message.input.maxTokens }
        : {}),
      temperature: message.input.temperature,
      thinking: false,
      skipSystemPromptPrefix: true,
      querySource: message.input.querySource,
      ...(message.input.structuredOutput
        ? {
            tools: [{
              name: message.input.structuredOutput.name,
              description: message.input.structuredOutput.description,
              input_schema: message.input.structuredOutput.inputSchema,
            }],
            tool_choice: {
              type: 'tool' as const,
              name: message.input.structuredOutput.name,
            },
          }
        : {}),
    })
    failureStage = 'model_response'
    const content = message.input.structuredOutput
      ? serializeStructuredModelToolResult(result, message.input.structuredOutput.name)
      : extractText(result)
    const usage = extractUsage(result)
    send({
      type: 'model.result',
      requestId: message.requestId,
      content,
      ...(usage ? { usage } : {}),
    })
  } catch (error) {
    send({
      type: 'model.error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : 'Model runtime failed',
      stage: failureStage,
    })
  } finally {
    process.chdir(previousCwd)
    globalThis.fetch = previousFetch
    if (pinnedFetch) await pinnedFetch.close()
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function handleBatchSubmit(
  message: Extract<ModelRuntimeWorkerRequest, { type: 'model.batch.submit' }>,
): Promise<void> {
  const previousCwd = process.cwd()
  const previousFetch = globalThis.fetch
  const previousEnv = new Map<string, string | undefined>()
  const firstEntry = message.inputs[0]
  if (!firstEntry) {
    send({ type: 'model.error', requestId: message.requestId, message: 'Native provider batch requires at least one request', stage: 'model_request' })
    return
  }
  const first = firstEntry.input
  let pinnedFetch: ReturnType<typeof createBeeGamePinnedFetch> | undefined
  try {
    const targets = createTargets(first.approvedOutboundTargets)
    applyRuntimeEnvironment(first.modelType, first.runtimeEnv, previousEnv)
    pinnedFetch = createBeeGamePinnedFetch(previousFetch, targets, { tls: getTLSFetchOptions().tls })
    process.chdir(first.cwd)
    globalThis.fetch = pinnedFetch
    ensureBeeGameMacroGlobals()
    const configModule = await loadRootModule('utils/config.js')
    getFunction(configModule, 'enableConfigs')()
    const [clientModule, modelModule] = await Promise.all([
      loadRootModule('services/api/client.js'),
      loadRootModule('utils/model/model.js'),
    ])
    const getAnthropicClient = getFunction(clientModule, 'getAnthropicClient')
    const getDefaultSonnetModel = getFunction(modelModule, 'getDefaultSonnetModel')
    const model = String(getDefaultSonnetModel())
    const client = await getAnthropicClient({ maxRetries: 2, model, source: 'resource_semantic_batch' }) as {
      messages: { batches: { create: (input: unknown) => Promise<{ id?: unknown }> } }
    }
    const batch = await client.messages.batches.create({
      requests: message.inputs.map(entry => {
        const input = entry.input
        return {
        custom_id: entry.customId,
        params: {
          model,
          system: input.systemPrompt,
          messages: input.messages,
          ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.structuredOutput ? {
            tools: [{
              name: input.structuredOutput.name,
              description: input.structuredOutput.description,
              input_schema: input.structuredOutput.inputSchema,
            }],
            tool_choice: { type: 'tool', name: input.structuredOutput.name },
          } : {}),
        },
      }}),
    })
    if (typeof batch.id !== 'string' || !batch.id.trim()) throw new Error('Native provider batch did not return an id')
    send({ type: 'model.batch.submitted', requestId: message.requestId, providerBatchId: batch.id })
  } catch (error) {
    send({ type: 'model.error', requestId: message.requestId, message: error instanceof Error ? error.message : 'Model batch submission failed', stage: 'model_request' })
  } finally {
    process.chdir(previousCwd)
    globalThis.fetch = previousFetch
    if (pinnedFetch) await pinnedFetch.close()
    restoreRuntimeEnvironment(previousEnv)
  }
}

async function handleBatchRetrieve(
  message: Extract<ModelRuntimeWorkerRequest, { type: 'model.batch.retrieve' }>,
): Promise<void> {
  const previousCwd = process.cwd()
  const previousFetch = globalThis.fetch
  const previousEnv = new Map<string, string | undefined>()
  let pinnedFetch: ReturnType<typeof createBeeGamePinnedFetch> | undefined
  try {
    const targets = createTargets(message.context.approvedOutboundTargets)
    applyRuntimeEnvironment(message.context.modelType, message.context.runtimeEnv, previousEnv)
    pinnedFetch = createBeeGamePinnedFetch(previousFetch, targets, { tls: getTLSFetchOptions().tls })
    process.chdir(message.context.cwd)
    globalThis.fetch = pinnedFetch
    ensureBeeGameMacroGlobals()
    const configModule = await loadRootModule('utils/config.js')
    getFunction(configModule, 'enableConfigs')()
    const [clientModule, modelModule] = await Promise.all([
      loadRootModule('services/api/client.js'),
      loadRootModule('utils/model/model.js'),
    ])
    const getAnthropicClient = getFunction(clientModule, 'getAnthropicClient')
    const getDefaultSonnetModel = getFunction(modelModule, 'getDefaultSonnetModel')
    const model = String(getDefaultSonnetModel())
    const client = await getAnthropicClient({ maxRetries: 2, model, source: 'resource_semantic_batch' }) as {
      messages: { batches: {
        retrieve: (id: string) => Promise<unknown>
        results: (id: string) => AsyncIterable<unknown>
      } }
    }
    const batch = await client.messages.batches.retrieve(message.providerBatchId)
    const status = readString(batch, 'processing_status')
    if (status !== 'ended') {
      send({ type: 'model.batch.retrieved', requestId: message.requestId, status: 'processing' })
      return
    }
    const results: BeeGameModelBatchResult[] = []
    for await (const rawResult of client.messages.batches.results(message.providerBatchId)) {
      results.push(parseProviderBatchResult(rawResult, message.context.structuredOutput))
    }
    send({ type: 'model.batch.retrieved', requestId: message.requestId, status: 'ended', results })
  } catch (error) {
    send({ type: 'model.error', requestId: message.requestId, message: error instanceof Error ? error.message : 'Model batch retrieval failed', stage: 'model_response' })
  } finally {
    process.chdir(previousCwd)
    globalThis.fetch = previousFetch
    if (pinnedFetch) await pinnedFetch.close()
    restoreRuntimeEnvironment(previousEnv)
  }
}

function createTargets(
  values: Record<string, { url: string; addresses: string[]; trustedDevelopmentProxy?: true }>,
): Record<string, ApprovedOutboundTarget> {
  return Object.fromEntries(Object.entries(values).map(([key, target]) => [
    key,
    createApprovedTarget(target.url, target.addresses, target.trustedDevelopmentProxy),
  ]))
}

function applyRuntimeEnvironment(
  modelType: string | undefined,
  runtimeEnv: Record<string, string>,
  previousEnv: Map<string, string | undefined>,
): void {
  if (modelType) {
    previousEnv.set('BEEGAME_RUNTIME_MODEL_TYPE', process.env.BEEGAME_RUNTIME_MODEL_TYPE)
    process.env.BEEGAME_RUNTIME_MODEL_TYPE = modelType
  }
  for (const [key, value] of Object.entries(runtimeEnv)) {
    previousEnv.set(key, process.env[key])
    process.env[key] = value
  }
}

function restoreRuntimeEnvironment(previousEnv: Map<string, string | undefined>): void {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function parseProviderBatchResult(
  value: unknown,
  structuredOutput?: BeeGameModelGenerateInput['structuredOutput'],
): BeeGameModelBatchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native provider batch result is invalid')
  const record = value as Record<string, unknown>
  const customId = readString(record, 'custom_id')
  const result = record.result
  if (!customId || !result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Native provider batch result identity is invalid')
  const resultRecord = result as Record<string, unknown>
  const type = readString(resultRecord, 'type')
  if (type === 'succeeded') {
    const message = resultRecord.message
    const content = structuredOutput
      ? serializeStructuredModelToolResult(message, structuredOutput.name)
      : extractText(message)
    return {
      customId,
      status: 'succeeded',
      generation: { content, ...(extractUsage(message) ? { usage: extractUsage(message) } : {}) },
    }
  }
  if (type === 'errored' || type === 'canceled' || type === 'expired') {
    return {
      customId,
      status: type === 'canceled' ? 'cancelled' : type,
      error: readString((resultRecord.error && typeof resultRecord.error === 'object' ? resultRecord.error : resultRecord), 'message') || `Provider batch result ${type}`,
    }
  }
  throw new Error('Native provider batch result status is invalid')
}

function readString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const result = (value as Record<string, unknown>)[key]
  return typeof result === 'string' ? result : ''
}

function extractUsage(value: unknown): BeeGameModelUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const usage = (value as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage))
    return undefined
  const record = usage as Record<string, unknown>
  const input = nonNegative(record.input_tokens ?? record.prompt_tokens)
  const output = nonNegative(record.output_tokens ?? record.completion_tokens)
  const cacheRead = nonNegative(
    record.cache_read_input_tokens ?? record.cache_read_tokens,
  )
  const cacheCreation = nonNegative(
    record.cache_creation_input_tokens ?? record.cache_creation_tokens,
  )
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    total_tokens:
      nonNegative(record.total_tokens) ||
      input + output + cacheRead + cacheCreation,
  }
}

function nonNegative(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

type DynamicModule = Record<string, unknown>

function loadRootModule(path: string): Promise<DynamicModule> {
  return import(`../../../../src/${path}`) as Promise<DynamicModule>
}

function getFunction(
  module: DynamicModule,
  name: string,
): (...args: unknown[]) => unknown {
  const value = module[name]
  if (typeof value !== 'function') {
    throw new Error(`Claude runtime module is missing ${name}`)
  }
  return value as (...args: unknown[]) => unknown
}

function extractText(value: unknown): string {
  if (!value || typeof value !== 'object' || !('content' in value)) return ''
  const content = (value as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .join('')
}

function createApprovedTarget(
  value: string,
  addresses: string[],
  trustedDevelopmentProxy?: true,
): ApprovedOutboundTarget {
  const url = new URL(value)
  return {
    url,
    addresses,
    ...(trustedDevelopmentProxy ? { trustedDevelopmentProxy } : {}),
    lookup(hostname, _options, callback) {
      if (hostname !== url.hostname || addresses.length === 0) {
        callback(new Error('Outbound URL is not permitted'), '', 4)
        return
      }
      const address = addresses[0]!
      callback(null, address, address.includes(':') ? 6 : 4)
    },
  }
}

function send(message: ModelRuntimeWorkerResponse): void {
  process.send?.(message)
}
