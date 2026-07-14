import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { getMacroDefines } from '../../../../scripts/defines'
import {
  createPinnedUndiciDispatcher,
  type ApprovedOutboundTarget,
} from '@bee-game-studio/security-core'
import type {
  BeeGameApprovedOutboundTargets,
  BeeGamePromptInput,
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionRuntime,
  BeeGameSessionSubmitInput,
  DashboardSDKMessage,
} from './session-manager'
import { evaluateProductionMutationGate } from './production-readiness-audit'
import { auditGameProductionCompletion } from './production-completion-audit'
import {
  normalizeBeeGameManagedAgentInput,
  validateBeeGameManagedAgentInvocation,
} from './delivery-validation-agents'

type DynamicModule = Record<string, unknown>

type QueryEngineLike = {
  submitMessage(prompt: BeeGamePromptInput): AsyncGenerator<DashboardSDKMessage, void, unknown>
  interrupt(): void
  resetAbortController(): void
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

export function createBeeGameToolPermissionContext(
  base: Record<string, unknown>,
  skillReadRoot?: string,
): Record<string, unknown> {
  const existingRules = isRecord(base.alwaysAllowRules)
    ? base.alwaysAllowRules
    : {}
  const existingSessionRules = Array.isArray(existingRules.session)
    ? existingRules.session.filter((value): value is string => typeof value === 'string')
    : []
  const skillReadRule = skillReadRoot
    ? `Read(${resolve(skillReadRoot)}/**)`
    : undefined
  return {
    ...base,
    // This is a Claude Code native permission mode, not a BeeGame-owned
    // allowlist. Its evaluator still asks for commands and sensitive access.
    mode: 'acceptEdits',
    isBypassPermissionsModeAvailable: false,
    ...(skillReadRule
      ? {
          alwaysAllowRules: {
            ...existingRules,
            session: [...new Set([...existingSessionRules, skillReadRule])],
          },
        }
      : {}),
  }
}

class QueryEngineSessionRuntime implements BeeGameSessionRuntime {
  private engine: QueryEngineLike | null = null
  private appState: MutableAppState | null = null
  private currentSubmitInput: BeeGameSessionSubmitInput | null = null

  constructor(private readonly input: BeeGameSessionRunnerStartInput) {}

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    await serializeRuntimeTurn(async () => {
      await withRuntimeEnvironment(
        this.input.cwd,
        this.input.env,
        this.input.approvedOutboundTargets,
        async () => {
          this.currentSubmitInput = input
          const engine = await this.ensureEngine()
          if (input.signal.aborted) {
            this.currentSubmitInput = null
            return
          }

          engine.resetAbortController()
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
        },
      )
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

    const permissionContext = createBeeGameToolPermissionContext(
      call(
        toolModule,
        'getEmptyToolPermissionContext',
      ) as Record<string, unknown>,
      resolve(
        process.env.BEEGAME_CONFIG_DIR ?? join(homedir(), '.beegame'),
        'skills',
      ),
    )
    const tools = call(toolsModule, 'getTools', permissionContext)
    const [commands, discoveredAgentDefinitions] = await Promise.all([
      callAsync(commandsModule, 'getCommands', this.input.cwd),
      callAsync(agentsModule, 'getAgentDefinitionsWithOverrides', this.input.cwd),
    ])
    const agentDefinitions = mergeManagedAgentDefinitions(
      discoveredAgentDefinitions,
      this.input.agentDefinitions ?? [],
    )

    const appState = {
      ...(call(stateModule, 'getDefaultAppState') as MutableAppState),
      agentDefinitions,
      toolPermissionContext: permissionContext,
    }
    this.appState = appState
    const sessionHooksModule = await loadRootModule('utils/hooks/sessionHooks.js')
    call(
      sessionHooksModule,
      'addFunctionHook',
      (updater: (prev: MutableAppState) => MutableAppState) => {
        if (!this.appState) throw new Error('App state was not initialized')
        this.appState = updater(this.appState)
      },
      this.input.sessionId,
      'Stop',
      '',
      async (messages: unknown[]) => {
        if (this.currentSubmitInput?.productionContractRequired !== true) return true
        return auditGameProductionCompletion(this.input.cwd, messages).valid
      },
      'Game delivery is incomplete. Read the persisted plan and contracts, run project-native tests and player paths, obtain a complete passed JSON result from beegame-acceptance-validator, write docs/validation-report.md from it, then try to finish again.',
      { id: `beegame-production-completion-${this.input.sessionId}`, timeout: 10_000 },
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
      if (
        this.currentSubmitInput?.productionContractRequired === true &&
        toolName === 'Agent'
      ) {
        const managedAgentDecision = validateBeeGameManagedAgentInvocation(toolInput)
        if (!managedAgentDecision.allowed) {
          return {
            behavior: 'deny',
            message: managedAgentDecision.message ?? 'Managed production agent invocation is invalid.',
            decisionReason: {
              type: 'other',
              reason: 'beegame_managed_agent_must_run_foreground',
            },
            toolUseID,
          }
        }
      }
      const effectiveToolInput = toolName === 'Agent'
        ? normalizeBeeGameManagedAgentInput(this.input.cwd, toolInput)
        : toolInput
      const productionDecision = evaluateProductionMutationGate({
        workspacePath: this.input.cwd,
        productionContractRequired: this.currentSubmitInput?.productionContractRequired === true,
        toolName,
        toolInput: effectiveToolInput,
        toolReadOnly: isToolReadOnly(tool, effectiveToolInput),
      })
      if (!productionDecision.allowed) {
        return {
          behavior: 'deny',
          message: productionDecision.message ?? 'Game production contract is incomplete.',
          decisionReason: {
            type: 'other',
            reason: 'beegame_production_contract_incomplete',
          },
          toolUseID,
        }
      }
      const result = (await callAsync(
        permissionsModule,
        'hasPermissionsToUseTool',
        tool,
        effectiveToolInput,
        toolUseContext,
        assistantMessage,
        toolUseID,
        forceDecision,
      )) as PermissionDecision
      if (result.behavior !== 'ask') {
        return result.behavior === 'allow'
          ? { ...result, updatedInput: result.updatedInput ?? effectiveToolInput }
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
        input: effectiveToolInput,
      })
      if (decision.behavior === 'allow') {
        return {
          behavior: 'allow',
          updatedInput: result.updatedInput ?? effectiveToolInput,
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

export function mergeManagedAgentDefinitions(
  discovered: unknown,
  managed: BeeGameSessionRunnerStartInput['agentDefinitions'],
): Record<string, unknown> {
  const current = isRecord(discovered) ? discovered : {}
  const active = arrayOfRecords(current.activeAgents)
  const all = arrayOfRecords(current.allAgents)
  const managedByType = new Map((managed ?? []).map(agent => [agent.agentType, agent]))
  const allowedAgentTypes = Array.isArray(current.allowedAgentTypes)
    ? current.allowedAgentTypes.filter((item): item is string => typeof item === 'string')
    : undefined
  const retainUnmanaged = (agents: Record<string, unknown>[]) => agents.filter(agent => (
    typeof agent.agentType !== 'string' || !managedByType.has(agent.agentType)
  ))
  return {
    ...current,
    activeAgents: [...retainUnmanaged(active), ...managedByType.values()],
    allAgents: [...retainUnmanaged(all), ...managedByType.values()],
    ...(allowedAgentTypes
      ? { allowedAgentTypes: [...new Set([...allowedAgentTypes, ...managedByType.keys()])] }
      : {}),
  }
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
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
  ) {
    return tool.name
  }
  return 'Tool'
}

function isToolReadOnly(tool: unknown, input: Record<string, unknown>): boolean {
  if (
    typeof tool !== 'object' ||
    tool === null ||
    !('isReadOnly' in tool) ||
    typeof tool.isReadOnly !== 'function'
  ) return false

  try {
    return tool.isReadOnly(input) === true
  } catch {
    // A tool that cannot classify its input as read-only must be handled as a
    // mutation. This keeps the production gate fail-closed without deriving
    // command semantics in BeeGame.
    return false
  }
}

async function serializeRuntimeTurn(fn: () => Promise<void>): Promise<void> {
  const run = runtimeQueue.then(fn, fn)
  runtimeQueue = run.catch(() => {})
  return run
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
    if (!dispatchers.has(target.url.origin)) {
      dispatchers.set(target.url.origin, createPinnedUndiciDispatcher(target))
    }
  }

  const pinnedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = getFetchRequestUrl(input)
    const protocol = getFetchRequestProtocol(requestUrl)
    const origin = getFetchRequestOrigin(input)
    const dispatcher = origin ? dispatchers.get(origin) : undefined
    if ((protocol === 'http:' || protocol === 'https:') && !dispatcher) {
      throw new Error('Outbound URL is not permitted')
    }
    return dispatcher
      ? baseFetch(input, { ...init, redirect: 'error', dispatcher } as RequestInit)
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
