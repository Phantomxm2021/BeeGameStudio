import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  listModelConfigs,
  mapModelConfigToRuntime,
  type ModelProviderKind,
} from '@bee-game-studio/agent-workflow'
import {
  BeeGameSessionManager,
  deleteSessionArtifactsFromTranscript,
  getLatestRuntimeUsage,
  readSessionTranscriptFromDisk,
  type BeeGameEvent,
  type BeeGameRuntimeSnapshot,
  type BeeGameSession,
  type BeeGameAttachment,
  type BeeGameImageAttachment,
  type BeeGameFileAttachment,
  type BeeGameSessionLanguage,
  type BeeGameSessionRunner,
} from './beegame/session-manager'
import {
  createProcessIsolatedModelRuntimeHost,
  type BeeGameModelRuntimeHost,
} from './beegame/model-runtime-host'
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
import { stripViteClientScript } from './beegame/vite-preview-host'
import {
  BeeGameDeploymentManager,
  createSupabaseStorageDeploymentPublisherFromEnv,
  type BeeGameDeploymentRecord,
  type BeeGameDeploymentRetentionResult,
  type BeeGameDeploymentPublisher,
  type BeeGameDeploymentRunner,
} from './beegame/deployment-manager'
import { getNativeDeliveryState } from './beegame/native-delivery-state'
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
  BeeGameAuthUnavailableError,
  DEFAULT_LOCAL_USER_ID,
  createConfiguredUserResolver,
  getBearerToken,
  hasBeeGamePermission,
  listBeeGamePermissions,
} from './auth/user-context'
import { createBeeGameAuthContext } from './auth/auth-context'
import {
  PREVIEW_CAPABILITY_QUERY_PARAM,
  createPreviewCapabilityManager,
  type PreviewCapabilityManager,
} from './auth/preview-capability'
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
  inspectOutboundTarget,
  resolveApprovedOutboundTarget,
  type OutboundTargetInspection,
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
  modelRuntimeHost?: BeeGameModelRuntimeHost
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
  // Credentialed browser clients may host the dashboard and runtime on
  // separate origins. Register CORS before every API route, including the
  // HttpOnly session endpoints, so successful refresh responses are readable.
  app.use('/api/*', cors({
    origin: resolveApiCorsOrigin,
    credentials: true,
    // Deliberately omit allowHeaders: Hono reflects the browser's requested
    // headers after the origin has passed the explicit trusted-origin policy.
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  }))
  const outboundTargetPolicyOptions: OutboundTargetPolicyOptions = {
    ...options.outboundTargetPolicyOptions,
    allowedHosts: options.outboundTargetPolicyOptions?.allowedHosts ?? readAllowedOutboundHosts(),
    allowTrustedDevelopmentProxy:
      options.outboundTargetPolicyOptions?.allowTrustedDevelopmentProxy ??
      (process.env.NODE_ENV !== 'production' && process.env.BEEGAME_ALLOW_TRUSTED_DEVELOPMENT_OUTBOUND_PROXY === '1'),
  }
  const resolveOutboundTarget = options.outboundTargetResolver ?? resolveApprovedOutboundTarget
  const modelRuntimeHost = options.modelRuntimeHost ??
    createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions,
      resolveOutboundTarget,
    })
  const inspectPermittedOutboundUrl = async (value: unknown): Promise<OutboundTargetInspection | null> => {
    if (value === undefined || value === '') return null
    if (typeof value !== 'string') {
      return { approved: false, code: 'invalid_url' }
    }
    if (options.outboundTargetResolver) {
      const target = await options.outboundTargetResolver(value, outboundTargetPolicyOptions)
      return target
        ? { approved: true, target }
        : { approved: false, code: 'address_not_public', hostname: safeUrlHost(value) || undefined }
    }
    return inspectOutboundTarget(value, outboundTargetPolicyOptions)
  }
  const hasPermittedOutboundUrl = async (value: unknown): Promise<boolean> =>
    (await inspectPermittedOutboundUrl(value))?.approved !== false
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
    isOriginAllowed: origin => Boolean(resolveApiCorsOrigin(origin)),
  })
  const getRequestAuthToken = (request: Request): string | undefined =>
    getBearerToken(request) ?? sessionAuth?.getAccessToken(request)
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
  const previewCapabilities = createPreviewCapabilityManager()
  const getCurrentUser = authContext.getCurrentUser
  const getCurrentUserDataRoot = (request?: Request) =>
    getUserDashboardDataRoot(dashboardDataRoot, getCurrentUser(request).id)
  const modelConfigStore = options.modelConfigStore
  if (modelConfigStore !== false && modelConfigStore !== undefined) {
    loadModelConfigsFromStore(modelConfigStore)
  }
  const billingConfig = resolveBeeGameBillingConfig()
  const skillsConfig = options.skillsConfig === false
    ? null
    : options.skillsConfig ?? resolveBeeGameSkillsConfig()
  const dashboardRepository = new DashboardRepository({
    dashboardDataRoot,
    supabaseStore,
    supabasePaymentProviderStore,
    supabaseRuntimeEnvClient,
    remoteCreditControl: createRemoteCreditControlClient(billingConfig),
    skillsConfig: options.skillsConfig,
    getUserDataRoot: getCurrentUserDataRoot,
    getAuthToken: getRequestAuthToken,
    modelConfigStore,
  })
  const intakeJobs = new Map<string, BeeGameIntakeJob>()
  const attachmentBuildJobs = new Map<string, BeeGameAttachmentBuildJob>()
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
    requireAcceptedDelivery: true,
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
    const sessionMetadata = beeGameSessions.metadata(sessionId)
    if (!sessionMetadata) return c.text('Preview not found', 404)
    const user = options.currentUser ?? await authContext.resolveRequestUser(c.req.raw)
    const capability = previewCapabilities.verifyRequest(c.req.raw, sessionId)
    const sandboxedSubresource = previewCapabilities.allowsSandboxedSubresource(
      c.req.raw,
      sessionId,
    )
    const authenticatedUserId = user?.id ?? capability?.userId
    if (!authenticatedUserId && !sandboxedSubresource) return c.text('Unauthorized', 401)
    if (authenticatedUserId && sessionMetadata.userId !== authenticatedUserId) {
      return c.text('Preview not found', 404)
    }
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
  registerBeeGameBillingPublicRoutes(app, {
    billingConfig,
    dashboardRepository,
  })
  app.use('/api/*', async (c, next) => {
    if (options.currentUser) {
      await next()
      return
    }
    let user: BeeGameUserContext | undefined
    try {
      user = await authContext.resolveRequestUser(c.req.raw)
    } catch (error) {
      if (error instanceof BeeGameAuthUnavailableError) {
        c.header('Retry-After', '2')
        return c.json({
          error: 'Authentication unavailable',
          code: 'authentication_unavailable',
          message: 'Authentication service is temporarily unavailable',
          recoverable: true,
          retry_after_ms: 2_000,
        }, 503)
      }
      throw error
    }
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
      getRequestAuthToken(c.req.raw),
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
    const outboundInspection = await inspectPermittedOutboundUrl(body.baseUrl)
    if (outboundInspection && !outboundInspection.approved) {
      return c.json(toOutboundTargetError(outboundInspection), 400)
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
      const outboundInspection = await inspectPermittedOutboundUrl(body.baseUrl)
      if (outboundInspection && !outboundInspection.approved) {
        return c.json(toOutboundTargetError(outboundInspection), 400)
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
    if (!skillsConfig) return c.json({ error: 'User skills are disabled' }, 503)
    try {
      return await proxyBeeGameSkillsRequest(skillsConfig, c.req.raw, '/api/user-skills')
    } catch (error) {
      return tracedRouteError(c, 'user-skills.list', error)
    }
  })

  app.post('/api/user-skills/import', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), ROUTE_PERMISSION.userSkills)
    if (forbidden) return c.json(forbidden, 403)
    if (!skillsConfig) return c.json({ error: 'User skills are disabled' }, 503)
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
    if (!skillsConfig) return c.json({ error: 'User skills are disabled' }, 503)
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
    if (!skillsConfig) return c.json({ error: 'User skills are disabled' }, 503)
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

  app.post('/api/projects/bootstrap', async c => {
    const user = getCurrentUser(c.req.raw)
    const projectForbidden = requirePermission(user, 'project.create')
    if (projectForbidden) return c.json(projectForbidden, 403)
    const agentForbidden = requirePermission(user, 'agent.send_message')
    if (agentForbidden) return c.json(agentForbidden, 403)

    const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
    const projectBody = isObject(body.project) ? body.project : {}
    const brief = isObject(body.brief) ? body.brief : {}
    const projectId = typeof projectBody.id === 'string' ? projectBody.id.trim() : ''
    const projectName = typeof projectBody.name === 'string' ? projectBody.name.trim() : ''
    const projectFolderName = typeof body.projectName === 'string' ? body.projectName.trim() : ''
    const createdAt = Number(projectBody.created_at)
    const idea = typeof brief.idea === 'string' ? brief.idea.trim() : ''
    if (!projectId || !projectName || !Number.isFinite(createdAt) || !idea) {
      return c.json({ error: 'Invalid project bootstrap payload' }, 400)
    }

    try {
      const [workspacePath, modelConfigId] = await Promise.all([
        createManagedProjectWorkspacePath({
          defaultWorkspacePath: options.defaultWorkspacePath,
          userId: user.id,
          projectName: projectFolderName || projectName,
          projectId,
        }),
        resolveDefaultModelConfigId(
          c.req.raw,
          user,
          undefined,
          (request, requestUser, id) => dashboardRepository.modelConfigExists(request, requestUser, id),
          (request, requestUser) => dashboardRepository.listModelConfigs(request, requestUser),
        ),
      ])
      if (modelConfigId) await assertPermittedModelConfigRuntime(modelConfigId)

      const project = await dashboardRepository.upsertProject(c.req.raw, user, {
        id: projectId,
        name: projectName,
        root_path: workspacePath,
        created_at: createdAt,
        runtime_snapshot: {
          phase_name: 'starting',
          ...(modelConfigId ? { model_config_id: modelConfigId } : {}),
          updated_at: Date.now(),
        },
      })
      const languageValue = body.language ?? brief.language
      const language = isBeeGameSessionLanguage(languageValue) ? languageValue : undefined
      const session = beeGameSessions.start({
        workspacePath,
        projectId,
        ...(modelConfigId ? { modelConfigId } : {}),
        ...(language ? { language } : {}),
        userId: user.id,
        ...(getRequestAuthToken(c.req.raw) ? { authToken: getRequestAuthToken(c.req.raw) } : {}),
        userDataRoot: getCurrentUserDataRoot(c.req.raw),
      })
      await dashboardRepository.upsertSessionMetadata(
        c.req.raw,
        user,
        beeGameSessions.metadata(session.id),
      )

      void beeGameSessions.sendWithDisplay(
        session.id,
        buildConfirmedBriefPrompt(brief, language),
        {
          displayText: idea,
          displayKind: 'confirmed_brief',
          taskType: 'full_build',
          ...(language ? { language } : {}),
          ...(getRequestAuthToken(c.req.raw) ? { authToken: getRequestAuthToken(c.req.raw) } : {}),
        },
      ).catch(error => {
        console.error(`[BeeGame] Project bootstrap turn failed for ${projectId}:`, error)
      })

      return c.json({
        project,
        session,
        binding: createProjectSessionBinding(
          projectId,
          session.id,
          workspacePath,
          language,
        ),
        task_id: session.id,
        status: 'starting',
        pipeline: { pipeline_id: session.id, status: 'starting' },
      }, 202)
    } catch (err) {
      if (err instanceof ProjectQuotaExceededError) {
        return c.json({
          error: err.message,
          limit: err.limit,
          projectCount: err.projectCount,
        }, 429)
      }
      return tracedRouteError(c, 'project.bootstrap', err)
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
        previewCapabilities,
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
    if (body.remember === true) {
      return c.json({ error: 'Persistent runtime permissions are not available through the Web API' }, 400)
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
      let resolved: { resolved: boolean; stale?: boolean }
      try {
        resolved = beeGameSessions.resolvePermission(
          sessionRef.sessionId,
          c.req.param('toolUseID'),
          {
            behavior: decision,
            remember: false,
            ...(typeof body.message === 'string'
              ? { message: body.message }
              : {}),
          },
        )
      } catch (error) {
        const message = toErrorMessage(error)
        if (message !== 'Permission request not found' && message !== 'Session not found') throw error
        resolved = { resolved: false, stale: true }
      }
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
      c.header('set-cookie', previewCapabilities.issueCookie(
        c.req.raw,
        sessionRef.sessionId,
        user.id,
      ))
      return c.json(withPreviewCapability(
        beeGamePreviews.status(sessionRef.sessionId, sessionRef.workspacePath),
        previewCapabilities,
        user.id,
      ))
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
      c.header('set-cookie', previewCapabilities.issueCookie(
        c.req.raw,
        ensured.session.id,
        user.id,
      ))
      return c.json(withPreviewCapability(snapshot, previewCapabilities, user.id))
    } catch (err) {
      return projectWorkspaceMutationRouteError(c, 'project.preview.start', err)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
      c.header('set-cookie', previewCapabilities.issueCookie(
        c.req.raw,
        ensured.session.id,
        user.id,
      ))
      return c.json(withPreviewCapability(snapshot, previewCapabilities, user.id))
    } catch (err) {
      return projectWorkspaceMutationRouteError(c, 'project.preview.restart', err)
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
      previewCapabilities.revokeSession(sessionRef.sessionId)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
      const deployment = await beeGameDeployments.deploy({
        sessionId: ensured.session.id,
        userId: user.id,
        projectId: project.id,
        workspacePath: ensured.binding.workspacePath,
        ...(getRequestAuthToken(c.req.raw)
          ? { authToken: getRequestAuthToken(c.req.raw) }
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
      const sessionRef = await resolveBeeGameProjectSessionReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      const workspacePath = sessionRef?.workspacePath ?? (
        project.root_path
          ? await resolveSessionWorkspacePath(project.root_path, options.defaultWorkspacePath)
          : undefined
      )
      if (!workspacePath) return c.json({ error: 'Project workspace not found' }, 404)
      const slotId = c.req.param('slotId')
      const manifest = await readBeeGameAssetManifest(workspacePath)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
      assertProjectWorkspaceMutationIdle(ensured.session)
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
            projectReference: 'detached',
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
        getRequestAuthToken(request),
        modelConfigId,
      )
      const analysis = await generateBeeGameAttachmentAnalysis({
        attachments,
        workspace: analysisWorkspace,
        language: typeof body.language === 'string' ? body.language : undefined,
        modelConfigId,
        ownerId: user.id,
        runtimeEnv,
        modelRuntimeHost,
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
        ownerId: user.id,
        modelConfigId,
        runtimeEnv: await dashboardRepository.getRuntimeEnv(
          getCurrentUserDataRoot(request),
          user.id,
          getRequestAuthToken(request),
          modelConfigId,
        ),
        cwd: getCurrentUserDataRoot(request),
        modelRuntimeHost,
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
    if (body.thinkingMode !== undefined) {
      return c.json({ error: 'Intake model behavior is server-owned' }, 400)
    }
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
      if (body.thinkingMode !== undefined) {
        return c.json({ error: 'Intake model behavior is server-owned' }, 400)
      }
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
      if (body.thinkingMode !== undefined) {
        return c.json({ error: 'Intake model behavior is server-owned' }, 400)
      }
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
    if (body.thinkingMode !== undefined) {
      return c.json({ error: 'Intake model behavior is server-owned' }, 400)
    }
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
      getAuthToken: getRequestAuthToken,
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
      issuePreviewCookie: (request, sessionId, userId) =>
        previewCapabilities.issueCookie(request, sessionId, userId),
      issuePreviewUrl: (url, sessionId, userId) =>
        previewCapabilities.issueUrl(url, sessionId, userId),
      revokePreviewCapability: sessionId => previewCapabilities.revokeSession(sessionId),
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
      getAuthToken: getRequestAuthToken,
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
      issuePreviewCookie: (request, sessionId, userId) =>
        previewCapabilities.issueCookie(request, sessionId, userId),
      issuePreviewUrl: (url, sessionId, userId) =>
        previewCapabilities.issueUrl(url, sessionId, userId),
      revokePreviewCapability: sessionId => previewCapabilities.revokeSession(sessionId),
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
  const diagnostic = error instanceof Error
    ? {
        cause: error.name,
        ...(process.env.NODE_ENV !== 'production'
          ? { causeMessage: error.message, causeStack: error.stack }
          : {}),
      }
    : { cause: 'unknown_error' }
  console.warn('[BeeGame] route failed', {
    traceId,
    route,
    ...diagnostic,
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

async function generateBeeGameAttachmentAnalysis(input: {
  attachments: BeeGameAttachment[]
  workspace: string
  language?: string
  modelConfigId?: string
  ownerId: string
  runtimeEnv?: Record<string, string>
  modelRuntimeHost: BeeGameModelRuntimeHost
}): Promise<AttachmentBuildAnalysis> {
  const configId = input.modelConfigId ?? listModelConfigs(input.ownerId).find(config => config.isDefault)?.id
  const runtime = configId ? mapModelConfigToRuntime(configId) : undefined
  const env = { ...(runtime?.env ?? {}), ...(input.runtimeEnv ?? {}) }
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
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: item.mediaType,
        data: item.data,
      },
    }))
  const rawContent = await input.modelRuntimeHost.generate({
    cwd: input.workspace,
    runtimeEnv: env,
    systemPrompt: `You are the BeeGame attachment design analyst. Return JSON only. Use ${input.language || 'the user language'} for natural-language values while keeping property names in English.`,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text }, ...imageParts],
    }],
    temperature: 0.2,
    maxTokens: 8_192,
    querySource: 'beegame_attachment_analysis',
  })
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
}

async function generateBeeGameIntakeOptions(input: {
  idea: string
  language?: string
  ownerId: string
  modelConfigId?: string
  runtimeEnv?: Record<string, string>
  cwd: string
  modelRuntimeHost: BeeGameModelRuntimeHost
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
  const systemPrompt = [
          'You are BeeGame intake planner.',
          'Do not emit analysis, reasoning, thinking tags, or a thinking summary. Return the requested JSON object directly.',
          'First understand the game request before proposing game modes. The options are target briefs that help the user choose a direction, not full design documents and not project management delivery strategies.',
          'Return only JSON with this schema: maturity, needs_clarification, clarification, clarification_questions, detected_constraints, recommended_next_step, options.',
          'maturity must be one of vague, directional, concrete.',
          'Always return exactly 3 valid, meaningfully distinct game directions for the user to choose from, including when the submitted idea is already concrete.',
          'Do not ask the user for clarification during intake. Set needs_clarification=false, leave clarification empty, leave clarification_questions empty, and set recommended_next_step="choose_direction".',
          'Each option must include id, title, projectFolderName, gameplay, recommendedPlatform, recommendedEngine, recommendedDimension, recommendedGenre, recommendedStyle, recommendedInputs, and scope.',
          'Keep each option concise. BeeGame derives the expanded planning fields after the user chooses a direction; do not duplicate the same explanation across multiple fields.',
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
          'At least one option must stay faithful to the original idea. Do not transform explicit user constraints such as genre, platform, perspective, controls, reference game, or intended fidelity unless the option clearly explains that it is a lower-cost validation alternative.',
          'Avoid generic production strategy titles. Titles should name an actual game mode.',
          'For each option, make gameplay a concise natural-language rules description that the user can immediately understand. Do not output internal rubric names or template section labels in visible option text.',
          'Reject vague options that only say "add levels", "add items", or "make it fun" without explaining the player decisions and failure pressure.',
          'Do not mention dashboard source paths, package paths, commands, or implementation directories.',
          input.language
            ? `Use this selected UI language for every user-facing natural-language JSON value: ${input.language}. Keep JSON property names in English. Keep code, commands, file paths, package names, API identifiers, and unavoidable technical names unchanged.`
            : 'Keep the response language aligned with the user idea. Keep JSON property names in English. Keep code, commands, file paths, package names, API identifiers, and unavoidable technical names unchanged.',
        ].join('\n')
  const requestMessages = [{
    role: 'user',
    content: `Game idea: ${input.idea}`,
  }] satisfies Array<{ role: 'user'; content: string }>
  const firstContent = await input.modelRuntimeHost.generate({
    cwd: input.cwd,
    runtimeEnv: env,
    systemPrompt,
    messages: requestMessages,
    temperature: 0.4,
    maxTokens: 8_192,
    querySource: 'beegame_idea_intake',
  })
  try {
    return parseBeeGameIntakeContent(firstContent)
  } catch (initialError) {
    const repairedContent = await input.modelRuntimeHost.generate({
      cwd: input.cwd,
      runtimeEnv: env,
      systemPrompt,
      temperature: 0.2,
      messages: [
        ...requestMessages,
        { role: 'assistant', content: firstContent },
        {
          role: 'user',
          content: [
            'The previous final response did not satisfy the required JSON contract.',
            `Validation result: ${toErrorMessage(initialError)}`,
            'Correct the invalid or missing options and return exactly 3 valid, meaningfully distinct options.',
            'Return only one complete corrected JSON object now. Do not emit analysis, reasoning, thinking tags, or a thinking summary.',
          ].join('\n'),
        },
      ],
      maxTokens: 8_192,
      querySource: 'beegame_idea_intake_repair',
    })
    try {
      return parseBeeGameIntakeContent(repairedContent)
    } catch (repairError) {
      throw new Error(
        `${toErrorMessage(initialError)} Finalization retry was also invalid: ${toErrorMessage(repairError)}`,
      )
    }
  }
}

function parseBeeGameIntakeContent(content: string): BeeGameIntakeAnalysis {
  return parseBeeGameIntakeAnalysis({
    choices: [{ message: { content } }],
  })
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
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
  const directOptions = Array.isArray(parsed.options) ? parsed.options : []
  const normalized: BeeGameIntakeOption[] = []
  const rejectedReasons: string[] = []
  for (let index = 0; index < directOptions.length; index += 1) {
    const intakeOption = normalizeBeeGameIntakeOption(
      directOptions[index],
      rejectedReasons,
      index,
    )
    if (intakeOption) normalized.push(intakeOption)
  }
  if (normalized.length === 0) {
    const keys = Object.keys(parsed).join(', ') || 'none'
    const reason = rejectedReasons.slice(0, 3).join('; ')
    throw new Error(
      `Model intake response did not include valid options. Parsed keys: ${keys}${reason ? `. Rejected: ${reason}` : ''}`,
    )
  }
  const maturity = normalizeMaturity(parsed.maturity)
  const expectedOptionCount = 3
  if (normalized.length < expectedOptionCount) {
    const keys = Object.keys(parsed).join(', ') || 'none'
    const reason = rejectedReasons.slice(0, expectedOptionCount).join('; ')
    throw new Error(
      `Model intake response did not include enough valid options. Expected ${expectedOptionCount}, received ${normalized.length} from ${directOptions.length} returned. Parsed keys: ${keys}${reason ? `. Rejected: ${reason}` : ''}`,
    )
  }
  return {
    maturity,
    needsClarification: false,
    clarificationQuestions: [],
    detectedConstraints: getStringArrayField(parsed, 'detectedConstraints', 'detected_constraints'),
    recommendedNextStep: 'choose_direction',
    options: normalized.slice(0, expectedOptionCount),
  }
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

  const readableConfigs = await input.dashboardRepository.listModelConfigs(
    input.request,
    input.user,
  )
  const restoredModelConfigId = latest?.modelConfigId &&
    await input.dashboardRepository.modelConfigExists(
      input.request,
      input.user,
      latest.modelConfigId,
    )
    ? latest.modelConfigId
    : undefined
  const modelConfigId = restoredModelConfigId ??
    readableConfigs.find(config => config.isDefault)?.id ??
    readableConfigs[0]?.id
  if (modelConfigId) await input.assertPermittedModelConfigRuntime(modelConfigId)
  const session = input.beeGameSessions.start({
    workspacePath,
    projectId: input.project.id,
    ...(latest?.id ? { transcriptSessionId: latest.id } : {}),
    ...(modelConfigId ? { modelConfigId } : {}),
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
  previewCapabilities: PreviewCapabilityManager
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
  const assetManifest = await readBeeGameAssetManifest(sessionRef.workspacePath)
    .catch(() => ({ version: 1 as const, slots: [], project_target: undefined }))
  const evidenceProvenance = input.dashboardDataRoot
    ? {
        dataRoot: input.dashboardDataRoot,
        sessionId: sessionRef.sessionId,
        workspacePath: sessionRef.workspacePath,
      }
    : undefined
  const acceptance = evidenceProvenance
    ? toProjectAcceptanceState(getNativeDeliveryState(evidenceProvenance))
    : { status: 'not_run' }
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
    project_target: assetManifest.project_target ?? null,
    build_report: preview
      ? previewSnapshotToProjectBuildReport({
          ...preview,
          url: input.previewCapabilities.issueUrl(
            preview.url,
            sessionRef.sessionId,
            input.user.id,
          ),
        })
      : null,
    review_status: null,
    acceptance,
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

class ProjectWorkspaceBusyError extends Error {
  readonly code = 'project_workspace_busy'

  constructor() {
    super('Project workspace cannot be changed while an agent turn is active')
    this.name = 'ProjectWorkspaceBusyError'
  }
}

function assertProjectWorkspaceMutationIdle(session: BeeGameSession): void {
  if (session.turnStatus !== 'idle') {
    throw new ProjectWorkspaceBusyError()
  }
}

function projectWorkspaceMutationRouteError(
  c: Context,
  route: string,
  error: unknown,
): Response {
  if (error instanceof ProjectWorkspaceBusyError) {
    return c.json({
      code: error.code,
      error: error.message,
      recoverable: true,
    }, 409)
  }
  return tracedRouteError(c, route, error)
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
    project_target: null,
    build_report: null,
    review_status: null,
    acceptance: { status: 'not_run' },
    model_config_id: null,
    pending_permissions: [],
  }
}

function toProjectAcceptanceState(
  state: ReturnType<typeof getNativeDeliveryState>,
): JsonObject {
  return {
    status: state.status,
    summary: state.summary,
    ...(state.observedAt ? { validated_at: state.observedAt } : {}),
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
  const closedTurns = new Set(
    events
      .filter(event => (
        event.type === 'turn.completed' ||
        event.type === 'turn.empty' ||
        event.type === 'turn.failed' ||
        event.type === 'session.stopped' ||
        event.type === 'session.failed'
      ))
      .map(event => event.turnId)
      .filter((turnId): turnId is string => Boolean(turnId)),
  )
  return events
    .filter(event => event.type === 'permission.requested')
    .filter(event => {
      const toolUseID = getBeeGamePayloadString(event, 'toolUseID')
      return toolUseID && !resolved.has(toolUseID) && (!event.turnId || !closedTurns.has(event.turnId))
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
      nextAction: 'Review Claude Code permission request',
      updatedAt,
      activeAgents: ['claude-code'],
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
          nextAction: 'Claude Code is processing',
          updatedAt,
          activeAgents: ['claude-code'],
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
  if (getBeeGamePayloadString(latest, 'type') === 'credit.reserve_failed') {
    return {
      phase: 'paused',
      nextAction: latest?.text || 'BeeGame could not reserve credits for this build',
      updatedAt,
      activeAgents: [],
      agentStatus: 'failed',
    }
  }
  if (
    events.some(event => event.type === 'session.started') &&
    !events.some(event => event.type === 'turn.started')
  ) {
    return {
      phase: 'starting',
      nextAction: 'Claude Code session is starting',
      updatedAt,
      activeAgents: ['claude-code'],
      agentStatus: 'starting',
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
  const eventUsage = getLatestRuntimeUsage(events)
  const usage = eventUsage.total_tokens > 0 ? eventUsage : snapshot?.usage
  if (!usage) return null
  const toolUseCount = events.filter(event => event.type.startsWith('tool.')).length
  return {
    bundle_id: 'beegame-runtime',
    phase: snapshot?.phaseName || 'idle',
    status: 'active',
    summary: 'BeeGame runtime observability is active for this session.',
    blackboard_record_count: events.length,
    memory_hits: toolUseCount,
    rag_sources: [],
    selected_skills: [],
    runtime_features: [],
    token_budget: {
      status: 'tracking',
      input_tokens: usage.prompt_tokens,
      cached_input_tokens: usage.cache_read_tokens + usage.cache_creation_tokens,
      output_tokens: usage.completion_tokens,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
      total_tokens: usage.total_tokens,
      role_tokens: snapshot?.roleTokens ?? {
        mainAgent: usage.total_tokens,
        reviewer: 0,
        validator: 0,
        otherSubagents: 0,
        waiting: 0,
      },
    },
    counters: {
      eventCount: events.length,
      toolUseCount,
    },
  }
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

function withPreviewCapability(
  preview: BeeGamePreviewSnapshot,
  capabilities: PreviewCapabilityManager,
  userId: string,
): BeeGamePreviewSnapshot {
  return {
    ...preview,
    url: capabilities.issueUrl(preview.url, preview.sessionId, userId),
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
  requestUrl.searchParams.delete(PREVIEW_CAPABILITY_QUERY_PARAM)
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
  responseHeaders.set('referrer-policy', 'no-referrer')
  if (method === 'GET' && isHtmlResponse(upstream.headers)) {
    const html = await upstream.text()
    responseHeaders.delete('content-length')
    const previewHtml = stripViteClientScript(html, `${prefix}/`)
    return new Response(injectBeeGamePreviewConsoleBridge(previewHtml, sessionId), {
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
    getAuthToken: (request: Request) => string | undefined
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
    issuePreviewCookie: (
      request: Request,
      sessionId: string,
      userId: string,
    ) => string
    issuePreviewUrl: (
      url: string,
      sessionId: string,
      userId: string,
    ) => string
    revokePreviewCapability: (sessionId: string) => void
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
    if (metadata?.workspacePath) {
      if (checkSession(request, sessionId)) throw new Error('Session not found')
      return metadata.workspacePath
    }
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
    if (body.modelConfigId !== undefined || body.transcriptSessionId !== undefined) {
      return c.json({ error: 'Runtime session fields are server-owned' }, 400)
    }
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
        undefined,
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
          ...(isBeeGameSessionLanguage(body.language)
            ? { language: body.language }
            : {}),
          userId: currentUser.id,
          ...(options.getAuthToken(c.req.raw)
            ? { authToken: options.getAuthToken(c.req.raw) }
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
          const after = Number.parseInt(c.req.query('after') || '0', 10)
          const workspacePath = await getSessionWorkspacePath(c.req.raw, c.req.param('id'), legacyWorkspacePath)
          return await readTranscriptFromWorkspace(
            c.req.param('id'), workspacePath, defaultWorkspacePath,
            getDashboardDataRoot(defaultWorkspacePath), after,
          )
        } catch {
          // Preserve the deliberately opaque 404 response for an invalid
          // session/workspace combination.
        }
      }
      return c.json(sessionForbidden, 404)
    }
    try {
      const after = Number.parseInt(c.req.query('after') || '0', 10)
      beeGameSessions.updateAuthToken(
        c.req.param('id'),
        options.getAuthToken(c.req.raw),
      )
      return c.json(beeGameSessions.events(c.req.param('id'), after))
    } catch (err) {
      const workspacePath = getWorkspacePathHint(
        c.req.query('workspacePath'),
        {
          workspacePath: c.req.header('x-beegame-workspace-path'),
        },
      )
      if (toErrorMessage(err) === 'Session not found' && workspacePath) {
        const after = Number.parseInt(c.req.query('after') || '0', 10)
        try {
          const resolvedWorkspace = await getSessionWorkspacePath(c.req.raw, c.req.param('id'), workspacePath)
          return readTranscriptFromWorkspace(
            c.req.param('id'), resolvedWorkspace, defaultWorkspacePath,
            getDashboardDataRoot(defaultWorkspacePath), after,
          )
        } catch {
          // Fall through to the opaque route error below.
        }
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
    if (sessionForbidden) {
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
          )
        } catch {
          // Keep the session/workspace relationship opaque when ownership or
          // path validation fails.
        }
      }
      return c.json(sessionForbidden, 404)
    }
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

  app.get(`${basePath}/:id/artifacts`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'Missing query: path' }, 400)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
        c.req.query('workspacePath'),
      )
      if (!beeGameSessions.get(c.req.param('id'))) {
        return c.json(await readBeeGameProjectArtifact(workspacePath, path))
      }
      return c.json(await beeGameSessions.readArtifact(c.req.param('id'), path))
    } catch (err) {
      const message = toErrorMessage(err)
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
      if (!manifest.slots.length) {
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
    const activeSession = beeGameSessions.get(c.req.param('id'))
    if (!activeSession) return c.json({ error: 'Session not found' }, 404)
    try {
      assertProjectWorkspaceMutationIdle(activeSession)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 409)
    }
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
      const sessionId = c.req.param('id')
      c.header('set-cookie', options.issuePreviewCookie(
        c.req.raw,
        sessionId,
        options.getCurrentUser(c.req.raw).id,
      ))
      return c.json({
        ...beeGamePreviews.status(sessionId, workspacePath),
        url: options.issuePreviewUrl(
          beeGamePreviews.status(sessionId, workspacePath).url,
          sessionId,
          options.getCurrentUser(c.req.raw).id,
        ),
      })
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/preview`, async c => {
    const forbidden = check(c.req.raw, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const activeSession = beeGameSessions.get(c.req.param('id'))
    if (!activeSession) return c.json({ error: 'Session not found' }, 404)
    try {
      assertProjectWorkspaceMutationIdle(activeSession)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 409)
    }
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
      c.header('set-cookie', options.issuePreviewCookie(
        c.req.raw,
        c.req.param('id'),
        options.getCurrentUser(c.req.raw).id,
      ))
      return c.json({
        ...snapshot,
        url: options.issuePreviewUrl(
          snapshot.url,
          c.req.param('id'),
          options.getCurrentUser(c.req.raw).id,
        ),
      })
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/preview/restart`, async c => {
    const forbidden = check(c.req.raw, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const activeSession = beeGameSessions.get(c.req.param('id'))
    if (!activeSession) return c.json({ error: 'Session not found' }, 404)
    try {
      assertProjectWorkspaceMutationIdle(activeSession)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 409)
    }
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
      c.header('set-cookie', options.issuePreviewCookie(
        c.req.raw,
        c.req.param('id'),
        options.getCurrentUser(c.req.raw).id,
      ))
      return c.json({
        ...snapshot,
        url: options.issuePreviewUrl(
          snapshot.url,
          c.req.param('id'),
          options.getCurrentUser(c.req.raw).id,
        ),
      })
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
      options.revokePreviewCapability(c.req.param('id'))
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
      const activeSession = beeGameSessions.get(c.req.param('id'))
      if (!activeSession) return c.json({ error: 'Session not found' }, 404)
      try {
        assertProjectWorkspaceMutationIdle(activeSession)
      } catch (err) {
        return c.json({ error: toErrorMessage(err) }, 409)
      }
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
          ...(options.getAuthToken(c.req.raw)
            ? { authToken: options.getAuthToken(c.req.raw) }
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
      if (
        body.displayText !== undefined ||
        body.displayKind !== undefined ||
        body.taskType !== undefined ||
        body.thinkingMode !== undefined
      ) {
        return c.json({ error: 'Internal turn fields are server-owned' }, 400)
      }
      if (body.text === undefined && attachments.length === 0) {
        return c.json({ error: 'Missing field: text' }, 400)
      }
      const inputText = typeof body.text === 'string' ? body.text : ''
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
          taskType: 'edit_turn',
          clientMessageId,
          supersedesMessageId,
          attachments,
          ...(isBeeGameSessionLanguage(body.language)
            ? { language: body.language }
            : {}),
          ...(options.getAuthToken(c.req.raw)
            ? { authToken: options.getAuthToken(c.req.raw) }
            : {}),
        }),
      )
    } catch (err) {
      if (err instanceof BeeGameUploadPolicyError) return uploadPolicyResponse(err)
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/idea`, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    return c.json({
      error: 'Direct idea construction has been removed. Confirm an intake option and submit a production brief.',
    }, 410)
  })

  app.post(`${basePath}/:id/confirmed-brief`, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
      const brief = isObject(body.brief) ? body.brief : body
      const idea = typeof brief.idea === 'string' ? brief.idea.trim() : ''
      if (!idea) return c.json({ error: 'Missing field: brief.idea' }, 400)
      const languageValue = body.language ?? brief.language
      const language = isBeeGameSessionLanguage(languageValue) ? languageValue : undefined
      const prompt = buildConfirmedBriefPrompt(brief, language)
      return c.json(await beeGameSessions.sendWithDisplay(c.req.param('id'), prompt, {
        displayText: idea,
        displayKind: 'confirmed_brief',
        taskType: 'full_build',
        ...(language ? { language } : {}),
        ...(options.getAuthToken(c.req.raw) ? { authToken: options.getAuthToken(c.req.raw) } : {}),
      }))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/continue`, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const body = await readOptionalJson(c.req.raw)
      const language = isBeeGameSessionLanguage(body.language) ? body.language : 'en'
      return c.json(await beeGameSessions.sendWithDisplay(
        c.req.param('id'),
        getServerOwnedContinuePrompt(language),
        {
          taskType: 'continue_turn',
          language,
          ...(options.getAuthToken(c.req.raw) ? { authToken: options.getAuthToken(c.req.raw) } : {}),
        },
      ))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/action`, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
      const kind = typeof body.kind === 'string' ? body.kind : ''
      const language = isBeeGameSessionLanguage(body.language) ? body.language : 'en'
      if (kind === 'asset_integrate' || kind === 'asset_prepare_selection') {
        const slotIds = Array.isArray(body.slotIds)
          ? [...new Set(body.slotIds.filter((value): value is string => (
              typeof value === 'string' && value.trim().length > 0
            )).map(value => value.trim()))]
          : []
        if (slotIds.length === 0) return c.json({ error: 'Missing field: slotIds' }, 400)
        const session = beeGameSessions.get(c.req.param('id'))
        if (!session) return c.json({ error: 'Session not found' }, 404)
        const manifest = await readBeeGameAssetManifest(session.cwd)
        const contractedSlotIds = new Set(manifest.slots.map(slot => slot.id))
        if (slotIds.some(slotId => !contractedSlotIds.has(slotId))) {
          return c.json({ error: 'Asset action contains slots outside the project contract' }, 422)
        }
        return c.json(await beeGameSessions.sendWithDisplay(
          c.req.param('id'),
          JSON.stringify({
            kind: 'asset_integration_request',
            action: kind === 'asset_integrate' ? 'integrate' : 'prepare_selection',
            slot_ids: slotIds,
          }, null, 2),
          {
            displayText: getServerOwnedProjectActionLabel(kind, language),
            displayKind: 'asset_integration',
            taskType: 'asset_integration',
            language,
            ...(options.getAuthToken(c.req.raw) ? { authToken: options.getAuthToken(c.req.raw) } : {}),
          },
        ))
      }
      if (kind === 'build_error_repair') {
        const session = beeGameSessions.get(c.req.param('id'))
        if (!session) return c.json({ error: 'Session not found' }, 404)
        const preview = beeGamePreviews.status(c.req.param('id'), session.cwd)
        if (preview.status !== 'failed') {
          return c.json({ error: 'No failed server-owned build report is available' }, 409)
        }
        return c.json(await beeGameSessions.sendWithDisplay(
          c.req.param('id'),
          JSON.stringify({
            kind: 'build_error_repair_request',
            build_report: {
              status: preview.status,
              message: preview.message ?? '',
              script: preview.script ?? null,
              entrypoint: preview.entrypoint ?? null,
            },
          }, null, 2),
          {
            displayText: getServerOwnedProjectActionLabel(kind, language),
            displayKind: 'build_error_repair',
            taskType: 'edit_turn',
            language,
            ...(options.getAuthToken(c.req.raw) ? { authToken: options.getAuthToken(c.req.raw) } : {}),
          },
        ))
      }
      if (kind === 'deployment_failure_repair') {
        const session = beeGameSessions.get(c.req.param('id'))
        if (!session) return c.json({ error: 'Session not found' }, 404)
        const persistedDeployments = await options.listDeploymentRecords?.(
          c.req.raw,
          session.id,
        )
        const deployments = persistedDeployments ?? (
          beeGameDeployments ? await beeGameDeployments.list(session.id) : []
        )
        const latestFailure = deployments
          .find(deployment => deployment.status === 'failed')
        if (!latestFailure) {
          return c.json({ error: 'No failed deployment is available' }, 409)
        }
        const deliveryState = getNativeDeliveryState({
          dataRoot: getDashboardDataRoot(options.defaultWorkspacePath),
          sessionId: session.id,
          workspacePath: session.cwd,
        })
        return c.json(await beeGameSessions.sendWithDisplay(
          c.req.param('id'),
          JSON.stringify({
            kind: 'deployment_failure_repair_request',
            deployment_failure: {
              message: latestFailure.message ?? '',
              build_log: latestFailure.buildLog ?? '',
            },
            delivery_state: deliveryState,
            instructions: [
              'Continue this same native Claude Code task; do not treat this request as a new product brief.',
              'Resolve the observed deployment or acceptance failure without weakening or bypassing the deployment gate.',
              'If document review is missing, stale, blocked, or needs revision, resolve the document findings and obtain one valid READY result from beegame-document-reviewer before implementation or validation.',
              'If native acceptance is missing or stale after document review is READY, run one beegame-acceptance-validator for the current workspace revision and wait for its native terminal result.',
              'If validation reports findings, repair them and validate the changed revision again before claiming completion.',
            ],
          }, null, 2),
          {
            displayText: getServerOwnedProjectActionLabel(kind, language),
            displayKind: 'deployment_failure_repair',
            taskType: 'edit_turn',
            language,
            ...(options.getAuthToken(c.req.raw) ? { authToken: options.getAuthToken(c.req.raw) } : {}),
          },
        ))
      }
      return c.json({ error: 'Unsupported project action' }, 400)
    } catch (err) {
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
    if (body.remember === true) {
      return c.json({ error: 'Persistent runtime permissions are not available through the Web API' }, 400)
    }
    try {
      const resolved = beeGameSessions.resolvePermission(
        c.req.param('id'),
        c.req.param('toolUseID'),
        {
          behavior: decision,
          remember: false,
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
  }
}

function buildConfirmedBriefPrompt(
  brief: JsonObject,
  language?: BeeGameSessionLanguage,
): string {
  const confirmedBrief = JSON.stringify({
    kind: 'confirmed_build_brief',
    document_language: language ?? null,
    idea: typeof brief.idea === 'string' ? brief.idea.trim() : '',
    selected_option: toCanonicalConfirmedOption(brief.option),
    settings: isObject(brief.settings) ? brief.settings : null,
    confirmed_gdd: brief.confirmedGdd ?? null,
    build_source: brief.buildSource ?? null,
    analysis_id: brief.analysisId ?? null,
  }, null, 2)
  return [
    'Build and deliver the confirmed game project below.',
    '',
    language
      ? `Write all human-readable project documentation and user-facing game text in ${getDocumentLanguageName(language)}. Keep code identifiers, APIs, commands, file paths, package names, and unavoidable technical tokens unchanged.`
      : 'Write project documentation in the language used by the confirmed user brief. Keep code identifiers, APIs, commands, file paths, package names, and unavoidable technical tokens unchanged.',
    '',
    'Use the confirmed brief as the source of truth. Preserve every explicit user choice and constraint; do not silently replace the selected platform, engine, dimension, genre, visual style, input methods, or scope.',
    'Before implementation, create the complete project documentation baseline in this same native Claude Code task. Write each document to its canonical path as soon as it is ready so progress and review remain observable; do not hold completed documents for one final batch.',
    'Follow the document dependency order: (1) docs/GDD.md; (2) docs/ART_DIRECTION.md, docs/UI_UX_SPEC.md, and docs/AUDIO_DESIGN.md, which may be developed concurrently after the GDD; (3) docs/TECHNICAL_DESIGN.md and docs/ASSET_PLAN.md after the product and presentation requirements are defined; (4) docs/acceptance/gameplay-checklist.md after the preceding documents provide traceable requirements and player paths. If a concern is intentionally minimal or procedural, document that decision and its implementation implications instead of omitting the document.',
    'Together these documents must define the player-visible loop from launch through progress, win/fail and restart; controls for every selected input method; rules, state transitions and edge cases; presentation and asset requirements; a feasible technical design that traces each required behavior to an implementation responsibility; and observable acceptance paths with concrete actions and expected outcomes.',
    'Separate committed first-delivery scope from later ideas. Record necessary assumptions explicitly. Do not claim libraries, systems, assets or behavior that the implementation will not actually provide, and do not pad documents with generic template prose.',
    'Give every committed requirement and player path a stable identifier. For each player path, document the concrete player actions, observable expected results, and required evidence. Keep this platform-neutral and use the project documents own structure; do not introduce a BeeGame-specific game schema.',
    'Finish the complete document baseline before launching one native beegame-document-reviewer subagent in the foreground. Pass it the canonical confirmed brief and selected document language, and do not modify project documents while that review is running. Do not begin implementation until the reviewer reports READY for that exact document revision. If it reports findings, finish all document corrections and launch a new reviewer for the changed revision; do not continue the old reviewer with SendMessage and do not treat its old result as approval of changed files. If the native runtime nevertheless moves the reviewer to the background, do not poll TaskOutput or read its output file; yield that response so the native task notification can resume this same session.',
    '',
    'Plan and implement the project with applicable native Skills. After all intended project edits are complete, invoke exactly one native beegame-acceptance-validator subagent in the foreground for that exact workspace revision, so any project-native runtime permission remains visible to the user. Do not change project files while that Validator is running and do not launch another Validator for the same unchanged revision. Use its terminal JSON directly. If the native runtime nevertheless moves it to the background, do not poll TaskOutput or read its output file; yield the turn and let the native task notification resume this same session. After notification, treat only the Validator terminal result as acceptance evidence. A blocked result remains blocked and must never be described as ready or delivered. If validation fails, repair only the observed findings first; after any project edit, launch a new foreground Validator for the changed revision and require one final complete player-path smoke pass. Never make a post-validation cleanup edit without validating that final revision. If no valid terminal Validator JSON is returned, continue the task until validation reaches a terminal passed, failed, or blocked result; do not claim completion from compilation, source inspection, or the implementation agent\'s own summary alone.',
    '',
    'Confirmed brief:',
    confirmedBrief,
  ].join('\n')
}

function toCanonicalConfirmedOption(value: unknown): JsonObject | null {
  if (!isObject(value)) return null
  const gameplay = typeof value.gameplay === 'string' ? value.gameplay.trim() : ''
  const pitch = typeof value.pitch === 'string' ? value.pitch.trim() : ''
  return {
    ...(typeof value.id === 'string' && value.id.trim() ? { id: value.id.trim() } : {}),
    ...(typeof value.title === 'string' && value.title.trim()
      ? { title: value.title.trim() }
      : {}),
    ...(pitch && pitch !== gameplay ? { pitch } : {}),
    ...(gameplay ? { gameplay } : {}),
    ...(typeof value.scope === 'string' && value.scope.trim()
      ? { scope: value.scope.trim() }
      : {}),
  }
}

function getDocumentLanguageName(language: BeeGameSessionLanguage): string {
  const names: Record<BeeGameSessionLanguage, string> = {
    en: 'English',
    zh: 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
  }
  return names[language]
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

function toOutboundTargetError(
  inspection: Extract<OutboundTargetInspection, { approved: false }>,
): { error: string; code: string; message: string; hostname?: string } {
  const hostname = inspection.hostname
  const target = hostname ? ` "${hostname}"` : ''
  const messages: Record<typeof inspection.code, string> = {
    invalid_url: 'Enter a valid absolute model provider URL.',
    unsupported_protocol: 'Model provider URLs must use HTTPS.',
    embedded_credentials: 'Model provider URLs cannot contain embedded credentials.',
    host_not_allowed: `Outbound host${target} is not approved by this deployment.`,
    port_not_allowed: `Outbound host${target} uses a port that is not approved by this deployment.`,
    dns_unresolved: `Outbound host${target} could not be resolved.`,
    address_not_public: `Outbound host${target} did not resolve to a permitted public address.`,
  }
  return {
    error: 'Outbound URL is not permitted',
    code: `outbound_${inspection.code}`,
    message: messages[inspection.code],
    ...(hostname ? { hostname } : {}),
  }
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
    value === 'ko' ||
    value === 'fr' ||
    value === 'de' ||
    value === 'es' ||
    value === 'it' ||
    value === 'pt'
}

function getServerOwnedContinuePrompt(language: BeeGameSessionLanguage): string {
  if (language === 'zh') return '继续任务'
  if (language === 'zh-TW') return '繼續任務'
  if (language === 'ja') return 'タスクを続けてください'
  if (language === 'ko') return '작업을 계속해 주세요'
  return 'Continue the task.'
}

function getServerOwnedProjectActionLabel(
  kind: 'asset_integrate' | 'asset_prepare_selection' | 'build_error_repair' | 'deployment_failure_repair',
  language: BeeGameSessionLanguage,
): string {
  const isChinese = language === 'zh' || language === 'zh-TW'
  if (kind === 'asset_integrate') return isChinese ? '集成所选资源' : 'Integrate selected assets'
  if (kind === 'asset_prepare_selection') return isChinese ? '完善资源选择条件' : 'Prepare resource selection'
  if (kind === 'deployment_failure_repair') return isChinese ? '修复发布验收' : 'Repair deployment acceptance'
  return isChinese ? '修复构建错误' : 'Repair build errors'
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
