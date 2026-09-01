import { expect, test } from 'bun:test'
import {
  admitImplementationVerificationSemanticValidationResult,
  prepareImplementationVerificationSemanticValidationPacket,
  type ImplementationVerificationValidationPreparationAuthority,
  type ImplementationVerificationSemanticValidationPacket,
} from './phase7-admission'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { digestGameIrValue } from './model'

function authority() {
  const fixture = implementationVerificationFixture()
  return {
    fixture,
    authority: {
      phase6Authority: fixture.phase6Authority,
      implementationVerification: {
        source: fixture.authority.source,
        mechanical: fixture.authority.mechanical,
        semantic: fixture.semantic,
      },
    } as ImplementationVerificationValidationPreparationAuthority,
  }
}

function redigestPacket(
  packet: ImplementationVerificationSemanticValidationPacket,
  field: string,
  mutation: (value: unknown) => unknown,
): ImplementationVerificationSemanticValidationPacket {
  const { packetDigest: _packetDigest, ...body } = packet
  const changed = {
    ...body,
    [field]: mutation((body as Record<string, unknown>)[field]),
  }
  return {
    ...changed,
    packetDigest: digestGameIrValue(changed),
  } as ImplementationVerificationSemanticValidationPacket
}

function redigestObject(
  value: Record<string, unknown>,
  digestField: string,
): Record<string, unknown> {
  const body = { ...value }
  delete body[digestField]
  return { ...body, [digestField]: digestGameIrValue(body) }
}

test('exposes the Phase 7 fidelity admission seam', () => {
  expect(
    prepareImplementationVerificationSemanticValidationPacket,
  ).toBeFunction()
  expect(admitImplementationVerificationSemanticValidationResult).toBeFunction()
})

test('prepares and admits one complete Phase 7 PASS packet', () => {
  const current = authority()
  const packet = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  expect(packet.schemaVersion).toBe(
    'game-ir-implementation-verification-semantic-validation-packet.v1',
  )
  expect(packet.moduleId).toBe('implementation-verification')
  expect(packet.priorModules).toHaveLength(5)
  expect(packet.checkIds).toEqual([
    'implementation.source-fidelity',
    'implementation.projection-completeness',
    'implementation.prior-closure',
    'implementation.ownership',
    'implementation.dependency',
    'implementation.scenario',
    'implementation.invariant',
    'implementation.proof-closure',
    'implementation.no-actual-evidence',
  ])
  const result = admitImplementationVerificationSemanticValidationResult(
    current.authority,
    packet,
    {
      outcome: 'PASS',
      packetDigest: packet.packetDigest,
      checkIds: packet.checkIds,
      coveredTargets: packet.requiredTargets,
    },
  )
  expect(result).toMatchObject({
    outcome: 'PASS',
    packetDigest: packet.packetDigest,
  })
})

test('reconstructs a frozen deterministic packet from replayed Phase 6 authority', () => {
  const current = authority()
  const first = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  const second = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  expect(first.packetDigest).toBe(second.packetDigest)
  expect(first).toEqual(second)
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.priorModules)).toBe(true)
  expect(Object.isFrozen(first.sourceSections)).toBe(true)
  expect(Object.isFrozen(first.checkIds)).toBe(true)
})

test('rejects validation authority fields and detached Phase 6 authority', () => {
  const current = authority()
  expect(() =>
    prepareImplementationVerificationSemanticValidationPacket({
      ...current.authority,
      implementationVerification: {
        ...current.authority.implementationVerification,
        validation: {},
      },
    } as never),
  ).toThrow(
    'invalid Game IR Phase 7 admission: implementationVerification authority has unknown or missing fields',
  )

  expect(() =>
    prepareImplementationVerificationSemanticValidationPacket({
      ...current.authority,
      phase6Authority: {
        ...current.authority.phase6Authority,
        detachedClosure: {},
      },
    } as never),
  ).toThrow(
    'invalid Game IR Resource Realization assembly: authority has unknown or missing fields',
  )
  expect(() =>
    prepareImplementationVerificationSemanticValidationPacket({
      ...current.authority,
      requiredPriorModuleIds: [],
    } as never),
  ).toThrow(
    'invalid Game IR Phase 7 admission: authority has unknown or missing fields',
  )

  const expectedPriorModules = [
    current.fixture.closure.phase5.phase4.gameplay.module,
    current.fixture.closure.phase5.phase4.balance.module,
    current.fixture.closure.phase5.worldScene.module,
    current.fixture.closure.phase5.presentation.module,
    current.fixture.closure.resourceRealization.module,
  ]
  const packet = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  expect(packet.priorModules).toEqual(expectedPriorModules)
  expect(
    packet.priorModules.flatMap(module => module.nodes.map(node => node.id)),
  ).toEqual(
    expectedPriorModules.flatMap(module => module.nodes.map(node => node.id)),
  )
})

test('admits only exact PASS, FAIL, and AMBIGUOUS validation seams', () => {
  const current = authority()
  const packet = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  const section = packet.allowedEvidencePointers.find(pointer =>
    pointer.startsWith('section:'),
  )!
  const binding = packet.allowedEvidencePointers.find(pointer =>
    pointer.startsWith('binding:'),
  )!
  expect(
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      packet,
      {
        outcome: 'FAIL',
        packetDigest: packet.packetDigest,
        reasonCode: 'projection-mismatch',
        actual: 'different projection',
        evidencePointers: [binding],
      },
    ).outcome,
  ).toBe('FAIL')
  expect(
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      packet,
      {
        outcome: 'AMBIGUOUS',
        packetDigest: packet.packetDigest,
        reasonCode: 'ambiguous-projection',
        actual: 'two projections',
        missingSubject: packet.requiredTargets[0],
        expectedProjection: 'one projection',
        evidencePointers: [section],
      },
    ).outcome,
  ).toBe('AMBIGUOUS')
  for (const mutation of [
    {
      value: { checkIds: packet.checkIds.slice(1) },
      error:
        'invalid Game IR Phase 7 admission: fidelity PASS checkIds has incomplete or extra values',
    },
    {
      value: { coveredTargets: packet.requiredTargets.slice(1) },
      error:
        'invalid Game IR Phase 7 admission: fidelity PASS coveredTargets has incomplete or extra values',
    },
    {
      value: { actual: 'forged', checkIds: packet.checkIds },
      error:
        'invalid Game IR Phase 7 admission: fidelity PASS result has unknown or missing fields',
    },
  ]) {
    expect(() =>
      admitImplementationVerificationSemanticValidationResult(
        current.authority,
        packet,
        {
          outcome: 'PASS',
          packetDigest: packet.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
          ...mutation.value,
        } as never,
      ),
    ).toThrow(mutation.error)
  }
})

test('rejects every packet identity and digest seam after an otherwise valid re-sign', () => {
  const current = authority()
  const packet = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  const mutations: readonly [string, (value: unknown) => unknown][] = [
    ['taskId', () => 'detached-task'],
    ['foundationRevision', () => 'detached-revision'],
    ['foundationReceiptDigest', () => 'f'.repeat(64)],
    [
      'compileRequest',
      value => ({
        ...(value as Record<string, unknown>),
        taskId: 'detached-task',
      }),
    ],
    ['compileRequestDigest', () => 'f'.repeat(64)],
    ['sourceDigest', () => 'f'.repeat(64)],
    ['mechanicalReceiptDigest', () => 'f'.repeat(64)],
    ['semanticReceiptDigest', () => 'f'.repeat(64)],
    ['authoritySectionIndexDigest', () => 'f'.repeat(64)],
    [
      'authoritySectionIndex',
      value => [...(value as readonly unknown[])].reverse(),
    ],
    ['sourceSections', value => [...(value as readonly unknown[])].reverse()],
    ['priorModules', value => [...(value as readonly unknown[])].reverse()],
    ['moduleId', () => 'detached-module'],
    ['moduleBytes', value => `${String(value)}\n`],
    ['moduleDigest', () => 'f'.repeat(64)],
    ['targetManifestDigest', () => 'f'.repeat(64)],
    ['checkIds', value => [...(value as readonly unknown[]), 'forged-check']],
    [
      'requiredTargets',
      value => [...(value as readonly unknown[]), 'node:forged#/value'],
    ],
    [
      'allowedEvidencePointers',
      value => [...(value as readonly unknown[]), 'section:forged'],
    ],
    ['packetDigest', () => 'f'.repeat(64)],
  ]
  for (const [field, mutation] of mutations) {
    const tampered =
      field === 'packetDigest'
        ? ({ ...packet, packetDigest: 'f'.repeat(64) } as const)
        : redigestPacket(packet, field, mutation)
    expect(() =>
      admitImplementationVerificationSemanticValidationResult(
        current.authority,
        tampered,
        {
          outcome: 'PASS',
          packetDigest: tampered.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
        },
      ),
    ).toThrow(
      'invalid Game IR Phase 7 admission: validation packet is stale, relabeled, or detached from authority',
    )
  }
})

test('replays and rejects each detached Phase 6 source, validation, and compile identity', () => {
  const current = authority()
  const phase6 = current.authority.phase6Authority
  const gameplay = phase6.phase5Authority.phase4Authority.gameplay
  const source = gameplay.source
  const redigestedPhase6Source = redigestObject(
    {
      ...source,
      taskId: 'detached-phase6-task',
      compileRequest: {
        ...source.compileRequest,
        taskId: 'detached-phase6-task',
      },
    },
    'sourceDigest',
  )
  const mutations: readonly [string, unknown, string][] = [
    [
      'source',
      {
        ...phase6,
        phase5Authority: {
          ...phase6.phase5Authority,
          phase4Authority: {
            ...phase6.phase5Authority.phase4Authority,
            gameplay: {
              ...gameplay,
              source: redigestedPhase6Source,
            },
          },
        },
      },
      'invalid Game IR domain projection: mechanical receipt taskId does not match source',
    ],
    [
      'validation',
      {
        ...phase6,
        resourceRealization: {
          ...phase6.resourceRealization,
          validation: {
            ...phase6.resourceRealization.validation,
            packetDigest: 'f'.repeat(64),
          },
        },
      },
      'invalid Game IR Phase 6 admission: fidelity PASS packet digest does not match packet',
    ],
    [
      'compile identity',
      {
        ...phase6,
        phase5Authority: {
          ...phase6.phase5Authority,
          phase4Authority: {
            ...phase6.phase5Authority.phase4Authority,
            gameplay: {
              ...gameplay,
              source: {
                ...source,
                compileRequest: {
                  ...source.compileRequest,
                  taskId: 'detached-compile-task',
                },
              },
            },
          },
        },
      },
      'invalid Game IR domain source: source envelope taskId does not match compile request',
    ],
  ]
  for (const [label, phase6Authority, error] of mutations) {
    expect(
      () =>
        prepareImplementationVerificationSemanticValidationPacket({
          ...current.authority,
          phase6Authority,
        } as never),
      label,
    ).toThrow(error)
  }
})

test('rejects re-digested detached Phase 7 source, mechanical, and semantic authorities', () => {
  const current = authority()
  const fixture = current.fixture
  const sourceBody = {
    ...fixture.authority.source,
    taskId: 'detached-phase7-task',
    compileRequest: {
      ...fixture.authority.source.compileRequest,
      taskId: 'detached-phase7-task',
    },
  }
  const detachedSource = redigestObject(sourceBody, 'sourceDigest')
  const detachedMechanical = redigestObject(
    {
      ...fixture.authority.mechanical,
      foundationRevision: 'detached-revision',
    },
    'receiptDigest',
  )
  const detachedSemantic = redigestObject(
    { ...fixture.semantic, sourceDigest: 'f'.repeat(64) },
    'receiptDigest',
  )
  const mutations: readonly [string, unknown, string][] = [
    [
      'source',
      detachedSource,
      'invalid Game IR domain projection: mechanical receipt taskId does not match source',
    ],
    [
      'mechanical',
      detachedMechanical,
      'invalid Game IR domain projection: mechanical receipt foundationRevision does not match source',
    ],
    [
      'semantic',
      detachedSemantic,
      'invalid Implementation/Verification producer: semantic receipt identity is stale or relabeled',
    ],
  ]
  for (const [label, value, error] of mutations) {
    const implementationVerification = {
      ...current.authority.implementationVerification,
      [label]: value,
    }
    expect(
      () =>
        prepareImplementationVerificationSemanticValidationPacket({
          ...current.authority,
          implementationVerification,
        } as never),
      label,
    ).toThrow(error)
  }
})

test('rejects a correctly re-digested but detached packet', () => {
  const current = authority()
  const packet = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  const { packetDigest: _packetDigest, ...body } = packet
  const tamperedBody = { ...body, moduleDigest: 'f'.repeat(64) }
  const tampered = {
    ...tamperedBody,
    packetDigest: digestGameIrValue(tamperedBody),
  }
  expect(() =>
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      tampered as never,
      {
        outcome: 'PASS',
        packetDigest: tampered.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    ),
  ).toThrow(
    'invalid Game IR Phase 7 admission: validation packet is stale, relabeled, or detached from authority',
  )
})

test('rejects packet accessors, hidden fields, and wrong evidence namespaces', () => {
  const current = authority()
  const packet = prepareImplementationVerificationSemanticValidationPacket(
    current.authority,
  )
  let invoked = false
  const accessor = Object.defineProperty({ ...packet }, 'moduleBytes', {
    enumerable: true,
    get() {
      invoked = true
      throw new Error('accessor executed')
    },
  })
  expect(() =>
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      accessor as never,
      {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    ),
  ).toThrow(
    'invalid Game IR Phase 7 admission: validation packet has a hidden or accessor property',
  )
  expect(invoked).toBe(false)
  const symbol = Symbol('rogue')
  const symbolPacket = { ...packet, [symbol]: true }
  expect(() =>
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      symbolPacket as never,
      {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    ),
  ).toThrow(
    'invalid Game IR Phase 7 admission: validation packet has a symbol property',
  )
  const hidden = Object.defineProperty({ ...packet }, 'rogue', {
    enumerable: false,
    value: true,
  })
  expect(() =>
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      hidden as never,
      {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    ),
  ).toThrow(
    'invalid Game IR Phase 7 admission: validation packet has a hidden or accessor property',
  )
  const section = packet.allowedEvidencePointers.find(pointer =>
    pointer.startsWith('section:'),
  )!
  const binding = packet.allowedEvidencePointers.find(pointer =>
    pointer.startsWith('binding:'),
  )!
  expect(() =>
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      packet,
      {
        outcome: 'FAIL',
        packetDigest: packet.packetDigest,
        reasonCode: 'projection-mismatch',
        actual: 'wrong namespace',
        evidencePointers: [section],
      },
    ),
  ).toThrow(
    'invalid Game IR Phase 7 admission: projection mismatch evidence must use owner bindings',
  )
  expect(() =>
    admitImplementationVerificationSemanticValidationResult(
      current.authority,
      packet,
      {
        outcome: 'AMBIGUOUS',
        packetDigest: packet.packetDigest,
        reasonCode: 'ambiguous-projection',
        actual: 'wrong namespace',
        missingSubject: packet.requiredTargets[0],
        expectedProjection: 'one projection',
        evidencePointers: [binding],
      },
    ),
  ).toThrow(
    'invalid Game IR Phase 7 admission: missing or ambiguous evidence must use section pointers',
  )
})

test('admits a substantially expanded scenario and evidence graph without a count ceiling', () => {
  const fixture = implementationVerificationFixture({ expandedCount: 24 })
  const current = {
    phase6Authority: fixture.phase6Authority,
    implementationVerification: {
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
      semantic: fixture.semantic,
    },
  } as ImplementationVerificationValidationPreparationAuthority
  const packet =
    prepareImplementationVerificationSemanticValidationPacket(current)
  const module = JSON.parse(packet.moduleBytes) as {
    nodes: Array<{ kind: string }>
  }
  expect(
    module.nodes.filter(node => node.kind.endsWith('acceptance-scenario'))
      .length,
  ).toBeGreaterThan(20)
  expect(
    module.nodes.filter(node => node.kind.endsWith('evidence-requirement'))
      .length,
  ).toBeGreaterThan(20)
  expect(
    admitImplementationVerificationSemanticValidationResult(current, packet, {
      outcome: 'PASS',
      packetDigest: packet.packetDigest,
      checkIds: packet.checkIds,
      coveredTargets: packet.requiredTargets,
    }).outcome,
  ).toBe('PASS')
})
