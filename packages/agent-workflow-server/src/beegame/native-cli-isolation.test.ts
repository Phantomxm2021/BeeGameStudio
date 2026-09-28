import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeCliProcessRunner } from './native-cli-process-runner'
import { nativeSessionTemporaryPath } from './native-runtime-process-path'

for (const isolated of [true, false]) test(`real CLI protects host files with native delegation (${isolated ? 'document' : 'project'})`, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-cli-isolation-')))
  const workspace = join(root, 'task')
  await mkdir(workspace)
  const outside = join(root, 'project.txt')
  await writeFile(outside, 'PROJECT_PRIVATE')
  await writeFile(join(workspace, 'authority.md'), 'Frozen authority')
  const probe = `const fs=require('fs');const r={cwd:process.cwd()};
try{fs.readFileSync(${JSON.stringify(outside)});r.outsideBlocked=false}catch{r.outsideBlocked=true}
try{fs.writeFileSync('authority.md','BAD');r.sourceProtected=false}catch{r.sourceProtected=true}
fs.mkdirSync(process.env.NPM_CONFIG_CACHE,{recursive:true});fs.writeFileSync(process.env.NPM_CONFIG_CACHE+'/probe','CACHE_OK');r.cache=process.env.NPM_CONFIG_CACHE;
fs.writeFileSync('checklist.md','- [ ] AC-1 Goal works\\n');fs.writeFileSync('probe.json',JSON.stringify(r));console.log('LOCAL_CHECK_COMPLETE')`
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  const calls = [
    { name: 'Read', input: { file_path: 'authority.md' } },
    { name: 'Bash', input: { command: `${quote(process.execPath)} -e ${quote(probe)}`, dangerouslyDisableSandbox: true } },
    { name: 'Agent', input: { description: 'Check frozen input', subagent_type: 'general-purpose',
      prompt: 'NATIVE_ISOLATED_CHILD inspect authority and leave a note.', mode: 'bypassPermissions' } },
  ]
  const childCalls = [{ name: 'Read', input: { file_path: 'authority.md' } },
    { name: 'Write', input: { file_path: 'child.md', content: 'Child completed' } }]
  let parentCount = 0, childCount = 0, callbacks = 0
  const abort = new AbortController()
  const frame = (event: object) => `event: ${(event as {type: string}).type}\ndata: ${JSON.stringify(event)}\n\n`
  const requests: any[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!path.endsWith('/messages')) return new Response('', { status: 404 })
    const body: any = await request.json()
    requests.push(body)
    if (requests.length > 12) { abort.abort(); return new Response('fixture limit', { status: 500 }) }
    const child = body.messages.some((message: any) => message.role === 'user' && Array.isArray(message.content) &&
      message.content.some((block: any) => block.type === 'text' && block.text.includes('NATIVE_ISOLATED_CHILD')))
    const call = child ? childCalls[childCount++] : calls[parentCount++]
    const block = call ? { type: 'tool_use', id: 'tool-' + requests.length, ...call } : { type: 'text', text: 'Done' }
    return new Response(frame({ type: 'message_start', message: { id: 'm-' + requests.length, type: 'message', role: 'assistant',
      model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
      frame({ type: 'content_block_start', index: 0, content_block: call ? { ...block, input: {} } : { type: 'text', text: '' } }) +
      frame({ type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: 'Done' } }) +
      frame({ type: 'content_block_stop', index: 0 }) +
      frame({ type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
      frame({ type: 'message_stop' }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  let runtime: Awaited<ReturnType<ReturnType<typeof createNativeCliProcessRunner>['start']>> | undefined
  const timer = setTimeout(() => abort.abort(), 35000)
  try {
    runtime = await createNativeCliProcessRunner().start({ sessionId: 'offline-isolation', cwd: workspace,
      ...(isolated ? { isolatedTask: { workspacePath: workspace, readOnlyPaths: ['authority.md'] } } : {}),
      env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_API_KEY: 'offline',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`, ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', NPM_CONFIG_CACHE: '/host/private-cache', npm_config_cache: '/host/private-cache' },
    })
    const received: any[] = []
    await runtime.submit({ prompt: 'Run the offline isolated task fixture', signal: abort.signal,
      onMessage: message => { received.push(message) }, requestPermission: async () => {
        callbacks++; return { behavior: isolated ? 'deny' : 'allow', source: 'policy' }
      } })
    if (isolated) expect(callbacks).toBe(0)
    expect(requests[0].tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(['Read', 'Write', 'Bash', 'Agent']))
    const probeResult = await readFile(join(workspace, 'probe.json'), 'utf8').catch(error => {
      console.error(JSON.stringify(requests.flatMap(request => request.messages.flatMap((m: any) =>
        Array.isArray(m.content) ? m.content.filter((b: any) => b.type === 'tool_result' && b.is_error) : []))))
      throw error
    })
    const cache = join(isolated ? join(workspace, '.native-tmp') : nativeSessionTemporaryPath(workspace, 'offline-isolation'), 'npm-cache')
    expect(JSON.parse(probeResult)).toEqual({ cwd: workspace, outsideBlocked: true, sourceProtected: isolated, cache })
    expect(await readFile(join(cache, 'probe'), 'utf8')).toBe('CACHE_OK')
    expect(await readFile(join(workspace, 'authority.md'), 'utf8')).toBe(isolated ? 'Frozen authority' : 'BAD')
    expect(await readFile(outside, 'utf8')).toBe('PROJECT_PRIVATE')
    expect(await readFile(join(workspace, 'checklist.md'), 'utf8')).toContain('AC-1')
    expect(await readFile(join(workspace, 'child.md'), 'utf8')).toBe('Child completed')
    expect(childCount).toBe(3)
    expect(received.at(-1)).toMatchObject({ type: 'result', subtype: 'success' })
  } finally {
    clearTimeout(timer); await runtime?.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 40000)
