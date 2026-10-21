import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { createBgsRunner, bgsUsage, bgsProviderConfig, editProtectedFileText } from './runner'
import { BeeGameSessionManager, getLatestRuntimeUsage, type BeeGameEvent } from '../beegame/session-manager'

const resolveOutboundTarget: typeof import('@bee-game-studio/security-core').resolveApprovedOutboundTarget = async (value) => ({ url: new URL(value), addresses: ['93.184.216.34'],
  lookup: (_host, _options, callback) => callback(null, '93.184.216.34', 4) })
const command = [process.execPath, fileURLToPath(new URL('./fixtures/app-server.ts', import.meta.url))]
test('game Agent startup rejects a missing or empty catalog before starting native processes', async () => {
  const root = await mkdtemp('/private/tmp/bgs-missing-skills-')
  const workspace = join(root, 'game'), catalog = join(root, 'game-skills')
  await mkdir(workspace)
  try {
    for (const empty of [false, true]) {
      if (empty) await mkdir(catalog)
      await expect(createBgsRunner({ command: ['/must-not-start-bgs'], resolveOutboundTarget }).start({
        sessionId: 'missing-skills', cwd: workspace,
        env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog },
      })).rejects.toThrow(`BeeGameStudio built-in Skills are unavailable: ${catalog}`)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function fixture(permission: 'allow' | 'deny' = 'allow', env: Record<string, string> = {}, network = resolveOutboundTarget) {
  const root = await mkdtemp('/private/tmp/bgs-bgs-runner-'), workspace = join(root, 'game')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  const events: Record<string, any>[] = [], usage: BeeGameEvent[] = [], questions: unknown[] = []
  let sessionId = ''
  const runtime = await createBgsRunner({ command, resolveOutboundTarget: network }).start({ sessionId: 'fixture', cwd: workspace,
    env: { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only', ...env },
    onNativeSessionId: id => { sessionId = id },
    onNativeUsage: (value, epoch) => usage.push({ id: usage.length, type: 'usage', sessionId: 'fixture', text: '', createdAt: new Date(),
      payload: { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch, usage: value } }),
    requestPermission: async request => {
      questions.push(request)
      return { behavior: permission, source: 'policy', updatedInput: { ...request.input, answers: { 'Choose style': 'A' } } }
    },
  })
  const submit = (prompt: Parameters<typeof runtime.submit>[0]['prompt'], signal = new AbortController().signal) => runtime.submit({ prompt, signal,
    onMessage: message => { events.push(message) }, requestPermission: async () => ({ behavior: 'deny' }) })
  return { root, workspace, runtime, events, usage, questions, sessionId, submit,
    async close() { await runtime.dispose?.(); await rm(root, { recursive: true, force: true }) } }
}

test('streams text once, preserves tool lifecycle, and counts cached tokens once', async () => {
  const f = await fixture()
  try {
    await f.submit('hello')
    expect(f.events.filter(e => e.eventType.startsWith('assistant.')).map(e => e.text).join('')).toBe('Hello Bgs')
    expect(f.events.filter(e => e.eventType.startsWith('tool.')).map(e => e.eventType)).toEqual(['tool.started', 'tool.completed'])
    expect(f.events.find(e => e.eventType === 'tool.completed')).toMatchObject({ exitCode: 0, durationMs: 1200 })
    expect(getLatestRuntimeUsage(f.usage)).toEqual({ prompt_tokens: 80, completion_tokens: 30, cache_read_tokens: 20, cache_creation_tokens: 0, total_tokens: 130 })
    expect(f.sessionId).toBe('019a0000-0000-7000-8000-000000000001')
  } finally { await f.close() }
}, 30_000)

test('a nonzero native command exit is a failed tool receipt even when the item status is completed', async () => {
  const f = await fixture()
  try {
    await f.submit('command-fail')
    expect(f.events.find(e => e.eventType === 'tool.failed')).toMatchObject({ toolUseID: 'shell-1', exitCode: 2, durationMs: 1200, is_error: true })
    expect(f.events.some(e => e.eventType === 'tool.completed')).toBe(false)
  } finally { await f.close() }
}, 30_000)

test('native file change receipts retain the actual diff in a structured field', async () => {
  const f = await fixture()
  try {
    await f.submit('file-diff')
    expect(f.events.find(e => e.eventType === 'tool.completed')).toMatchObject({
      toolUseID: 'edit-1:0', toolName: 'Edit', input: { file_path: 'src/Example.ts' },
      diff: '@@ -11 +11 @@\n-old\n+new\n', output: '@@ -11 +11 @@\n-old\n+new\n',
    })
  } finally { await f.close() }
}, 30_000)

test('native command progress carries cumulative output and its original input', async () => {
  const f = await fixture()
  try {
    await f.submit('command-progress')
    const progress = f.events.filter(e => e.eventType === 'tool.progress')
    expect(progress.map(e => e.output)).toEqual(['Bu', 'Built'])
    expect(progress.every(e => e.input?.command === 'bun run build')).toBe(true)
  } finally { await f.close() }
}, 30_000)

test('protected file writes use the live BGS authority', async () => {
  for (const permission of ['allow', 'deny'] as const) {
    const f = await fixture(permission)
    try {
      await f.submit('write-design')
      if (permission === 'allow') expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('Authorized design')
      else expect(await Bun.file(join(f.workspace, 'docs/GDD.md')).exists()).toBe(false)
      expect(f.questions.length).toBeGreaterThan(0)
    } finally { await f.close() }
  }
}, 30_000)

test('protected-file tool cannot write outside the game', async () => {
  const f = await fixture()
  try { await f.submit('write-outside'); expect(await Bun.file(join(f.root, 'outside.md')).exists()).toBe(false); expect(f.questions).toHaveLength(0) }
  finally { await f.close() }
}, 30_000)

test.each(['../outside.md', 'absolute-sibling', 'docs/GDD.mdd', 'src/example.js'])(
  'protected-file path diagnostics reject without authorizing writes: %s', async input => {
  const f = await fixture()
  try {
    const path = input === 'absolute-sibling' ? join(f.root, 'game-sibling/docs/GDD.md') : input
    await f.submit('write-path:' + path)
    const text = f.events.at(-1)?.text ?? ''
    if (input === '../outside.md' || input === 'absolute-sibling') {
      expect(text).toContain('Path is outside the project workspace')
      expect(text).not.toContain('Use native BGS file tools')
    } else {
      expect(text).toContain('Path is not a BGS protected design record or AGENTS.md')
      expect(text).toContain('Check file_path')
    }
    expect(await Bun.file(resolve(f.workspace, path)).exists()).toBe(false)
    expect(f.questions).toHaveLength(0)
  } finally { await f.close() }
}, 30_000)

test('questions return actual user answers to the requesting item', async () => {
  const f = await fixture()
  try { await f.submit('question'); expect(f.events.some(e => e.text.includes('"answers":["A"]'))).toBe(true) }
  finally { await f.close() }
}, 30_000)

test('failure, process loss and unfinished child work never resolve as success', async () => {
  for (const prompt of ['fail', 'crash', 'unfinished-child']) {
    const f = await fixture()
    try { await expect(f.submit(prompt)).rejects.toThrow() } finally { await f.close() }
  }
}, 30_000)

test('failed turns retain upstream error details from completion or the preceding error notification', async () => {
  for (const prompt of ['failure-details', 'failure-notification']) {
    const f = await fixture()
    try {
      await expect(f.submit(prompt)).rejects.toMatchObject({ message: 'Connection error. fixture ECONNRESET',
        bgsErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } })
      if (prompt === 'failure-notification') expect(f.events.find(e => e.eventType === 'system.status'))
        .toMatchObject({ text: 'Connection error. fixture ECONNRESET', willRetry: false })
    } finally { await f.close() }
  }
}, 10000)

test('cancellation closes a waiting process before returning', async () => {
  const f = await fixture(), abort = new AbortController()
  try {
    const result = f.submit('hang', abort.signal)
    setTimeout(() => abort.abort(), 30)
    await expect(result).rejects.toThrow()
    await expect(f.submit('hello')).rejects.toThrow('stopped')
  } finally { await f.close() }
}, 30_000)

test('cache is a subset of input; reasoning output is not counted twice', () => {
  expect(bgsUsage({ inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 10, outputTokens: 30, reasoningOutputTokens: 15 }))
    .toEqual({ prompt_tokens: 70, completion_tokens: 30, cache_read_tokens: 20, cache_creation_tokens: 10, total_tokens: 130 })
  expect(() => bgsUsage({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 })).toThrow()
  expect(() => bgsProviderConfig({ OPENAI_AUTH_MODE: 'chatgpt', OPENAI_BASE_URL: 'https://example.invalid' })).toThrow()
})


test('BGS resumes Bgs history without double charging and does not resume legacy agent UUIDs', async () => {
  const root=await mkdtemp('/private/tmp/bgs-bgs-resume-'), workspace=join(root,'game')
  const environment=()=>({BEEGAME_CONFIG_DIR:join(root,'config'),OPENAI_API_KEY:'fixture-only'})
  let manager=new BeeGameSessionManager(createBgsRunner({command,resolveOutboundTarget}),root,environment)
  try {
    const session=manager.start({workspacePath:workspace,userId:'owner'})
    await manager.sendWithDisplay(session.id,'hello');await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).runtime).toBe('bgs')
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(130)
    await manager.dispose()
    manager=new BeeGameSessionManager(createBgsRunner({command,resolveOutboundTarget}),root,environment)
    manager.start({workspacePath:workspace,userId:'owner',transcriptSessionId:session.id})
    await manager.sendWithDisplay(session.id,'hello');await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(260)
    expect(manager.transcriptFacts(session.id).some(event=>event.type==='turn.completed')).toBe(true)
    await manager.dispose()
    const path=join(root,'snapshots',session.id+'.json'), snapshot=JSON.parse(await readFile(path,'utf8'))
    delete snapshot.runtime
    await writeFile(path,JSON.stringify(snapshot))
    manager=new BeeGameSessionManager(createBgsRunner({command,resolveOutboundTarget}),root,environment)
    manager.start({workspacePath:workspace,userId:'owner',transcriptSessionId:session.id})
    expect(manager.runtimeSnapshot(session.id).nativeSessionId).toBeUndefined()
  } finally {await manager.dispose();await rm(root,{recursive:true,force:true})}
},30_000)

test('Bgs protected edits obey the existing BGS design lock authority', async () => {
  const root=await mkdtemp('/private/tmp/bgs-bgs-lock-'),workspace=join(root,'game')
  await mkdir(join(workspace,'docs'),{recursive:true});await writeFile(join(workspace,'docs/GDD.md'),'original')
  const manager=new BeeGameSessionManager(createBgsRunner({command,resolveOutboundTarget}),root,()=>({BEEGAME_CONFIG_DIR:join(root,'config'),OPENAI_API_KEY:'fixture-only'}))
  try{
    const session=manager.start({workspacePath:workspace,userId:'owner',projectId:'project'})
    manager.setProjectDesignLocked(session.id,true)
    await manager.sendWithDisplay(session.id,'write-design');await manager.waitForSessionIdle(session.id)
    expect(await readFile(join(workspace,'docs/GDD.md'),'utf8')).toBe('original')
    expect(manager.transcriptFacts(session.id).some(event=>event.payload?.reason==='project_design_locked')).toBe(true)
  }finally{await manager.dispose();await rm(root,{recursive:true,force:true})}
},30_000)

test('required Bgs skill selection fails clearly when absent and accepts a real catalog entry', async () => {
  const missing=await fixture()
  try {await expect(missing.submit('$missing-fixture-skill Use method')).rejects.toThrow('Required BGS skill is unavailable')}
  finally {await missing.close()}
  const available=await fixture()
  try {
    await available.submit([{type:'text',text:'Current platform facts'}, {type:'text',text:'$game-creative-director-expert Apply the method'}])
    expect(available.events.some(event=>event.text==='Native skill selected')).toBe(true)
  } finally {await available.close()}
},30000)

test('an unrelated broken skill does not block valid skills, while a missing required skill still stops before submission', async () => {
  const root = await mkdtemp('/private/tmp/bgs-skill-catalog-'), game = join(root, 'game')
  await mkdir(game)
  const warnings: unknown[][] = [], warn = console.warn
  console.warn = (...args) => { warnings.push(args) }
  let runtime: Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>> | undefined
  try {
    for (const required of ['game-creative-director-expert', 'missing-fixture-skill']) {
      let submitted = false
      const events: Record<string, any>[] = []
      runtime = await createBgsRunner({ command, resolveOutboundTarget }).start({ sessionId: required, cwd: game,
        env: { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only', BGS_FIXTURE_SKILL_CATALOG_ERROR: '1' },
        onNativeSubmission: () => { submitted = true } })
      const result = runtime.submit({ prompt: '$'+required+' Apply the method', signal: AbortSignal.timeout(5000),
        onMessage: value => { events.push(value) }, requestPermission: async () => ({ behavior: 'deny' }) })
      if (required === 'game-creative-director-expert') {
        await result
        expect(submitted).toBe(true)
        expect(events.some(event => event.text === 'Native skill selected')).toBe(true)
      } else {
        await expect(result).rejects.toThrow('Required BGS skill is unavailable: '+required)
        expect(submitted).toBe(false)
        expect(events.some(event => event.eventType === 'assistant.message')).toBe(false)
      }
      await runtime.dispose?.(); runtime = undefined
    }
    expect(warnings).toHaveLength(2)
    expect(JSON.stringify(warnings)).not.toContain('PRIVATE_')
  } finally { console.warn = warn; await runtime?.dispose?.(); await rm(root, { recursive: true, force: true }) }
}, 10000)


test('protected edits are literal, unique and non-overlapping against the original text', () => {
  expect(editProtectedFileText('alpha beta', { edits: [
    { old_string: 'beta', new_string: 'alpha' }, { old_string: 'alpha', new_string: '$& $1' },
  ] })).toBe('$& $1 alpha')
  expect(editProtectedFileText('alpha', { old_string: 'alpha', new_string: '$&' })).toBe('$&')
  for (const args of [
    { edits: [] },
    { edits: [{ old_string: '', new_string: 'x' }] },
    { edits: [{ old_string: 'absent', new_string: 'x' }] },
    { edits: [{ old_string: 'alpha', new_string: 'x' }, { old_string: 'pha', new_string: 'y' }] },
    { edits: [{ old_string: 'alpha', new_string: 'x' }], old_string: 'beta', new_string: 'y' },
  ]) expect(() => editProtectedFileText('alpha beta', args)).toThrow()
  expect(() => editProtectedFileText('aaa', { old_string: 'aa', new_string: 'x' })).toThrow('exactly once')
})

test('protected edit errors identify all failing original-file matches without echoing content', () => {
  const run = () => editProtectedFileText('alpha beta beta', { edits: [
    { old_string: 'alpha', new_string: 'saved only if all succeed' },
    { old_string: 'PRIVATE_ABSENT_CONTENT', new_string: 'x' },
    { old_string: 'beta', new_string: 'y' },
  ] })
  expect(run).toThrow('edits[1]: old_string matched 0 times')
  expect(run).toThrow('edits[2]: old_string matched 2 times')
  expect(run).toThrow('Nothing saved')
  try { run() } catch (error) { expect(String(error)).not.toContain('PRIVATE_ABSENT_CONTENT') }
})

test.each(['success', 'missing-match', 'denied'] as const)('protected batch edits preserve permissions and all-or-nothing writes: %s', async mode => {
  const f = await fixture(mode === 'denied' ? 'deny' : 'allow')
  try {
    const path = join(f.workspace, 'docs/GDD.md')
    await writeFile(path, 'alpha beta')
    await f.submit('edit-design:' + JSON.stringify({ edits: [
      { old_string: 'alpha', new_string: '$&' },
      { old_string: mode === 'missing-match' ? 'absent' : 'beta', new_string: 'gamma' },
    ] }))
    expect(await readFile(path, 'utf8')).toBe(mode === 'success' ? '$& gamma' : 'alpha beta')
    expect(f.questions.length).toBeGreaterThan(0)
    expect(f.events.some(e => e.text?.includes(mode === 'success' ? 'Saved design' : 'Write rejected'))).toBe(true)
  } finally { await f.close() }
}, 30_000)


test('provider unknown tools reach the active BGS event stream without executing or retrying them', async () => {
  let requests = 0
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'unknown-call',
      function: { name: 'PRIVATE_UNSUPPORTED_NAME', arguments: '{"secret":"PRIVATE_ARGUMENT"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 4, completion_tokens: 2 } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  let f: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    f = await fixture('allow', { BEEGAME_API_PROTOCOL: 'chat-completions', BEEGAME_MODEL: 'fixture-model', OPENAI_BASE_URL: provider.url.toString().replace(/\/$/, '') },
      async value => ({ url: new URL(value), addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }))
    await f.submit('provider-unknown-tool')
    const failures = f.events.filter(event => event.eventType === 'tool.failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ toolUseID: 'unknown-call', toolName: 'Unknown provider tool', is_error: true,
      output: expect.stringContaining('No action was executed') })
    expect(JSON.stringify(failures)).not.toContain('PRIVATE_')
    expect(f.questions).toHaveLength(0)
    expect(requests).toBe(1)
  } finally { await f?.close(); provider.stop(true) }
}, 10_000)
