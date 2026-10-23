import { resolveModelApiProtocol } from '@bee-game-studio/agent-workflow'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import {
  mapStoredModelConfigToRuntime,
  validateModelAccess,
  type ModelAuthMethod,
  type ModelProviderKind,
  readStoredModelSelection,
  type PublicModelConfig,
} from '@bee-game-studio/agent-workflow'
import {
  OPENCODE_GO_ID,
  OPENCODE_GO_PROFILES,
  isOpenCodeGoProvider,
  getOpenCodeGoProvider,
  validateOpenCodeGoConfig,
} from '@bee-game-studio/agent-workflow/opencode-go'
import { BgsClient } from './bgs/client'
import { assertBgsAccountIdle } from './bgs/account-activity'
import { bgsHome } from './bgs/auth'
import { getSafeRuntimeProcessEnvironment } from './beegame/runtime-process-environment'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { decryptSecret, encryptSecret } from './security/secret-crypto'

type Connection = {
  method: ModelAuthMethod
  provider?: ModelProviderKind
  apiProtocol?: import('@bee-game-studio/agent-workflow').ModelApiProtocol
  secret?: string
  endpoint?: string
  baseUrl?: string
  model?: string
  disabled?: boolean
}
type Connections = {
  defaultModelId?: string
  connections: Record<string, Connection>
}

export const PERSONAL_BYOK_ID = 'personal-byok'
export const PERSONAL_CHATGPT_ID = 'personal-chatgpt-subscription'
export function isPersonalModelId(id: string) {
  return (
    id === PERSONAL_BYOK_ID ||
    id === PERSONAL_CHATGPT_ID ||
    id === OPENCODE_GO_ID
  )
}
export function personalModelConfig(
  root: string,
  ownerId: string,
  id: string,
  providerOverride?: ModelProviderKind,
): PublicModelConfig | undefined {
  if (!isPersonalModelId(id)) return undefined
  const connection = read(root).connections[id]
  const method = id === PERSONAL_CHATGPT_ID ? 'chatgpt-subscription' : 'byok'
  const provider =
    providerOverride ?? connection?.provider ?? 'openai-compatible'
  const go =
    id === OPENCODE_GO_ID
      ? OPENCODE_GO_PROFILES[
          isOpenCodeGoProvider(provider) ? provider : 'openai-compatible'
        ]
      : undefined
  const now = new Date(0)
  return {
    id,
    ownerId,
    name: go
      ? 'OpenCode Go'
      : method === 'byok'
        ? 'BYOK'
        : 'ChatGPT subscription',
    provider,
    published: true,
    apiProtocol:
      connection?.provider === provider ? connection.apiProtocol : undefined,
    authMethods: [method],
    ...(go
      ? { baseUrl: go.baseUrl }
      : connection?.baseUrl
        ? { baseUrl: connection.baseUrl }
        : {}),
    model: connection?.model ?? go?.model,
    apiKeyPreview: '',
    isDefault: preferredModelId(root) === id,
    createdAt: now,
    updatedAt: now,
  }
}
export function personalModelAvailable(
  root: string,
  ownerId: string,
  id: string,
) {
  const config = personalModelConfig(root, ownerId, id)
  if (!config || config.published === false) return false
  const status = connectionStatus(root, config)
  return (
    !status.disabled &&
    status.method === config.authMethods?.[0] &&
    (id === PERSONAL_CHATGPT_ID
      ? status.chatgptConnected
      : status.hasKey && !!config.model)
  )
}

// This lives in the authenticated user's existing runtime data root, never a project.
function file(root: string) {
  return join(root, '.runtime', 'model-connections.json')
}
function read(root: string): Connections {
  const path = file(root)
  if (!existsSync(path)) return { connections: {} }
  const state = JSON.parse(readFileSync(path, 'utf8')) as Connections
  for (const connection of Object.values(state.connections)) {
    connection.model = readStoredModelSelection(connection)
    delete (connection as Connection & { models?: unknown }).models
  }
  const go = state.connections[OPENCODE_GO_ID]
  // Correct connections saved by the initial Go integration, preserving their
  // encrypted key only when it is bound to that exact previous official route.
  if (go?.method === 'byok' && isOpenCodeGoProvider(go.provider)) {
    const previousUrl =
      go.provider === 'anthropic-compatible'
        ? 'https://opencode.ai/inference/go/anthropic'
        : 'https://opencode.ai/inference/go/openai/v1'
    if (
      go.baseUrl === previousUrl &&
      go.endpoint === endpoint({ provider: go.provider, baseUrl: previousUrl })
    ) {
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
export function preferredModelId(root: string) {
  return read(root).defaultModelId
}
function endpoint(
  config: Pick<PublicModelConfig, 'provider' | 'baseUrl'>,
  baseUrl = config.baseUrl,
) {
  return createHash('sha256')
    .update(`${config.provider}\n${baseUrl ?? ''}`)
    .digest('hex')
}
function validateByokUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      'Use an HTTPS endpoint without embedded credentials or fragments',
    )
  return url.toString().replace(/\/$/, '')
}
function validateByokModel(model: string): string {
  if (!model.trim()) throw new Error('Enter a model')
  return model.trim()
}
export function hasChatGPTAccount(root: string) {
  try {
    const auth = JSON.parse(
      readFileSync(join(bgsHome(root), 'auth.json'), 'utf8'),
    )
    return Boolean(auth.tokens?.access_token && auth.tokens?.refresh_token)
  } catch {
    return false
  }
}
export function connectionStatus(root: string, config: PublicModelConfig) {
  const state = read(root)
  const connection = state.connections[config.id]
  return {
    method: connection?.method ?? 'platform',
    hasKey:
      !!connection?.secret &&
      connection.endpoint === endpoint(config, connection.baseUrl),
    disabled: connection?.disabled === true,
    isPreferred: state.defaultModelId === config.id,
    ...(connection?.secret
      ? {
          baseUrl: connection.baseUrl ?? config.baseUrl,
          model: connection.model ?? config.model,
          apiProtocol: connection.apiProtocol ?? config.apiProtocol,
        }
      : {}),
    chatgptConnected: hasChatGPTAccount(root),
  }
}

export function saveConnection(
  root: string,
  config: PublicModelConfig,
  method: ModelAuthMethod,
  key?: string,
  preferred = false,
  byok?: {
    baseUrl?: string
    model?: string
    apiProtocol?: import('@bee-game-studio/agent-workflow').ModelApiProtocol
  },
) {
  if (config.id === OPENCODE_GO_ID) {
    if (method !== 'byok' || !isOpenCodeGoProvider(config.provider))
      throw new Error(
        'OpenCode Go requires an API key and a supported protocol',
      )
    const profile = OPENCODE_GO_PROFILES[config.provider]
    if (
      config.baseUrl !== profile.baseUrl ||
      (byok?.baseUrl !== undefined && byok.baseUrl !== profile.baseUrl)
    )
      throw new Error('Use the official OpenCode Go endpoint')
    const model = validateByokModel(byok?.model ?? config.model ?? '')
    validateOpenCodeGoConfig({
      provider: config.provider,
      baseUrl: profile.baseUrl,
      model,
      authMethods: ['byok'],
    })
    byok = {
      baseUrl: profile.baseUrl,
      model,
      apiProtocol:
        config.provider === 'anthropic-compatible'
          ? 'anthropic-messages'
          : 'chat-completions',
    }
  }
  const allowed = validateModelAccess(config.provider, config.authMethods)
  if (config.published === false || !allowed.includes(method))
    throw new Error('This model authentication method is not published')
  const state = read(root)
  const previous = state.connections[config.id]
  const apiProtocol = resolveModelApiProtocol(
    config.provider,
    byok?.apiProtocol ??
      config.apiProtocol ??
      (previous?.provider === config.provider
        ? previous.apiProtocol
        : undefined),
  )
  const baseUrl =
    method === 'byok' && byok?.baseUrl !== undefined
      ? validateByokUrl(byok.baseUrl.trim())
      : previous?.baseUrl
  const model =
    method === 'byok'
      ? validateByokModel(byok?.model ?? previous?.model ?? config.model ?? '')
      : previous?.model
  const secret =
    method === 'byok'
      ? key?.trim()
        ? encryptSecret(key.trim(), `model-connection:${config.id}`)
        : previous?.endpoint === endpoint(config, baseUrl)
          ? previous.secret
          : undefined
      : previous?.secret
  if (method === 'byok' && !secret) throw new Error('Enter your API key')
  const status = connectionStatus(root, config)
  if (method === 'chatgpt-subscription' && !status.chatgptConnected)
    throw new Error('Connect your ChatGPT account first')
  state.connections[config.id] = {
    method,
    ...(method === 'byok'
      ? { provider: config.provider }
      : previous?.provider
        ? { provider: previous.provider }
        : {}),
    endpoint:
      method === 'byok' ? endpoint(config, baseUrl) : previous?.endpoint,
    ...(secret ? { secret } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    apiProtocol,
  }
  if (preferred) state.defaultModelId = config.id
  else if (state.defaultModelId === config.id) delete state.defaultModelId
  writePrivate(file(root), state)
  return connectionStatus(root, config)
}
export function disconnectConnection(root: string, id: string) {
  const state = read(root)
  // Keep an explicit disconnected choice: never fall back to the paid platform key.
  state.connections[id] = {
    method: state.connections[id]?.method ?? 'platform',
    disabled: true,
  }
  if (state.defaultModelId === id) delete state.defaultModelId
  writePrivate(file(root), state)
}
export function disconnectAccount(root: string, provider: 'chatgpt') {
  if (provider !== 'chatgpt') throw Error('Unsupported subscription provider')
  assertBgsAccountIdle(join(root, '.runtime', 'app'))
  const path = join(bgsHome(root), 'auth.json')
  if (existsSync(path)) unlinkSync(path)
}
const AUTH_ENV = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_AUTH_MODE',
  'BEEGAME_MODEL',
  'BEEGAME_API_PROTOCOL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GROK_API_KEY',
  'GROK_BASE_URL',
]

export function resolveModelConnection(
  root: string,
  config: PublicModelConfig,
  platformEnv: Record<string, string>,
): Record<string, string> {
  const method = read(root).connections[config.id]?.method ?? 'platform'
  if (
    config.published === false ||
    !validateModelAccess(config.provider, config.authMethods).includes(method)
  ) {
    throw new Error(
      'Select an available connection in Settings → Model connections',
    )
  }
  const state = read(root).connections[config.id]
  if (state?.disabled) throw new Error('This model connection is disabled')
  let env: Record<string, string>
  if (method === 'platform') {
    const keys =
      config.provider === 'anthropic-compatible'
        ? ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']
        : config.provider === 'gemini'
          ? ['GEMINI_API_KEY']
          : config.provider === 'grok'
            ? ['GROK_API_KEY']
            : ['OPENAI_API_KEY']
    if (!keys.some(key => platformEnv[key])) {
      throw new Error('The published platform model has no API key')
    }
    env = platformEnv
  } else {
    const status = connectionStatus(root, config)
    if (
      (method === 'byok' && !status.hasKey) ||
      (method === 'chatgpt-subscription' && !status.chatgptConnected)
    ) {
      throw new Error(
        'Your model connection is disconnected; reconnect in Settings',
      )
    }
    env = mapStoredModelConfigToRuntime({
      ...config,
      // Subscription credentials may only go to the CLI's official OAuth endpoints.
      baseUrl:
        method === 'byok' ? (state?.baseUrl ?? config.baseUrl) : undefined,
      apiKey:
        method === 'byok'
          ? decryptSecret(state!.secret!, `model-connection:${config.id}`)
          : '',
      apiProtocol:
        method === 'byok'
          ? (state?.apiProtocol ?? config.apiProtocol)
          : 'responses',
      model:
        method === 'byok' ? (state?.model ?? config.model) : config.model,
    }).env
    if (method === 'chatgpt-subscription') {
      env.OPENAI_AUTH_MODE = 'chatgpt'
      env.BEEGAME_API_PROTOCOL = 'responses'
      delete env.OPENAI_BASE_URL
    }
  }
  return {
    ...Object.fromEntries(AUTH_ENV.map(key => [key, ''])),
    ...env,
    BGS_MODEL_CONNECTION_RESOLVED: '1',
    BEEGAME_MODEL_TYPE:
      config.provider === 'anthropic-compatible'
        ? 'anthropic'
        : config.provider === 'openai-compatible'
          ? 'openai'
          : config.provider,
  }
}

type Pending = {
  owner: string
  root: string
  expires: number
  status: 'pending' | 'complete' | 'failed'
  client?: BgsClient
  home?: string
  timer?: ReturnType<typeof setTimeout>
}
export class ModelConnectionLogins {
  private pending = new Map<string, Pending>()
  constructor(
    private readonly beforeAccountChange: (owner: string) => void = () => {},
  ) {}
  private get(id: string, owner: string) {
    const flow = this.pending.get(id)
    if (!flow || flow.owner !== owner || flow.expires < Date.now())
      throw Error('Login expired')
    return flow
  }
  status(id: string, owner: string) {
    return { status: this.get(id, owner).status }
  }
  private cleanup(flow: Pending) {
    clearTimeout(flow.timer)
    void (async () => {
      try {
        await flow.client?.close()
      } finally {
        if (flow.home) await rm(flow.home, { recursive: true, force: true })
      }
    })().catch(() => {})
  }
  dispose() {
    for (const flow of this.pending.values()) this.cleanup(flow)
    this.pending.clear()
  }
  cancel(id: string, owner: string) {
    const flow = this.get(id, owner)
    this.pending.delete(id)
    this.cleanup(flow)
  }
  cancelOwner(owner: string) {
    for (const [id, flow] of this.pending)
      if (flow.owner === owner) {
        this.pending.delete(id)
        this.cleanup(flow)
      }
  }
  async start(
    owner: string,
    root: string,
    config: PublicModelConfig,
    method: ModelAuthMethod,
  ) {
    if (
      method !== 'chatgpt-subscription' ||
      config.provider !== 'openai-compatible' ||
      config.published === false ||
      !validateModelAccess(config.provider, config.authMethods).includes(method)
    )
      throw Error('ChatGPT login is unavailable')
    this.cancelOwner(owner)
    const id = randomUUID(),
      flow: Pending = {
        owner,
        root,
        expires: Date.now() + 15 * 60_000,
        status: 'pending',
      }
    this.pending.set(id, flow)
    const directory = join(root, '.runtime', 'logins')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    flow.home = await mkdtemp(join(directory, 'bgs-'))
    try {
      flow.client = await BgsClient.connect({
        cwd: flow.home,
        env: { ...getSafeRuntimeProcessEnvironment(), BGS_HOME: flow.home },
        config: { cli_auth_credentials_store: 'file' },
        onNotification: async (method, p) => {
          if (method !== 'account/login/completed') return
          try {
            if (
              !p.success ||
              this.pending.get(id) !== flow ||
              flow.expires < Date.now()
            )
              throw Error('Login failed or expired')
            const auth = JSON.parse(
              await readFile(join(flow.home!, 'auth.json'), 'utf8'),
            )
            if (!auth.tokens?.access_token || !auth.tokens?.refresh_token)
              throw Error('Incomplete login')
            if (this.pending.get(id) !== flow || flow.expires < Date.now())
              throw Error('Login cancelled')
            await mkdir(bgsHome(root), { recursive: true, mode: 0o700 })
            if (
              this.pending.get(id) !== flow ||
              flow.status !== 'pending' ||
              flow.expires < Date.now()
            )
              throw Error('Login cancelled')
            assertBgsAccountIdle(join(root, '.runtime', 'app'))
            this.beforeAccountChange(owner)
            renameSync(
              join(flow.home!, 'auth.json'),
              join(bgsHome(root), 'auth.json'),
            )
            flow.status = 'complete'
          } catch {
            flow.status = 'failed'
          } finally {
            this.cleanup(flow)
          }
        },
      })
      if (this.pending.get(id) !== flow) throw Error('Login cancelled')
      flow.timer = setTimeout(() => {
        this.pending.delete(id)
        this.cleanup(flow)
      }, 15 * 60_000)
      flow.timer.unref?.()
      const login = await flow.client.request('account/login/start', {
        type: 'chatgptDeviceCode',
      })
      if (
        login.type !== 'chatgptDeviceCode' ||
        typeof login.verificationUrl !== 'string' ||
        typeof login.userCode !== 'string'
      )
        throw Error('Unexpected login response')
      return {
        id,
        url: login.verificationUrl,
        userCode: login.userCode,
        method,
      }
    } catch (error) {
      flow.status = 'failed'
      this.cleanup(flow)
      throw error
    }
  }
}
