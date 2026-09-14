import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createNativeTaskAccess } from './native-task-access'
import { createNativeToolDiagnostics } from './native-tool-diagnostics'
import { createNativeResponseTraceLog, NATIVE_RESPONSE_TRACE_PREFIX } from './native-response-trace'
import { NATIVE_DIAGNOSTIC_PREFIX, parseNativeDiagnostic } from './native-diagnostics'

const SAFE_INHERITED = ['HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'NODE_ENV', 'PATH', 'SHELL', 'TMPDIR', 'USER', 'CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING']
const CONFIG_KEYS = new Set([
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING',
  'BEEGAME_MODEL', 'BEEGAME_MODEL_TYPE', 'BEEGAME_CONFIG_DIR', 'NPM_CONFIG_CACHE', 'npm_config_cache', 'NPM_CONFIG_USERCONFIG', 'npm_config_userconfig',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_OPENAI', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_DEFAULT_HAIKU_MODEL', 'OPENAI_DEFAULT_SONNET_MODEL', 'OPENAI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GEMINI', 'GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_DEFAULT_HAIKU_MODEL', 'GEMINI_DEFAULT_SONNET_MODEL', 'GEMINI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GROK', 'GROK_BASE_URL', 'GROK_API_KEY', 'GROK_DEFAULT_HAIKU_MODEL', 'GROK_DEFAULT_SONNET_MODEL', 'GROK_DEFAULT_OPUS_MODEL',
  'AWS_REGION', 'AWS_BEDROCK_MODEL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE', 'ANTHROPIC_UNIX_SOCKET',
])
export function nativeFileAgentEnvironment(selected: Readonly<Record<string, string>>) {
  return {
    ...Object.fromEntries(SAFE_INHERITED.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
    ...Object.fromEntries(Object.entries(selected).filter(([key]) => CONFIG_KEYS.has(key))),
  }
}

export type FileAgentProgress = {
  modelResponses: number
  message: string
}
export type FileAgentCompletion = {
  scope: 'direct-child'
  pid: number | null
  exitCode: number | null
  signalCode: string | null
  stdoutDrained: true
  termination: 'none' | 'term_requested' | 'kill_requested'
}
export type FileAgentInput = {
  command: readonly string[]
  env: Record<string, string>
  workspacePath: string
  writablePaths: readonly string[]
  /** Intermediate files are private to the isolated task workspace. */
  allowWorkingFiles?: boolean
  readOnlyPaths?: readonly string[]
  prompt: string
  schema: object
  logPath: string
  /** Opt-in response evidence, including detached child queries; no hidden reasoning. */
  responseTrace?: boolean
  signal?: AbortSignal
  onMessage?(message: Record<string, unknown>): void | Promise<void>
  onProgress?(progress: FileAgentProgress): void | Promise<void>
}
export type FileAgentResult = {
  result?: Record<string, unknown>
  failure?: string
  completion: FileAgentCompletion
}

const record = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined
const within = (root: string, path: string) => {
  const part = relative(root, path)
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../')
}

/** Native file tools with a workspace permission boundary. */
export async function runNativeFileAgent(input: FileAgentInput): Promise<FileAgentResult> {
  const access = await createNativeTaskAccess(input)
  const root = access.root
  if (!isAbsolute(input.logPath) || within(root, input.logPath) || !input.command.length)
    throw new Error('Invalid native file agent boundary')
  const command = [...input.command, '--print', '--verbose',
    '--input-format=stream-json', '--output-format=stream-json',
    '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool=stdio',
    '--json-schema', JSON.stringify(input.schema), '--no-session-persistence', ...access.flags]
  const child = spawn(command[0]!, command.slice(1), {
    // Preserve the user-required core guard: QueryEngine.ts stops after five
    // failed StructuredOutput calls. Removing host document resubmission does
    // not remove or replace this native protection.
    cwd: root, env: { ...input.env, ...access.environment, MAX_STRUCTURED_OUTPUT_RETRIES: '5',
      BEEGAME_NATIVE_RESPONSE_TRACE: input.responseTrace ? '1' : '0',
      BEEGAME_NATIVE_DIAGNOSTICS: input.responseTrace ? '1' : '0' },
    shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let closed = false, exitCode: number | null = null, signalCode: string | null = null
  let termination: FileAgentCompletion['termination'] = 'none'
  let timer: ReturnType<typeof setTimeout> | undefined
  let failure: string | undefined, result: Record<string, unknown> | undefined
  const modelIds = new Set<string>(), toolIds = new Set<string>()
  const diagnostics = createNativeToolDiagnostics()
  let stdoutBytes = 0, stderrBytes = 0, streamEvents = 0
  let lastStdoutAt: string | undefined, lastStderrAt: string | undefined
  let lastActivityAt = new Date().toISOString()
  let upstreamWaitStartedAt: number | undefined
  let upstreamRequest = 0
  let upstreamWaitBucket = 0
  let lastProgressAt = 0
  let logQueue = Promise.resolve()
  const log = (event: string, data: unknown) => {
    const line = JSON.stringify({ at: new Date().toISOString(), event, data }) + '\n'
    return logQueue = logQueue.then(() => appendFile(input.logPath, line, { mode: 0o600 }))
  }
  const trace = input.responseTrace ? createNativeResponseTraceLog(log, input.env, async message => {
    // Root messages also arrive on stdout. Forward only detached child
    // observations here so usage is persisted exactly once per source.
    if (message.nativeTraceAgentId !== 'root') await input.onMessage?.(structuredClone(message))
  }) : undefined
  let traceQueue = Promise.resolve()
  const enqueueTrace = (work: () => Promise<void>) => {
    const pending = traceQueue.then(work)
    traceQueue = pending.catch(() => { fail('observation_failed') })
    return traceQueue
  }
  let traceTimer: ReturnType<typeof setInterval> | undefined
  const terminate = () => {
    if (closed || termination !== 'none') return
    termination = 'term_requested'
    child.stdin.end()
    child.kill('SIGTERM')
    // Native tools may own shell processes and delegated work. Give the CLI's
    // registered cleanup handlers time to stop them before the hard fallback.
    timer = setTimeout(() => { if (!closed) { termination = 'kill_requested'; child.kill('SIGKILL') } }, 5000)
  }
  const fail = (reason: string) => { failure ??= reason; terminate() }
  const abort = () => fail('stopped')
  let waitObservationQueue = Promise.resolve()
  const observeUpstreamWait = () => {
    if (upstreamWaitStartedAt === undefined || closed || failure || result) return
    const waitMs = Date.now() - upstreamWaitStartedAt
    const bucket = Math.floor(waitMs / 30_000)
    if (bucket <= upstreamWaitBucket) return
    upstreamWaitBucket = bucket
    waitObservationQueue = waitObservationQueue.then(async () => {
      await log('upstream_waiting', { request: upstreamRequest, waitMs, lastActivityAt,
        modelResponses: modelIds.size, advisoryOnly: true, modelContinues: true })
      await input.onProgress?.({ modelResponses: modelIds.size,
        message: `等待上游模型响应 · 已静默 ${Math.floor(waitMs / 1000)} 秒` })
    }).catch(() => { fail('observation_failed') })
  }
  let waitObservationTimer: ReturnType<typeof setInterval> | undefined
  const exited = new Promise<void>(resolveExit => {
    child.once('close', (code, signal) => {
      closed = true; exitCode = code; signalCode = signal
      if (timer) clearTimeout(timer)
      resolveExit()
    })
    child.once('error', () => fail('spawn_failed'))
  })
  child.stdin.on('error', () => { if (!result && !failure) fail('write_failed') })
  const send = (value: unknown) => {
    if (!closed && !child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n')
  }
  async function handle(message: Record<string, any>) {
    // Observers cannot alter admission or stop draining later usage frames.
    try { await input.onMessage?.(structuredClone(message)) }
    catch { fail('observation_failed') }
    const event = record(message.event)
    if (event) {
      lastActivityAt = new Date().toISOString()
      streamEvents++
      // Metadata only: never persist generated text, thinking, or tool input.
      const safeType = (value: unknown) => typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : 'unknown'
      await log('stream_event', { type: safeType(event.type),
        deltaType: event.delta ? safeType(event.delta.type) : undefined,
        bytes: Buffer.byteLength(JSON.stringify(event)), count: streamEvents })
      if (event.type === 'content_block_delta' && Date.now() - lastProgressAt >= 1000) {
        lastProgressAt = Date.now()
        await input.onProgress?.({ modelResponses: modelIds.size,
          message: `正在接收模型响应（流事件 ${streamEvents}）` })
      }
    }
    const model = event?.type === 'message_start' ? record(event.message)
      : message.type === 'assistant' ? record(message.message) : undefined
    if (typeof model?.id === 'string' && !modelIds.has(model.id)) {
      if (upstreamWaitStartedAt !== undefined) {
        await log('upstream_first_stream', { request: upstreamRequest,
          waitMs: Date.now() - upstreamWaitStartedAt, modelResponses: modelIds.size + 1 })
        upstreamWaitStartedAt = undefined
        upstreamWaitBucket = 0
      }
      modelIds.add(model.id)
      const progress = { modelResponses: modelIds.size, message: '正在接收模型响应' }
      await log('model_response', { ...progress, id: model.id })
      await input.onProgress?.(progress)
    }
    if (message.type === 'stream_request_start') {
      upstreamRequest++
      upstreamWaitStartedAt = Date.now()
      upstreamWaitBucket = 0
      await log('upstream_wait_started', { request: upstreamRequest, modelResponses: modelIds.size, lastActivityAt })
      await input.onProgress?.({ modelResponses: modelIds.size, message: '等待上游模型响应' })
    }
    if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
      const updatedInput = !failure && !result ? await access.permission(message.request) : undefined
      await log('permission', { tool: message.request.tool_name, allowed: Boolean(updatedInput),
        path: updatedInput?.file_path ?? updatedInput?.path })
      send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id,
        response: updatedInput
          ? { behavior: 'allow', updatedInput }
          : { behavior: 'deny', message: 'This action is outside the task execution permissions; additional authorization is required.' } } })
    }
    if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_use' || toolIds.has(block.id)) continue
        toolIds.add(block.id)
        const path = block.input?.file_path ?? block.input?.path
        const progress = { modelResponses: modelIds.size,
          message: block.name + (typeof path === 'string' ? ' ' + relative(root, resolve(root, path)) : '') }
        await log('tool', { ...progress, id: block.id, ...diagnostics.started(block, message.parent_tool_use_id) })
        await input.onProgress?.(progress)
      }
    }
    if (message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) if (block.type === 'tool_result') {
        lastActivityAt = new Date().toISOString()
        const diagnostic = diagnostics.finished(block, message.parent_tool_use_id)
        await log('tool_result', { id: block.tool_use_id, isError: block.is_error === true, ...diagnostic })
        if (diagnostic.retrievalStatus === 'timeout' || diagnostic.retrievalStatus === 'not_ready')
          await input.onProgress?.({ modelResponses: modelIds.size, message: '正在等待委派任务返回；本次取结果尚未完成' })
      }
    }
    if (message.type === 'result') {
      lastActivityAt = new Date().toISOString()
      await log('result', { subtype: message.subtype, isError: message.is_error,
        usage: message.usage, modelUsage: message.modelUsage })
      if (!failure && !result) {
        if (message.is_error === true || message.subtype !== 'success') failure = 'model_failed'
        else result = message
        if (failure || result) terminate()
      }
    }
  }
  async function consume() {
    let pending = ''
    const decoder = new TextDecoder('utf-8', { fatal: true })
    try {
      for await (const chunk of child.stdout) {
        stdoutBytes += Buffer.byteLength(chunk)
        lastStdoutAt = new Date().toISOString()
        await log('stdout_activity', { bytes: Buffer.byteLength(chunk), totalBytes: stdoutBytes })
        pending += decoder.decode(chunk, { stream: true })
        if (Buffer.byteLength(pending) > 32 * 1024 * 1024) { fail('output_limit'); pending = ''; continue }
        let index: number
        while ((index = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1)
          if (!line) continue
          const message = record(JSON.parse(line))
          if (!message) throw new Error('Invalid native message')
          await handle(message)
        }
      }
      pending += decoder.decode()
      if (pending.trim()) {
        const message = record(JSON.parse(pending))
        if (!message) throw new Error('Invalid native message')
        await handle(message)
      }
    } catch { fail('observation_failed') }
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    await log('started', { pid: child.pid, tools: 'native-default', writablePaths: input.writablePaths,
      sandbox: 'required', readOnlyPaths: input.readOnlyPaths, responseTrace: Boolean(trace) })
    if (trace) traceTimer = setInterval(() => { void enqueueTrace(() => trace.flush()) }, 1000)
    if (input.signal?.aborted) abort()
    else send({ type: 'user', uuid: randomUUID(), session_id: '', parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: input.prompt }] } })
    waitObservationTimer = setInterval(observeUpstreamWait, 5_000)
    await Promise.all([consume(), (async () => {
      let pending = '', discarding = false
      const decoder = new TextDecoder()
      const line = async (text: string) => {
        if (!trace) return
        try {
          if (text.startsWith(NATIVE_RESPONSE_TRACE_PREFIX)) {
            const frame = JSON.parse(text.slice(NATIVE_RESPONSE_TRACE_PREFIX.length))
            await enqueueTrace(() => trace.accept(frame))
          } else if (text.startsWith(NATIVE_DIAGNOSTIC_PREFIX)) {
            const data = parseNativeDiagnostic(JSON.parse(text.slice(NATIVE_DIAGNOSTIC_PREFIX.length)))
            if (data) {
              await log('native_diagnostic', data)
              const message = data.event === 'retry_wait'
                ? `上游请求重试等待${data.delayMs === undefined ? '' : ` · ${data.delayMs}ms`}`
                : data.event === 'api_error'
                  ? `上游 API 错误 · ${data.category ?? 'unknown'}`
                  : data.event === 'response_headers'
                    ? '已收到上游响应头，等待模型流'
                    : undefined
              if (message) await input.onProgress?.({ modelResponses: modelIds.size, message })
            }
          }
        } catch { await log('response.invalid_frame', { reason: 'invalid_diagnostic_frame' }) }
      }
      try {
        for await (const chunk of child.stderr) {
          stderrBytes += Buffer.byteLength(chunk)
          lastStderrAt = new Date().toISOString()
          await log('stderr_activity', { bytes: Buffer.byteLength(chunk), totalBytes: stderrBytes })
          pending += decoder.decode(chunk, { stream: true })
          let index: number
          while ((index = pending.indexOf('\n')) >= 0) {
            const text = pending.slice(0, index); pending = pending.slice(index + 1)
            if (!discarding) await line(text)
            discarding = false
          }
          if (pending.length > 32 * 1024 * 1024) {
            pending = ''; discarding = true
            await log('response.invalid_frame', { reason: 'diagnostic_frame_too_large', modelContinues: true })
          }
        }
        pending += decoder.decode()
        if (pending.trim() && !discarding) await line(pending)
      }
      catch { if (!failure) fail('observation_failed') }
    })(), exited])
    if (waitObservationTimer) { clearInterval(waitObservationTimer); waitObservationTimer = undefined }
    await waitObservationQueue
    if (traceTimer) { clearInterval(traceTimer); traceTimer = undefined }
    if (trace) await enqueueTrace(() => trace.close())
    if (!result && !failure) failure = 'missing_result'
    const completion: FileAgentCompletion = { scope: 'direct-child', pid: child.pid ?? null,
      exitCode, signalCode, stdoutDrained: true, termination }
    await log('closed', { ...completion, failure, stdoutBytes, stderrBytes, streamEvents,
      lastStdoutAt, lastStderrAt })
    return { result, failure, completion }
  } finally {
    if (traceTimer) clearInterval(traceTimer)
    if (waitObservationTimer) clearInterval(waitObservationTimer)
    input.signal?.removeEventListener('abort', abort)
    if (!closed) { terminate(); await exited }
    if (timer) clearTimeout(timer)
  }
}
