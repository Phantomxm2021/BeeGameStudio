import { writeFixturePlugin } from '../bgs/fixtures/plugin'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from '../bgs/runner'
import { bgsCommand } from '../bgs/client'
import { BeeGameSessionManager, type BeeGameSessionUsageBillingBackend } from '../beegame/session-manager'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// Real native app-server, bridge, session persistence and billing outbox. Only
// the upstream Responses service and billing backend are synthetic/local.
nativeTest.each(['reset', 'eof', 'cancel', 'complete-open'] as const)(
  'Responses accounting survives %s without treating normal completed-stream cancellation as unknown usage', async mode => {
  const root = await mkdtemp('/private/tmp/bgs-responses-receipts-'), game = join(root, 'game'), catalog = join(root, 'plugin-source', 'bgs-game-skills')
  await mkdir(catalog,{recursive:true})
  await mkdir(game)
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  let requests = 0, cancelObserved = false, resolveSecond!: () => void
  const secondStarted = new Promise<void>(resolve => { resolveSecond = resolve })
  const encoder = new TextEncoder()
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('Unexpected fixture route', { status: 400 })
    await request.json()
    const call = ++requests
    if (call > 4) return new Response('Unexpected extra fixture request', { status: 400 })
    const item = { id: 'message-' + call, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Synthetic response ' + call, annotations: [] }] }
    const response = { id: 'response-' + call, object: 'response', created_at: 1, status: 'completed', output: [item],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 20, total_tokens: 120 } }
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response },
    ].map((event, sequence_number) => 'data: ' + JSON.stringify({ ...event, sequence_number }) + '\n\n')
    const headers = { 'content-type': 'text/event-stream' }
    if (call !== 2) return new Response(events.join(''), { headers })
    const complete = mode === 'complete-open'
    let timer: ReturnType<typeof setTimeout> | undefined
    request.signal.addEventListener('abort', () => { cancelObserved = true; clearTimeout(timer) }, { once: true })
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(complete ? events.join('') : events[0]!))
        resolveSecond()
        if (mode === 'eof') controller.close()
        if (mode === 'reset') timer = setTimeout(() => controller.error(Error('Synthetic upstream reset')), 100)
      },
      cancel() { cancelObserved = true; clearTimeout(timer) },
    }), { headers })
  } })
  type BillingInput = Parameters<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>[1]
  const bills: BillingInput[] = []
  const billing: BeeGameSessionUsageBillingBackend = { recordUsage(owner, input) {
    bills.push(input)
    return { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: input.usage.total_tokens,
      creditsMicro: input.usage.total_tokens, event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey,
        userId: owner, sessionId: input.sessionId, turnId: input.turnId, pricingVersion: 'fixture', usageSource: 'runtime_snapshot',
        usage: input.usage, delta: input.usage, weightedTokens: input.usage.total_tokens, weightedTokensDelta: input.usage.total_tokens,
        creditsMicro: input.usage.total_tokens, createdAt: new Date().toISOString(), metadata: input.metadata ?? {} } }
  } }
  const runner = createBgsRunner({ command: [await realpath(bgsCommand()[0]!)], resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('External fixture request forbidden')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  await writeFixturePlugin(catalog)
  const manager = new BeeGameSessionManager(runner, root, () => ({ BEEGAME_CONFIG_DIR: join(root, 'private'),
    BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog, BEEGAME_API_PROTOCOL: 'responses', OPENAI_API_KEY: 'fixture-only',
    OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model', BEEGAME_MODEL_BILLING_SOURCE: 'platform' }), billing)
  const session = manager.start({ workspacePath: game, userId: 'fixture-owner' })
  const timeout = setTimeout(() => manager.interruptTurn(session.id, 'fixture timeout'), 20_000)
  try {
    await manager.send(session.id, 'Return the first synthetic answer.')
    await manager.waitForSessionIdle(session.id)
    expect(requests, JSON.stringify(manager.transcript(session.id).filter(e => e.type === 'turn.failed'))).toBe(1)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(120)
    expect(manager.runtimeSnapshot(session.id).providerUsageIncomplete).toBeUndefined()
    await manager.send(session.id, 'Return the second synthetic answer.')
    await secondStarted
    if (mode === 'cancel') manager.interruptTurn(session.id, 'fixture cancellation')
    await manager.waitForSessionIdle(session.id)
    const interruptedUsage = manager.runtimeSnapshot(session.id)
    if (mode === 'eof') {
      // A later native resume must retain the uncertainty without charging
      // the replayed cumulative receipts again.
      await manager.send(session.id, 'Return a later synthetic answer after recovery.')
      await manager.waitForSessionIdle(session.id)
    }
    await manager.dispose()
    const events = manager.transcript(session.id), snapshot = manager.runtimeSnapshot(session.id)
    const recovered = new BeeGameSessionManager({ async start() { throw Error('Read-only recovery must not run a model') } }, root)
    try {
      const saved = recovered.runtimeSnapshot(session.id, game)
      console.log(JSON.stringify({ mode, requests, cancelObserved, usage: snapshot.usage,
        afterInterruption: { usage: interruptedUsage.usage, incomplete: interruptedUsage.providerUsageIncomplete ?? false },
        incomplete: snapshot.providerUsageIncomplete ?? false, savedIncomplete: saved.providerUsageIncomplete ?? false,
        nativeErrors: events.filter(e => e.payload?.bgsErrorInfo).map(e => ({ text: e.text, error: e.payload?.bgsErrorInfo })),
        lastBill: bills.at(-1)?.metadata }))
      const completed = mode === 'cancel' ? 1 : mode === 'eof' ? 3 : 2
      expect(snapshot.usage).toEqual({ prompt_tokens: completed * 80, completion_tokens: completed * 20,
        cache_read_tokens: completed * 20, cache_creation_tokens: 0, total_tokens: completed * 120 })
      expect(saved.usage).toEqual(snapshot.usage)
      expect(snapshot.providerUsageIncomplete ?? false).toBe(mode !== 'complete-open')
      expect(saved.providerUsageIncomplete ?? false).toBe(mode !== 'complete-open')
      expect(bills.at(-1)?.metadata?.providerUsageIncomplete ?? false).toBe(mode !== 'complete-open')
      expect(bills.at(-1)?.metadata?.billableFinalUsage === undefined).toBe(mode !== 'complete-open')
      expect(requests).toBe(mode === 'reset' ? 3 : mode === 'eof' ? 4 : 2)
      if (mode === 'complete-open') expect(cancelObserved).toBe(true)
    } finally { await recovered.dispose() }
  } finally { clearTimeout(timeout); await manager.dispose(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30_000)
