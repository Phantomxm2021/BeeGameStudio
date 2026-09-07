import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { REVISION_MARKDOWN_RESTART_PROMPT, createRevisionVisibleMarkdownGate } from './visible-markdown-gate'
import { createRevisionWorkerMarkdownStream } from './worker-markdown-stream'
import { revisionCanonicalJson } from './json-digest'

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
// The native wire envelope is larger than the Markdown body (and a body can
// be repeated in stream events and the terminal result). This transport cap
// bounds pending NDJSON while retaining the legacy 2 MiB body boundary.
const MAX_TRANSPORT_BYTES = 32 * 1024 * 1024
const TERMINATION_GRACE_MS = 250

export type RevisionNativeProcessConfiguration = {
  command: readonly string[]
  env: Record<string, string>
}

export type RevisionNativeProcessInput = {
  configuration: RevisionNativeProcessConfiguration
  cwd: string
  scope: 'document' | 'section'
  prompt: string
  signal?: AbortSignal
  onMessage?: (captured: Record<string, unknown>) => void | Promise<void>
}

export type RevisionNativeProcessCompletion = {
  scope: 'direct-child'
  pid: number | null
  exitCode: number | null
  signalCode: string | null
  stdoutDrained: true
  termination: 'none' | 'term_requested' | 'kill_requested'
}

export type RevisionNativeProcessResult = {
  markdown: string
  nativeSessionId?: string
  completion: RevisionNativeProcessCompletion
}

export const REVISION_NATIVE_PROCESS_ERROR_CODES = [
  'revision_native_invalid_input',
  'revision_native_spawn_failed',
  'revision_native_write_failed',
  'revision_native_invalid_json',
  'revision_native_output_limit',
  'revision_native_observer_failed',
  'revision_native_aborted',
  'revision_native_tool_rejected',
  'revision_native_tool_failed',
  'revision_native_result_failed',
  'revision_native_markdown_invalid',
  'revision_native_missing_terminal',
  'revision_native_process_error',
] as const

export type RevisionNativeProcessErrorCode = typeof REVISION_NATIVE_PROCESS_ERROR_CODES[number]

/** An intentionally opaque native-process failure. It never contains stderr, a
 * request body, an environment value, or model output. */
export class RevisionNativeProcessError extends Error {
  readonly name = 'RevisionNativeProcessError'
  constructor(
    readonly code: RevisionNativeProcessErrorCode,
    readonly completion?: RevisionNativeProcessCompletion,
  ) {
    super(code)
  }
}

type CapturedMessage = Record<string, unknown>

export async function executeRevisionNativeProcess(
  rawInput: unknown,
): Promise<RevisionNativeProcessResult> {
  const input = captureInput(rawInput)
  if (input.signal?.aborted) throw new RevisionNativeProcessError('revision_native_aborted')
  let child: ChildProcess
  try {
    const argv = nativeRevisionArgv(input.scope)
    child = spawn(input.configuration.command[0]!, [
      ...input.configuration.command.slice(1),
      ...argv,
    ], {
      cwd: input.cwd,
      env: input.configuration.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    throw new RevisionNativeProcessError('revision_native_spawn_failed')
  }

  const pid = typeof child.pid === 'number' ? child.pid : null
  let exitCode: number | null = null
  let signalCode: string | null = null
  let termination: RevisionNativeProcessCompletion['termination'] = 'none'
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let failure: RevisionNativeProcessErrorCode | undefined
  let terminalAccepted = false
  let terminalMarkdown: string | undefined
  let nativeSessionId: string | undefined
  let sessionMismatch = false
  let observedMessage = false
  let spawnErrorSeen = false
  let spawnedEvent = false
  const assignedToolIds = new Set<string>()
  const gate = createRevisionVisibleMarkdownGate()
  const sink = createRevisionWorkerMarkdownStream({ scope: input.scope, maxBytes: MAX_MARKDOWN_BYTES })

  const completion = (): RevisionNativeProcessCompletion => ({
    scope: 'direct-child',
    pid,
    exitCode,
    signalCode,
    stdoutDrained: true,
    termination,
  })

  const fail = (code: RevisionNativeProcessErrorCode): void => {
    failure ??= code
    requestTermination()
  }

  const requestTermination = (): void => {
    if (closed) return
    try { child.stdin?.end() } catch { /* completion will report the process failure */ }
    if (termination === 'none') {
      termination = 'term_requested'
      try { child.kill('SIGTERM') } catch { /* child may have raced with close */ }
      timer = setTimeout(() => {
        if (closed) return
        termination = 'kill_requested'
        try { child.kill('SIGKILL') } catch { /* child may have raced with close */ }
      }, TERMINATION_GRACE_MS)
    }
  }

  const closePromise = new Promise<void>(resolve => {
    child.once('spawn', () => { spawnedEvent = true })
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      closed = true
      exitCode = typeof code === 'number' ? code : null
      signalCode = typeof signal === 'string' ? signal : null
      if (timer) clearTimeout(timer)
      resolve()
    })
    child.once('error', () => {
      spawnErrorSeen = true
      fail(observedMessage ? 'revision_native_process_error' : 'revision_native_spawn_failed')
    })
  })
  child.stdin?.once('error', () => {
    // ENOENT can report the pipe error before ChildProcess emits `error`.
    // Defer classification one turn so the process error wins when present.
    queueMicrotask(() => fail(spawnErrorSeen || !spawnedEvent ? 'revision_native_spawn_failed' : 'revision_native_write_failed'))
  })

  const send = (message: Record<string, unknown>): void => {
    try {
      if (!child.stdin || child.stdin.destroyed) throw new Error('stdin unavailable')
      child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch {
      fail(spawnedEvent ? 'revision_native_write_failed' : 'revision_native_spawn_failed')
    }
  }

  const sendUser = (text: string, sessionId: string): void => {
    send({
      type: 'user',
      uuid: crypto.randomUUID(),
      session_id: sessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text }] },
    })
  }

  const rememberSession = (message: CapturedMessage): void => {
    const value = message.session_id
    if (typeof value !== 'string' || !isUuid(value)) return
    if (nativeSessionId && nativeSessionId !== value) sessionMismatch = true
    else nativeSessionId ??= value
  }

  const handlePermission = (message: CapturedMessage): void => {
    if (message.type !== 'control_request') return
    const request = objectField(message, 'request')
    if (!request || request.subtype !== 'can_use_tool') return
    // Permission requests are deliberately denied at the stdio boundary. The
    // document read tool has its own packet-bound check inside the native tool.
    const requestId = stringField(message, 'request_id')
    const toolUseId = stringField(request, 'tool_use_id')
    if (!requestId) return
    send({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: 'deny',
          message: 'Permission denied by Revision native boundary.',
          ...(toolUseId ? { toolUseID: toolUseId } : {}),
          decisionClassification: 'user_reject',
        },
      },
    })
  }

  const inspectToolUse = (message: CapturedMessage): void => {
    if (message.type === 'assistant') {
      const content = objectField(message, 'message')?.content
      if (Array.isArray(content)) for (const item of content) {
        inspectContentBlock(item)
      }
    }
    if (message.type === 'stream_event') {
      const event = objectField(message, 'event')
      const block = event && objectField(event, 'content_block')
      if (block) inspectContentBlock(block)
    }
    if (message.type === 'user') {
      const content = objectField(message, 'message')?.content
      if (Array.isArray(content)) for (const item of content) {
        if (!isRecord(item) || item.type !== 'tool_result') continue
        const id = stringField(item, 'tool_use_id')
        if (item.is_error === true && assignedToolIds.has(id)) fail('revision_native_tool_failed')
      }
    }
  }

  const inspectContentBlock = (raw: unknown): void => {
    if (!isRecord(raw)) return
    if (raw.type !== 'tool_use' && raw.type !== 'server_tool_use') return
    const name = stringField(raw, 'name')
    const id = stringField(raw, 'id')
    if (name !== 'ReadAssignedFoundationRevision' || input.scope !== 'document' || raw.type !== 'tool_use') {
      fail('revision_native_tool_rejected')
      return
    }
    if (id) assignedToolIds.add(id)
  }

  const handleMessage = async (message: CapturedMessage): Promise<void> => {
    observedMessage = true
    try {
      await input.onMessage?.(structuredClone(message))
    } catch {
      fail('revision_native_observer_failed')
      return
    }
    if (failure || terminalAccepted) return
    if (typeof message.type !== 'string') { fail('revision_native_invalid_json'); return }
    rememberSession(message)
    if (sessionMismatch) { fail('revision_native_process_error'); return }
    handlePermission(message)
    inspectToolUse(message)
    if (failure || sessionMismatch) {
      return
    }
    let decision: 'forward' | 'restart' | 'reject_missing_markdown'
    try { decision = gate.observe(message) } catch { fail('revision_native_process_error'); return }
    if (decision === 'restart') {
      sendUser(REVISION_MARKDOWN_RESTART_PROMPT, nativeSessionId ?? '')
      return
    }
    if (decision === 'reject_missing_markdown') {
      fail('revision_native_missing_terminal')
      return
    }
    if (message.type === 'result' && isErrorResult(message)) {
      fail('revision_native_result_failed')
      return
    }
    try {
      sink.observe(message)
      if (message.type === 'result') {
        terminalMarkdown = sink.finish()
        terminalAccepted = true
        requestTermination()
      }
    } catch {
      sink.abort('Revision native Markdown was invalid')
      fail('revision_native_markdown_invalid')
    }
  }

  const consumeStdout = async (): Promise<void> => {
    if (!child.stdout) { fail('revision_native_process_error'); return }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = ''
    let bytes = 0
    try {
      for await (const chunk of child.stdout) {
        const current = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
        bytes += current.byteLength
        if (bytes > MAX_TRANSPORT_BYTES) { fail('revision_native_output_limit'); continue }
        let decoded: string
        try { decoded = decoder.decode(current, { stream: true }) } catch { fail('revision_native_invalid_json'); continue }
        pending += decoded
        if (Buffer.byteLength(pending, 'utf8') > MAX_TRANSPORT_BYTES) { fail('revision_native_output_limit'); pending = ''; continue }
        for (;;) {
          const newline = pending.indexOf('\n')
          if (newline < 0) break
          const line = pending.slice(0, newline).trim()
          pending = pending.slice(newline + 1)
          if (!line) continue
          let parsed: unknown
          try { parsed = JSON.parse(line) } catch { fail('revision_native_invalid_json'); continue }
          if (!isRecord(parsed)) { fail('revision_native_invalid_json'); continue }
          await handleMessage(structuredClone(parsed))
        }
      }
      try { pending += decoder.decode() } catch { fail('revision_native_invalid_json'); return }
      const line = pending.trim()
      if (line) {
        let parsed: unknown
        try { parsed = JSON.parse(line) } catch { fail('revision_native_invalid_json'); return }
        if (!isRecord(parsed)) { fail('revision_native_invalid_json'); return }
        await handleMessage(structuredClone(parsed))
      }
      if (!terminalAccepted && !failure) fail('revision_native_missing_terminal')
    } catch { fail('revision_native_process_error') }
  }

  const consumeStderr = async (): Promise<void> => {
    try { for await (const _chunk of child.stderr ?? []) { /* intentionally discarded */ } }
    catch { /* stderr is never surfaced; process failure is reported safely */ }
  }

  const abort = (): void => fail('revision_native_aborted')
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    if (input.signal?.aborted) abort()
    if (pid === null) fail('revision_native_spawn_failed')
    else if (!failure) sendUser(input.prompt, '')
    const stdoutTask = consumeStdout()
    const stderrTask = consumeStderr()
    await Promise.all([stdoutTask, stderrTask, closePromise])
    if (!terminalAccepted && !failure) {
      try { sink.finish() } catch { /* mapped below */ }
      failure = 'revision_native_missing_terminal'
    }
    if (sessionMismatch && !failure) failure = 'revision_native_process_error'
    if (input.signal?.aborted && !failure) failure = 'revision_native_aborted'
    if (failure) throw new RevisionNativeProcessError(failure, completion())
    return {
      markdown: terminalMarkdown!,
      ...(nativeSessionId ? { nativeSessionId } : {}),
      completion: completion(),
    }
  } finally {
    if (timer) clearTimeout(timer)
    input.signal?.removeEventListener('abort', abort)
  }
}

function nativeRevisionArgv(scope: 'document' | 'section'): string[] {
  return [
    '--print', '--verbose', '--input-format=stream-json', '--output-format=stream-json',
    '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool=stdio',
    '--tools', scope === 'document' ? 'ReadAssignedFoundationRevision' : '',
  ]
}

function captureInput(value: unknown): RevisionNativeProcessInput {
  if (!isRecord(value)) invalidInput()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const allowed = new Set(['configuration', 'cwd', 'scope', 'prompt', 'signal', 'onMessage'])
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).some(key => !allowed.has(key) || !descriptors[key]!.enumerable)) invalidInput()
  const data = (key: string, optional = false): unknown => {
    const descriptor = descriptors[key]
    if (!descriptor) { if (optional) return undefined; invalidInput() }
    if (!('value' in descriptor)) invalidInput()
    return descriptor.value
  }
  let captured: Record<string, unknown>
  try {
    captured = JSON.parse(revisionCanonicalJson({
      configuration: data('configuration'),
      cwd: data('cwd'),
      scope: data('scope'),
      prompt: data('prompt'),
    })) as Record<string, unknown>
  } catch { invalidInput() }
  const configuration = captured.configuration
  if (!isRecord(configuration) || Object.keys(configuration).some(key => key !== 'command' && key !== 'env')) invalidInput()
  const command = configuration.command
  const env = configuration.env
  if (!Array.isArray(command) || !isRecord(env)) invalidInput()
  if (!command.length || command.some(item => typeof item !== 'string' || !item || item.includes('\0')))
    invalidInput()
  if (Object.values(env).some(item => typeof item !== 'string' || item.includes('\0')))
    invalidInput()
  const cwd = captured.cwd
  const scope = captured.scope
  const prompt = captured.prompt
  const signal = data('signal', true)
  const onMessage = data('onMessage', true)
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) invalidInput()
  if (scope !== 'document' && scope !== 'section') invalidInput()
  if (typeof prompt !== 'string') invalidInput()
  if (signal !== undefined && !(signal instanceof AbortSignal)) invalidInput()
  if (onMessage !== undefined && typeof onMessage !== 'function') invalidInput()
  return {
    configuration: { command: command as string[], env: env as Record<string, string> },
    cwd,
    scope,
    prompt,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
    ...(onMessage === undefined ? {} : { onMessage: onMessage as RevisionNativeProcessInput['onMessage'] }),
  }
}

function invalidInput(): never { throw new RevisionNativeProcessError('revision_native_invalid_input') }

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = value[key]
  return isRecord(field) ? field : undefined
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

function isErrorResult(message: Record<string, unknown>): boolean {
  return message.is_error === true || (typeof message.subtype === 'string' && message.subtype !== 'success')
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
