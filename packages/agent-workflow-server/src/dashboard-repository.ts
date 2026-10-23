import {
  createModelConfig,
  deleteModelConfig,
  listModelConfigs,
  updateModelConfig,
  mapModelConfigToRuntime,
  getModelConfig,
  type ModelAuthMethod,
  type ModelProviderKind,
} from '@bee-game-studio/agent-workflow'
import { realpath } from 'node:fs/promises'
import { OPENCODE_GO_ID } from '@bee-game-studio/agent-workflow/opencode-go'
import { PERSONAL_BYOK_ID, PERSONAL_CHATGPT_ID, isPersonalModelId, personalModelAvailable, personalModelConfig, preferredModelId, resolveModelConnection } from './model-connections'
import { loadLocalImageSettings, saveLocalImageSettings, selectImageConfig, updateImageSettings } from './image-generation/config-store'
import type { ImageProviderKind } from './image-generation/config'
import { resolve } from 'node:path'
import { safeErrorFacts } from './security/safe-error-facts'
import {
  appendAuditEvent,
  listAuditEvents,
  type AppendAuditEventInput,
  type BeeGameAuditEvent,
} from './audit-events-store'
import {
  deleteMcpServer,
  exportMcpServersSnapshot,
  listMcpServers,
  upsertMcpServer,
  type McpServerConfig,
  type McpServerInput,
} from './mcp-servers-store'
import { fetchEnabledUserSkills } from '@bee-game-studio/beegame-skills-core/client'
import {
  resolveBeeGameSkillsConfig,
  type BeeGameSkillsConfig,
} from '@bee-game-studio/beegame-skills-core/config'
import {
  clearRuntimeBuiltinSkills,
  resolveBuiltinSkillsDirectory,
  materializeUserSkills,
} from '@bee-game-studio/beegame-skills-core/store'
import {
  BeeGameProjectMetadataStore,
  getBeeGameProjectDatabasePath,
  type BeeGameProjectMetadata,
} from './project-metadata-store'
import type { BeeGameAssetManifest } from './beegame/asset-contracts'
import type {
  BeeGameSessionInternalMetadata,
  BeeGameSessionUsageBillingBackend,
} from './beegame/session-manager'
import type { BeeGameDeploymentRecord } from './beegame/deployment-manager'
import type { BeeGamePreviewSnapshot } from './beegame/preview-manager'
import {
  loadRuntimeSettingsConfig,
  resolveRuntimeFeatureSettings,
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
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import type {
  BeeGameBillingCreditPack,
  BeeGameBillingCreditPackInput,
  BeeGameBillingEventInput,
  BeeGameCreditGrant,
} from '@bee-game-studio/beegame-billing-core/billing-ports'
import type { ProjectAssetStorage } from './r2-project-asset-storage'

export type DashboardRepositoryOptions = {
  dashboardDataRoot: string
  supabaseStore?: SupabaseDashboardStore
  supabaseRuntimeEnvClient?: SupabaseRuntimeEnvClient
  remoteUsageBilling?: BeeGameUsageBillingClient
  skillsConfig?: BeeGameSkillsConfig | false
  getUserDataRoot: (request?: Request) => string
  /**
   * Resolves the authenticated user's access token from the active transport.
   * The dashboard supports both Authorization headers and HttpOnly sessions,
   * so repository code must not independently assume one transport.
   */
  getAuthToken?: (request: Request) => string | undefined
  modelConfigStore?: ModelConfigStoreOptions | false
  projectAssetStorage?: ProjectAssetStorage
  /** Resolve current host permissions, including for previously saved MCP entries. */
  resolveRuntimeUser?: (userId: string, authToken?: string) => Promise<BeeGameUserContext | undefined>
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

type CreditGrantInput = {
  credits: number
  metadata?: Record<string, unknown>
}

export type {
  BeeGameBillingCreditPack,
  BeeGameBillingCreditPackInput,
  BeeGameBillingEventInput,
} from '@bee-game-studio/beegame-billing-core/billing-ports'
type CreateModelConfigInput = {
  authMethods?: ModelAuthMethod[]
  published?: boolean
  name: string
  provider: ModelProviderKind
  apiProtocol?: import('@bee-game-studio/agent-workflow').ModelApiProtocol
  baseUrl?: string
  apiKey: string
  model?: string
  isDefault?: boolean
}
type UpdateModelConfigInput = Partial<CreateModelConfigInput>

const DEFAULT_MAX_PROJECTS_PER_USER = 100
const RUNTIME_SETTINGS_ENV_KEY = 'BEEGAME_RUNTIME_SETTINGS_JSON'
const RUNTIME_SETTING_FIELDS: Array<keyof RuntimeSettingsConfig> = [
  'resourceLibraryEnabled',
]

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
  private readonly warnedSkillSyncFailures = new Set<string>()
  readonly supabaseStore?: SupabaseDashboardStore
  private readonly projectStores = new Map<
    string,
    BeeGameProjectMetadataStore
  >()

  constructor(private readonly options: DashboardRepositoryOptions) {
    this.supabaseStore = options.supabaseStore
  }

  private hasSupabaseProductionStore(): boolean {
    return Boolean(this.supabaseStore)
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

  async listProjectsPage(
    request: Request,
    user: BeeGameUserContext,
    offset: number,
    limit: number,
    search = '',
  ): Promise<{ items: BeeGameProjectMetadata[]; hasMore: boolean; total: number | null }> {
    const supabase = this.supabaseForRequest(request)
    const page = supabase
      ? await supabase.listProjectsPage(user.id, offset, limit + 1, search)
      : {
          items: this.getProjectStore(request).listProjectsPage(offset, limit + 1, search),
          total: this.getProjectStore(request).countProjects(search),
        }
    return { items: page.items.slice(0, limit), hasMore: page.items.length > limit, total: page.total }
  }

  async getProject(
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ): Promise<BeeGameProjectMetadata | undefined> {
    const supabase = this.supabaseForRequest(request)
    return supabase
      ? supabase.getProject(user.id, id)
      : this.getProjectStore(request).getProject(id)
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
      if (
        (await normalizeWorkspaceIdentity(project.root_path)) ===
        normalizedWorkspace
      ) {
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
    return (await supabase.listSessions(user.id)).filter(
      session => session.projectId === projectId,
    )
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
      ...(metadata.modelConfigId
        ? { modelConfigId: metadata.modelConfigId }
        : {}),
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
    await supabase.upsertPreviewSnapshot(user.id, metadata.projectId, snapshot)
  }

  async upsertAssetManifest(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
    manifest: BeeGameAssetManifest,
  ): Promise<BeeGameAssetManifest | undefined> {
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return undefined
    return supabase.upsertAssetManifest(user.id, metadata.projectId, manifest)
  }

  async uploadAssetFile(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
    file: File,
  ): Promise<string | undefined> {
    if (this.options.projectAssetStorage && metadata?.projectId) {
      const authToken =
        this.options.getAuthToken?.(request) ?? getBearerToken(request)
      if (!authToken)
        throw new Error('Project asset storage requires authentication')
      return this.options.projectAssetStorage.uploadAssetFile({
        ownerId: user.id,
        projectId: metadata.projectId,
        authToken,
        file,
      })
    }
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId) return undefined
    const uploadBody = file.slice(
      0,
      file.size,
      file.type || 'application/octet-stream',
    )
    return supabase.uploadAssetFile({
      ownerId: user.id,
      projectId: metadata.projectId,
      fileName: file.name,
      contentType: file.type,
      body: uploadBody,
    })
  }

  async deleteAssetFile(
    request: Request,
    user: BeeGameUserContext,
    metadata: BeeGameSessionInternalMetadata | undefined,
    storageUri: string | undefined,
  ): Promise<void> {
    if (this.options.projectAssetStorage && metadata?.projectId && storageUri) {
      const authToken =
        this.options.getAuthToken?.(request) ?? getBearerToken(request)
      if (!authToken)
        throw new Error('Project asset storage requires authentication')
      await this.options.projectAssetStorage.deleteAssetFile({
        ownerId: user.id,
        projectId: metadata.projectId,
        authToken,
        storageUri,
      })
      return
    }
    const supabase = this.supabaseForRequest(request)
    if (!supabase || !metadata?.projectId || !storageUri) return
    await supabase.deleteAssetFile(user.id, metadata.projectId, storageUri)
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
    if ((input.transport ?? 'stdio') === 'stdio' && !hasBeeGamePermission(user, 'workspace.manage'))
      throw new Error('Host MCP processes require workspace.manage')
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

  async loadRuntimeSettings(
    request: Request,
    _user: BeeGameUserContext,
  ): Promise<RuntimeSettingsConfig> {
    const supabase = this.supabaseForRequest(request)
    const saved = supabase
      ? await supabase.loadPlatformRuntimeSettings()
      : this.loadLocalPlatformRuntimeSettings(request)
    return { ...saved, ...resolveRuntimeFeatureSettings(saved) }
  }

  async loadImageGenerationConfig(request: Request, provider?: ImageProviderKind) {
    const supabase = this.supabaseForRequest(request)
    const settings = supabase ? await supabase.loadPlatformImageSettings() : loadLocalImageSettings(this.options.dashboardDataRoot)
    return selectImageConfig(settings, provider)
  }

  async saveImageGenerationConfig(request: Request, input: unknown) {
    const supabase = this.supabaseForRequest(request)
    const previous = supabase ? await supabase.loadPlatformImageSettings() : loadLocalImageSettings(this.options.dashboardDataRoot)
    const settings = updateImageSettings(previous, input)
    if (supabase) await supabase.savePlatformImageSettings(settings)
    else saveLocalImageSettings(this.options.dashboardDataRoot, settings)
    return selectImageConfig(settings)
  }

  async saveRuntimeSettings(
    request: Request,
    _user: BeeGameUserContext,
    input: RuntimeSettingsConfig,
  ): Promise<RuntimeSettingsConfig> {
    const supabase = this.supabaseForRequest(request)
    const saved = supabase
      ? await supabase.savePlatformRuntimeSettings(input)
      : saveRuntimeSettingsConfig(input, {
          dataDir: this.options.dashboardDataRoot,
        })
    return { ...saved, ...resolveRuntimeFeatureSettings(saved) }
  }

  async listModelConfigs(request: Request, user: BeeGameUserContext, management = false) {
    const supabase = this.supabaseForRequest(request)
    let configs
    if (supabase) {
      const ownerId = this.getReadModelConfigOwnerId(user)
      configs = ownerId
        ? await supabase.listPublicModelConfigs(ownerId)
        : await supabase.listRlsVisiblePublicModelConfigs()
    } else configs = listModelConfigs(this.getManageModelConfigOwnerId(user))
    if (management) return configs
    const root = this.options.getUserDataRoot(request)
    const preferred = preferredModelId(root)
    const personal = [PERSONAL_BYOK_ID, PERSONAL_CHATGPT_ID, OPENCODE_GO_ID]
      .filter(id => personalModelAvailable(root, user.id, id))
      .map(id => personalModelConfig(root, user.id, id)!)
    const published = [...configs.filter(config => config.published !== false), ...personal]
    if (preferred && published.some(config => config.id === preferred)) return published.map(config => ({ ...config, isDefault: config.id === preferred }))
    return published
  }

  async createModelConfig(
    request: Request,
    user: BeeGameUserContext,
    input: CreateModelConfigInput,
  ) {
    const supabase = this.supabaseForRequest(request)
    if (supabase)
      return supabase.createModelConfig(
        this.getManageModelConfigOwnerId(user),
        input,
      )
    const created = createModelConfig(this.getManageModelConfigOwnerId(user), input)
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
      return supabase.updateModelConfig(
        this.getManageModelConfigOwnerId(user),
        id,
        input,
      )
    }
    if (!listModelConfigs(this.getManageModelConfigOwnerId(user)).some(config => config.id === id)) return undefined
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
    if (supabase)
      return supabase.deleteModelConfig(
        this.getManageModelConfigOwnerId(user),
        id,
      )
    if (!listModelConfigs(this.getManageModelConfigOwnerId(user)).some(config => config.id === id)) return false
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
    if (isPersonalModelId(id)) return personalModelAvailable(this.options.getUserDataRoot(request), user.id, id)
    const supabase = this.supabaseForRequest(request)
    if (supabase) {
      const ownerId = this.getReadModelConfigOwnerId(user)
      return ownerId
        ? supabase.hasModelConfig(ownerId, id)
        : supabase.hasRlsVisibleModelConfig(id)
    }
    return listModelConfigs(this.getManageModelConfigOwnerId(user)).some(config => config.id === id)
  }

  async recordUsage(
    _request: Request,
    user: BeeGameUserContext,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    return this.requireRemoteUsageBilling().recordUsage(user.id, input)
  }

  async debitRealTimeUsage(
    _request: Request,
    user: BeeGameUserContext,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    return this.requireRemoteUsageBilling().debitRealTimeUsage(user.id, input)
  }

  async recordUsageForUser(
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    return this.requireRemoteUsageBilling().recordUsage(userId, input)
  }

  async debitRealTimeUsageForUser(
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    return this.requireRemoteUsageBilling().debitRealTimeUsage(userId, input)
  }

  async grantCredits(
    _request: Request,
    _targetUserId: string,
    _input: CreditGrantInput,
  ): Promise<BeeGameCreditGrant> {
    throw billingServiceOnlyError()
  }

  async grantPaymentProviderCredits(
    _request: Request,
    _targetUserId: string,
    _input: CreditGrantInput,
  ): Promise<BeeGameCreditGrant> {
    throw billingServiceOnlyError()
  }

  async listBillingCreditPacks(
    _request?: Request,
    _options: { enabledOnly?: boolean } = {},
  ): Promise<BeeGameBillingCreditPack[]> {
    throw billingServiceOnlyError()
  }

  async upsertBillingCreditPack(
    _request: Request,
    _input: BeeGameBillingCreditPackInput,
  ): Promise<BeeGameBillingCreditPack> {
    throw billingServiceOnlyError()
  }

  async appendBillingEvent(
    _request: Request | undefined,
    _input: BeeGameBillingEventInput,
  ): Promise<void> {
    throw billingServiceOnlyError()
  }

  async listBillingEvents(
    _request?: Request,
  ): Promise<BeeGameBillingEventInput[]> {
    throw billingServiceOnlyError()
  }

  createSessionUsageBillingBackend(): BeeGameSessionUsageBillingBackend {
    return {
        ...(this.options.remoteUsageBilling ? { assertUsageAvailable: (userId: string) => {
          const client = this.requireRemoteUsageBilling()
          if (!client.assertUsageAvailable) throw new Error('Usage billing authorization is unavailable')
          return client.assertUsageAvailable(userId)
        } } : {}),
        recordUsage: (userId, input) =>
          this.requireRemoteUsageBilling().recordUsage(userId, {
            sessionId: input.sessionId,
            turnId: input.turnId,
            projectId: input.projectId,
            usage: input.usage,
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata,
            pricingVersion: 'weighted-v1',
            usageSource: input.usageSource ?? 'runtime_snapshot',
          }),
        debitRealtimeUsage: (userId, input) =>
          this.requireRemoteUsageBilling().debitRealTimeUsage(userId, {
            sessionId: input.sessionId,
            turnId: input.turnId,
            projectId: input.projectId,
            usage: input.usage,
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata,
            pricingVersion: 'weighted-v1',
            usageSource: input.usageSource ?? 'runtime_snapshot',
          }),
    }
  }

  private requireRemoteUsageBilling(): BeeGameUsageBillingClient {
    if (this.options.remoteUsageBilling) return this.options.remoteUsageBilling
    throw billingServiceOnlyError()
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
    clearRuntimeBuiltinSkills({ dataDir })
    const builtinSkillsDir = resolveBuiltinSkillsDirectory()
    if (this.supabaseStore && userId) {
      const client = this.options.supabaseRuntimeEnvClient
      if (!client) {
        throw new Error(
          'Supabase runtime env must be provided by RLS/RPC; the local runtime host does not use service-role Supabase credentials',
        )
      }
      const selectedId = modelConfigId ?? preferredModelId(dataDir)
      const personal = selectedId && isPersonalModelId(selectedId) ? personalModelConfig(dataDir, userId, selectedId) : undefined
      if (personal && !personalModelAvailable(dataDir, userId, selectedId!)) throw new Error('Selected personal model is disconnected')
      const env = await client.loadRuntimeEnv({
        userId,
        dataDir,
        authToken: this.requireAuthToken(authToken),
        ...(modelConfigId && !personal ? { modelConfigId } : {}),
      }).catch(error => {
        console.error('[BeeGame runtime dependency]', JSON.stringify({
          timestamp: new Date().toISOString(), step: 'runtime_env_rpc', ...safeErrorFacts(error),
        }))
        throw error
      })
      const selectedModel = personal ? { config: personal, env: {} } : await this.supabaseForAuthToken(
            authToken,
          ).loadRlsVisibleModelRuntimeConfig(selectedId).catch(error => {
            console.error('[BeeGame runtime dependency]', JSON.stringify({
              timestamp: new Date().toISOString(), step: 'selected_model_config', ...safeErrorFacts(error),
            }))
            throw error
          })
      if (selectedId && !selectedModel) throw new Error('Selected model is no longer available')
      const selectedModelEnv = selectedModel ? resolveModelConnection(dataDir, selectedModel.config, selectedModel.env) : {}
      const runtimeSettings = this.syncRuntimeSettingsFromRuntimeEnv(env, dataDir)
      const mcpServers = await this.authorizeRuntimeMcpServers(
        await this.supabaseForAuthToken(authToken).runtimeMcpServers(userId), userId, authToken)
      await this.materializeRemoteUserSkillsSafely(userId, dataDir)
      // Supabase owns logical runtime configuration (provider credentials and
      // platform feature flags). The runtime host owns physical isolation. Do
      // not allow an RPC payload to select another user's runtime config root.
      const hostIsolationEnv = mapRuntimeSettingsToEnv(runtimeSettings, { dataDir })
      return {
        ...env,
        ...selectedModelEnv,
        ...hostIsolationEnv,
        BEEGAME_NATIVE_MCP_SERVERS_JSON: JSON.stringify(mcpServers),
        BEEGAME_CONFIG_DIR: hostIsolationEnv.BEEGAME_CONFIG_DIR,
        BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: builtinSkillsDir,
        NPM_CONFIG_CACHE: hostIsolationEnv.NPM_CONFIG_CACHE,
        npm_config_cache: hostIsolationEnv.npm_config_cache,
        NPM_CONFIG_USERCONFIG: hostIsolationEnv.NPM_CONFIG_USERCONFIG,
        npm_config_userconfig: hostIsolationEnv.npm_config_userconfig,
      }
    }
    if (userId) await this.materializeRemoteUserSkillsSafely(userId, dataDir)
    const platformEnv = this.mapLocalPlatformRuntimeSettingsToEnv(dataDir)
    const selectedId = modelConfigId ?? preferredModelId(dataDir)
    // Explicit model IDs are authorized at the request boundary. Defaults stay owner-scoped.
    const personal = selectedId && isPersonalModelId(selectedId) ? personalModelConfig(dataDir, userId ?? '', selectedId) : undefined
    if (personal && !personalModelAvailable(dataDir, userId ?? '', selectedId!)) throw new Error('Selected personal model is disconnected')
    const selected = personal ?? (selectedId ? getModelConfig(selectedId) : userId ? listModelConfigs(userId).find(config => config.isDefault) : undefined)
    if (selectedId && !selected) throw new Error('Selected model is no longer available')
    const selectedModelEnv = selected ? resolveModelConnection(dataDir, selected, mapModelConfigToRuntime(selected.id)?.env ?? {}) : {}
    return {
      ...platformEnv,
      ...selectedModelEnv,
      BEEGAME_NATIVE_MCP_SERVERS_JSON: JSON.stringify(await this.authorizeRuntimeMcpServers(
        exportMcpServersSnapshot({ dataDir }), userId, authToken)),
      BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: builtinSkillsDir,
    }
  }

  private async authorizeRuntimeMcpServers(
    servers: McpServerConfig[], userId?: string, authToken?: string,
  ): Promise<McpServerConfig[]> {
    if (servers.some(server => server.enabled && server.autoStart === true && server.transport === 'stdio')) {
      const user = userId ? await this.options.resolveRuntimeUser?.(userId, authToken) : undefined
      if (!user || user.id !== userId || !hasBeeGamePermission(user, 'workspace.manage'))
        throw new Error('Host MCP processes require workspace.manage; remove the stdio entry or contact the workspace owner')
    }
    return servers
  }

  private async materializeRemoteUserSkillsSafely(
    userId: string,
    dataDir: string,
  ): Promise<void> {
    if (this.options.skillsConfig === false) {
      materializeUserSkills([], { dataDir })
      return
    }
    const config = this.options.skillsConfig ?? resolveBeeGameSkillsConfig()
    try {
      const skills = await fetchEnabledUserSkills(config, userId)
      materializeUserSkills(skills, { dataDir })
      this.warnedSkillSyncFailures.delete(userId)
    } catch (err) {
      if (config.required) {
        throw new Error('User skills synchronization failed', { cause: err })
      }
      // Optional development mode must not execute a stale skill after the
      // user disabled or deleted it while the skills service was unavailable.
      materializeUserSkills([], { dataDir })
      if (!this.warnedSkillSyncFailures.has(userId)) {
        this.warnedSkillSyncFailures.add(userId)
        console.warn(
          '[BeeGame] User skills are temporarily unavailable; continuing without user skills:',
          err,
        )
      }
    }
  }

  private loadLocalPlatformRuntimeSettings(
    _request: Request,
  ): RuntimeSettingsConfig {
    return loadRuntimeSettingsConfig({
      dataDir: this.options.dashboardDataRoot,
    })
  }

  private mapLocalPlatformRuntimeSettingsToEnv(
    dataDir: string,
  ): Record<string, string> {
    const settings = loadRuntimeSettingsConfig({
      dataDir: this.options.dashboardDataRoot,
    })
    return mapRuntimeSettingsToEnv(settings, {
      dataDir,
    })
  }

  private syncRuntimeSettingsFromRuntimeEnv(
    env: Record<string, string>,
    dataDir: string,
  ): RuntimeSettingsConfig {
    const raw = env[RUNTIME_SETTINGS_ENV_KEY]
    delete env[RUNTIME_SETTINGS_ENV_KEY]
    const settings: RuntimeSettingsConfig = {}
    const parsed = raw ? safeParseJsonObject(raw) : undefined
    if (parsed) {
      for (const field of RUNTIME_SETTING_FIELDS) {
        if (typeof parsed[field] === 'boolean') settings[field] = parsed[field]
      }
    }
    // Host-owned isolation must be materialized even when Supabase has no
    // optional runtime feature row for this user.
    return settings
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

  private supabaseForRequest(
    request?: Request,
  ): SupabaseDashboardStore | undefined {
    if (!this.supabaseStore) return undefined
    return this.supabaseStore.withAuthToken(
      this.requireAuthToken(
        request
          ? (this.options.getAuthToken?.(request) ?? getBearerToken(request))
          : undefined,
      ),
    )
  }

  private supabaseForAuthToken(
    authToken: string | undefined,
  ): SupabaseDashboardStore {
    if (!this.supabaseStore)
      throw new Error('Supabase repository is not configured')
    return this.supabaseStore.withAuthToken(this.requireAuthToken(authToken))
  }

  private requireAuthToken(authToken: string | undefined): string {
    const trimmed = authToken?.trim()
    if (!trimmed) {
      throw new Error(
        'Supabase user token is required for local runtime storage',
      )
    }
    return trimmed
  }

  private getManageModelConfigOwnerId(user: BeeGameUserContext): string {
    return user.modelConfigOwnerId ?? user.id
  }

  private getReadModelConfigOwnerId(
    user: BeeGameUserContext,
  ): string | undefined {
    return (
      user.modelConfigOwnerId ?? (user.role === 'owner' ? user.id : undefined)
    )
  }
}

function billingServiceOnlyError(): Error {
  return new Error(
    'Billing operations are owned by the remote BeeGame billing service',
  )
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
      ...(typeof snapshot?.updated_at === 'number'
        ? { updatedAt: snapshot.updated_at }
        : {}),
    },
  }
}

function toProjectLifecycleDeletion(
  event: BeeGameAuditEvent,
): BeeGameProjectLifecycleDeletion {
  const metadata = event.metadata ?? {}
  const deletedWorkspacePath =
    typeof metadata.deletedWorkspacePath === 'string'
      ? metadata.deletedWorkspacePath
      : undefined
  const cleanupOutcome =
    typeof metadata.cleanupOutcome === 'string'
      ? metadata.cleanupOutcome
      : deletedWorkspacePath
        ? 'workspace_deleted'
        : 'metadata_deleted'
  const storageCleanupOutcome =
    typeof metadata.storageCleanupOutcome === 'string'
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
    deploymentRecordsDeleted: numberFromMetadata(
      metadata.deploymentRecordsDeleted,
    ),
    deploymentRecordsRetained: numberFromMetadata(
      metadata.deploymentRecordsRetained,
    ),
    deploymentRecordsPlannedForDeletion: numberFromMetadata(
      metadata.deploymentRecordsPlannedForDeletion,
    ),
    previewRecordsSkipped: numberFromMetadata(metadata.previewRecordsSkipped),
    logRecordsSkipped: numberFromMetadata(metadata.logRecordsSkipped),
  }
}

function numberFromMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeParseJsonObject(
  value: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

async function normalizeWorkspaceIdentity(
  workspacePath: string,
): Promise<string> {
  const resolved = resolve(workspacePath)
  try {
    return await realpath(resolved)
  } catch {
    return resolved
  }
}
