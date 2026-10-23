import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import { isAuthenticationServiceUnavailable } from '../services/apiClient';
import { authRetryDelay } from '../services/authRetry';

interface RuntimeRefreshOptions {
  projectId: string;
  enabled: boolean;
  userId?: string;
  isBusy: boolean;
  loadRuntime: (projectId: string) => Promise<void>;
  showWarning: (message: string) => void;
  timeoutMessage: string;
  failureMessage: string;
}

const significantEvents = new Set([
  'status_finished', 'status_failed', 'tool_start', 'tool_end',
  'human_gate', 'error', 'permission_resolved',
]);

const logReadError = (label: string, error: unknown) => {
  if (!isAuthenticationServiceUnavailable(error)) console.error(label, error);
};

/** Owns automatic runtime reads only; billing and preview/deployment mutations stay with their callers. */
export function useProjectRuntimeRefresh({
  projectId, enabled, userId, isBusy, loadRuntime, showWarning, timeoutMessage, failureMessage,
}: RuntimeRefreshOptions) {
  const scheduleRef = useRef<((type: string) => void) | null>(null);
  const isBusyNow = useEffectEvent(() => isBusy);
  const warnInitial = useEffectEvent((error?: unknown, timedOut = false) => {
    const message = timedOut ? timeoutMessage
      : error instanceof Error && error.message ? error.message
      : typeof error === 'string' && error.trim() ? error : failureMessage;
    showWarning(message);
  });

  useEffect(() => {
    if (!enabled || !projectId) return;
    let active = true;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    let usageTimer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    let authFailures = 0;
    let retryAt = 0;
    let initialPending = true;
    const initialTimer = setTimeout(() => {
      if (!active || !initialPending) return;
      initialPending = false;
      warnInitial(undefined, true);
    }, 10_000);
    const finishInitial = (failed: boolean, error?: unknown) => {
      clearTimeout(initialTimer);
      if (!active || !initialPending) return;
      initialPending = false;
      if (failed) warnInitial(error);
    };
    void loadRuntime(projectId).then(
      () => finishInitial(false), error => finishInitial(true, error),
    );

    const refreshForEvent = (label: string) => {
      if (active) void loadRuntime(projectId).catch(error => {
        if (active) logReadError(label, error);
      });
    };
    scheduleRef.current = type => {
      if (type === 'usage' && usageTimer === undefined) {
        usageTimer = setTimeout(() => {
          usageTimer = undefined;
          refreshForEvent('Failed to refresh project usage:');
        }, 2500);
      }
      if (significantEvents.has(type)) {
        clearTimeout(eventTimer);
        eventTimer = setTimeout(() => {
          eventTimer = undefined;
          refreshForEvent('Failed to refresh project runtime state:');
        }, 2000);
      }
    };

    const poll = () => {
      if (!active || document.hidden || polling || Date.now() < retryAt || !isBusyNow()) return;
      polling = true;
      void loadRuntime(projectId).then(() => {
        authFailures = 0;
        retryAt = 0;
      }).catch(error => {
        if (!active) return;
        if (isAuthenticationServiceUnavailable(error)) {
          retryAt = Date.now() + authRetryDelay(++authFailures, error);
        }
        logReadError('Failed to poll project runtime state:', error);
      }).finally(() => { polling = false; });
    };
    const interval = setInterval(poll, 1000);
    const onVisibilityChange = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      scheduleRef.current = null;
      clearTimeout(initialTimer);
      clearTimeout(eventTimer);
      clearTimeout(usageTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [projectId, enabled, userId, loadRuntime]);

  return useCallback((type: string) => { scheduleRef.current?.(type); }, []);
}
