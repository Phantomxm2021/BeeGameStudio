import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNativeCliProcessRunner, nativeRuntimeCommand } from './native-cli-process-runner'
import { createRuntimeObservability } from './runtime-observability'

// Real CLI and host transport, with a held loopback response instead of a model.
// BGS_TEST_CLI_ENTRY allows checking an unpublished build without changing the
// running backend's launcher.
test.each(['complete', 'interrupt'] as const)('compact status reaches the host before its upstream response: %s', async outcome => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-compact-status-')))
  const cwd = join(root, 'game'), config = join(root, 'config')
  await mkdir(cwd); await mkdir(config)
  let release!: () => void, started!: () => void, rawStatus!: () => void, hostStatus!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const requestStarted = new Promise<void>(resolve => { started = resolve })
  const statusReceived = new Promise<void>(resolve => { rawStatus = resolve })
  const statusDelivered = new Promise<void>(resolve => { hostStatus = resolve })
  const wire: string[] = [], delivered: string[] = [], submissions: string[] = []
  let requests = 0, released = false
  const frame = (event: { type: string; [key: string]: unknown }) =>
    'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n'
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/count_tokens')) return Response.json({ input_tokens: 40000 })
    if (!path.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as { model: string }
    const id = ++requests
    if (id === 1) { started(); await gate }
    return new Response(
      frame({ type: 'message_start', message: { id: 'offline-' + id, type: 'message', role: 'assistant',
        model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
      frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta',
        text: id === 1 ? 'Synthetic preserved summary.' : 'Synthetic observation complete.' } }) +
      frame({ type: 'content_block_stop', index: 0 }) +
      frame({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } }) +
      frame({ type: 'message_stop' }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const controller = new AbortController()
  const command = nativeRuntimeCommand({ sessionId: 'offline-compact-status', cwd, env: {} })
  if (process.env.BGS_TEST_CLI_ENTRY) command[1] = process.env.BGS_TEST_CLI_ENTRY
  let runtime: Awaited<ReturnType<ReturnType<typeof createNativeCliProcessRunner>['start']>> | undefined
  const timeout = setTimeout(() => { release(); controller.abort('offline-test-timeout') }, 12000)
  try {
    runtime = await createNativeCliProcessRunner({ command, observabilityFactory(input) {
      const observer = createRuntimeObservability(input)
      return { ...observer, observeLine(line) {
        observer.observeLine(line)
        const message = JSON.parse(line)
        if (message.type === 'user' && message.isReplay) wire.push('ack')
        if (message.type === 'system' && message.subtype === 'status' && message.status === 'compacting') {
          wire.push('compacting'); rawStatus()
        }
      } }
    } }).start({ sessionId: 'offline-compact-status', cwd,
      onNativeSubmission: id => { submissions.push(id) },
      env: { BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'offline',
        ANTHROPIC_BASE_URL: provider.url.origin, BEEGAME_CONFIG_DIR: config,
        BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6', BGS_DEFAULT_FAST_MODEL: 'claude-sonnet-4-6',
        BGS_DEFAULT_STRONG_MODEL: 'claude-sonnet-4-6', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '1',
        BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
        BEEGAME_RUNTIME_SETTINGS_JSON: JSON.stringify({ autoMemoryEnabled: false, autoDreamEnabled: false,
          verificationAgentEnabled: false, agentTeamsEnabled: false, promptSuggestionEnabled: false }) } })
    const work = runtime.submit({
      prompt: 'Continue synthetic observation. ' + 'Prior synthetic facts. '.repeat(1200),
      signal: controller.signal, requestPermission: async () => ({ behavior: 'deny' }),
      onMessage(message) {
        if (message.type === 'system' && message.subtype === 'status' && message.status === 'compacting') {
          delivered.push('compacting'); hostStatus()
          expect(released).toBe(false)
        }
        if (message.type === 'system' && message.subtype === 'compact_boundary') delivered.push('compacted')
      },
    }).then(() => undefined, error => error as Error)
    await Promise.race([Promise.all([requestStarted, statusReceived]), work.then(() => { throw Error('No compaction started') })])
    // The provider is still blocked. Releasing it to obtain status would hide
    // the original defect, so inspect the host before permitting any response.
    expect(wire[0]).toBe('ack')
    await Promise.race([statusDelivered, work.then(() => { throw Error('Turn ended before live compact status') })])
    expect(delivered).toEqual(['compacting'])
    expect(submissions).toHaveLength(1)
    if (outcome === 'interrupt') {
      controller.abort('offline-user-pause')
      expect((await work)?.message).toContain('offline-user-pause')
      expect(requests).toBe(1)
      expect(delivered).not.toContain('compacted')
    } else {
      released = true; release()
      expect(await work).toBeUndefined()
      expect(delivered).toEqual(['compacting', 'compacted'])
      expect(wire.filter(value => value === 'ack')).toHaveLength(1)
      expect(requests).toBe(2)
    }
  } finally {
    clearTimeout(timeout); release(); controller.abort()
    await runtime?.dispose?.(); provider.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
