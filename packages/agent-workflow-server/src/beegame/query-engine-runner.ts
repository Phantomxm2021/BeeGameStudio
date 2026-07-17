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

type DynamicModule = Record<string, unknown>

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
    // This is a Claude Code native permission mode, not a BeeGame-owned
    // allowlist. Its evaluator still asks for commands and sensitive access.
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
    for await (const message of engine.submitMessage(prompt, options)) {
      const consumedTaskId = getCompletedNativeTaskOutputTaskId(message)
      if (consumedTaskId) this.consumedTaskNotifications.add(consumedTaskId)
      input.onMessage(message)
      if (input.signal.aborted) break
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
      flushProgress: () => {
        for (const event of this.sdkEventQueue?.drain() ?? []) {
          input.onMessage(event)
        }
      },
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
    ])

    this.notificationQueue = createNativeNotificationQueue(messageQueueModule)
    this.sdkEventQueue = createNativeSdkEventQueue(sdkEventQueueModule)

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

    const skillReadRoots = await resolveBeeGameSkillReadRoots(this.input.env)
    const permissionContext = createBeeGameToolPermissionContext(
      call(
        toolModule,
        'getEmptyToolPermissionContext',
      ) as Record<string, unknown>,
      skillReadRoots,
    )
    const tools = call(toolsModule, 'getTools', permissionContext)
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
    const canUseTool = async (
      tool: unknown,
      toolInput: Record<string, unknown>,
      toolUseContext: unknown,
      assistantMessage: unknown,
      toolUseID: string,
      forceDecision?: PermissionDecision,
    ): Promise<PermissionDecision> => {
      const toolName = getToolName(tool)
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
      const submitInput = this.currentSubmitInput
      if (!submitInput) {
        return {
          behavior: 'deny',
          message: 'Dashboard permission request was created outside a turn.',
          decisionReason: {
            type: 'other',
            reason: 'dashboard_permission_context_missing',
          },
          toolUseID,
        }
      }
      const decision = await submitInput.requestPermission({
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
  consumedNotificationKeys = new Set<string>(),
}: {
  signal: AbortSignal
  takeNotifications(): NativeQueuedCommand[]
  hasRunningTasks(): boolean
  runNotification(command: NativeQueuedCommand): Promise<void>
  flushProgress?(): void
  waitForProgress?(signal: AbortSignal): Promise<void>
  consumedNotificationKeys?: Set<string>
}): Promise<void> {
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
        await runNotification(notification)
        if (signal.aborted) return
      }
      continue
    }
    if (!hasRunningTasks()) {
      flushProgress()
      return
    }
    await waitForProgress(signal)
  }
}

type NativeTerminalTaskNotification = {
  key: string
  taskId?: string
  toolUseId?: string
  status: 'completed' | 'failed' | 'stopped' | 'killed'
}

/**
 * Reads only Claude Code's native task-notification transport envelope. It
 * does not interpret task output or make workflow decisions. Status-less
 * progress notifications are deliberately not submitted to the model.
 */
export function parseNativeTerminalTaskNotification(
  command: NativeQueuedCommand,
): NativeTerminalTaskNotification | undefined {
  if (typeof command.value !== 'string') return undefined
  const value = command.value
  const status = readXmlTransportField(value, 'status')
  if (
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'stopped' &&
    status !== 'killed'
  ) return undefined
  const taskId = readXmlTransportField(value, 'task-id')
  const toolUseId = readXmlTransportField(value, 'tool-use-id')
  const key = toolUseId || taskId || command.uuid
  if (!key) return undefined
  return {
    key,
    ...(taskId ? { taskId } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    status,
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

function readXmlTransportField(value: string, field: string): string | undefined {
  const opening = `<${field}>`
  const closing = `</${field}>`
  const start = value.indexOf(opening)
  if (start < 0) return undefined
  const contentStart = start + opening.length
  const end = value.indexOf(closing, contentStart)
  if (end < 0) return undefined
  const content = value.slice(contentStart, end).trim()
  return content || undefined
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
