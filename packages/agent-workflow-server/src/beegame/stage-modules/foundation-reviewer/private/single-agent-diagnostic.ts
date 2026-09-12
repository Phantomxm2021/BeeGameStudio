import { z } from 'zod/v4'

const counter = z.number().int().nonnegative().safe()
const safePath = z.string().max(300).regex(/^(?:\/(?:status|summary|findings|severity|title|actual|expected|documentPath|\d+))*$/)
export const reviewSchemaIssueSchema = z.object({
  path: safePath, keyword: z.enum(['type', 'required', 'additionalProperties', 'const', 'enum', 'oneOf', 'anyOf',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'other']),
  expected: z.enum(['object', 'array', 'number', 'integer', 'string', 'boolean', 'null']).optional(),
}).strict()
export function safeReviewSchemaIssue(error: { instancePath: string; keyword: string; params?: Record<string, unknown> }) {
  const property = error.keyword === 'required' ? error.params?.missingProperty
    : error.keyword === 'additionalProperties' ? error.params?.additionalProperty : undefined
  const missing = typeof property === 'string'
    ? error.instancePath + '/' + property.replace(/~/g, '~0').replace(/\//g, '~1') : error.instancePath
  const path = safePath.safeParse(missing)
  const keyword = reviewSchemaIssueSchema.shape.keyword.safeParse(error.keyword)
  const expected = reviewSchemaIssueSchema.shape.expected.safeParse(error.keyword === 'type' ? error.params?.type : undefined)
  return { path: path.success ? path.data : '', keyword: keyword.success ? keyword.data : 'other' as const,
    ...(expected.success && expected.data !== undefined ? { expected: expected.data } : {}) }
}
export const reviewNativeSummarySchema = z.object({
  outputTransport: z.literal('json-envelope-v1').optional(),
  modelMessages: counter,
  structuredOutputCalls: counter,
  structuredOutputSuccesses: counter,
  structuredOutputFailures: counter,
  lastStopReason: z.enum(['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'pause_turn', 'refusal', 'other']).optional(),
  resultKind: z.enum(['success', 'max_turns', 'structured_output_retries', 'model_error']).optional(),
  usageSource: z.enum(['terminal', 'message_snapshots', 'unavailable']),
}).strict()
export type ReviewNativeSummary = z.infer<typeof reviewNativeSummarySchema>

export const reviewOutputDiagnosticSchema = z.object({
  stage: z.enum(['missing_structured_output', 'payload_schema', 'admission']),
  reason: z.enum(['audit_incomplete', 'unknown']).optional(),
  schemaCodes: z.array(z.enum(['invalid_type', 'invalid_value', 'too_big', 'too_small', 'unrecognized_keys', 'invalid_union', 'custom', 'other'])).max(16).optional(),
}).strict()
export type ReviewOutputDiagnostic = z.infer<typeof reviewOutputDiagnosticSchema>
export class ReviewAdmissionError extends Error {
  constructor(readonly diagnostic: ReviewOutputDiagnostic) { super('Review output admission rejected') }
}
// Persist closed classifications and numeric locations only, never model values,
// provider messages, unrecognized keys, or arbitrary exception text.
export function diagnoseReviewOutput(error: unknown): ReviewOutputDiagnostic {
  if (error instanceof ReviewAdmissionError) return reviewOutputDiagnosticSchema.parse(error.diagnostic)
  if (error instanceof z.ZodError) {
    const allowed = ['invalid_type', 'invalid_value', 'too_big', 'too_small', 'unrecognized_keys', 'invalid_union', 'custom']
    return reviewOutputDiagnosticSchema.parse({ stage: 'payload_schema', schemaCodes: [...new Set(error.issues.map(issue => allowed.includes(issue.code) ? issue.code : 'other'))].slice(0, 16) })
  }
  return { stage: 'admission', reason: 'unknown' }
}
