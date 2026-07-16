import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import {
  createBeeGamePinnedFetch,
  ensureBeeGameMacroGlobals,
} from './query-engine-runner'
import type {
  ModelRuntimeWorkerRequest,
  ModelRuntimeWorkerResponse,
} from './model-runtime-host'

process.on('message', raw => {
  void handleMessage(raw as ModelRuntimeWorkerRequest)
})

async function handleMessage(message: ModelRuntimeWorkerRequest): Promise<void> {
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
  const pinnedFetch = createBeeGamePinnedFetch(previousFetch, targets)

  try {
    for (const [key, value] of Object.entries(message.input.runtimeEnv)) {
      previousEnv.set(key, process.env[key])
      process.env[key] = value
    }
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
      max_tokens: message.input.maxTokens ?? 8_192,
      temperature: message.input.temperature,
      thinking: false,
      skipSystemPromptPrefix: true,
      querySource: message.input.querySource,
    })
    const content = extractText(result)
    send({
      type: 'model.result',
      requestId: message.requestId,
      content,
    })
  } catch (error) {
    send({
      type: 'model.error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : 'Model runtime failed',
    })
  } finally {
    process.chdir(previousCwd)
    globalThis.fetch = previousFetch
    await pinnedFetch.close()
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
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
