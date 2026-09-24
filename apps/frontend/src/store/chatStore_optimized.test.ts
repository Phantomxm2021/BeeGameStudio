import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage for Zustand persistence
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const { useChatStore } = await import('./chatStore');

describe('chatStore Performance & Cap', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    useChatStore.getState().clearMessages();
  });

  it('isolates interleaved message IDs and replaces redacted snapshots without moving their start', () => {
    const { updateMessage, finalizeMessage } = useChatStore.getState();
    updateMessage('run', 'first', 'beegame', 'text', false, undefined, undefined, {}, 100, 'm1');
    updateMessage('run', 'second', 'beegame', 'text', false, undefined, undefined, {}, 200, 'm2');
    updateMessage('run', ' complete', 'beegame', 'text', false, undefined, undefined, {}, 300, 'm1');
    updateMessage('run', '[REDACTED]', 'beegame', 'text', false, undefined, undefined, { contentMode: 'snapshot' }, 400, 'm2');
    finalizeMessage('run', 'first complete', 'beegame', 'text', false, undefined, undefined, {}, 500, 'm1');
    updateMessage('run', 'late delta', 'beegame', 'text', false, undefined, undefined, {}, 600, 'm1');
    expect(useChatStore.getState().messages.map(m => [m.id, m.content, m.timestamp])).toEqual([
      ['m1', 'first complete', 100], ['m2', '[REDACTED]', 200],
    ]);
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingMessageId).toBe('m2');
  });

  it('should maintain O(1) messageIndexMap when adding messages', () => {
    const { addMessage } = useChatStore.getState();
    addMessage({ id: 'msg-1', sender: 'user', content: 'hello', timestamp: 1000 });
    addMessage({ id: 'msg-2', sender: 'user', content: 'world', timestamp: 1001 });

    const state = useChatStore.getState();
    expect(state.messages.length).toBe(2);
    expect(state.messageIndexMap['msg-1']).toBe(0);
    expect(state.messageIndexMap['msg-2']).toBe(1);
  });

  it('keeps a finished compaction marker when an older history page supplies its start', () => {
    const { addMessage, loadHistory } = useChatStore.getState();
    addMessage({ id: 'compaction-1', messageId: 'compaction-1', sender: 'system',
      content: 'compacted', taskKind: 'context_compaction', type: 'system_status',
      streamStatus: 'complete', timestamp: 2000, sequence: 20 });
    loadHistory([{ id: 'compaction-1', messageId: 'compaction-1', sender: 'system',
      content: 'compacting', taskKind: 'context_compaction', type: 'system_status',
      streamStatus: 'streaming', timestamp: 1000, sequence: 10 }]);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toMatchObject({
      content: 'compacted', streamStatus: 'complete', timestamp: 1000, sequence: 10,
    });
  });

  it('stops unfinished messages but accepts a later authoritative final receipt', () => {
    const { updateMessage, settleActivity, finalizeMessage } = useChatStore.getState();
    updateMessage('run', 'Partial', 'beegame', 'text', false, undefined, undefined, {}, 100, 'm');
    settleActivity('run', undefined, 'stopped', 200);
    expect(useChatStore.getState().messages[0]).toMatchObject({ streamStatus: 'complete', completionReason: 'stopped', content: 'Partial' });
    finalizeMessage('run', 'Full receipt', 'beegame', 'text', false, undefined, undefined, {}, 300, 'm');
    expect(useChatStore.getState().messages[0]).toMatchObject({ streamStatus: 'complete', completionReason: undefined, content: 'Full receipt' });
  });

  it('keeps the subagent prompt and trace when a terminal notification updates the live card', () => {
    const { addMessage } = useChatStore.getState();
    const base = { id: 'agent-1', messageId: 'agent-1', sender: 'beegame', content: 'Subagent', timestamp: 1000 };
    addMessage({ ...base, toolStatus: 'running', subagentPrompt: 'Audit assets', subagentTrace: 'Read manifest.json' });
    addMessage({ ...base, toolStatus: 'completed', subagentPrompt: undefined, subagentTrace: undefined, subagentOutput: 'Audit passed' });
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toMatchObject({ toolStatus: 'completed', subagentPrompt: 'Audit assets',
      subagentTrace: 'Read manifest.json', subagentOutput: 'Audit passed' });
  });

  it('retains all explicitly loaded messages beyond 2000', () => {
    const { addMessage } = useChatStore.getState();
    
    // Add 2010 messages
    for (let i = 0; i < 2010; i++) {
      addMessage({
        id: `msg-${i}`,
        sender: 'system',
        content: `content-${i}`,
        timestamp: Date.now() + i
      });
    }

    const state = useChatStore.getState();
    expect(state.messages.length).toBe(2010);
    expect(state.messages[0].id).toBe('msg-0');
    expect(state.messages[2009].id).toBe('msg-2009');
    
    // Index map should be rebuilt correctly
    expect(state.messageIndexMap['msg-10']).toBe(10);
    expect(state.messageIndexMap['msg-2009']).toBe(2009);
    expect(state.messageIndexMap['msg-0']).toBe(0);
  });

  it('prepends an older page beyond 2000 without evicting the live edge or the requested page', () => {
    const create = (sequence: number) => ({ id: 'history-' + sequence, sequence,
      sender: 'beegame', content: 'Message ' + sequence, timestamp: sequence + 1 });
    const { loadHistory } = useChatStore.getState();
    loadHistory(Array.from({ length: 2200 }, (_, i) => create(i + 300)));
    loadHistory(Array.from({ length: 300 }, (_, i) => create(i)));
    expect(useChatStore.getState().messages).toHaveLength(2500);
    expect(useChatStore.getState().messages[0].id).toBe('history-0');
    expect(useChatStore.getState().messages.at(-1)?.id).toBe('history-2499');
  });

  it('should use O(1) lookup for updateMessage', () => {
    const { updateMessage } = useChatStore.getState();
    
    // 1. Initial token creates message
    updateMessage('task-1', 'He', 'metis');
    let state = useChatStore.getState();
    const streamingId = state.streamingMessageId!;
    expect(streamingId).toBe('streaming-task-1-metis');
    expect(state.messages[0].content).toBe('He');

    // 2. Subsequent token updates same message
    updateMessage('task-1', 'llo', 'metis');
    state = useChatStore.getState();
    expect(state.messages.length).toBe(1);
    expect(state.messages[0].content).toBe('Hello');
    expect(state.messages[0].id).toBe(streamingId);
  });

  it('preserves the final thinking duration when a streamed thought is finalized', () => {
    const { addMessage, finalizeMessage } = useChatStore.getState();
    addMessage({
      id: 'thinking-1',
      messageId: 'thinking-1',
      sender: 'beegame',
      content: 'Thinking',
      thought: 'Checking the request.',
      taskId: 'task-1',
      timestamp: 100,
      type: 'thought',
      taskKind: 'assistant_thinking',
    });

    finalizeMessage(
      'task-1',
      'Thinking',
      'beegame',
      'thought',
      undefined,
      undefined,
      undefined,
      { taskKind: 'assistant_thinking', thinkingDurationMs: 2_130 },
      2_230,
      'thinking-1',
    );

    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: 'thinking-1',
      thought: 'Checking the request.',
      thinkingDurationMs: 2_130,
    });
  });

  it('should reconcile optimistic user message with persisted history instead of duplicating it', () => {
    const { addMessage, loadHistory } = useChatStore.getState();

    addMessage({
      id: 'client-msg-1',
      clientMessageId: 'client-msg-1',
      sender: 'user',
      content: 'hello',
      timestamp: 1000,
    });

    loadHistory([
      {
        id: 'msg_backend_1',
        messageId: 'msg_backend_1',
        clientMessageId: 'client-msg-1',
        sender: 'user',
        content: 'hello',
        timestamp: 1001,
      },
    ]);

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('msg_backend_1');
    expect(state.messages[0].clientMessageId).toBe('client-msg-1');
  });

  it('does not infer an optimistic receipt solely from matching text', () => {
    const { addMessage } = useChatStore.getState();

    addMessage({
      id: 'client-msg-2',
      clientMessageId: 'client-msg-2',
      sender: 'user',
      content: 'make a snake game',
      timestamp: 1000,
    });

    addMessage({
      id: 'beegame-event-42',
      messageId: 'beegame-event-42',
      sender: 'user',
      content: 'make a snake game',
      timestamp: 1001,
    });

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].id).toBe('beegame-event-42');
    expect(state.messages[1].content).toBe('make a snake game');
  });

  it('preserves repeated requests when client message identities differ', () => {
    const { addMessage } = useChatStore.getState();

    addMessage({
      id: 'client-msg-a',
      clientMessageId: 'client-msg-a',
      sender: 'user',
      content: 'same user request',
      timestamp: 1000,
    });

    addMessage({
      id: 'client-msg-b',
      clientMessageId: 'client-msg-b',
      sender: 'user',
      content: 'same user request',
      timestamp: 1001,
    });

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].clientMessageId).toBe('client-msg-b');
  });

  it('keeps separate image-only turns while replacing optimistic bytes with the matching durable reference', () => {
    const { addMessage, finalizeMessage, loadHistory } = useChatStore.getState();
    addMessage({ id: 'upload-a', clientMessageId: 'upload-a', sender: 'user', content: '', timestamp: 1,
      attachments: [{ type: 'image', mediaType: 'image/png', data: 'eA==' }] });
    const attachments = [{ type: 'image' as const, mediaType: 'image/png', filename: 'scene.png', projectId: 'p',
      storageId: '00000000-0000-0000-0000-000000000000-image.png' }];
    finalizeMessage('s', '', 'user', 'text', false, undefined, undefined, { attachments }, 2, 'upload-a');
    loadHistory([{ id: 'upload-b', sender: 'user', content: '', timestamp: 3, attachments }]);
    expect(useChatStore.getState().messages).toHaveLength(2);
    expect(useChatStore.getState().messages[0].attachments).toEqual(attachments);
  });

  it('should not discard existing history when a reconnect returns only a short session slice', () => {
    const { loadHistory } = useChatStore.getState();

    loadHistory([
      {
        id: 'history-1',
        messageId: 'history-1',
        sender: 'user',
        content: 'Original request',
        timestamp: 1000,
      },
      {
        id: 'history-2',
        messageId: 'history-2',
        sender: 'beegame',
        content: 'Original answer',
        timestamp: 1001,
      },
    ]);

    loadHistory([
      {
        id: 'history-3',
        messageId: 'history-3',
        sender: 'beegame',
        content: 'Short restored slice',
        timestamp: 1002,
      },
    ]);

    const state = useChatStore.getState();
    expect(state.messages.map(message => message.content)).toEqual([
      'Original request',
      'Original answer',
      'Short restored slice',
    ]);
  });

  it('should append repeated tool messages when backend ids differ', () => {
    const { addMessage } = useChatStore.getState();

    addMessage({
      id: 'beegame-event-10',
      messageId: 'beegame-event-10',
      sender: 'system',
      content: '调用工具: Bash',
      timestamp: 1000,
      type: 'tool',
    });
    addMessage({
      id: 'beegame-event-11',
      messageId: 'beegame-event-11',
      sender: 'system',
      content: '调用工具: Bash',
      timestamp: 1001,
      type: 'tool',
    });

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.messages.map((message) => message.id)).toEqual([
      'beegame-event-10',
      'beegame-event-11',
    ]);
  });

  it('does not persist chat messages while a Supabase cloud session is active', () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'cloud-access-token',
      expiresAt: Date.now() + 60_000,
      user: { id: 'user_cloud' },
    }));

    useChatStore.getState().addMessage({
      id: 'cloud-msg-1',
      sender: 'user',
      content: 'cloud message should come from transcript',
      timestamp: 1000,
    });

    const raw = localStorage.getItem('chat-storage');
    if (raw) {
      const persisted = JSON.parse(raw);
      expect(persisted.state?.messages ?? []).toEqual([]);
    }
  });

  it('does not persist chat messages before an HttpOnly session has hydrated', () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');

    useChatStore.getState().addMessage({
      id: 'secure-cookie-msg-1',
      sender: 'user',
      content: 'secure history must come from the authenticated transcript',
      timestamp: 1000,
    });

    const raw = localStorage.getItem('chat-storage');
    if (raw) {
      const persisted = JSON.parse(raw);
      expect(persisted.state?.messages ?? []).toEqual([]);
    }
  });

  it('should clear map on clearMessages', () => {
    const { addMessage, clearMessages } = useChatStore.getState();
    addMessage({ id: 'msg-1', sender: 'user', content: 'hi', timestamp: 1000 });
    clearMessages();
    
    const state = useChatStore.getState();
    expect(state.messages.length).toBe(0);
    expect(Object.keys(state.messageIndexMap).length).toBe(0);
    expect(Object.keys(state.lastStreamingIdByTask).length).toBe(0);
  });
});
