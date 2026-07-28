import { randomUUID } from 'node:crypto'
import type {
  BeeGameUsageBillingEvent,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import {
  decryptSecret,
  encryptSecret,
  isSecretEnvelope,
} from './security/secret-crypto'
import type {
  ModelConfigInput,
  ModelConfigSnapshotRecord,
  ModelConfigUpdate,
  PublicModelConfig,
} from '@bee-game-studio/agent-workflow'
import {
  CREDIT_UNIT_WEIGHTED_TOKENS,
  getCreditEstimates,
  getDefaultFreeCredits,
  summarizeCreditLedgerEntries,
  type CreditBalance,
  type CreditAuditLedger,
  type CreditGrant,
  type CreditLedgerFilters,
  type CreditLedgerEntry,
  type CreditLedgerKind,
  type CreditLedgerSummary,
} from './credit-store'
import type { RealtimeUsageWallet } from './realtime-usage-wallet'
import type {
  McpServerConfig,
  McpServerEnvVar,
  McpServerInput,
  McpServerScope,
  McpServerTransport,
} from './mcp-servers-store'
import type {
  BeeGameProjectMetadata,
  BeeGameProjectRuntimeSnapshot,
} from './project-metadata-store'
import type { BeeGameDeploymentRecord } from './beegame/deployment-manager'
import type { RuntimeSettingsConfig } from './runtime-settings-store'
import type {
  AppendAuditEventInput,
  BeeGameAuditEvent,
} from './audit-events-store'
import type { BeeGameSecretMigrationMetadata } from './local-data-migration'
import {
  parseCanonicalBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from './beegame/asset-contracts'
import type { BeeGamePreviewSnapshot } from './beegame/preview-manager'
import type {
  WebFetchAdapter,
  WebSearchAdapter,
  WebToolsConfig,
} from './web-tools-store'
import { toPublicWebToolsConfig } from './web-tools-store'

type Env = Record<string, string | undefined>
const PLATFORM_RUNTIME_SETTINGS_KEY = 'runtime_settings'

type SupabaseConfig = {
  url: string
  anonKey: string
  authToken?: string
  assetBucket?: string
  fetchImpl?: typeof fetch
}

type JsonObject = Record<string, unknown>

type SupabaseModelConfigRow = {
  id: string
  owner_id: string
  name: string
  provider: string
  base_url: string | null
  // Legacy column name. The runtime host treats this as an RLS-protected
  // secret value; it does not perform Supabase server-side encryption.
  api_key_ciphertext: string | null
  models: JsonObject
  is_default: boolean
  created_at: string
  updated_at: string
}

type SupabaseRuntimeSettingsRow = {
  owner_id: string
  settings: JsonObject
  updated_at: string
}

type SupabasePlatformSettingsRow = {
  key: string
  config: JsonObject
  updated_at: string
}

type SupabaseWebToolsRow = {
  owner_id: string
  config: JsonObject
  updated_at: string
}

type SupabaseMcpServerRow = {
  id: string
  owner_id: string
  name: string
  config: JsonObject
  // Legacy column name. Values are protected by Supabase RLS and only sent to
  // the local runtime for the authenticated user's session.
  env_ciphertext: JsonObject
  created_at: string
  updated_at: string
}

type SupabaseWorkspaceRow = {
  id: string
  owner_id: string
  name: string
}

type SupabaseProjectRow = {
  id: string
  owner_id: string
  workspace_id: string
  name: string
  root_path: string | null
  runtime_snapshot: JsonObject
  created_at: string
  updated_at: string
}

type SupabaseSessionRow = {
  id: string
  project_id: string
  owner_id: string
  workspace_path: string
  status: string
  transcript_path: string | null
  model_config_id: string | null
  created_at: string
  updated_at: string
}

export type BeeGameSessionMetadata = {
  id: string
  projectId: string
  workspacePath: string
  status: string
  transcriptPath?: string
  modelConfigId?: string
  createdAt: Date
  updatedAt: Date
}

type SupabaseCreditAccountRow = {
  user_id: string
  plan: 'free'
  included_credits: number
  consumed_credits: number
  reserved_credits: number
  updated_at: string
}

type SupabaseCreditLedgerRow = {
  id: string
  user_id: string
  project_id: string | null
  reservation_id: string | null
  kind: CreditLedgerKind
  credits: number
  weighted_tokens: number | null
  metadata: JsonObject
  created_at: string
}

type SupabaseCreditSummaryRow = Pick<
  SupabaseCreditLedgerRow,
  'kind' | 'credits' | 'weighted_tokens'
>

type SupabaseCreditGrantRow = {
  granted_credits?: number
  account: SupabaseCreditAccountRow
}

type SupabaseUsageBillingResult = {
  duplicate?: boolean
  event: {
    id: string
    idempotency_key: string
    user_id: string
    session_id: string
    turn_id: string | null
    project_id: string | null
    pricing_version: string
    usage_source: 'runtime_snapshot' | 'model_runtime_host'
    prompt_tokens: number
    completion_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
    total_tokens: number
    prompt_tokens_delta: number
    completion_tokens_delta: number
    cache_read_tokens_delta: number
    cache_creation_tokens_delta: number
    total_tokens_delta: number
    weighted_tokens: number
    weighted_tokens_delta: number
    shadow_credits_micro: number
    created_at: string
    metadata: JsonObject
  }
  cumulative_usage: BeeGameUsageBillingRecordInput['usage']
  cumulative_weighted_tokens: number
  shadow_credits_micro: number
}

type SupabaseUsageBillingEventRow = SupabaseUsageBillingResult['event']

export type BeeGameBillingCreditPack = {
  provider: 'stripe'
  priceId: string
  credits: number
  displayName?: string
  enabled: boolean
  sortOrder: number
  metadata: JsonObject
}

export type BeeGameBillingCreditPackInput = {
  provider?: 'stripe'
  priceId: string
  credits: number
  displayName?: string
  enabled?: boolean
  sortOrder?: number
  metadata?: JsonObject
}

export type BeeGameBillingEvent = {
  id?: string
  provider: 'stripe'
  eventType: string
  status: 'received' | 'ignored' | 'succeeded' | 'failed'
  userId?: string
  priceId?: string
  credits?: number
  providerEventId?: string
  checkoutSessionId?: string
  metadata: JsonObject
  errorMessage?: string
  createdAt?: string
}

export type BeeGameBillingEventInput = Omit<
  BeeGameBillingEvent,
  'id' | 'createdAt' | 'metadata'
> & {
  metadata?: JsonObject
}

type SupabaseBillingCreditPackRow = {
  id: string
  provider: string
  price_id: string
  credits: number
  display_name: string | null
  enabled: boolean
  sort_order: number
  metadata: JsonObject
  created_at: string
  updated_at: string
}

type SupabaseBillingEventRow = {
  id: string
  provider: string
  event_type: string
  status: string
  user_id: string | null
  price_id: string | null
  credits: number | null
  provider_event_id: string | null
  checkout_session_id: string | null
  metadata: JsonObject
  error_message: string | null
  created_at: string
}

type SupabaseAuditEventRow = {
  id: string
  actor_id: string | null
  workspace_id: string | null
  project_id: string | null
  action: string
  metadata: JsonObject
  created_at: string
}

type SupabaseAssetRow = {
  id: string
  project_id: string
  owner_id: string
  manifest: JsonObject
  created_at: string
  updated_at: string
}

type SupabasePreviewRow = {
  id: string
  project_id: string
  owner_id: string
  status: string
  url: string | null
  metadata: JsonObject
  created_at: string
  updated_at: string
}

type SupabaseDeploymentRow = {
  id: string
  session_id: string
  project_id: string | null
  owner_id: string
  workspace_path: string
  status: BeeGameDeploymentRecord['status']
  url: string
  build_command: string | null
  build_log: string | null
  entrypoint: string | null
  output_dir: string | null
  artifact_path: string | null
  artifact_hash: string | null
  manifest_storage_object_id: string | null
  message: string | null
  created_at: string
  updated_at: string
  deployed_at: string | null
}

export function createSupabaseDashboardStoreFromEnv(
  env: Env = process.env,
): SupabaseDashboardStore | undefined {
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
  return new SupabaseDashboardStore({
    url,
    anonKey,
    assetBucket:
      (
        env.BEEGAME_SUPABASE_ASSET_BUCKET ??
        env.SUPABASE_ASSET_BUCKET ??
        ''
      ).trim() || undefined,
  })
}

export function createSupabasePaymentProviderGrantStoreFromEnv(
  env: Env = process.env,
): SupabaseDashboardStore | undefined {
  const url = (
    env.BEEGAME_SUPABASE_URL ??
    env.SUPABASE_URL ??
    env.VITE_SUPABASE_URL ??
    ''
  ).trim()
  const serviceRoleKey = (
    env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY ??
    ''
  ).trim()
  if (!url || !serviceRoleKey) return undefined
  return new SupabaseDashboardStore({
    url,
    anonKey: serviceRoleKey,
    assetBucket:
      (
        env.BEEGAME_SUPABASE_ASSET_BUCKET ??
        env.SUPABASE_ASSET_BUCKET ??
        ''
      ).trim() || undefined,
  })
}

export class SupabaseDashboardStore {
  private readonly baseUrl: string
  private readonly anonKey: string
  private readonly authToken?: string
  private readonly assetBucket: string
  private readonly fetchImpl: typeof fetch
  private readonly workspaceIds = new Map<string, string>()

  constructor(config: SupabaseConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '')
    this.anonKey = config.anonKey
    this.authToken = trimString(config.authToken) || undefined
    this.assetBucket = config.assetBucket || 'beegame-assets'
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  withAuthToken(authToken: string | undefined): SupabaseDashboardStore {
    const trimmed = trimString(authToken)
    return new SupabaseDashboardStore({
      url: this.baseUrl,
      anonKey: this.anonKey,
      ...(trimmed ? { authToken: trimmed } : {}),
      assetBucket: this.assetBucket,
      fetchImpl: this.fetchImpl,
    })
  }

  async deleteAuthUser(_userId: string): Promise<void> {
    await this.rpc('beegame_delete_current_user', {})
  }

  async listPublicModelConfigs(ownerId: string): Promise<PublicModelConfig[]> {
    const rows = await this.rest<SupabaseModelConfigRow[]>(
      `/rest/v1/beegame_model_configs?owner_id=eq.${q(ownerId)}&select=*&order=created_at.asc`,
    )
    return rows.map(rowToPublicModelConfig)
  }

  /** Compatibility path for users whose deployed auth RPC predates modelConfigOwnerId. */
  async listRlsVisiblePublicModelConfigs(): Promise<PublicModelConfig[]> {
    const rows = await this.rest<SupabaseModelConfigRow[]>(
      '/rest/v1/beegame_model_configs?select=*&order=created_at.asc',
    )
    return rows.map(rowToPublicModelConfig)
  }

  async hasModelConfig(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.rest<SupabaseModelConfigRow[]>(
      `/rest/v1/beegame_model_configs?owner_id=eq.${q(ownerId)}&id=eq.${q(id)}&select=id&limit=1`,
    )
    return rows.length > 0
  }

  async hasRlsVisibleModelConfig(id: string): Promise<boolean> {
    const rows = await this.rest<SupabaseModelConfigRow[]>(
      `/rest/v1/beegame_model_configs?id=eq.${q(id)}&select=id&limit=1`,
    )
    return rows.length > 0
  }

  async loadRlsVisibleModelRuntimeEnv(
    id: string,
  ): Promise<Record<string, string>> {
    const rows = await this.rest<SupabaseModelConfigRow[]>(
      `/rest/v1/beegame_model_configs?id=eq.${q(id)}&select=*&limit=1`,
    )
    const row = rows[0]
    if (!row) {
      throw new Error(
        `Selected model config is not visible to the authenticated runtime (${id})`,
      )
    }
    const env = modelConfigRowToRuntimeEnv(row)
    if (Object.keys(env).length === 0) {
      throw new Error(
        `Selected model config uses an unsupported provider (${row.provider || 'empty'})`,
      )
    }
    return env
  }

  async createModelConfig(
    ownerId: string,
    input: ModelConfigInput,
  ): Promise<PublicModelConfig> {
    const existing = await this.listPublicModelConfigs(ownerId)
    const isDefault = input.isDefault ?? existing.length === 0
    const now = new Date().toISOString()
    const row = await this.upsertModelConfigRow({
      id: `model_${randomUUID().replaceAll('-', '')}`,
      owner_id: ownerId,
      name: input.name,
      provider: input.provider,
      base_url: input.baseUrl ?? null,
      api_key_ciphertext: encryptSecret(input.apiKey, 'model-config:api-key'),
      models: input.models,
      is_default: false,
      created_at: now,
      updated_at: now,
    })
    if (isDefault) {
      return rowToPublicModelConfig(
        await this.setDefaultModelConfig(ownerId, row.id),
      )
    }
    return rowToPublicModelConfig(row)
  }

  async updateModelConfig(
    ownerId: string,
    id: string,
    input: ModelConfigUpdate,
  ): Promise<PublicModelConfig | undefined> {
    const patch: JsonObject = {
      updated_at: new Date().toISOString(),
    }
    if (input.name !== undefined) patch.name = input.name
    if (input.provider !== undefined) patch.provider = input.provider
    if (input.baseUrl !== undefined) patch.base_url = input.baseUrl || null
    if (input.clearSecret) {
      patch.api_key_ciphertext = encryptSecret('', 'model-config:api-key')
    } else if (input.apiKey !== undefined && input.apiKey.trim()) {
      patch.api_key_ciphertext = encryptSecret(
        input.apiKey,
        'model-config:api-key',
      )
    }
    if (input.models !== undefined) patch.models = input.models
    if (input.isDefault === false) patch.is_default = false

    const rows = await this.rest<SupabaseModelConfigRow[]>(
      `/rest/v1/beegame_model_configs?owner_id=eq.${q(ownerId)}&id=eq.${q(id)}&select=*`,
      {
        method: 'PATCH',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(patch),
      },
    )
    if (input.isDefault) {
      return rowToPublicModelConfig(
        await this.setDefaultModelConfig(ownerId, id),
      )
    }
    return rows[0] ? rowToPublicModelConfig(rows[0]) : undefined
  }

  async upsertModelConfig(record: ModelConfigSnapshotRecord): Promise<void> {
    await this.upsert(
      'beegame_model_configs',
      {
        id: record.id,
        owner_id: record.ownerId,
        name: record.name,
        provider: record.provider,
        base_url: record.baseUrl ?? null,
        api_key_ciphertext: encryptSecret(
          record.apiKey,
          'model-config:api-key',
        ),
        models: record.models,
        is_default: record.isDefault ? false : record.isDefault,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      },
      'id',
    )
    if (record.isDefault) {
      await this.setDefaultModelConfig(record.ownerId, record.id)
    }
  }

  async deleteModelConfig(ownerId: string, id: string): Promise<boolean> {
    return this.deleteWhere('beegame_model_configs', {
      owner_id: ownerId,
      id,
    })
  }

  private async upsertModelConfigRow(
    row: SupabaseModelConfigRow,
  ): Promise<SupabaseModelConfigRow> {
    return this.upsert<SupabaseModelConfigRow>(
      'beegame_model_configs',
      row as unknown as JsonObject,
      'id',
    )
  }

  private async setDefaultModelConfig(
    ownerId: string,
    id: string,
  ): Promise<SupabaseModelConfigRow> {
    return this.rpc<SupabaseModelConfigRow>(
      'beegame_set_default_model_config',
      {
        p_user_id: ownerId,
        p_model_config_id: id,
      },
    )
  }

  async loadRuntimeSettings(ownerId: string): Promise<RuntimeSettingsConfig> {
    const rows = await this.rest<SupabaseRuntimeSettingsRow[]>(
      `/rest/v1/beegame_runtime_settings?owner_id=eq.${q(ownerId)}&select=settings&limit=1`,
    )
    return normalizeRuntimeSettings(rows[0]?.settings ?? {})
  }

  async saveRuntimeSettings(
    ownerId: string,
    config: RuntimeSettingsConfig,
  ): Promise<RuntimeSettingsConfig> {
    const previous = await this.loadRuntimeSettings(ownerId)
    const normalized = normalizeRuntimeSettings({ ...previous, ...config })
    await this.upsert(
      'beegame_runtime_settings',
      {
        owner_id: ownerId,
        settings: normalized,
        updated_at: new Date().toISOString(),
      },
      'owner_id',
    )
    return normalized
  }

  async loadPlatformRuntimeSettings(): Promise<RuntimeSettingsConfig> {
    const rows = await this.rest<SupabasePlatformSettingsRow[]>(
      `/rest/v1/beegame_platform_settings?key=eq.${q(PLATFORM_RUNTIME_SETTINGS_KEY)}&select=config&limit=1`,
    )
    return normalizeRuntimeSettings(rows[0]?.config ?? {})
  }

  async savePlatformRuntimeSettings(
    config: RuntimeSettingsConfig,
  ): Promise<RuntimeSettingsConfig> {
    const previous = await this.loadPlatformRuntimeSettings()
    const normalized = normalizeRuntimeSettings({ ...previous, ...config })
    await this.upsert(
      'beegame_platform_settings',
      {
        key: PLATFORM_RUNTIME_SETTINGS_KEY,
        config: normalized,
        updated_at: new Date().toISOString(),
      },
      'key',
    )
    return normalized
  }

  async loadWebTools(ownerId: string): Promise<WebToolsConfig> {
    const rows = await this.rest<SupabaseWebToolsRow[]>(
      `/rest/v1/beegame_web_tools?owner_id=eq.${q(ownerId)}&select=config&limit=1`,
    )
    return normalizeWebTools(decryptWebTools(rows[0]?.config ?? {}))
  }

  async migrateLegacySecrets(ownerId: string): Promise<{
    modelConfigs: number
    webTools: number
    mcpServers: number
  }> {
    let modelConfigs = 0
    let webTools = 0
    let mcpServers = 0
    const modelRows = await this.rest<SupabaseModelConfigRow[]>(
      `/rest/v1/beegame_model_configs?owner_id=eq.${q(ownerId)}&select=*`,
    )
    for (const row of modelRows) {
      if (!row.api_key_ciphertext || isSecretEnvelope(row.api_key_ciphertext))
        continue
      await this.rest<SupabaseModelConfigRow[]>(
        `/rest/v1/beegame_model_configs?owner_id=eq.${q(ownerId)}&id=eq.${q(row.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            api_key_ciphertext: encryptSecret(
              decryptSecret(row.api_key_ciphertext, 'model-config:api-key'),
              'model-config:api-key',
            ),
            updated_at: new Date().toISOString(),
          }),
        },
      )
      modelConfigs += 1
    }
    const webRows = await this.rest<SupabaseWebToolsRow[]>(
      `/rest/v1/beegame_web_tools?owner_id=eq.${q(ownerId)}&select=*`,
    )
    for (const row of webRows) {
      const config = isObject(row.config) ? row.config : {}
      const legacy =
        (typeof config.braveApiKey === 'string' &&
          !isSecretEnvelope(config.braveApiKey)) ||
        (typeof config.exaApiKey === 'string' &&
          !isSecretEnvelope(config.exaApiKey))
      if (!legacy) continue
      const normalized = normalizeWebTools(decryptWebTools(config))
      await this.upsert(
        'beegame_web_tools',
        {
          owner_id: ownerId,
          config: encryptWebTools(normalized),
          updated_at: new Date().toISOString(),
        },
        'owner_id',
      )
      webTools += 1
    }
    const mcpRows = await this.rest<SupabaseMcpServerRow[]>(
      `/rest/v1/beegame_mcp_servers?owner_id=eq.${q(ownerId)}&select=*`,
    )
    for (const row of mcpRows) {
      const envPayload = isObject(row.env_ciphertext) ? row.env_ciphertext : {}
      const env = Array.isArray(envPayload.env) ? envPayload.env : []
      let legacy = false
      const migratedEnv = env.map(item => {
        if (
          !isObject(item) ||
          typeof item.value !== 'string' ||
          isSecretEnvelope(item.value)
        )
          return item
        legacy = true
        return {
          ...item,
          value: encryptSecret(
            decryptSecret(item.value, `mcp-server:env:${String(item.key)}`),
            `mcp-server:env:${String(item.key)}`,
          ),
        }
      })
      if (!legacy) continue
      await this.rest<SupabaseMcpServerRow[]>(
        `/rest/v1/beegame_mcp_servers?owner_id=eq.${q(ownerId)}&id=eq.${q(row.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            env_ciphertext: { env: migratedEnv },
            updated_at: new Date().toISOString(),
          }),
        },
      )
      mcpServers += 1
    }
    const count = modelConfigs + webTools + mcpServers
    if (count > 0) {
      await this.appendAuditEvent(ownerId, {
        actorId: ownerId,
        action: 'secret.migrated',
        targetType: 'secret',
        targetId: 'migration',
        metadata: { modelConfigs, webTools, mcpServers, count },
      })
    }
    return { modelConfigs, webTools, mcpServers }
  }

  async recordSecretMigration(
    ownerId: string,
    metadata: BeeGameSecretMigrationMetadata,
  ): Promise<BeeGameAuditEvent> {
    return this.appendAuditEvent(ownerId, {
      actorId: ownerId,
      action: 'secret.migrated',
      targetType: 'secret',
      targetId: 'migration',
      metadata,
    })
  }

  async saveWebTools(
    ownerId: string,
    config: WebToolsConfig,
  ): Promise<WebToolsConfig> {
    const previous = await this.loadWebTools(ownerId)
    const normalized = normalizeWebTools({
      ...previous,
      ...config,
      braveApiKey: resolveSecretInput(
        config.braveApiKey,
        previous.braveApiKey,
        config.clearSecret,
      ),
      exaApiKey: resolveSecretInput(
        config.exaApiKey,
        previous.exaApiKey,
        config.clearSecret,
      ),
    })
    await this.upsert(
      'beegame_web_tools',
      {
        owner_id: ownerId,
        config: encryptWebTools(normalized),
        updated_at: new Date().toISOString(),
      },
      'owner_id',
    )
    return toPublicWebToolsConfig(normalized)
  }

  async listMcpServers(ownerId: string): Promise<McpServerConfig[]> {
    const rows = await this.rest<SupabaseMcpServerRow[]>(
      `/rest/v1/beegame_mcp_servers?owner_id=eq.${q(ownerId)}&select=*&order=created_at.asc`,
    )
    return rows.map(row => toPublicMcpServerConfig(rowToMcpServer(row)))
  }

  async upsertMcpServer(
    ownerId: string,
    input: McpServerInput,
  ): Promise<McpServerConfig> {
    const existing = input.id
      ? await this.getMcpServer(ownerId, input.id)
      : undefined
    const normalized = normalizeMcpServerInput(input, existing)
    await this.upsert(
      'beegame_mcp_servers',
      {
        id: normalized.id,
        owner_id: ownerId,
        name: normalized.name,
        config: {
          enabled: normalized.enabled,
          transport: normalized.transport,
          scope: normalized.scope,
          command: normalized.command,
          args: normalized.args,
          url: normalized.url,
          cwd: normalized.cwd,
          autoStart: normalized.autoStart,
        },
        env_ciphertext: {
          env: (normalized.env ?? []).map(item => ({
            ...item,
            ...(item.value !== undefined
              ? {
                  value: encryptSecret(
                    item.value,
                    `mcp-server:env:${item.key}`,
                  ),
                }
              : {}),
          })),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      'id',
    )
    return toPublicMcpServerConfig(normalized)
  }

  async deleteMcpServer(ownerId: string, id: string): Promise<boolean> {
    return this.deleteWhere('beegame_mcp_servers', {
      owner_id: ownerId,
      id,
    })
  }

  async listProjects(ownerId: string): Promise<BeeGameProjectMetadata[]> {
    const rows = await this.rest<SupabaseProjectRow[]>(
      `/rest/v1/beegame_projects?owner_id=eq.${q(ownerId)}&select=*&order=created_at.desc,updated_at.desc`,
    )
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      ...(row.root_path ? { root_path: row.root_path } : {}),
      created_at: new Date(row.created_at).getTime(),
      ...normalizeProjectRuntimeSnapshot(row.runtime_snapshot),
    }))
  }

  async upsertProject(
    ownerId: string,
    project: BeeGameProjectMetadata,
  ): Promise<BeeGameProjectMetadata> {
    const workspaceId = await this.ensureDefaultWorkspace(ownerId)
    const normalized = normalizeProject(project)
    await this.upsert(
      'beegame_projects',
      {
        id: normalized.id,
        owner_id: ownerId,
        workspace_id: workspaceId,
        name: normalized.name,
        root_path: normalized.root_path ?? null,
        runtime_snapshot: normalized.runtime_snapshot ?? {},
        created_at: new Date(normalized.created_at).toISOString(),
        updated_at: new Date().toISOString(),
      },
      'id',
    )
    return normalized
  }

  async deleteProject(ownerId: string, id: string): Promise<boolean> {
    const deploymentStoragePrefixes =
      await this.listProjectDeploymentStoragePrefixes(ownerId, id)
    await this.deleteStoragePrefixes(this.assetBucket, [
      [
        'projects',
        safeStoragePathSegment(ownerId),
        safeStoragePathSegment(id),
      ].join('/'),
    ])
    for (const [bucket, prefixes] of deploymentStoragePrefixes) {
      await this.deleteStoragePrefixes(bucket, prefixes)
    }
    await this.deleteWhere('beegame_assets', {
      owner_id: ownerId,
      project_id: id,
    })
    await this.deleteWhere('beegame_previews', {
      owner_id: ownerId,
      project_id: id,
    })
    await this.deleteWhere('beegame_deployments', {
      owner_id: ownerId,
      project_id: id,
    })
    await this.deleteProjectSessions(ownerId, id)
    return this.deleteWhere('beegame_projects', {
      owner_id: ownerId,
      id,
    })
  }

  async listSessions(ownerId: string): Promise<BeeGameSessionMetadata[]> {
    const rows = await this.rest<SupabaseSessionRow[]>(
      `/rest/v1/beegame_sessions?owner_id=eq.${q(ownerId)}&select=*&order=updated_at.desc,created_at.desc`,
    )
    return rows.map(rowToSessionMetadata)
  }

  async upsertSession(
    ownerId: string,
    session: BeeGameSessionMetadata,
  ): Promise<BeeGameSessionMetadata> {
    const normalized = normalizeSessionMetadata(session)
    const row = await this.upsert<SupabaseSessionRow>(
      'beegame_sessions',
      {
        id: normalized.id,
        owner_id: ownerId,
        project_id: normalized.projectId,
        workspace_path: normalized.workspacePath,
        status: normalized.status,
        transcript_path: normalized.transcriptPath ?? null,
        model_config_id: normalized.modelConfigId ?? null,
        created_at: normalized.createdAt.toISOString(),
        updated_at: normalized.updatedAt.toISOString(),
      },
      'id',
    )
    return rowToSessionMetadata(row)
  }

  async deleteSession(ownerId: string, id: string): Promise<boolean> {
    return this.deleteWhere('beegame_sessions', {
      owner_id: ownerId,
      id,
    })
  }

  async deleteProjectSessions(
    ownerId: string,
    projectId: string,
  ): Promise<boolean> {
    return this.deleteWhere('beegame_sessions', {
      owner_id: ownerId,
      project_id: projectId,
    })
  }

  async getCreditBalance(ownerId: string): Promise<CreditBalance> {
    return toCreditBalance(ownerId, await this.ensureCreditAccount(ownerId))
  }

  async recordShadowUsage(
    ownerId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    const result = await this.rpc<SupabaseUsageBillingResult>(
      'beegame_record_shadow_usage',
      {
        p_user_id: ownerId,
        p_session_id: input.sessionId,
        p_turn_id: input.turnId ?? null,
        p_project_id: input.projectId ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_usage: input.usage,
        p_metadata: input.metadata ?? {},
        p_pricing_version: input.pricingVersion ?? 'weighted-v1',
        p_usage_source: input.usageSource ?? 'runtime_snapshot',
      },
    )
    return toUsageBillingRecordResult(result)
  }

  async debitRealTimeUsage(
    ownerId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    const result = await this.rpc<SupabaseUsageBillingResult>(
      'beegame_debit_realtime_usage',
      {
        p_user_id: ownerId,
        p_session_id: input.sessionId,
        p_turn_id: input.turnId ?? null,
        p_project_id: input.projectId ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_usage: input.usage,
        p_metadata: input.metadata ?? {},
        p_pricing_version: input.pricingVersion ?? 'weighted-v1',
        p_usage_source: input.usageSource ?? 'runtime_snapshot',
      },
    )
    return toUsageBillingRecordResult(result)
  }

  async getRealtimeUsageWallet(ownerId: string): Promise<RealtimeUsageWallet> {
    type UsageWalletRow = {
      user_id: string
      included_credits_micro: number
      consumed_credits_micro: number
    }
    const rows = await this.rest<UsageWalletRow[]>(
      `/rest/v1/beegame_usage_wallets?user_id=eq.${q(ownerId)}&select=user_id,included_credits_micro,consumed_credits_micro&limit=1`,
    )
    const row = rows[0]
    if (!row) {
      return {
        userId: ownerId,
        includedCreditsMicro: 300_000_000,
        consumedCreditsMicro: 0,
        balanceCreditsMicro: 300_000_000,
      }
    }
    return {
      userId: row.user_id,
      includedCreditsMicro: row.included_credits_micro,
      consumedCreditsMicro: row.consumed_credits_micro,
      balanceCreditsMicro: Math.max(
        0,
        row.included_credits_micro - row.consumed_credits_micro,
      ),
    }
  }

  async listShadowUsageEvents(
    ownerId: string,
    projectId?: string,
  ): Promise<BeeGameUsageBillingEvent[]> {
    const projectFilter = projectId ? `&project_id=eq.${q(projectId)}` : ''
    const rows = await this.rest<SupabaseUsageBillingEventRow[]>(
      `/rest/v1/beegame_shadow_usage_events?user_id=eq.${q(ownerId)}${projectFilter}&select=*&order=created_at.asc,id.asc`,
    )
    return rows.map(rowToUsageBillingEvent)
  }

  async grantCredits(
    ownerId: string,
    options: {
      credits: number
      metadata?: Record<string, unknown>
    },
  ): Promise<CreditGrant> {
    const credits = normalizePositiveInteger(options.credits)
    const result = await this.rpc<SupabaseCreditGrantRow>(
      'beegame_admin_grant_credits',
      {
        p_target_user_id: ownerId,
        p_credits: credits,
        p_metadata: options.metadata ?? { source: 'manual' },
      },
    )
    return {
      grantedCredits: normalizeNonNegativeInteger(result.granted_credits),
      balance: toCreditBalance(
        ownerId,
        normalizeCreditAccountRow(ownerId, result.account),
      ),
    }
  }

  async grantPaymentProviderCredits(
    ownerId: string,
    options: {
      credits: number
      metadata?: Record<string, unknown>
    },
  ): Promise<CreditGrant> {
    const credits = normalizePositiveInteger(options.credits)
    const result = await this.rpc<SupabaseCreditGrantRow>(
      'beegame_payment_provider_grant_credits',
      {
        p_target_user_id: ownerId,
        p_credits: credits,
        p_metadata: options.metadata ?? { source: 'payment_provider' },
      },
    )
    return {
      grantedCredits: normalizeNonNegativeInteger(result.granted_credits),
      balance: toCreditBalance(
        ownerId,
        normalizeCreditAccountRow(ownerId, result.account),
      ),
    }
  }

  async listBillingCreditPacks(
    options: { enabledOnly?: boolean } = {},
  ): Promise<BeeGameBillingCreditPack[]> {
    const enabledFilter = options.enabledOnly ? '&enabled=eq.true' : ''
    const rows = await this.rest<SupabaseBillingCreditPackRow[]>(
      `/rest/v1/beegame_billing_credit_packs?provider=eq.stripe${enabledFilter}&select=*&order=sort_order.asc,credits.asc`,
    )
    return rows.map(rowToBillingCreditPack)
  }

  async upsertBillingCreditPack(
    input: BeeGameBillingCreditPackInput,
  ): Promise<BeeGameBillingCreditPack> {
    const priceId = trimString(input.priceId)
    const credits = normalizePositiveInteger(input.credits)
    if (!priceId) throw new Error('Stripe price id is required')
    const row = await this.upsert<SupabaseBillingCreditPackRow>(
      'beegame_billing_credit_packs',
      {
        provider: input.provider ?? 'stripe',
        price_id: priceId,
        credits,
        display_name: trimString(input.displayName) || null,
        enabled: input.enabled ?? true,
        sort_order: normalizeNonNegativeInteger(input.sortOrder),
        metadata: input.metadata ?? {},
      },
      'provider,price_id',
    )
    return rowToBillingCreditPack(row)
  }

  async appendBillingEvent(input: BeeGameBillingEventInput): Promise<void> {
    await this.insert<SupabaseBillingEventRow>('beegame_billing_events', {
      provider: input.provider,
      event_type: input.eventType,
      status: input.status,
      user_id: trimString(input.userId) || null,
      price_id: trimString(input.priceId) || null,
      credits:
        typeof input.credits === 'number'
          ? normalizeNonNegativeInteger(input.credits)
          : null,
      provider_event_id: trimString(input.providerEventId) || null,
      checkout_session_id: trimString(input.checkoutSessionId) || null,
      metadata: input.metadata ?? {},
      error_message: trimString(input.errorMessage) || null,
    })
  }

  async listBillingEvents(): Promise<BeeGameBillingEvent[]> {
    const rows = await this.rest<SupabaseBillingEventRow[]>(
      '/rest/v1/beegame_billing_events?select=*&order=created_at.desc&limit=200',
    )
    return rows.map(rowToBillingEvent)
  }

  async listCreditLedger(ownerId: string): Promise<CreditLedgerEntry[]> {
    const rows = await this.rest<SupabaseCreditLedgerRow[]>(
      `/rest/v1/beegame_credit_ledger?user_id=eq.${q(ownerId)}&select=*&order=created_at.asc&limit=100`,
    )
    return rows.map(rowToCreditLedgerEntry)
  }

  async listCreditAuditLedger(
    filters: CreditLedgerFilters = {},
  ): Promise<CreditAuditLedger> {
    const userFilter = filters.userId ? `&user_id=eq.${q(filters.userId)}` : ''
    const projectFilter = filters.projectId
      ? `&project_id=eq.${q(filters.projectId)}`
      : ''
    const kindFilter = filters.kind ? `&kind=eq.${q(filters.kind)}` : ''
    const reservationFilter = filters.reservationId
      ? `&reservation_id=eq.${q(filters.reservationId)}`
      : ''
    const rows = await this.rest<SupabaseCreditLedgerRow[]>(
      `/rest/v1/beegame_credit_ledger?select=*&order=created_at.asc${userFilter}${projectFilter}${kindFilter}${reservationFilter}&limit=500`,
    )
    const entries = rows.map(rowToCreditLedgerEntry)
    return {
      entries,
      summary: summarizeCreditLedgerEntries(entries),
    }
  }

  async summarizeCreditLedger(
    ownerId: string,
    projectId?: string,
  ): Promise<CreditLedgerSummary> {
    const projectFilter = projectId ? `&project_id=eq.${q(projectId)}` : ''
    const rows = await this.rest<SupabaseCreditSummaryRow[]>(
      `/rest/v1/beegame_credit_ledger?user_id=eq.${q(ownerId)}${projectFilter}&select=kind%2Ccredits%2Cweighted_tokens&order=created_at.asc`,
    )
    const reservedCredits = sumCreditSummaryKind(rows, 'reserve')
    const settledCredits = sumCreditSummaryKind(rows, 'settle')
    const refundedCredits = sumCreditSummaryKind(rows, 'refund')
    return {
      entriesCount: rows.length,
      reservedCredits,
      settledCredits,
      refundedCredits,
      outstandingReservedCredits: Math.max(
        0,
        reservedCredits - settledCredits - refundedCredits,
      ),
      weightedTokens: rows.reduce(
        (sum, row) => sum + normalizeNonNegativeInteger(row.weighted_tokens),
        0,
      ),
    }
  }

  async appendAuditEvent(
    ownerId: string,
    input: AppendAuditEventInput,
  ): Promise<BeeGameAuditEvent> {
    const metadata = {
      ...(input.metadata ?? {}),
      targetType: input.targetType,
      targetId: input.targetId,
    }
    const row = await this.insert<SupabaseAuditEventRow>(
      'beegame_audit_events',
      {
        actor_id: input.actorId || ownerId,
        workspace_id: null,
        project_id:
          input.targetType === 'project' &&
          input.projectReference !== 'detached'
            ? input.targetId
            : null,
        action: input.action,
        metadata,
      },
    )
    return rowToAuditEvent(row)
  }

  async listAuditEvents(ownerId: string): Promise<BeeGameAuditEvent[]> {
    const rows = await this.rest<SupabaseAuditEventRow[]>(
      `/rest/v1/beegame_audit_events?actor_id=eq.${q(ownerId)}&select=*&order=created_at.desc&limit=100`,
    )
    return rows.map(rowToAuditEvent)
  }

  async upsertAssetManifest(
    ownerId: string,
    projectId: string,
    manifest: BeeGameAssetManifest,
  ): Promise<BeeGameAssetManifest> {
    const row = await this.upsert<SupabaseAssetRow>(
      'beegame_assets',
      {
        id: projectId,
        owner_id: ownerId,
        project_id: projectId,
        manifest: manifest as unknown as JsonObject,
        updated_at: new Date().toISOString(),
      },
      'id',
    )
    return normalizeAssetManifest(row.manifest)
  }

  async uploadAssetFile(input: {
    ownerId: string
    projectId: string
    fileName: string
    contentType?: string
    body: BodyInit
  }): Promise<string> {
    const objectPath = [
      'projects',
      safeStoragePathSegment(input.ownerId),
      safeStoragePathSegment(input.projectId),
      `${Date.now()}-${safeStorageFileName(input.fileName)}`,
    ].join('/')
    const response = await this.fetchImpl(
      `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.assetBucket)}/${objectPath}`,
      {
        method: 'PUT',
        headers: {
          apikey: this.anonKey,
          authorization: `Bearer ${this.authToken ?? this.anonKey}`,
          'content-type': input.contentType || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: input.body,
      },
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Supabase storage upload failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      )
    }
    return `supabase://${this.assetBucket}/${objectPath}`
  }

  async deleteAssetFile(
    ownerId: string,
    projectId: string,
    storageUri: string,
  ): Promise<void> {
    const parsed = parseSupabaseStorageUri(storageUri)
    if (!parsed || parsed.bucket !== this.assetBucket) return
    const ownedPrefix = [
      'projects',
      safeStoragePathSegment(ownerId),
      safeStoragePathSegment(projectId),
      '',
    ].join('/')
    if (!parsed.path.startsWith(ownedPrefix)) return
    await this.deleteStoragePrefixes(parsed.bucket, [parsed.path])
  }

  async upsertPreviewSnapshot(
    ownerId: string,
    projectId: string,
    snapshot: BeeGamePreviewSnapshot,
  ): Promise<BeeGamePreviewSnapshot> {
    const row = await this.upsert<SupabasePreviewRow>(
      'beegame_previews',
      {
        id: snapshot.sessionId,
        owner_id: ownerId,
        project_id: projectId,
        status: snapshot.status,
        url: snapshot.url || null,
        metadata: previewSnapshotToMetadata(snapshot),
        updated_at: snapshot.updatedAt,
      },
      'id',
    )
    return rowToPreviewSnapshot(row)
  }

  async loadPreviewSnapshot(
    ownerId: string,
    projectId: string,
    sessionId: string,
  ): Promise<BeeGamePreviewSnapshot | undefined> {
    const rows = await this.rest<SupabasePreviewRow[]>(
      `/rest/v1/beegame_previews?owner_id=eq.${q(ownerId)}&project_id=eq.${q(projectId)}&id=eq.${q(sessionId)}&select=*&limit=1`,
    )
    return rows[0] ? rowToPreviewSnapshot(rows[0]) : undefined
  }

  async listDeploymentRecords(
    ownerId: string,
    sessionId?: string,
  ): Promise<BeeGameDeploymentRecord[]> {
    const sessionFilter = sessionId ? `&session_id=eq.${q(sessionId)}` : ''
    const rows = await this.rest<SupabaseDeploymentRow[]>(
      `/rest/v1/beegame_deployments?owner_id=eq.${q(ownerId)}${sessionFilter}&select=*&order=created_at.desc,updated_at.desc`,
    )
    return rows.map(rowToDeploymentRecord)
  }

  async upsertDeploymentRecord(
    ownerId: string,
    record: BeeGameDeploymentRecord,
  ): Promise<BeeGameDeploymentRecord> {
    const row = await this.upsert<SupabaseDeploymentRow>(
      'beegame_deployments',
      {
        id: record.id,
        owner_id: ownerId,
        session_id: record.sessionId,
        project_id: record.projectId ?? null,
        workspace_path: record.workspacePath,
        status: record.status,
        url: record.url,
        build_command: record.buildCommand ?? null,
        build_log: record.buildLog ?? null,
        entrypoint: record.entrypoint ?? null,
        output_dir: record.outputDir ?? null,
        artifact_path: record.artifactPath ?? null,
        artifact_hash: record.artifactHash ?? null,
        manifest_storage_object_id: record.manifestStorageObjectId ?? null,
        message: record.message ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        deployed_at: record.deployedAt ?? null,
      },
      'id',
    )
    return rowToDeploymentRecord(row)
  }

  private async getMcpServer(
    ownerId: string,
    id: string,
  ): Promise<McpServerConfig | undefined> {
    const rows = await this.rest<SupabaseMcpServerRow[]>(
      `/rest/v1/beegame_mcp_servers?owner_id=eq.${q(ownerId)}&id=eq.${q(id)}&select=*&limit=1`,
    )
    return rows[0] ? rowToMcpServer(rows[0]) : undefined
  }

  private async ensureCreditAccount(
    ownerId: string,
  ): Promise<SupabaseCreditAccountRow> {
    const rows = await this.rest<SupabaseCreditAccountRow[]>(
      `/rest/v1/beegame_credit_accounts?user_id=eq.${q(ownerId)}&select=*&limit=1`,
    )
    if (rows[0]) return normalizeCreditAccountRow(ownerId, rows[0])
    return this.upsert<SupabaseCreditAccountRow>(
      'beegame_credit_accounts',
      {
        user_id: ownerId,
        plan: 'free',
        included_credits: 0,
        consumed_credits: 0,
        reserved_credits: 0,
        updated_at: new Date().toISOString(),
      },
      'user_id',
    )
  }

  private async rpc<T = JsonObject>(
    functionName: string,
    payload: JsonObject,
  ): Promise<T> {
    return this.rest<T>(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  private async ensureDefaultWorkspace(ownerId: string): Promise<string> {
    const cached = this.workspaceIds.get(ownerId)
    if (cached) return cached
    const existing = await this.rest<SupabaseWorkspaceRow[]>(
      `/rest/v1/beegame_workspaces?owner_id=eq.${q(ownerId)}&select=id,owner_id,name&limit=1`,
    )
    if (existing[0]?.id) {
      this.workspaceIds.set(ownerId, existing[0].id)
      return existing[0].id
    }
    const created = await this.upsert<SupabaseWorkspaceRow>(
      'beegame_workspaces',
      {
        name: 'Default Workspace',
        owner_id: ownerId,
      },
      'owner_id',
    )
    const workspaceId = created.id
    await this.upsert(
      'beegame_workspace_members',
      {
        workspace_id: workspaceId,
        user_id: ownerId,
        role: 'owner',
      },
      'workspace_id,user_id',
    )
    this.workspaceIds.set(ownerId, workspaceId)
    return workspaceId
  }

  private async upsert<T = JsonObject>(
    table: string,
    payload: JsonObject,
    onConflict: string,
  ): Promise<T> {
    const rows = await this.rest<T[]>(
      `/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(payload),
      },
    )
    if (!rows[0]) throw new Error(`Supabase ${table} upsert returned no rows`)
    return rows[0]
  }

  private async insert<T = JsonObject>(
    table: string,
    payload: JsonObject,
  ): Promise<T> {
    const rows = await this.rest<T[]>(`/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    })
    if (!rows[0]) throw new Error(`Supabase ${table} insert returned no rows`)
    return rows[0]
  }

  private async deleteWhere(
    table: string,
    filters: Record<string, string>,
  ): Promise<boolean> {
    const query = Object.entries(filters)
      .map(([key, value]) => `${key}=eq.${q(value)}`)
      .join('&')
    const rows = await this.rest<JsonObject[]>(
      `/rest/v1/${table}?${query}&select=id`,
      {
        method: 'DELETE',
        headers: {
          Prefer: 'return=representation',
        },
      },
    )
    return rows.length > 0
  }

  private async listProjectDeploymentStoragePrefixes(
    ownerId: string,
    projectId: string,
  ): Promise<Map<string, string[]>> {
    const rows = await this.rest<Array<{ artifact_path: string | null }>>(
      `/rest/v1/beegame_deployments?owner_id=eq.${q(ownerId)}&project_id=eq.${q(projectId)}&select=artifact_path`,
    )
    const byBucket = new Map<string, Set<string>>()
    for (const row of rows) {
      const parsed = parseSupabaseStorageUri(row.artifact_path)
      if (!parsed) continue
      const prefixes = byBucket.get(parsed.bucket) ?? new Set<string>()
      prefixes.add(parsed.path)
      byBucket.set(parsed.bucket, prefixes)
    }
    return new Map(
      Array.from(byBucket.entries()).map(([bucket, prefixes]) => [
        bucket,
        Array.from(prefixes),
      ]),
    )
  }

  private async deleteStoragePrefixes(
    bucket: string,
    prefixes: string[],
  ): Promise<void> {
    const uniquePrefixes = Array.from(
      new Set(prefixes.map(trimString).filter(Boolean)),
    )
    if (!uniquePrefixes.length) return
    const response = await this.fetchImpl(
      `${this.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: this.anonKey,
          authorization: `Bearer ${this.authToken ?? this.anonKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prefixes: uniquePrefixes }),
      },
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Supabase storage delete failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      )
    }
  }

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchRestRequest(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.anonKey,
        authorization: `Bearer ${this.authToken ?? this.anonKey}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Supabase request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      )
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  /**
   * A local proxy, VPN transition, or pooled TLS connection can fail before an
   * HTTP response exists. Retrying an idempotent Supabase read is safe; replaying
   * a mutation is not. Certificate verification remains enabled on every try.
   */
  private async fetchRestRequest(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const method = String(init.method ?? 'GET').toUpperCase()
    const retryDelays = method === 'GET' || method === 'HEAD' ? [75, 200] : []
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.fetchImpl(url, init)
      } catch (error) {
        const aborted =
          init.signal?.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        if (aborted || attempt >= retryDelays.length) throw error
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
      }
    }
  }
}

function q(value: string): string {
  return encodeURIComponent(value)
}

function safeStoragePathSegment(value: string): string {
  const segment = value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '_')
  return segment || 'unknown'
}

function safeStorageFileName(value: string): string {
  const filename = value.trim().split(/[\\/]/).pop() || 'asset'
  return filename.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'asset'
}

function parseSupabaseStorageUri(
  value: string | null | undefined,
): { bucket: string; path: string } | undefined {
  const trimmed = trimString(value)
  if (!trimmed) return undefined
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'supabase:') return undefined
  const bucket = trimString(parsed.hostname)
  let path = decodeURIComponent(parsed.pathname)
  while (path.startsWith('/')) path = path.slice(1)
  if (!bucket || !path) return undefined
  return { bucket, path }
}

function toModelMap(value: JsonObject): ModelConfigSnapshotRecord['models'] {
  return {
    ...(typeof value.fast === 'string' ? { fast: value.fast } : {}),
    ...(typeof value.balanced === 'string' ? { balanced: value.balanced } : {}),
    ...(typeof value.strong === 'string' ? { strong: value.strong } : {}),
  }
}

function rowToPublicModelConfig(
  row: SupabaseModelConfigRow,
): PublicModelConfig {
  const apiKey = row.api_key_ciphertext
    ? decryptSecret(row.api_key_ciphertext, 'model-config:api-key')
    : ''
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    provider: row.provider as PublicModelConfig['provider'],
    ...(row.base_url ? { baseUrl: row.base_url } : {}),
    apiKeyPreview: maskSecret(apiKey),
    models: toModelMap(row.models),
    isDefault: row.is_default,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function modelConfigRowToRuntimeEnv(
  row: SupabaseModelConfigRow,
): Record<string, string> {
  const apiKey = row.api_key_ciphertext
    ? decryptSecret(row.api_key_ciphertext, 'model-config:api-key')
    : ''
  const models = toModelMap(row.models)
  const modelEnv = (values: Record<string, string | null | undefined>) =>
    Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && Boolean(entry[1]),
      ),
    )

  switch (row.provider) {
    case 'anthropic-compatible':
      return modelEnv({
        ANTHROPIC_BASE_URL: row.base_url,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: models.fast,
        ANTHROPIC_DEFAULT_SONNET_MODEL: models.balanced,
        ANTHROPIC_DEFAULT_OPUS_MODEL: models.strong,
      })
    case 'openai-compatible':
      return modelEnv({
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: row.base_url,
        OPENAI_API_KEY: apiKey,
        OPENAI_DEFAULT_HAIKU_MODEL: models.fast,
        OPENAI_DEFAULT_SONNET_MODEL: models.balanced,
        OPENAI_DEFAULT_OPUS_MODEL: models.strong,
      })
    case 'gemini':
      return modelEnv({
        CLAUDE_CODE_USE_GEMINI: '1',
        GEMINI_BASE_URL: row.base_url,
        GEMINI_API_KEY: apiKey,
        GEMINI_DEFAULT_HAIKU_MODEL: models.fast,
        GEMINI_DEFAULT_SONNET_MODEL: models.balanced,
        GEMINI_DEFAULT_OPUS_MODEL: models.strong,
      })
    case 'grok':
      return modelEnv({
        CLAUDE_CODE_USE_GROK: '1',
        GROK_BASE_URL: row.base_url,
        GROK_API_KEY: apiKey,
        GROK_DEFAULT_HAIKU_MODEL: models.fast,
        GROK_DEFAULT_SONNET_MODEL: models.balanced,
        GROK_DEFAULT_OPUS_MODEL: models.strong,
      })
    default:
      return {}
  }
}

function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '*'.repeat(secret.length)
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`
}

const RUNTIME_BOOLEAN_FIELDS: Array<keyof RuntimeSettingsConfig> = [
  'autoMemoryEnabled',
  'autoDreamEnabled',
  'skillSearchEnabled',
  'treeSitterBashEnabled',
  'webBrowserToolEnabled',
  'bashClassifierEnabled',
  'mcpSkillsEnabled',
  'resourceLibraryEnabled',
]

function normalizeRuntimeSettings(value: unknown): RuntimeSettingsConfig {
  if (!isObject(value)) return {}
  const normalized: RuntimeSettingsConfig = {}
  for (const field of RUNTIME_BOOLEAN_FIELDS) {
    if (typeof value[field] === 'boolean') normalized[field] = value[field]
  }
  return normalized
}

function normalizeWebTools(value: unknown): WebToolsConfig {
  if (!isObject(value)) return {}
  return {
    ...(isWebSearchAdapter(value.webSearchAdapter)
      ? { webSearchAdapter: value.webSearchAdapter }
      : {}),
    ...(isWebFetchAdapter(value.webFetchAdapter)
      ? { webFetchAdapter: value.webFetchAdapter }
      : {}),
    ...(trimString(value.tavilyEndpointUrl)
      ? { tavilyEndpointUrl: trimString(value.tavilyEndpointUrl) }
      : {}),
    ...(trimString(value.braveApiKey)
      ? { braveApiKey: trimString(value.braveApiKey) }
      : {}),
    ...(trimString(value.exaApiKey)
      ? { exaApiKey: trimString(value.exaApiKey) }
      : {}),
    ...(trimString(value.exaEndpointUrl)
      ? { exaEndpointUrl: trimString(value.exaEndpointUrl) }
      : {}),
    ...(Number.isInteger(value.webFetchHttpTimeoutMs) &&
    Number(value.webFetchHttpTimeoutMs) > 0
      ? { webFetchHttpTimeoutMs: Number(value.webFetchHttpTimeoutMs) }
      : {}),
  }
}

function encryptWebTools(config: WebToolsConfig): JsonObject {
  return {
    ...config,
    ...(config.braveApiKey !== undefined
      ? {
          braveApiKey: encryptSecret(
            config.braveApiKey,
            'web-tools:brave-api-key',
          ),
        }
      : {}),
    ...(config.exaApiKey !== undefined
      ? { exaApiKey: encryptSecret(config.exaApiKey, 'web-tools:exa-api-key') }
      : {}),
    braveApiKeyPreview: undefined,
    exaApiKeyPreview: undefined,
  }
}

function decryptWebTools(value: unknown): JsonObject {
  if (!isObject(value)) return {}
  return {
    ...value,
    ...(typeof value.braveApiKey === 'string'
      ? {
          braveApiKey: decryptSecret(
            value.braveApiKey,
            'web-tools:brave-api-key',
          ),
        }
      : {}),
    ...(typeof value.exaApiKey === 'string'
      ? { exaApiKey: decryptSecret(value.exaApiKey, 'web-tools:exa-api-key') }
      : {}),
  }
}

function resolveSecretInput(
  next: string | undefined,
  previous: string | undefined,
  clearSecret = false,
): string | undefined {
  if (clearSecret) return undefined
  if (next === undefined) return previous
  return trimString(next) || previous
}

function rowToMcpServer(row: SupabaseMcpServerRow): McpServerConfig {
  const config = isObject(row.config) ? row.config : {}
  const envPayload = isObject(row.env_ciphertext) ? row.env_ciphertext : {}
  return normalizeMcpServerInput({
    id: row.id,
    name: row.name,
    enabled: config.enabled !== false,
    transport: isMcpServerTransport(config.transport)
      ? config.transport
      : 'stdio',
    scope: isMcpServerScope(config.scope) ? config.scope : 'beegame',
    ...(typeof config.command === 'string' ? { command: config.command } : {}),
    ...(Array.isArray(config.args) ? { args: config.args.map(String) } : {}),
    ...(typeof config.url === 'string' ? { url: config.url } : {}),
    ...(typeof config.cwd === 'string' ? { cwd: config.cwd } : {}),
    env: normalizeEnvFromUnknown(envPayload.env).map(item => ({
      ...item,
      ...(item.value !== undefined
        ? { value: decryptSecret(item.value, `mcp-server:env:${item.key}`) }
        : {}),
    })),
    autoStart: config.autoStart !== false,
  })
}

function normalizeMcpServerInput(
  input: McpServerInput,
  existing?: McpServerConfig,
): McpServerConfig {
  const transport = isMcpServerTransport(input.transport)
    ? input.transport
    : (existing?.transport ?? 'stdio')
  const scope = isMcpServerScope(input.scope)
    ? input.scope
    : (existing?.scope ?? 'beegame')
  const env = normalizeMcpEnv(input.env, existing?.env)
  const base = {
    id: trimString(input.id) || existing?.id || randomUUID(),
    name: trimString(input.name) || existing?.name || 'MCP Server',
    enabled:
      typeof input.enabled === 'boolean'
        ? input.enabled
        : (existing?.enabled ?? true),
    transport,
    scope,
    cwd: trimString(input.cwd) || undefined,
    env,
    autoStart:
      typeof input.autoStart === 'boolean'
        ? input.autoStart
        : (existing?.autoStart ?? true),
  }
  if (transport === 'stdio') {
    return {
      ...base,
      command: trimString(input.command) || existing?.command || '',
      args: normalizeArgs(input.args),
    }
  }
  return {
    ...base,
    url: trimString(input.url) || existing?.url || '',
  }
}

function toPublicMcpServerConfig(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    env: (config.env ?? []).map(item => ({
      key: item.key,
      valuePreview: previewSecret(item.value),
    })),
  }
}

function normalizeMcpEnv(
  input: McpServerEnvVar[] | undefined,
  existing: McpServerEnvVar[] | undefined,
): McpServerEnvVar[] {
  if (!Array.isArray(input)) return existing ?? []
  const previous = new Map((existing ?? []).map(item => [item.key, item.value]))
  return input
    .map(item => {
      const key = trimString(item.key)
      if (!key) return undefined
      const nextValue = item.clearSecret
        ? undefined
        : item.value === undefined
          ? previous.get(key)
          : trimString(item.value) || previous.get(key)
      return {
        key,
        ...(nextValue ? { value: nextValue } : {}),
      }
    })
    .filter((item): item is McpServerEnvVar => item !== undefined)
}

function normalizeEnvFromUnknown(value: unknown): McpServerEnvVar[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!isObject(item)) return undefined
      const key = trimString(item.key)
      if (!key) return undefined
      return {
        key,
        ...(trimString(item.value) ? { value: trimString(item.value) } : {}),
      }
    })
    .filter((item): item is McpServerEnvVar => item !== undefined)
}

function normalizeProject(
  project: BeeGameProjectMetadata,
): BeeGameProjectMetadata {
  const id = project.id.trim()
  const name = project.name.trim()
  if (!id) throw new Error('Project id is required')
  if (!name) throw new Error('Project name is required')
  return {
    id,
    name,
    ...(project.root_path?.trim()
      ? { root_path: project.root_path.trim() }
      : {}),
    created_at: Number.isFinite(project.created_at)
      ? project.created_at
      : Date.now(),
    ...normalizeProjectRuntimeSnapshot(project.runtime_snapshot),
  }
}

function normalizeProjectRuntimeSnapshot(snapshot: unknown): {
  runtime_snapshot?: BeeGameProjectRuntimeSnapshot
} {
  if (!isObject(snapshot)) return {}
  const usage = isObject(snapshot.usage) ? snapshot.usage : undefined
  const normalizedUsage = usage
    ? {
        prompt_tokens: Math.max(0, Number(usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(usage.completion_tokens) || 0),
        cache_read_tokens: Math.max(0, Number(usage.cache_read_tokens) || 0),
        cache_creation_tokens: Math.max(
          0,
          Number(usage.cache_creation_tokens) || 0,
        ),
        total_tokens: Math.max(0, Number(usage.total_tokens) || 0),
      }
    : undefined
  const normalized: BeeGameProjectRuntimeSnapshot = {
    ...(normalizedUsage ? { usage: normalizedUsage } : {}),
    ...(trimString(snapshot.phase_name)
      ? { phase_name: trimString(snapshot.phase_name) }
      : {}),
    ...(trimString(snapshot.model_config_id)
      ? { model_config_id: trimString(snapshot.model_config_id) }
      : {}),
    ...(trimString(snapshot.model_name)
      ? { model_name: trimString(snapshot.model_name) }
      : {}),
    ...(Number.isFinite(snapshot.updated_at)
      ? { updated_at: Number(snapshot.updated_at) }
      : {}),
  }
  return Object.keys(normalized).length > 0
    ? { runtime_snapshot: normalized }
    : {}
}

function normalizeSessionMetadata(
  session: BeeGameSessionMetadata,
): BeeGameSessionMetadata {
  const id = session.id.trim()
  const projectId = session.projectId.trim()
  const workspacePath = session.workspacePath.trim()
  const status = session.status.trim() || 'idle'
  if (!id) throw new Error('Session id is required')
  if (!projectId) throw new Error('Session project id is required')
  if (!workspacePath) throw new Error('Session workspace path is required')
  return {
    id,
    projectId,
    workspacePath,
    status,
    ...(session.transcriptPath?.trim()
      ? { transcriptPath: session.transcriptPath.trim() }
      : {}),
    ...(session.modelConfigId?.trim()
      ? { modelConfigId: session.modelConfigId.trim() }
      : {}),
    createdAt:
      session.createdAt instanceof Date &&
      Number.isFinite(session.createdAt.getTime())
        ? session.createdAt
        : new Date(),
    updatedAt:
      session.updatedAt instanceof Date &&
      Number.isFinite(session.updatedAt.getTime())
        ? session.updatedAt
        : new Date(),
  }
}

function rowToSessionMetadata(row: SupabaseSessionRow): BeeGameSessionMetadata {
  return {
    id: row.id,
    projectId: row.project_id,
    workspacePath: row.workspace_path,
    status: row.status,
    ...(row.transcript_path ? { transcriptPath: row.transcript_path } : {}),
    ...(row.model_config_id ? { modelConfigId: row.model_config_id } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function normalizeCreditAccountRow(
  ownerId: string,
  row: SupabaseCreditAccountRow,
): SupabaseCreditAccountRow {
  return {
    user_id: row.user_id || ownerId,
    plan: 'free',
    included_credits: normalizeNonNegativeInteger(
      row.included_credits,
      getDefaultFreeCredits(),
    ),
    consumed_credits: normalizeNonNegativeInteger(row.consumed_credits),
    reserved_credits: normalizeNonNegativeInteger(row.reserved_credits),
    updated_at: row.updated_at,
  }
}

function toCreditBalance(
  ownerId: string,
  row: SupabaseCreditAccountRow,
): CreditBalance {
  const account = normalizeCreditAccountRow(ownerId, row)
  return {
    userId: ownerId,
    plan: 'free',
    balanceCredits: Math.max(
      0,
      account.included_credits -
        account.consumed_credits -
        account.reserved_credits,
    ),
    includedCredits: account.included_credits,
    consumedCredits: account.consumed_credits,
    reservedCredits: account.reserved_credits,
    creditUnitWeightedTokens: CREDIT_UNIT_WEIGHTED_TOKENS,
    estimates: getCreditEstimates(),
  }
}

function rowToCreditLedgerEntry(
  row: SupabaseCreditLedgerRow,
): CreditLedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    credits: normalizeNonNegativeInteger(row.credits),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.reservation_id ? { reservationId: row.reservation_id } : {}),
    ...(typeof row.weighted_tokens === 'number'
      ? { weightedTokens: normalizeNonNegativeInteger(row.weighted_tokens) }
      : {}),
    metadata: isObject(row.metadata) ? row.metadata : {},
    createdAt: row.created_at,
  }
}

function rowToBillingCreditPack(
  row: SupabaseBillingCreditPackRow,
): BeeGameBillingCreditPack {
  const displayName = trimString(row.display_name)
  return {
    provider: 'stripe',
    priceId: row.price_id,
    credits: normalizePositiveInteger(row.credits),
    ...(displayName ? { displayName } : {}),
    enabled: row.enabled,
    sortOrder: normalizeNonNegativeInteger(row.sort_order),
    metadata: isObject(row.metadata) ? row.metadata : {},
  }
}

function rowToBillingEvent(row: SupabaseBillingEventRow): BeeGameBillingEvent {
  const userId = trimString(row.user_id)
  const priceId = trimString(row.price_id)
  const providerEventId = trimString(row.provider_event_id)
  const checkoutSessionId = trimString(row.checkout_session_id)
  const errorMessage = trimString(row.error_message)
  return {
    id: row.id,
    provider: 'stripe',
    eventType: row.event_type,
    status: isBillingEventStatus(row.status) ? row.status : 'failed',
    ...(userId ? { userId } : {}),
    ...(priceId ? { priceId } : {}),
    ...(typeof row.credits === 'number'
      ? { credits: normalizeNonNegativeInteger(row.credits) }
      : {}),
    ...(providerEventId ? { providerEventId } : {}),
    ...(checkoutSessionId ? { checkoutSessionId } : {}),
    metadata: isObject(row.metadata) ? row.metadata : {},
    ...(errorMessage ? { errorMessage } : {}),
    createdAt: row.created_at,
  }
}

function isBillingEventStatus(
  value: string,
): value is BeeGameBillingEvent['status'] {
  return (
    value === 'received' ||
    value === 'ignored' ||
    value === 'succeeded' ||
    value === 'failed'
  )
}

function rowToAuditEvent(row: SupabaseAuditEventRow): BeeGameAuditEvent {
  const metadata = isObject(row.metadata) ? row.metadata : {}
  const targetType = trimString(metadata.targetType) || 'unknown'
  const targetId = trimString(metadata.targetId) || row.project_id || 'unknown'
  const {
    targetType: _targetType,
    targetId: _targetId,
    ...eventMetadata
  } = metadata
  return {
    id: row.id,
    actorId: row.actor_id ?? '',
    action: row.action,
    targetType,
    targetId,
    ...(Object.keys(eventMetadata).length > 0
      ? { metadata: eventMetadata }
      : {}),
    createdAt: row.created_at,
  }
}

function normalizeAssetManifest(value: unknown): BeeGameAssetManifest {
  return parseCanonicalBeeGameAssetManifest(value)
}

function previewSnapshotToMetadata(
  snapshot: BeeGamePreviewSnapshot,
): JsonObject {
  return {
    workspacePath: snapshot.workspacePath,
    ...(snapshot.port !== undefined ? { port: snapshot.port } : {}),
    ...(snapshot.command ? { command: snapshot.command } : {}),
    ...(snapshot.script ? { script: snapshot.script } : {}),
    ...(snapshot.entrypoint ? { entrypoint: snapshot.entrypoint } : {}),
    ...(snapshot.message ? { message: snapshot.message } : {}),
    updatedAt: snapshot.updatedAt,
  }
}

function rowToPreviewSnapshot(row: SupabasePreviewRow): BeeGamePreviewSnapshot {
  const metadata = isObject(row.metadata) ? row.metadata : {}
  return {
    sessionId: row.id,
    workspacePath: trimString(metadata.workspacePath),
    status: normalizePreviewStatus(row.status),
    url: row.url ?? '',
    ...(Number.isInteger(metadata.port) ? { port: Number(metadata.port) } : {}),
    ...(trimString(metadata.command)
      ? { command: trimString(metadata.command) }
      : {}),
    ...(trimString(metadata.script)
      ? { script: trimString(metadata.script) }
      : {}),
    ...(trimString(metadata.entrypoint)
      ? { entrypoint: trimString(metadata.entrypoint) }
      : {}),
    ...(trimString(metadata.message)
      ? { message: trimString(metadata.message) }
      : {}),
    updatedAt: trimString(metadata.updatedAt) || row.updated_at,
  }
}

function rowToDeploymentRecord(
  row: SupabaseDeploymentRow,
): BeeGameDeploymentRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    workspacePath: row.workspace_path,
    status: normalizeDeploymentStatus(row.status),
    url: row.url,
    ...(row.build_command ? { buildCommand: row.build_command } : {}),
    ...(row.build_log ? { buildLog: row.build_log } : {}),
    ...(row.entrypoint ? { entrypoint: row.entrypoint } : {}),
    ...(row.output_dir ? { outputDir: row.output_dir } : {}),
    ...(row.artifact_path ? { artifactPath: row.artifact_path } : {}),
    ...(row.artifact_hash ? { artifactHash: row.artifact_hash } : {}),
    ...(row.manifest_storage_object_id
      ? { manifestStorageObjectId: row.manifest_storage_object_id }
      : {}),
    ...(row.message ? { message: row.message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deployed_at ? { deployedAt: row.deployed_at } : {}),
  }
}

function normalizePreviewStatus(
  value: unknown,
): BeeGamePreviewSnapshot['status'] {
  return value === 'idle' ||
    value === 'starting' ||
    value === 'running' ||
    value === 'stopped' ||
    value === 'failed' ||
    value === 'unsupported'
    ? value
    : 'idle'
}

function normalizeDeploymentStatus(
  value: unknown,
): BeeGameDeploymentRecord['status'] {
  return value === 'queued' ||
    value === 'building' ||
    value === 'publishing' ||
    value === 'succeeded' ||
    value === 'failed'
    ? value
    : 'failed'
}

function sumCreditSummaryKind(
  rows: SupabaseCreditSummaryRow[],
  kind: CreditLedgerKind,
): number {
  return rows
    .filter(row => row.kind === kind)
    .reduce((sum, row) => sum + normalizeNonNegativeInteger(row.credits), 0)
}

function toUsageBillingRecordResult(
  result: SupabaseUsageBillingResult,
): BeeGameUsageBillingRecordResult {
  const event = result.event
  return {
    duplicate: result.duplicate === true,
    event: {
      id: event.id,
      idempotencyKey: event.idempotency_key,
      userId: event.user_id,
      sessionId: event.session_id,
      ...(event.turn_id ? { turnId: event.turn_id } : {}),
      ...(event.project_id ? { projectId: event.project_id } : {}),
      pricingVersion: event.pricing_version,
      usageSource: event.usage_source,
      usage: {
        prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens),
        completion_tokens: normalizeNonNegativeInteger(event.completion_tokens),
        cache_read_tokens: normalizeNonNegativeInteger(event.cache_read_tokens),
        cache_creation_tokens: normalizeNonNegativeInteger(
          event.cache_creation_tokens,
        ),
        total_tokens: normalizeNonNegativeInteger(event.total_tokens),
      },
      delta: {
        prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens_delta),
        completion_tokens: normalizeNonNegativeInteger(
          event.completion_tokens_delta,
        ),
        cache_read_tokens: normalizeNonNegativeInteger(
          event.cache_read_tokens_delta,
        ),
        cache_creation_tokens: normalizeNonNegativeInteger(
          event.cache_creation_tokens_delta,
        ),
        total_tokens: normalizeNonNegativeInteger(event.total_tokens_delta),
      },
      weightedTokens: normalizeNonNegativeInteger(event.weighted_tokens),
      weightedTokensDelta: normalizeNonNegativeInteger(
        event.weighted_tokens_delta,
      ),
      shadowCreditsMicro: normalizeNonNegativeInteger(
        event.shadow_credits_micro,
      ),
      createdAt: event.created_at,
      metadata: isObject(event.metadata) ? event.metadata : {},
    },
    cumulativeUsage: result.cumulative_usage,
    cumulativeWeightedTokens: normalizeNonNegativeInteger(
      result.cumulative_weighted_tokens,
    ),
    shadowCreditsMicro: normalizeNonNegativeInteger(
      result.shadow_credits_micro,
    ),
  }
}

function rowToUsageBillingEvent(
  event: SupabaseUsageBillingEventRow,
): BeeGameUsageBillingEvent {
  return {
    id: event.id,
    idempotencyKey: event.idempotency_key,
    userId: event.user_id,
    sessionId: event.session_id,
    ...(event.turn_id ? { turnId: event.turn_id } : {}),
    ...(event.project_id ? { projectId: event.project_id } : {}),
    pricingVersion: event.pricing_version,
    usageSource: event.usage_source,
    usage: {
      prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens),
      completion_tokens: normalizeNonNegativeInteger(event.completion_tokens),
      cache_read_tokens: normalizeNonNegativeInteger(event.cache_read_tokens),
      cache_creation_tokens: normalizeNonNegativeInteger(
        event.cache_creation_tokens,
      ),
      total_tokens: normalizeNonNegativeInteger(event.total_tokens),
    },
    delta: {
      prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens_delta),
      completion_tokens: normalizeNonNegativeInteger(
        event.completion_tokens_delta,
      ),
      cache_read_tokens: normalizeNonNegativeInteger(
        event.cache_read_tokens_delta,
      ),
      cache_creation_tokens: normalizeNonNegativeInteger(
        event.cache_creation_tokens_delta,
      ),
      total_tokens: normalizeNonNegativeInteger(event.total_tokens_delta),
    },
    weightedTokens: normalizeNonNegativeInteger(event.weighted_tokens),
    weightedTokensDelta: normalizeNonNegativeInteger(
      event.weighted_tokens_delta,
    ),
    shadowCreditsMicro: normalizeNonNegativeInteger(event.shadow_credits_micro),
    createdAt: event.created_at,
    metadata: isObject(event.metadata) ? event.metadata : {},
  }
}

function normalizeNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

function normalizePositiveInteger(value: unknown): number {
  const normalized = normalizeNonNegativeInteger(value)
  if (normalized <= 0) throw new Error('Credit amount must be positive')
  return normalized
}

function normalizeArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return []
  return args.map(arg => trimString(arg)).filter(Boolean)
}

function previewSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined
  if (secret.length <= 8) return '••••'
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMcpServerTransport(value: unknown): value is McpServerTransport {
  return value === 'stdio' || value === 'sse' || value === 'http'
}

function isMcpServerScope(value: unknown): value is McpServerScope {
  return value === 'beegame' || value === 'global' || value === 'project'
}

function isWebSearchAdapter(value: unknown): value is WebSearchAdapter {
  return (
    value === 'tavily' ||
    value === 'api' ||
    value === 'bing' ||
    value === 'brave' ||
    value === 'exa'
  )
}

function isWebFetchAdapter(value: unknown): value is WebFetchAdapter {
  return value === 'tavily' || value === 'http'
}
