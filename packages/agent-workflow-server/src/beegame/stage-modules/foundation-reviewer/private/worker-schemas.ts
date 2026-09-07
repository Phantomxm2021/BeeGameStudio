import { z } from 'zod/v4'
import { FOUNDATION_FACT_CATALOG, foundationFactDefinition, type FoundationFactKey } from './domain/foundation-fact-definitions'
import type { FoundationFactPacket } from './domain/foundation-fact-extraction'

const foundationFactEvidenceSchema = z
  .object({
    documentPath: z.string().min(1),
    sectionId: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const foundationFactKeySchema = z.string().min(1)

const foundationFactValueSchema = z.unknown().refine(value => value !== undefined, {
  message: 'present foundation fact requires value',
})

const foundationFactModelResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      key: foundationFactKeySchema,
      status: z.literal('present'),
      value: foundationFactValueSchema,
    })
    .strict(),
  z
    .object({
      key: foundationFactKeySchema,
      status: z.literal('absent'),
    })
    .strict(),
  z
    .object({
      key: foundationFactKeySchema,
      status: z.literal('uncertain'),
      reason: z.string().min(1),
    })
    .strict(),
])

const foundationFactTerminalResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      key: foundationFactKeySchema,
      status: z.literal('present'),
      value: foundationFactValueSchema,
      evidence: foundationFactEvidenceSchema,
    })
    .strict(),
  z
    .object({
      key: foundationFactKeySchema,
      status: z.literal('absent'),
    })
    .strict(),
  z
    .object({
      key: foundationFactKeySchema,
      status: z.literal('uncertain'),
      reason: z.string().min(1),
      evidence: foundationFactEvidenceSchema,
    })
    .strict(),
])

export const foundationFactExtractorTerminalSchema = z
  .object({
    workerType: z.literal('foundation-fact-extractor'),
    status: z.enum(['completed', 'failed', 'blocked']),
    runId: z.string().min(1),
    dispatchId: z.string().min(1),
    taskId: z.string().min(1),
    revision: z.string().min(1),
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    results: z.array(foundationFactTerminalResultSchema),
  })
  .strict()

export const foundationFactModelPayloadSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'blocked']),
    results: z.array(foundationFactModelResultSchema),
  })
  .strict()

function foundationFactValueJsonSchema(key: FoundationFactKey) {
  const definition = foundationFactDefinition(key)
  if (!definition) throw new Error(`unknown foundation fact key: ${key}`)
  const spec = definition.valueSpec
  switch (definition.valueType) {
    case 'string':
      return {
        type: 'string',
        minLength: 1,
        ...(spec.enum ? { enum: [...spec.enum] } : {}),
      }
    case 'number':
      return {
        type: 'integer',
        ...(spec.min === undefined ? {} : { minimum: spec.min }),
        ...(spec.max === undefined ? {} : { maximum: spec.max }),
      }
    case 'boolean':
      return { type: 'boolean' }
    case 'string[]':
      return {
        type: 'array',
        ...(spec.minItems === undefined ? {} : { minItems: spec.minItems }),
        ...(spec.maxItems === undefined ? {} : { maxItems: spec.maxItems }),
        items: {
          type: 'string',
          minLength: 1,
          ...(spec.itemPattern ? { pattern: spec.itemPattern } : {}),
        },
      }
    case 'number[]':
      return {
        type: 'array',
        ...(spec.minItems === undefined ? {} : { minItems: spec.minItems }),
        ...(spec.maxItems === undefined ? {} : { maxItems: spec.maxItems }),
        items: { type: 'number' },
      }
  }
}

function buildFoundationFactSchemaForKeys(
  keys: readonly FoundationFactKey[],
) {
  if (!keys.length) throw new Error('foundation fact schema requires packet keys')
  if (new Set(keys).size !== keys.length)
    throw new Error('foundation fact schema packet keys must be unique')
  const resultBranches = keys.flatMap(key => {
    const keySchema = { enum: [key] }
    return [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: keySchema,
          status: { enum: ['present'] },
          value: foundationFactValueJsonSchema(key),
        },
        required: ['key', 'status', 'value'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: { key: keySchema, status: { enum: ['absent'] } },
        required: ['key', 'status'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: keySchema,
          status: { enum: ['uncertain'] },
          reason: { type: 'string', minLength: 1 },
        },
        required: ['key', 'status', 'reason'],
      },
    ]
  })
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { enum: ['completed', 'failed', 'blocked'] },
      results: {
        type: 'array',
        minItems: keys.length,
        maxItems: keys.length,
        items: { oneOf: resultBranches },
      },
    },
    required: ['status', 'results'],
  } as const
}

export function buildFoundationFactStructuredOutputJsonSchema(
  packet: FoundationFactPacket,
) {
  return buildFoundationFactSchemaForKeys(packet.keys)
}

export const foundationFactStructuredOutputJsonSchema = buildFoundationFactSchemaForKeys(
  FOUNDATION_FACT_CATALOG.map(definition => definition.key),
)

const foundationSemanticPatchRemediationSchema = z.object({
  kind: z.literal('patch'),
  sectionKeys: z.array(z.string().min(1)).min(1),
}).strict()

const foundationSemanticRemediationSchema = foundationSemanticPatchRemediationSchema

const foundationSemanticIssueSchema = z.object({
  problem: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
  sourceSectionKey: z.string().min(1),
  supportingSectionKeys: z.array(z.string().min(1)).max(16),
  remediation: foundationSemanticRemediationSchema,
  reasonCode: z.string().min(1).optional(),
}).strict()

const foundationSemanticPayloadSchema = z.object({
  status: z.enum(['completed', 'failed', 'blocked']),
  outcome: z.enum(['PASS', 'ISSUES', 'UNDECIDABLE']),
  issues: z.array(foundationSemanticIssueSchema).optional(),
  reason: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  const issues = value.issues ?? []
  if (value.outcome === 'PASS' && issues.length) context.addIssue({ code: 'custom', path: ['issues'], message: 'PASS cannot contain issues' })
  if (value.outcome === 'ISSUES' && !issues.length) context.addIssue({ code: 'custom', path: ['issues'], message: 'ISSUES requires issue drafts' })
  if (value.outcome === 'UNDECIDABLE' && (issues.length || !value.reason)) context.addIssue({ code: 'custom', path: ['reason'], message: 'UNDECIDABLE requires a reason and no issue drafts' })
  if (value.outcome !== 'UNDECIDABLE' && value.reason !== undefined) context.addIssue({ code: 'custom', path: ['reason'], message: 'PASS/ISSUES cannot contain reason' })
})

export const foundationSemanticModelPayloadSchema = foundationSemanticPayloadSchema

export const foundationSemanticReviewerStructuredOutputJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['completed', 'failed', 'blocked'] }, outcome: { enum: ['PASS', 'ISSUES', 'UNDECIDABLE'] },
    issues: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: { problem: { type: 'string', minLength: 1 }, expected: { type: 'string', minLength: 1 }, actual: { type: 'string', minLength: 1 }, sourceSectionKey: { type: 'string', minLength: 1 }, supportingSectionKeys: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1 } }, remediation: { oneOf: [
      { type: 'object', additionalProperties: false, properties: { kind: { const: 'patch' }, sectionKeys: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } } }, required: ['kind', 'sectionKeys'] },
    ] }, reasonCode: { type: 'string', minLength: 1 } }, required: ['problem', 'expected', 'actual', 'sourceSectionKey', 'supportingSectionKeys', 'remediation'] } }, reason: { type: 'string', minLength: 1 },
  },
  required: ['status', 'outcome'],
  oneOf: [
    { properties: { outcome: { const: 'PASS' } }, not: { anyOf: [{ required: ['issues'] }, { required: ['reason'] }] } },
    { properties: { outcome: { const: 'ISSUES' } }, required: ['issues'], not: { required: ['reason'] } },
    { properties: { outcome: { const: 'UNDECIDABLE' } }, required: ['reason'], not: { required: ['issues'] } },
  ],
} as const
