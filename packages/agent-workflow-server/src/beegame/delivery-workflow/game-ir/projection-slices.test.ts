import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import {
  deriveProjectionSlicePlan,
  buildGameIrProjectionSliceAdmissionJsonSchema,
  normalizeGameIrProjectionSliceContext,
} from './projection-slices'
import {
  buildGameIrProjectionContract,
  buildGameIrProjectionSemanticJsonSchema,
} from './projection-contract'

const MODULES = [
  'gameplay',
  'balance',
  'world-scene',
  'presentation',
  'resource-realization',
  'implementation-verification',
] as const

describe('Game IR projection slices', () => {
  test('derives deterministic plans for every projection module', () => {
    for (const moduleId of MODULES) {
      const first = deriveProjectionSlicePlan(moduleId)
      const second = deriveProjectionSlicePlan(moduleId)

      expect(first).toEqual(second)
      expect(first.moduleId).toBe(moduleId)
      expect(first.slices.length).toBeGreaterThan(0)
      expect(first.slices.every(slice => slice.nodeKinds.length > 0)).toBe(true)
      expect(first.slices.flatMap(slice => slice.nodeKinds).length).toBe(
        new Set(first.slices.flatMap(slice => slice.nodeKinds)).size,
      )
      expect(new Set(first.slices.flatMap(slice => slice.nodeKinds))).toEqual(
        new Set(
          buildGameIrProjectionContract(moduleId).nodes.map(node => node.kind),
        ),
      )
    }
  })

  test('groups every component on the same dependency frontier', () => {
    const plan = deriveProjectionSlicePlan('gameplay')

    expect(plan.slices.map(slice => slice.nodeKinds)).toEqual([
      [
        'gameplay.condition',
        'gameplay.effect',
        'gameplay.entity',
        'gameplay.event',
        'gameplay.outcome',
        'gameplay.state',
      ],
      [
        'gameplay.action',
        'gameplay.capability',
        'gameplay.objective',
        'gameplay.rule',
        'gameplay.transition',
      ],
    ])
  })

  test('never places a relationship target in a future slice', () => {
    const plan = deriveProjectionSlicePlan('gameplay')
    const sliceIndex = new Map(
      plan.slices.flatMap((slice, index) =>
        slice.nodeKinds.map(kind => [kind, index] as const),
      ),
    )
    for (const node of buildGameIrProjectionContract('gameplay').nodes) {
      for (const relationship of node.relationships) {
        for (const targetKind of relationship.targetKinds) {
          if (sliceIndex.get(node.kind) !== sliceIndex.get(targetKind))
            expect(sliceIndex.get(targetKind)!).toBeLessThan(
              sliceIndex.get(node.kind)!,
            )
        }
      }
    }
  })

  test('groups strongly connected node kinds into one slice', () => {
    const world = deriveProjectionSlicePlan('world-scene')
    const worldCycle = world.slices.find(slice =>
      slice.nodeKinds.includes('world-scene.scene'),
    )
    expect(worldCycle?.nodeKinds).toEqual([
      'world-scene.node',
      'world-scene.scene',
      'world-scene.zone',
    ])

    const presentation = deriveProjectionSlicePlan('presentation')
    expect(
      presentation.slices.find(slice =>
        slice.nodeKinds.includes('presentation.ui-screen'),
      )?.nodeKinds,
    ).toEqual(
      expect.arrayContaining([
        'presentation.animation-clip',
        'presentation.audio-event',
        'presentation.ui-screen',
        'presentation.ui-state',
      ]),
    )
  })

  test('retains exact node kind and edge scope in each slice schema', () => {
    const plan = deriveProjectionSlicePlan('gameplay')
    const action = plan.slices.find(slice =>
      slice.nodeKinds.includes('gameplay.action'),
    )!
    const schema = buildGameIrProjectionSliceAdmissionJsonSchema(
      'gameplay',
      action,
    )
    const validate = new Ajv().compile(schema)
    const valid = {
      status: 'completed',
      sliceId: action.sliceId,
      semantic: {
        nodes: [
          {
            id: 'action.advance',
            kind: 'gameplay.action',
            value: { label: 'Advance' },
            references: [],
            edges: [
              {
                type: 'causes',
                targetId: 'event.advance',
                targetType: 'gameplay.event',
              },
            ],
          },
        ],
        sourceEvidenceGroups: [],
      },
    }
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true)

    const wrongKind = structuredClone(valid)
    wrongKind.semantic.nodes[0]!.kind = 'gameplay.entity'
    expect(validate(wrongKind)).toBe(false)

    const wrongEdge = structuredClone(valid)
    wrongEdge.semantic.nodes[0]!.edges[0]!.type = 'invented-role'
    expect(validate(wrongEdge)).toBe(false)
  })

  test('accepts an explicitly completed empty slice', () => {
    const slice = deriveProjectionSlicePlan('balance').slices[0]!
    const validate = new Ajv().compile(
      buildGameIrProjectionSliceAdmissionJsonSchema('balance', slice),
    )
    expect(
      validate({
        status: 'completed',
        sliceId: slice.sliceId,
        semantic: { nodes: [], sourceEvidenceGroups: [] },
      }),
    ).toBe(true)
  })

  test('mechanically enforces Balance single unit reference policy in slice schema', () => {
    const slice = deriveProjectionSlicePlan('balance').slices[0]!
    const validate = new Ajv().compile(
      buildGameIrProjectionSliceAdmissionJsonSchema('balance', slice),
    )
    const invalid = {
      status: 'completed',
      sliceId: slice.sliceId,
      semantic: {
        nodes: [
          {
            id: 'balance.parameter.invalid',
            kind: 'balance.parameter',
            value: { label: 'Invalid', baseline: 1, unitReferenceIndex: 1 },
            references: [
              { targetId: 'balance.unit.seconds', targetType: 'balance.unit' },
            ],
            edges: [],
          },
        ],
        sourceEvidenceGroups: [],
      },
    }
    expect(validate(invalid)).toBe(false)
    const missingReference = structuredClone(invalid)
    missingReference.semantic.nodes[0]!.value.unitReferenceIndex = 0
    missingReference.semantic.nodes[0]!.references = []
    expect(validate(missingReference)).toBe(false)
  })

  test('admits one canonical compact dependency context and rejects ID conflicts', () => {
    expect(
      normalizeGameIrProjectionSliceContext({
        moduleId: 'gameplay',
        sliceId: 'gameplay.slice.1',
        value: {
          availablePriorNodes: [
            {
              id: 'outcome.a',
              kind: 'gameplay.outcome',
              value: { label: 'Win', result: 'win' },
            },
            {
              id: 'state.b',
              kind: 'gameplay.state',
              value: { label: 'Defeat', initial: false, terminal: 'failure' },
            },
          ],
          requiredCurrentNodes: [
            { id: 'action.a', kind: 'gameplay.action' },
          ],
          admittedCurrentNodes: [
            { id: 'action.admitted', kind: 'gameplay.action' },
          ],
        },
      }),
    ).toEqual({
      availablePriorNodes: [
        {
          id: 'outcome.a',
          kind: 'gameplay.outcome',
          value: { label: 'Win', result: 'win' },
        },
        {
          id: 'state.b',
          kind: 'gameplay.state',
          value: { label: 'Defeat', initial: false, terminal: 'failure' },
        },
      ],
      requiredCurrentNodes: [{ id: 'action.a', kind: 'gameplay.action' }],
      admittedCurrentNodes: [
        { id: 'action.admitted', kind: 'gameplay.action' },
      ],
    })
    expect(() =>
      normalizeGameIrProjectionSliceContext({
        moduleId: 'gameplay',
        sliceId: 'gameplay.slice.1',
        value: {
          availablePriorNodes: [
            { id: 'same', kind: 'gameplay.outcome', value: {} },
            { id: 'same', kind: 'gameplay.state', value: {} },
          ],
          requiredCurrentNodes: [],
          admittedCurrentNodes: [],
        },
      }),
    ).toThrow(/unique|sorted|conflict/i)
  })

  test('requires exactly three context fields and a sorted unique admitted prefix', () => {
    expect(() =>
      normalizeGameIrProjectionSliceContext({
        moduleId: 'gameplay',
        sliceId: 'gameplay.slice.1',
        value: { availablePriorNodes: [], requiredCurrentNodes: [] },
      }),
    ).toThrow(/non-canonical|context/i)
    const base = {
      availablePriorNodes: [],
      requiredCurrentNodes: [],
    }
    expect(() =>
      normalizeGameIrProjectionSliceContext({
        moduleId: 'gameplay',
        sliceId: 'gameplay.slice.1',
        value: {
          ...base,
          admittedCurrentNodes: [
            { id: 'action.b', kind: 'gameplay.action' },
            { id: 'action.a', kind: 'gameplay.action' },
          ],
        },
      }),
    ).toThrow(/sorted|unique/i)
    expect(() =>
      normalizeGameIrProjectionSliceContext({
        moduleId: 'gameplay',
        sliceId: 'gameplay.slice.1',
        value: {
          ...base,
          admittedCurrentNodes: [
            { id: 'action.a', kind: 'gameplay.action' },
            { id: 'action.a', kind: 'gameplay.action' },
          ],
        },
      }),
    ).toThrow(/sorted|unique/i)
  })

  test('rejects whole-domain and future service fields at the slice boundary', () => {
    const slice = deriveProjectionSlicePlan('gameplay').slices[0]!
    const schema = buildGameIrProjectionSliceAdmissionJsonSchema(
      'gameplay',
      slice,
    )
    const validate = new Ajv().compile(schema)
    const futureShape = {
      status: 'completed',
      sliceId: slice.sliceId,
      semantic: { nodes: [], sourceEvidenceGroups: [] },
      reason: 'retry the whole domain',
      moduleId: 'gameplay',
      packetDigest: 'future',
      remainingSlices: [],
    }
    expect(validate(futureShape)).toBe(false)
  })

  test('does not treat caller-supplied node contracts as schema authority', () => {
    const canonical = buildGameIrProjectionContract('gameplay').nodes.find(
      node => node.kind === 'gameplay.action',
    )!
    const forged = structuredClone(canonical)
    ;(forged.value.fields as Record<string, unknown>).forged = {
      type: 'string',
    }
    expect(() =>
      buildGameIrProjectionSemanticJsonSchema('gameplay', [
        forged as unknown as string,
      ]),
    ).toThrow()
  })

  test('rejects a forged slice identity and a split canonical SCC', () => {
    const canonical = deriveProjectionSlicePlan('world-scene').slices.find(
      slice => slice.nodeKinds.includes('world-scene.scene'),
    )!
    expect(() =>
      buildGameIrProjectionSliceAdmissionJsonSchema('world-scene', {
        ...canonical,
        sliceId: 'forged.slice',
      }),
    ).toThrow()
    expect(() =>
      buildGameIrProjectionSliceAdmissionJsonSchema('world-scene', {
        ...canonical,
        nodeKinds: ['world-scene.scene'],
      }),
    ).toThrow()
  })
})
