import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import {
  gameIrCompilerTerminalSchema,
  gameIrProjectionModelPayloadSchema,
  gameIrValidationModelPayloadSchema,
  parseGameIrCompilerModelPayload,
} from '../worker-contracts'
import * as workerContracts from '../worker-contracts'
import { buildGameIrProjectionContract } from './projection-contract'
import {
  deriveProjectionSlicePlan,
  buildGameIrProjectionSliceAdmissionJsonSchema,
} from './projection-slices'

const firstSliceSchema = (
  moduleId: Parameters<typeof buildGameIrProjectionSliceAdmissionJsonSchema>[0],
) =>
  buildGameIrProjectionSliceAdmissionJsonSchema(
    moduleId,
    deriveProjectionSlicePlan(moduleId).slices[0]!,
  )

describe('Game IR worker operation contracts', () => {
  test('does not export the deleted generic projection schema', () => {
    expect(
      (workerContracts as Record<string, unknown>)
        .gameIrProjectionStructuredOutputJsonSchema,
    ).toBeUndefined()
  })

  test('derives exact per-kind value and relationship rules from every domain manifest', () => {
    for (const moduleId of [
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
      'resource-realization',
      'implementation-verification',
    ] as const) {
      const contract = buildGameIrProjectionContract(moduleId)
      expect(contract.nodes.length).toBeGreaterThan(0)
      expect(contract.nodes.every(node => node.value.required.length > 0)).toBe(
        true,
      )
      expect(contract.relationships.length).toBeGreaterThan(0)
      expect(contract.sourceEvidence).toEqual({
        nodeCoverage:
          'each emitted node ID appears in exactly one evidence group',
        grouping: 'one or more node IDs per service-owned evidence fragment',
        fragmentId: 'exact source.sections[].evidenceFragments[].fragmentId',
      })
    }
  })

  test('does not allow the known schema-valid producer-invalid gameplay projection', () => {
    const schema = buildGameIrProjectionSliceAdmissionJsonSchema(
      'gameplay',
      deriveProjectionSlicePlan('gameplay').slices[0]!,
    )
    const validate = new Ajv().compile(schema)
    const wrong = {
      status: 'completed',
      semantic: {
        nodes: [
          {
            id: 'entity.hero',
            kind: 'gameplay.entity',
            value: {
              type: 'player',
              name: 'Hero',
              role: 'hero',
              properties: {},
            },
            references: [],
            edges: [
              {
                type: 'consumes',
                targetId: 'x',
                targetType: 'gameplay.entity',
              },
            ],
          },
        ],
        sourceEvidenceGroups: [],
      },
    }
    expect(validate(wrong)).toBe(false)
  })

  test('admits only the producer node and source-claim DTO at the projection boundary', () => {
    const oldModelShape = {
      status: 'completed' as const,
      semantic: {
        outcome: 'PROJECTED' as const,
        nodes: [
          {
            id: 'entity.hero',
            kind: 'gameplay.entity',
            value: { label: 'Hero' },
            references: [],
            edges: [],
          },
        ],
        sourceEvidenceGroups: [],
      },
    }
    const producerModelShape = {
      status: 'completed' as const,
      sliceId: 'gameplay.slice.0',
      semantic: {
        nodes: [
          {
            id: 'entity.hero',
            kind: 'gameplay.entity',
            value: { label: 'Hero' },
            references: [],
            edges: [],
          },
        ],
        sourceEvidenceGroups: [
          {
            nodeIds: ['entity.hero'],
            fragmentId: 'e0.0',
          },
        ],
      },
    } as const
    const validate = new Ajv().compile(
      buildGameIrProjectionSliceAdmissionJsonSchema(
        'gameplay',
        deriveProjectionSlicePlan('gameplay').slices[0]!,
      ),
    )

    expect(() =>
      parseGameIrCompilerModelPayload(oldModelShape, 'projection'),
    ).toThrow()
    expect(validate(oldModelShape)).toBe(false)
    expect(() =>
      parseGameIrCompilerModelPayload(
        producerModelShape as unknown,
        'projection',
      ),
    ).not.toThrow()
    expect(validate(producerModelShape)).toBe(true)
    const removedLiteralEvidenceShape = structuredClone(
      producerModelShape,
    ) as unknown as Record<string, unknown>
    ;(
      (removedLiteralEvidenceShape.semantic as Record<string, unknown>)
        .sourceEvidenceGroups as Array<Record<string, unknown>>
    )[0]! = {
      nodeIds: ['entity.hero'],
      documentPath: 'docs/GDD.md',
      sectionId: 'gameplay',
      excerpt: 'Hero',
    }
    expect(() =>
      parseGameIrCompilerModelPayload(
        removedLiteralEvidenceShape,
        'projection',
      ),
    ).toThrow()
    expect(validate(removedLiteralEvidenceShape)).toBe(false)
  })

  test('accepts one projection result without compiler batch fields or service identity', () => {
    const payload = {
      status: 'completed' as const,
      sliceId: 'gameplay.slice.0',
      semantic: {
        nodes: [],
        sourceEvidenceGroups: [],
      },
    }

    expect(gameIrProjectionModelPayloadSchema.parse(payload)).toEqual(payload)
    expect(parseGameIrCompilerModelPayload(payload, 'projection')).toEqual(
      payload,
    )
    expect(() => gameIrValidationModelPayloadSchema.parse(payload)).toThrow()
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        ...payload,
        sourcePackets: [],
        domainResults: [],
        remainingDomainIds: [],
        resumeFrom: 'old-checkpoint',
        runId: 'service-owned',
      }),
    ).toThrow()
  })

  test('requires an exact slice identity and rejects whole-domain projection fields', () => {
    const payload = {
      status: 'completed' as const,
      sliceId: 'gameplay.slice.0',
      semantic: { nodes: [], sourceEvidenceGroups: [] },
    }
    expect(gameIrProjectionModelPayloadSchema.parse(payload)).toEqual(payload)
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        ...payload,
        reason: 'root reason is not a completed slice field',
      }),
    ).toThrow()
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        ...payload,
        semantic: {
          ...payload.semantic,
          outcome: 'PROJECTED',
          sourceClaims: [],
        },
      }),
    ).toThrow()
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        status: 'completed',
        semantic: payload.semantic,
      }),
    ).toThrow()
  })

  test('accepts one validation result and keeps projection and validation exclusive', () => {
    const payload = {
      status: 'completed' as const,
      validation: {
        outcome: 'PASS' as const,
        checkIds: ['projection.completeness'],
        coveredTargets: ['gameplay.unit'],
      },
    }

    expect(gameIrValidationModelPayloadSchema.parse(payload)).toEqual(payload)
    expect(parseGameIrCompilerModelPayload(payload, 'validation')).toEqual(
      payload,
    )
    expect(() =>
      parseGameIrCompilerModelPayload(payload, 'projection'),
    ).toThrow()
  })

  test('accepts service-owned identity only on the parsed terminal wrapper', () => {
    const terminal = {
      workerType: 'game-ir-compiler' as const,
      operation: 'projection' as const,
      status: 'completed' as const,
      sliceId: 'gameplay.slice.0',
      semantic: { nodes: [], sourceEvidenceGroups: [] },
      runId: 'run',
      dispatchId: 'dispatch',
      taskId: 'task',
      revision: 'revision',
    }

    const parsed = gameIrCompilerTerminalSchema.parse({
      ...terminal,
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
    })
    expect(parsed).toMatchObject({
      workerType: 'game-ir-compiler',
      operation: 'projection',
      runId: 'run',
    })
    expect(() => gameIrProjectionModelPayloadSchema.parse(terminal)).toThrow()
    expect(() =>
      gameIrCompilerTerminalSchema.parse({
        ...parsed,
        checkpointPath: 'forged',
        readyReceipt: {},
        authorityPath: 'forged',
      }),
    ).toThrow()
  })

  test('rejects the removed nested projection outcome and reports only the selected node kind', () => {
    const payload = {
      status: 'completed',
      sliceId: 'gameplay.slice.1',
      semantic: {
        nodes: [
          {
            id: 'transition.advance',
            kind: 'gameplay.transition',
            value: { label: 'Advance' },
            references: [],
            edges: [
              {
                type: 'on',
                targetId: 'action.advance',
                targetType: 'gameplay.action',
              },
            ],
          },
        ],
        sourceEvidenceGroups: [],
      },
    }
    const schema = buildGameIrProjectionSliceAdmissionJsonSchema(
      'gameplay',
      deriveProjectionSlicePlan('gameplay').slices[1]!,
    )
    const validate = new Ajv({ allErrors: true }).compile(schema)

    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        ...payload,
        semantic: { ...payload.semantic, outcome: 'PROJECTED' },
      }),
    ).toThrow()
    expect(
      validate({
        ...payload,
        semantic: { ...payload.semantic, outcome: 'PROJECTED' },
      }),
    ).toBe(false)
    expect(validate(payload)).toBe(false)
    const errors = validate.errors ?? []
    expect(
      errors.some(error => error.instancePath === '/semantic/nodes/0/edges/0'),
    ).toBe(true)
    expect(
      errors.some(error =>
        error.schemaPath.includes('/oneOf/0/properties/kind'),
      ),
    ).toBe(false)
  })

  test('rejects role-shaped edges and accepts the durable type-shaped edge DTO', () => {
    const base = {
      status: 'completed' as const,
      sliceId: 'gameplay.slice.0',
      semantic: {
        nodes: [
          {
            id: 'transition.advance',
            kind: 'gameplay.transition',
            value: { label: 'Advance' },
            references: [],
            edges: [],
          },
        ],
        sourceEvidenceGroups: [],
      },
    }
    const legacyRoleEdge = structuredClone(base)
    legacyRoleEdge.semantic.nodes[0]!.edges.push({
      role: 'on',
      targetId: 'action.advance',
    } as never)
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse(legacyRoleEdge),
    ).toThrow()

    const durableEdge = structuredClone(base)
    durableEdge.semantic.nodes[0]!.edges.push({
      type: 'on',
      targetId: 'action.advance',
      targetType: 'gameplay.action',
    } as never)
    expect(gameIrProjectionModelPayloadSchema.parse(durableEdge)).toEqual(
      durableEdge,
    )
  })

  test('requires an explicit operation and rejects the deleted compiler batch terminal', () => {
    expect(() =>
      gameIrCompilerTerminalSchema.parse({
        workerType: 'game-ir-compiler',
        status: 'completed',
        domainResults: [],
      }),
    ).toThrow()
  })
})
