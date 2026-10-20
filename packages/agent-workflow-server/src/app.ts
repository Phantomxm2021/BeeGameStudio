import { Hono, type Context } from 'hono'
import { registerModelConnectionRoutes, validateDynamicGoConfig } from './model-connection-routes'
import { validateModelAccess } from '@bee-game-studio/agent-workflow'
import { registerV3Routes } from './beegame/workflow-v3/routes'
import { registerV3DebugPage } from './beegame/workflow-v3/debug-page'
import { createMeasuredPreview, type MeasuredPreviewManager, type CandidatePreview } from './beegame/workflow-v3/measured-preview'
import { createPreviewStorageStore } from './beegame/preview-storage-store'
import { WorkflowError } from './beegame/workflow-v3/state'
import { projectExecutionTime } from './beegame/workflow-v3/execution-time'
import { createLocalWorkflowStore, createRemoteWorkflowStore, type WorkflowStore } from './beegame/workflow-v3/store'
import { normalizeRuntimeEnvironment } from '../../../src/utils/runtimeEnvironment'
import { UserQuestionValidationError } from './beegame/user-question'
import { intakeReferenceParts } from './beegame/intake-references'
import { openPreviewTestAccess } from './beegame/preview-test-access'
import { appendRuntimeDiagnostic } from './beegame/project-records'
import { readChatAttachment } from './beegame/chat-attachments'
import { materializeBeeGameAttachments } from './beegame/session-manager'
import { appendProjectChatTimeline, projectChatEventsAfter } from './beegame/project-chat-timeline'
import { runtimeActivity } from './beegame/runtime-activity'
import { z } from 'zod/v4'
import { registerDevProjectPurgeRoutes } from './dev-project-purge'
import {
  readCanonicalProjectArtifactConsistently as readProjectArtifactConsistently,
  type ProjectArtifactIdentity,
} from './beegame/project-artifact-store'
import { cors } from 'hono/cors'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  listModelConfigs,
  mapModelConfigToRuntime,
  type ModelProviderKind,
  type RuntimeModelConfig,
} from '@bee-game-studio/agent-workflow'
import {
  RESOURCE_LIBRARY_USAGE,
  RESOURCE_USAGE_TAGS,
  type ResourceLibraryUsage,
} from '../../beegame-resource-core/src/types'
import {
  assertResourceSemanticVisualInput,
  RESOURCE_SEMANTIC_EVIDENCE_SOURCES,
  RESOURCE_SEMANTIC_MODEL_OUTPUT_SCHEMA,
  RESOURCE_SEMANTIC_MODEL_TOOL_NAME,
  type ResourceSemanticVisualInput,
} from '../../beegame-resource-core/src/semantic-curation'
import {
  BeeGameSessionManager,
  formatBeeGameEventForDisplay,
  deleteSessionArtifactsFromTranscript,
  getLatestRuntimeUsage,
  liveProjectConversationEvents,
  readSessionTranscriptFromDisk,
  recoverLatestProjectSessionFromDisk,
  type BeeGameEvent,
  type BeeGameRuntimeSnapshot,
  type BeeGameSession,
  type BeeGameAttachment,
  type BeeGamePendingPermission,
  type BeeGameSessionLanguage,
  type BeeGameSessionRunner,
} from './beegame/session-manager'
import {
  createProcessIsolatedModelRuntimeHost,
  BeeGameModelRuntimeError,
  type BeeGameModelGenerateInput,
  type BeeGameModelUsage,
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
import { proxyBeeGamePreviewRequest } from './beegame/preview-proxy'
export { proxyBeeGamePreviewRequest } from './beegame/preview-proxy'
import {
  BeeGameDeploymentManager,
  mergeDeploymentRecords,
  createSupabaseStorageDeploymentPublisherFromEnv,
  type BeeGameDeploymentRecord,
  type BeeGameDeploymentRetentionResult,
  type BeeGameDeploymentPublisher,
  type BeeGameDeploymentRunner,
} from './beegame/deployment-manager'
import { createR2DeploymentPublisherFromEnv } from './beegame/r2-deployment-publisher'
import {
  BeeGameAssetManifestError,
  readBeeGameAssetManifest,
  toCanonicalBeeGameAssetManifest,
  uploadBeeGameAsset,
} from './beegame/asset-contracts'
import type { ResourceSelectionRuntimeConfig } from './beegame/resource-selection-config'
import { listDirectories } from './filesystem/directories'
import { getDefaultWorkspacePath } from './filesystem/default-workspace'
import {
  loadModelConfigsFromStore,
  type ModelConfigStoreOptions,
} from './model-config-store'
import { type BeeGameProjectMetadata } from './project-metadata-store'
import { createR2ProjectAssetStorageFromEnv } from './r2-project-asset-storage'
import { syncRuntimeSettingsToDedicatedRuntimeConfig } from './runtime-settings-store'
import { CHATGPT_IMAGE_ENDPOINT, imageConfigPatchSchema, imageProviderSchema, publicImageConfig, updateImageConfig } from './image-generation/config'
import { ImageAttemptStore } from './image-generation/attempt'
import { ImageGenerationService } from './image-generation/service'
import { createHostedImageGenerationProvider } from './image-generation'
import { hasChatGPTAccount } from './model-connections'
import { openImageGenerationAccess } from './image-generation/access'
import { loadRuntimeImageConfig } from './image-generation/runtime-config'
import { loadPersonalImageConnection, publicPersonalImageConnection, savePersonalImageConnection } from './image-generation/personal-connection'
import { createImageBillingClient } from '@bee-game-studio/beegame-billing-core/image-billing'
import {
  discoverMcpServers,
  readDiscoveredMcpServerInput,
  type McpServerScope,
  type McpServerTransport,
} from './mcp-servers-store'
import {
  discoverActiveMcpServers,
  parsePortList,
  testMcpServerConnection,
} from './mcp-active-discovery'
import { type AppendAuditEventInput } from './audit-events-store'
import {
  type BeeGamePermission,
  type BeeGameUserContext,
  type BeeGameUserResolver,
  BeeGameAuthUnavailableError,
  DEFAULT_LOCAL_USER_ID,
  createConfiguredUserResolver,
  hasBeeGamePermission,
  listBeeGamePermissions,
} from './auth/user-context'
import { createBeeGameAuthContext } from './auth/auth-context'
import { proxyAuthenticatedBillingRequest } from './auth/authenticated-billing-proxy'
import { proxyAuthenticatedSkillsRequest } from './auth/authenticated-skills-proxy'
import { proxyAuthenticatedResourceRequest } from './auth/authenticated-resource-proxy'
import {
  createPreviewCapabilityManager,
  type PreviewCapabilityManager,
} from './auth/preview-capability'
import {
  registerBeeGameSessionRoutes as registerHttpOnlySessionRoutes,
  resolveValidRequestAccessToken,
} from './auth/session-routes'
import {
  DashboardRepository,
  ProjectQuotaExceededError,
} from './dashboard-repository'
import {
  createManagedProjectWorkspacePath,
  deleteWorkspaceDirectoryIfSafe,
  getDashboardDataRoot,
  getUserDashboardDataRoot,
  resolveSessionWorkspacePath,
} from './local-runtime-service'
import { createSupabaseDashboardStoreFromEnv } from './supabase-dashboard-store'
import { createTLSAwareFetch } from '@bee-game-studio/security-core'
import { createSupabaseRuntimeEnvClientFromEnv } from './supabase-runtime-env-client'
import {
  createInvitationServiceFromEnv,
  InvitationServiceError,
  type InvitationService,
} from './invitation-service'
import { resolveBeeGameBillingConfig } from '@bee-game-studio/beegame-billing-core/billing-config'
import {
  BeeGameUsageBillingError,
  createRemoteUsageBillingClient,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { registerBeeGameBillingStoreRoutes } from '@bee-game-studio/beegame-billing-core/billing-route-groups'
import {
  readRequestBytes,
  RequestBodyLimitError,
} from '@bee-game-studio/beegame-skills-core/request-body'
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
import { validateSecretStorageAtStartup, getSecretEncryptionKey } from './security/secret-crypto'
import { createHostExitReceipts } from './beegame/workflow-v3/host-exit-receipt'
import {
  BeeGameUploadPolicyError,
  MAX_BEEGAME_REQUEST_BYTES,
  MAX_BEEGAME_PROJECT_ASSET_BYTES,
  MAX_BEEGAME_PROJECT_ASSET_REQUEST_BYTES,
  validateBeeGameAttachments,
} from './security/upload-policy'
import {
  deleteBeeGameIntakeJob,
  loadBeeGameIntakeJob,
  saveBeeGameIntakeJob,
} from './beegame/intake-job-store'
import { BEEGAME_USER_RESPONSE_SCOPE } from './beegame/user-response-scope'
import { projectRuntimeDisplayReason } from './beegame/project-runtime-display'

type JsonObject = Record<string, unknown>

const RESOURCE_SEMANTIC_MODEL_MIN_OUTPUT_TOKENS = 4_096
const RESOURCE_SEMANTIC_MODEL_OUTPUT_TOKENS_PER_ITEM = 1_024


function getResourceSemanticModelOutputTokens(itemCount: number): number {
  return Math.max(
    RESOURCE_SEMANTIC_MODEL_MIN_OUTPUT_TOKENS,
    itemCount * RESOURCE_SEMANTIC_MODEL_OUTPUT_TOKENS_PER_ITEM,
  )
}

function buildResourceSemanticCuratorSystemPrompt(
  curatorRevision: string,
): string {
  return [
    'Classify every inspected resource in one batch for the BeeGame Resource Library.',
    'Submit exactly one call to the required structured submission tool and do not emit markdown, explanation, or code fence text.',
    'The tool input top-level key must be exactly decisions and its value must contain exactly one decision per supplied item.',
    'Do not add batchId, jobId, curatorRevision, analysis, summary, or any other top-level field.',
    'Each decision object keys must be exactly: element_id, source_content_hash, usageTags, confidence, evidence, curator_revision.',
    'element_id and source_content_hash must be copied from the supplied item projection.',
    'The visualInput is mandatory. One or two elements are supplied as individual rendered images; more than two elements are supplied as one rendered Atlas with an ordered cell map.',
    'Use the supplied rendered image as the required basis for every usage-tag decision. Structured facts are context only and never replace the image. Do not infer identity from pixels, filenames, or paths.',
    `Canonical usageTags are exactly: ${RESOURCE_USAGE_TAGS.join(', ')}. usageTags must be an array containing only these values; use an empty array when the evidence is insufficient.`,
    'confidence must be high, medium, or low.',
    `evidence must be an array of objects with source, reference, and observation. Every decision must include one content_preview evidence item whose reference is exactly the decision element_id. Evidence source is exactly one of: ${RESOURCE_SEMANTIC_EVIDENCE_SOURCES.join(', ')}. Structured observations must remain grounded in the supplied technical facts, content profile, or dependency summary, but they cannot replace visual evidence.`,
    `curator_revision must be exactly ${JSON.stringify(curatorRevision)} in every decision.`,
    'Do not infer a gameplay role from a filename or path. Do not invent an asset or claim that a resource is suitable when the projection does not establish it.',
  ].join('\n')
}

const RESOURCE_MODEL_RUNTIME_KEYS = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'BGS_DEFAULT_FAST_MODEL',
  'BGS_DEFAULT_BALANCED_MODEL',
  'BGS_DEFAULT_STRONG_MODEL',
  'BGS_USE_OPENAI',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_DEFAULT_HAIKU_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'BGS_USE_GEMINI',
  'GEMINI_BASE_URL',
  'GEMINI_API_KEY',
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'BGS_USE_GROK',
  'GROK_BASE_URL',
  'GROK_API_KEY',
  'GROK_DEFAULT_HAIKU_MODEL',
  'GROK_DEFAULT_SONNET_MODEL',
  'GROK_DEFAULT_OPUS_MODEL',
])

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
  genres: [
    'Arcade',
    'Action',
    'Adventure',
    'Puzzle',
    'Racing',
    'RPG',
    'Strategy',
    'Simulation',
    'Shooter',
    'Platformer',
    'Casual',
  ],
  styles: [
    'Pixel',
    'Cartoon',
    'Stylized',
    'Minimal',
    'Realistic',
    'Low Poly',
    'Hand-drawn',
    'Sci-fi',
    'Fantasy',
  ],
  inputs: [
    'Keyboard/mouse',
    'Touch',
    'Gamepad',
    'Motion',
    'Voice',
    'Hand tracking',
  ],
} as const

type BeeGameIntakeJob = {
  ownerId: string
  runtimeId: string
  status: 'running' | 'completed' | 'failed'
  result?: BeeGameIntakeAnalysis
  error?: string
  errorStatus?: number
  createdAt: number
  updatedAt: number
}

export type AgentWorkflowAppOptions = {
  /** Explicit backend injection for local development and deterministic tests. */
  workflowV3Store?: WorkflowStore | false
  workflowV3PreviewOrigin?: string
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
  resourceSelectionRuntimeConfig?: ResourceSelectionRuntimeConfig
  invitationService?: InvitationService | false
  registerCleanup?: (cleanup: () => void) => void
}

export const ROUTE_PERMISSION = {
  modelConfig: 'model_config.manage',
  webTools: 'secrets.manage',
  runtimeSettings: 'runtime_settings.manage',
  mcp: 'mcp.manage',
  userSkills: 'skills.manage',
  resourceLibrary: 'resources.manage',
  invitations: 'workspace.manage_members',
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
  let measuredPreview: MeasuredPreviewManager | undefined
  // Before auth and every API route: preview hosts can only serve measured files.
  app.use('*', async (c, next) => {
    const response = await measuredPreview?.handle(c.req.raw)
    if (response) return response
    await next()
  })
  app.onError((error, c) => {
    // Covers auth middleware, session refresh and downstream service proxies.
    if (error instanceof BeeGameAuthUnavailableError) {
      return c.json({
        error: 'Authentication unavailable', code: 'authentication_unavailable',
        message: 'Authentication service is temporarily unavailable',
        recoverable: true, retry_after_ms: 2_000,
      }, 503, { 'Retry-After': '2' })
    }
    if (isPrivilegedConfigurationPath(c.req.path)) {
      return privilegedRouteError(c, c.req.path, error)
    }
    return tracedRouteError(c, c.req.path, error, 500)
  })
  // Credentialed browser clients may host the dashboard and runtime on
  // separate origins. Register CORS before every API route, including the
  // HttpOnly session endpoints, so successful refresh responses are readable.
  app.use(
    '/api/*',
    cors({
      origin: resolveApiCorsOrigin,
      credentials: true,
      // Deliberately omit allowHeaders: Hono reflects the browser's requested
      // headers after the origin has passed the explicit trusted-origin policy.
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      // Explicit export identity is verified by separately hosted dashboards.
      // Do not expose credentials or loosen the trusted-origin policy.
      exposeHeaders: ['X-BGS-Artifact-SHA256', 'X-BGS-Export-Kind'],
    }),
  )
  const outboundTargetPolicyOptions: OutboundTargetPolicyOptions = {
    ...options.outboundTargetPolicyOptions,
    allowedHosts:
      options.outboundTargetPolicyOptions?.allowedHosts ??
      readAllowedOutboundHosts(),
    allowTrustedDevelopmentProxy:
      options.outboundTargetPolicyOptions?.allowTrustedDevelopmentProxy ??
      (process.env.NODE_ENV !== 'production' &&
        process.env.BEEGAME_ALLOW_TRUSTED_DEVELOPMENT_OUTBOUND_PROXY === '1'),
  }
  const resolveOutboundTarget =
    options.outboundTargetResolver ?? resolveApprovedOutboundTarget
  const modelRuntimeHost =
    options.modelRuntimeHost ??
    createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions,
      resolveOutboundTarget,
    })
  const inspectPermittedOutboundUrl = async (
    value: unknown,
  ): Promise<OutboundTargetInspection | null> => {
    if (value === undefined || value === '') return null
    if (typeof value !== 'string') {
      return { approved: false, code: 'invalid_url' }
    }
    if (options.outboundTargetResolver) {
      const target = await options.outboundTargetResolver(
        value,
        outboundTargetPolicyOptions,
      )
      return target
        ? { approved: true, target }
        : {
            approved: false,
            code: 'address_not_public',
            hostname: safeUrlHost(value) || undefined,
          }
    }
    return inspectOutboundTarget(value, outboundTargetPolicyOptions)
  }
  const hasPermittedOutboundUrl = async (value: unknown): Promise<boolean> =>
    (await inspectPermittedOutboundUrl(value))?.approved !== false
  const assertPermittedOutboundUrl = async (value: string): Promise<void> => {
    if (!(await hasPermittedOutboundUrl(value)))
      throw new Error('Outbound URL is not permitted')
  }
  const assertPermittedModelConfigRuntime = async (
    modelConfigId: string,
  ): Promise<void> => {
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
  const serviceFetch = createTLSAwareFetch()
  const supabaseStore = createSupabaseDashboardStoreFromEnv(
    process.env,
    serviceFetch,
  )
  const supabaseRuntimeEnvClient = supabaseStore
    ? createSupabaseRuntimeEnvClientFromEnv(serviceFetch)
    : undefined
  const invitationService =
    options.invitationService === false
      ? undefined
      : (options.invitationService ?? createInvitationServiceFromEnv())
  const configuredUserResolver = createConfiguredUserResolver(process.env, {
    fetchImpl: serviceFetch,
  })
  const sessionAuth = registerHttpOnlySessionRoutes(app, {
    fetchImpl: serviceFetch,
    sessionStorePath: options.sessionStorePath,
    isOriginAllowed: origin => Boolean(resolveApiCorsOrigin(origin)),
  })
  const authContext = createBeeGameAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: options.currentUserResolver ?? configuredUserResolver,
    resolveAccessToken: request => resolveValidRequestAccessToken(request, sessionAuth),
  })
  const getRequestAuthToken = authContext.getAccessToken
  const previewCapabilities = createPreviewCapabilityManager()
  const getCurrentUser = authContext.getCurrentUser
  // Resolve async identity before V3 routes and legacy-mode guards use the
  // synchronous request projection. Session refresh routes were registered
  // above; capability-only preview hosts were isolated before every API route.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/internal/resource-semantic-curation' || options.currentUser) {
      await next()
      return
    }
    const user = await authContext.resolveRequestUser(c.req.raw)
    if (!user) return c.json({ error: 'Unauthorized', message: 'authentication required' }, 401)
    await next()
  })
  const getCurrentUserDataRoot = (request?: Request) =>
    getUserDashboardDataRoot(dashboardDataRoot, getCurrentUser(request).id)
  const modelConfigStore = options.modelConfigStore
  if (modelConfigStore !== false && modelConfigStore !== undefined) {
    loadModelConfigsFromStore(modelConfigStore)
  }
  const billingConfig = resolveBeeGameBillingConfig()
  const imageGeneration = new ImageGenerationService(
    new ImageAttemptStore(resolve(dashboardDataRoot, 'image-attempts'),
      createHostedImageGenerationProvider(dashboardDataRoot, ((url, init) => serviceFetch(url, init)) as typeof fetch)),
    createImageBillingClient(billingConfig, (url, init) => serviceFetch(url, init)),
  )
  const proxyBillingRequest = (request: Request, path: string) =>
    proxyAuthenticatedBillingRequest(request, billingConfig, path, sessionAuth)
  const skillsConfig =
    options.skillsConfig === false
      ? null
      : (options.skillsConfig ?? resolveBeeGameSkillsConfig())
  const proxySkillsRequest = skillsConfig
    ? (request: Request, path: string) =>
        proxyAuthenticatedSkillsRequest(
          request,
          skillsConfig,
          path,
          sessionAuth,
        )
    : undefined
  const proxyResourceRequest = options.resourceSelectionRuntimeConfig
    ? (request: Request, path: string) =>
        proxyAuthenticatedResourceRequest(
          request,
          options.resourceSelectionRuntimeConfig!.baseUrl,
          path,
          sessionAuth,
        )
    : undefined
  const projectAssetStorage = createR2ProjectAssetStorageFromEnv()
  const remoteUsageBilling = createRemoteUsageBillingClient(
    billingConfig,
    serviceFetch,
  )
  const dashboardRepository = new DashboardRepository({
    dashboardDataRoot,
    supabaseStore,
    supabaseRuntimeEnvClient,
    remoteUsageBilling,
    skillsConfig: options.skillsConfig,
    getUserDataRoot: getCurrentUserDataRoot,
    getAuthToken: getRequestAuthToken,
    modelConfigStore,
    ...(projectAssetStorage ? { projectAssetStorage } : {}),
  })
  const intakeJobs = new Map<string, BeeGameIntakeJob>()
  const intakeRuntimeId = randomUUID()
  const persistIntakeJobSafely = async (
    dataRoot: string,
    jobId: string,
    job: BeeGameIntakeJob,
  ): Promise<void> => {
    try {
      await saveBeeGameIntakeJob(dataRoot, jobId, job)
    } catch (error) {
      console.warn('[BeeGame] Failed to persist intake job state:', {
        jobId,
        status: job.status,
        cause: toErrorMessage(error),
      })
    }
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
    dashboardRepository.createSessionUsageBillingBackend(),
    Boolean(supabaseRuntimeEnvClient),
  )
  const v3ServiceKey = process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const v3Url = process.env.BEEGAME_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim()
  const v3Store = options.workflowV3Store === false ? undefined : options.workflowV3Store ??
    (supabaseStore && v3ServiceKey && v3Url ? createRemoteWorkflowStore({ url: v3Url, serviceKey: v3ServiceKey, fetchImpl: serviceFetch }) :
      !supabaseStore && process.env.BEEGAME_WORKFLOW_V3_STORE === 'local-single-process' ? createLocalWorkflowStore(dashboardDataRoot) : undefined)
  const previewStorage = createPreviewStorageStore(dashboardDataRoot)
  measuredPreview = createMeasuredPreview({
    origin: options.workflowV3PreviewOrigin ?? process.env.BEEGAME_WORKFLOW_V3_PREVIEW_ORIGIN,
    capabilities: previewCapabilities,
    storage: previewStorage,
    readRun: async (projectId, ownerId) => v3Store?.read(projectId, ownerId),
    readPreviewState: async (projectId, ownerId) => v3Store?.readPreviewState
      ? v3Store.readPreviewState(projectId, ownerId) : v3Store?.read(projectId, ownerId),
    isBusy: run => beeGameSessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath),
  })
  options.registerCleanup?.(async () => { measuredPreview?.dispose(); previewStorage.close() })
  registerV3DebugPage(app, process.env.BEEGAME_WORKFLOW_V3_DEBUG === '1')
  const v3Routes = registerV3Routes(app, {
    deployment:()=>beeGameDeployments,
    persistDeployment:(request,user,record)=>dashboardRepository.upsertDeploymentRecord(request,user,record),
    listDeployments:(request,user,sessionId)=>dashboardRepository.listDeploymentRecords(request,user,sessionId),
    exitReceipts:createHostExitReceipts({dataRoot:dashboardDataRoot,key:getSecretEncryptionKey()}),
    resourceLibraryBaseUrl: options.resourceSelectionRuntimeConfig?.baseUrl,
    // Evaluated only for an authorized production turn, after app setup.
    // Reuse the existing candidate Preview; no Task or engine routing.
    openAgentPreview: value => openProjectPreviewAccess({...value,isolatedProductionProjectId:value.projectId}),
    openAgentImage: value => {
      const personal = loadPersonalImageConnection(getUserDashboardDataRoot(dashboardDataRoot, value.user.id))
      return openImageGenerationAccess({ userId: value.user.id, projectId: value.projectId,
        workspacePath: value.workspacePath, service: imageGeneration, source: personal.source,
        requiredQuality: value.visualHandoffVersion === 1 ? 'low' : undefined,
        screenOrientation: value.screenOrientation,
        loadConfig: personal.source !== 'platform' ? async () => personal.config :
          () => loadRuntimeImageConfig(dashboardDataRoot, { remote: Boolean(supabaseStore), billing: billingConfig },
            (url, init) => serviceFetch(url, init)) })
    },
    preview: measuredPreview,
    store: v3Store, sessions: beeGameSessions, getUser: getCurrentUser,
    getProject: (request, user, projectId) => getOwnedProjectMetadata(request, user, projectId, dashboardRepository),
    getAuthToken: getRequestAuthToken,
    getUserDataRoot: getCurrentUserDataRoot,
    getValidAuthToken: request => {
      const credential = sessionAuth?.getCredential?.(request)
      return credential ? options => credential.getValidAccessToken(options) : undefined
    },
    assertNoLegacyRun: async workspace => {
      const legacyState = join(dashboardDataRoot, 'project-delivery',
        createHash('sha256').update(await realpath(workspace)).digest('hex'), 'state.json')
      try {
        await stat(legacyState)
        throw new Error('Existing legacy delivery must not be silently migrated to V3')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    },
    persistMode: async (request, user, project, run) => {
      if (!supabaseStore) await dashboardRepository.upsertProject(request, user, { ...project, runtime_snapshot: {
        ...project.runtime_snapshot, workflow_protocol: 'bgs.workflow.v3', workflow_chat_session_id: run.chatSessionId } })
    },
    readBody: request => readJson(request, MAX_BEEGAME_REQUEST_BYTES),
    registerCleanup: options.registerCleanup,
  })
  // Route before legacy handlers: rejection must precede file/state/queue mutations.
  app.use('/api/projects/:id/*', async (c, next) => {
    const tail = c.req.path.split('/').slice(4).join('/')
    // The wildcard also matches the project root. Account-scoped deletion is
    // lifecycle cleanup, not legacy scheduling; its handler verifies ownership.
    const isProjectDeletion = c.req.method === 'DELETE' && tail === ''
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !tail.startsWith('workflow-v3') &&
        !isProjectDeletion && tail !== 'session/ensure' && !(c.req.method === 'PUT' && tail === 'game-content/document') && !tail.startsWith('permissions/')) {
      try { await v3Routes.assertLegacy(c.req.param('id')!, getCurrentUser(c.req.raw).id, c.req.raw) }
      catch (error) {
        if (error instanceof WorkflowError) return c.json({ error: error.message, code: error.code }, error.status)
        throw error
      }
    }
    await next()
  })
  app.use('/api/beegame-sessions/:id/*', async (c, next) => {
    if (c.req.method === 'POST' && c.req.path.split('/').at(-1) === 'input') {
      const metadata = beeGameSessions.metadata(c.req.param('id')!)
      if (metadata?.projectId) {
        try { await v3Routes.assertLegacy(metadata.projectId, getCurrentUser(c.req.raw).id, c.req.raw) }
        catch (error) {
          if (error instanceof WorkflowError) return c.json({ error: error.message, code: error.code }, error.status)
          throw error
        }
      }
    }
    await next()
  })
  const beeGamePreviews = new BeeGamePreviewManager(
    options.previewRunner,
    undefined,
    options.previewPortAllocator,
    options.previewReadinessProbe,
    process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL,
    sessionId => {
      const metadata = beeGameSessions.metadata(sessionId)
      if (!metadata) throw new Error('Preview session not found')
      return previewCapabilities.issueRouteId(sessionId, metadata.userId)
    },
  )
  options.registerCleanup?.(async () => {
    beeGamePreviews.dispose()
    await beeGameSessions.dispose()
  })
  const openProjectPreviewAccess = (input: { request: Request; user: BeeGameUserContext; workspacePath: string; sessionId: string; keepProjectPreview?: boolean; isolatedProductionProjectId?: string }) => {
    const { workspacePath, sessionId } = input
    let production: {preview:CandidatePreview;writerId:string}|undefined
    const snapshot = () => {
      if(production)return {status:'running',mode:'production',url:production.preview.url,message:production.preview.limitations.join(' ')}
      const value = beeGamePreviews.status(sessionId, workspacePath)
      return { ...value, ...(value.url ? { url: previewCapabilities.issueUrl(
        new URL(value.url, input.request.url).href, sessionId, input.user.id,
      ) } : {}) }
    }
    const closeProduction=()=>{
      if(production)measuredPreview?.closeCandidate(input.isolatedProductionProjectId!,input.user.id,production.preview.id,production.writerId)
      production=undefined
    }
    const start=async(mode:'development'|'production',restart=false)=>{
      if(mode==='production'&&input.isolatedProductionProjectId) {
        if(restart)closeProduction()
        const run=await v3Store?.read(input.isolatedProductionProjectId,input.user.id)
        if(!run?.writer||run.workspacePath!==workspacePath||run.chatSessionId!==sessionId||!measuredPreview)
          throw new Error('Production Preview no longer belongs to this native project writer')
        beeGamePreviews.stop(sessionId,workspacePath)
        production={preview:await measuredPreview.openCandidate(run,run.writer),writerId:run.writer.attemptId}
      }else {
        closeProduction()
        if(restart)await beeGamePreviews.restart({sessionId,workspacePath,mode})
        else await beeGamePreviews.start({sessionId,workspacePath,mode})
      }
      return snapshot()
    }
    return openPreviewTestAccess({
      recordingRoot: join(getCurrentUserDataRoot(input.request), 'preview-tests', createHash('sha256').update(sessionId).digest('hex')),
      onRecordingFinished: report => appendRuntimeDiagnostic({
        path: join(workspacePath, '.beegame', 'logs', 'native-runtime.jsonl'),
        maxBytes: 4 * 1024 * 1024, archiveCount: 3,
        record: { type: 'preview.recording.finished', sessionId, recordingId: report.id,
          timestamp: report.endedAt, durationMs: report.durationMs, endReason: report.endReason,
          counts: report.counts, files: report.files, droppedEvents: report.droppedEvents,
          truncatedEvents: report.truncatedEvents, gameplayVerdict: report.gameplayVerdict },
      }),
      start: mode => start(mode),
      restart: mode => start(mode,true),
      status: snapshot,
      stop: () => {
        if (input.keepProjectPreview) return
        closeProduction()
        beeGamePreviews.stop(sessionId, workspacePath)
        previewCapabilities.revokeSession(sessionId)
      },
    })
  }
  const beeGameDeployments = new BeeGameDeploymentManager({
    dataRoot: dashboardDataRoot,
    runner: options.deploymentRunner,
    publisher:
      options.deploymentPublisher ??
      createR2DeploymentPublisherFromEnv() ??
      createSupabaseStorageDeploymentPublisherFromEnv(),
    publicBaseUrl: process.env.BEEGAME_DEPLOYMENT_PUBLIC_BASE_URL,
  })
  app.get('/deployments/*', async c => {
    const deployedFile = await beeGameDeployments.readPublicFile(c.req.path)
    if (!deployedFile) {
      return c.text('Not found', 404)
    }
    return new Response(deployedFile.body, {
      headers: {
        'content-type': deployedFile.contentType,
        'cache-control': deployedFile.cacheControl,
      },
    })
  })
  const handlePreviewProxy = async (c: Context) => {
    const routeId = c.req.param('sessionId')
    if (!routeId) return c.text('Preview not found', 404)
    const routeGrant = previewCapabilities.resolveRoute(routeId)
    const sessionId = routeGrant?.sessionId ?? routeId
    const sessionMetadata = beeGameSessions.metadata(sessionId)
    if (!sessionMetadata) return c.text('Preview not found', 404)
    const capability = routeGrant ?? previewCapabilities.verifyRequest(c.req.raw, sessionId)
    // A valid, session-scoped preview grant does not need a second trip to
    // the identity service for each module/image. Keep normal auth for callers
    // without the existing preview grant; never fall back after failed auth.
    const user = options.currentUser ?? (capability
      ? undefined : await authContext.resolveRequestUser(c.req.raw))
    const authenticatedUserId = user?.id ?? capability?.userId
    if (!authenticatedUserId)
      return c.text('Unauthorized', 401)
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
      undefined,
      routeId,
    )
  }
  app.all('/previews/:sessionId', handlePreviewProxy)
  app.all('/previews/:sessionId/*', handlePreviewProxy)

  // Registration needs these two invitation checks before a user session
  // exists. Keeping the routes ahead of the authenticated /api middleware
  // avoids exposing Supabase credentials or RPC transport to the browser.
  app.get('/api/invitations/settings', async c => {
    if (!invitationService) return c.json({ required: false })
    try {
      return c.json(await invitationService.getPublicSettings())
    } catch (error) {
      return invitationRouteError(c, error)
    }
  })

  app.post('/api/invitations/validate', async c => {
    const body = await readJson(c.req.raw)
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code || !invitationService) return c.json({ valid: false })
    try {
      return c.json({ valid: await invitationService.validateCode(code) })
    } catch (error) {
      return invitationRouteError(c, error)
    }
  })

  app.get('/health', c => c.json({ status: 'ok' }))

  app.post('/api/internal/resource-semantic-curation', async c => {
    const serviceToken = options.resourceSelectionRuntimeConfig?.serviceToken
    if (
      !serviceToken ||
      c.req.header('x-beegame-resource-service-token') !== serviceToken
    ) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    try {
      const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
      if (!isObject(body))
        return c.json({ error: 'Invalid semantic curation request' }, 400)
      const ownerId =
        typeof body.ownerId === 'string' ? body.ownerId.trim() : ''
      const modelConfigId =
        typeof body.modelConfigId === 'string' ? body.modelConfigId.trim() : ''
      const modelType = parseResourceSemanticModelType(body.modelType)
      const runtimeEnv = parseResourceSemanticRuntimeEnv(body.runtimeEnv)
      const packId = typeof body.packId === 'string' ? body.packId.trim() : ''
      const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : ''
      const batchId =
        typeof body.batchId === 'string' ? body.batchId.trim() : ''
      const curatorRevision =
        typeof body.curatorRevision === 'string'
          ? body.curatorRevision.trim()
          : ''
      const items = parseResourceSemanticBatchItems(body.items)
      if (
        !ownerId ||
        !modelConfigId ||
        !modelType ||
        !runtimeEnv ||
        !packId ||
        !jobId ||
        !batchId ||
        !curatorRevision ||
        !items.length ||
        items.length > 8
      )
        return c.json(
          {
            error:
              'Resource semantic model identity, batch identity, curator revision, provider, and runtime are required',
          },
          400,
        )
      let visualInput: ResourceSemanticVisualInput
      try {
        visualInput = parseResourceSemanticVisualInput(body.visualInput)
        assertResourceSemanticVisualInput(
          visualInput,
          new Set(items.map(item => item.elementId)),
        )
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Resource semantic visual input is invalid',
          },
          400,
        )
      }
      const visualInputSummary =
        visualInput.mode === 'individual'
          ? {
              mode: visualInput.mode,
              images: visualInput.images.map(image => ({
                elementId: image.elementId,
              })),
            }
          : { mode: visualInput.mode, cells: visualInput.cells }
      const visualImageBlocks =
        visualInput.mode === 'individual'
          ? visualInput.images.map(image => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: image.mediaType,
                data: image.dataBase64,
              },
            }))
          : [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: visualInput.image.mediaType,
                  data: visualInput.image.dataBase64,
                },
              },
            ]
      let modelUsage: BeeGameModelUsage | undefined
      let creditsMicro = 0
      const usageRecorder =
        billingConfig.mode === 'remote'
          ? createUsageRecorder({
              sessionId: jobId,
              record: input =>
                dashboardRepository.recordUsageForUser(ownerId, input),
              debit: input =>
                dashboardRepository.debitRealTimeUsageForUser(ownerId, input),
              onSettled: result => {
                creditsMicro = result.creditsMicro
              },
            })
          : undefined
      const querySource = `beegame_resource_semantic_curation:${jobId}:${batchId}`
      const content = await generateBeeGameModelWithUsage(
        modelRuntimeHost,
        {
          cwd: dashboardDataRoot,
          modelType,
          runtimeEnv,
          systemPrompt:
            buildResourceSemanticCuratorSystemPrompt(curatorRevision),
          structuredOutput: {
            name: RESOURCE_SEMANTIC_MODEL_TOOL_NAME,
            description:
              'Submit the complete canonical semantic decision batch.',
            inputSchema: RESOURCE_SEMANTIC_MODEL_OUTPUT_SCHEMA,
          },
          maxTokens: getResourceSemanticModelOutputTokens(items.length),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    items: items.map(item => ({
                      elementId: item.elementId,
                      projection: item.projection,
                    })),
                    visualInput: visualInputSummary,
                  }),
                },
                ...visualImageBlocks,
              ],
            },
          ],
          querySource,
        },
        async (usage, source) => {
          modelUsage = usage
          if (usageRecorder) await usageRecorder(usage, source)
        },
        billingConfig.mode === 'remote',
      )
      return c.json({
        content,
        ...(modelUsage
          ? {
              usage: {
                inputTokens: modelUsage.input_tokens,
                cacheReadTokens: modelUsage.cache_read_tokens,
                cacheCreationTokens: modelUsage.cache_creation_tokens,
                outputTokens: modelUsage.output_tokens,
                totalTokens: modelUsage.total_tokens,
                creditsMicro,
              },
            }
          : {}),
      })
    } catch (error) {
      return resourceSemanticCurationRouteError(c, error)
    }
  })

  registerBeeGameBillingStoreRoutes(app, {
    billingConfig,
    dashboardRepository,
    proxyRemoteBillingRequest: proxyBillingRequest,
    getCurrentUser,
    hasPermission: (user, permission) =>
      hasBeeGamePermission(user as BeeGameUserContext, permission),
  })

  app.get('/api/current-user', c => {
    const user = options.currentUser ?? authContext.getCurrentUser(c.req.raw)
    if (!user) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'authentication required',
        },
        401,
      )
    }
    return c.json({
      id: user.id,
      role: user.role,
      ...(user.workspaceId ? { workspaceId: user.workspaceId } : {}),
      ...(user.workspaceOwnerId
        ? { workspaceOwnerId: user.workspaceOwnerId }
        : {}),
      ...(user.modelConfigOwnerId
        ? { modelConfigOwnerId: user.modelConfigOwnerId }
        : {}),
      ...(user.email ? { email: user.email } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      permissions: listBeeGamePermissions(user),
    })
  })

  const resolveInvitationAdmin = async (request: Request) => {
    const forbidden = requirePermission(
      getCurrentUser(request),
      ROUTE_PERMISSION.invitations,
    )
    if (forbidden) return { forbidden }
    if (!invitationService) {
      return {
        unavailable: {
          error: 'Invitation service unavailable',
          message: 'Invitation settings are not configured',
        },
      }
    }
    const accessToken = await resolveValidRequestAccessToken(
      request,
      sessionAuth,
    )
    if (!accessToken) return { unauthorized: true }
    return { accessToken, invitationService }
  }

  app.get('/api/admin/invitations', async c => {
    const resolved = await resolveInvitationAdmin(c.req.raw)
    if ('forbidden' in resolved) return c.json(resolved.forbidden, 403)
    if ('unavailable' in resolved) return c.json(resolved.unavailable, 503)
    if ('unauthorized' in resolved)
      return c.json(
        { error: 'Unauthorized', message: 'authentication required' },
        401,
      )
    try {
      return c.json(await resolved.invitationService.list(resolved.accessToken))
    } catch (error) {
      return invitationRouteError(c, error)
    }
  })

  app.put('/api/admin/invitations/settings', async c => {
    const resolved = await resolveInvitationAdmin(c.req.raw)
    if ('forbidden' in resolved) return c.json(resolved.forbidden, 403)
    if ('unavailable' in resolved) return c.json(resolved.unavailable, 503)
    if ('unauthorized' in resolved)
      return c.json(
        { error: 'Unauthorized', message: 'authentication required' },
        401,
      )
    const body = await readJson(c.req.raw)
    if (typeof body.required !== 'boolean') {
      return c.json({ error: 'required must be a boolean' }, 400)
    }
    try {
      return c.json(
        await resolved.invitationService.saveSettings(
          resolved.accessToken,
          body.required,
        ),
      )
    } catch (error) {
      return invitationRouteError(c, error)
    }
  })

  app.post('/api/admin/invitations', async c => {
    const resolved = await resolveInvitationAdmin(c.req.raw)
    if ('forbidden' in resolved) return c.json(resolved.forbidden, 403)
    if ('unavailable' in resolved) return c.json(resolved.unavailable, 503)
    if ('unauthorized' in resolved)
      return c.json(
        { error: 'Unauthorized', message: 'authentication required' },
        401,
      )
    const body = await readJson(c.req.raw)
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code) return c.json({ error: 'Invitation code is required' }, 400)
    if (
      body.maxUses !== undefined &&
      body.maxUses !== null &&
      (!Number.isInteger(body.maxUses) || Number(body.maxUses) < 1)
    ) {
      return c.json({ error: 'maxUses must be a positive integer' }, 400)
    }
    try {
      return c.json(
        await resolved.invitationService.create(resolved.accessToken, {
          code,
          ...(typeof body.label === 'string' ? { label: body.label } : {}),
          ...(body.maxUses === null || typeof body.maxUses === 'number'
            ? { maxUses: body.maxUses }
            : {}),
        }),
        201,
      )
    } catch (error) {
      return invitationRouteError(c, error)
    }
  })

  app.patch('/api/admin/invitations/:id', async c => {
    const resolved = await resolveInvitationAdmin(c.req.raw)
    if ('forbidden' in resolved) return c.json(resolved.forbidden, 403)
    if ('unavailable' in resolved) return c.json(resolved.unavailable, 503)
    if ('unauthorized' in resolved)
      return c.json(
        { error: 'Unauthorized', message: 'authentication required' },
        401,
      )
    const body = await readJson(c.req.raw)
    try {
      return c.json(
        await resolved.invitationService.update(resolved.accessToken, {
          id: c.req.param('id'),
          ...(typeof body.enabled === 'boolean'
            ? { enabled: body.enabled }
            : {}),
          ...(typeof body.label === 'string' ? { label: body.label } : {}),
          ...(body.maxUses === null || typeof body.maxUses === 'number'
            ? { maxUses: body.maxUses }
            : {}),
          ...(body.clearMaxUses === true ? { clearMaxUses: true } : {}),
        }),
      )
    } catch (error) {
      return invitationRouteError(c, error)
    }
  })

  app.delete('/api/admin/invitations/:id', async c => {
    const resolved = await resolveInvitationAdmin(c.req.raw)
    if ('forbidden' in resolved) return c.json(resolved.forbidden, 403)
    if ('unavailable' in resolved) return c.json(resolved.unavailable, 503)
    if ('unauthorized' in resolved)
      return c.json(
        { error: 'Unauthorized', message: 'authentication required' },
        401,
      )
    try {
      return c.json({
        deleted: await resolved.invitationService.delete(
          resolved.accessToken,
          c.req.param('id'),
        ),
      })
    } catch (error) {
      return invitationRouteError(c, error)
    }
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
      return c.json(
        await dashboardRepository.getProjectLifecycleOverview(c.req.raw, user),
      )
    } catch (error) {
      return tracedRouteError(c, 'admin.projects.lifecycle', error)
    }
  })

  app.get('/api/admin/projects/retention/plan', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.lifecycleAdmin)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return c.json(
        toProjectRetentionResponse(
          await beeGameDeployments.applyRetention({ dryRun: true }),
        ),
      )
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

  app.get('/api/usage/events', async c => {
    return proxyBillingRequest(
      c.req.raw,
      `/api/usage/events${new URL(c.req.url).search}`,
    )
  })

  app.get('/api/usage/summary', async c => {
    return proxyBillingRequest(
      c.req.raw,
      `/api/usage/summary${new URL(c.req.url).search}`,
    )
  })

  app.get('/api/usage-wallet', async c => {
    return proxyBillingRequest(c.req.raw, '/api/usage-wallet')
  })

  registerModelConnectionRoutes(app, {
    repository: dashboardRepository, getUser: getCurrentUser, getRoot: getCurrentUserDataRoot,
    changed: ownerId => { beeGameSessions.refreshIdleRunners(ownerId) }, registerCleanup: options.registerCleanup,
    isBusy: ownerId => beeGameSessions.list(ownerId).some(session => session.turnStatus !== 'idle'),
    assertPermittedUrl: assertPermittedOutboundUrl,
  })

  app.get('/api/model-configs', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      ROUTE_PERMISSION.modelConfig,
    )
    if (forbidden) return c.json(forbidden, 403)
    return c.json(
      await dashboardRepository.listModelConfigs(
        c.req.raw,
        getCurrentUser(c.req.raw),
        true,
      ),
    )
  })

  app.post('/api/model-configs', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.modelConfig)
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['name', 'provider', 'models'])
    if (error) return c.json({ error }, 400)
    let authMethods
    try { authMethods = validateModelAccess(body.provider as ModelProviderKind, body.authMethods) }
    catch { return c.json({ error: 'Invalid provider or authentication methods' }, 400) }

    if (authMethods.includes('platform') && (typeof body.apiKey !== 'string' || !body.apiKey.trim())) return c.json({ error: 'Platform access requires an API key' }, 400)
    const outboundInspection = await inspectPermittedOutboundUrl(body.baseUrl)
    if (outboundInspection && !outboundInspection.approved) {
      return c.json(toOutboundTargetError(outboundInspection), 400)
    }
    try {
      await validateDynamicGoConfig({ provider: String(body.provider), baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        models: toModelMap(body.models), authMethods }, assertPermittedOutboundUrl)
    } catch (error) { return c.json({ error: toErrorMessage(error) }, 400) }

    const created = await dashboardRepository.createModelConfig(
      c.req.raw,
      user,
      {
        name: String(body.name),
        provider: body.provider as ModelProviderKind,
        ...(typeof body.baseUrl === 'string' && body.baseUrl
          ? { baseUrl: body.baseUrl }
          : {}),
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
        authMethods,
        published: body.published !== false,
        models: toModelMap(body.models),
        isDefault: body.isDefault === true,
      },
    )
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
    beeGameSessions.refreshIdleRunners()
    return c.json(created)
  })

  app.patch('/api/model-configs/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.modelConfig)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const body = await readJson(c.req.raw)
      const existing = (await dashboardRepository.listModelConfigs(c.req.raw, user, true)).find(config => config.id === c.req.param('id'))
      if (!existing) return c.json({ error: 'Model config not found' }, 404)
      let authMethods
      try { authMethods = validateModelAccess((body.provider ?? existing.provider) as ModelProviderKind, body.authMethods ?? existing.authMethods) }
      catch { return c.json({ error: 'Invalid provider or authentication methods' }, 400) }

      const outboundInspection = await inspectPermittedOutboundUrl(body.baseUrl)
      if (outboundInspection && !outboundInspection.approved) {
        return c.json(toOutboundTargetError(outboundInspection), 400)
      }
      try {
        await validateDynamicGoConfig({ provider: String(body.provider ?? existing.provider), baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : existing.baseUrl,
          models: isObject(body.models) ? toModelMap(body.models) : existing.models, authMethods }, assertPermittedOutboundUrl)
      } catch (error) { return c.json({ error: toErrorMessage(error) }, 400) }
      const updated = await dashboardRepository.updateModelConfig(
        c.req.raw,
        user,
        c.req.param('id'),
        {
          authMethods,
          ...(typeof body.published === 'boolean' ? { published: body.published } : {}),
          ...(typeof body.name === 'string' ? { name: body.name } : {}),
          ...(typeof body.provider === 'string'
            ? { provider: body.provider as ModelProviderKind }
            : {}),
          ...(typeof body.baseUrl === 'string'
            ? { baseUrl: body.baseUrl }
            : {}),
          ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
          ...(body.clearSecret === true ? { clearSecret: true } : {}),
          ...(isObject(body.models) ? { models: toModelMap(body.models) } : {}),
          ...(typeof body.isDefault === 'boolean'
            ? { isDefault: body.isDefault }
            : {}),
        },
      )
      if (!updated) return c.json({ error: 'Model config not found' }, 404)
      beeGameSessions.refreshIdleRunners()

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
    if (
      !(await hasPermittedOutboundUrl(body.tavilyEndpointUrl)) ||
      !(await hasPermittedOutboundUrl(body.exaEndpointUrl))
    ) {
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
    return c.json(
      await dashboardRepository.loadRuntimeSettings(c.req.raw, user),
    )
  })

  app.get('/api/image-generation/settings', async c => {
    const user = getCurrentUser(c.req.raw)
    if (user.role !== 'owner' || requirePermission(user, ROUTE_PERMISSION.modelConfig))
      return c.json({ error: 'Platform administrator required' }, 403)
    const provider = imageProviderSchema.optional().safeParse(c.req.query('provider'))
    if (!provider.success) return c.json({ error: 'Invalid image provider' }, 400)
    try {
      const config = await dashboardRepository.loadImageGenerationConfig(c.req.raw, provider.data)
      return c.json({ ...publicImageConfig(config), ...(config.provider === 'chatgpt-subscription' ? {
        subscriptionConnected: hasChatGPTAccount(getCurrentUserDataRoot(c.req.raw)),
      } : {}) })
    } catch {
      return c.json({ error: 'Image settings could not be loaded; check storage and migration configuration' }, 503)
    }
  })

  app.get('/api/image-generation/connection', c => {
    c.header('Cache-Control', 'no-store')
    try {
      return c.json(publicPersonalImageConnection(loadPersonalImageConnection(getCurrentUserDataRoot(c.req.raw))))
    } catch { return c.json({ error: 'Personal image connection could not be loaded' }, 503) }
  })

  app.put('/api/image-generation/connection', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const body = await readJson(c.req.raw)
      if (body?.source === 'byok') {
        const previous = loadPersonalImageConnection(getCurrentUserDataRoot(c.req.raw))
        const url = typeof body.baseUrl === 'string' ? body.baseUrl : previous.config.baseUrl
        await assertPermittedOutboundUrl(url)
      }
      return c.json(savePersonalImageConnection(getCurrentUserDataRoot(c.req.raw), body))
    } catch { return c.json({ error: 'Personal image connection could not be saved; check provider, HTTPS endpoint, model and key' }, 400) }
  })

  app.put('/api/image-generation/settings', async c => {
    const user = getCurrentUser(c.req.raw)
    if (user.role !== 'owner' || requirePermission(user, ROUTE_PERMISSION.modelConfig))
      return c.json({ error: 'Platform administrator required' }, 403)
    const body = await readJson(c.req.raw)
    const parsed = imageConfigPatchSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: 'Invalid image provider settings' }, 400)
    try {
      let patch = parsed.data
      const previous = await dashboardRepository.loadImageGenerationConfig(c.req.raw, patch.provider)
      if ((patch.provider ?? previous.provider) === 'chatgpt-subscription') {
        // Saving explicitly designates the current administrator, never a caller-supplied user ID.
        const config = updateImageConfig(previous, { ...patch, subscriptionOwnerId: user.id })
        if (config.baseUrl !== CHATGPT_IMAGE_ENDPOINT || !config.responseModel || config.apiKey || config.upstreamApiKey ||
            !hasChatGPTAccount(getCurrentUserDataRoot(c.req.raw)))
          return c.json({ error: 'Connect your ChatGPT account first; use the fixed endpoint and explicit models without API keys' }, 400)
        patch = { ...patch, subscriptionOwnerId: user.id }
      }
      const saved = await dashboardRepository.saveImageGenerationConfig(c.req.raw, patch)
      await dashboardRepository.appendAuditEvent(c.req.raw, user, {
        actorId: user.id, action: 'image_generation.settings.updated',
        targetType: 'image_generation', targetId: 'platform',
        metadata: { provider: saved.provider, model: saved.model, keyChanged: 'apiKey' in parsed.data, upstreamKeyChanged: 'upstreamApiKey' in parsed.data },
      })
      return c.json({ ...publicImageConfig(saved), ...(saved.provider === 'chatgpt-subscription' ? { subscriptionConnected: true } : {}) })
    } catch {
      return c.json({ error: 'Image settings could not be saved; check secret encryption and storage configuration' }, 503)
    }
  })

  app.put('/api/runtime-settings', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.runtimeSettings)
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const input = {
      ...Object.fromEntries(
        ['verificationAgentEnabled', 'agentTeamsEnabled', 'promptSuggestionEnabled',
          'awaySummaryEnabled', 'coordinatorModeEnabled']
          .filter(key => typeof body[key] === 'boolean')
          .map(key => [key, body[key]]),
      ),
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
      ...(typeof body.resourceLibraryEnabled === 'boolean'
        ? { resourceLibraryEnabled: body.resourceLibraryEnabled }
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
    const refreshedIdleRunners = beeGameSessions.refreshIdleRunners()
    await dashboardRepository.appendAuditEvent(c.req.raw, user, {
      actorId: user.id,
      action: 'runtime_settings.updated',
      targetType: 'runtime_settings',
      targetId: user.id,
      metadata: { ...saved, refreshedIdleRunners },
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
    // Host configuration files are not user-scoped, unlike saved MCP entries.
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'workspace.manage')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(
      await discoverMcpServers({
        dataDir: getCurrentUserDataRoot(c.req.raw),
        existingServers: await dashboardRepository.listMcpServers(c.req.raw, user),
        outboundTargetPolicyOptions,
        outboundTargetResolver: resolveOutboundTarget,
      }),
    )
  })

  app.get('/api/mcp-servers/discover-active', async c => {
    // Loopback discovery probes the server host, not the caller's device.
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'workspace.manage')
    if (forbidden) return c.json(forbidden, 403)
    const user = getCurrentUser(c.req.raw)
    const servers = await dashboardRepository.listMcpServers(c.req.raw, user)
    return c.json(
      await discoverActiveMcpServers(servers, {
        ports: parsePortList(c.req.query('ports')),
        outboundTargetPolicyOptions,
        resolveOutboundTarget,
      }),
    )
  })

  app.post('/api/mcp-servers/test', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    // A dashboard stdio test starts a process on the host, unlike owner-scoped
    // configuration storage and sandboxed project execution.
    if (body.transport === 'stdio' || body.transport === undefined) {
      const hostForbidden = requirePermission(getCurrentUser(c.req.raw), 'workspace.manage')
      if (hostForbidden) return c.json(hostForbidden, 403)
    }
    const error = await validateMcpServerBody(body, hasPermittedOutboundUrl)
    if (error) return c.json({ error }, 400)
    return c.json(
      await testMcpServerConnection(toMcpServerInput(body), {
        outboundTargetPolicyOptions,
        resolveOutboundTarget,
      }),
    )
  })

  app.post('/api/mcp-servers', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    let input = body
    if (body.sourcePath !== undefined) {
      const hostForbidden = requirePermission(getCurrentUser(c.req.raw), 'workspace.manage')
      if (hostForbidden) return c.json(hostForbidden, 403)
      if (typeof body.sourcePath !== 'string' || typeof body.name !== 'string') {
        return c.json({ error: 'MCP discovery source and name are required' }, 400)
      }
      const discovered = readDiscoveredMcpServerInput(body.sourcePath, body.name, {
        dataDir: getCurrentUserDataRoot(c.req.raw),
      })
      if (!discovered) return c.json({ error: 'Discovered MCP configuration not found; discover again' }, 404)
      input = discovered
    }
    const error = await validateMcpServerBody(input, hasPermittedOutboundUrl)
    if (error) return c.json({ error }, 400)
    const user = getCurrentUser(c.req.raw)
    const saved = await dashboardRepository.upsertMcpServer(
      c.req.raw,
      user,
      { ...toMcpServerInput(input), id: undefined },
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
    const ownedServers = await dashboardRepository.listMcpServers(c.req.raw, user)
    if (!ownedServers.some(server => server.id === c.req.param('id'))) {
      return c.json({ error: 'MCP server not found' }, 404)
    }
    const saved = await dashboardRepository.upsertMcpServer(c.req.raw, user, {
      ...toMcpServerInput(body),
      id: c.req.param('id'),
    })
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
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      ROUTE_PERMISSION.userSkills,
    )
    if (forbidden) return c.json(forbidden, 403)
    if (!proxySkillsRequest)
      return c.json({ error: 'User skills are disabled' }, 503)
    try {
      return await proxySkillsRequest(c.req.raw, '/api/user-skills')
    } catch (error) {
      return tracedRouteError(c, 'user-skills.list', error)
    }
  })

  app.post('/api/user-skills/import', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      ROUTE_PERMISSION.userSkills,
    )
    if (forbidden) return c.json(forbidden, 403)
    if (!proxySkillsRequest)
      return c.json({ error: 'User skills are disabled' }, 503)
    try {
      return await proxySkillsRequest(c.req.raw, '/api/user-skills/import')
    } catch (err) {
      const traceId = randomUUID()
      console.warn('[BeeGame] skill import proxy failed', {
        traceId,
        reason:
          err instanceof RequestBodyLimitError
            ? 'request_too_large'
            : 'upstream_unavailable',
      })
      return new Response(
        JSON.stringify({ error: 'Skill import failed', traceId }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
  })

  app.put('/api/user-skills/:id/enabled', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      ROUTE_PERMISSION.userSkills,
    )
    if (forbidden) return c.json(forbidden, 403)
    if (!proxySkillsRequest)
      return c.json({ error: 'User skills are disabled' }, 503)
    try {
      return await proxySkillsRequest(
        c.req.raw,
        `/api/user-skills/${encodeURIComponent(c.req.param('id'))}/enabled`,
      )
    } catch (error) {
      return tracedRouteError(c, 'user-skills.enable', error)
    }
  })

  app.delete('/api/user-skills/:id', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      ROUTE_PERMISSION.userSkills,
    )
    if (forbidden) return c.json(forbidden, 403)
    if (!proxySkillsRequest)
      return c.json({ error: 'User skills are disabled' }, 503)
    try {
      return await proxySkillsRequest(
        c.req.raw,
        `/api/user-skills/${encodeURIComponent(c.req.param('id'))}`,
      )
    } catch (error) {
      return tracedRouteError(c, 'user-skills.delete', error)
    }
  })

  app.get('/api/filesystem/directories', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      'workspace.manage',
    )
    if (forbidden) return c.json(forbidden, 403)
    try {
      return c.json(await listDirectories(c.req.query('path')))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get('/api/filesystem/default-workspace', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      'workspace.read',
    )
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

  app.get('/api/projects/page', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const offset = Number(c.req.query('offset') ?? 0)
    const limit = Number(c.req.query('limit') ?? 20)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      return c.json({ error: 'Invalid project page' }, 400)
    }
    return c.json(await dashboardRepository.listProjectsPage(
      c.req.raw, user, offset, limit, c.req.query('search')?.trim() ?? '',
    ))
  })

  app.get('/api/projects/:id/metadata', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const project = await dashboardRepository.getProject(c.req.raw, user, c.req.param('id'))
    return project ? c.json(project) : c.json({ error: 'Project not found' }, 404)
  })

  app.get('/api/resource-packs/:packId/impact', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const packId = c.req.param('packId')
    try {
      const projects = await dashboardRepository.listProjects(c.req.raw, user)
      const impacts: Array<{
        projectId: string
        projectName: string
        resourceId: string
        packVersion: string
        elementId: string
        status?: string
      }> = []
      const unreadableProjects: Array<{
        projectId: string
        projectName: string
        reason: string
      }> = []
      for (const project of projects) {
        if (!project.root_path) continue
        let manifest: Awaited<ReturnType<typeof readBeeGameAssetManifest>>
        try {
          const workspacePath = await resolveSessionWorkspacePath(
            project.root_path,
            options.defaultWorkspacePath,
          )
          manifest = await readBeeGameAssetManifest(workspacePath)
        } catch (error) {
          unreadableProjects.push({
            projectId: project.id,
            projectName: project.name,
            reason: toErrorMessage(error),
          })
          continue
        }
        for (const resource of manifest.resources) {
          if (
            resource.source.type !== 'resource-library' ||
            resource.source.pack_id !== packId
          )
            continue
          impacts.push({
            projectId: project.id,
            projectName: project.name,
            resourceId: resource.id,
            packVersion: resource.source.pack_version,
            elementId: resource.source.element_id,
            status: resource.status,
          })
        }
      }
      return c.json({
        packId,
        references: impacts,
        projectCount: new Set(impacts.map(item => item.projectId)).size,
        unreadableProjects,
      })
    } catch (err) {
      return tracedRouteError(c, 'resource-pack.impact', err)
    }
  })

  const handleResourceLibraryProxy = async (c: Context) => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      ROUTE_PERMISSION.resourceLibrary,
    )
    if (forbidden) return c.json(forbidden, 403)
    if (!proxyResourceRequest) {
      return c.json(
        {
          error: {
            code: 'resource_service_unavailable',
            message: 'Resource service is unavailable',
          },
        },
        503,
      )
    }
    const url = new URL(c.req.url)
    return proxyResourceRequest(c.req.raw, `${url.pathname}${url.search}`)
  }
  app.all('/api/resource-packs', handleResourceLibraryProxy)
  app.all('/api/resource-packs/*', handleResourceLibraryProxy)

  app.post('/api/projects', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      'project.create',
    )
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['id', 'name', 'created_at'])
    if (error) return c.json({ error }, 400)
    try {
      const user = getCurrentUser(c.req.raw)
      await v3Routes.assertLegacy(String(body.id), user.id, c.req.raw)
      return c.json(
        await dashboardRepository.upsertProject(
          c.req.raw,
          user,
          toProjectMetadata(body),
        ),
      )
    } catch (err) {
      if (err instanceof ProjectQuotaExceededError) {
        return c.json(
          {
            error: err.message,
            code: 'PROJECT_QUOTA_EXCEEDED',
            limit: err.limit,
            projectCount: err.projectCount,
          },
          429,
        )
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
    if (!v3Store) return c.json({ error: 'V3 workflow storage is not configured', code: 'workflow-unavailable' }, 503)

    const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
    const projectBody = isObject(body.project) ? body.project : {}
    const brief = isObject(body.brief) ? body.brief : {}
    const projectId =
      typeof projectBody.id === 'string' ? projectBody.id.trim() : ''
    const projectName =
      typeof projectBody.name === 'string' ? projectBody.name.trim() : ''
    const projectFolderName =
      typeof body.projectName === 'string' ? body.projectName.trim() : ''
    const createdAt = Number(projectBody.created_at)
    const idea = typeof brief.idea === 'string' ? brief.idea.trim() : ''
    if (!projectId || !projectName || !Number.isFinite(createdAt) || !idea) {
      return c.json({ error: 'Invalid project bootstrap payload' }, 400)
    }

    try {
      await v3Routes.assertLegacy(projectId, user.id, c.req.raw)
      const referenceAttachments = brief.attachments === undefined || (Array.isArray(brief.attachments) && !brief.attachments.length)
        ? [] : validateBeeGameAttachments(brief.attachments)
      if (brief.creationMode !== undefined && brief.creationMode !== 'creative' && brief.creationMode !== 'blueprint')
        return c.json({ error: 'Invalid creation mode' }, 400)
      try { resolveConfirmedOrientation(brief) }
      catch (error) { return c.json({ error: toErrorMessage(error) }, 400) }
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
          (request, requestUser, id) =>
            dashboardRepository.modelConfigExists(request, requestUser, id),
          (request, requestUser) =>
            dashboardRepository.listModelConfigs(request, requestUser),
        ),
      ])
      if (modelConfigId) await assertPermittedModelConfigRuntime(modelConfigId)
      const referenceFiles = await materializeBeeGameAttachments(workspacePath, referenceAttachments)
      const references = referenceFiles.map((file, index) => ({
        ...file,
        sha256: createHash('sha256').update(Buffer.from(referenceAttachments[index]!.data, 'base64')).digest('hex'),
      }))

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
      const language = isBeeGameSessionLanguage(languageValue)
        ? languageValue
        : undefined
      const session = beeGameSessions.start({
        workspacePath,
        projectId,
        ...(modelConfigId ? { modelConfigId } : {}),
        ...(language ? { language } : {}),
        userId: user.id,
        ...(getRequestAuthToken(c.req.raw)
          ? { authToken: getRequestAuthToken(c.req.raw) }
          : {}),
        userDataRoot: getCurrentUserDataRoot(c.req.raw),
      })
      await dashboardRepository.upsertSessionMetadata(
        c.req.raw,
        user,
        beeGameSessions.metadata(session.id),
      )

      // Only server-created references enter the brief, never caller-supplied paths.
      const confirmedBriefPrompt = buildConfirmedBriefPrompt({ ...brief, referenceFiles: references }, language)
      const confirmedBriefContext = extractConfirmedBriefContext(confirmedBriefPrompt)
      await v3Routes.startAgentGoal(c.req.raw, projectId, {
        requestKey: projectId,
        chatSessionId: session.id,
        brief: JSON.parse(confirmedBriefContext),
      })

      return c.json(
        {
          project,
          session: beeGameSessions.get(session.id) ?? session,
          binding: createProjectSessionBinding(
            projectId,
            session.id,
            workspacePath,
            language,
          ),
          task_id: session.id,
          status: 'starting',
        },
        202,
      )
    } catch (err) {
      if (err instanceof WorkflowError) return c.json({ error: err.message, code: err.code }, err.status)
      if (err instanceof BeeGameUploadPolicyError) return uploadPolicyResponse(err)
      if (err instanceof ProjectQuotaExceededError) {
        return c.json(
          {
            error: err.message,
            code: 'PROJECT_QUOTA_EXCEEDED',
            limit: err.limit,
            projectCount: err.projectCount,
          },
          429,
        )
      }
      return tracedRouteError(c, 'project.bootstrap', err)
    }
  })

  app.patch('/api/projects/:id', async c => {
    const forbidden = requirePermission(
      getCurrentUser(c.req.raw),
      'project.create',
    )
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const user = getCurrentUser(c.req.raw)
    const existing = await dashboardRepository.getProject(c.req.raw, user, c.req.param('id'))
    if (!existing) return c.json({ error: 'Project not found' }, 404)
    try {
      const nextProject = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
      }
      return c.json(
        await dashboardRepository.upsertProject(c.req.raw, user, nextProject),
      )
    } catch (err) {
      return tracedRouteError(c, 'project.update', err)
    }
  })

  app.get('/api/projects/:id/events', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
      if (sessionRef.live) {
        beeGameSessions.updateAuthToken(
          sessionRef.sessionId,
          getRequestAuthToken(c.req.raw),
        )
      }
      const after = parsePositiveInteger(c.req.query('after')) ?? 0
      const events = await getProjectChatTimelineEvents({
        after,
        sessionId: sessionRef.sessionId,
        workspacePath: sessionRef.workspacePath,
        dashboardDataRoot,
        beeGameSessions,
      })
      return c.json({
        sessionId: sessionRef.sessionId,
        workspacePath: sessionRef.workspacePath,
        events: events.filter(event => event.id > after),
        recoveredFromTranscript: !sessionRef.live,
      })
    } catch (err) {
      return tracedRouteError(c, 'project.events', err, 404)
    }
  })

  app.get('/api/projects/:id/events/stream', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
      if (sessionRef.live) {
        beeGameSessions.updateAuthToken(
          sessionRef.sessionId,
          getRequestAuthToken(c.req.raw),
        )
      }

      const queryAfter = parsePositiveInteger(c.req.query('after')) ?? 0
      const headerAfter = parsePositiveInteger(c.req.header('last-event-id'))
      const after = headerAfter ?? queryAfter
      const stream = createProjectEventsSseStream({
        request: c.req.raw,
        userId: user.id,
        projectId: project.id,
        sessionId: sessionRef.sessionId,
        workspacePath: sessionRef.workspacePath,
        after,
        recoveredFromTranscript: !sessionRef.live,
        dashboardDataRoot,
        beeGameSessions,
      })
      return new Response(stream, {
        headers: {
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'content-type': 'text/event-stream; charset=utf-8',
          'x-accel-buffering': 'no',
        },
      })
    } catch (err) {
      return tracedRouteError(c, 'project.events.stream', err, 404)
    }
  })

  app.get('/api/projects/:id/transcript', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
      const timeline = await getProjectChatTimelineEvents({
        sessionId: sessionRef.sessionId,
        workspacePath: sessionRef.workspacePath,
        dashboardDataRoot,
        beeGameSessions,
      })
      const visibleEvents = compactTranscriptForChatHistory(liveProjectConversationEvents(timeline))
      const todoEvents = findTodoWriteEvents(visibleEvents)
      const pagination = {
        limit: parseTranscriptPageLimit(c.req.query('limit')),
        beforeId: parsePositiveInteger(c.req.query('before')),
      }
      return c.json({
        sessionId: sessionRef.sessionId,
        workspacePath: sessionRef.workspacePath,
        todoEvents,
        ...paginateTranscriptEvents(visibleEvents, pagination),
      })
    } catch (err) {
      return tracedRouteError(c, 'project.transcript', err, 404)
    }
  })

  app.get('/api/projects/:id/artifacts', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'Missing query: path' }, 400)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const artifactRef = await resolveBeeGameProjectArtifactReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!artifactRef) return c.json({ error: 'Project workspace not found' }, 404)
      return c.json(await readProjectArtifactConsistently(
        artifactRef.workspacePath,
        () => readBeeGameProjectArtifact(artifactRef.workspacePath, path),
      ))
    } catch (err) {
      const message = toErrorMessage(err)
      return tracedRouteError(
        c,
        'project.artifacts',
        err,
        message === 'Artifact path must stay inside the session workspace'
          ? 400
          : 404,
      )
    }
  })

  app.get('/api/projects/:id/artifact-index', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const artifactRef = await resolveBeeGameProjectArtifactReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!artifactRef) return c.json({ error: 'Project workspace not found' }, 404)
      return c.json({
        ...(artifactRef.sessionId ? { sessionId: artifactRef.sessionId } : {}),
        workspacePath: artifactRef.workspacePath,
        artifacts: await readProjectArtifactConsistently(
          artifactRef.workspacePath,
          () => discoverBeeGameProjectArtifacts(artifactRef.workspacePath),
        ),
      })
    } catch (err) {
      return tracedRouteError(c, 'project.artifact-index', err, 404)
    }
  })

  app.get('/api/projects/:id/package', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.projectExport)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const artifactRef = await resolveBeeGameProjectArtifactReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!artifactRef) return c.json({ error: 'Project workspace not found' }, 404)
      const projectPackage = await readProjectArtifactConsistently(
        artifactRef.workspacePath,
        () => beeGameSessions.createProjectPackage(
          artifactRef.sessionId,
          artifactRef.workspacePath,
          artifactRef.expectedIdentity,
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
      return tracedRouteError(c, 'project.package', err, 404)
    }
  })

  app.post('/api/projects/:id/session/ensure', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const projectId = c.req.param('id')
    const body = await readOptionalJson(c.req.raw)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        projectId,
        dashboardRepository,
      )
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
        authToken: getRequestAuthToken(c.req.raw),
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
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        projectId,
        dashboardRepository,
      )
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
      const run = await v3Store?.read(projectId, user.id)
      state.execution_time = run?.workspacePath === project.root_path
        ? projectExecutionTime(run, beeGameSessions.hasActiveProjectTurn(user.id, projectId, run.workspacePath)) ?? null
        : null
      const candidatePreview = (await measuredPreview?.candidateStatus(projectId, user.id))?.preview
      const activeV3Preview = candidatePreview ?? (await measuredPreview?.status(projectId, user.id))?.preview
      if (activeV3Preview) {
        state.build_report = {
          status: 'passed', entrypoint: 'index.html', report_path: '', build_url: activeV3Preview.url,
          agents: [candidatePreview ? 'candidate-preview' : 'measured-preview'], generated_paths: [],
          checks: [{ name: candidatePreview ? 'existing-static-build' : 'measured-build', status: 'passed',
            detail: candidatePreview ? 'Serving the opened existing static build' : 'Serving the selected measured artifact', path: '' }],
          summary: candidatePreview ? candidatePreview.limitations.join(' ') : 'Measured build Preview is available; game quality remains unverified.',
          failure_reason: '', created_at: new Date().toISOString(),
        }
      }
      c.header('Cache-Control', 'no-store')
      return c.json(state)
    } catch (err) {
      return tracedRouteError(c, 'project.runtime-state', err)
    }
  })

  app.get('/api/projects/:id/game-content', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const v3Content = await v3Routes.contentView(c.req.raw, c.req.param('id'), c.req.query('metadata') === '1')
      if (!v3Content)
        return c.json({ error: 'Content editing requires a V3 project Run.', code: 'workflow-v3-required' }, 409)
      c.header('Cache-Control', 'private, no-store')
      return c.json(v3Content)
    } catch (err) {
      if (err instanceof WorkflowError) return c.json({ error: err.message, code: err.code }, err.status)
      return c.json({ error: toErrorMessage(err) }, 409)
    }
  })

  app.put('/api/projects/:id/game-content/document', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const rawBody = await readJson(c.req.raw)
      const v3Saved = await v3Routes.saveContent(c.req.raw, c.req.param('id'), rawBody)
      if (!v3Saved)
        return c.json({ error: 'Content editing requires a V3 project Run.', code: 'workflow-v3-required' }, 409)
      c.header('Cache-Control', 'no-store')
      return c.json(v3Saved)
    } catch (err) {
      if (err instanceof WorkflowError) return c.json({ error: err.message, code: err.code }, err.status)
      return c.json({ error: toErrorMessage(err) }, 409)
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
      return c.json(
        {
          error:
            'Persistent runtime permissions are not available through the Web API',
        },
        400,
      )
    }
    const permissionScope = body.scope === 'session' ? 'session' : 'once'
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        projectId,
        dashboardRepository,
      )
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
      const permissionSessionId = beeGameSessions.pendingPermissionsForProject(user.id, projectId, sessionRef.workspacePath)
        .find(permission => permission.toolUseID === c.req.param('toolUseID'))?.sessionId ?? sessionRef.sessionId
      try {
        resolved = beeGameSessions.resolvePermission(
          permissionSessionId,
          c.req.param('toolUseID'),
          {
            behavior: decision,
            scope: permissionScope,
            remember: false,
            answers: body.answers,
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
          targetId: permissionSessionId,
          metadata: {
            projectId,
            toolUseID: c.req.param('toolUseID'),
            decision,
            scope: permissionScope,
            remember: body.remember === true,
          },
        }),
      )
      return c.json(resolved)
    } catch (err) {
      if (err instanceof UserQuestionValidationError) return c.json({ error: err.message }, 400)
      return tracedRouteError(c, 'project.permissions.resolve', err, 404)
    }
  })

  app.get('/api/projects/:id/preview', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
      c.header(
        'set-cookie',
        previewCapabilities.issueCookie(
          c.req.raw,
          sessionRef.sessionId,
          user.id,
        ),
      )
      return c.json(
        withPreviewCapability(
          beeGamePreviews.status(
            sessionRef.sessionId,
            sessionRef.workspacePath,
          ),
          previewCapabilities,
          user.id,
        ),
      )
    } catch (err) {
      return tracedRouteError(c, 'project.preview', err)
    }
  })

  app.post('/api/projects/:id/preview', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
        authToken: getRequestAuthToken(c.req.raw),
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
      c.header(
        'set-cookie',
        previewCapabilities.issueCookie(c.req.raw, ensured.session.id, user.id),
      )
      return c.json(
        withPreviewCapability(snapshot, previewCapabilities, user.id),
      )
    } catch (err) {
      return projectWorkspaceMutationRouteError(c, 'project.preview.start', err)
    }
  })

  app.post('/api/projects/:id/preview/restart', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
        authToken: getRequestAuthToken(c.req.raw),
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
      c.header(
        'set-cookie',
        previewCapabilities.issueCookie(c.req.raw, ensured.session.id, user.id),
      )
      return c.json(
        withPreviewCapability(snapshot, previewCapabilities, user.id),
      )
    } catch (err) {
      return projectWorkspaceMutationRouteError(
        c,
        'project.preview.restart',
        err,
      )
    }
  })

  app.delete('/api/projects/:id/preview', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'preview.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
      const snapshot = beeGamePreviews.stop(
        sessionRef.sessionId,
        sessionRef.workspacePath,
      )
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

  app.post('/api/projects/:id/deployments/:deploymentId/rollback', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'deployment.manage')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
      const records = mergeDeploymentRecords(persistedRecords, await beeGameDeployments.list(sessionRef.sessionId))
      const source = records.find(
        record => record.id === c.req.param('deploymentId'),
      )
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
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
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
        if (!project.root_path)
          return c.json({
            contract_state: 'missing',
            version: 9,
            requirements: [],
            resources: [],
          })
        const workspacePath = await resolveSessionWorkspacePath(
          project.root_path,
          options.defaultWorkspacePath,
        )
        const contractState = await stat(
          join(workspacePath, 'assets', 'asset-manifest.json'),
        )
          .then(() => 'ready' as const)
          .catch(() => 'missing' as const)
        return c.json({
          contract_state: contractState,
          ...toCanonicalBeeGameAssetManifest(
            await readBeeGameAssetManifest(workspacePath),
          ),
        })
      }
      try {
        const contractState = await stat(
          join(sessionRef.workspacePath, 'assets', 'asset-manifest.json'),
        )
          .then(() => 'ready' as const)
          .catch(() => 'missing' as const)
        const manifest = await readBeeGameAssetManifest(
          sessionRef.workspacePath,
        )
        return c.json({
          contract_state: contractState,
          ...toCanonicalBeeGameAssetManifest(manifest),
        })
      } catch (err) {
        return tracedRouteError(c, 'project.assets.list', err)
      }
    } catch (err) {
      return tracedRouteError(c, 'project.assets.list', err)
    }
  })

  app.get('/api/projects/:id/chat-attachments/:storageId', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(c.req.raw, user, c.req.param('id'), dashboardRepository)
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const workspace = await resolveBeeGameProjectArtifactReference({
        request: c.req.raw, user, project, defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions, dashboardRepository,
      })
      if (!workspace) return c.json({ error: 'Attachment not found' }, 404)
      return await readChatAttachment(workspace.workspacePath, c.req.param('storageId'))
    } catch {
      return c.json({ error: 'Attachment not found' }, 404)
    }
  })

  app.get('/api/projects/:id/assets/resources/:resourceId/file', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const workspace = await resolveBeeGameProjectArtifactReference({
        request: c.req.raw,
        user,
        project,
        defaultWorkspacePath: options.defaultWorkspacePath,
        beeGameSessions,
        dashboardRepository,
      })
      if (!workspace) return c.json({ error: 'Project workspace not found' }, 404)
      const manifest = await readBeeGameAssetManifest(workspace.workspacePath)
      const resource = manifest.resources.find(
        item => item.id === c.req.param('resourceId'),
      )
      if (!resource || resource.status !== 'verified')
        return c.json({ error: 'Verified project resource not found' }, 404)
      const requestedPath = c.req.query('path') || resource.root_path
      if (!resource.file_paths.includes(requestedPath))
        return c.json({ error: 'Resource file is not registered' }, 404)
      const target = resolve(workspace.workspacePath, requestedPath)
      if (!isPathInsideWorkspace(workspace.workspacePath, target))
        return c.json({ error: 'Resource file path is invalid' }, 400)
      const canonicalTarget = await realpath(target)
      if (!isPathInsideWorkspace(workspace.workspacePath, canonicalTarget))
        return c.json({ error: 'Resource file path is invalid' }, 400)
      const file = await readFile(canonicalTarget)
      const body = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer
      const filename = requestedPath.split('/').at(-1)?.replaceAll('"', '') || 'resource'
      return new Response(new Blob([body], { type: projectResourceContentType(requestedPath) }), {
        headers: {
          'content-type': projectResourceContentType(requestedPath),
          'content-disposition': `inline; filename="${filename}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (err) {
      return tracedRouteError(c, 'project.assets.file', err, 404)
    }
  })

  app.post('/api/projects/:id/assets/resources/:resourceId/upload', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, ROUTE_PERMISSION.assetIntegration)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const project = await getOwnedProjectMetadata(
        c.req.raw,
        user,
        c.req.param('id'),
        dashboardRepository,
      )
      if (!project) return c.json({ error: 'Project not found' }, 404)
      const file = await readProjectAssetUpload(c.req.raw)
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
        authToken: getRequestAuthToken(c.req.raw),
      })
      assertProjectWorkspaceMutationIdle(ensured.session)
      const sessionMetadata = beeGameSessions.metadata(ensured.session.id)
      const result = await uploadBeeGameAsset(
        ensured.binding.workspacePath,
        c.req.param('resourceId'),
        file,
        {
          persist: async manifest => {
            const storageUri = await dashboardRepository.uploadAssetFile(
              c.req.raw,
              user,
              sessionMetadata,
              file,
            )
            try {
              await dashboardRepository.upsertAssetManifest(
                c.req.raw,
                user,
                sessionMetadata,
                manifest,
              )
            } catch (error) {
              try {
                await dashboardRepository.deleteAssetFile(
                  c.req.raw,
                  user,
                  sessionMetadata,
                  storageUri,
                )
              } catch (cleanupError) {
                console.warn(
                  '[BeeGame] Failed to clean up an uncommitted asset upload:',
                  {
                    projectId: project.id,
                    cause: toErrorMessage(cleanupError),
                  },
                )
              }
              throw error
            }
          },
        },
      )
      return c.json({
        ...result,
        manifest: toCanonicalBeeGameAssetManifest(result.manifest),
      })
    } catch (err) {
      return tracedRouteError(
        c,
        'project.assets.upload',
        err,
        err instanceof RequestBodyLimitError ? 413 : 400,
      )
    }
  })

  async function deleteOwnedProject(request: Request, user: BeeGameUserContext, projectId: string) {
      const project = await getOwnedProjectMetadata(
        request,
        user,
        projectId,
        dashboardRepository,
      )
      // Ownership is the authorization boundary for deleting a project. A
      // workspace-wide administrative grant must not prevent a creator from
      // removing their own project.
      if (!project) return { deleted: false }
      const liveSession = findLiveProjectSession(
        beeGameSessions,
        user.id,
        project.id,
      )
      if (liveSession) {
        beeGamePreviews.stop(liveSession.id, liveSession.cwd)
        previewCapabilities.revokeSession(liveSession.id)
        await beeGameSessions.delete(liveSession.id, { deleteArtifacts: false })
      }
      const deleted = await dashboardRepository.deleteProject(
        request,
        user,
        projectId,
      )
      const deletedWorkspacePath =
        deleted && project?.root_path
          ? await deleteWorkspaceDirectoryIfSafe(
              project.root_path,
              dashboardDataRoot,
            )
          : undefined
      const cleanupOutcome = deletedWorkspacePath
        ? 'workspace_deleted'
        : project?.root_path
          ? 'workspace_retained'
          : 'metadata_deleted'
      if (deleted) {
        await appendAuditEventBestEffort('project.deleted', () =>
          dashboardRepository.appendAuditEvent(request, user, {
            actorId: user.id,
            action: 'project.deleted',
            targetType: 'project',
            targetId: projectId,
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
      return {
        deleted,
        ...(deletedWorkspacePath ? { deletedWorkspacePath } : {}),
      }
  }

  registerDevProjectPurgeRoutes(app, {
    getUser: getCurrentUser,
    listProjects: (request, user) => dashboardRepository.listProjects(request, user),
    deleteProject: deleteOwnedProject,
  })

  app.delete('/api/projects/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    try {
      return c.json(await deleteOwnedProject(c.req.raw, user, c.req.param('id')))
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
    const modelConfigId = await resolveDefaultModelConfigId(
      request,
      user,
      typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
      async (nextRequest, requestUser, id) =>
        dashboardRepository.modelConfigExists(nextRequest, requestUser, id),
      async (nextRequest, requestUser) =>
        dashboardRepository.listModelConfigs(nextRequest, requestUser),
    )
    const clientRequestId = getBeeGameClientRequestId(body)
    const analysisWorkspace = await mkdtemp(
      join(getCurrentUserDataRoot(request), 'attachment-analysis-'),
    )
    const recordModelUsage = createUsageRecorder({
      sessionId: `attachment-analysis:${clientRequestId ?? randomUUID()}`,
      record: input => dashboardRepository.recordUsage(request, user, input),
      debit: input =>
        dashboardRepository.debitRealTimeUsage(request, user, input),
    })
    try {
      const runtimeEnv = await dashboardRepository.getRuntimeEnv(
        getCurrentUserDataRoot(request),
        user.id,
        getRequestAuthToken(request),
        modelConfigId,
      )
      const analysis = await generateBeeGameAttachmentAnalysis({
        idea: typeof body.idea === 'string' ? body.idea : '',
        attachments,
        workspace: analysisWorkspace,
        language: typeof body.language === 'string' ? body.language : undefined,
        modelConfigId,
        ownerId: user.id,
        runtimeEnv,
        modelRuntimeHost,
        recordModelUsage,
        requireUsage: true,
      })
      return analysis
    } finally {
      await rm(analysisWorkspace, { recursive: true, force: true })
    }
  }

  const runBeeGameIntake = async (
    request: Request,
    user: BeeGameUserContext,
    body: JsonObject,
  ): Promise<BeeGameIntakeAnalysis> => {
    const modelConfigId = await resolveDefaultModelConfigId(
      request,
      user,
      typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
      async (nextRequest, requestUser, id) =>
        dashboardRepository.modelConfigExists(nextRequest, requestUser, id),
      async (nextRequest, requestUser) =>
        dashboardRepository.listModelConfigs(nextRequest, requestUser),
    )
    const clientRequestId = getBeeGameClientRequestId(body)
    const recordModelUsage = createUsageRecorder({
      sessionId: `idea-intake:${clientRequestId ?? randomUUID()}`,
      record: input => dashboardRepository.recordUsage(request, user, input),
      debit: input =>
        dashboardRepository.debitRealTimeUsage(request, user, input),
    })
    const intake = await generateBeeGameIntakeOptions({
      idea: String(body.idea),
      referenceParts: body.attachments === undefined || (Array.isArray(body.attachments) && !body.attachments.length)
        ? [] : await intakeReferenceParts(validateBeeGameAttachments(body.attachments)),
      language: typeof body.language === 'string' ? body.language : undefined,
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
      recordModelUsage,
      requireUsage: true,
    })
    return intake
  }

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
      const analysis = await runBeeGameAttachmentAnalysis(
        c.req.raw,
        user,
        body,
        attachments,
      )
      return c.json(analysis)
    } catch (err) {
      if (err instanceof HttpError) return c.json(err.body, err.status)
      if (err instanceof BeeGameUploadPolicyError)
        return uploadPolicyResponse(err)
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post('/api/beegame-intake/jobs', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw, MAX_BEEGAME_REQUEST_BYTES)
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
      runtimeId: intakeRuntimeId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    })
    const jobDataRoot = getCurrentUserDataRoot(request)
    await saveBeeGameIntakeJob(jobDataRoot, jobId, intakeJobs.get(jobId)!)
    setTimeout(
      () => {
        intakeJobs.delete(jobId)
        void deleteBeeGameIntakeJob(jobDataRoot, jobId)
      },
      30 * 60 * 1000,
    )

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
        await persistIntakeJobSafely(jobDataRoot, jobId, intakeJobs.get(jobId)!)
      } catch (err) {
        const job = intakeJobs.get(jobId)
        if (!job) return
        intakeJobs.set(jobId, {
          ...job,
          status: 'failed',
          error:
            err instanceof HttpError
              ? getHttpErrorMessage(err.body)
              : toErrorMessage(err),
          errorStatus: err instanceof HttpError ? err.status : 400,
          updatedAt: Date.now(),
        })
        await persistIntakeJobSafely(jobDataRoot, jobId, intakeJobs.get(jobId)!)
      }
    })()

    return c.json({ jobId, status: 'running' }, 202)
  })

  app.get('/api/beegame-intake/jobs/:jobId', async c => {
    const user = getCurrentUser(c.req.raw)
    const jobId = c.req.param('jobId')
    let job =
      intakeJobs.get(jobId) ??
      ((await loadBeeGameIntakeJob(getCurrentUserDataRoot(c.req.raw), jobId)) as
        | BeeGameIntakeJob
        | undefined)
    if (!job || job.ownerId !== user.id)
      return c.json({ error: 'Intake job not found' }, 404)
    if (job.status === 'running' && job.runtimeId !== intakeRuntimeId) {
      job = {
        ...job,
        status: 'failed',
        error:
          'Idea intake was interrupted by a service restart. Retry the intake request.',
        updatedAt: Date.now(),
      }
      await persistIntakeJobSafely(
        getCurrentUserDataRoot(c.req.raw),
        jobId,
        job,
      )
    }
    if (job.status === 'completed') {
      return c.json({ status: job.status, result: job.result })
    }
    if (job.status === 'failed') {
      return c.json({
        status: job.status,
        error: job.error || 'Intake job failed',
        errorStatus: job.errorStatus ?? 400,
      })
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
        dashboardRepository.appendAuditEvent(
          request,
          getCurrentUser(request),
          input,
        ),
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
      revokePreviewCapability: sessionId =>
        previewCapabilities.revokeSession(sessionId),
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
      modelConfigExists: (request, user, id) =>
        dashboardRepository.modelConfigExists(request, user, id),
      listModelConfigs: (request, user) =>
        dashboardRepository.listModelConfigs(request, user),
    },
  )
  return app
}

async function readProjectAssetUpload(request: Request): Promise<File> {
  const bytes = await readRequestBytes(
    request,
    MAX_BEEGAME_PROJECT_ASSET_REQUEST_BYTES,
  )
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
  })
  const form = await boundedRequest.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new Error('Missing form file')
  if (file.size === 0) throw new Error('Asset file is empty')
  if (file.size > MAX_BEEGAME_PROJECT_ASSET_BYTES) {
    throw new RequestBodyLimitError(MAX_BEEGAME_PROJECT_ASSET_BYTES)
  }
  return file
}

async function discoverBeeGameProjectArtifacts(
  workspacePath: string,
): Promise<BeeGameArtifactIndexItem[]> {
  const root = resolve(workspacePath)
  const artifacts: BeeGameArtifactIndexItem[] = []
  await collectArtifactsFromDirectory(root, 'docs', 'Document', artifacts)
  await collectArtifactsFromDirectory(
    root,
    'transcripts',
    'Transcript',
    artifacts,
  )
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
    await collectArtifactFile(
      workspaceRoot,
      relativePath,
      artifactType,
      artifacts,
    )
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
  // A lexical in-project path can still resolve through a symlink outside it.
  // Read the checked canonical target, not the alias again after validation.
  const [actualRoot, actualTarget] = await Promise.all([realpath(workspaceRoot), realpath(targetPath)])
  if (!isPathInsideWorkspace(actualRoot, actualTarget)) {
    throw new Error('Artifact path must stay inside the session workspace')
  }
  return {
    path: relative(workspaceRoot, targetPath).split('\\').join('/'),
    content: await readFile(actualTarget, 'utf8'),
  }
}

function isPathInsideWorkspace(
  workspaceRoot: string,
  targetPath: string,
): boolean {
  const relativePath = relative(resolve(workspaceRoot), resolve(targetPath))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function projectResourceContentType(path: string): string {
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
  } as Record<string, string>)[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function requirePermission(
  user: BeeGameUserContext,
  permission: BeeGamePermission,
): { error: string } | undefined {
  return hasBeeGamePermission(user, permission)
    ? undefined
    : { error: 'Forbidden' }
}

function invitationRouteError(_c: Context, error: unknown): Response {
  const upstreamStatus =
    error instanceof InvitationServiceError ? error.status : 502
  const status = [400, 401, 403, 404].includes(upstreamStatus)
    ? upstreamStatus
    : 502
  const message =
    error instanceof Error ? error.message : 'Invitation service request failed'
  return Response.json(
    { error: message, message },
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  )
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
  status: 400 | 404 | 413 | 500 | 501 = 400,
  publicError = 'Request failed',
): Response {
  if (error instanceof BeeGameAssetManifestError) {
    const traceId = randomUUID()
    console.warn('[BeeGame] asset manifest rejected', {
      traceId,
      route,
      cause: error.name,
      issues: error.issues,
    })
    return c.json(
      {
        error: 'Invalid asset manifest',
        code: error.code,
        issues: error.issues,
        traceId,
      },
      400,
    )
  }
  return tracedRouteResponse(route, error, status, publicError, response =>
    c.json(response, status),
  )
}

function resourceSemanticCurationRouteError(
  c: Context,
  error: unknown,
): Response {
  const traceId = randomUUID()
  const stage =
    error instanceof BeeGameUsageBillingError
      ? error.stage
      : error instanceof BeeGameModelRuntimeError
        ? error.stage
        : 'model_request'
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : 'Resource semantic runtime failed'
  const upstreamTraceId =
    error instanceof BeeGameUsageBillingError ? error.traceId : undefined
  console.warn('[BeeGame] resource semantic curation failed', {
    traceId,
    ...(upstreamTraceId ? { upstreamTraceId } : {}),
    stage,
    cause: error instanceof Error ? error.name : 'unknown_error',
    causeMessage: message,
    ...(process.env.NODE_ENV !== 'production' &&
    error instanceof Error &&
    error.stack
      ? { causeStack: error.stack }
      : {}),
  })
  return c.json(
    {
      error: 'Resource semantic runtime failed',
      code: 'resource_semantic_runtime_failed',
      stage,
      message,
      traceId,
    },
    502,
  )
}

function tracedRouteResponse(
  route: string,
  error: unknown,
  status: 400 | 404 | 413 | 500 | 501,
  publicError = 'Request failed',
  createResponse: (body: {
    error: string
    traceId: string
  }) => Response = body => Response.json(body, { status }),
): Response {
  const traceId = randomUUID()
  const diagnostic =
    error instanceof Error
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
    '/api/image-generation/settings',
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
  const modelConfigId =
    configs.find(config => config.isDefault)?.id ?? configs[0]?.id
  if (!modelConfigId) {
    throw new Error(
      'No model config found. Configure a default model before generating.',
    )
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
  if (!modelConfigId || !(await exists(request, user, modelConfigId))) {
    throw new Error('Model config not found')
  }
  return modelConfigId
}

async function generateBeeGameModelWithUsage(
  host: BeeGameModelRuntimeHost,
  input: BeeGameModelGenerateInput,
  recordModelUsage?: (
    usage: BeeGameModelUsage,
    querySource: string,
  ) => Promise<void>,
  requireUsage = false,
): Promise<string> {
  const result = host.generateWithUsage
    ? await host.generateWithUsage(input)
    : { content: await host.generate(input) }
  if (requireUsage && !result.usage) {
    throw new Error('Realtime usage billing requires provider token usage')
  }
  if (result.usage && recordModelUsage) {
    await recordModelUsage(result.usage, input.querySource)
  }
  return result.content
}

export function createUsageRecorder(input: {
  sessionId: string
  projectId?: string
  record: (input: {
    sessionId: string
    projectId?: string
    usage: {
      prompt_tokens: number
      completion_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
      total_tokens: number
    }
    idempotencyKey: string
    metadata?: Record<string, unknown>
    usageSource?: 'runtime_snapshot' | 'model_runtime_host'
  }) => Promise<{ creditsMicro: number }>
  debit: (input: {
    sessionId: string
    projectId?: string
    usage: {
      prompt_tokens: number
      completion_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
      total_tokens: number
    }
    idempotencyKey: string
    metadata?: Record<string, unknown>
    usageSource?: 'runtime_snapshot' | 'model_runtime_host'
  }) => Promise<{ creditsMicro: number }>
  onSettled?: (result: { creditsMicro: number }) => void | Promise<void>
  onDebitFailed?: (failure: {
    diagnosticId: string
    sessionId: string
    querySource: string
    idempotencyKey: string
    retryable: boolean
    message: string
  }) => void | Promise<void>
}): (usage: BeeGameModelUsage, querySource: string) => Promise<void> {
  const settledKeys = new Set<string>()
  return async (usage, querySource) => {
    const normalizedUsage = {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
      total_tokens: usage.total_tokens,
    }
    const idempotencyKey = `usage:${input.sessionId}:${createHash('sha256')
      .update(JSON.stringify({ querySource, usage: normalizedUsage }))
      .digest('hex')}`
    if (settledKeys.has(idempotencyKey)) return
    const recordInput = {
      sessionId: input.sessionId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      usage: normalizedUsage,
      idempotencyKey,
      metadata: {
        querySource,
        usageSource: 'model_runtime_host',
      },
      usageSource: 'model_runtime_host' as const,
    }
    const recordResult = await input.record(recordInput)
    try {
      const debitResult = await input.debit(recordInput)
      settledKeys.add(idempotencyKey)
      await input.onSettled?.(debitResult)
    } catch (error) {
      settledKeys.add(idempotencyKey)
      await input.onSettled?.(recordResult)
      const message = error instanceof Error ? error.message : String(error)
      const diagnosticId = `billing_${createHash('sha256')
        .update(`${idempotencyKey}:${message}`)
        .digest('hex')
        .slice(0, 16)}`
      const failure = {
        diagnosticId,
        sessionId: input.sessionId,
        querySource,
        idempotencyKey,
        retryable:
          typeof error === 'object' &&
          error !== null &&
          'retryable' in error &&
          error.retryable === true,
        message,
      }
      if (input.onDebitFailed) {
        await input.onDebitFailed(failure)
      } else {
        console.error('[BeeGame] realtime usage debit failed', failure)
      }
    }
  }
}

async function generateBeeGameAttachmentAnalysis(input: {
  idea?: string
  attachments: BeeGameAttachment[]
  workspace: string
  language?: string
  modelConfigId?: string
  ownerId: string
  runtimeEnv?: Record<string, string>
  modelRuntimeHost: BeeGameModelRuntimeHost
  recordModelUsage?: (
    usage: BeeGameModelUsage,
    querySource: string,
  ) => Promise<void>
  requireUsage?: boolean
}): Promise<AttachmentBuildAnalysis> {
  const configId =
    input.modelConfigId ??
    listModelConfigs(input.ownerId).find(config => config.isDefault)?.id
  const runtime = configId ? mapModelConfigToRuntime(configId) : undefined
  const env = { ...(runtime?.env ?? {}), ...(input.runtimeEnv ?? {}) }
  const sourceType = input.attachments.some(item => item.type === 'image')
    ? input.attachments.some(item => item.type === 'file')
      ? 'mixed'
      : 'image'
    : 'gdd'
  const referenceParts = await intakeReferenceParts(input.attachments)
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
    `User request: ${input.idea || ''}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const rawContent = await generateBeeGameModelWithUsage(
    input.modelRuntimeHost,
    {
      cwd: input.workspace,
      runtimeEnv: env,
      systemPrompt: `You are the BeeGame attachment design analyst. Return JSON only. Use ${input.language || 'the user language'} for natural-language values while keeping property names in English.`,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text }, ...referenceParts],
        },
      ],
      temperature: 0.2,
      maxTokens: 8_192,
      querySource: 'beegame_attachment_analysis',
    },
    input.recordModelUsage,
    input.requireUsage,
  )
  if (!rawContent)
    throw new Error('Attachment analysis model returned empty content')
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    throw new Error('Attachment analysis model returned invalid JSON')
  }
  const analysis = parseAttachmentBuildAnalysis({
    ...(isObject(parsed) ? parsed : {}),
    analysisId: `attachment_analysis_${randomUUID().replaceAll('-', '')}`,
  })
  if (analysis.sourceType !== sourceType)
    throw new Error(
      'Attachment analysis source type did not match uploaded attachments',
    )
  return analysis
}

async function generateBeeGameIntakeOptions(input: {
  idea: string
  referenceParts?: Exclude<import('./beegame/model-runtime-host').BeeGameModelContent, string>
  language?: string
  ownerId: string
  modelConfigId?: string
  runtimeEnv?: Record<string, string>
  cwd: string
  modelRuntimeHost: BeeGameModelRuntimeHost
  recordModelUsage?: (
    usage: BeeGameModelUsage,
    querySource: string,
  ) => Promise<void>
  requireUsage?: boolean
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
    BEEGAME_USER_RESPONSE_SCOPE,
    'This intake only accepts requests to make a game. If the input is primarily an informational question rather than a game idea, return exactly {"request_scope":"out_of_scope"}. Do not answer that question, invent game directions, or reveal internal details. A request to make a game about a topic is still a game idea.',
    'Do not emit analysis, reasoning, thinking tags, or a thinking summary. Return the requested JSON object directly.',
    'First decide whether the user is requesting a game. For a game idea, understand it before proposing game modes. The options are target briefs that help the user choose a direction, not full design documents and not project management delivery strategies.',
    'For a game idea, return only JSON with this schema: maturity, needs_clarification, clarification, clarification_questions, detected_constraints, recommended_next_step, options.',
    'maturity must be one of vague, directional, concrete.',
    'For a game idea, always return exactly 3 valid, meaningfully distinct game directions for the user to choose from, including when the submitted idea is already concrete.',
    'For a game idea, do not ask the user for clarification during intake. Set needs_clarification=false, leave clarification empty, leave clarification_questions empty, and set recommended_next_step="choose_direction".',
    'Each option must include id, title, projectFolderName, gameplay, recommendedPlatform, recommendedEngine, recommendedDimension, recommendedGenre, recommendedStyle, recommendedInputs, and scope.',
    'Keep each option concise. BeeGame derives the expanded planning fields after the user chooses a direction; do not duplicate the same explanation across multiple fields.',
    'projectFolderName must be an English lowercase kebab-case directory name based on the actual game concept, not a random identifier and not a BeeGame/dashboard name.',
    'title must be a game mode name, such as an objective, combat, puzzle, survival, race, sandbox, boss, narrative, simulation, or strategy mode name. Do not copy the user idea into the title and do not write an abstract production or delivery title.',
    'gameplay must explain the playable rules: player goal, main actions, opposition or pressure, scoring or progress, and win/fail/round end condition. Do not write abstract experience prose.',
    'The direction must be suitable for a complete game later, but this intake option should stay lightweight: name the mode, explain the core gameplay, and summarize the first target the user is choosing.',
    'Each option.scope is the first complete playable release, not a future roadmap. When the user has not specified content breadth, keep one coherent core loop and only enough representative content to prove it (usually one or two levels if the game has levels). Defer extra modes, large campaigns, cosmetic sets, and nonessential screens; preserve quantities and features the user explicitly requested.',
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
  const requestMessages = [
    {
      role: 'user',
      content: input.referenceParts?.length
        ? [{ type: 'text' as const, text: `Game idea: ${input.idea}\nUse the attached references to inform the three directions; preserve the user's explicit constraints.` }, ...input.referenceParts]
        : `Game idea: ${input.idea}`,
    },
  ] satisfies Array<{ role: 'user'; content: import('./beegame/model-runtime-host').BeeGameModelContent }>
  const firstContent = await generateBeeGameModelWithUsage(
    input.modelRuntimeHost,
    {
      cwd: input.cwd,
      runtimeEnv: env,
      systemPrompt,
      messages: requestMessages,
      temperature: 0.4,
      maxTokens: 8_192,
      querySource: 'beegame_idea_intake',
    },
    input.recordModelUsage,
    input.requireUsage,
  )
  try {
    return parseBeeGameIntakeContent(firstContent)
  } catch (initialError) {
    if (initialError instanceof BeeGameIntakeScopeError)
      throw new Error(beeGameIntakeScopeMessage(input.language))
    const repairedContent = await generateBeeGameModelWithUsage(
      input.modelRuntimeHost,
      {
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
      },
      input.recordModelUsage,
      input.requireUsage,
    )
    try {
      return parseBeeGameIntakeContent(repairedContent)
    } catch (repairError) {
      throw new Error(
        `${toErrorMessage(initialError)} Finalization retry was also invalid: ${toErrorMessage(repairError)}`,
      )
    }
  }
}

export function parseBeeGameIntakeContent(content: string): BeeGameIntakeAnalysis {
  return parseBeeGameIntakeAnalysis({
    choices: [{ message: { content } }],
  })
}

class BeeGameIntakeScopeError extends Error {}

function beeGameIntakeScopeMessage(language?: string): string {
  if (language?.startsWith('zh')) return '这里用于创建游戏。请描述你想制作的游戏。'
  if (language?.startsWith('ja')) return 'ここはゲーム制作の入力欄です。作りたいゲームを説明してください。'
  if (language?.startsWith('ko')) return '여기는 게임 제작 입력란입니다. 만들고 싶은 게임을 설명해 주세요.'
  return 'This is for creating games. Describe the game you want to make.'
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
}

function parseBeeGameIntakeAnalysis(
  payload: JsonObject,
): BeeGameIntakeAnalysis {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice = choices[0]
  const message =
    isObject(firstChoice) && isObject(firstChoice.message)
      ? firstChoice.message
      : undefined
  const content = message ? extractMessageContentText(message) : ''
  const parsed = parseJsonObjectFromText(content)
  if (parsed.request_scope === 'out_of_scope')
    throw new BeeGameIntakeScopeError('Not a game idea')
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
    detectedConstraints: getStringArrayField(
      parsed,
      'detectedConstraints',
      'detected_constraints',
    ),
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
  const rawInputs = getStringListField(
    value,
    'recommendedInputs',
    'recommended_inputs',
    'selectedInputs',
    'selected_inputs',
  )
  const selectedInputs = pickAllowedProductionInputs(rawInputs)
  const gameplay = String(value.gameplay || '').trim()
  const pitch = String(value.pitch || '').trim() || gameplay
  const option = {
    id: String(value.id || '').trim() || `mode_${optionIndex + 1}`,
    title: String(value.title || '').trim(),
    projectFolderName: getStringField(
      value,
      'projectFolderName',
      'project_folder_name',
    ),
    pitch,
    gameplay,
    coreGameplayHypothesis:
      getStringField(
        value,
        'coreGameplayHypothesis',
        'core_gameplay_hypothesis',
      ) || gameplay,
    experienceSnapshot:
      getStringField(value, 'experienceSnapshot', 'experience_snapshot') ||
      pitch,
    playerFirstMinute:
      getStringField(value, 'playerFirstMinute', 'player_first_minute') ||
      gameplay,
    whyFitsIdea:
      getStringField(value, 'whyFitsIdea', 'why_fits_idea') ||
      getStringField(value, 'fit') ||
      pitch,
    playablePrototype:
      getStringField(value, 'playablePrototype', 'playable_prototype') ||
      getStringField(value, 'firstBuild', 'first_build') ||
      getStringField(
        value,
        'firstPlayableValidation',
        'first_playable_validation',
      ) ||
      gameplay,
    validationTarget:
      getStringField(value, 'validationTarget', 'validation_target') ||
      getStringField(value, 'validationGoal', 'validation_goal') ||
      getStringField(
        value,
        'firstPlayableValidation',
        'first_playable_validation',
      ) ||
      gameplay,
    coreMechanic:
      getStringField(value, 'coreMechanic', 'core_mechanic') ||
      getStringField(
        value,
        'coreGameplayHypothesis',
        'core_gameplay_hypothesis',
      ) ||
      gameplay,
    firstBuild:
      getStringField(value, 'firstBuild', 'first_build') ||
      getStringField(value, 'playablePrototype', 'playable_prototype') ||
      getStringField(
        value,
        'firstPlayableValidation',
        'first_playable_validation',
      ) ||
      gameplay,
    validationGoal:
      getStringField(value, 'validationGoal', 'validation_goal') ||
      getStringField(value, 'validationTarget', 'validation_target') ||
      getStringField(
        value,
        'firstPlayableValidation',
        'first_playable_validation',
      ) ||
      gameplay,
    risk:
      getStringField(value, 'risk') ||
      getStringField(value, 'riskComplexity', 'risk_complexity') ||
      'Complexity depends on selected scope.',
    fit: getStringField(value, 'fit') || pitch,
    firstPlayableValidation:
      getStringField(
        value,
        'firstPlayableValidation',
        'first_playable_validation',
      ) || gameplay,
    riskComplexity:
      getStringField(value, 'riskComplexity', 'risk_complexity') ||
      'Complexity depends on selected scope.',
    recommendedPlatform: pickAllowedProductionSetting(
      getFirstStringishField(
        value,
        'recommendedPlatform',
        'recommended_platform',
        'selectedPlatform',
        'selected_platform',
      ),
      BEEGAME_INTAKE_SETTING_VALUES.platforms,
    ),
    recommendedEngine: pickAllowedProductionSetting(
      getFirstStringishField(
        value,
        'recommendedEngine',
        'recommended_engine',
        'selectedEngine',
        'selected_engine',
      ),
      BEEGAME_INTAKE_SETTING_VALUES.engines,
    ),
    recommendedDimension: pickAllowedProductionSetting(
      getFirstStringishField(
        value,
        'recommendedDimension',
        'recommended_dimension',
        'selectedDimension',
        'selected_dimension',
      ),
      BEEGAME_INTAKE_SETTING_VALUES.dimensions,
    ),
    recommendedGenre: pickAllowedProductionSetting(
      getFirstStringishField(
        value,
        'recommendedGenre',
        'recommended_genre',
        'selectedGenre',
        'selected_genre',
      ),
      BEEGAME_INTAKE_SETTING_VALUES.genres,
    ),
    recommendedStyle: pickAllowedProductionSetting(
      getFirstStringishField(
        value,
        'recommendedStyle',
        'recommended_style',
        'selectedStyle',
        'selected_style',
      ),
      BEEGAME_INTAKE_SETTING_VALUES.styles,
    ),
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
        option.recommendedInputs.length === 0 ||
        option.recommendedInputs.length !== rawInputs.length
          ? 'recommendedInputs'
          : '',
      ]
        .filter(Boolean)
        .join(', '),
    )
    return undefined
  }
  return option
}

function normalizeMaturity(
  value: unknown,
): 'vague' | 'directional' | 'concrete' {
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
  return allowed.includes(value as T) ? (value as T) : ''
}

function pickAllowedProductionInputs(values: string[]): string[] {
  const allowed = BEEGAME_INTAKE_SETTING_VALUES.inputs
  return values.filter((value): value is (typeof allowed)[number] =>
    allowed.includes(value as (typeof allowed)[number]),
  )
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
  for (
    let start = text.indexOf('{');
    start >= 0;
    start = text.indexOf('{', start + 1)
  ) {
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
  return repository.getProject(request, user, projectId)
}

async function ensureBeeGameProjectSession(input: {
  request: Request
  authToken?: string
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
    !(await input.dashboardRepository.ownsProjectWorkspacePath(
      input.request,
      input.user,
      workspacePath,
    ))
  ) {
    throw new Error('Project workspace does not belong to the current user')
  }

  if (
    live && live.status === 'running' &&
    normalizeResolvedPath(live.cwd) === normalizeResolvedPath(workspacePath)
  ) {
    const metadata = input.beeGameSessions.metadata(live.id)
    await input.dashboardRepository.upsertSessionMetadata(
      input.request,
      input.user,
      metadata,
    )
    return {
      session: live,
      binding: createProjectSessionBinding(
        input.project.id,
        live.id,
        workspacePath,
      ),
    }
  }
  if (live && normalizeResolvedPath(live.cwd) === normalizeResolvedPath(workspacePath))
    await input.beeGameSessions.waitForSessionIdle(live.id)

  const readableConfigs = await input.dashboardRepository.listModelConfigs(
    input.request,
    input.user,
  )
  const restoredModelConfigId =
    latest?.modelConfigId &&
    (await input.dashboardRepository.modelConfigExists(
      input.request,
      input.user,
      latest.modelConfigId,
    ))
      ? latest.modelConfigId
      : undefined
  const modelConfigId =
    restoredModelConfigId ??
    readableConfigs.find(config => config.isDefault)?.id ??
    readableConfigs[0]?.id
  if (modelConfigId)
    await input.assertPermittedModelConfigRuntime(modelConfigId)
  const session = input.beeGameSessions.start({
    workspacePath,
    projectId: input.project.id,
    ...((live && normalizeResolvedPath(live.cwd) === normalizeResolvedPath(workspacePath))
      ? { transcriptSessionId: live.id }
      : latest?.id ? { transcriptSessionId: latest.id } : {}),
    ...(modelConfigId ? { modelConfigId } : {}),
    ...(language ? { language } : {}),
    userId: input.user.id,
    ...(input.authToken ? { authToken: input.authToken } : {}),
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
    binding: createProjectSessionBinding(
      input.project.id,
      session.id,
      workspacePath,
      language,
    ),
    ...(latest?.id && latest.id !== session.id
      ? { previousSessionId: latest.id }
      : {}),
  }
}

async function getBeeGameProjectRuntimeState(input: {
  request: Request
  user: BeeGameUserContext
  project: BeeGameProjectMetadata
  defaultWorkspacePath?: string
  dashboardDataRoot: string
  beeGameSessions: BeeGameSessionManager
  beeGamePreviews: BeeGamePreviewManager
  previewCapabilities: PreviewCapabilityManager
  dashboardRepository: DashboardRepository
}): Promise<JsonObject> {
  const sessionRef = await resolveBeeGameProjectSessionReference(input)
  if (!sessionRef) {
    const idle = createIdleProjectRuntimeState(input.project.id)
    return idle
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
  const livePending = input.beeGameSessions.pendingPermissionsForProject(
    input.user.id,
    input.project.id,
    sessionRef.workspacePath,
  )
  // A transcript records what was requested, but its native approval callback
  // dies with the process. Only requests held by this session manager can be
  // approved after a restart.
  const pending = livePending.map(pendingBeeGamePermissionToEvent)
  const nativeRuntime = deriveBeeGameRuntimeStatus(
    events,
    pending,
    snapshot?.phaseStatus === 'recovered',
    snapshot?.activeSubagentToolUseIds ?? [],
  )
  const runtime = nativeRuntime
  const preview = getProjectPreviewSnapshot({
    sessionId: sessionRef.sessionId,
    workspacePath: sessionRef.workspacePath,
    beeGamePreviews: input.beeGamePreviews,
  })
  const assetManifest = await readBeeGameAssetManifest(
    sessionRef.workspacePath,
  ).catch(() => ({
    version: 9 as const,
    requirements: [],
    resources: [],
    project_target: undefined,
  }))
  const acceptance = { status: 'not_run' }
  const context = deriveBeeGameContextVisibility(events, snapshot) ?? {}
  const runtimeFailureReason =
    runtime.agentStatus === 'failed'
      ? projectRuntimeDisplayReason(runtime.nextAction)
      : undefined
  return {
    project_id: input.project.id,
    phase: runtime.phase,
    blocked: pending.length > 0 || runtime.agentStatus === 'failed',
    ...(runtimeFailureReason
        ? projectRuntimeBlockedReasonFields(runtimeFailureReason)
        : { blocked_reason: pending[0]?.text ?? null }),
    active_agents: runtime.activeAgents,
    active_subagents: runtime.activeSubagents,
    updated_at: runtime.updatedAt,
    activity: runtimeActivity(events),
    next_action: runtime.nextAction,
    context,
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
    acceptance,
    model_config_id:
      sessionRef.live?.modelConfigId ??
      sessionRef.latest?.modelConfigId ??
      snapshot?.modelConfigId ??
      null,
    pending_permissions: livePending.map(pendingBeeGamePermissionRequestToJson),
  }
}


function projectRuntimeBlockedReasonFields(
  reason: ReturnType<typeof projectRuntimeDisplayReason>,
): JsonObject {
  return reason
    ? {
        blocked_reason: reason.message,
        blocked_reason_code: reason.code,
        blocked_reason_diagnostic_id: reason.diagnosticId,
      }
    : { blocked_reason: null }
}

async function getLatestProjectSessionMetadata(input: {
  request: Request
  user: BeeGameUserContext
  project: BeeGameProjectMetadata
  defaultWorkspacePath?: string
  dashboardRepository: DashboardRepository
}): Promise<
  | Awaited<ReturnType<DashboardRepository['listProjectSessions']>>[number]
  | undefined
> {
  const latest = (
    await input.dashboardRepository.listProjectSessions(
      input.request,
      input.user,
      input.project.id,
    )
  )[0]
  if (latest) return latest
  if (!input.project.root_path) return undefined
  const workspacePath = await resolveSessionWorkspacePath(
    input.project.root_path,
    input.defaultWorkspacePath,
  )
  if (
    input.user.id !== DEFAULT_LOCAL_USER_ID &&
    !(await input.dashboardRepository.ownsProjectWorkspacePath(
      input.request,
      input.user,
      workspacePath,
    ))
  ) {
    return undefined
  }
  const recovered = await recoverLatestProjectSessionFromDisk(workspacePath)
  return recovered
    ? {
        ...recovered,
        projectId: input.project.id,
      }
    : undefined
}


function findLiveProjectSession(
  beeGameSessions: BeeGameSessionManager,
  userId: string,
  projectId: string,
): BeeGameSession | undefined {
  return beeGameSessions
    .list(userId)
    .filter(
      session => beeGameSessions.metadata(session.id)?.projectId === projectId && !session.workflowExecution,
    )
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'running' ? -1 : 1
      return right.updatedAt.getTime() - left.updatedAt.getTime()
    })[0]
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
    return c.json(
      {
        code: error.code,
        error: error.message,
        recoverable: true,
      },
      409,
    )
  }
  return tracedRouteError(c, route, error)
}

async function getProjectRuntimeEvents(input: {
  sessionId: string
  workspacePath: string
  dashboardDataRoot?: string
  beeGameSessions: BeeGameSessionManager
}): Promise<BeeGameEvent[]> {
  let events: BeeGameEvent[]
  try {
    events = input.beeGameSessions.events(input.sessionId)
  } catch (err) {
    if (toErrorMessage(err) !== 'Session not found') throw err
    const transcript = await readSessionTranscriptFromDisk(
      input.sessionId,
      input.workspacePath,
    )
    events = closeInterruptedTranscriptTurns(input.sessionId, transcript).map(
      event =>
        formatBeeGameEventForDisplay({
          ...event,
          sessionId: event.sessionId || input.sessionId,
          createdAt: new Date(event.createdAt),
        }),
    )
  }
  return events.sort((left, right) => {
    const time = left.createdAt.getTime() - right.createdAt.getTime()
    return time !== 0 ? time : left.id - right.id
  })
}

const projectChatReads = new WeakMap<BeeGameSessionManager, Map<string, Promise<BeeGameEvent[]>>>()

function getProjectChatTimelineEvents(input: {
  after?: number
  sessionId: string
  workspacePath: string
  dashboardDataRoot?: string
  beeGameSessions: BeeGameSessionManager
}): Promise<BeeGameEvent[]> {
  let reads = projectChatReads.get(input.beeGameSessions)
  if (!reads) { reads = new Map(); projectChatReads.set(input.beeGameSessions, reads) }
  const key = `${resolve(input.workspacePath)}:${input.sessionId}:${input.after ?? 0}`
  const active = reads.get(key)
  if (active) return active
  // Concurrent history/SSE clients share one reconciliation, not N full merges.
  const pending = collectProjectChatTimelineEvents(input).finally(() => { reads.delete(key) })
  reads.set(key, pending)
  return pending
}

async function collectProjectChatTimelineEvents(input: {
  after?: number
  sessionId: string
  workspacePath: string
  dashboardDataRoot?: string
  beeGameSessions: BeeGameSessionManager
}): Promise<BeeGameEvent[]> {
  const mainEvents = await getProjectRuntimeEvents(input)
  const timeline = await appendProjectChatTimeline(input.workspacePath, mainEvents, input.after)
  const savedLanguage = mainEvents.find(event => event.type === 'session.started')?.payload?.language
  const language = input.beeGameSessions.language(input.sessionId) ??
    (isBeeGameSessionLanguage(savedLanguage) ? savedLanguage : undefined)
  // Existing journal rows retain their original text. Apply today's display
  // formatting after reading them, without rewriting durable evidence/cursors.
  return timeline.map(event => formatBeeGameEventForDisplay(event, language))
}

// Keep this below Bun's/default reverse-proxy idle window. Otherwise a quiet
// agent period closes Chat's event stream before its first heartbeat and the
// UI only catches up after a transcript refresh.
const PROJECT_EVENTS_SSE_HEARTBEAT_INTERVAL_MS = 5_000
const PROJECT_EVENTS_SSE_MAX_CONNECTION_MS = 25_000
// Direct CLI stages can outlive an API-process restart. Their durable trace is
// therefore also a live source, not merely a refresh-time recovery source.
const PROJECT_EVENTS_SSE_TIMELINE_RECONCILE_INTERVAL_MS = 750

export function createProjectEventsSseStream(input: {
  request: Request
  userId: string
  projectId: string
  sessionId: string
  workspacePath: string
  after: number
  recoveredFromTranscript: boolean
  dashboardDataRoot?: string
  beeGameSessions: BeeGameSessionManager
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const signal = input.request.signal
  let cancelConnection = () => {}

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let wake: (() => void) | undefined
      cancelConnection = () => { closed = true; wake?.() }
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // The client may have cancelled the stream concurrently.
        }
      }
      const fail = (error: unknown) => {
        if (closed) return
        closed = true
        try {
          controller.error(error)
        } catch {
          // The client may have cancelled the stream concurrently.
        }
      }
      const onAbort = () => close()
      signal.addEventListener('abort', onAbort, { once: true })

      void (async () => {
        let after = input.after
        let lastHeartbeatAt = Date.now()
        const deadline = Date.now() + PROJECT_EVENTS_SSE_MAX_CONNECTION_MS
        let pendingEvents: BeeGameEvent[] = []
        const unsubscribe = input.beeGameSessions.subscribeProjectEvents(
          {
            userId: input.userId,
            projectId: input.projectId,
            workspacePath: input.workspacePath,
          },
          event => {
            pendingEvents.push(event)
            wake?.()
            wake = undefined
          },
        )
        const emitEvents = (events: BeeGameEvent[]) => {
          if (closed || signal.aborted) return
          const unseen = projectChatEventsAfter(events, after)
          if (unseen.length === 0) return
          after = unseen[unseen.length - 1]!.id
          const payload = JSON.stringify({
            sessionId: input.sessionId,
            workspacePath: input.workspacePath,
            events: unseen,
            recoveredFromTranscript: input.recoveredFromTranscript,
          })
          controller.enqueue(
            encoder.encode(
              `id: ${after}\nevent: project-events\ndata: ${payload}\n\n`,
            ),
          )
          lastHeartbeatAt = Date.now()
        }
        const reconcileTimeline = async () => {
          const timeline = await getProjectChatTimelineEvents({
            after,
            sessionId: input.sessionId,
            workspacePath: input.workspacePath,
            dashboardDataRoot: input.dashboardDataRoot,
            beeGameSessions: input.beeGameSessions,
          })
          emitEvents(timeline)
        }
        try {
          await reconcileTimeline()
          while (!closed && !signal.aborted && Date.now() < deadline) {
            if (pendingEvents.length > 0) {
              const events = pendingEvents
              pendingEvents = []
              emitEvents(await appendProjectChatTimeline(input.workspacePath, events, after))
              continue
            }
            const timeUntilDeadline = deadline - Date.now()
            const timeUntilHeartbeat =
              PROJECT_EVENTS_SSE_HEARTBEAT_INTERVAL_MS -
              (Date.now() - lastHeartbeatAt)
            const waitMs = Math.max(
              1,
              Math.min(
                timeUntilDeadline,
                timeUntilHeartbeat,
                PROJECT_EVENTS_SSE_TIMELINE_RECONCILE_INTERVAL_MS,
              ),
            )
            await new Promise<void>(resolve => {
              let timer: ReturnType<typeof setTimeout>
              const finish = () => {
                clearTimeout(timer)
                signal.removeEventListener('abort', finish)
                if (wake === finish) wake = undefined
                resolve()
              }
              wake = finish
              timer = setTimeout(finish, waitMs)
              signal.addEventListener('abort', finish, { once: true })
              if (signal.aborted) finish()
            })
            if (
              !closed &&
              !signal.aborted &&
              Date.now() - lastHeartbeatAt >=
                PROJECT_EVENTS_SSE_HEARTBEAT_INTERVAL_MS
            ) {
              controller.enqueue(encoder.encode(': heartbeat\n\n'))
              lastHeartbeatAt = Date.now()
            }
            if (!closed && !signal.aborted) await reconcileTimeline()
          }
          close()
        } catch (error) {
          fail(error)
        } finally {
          unsubscribe?.()
          wake = undefined
          signal.removeEventListener('abort', onAbort)
        }
      })()
    },
    cancel() { cancelConnection() },
  })
}

function getProjectRuntimeSnapshot(input: {
  sessionId: string
  workspacePath: string
  beeGameSessions: BeeGameSessionManager
}): BeeGameRuntimeSnapshot | undefined {
  try {
    return input.beeGameSessions.runtimeSnapshot(
      input.sessionId,
      input.workspacePath,
    )
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
    next_action: 'Ready for next request',
    context: null,
    project_target: null,
    build_report: null,
    acceptance: { status: 'not_run' },
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
}): Promise<
  | {
      sessionId: string
      workspacePath: string
      live?: BeeGameSession
      latest?: Awaited<
        ReturnType<DashboardRepository['listProjectSessions']>
      >[number]
    }
  | undefined
> {
  const latest = await getLatestProjectSessionMetadata(input)
  const live = findLiveProjectSession(
    input.beeGameSessions,
    input.user.id,
    input.project.id,
  )
  const sessionId =
    live?.id ||
    latest?.id ||
    inferBeeGameSessionIdFromProjectId(input.project.id)
  const workspacePath =
    live?.cwd || latest?.workspacePath || input.project.root_path
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

/**
 * Resolve a project-owned workspace for read-only artifact operations without
 * inventing a session identity. A project can have durable files before a
 * BeeGame session exists, so artifact routes must not require session recovery.
 */
async function resolveBeeGameProjectArtifactReference(input: {
  request: Request
  user: BeeGameUserContext
  project: BeeGameProjectMetadata
  defaultWorkspacePath?: string
  beeGameSessions: BeeGameSessionManager
  dashboardRepository: DashboardRepository
}): Promise<
  | {
      workspacePath: string
      sessionId?: string
      expectedIdentity: ProjectArtifactIdentity
    }
  | undefined
> {
  const latest = await getLatestProjectSessionMetadata(input)
  const live = findLiveProjectSession(
    input.beeGameSessions,
    input.user.id,
    input.project.id,
  )
  const workspacePath = live?.cwd || latest?.workspacePath || input.project.root_path
  if (!workspacePath) return undefined
  const expectedIdentity: ProjectArtifactIdentity = {
    ownerId: input.user.id,
    projectId: input.project.id,
  }
  const resolvedWorkspacePath = await resolveOwnedProjectArtifactWorkspace(
    workspacePath,
    input.defaultWorkspacePath,
    input.user.id,
  )
  return {
    workspacePath: resolvedWorkspacePath,
    ...(live?.id || latest?.id
      ? { sessionId: live?.id || latest?.id }
      : {}),
    expectedIdentity,
  }
}

/**
 * Resolve a project artifact workspace against the authenticated user's
 * canonical root. The metadata store is user-scoped in local mode, but the
 * persisted root path is still untrusted input; realpath validation prevents
 * a foreign user directory or symlink target from becoming an artifact read
 * boundary.
 */
async function resolveOwnedProjectArtifactWorkspace(
  workspacePath: string,
  defaultWorkspacePath: string | undefined,
  ownerId: string,
): Promise<string> {
  const resolvedWorkspacePath = await resolveSessionWorkspacePath(
    workspacePath,
    defaultWorkspacePath,
  )
  const defaultRoot = resolve(
    await getDefaultWorkspacePath({ defaultWorkspacePath }),
  )
  const ownerRoot = resolve(getUserDashboardDataRoot(defaultRoot, ownerId))
  const [canonicalOwnerRoot, canonicalWorkspacePath] = await Promise.all([
    realpath(ownerRoot),
    realpath(resolvedWorkspacePath),
  ])
  const ownerRelativeWorkspace = relative(
    canonicalOwnerRoot,
    canonicalWorkspacePath,
  )
  if (
    ownerRelativeWorkspace === '' ||
    !isPathInsideWorkspace(canonicalOwnerRoot, canonicalWorkspacePath)
  ) {
    throw new Error('Workspace path must stay inside the current user workspace')
  }
  // Do not accept a project root that is itself a symlink (or has a symlink
  // component). The configured Projects root itself may be a symlink, so
  // compare the canonical candidate with the path obtained by applying the
  // textual owner-relative path to the canonical owner root.
  const expectedCanonicalWorkspacePath = resolve(
    canonicalOwnerRoot,
    relative(ownerRoot, resolvedWorkspacePath),
  )
  if (canonicalWorkspacePath !== expectedCanonicalWorkspacePath) {
    throw new Error('Workspace path must not contain symlink components')
  }
  return canonicalWorkspacePath
}

function pendingBeeGamePermissionToEvent(
  permission: BeeGamePendingPermission,
): BeeGameEvent {
  return {
    id: 0,
    sessionId: permission.sessionId,
    type: 'permission.requested',
    text: permission.message,
    payload: {
      type: 'permission.requested',
      toolUseID: permission.toolUseID,
      toolName: permission.toolName,
      input: permission.input,
    },
    createdAt: permission.requestedAt,
  }
}

function pendingBeeGamePermissionRequestToJson(
  permission: BeeGamePendingPermission,
): JsonObject {
  return {
    id: permission.toolUseID,
    session_id: permission.sessionId,
    event_id: 0,
    tool_name: permission.toolName,
    message: permission.message,
    created_at: normalizeBeeGameCreatedAt(permission.requestedAt),
    input: permission.input,
  }
}

function deriveBeeGameRuntimeStatus(
  events: BeeGameEvent[],
  pending: BeeGameEvent[],
  recoveredFromTranscript = false,
  activeSubagents: string[] = [],
): {
  phase: string
  nextAction: string
  updatedAt: string
  activeAgents: string[]
  activeSubagents: string[]
  agentStatus: string
} {
  const latest = events.at(-1)
  const updatedAt =
    normalizeBeeGameCreatedAt(latest?.createdAt) || new Date().toISOString()
  if (pending.length > 0) {
    return {
      phase: 'waiting_approval',
      nextAction: 'Review BeeGame permission request',
      updatedAt,
      activeAgents: ['beegame-agent'],
      activeSubagents,
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
          activeSubagents: [],
          agentStatus: 'idle',
        }
      : {
          phase: 'running',
          nextAction: 'BeeGame Studio is processing',
          updatedAt,
          activeAgents: ['beegame-agent'],
          activeSubagents,
          agentStatus: 'working',
        }
  }
  // Accounting and host evidence can arrive after a terminal event. They do
  // not turn a failed native turn into an idle, successful-looking project.
  const outcome = events.findLast(event =>
    ['turn.started', 'turn.completed', 'turn.empty', 'turn.failed',
      'session.started', 'session.stopped', 'session.failed'].includes(event.type) &&
    !(event.type === 'session.stopped' && event.payload?.reason === 'agent_goal_settled'))
  if (outcome?.type === 'turn.failed' || outcome?.type === 'session.failed') {
    return {
      phase: 'paused',
      nextAction: outcome.text || 'BeeGame turn failed',
      updatedAt,
      activeAgents: [],
      activeSubagents,
      agentStatus: 'failed',
    }
  }
  if (activeSubagents.length > 0) {
    return {
      phase: 'running',
      nextAction: 'BeeGame Studio subagents are processing',
      updatedAt,
      activeAgents: ['beegame-agent'],
      activeSubagents,
      agentStatus: 'working',
    }
  }
  return {
    phase: 'idle',
    nextAction: 'Ready for next request',
    updatedAt,
    activeAgents: [],
    activeSubagents: [],
    agentStatus: 'idle',
  }
}

function getActiveBeeGameTurn(events: BeeGameEvent[]): string {
  const ended = new Set(
    events
      .filter(
        event =>
          event.type === 'turn.completed' ||
          event.type === 'turn.empty' ||
          event.type === 'turn.failed' ||
          event.type === 'session.stopped' ||
          event.type === 'session.failed',
      )
      .map(event => event.turnId)
      .filter(Boolean),
  )
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    // Session-level termination closes every open turn, even when the stop
    // event itself has no turnId. A later turn.started can still become active.
    if (event?.type === 'session.stopped' || event?.type === 'session.failed')
      return ''
    if (
      event?.type === 'turn.started' &&
      event.turnId &&
      !ended.has(event.turnId)
    ) {
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
  const toolUseCount = events.filter(event =>
    event.type.startsWith('tool.'),
  ).length
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
      cached_input_tokens:
        usage.cache_read_tokens + usage.cache_creation_tokens,
      output_tokens: usage.completion_tokens,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
      total_tokens: usage.total_tokens,
      role_tokens: snapshot?.roleTokens ?? {
        mainAgent: usage.total_tokens,
        otherSubagents: 0,
      },
    },
    counters: {
      eventCount: events.length,
      toolUseCount,
    },
  }
}

function previewSnapshotToProjectBuildReport(
  preview: BeeGamePreviewSnapshot,
): JsonObject | null {
  if (preview.status === 'idle' && !preview.url) return null
  const running = preview.status === 'running' && Boolean(preview.url)
  const unavailable =
    preview.status === 'failed' || preview.status === 'unsupported'
  return {
    status: running ? 'passed' : unavailable ? 'failed' : preview.status,
    entrypoint: preview.entrypoint || '',
    report_path: '',
    build_url: running ? preview.url : '',
    agents: ['dashboard-preview'],
    generated_paths: [],
    checks: [
      {
        name: preview.script || 'preview',
        status: running ? 'passed' : preview.status,
        detail: preview.message || '',
        path: '',
      },
    ],
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
  const resolved = resolve(path)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
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
    issuePreviewUrl: (url: string, sessionId: string, userId: string) => string
    revokePreviewCapability: (sessionId: string) => void
    listDeploymentRecords?: (
      request: Request,
      sessionId: string,
    ) => Promise<BeeGameDeploymentRecord[] | undefined>
    persistDeploymentRecord?: (
      request: Request,
      record: BeeGameDeploymentRecord,
    ) => Promise<BeeGameDeploymentRecord | undefined>
    modelConfigExists: (
      request: Request,
      user: BeeGameUserContext,
      id: string,
    ) => Promise<boolean>
    listModelConfigs: (
      request: Request,
      user: BeeGameUserContext,
    ) => Promise<Array<{ id: string; isDefault?: boolean }>>
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
  ): Promise<string> => {
    const metadata = beeGameSessions.metadata(sessionId)
    if (!metadata?.workspacePath || checkSession(request, sessionId))
      throw new Error('Session not found')
    return metadata.workspacePath
  }
  app.get(basePath, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(beeGameSessions.list(options.getCurrentUser(c.req.raw).id))
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
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const after = Number.parseInt(c.req.query('after') || '0', 10)
      beeGameSessions.updateAuthToken(
        c.req.param('id'),
        options.getAuthToken(c.req.raw),
      )
      return c.json(beeGameSessions.events(c.req.param('id'), after))
    } catch (err) {
      return publicSessionRouteError(c, 'beegame-session.events', err, 404, [
        'Session not found',
      ])
    }
  })

  app.get(`${basePath}/:id/runtime-snapshot`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
      )
      return c.json(
        beeGameSessions.runtimeSnapshot(c.req.param('id'), workspacePath),
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
    const chatHistoryView =
      c.req.header('x-beegame-transcript-view') === 'chat' ||
      c.req.query('view') === 'chat'
    const pagination =
      c.req.header('x-beegame-transcript-pagination') === 'cursor'
        ? {
            limit: parseTranscriptPageLimit(c.req.query('limit')),
            beforeId: parsePositiveInteger(c.req.query('before')),
          }
        : undefined
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const transcript = beeGameSessions.transcript(c.req.param('id'))
      const visibleTranscript = chatHistoryView
        ? compactTranscriptForChatHistory(transcript)
        : transcript
      return c.json(
        pagination
          ? paginateTranscriptEvents(visibleTranscript, pagination)
          : visibleTranscript,
      )
    } catch (err) {
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
      const sessionId = c.req.param('id')
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        sessionId,
      )
      if (!beeGameSessions.get(sessionId)) {
        return c.json(await readProjectArtifactConsistently(
          workspacePath,
          () => readBeeGameProjectArtifact(workspacePath, path),
        ))
      }
      return c.json(await readProjectArtifactConsistently(
        workspacePath,
        () => beeGameSessions.readArtifact(sessionId, path),
      ))
    } catch (err) {
      const message = toErrorMessage(err)
      return publicSessionRouteError(
        c,
        'beegame-session.artifacts',
        err,
        message === 'Artifact path must stay inside the session workspace'
          ? 400
          : 404,
        [
          'Artifact path must stay inside the session workspace',
          'Session not found',
        ],
      )
    }
  })

  app.get(`${basePath}/:id/artifact-index`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    try {
      const sessionId = c.req.param('id')
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        sessionId,
      )
      return c.json(await readProjectArtifactConsistently(
        workspacePath,
        () => discoverBeeGameProjectArtifacts(workspacePath),
      ))
    } catch (err) {
      return publicSessionRouteError(
        c,
        'beegame-session.artifact-index',
        err,
        400,
        [
          'Session not found',
          'Workspace path must stay inside the current user workspace',
        ],
      )
    }
  })

  app.get(`${basePath}/:id/package`, async c => {
    const forbidden = check(c.req.raw, ROUTE_PERMISSION.projectExport)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const sessionId = c.req.param('id')
      const metadata = beeGameSessions.metadata(sessionId)
      const workspacePath = await getSessionWorkspacePath(c.req.raw, sessionId)
      const projectPackage = await readProjectArtifactConsistently(
        workspacePath,
        () => beeGameSessions.createProjectPackage(
          sessionId,
          workspacePath,
          metadata?.projectId
            ? { ownerId: metadata.userId, projectId: metadata.projectId }
            : undefined,
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
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
      )
      const sessionId = c.req.param('id')
      c.header(
        'set-cookie',
        options.issuePreviewCookie(
          c.req.raw,
          sessionId,
          options.getCurrentUser(c.req.raw).id,
        ),
      )
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
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
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
      c.header(
        'set-cookie',
        options.issuePreviewCookie(
          c.req.raw,
          c.req.param('id'),
          options.getCurrentUser(c.req.raw).id,
        ),
      )
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
    try {
      const workspacePath = await getSessionWorkspacePath(
        c.req.raw,
        c.req.param('id'),
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
      c.header(
        'set-cookie',
        options.issuePreviewCookie(
          c.req.raw,
          c.req.param('id'),
          options.getCurrentUser(c.req.raw).id,
        ),
      )
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
        const records = persisted ?? (await beeGameDeployments.list(sessionId))
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
      const attachments =
        body.attachments === undefined
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
      const clientMessageId =
        typeof body.clientMessageId === 'string'
          ? body.clientMessageId
          : typeof body.client_message_id === 'string'
            ? body.client_message_id
            : undefined
      const supersedesMessageId =
        typeof body.supersedesMessageId === 'string'
          ? body.supersedesMessageId
          : typeof body.supersedes_message_id === 'string'
            ? body.supersedes_message_id
            : undefined
      const session = beeGameSessions.get(c.req.param('id'))
      const metadata = session
        ? beeGameSessions.metadata(session.id)
        : undefined
      if (metadata?.projectId)
        return c.json({ error: 'Project chat uses the V3 project message endpoint', code: 'workflow-v3-required' }, 409)
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
      if (err instanceof BeeGameUploadPolicyError)
        return uploadPolicyResponse(err)
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
      return c.json(
        {
          error:
            'Persistent runtime permissions are not available through the Web API',
        },
        400,
      )
    }
    const permissionScope = body.scope === 'session' ? 'session' : 'once'
    try {
      const resolved = beeGameSessions.resolvePermission(
        c.req.param('id'),
        c.req.param('toolUseID'),
        {
          behavior: decision,
          scope: permissionScope,
          remember: false,
          answers: body.answers,
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
            scope: permissionScope,
            remember: body.remember === true,
          },
        })
      } catch (auditErr) {
        console.warn(
          '[BeeGame] Failed to append permission audit event:',
          toErrorMessage(auditErr),
        )
      }
      return c.json(resolved)
    } catch (err) {
      if (err instanceof UserQuestionValidationError) return c.json({ error: err.message }, 400)
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
      beeGamePreviews.stop(c.req.param('id'), sessionMetadata.workspacePath)
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
          const deletedArtifactPaths =
            await deleteSessionArtifactsFromTranscript(
              c.req.param('id'),
              workspacePath,
            ).catch((): string[] => [])
          const deletedWorkspacePath = await deleteWorkspaceDirectoryIfSafe(
            workspacePath,
            dashboardDataRoot,
          )
          if (deletedWorkspacePath)
            deletedArtifactPaths.push(deletedWorkspacePath)
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

export function paginateTranscriptEvents<T extends { id: number; createdAt: Date | string }>(
  events: T[],
  options: { limit: number; beforeId?: number },
): {
  events: T[]
  page: { hasMore: boolean; nextBeforeId: number | null }
} {
  // Source transcript IDs may restart in each file. The project journal gives
  // every event a unique ID, but its append order is not necessarily its chat
  // time when a delayed transcript is reconciled. Use time for presentation and
  // the project ID only to break equal timestamps and locate the page cursor.
  const ordered = [...events].sort((a, b) => {
    const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return time || a.id - b.id
  })
  const beforeIndex = options.beforeId === undefined
    ? ordered.length
    : ordered.findIndex(event => event.id === options.beforeId)
  const eligible =
    options.beforeId === undefined
      ? ordered
      : ordered.slice(0, Math.max(0, beforeIndex))
  const pageEvents = eligible.slice(
    Math.max(0, eligible.length - options.limit),
  )
  return {
    events: pageEvents,
    page: {
      hasMore: eligible.length > pageEvents.length,
      nextBeforeId: pageEvents[0]?.id ?? null,
    },
  }
}

export function findTodoWriteEvents<
  T extends {
    type: BeeGameEvent['type']
    payload?: BeeGameEvent['payload']
  },
>(events: T[]): T[] {
  return events.filter(event => {
    if (
      event.type !== 'tool.started' &&
      event.type !== 'tool.progress' &&
      event.type !== 'tool.completed' &&
      event.type !== 'tool.failed'
    ) return false
    const toolName =
      typeof event.payload?.toolName === 'string'
        ? event.payload.toolName.trim().toLowerCase()
        : ''
    if (toolName !== 'todowrite' && toolName !== 'todo_write') return false
    const input = event.payload?.input
    return Boolean(
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Array.isArray((input as { todos?: unknown }).todos),
    )
  })
}

function parseTranscriptPageLimit(value: string | undefined): number {
  const parsed = parsePositiveInteger(value) ?? 300
  return Math.min(500, Math.max(50, parsed))
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function compactTranscriptForChatHistory<
  T extends {
    id: number
    sessionId?: string
    turnId?: string
    type: BeeGameEvent['type']
    text: string
    createdAt: BeeGameEvent['createdAt']
    payload?: BeeGameEvent['payload']
  },
>(events: T[]): T[] {
  const result: T[] = []
  const positions = new Map<string, number>()
  for (const event of events) {
    const payload: NonNullable<BeeGameEvent['payload']> = event.payload ?? { type: event.type }
    if (event.type === 'system.status' &&
      !['task_started', 'task_progress', 'task_notification', 'compact_boundary', 'delivery_phase', 'delivery_error'].includes(String(payload.subtype)) &&
      !(payload.subtype === 'status' && payload.status === 'compacting')) continue
    const scope = `${event.sessionId}:${payload.parentToolUseID ?? payload.parent_tool_use_id ?? ''}`
    const body = payload.message as { id?: string } | undefined
    const messageId = payload.assistantBlockId ?? payload.messageId ?? body?.id
    const thinking = event.type === 'assistant.thinking'
    const text = event.type === 'assistant.partial' || event.type === 'assistant.message'
    const tool = ['tool.started', 'tool.progress', 'tool.completed', 'tool.failed'].includes(event.type)
    const key = thinking
      ? `thinking:${scope}:${payload.thinkingBlockId ?? event.turnId ?? 'default'}:${payload.thinkingStartedAt ?? ''}`
      : text && messageId ? `text:${scope}:${messageId}`
      : tool && payload.toolUseID ? `tool:${scope}:${payload.toolUseID}` : undefined
    const position = key ? positions.get(key) : undefined
    const previous = position === undefined ? undefined : result[position]
    // A terminal snapshot owns its block. Delayed checkpoints cannot reopen it.
    if (previous && text && previous.type === 'assistant.message' && event.type === 'assistant.partial') continue
    if (previous && thinking && previous.payload?.status === 'ended' && payload.status !== 'ended') continue
    const content = thinking && event.text === 'Thinking' ? '' : event.text
    const snapshot = payload.contentMode === 'snapshot' || event.type === 'assistant.message'
    const mergedText = thinking || text
      ? thinking && !content ? previous?.text ?? '' : snapshot ? content : (previous?.text ?? '') + content
      : event.text
    const merged = {
      ...event,
      text: mergedText,
      payload: {
        ...(previous?.payload ?? {}),
        ...payload,
        type: event.type,
        sourceSequence: previous?.payload?.sourceSequence ?? event.id,
        ...(thinking || text ? { contentMode: 'snapshot' } : {}),
        ...(thinking ? {
          ...(previous?.payload?.status === 'ended' ? { status: 'ended' } : {}),
          thinkingStartedAt: previous?.payload?.thinkingStartedAt ?? payload.thinkingStartedAt ??
            new Date(event.createdAt).toISOString(),
        } : {}),
        ...(tool ? { toolStartedAt: previous?.payload?.toolStartedAt ??
          (event.type === 'tool.started' ? new Date(event.createdAt).toISOString() : undefined) } : {}),
      },
    } as T
    if (position === undefined) {
      if (key) positions.set(key, result.length)
      result.push(merged)
    } else result[position] = merged
  }
  // IDs remain cursor positions; sourceSequence retains first appearance order.
  return result
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
  return events.some(
    event =>
      event.turnId === turnId &&
      (event.type === 'turn.completed' ||
        event.type === 'turn.empty' ||
        event.type === 'turn.failed' ||
        event.type === 'session.stopped' ||
        event.type === 'session.failed'),
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
  const { documentLanguage, gameUserVisibleLanguage, agentResponseLanguage } =
    resolveCanonicalConfirmedLanguages(brief, language)
  const resourceLibraryUsage = resolveConfirmedResourceLibraryUsage(brief)
  const orientation = resolveConfirmedOrientation(brief)
  const confirmedBrief = JSON.stringify(
    {
      kind: 'confirmed_build_brief',
      document_language: documentLanguage,
      game_user_visible_language: gameUserVisibleLanguage,
      agent_response_language: agentResponseLanguage,
      idea: typeof brief.idea === 'string' ? brief.idea.trim() : '',
      default_first_release_scope: {
        target: 'small complete playable version',
        content: 'one working core loop with only representative content; usually one or two levels if levels apply',
        defer: 'unrequested extra levels and modes; do not defer the audiovisual feedback or usability needed by the agreed core loop',
      },
      selected_option: toCanonicalConfirmedOption(brief.option),
      settings: { ...(isObject(brief.settings) ? brief.settings : {}), ...(orientation ? { orientation } : {}) },
      confirmed_gdd: brief.confirmedGdd ?? null,
      build_source: brief.buildSource ?? null,
      analysis_id: brief.analysisId ?? null,
      creation_mode: brief.creationMode === 'blueprint' ? 'blueprint' : 'creative',
      reference_files: brief.referenceFiles ?? [],
      resource_library_usage: resourceLibraryUsage,
    },
    null,
    2,
  )
  return [
    'Start the confirmed game project below. The current milestone and its deliverables are supplied in the project state for this turn. When that milestone is ready, finish the turn; the next milestone will be handed to this same session.',
    '',
    `Write all human-readable project documentation in ${getDocumentLanguageName(documentLanguage)}.`,
    `Write all player-visible game text in ${getDocumentLanguageName(gameUserVisibleLanguage)}.`,
    `Respond to the user in ${getDocumentLanguageName(agentResponseLanguage)}.`,
    'Treat response language, document language, and player-visible game language as separate confirmed requirements even when they have the same value. Keep code identifiers, APIs, commands, file paths, package names, and unavoidable technical tokens unchanged.',
    '',
    'Use the confirmed brief as the source of truth. Keep the project documents and resulting game consistent with its explicit choices and constraints.',
    'Screen games support the confirmed Landscape or Portrait direction only. Preserve any user-confirmed dimensions; otherwise UI_UX_SPEC owns reference resolution, minimum usable host dimensions and layout/adaptation, coordinated with LEVEL_SCENE_DESIGN world/framing requirements. GDD records the confirmed orientation and core gameplay, not invented host dimensions or an adaptation method. Other directions or insufficient space show a rotation/size message instead of another composition or unusable whole-screen shrinking. Input methods are independent: Touch does not imply Portrait and Landscape does not imply mouse-only. VR/AR world-space interfaces use their confirmed spatial requirements.',
    'Use default_first_release_scope for content breadth the user did not specify. Preserve explicit user requirements; a model-suggested option or scope does not by itself authorize an expansive first release.',
    '',
    'Confirmed brief:',
    confirmedBrief,
  ].join('\n')
}

function resolveConfirmedOrientation(brief: JsonObject): 'Landscape' | 'Portrait' | undefined {
  const settings = isObject(brief.settings) ? brief.settings : undefined
  if (settings?.dimension === 'VR' || settings?.dimension === 'AR') return undefined
  const value = settings?.orientation ?? brief.orientation
  if (value !== 'Landscape' && value !== 'Portrait') throw new Error('Confirmed brief must explicitly select Landscape or Portrait orientation')
  return value
}

function extractConfirmedBriefContext(prompt: string): string {
  const marker = '\nConfirmed brief:\n'
  const markerIndex = prompt.lastIndexOf(marker)
  if (markerIndex < 0)
    throw new Error('Confirmed brief prompt is missing canonical context')
  const context = prompt.slice(markerIndex + marker.length).trim()
  if (!context)
    throw new Error('Confirmed brief prompt has empty canonical context')
  return context
}

function resolveConfirmedResourceLibraryUsage(
  brief: JsonObject,
): ResourceLibraryUsage {
  const settings = isObject(brief.settings) ? brief.settings : undefined
  const value =
    settings?.resourceLibraryUsage ??
    settings?.resource_library_usage ??
    brief.resourceLibraryUsage ??
    brief.resource_library_usage
  if (
    typeof value !== 'string' ||
    !(RESOURCE_LIBRARY_USAGE as readonly string[]).includes(value)
  ) {
    throw new Error(
      'Confirmed brief must explicitly select resourceLibraryUsage',
    )
  }
  return value as ResourceLibraryUsage
}

function resolveCanonicalConfirmedLanguages(
  brief: JsonObject,
  selectedLanguage?: BeeGameSessionLanguage,
): {
  documentLanguage: BeeGameSessionLanguage
  gameUserVisibleLanguage: BeeGameSessionLanguage
  agentResponseLanguage: BeeGameSessionLanguage
} {
  return {
    documentLanguage: resolveConfirmedBriefLanguage(
      brief.documentLanguage ?? brief.document_language,
      selectedLanguage,
      'documentLanguage',
    ),
    gameUserVisibleLanguage: resolveConfirmedBriefLanguage(
      brief.gameUserVisibleLanguage ?? brief.game_user_visible_language,
      selectedLanguage,
      'gameUserVisibleLanguage',
    ),
    agentResponseLanguage: resolveConfirmedBriefLanguage(
      brief.agentResponseLanguage ?? brief.agent_response_language,
      selectedLanguage,
      'agentResponseLanguage',
    ),
  }
}

function resolveConfirmedBriefLanguage(
  value: unknown,
  fallback: BeeGameSessionLanguage | undefined,
  field: string,
): BeeGameSessionLanguage {
  if (value !== undefined && value !== null) {
    if (!isBeeGameSessionLanguage(value)) {
      throw new Error(`Confirmed brief has an invalid ${field}`)
    }
    return value
  }
  if (fallback) return fallback
  throw new Error(`Confirmed brief must explicitly select ${field}`)
}

function toCanonicalConfirmedOption(value: unknown): JsonObject | null {
  if (!isObject(value)) return null
  const gameplay =
    typeof value.gameplay === 'string' ? value.gameplay.trim() : ''
  const pitch = typeof value.pitch === 'string' ? value.pitch.trim() : ''
  return {
    ...(typeof value.id === 'string' && value.id.trim()
      ? { id: value.id.trim() }
      : {}),
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

function parseResourceSemanticRuntimeEnv(
  value: unknown,
): Record<string, string> | undefined {
  if (!isObject(value)) return undefined
  const runtimeEnv: Record<string, string> = {}
  for (const [key, raw] of Object.entries(normalizeRuntimeEnvironment(value as Record<string, string>))) {
    if (
      !RESOURCE_MODEL_RUNTIME_KEYS.has(key) ||
      typeof raw !== 'string' ||
      !raw.trim()
    )
      continue
    runtimeEnv[key] = raw
  }
  return Object.keys(runtimeEnv).length ? runtimeEnv : undefined
}

type ResourceSemanticBatchItemInput = {
  elementId: string
  attempt: number
  projection: Record<string, unknown>
}

function parseResourceSemanticBatchItems(
  value: unknown,
): ResourceSemanticBatchItemInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return []
  const items: ResourceSemanticBatchItemInput[] = []
  for (const raw of value) {
    if (!isObject(raw)) return []
    const elementId =
      typeof raw.elementId === 'string' ? raw.elementId.trim() : ''
    const attempt =
      typeof raw.attempt === 'number' &&
      Number.isSafeInteger(raw.attempt) &&
      raw.attempt > 0
        ? raw.attempt
        : 0
    if (
      !elementId ||
      !attempt ||
      !isObject(raw.projection) ||
      raw.projection.elementId !== elementId
    )
      return []
    if (items.some(item => item.elementId === elementId)) return []
    items.push({ elementId, attempt, projection: raw.projection })
  }
  return items
}

function parseResourceSemanticVisualInput(
  value: unknown,
): ResourceSemanticVisualInput {
  if (
    !isObject(value) ||
    (value.mode !== 'individual' && value.mode !== 'atlas')
  ) {
    throw new Error('Resource semantic visual input mode is required')
  }
  if (value.mode === 'individual') {
    if (
      !Array.isArray(value.images) ||
      value.images.length < 1 ||
      value.images.length > 2
    ) {
      throw new Error(
        'Resource semantic individual visual input requires one or two images',
      )
    }
    return {
      mode: 'individual',
      images: value.images.map((raw, index) => {
        if (
          !isObject(raw) ||
          typeof raw.elementId !== 'string' ||
          !raw.elementId.trim() ||
          raw.mediaType !== 'image/jpeg' ||
          typeof raw.dataBase64 !== 'string' ||
          !raw.dataBase64.trim()
        ) {
          throw new Error(
            `Resource semantic individual image ${index + 1} is invalid`,
          )
        }
        return {
          elementId: raw.elementId.trim(),
          mediaType: 'image/jpeg',
          dataBase64: raw.dataBase64,
        }
      }),
    }
  }
  if (
    !isObject(value.image) ||
    value.image.mediaType !== 'image/jpeg' ||
    typeof value.image.dataBase64 !== 'string' ||
    !value.image.dataBase64.trim() ||
    !Array.isArray(value.cells)
  ) {
    throw new Error('Resource semantic Atlas visual input is invalid')
  }
  return {
    mode: 'atlas',
    image: { mediaType: 'image/jpeg', dataBase64: value.image.dataBase64 },
    cells: value.cells.map((raw, index) => {
      if (
        !isObject(raw) ||
        raw.ordinal !== index ||
        typeof raw.elementId !== 'string' ||
        !raw.elementId.trim()
      ) {
        throw new Error(`Resource semantic Atlas cell ${index + 1} is invalid`)
      }
      return { ordinal: index, elementId: raw.elementId.trim() }
    }),
  }
}

function parseResourceSemanticModelType(
  value: unknown,
): RuntimeModelConfig['modelType'] | undefined {
  return value === 'anthropic' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'grok'
    ? value
    : undefined
}

async function readJson(
  request: Request,
  maxBytes?: number,
): Promise<JsonObject> {
  const value =
    maxBytes === undefined
      ? await request.json()
      : (JSON.parse(
          new TextDecoder().decode(await readRequestBytes(request, maxBytes)),
        ) as unknown)
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

function getBeeGameClientRequestId(body: JsonObject): string | undefined {
  const value =
    typeof body.clientRequestId === 'string'
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
  const transport =
    typeof body.transport === 'string' ? body.transport : 'stdio'
  if (!isMcpServerTransportValue(transport)) {
    return 'Invalid MCP transport'
  }
  if (transport === 'stdio') {
    if (typeof body.command !== 'string' || !body.command.trim()) {
      return 'Missing field: command'
    }
  } else if (typeof body.url !== 'string' || !body.url.trim()) {
    return 'Missing field: url'
  } else if (!(await hasPermittedOutboundUrl(body.url))) {
    return 'Outbound URL is not permitted'
  }
  if (body.env !== undefined && !Array.isArray(body.env)) {
    return 'Invalid MCP env'
  }
  return null
}

function readAllowedOutboundHosts(): string[] {
  const value = process.env.BEEGAME_OUTBOUND_ALLOWED_HOSTS
  return value
    ? value
        .split(',')
        .map(host => host.trim())
        .filter(Boolean)
    : []
}

function toOutboundTargetError(
  inspection: Extract<OutboundTargetInspection, { approved: false }>,
): { error: string; code: string; message: string; hostname?: string } {
  const hostname = inspection.hostname
  const target = hostname ? ` "${hostname}"` : ''
  const messages: Record<typeof inspection.code, string> = {
    invalid_url: 'Enter a valid absolute model provider URL.',
    unsupported_protocol: 'Model provider URLs must use HTTPS.',
    embedded_credentials:
      'Model provider URLs cannot contain embedded credentials.',
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
          env: body.env.filter(isObject).map(item => ({
            key: typeof item.key === 'string' ? item.key : '',
            ...(typeof item.value === 'string' ? { value: item.value } : {}),
            ...(item.clearSecret === true ? { clearSecret: true } : {}),
          })),
        }
      : {}),
    autoStart: body.autoStart !== false,
  }
}

function isMcpServerTransportValue(value: string): value is McpServerTransport {
  return value === 'stdio' || value === 'sse' || value === 'http'
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBeeGameSessionLanguage(
  value: unknown,
): value is BeeGameSessionLanguage {
  return (
    value === 'en' ||
    value === 'zh' ||
    value === 'zh-TW' ||
    value === 'ja' ||
    value === 'ko' ||
    value === 'fr' ||
    value === 'de' ||
    value === 'es' ||
    value === 'it' ||
    value === 'pt'
  )
}

export function uploadPolicyResponse(
  error: BeeGameUploadPolicyError,
  traceId: string = randomUUID(),
): Response {
  console.warn('[BeeGame] upload policy rejected request', {
    traceId,
    reason: 'attachment_policy_rejected',
    error: error.name,
  })
  return new Response(
    JSON.stringify({
      error: 'Attachment validation failed',
      traceId,
    }),
    {
      status: 400,
      headers: { 'content-type': 'application/json' },
    },
  )
}

async function appendAuditEventBestEffort(
  action: string,
  append: () => Promise<void>,
): Promise<void> {
  try {
    await append()
  } catch (err) {
    console.warn(
      `[BeeGame] Failed to append ${action} audit event:`,
      toErrorMessage(err),
    )
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
