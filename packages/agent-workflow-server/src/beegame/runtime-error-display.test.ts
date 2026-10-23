import { describe, expect, test } from 'bun:test'
import {
  formatBeeGameEventForDisplay,
  formatRuntimeErrorForDisplay,
} from './session-manager'

describe('runtime error display', () => {
  test('explains model refusal for live and persisted events without changing raw payloads', () => {
    const raw = 'API Error: 400 Upstream request failed: [model_coming_soon] This model is coming soon.'
    const event = { id: 1, sessionId: 'session', type: 'assistant.message' as const,
      text: raw, payload: { type: 'assistant' as const, message: { content: raw } }, createdAt: new Date() }
    const displayed = formatBeeGameEventForDisplay(event, 'zh')
    expect(displayed.text).toContain('上游暂未开放当前模型（model_coming_soon）')
    expect(displayed.text).toContain('当前模型不变')
    expect(displayed.text).toContain('可重试原任务')
    expect(displayed.payload).toEqual(event.payload)
    expect(event.text).toBe(raw)
    expect(formatRuntimeErrorForDisplay(displayed.text, 'zh')).toBe(displayed.text)
    expect(formatRuntimeErrorForDisplay('400 {"error":{"code":"model_coming_soon","message":"Not enabled"}}', 'en'))
      .toContain('Retry the same task when ready')
    const prose = 'Example API Error: 400 [model_coming_soon] is a provider error.'
    expect(formatRuntimeErrorForDisplay(prose, 'en')).toBe(prose)
  })

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
