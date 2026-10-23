import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from '../bgs/runner'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// Actual native history/compaction, but every provider response is local and
// scripted. The resumed response includes the old assistant's private carrier
// in its reported prompt usage; counting that carrier again crosses the limit.
nativeTest.each([220_000, 250_000])('converted history uses provider context usage once and still compacts above the limit: %s', async promptTokens => {
  const root = await mkdtemp('/private/tmp/bgs-context-accounting-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(game)
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  const privateCarrier = 'synthetic-private-context-'.repeat(4000)
  let regularCalls = 0, compactions = 0, nativeSessionId = ''
  const prompts: number[] = [], events: any[] = []
  let failure: unknown, observedPrompt = 0, observedOutput = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    try {
      if (new URL(request.url).pathname !== '/v1/chat/completions') throw Error('Unexpected local fixture route')
      const body = await request.json() as any
      const compact = !body.tools?.length
      if (compact) compactions++
      else regularCalls++
      if (regularCalls > 3 || compactions > 1) throw Error('Unexpected extra provider request')
      const continued = !compact && regularCalls === 2
      const inputTokens = continued ? promptTokens : 100
      prompts.push(inputTokens)
      const delta = continued ? {
        tool_calls: [{ index: 0, id: 'context_probe', type: 'function', function: {
          name: body.tools.find((tool: any) => tool.function.name === 'exec_command')?.function.name,
          arguments: JSON.stringify({ cmd: "printf 'context-accounting-fixture'", max_output_tokens: 50 }),
        } }],
      } : { content: compact ? 'Continue the synthetic fixture. The context probe has run.' : 'Synthetic fixture answer.',
        ...(!compact && regularCalls === 1 ? { reasoning_content: privateCarrier } : {}) }
      if (continued) expect(JSON.stringify(body.messages)).toContain(privateCarrier)
      if (!compact && regularCalls === 3 && !compactions) {
        expect(JSON.stringify(body.messages)).toContain(privateCarrier)
        expect(body.messages.some((message: any) => message.role === 'tool' &&
          message.tool_call_id === 'context_probe' && message.content.includes('context-accounting-fixture'))).toBe(true)
      }
      return new Response([
        { choices: [{ index: 0, delta, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: continued ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: inputTokens, completion_tokens: 20 } },
      ].map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
      { headers: { 'Content-Type': 'text/event-stream' } })
    } catch (error) {
      failure = error
      return new Response('Synthetic fixture failed', { status: 500 })
    }
  } })
  const runner = createBgsRunner({ resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('Non-local fixture request forbidden')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    for (const resume of [false, true]) {
      let turnPrompt = 0, turnOutput = 0
      runtime = await runner.start({ sessionId: 'context-accounting-fixture', cwd: game,
        ...(resume ? { resumeSessionId: nativeSessionId } : {}),
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
          BEEGAME_API_PROTOCOL: 'chat-completions', OPENAI_API_KEY: 'fixture-only',
          OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' },
        onNativeSessionId: id => { nativeSessionId = id },
        onNativeUsage: usage => { turnPrompt = usage.prompt_tokens; turnOutput = usage.completion_tokens },
        requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.submit({ prompt: resume ? 'Continue the synthetic fixture.' : 'Start the synthetic fixture.',
        signal: AbortSignal.timeout(15_000), onMessage: event => { events.push(event) },
        requestPermission: async () => ({ behavior: 'deny' }) })
      await runtime.dispose?.(); runtime = undefined
      observedPrompt += turnPrompt; observedOutput += turnOutput
    }
    if (failure) throw failure
    // Unknown model fallback: compact at 90% of the raw 272000 context window;
    // its separate 95% usable-context headroom is not applied a second time.
    const expectedCompactions = promptTokens > 244_800 ? 1 : 0
    expect(regularCalls).toBe(3)
    expect(compactions).toBe(expectedCompactions)
    expect(events.filter(event => event.subtype === 'compact_boundary')).toHaveLength(expectedCompactions)
    expect(observedPrompt).toBe(prompts.reduce((sum, count) => sum + count, 0))
    expect(observedOutput).toBe(prompts.length * 20)
    expect(events.some(event => event.eventType === 'tool.completed' && event.toolUseID === 'context_probe')).toBe(true)
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 45_000)
