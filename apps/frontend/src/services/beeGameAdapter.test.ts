import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./apiClient', () => ({
  authenticatedFetch: vi.fn(),
}))

import { authenticatedFetch } from './apiClient'
import { beeGameAdapter, transcriptEventsToHistory } from './beeGameAdapter'

const authenticatedFetchMock = vi.mocked(authenticatedFetch)

const transcriptResponse = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  sessionId: 'session-1',
  workspacePath: '/workspace',
  events: [],
  page: { hasMore: true, nextBeforeId: 99 },
  ...overrides,
}))

describe('transcriptEventsToHistory', () => {
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
          status: 'ended',
          thinkingBlockId: 'block-equivalent',
          thinkingStartedAt: '2026-09-17T00:00:00.000Z',
        },
        createdAt: '2026-09-17T00:00:09.000Z',
      },
    ]) as Array<Record<string, unknown>>

    expect(realtime).toEqual(refreshed)
  })
})
