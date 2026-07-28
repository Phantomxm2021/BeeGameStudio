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

  it('should maintain O(1) messageIndexMap when adding messages', () => {
    const { addMessage } = useChatStore.getState();
    addMessage({ id: 'msg-1', sender: 'user', content: 'hello', timestamp: 1000 });
    addMessage({ id: 'msg-2', sender: 'user', content: 'world', timestamp: 1001 });

    const state = useChatStore.getState();
    expect(state.messages.length).toBe(2);
    expect(state.messageIndexMap['msg-1']).toBe(0);
    expect(state.messageIndexMap['msg-2']).toBe(1);
  });

  it('should cap messages at the paginated history limit (2000)', () => {
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
    expect(state.messages.length).toBe(2000);
    // Oldest messages should be removed (msg-0 to msg-9)
    expect(state.messages[0].id).toBe('msg-10');
    expect(state.messages[1999].id).toBe('msg-2009');
    
    // Index map should be rebuilt correctly
    expect(state.messageIndexMap['msg-10']).toBe(0);
    expect(state.messageIndexMap['msg-2009']).toBe(1999);
    expect(state.messageIndexMap['msg-0']).toBeUndefined();
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

  it('should reconcile optimistic user message with a backend event id when content matches', () => {
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
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('beegame-event-42');
    expect(state.messages[0].content).toBe('make a snake game');
  });

  it('removes legacy workflow and diagnostic display state while loading history', () => {
    const { loadHistory } = useChatStore.getState();
    loadHistory([{
      id: 'legacy-message',
      sender: 'assistant',
      content: 'thinking',
      timestamp: 1000,
      workflow: { status: 'running', raw: '{"verdict":"READY"}' },
      diagnostic: { raw: '{"internal":true}' },
    } as any]);

    const message = useChatStore.getState().messages[0] as Record<string, unknown>;
    expect(message).not.toHaveProperty('workflow');
    expect(message).not.toHaveProperty('diagnostic');
  });

  it('should reconcile duplicate user messages even when client message ids differ', () => {
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
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].clientMessageId).toBe('client-msg-b');
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
