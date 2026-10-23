import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'

const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest('ordinary document writes work through exec_command without widening protected-file access', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-file-route-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(join(game, 'docs'), {recursive: true})
  await mkdir(join(catalog, 'fixture'), {recursive: true})
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline test.\n---\nFixture.')
  let calls = 0
  const requests: any[] = []
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any
    requests.push(body)
    const output = calls++ === 0 ? [{type: 'function_call', id: 'write-item', call_id: 'write-call', name: 'exec_command',
      arguments: JSON.stringify({cmd: "printf 'Local fixture index\\n' > docs/README.md"}), status: 'completed'}] :
      [{id: 'answer', type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'Done', annotations: []}]}]
    const response = {id: 'resp_' + calls, object: 'response', created_at: 1, model: body.model, status: 'completed', output,
      usage: {input_tokens: 10, output_tokens: 2, total_tokens: 12}}
    return new Response([
      {type: 'response.created', response: {...response, status: 'in_progress', output: []}},
      ...output.flatMap((item, output_index) => [
        {type: 'response.output_item.added', output_index, item: {...item, status: 'in_progress'}},
        {type: 'response.output_item.done', output_index, item},
      ]),
      {type: 'response.completed', response},
    ].map((event, sequence_number) => `data: ${JSON.stringify({...event, sequence_number})}\n\n`).join(''),
    {headers: {'Content-Type': 'text/event-stream'}})
  }})
  const runner = createBgsRunner({resolveOutboundTarget: async value => {
    const url = new URL(value)
    if (url.origin !== server.url.origin) throw Error('Non-local request forbidden')
    return {url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4)}
  }})
  let runtime: Awaited<ReturnType<typeof runner.start>> | undefined
  try {
    runtime = await runner.start({sessionId: 'file-route-fixture', cwd: game,
      env: {BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog,
        OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'unknown-fixture-model'},
      requestPermission: async () => ({behavior: 'deny'}),
    })
    await runtime.submit({prompt: 'Write an index in this temporary fixture.', signal: AbortSignal.timeout(15000),
      onMessage() {}, requestPermission: async () => ({behavior: 'deny'})})
    expect(calls).toBe(2)
    expect(requests[0].tools.some((tool: any) => tool.name === 'exec_command')).toBe(true)
    expect(await readFile(join(game, 'docs/README.md'), 'utf8')).toBe('Local fixture index\n')
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, {recursive: true, force: true}) }
}, 20000)
