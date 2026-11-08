import { writeFixturePlugin } from './fixtures/plugin'
import { productionAssignmentFacts } from '../beegame/workflow-v3/production-workflow'
import { createRun } from '../beegame/workflow-v3/state'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// Real CLI and local compaction, scripted loopback provider only. The summary
// intentionally omits all host context: its survival must not depend on an LLM.
nativeTest('current host context survives repeated compaction and resume without extra model calls', async () => {
  const root = await mkdtemp('/private/tmp/bgs-context-retention-test-'), game = join(root, 'game'), catalog = join(root, 'plugin-source', 'bgs-game-skills')
  await mkdir(catalog,{recursive:true})
  await mkdir(game)
  await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  let phase = 0, regular = 0, compact = 0, nativeSessionId = '', failure: unknown
  let nativeContext: import('../beegame/session-manager').BeeGameNativeContext | undefined
  const requests: { phase: number; compact: boolean; text: string }[] = []
  const run = createRun({projectId:'offline',ownerId:'offline',workspacePath:game,chatSessionId:'offline',requestKey:'offline',text:'Offline scope',constraints:{},ids:['offline']})
  const chapterFacts = ['art', 'ui'].map(discipline => JSON.stringify(productionAssignmentFacts(run, {stage:'design',discipline:discipline as 'art'|'ui',completedDesigns:['gameplay'],originRequestKey:'offline'})))
  const variants = [{runtime:0,brief:0},{runtime:1,brief:1},{runtime:1,brief:1},{runtime:2,brief:1},{runtime:2,brief:2}]
  const contexts = variants.map(({runtime,brief}) => ({
    systemContext: chapterFacts[Math.min(runtime, 1)] + `\nCURRENT_RUNTIME_${runtime}\n` + '现有授权、视觉目标与运行观察边界。\n'.repeat(240) + `RUNTIME_END_${runtime}`,
    confirmedBriefContext: JSON.stringify({ kind: 'confirmed_build_brief', idea: `CURRENT_BRIEF_${brief}`,
      requirement: '保留当前用户原文 🎮。'.repeat(240), final: `BRIEF_END_${brief}` }),
  }))
  const finalOutput = {schema:{type:'object',description:'PREPARATION_RESULT_CONTRACT',properties:{status:{const:'ready'}},required:['status']},
    accept: async (value: unknown) => { expect(value).toEqual({status:'ready'}); return 'Synthetic preparation ready.' }}
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
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
      } }] } : { content: isCompact ? 'Synthetic progress summary. Continue the fixture.' : JSON.stringify({status:'ready'}) }
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
      runtime = await runner.start({ sessionId: 'context-retention-fixture', cwd: game, ...contexts[phase], finalOutput,
        ...(phase ? { resumeSessionId: nativeSessionId } : {}),
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: await writeFixturePlugin(catalog),
          BEEGAME_API_PROTOCOL: 'chat-completions', OPENAI_API_KEY: 'fixture-only',
          OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' },
        nativeContext, onNativeContext: context => { nativeContext = context },
        onNativeSessionId: id => { nativeSessionId = id }, requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.submit({ prompt: 'Continue the offline fixture.', finalOutput, confirmedBriefContext: contexts[phase]!.confirmedBriefContext,
        signal: AbortSignal.timeout(25_000), onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })
      await runtime.dispose?.(); runtime = undefined
      if (failure) throw failure
      expect(regular).toBe(3)
      expect(compact).toBe(2)
      const current = variants[phase]!
      const inputs = requests.filter(request => request.phase === phase && !request.compact)
      for (const [index, input] of inputs.entries()) {
        expect(input.text).toContain(JSON.stringify(chapterFacts[Math.min(current.runtime, 1)]).slice(1,-1))
        for (const marker of [...(!phase || index > 0 ? ['PREPARATION_RESULT_CONTRACT'] : []), `CURRENT_RUNTIME_${current.runtime}`, `RUNTIME_END_${current.runtime}`, `CURRENT_BRIEF_${current.brief}`, `BRIEF_END_${current.brief}`]) {
          if (input.text.split(marker).length !== 2) throw Error(`Phase ${phase}, request ${index}: current marker missing or duplicated: ${marker}`)
        }
        if (phase && index > 0) {
          expect(input.text.includes('CURRENT_RUNTIME_0')).toBe(false)
          expect(input.text.includes('CURRENT_BRIEF_0')).toBe(false)
        }
      }
    }
    expect(requests).toHaveLength(25)
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 65_000)

for(const invalid of ['tool-text','204','205'] as const) nativeTest('invalid local summary does not replace history or retry, and the existing thread can resume: '+invalid, async () => {
  const root = await mkdtemp('/private/tmp/bgs-context-retention-test-'), game = join(root, 'game'), catalog = join(root, 'plugin-source', 'bgs-game-skills')
  await mkdir(catalog,{recursive:true})
  await mkdir(game); await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  let compact = 0, regular = 0, sessionId = '', recovering = false, recoveredInput = ''
  const badSummary = '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="exec_command">not a summary'
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return new Response(null, { status: 404 })
    const body = await request.json() as any, isCompact = !body.tools?.length
    if (isCompact) compact++
    else regular++
    if (recovering && isCompact) recoveredInput = JSON.stringify(body.input)
    if (regular > 2 || compact > 2) return new Response('Unexpected retry', { status: 429 })
    if(isCompact && !recovering && invalid!=='tool-text')return new Response(null,{status:Number(invalid)})
    const item = !isCompact && !recovering
      ? { id: 'call-probe', type: 'function_call', call_id: 'probe', name: 'exec_command',
        arguments: JSON.stringify({ cmd: "printf 'RETAINED_TOOL_RESULT'", max_output_tokens: 50 }) }
      : { id: 'summary', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: isCompact
          ? recovering ? 'ORIGINAL_REQUIRED_TASK. RETAINED_TOOL_RESULT. Continue remaining work.' : badSummary
          : 'Resumed original work.', annotations: [] }] }
    const response = { id: 'response-' + regular + '-' + compact, object: 'response', status: 'completed',
      output: [item], usage: { input_tokens: isCompact || recovering ? 100 : 250_000, output_tokens: 20,
        total_tokens: isCompact || recovering ? 120 : 250_020 } }
    return new Response([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response },
    ].map((event, sequence_number) => 'data: ' + JSON.stringify({ ...event, sequence_number }) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } })
  } })
  const runner = createBgsRunner({ resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('Non-local fixture request forbidden')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  const start = async () => runner.start({ sessionId: 'summary-rejection-fixture', cwd: game,
    ...(recovering ? { resumeSessionId: sessionId } : {}),
    env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: await writeFixturePlugin(catalog),
      OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-unknown-model' },
    onNativeSessionId: id => { sessionId = id }, requestPermission: async () => ({ behavior: 'deny' }),
  })
  try {
    runtime = await start()
    await expect(runtime.submit({ prompt: 'ORIGINAL_REQUIRED_TASK', signal: AbortSignal.timeout(25_000),
      onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })).rejects.toThrow('invalid_compaction_summary')
    await runtime.dispose?.(); runtime = undefined
    expect(compact).toBe(1); expect(regular).toBe(1)
    const files = (await readdir(root, { recursive: true })).filter(path => /rollout-.*\.jsonl$/.test(path))
    expect(files.length).toBeGreaterThan(0)
    const events = (await Promise.all(files.map(path => readFile(join(root, path), 'utf8'))))
      .flatMap(text => text.trim().split('\n').map(line => JSON.parse(line)))
    expect(events.some(event => event.type === 'compacted')).toBe(false)
    expect(JSON.stringify(events)).not.toContain(badSummary)
    recovering = true
    runtime = await start()
    await runtime.submit({ prompt: 'Continue remaining work.', signal: AbortSignal.timeout(25_000),
      onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })
    expect(recoveredInput).toContain('ORIGINAL_REQUIRED_TASK')
    expect(recoveredInput).toContain('RETAINED_TOOL_RESULT')
    expect(recoveredInput).not.toContain(badSummary)
    // The explicit resume can compact the retained full history successfully.
    expect(regular).toBe(2); expect(compact).toBe(2)
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
