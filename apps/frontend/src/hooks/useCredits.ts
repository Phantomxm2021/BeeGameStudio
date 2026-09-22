import { useCallback, useEffect, useRef, useState } from 'react';
import { isAuthenticationServiceUnavailable } from '../services/apiClient';
import { getCreditBalance, getCreditSummary, type BeeGameCreditBalance, type BeeGameUsageSummary } from '../services/creditsApi';

type CreditRefresh = {
  projectId: string | undefined;
  pending?: Promise<void>;
  failures: number;
  nextAttemptAt: number;
  unauthorized: boolean;
};

/** One refresh gate for polling, usage events and focus, scoped to this login/project. */
export function useCredits(projectId: string | undefined, enabled: boolean, userId?: string) {
  const [creditBalance, setCreditBalance] = useState<BeeGameCreditBalance | null>(null);
  const [creditSummary, setCreditSummary] = useState<BeeGameUsageSummary | null>(null);
  const current = useRef<CreditRefresh | null>(null);

  const refreshCredits = useCallback((): Promise<void> => {
    const scope = current.current;
    if (!scope || scope.unauthorized || Date.now() < scope.nextAttemptAt || document.hidden) return Promise.resolve();
    if (scope.pending) return scope.pending;
    const request = (async () => {
      const [summary, balance] = await Promise.allSettled([
        scope.projectId ? getCreditSummary(scope.projectId) : Promise.resolve(null), getCreditBalance(),
      ]);
      if (current.current !== scope) return;
      const failures = [summary, balance].filter(result => result.status === 'rejected');
      if (failures.length) {
        scope.failures++;
        let retryAfterMs = 0;
        for (const failure of failures) {
          const error = failure.reason as { status?: number; retryAfterMs?: number } | null;
          if (error?.status === 401) scope.unauthorized = true;
          if (typeof error?.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs)) {
            retryAfterMs = Math.max(retryAfterMs, error.retryAfterMs);
          }
          if (scope.failures === 1 && error?.status !== 401 && !isAuthenticationServiceUnavailable(error)) {
            console.error('Failed to refresh credits:', failure.reason);
          }
        }
        scope.nextAttemptAt = Date.now() + Math.max(retryAfterMs, Math.min(60_000, 5_000 * 2 ** Math.min(scope.failures, 4)));
      } else {
        scope.failures = 0;
        scope.nextAttemptAt = 0;
      }
      if (summary.status === 'fulfilled') setCreditSummary(summary.value);
      if (balance.status === 'fulfilled') setCreditBalance(balance.value);
    })().finally(() => { scope.pending = undefined; });
    scope.pending = request;
    return request;
  }, []);

  useEffect(() => {
    // Clear account/project-scoped values when the subscription changes; a
    // failed first request must not leave the previous account's balance visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreditBalance(null);
    setCreditSummary(null);
    if (!enabled) return;
    const scope: CreditRefresh = { projectId, failures: 0, nextAttemptAt: 0, unauthorized: false };
    current.current = scope;
    const refresh = () => { void refreshCredits(); };
    refresh();
    const timer = setInterval(refresh, 5_000);
    window.addEventListener('beegame:credits-updated', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      current.current = null;
      clearInterval(timer);
      window.removeEventListener('beegame:credits-updated', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [projectId, enabled, userId, refreshCredits]);

  return { creditBalance, creditSummary, refreshCredits };
}
