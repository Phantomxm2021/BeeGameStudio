import { describe, expect, test } from 'bun:test'
import {
  formatBeeGameEventForDisplay,
  formatRuntimeErrorForDisplay,
} from './session-manager'

describe('runtime error display', () => {
  test('formats a structured provider error without exposing its JSON envelope', () => {
    const displayed = formatRuntimeErrorForDisplay(
      'API Error: 429 {"error":{"code":"AccountQuotaExceeded","message":"Weekly quota exceeded. Reset at midnight.","type":"TooManyRequests"}}',
      'zh',
    )

    expect(displayed).toBe('Weekly quota exceeded. Reset at midnight.')
    expect(displayed).not.toContain('{')
  })

  test('keeps a structured request identifier available for support', () => {
    expect(formatRuntimeErrorForDisplay(
      '503 {"error":{"code":"service_unavailable","message":"Please retry later.","request_id":"request-42"}}',
      'en',
    )).toBe('Please retry later.')
  })

  test('renders arbitrary nested error details and arrays without schema-specific code', () => {
    expect(formatRuntimeErrorForDisplay(
      '{"error":{"reason":{"category":"capacity","regions":["east","west"]},"retryable":true}}',
      'en',
    )).toBe([
      'Request failed',
      '',
      '- **Error**',
      '  - **Reason**',
      '    - **Category:** capacity',
      '    - **Regions**',
      '      - east',
      '      - west',
      '  - **Retryable:** true',
    ].join('\n'))
  })

  test('does not reinterpret ordinary assistant JSON or malformed error text', () => {
    const ordinary = 'Example payload: {"status":"ready","message":"This is documentation."}'
    const malformed = 'API Error: 500 {not-json}'
    expect(formatRuntimeErrorForDisplay(ordinary, 'en')).toBe(ordinary)
    expect(formatRuntimeErrorForDisplay(malformed, 'en')).toBe(malformed)
  })

  test('formats an already persisted assistant event only at the display boundary', () => {
    const rawText = '429 {"error":{"code":"limited","message":"Try again later."}}'
    const event = {
      id: 1,
      sessionId: 'session-1',
      type: 'assistant.message' as const,
      text: rawText,
      payload: { type: 'assistant' as const, message: { content: rawText } },
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
    }
    const displayed = formatBeeGameEventForDisplay(event, 'en')

    expect(displayed.text).toBe('Try again later.')
    expect(displayed.payload).toEqual(event.payload)
    expect(event.text).toBe(rawText)
  })
})
