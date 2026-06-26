import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionRuntime,
  BeeGameSessionSubmitInput,
  DashboardSDKMessage,
} from './session-manager'

type DynamicModule = Record<string, unknown>

type QueryEngineLike = {
  submitMessage(prompt: string): AsyncGenerator<DashboardSDKMessage, void, unknown>
  interrupt(): void
  resetAbortController(): void
}

type QueryEngineConstructor = new (
  config: Record<string, unknown>,
) => QueryEngineLike

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

let runtimeQueue: Promise<void> = Promise.resolve()

export function createQueryEngineRunner(): BeeGameSessionRunner {
  return {
    async start(input) {
      return new QueryEngineSessionRuntime(input)
    },
  }
}

class QueryEngineSessionRuntime implements BeeGameSessionRuntime {
  private engine: QueryEngineLike | null = null
  private appState: MutableAppState | null = null
  private currentSubmitInput: BeeGameSessionSubmitInput | null = null

  constructor(private readonly input: BeeGameSessionRunnerStartInput) {}

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    await serializeRuntimeTurn(async () => {
      await withRuntimeEnvironment(this.input.cwd, this.input.env, async () => {
        const engine = await this.ensureEngine()
        if (input.signal.aborted) return

        engine.resetAbortController()
        this.currentSubmitInput = input
        const abort = () => {
          engine.interrupt()
        }
        input.signal.addEventListener('abort', abort, { once: true })
        try {
          for await (const message of engine.submitMessage(input.prompt)) {
            input.onMessage(message)
            if (input.signal.aborted) break
          }
        } finally {
          input.signal.removeEventListener('abort', abort)
          this.currentSubmitInput = null
        }
      })
    })
  }

  stop(): void {
    this.engine?.interrupt()
    void stopRunningLocalShellTasks(this.appState, updater => {
      if (!this.appState) throw new Error('App state was not initialized')
      this.appState = updater(this.appState)
    })
  }

  private async ensureEngine(): Promise<QueryEngineLike> {
    if (this.engine) return this.engine

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
    ])

    call(configModule, 'enableConfigs')
    enableBeeGameRuntimeCompaction(configModule)
    call(
      bootstrapModule,
      'setSessionPersistenceDisabled',
      !(await canWriteBeeGameConfigDir()),
    )
    call(
      bootstrapModule,
      'switchSession',
      this.input.sessionId,
      call(bootstrapModule, 'getSessionProjectDir'),
    )
    call(bootstrapModule, 'setOriginalCwd', this.input.cwd)

    const permissionContext = call(
      toolModule,
      'getEmptyToolPermissionContext',
    ) as Record<string, unknown>
    const tools = call(toolsModule, 'getTools', permissionContext)
    const [commands, agentDefinitions] = await Promise.all([
      callAsync(commandsModule, 'getCommands', this.input.cwd),
      callAsync(agentsModule, 'getAgentDefinitionsWithOverrides', this.input.cwd),
    ])

    const appState = {
      ...(call(stateModule, 'getDefaultAppState') as MutableAppState),
      agentDefinitions,
      toolPermissionContext: {
        ...permissionContext,
        mode: 'default',
        isBypassPermissionsModeAvailable: false,
      },
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
      if (result.behavior !== 'ask') return result
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
        toolName: getToolName(tool),
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
      agentDefinitions,
      'activeAgents',
      [],
    )
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
    })

    return this.engine
  }
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
    ) as { messages?: unknown[] } | null
    return Array.isArray(result?.messages) ? result.messages : []
  } catch {
    return []
  }
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
  ) {
    return tool.name
  }
  return 'Tool'
}

async function serializeRuntimeTurn(fn: () => Promise<void>): Promise<void> {
  const run = runtimeQueue.then(fn, fn)
  runtimeQueue = run.catch(() => {})
  return run
}

async function withRuntimeEnvironment(
  cwd: string,
  env: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const previousCwd = process.cwd()
  const previousEnv = new Map<string, string | undefined>()

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
    await fn()
  } finally {
    process.chdir(previousCwd)
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
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
