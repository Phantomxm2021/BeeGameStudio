import { mkdir } from 'node:fs/promises'
import { BgsClient, type RpcObject } from './client'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'
import { bgsSettingsHome, readReasoningPreferences, reasoningConnectionKey } from './preferences-store'
import { withBgsAccountUse } from './account-activity'

export function hasVerifiedReasoningCatalog(env: Record<string, string>) {
  if (env.OPENAI_AUTH_MODE === 'chatgpt') return true
  return (!env.BEEGAME_MODEL_TYPE || env.BEEGAME_MODEL_TYPE === 'openai') &&
    (!env.BEEGAME_API_PROTOCOL || env.BEEGAME_API_PROTOCOL === 'responses') &&
    (!env.OPENAI_BASE_URL || /^https:\/\/api\.openai\.com(?:\/v1)?\/?$/.test(env.OPENAI_BASE_URL))
}

export function reasoningCapabilities(env: Record<string, string>, models: RpcObject[]) {
  const requested = env.BEEGAME_MODEL
  const selected = requested ? models.find(entry => entry.model === requested) : models.find(entry => entry.isDefault)
  const model = requested || selected?.model || ''
  const efforts: string[] = hasVerifiedReasoningCatalog(env) && selected
    ? (selected.supportedReasoningEfforts || []).map((option: RpcObject) => option.reasoningEffort).filter((value: unknown) => typeof value === 'string') : []
  const connectionKey = reasoningConnectionKey(env, model)
  return { model, connectionKey, efforts: [...new Set(efforts)],
    defaultEffort: selected?.defaultReasoningEffort as string | undefined,
    effort: readReasoningPreferences(env)[connectionKey] || null }
}

export async function loadReasoningCapabilities(env: Record<string, string>, command?: readonly string[]) {
  if (!hasVerifiedReasoningCatalog(env)) return reasoningCapabilities(env, [])
  return withBgsAccountUse(env.BEEGAME_CONFIG_DIR!, () => readReasoningCapabilities(env, command))
}
async function readReasoningCapabilities(env: Record<string, string>, command?: readonly string[]) {
  const { bgsProviderConfig } = await import('./runner')
  const home = bgsSettingsHome(env)
  await mkdir(home, { recursive: true, mode: 0o700 })
  const client = await BgsClient.connect({ command, cwd: home,
    env: { ...getSafeRuntimeProcessEnvironment(), ...env, BGS_HOME: home },
    config: { ...bgsProviderConfig(env), cli_auth_credentials_store: 'file' } })
  try { return reasoningCapabilities(env, (await client.request('model/list', {})).data || []) }
  finally { await client.close() }
}

export async function bgsReasoningConfig(env: Record<string, string>, client: BgsClient) {
  const preferences = readReasoningPreferences(env)
  if (!Object.keys(preferences).length || !hasVerifiedReasoningCatalog(env)) return {}
  const capabilities = reasoningCapabilities(env, (await client.request('model/list', {})).data || [])
  if (!Object.hasOwn(preferences, capabilities.connectionKey)) return {}
  const effort = capabilities.effort ?? (await client.request('config/read', {})).config?.model_reasoning_effort ?? capabilities.defaultEffort
  if (!effort || !capabilities.efforts.includes(effort)) throw Error('Saved reasoning effort is no longer supported; update BGS settings')
  return { model_reasoning_effort: effort }
}
