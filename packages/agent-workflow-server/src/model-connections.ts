import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mapStoredModelConfigToRuntime, validateModelAccess, type ModelAuthMethod, type ModelProviderKind, type ModelTierMap, type PublicModelConfig } from '@bee-game-studio/agent-workflow'
import { OPENCODE_GO_ID, OPENCODE_GO_PROFILES, isOpenCodeGoProvider, validateOpenCodeGoConfig } from '@bee-game-studio/agent-workflow/opencode-go'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../../src/constants/oauth'
import { decryptSecret, encryptSecret } from './security/secret-crypto'

type Connection = { method: ModelAuthMethod; provider?: ModelProviderKind; secret?: string; endpoint?: string; baseUrl?: string; models?: ModelTierMap; disabled?: boolean }
type Connections = { defaultModelId?: string; connections: Record<string, Connection> }

export const PERSONAL_BYOK_ID = 'personal-byok'
export const PERSONAL_CLAUDE_ID = 'personal-claude-subscription'
export const PERSONAL_CHATGPT_ID = 'personal-chatgpt-subscription'
export function isPersonalModelId(id: string) { return id === PERSONAL_BYOK_ID || id === PERSONAL_CLAUDE_ID || id === PERSONAL_CHATGPT_ID || id === OPENCODE_GO_ID }
export function personalModelConfig(root: string, ownerId: string, id: string, providerOverride?: ModelProviderKind): PublicModelConfig | undefined {
  if (!isPersonalModelId(id)) return undefined
  const connection = read(root).connections[id]
  const method = (id === PERSONAL_BYOK_ID || id === OPENCODE_GO_ID) ? 'byok' : id === PERSONAL_CLAUDE_ID ? 'claude-subscription' : 'chatgpt-subscription'
  const provider = method === 'byok' ? providerOverride ?? connection?.provider ?? 'anthropic-compatible' : method === 'claude-subscription' ? 'anthropic-compatible' : 'openai-compatible'
  if (id === OPENCODE_GO_ID && !isOpenCodeGoProvider(provider)) throw new Error('Unsupported OpenCode Go protocol')
  const go = id === OPENCODE_GO_ID ? OPENCODE_GO_PROFILES[provider as keyof typeof OPENCODE_GO_PROFILES] : undefined
  const now = new Date(0)
  return { id, ownerId, name: go ? 'OpenCode Go' : method === 'byok' ? 'BYOK' : method === 'claude-subscription' ? 'Claude subscription' : 'ChatGPT subscription', provider,
    published: true, authMethods: [method], ...(go ? { baseUrl: go.baseUrl } : connection?.baseUrl ? { baseUrl: connection.baseUrl } : {}), models: connection?.models ?? go?.defaults ?? {},
    apiKeyPreview: '', isDefault: preferredModelId(root) === id, createdAt: now, updatedAt: now }
}
export function personalModelAvailable(root: string, ownerId: string, id: string) {
  const config = personalModelConfig(root, ownerId, id)
  if (!config) return false
  const status = connectionStatus(root, config)
  return !status.disabled && status.method === config.authMethods?.[0] && ((id === PERSONAL_BYOK_ID || id === OPENCODE_GO_ID) ? status.hasKey && !!config.models.fast && !!config.models.balanced && !!config.models.strong : id === PERSONAL_CLAUDE_ID ? status.claudeConnected : status.chatgptConnected)
}

// This lives in the authenticated user's existing runtime data root, never a project.
function file(root: string) { return join(root, '.runtime', 'model-connections.json') }
function read(root: string): Connections {
  const path = file(root)
  if (!existsSync(path)) return { connections: {} }
  const state = JSON.parse(readFileSync(path, 'utf8')) as Connections
  const go = state.connections[OPENCODE_GO_ID]
  // Correct connections saved by the initial Go integration, preserving their
  // encrypted key only when it is bound to that exact previous official route.
  if (go?.method === 'byok' && isOpenCodeGoProvider(go.provider)) {
    const previousUrl = go.provider === 'anthropic-compatible'
      ? 'https://opencode.ai/inference/go/anthropic'
      : 'https://opencode.ai/inference/go/openai/v1'
    if (go.baseUrl === previousUrl && go.endpoint === endpoint({ provider: go.provider, baseUrl: previousUrl })) {
      go.baseUrl = OPENCODE_GO_PROFILES[go.provider].baseUrl
      go.endpoint = endpoint({ provider: go.provider, baseUrl: go.baseUrl })
    }
  }
  return state
}
function writePrivate(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
  renameSync(temp, path)
}
export function preferredModelId(root: string) { return read(root).defaultModelId }
function endpoint(config: Pick<PublicModelConfig, 'provider' | 'baseUrl'>, baseUrl = config.baseUrl) { return createHash('sha256').update(`${config.provider}\n${baseUrl ?? ''}`).digest('hex') }
function validateByokUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS endpoint without embedded credentials or fragments')
  return url.toString().replace(/\/$/, '')
}
function validateByokModels(models: ModelTierMap): ModelTierMap {
  if (['fast', 'balanced', 'strong'].some(tier => !models[tier as keyof ModelTierMap]?.trim())) throw new Error('Enter all three model tiers')
  return { fast: models.fast!.trim(), balanced: models.balanced!.trim(), strong: models.strong!.trim() }
}
function hasAccount(root: string, provider: 'claude' | 'chatgpt') {
  try {
    const value = JSON.parse(readFileSync(join(root, '.runtime/app', provider === 'claude' ? '.credentials.json' : 'openai-chatgpt-auth.json'), 'utf8'))
    const tokens = provider === 'claude' ? value.claudeAiOauth : value.tokens
    return provider === 'claude' ? Boolean(tokens?.accessToken && tokens?.refreshToken) : Boolean(tokens?.access_token && tokens?.refresh_token && tokens?.id_token)
  } catch { return false }
}
export function connectionStatus(root: string, config: PublicModelConfig) {
  const state = read(root)
  const connection = state.connections[config.id]
  return { method: connection?.method ?? 'platform', hasKey: !!connection?.secret && connection.endpoint === endpoint(config, connection.baseUrl), disabled: connection?.disabled === true,
    isPreferred: state.defaultModelId === config.id,
    ...(connection?.secret ? { baseUrl: connection.baseUrl ?? config.baseUrl, models: connection.models ?? config.models } : {}),
    claudeConnected: hasAccount(root, 'claude'),
    chatgptConnected: hasAccount(root, 'chatgpt') }
}

export type ClaudeSubscriptionUsage = { fiveHourUsedPercent?: number; sevenDayUsedPercent?: number }

/** Read the authenticated user's Claude subscription usage without exposing their token. */
export async function fetchClaudeSubscriptionUsage(root: string, fetchImpl: typeof fetch = fetch): Promise<ClaudeSubscriptionUsage | null> {
  let token: string | undefined
  let expiresAt: number | undefined
  try {
    const stored = JSON.parse(readFileSync(join(root, '.runtime/app/.credentials.json'), 'utf8'))
    token = stored.claudeAiOauth?.accessToken
    expiresAt = stored.claudeAiOauth?.expiresAt
  } catch { return null }
  if (!token || (typeof expiresAt === 'number' && expiresAt <= Date.now())) return null

  const response = await fetchImpl(`${getOauthConfig().BASE_API_URL}/api/oauth/usage`, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': OAUTH_BETA_HEADER },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('Claude subscription usage is unavailable')
  const value = await response.json() as Record<string, unknown>
  const percentage = (window: unknown): number | undefined => {
    if (!window || typeof window !== 'object') return undefined
    const used = (window as { utilization?: unknown }).utilization
    return typeof used === 'number' && Number.isFinite(used) && used >= 0 && used <= 100 ? used : undefined
  }
  const fiveHourUsedPercent = percentage(value.five_hour)
  const sevenDayUsedPercent = percentage(value.seven_day)
  if (fiveHourUsedPercent === undefined && sevenDayUsedPercent === undefined) return null
  return {
    ...(fiveHourUsedPercent !== undefined ? { fiveHourUsedPercent } : {}),
    ...(sevenDayUsedPercent !== undefined ? { sevenDayUsedPercent } : {}),
  }
}
export function saveConnection(root: string, config: PublicModelConfig, method: ModelAuthMethod, key?: string, preferred = false, byok?: { baseUrl?: string; models?: ModelTierMap }) {
  if (config.id === OPENCODE_GO_ID) {
    if (method !== 'byok' || !isOpenCodeGoProvider(config.provider)) throw new Error('OpenCode Go requires an API key and a supported protocol')
    const profile = OPENCODE_GO_PROFILES[config.provider]
    if (config.baseUrl !== profile.baseUrl || (byok?.baseUrl !== undefined && byok.baseUrl !== profile.baseUrl)) throw new Error('Use the official OpenCode Go endpoint')
    const models = validateByokModels(byok?.models ?? config.models)
    validateOpenCodeGoConfig({ provider: config.provider, baseUrl: profile.baseUrl, models, authMethods: ['byok'] })
    byok = { baseUrl: profile.baseUrl, models }
  }
  const allowed = validateModelAccess(config.provider, config.authMethods)
  if (config.published === false || !allowed.includes(method)) throw new Error('This model authentication method is not published')
  const state = read(root)
  const previous = state.connections[config.id]
  const baseUrl = method === 'byok' && byok?.baseUrl !== undefined ? validateByokUrl(byok.baseUrl.trim()) : previous?.baseUrl
  const models = method === 'byok' && byok?.models !== undefined ? validateByokModels(byok.models) : previous?.models
  const secret = method === 'byok'
    ? key?.trim() ? encryptSecret(key.trim(), `model-connection:${config.id}`) : previous?.endpoint === endpoint(config, baseUrl) ? previous.secret : undefined
    : previous?.secret
  if (method === 'byok' && !secret) throw new Error('Enter your API key')
  const status = connectionStatus(root, config)
  if (method === 'claude-subscription' && !status.claudeConnected) throw new Error('Connect your Claude account first')
  if (method === 'chatgpt-subscription' && !status.chatgptConnected) throw new Error('Connect your ChatGPT account first')
  state.connections[config.id] = { method, ...(method === 'byok' ? { provider: config.provider } : previous?.provider ? { provider: previous.provider } : {}), endpoint: method === 'byok' ? endpoint(config, baseUrl) : previous?.endpoint, ...(secret ? { secret } : {}), ...(baseUrl ? { baseUrl } : {}), ...(models ? { models } : {}) }
  if (preferred) state.defaultModelId = config.id
  else if (state.defaultModelId === config.id) delete state.defaultModelId
  writePrivate(file(root), state)
  return connectionStatus(root, config)
}
export function disconnectConnection(root: string, id: string) {
  const state = read(root)
  // Keep an explicit disconnected choice: never fall back to the paid platform key.
  state.connections[id] = { method: state.connections[id]?.method ?? 'platform', disabled: true }
  if (state.defaultModelId === id) delete state.defaultModelId
  writePrivate(file(root), state)
}
export function disconnectAccount(root: string, provider: 'claude' | 'chatgpt') {
  const path = join(root, '.runtime/app', provider === 'claude' ? '.credentials.json' : 'openai-chatgpt-auth.json')
  if (existsSync(path)) unlinkSync(path)
}

const AUTH_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_AUTH_MODE', 'GEMINI_API_KEY', 'GEMINI_BASE_URL', 'GROK_API_KEY', 'GROK_BASE_URL',
  'BGS_USE_OPENAI', 'BGS_USE_GEMINI', 'BGS_USE_GROK', 'BGS_USE_BEDROCK', 'BGS_USE_VERTEX', 'BGS_USE_FOUNDRY',
  'BGS_DEFAULT_FAST_MODEL', 'BGS_DEFAULT_BALANCED_MODEL', 'BGS_DEFAULT_STRONG_MODEL',
  ...['OPENAI', 'GEMINI', 'GROK'].flatMap(prefix => ['HAIKU', 'SONNET', 'OPUS'].map(tier => `${prefix}_DEFAULT_${tier}_MODEL`))]

export function resolveModelConnection(root: string, config: PublicModelConfig, platformEnv: Record<string, string>): Record<string, string> {
  const method = read(root).connections[config.id]?.method ?? 'platform'
  if (config.published === false || !validateModelAccess(config.provider, config.authMethods).includes(method)) {
    throw new Error('Select an available connection in Settings → Model connections')
  }
  const state = read(root).connections[config.id]
  if (state?.disabled) throw new Error('This model connection is disabled')
  let env: Record<string, string>
  if (method === 'platform') {
    if (!['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROK_API_KEY'].some(key => platformEnv[key])) {
      throw new Error('The published platform model has no API key')
    }
    env = platformEnv
  } else {
    const status = connectionStatus(root, config)
    if ((method === 'byok' && !status.hasKey) || (method === 'claude-subscription' && !status.claudeConnected) || (method === 'chatgpt-subscription' && !status.chatgptConnected)) {
      throw new Error('Your model connection is disconnected; reconnect in Settings')
    }
    env = mapStoredModelConfigToRuntime({ ...config,
      // Subscription credentials may only go to the CLI's official OAuth endpoints.
      baseUrl: method === 'byok' ? state?.baseUrl ?? config.baseUrl : undefined,
      apiKey: method === 'byok' ? decryptSecret(state!.secret!, `model-connection:${config.id}`) : '',
      models: method === 'byok' ? state?.models ?? config.models : config.models,
    }).env
    if (method === 'chatgpt-subscription') env.OPENAI_AUTH_MODE = 'chatgpt'
  }
  return { ...Object.fromEntries(AUTH_ENV.map(key => [key, ''])), ...env,
    BGS_MODEL_CONNECTION_RESOLVED: '1', BGS_MODEL_AUTH_METHOD: method,
    BEEGAME_MODEL_TYPE: config.provider === 'anthropic-compatible' ? 'anthropic' : config.provider === 'openai-compatible' ? 'openai' : config.provider }
}

type Pending = { owner: string; root: string; modelId: string; method: ModelAuthMethod;
  expires: number; verifier?: string; state?: string; timer?: ReturnType<typeof setTimeout>; abort: AbortController; status: 'pending' | 'complete' | 'failed' }

/** One short-lived login per user. No model inference, browser launching, or process.env mutation. */
export class ModelConnectionLogins {
  private pending = new Map<string, Pending>()
  constructor(private readonly beforeAccountChange: (owner: string) => void = () => {}) {}
  dispose() { for (const flow of this.pending.values()) { flow.abort.abort(); clearTimeout(flow.timer) } this.pending.clear() }
  private get(id: string, owner: string) {
    const flow = this.pending.get(id)
    if (!flow || flow.owner !== owner || flow.expires < Date.now()) throw new Error('Login expired; start again')
    return flow
  }
  status(id: string, owner: string) { return { status: this.get(id, owner).status } }
  cancel(id: string, owner: string) { const flow = this.get(id, owner); flow.abort.abort(); clearTimeout(flow.timer); this.pending.delete(id) }
  cancelOwner(owner: string) { for (const [id, flow] of this.pending) if (flow.owner === owner) { flow.abort.abort(); clearTimeout(flow.timer); this.pending.delete(id) } }
  async start(owner: string, root: string, config: PublicModelConfig, method: ModelAuthMethod) {
    if (!['claude-subscription', 'chatgpt-subscription'].includes(method) || config.published === false || !validateModelAccess(config.provider, config.authMethods).includes(method)) throw new Error('Subscription login is not available for this model')
    for (const [id, flow] of this.pending) if (flow.owner === owner || flow.expires < Date.now()) { flow.abort.abort(); clearTimeout(flow.timer); this.pending.delete(id) }
    const id = randomUUID()
    const flow: Pending = { owner, root, modelId: config.id, method, expires: Date.now() + 15 * 60_000, abort: new AbortController(), status: 'pending' }
    this.pending.set(id, flow)
    const timeout = setTimeout(() => { flow.abort.abort(); this.pending.delete(id) }, 15 * 60_000)
    flow.timer = timeout
    timeout.unref?.()
    if (method === 'claude-subscription') {
      const crypto = await import('../../../src/services/oauth/crypto')
      const client = await import('../../../src/services/oauth/client')
      flow.verifier = crypto.generateCodeVerifier(); flow.state = crypto.generateState()
      const url = client.buildAuthUrl({ codeChallenge: crypto.generateCodeChallenge(flow.verifier), state: flow.state, port: 0, isManual: true, loginWithClaudeAi: true })
      return { id, url, method }
    }
    const client = await import('../../../src/services/api/openai/chatgptAuth')
    const device = await client.requestChatGPTDeviceCode()
    // CLI handles device polling, token exchange and refresh-compatible persistence.
    void client.completeChatGPTDeviceLogin(device, flow.abort.signal, null)
      .then(tokens => {
        if (flow.abort.signal.aborted || flow.expires < Date.now()) return
        if (!tokens.accessToken || !tokens.refreshToken || !tokens.idToken) throw new Error('Login returned incomplete credentials')
        this.beforeAccountChange(owner)
        writePrivate(join(root, '.runtime/app/openai-chatgpt-auth.json'), { auth_mode: 'chatgpt', tokens: {
          id_token: tokens.idToken, access_token: tokens.accessToken, refresh_token: tokens.refreshToken, account_id: tokens.accountId,
        }, last_refresh: new Date().toISOString() })
        flow.status = 'complete'
      })
      .catch(() => { flow.status = 'failed' })
    return { id, url: device.verificationUrl, userCode: device.userCode, method }
  }
  async complete(id: string, owner: string, codeWithState: string) {
    const flow = this.get(id, owner)
    if (flow.method !== 'claude-subscription' || flow.status !== 'pending') throw new Error('No pending Claude login')
    const [code, state, extra] = codeWithState.trim().split('#')
    if (!code || state !== flow.state || extra !== undefined) throw new Error('Paste the complete code#state from the Claude login page')
    // Consume before awaiting, to prevent concurrent code exchange/replay.
    flow.status = 'failed'
    const client = await import('../../../src/services/oauth/client')
    const tokens = await client.exchangeCodeForTokens(code, state, flow.verifier!, 0, true)
    if (flow.abort.signal.aborted || flow.expires < Date.now()) throw new Error('Login cancelled or expired')
    if (!tokens.access_token || !tokens.refresh_token || !client.shouldUseClaudeAIAuth(client.parseScopes(tokens.scope))) throw new Error('Login did not return refreshable Claude inference credentials')
    const profile = await client.fetchProfileInfo(tokens.access_token)
    if (flow.abort.signal.aborted) throw new Error('Login cancelled')
    this.beforeAccountChange(owner)
    writePrivate(join(flow.root, '.runtime/app/.credentials.json'), { claudeAiOauth: {
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000, scopes: client.parseScopes(tokens.scope),
      subscriptionType: profile.subscriptionType, rateLimitTier: profile.rateLimitTier,
    } })
    flow.status = 'complete'
    return { status: flow.status }
  }
}
