import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'
import { migrateBgsHome } from '../../../../scripts/migrate-bgs-home'

const localTest = process.env.BGS_SANDBOX_TESTS === '1' && process.env.BGS_LEGACY_BINARY ? test : test.skip
localTest('a pre-branding native session resumes from the migrated BGS home without rewriting its history', async () => {
  const root = await mkdtemp('/private/tmp/bgs-home-resume-'), game = join(root, 'game'), catalog = join(root, 'skills')
  const privateRoot = join(root, 'private'), legacy = join(privateRoot, 'codex'), home = join(privateRoot, 'bgs')
  await mkdir(game); await mkdir(catalog); await mkdir(legacy, { recursive: true })
  const inputs: string[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('Not a fixture route', { status: 404 })
    const body = await request.json() as any
    inputs.push(JSON.stringify(body.input))
    const message = { id: 'msg_' + inputs.length, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Offline migration fixture', annotations: [] }] }
    const response = { id: 'resp_' + inputs.length, object: 'response', created_at: 1, model: body.model,
      status: 'completed', output: [message], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }
    return new Response([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ].map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  let thread = '', runtime: Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>> | undefined
  try {
    for (const old of [true, false]) {
      const runner = createBgsRunner({ ...(old ? { command: [process.env.BGS_LEGACY_BINARY!] } : {}),
        resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
          lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }) })
      runtime = await runner.start({ sessionId: 'migration-fixture', cwd: game,
        ...(old ? {} : { resumeSessionId: thread }),
        env: { BEEGAME_CONFIG_DIR: privateRoot, BGS_HOME: old ? legacy : home, HOME: root,
          ...(old ? { CODEX_HOME: legacy } : {}), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
          OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-model' },
        onNativeSessionId: id => { if (thread) expect(id).toBe(thread); thread = id },
        requestPermission: async () => ({ behavior: 'deny' }) })
      await runtime.submit({ prompt: old ? 'LEGACY_HISTORY_MARKER' : 'NEW_BGS_TURN_MARKER',
        signal: AbortSignal.timeout(15_000), onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })
      await runtime.dispose?.(); runtime = undefined
      if (old) expect((await migrateBgsHome(legacy, home, true)).migrated).toBe(true)
    }
    expect(inputs).toHaveLength(2)
    expect(inputs[1]).toContain('LEGACY_HISTORY_MARKER')
    expect(inputs[1]).toContain('NEW_BGS_TURN_MARKER')
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
