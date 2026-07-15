/**
 * useWebSocket Hook
 * 
 * Manages WebSocket connections for real-time communication with the backend.
 * 
 * Features:
 * - Automatic connection establishment
 * - Message receiving and parsing
 * - Auto-reconnect logic (max 3 attempts)
 * - Connection state management
 * - Proper cleanup on unmount
 * 
 * Requirements: 1.2, 9.1, 9.2, 9.3, 9.5
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { WebSocketMessage } from '../types/message';
import { resolveAuthToken } from '../services/api';
import apiClient, { API_BASE_URL } from '../services/apiClient';
import { beeGameAdapter, isBeeGameAdapterEnabled } from '../services/beeGameAdapter';
import { messageValidator } from '../utils/messageValidator';
import { errorLogger } from '../utils/errorLogger';

// WebSocket base URL from environment variables
const WS_BASE_URL = String(import.meta.env.VITE_WS_BASE_URL || '').trim();

// Maximum reconnection attempts from environment variables
const MAX_RECONNECT_ATTEMPTS = parseInt(
  import.meta.env.VITE_WS_MAX_RECONNECT_ATTEMPTS || '3',
  10
);
const CHAT_PAYLOAD_LOG_ENDPOINT = '/api/internal/frontend/chat-payload-log';
const RECORDED_MESSAGE_KEY_LIMIT = 300;
const recordedAgentMessageKeys = new Set<string>();
const recordedAgentMessageOrder: string[] = [];

/**
 * WebSocket connection state
 */
export type WebSocketState =
  | 'connecting'    // Initial connection attempt
  | 'connected'     // Successfully connected
  | 'reconnecting'  // Temporarily unavailable; polling will resume
  | 'disconnected'  // Disconnected (may retry)
  | 'failed';       // Failed after max retries

/**
 * Options for useWebSocket hook
 */
export interface UseWebSocketOptions {
  /** Project ID for the WebSocket connection */
  projectId: string;

  /** Callback when a message is received */
  onMessage: (message: WebSocketMessage) => void;

  /** Callback when an error occurs (optional) */
  onError?: (error: Event) => void;

  /** Callback when connection closes (optional) */
  onClose?: () => void;

  /** Callback when connection opens (optional) */
  onOpen?: () => void;

  /** Base WebSocket URL (optional, defaults to env variable or current origin) */
  baseUrl?: string;

  /** Maximum reconnection attempts (optional, defaults to env variable or 3) */
  maxReconnectAttempts?: number;

  /** Reconnection delay in milliseconds (optional, defaults to 2000) */
  reconnectDelay?: number;

  /** Toast notification callback for errors (optional) */
  showToastError?: (message: string) => void;
}

/**
 * Return type for useWebSocket hook
 */
export interface UseWebSocketReturn {
  /** Current WebSocket instance (may be null) */
  ws: WebSocket | null;

  /** Current connection state */
  state: WebSocketState;

  /** Number of reconnection attempts made */
  reconnectAttempts: number;

  /** Manually trigger reconnection */
  reconnect: () => void;

  /** Manually close the connection */
  disconnect: () => void;
}

const deriveWebSocketBaseUrl = (apiBaseUrl: string): string => {
  if (!apiBaseUrl && typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  try {
    const url = new URL(apiBaseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return 'ws://localhost:62174';
  }
};

export const buildWebSocketUrl = (baseUrl: string, projectId: string, apiBaseUrl: string = API_BASE_URL): string => {
  const token = resolveAuthToken();
  const resolvedBaseUrl = (baseUrl || deriveWebSocketBaseUrl(apiBaseUrl)).replace(/\/$/, '');
  try {
    const url = new URL(`${resolvedBaseUrl}/ws/chat/${projectId}`);
    if (token) {
      url.searchParams.set('token', token);
    }
    return url.toString();
  } catch {
    const encodedProjectId = encodeURIComponent(projectId);
    const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${resolvedBaseUrl}/ws/chat/${encodedProjectId}${suffix}`;
  }
};

const buildAgentMessageRecordKey = (projectId: string, message: WebSocketMessage): string | null => {
  if (message.type !== 'agent_message') {
    return null;
  }
  const messageId = String(message.message_id ?? '').trim();
  if (messageId) {
    return `${projectId}:message_id:${messageId}`;
  }
  const taskId = String(message.task_id ?? '').trim();
  const sender = String(message.sender ?? '').trim();
  const content = String(message.content ?? '').trim();
  const timestamp = String((message as WebSocketMessage & { timestamp?: unknown }).timestamp ?? '').trim();
  return `${projectId}:fallback:${message.type}:${taskId}:${sender}:${content}:${timestamp}`;
};

const shouldRecordAgentMessage = (projectId: string, message: WebSocketMessage): boolean => {
  const key = buildAgentMessageRecordKey(projectId, message);
  if (!key) {
    return false;
  }
  if (recordedAgentMessageKeys.has(key)) {
    return false;
  }
  recordedAgentMessageKeys.add(key);
  recordedAgentMessageOrder.push(key);
  if (recordedAgentMessageOrder.length > RECORDED_MESSAGE_KEY_LIMIT) {
    const evicted = recordedAgentMessageOrder.shift();
    if (evicted) {
      recordedAgentMessageKeys.delete(evicted);
    }
  }
  return true;
};

const recordAgentMessagePayload = async (
  projectId: string,
  rawMessage: WebSocketMessage,
): Promise<void> => {
  try {
    await apiClient.post(
      CHAT_PAYLOAD_LOG_ENDPOINT,
      {
        project_id: projectId,
        source: 'websocket',
        channel: 'chat_ws',
        request_context: {
          event_type: 'agent_message',
        },
        payload: rawMessage,
        recorded_at: new Date().toISOString(),
        frontend_context: {
          active_project_id: projectId,
        },
      },
      {
        headers: {
          'Hide-Error-Toast': 'true',
        },
      },
    );
  } catch (error) {
    console.warn('[useWebSocket] Failed to record agent_message payload:', error);
  }
};

/**
 * Custom hook for managing WebSocket connections
 * 
 * @param options - Configuration options for the WebSocket connection
 * @returns WebSocket instance and connection state
 * 
 * @example
 * ```typescript
 * const { ws, state, reconnect } = useWebSocket({
 *   projectId: 'project-123',
 *   onMessage: (message) => {
 *     console.log('Received:', message);
 *   },
 *   onError: (error) => {
 *     console.error('WebSocket error:', error);
 *   }
 * });
 * ```
 */
export const useWebSocket = ({
  projectId,
  onMessage,
  onError,
  onClose,
  onOpen,
  baseUrl = WS_BASE_URL,
  maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS,
  reconnectDelay = 2000,
  showToastError
}: UseWebSocketOptions): UseWebSocketReturn => {
  // WebSocket instance reference
  const wsRef = useRef<WebSocket | null>(null);

  // Reconnection attempts counter
  const reconnectAttemptsRef = useRef(0);

  // Reconnection timer reference
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flag to prevent reconnection after manual disconnect
  const shouldReconnectRef = useRef(true);

  // Connection state
  const [state, setState] = useState<WebSocketState>('connecting');

  // Ref to tracking connect function
  const connectRef = useRef<(() => void) | null>(null);
  const adapterPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adapterLastEventIdRef = useRef(0);
  const adapterIdlePollsRef = useRef(0);

  // Keep track of the latest callbacks to avoid re-connecting WebSocket when they change
  const callbacksRef = useRef({ onMessage, onError, onClose, onOpen, showToastError });

  useEffect(() => {
    callbacksRef.current = { onMessage, onError, onClose, onOpen, showToastError };
  });

  /**
   * Establish WebSocket connection
   */
  const connect = useCallback(() => {
    if (isBeeGameAdapterEnabled()) {
      setState('connected');
      callbacksRef.current.onOpen?.();
      return;
    }

    // Clear any existing reconnection timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      setState('connecting');

      // Browsers cannot reliably attach Authorization headers to WebSocket handshakes,
      // so reuse the REST auth token via query string when auth is enabled.
      const wsUrl = buildWebSocketUrl(baseUrl, projectId);
      console.debug('[WebSocket] Connecting:', { projectId, wsUrl, baseUrl, apiBaseUrl: API_BASE_URL });
      const ws = new WebSocket(wsUrl);

      // Connection opened
      ws.onopen = () => {
        console.log(`[WebSocket] Connected to project: ${projectId}`);
        setState('connected');
        reconnectAttemptsRef.current = 0;
        callbacksRef.current.onOpen?.();
      };

      // Message received
      ws.onmessage = (event) => {
        try {
          const rawMessage: WebSocketMessage = JSON.parse(event.data);
          console.debug('[WS raw message]', rawMessage);
          if (shouldRecordAgentMessage(projectId, rawMessage)) {
            void recordAgentMessagePayload(projectId, rawMessage);
          }

          // Validate message using MessageValidator
          // Requirements: 1.3, 1.4, 7.3
          const validationResult = messageValidator.validateMessage(rawMessage);

          // Log validation warnings
          if (validationResult.warnings.length > 0) {
            console.warn('[WebSocket] Message validation warnings:', {
              taskId: rawMessage.task_id,
              warnings: validationResult.warnings,
              corruptionDetected: validationResult.corruptionDetected
            });
          }

          // Handle validation failures
          if (!validationResult.isValid) {
            console.error('[WebSocket] Invalid message received:', {
              taskId: rawMessage.task_id,
              errors: validationResult.errors,
              rawMessage: rawMessage
            });

            // Attempt to repair corrupted content if corruption was detected
            if (validationResult.corruptionDetected && rawMessage.content) {
              console.log('[WebSocket] Attempting to repair corrupted content...');
              const repairedContent = messageValidator.repairContent(rawMessage.content);

              // Re-validate repaired message
              const repairedMessage = { ...rawMessage, content: repairedContent };
              const revalidationResult = messageValidator.validateMessage(repairedMessage);

              if (revalidationResult.isValid) {
                console.log('[WebSocket] Content repair successful');
                callbacksRef.current.onMessage(revalidationResult.sanitizedMessage!);
                return;
              } else {
                console.error('[WebSocket] Content repair failed, validation still failing');
              }
            }

            // Request retransmission for invalid messages
            // Requirements: 1.4
            console.log('[WebSocket] Requesting retransmission for task:', rawMessage.task_id);
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              try {
                wsRef.current.send(JSON.stringify({
                  type: 'retransmit_request',
                  task_id: rawMessage.task_id,
                  reason: 'validation_failed',
                  errors: validationResult.errors.map(e => e.message)
                }));
              } catch (sendError) {
                console.error('[WebSocket] Failed to send retransmission request:', sendError);
              }
            }

            return; // Skip processing invalid message
          }

          // Process validated and sanitized message
          // Requirements: 6.2
          callbacksRef.current.onMessage(validationResult.sanitizedMessage || rawMessage);

        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', {
            error,
            rawData: event.data
          });
          errorLogger.error('transmission', 'Failed to parse WebSocket message', {
            error: error instanceof Error ? error.message : String(error),
            rawDataPreview: typeof event.data === 'string' ? event.data.substring(0, 200) : 'Non-string data'
          });
        }
      };

      // Error occurred
      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        errorLogger.error('transmission', 'WebSocket error occurred', {
          projectId,
          error: error.toString()
        });
        callbacksRef.current.onError?.(error);
      };

      // Connection closed
      ws.onclose = (event) => {
        console.log(`[WebSocket] Closed: ${event.code} ${event.reason}`);
        wsRef.current = null;
        callbacksRef.current.onClose?.();

        // Log connection closure
        errorLogger.info('transmission', 'WebSocket connection closed', {
          projectId,
          code: event.code,
          reason: event.reason || 'No reason provided'
        });

        // Attempt reconnection if not manually disconnected
        if (shouldReconnectRef.current) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            setState('disconnected');

            console.log(
              `[WebSocket] Reconnecting... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
            );

            errorLogger.warn('transmission', 'Attempting WebSocket reconnection', {
              projectId,
              attempt: reconnectAttemptsRef.current,
              maxAttempts: maxReconnectAttempts
            });

            // Schedule reconnection with exponential backoff
            // 1s -> 2s -> 4s -> 8s -> 16s -> ... max 30s
            // Requirements: 8.2
            const delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);

            reconnectTimerRef.current = setTimeout(() => {
              if (shouldReconnectRef.current) {
                // Safely invoke recursively
                connectRef.current?.();
              }
            }, delay);

          } else {
            console.error('[WebSocket] Max reconnection attempts reached');
            setState('failed');

            errorLogger.error('transmission', 'WebSocket max reconnection attempts reached', {
              projectId,
              attempts: reconnectAttemptsRef.current
            });

            // Show toast notification for connection failure
            // Requirements: 12.2
            if (callbacksRef.current.showToastError) {
              callbacksRef.current.showToastError('无法连接到服务器，请检查网络连接');
            }
          }
        } else {
          setState('disconnected');
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setState('failed');
    }
  }, [projectId, baseUrl, maxReconnectAttempts, reconnectDelay]);

  // Update connect ref for recursive setTimeout usage
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /**
   * Manually trigger reconnection
   */
  const reconnect = useCallback(() => {
    if (isBeeGameAdapterEnabled()) {
      console.log('[WebSocket] BeeGame adapter reconnection triggered');
      setState('connected');
      callbacksRef.current.onOpen?.();
      return;
    }

    console.log('[WebSocket] Manual reconnection triggered');
    reconnectAttemptsRef.current = 0;
    shouldReconnectRef.current = true;
    connect();
  }, [connect]);

  /**
   * Manually close the connection
   */
  const disconnect = useCallback(() => {
    if (isBeeGameAdapterEnabled()) {
      console.log('[WebSocket] BeeGame adapter disconnect');
      if (adapterPollTimerRef.current) {
        clearTimeout(adapterPollTimerRef.current);
        adapterPollTimerRef.current = null;
      }
      setState('disconnected');
      callbacksRef.current.onClose?.();
      return;
    }

    console.log('[WebSocket] Manual disconnect');
    shouldReconnectRef.current = false;

    // Clear reconnection timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close WebSocket connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState('disconnected');
  }, []);

  /**
   * Initialize connection on mount and cleanup on unmount
   */
  useEffect(() => {
    if (isBeeGameAdapterEnabled()) {
      let cancelled = false;
      let consecutiveFailures = 0;
      let hasConnected = false;
      adapterLastEventIdRef.current = 0;
      adapterIdlePollsRef.current = 0;
      setState('connecting');

      const schedulePoll = (delayMs: number) => {
        if (cancelled) return;
        adapterPollTimerRef.current = setTimeout(() => {
          adapterPollTimerRef.current = null;
          void poll();
        }, delayMs);
      };

      const poll = async () => {
        if (cancelled) return;
        if (document.hidden) {
          schedulePoll(5000);
          return;
        }
        try {
          const result = await beeGameAdapter.pollMessages(projectId, adapterLastEventIdRef.current);
          const recovered = consecutiveFailures > 0;
          consecutiveFailures = 0;
          adapterLastEventIdRef.current = result.lastEventId;
          for (const message of result.messages) {
            callbacksRef.current.onMessage(message);
          }
          if (result.messages.length > 0) {
            adapterIdlePollsRef.current = 0;
          } else {
            adapterIdlePollsRef.current += 1;
          }
          const nextDelay = result.messages.length > 0
            ? 800
            : Math.min(5000, 1000 + adapterIdlePollsRef.current * 500);
          if (!hasConnected || recovered) {
            hasConnected = true;
            setState('connected');
            callbacksRef.current.onOpen?.();
          }
          schedulePoll(nextDelay);
        } catch (error) {
          if (cancelled) return;
          consecutiveFailures += 1;
          console.warn('[WebSocket] BeeGame adapter poll failed:', error);
          setState('reconnecting');
          if (consecutiveFailures === 3) {
            callbacksRef.current.showToastError?.('BeeGame 连接暂时不可用，正在自动重连');
          }
          const retryDelay = Math.min(15_000, 500 * 2 ** Math.min(consecutiveFailures - 1, 5));
          schedulePoll(retryDelay);
        }
      };

      void poll();

      return () => {
        cancelled = true;
        if (adapterPollTimerRef.current) {
          clearTimeout(adapterPollTimerRef.current);
          adapterPollTimerRef.current = null;
        }
        callbacksRef.current.onClose?.();
      };
    }

    shouldReconnectRef.current = true;
    connect();

    // Cleanup on unmount or projectId change
    return () => {
      shouldReconnectRef.current = false;

      // Clear reconnection timer
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  /* eslint-disable react-hooks/refs */
  return {
    ws: wsRef.current,
    state,
    reconnectAttempts: reconnectAttemptsRef.current,
    reconnect,
    disconnect
  };
  /* eslint-enable react-hooks/refs */
};
