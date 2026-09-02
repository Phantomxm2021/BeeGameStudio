import { z } from 'zod/v4'
import { atomicTaskSchema } from './schema'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  FOUNDATION_FACT_CATALOG,
  foundationFactDefinition,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import type { FoundationFactPacket } from './foundation-fact-extraction'

const base = z.object({ revision: z.string().min(1) }).strict()

const gameIrText = z.string().min(1)
const gameIrJsonValue = z.json()
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const projectionNodeReferenceSchema = z
  .object({ targetId: gameIrText.regex(safeIdPattern), targetType: gameIrText })
  .strict()
const projectionNodeEdgeSchema = z
  .object({
    type: gameIrText,
    targetId: gameIrText.regex(safeIdPattern),
    targetType: gameIrText,
  })
  .strict()
const projectionNodeSchema = z
  .object({
    id: gameIrText.regex(safeIdPattern),
    kind: gameIrText,
    value: z.record(z.string(), gameIrJsonValue),
    references: z.array(projectionNodeReferenceSchema),
    edges: z.array(projectionNodeEdgeSchema),
  })
  .strict()
const projectionSourceEvidenceGroupSchema = z
  .object({
    nodeIds: z.array(gameIrText.regex(safeIdPattern)).min(1),
    fragmentId: gameIrText.regex(/^e[0-9]+\.[0-9]+$/),
  })
  .strict()
const gameIrDiagnosticSchema = z
  .object({
    outcome: z.enum(['FAIL', 'AMBIGUOUS']),
    reasonCode: gameIrText,
    actual: gameIrText,
    missingSubject: gameIrText,
    expectedProjection: gameIrText,
    evidencePointers: z.array(gameIrText),
  })
  .strict()
const gameIrSemanticModelSchema = z
  .object({
    nodes: z.array(projectionNodeSchema),
    sourceEvidenceGroups: z.array(projectionSourceEvidenceGroupSchema),
  })
  .strict()
const gameIrValidationModelSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('PASS'),
      checkIds: z.array(gameIrText),
      coveredTargets: z.array(gameIrText),
    })
    .strict(),
  gameIrDiagnosticSchema,
])
const projectionCompletedSchema = z
  .object({
    status: z.literal('completed'),
    sliceId: gameIrText,
    semantic: gameIrSemanticModelSchema,
  })
  .strict()
const validationCompletedSchema = z
  .object({
    status: z.literal('completed'),
    validation: gameIrValidationModelSchema,
  })
  .strict()
export const gameIrProjectionModelPayloadSchema = z.discriminatedUnion(
  'status',
  [
    projectionCompletedSchema,
    z
      .object({
        status: z.literal('failed'),
        sliceId: gameIrText,
        reason: gameIrText,
      })
      .strict(),
    z
      .object({
        status: z.literal('blocked'),
        sliceId: gameIrText,
        reason: gameIrText,
      })
      .strict(),
  ],
)
export const gameIrValidationModelPayloadSchema = z.discriminatedUnion(
  'status',
  [
    validationCompletedSchema,
    z.object({ status: z.literal('failed'), reason: gameIrText }).strict(),
    z.object({ status: z.literal('blocked'), reason: gameIrText }).strict(),
  ],
)
export type GameIrProjectionModelPayload = z.infer<
  typeof gameIrProjectionModelPayloadSchema
>
export type GameIrValidationModelPayload = z.infer<
  typeof gameIrValidationModelPayloadSchema
>
export type GameIrCompilerOperation = 'projection' | 'validation'
export function parseGameIrCompilerModelPayload(
  value: unknown,
  operation: GameIrCompilerOperation,
): GameIrProjectionModelPayload | GameIrValidationModelPayload {
  return operation === 'projection'
    ? gameIrProjectionModelPayloadSchema.parse(value)
    : gameIrValidationModelPayloadSchema.parse(value)
}
const gameIrServiceIdentityFields = {
  runId: z.string().min(1),
  dispatchId: z.string().min(1),
  taskId: z.string().min(1),
  revision: z.string().min(1),
  compileRequestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  foundationReadyReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
} as const
export const gameIrProjectionTerminalSchema = z.discriminatedUnion('status', [
  z
    .object({
      workerType: z.literal('game-ir-compiler'),
      operation: z.literal('projection'),
      status: z.literal('completed'),
      sliceId: gameIrText,
      semantic: gameIrSemanticModelSchema,
      ...gameIrServiceIdentityFields,
    })
    .strict(),
  z
    .object({
      workerType: z.literal('game-ir-compiler'),
      operation: z.literal('projection'),
      status: z.literal('failed'),
      sliceId: gameIrText,
      reason: gameIrText,
      ...gameIrServiceIdentityFields,
    })
    .strict(),
  z
    .object({
      workerType: z.literal('game-ir-compiler'),
      operation: z.literal('projection'),
      status: z.literal('blocked'),
      sliceId: gameIrText,
      reason: gameIrText,
      ...gameIrServiceIdentityFields,
    })
    .strict(),
])
export const gameIrValidationTerminalSchema = z.discriminatedUnion('status', [
  z
    .object({
      workerType: z.literal('game-ir-compiler'),
      operation: z.literal('validation'),
      status: z.literal('completed'),
      validation: gameIrValidationModelSchema,
      ...gameIrServiceIdentityFields,
    })
    .strict(),
  z
    .object({
      workerType: z.literal('game-ir-compiler'),
      operation: z.literal('validation'),
      status: z.literal('failed'),
      reason: gameIrText,
      ...gameIrServiceIdentityFields,
    })
    .strict(),
  z
    .object({
      workerType: z.literal('game-ir-compiler'),
      operation: z.literal('validation'),
      status: z.literal('blocked'),
      reason: gameIrText,
      ...gameIrServiceIdentityFields,
    })
    .strict(),
])
export const gameIrCompilerTerminalSchema = z.discriminatedUnion('operation', [
  gameIrProjectionTerminalSchema,
  gameIrValidationTerminalSchema,
])
const gameIrDiagnosticJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { enum: ['FAIL', 'AMBIGUOUS'] },
    reasonCode: { type: 'string', minLength: 1 },
    actual: { type: 'string', minLength: 1 },
    missingSubject: { type: 'string', minLength: 1 },
    expectedProjection: { type: 'string', minLength: 1 },
    evidencePointers: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
  required: [
    'outcome',
    'reasonCode',
    'actual',
    'missingSubject',
    'expectedProjection',
    'evidencePointers',
  ],
} as const
const gameIrValidationJsonSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        outcome: { const: 'PASS' },
        checkIds: { type: 'array', items: { type: 'string', minLength: 1 } },
        coveredTargets: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
      },
      required: ['outcome', 'checkIds', 'coveredTargets'],
    },
    gameIrDiagnosticJsonSchema,
  ],
} as const
export const gameIrValidationStructuredOutputJsonSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { const: 'completed' },
        validation: gameIrValidationJsonSchema,
      },
      required: ['status', 'validation'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { const: 'failed' },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['status', 'reason'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { const: 'blocked' },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['status', 'reason'],
    },
  ],
} as const

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
const foundationFactValueSchema = z
  .union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.array(z.union([z.string(), z.number().finite(), z.boolean()])),
  ])
  .refine(value => value !== undefined, {
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

function buildFoundationFactSchemaForKeys(keys: readonly FoundationFactKey[]) {
  if (!keys.length)
    throw new Error('foundation fact schema requires packet keys')
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

/** Builds the closed result schema for exactly one immutable packet. */
export function buildFoundationFactStructuredOutputJsonSchema(
  packet: FoundationFactPacket,
) {
  return buildFoundationFactSchemaForKeys(packet.keys)
}

export const foundationFactStructuredOutputJsonSchema =
  buildFoundationFactSchemaForKeys(
    FOUNDATION_FACT_CATALOG.map(definition => definition.key),
  )

const foundationSemanticPatchRemediationSchema = z
  .object({
    kind: z.literal('patch'),
    sectionKeys: z.array(z.string().min(1)).min(1),
  })
  .strict()

const foundationSemanticRemediationSchema =
  foundationSemanticPatchRemediationSchema

const foundationSemanticIssueSchema = z
  .object({
    problem: z.string().min(1),
    expected: z.string().min(1),
    actual: z.string().min(1),
    sourceSectionKey: z.string().min(1),
    remediation: foundationSemanticRemediationSchema,
    reasonCode: z.string().min(1).optional(),
  })
  .strict()

/** Targeted revision recheck output. Service-owned expected/identity fields are
 * intentionally absent: the worker may only report observed evidence. */
export const foundationSemanticFailureDiagnosticInputSchema = z
  .object({
    observedActual: z.string().min(1),
    evidence: z
      .array(
        z
          .object({
            documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
            sectionId: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    failureReasonCode: z.enum([
      'expected_not_met',
      'actual_persists',
      'contradictory_evidence',
      'evidence_insufficient',
    ]),
  })
  .strict()

/** Durable diagnostic shape. The scope decision is service-owned and is
 * injected after the worker's evidence has been admitted. */
export const foundationSemanticFailureDiagnosticSchema =
  foundationSemanticFailureDiagnosticInputSchema
    .extend({
      scopeAssessment: z.literal('repairable_in_scope'),
    })
    .strict()

export const foundationSemanticRecheckWorkerPayloadSchema =
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('PASS') }).strict(),
    z
      .object({
        status: z.literal('FAIL'),
        diagnostic: foundationSemanticFailureDiagnosticInputSchema,
      })
      .strict(),
  ])

const foundationSemanticPayloadSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'blocked']),
    outcome: z.enum(['PASS', 'ISSUES', 'UNDECIDABLE']),
    issues: z.array(foundationSemanticIssueSchema).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const issues = value.issues ?? []
    if (value.outcome === 'PASS' && issues.length)
      context.addIssue({
        code: 'custom',
        path: ['issues'],
        message: 'PASS cannot contain issues',
      })
    if (value.outcome === 'ISSUES' && !issues.length)
      context.addIssue({
        code: 'custom',
        path: ['issues'],
        message: 'ISSUES requires issue drafts',
      })
    if (value.outcome === 'UNDECIDABLE' && (issues.length || !value.reason))
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'UNDECIDABLE requires a reason and no issue drafts',
      })
    if (value.outcome !== 'UNDECIDABLE' && value.reason !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'PASS/ISSUES cannot contain reason',
      })
  })

export const foundationSemanticModelPayloadSchema =
  foundationSemanticPayloadSchema

const foundationSemanticReviewerTerminalIdentitySchema = z
  .object({
    workerType: z.literal('foundation-semantic-reviewer'),
    status: z.enum(['completed', 'failed', 'blocked']),
    runId: z.string().min(1),
    dispatchId: z.string().min(1),
    taskId: z.string().min(1),
    revision: z.string().min(1),
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const foundationSemanticReviewerTerminalSchema =
  foundationSemanticReviewerTerminalIdentitySchema
    .extend({
      outcome: z.enum(['PASS', 'ISSUES', 'UNDECIDABLE', 'FAIL']),
      issues: z.array(foundationSemanticIssueSchema).optional(),
      reason: z.string().min(1).optional(),
      diagnostic: foundationSemanticFailureDiagnosticSchema.optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const issues = value.issues ?? []
      if (
        value.outcome === 'FAIL' &&
        (!value.diagnostic || issues.length || value.reason !== undefined)
      )
        context.addIssue({
          code: 'custom',
          path: ['diagnostic'],
          message: 'FAIL requires only a structured diagnostic',
        })
      if (value.outcome === 'FAIL') return
      if (value.diagnostic !== undefined)
        context.addIssue({
          code: 'custom',
          path: ['diagnostic'],
          message: 'diagnostic is only valid for targeted FAIL',
        })
      if (value.outcome === 'PASS' && issues.length)
        context.addIssue({
          code: 'custom',
          path: ['issues'],
          message: 'PASS cannot contain issues',
        })
      if (value.outcome === 'ISSUES' && !issues.length)
        context.addIssue({
          code: 'custom',
          path: ['issues'],
          message: 'ISSUES requires issue drafts',
        })
      if (value.outcome === 'UNDECIDABLE' && (issues.length || !value.reason))
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'UNDECIDABLE requires a reason and no issue drafts',
        })
      if (value.outcome !== 'UNDECIDABLE' && value.reason !== undefined)
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'PASS/ISSUES cannot contain reason',
        })
    })

export const foundationSemanticRecheckTerminalSchema =
  foundationSemanticReviewerTerminalIdentitySchema
    .extend({
      outcome: z.enum(['PASS', 'FAIL']),
      diagnostic: foundationSemanticFailureDiagnosticSchema.optional(),
    })
    .superRefine((value, context) => {
      if (value.outcome === 'PASS' && value.diagnostic !== undefined)
        context.addIssue({
          code: 'custom',
          path: ['diagnostic'],
          message: 'targeted PASS cannot contain a diagnostic',
        })
      if (value.outcome === 'FAIL' && value.diagnostic === undefined)
        context.addIssue({
          code: 'custom',
          path: ['diagnostic'],
          message: 'targeted FAIL requires a diagnostic',
        })
    })

export const foundationSemanticReviewerStructuredOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { enum: ['completed', 'failed', 'blocked'] },
    outcome: { enum: ['PASS', 'ISSUES', 'UNDECIDABLE'] },
    issues: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          problem: { type: 'string', minLength: 1 },
          expected: { type: 'string', minLength: 1 },
          actual: { type: 'string', minLength: 1 },
          sourceSectionKey: { type: 'string', minLength: 1 },
          remediation: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { const: 'patch' },
                  sectionKeys: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string', minLength: 1 },
                  },
                },
                required: ['kind', 'sectionKeys'],
              },
            ],
          },
          reasonCode: { type: 'string', minLength: 1 },
        },
        required: [
          'problem',
          'expected',
          'actual',
          'sourceSectionKey',
          'remediation',
        ],
      },
    },
    reason: { type: 'string', minLength: 1 },
  },
  required: ['status', 'outcome'],
  oneOf: [
    {
      properties: { outcome: { const: 'PASS' } },
      not: { anyOf: [{ required: ['issues'] }, { required: ['reason'] }] },
    },
    {
      properties: { outcome: { const: 'ISSUES' } },
      required: ['issues'],
      not: { required: ['reason'] },
    },
    {
      properties: { outcome: { const: 'UNDECIDABLE' } },
      required: ['reason'],
      not: { required: ['issues'] },
    },
  ],
} as const

export const foundationSemanticRecheckStructuredOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { enum: ['PASS', 'FAIL'] },
    diagnostic: {
      type: 'object',
      additionalProperties: false,
      properties: {
        observedActual: { type: 'string', minLength: 1 },
        evidence: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              documentPath: { enum: [...CANONICAL_FOUNDATION_DOCUMENTS] },
              sectionId: { type: 'string', minLength: 1 },
            },
            required: ['documentPath', 'sectionId'],
          },
        },
        failureReasonCode: {
          enum: [
            'expected_not_met',
            'actual_persists',
            'contradictory_evidence',
            'evidence_insufficient',
          ],
        },
      },
      required: ['observedActual', 'evidence', 'failureReasonCode'],
    },
  },
  required: ['status'],
  oneOf: [
    {
      properties: { status: { const: 'PASS' } },
      not: { required: ['diagnostic'] },
    },
    { properties: { status: { const: 'FAIL' } }, required: ['diagnostic'] },
  ],
} as const

export const foundationRevisionDeclarationSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.literal('APPLIED'),
        changedSectionIds: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .superRefine((value, context) => {
        if (
          new Set(value.changedSectionIds).size !==
          value.changedSectionIds.length
        )
          context.addIssue({
            code: 'custom',
            path: ['changedSectionIds'],
            message: 'changedSectionIds must be unique',
          })
      }),
  ],
)

const foundationRevisionReceiptSchema = z
  .object({
    taskId: z.string().min(1),
    round: z.number().int().positive(),
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    issueIds: z.array(z.string().min(1)).min(1),
    baseDocumentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    stagedDocumentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    changedSectionIds: z.array(z.string().min(1)).min(1),
    stagedPath: z.string().min(1),
    terminalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const foundationRevisionToolResultSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.literal('APPLIED'),
        receipt: foundationRevisionReceiptSchema,
      })
      .strict(),
  ],
)

export const foundationDocumentReviserTerminalSchema = z
  .object({
    workerType: z.literal('foundation-document-reviser'),
    status: z.enum(['completed', 'failed', 'blocked']),
    runId: z.string().min(1),
    dispatchId: z.string().min(1),
    taskId: z.string().min(1),
    revision: z.string().min(1),
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    round: z.number().int().positive(),
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    declaration: foundationRevisionToolResultSchema,
  })
  .strict()

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
    authoringMetrics: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        cacheReadTokens: z.number().int().nonnegative(),
        cacheCreationTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        rawProcessedTokens: z.number().int().nonnegative(),
        nativeTurns: z.number().int().nonnegative(),
        toolCalls: z.record(z.string(), z.number().int().nonnegative()),
        failedToolCalls: z.number().int().nonnegative(),
        permissionDenials: z.number().int().nonnegative(),
        authorityProjection: z
          .object({
            byteLength: z.number().int().nonnegative(),
            rangeCount: z.number().int().nonnegative(),
            projectedLineCount: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const resourceTaskMetricsSchema = z
  .object({
    catalogPayloadBytes: z.number().int().nonnegative(),
    catalogCallTypes: z.array(z.string().min(1)),
    canonicalMutationCount: z.number().int().nonnegative(),
  })
  .strict()

export const resourcePlannerTerminalSchema = base
  .extend({
    workerType: z.literal('resource-planner'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    taskMetrics: resourceTaskMetricsSchema,
  })
  .strict()

export const resourceCuratorTerminalSchema = base
  .extend({
    workerType: z.literal('resource-curator'),
    status: z.literal('completed'),
    catalogObserved: z.boolean(),
    resourceIds: z.array(z.string().min(1)),
    bindings: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          resourceIds: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    writtenPaths: z.array(z.string().min(1)),
    taskMetrics: resourceTaskMetricsSchema,
  })
  .strict()

export const resourceContentAuthorTerminalSchema = base
  .extend({
    workerType: z.literal('resource-content-author'),
    status: z.enum(['completed', 'needs_inventory']),
    contentIds: z.array(z.string().min(1)),
    writtenPaths: z.array(z.string().min(1)),
    missingRequirementIds: z.array(z.string().min(1)),
    taskMetrics: resourceTaskMetricsSchema,
  })
  .strict()

export const atomicTaskPlannerTerminalSchema = base
  .extend({
    workerType: z.literal('atomic-task-planner'),
    status: z.literal('completed'),
    tasks: z.array(atomicTaskSchema).min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const implementationWorkerTerminalSchema = base
  .extend({
    workerType: z.literal('implementation-worker'),
    taskId: z.string().min(1),
    status: z.enum(['completed', 'failed', 'blocked']),
    changedPaths: z.array(z.string().min(1)),
    verifiedArtifacts: z.array(z.string().min(1)),
    verificationResults: z.array(
      z
        .object({
          verificationIndex: z.number().int().nonnegative(),
          status: z.enum(['passed', 'deferred']),
          observations: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    // These values are service-owned. The parser installs an internal
    // placeholder so the persisted workflow type stays uniform; dispatch
    // replaces it with the canonical dispatch-scoped path before validation.
    evidenceRefs: z.array(z.string().min(1)),
    evidencePath: z.string().min(1),
  })
  .strict()

const implementationFindingSchema = z
  .object({
    taskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    artifactPaths: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    requiredAction: z.string().min(1),
  })
  .strict()

function requireActionableFindings(
  value: { status: 'passed' | 'failed' | 'blocked'; findings: unknown[] },
  context: z.RefinementCtx,
): void {
  if (value.status !== 'passed' && value.findings.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'failed or blocked validation requires actionable findings',
    })
  }
  if (value.status === 'passed' && value.findings.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'passed validation cannot contain findings',
    })
  }
}

export const implementationAuditorTerminalSchema = base
  .extend({
    workerType: z.literal('implementation-auditor'),
    status: z.enum(['passed', 'failed', 'blocked']),
    auditedTaskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    resourceIds: z.array(z.string().min(1)),
    contentIds: z.array(z.string().min(1)),
    findings: z.array(implementationFindingSchema),
    evidencePath: z.string().min(1),
  })
  .strict()
  .superRefine(requireActionableFindings)

export const acceptanceValidatorTerminalSchema = base
  .extend({
    workerType: z.literal('acceptance-validator'),
    status: z.enum(['passed', 'failed', 'blocked']),
    validatedTaskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    resourceIds: z.array(z.string().min(1)),
    contentIds: z.array(z.string().min(1)),
    findings: z.array(implementationFindingSchema),
    evidencePath: z.string().min(1),
  })
  .strict()
  .superRefine(requireActionableFindings)

export const changeImpactTerminalSchema = z
  .object({
    workerType: z.literal('change-impact-analyzer'),
    classification: z.enum([
      'question',
      'implementation_only',
      'documents_required',
    ]),
    affectedRequirementIds: z.array(z.string().min(1)),
    affectedChecklistIds: z.array(z.string().min(1)),
    rationale: z.string().min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const changeImpactSubmissionSchema = changeImpactTerminalSchema.omit({
  workerType: true,
  evidencePath: true,
})

export const questionAnswerTerminalSchema = z
  .object({
    workerType: z.literal('question-answerer'),
    answer: z.string().min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const questionAnswerSubmissionSchema = questionAnswerTerminalSchema.omit(
  {
    workerType: true,
    evidencePath: true,
  },
)

export const workerTerminalSchema = z.union([
  gameIrCompilerTerminalSchema,
  documentAuthorTerminalSchema,
  foundationFactExtractorTerminalSchema,
  foundationSemanticReviewerTerminalSchema,
  foundationDocumentReviserTerminalSchema,
  resourcePlannerTerminalSchema,
  resourceCuratorTerminalSchema,
  resourceContentAuthorTerminalSchema,
  atomicTaskPlannerTerminalSchema,
  implementationWorkerTerminalSchema,
  implementationAuditorTerminalSchema,
  acceptanceValidatorTerminalSchema,
  changeImpactTerminalSchema,
  questionAnswerTerminalSchema,
])

export type WorkerTerminalResult = z.infer<typeof workerTerminalSchema>

export function parseWorkerTerminalResult(
  value: unknown,
): WorkerTerminalResult {
  return workerTerminalSchema.parse(value)
}
