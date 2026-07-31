type Env = Record<string, string | undefined>
type InvitationFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>

export type InvitationRecord = {
  id: string
  code?: string | null
  label: string
  enabled: boolean
  maxUses?: number | null
  usedCount: number
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
}

export type InvitationService = {
  getPublicSettings: () => Promise<{ required: boolean }>
  validateCode: (code: string) => Promise<boolean>
  list: (accessToken: string) => Promise<InvitationRecord[]>
  saveSettings: (
    accessToken: string,
    required: boolean,
  ) => Promise<{ required: boolean }>
  create: (
    accessToken: string,
    input: { code: string; label?: string; maxUses?: number | null },
  ) => Promise<InvitationRecord>
  update: (
    accessToken: string,
    input: {
      id: string
      enabled?: boolean
      label?: string
      maxUses?: number | null
      clearMaxUses?: boolean
    },
  ) => Promise<InvitationRecord>
  delete: (accessToken: string, id: string) => Promise<boolean>
}

type InvitationServiceConfig = {
  url: string
  anonKey: string
  fetchImpl?: InvitationFetch
}

export class InvitationServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'InvitationServiceError'
  }
}

export function createInvitationServiceFromEnv(
  env: Env = process.env,
  fetchImpl: InvitationFetch = fetch,
): InvitationService | undefined {
  const url = (
    env.BEEGAME_SUPABASE_URL ??
    env.SUPABASE_URL ??
    env.VITE_SUPABASE_URL ??
    ''
  ).trim()
  const anonKey = (
    env.BEEGAME_SUPABASE_ANON_KEY ??
    env.SUPABASE_ANON_KEY ??
    env.VITE_SUPABASE_ANON_KEY ??
    ''
  ).trim()
  if (!url || !anonKey) return undefined
  return createInvitationService({ url, anonKey, fetchImpl })
}

export function createInvitationService(
  config: InvitationServiceConfig,
): InvitationService {
  const baseUrl = config.url.replace(/\/+$/, '')
  const fetchImpl = config.fetchImpl ?? fetch
  const rpc = async <T>(
    name: string,
    body: Record<string, unknown>,
    accessToken?: string,
  ): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${accessToken || config.anonKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const value = await response.json().catch(() => undefined)
    if (!response.ok) {
      throw new InvitationServiceError(
        readErrorMessage(value) || `Invitation service request failed (${response.status})`,
        response.status,
      )
    }
    return value as T
  }

  return {
    async getPublicSettings() {
      const value = await rpc<unknown>('beegame_public_invitation_settings', {})
      return { required: isRecord(value) && value.required === true }
    },

    async validateCode(code) {
      return (await rpc<unknown>('beegame_validate_invitation_code', {
        p_code: code,
      })) === true
    },

    async list(accessToken) {
      const value = await rpc<unknown>(
        'beegame_admin_list_invitations',
        {},
        accessToken,
      )
      return Array.isArray(value) ? value as InvitationRecord[] : []
    },

    async saveSettings(accessToken, required) {
      const value = await rpc<unknown>(
        'beegame_admin_save_invitation_settings',
        { p_required: required },
        accessToken,
      )
      return { required: isRecord(value) && value.required === true }
    },

    async create(accessToken, input) {
      return rpc<InvitationRecord>(
        'beegame_admin_create_invitation',
        {
          p_code: input.code,
          p_label: input.label || null,
          p_max_uses: input.maxUses ?? null,
        },
        accessToken,
      )
    },

    async update(accessToken, input) {
      return rpc<InvitationRecord>(
        'beegame_admin_update_invitation',
        {
          p_id: input.id,
          p_label: input.label ?? null,
          p_enabled: input.enabled ?? null,
          p_max_uses: input.maxUses ?? null,
          p_clear_max_uses: input.clearMaxUses === true,
        },
        accessToken,
      )
    },

    async delete(accessToken, id) {
      const value = await rpc<unknown>(
        'beegame_admin_delete_invitation',
        { p_id: id },
        accessToken,
      )
      return isRecord(value) ? value.deleted === true : value === true
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readErrorMessage(value: unknown): string {
  if (!isRecord(value)) return ''
  for (const key of ['message', 'detail', 'error']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key].trim()
    }
  }
  return ''
}
