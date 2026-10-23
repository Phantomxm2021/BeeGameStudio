import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager } from './session-manager'

test('BGS child events track active work and close only the matching child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-child-lifecycle-'))
  const manager = new BeeGameSessionManager({ start: async options => ({ reusable: false, stop() {}, async submit(turn) {
    const notify = (childThreadId: string, childStatus: string) => turn.onMessage({
      type: 'runtime_event', runtime: 'bgs', eventType: 'system.status',
      childThreadId, childStatus, parentToolUseID: childThreadId + '-tool',
    })
    await notify('first', 'pendingInit')
    await notify('other', 'running')
    expect(manager.runtimeSnapshot(options.sessionId)?.activeSubagentToolUseIds).toEqual(['first-tool', 'other-tool'])
    await notify('first', 'running')
    await notify('first', 'completed')
    expect(manager.runtimeSnapshot(options.sessionId)?.activeSubagentToolUseIds).toEqual(['other-tool'])
    await notify('other', 'errored')
    expect(manager.runtimeSnapshot(options.sessionId)?.activeSubagentToolUseIds).toEqual([])
    await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Done' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'child-test', userId: 'test' })
    await manager.send(session.id, 'Offline fixture')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id)?.activeSubagentToolUseIds).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('child messages and input streams preserve ownership without consuming the parent text cursor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-child-events-'))
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit({ onMessage }) {
    await onMessage({ type: 'runtime_event', eventType: 'assistant.partial', text: 'Parent ', assistantBlockId: 'parent-message' })
    await onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: 'Child only',
      parentToolUseID: 'child-owner', assistantBlockId: 'child-message' })
    await onMessage({ type: 'runtime_event', eventType: 'tool.started', text: 'Read',
      parentToolUseID: 'child-owner', toolUseID: 'child-read', toolName: 'Read' })
    await onMessage({ type: 'runtime_event', eventType: 'tool.progress', text: 'Working',
      parentToolUseID: 'child-owner', toolUseID: 'child-shell', toolName: 'Shell' })
    await onMessage({ type: 'runtime_event', eventType: 'system.status', text: 'Context compacted',
      subtype: 'compact_boundary' })
    await onMessage({ type: 'runtime_event', eventType: 'assistant.partial', text: 'answer', assistantBlockId: 'parent-message' })
    await onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: '.', assistantBlockId: 'parent-message' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'child-test', userId: 'test' })
    await manager.send(session.id, 'Offline fixture')
    await manager.waitForSessionIdle(session.id)
    const events = manager.events(session.id)
    const child = events.find(e => e.text === 'Child only')!
    expect(child.payload).toMatchObject({ parentToolUseID: 'child-owner', assistantBlockId: 'child-message' })
    expect(events.find(e => e.payload?.toolUseID === 'child-read')?.payload).toHaveProperty('parentToolUseID', 'child-owner')
    expect(events.find(e => e.type === 'tool.progress')?.payload)
      .toMatchObject({ toolName: 'Shell', parentToolUseID: 'child-owner' })
    expect(events.find(e => e.payload?.subtype === 'compact_boundary')?.text).toBe('Context compacted')
    const parent = events.filter(e => e.type === 'assistant.partial')
    expect(parent.map(e => e.text)).toEqual(['Parent ', 'answer'])
    expect(new Set(parent.map(e => e.payload?.assistantBlockId)).size).toBe(1)
    expect(events.find(e => e.text === '.')?.payload?.assistantBlockId).toBe(parent[0]!.payload?.assistantBlockId)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('child permission records retain owner and close on allow, deny and cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-child-approval-'))
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    await turn.onMessage({ type: 'runtime_event', eventType: 'system.status', childThreadId: 'native-child', childStatus: 'running', parentToolUseID: 'child-owner' })
    for (const toolUseID of ['allowed', 'denied', 'cancelled']) await turn.requestPermission({
      toolUseID, agentId: 'native-child', toolName: 'Bash', input: { command: 'bun test' }, message: 'Approval reason',
    })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'child-test', userId: 'test' })
    await manager.send(session.id, 'Offline fixture')
    for (const [id, behavior] of [['allowed', 'allow'], ['denied', 'deny']] as const) {
      for (let n = 0; n < 200 && !manager.pendingPermissionsForProject('test', 'child-test', join(root, 'workspace')).some(p => p.toolUseID === id); n++) await Bun.sleep(5)
      manager.resolvePermission(session.id, id, { behavior })
    }
    for (let n = 0; n < 200 && !manager.events(session.id).some(e => e.type === 'permission.requested' && e.payload?.toolUseID === 'cancelled'); n++) await Bun.sleep(5)
    manager.stop(session.id)
    const approvals = manager.events(session.id).filter(e => e.type.startsWith('permission.'))
    expect(approvals).toHaveLength(6)
    expect(approvals.every(e => e.payload?.parentToolUseID === 'child-owner')).toBe(true)
    expect(approvals.filter(e => e.type === 'permission.resolved').map(e => e.payload?.decision)).toEqual(['allow', 'deny', 'cancelled'])
    expect(manager.pendingPermissionsForProject('test', 'child-test', join(root, 'workspace'))).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
