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
    const emit = (event: Record<string, unknown>) => onMessage({ type: 'stream_event', event })
    await emit({ type: 'message_start', message: { id: 'parent-message' } })
    await emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    await emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Parent ' } })
    await onMessage({ type: 'assistant', parent_tool_use_id: 'child-owner', message: {
      id: 'child-message', content: [{ type: 'text', text: 'Child only' }],
    } })
    await onMessage({ type: 'stream_event', parent_tool_use_id: 'child-owner', event: {
      type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'child-read', name: 'Read' },
    } })
    await onMessage({ type: 'tool_progress', parent_tool_use_id: 'child-owner', tool_use_id: 'child-bash',
      tool_name: 'Bash', elapsed_time_seconds: 120 })
    await onMessage({ type: 'system', subtype: 'compact_boundary', parent_tool_use_id: 'child-owner',
      compact_metadata: { trigger: 'auto', pre_tokens: 120000 } })
    await emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } })
    await onMessage({ type: 'assistant', message: { id: 'parent-message', content: [{ type: 'text', text: 'Parent answer' }] } })
    await onMessage({ type: 'result', subtype: 'success', result: 'Done' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'child-test', userId: 'test' })
    await manager.send(session.id, 'Offline fixture')
    for (let n = 0; n < 200 && !manager.events(session.id).some(e => e.type === 'result'); n++) await Bun.sleep(5)
    const events = manager.events(session.id)
    const child = events.find(e => e.text === 'Child only')!
    expect(child.payload).toMatchObject({ parent_tool_use_id: 'child-owner', message: { id: 'child-message' } })
    expect(child.payload).not.toHaveProperty('assistantBlockId')
    expect(events.find(e => e.text === 'Read input streaming')?.payload).toHaveProperty('parentToolUseID', 'child-owner')
    expect(events.find(e => e.type === 'tool.progress' && e.payload?.toolUseID === 'child-bash')?.payload)
      .toMatchObject({ toolName: 'Bash', elapsed_time_seconds: 120, parentToolUseID: 'child-owner' })
    expect(events.find(e => e.payload?.subtype === 'compact_boundary')?.payload)
      .toMatchObject({ parent_tool_use_id: 'child-owner', compact_metadata: { pre_tokens: 120000 } })
    const parent = events.filter(e => e.type === 'assistant.partial')
    expect(parent.map(e => e.text)).toEqual(['Parent ', 'answer'])
    expect(new Set(parent.map(e => e.payload?.assistantBlockId)).size).toBe(1)
    expect(events.find(e => e.text === 'Parent answer')?.payload?.assistantBlockId).toBe(parent[0]!.payload?.assistantBlockId)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('child permission records retain owner and close on allow, deny and cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-child-approval-'))
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    await turn.onMessage({ type: 'system', subtype: 'task_started', task_id: 'native-child', tool_use_id: 'child-owner', task_type: 'local_agent' })
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
