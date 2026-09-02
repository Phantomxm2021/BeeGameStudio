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

const projectionRecords = [
  {
    fragmentId: 'e0.0',
    node: {
      id: 'entity.hero',
      kind: 'gameplay.entity',
      value: { label: 'Hero' },
      references: [],
      edges: [],
    },
  },
]

const projectionPayload = {
  status: 'completed' as const,
  sliceId: 'gameplay.slice.0',
  records: projectionRecords,
  done: true as const,
}

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

  test('exposes Balance reference policy only for kinds governed by it', () => {
    const contract = buildGameIrProjectionContract('balance')
    for (const kind of [
      'balance.economy-source',
      'balance.economy-sink',
      'balance.reward',
      'balance.cost',
      'balance.reward-cost-binding',
    ])
      expect(
        contract.nodes.find(node => node.kind === kind)?.referencePolicy,
      ).toEqual({ kind: 'exact-edge-targets' })
    expect(
      contract.nodes.find(node => node.kind === 'balance.progression-curve')
        ?.referencePolicy,
    ).toBeUndefined()
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
      records: projectionRecords,
      done: true as const,
    }
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
    expect(validate(producerModelShape)).toBe(false)
    expect(() =>
      parseGameIrCompilerModelPayload(producerModelShape, 'projection'),
    ).not.toThrow()
  })

  test('accepts one projection result without compiler batch fields or service identity', () => {
    const payload = projectionPayload

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
    const payload = projectionPayload
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
        records: [],
        done: true,
        extra: true,
      }),
    ).toThrow()
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        status: 'completed',
        semantic: { nodes: [], sourceEvidenceGroups: [] },
      }),
    ).toThrow()
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        ...payload,
        done: false,
      }),
    ).toThrow()
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        status: 'failed',
        sliceId: payload.sliceId,
        records: payload.records,
        done: true,
        reason: 'bad record',
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
      records: [],
      done: true,
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

  test('rejects legacy semantic terminals and requires records on every projection status', () => {
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        status: 'completed',
        sliceId: 'gameplay.slice.0',
        semantic: { nodes: [], sourceEvidenceGroups: [] },
      }),
    ).toThrow()
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse({
        status: 'failed',
        sliceId: 'gameplay.slice.0',
        reason: 'bad record',
        done: false,
      }),
    ).toThrow()
    expect(
      gameIrProjectionModelPayloadSchema.parse({
        status: 'failed',
        sliceId: 'gameplay.slice.0',
        records: [],
        done: false,
        reason: 'bad record',
      }),
    ).toEqual({
      status: 'failed',
      sliceId: 'gameplay.slice.0',
      records: [],
      done: false,
      reason: 'bad record',
    })
  })

  test('rejects role-shaped edges and accepts the durable type-shaped edge DTO', () => {
    const base = {
      status: 'completed' as const,
      sliceId: 'gameplay.slice.0',
      records: [
        {
          fragmentId: 'e0.0',
          node: {
            id: 'transition.advance',
            kind: 'gameplay.transition',
            value: { label: 'Advance' },
            references: [],
            edges: [],
          },
        },
      ],
      done: true as const,
    }
    const legacyRoleEdge = structuredClone(base)
    legacyRoleEdge.records[0]!.node.edges.push({
      role: 'on',
      targetId: 'action.advance',
    } as never)
    expect(() =>
      gameIrProjectionModelPayloadSchema.parse(legacyRoleEdge),
    ).toThrow()

    const durableEdge = structuredClone(base)
    durableEdge.records[0]!.node.edges.push({
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
