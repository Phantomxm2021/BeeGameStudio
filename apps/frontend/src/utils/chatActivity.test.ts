import { describe, expect, it } from 'vitest';
import { hasActiveSubagents, isProjectExecutionActive, settleChatActivity } from './chatActivity';
import { transcriptEventsToHistory } from '../services/beeGameAdapter';

describe('terminal Chat activity', () => {
  it('derives active execution only from the native runtime phase', () => {
    expect(isProjectExecutionActive({ phase: 'running' })).toBe(true);
    expect(isProjectExecutionActive({ phase: 'waiting_approval' })).toBe(true);
    expect(isProjectExecutionActive({ phase: 'idle' })).toBe(false);
    expect(isProjectExecutionActive({ phase: 'paused' })).toBe(false);
    expect(isProjectExecutionActive(null)).toBe(false);
  });
  it('only active child lifecycle blocks input; stopped, failed and incomplete history does not', () => {
    expect(hasActiveSubagents([{ isSubagentTool: true, toolStatus: 'running' }])).toBe(true);
    for (const completionReason of ['stopped', 'failed', 'incomplete'] as const)
      expect(hasActiveSubagents([{ isSubagentTool: true, toolStatus: 'running', completionReason }])).toBe(false);
    expect(hasActiveSubagents([{ isSubagentTool: true, toolStatus: 'completed' }])).toBe(false);
    expect(hasActiveSubagents([{ toolStatus: 'running' }])).toBe(false);
  });

  it('session stop settles turnless mirrored tools without stopping another session', () => {
    const events = [
      { id: 1, sessionId: 's', type: 'tool.started', text: 'Bash',
        createdAt: '2026-09-21T00:00:00.000Z', payload: { toolName: 'Bash', toolUseID: 'tool-1', input: { command: 'node test.mjs' } } },
      { id: 2, sessionId: 'other', type: 'tool.started', text: 'Bash',
        createdAt: '2026-09-21T00:00:01.000Z', payload: { toolName: 'Bash', toolUseID: 'tool-2', input: { command: 'node other.mjs' } } },
      { id: 3, sessionId: 's', turnId: 'turn', type: 'session.stopped', text: 'Stopped', createdAt: '2026-09-21T00:00:02.000Z' },
    ];
    const history = transcriptEventsToHistory('p', events) as Array<Record<string, unknown>>;
    expect(history.find(m => m.toolUseId === 'tool-1')).toMatchObject({ toolStatus: 'failed', completionReason: 'stopped' });
    expect(history.find(m => m.toolUseId === 'tool-2')).toMatchObject({ toolStatus: 'running' });
  });

  it('settles only the matching turn, retaining partial text and parallel work', () => {
    const messages = [
      { id: 'parent', taskId: 'p', turnId: 'parent', timestamp: 100, streamStatus: 'streaming', content: 'Partial reply' },
      { id: 'child', taskId: 'p', turnId: 'child', timestamp: 100, streamStatus: 'streaming', content: 'Child reply' },
      { id: 'later', taskId: 'p', turnId: 'parent', timestamp: 400, streamStatus: 'streaming', content: 'New work' },
    ];
    const result = settleChatActivity(messages, { taskId: 'p', turnId: 'parent', at: 200, reason: 'stopped' });
    expect(result[0]).toMatchObject({ content: 'Partial reply', completionReason: 'stopped', streamStatus: 'complete' });
    expect(result[1]).toBe(messages[1]);
    expect(result[2]).toBe(messages[2]);
  });

  it('records completion time on finished text without changing its creation time', () => {
    const messages = [
      { taskId: 'p', turnId: 'first', timestamp: 100, streamStatus: 'complete', content: 'Done' },
      { taskId: 'p', turnId: 'second', timestamp: 150, streamStatus: 'complete', content: 'Later' },
    ];
    const result = settleChatActivity(messages, { taskId: 'p', turnId: 'first', at: 200,
      completedAt: 200, reason: 'incomplete' });
    expect(result[0]).toMatchObject({ timestamp: 100, turnCompletedAt: 200, streamStatus: 'complete' });
    expect(result[1]).toBe(messages[1]);
  });

  it('does not infer detached child completion from a parent result', () => {
    const messages = [{ taskId: 'p', timestamp: 100, toolStatus: 'running', isSubagentTool: true }];
    expect(settleChatActivity(messages, { taskId: 'p', at: 200, reason: 'incomplete' })[0]).toBe(messages[0]);
    expect(settleChatActivity(messages, { taskId: 'p', at: 200, reason: 'stopped' })[0])
      .toMatchObject({ toolStatus: 'failed', completionReason: 'stopped' });
  });

  it('a stopped transcript cannot restore an unfinished Thought as streaming', () => {
    const events = [
      { id: 1, sessionId: 's', turnId: 'turn', type: 'assistant.thinking', text: 'Checking assets',
        createdAt: '2026-09-21T00:00:00.000Z', payload: { type: 'assistant.thinking', status: 'streaming', thinkingBlockId: 'b', thinkingStartedAt: '2026-09-21T00:00:00.000Z' } },
      { id: 2, sessionId: 's', turnId: 'turn', type: 'session.stopped', text: 'Stopped', createdAt: '2026-09-21T00:00:02.000Z' },
    ];
    const thought = (transcriptEventsToHistory('p', events) as Array<Record<string, unknown>>).find(m => m.type === 'thought');
    expect(thought).toMatchObject({ content: 'Checking assets', streamStatus: 'complete', completionReason: 'stopped' });
  });
});

it('does not extend a previously completed turn when a later session stop arrives', () => {
  const result = settleChatActivity([
    { taskId: 'p', turnId: 'old', timestamp: 100, streamStatus: 'complete', turnCompletedAt: 200 },
    { taskId: 'p', turnId: 'current', timestamp: 300, toolStatus: 'running' },
  ], { taskId: 'p', at: 500, completedAt: 500, reason: 'stopped' });
  expect(result[0].turnCompletedAt).toBe(200);
  expect(result[1]).toMatchObject({ turnCompletedAt: 500, completionReason: 'stopped', toolStatus: 'failed' });
});
