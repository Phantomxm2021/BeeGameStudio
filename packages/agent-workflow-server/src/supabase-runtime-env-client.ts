type BeeGameFetch = typeof fetch

export type SupabaseRuntimeEnvClientOptions = {
  url?: string
  anonKey?: string
  rpcName?: string
  fetchImpl?: BeeGameFetch
}

export type SupabaseRuntimeEnvRequest = {
  userId: string
  dataDir: string
  authToken: string
  modelConfigId?: string
}

export class SupabaseRuntimeEnvClient {
  private readonly baseUrl: string
  private readonly anonKey: string
  private readonly rpcName: string
  private readonly fetchImpl: BeeGameFetch

  constructor(options: SupabaseRuntimeEnvClientOptions = {}) {
    this.baseUrl = (
      options.url ??
      process.env.BEEGAME_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      ''
    ).replace(/\/+$/, '')
    this.anonKey = (
      options.anonKey ??
      process.env.BEEGAME_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_ANON_KEY ??
      ''
    ).trim()
    this.rpcName = (
      options.rpcName ??
      process.env.BEEGAME_RUNTIME_ENV_RPC ??
      'beegame_runtime_env'
    ).trim()
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.anonKey && this.rpcName)
  }

  async loadRuntimeEnv(
    request: SupabaseRuntimeEnvRequest,
  ): Promise<Record<string, string>> {
    if (!this.isConfigured()) {
      throw new Error('Supabase runtime env RPC is not configured')
    }
    if (!request.authToken.trim()) {
      throw new Error('Supabase user token is required for runtime env')
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}/rest/v1/rpc/${encodeURIComponent(this.rpcName)}`,
      {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          authorization: `Bearer ${request.authToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: request.userId,
          p_data_dir: request.dataDir,
          ...(request.modelConfigId
            ? { p_model_config_id: request.modelConfigId }
            : {}),
        }),
      },
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Supabase runtime env RPC failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      )
    }
    return normalizeRuntimeEnv(await response.json())
  }
}

export function createSupabaseRuntimeEnvClientFromEnv():
  | SupabaseRuntimeEnvClient
  | undefined {
  const client = new SupabaseRuntimeEnvClient()
  return client.isConfigured() ? client : undefined
}

function normalizeRuntimeEnv(value: unknown): Record<string, string> {
  const payload = isRecord(value) && isRecord(value.env) ? value.env : value
  if (!isRecord(payload)) return {}
  const env: Record<string, string> = {}
  for (const [key, raw] of Object.entries(payload)) {
    if (typeof raw === 'string') env[key] = raw
  }
  return env
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
