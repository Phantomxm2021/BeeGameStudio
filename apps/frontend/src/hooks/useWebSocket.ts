/**
 * Project event transport.
 *
 * The public hook name is retained for component compatibility, but BeeGame
 * has one canonical transport: polling the server-persisted BeeGame event
 * stream. The browser must not open a second chat WebSocket or mirror native
 * events into another frontend-owned log.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebSocketMessage } from '../types/message';
import { isAuthenticationServiceUnavailable } from '../services/apiClient';
import { beeGameAdapter } from '../services/beeGameAdapter';

export type WebSocketState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface UseWebSocketOptions {
  projectId: string;
  onMessage: (message: WebSocketMessage) => void;
  onError?: (error: Event) => void;
  onClose?: () => void;
  onOpen?: () => void;
  baseUrl?: string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  showToastError?: (message: string) => void;
}

export interface UseWebSocketReturn {
  ws: WebSocket | null;
  state: WebSocketState;
  reconnectAttempts: number;
  reconnect: () => void;
  disconnect: () => void;
}

export const useWebSocket = ({
  projectId,
  onMessage,
  onClose,
  onOpen,
  showToastError,
}: UseWebSocketOptions): UseWebSocketReturn => {
  const [state, setState] = useState<WebSocketState>('connecting');
  const [generation, setGeneration] = useState(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const callbacksRef = useRef({ onMessage, onClose, onOpen, showToastError });
  const disconnectedRef = useRef(false);

  useEffect(() => {
    callbacksRef.current = { onMessage, onClose, onOpen, showToastError };
  }, [onMessage, onClose, onOpen, showToastError]);

  const reconnect = useCallback(() => {
    disconnectedRef.current = false;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setState('connecting');
    setGeneration(value => value + 1);
  }, []);

  const disconnect = useCallback(() => {
    disconnectedRef.current = true;
    setState('disconnected');
    setGeneration(value => value + 1);
    callbacksRef.current.onClose?.();
  }, []);

  useEffect(() => {
    if (!projectId || disconnectedRef.current) return;

    let cancelled = false;
    let lastEventId = 0;
    let idlePolls = 0;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    queueMicrotask(() => {
      if (!cancelled && !disconnectedRef.current) setState('connecting');
    });

    const schedule = (delayMs: number) => {
      if (cancelled || disconnectedRef.current) return;
      timer = setTimeout(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (cancelled || disconnectedRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(5_000);
        return;
      }

      try {
        const result = await beeGameAdapter.pollMessages(projectId, lastEventId);
        const recovered = reconnectAttemptsRef.current > 0;
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);
        lastEventId = result.lastEventId;
        result.messages.forEach(message => callbacksRef.current.onMessage(message));
        idlePolls = result.messages.length > 0 ? 0 : idlePolls + 1;

        if (!connected || recovered) {
          connected = true;
          setState('connected');
          callbacksRef.current.onOpen?.();
        }

        schedule(result.messages.length > 0 ? 800 : Math.min(5_000, 1_000 + idlePolls * 500));
      } catch (error) {
        if (cancelled || disconnectedRef.current) return;
        reconnectAttemptsRef.current += 1;
        setReconnectAttempts(reconnectAttemptsRef.current);
        setState('reconnecting');
        if (!isAuthenticationServiceUnavailable(error)) {
          console.warn('[ProjectEvents] Poll failed:', error);
        }
        if (reconnectAttemptsRef.current === 3) {
          callbacksRef.current.showToastError?.('BeeGame 连接暂时不可用，正在自动重连');
        }
        schedule(Math.min(15_000, 500 * 2 ** Math.min(reconnectAttemptsRef.current - 1, 5)));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [generation, projectId]);

  return {
    ws: null,
    state,
    reconnectAttempts,
    reconnect,
    disconnect,
  };
};
