import { expect, test } from 'bun:test'
import { REVIEW_JSON_ENVELOPE, structuredOutputSchemas, parseStructuredOutputContent } from './jsonEnvelope'

test('only marked exact Reviewer envelopes hide validation metadata from the API', () => {
  const content = { type: 'object', properties: { action: { const: 'final' } }, required: ['action'], additionalProperties: false }
  const input = { type: 'object', $comment: REVIEW_JSON_ENVELOPE, additionalProperties: false, required: ['payload_json'],
    properties: { payload_json: { type: 'string', contentMediaType: 'application/json', contentSchema: content } } }
  const prepared = structuredOutputSchemas(input)
  expect(prepared.content).toBe(content)
  expect(prepared.wire).toEqual({ type: 'object', additionalProperties: false, required: ['payload_json'], properties: { payload_json: { type: 'string' } } })
  expect(input.properties.payload_json.contentSchema).toBe(content)
  expect(structuredOutputSchemas(content).wire).toBe(content)
  expect(() => structuredOutputSchemas({ ...input, required: [] })).toThrow()
  expect(() => structuredOutputSchemas({ ...input, properties: { ...input.properties, extra: {} } })).toThrow()
})

test('encoded content is strict and bounded, with no leaking parse error or guessed repair', () => {
  const valid = { action: 'tools', rationale: '{"literal":"prose"}', calls: [{ expression: { op: 'add', args: [1, 2] } }] }
  expect(parseStructuredOutputContent({ payload_json: JSON.stringify(valid) })).toEqual({ ok: true, value: valid })
  for (const payload_json of ['{PRIVATE_SECRET', '```json\n{}\n```', 'text {}', '{"x":1,}']) {
    const result = parseStructuredOutputContent({ payload_json })
    expect(result).toEqual({ ok: false, reason: 'invalid_json' })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET')
  }
  for (const value of [[], null, 'nested JSON string', 1])
    expect(parseStructuredOutputContent({ payload_json: JSON.stringify(value) })).toEqual({ ok: false, reason: 'not_object' })
  expect(parseStructuredOutputContent({ payload_json: '你'.repeat(800000) })).toEqual({ ok: false, reason: 'too_large' })
  expect(parseStructuredOutputContent({ payload_json: '['.repeat(65) + '0' + ']'.repeat(65) })).toEqual({ ok: false, reason: 'too_deep' })
  const braces = { summary: '\\"' + '{'.repeat(100) }
  expect(parseStructuredOutputContent({ payload_json: JSON.stringify(braces) })).toEqual({ ok: true, value: braces })
})
