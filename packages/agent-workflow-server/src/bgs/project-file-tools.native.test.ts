import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from './runner'

const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest.each([false, true])('ordinary and protected document tools run through the native entry (code-mode=%s)', async codeMode => {
  const root = await mkdtemp('/private/tmp/bgs-native-file-route-'), game = join(root, 'game'), catalog = join(root, 'skills')
  await mkdir(join(game, 'docs'), {recursive: true})
  await mkdir(join(catalog, 'fixture'), {recursive: true})
  await writeFile(join(catalog, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Offline test.\n---\nFixture.')
  let calls = 0
  const requests: any[] = []
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    const body = await request.json() as any
    requests.push(body)
    const command = {cmd: "printf 'Local fixture index\\n' > docs/README.md"}
    const first = codeMode
      ? {type: 'custom_tool_call', id: 'write-item', call_id: 'write-call', name: 'exec', namespace: 'functions',
        input: `text(await tools.exec_command(${JSON.stringify(command)})); text(await tools.WriteProjectFile(${JSON.stringify({file_path: 'docs/GDD.md', content: '# Local fixture design\n'})}));`, status: 'completed'}
      : {type: 'function_call', id: 'write-item', call_id: 'write-call', name: 'exec_command',
        arguments: JSON.stringify(command), status: 'completed'}
    const output = calls++ === 0 ? [first] :
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
        OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: codeMode ? 'gpt-6.1-sol' : 'unknown-fixture-model'},
      requestPermission: async request => ({behavior: request.toolName === 'Write' ? 'allow' : 'deny'}),
    })
    await runtime.submit({prompt: 'Write an index in this temporary fixture.', signal: AbortSignal.timeout(15000),
      onMessage() {}, requestPermission: async request => ({behavior: request.toolName === 'Write' ? 'allow' : 'deny'})})
    expect(calls).toBe(2)
    const tools = codeMode ? requests[0].input.find((item: any) => item.type === 'additional_tools').tools : requests[0].tools
    expect(tools.some((tool: any) => codeMode
      ? tool.type === 'namespace' && tool.name === 'functions' && tool.tools.some((nested: any) => nested.name === 'exec')
      : tool.name === 'exec_command')).toBe(true)
    if (codeMode) expect(await readFile(join(game, 'docs/GDD.md'), 'utf8')).toBe('# Local fixture design\n')
    expect(await readFile(join(game, 'docs/README.md'), 'utf8')).toBe('Local fixture index\n')
  } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, {recursive: true, force: true}) }
}, 20000)
