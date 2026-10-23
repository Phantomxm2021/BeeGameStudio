export function authRetryDelay(attempt: number, error?: unknown): number {
  const retryAfter = (error as { retryAfterMs?: number } | null)?.retryAfterMs;
  return Math.max(
    typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter : 0,
    Math.min(30_000, 2_000 * 2 ** Math.min(Math.max(0, attempt - 1), 4)),
  );
}
