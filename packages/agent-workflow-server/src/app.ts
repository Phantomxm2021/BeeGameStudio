import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  listModelConfigs,
  mapModelConfigToRuntime,
  type ModelProviderKind,
} from '@claude-code-best/agent-workflow'
import {
  BeeGameSessionManager,
  deleteSessionArtifactsFromTranscript,
  readSessionTranscriptFromDisk,
  type BeeGameSessionLanguage,
  type BeeGameSessionRunner,
} from './beegame/session-manager'
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
  type BeeGameDeploymentPublisher,
  type BeeGameDeploymentRunner,
} from './beegame/deployment-manager'
import {
  readBeeGameAssetManifest,
  uploadBeeGameAsset,
  type BeeGameAssetManifest,
} from './beegame/asset-contracts'
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
import { DashboardRepository } from './dashboard-repository'
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
} from './supabase-dashboard-store'
import {
  createSupabaseRuntimeEnvClientFromEnv,
} from './supabase-runtime-env-client'

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

export type AgentWorkflowAppOptions = {
  sessionRunner?: BeeGameSessionRunner
  previewRunner?: BeeGamePreviewRunner
  previewPortAllocator?: BeeGamePreviewPortAllocator
  previewReadinessProbe?: BeeGamePreviewReadinessProbe
  deploymentRunner?: BeeGameDeploymentRunner
  deploymentPublisher?: BeeGameDeploymentPublisher
  modelConfigStore?: ModelConfigStoreOptions | false
  dashboardDataRoot?: string
  defaultWorkspacePath?: string
  currentUser?: BeeGameUserContext
  currentUserResolver?: BeeGameUserResolver
}

export function createAgentWorkflowApp(
  options: AgentWorkflowAppOptions = {},
): Hono {
  const app = new Hono()
  const dashboardDataRoot = getDashboardDataRoot(
    options.dashboardDataRoot ?? options.defaultWorkspacePath,
  )
  const supabaseStore = createSupabaseDashboardStoreFromEnv()
  const supabaseRuntimeEnvClient = supabaseStore
    ? createSupabaseRuntimeEnvClientFromEnv()
    : undefined
  const requestUserResolver =
    options.currentUserResolver ?? createConfiguredUserResolver()
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
  const dashboardRepository = new DashboardRepository({
    dashboardDataRoot,
    supabaseStore,
    supabaseRuntimeEnvClient,
    getUserDataRoot: getCurrentUserDataRoot,
    modelConfigStore,
  })
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
  )
  const beeGamePreviews = new BeeGamePreviewManager(
    options.previewRunner,
    undefined,
    options.previewPortAllocator,
    options.previewReadinessProbe,
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
  app.use('/api/*', cors())
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
      return c.json({
        error: 'Account deletion unavailable',
        message: toErrorMessage(error),
      }, 501)
    }
  })

  app.get('/api/audit-events', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'audit.read')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.listAuditEvents(c.req.raw, user))
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
    return c.json(await dashboardRepository.listModelConfigs(
      c.req.raw,
      getCurrentUser(c.req.raw),
    ))
  })

  app.post('/api/model-configs', async c => {
    const user = getCurrentUser(c.req.raw)
    if (!hasBeeGamePermission(user, 'model_config.manage')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['name', 'provider', 'apiKey', 'models'])
    if (error) return c.json({ error }, 400)

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
    if (!hasBeeGamePermission(user, 'model_config.manage')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    try {
      const body = await readJson(c.req.raw)
      const updated = await dashboardRepository.updateModelConfig(c.req.raw, user, c.req.param('id'), {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.provider === 'string'
          ? { provider: body.provider as ModelProviderKind }
          : {}),
        ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
        ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
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
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.delete('/api/model-configs/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    if (!hasBeeGamePermission(user, 'model_config.manage')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
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
    const forbidden = requirePermission(user, 'secrets.manage')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.loadWebTools(c.req.raw, user))
  })

  app.put('/api/web-tools', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'secrets.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
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
    const forbidden = requirePermission(user, 'runtime_settings.manage')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.loadRuntimeSettings(c.req.raw, user))
  })

  app.put('/api/runtime-settings', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'runtime_settings.manage')
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
      dataDir: getCurrentUserDataRoot(c.req.raw),
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
    const forbidden = requirePermission(user, 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await dashboardRepository.listMcpServers(c.req.raw, user))
  })

  app.get('/api/mcp-servers/discover', c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(discoverMcpServers({
      dataDir: getCurrentUserDataRoot(c.req.raw),
    }))
  })

  app.get('/api/mcp-servers/discover-active', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const user = getCurrentUser(c.req.raw)
    const servers = await dashboardRepository.listMcpServers(c.req.raw, user)
    return c.json(await discoverActiveMcpServers(servers, {
      ports: parsePortList(c.req.query('ports')),
    }))
  })

  app.post('/api/mcp-servers/test', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = validateMcpServerBody(body)
    if (error) return c.json({ error }, 400)
    return c.json(await testMcpServerConnection(toMcpServerInput(body)))
  })

  app.post('/api/mcp-servers', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'mcp.manage')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = validateMcpServerBody(body)
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
    const error = validateMcpServerBody(body)
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
      return c.json({ error: toErrorMessage(err) }, 400)
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
      return c.json({ error: toErrorMessage(err) }, 400)
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

  app.delete('/api/projects/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const deleted = await dashboardRepository.deleteProject(
      c.req.raw,
      user,
      c.req.param('id'),
    )
    if (deleted) {
      await appendAuditEventBestEffort('project.deleted', () =>
        dashboardRepository.appendAuditEvent(c.req.raw, user, {
          actorId: user.id,
          action: 'project.deleted',
          targetType: 'project',
          targetId: c.req.param('id'),
        }),
      )
    }
    return c.json({ deleted })
  })

  app.post('/api/beegame-intake/options', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const creditBalance = await dashboardRepository.getCreditBalance(c.req.raw, user)
    if (!hasEnoughCreditsForIdeaIntake(creditBalance)) {
      return c.json({
        error: 'Insufficient credits',
        message: `Idea intake requires at least ${creditBalance.estimates.ideaIntake.minCredits} credit.`,
        credits: creditBalance,
      }, 402)
    }
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['idea'])
    if (error) return c.json({ error }, 400)
    let reservation: { id: string } | undefined
    try {
      const modelConfigId = await resolveDefaultModelConfigId(
        c.req.raw,
        user,
        typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
        async (request, requestUser, id) =>
          dashboardRepository.modelConfigExists(request, requestUser, id),
        async (request, requestUser) =>
          dashboardRepository.listModelConfigs(request, requestUser),
      )
      const policy = getCreditTaskPolicy('idea_intake')
      const reservedCredits = policy.reservedCredits
      reservation = await dashboardRepository.reserveCredits(c.req.raw, user, {
        credits: reservedCredits,
        kind: policy.taskType,
        metadata: {
          taskType: policy.taskType,
          displayName: policy.displayName,
          language: typeof body.language === 'string' ? body.language : undefined,
        },
      })
      const intake = await generateBeeGameIntakeOptions({
        idea: String(body.idea),
        language:
          typeof body.language === 'string' ? body.language : undefined,
        ownerId: user.id,
        modelConfigId,
        runtimeEnv: await dashboardRepository.getRuntimeEnv(
          getCurrentUserDataRoot(c.req.raw),
          user.id,
          getBearerToken(c.req.raw),
          modelConfigId,
        ),
      })
      await dashboardRepository.settleCreditReservation(c.req.raw, user, {
        reservationId: reservation.id,
        weightedTokens: reservedCredits * creditBalance.creditUnitWeightedTokens,
        metadata: {
          kind: policy.taskType,
          taskType: policy.taskType,
          displayName: policy.displayName,
        },
      })
      return c.json({ ...intake })
    } catch (err) {
      if (reservation) {
        try {
          await dashboardRepository.refundCreditReservation(c.req.raw, user, {
            reservationId: reservation.id,
            metadata: { reason: 'idea_intake_failed' },
          })
        } catch {
          // Keep the original intake failure visible to the caller.
        }
      }
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  registerBeeGameSessionRoutes(
    app,
    '/api/beegame-sessions',
    beeGameSessions,
    beeGamePreviews,
    beeGameDeployments,
    {
      defaultWorkspacePath: options.defaultWorkspacePath,
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

function requireBeeGameSessionOwner(
  request: Request,
  sessionId: string,
  beeGameSessions: BeeGameSessionManager,
  getCurrentUser: (request?: Request) => BeeGameUserContext,
): { error: string } | undefined {
  const metadata = beeGameSessions.metadata(sessionId)
  if (!metadata) return undefined
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

async function generateBeeGameIntakeOptions(input: {
  idea: string
  language?: string
  ownerId: string
  modelConfigId?: string
  runtimeEnv?: Record<string, string>
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
      messages: [
        {
          role: 'system',
          content: [
            'You are BeeGame intake planner.',
            'First understand the game request before proposing game modes. The options are target briefs that help the user choose a direction, not full design documents and not project management delivery strategies.',
            'Return only JSON with this schema: maturity, needs_options, needs_clarification, clarification, clarification_questions, detected_constraints, recommended_next_step, options.',
            'maturity must be one of vague, directional, concrete.',
            'Set needs_options=true only when the idea is vague or broad enough that the user should choose between 2 to 3 directions.',
            'Set needs_options=false for concrete ideas that already specify the main platform, presentation, game mode, repeated player activity, constraints, or MVP scope; in that case return exactly one recommended option and recommended_next_step="configure_details".',
            'Set needs_clarification=true only when a blocking contradiction or missing decision prevents a useful recommendation.',
            'When needs_clarification=true, clarification must contain exactly one prompt string for the most blocking question, 2 to 4 short options with id, label, optional description, and optional value, plus optional freeform_label. Do not bundle multiple questions into one prompt.',
            'When needs_clarification=true, recommended_next_step must be "clarify"; options may be empty because the user must answer first.',
            'When needs_clarification=false, return 1 to 3 valid options.',
            'Each option must include id, title, projectFolderName, pitch, gameplay, coreGameplayHypothesis, playerFirstMinute, whyFitsIdea, playablePrototype, validationTarget, risk, experienceSnapshot, coreMechanic, firstBuild, validationGoal, fit, firstPlayableValidation, riskComplexity, recommendedPlatform, recommendedDimension, recommendedGenre, recommendedStyle, recommendedInputs, and scope.',
            'projectFolderName must be an English lowercase kebab-case directory name based on the actual game concept, not a random identifier and not a BeeGame/dashboard name.',
            'title must be a game mode name, such as an objective, combat, puzzle, survival, race, sandbox, boss, narrative, simulation, or strategy mode name. Do not copy the user idea into the title and do not write an abstract production or delivery title.',
            'gameplay must explain the playable rules: player goal, main actions, opposition or pressure, scoring or progress, and win/fail/round end condition. Do not write abstract experience prose.',
            'The direction must be suitable for a complete game later, but this intake option should stay lightweight: name the mode, explain the core gameplay, and summarize the first target the user is choosing.',
            'Do not write full GDD, art direction, UI/UX specification, asset inventory, or implementation plan in intake options. Those belong to the confirmed planning/build stage.',
            'Every option must be experience-first and gameplay-first, not implementation-first. Platform and presentation are supporting metadata, not the main point.',
            'Choose recommended metadata by understanding the full user request and the proposed game mode, not by keyword matching and not from a fixed menu.',
            'recommendedPlatform, recommendedDimension, recommendedGenre, recommendedStyle, and recommendedInputs must be concise natural metadata that fits the request; do not force a specific platform, engine, genre, style, input model, or implementation stack.',
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
  })
  if (!response.ok) {
    throw new Error(
      await describeModelIntakeFailure(response, {
        baseUrl,
        model,
        language: input.language,
      }),
    )
  }
  const payload = (await response.json()) as JsonObject
  return parseBeeGameIntakeAnalysis(payload)
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
  const options = Array.isArray(parsed.options) ? parsed.options : []
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
  const needsClarification = getBooleanField(parsed, 'needsClarification', 'needs_clarification') ?? false
  const clarification = normalizeBeeGameClarification(parsed.clarification)
  if (normalized.length === 0 && !(needsClarification && clarification)) {
    const keys = Object.keys(parsed).join(', ') || 'none'
    const reason = rejectedReasons.slice(0, 3).join('; ')
    throw new Error(
      `Model intake response did not include valid options. Parsed keys: ${keys}${reason ? `. Rejected: ${reason}` : ''}`,
    )
  }
  const maturity = normalizeMaturity(parsed.maturity)
  return {
    maturity,
    needsOptions: getBooleanField(parsed, 'needsOptions', 'needs_options') ?? maturity !== 'concrete',
    needsClarification,
    ...(clarification ? { clarification } : {}),
    clarificationQuestions: getStringArrayField(parsed, 'clarificationQuestions', 'clarification_questions'),
    detectedConstraints: getStringArrayField(parsed, 'detectedConstraints', 'detected_constraints'),
    recommendedNextStep: getStringField(parsed, 'recommendedNextStep', 'recommended_next_step') || (needsClarification ? 'clarify' : maturity === 'concrete' ? 'configure_details' : 'choose_direction'),
    options: normalized.slice(0, 3),
  }
}

function normalizeBeeGameClarification(value: unknown): BeeGameClarification | undefined {
  if (!isObject(value)) return undefined
  const prompt = getStringField(value, 'prompt')
  if (!prompt) return undefined
  const rawOptions = Array.isArray(value.options) ? value.options : []
  const options = rawOptions
    .map((option, index): BeeGameClarificationOption | undefined => {
      if (!isObject(option)) return undefined
      const label = getStringField(option, 'label')
      if (!label) return undefined
      const description = getStringField(option, 'description')
      const optionValue = getStringField(option, 'value')
      return {
        id: getStringField(option, 'id') || `clarification_${index + 1}`,
        label,
        ...(description ? { description } : {}),
        ...(optionValue ? { value: optionValue } : {}),
      }
    })
    .filter((option): option is BeeGameClarificationOption => Boolean(option))
    .slice(0, 4)
  const freeformLabel = getStringField(value, 'freeformLabel', 'freeform_label')
  return {
    prompt,
    options,
    ...(freeformLabel ? { freeformLabel } : {}),
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
  const inputs = getStringArrayField(value, 'recommendedInputs', 'recommended_inputs')
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
    recommendedPlatform: getStringishField(value, 'recommendedPlatform', 'recommended_platform'),
    recommendedDimension: getStringishField(value, 'recommendedDimension', 'recommended_dimension'),
    recommendedGenre: getStringishField(value, 'recommendedGenre', 'recommended_genre'),
    recommendedStyle: getStringishField(value, 'recommendedStyle', 'recommended_style'),
    recommendedInputs: inputs,
    scope: getStringishField(value, 'scope'),
  }
  if (
    !option.title ||
    !option.gameplay
  ) {
    rejectedReasons?.push(
      [
        !option.title ? 'title' : '',
        !option.gameplay ? 'gameplay' : '',
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

function registerBeeGameSessionRoutes(
  app: Hono,
  basePath: string,
  beeGameSessions: BeeGameSessionManager,
  beeGamePreviews: BeeGamePreviewManager,
  beeGameDeployments: BeeGameDeploymentManager | undefined,
  options: {
    defaultWorkspacePath?: string
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
      const modelConfigId = await optionalOwnedModelConfigId(
        c.req.raw,
        currentUser,
        body.modelConfigId,
        options.modelConfigExists,
      )
      const session = beeGameSessions.start({
          workspacePath,
          ...(typeof body.projectId === 'string' && body.projectId
            ? { projectId: body.projectId }
            : {}),
          ...(modelConfigId
            ? { modelConfigId }
            : {}),
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
    if (sessionForbidden) return c.json(sessionForbidden, 404)
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
      return c.json({ error: toErrorMessage(err) }, 404)
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
      return c.json({ error: toErrorMessage(err) }, 404)
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
      return c.json({ error: toErrorMessage(err) }, 404)
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
          return c.json(
            { error: fallbackMessage },
            fallbackMessage === 'Artifact path must stay inside the session workspace'
              ? 400
              : 404,
          )
        }
      }
      return c.json(
        { error: message },
        message === 'Artifact path must stay inside the session workspace'
          ? 400
          : 404,
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
      return c.json({ error: toErrorMessage(err) }, 400)
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
      const manifest = await options.loadAssetManifest(
        c.req.raw,
        beeGameSessions.metadata(c.req.param('id')),
      )
      if (manifest) return c.json(manifest)
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/assets/:slotId/upload`, async c => {
    const forbidden = check(c.req.raw, 'assets.upload')
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
      const message = toErrorMessage(err)
      return c.json(
        { error: message },
        message.startsWith('Asset slot not found') ? 404 : 400,
      )
    }
  })

  app.get(`${basePath}/:id/package`, async c => {
    const forbidden = check(c.req.raw, 'project.export')
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
  }

  app.post(`${basePath}/:id/input`, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['text'])
    if (error) return c.json({ error }, 400)
    try {
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
      return c.json(
        await beeGameSessions.sendWithDisplay(c.req.param('id'), String(body.text), {
          displayText,
          displayKind,
          taskType,
          clientMessageId,
          ...(isBeeGameSessionLanguage(body.language)
            ? { language: body.language }
            : {}),
          ...(getBearerToken(c.req.raw)
            ? { authToken: getBearerToken(c.req.raw) }
            : {}),
        }),
      )
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
    const deleteArtifacts = c.req.query('deleteArtifacts') === '1'
    const workspacePathQuery = c.req.query('workspacePath')
    try {
      const sessionMetadata = beeGameSessions.metadata(c.req.param('id'))
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
          const workspacePath = workspacePathQuery
            ? await resolveSessionWorkspacePath(
                workspacePathQuery,
                defaultWorkspacePath,
              )
            : await getDefaultWorkspacePath({ defaultWorkspacePath })
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
          return c.json({ error: toErrorMessage(fallbackErr) }, 404)
        }
      }
      return c.json({ error: toErrorMessage(err) }, 404)
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
    return Response.json(
      after > 0 ? events.filter(event => event.id > after) : events,
    )
  } catch (err) {
    return Response.json({ error: toErrorMessage(err) }, { status: 404 })
  }
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

async function readJson(request: Request): Promise<JsonObject> {
  const value = await request.json()
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

function validateMcpServerBody(body: JsonObject): string | null {
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
  }
  if (body.env !== undefined && !Array.isArray(body.env)) {
    return 'Invalid MCP env'
  }
  return null
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

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}
