import { describe, expect, test } from 'bun:test'
import {
  admitResourceRealizationSemanticResult,
  prepareResourceRealizationSemanticProjectionPacket,
  replayResourceRealizationSemanticReceipt,
  type ResourceRealizationSemanticProjectionPacket,
  type ResourceRealizationSemanticProjectionAuthority,
} from './resource-realization-producer'
import { RESOURCE_REALIZATION_DOMAIN_MANIFEST } from './resource-realization-schema'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
} from './model'
import { realAuthority } from './resource-realization.fixtures.test'

const section = {
  documentPath: 'docs/ASSET_PLAN.md' as const,
  sectionId: 'section-1',
}

function projectedInput() {
  return {
    outcome: 'PROJECTED' as const,
    nodes: [
      {
        id: 'profile-main',
        kind: 'resource-realization.acquisition-profile',
        value: { label: 'Profile' },
        references: [],
        edges: [],
      },
    ],
    sourceClaims: [
      {
        subject: 'node:profile-main#/id',
        documentPath: 'docs/ASSET_PLAN.md',
        sectionId: 'section-1',
        sourcePointer: '/bytes/0/1',
        literal: 'profile-main',
      },
      {
        subject: 'node:profile-main#/value/label',
        documentPath: 'docs/ASSET_PLAN.md',
        sectionId: 'section-1',
        sourcePointer: '/bytes/0/1',
        literal: 'Profile',
      },
    ],
  }
}

function projectedLogicalInput() {
  return {
    outcome: 'PROJECTED' as const,
    nodes: [
      {
        id: 'logical-main',
        kind: 'resource-realization.logical-resource',
        value: {
          requirementId: 'logical-main',
          resourceKind: 'texture',
          runtimeRole: 'background',
        },
        references: [],
        edges: [],
      },
    ],
    sourceClaims: [
      {
        subject: 'node:logical-main#/id',
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sourcePointer: '/bytes/0/1',
        literal: 'logical-main',
      },
      {
        subject: 'node:logical-main#/value/requirementId',
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sourcePointer: '/bytes/0/1',
        literal: 'logical-main',
      },
      {
        subject: 'node:logical-main#/value/resourceKind',
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sourcePointer: '/bytes/0/1',
        literal: 'texture',
      },
      {
        subject: 'node:logical-main#/value/runtimeRole',
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sourcePointer: '/bytes/0/1',
        literal: 'background',
      },
    ],
  }
}

function realResourceFixture() {
  const authority = realAuthority()
  const packet = prepareResourceRealizationSemanticProjectionPacket(authority)
  return { authority, packet }
}

function bindSourceEvidence<T extends { sourceClaims: readonly unknown[] }>(
  input: T,
  packet: ResourceRealizationSemanticProjectionPacket,
): T {
  const section = packet.sourceSections[0]!
  return {
    ...input,
    sourceClaims: input.sourceClaims.map(claim => ({
      ...(claim as Record<string, unknown>),
      documentPath: section.documentPath,
      sectionId: section.sectionId,
    })),
  }
}

describe('Resource Realization semantic producer', () => {
  test('rejects a detached or incomplete authority before building a packet', () => {
    expect(() =>
      prepareResourceRealizationSemanticProjectionPacket(
        {} as ResourceRealizationSemanticProjectionAuthority,
      ),
    ).toThrow(/authority|phase5|resource/i)
  })

  test('rebuilds real Phase 5 authority into a deterministic frozen descriptor packet', () => {
    const authority = realAuthority()
    const first = prepareResourceRealizationSemanticProjectionPacket(authority)
    const second = prepareResourceRealizationSemanticProjectionPacket(authority)
    expect(first).toEqual(second)
    expect(first.presentationRequirementsDigest).toBe(
      digestGameIrValue(first.presentationRequirements),
    )
    expect(first.presentationRequirements).toHaveLength(1)
    expect(first.presentationRequirements[0]).toMatchObject({
      requirementId: 'screen-main',
      kind: 'ui',
      runtimeRole: 'screen',
      ownerNodeId: 'presentation-screen-main',
      ownerNodeKind: 'presentation.ui-screen',
      requirementIdPointer: '/value/requirements/0/requirementId',
      kindPointer: '/value/requirements/0/kind',
      runtimeRolePointer: '/value/requirements/0/runtimeRole',
    })
    expect(
      first.presentationRequirements[0]?.evidence.requirementId.documentPath,
    ).toBe('docs/GDD.md')
    expect(first.presentationRequirements[0]?.evidence.kind.documentPath).toBe(
      'docs/GDD.md',
    )
    expect(
      first.presentationRequirements[0]?.evidence.runtimeRole.documentPath,
    ).toBe('docs/GDD.md')
    expect(first.allowedPriorNodeTargets.length).toBeGreaterThan(0)
    expect(first.allowedNodeKinds).toEqual(
      Object.keys(RESOURCE_REALIZATION_DOMAIN_MANIFEST).sort(),
    )
    expect(first.sourceSections.length).toBe(6)
    expect(first.forbiddenPresentationRequirementIds).toEqual(
      first.presentationRequirements.map(
        requirement => requirement.requirementId,
      ),
    )
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.presentationRequirements)).toBe(true)
    expect(Object.isFrozen(first.sourceSections)).toBe(true)
  })

  test('uses the shared strict admission and returns an immutable detached receipt', () => {
    const fixture = realResourceFixture()
    const input = bindSourceEvidence(projectedInput(), fixture.packet)
    const receipt = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      input,
    )
    expect(receipt.outcome).toBe('PROJECTED')
    if (receipt.outcome !== 'PROJECTED') return
    expect(receipt.packetDigest).toBe(fixture.packet.packetDigest)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.nodes[0])).toBe(true)
    expect(receipt.nodes[0]?.producerMode).toBe('semantic')
    expect(() => {
      ;(input.nodes[0]!.value as Record<string, unknown>).label = 'mutated'
    }).not.toThrow()
    expect(receipt.nodes[0]?.value.label).toBe('Profile')
  })

  test('replays a stored receipt through the exact outer packet and shared invariants', () => {
    const fixture = realResourceFixture()
    const input = bindSourceEvidence(projectedInput(), fixture.packet)
    const receipt = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      input,
    )
    expect(receipt.outcome).toBe('PROJECTED')
    if (receipt.outcome !== 'PROJECTED') return
    const replayed = replayResourceRealizationSemanticReceipt(
      fixture.authority,
      fixture.packet,
      receipt,
    )
    expect(replayed).toEqual(receipt)
    expect(Object.isFrozen(replayed)).toBe(true)

    expect(() =>
      replayResourceRealizationSemanticReceipt(
        fixture.authority,
        fixture.packet,
        { ...receipt, extra: true } as never,
      ),
    ).toThrow(/receipt|unknown|field/)
    expect(() =>
      replayResourceRealizationSemanticReceipt(
        fixture.authority,
        fixture.packet,
        { ...receipt, receiptDigest: 'e'.repeat(64) },
      ),
    ).toThrow(/receipt.*digest|stale|invalid/)
    expect(() =>
      replayResourceRealizationSemanticReceipt(
        fixture.authority,
        { ...fixture.packet, packetDigest: 'd'.repeat(64) },
        receipt,
      ),
    ).toThrow(/packet|authority|stale|detached/)
  })

  test('rejects missing or tampered Presentation leaf authority before projection', () => {
    const authority = realAuthority()
    const semantic = authority.phase5Authority.presentation.semantic
    const missingKindClaims = semantic.sourceClaims.filter(
      claim => !claim.subject.endsWith('/kind'),
    )
    const missingKindBody = {
      ...semantic,
      sourceClaims: missingKindClaims,
    }
    const missingKindAuthority = {
      ...authority,
      phase5Authority: {
        ...authority.phase5Authority,
        presentation: {
          ...authority.phase5Authority.presentation,
          semantic: {
            ...missingKindBody,
            receiptDigest: digestGameIrValue(missingKindBody),
          },
        },
      },
    }
    expect(() =>
      prepareResourceRealizationSemanticProjectionPacket(
        missingKindAuthority as never,
      ),
    ).toThrow(/claim|coverage|authority|semantic/i)

    const tamperedClaims = semantic.sourceClaims.map(claim =>
      claim.subject.endsWith('/runtimeRole')
        ? { ...claim, literal: 'tampered-runtime-role' }
        : claim,
    )
    const tamperedBody = { ...semantic, sourceClaims: tamperedClaims }
    const tamperedAuthority = {
      ...authority,
      phase5Authority: {
        ...authority.phase5Authority,
        presentation: {
          ...authority.phase5Authority.presentation,
          semantic: {
            ...tamperedBody,
            receiptDigest: digestGameIrValue(tamperedBody),
          },
        },
      },
    }
    expect(() =>
      prepareResourceRealizationSemanticProjectionPacket(
        tamperedAuthority as never,
      ),
    ).toThrow(/literal|claim|authority|semantic/i)
  })

  test('admits non-Presentation logical resources and rejects kinds or relationships outside the manifest', () => {
    const fixture = realResourceFixture()
    const logical = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      bindSourceEvidence(projectedLogicalInput(), fixture.packet),
    )
    expect(logical.outcome).toBe('PROJECTED')
    if (logical.outcome !== 'PROJECTED') return
    expect(logical.nodes[0]?.kind).toBe('resource-realization.logical-resource')

    expect(() =>
      admitResourceRealizationSemanticResult(
        fixture.authority,
        fixture.packet,
        {
          ...projectedLogicalInput(),
          nodes: [
            {
              ...projectedLogicalInput().nodes[0],
              kind: 'presentation.ui-screen',
            },
          ],
        },
      ),
    ).toThrow(/kind|semantic packet/)
    expect(() =>
      admitResourceRealizationSemanticResult(
        fixture.authority,
        fixture.packet,
        {
          ...projectedLogicalInput(),
          nodes: [
            {
              ...projectedLogicalInput().nodes[0],
              edges: [
                {
                  type: 'driven-by',
                  targetId: 'state-start',
                  targetType: 'gameplay.state',
                },
              ],
            },
          ],
        },
      ),
    ).toThrow(/relationship|edge|sourceClaims/)
  })

  test('accepts every worker-owned semantic relationship through the shared admission seam', () => {
    const fixture = realResourceFixture()
    const base = projectedInput()
    const inputWithEdge = (targetId: string, targetType: string) => {
      const edge = { type: 'describes', targetId, targetType }
      return {
        ...base,
        nodes: [{ ...base.nodes[0], edges: [edge] }],
        sourceClaims: [
          ...base.sourceClaims,
          {
            subject: 'node:profile-main#/edges/0',
            documentPath: section.documentPath,
            sectionId: section.sectionId,
            sourcePointer: '/bytes/0/1',
            literal: canonicalGameIrJson(edge),
          },
        ].sort((left, right) =>
          compareCodeUnits(
            `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
            `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
          ),
        ),
      }
    }
    const input = inputWithEdge('state-start', 'gameplay.state')
    const result = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      bindSourceEvidence(input, fixture.packet),
    )
    expect(result.outcome).toBe('PROJECTED')
    if (result.outcome !== 'PROJECTED') return
    expect(result.nodes[0]?.edges[0]?.type).toBe('describes')
    const local = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      bindSourceEvidence(
        inputWithEdge(
          'profile-main',
          'resource-realization.acquisition-profile',
        ),
        fixture.packet,
      ),
    )
    expect(local.outcome).toBe('PROJECTED')
    expect(() =>
      admitResourceRealizationSemanticResult(
        fixture.authority,
        fixture.packet,
        bindSourceEvidence(
          inputWithEdge('missing-node', 'gameplay.state'),
          fixture.packet,
        ),
      ),
    ).toThrow(/unknown node/)
    expect(() =>
      admitResourceRealizationSemanticResult(
        fixture.authority,
        fixture.packet,
        bindSourceEvidence(
          inputWithEdge('profile-main', 'gameplay.state'),
          fixture.packet,
        ),
      ),
    ).toThrow(/mismatched target type/)
  })

  test('allows typed profile and variant references to Presentation-derived logical descriptors', () => {
    const fixture = realResourceFixture()
    const profile = projectedInput().nodes[0]!
    const variant = {
      id: 'variant-main',
      kind: 'resource-realization.variant',
      value: { activation: { kind: 'always' } },
      references: [],
      edges: [
        {
          type: 'realizes',
          targetId: 'resource.requirement.screen-main',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    }
    const profileEdge = {
      type: 'describes',
      targetId: 'resource.requirement.screen-main',
      targetType: 'resource-realization.logical-resource',
    }
    const nodes = [{ ...profile, edges: [profileEdge] }, variant]
    const claim = (subject: string, literal: string) => ({
      subject,
      documentPath: section.documentPath,
      sectionId: section.sectionId,
      sourcePointer: '/bytes/0/1',
      literal,
    })
    const input = {
      outcome: 'PROJECTED' as const,
      nodes,
      sourceClaims: [
        claim('node:profile-main#/id', 'profile-main'),
        claim('node:profile-main#/value/label', 'Profile'),
        claim('node:profile-main#/edges/0', canonicalGameIrJson(profileEdge)),
        claim('node:variant-main#/id', 'variant-main'),
        claim('node:variant-main#/value/activation/kind', 'always'),
        claim(
          'node:variant-main#/edges/0',
          canonicalGameIrJson(variant.edges[0]),
        ),
      ].sort((left, right) =>
        compareCodeUnits(
          `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
          `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
        ),
      ),
    }
    const result = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      bindSourceEvidence(input, fixture.packet),
    )
    expect(result.outcome).toBe('PROJECTED')
    if (result.outcome !== 'PROJECTED') return
    expect(result.nodes).toHaveLength(2)
    expect(
      result.nodes.flatMap(node => node.edges).map(edge => edge.type),
    ).toEqual(['describes', 'realizes'])
    const replayed = replayResourceRealizationSemanticReceipt(
      fixture.authority,
      fixture.packet,
      result,
    )
    expect(replayed.nodes.flatMap(node => node.edges)).toEqual(
      result.nodes.flatMap(node => node.edges),
    )
  })

  test('rejects worker derived logical output, Presentation shadowing, and unknown semantic vocabulary', () => {
    const fixture = realResourceFixture()
    const logical = projectedLogicalInput()
    const cases = [
      {
        label: 'derived logical producer mode',
        value: {
          ...logical,
          nodes: [{ ...logical.nodes[0], producerMode: 'derived' }],
        },
        pattern: /unknown or missing fields/,
      },
      {
        label: 'Presentation requirement shadow',
        value: {
          ...logical,
          nodes: [
            {
              ...logical.nodes[0],
              id: 'resource.requirement.screen-main',
              value: {
                ...logical.nodes[0].value,
                requirementId: 'screen-main',
              },
            },
          ],
          sourceClaims: logical.sourceClaims.map(claim => ({
            ...claim,
            subject: claim.subject.replace(
              'logical-main',
              'resource.requirement.screen-main',
            ),
            literal: claim.subject.endsWith('#/id')
              ? 'resource.requirement.screen-main'
              : claim.subject.endsWith('#/value/requirementId')
                ? 'screen-main'
                : claim.literal,
          })),
        },
        pattern: /forbidden|shadow|overlap/,
      },
      {
        label: 'unknown semantic relationship',
        value: {
          ...logical,
          nodes: [
            {
              ...logical.nodes[0],
              edges: [
                {
                  type: 'rogue-relation',
                  targetId: 'logical-main',
                  targetType: 'resource-realization.logical-resource',
                },
              ],
            },
          ],
        },
        pattern: /relationship|semantic packet|sourceClaims/,
      },
      {
        label: 'unknown semantic kind',
        value: {
          ...logical,
          nodes: [{ ...logical.nodes[0], kind: 'rogue.kind' }],
        },
        pattern: /kind|semantic packet/,
      },
    ] as const
    for (const scenario of cases) {
      expect(() =>
        admitResourceRealizationSemanticResult(
          fixture.authority,
          fixture.packet,
          bindSourceEvidence(scenario.value, fixture.packet),
        ),
      ).toThrow(scenario.pattern)
    }
  })

  test('rejects Presentation-owned logical IDs and stale packet digests', () => {
    const fixture = realResourceFixture()
    const input = bindSourceEvidence(projectedInput(), fixture.packet)
    expect(() =>
      admitResourceRealizationSemanticResult(
        fixture.authority,
        fixture.packet,
        {
          ...input,
          nodes: [
            {
              ...input.nodes[0],
              id: 'resource.requirement.screen-main',
            },
          ],
          sourceClaims: input.sourceClaims.map(claim => ({
            ...claim,
            subject: claim.subject.replace(
              'profile-main',
              'resource.requirement.screen-main',
            ),
            literal: claim.subject.endsWith('#/id')
              ? 'resource.requirement.screen-main'
              : claim.literal,
          })),
        },
      ),
    ).toThrow(/forbidden|shadow|overlap/)
    expect(() =>
      admitResourceRealizationSemanticResult(
        fixture.authority,
        { ...fixture.packet, packetDigest: 'c'.repeat(64) },
        input,
      ),
    ).toThrow(/authority|stale|detached/)

    const logical = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      bindSourceEvidence(projectedLogicalInput(), fixture.packet),
    )
    expect(logical.outcome).toBe('PROJECTED')
    if (logical.outcome !== 'PROJECTED') return
    const recomputeReceipt = (
      nodes: typeof logical.nodes,
      sourceClaims: typeof logical.sourceClaims,
    ) => {
      const { receiptDigest: _receiptDigest, ...body } = logical
      const changed = { ...body, nodes, sourceClaims }
      return { ...changed, receiptDigest: digestGameIrValue(changed) }
    }
    const shadowId = 'resource.requirement.screen-main'
    const idShadow = recomputeReceipt(
      logical.nodes.map(node => ({ ...node, id: shadowId })),
      logical.sourceClaims.map(claim => ({
        ...claim,
        subject: claim.subject.replace('logical-main', shadowId),
        literal: claim.subject.endsWith('#/id') ? shadowId : claim.literal,
      })),
    )
    expect(() =>
      replayResourceRealizationSemanticReceipt(
        fixture.authority,
        fixture.packet,
        idShadow,
      ),
    ).toThrow(/forbidden|shadow|overlap/)

    const requirementShadow = recomputeReceipt(
      logical.nodes.map(node => ({
        ...node,
        value: { ...node.value, requirementId: 'screen-main' },
      })),
      logical.sourceClaims.map(claim => ({
        ...claim,
        literal: claim.subject.endsWith('#/value/requirementId')
          ? 'screen-main'
          : claim.literal,
      })),
    )
    expect(() =>
      replayResourceRealizationSemanticReceipt(
        fixture.authority,
        fixture.packet,
        requirementShadow,
      ),
    ).toThrow(/forbidden|shadow|overlap/)
  })

  test('binds structured diagnostics to the fixed source evidence closure', () => {
    const fixture = realResourceFixture()
    const evidenceSection = fixture.packet.sourceSections[0]!
    const evidence = `section:${evidenceSection.documentPath}#${evidenceSection.sectionId}@${evidenceSection.digest}`
    const diagnostic = admitResourceRealizationSemanticResult(
      fixture.authority,
      fixture.packet,
      {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        actual: 'No resource profile was projected',
        missingSubject: 'node:profile-main#/id',
        expectedProjection: 'an acquisition profile',
        evidencePointers: [evidence],
      },
    )
    expect(diagnostic.outcome).toBe('FAIL')
    expect(Object.isFrozen(diagnostic)).toBe(true)
  })

  test('rejects authority, mechanical, descriptor, and diagnostic mutations', () => {
    const authority = realAuthority()
    expect(() =>
      prepareResourceRealizationSemanticProjectionPacket({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          source: {
            ...authority.resourceRealization.source,
            taskId: 'other-task',
          },
        },
      }),
    ).toThrow(/source|identity|task/i)
    expect(() =>
      prepareResourceRealizationSemanticProjectionPacket({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          callerTargets: [],
        } as never,
      }),
    ).toThrow(/unknown|missing|authority/i)
    expect(() =>
      prepareResourceRealizationSemanticProjectionPacket({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          mechanical: {
            ...authority.resourceRealization.mechanical,
            nodes: [{}] as never,
          },
        },
      }),
    ).toThrow(/mechanical|digest/i)

    const prepared =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const { packetDigest: _packetDigest, ...packetBody } = prepared
    expect(() =>
      admitResourceRealizationSemanticResult(
        authority,
        {
          ...packetBody,
          allowedNodeKinds: [...prepared.allowedNodeKinds, 'rogue.kind'],
          packetDigest: digestGameIrValue({
            ...packetBody,
            allowedNodeKinds: [...prepared.allowedNodeKinds, 'rogue.kind'],
          }),
        },
        bindSourceEvidence(projectedInput(), prepared),
      ),
    ).toThrow(/stale|detached|authority/i)
    const evidence = `section:${prepared.sourceSections[0]!.documentPath}#${prepared.sourceSections[0]!.sectionId}@${prepared.sourceSections[0]!.digest}`
    const ambiguous = admitResourceRealizationSemanticResult(
      authority,
      prepared,
      {
        outcome: 'AMBIGUOUS',
        reasonCode: 'ambiguous-projection',
        actual: 'two candidates',
        missingSubject: 'node:profile-main#/id',
        expectedProjection: 'one profile',
        evidencePointers: [evidence],
      },
    )
    expect(ambiguous.outcome).toBe('AMBIGUOUS')
    expect(() =>
      admitResourceRealizationSemanticResult(authority, prepared, {
        outcome: 'AMBIGUOUS',
        reasonCode: 'ambiguous-projection',
        actual: 'two candidates',
        missingSubject: 'node:profile-main#/id',
        expectedProjection: 'one profile',
        evidencePointers: ['outside:authority'],
      }),
    ).toThrow(/evidence|closure/i)
  })

  test('rejects Phase 5 identity or validation tamper and every caller-owned authority extension', () => {
    const authority = realAuthority()
    const cases = [
      {
        label: 'Phase 5 validation digest tamper',
        value: {
          ...authority,
          phase5Authority: {
            ...authority.phase5Authority,
            presentation: {
              ...authority.phase5Authority.presentation,
              validation: {
                ...authority.phase5Authority.presentation.validation,
                packetDigest: 'd'.repeat(64),
              },
            },
          },
        },
        pattern: /validation|digest|authority/i,
      },
      {
        label: 'caller target catalog',
        value: {
          ...authority,
          resourceRealization: {
            ...authority.resourceRealization,
            callerTargets: [],
          },
        },
        pattern: /unknown|missing|authority/i,
      },
      {
        label: 'caller forbidden target catalog',
        value: {
          ...authority,
          resourceRealization: {
            ...authority.resourceRealization,
            forbiddenTargets: [],
          },
        },
        pattern: /unknown|missing|authority/i,
      },
    ] as const
    for (const scenario of cases) {
      expect(() =>
        prepareResourceRealizationSemanticProjectionPacket(
          scenario.value as never,
        ),
      ).toThrow(scenario.pattern)
    }
  })

  test('rejects recomputed descriptor, catalog, forbidden, source, and manifest packet mutations', () => {
    const authority = realAuthority()
    const prepared =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const recompute = (
      changes: Partial<ResourceRealizationSemanticProjectionPacket>,
    ): ResourceRealizationSemanticProjectionPacket => {
      const { packetDigest: _packetDigest, ...body } = prepared
      const next = { ...body, ...changes }
      return { ...next, packetDigest: digestGameIrValue(next) }
    }
    const cases = [
      {
        label: 'full-recomputed descriptor substitution',
        packet: recompute({
          presentationRequirements: prepared.presentationRequirements.map(
            requirement => ({ ...requirement, kind: 'tampered' }),
          ),
          presentationRequirementsDigest: digestGameIrValue(
            prepared.presentationRequirements.map(requirement => ({
              ...requirement,
              kind: 'tampered',
            })),
          ),
        }),
        pattern: /stale|detached|authority/,
      },
      {
        label: 'full-recomputed unique prior catalog substitution',
        packet: recompute({
          allowedPriorNodeTargets: prepared.allowedPriorNodeTargets
            .map((target, index) =>
              index === 0 ? { ...target, id: 'rogue-prior-target' } : target,
            )
            .sort((left, right) => compareCodeUnits(left.id, right.id)),
        }),
        pattern: /stale|detached|authority/,
      },
      {
        label: 'forbidden target mismatch',
        packet: recompute({
          forbiddenTargets: [...prepared.forbiddenTargets, 'rogue-target'].sort(
            compareCodeUnits,
          ),
        }),
        pattern: /stale|detached|authority/,
      },
      {
        label: 'full-recomputed canonical source substitution',
        packet: recompute({
          sourceSections: prepared.sourceSections.map((section, index) =>
            index === 0
              ? { ...section, sectionId: 'replacement-section' }
              : section,
          ),
        }),
        pattern: /stale|detached|authority/,
      },
      {
        label: 'relationship manifest mutation',
        packet: recompute({
          allowedRelationshipTypes: [
            ...prepared.allowedRelationshipTypes,
            'rogue-relation',
          ].sort(compareCodeUnits),
        }),
        pattern: /stale|detached|authority/,
      },
    ] as const
    for (const scenario of cases) {
      expect(() =>
        admitResourceRealizationSemanticResult(
          authority,
          scenario.packet,
          bindSourceEvidence(projectedInput(), prepared),
        ),
      ).toThrow(scenario.pattern)
    }

    const evidence = `section:${prepared.sourceSections[0]!.documentPath}#${prepared.sourceSections[0]!.sectionId}@${prepared.sourceSections[0]!.digest}`
    for (const outcome of ['FAIL', 'AMBIGUOUS'] as const) {
      const diagnostic = admitResourceRealizationSemanticResult(
        authority,
        prepared,
        {
          outcome,
          reasonCode:
            outcome === 'FAIL' ? 'missing-projection' : 'ambiguous-projection',
          actual: 'projection diagnostic',
          missingSubject: 'node:profile-main#/id',
          expectedProjection: 'one profile',
          evidencePointers: [evidence],
        },
      )
      expect(diagnostic.packetDigest).toBe(prepared.packetDigest)
    }
    expect(() =>
      admitResourceRealizationSemanticResult(authority, prepared, {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        actual: 'projection diagnostic',
        missingSubject: 'node:profile-main#/id',
        expectedProjection: 'one profile',
        evidencePointers: ['outside:authority'],
      }),
    ).toThrow(/evidence|closure/)
  })
})
