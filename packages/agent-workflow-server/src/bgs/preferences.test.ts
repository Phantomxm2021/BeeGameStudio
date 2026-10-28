import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { registerBgsSettingsRoutes } from './settings-routes'
import { bgsReasoningConfig, reasoningCapabilities } from './preferences'
import { readReasoningPreferences, reasoningConnectionKey, saveReasoningPreference } from './preferences-store'

const command = [process.execPath, fileURLToPath(new URL('./fixtures/interactions-app-server.ts', import.meta.url))]
test('reasoning settings validate advertised choices, reset defaults and remain owner/connection scoped', async () => {
  const root = await mkdtemp('/private/tmp/bgs-bgs-settings-')
  const env = { BEEGAME_CONFIG_DIR: join(root, 'owner-a'), OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_MODEL: 'fixture-model' }
  let changed = 0
  const app = new Hono()
  registerBgsSettingsRoutes(app, { command, environment: async () => env, changed: () => { changed++ } })
  const update = (body: unknown) => app.request('/api/bgs/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const initial = await (await app.request('/api/bgs/settings')).json()
    expect(initial.efforts).toEqual(['low', 'high'])
    expect((await update({ connectionKey: initial.connectionKey, effort: 'invented' })).status).toBe(400)
    expect((await update({ connectionKey: 'stale-selection', effort: 'high' })).status).toBe(409)
    expect(changed).toBe(0)
    expect((await update({ connectionKey: initial.connectionKey, effort: 'high' })).status).toBe(200)
    expect((await (await app.request('/api/bgs/settings')).json()).effort).toBe('high')
    expect(readReasoningPreferences({ ...env, BEEGAME_CONFIG_DIR: join(root, 'owner-b') })).toEqual({})
    expect(reasoningConnectionKey({ ...env, OPENAI_AUTH_MODE: 'api' }, 'fixture-model')).not.toBe(initial.connectionKey)
    expect((await update({ connectionKey: initial.connectionKey, effort: null })).status).toBe(200)
    expect(readReasoningPreferences(env)).toEqual({ [initial.connectionKey]: null })
    expect(changed).toBe(2)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)

test('an OpenAI catalog never invents reasoning capabilities for third-party providers or unknown models', async () => {
  const root = await mkdtemp('/private/tmp/bgs-model-capability-')
  const base = { BEEGAME_CONFIG_DIR: root, BEEGAME_MODEL: 'fixture-model' }
  const models = [{ model: 'fixture-model', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }]
  try {
    expect(reasoningCapabilities({ ...base, OPENAI_AUTH_MODE: 'chatgpt' }, models).efforts).toEqual(['high'])
    expect(reasoningCapabilities({ ...base, OPENAI_BASE_URL: 'https://third-party.example/v1' }, models).efforts).toEqual([])
    expect(reasoningCapabilities({ ...base, OPENAI_BASE_URL: 'https://api.openai.comv1' }, models).efforts).toEqual([])
    expect(reasoningCapabilities({ ...base, BEEGAME_API_PROTOCOL: 'chat-completions' }, models).efforts).toEqual([])
    expect(reasoningCapabilities({ ...base, BEEGAME_MODEL: 'unknown', OPENAI_AUTH_MODE: 'chatgpt' }, models).efforts).toEqual([])
    saveReasoningPreference(base, reasoningConnectionKey(base, 'other-model'), 'high')
    expect(reasoningCapabilities(base, models).effort).toBeNull()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('verified Go settings reuse connection preferences without consulting the OpenAI catalog', async () => {
  const root = await mkdtemp('/private/tmp/bgs-go-settings-')
  const env = { BEEGAME_CONFIG_DIR: root, BEEGAME_MODEL_TYPE: 'openai', BEEGAME_API_PROTOCOL: 'chat-completions',
    OPENAI_BASE_URL: 'https://opencode.ai/zen/go/v1', BEEGAME_MODEL: 'deepseek-v4.1-flash' }
  const client = { requestNative: async () => { throw Error('Go settings must not consult the native catalog or global config') } }
  const app = new Hono()
  registerBgsSettingsRoutes(app, { command: ['must-not-spawn'], environment: async () => env, changed() {} })
  const update = (connectionKey: string, effort: string | null) => app.request('/api/bgs/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionKey, effort }),
  })
  try {
    const initial = await (await app.request('/api/bgs/settings')).json()
    expect(initial.efforts).toEqual(['low', 'high'])
    expect(initial.effort).toBeNull()
    expect(await bgsReasoningConfig(env, client)).toEqual({})
    expect((await update(initial.connectionKey, 'max')).status).toBe(400)
    expect((await update(initial.connectionKey, 'medium')).status).toBe(400)
    expect((await update('stale-connection', 'low')).status).toBe(409)
    for (const effort of ['low', 'high'] as const) {
      expect((await update(initial.connectionKey, effort)).status).toBe(200)
      expect(await bgsReasoningConfig(env, client)).toEqual({ model_reasoning_effort: effort })
    }
    expect(await bgsReasoningConfig({ ...env, BEEGAME_CONFIG_DIR: join(root, 'other-owner') }, client))
      .toEqual({})
    for (const other of [
      { ...env, BEEGAME_MODEL: 'deepseek-v4-pro' },
      { ...env, BEEGAME_API_PROTOCOL: 'responses' },
      { ...env, OPENAI_BASE_URL: 'https://opencode.ai/inference/go/openai/v1' },
      { ...env, OPENAI_BASE_URL: 'https://other.example/v1' },
    ]) {
      expect(reasoningCapabilities(other, []).efforts).toEqual([])
      expect(reasoningCapabilities(other, []).effort).toBeNull()
      expect(await bgsReasoningConfig(other, client)).toEqual({})
    }
    expect((await update(initial.connectionKey, null)).status).toBe(200)
    expect(await bgsReasoningConfig(env, client)).toEqual({})
    saveReasoningPreference(env, initial.connectionKey, 'unsupported-saved-value')
    await expect(bgsReasoningConfig(env, client)).rejects.toThrow('no longer supported')
  } finally { await rm(root, { recursive: true, force: true }) }
})
