/**
 * Project event transport.
 *
 * BeeGame uses an authenticated SSE stream for live project events and keeps
 * cursor-based polling as a compatibility fallback. Both transports resume
 * from the server-persisted event cursor after tab suspension or reconnects.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectEventMessage } from '../types/message';
import { isAuthenticationServiceUnavailable } from '../services/apiClient';
import { beeGameAdapter } from '../services/beeGameAdapter';

export type ProjectEventPollingState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface UseProjectEventPollingOptions {
  enabled?: boolean;
  projectId: string;
  onMessage: (message: ProjectEventMessage) => void;
  onClose?: () => void;
  onOpen?: () => void;
  showToastError?: (message: string) => void;
}

export interface UseProjectEventPollingReturn {
  state: ProjectEventPollingState;
  reconnectAttempts: number;
  reconnect: () => void;
  disconnect: () => void;
}

export const useProjectEventPolling = ({
  projectId,
  enabled = true,
  onMessage,
  onClose,
  onOpen,
  showToastError,
}: UseProjectEventPollingOptions): UseProjectEventPollingReturn => {
  const [state, setState] = useState<ProjectEventPollingState>('connecting');
  const [generation, setGeneration] = useState(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const callbacksRef = useRef({ onMessage, onClose, onOpen, showToastError });
  const disconnectedRef = useRef(false);
  const cursorRef = useRef({ projectId, value: 0 });

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
    if (!enabled || !projectId || disconnectedRef.current) return;

    let cancelled = false;
    if (cursorRef.current.projectId !== projectId) cursorRef.current = { projectId, value: 0 };
    let lastEventId = cursorRef.current.value;
    let idlePolls = 0;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let streamAbortController: AbortController | null = null;
    let usePollingFallback = typeof beeGameAdapter.streamMessages !== 'function';
    queueMicrotask(() => {
      if (!cancelled && !disconnectedRef.current) setState('connecting');
    });

    const schedule = (task: () => void, delayMs: number) => {
      if (cancelled || disconnectedRef.current) return;
      timer = setTimeout(task, delayMs);
    };

    const markConnected = () => {
      if (cancelled || disconnectedRef.current) return;
      const recovered = reconnectAttemptsRef.current > 0;
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
      if (!connected || recovered) {
        connected = true;
        setState('connected');
        callbacksRef.current.onOpen?.();
      }
    };

    const poll = async () => {
      if (cancelled || disconnectedRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(() => void poll(), 5_000);
        return;
      }

      try {
        const result = await beeGameAdapter.pollMessages(projectId, lastEventId);
        // The request can resolve after a project switch, disconnect, or
        // explicit reconnect. Return before touching polling state or reading
        // callbacksRef so a stale response cannot notify the next project.
        if (cancelled || disconnectedRef.current) return;
        result.messages.forEach(message => callbacksRef.current.onMessage(message));
        lastEventId = result.lastEventId;
        cursorRef.current.value = lastEventId;
        idlePolls = result.messages.length > 0 ? 0 : idlePolls + 1;
        markConnected();
        schedule(
          () => void poll(),
          result.messages.length > 0 ? 800 : Math.min(5_000, 1_000 + idlePolls * 500),
        );
      } catch (error) {
        if (cancelled || disconnectedRef.current) return;
        reconnectAttemptsRef.current += 1;
        setReconnectAttempts(reconnectAttemptsRef.current);
        setState('reconnecting');
        if (!isAuthenticationServiceUnavailable(error)) {
          console.warn('[ProjectEvents] Poll failed:', error);
        }
        if (reconnectAttemptsRef.current === 3) {
          callbacksRef.current.showToastError?.(isAuthenticationServiceUnavailable(error)
            ? '登录验证服务暂时不可用，正在自动恢复连接'
            : 'BeeGame 连接暂时不可用，正在自动重连');
        }
        schedule(
          () => void poll(),
          reconnectDelay(error, reconnectAttemptsRef.current),
        );
      }
    };

    const stream = async () => {
      if (cancelled || disconnectedRef.current || usePollingFallback) return;
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(() => void stream(), 5_000);
        return;
      }
      streamAbortController = new AbortController();
      try {
        await beeGameAdapter.streamMessages(
          projectId,
          lastEventId,
          {
            onOpen: markConnected,
            onCursor: eventId => {
              if (cancelled || disconnectedRef.current) return;
              lastEventId = Math.max(lastEventId, eventId);
              cursorRef.current.value = lastEventId;
            },
            onMessage: message => { if (!cancelled && !disconnectedRef.current) callbacksRef.current.onMessage(message); },
          },
          streamAbortController.signal,
        );
        if (cancelled || disconnectedRef.current) return;
        schedule(() => void stream(), 0);
      } catch (error) {
        if (cancelled || disconnectedRef.current) return;
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? (error as { status?: unknown }).status
          : undefined;
        if (status === 404 || status === 405) {
          usePollingFallback = true;
          void poll();
          return;
        }
        reconnectAttemptsRef.current += 1;
        setReconnectAttempts(reconnectAttemptsRef.current);
        setState('reconnecting');
        if (!isAuthenticationServiceUnavailable(error)) {
          console.warn('[ProjectEvents] SSE failed:', error);
        }
        if (reconnectAttemptsRef.current === 3) {
          callbacksRef.current.showToastError?.(isAuthenticationServiceUnavailable(error)
            ? '登录验证服务暂时不可用，正在自动恢复连接'
            : 'BeeGame 连接暂时不可用，正在自动重连');
        }
        schedule(
          () => void stream(),
          reconnectDelay(error, reconnectAttemptsRef.current),
        );
      } finally {
        streamAbortController = null;
      }
    };

    if (usePollingFallback) void poll();
    else void stream();
    const onVisible = () => {
      if (!document.hidden && !cancelled && !disconnectedRef.current) setGeneration(value => value + 1);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearTimeout(timer);
      streamAbortController?.abort();
    };
  }, [enabled, generation, projectId]);

  return {
    state,
    reconnectAttempts,
    reconnect,
    disconnect,
  };
};

function reconnectDelay(error: unknown, attempts: number): number {
  const retryAfterMs = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  const suggestedDelay = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
    ? Math.max(0, Math.min(60_000, retryAfterMs)) : 0;
  return Math.max(suggestedDelay, Math.min(15_000, 500 * 2 ** Math.min(attempts - 1, 5)));
}
