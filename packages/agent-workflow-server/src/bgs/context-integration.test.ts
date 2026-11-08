import { writeFixturePlugin } from './fixtures/plugin'
import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner, bgsApplicationContext } from './runner'
import { agentGoalPrompt, agentProfessionalContextForRun } from '../beegame/workflow-v3/agent-goal'
import { PROJECT_GUIDE_TEMPLATE, projectGuideContext, readProjectGuide } from '../beegame/workflow-v3/project-guide'
import { createRun } from '../beegame/workflow-v3/state'
import { productionAssignmentBaseInstructions } from '../beegame/workflow-v3/production-workflow'

// Native history appends only changed keys. An unchanged first chunk is not
// resent when the tail changes, so concatenating since the last first chunk
// would count both versions of the tail. Reconstruct latest values by key.
function latestContext(items: any[], key: string) {
  const values = new Map<string, { value: string; part?: number; total?: number }>()
  let family: number | 'stable' | undefined, currentCount = 0
  for (const item of items) for (const block of item.content ?? []) {
    for (const match of (block.text ?? '').matchAll(new RegExp('<(' + key + '(?:_part_([0-9]+)(?:_of_([0-9]+))?)?)>([\\s\\S]*?)</\\1>', 'g'))) {
      expect(item.role).toBe('developer')
      expect(Buffer.byteLength(match[4]!)).toBeLessThanOrEqual(4000)
      const part = match[2] ? Number(match[2]) : undefined
      const total = match[3] ? Number(match[3]) : undefined
      if (part === undefined) {
        const count = /^Current part count: (\d+)\./.exec(match[4]!)
        family = count ? 'stable' : undefined
        currentCount = count ? Number(count[1]) : 0
      } else if (total !== undefined) family = total
      values.set(match[1]!, { value: match[4]!, part, total })
    }
  }
  if (family === undefined) return values.get(key)?.value ?? ''
  if (family === 'stable') return Array.from({length: currentCount}, (_, index) => {
    const part = values.get(`${key}_part_${String(index + 1).padStart(6, '0')}`)
    expect(part).toBeDefined()
    return part!.value
  }).join('')
  const parts = [...values.values()].filter(part => part.total === family).sort((a, b) => a.part! - b.part!)
  expect(parts.map(part => part.part)).toEqual(Array.from({ length: family }, (_, index) => index + 1))
  return parts.map(part => part.value).join('')
}

test('context observation reconstructs changed chunks and switches between scalar and chunk families', () => {
  const fragment = (key: string, value: string) => ({ role: 'developer', content: [{ text: `<${key}>${value}</${key}>` }] })
  const history = [fragment('fixture_part_1_of_2', 'first'), fragment('fixture_part_2_of_2', '-old'),
    fragment('fixture_part_2_of_2', '-current')]
  expect(latestContext(history, 'fixture')).toBe('first-current')
  history.push(fragment('fixture', 'short'))
  expect(latestContext(history, 'fixture')).toBe('short')
  history.push(fragment('fixture_part_1_of_3', 'one'), fragment('fixture_part_2_of_3', '-two'), fragment('fixture_part_3_of_3', '-three'))
  expect(latestContext(history, 'fixture')).toBe('one-two-three')
  history.push(fragment('fixture_part_2_of_3', '-updated'))
  expect(latestContext(history, 'fixture')).toBe('one-updated-three')
})

test('current count excludes stale tails and legacy fragments after delta updates and restore', () => {
  const history: any[] = [{role:'developer',content:[{text:'<fixture_part_1_of_1>legacy</fixture_part_1_of_1>'}]}]
  let known: ReturnType<typeof bgsApplicationContext> = {}
  for (const value of ['a'.repeat(8000), 'a'.repeat(8000)+'tail', 'a'.repeat(4000), '', 'short', '中文🎮'.repeat(6000)]) {
    const current = bgsApplicationContext('fixture', value)
    for (const [key, part] of Object.entries(current)) {
      if (known[key]?.value !== part.value)
        history.push({role:'developer',content:[{text:`<${key}>${part.value}</${key}>`}]})
    }
    known = current
    expect(latestContext(history, 'fixture')).toBe(value)
    // Fresh/compacted context receives the full current frame, not a host diff.
    const rebuilt = Object.entries(current).map(([key, part]) =>
      ({role:'developer',content:[{text:`<${key}>${part.value}</${key}>`}]}))
    expect(latestContext(rebuilt, 'fixture')).toBe(value)
    expect(latestContext(JSON.parse(JSON.stringify(history)), 'fixture')).toBe(value)
  }
})

// Real CLI, synthetic local Responses server; no model or project artifacts.
const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest('native resume receives current BGS context as well as project instructions and confirmed goal', async () => {
  const root = await mkdtemp('/private/tmp/bgs-context-'), game = join(root, 'game'), catalog = join(root, 'plugin-source', 'bgs-game-skills')
  await mkdir(catalog,{recursive:true})
  await mkdir(game); await mkdir(catalog,{recursive:true})
  await mkdir(join(catalog, 'fixture'))
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: synthetic\ndescription: Offline fixture.\n---\nFixture.')
  const inputs: any[][] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('Unexpected fixture route', { status: 404 })
    const body = await request.json() as any
    inputs.push(body.input)
    const message = { id: 'msg_' + inputs.length, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Fixture answer', annotations: [] }] }
    const response = { id: 'resp_' + inputs.length, object: 'response', created_at: 1, model: body.model, status: 'completed',
      output: [message], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }
    return new Response([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ].map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const runner = createBgsRunner({ resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
    lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }) })
  // Current host context was ~5.5 KB when the lost tools path was observed.
  // Use production contracts plus representative saved evidence, and a long
  // Chinese brief to exercise byte limits rather than ASCII character counts.
  const run = createRun({ projectId: 'prompt', ownerId: 'owner', workspacePath: '/synthetic', chatSessionId: 'chat', requestKey: 'once', text: 'Synthetic context fixture', constraints: { engine: 'Godot', platform: 'Mobile' }, ids: ['goal'] })
  run.creation = { initialDelivery: 'design-led-first-version', editableContent: false }
  const longBrief = JSON.stringify({ kind: 'confirmed_build_brief', idea: '离线长度验证 🎮',
    settings: { engine: 'Godot', platform: 'Mobile', dimension: '2D', inputs: ['Touch'] },
    requirements: Array.from({ length: 90 }, (_, i) => ({ id: i, text: '保留用户明确要求的设计流程、交互体验与可编辑内容，具体安排由执行者自行决定。' })) })
  expect(Buffer.byteLength(longBrief)).toBeGreaterThan(12_000)
  let nativeSessionId = '', runtimeSha256 = '', runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    for (const [index, marker] of ['INITIAL_GUIDE_MARKER', 'UPDATED_GUIDE_MARKER', 'SHORT_GUIDE_MARKER', 'FOCUSED_GUIDE_MARKER'].entries()) {
      const guide = PROJECT_GUIDE_TEMPLATE + '\n# Project instructions\n' + marker + '\n'
      await writeFile(join(game, 'AGENTS.md'), guide)
      run.requirements.text = index === 2 ? 'SHORT_CURRENT_BRIEF' : longBrief + '\nCURRENT_BRIEF_' + marker
      const systemContext = index === 2 ? 'CURRENT_TOOLS_DIRECTORY_' + marker : [
        agentProfessionalContextForRun(run, index > 0),
        projectGuideContext(await readProjectGuide(game)),
        'Current BGS tools directory: .beegame/tmp/goal-tools-' + marker,
        'CURRENT_TOOLS_DIRECTORY_' + marker,
        'BGS saved evidence (not game acceptance): ' + JSON.stringify({
          documents: Array.from({ length: 8 }, (_, i) => ({ path: 'docs/design-' + i + '.md', sha256: 'f'.repeat(64),
            headings: Array.from({ length: 16 }, (_, heading) => '设计决定与开放问题 ' + heading), status: 'saved; quality not verified' })),
          authorization: 'CURRENT_AUTHORIZATION_' + marker,
        }),
      ].join('\n')
      if (index !== 2) expect(Buffer.byteLength(systemContext)).toBeGreaterThan(5500)
      const baseInstructions=index<3 ? productionAssignmentBaseInstructions({...run,
        creation:{initialDelivery:'complete-game',editableContent:false,verification:'isolated'}},
        {stage:index===2?'verification':'implementation',originRequestKey:run.requestKey}) : undefined
      runtime = await runner.start({
        sessionId: 'context-fixture', cwd: game,
        ...([1, 2].includes(index) ? { resumeSessionId: nativeSessionId } : {}),
        systemContext,baseInstructions,
        confirmedBriefContext: run.requirements.text,
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: await writeFixturePlugin(catalog),
          OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-model' },
        onNativeSessionId: id => { nativeSessionId = id },
        onNativeContext: context => { runtimeSha256 = context.runtimeSha256 },
        requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.submit({
        prompt: index ? 'Inspect the current project instructions and confirmed goal.' : agentGoalPrompt(run),
        confirmedBriefContext: run.requirements.text, signal: AbortSignal.timeout(15_000),
        onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }),
      })
      // Check the actual outgoing model request, not just the app-server RPC.
      if(baseInstructions) {
        // Native history keeps old developer fragments. The current-context
        // slot must carry exactly the current role on first use and cold resume.
        const current=latestContext(inputs.at(-1)!,'bgsRuntime')
        expect(current.split(baseInstructions)).toHaveLength(2)
        expect(current).not.toContain(index===2?'You are the implementation author':'You are the independent runtime verifier')
        expect(JSON.stringify(inputs.at(-1))).toContain('You are a coding agent running in the BGS CLI')
      } else {
        const effectiveInput=JSON.stringify(inputs.at(-1))
        expect(effectiveInput).not.toContain('You are the implementation author for one assignment')
        expect(effectiveInput).not.toContain('You are the independent runtime verifier')
      }
      const sent = JSON.stringify(inputs.at(-1))
      expect(sent).toContain('synthetic')
      expect(sent).not.toContain('tokens truncated')
      // Exercise native AGENTS loading rather than duplicating the template
      // inside the host context: the complete current contract must arrive.
      expect(inputs.at(-1)!.some(item => item.role === 'user' &&
        (item.content ?? []).some((block: any) => block.text?.includes(guide)))).toBe(true)
      expect(systemContext).not.toContain(PROJECT_GUIDE_TEMPLATE)
      const currentRuntime = latestContext(inputs.at(-1)!, 'bgsRuntime')
      // The frame includes access and completion authority too; check the exact
      // producer fingerprint as well as the caller's complete context body.
      expect(createHash('sha256').update(currentRuntime).digest('hex')).toBe(runtimeSha256)
      expect(currentRuntime.split(systemContext)).toHaveLength(2)
      expect(currentRuntime).toContain('No preparation JSON result is required for this task.')
      expect(currentRuntime).not.toContain('Final JSON schema:')
      expect(latestContext(inputs.at(-1)!, 'bgsConfirmedBrief')).toBe(run.requirements.text)
      expect(sent.split(index === 2 ? 'SHORT_CURRENT_BRIEF' : 'CURRENT_BRIEF_' + marker)).toHaveLength(2)
      expect(sent.split('CURRENT_TOOLS_DIRECTORY_' + marker)).toHaveLength(2)
      // Unlike AGENTS.md, this marker exists only in BGS memory. Refreshing the
      // project guide alone cannot make this assertion pass on native resume.
      const current = inputs.at(-1)!.findLast(item => JSON.stringify(item).includes('CURRENT_TOOLS_DIRECTORY_' + marker))
      expect(current.role).toBe('developer')
      expect(sent).toContain('# Project instructions\\n' + marker)
      if (index === 1) expect(sent.indexOf('CURRENT_TOOLS_DIRECTORY_' + marker))
        .toBeGreaterThan(sent.indexOf('CURRENT_TOOLS_DIRECTORY_INITIAL_GUIDE_MARKER'))
      if (index === 3) expect(sent).not.toContain('UPDATED_GUIDE_MARKER')
      await runtime.dispose?.()
      runtime = undefined
    }
    expect(inputs).toHaveLength(4)
    const marker = 'STABLE_PREFIX_UNCHANGED_'
    const prefix = marker.padEnd(4000, 'x'), base = prefix + 'b'.repeat(4000)
    // Each cold resume must deliver the current context. Reinjection/deduplication
    // follows the upstream runtime; do not require the withdrawn local patch.
    for (const [index, systemContext] of [base, base, base + 'new-tail', prefix, '', base].entries()) {
      runtime = await runner.start({
        sessionId: 'context-fixture', cwd: game, resumeSessionId: nativeSessionId,
        systemContext, confirmedBriefContext: run.requirements.text,
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: await writeFixturePlugin(catalog),
          OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-model' },
        onNativeContext: context => { runtimeSha256 = context.runtimeSha256 },
        requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.submit({
        prompt: 'Inspect current host context.', confirmedBriefContext: run.requirements.text,
        signal: AbortSignal.timeout(15_000), onMessage() {},
        requestPermission: async () => ({ behavior: 'deny' }),
      })
      const sent = inputs.at(-1)!
      const currentRuntime = latestContext(sent, 'bgsRuntime')
      expect(createHash('sha256').update(currentRuntime).digest('hex')).toBe(runtimeSha256)
      if (systemContext) expect(currentRuntime.split(systemContext)).toHaveLength(2)
      else expect(currentRuntime).not.toContain(marker)
      expect(currentRuntime).toContain('No preparation JSON result is required for this task.')
      expect(currentRuntime).not.toContain('Final JSON schema:')
      expect(latestContext(sent, 'bgsConfirmedBrief')).toBe(run.requirements.text)
      await runtime.dispose?.()
      runtime = undefined
    }
    expect(inputs).toHaveLength(10)
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
