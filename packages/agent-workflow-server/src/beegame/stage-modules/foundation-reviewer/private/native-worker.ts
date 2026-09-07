import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { isAbsolute } from 'node:path'
import { getLatestRuntimeUsage, type ReviewNativeUsage, type ReviewUsageEvent } from './native-usage'
import { REVIEW_WORKER_OUTPUT_MAX_BYTES } from './worker-task'

export type ReviewNativeTask<T> = Readonly<{
  prompt: string
  schema: object
  admit(value: unknown): T
}>
export type ReviewNativeConfiguration = Readonly<{
  command: readonly string[]
  env: Readonly<Record<string, string>>
}>
export class ReviewNativeError extends Error {
  constructor(readonly code: 'stopped' | 'process_exit' | 'protocol_error' | 'model_error' | 'invalid_output' | 'usage_unavailable', readonly usage: ReviewNativeUsage) {
    super(`review native worker: ${code}`)
  }
}

/** Observation of the owned direct child only; never process-tree cleanup authority. */
export type ReviewNativeCompletion<T> = Readonly<{
  scope: 'direct-child'
  pid: number | null
  exitCode: number | null
  signalCode: string | null
  termination: 'none' | 'term_requested' | 'kill_requested'
  stdoutDrained: true
  usageObserved: boolean
  usage: ReviewNativeUsage
  outcome: { kind: 'accepted'; value: T } | { kind: 'failed'; code: ReviewNativeError['code'] }
}>

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Fresh, packet-only native process. No Author, session manager or dispatcher. */
export async function executeReviewWorker<T>(input: {
  configuration: ReviewNativeConfiguration
  workspacePath: string
  task: ReviewNativeTask<T>
  signal?: AbortSignal
  /** Private durable metering hook, awaited before a terminal can be accepted. */
  onUsage?: (usage: ReviewNativeUsage) => void | Promise<void>
  /** Owner-only persistence barrier, after direct-child close and parser drain. */
  onClosed?: (observation: ReviewNativeCompletion<T>) => void | Promise<void>
}): Promise<{ value: T; usage: ReviewNativeUsage }> {
  if (!isAbsolute(input.workspacePath) || !input.configuration.command.length ||
    input.configuration.command.some(part => typeof part !== 'string' || !part.length))
    throw new TypeError('review native configuration is invalid')
  const usageEvents: ReviewUsageEvent[] = []
  let usageObserved = false
  const usage = () => getLatestRuntimeUsage(usageEvents)
  let persistedUsageKey: string | undefined
  if (input.signal?.aborted) throw new ReviewNativeError('stopped', usage())
  const command = [...input.configuration.command,
    '--print', '--verbose', '--input-format=stream-json', '--output-format=stream-json',
    '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool=stdio',
    '--json-schema', JSON.stringify(input.task.schema), '--tools', '',
  ]
  const child = spawn(command[0]!, command.slice(1), {
    cwd: input.workspacePath, env: reviewNativeEnvironment(input.configuration.env), stdio: ['pipe', 'pipe', 'pipe'],
  })
  const decoder = new StringDecoder('utf8')
  const calls = new Map<string, unknown>()
  let pending = ''
  let queue = Promise.resolve()
  let terminal: { value: T } | undefined
  let failure: ReviewNativeError['code'] | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let exitCode: number | null = null
  let signalCode: string | null = null
  let termination: ReviewNativeCompletion<T>['termination'] = 'none'
  function terminate() {
    if (closed || killTimer) return
    child.stdin.end()
    termination = 'term_requested'
    child.kill('SIGTERM')
    killTimer = setTimeout(() => {
      if (!closed) { termination = 'kill_requested'; child.kill('SIGKILL') }
    }, 250)
    killTimer.unref()
  }
  function fail(code: ReviewNativeError['code']) {
    if (!terminal && !failure) failure = code
    terminate()
  }
  const aborted = () => fail('stopped')
  input.signal?.addEventListener('abort', aborted, { once: true })
  child.stderr.resume() // Drain without retaining credentials or model stderr.
  child.stdin.on('error', () => { if (!terminal && !failure) fail('process_exit') })
  child.on('error', () => fail('process_exit'))

  async function observe(message: Record<string, unknown>) {
    if (terminal || failure) return
    // Retain only accounting fields, never prompt/tool text, in the meter.
    const event = record(message.event)
    const nested = record(event?.message)
    const assistant = record(message.message)
    const counters = message.usage ?? event?.usage ?? nested?.usage ?? assistant?.usage
    const cumulative: ReviewUsageEvent = { type: 'result', payload: { modelUsage: message.modelUsage } }
    if (message.type === 'result' && getLatestRuntimeUsage([cumulative]).total_tokens > 0) {
      usageEvents.push(cumulative)
      usageObserved = true
    } else if (record(counters)) {
      usageEvents.push({ type: 'usage', payload: { usage: counters } })
      const snapshot = record(counters)!
      if (['input_tokens', 'prompt_tokens', 'output_tokens', 'completion_tokens', 'cache_read_tokens', 'cache_read_input_tokens',
        'cache_creation_tokens', 'cache_creation_input_tokens'].some(key => typeof snapshot[key] === 'number' &&
          Number.isFinite(snapshot[key]) && (snapshot[key] as number) >= 0)) usageObserved = true
    }
    // Content deltas/keep-alives carry no new accounting facts. Persisting
    // every frame floods the journal and can delay terminal handling long
    // after the native worker has finished. Preserve every changed snapshot
    // (including the first observed zero), and still await its write barrier.
    if (usageObserved) {
      const snapshot = usage()
      const key = JSON.stringify(snapshot)
      if (key !== persistedUsageKey) {
        try { await input.onUsage?.(snapshot) } catch { fail('usage_unavailable'); return }
        persistedUsageKey = key
      }
    }
    if (failure || input.signal?.aborted) { fail('stopped'); return }

    if (message.type === 'control_request') {
      const request = record(message.request)
      if (request?.subtype === 'can_use_tool' && typeof message.request_id === 'string') {
        child.stdin.write(JSON.stringify({ type: 'control_response', response: {
          subtype: 'success', request_id: message.request_id, response: {
            behavior: 'deny', message: 'Reviewer packet tasks do not permit native tools.',
            toolUseID: request.tool_use_id, decisionClassification: 'user_reject',
          },
        } }) + '\n')
      }
      return
    }
    if (message.type === 'assistant' && Array.isArray(assistant?.content)) {
      for (const item of assistant.content) {
        const block = record(item)
        if (block?.type === 'tool_use' && block.name === 'StructuredOutput' && typeof block.id === 'string')
          calls.set(block.id, structuredClone(block.input))
      }
    }
    let accepted: unknown
    let hasAccepted = false
    if (message.type === 'user' && Array.isArray(assistant?.content)) {
      for (const item of assistant.content) {
        const block = record(item)
        if (block?.type === 'tool_result' && block.is_error !== true &&
          block.content === 'Structured output provided successfully' && typeof block.tool_use_id === 'string' && calls.has(block.tool_use_id)) {
          accepted = calls.get(block.tool_use_id)
          hasAccepted = true
          break
        }
      }
    }
    if (message.type === 'result') {
      if (message.is_error === true || (message.subtype !== undefined && message.subtype !== 'success')) { fail('model_error'); return }
      if (!Object.hasOwn(message, 'structured_output')) { fail('invalid_output'); return }
      accepted = message.structured_output
      hasAccepted = true
    }
    if (hasAccepted) {
      try { terminal = { value: input.task.admit(accepted) } }
      catch { fail('invalid_output'); return }
      terminate()
    }
  }
  function lines(chunk: string) {
    pending += chunk
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line.trim()) continue
      if (Buffer.byteLength(line, 'utf8') > REVIEW_WORKER_OUTPUT_MAX_BYTES * 2) { fail('protocol_error'); return }
      queue = queue.then(async () => {
        if (terminal || failure) return
        const parsed = record(JSON.parse(line))
        if (!parsed || typeof parsed.type !== 'string') throw new Error('invalid native event')
        await observe(parsed)
      }).catch(() => fail('protocol_error'))
    }
    if (Buffer.byteLength(pending, 'utf8') > REVIEW_WORKER_OUTPUT_MAX_BYTES * 2) fail('protocol_error')
  }
  child.stdout.on('data', (chunk: Buffer) => lines(decoder.write(chunk)))
  child.stdout.on('end', () => { lines(decoder.end()); if (pending.trim()) lines('\n') })
  const exit = new Promise<void>(resolve => child.once('close', (code, signal) => {
    exitCode = code; signalCode = signal; closed = true; resolve()
  }))
  try {
    if (input.signal?.aborted) fail('stopped')
    else child.stdin.write(JSON.stringify({ type: 'user', uuid: randomUUID(), session_id: '', parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: input.task.prompt }] },
    }) + '\n')
    await exit
    await queue
    // No callback on a pre-spawn abort. An observed close cannot prove that
    // detached descendants exited; consumers must retain the explicit scope.
    await input.onClosed?.(structuredClone({ scope: 'direct-child', pid: child.pid ?? null, exitCode, signalCode,
      termination, stdoutDrained: true, usageObserved, usage: usage(),
      outcome: failure ? { kind: 'failed', code: failure } : terminal ? { kind: 'accepted', value: terminal.value }
        : { kind: 'failed', code: 'process_exit' },
    } satisfies ReviewNativeCompletion<T>))
    if (failure) throw new ReviewNativeError(failure, usage())
    if (!terminal) throw new ReviewNativeError('process_exit', usage())
    return { value: terminal.value, usage: usage() }
  } finally {
    input.signal?.removeEventListener('abort', aborted)
    if (killTimer) clearTimeout(killTimer)
    terminate()
  }
}

const SAFE_INHERITED = ['HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'NODE_ENV', 'PATH', 'SHELL', 'TMPDIR', 'USER', 'CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING']
const CONFIG_KEYS = new Set([
  'BEEGAME_MODEL', 'BEEGAME_MODEL_TYPE', 'BEEGAME_CONFIG_DIR', 'NPM_CONFIG_CACHE', 'npm_config_cache', 'NPM_CONFIG_USERCONFIG', 'npm_config_userconfig',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_OPENAI', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_DEFAULT_HAIKU_MODEL', 'OPENAI_DEFAULT_SONNET_MODEL', 'OPENAI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GEMINI', 'GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_DEFAULT_HAIKU_MODEL', 'GEMINI_DEFAULT_SONNET_MODEL', 'GEMINI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GROK', 'GROK_BASE_URL', 'GROK_API_KEY', 'GROK_DEFAULT_HAIKU_MODEL', 'GROK_DEFAULT_SONNET_MODEL', 'GROK_DEFAULT_OPUS_MODEL',
  'AWS_REGION', 'AWS_BEDROCK_MODEL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE', 'ANTHROPIC_UNIX_SOCKET',
])
export function reviewNativeEnvironment(selected: Readonly<Record<string, string>>) {
  return {
    ...Object.fromEntries(SAFE_INHERITED.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
    ...Object.fromEntries(Object.entries(selected).filter(([key]) => CONFIG_KEYS.has(key))),
  }
}
