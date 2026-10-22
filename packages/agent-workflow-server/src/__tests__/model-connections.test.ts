import { goCatalogResponse } from '../../../../tests/fixtures/opencode-go'
import { OPENCODE_GO_ID, OPENCODE_GO_PROFILES } from '@bee-game-studio/agent-workflow/opencode-go'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createModelConfig, exportModelConfigSnapshot, importModelConfigSnapshot, mapModelConfigToRuntime, resetModelConfigs, validateModelAccess } from '@bee-game-studio/agent-workflow'
import { connectionStatus, disconnectAccount, disconnectConnection, ModelConnectionLogins, PERSONAL_BYOK_ID, PERSONAL_CHATGPT_ID, personalModelAvailable, personalModelConfig, preferredModelId, resolveModelConnection, saveConnection } from '../model-connections'
import { mergeRuntimeEnv } from '../beegame/session-manager'
import { createAgentWorkflowApp } from '../app'
import { getUserDashboardDataRoot } from '../local-runtime-service'
import { DashboardRepository } from '../dashboard-repository'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'
import { SupabaseRuntimeEnvClient } from '../supabase-runtime-env-client'
import { encryptSecret } from '../security/secret-crypto'

let root: string
let previousKey: string | undefined
let previousCatalogFetch: typeof fetch
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bgs-connections-'))
  previousKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64')
  resetModelConfigs()
  previousCatalogFetch = globalThis.fetch
  globalThis.fetch = ((input, init) => {
    const url = String(input)
    if (url === 'https://opencode.ai/inference/go/v1/models' || url === 'https://models.dev/api.json') return Promise.resolve(goCatalogResponse(url))
    return previousCatalogFetch(input, init)
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = previousCatalogFetch
  resetModelConfigs()
  if (previousKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = previousKey
  rmSync(root, { recursive: true, force: true })
})
const model = () => createModelConfig('owner', { name: 'OpenAI', provider: 'openai-compatible', apiKey: 'platform-fixture-secret', models: { balanced: 'fixture-model' }, authMethods: ['platform', 'byok', 'chatgpt-subscription'] })

test('model publication and auth methods survive persistence; legacy snapshots default to platform', () => {
  const config = model()
  const snapshot = exportModelConfigSnapshot()
  importModelConfigSnapshot(snapshot)
  expect(exportModelConfigSnapshot()[0].authMethods).toEqual(config.authMethods)
  delete snapshot[0].authMethods
  delete snapshot[0].published
  importModelConfigSnapshot(snapshot)
  expect(exportModelConfigSnapshot()[0]).toMatchObject({ published: true, authMethods: ['platform'] })
  expect(() => validateModelAccess('gemini', ['chatgpt-subscription'])).toThrow()
  expect(() => validateModelAccess('openai-compatible', [])).toThrow()
})

test('BYOK is encrypted, user-isolated and takes precedence over pinned platform credentials', () => {
  const config = model()
  const a = join(root, 'a'), b = join(root, 'b')
  saveConnection(a, config, 'byok', 'personal-fixture-secret', true)
  expect(readFileSync(join(a, '.runtime/model-connections.json'), 'utf8')).not.toContain('personal-fixture-secret')
  expect(connectionStatus(b, config)).toMatchObject({ method: 'platform', hasKey: false })
  const env = resolveModelConnection(a, config, { OPENAI_API_KEY: 'platform-key' })
  expect(env.OPENAI_API_KEY).toBe('personal-fixture-secret')
  expect(mergeRuntimeEnv({ modelType: 'openai', env: { OPENAI_API_KEY: 'stale-platform-key' } }, env).OPENAI_API_KEY).toBe('personal-fixture-secret')
  expect(preferredModelId(a)).toBe(config.id)
  saveConnection(a, config, 'byok', undefined, false)
  expect(preferredModelId(a)).toBeUndefined()
  expect(() => resolveModelConnection(a, { ...config, baseUrl: 'https://changed.example/v1' }, {})).toThrow('disconnected')
  disconnectConnection(a, config.id)
  expect(() => resolveModelConnection(a, config, { OPENAI_API_KEY: 'platform-key' })).toThrow('disabled')
})

test('personal BYOK endpoint and all three models reach the runtime without leaking the key', () => {
  const config = model()
  const first = { fast: 'fast-personal', balanced: 'balanced-personal', strong: 'strong-personal' }
  saveConnection(root, config, 'byok', 'personal-fixture-secret', true, { baseUrl: 'https://personal.example/v1', models: first })
  expect(connectionStatus(root, config)).toMatchObject({ hasKey: true, baseUrl: 'https://personal.example/v1', models: first })
  const stored = readFileSync(join(root, '.runtime/model-connections.json'), 'utf8')
  expect(stored).not.toContain('personal-fixture-secret')
  const env = resolveModelConnection(root, config, { OPENAI_API_KEY: 'platform-key' })
  expect(env).toMatchObject({ OPENAI_BASE_URL: 'https://personal.example/v1', OPENAI_API_KEY: 'personal-fixture-secret', BGS_DEFAULT_FAST_MODEL: 'fast-personal', BGS_DEFAULT_BALANCED_MODEL: 'balanced-personal', BGS_DEFAULT_STRONG_MODEL: 'strong-personal' })
  saveConnection(root, config, 'platform')
  expect(connectionStatus(root, config)).toMatchObject({ method: 'platform', hasKey: true, baseUrl: 'https://personal.example/v1', models: first })
  expect(resolveModelConnection(root, config, { OPENAI_API_KEY: 'platform-key' }).OPENAI_API_KEY).toBe('platform-key')
  saveConnection(root, config, 'byok')
  expect(resolveModelConnection(root, config, {}).OPENAI_API_KEY).toBe('personal-fixture-secret')
  expect(() => saveConnection(root, config, 'byok', undefined, true, { baseUrl: 'https://other.example/v1', models: first })).toThrow('API key')
  expect(() => saveConnection(root, config, 'byok', 'another-key', true, { baseUrl: 'http://unsafe.example/v1', models: first })).toThrow('HTTPS')
  expect(() => saveConnection(root, config, 'byok', 'another-key', true, { baseUrl: 'https://other.example/v1', models: { balanced: 'only-one' } })).toThrow('three')
})

test('independent BYOK remains user-owned and resolves without a published model', async () => {
  const alice = join(root, 'alice'), bob = join(root, 'bob')
  const config = personalModelConfig(alice, 'alice', PERSONAL_BYOK_ID, 'openai-compatible')!
  saveConnection(alice, config, 'byok', 'alice-personal-key', true, { baseUrl: 'https://personal.example/v1', models: { fast: 'f', balanced: 'b', strong: 's' } })
  expect(personalModelAvailable(alice, 'alice', PERSONAL_BYOK_ID)).toBe(true)
  expect(personalModelAvailable(bob, 'bob', PERSONAL_BYOK_ID)).toBe(false)
  const repository = new DashboardRepository({ dashboardDataRoot: root, getUserDataRoot: () => alice, skillsConfig: false })
  const env = await repository.getRuntimeEnv(alice, 'alice', undefined, PERSONAL_BYOK_ID)
  expect(env).toMatchObject({ OPENAI_API_KEY: 'alice-personal-key', OPENAI_BASE_URL: 'https://personal.example/v1', BGS_DEFAULT_FAST_MODEL: 'f', BGS_DEFAULT_BALANCED_MODEL: 'b', BGS_DEFAULT_STRONG_MODEL: 's' })
  expect(env.OPENAI_API_KEY).toBe('alice-personal-key')
  expect(() => saveConnection(alice, personalModelConfig(alice, 'alice', PERSONAL_BYOK_ID, 'anthropic-compatible')!, 'byok', undefined, true, { baseUrl: 'https://personal.example/v1', models: { fast: 'f', balanced: 'b', strong: 's' } })).toThrow('Enter your API key')
})

test('subscription runtime excludes API keys and custom endpoints; logout fails closed', () => {
  const config = { ...model(), baseUrl: 'https://custom.example/v1' }
  expect(() => saveConnection(root, config, 'chatgpt-subscription')).toThrow('Connect')
  mkdirSync(join(root, '.runtime/app/bgs'), { recursive: true })
  writeFileSync(join(root, '.runtime/app/bgs/auth.json'), JSON.stringify({ tokens: { access_token: 'fixture', refresh_token: 'fixture', id_token: 'fixture' } }))
  saveConnection(root, config, 'chatgpt-subscription')
  const env = resolveModelConnection(root, config, { OPENAI_API_KEY: 'platform', OPENAI_BASE_URL: config.baseUrl })
  expect(env.OPENAI_AUTH_MODE).toBe('chatgpt')
  expect(env.OPENAI_API_KEY).toBe('')
  expect(env.OPENAI_BASE_URL).toBe('')
  expect(() => resolveModelConnection(root, { ...config, published: false }, {})).toThrow()
  disconnectAccount(root, 'chatgpt')
  expect(() => resolveModelConnection(root, config, { OPENAI_API_KEY: 'platform' })).toThrow('disconnected')
})

test('independent ChatGPT subscription uses account credentials without a published model', async () => {
  mkdirSync(join(root, '.runtime/app/bgs'), { recursive: true })
  writeFileSync(join(root, '.runtime/app/bgs/auth.json'), JSON.stringify({ tokens: { access_token: 'fixture', refresh_token: 'fixture', id_token: 'fixture' } }))
  const config = personalModelConfig(root, 'alice', PERSONAL_CHATGPT_ID)!
  saveConnection(root, config, 'chatgpt-subscription', undefined, true)
  expect(personalModelAvailable(root, 'alice', PERSONAL_CHATGPT_ID)).toBe(true)
  const repository = new DashboardRepository({ dashboardDataRoot: root, getUserDataRoot: () => root, skillsConfig: false })
  const env = await repository.getRuntimeEnv(root, 'alice', undefined, PERSONAL_CHATGPT_ID)
  expect(env).toMatchObject({ OPENAI_AUTH_MODE: 'chatgpt', OPENAI_API_KEY: '', OPENAI_BASE_URL: '', BGS_MODEL_AUTH_METHOD: 'chatgpt-subscription' })
  disconnectAccount(root, 'chatgpt')
  expect(personalModelAvailable(root, 'alice', PERSONAL_CHATGPT_ID)).toBe(false)
  await expect(repository.getRuntimeEnv(root, 'alice', undefined, PERSONAL_CHATGPT_ID)).rejects.toThrow('disconnected')
})

test('ordinary users receive published models but cannot change the catalog or another user connection', async () => {
  const config = model()
  createModelConfig('owner', { name: 'Private', provider: 'gemini', apiKey: 'private', models: {}, published: false })
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({ dashboardDataRoot: root, skillsConfig: false, modelConfigStore: false,
    currentUserResolver: async request => ({ id: request.headers.get('x-fixture-user') ?? 'alice', role: 'viewer', modelConfigOwnerId: 'owner' }),
    outboundTargetResolver: async value => ({ url: new URL(value), addresses: ['93.184.216.34'], lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4) }),
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    const catalogResponse = await app.request('/api/model-catalog')
    expect(catalogResponse.headers.get('Cache-Control')).toBe('no-store')
    const catalog = await catalogResponse.json()
    expect(catalog).toHaveLength(4)
    expect(catalog.map((item: { id: string }) => item.id)).toContain('personal-byok')
    expect(catalog[0].apiKeyPreview).toBe('')
    expect(JSON.stringify(catalog)).not.toContain('platform-fixture-secret')
    expect((await app.request('/api/model-configs')).status).toBe(403)
    expect((await app.request(`/api/model-configs/${config.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'unauthorized' }), headers: { 'content-type': 'application/json' } })).status).toBe(403)
    expect((await app.request(`/api/model-connections/${config.id}`, { method: 'PUT', body: JSON.stringify({ method: 'byok', apiKey: 'alice-key', baseUrl: 'https://alice.example/v1', models: { fast: 'a-fast', balanced: 'a-balanced', strong: 'a-strong' }, preferred: true }), headers: { 'content-type': 'application/json' } })).status).toBe(200)
    expect(connectionStatus(getUserDashboardDataRoot(root, 'alice'), config)).toMatchObject({ hasKey: true, baseUrl: 'https://alice.example/v1', models: { fast: 'a-fast', balanced: 'a-balanced', strong: 'a-strong' } })
    const personalBody = { method: 'byok', provider: 'openai-compatible', apiKey: 'alice-personal-key', baseUrl: 'https://alice.example/v1', models: { fast: 'g-fast', balanced: 'g-balanced', strong: 'g-strong' }, preferred: true }
    expect((await app.request(`/api/model-connections/${PERSONAL_BYOK_ID}`, { method: 'PUT', body: JSON.stringify({ ...personalBody, provider: 'invalid' }), headers: { 'content-type': 'application/json' } })).status).toBe(400)
    expect((await app.request(`/api/model-connections/${PERSONAL_BYOK_ID}`, { method: 'PUT', body: JSON.stringify(personalBody), headers: { 'content-type': 'application/json' } })).status).toBe(200)
    expect(preferredModelId(getUserDashboardDataRoot(root, 'alice'))).toBe(PERSONAL_BYOK_ID)
    expect(personalModelConfig(getUserDashboardDataRoot(root, 'alice'), 'alice', PERSONAL_BYOK_ID)?.provider).toBe('openai-compatible')
    const bob = await (await app.request('/api/model-catalog', { headers: { 'x-fixture-user': 'bob' } })).json()
    expect(bob[0].connection.hasKey).toBe(false)
    expect(bob.find((item: { id: string }) => item.id === PERSONAL_BYOK_ID).connection.hasKey).toBe(false)
    expect((await app.request('/api/model-connections/foreign', { method: 'PUT', body: JSON.stringify({ method: 'platform' }), headers: { 'content-type': 'application/json' } })).status).toBe(404)
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

test('the real repository replaces remote platform credentials with the authenticated user connection', async () => {
  const config = model()
  const userRoot = join(root, 'alice')
  saveConnection(userRoot, config, 'byok', 'alice-runtime-key', true)
  const row = { id: config.id, owner_id: 'owner', name: config.name, provider: config.provider, models: config.models,
    auth_methods: config.authMethods, published: true, base_url: null, api_key_ciphertext: encryptSecret('platform-key', 'model-config:api-key'), is_default: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  const repository = new DashboardRepository({ dashboardDataRoot: root, getUserDataRoot: () => userRoot, skillsConfig: false,
    supabaseStore: new SupabaseDashboardStore({ url: 'https://fixture.supabase.co', anonKey: 'fixture', authToken: 'alice-token', fetchImpl: (async input => Response.json(String(input).includes('beegame_model_configs') ? [row] : [])) as typeof fetch }),
    supabaseRuntimeEnvClient: new SupabaseRuntimeEnvClient({ url: 'https://fixture.supabase.co', anonKey: 'fixture', fetchImpl: Object.assign(async () => Response.json({ env: { OPENAI_API_KEY: 'platform-key', BEEGAME_CONFIG_DIR: '/wrong-root' } }), { preconnect: () => {} }) }),
  })
  const env = await repository.getRuntimeEnv(userRoot, 'alice', 'alice-token', config.id)
  expect(env.OPENAI_API_KEY).toBe('alice-runtime-key')
  expect(env.BEEGAME_CONFIG_DIR).toBe(join(userRoot, '.runtime/app'))
  expect(env.BGS_MODEL_AUTH_METHOD).toBe('byok')
  expect(env.BEEGAME_MODEL_TYPE).toBe('openai')
})

test('administrator can publish a subscription-only model without a platform API key', async () => {
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({ dashboardDataRoot: root, modelConfigStore: false, skillsConfig: false,
    currentUser: { id: 'owner', role: 'owner' }, registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    const response = await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'My Bgs', provider: 'openai-compatible', authMethods: ['chatgpt-subscription'], published: true, models: { balanced: 'model-fixture' } }) })
    expect(response.status).toBe(200)
    const config = await response.json()
    expect(config).toMatchObject({ apiKeyPreview: '', authMethods: ['chatgpt-subscription'], published: true })
    expect((await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Invalid', provider: 'gemini', authMethods: ['chatgpt-subscription'], models: {} }) })).status).toBe(400)
    const hidden = await app.request(`/api/model-configs/${config.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ published: false }) })
    expect(hidden.status).toBe(200)
    expect((await (await app.request('/api/model-catalog')).json()).map((item: { id: string }) => item.id)).toEqual(['personal-byok', 'personal-chatgpt-subscription',OPENCODE_GO_ID])
    expect(await (await app.request('/api/model-configs')).json()).toHaveLength(1)
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

for (const provider of ['anthropic-compatible', 'openai-compatible'] as const) {
  test(`administrators can publish and edit a platform Go ${provider} model through the existing catalog`, async () => {
    const cleanups: Array<() => void> = []
    const app = createAgentWorkflowApp({ dashboardDataRoot: root, modelConfigStore: false, skillsConfig: false,
      currentUser: { id: 'owner', role: 'owner' }, registerCleanup: cleanup => cleanups.push(cleanup),
      outboundTargetResolver: async value => ({ url: new URL(value), addresses: ['93.184.216.34'], lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4) }),
    })
    const profile = OPENCODE_GO_PROFILES[provider]
    const body = { name: 'Platform Go', provider, baseUrl: profile.baseUrl, apiKey: 'platform-go-fixture-key', models: profile.defaults,
      published: true, authMethods: ['platform'], isDefault: true }
    const post = (input: object) => app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
    try {
      for (const invalid of [{ provider: provider === 'openai-compatible' ? 'anthropic-compatible' : 'openai-compatible' },
        { models: { ...profile.defaults, balanced: 'unsupported-model' } }, { models: { balanced: profile.defaults.balanced } },
        { authMethods: [provider === 'openai-compatible' ? 'chatgpt-subscription' : 'claude-subscription'] }]) {
        expect((await post({ ...body, ...invalid })).status).toBe(400)
      }
      const response = await post(body)
      expect(response.status).toBe(200)
      const saved = await response.json()
      expect(saved).toMatchObject({ provider, baseUrl: profile.baseUrl, models: profile.defaults, authMethods: ['platform'] })
      expect(JSON.stringify(saved)).not.toContain(body.apiKey)
      expect((await (await app.request('/api/model-catalog')).json()).some((item: { id: string }) => item.id === saved.id)).toBe(true)
      const patch = (input: object) => app.request(`/api/model-configs/${saved.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      expect((await patch({ models: { ...profile.defaults, fast: 'unsupported-model' } })).status).toBe(400)
      expect((await patch({ published: false })).status).toBe(200)
      expect((await patch({ published: true })).status).toBe(200)
      const runtime = mapModelConfigToRuntime(saved.id)!
      const env = resolveModelConnection(root, saved, runtime.env)
      expect(env[provider === 'anthropic-compatible' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY']).toBe(body.apiKey)
      expect(env[provider === 'anthropic-compatible' ? 'ANTHROPIC_BASE_URL' : 'OPENAI_BASE_URL']).toBe(profile.baseUrl)
    } finally { cleanups.forEach(cleanup => cleanup()) }
  })

  test(`OpenCode Go ${provider} is encrypted, isolated, selectable and routed through the existing runtime`, async () => {
    const profile = OPENCODE_GO_PROFILES[provider]
    const config = personalModelConfig(root, 'alice', OPENCODE_GO_ID, provider)!
    expect(personalModelAvailable(root, 'alice', OPENCODE_GO_ID)).toBe(false)
    saveConnection(root, config, 'byok', 'go-fixture-secret', true, { models: profile.defaults })
    expect(readFileSync(join(root, '.runtime/model-connections.json'), 'utf8')).not.toContain('go-fixture-secret')
    expect(personalModelAvailable(root, 'alice', OPENCODE_GO_ID)).toBe(true)
    expect(personalModelAvailable(join(root, 'bob'), 'bob', OPENCODE_GO_ID)).toBe(false)
    const repository = new DashboardRepository({ dashboardDataRoot: root, getUserDataRoot: () => root, skillsConfig: false })
    const env = await repository.getRuntimeEnv(root, 'alice', undefined, OPENCODE_GO_ID)
    const prefix = provider === 'anthropic-compatible' ? 'ANTHROPIC' : 'OPENAI'
    expect(env?.[`${prefix}_BASE_URL`]).toBe(profile.baseUrl)
    expect(env?.[provider === 'anthropic-compatible' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY']).toBe('go-fixture-secret')
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBe('')
    expect(env?.['BGS_DEFAULT_STRONG_MODEL']).toBe(profile.defaults.strong)
    expect(env?.OPENAI_AUTH_MODE).toBe('')
    const request = new Request('http://localhost/api/model-configs')
    const catalog = await repository.listModelConfigs(request, { id: 'alice', role: 'viewer' })
    expect(catalog.find(item => item.id === OPENCODE_GO_ID)?.isDefault).toBe(true)
    disconnectConnection(root, OPENCODE_GO_ID)
    expect(personalModelAvailable(root, 'alice', OPENCODE_GO_ID)).toBe(false)
    expect(() => resolveModelConnection(root, config, { OPENAI_API_KEY: 'platform-secret' })).toThrow('disabled')
  })
}

test('Go routes reject unsupported protocols, models and endpoints and preserve an existing connection on failure', async () => {
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({ dashboardDataRoot: root, skillsConfig: false, modelConfigStore: false,
    currentUserResolver: async request => ({ id: request.headers.get('x-fixture-user') ?? 'alice', role: 'viewer' }),
    outboundTargetResolver: async value => ({ url: new URL(value), addresses: ['93.184.216.34'], lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4) }),
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const profile = OPENCODE_GO_PROFILES['openai-compatible']
  const body = { method: 'byok', provider: 'openai-compatible', apiKey: 'go-secret', baseUrl: profile.baseUrl, models: profile.defaults, preferred: true }
  const put = (input: object) => app.request(`/api/model-connections/${OPENCODE_GO_ID}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  try {
    expect((await put(body)).status).toBe(200)
    const userRoot = getUserDashboardDataRoot(root, 'alice')
    const before = readFileSync(join(userRoot, '.runtime/model-connections.json'), 'utf8')
    for (const invalid of [
      { provider: 'gemini' }, { method: 'platform' }, { method: 'chatgpt-subscription' },
      { baseUrl: 'https://evil.example/v1' },
      { models: { ...profile.defaults, fast: 'gpt-6-luna' } },
      { models: { ...profile.defaults, fast: 'minimax-m3' } },
      { models: { ...profile.defaults, fast: '' } },
    ]) {
      expect((await put({ ...body, ...invalid })).status).toBe(400)
      expect(readFileSync(join(userRoot, '.runtime/model-connections.json'), 'utf8')).toBe(before)
    }
    const catalog = await (await app.request('/api/model-catalog')).json()
    expect(JSON.stringify(catalog)).not.toContain('go-secret')
    const bob = await (await app.request('/api/model-catalog', { headers: { 'x-fixture-user': 'bob' } })).json()
    expect(bob.find((item: { id: string }) => item.id === OPENCODE_GO_ID).connection.hasKey).toBe(false)
    // Same protocol can retain the key; switching endpoints requires entering it again.
    expect((await put({ ...body, apiKey: undefined })).status).toBe(200)
    const anthropic = OPENCODE_GO_PROFILES['anthropic-compatible']
    expect((await put({ ...body, apiKey: undefined, provider: 'anthropic-compatible', baseUrl: anthropic.baseUrl, models: anthropic.defaults })).status).toBe(400)
    expect((await put({ ...body, provider: 'anthropic-compatible', baseUrl: anthropic.baseUrl, models: anthropic.defaults })).status).toBe(200)
    expect(personalModelConfig(userRoot, 'alice', OPENCODE_GO_ID)?.provider).toBe('anthropic-compatible')
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

test('Go save identifies deployment outbound policy rejection without persisting or exposing the key', async () => {
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({ dashboardDataRoot: root, skillsConfig: false, modelConfigStore: false,
    currentUserResolver: async () => ({ id: 'alice', role: 'viewer' }),
    outboundTargetPolicyOptions: { allowedHosts: ['dashscope.aliyuncs.com'] },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    const profile = OPENCODE_GO_PROFILES['openai-compatible']
    const response = await app.request(`/api/model-connections/${OPENCODE_GO_ID}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'byok', provider: 'openai-compatible', apiKey: 'never-persist-this-key', baseUrl: profile.baseUrl, models: profile.defaults, preferred: true }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Model provider endpoint is blocked by the deployment outbound policy. Check the host allowlist and DNS configuration.' })
    expect(existsSync(join(getUserDashboardDataRoot(root, 'alice'), '.runtime/model-connections.json'))).toBe(false)
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

test('dynamic Go catalog and personal saves accept newly listed IDs while failures preserve saved configuration', async () => {
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({ dashboardDataRoot: root, skillsConfig: false, modelConfigStore: false,
    currentUser: { id: 'alice', role: 'viewer' },
    outboundTargetResolver: async value => ({ url: new URL(value), addresses: ['93.184.216.34'], lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4) }),
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    const response = await app.request('/api/model-catalog/opencode-go')
    expect(response.status).toBe(200)
    const catalog = await response.json()
    expect(catalog['openai-compatible']).toContain('new-chat-model')
    expect(catalog['anthropic-compatible']).toContain('new-anthropic-model')
    expect(catalog['openai-compatible']).not.toContain('gpt-6-luna')
    const body = { method: 'byok', provider: 'openai-compatible', baseUrl: OPENCODE_GO_PROFILES['openai-compatible'].baseUrl,
      apiKey: 'catalog-fixture-key', models: { fast: 'new-chat-model', balanced: 'new-chat-model', strong: 'new-chat-model' } }
    const put = () => app.request(`/api/model-connections/${OPENCODE_GO_ID}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await put()).status).toBe(200)
    const path = join(getUserDashboardDataRoot(root, 'alice'), '.runtime/model-connections.json')
    const before = readFileSync(path, 'utf8')
    const catalogFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => String(input) === 'https://opencode.ai/inference/go/v1/models'
      ? Response.json({}, { status: 503 }) : catalogFetch(input, init)) as typeof fetch
    expect((await app.request('/api/model-catalog/opencode-go')).status).toBe(502)
    expect((await put()).status).toBe(400)
    expect(readFileSync(path, 'utf8')).toBe(before)
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

for (const provider of ['anthropic-compatible', 'openai-compatible'] as const) {
  test(`previous Go ${provider} connections resolve the corrected Zen route and keep their encrypted key`, () => {
    const config = personalModelConfig(root, 'alice', OPENCODE_GO_ID, provider)!
    saveConnection(root, config, 'byok', 'existing-go-key', true, { models: OPENCODE_GO_PROFILES[provider].defaults })
    const path = join(root, '.runtime/model-connections.json')
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    const go = saved.connections[OPENCODE_GO_ID]
    const encryptedKey = go.secret
    go.baseUrl = provider === 'anthropic-compatible' ? 'https://opencode.ai/inference/go/anthropic' : 'https://opencode.ai/inference/go/openai/v1'
    go.endpoint = createHash('sha256').update(`${provider}\n${go.baseUrl}`).digest('hex')
    writeFileSync(path, JSON.stringify(saved))
    const loaded = personalModelConfig(root, 'alice', OPENCODE_GO_ID)!
    const baseUrl = OPENCODE_GO_PROFILES[provider].baseUrl
    expect(connectionStatus(root, loaded)).toMatchObject({ hasKey: true, baseUrl })
    const env = resolveModelConnection(root, loaded, {})
    expect(env[provider === 'anthropic-compatible' ? 'ANTHROPIC_BASE_URL' : 'OPENAI_BASE_URL']).toBe(baseUrl)
    expect(env[provider === 'anthropic-compatible' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY']).toBe('existing-go-key')
    saveConnection(root, loaded, 'byok', undefined, true, { models: loaded.models })
    const updated = JSON.parse(readFileSync(path, 'utf8')).connections[OPENCODE_GO_ID]
    expect(updated.baseUrl).toBe(baseUrl)
    expect(updated.secret).toBe(encryptedKey)
    // The compatibility correction must not make an unbound key usable.
    go.endpoint = 'invalid-binding'
    writeFileSync(path, JSON.stringify(saved))
    expect(() => resolveModelConnection(root, personalModelConfig(root, 'alice', OPENCODE_GO_ID)!, {})).toThrow('disconnected')
  })
}
