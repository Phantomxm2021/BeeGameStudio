import { describe, expect, test } from 'bun:test'
import {
  admitResourceRealizationSemanticResult,
  prepareResourceRealizationSemanticProjectionPacket,
} from './resource-realization-producer'
import {
  admitResourceRealizationSemanticValidationResult,
  prepareResourceRealizationSemanticValidationPacket,
} from './phase6-admission'
import {
  completeResourceInput,
  realAuthority,
  type PresentationRequirementFixture,
  type ResourceFixtureNode,
  validationAuthority as buildValidationAuthority,
} from './resource-realization-test-helpers'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
} from './model'

function validationFixture(
  mutate?: (nodes: ResourceFixtureNode[]) => ResourceFixtureNode[],
  artifactRuntimeRole = 'player',
) {
  const result = validationInput(mutate, artifactRuntimeRole)
  return {
    ...result,
    packet: prepareResourceRealizationSemanticValidationPacket(
      result.validation,
    ),
  }
}

function validationInput(
  mutate?: (nodes: ResourceFixtureNode[]) => ResourceFixtureNode[],
  artifactRuntimeRole = 'player',
) {
  const authority = realAuthority()
  const projectionPacket =
    prepareResourceRealizationSemanticProjectionPacket(authority)
  const semantic = admitResourceRealizationSemanticResult(
    authority,
    projectionPacket,
    completeResourceInput(
      projectionPacket,
      authority.resourceRealization.source.sectionBytes,
      artifactRuntimeRole,
      mutate,
    ),
  )
  if (semantic.outcome !== 'PROJECTED')
    throw new Error(`fixture did not project: ${semantic.reasonCode}`)
  const validation = buildValidationAuthority(authority, semantic)
  return { authority, projectionPacket, semantic, validation }
}

function tamperSemanticReceipt(
  semantic: ReturnType<typeof validationFixture>['semantic'],
  mutate: (
    claims: ReturnType<typeof validationFixture>['semantic']['sourceClaims'],
  ) => readonly unknown[],
) {
  const { receiptDigest: _receiptDigest, ...body } = semantic
  const next = { ...body, sourceClaims: mutate(semantic.sourceClaims) }
  return { ...next, receiptDigest: digestGameIrValue(next) }
}

describe('Phase 6 Resource Realization admission', () => {
  test('prepares a deterministic frozen packet with exact Presentation derivation and owner fidelity', () => {
    const firstInput = validationInput()
    const first = prepareResourceRealizationSemanticValidationPacket(
      firstInput.validation,
    )
    const second = prepareResourceRealizationSemanticValidationPacket(
      firstInput.validation,
    )
    expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
    expect(first.packetDigest).toBe(second.packetDigest)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.sourceSections)).toBe(true)
    expect(Object.isFrozen(first.priorModules)).toBe(true)
    expect(Object.isFrozen(first.checkIds)).toBe(true)

    const module = JSON.parse(first.moduleBytes) as {
      nodes: Array<{
        id: string
        kind: string
        producerMode: string
        value: Record<string, unknown>
        edges: Array<Record<string, string>>
        bindings: Record<string, { kind: string; inputs?: unknown[] }>
      }>
    }
    const derived = module.nodes.find(
      node => node.id === 'resource.requirement.screen-main',
    )!
    expect(derived).toMatchObject({
      kind: 'resource-realization.logical-resource',
      producerMode: 'derived',
      value: {
        requirementId: 'screen-main',
        resourceKind: 'ui-asset',
        runtimeRole: 'screen',
      },
    })
    expect(Object.keys(derived.bindings).sort(compareCodeUnits)).toEqual([
      '/edges/0',
      '/id',
      '/value/requirementId',
      '/value/resourceKind',
      '/value/runtimeRole',
    ])
    const requirement = first.presentationRequirements[0]!
    const derivedBindingExpectations = [
      [
        '/id',
        'presentation-requirement-id',
        requirement.requirementIdPointer,
        requirement.requirementId,
      ],
      [
        '/value/requirementId',
        'presentation-requirement-id',
        requirement.requirementIdPointer,
        requirement.requirementId,
      ],
      [
        '/value/resourceKind',
        'presentation-resource-kind',
        requirement.kindPointer,
        requirement.kind,
      ],
      [
        '/value/runtimeRole',
        'presentation-runtime-role',
        requirement.runtimeRolePointer,
        requirement.runtimeRole,
      ],
      [
        '/edges/0',
        'presentation-requirement-owner',
        '/id',
        requirement.ownerNodeId,
      ],
    ] as const
    for (const [
      pointer,
      derivationRuleId,
      targetPointer,
      targetValue,
    ] of derivedBindingExpectations) {
      const binding = derived.bindings[pointer]!
      expect(binding.kind).toBe('derived')
      expect(binding.inputs).toEqual([
        {
          kind: 'external',
          moduleId: 'presentation',
          nodeId: requirement.ownerNodeId,
          pointer: targetPointer,
          targetDigest: digestGameIrValue(targetValue),
        },
      ])
      expect((binding as { derivationRuleId?: string }).derivationRuleId).toBe(
        derivationRuleId,
      )
    }
    expect(derived.edges).toEqual([
      {
        type: 'required-by',
        targetId: 'presentation-screen-main',
        targetType: 'presentation.ui-screen',
      },
    ])
    expect(
      first.presentationRequirements.map(item => item.requirementId),
    ).toEqual(['screen-main'])
    const claimSections = new Set(
      firstInput.semantic.sourceClaims.map(
        claim => `${claim.documentPath}#${claim.sectionId}`,
      ),
    )
    expect(claimSections).toEqual(
      new Set([
        'docs/ASSET_PLAN.md#section-7',
        'docs/ASSET_PLAN.md#section-asset-extra',
        'docs/TECHNICAL_DESIGN.md#section-3',
      ]),
    )
    const assetSections =
      firstInput.validation.resourceRealization.source.sectionIndex.filter(
        section => section.documentPath === 'docs/ASSET_PLAN.md',
      )
    expect(assetSections).toHaveLength(2)
    expect(assetSections[0]!.digest).not.toBe(assetSections[1]!.digest)
    expect(assetSections[0]!.endLine).toBeLessThan(assetSections[1]!.startLine)
    expect(
      firstInput.validation.resourceRealization.source.sectionBytes[
        `${assetSections[0]!.documentPath}#${assetSections[0]!.sectionId}`
      ],
    ).not.toBe(
      firstInput.validation.resourceRealization.source.sectionBytes[
        `${assetSections[1]!.documentPath}#${assetSections[1]!.sectionId}`
      ],
    )

    expect(() => {
      ;(
        firstInput.validation.resourceRealization.semantic.nodes[0]!
          .value as Record<string, unknown>
      ).runtimeRole = 'mutated-input'
    }).toThrow(/read only|frozen|assign|object/i)
    expect(canonicalGameIrJson(first)).toBe(
      canonicalGameIrJson(
        prepareResourceRealizationSemanticValidationPacket(
          firstInput.validation,
        ),
      ),
    )
  })

  test('derives zero, same-owner multi, and second-owner Presentation requirements without overlap', () => {
    const cases: readonly [
      string,
      readonly PresentationRequirementFixture[],
    ][] = [
      ['zero', []],
      [
        'same-owner-two',
        [
          { requirementId: 'screen-hud', kind: 'ui', runtimeRole: 'screen' },
          { requirementId: 'screen-main', kind: 'ui', runtimeRole: 'screen' },
        ],
      ],
      [
        'second-owner',
        [
          { requirementId: 'screen-main', kind: 'ui', runtimeRole: 'screen' },
          {
            requirementId: 'screen-secondary',
            kind: 'ui',
            runtimeRole: 'screen',
            owner: 'secondary',
          },
        ],
      ],
    ] as const
    for (const [label, presentationRequirements] of cases) {
      const authority = realAuthority({ presentationRequirements })
      const projectionPacket =
        prepareResourceRealizationSemanticProjectionPacket(authority)
      expect(
        projectionPacket.presentationRequirements.map(
          item => item.requirementId,
        ),
        label,
      ).toEqual(
        presentationRequirements
          .map(item => item.requirementId)
          .sort(compareCodeUnits),
      )
      expect(
        projectionPacket.presentationRequirements.map(item => item.ownerNodeId),
      ).toEqual(
        [...presentationRequirements]
          .sort((left, right) =>
            compareCodeUnits(left.requirementId, right.requirementId),
          )
          .map(item =>
            item.owner === 'secondary'
              ? 'presentation-screen-secondary'
              : 'presentation-screen-main',
          ),
      )
      const semantic = admitResourceRealizationSemanticResult(
        authority,
        projectionPacket,
        completeResourceInput(
          projectionPacket,
          authority.resourceRealization.source.sectionBytes,
        ),
      )
      if (semantic.outcome !== 'PROJECTED')
        throw new Error('expected projected')
      const validation = buildValidationAuthority(authority, semantic)
      const packet =
        prepareResourceRealizationSemanticValidationPacket(validation)
      const module = JSON.parse(packet.moduleBytes) as {
        nodes: Array<{
          id: string
          kind: string
          producerMode: string
          edges: unknown[]
        }>
      }
      for (const requirement of presentationRequirements) {
        const id = `resource.requirement.${requirement.requirementId}`
        expect(module.nodes.filter(node => node.id === id)).toHaveLength(1)
        expect(
          module.nodes.filter(
            node => node.id === `profile-${requirement.requirementId}`,
          ),
        ).toHaveLength(1)
        expect(
          module.nodes.filter(
            node => node.id === `variant-${requirement.requirementId}`,
          ),
        ).toHaveLength(1)
        expect(
          module.nodes.filter(
            node => node.id === `artifact-${requirement.requirementId}`,
          ),
        ).toHaveLength(1)
      }
      expect(
        module.nodes.filter(
          node =>
            node.kind === 'resource-realization.logical-resource' &&
            node.producerMode === 'derived',
        ),
      ).toHaveLength(presentationRequirements.length)
    }
    expect(() =>
      realAuthority({
        presentationRequirements: [
          { requirementId: 'duplicate', kind: 'ui', runtimeRole: 'screen' },
          { requirementId: 'duplicate', kind: 'ui', runtimeRole: 'screen' },
        ],
      }),
    ).toThrow(/duplicated|duplicate|requirement/i)
  })

  test('keeps the selected source closure authoritative across representative source and claim tampering', () => {
    const base = validationInput()
    const source = base.validation.resourceRealization.source
    const selected = source.sectionIndex
    const sourceCases = [
      ['missing selected section', { sectionIndex: selected.slice(1) }],
      ['reordered selected section', { sectionIndex: [...selected].reverse() }],
      ['extra selected section', { sectionIndex: [...selected, selected[0]] }],
      [
        'stale section metadata',
        {
          sectionIndex: selected.map((item, index) =>
            index === 0 ? { ...item, heading: 'stale' } : item,
          ),
        },
      ],
      [
        'stale section digest',
        {
          sectionIndex: selected.map((item, index) =>
            index === 0 ? { ...item, digest: 'f'.repeat(64) } : item,
          ),
        },
      ],
      [
        'stale section bytes',
        {
          sectionBytes: {
            ...source.sectionBytes,
            [`${selected[0]!.documentPath}#${selected[0]!.sectionId}`]: `${source.sectionBytes[`${selected[0]!.documentPath}#${selected[0]!.sectionId}`]}tampered`,
          },
        },
      ],
    ] as const
    for (const [label, changes] of sourceCases)
      expect(
        () =>
          prepareResourceRealizationSemanticValidationPacket({
            ...base.validation,
            resourceRealization: {
              ...base.validation.resourceRealization,
              source: { ...source, ...changes },
            },
          } as never),
        label,
      ).toThrow(/source|section|digest|stale|authority|exact/i)

    const claim = base.semantic.sourceClaims.find(item =>
      item.subject.endsWith('/value/runtimeRole'),
    )!
    const claimCases = [
      ['out-of-bounds claim', { sourcePointer: '/bytes/0/999999' }],
      [
        'claim outside selected closure',
        { documentPath: 'docs/GDD.md', sectionId: 'section-0' },
      ],
    ] as const
    for (const [label, changes] of claimCases) {
      const semantic = tamperSemanticReceipt(base.semantic, claims =>
        claims.map(item =>
          item.subject === claim.subject ? { ...item, ...changes } : item,
        ),
      )
      expect(
        () =>
          prepareResourceRealizationSemanticValidationPacket(
            buildValidationAuthority(base.authority, semantic as never),
          ),
        label,
      ).toThrow(/source|bytes|selected|closure|outside|authority/i)
    }

    const unicode = validationInput(undefined, '角色')
    const unicodeClaim = unicode.semantic.sourceClaims.find(item =>
      item.subject.endsWith('/value/runtimeRole'),
    )!
    const unicodeBytes =
      unicode.validation.resourceRealization.source.sectionBytes[
        `${unicodeClaim.documentPath}#${unicodeClaim.sectionId}`
      ]!
    const unicodeStart = Buffer.byteLength(
      unicodeBytes.slice(0, unicodeBytes.indexOf('角色')),
      'utf8',
    )
    const split = tamperSemanticReceipt(unicode.semantic, claims =>
      claims.map(item =>
        item.subject === unicodeClaim.subject
          ? {
              ...item,
              sourcePointer: `/bytes/${unicodeStart + 1}/${unicodeStart + 1 + Buffer.byteLength('角色', 'utf8')}`,
            }
          : item,
      ),
    )
    expect(() =>
      prepareResourceRealizationSemanticValidationPacket(
        buildValidationAuthority(unicode.authority, split as never),
      ),
    ).toThrow(/UTF-8|boundary|source byte/i)
  })

  test('rejects shared-admitted semantic receipts that violate final Resource invariants', () => {
    const cases: readonly [
      string,
      (nodes: ResourceFixtureNode[]) => ResourceFixtureNode[],
      string?,
    ][] = [
      [
        'missing acquisition profile',
        nodes => nodes.filter(node => node.id !== 'profile-main'),
      ],
      [
        'duplicate acquisition profile',
        nodes =>
          nodes.map(node =>
            node.id === 'profile-screen-main'
              ? {
                  ...node,
                  edges: [
                    {
                      type: 'describes',
                      targetId: 'resource.requirement.player-model',
                      targetType: 'resource-realization.logical-resource',
                    },
                  ],
                }
              : node,
          ),
      ],
      [
        'missing variant closure',
        nodes =>
          nodes.map(node =>
            node.id === 'variant-main'
              ? {
                  ...node,
                  edges: [
                    {
                      type: 'realizes',
                      targetId: 'resource.requirement.screen-main',
                      targetType: 'resource-realization.logical-resource',
                    },
                  ],
                }
              : node,
          ),
      ],
      [
        'missing artifact closure',
        nodes =>
          nodes.map(node =>
            node.id === 'artifact-main'
              ? {
                  ...node,
                  edges: [
                    {
                      type: 'part-of',
                      targetId: 'variant-screen-main',
                      targetType: 'resource-realization.variant',
                    },
                  ],
                }
              : node,
          ),
      ],
      [
        'zero delivery targets',
        nodes =>
          nodes.filter(
            node => node.kind !== 'resource-realization.delivery-target',
          ),
      ],
      [
        'two delivery targets',
        nodes => [
          ...nodes,
          {
            ...nodes.find(node => node.id === 'target-main')!,
            id: 'target-secondary',
          },
        ],
      ],
      [
        'unsafe artifact path',
        nodes =>
          nodes.map(node =>
            node.id === 'artifact-main'
              ? {
                  ...node,
                  value: { ...node.value, path: 'assets/runtime/../evil.glb' },
                }
              : node,
          ),
      ],
      [
        'duplicate artifact path',
        nodes =>
          nodes.map(node =>
            node.id === 'artifact-screen-main'
              ? {
                  ...node,
                  value: {
                    ...node.value,
                    path: 'assets/runtime/player-model.glb',
                  },
                }
              : node,
          ),
      ],
      [
        'path and format mismatch',
        nodes =>
          nodes.map(node =>
            node.id === 'artifact-main'
              ? {
                  ...node,
                  value: {
                    ...node.value,
                    path: 'assets/runtime/player-model.txt',
                    format: 'txt',
                  },
                }
              : node,
          ),
      ],
      [
        'delivery target format mismatch',
        nodes =>
          nodes.map(node =>
            node.id === 'target-main'
              ? {
                  ...node,
                  value: { ...node.value, assetFormatCapabilities: ['glb'] },
                }
              : node,
          ),
      ],
      [
        'actual resource observation',
        nodes =>
          nodes.map(node =>
            node.id === 'artifact-main'
              ? {
                  ...node,
                  value: { ...node.value, actualResource: 'observed' },
                }
              : node,
          ),
      ],
    ]
    for (const [label, mutate] of cases) {
      const input = validationInput(mutate)
      expect(
        () =>
          prepareResourceRealizationSemanticValidationPacket(input.validation),
        label,
      ).toThrow(
        /profile|variant|artifact|target|path|format|field|observation|resource/i,
      )
    }

    // Presentation-owned shadowing is rejected by the shared producer receipt seam;
    // its lower-boundary characterization remains in resource-realization-producer.test.ts.
    expect(() => {
      const input = validationInput(nodes =>
        nodes.concat({
          id: 'resource.requirement.screen-main',
          kind: 'resource-realization.logical-resource',
          value: {
            requirementId: 'screen-main',
            resourceKind: 'ui-asset',
            runtimeRole: 'screen',
          },
          references: [],
          edges: [
            {
              type: 'required-by',
              targetId: 'state-start',
              targetType: 'gameplay.state',
            },
          ],
        }),
      )
      return input
    }).toThrow(/shadow|forbidden|overlap|claim|source/i)
  })

  test('admits only exact Phase 6 validation result seams and freezes all legal outcomes', () => {
    const fixture = validationFixture()
    const packet = fixture.packet
    const pass = {
      outcome: 'PASS' as const,
      packetDigest: packet.packetDigest,
      checkIds: packet.checkIds,
      coveredTargets: packet.requiredTargets,
    }
    const admittedPass = admitResourceRealizationSemanticValidationResult(
      fixture.validation,
      packet,
      pass,
    )
    if (admittedPass.outcome !== 'PASS') throw new Error('expected PASS')
    expect(Object.isFrozen(admittedPass)).toBe(true)
    expect(Object.isFrozen(admittedPass.checkIds)).toBe(true)
    expect(Object.isFrozen(admittedPass.coveredTargets)).toBe(true)

    const passCases = [
      ['partial checkIds', { checkIds: packet.checkIds.slice(1) }],
      ['extra checkIds', { checkIds: [...packet.checkIds, 'rogue-check'] }],
      ['reordered checkIds', { checkIds: [...packet.checkIds].reverse() }],
      [
        'partial coveredTargets',
        { coveredTargets: packet.requiredTargets.slice(1) },
      ],
      [
        'extra coveredTargets',
        { coveredTargets: [...packet.requiredTargets, 'rogue-target'] },
      ],
      [
        'reordered coveredTargets',
        { coveredTargets: [...packet.requiredTargets].reverse() },
      ],
      ['wrong packet digest', { packetDigest: '0'.repeat(64) }],
      ['extra result field', { extra: true }],
    ] as const
    for (const [label, changes] of passCases)
      expect(
        () =>
          admitResourceRealizationSemanticValidationResult(
            fixture.validation,
            packet,
            { ...pass, ...changes },
          ),
        label,
      ).toThrow(/validation|check|target|digest|field|canonical|stale/i)

    const sectionEvidence = packet.allowedEvidencePointers.find(pointer =>
      pointer.startsWith('section:'),
    )!
    const sectionEvidencePointers = packet.allowedEvidencePointers.filter(
      pointer => pointer.startsWith('section:'),
    )
    const bindingEvidence = packet.allowedEvidencePointers.find(pointer =>
      pointer.startsWith('binding:'),
    )!
    const fail = {
      outcome: 'FAIL' as const,
      packetDigest: packet.packetDigest,
      reasonCode: 'missing-projection' as const,
      actual: 'missing resource projection',
      missingSubject: packet.requiredTargets[0]!,
      expectedProjection: 'a complete resource projection',
      evidencePointers: [sectionEvidence],
    }
    const ambiguous = {
      outcome: 'AMBIGUOUS' as const,
      packetDigest: packet.packetDigest,
      reasonCode: 'ambiguous-projection' as const,
      actual: 'two resource projections',
      missingSubject: packet.requiredTargets[0]!,
      expectedProjection: 'one resource projection',
      evidencePointers: [sectionEvidence],
    }
    const admittedFail = admitResourceRealizationSemanticValidationResult(
      fixture.validation,
      packet,
      fail,
    )
    const admittedAmbiguous = admitResourceRealizationSemanticValidationResult(
      fixture.validation,
      packet,
      ambiguous,
    )
    const admittedMismatch = admitResourceRealizationSemanticValidationResult(
      fixture.validation,
      packet,
      {
        outcome: 'FAIL',
        packetDigest: packet.packetDigest,
        reasonCode: 'projection-mismatch',
        actual: 'different projection bytes',
        evidencePointers: [bindingEvidence],
      },
    )
    if (admittedFail.outcome !== 'FAIL') throw new Error('expected FAIL')
    if (admittedAmbiguous.outcome !== 'AMBIGUOUS')
      throw new Error('expected AMBIGUOUS')
    if (admittedMismatch.outcome !== 'FAIL')
      throw new Error('expected projection-mismatch FAIL')
    expect(Object.isFrozen(admittedFail)).toBe(true)
    expect(Object.isFrozen(admittedAmbiguous)).toBe(true)
    expect(Object.isFrozen(admittedMismatch)).toBe(true)
    expect(Object.isFrozen(admittedFail.evidencePointers)).toBe(true)
    expect(Object.isFrozen(admittedAmbiguous.evidencePointers)).toBe(true)
    expect(Object.isFrozen(admittedMismatch.evidencePointers)).toBe(true)
    expect(admittedMismatch.reasonCode).toBe('projection-mismatch')

    const diagnosticCases = [
      ['wrong FAIL reason', { ...fail, reasonCode: 'ambiguous-projection' }],
      [
        'wrong AMBIGUOUS reason',
        { ...ambiguous, reasonCode: 'projection-mismatch' },
      ],
      ['empty evidence', { ...fail, evidencePointers: [] }],
      [
        'duplicate evidence',
        { ...fail, evidencePointers: [sectionEvidence, sectionEvidence] },
      ],
      [
        'unsorted evidence',
        {
          ...fail,
          evidencePointers: [
            sectionEvidencePointers[1]!,
            sectionEvidencePointers[0]!,
          ],
        },
      ],
      [
        'unallowed evidence',
        { ...fail, evidencePointers: ['outside:authority'] },
      ],
      ['wrong-kind evidence', { ...fail, evidencePointers: [bindingEvidence] }],
      [
        'invalid missingSubject',
        { ...fail, missingSubject: 'node:missing#/id' },
      ],
      ['extra diagnostic field', { ...fail, extra: true }],
    ] as const
    for (const [label, value] of diagnosticCases)
      expect(
        () =>
          admitResourceRealizationSemanticValidationResult(
            fixture.validation,
            packet,
            value,
          ),
        label,
      ).toThrow(
        label === 'unsorted evidence'
          ? /sorted|canonical|order/i
          : label === 'wrong-kind evidence'
            ? /section|kind|evidence/i
            : /validation|reason|evidence|subject|field|canonical|allowed|FAIL|AMBIGUOUS/i,
      )
  })

  test('rejects non-empty mechanical ownership at the Phase 6 entry seam', () => {
    const fixture = validationFixture()
    const mechanicalBody = {
      ...fixture.validation.resourceRealization.mechanical,
      ownedTargets: ['node:rogue#/id'],
    }
    const mechanical = {
      ...mechanicalBody,
      receiptDigest: digestGameIrValue(mechanicalBody),
    }
    expect(() =>
      prepareResourceRealizationSemanticValidationPacket({
        ...fixture.validation,
        resourceRealization: {
          ...fixture.validation.resourceRealization,
          mechanical,
        },
      } as never),
    ).toThrow(/mechanical|ownedTargets|empty/i)
  })

  test('admits a complete real Resource receipt into an exact fidelity packet', () => {
    const authority = realAuthority()
    const projectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const semantic = admitResourceRealizationSemanticResult(
      authority,
      projectionPacket,
      completeResourceInput(
        projectionPacket,
        authority.resourceRealization.source.sectionBytes,
      ),
    )
    expect(semantic.outcome).toBe('PROJECTED')
    if (semantic.outcome !== 'PROJECTED') return
    const validationAuthority = buildValidationAuthority(authority, semantic)
    const packet =
      prepareResourceRealizationSemanticValidationPacket(validationAuthority)
    expect(packet.moduleId).toBe('resource-realization')
    expect(packet.moduleBytes).toContain('resource.requirement.screen-main')
    const result = admitResourceRealizationSemanticValidationResult(
      validationAuthority,
      packet,
      {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    )
    expect(result.outcome).toBe('PASS')
    const sectionEvidence = packet.allowedEvidencePointers.find(pointer =>
      pointer.startsWith('section:'),
    )!
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        packet,
        {
          outcome: 'FAIL',
          packetDigest: packet.packetDigest,
          reasonCode: 'projection-mismatch',
          actual: 'different',
          evidencePointers: [sectionEvidence],
        },
      ),
    ).toThrow(/owner bindings|binding/i)
  })

  test('rejects a packet when its source bytes or module bytes are detached', () => {
    const authority = realAuthority()
    const projectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const semantic = admitResourceRealizationSemanticResult(
      authority,
      projectionPacket,
      completeResourceInput(
        projectionPacket,
        authority.resourceRealization.source.sectionBytes,
      ),
    )
    if (semantic.outcome !== 'PROJECTED')
      throw new Error('fixture did not project')
    const validationAuthority = buildValidationAuthority(authority, semantic)
    const packet =
      prepareResourceRealizationSemanticValidationPacket(validationAuthority)
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        { ...packet, moduleBytes: `${packet.moduleBytes} ` },
        {
          outcome: 'PASS',
          packetDigest: packet.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        {
          ...packet,
          sourceSections: packet.sourceSections.map(section => ({
            ...section,
            bytes: `${section.bytes}tampered`,
          })),
        },
        {
          outcome: 'PASS',
          packetDigest: packet.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)
    expect(digestGameIrValue(packet.moduleBytes)).toHaveLength(64)
  })

  test('rejects a full-recomputed packet replacement and cross-authority packet', () => {
    const authority = realAuthority()
    const projectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const semantic = admitResourceRealizationSemanticResult(
      authority,
      projectionPacket,
      completeResourceInput(
        projectionPacket,
        authority.resourceRealization.source.sectionBytes,
      ),
    )
    if (semantic.outcome !== 'PROJECTED')
      throw new Error('fixture did not project')
    const validationAuthority = buildValidationAuthority(authority, semantic)
    const packet =
      prepareResourceRealizationSemanticValidationPacket(validationAuthority)
    const replacementModule = JSON.parse(packet.moduleBytes) as {
      nodes: Array<{ id: string; value: Record<string, unknown> }>
    }
    const replacementNode = replacementModule.nodes.find(
      node => node.id === 'resource.requirement.player-model',
    )!
    replacementNode.value = { ...replacementNode.value, runtimeRole: 'screen' }
    const replacementBody = {
      ...packet,
      moduleBytes: canonicalGameIrJson(replacementModule),
      moduleDigest: digestGameIrValue(replacementModule),
    }
    const { packetDigest: _packetDigest, ...replacementWithoutDigest } =
      replacementBody
    const replacementPacket = {
      ...replacementBody,
      packetDigest: digestGameIrValue(replacementWithoutDigest),
    }
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        replacementPacket,
        {
          outcome: 'PASS',
          packetDigest: replacementPacket.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)

    const otherProjectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const otherSemantic = admitResourceRealizationSemanticResult(
      authority,
      otherProjectionPacket,
      completeResourceInput(
        otherProjectionPacket,
        authority.resourceRealization.source.sectionBytes,
        'screen',
      ),
    )
    if (otherSemantic.outcome !== 'PROJECTED')
      throw new Error('alternate fixture did not project')
    const otherValidationAuthority = buildValidationAuthority(
      authority,
      otherSemantic,
    )
    const otherPacket = prepareResourceRealizationSemanticValidationPacket(
      otherValidationAuthority,
    )
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        otherPacket,
        {
          outcome: 'PASS',
          packetDigest: otherPacket.packetDigest,
          checkIds: otherPacket.checkIds,
          coveredTargets: otherPacket.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)
  })
})
