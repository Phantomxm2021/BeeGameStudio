import { describe, expect, it } from 'vitest';
import { authRetryDelay } from './authRetry';

describe('authentication retry delay', () => {
  it('backs off to 30 seconds and respects the server retry window', () => {
    expect([1, 2, 3, 4, 5, 6].map(attempt => authRetryDelay(attempt))).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    expect(authRetryDelay(1, { retryAfterMs: 10000 })).toBe(10000);
    expect(authRetryDelay(1, { retryAfterMs: NaN })).toBe(2000);
  });
});
