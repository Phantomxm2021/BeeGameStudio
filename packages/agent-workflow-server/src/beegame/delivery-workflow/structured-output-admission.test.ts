import { describe, expect, test } from 'bun:test'
import {
  estimateStructuredPayloadTokens,
  foundationFactBusinessPayload,
  foundationSemanticBusinessPayload,
} from './structured-output-admission'

describe('structured output admission measurement', () => {
  test('is deterministic, includes JSON structure, and conservatively counts multilingual bytes', () => {
    const payload = foundationFactBusinessPayload({ status: 'completed', results: [{ key: '规则', status: 'present', value: '蘑菇防御' }] })
    const serializedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    expect(estimateStructuredPayloadTokens(payload)).toBe(Math.ceil(serializedBytes / 2))
    expect(estimateStructuredPayloadTokens(payload)).toBe(estimateStructuredPayloadTokens({ ...payload }))
  })

  test('semantic and deep payloads exclude transport identity and provider usage', () => {
    const payload = foundationSemanticBusinessPayload({ status: 'completed', outcome: 'UNDECIDABLE', reason: '证据不足', issues: undefined })
    expect(payload).toEqual({ status: 'completed', outcome: 'UNDECIDABLE', reason: '证据不足' })
    expect(estimateStructuredPayloadTokens(payload)).toBeLessThan(768)
  })
})
