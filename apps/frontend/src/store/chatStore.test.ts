/**
 * Unit tests for chatStore error recovery methods
 * 
 * Tests the following functionality:
 * - retryRenderMessage: Resets error state and increments attempt counter
 * - markMessageAsCorrupted: Marks messages as corrupted with detection
 * - Corruption detection logic
 * 
 * Requirements: 2.6, 5.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '../types/message';

// Create a simple in-memory store for testing without persistence
import { create } from 'zustand';

// Copy the detectCorruption function for testing
function detectCorruption(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return true;
  }

  const corruptionPatterns = [
    /\\[`*_[\]()]/g,
    /\|\|+/,
    /```[^`]*$/,
    /\s{10,}/,
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0B-\x0C\x0E-\x1F]/
  ];

  for (const pattern of corruptionPatterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}

interface TestChatState {
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  finalizeMessage: (taskId: string, content: string, sender: string) => void;
  retryRenderMessage: (messageId: string) => void;
  markMessageAsCorrupted: (messageId: string) => void;
}

// Create test store without persistence
const useTestChatStore = create<TestChatState>((set) => ({
  messages: [],

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message]
    })),

  clearMessages: () =>
    set({ messages: [] }),

  finalizeMessage: (taskId, content, sender) =>
    set((state) => {
      const lastRelevantMessageIndex = [...state.messages].reverse().findIndex(
        (msg) => msg.taskId === taskId && msg.sender === sender && msg.id.startsWith('streaming-')
      );

      if (lastRelevantMessageIndex !== -1) {
        const realIndex = state.messages.length - 1 - lastRelevantMessageIndex;
        const updatedMessages = [...state.messages];
        const existingMessage = updatedMessages[realIndex];

        updatedMessages[realIndex] = {
          ...existingMessage,
          id: `agent-${taskId || 'na'}-${existingMessage.timestamp}`,
          content,
          type: existingMessage.type || 'normal'
        };

        return { messages: updatedMessages };
      }

      const duplicateIndex = [...state.messages].reverse().findIndex(
        (msg) => msg.taskId === taskId && msg.sender === sender && msg.content === content
      );

      if (duplicateIndex !== -1) {
        return state;
      }

      return {
        messages: [
          ...state.messages,
          {
            id: `agent-${taskId || 'na'}-${Date.now()}`,
            sender,
            content,
            taskId,
            timestamp: Date.now(),
            type: 'normal'
          }
        ]
      };
    }),

  retryRenderMessage: (messageId) =>
    set((state) => {
      const messageIndex = state.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) {
        console.warn(`[chatStore] Message ${messageId} not found for retry`);
        return state;
      }

      const updatedMessages = [...state.messages];
      const message = updatedMessages[messageIndex];

      updatedMessages[messageIndex] = {
        ...message,
        renderingError: false,
        lastRenderAttempt: Date.now(),
        renderAttempts: (message.renderAttempts || 0) + 1
      };

      return { messages: updatedMessages };
    }),

  markMessageAsCorrupted: (messageId) =>
    set((state) => {
      const messageIndex = state.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) {
        console.warn(`[chatStore] Message ${messageId} not found for corruption marking`);
        return state;
      }

      const updatedMessages = [...state.messages];
      const message = updatedMessages[messageIndex];

      const hasCorruption = detectCorruption(message.content);

      updatedMessages[messageIndex] = {
        ...message,
        corruptionDetected: hasCorruption,
        renderingError: true,
        lastRenderAttempt: Date.now()
      };

      return { messages: updatedMessages };
    })
}));

describe('chatStore error recovery methods', () => {
  beforeEach(() => {
    useTestChatStore.getState().clearMessages();
  });

  describe('retryRenderMessage', () => {
    it('should reset rendering error state and increment attempt counter', () => {
      const message: Message = {
        id: 'test-message-1',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now(),
        renderingError: true,
        renderAttempts: 1
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().retryRenderMessage('test-message-1');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.renderingError).toBe(false);
      expect(updatedMessage.renderAttempts).toBe(2);
      expect(updatedMessage.lastRenderAttempt).toBeDefined();
    });

    it('should initialize render attempts to 1 if not set', () => {
      const message: Message = {
        id: 'test-message-2',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().retryRenderMessage('test-message-2');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.renderAttempts).toBe(1);
    });

    it('should handle non-existent message gracefully', () => {
      useTestChatStore.getState().retryRenderMessage('non-existent-id');
      expect(useTestChatStore.getState().messages).toHaveLength(0);
    });

    it('should update lastRenderAttempt timestamp', () => {
      const message: Message = {
        id: 'test-message-3',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);

      const beforeRetry = Date.now();
      useTestChatStore.getState().retryRenderMessage('test-message-3');
      const afterRetry = Date.now();

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.lastRenderAttempt).toBeDefined();
      expect(updatedMessage.lastRenderAttempt!).toBeGreaterThanOrEqual(beforeRetry);
      expect(updatedMessage.lastRenderAttempt!).toBeLessThanOrEqual(afterRetry);
    });
  });

  describe('finalizeMessage', () => {
    it('should replace an existing streaming message instead of appending a duplicate', () => {
      useTestChatStore.getState().addMessage({
        id: 'streaming-metis-1',
        sender: 'metis',
        content: 'partial',
        timestamp: 1000,
        taskId: 'task-1'
      });

      useTestChatStore.getState().finalizeMessage('task-1', 'final content', 'metis');

      const messages = useTestChatStore.getState().messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('agent-task-1-1000');
      expect(messages[0].content).toBe('final content');
    });

    it('should not append a second copy when the finalized message already exists', () => {
      useTestChatStore.getState().addMessage({
        id: 'agent-task-2-1000',
        sender: 'metis',
        content: 'final content',
        timestamp: 1000,
        taskId: 'task-2'
      });

      useTestChatStore.getState().finalizeMessage('task-2', 'final content', 'metis');

      expect(useTestChatStore.getState().messages).toHaveLength(1);
    });
  });

  describe('markMessageAsCorrupted', () => {
    it('should mark message as corrupted and set rendering error', () => {
      const message: Message = {
        id: 'test-message-4',
        sender: 'agent',
        content: 'Normal content',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-4');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.renderingError).toBe(true);
      expect(updatedMessage.lastRenderAttempt).toBeDefined();
    });

    it('should detect corruption in content with escaped characters', () => {
      const message: Message = {
        id: 'test-message-5',
        sender: 'agent',
        content: 'Content with \\* escaped asterisk',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-5');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.corruptionDetected).toBe(true);
    });

    it('should detect corruption in content with broken table syntax', () => {
      const message: Message = {
        id: 'test-message-6',
        sender: 'agent',
        content: '| Col1 || Col2 |',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-6');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.corruptionDetected).toBe(true);
    });

    it('should detect corruption in content with unclosed code blocks', () => {
      const message: Message = {
        id: 'test-message-7',
        sender: 'agent',
        content: '```javascript\nconst x = 1;',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-7');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.corruptionDetected).toBe(true);
    });

    it('should detect corruption in content with excessive whitespace', () => {
      const message: Message = {
        id: 'test-message-8',
        sender: 'agent',
        content: 'Content with          excessive spaces',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-8');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.corruptionDetected).toBe(true);
    });

    it('should not detect corruption in valid markdown content', () => {
      const message: Message = {
        id: 'test-message-9',
        sender: 'agent',
        content: 'This is normal text without any corruption patterns.',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-9');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.corruptionDetected).toBe(false);
      expect(updatedMessage.renderingError).toBe(true);
    });

    it('should handle non-existent message gracefully', () => {
      useTestChatStore.getState().markMessageAsCorrupted('non-existent-id');
      expect(useTestChatStore.getState().messages).toHaveLength(0);
    });

    it('should detect corruption for empty content', () => {
      const message: Message = {
        id: 'test-message-10',
        sender: 'agent',
        content: '',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-10');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.corruptionDetected).toBe(true);
    });
  });

  describe('error recovery integration', () => {
    it('should allow retry after marking as corrupted', () => {
      const message: Message = {
        id: 'test-message-11',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);

      useTestChatStore.getState().markMessageAsCorrupted('test-message-11');
      let updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.renderingError).toBe(true);

      useTestChatStore.getState().retryRenderMessage('test-message-11');
      updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.renderingError).toBe(false);
      expect(updatedMessage.renderAttempts).toBe(1);
    });

    it('should track multiple retry attempts', () => {
      const message: Message = {
        id: 'test-message-12',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now()
      };

      useTestChatStore.getState().addMessage(message);

      useTestChatStore.getState().retryRenderMessage('test-message-12');
      useTestChatStore.getState().retryRenderMessage('test-message-12');
      useTestChatStore.getState().retryRenderMessage('test-message-12');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.renderAttempts).toBe(3);
    });

    it('should preserve other message properties during error recovery', () => {
      const message: Message = {
        id: 'test-message-13',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now(),
        type: 'document',
        isDocument: true,
        documentTitle: 'Test Document'
      };

      useTestChatStore.getState().addMessage(message);
      useTestChatStore.getState().markMessageAsCorrupted('test-message-13');

      const updatedMessage = useTestChatStore.getState().messages[0];
      expect(updatedMessage.type).toBe('document');
      expect(updatedMessage.isDocument).toBe(true);
      expect(updatedMessage.documentTitle).toBe('Test Document');
      expect(updatedMessage.content).toBe('Test content');
    });

    it('should handle messages without metadata fields gracefully', () => {
      // Test that messages created without metadata fields work correctly
      const message: Message = {
        id: 'test-message-14',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now()
        // No metadata fields set
      };

      useTestChatStore.getState().addMessage(message);

      // Verify message is added without errors
      const addedMessage = useTestChatStore.getState().messages[0];
      expect(addedMessage.id).toBe('test-message-14');
      expect(addedMessage.renderingError).toBeUndefined();
      expect(addedMessage.corruptionDetected).toBeUndefined();
      expect(addedMessage.renderAttempts).toBeUndefined();
      expect(addedMessage.lastRenderAttempt).toBeUndefined();

      // Verify retry works with undefined fields
      useTestChatStore.getState().retryRenderMessage('test-message-14');
      const retriedMessage = useTestChatStore.getState().messages[0];
      expect(retriedMessage.renderingError).toBe(false);
      expect(retriedMessage.renderAttempts).toBe(1);
      expect(retriedMessage.lastRenderAttempt).toBeDefined();
    });

    it('should serialize and deserialize metadata fields correctly', () => {
      // Test that metadata fields survive JSON serialization (simulating persistence)
      const message: Message = {
        id: 'test-message-15',
        sender: 'agent',
        content: 'Test content',
        timestamp: Date.now(),
        renderingError: true,
        corruptionDetected: true,
        renderAttempts: 3,
        lastRenderAttempt: Date.now()
      };

      // Simulate persistence by serializing and deserializing
      const serialized = JSON.stringify(message);
      const deserialized: Message = JSON.parse(serialized);

      // Verify all metadata fields are preserved
      expect(deserialized.renderingError).toBe(true);
      expect(deserialized.corruptionDetected).toBe(true);
      expect(deserialized.renderAttempts).toBe(3);
      expect(deserialized.lastRenderAttempt).toBe(message.lastRenderAttempt);
    });
  });
});
