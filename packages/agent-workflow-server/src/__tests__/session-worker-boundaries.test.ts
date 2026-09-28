import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager } from '../beegame/session-manager'

test('web search credentials reach the native process without a project-file copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-web-env-'))
  let forwarded: Record<string, string> | undefined
  const manager = new BeeGameSessionManager({ start: async input => {
    forwarded = input.env
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root, () => ({ BRAVE_SEARCH_API_KEY: 'brave-fixture', EXA_API_KEY: 'exa-fixture' }))
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline environment fixture')
    for (let i = 0; i < 200 && !forwarded; i++) await new Promise(resolve => setTimeout(resolve, 5))
    expect(forwarded).toMatchObject({
      BRAVE_SEARCH_API_KEY: 'brave-fixture', EXA_API_KEY: 'exa-fixture',
    })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('project Chat redacts known runtime credentials from tool output without changing native input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chat-secret-'))
  const secret = 'brave-secret-fixture'
  let nativeOutput = ''
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    nativeOutput = `Search result: ${secret}`
    await turn.onMessage({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'search-1', name: 'WebSearch', input: { query: 'game sprites' } },
    ] } })
    await turn.onMessage({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'search-1', content: nativeOutput },
    ] } })
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
  } }) }, root, () => ({ BRAVE_SEARCH_API_KEY: secret }))
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
      await input.onMessage({ type: 'result', subtype: 'success', result: 'Fixture finished' })
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
