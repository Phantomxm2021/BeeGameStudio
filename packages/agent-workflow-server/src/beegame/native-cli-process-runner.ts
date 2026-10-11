import { responseLanguageInstruction } from './response-language'
import { BEEGAME_USER_RESPONSE_SCOPE } from './user-response-scope'
import type {
  BeeGamePromptInput,
  DashboardSDKMessage,
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionRuntime,
  BeeGameSessionSubmitInput,
  DashboardPermissionDecision,
} from './session-manager'
import type { BeeGameNativeTaskNotification } from './native-task-notification'
import { parseNativeTerminalTaskNotification } from './native-task-notification'
import { resolveNativeRuntimeCommand, nativeSessionTemporaryPath } from './native-runtime-process-path'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'
import { createNativeTaskAccess } from '@bee-game-studio/agent-workflow/native-task-access'
import { NATIVE_DIAGNOSTIC_PREFIX, parseNativeDiagnostic } from '@bee-game-studio/agent-workflow/native-diagnostics'
import { StandardCliUsage } from '@bee-game-studio/agent-workflow/standard-cli-usage'
import { standardCliCache } from '@bee-game-studio/agent-workflow/standard-cli-cache'
import { standardCliProvider } from '@bee-game-studio/agent-workflow/standard-cli-provider'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { closeSessionTestBrowsers } from './native-test-browser-cleanup'
import { projectExecutionAccess } from './project-execution-access'
import { prepareNativeSkillPlugins } from './native-skill-plugins'
import { WritingWorkflowRuntime } from './writing-workflow-runtime'
import { standardCliDebugDiagnostic, withStandardCliDiagnostics } from './standard-cli-debug'
import {
  createRuntimeObservability,
  type RuntimeObservability,
} from './runtime-observability'

type RuntimeProcess = ReturnType<typeof Bun.spawn> & {
  stdin: {
    write(content: string): number
    flush(): number | Promise<number>
    end(): number | Promise<number>
  }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}

export function createNativeCliProcessRunner(options: {
  command?: string[]
  observabilityFactory?: (input: {
    workspacePath: string
    sessionId: string
    provider: string
    model: string
    launchContract?: BeeGameSessionRunnerStartInput['runtimeLaunchContract']
  }) => RuntimeObservability
} = {}): BeeGameSessionRunner {
  return {
    async start(input) {
      const command = options.command ?? nativeRuntimeCommand(input)
      const start = (task: BeeGameSessionRunnerStartInput) => NativeCliProcessRuntime.start(task,
        options.command && command.includes('--print') ? nativeWorkflowCommand(command, task)
          : options.command ?? nativeRuntimeCommand(task), options.observabilityFactory ?? createRuntimeObservability)
      // Non-CLI test transports remain ordinary transports. Production uses
      // standard --print sessions, with business scheduling in this host.
      return command.includes('--print') ? new WritingWorkflowRuntime(input, start) : start(input)
    },
  }
}

/** Preserve explicitly selected executable/settings, refresh standard session
 * and prompt options per task instead of retaining the parent's role prompt. */
export function nativeWorkflowCommand(command: string[], input: BeeGameSessionRunnerStartInput): string[] {
  const standard = nativeRuntimeCommand(input)
  const prompt = standard[standard.indexOf('--append-system-prompt') + 1]!
  const index = command.indexOf('--append-system-prompt')
  if (index < 0 || index + 1 >= command.length) throw Error('Workflow CLI requires a standard append-system-prompt option')
  const refreshed = command.map((value, position) => position === index + 1 ? prompt : value)
  return [...refreshed.filter(argument => !/^--(?:resume|session-id)=/.test(argument)),
    ...(input.resumeSessionId ? [`--resume=${input.resumeSessionId}`] : input.nativeSessionId ? [`--session-id=${input.nativeSessionId}`] : []),
    ...(input.nativeTools ? ['--tools', input.nativeTools.join(',')] : [])]
}

export function nativeRuntimeCommand(
  input: BeeGameSessionRunnerStartInput,
): string[] {
  if (input.resumeSessionId && !isNativeSessionId(input.resumeSessionId)) {
    throw new Error('Bee Game Studio native resume session ID must be a UUID')
  }
  if (input.nativeSessionId && (!isNativeSessionId(input.nativeSessionId) || input.resumeSessionId))
    throw new Error('Bee Game Studio new native session ID must be a UUID and cannot be combined with resume')
  return [
    ...resolveNativeRuntimeCommand(),
    '--print',
    '--verbose',
    '--input-format=stream-json',
    '--output-format=stream-json',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-prompt-tool=stdio',
    '--append-system-prompt',
    [BEEGAME_USER_RESPONSE_SCOPE, input.language ? responseLanguageInstruction(input.language) : '', input.systemContext].filter(Boolean).join('\n\n'),
    ...(input.resumeSessionId ? [`--resume=${input.resumeSessionId}`] : []),
    ...(input.nativeSessionId ? [`--session-id=${input.nativeSessionId}`] : []),
    ...(input.nativeTools ? ['--tools', input.nativeTools.join(',')] : []),
  ]
}

/** Supply project facts through the standard CLI prompt option, not native
 * environment-prompt code. Use the resolved execution directory, including
 * isolated tasks; preserve custom non-CLI fixture commands unchanged. */
export function appendWorkingFilesInstruction(command: string[], directory: string): string[] {
  const index = command.indexOf('--append-system-prompt')
  if (index < 0) return command
  if (index + 1 >= command.length) throw new Error('Missing append-system-prompt value')
  const instruction = `Project temporary working directory (TMPDIR): ${JSON.stringify(directory)}. Prefer this project-owned directory for disposable scripts and scratch files; keep maintained tests in the project's normal test structure. Native tool output uses CLAUDE_CODE_TMPDIR separately; read actual tool-returned paths, not a guessed project path. File tools require literal paths, not an unexpanded $TMPDIR; Bash can use "$TMPDIR".`
  return command.map((argument, position) => position === index + 1 ? [argument, instruction].filter(Boolean).join('\n\n') : argument)
}

class NativeCliProcessRuntime implements BeeGameSessionRuntime {
  private activeTurn: {
    input: BeeGameSessionSubmitInput
    requestId: string
    acknowledged: boolean
    pendingMessages: Record<string, unknown>[]
    resolve(): void
    reject(error: Error): void
    abort(reason?: unknown): void
    tasks: Map<string, { toolUseId?: string; running: boolean }>
    taskOutputs: Map<string, { taskId: string; activationToolUseId?: string }>
    awaitingParentResult: boolean
  } | null = null
  private disposed = false
  private stderrTail = ''
  private nativeSessionId: string | undefined
  private acknowledgedAnyTurn = false
  private startupError: Error | undefined
  private publicUsage = new StandardCliUsage()
  private browserCleanup: Promise<void> = Promise.resolve()
  private disposal: Promise<void> | undefined
  private stderrCompletion: Promise<void> = Promise.resolve()
  private stdoutCompletion: Promise<void> = Promise.resolve()

  private constructor(
    private readonly child: RuntimeProcess,
    private readonly sessionInput: BeeGameSessionRunnerStartInput,
    private readonly observability: RuntimeObservability,
    private readonly scratchPath: string,
    private readonly taskAccess?: Awaited<ReturnType<typeof createNativeTaskAccess>>,
    private readonly projectAccess?: Awaited<ReturnType<typeof projectExecutionAccess>>,
    private readonly closeSkillPlugins: () => Promise<void> = async () => {},
    private readonly childDiagnosticsEnabled = false,
  ) {
    this.nativeSessionId = sessionInput.resumeSessionId
  }

  static async start(
    input: BeeGameSessionRunnerStartInput,
    command: string[],
    observabilityFactory: (input: {
      workspacePath: string
      sessionId: string
      provider: string
      model: string
      launchContract?: BeeGameSessionRunnerStartInput['runtimeLaunchContract']
    }) => RuntimeObservability,
  ): Promise<NativeCliProcessRuntime> {
    if (command.length === 0)
      throw new Error('Bee Game Studio native runtime command is required')
    let toolResultsDirectory: string | undefined
    if (command.includes('--print')) {
      const flag = (name: string) => command.find(value => value.startsWith(name + '='))?.slice(name.length + 1)
        ?? (command.includes(name) ? command[command.indexOf(name) + 1] : undefined)
      const resume = input.resumeSessionId ?? flag('--resume')
      const session = resume ?? input.nativeSessionId ?? flag('--session-id') ?? randomUUID()
      if (!resume && !flag('--session-id')) command = [...command, '--session-id=' + session]
      input = { ...input, ...(resume ? { resumeSessionId: session, nativeSessionId: undefined } : { nativeSessionId: session }) }
      toolResultsDirectory = standardCliCache(await realpath(input.cwd), session, input.env)
    }
    // Main sessions discover selected user Skills through their normal user
    // config. Only isolated tasks need the plugin route for those Skills.
    const skillPlugins = command.includes('--print')
      ? await prepareNativeSkillPlugins(input.env, Boolean(input.isolatedTask)) : undefined
    try {
      const executionEnvironment = { ...input.env,
        ...(skillPlugins ? { BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: skillPlugins.builtins } : {}) }
      const taskAccess = input.isolatedTask ? await createNativeTaskAccess({
        ...input.isolatedTask, allowWorkingFiles: true,
        toolResultsDirectory,
        modelType: standardCliProvider(input.env).modelType,
        ...(input.env.BEEGAME_CONFIG_DIR
          ? { skillsDirectory: resolve(input.env.BEEGAME_CONFIG_DIR, 'skills') } : {}),
        ...(executionEnvironment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR
          ? { builtinSkillsDirectory: executionEnvironment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR } : {}),
      }) : undefined
      const projectAccess = taskAccess ? undefined : await projectExecutionAccess({
        workspacePath: input.cwd, sessionId: input.sessionId, environment: executionEnvironment,
        toolResultsDirectory,
        ...(input.toolPolicy ? { scopedTools: input.nativeTools } : {}),
      })
      const scratchPath = taskAccess?.environment.TMPDIR ?? projectAccess!.temporary
      const childEnvironment: Record<string, string> = { ...nativeRuntimeEnvironment(input.env),
        ...(taskAccess?.environment ?? projectAccess!.environment) }
      delete childEnvironment.BEEGAME_NATIVE_SKILLS_DIR
      delete childEnvironment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR
      command = withStandardCliDiagnostics(command)
      // Standard SDK info logs expose response status/timing, not debug request
      // bodies. Do not alter provider, timeout or retry configuration.
      if (command.includes('--debug-to-stderr')) childEnvironment.ANTHROPIC_LOG = input.env.ANTHROPIC_LOG ?? 'info'
      const child = Bun.spawn([...appendWorkingFilesInstruction(command, scratchPath),
        ...(skillPlugins?.flags ?? []), ...(taskAccess?.flags ?? projectAccess!.flags)], {
        cwd: taskAccess?.root ?? projectAccess!.root,
        env: childEnvironment,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      }) as RuntimeProcess
      const runtime = new NativeCliProcessRuntime(
        child,
        input,
        observabilityFactory({
          workspacePath: input.cwd,
          sessionId: input.sessionId,
          ...runtimeIdentity(input.env),
          ...(input.runtimeLaunchContract
            ? { launchContract: input.runtimeLaunchContract }
            : {}),
        }),
        scratchPath,
        taskAccess,
        projectAccess,
        skillPlugins?.close,
        command.includes('--debug-to-stderr'),
      )
      runtime.stdoutCompletion = runtime.consumeStdout()
      runtime.stderrCompletion = runtime.consumeStderr()
      void child.exited.then(code => runtime.onExit(code))
      return runtime
    } catch (error) {
      await skillPlugins?.close()
      throw error
    }
  }

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    await this.browserCleanup
    if (this.startupError) throw this.startupError
    if (this.disposed) throw new Error('Bee Game Studio native runtime is closed')
    if (this.activeTurn)
      throw new Error('Bee Game Studio native runtime already has an active turn')
    if (input.signal.aborted) return
    await new Promise<void>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const abort = (reason: unknown = input.signal.reason) => {
        this.child.kill('SIGTERM')
        const stopReason = typeof reason === 'string' ? reason : 'aborted'
        this.failActiveTurn(
          new Error(stopReason === 'user_stop'
            ? 'Bee Game Studio native turn was cancelled by user'
            : `Bee Game Studio native turn was interrupted: ${stopReason}`),
          stopReason === 'user_stop' ? 'cancelled_by_user' : 'aborted',
          stopReason,
        )
      }
      const onAbort = () => abort(input.signal.reason)
      input.signal.addEventListener('abort', onAbort, { once: true })
      this.activeTurn = {
        input,
        requestId,
        acknowledged: false,
        pendingMessages: [],
        resolve: () => {
          input.signal.removeEventListener('abort', onAbort)
          resolve()
        },
        reject: error => {
          input.signal.removeEventListener('abort', onAbort)
          reject(error)
        },
        abort,
        tasks: new Map(),
        taskOutputs: new Map(),
        awaitingParentResult: false,
      }
      this.observability.beginTurn({ requestId })
      this.write({
        type: 'user',
        uuid: requestId,
        // The BGS session ID is a routing identity, not the native runtime's
        // UUID. An empty value is the native stream protocol's first-turn
        // handshake; subsequent messages use the UUID reported by the native
        // runtime itself.
        session_id: this.nativeSessionId ?? '',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: nativeAssignmentPrompt(input.prompt, input.projectTurn),
        },
      })
    })
  }

  stop(): void {
    this.activeTurn?.abort('user_stop')
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    this.failActiveTurn(new Error('Bee Game Studio native runtime was closed'), 'aborted', 'runtime_disposed')
    this.child.stdin.end()
    if (this.child.exitCode === null) this.child.kill('SIGTERM')
    return this.disposal = (async () => {
      const timeout = setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill('SIGKILL')
      }, 2000)
      try { await this.child.exited } finally { clearTimeout(timeout) }
      // Process exit and pipe EOF are separate events. Drain passive provider
      // accounting before the manager records terminal usage.
      try {
        await this.stderrCompletion
        await this.cleanupTestBrowsers()
      } finally { await this.closeSkillPlugins() }
    })()
  }

  private async consumeStdout(): Promise<void> {
    try {
      for await (const line of ndjsonLines(this.child.stdout, chunk => {
        this.observability.observeStdoutChunk(chunk)
      })) {
        this.observability.observeLine(line)
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          throw new Error(
            `Bee Game Studio native runtime emitted invalid JSON (${Buffer.byteLength(line)} bytes)`,
          )
        }
        await this.onMessage(message)
      }
    } catch (error) {
      this.failActiveTurn(toError(error))
    }
  }

  private async consumeStderr(): Promise<void> {
    const decoder = new TextDecoder()
    let pending = ''
    let discarding = false
    const accept = (line: string) => {
      const standard = standardCliDebugDiagnostic(line)
      if (standard) this.observability.observeDiagnostic(standard)
      if (!line.startsWith(NATIVE_DIAGNOSTIC_PREFIX)) return
      try {
        const diagnostic = parseNativeDiagnostic(JSON.parse(line.slice(NATIVE_DIAGNOSTIC_PREFIX.length)))
        if (!diagnostic) return
        this.observability.observeDiagnostic(diagnostic)
        const { cumulativeInputTokens: input, cumulativeOutputTokens: output,
          cumulativeCacheReadTokens: cacheRead, cumulativeCacheCreationTokens: cacheCreation } = diagnostic
        if (diagnostic.event === 'stream_end' && input !== undefined && output !== undefined &&
            cacheRead !== undefined && cacheCreation !== undefined && Number.isSafeInteger(input + output + cacheRead + cacheCreation)) {
          this.sessionInput.onNativeUsage?.({ prompt_tokens: input, completion_tokens: output,
            cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreation,
            total_tokens: input + output + cacheRead + cacheCreation })
        }
      } catch { /* Invalid diagnostics must not affect the runtime. */ }
    }
    const consume = (text: string) => {
      // Standard debug mode also enables SDK logging, including request bodies.
      // Never reflect that stream into public errors or persist its raw text.
      // Non-CLI fixture/legacy transports keep their existing stderr behavior.
      if (!this.childDiagnosticsEnabled) this.stderrTail = (this.stderrTail + text).slice(-16_384)
      for (const part of text.split(/(?<=\n)/)) {
        if (!discarding) pending += part
        if (pending.length > 4_096) { pending = ''; discarding = true }
        if (part.endsWith('\n')) {
          if (!discarding) accept(pending.trimEnd())
          pending = ''
          discarding = false
        }
      }
    }
    for await (const chunk of this.child.stderr) {
      consume(decoder.decode(chunk, { stream: true }))
    }
    consume(decoder.decode())
    if (!discarding && pending) accept(pending)
  }

  private async onMessage(message: Record<string, unknown>): Promise<void> {
    // Standard CLI load failures happen before it can replay a user UUID.
    // They belong to this cold process, not an old background turn. Preserve
    // the actual error, but never adopt emitLoadError's temporary session ID.
    if (!this.acknowledgedAnyTurn && isStartupLoadError(message)) {
      this.startupError = new Error(nativeErrorDetail(message))
      if (this.activeTurn) await this.deliverTurnMessage(message)
      return
    }
    const usage = this.publicUsage.observe(message)
    if (usage) this.sessionInput.onNativeUsage?.(usage)
    const reportedSessionId = stringField(message, 'session_id')
    if (reportedSessionId && isNativeSessionId(reportedSessionId)) {
      if (reportedSessionId !== this.nativeSessionId) {
        this.nativeSessionId = reportedSessionId
        this.sessionInput.onNativeSessionId?.(reportedSessionId)
      }
    }
    if (message.type === 'control_request') {
      // An approval may wait for a human while other native tasks keep working.
      // Do not hold the ordered stdout consumer behind that decision.
      const turn = this.activeTurn
      void this.resolvePermissionRequest(message).catch(error => {
        if (!this.disposed && this.activeTurn === turn) this.failActiveTurn(toError(error))
      })
      return
    }
    if (
      message.type === 'system' &&
      (message.subtype === 'task_notification' ||
        message.subtype === 'task_started' ||
        message.subtype === 'task_progress')
    ) {
      if (!this.activeTurn) this.observability.observeMessage(message)
      this.sessionInput.onNativeTaskNotification?.(
        { ...nativeTaskNotification(message), message,
          ...(!this.activeTurn ? { backgroundMessage: message } : {}) },
      )
    }
    const turn = this.activeTurn
    if (!turn) return
    if (!turn.acknowledged) {
      // A persistent CLI may still be draining an older task notification when
      // we submit. Only its replay of OUR UUID establishes the new turn. Stream
      // deltas can precede that replay; retain them until their owner is known.
      const acknowledged = message.type === 'user' && message.isReplay === true &&
        message.uuid === turn.requestId && message.parent_tool_use_id == null
      // A provider/local error can terminate before the first assistant message
      // (and thus before replay). The CLI tags such results with the command UUID.
      const ownResult = message.type === 'result' && message.request_id === turn.requestId
      if (!acknowledged && !ownResult) {
        if (message.type === 'result') turn.pendingMessages = []
        else turn.pendingMessages.push(message)
        return
      }
      turn.acknowledged = true
      this.acknowledgedAnyTurn = true
      const pending = turn.pendingMessages
      turn.pendingMessages = []
      for (const buffered of pending) {
        if (this.activeTurn !== turn) return
        await this.deliverTurnMessage(buffered)
      }
      // The replay is a transport receipt, not a second user chat message.
      if (acknowledged) return
    }
    await this.deliverTurnMessage(message)
  }

  private async deliverTurnMessage(message: Record<string, unknown>): Promise<void> {
    const turn = this.activeTurn
    if (!turn) return
    // A child result is not the parent request's terminal result.
    if (message.type === 'result' && message.parent_tool_use_id != null) return
    if (message.type === 'system') {
      const taskId = stringField(message, 'task_id')
      if (message.subtype === 'task_started' && taskId &&
          (['local_agent', 'remote_agent', 'local_workflow'].includes(String(message.task_type)) || turn.tasks.has(taskId))) {
        // SendMessage can reactivate the SAME task ID. A previous terminal
        // notification or an old transcript tail does not complete this run.
        turn.tasks.set(taskId, { toolUseId: stringField(message, 'tool_use_id'), running: true })
      }
      const terminal = parseNativeTerminalTaskNotification({ ...nativeTaskNotification(message), message })
      if (terminal) {
        for (const [id, task] of turn.tasks) {
          if ((id === terminal.taskId && (!terminal.toolUseId || !task.toolUseId || task.toolUseId === terminal.toolUseId)) ||
              (terminal.toolUseId && task.toolUseId === terminal.toolUseId))
            task.running = false
        }
      }
    }
    // TaskOutput is a native terminal observation too. Some resumed agents
    // return a completed TaskOutput without a matching task_notification;
    // waiting only for that notification would strand an otherwise final turn.
    for (const block of nativeContentBlocks(message)) {
      if (message.type === 'assistant' && stringField(block, 'type') === 'tool_use' &&
          stringField(block, 'name') === 'TaskOutput') {
        const toolUseId = stringField(block, 'id')
        const taskId = stringField(objectField(block, 'input') ?? {}, 'task_id')
        const task = turn.tasks.get(taskId)
        if (toolUseId && taskId && task)
          turn.taskOutputs.set(toolUseId, { taskId, activationToolUseId: task.toolUseId })
      }
      if (message.type !== 'user' || stringField(block, 'type') !== 'tool_result') continue
      const toolUseId = stringField(block, 'tool_use_id')
      const observed = turn.taskOutputs.get(toolUseId)
      if (!observed) continue
      turn.taskOutputs.delete(toolUseId)
      const result = objectField(message, 'tool_use_result')
      const completed = objectField(result ?? {}, 'task')
      if (stringField(result ?? {}, 'retrieval_status') !== 'success' ||
          stringField(completed ?? {}, 'task_id') !== observed.taskId ||
          !['completed', 'failed', 'stopped', 'killed'].includes(stringField(completed ?? {}, 'status'))) continue
      const task = turn.tasks.get(observed.taskId)
      if (task && task.toolUseId === observed.activationToolUseId) task.running = false
    }
    this.observability.observeMessage(message)
    await turn.input.onMessage(message as DashboardSDKMessage)
    if (this.activeTurn !== turn) return // The callback may have stopped this turn.
    if (message.type === 'system' && message.subtype === 'session_state_changed' &&
        message.state === 'idle' && turn.awaitingParentResult) {
      this.failActiveTurn(new Error('Native session became idle before the parent completed its pending agent work'))
      return
    }
    if (message.type !== 'result') return
    // Keep the original callback and permission context attached while native
    // subagents work and the parent resumes. Do not send a synthetic prompt.
    if (!isErrorResult(message) && [...turn.tasks.values()].some(task => task.running)) {
      turn.awaitingParentResult = true
      return
    }
    this.activeTurn = null
    await this.cleanupTestBrowsers()
    if (isErrorResult(message)) {
      const error = new Error(nativeErrorDetail(message))
      this.observability.finishTurn({ outcome: 'error', error })
      await this.observability.flush()
      turn.reject(error)
      return
    }
    this.observability.finishTurn({ outcome: 'success' })
    await this.observability.flush()
    turn.resolve()
  }

  private async resolvePermissionRequest(
    message: Record<string, unknown>,
  ): Promise<void> {
    const requestId = stringField(message, 'request_id')
    const request = objectField(message, 'request')
    if (!requestId || request?.subtype !== 'can_use_tool') return
    const turn = this.activeTurn
    const toolUseID = stringField(request, 'tool_use_id')
    const respond = (toolInput: Record<string, unknown>, decision: DashboardPermissionDecision) => {
      // A stopped/completed turn cannot send a late approval into its successor.
      if (this.disposed || this.child.exitCode !== null || this.activeTurn !== turn) return
      this.write(permissionResponse(requestId, toolUseID, toolInput, decision))
    }
    const requestPermission =
      this.sessionInput.requestPermission ?? turn?.input.requestPermission
    const toolName = stringField(request, 'tool_name')
    const toolInput = objectField(request, 'input') ?? {}
    const decisionReason = stringField(request, 'decision_reason')
    const blockedPath = stringField(request, 'blocked_path')
    const agentId = stringField(request, 'agent_id')
    if (this.sessionInput.toolPolicy && toolName && toolUseID) {
      const scoped = await this.sessionInput.toolPolicy({
        toolName, toolUseID, input: toolInput,
        message: decisionReason ?? `${toolName} requires permission.`,
        ...(agentId ? { agentId } : {}),
      })
      if (this.disposed || this.activeTurn !== turn) return
      if (scoped) { respond(toolInput, scoped); return }
    }
    if (await this.projectAccess?.isReferenceRead(toolName, toolInput)) {
      respond(toolInput, { behavior: 'allow', source: 'policy' })
      return
    }
    if (this.disposed || this.activeTurn !== turn) return
    if (!this.taskAccess && toolName === 'SandboxNetworkAccess' &&
        typeof toolInput.host === 'string' && toolInput.host.trim()) {
      // Filesystem isolation is not a resource-source policy. Keep the native
      // network proxy available without introducing per-domain approval gates.
      respond(toolInput, { behavior: 'allow', source: 'policy' })
      return
    }
    // Questions need a human response, not a filesystem policy decision.
    if (this.taskAccess && toolName !== 'AskUserQuestion') {
      const decision = await this.taskAccess.permission(request)
      respond(
        decision.behavior === 'allow' ? decision.updatedInput : toolInput,
        { ...decision, source: 'policy' })
      return
    }
    const permissionSuggestions = Array.isArray(request.permission_suggestions)
      ? request.permission_suggestions.filter(
          (suggestion): suggestion is Record<string, unknown> =>
            Boolean(suggestion) &&
            typeof suggestion === 'object' &&
            !Array.isArray(suggestion),
        )
      : undefined
    const decision = requestPermission
      ? await requestPermission({
          toolUseID,
          toolName,
          message: publicArtifactApprovalMessage(toolName, toolInput, this.sessionInput.env.BEEGAME_ARTIFACTS_URL ?? this.sessionInput.env.CLAUDE_ARTIFACTS_URL)
            ?? decisionReason ?? `${toolName} requires permission.`,
          input: toolInput,
          ...(decisionReason ? { decisionReason } : {}),
          ...(blockedPath ? { blockedPath } : {}),
          ...(agentId ? { agentId } : {}),
          ...(permissionSuggestions ? { permissionSuggestions } : {}),
        })
      : ({ behavior: 'deny', message: 'Permission authority is unavailable.' } as const)
    respond(toolInput, decision)
  }

  private async onExit(code: number): Promise<void> {
    // Exit may precede pipe EOF or an awaited message observer. Do not reject
    // the turn while its terminal result is still buffered on stdout.
    await Promise.all([this.stdoutCompletion, this.stderrCompletion])
    await this.closeSkillPlugins()
    void this.cleanupTestBrowsers()
    if (this.disposed) return
    this.disposed = true
    const detail = this.stderrTail.trim()
    this.failActiveTurn(
      new Error(
        `Bee Game Studio native runtime exited without a terminal result (${code})${
          detail ? `: ${detail}` : ''
        }`,
      ),
    )
  }

  private failActiveTurn(
    error: Error,
    outcome?: 'error' | 'aborted' | 'cancelled_by_user',
    stopReason?: string,
  ): void {
    const turn = this.activeTurn
    this.activeTurn = null
    void this.cleanupTestBrowsers()
    if (turn) {
      this.observability.finishTurn({
        outcome: outcome ?? 'error',
        ...(stopReason ? { stopReason } : {}),
        ...(outcome === 'cancelled_by_user' || outcome === 'aborted' ? {} : { error }),
      })
      void this.observability.flush()
    }
    turn?.reject(error)
  }

  private cleanupTestBrowsers(): Promise<void> {
    return this.browserCleanup = this.browserCleanup.then(() => closeSessionTestBrowsers(this.scratchPath))
      .catch(error => { console.warn('[beegame] Test browser cleanup failed:', error instanceof Error ? error.message : String(error)) })
  }

  private write(message: Record<string, unknown>): void {
    if (this.child.exitCode !== null)
      throw new Error('Bee Game Studio native runtime is not running')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
    this.child.stdin.flush()
  }
}

export function publicArtifactApprovalMessage(toolName: string, toolInput: Record<string, unknown>, destination?: string): string | undefined {
  if (toolName !== 'ExecuteExtraTool' || toolInput.tool_name !== 'artifact') return undefined
  const params = toolInput.params
  const input = params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown> : {}
  const filename = typeof input.file_path === 'string' ? basename(input.file_path) : 'selected file'
  const lifetime = input.ttl === 30 ? 30 : 7
  let host = 'unconfigured Bee Game Studio artifact service'
  try { if (destination) host = new URL(destination).host } catch { /* The tool will reject invalid configuration. */ }
  return `Publish ${filename} as a publicly accessible HTML page at ${host} for ${lifetime} days?`
}

/** Bash, file tools and image processors share a project-local scratch root.
 * Do not grant access to the machine-wide /tmp/claude shared by other tasks. */
export async function prepareNativeSessionTemporaryDirectory(cwd: string, sessionId: string): Promise<string> {
  const root = await realpath(cwd)
  const temporary = nativeSessionTemporaryPath(root, sessionId)
  await mkdir(temporary, { recursive: true, mode: 0o700 })
  if (await realpath(temporary) !== temporary) throw new Error('Invalid native session temporary directory')
  return temporary
}

function isNativeSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function runtimeIdentity(env: Record<string, string>): {
  provider: string
  model: string
} {
  if (env.ANTHROPIC_BASE_URL || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY)
    return {
      provider: 'anthropic',
      model: selectedRuntimeModel(env, 'ANTHROPIC'),
    }
  if (env.OPENAI_BASE_URL || env.OPENAI_API_KEY)
    return {
      provider: 'openai-compatible',
      model: selectedRuntimeModel(env, 'OPENAI'),
    }
  if (env.AWS_REGION || env.AWS_BEDROCK_MODEL)
    return {
      provider: 'bedrock',
      model: env.AWS_BEDROCK_MODEL || 'configured',
    }
  return { provider: 'configured', model: env.BEEGAME_MODEL || 'configured' }
}

function selectedRuntimeModel(
  env: Record<string, string>,
  provider: 'ANTHROPIC' | 'OPENAI',
): string {
  return (
    env[`${provider}_MODEL`] ||
    env[`${provider}_DEFAULT_SONNET_MODEL`] ||
    env[`${provider}_DEFAULT_OPUS_MODEL`] ||
    env[`${provider}_DEFAULT_HAIKU_MODEL`] ||
    env.BGS_DEFAULT_BALANCED_MODEL ||
    env.BGS_DEFAULT_STRONG_MODEL ||
    env.BGS_DEFAULT_FAST_MODEL ||
    env.BEEGAME_MODEL ||
    'configured'
  )
}

function permissionResponse(
  requestId: string,
  toolUseID: string,
  input: Record<string, unknown>,
  decision: DashboardPermissionDecision,
): Record<string, unknown> {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response:
        decision.behavior === 'allow'
          ? {
              behavior: 'allow',
              updatedInput: decision.updatedInput ?? input,
              toolUseID,
              ...(decision.updatedPermissions?.length
                ? { updatedPermissions: decision.updatedPermissions }
                : {}),
              ...(decision.source === 'policy' ? {} : {
                decisionClassification: decision.scope === 'session'
                  ? 'user_permanent' : 'user_temporary',
              }),
            }
          : {
              behavior: 'deny',
              message: decision.message ?? 'Permission denied by user settings.',
              toolUseID,
              ...(decision.source === 'policy' ? {} : { decisionClassification: 'user_reject' }),
            },
    },
  }
}

export function nativePromptContent(prompt: BeeGamePromptInput): unknown {
  // Language and capability discovery belong to system context, never to a
  // fabricated second user message. Language changes restart/resume the CLI.
  return typeof prompt === 'string' ? [{ type: 'text', text: prompt }] : prompt
}

/** GDD is an ordinary native turn. Invoke its explicitly supplied plugin Skill
 * through the public slash-command interface; native core needs no role flag.
 * The host retains assignment metadata for saved-output acceptance. */
export function nativeAssignmentPrompt(prompt: BeeGamePromptInput, turn?: BeeGameSessionSubmitInput['projectTurn']) {
  if (turn?.authorDocument !== 'GDD.md') return nativePromptContent(prompt)
  const blocks = typeof prompt === 'string' ? [{ type: 'text' as const, text: prompt }] : prompt
  const command = '/bgs-builtins:game-systems-designer-expert'
  // Native array input parses only its final text block. Earlier blocks
  // (platform facts/images) remain source context, not command arguments.
  const index = blocks.length - 1
  if (blocks[index]?.type !== 'text') return [...blocks, { type: 'text', text: command }]
  return blocks.map((block, position) => position === index && block.type === 'text'
    ? { ...block, text: command + ' ' + block.text } : block)
}

export function nativeRuntimeEnvironment(
  selectedModelEnvironment: Record<string, string>,
): Record<string, string> {
  const environment: Record<string, string> = {
    ...getSafeRuntimeProcessEnvironment(),
    ...standardCliProvider(selectedModelEnvironment).environment,
    // The native process needs provider credentials; its Bash/MCP/LSP children do not.
    BGS_SUBPROCESS_ENV_SCRUB: '1',
  }
  // These authorize host database RPCs, never model execution. Also strip them
  // if an alternate caller mistakenly supplies them in the selected env.
  delete environment.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
  delete environment.SUPABASE_SERVICE_ROLE_KEY
  return environment
}

async function* ndjsonLines(
  stream: ReadableStream<Uint8Array>,
  observeChunk: (chunk: Uint8Array) => void = () => undefined,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of stream) {
    observeChunk(chunk)
    buffer += decoder.decode(chunk, { stream: true })
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) yield line
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) yield buffer.trim()
}

function isStartupLoadError(message: Record<string, unknown>): boolean {
  return message.type === 'result' && message.subtype === 'error_during_execution' &&
    message.is_error === true && message.parent_tool_use_id == null && message.request_id === undefined &&
    message.num_turns === 0 && message.duration_ms === 0 && message.duration_api_ms === 0 &&
    Array.isArray(message.errors) && message.errors.some(error => typeof error === 'string' && error.length > 0)
}

function isErrorResult(message: Record<string, unknown>): boolean {
  return message.is_error === true ||
    (typeof message.subtype === 'string' && message.subtype !== 'success')
}

function nativeErrorDetail(message: Record<string, unknown>): string {
  if (Array.isArray(message.errors)) {
    const errors = message.errors.filter(
      (error): error is string => typeof error === 'string',
    )
    if (errors.length) return errors.join('\n')
  }
  return stringField(message, 'error') || stringField(message, 'result') || 'Bee Game Studio native turn failed'
}

function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const field = value[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : undefined
}

function nativeContentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  const content = objectField(message, 'message')?.content
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> =>
        Boolean(block) && typeof block === 'object' && !Array.isArray(block))
    : []
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function nativeTaskNotification(
  message: Record<string, unknown>,
): BeeGameNativeTaskNotification {
  return {
    value:
      typeof message.value === 'string'
        ? message.value
        : JSON.stringify(message),
    ...(typeof message.uuid === 'string' ? { uuid: message.uuid } : {}),
    ...(typeof message.isMeta === 'boolean'
      ? { isMeta: message.isMeta }
      : {}),
  }
}
