import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createNativeTaskAccess } from './native-task-access'

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

/** Native file tools, with a workspace permission boundary. No agent strategy,
 * document-output protocol, host repair prompt, or additional model turn. */
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
    cwd: root, env: { ...input.env, ...access.environment, MAX_STRUCTURED_OUTPUT_RETRIES: '5' },
    shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let closed = false, exitCode: number | null = null, signalCode: string | null = null
  let termination: FileAgentCompletion['termination'] = 'none'
  let timer: ReturnType<typeof setTimeout> | undefined
  let failure: string | undefined, result: Record<string, unknown> | undefined
  const modelIds = new Set<string>(), toolIds = new Set<string>()
  let stdoutBytes = 0, stderrBytes = 0, streamEvents = 0
  let lastStdoutAt: string | undefined, lastStderrAt: string | undefined
  let lastProgressAt = 0
  const log = (event: string, data: unknown) => appendFile(input.logPath,
    JSON.stringify({ at: new Date().toISOString(), event, data }) + '\n', { mode: 0o600 })
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
      modelIds.add(model.id)
      const progress = { modelResponses: modelIds.size, message: '正在接收模型响应' }
      await log('model_response', { ...progress, id: model.id })
      await input.onProgress?.(progress)
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
        await log('tool', { ...progress, id: block.id })
        await input.onProgress?.(progress)
      }
    }
    if (message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) if (block.type === 'tool_result')
        await log('tool_result', { id: block.tool_use_id, isError: block.is_error === true })
    }
    if (message.type === 'result') {
      await log('result', { subtype: message.subtype, isError: message.is_error,
        usage: message.usage, modelUsage: message.modelUsage })
      if (!failure && !result) {
        if (message.is_error === true || message.subtype !== 'success') failure = 'model_failed'
        else result = message
        terminate()
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
      sandbox: 'required', readOnlyPaths: input.readOnlyPaths })
    if (input.signal?.aborted) abort()
    else send({ type: 'user', uuid: randomUUID(), session_id: '', parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: input.prompt }] } })
    await Promise.all([consume(), (async () => {
      try { for await (const chunk of child.stderr) {
        stderrBytes += Buffer.byteLength(chunk)
        lastStderrAt = new Date().toISOString()
        await log('stderr_activity', { bytes: Buffer.byteLength(chunk), totalBytes: stderrBytes })
      } }
      catch { if (!failure) fail('observation_failed') }
    })(), exited])
    if (!result && !failure) failure = 'missing_result'
    const completion: FileAgentCompletion = { scope: 'direct-child', pid: child.pid ?? null,
      exitCode, signalCode, stdoutDrained: true, termination }
    await log('closed', { ...completion, failure, stdoutBytes, stderrBytes, streamEvents,
      lastStdoutAt, lastStderrAt })
    return { result, failure, completion }
  } finally {
    input.signal?.removeEventListener('abort', abort)
    if (!closed) { terminate(); await exited }
    if (timer) clearTimeout(timer)
  }
}
