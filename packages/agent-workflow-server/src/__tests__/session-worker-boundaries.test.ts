import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, readWorkflowWorkerChatHistoryFromDisk, type BeeGameEvent } from '../beegame/session-manager'
import { nativeSessionTemporaryPath } from '../beegame/native-runtime-process-path'
import { ProjectChatTimeline } from '../beegame/project-chat-timeline'

for (const workflowWorker of [true, false]) {
  test(`${workflowWorker ? 'worker' : 'conversation'} must not auto-approve native shell escalation`, async () => {
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
      const session = manager.start({ ...shared, workflowWorker, workflowWorkerType: 'implementation-worker' })
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
}

test('service disposal records shutdown and resolves pending approval as policy, not user rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-host-shutdown-'))
  let reason: unknown
  let decision: unknown
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(input) {
    input.signal.addEventListener('abort', () => { reason = input.signal.reason }, { once: true })
    decision = await input.requestPermission({ toolUseID: 'pending', toolName: 'Bash', input: { command: 'native permission fixture' }, message: 'Approve?' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project', workflowWorker: true })
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

test('scoped workers can write nested scratch files, not protected files or symlink escapes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-worker-boundary-')))
  const workspace = join(root, 'workspace')
  const decisions: string[] = []
  const manager = new BeeGameSessionManager({ start: async start => ({
    stop() {},
    async submit(input) {
      const scratch = nativeSessionTemporaryPath(start.cwd, start.sessionId)
      await mkdir(scratch, { recursive: true })
      await symlink(root, join(scratch, 'escape'))
      for (const path of [join(scratch, 'nested', 'probe.txt'), join(workspace, 'content', 'scene.json'),
        join(workspace, 'assets', 'protected.png'), join(scratch, 'escape', 'outside.txt'),
        join(workspace, '.beegame', 'tmp', 'another-session', 'probe.txt')]) {
        decisions.push((await input.requestPermission({ toolUseID: path, toolName: 'Write',
          input: { file_path: path, content: 'test' }, message: 'Write test fixture' })).behavior)
      }
      await input.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    },
  }) }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'offline', projectId: 'test',
      workflowWorker: true, workflowWorkerType: 'content-author', workflowAllowedPaths: ['content/'],
      workflowProtectedPaths: ['assets/'] })
    await manager.sendWithDisplay(session.id, 'Offline fixture')
    for (let i = 0; i < 200 && manager.get(session.id)?.turnStatus !== 'idle'; i++)
      await new Promise(resolve => setTimeout(resolve, 5))
    expect(decisions).toEqual(['allow', 'allow', 'deny', 'deny', 'deny'])
  } finally { manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('live worker completion and stop are mirrored with source identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-worker-terminal-'))
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(input) {
    await input.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
  } }) }, root)
  try {
    const shared = { workspacePath: join(root, 'workspace'), userId: 'offline', projectId: 'test' }
    const main = manager.start(shared)
    const live: BeeGameEvent[] = []
    const unsubscribe = manager.subscribeProjectEvents(shared, event => { live.push(event) })
    const worker = manager.start({ ...shared, workflowWorker: true, workflowWorkerType: 'implementation-worker' })
    expect(manager.events(worker.id)[0]?.payload).toMatchObject({ workflowWorker: true, workflowWorkerType: 'implementation-worker' })
    await manager.sendWithDisplay(worker.id, 'Fix only this bug', { displayKind: 'workflow_worker' })
    for (let i = 0; i < 200 && manager.get(worker.id)?.turnStatus !== 'idle'; i++)
      await new Promise(resolve => setTimeout(resolve, 5))
    manager.stop(worker.id)
    const events = manager.events(main.id)
    expect(events.find(event => event.type === 'turn.completed')?.payload).toMatchObject({ workflowSourceSessionId: worker.id })
    expect(events.find(event => event.type === 'session.stopped')?.payload).toMatchObject({ workflowSourceSessionId: worker.id })
    const timeline = new ProjectChatTimeline(join(root, 'timeline.jsonl'))
    const canonical = await timeline.append(events)
    expect(canonical.find(event => event.type === 'turn.completed')?.sessionId).toBe(worker.id)
    expect(canonical.find(event => event.type === 'turn.completed')?.turnId).toBeTruthy()
    expect(live.filter(event => event.type === 'user.message')).toHaveLength(0)
    expect(manager.transcript(worker.id).some(event => event.type === 'user.message')).toBe(true)
    expect(live.some(event => event.type === 'turn.completed')).toBe(true)
    unsubscribe()
  } finally { manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('history recovers worker terminals and prompt-independent metadata without duplicating mirrors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-worker-history-'))
  const event = (id: number, sessionId: string, type: BeeGameEvent['type'], text = '', payload?: BeeGameEvent['payload']): BeeGameEvent =>
    ({ id, sessionId, turnId: `${sessionId}-turn`, type, text, payload, createdAt: new Date(1000 + id) })
  try {
    await mkdir(join(root, 'transcripts'))
    const modern = [event(1, 'modern', 'session.started', '', { type: 'session.started', workflowWorker: true, workflowWorkerType: 'implementation-worker' }),
      event(2, 'modern', 'turn.started', 'Fix this small bug'), event(3, 'modern', 'tool.started'), event(4, 'modern', 'turn.failed')]
    const legacy = [event(1, 'legacy', 'turn.started', 'BeeGame delivery worker: content-author'),
      event(2, 'legacy', 'tool.started'), event(3, 'legacy', 'session.stopped')]
    const unrelated = [event(1, 'unrelated', 'session.started'), event(2, 'unrelated', 'turn.completed')]
    for (const [name, events] of [['modern', modern], ['legacy', legacy], ['unrelated', unrelated]] as const)
      await writeFile(join(root, 'transcripts', `${name}.jsonl`), events.map(e => JSON.stringify(e)).join('\n') + '\n')
    const mirrored = event(20, 'main', 'tool.started', '', { type: 'tool.started', workflowSourceSessionId: 'modern', workflowSourceEventId: 3 })
    const recovered = await readWorkflowWorkerChatHistoryFromDisk(root, 'main', [mirrored])
    expect(recovered.map(e => `${e.sessionId}:${e.type}`)).toEqual(['legacy:tool.started', 'legacy:session.stopped', 'modern:turn.failed'])
    expect(recovered.at(-1)?.payload?.workflowWorkerType).toBe('implementation-worker')
  } finally { await rm(root, { recursive: true, force: true }) }
})
