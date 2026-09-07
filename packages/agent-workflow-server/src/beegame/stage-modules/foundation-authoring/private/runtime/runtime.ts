import { createHash, randomUUID } from 'node:crypto'

export type AuthorPromptBlock = { type: 'text'; text: string }
export type AuthorPromptInput = string | readonly AuthorPromptBlock[]

export type AuthorNativeMessage = {
  type: string
  [key: string]: unknown
}

export type AuthorUsage = {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

export type AuthorTerminal = {
  kind: 'completed' | 'failed' | 'stopped' | 'empty'
  message?: AuthorNativeMessage
  error?: string
  markdown: string
  terminalDigest: string
}

export type AuthorRuntimeFailureCode =
  | 'cancelled'
  | 'runtime_closed'
  | 'native_protocol_error'
  | 'native_model_error'
  | 'native_process_exit'

export class AuthorRuntimeError extends Error {
  usage: AuthorUsage
  turnUsage: AuthorUsage

  constructor(
    readonly code: AuthorRuntimeFailureCode,
    message: string,
    usage: AuthorUsage = emptyAuthorUsage(),
    turnUsage: AuthorUsage = emptyAuthorUsage(),
  ) {
    super(message)
    this.name = 'AuthorRuntimeError'
    this.usage = cloneUsage(usage)
    this.turnUsage = cloneUsage(turnUsage)
  }
}

export type AuthorRuntimeConfig = {
  /** Fully resolved native model process command, before author protocol flags. */
  command: readonly string[]
  /** Explicit model/credential configuration. It is copied and allowlisted. */
  env: Readonly<Record<string, string>>
  /** Optional opaque data retained by the caller; never logged by runtime. */
  data?: Readonly<Record<string, unknown>>
}

export type AuthorRuntimeExecuteInput = {
  runId: string
  dispatchId: string
  workspacePath: string
  prompt: AuthorPromptInput
  signal?: AbortSignal
  /** Private callback used by the author Markdown sink/event reducer. */
  onMessage?: (message: AuthorNativeMessage) => void | Promise<void>
  /** Private durable metering hook; includes filtered transport retry terminals. */
  onUsage?: (usage: AuthorUsage) => void | Promise<void>
  onNativeSessionId?: (sessionId: string) => void | Promise<void>
  /** A persisted native UUID, never a routing/run identity. */
  resumeSessionId?: string
}

export type AuthorRuntimeResult = {
  sessionId?: string
  usage: AuthorUsage
  turnUsage: AuthorUsage
  markdown: string
  terminal: AuthorTerminal
}

export type AuthorRuntime = {
  execute(input: AuthorRuntimeExecuteInput): Promise<AuthorRuntimeResult>
  /** Immutable snapshot of all usage observed so far, including failed turns. */
  getUsageSnapshot(): AuthorUsage
  stop(): void
  dispose(): void
}

type RuntimeProcess = {
  stdin: {
    write(content: string): number | Promise<number>
    flush(): number | Promise<number>
    end(): number | Promise<number>
  }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exitCode: number | null
  kill(signal?: string): void
  exited: Promise<number>
}

type SpawnOptions = {
  cwd: string
  env: Record<string, string>
  stdin: 'pipe'
  stdout: 'pipe'
  stderr: 'pipe'
}

type Spawn = (command: string[], options: SpawnOptions) => RuntimeProcess

const MARKDOWN_PROTOCOL_RESTART_PROMPT =
  'No visible Markdown was emitted. Return the complete raw Markdown document from the beginning now; do not explain or summarize.'

const AUTHOR_ENV_KEYS = new Set([
  'BEEGAME_MODEL',
  'BEEGAME_MODEL_TYPE',
  'BEEGAME_CONFIG_DIR',
  'NPM_CONFIG_CACHE',
  'npm_config_cache',
  'NPM_CONFIG_USERCONFIG',
  'npm_config_userconfig',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_DEFAULT_HAIKU_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GEMINI',
  'GEMINI_BASE_URL',
  'GEMINI_API_KEY',
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GROK',
  'GROK_BASE_URL',
  'GROK_API_KEY',
  'GROK_DEFAULT_HAIKU_MODEL',
  'GROK_DEFAULT_SONNET_MODEL',
  'GROK_DEFAULT_OPUS_MODEL',
  'AWS_REGION',
  'AWS_BEDROCK_MODEL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS',
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'ANTHROPIC_UNIX_SOCKET',
])

const SAFE_INHERITED_ENV_KEYS = [
  'CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING',
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

export function createAuthorRuntime(config: AuthorRuntimeConfig): AuthorRuntime {
  return createAuthorRuntimeWithSpawn(config, nativeSpawn)
}

/** Internal test seam; only import this through private/runtime/test-entry.ts. */
export function createAuthorRuntimeWithSpawn(
  config: AuthorRuntimeConfig,
  spawn: Spawn,
): AuthorRuntime {
  const command = [...config.command]
  const env = authorRuntimeEnvironment(config.env)
  if (command.length === 0) throw new Error('Author native runtime command is required')
  return new AuthorRuntimeImpl(
    command,
    env,
    structuredClone(config.data ?? {}),
    spawn,
  )
}

export function authorRuntimeEnvironment(
  selectedEnvironment: Readonly<Record<string, string>>,
): Record<string, string> {
  const inherited = Object.fromEntries(
    SAFE_INHERITED_ENV_KEYS.flatMap(key => {
      const value = process.env[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )
  return {
    ...inherited,
    ...Object.fromEntries(
      Object.entries({ ...selectedEnvironment }).filter(([key]) =>
        AUTHOR_ENV_KEYS.has(key),
      ),
    ),
  }
}

export function authorRuntimeCommand(
  command: readonly string[],
  resumeSessionId?: string,
): string[] {
  if (command.length === 0) throw new Error('Author native runtime command is required')
  if (resumeSessionId && !isNativeSessionId(resumeSessionId)) {
    throw new Error('Author native resume session ID must be a UUID')
  }
  return [
    ...command,
    '--print',
    '--verbose',
    '--input-format=stream-json',
    '--output-format=stream-json',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-prompt-tool=stdio',
    // Author Markdown is a protocol stream. Native tools are intentionally
    // unavailable; the author sink owns the only document write authority.
    '--tools',
    '',
    ...(resumeSessionId ? [`--resume=${resumeSessionId}`] : []),
  ]
}

class AuthorRuntimeImpl implements AuthorRuntime {
  private process: RuntimeProcess | null = null
  private workspacePath: string | undefined
  private nativeSessionId: string | undefined
  private disposed = false
  private active: ActiveTurn | null = null
  private modelEpochTotal = emptyAuthorUsage()
  private latestModelUsage: AuthorUsage | null = null
  private streamedUsage = emptyAuthorUsage()

  constructor(
    private readonly command: readonly string[],
    private readonly env: Record<string, string>,
    // Host-supplied data is copied at construction and has no execution
    // behavior. Credentials must already be resolved before construction.
    private readonly data: Record<string, unknown>,
    private readonly spawn: Spawn,
  ) {}

  async execute(input: AuthorRuntimeExecuteInput): Promise<AuthorRuntimeResult> {
    if (this.disposed) throw new Error('Author native runtime is closed')
    if (this.active) throw new Error('Author native runtime already has an active turn')
    if (!isAbsoluteWorkspace(input.workspacePath)) {
      throw new Error('Author workspace path must be absolute')
    }
    if (input.signal?.aborted) throw cancelledError()
    if (this.workspacePath && this.workspacePath !== input.workspacePath) {
      throw new Error('Author runtime cannot change workspace between turns')
    }
    this.workspacePath = input.workspacePath
    if (!this.process) {
      this.nativeSessionId = input.resumeSessionId
      this.process = this.startProcess(input.workspacePath, input.resumeSessionId)
    } else if (input.resumeSessionId && input.resumeSessionId !== this.nativeSessionId) {
      throw new Error('Author runtime resume identity conflicts with active process')
    }

    const executionInput: AuthorRuntimeExecuteInput = {
      runId: String(input.runId),
      dispatchId: String(input.dispatchId),
      workspacePath: String(input.workspacePath),
      prompt: clonePrompt(input.prompt),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onMessage ? { onMessage: input.onMessage } : {}),
      ...(input.onUsage ? { onUsage: input.onUsage } : {}),
      ...(input.onNativeSessionId
        ? { onNativeSessionId: input.onNativeSessionId }
        : {}),
      ...(input.resumeSessionId
        ? { resumeSessionId: String(input.resumeSessionId) }
        : {}),
    }
    const turnStartUsage = this.currentUsage()
    const turn = this.newTurn(executionInput, turnStartUsage)
    this.active = turn
    const onAbort = () => {
      this.process?.kill('SIGTERM')
      this.failActive(turn, cancelledError())
    }
    executionInput.signal?.addEventListener('abort', onAbort, { once: true })
    let submitted = false
    try {
      await this.writeUser(executionInput.prompt, turn)
      submitted = true
      return await turn.promise
    } catch (error) {
      if (this.active === turn) {
        // If the initial stdin write failed, the turn promise has never been
        // handed to an awaiter; rejecting it here would create an unhandled
        // promise in addition to the execute() failure.
        if (submitted)
          this.failActive(turn, asRuntimeError(error, 'native_protocol_error'))
        else this.active = null
      }
      throw asRuntimeError(error, 'native_protocol_error')
    } finally {
      executionInput.signal?.removeEventListener('abort', onAbort)
      if (this.active === turn) this.active = null
    }
  }

  stop(): void {
    const active = this.active
    if (!active) return
    this.process?.kill('SIGTERM')
    this.failActive(active, cancelledError())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.active) this.failActive(this.active, new AuthorRuntimeError(
      'runtime_closed',
      'Author native runtime was closed',
    ))
    const process = this.process
    if (!process) return
    void Promise.resolve(process.stdin.end()).catch(() => undefined)
    if (process.exitCode === null) process.kill('SIGTERM')
    this.process = null
  }

  getUsageSnapshot(): AuthorUsage {
    return cloneUsage(this.currentUsage())
  }

  private startProcess(workspacePath: string, resumeSessionId?: string): RuntimeProcess {
    let process: RuntimeProcess
    try {
      process = this.spawn(authorRuntimeCommand(this.command, resumeSessionId), {
        cwd: workspacePath,
        env: { ...this.env },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    } catch {
      throw new AuthorRuntimeError(
        'native_process_exit',
        'Author native runtime could not start',
      )
    }
    const stdoutDrain = this.consumeStdout(process)
    void this.consumeStderr(process)
    // Bun can resolve `exited` before the readable stdout stream has drained.
    // Terminal arbitration must happen after both signals, otherwise a final
    // result (or the awaited native-session callback) can be lost.
    void process.exited.then(code => {
      void stdoutDrain.then(
        () => this.onExit(process, code),
        () => this.onExit(process, code),
      )
    })
    return process
  }

  private newTurn(
    input: AuthorRuntimeExecuteInput,
    turnStartUsage: AuthorUsage,
  ): ActiveTurn {
    let resolvePromise!: (result: AuthorRuntimeResult) => void
    let rejectPromise!: (error: Error) => void
    const promise = new Promise<AuthorRuntimeResult>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    return {
      input,
      turnStartUsage,
      requestId: randomUUID(),
      markdown: '',
      markdownStreamDeltaSeen: false,
      markdownEmptyRetryIssued: false,
      resolve: resolvePromise,
      reject: rejectPromise,
      promise,
    }
  }

  private async consumeStdout(process: RuntimeProcess): Promise<void> {
    try {
      for await (const line of ndjsonLines(process.stdout)) {
        let message: AuthorNativeMessage
        try {
          message = JSON.parse(line) as AuthorNativeMessage
        } catch {
          this.failActive(this.active, new AuthorRuntimeError(
            'native_protocol_error',
            'Author native runtime emitted invalid JSON',
          ))
          continue
        }
        await this.onMessage(message)
      }
    } catch (error) {
      this.failActive(this.active, asRuntimeError(error, 'native_protocol_error'))
    }
  }

  private async consumeStderr(process: RuntimeProcess): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for await (const chunk of process.stderr) {
        // Drain stderr but never retain or expose provider error text: model
        // credentials and request material can be present in native stderr.
        decoder.decode(chunk, { stream: true })
      }
    } catch {
      // stderr is diagnostic only; it must not alter author terminal state.
    }
  }

  private async onMessage(message: AuthorNativeMessage): Promise<void> {
    const reportedSessionId = stringField(message, 'session_id')
    if (reportedSessionId && isNativeSessionId(reportedSessionId) &&
      reportedSessionId !== this.nativeSessionId) {
      this.nativeSessionId = reportedSessionId
      await this.active?.input.onNativeSessionId?.(reportedSessionId)
    }

    const turn = this.active
    if (!turn) return
    this.observeUsage(message)
    await turn.input.onUsage?.(this.currentUsage())
    if (this.active !== turn) return
    const streamed = streamedMarkdownText(message)
    if (message.type === 'stream_event') {
      turn.markdownStreamDeltaSeen = true
      turn.markdown += streamed
    } else if (message.type === 'assistant' &&
      (!turn.markdownStreamDeltaSeen || !turn.markdown)) {
      turn.markdown += assistantMarkdownText(message)
    } else if (message.type === 'result' && !turn.markdown) {
      turn.markdown = stringField(message, 'result')
    }

    const retryableEmptyResult =
      message.type === 'result' &&
      !isErrorResult(message) &&
      !turn.markdown.trim()
    // An empty terminal is a transport retry marker, not a sink terminal.
    // Passing it to the real sink would make the next message_start look like
    // a second terminal/replacement and can poison the eventual commit.
    if (!retryableEmptyResult) {
      await turn.input.onMessage?.(message)
      if (this.active !== turn) return
    }

    if (message.type === 'control_request') {
      await this.denyPermission(message, turn)
      return
    }

    if (message.type !== 'result') return
    if (isErrorResult(message)) {
      this.failActive(turn, new AuthorRuntimeError(
        'native_model_error',
        'Author native model execution failed',
      ))
      return
    }
    if (retryableEmptyResult && !turn.markdownEmptyRetryIssued) {
      turn.markdownEmptyRetryIssued = true
      turn.markdown = ''
      turn.markdownStreamDeltaSeen = false
      if (this.active !== turn) return
      await this.writeUser(MARKDOWN_PROTOCOL_RESTART_PROMPT, turn)
      return
    }
    if (retryableEmptyResult) {
      this.failActive(turn, new AuthorRuntimeError(
        'native_model_error',
        'Author native model response ended without visible Markdown',
      ))
      return
    }
    this.completeActive(turn, message)
  }

  private async denyPermission(
    message: AuthorNativeMessage,
    turn: ActiveTurn,
  ): Promise<void> {
    const requestId = stringField(message, 'request_id')
    const request = objectField(message, 'request')
    if (!requestId || stringField(request, 'subtype') !== 'can_use_tool') return
    if (this.active !== turn) return
    await this.write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: 'deny',
          message: 'Foundation author Markdown mode does not permit native tools.',
          toolUseID: stringField(request, 'tool_use_id'),
          decisionClassification: 'user_reject',
        },
      },
    }, turn)
  }

  private observeUsage(message: AuthorNativeMessage): void {
    const modelUsage = modelUsageFromMessage(message)
    if (modelUsage) {
      if (this.latestModelUsage && hasCounterReset(this.latestModelUsage, modelUsage)) {
        addAuthorUsage(this.modelEpochTotal, this.latestModelUsage)
      }
      this.latestModelUsage = modelUsage
      this.streamedUsage = emptyAuthorUsage()
      return
    }
    const direct = usageFromMessage(message)
    if (!direct) return
    this.streamedUsage.prompt_tokens = Math.max(this.streamedUsage.prompt_tokens, direct.prompt_tokens)
    this.streamedUsage.completion_tokens = Math.max(this.streamedUsage.completion_tokens, direct.completion_tokens)
    this.streamedUsage.cache_read_tokens = Math.max(this.streamedUsage.cache_read_tokens, direct.cache_read_tokens)
    this.streamedUsage.cache_creation_tokens = Math.max(this.streamedUsage.cache_creation_tokens, direct.cache_creation_tokens)
    this.streamedUsage.total_tokens =
      this.streamedUsage.prompt_tokens + this.streamedUsage.completion_tokens +
      this.streamedUsage.cache_read_tokens + this.streamedUsage.cache_creation_tokens
  }

  private currentUsage(): AuthorUsage {
    const result = { ...this.modelEpochTotal }
    if (this.latestModelUsage) addAuthorUsage(result, this.latestModelUsage)
    addAuthorUsage(result, this.streamedUsage)
    return result
  }

  private completeActive(turn: ActiveTurn, message: AuthorNativeMessage): void {
    if (this.active !== turn) return
    const usage = this.currentUsage()
    const turnUsage = subtractAuthorUsage(usage, turn.turnStartUsage)
    const terminalDigest = createHash('sha256')
      .update(JSON.stringify({
        runId: turn.input.runId,
        dispatchId: turn.input.dispatchId,
        message,
        markdown: turn.markdown,
        turnUsage,
      }))
      .digest('hex')
    this.active = null
    turn.resolve({
      ...(this.nativeSessionId ? { sessionId: this.nativeSessionId } : {}),
      usage,
      turnUsage,
      markdown: turn.markdown,
      terminal: {
        kind: 'completed',
        message,
        markdown: turn.markdown,
        terminalDigest,
      },
    })
  }

  private failActive(turn: ActiveTurn | null, error: Error): void {
    if (!turn || this.active !== turn) return
    const usage = this.currentUsage()
    const turnUsage = subtractAuthorUsage(usage, turn.turnStartUsage)
    if (error instanceof AuthorRuntimeError) {
      error.usage = cloneUsage(usage)
      error.turnUsage = cloneUsage(turnUsage)
    }
    this.active = null
    turn.reject(error)
  }

  private onExit(process: RuntimeProcess, code: number): void {
    if (this.disposed) return
    if (this.process !== process) return
    this.disposed = true
    if (this.active) {
      this.failActive(this.active, new AuthorRuntimeError(
        'native_process_exit',
        `Author native runtime exited without a terminal result (${code})`,
      ))
    }
  }

  private async writeUser(
    prompt: AuthorPromptInput,
    turn?: ActiveTurn,
  ): Promise<void> {
    if (turn && this.active !== turn) return
    await this.write({
      type: 'user',
      uuid: randomUUID(),
      session_id: this.nativeSessionId ?? '',
      parent_tool_use_id: null,
      message: { role: 'user', content: nativePromptContent(prompt) },
    }, turn)
  }

  private async write(
    message: Record<string, unknown>,
    turn?: ActiveTurn,
  ): Promise<void> {
    const process = this.process
    if (!process || process.exitCode !== null) {
      throw new Error('Author native runtime is not running')
    }
    await process.stdin.write(`${JSON.stringify(message)}\n`)
    if (turn && this.active !== turn) return
    await process.stdin.flush()
  }
}

type ActiveTurn = {
  input: AuthorRuntimeExecuteInput
  turnStartUsage: AuthorUsage
  requestId: string
  markdown: string
  markdownStreamDeltaSeen: boolean
  markdownEmptyRetryIssued: boolean
  resolve(result: AuthorRuntimeResult): void
  reject(error: Error): void
  promise: Promise<AuthorRuntimeResult>
}

function nativeSpawn(command: string[], options: SpawnOptions): RuntimeProcess {
  return Bun.spawn(command, options) as unknown as RuntimeProcess
}

function nativePromptContent(prompt: AuthorPromptInput): unknown {
  return typeof prompt === 'string' ? [{ type: 'text', text: prompt }] :
    prompt.map(block => ({ type: 'text', text: block.text }))
}

function clonePrompt(prompt: AuthorPromptInput): AuthorPromptInput {
  if (typeof prompt === 'string') return String(prompt)
  return prompt.map(block => ({ type: 'text', text: String(block.text) }))
}

function isAbsoluteWorkspace(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function isNativeSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function streamedMarkdownText(message: AuthorNativeMessage): string {
  if (message.type !== 'stream_event') return ''
  const event = objectField(message, 'event')
  const delta = event ? objectField(event, 'delta') : undefined
  return delta && stringField(delta, 'type') === 'text_delta' ? stringField(delta, 'text') : ''
}

function assistantMarkdownText(message: AuthorNativeMessage): string {
  if (message.type !== 'assistant') return ''
  const body = objectField(message, 'message')
  const content = body?.content
  if (!Array.isArray(content)) return ''
  return content.filter(isObject).filter(block => stringField(block, 'type') === 'text')
    .map(block => stringField(block, 'text')).join('')
}

function isErrorResult(message: AuthorNativeMessage): boolean {
  return message.is_error === true ||
    (typeof message.subtype === 'string' && message.subtype !== 'success')
}

function usageFromMessage(message: AuthorNativeMessage): AuthorUsage | null {
  const usage = usageRecord(message)
  if (!usage) return null
  const prompt = finiteToken(usage.input_tokens ?? usage.prompt_tokens)
  const completion = finiteToken(usage.output_tokens ?? usage.completion_tokens)
  const cacheRead = finiteToken(usage.cache_read_input_tokens ?? usage.cache_read_tokens)
  const cacheCreation = finiteToken(usage.cache_creation_input_tokens ?? usage.cache_creation_tokens)
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    total_tokens: prompt + completion + cacheRead + cacheCreation,
  }
}

function modelUsageFromMessage(message: AuthorNativeMessage): AuthorUsage | null {
  const modelUsage = message.modelUsage
  if (!isObject(modelUsage)) return null
  const total = emptyAuthorUsage()
  for (const value of Object.values(modelUsage)) {
    if (!isObject(value)) continue
    const prompt = finiteToken(value.inputTokens ?? value.input_tokens)
    const completion = finiteToken(value.outputTokens ?? value.output_tokens)
    const cacheRead = finiteToken(value.cacheReadInputTokens ?? value.cache_read_input_tokens)
    const cacheCreation = finiteToken(value.cacheCreationInputTokens ?? value.cache_creation_input_tokens)
    addAuthorUsage(total, {
      prompt_tokens: prompt,
      completion_tokens: completion,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      total_tokens: prompt + completion + cacheRead + cacheCreation,
    })
  }
  return total.total_tokens > 0 ? total : null
}

function usageRecord(message: AuthorNativeMessage): Record<string, unknown> | null {
  if (isObject(message.usage)) return message.usage
  const event = objectField(message, 'event')
  if (event?.usage && isObject(event.usage)) return event.usage
  const eventMessage = event ? objectField(event, 'message') : undefined
  if (eventMessage?.usage && isObject(eventMessage.usage)) return eventMessage.usage
  const body = objectField(message, 'message')
  if (body?.usage && isObject(body.usage)) return body.usage
  return null
}

function finiteToken(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function hasCounterReset(previous: AuthorUsage, current: AuthorUsage): boolean {
  return current.prompt_tokens < previous.prompt_tokens ||
    current.completion_tokens < previous.completion_tokens ||
    current.cache_read_tokens < previous.cache_read_tokens ||
    current.cache_creation_tokens < previous.cache_creation_tokens
}

export function emptyAuthorUsage(): AuthorUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 0,
  }
}

function cloneUsage(value: AuthorUsage): AuthorUsage {
  return { ...value }
}

export function addAuthorUsage(target: AuthorUsage, value: AuthorUsage): void {
  target.prompt_tokens += value.prompt_tokens
  target.completion_tokens += value.completion_tokens
  target.cache_read_tokens += value.cache_read_tokens
  target.cache_creation_tokens += value.cache_creation_tokens
  target.total_tokens += value.total_tokens
}

export function subtractAuthorUsage(total: AuthorUsage, previous: AuthorUsage): AuthorUsage {
  const prompt = Math.max(0, total.prompt_tokens - previous.prompt_tokens)
  const completion = Math.max(0, total.completion_tokens - previous.completion_tokens)
  const cacheRead = Math.max(0, total.cache_read_tokens - previous.cache_read_tokens)
  const cacheCreation = Math.max(0, total.cache_creation_tokens - previous.cache_creation_tokens)
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    total_tokens: prompt + completion + cacheRead + cacheCreation,
  }
}

function objectField(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const field = value?.[key]
  return isObject(field) ? field : undefined
}

function stringField(value: Record<string, unknown> | undefined, key: string): string {
  return typeof value?.[key] === 'string' ? value[key] as string : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asRuntimeError(
  error: unknown,
  fallbackCode: AuthorRuntimeFailureCode,
): AuthorRuntimeError {
  if (error instanceof AuthorRuntimeError) return error
  return new AuthorRuntimeError(fallbackCode, runtimeErrorMessage(fallbackCode))
}

function runtimeErrorMessage(code: AuthorRuntimeFailureCode): string {
  switch (code) {
    case 'cancelled': return 'Author native turn was cancelled by user'
    case 'runtime_closed': return 'Author native runtime was closed'
    case 'native_protocol_error': return 'Author native runtime protocol failed'
    case 'native_model_error': return 'Author native model execution failed'
    case 'native_process_exit': return 'Author native runtime exited unexpectedly'
  }
}

function cancelledError(): AuthorRuntimeError {
  return new AuthorRuntimeError('cancelled', runtimeErrorMessage('cancelled'))
}

async function* ndjsonLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
