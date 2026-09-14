import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativeFileAgentEnvironment, runNativeFileAgent } from '../native-file-agent'

const cli = process.env.BEEGAME_REVIEW_TEST_CLI ?? join(import.meta.dir, '../../../../dist/cli-bun.js')
const frame = (value: any) => 'event: ' + value.type + '\ndata: ' + JSON.stringify(value) + '\n\n'
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function scenario(mode: 'background' | 'interrupted' | 'auto-background') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-response-evidence-')))
  const workspace = join(root, 'workspace'), logPath = join(root, 'events.jsonl')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(join(workspace, 'requirements.md'), 'Keep the fixed 12 cargo rule.')
  const stop = new AbortController(), observed: any[] = []
  let requests = 0, parentRequests = 0, childReads = 0, childWrites = 0, taskId = '', capturedBeforeStop = false
  const requestRoutes: any[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (fn: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); fn() }, ms); timers.add(timer) }
  const response = (index: number, model: string, call?: any, delayed = false) => {
    let keepAlive: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream({ start(controller) {
      const emit = (value: any) => { try { controller.enqueue(new TextEncoder().encode(frame(value))) } catch {} }
      emit({ type: 'message_start', message: { id: 'trace-m-' + index, type: 'message', role: 'assistant', model,
        content: [], usage: { input_tokens: 10, output_tokens: 1 }, stop_reason: null, stop_sequence: null } })
      emit({ type: 'content_block_start', index: 0, content_block: call
        ? { type: 'tool_use', id: 'trace-tool-' + index, name: call.name, input: {} } : { type: 'text', text: '' } })
      const json = call ? JSON.stringify(call.input) : ''
      const split = delayed ? Math.max(1, json.indexOf('PARTIAL_ASSET_BODY') + 'PARTIAL_ASSET_BODY'.length) : json.length
      emit({ type: 'content_block_delta', index: 0, delta: call
        ? { type: 'input_json_delta', partial_json: json.slice(0, split) } : { type: 'text_delta', text: 'Visible child completion.' } })
      const finish = () => {
        if (keepAlive) clearInterval(keepAlive)
        if (delayed) emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(split) } })
        emit({ type: 'content_block_stop', index: 0 })
        emit({ type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
        emit({ type: 'message_stop' })
        try { controller.close() } catch {}
      }
      if (delayed) {
        keepAlive = setInterval(() => { try { controller.enqueue(new TextEncoder().encode(': keepalive\n\n')) } catch {} }, 5000)
        later(finish, mode === 'auto-background' ? 123_000 : 3500)
      } else finish()
    }, cancel() { if (keepAlive) clearInterval(keepAlive) } })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as any, index = ++requests
    if (requests > 15) { stop.abort(); return new Response('Fixture loop', { status: 500 }) }
    const child = body.messages.some((message: any) => message.role === 'user' && (Array.isArray(message.content)
      ? message.content : [{ type: 'text', text: message.content }]).some((block: any) => block.type === 'text' && block.text.includes('TRACE_ASSET_CHILD:')))
    const history = JSON.stringify(body.messages)
    requestRoutes.push({ index, child, errors: body.messages.flatMap((message: any) => Array.isArray(message.content)
      ? message.content.filter((block: any) => block.type === 'tool_result' && block.is_error).map((block: any) => JSON.stringify(block.content).slice(0, 500)) : []).slice(-2) })
    if (child) {
      // Route by retained history, not request count: a restarted agent would
      // repeat this Read and fail the assertion below.
      if (!history.includes('Keep the fixed 12 cargo rule.')) {
        childReads++
        return response(index, body.model, { name: 'Read', input: { file_path: 'requirements.md' } })
      }
      if (!history.includes('PARTIAL_ASSET_BODY')) {
        childWrites++
        return response(index, body.model, { name: 'Write', input: { file_path: 'docs/ASSET_PLAN.md',
          content: '# Asset Plan\nPARTIAL_ASSET_BODY\nPreserved complete inventory.' } }, true)
      }
      return response(index, body.model)
    }
    if (parentRequests++ === 0) return response(index, body.model, { name: 'Agent', input: {
      subagent_type: 'general-purpose', description: 'Write resource inventory',
      run_in_background: mode !== 'auto-background', prompt: 'TRACE_ASSET_CHILD: read requirements.md and write docs/ASSET_PLAN.md.',
    } })
    taskId ||= history.replaceAll('\\n', '\n').match(/agentId: ([a-zA-Z0-9_-]+)/)?.[1] ?? ''
    if (parentRequests === 2 && taskId) return response(index, body.model, { name: 'TaskOutput', input: { task_id: taskId, block: true, timeout: 600000 } })
    return response(index, body.model, parentRequests === 3 ? { name: 'StructuredOutput', input: { ok: true } } : undefined)
  } })
  const timeout = setTimeout(() => stop.abort(), mode === 'auto-background' ? 145_000 : 20_000)
  const monitor = mode === 'interrupted' ? (async () => {
    for (let n = 0; n < 200 && !stop.signal.aborted; n++) {
      const text = await readFile(logPath, 'utf8').catch(() => '')
      if (text.includes('PARTIAL_ASSET_BODY')) { capturedBeforeStop = true; stop.abort(); return }
      await pause(50)
    }
  })() : Promise.resolve()
  try {
    const result = await runNativeFileAgent({ command: [process.execPath, cli], responseTrace: true,
      workspacePath: workspace, writablePaths: ['docs/ASSET_PLAN.md'],
      allowWorkingFiles: true, readOnlyPaths: ['requirements.md'], prompt: 'Delegate an asset plan and await its completion.',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      logPath, signal: stop.signal, onMessage: async message => { observed.push(message) },
      env: nativeFileAgentEnvironment({ BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
        ANTHROPIC_API_KEY: 'TRACE_PRIVATE_API_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' }),
    })
    await monitor
    const raw = await readFile(logPath, 'utf8'), events = raw.trim().split('\n').map(line => JSON.parse(line))
    expect(raw).not.toContain('TRACE_PRIVATE_API_KEY')
    expect(events.some(e => e.event === 'native_diagnostic' && e.data.event === 'request_start')).toBe(true)
    expect(events.some(e => e.event === 'native_diagnostic' && e.data.event === 'first_stream_event')).toBe(true)
    expect(childReads).toBe(1)
    expect(childWrites).toBe(1)
    const childFrames = events.filter(e => e.event.startsWith('response.') && e.data.agentId !== 'root')
    expect(childFrames.some(e => e.event === 'response.request_start')).toBe(true)
    expect(childFrames.some(e => e.event === 'response.content_snapshot' && e.data.content.includes('PARTIAL_ASSET_BODY'))).toBe(true)
    expect(observed.some(message => message.nativeTraceAgentId && message.event?.type === 'message_start')).toBe(true)
    if (mode === 'interrupted') {
      expect(capturedBeforeStop).toBe(true)
      expect(result.failure).toBe('stopped')
      expect(await readFile(join(workspace, 'docs/ASSET_PLAN.md'), 'utf8').catch(() => '')).toBe('')
      expect(childFrames.some(e => e.event === 'response.query_end' && e.data.status !== 'completed')).toBe(true)
    } else {
      expect(result.failure, JSON.stringify({ result, requestRoutes })).toBeUndefined()
      expect(await readFile(join(workspace, 'docs/ASSET_PLAN.md'), 'utf8')).toContain('Preserved complete inventory.')
      expect(childFrames.some(e => e.event === 'response.message' && JSON.stringify(e.data).includes('Visible child completion.'))).toBe(true)
      if (mode === 'auto-background') {
        expect(taskId).not.toBe('')
        expect(childFrames.filter(e => e.event === 'response.query_start')).toHaveLength(1)
        expect(events.some(e => e.event === 'tool_result' && e.data.tool === 'Agent' && e.data.durationMs >= 119_000)).toBe(true)
      }
    }
  } finally {
    clearTimeout(timeout); stop.abort(); server.stop(true)
    for (const timer of timers) clearTimeout(timer)
    await monitor
    await rm(root, { recursive: true, force: true })
  }
}

for (const mode of ['background', 'interrupted'] as const)
  test('real native response evidence: ' + mode, () => scenario(mode), 25_000)

const slowTest = process.env.BEEGAME_RUN_SLOW_NATIVE_TESTS === '1' ? test : test.skip
slowTest('real 120-second auto-background preserves a streaming asset Write without rereading', () => scenario('auto-background'), 150_000)
