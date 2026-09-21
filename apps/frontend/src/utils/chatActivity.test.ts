import { describe, expect, it } from 'vitest';
import { settleChatActivity } from './chatActivity';
import { transcriptEventsToHistory } from '../services/beeGameAdapter';

describe('terminal Chat activity', () => {
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
