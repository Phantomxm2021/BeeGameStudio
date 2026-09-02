import type {
  BeeGamePromptInput,
  DashboardSDKMessage,
  BeeGameSessionRunner,
  BeeGameSessionRunnerStartInput,
  BeeGameSessionRuntime,
  BeeGameSessionSubmitInput,
  DashboardPermissionDecision,
  WorkflowRecordStreamContract,
} from './session-manager'
import type { BeeGameNativeTaskNotification } from './native-task-notification'
import { resolveNativeRuntimeCommand } from './native-runtime-process-path'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'
import {
  createRuntimeObservability,
  type RuntimeObservability,
} from './runtime-observability'
import { assessGameDocumentMarkdownStructure } from './complete-game-document'

type RuntimeProcess = ReturnType<typeof Bun.spawn> & {
  stdin: {
    write(content: string): number
    flush(): number | Promise<number>
    end(): number | Promise<number>
  }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}

const MARKDOWN_PROTOCOL_CONTINUATION_PROMPT =
  'Continue the same raw Markdown response from the exact point where it stopped. Return only the remaining Markdown; do not restart, summarize, or repeat the document title.'
const MARKDOWN_PROTOCOL_RESTART_PROMPT =
  'No visible Markdown was emitted. Return the complete raw Markdown document from the beginning now; do not explain or summarize.'
const STRUCTURED_OUTPUT_PROTOCOL_CONTINUATION_PROMPT =
  'Continue the same StructuredOutput submission from the current native context. Do not explain, summarize, or restart. Submit exactly one completed StructuredOutput value conforming to the supplied schema.'
const RECORD_STREAM_PROTOCOL_CONTINUATION_PROMPT =
  'Continue the same raw NDJSON record stream from the exact point where it stopped. Return only the remaining bytes; do not repeat completed records, wrap the stream, call tools, or explain.'

export function createNativeCliProcessRunner(
  options: {
    command?: string[]
    observabilityFactory?: (input: {
      workspacePath: string
      sessionId: string
      provider: string
      model: string
      launchContract?: BeeGameSessionRunnerStartInput['runtimeLaunchContract']
    }) => RuntimeObservability
  } = {},
): BeeGameSessionRunner {
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
  if (input.workflowRecordStreamContract)
    assertRecordStreamContract(input.workflowRecordStreamContract)
  if (input.workflowJsonSchema && input.workflowRecordStreamContract)
    throw new Error(
      'A native turn may use either StructuredOutput or record_stream, not both',
    )
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
    ...(input.workflowJsonSchema
      ? ['--json-schema', JSON.stringify(input.workflowJsonSchema)]
      : []),
    // StructuredOutput fact turns receive the packet as their sole input;
    // disable the native built-in inventory while retaining --json-schema as
    // the one terminal lane. Markdown streams keep their existing boundary.
    ...(input.workflowWorkerType === 'foundation-document-reviser'
      ? ['--tools', 'Read', 'Edit', 'SubmitFoundationRevisionResult']
      : input.workflowJsonSchema ||
          input.workflowMarkdownStreamContract ||
          input.workflowRecordStreamContract
        ? ['--tools', '']
        : []),
    ...(input.resumeSessionId ? [`--resume=${input.resumeSessionId}`] : []),
  ]
}

class NativeCliProcessRuntime implements BeeGameSessionRuntime {
  private activeTurn: {
    input: BeeGameSessionSubmitInput
    requestId: string
    markdownOutput: string
    markdownStreamDeltaSeen: boolean
    markdownContinuationExpected: boolean
    markdownContinuationOutput: string
    markdownRestartExpected: boolean
    recordStreamOutput: string
    recordStreamResponseOutput: string
    recordStreamContinuationPending: boolean
    structuredOutputFailure?: Record<string, unknown>
    structuredOutputProgressIdentity?: string
    structuredOutputMaxTokensSeen: boolean
    structuredOutputContinuationPending: boolean
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
    if (input.workflowRecordStreamContract)
      assertRecordStreamContract(input.workflowRecordStreamContract)
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
    if (this.disposed)
      throw new Error('Bee Game Studio native runtime is closed')
    if (this.activeTurn)
      throw new Error(
        'Bee Game Studio native runtime already has an active turn',
      )
    if (input.signal.aborted) return
    this.structuredOutputCalls.clear()

    await new Promise<void>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const abort = () => {
        this.child.kill('SIGTERM')
        this.failActiveTurn(
          new Error('Bee Game Studio native turn was aborted'),
        )
      }
      input.signal.addEventListener('abort', abort, { once: true })
      this.activeTurn = {
        input,
        requestId,
        markdownOutput: '',
        markdownStreamDeltaSeen: false,
        markdownContinuationExpected: false,
        markdownContinuationOutput: '',
        markdownRestartExpected: false,
        recordStreamOutput: '',
        recordStreamResponseOutput: '',
        recordStreamContinuationPending: false,
        structuredOutputMaxTokensSeen: false,
        structuredOutputContinuationPending: false,
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
      this.observability.beginTurn({
        requestId,
        promptByteCount: Buffer.byteLength(
          typeof input.prompt === 'string'
            ? input.prompt
            : JSON.stringify(input.prompt),
        ),
        resumed: this.nativeSessionId !== undefined,
      })
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
      for await (const line of ndjsonLines(
        this.child.stdout,
        chunk => {
          this.observability.observeStdoutChunk(chunk)
        },
        Boolean(this.sessionInput.workflowRecordStreamContract),
      )) {
        this.observability.observeLine(line)
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          throw new Error(
            `${this.sessionInput.workflowRecordStreamContract ? 'provider_stream_protocol_error: ' : ''}Bee Game Studio native runtime emitted invalid JSON (${Buffer.byteLength(line)} bytes)`,
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
    const turn = this.activeTurn
    if (message.type === 'control_request') {
      if (this.sessionInput.workflowRecordStreamContract) {
        if (!turn) return
        await this.rejectRecordStreamTurn(
          turn,
          new Error(
            'provider_stream_protocol_error: record_stream cannot invoke tools',
          ),
        )
        return
      }
      await this.resolvePermissionRequest(message)
      return
    }
    if (!turn) return
    this.observability.observeMessage(message)
    if (this.sessionInput.workflowRecordStreamContract) {
      await this.onRecordStreamMessage(turn, message)
      return
    }
    if (this.sessionInput.workflowMarkdownStreamContract) {
      const streamedText = streamedMarkdownText(message)
      if (message.type === 'stream_event') {
        turn.markdownStreamDeltaSeen = true
        if (turn.markdownContinuationExpected) {
          turn.markdownContinuationOutput += streamedText
          if (
            !turn.markdownRestartExpected &&
            turn.markdownContinuationOutput.trimStart().startsWith('# ')
          ) {
            await this.rejectMarkdownTurn(
              turn,
              new Error(
                'foundation_transport_needs_action: Markdown continuation restarted the document from its title',
              ),
            )
            return
          }
        }
        turn.markdownOutput += streamedText
      } else if (
        message.type === 'assistant' &&
        (!turn.markdownStreamDeltaSeen || !turn.markdownOutput)
      ) {
        const text = assistantMarkdownText(message)
        if (turn.markdownContinuationExpected)
          turn.markdownContinuationOutput += text
        turn.markdownOutput += text
      } else if (message.type === 'result' && !turn.markdownOutput) {
        const text = stringField(message, 'result')
        if (turn.markdownContinuationExpected)
          turn.markdownContinuationOutput = text
        turn.markdownOutput = text
      }
    }
    if (
      message.type === 'result' &&
      this.sessionInput.workflowMarkdownStreamContract &&
      !isErrorResult(message)
    ) {
      if (
        turn.markdownContinuationExpected &&
        !turn.markdownContinuationOutput.trim()
      ) {
        await this.rejectMarkdownTurn(
          turn,
          new Error(
            'foundation_transport_needs_action: Markdown continuation made no progress',
          ),
        )
        return
      }
      turn.markdownContinuationExpected = false
      turn.markdownRestartExpected = false
      if (isMissingVisibleMarkdownResult(message)) {
        if (!turn.markdownOutput.trim())
          await this.recoverIncompleteMarkdownTurn(turn, true)
        else
          await this.rejectMarkdownTurn(
            turn,
            new Error(
              'Bee Game Studio native model response ended without visible Markdown',
            ),
          )
        return
      }
      const structure = assessGameDocumentMarkdownStructure(
        this.sessionInput.workflowMarkdownStreamContract.targetPath,
        turn.markdownOutput,
      )
      if (structure.status === 'unreachable') {
        await this.rejectMarkdownTurn(
          turn,
          new Error(`foundation_transport_needs_action: ${structure.reason}`),
        )
        return
      }
      if (structure.status !== 'complete') {
        await this.recoverIncompleteMarkdownTurn(turn)
        return
      }
    }
    if (
      message.type === 'assistant' &&
      turn.structuredOutputContinuationPending
    ) {
      // The result message for the truncated response can arrive after the
      // continuation was written. The next assistant message marks the start
      // of that continuation response and makes subsequent stop metadata
      // authoritative again.
      turn.structuredOutputContinuationPending = false
    }
    if (
      this.sessionInput.workflowJsonSchema &&
      message.type === 'result' &&
      stringField(message, 'stop_reason') === 'max_tokens' &&
      turn.structuredOutputContinuationPending
    ) {
      // Do not expose the stale result envelope for the response that already
      // caused this continuation. It cannot become a workflow terminal.
      return
    }
    this.captureStructuredOutputCall(message)
    const structuredOutput = this.successfulStructuredOutput(message)
    if (
      this.sessionInput.workflowJsonSchema &&
      this.failedStructuredOutput(message)
    ) {
      // A provider may first emit the failed tool_result and only then report
      // message_delta.stop_reason=max_tokens. Keep this failure out of the
      // delivery event stream until the native turn classifies the stop.
      turn.structuredOutputFailure = message
      return
    }
    const structuredStopReason = structuredOutputStopReason(message)
    if (
      this.sessionInput.workflowJsonSchema &&
      structuredStopReason === 'max_tokens'
    ) {
      turn.structuredOutputMaxTokensSeen = true
    }
    turn.input.onMessage(message as DashboardSDKMessage)
    if (
      this.sessionInput.workflowJsonSchema &&
      structuredOutput !== undefined
    ) {
      await this.completeStructuredTurn(turn, structuredOutput)
      return
    }
    if (
      this.sessionInput.workflowJsonSchema &&
      turn.structuredOutputMaxTokensSeen &&
      isMessageStop(message)
    ) {
      await this.recoverIncompleteStructuredTurn(turn)
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
    if (
      this.sessionInput.workflowJsonSchema &&
      stringField(message, 'stop_reason') === 'max_tokens' &&
      !turn.structuredOutputMaxTokensSeen &&
      !turn.structuredOutputContinuationPending
    ) {
      turn.structuredOutputMaxTokensSeen = true
      await this.recoverIncompleteStructuredTurn(turn)
      return
    }
    if (
      this.sessionInput.workflowJsonSchema &&
      turn.structuredOutputFailure &&
      !turn.structuredOutputContinuationPending
    ) {
      const error = new Error(
        'StructuredOutput failed before producing a valid result',
      )
      this.forwardStructuredOutputFailure(turn, error.message)
      await this.rejectStructuredTurn(turn, error)
      return
    }
    this.activeTurn = null
    if (isErrorResult(message)) {
      this.forwardStructuredOutputFailure(turn)
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

  private async recoverIncompleteStructuredTurn(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
  ): Promise<void> {
    const progressIdentity = structuredOutputProgressIdentity(
      this.structuredOutputCalls,
    )
    if (
      turn.structuredOutputProgressIdentity !== undefined &&
      turn.structuredOutputProgressIdentity === progressIdentity
    ) {
      const error = new Error(
        'StructuredOutput provider truncation: continuation made no progress',
      )
      this.forwardStructuredOutputFailure(turn, error.message)
      await this.rejectStructuredTurn(turn, error)
      return
    }
    turn.structuredOutputProgressIdentity = progressIdentity
    turn.structuredOutputFailure = undefined
    turn.structuredOutputMaxTokensSeen = false
    turn.structuredOutputContinuationPending = true
    this.write({
      type: 'user',
      uuid: crypto.randomUUID(),
      session_id: this.nativeSessionId ?? '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: nativePromptContent(
          STRUCTURED_OUTPUT_PROTOCOL_CONTINUATION_PROMPT,
        ),
      },
    })
  }

  private async onRecordStreamMessage(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
    message: Record<string, unknown>,
  ): Promise<void> {
    if (recordStreamContainsTool(message)) {
      await this.rejectRecordStreamTurn(
        turn,
        new Error(
          recordStreamHasEmptyToolIdentity(message)
            ? 'provider_stream_protocol_error: record_stream emitted an empty tool identity'
            : 'provider_stream_protocol_error: record_stream emitted a tool or DSML frame',
        ),
      )
      return
    }
    if (message.type === 'stream_event') {
      const text = streamedRecordText(message)
      if (text) {
        turn.recordStreamContinuationPending = false
        if (
          turn.recordStreamOutput &&
          (text === turn.recordStreamOutput ||
            text.startsWith(turn.recordStreamOutput))
        ) {
          await this.rejectRecordStreamTurn(
            turn,
            new Error(
              'provider_stream_protocol_error: record_stream emitted a cumulative frame',
            ),
          )
          return
        }
        if (
          turn.recordStreamResponseOutput &&
          (text === turn.recordStreamResponseOutput ||
            text.startsWith(turn.recordStreamResponseOutput))
        ) {
          await this.rejectRecordStreamTurn(
            turn,
            new Error(
              'provider_stream_protocol_error: record_stream emitted a cumulative frame',
            ),
          )
          return
        }
        turn.recordStreamOutput += text
        turn.recordStreamResponseOutput += text
        assertRecordStreamLines(turn.recordStreamOutput)
      }
      if (recordStreamUsage(message))
        turn.input.onMessage(message as DashboardSDKMessage)
      return
    }
    if (message.type !== 'result') return
    const terminal = recordStreamTerminal(turn.recordStreamOutput)
    if (
      terminal &&
      terminal ===
        stableJson(
          this.sessionInput.workflowRecordStreamContract!.terminalRecord,
        )
    ) {
      await this.completeRecordStreamTurn(turn)
      return
    }
    const responseMadeProgress = turn.recordStreamResponseOutput.length > 0
    const maxTokens = stringField(message, 'stop_reason') === 'max_tokens'
    if (isErrorResult(message) && !maxTokens) {
      await this.rejectRecordStreamTurn(
        turn,
        new Error(
          `provider_stream_protocol_error: ${nativeErrorDetail(message)}`,
        ),
      )
      return
    }
    if (!responseMadeProgress) {
      await this.rejectRecordStreamTurn(
        turn,
        new Error(
          'provider_stream_protocol_error: record_stream continuation made no progress',
        ),
      )
      return
    }
    this.writeRecordStreamContinuation(turn)
  }

  private writeRecordStreamContinuation(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
  ): void {
    turn.recordStreamResponseOutput = ''
    turn.recordStreamContinuationPending = true
    this.write({
      type: 'user',
      uuid: crypto.randomUUID(),
      session_id: this.nativeSessionId ?? '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: nativePromptContent(
          RECORD_STREAM_PROTOCOL_CONTINUATION_PROMPT,
        ),
      },
    })
  }

  private async completeRecordStreamTurn(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
  ): Promise<void> {
    this.activeTurn = null
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Record stream accepted',
      session_id: this.nativeSessionId ?? '',
      record_stream: turn.recordStreamOutput,
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

  private async rejectRecordStreamTurn(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
    error: Error,
  ): Promise<void> {
    this.activeTurn = null
    this.observability.finishTurn({ outcome: 'error', error })
    await this.observability.flush()
    turn.reject(error)
  }

  private failedStructuredOutput(message: Record<string, unknown>): boolean {
    if (message.type !== 'user') return false
    const user = objectField(message, 'message')
    const content = user?.content
    if (!Array.isArray(content)) return false
    return content.some(block => {
      if (!block || typeof block !== 'object' || Array.isArray(block))
        return false
      const value = block as Record<string, unknown>
      const toolUseID = stringField(value, 'tool_use_id')
      return (
        value.type === 'tool_result' &&
        value.is_error === true &&
        this.structuredOutputCalls.has(toolUseID)
      )
    })
  }

  private forwardStructuredOutputFailure(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
    override?: string,
  ): void {
    const failure = turn.structuredOutputFailure
    if (!failure) return
    turn.structuredOutputFailure = undefined
    if (!override) {
      turn.input.onMessage(failure as DashboardSDKMessage)
      return
    }
    const copy = structuredClone(failure)
    const user = objectField(copy, 'message')
    if (Array.isArray(user?.content)) {
      for (const block of user.content) {
        if (!block || typeof block !== 'object' || Array.isArray(block))
          continue
        const value = block as Record<string, unknown>
        if (value.type === 'tool_result' && value.is_error === true)
          value.content = override
      }
    }
    turn.input.onMessage(copy as DashboardSDKMessage)
  }

  private async rejectStructuredTurn(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
    error: Error,
  ): Promise<void> {
    this.activeTurn = null
    this.observability.finishTurn({ outcome: 'error', error })
    await this.observability.flush()
    turn.reject(error)
  }

  private async recoverIncompleteMarkdownTurn(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
    fromBeginning = false,
  ): Promise<void> {
    turn.markdownContinuationExpected = true
    turn.markdownContinuationOutput = ''
    turn.markdownRestartExpected = fromBeginning
    this.write({
      type: 'user',
      uuid: crypto.randomUUID(),
      session_id: this.nativeSessionId ?? '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: fromBeginning
              ? MARKDOWN_PROTOCOL_RESTART_PROMPT
              : MARKDOWN_PROTOCOL_CONTINUATION_PROMPT,
          },
        ],
      },
    })
  }

  private async rejectMarkdownTurn(
    turn: NonNullable<NativeCliProcessRuntime['activeTurn']>,
    error: Error,
  ): Promise<void> {
    this.activeTurn = null
    this.observability.finishTurn({ outcome: 'error', error })
    await this.observability.flush()
    turn.reject(error)
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
      : ({
          behavior: 'deny',
          message: 'Permission authority is unavailable.',
        } as const)
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

function assertRecordStreamContract(
  contract: WorkflowRecordStreamContract,
): void {
  if (
    contract.version !== 1 ||
    !contract.terminalRecord ||
    typeof contract.terminalRecord !== 'object' ||
    Array.isArray(contract.terminalRecord)
  )
    throw new Error(
      'provider_stream_protocol_error: record_stream contract must be v1 with one terminalRecord object',
    )
}

function runtimeIdentity(env: Record<string, string>): {
  provider: string
  model: string
} {
  if (
    env.ANTHROPIC_BASE_URL ||
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_API_KEY
  )
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
              message:
                decision.message ?? 'Permission denied by user settings.',
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
  strictBlankLines = false,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of stream) {
    observeChunk(chunk)
    buffer += decoder.decode(chunk, { stream: true })
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) {
        if (strictBlankLines)
          throw new Error(
            'provider_stream_protocol_error: record_stream emitted an internal blank line',
          )
        continue
      }
      yield line.trim()
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) yield buffer.trim()
  else if (strictBlankLines && buffer.length > 0)
    throw new Error(
      'provider_stream_protocol_error: record_stream emitted an internal blank line',
    )
}

function isErrorResult(message: Record<string, unknown>): boolean {
  return (
    message.is_error === true ||
    (typeof message.subtype === 'string' && message.subtype !== 'success')
  )
}

function isMissingVisibleMarkdownResult(
  message: Record<string, unknown>,
): boolean {
  return stringField(message, 'result').trim().length === 0
}

function streamedMarkdownText(message: Record<string, unknown>): string {
  if (message.type !== 'stream_event') return ''
  const event = objectField(message, 'event')
  const delta = event ? objectField(event, 'delta') : undefined
  return delta && stringField(delta, 'type') === 'text_delta'
    ? stringField(delta, 'text')
    : ''
}

function streamedRecordText(message: Record<string, unknown>): string {
  if (message.type !== 'stream_event') return ''
  const event = objectField(message, 'event')
  const delta = event ? objectField(event, 'delta') : undefined
  if (!delta || stringField(delta, 'type') !== 'text_delta') return ''
  const text = stringField(delta, 'text')
  if (!text)
    throw new Error(
      'provider_stream_protocol_error: record_stream emitted an empty text_delta',
    )
  if (/<(?:tool_use|tool_result|function_call|invoke|dsml)\b|<\|/iu.test(text))
    throw new Error(
      'provider_stream_protocol_error: record_stream emitted a DSML frame',
    )
  return text
}

function recordStreamUsage(message: Record<string, unknown>): boolean {
  if (message.type !== 'stream_event') return false
  const event = objectField(message, 'event')
  const delta = event ? objectField(event, 'delta') : undefined
  const usage = delta ? objectField(delta, 'usage') : undefined
  return Boolean(usage)
}

function assertRecordStreamLines(raw: string): void {
  const lines = raw.split('\n')
  const completeLines = raw.endsWith('\n')
    ? lines.slice(0, -1)
    : lines.slice(0, -1)
  for (const line of completeLines) {
    if (!line.trim())
      throw new Error(
        'provider_stream_protocol_error: record_stream emitted an internal blank line',
      )
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(
        'provider_stream_protocol_error: record_stream emitted malformed JSON',
      )
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error(
        'provider_stream_protocol_error: record_stream records must be JSON objects',
      )
  }
  const doneIndex = completeLines.findIndex(line => {
    try {
      return (JSON.parse(line) as Record<string, unknown>).record === 'done'
    } catch {
      return false
    }
  })
  if (doneIndex >= 0 && doneIndex !== completeLines.length - 1)
    throw new Error(
      'provider_stream_protocol_error: record_stream terminal record must be the final record',
    )
}

function recordStreamTerminal(raw: string): string | undefined {
  const lines = raw.split('\n')
  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  const last = lines.at(-1)?.trim()
  if (!last) return undefined
  try {
    const parsed = JSON.parse(last)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? stableJson(parsed)
      : undefined
  } catch {
    return undefined
  }
}

function recordStreamContainsTool(message: Record<string, unknown>): boolean {
  const blocks = extractNativeContentBlocks(message)
  return blocks.some(block => {
    const type = stringField(block, 'type')
    return (
      type === 'tool_use' ||
      type === 'tool_result' ||
      type === 'server_tool_use' ||
      type === 'mcp_tool_use' ||
      type === 'mcp_tool_result'
    )
  })
}

function recordStreamHasEmptyToolIdentity(
  message: Record<string, unknown>,
): boolean {
  return extractNativeContentBlocks(message).some(block => {
    const type = stringField(block, 'type')
    if (!type.includes('tool')) return false
    return !stringField(block, 'id') && !stringField(block, 'tool_use_id')
  })
}

function extractNativeContentBlocks(
  message: Record<string, unknown>,
): Record<string, unknown>[] {
  const nested = objectField(message, 'message')
  const event = objectField(message, 'event')
  const content =
    nested?.content ??
    message.content ??
    (event ? event.content_block : undefined)
  if (!Array.isArray(content)) return []
  return content.filter(
    (block): block is Record<string, unknown> =>
      Boolean(block) && typeof block === 'object' && !Array.isArray(block),
  )
}

function structuredOutputStopReason(message: Record<string, unknown>): string {
  if (message.type === 'stream_event') {
    const event = objectField(message, 'event')
    const delta = event ? objectField(event, 'delta') : undefined
    return delta ? stringField(delta, 'stop_reason') : ''
  }
  return message.type === 'message_delta'
    ? stringField(message, 'stop_reason')
    : ''
}

function isMessageStop(message: Record<string, unknown>): boolean {
  return (
    message.type === 'message_stop' ||
    (message.type === 'stream_event' &&
      objectField(message, 'event')?.type === 'message_stop')
  )
}

function structuredOutputProgressIdentity(
  calls: ReadonlyMap<string, unknown>,
): string {
  const latest = [...calls.values()].at(-1)
  return latest === undefined ? 'none' : stableJson(latest)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function assistantMarkdownText(message: Record<string, unknown>): string {
  if (message.type !== 'assistant') return ''
  const assistant = objectField(message, 'message')
  if (!assistant || !Array.isArray(assistant.content)) return ''
  return assistant.content
    .filter(
      (block): block is Record<string, unknown> =>
        !!block && typeof block === 'object' && !Array.isArray(block),
    )
    .filter(block => block.type === 'text')
    .map(block => stringField(block, 'text'))
    .join('')
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
    ...(typeof message.isMeta === 'boolean' ? { isMeta: message.isMeta } : {}),
  }
}
