import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  listModelConfigs,
  mapModelConfigToRuntime,
  type ModelProviderKind,
} from '@bee-game-studio/agent-workflow'
import {
  BeeGameSessionManager,
  deleteSessionArtifactsFromTranscript,
  readSessionTranscriptFromDisk,
  type BeeGameEvent,
  type BeeGameRuntimeSnapshot,
  type BeeGameSession,
  type BeeGameAttachment,
  type BeeGameImageAttachment,
  type BeeGameFileAttachment,
  type BeeGameSessionLanguage,
  type BeeGameSessionRunner,
  type BeeGameSessionInternalMetadata,
} from './beegame/session-manager'
import {
  parseAttachmentBuildAnalysis,
  type AttachmentBuildAnalysis,
} from './beegame/attachment-build'
import {
  BeeGamePreviewManager,
  type BeeGamePreviewSnapshot,
  type BeeGamePreviewPortAllocator,
  type BeeGamePreviewReadinessProbe,
  type BeeGamePreviewRunner,
} from './beegame/preview-manager'
import {
  BeeGameDeploymentManager,
  createSupabaseStorageDeploymentPublisherFromEnv,
  type BeeGameDeploymentRecord,
  type BeeGameDeploymentRetentionResult,
  type BeeGameDeploymentPublisher,
  type BeeGameDeploymentRunner,
} from './beegame/deployment-manager'
import {
  readBeeGameAssetManifest,
  bindBeeGameLibraryResourceInWorkspace,
  unbindBeeGameLibraryResourceInWorkspace,
  removeBeeGameAssetIntegrationInWorkspace,
  integrateBeeGameLibraryResourceInWorkspace,
  uploadBeeGameAsset,
  type BeeGameAssetManifest,
  type BeeGameAssetSlot,
  effectiveAssetFormats,
} from './beegame/asset-contracts'
import type { ResourceSelectionRequirement, ResourceSelectionResult } from './beegame/resource-selection-client'
import { listDirectories } from './filesystem/directories'
import { getDefaultWorkspacePath } from './filesystem/default-workspace'
import {
  loadModelConfigsFromStore,
  type ModelConfigStoreOptions,
} from './model-config-store'
import {
  type BeeGameProjectMetadata,
} from './project-metadata-store'
import {
  syncRuntimeSettingsToDedicatedRuntimeConfig,
} from './runtime-settings-store'
import {
  discoverMcpServers,
  type McpServerScope,
  type McpServerTransport,
} from './mcp-servers-store'
import {
  discoverActiveMcpServers,
  parsePortList,
  testMcpServerConnection,
} from './mcp-active-discovery'
import {
  type AppendAuditEventInput,
} from './audit-events-store'
import {
  hasEnoughCreditsForIdeaIntake,
  isCreditLedgerKind,
} from './credit-store'
import {
  getCreditTaskPolicy,
  quoteCreditTask,
} from './credit-policy'
import {
  type BeeGamePermission,
  type BeeGameUserContext,
  type BeeGameUserResolver,
  DEFAULT_LOCAL_USER_ID,
  createConfiguredUserResolver,
  getBearerToken,
  hasBeeGamePermission,
  listBeeGamePermissions,
} from './auth/user-context'
import { createBeeGameAuthContext } from './auth/auth-context'
import { registerBeeGameSessionRoutes as registerHttpOnlySessionRoutes } from './auth/session-routes'
import {
  DashboardRepository,
  ProjectQuotaExceededError,
} from './dashboard-repository'
import {
  assertSessionWorkspaceIsProjectDirectory,
  createManagedProjectWorkspacePath,
  deleteWorkspaceDirectoryIfSafe,
  getDashboardDataRoot,
  getUserDashboardDataRoot,
  resolveSessionWorkspacePath,
} from './local-runtime-service'
import {
  createSupabaseDashboardStoreFromEnv,
  createSupabasePaymentProviderGrantStoreFromEnv,
} from './supabase-dashboard-store'
import {
  createSupabaseRuntimeEnvClientFromEnv,
} from './supabase-runtime-env-client'
import {
  resolveBeeGameBillingConfig,
} from '@bee-game-studio/beegame-billing-core/billing-config'
import {
  createRemoteCreditControlClient,
} from '@bee-game-studio/beegame-billing-core/credit-control-client'
import {
  registerBeeGameBillingPublicRoutes,
  registerBeeGameBillingStoreRoutes,
} from './billing-routes'
import {
  proxyBeeGameSkillsRequest,
  MAX_SKILL_REQUEST_BYTES,
} from '@bee-game-studio/beegame-skills-core/client'
import { readRequestBytes, RequestBodyLimitError } from '@bee-game-studio/beegame-skills-core/request-body'
import {
  resolveBeeGameSkillsConfig,
  type BeeGameSkillsConfig,
} from '@bee-game-studio/beegame-skills-core/config'
import {
  createPinnedUndiciDispatcher,
  resolveApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import { validateSecretStorageAtStartup } from './security/secret-crypto'
import {
  BeeGameUploadPolicyError,
  MAX_BEEGAME_REQUEST_BYTES,
  validateBeeGameAttachments,
} from './security/upload-policy'

type JsonObject = Record<string, unknown>

type BeeGameArtifactIndexItem = {
  path: string
  name: string
  artifact_type: string
  created_at: string
}

type BeeGameIntakeOption = {
  id: string
  title: string
  projectFolderName: string
  pitch: string
  gameplay: string
  coreGameplayHypothesis: string
  experienceSnapshot: string
  playerFirstMinute: string
  whyFitsIdea: string
  playablePrototype: string
  validationTarget: string
  coreMechanic: string
  firstBuild: string
  validationGoal: string
  risk: string
  fit: string
  firstPlayableValidation: string
  riskComplexity: string
  recommendedPlatform: string
  recommendedEngine?: string
  recommendedDimension: string
  recommendedGenre: string
  recommendedStyle: string
  recommendedInputs: string[]
  scope: string
}

type BeeGameClarificationOption = {
  id: string
  label: string
  description?: string
  value?: string
}

type BeeGameClarification = {
  prompt: string
  options: BeeGameClarificationOption[]
  freeformLabel?: string
}

type BeeGameIntakeAnalysis = {
  maturity: 'vague' | 'directional' | 'concrete'
  needsOptions: boolean
  needsClarification: boolean
  clarification?: BeeGameClarification
  clarificationQuestions: string[]
  detectedConstraints: string[]
  recommendedNextStep: string
  options: BeeGameIntakeOption[]
}

const BEEGAME_INTAKE_SETTING_VALUES = {
  platforms: ['Web', 'Mobile', 'PC', 'Console', 'VR/AR'],
  engines: ['React', 'Unity', 'Godot', 'Unreal'],
  dimensions: ['2D', '2.5D', '3D', 'VR', 'AR'],
  genres: ['Arcade', 'Action', 'Adventure', 'Puzzle', 'Racing', 'RPG', 'Strategy', 'Simulation', 'Shooter', 'Platformer', 'Casual'],
  styles: ['Pixel', 'Cartoon', 'Stylized', 'Minimal', 'Realistic', 'Low Poly', 'Hand-drawn', 'Sci-fi', 'Fantasy'],
  inputs: ['Keyboard/mouse', 'Touch', 'Gamepad', 'Motion', 'Voice', 'Hand tracking'],
} as const

type BeeGameThinkingMode = 'auto' | 'enabled' | 'disabled'

type BeeGameIntakeJob = {
  ownerId: string
  status: 'running' | 'completed' | 'failed'
  result?: BeeGameIntakeAnalysis
  error?: string
  createdAt: number
  updatedAt: number
}

type BeeGameAttachmentBuildJob = {
  ownerId: string
  status: 'running' | 'completed' | 'failed'
  result?: AttachmentBuildAnalysis
  error?: string
  createdAt: number
  updatedAt: number
}

export type AgentWorkflowAppOptions = {
  sessionRunner?: BeeGameSessionRunner
  previewRunner?: BeeGamePreviewRunner
  previewPortAllocator?: BeeGamePreviewPortAllocator
  previewReadinessProbe?: BeeGamePreviewReadinessProbe
  deploymentRunner?: BeeGameDeploymentRunner
  deploymentPublisher?: BeeGameDeploymentPublisher
  modelConfigStore?: ModelConfigStoreOptions | false
  dashboardDataRoot?: string
  sessionStorePath?: string
  defaultWorkspacePath?: string
  currentUser?: BeeGameUserContext
  currentUserResolver?: BeeGameUserResolver
  skillsConfig?: BeeGameSkillsConfig | false
  outboundTargetPolicyOptions?: OutboundTargetPolicyOptions
  outboundTargetResolver?: typeof resolveApprovedOutboundTarget
  resourceSelectionClient?: {
    select(requirements: ResourceSelectionRequirement[]): Promise<Array<ResourceSelectionResult>>
    candidates?(requirement: ResourceSelectionRequirement): Promise<Array<ResourceSelectionResult>>
    refreshBinding?(binding: { packId: string; packVersion: string; elementId: string; dependencies?: Array<{ key: string; elementId: string }> }): Promise<{ sourceUrl: string; dependencies: Array<{ key: string; sourceUrl: string }> }>
  }
}

export const ROUTE_PERMISSION = {
  modelConfig: 'model_config.manage',
  webTools: 'secrets.manage',
  runtimeSettings: 'runtime_settings.manage',
  mcp: 'mcp.manage',
  userSkills: 'skills.manage',
  creditsAdmin: 'credits.admin',
  lifecycleAdmin: 'lifecycle.admin',
  projectDelete: 'project.delete',
  projectExport: 'project.export',
  assetIntegration: 'assets.integrate',
} as const satisfies Record<string, BeeGamePermission>

export function createAgentWorkflowApp(
  options: AgentWorkflowAppOptions = {},
): Hono {
  validateSecretStorageAtStartup()
  const app = new Hono()
  app.onError((error, c) => {
    if (isPrivilegedConfigurationPath(c.req.path)) {
      return privilegedRouteError(c, c.req.path, error)
    }
    return tracedRouteError(c, c.req.path, error, 500)
  })
  const outboundTargetPolicyOptions: OutboundTargetPolicyOptions = {
    ...options.outboundTargetPolicyOptions,
    allowedHosts: options.outboundTargetPolicyOptions?.allowedHosts ?? readAllowedOutboundHosts(),
    allowTrustedDevelopmentProxy:
      options.outboundTargetPolicyOptions?.allowTrustedDevelopmentProxy ??
      (process.env.NODE_ENV !== 'production' && process.env.BEEGAME_ALLOW_TRUSTED_DEVELOPMENT_OUTBOUND_PROXY === '1'),
  }
  const resolveOutboundTarget = options.outboundTargetResolver ?? resolveApprovedOutboundTarget
  const hasPermittedOutboundUrl = async (value: unknown): Promise<boolean> =>
    value === undefined || value === '' ||
    (typeof value === 'string' && Boolean(await resolveOutboundTarget(value, outboundTargetPolicyOptions)))
  const assertPermittedOutboundUrl = async (value: string): Promise<void> => {
    if (!await hasPermittedOutboundUrl(value)) throw new Error('Outbound URL is not permitted')
  }
  const assertPermittedModelConfigRuntime = async (modelConfigId: string): Promise<void> => {
    const runtime = mapModelConfigToRuntime(modelConfigId)
    for (const key of [
      'ANTHROPIC_BASE_URL',
      'OPENAI_BASE_URL',
      'GEMINI_BASE_URL',
      'GROK_BASE_URL',
    ] as const) {
      const baseUrl = runtime?.env[key]
      if (baseUrl) await assertPermittedOutboundUrl(baseUrl)
    }
  }
  const dashboardDataRoot = getDashboardDataRoot(
    options.dashboardDataRoot ?? options.defaultWorkspacePath,
  )
  const supabaseStore = createSupabaseDashboardStoreFromEnv()
  const supabasePaymentProviderStore = createSupabasePaymentProviderGrantStoreFromEnv()
  const supabaseRuntimeEnvClient = supabaseStore
    ? createSupabaseRuntimeEnvClientFromEnv()
    : undefined
  const configuredUserResolver = createConfiguredUserResolver()
  const sessionAuth = registerHttpOnlySessionRoutes(app, {
    sessionStorePath: options.sessionStorePath,
  })
  const baseUserResolver = options.currentUserResolver ?? configuredUserResolver
  const requestUserResolver = sessionAuth
    ? async (request: Request) => {
      const accessToken = sessionAuth.getAccessToken(request)
      if (!accessToken) return baseUserResolver?.(request)
      const headers = new Headers(request.headers)
      if (!headers.has('authorization')) {
        headers.set('authorization', `Bearer ${accessToken}`)
      }
      return baseUserResolver?.(new Request(request, { headers }))
    }
    : baseUserResolver
  const authContext = createBeeGameAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: requestUserResolver,
  })
  const getCurrentUser = authContext.getCurrentUser
  const getCurrentUserDataRoot = (request?: Request) =>
    getUserDashboardDataRoot(dashboardDataRoot, getCurrentUser(request).id)
  const modelConfigStore = options.modelConfigStore
  if (modelConfigStore !== false && modelConfigStore !== undefined) {
    loadModelConfigsFromStore(modelConfigStore)
  }
  const billingConfig = resolveBeeGameBillingConfig()
  const skillsConfig = options.skillsConfig === false
    ? resolveBeeGameSkillsConfig()
    : options.skillsConfig ?? resolveBeeGameSkillsConfig()
  const dashboardRepository = new DashboardRepository({
    dashboardDataRoot,
    supabaseStore,
    supabasePaymentProviderStore,
    supabaseRuntimeEnvClient,
    remoteCreditControl: createRemoteCreditControlClient(billingConfig),
    skillsConfig: options.skillsConfig,
    getUserDataRoot: getCurrentUserDataRoot,
    modelConfigStore,
  })
  const intakeJobs = new Map<string, BeeGameIntakeJob>()
  const attachmentBuildJobs = new Map<string, BeeGameAttachmentBuildJob>()
  const synchronizeLibraryResources = async (metadata: BeeGameSessionInternalMetadata) => {
    if (!metadata.projectId || !options.resourceSelectionClient) return
    await autoBindLibraryResourcesInWorkspace(metadata.workspacePath, options.resourceSelectionClient)
  }
  const beeGameSessions = new BeeGameSessionManager(
    options.sessionRunner,
    dashboardDataRoot,
    (userDataRoot, userId, authToken, modelConfigId) =>
      dashboardRepository.getRuntimeEnv(
        userDataRoot,
        userId,
        authToken,
        modelConfigId,
      ),
    dashboardRepository.createSessionCreditBackend(),
    Boolean(supabaseRuntimeEnvClient),
    outboundTargetPolicyOptions,
    resolveOutboundTarget,
    synchronizeLibraryResources,
    synchronizeLibraryResources,
  )
  const beeGamePreviews = new BeeGamePreviewManager(
    options.previewRunner,
    undefined,
    options.previewPortAllocator,
    options.previewReadinessProbe,
    process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL,
  )
  const beeGameDeployments = new BeeGameDeploymentManager({
    dataRoot: dashboardDataRoot,
    runner: options.deploymentRunner,
    publisher: options.deploymentPublisher ??
      createSupabaseStorageDeploymentPublisherFromEnv(),
    publicBaseUrl: process.env.BEEGAME_DEPLOYMENT_PUBLIC_BASE_URL,
  })
  app.get('/deployments/*', async c => {
    const deployedFile = await beeGameDeployments.readPublicFile(c.req.path)
    if (!deployedFile) {
      return c.text('Not found', 404)
    }
    return new Response(deployedFile.body, {
      headers: { 'content-type': deployedFile.contentType },
    })
  })
  const handlePreviewProxy = async (c: Context) => {
    const sessionId = c.req.param('sessionId')
    if (!sessionId) return c.text('Preview not found', 404)
    const internalUrl = beeGamePreviews.internalUrl(sessionId)
    if (!internalUrl) return c.text('Preview not found', 404)
    return proxyBeeGamePreviewRequest(
      c.req.raw,
      sessionId,
      internalUrl,
      beeGamePreviews.expectsPublicPath(sessionId),
    )
  }
  app.all('/previews/:sessionId', handlePreviewProxy)
  app.all('/previews/:sessionId/*', handlePreviewProxy)
  app.use('/api/*', cors({
    origin: resolveApiCorsOrigin,
    credentials: true,
    // Deliberately omit allowHeaders: Hono reflects the browser's requested
    // headers during preflight. Combined with the explicit trusted-origin
    // policy above, this avoids a brittle duplicated list of client-internal
    // headers while preserving credentialed CORS boundaries.
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  }))
  registerBeeGameBillingPublicRoutes(app, {
    billingConfig,
    dashboardRepository,
  })
  app.use('/api/*', async (c, next) => {
    if (options.currentUser) {
      await next()
      return
    }
    const user = await authContext.resolveRequestUser(c.req.raw)
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        message: 'authentication required',
      }, 401)
    }
    await next()
  })

  app.get('/health', c => c.json({ status: 'ok' }))

  registerBeeGameBillingStoreRoutes(app, {
    billingConfig,
    dashboardRepository,
    getCurrentUser,
    hasPermission: (user, permission) =>
      hasBeeGamePermission(user as BeeGameUserContext, permission),
  })

  app.get('/api/current-user', c => {
    const user = options.currentUser ?? authContext.getCurrentUser(c.req.raw)
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        message: 'authentication required',
      }, 401)
    }
    return c.json({
      id: user.id,
      role: user.role,
      ...(user.workspaceId ? { workspaceId: user.workspaceId } : {}),
      ...(user.workspaceOwnerId ? { workspaceOwnerId: user.workspaceOwnerId } : {}),
      ...(user.modelConfigOwnerId ? { modelConfigOwnerId: user.modelConfigOwnerId } : {}),
      ...(user.email ? { email: user.email } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      permissions: listBeeGamePermissions(user),
    })
  })

  app.delete('/api/current-user', async c => {
    const user = getCurrentUser(c.req.raw)
    try {
      await dashboardRepository.deleteAuthUser(c.req.raw, user)
      return c.json({ ok: true })
    } catch (error) {
      return tracedRouteError(
        c,
        'account.delete',
        error,
        501,
        'Account deletion unavailable',
      )
    }
  })

  app.get('/api/audit-events', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'audit.read')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.listAuditEvents(c.req.raw, user))
  })

  app.get('/api/admin/projects/lifecycle', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.lifecycleAdmin)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return c.json(await dashboardRepository.getProjectLifecycleOverview(c.req.raw, user))
    } catch (error) {
      return tracedRouteError(c, 'admin.projects.lifecycle', error)
    }
  })

  app.get('/api/admin/projects/retention/plan', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.lifecycleAdmin)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return c.json(toProjectRetentionResponse(
        await beeGameDeployments.applyRetention({ dryRun: true }),
      ))
    } catch (error) {
      return tracedRouteError(c, 'admin.projects.retention.plan', error)
    }
  })

  app.post('/api/admin/projects/retention/run', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.lifecycleAdmin)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const result = toProjectRetentionResponse(
        await beeGameDeployments.applyRetention({ dryRun: false }),
      )
      await dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: 'project.retention_run',
        targetType: 'project_retention',
        targetId: 'local-deployments',
        metadata: {
          dryRun: result.dryRun,
          ...result.summary,
        },
      })
      return c.json(result)
    } catch (error) {
      return tracedRouteError(c, 'admin.projects.retention.run', error)
    }
  })

  app.get('/api/admin/credits/ledger', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.creditsAdmin)
    if (forbidden) return c.json(forbidden, 403)
    const kind = c.req.query('kind')?.trim()
    if (kind && !isCreditLedgerKind(kind)) {
      return c.json({
        error: 'Invalid request',
        message: 'kind must be one of estimate, reserve, settle, grant, refund.',
      }, 400)
    }
    const ledgerKind = kind && isCreditLedgerKind(kind) ? kind : undefined
    const userId = c.req.query('userId')?.trim()
    const projectId = c.req.query('projectId')?.trim()
    const reservationId = c.req.query('reservationId')?.trim()
    try {
      return c.json(await dashboardRepository.listCreditAuditLedger(c.req.raw, user, {
        ...(userId ? { userId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(ledgerKind ? { kind: ledgerKind } : {}),
        ...(reservationId ? { reservationId } : {}),
      }))
    } catch (error) {
      return tracedRouteError(c, 'admin.credits.ledger', error)
    }
  })

  app.get('/api/credits', async c => {
    const user = getCurrentUser(c.req.raw)
    return c.json(await dashboardRepository.getCreditBalance(c.req.raw, user))
  })

  app.get('/api/credits/ledger', async c => {
    const user = getCurrentUser(c.req.raw)
    return c.json(await dashboardRepository.listCreditLedger(c.req.raw, user))
  })

  app.get('/api/credits/summary', async c => {
    const user = getCurrentUser(c.req.raw)
    const projectId = c.req.query('projectId')?.trim()
    return c.json(await dashboardRepository.summarizeCreditLedger(
      c.req.raw,
      user,
      projectId || undefined,
    ))
  })

  app.post('/api/credits/reconcile-stale-reservations', async c => {
    const user = getCurrentUser(c.req.raw)
    const body = await readJson(c.req.raw)
    const olderThanValue = isObject(body) ? body.olderThan : undefined
    if (typeof olderThanValue !== 'string') {
      return c.json({
        error: 'Invalid request',
        message: 'olderThan must be an ISO timestamp.',
      }, 400)
    }
    const olderThan = new Date(olderThanValue)
    if (!Number.isFinite(olderThan.getTime())) {
      return c.json({
        error: 'Invalid request',
        message: 'olderThan must be an ISO timestamp.',
      }, 400)
    }
    const projectId = isObject(body) && typeof body.projectId === 'string'
      ? body.projectId.trim()
      : ''
    return c.json(await dashboardRepository.expireStaleCreditReservations(
      c.req.raw,
      user,
      {
        olderThan,
        ...(projectId ? { projectId } : {}),
        metadata: { reason: 'stale_reservation_expired' },
      },
    ))
  })

  app.post('/api/credits/reconcile-pending-session-operations', async c => {
    const user = getCurrentUser(c.req.raw)
    return c.json(await beeGameSessions.retryPendingCreditOperations(
      user.id,
      getBearerToken(c.req.raw),
    ))
  })

  app.post('/api/credits/quote', async c => {
    const user = getCurrentUser(c.req.raw)
    const body = await readJson(c.req.raw)
    const balance = await dashboardRepository.getCreditBalance(c.req.raw, user)
    return c.json(quoteCreditTask({
      taskType: isObject(body) ? body.taskType : undefined,
      balanceCredits: balance.balanceCredits,
    }))
  })

  app.get('/api/model-configs', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), ROUTE_PERMISSION.modelConfig)
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.listModelConfigs(
      c.req.raw,
      getCurrentUser(c.req.raw),
    ))
  })

  app.post('/api/model-configs', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.modelConfig)
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['name', 'provider', 'apiKey', 'models'])
    if (error) return c.json({ error }, 400)
    if (!await hasPermittedOutboundUrl(body.baseUrl)) {
      return c.json({ error: 'Outbound URL is not permitted' }, 400)
    }

    const created = await dashboardRepository.createModelConfig(c.req.raw, user, {
      name: String(body.name),
      provider: body.provider as ModelProviderKind,
      ...(typeof body.baseUrl === 'string' && body.baseUrl
        ? { baseUrl: body.baseUrl }
        : {}),
      apiKey: String(body.apiKey),
      models: toModelMap(body.models),
      isDefault: body.isDefault === true,
    })
    await dashboardRepository.appendAuditEvent(c.req.raw, user, {
      actorId: user.id,
      action: 'model_config.created',
      targetType: 'model_config',
      targetId: created.id,
      metadata: {
        provider: created.provider,
        isDefault: created.isDefault,
      },
    })
    return c.json(created)
  })

  app.patch('/api/model-configs/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.modelConfig)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const body = await readJson(c.req.raw)
      if (!await hasPermittedOutboundUrl(body.baseUrl)) {
        return c.json({ error: 'Outbound URL is not permitted' }, 400)
      }
      const updated = await dashboardRepository.updateModelConfig(c.req.raw, user, c.req.param('id'), {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.provider === 'string'
          ? { provider: body.provider as ModelProviderKind }
          : {}),
        ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
        ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
        ...(body.clearSecret === true ? { clearSecret: true } : {}),
        ...(isObject(body.models) ? { models: toModelMap(body.models) } : {}),
        ...(typeof body.isDefault === 'boolean'
          ? { isDefault: body.isDefault }
          : {}),
      })
      if (!updated) return c.json({ error: 'Model config not found' }, 404)

      await dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: 'model_config.updated',
        targetType: 'model_config',
        targetId: updated.id,
        metadata: {
          provider: updated.provider,
          isDefault: updated.isDefault,
          apiKeyChanged: typeof body.apiKey === 'string',
        },
      })
      return c.json(updated)
    } catch (err) {
      return privilegedRouteError(c, 'model-config.update', err)
    }
  })

  app.delete('/api/model-configs/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.modelConfig)
    if (forbidden) return c.json(forbidden, 403)
    const deleted = await dashboardRepository.deleteModelConfig(
      c.req.raw,
      user,
      c.req.param('id'),
    )
    if (deleted) {
      await dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: 'model_config.deleted',
        targetType: 'model_config',
        targetId: c.req.param('id'),
      })
    }
    return c.json({ deleted })
  })

  app.get('/api/web-tools', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.webTools)
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.loadWebTools(c.req.raw, user))
  })

  app.put('/api/web-tools', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.webTools)
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    if (!await hasPermittedOutboundUrl(body.tavilyEndpointUrl) ||
      !await hasPermittedOutboundUrl(body.exaEndpointUrl)) {
      return c.json({ error: 'Outbound URL is not permitted' }, 400)
    }
    const input = {
      ...(typeof body.webSearchAdapter === 'string'
        ? { webSearchAdapter: body.webSearchAdapter as never }
        : {}),
      ...(typeof body.webFetchAdapter === 'string'
        ? { webFetchAdapter: body.webFetchAdapter as never }
        : {}),
      ...(typeof body.tavilyEndpointUrl === 'string'
        ? { tavilyEndpointUrl: body.tavilyEndpointUrl }
        : {}),
      ...(typeof body.braveApiKey === 'string'
        ? { braveApiKey: body.braveApiKey }
        : {}),
      ...(typeof body.exaApiKey === 'string'
        ? { exaApiKey: body.exaApiKey }
        : {}),
      ...(typeof body.exaEndpointUrl === 'string'
        ? { exaEndpointUrl: body.exaEndpointUrl }
        : {}),
      ...(typeof body.webFetchHttpTimeoutMs === 'number'
        ? { webFetchHttpTimeoutMs: body.webFetchHttpTimeoutMs }
        : {}),
      ...(body.clearSecret === true ? { clearSecret: true } : {}),
    }
    const saved = await dashboardRepository.saveWebTools(c.req.raw, user, input)
    await dashboardRepository.appendAuditEvent(c.req.raw, user, {
      actorId: user.id,
      action: 'web_tools.updated',
      targetType: 'web_tools',
      targetId: user.id,
      metadata: {
        ...(typeof body.webSearchAdapter === 'string'
          ? { webSearchAdapter: body.webSearchAdapter }
          : {}),
        braveApiKeyChanged: typeof body.braveApiKey === 'string',
        exaApiKeyChanged: typeof body.exaApiKey === 'string',
      },
    })
    return c.json(saved)
  })

  app.get('/api/runtime-settings', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.runtimeSettings)
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.loadRuntimeSettings(c.req.raw, user))
  })

  app.put('/api/runtime-settings', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.runtimeSettings)
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const input = {
      ...(typeof body.autoMemoryEnabled === 'boolean'
        ? { autoMemoryEnabled: body.autoMemoryEnabled }
        : {}),
      ...(typeof body.autoDreamEnabled === 'boolean'
        ? { autoDreamEnabled: body.autoDreamEnabled }
        : {}),
      ...(typeof body.skillSearchEnabled === 'boolean'
        ? { skillSearchEnabled: body.skillSearchEnabled }
        : {}),
      ...(typeof body.treeSitterBashEnabled === 'boolean'
        ? { treeSitterBashEnabled: body.treeSitterBashEnabled }
        : {}),
      ...(typeof body.webBrowserToolEnabled === 'boolean'
        ? { webBrowserToolEnabled: body.webBrowserToolEnabled }
        : {}),
      ...(typeof body.bashClassifierEnabled === 'boolean'
        ? { bashClassifierEnabled: body.bashClassifierEnabled }
        : {}),
      ...(typeof body.mcpSkillsEnabled === 'boolean'
        ? { mcpSkillsEnabled: body.mcpSkillsEnabled }
        : {}),
    }
    const saved = await dashboardRepository.saveRuntimeSettings(
      c.req.raw,
      user,
      input,
    )
    syncRuntimeSettingsToDedicatedRuntimeConfig(saved, {
      dataDir: dashboardDataRoot,
    })
    await dashboardRepository.appendAuditEvent(c.req.raw, user, {
      actorId: user.id,
      action: 'runtime_settings.updated',
      targetType: 'runtime_settings',
      targetId: user.id,
      metadata: saved,
    })
    return c.json(saved)
  })

  app.get('/api/mcp-servers', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.mcp)
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.listMcpServers(c.req.raw, user))
  })

  app.get('/api/mcp-servers/discover', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await discoverMcpServers({
      dataDir: getCurrentUserDataRoot(c.req.raw),
      outboundTargetPolicyOptions,
      outboundTargetResolver: resolveOutboundTarget,
    }))
  })

  app.get('/api/mcp-servers/discover-active', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const user = getCurrentUser(c.req.raw)
    const servers = await dashboardRepository.listMcpServers(c.req.raw, user)
    return c.json(await discoverActiveMcpServers(servers, {
      ports: parsePortList(c.req.query('ports')),
      outboundTargetPolicyOptions,
      resolveOutboundTarget,
    }))
  })

  app.post('/api/mcp-servers/test', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = await validateMcpServerBody(body, hasPermittedOutboundUrl)
    if (error) return c.json({ error }, 400)
    return c.json(await testMcpServerConnection(toMcpServerInput(body), {
      outboundTargetPolicyOptions,
      resolveOutboundTarget,
    }))
  })

  app.post('/api/mcp-servers', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = await validateMcpServerBody(body, hasPermittedOutboundUrl)
    if (error) return c.json({ error }, 400)
    const user = getCurrentUser(c.req.raw)
    const saved = await dashboardRepository.upsertMcpServer(
      c.req.raw,
      user,
      toMcpServerInput(body),
    )
    await dashboardRepository.appendAuditEvent(c.req.raw, user, {
      actorId: user.id,
      action: 'mcp_server.upserted',
      targetType: 'mcp_server',
      targetId: saved.id,
      metadata: {
        transport: saved.transport,
        scope: saved.scope,
        enabled: saved.enabled,
      },
    })
    return c.json(saved)
  })

  app.put('/api/mcp-servers/:id', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = await validateMcpServerBody(body, hasPermittedOutboundUrl)
    if (error) return c.json({ error }, 400)
    const user = getCurrentUser(c.req.raw)
    const saved = await dashboardRepository.upsertMcpServer(
      c.req.raw,
      user,
      {
          ...toMcpServerInput(body),
          id: c.req.param('id'),
      },
    )
    await dashboardRepository.appendAuditEvent(c.req.raw, user, {
      actorId: user.id,
      action: 'mcp_server.upserted',
      targetType: 'mcp_server',
      targetId: saved.id,
      metadata: {
        transport: saved.transport,
        scope: saved.scope,
        enabled: saved.enabled,
      },
    })
    return c.json(saved)
  })

  app.delete('/api/mcp-servers/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const deleted = await dashboardRepository.deleteMcpServer(
      c.req.raw,
      user,
      c.req.param('id'),
    )
    if (deleted) {
      await dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: 'mcp_server.deleted',
        targetType: 'mcp_server',
        targetId: c.req.param('id'),
      })
    }
    return c.json({
      deleted,
    })
  })

  app.get('/api/user-skills', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), ROUTE_PERMISSION.userSkills)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return await proxyBeeGameSkillsRequest(skillsConfig, c.req.raw, '/api/user-skills')
    } catch (error) {
      return tracedRouteError(c, 'user-skills.list', error)
    }
  })

  app.post('/api/user-skills/import', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), ROUTE_PERMISSION.userSkills)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return await proxyBeeGameSkillsRequest(skillsConfig, c.req.raw, '/api/user-skills/import')
    } catch (err) {
      const traceId = randomUUID()
      console.warn('[BeeGame] skill import proxy failed', {
        traceId,
        reason: err instanceof RequestBodyLimitError ? 'request_too_large' : 'upstream_unavailable',
      })
      return new Response(JSON.stringify({ error: 'Skill import failed', traceId }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
  })

  app.put('/api/user-skills/:id/enabled', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), ROUTE_PERMISSION.userSkills)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return await proxyBeeGameSkillsRequest(
        skillsConfig,
        c.req.raw,
        `/api/user-skills/${encodeURIComponent(c.req.param('id'))}/enabled`,
      )
    } catch (error) {
      return tracedRouteError(c, 'user-skills.enable', error)
    }
  })

  app.delete('/api/user-skills/:id', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), ROUTE_PERMISSION.userSkills)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return await proxyBeeGameSkillsRequest(
        skillsConfig,
        c.req.raw,
        `/api/user-skills/${encodeURIComponent(c.req.param('id'))}`,
      )
    } catch (error) {
      return tracedRouteError(c, 'user-skills.delete', error)
    }
  })

  app.get('/api/filesystem/directories', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'workspace.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      return c.json(await listDirectories(c.req.query('path')))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get('/api/filesystem/default-workspace', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'workspace.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      return c.json({
        path: await getDefaultWorkspacePath({
          defaultWorkspacePath: options.defaultWorkspacePath,
        }),
      })
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get('/api/projects', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.listProjects(c.req.raw, user))
  })

  app.get('/api/resource-packs/:packId/impact', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const packId = c.req.param('packId')
    try {
      const projects = await dashboardRepository.listProjects(c.req.raw, user)
      const impacts: Array<{ projectId: string; projectName: string; slotId: string; packVersion: string; elementId: string; status?: string }> = []
      for (const project of projects) {
        if (!project.root_path) continue
        const workspacePath = await resolveSessionWorkspacePath(project.root_path, options.defaultWorkspacePath)
        const manifest = await readBeeGameAssetManifest(workspacePath)
        for (const slot of manifest.slots) {
          const binding = slot.resource_binding
          if (!binding || binding.pack_id !== packId) continue
          impacts.push({ projectId: project.id, projectName: project.name, slotId: slot.id, packVersion: binding.pack_version, elementId: binding.element_id, ...(slot.status ? { status: slot.status } : {}) })
        }
      }
      return c.json({ packId, references: impacts, projectCount: new Set(impacts.map(item => item.projectId)).size })
    } catch (err) {
      return tracedRouteError(c, 'resource-pack.impact', err)
    }
  })

  app.post('/api/projects', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['id', 'name', 'created_at'])
    if (error) return c.json({ error }, 400)
    try {
      const user = getCurrentUser(c.req.raw)
      return c.json(await dashboardRepository.upsertProject(
        c.req.raw,
        user,
        toProjectMetadata(body),
      ))
    } catch (err) {
      if (err instanceof ProjectQuotaExceededError) {
        return c.json({
          error: err.message,
          limit: err.limit,
          projectCount: err.projectCount,
        }, 429)
      }
      return tracedRouteError(c, 'project.create', err)
    }
  })

  app.patch('/api/projects/:id', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const user = getCurrentUser(c.req.raw)
    const projects = await dashboardRepository.listProjects(c.req.raw, user)
    const existing = projects
      .find(project => project.id === c.req.param('id'))
    if (!existing) return c.json({ error: 'Project not found' }, 404)
    try {
      const nextProject = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.root_path === 'string'
          ? { root_path: body.root_path }
          : {}),
        ...(isObject(body.runtime_snapshot)
          ? { runtime_snapshot: toProjectRuntimeSnapshot(body.runtime_snapshot) }
          : {}),
      }
      return c.json(await dashboardRepository.upsertProject(
        c.req.raw,
        user,
        nextProject,
      ))
    } catch (err) {
      return tracedRouteError(c, 'project.update', err)
    }
  })

  app.get('/api/projects/:id/sessions/latest', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessions = await dashboardRepository.listProjectSessions(
      c.req.raw,
      user,
      c.req.param('id'),
    )
    const latest = sessions[0]
    return latest
      ? c.json(latest)
      : c.json({ error: 'Session not found' }, 404)
  })

  app.post('/api/projects/:id/session/ensure', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const projectId = c.req.param('id')
    const body = await readOptionalJson(c.req.raw)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, projectId, dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({
        request: c.req.raw,
        user,
        project,
        body,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
        getUserDataRoot: getCurrentUserDataRoot,
        assertPermittedModelConfigRuntime,
      })
      return c.json(ensured)
    } catch (err) {
      return tracedRouteError(c, 'project.session.ensure', err)
    }
  })

  app.get('/api/projects/:id/runtime-state', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const projectId = c.req.param('id')
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, projectId, dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const state = await getBeeGameProjectRuntimeState({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        dashboardDataRoot: getDashboardDataRoot(options.defaultWorkspacePath),
        beeGameSessions,
        beeGamePreviews,
        dashboardRepository,
      })
      return c.json(state)
    } catch (err) {
      return tracedRouteError(c, 'project.runtime-state', err)
    }
  })

  app.post('/api/projects/:id/permissions/:toolUseID', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'agent.approve_tool')
    if (forbidden) return c.json(forbidden, 403)
    const projectId = c.req.param('id')
    const body = await readJson(c.req.raw)
    const decision = body.decision
    if (decision !== 'allow' && decision !== 'deny') {
      return c.json({ error: 'Permission decision must be allow or deny' }, 400)
    }
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, projectId, dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const sessionRef = await resolveBeeGameProjectSessionReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!sessionRef) return c.json({ error: 'Session not found' }, 404)
      const resolved = beeGameSessions.resolvePermission(
        sessionRef.sessionId,
        c.req.param('toolUseID'),
        {
          behavior: decision,
          remember: body.remember === true,
          ...(typeof body.message === 'string'
            ? { message: body.message }
            : {}),
        },
      )
      await appendAuditEventBestEffort('agent_permission.resolved', () =>
        dashboardRepository.appendAuditEvent(c.req.raw, user, {
          actorId: user.id,
          action: 'agent_permission.resolved',
          targetType: 'beegame_session',
          targetId: sessionRef.sessionId,
          metadata: {
            projectId,
            toolUseID: c.req.param('toolUseID'),
            decision,
            remember: body.remember === true,
          },
        }),
      )
      return c.json(resolved)
    } catch (err) {
      return tracedRouteError(c, 'project.permissions.resolve', err, 404)
    }
  })

  app.get('/api/projects/:id/preview', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const sessionRef = await resolveBeeGameProjectSessionReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!sessionRef) return c.json({ error: 'Session not found' }, 404)
      return c.json(beeGamePreviews.status(sessionRef.sessionId, sessionRef.workspacePath))
    } catch (err) {
      return tracedRouteError(c, 'project.preview', err)
    }
  })

  app.post('/api/projects/:id/preview', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({
        request: c.req.raw,
        user,
        project,
        body: {},
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
        getUserDataRoot: getCurrentUserDataRoot,
        assertPermittedModelConfigRuntime,
      })
      const snapshot = await beeGamePreviews.start({
        sessionId: ensured.session.id,
        workspacePath: ensured.binding.workspacePath,
      })
      await dashboardRepository.upsertPreviewSnapshot(
        c.req.raw,
        user,
        beeGameSessions.metadata(ensured.session.id),
        snapshot,
      )
      return c.json(snapshot)
    } catch (err) {
      return tracedRouteError(c, 'project.preview.start', err)
    }
  })

  app.post('/api/projects/:id/preview/restart', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({
        request: c.req.raw,
        user,
        project,
        body: {},
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
        getUserDataRoot: getCurrentUserDataRoot,
        assertPermittedModelConfigRuntime,
      })
      const snapshot = await beeGamePreviews.restart({
        sessionId: ensured.session.id,
        workspacePath: ensured.binding.workspacePath,
      })
      await dashboardRepository.upsertPreviewSnapshot(
        c.req.raw,
        user,
        beeGameSessions.metadata(ensured.session.id),
        snapshot,
      )
      return c.json(snapshot)
    } catch (err) {
      return tracedRouteError(c, 'project.preview.restart', err)
    }
  })

  app.delete('/api/projects/:id/preview', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const sessionRef = await resolveBeeGameProjectSessionReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!sessionRef) return c.json({ error: 'Session not found' }, 404)
      const snapshot = beeGamePreviews.stop(sessionRef.sessionId, sessionRef.workspacePath)
      await dashboardRepository.upsertPreviewSnapshot(
        c.req.raw,
        user,
        beeGameSessions.metadata(sessionRef.sessionId),
        snapshot,
      )
      return c.json(snapshot)
    } catch (err) {
      return tracedRouteError(c, 'project.preview.delete', err)
    }
  })

  app.get('/api/projects/:id/deployments', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const sessionRef = await resolveBeeGameProjectSessionReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!sessionRef) return c.json([])
      const persisted =
        (await dashboardRepository.listDeploymentRecords(
          c.req.raw,
          user,
          sessionRef.sessionId,
        )) ?? []
      const records = persisted.length > 0
        ? persisted
        : await beeGameDeployments.list(sessionRef.sessionId)
      return c.json(records)
    } catch (err) {
      return tracedRouteError(c, 'project.deployments.list', err)
    }
  })

  app.post('/api/projects/:id/deployments', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'deployment.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({
        request: c.req.raw,
        user,
        project,
        body: {},
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
        getUserDataRoot: getCurrentUserDataRoot,
        assertPermittedModelConfigRuntime,
      })
      const deployment = await beeGameDeployments.deploy({
        sessionId: ensured.session.id,
        userId: user.id,
        projectId: project.id,
        workspacePath: ensured.binding.workspacePath,
        ...(getBearerToken(c.req.raw)
          ? { authToken: getBearerToken(c.req.raw) }
          : {}),
      })
      const persisted = await dashboardRepository.upsertDeploymentRecord(
        c.req.raw,
        user,
        deployment,
      )
      return c.json(persisted || deployment)
    } catch (err) {
      return tracedRouteError(c, 'project.deployments.create', err)
    }
  })

  app.post('/api/projects/:id/deployments/:deploymentId/rollback', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'deployment.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const sessionRef = await resolveBeeGameProjectSessionReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!sessionRef) return c.json({ error: 'Session not found' }, 404)
      const persistedRecords =
        (await dashboardRepository.listDeploymentRecords(
          c.req.raw,
          user,
          sessionRef.sessionId,
        )) ?? []
      const records = persistedRecords.length > 0
        ? persistedRecords
        : await beeGameDeployments.list(sessionRef.sessionId)
      const source = records.find(record => record.id === c.req.param('deploymentId'))
      if (!source) return c.json({ error: 'Deployment not found' }, 404)
      const rollback = await beeGameDeployments.rollbackTo(source)
      const persisted = await dashboardRepository.upsertDeploymentRecord(
        c.req.raw,
        user,
        rollback,
      )
      return c.json(persisted || rollback)
    } catch (err) {
      return tracedRouteError(c, 'project.deployments.rollback', err)
    }
  })

  app.get('/api/projects/:id/assets', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const sessionRef = await resolveBeeGameProjectSessionReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!sessionRef) {
        if (!project.root_path) return c.json({ version: 1, slots: [] })
        const workspacePath = await resolveSessionWorkspacePath(
          project.root_path,
          options.defaultWorkspacePath,
        )
        return c.json(await readBeeGameAssetManifest(workspacePath))
      }
      try {
        const manifest = await readBeeGameAssetManifest(sessionRef.workspacePath)
        if (manifest.slots.length && sessionRef.live) {
          await dashboardRepository.upsertAssetManifest(
            c.req.raw,
            user,
            beeGameSessions.metadata(sessionRef.sessionId),
            manifest,
          )
        }
        return c.json(manifest)
      } catch (err) {
        if (sessionRef.live) {
          const manifest = await dashboardRepository.loadAssetManifest(
            c.req.raw,
            user,
            beeGameSessions.metadata(sessionRef.sessionId),
          )
          if (manifest) return c.json(manifest)
        }
        return tracedRouteError(c, 'project.assets.list', err)
      }
    } catch (err) {
      return tracedRouteError(c, 'project.assets.list', err)
    }
  })

  app.get('/api/projects/:id/assets/:slotId/resource-candidates', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'assets.upload')
    if (forbidden) return c.json(forbidden, 403)
    if (!options.resourceSelectionClient?.candidates) return c.json({ error: 'Resource candidates are not configured' }, 503)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({ request: c.req.raw, user, project, body: {}, defaultWorkspacePath: options.defaultWorkspacePath, beeGameSessions, dashboardRepository, getUserDataRoot: getCurrentUserDataRoot, assertPermittedModelConfigRuntime })
      const slotId = c.req.param('slotId')
      const manifest = await readBeeGameAssetManifest(ensured.binding.workspacePath)
      const slot = manifest.slots.find(item => item.id === slotId)
      const requirement = slot ? resourceRequirementForSlot(slot, manifest.project_target) : undefined
      if (!requirement) return c.json({ error: 'Asset slot has no library resource requirement' }, 422)
      if (!requirement.acceptedFormats?.length) return c.json({ error: 'Target runtime asset format capabilities are required before resource selection' }, 422)
      return c.json({ candidates: await options.resourceSelectionClient.candidates(requirement) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Resource candidates failed' }, 400)
    }
  })

  app.post('/api/projects/:id/assets/:slotId/resource-binding', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'assets.upload')
    if (forbidden) return c.json(forbidden, 403)
    if (!options.resourceSelectionClient) return c.json({ error: 'Resource selection is not configured' }, 503)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({ request: c.req.raw, user, project, body: {}, defaultWorkspacePath: options.defaultWorkspacePath, beeGameSessions, dashboardRepository, getUserDataRoot: getCurrentUserDataRoot, assertPermittedModelConfigRuntime })
      const body = await c.req.raw.json().catch(() => ({})) as { requirement?: ResourceSelectionRequirement; selection?: { packId?: string; elementId?: string } }
      const slotId = c.req.param('slotId')
      const contractManifest = await readBeeGameAssetManifest(ensured.binding.workspacePath)
      const contractSlot = contractManifest.slots.find(slot => slot.id === slotId)
      const previousBinding = contractSlot?.resource_binding
      // A browser may provide a requirement for an uncontracted slot, but it must
      // never be able to relax or replace the requirement recorded in the project
      // asset contract. Candidate IDs and signed URLs are always re-derived below.
      const requirement = contractSlot ? resourceRequirementForSlot(contractSlot, contractManifest.project_target) : body.requirement
      if (!requirement || requirement.slotId !== slotId) return c.json({ error: 'Asset requirement does not match slot' }, 400)
      if (!requirement.acceptedFormats?.length) return c.json({ error: 'Target runtime asset format capabilities are required before resource selection' }, 422)
      const selection = body.selection?.packId && body.selection.elementId
        ? (await options.resourceSelectionClient.candidates?.(requirement) ?? []).find(candidate => candidate.packId === body.selection!.packId && candidate.elementId === body.selection!.elementId)
        : (await options.resourceSelectionClient.select([requirement]))[0]
      if (!selection) return c.json({ error: 'No compatible resource was found' }, 422)
      const bound = await bindBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, requirement.slotId, {
        pack_id: selection.packId,
        pack_version: selection.packVersion,
        element_id: selection.elementId,
        ...toLibraryBinding(selection),
      })
      const result = await integrateBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, requirement.slotId)
      await dashboardRepository.upsertAssetManifest(c.req.raw, user, beeGameSessions.metadata(ensured.session.id), result.manifest)
      await dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: result.path ? 'resource.copied' : 'resource.bound',
        targetType: 'project_asset_slot',
        targetId: `${c.req.param('id')}:${requirement.slotId}`,
        metadata: {
          packId: selection.packId,
          packVersion: selection.packVersion,
          elementId: selection.elementId,
          reasons: selection.reasons,
          previousBinding: previousBinding ? {
            packId: previousBinding.pack_id,
            packVersion: previousBinding.pack_version,
            elementId: previousBinding.element_id,
          } : null,
          nextBinding: {
            packId: selection.packId,
            packVersion: selection.packVersion,
            elementId: selection.elementId,
          },
          ...(result.path ? { path: result.path } : {}),
        },
      })
      return c.json({ manifest: result.manifest, slot: result.slot, selection, ...(result.path ? { path: result.path } : {}), boundSlot: bound.slot })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Resource binding failed' }, 400)
    }
  })

  app.post('/api/projects/:id/assets/:slotId/resource-integration', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'assets.upload')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({ request: c.req.raw, user, project, body: {}, defaultWorkspacePath: options.defaultWorkspacePath, beeGameSessions, dashboardRepository, getUserDataRoot: getCurrentUserDataRoot, assertPermittedModelConfigRuntime })
      const result = await integrateBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, c.req.param('slotId'))
      await dashboardRepository.upsertAssetManifest(c.req.raw, user, beeGameSessions.metadata(ensured.session.id), result.manifest)
      await dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: result.path ? 'resource.recopied' : 'resource.integration_requested',
        targetType: 'project_asset_slot',
        targetId: `${c.req.param('id')}:${c.req.param('slotId')}`,
        metadata: {
          packId: result.slot.resource_binding?.pack_id,
          packVersion: result.slot.resource_binding?.pack_version,
          elementId: result.slot.resource_binding?.element_id,
          ...(result.path ? { path: result.path } : {}),
        },
      })
      return c.json({ manifest: result.manifest, slot: result.slot, ...(result.path ? { path: result.path } : {}) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Resource integration failed' }, 400)
    }
  })

  app.delete('/api/projects/:id/assets/:slotId/resource-integration', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'assets.upload')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({ request: c.req.raw, user, project, body: {}, defaultWorkspacePath: options.defaultWorkspacePath, beeGameSessions, dashboardRepository, getUserDataRoot: getCurrentUserDataRoot, assertPermittedModelConfigRuntime })
      const result = await removeBeeGameAssetIntegrationInWorkspace(ensured.binding.workspacePath, c.req.param('slotId'))
      await dashboardRepository.upsertAssetManifest(c.req.raw, user, beeGameSessions.metadata(ensured.session.id), result.manifest)
      await appendAuditEventBestEffort('resource.integration_removed', () => dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: 'resource.integration_removed',
        targetType: 'project_asset_slot',
        targetId: `${project.id}:${c.req.param('slotId')}`,
        metadata: {
          packId: result.slot.resource_binding?.pack_id,
          packVersion: result.slot.resource_binding?.pack_version,
          elementId: result.slot.resource_binding?.element_id,
          removedPaths: result.removedPaths,
        },
      }))
      return c.json({ manifest: result.manifest, slot: result.slot, removed_paths: result.removedPaths })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Resource integration removal failed' }, 400)
    }
  })

  app.delete('/api/projects/:id/assets/:slotId/resource-binding', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'assets.upload')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({ request: c.req.raw, user, project, body: {}, defaultWorkspacePath: options.defaultWorkspacePath, beeGameSessions, dashboardRepository, getUserDataRoot: getCurrentUserDataRoot, assertPermittedModelConfigRuntime })
      const existing = (await readBeeGameAssetManifest(ensured.binding.workspacePath)).slots.find(slot => slot.id === c.req.param('slotId'))
      if (!existing) return c.json({ error: 'Asset slot not found' }, 404)
      const existingBinding = existing.resource_binding
      if (!existingBinding) return c.json({ error: 'Asset slot has no library resource binding' }, 409)
      const result = await unbindBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, c.req.param('slotId'))
      await dashboardRepository.upsertAssetManifest(c.req.raw, user, beeGameSessions.metadata(ensured.session.id), result.manifest)
      await appendAuditEventBestEffort('resource.unbound', () => dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: 'resource.unbound',
        targetType: 'project_asset_slot',
        targetId: `${project.id}:${c.req.param('slotId')}`,
        metadata: { packId: existingBinding.pack_id, packVersion: existingBinding.pack_version, elementId: existingBinding.element_id, retainedFiles: existing.uploaded_files ?? [] },
      }))
      return c.json({ manifest: result.manifest, slot: result.slot, retained_files: existing.uploaded_files ?? [] })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Resource unbinding failed' }, 400)
    }
  })

  app.post('/api/projects/:id/assets/resource-bindings/auto', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'assets.upload')
    if (forbidden) return c.json(forbidden, 403)
    if (!options.resourceSelectionClient) return c.json({ error: 'Resource selection is not configured' }, 503)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({ request: c.req.raw, user, project, body: {}, defaultWorkspacePath: options.defaultWorkspacePath, beeGameSessions, dashboardRepository, getUserDataRoot: getCurrentUserDataRoot, assertPermittedModelConfigRuntime })
      const initialManifest = await readBeeGameAssetManifest(ensured.binding.workspacePath)
      const repairableBindings = initialManifest.slots.filter(slot => slot.resource_binding && slot.status === 'missing')
      const contractRequirements = initialManifest.slots
        .filter(slot => !slot.resource_binding && slot.status !== 'integrated')
        .map(slot => resourceRequirementForSlot(slot, initialManifest.project_target))
        .filter((requirement): requirement is ResourceSelectionRequirement => Boolean(requirement))
      // Automatic use must be fail-safe: a user can deliberately choose from
      // broader candidates, but unattended binding requires explicit semantic
      // capability tags in addition to media/format constraints.
      const requirements = contractRequirements.filter(isSafeAutomaticResourceRequirement)
      const skippedSlotIds = contractRequirements
        .filter(requirement => !isSafeAutomaticResourceRequirement(requirement))
        .map(requirement => requirement.slotId)
      const selections = requirements.length
        ? await options.resourceSelectionClient.select(requirements)
        : []
      const selectedSlotIds = new Set(selections.map(selection => selection.slotId))
      const results: Array<{ slotId: string; status: 'copied' | 'bound' | 'failed'; packId: string; elementId: string; path?: string; error?: string }> = []

      // Never silently replace a pinned resource when a project file was
      // deleted. Restore the exact Pack/version/element already recorded in
      // the binding, including its dependency closure.
      for (const slot of repairableBindings) {
        const binding = slot.resource_binding!
        try {
          const refreshBinding = options.resourceSelectionClient.refreshBinding
          if (!refreshBinding) throw new Error('Pinned resource refresh is not configured')
          const refreshed = await refreshBinding({
            packId: binding.pack_id,
            packVersion: binding.pack_version,
            elementId: binding.element_id,
            dependencies: binding.dependencies?.map(dependency => ({ key: dependency.key, elementId: dependency.element_id })),
          })
          const refreshedUrls = new Map(refreshed.dependencies.map(dependency => [dependency.key, dependency.sourceUrl]))
          await bindBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, slot.id, {
            ...binding,
            source_url: refreshed.sourceUrl,
            ...(binding.dependencies?.length ? { dependencies: binding.dependencies.map(dependency => ({ ...dependency, source_url: refreshedUrls.get(dependency.key) || dependency.source_url })) } : {}),
          })
          const integration = await integrateBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, slot.id)
          results.push({ slotId: slot.id, status: integration.path ? 'copied' : 'bound', packId: binding.pack_id, elementId: binding.element_id, ...(integration.path ? { path: integration.path } : {}) })
          await appendAuditEventBestEffort('resource.repaired', () => dashboardRepository.appendAuditEvent(c.req.raw, user, {
            actorId: user.id,
            action: integration.path ? 'resource.repaired' : 'resource.repair_requested',
            targetType: 'project_asset_slot',
            targetId: `${project.id}:${slot.id}`,
            metadata: { packId: binding.pack_id, packVersion: binding.pack_version, elementId: binding.element_id, ...(integration.path ? { path: integration.path } : {}) },
          }))
        } catch (err) {
          results.push({ slotId: slot.id, status: 'failed', packId: binding.pack_id, elementId: binding.element_id, error: toErrorMessage(err) })
        }
      }

      for (const selection of selections) {
        try {
          await bindBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, selection.slotId, {
            pack_id: selection.packId,
            pack_version: selection.packVersion,
            element_id: selection.elementId,
            ...toLibraryBinding(selection),
          })
          const integration = await integrateBeeGameLibraryResourceInWorkspace(ensured.binding.workspacePath, selection.slotId)
          const status = integration.path ? 'copied' : 'bound'
          results.push({ slotId: selection.slotId, status, packId: selection.packId, elementId: selection.elementId, ...(integration.path ? { path: integration.path } : {}) })
          await appendAuditEventBestEffort('resource.auto_bound', () => dashboardRepository.appendAuditEvent(c.req.raw, user, {
            actorId: user.id,
            action: integration.path ? 'resource.copied' : 'resource.bound',
            targetType: 'project_asset_slot',
            targetId: `${project.id}:${selection.slotId}`,
            metadata: { packId: selection.packId, packVersion: selection.packVersion, elementId: selection.elementId, reasons: selection.reasons, ...(integration.path ? { path: integration.path } : {}) },
          }))
        } catch (err) {
          const message = toErrorMessage(err)
          results.push({ slotId: selection.slotId, status: 'failed', packId: selection.packId, elementId: selection.elementId, error: message })
          await appendAuditEventBestEffort('resource.integration_failed', () => dashboardRepository.appendAuditEvent(c.req.raw, user, {
            actorId: user.id,
            action: 'resource.integration_failed',
            targetType: 'project_asset_slot',
            targetId: `${project.id}:${selection.slotId}`,
            metadata: { packId: selection.packId, packVersion: selection.packVersion, elementId: selection.elementId, error: message },
          }))
        }
      }

      const manifest = await readBeeGameAssetManifest(ensured.binding.workspacePath)
      await dashboardRepository.upsertAssetManifest(c.req.raw, user, beeGameSessions.metadata(ensured.session.id), manifest)
      return c.json({
        manifest,
        results,
        repaired_slot_ids: repairableBindings.map(slot => slot.id),
        unmatched_slot_ids: [...new Set([
          ...skippedSlotIds,
          ...requirements.map(requirement => requirement.slotId).filter(slotId => !selectedSlotIds.has(slotId)),
        ])],
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Automatic resource binding failed' }, 400)
    }
  })

  app.post('/api/projects/:id/assets/:slotId/upload', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.assetIntegration)
    if (forbidden) return c.json(forbidden, 403)
    const form = await c.req.raw.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'Missing form file' }, 400)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const ensured = await ensureBeeGameProjectSession({
        request: c.req.raw,
        user,
        project,
        body: {},
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
        getUserDataRoot: getCurrentUserDataRoot,
        assertPermittedModelConfigRuntime,
      })
      const sessionMetadata = beeGameSessions.metadata(ensured.session.id)
      const uploadedUrl = await dashboardRepository.uploadAssetFile(
        c.req.raw,
        user,
        sessionMetadata,
        file,
      )
      const result = await uploadBeeGameAsset(
        ensured.binding.workspacePath,
        c.req.param('slotId'),
        file,
        uploadedUrl,
      )
      await dashboardRepository.upsertAssetManifest(c.req.raw, user, sessionMetadata, result.manifest)
      return c.json(result)
    } catch (err) {
      const message = toErrorMessage(err)
      return tracedRouteError(
        c,
        'project.assets.upload',
        err,
        message.startsWith('Asset slot not found') ? 404 : 400,
      )
    }
  })

  app.delete('/api/projects/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
      // Ownership is the authorization boundary for deleting a project. A
      // workspace-wide administrative grant must not prevent a creator from
      // removing their own project.
      if (!project) return c.json({ deleted: false })
      const deleted = await dashboardRepository.deleteProject(
        c.req.raw,
        user,
        c.req.param('id'),
      )
      const deletedWorkspacePath = deleted && project?.root_path
        ? await deleteWorkspaceDirectoryIfSafe(project.root_path, dashboardDataRoot)
        : undefined
      const cleanupOutcome = deletedWorkspacePath
        ? 'workspace_deleted'
        : project?.root_path
          ? 'workspace_retained'
          : 'metadata_deleted'
      if (deleted) {
        await appendAuditEventBestEffort('project.deleted', () =>
          dashboardRepository.appendAuditEvent(c.req.raw, user, {
            actorId: user.id,
            action: 'project.deleted',
            targetType: 'project',
            targetId: c.req.param('id'),
            metadata: {
              cleanupOutcome,
              storageCleanupOutcome: dashboardRepository.hasSupabaseStorage()
                ? 'storage_prefix_cleanup_requested'
                : 'not_configured',
              ...(deletedWorkspacePath ? { deletedWorkspacePath } : {}),
            },
          }),
        )
      }
      return c.json({
        deleted,
        ...(deletedWorkspacePath ? { deletedWorkspacePath } : {}),
      })
    } catch (error) {
      return tracedRouteError(c, 'project.delete', error)
    }
  })

  const runBeeGameAttachmentAnalysis = async (
    request: Request,
    user: BeeGameUserContext,
    body: JsonObject,
    attachments: BeeGameAttachment[],
  ): Promise<AttachmentBuildAnalysis> => {
    const creditBalance = await dashboardRepository.getCreditBalance(request, user)
    if (!hasEnoughCreditsForIdeaIntake(creditBalance)) {
      throw new HttpError(402, {
        error: 'Insufficient credits',
        message: `Attachment analysis requires at least ${creditBalance.estimates.ideaIntake.minCredits} credit.`,
        credits: creditBalance,
      })
    }
    const modelConfigId = await resolveDefaultModelConfigId(
      request,
      user,
      typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
      async (nextRequest, requestUser, id) => dashboardRepository.modelConfigExists(nextRequest, requestUser, id),
      async (nextRequest, requestUser) => dashboardRepository.listModelConfigs(nextRequest, requestUser),
    )
    const policy = getCreditTaskPolicy('idea_intake')
    const reservedCredits = policy.reservedCredits
    const clientRequestId = getBeeGameClientRequestId(body)
    const idempotencyPrefix = clientRequestId ? `attachment_analysis:${user.id}:${clientRequestId}` : undefined
    let reservation: { id: string } | undefined
    const analysisWorkspace = await mkdtemp(join(getCurrentUserDataRoot(request), 'attachment-analysis-'))
    try {
      reservation = await dashboardRepository.reserveCredits(request, user, {
        credits: reservedCredits,
        kind: policy.taskType,
        ...(idempotencyPrefix ? { idempotencyKey: `${idempotencyPrefix}:reserve` } : {}),
        metadata: { taskType: 'attachment_analysis', ...(clientRequestId ? { clientRequestId } : {}) },
      })
      const runtimeEnv = await dashboardRepository.getRuntimeEnv(
        getCurrentUserDataRoot(request),
        user.id,
        getBearerToken(request),
        modelConfigId,
      )
      const analysis = await generateBeeGameAttachmentAnalysis({
        attachments,
        workspace: analysisWorkspace,
        language: typeof body.language === 'string' ? body.language : undefined,
        modelConfigId,
        ownerId: user.id,
        runtimeEnv,
        outboundTargetPolicyOptions,
        resolveOutboundTarget,
      })
      await dashboardRepository.settleCreditReservation(request, user, {
        reservationId: reservation.id,
        weightedTokens: reservedCredits * creditBalance.creditUnitWeightedTokens,
        ...(idempotencyPrefix ? { idempotencyKey: `${idempotencyPrefix}:settle:${reservation.id}` } : {}),
        metadata: { kind: 'attachment_analysis', ...(clientRequestId ? { clientRequestId } : {}) },
      })
      return analysis
    } catch (err) {
      if (reservation) {
        await dashboardRepository.refundCreditReservation(request, user, {
          reservationId: reservation.id,
          ...(idempotencyPrefix ? { idempotencyKey: `${idempotencyPrefix}:refund:${reservation.id}` } : {}),
          metadata: { reason: 'attachment_analysis_failed', ...(clientRequestId ? { clientRequestId } : {}) },
        }).catch(() => undefined)
      }
      throw err
    } finally {
      await rm(analysisWorkspace, { recursive: true, force: true })
    }
  }

  const runBeeGameIntake = async (
    request: Request,
    user: BeeGameUserContext,
    body: JsonObject,
  ): Promise<BeeGameIntakeAnalysis> => {
    const creditBalance = await dashboardRepository.getCreditBalance(request, user)
    if (!hasEnoughCreditsForIdeaIntake(creditBalance)) {
      throw new HttpError(402, {
        error: 'Insufficient credits',
        message: `Idea intake requires at least ${creditBalance.estimates.ideaIntake.minCredits} credit.`,
        credits: creditBalance,
      })
    }
    const modelConfigId = await resolveDefaultModelConfigId(
      request,
      user,
      typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
      async (nextRequest, requestUser, id) =>
        dashboardRepository.modelConfigExists(nextRequest, requestUser, id),
      async (nextRequest, requestUser) =>
        dashboardRepository.listModelConfigs(nextRequest, requestUser),
    )
    const policy = getCreditTaskPolicy('idea_intake')
    const reservedCredits = policy.reservedCredits
    const clientRequestId = getBeeGameClientRequestId(body)
    const idempotencyPrefix = clientRequestId
      ? `idea_intake:${user.id}:${clientRequestId}`
      : undefined
    let reservation: { id: string } | undefined
    try {
      reservation = await dashboardRepository.reserveCredits(request, user, {
        credits: reservedCredits,
        kind: policy.taskType,
        ...(idempotencyPrefix
          ? { idempotencyKey: `${idempotencyPrefix}:reserve` }
          : {}),
        metadata: {
          taskType: policy.taskType,
          displayName: policy.displayName,
          language: typeof body.language === 'string' ? body.language : undefined,
          ...(clientRequestId ? { clientRequestId } : {}),
        },
      })
      const intake = await generateBeeGameIntakeOptions({
        idea: String(body.idea),
        language:
          typeof body.language === 'string' ? body.language : undefined,
        thinkingMode: normalizeBeeGameThinkingMode(body.thinkingMode),
        ownerId: user.id,
        modelConfigId,
        runtimeEnv: await dashboardRepository.getRuntimeEnv(
          getCurrentUserDataRoot(request),
          user.id,
          getBearerToken(request),
          modelConfigId,
        ),
        outboundTargetPolicyOptions,
        resolveOutboundTarget,
      })
      await dashboardRepository.settleCreditReservation(request, user, {
        reservationId: reservation.id,
        weightedTokens: reservedCredits * creditBalance.creditUnitWeightedTokens,
        ...(idempotencyPrefix
          ? { idempotencyKey: `${idempotencyPrefix}:settle:${reservation.id}` }
          : {}),
        metadata: {
          kind: policy.taskType,
          taskType: policy.taskType,
          displayName: policy.displayName,
          ...(clientRequestId ? { clientRequestId } : {}),
        },
      })
      return intake
    } catch (err) {
      if (reservation) {
        try {
          await dashboardRepository.refundCreditReservation(request, user, {
            reservationId: reservation.id,
            ...(idempotencyPrefix
              ? { idempotencyKey: `${idempotencyPrefix}:refund:${reservation.id}` }
              : {}),
            metadata: {
              reason: 'idea_intake_failed',
              ...(clientRequestId ? { clientRequestId } : {}),
            },
          })
        } catch {
          // Keep the original intake failure visible to the caller.
        }
      }
      throw err
    }
  }

  app.post('/api/beegame-intake/options', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['idea'])
    if (error) return c.json({ error }, 400)
    try {
      const intake = await runBeeGameIntake(c.req.raw, user, body)
      return c.json({ ...intake })
    } catch (err) {
      if (err instanceof HttpError) return c.json(err.body, err.status)
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post('/api/beegame-intake/analyze-attachments', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
      const attachments = validateBeeGameAttachments(body.attachments)
      const analysis = await runBeeGameAttachmentAnalysis(c.req.raw, user, body, attachments)
      return c.json(analysis)
    } catch (err) {
      if (err instanceof HttpError) return c.json(err.body, err.status)
      if (err instanceof BeeGameUploadPolicyError) return uploadPolicyResponse(err)
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post('/api/beegame-intake/attachment-jobs', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
      const attachments = validateBeeGameAttachments(body.attachments)
      const jobId = `attachment_analysis_${randomUUID().replaceAll('-', '')}`
      const now = Date.now()
      attachmentBuildJobs.set(jobId, { ownerId: user.id, status: 'running', createdAt: now, updatedAt: now })
      setTimeout(() => attachmentBuildJobs.delete(jobId), 30 * 60 * 1000)
      void runBeeGameAttachmentAnalysis(c.req.raw, user, body, attachments)
      .then(result => {
        const job = attachmentBuildJobs.get(jobId)
        if (!job) return
        attachmentBuildJobs.set(jobId, { ...job, status: 'completed', result, updatedAt: Date.now() })
      })
      .catch(err => {
        const job = attachmentBuildJobs.get(jobId)
        if (!job) return
        attachmentBuildJobs.set(jobId, { ...job, status: 'failed', error: toErrorMessage(err), updatedAt: Date.now() })
      })
      return c.json({ jobId, status: 'running' }, 202)
    } catch (err) {
      if (err instanceof BeeGameUploadPolicyError) return uploadPolicyResponse(err)
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get('/api/beegame-intake/attachment-jobs/:jobId', async c => {
    const user = getCurrentUser(c.req.raw)
    const job = attachmentBuildJobs.get(c.req.param('jobId'))
    if (!job || job.ownerId !== user.id) return c.json({ error: 'Attachment analysis job not found' }, 404)
    if (job.status === 'completed') return c.json({ status: job.status, result: job.result })
    if (job.status === 'failed') return c.json({ status: job.status, error: job.error || 'Attachment analysis failed' })
    return c.json({ status: job.status })
  })

  app.post('/api/beegame-intake/jobs', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['idea'])
    if (error) return c.json({ error }, 400)

    const request = c.req.raw
    const jobId = `intake_${randomUUID().replaceAll('-', '')}`
    const now = Date.now()
    intakeJobs.set(jobId, {
      ownerId: user.id,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    })
    setTimeout(() => intakeJobs.delete(jobId), 30 * 60 * 1000)

    void (async () => {
      try {
        const result = await runBeeGameIntake(request, user, body)
        const job = intakeJobs.get(jobId)
        if (!job) return
        intakeJobs.set(jobId, {
          ...job,
          status: 'completed',
          result,
          updatedAt: Date.now(),
        })
      } catch (err) {
        const job = intakeJobs.get(jobId)
        if (!job) return
        intakeJobs.set(jobId, {
          ...job,
          status: 'failed',
          error: err instanceof HttpError ? getHttpErrorMessage(err.body) : toErrorMessage(err),
          updatedAt: Date.now(),
        })
      }
    })()

    return c.json({ jobId, status: 'running' }, 202)
  })

  app.get('/api/beegame-intake/jobs/:jobId', async c => {
    const user = getCurrentUser(c.req.raw)
    const job = intakeJobs.get(c.req.param('jobId'))
    if (!job || job.ownerId !== user.id) return c.json({ error: 'Intake job not found' }, 404)
    if (job.status === 'completed') {
      return c.json({ status: job.status, result: job.result })
    }
    if (job.status === 'failed') {
      return c.json({ status: job.status, error: job.error || 'Intake job failed' })
    }
    return c.json({ status: job.status })
  })

  registerBeeGameSessionRoutes(
    app,
    '/api/beegame-sessions',
    beeGameSessions,
    beeGamePreviews,
    beeGameDeployments,
    {
      defaultWorkspacePath: options.defaultWorkspacePath,
      assertPermittedModelConfigRuntime,
      getCurrentUser,
      getUserDataRoot: getCurrentUserDataRoot,
      appendAuditEvent: (request, input) =>
        dashboardRepository.appendAuditEvent(request, getCurrentUser(request), input),
      persistSessionMetadata: (request, metadata) =>
        dashboardRepository.upsertSessionMetadata(
          request,
          getCurrentUser(request),
          metadata,
        ),
      deleteSessionMetadata: (request, metadata, sessionId) =>
        dashboardRepository.deleteSessionMetadata(
          request,
          getCurrentUser(request),
          metadata,
          sessionId,
        ),
      persistPreviewSnapshot: (request, metadata, snapshot) =>
        dashboardRepository.upsertPreviewSnapshot(
          request,
          getCurrentUser(request),
          metadata,
          snapshot,
        ),
      listDeploymentRecords: (request, sessionId) =>
        dashboardRepository.listDeploymentRecords(
          request,
          getCurrentUser(request),
          sessionId,
        ),
      persistDeploymentRecord: (request, record) =>
        dashboardRepository.upsertDeploymentRecord(
          request,
          getCurrentUser(request),
          record,
        ),
      persistAssetManifest: (request, metadata, manifest) =>
        dashboardRepository.upsertAssetManifest(
          request,
          getCurrentUser(request),
          metadata,
          manifest,
        ),
      loadAssetManifest: (request, metadata) =>
        dashboardRepository.loadAssetManifest(
          request,
          getCurrentUser(request),
          metadata,
        ),
      uploadAssetFile: (request, metadata, file) =>
        dashboardRepository.uploadAssetFile(
          request,
          getCurrentUser(request),
          metadata,
          file,
        ),
      modelConfigExists: (request, user, id) =>
        dashboardRepository.modelConfigExists(request, user, id),
      listModelConfigs: (request, user) =>
        dashboardRepository.listModelConfigs(request, user),
      getProjectWorkspacePath: async (request, user, projectId) => {
        try {
          const projects = await dashboardRepository.listProjects(request, user)
          return projects.find(project => project.id === projectId)?.root_path
        } catch {
          return undefined
        }
      },
      ownsProjectWorkspacePath: (request, user, workspacePath) =>
        dashboardRepository.ownsProjectWorkspacePath(request, user, workspacePath),
    },
  )
  registerBeeGameSessionRoutes(
    app,
    '/api/console/sessions',
    beeGameSessions,
    beeGamePreviews,
    undefined,
    {
      defaultWorkspacePath: options.defaultWorkspacePath,
      assertPermittedModelConfigRuntime,
      getCurrentUser,
      getUserDataRoot: getCurrentUserDataRoot,
      appendAuditEvent: (request, input) =>
        dashboardRepository.appendAuditEvent(request, getCurrentUser(request), input),
      persistSessionMetadata: (request, metadata) =>
        dashboardRepository.upsertSessionMetadata(
          request,
          getCurrentUser(request),
          metadata,
        ),
      deleteSessionMetadata: (request, metadata, sessionId) =>
        dashboardRepository.deleteSessionMetadata(
          request,
          getCurrentUser(request),
          metadata,
          sessionId,
        ),
      persistPreviewSnapshot: (request, metadata, snapshot) =>
        dashboardRepository.upsertPreviewSnapshot(
          request,
          getCurrentUser(request),
          metadata,
          snapshot,
        ),
      persistAssetManifest: (request, metadata, manifest) =>
        dashboardRepository.upsertAssetManifest(
          request,
          getCurrentUser(request),
          metadata,
          manifest,
        ),
      loadAssetManifest: (request, metadata) =>
        dashboardRepository.loadAssetManifest(
          request,
          getCurrentUser(request),
          metadata,
        ),
      uploadAssetFile: (request, metadata, file) =>
        dashboardRepository.uploadAssetFile(
          request,
          getCurrentUser(request),
          metadata,
          file,
        ),
      modelConfigExists: (request, user, id) =>
        dashboardRepository.modelConfigExists(request, user, id),
      listModelConfigs: (request, user) =>
        dashboardRepository.listModelConfigs(request, user),
      getProjectWorkspacePath: async (request, user, projectId) => {
        try {
          const projects = await dashboardRepository.listProjects(request, user)
          return projects.find(project => project.id === projectId)?.root_path
        } catch {
          return undefined
        }
      },
      ownsProjectWorkspacePath: (request, user, workspacePath) =>
        dashboardRepository.ownsProjectWorkspacePath(request, user, workspacePath),
    },
  )

  return app
}

async function discoverBeeGameProjectArtifacts(
  workspacePath: string,
): Promise<BeeGameArtifactIndexItem[]> {
  const root = resolve(workspacePath)
  const artifacts: BeeGameArtifactIndexItem[] = []
  await collectArtifactsFromDirectory(root, 'docs', 'Document', artifacts)
  await collectArtifactsFromDirectory(root, 'transcripts', 'Transcript', artifacts)
  await collectArtifactFile(
    root,
    'assets/asset-manifest.json',
    'Asset Manifest',
    artifacts,
  )
  return artifacts.sort((a, b) => a.path.localeCompare(b.path))
}

async function collectArtifactsFromDirectory(
  workspaceRoot: string,
  relativeDirectory: string,
  artifactType: string,
  artifacts: BeeGameArtifactIndexItem[],
): Promise<void> {
  const directory = resolve(workspaceRoot, relativeDirectory)
  if (!isPathInsideWorkspace(workspaceRoot, directory)) return
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) {
      await collectArtifactsFromDirectory(
        workspaceRoot,
        relativePath,
        artifactType,
        artifacts,
      )
      continue
    }
    if (!entry.isFile() || !isDiscoverableArtifactPath(relativePath)) continue
    await collectArtifactFile(workspaceRoot, relativePath, artifactType, artifacts)
  }
}

async function collectArtifactFile(
  workspaceRoot: string,
  relativePath: string,
  artifactType: string,
  artifacts: BeeGameArtifactIndexItem[],
): Promise<void> {
  const targetPath = resolve(workspaceRoot, relativePath)
  if (!isPathInsideWorkspace(workspaceRoot, targetPath)) return
  try {
    const fileStats = await stat(targetPath)
    if (!fileStats.isFile()) return
    artifacts.push({
      path: relativePath,
      name: relativePath.split('/').filter(Boolean).at(-1) || relativePath,
      artifact_type: artifactType,
      created_at: fileStats.mtime.toISOString(),
    })
  } catch {
    return
  }
}

function isDiscoverableArtifactPath(relativePath: string): boolean {
  const normalized = relativePath.split('\\').join('/')
  if (normalized.startsWith('docs/')) return /\.md$/i.test(normalized)
  if (normalized.startsWith('transcripts/')) return /\.jsonl$/i.test(normalized)
  return normalized === 'assets/asset-manifest.json'
}

async function readBeeGameProjectArtifact(
  workspacePath: string,
  path: string,
): Promise<{ path: string; content: string }> {
  const workspaceRoot = resolve(workspacePath)
  const targetPath = isAbsolute(path)
    ? resolve(path)
    : resolve(workspaceRoot, path)
  if (!isPathInsideWorkspace(workspaceRoot, targetPath)) {
    throw new Error('Artifact path must stay inside the session workspace')
  }
  return {
    path: relative(workspaceRoot, targetPath).split('\\').join('/'),
    content: await readFile(targetPath, 'utf8'),
  }
}

function isPathInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const relativePath = relative(resolve(workspaceRoot), resolve(targetPath))
  return relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function requirePermission(
  user: BeeGameUserContext,
  permission: BeeGamePermission,
): { error: string } | undefined {
  return hasBeeGamePermission(user, permission)
    ? undefined
    : { error: 'Forbidden' }
}

function privilegedRouteError(
  c: Context,
  route: string,
  error: unknown,
): Response {
  const traceId = randomUUID()
  console.warn('[BeeGame] privileged route failed', {
    traceId,
    route,
    cause: error instanceof Error ? error.name : 'unknown_error',
  })
  return c.json({ error: 'Invalid configuration', traceId }, 400)
}

function tracedRouteError(
  c: Context,
  route: string,
  error: unknown,
  status: 400 | 404 | 500 | 501 = 400,
  publicError = 'Request failed',
): Response {
  return tracedRouteResponse(route, error, status, publicError, response => c.json(response, status))
}

function tracedRouteResponse(
  route: string,
  error: unknown,
  status: 400 | 404 | 500 | 501,
  publicError = 'Request failed',
  createResponse: (body: { error: string; traceId: string }) => Response = body =>
    Response.json(body, { status }),
): Response {
  const traceId = randomUUID()
  console.warn('[BeeGame] route failed', {
    traceId,
    route,
    cause: error instanceof Error ? error.name : 'unknown_error',
  })
  return createResponse({ error: publicError, traceId })
}

function publicSessionRouteError(
  c: Context,
  route: string,
  error: unknown,
  status: 400 | 404,
  publicErrors: readonly string[],
): Response {
  const message = toErrorMessage(error)
  if (publicErrors.includes(message)) return c.json({ error: message }, status)
  return tracedRouteError(c, route, error, status)
}

function isPrivilegedConfigurationPath(path: string): boolean {
  return [
    '/api/model-configs',
    '/api/web-tools',
    '/api/runtime-settings',
    '/api/mcp-servers',
    '/api/admin/projects',
  ].some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

function toProjectRetentionResponse(result: BeeGameDeploymentRetentionResult) {
  return {
    dryRun: result.dryRun,
    summary: {
      deploymentRecordsRetained: result.retained.length,
      deploymentRecordsPlannedForDeletion: result.plannedForDeletion.length,
      deploymentRecordsDeleted: result.deleted.length,
      deploymentArtifactsSkipped: result.skipped.length,
      previewRecordsSkipped: 1,
      logRecordsSkipped: 1,
    },
    deploymentRecords: {
      retained: result.retained,
      plannedForDeletion: result.plannedForDeletion,
      deleted: result.deleted,
      skipped: result.skipped,
    },
    previewRecords: {
      skipped: [
        {
          reason: 'local_preview_snapshots_are_in_memory_only',
        },
      ],
    },
    logs: {
      skipped: [
        {
          reason: 'log_retention_requires_persisted_log_index',
        },
      ],
    },
  }
}

function requireBeeGameSessionOwner(
  request: Request,
  sessionId: string,
  beeGameSessions: BeeGameSessionManager,
  getCurrentUser: (request?: Request) => BeeGameUserContext,
): { error: string } | undefined {
  const metadata = beeGameSessions.metadata(sessionId)
  if (!metadata) return { error: 'Session not found' }
  return metadata.userId === getCurrentUser(request).id
    ? undefined
    : { error: 'Session not found' }
}

async function resolveNewBeeGameSessionWorkspacePath(
  body: JsonObject,
  user: BeeGameUserContext,
  request: Request,
  options: {
    defaultWorkspacePath?: string
    getProjectWorkspacePath?: (
      request: Request,
      user: BeeGameUserContext,
      projectId: string,
    ) => Promise<string | undefined>
    ownsProjectWorkspacePath?: (
      request: Request,
      user: BeeGameUserContext,
      workspacePath: string,
    ) => Promise<boolean>
  },
): Promise<string> {
  if (canUseClientWorkspacePath(user) && typeof body.workspacePath === 'string') {
    const workspacePath = await resolveSessionWorkspacePath(
      body.workspacePath,
      options.defaultWorkspacePath,
    )
    await assertSessionWorkspaceIsProjectDirectory(
      workspacePath,
      options.defaultWorkspacePath,
    )
    return workspacePath
  }
  const projectName = typeof body.projectName === 'string'
    ? body.projectName
    : undefined
  const projectId = typeof body.projectId === 'string'
    ? body.projectId
    : undefined
  if (projectId && options.getProjectWorkspacePath) {
    const projectWorkspacePath = await options.getProjectWorkspacePath(
      request,
      user,
      projectId,
    )
    if (projectWorkspacePath) {
      const workspacePath = await resolveSessionWorkspacePath(
        projectWorkspacePath,
        options.defaultWorkspacePath,
      )
      await assertSessionWorkspaceIsProjectDirectory(
        workspacePath,
        options.defaultWorkspacePath,
      )
      if (
        options.ownsProjectWorkspacePath &&
        !(await options.ownsProjectWorkspacePath(request, user, workspacePath))
      ) {
        throw new Error('Project workspace does not belong to the current user')
      }
      return workspacePath
    }
  }
  return createManagedProjectWorkspacePath({
    defaultWorkspacePath: options.defaultWorkspacePath,
    userId: user.id,
    ...(projectName ? { projectName } : {}),
    ...(projectId ? { projectId } : {}),
  })
}

function canUseClientWorkspacePath(user: BeeGameUserContext): boolean {
  if (user.id === DEFAULT_LOCAL_USER_ID) return true
  return process.env.BEEGAME_ALLOW_CLIENT_WORKSPACE_PATH === '1'
}

async function optionalOwnedModelConfigId(
  request: Request,
  user: BeeGameUserContext,
  value: unknown,
  exists: (
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ) => Promise<boolean>,
): Promise<string | undefined> {
  if (typeof value !== 'string') return undefined
  const modelConfigId = value.trim()
  return modelConfigId
    ? requireOwnedModelConfigId(request, user, modelConfigId, exists)
    : undefined
}

async function resolveDefaultModelConfigId(
  request: Request,
  user: BeeGameUserContext,
  value: unknown,
  exists: (
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ) => Promise<boolean>,
  list: (
    request: Request,
    user: BeeGameUserContext,
  ) => Promise<Array<{ id: string; isDefault?: boolean }>>,
): Promise<string | undefined> {
  const requested = await optionalOwnedModelConfigId(
    request,
    user,
    value,
    exists,
  )
  if (requested) return requested

  const configs = await list(request, user)
  const modelConfigId = configs.find(config => config.isDefault)?.id ?? configs[0]?.id
  if (!modelConfigId) {
    throw new Error('No model config found. Configure a default model before generating.')
  }
  return modelConfigId
}

async function requireOwnedModelConfigId(
  request: Request,
  user: BeeGameUserContext,
  value: unknown,
  exists: (
    request: Request,
    user: BeeGameUserContext,
    id: string,
  ) => Promise<boolean>,
): Promise<string> {
  const modelConfigId = typeof value === 'string' ? value.trim() : ''
  if (!modelConfigId || !await exists(request, user, modelConfigId)) {
    throw new Error('Model config not found')
  }
  return modelConfigId
}

function normalizeBeeGameThinkingMode(value: unknown): BeeGameThinkingMode | undefined {
  return value === 'auto' || value === 'enabled' || value === 'disabled' ? value : undefined
}

function isBeeGameChatThinkingMode(value: unknown): value is 'enabled' | 'disabled' {
  return value === 'enabled' || value === 'disabled'
}

function toBeeGameThinkingRequest(value: BeeGameThinkingMode | undefined): JsonObject {
  if (value === 'enabled') return { enable_thinking: true }
  if (value === 'disabled') return { enable_thinking: false }
  return {}
}

async function generateBeeGameAttachmentAnalysis(input: {
  attachments: BeeGameAttachment[]
  workspace: string
  language?: string
  modelConfigId?: string
  ownerId: string
  runtimeEnv?: Record<string, string>
  outboundTargetPolicyOptions: OutboundTargetPolicyOptions
  resolveOutboundTarget: typeof resolveApprovedOutboundTarget
}): Promise<AttachmentBuildAnalysis> {
  const configId = input.modelConfigId ?? listModelConfigs(input.ownerId).find(config => config.isDefault)?.id
  const runtime = configId ? mapModelConfigToRuntime(configId) : undefined
  const env = { ...(runtime?.env ?? {}), ...(input.runtimeEnv ?? {}) }
  const baseUrl = env.OPENAI_BASE_URL
  const apiKey = env.OPENAI_API_KEY
  const model = env.OPENAI_DEFAULT_SONNET_MODEL ?? env.OPENAI_DEFAULT_OPUS_MODEL ?? env.OPENAI_DEFAULT_HAIKU_MODEL
  if (!baseUrl || !apiKey || !model) throw new Error('Attachment analysis requires an OpenAI-compatible model config')
  const approvedTarget = await input.resolveOutboundTarget(baseUrl, input.outboundTargetPolicyOptions)
  if (!approvedTarget) throw new Error('Outbound URL is not permitted')
  const dispatcher = createPinnedUndiciDispatcher(approvedTarget)

  try {
  const sourceType = input.attachments.some(item => item.type === 'image')
    ? input.attachments.some(item => item.type === 'file') ? 'mixed' : 'image'
    : 'gdd'
  const documentContext = input.attachments
    .filter((item): item is BeeGameFileAttachment => item.type === 'file')
    .map(item => {
      const content = Buffer.from(item.data, 'base64').toString('utf8').slice(0, 100_000)
      return `Document: ${item.filename}\nMIME: ${item.mediaType}\nContent:\n${content}`
    })
    .join('\n\n')
  const text = [
    `Attachment source type: ${sourceType}`,
    'Analyze the uploaded game design inputs and return only JSON matching the requested schema.',
    'For GDD input, preserve explicit facts and assess whether the minimum build design is complete.',
    'For image input, infer only visible design clues and attach high, medium, or low confidence to every inference.',
    'For mixed input, treat GDD facts as authoritative and report conflicts instead of silently resolving them.',
    'Schema: analysisId, sourceType, completeness, confirmedFacts, inferredDesign, missingFields, conflicts, gddDraft.',
    'confirmedFacts items: field, value, source.',
    'inferredDesign items: field, value, confidence, source.',
    'missingFields items: field, reason.',
    'conflicts items: field, gddValue, imageValue, resolution=needs_user_choice.',
    documentContext,
  ].filter(Boolean).join('\n\n')
  const imageParts = input.attachments
    .filter((item): item is BeeGameImageAttachment => item.type === 'image')
    .map(item => ({
      type: 'image_url',
      image_url: { url: `data:${item.mediaType};base64,${item.data}` },
    }))
  const response = await fetch(joinApiPath(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are the BeeGame attachment design analyst. Return JSON only. Use ${input.language || 'the user language'} for natural-language values while keeping property names in English.`,
        },
        { role: 'user', content: [{ type: 'text', text }, ...imageParts] },
      ],
    }),
    redirect: 'error',
    dispatcher,
  } as RequestInit)
  if (!response.ok) throw new Error(`Attachment analysis model request failed: ${response.status}`)
  const payload = (await response.json()) as JsonObject
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice = isObject(choices[0]) ? choices[0] : undefined
  const message = firstChoice && isObject(firstChoice.message) ? firstChoice.message : undefined
  const rawContent = message ? extractMessageContentText(message) : ''
  if (!rawContent) throw new Error('Attachment analysis model returned empty content')
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    throw new Error('Attachment analysis model returned invalid JSON')
  }
  const analysis = parseAttachmentBuildAnalysis({ ...(isObject(parsed) ? parsed : {}), analysisId: `attachment_analysis_${randomUUID().replaceAll('-', '')}` })
  if (analysis.sourceType !== sourceType) throw new Error('Attachment analysis source type did not match uploaded attachments')
  return analysis
  } finally {
    if (typeof dispatcher.close === 'function') await dispatcher.close()
  }
}

async function generateBeeGameIntakeOptions(input: {
  idea: string
  language?: string
  thinkingMode?: BeeGameThinkingMode
  ownerId: string
  modelConfigId?: string
  runtimeEnv?: Record<string, string>
  outboundTargetPolicyOptions: OutboundTargetPolicyOptions
  resolveOutboundTarget: typeof resolveApprovedOutboundTarget
}): Promise<BeeGameIntakeAnalysis> {
  const configId =
    input.modelConfigId ??
    listModelConfigs(input.ownerId).find(config => config.isDefault)?.id
  if (!configId && !input.runtimeEnv) {
    throw new Error('No default model config found')
  }

  const runtime = configId ? mapModelConfigToRuntime(configId) : undefined
  const env = {
    ...(runtime?.env ?? {}),
    ...(input.runtimeEnv ?? {}),
  }
  const baseUrl = env.OPENAI_BASE_URL
  const apiKey = env.OPENAI_API_KEY
  const model =
    env.OPENAI_DEFAULT_SONNET_MODEL ??
    env.OPENAI_DEFAULT_OPUS_MODEL ??
    env.OPENAI_DEFAULT_HAIKU_MODEL
  if (!baseUrl || !apiKey || !model) {
    throw new Error('BeeGame intake currently requires an OpenAI-compatible model config')
  }
  const approvedTarget = await input.resolveOutboundTarget(baseUrl, input.outboundTargetPolicyOptions)
  if (!approvedTarget) throw new Error('Outbound URL is not permitted')
  const dispatcher = createPinnedUndiciDispatcher(approvedTarget)

  try {
  const response = await fetch(joinApiPath(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      stream: true,
      ...toBeeGameThinkingRequest(input.thinkingMode),
      messages: [
        {
          role: 'system',
          content: [
            'You are BeeGame intake planner.',
            'First understand the game request before proposing game modes. The options are target briefs that help the user choose a direction, not full design documents and not project management delivery strategies.',
            'Return only JSON with this schema: maturity, needs_options, needs_clarification, clarification, clarification_questions, detected_constraints, recommended_next_step, options.',
            'maturity must be one of vague, directional, concrete.',
            'Set needs_options=true only when the idea is vague or broad enough that the user should choose between exactly 3 distinct directions.',
            'Set needs_options=false for concrete ideas that already specify the main platform, presentation, game mode, repeated player activity, constraints, or MVP scope; in that case return exactly one recommended option and recommended_next_step="configure_details".',
            'Do not ask the user for clarification during intake. Set needs_clarification=false, leave clarification empty, leave clarification_questions empty. When needs_options=true, return exactly 3 valid options. When needs_options=false, return exactly 1 valid option.',
            'Each option must include id, title, projectFolderName, pitch, gameplay, coreGameplayHypothesis, playerFirstMinute, whyFitsIdea, playablePrototype, validationTarget, risk, experienceSnapshot, coreMechanic, firstBuild, validationGoal, fit, firstPlayableValidation, riskComplexity, recommendedPlatform, recommendedEngine, recommendedDimension, recommendedGenre, recommendedStyle, recommendedInputs, and scope.',
            'projectFolderName must be an English lowercase kebab-case directory name based on the actual game concept, not a random identifier and not a BeeGame/dashboard name.',
            'title must be a game mode name, such as an objective, combat, puzzle, survival, race, sandbox, boss, narrative, simulation, or strategy mode name. Do not copy the user idea into the title and do not write an abstract production or delivery title.',
            'gameplay must explain the playable rules: player goal, main actions, opposition or pressure, scoring or progress, and win/fail/round end condition. Do not write abstract experience prose.',
            'The direction must be suitable for a complete game later, but this intake option should stay lightweight: name the mode, explain the core gameplay, and summarize the first target the user is choosing.',
            'Do not write full GDD, art direction, UI/UX specification, asset inventory, or implementation plan in intake options. Those belong to the confirmed planning/build stage.',
            'Every option must be experience-first and gameplay-first, not implementation-first. Platform and presentation are supporting metadata, not the main point.',
            'The production setting fields are selected values, not optional suggestions. Choose them by understanding the full user request and the proposed game mode, not by keyword matching.',
            'Choose recommendedPlatform only from: Web, Mobile, PC, Console, VR/AR.',
            'Choose recommendedEngine only from: React, Unity, Godot, Unreal.',
            'Choose recommendedDimension only from: 2D, 2.5D, 3D, VR, AR.',
            'Choose recommendedGenre only from: Arcade, Action, Adventure, Puzzle, Racing, RPG, Strategy, Simulation, Shooter, Platformer, Casual.',
            'Choose recommendedStyle only from: Pixel, Cartoon, Stylized, Minimal, Realistic, Low Poly, Hand-drawn, Sci-fi, Fantasy.',
            'Choose recommendedInputs as a JSON array containing one or more values only from: Keyboard/mouse, Touch, Gamepad, Motion, Voice, Hand tracking.',
            'recommendedPlatform, recommendedEngine, recommendedDimension, recommendedGenre, recommendedStyle, and recommendedInputs are selected production settings and must use the exact English enum tokens above. Do not translate these enum token values.',
            'These selected production settings must fit the request; do not force a specific platform, engine, genre, style, input model, or implementation stack.',
            'Choose production settings from the actual game direction and user constraints, not from a fixed menu order or default.',
            'Do not output Auto or placeholder values for recommended metadata.',
            'coreGameplayHypothesis must state the playable assumption being tested, in the form "if players do X under Y pressure, Z fun/decision should emerge".',
            'experienceSnapshot must let the user imagine what they will see and feel on screen when the first playable exists.',
            'playerFirstMinute must describe exactly what the player does in the first 60 seconds.',
            'whyFitsIdea must explain how this game mode preserves the user request and constraints.',
            'playablePrototype must describe the concrete first playable slice for this mode, including scene/map, player actions, feedback, win/fail state, and what is intentionally deferred until planning.',
            'validationTarget must describe what demand, fun, control feel, clarity, or risk this game mode validates.',
            'coreMechanic must name the main repeatable interaction or decision, not a production task.',
            'firstBuild must describe the first target for this direction in a concise way. It should help the user choose the game mode, not replace the later design documents.',
            'validationGoal must describe what design assumption this playable validates.',
            'risk must describe the largest gameplay or delivery risk in plain language.',
            'At least one option must stay faithful to the original idea. Do not transform explicit user constraints such as genre, platform, perspective, controls, reference game, or intended fidelity unless the option clearly explains that it is a lower-cost validation alternative.',
            'fit must explain why this direction suits the user idea.',
            'firstPlayableValidation must explain what the first playable build validates.',
            'riskComplexity must explain the main delivery risk and complexity level.',
            'Avoid generic production strategy titles. Titles should name an actual game mode.',
            'For each option, make gameplay a concise natural-language rules description that the user can immediately understand. Do not output internal rubric names or template section labels in visible option text.',
            'Reject vague options that only say "add levels", "add items", or "make it fun" without explaining the player decisions and failure pressure.',
            'Do not mention dashboard source paths, package paths, commands, or implementation directories.',
            input.language
              ? `Use this selected UI language for every user-facing natural-language JSON value: ${input.language}. Keep JSON property names in English. Keep code, commands, file paths, package names, API identifiers, and unavoidable technical names unchanged.`
              : 'Keep the response language aligned with the user idea. Keep JSON property names in English. Keep code, commands, file paths, package names, API identifiers, and unavoidable technical names unchanged.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Game idea: ${input.idea}`,
        },
      ],
    }),
    redirect: 'error',
    dispatcher,
  } as RequestInit)
  if (!response.ok) {
    throw new Error(
      await describeModelIntakeFailure(response, {
        baseUrl,
        model,
        language: input.language,
      }),
    )
  }
  return parseBeeGameIntakeResponse(response)
  } finally {
    if (typeof dispatcher.close === 'function') await dispatcher.close()
  }
}

async function parseBeeGameIntakeResponse(response: Response): Promise<BeeGameIntakeAnalysis> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.toLowerCase().includes('text/event-stream')) {
    const content = await readOpenAiCompatibleStreamContent(response)
    logBeeGameIntakeStreamDebug('complete', {
      contentLength: content.length,
      contentPreview: previewForLog(content, 4000),
    })
    return parseBeeGameIntakeAnalysis({
      choices: [
        {
          message: { content },
        },
      ],
    })
  }
  const payload = (await response.json()) as JsonObject
  return parseBeeGameIntakeAnalysis(payload)
}

async function readOpenAiCompatibleStreamContent(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const startedAt = Date.now()
  let buffer = ''
  let content = ''
  let done = false
  let rawChunkCount = 0
  let eventCount = 0
  let contentChunkCount = 0

  const processEvent = (eventText: string) => {
    const data = eventText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trim())
      .join('\n')
    if (!data) return
    eventCount += 1
    if (data === '[DONE]') {
      logBeeGameIntakeStreamDebug('event_done', {
        eventCount,
        elapsedMs: Date.now() - startedAt,
        accumulatedContentLength: content.length,
      })
      done = true
      return
    }
    logBeeGameIntakeStreamDebug('event_data', {
      eventCount,
      dataLength: data.length,
      dataPreview: previewForLog(data, 2000),
    })
    let event: JsonObject
    try {
      event = JSON.parse(data) as JsonObject
    } catch {
      throw new Error('Model intake stream chunk was not valid JSON')
    }
    const choices = Array.isArray(event.choices) ? event.choices : []
    for (const choice of choices) {
      if (!isObject(choice)) continue
      const delta = isObject(choice.delta) ? choice.delta : undefined
      const message = isObject(choice.message) ? choice.message : undefined
      const deltaContent = delta ? extractMessageContentText(delta) : ''
      const messageContent = message ? extractMessageContentText(message) : ''
      const nextContent = deltaContent || messageContent
      if (nextContent) {
        contentChunkCount += 1
        content += nextContent
        logBeeGameIntakeStreamDebug('content_delta', {
          contentChunkCount,
          deltaLength: nextContent.length,
          accumulatedContentLength: content.length,
          deltaPreview: previewForLog(nextContent, 1200),
        })
      }
    }
  }

  while (!done) {
    const next = await reader.read()
    if (next.done) break
    const decoded = normalizeSseNewlines(decoder.decode(next.value, { stream: true }))
    rawChunkCount += 1
    logBeeGameIntakeStreamDebug('raw_chunk', {
      rawChunkCount,
      elapsedMs: Date.now() - startedAt,
      chunkLength: decoded.length,
      chunkPreview: previewForLog(decoded, 2000),
    })
    buffer += decoded
    let eventEnd = buffer.indexOf('\n\n')
    while (eventEnd >= 0) {
      processEvent(buffer.slice(0, eventEnd))
      buffer = buffer.slice(eventEnd + 2)
      eventEnd = buffer.indexOf('\n\n')
    }
  }
  buffer += normalizeSseNewlines(decoder.decode())
  if (buffer.trim()) processEvent(buffer)
  return content
}

function normalizeSseNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function logBeeGameIntakeStreamDebug(event: string, details: JsonObject): void {
  if (process.env.BEEGAME_INTAKE_STREAM_DEBUG !== '1') return
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    details,
  }
  const logPath = process.env.BEEGAME_INTAKE_STREAM_LOG_PATH || resolve('beegame-intake-stream-debug.jsonl')
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    console.warn('[beegame-intake-stream] failed_to_write_log_file', {
      logPath,
      error: toErrorMessage(err),
    })
  }
}

function previewForLog(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`
}

async function describeModelIntakeFailure(
  response: Response,
  input: {
    baseUrl: string
    model: string
    language?: string
  },
): Promise<string> {
  const upstreamMessage = await readShortResponseText(response)
  const host = safeUrlHost(input.baseUrl)
  const context = [
    host ? `provider=${host}` : '',
    input.model ? `model=${input.model}` : '',
  ].filter(Boolean).join(', ')
  const suffix = context ? ` (${context})` : ''
  const detail = upstreamMessage ? ` Upstream response: ${upstreamMessage}` : ''
  if (response.status === 401 || response.status === 403) {
    return isZhLanguage(input.language)
      ? `平台默认模型认证失败（${response.status}）。请让管理员在系统设置的平台模型中重新保存有效 API Key。${suffix}${detail}`
      : `Platform default model authentication failed (${response.status}). Ask an administrator to re-save a valid API key in platform model settings.${suffix}${detail}`
  }
  return isZhLanguage(input.language)
    ? `模型 intake 请求失败：${response.status}。请检查平台模型 Base URL、Model 和供应商服务状态。${suffix}${detail}`
    : `Model intake request failed: ${response.status}. Check the platform model base URL, model, and provider status.${suffix}${detail}`
}

async function readShortResponseText(response: Response): Promise<string> {
  const text = (await response.text().catch(() => '')).trim()
  if (!text) return ''
  return text.replace(/\s+/g, ' ').slice(0, 240)
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
}

function isZhLanguage(value: string | undefined): boolean {
  return Boolean(value && value.toLowerCase().startsWith('zh'))
}

function parseBeeGameIntakeAnalysis(payload: JsonObject): BeeGameIntakeAnalysis {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice = choices[0]
  const message =
    isObject(firstChoice) && isObject(firstChoice.message)
      ? firstChoice.message
      : undefined
  const content = message ? extractMessageContentText(message) : ''
  const parsed = parseJsonObjectFromText(content)
  const rawNeedsOptions = getBooleanField(parsed, 'needsOptions', 'needs_options')
  const directOptions = Array.isArray(parsed.options) ? parsed.options : []
  const derivedOptions = directOptions.length === 0
    ? getClarificationChoiceIntakeOptions(parsed)
    : []
  const options = directOptions.length > 0 ? directOptions : derivedOptions
  const normalized: BeeGameIntakeOption[] = []
  const rejectedReasons: string[] = []
  for (let index = 0; index < options.length; index += 1) {
    const intakeOption = normalizeBeeGameIntakeOption(
      options[index],
      rejectedReasons,
      index,
    )
    if (intakeOption) normalized.push(intakeOption)
  }
  const derivedOptionsFromClarification = derivedOptions.length > 0 && normalized.length > 0
  if (normalized.length === 0) {
    const keys = Object.keys(parsed).join(', ') || 'none'
    const reason = rejectedReasons.slice(0, 3).join('; ')
    throw new Error(
      `Model intake response did not include valid options. Parsed keys: ${keys}${reason ? `. Rejected: ${reason}` : ''}`,
    )
  }
  const maturity = normalizeMaturity(parsed.maturity)
  const needsOptions = derivedOptionsFromClarification
    ? normalized.length > 1
    : rawNeedsOptions ?? maturity !== 'concrete'
  const expectedOptionCount = needsOptions ? 3 : 1
  if (normalized.length < expectedOptionCount) {
    const keys = Object.keys(parsed).join(', ') || 'none'
    throw new Error(
      `Model intake response did not include enough valid options. Expected ${expectedOptionCount}, received ${normalized.length}. Parsed keys: ${keys}`,
    )
  }
  return {
    maturity,
    needsOptions,
    needsClarification: false,
    clarificationQuestions: [],
    detectedConstraints: getStringArrayField(parsed, 'detectedConstraints', 'detected_constraints'),
    recommendedNextStep: derivedOptionsFromClarification
      ? 'choose_direction'
      : getStringField(parsed, 'recommendedNextStep', 'recommended_next_step') || (maturity === 'concrete' ? 'configure_details' : 'choose_direction'),
    options: normalized.slice(0, expectedOptionCount),
  }
}

function getClarificationChoiceIntakeOptions(value: JsonObject): JsonObject[] {
  const questions = value.clarificationQuestions ?? value.clarification_questions
  if (!Array.isArray(questions)) return []
  const question = questions.find(item => isObject(item))
  if (!isObject(question)) return []
  const choices = Array.isArray(question.options) ? question.options : []
  return choices
    .map((choice, index): JsonObject | undefined => {
      if (!isObject(choice)) return undefined
      const label = getStringField(choice, 'label')
      if (!label) return undefined
      const description = getStringField(choice, 'description')
      return {
        id: getStringField(choice, 'id') || `mode_${index + 1}`,
        title: label,
        pitch: description || label,
        gameplay: description || label,
        fit: description || label,
      }
    })
    .filter((choice): choice is JsonObject => Boolean(choice))
}

function extractMessageContentText(message: JsonObject): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (!isObject(item)) return ''
        const text = item.text ?? item.content
        return typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  const parsed = message.parsed
  if (isObject(parsed)) return JSON.stringify(parsed)
  return ''
}

function normalizeBeeGameIntakeOption(
  value: unknown,
  rejectedReasons?: string[],
  optionIndex = 0,
): BeeGameIntakeOption | undefined {
  if (!isObject(value)) {
    rejectedReasons?.push('option was not an object')
    return undefined
  }
  const rawInputs = getStringListField(value, 'recommendedInputs', 'recommended_inputs', 'selectedInputs', 'selected_inputs')
  const selectedInputs = pickAllowedProductionInputs(rawInputs)
  const gameplay = String(value.gameplay || '').trim()
  const pitch = String(value.pitch || '').trim() || gameplay
  const option = {
    id: String(value.id || '').trim() || `mode_${optionIndex + 1}`,
    title: String(value.title || '').trim(),
    projectFolderName: getStringField(value, 'projectFolderName', 'project_folder_name'),
    pitch,
    gameplay,
    coreGameplayHypothesis: getStringField(value, 'coreGameplayHypothesis', 'core_gameplay_hypothesis') || gameplay,
    experienceSnapshot: getStringField(value, 'experienceSnapshot', 'experience_snapshot') || pitch,
    playerFirstMinute: getStringField(value, 'playerFirstMinute', 'player_first_minute') || gameplay,
    whyFitsIdea: getStringField(value, 'whyFitsIdea', 'why_fits_idea') || getStringField(value, 'fit') || pitch,
    playablePrototype: getStringField(value, 'playablePrototype', 'playable_prototype') || getStringField(value, 'firstBuild', 'first_build') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    validationTarget: getStringField(value, 'validationTarget', 'validation_target') || getStringField(value, 'validationGoal', 'validation_goal') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    coreMechanic: getStringField(value, 'coreMechanic', 'core_mechanic') || getStringField(value, 'coreGameplayHypothesis', 'core_gameplay_hypothesis') || gameplay,
    firstBuild: getStringField(value, 'firstBuild', 'first_build') || getStringField(value, 'playablePrototype', 'playable_prototype') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    validationGoal: getStringField(value, 'validationGoal', 'validation_goal') || getStringField(value, 'validationTarget', 'validation_target') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    risk: getStringField(value, 'risk') || getStringField(value, 'riskComplexity', 'risk_complexity') || 'Complexity depends on selected scope.',
    fit: getStringField(value, 'fit') || pitch,
    firstPlayableValidation: getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    riskComplexity: getStringField(value, 'riskComplexity', 'risk_complexity') || 'Complexity depends on selected scope.',
    recommendedPlatform: pickAllowedProductionSetting(getFirstStringishField(value, 'recommendedPlatform', 'recommended_platform', 'selectedPlatform', 'selected_platform'), BEEGAME_INTAKE_SETTING_VALUES.platforms),
    recommendedEngine: pickAllowedProductionSetting(getFirstStringishField(value, 'recommendedEngine', 'recommended_engine', 'selectedEngine', 'selected_engine'), BEEGAME_INTAKE_SETTING_VALUES.engines),
    recommendedDimension: pickAllowedProductionSetting(getFirstStringishField(value, 'recommendedDimension', 'recommended_dimension', 'selectedDimension', 'selected_dimension'), BEEGAME_INTAKE_SETTING_VALUES.dimensions),
    recommendedGenre: pickAllowedProductionSetting(getFirstStringishField(value, 'recommendedGenre', 'recommended_genre', 'selectedGenre', 'selected_genre'), BEEGAME_INTAKE_SETTING_VALUES.genres),
    recommendedStyle: pickAllowedProductionSetting(getFirstStringishField(value, 'recommendedStyle', 'recommended_style', 'selectedStyle', 'selected_style'), BEEGAME_INTAKE_SETTING_VALUES.styles),
    recommendedInputs: selectedInputs,
    scope: getStringishField(value, 'scope'),
  }
  if (
    !option.title ||
    !option.gameplay ||
    !option.recommendedPlatform ||
    !option.recommendedEngine ||
    !option.recommendedDimension ||
    !option.recommendedGenre ||
    !option.recommendedStyle ||
    option.recommendedInputs.length === 0 ||
    option.recommendedInputs.length !== rawInputs.length
  ) {
    rejectedReasons?.push(
      [
        !option.title ? 'title' : '',
        !option.gameplay ? 'gameplay' : '',
        !option.recommendedPlatform ? 'recommendedPlatform' : '',
        !option.recommendedEngine ? 'recommendedEngine' : '',
        !option.recommendedDimension ? 'recommendedDimension' : '',
        !option.recommendedGenre ? 'recommendedGenre' : '',
        !option.recommendedStyle ? 'recommendedStyle' : '',
        option.recommendedInputs.length === 0 || option.recommendedInputs.length !== rawInputs.length ? 'recommendedInputs' : '',
      ].filter(Boolean).join(', '),
    )
    return undefined
  }
  return option
}

function normalizeMaturity(value: unknown): 'vague' | 'directional' | 'concrete' {
  return value === 'directional' || value === 'concrete' || value === 'vague'
    ? value
    : 'vague'
}

function getBooleanField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): boolean | undefined {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  return typeof candidate === 'boolean' ? candidate : undefined
}

function getStringField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): string {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function getStringishField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): string {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  if (typeof candidate === 'string') return candidate.trim()
  if (Array.isArray(candidate)) {
    return candidate
      .map(item => String(item).trim())
      .filter(Boolean)
      .join(', ')
  }
  return ''
}

function getFirstStringishField(value: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = getStringishField(value, key)
    if (candidate) return candidate
  }
  return ''
}

function getStringListField(value: JsonObject, ...keys: string[]): string[] {
  for (const key of keys) {
    const candidate = value[key]
    if (Array.isArray(candidate)) {
      const values = candidate.map(item => String(item).trim()).filter(Boolean)
      if (values.length > 0) return values
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim()
      if (trimmed) return [trimmed]
    }
  }
  return []
}

function pickAllowedProductionSetting<T extends string>(
  value: string,
  allowed: readonly T[],
): T | '' {
  return allowed.includes(value as T) ? value as T : ''
}

function pickAllowedProductionInputs(values: string[]): string[] {
  const allowed = BEEGAME_INTAKE_SETTING_VALUES.inputs
  return values.filter((value): value is typeof allowed[number] => allowed.includes(value as typeof allowed[number]))
}

function getStringArrayField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): string[] {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  return Array.isArray(candidate)
    ? candidate.map(item => String(item)).filter(Boolean)
    : []
}

function parseJsonObjectFromText(text: string): JsonObject {
  try {
    return JSON.parse(text) as JsonObject
  } catch {
    const fenced = extractFencedJson(text)
    if (fenced) {
      try {
        return JSON.parse(fenced) as JsonObject
      } catch {
        // Fall through to balanced object scanning.
      }
    }
    const objectText = extractFirstBalancedJsonObject(text)
    if (!objectText) throw new Error('Model intake response was not JSON')
    try {
      return JSON.parse(objectText) as JsonObject
    } catch {
      throw new Error('Model intake response was not valid JSON')
    }
  }
}

function extractFencedJson(text: string): string | undefined {
  const fenceStart = text.indexOf('```')
  if (fenceStart < 0) return undefined
  const contentStart = text.indexOf('\n', fenceStart)
  if (contentStart < 0) return undefined
  const fenceEnd = text.indexOf('```', contentStart + 1)
  if (fenceEnd < 0) return undefined
  return text.slice(contentStart + 1, fenceEnd).trim()
}

function extractFirstBalancedJsonObject(text: string): string | undefined {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = inString
        continue
      }
      if (char === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (char === '{') depth += 1
      if (char === '}') {
        depth -= 1
        if (depth === 0) {
          const candidate = text.slice(start, index + 1)
          try {
            JSON.parse(candidate)
            return candidate
          } catch {
            break
          }
        }
      }
    }
  }
  return undefined
}

function joinApiPath(baseUrl: string, path: string): string {
  return `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}${path}`
}

async function getOwnedProjectMetadata(
  request: Request,
  user: BeeGameUserContext,
  projectId: string,
  repository: DashboardRepository,
): Promise<BeeGameProjectMetadata | undefined> {
  return (await repository.listProjects(request, user))
    .find(project => project.id === projectId)
}

async function ensureBeeGameProjectSession(input: {
  request: Request
  user: BeeGameUserContext
  project: BeeGameProjectMetadata
  body: JsonObject
  defaultWorkspacePath?: string
  beeGameSessions: BeeGameSessionManager
  dashboardRepository: DashboardRepository
  getUserDataRoot: (request?: Request) => string
  assertPermittedModelConfigRuntime: (modelConfigId: string) => Promise<void>
}): Promise<{
  session: BeeGameSession
  binding: {
    projectId: string
    sessionId: string
    workspacePath: string
    language?: BeeGameSessionLanguage
  }
  previousSessionId?: string
}> {
  const latest = await getLatestProjectSessionMetadata(input)
  const live = findLiveProjectSession(
    input.beeGameSessions,
    input.user.id,
    input.project.id,
  )
  const language = isBeeGameSessionLanguage(input.body.language)
    ? input.body.language
    : undefined
  const workspacePath = await resolveSessionWorkspacePath(
    input.project.root_path || latest?.workspacePath || '',
    input.defaultWorkspacePath,
  )
  if (
    input.user.id !== DEFAULT_LOCAL_USER_ID &&
    !(await input.dashboardRepository.ownsProjectWorkspacePath(input.request, input.user, workspacePath))
  ) {
    throw new Error('Project workspace does not belong to the current user')
  }

  if (live && normalizeResolvedPath(live.cwd) === normalizeResolvedPath(workspacePath)) {
    const metadata = input.beeGameSessions.metadata(live.id)
    await input.dashboardRepository.upsertSessionMetadata(
      input.request,
      input.user,
      metadata,
    )
    return {
      session: live,
      binding: createProjectSessionBinding(input.project.id, live.id, workspacePath),
    }
  }

  if (latest?.modelConfigId) await input.assertPermittedModelConfigRuntime(latest.modelConfigId)
  const session = input.beeGameSessions.start({
    workspacePath,
    projectId: input.project.id,
    ...(latest?.id ? { transcriptSessionId: latest.id } : {}),
    ...(latest?.modelConfigId ? { modelConfigId: latest.modelConfigId } : {}),
    ...(language ? { language } : {}),
    userId: input.user.id,
    ...(getBearerToken(input.request) ? { authToken: getBearerToken(input.request) } : {}),
    userDataRoot: input.getUserDataRoot(input.request),
  })
  const metadata = input.beeGameSessions.metadata(session.id)
  await input.dashboardRepository.upsertSessionMetadata(
    input.request,
    input.user,
    metadata,
  )
  return {
    session,
    binding: createProjectSessionBinding(input.project.id, session.id, workspacePath, language),
    ...(latest?.id && latest.id !== session.id ? { previousSessionId: latest.id } : {}),
  }
}

async function getBeeGameProjectRuntimeState(input: {
  request: Request
  user: BeeGameUserContext
  project: BeeGameProjectMetadata
  defaultWorkspacePath?: string
  dashboardDataRoot?: string
  beeGameSessions: BeeGameSessionManager
  beeGamePreviews: BeeGamePreviewManager
  dashboardRepository: DashboardRepository
}): Promise<JsonObject> {
  const sessionRef = await resolveBeeGameProjectSessionReference(input)
  if (!sessionRef) {
    return createIdleProjectRuntimeState(input.project.id)
  }
  const events = await getProjectRuntimeEvents({
    sessionId: sessionRef.sessionId,
    workspacePath: sessionRef.workspacePath,
    dashboardDataRoot: input.dashboardDataRoot,
    beeGameSessions: input.beeGameSessions,
  })
  const snapshot = getProjectRuntimeSnapshot({
    sessionId: sessionRef.sessionId,
    workspacePath: sessionRef.workspacePath,
    beeGameSessions: input.beeGameSessions,
  })
  const pending = getPendingBeeGamePermissionEvents(events)
  const runtime = deriveBeeGameRuntimeStatus(events, pending, snapshot?.phaseStatus === 'recovered')
  const preview = getProjectPreviewSnapshot({
    sessionId: sessionRef.sessionId,
    workspacePath: sessionRef.workspacePath,
    beeGamePreviews: input.beeGamePreviews,
  })
  return {
    project_id: input.project.id,
    phase: runtime.phase,
    blocked: pending.length > 0 || runtime.agentStatus === 'failed',
    blocked_reason: pending[0]?.text ?? (runtime.agentStatus === 'failed' ? runtime.nextAction : null),
    active_agents: runtime.activeAgents,
    updated_at: runtime.updatedAt,
    approval_required: pending.length > 0,
    next_action: runtime.nextAction,
    context: deriveBeeGameContextVisibility(events, snapshot),
    build_report: preview ? previewSnapshotToProjectBuildReport(preview) : null,
    review_status: null,
    model_config_id: sessionRef.live?.modelConfigId ?? sessionRef.latest?.modelConfigId ?? snapshot?.modelConfigId ?? null,
    pending_permissions: pending.map(pendingBeeGamePermissionToJson),
  }
}

async function getLatestProjectSessionMetadata(input: {
  request: Request
  user: BeeGameUserContext
  project: BeeGameProjectMetadata
  dashboardRepository: DashboardRepository
}): Promise<Awaited<ReturnType<DashboardRepository['listProjectSessions']>>[number] | undefined> {
  return (await input.dashboardRepository.listProjectSessions(
    input.request,
    input.user,
    input.project.id,
  ))[0]
}

function findLiveProjectSession(
  beeGameSessions: BeeGameSessionManager,
  userId: string,
  projectId: string,
): BeeGameSession | undefined {
  return beeGameSessions
    .list(userId)
    .find(session => beeGameSessions.metadata(session.id)?.projectId === projectId)
}

function createProjectSessionBinding(
  projectId: string,
  sessionId: string,
  workspacePath: string,
  language?: BeeGameSessionLanguage,
): {
  projectId: string
  sessionId: string
  workspacePath: string
  language?: BeeGameSessionLanguage
} {
  return {
    projectId,
    sessionId,
    workspacePath,
    ...(language ? { language } : {}),
  }
}

async function getProjectRuntimeEvents(input: {
  sessionId: string
  workspacePath: string
  dashboardDataRoot?: string
  beeGameSessions: BeeGameSessionManager
}): Promise<BeeGameEvent[]> {
  try {
    return input.beeGameSessions.events(input.sessionId)
  } catch (err) {
    if (toErrorMessage(err) !== 'Session not found') throw err
    const transcript = await readSessionTranscriptFromDisk(
      input.sessionId,
      input.workspacePath,
      input.dashboardDataRoot,
    )
    return closeInterruptedTranscriptTurns(input.sessionId, transcript)
      .map(event => ({
        ...event,
        sessionId: event.sessionId || input.sessionId,
        createdAt: new Date(event.createdAt),
      }))
  }
}

function getProjectRuntimeSnapshot(input: {
  sessionId: string
  workspacePath: string
  beeGameSessions: BeeGameSessionManager
}): BeeGameRuntimeSnapshot | undefined {
  try {
    return input.beeGameSessions.runtimeSnapshot(input.sessionId, input.workspacePath)
  } catch {
    return undefined
  }
}

function getProjectPreviewSnapshot(input: {
  sessionId: string
  workspacePath: string
  beeGamePreviews: BeeGamePreviewManager
}): BeeGamePreviewSnapshot | undefined {
  try {
    return input.beeGamePreviews.status(input.sessionId, input.workspacePath)
  } catch {
    return undefined
  }
}

function createIdleProjectRuntimeState(projectId: string): JsonObject {
  const updatedAt = new Date().toISOString()
  return {
    project_id: projectId,
    phase: 'idle',
    blocked: false,
    blocked_reason: null,
    active_agents: [],
    updated_at: updatedAt,
    approval_required: false,
    next_action: 'Ready for next request',
    context: null,
    build_report: null,
    review_status: null,
    model_config_id: null,
    pending_permissions: [],
  }
}

async function resolveBeeGameProjectSessionReference(input: {
  request: Request
  user: BeeGameUserContext
  project: BeeGameProjectMetadata
  defaultWorkspacePath?: string
  beeGameSessions: BeeGameSessionManager
  dashboardRepository: DashboardRepository
}): Promise<{
  sessionId: string
  workspacePath: string
  live?: BeeGameSession
  latest?: Awaited<ReturnType<DashboardRepository['listProjectSessions']>>[number]
} | undefined> {
  const latest = await getLatestProjectSessionMetadata(input)
  const live = findLiveProjectSession(
    input.beeGameSessions,
    input.user.id,
    input.project.id,
  )
  const sessionId = live?.id || latest?.id || inferBeeGameSessionIdFromProjectId(input.project.id)
  const workspacePath = live?.cwd || input.project.root_path || latest?.workspacePath
  if (!sessionId || !workspacePath) return undefined
  return {
    sessionId,
    workspacePath: await resolveSessionWorkspacePath(
      workspacePath,
      input.defaultWorkspacePath,
    ),
    ...(live ? { live } : {}),
    ...(latest ? { latest } : {}),
  }
}

function getPendingBeeGamePermissionEvents(events: BeeGameEvent[]): BeeGameEvent[] {
  const resolved = new Set(
    events
      .filter(event => event.type === 'permission.resolved')
      .map(event => getBeeGamePayloadString(event, 'toolUseID'))
      .filter(Boolean),
  )
  return events
    .filter(event => event.type === 'permission.requested')
    .filter(event => {
      const toolUseID = getBeeGamePayloadString(event, 'toolUseID')
      return toolUseID && !resolved.has(toolUseID)
    })
}

function pendingBeeGamePermissionToJson(event: BeeGameEvent): JsonObject {
  const toolUseID = getBeeGamePayloadString(event, 'toolUseID') || event.id.toString()
  const toolName = getBeeGamePayloadString(event, 'toolName') || ''
  return {
    id: toolUseID,
    session_id: event.sessionId,
    event_id: event.id,
    tool_name: toolName,
    message: event.text,
    created_at: normalizeBeeGameCreatedAt(event.createdAt),
    input: event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>).input ?? null
      : null,
  }
}

function deriveBeeGameRuntimeStatus(
  events: BeeGameEvent[],
  pending: BeeGameEvent[],
  recoveredFromTranscript = false,
): {
  phase: string
  nextAction: string
  updatedAt: string
  activeAgents: string[]
  agentStatus: string
} {
  const latest = events.at(-1)
  const updatedAt = normalizeBeeGameCreatedAt(latest?.createdAt) || new Date().toISOString()
  if (pending.length > 0) {
    return {
      phase: 'waiting_approval',
      nextAction: 'Review BeeGame permission request',
      updatedAt,
      activeAgents: ['beegame'],
      agentStatus: 'waiting',
    }
  }
  const activeTurn = getActiveBeeGameTurn(events)
  if (activeTurn) {
    return recoveredFromTranscript
      ? {
          phase: 'idle',
          nextAction: 'Ready for next request',
          updatedAt,
          activeAgents: [],
          agentStatus: 'idle',
        }
      : {
          phase: 'running',
          nextAction: 'BeeGame is processing',
          updatedAt,
          activeAgents: ['beegame'],
          agentStatus: 'working',
        }
  }
  if (latest?.type === 'turn.failed' || latest?.type === 'session.failed') {
    return {
      phase: 'paused',
      nextAction: latest.text || 'BeeGame turn failed',
      updatedAt,
      activeAgents: [],
      agentStatus: 'failed',
    }
  }
  return {
    phase: 'idle',
    nextAction: 'Ready for next request',
    updatedAt,
    activeAgents: [],
    agentStatus: 'idle',
  }
}

function getActiveBeeGameTurn(events: BeeGameEvent[]): string {
  const ended = new Set(
    events
      .filter(event =>
        event.type === 'turn.completed' ||
        event.type === 'turn.empty' ||
        event.type === 'turn.failed' ||
        event.type === 'result' ||
        event.type === 'session.stopped' ||
        event.type === 'session.failed'
      )
      .map(event => event.turnId)
      .filter(Boolean),
  )
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn.started' && event.turnId && !ended.has(event.turnId)) {
      return event.turnId
    }
  }
  return ''
}

function deriveBeeGameContextVisibility(
  events: BeeGameEvent[],
  snapshot?: BeeGameRuntimeSnapshot,
): JsonObject | null {
  const usage = getLatestBeeGameTokenUsage(events) ?? snapshot?.usage
  const observation = [...events].reverse().find(event => event.type === 'runtime.observation')
  if (!usage && !observation) return null
  const counters = isObject(observation?.payload?.counters)
    ? observation.payload.counters
    : {}
  return {
    bundle_id: observation ? `beegame-runtime-${observation.sessionId}` : 'beegame-runtime',
    phase: getBeeGamePayloadString(observation, 'phase') || snapshot?.phaseName || 'idle',
    status: getBeeGamePayloadString(observation, 'status') || 'active',
    summary: 'BeeGame runtime observability is active for this session.',
    blackboard_record_count: Number(counters.eventCount ?? events.length),
    memory_hits: Number(counters.toolUseCount ?? events.filter(event => event.type.startsWith('tool.')).length),
    rag_sources: observation ? ['transcripts/<project-folder>__<session-hash>.jsonl'] : [],
    selected_skills: [],
    runtime_features: [],
    ...(usage ? {
      token_budget: {
        status: 'tracking',
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      },
    } : {}),
    counters: {
      eventCount: Number(counters.eventCount ?? events.length),
      toolUseCount: Number(counters.toolUseCount ?? events.filter(event => event.type.startsWith('tool.')).length),
      turnIndex: Number(counters.turnIndex ?? 0),
    },
  }
}

function getLatestBeeGameTokenUsage(events: BeeGameEvent[]): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} | null {
  for (const event of [...events].reverse()) {
    const usage = getBeeGameUsageFromPayload(event.payload)
    if (usage) return usage
  }
  return null
}

function getBeeGameUsageFromPayload(payload: unknown): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} | null {
  if (!isObject(payload)) return null
  const usage = isObject(payload.usage) ? payload.usage : undefined
  if (!usage) return null
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens) || 0
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens) || 0
  const totalTokens = Number(usage.total_tokens) || promptTokens + completionTokens
  return totalTokens > 0
    ? {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      }
    : null
}

function previewSnapshotToProjectBuildReport(preview: BeeGamePreviewSnapshot): JsonObject | null {
  if (preview.status === 'idle' && !preview.url) return null
  const running = preview.status === 'running' && Boolean(preview.url)
  const unavailable = preview.status === 'failed' || preview.status === 'unsupported'
  return {
    status: running ? 'passed' : unavailable ? 'failed' : preview.status,
    entrypoint: preview.entrypoint || '',
    report_path: '',
    build_url: running ? preview.url : '',
    agents: ['dashboard-preview'],
    generated_paths: [],
    checks: [{
      name: preview.script || 'preview',
      status: running ? 'passed' : preview.status,
      detail: preview.message || '',
      path: '',
    }],
    summary: running
      ? `Managed preview available at ${preview.url}`
      : preview.message || 'Preview is not running',
    failure_reason: unavailable ? preview.message || 'Preview unavailable' : '',
    created_at: preview.updatedAt,
  }
}

async function proxyBeeGamePreviewRequest(
  request: Request,
  sessionId: string,
  internalBaseUrl: string,
  preservePublicPath = false,
): Promise<Response> {
  const requestUrl = new URL(request.url)
  const prefix = `/previews/${encodeURIComponent(sessionId)}`
  const restPath = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length) || '/'
    : '/'
  const targetPath = preservePublicPath ? requestUrl.pathname : restPath
  const target = new URL(targetPath, ensureTrailingSlash(internalBaseUrl))
  target.search = requestUrl.search
  const headers = new Headers(request.headers)
  headers.delete('host')
  const method = request.method.toUpperCase()
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    })
  } catch (error) {
    return new Response(`Preview upstream unavailable: ${toErrorMessage(error)}`, {
      status: 502,
      headers: withPreviewCorsHeaders(new Headers({ 'content-type': 'text/plain; charset=UTF-8' })),
    })
  }
  const responseHeaders = withPreviewCorsHeaders(new Headers(upstream.headers))
  if (method === 'GET' && isHtmlResponse(upstream.headers)) {
    const html = await upstream.text()
    responseHeaders.delete('content-length')
    return new Response(injectBeeGamePreviewConsoleBridge(html, sessionId), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

function isHtmlResponse(headers: Headers): boolean {
  return (headers.get('content-type') || '').toLowerCase().includes('text/html')
}

function withPreviewCorsHeaders(headers: Headers): Headers {
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  headers.set('access-control-allow-headers', '*')
  return headers
}

/**
 * API callers use session cookies/credentials, so a wildcard CORS response is
 * rejected by browsers. Keep local dashboard origins available by default and
 * require deployment origins to be configured explicitly.
 */
export function resolveApiCorsOrigin(origin: string): string | undefined {
  const configured = (process.env.BEEGAME_API_CORS_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const localOrigins = ['http://127.0.0.1:62173', 'http://localhost:62173']
  return [...localOrigins, ...configured].includes(origin) ? origin : undefined
}

function injectBeeGamePreviewConsoleBridge(html: string, sessionId: string): string {
  const bridge = `<script data-beegame-preview-console-bridge>
(() => {
  if (window.__beegamePreviewConsoleBridgeInstalled) return;
  window.__beegamePreviewConsoleBridgeInstalled = true;
  const sessionId = ${JSON.stringify(sessionId)};
  const serialize = (value) => {
    if (value instanceof Error) return value.stack || value.message || String(value);
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const emit = (level, values) => {
    const message = values.map(serialize).filter(Boolean).join(' ');
    if (!message) return;
    const parentOrigin = (() => {
      try {
        return document.referrer ? new URL(document.referrer).origin : window.location.origin;
      } catch {
        return window.location.origin;
      }
    })();
    window.parent?.postMessage({
      type: 'beegame.preview.console',
      sessionId,
      level,
      message,
      createdAt: new Date().toISOString(),
    }, parentOrigin);
  };
  for (const level of ['error', 'warn']) {
    const original = console[level];
    console[level] = (...args) => {
      emit(level, args);
      original.apply(console, args);
    };
  }
  window.addEventListener('error', event => {
    emit('error', [event.error || event.message || 'Unhandled preview error']);
  });
  window.addEventListener('unhandledrejection', event => {
    emit('error', [event.reason || 'Unhandled preview promise rejection']);
  });
})();
</script>`
  const headClose = html.indexOf('</head>')
  if (headClose >= 0) return `${html.slice(0, headClose)}${bridge}${html.slice(headClose)}`
  const bodyClose = html.indexOf('</body>')
  if (bodyClose >= 0) return `${html.slice(0, bodyClose)}${bridge}${html.slice(bodyClose)}`
  return `${bridge}${html}`
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function getBeeGamePayloadString(
  event: BeeGameEvent | undefined,
  key: string,
): string {
  const value = event?.payload?.[key]
  return typeof value === 'string' ? value : ''
}

function normalizeBeeGameCreatedAt(value: Date | string | undefined): string {
  if (!value) return ''
  return value instanceof Date ? value.toISOString() : String(value)
}

function inferBeeGameSessionIdFromProjectId(projectId: string): string {
  return projectId.startsWith('project_beegame_')
    ? projectId.slice('project_'.length)
    : ''
}

function normalizeResolvedPath(path: string): string {
  return resolve(path)
}

function registerBeeGameSessionRoutes(
  app: Hono,
  basePath: string,
  beeGameSessions: BeeGameSessionManager,
  beeGamePreviews: BeeGamePreviewManager,
  beeGameDeployments: BeeGameDeploymentManager | undefined,
  options: {
    defaultWorkspacePath?: string
    assertPermittedModelConfigRuntime: (modelConfigId: string) => Promise<void>
    getCurrentUser: (request?: Request) => BeeGameUserContext
    getUserDataRoot: (request?: Request) => string
    appendAuditEvent: (
      request: Request,
      input: AppendAuditEventInput,
    ) => Promise<void>
    persistSessionMetadata: (
      request: Request,
      metadata: ReturnType<BeeGameSessionManager['metadata']>,
    ) => Promise<void>
    deleteSessionMetadata: (
      request: Request,
      metadata: ReturnType<BeeGameSessionManager['metadata']>,
      sessionId: string,
    ) => Promise<void>
    persistPreviewSnapshot: (
      request: Request,
      metadata: ReturnType<BeeGameSessionManager['metadata']>,
      snapshot: BeeGamePreviewSnapshot,
    ) => Promise<void>
    listDeploymentRecords?: (
      request: Request,
      sessionId: string,
    ) => Promise<BeeGameDeploymentRecord[] | undefined>
    persistDeploymentRecord?: (
      request: Request,
      record: BeeGameDeploymentRecord,
    ) => Promise<BeeGameDeploymentRecord | undefined>
    persistAssetManifest: (
      request: Request,
      metadata: ReturnType<BeeGameSessionManager['metadata']>,
      manifest: BeeGameAssetManifest,
    ) => Promise<BeeGameAssetManifest | undefined>
    loadAssetManifest: (
      request: Request,
      metadata: ReturnType<BeeGameSessionManager['metadata']>,
    ) => Promise<BeeGameAssetManifest | undefined>
    uploadAssetFile: (
      request: Request,
      metadata: ReturnType<BeeGameSessionManager['metadata']>,
      file: File,
    ) => Promise<string | undefined>
    modelConfigExists: (
      request: Request,
      user: BeeGameUserContext,
      id: string,
    ) => Promise<boolean>
    listModelConfigs: (
      request: Request,
      user: BeeGameUserContext,
    ) => Promise<Array<{ id: string; isDefault?: boolean }>>
    getProjectWorkspacePath?: (
      request: Request,
      user: BeeGameUserContext,
      projectId: string,
    ) => Promise<string | undefined>
    ownsProjectWorkspacePath: (
      request: Request,
      user: BeeGameUserContext,
      workspacePath: string,
    ) => Promise<boolean>
  },
): void {
  const defaultWorkspacePath = options.defaultWorkspacePath
  const check = (request: Request, permission: BeeGamePermission) =>
    requirePermission(options.getCurrentUser(request), permission)
  const checkSession = (request: Request, sessionId: string) =>
    requireBeeGameSessionOwner(
      request,
      sessionId,
      beeGameSessions,
      options.getCurrentUser,
    )
  const getSessionWorkspacePath = async (
    request: Request,
    sessionId: string,
    legacyWorkspacePath?: string,
  ): Promise<string> => {
    const metadata = beeGameSessions.metadata(sessionId)
    if (metadata?.workspacePath) return metadata.workspacePath
    if (!legacyWorkspacePath) throw new Error('Session not found')
    const resolvedWorkspace = await resolveSessionWorkspacePath(
      legacyWorkspacePath,
      defaultWorkspacePath,
    )
    const user = options.getCurrentUser(request)
    if (user.id === DEFAULT_LOCAL_USER_ID) return resolvedWorkspace
    if (await options.ownsProjectWorkspacePath(request, user, resolvedWorkspace)) {
      return resolvedWorkspace
    }
    const userDataRoot = resolve(options.getUserDataRoot(request))
    const relativeToUserRoot = relative(userDataRoot, resolvedWorkspace)
    if (relativeToUserRoot.startsWith('..') || isAbsolute(relativeToUserRoot)) {
      throw new Error('Workspace path must stay inside the current user workspace')
    }
    return resolvedWorkspace
  }

  app.get(basePath, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(beeGameSessions.list(options.getCurrentUser(c.req.raw).id))
  })

  app.post(basePath, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    try {
      const currentUser = options.getCurrentUser(c.req.raw)
      const workspacePath = await resolveNewBeeGameSessionWorkspacePath(
        body,
        currentUser,
        c.req.raw,
        {
          defaultWorkspacePath,
          getProjectWorkspacePath: options.getProjectWorkspacePath,
          ownsProjectWorkspacePath: options.ownsProjectWorkspacePath,
        },
      )
      // Configuration management is admin-only. Session creation resolves the
      // current user's readable default here, so clients never need access to
      // the management endpoint or any provider configuration details.
      const modelConfigId = await resolveDefaultModelConfigId(
        c.req.raw,
        currentUser,
        body.modelConfigId,
        options.modelConfigExists,
        options.listModelConfigs,
      )
      if (modelConfigId) await options.assertPermittedModelConfigRuntime(modelConfigId)
      const session = beeGameSessions.start({
          workspacePath,
          ...(typeof body.projectId === 'string' && body.projectId
            ? { projectId: body.projectId }
            : {}),
          modelConfigId,
          ...(typeof body.transcriptSessionId === 'string' && body.transcriptSessionId
            ? { transcriptSessionId: body.transcriptSessionId }
            : {}),
          ...(isBeeGameSessionLanguage(body.language)
            ? { language: body.language }
            : {}),
          userId: currentUser.id,
          ...(getBearerToken(c.req.raw)
            ? { authToken: getBearerToken(c.req.raw) }
            : {}),
          userDataRoot: options.getUserDataRoot(c.req.raw),
        })
      await options.persistSessionMetadata(
        c.req.raw,
        beeGameSessions.metadata(session.id),
      )
      return c.json(session)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get(`${basePath}/:id`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    await refreshSessionAuthTokenFromRequest(c.req.raw, beeGameSessions, c.req.param('id'))
    const session = beeGameSessions.get(c.req.param('id'))
    return session
      ? c.json(session)
      : c.json({ error: 'Session not found' }, 404)
  })

  app.get(`${basePath}/:id/events`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) {
      // A development-server restart drops the in-memory session manager but
      // does not invalidate a project's persisted transcript. Validate the
      // supplied workspace before recovering it; do not let the early owner
      // check make the recovery branch below unreachable.
      const legacyWorkspacePath = getWorkspacePathHint(
        c.req.query('workspacePath'),
        { workspacePath: c.req.header('x-beegame-workspace-path') },
      )
      if (sessionForbidden.error === 'Session not found' && legacyWorkspacePath) {
        try {
          const workspacePath = await getSessionWorkspacePath(
            c.req.raw,
            c.req.param('id'),
            legacyWorkspacePath,
          )
          return await readTranscriptFromWorkspace(
            c.req.param('id'),
            workspacePath,
            defaultWorkspacePath,
            getDashboardDataRoot(defaultWorkspacePath),
            Number.parseInt(c.req.query('after') || '0', 10),
          )
        } catch {
          // Preserve the deliberately opaque 404 response for an invalid
          // session/workspace combination.
        }
      }
      return c.json(sessionForbidden, 404)
    }
    await refreshSessionAuthTokenFromRequest(c.req.raw, beeGameSessions, c.req.param('id'))
    try {
      const after = Number.parseInt(c.req.query('after') || '0', 10)
      return c.json(beeGameSessions.events(c.req.param('id'), after))
    } catch (err) {
      const workspacePath = getWorkspacePathHint(
        c.req.query('workspacePath'),
        {
          workspacePath: c.req.header('x-beegame-workspace-path'),
        },
      )
      if (toErrorMessage(err) === 'Session not found' && workspacePath) {
        return readTranscriptFromWorkspace(
          c.req.param('id'),
          workspacePath,
          defaultWorkspacePath,
          getDashboardDataRoot(defaultWorkspacePath),
          Number.parseInt(c.req.query('after') || '0', 10),
        )
      }
      return publicSessionRouteError(
        c,
        'beegame-session.events',
        err,
        404,
        ['Session not found'],
      )
    }
  })

  app.get(`${basePath}/:id/runtime-snapshot`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    await refreshSessionAuthTokenFromRequest(c.req.raw, beeGameSessions, c.req.param('id'))
    try {
      const workspacePath = getWorkspacePathHint(
        c.req.query('workspacePath'),
        {
          workspacePath: c.req.header('x-beegame-workspace-path'),
        },
      )
      return c.json(
        beeGameSessions.runtimeSnapshot(
          c.req.param('id'),
          workspacePath,
        ),
      )
    } catch (err) {
      return publicSessionRouteError(
        c,
        'beegame-session.runtime-snapshot',
        err,
        404,
        ['Session not found'],
      )
    }
  })

  app.get(`${basePath}/:id/transcript`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    await refreshSessionAuthTokenFromRequest(c.req.raw, beeGameSessions, c.req.param('id'))
    try {
      return c.json(beeGameSessions.transcript(c.req.param('id')))
    } catch (err) {
      const workspacePath = c.req.query('workspacePath')
      if (toErrorMessage(err) === 'Session not found' && workspacePath) {
        return readTranscriptFromWorkspace(
          c.req.param('id'),
          workspacePath,
          defaultWorkspacePath,
          getDashboardDataRoot(defaultWorkspacePath),
        )
      }
      return publicSessionRouteError(
        c,
        'beegame-session.transcript',
        err,
        404,
        ['Session not found'],
      )
    }
  })

  app.patch(`${basePath}/:id/model`, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['modelConfigId'])
    if (error) return c.json({ error }, 400)
    try {
      const currentUser = options.getCurrentUser(c.req.raw)
      const modelConfigId = await requireOwnedModelConfigId(
        c.req.raw,
        currentUser,
        body.modelConfigId,
        options.modelConfigExists,
      )
      await options.assertPermittedModelConfigRuntime(modelConfigId)
      return c.json(
        beeGameSessions.updateModel(
          c.req.param('id'),
          modelConfigId,
        ),
      )
    } catch (err) {
      const message = toErrorMessage(err)
      return c.json(
        { error: message },
        message === 'Session not found' || message === 'Model config not found'
          ? 404
          : 400,
      )
    }
  })

  app.get(`${basePath}/:id/artifacts`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'Missing query: path' }, 400)
    try {
      return c.json(await beeGameSessions.readArtifact(c.req.param('id'), path))
    } catch (err) {
      const message = toErrorMessage(err)
      if (message === 'Session not found' && c.req.query('workspacePath')) {
        try {
          const workspacePath = await getSessionWorkspacePath(
            c.req.raw,
            c.req.param('id'),
            c.req.query('workspacePath'),
          )
          return c.json(await readBeeGameProjectArtifact(workspacePath, path))
        } catch (fallbackErr) {
          const fallbackMessage = toErrorMessage(fallbackErr)
          return publicSessionRouteError(
            c,
            'beegame-session.artifacts.fallback',
            fallbackErr,
            fallbackMessage === 'Artifact path must stay inside the session workspace'
              ? 400
              : 404,
            ['Artifact path must stay inside the session workspace', 'Session not found'],
          )
        }
      }
      return publicSessionRouteError(
        c,
        'beegame-session.artifacts',
        err,
        message === 'Artifact path must stay inside the session workspace' ? 400 : 404,
        ['Artifact path must stay inside the session workspace', 'Session not found'],
      )
    }
  })

  app.get(`${basePath}/:id/artifact-index`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        c.req.query('workspacePath'),
      )
      return c.json(await discoverBeeGameProjectArtifacts(workspacePath))
    } catch (err) {
      return publicSessionRouteError(
        c,
        'beegame-session.artifact-index',
        err,
        400,
        ['Session not found', 'Workspace path must stay inside the current user workspace'],
      )
    }
  })

  app.get(`${basePath}/:id/assets`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        c.req.query('workspacePath'),
      )
      const manifest = await readBeeGameAssetManifest(workspacePath)
      if (manifest.slots.length) {
        await options.persistAssetManifest(
          c.req.raw,
          beeGameSessions.metadata(c.req.param('id')),
          manifest,
        )
      } else {
        const storedManifest = await options.loadAssetManifest(
          c.req.raw,
          beeGameSessions.metadata(c.req.param('id')),
        )
        if (storedManifest?.slots.length) return c.json(storedManifest)
      }
      return c.json(manifest)
    } catch (err) {
      try {
        const manifest = await options.loadAssetManifest(
          c.req.raw,
          beeGameSessions.metadata(c.req.param('id')),
        )
        if (manifest) return c.json(manifest)
      } catch (fallbackErr) {
        return tracedRouteError(c, 'beegame-session.assets.list', fallbackErr)
      }
      return tracedRouteError(c, 'beegame-session.assets.list', err)
    }
  })

  app.post(`${basePath}/:id/assets/:slotId/upload`, async c => {
    const forbidden = check(c.req.raw, ROUTE_PERMISSION.assetIntegration)
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const form = await c.req.raw.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'Missing form file' }, 400)
    try {
      const sessionMetadata = beeGameSessions.metadata(c.req.param('id'))
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        c.req.query('workspacePath'),
      )
      const uploadedUrl = await options.uploadAssetFile(
        c.req.raw,
        sessionMetadata,
        file,
      )
      const result = await uploadBeeGameAsset(
        workspacePath,
        c.req.param('slotId'),
        file,
        uploadedUrl,
      )
      await options.persistAssetManifest(c.req.raw, sessionMetadata, result.manifest)
      return c.json(result)
    } catch (err) {
      return tracedRouteError(c, 'beegame-session.assets.upload', err)
    }
  })

  app.get(`${basePath}/:id/package`, async c => {
    const forbidden = check(c.req.raw, ROUTE_PERMISSION.projectExport)
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const projectPackage = await beeGameSessions.createProjectPackage(
        c.req.param('id'),
        await getSessionWorkspacePath(
          c.req.raw,
          c.req.param('id'),
          c.req.query('workspacePath'),
        ),
      )
      const body = projectPackage.data.buffer.slice(
        projectPackage.data.byteOffset,
        projectPackage.data.byteOffset + projectPackage.data.byteLength,
      ) as ArrayBuffer
      return new Response(
        new Blob([body], { type: projectPackage.contentType }),
        {
          headers: {
            'content-type': projectPackage.contentType,
            'content-disposition': `attachment; filename="${projectPackage.filename.replace(/"/g, '')}"`,
          },
        },
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.get(`${basePath}/:id/preview`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const body = await readOptionalJson(c.req.raw)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        getWorkspacePathHint(c.req.query('workspacePath'), body),
      )
      return c.json(beeGamePreviews.status(c.req.param('id'), workspacePath))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/preview`, async c => {
    const forbidden = check(c.req.raw, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const body = await readOptionalJson(c.req.raw)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        getWorkspacePathHint(c.req.query('workspacePath'), body),
      )
      const snapshot = await beeGamePreviews.start({
        sessionId: c.req.param('id'),
        workspacePath,
      })
      await options.persistPreviewSnapshot(
        c.req.raw,
        beeGameSessions.metadata(c.req.param('id')),
        snapshot,
      )
      return c.json(snapshot)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/preview/restart`, async c => {
    const forbidden = check(c.req.raw, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const body = await readOptionalJson(c.req.raw)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        getWorkspacePathHint(c.req.query('workspacePath'), body),
      )
      const snapshot = await beeGamePreviews.restart({
        sessionId: c.req.param('id'),
        workspacePath,
      })
      await options.persistPreviewSnapshot(
        c.req.raw,
        beeGameSessions.metadata(c.req.param('id')),
        snapshot,
      )
      return c.json(snapshot)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.delete(`${basePath}/:id/preview`, async c => {
    const forbidden = check(c.req.raw, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        c.req.query('workspacePath'),
      )
      const snapshot = beeGamePreviews.stop(c.req.param('id'), workspacePath)
      await options.persistPreviewSnapshot(
        c.req.raw,
        beeGameSessions.metadata(c.req.param('id')),
        snapshot,
      )
      return c.json(snapshot)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  if (beeGameDeployments) {
    app.get(`${basePath}/:id/deployments`, async c => {
      const forbidden = check(c.req.raw, 'project.read')
      if (forbidden) return c.json(forbidden, 403)
      const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
      if (sessionForbidden) return c.json(sessionForbidden, 404)
      const persisted = await options.listDeploymentRecords?.(
        c.req.raw,
        c.req.param('id'),
      )
      if (persisted) return c.json(persisted)
      return c.json(await beeGameDeployments.list(c.req.param('id')))
    })

    app.post(`${basePath}/:id/deployments`, async c => {
      const forbidden = check(c.req.raw, 'deployment.manage')
      if (forbidden) return c.json(forbidden, 403)
      const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
      if (sessionForbidden) return c.json(sessionForbidden, 404)
      const body = await readOptionalJson(c.req.raw)
      try {
        const workspacePath = await getSessionWorkspacePath(
          c.req.raw,
          c.req.param('id'),
          getWorkspacePathHint(c.req.query('workspacePath'), body),
        )
        const metadata = beeGameSessions.metadata(c.req.param('id'))
        const currentUser = options.getCurrentUser(c.req.raw)
        const deployment = await beeGameDeployments.deploy({
          sessionId: c.req.param('id'),
          userId: currentUser.id,
          ...(metadata?.projectId ? { projectId: metadata.projectId } : {}),
          workspacePath,
          ...(getBearerToken(c.req.raw)
            ? { authToken: getBearerToken(c.req.raw) }
            : {}),
        })
        const persisted = await options.persistDeploymentRecord?.(
          c.req.raw,
          deployment,
        )
        return c.json(persisted ?? deployment)
      } catch (err) {
        return c.json({ error: toErrorMessage(err) }, 400)
      }
    })

    app.post(`${basePath}/:id/deployments/:deploymentId/rollback`, async c => {
      const forbidden = check(c.req.raw, 'deployment.manage')
      if (forbidden) return c.json(forbidden, 403)
      const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
      if (sessionForbidden) return c.json(sessionForbidden, 404)
      try {
        const sessionId = c.req.param('id')
        const deploymentId = c.req.param('deploymentId')
        const persisted = await options.listDeploymentRecords?.(
          c.req.raw,
          sessionId,
        )
        const records = persisted ?? await beeGameDeployments.list(sessionId)
        const source = records.find(record => record.id === deploymentId)
        if (!source) {
          return c.json({ error: 'Deployment not found' }, 404)
        }
        const rollback = await beeGameDeployments.rollbackTo(source)
        const saved = await options.persistDeploymentRecord?.(
          c.req.raw,
          rollback,
        )
        return c.json(saved ?? rollback)
      } catch (err) {
        return c.json({ error: toErrorMessage(err) }, 400)
      }
    })
  }

  app.post(`${basePath}/:id/input`, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
      const attachments = body.attachments === undefined
        ? []
        : validateBeeGameAttachments(body.attachments)
      if (body.text === undefined && attachments.length === 0) {
        return c.json({ error: 'Missing field: text' }, 400)
      }
      const inputText = typeof body.text === 'string' ? body.text : ''
      const displayText = typeof body.displayText === 'string'
        ? body.displayText
        : undefined
      const displayKind = typeof body.displayKind === 'string'
        ? body.displayKind
        : undefined
      const taskType = typeof body.taskType === 'string'
        ? getCreditTaskPolicy(body.taskType).taskType
        : undefined
      const clientMessageId = typeof body.clientMessageId === 'string'
        ? body.clientMessageId
        : typeof body.client_message_id === 'string'
          ? body.client_message_id
          : undefined
      const supersedesMessageId = typeof body.supersedesMessageId === 'string'
        ? body.supersedesMessageId
        : typeof body.supersedes_message_id === 'string'
          ? body.supersedes_message_id
          : undefined
      return c.json(
        await beeGameSessions.sendWithDisplay(c.req.param('id'), inputText, {
          displayText,
          displayKind,
          taskType,
          clientMessageId,
          supersedesMessageId,
          attachments,
          thinkingMode: isBeeGameChatThinkingMode(body.thinkingMode)
            ? body.thinkingMode
            : 'disabled',
          ...(isBeeGameSessionLanguage(body.language)
            ? { language: body.language }
            : {}),
          ...(getBearerToken(c.req.raw)
            ? { authToken: getBearerToken(c.req.raw) }
            : {}),
        }),
      )
    } catch (err) {
      if (err instanceof BeeGameUploadPolicyError) return uploadPolicyResponse(err)
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/permissions/:toolUseID`, async c => {
    const forbidden = check(c.req.raw, 'agent.approve_tool')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const body = await readJson(c.req.raw)
    const decision = body.decision
    if (decision !== 'allow' && decision !== 'deny') {
      return c.json({ error: 'Permission decision must be allow or deny' }, 400)
    }
    try {
      const resolved = beeGameSessions.resolvePermission(
        c.req.param('id'),
        c.req.param('toolUseID'),
        {
          behavior: decision,
          remember: body.remember === true,
          ...(typeof body.message === 'string'
            ? { message: body.message }
            : {}),
        },
      )
      try {
        await options.appendAuditEvent(c.req.raw, {
          actorId: options.getCurrentUser(c.req.raw).id,
          action: 'agent_permission.resolved',
          targetType: 'beegame_session',
          targetId: c.req.param('id'),
          metadata: {
            toolUseID: c.req.param('toolUseID'),
            decision,
            remember: body.remember === true,
          },
        })
      } catch (auditErr) {
        console.warn('[BeeGame] Failed to append permission audit event:', toErrorMessage(auditErr))
      }
      return c.json(resolved)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.post(`${basePath}/:id/stop`, async c => {
    const forbidden = check(c.req.raw, 'agent.cancel')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const session = beeGameSessions.stop(c.req.param('id'))
      await options.persistSessionMetadata(
        c.req.raw,
        beeGameSessions.metadata(session.id),
      )
      return c.json(session)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.delete(`${basePath}/:id`, async c => {
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const sessionMetadata = beeGameSessions.metadata(c.req.param('id'))
    if (!sessionMetadata) return c.json({ error: 'Session not found' }, 404)
    const deleteArtifacts = c.req.query('deleteArtifacts') === '1'
    try {
      const result = await beeGameSessions.delete(c.req.param('id'), {
        deleteArtifacts,
      })
      await options.deleteSessionMetadata(
        c.req.raw,
        sessionMetadata,
        c.req.param('id'),
      )
      await appendAuditEventBestEffort('beegame_session.deleted', () =>
        options.appendAuditEvent(c.req.raw, {
          actorId: options.getCurrentUser(c.req.raw).id,
          action: 'beegame_session.deleted',
          targetType: 'beegame_session',
          targetId: c.req.param('id'),
          metadata: {
            deleteArtifacts,
            deletedArtifactCount: result.deletedArtifactPaths.length,
          },
        }),
      )
      return c.json(result)
    } catch (err) {
      if (deleteArtifacts && toErrorMessage(err) === 'Session not found') {
        try {
          const workspacePath = await resolveSessionWorkspacePath(
            sessionMetadata.workspacePath,
            defaultWorkspacePath,
          )
          const dashboardDataRoot = getDashboardDataRoot(defaultWorkspacePath)
          const deletedArtifactPaths = await deleteSessionArtifactsFromTranscript(
            c.req.param('id'),
            workspacePath,
            dashboardDataRoot,
          ).catch((): string[] => [])
          const deletedWorkspacePath = await deleteWorkspaceDirectoryIfSafe(
            workspacePath,
            dashboardDataRoot,
          )
          if (deletedWorkspacePath) deletedArtifactPaths.push(deletedWorkspacePath)
          const result = {
            deleted: true,
            deletedArtifactPaths,
          }
          await appendAuditEventBestEffort('beegame_session.deleted', () =>
            options.appendAuditEvent(c.req.raw, {
              actorId: options.getCurrentUser(c.req.raw).id,
              action: 'beegame_session.deleted',
              targetType: 'beegame_session',
              targetId: c.req.param('id'),
              metadata: {
                deleteArtifacts,
                recoveredFromTranscript: true,
                deletedArtifactCount: deletedArtifactPaths.length,
              },
            }),
          )
          return c.json(result)
        } catch (fallbackErr) {
          return tracedRouteError(c, 'beegame-session.delete', fallbackErr, 404)
        }
      }
      return tracedRouteError(c, 'beegame-session.delete', err, 404)
    }
  })
}

async function readTranscriptFromWorkspace(
  sessionId: string,
  workspacePath: string,
  defaultWorkspacePath?: string,
  dashboardDataRoot?: string,
  after = 0,
): Promise<Response> {
  try {
    const resolvedWorkspace = await resolveSessionWorkspacePath(
      workspacePath,
      defaultWorkspacePath,
    )
    const events = await readSessionTranscriptFromDisk(
      sessionId,
      resolvedWorkspace,
      dashboardDataRoot,
    )
    const recoveredEvents = closeInterruptedTranscriptTurns(
      sessionId,
      events,
    )
    return Response.json(
      after > 0
        ? recoveredEvents.filter(event => event.id > after)
        : recoveredEvents,
    )
  } catch (err) {
    return tracedRouteResponse(
      'beegame-session.transcript.fallback',
      err,
      404,
    )
  }
}

type RecoveredTranscriptEvent = Awaited<
  ReturnType<typeof readSessionTranscriptFromDisk>
>[number]

function closeInterruptedTranscriptTurns(
  sessionId: string,
  events: RecoveredTranscriptEvent[],
): RecoveredTranscriptEvent[] {
  const turnId = findLatestOpenTranscriptTurnId(events)
  if (!turnId) return events
  const latestId = events.reduce((max, event) => Math.max(max, event.id), 0)
  const latestCreatedAt = events.at(-1)?.createdAt
  return [
    ...events,
    {
      id: latestId + 1,
      sessionId,
      turnId,
      type: 'turn.failed',
      text: 'Previous BeeGame turn was interrupted before completion.',
      createdAt: latestCreatedAt || new Date().toISOString(),
    },
  ]
}

function findLatestOpenTranscriptTurnId(
  events: RecoveredTranscriptEvent[],
): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event?.type === 'turn.started' &&
      event.turnId &&
      !hasTranscriptTurnEnded(events, event.turnId)
    ) {
      return event.turnId
    }
  }
  return ''
}

function hasTranscriptTurnEnded(
  events: RecoveredTranscriptEvent[],
  turnId?: string,
): boolean {
  if (!turnId) return true
  return events.some(event =>
    event.turnId === turnId &&
    (
      event.type === 'turn.completed' ||
      event.type === 'turn.empty' ||
      event.type === 'turn.failed' ||
      event.type === 'result' ||
      event.type === 'session.stopped' ||
      event.type === 'session.failed'
    )
  )
}

function toProjectMetadata(body: JsonObject): BeeGameProjectMetadata {
  return {
    id: String(body.id),
    name: String(body.name),
    ...(typeof body.root_path === 'string' && body.root_path
      ? { root_path: body.root_path }
      : {}),
    created_at: Number(body.created_at),
    ...(isObject(body.runtime_snapshot)
      ? { runtime_snapshot: toProjectRuntimeSnapshot(body.runtime_snapshot) }
      : {}),
  }
}

function toProjectRuntimeSnapshot(body: JsonObject): NonNullable<BeeGameProjectMetadata['runtime_snapshot']> {
  const usage = isObject(body.usage)
    ? {
        prompt_tokens: Math.max(0, Number(body.usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(body.usage.completion_tokens) || 0),
        total_tokens: Math.max(0, Number(body.usage.total_tokens) || 0),
      }
    : undefined
  return {
    ...(usage ? { usage } : {}),
    ...(typeof body.phase_name === 'string' && body.phase_name.trim()
      ? { phase_name: body.phase_name.trim() }
      : {}),
    ...(typeof body.model_config_id === 'string' && body.model_config_id.trim()
      ? { model_config_id: body.model_config_id.trim() }
      : {}),
    ...(typeof body.model_name === 'string' && body.model_name.trim()
      ? { model_name: body.model_name.trim() }
      : {}),
    ...(Number.isFinite(Number(body.updated_at))
      ? { updated_at: Number(body.updated_at) }
      : {}),
  }
}

async function readJson(request: Request, maxBytes?: number): Promise<JsonObject> {
  const value = maxBytes === undefined
    ? await request.json()
    : JSON.parse(new TextDecoder().decode(await readRequestBytes(request, maxBytes))) as unknown
  return isObject(value) ? value : {}
}

async function readOptionalJson(request: Request): Promise<JsonObject> {
  try {
    const value = await request.json()
    return isObject(value) ? value : {}
  } catch {
    return {}
  }
}

function getWorkspacePathHint(
  queryValue: string | undefined,
  body: JsonObject,
): string | undefined {
  if (queryValue) return queryValue
  return typeof body.workspacePath === 'string'
    ? body.workspacePath
    : undefined
}

function getBeeGameClientRequestId(body: JsonObject): string | undefined {
  const value = typeof body.clientRequestId === 'string'
    ? body.clientRequestId.trim()
    : typeof body.idempotencyKey === 'string'
      ? body.idempotencyKey.trim()
      : ''
  return value || undefined
}

function requireFields(body: JsonObject, fields: string[]): string | null {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === '') {
      return `Missing field: ${field}`
    }
  }
  return null
}

function toModelMap(value: unknown): {
  fast?: string
  balanced?: string
  strong?: string
} {
  if (!isObject(value)) return {}
  return {
    ...(typeof value.fast === 'string' ? { fast: value.fast } : {}),
    ...(typeof value.balanced === 'string' ? { balanced: value.balanced } : {}),
    ...(typeof value.strong === 'string' ? { strong: value.strong } : {}),
  }
}

async function validateMcpServerBody(
  body: JsonObject,
  hasPermittedOutboundUrl: (value: unknown) => Promise<boolean>,
): Promise<string | null> {
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return 'Missing field: name'
  }
  const transport = typeof body.transport === 'string'
    ? body.transport
    : 'stdio'
  if (!isMcpServerTransportValue(transport)) {
    return 'Invalid MCP transport'
  }
  if (transport === 'stdio') {
    if (typeof body.command !== 'string' || !body.command.trim()) {
      return 'Missing field: command'
    }
  } else if (typeof body.url !== 'string' || !body.url.trim()) {
    return 'Missing field: url'
  } else if (!await hasPermittedOutboundUrl(body.url)) {
    return 'Outbound URL is not permitted'
  }
  if (body.env !== undefined && !Array.isArray(body.env)) {
    return 'Invalid MCP env'
  }
  return null
}

function readAllowedOutboundHosts(): string[] {
  const value = process.env.BEEGAME_OUTBOUND_ALLOWED_HOSTS
  return value ? value.split(',').map(host => host.trim()).filter(Boolean) : []
}

function toMcpServerInput(body: JsonObject) {
  return {
    ...(typeof body.id === 'string' ? { id: body.id } : {}),
    name: String(body.name),
    enabled: body.enabled !== false,
    transport: (typeof body.transport === 'string'
      ? body.transport
      : 'stdio') as McpServerTransport,
    scope: (typeof body.scope === 'string'
      ? body.scope
      : 'beegame') as McpServerScope,
    ...(typeof body.command === 'string' ? { command: body.command } : {}),
    ...(Array.isArray(body.args) ? { args: body.args.map(String) } : {}),
    ...(typeof body.url === 'string' ? { url: body.url } : {}),
    ...(typeof body.cwd === 'string' ? { cwd: body.cwd } : {}),
    ...(Array.isArray(body.env)
      ? {
          env: body.env
            .filter(isObject)
            .map(item => ({
              key: typeof item.key === 'string' ? item.key : '',
              ...(typeof item.value === 'string' ? { value: item.value } : {}),
              ...(item.clearSecret === true ? { clearSecret: true } : {}),
            })),
        }
      : {}),
    autoStart: body.autoStart !== false,
  }
}

function isMcpServerTransportValue(
  value: string,
): value is McpServerTransport {
  return value === 'stdio' || value === 'sse' || value === 'http'
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBeeGameSessionLanguage(
  value: unknown,
): value is BeeGameSessionLanguage {
  return value === 'en' ||
    value === 'zh' ||
    value === 'zh-TW' ||
    value === 'ja' ||
    value === 'ko'
}

export function uploadPolicyResponse(error: BeeGameUploadPolicyError, traceId: string = randomUUID()): Response {
  console.warn('[BeeGame] upload policy rejected request', {
    traceId,
    reason: 'attachment_policy_rejected',
    error: error.name,
  })
  return new Response(JSON.stringify({
    error: 'Attachment validation failed',
    traceId,
  }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
}

async function refreshSessionAuthTokenFromRequest(
  request: Request,
  sessions: BeeGameSessionManager,
  sessionId: string,
): Promise<void> {
  const token = getBearerToken(request)
  if (token) sessions.updateAuthToken(sessionId, token)
  await sessions.retryPendingCreditOperation(sessionId)
}

async function appendAuditEventBestEffort(
  action: string,
  append: () => Promise<void>,
): Promise<void> {
  try {
    await append()
  } catch (err) {
    console.warn(`[BeeGame] Failed to append ${action} audit event:`, toErrorMessage(err))
  }
}

class HttpError extends Error {
  constructor(
    readonly status: 402,
    readonly body: JsonObject,
  ) {
    super(getHttpErrorMessage(body))
  }
}

function getHttpErrorMessage(body: JsonObject): string {
  const message = body.message ?? body.error
  return typeof message === 'string' ? message : 'Request failed'
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}

function resourceRequirementForSlot(slot: BeeGameAssetSlot, target?: BeeGameAssetManifest['project_target']): ResourceSelectionRequirement | undefined {
  const requirement = slot.resource_requirement
  if (!requirement) return undefined
  return {
    slotId: slot.id,
    category: requirement.category,
    dimension: requirement.dimension,
    acceptedFormats: effectiveAssetFormats(slot, target),
    styles: requirement.styles,
    gameTypes: requirement.game_types,
    tags: requirement.tags,
    purpose: requirement.purpose,
  }
}

function isSafeAutomaticResourceRequirement(
  requirement: ResourceSelectionRequirement,
): boolean {
  return Boolean(requirement.tags?.length && requirement.acceptedFormats?.length)
}

function toLibraryBinding(selection: ResourceSelectionResult) {
  return {
    element_path: selection.elementPath,
    source_url: selection.sourceUrl,
    selected_at: new Date().toISOString(),
    selection_reason: selection.reasons,
    ...(selection.dependencies?.length ? {
      dependencies: selection.dependencies.map(dependency => ({
        key: dependency.key,
        parent_key: dependency.parentKey,
        element_id: dependency.elementId,
        element_path: dependency.elementPath,
        reference_path: dependency.referencePath,
        source_url: dependency.sourceUrl,
        ...(dependency.kind ? { kind: dependency.kind } : {}),
      })),
    } : {}),
  }
}

/**
 * Post-turn integration entrypoint. It only consumes explicit asset contracts,
 * never names or inferred categories, and leaves existing bindings untouched.
 */
async function autoBindLibraryResourcesInWorkspace(
  workspacePath: string,
  resourceSelectionClient: NonNullable<AgentWorkflowAppOptions['resourceSelectionClient']>,
): Promise<void> {
  const manifest = await readBeeGameAssetManifest(workspacePath)
  const requirements = manifest.slots
    .filter(slot => !slot.resource_binding && slot.status !== 'integrated')
    .map(slot => resourceRequirementForSlot(slot, manifest.project_target))
    .filter((requirement): requirement is ResourceSelectionRequirement => Boolean(requirement))
    .filter(isSafeAutomaticResourceRequirement)
  if (!requirements.length) return
  const selections = await resourceSelectionClient.select(requirements)
  for (const selection of selections) {
    try {
      await bindBeeGameLibraryResourceInWorkspace(workspacePath, selection.slotId, {
        pack_id: selection.packId,
        pack_version: selection.packVersion,
        element_id: selection.elementId,
        ...toLibraryBinding(selection),
      })
      await integrateBeeGameLibraryResourceInWorkspace(workspacePath, selection.slotId)
    } catch (error) {
      // A failed signed download or an adapter-only target retains its binding
      // for retry, while the Agent turn and existing project files stay intact.
      console.warn(`BeeGame resource integration failed for ${selection.slotId}:`, toErrorMessage(error))
    }
  }
}
