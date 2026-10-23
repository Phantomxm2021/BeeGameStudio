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
  it.each([0, 120])('preserves incomplete usage when projecting receipts with %i known tokens', total => {
    const usage = { prompt_tokens: total, completion_tokens: 0, total_tokens: total };
    const [live] = projectEventMessages('project-a', event({ type: 'usage', payload: {
      usage, sessionUsage: usage, providerUsageIncomplete: true,
    } }));
    expect(live.usage).toMatchObject({ total_tokens: total, providerUsageIncomplete: true });
  });
  it.each(['tool.progress', 'tool.completed', 'tool.failed'])('preserves structured %s results in live and restored Chat', type => {
    for (const output of [[{ type: 'inputText', text: 'Design remains locked' }], { answers: ['A'], tasks: [{ status: 'unverified' }] }]) {
      const [live] = projectEventMessages('project-a', frozen(event({ type: type as BeeGameEvent['type'], text: 'FixtureTool',
        payload: { toolName: 'FixtureTool', toolUseID: 'result-1', input: {}, output } })))
      expect(JSON.parse(live.tool_output!)).toEqual(output)
      expect(projectHistoryMessages([live], new Map())[0].toolOutput).toBe(live.tool_output)
    }
  })
  it('uses the server session total across native epochs and preserves legacy usage projection', () => {
    const usage = { prompt_tokens: 10, completion_tokens: 2, cache_read_tokens: 100, cache_creation_tokens: 0, total_tokens: 112 };
    const sessionUsage = { ...usage, prompt_tokens: 30, cache_read_tokens: 300, total_tokens: 332 };
    expect(projectEventMessages('project-a', event({ type: 'usage', payload: { usage, sessionUsage } }))[0]).toMatchObject({ type: 'usage', usage: sessionUsage });
    expect(projectEventMessages('project-a', event({ type: 'usage', payload: { usage } }))[0]).toMatchObject({ type: 'usage', usage });
  });
  it('shows a parameterless tool from its original start time through completion', () => {
    const start = event({ type: 'tool.started', payload: { toolName: 'ReadImplementationTask', toolUseID: 'read-task', input: {} } })
    const end = event({ id: 2, type: 'tool.completed', createdAt: '2026-10-15T00:00:03.000Z', payload: { ...start.payload, output: 'Done' } })
    const [live] = projectEventMessages('project-a', start)
    expect(live).toMatchObject({ type: 'tool_start', tool_status: 'running', tool_input: {}, timestamp: Date.parse(start.createdAt) })
    const history = projectHistoryMessages([...projectEventMessages('project-a', start), ...projectEventMessages('project-a', end)], new Map())
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ toolStatus: 'completed', timestamp: Date.parse(start.createdAt) })
  })
  it.each(['bgs', 'codex'])('projects %s compaction status in live and restored Chat', runtime => {
    const start = event({ type: 'system.status', payload: { runtime, status: 'compacting' } })
    const end = event({ id: 2, type: 'system.status', createdAt: '2026-10-15T00:00:32.000Z', payload: { runtime, status: 'compacted' } })
    const [live] = projectEventMessages('project-a', start), [done] = projectEventMessages('project-a', end)
    expect(live).toMatchObject({ type: 'context_compaction', status: 'running' })
    expect(done).toMatchObject({ type: 'context_compaction', status: 'finished', message_id: live.message_id })
    const history = projectHistoryMessages([live, done], new Map())
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ taskKind: 'context_compaction', streamStatus: 'complete', timestamp: Date.parse(start.createdAt) })
  })
  it.each(['tool.progress', 'tool.completed'])('keeps the full %s output for inline expansion, copying and history', type => {
    const output = 'Long fixture output\n'.repeat(30) + 'ORIGINAL_OUTPUT_END';
    const [live] = projectEventMessages('project-a', event({ type: type as BeeGameEvent['type'], payload: {
      toolName: 'Shell', toolUseID: 'long-output', input: { command: 'bun run build' }, output,
    } }));
    expect(live.tool_output).toBe(output);
    expect(live.content).not.toContain('ORIGINAL_OUTPUT_END');
    expect(projectHistoryMessages([live], new Map())[0].toolOutput).toBe(output);
  });
  it('restores explicit and legacy native file diffs without classifying shell output as a file edit', () => {
    const diff = '--- a/src/Example.ts\n+++ b/src/Example.ts\n@@ -11 +11 @@\n-old\n+new\n';
    for (const payload of [
      { toolName: 'Edit', diff, output: diff },
      { runtime: 'bgs', toolName: 'Edit', output: diff },
      { runtime: 'codex', toolName: 'Edit', output: diff },
    ]) {
      const [live] = projectEventMessages('project-a', event({ type: 'tool.completed', payload: {
        type: 'runtime_event', toolUseID: 'edit-one', input: { file_path: 'src/Example.ts' }, ...payload,
      } }));
      expect(live).toMatchObject({ tool_diff: diff });
      expect(projectHistoryMessages([live], new Map())[0]).toMatchObject({ toolDiff: diff });
    }
    const [shell] = projectEventMessages('project-a', event({ type: 'tool.completed', payload: {
      runtime: 'bgs', toolName: 'Shell', input: { command: 'git diff' }, output: diff,
    } }));
    expect(shell.tool_diff).toBeUndefined();
  });
  it('preserves native command metrics and errors through both live messages and restored display history', async () => {
    const { normalizeChatHistory } = await import('../utils/chatHistory');
    const { toChatDisplayMessages } = await import('../viewModels/displayModels');
    for (const exitCode of [0, 2]) {
      const [live] = projectEventMessages('project-a', event({ type: 'tool.completed', text: 'Shell', payload: {
        type: 'runtime_event', toolName: 'Shell', toolUseID: 'native-command', input: { command: 'bun run build' },
        output: 'Synthetic output', exitCode, durationMs: 1200,
      } }));
      expect(live).toMatchObject({ tool_status: exitCode ? 'failed' : 'completed', tool_exit_code: exitCode, tool_duration_ms: 1200 });
      const [display] = toChatDisplayMessages(normalizeChatHistory(projectHistoryMessages([live], new Map())));
      expect(display).toMatchObject({ toolStatus: live.tool_status, toolExitCode: exitCode, toolDurationMs: 1200,
        toolInput: { command: 'bun run build' } });
    }
  });
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

 it.each(['turn.failed', 'session.stopped'] as const)('retains the %s terminal time for restored partial activity', type => {
  const partial = message('tool_start', { tool: 'Shell', tool_use_id: 'partial-tool', tool_status: 'running', timestamp: 100 });
  const terminal = projectEventMessages('project-a', event({ type, createdAt: new Date(5000).toISOString() }));
  const history = projectHistoryMessages([partial, ...terminal], new Map());
  expect(history.find(item => item.toolUseId === 'partial-tool')).toMatchObject({
    turnCompletedAt: 5000, toolStatus: 'failed', completionReason: type === 'turn.failed' ? 'failed' : 'stopped',
  });
});
