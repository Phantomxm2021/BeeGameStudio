import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { BeeGameSessionManager, type DashboardPermissionDecision } from '../src/beegame/session-manager'
import { openProjectPermissionConsole } from './native-permission-console'

test.each(['allow', 'deny'] as const)('console returns an explicit %s while project-local working files remain auto-allowed', async behavior => {
  const root = await mkdtemp(join(tmpdir(), 'permission-console-'))
  const workspace = join(root, 'game'), stdin = new PassThrough()
  const decisions: DashboardPermissionDecision[] = [], reports: unknown[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      decisions.push(await start.requestPermission!({ toolUseID: 'local-test', toolName: 'Write',
        input: { file_path: join(workspace, '.beegame/tmp/test.mjs'), content: 'fixture' }, message: 'Fixture' }))
      decisions.push(await start.requestPermission!({ toolUseID: 'outside-test', toolName: 'Write',
        input: { file_path: join(root, 'outside.mjs'), content: 'PRIVATE_INPUT' }, message: 'Fixture' }))
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Decision received' })
    } }
  } }, join(root, 'dashboard'))
  const close = openProjectPermissionConsole({ sessions: manager, userId: 'owner', projectId: 'project',
    workspacePath: workspace, stdin, report: event => reports.push(event) })
  try {
    await mkdir(workspace)
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await manager.send(session.id, 'Fixture permission request')
    for (let i = 0; i < 500 && !manager.pendingPermissionsForProject('owner', 'project', workspace).length; i++) await Bun.sleep(2)
    expect(decisions).toEqual([{ behavior: 'allow', source: 'policy', scope: 'once' }])
    expect(manager.pendingPermissionsForProject('owner', 'project', workspace)).toHaveLength(1)
    stdin.write('not JSON\n')
    stdin.write(JSON.stringify({ sessionId: session.id, toolUseID: 'outside-test', behavior: ['allow'] }) + '\n')
    stdin.write(JSON.stringify({ sessionId: 'another-session', toolUseID: 'outside-test', behavior: 'allow' }) + '\n')
    expect(decisions).toHaveLength(1)
    expect(manager.pendingPermissionsForProject('owner', 'project', workspace)).toHaveLength(1)
    stdin.write(JSON.stringify({ sessionId: session.id, toolUseID: 'outside-test', behavior, message: 'PRIVATE_DECISION' }) + '\n')
    await manager.waitForSessionIdle(session.id)
    expect(decisions[1]).toEqual({ behavior, source: 'user', scope: 'once', message: 'PRIVATE_DECISION' })
    expect(manager.pendingPermissionsForProject('owner', 'project', workspace)).toHaveLength(0)
    expect(manager.events(session.id).some(e => e.type === 'turn.completed')).toBe(true)
    stdin.write(JSON.stringify({ sessionId: session.id, toolUseID: 'outside-test', behavior }) + '\n')
    expect(reports.filter((e: any) => e.event === 'permission_resolved')).toHaveLength(1)
    expect(reports.filter((e: any) => e.event === 'permission_input_error')).toHaveLength(4)
    expect(JSON.stringify(reports)).not.toContain('PRIVATE_')
  } finally { close(); stdin.destroy(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('closing console input does not invent a permission decision', () => {
  const stdin = new PassThrough(), reports: unknown[] = []
  let resolutions = 0
  const close = openProjectPermissionConsole({ sessions: {
    pendingPermissionsForProject: () => [], resolvePermission: () => { resolutions++; return { resolved: true } },
  }, userId: 'owner', projectId: 'project', workspacePath: '/fixture', stdin, report: e => reports.push(e) })
  close(); stdin.destroy()
  expect(resolutions).toBe(0)
  expect(reports).toEqual([{ event: 'permission_console_closed' }])
})
