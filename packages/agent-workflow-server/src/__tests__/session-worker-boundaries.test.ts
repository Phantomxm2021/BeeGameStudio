import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager } from '../beegame/session-manager'

test('runtime forwards current provider credentials and drops retired tool settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-runtime-env-'))
  const retired = Object.fromEntries(['BEEGAME_ARTIFACTS_URL', 'BEEGAME_ARTIFACTS_TOKEN',
    'TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'EXA_API_KEY', 'SKILL_SEARCH_ENABLED', 'BGS_USE_OPENAI']
    .map(key => [key, 'retained-fixture-value']))
  let forwarded: Record<string, string> | undefined
  const manager = new BeeGameSessionManager({ start: async input => {
    forwarded = input.env
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Done' })
    } }
  } }, root, () => ({ ...retired, OPENAI_API_KEY: 'provider-fixture' }))
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline environment fixture')
    await manager.waitForSessionIdle(session.id)
    expect(forwarded?.OPENAI_API_KEY).toBe('provider-fixture')
    for (const key of Object.keys(retired)) expect(forwarded).not.toHaveProperty(key)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('project Chat redacts known runtime credentials from tool output without changing native input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chat-secret-'))
  const secret = 'provider-secret-fixture'
  let nativeOutput = ''
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    nativeOutput = `Tool output: ${secret}`
    await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'tool.completed',
      toolUseID: 'command-1', toolName: 'Bash', output: nativeOutput })
    await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Done' })
  } }) }, root, () => ({ OPENAI_API_KEY: secret }))
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline Chat fixture')
    for (let i = 0; i < 200 && !manager.events(session.id).some(event => event.type === 'tool.completed'); i++)
      await new Promise(resolve => setTimeout(resolve, 5))
    expect(nativeOutput).toContain(secret)
    const output = manager.events(session.id).find(event => event.type === 'tool.completed')
    expect(JSON.stringify(output)).not.toContain(secret)
    expect(JSON.stringify(output)).toContain('[REDACTED]')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('conversation must not auto-approve native shell escalation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-native-permission-'))
    let decision: unknown
    const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(input) {
      // Only replay permission data. This command must never be executed by a test.
      decision = await input.requestPermission({ toolUseID: 'escape', toolName: 'Bash',
        input: { command: 'pkill -f "vite"', dangerouslyDisableSandbox: true },
        message: 'Command explicitly disables sandbox', decisionReason: 'Command explicitly disables sandbox' })
      await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Fixture finished' })
    } }) }, root)
    const shared = { workspacePath: root, userId: 'owner', projectId: 'project' }
    try {
      const session = manager.start(shared)
      await manager.sendWithDisplay(session.id, 'Offline permission fixture')
      for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++)
        await new Promise(resolve => setTimeout(resolve, 5))
      expect(manager.pendingPermissionsForProject('owner', 'project', root)).toMatchObject([{ toolUseID: 'escape', sessionId: session.id }])
      expect(decision).toBeUndefined()
      expect(manager.events(session.id).find(event => event.type === 'permission.requested')?.payload)
        .toMatchObject({ decisionReason: 'Command explicitly disables sandbox' })
      expect(manager.events(session.id).some(event => event.type === 'permission.resolved')).toBe(false)
      manager.resolvePermission(session.id, 'escape', { behavior: 'deny', source: 'user' })
      for (let i = 0; i < 200 && !decision; i++) await new Promise(resolve => setTimeout(resolve, 5))
      expect(decision).toMatchObject({ behavior: 'deny', source: 'user' })
    } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('service disposal records shutdown and resolves pending approval as policy, not user rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-host-shutdown-'))
  let reason: unknown
  let decision: unknown
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(input) {
    input.signal.addEventListener('abort', () => { reason = input.signal.reason }, { once: true })
    decision = await input.requestPermission({ toolUseID: 'pending', toolName: 'Bash', input: { command: 'native permission fixture' }, message: 'Approve?' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline shutdown fixture')
    for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++)
      await new Promise(resolve => setTimeout(resolve, 5))
    expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(1)
    await manager.dispose()
    expect(reason).toBe('service_shutdown')
    expect(decision).toMatchObject({ behavior: 'deny', source: 'policy' })
    const transcript = manager.transcript(session.id)
    expect(transcript.find(event => event.type === 'session.stopped')?.payload).toMatchObject({ reason: 'service_shutdown' })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('a permission callback arriving after shutdown cannot create a new approval gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-late-native-permission-'))
  let decision: unknown
  let ready!: () => void
  const submitted = new Promise<void>(resolve => { ready = resolve })
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(input) {
    ready()
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
    decision = await input.requestPermission({ toolUseID: 'late-network',
      toolName: 'SandboxNetworkAccess', input: { host: 'registry.npmjs.org' },
      message: 'Network access requires permission.' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline shutdown fixture')
    await submitted
    await manager.dispose()
    expect(decision).toMatchObject({ behavior: 'deny', source: 'policy' })
    expect(manager.transcript(session.id).filter(event => event.type === 'permission.requested')).toHaveLength(0)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
}, 3_000)

for (const stoppedFirst of [false, true]) {
  test(`shutdown awaits asynchronous runtime cleanup (previously stopped: ${stoppedFirst})`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-cleanup-drain-'))
    let release!: () => void
    const cleanup = new Promise<void>(resolve => { release = resolve })
    let ready!: () => void
    const submitted = new Promise<void>(resolve => { ready = resolve })
    const manager = new BeeGameSessionManager({ start: async () => ({
      stop() {}, dispose: () => cleanup,
      async submit(input) {
        ready()
        await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      },
    }) }, root)
    try {
      const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
      await manager.sendWithDisplay(session.id, 'Offline cleanup fixture')
      await submitted
      if (stoppedFirst) manager.stop(session.id)
      let finished = false
      const shutdown = manager.dispose().then(() => { finished = true })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(finished).toBe(false)
      release()
      await shutdown
      expect(finished).toBe(true)
    } finally { release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
  })
}

test('failed runner cleanup keeps the stopped session and busy guard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-cleanup-failure-'))
  let disposeCalls = 0
  let markStarted!: () => void
  const started = new Promise<void>(resolve => { markStarted = resolve })
  const manager = new BeeGameSessionManager({ start: async () => {
    // sendWithDisplay returns after claiming the turn, before runDirectTurn
    // necessarily reaches the runner. Wait for the runner to be owned before
    // exercising the stop/delete cleanup boundary.
    markStarted()
    return {
      stop() {},
      async dispose() { disposeCalls += 1; throw new Error('cleanup fixture failed') },
      async submit() {},
    }
  } }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    // start() is idle but owns a runner only after the first turn. Use the
    // same lifecycle boundary as project deletion by opening the runner.
    await manager.sendWithDisplay(session.id, 'Cleanup failure fixture')
      .catch(() => undefined)
    await started
    manager.stop(session.id)
    await expect(manager.delete(session.id)).rejects.toThrow('Runtime cleanup failed')
    expect(disposeCalls).toBeGreaterThan(0)
    expect(manager.get(session.id)).toBeDefined()
    expect(manager.hasActiveProjectTurn('owner', 'project', root)).toBe(true)
  } finally {
    await manager.dispose().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('deleting an idle session does not wait for another project runtime cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delete-cleanup-scope-'))
  let release!: () => void, entered!: () => void
  const cleanup = new Promise<void>(resolve => { release = resolve })
  const disposing = new Promise<void>(resolve => { entered = resolve })
  const manager = new BeeGameSessionManager({ async start() { return {
    stop() {}, async submit() {}, async dispose() { entered(); await cleanup },
  } } }, root)
  try {
    const busy = manager.start({ workspacePath: root, userId: 'owner', projectId: 'busy' })
    await manager.sendWithDisplay(busy.id, 'Offline fixture')
    await manager.waitForSessionIdle(busy.id)
    manager.stop(busy.id)
    await disposing
    expect(manager.hasActiveProjectTurn('owner', 'busy', root)).toBe(true)
    const idle = manager.start({ workspacePath: root, userId: 'other', projectId: 'idle' })
    expect(await manager.delete(idle.id)).toEqual({ deleted: true, deletedArtifactPaths: [] })
  } finally { release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})


test('an existing project gets Git ignore coverage before a resumed session starts its runtime', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { readFile, writeFile } = await import('node:fs/promises')
  const exec = promisify(execFile)
  const root = await mkdtemp(join(tmpdir(), 'bgs-resume-git-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  await exec('git', ['-C', root, 'init', '--template='], {env})
  await writeFile(join(root, '.gitignore'), '# Existing authored ignore rules\ncustom-cache/\n')
  let starts = 0
  const runner = { start: async (input: {cwd: string}) => {
    const ignored = await exec('git', ['-C', input.cwd, 'check-ignore', '--', '.beegame/chat/project-events.jsonl'], {env})
    expect(ignored.stdout.trim()).toBe('.beegame/chat/project-events.jsonl')
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toEndWith('# Existing authored ignore rules\ncustom-cache/\n')
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toContain('# Engine: Unity')
    starts++
    return { stop() {}, async submit(turn) {
      await turn.onMessage({type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Offline fixture'})
    } }
  } } satisfies import('../beegame/session-manager').BeeGameSessionRunner
  let manager = new BeeGameSessionManager(runner, root)
  try {
    const session = manager.start({workspacePath: root, userId: 'owner', projectId: 'project'})
    await manager.sendWithDisplay(session.id, 'Offline existing-project fixture', {confirmedBriefContext: JSON.stringify({
      kind:'confirmed_build_brief', settings:{engine:'Unity'}, resource_library_usage:'optional',
      document_language:'en', game_user_visible_language:'en', agent_response_language:'en',
    })})
    await manager.waitForSessionIdle(session.id)
    expect(starts).toBe(1)
    await manager.dispose()
    await writeFile(join(root, '.gitignore'), '# Existing authored ignore rules\ncustom-cache/\n')
    manager = new BeeGameSessionManager(runner, root)
    const restored = manager.start({workspacePath:root, userId:'owner', projectId:'project', transcriptSessionId:session.id})
    await manager.sendWithDisplay(restored.id, 'Offline recovered-context fixture')
    await manager.waitForSessionIdle(restored.id)
    expect(starts).toBe(2)
    expect(manager.events(session.id).some(event => event.type === 'turn.failed')).toBe(false)
  } finally { await manager.dispose(); await rm(root, {recursive: true, force: true}) }
})
