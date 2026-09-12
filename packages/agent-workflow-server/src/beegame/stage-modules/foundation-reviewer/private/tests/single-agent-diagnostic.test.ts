import { expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { diagnoseReviewOutput, ReviewAdmissionError, reviewOutputDiagnosticSchema, reviewNativeSummarySchema } from '../single-agent-diagnostic'

test('native summary allows only bounded classifications and counts', () => {
  const summary = { modelMessages: 2, structuredOutputCalls: 1, structuredOutputSuccesses: 1,
    structuredOutputFailures: 0, lastStopReason: 'tool_use', usageSource: 'message_snapshots' }
  expect(reviewNativeSummarySchema.safeParse(summary).success).toBe(true)
  for (const value of [{ ...summary, text: 'PRIVATE' }, { ...summary, lastStopReason: 'PRIVATE' }, { ...summary, modelMessages: -1 }])
    expect(reviewNativeSummarySchema.safeParse(value).success).toBe(false)
})
import { singleReviewEventSchema } from '../single-agent-journal'

test('diagnostics retain precise safe admission locations, not exception or model text', () => {
  expect(diagnoseReviewOutput(new ReviewAdmissionError({ stage: 'admission', reason: 'audit_incomplete' })))
    .toEqual({ stage: 'admission', reason: 'audit_incomplete' })
  expect(diagnoseReviewOutput(new Error('PRIVATE_PROVIDER_SECRET'))).toEqual({ stage: 'admission', reason: 'unknown' })
  const result = z.object({ action: z.literal('draft') }).strict().safeParse({ action: 'PRIVATE_VALUE', PRIVATE_FIELD: 'secret' })
  if (result.success) throw new Error('Expected schema failure')
  const diagnostic = diagnoseReviewOutput(result.error)
  expect(diagnostic.stage).toBe('payload_schema')
  expect(diagnostic.schemaCodes).toContain('invalid_value')
  expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE')
  expect(reviewOutputDiagnosticSchema.safeParse({ ...diagnostic, message: 'raw provider output' }).success).toBe(false)
})

test('sealed failure retains bounded diagnostics and rejects incomplete historic closures', () => {
  const event = { kind: 'closed', attemptId: 'attempt', sealScope: 'direct-child', elapsedMs: 10,
    summary: { modelMessages: 1, structuredOutputCalls: 0, structuredOutputSuccesses: 0, structuredOutputFailures: 0, usageSource: 'terminal' }, usageObserved: true,
    usage: { prompt_tokens: 1, completion_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 2 },
    outcome: { kind: 'failed', code: 'invalid_output' } }
  expect(singleReviewEventSchema.safeParse(event).success).toBe(true)
  expect(singleReviewEventSchema.parse({ ...event, outcome: { ...event.outcome, diagnostic: { stage: 'missing_structured_output' } } }))
    .toMatchObject({ outcome: { diagnostic: { stage: 'missing_structured_output' } } })
  expect(singleReviewEventSchema.safeParse({ ...event, outcome: { ...event.outcome, diagnostic: { stage: 'admission', reason: 'arbitrary secret' } } }).success).toBe(false)
})
