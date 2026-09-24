import { responseLanguageInstruction } from './response-language'
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
import { createNativeTaskAccess, nativeTaskToolEnvironment } from '@bee-game-studio/agent-workflow/native-task-access'
import { mkdir, realpath } from 'node:fs/promises'
import { closeSessionTestBrowsers } from './native-test-browser-cleanup'
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
      return NativeCliProcessRuntime.start(
        input,
        options.command ?? nativeRuntimeCommand(input),
        options.observabilityFactory ?? createRuntimeObservability,
      )
    },
  }
}

export function nativeRuntimeCommand(
  input: BeeGameSessionRunnerStartInput,
): string[] {
  if (input.resumeSessionId && !isNativeSessionId(input.resumeSessionId)) {
    throw new Error('Bee Game Studio native resume session ID must be a UUID')
  }
  return [
    ...resolveNativeRuntimeCommand(),
    '--print',
    '--verbose',
    '--input-format=stream-json',
    '--output-format=stream-json',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-prompt-tool=stdio',
    ...([input.language ? responseLanguageInstruction(input.language) : '', input.systemContext].filter(Boolean).length
      ? ['--append-system-prompt', [input.language ? responseLanguageInstruction(input.language) : '', input.systemContext].filter(Boolean).join('\n\n')]
      : []),
    ...(input.resumeSessionId ? [`--resume=${input.resumeSessionId}`] : []),
  ]
}

class NativeCliProcessRuntime implements BeeGameSessionRuntime {
  private activeTurn: {
    input: BeeGameSessionSubmitInput
    requestId: string
    resolve(): void
    reject(error: Error): void
    abort(reason?: unknown): void
    tasks: Map<string, { toolUseId?: string; running: boolean }>
    awaitingParentResult: boolean
  } | null = null
  private disposed = false
  private stderrTail = ''
  private nativeSessionId: string | undefined
  private browserCleanup: Promise<void> = Promise.resolve()
  private disposal: Promise<void> | undefined

  private constructor(
    private readonly child: RuntimeProcess,
    private readonly sessionInput: BeeGameSessionRunnerStartInput,
    private readonly observability: RuntimeObservability,
    private readonly scratchPath: string,
    private readonly taskAccess?: Awaited<ReturnType<typeof createNativeTaskAccess>>,
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
    const taskAccess = input.isolatedTask ? await createNativeTaskAccess({
      ...input.isolatedTask, allowWorkingFiles: true,
    }) : undefined
    const temporary = taskAccess ? undefined : await prepareNativeSessionTemporaryDirectory(input.cwd, input.sessionId)
    const child = Bun.spawn([...command, ...(taskAccess?.flags ?? [])], {
      cwd: taskAccess?.root ?? input.cwd,
      env: { ...nativeRuntimeEnvironment(input.env),
        ...(taskAccess?.environment ?? nativeTaskToolEnvironment(temporary!)) },
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
      taskAccess?.environment.TMPDIR ?? temporary!,
      taskAccess,
    )
    void runtime.consumeStdout()
    void runtime.consumeStderr()
    void child.exited.then(code => runtime.onExit(code))
    return runtime
  }

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    await this.browserCleanup
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
          content: nativePromptContent(input.prompt, input.language),
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
      await this.cleanupTestBrowsers()
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
    for await (const chunk of this.child.stderr) {
      this.stderrTail = `${this.stderrTail}${decoder.decode(chunk, {
        stream: true,
      })}`.slice(-16_384)
    }
  }

  private async onMessage(message: Record<string, unknown>): Promise<void> {
    const reportedSessionId = stringField(message, 'session_id')
    if (reportedSessionId && isNativeSessionId(reportedSessionId)) {
      if (reportedSessionId !== this.nativeSessionId) {
        this.nativeSessionId = reportedSessionId
        this.sessionInput.onNativeSessionId?.(reportedSessionId)
      }
    }
    if (message.type === 'control_request') {
      await this.resolvePermissionRequest(message)
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
    this.observability.observeMessage(message)
    await turn.input.onMessage(message as DashboardSDKMessage)
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
    const requestPermission =
      this.sessionInput.requestPermission ?? turn?.input.requestPermission
    const toolUseID = stringField(request, 'tool_use_id')
    const toolName = stringField(request, 'tool_name')
    const toolInput = objectField(request, 'input') ?? {}
    const decisionReason = stringField(request, 'decision_reason')
    const blockedPath = stringField(request, 'blocked_path')
    // Questions need a human response, not a filesystem policy decision.
    if (this.taskAccess && toolName !== 'AskUserQuestion') {
      const decision = await this.taskAccess.permission(request)
      this.write(permissionResponse(requestId, toolUseID,
        decision.behavior === 'allow' ? decision.updatedInput : toolInput,
        { ...decision, source: 'policy' }))
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
          message: decisionReason || `${toolName} requires permission.`,
          input: toolInput,
          ...(decisionReason ? { decisionReason } : {}),
          ...(blockedPath ? { blockedPath } : {}),
          ...(permissionSuggestions ? { permissionSuggestions } : {}),
        })
      : ({ behavior: 'deny', message: 'Permission authority is unavailable.' } as const)
    this.write(permissionResponse(requestId, toolUseID, toolInput, decision))
  }

  private onExit(code: number): void {
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

export function nativePromptContent(prompt: BeeGamePromptInput, language?: string): unknown {
  // Language and capability discovery belong to system context, never to a
  // fabricated second user message. Language changes restart/resume the CLI.
  return typeof prompt === 'string' ? [{ type: 'text', text: prompt }] : prompt
}

export function nativeRuntimeEnvironment(
  selectedModelEnvironment: Record<string, string>,
): Record<string, string> {
  return {
    ...getSafeRuntimeProcessEnvironment(),
    ...selectedModelEnvironment,
    // This host can present permission requests from background agents.
    // Route them to the same authority instead of silently auto-denying them.
    BEEGAME_NATIVE_BACKGROUND_PERMISSIONS: '1',
  }
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
  return stringField(message, 'error') || 'Bee Game Studio native turn failed'
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
