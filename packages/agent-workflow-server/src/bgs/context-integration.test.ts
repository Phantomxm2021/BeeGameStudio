import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'
import { agentGoalPrompt } from '../beegame/workflow-v3/agent-goal'
import { projectGuideContext, readProjectGuide } from '../beegame/workflow-v3/project-guide'
import type { Run } from '../beegame/workflow-v3/state'

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
  const run = { creation: { initialDelivery: 'design-led-first-version' },
    requirements: { text: 'CURRENT_CONFIRMED_BRIEF_MARKER' } } as Run
  let nativeSessionId = '', runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    for (const [index, marker] of ['INITIAL_GUIDE_MARKER', 'UPDATED_GUIDE_MARKER', 'FOCUSED_GUIDE_MARKER'].entries()) {
      await writeFile(join(game, 'AGENTS.md'), '# Project instructions\n' + marker + '\n')
      runtime = await runner.start({
        sessionId: 'context-fixture', cwd: game,
        ...(index === 1 ? { resumeSessionId: nativeSessionId } : {}),
        systemContext: projectGuideContext(await readProjectGuide(game)) + '\nCURRENT_TOOLS_DIRECTORY_' + marker,
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
      expect(sent.split('CURRENT_TOOLS_DIRECTORY_' + marker)).toHaveLength(2)
      // Unlike AGENTS.md, this marker exists only in BGS memory. Refreshing the
      // project guide alone cannot make this assertion pass on native resume.
      const current = inputs.at(-1)!.findLast(item => JSON.stringify(item).includes('CURRENT_TOOLS_DIRECTORY_' + marker))
      expect(current.role).toBe('developer')
      expect(sent).toContain('# Project instructions\\n' + marker)
      // A resumed conversation retains its earlier application-context message.
      // The new submission adds one authoritative brief, not a prompt copy.
      expect(sent.split(run.requirements.text)).toHaveLength(index === 1 ? 3 : 2)
      if (index === 1) expect(sent.indexOf('CURRENT_TOOLS_DIRECTORY_' + marker))
        .toBeGreaterThan(sent.indexOf('CURRENT_TOOLS_DIRECTORY_INITIAL_GUIDE_MARKER'))
      if (index === 2) expect(sent).not.toContain('UPDATED_GUIDE_MARKER')
      await runtime.dispose?.()
      runtime = undefined
    }
    expect(inputs).toHaveLength(3)
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60_000)
