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

type RuntimeProcess = ReturnType<typeof Bun.spawn> & {
  stdin: {
    write(content: string): number
    flush(): number | Promise<number>
    end(): number | Promise<number>
  }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}

const SAFE_INHERITED_ENV = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'NODE_ENV',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
] as const

export function createNativeCliProcessRunner(options: {
  command?: string[]
} = {}): BeeGameSessionRunner {
  return {
    async start(input) {
      return NativeCliProcessRuntime.start(
        input,
        options.command ?? nativeRuntimeCommand(input),
      )
    },
  }
}

function nativeRuntimeCommand(input: BeeGameSessionRunnerStartInput): string[] {
  return [
    ...resolveNativeRuntimeCommand(),
    '--print',
    '--verbose',
    '--input-format=stream-json',
    '--output-format=stream-json',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-prompt-tool=stdio',
    ...(input.resumeSessionId ? [`--resume=${input.resumeSessionId}`] : []),
  ]
}

class NativeCliProcessRuntime implements BeeGameSessionRuntime {
  private activeTurn: {
    input: BeeGameSessionSubmitInput
    resolve(): void
    reject(error: Error): void
    abort(): void
  } | null = null
  private disposed = false
  private stderrTail = ''

  private constructor(
    private readonly child: RuntimeProcess,
    private readonly sessionInput: BeeGameSessionRunnerStartInput,
  ) {}

  static async start(
    input: BeeGameSessionRunnerStartInput,
    command: string[],
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
    const runtime = new NativeCliProcessRuntime(child, input)
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

    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.child.kill('SIGTERM')
        this.failActiveTurn(new Error('Bee Game Studio native turn was aborted'))
      }
      input.signal.addEventListener('abort', abort, { once: true })
      this.activeTurn = {
        input,
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
      this.write({
        type: 'user',
        uuid: crypto.randomUUID(),
        session_id: this.sessionInput.sessionId,
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
      for await (const line of ndjsonLines(this.child.stdout)) {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          throw new Error(`Bee Game Studio native runtime emitted invalid JSON: ${line}`)
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
    if (message.type === 'control_request') {
      await this.resolvePermissionRequest(message)
      return
    }
    const turn = this.activeTurn
    if (!turn) return
    turn.input.onMessage(message as DashboardSDKMessage)
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
      turn.reject(new Error(nativeErrorDetail(message)))
      return
    }
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
    turn?.reject(error)
  }

  private write(message: Record<string, unknown>): void {
    if (this.child.exitCode !== null)
      throw new Error('Bee Game Studio native runtime is not running')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
    this.child.stdin.flush()
  }
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
    ...Object.fromEntries(
      SAFE_INHERITED_ENV.flatMap(key => {
        const value = process.env[key]
        return value === undefined ? [] : [[key, value]]
      }),
    ),
    ...selectedModelEnvironment,
  }
}

async function* ndjsonLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of stream) {
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
