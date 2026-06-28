import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  createModelConfig,
  deleteModelConfig,
  exportModelConfigSnapshot,
  importModelConfigSnapshot,
  listModelConfigs,
  mapModelConfigToRuntime,
  updateModelConfig,
  type ModelProviderKind,
} from '@claude-code-best/agent-workflow'
import {
  BeeGameSessionManager,
  deleteSessionArtifactsFromTranscript,
  readSessionTranscriptFromDisk,
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
  readBeeGameAssetManifest,
  uploadBeeGameAsset,
} from './beegame/asset-contracts'
import { listDirectories } from './filesystem/directories'
import { getDefaultWorkspacePath } from './filesystem/default-workspace'
import {
  loadModelConfigsFromStore,
  saveModelConfigsToStore,
  type ModelConfigStoreOptions,
} from './model-config-store'
import {
  BeeGameProjectMetadataStore,
  getBeeGameProjectDatabasePath,
  type BeeGameProjectMetadata,
} from './project-metadata-store'
import {
  loadWebToolsConfig,
  mapWebToolsConfigToRuntimeEnv,
  saveWebToolsConfig,
  toPublicWebToolsConfig,
} from './web-tools-store'
import {
  loadRuntimeSettingsConfig,
  mapRuntimeSettingsToEnv,
  saveRuntimeSettingsConfig,
  syncRuntimeSettingsToDedicatedRuntimeConfig,
} from './runtime-settings-store'
import {
  deleteMcpServer,
  discoverMcpServers,
  listMcpServers,
  upsertMcpServer,
  type McpServerScope,
  type McpServerTransport,
} from './mcp-servers-store'
import {
  discoverActiveMcpServers,
  parsePortList,
  testMcpServerConnection,
} from './mcp-active-discovery'
import {
  appendAuditEvent,
  listAuditEvents,
  type AppendAuditEventInput,
} from './audit-events-store'
import {
  getCreditBalance,
  hasEnoughCreditsForIdeaIntake,
  listCreditLedger,
  refundCreditReservation,
  reserveCredits,
  settleCreditReservation,
  summarizeCreditLedger,
} from './credit-store'
import {
  getCreditTaskPolicy,
  quoteCreditTask,
} from './credit-policy'
import {
  type BeeGamePermission,
  type BeeGameUserContext,
  type BeeGameUserResolver,
  createConfiguredUserResolver,
  DEFAULT_LOCAL_USER_ID,
  hasBeeGamePermission,
  listBeeGamePermissions,
} from './auth/user-context'
import {
  createSupabaseDashboardStoreFromEnv,
  type SupabaseDashboardStore,
} from './supabase-dashboard-store'

type JsonObject = Record<string, unknown>

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
  const requestUsers = new WeakMap<Request, BeeGameUserContext>()
  const requestUserResolver =
    options.currentUserResolver ?? createConfiguredUserResolver()
  const getCurrentUser = (request?: Request): BeeGameUserContext => {
    const user = options.currentUser ?? (request ? requestUsers.get(request) : undefined)
    if (!user) throw new Error('Authenticated BeeGame user is required')
    return user
  }
  const getCurrentUserDataRoot = (request?: Request) =>
    getUserDashboardDataRoot(dashboardDataRoot, getCurrentUser(request).id)
  const getUserCreditBalance = async (
    request: Request,
    user: BeeGameUserContext,
  ) => supabaseStore
    ? supabaseStore.getCreditBalance(user.id)
    : getCreditBalance(user.id, {
        dataDir: getCurrentUserDataRoot(request),
      })
  const listUserCreditLedger = async (
    request: Request,
    user: BeeGameUserContext,
  ) => supabaseStore
    ? supabaseStore.listCreditLedger(user.id)
    : listCreditLedger(user.id, {
        dataDir: getCurrentUserDataRoot(request),
      })
  const summarizeUserCreditLedger = async (
    request: Request,
    user: BeeGameUserContext,
    projectId?: string,
  ) => supabaseStore
    ? supabaseStore.summarizeCreditLedger(user.id, projectId)
    : summarizeCreditLedger(user.id, {
        dataDir: getCurrentUserDataRoot(request),
        ...(projectId ? { projectId } : {}),
      })
  const appendUserAuditEvent = async (
    request: Request,
    user: BeeGameUserContext,
    input: AppendAuditEventInput,
  ) => {
    if (supabaseStore) {
      await supabaseStore.appendAuditEvent(user.id, input)
      return
    }
    appendAuditEvent(input, {
      dataDir: getCurrentUserDataRoot(request),
    })
  }
  const listUserAuditEvents = async (
    request: Request,
    user: BeeGameUserContext,
  ) => supabaseStore
    ? supabaseStore.listAuditEvents(user.id)
    : listAuditEvents({
        dataDir: getCurrentUserDataRoot(request),
      })
  const beeGameSessions = new BeeGameSessionManager(
    options.sessionRunner,
    dashboardDataRoot,
    async (userDataRoot, userId) => {
      const dataDir = userDataRoot ?? dashboardDataRoot
      if (supabaseStore && userId) {
        const [webTools, runtimeSettings] = await Promise.all([
          supabaseStore.loadWebTools(userId),
          supabaseStore.loadRuntimeSettings(userId),
        ])
        return {
          ...mapWebToolsConfigToRuntimeEnv(webTools),
          ...mapRuntimeSettingsToEnv(runtimeSettings, { dataDir }),
        }
      }
      return {
        ...mapWebToolsConfigToRuntimeEnv(loadWebToolsConfig({ dataDir })),
        ...mapRuntimeSettingsToEnv(loadRuntimeSettingsConfig({ dataDir }), {
          dataDir,
        }),
      }
    },
    supabaseStore
      ? {
          reserveCredits: (userId, creditOptions) =>
            supabaseStore.reserveCredits(userId, creditOptions),
          settleCreditReservation: (userId, creditOptions) =>
            supabaseStore.settleCreditReservation(userId, creditOptions),
          refundCreditReservation: (userId, creditOptions) =>
            supabaseStore.refundCreditReservation(userId, creditOptions),
        }
      : undefined,
  )
  const beeGamePreviews = new BeeGamePreviewManager(
    options.previewRunner,
    undefined,
    options.previewPortAllocator,
    options.previewReadinessProbe,
  )
  const projectStores = new Map<string, BeeGameProjectMetadataStore>()
  const getProjectStore = (request: Request) => {
    const dataRoot = getCurrentUserDataRoot(request)
    const existing = projectStores.get(dataRoot)
    if (existing) return existing
    const created = new BeeGameProjectMetadataStore(
      getBeeGameProjectDatabasePath(dataRoot),
    )
    projectStores.set(dataRoot, created)
    return created
  }
  const modelConfigStore = options.modelConfigStore
  if (modelConfigStore !== false && modelConfigStore !== undefined) {
    loadModelConfigsFromStore(modelConfigStore)
  }

  app.use('/api/*', cors())
  app.use('/api/*', async (c, next) => {
    if (options.currentUser) {
      await next()
      return
    }
    const user = requestUserResolver
      ? await requestUserResolver(c.req.raw)
      : undefined
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        message: 'authentication required',
      }, 401)
    }
    requestUsers.set(c.req.raw, user)
    await next()
  })

  app.get('/health', c => c.json({ status: 'ok' }))

  app.get('/api/current-user', c => {
    const user = options.currentUser ?? requestUsers.get(c.req.raw)
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        message: 'authentication required',
      }, 401)
    }
    return c.json({
      id: user.id,
      role: user.role,
      ...(user.email ? { email: user.email } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      permissions: listBeeGamePermissions(user),
    })
  })

  app.delete('/api/current-user', async c => {
    const user = getCurrentUser(c.req.raw)
    if (!supabaseStore) {
      return c.json({
        error: 'Supabase Auth admin is not configured',
        message: 'account deletion requires BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
      }, 501)
    }
    await supabaseStore.deleteAuthUser(user.id)
    await appendUserAuditEvent(c.req.raw, user, {
      actorId: user.id,
      action: 'account.deleted',
      targetType: 'user',
      targetId: user.id,
      metadata: {},
    })
    return c.json({ deleted: true })
  })

  app.get('/api/audit-events', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'audit.read')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(await listUserAuditEvents(c.req.raw, user))
  })

  app.get('/api/credits', async c => {
    const user = getCurrentUser(c.req.raw)
    return c.json(await getUserCreditBalance(c.req.raw, user))
  })

  app.get('/api/credits/ledger', async c => {
    const user = getCurrentUser(c.req.raw)
    return c.json(await listUserCreditLedger(c.req.raw, user))
  })

  app.get('/api/credits/summary', async c => {
    const user = getCurrentUser(c.req.raw)
    const projectId = c.req.query('projectId')?.trim()
    return c.json(await summarizeUserCreditLedger(
      c.req.raw,
      user,
      projectId || undefined,
    ))
  })

  app.post('/api/credits/quote', async c => {
    const user = getCurrentUser(c.req.raw)
    const body = await readJson(c.req.raw)
    const balance = await getUserCreditBalance(c.req.raw, user)
    return c.json(quoteCreditTask({
      taskType: isObject(body) ? body.taskType : undefined,
      balanceCredits: balance.balanceCredits,
    }))
  })

  app.get('/api/model-configs', async c => {
    await loadSupabaseModelConfigs(supabaseStore)
    return c.json(listModelConfigs(getCurrentUser(c.req.raw).id))
  })

  app.post('/api/model-configs', async c => {
    const user = getCurrentUser(c.req.raw)
    if (!hasBeeGamePermission(user, 'model_config.manage')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['name', 'provider', 'apiKey', 'models'])
    if (error) return c.json({ error }, 400)

    await loadSupabaseModelConfigs(supabaseStore)
    const created = createModelConfig(user.id, {
      name: String(body.name),
      provider: body.provider as ModelProviderKind,
      ...(typeof body.baseUrl === 'string' && body.baseUrl
        ? { baseUrl: body.baseUrl }
        : {}),
      apiKey: String(body.apiKey),
      models: toModelMap(body.models),
      isDefault: body.isDefault === true,
    })
    await persistModelConfig(supabaseStore, created.id, modelConfigStore)
    await appendUserAuditEvent(c.req.raw, user, {
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
    const body = await readJson(c.req.raw)
    await loadSupabaseModelConfigs(supabaseStore)
    const updated = updateModelConfig(c.req.param('id'), {
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
    if (!updated) return c.json({ error: 'Config not found' }, 404)

    await persistModelConfig(supabaseStore, updated.id, modelConfigStore)
    await appendUserAuditEvent(c.req.raw, user, {
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
  })

  app.delete('/api/model-configs/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    if (!hasBeeGamePermission(user, 'model_config.manage')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    await loadSupabaseModelConfigs(supabaseStore)
    const deleted = deleteModelConfig(c.req.param('id'))
    if (deleted) {
      if (supabaseStore) {
        await supabaseStore.deleteModelConfig(user.id, c.req.param('id'))
      } else {
        persistModelConfigs(modelConfigStore)
      }
      await appendUserAuditEvent(c.req.raw, user, {
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
    const config = supabaseStore
      ? await supabaseStore.loadWebTools(user.id)
      : loadWebToolsConfig({ dataDir: getCurrentUserDataRoot(c.req.raw) })
    return c.json(toPublicWebToolsConfig(config))
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
    const saved = supabaseStore
      ? await supabaseStore.saveWebTools(user.id, input)
      : saveWebToolsConfig(input, {
          dataDir: getCurrentUserDataRoot(c.req.raw),
        })
    await appendUserAuditEvent(c.req.raw, user, {
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
    return c.json(supabaseStore
      ? await supabaseStore.loadRuntimeSettings(user.id)
      : loadRuntimeSettingsConfig({
          dataDir: getCurrentUserDataRoot(c.req.raw),
        }))
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
    const saved = supabaseStore
      ? await supabaseStore.saveRuntimeSettings(user.id, input)
      : saveRuntimeSettingsConfig(input, {
          dataDir: getCurrentUserDataRoot(c.req.raw),
        })
    syncRuntimeSettingsToDedicatedRuntimeConfig(saved, {
      dataDir: getCurrentUserDataRoot(c.req.raw),
    })
    await appendUserAuditEvent(c.req.raw, user, {
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
    return c.json(supabaseStore
      ? await supabaseStore.listMcpServers(user.id)
      : listMcpServers({
          dataDir: getCurrentUserDataRoot(c.req.raw),
        }))
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
    const servers = supabaseStore
      ? await supabaseStore.listMcpServers(user.id)
      : listMcpServers({ dataDir: getCurrentUserDataRoot(c.req.raw) })
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
    const saved = supabaseStore
      ? await supabaseStore.upsertMcpServer(user.id, toMcpServerInput(body))
      : upsertMcpServer(toMcpServerInput(body), {
          dataDir: getCurrentUserDataRoot(c.req.raw),
        })
    await appendUserAuditEvent(c.req.raw, user, {
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
    const saved = supabaseStore
      ? await supabaseStore.upsertMcpServer(user.id, {
          ...toMcpServerInput(body),
          id: c.req.param('id'),
        })
      : upsertMcpServer({
          ...toMcpServerInput(body),
          id: c.req.param('id'),
        }, {
          dataDir: getCurrentUserDataRoot(c.req.raw),
        })
    await appendUserAuditEvent(c.req.raw, user, {
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
    const deleted = supabaseStore
      ? await supabaseStore.deleteMcpServer(user.id, c.req.param('id'))
      : deleteMcpServer(c.req.param('id'), {
          dataDir: getCurrentUserDataRoot(c.req.raw),
        })
    if (deleted) {
      await appendUserAuditEvent(c.req.raw, user, {
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
    return c.json(supabaseStore
      ? await supabaseStore.listProjects(user.id)
      : getProjectStore(c.req.raw).listProjects())
  })

  app.post('/api/projects', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['id', 'name', 'created_at'])
    if (error) return c.json({ error }, 400)
    try {
      const user = getCurrentUser(c.req.raw)
      return c.json(supabaseStore
        ? await supabaseStore.upsertProject(user.id, toProjectMetadata(body))
        : getProjectStore(c.req.raw).upsertProject(toProjectMetadata(body)))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.patch('/api/projects/:id', async c => {
    const forbidden = requirePermission(getCurrentUser(c.req.raw), 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const user = getCurrentUser(c.req.raw)
    const projects = supabaseStore
      ? await supabaseStore.listProjects(user.id)
      : getProjectStore(c.req.raw).listProjects()
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
      return c.json(supabaseStore
        ? await supabaseStore.upsertProject(user.id, nextProject)
        : getProjectStore(c.req.raw).upsertProject(nextProject))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.delete('/api/projects/:id', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.delete')
    if (forbidden) return c.json(forbidden, 403)
    const deleted = supabaseStore
      ? await supabaseStore.deleteProject(user.id, c.req.param('id'))
      : getProjectStore(c.req.raw).deleteProject(c.req.param('id'))
    if (deleted) {
      await appendUserAuditEvent(c.req.raw, user, {
        actorId: user.id,
        action: 'project.deleted',
        targetType: 'project',
        targetId: c.req.param('id'),
      })
    }
    return c.json({ deleted })
  })

  app.post('/api/beegame-intake/options', async c => {
    const user = getCurrentUser(c.req.raw)
    const forbidden = requirePermission(user, 'project.create')
    if (forbidden) return c.json(forbidden, 403)
    const dataDir = getCurrentUserDataRoot(c.req.raw)
    const creditBalance = await getUserCreditBalance(c.req.raw, user)
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
      await loadSupabaseModelConfigs(supabaseStore)
      const policy = getCreditTaskPolicy('idea_intake')
      const reservedCredits = policy.reservedCredits
      reservation = supabaseStore
        ? await supabaseStore.reserveCredits(user.id, {
            credits: reservedCredits,
            kind: policy.taskType,
            metadata: {
              taskType: policy.taskType,
              displayName: policy.displayName,
              language: typeof body.language === 'string' ? body.language : undefined,
            },
          })
        : reserveCredits(user.id, {
            dataDir,
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
        modelConfigId:
          typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
      })
      if (supabaseStore) {
        await supabaseStore.settleCreditReservation(user.id, {
          reservationId: reservation.id,
          weightedTokens: reservedCredits * creditBalance.creditUnitWeightedTokens,
          metadata: {
            kind: policy.taskType,
            taskType: policy.taskType,
            displayName: policy.displayName,
          },
        })
      } else {
        settleCreditReservation(user.id, {
          dataDir,
          reservationId: reservation.id,
          weightedTokens: reservedCredits * creditBalance.creditUnitWeightedTokens,
          metadata: {
            kind: policy.taskType,
            taskType: policy.taskType,
            displayName: policy.displayName,
          },
        })
      }
      return c.json({ ...intake })
    } catch (err) {
      if (reservation) {
        try {
          if (supabaseStore) {
            await supabaseStore.refundCreditReservation(user.id, {
              reservationId: reservation.id,
              metadata: { reason: 'idea_intake_failed' },
            })
          } else {
            refundCreditReservation(user.id, {
              dataDir,
              reservationId: reservation.id,
              metadata: { reason: 'idea_intake_failed' },
            })
          }
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
    {
      defaultWorkspacePath: options.defaultWorkspacePath,
      supabaseStore,
      getCurrentUser,
      getUserDataRoot: getCurrentUserDataRoot,
      appendAuditEvent: (request, input) =>
        appendUserAuditEvent(request, getCurrentUser(request), input),
    },
  )
  registerBeeGameSessionRoutes(
    app,
    '/api/console/sessions',
    beeGameSessions,
    beeGamePreviews,
    {
      defaultWorkspacePath: options.defaultWorkspacePath,
      supabaseStore,
      getCurrentUser,
      getUserDataRoot: getCurrentUserDataRoot,
      appendAuditEvent: (request, input) =>
        appendUserAuditEvent(request, getCurrentUser(request), input),
    },
  )

  return app
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

function optionalOwnedModelConfigId(
  ownerId: string,
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const modelConfigId = value.trim()
  return modelConfigId
    ? requireOwnedModelConfigId(ownerId, modelConfigId)
    : undefined
}

function requireOwnedModelConfigId(
  ownerId: string,
  value: unknown,
): string {
  const modelConfigId = typeof value === 'string' ? value.trim() : ''
  if (
    !modelConfigId ||
    !listModelConfigs(ownerId).some(config => config.id === modelConfigId)
  ) {
    throw new Error('Model config not found')
  }
  return modelConfigId
}

async function generateBeeGameIntakeOptions(input: {
  idea: string
  language?: string
  ownerId: string
  modelConfigId?: string
}): Promise<BeeGameIntakeAnalysis> {
  const configId =
    input.modelConfigId ??
    listModelConfigs(input.ownerId).find(config => config.isDefault)?.id
  if (!configId) {
    throw new Error('No default model config found')
  }

  const runtime = mapModelConfigToRuntime(configId)
  const env = runtime?.env ?? {}
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
            'Choose recommended metadata based on the full user request and game mode, not keyword matching. The examples below are suggestions, not closed lists.',
            'recommendedPlatform examples: Web, Unity, Godot, XR, Native, desktop, mobile, console, physical installation, or another target that fits the request.',
            'recommendedDimension examples: 2D, 3D, Mixed, text-driven, tabletop, spatial, or another representation that fits the request.',
            'recommendedGenre examples: Arcade, Puzzle, Action, Adventure, Casual, Simulation, Strategy, RPG, shooter, racing, rhythm, narrative, or another genre that fits the request.',
            'recommendedStyle examples: Pixel, Cartoon, Minimal, Painterly, Sci-fi, Fantasy, Realistic, abstract, photo-real, handmade, or another style that fits the request.',
            'recommendedInputs examples: Keyboard/mouse, Gamepad, Touch, Voice, Hand tracking XR, motion, controller, keyboard-only, mouse-only, or another input model that fits the request.',
            'Do not output Auto for recommended metadata.',
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
    throw new Error(`Model intake request failed: ${response.status}`)
  }
  const payload = (await response.json()) as JsonObject
  return parseBeeGameIntakeAnalysis(payload)
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
  options: {
    defaultWorkspacePath?: string
    supabaseStore?: SupabaseDashboardStore
    getCurrentUser: (request?: Request) => BeeGameUserContext
    getUserDataRoot: (request?: Request) => string
    appendAuditEvent: (
      request: Request,
      input: AppendAuditEventInput,
    ) => Promise<void>
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

  app.get(basePath, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    return c.json(beeGameSessions.list(options.getCurrentUser(c.req.raw).id))
  })

  app.post(basePath, async c => {
    const forbidden = check(c.req.raw, 'agent.send_message')
    if (forbidden) return c.json(forbidden, 403)
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['workspacePath'])
    if (error) return c.json({ error }, 400)
    try {
      const currentUser = options.getCurrentUser(c.req.raw)
      const workspacePath = await resolveSessionWorkspacePath(
        String(body.workspacePath),
        defaultWorkspacePath,
      )
      await assertSessionWorkspaceIsProjectDirectory(
        workspacePath,
        defaultWorkspacePath,
      )
      const modelConfigId = optionalOwnedModelConfigId(
        currentUser.id,
        body.modelConfigId,
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
          userId: currentUser.id,
          userDataRoot: options.getUserDataRoot(c.req.raw),
        })
      await persistSupabaseSessionMetadata(
        options.supabaseStore,
        currentUser.id,
        beeGameSessions,
        session.id,
      )
      return c.json(session)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get(`${basePath}/:id`, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const session = beeGameSessions.get(c.req.param('id'))
    return session
      ? c.json(session)
      : c.json({ error: 'Session not found' }, 404)
  })

  app.get(`${basePath}/:id/events`, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      const after = Number.parseInt(c.req.query('after') || '0', 10)
      return c.json(beeGameSessions.events(c.req.param('id'), after))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.get(`${basePath}/:id/runtime-snapshot`, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    try {
      return c.json(
        beeGameSessions.runtimeSnapshot(
          c.req.param('id'),
          c.req.query('workspacePath'),
        ),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.get(`${basePath}/:id/transcript`, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
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
      const modelConfigId = requireOwnedModelConfigId(
        options.getCurrentUser(c.req.raw).id,
        body.modelConfigId,
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
      return c.json(
        { error: message },
        message === 'Artifact path must stay inside the session workspace'
          ? 400
          : 404,
      )
    }
  })

  app.get(`${basePath}/:id/assets`, async c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const workspacePath = c.req.query('workspacePath')
    if (!workspacePath) return c.json({ error: 'Missing query: workspacePath' }, 400)
    try {
      const manifest = await readBeeGameAssetManifest(workspacePath)
      const projectId = beeGameSessions.metadata(c.req.param('id'))?.projectId
      if (options.supabaseStore && projectId) {
        await options.supabaseStore.upsertAssetManifest(
          options.getCurrentUser(c.req.raw).id,
          projectId,
          manifest,
        )
      }
      return c.json(manifest)
    } catch (err) {
      const projectId = beeGameSessions.metadata(c.req.param('id'))?.projectId
      if (options.supabaseStore && projectId) {
        const manifest = await options.supabaseStore.loadAssetManifest(
          options.getCurrentUser(c.req.raw).id,
          projectId,
        )
        if (manifest) return c.json(manifest)
      }
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/assets/:slotId/upload`, async c => {
    const forbidden = check(c.req.raw, 'assets.upload')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const workspacePath = c.req.query('workspacePath')
    if (!workspacePath) return c.json({ error: 'Missing query: workspacePath' }, 400)
    const form = await c.req.raw.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'Missing form file' }, 400)
    try {
      const projectId = beeGameSessions.metadata(c.req.param('id'))?.projectId
      const currentUser = options.getCurrentUser(c.req.raw)
      const uploadedUrl = options.supabaseStore && projectId
        ? await options.supabaseStore.uploadAssetFile({
            ownerId: currentUser.id,
            projectId,
            fileName: file.name,
            contentType: file.type,
            body: file,
          })
        : undefined
      const result = await uploadBeeGameAsset(
        workspacePath,
        c.req.param('slotId'),
        file,
        uploadedUrl,
      )
      if (options.supabaseStore && projectId) {
        await options.supabaseStore.upsertAssetManifest(
          currentUser.id,
          projectId,
          result.manifest,
        )
      }
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
        c.req.query('workspacePath'),
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

  app.get(`${basePath}/:id/preview`, c => {
    const forbidden = check(c.req.raw, 'project.read')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const workspacePath = c.req.query('workspacePath')
    if (!workspacePath) return c.json({ error: 'Missing query: workspacePath' }, 400)
    try {
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
    const body = await readJson(c.req.raw)
    const workspacePath = typeof body.workspacePath === 'string'
      ? body.workspacePath
      : c.req.query('workspacePath')
    if (!workspacePath) return c.json({ error: 'Missing workspacePath' }, 400)
    try {
      const snapshot = await beeGamePreviews.start({
        sessionId: c.req.param('id'),
        workspacePath,
      })
      await persistSupabasePreviewSnapshot(
        options.supabaseStore,
        options.getCurrentUser(c.req.raw).id,
        beeGameSessions,
        c.req.param('id'),
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
    const body = await readJson(c.req.raw)
    const workspacePath = typeof body.workspacePath === 'string'
      ? body.workspacePath
      : c.req.query('workspacePath')
    if (!workspacePath) return c.json({ error: 'Missing workspacePath' }, 400)
    try {
      const snapshot = await beeGamePreviews.restart({
        sessionId: c.req.param('id'),
        workspacePath,
      })
      await persistSupabasePreviewSnapshot(
        options.supabaseStore,
        options.getCurrentUser(c.req.raw).id,
        beeGameSessions,
        c.req.param('id'),
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
    const workspacePath = c.req.query('workspacePath')
    try {
      const snapshot = beeGamePreviews.stop(c.req.param('id'), workspacePath)
      await persistSupabasePreviewSnapshot(
        options.supabaseStore,
        options.getCurrentUser(c.req.raw).id,
        beeGameSessions,
        c.req.param('id'),
        snapshot,
      )
      return c.json(snapshot)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

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
      return c.json(
        await beeGameSessions.sendWithDisplay(c.req.param('id'), String(body.text), {
          displayText,
          displayKind,
          taskType,
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
      await persistSupabaseSessionMetadata(
        options.supabaseStore,
        options.getCurrentUser(c.req.raw).id,
        beeGameSessions,
        session.id,
      )
      return c.json(session)
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.delete(`${basePath}/:id`, async c => {
    const forbidden = check(c.req.raw, 'project.delete')
    if (forbidden) return c.json(forbidden, 403)
    const sessionForbidden = checkSession(c.req.raw, c.req.param('id'))
    if (sessionForbidden) return c.json(sessionForbidden, 404)
    const deleteArtifacts = c.req.query('deleteArtifacts') === '1'
    const workspacePathQuery = c.req.query('workspacePath')
    try {
      const sessionMetadata = beeGameSessions.metadata(c.req.param('id'))
      const result = await beeGameSessions.delete(c.req.param('id'), {
        deleteArtifacts,
      })
      if (options.supabaseStore && sessionMetadata?.projectId) {
        await options.supabaseStore.deleteSession(
          options.getCurrentUser(c.req.raw).id,
          c.req.param('id'),
        )
      }
      await options.appendAuditEvent(c.req.raw, {
        actorId: options.getCurrentUser(c.req.raw).id,
        action: 'beegame_session.deleted',
        targetType: 'beegame_session',
        targetId: c.req.param('id'),
        metadata: {
          deleteArtifacts,
          deletedArtifactCount: result.deletedArtifactPaths.length,
        },
      })
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
          await options.appendAuditEvent(c.req.raw, {
            actorId: options.getCurrentUser(c.req.raw).id,
            action: 'beegame_session.deleted',
            targetType: 'beegame_session',
            targetId: c.req.param('id'),
            metadata: {
              deleteArtifacts,
              recoveredFromTranscript: true,
              deletedArtifactCount: deletedArtifactPaths.length,
            },
          })
          return c.json(result)
        } catch (fallbackErr) {
          return c.json({ error: toErrorMessage(fallbackErr) }, 404)
        }
      }
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })
}

async function deleteWorkspaceDirectoryIfSafe(
  workspacePath: string,
  dashboardDataRoot: string,
): Promise<string | undefined> {
  const dataRoot = await realpath(resolve(dashboardDataRoot))
  const resolvedWorkspace = resolve(workspacePath)
  let workspaceRoot: string
  try {
    workspaceRoot = await realpath(resolvedWorkspace)
  } catch (err) {
    if (isNodeErrorCode(err, 'ENOENT')) {
      if (resolvedWorkspace === dataRoot) return undefined
      const rel = relative(dataRoot, resolvedWorkspace)
      if (rel.startsWith('..') || isAbsolute(rel)) return undefined
      return undefined
    }
    throw err
  }
  if (workspaceRoot === dataRoot) return undefined
  const rel = relative(dataRoot, workspaceRoot)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  await rm(workspaceRoot, { recursive: true, force: true })
  return workspaceRoot
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === code,
  )
}

async function readTranscriptFromWorkspace(
  sessionId: string,
  workspacePath: string,
  defaultWorkspacePath?: string,
  dashboardDataRoot?: string,
): Promise<Response> {
  try {
    const resolvedWorkspace = await resolveSessionWorkspacePath(
      workspacePath,
      defaultWorkspacePath,
    )
    return Response.json(
      await readSessionTranscriptFromDisk(
        sessionId,
        resolvedWorkspace,
        dashboardDataRoot,
      ),
    )
  } catch (err) {
    return Response.json({ error: toErrorMessage(err) }, { status: 404 })
  }
}

async function assertSessionWorkspaceIsProjectDirectory(
  workspacePath: string,
  defaultWorkspacePath?: string,
): Promise<void> {
  if (!hasWorkspaceBoundary(defaultWorkspacePath)) return
  const defaultWorkspace = resolve(
    await getDefaultWorkspacePath({ defaultWorkspacePath }),
  )
  const resolvedWorkspace = resolve(workspacePath)
  if (resolvedWorkspace !== defaultWorkspace) return
  throw new Error(
    `Workspace path must target a project directory under the default Projects directory, not the Projects root: ${defaultWorkspace}`,
  )
}

function getDashboardDataRoot(defaultWorkspacePath?: string): string {
  return resolve(
    defaultWorkspacePath?.trim() ||
      process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      resolve(process.cwd(), 'Projects'),
  )
}

function getUserDashboardDataRoot(
  dashboardDataRoot: string,
  userId: string,
): string {
  const normalizedUserId = normalizeUserDataDirName(userId)
  if (!normalizedUserId || normalizedUserId === DEFAULT_LOCAL_USER_ID) {
    return dashboardDataRoot
  }
  return join(dashboardDataRoot, 'users', normalizedUserId)
}

function normalizeUserDataDirName(userId: string): string {
  return userId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function resolveSessionWorkspacePath(
  workspacePath: string,
  defaultWorkspacePath?: string,
): Promise<string> {
  const trimmed = workspacePath.trim()
  if (!isAbsolute(trimmed)) {
    throw new Error('Workspace path must be absolute')
  }
  const resolvedWorkspace = resolve(trimmed)
  if (!hasWorkspaceBoundary(defaultWorkspacePath)) {
    return resolvedWorkspace
  }
  const defaultWorkspace = resolve(
    await getDefaultWorkspacePath({ defaultWorkspacePath }),
  )
  const canonicalWorkspace = canonicalizeWorkspaceCandidate(
    resolvedWorkspace,
    defaultWorkspace,
    defaultWorkspacePath,
  )
  if (!isInsideOrEqual(canonicalWorkspace, defaultWorkspace)) {
    throw new Error(
      `Workspace path must stay inside the default Projects directory: ${defaultWorkspace}`,
    )
  }
  return canonicalWorkspace
}

function hasWorkspaceBoundary(defaultWorkspacePath?: string): boolean {
  return Boolean(
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      defaultWorkspacePath?.trim(),
  )
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function canonicalizeWorkspaceCandidate(
  candidate: string,
  canonicalRoot: string,
  defaultWorkspacePath?: string,
): string {
  if (isInsideOrEqual(candidate, canonicalRoot)) return candidate
  const configuredRoot = resolve(
    defaultWorkspacePath?.trim() ||
      process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      resolve(process.cwd(), 'Projects'),
  )
  const rel = relative(configuredRoot, candidate)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolve(canonicalRoot, rel)
  }
  return candidate
}

function persistModelConfigs(
  modelConfigStore: ModelConfigStoreOptions | false | undefined,
): void {
  if (modelConfigStore !== false && modelConfigStore !== undefined) {
    saveModelConfigsToStore(modelConfigStore)
  }
}

async function loadSupabaseModelConfigs(
  supabaseStore: SupabaseDashboardStore | undefined,
): Promise<void> {
  if (!supabaseStore) return
  importModelConfigSnapshot(await supabaseStore.loadModelConfigSnapshot())
}

async function persistModelConfig(
  supabaseStore: SupabaseDashboardStore | undefined,
  id: string,
  modelConfigStore: ModelConfigStoreOptions | false | undefined,
): Promise<void> {
  if (!supabaseStore) {
    persistModelConfigs(modelConfigStore)
    return
  }
  const record = exportModelConfigSnapshot().find(config => config.id === id)
  if (record) await supabaseStore.upsertModelConfig(record)
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

async function persistSupabaseSessionMetadata(
  supabaseStore: SupabaseDashboardStore | undefined,
  ownerId: string,
  beeGameSessions: BeeGameSessionManager,
  sessionId: string,
): Promise<void> {
  if (!supabaseStore) return
  const metadata = beeGameSessions.metadata(sessionId)
  if (!metadata?.projectId) return
  await supabaseStore.upsertSession(ownerId, {
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

async function persistSupabasePreviewSnapshot(
  supabaseStore: SupabaseDashboardStore | undefined,
  ownerId: string,
  beeGameSessions: BeeGameSessionManager,
  sessionId: string,
  snapshot: BeeGamePreviewSnapshot,
): Promise<void> {
  if (!supabaseStore) return
  const metadata = beeGameSessions.metadata(sessionId)
  if (!metadata?.projectId) return
  await supabaseStore.upsertPreviewSnapshot(ownerId, metadata.projectId, snapshot)
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

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}
