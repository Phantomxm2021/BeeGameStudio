/**
 * Tests for useWebSocket hook with MessageValidator integration
 * 
 * Requirements: 1.3, 1.4, 7.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { buildWebSocketUrl, useWebSocket } from './useWebSocket';
import type { WebSocketMessage } from '../types/message';

const { post, resolveAuthToken, beeGameAdapterMock, beeGameAdapterState } = vi.hoisted(() => ({
  post: vi.fn().mockResolvedValue({}),
  resolveAuthToken: vi.fn(() => ''),
  beeGameAdapterMock: {
    pollMessages: vi.fn(),
  },
  beeGameAdapterState: {
    enabled: false,
  },
}));

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'http://localhost:8000',
  default: {
    post,
  },
}));

vi.mock('../services/api', () => ({
  resolveAuthToken,
}));

vi.mock('../services/beeGameAdapter', () => ({
  beeGameAdapter: beeGameAdapterMock,
  isBeeGameAdapterEnabled: () => beeGameAdapterState.enabled,
}));

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: 1000, reason: 'Normal closure' }));
    }
  }

  // Helper method to simulate receiving a message
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  // Helper method to simulate an error
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

describe('useWebSocket with MessageValidator integration', () => {
  let mockWebSocket: MockWebSocket;

  beforeEach(() => {
    beeGameAdapterState.enabled = false;
    beeGameAdapterMock.pollMessages.mockResolvedValue({ lastEventId: 0, messages: [] });
    resolveAuthToken.mockReturnValue('');
    // Mock global WebSocket with a proper constructor function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WebSocketMock = function (this: any, url: string) {
      mockWebSocket = new MockWebSocket(url);
      return mockWebSocket;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Copy static properties
    WebSocketMock.CONNECTING = MockWebSocket.CONNECTING;
    WebSocketMock.OPEN = MockWebSocket.OPEN;
    WebSocketMock.CLOSING = MockWebSocket.CLOSING;
    WebSocketMock.CLOSED = MockWebSocket.CLOSED;

    vi.stubGlobal('WebSocket', WebSocketMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('BeeGame adapter polling', () => {
    it('recovers adapter polling without closing the active chat transport', async () => {
      beeGameAdapterState.enabled = true;
      beeGameAdapterMock.pollMessages
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue({ lastEventId: 0, messages: [] });
      const onClose = vi.fn();
      const onOpen = vi.fn();
      const showToastError = vi.fn();

      const { result } = renderHook(() =>
        useWebSocket({
          projectId: 'project-1',
          onMessage: vi.fn(),
          onClose,
          onOpen,
          showToastError,
        })
      );

      await waitFor(() => {
        expect(result.current.state).toBe('reconnecting');
      });
      await waitFor(() => {
        expect(result.current.state).toBe('connected');
      }, { timeout: 2_000 });
      expect(onClose).not.toHaveBeenCalled();
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(showToastError).not.toHaveBeenCalled();
    });

    it('re-synchronizes project state after an established poll connection recovers', async () => {
      beeGameAdapterState.enabled = true;
      beeGameAdapterMock.pollMessages
        .mockResolvedValueOnce({
          lastEventId: 1,
          messages: [{
            type: 'token',
            task_id: 'task-1',
            sender: 'agent',
            content: 'progress',
          }],
        })
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue({ lastEventId: 1, messages: [] });
      const onOpen = vi.fn();
      const onClose = vi.fn();

      const { result } = renderHook(() =>
        useWebSocket({
          projectId: 'project-1',
          onMessage: vi.fn(),
          onOpen,
          onClose,
        })
      );

      await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.state).toBe('reconnecting'), { timeout: 2_000 });
      await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2), { timeout: 3_000 });
      expect(result.current.state).toBe('connected');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Message Validation', () => {
    it('should validate and process valid messages', async () => {
      const onMessage = vi.fn();
      const validMessage: WebSocketMessage = {
        type: 'token',
        task_id: 'task-123',
        sender: 'agent',
        content: 'Hello, world!'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      // Wait for connection to open
      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      // Simulate receiving a valid message
      mockWebSocket.simulateMessage(validMessage);

      // Wait for message to be processed
      await waitFor(() => {
        expect(onMessage).toHaveBeenCalledTimes(1);
      });

      // Verify the message was sanitized and passed through
      const receivedMessage = onMessage.mock.calls[0][0];
      expect(receivedMessage.type).toBe('token');
      expect(receivedMessage.task_id).toBe('task-123');
      expect(receivedMessage.content).toBe('Hello, world!');
      expect(post).not.toHaveBeenCalled();
    });

    it('should record agent_message payloads before frontend normalization', async () => {
      const onMessage = vi.fn();
      const agentMessage: WebSocketMessage = {
        type: 'agent_message',
        task_id: 'task-123',
        sender: 'logos',
        content: 'Final reply',
        message_id: 'msg_123',
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage,
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(agentMessage);

      await waitFor(() => {
        expect(onMessage).toHaveBeenCalledTimes(1);
      });
      expect(post).toHaveBeenCalledWith(
        '/api/internal/frontend/chat-payload-log',
        expect.objectContaining({
          project_id: 'test-project',
          source: 'websocket',
          channel: 'chat_ws',
          request_context: { event_type: 'agent_message' },
          payload: agentMessage,
          frontend_context: { active_project_id: 'test-project' },
        }),
        expect.objectContaining({
          headers: { 'Hide-Error-Toast': 'true' },
        }),
      );
    });

    it('should sanitize messages with script tags', async () => {
      const onMessage = vi.fn();
      const messageWithScript: WebSocketMessage = {
        type: 'token',
        task_id: 'task-123',
        sender: 'agent',
        content: '<script>alert("xss")</script>Hello, world!'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(messageWithScript);

      await waitFor(() => {
        expect(onMessage).toHaveBeenCalledTimes(1);
      });

      // Verify script tags were removed
      const receivedMessage = onMessage.mock.calls[0][0];
      expect(receivedMessage.content).not.toContain('<script>');
      expect(receivedMessage.content).toContain('Hello, world!');
    });

    it('should reject messages with missing required fields', async () => {
      const onMessage = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      const invalidMessage = {
        // Missing type and task_id
        content: 'Hello, world!'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(invalidMessage);

      // Wait a bit to ensure message processing is attempted
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify message was rejected
      expect(onMessage).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocket] Invalid message received:'),
        expect.any(Object)
      );
      expect(post).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should not record non-agent websocket events', async () => {
      const onMessage = vi.fn();
      const usageMessage: WebSocketMessage = {
        type: 'usage',
        task_id: 'task-usage',
        sender: 'logos',
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          total_tokens: 3,
        },
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage,
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(usageMessage);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(post).not.toHaveBeenCalled();
    });

    it('should dedupe repeated agent_message payloads', async () => {
      const onMessage = vi.fn();
      const agentMessage: WebSocketMessage = {
        type: 'agent_message',
        task_id: 'task-123',
        sender: 'logos',
        content: 'Final reply',
        message_id: 'msg_repeat',
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage,
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(agentMessage);
      mockWebSocket.simulateMessage(agentMessage);

      await waitFor(() => {
        expect(onMessage).toHaveBeenCalledTimes(2);
      });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('should keep processing agent_message when recorder request fails', async () => {
      const onMessage = vi.fn();
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
      post.mockRejectedValueOnce(new Error('log failed'));
      const agentMessage: WebSocketMessage = {
        type: 'agent_message',
        task_id: 'task-123',
        sender: 'logos',
        content: 'Final reply',
        message_id: 'msg_fail_once',
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage,
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(agentMessage);

      await waitFor(() => {
        expect(onMessage).toHaveBeenCalledTimes(1);
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[useWebSocket] Failed to record agent_message payload:',
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should detect and log corruption warnings', async () => {
      const onMessage = vi.fn();
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      const corruptedMessage: WebSocketMessage = {
        type: 'token',
        task_id: 'task-123',
        sender: 'agent',
        content: '| Col1 | Col2\n|------|------\n| A | B' // Missing closing pipes
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(corruptedMessage);

      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[WebSocket] Message validation warnings:'),
          expect.objectContaining({
            corruptionDetected: true
          })
        );
      });

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Content Repair', () => {
    it('should attempt to repair corrupted content', async () => {
      const onMessage = vi.fn();
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      const corruptedMessage: WebSocketMessage = {
        type: 'token',
        task_id: 'task-123',
        sender: 'agent',
        content: '```\nunclosed code block' // Missing closing ```
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(corruptedMessage);

      // Wait for message to be processed
      await waitFor(() => {
        expect(onMessage).toHaveBeenCalledTimes(1);
      });

      // Verify corruption warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocket] Message validation warnings:'),
        expect.objectContaining({
          corruptionDetected: true
        })
      );

      // Verify message was still processed (corruption is a warning, not an error)
      const receivedMessage = onMessage.mock.calls[0][0];
      expect(receivedMessage.content).toContain('unclosed code block');

      consoleWarnSpy.mockRestore();
    });

    it('should handle repair failures gracefully', async () => {
      const onMessage = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      // Create a message that will fail validation even after repair
      const invalidMessage = {
        type: 'invalid_type', // Invalid type that won't be fixed by repair
        task_id: 'task-123',
        content: '```\nunclosed code block'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(invalidMessage);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify message was rejected
      expect(onMessage).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocket] Invalid message received:'),
        expect.any(Object)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Retransmission Request', () => {
    it('should NOT request retransmission for messages with only warnings (missing task_id)', async () => {
      const onMessage = vi.fn();

      const messageWithWarning = {
        type: 'token',
        // Missing task_id (warning in v1.4.0)
        content: 'Hello, world!'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(messageWithWarning);

      // Wait a bit to ensure no retransmission is sent
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify message WAS processed
      expect(onMessage).toHaveBeenCalled();
      // Verify NO retransmission request was sent
      expect(mockWebSocket.sentMessages).toHaveLength(0);
    });

    it('should request retransmission for hard validation errors (missing type)', async () => {
      const onMessage = vi.fn();

      const invalidMessage = {
        // Missing type (hard error)
        task_id: 'task-123',
        content: 'Hello, world!'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(invalidMessage);

      // Wait for retransmission request to be sent
      await waitFor(() => {
        expect(mockWebSocket.sentMessages.length).toBeGreaterThan(0);
      });

      // Verify retransmission request was sent
      const retransmitRequest = JSON.parse(mockWebSocket.sentMessages[0]);
      expect(retransmitRequest.type).toBe('retransmit_request');
      expect(retransmitRequest.reason).toBe('validation_failed');
    });

    it('should handle retransmission request send failures', async () => {
      const onMessage = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      // Mock send to throw an error
      const originalSend = MockWebSocket.prototype.send;
      MockWebSocket.prototype.send = vi.fn(() => {
        throw new Error('Send failed');
      });

      const invalidMessage = {
        type: 'token',
        // Non-string task_id is still a hard error
        task_id: 123,
        content: 'Hello, world!'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(invalidMessage);

      // Wait for error to be logged
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('[WebSocket] Failed to send retransmission request:'),
          expect.any(Error)
        );
      });

      // Restore original send
      MockWebSocket.prototype.send = originalSend;
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Error Logging', () => {
    it('should log detailed error information for validation failures', async () => {
      const onMessage = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      const invalidMessage = {
        type: 'invalid_type',
        task_id: 123, // Wrong type (should be string)
        content: 'Hello, world!'
      };

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      mockWebSocket.simulateMessage(invalidMessage);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('[WebSocket] Invalid message received:'),
          expect.objectContaining({
            taskId: 123,
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: expect.any(String),
                message: expect.any(String)
              })
            ]),
            rawMessage: expect.any(Object)
          })
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('should log parse errors with raw data', async () => {
      const onMessage = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
      });

      // Simulate receiving invalid JSON
      if (mockWebSocket.onmessage) {
        mockWebSocket.onmessage(new MessageEvent('message', { data: 'invalid json' }));
      }

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('[WebSocket] Failed to parse message:'),
          expect.objectContaining({
            error: expect.any(Error),
            rawData: 'invalid json'
          })
        );
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Connection URL', () => {
    it('should derive websocket URL from API base URL when websocket base is not configured', () => {
      expect(buildWebSocketUrl('', 'proj-123', 'http://10.211.55.6:8000')).toBe('ws://10.211.55.6:8000/ws/chat/proj-123');
      expect(buildWebSocketUrl('', 'proj-123', 'https://api.example.test')).toBe('wss://api.example.test/ws/chat/proj-123');
    });

    it('should append auth token to websocket query string', async () => {
      resolveAuthToken.mockReturnValue('test-token-123');
      const onMessage = vi.fn();

      renderHook(() =>
        useWebSocket({
          projectId: 'test-project',
          onMessage,
          baseUrl: 'ws://10.211.55.6:8000',
        })
      );

      await waitFor(() => {
        expect(mockWebSocket.url).toBe('ws://10.211.55.6:8000/ws/chat/test-project?token=test-token-123');
      });
    });
  });
});
