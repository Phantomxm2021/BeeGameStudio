import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeCliProcessRunner, nativeRuntimeCommand } from '../src/beegame/native-cli-process-runner'
import { openModelUsageProxy } from './model-usage-proxy'

// Uses an explicitly supplied isolated CLI and loopback fake provider, never saved credentials.
const cli = process.env.BEEGAME_REVIEW_TEST_CLI
test.skipIf(!cli).each([false, true])('native subagent retains parent reasoning policy, explicit disable=%s (loopback only)', async disable => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-thinking-')), workspace = join(root, 'workspace')
  await mkdir(workspace)
  const requests: Array<{ thinking?: { type: string }; messages: unknown }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { stream?: boolean; model: string; thinking?: { type: string }; messages: unknown }
    requests.push(body)
    const first = requests.length === 1
    const content = first ? { type: 'tool_use', id: 'local-delegate', name: 'Agent',
      input: { subagent_type: 'general-purpose', description: 'Offline delegate', prompt: 'Return LOCAL_CHILD_OK', run_in_background: false } }
      : { type: 'text', text: requests.length === 2 ? 'LOCAL_CHILD_OK' : 'LOCAL_PARENT_OK' }
    const frames = [
      { type: 'message_start', message: { id: 'local-' + requests.length, type: 'message', role: 'assistant',
        content: [], model: body.model, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: first ? { ...content, input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: first ? { type: 'input_json_delta', partial_json: JSON.stringify(content.input) }
        : { type: 'text_delta', text: content.text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
      { type: 'message_stop' },
    ]
    return new Response(frames.map(frame => 'event: ' + frame.type + '\ndata: ' + JSON.stringify(frame) + '\n\n').join(''),
      { headers: { 'content-type': 'text/event-stream' } })
  } })
  const start = { sessionId: 'local-thinking', cwd: workspace, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_PRIVATE_FIXTURE_KEY', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port,
    BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    CLAUDE_CODE_DISABLE_THINKING: disable ? '1' : '0', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!,
    ...nativeRuntimeCommand(start).slice(2), '--max-turns', '3'] }).start(start)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort('offline_deadline'), 15_000)
  try {
    await runtime.submit({ prompt: 'Delegate this offline fixture once, then report its result.', signal: controller.signal,
      onMessage() {}, requestPermission: async () => ({ behavior: 'allow' }) })
    expect(requests).toHaveLength(3)
    expect(requests.map(request => request.thinking?.type)).toEqual([disable ? 'disabled' : 'adaptive',
      disable ? 'disabled' : 'adaptive', disable ? 'disabled' : 'adaptive'])
    const raw = await readFile(join(workspace, '.beegame/logs/native-runtime.jsonl'), 'utf8')
    const diagnostics = raw.trim().split('\n').map(line => JSON.parse(line)).filter(row => row.type === 'native_diagnostic').map(row => row.diagnostic)
    expect(diagnostics.some(row => row.event === 'request_start')).toBe(false)
    expect(raw).not.toContain('LOCAL_PRIVATE_FIXTURE_KEY')
  } finally {
    clearTimeout(timer); controller.abort('offline_cleanup'); await runtime.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)

test.skipIf(!cli)('host proxy observes actual streaming failure, fallback and retry without native BGS headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-native-transport-')), workspace = join(root, 'workspace')
  await mkdir(workspace)
  let streaming = 0, fallback = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect([...request.headers.keys()].some(key => key.startsWith('x-bgs-observer-'))).toBe(false)
    if (new URL(request.url).pathname.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!new URL(request.url).pathname.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { stream?: boolean; model: string }
    if (body.stream) {
      streaming++
      const start = { type: 'message_start', message: { id: 'local-stream', type: 'message', role: 'assistant',
        content: [], model: body.model, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
      const error = { type: 'error', error: { type: 'api_error', message: 'Local fixture interrupted' } }
      return new Response('event: message_start\ndata: ' + JSON.stringify(start) + '\n\nevent: error\ndata: ' + JSON.stringify(error) + '\n\n',
        { headers: { 'content-type': 'text/event-stream' } })
    }
    fallback++
    if (fallback === 1) return Response.json({ error: { type: 'api_error', message: 'Local fixture unavailable' } }, { status: 503 })
    return Response.json({ id: 'local-complete', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text: 'LOCAL_TRANSPORT_OK' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
  } })
  const path = join(root, 'provider-usage.json')
  const proxy = openModelUsageProxy('http://127.0.0.1:' + server.port, path, () => 'local-native')
  const start = { sessionId: 'local-transport', cwd: workspace, env: {
    BEEGAME_CONFIG_DIR: join(root, 'configuration'), BEEGAME_MODEL_TYPE: 'anthropic',
    ANTHROPIC_AUTH_TOKEN: 'LOCAL_PRIVATE_FIXTURE_KEY',
    ANTHROPIC_BASE_URL: proxy.baseUrl, BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
    BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, cli!,
    ...nativeRuntimeCommand(start).slice(2), '--max-turns', '3'] }).start(start)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('test_deadline'), 15_000)
  const messages: Record<string, unknown>[] = []
  try {
    await runtime.submit({ prompt: 'Return the local fixture result.', signal: controller.signal,
      onMessage(message) { messages.push(message) }, requestPermission: async () => ({ behavior: 'deny' }) })
    await runtime.dispose?.()
    await proxy.close()
    const requests = JSON.parse(await readFile(path, 'utf8')).requests
      .filter((r: { requestKind: string }) => r.requestKind === 'messages')
    expect(streaming).toBe(1)
    expect(fallback).toBe(2)
    expect(requests).toHaveLength(3)
    const [stream, firstFallback, retry] = requests
    expect(stream.actor).toBeUndefined() // no inferred internal native request identity
    expect(stream.usageCompleteness).toBe('partial')
    expect(firstFallback).toMatchObject({ status: 503, errorOrigin: 'upstream_http' })
    expect(retry).toMatchObject({ outcome: 'completed', usageCompleteness: 'final', usage: { input_tokens: 10, output_tokens: 5 } })
    const raw = await readFile(join(workspace, '.beegame/logs/native-runtime.jsonl'), 'utf8')
    const diagnostics = raw.trim().split('\n').map(line => JSON.parse(line)).filter(r => r.type === 'native_diagnostic').map(r => r.diagnostic)
    expect(diagnostics.some(row => ['request_start', 'stream_error', 'retry_wait'].includes(row.event))).toBe(false)
    expect(raw).not.toContain('LOCAL_PRIVATE_FIXTURE_KEY')
    expect(messages).toContainEqual(expect.objectContaining({ type: 'result', subtype: 'success' }))
  } finally {
    clearTimeout(timer); controller.abort('test_cleanup')
    await runtime.dispose?.(); await proxy.close(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
