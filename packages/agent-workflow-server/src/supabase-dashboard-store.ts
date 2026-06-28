import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import type { ModelConfigSnapshotRecord } from '@claude-code-best/agent-workflow'
import {
  CREDIT_UNIT_WEIGHTED_TOKENS,
  getCreditEstimates,
  getDefaultFreeCredits,
  type CreditBalance,
  type CreditLedgerEntry,
  type CreditLedgerKind,
  type CreditLedgerSummary,
  type CreditReservation,
  type CreditSettlement,
} from './credit-store'
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
import type { RuntimeSettingsConfig } from './runtime-settings-store'
import type {
  AppendAuditEventInput,
  BeeGameAuditEvent,
} from './audit-events-store'
import type { BeeGameRole } from './auth/user-context'
import type { BeeGameAssetManifest } from './beegame/asset-contracts'
import type { BeeGamePreviewSnapshot } from './beegame/preview-manager'
import type {
  WebFetchAdapter,
  WebSearchAdapter,
  WebToolsConfig,
} from './web-tools-store'

type Env = Record<string, string | undefined>

type SupabaseConfig = {
  url: string
  serviceRoleKey: string
  secretKey?: string
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
  env_ciphertext: JsonObject
  created_at: string
  updated_at: string
}

type SupabaseWorkspaceRow = {
  id: string
  owner_id: string
  name: string
}

type SupabaseWorkspaceMemberRow = {
  workspace_id: string
  user_id: string
  role: BeeGameRole
  created_at: string
}

export type BeeGameWorkspaceMember = {
  workspaceId: string
  userId: string
  role: BeeGameRole
  createdAt: string
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

export function createSupabaseDashboardStoreFromEnv(
  env: Env = process.env,
): SupabaseDashboardStore | undefined {
  const url = (
    env.BEEGAME_SUPABASE_URL ??
    env.SUPABASE_URL ??
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
    serviceRoleKey,
    secretKey: (
      env.BEEGAME_SECRETS_KEY ??
      env.BEEGAME_SECRET_KEY ??
      env.SUPABASE_SECRETS_KEY ??
      ''
    ).trim() || undefined,
    assetBucket: (
      env.BEEGAME_SUPABASE_ASSET_BUCKET ??
      env.SUPABASE_ASSET_BUCKET ??
      ''
    ).trim() || undefined,
  })
}

export class SupabaseDashboardStore {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly assetBucket: string
  private readonly fetchImpl: typeof fetch
  private readonly encryptSecretKey: Buffer
  private readonly decryptSecretKeys: readonly Buffer[]
  private readonly workspaceIds = new Map<string, string>()

  constructor(config: SupabaseConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '')
    this.serviceRoleKey = config.serviceRoleKey
    this.assetBucket = config.assetBucket || 'beegame-assets'
    this.fetchImpl = config.fetchImpl ?? fetch
    const primarySecret = trimString(config.secretKey) || config.serviceRoleKey
    this.encryptSecretKey = deriveSecretKey(primarySecret)
    const fallbackKeys = [this.encryptSecretKey]
    if (primarySecret !== config.serviceRoleKey) {
      fallbackKeys.push(deriveSecretKey(config.serviceRoleKey))
    }
    this.decryptSecretKeys = fallbackKeys
  }

  async deleteAuthUser(userId: string): Promise<void> {
    const id = userId.trim()
    if (!id) throw new Error('User id is required')
    await this.rest<void>(
      `/auth/v1/admin/users/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
  }

  async loadModelConfigSnapshot(): Promise<ModelConfigSnapshotRecord[]> {
    const rows = await this.rest<SupabaseModelConfigRow[]>(
      `/rest/v1/beegame_model_configs?select=*`,
    )
    return rows.map(row => ({
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      provider: row.provider as ModelConfigSnapshotRecord['provider'],
      ...(row.base_url ? { baseUrl: row.base_url } : {}),
      apiKey: decryptSecret(row.api_key_ciphertext ?? '', this.decryptSecretKeys),
      models: toModelMap(row.models),
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async upsertModelConfig(record: ModelConfigSnapshotRecord): Promise<void> {
    await this.upsert('beegame_model_configs', {
      id: record.id,
      owner_id: record.ownerId,
      name: record.name,
      provider: record.provider,
      base_url: record.baseUrl ?? null,
      api_key_ciphertext: encryptSecret(record.apiKey, this.encryptSecretKey),
      models: record.models,
      is_default: record.isDefault,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }, 'id')
  }

  async deleteModelConfig(ownerId: string, id: string): Promise<boolean> {
    return this.deleteWhere('beegame_model_configs', {
      owner_id: ownerId,
      id,
    })
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
    await this.upsert('beegame_runtime_settings', {
      owner_id: ownerId,
      settings: normalized,
      updated_at: new Date().toISOString(),
    }, 'owner_id')
    return normalized
  }

  async loadWebTools(ownerId: string): Promise<WebToolsConfig> {
    const rows = await this.rest<SupabaseWebToolsRow[]>(
      `/rest/v1/beegame_web_tools?owner_id=eq.${q(ownerId)}&select=config&limit=1`,
    )
    return normalizeWebTools(decryptWebToolsConfig(
      rows[0]?.config ?? {},
      this.decryptSecretKeys,
    ))
  }

  async saveWebTools(
    ownerId: string,
    config: WebToolsConfig,
  ): Promise<WebToolsConfig> {
    const previous = await this.loadWebTools(ownerId)
    const normalized = normalizeWebTools({
      ...previous,
      ...config,
      braveApiKey: resolveSecretInput(config.braveApiKey, previous.braveApiKey),
      exaApiKey: resolveSecretInput(config.exaApiKey, previous.exaApiKey),
    })
    await this.upsert('beegame_web_tools', {
      owner_id: ownerId,
      config: encryptWebToolsConfig(normalized, this.encryptSecretKey),
      updated_at: new Date().toISOString(),
    }, 'owner_id')
    return normalized
  }

  async listMcpServers(ownerId: string): Promise<McpServerConfig[]> {
    const rows = await this.rest<SupabaseMcpServerRow[]>(
      `/rest/v1/beegame_mcp_servers?owner_id=eq.${q(ownerId)}&select=*&order=created_at.asc`,
    )
    return rows.map(row => toPublicMcpServerConfig(
      rowToMcpServer(row, this.decryptSecretKeys),
    ))
  }

  async upsertMcpServer(
    ownerId: string,
    input: McpServerInput,
  ): Promise<McpServerConfig> {
    const existing = input.id
      ? await this.getMcpServer(ownerId, input.id)
      : undefined
    const normalized = normalizeMcpServerInput(input, existing)
    await this.upsert('beegame_mcp_servers', {
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
        env: encryptMcpEnv(normalized.env ?? [], this.encryptSecretKey),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, 'id')
    return toPublicMcpServerConfig(normalized)
  }

  async deleteMcpServer(ownerId: string, id: string): Promise<boolean> {
    return this.deleteWhere('beegame_mcp_servers', {
      owner_id: ownerId,
      id,
    })
  }

  async listWorkspaceMembers(ownerId: string): Promise<BeeGameWorkspaceMember[]> {
    const workspaceId = await this.ensureDefaultWorkspace(ownerId)
    const rows = await this.rest<SupabaseWorkspaceMemberRow[]>(
      `/rest/v1/beegame_workspace_members?workspace_id=eq.${q(workspaceId)}&select=*&order=created_at.asc`,
    )
    return rows.map(rowToWorkspaceMember)
  }

  async upsertWorkspaceMember(
    ownerId: string,
    input: { userId: string; role: BeeGameRole },
  ): Promise<BeeGameWorkspaceMember> {
    const workspaceId = await this.ensureDefaultWorkspace(ownerId)
    const memberUserId = input.userId.trim()
    if (!memberUserId) throw new Error('Member user id is required')
    if (memberUserId === ownerId && input.role !== 'owner') {
      throw new Error('Workspace owner must keep the owner role')
    }
    const row = await this.upsert<SupabaseWorkspaceMemberRow>(
      'beegame_workspace_members',
      {
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: input.role,
      },
      'workspace_id,user_id',
    )
    return rowToWorkspaceMember(row)
  }

  async deleteWorkspaceMember(
    ownerId: string,
    userId: string,
  ): Promise<boolean> {
    const memberUserId = userId.trim()
    if (!memberUserId) throw new Error('Member user id is required')
    if (memberUserId === ownerId) {
      throw new Error('Cannot remove the workspace owner')
    }
    const workspaceId = await this.ensureDefaultWorkspace(ownerId)
    return this.deleteWhere('beegame_workspace_members', {
      workspace_id: workspaceId,
      user_id: memberUserId,
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
    await this.upsert('beegame_projects', {
      id: normalized.id,
      owner_id: ownerId,
      workspace_id: workspaceId,
      name: normalized.name,
      root_path: normalized.root_path ?? null,
      runtime_snapshot: normalized.runtime_snapshot ?? {},
      created_at: new Date(normalized.created_at).toISOString(),
      updated_at: new Date().toISOString(),
    }, 'id')
    return normalized
  }

  async deleteProject(ownerId: string, id: string): Promise<boolean> {
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

  async deleteProjectSessions(ownerId: string, projectId: string): Promise<boolean> {
    return this.deleteWhere('beegame_sessions', {
      owner_id: ownerId,
      project_id: projectId,
    })
  }

  async getCreditBalance(ownerId: string): Promise<CreditBalance> {
    return toCreditBalance(ownerId, await this.ensureCreditAccount(ownerId))
  }

  async reserveCredits(
    ownerId: string,
    options: {
      credits: number
      kind?: string
      projectId?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<CreditReservation> {
    const credits = normalizePositiveInteger(options.credits)
    const account = await this.ensureCreditAccount(ownerId)
    const balance = toCreditBalance(ownerId, account)
    if (balance.balanceCredits < credits) {
      throw new Error('Insufficient credits')
    }
    const reservationId = randomUUID()
    const nextAccount = await this.upsert<SupabaseCreditAccountRow>(
      'beegame_credit_accounts',
      {
        user_id: ownerId,
        plan: account.plan,
        included_credits: account.included_credits,
        consumed_credits: account.consumed_credits,
        reserved_credits: account.reserved_credits + credits,
        updated_at: new Date().toISOString(),
      },
      'user_id',
    )
    await this.insertCreditLedger({
      id: reservationId,
      user_id: ownerId,
      project_id: options.projectId ?? null,
      reservation_id: reservationId,
      kind: 'reserve',
      credits,
      weighted_tokens: null,
      metadata: {
        ...(options.kind ? { kind: options.kind } : {}),
        ...(options.metadata ?? {}),
      },
    })
    return {
      id: reservationId,
      reservedCredits: credits,
      balance: toCreditBalance(ownerId, nextAccount),
    }
  }

  async settleCreditReservation(
    ownerId: string,
    options: {
      reservationId: string
      weightedTokens: number
      projectId?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<CreditSettlement> {
    const reservation = await this.getOpenReservation(ownerId, options.reservationId)
    const account = await this.ensureCreditAccount(ownerId)
    const reservedCredits = reservation.credits
    const weightedTokens = normalizeNonNegativeInteger(options.weightedTokens)
    const settledCredits = Math.min(
      reservedCredits,
      Math.max(1, Math.ceil(weightedTokens / CREDIT_UNIT_WEIGHTED_TOKENS)),
    )
    const refundedCredits = Math.max(0, reservedCredits - settledCredits)
    const projectId = options.projectId ?? reservation.project_id ?? undefined
    const nextAccount = await this.upsert<SupabaseCreditAccountRow>(
      'beegame_credit_accounts',
      {
        user_id: ownerId,
        plan: account.plan,
        included_credits: account.included_credits,
        consumed_credits: account.consumed_credits + settledCredits,
        reserved_credits: Math.max(0, account.reserved_credits - reservedCredits),
        updated_at: new Date().toISOString(),
      },
      'user_id',
    )
    await this.insertCreditLedger({
      user_id: ownerId,
      project_id: projectId ?? null,
      reservation_id: reservation.reservation_id,
      kind: 'settle',
      credits: settledCredits,
      weighted_tokens: weightedTokens,
      metadata: options.metadata ?? {},
    })
    if (refundedCredits > 0) {
      await this.insertCreditLedger({
        user_id: ownerId,
        project_id: projectId ?? null,
        reservation_id: reservation.reservation_id,
        kind: 'refund',
        credits: refundedCredits,
        weighted_tokens: null,
        metadata: { reason: 'unused_reservation' },
      })
    }
    return {
      reservationId: reservation.reservation_id ?? options.reservationId,
      reservedCredits,
      settledCredits,
      refundedCredits,
      balance: toCreditBalance(ownerId, nextAccount),
    }
  }

  async refundCreditReservation(
    ownerId: string,
    options: {
      reservationId: string
      projectId?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<CreditSettlement> {
    const reservation = await this.getOpenReservation(ownerId, options.reservationId)
    const account = await this.ensureCreditAccount(ownerId)
    const projectId = options.projectId ?? reservation.project_id ?? undefined
    const nextAccount = await this.upsert<SupabaseCreditAccountRow>(
      'beegame_credit_accounts',
      {
        user_id: ownerId,
        plan: account.plan,
        included_credits: account.included_credits,
        consumed_credits: account.consumed_credits,
        reserved_credits: Math.max(0, account.reserved_credits - reservation.credits),
        updated_at: new Date().toISOString(),
      },
      'user_id',
    )
    await this.insertCreditLedger({
      user_id: ownerId,
      project_id: projectId ?? null,
      reservation_id: reservation.reservation_id,
      kind: 'refund',
      credits: reservation.credits,
      weighted_tokens: null,
      metadata: options.metadata ?? { reason: 'reservation_refunded' },
    })
    return {
      reservationId: reservation.reservation_id ?? options.reservationId,
      reservedCredits: reservation.credits,
      settledCredits: 0,
      refundedCredits: reservation.credits,
      balance: toCreditBalance(ownerId, nextAccount),
    }
  }

  async listCreditLedger(ownerId: string): Promise<CreditLedgerEntry[]> {
    const rows = await this.rest<SupabaseCreditLedgerRow[]>(
      `/rest/v1/beegame_credit_ledger?user_id=eq.${q(ownerId)}&select=*&order=created_at.asc&limit=100`,
    )
    return rows.map(rowToCreditLedgerEntry)
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
        project_id: input.targetType === 'project' ? input.targetId : null,
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

  async loadAssetManifest(
    ownerId: string,
    projectId: string,
  ): Promise<BeeGameAssetManifest | undefined> {
    const rows = await this.rest<SupabaseAssetRow[]>(
      `/rest/v1/beegame_assets?owner_id=eq.${q(ownerId)}&project_id=eq.${q(projectId)}&select=manifest&limit=1`,
    )
    return rows[0] ? normalizeAssetManifest(rows[0].manifest) : undefined
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
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
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
    return `${this.baseUrl}/storage/v1/object/public/${encodeURIComponent(this.assetBucket)}/${objectPath}`
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

  private async getMcpServer(
    ownerId: string,
    id: string,
  ): Promise<McpServerConfig | undefined> {
    const rows = await this.rest<SupabaseMcpServerRow[]>(
      `/rest/v1/beegame_mcp_servers?owner_id=eq.${q(ownerId)}&id=eq.${q(id)}&select=*&limit=1`,
    )
    return rows[0] ? rowToMcpServer(rows[0], this.decryptSecretKeys) : undefined
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
        included_credits: getDefaultFreeCredits(),
        consumed_credits: 0,
        reserved_credits: 0,
        updated_at: new Date().toISOString(),
      },
      'user_id',
    )
  }

  private async getOpenReservation(
    ownerId: string,
    reservationId: string,
  ): Promise<SupabaseCreditLedgerRow> {
    const id = reservationId.trim()
    if (!id) throw new Error('Reservation id is required')
    const rows = await this.rest<SupabaseCreditLedgerRow[]>(
      `/rest/v1/beegame_credit_ledger?user_id=eq.${q(ownerId)}&reservation_id=eq.${q(id)}&select=*&order=created_at.asc`,
    )
    const reservation = rows.find(row => row.kind === 'reserve')
    if (!reservation) throw new Error('Credit reservation not found')
    if (rows.some(row => row.kind === 'settle' || row.kind === 'refund')) {
      throw new Error('Credit reservation already settled')
    }
    return reservation
  }

  private async insertCreditLedger(
    payload: Omit<SupabaseCreditLedgerRow, 'id' | 'created_at'> & {
      id?: string
    },
  ): Promise<SupabaseCreditLedgerRow> {
    return this.insert<SupabaseCreditLedgerRow>(
      'beegame_credit_ledger',
      {
        id: payload.id ?? randomUUID(),
        user_id: payload.user_id,
        project_id: payload.project_id,
        reservation_id: payload.reservation_id,
        kind: payload.kind,
        credits: payload.credits,
        weighted_tokens: payload.weighted_tokens,
        metadata: payload.metadata,
      },
    )
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
    await this.upsert('beegame_workspace_members', {
      workspace_id: workspaceId,
      user_id: ownerId,
      role: 'owner',
    }, 'workspace_id,user_id')
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
    const rows = await this.rest<T[]>(
      `/rest/v1/${table}`,
      {
        method: 'POST',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      },
    )
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

  private async rest<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
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
    return await response.json() as T
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

function toModelMap(value: JsonObject): ModelConfigSnapshotRecord['models'] {
  return {
    ...(typeof value.fast === 'string' ? { fast: value.fast } : {}),
    ...(typeof value.balanced === 'string' ? { balanced: value.balanced } : {}),
    ...(typeof value.strong === 'string' ? { strong: value.strong } : {}),
  }
}

const RUNTIME_BOOLEAN_FIELDS: Array<keyof RuntimeSettingsConfig> = [
  'autoMemoryEnabled',
  'autoDreamEnabled',
  'skillSearchEnabled',
  'treeSitterBashEnabled',
  'webBrowserToolEnabled',
  'bashClassifierEnabled',
  'mcpSkillsEnabled',
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

function resolveSecretInput(
  next: string | undefined,
  previous: string | undefined,
): string | undefined {
  if (next === undefined) return previous
  return trimString(next) || undefined
}

function rowToMcpServer(
  row: SupabaseMcpServerRow,
  secretKeys: readonly Buffer[],
): McpServerConfig {
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
    env: decryptMcpEnv(normalizeEnvFromUnknown(envPayload.env), secretKeys),
    autoStart: config.autoStart !== false,
  })
}

function rowToWorkspaceMember(
  row: SupabaseWorkspaceMemberRow,
): BeeGameWorkspaceMember {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: isBeeGameRole(row.role) ? row.role : 'viewer',
    createdAt: row.created_at,
  }
}

function normalizeMcpServerInput(
  input: McpServerInput,
  existing?: McpServerConfig,
): McpServerConfig {
  const transport = isMcpServerTransport(input.transport)
    ? input.transport
    : existing?.transport ?? 'stdio'
  const scope = isMcpServerScope(input.scope)
    ? input.scope
    : existing?.scope ?? 'beegame'
  const env = normalizeMcpEnv(input.env, existing?.env)
  const base = {
    id: trimString(input.id) || existing?.id || randomUUID(),
    name: trimString(input.name) || existing?.name || 'MCP Server',
    enabled: typeof input.enabled === 'boolean'
      ? input.enabled
      : existing?.enabled ?? true,
    transport,
    scope,
    cwd: trimString(input.cwd) || undefined,
    env,
    autoStart: typeof input.autoStart === 'boolean'
      ? input.autoStart
      : existing?.autoStart ?? true,
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
      const nextValue = item.value === undefined
        ? previous.get(key)
        : trimString(item.value) || undefined
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

const ENCRYPTED_SECRET_PREFIX = 'bgenc:v1:'

function deriveSecretKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

function encryptSecret(value: string | undefined, key: Buffer): string {
  const secret = trimString(value)
  if (!secret || secret.startsWith(ENCRYPTED_SECRET_PREFIX)) return secret
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    ENCRYPTED_SECRET_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

function decryptSecret(value: string | undefined, keys: readonly Buffer[]): string {
  const secret = trimString(value)
  if (!secret || !secret.startsWith(ENCRYPTED_SECRET_PREFIX)) return secret
  const encoded = secret
    .slice(ENCRYPTED_SECRET_PREFIX.length)
    .replace(/^\./, '')
  const parts = encoded.split('.')
  if (parts.length !== 3) throw new Error('Invalid encrypted secret')
  const [ivText, tagText, encryptedText] = parts
  let lastError: unknown
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivText, 'base64url'),
      )
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to decrypt secret')
}

function encryptWebToolsConfig(
  config: WebToolsConfig,
  key: Buffer,
): JsonObject {
  return {
    ...config,
    ...(config.braveApiKey
      ? { braveApiKey: encryptSecret(config.braveApiKey, key) }
      : {}),
    ...(config.exaApiKey
      ? { exaApiKey: encryptSecret(config.exaApiKey, key) }
      : {}),
  } as JsonObject
}

function decryptWebToolsConfig(
  config: JsonObject,
  keys: readonly Buffer[],
): JsonObject {
  return {
    ...config,
    ...(typeof config.braveApiKey === 'string'
      ? { braveApiKey: decryptSecret(config.braveApiKey, keys) }
      : {}),
    ...(typeof config.exaApiKey === 'string'
      ? { exaApiKey: decryptSecret(config.exaApiKey, keys) }
      : {}),
  }
}

function encryptMcpEnv(
  env: McpServerEnvVar[],
  key: Buffer,
): McpServerEnvVar[] {
  return env.map(item => ({
    key: item.key,
    ...(item.value ? { value: encryptSecret(item.value, key) } : {}),
  }))
}

function decryptMcpEnv(
  env: McpServerEnvVar[],
  keys: readonly Buffer[],
): McpServerEnvVar[] {
  return env.map(item => ({
    key: item.key,
    ...(item.value ? { value: decryptSecret(item.value, keys) } : {}),
  }))
}

function normalizeProject(project: BeeGameProjectMetadata): BeeGameProjectMetadata {
  const id = project.id.trim()
  const name = project.name.trim()
  if (!id) throw new Error('Project id is required')
  if (!name) throw new Error('Project name is required')
  return {
    id,
    name,
    ...(project.root_path?.trim() ? { root_path: project.root_path.trim() } : {}),
    created_at: Number.isFinite(project.created_at)
      ? project.created_at
      : Date.now(),
    ...normalizeProjectRuntimeSnapshot(project.runtime_snapshot),
  }
}

function normalizeProjectRuntimeSnapshot(
  snapshot: unknown,
): { runtime_snapshot?: BeeGameProjectRuntimeSnapshot } {
  if (!isObject(snapshot)) return {}
  const usage = isObject(snapshot.usage) ? snapshot.usage : undefined
  const normalizedUsage = usage
    ? {
        prompt_tokens: Math.max(0, Number(usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(usage.completion_tokens) || 0),
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
    createdAt: session.createdAt instanceof Date &&
      Number.isFinite(session.createdAt.getTime())
      ? session.createdAt
      : new Date(),
    updatedAt: session.updatedAt instanceof Date &&
      Number.isFinite(session.updatedAt.getTime())
      ? session.updatedAt
      : new Date(),
  }
}

function rowToSessionMetadata(
  row: SupabaseSessionRow,
): BeeGameSessionMetadata {
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

function rowToAuditEvent(row: SupabaseAuditEventRow): BeeGameAuditEvent {
  const metadata = isObject(row.metadata) ? row.metadata : {}
  const targetType = trimString(metadata.targetType) || 'unknown'
  const targetId = trimString(metadata.targetId) || row.project_id || 'unknown'
  const { targetType: _targetType, targetId: _targetId, ...eventMetadata } = metadata
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
  if (!isObject(value)) return { version: 1, slots: [] }
  const rawSlots = Array.isArray(value.slots) ? value.slots : []
  return {
    version: Number.isInteger(value.version) ? Number(value.version) : 1,
    ...(isObject(value.project_target)
      ? { project_target: value.project_target as BeeGameAssetManifest['project_target'] }
      : {}),
    slots: rawSlots
      .filter(isObject)
      .map(slot => slot as BeeGameAssetManifest['slots'][number]),
  }
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
    ...(trimString(metadata.command) ? { command: trimString(metadata.command) } : {}),
    ...(trimString(metadata.script) ? { script: trimString(metadata.script) } : {}),
    ...(trimString(metadata.entrypoint) ? { entrypoint: trimString(metadata.entrypoint) } : {}),
    ...(trimString(metadata.message) ? { message: trimString(metadata.message) } : {}),
    updatedAt: trimString(metadata.updatedAt) || row.updated_at,
  }
}

function normalizePreviewStatus(value: unknown): BeeGamePreviewSnapshot['status'] {
  return value === 'idle' ||
    value === 'starting' ||
    value === 'running' ||
    value === 'stopped' ||
    value === 'failed' ||
    value === 'unsupported'
    ? value
    : 'idle'
}

function sumCreditSummaryKind(
  rows: SupabaseCreditSummaryRow[],
  kind: CreditLedgerKind,
): number {
  return rows
    .filter(row => row.kind === kind)
    .reduce((sum, row) => sum + normalizeNonNegativeInteger(row.credits), 0)
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

function isBeeGameRole(value: unknown): value is BeeGameRole {
  return value === 'owner' ||
    value === 'developer' ||
    value === 'reviewer' ||
    value === 'viewer'
}

function isMcpServerTransport(value: unknown): value is McpServerTransport {
  return value === 'stdio' || value === 'sse' || value === 'http'
}

function isMcpServerScope(value: unknown): value is McpServerScope {
  return value === 'beegame' || value === 'global' || value === 'project'
}

function isWebSearchAdapter(value: unknown): value is WebSearchAdapter {
  return value === 'tavily' ||
    value === 'api' ||
    value === 'bing' ||
    value === 'brave' ||
    value === 'exa'
}

function isWebFetchAdapter(value: unknown): value is WebFetchAdapter {
  return value === 'tavily' || value === 'http'
}
