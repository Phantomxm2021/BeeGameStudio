import { describe, expect, it, vi } from 'vitest'
import type { ProjectEventMessage } from '../types/message'
import type { BeeGameEvent } from './beeGameEvent'
import { decodeArtifactId, encodeArtifactId } from './beeGameArtifactPaths'
import { projectEventMessages, projectHistoryMessages } from './beeGameChatProjection'

// Importing the projector must not pull authentication or transport into a
// replay-only consumer. These factories fail if that boundary is crossed.
vi.mock('./apiClient', () => { throw new Error('Projection must not import HTTP transport') })
vi.mock('./supabaseAuthApi', () => { throw new Error('Projection must not import authentication') })

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}

const event = (overrides: Partial<BeeGameEvent> = {}): BeeGameEvent => ({
  id: 1, sessionId: 'main', turnId: 'turn-a', type: 'assistant.partial', text: 'Hello',
  createdAt: '2026-10-15T00:00:01.000Z', ...overrides,
})

const message = (type: ProjectEventMessage['type'], overrides: Partial<ProjectEventMessage> = {}): ProjectEventMessage => ({
  type, project_id: 'project-a', task_id: 'main', turnId: 'turn-a',
  sender: 'beegame', timestamp: 1000, ...overrides,
})

describe('standalone chat projection', () => {
  it.each(['agent_goal_settled', 'agent_message_resume'])('does not present internal %s cleanup as a task stop', reason => {
    const stopped = frozen(event({ type: 'session.stopped', payload: { type: 'session.stopped', reason } }));
    expect(projectEventMessages('project-a', stopped)).toEqual([]);
    expect(stopped.payload?.reason).toBe(reason);
  });

  it.each(['user_pause', 'user_stop', undefined])('preserves a real or legacy stop with reason %s', reason => {
    const stopped = event({ type: 'session.stopped', payload: { type: 'session.stopped', reason } });
    const messages = projectEventMessages('project-a', stopped);
    expect(messages)
      .toContainEqual(expect.objectContaining({ type: 'status', status: 'stopped' }));
    expect(messages).toContainEqual(expect.objectContaining({ type: 'context_update',
      task_kind: 'session_lifecycle', content: 'stopped' }));
    expect(projectHistoryMessages(messages, new Map())).toContainEqual(expect.objectContaining({
      taskKind: 'session_lifecycle', content: 'stopped' }));
  });

  it('keeps failure identity and error presentation identical in live output and history', () => {
    const [failure] = projectEventMessages('project-a', event({ type: 'turn.failed', text: 'API Error: Connection error.' }));
    expect(failure).toMatchObject({ type: 'error', message_id: 'beegame-failure-main-turn-a',
      task_kind: 'runtime_error', turnId: 'turn-a' });
    expect(projectHistoryMessages([failure], new Map())).toEqual([expect.objectContaining({
      id: failure.message_id, type: 'error', taskKind: 'runtime_error', turnId: 'turn-a',
    })]);
    expect(projectEventMessages('project-a', event({ type: 'assistant.message', text: 'API Error: Connection error.',
      payload: { type: 'assistant', error: 'api_error' } }))).toEqual([]);
  });

  it('uses explicit display text without reading storage and preserves user acknowledgement and ownership', () => {
    const input = frozen(event({ type: 'user.message', text: 'transport payload', payload: {
      type: 'user.message', clientMessageId: 'client-1', supersedesMessageId: 'client-old',
      rewindAvailable: true, parentToolUseID: 'worker', sourceSequence: 17,
    } }))
    const readStorage = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Projection must not read display-text caches')
    })
    try {
      expect(projectEventMessages('project-a', input, '', 'Visible idea')).toEqual([
        expect.objectContaining({ content: 'Visible idea', message_id: 'client-1', client_message_id: 'client-1',
          supersedes_message_id: 'client-old', rewind_available: true, sender: 'user',
          todoScope: JSON.stringify(['main', 'worker']), sequence: 17,
          timestamp: Date.parse(input.createdAt) }),
      ])
      expect(readStorage).not.toHaveBeenCalled()
      expect(input.text).toBe('transport payload')
    } finally {
      readStorage.mockRestore()
    }
  })

  it('preserves one assistant block identity across live and final events, scoped to the original worker', () => {
    const payload = frozen({ type: 'assistant', assistantBlockId: 'block-1', parent_tool_use_id: 'worker' })
    const [partial] = projectEventMessages('project-a', event({ payload }))
    const [final] = projectEventMessages('project-a', event({ id: 2, type: 'assistant.message', payload }))
    expect(partial.message_id).toBe('beegame-block-block-1:subagent:worker')
    expect(final.message_id).toBe(partial.message_id)
    expect(partial.type).toBe('token')
    expect(final.type).toBe('agent_message')
  })

  it('passes the explicit fallback clock through recursive background-task projection', () => {
    const input = frozen(event({ type: 'system.status', createdAt: 'invalid', payload: {
      type: 'system.status', subtype: 'task_notification', status: 'completed',
      toolUseID: 'task-9', task_type: 'local_bash', summary: 'Exit 0',
    } }))
    expect(projectEventMessages('project-a', input, '', undefined, () => 9000)).toEqual([
      expect.objectContaining({ type: 'tool_end', tool_status: 'completed',
        tool_output: 'Exit 0', timestamp: 9000, message_id: 'beegame-tool-main-task-9' }),
    ])
  })

  it('preserves structured patches, artifact identity and attachments without changing the raw event', () => {
    const input = frozen(event({ type: 'tool.completed', payload: {
      type: 'tool.completed', toolName: 'Edit', toolUseID: 'edit-1',
      input: { file_path: '/workspace/docs/a:b %.md', old_string: 'before', new_string: 'after' },
      before: 'before', after: 'after', diff: '-before\n+after',
      structuredPatch: [{ oldStart: 1, newStart: 1 }], output: 'Saved',
      attachments: [{ type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' }],
    } }))
    const [projected] = projectEventMessages('project-a', input, '/workspace')
    expect(projected).toMatchObject({ tool_before: 'before', tool_after: 'after', tool_diff: '-before\n+after',
      structured_patch: [{ oldStart: 1, newStart: 1 }], artifact_path: 'docs/a:b %.md',
      attachments: [{ type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' }] })
    expect(decodeArtifactId(projected.artifact_id!)).toEqual({
      projectId: 'project-a', sessionId: 'main', path: '/workspace/docs/a:b %.md',
    })
    expect(input.payload?.input).toEqual({ file_path: '/workspace/docs/a:b %.md', old_string: 'before', new_string: 'after' })
  })

  it('does not turn an unknown event into visible content or a successful terminal state', () => {
    const unknown = event({ type: 'provider.future-event' as BeeGameEvent['type'], text: 'not a completion' })
    expect(projectEventMessages('project-a', unknown)).toEqual([])
  })

  it('assembles a completed Thought from its lifecycle without mutating the projected messages', () => {
    const input = frozen([
      message('think_start', { message_id: 'thought-1', timestamp: 10 }),
      message('thought', { message_id: 'thought-1', timestamp: 20, content: 'A', content_mode: 'delta' }),
      message('thought', { message_id: 'thought-1', timestamp: 30, content: 'AB', content_mode: 'snapshot' }),
      message('think_end', { message_id: 'thought-1', timestamp: 100, thinking_duration_ms: 90 }),
    ])
    expect(projectHistoryMessages(input, new Map())).toEqual([
      expect.objectContaining({ id: 'thought-1', content: 'AB', timestamp: 10,
        thinkingDurationMs: 90, type: 'thought', streamStatus: 'complete' }),
    ])
    expect(input[1]).toMatchObject({ content: 'A', timestamp: 20 })
    expect(input[1].thinking_duration_ms).toBeUndefined()
  })

  it('merges tool and compaction updates in first-appearance order without overwriting their source messages', () => {
    const input = frozen([
      message('tool_start', { message_id: 'tool-1', timestamp: 10, sequence: 1, tool_status: 'running' }),
      message('context_compaction', { message_id: 'compact-1', timestamp: 20, status: 'running' }),
      message('tool_end', { message_id: 'tool-1', timestamp: 30, sequence: 3, tool_status: 'completed', tool_output: 'Done' }),
      message('context_compaction', { message_id: 'compact-1', timestamp: 40, status: 'finished', content: 'compacted' }),
    ])
    expect(projectHistoryMessages(input, new Map([['turn-a', 50]]))).toEqual([
      expect.objectContaining({ id: 'tool-1', timestamp: 10, sequence: 1, toolStatus: 'completed', toolOutput: 'Done', turnCompletedAt: 50 }),
      expect.objectContaining({ id: 'compact-1', timestamp: 20, content: 'compacted', streamStatus: 'complete' }),
    ])
    expect(input[0].tool_status).toBe('running')
    expect(input[1].status).toBe('running')
  })

  it('settles only the stopped turn and excludes billing and child-approval notifications from history', () => {
    const input = frozen([
      message('token', { message_id: 'reply-a', timestamp: 10, content: 'Partial' }),
      message('tool_start', { task_id: 'other-session', turnId: 'turn-b', message_id: 'tool-b', tool_status: 'running', timestamp: 20 }),
      message('status', { status: 'stopped', timestamp: 30 }),
      message('billing_update', { message_id: 'billing-only', timestamp: 40 }),
      message('human_gate', { message_id: 'child-approval', task_kind: 'subagent_permission_request', timestamp: 50 }),
    ])
    const output = projectHistoryMessages(input, new Map(), () => 9000)
    expect(output).toContainEqual(expect.objectContaining({ id: 'reply-a', streamStatus: 'complete', completionReason: 'stopped' }))
    expect(output).toContainEqual(expect.objectContaining({ id: 'tool-b', toolStatus: 'running' }))
    expect(output).not.toContainEqual(expect.objectContaining({ id: 'billing-only' }))
    expect(output).not.toContainEqual(expect.objectContaining({ id: 'child-approval' }))
  })

  it('uses the supplied fallback clock for history identities and timestamps', () => {
    const input = frozen([message('agent_message', { timestamp: undefined, content: 'Untimed' })])
    expect(projectHistoryMessages(input, new Map(), () => 1234)).toEqual([
      expect.objectContaining({ id: 'agent_message-main-1234', timestamp: 1234, content: 'Untimed' }),
    ])
    expect(input[0].timestamp).toBeUndefined()
  })

  it('retains both session-aware and legacy artifact identities', () => {
    expect(decodeArtifactId(encodeArtifactId('project:1', 'session:2', 'docs/a:b %.md'))).toEqual({
      projectId: 'project:1', sessionId: 'session:2', path: 'docs/a:b %.md',
    })
    expect(decodeArtifactId(encodeArtifactId('project:1', undefined, 'docs/a:b %.md'))).toEqual({
      projectId: 'project:1', path: 'docs/a:b %.md',
    })
    expect(decodeArtifactId('not-an-artifact')).toBeNull()
  })
})
