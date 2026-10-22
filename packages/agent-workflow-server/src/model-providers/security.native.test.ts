import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { join } from 'node:path'
import { createBgsRunner } from '../bgs/runner'
import { BeeGameSessionManager, type BeeGameSessionUsageBillingBackend } from '../beegame/session-manager'
import type { Json } from './messages'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
nativeTest('native parallel image and command results form a valid Chat Completions tool block', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-tool-images-'), game = join(root, 'game')
  await mkdir(game)
  await sharp({ create: { width: 2, height: 2, channels: 4, background: '#00ff00' } }).png().toFile(join(game, 'fixture.png'))
  let requests = 0, runtime, fixtureError: unknown
  const supplier = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    try {
      const body = await request.json() as Json
      requests++
      const first = requests === 1
      if (!first) {
        const start = body.messages.findIndex((message: Json) => message.tool_calls?.length === 2)
        expect(start).toBeGreaterThanOrEqual(0)
        expect(body.messages.slice(start + 1, start + 4).map((message: Json) => message.role)).toEqual(['tool', 'tool', 'user'])
        expect(body.messages[start + 3].content.some((part: Json) => part.type === 'image_url')).toBe(true)
      }
      const tools = first ? [
        { index: 0, id: 'image-first', function: { name: 'view_image', arguments: JSON.stringify({ path: join(game, 'fixture.png') }) } },
        { index: 1, id: 'command-second', function: { name: 'exec_command', arguments: JSON.stringify({
          cmd: 'sleep 0.25; printf parallel-fixture', max_output_tokens: 1000 }) } },
      ] : undefined
      return new Response('data: ' + JSON.stringify({ choices: [{ delta: first ? { tool_calls: tools }
        : { content: 'Parallel image fixture completed' }, finish_reason: first ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 } }) + '\n\n',
        { headers: { 'content-type': 'text/event-stream' } })
    } catch (error) { fixtureError = error; return new Response('fixture-failed', { status: 400 }) }
  } })
  try {
    runtime = await createBgsRunner({ resolveOutboundTarget: async value => ({ url: new URL(value),
      addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }) }).start({
      sessionId: 'parallel-image-native-fixture', cwd: game, env: { BEEGAME_CONFIG_DIR: join(root, 'private'),
        BEEGAME_MODEL_TYPE: 'openai', BEEGAME_API_PROTOCOL: 'chat-completions', BEEGAME_MODEL: 'fixture',
        OPENAI_API_KEY: 'synthetic-only', OPENAI_BASE_URL: supplier.url.toString().replace(/\/$/, '') },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    await runtime.submit({ prompt: 'Use this synthetic fixture.', signal: AbortSignal.timeout(15000),
      onMessage: () => {}, requestPermission: async () => ({ behavior: 'deny' }) })
    if (fixtureError) throw fixtureError
    expect(requests).toBe(2)
  } catch (error) { throw fixtureError ?? error }
  finally { await runtime?.dispose?.(); supplier.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)
nativeTest('provider HTTP failures retain status without leaking upstream bodies or retrying', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-provider-http-'), game = join(root, 'game')
  await mkdir(game)
  let requests = 0, runtime
  const supplier = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++
    return new Response('upstream-private-body synthetic-provider-secret', { status: 400 })
  } })
  try {
    runtime = await createBgsRunner({ resolveOutboundTarget: async value => ({ url: new URL(value),
      addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }) }).start({
      sessionId: 'http-failure-native-fixture', cwd: game, env: { BEEGAME_CONFIG_DIR: join(root, 'private'),
        BEEGAME_MODEL_TYPE: 'openai', BEEGAME_API_PROTOCOL: 'chat-completions', BEEGAME_MODEL: 'fixture',
        OPENAI_API_KEY: 'synthetic-provider-secret', OPENAI_BASE_URL: supplier.url.toString().replace(/\/$/, '') },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    await expect(runtime.submit({ prompt: 'Use this synthetic fixture.', signal: AbortSignal.timeout(15000),
      onMessage: () => {}, requestPermission: async () => ({ behavior: 'deny' }) })).rejects.toThrow()
    expect(requests).toBe(1)
    if (!runtime.dispose) throw Error('Native runtime must support disposal')
    await runtime.dispose()
    runtime = undefined
    const sessions = join(root, 'private', 'bgs', 'sessions')
    const files = (await readdir(sessions, { recursive: true })).filter(path => path.endsWith('.jsonl'))
    const native = (await Promise.all(files.map(path => readFile(join(sessions, path), 'utf8')))).join('\n')
    expect(native.includes('HTTP 400')).toBe(true)
    expect(native.includes('upstream-private-body')).toBe(false)
    expect(native.includes('synthetic-provider-secret')).toBe(false)
  } finally { await runtime?.dispose?.(); supplier.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)
for (const malformedSuffix of [false, true]) nativeTest('converted provider unknown calls are rejected without execution; changed streamed name=' + malformedSuffix, async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-unknown-'), game = join(root, 'game')
  await mkdir(game)
  const bodies: Json[] = [], events: Json[] = []
  const supplier = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    bodies.push(await request.json() as Json)
    const first = bodies.length === 1
    const alias = malformedSuffix ? bodies.at(-1)!.tools.find((tool: Json) => tool.function.parameters?.properties?.cmd)?.function.name : 'unknown_provider_tool'
    const values = [{ choices: [{ delta: first
      ? { tool_calls: [{ index: 0, id: 'unknown', function: { name: alias, arguments: '{"cmd":"touch unexpected-marker"}' } }] }
      : { content: 'Rejected safely; continuation completed.' }, finish_reason: first && malformedSuffix ? null : first ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 } }]
    if (first && malformedSuffix) values.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '_invalid_suffix' } }] }, finish_reason: 'tool_calls' }] } as any)
    return new Response(values.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join(''),
      { headers: { 'content-type': 'text/event-stream' } })
  } })
  let runtime
  try {
    runtime = await createBgsRunner({ resolveOutboundTarget: async value => ({ url: new URL(value),
      addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }) }).start({
      sessionId: 'unknown-native-fixture', cwd: game, env: { BEEGAME_CONFIG_DIR: join(root, 'private'),
        BEEGAME_MODEL_TYPE: 'openai', BEEGAME_API_PROTOCOL: 'chat-completions', BEEGAME_MODEL: 'fixture',
        OPENAI_API_KEY: 'synthetic-only', OPENAI_BASE_URL: supplier.url.toString().replace(/\/$/, '') },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    await runtime.submit({ prompt: 'Use this synthetic fixture.', signal: AbortSignal.timeout(15000),
      onMessage: value => { events.push(value) }, requestPermission: async () => ({ behavior: 'deny' }) })
    expect(bodies).toHaveLength(2)
    expect(JSON.stringify(bodies[1].messages)).toContain('unknown')
    expect(JSON.stringify(bodies[1].messages)).toContain('unsupported')
    expect(events.some(event => event.text?.includes('continuation completed'))).toBe(true)
    expect((await readdir(game)).filter(path => path !== '.beegame')).toEqual([])
  } finally { await runtime?.dispose?.(); supplier.stop(true); await rm(root, { recursive: true, force: true }) }
}, 25_000)
nativeTest('official Bgs failure retains partial supplier usage through the runner and billing outbox', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-partial-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(game); await mkdir(catalog)
  let requests = 0
  const supplier = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++
    // A complete SSE frame with acknowledged input, followed by a truncated response.
    return new Response('data: ' + JSON.stringify({ type: 'message_start',
      message: { usage: { input_tokens: 100, output_tokens: 0 } } }) + '\n\n',
      { headers: { 'content-type': 'text/event-stream' } })
  } })
  const writes: Array<Parameters<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>[1]> = []
  const runner = createBgsRunner({ resolveOutboundTarget: async value => ({ url: new URL(value),
    addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }) })
  const manager = new BeeGameSessionManager(runner, root, () => ({
    BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
    BEEGAME_MODEL_TYPE: 'anthropic', BEEGAME_API_PROTOCOL: 'anthropic-messages', BEEGAME_MODEL: 'fixture-model',
    ANTHROPIC_API_KEY: 'synthetic-only', ANTHROPIC_BASE_URL: supplier.url.toString(),
  }), { recordUsage(owner, input) {
    writes.push(input)
    return { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: 100, creditsMicro: 100,
      event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner, sessionId: input.sessionId,
        pricingVersion: 'fixture', usageSource: 'runtime_snapshot', usage: input.usage, delta: input.usage,
        weightedTokens: 100, weightedTokensDelta: 100, creditsMicro: 100, createdAt: new Date().toISOString(),
        metadata: input.metadata ?? {} } }
  } })
  try {
    const session = manager.start({ workspacePath: game, userId: 'fixture' })
    await manager.sendWithDisplay(session.id, 'Explain the Phaser game loop using this offline fixture.')
    await manager.waitForSessionIdle(session.id)
    await manager.dispose()
    expect(requests).toBe(1)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(100)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.usage.prompt_tokens).toBe(100)
    expect(writes[0]?.metadata?.providerUsageIncomplete).toBe(true)
    expect(manager.transcriptFacts(session.id).some(event => event.type === 'turn.failed')).toBe(true)
    const sessions = join(root, 'config', 'bgs', 'sessions')
    const rollouts = (await readdir(sessions, { recursive: true })).filter(path => path.endsWith('.jsonl'))
    const native = (await Promise.all(rollouts.map(path => readFile(join(sessions, path), 'utf8')))).join('\n')
    expect(native).toContain('Provider stream ended without a terminal event')
    expect(native).not.toContain('stream closed before response.completed')
  } finally { await manager.dispose(); supplier.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30_000)
