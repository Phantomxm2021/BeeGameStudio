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
import { resolveNativeRuntimeCommand } from './native-runtime-process-path'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'
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
    ...(input.workflowWorkerType === 'document-reviewer'
      ? ['--tools', 'Read,Grep,Glob']
      : []),
    ...(input.workflowJsonSchema &&
    input.workflowWorkerType !== 'document-reviewer'
      ? ['--json-schema', JSON.stringify(input.workflowJsonSchema)]
      : []),
    ...(input.workflowMarkdownStreamContract ? ['--tools', ''] : []),
    ...(input.resumeSessionId ? [`--resume=${input.resumeSessionId}`] : []),
  ]
}

class NativeCliProcessRuntime implements BeeGameSessionRuntime {
  private activeTurn: {
    input: BeeGameSessionSubmitInput
    requestId: string
    resolve(): void
    reject(error: Error): void
    abort(): void
  } | null = null
  private disposed = false
  private stderrTail = ''
  private nativeSessionId: string | undefined
  private readonly structuredOutputCalls = new Map<string, unknown>()

  private constructor(
    private readonly child: RuntimeProcess,
    private readonly sessionInput: BeeGameSessionRunnerStartInput,
    private readonly observability: RuntimeObservability,
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
    const child = Bun.spawn(command, {
      cwd: input.cwd,
      env: nativeRuntimeEnvironment(input.env),
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
    )
    void runtime.consumeStdout()
    void runtime.consumeStderr()
    void child.exited.then(code => runtime.onExit(code))
    return runtime
  }

  async submit(input: BeeGameSessionSubmitInput): Promise<void> {
    if (this.disposed) throw new Error('Bee Game Studio native runtime is closed')
    if (this.activeTurn)
      throw new Error('Bee Game Studio native runtime already has an active turn')
    if (input.signal.aborted) return
    this.structuredOutputCalls.clear()

    await new Promise<void>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const abort = () => {
        this.child.kill('SIGTERM')
        this.failActiveTurn(new Error('Bee Game Studio native turn was aborted'))
      }
      input.signal.addEventListener('abort', abort, { once: true })
      this.activeTurn = {
        input,
        requestId,
        resolve: () => {
          input.signal.removeEventListener('abort', abort)
          resolve()
        },
        reject: error => {
          input.signal.removeEventListener('abort', abort)
          reject(error)
        },
        abort,
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
          content: nativePromptContent(input.prompt),
        },
      })
    })
  }

  stop(): void {
    this.activeTurn?.abort()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.failActiveTurn(new Error('Bee Game Studio native runtime was closed'))
    this.child.stdin.end()
    if (this.child.exitCode === null) this.child.kill('SIGTERM')
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
    const turn = this.activeTurn
    if (!turn) return
    this.observability.observeMessage(message)
    turn.input.onMessage(message as DashboardSDKMessage)
    this.captureStructuredOutputCall(message)
    const structuredOutput = this.successfulStructuredOutput(message)
    if (
      this.sessionInput.workflowJsonSchema &&
      structuredOutput !== undefined
    ) {
      await this.completeStructuredTurn(turn, structuredOutput)
      return
    }
    if (
      message.type === 'system' &&
      (message.subtype === 'task_notification' ||
        message.subtype === 'task_started' ||
        message.subtype === 'task_progress')
    )
      this.sessionInput.onNativeTaskNotification?.(
        nativeTaskNotification(message),
      )
    if (message.type !== 'result') return
    this.activeTurn = null
    if (isErrorResult(message)) {
      const error = new Error(nativeErrorDetail(message))
      this.observability.finishTurn({ outcome: 'error', error })
      await this.observability.flush()
      turn.reject(error)
      return
    }
    if (
      this.sessionInput.workflowMarkdownStreamContract &&
      isMissingVisibleMarkdownResult(message)
    ) {
      const error = new Error(
        'Bee Game Studio native model response ended without visible Markdown',
      )
      this.observability.finishTurn({ outcome: 'error', error })
      await this.observability.flush()
      turn.reject(error)
      return
    }
    this.observability.finishTurn({ outcome: 'success' })
    await this.observability.flush()
    turn.resolve()
  }

  private captureStructuredOutputCall(message: Record<string, unknown>): void {
    if (message.type !== 'assistant') return
    const assistant = objectField(message, 'message')
    const content = assistant?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue
      const value = block as Record<string, unknown>
      if (
        value.type === 'tool_use' &&
        value.name === 'StructuredOutput' &&
        typeof value.id === 'string'
      ) {
        this.structuredOutputCalls.set(value.id, value.input)
      }
    }
  }

  private successfulStructuredOutput(
    message: Record<string, unknown>,
  ): unknown | undefined {
    if (message.type !== 'user') return undefined
    const user = objectField(message, 'message')
    const content = user?.content
    if (!Array.isArray(content)) return undefined
    for (const block of content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue
      const value = block as Record<string, unknown>
      const toolUseID = stringField(value, 'tool_use_id')
      if (
        value.type === 'tool_result' &&
        value.is_error !== true &&
        value.content === 'Structured output provided successfully' &&
        this.structuredOutputCalls.has(toolUseID)
      ) {
        return this.structuredOutputCalls.get(toolUseID)
      }
    }
    return undefined
  }

  private async completeStructuredTurn(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
    structuredOutput: unknown,
  ): Promise<void> {
    this.activeTurn = null
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Structured output accepted',
      session_id: this.nativeSessionId ?? '',
      structured_output: structuredOutput,
    }
    this.observability.observeMessage(result)
    turn.input.onMessage(result)
    this.observability.finishTurn({ outcome: 'success' })
    await this.observability.flush()
    turn.resolve()
    this.disposed = true
    this.child.stdin.end()
    if (this.child.exitCode === null) this.child.kill('SIGTERM')
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
    const decision = requestPermission
      ? await requestPermission({
          toolUseID,
          toolName,
          message: `${toolName} requires permission.`,
          input: toolInput,
        })
      : ({ behavior: 'deny', message: 'Permission authority is unavailable.' } as const)
    this.write(permissionResponse(requestId, toolUseID, toolInput, decision))
  }

  private onExit(code: number): void {
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

  private failActiveTurn(error: Error): void {
    const turn = this.activeTurn
    this.activeTurn = null
    if (turn) {
      this.observability.finishTurn({
        outcome: error.message.includes('aborted') ? 'aborted' : 'error',
        error,
      })
      void this.observability.flush()
    }
    turn?.reject(error)
  }

  private write(message: Record<string, unknown>): void {
    if (this.child.exitCode !== null)
      throw new Error('Bee Game Studio native runtime is not running')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
    this.child.stdin.flush()
  }
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
              updatedInput: input,
              toolUseID,
              decisionClassification:
                decision.scope === 'session'
                  ? 'user_permanent'
                  : 'user_temporary',
            }
          : {
              behavior: 'deny',
              message: decision.message ?? 'Permission denied by user settings.',
              toolUseID,
              decisionClassification: 'user_reject',
            },
    },
  }
}

function nativePromptContent(prompt: BeeGamePromptInput): unknown {
  if (typeof prompt === 'string') return [{ type: 'text', text: prompt }]
  return prompt
}

export function nativeRuntimeEnvironment(
  selectedModelEnvironment: Record<string, string>,
): Record<string, string> {
  return {
    ...getSafeRuntimeProcessEnvironment(),
    ...selectedModelEnvironment,
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

function isMissingVisibleMarkdownResult(
  message: Record<string, unknown>,
): boolean {
  return stringField(message, 'result').trim().length === 0
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
