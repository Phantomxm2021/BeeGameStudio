import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./apiClient', () => ({
  authenticatedFetch: vi.fn(),
}))

import { authenticatedFetch } from './apiClient'
import { beeGameAdapter, transcriptEventsToHistory } from './beeGameAdapter'
import { normalizeChatHistory } from '../utils/chatHistory'
import { toChatDisplayMessages } from '../viewModels/displayModels'
import { deriveCurrentProjectTodos } from '../utils/projectTodos'

const authenticatedFetchMock = vi.mocked(authenticatedFetch)

const transcriptResponse = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  sessionId: 'session-1',
  workspacePath: '/workspace',
  events: [],
  page: { hasMore: true, nextBeforeId: 99 },
  ...overrides,
}))

describe('transcriptEventsToHistory', () => {
  it('omits internal worker envelopes but keeps two genuine identical user requests', () => {
    const events = ['project_request', 'workflow_worker', 'project_request'].map((displayKind, index) => ({
      id: index + 1, sessionId: 'main', type: 'user.message', text: '修复按钮',
      createdAt: new Date(1000 + index).toISOString(), payload: { type: 'user.message', displayKind, clientMessageId: `client-${index}` },
    }))
    const history = transcriptEventsToHistory('project', events)
    expect(history).toHaveLength(2)
    expect(history.map(message => message.content)).toEqual(['修复按钮', '修复按钮'])
  })
  const stageThinking = (id: number, status: string, text: string, transport: string) => ({
    id, sessionId: transport, turnId: 'workflow-stage:author:query-1',
    type: 'assistant.thinking' as const, text,
    createdAt: new Date(1000 + id * 1000).toISOString(),
    payload: { type: 'assistant.thinking', status, contentMode: 'snapshot',
      workflowStage: 'author', workflowStageStreamId: 'workflow-stage:author:query-1',
      workflowStageNativeKey: `native-${id}`, projectSourceSessionId: transport,
      thinkingBlockId: 'query-1:message-1:0', thinkingStartedAt: new Date(2000).toISOString() },
  })

  it('joins thinking start, snapshots and end by native block identity, not the transport session', () => {
    const events = [stageThinking(1, 'started', 'Thinking', 'main'),
      stageThinking(2, 'streaming', 'First', 'workflow-stage:author'),
      stageThinking(3, 'streaming', 'First and second', 'main'),
      stageThinking(4, 'ended', 'Thinking', 'workflow-stage:author')]
    const history = transcriptEventsToHistory('p', events) as Record<string, unknown>[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ content: 'First and second', streamStatus: 'complete', thinkingDurationMs: 3000 })
    const child = events.map(e => ({ ...e, id: e.id + 10,
      payload: { ...e.payload, parentToolUseID: 'child-1', workflowStageStreamId: 'workflow-stage:author:query-1:subagent:child-1' } }))
    expect(transcriptEventsToHistory('p', [...events, ...child])).toHaveLength(2)
  })

  it('uses the same thinking identity across separate SSE batches and history replay', async () => {
    const events = [stageThinking(1, 'started', 'Thinking', 'main'),
      stageThinking(2, 'streaming', 'Content', 'workflow-stage:author'),
      stageThinking(3, 'ended', 'Thinking', 'main')]
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`id: ${event.id}\ndata: ${JSON.stringify({ events: [event] })}\n\n`))
      controller.close()
    } })
    authenticatedFetchMock.mockResolvedValueOnce(new Response(body))
    const onMessage = vi.fn()
    await beeGameAdapter.streamMessages('stage-thinking-test', 0, { onMessage, onCursor: vi.fn() }, new AbortController().signal)
    const projected = onMessage.mock.calls.map(([message]) => message)
    expect(projected.map(m => m.type)).toEqual(['think_start', 'thought', 'think_end'])
    expect(new Set(projected.map(m => m.message_id)).size).toBe(1)
    expect(projected.at(-1)).toMatchObject({ thinking_duration_ms: 2000 })
    expect((transcriptEventsToHistory('stage-thinking-test', events)[0] as { id: string }).id).toBe(projected[0].message_id)
  })

  it('preserves client acknowledgements through history without collapsing repeated user text', () => {
    const events = [1, 2].map(id => ({ id, sessionId: 's', type: 'user.message' as const,
      text: 'Again', createdAt: new Date(id * 1000).toISOString(),
      payload: { type: 'user.message', clientMessageId: `client-${id}`, supersedesMessageId: id === 2 ? 'previous-edit' : undefined } }))
    const history = normalizeChatHistory(transcriptEventsToHistory('p', events))
    expect(history).toHaveLength(2)
    expect(history.map(m => m.clientMessageId)).toEqual(['client-1', 'client-2'])
    expect(history[1].supersedesMessageId).toBe('previous-edit')
  })
  it('restores attachment-only turns through every display projection without merging repeated text', () => {
    const attachments = [{ type: 'image', filename: 'scene.png', mediaType: 'image/png',
      storageId: '00000000-0000-0000-0000-000000000000-image.png' }]
    const events = [1, 2].map(id => ({ id, type: 'user.message', sessionId: 's', turnId: `turn-${id}`,
      text: '', createdAt: new Date(id).toISOString(), payload: { type: 'user.message', attachments } }))
    const result = toChatDisplayMessages(normalizeChatHistory(transcriptEventsToHistory('project-1', events)))
    expect(result).toHaveLength(2)
    expect(result[0]?.attachments).toEqual([{ ...attachments[0], projectId: 'project-1' }])
    expect(result[1]?.attachments).toEqual(result[0]?.attachments)
  })
  const nativeEvent = (id: number, type: string, payload: Record<string, unknown>, sessionId = 'worker-1') => ({
    id, type, payload, sessionId, turnId: 'turn-1', text: 'system', createdAt: `2026-09-19T00:00:0${id}.000Z`,
  })
  const launchEvents = () => [
    nativeEvent(1, 'tool.started', { toolName: 'Agent', toolUseID: 'agent-1', input: { description: 'Audit assets', prompt: 'Check manifest' } }),
    nativeEvent(2, 'tool.completed', { toolName: 'Agent', toolUseID: 'agent-1', input: { prompt: 'Check manifest' },
      output: 'Async agent launched successfully.\nagentId: task-1 (internal ID)\noutput_file: /tmp/task-1.output' }),
  ]

  it('keeps asynchronous launch running, not completed, without showing the launch receipt as a result', () => {
    const history = transcriptEventsToHistory('project-1', launchEvents()) as Record<string, unknown>[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ toolStatus: 'running', isSubagentTool: true, subagentPrompt: 'Check manifest' })
    expect(history[0]?.subagentOutput).toBeUndefined()
  })

  it('reconciles mirrored lifecycle, native progress, trace and terminal result into the same subagent card', () => {
    const events = [...launchEvents(),
      nativeEvent(3, 'system.status', { type: 'system', subtype: 'task_progress', task_id: 'task-1', tool_use_id: 'agent-1',
        workflowSourceSessionId: 'worker-1', description: 'Reading manifest', last_tool_name: 'Read',
        usage: { tool_uses: 45, duration_ms: 1083052, total_tokens: 156415 }, subagentTrace: '[read-1] Read manifest.json' }, 'main-chat'),
    ]
    const progress = transcriptEventsToHistory('project-1', events) as Record<string, unknown>[]
    expect(progress).toHaveLength(1)
    expect(progress[0]).toMatchObject({ toolStatus: 'running', subagentPrompt: 'Check manifest' })
    expect(progress[0]?.subagentTrace).toContain('45 tools')
    expect(progress[0]?.subagentTrace).toContain('[read-1] Read')
    events.push(nativeEvent(4, 'turn.completed', {}), nativeEvent(5, 'system.status', {
      type: 'system', subtype: 'task_notification', tool_use_id: 'agent-1', status: 'completed', summary: 'All assets checked',
    }))
    const history = transcriptEventsToHistory('project-1', events) as Record<string, unknown>[]
    const card = history.find(message => message.isSubagentTool)
    expect(history.filter(message => message.isSubagentTool)).toHaveLength(1)
    expect(card).toMatchObject({ toolStatus: 'completed', subagentOutput: 'All assets checked', subagentPrompt: 'Check manifest' })
    expect(card?.subagentTrace).toContain('[read-1] Read')
  })

  it.each(['failed', 'stopped', 'killed'])('retains %s background task outcomes after foreground completion', status => {
    const history = transcriptEventsToHistory('project-1', [...launchEvents(), nativeEvent(3, 'turn.completed', {}),
      nativeEvent(4, 'system.status', { type: 'system', subtype: 'task_notification', tool_use_id: 'agent-1', status, summary: 'Task ended' }),
    ]) as Record<string, unknown>[]
    expect(history.find(message => message.isSubagentTool)).toMatchObject({ toolStatus: 'failed', subagentOutput: 'Task ended' })
  })

  it('keeps synchronous Agent and Task results completed', () => {
    for (const toolName of ['Agent', 'Task']) {
      const history = transcriptEventsToHistory('project-1', [nativeEvent(1, 'tool.completed', {
        toolName, toolUseID: 'sync-1', output: 'Audit finished', input: { prompt: 'Audit' },
      })]) as Record<string, unknown>[]
      expect(history[0]).toMatchObject({ toolStatus: 'completed', subagentOutput: 'Audit finished' })
    }
  })

  it('correlates stage lifecycle recovered from disk with the tool invocation already mirrored into chat', () => {
    const history = transcriptEventsToHistory('project-1', [
      nativeEvent(1, 'tool.started', { toolName: 'Agent', toolUseID: 'agent-1', input: { prompt: 'Review' },
        workflowStage: 'reviewer', workflowStageNativeKey: 'reviewer:tool-start:agent-1' }, 'main-chat'),
      nativeEvent(2, 'system.status', { type: 'system', subtype: 'task_notification', tool_use_id: 'agent-1',
        status: 'completed', summary: 'Checked', workflowStage: 'reviewer', workflowStageNativeKey: 'reviewer:notification-1' }, 'workflow-stage:reviewer'),
    ]) as Record<string, unknown>[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ toolStatus: 'completed', subagentPrompt: 'Review', subagentOutput: 'Checked' })
  })
  beforeEach(() => {
    authenticatedFetchMock.mockReset()
  })

  it('streams native partials without a stage ID, handles split UTF-8 frames, and ignores replayed cursors', async () => {
    const event = { id: 1, sessionId: 's', turnId: 't', type: 'assistant.partial', text: '中文\n',
      createdAt: '2026-09-20T00:00:00Z', payload: { messageId: 'native-message' } }
    const encoded = new TextEncoder().encode(`id: 1\ndata: ${JSON.stringify({ events: [event] })}\n\nid: 1\ndata: ${JSON.stringify({ events: [event] })}\n\n`)
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of encoded) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    } })
    authenticatedFetchMock.mockResolvedValueOnce(new Response(body))
    const onMessage = vi.fn(), onCursor = vi.fn()
    await beeGameAdapter.streamMessages('stream-native-test', 0, { onMessage, onCursor }, new AbortController().signal)
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'token', content: '中文\n', message_id: 'beegame-assistant-s-native-message' }))
    expect(onCursor).toHaveBeenLastCalledWith(1)
    expect(onMessage.mock.invocationCallOrder[0]).toBeLessThan(onCursor.mock.invocationCallOrder[0])
  })

  it('breaks a silent SSE socket after the heartbeat deadline so the hook can reconnect', async () => {
    vi.useFakeTimers()
    try {
      const cancel = vi.fn()
      authenticatedFetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
      const result = beeGameAdapter.streamMessages('silent-stream-test', 0, { onMessage: vi.fn() }, new AbortController().signal)
      const assertion = expect(result).rejects.toThrow('heartbeat timed out')
      await vi.advanceTimersByTimeAsync(20_001)
      await assertion
      expect(cancel).toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('loads a small latest page first and keeps the larger upward page intact', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce(transcriptResponse())
      .mockResolvedValueOnce(transcriptResponse({
        page: { hasMore: false, nextBeforeId: null },
      }))

    await beeGameAdapter.getChatHistory('project-1')
    await beeGameAdapter.getOlderChatHistory('project-1')

    expect(authenticatedFetchMock.mock.calls[0]?.[0]).toContain('limit=50')
    expect(authenticatedFetchMock.mock.calls[1]?.[0]).toContain('limit=300')
    expect(authenticatedFetchMock.mock.calls[1]?.[0]).toContain('before=99')
  })

  it('loads Todo snapshots from earlier stages independently of the latest chat page', async () => {
    const todo = (id: number, stage: string) => nativeEvent(id, 'tool.completed', {
      toolName: 'TodoWrite', toolUseID: 'todo-' + id, workflowStage: stage,
      input: { todos: [{ content: 'Review', status: 'completed' }] },
    })
    authenticatedFetchMock.mockResolvedValueOnce(transcriptResponse({
      events: [nativeEvent(8, 'assistant.message', { message: { id: 'latest' } })],
      todoEvents: [todo(1, 'author'), todo(2, 'reviewer')],
    }))
    const history = await beeGameAdapter.getChatHistory('all-todos') as Record<string, unknown>[]
    const todos = history.filter(m => m.toolName === 'TodoWrite')
    expect(todos).toHaveLength(2)
    expect(todos[0].todoScope).not.toBe(todos[1].todoScope)
    expect(beeGameAdapter.getChatHistoryPaginationState('all-todos').hasMore).toBe(true)
  })

  it('keeps resumed stage Todo snapshots in one scope while separating child agents', () => {
    const todo = (id: number, session: string, parent?: string) => nativeEvent(id, 'tool.completed', {
      toolName: 'TodoWrite', toolUseID: 'todo-' + id, workflowStage: 'implementation', ...(id > 1 ? { workflowRunId: 'run-1' } : {}),
      workflowSourceSessionId: session, parentToolUseID: parent,
      input: { todos: [{ content: 'Verify', status: 'completed' }] },
    })
    const messages = transcriptEventsToHistory('todo-resume', [todo(1, 'old'), todo(2, 'new'), todo(3, 'new', 'child')])
      .filter(message => message.toolName === 'TodoWrite')
    expect(messages).toHaveLength(3)
    expect(messages[0].todoScope).toBe(messages[1].todoScope)
    expect(messages[2].todoScope).not.toBe(messages[1].todoScope)
    const current = deriveCurrentProjectTodos(toChatDisplayMessages(normalizeChatHistory(messages)))
    expect(current).toHaveLength(2)
  })

  it('keeps one Think lifecycle at its start while applying its terminal duration', () => {
    const history = transcriptEventsToHistory('project-1', [
      {
        id: 1,
        sessionId: 'session-1',
        turnId: 'turn-1',
        type: 'assistant.thinking',
        text: 'Thinking',
        payload: {
          type: 'assistant.thinking',
          status: 'started',
          thinkingBlockId: 'block-1',
        },
        createdAt: '2026-09-17T00:00:00.000Z',
      },
      {
        id: 2,
        sessionId: 'session-1',
        turnId: 'turn-1',
        type: 'assistant.thinking',
        text: 'Inspecting the scene.',
        payload: {
          type: 'assistant.thinking',
          status: 'streaming',
          thinkingBlockId: 'block-1',
        },
        createdAt: '2026-09-17T00:00:01.000Z',
      },
      {
        id: 3,
        sessionId: 'session-1',
        turnId: 'turn-1',
        type: 'tool.started',
        text: 'Read',
        payload: {
          type: 'tool.started',
          toolName: 'Read',
          toolUseID: 'tool-1',
          input: { file_path: 'scene.json' },
        },
        createdAt: '2026-09-17T00:00:02.000Z',
      },
      {
        id: 4,
        sessionId: 'session-1',
        turnId: 'turn-1',
        type: 'assistant.thinking',
        text: 'Thinking',
        payload: {
          type: 'assistant.thinking',
          status: 'ended',
          thinkingBlockId: 'block-1',
          thinkingStartedAt: '2026-09-17T00:00:00.000Z',
        },
        createdAt: '2026-09-17T00:00:03.000Z',
      },
    ]) as Array<Record<string, unknown>>

    const thought = history.find(message => message.type === 'thought')
    const tool = history.find(message => message.type === 'tool')

    expect(thought).toMatchObject({
      timestamp: Date.parse('2026-09-17T00:00:00.000Z'),
      thinkingDurationMs: 3_000,
    })
    expect(tool).toMatchObject({
      timestamp: Date.parse('2026-09-17T00:00:02.000Z'),
    })
    expect(history.indexOf(thought!)).toBeLessThan(history.indexOf(tool!))
  })

  it('projects one compact terminal Thinking event into one completed Thought', () => {
    const history = transcriptEventsToHistory('project-1', [
      {
        id: 9,
        sessionId: 'session-1',
        type: 'assistant.thinking',
        text: 'Inspecting the scene and UI.',
        payload: {
          type: 'assistant.thinking',
          status: 'ended',
          thinkingBlockId: 'block-compact',
          thinkingStartedAt: '2026-09-17T00:00:00.000Z',
        },
        createdAt: '2026-09-17T00:00:09.000Z',
      },
    ]) as Array<Record<string, unknown>>

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      type: 'thought',
      content: 'Inspecting the scene and UI.',
      timestamp: Date.parse('2026-09-17T00:00:00.000Z'),
      thinkingDurationMs: 9_000,
    })
  })

  it('does not collide when a runtime reuses a Thinking block id', () => {
    const compactBlock = (id: number, startedAt: string, endedAt: string, text: string) => ({
      id,
      sessionId: 'session-1',
      type: 'assistant.thinking',
      text,
      payload: {
        type: 'assistant.thinking',
        status: 'ended',
        thinkingBlockId: 'reused-block',
        thinkingStartedAt: startedAt,
      },
      createdAt: endedAt,
    })
    const history = transcriptEventsToHistory('project-1', [
      compactBlock(1, '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:02.000Z', 'First thought.'),
      compactBlock(2, '2026-09-17T00:00:03.000Z', '2026-09-17T00:00:05.000Z', 'Second thought.'),
    ]) as Array<Record<string, unknown>>

    expect(history).toHaveLength(2)
    expect(new Set(history.map(message => message.id)).size).toBe(2)
    expect(history.map(message => message.content)).toEqual(['First thought.', 'Second thought.'])
  })

  it('materializes the same Thought from realtime deltas and refreshed history', () => {
    const realtime = transcriptEventsToHistory('project-1', [
      {
        id: 1,
        sessionId: 'session-1',
        type: 'assistant.thinking',
        text: 'Checking',
        payload: {
          type: 'assistant.thinking',
          status: 'started',
          thinkingBlockId: 'block-equivalent',
          thinkingStartedAt: '2026-09-17T00:00:00.000Z',
        },
        createdAt: '2026-09-17T00:00:00.000Z',
      },
      {
        id: 2,
        sessionId: 'session-1',
        type: 'assistant.thinking',
        text: ' the scene.',
        payload: {
          type: 'assistant.thinking',
          status: 'streaming',
          thinkingBlockId: 'block-equivalent',
          thinkingStartedAt: '2026-09-17T00:00:00.000Z',
        },
        createdAt: '2026-09-17T00:00:04.000Z',
      },
      {
        id: 3,
        sessionId: 'session-1',
        type: 'assistant.thinking',
        text: 'Thinking',
        payload: {
          type: 'assistant.thinking',
          status: 'ended',
          thinkingBlockId: 'block-equivalent',
          thinkingStartedAt: '2026-09-17T00:00:00.000Z',
        },
        createdAt: '2026-09-17T00:00:09.000Z',
      },
    ]) as Array<Record<string, unknown>>
    const refreshed = transcriptEventsToHistory('project-1', [
      {
        id: 3,
        sessionId: 'session-1',
        type: 'assistant.thinking',
        text: 'Checking the scene.',
        payload: {
          type: 'assistant.thinking',
          sourceSequence: 1,
          status: 'ended',
          thinkingBlockId: 'block-equivalent',
          thinkingStartedAt: '2026-09-17T00:00:00.000Z',
        },
        createdAt: '2026-09-17T00:00:09.000Z',
      },
    ]) as Array<Record<string, unknown>>

    expect(realtime).toEqual(refreshed)
  })

  it('keeps interrupted text checkpoints complete and separate across messages', () => {
    const rows = [
      { ...nativeEvent(1, 'assistant.partial', { messageId: 'm1', assistantBlockId: 'm1:0', contentMode: 'snapshot' }), text: 'first' },
      { ...nativeEvent(2, 'assistant.partial', { messageId: 'm1', assistantBlockId: 'm1:0', contentMode: 'snapshot' }), text: 'first complete checkpoint' },
      { ...nativeEvent(3, 'assistant.partial', { messageId: 'm2', assistantBlockId: 'm2:0', contentMode: 'snapshot' }), text: 'next message' },
    ]
    const history = transcriptEventsToHistory('project-1', rows) as Record<string, unknown>[]
    expect(history.map(row => row.content)).toEqual(['first complete checkpoint', 'next message'])
    expect(history.every(row => row.type === 'text')).toBe(true)
  })
})
