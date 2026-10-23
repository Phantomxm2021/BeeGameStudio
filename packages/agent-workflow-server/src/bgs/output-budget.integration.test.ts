import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'

// Actual CLI and loopback-only scripted responses; no model or game project.
const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest('native tool output keeps bounded references intact on start and resume', async () => {
  const root = await mkdtemp('/private/tmp/bgs-output-budget-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(game); await mkdir(join(catalog, 'fixture'), { recursive: true })
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline fixture.\n---\nFixture.')
  const samples = [
    { name: 'ascii', text: 'BEGIN\n' + 'reference line\n'.repeat(1000) + 'END' },
    { name: 'utf8', text: '开始\n' + '核对条件与结果 🎮\n'.repeat(1000) + '结束' },
    { name: 'json', text: JSON.stringify({ begin: true, rules: Array.from({ length: 220 }, (_, id) => ({ id, text: 'Verify producer and consumer conditions.' })), end: true }) },
    { name: 'oversize', text: 'BEGIN\n' + 'x'.repeat(60_000) + '\nEND', truncated: true },
    { name: 'requested-small', text: 'BEGIN\n' + 'y'.repeat(14_000) + '\nEND', truncated: true, maxTokens: 500 },
  ]
  for (const sample of samples) {
    expect(Buffer.byteLength(sample.text)).toBeGreaterThan(10_000)
    if (!sample.truncated) expect(Buffer.byteLength(sample.text)).toBeLessThan(40_000)
    await writeFile(join(game, sample.name + '.txt'), sample.text)
  }
  const inputs: any[][] = []
  const advertisedTools: string[] = []
  let round = 0, requests = 0, nativeSessionId = '', runtime: Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>> | undefined
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/responses') return new Response('Unexpected fixture route', { status: 404 })
    const body = await request.json() as any
    inputs.push(body.input)
    advertisedTools.push(JSON.stringify(body.tools))
    const first = requests++ % 2 === 0
    const output = first ? (round ? samples.slice(0, 1) : samples).map(sample => ({
      id: `fc_${round}_${sample.name}`, call_id: `call_${round}_${sample.name}`,
      type: 'function_call', name: 'exec_command', status: 'completed',
      arguments: JSON.stringify({ cmd: 'cat ' + sample.name + '.txt', ...(sample.maxTokens ? { max_output_tokens: sample.maxTokens } : {}) }),
    })) : [{ id: 'msg_' + round, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Fixture complete.', annotations: [] }] }]
    const response = { id: 'resp_' + requests, object: 'response', created_at: 1, model: body.model,
      status: 'completed', output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }
    return new Response([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      ...output.flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item: { ...item, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index, item },
      ]),
      { type: 'response.completed', response },
    ].map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const runner = createBgsRunner({ resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('Fixture refuses non-local model endpoint')
    return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
  } })
  try {
    for (round = 0; round < 2; round++) {
      runtime = await runner.start({ sessionId: 'output-budget-fixture', cwd: game,
        ...(round ? { resumeSessionId: nativeSessionId } : {}),
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
          OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'unknown-fixture-model' },
        onNativeSessionId: id => { nativeSessionId = id }, requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.submit({ prompt: 'Read local fixture references.', signal: AbortSignal.timeout(15_000),
        onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }) })
      expect(requests).toBe((round + 1) * 2)
      for (const tools of advertisedTools.slice(round * 2)) {
        for (const name of ['create_goal', 'update_goal', 'get_goal'])
          expect(tools).not.toContain(`"name":"${name}"`)
      }
      for (const sample of round ? samples.slice(0, 1) : samples) {
        const item = inputs.at(-1)!.find(item => item.type === 'function_call_output' && item.call_id === `call_${round}_${sample.name}`)
        expect(item).toBeDefined()
        const output = item.output as string
        if (sample.truncated) {
          expect(output).toContain('truncated')
          expect(Buffer.byteLength(output)).toBeLessThan(sample.maxTokens ? 2500 : 40_500)
          expect(output.includes(sample.text)).toBe(false)
        } else {
          expect(output.includes('truncated'), sample.name).toBe(false)
          expect(output.includes(sample.text)).toBe(true)
        }
      }
      await runtime.dispose?.(); runtime = undefined
    }
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 40_000)
