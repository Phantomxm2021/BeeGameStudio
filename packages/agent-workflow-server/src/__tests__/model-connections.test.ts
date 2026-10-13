import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createModelConfig, exportModelConfigSnapshot, importModelConfigSnapshot, resetModelConfigs, validateModelAccess } from '@bee-game-studio/agent-workflow'
import { connectionStatus, disconnectAccount, disconnectConnection, ModelConnectionLogins, PERSONAL_BYOK_ID, PERSONAL_CHATGPT_ID, personalModelAvailable, personalModelConfig, preferredModelId, resolveModelConnection, saveConnection } from '../model-connections'
import { mergeRuntimeEnv } from '../beegame/session-manager'
import { createAgentWorkflowApp } from '../app'
import { getUserDashboardDataRoot } from '../local-runtime-service'
import { DashboardRepository } from '../dashboard-repository'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'
import { SupabaseRuntimeEnvClient } from '../supabase-runtime-env-client'
import { encryptSecret } from '../security/secret-crypto'
import axios from 'axios'

let root: string
let previousKey: string | undefined
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bgs-connections-'))
  previousKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64')
  resetModelConfigs()
})
afterEach(() => {
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
  expect(env).toMatchObject({ OPENAI_BASE_URL: 'https://personal.example/v1', OPENAI_API_KEY: 'personal-fixture-secret', OPENAI_DEFAULT_HAIKU_MODEL: 'fast-personal', OPENAI_DEFAULT_SONNET_MODEL: 'balanced-personal', OPENAI_DEFAULT_OPUS_MODEL: 'strong-personal' })
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
  const config = personalModelConfig(alice, 'alice', PERSONAL_BYOK_ID, 'gemini')!
  saveConnection(alice, config, 'byok', 'alice-personal-key', true, { baseUrl: 'https://personal.example/v1', models: { fast: 'f', balanced: 'b', strong: 's' } })
  expect(personalModelAvailable(alice, 'alice', PERSONAL_BYOK_ID)).toBe(true)
  expect(personalModelAvailable(bob, 'bob', PERSONAL_BYOK_ID)).toBe(false)
  const repository = new DashboardRepository({ dashboardDataRoot: root, getUserDataRoot: () => alice, skillsConfig: false })
  const env = await repository.getRuntimeEnv(alice, 'alice', undefined, PERSONAL_BYOK_ID)
  expect(env).toMatchObject({ GEMINI_API_KEY: 'alice-personal-key', GEMINI_BASE_URL: 'https://personal.example/v1', GEMINI_DEFAULT_HAIKU_MODEL: 'f', GEMINI_DEFAULT_SONNET_MODEL: 'b', GEMINI_DEFAULT_OPUS_MODEL: 's' })
  expect(env.OPENAI_API_KEY).toBe('')
  expect(() => saveConnection(alice, personalModelConfig(alice, 'alice', PERSONAL_BYOK_ID, 'openai-compatible')!, 'byok', undefined, true, { baseUrl: 'https://personal.example/v1', models: { fast: 'f', balanced: 'b', strong: 's' } })).toThrow('API key')
})

test('subscription runtime excludes API keys and custom endpoints; logout fails closed', () => {
  const config = { ...model(), baseUrl: 'https://custom.example/v1' }
  expect(() => saveConnection(root, config, 'chatgpt-subscription')).toThrow('Connect')
  mkdirSync(join(root, '.runtime/app'), { recursive: true })
  writeFileSync(join(root, '.runtime/app/openai-chatgpt-auth.json'), JSON.stringify({ tokens: { access_token: 'fixture', refresh_token: 'fixture', id_token: 'fixture' } }))
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
  mkdirSync(join(root, '.runtime/app'), { recursive: true })
  writeFileSync(join(root, '.runtime/app/openai-chatgpt-auth.json'), JSON.stringify({ tokens: { access_token: 'fixture', refresh_token: 'fixture', id_token: 'fixture' } }))
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
    const personalBody = { method: 'byok', provider: 'gemini', apiKey: 'alice-personal-key', baseUrl: 'https://alice.example/v1', models: { fast: 'g-fast', balanced: 'g-balanced', strong: 'g-strong' }, preferred: true }
    expect((await app.request(`/api/model-connections/${PERSONAL_BYOK_ID}`, { method: 'PUT', body: JSON.stringify({ ...personalBody, provider: 'invalid' }), headers: { 'content-type': 'application/json' } })).status).toBe(400)
    expect((await app.request(`/api/model-connections/${PERSONAL_BYOK_ID}`, { method: 'PUT', body: JSON.stringify(personalBody), headers: { 'content-type': 'application/json' } })).status).toBe(200)
    expect(preferredModelId(getUserDashboardDataRoot(root, 'alice'))).toBe(PERSONAL_BYOK_ID)
    expect(personalModelConfig(getUserDashboardDataRoot(root, 'alice'), 'alice', PERSONAL_BYOK_ID)?.provider).toBe('gemini')
    const bob = await (await app.request('/api/model-catalog', { headers: { 'x-fixture-user': 'bob' } })).json()
    expect(bob[0].connection.hasKey).toBe(false)
    expect(bob.find((item: { id: string }) => item.id === PERSONAL_BYOK_ID).connection.hasKey).toBe(false)
    expect((await app.request('/api/model-connections/foreign', { method: 'PUT', body: JSON.stringify({ method: 'platform' }), headers: { 'content-type': 'application/json' } })).status).toBe(404)
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

test('Claude OAuth exposes only a PKCE URL and rejects wrong owner, state and cancelled flows without network exchange', async () => {
  const config = createModelConfig('owner', { name: 'Claude', provider: 'anthropic-compatible', apiKey: '', models: { balanced: 'claude-model' }, authMethods: ['claude-subscription'] })
  const logins = new ModelConnectionLogins()
  try {
    const login = await logins.start('alice', root, config, 'claude-subscription')
    const url = new URL(login.url)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.has('code_verifier')).toBe(false)
    expect(() => logins.status(login.id, 'bob')).toThrow()
    await expect(logins.complete(login.id, 'alice', 'code#wrong-state')).rejects.toThrow('code#state')
    logins.cancel(login.id, 'alice')
    await expect(logins.complete(login.id, 'alice', `code#${url.searchParams.get('state')}`)).rejects.toThrow('expired')
  } finally { logins.dispose() }
})

test('ChatGPT device login uses existing CLI protocol but persists only into the selected user root', async () => {
  const previousFetch = globalThis.fetch
  const logins = new ModelConnectionLogins()
  const calls: string[] = []
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input); calls.push(url)
    if (url.endsWith('/usercode')) return Response.json({ device_auth_id: 'fixture-device', user_code: 'fixture-code', interval: 1 })
    if (url.endsWith('/deviceauth/token')) return Response.json({ authorization_code: 'fixture-code', code_verifier: 'fixture-verifier' })
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'fixture-access', id_token: 'fixture-id', refresh_token: 'fixture-refresh' })
    throw new Error('Unexpected network request')
  }) as typeof fetch
  try {
    const config = model()
    const login = await logins.start('alice', join(root, 'alice'), config, 'chatgpt-subscription')
    expect(login).toMatchObject({ userCode: 'fixture-code', url: 'https://auth.openai.com/codex/device' })
    for (let i = 0; i < 20 && logins.status(login.id, 'alice').status === 'pending'; i++) await new Promise(resolve => setTimeout(resolve, 5))
    expect(logins.status(login.id, 'alice').status).toBe('complete')
    expect(() => logins.status(login.id, 'bob')).toThrow()
    expect(connectionStatus(join(root, 'alice'), config).chatgptConnected).toBe(true)
    expect(connectionStatus(join(root, 'bob'), config).chatgptConnected).toBe(false)
    expect(calls).toHaveLength(3)
    expect(JSON.stringify(login)).not.toContain('fixture-refresh')
  } finally { logins.dispose(); globalThis.fetch = previousFetch }
})

test('BGS cannot borrow the host Codex account when the user has no ChatGPT login', async () => {
  const client = await import('../../../../src/services/api/openai/chatgptAuth')
  const previous = { BEEGAME_CONFIG_DIR: process.env.BEEGAME_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME, BGS_SUBPROCESS_ENV_SCRUB: process.env.BGS_SUBPROCESS_ENV_SCRUB }
  const host = join(root, 'host-codex')
  mkdirSync(host)
  writeFileSync(join(host, 'auth.json'), JSON.stringify({ tokens: { id_token: 'host-id', access_token: 'host-access', refresh_token: 'host-refresh' } }))
  try {
    process.env.BEEGAME_CONFIG_DIR = join(root, 'user')
    process.env.CODEX_HOME = host
    process.env.BGS_SUBPROCESS_ENV_SCRUB = '1'
    await expect(client.getValidChatGPTAuth()).rejects.toThrow('not logged in')
    expect(existsSync(join(root, 'user/openai-chatgpt-auth.json'))).toBe(false)
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
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
    const response = await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'My Claude', provider: 'anthropic-compatible', authMethods: ['claude-subscription'], published: true, models: { balanced: 'claude-fixture' } }) })
    expect(response.status).toBe(200)
    const config = await response.json()
    expect(config).toMatchObject({ apiKeyPreview: '', authMethods: ['claude-subscription'], published: true })
    expect((await app.request('/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Invalid', provider: 'gemini', authMethods: ['claude-subscription'], models: {} }) })).status).toBe(400)
    const hidden = await app.request(`/api/model-configs/${config.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ published: false }) })
    expect(hidden.status).toBe(200)
    expect((await (await app.request('/api/model-catalog')).json()).map((item: { id: string }) => item.id)).toEqual(['personal-byok', 'personal-claude-subscription', 'personal-chatgpt-subscription'])
    expect(await (await app.request('/api/model-configs')).json()).toHaveLength(1)
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

test('Claude code callback produces refreshable credentials consumed by the isolated native CLI store', async () => {
  const originalAdapter = axios.defaults.adapter
  const previous = { BEEGAME_CONFIG_DIR: process.env.BEEGAME_CONFIG_DIR, BGS_MODEL_CONNECTION_RESOLVED: process.env.BGS_MODEL_CONNECTION_RESOLVED }
  const logins = new ModelConnectionLogins()
  let exchangeBody: Record<string, unknown> | undefined
  axios.defaults.adapter = async config => {
    const data = String(config.url).endsWith('/api/oauth/profile')
      ? { organization: { organization_type: 'claude_pro', rate_limit_tier: 'fixture-tier' } }
      : { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'user:inference user:profile' }
    if (!String(config.url).endsWith('/api/oauth/profile')) exchangeBody = JSON.parse(String(config.data))
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
  try {
    const config = createModelConfig('owner', { name: 'Claude', provider: 'anthropic-compatible', apiKey: '', models: {}, authMethods: ['claude-subscription'] })
    const login = await logins.start('alice', root, config, 'claude-subscription')
    const state = new URL(login.url).searchParams.get('state')!
    expect(await logins.complete(login.id, 'alice', `fixture-code#${state}`)).toEqual({ status: 'complete' })
    expect(exchangeBody).toMatchObject({ code: 'fixture-code', state, grant_type: 'authorization_code' })
    expect(typeof exchangeBody?.code_verifier).toBe('string')
    process.env.BEEGAME_CONFIG_DIR = join(root, '.runtime/app')
    process.env.BGS_MODEL_CONNECTION_RESOLVED = '1'
    const { getSecureStorage } = await import('../../../../src/utils/secureStorage')
    expect(getSecureStorage().name).toBe('plaintext')
    expect(getSecureStorage().read()?.claudeAiOauth).toMatchObject({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', subscriptionType: 'pro', scopes: ['user:inference', 'user:profile'] })
    expect(connectionStatus(root, config).claudeConnected).toBe(true)
    await expect(logins.complete(login.id, 'alice', `fixture-code#${state}`)).rejects.toThrow('No pending')
  } finally {
    logins.dispose(); axios.defaults.adapter = originalAdapter
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
