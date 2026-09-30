import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeCliProcessRunner } from './native-cli-process-runner'
import { nativeSessionTemporaryPath } from './native-runtime-process-path'

test('real CLI preserves command result identity for local commands and provider errors', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-command-result-')))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Offline provider rejection' } }, { status: 400 })
  } })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('test_timeout'), 25000)
  let runtime: Awaited<ReturnType<ReturnType<typeof createNativeCliProcessRunner>['start']>> | undefined
  try {
    runtime = await createNativeCliProcessRunner().start({ sessionId: 'offline-command', cwd: root,
      env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_API_KEY: 'offline',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`, ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' },
    })
    const results: Record<string, unknown>[] = []
    const submit = (prompt: string) => runtime!.submit({ prompt, signal: controller.signal,
      onMessage: message => { if (message.type === 'result') results.push(message) },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    await submit('/help')
    await expect(submit('Hello')).rejects.toThrow('Offline provider rejection')
    expect(results).toHaveLength(2)
    expect(results.every(result => typeof result.request_id === 'string')).toBe(true)
    expect(results[0]!.request_id).not.toBe(results[1]!.request_id)
  } finally {
    clearTimeout(timer); await runtime?.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 30000)

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

test('real CLI discovers Skills before a native child chooses its first tool', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-child-skills-')))
  const workspace = join(root, 'task')
  const skills = join(root, 'builtinskills')
  await mkdir(workspace)
  await mkdir(join(skills, 'review-evidence'), { recursive: true })
  await writeFile(join(workspace, 'design.md'), 'Design input')
  await writeFile(join(skills, 'review-evidence', 'SKILL.md'),
    '---\nname: review-evidence\ndescription: Review evidence\n---\nRead the original source behind the claim.\n')
  const requests: any[] = []
  const childRequests: any[] = []
  let parentCount = 0
  const controller = new AbortController()
  const frame = (event: any) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!path.endsWith('/messages')) return new Response('', { status: 404 })
    const body: any = await request.json()
    requests.push(body)
    if (requests.length > 8) { controller.abort(); return new Response('fixture limit', { status: 500 }) }
    const isChild = body.messages.some((message: any) => message.role === 'user' && Array.isArray(message.content) &&
      message.content.some((block: any) => block.type === 'text' && block.text.includes('NATIVE_SKILL_CHILD')))
    if (isChild) childRequests.push(body)
    const call = isChild
      ? (childRequests.length === 1 ? { name: 'Read', input: { file_path: 'design.md' } } : null)
      : (parentCount++ === 0 ? { name: 'Agent', input: { description: 'Review source evidence', subagent_type: 'general-purpose',
        prompt: 'NATIVE_SKILL_CHILD Source context: '.repeat(30) +
          'Read design.md. Review evidence and report the checked scope.' } } : null)
    const block = call ? { type: 'tool_use', id: `tool-${requests.length}`, ...call } : { type: 'text', text: 'Done' }
    return new Response(frame({ type: 'message_start', message: { id: `m-${requests.length}`, type: 'message', role: 'assistant',
      model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
      frame({ type: 'content_block_start', index: 0, content_block: call ? { ...block, input: {} } : { type: 'text', text: '' } }) +
      frame({ type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: 'Done' } }) +
      frame({ type: 'content_block_stop', index: 0 }) +
      frame({ type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
      frame({ type: 'message_stop' }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  let runtime: Awaited<ReturnType<ReturnType<typeof createNativeCliProcessRunner>['start']>> | undefined
  const timer = setTimeout(() => controller.abort('test_timeout'), 25000)
  try {
    runtime = await createNativeCliProcessRunner().start({ sessionId: 'offline-child-skills', cwd: workspace,
      env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: skills, SKILL_SEARCH_ENABLED: '1',
        BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_API_KEY: 'offline', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' },
    })
    await runtime.submit({ prompt: 'Run the offline delegation fixture', signal: controller.signal,
      onMessage: () => {}, requestPermission: async () => ({ behavior: 'deny' }) })
    expect(childRequests).toHaveLength(2)
    for (const request of childRequests) {
      const content = request.messages.flatMap((message: any) =>
        Array.isArray(message.content) ? message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text) : [],
      ).join('\n')
      expect(content).toContain('<loaded-skill name="review-evidence"')
      expect(content).toContain('Read the original source behind the claim.')
    }
  } finally {
    clearTimeout(timer); await runtime?.dispose?.(); server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
