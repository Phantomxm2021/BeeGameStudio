import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// Real CLI and local compaction, scripted loopback provider only. The summary
// intentionally omits all host context: its survival must not depend on an LLM.
nativeTest('current host context survives repeated compaction and resume without extra model calls', async () => {
  const root = await mkdtemp('/private/tmp/bgs-context-retention-test-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(game)
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  let phase = 0, regular = 0, compact = 0, nativeSessionId = '', failure: unknown
  const requests: { phase: number; compact: boolean; text: string }[] = []
  const contexts = [0, 1].map(index => ({
    systemContext: `CURRENT_RUNTIME_${index}\n` + '现有授权、视觉目标与运行观察边界。\n'.repeat(240) + `RUNTIME_END_${index}`,
    confirmedBriefContext: JSON.stringify({ kind: 'confirmed_build_brief', idea: `CURRENT_BRIEF_${index}`,
      requirement: '保留当前用户原文 🎮。'.repeat(240), final: `BRIEF_END_${index}` }),
  }))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    try {
      if (new URL(request.url).pathname !== '/v1/chat/completions') throw Error('Unexpected fixture route')
      const body = await request.json() as any, isCompact = !body.tools?.length
      requests.push({ phase, compact: isCompact, text: JSON.stringify(body.messages) })
      if (isCompact) compact++
      else regular++
      if (regular > 3 || compact > 2) throw Error('Unexpected extra provider request')
      const tool = !isCompact && regular < 3
      const delta = tool ? { tool_calls: [{ index: 0, id: `probe_${phase}_${regular}`, type: 'function', function: {
        name: body.tools.find((item: any) => item.function.name === 'exec_command')?.function.name,
        arguments: JSON.stringify({ cmd: "printf 'offline-context-probe'", max_output_tokens: 50 }),
      } }] } : { content: isCompact ? 'Synthetic progress summary. Continue the fixture.' : 'Synthetic final answer.' }
      return new Response([
        { choices: [{ index: 0, delta, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: tool ? 250_000 : 100, completion_tokens: 20 } },
      ].map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
      { headers: { 'Content-Type': 'text/event-stream' } })
    } catch (error) { failure = error; return new Response('Fixture failed', { status: 500 }) }
  } })
  const runner = createBgsRunner({ resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('Non-local fixture request forbidden')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    for (phase = 0; phase < contexts.length; phase++) {
      regular = 0; compact = 0
      runtime = await runner.start({ sessionId: 'context-retention-fixture', cwd: game, ...contexts[phase],
        ...(phase ? { resumeSessionId: nativeSessionId } : {}),
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
          BEEGAME_API_PROTOCOL: 'chat-completions', OPENAI_API_KEY: 'fixture-only',
          OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' },
        onNativeSessionId: id => { nativeSessionId = id }, requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.submit({ prompt: 'Continue the offline fixture.', confirmedBriefContext: contexts[phase]!.confirmedBriefContext,
        signal: AbortSignal.timeout(25_000), onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })
      await runtime.dispose?.(); runtime = undefined
      if (failure) throw failure
      expect(regular).toBe(3)
      expect(compact).toBe(2)
      const inputs = requests.filter(request => request.phase === phase && !request.compact)
      for (const [index, input] of inputs.entries()) {
        for (const marker of [`CURRENT_RUNTIME_${phase}`, `RUNTIME_END_${phase}`, `CURRENT_BRIEF_${phase}`, `BRIEF_END_${phase}`]) {
          if (input.text.split(marker).length !== 2) throw Error(`Phase ${phase}, request ${index}: current marker missing or duplicated: ${marker}`)
        }
        if (phase && index > 0) {
          expect(input.text.includes('CURRENT_RUNTIME_0')).toBe(false)
          expect(input.text.includes('CURRENT_BRIEF_0')).toBe(false)
        }
      }
    }
    expect(requests).toHaveLength(10)
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 65_000)
