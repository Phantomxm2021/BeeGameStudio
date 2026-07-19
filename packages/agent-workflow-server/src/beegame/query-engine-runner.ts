import { randomUUID } from 'node:crypto'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { getMacroDefines } from '../../../../scripts/defines'
import {
  createPinnedUndiciDispatcher,
  type ApprovedOutboundTarget,
} from '@bee-game-studio/security-core'
import { getDefaultBeeGameBuiltinSkillsDir } from '@bee-game-studio/beegame-skills-core/store'
import {
  DELIVERY_VALIDATOR_AGENT_TYPE,
  DOCUMENT_REVIEWER_AGENT_TYPE,
} from './delivery-validation-agents'
import type {
  BeeGameApprovedOutboundTargets,
  BeeGamePromptInput,
  BeeGameSessionLanguage,
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionRuntime,
  BeeGameSessionSubmitInput,
  DashboardSDKMessage,
} from './session-manager'
import {
  parseNativeTerminalTaskNotification,
  type BeeGameNativeTaskNotification,
} from './native-task-notification'
import {
  normalizeResourceLibraryCall,
  RESOURCE_LIBRARY_ACTIONS,
  type ResourceLibraryAction,
} from './native-resource-library-call'
import { createNativeResourceLibraryTool } from './native-resource-library-tool'
import { createResourceSelectionClient } from './resource-selection-client'

export { parseNativeTerminalTaskNotification } from './native-task-notification'

type DynamicModule = Record<string, unknown>

// Platform service traffic is intentionally separate from model/provider
// traffic. The endpoint is supplied by server configuration, never by a model
// or project, and its credential remains in this closure rather than env.
const PLATFORM_SERVICE_FETCH = globalThis.fetch

type QueryEngineLike = {
  submitMessage(
    prompt: BeeGamePromptInput,
    options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<DashboardSDKMessage, void, unknown>
  interrupt(): void
  resetAbortController(): void
}

type NativeQueuedCommand = {
  value: BeeGamePromptInput
  mode: string
  agentId?: string
  uuid?: string
  isMeta?: boolean
}

type NativeNotificationQueue = {
  takeMainThreadTaskNotifications(): NativeQueuedCommand[]
}

type NativeSdkEventQueue = {
  drain(): DashboardSDKMessage[]
}

type NativeSandboxManager = {
  getSandboxUnavailableReason(): string | undefined
  isSandboxRequired(): boolean
  isSandboxingEnabled(): boolean
  initialize(
    ask?: (hostPattern: { host: string; port?: number }) => Promise<boolean>,
  ): Promise<void>
}

type QueryEngineConstructor = new (
  config: Record<string, unknown>,
) => QueryEngineLike

type BeeGameMacroGlobals = {
  VERSION: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  NATIVE_PACKAGE_URL: string
  PACKAGE_URL: string
  VERSION_CHANGELOG: string
}

export type MutableAppState = Record<string, unknown> & {
  toolPermissionContext?: Record<string, unknown>
  agentDefinitions?: unknown
  tasks?: Record<string, unknown>
}

type SetMutableAppState = (updater: (prev: MutableAppState) => MutableAppState) => void
type KillShellTaskFn = (taskId: string, setAppState: SetMutableAppState) => void

type PermissionDecision = {
  behavior: 'allow' | 'deny' | 'ask'
  message?: string
  decisionReason?: Record<string, unknown>
  toolUseID?: string
  updatedInput?: Record<string, unknown>
}

export const REQUIRED_BEEGAME_NATIVE_AGENT_TYPES = [
  DOCUMENT_REVIEWER_AGENT_TYPE,
  DELIVERY_VALIDATOR_AGENT_TYPE,
] as const

const RESPONSE_LANGUAGE_NAMES: Record<BeeGameSessionLanguage, string> = {
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

export function getBeeGameResponseLanguageInstruction(
  language?: BeeGameSessionLanguage,
): string | undefined {
  if (!language) return undefined
  return `Respond to the user in ${RESPONSE_LANGUAGE_NAMES[language]}. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.`
}

export function assertRequiredBeeGameNativeAgents(
  activeAgents: Record<string, unknown>[],
): void {
  const discovered = new Set(activeAgents.flatMap(agent => {
    const agentType = agent.agentType
    return typeof agentType === 'string' && agentType.trim()
      ? [agentType.trim()]
      : []
  }))
  const missing = REQUIRED_BEEGAME_NATIVE_AGENT_TYPES.filter(
    agentType => !discovered.has(agentType),
  )
  if (missing.length > 0) {
    throw new Error(
      `BeeGame native runtime capability is unavailable: ${missing.join(', ')}`,
    )
  }
}

const DEFAULT_BEEGAME_AUTO_COMPACT_WINDOW = '120000'
const COMPACT_DISABLE_ENV_KEYS = [
  'DISABLE_COMPACT',
  'DISABLE_AUTO_COMPACT',
] as const
const PRODUCTION_INSTALL_ENV_KEYS = [
  'NPM_CONFIG_PRODUCTION',
  'npm_config_production',
  'NPM_CONFIG_OMIT',
  'npm_config_omit',
  'YARN_PRODUCTION',
  'PNPM_CONFIG_PROD',
  'pnpm_config_prod',
] as const

export function createQueryEngineRunner(): BeeGameSessionRunner {
  return {
    async start(input) {
      return new QueryEngineSessionRuntime(input)
    },
  }
}

export function createBeeGameToolPermissionContext(
  base: Record<string, unknown>,
  skillReadRoots: string | string[] = [],
  _workspaceRoot?: string,
): Record<string, unknown> {
  const existingRules = isRecord(base.alwaysAllowRules)
    ? base.alwaysAllowRules
    : {}
  const existingSessionRules = Array.isArray(existingRules.session)
    ? existingRules.session.filter((value): value is string => typeof value === 'string')
    : []
  const skillReadRules = (Array.isArray(skillReadRoots)
    ? skillReadRoots
    : [skillReadRoots])
    .filter(Boolean)
    .map(root => `Read(${resolve(root)}/**)`)
  return {
    ...base,
    // Use Claude Code's native edit-accepting mode. It auto-allows file
    // mutations only in the original working directory while Bash, network,
    // sensitive paths and paths outside the workspace keep their native
    // permission checks. BeeGame must not maintain a parallel edit allowlist.
    mode: 'acceptEdits',
    isBypassPermissionsModeAvailable: false,
    ...(skillReadRules.length > 0
      ? {
          alwaysAllowRules: {
            ...existingRules,
            session: [...new Set([...existingSessionRules, ...skillReadRules])],
          },
        }
      : {}),
  }
}

export async function initializeBeeGameNativeSandbox(
  sandboxModule: DynamicModule,
  requestPermission?: BeeGameSessionRunnerStartInput['requestPermission'],
): Promise<void> {
  const sandboxManager = sandboxModule.SandboxManager as
    | NativeSandboxManager
    | undefined
  if (!sandboxManager) {
    throw new Error('Claude Code native SandboxManager is unavailable')
  }

  const unavailableReason = sandboxManager.getSandboxUnavailableReason()
  if (unavailableReason) {
    if (sandboxManager.isSandboxRequired()) {
      throw new Error(`Claude Code native sandbox is required but unavailable: ${unavailableReason}`)
    }
    console.warn(`[BeeGame] Claude Code native sandbox is unavailable: ${unavailableReason}`)
    return
  }
  if (!sandboxManager.isSandboxingEnabled()) return

  const permissionBroker = new NativeSandboxNetworkPermissionBroker(
    requestPermission,
  )
  await sandboxManager.initialize(hostPattern =>
    permissionBroker.request(hostPattern),
  )
}

/**
 * Adapts Claude's connection-level sandbox callback to a human permission
 * surface. Package managers commonly open several connections to one host at
 * once; presenting each socket as a separate user decision is neither useful
 * nor equivalent to the native TUI. Grants remain exact and worker-local.
 */
export class NativeSandboxNetworkPermissionBroker {
  private readonly allowedForSession = new Set<string>()
  private readonly inFlight = new Map<string, Promise<boolean>>()

  constructor(
    private readonly requestPermission?: BeeGameSessionRunnerStartInput['requestPermission'],
  ) {}

  request(hostPattern: { host: string; port?: number }): Promise<boolean> {
    const host = hostPattern.host.trim().toLowerCase()
    if (!host || !this.requestPermission) return Promise.resolve(false)
    const key = `${host}:${hostPattern.port ?? '*'}`
    if (this.allowedForSession.has(key)) return Promise.resolve(true)

    const pending = this.inFlight.get(key)
    if (pending) return pending

    const request = this.requestPermission({
      toolUseID: randomUUID(),
      toolName: 'SandboxNetworkAccess',
      message: `Allow network connection to ${host}?`,
      input: {
        host,
        ...(hostPattern.port !== undefined ? { port: hostPattern.port } : {}),
      },
    }).then(decision => {
      const allowed = decision.behavior === 'allow'
      if (allowed && decision.scope === 'session') {
        this.allowedForSession.add(key)
      }
      return allowed
    }).finally(() => {
      this.inFlight.delete(key)
    })

    this.inFlight.set(key, request)
    return request
  }
}

type DelegatedResourceLibraryCall = {
  action: ResourceLibraryAction
  input: Record<string, unknown>
}

/**
 * Restores the target tool's permission semantics when Claude Code invokes a
 * deferred ResourceLibrary tool through ExecuteExtraTool. A session grant is
 * intentionally scoped to ResourceLibrary mutations in this worker and never
 * grants the ExecuteExtraTool wrapper itself.
 */
export class NativeExtraToolPermissionBroker {
  private readonly allowedForSession = new Set<string>()
  private readonly inFlight = new Map<string, Promise<PermissionDecision>>()

  constructor(
    private readonly getRequestPermission: () =>
      | BeeGameSessionRunnerStartInput['requestPermission']
      | undefined,
  ) {}

  authorize(input: {
    toolName: string
    toolInput: Record<string, unknown>
    toolUseID: string
  }): Promise<PermissionDecision | undefined> {
    const normalized = normalizeResourceLibraryCall(input.toolName, input.toolInput)
    if (!normalized) return Promise.resolve(undefined)
    if (!normalized.validAction) {
      const received = normalized.action ? ` "${normalized.action}"` : ''
      return Promise.resolve({
        behavior: 'deny',
        message: `Unsupported ResourceLibrary action${received}. Allowed actions: ${RESOURCE_LIBRARY_ACTIONS.join(', ')}.`,
        decisionReason: {
          type: 'other',
          reason: 'beegame_invalid_resource_library_action',
        },
        toolUseID: input.toolUseID,
      })
    }
    const delegated: DelegatedResourceLibraryCall = {
      action: normalized.validAction,
      input: normalized.input,
    }
    if (delegated.action !== 'import_elements') {
      return Promise.resolve({
        behavior: 'allow',
        updatedInput: input.toolInput,
        decisionReason: {
          type: 'other',
          reason: 'beegame_read_only_resource_library',
        },
        toolUseID: input.toolUseID,
      })
    }

    const capabilityKey = 'ResourceLibrary:project-mutation'
    if (this.allowedForSession.has(capabilityKey)) {
      return Promise.resolve({
        behavior: 'allow',
        updatedInput: input.toolInput,
        decisionReason: {
          type: 'other',
          reason: 'beegame_session_resource_library_grant',
        },
        toolUseID: input.toolUseID,
      })
    }

    const pending = this.inFlight.get(capabilityKey)
    if (pending) return pending.then(decision => ({ ...decision, toolUseID: input.toolUseID }))
    const requestPermission = this.getRequestPermission()
    if (!requestPermission) {
      return Promise.resolve({
        behavior: 'deny',
        message: 'Dashboard permission channel is unavailable.',
        decisionReason: {
          type: 'other',
          reason: 'dashboard_permission_context_missing',
        },
        toolUseID: input.toolUseID,
      })
    }

    const request = requestPermission({
      toolUseID: input.toolUseID,
      toolName: 'ResourceLibrary',
      message: `Allow ${Array.isArray(delegated.input.selections) ? delegated.input.selections.length : 0} explicitly selected Resource Library element(s) to be copied into this project?`,
      input: delegated.input,
    }).then(decision => {
      if (decision.behavior === 'allow' && decision.scope === 'session') {
        this.allowedForSession.add(capabilityKey)
      }
      if (decision.behavior === 'allow') {
        return {
          behavior: 'allow' as const,
          updatedInput: input.toolInput,
          decisionReason: {
            type: 'other',
            reason: 'dashboard_permission_approved',
          },
          toolUseID: input.toolUseID,
        }
      }
      return {
        behavior: 'deny' as const,
        message: decision.message ?? 'Denied from dashboard',
        decisionReason: {
          type: 'other',
          reason: 'dashboard_permission_denied',
        },
        toolUseID: input.toolUseID,
      }
    }).finally(() => {
      this.inFlight.delete(capabilityKey)
    })
    this.inFlight.set(capabilityKey, request)
    return request
  }
}

export async function resolveBeeGameSkillReadRoots(
  env: Record<string, string>,
  builtinSkillsRoot = getDefaultBeeGameBuiltinSkillsDir(),
): Promise<string[]> {
  const runtimeSkillsRoot = resolve(
    env.BEEGAME_CONFIG_DIR ?? join(homedir(), '.beegame'),
    'skills',
  )
  const canonicalRoots = await Promise.all([
    runtimeSkillsRoot,
    builtinSkillsRoot,
  ].map(root => realpath(root)))
  return [...new Set(canonicalRoots)]
}

class QueryEngineSessionRuntime implements BeeGameSessionRuntime {
  private engine: QueryEngineLike | null = null
  private appState: MutableAppState | null = null
  private currentSubmitInput: BeeGameSessionSubmitInput | null = null
  private activateNativeSession: (() => void) | null = null
  private notificationQueue: NativeNotificationQueue | null = null
  private sdkEventQueue: NativeSdkEventQueue | null = null
  private readonly consumedTaskNotifications = new Set<string>()

  constructor(private readonly input: BeeGameSessionRunnerStartInput) {}

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    await withRuntimeEnvironment(
      this.input.cwd,
      this.input.env,
      this.input.approvedOutboundTargets,
      async () => {
        this.currentSubmitInput = input
        const engine = await this.ensureEngine()
        // The worker owns one native session. Reactivate it before every turn
        // so a native compaction or resume transition cannot leave a stale
        // bootstrap pointer inside that worker.
        this.activateNativeSession?.()
        if (input.signal.aborted) {
          this.currentSubmitInput = null
          return
        }

        const abort = () => {
          engine.interrupt()
        }
        input.signal.addEventListener('abort', abort, { once: true })
        try {
          await this.runNativeTurn(engine, input.prompt, input)
          await this.drainNativeBackgroundTasks(engine, input)
        } finally {
          input.signal.removeEventListener('abort', abort)
          this.currentSubmitInput = null
        }
      },
    )
  }

  stop(): void {
    this.engine?.interrupt()
    void stopRunningNativeBackgroundTasks(this.appState, updater => {
      if (!this.appState) throw new Error('App state was not initialized')
      this.appState = updater(this.appState)
    })
  }

  private async runNativeTurn(
    engine: QueryEngineLike,
    prompt: BeeGamePromptInput,
    input: BeeGameSessionSubmitInput,
    options?: { uuid?: string; isMeta?: boolean },
  ): Promise<void> {
    if (input.signal.aborted) return
    this.activateNativeSession?.()
    engine.resetAbortController()
    await consumeNativeMessageStream({
      stream: engine.submitMessage(prompt, options),
      signal: input.signal,
      flushProgress: () => this.flushNativeSdkEvents(input),
      onMessage: message => {
        const consumedTaskId = getCompletedNativeTaskOutputTaskId(message)
        if (consumedTaskId) this.consumedTaskNotifications.add(consumedTaskId)
        input.onMessage(message)
      },
    })
  }

  private flushNativeSdkEvents(input: BeeGameSessionSubmitInput): void {
    for (const event of this.sdkEventQueue?.drain() ?? []) {
      input.onMessage(event)
    }
  }

  /**
   * QueryEngine owns the conversation, while Claude Code's TUI/print entrypoints
   * own the outer loop that waits for background tasks and feeds their native
   * task-notifications back into that conversation. BeeGame embeds QueryEngine
   * directly, so it must provide the same transport loop here. It deliberately
   * does not inspect notification contents or make workflow decisions.
   */
  private async drainNativeBackgroundTasks(
    engine: QueryEngineLike,
    input: BeeGameSessionSubmitInput,
  ): Promise<void> {
    await drainNativeBackgroundNotifications({
      signal: input.signal,
      takeNotifications: () =>
        this.notificationQueue?.takeMainThreadTaskNotifications() ?? [],
      hasRunningTasks: () => hasRunningNativeBackgroundTasks(this.appState),
      flushProgress: () => this.flushNativeSdkEvents(input),
      onTerminalNotification: notification =>
        (this.input.onNativeTaskNotification ?? input.onNativeTaskNotification)?.(
          notification,
        ),
      runNotification: notification => this.runNativeTurn(
        engine,
        notification.value,
        input,
        {
          ...(notification.uuid ? { uuid: notification.uuid } : {}),
          ...(notification.isMeta !== undefined
            ? { isMeta: notification.isMeta }
            : {}),
        },
      ),
      consumedNotificationKeys: this.consumedTaskNotifications,
    })
  }

  private async ensureEngine(): Promise<QueryEngineLike> {
    if (this.engine) return this.engine

    ensureBeeGameMacroGlobals()

    const [
      queryEngineModule,
      toolModule,
      toolsModule,
      commandsModule,
      agentsModule,
      stateModule,
      cacheModule,
      bootstrapModule,
      configModule,
      permissionsModule,
      conversationRecoveryModule,
      messageQueueModule,
      sdkEventQueueModule,
      sandboxModule,
    ] = await Promise.all([
      loadRootModule('QueryEngine.js'),
      loadRootModule('Tool.js'),
      loadRootModule('tools.js'),
      loadRootModule('commands.js'),
      loadBuiltinToolsModule('tools/AgentTool/loadAgentsDir.js'),
      loadRootModule('state/AppStateStore.js'),
      loadRootModule('utils/fileStateCache.js'),
      loadRootModule('bootstrap/state.js'),
      loadRootModule('utils/config.js'),
      loadRootModule('utils/permissions/permissions.js'),
      loadRootModule('utils/conversationRecovery.js'),
      loadRootModule('utils/messageQueueManager.js'),
      loadRootModule('utils/sdkEventQueue.js'),
      loadRootModule('utils/sandbox/sandbox-adapter.js'),
    ])

    this.notificationQueue = createNativeNotificationQueue(messageQueueModule)
    this.sdkEventQueue = createNativeSdkEventQueue(sdkEventQueueModule)

    initializeBeeGameNativeQueryMode(bootstrapModule)
    call(configModule, 'enableConfigs')
    enableBeeGameRuntimeCompaction(configModule)
    call(
      bootstrapModule,
      'setSessionPersistenceDisabled',
      !(await canWriteBeeGameConfigDir()),
    )
    this.activateNativeSession = () => {
      call(
        bootstrapModule,
        'switchSession',
        this.input.sessionId,
        call(bootstrapModule, 'getSessionProjectDir'),
      )
      call(bootstrapModule, 'setOriginalCwd', this.input.cwd)
    }
    this.activateNativeSession()
    await initializeBeeGameNativeSandbox(
      sandboxModule,
      this.input.requestPermission,
    )

    const skillReadRoots = await resolveBeeGameSkillReadRoots(this.input.env)
    const permissionContext = createBeeGameToolPermissionContext(
      call(
        toolModule,
        'getEmptyToolPermissionContext',
      ) as Record<string, unknown>,
      skillReadRoots,
      this.input.cwd,
    )
    const nativeTools = call(toolsModule, 'getTools', permissionContext) as unknown[]
    const resourceTool = this.input.resourceSelectionConfig
      ? createNativeResourceLibraryTool({
          buildTool: definition => call(toolModule, 'buildTool', definition),
          workspacePath: this.input.cwd,
          client: createResourceSelectionClient({
            ...this.input.resourceSelectionConfig,
            fetchImpl: PLATFORM_SERVICE_FETCH,
          }),
          fetchImpl: PLATFORM_SERVICE_FETCH,
        })
      : undefined
    const tools = resourceTool ? [...nativeTools, resourceTool] : nativeTools
    const [commands, discoveredAgentDefinitions] = await Promise.all([
      callAsync(commandsModule, 'getCommands', this.input.cwd),
      callAsync(agentsModule, 'getAgentDefinitionsWithOverrides', this.input.cwd),
    ])
    const appState = {
      ...(call(stateModule, 'getDefaultAppState') as MutableAppState),
      agentDefinitions: discoveredAgentDefinitions,
      toolPermissionContext: permissionContext,
    }
    this.appState = appState
    const extraToolPermissionBroker = new NativeExtraToolPermissionBroker(
      () => this.input.requestPermission ?? this.currentSubmitInput?.requestPermission,
    )
    const canUseTool = async (
      tool: unknown,
      toolInput: Record<string, unknown>,
      toolUseContext: unknown,
      assistantMessage: unknown,
      toolUseID: string,
      forceDecision?: PermissionDecision,
    ): Promise<PermissionDecision> => {
      const toolName = getToolName(tool)
      const delegatedDecision = await extraToolPermissionBroker.authorize({
        toolName,
        toolInput,
        toolUseID,
      })
      if (delegatedDecision) return delegatedDecision
      const result = (await callAsync(
        permissionsModule,
        'hasPermissionsToUseTool',
        tool,
        toolInput,
        toolUseContext,
        assistantMessage,
        toolUseID,
        forceDecision,
      )) as PermissionDecision
      if (result.behavior !== 'ask') {
        return result.behavior === 'allow'
          ? { ...result, updatedInput: result.updatedInput ?? toolInput }
          : result
      }
      const requestPermission = this.input.requestPermission
        ?? this.currentSubmitInput?.requestPermission
      if (!requestPermission) {
        return {
          behavior: 'deny',
          message: 'Dashboard permission channel is unavailable.',
          decisionReason: {
            type: 'other',
            reason: 'dashboard_permission_context_missing',
          },
          toolUseID,
        }
      }
      const decision = await requestPermission({
        toolUseID,
        toolName,
        message: result.message ?? 'Tool permission is required.',
        input: toolInput,
      })
      if (decision.behavior === 'allow') {
        return {
          behavior: 'allow',
          updatedInput: result.updatedInput ?? toolInput,
          decisionReason: {
            type: 'other',
            reason: 'dashboard_permission_approved',
          },
          toolUseID,
        }
      }
      return {
        behavior: 'deny',
        message: decision.message ?? 'Denied from dashboard',
        decisionReason: {
          type: 'other',
          reason: 'dashboard_permission_denied',
        },
        toolUseID,
      }
    }

    const QueryEngine = getConstructor<QueryEngineConstructor>(
      queryEngineModule,
      'QueryEngine',
    )
    const FileStateCache = getConstructor<new (
      maxEntries: number,
      maxBytes: number,
    ) => unknown>(cacheModule, 'FileStateCache')
    const activeAgents = getField<Record<string, unknown>[]>(
      discoveredAgentDefinitions,
      'activeAgents',
      [],
    )
    assertRequiredBeeGameNativeAgents(activeAgents)
    const resumedConversation = await loadInitialMessagesForResume(
      conversationRecoveryModule,
      this.input.resumeSessionId,
    )

    this.engine = new QueryEngine({
      cwd: this.input.cwd,
      tools,
      commands,
      mcpClients: [],
      agents: activeAgents,
      canUseTool,
      getAppState: () => {
        if (!this.appState) throw new Error('App state was not initialized')
        return this.appState
      },
      setAppState: (updater: unknown) => {
        if (!this.appState) throw new Error('App state was not initialized')
        if (typeof updater !== 'function') {
          throw new Error('Invalid AppState updater')
        }
        this.appState = (updater as (prev: MutableAppState) => MutableAppState)(
          this.appState,
        )
      },
      readFileCache: new FileStateCache(500, 50 * 1024 * 1024),
      ...(resumedConversation.length > 0
        ? { initialMessages: resumedConversation }
        : {}),
      includePartialMessages: true,
      replayUserMessages: true,
      ...(getBeeGameResponseLanguageInstruction(this.input.language)
        ? {
            appendSystemPrompt: getBeeGameResponseLanguageInstruction(
              this.input.language,
            ),
          }
        : {}),
    })

    return this.engine
  }
}

/**
 * QueryEngine is the native non-interactive Claude Code entrypoint. BeeGame
 * embeds it without running main.tsx, so mirror the entrypoint's bootstrap
 * flag before tools and agents are assembled. Without this, feature-gated
 * fork agents can mistake the dashboard worker for an interactive TUI and
 * force every explicitly foreground subagent into the background.
 *
 * This does not implement a BeeGame task mode. It only keeps Claude Code's
 * process-global bootstrap state consistent with QueryEngine's own
 * `isNonInteractiveSession: true` tool context.
 */
export function initializeBeeGameNativeQueryMode(
  bootstrapModule: Record<string, unknown>,
): void {
  call(bootstrapModule, 'setIsInteractive', false)
}

/**
 * QueryEngine messages and native agent progress use separate Claude Code
 * transports. Keep draining the progress transport while the next model or
 * tool message is pending so the dashboard observes native progress in real
 * time instead of receiving a large replay at turn completion. The messages
 * are forwarded unchanged and never influence the native turn.
 */
export async function consumeNativeMessageStream({
  stream,
  signal,
  onMessage,
  flushProgress,
  waitForProgress = waitForNativeBackgroundProgress,
}: {
  stream: AsyncIterable<DashboardSDKMessage>
  signal: AbortSignal
  onMessage(message: DashboardSDKMessage): void
  flushProgress(): void
  waitForProgress?(signal: AbortSignal): Promise<void>
}): Promise<void> {
  const iterator = stream[Symbol.asyncIterator]()
  let pending = iterator.next()
  try {
    while (!signal.aborted) {
      const outcome = await Promise.race([
        pending.then(result => ({ kind: 'message' as const, result })),
        waitForProgress(signal).then(() => ({ kind: 'progress' as const })),
      ])
      if (outcome.kind === 'progress') {
        flushProgress()
        continue
      }
      flushProgress()
      if (outcome.result.done) return
      onMessage(outcome.result.value)
      pending = iterator.next()
    }
  } finally {
    flushProgress()
  }
}

export function ensureBeeGameMacroGlobals(): void {
  const target = globalThis as typeof globalThis & { MACRO?: BeeGameMacroGlobals }
  if (target.MACRO) return
  target.MACRO = Object.fromEntries(
    Object.entries(getMacroDefines()).map(([key, value]) => [
      key.replace('MACRO.', ''),
      JSON.parse(value) as string,
    ]),
  ) as BeeGameMacroGlobals
}

export async function stopRunningLocalShellTasks(
  appState: MutableAppState | null,
  setAppState: SetMutableAppState,
  killTaskFn?: KillShellTaskFn,
): Promise<string[]> {
  const taskIds = collectRunningLocalShellTaskIds(appState)
  if (taskIds.length === 0) return []
  const killTask = killTaskFn ?? await loadKillShellTask()
  for (const taskId of taskIds) {
    killTask(taskId, setAppState)
  }
  return taskIds
}

export function hasRunningNativeBackgroundTasks(
  appState: MutableAppState | null,
): boolean {
  const tasks = appState?.tasks
  if (!tasks || typeof tasks !== 'object') return false
  return Object.values(tasks).some(task => {
    if (!isRecord(task)) return false
    if (task.status !== 'running' && task.status !== 'pending') return false
    if (task.isBackgrounded === false) return false
    // Claude Code intentionally keeps teammates alive for the whole session;
    // its own headless queue loop excludes them for the same reason.
    return task.type !== 'in_process_teammate'
  })
}

export function createNativeNotificationQueue(
  messageQueueModule: DynamicModule,
): NativeNotificationQueue {
  const dequeueAllMatching = messageQueueModule.dequeueAllMatching
  if (typeof dequeueAllMatching !== 'function') {
    throw new Error('Missing function export: dequeueAllMatching')
  }
  return {
    takeMainThreadTaskNotifications() {
      return (dequeueAllMatching((command: NativeQueuedCommand) =>
        command.agentId === undefined && command.mode === 'task-notification'
      ) as NativeQueuedCommand[])
    },
  }
}

export function createNativeSdkEventQueue(
  sdkEventQueueModule: DynamicModule,
): NativeSdkEventQueue {
  const drainSdkEvents = sdkEventQueueModule.drainSdkEvents
  if (typeof drainSdkEvents !== 'function') {
    throw new Error('Missing function export: drainSdkEvents')
  }
  return {
    drain: () => drainSdkEvents() as DashboardSDKMessage[],
  }
}

export async function drainNativeBackgroundNotifications({
  signal,
  takeNotifications,
  hasRunningTasks,
  runNotification,
  flushProgress = () => {},
  waitForProgress = waitForNativeBackgroundProgress,
  waitForTaskRegistration = waitForNativeTaskRegistration,
  consumedNotificationKeys = new Set<string>(),
  onTerminalNotification = () => {},
}: {
  signal: AbortSignal
  takeNotifications(): NativeQueuedCommand[]
  hasRunningTasks(): boolean
  runNotification(command: NativeQueuedCommand): Promise<void>
  flushProgress?(): void
  waitForProgress?(signal: AbortSignal): Promise<void>
  waitForTaskRegistration?(signal: AbortSignal): Promise<void>
  consumedNotificationKeys?: Set<string>
  onTerminalNotification?(notification: BeeGameNativeTaskNotification): void
}): Promise<void> {
  let idleRegistrationChecked = false
  while (!signal.aborted) {
    flushProgress()
    const notifications = takeNotifications()
    if (notifications.length > 0) {
      for (const notification of notifications) {
        const terminal = parseNativeTerminalTaskNotification(notification)
        if (!terminal) continue
        const keys = [
          terminal.toolUseId,
          terminal.taskId,
          notification.uuid,
        ].filter((value): value is string => Boolean(value))
        if (keys.some(key => consumedNotificationKeys.has(key))) continue
        for (const key of keys) consumedNotificationKeys.add(key)
        onTerminalNotification({
          value: notification.value as string,
          ...(notification.uuid ? { uuid: notification.uuid } : {}),
          ...(notification.isMeta !== undefined
            ? { isMeta: notification.isMeta }
            : {}),
        })
        await runNotification(notification)
        idleRegistrationChecked = false
        if (signal.aborted) return
      }
      continue
    }
    if (!hasRunningTasks()) {
      // Foreground-to-background conversion resolves the Agent tool before
      // its async task registration becomes visible in app state. Give the
      // native registration microtask one bounded chance to settle so the
      // headless transport does not close the session bridge in that gap.
      if (!idleRegistrationChecked) {
        idleRegistrationChecked = true
        await waitForTaskRegistration(signal)
        continue
      }
      flushProgress()
      return
    }
    await waitForProgress(signal)
  }
}

/**
 * Detects only a structured Claude Code TaskOutput terminal retrieval. The
 * task result has already been placed in the native conversation at this
 * point, so replaying its later task-notification would duplicate the same
 * completion. No task output or workflow semantics are interpreted here.
 */
export function getCompletedNativeTaskOutputTaskId(
  message: DashboardSDKMessage,
): string | undefined {
  if (message.type !== 'user' || !isRecord(message.tool_use_result)) {
    return undefined
  }
  if (message.tool_use_result.retrieval_status !== 'success') return undefined
  const task = message.tool_use_result.task
  if (!isRecord(task)) return undefined
  const status = task.status
  if (
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'stopped' &&
    status !== 'killed'
  ) return undefined
  const taskId = task.task_id
  return typeof taskId === 'string' && taskId.trim()
    ? taskId.trim()
    : undefined
}

async function waitForNativeBackgroundProgress(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>(resolveWait => {
    const timer = setTimeout(finish, 100)
    const onAbort = () => finish()
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolveWait()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitForNativeTaskRegistration(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>(resolveWait => {
    const timer = setTimeout(finish, 10)
    const onAbort = () => finish()
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolveWait()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function stopRunningNativeBackgroundTasks(
  appState: MutableAppState | null,
  setAppState: SetMutableAppState,
): Promise<string[]> {
  const tasks = appState?.tasks
  if (!tasks || typeof tasks !== 'object') return []
  const taskIds = Object.entries(tasks)
    .filter(([, task]) => {
      if (!isRecord(task)) return false
      return task.status === 'running' || task.status === 'pending'
    })
    .map(([taskId]) => taskId)
  if (taskIds.length === 0) return []

  const stopTaskModule = await loadRootModule('tasks/stopTask.js')
  let currentState = appState
  for (const taskId of taskIds) {
    try {
      await callAsync(stopTaskModule, 'stopTask', taskId, {
        getAppState: () => currentState,
        setAppState: (updater: (prev: MutableAppState) => MutableAppState) => {
          if (!currentState) return
          currentState = updater(currentState)
          setAppState(() => currentState as MutableAppState)
        },
      })
    } catch {
      // A task can finish between collection and cancellation. Native task
      // state remains authoritative; stopping the rest must continue.
    }
  }
  return taskIds
}

function collectRunningLocalShellTaskIds(appState: MutableAppState | null): string[] {
  const tasks = appState?.tasks
  if (!tasks || typeof tasks !== 'object') return []
  return Object.entries(tasks)
    .filter(([, task]) => isRunningLocalShellTaskRecord(task))
    .map(([taskId]) => taskId)
}

function isRunningLocalShellTaskRecord(task: unknown): boolean {
  if (typeof task !== 'object' || task === null) return false
  const record = task as Record<string, unknown>
  return record.type === 'local_bash' && record.status === 'running'
}

async function loadKillShellTask(): Promise<KillShellTaskFn> {
  const module = await loadRootModule('tasks/LocalShellTask/killShellTasks.js')
  const killTask = module.killTask
  if (typeof killTask !== 'function') {
    throw new Error('Missing function export: killTask')
  }
  return killTask as KillShellTaskFn
}

async function loadInitialMessagesForResume(
  conversationRecoveryModule: DynamicModule,
  sessionId?: string,
): Promise<unknown[]> {
  if (!sessionId) return []
  try {
    const result = await callAsync(
      conversationRecoveryModule,
      'loadConversationForResume',
      sessionId,
      undefined,
    ) as BeeGameResumeConversation | null
    return Array.isArray(result?.messages) ? result.messages : []
  } catch {
    return []
  }
}

type BeeGameResumeConversation = {
  messages?: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  return typeof field === 'string' ? field.trim() : ''
}

async function canWriteBeeGameConfigDir(): Promise<boolean> {
  const configDir = (
    process.env.BEEGAME_CONFIG_DIR ?? join(homedir(), '.beegame')
  ).normalize('NFC')
  const probePath = join(
    configDir,
    '.dashboard-write-test',
    `${randomUUID()}.tmp`,
  )
  try {
    await mkdir(join(configDir, '.dashboard-write-test'), { recursive: true })
    await writeFile(probePath, '')
    await rm(probePath, { force: true })
    return true
  } catch {
    return false
  }
}

function getToolName(tool: unknown): string {
  if (
    typeof tool === 'object' &&
    tool !== null &&
    'name' in tool &&
    typeof tool.name === 'string'
  ) return tool.name
  return 'Tool'
}

async function withRuntimeEnvironment(
  cwd: string,
  env: Record<string, string>,
  approvedOutboundTargets: BeeGameApprovedOutboundTargets,
  fn: () => Promise<void>,
): Promise<void> {
  const previousCwd = process.cwd()
  const previousEnv = new Map<string, string | undefined>()
  const previousFetch = globalThis.fetch
  const pinnedFetch = createBeeGamePinnedFetch(previousFetch, approvedOutboundTargets)

  const runtimeEnv = getBeeGameRuntimeEnvironment(env)
  for (const key of [
    ...COMPACT_DISABLE_ENV_KEYS,
    ...PRODUCTION_INSTALL_ENV_KEYS,
  ]) {
    previousEnv.set(key, process.env[key])
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(runtimeEnv)) {
    previousEnv.set(key, process.env[key])
    process.env[key] = value
  }

  try {
    process.chdir(cwd)
    globalThis.fetch = pinnedFetch
    await fn()
  } finally {
    process.chdir(previousCwd)
    globalThis.fetch = previousFetch
    await pinnedFetch.close()
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

type PinnedRuntimeFetch = typeof fetch & {
  close(): Promise<void>
}

type RuntimeDispatcher = {
  close?: () => Promise<void> | void
  destroy?: () => Promise<void> | void
}

export async function closeBeeGameRuntimeDispatcher(dispatcher: RuntimeDispatcher): Promise<void> {
  if (typeof dispatcher.close === 'function') {
    await dispatcher.close()
    return
  }
  if (typeof dispatcher.destroy === 'function') {
    await dispatcher.destroy()
  }
}

export function createBeeGamePinnedFetch(
  baseFetch: typeof fetch,
  approvedOutboundTargets: Record<string, ApprovedOutboundTarget>,
): PinnedRuntimeFetch {
  const dispatchers = new Map<string, ReturnType<typeof createPinnedUndiciDispatcher>>()
  for (const target of Object.values(approvedOutboundTargets)) {
    if (!target.trustedDevelopmentProxy && !dispatchers.has(target.url.origin)) {
      dispatchers.set(target.url.origin, createPinnedUndiciDispatcher(target))
    }
  }
  const approvedOrigins = new Map(
    Object.values(approvedOutboundTargets).map(target => [target.url.origin, target]),
  )

  const pinnedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = getFetchRequestUrl(input)
    const protocol = getFetchRequestProtocol(requestUrl)
    const origin = getFetchRequestOrigin(input)
    const approvedTarget = origin ? approvedOrigins.get(origin) : undefined
    const dispatcher = origin ? dispatchers.get(origin) : undefined
    if ((protocol === 'http:' || protocol === 'https:') && !approvedTarget) {
      throw new Error('Outbound URL is not permitted')
    }
    return dispatcher
      ? baseFetch(input, { ...init, redirect: 'error', dispatcher } as RequestInit)
      : approvedTarget
        ? baseFetch(input, { ...init, redirect: 'error' })
        : baseFetch(input, init)
  }) as PinnedRuntimeFetch
  pinnedFetch.close = async () => {
    await Promise.all([...dispatchers.values()].map(closeBeeGameRuntimeDispatcher))
  }
  return pinnedFetch
}

function getFetchRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function getFetchRequestOrigin(input: RequestInfo | URL): string | undefined {
  try {
    return new URL(getFetchRequestUrl(input)).origin
  } catch {
    return undefined
  }
}

function getFetchRequestProtocol(value: string): string | undefined {
  try {
    return new URL(value).protocol
  } catch {
    return undefined
  }
}

function getBeeGameRuntimeEnvironment(
  env: Record<string, string>,
): Record<string, string> {
  const runtimeEnv = { ...env }
  for (const key of COMPACT_DISABLE_ENV_KEYS) {
    delete runtimeEnv[key]
  }
  return {
    ...runtimeEnv,
    NODE_ENV: runtimeEnv.NODE_ENV === 'production'
      ? 'development'
      : (runtimeEnv.NODE_ENV ?? 'development'),
    NPM_CONFIG_PRODUCTION: 'false',
    npm_config_production: 'false',
    NPM_CONFIG_OMIT: '',
    npm_config_omit: '',
    YARN_PRODUCTION: 'false',
    PNPM_CONFIG_PROD: 'false',
    pnpm_config_prod: 'false',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW:
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ??
      process.env.BEEGAME_AUTO_COMPACT_WINDOW ??
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ??
      DEFAULT_BEEGAME_AUTO_COMPACT_WINDOW,
  }
}

function enableBeeGameRuntimeCompaction(configModule: DynamicModule): void {
  const config = call(configModule, 'getGlobalConfig')
  if (typeof config !== 'object' || config === null) return
  ;(config as { autoCompactEnabled?: boolean }).autoCompactEnabled = true
}

function loadRootModule(path: string): Promise<DynamicModule> {
  return import(`../../../../src/${path}`) as Promise<DynamicModule>
}

function loadBuiltinToolsModule(path: string): Promise<DynamicModule> {
  return import(`../../../builtin-tools/src/${path}`) as Promise<DynamicModule>
}

function call(
  module: DynamicModule,
  exportName: string,
  ...args: unknown[]
): unknown {
  const fn = module[exportName]
  if (typeof fn !== 'function') {
    throw new Error(`Missing function export: ${exportName}`)
  }
  return fn(...args)
}

async function callAsync(
  module: DynamicModule,
  exportName: string,
  ...args: unknown[]
): Promise<unknown> {
  return call(module, exportName, ...args)
}

function getConstructor<T>(module: DynamicModule, exportName: string): T {
  const value = module[exportName]
  if (typeof value !== 'function') {
    throw new Error(`Missing constructor export: ${exportName}`)
  }
  return value as T
}

function getField<T>(value: unknown, field: string, fallback: T): T {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    return fallback
  }
  return (value as Record<string, unknown>)[field] as T
}
