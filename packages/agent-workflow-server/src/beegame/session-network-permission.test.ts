import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type DashboardPermissionDecision } from './session-manager'

test('a session network approval covers only the same host in the live session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-network-permission-'))
  const decisions: DashboardPermissionDecision[] = []
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    for (const [toolUseID, host] of [['first', 'registry.npmjs.org'], ['same', 'registry.npmjs.org'], ['other', 'example.org']]) {
      decisions.push(await turn.requestPermission({ toolUseID, toolName: 'SandboxNetworkAccess',
        input: { host }, message: `${host} requires permission` }))
    }
    await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Done' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline network permission fixture')
    for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++) await Bun.sleep(5)
    manager.resolvePermission(session.id, 'first', { behavior: 'allow', scope: 'session' })
    for (let i = 0; i < 200 && decisions.length < 2; i++) await Bun.sleep(5)
    expect(decisions).toHaveLength(2)
    expect(decisions[1]).toMatchObject({ behavior: 'allow', scope: 'session' })
    expect(manager.pendingPermissionsForProject('owner', 'project', root).map(request => request.toolUseID)).toEqual(['other'])
    manager.resolvePermission(session.id, 'other', { behavior: 'deny' })
    for (let i = 0; i < 200 && decisions.length < 3; i++) await Bun.sleep(5)
    expect(decisions[2]).toMatchObject({ behavior: 'deny' })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
