import { describe, expect, test } from 'bun:test'
import { SDKAPIRetryMessageSchema } from '../coreSchemas.js'

describe('SDK API retry diagnostics', () => {
  test('preserves the non-secret underlying API failure details', () => {
    const parsed = SDKAPIRetryMessageSchema().parse({
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 10,
      retry_delay_ms: 500,
      error_status: null,
      error: 'unknown',
      error_type: 'APIConnectionError',
      error_message: 'Unable to connect to API (ECONNRESET)',
      error_code: 'ECONNRESET',
      error_cause: 'socket closed before the response completed',
      request_id: null,
      uuid: '00000000-0000-4000-8000-000000000000',
      session_id: 'session-1',
    })

    expect(parsed).toMatchObject({
      error_type: 'APIConnectionError',
      error_message: 'Unable to connect to API (ECONNRESET)',
      error_code: 'ECONNRESET',
      error_cause: 'socket closed before the response completed',
      request_id: null,
    })
  })
})
