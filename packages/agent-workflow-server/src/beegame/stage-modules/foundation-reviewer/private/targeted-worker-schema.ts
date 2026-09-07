import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'

/** Frozen targeted worker fields; authority and scope assessment remain service-owned. */
export const foundationSemanticFailureDiagnosticInputSchema = z.object({
  observedActual: z.string().min(1),
  evidence: z.array(z.object({
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    sectionId: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1),
  failureReasonCode: z.enum([
    'expected_not_met',
    'actual_persists',
    'contradictory_evidence',
    'evidence_insufficient',
  ]),
}).strict()

export const foundationSemanticRecheckWorkerPayloadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('PASS') }).strict(),
  z.object({ status: z.literal('FAIL'), diagnostic: foundationSemanticFailureDiagnosticInputSchema }).strict(),
])

export const foundationSemanticRecheckStructuredOutputJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['PASS', 'FAIL'] },
    diagnostic: {
      type: 'object', additionalProperties: false,
      properties: {
        observedActual: { type: 'string', minLength: 1 },
        evidence: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              documentPath: { enum: [...CANONICAL_FOUNDATION_DOCUMENTS] },
              sectionId: { type: 'string', minLength: 1 },
              digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            },
            required: ['documentPath', 'sectionId', 'digest'],
          },
        },
        failureReasonCode: { enum: ['expected_not_met', 'actual_persists', 'contradictory_evidence', 'evidence_insufficient'] },
      },
      required: ['observedActual', 'evidence', 'failureReasonCode'],
    },
  },
  required: ['status'],
  oneOf: [
    { properties: { status: { const: 'PASS' } }, not: { required: ['diagnostic'] } },
    { properties: { status: { const: 'FAIL' } }, required: ['diagnostic'] },
  ],
} as const
