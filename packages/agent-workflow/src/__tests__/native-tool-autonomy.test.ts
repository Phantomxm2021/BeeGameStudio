import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runNativeFileAgent, nativeFileAgentEnvironment } from '../native-file-agent'

const cli = process.env.BEEGAME_REVIEW_TEST_CLI ?? join(import.meta.dir, '../../../../dist/cli-bun.js')
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
const frame = (value: any) => 'event: ' + value.type + '\ndata: ' + JSON.stringify(value) + '\n\n'

test('native Bash and delegated tools run without tool filtering while retaining sandbox and credential boundaries', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-tool-autonomy-')))
  const workspace = join(root, 'workspace')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(join(workspace, 'docs/GDD.md'), 'Confirmed document')
  await writeFile(join(workspace, 'reference.txt'), Array.from({ length: 1000 }, (_, index) =>
    'REFERENCE_LINE_' + index + ' ' + 'complete-reference-content-'.repeat(2)).join('\n'))
  let cachedResultPath = ''
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'OUTSIDE_SECRET')
  const checkScript = `const fs=require('fs');const result={frequency:880*Math.pow(2,5/12),scrubbed:[process.env.ANTHROPIC_API_KEY,process.env.OPENAI_API_KEY,process.env.GEMINI_API_KEY].every(value=>value===undefined)};
    try{result.outside=fs.readFileSync(${JSON.stringify(outside)},'utf8')}catch{result.readBlocked=true}
    try{fs.writeFileSync(${JSON.stringify(outside)},'BAD')}catch{result.writeBlocked=true}
    try{fs.writeFileSync('docs/GDD.md','BAD')}catch{result.evidenceProtected=true}
    fs.writeFileSync('check.json',JSON.stringify(result));console.log('CHECK_COMPLETE')`
  const calls = [
    { name: 'Bash', input: { command: "python3 - <<'PY'\nassert 1 != 2\nprint('HEREDOC_BANG!_OK')\nPY" } },
    { name: 'Read', input: { file_path: 'reference.txt' } },
    { name: 'Read', input: { file_path: 'CACHED_RESULT', offset: 900, limit: 10 } },
    { name: 'Write', input: { file_path: 'CACHED_RESULT', content: 'BAD' } },
    { name: 'Edit', input: { file_path: 'CACHED_RESULT', old_string: 'REFERENCE_LINE_0', new_string: 'BAD' } },
    { name: 'Bash', input: { command: 'CACHE_WRITE_CHECK' } },
    { name: 'Bash', input: { command: quote(process.execPath) + ' -e ' + quote(checkScript), dangerouslyDisableSandbox: true } },
    { name: 'Agent', input: { description: 'Check task-local documents', subagent_type: 'general-purpose',
      prompt: 'NATIVE_CHILD_CHECK: inspect the task-local files.', mode: 'bypassPermissions' } },
    { name: 'Bash', input: { command: 'printf "%s" "$$" > background.pid; exec /bin/sleep 30', run_in_background: true } },
    { name: 'StructuredOutput', input: { ok: true } },
  ]
  const childCalls = [
    { name: 'Read', input: { file_path: 'CACHED_RESULT', offset: 900, limit: 10 } },
    { name: 'Read', input: { file_path: 'docs/GDD.md' } },
    { name: 'Write', input: { file_path: 'child-note.md', content: 'Child tools executed' } },
    { name: 'Write', input: { file_path: outside, content: 'BAD' } },
  ]
  const requests: any[] = []
  let mainCount = 0, childCount = 0, backgroundPid: number | undefined
  const abort = new AbortController()
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!path.endsWith('/messages')) return new Response('', { status: 404 })
    const body = await request.json() as any
    requests.push(body)
    const resultTexts = body.messages.flatMap((message: any) => Array.isArray(message.content)
      ? message.content.filter((block: any) => block.type === 'tool_result').flatMap((block: any) =>
        typeof block.content === 'string' ? [block.content] : (block.content ?? []).map((part: any) => part.text ?? '')) : [])
    const saved = resultTexts.join('\n').match(/Full output saved to: (.+)/)
    if (saved) cachedResultPath = saved[1]!.trim()
    if (requests.length > 30) { abort.abort(); return new Response('', { status: 500 }) }
    const child = body.messages.some((message: any) => message.role === 'user' &&
      (Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }])
        .some((block: any) => block.type === 'text' && block.text.includes('NATIVE_CHILD_CHECK')))
    const call = child ? childCalls[childCount++] : calls[mainCount++]
    if (call?.input && 'file_path' in call.input && call.input.file_path === 'CACHED_RESULT') {
      if (!cachedResultPath) { abort.abort(); return new Response('Missing cached result', { status: 500 }) }
      call.input.file_path = cachedResultPath
    }
    if (call?.name === 'Bash' && 'command' in call.input && call.input.command === 'CACHE_WRITE_CHECK')
      call.input.command = "if printf BAD > " + quote(cachedResultPath) + "; then exit 9; else printf CACHE_WRITE_BLOCKED; fi"
    if (!child && call?.name === 'StructuredOutput') {
      for (let attempt = 0; attempt < 100; attempt++) {
        const pid = await readFile(join(workspace, 'background.pid'), 'utf8').catch(() => '')
        if (/^[1-9][0-9]*$/.test(pid)) { backgroundPid = Number(pid); break }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    const id = 'message-' + requests.length
    const block = call ? { type: 'tool_use', id: 'tool-' + requests.length, ...call } : { type: 'text', text: 'Done.' }
    return new Response(frame({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
      frame({ type: 'content_block_start', index: 0, content_block: call ? { ...block, input: {} } : { type: 'text', text: '' } }) +
      frame({ type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: 'Done.' } }) +
      frame({ type: 'content_block_stop', index: 0 }) +
      frame({ type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
      frame({ type: 'message_stop' }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const timer = setTimeout(() => abort.abort(), 45000)
  try {
    const result = await runNativeFileAgent({ command: [process.execPath, cli],
      env: nativeFileAgentEnvironment({ BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_MODEL_TYPE: 'anthropic',
        ANTHROPIC_API_KEY: 'MODEL_SECRET', OPENAI_API_KEY: 'ALTERNATE_SECRET', GEMINI_API_KEY: 'OTHER_SECRET',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + server.port, ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' }),
      workspacePath: workspace, writablePaths: [], allowWorkingFiles: true, readOnlyPaths: ['docs', 'reference.txt'],
      prompt: 'Run the offline native tools fixture.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      logPath: join(root, 'events.jsonl'), signal: abort.signal,
    })
    expect(result.failure).toBeUndefined()
    expect(requests[0].tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(['Bash', 'Agent', 'Read', 'Write']))
    const check = await readFile(join(workspace, 'check.json'), 'utf8').catch(error => {
      console.error(JSON.stringify(requests.flatMap(request => request.messages.flatMap((message: any) =>
        Array.isArray(message.content) ? message.content.filter((block: any) => block.type === 'tool_result') : []))))
      throw error
    })
    expect(JSON.parse(check)).toMatchObject({
      frequency: 1174.6590716696303, scrubbed: true, readBlocked: true, writeBlocked: true, evidenceProtected: true,
    })
    expect(await readFile(join(workspace, 'child-note.md'), 'utf8')).toBe('Child tools executed')
    expect(childCount).toBe(5)
    expect(cachedResultPath).toStartWith(join(workspace, '.native-tool-results') + '/')
    expect(await readFile(cachedResultPath, 'utf8')).toContain('REFERENCE_LINE_999')
    const toolResults = requests.flatMap(request => request.messages.flatMap((message: any) =>
      Array.isArray(message.content) ? message.content.filter((block: any) => block.type === 'tool_result') : []))
    const resultsText = JSON.stringify(toolResults)
    expect(resultsText).toContain('HEREDOC_BANG!_OK')
    expect(resultsText).toContain('CACHE_WRITE_BLOCKED')
    expect(resultsText).toContain('REFERENCE_LINE_900')
    expect(toolResults.filter((block: any) => JSON.stringify(block.content).includes('HEREDOC_BANG!_OK')).every((block: any) => !block.is_error)).toBe(true)
    expect(backgroundPid).toBeDefined()
    const alive = () => { try { process.kill(backgroundPid!, 0); return true } catch { return false } }
    for (let attempt = 0; attempt < 100 && alive(); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(alive()).toBe(false)
    backgroundPid = undefined
    expect(await readFile(outside, 'utf8')).toBe('OUTSIDE_SECRET')
    expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe('Confirmed document')
    expect(JSON.stringify(requests.map(request => request.messages))).not.toContain('OUTSIDE_SECRET')
    const log = (await readFile(join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(log.filter(entry => entry.event === 'permission' && entry.data.tool === 'Read' &&
      entry.data.path === cachedResultPath && entry.data.allowed)).toHaveLength(2)
    expect(log.some(entry => entry.event === 'permission' && entry.data.tool === 'Write' && !entry.data.allowed)).toBe(true)
    expect(log.some(entry => entry.event === 'permission' && entry.data.tool === 'Edit' && !entry.data.allowed)).toBe(true)
    expect(log.some(entry => entry.event === 'permission' && entry.data.tool === 'Agent' && entry.data.allowed)).toBe(true)
    const totals = Object.values(result.result!.modelUsage as Record<string, { inputTokens: number; outputTokens: number }>)
    expect(totals.reduce((sum, usage) => sum + usage.inputTokens, 0)).toBe(requests.length * 10)
    expect(totals.reduce((sum, usage) => sum + usage.outputTokens, 0)).toBe(requests.length * 5)
  } finally {
    if (backgroundPid) { try { process.kill(backgroundPid, 'SIGTERM') } catch {} }
    clearTimeout(timer); server.stop(true); await rm(root, { recursive: true, force: true })
  }
}, 50000)
