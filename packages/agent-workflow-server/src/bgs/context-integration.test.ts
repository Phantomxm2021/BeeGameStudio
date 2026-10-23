import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'
import { agentGoalPrompt, agentProfessionalContextForRun } from '../beegame/workflow-v3/agent-goal'
import { PROJECT_GUIDE_TEMPLATE, projectGuideContext, readProjectGuide } from '../beegame/workflow-v3/project-guide'
import { createRun } from '../beegame/workflow-v3/state'

// Real CLI, synthetic local Responses server; no model or project artifacts.
const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest('native resume receives current BGS context as well as project instructions and confirmed goal', async () => {
  const root = await mkdtemp('/private/tmp/bgs-context-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(game); await mkdir(catalog)
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
  const latestContext = (items: any[], key: string) => {
    const fragments = items.flatMap(item => (item.content ?? []).flatMap((block: any) => {
      const match = new RegExp('^<(' + key + '(?:_part_([0-9]+)_of_[0-9]+)?)>([\\s\\S]*)</\\1>$').exec(block.text ?? '')
      if (!match) return []
      expect(item.role).toBe('developer')
      expect(Buffer.byteLength(match[3]!)).toBeLessThanOrEqual(4000)
      return [{ first: !match[2] || Number(match[2]) === 1, value: match[3]! }]
    }))
    return fragments.slice(fragments.findLastIndex(part => part.first)).map(part => part.value).join('')
  }
  let nativeSessionId = '', runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    for (const [index, marker] of ['INITIAL_GUIDE_MARKER', 'UPDATED_GUIDE_MARKER', 'SHORT_GUIDE_MARKER', 'FOCUSED_GUIDE_MARKER'].entries()) {
      await writeFile(join(game, 'AGENTS.md'), '# Project instructions\n' + marker + '\n')
      run.requirements.text = index === 2 ? 'SHORT_CURRENT_BRIEF' : longBrief + '\nCURRENT_BRIEF_' + marker
      const systemContext = index === 2 ? 'CURRENT_TOOLS_DIRECTORY_' + marker : [
        agentProfessionalContextForRun(run, index > 0), PROJECT_GUIDE_TEMPLATE,
        projectGuideContext(await readProjectGuide(game)),
        'Current BGS tools directory: .beegame/tmp/goal-tools-' + marker,
        'CURRENT_TOOLS_DIRECTORY_' + marker,
        'BGS saved evidence (not game acceptance): ' + JSON.stringify({
          documents: Array.from({ length: 8 }, (_, i) => ({ path: 'docs/design-' + i + '.md', sha256: 'f'.repeat(64),
            headings: ['目标与范围', '设计决定与开放问题'], status: 'saved; quality not verified' })),
          authorization: 'CURRENT_AUTHORIZATION_' + marker,
        }),
      ].join('\n')
      if (index !== 2) expect(Buffer.byteLength(systemContext)).toBeGreaterThan(5500)
      runtime = await runner.start({
        sessionId: 'context-fixture', cwd: game,
        ...([1, 2].includes(index) ? { resumeSessionId: nativeSessionId } : {}),
        systemContext,
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
          OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-model' },
        onNativeSessionId: id => { nativeSessionId = id },
        requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.submit({
        prompt: index ? 'Inspect the current project instructions and confirmed goal.' : agentGoalPrompt(run),
        confirmedBriefContext: run.requirements.text, signal: AbortSignal.timeout(15_000),
        onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }),
      })
      const sent = JSON.stringify(inputs.at(-1))
      expect(sent).not.toContain('tokens truncated')
      expect(latestContext(inputs.at(-1)!, 'bgsRuntime')).toBe(systemContext)
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
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
