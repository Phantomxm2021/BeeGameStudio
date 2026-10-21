import { expect, test } from 'bun:test'
import { createProcessIsolatedModelRuntimeHost, BeeGameModelRuntimeError } from './model-runtime-host'

test('real auxiliary worker pins serialized addresses and returns usage on success, truncation and validation failure', async () => {
  let requests = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests++
    const body = await request.json() as any
    if (new URL(request.url).pathname === '/v1/messages')
      return new Response('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } }) + '\n\n')
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'offline success' }] }],
      ...(body.model !== 'missing-usage' ? { usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } } } : {}) })
  } })
  const host = createProcessIsolatedModelRuntimeHost({ outboundTargetPolicyOptions: {},
    resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  const base = { cwd: process.cwd(), systemPrompt: 'Offline fixture', messages: [{ role: 'user' as const, content: 'Offline' }], querySource: 'offline-test' }
  const endpoint = `http://synthetic-worker.invalid:${upstream.port}`
  try {
    const result = await host.generateWithUsage!({ ...base,
      runtimeEnv: { OPENAI_API_KEY: 'synthetic', OPENAI_BASE_URL: endpoint, BEEGAME_MODEL: 'fixture' } })
    expect(result.content).toBe('offline success')
    expect(result.usage).toMatchObject({ input_tokens: 90, cache_read_tokens: 10, output_tokens: 20, total_tokens: 120 })
    for (const partial of [true, false]) {
      try {
        await host.generateWithUsage!({ ...base,
          runtimeEnv: partial ? { BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_API_KEY: 'synthetic', ANTHROPIC_BASE_URL: endpoint, BEEGAME_MODEL: 'fixture' }
            : { OPENAI_API_KEY: 'synthetic', OPENAI_BASE_URL: endpoint, BEEGAME_MODEL: 'fixture' },
          structuredOutput: { name: 'required', description: 'Offline', inputSchema: { type: 'object' } },
        })
        throw Error('Expected a model failure')
      } catch (error) {
        expect(error).toBeInstanceOf(BeeGameModelRuntimeError)
        const usage = (error as BeeGameModelRuntimeError).usage
        expect(usage?.total_tokens).toBe(partial ? 100 : 120)
        expect(usage?.incomplete).toBe(partial ? true : undefined)
      }
    }
    const unknown = await host.generateWithUsage!({ ...base,
      runtimeEnv: { OPENAI_API_KEY: 'synthetic', OPENAI_BASE_URL: endpoint, BEEGAME_MODEL: 'missing-usage' } })
    expect(unknown.content).toBe('offline success')
    expect(unknown.usage).toMatchObject({ total_tokens: 0, incomplete: true })
    expect(requests).toBe(4)
  } finally { upstream.stop(true) }
}, 15_000)
