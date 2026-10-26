import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type DashboardPermissionDecision } from './session-manager'

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 200 && !predicate(); index += 1) await Bun.sleep(5)
  expect(predicate(), message).toBe(true)
}

test('cancelling one native permission signal preserves another and closes its approval lifecycle', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-session-permission-cancel-')))
  const firstSignal = new AbortController()
  const secondSignal = new AbortController()
  const alreadyAborted = new AbortController()
  alreadyAborted.abort('already cancelled')
  let ready = false
  let firstDecision: DashboardPermissionDecision | undefined
  let secondDecision: DashboardPermissionDecision | undefined
  let preAbortedDecision: DashboardPermissionDecision | undefined
  const manager = new BeeGameSessionManager({ start: async () => ({
    stop() {},
    async submit(turn) {
      const first = turn.requestPermission({ toolUseID: 'first', toolName: 'Bash', input: { command: 'first' }, message: 'First approval', signal: firstSignal.signal })
      const second = turn.requestPermission({ toolUseID: 'second', toolName: 'Bash', input: { command: 'second' }, message: 'Second approval', signal: secondSignal.signal })
      first.then(value => { firstDecision = value })
      second.then(value => { secondDecision = value })
      preAbortedDecision = await turn.requestPermission({ toolUseID: 'pre-aborted', toolName: 'Bash', input: { command: 'pre-aborted' }, message: 'Already cancelled', signal: alreadyAborted.signal })
      ready = true
      await Promise.all([first, second])
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Permission fixture complete' })
    },
  }) }, root)

  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'permission-fixture' })
    const send = manager.sendWithDisplay(session.id, 'Offline permission cancellation fixture')
    await waitFor(() => ready && manager.pendingPermissionsForProject('owner', 'permission-fixture', root).length === 2,
      'both live permission waits should be pending before cancellation')

    expect(preAbortedDecision).toMatchObject({ behavior: 'deny', source: 'policy' })
    expect(manager.events(session.id).filter(event => event.type === 'permission.requested')
      .map(event => event.payload?.toolUseID)).not.toContain('pre-aborted')
    expect(manager.pendingPermissionsForProject('owner', 'permission-fixture', root)
      .map(request => request.toolUseID)).toEqual(['first', 'second'])

    firstSignal.abort('cancel first')
    await waitFor(() => firstDecision !== undefined, 'the cancelled permission should settle independently')
    expect(firstDecision).toMatchObject({ behavior: 'deny', source: 'policy' })
    expect(manager.pendingPermissionsForProject('owner', 'permission-fixture', root)
      .map(request => request.toolUseID)).toEqual(['second'])
    expect(manager.events(session.id).filter(event => event.type === 'permission.resolved')
      .find(event => event.payload?.toolUseID === 'first')?.payload).toMatchObject({ decision: 'cancelled' })
    expect(() => manager.resolvePermission(session.id, 'first', { behavior: 'allow', source: 'user' }))
      .toThrow('Permission request not found')

    manager.resolvePermission(session.id, 'second', { behavior: 'allow', source: 'user' })
    await send
    await manager.waitForSessionIdle(session.id)
    expect(secondDecision).toMatchObject({ behavior: 'allow', source: 'user' })
    expect(manager.pendingPermissionsForProject('owner', 'permission-fixture', root)).toHaveLength(0)

    const resolvedCount = manager.events(session.id).filter(event => event.type === 'permission.resolved').length
    secondSignal.abort('late abort after resolution')
    await Bun.sleep(20)
    expect(manager.events(session.id).filter(event => event.type === 'permission.resolved')).toHaveLength(resolvedCount)
  } finally {
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
