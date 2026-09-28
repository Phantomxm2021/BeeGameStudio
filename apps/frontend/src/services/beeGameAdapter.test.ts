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

it('keeps delivery handoff failures visible after the successful Agent turn', () => {
  const history = transcriptEventsToHistory('project', [
    { id: 1, sessionId: 'session', turnId: 'turn', type: 'turn.completed', text: '',
      createdAt: '2026-09-25T14:20:14Z', payload: { type: 'turn.completed' } },
    { id: 2, sessionId: 'session', turnId: 'turn', type: 'system.status', text: '交付未能继续：测试清理失败',
      createdAt: '2026-09-25T14:20:15Z', payload: { type: 'system.status', subtype: 'delivery_error' } },
  ])
  expect(history).toContainEqual(expect.objectContaining({
    sender: 'system', content: '交付未能继续：测试清理失败', taskKind: 'delivery_error',
  }))
})

it('sends answers through the permission endpoint and does not treat stale requests as submitted', async () => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ resolved: true })))
  const answers = { 'Which style?': 'Pixel' }
  await beeGameAdapter.resolveToolPermission({ project_id: 'project', gate_id: 'question', decision: 'allow', answers })
  const [url, request] = authenticatedFetchMock.mock.calls[0]
  expect(url).toContain('/api/projects/project/permissions/question')
  expect(JSON.parse(request?.body as string)).toEqual({ decision: 'allow', scope: 'once', remember: false, answers })
  authenticatedFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ resolved: false, stale: true })))
  await expect(beeGameAdapter.resolveToolPermission({ project_id: 'project', gate_id: 'question', decision: 'allow', answers }))
    .rejects.toMatchObject({ code: 'permission_not_pending', message: expect.stringContaining('no longer pending') })
})

const transcriptResponse = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  sessionId: 'session-1',
  workspacePath: '/workspace',
  events: [],
  page: { hasMore: true, nextBeforeId: 99 },
  ...overrides,
}))

describe('transcriptEventsToHistory', () => {
  it('keeps the turn completion time separate from the first assistant block timestamp', () => {
    const events = [
      { id: 1, sessionId: 'session-1', turnId: 'turn-1', type: 'assistant.message', text: 'Done',
        createdAt: '2026-09-25T06:50:55.000Z', payload: { type: 'assistant.message', assistantBlockId: 'answer-1' } },
      { id: 2, sessionId: 'session-1', turnId: 'turn-1', type: 'turn.completed', text: '',
        createdAt: '2026-09-25T06:51:10.920Z', payload: { type: 'turn.completed' } },
    ]
    const [answer] = toChatDisplayMessages(normalizeChatHistory(transcriptEventsToHistory('project', events)))
    expect(answer.timestamp).toBe(Date.parse('2026-09-25T06:50:55.000Z'))
    expect(answer.turnCompletedAt).toBe(Date.parse('2026-09-25T06:51:10.920Z'))
  })

  it('uses full timestamps across history pages when source sequences restart', () => {
    const event = (id: number, sourceSequence: number, text: string) => ({
      id, sessionId: 'session-1', turnId: `turn-${id}`, type: 'assistant.message' as const,
      text, createdAt: new Date(1_790_000_000_000 + id).toISOString(),
      payload: { type: 'assistant.message', assistantBlockId: `block-${id}`, sourceSequence },
    })
    const initial = normalizeChatHistory(transcriptEventsToHistory('project', [event(500, 1, 'latest reply')]))
    const older = normalizeChatHistory(transcriptEventsToHistory('project', [event(400, 400, 'older reply')]))
    expect(initial[0].sequence).toBe(1)
    expect(normalizeChatHistory([...initial, ...older]).map(message => message.content))
      .toEqual(['older reply', 'latest reply'])
  })

  it('omits automatic delivery continuation but keeps two genuine identical user requests', () => {
    const events = ['project_request', 'delivery_continue', 'project_request'].map((displayKind, index) => ({
      id: index + 1, sessionId: 'main', type: 'user.message', text: '修复按钮',
      createdAt: new Date(1000 + index).toISOString(), payload: { type: 'user.message', displayKind, clientMessageId: `client-${index}` },
    }))
    const history = transcriptEventsToHistory('project', events)
    expect(history).toHaveLength(2)
    expect(history.map(message => message.content)).toEqual(['修复按钮', '修复按钮'])
  })
  const nativeThinking = (id: number, status: string, text: string) => ({
    id, sessionId: 'native-session', turnId: 'native-turn',
    type: 'assistant.thinking' as const, text,
    createdAt: new Date(1000 + id * 1000).toISOString(),
    payload: { type: 'assistant.thinking', status, contentMode: 'snapshot',
      thinkingBlockId: 'query-1:message-1:0', thinkingStartedAt: new Date(2000).toISOString() },
  })

  it('joins native thinking start, snapshots and end by block identity', () => {
    const events = [nativeThinking(1, 'started', 'Thinking'),
      nativeThinking(2, 'streaming', 'First'),
      nativeThinking(3, 'streaming', 'First and second'),
      nativeThinking(4, 'ended', 'Thinking')]
    const history = transcriptEventsToHistory('p', events) as Record<string, unknown>[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ content: 'First and second', streamStatus: 'complete', thinkingDurationMs: 3000 })
    const child = events.map(e => ({ ...e, id: e.id + 10,
      payload: { ...e.payload, parentToolUseID: 'child-1' } }))
    expect(transcriptEventsToHistory('p', [...events, ...child])).toHaveLength(2)
  })

  it('uses the same thinking identity across separate SSE batches and history replay', async () => {
    const events = [nativeThinking(1, 'started', 'Thinking'),
      nativeThinking(2, 'streaming', 'Content'),
      nativeThinking(3, 'ended', 'Thinking')]
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`id: ${event.id}\ndata: ${JSON.stringify({ events: [event] })}\n\n`))
      controller.close()
    } })
    authenticatedFetchMock.mockResolvedValueOnce(new Response(body))
    const onMessage = vi.fn()
    await beeGameAdapter.streamMessages('native-thinking-test', 0, { onMessage, onCursor: vi.fn() }, new AbortController().signal)
    const projected = onMessage.mock.calls.map(([message]) => message)
    expect(projected.map(m => m.type)).toEqual(['think_start', 'thought', 'think_end'])
    expect(new Set(projected.map(m => m.message_id)).size).toBe(1)
    expect(projected.at(-1)).toMatchObject({ thinking_duration_ms: 2000 })
    expect((transcriptEventsToHistory('native-thinking-test', events)[0] as { id: string }).id).toBe(projected[0].message_id)
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
  it('projects a replacement user turn without the superseded assistant and tool output', () => {
    const event = (id: number, type: string, text: string, turnId: string, payload: Record<string, unknown> = {}) => ({
      id, type, text, turnId, sessionId: 's', createdAt: new Date(id * 1000).toISOString(), payload,
    })
    const events = [
      event(1, 'turn.started', '', 'one'),
      event(2, 'user.message', 'Before', 'one', { clientMessageId: 'before' }),
      event(3, 'assistant.message', 'First reply', 'one'),
      event(4, 'turn.started', '', 'two'),
      event(5, 'user.message', 'Original', 'two', { clientMessageId: 'original' }),
      event(6, 'tool.completed', 'Old tool result', 'two', { toolName: 'Bash', toolUseID: 'old-tool' }),
      event(7, 'assistant.message', 'Old reply', 'two'),
      event(8, 'turn.started', '', 'replacement'),
      event(9, 'user.message', 'Edited', 'replacement', { clientMessageId: 'edited', supersedesMessageId: 'original' }),
      event(10, 'assistant.message', 'New reply', 'replacement'),
    ]
    const history = transcriptEventsToHistory('p', events)
    expect(history.map(item => item.content).filter(Boolean)).toEqual(['Before', 'First reply', 'Edited', 'New reply'])
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
  it('projects native compaction start and boundary as one history marker', () => {
    const start = nativeEvent(1, 'system.status', { type: 'system', subtype: 'status', status: 'compacting' })
    const end = nativeEvent(2, 'system.status', { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto' } })
    const startOnly = transcriptEventsToHistory('p', [start]) as Record<string, unknown>[]
    expect(startOnly).toHaveLength(1)
    expect(startOnly[0]).toMatchObject({ type: 'system_status', taskKind: 'context_compaction', streamStatus: 'streaming' })

    const history = transcriptEventsToHistory('p', [start, end]) as Record<string, unknown>[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: startOnly[0].id, type: 'system_status', taskKind: 'context_compaction',
      content: 'compacted', streamStatus: 'complete', timestamp: Date.parse(start.createdAt) })
  })

  it('keeps delivery and session boundaries without turning tool progress into markers', () => {
    const history = transcriptEventsToHistory('p', [
      nativeEvent(1, 'system.status', { type: 'system.status', subtype: 'delivery_phase', phase: 'author' }),
      nativeEvent(2, 'system.status', { type: 'system.status', subtype: 'task_progress', status: 'running' }),
      nativeEvent(3, 'session.stopped', { type: 'session.stopped' }),
      nativeEvent(4, 'session.resumed', { type: 'session.resumed' }),
      nativeEvent(5, 'system.status', { type: 'system.status', subtype: 'delivery_phase', phase: 'review' }),
    ]) as Record<string, unknown>[]
    const markers = history.filter(message => message.taskKind === 'delivery_phase' || message.taskKind === 'session_lifecycle')
    expect(markers.map(message => message.content)).toEqual(['author', 'stopped', 'resumed', 'review'])
    expect(markers.every(message => message.type === 'normal')).toBe(true)
  })

  it('streams the same compaction marker identity on start and completion', async () => {
    const events = [
      nativeEvent(1, 'system.status', { type: 'system', subtype: 'status', status: 'compacting' }),
      nativeEvent(2, 'system.status', { type: 'system', subtype: 'compact_boundary' }),
    ]
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`id: ${event.id}\ndata: ${JSON.stringify({ events: [event] })}\n\n`))
      controller.close()
    } })
    authenticatedFetchMock.mockResolvedValueOnce(new Response(body))
    const onMessage = vi.fn()
    await beeGameAdapter.streamMessages('compaction-test', 0, { onMessage, onCursor: vi.fn() }, new AbortController().signal)
    const markers = onMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'context_compaction')
    expect(markers).toHaveLength(2)
    expect(markers.map(message => message.status)).toEqual(['running', 'finished'])
    expect(new Set(markers.map(message => message.message_id)).size).toBe(1)
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

  it('reconciles native progress, trace and terminal result into the same subagent card', () => {
    const subagentActivity = { entries: [{ id: 'read-1', kind: 'tool', toolName: 'Read',
      filePath: 'manifest.json', status: 'completed', output: '{}' }], truncated: false }
    const events = [...launchEvents(),
      nativeEvent(3, 'system.status', { type: 'system', subtype: 'task_progress', task_id: 'task-1', tool_use_id: 'agent-1',
        description: 'Reading manifest', last_tool_name: 'Read',
        usage: { tool_uses: 45, duration_ms: 1083052, total_tokens: 156415 }, subagentTrace: '[read-1] Read manifest.json', subagentActivity }),
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
    expect(card?.subagentActivity).toEqual(subagentActivity)
    const displayed = toChatDisplayMessages(normalizeChatHistory(history))
    expect(displayed.find(message => message.isSubagentTool)?.subagentActivity).toEqual(subagentActivity)
  })

  it('uses a structured TaskOutput terminal result when the native task notification is missing', () => {
    const events = [...launchEvents(),
      nativeEvent(3, 'system.status', { type: 'system', subtype: 'task_started', task_id: 'task-1',
        toolUseID: 'agent-1', input: { prompt: 'Check manifest' } }),
      nativeEvent(4, 'tool.completed', { toolName: 'TaskOutput', toolUseID: 'wait-1',
        input: { task_id: 'task-1' }, nativeBackgroundTaskResult: {
          toolUseID: 'agent-1', status: 'failed', result: 'Test failed',
        }, backgroundAgentInput: { prompt: 'Check manifest' } }),
    ]
    const history = transcriptEventsToHistory('project-1', events) as Record<string, unknown>[]
    expect(history.filter(message => message.isSubagentTool)).toHaveLength(1)
    expect(history.find(message => message.isSubagentTool)).toMatchObject({
      toolStatus: 'failed', subagentPrompt: 'Check manifest', subagentOutput: 'Test failed',
    })
  })

  it('recovers a historical background Bash task result without labeling it an Agent', () => {
    const history = transcriptEventsToHistory('project-1', [
      nativeEvent(1, 'system.status', { type: 'system', subtype: 'task_started', task_id: 'task-1',
        task_type: 'local_bash', toolUseID: 'bash-call-1', input: { description: 'Run tests' } }),
      nativeEvent(2, 'tool.completed', { toolName: 'TaskOutput', toolUseID: 'wait-1',
        input: { task_id: 'task-1' }, nativeTaskResult: { taskId: 'task-1', status: 'failed', result: 'Tests failed' } }),
    ]) as Record<string, unknown>[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ toolStatus: 'failed', toolName: 'Task',
      subagentOutput: 'Tests failed', isSubagentTool: true })
  })

  it('does not resurrect a background task from a late start event after session Stop', () => {
    const history = transcriptEventsToHistory('project-1', [
      nativeEvent(1, 'session.stopped', {}),
      nativeEvent(2, 'system.status', { type: 'system', subtype: 'task_started', task_id: 'late-task',
        task_type: 'local_bash', toolUseID: 'late-call' }),
    ]) as Record<string, unknown>[]
    expect(history.some(message => message.isSubagentTool)).toBe(false)
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

  it('correlates a native task notification with its tool invocation', () => {
    const history = transcriptEventsToHistory('project-1', [
      nativeEvent(1, 'tool.started', { toolName: 'Agent', toolUseID: 'agent-1', input: { prompt: 'Review' } }),
      nativeEvent(2, 'system.status', { type: 'system', subtype: 'task_notification', tool_use_id: 'agent-1',
        status: 'completed', summary: 'Checked' }),
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

  it('shows a queued user message on the live stream without requiring a page refresh', async () => {
    const event = { id: 7, sessionId: 's', turnId: 'turn-2', type: 'user.message', text: '继续',
      createdAt: '2026-09-20T00:00:00Z', payload: { type: 'user.message', clientMessageId: 'client-7' } }
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`id: 7\ndata: ${JSON.stringify({ events: [event] })}\n\n`))
      controller.close()
    } })
    authenticatedFetchMock.mockResolvedValueOnce(new Response(body))
    const onMessage = vi.fn()
    await beeGameAdapter.streamMessages('live-user-test', 6, { onMessage }, new AbortController().signal)
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'agent_message', sender: 'user', content: '继续',
      message_id: 'client-7', client_message_id: 'client-7',
    }))
  })

  it('shows the same user message when live updates fall back to polling', async () => {
    const event = { id: 8, sessionId: 's', turnId: 'turn-3', type: 'user.message', text: '修复按钮',
      createdAt: '2026-09-20T00:00:00Z', payload: { type: 'user.message', clientMessageId: 'client-8' } }
    authenticatedFetchMock.mockResolvedValueOnce(Response.json({ events: [event], workspacePath: '' }))
    const result = await beeGameAdapter.pollMessages('live-poll-user-test', 7)
    expect(result.messages).toEqual([expect.objectContaining({
      type: 'agent_message', sender: 'user', content: '修复按钮', message_id: 'client-8',
    })])
  })

  it('forwards in-flight native usage from the live event stream', async () => {
    const event = { id: 9, sessionId: 's', turnId: 'turn-3', type: 'usage', text: '',
      createdAt: '2026-09-20T00:00:03Z', payload: { type: 'stream_event', event: {
        type: 'message_delta', usage: { input_tokens: 100, output_tokens: 20,
          cache_read_input_tokens: 300, cache_creation_input_tokens: 10 },
      } } }
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`id: 9\ndata: ${JSON.stringify({ events: [event] })}\n\n`))
      controller.close()
    } })
    authenticatedFetchMock.mockResolvedValueOnce(new Response(body))
    const onMessage = vi.fn()
    await beeGameAdapter.streamMessages('live-usage-test', 8, { onMessage }, new AbortController().signal)
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 20,
        cache_read_tokens: 300, cache_creation_tokens: 10, total_tokens: 430 },
    }))
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

  it('preserves the auth outage envelope and retry delay when opening an SSE stream', async () => {
    authenticatedFetchMock.mockResolvedValueOnce(Response.json({
      error: 'Authentication service is temporarily unavailable', code: 'authentication_unavailable',
      recoverable: true, retry_after_ms: 2000,
    }, { status: 503 }))
    const onCursor = vi.fn(), onOpen = vi.fn()
    await expect(beeGameAdapter.streamMessages('auth-outage', 42,
      { onMessage: vi.fn(), onCursor, onOpen }, new AbortController().signal))
      .rejects.toMatchObject({ status: 503, code: 'authentication_unavailable', recoverable: true, retryAfterMs: 2000 })
    expect(onCursor).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    expect(authenticatedFetchMock.mock.calls.at(-1)?.[0]).toContain('after=42')
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

  it('requests Scene/UI file metadata without downloading document bodies', async () => {
    authenticatedFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      state: 'ready',
      documents: [{ path: 'scenes/main.json', revision: 'a'.repeat(64), id: 'scene.main', kind: 'scene-2d' }],
    })))

    const snapshot = await beeGameAdapter.getProjectGameContentFileList('project-1')

    expect(authenticatedFetchMock.mock.calls[0]?.[0]).toBe('/api/projects/project-1/game-content?metadata=1')
    expect(snapshot.documents).toEqual([
      { path: 'scenes/main.json', revision: 'a'.repeat(64), id: 'scene.main', kind: 'scene-2d' },
    ])
    expect(snapshot.documents?.[0]).not.toHaveProperty('document')
  })

  it('normalizes one legacy full snapshot without retrying the heavy endpoint', async () => {
    authenticatedFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      state: 'ready',
      documents: [{
        path: 'scenes/main.json', revision: 'a'.repeat(64),
        document: { id: 'scene.main', kind: 'scene-2d', data: { nodes: [{ id: 'root' }] } },
      }],
    })))

    const snapshot = await beeGameAdapter.getProjectGameContentFileList('project-1')

    expect(snapshot.documents).toEqual([
      { path: 'scenes/main.json', revision: 'a'.repeat(64), id: 'scene.main', kind: 'scene-2d' },
    ])
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not let an in-flight runtime snapshot overwrite preview start state', async () => {
    let resolveStale!: (response: Response) => void
    let resolveFresh!: (response: Response) => void
    const staleResponse = new Promise<Response>(resolve => { resolveStale = resolve })
    const freshResponse = new Promise<Response>(resolve => { resolveFresh = resolve })
    const previewResponse = {
      sessionId: 'preview-session', workspacePath: '/workspace', status: 'running',
      url: '/previews/preview-session/', updatedAt: '2026-09-22T00:00:01.000Z',
    }
    const runningRuntime = {
      project_id: 'preview-race', phase: 'idle', blocked: false,
      build_report: { status: 'passed', build_url: '/previews/preview-session/' },
    }

    authenticatedFetchMock
      .mockReturnValueOnce(staleResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify(previewResponse)))
      .mockReturnValueOnce(freshResponse)

    const staleRuntime = beeGameAdapter.getProjectRuntimeState('preview-race')
    await beeGameAdapter.startProjectPreview('preview-race')
    const refreshedRuntime = beeGameAdapter.getProjectRuntimeState('preview-race')

    resolveStale(new Response(JSON.stringify({
      project_id: 'preview-race', phase: 'idle', blocked: false, build_report: null,
    })))
    resolveFresh(new Response(JSON.stringify(runningRuntime)))

    await expect(staleRuntime).resolves.toMatchObject({ status: { build_report: runningRuntime.build_report } })
    await expect(refreshedRuntime).resolves.toMatchObject({ status: { build_report: runningRuntime.build_report } })
  })

  it('does not let a runtime poll started during preview mutation return stale state', async () => {
    let resolvePreview!: (response: Response) => void
    let resolveDuringMutation!: (response: Response) => void
    let resolveFresh!: (response: Response) => void
    const previewResponse = new Promise<Response>(resolve => { resolvePreview = resolve })
    const duringMutationResponse = new Promise<Response>(resolve => { resolveDuringMutation = resolve })
    const freshResponse = new Promise<Response>(resolve => { resolveFresh = resolve })
    const runningRuntime = {
      project_id: 'preview-race-during-mutation', phase: 'idle', blocked: false,
      build_report: { status: 'passed', build_url: '/previews/preview-session/' },
    }

    authenticatedFetchMock
      .mockReturnValueOnce(previewResponse)
      .mockReturnValueOnce(duringMutationResponse)
      .mockReturnValueOnce(freshResponse)

    const mutation = beeGameAdapter.startProjectPreview('preview-race-during-mutation')
    const polledDuringMutation = beeGameAdapter.getProjectRuntimeState('preview-race-during-mutation')

    resolvePreview(new Response(JSON.stringify({
      sessionId: 'preview-session', workspacePath: '/workspace', status: 'running',
      url: '/previews/preview-session/', updatedAt: '2026-09-22T00:00:01.000Z',
    })))
    await mutation

    resolveDuringMutation(new Response(JSON.stringify({
      project_id: 'preview-race-during-mutation', phase: 'idle', blocked: false, build_report: null,
    })))
    resolveFresh(new Response(JSON.stringify(runningRuntime)))

    await expect(polledDuringMutation).resolves.toMatchObject({
      status: { build_report: runningRuntime.build_report },
    })
  })

  it('loads Todo snapshots from earlier turns independently of the latest chat page', async () => {
    const todo = (id: number, turnId: string) => ({ ...nativeEvent(id, 'tool.completed', {
      toolName: 'TodoWrite', toolUseID: 'todo-' + id,
      input: { todos: [{ content: 'Review', status: 'completed' }] },
    }), turnId })
    authenticatedFetchMock.mockResolvedValueOnce(transcriptResponse({
      events: [nativeEvent(8, 'assistant.message', { message: { id: 'latest' } })],
      todoEvents: [todo(1, 'turn-1'), todo(2, 'turn-2')],
    }))
    const history = await beeGameAdapter.getChatHistory('all-todos') as Record<string, unknown>[]
    const todos = history.filter(m => m.toolName === 'TodoWrite')
    expect(todos).toHaveLength(2)
    expect(todos[0].todoScope).not.toBe(todos[1].todoScope)
    expect(beeGameAdapter.getChatHistoryPaginationState('all-todos').hasMore).toBe(true)
  })

  it('keeps native Todo snapshots in one turn scope while separating child agents', () => {
    const todo = (id: number, parent?: string) => nativeEvent(id, 'tool.completed', {
      toolName: 'TodoWrite', toolUseID: 'todo-' + id, parentToolUseID: parent,
      input: { todos: [{ content: 'Verify', status: 'completed' }] },
    })
    const messages = transcriptEventsToHistory('todo-resume', [todo(1), todo(2), todo(3, 'child')])
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
