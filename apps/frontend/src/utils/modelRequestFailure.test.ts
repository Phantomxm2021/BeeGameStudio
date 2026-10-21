import { describe, expect, it } from 'vitest';
import { canAutomaticallyRetryModelFailure } from './modelRequestFailure';

describe('automatic recovery classification', () => {
    it.each([
        'API Error: Connection error.',
        'The selected model provider transport failed (UND_ERR_SOCKET)',
        'Model provider request failed (HTTP 429)',
        'unexpected status 503 Service Unavailable',
        'API Error: 502 Bad Gateway',
        'Selected model is at capacity.',
        'overloaded_error',
        'rate_limit_exceeded',
        'request timed out',
    ])('allows a bounded automatic continuation for %s', text => {
        expect(canAutomaticallyRetryModelFailure(text)).toBe(true);
    });

    it.each([
        'stream disconnected before completion: Provider did not report final token usage',
        'API Error: OpenAI stream ended before a terminal finish_reason was received',
        'API Error: OpenCode Go: Connection error.',
        'API Error: 401 Unauthorized',
        'API Error: 400 Invalid request',
        'HTTP 429 insufficient_quota',
        'HTTP 403 Connection error.',
        'Provider transport failed (CERT_HAS_EXPIRED)',
        'The operation was aborted: Connection error.',
        'Permission denied for tool.',
        'model_coming_soon',
        'Unexpected application failure',
    ])('keeps %s available for explicit recovery without automatic replay', text => {
        expect(canAutomaticallyRetryModelFailure(text)).toBe(false);
    });
});
