import {
  createModelConfig,
  deleteModelConfig,
  listModelConfigs,
  updateModelConfig,
  type ModelProviderKind,
} from '@claude-code-best/agent-workflow'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  appendAuditEvent,
  listAuditEvents,
  type AppendAuditEventInput,
  type BeeGameAuditEvent,
} from './audit-events-store'
import {
  expireStaleCreditReservations,
  getCreditBalance,
  grantCredits,
  listCreditAuditLedger,
  listCreditLedger,
  refundCreditReservation,
  reserveCredits,
  settleCreditReservation,
  summarizeCreditLedger,
  type CreditAuditLedger,
  type CreditGrant,
  type CreditLedgerFilters,
  type CreditBalance,
  type CreditLedgerEntry,
  type CreditLedgerSummary,
  type CreditReservation,
  type StaleCreditReservationExpiry,
} from './credit-store'
import {
  deleteMcpServer,
  listMcpServers,
  upsertMcpServer,
  type McpServerConfig,
  type McpServerInput,
} from './mcp-servers-store'
import {
  BeeGameProjectMetadataStore,
  getBeeGameProjectDatabasePath,
  type BeeGameProjectMetadata,
} from './project-metadata-store'
import type {
  BeeGameAssetManifest,
} from './beegame/asset-contracts'
import type {
  BeeGameSessionInternalMetadata,
  BeeGameSessionCreditBackend,
} from './beegame/session-manager'
import type { BeeGameDeploymentRecord } from './beegame/deployment-manager'
import type { BeeGamePreviewSnapshot } from './beegame/preview-manager'
import {
  loadRuntimeSettingsConfig,
  mapRuntimeSettingsToEnv,
  saveRuntimeSettingsConfig,
  type RuntimeSettingsConfig,
} from './runtime-settings-store'
import {
  getBearerToken,
  hasBeeGamePermission,
  type BeeGameUserContext,
} from './auth/user-context'
import {
  saveModelConfigsToStore,
  type ModelConfigStoreOptions,
} from './model-config-store'
import type {
  BeeGameSessionMetadata,
  SupabaseDashboardStore,
} from './supabase-dashboard-store'
import type { SupabaseRuntimeEnvClient } from './supabase-runtime-env-client'
import {
  loadWebToolsConfig,
  mapWebToolsConfigToRuntimeEnv,
  saveWebToolsConfig,
  toPublicWebToolsConfig,
  type WebToolsConfig,
} from './web-tools-store'
import { getUserDashboardDataRoot } from './local-runtime-service'

export type DashboardRepositoryOptions = {
  dashboardDataRoot: string
  supabaseStore?: SupabaseDashboardStore
  supabasePaymentProviderStore?: SupabaseDashboardStore
  supabaseRuntimeEnvClient?: SupabaseRuntimeEnvClient
  getUserDataRoot: (request?: Request) => string
  modelConfigStore?: ModelConfigStoreOptions | false
}

export type BeeGameProjectLifecycleOverview = {
  quota: {
    limit: number | null
    used: number
    remaining: number | null
  }
  storage: {
    supabaseStorageConfigured: boolean
  }
  projects: BeeGameProjectLifecycleProject[]
  recentDeletions: BeeGameProjectLifecycleDeletion[]
  recentRetentionRuns: BeeGameProjectLifecycleRetentionRun[]
}

export type BeeGameProjectLifecycleProject = {
  id: string
  name: string
  createdAt: number
  rootPath?: string
  lifecycle: {
    hasWorkspacePath: boolean
    hasRuntimeSnapshot: boolean
    phaseName?: string
    updatedAt?: number
  }
}

export type BeeGameProjectLifecycleDeletion = {
  projectId: string
  deletedAt: string
  cleanupOutcome: string
  deletedWorkspacePath?: string
  storageCleanupOutcome?: string
}

export type BeeGameProjectLifecycleRetentionRun = {
  dryRun: boolean
  ranAt: string
  deploymentRecordsDeleted: number
  deploymentRecordsRetained: number
  deploymentRecordsPlannedForDeletion: number
  previewRecordsSkipped: number
  logRecordsSkipped: number
}

type CreditReserveInput = Omit<Parameters<typeof reserveCredits>[1], 'dataDir'>
type CreditSettleInput = Omit<
  Parameters<typeof settleCreditReservation>[1],
  'dataDir'
>
type CreditRefundInput = Omit<
  Parameters<typeof refundCreditReservation>[1],
  'dataDir'
>
type StaleCreditReservationExpiryInput = Omit<
  Parameters<typeof expireStaleCreditReservations>[1],
  'dataDir'
>
type CreditGrantInput = Omit<
  Parameters<typeof grantCredits>[1],
  'dataDir'
>
type CreateModelConfigInput = {
  name: string
  provider: ModelProviderKind
  baseUrl?: string
  apiKey: string
  models: {
    fast?: string
    balanced?: string
    strong?: string
  }
  isDefault?: boolean
}
type UpdateModelConfigInput = Partial<CreateModelConfigInput>

const DEFAULT_MAX_PROJECTS_PER_USER = 100

export class ProjectQuotaExceededError extends Error {
  constructor(
    readonly limit: number,
    readonly projectCount: number,
  ) {
    super('Project quota exceeded')
    this.name = 'ProjectQuotaExceededError'
    Object.setPrototypeOf(this, ProjectQuotaExceededError.prototype)
  }
}

export class DashboardRepository {
  readonly supabaseStore?: SupabaseDashboardStore
  private readonly projectStores = new Map<string, BeeGameProjectMetadataStore>()

  constructor(private readonly options: DashboardRepositoryOptions) {
    this.supabaseStore = options.supabaseStore
  }

  private hasSupabaseProductionStore(): boolean {
    return Boolean(this.supabaseStore)
  }

  async getCreditBalance(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<CreditBalance> {
    const supabase = this.supabaseForRequest(request)
    const creditOwnerId = getCreditOwnerId(user)
    return supabase
      ? supabase.getCreditBalance(creditOwnerId)
      : getCreditBalance(creditOwnerId, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  hasSupabaseStorage(): boolean {
    return this.hasSupabaseProductionStore()
  }

  async deleteAuthUser(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<void> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase) {
      throw new Error(
        'Account deletion requires Supabase RPC and is not available in dev/offline mode',
      )
    }
    await supabase.deleteAuthUser(user.id)
  }

  async listProjects(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<BeeGameProjectMetadata[]> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.listProjects(user.id)
      : this.getProjectStore(request).listProjects()
  }

  async getProjectLifecycleOverview(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<BeeGameProjectLifecycleOverview> {
    const projects = await this.listProjects(request, user)
    const limit = getMaxProjectsPerUser()
    const auditEvents = await this.listAuditEvents(request, user)
    return {
      quota: {
        limit: limit ?? null,
        used: projects.length,
        remaining: limit ? Math.max(0, limit - projects.length) : null,
      },
      storage: {
        supabaseStorageConfigured: this.hasSupabaseStorage(),
      },
      projects: projects.map(toProjectLifecycleProject),
      recentDeletions: auditEvents
        .filter(event => event.action === 'project.deleted')
        .map(toProjectLifecycleDeletion)
        .slice(0, 10),
      recentRetentionRuns: auditEvents
        .filter(event => event.action === 'project.retention_run')
        .map(toProjectLifecycleRetentionRun)
        .slice(0, 10),
    }
  }

  async ownsProjectWorkspacePath(
    request: Request,
    user: BeeGameUserContext,
    workspacePath: string,
  ): Promise<boolean> {
    const normalizedWorkspace = await normalizeWorkspaceIdentity(workspacePath)
    const projects = await this.listProjects(request, user)
    for (const project of projects) {
      if (!project.root_path) continue
      if (await normalizeWorkspaceIdentity(project.root_path) === normalizedWorkspace) {
        return true
      }
    }
    return false
  }

  async upsertProject(
    request: Request,
    user: BeeGameUserContext,
    project: BeeGameProjectMetadata,
  ): Promise<BeeGameProjectMetadata> {
    await this.assertProjectQuotaAllowsUpsert(request, user, project.id)
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.upsertProject(user.id, project)
      : this.getProjectStore(request).upsertProject(project)
  }

  async deleteProject(
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ): Promise<boolean> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.deleteProject(user.id, id)
      : this.getProjectStore(request).deleteProject(id)
  }

  async listProjectSessions(
    request: Request,
    user: BeeGameUserContext,
    projectId: string,
  ): Promise<BeeGameSessionMetadata[]> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase) return []
    return (await supabase.listSessions(user.id))
      .filter(session => session.projectId === projectId)
  }

  async upsertSessionMetadata(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
  ): Promise<void> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return
    await supabase.upsertSession(user.id, {
      id: metadata.id,
      projectId: metadata.projectId,
      workspacePath: metadata.workspacePath,
      status: metadata.status,
      transcriptPath: metadata.transcriptPath,
      ...(metadata.modelConfigId ? { modelConfigId: metadata.modelConfigId } : {}),
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    })
  }

  async deleteSessionMetadata(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
    sessionId: string,
  ): Promise<void> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return
    await supabase.deleteSession(user.id, sessionId)
  }

  async upsertPreviewSnapshot(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
    snapshot: BeeGamePreviewSnapshot,
  ): Promise<void> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return
    await supabase.upsertPreviewSnapshot(
      user.id,
      metadata.projectId,
      snapshot,
    )
  }

  async upsertAssetManifest(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
    manifest: BeeGameAssetManifest,
  ): Promise<BeeGameAssetManifest | undefined> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return undefined
    return supabase.upsertAssetManifest(
      user.id,
      metadata.projectId,
      manifest,
    )
  }

  async loadAssetManifest(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
  ): Promise<BeeGameAssetManifest | undefined> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return undefined
    return supabase.loadAssetManifest(user.id, metadata.projectId)
  }

  async uploadAssetFile(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
    file: File,
  ): Promise<string | undefined> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return undefined
    return supabase.uploadAssetFile({
      ownerId: user.id,
      projectId: metadata.projectId,
      fileName: file.name,
      contentType: file.type,
      body: file,
    })
  }

  async listMcpServers(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<McpServerConfig[]> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.listMcpServers(user.id)
      : listMcpServers({
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async upsertMcpServer(
    request: Request,
    user: BeeGameUserContext,
    input: McpServerInput,
  ): Promise<McpServerConfig> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.upsertMcpServer(user.id, input)
      : upsertMcpServer(input, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async deleteMcpServer(
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ): Promise<boolean> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.deleteMcpServer(user.id, id)
      : deleteMcpServer(id, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async loadWebTools(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<WebToolsConfig> {
    const supabase = this.supabaseForRequest(request)
    const config = supabase
      ? await supabase.loadWebTools(user.id)
      : loadWebToolsConfig({
          dataDir: this.options.getUserDataRoot(request),
        })
    return toPublicWebToolsConfig(config)
  }

  async saveWebTools(
    request: Request,
    user: BeeGameUserContext,
    input: WebToolsConfig,
  ): Promise<WebToolsConfig> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.saveWebTools(user.id, input)
      : saveWebToolsConfig(input, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async loadRuntimeSettings(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<RuntimeSettingsConfig> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.loadRuntimeSettings(user.id)
      : loadRuntimeSettingsConfig({
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async saveRuntimeSettings(
    request: Request,
    user: BeeGameUserContext,
    input: RuntimeSettingsConfig,
  ): Promise<RuntimeSettingsConfig> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.saveRuntimeSettings(user.id, input)
      : saveRuntimeSettingsConfig(input, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async listModelConfigs(request: Request, user: BeeGameUserContext) {
    const supabase = this.supabaseForRequest(request)
    if (supabase) {
      return supabase.listReadablePublicModelConfigs()
    }
    return listModelConfigs(user.id)
  }

  async createModelConfig(
    request: Request,
    user: BeeGameUserContext,
    input: CreateModelConfigInput,
  ) {
    const supabase = this.supabaseForRequest(request)
    if (supabase) return supabase.createModelConfig(this.getManageModelConfigOwnerId(user), input)
    const created = createModelConfig(user.id, input)
    this.persistLocalModelConfigs()
    return created
  }

  async updateModelConfig(
    request: Request,
    user: BeeGameUserContext,
    id: string,
    input: UpdateModelConfigInput,
  ) {
    const supabase = this.supabaseForRequest(request)
    if (supabase) {
      return supabase.updateModelConfig(this.getManageModelConfigOwnerId(user), id, input)
    }
    const updated = updateModelConfig(id, input)
    if (updated) this.persistLocalModelConfigs()
    return updated
  }

  async deleteModelConfig(
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ): Promise<boolean> {
    const supabase = this.supabaseForRequest(request)
    if (supabase) return supabase.deleteModelConfig(this.getManageModelConfigOwnerId(user), id)
    const deleted = deleteModelConfig(id)
    if (!deleted) return false
    this.persistLocalModelConfigs()
    return true
  }

  async modelConfigExists(
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ): Promise<boolean> {
    const supabase = this.supabaseForRequest(request)
    if (supabase) {
      return supabase.hasReadableModelConfig(id)
    }
    return listModelConfigs(user.id).some(config => config.id === id)
  }

  async listCreditLedger(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<CreditLedgerEntry[]> {
    const supabase = this.supabaseForRequest(request)
    const creditOwnerId = getCreditOwnerId(user)
    return supabase
      ? supabase.listCreditLedger(creditOwnerId)
      : listCreditLedger(creditOwnerId, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async summarizeCreditLedger(
    request: Request,
    user: BeeGameUserContext,
    projectId?: string,
  ): Promise<CreditLedgerSummary> {
    const supabase = this.supabaseForRequest(request)
    const creditOwnerId = getCreditOwnerId(user)
    return supabase
      ? supabase.summarizeCreditLedger(creditOwnerId, projectId)
      : summarizeCreditLedger(creditOwnerId, {
          dataDir: this.options.getUserDataRoot(request),
          ...(projectId ? { projectId } : {}),
        })
  }

  async listCreditAuditLedger(
    request: Request,
    _user: BeeGameUserContext,
    filters: CreditLedgerFilters = {},
  ): Promise<CreditAuditLedger> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.listCreditAuditLedger(filters)
      : listCreditAuditLedger({
          dashboardDataRoot: this.options.dashboardDataRoot,
          filters,
        })
  }

  async reserveCredits(
    request: Request,
    user: BeeGameUserContext,
    input: CreditReserveInput,
  ): Promise<CreditReservation> {
    const supabase = this.supabaseForRequest(request)
    const creditOwnerId = getCreditOwnerId(user)
    return supabase
      ? supabase.reserveCredits(creditOwnerId, input)
      : reserveCredits(creditOwnerId, {
          ...input,
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async settleCreditReservation(
    request: Request,
    user: BeeGameUserContext,
    input: CreditSettleInput,
  ): Promise<ReturnType<typeof settleCreditReservation>> {
    const supabase = this.supabaseForRequest(request)
    const creditOwnerId = getCreditOwnerId(user)
    return supabase
      ? supabase.settleCreditReservation(creditOwnerId, input)
      : settleCreditReservation(creditOwnerId, {
          ...input,
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async refundCreditReservation(
    request: Request,
    user: BeeGameUserContext,
    input: CreditRefundInput,
  ): Promise<ReturnType<typeof refundCreditReservation>> {
    const supabase = this.supabaseForRequest(request)
    const creditOwnerId = getCreditOwnerId(user)
    return supabase
      ? supabase.refundCreditReservation(creditOwnerId, input)
      : refundCreditReservation(creditOwnerId, {
          ...input,
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async expireStaleCreditReservations(
    request: Request,
    user: BeeGameUserContext,
    input: StaleCreditReservationExpiryInput,
  ): Promise<StaleCreditReservationExpiry> {
    const supabase = this.supabaseForRequest(request)
    const creditOwnerId = getCreditOwnerId(user)
    return supabase
      ? supabase.expireStaleCreditReservations(creditOwnerId, input)
      : expireStaleCreditReservations(creditOwnerId, {
          ...input,
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async grantCredits(
    request: Request,
    targetUserId: string,
    input: CreditGrantInput,
  ): Promise<CreditGrant> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.grantCredits(targetUserId, input)
      : grantCredits(targetUserId, {
          ...input,
          dataDir: getUserDashboardDataRoot(this.options.dashboardDataRoot, targetUserId),
        })
  }

  async grantPaymentProviderCredits(
    request: Request,
    targetUserId: string,
    input: CreditGrantInput,
  ): Promise<CreditGrant> {
    const metadata = input.metadata ?? {}
    const paymentProviderStore = this.options.supabasePaymentProviderStore
    if (this.supabaseStore && !paymentProviderStore) {
      throw new Error('Supabase service role key is required for payment provider credit grants')
    }
    return paymentProviderStore
      ? paymentProviderStore.grantPaymentProviderCredits(targetUserId, input)
      : this.grantLocalPaymentProviderCredits(targetUserId, {
          credits: input.credits,
          metadata,
        })
  }

  private grantLocalPaymentProviderCredits(
    targetUserId: string,
    input: CreditGrantInput,
  ): CreditGrant {
    const dataDir = getUserDashboardDataRoot(this.options.dashboardDataRoot, targetUserId)
    const provider = metadataString(input.metadata, 'provider')
    const providerReference = metadataString(input.metadata, 'providerReference')
    if (provider && providerReference) {
      const existing = listCreditLedger(targetUserId, { dataDir })
        .some(entry => (
          entry.kind === 'grant' &&
          entry.metadata.provider === provider &&
          entry.metadata.providerReference === providerReference
        ))
      if (existing) {
        return {
          grantedCredits: 0,
          balance: getCreditBalance(targetUserId, { dataDir }),
        }
      }
    }
    return grantCredits(targetUserId, {
      credits: input.credits,
      metadata: input.metadata,
      dataDir,
    })
  }

  createSessionCreditBackend(): BeeGameSessionCreditBackend {
    if (this.hasSupabaseProductionStore()) {
      return {
        reserveCredits: (userId, input) =>
          this.supabaseForAuthToken(input.authToken)
            .reserveCredits(userId, input),
        settleCreditReservation: (userId, input) =>
          this.supabaseForAuthToken(input.authToken)
            .settleCreditReservation(userId, input),
        refundCreditReservation: (userId, input) =>
          this.supabaseForAuthToken(input.authToken)
            .refundCreditReservation(userId, input),
      }
    }
    // Dev/offline mode only. SaaS deployments should provide a Supabase store,
    // so credit mutations run through authenticated RPC under RLS.
    return {
      reserveCredits: (userId, input) => reserveCredits(userId, input),
      settleCreditReservation: (userId, input) =>
        settleCreditReservation(userId, input),
      refundCreditReservation: (userId, input) =>
        refundCreditReservation(userId, input),
    }
  }

  async appendAuditEvent(
    request: Request,
    user: BeeGameUserContext,
    input: AppendAuditEventInput,
  ): Promise<void> {
    const supabase = this.supabaseForRequest(request)
    if (supabase) {
      await supabase.appendAuditEvent(user.id, input)
      return
    }
    appendAuditEvent(input, {
      dataDir: this.options.getUserDataRoot(request),
    })
  }

  async listDeploymentRecords(
    request: Request,
    user: BeeGameUserContext,
    sessionId?: string,
  ): Promise<BeeGameDeploymentRecord[] | undefined> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.listDeploymentRecords(user.id, sessionId)
      : undefined
  }

  async upsertDeploymentRecord(
    request: Request,
    user: BeeGameUserContext,
    record: BeeGameDeploymentRecord,
  ): Promise<BeeGameDeploymentRecord | undefined> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.upsertDeploymentRecord(user.id, record)
      : undefined
  }

  async listAuditEvents(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<ReturnType<typeof listAuditEvents>> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.listAuditEvents(user.id)
      : listAuditEvents({
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async getRuntimeEnv(
    userDataRoot?: string,
    userId?: string,
    authToken?: string,
    modelConfigId?: string,
  ): Promise<Record<string, string>> {
    const dataDir = userDataRoot ?? this.options.dashboardDataRoot
    if (this.supabaseStore && userId) {
      const client = this.options.supabaseRuntimeEnvClient
      if (!client) {
        throw new Error(
          'Supabase runtime env must be provided by RLS/RPC; the local runtime host does not use service-role Supabase credentials',
        )
      }
      return client.loadRuntimeEnv({
        userId,
        dataDir,
        authToken: this.requireAuthToken(authToken),
        ...(modelConfigId ? { modelConfigId } : {}),
      })
    }
    return {
      ...mapWebToolsConfigToRuntimeEnv(loadWebToolsConfig({ dataDir })),
      ...mapRuntimeSettingsToEnv(loadRuntimeSettingsConfig({ dataDir }), {
        dataDir,
      }),
    }
  }

  private persistLocalModelConfigs(): void {
    const modelConfigStore = this.options.modelConfigStore
    if (modelConfigStore !== false && modelConfigStore !== undefined) {
      saveModelConfigsToStore(modelConfigStore)
    }
  }

  private getProjectStore(request: Request): BeeGameProjectMetadataStore {
    const dataRoot = this.options.getUserDataRoot(request)
    const existing = this.projectStores.get(dataRoot)
    if (existing) return existing
    const created = new BeeGameProjectMetadataStore(
      getBeeGameProjectDatabasePath(dataRoot),
    )
    this.projectStores.set(dataRoot, created)
    return created
  }

  private async assertProjectQuotaAllowsUpsert(
    request: Request,
    user: BeeGameUserContext,
    projectId: string,
  ): Promise<void> {
    const limit = getMaxProjectsPerUser()
    if (!limit) return
    const projects = await this.listProjects(request, user)
    if (projects.some(project => project.id === projectId)) return
    if (projects.length >= limit) {
      throw new ProjectQuotaExceededError(limit, projects.length)
    }
  }

  private supabaseForRequest(request?: Request): SupabaseDashboardStore | undefined {
    if (!this.supabaseStore) return undefined
    return this.supabaseStore.withAuthToken(
      this.requireAuthToken(request ? getBearerToken(request) : undefined),
    )
  }

  private supabaseForAuthToken(authToken: string | undefined): SupabaseDashboardStore {
    if (!this.supabaseStore) throw new Error('Supabase repository is not configured')
    return this.supabaseStore.withAuthToken(this.requireAuthToken(authToken))
  }

  private requireAuthToken(authToken: string | undefined): string {
    const trimmed = authToken?.trim()
    if (!trimmed) {
      throw new Error('Supabase user token is required for local runtime storage')
    }
    return trimmed
  }

  private getManageModelConfigOwnerId(user: BeeGameUserContext): string {
    return user.modelConfigOwnerId ?? user.id
  }
}

function getCreditOwnerId(user: BeeGameUserContext): string {
  return user.accountId || user.id
}

function getMaxProjectsPerUser(): number | undefined {
  const raw = process.env.BEEGAME_MAX_PROJECTS_PER_USER?.trim()
  if (!raw) return DEFAULT_MAX_PROJECTS_PER_USER
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_PROJECTS_PER_USER
  const limit = Math.floor(parsed)
  return limit > 0 ? limit : undefined
}

function toProjectLifecycleProject(
  project: BeeGameProjectMetadata,
): BeeGameProjectLifecycleProject {
  const snapshot = project.runtime_snapshot
  return {
    id: project.id,
    name: project.name,
    createdAt: project.created_at,
    ...(project.root_path ? { rootPath: project.root_path } : {}),
    lifecycle: {
      hasWorkspacePath: Boolean(project.root_path),
      hasRuntimeSnapshot: Boolean(snapshot),
      ...(snapshot?.phase_name ? { phaseName: snapshot.phase_name } : {}),
      ...(typeof snapshot?.updated_at === 'number' ? { updatedAt: snapshot.updated_at } : {}),
    },
  }
}

function toProjectLifecycleDeletion(
  event: BeeGameAuditEvent,
): BeeGameProjectLifecycleDeletion {
  const metadata = event.metadata ?? {}
  const deletedWorkspacePath = typeof metadata.deletedWorkspacePath === 'string'
    ? metadata.deletedWorkspacePath
    : undefined
  const cleanupOutcome = typeof metadata.cleanupOutcome === 'string'
    ? metadata.cleanupOutcome
    : deletedWorkspacePath
      ? 'workspace_deleted'
      : 'metadata_deleted'
  const storageCleanupOutcome = typeof metadata.storageCleanupOutcome === 'string'
    ? metadata.storageCleanupOutcome
    : undefined
  return {
    projectId: event.targetId,
    deletedAt: event.createdAt,
    cleanupOutcome,
    ...(deletedWorkspacePath ? { deletedWorkspacePath } : {}),
    ...(storageCleanupOutcome ? { storageCleanupOutcome } : {}),
  }
}

function toProjectLifecycleRetentionRun(
  event: BeeGameAuditEvent,
): BeeGameProjectLifecycleRetentionRun {
  const metadata = event.metadata ?? {}
  return {
    dryRun: metadata.dryRun === true,
    ranAt: event.createdAt,
    deploymentRecordsDeleted: numberFromMetadata(metadata.deploymentRecordsDeleted),
    deploymentRecordsRetained: numberFromMetadata(metadata.deploymentRecordsRetained),
    deploymentRecordsPlannedForDeletion: numberFromMetadata(metadata.deploymentRecordsPlannedForDeletion),
    previewRecordsSkipped: numberFromMetadata(metadata.previewRecordsSkipped),
    logRecordsSkipped: numberFromMetadata(metadata.logRecordsSkipped),
  }
}

function numberFromMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = metadata?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function normalizeWorkspaceIdentity(workspacePath: string): Promise<string> {
  const resolved = resolve(workspacePath)
  try {
    return await realpath(resolved)
  } catch {
    return resolved
  }
}
