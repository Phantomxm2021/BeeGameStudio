import { describe, expect, test } from 'bun:test'
import { compareCodeUnits, digestGameIrValue } from './model'
import { realAuthority } from './resource-realization-test-helpers'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import {
  buildGameplayProjectionOperationPacket,
  normalizeGameplayProjectionOperationPacket,
} from './gameplay-producer'
import {
  buildBalanceProjectionOperationPacket,
  normalizeBalanceProjectionOperationPacket,
} from './balance-producer'
import {
  admitGameplaySemanticResult,
  buildGameplaySemanticPacket,
  type GameIrDomainSemanticReceipt as GameplaySemanticReceipt,
} from './gameplay-producer'
import {
  buildWorldSceneProjectionOperationPacket,
  normalizeWorldSceneProjectionOperationPacket,
} from './world-scene-producer'
import {
  buildPresentationProjectionOperationPacket,
  normalizePresentationProjectionOperationPacket,
} from './world-presentation-assembler'
import {
  buildImplementationVerificationProjectionOperationPacket,
  normalizeImplementationVerificationProjectionOperationPacket,
} from './implementation-verification-assembler'
import {
  buildResourceRealizationProjectionOperationPacket,
  normalizeResourceRealizationProjectionOperationPacket,
} from './resource-realization-producer'

function authorities() {
  const resource = realAuthority()
  const phase4 = resource.phase5Authority.phase4Authority
  const world = resource.phase5Authority.worldScene
  const presentation = resource.phase5Authority.presentation
  return { resource, phase4, world, presentation }
}

function detachedSource(
  source: ReturnType<
    typeof realAuthority
  >['phase5Authority']['worldScene']['source'],
) {
  const taskId = `${source.taskId}-detached`
  const { sourceDigest: _sourceDigest, ...sourceBody } = source
  const body = {
    ...sourceBody,
    taskId,
    compileRequest: { ...source.compileRequest, taskId },
  }
  return { ...body, sourceDigest: digestGameIrValue(body) }
}

function resignSemanticPacket(packet: {
  semanticPacket: Record<string, unknown>
  packetDigest: string
}) {
  const { packetDigest: _semanticPacketDigest, ...semanticWithoutDigest } =
    packet.semanticPacket
  const semanticBody = {
    ...semanticWithoutDigest,
    forbiddenTargets: ['forged-target'],
  }
  const semanticPacket = {
    ...semanticBody,
    packetDigest: digestGameIrValue(semanticBody),
  }
  const { packetDigest: _packetDigest, ...packetWithoutDigest } = packet
  const packetBody = { ...packetWithoutDigest, semanticPacket }
  return { ...packetBody, packetDigest: digestGameIrValue(packetBody) }
}

describe('domain-owned projection operation packets', () => {
  test('Gameplay packet carries the real source envelope and semantic packet', () => {
    const { phase4 } = authorities()
    const packet = buildGameplayProjectionOperationPacket({
      source: phase4.gameplay.source,
      mechanical: phase4.gameplay.mechanical,
    })
    expect(packet.source.sectionBytes).toBeDefined()
    expect(packet.semanticPacket.moduleId).toBe('gameplay')
    expect(normalizeGameplayProjectionOperationPacket(packet)).toEqual(packet)
  })

  test('Balance packet derives exact Gameplay targets and outbound Balance requirements', () => {
    const { phase4 } = authorities()
    const packet = buildBalanceProjectionOperationPacket({
      source: phase4.balance.source,
      mechanical: phase4.balance.mechanical,
      gameplay: phase4.gameplay,
    })
    expect(packet.dependencies.gameplayTargets).toEqual(
      phase4.gameplay.semantic.nodes.map(node => ({
        id: node.id,
        kind: node.kind,
      })),
    )
    expect(packet.dependencies.requiredBalanceTargets).toEqual([])
    expect(
      normalizeBalanceProjectionOperationPacket(packet, phase4.gameplay),
    ).toEqual(packet)
  })

  test('Balance packet records admitted Gameplay references to Balance targets', () => {
    const { phase4 } = authorities()
    const gameplayPacket = buildGameplaySemanticPacket({
      source: phase4.gameplay.source,
      mechanical: phase4.gameplay.mechanical,
    })
    const gameplayNode = phase4.gameplay.semantic.nodes[0]!
    const { producerMode: _producerMode, ...rawGameplayNode } = gameplayNode
    const sourceBytes =
      phase4.gameplay.source.sectionBytes['docs/GDD.md#section-0']!
    const literal = 'balance-unit'
    const offset = sourceBytes.indexOf(literal)
    expect(offset).toBeGreaterThanOrEqual(0)
    const crossDomainClaim = {
      subject: 'node:state-start#/references/0',
      documentPath: 'docs/GDD.md' as const,
      sectionId: 'section-0',
      sourcePointer: `/bytes/${Buffer.byteLength(sourceBytes.slice(0, offset), 'utf8')}/${Buffer.byteLength(sourceBytes.slice(0, offset + literal.length), 'utf8')}`,
      literal,
    }
    const gameplaySemantic = admitGameplaySemanticResult(gameplayPacket, {
      outcome: 'PROJECTED',
      nodes: [
        {
          ...rawGameplayNode,
          references: [
            { targetId: 'balance-unit', targetType: 'balance.unit' },
          ],
        },
      ],
      sourceClaims: [
        ...phase4.gameplay.semantic.sourceClaims,
        crossDomainClaim,
      ].sort((left, right) =>
        compareCodeUnits(
          `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
          `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
        ),
      ),
    }) as GameplaySemanticReceipt
    const packet = buildBalanceProjectionOperationPacket({
      source: phase4.balance.source,
      mechanical: phase4.balance.mechanical,
      gameplay: {
        ...phase4.gameplay,
        semantic: gameplaySemantic,
      },
    })
    expect(packet.dependencies.requiredBalanceTargets).toEqual([
      { id: 'balance-unit', kind: 'balance.unit' },
    ])
    expect(
      normalizeBalanceProjectionOperationPacket(packet, {
        ...phase4.gameplay,
        semantic: gameplaySemantic,
      }),
    ).toEqual(packet)
  })

  test('Balance replay rejects a re-signed Gameplay receipt with forged source evidence', () => {
    const { phase4 } = authorities()
    const gameplayPacket = buildGameplaySemanticPacket({
      source: phase4.gameplay.source,
      mechanical: phase4.gameplay.mechanical,
    })
    const forgedGameplay = admitGameplaySemanticResult(gameplayPacket, {
      outcome: 'PROJECTED',
      nodes: phase4.gameplay.semantic.nodes.map(
        ({ producerMode: _producerMode, ...node }) => node,
      ),
      sourceClaims: phase4.gameplay.semantic.sourceClaims.map((claim, index) =>
        index === 0 ? { ...claim, literal: `${claim.literal}-forged` } : claim,
      ),
    }) as GameplaySemanticReceipt

    expect(() =>
      buildBalanceProjectionOperationPacket({
        source: phase4.balance.source,
        mechanical: phase4.balance.mechanical,
        gameplay: { ...phase4.gameplay, semantic: forgedGameplay },
      }),
    ).toThrow(/source|bytes|literal|authority/i)

    const packet = buildBalanceProjectionOperationPacket({
      source: phase4.balance.source,
      mechanical: phase4.balance.mechanical,
      gameplay: phase4.gameplay,
    })
    const forgedBody = {
      ...packet,
      dependencies: {
        ...packet.dependencies,
        gameplayCandidateReceiptDigest: forgedGameplay.receiptDigest,
      },
    }
    const { packetDigest: _packetDigest, ...forgedPacketBody } = forgedBody
    const forgedPacket = {
      ...forgedPacketBody,
      packetDigest: digestGameIrValue(forgedPacketBody),
    }
    expect(() =>
      normalizeBalanceProjectionOperationPacket(forgedPacket, {
        ...phase4.gameplay,
        semantic: forgedGameplay,
      }),
    ).toThrow(/source|bytes|literal|authority/i)
  })

  test('World and Presentation packets expose only schema-allowed prior targets', () => {
    const { phase4, world } = authorities()
    const worldPacket = buildWorldSceneProjectionOperationPacket({
      source: world.source,
      mechanical: world.mechanical,
      phase4Authority: phase4,
    })
    expect(worldPacket.dependencies.phase4ClosureDigest).toBeTruthy()
    expect(
      worldPacket.dependencies.priorTargets.every(target =>
        target.kind.startsWith('gameplay.'),
      ),
    ).toBe(true)
    expect(
      normalizeWorldSceneProjectionOperationPacket(worldPacket, phase4),
    ).toEqual(worldPacket)

    const presentation = authorities().presentation
    const presentationPacket = buildPresentationProjectionOperationPacket({
      source: presentation.source,
      mechanical: presentation.mechanical,
      phase4Authority: phase4,
      worldScene: world,
    })
    expect(presentationPacket.dependencies.phase4ClosureDigest).toBeTruthy()
    expect(Object.keys(presentationPacket.dependencies)).toEqual([
      'phase4ClosureDigest',
      'worldSceneProjectionDigest',
      'priorTargets',
    ])
    expect(presentationPacket).not.toHaveProperty('worldScene')
    expect(
      normalizePresentationProjectionOperationPacket(presentationPacket, {
        phase4Authority: phase4,
        worldScene: world,
      }),
    ).toEqual(presentationPacket)
  })

  test('normalizers reject unknown fields and stale packet digests', () => {
    const { phase4 } = authorities()
    const packet = buildGameplayProjectionOperationPacket({
      source: phase4.gameplay.source,
      mechanical: phase4.gameplay.mechanical,
    })
    expect(() =>
      normalizeGameplayProjectionOperationPacket({ ...packet, extra: true }),
    ).toThrow(/unknown|missing|field/i)
    expect(() =>
      normalizeGameplayProjectionOperationPacket({
        ...packet,
        packetDigest: 'a'.repeat(64),
      }),
    ).toThrow(/stale|digest/i)
  })

  test('dependent normalizers reject a re-signed semantic packet detached from the phase authority', () => {
    const { phase4 } = authorities()
    const packet = buildBalanceProjectionOperationPacket({
      source: phase4.balance.source,
      mechanical: phase4.balance.mechanical,
      gameplay: phase4.gameplay,
    })
    const { packetDigest: _semanticPacketDigest, ...semanticWithoutDigest } =
      packet.semanticPacket
    const semanticBody = {
      ...semanticWithoutDigest,
      forbiddenTargets: ['forged-target'],
    }
    const forgedSemanticPacket = {
      ...semanticBody,
      packetDigest: digestGameIrValue(semanticBody),
    }
    const { packetDigest: _packetDigest, ...packetWithoutDigest } = packet
    const packetBody = {
      ...packetWithoutDigest,
      semanticPacket: forgedSemanticPacket,
    }
    const forgedPacket = {
      ...packetBody,
      packetDigest: digestGameIrValue(packetBody),
    }
    expect(() =>
      normalizeBalanceProjectionOperationPacket(forgedPacket, phase4.gameplay),
    ).toThrow(/semantic packet|authority|stale|detached/i)

    const { world, presentation } = authorities()
    const worldPacket = buildWorldSceneProjectionOperationPacket({
      source: world.source,
      mechanical: world.mechanical,
      phase4Authority: phase4,
    })
    const worldForged = resignSemanticPacket(worldPacket)
    expect(() =>
      normalizeWorldSceneProjectionOperationPacket(worldForged, phase4),
    ).toThrow(/semantic packet|authority|stale|detached/i)

    const presentationPacket = buildPresentationProjectionOperationPacket({
      source: presentation.source,
      mechanical: presentation.mechanical,
      phase4Authority: phase4,
      worldScene: world,
    })
    const presentationForged = resignSemanticPacket(presentationPacket)
    expect(() =>
      normalizePresentationProjectionOperationPacket(presentationForged, {
        phase4Authority: phase4,
        worldScene: world,
      }),
    ).toThrow(/semantic packet|authority|stale|detached/i)

    const fixture = implementationVerificationFixture()
    const implementationPacket =
      buildImplementationVerificationProjectionOperationPacket({
        phase6Authority: fixture.phase6Authority,
        source: fixture.authority.source,
        mechanical: fixture.authority.mechanical,
      })
    const implementationForged = resignSemanticPacket(implementationPacket)
    expect(() =>
      normalizeImplementationVerificationProjectionOperationPacket(
        implementationForged,
        fixture.phase6Authority,
      ),
    ).toThrow(/semantic packet|authority|stale|detached/i)
  })

  test('owner dependency parsers reject missing, unsorted, duplicate, and conflicting targets', () => {
    const { phase4 } = authorities()
    const packet = buildBalanceProjectionOperationPacket({
      source: phase4.balance.source,
      mechanical: phase4.balance.mechanical,
      gameplay: phase4.gameplay,
    })
    expect(() =>
      normalizeBalanceProjectionOperationPacket(
        {
          ...packet,
          dependencies: {},
        },
        phase4.gameplay,
      ),
    ).toThrow(/missing|unknown|field/i)
    const targets = packet.dependencies.gameplayTargets
    expect(() =>
      normalizeBalanceProjectionOperationPacket(
        {
          ...packet,
          dependencies: {
            ...packet.dependencies,
            gameplayTargets: [
              { id: 'state-z', kind: 'gameplay.state' },
              { id: 'state-a', kind: 'gameplay.state' },
            ],
          },
        },
        phase4.gameplay,
      ),
    ).toThrow(/sorted|duplicate|conflicting/i)
    expect(() =>
      normalizeBalanceProjectionOperationPacket(
        {
          ...packet,
          dependencies: {
            ...packet.dependencies,
            gameplayTargets: [...targets, targets[0]!].sort((left, right) =>
              `${left.id}\0${left.kind}`.localeCompare(
                `${right.id}\0${right.kind}`,
              ),
            ),
          },
        },
        phase4.gameplay,
      ),
    ).toThrow(/duplicate|conflicting|sorted/i)
    expect(() =>
      normalizeBalanceProjectionOperationPacket(
        {
          ...packet,
          dependencies: {
            ...packet.dependencies,
            gameplayTargets: [
              ...targets,
              { id: targets[0]!.id, kind: 'gameplay.other' },
            ].sort((left, right) =>
              `${left.id}\0${left.kind}`.localeCompare(
                `${right.id}\0${right.kind}`,
              ),
            ),
          },
        },
        phase4.gameplay,
      ),
    ).toThrow(/duplicate|conflicting|sorted/i)
  })

  test('transport rejects relabeled source, authority mismatch, and exposes deterministic frozen packets', () => {
    const authority = realAuthority()
    const packet = buildResourceRealizationProjectionOperationPacket(authority)
    expect(Object.isFrozen(packet)).toBe(true)
    expect(Object.isFrozen(packet.dependencies)).toBe(true)
    expect(
      buildResourceRealizationProjectionOperationPacket(authority),
    ).toEqual(packet)
    expect(() =>
      normalizeGameplayProjectionOperationPacket({
        ...buildGameplayProjectionOperationPacket({
          source: authority.phase5Authority.phase4Authority.gameplay.source,
          mechanical:
            authority.phase5Authority.phase4Authority.gameplay.mechanical,
        }),
        source: {
          ...authority.phase5Authority.phase4Authority.gameplay.source,
          moduleId: 'balance',
        },
      }),
    ).toThrow(/relabel|module|closure|invalid/i)
    const changedAuthority = realAuthority({
      presentationRequirements: [
        { requirementId: 'screen-other', kind: 'ui', runtimeRole: 'screen' },
      ],
    })
    expect(() =>
      normalizeResourceRealizationProjectionOperationPacket(
        packet,
        changedAuthority,
      ),
    ).toThrow(/stale|detached|digest/i)
  })

  test('Resource reuses its exact owner packet inside a source-bearing envelope', () => {
    const authority = realAuthority()
    const packet = buildResourceRealizationProjectionOperationPacket(authority)
    expect(packet.source.sectionBytes).toBeDefined()
    expect(packet.semanticPacket.allowedPriorNodeTargets).toBeDefined()
    expect(
      normalizeResourceRealizationProjectionOperationPacket(packet, authority),
    ).toEqual(packet)
  })

  test('Implementation/Verification binds replayed Phase 6 closure targets', () => {
    const fixture = implementationVerificationFixture()
    const packet = buildImplementationVerificationProjectionOperationPacket({
      phase6Authority: fixture.phase6Authority,
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
    })
    expect(packet.dependencies.phase6ClosureDigest).toBeTruthy()
    expect(
      normalizeImplementationVerificationProjectionOperationPacket(
        packet,
        fixture.phase6Authority,
      ),
    ).toEqual(packet)
  })

  test('dependent normalizers reject re-signed dependency tampering', () => {
    const { phase4, world, presentation } = authorities()
    const balance = buildBalanceProjectionOperationPacket({
      source: phase4.balance.source,
      mechanical: phase4.balance.mechanical,
      gameplay: phase4.gameplay,
    })
    const balanceTamperedBody = {
      ...balance,
      dependencies: {
        ...balance.dependencies,
        gameplayTargets: balance.dependencies.gameplayTargets.map(target => ({
          ...target,
          kind: 'gameplay.detached',
        })),
      },
    }
    const balanceTampered = {
      ...balanceTamperedBody,
      packetDigest: digestGameIrValue(balanceTamperedBody),
    }
    expect(() =>
      normalizeBalanceProjectionOperationPacket(
        balanceTampered,
        phase4.gameplay,
      ),
    ).toThrow(/authority|dependency|stale|detached/i)

    const worldPacket = buildWorldSceneProjectionOperationPacket({
      source: world.source,
      mechanical: world.mechanical,
      phase4Authority: phase4,
    })
    const worldTamperedBody = {
      ...worldPacket,
      dependencies: {
        ...worldPacket.dependencies,
        phase4ClosureDigest: 'f'.repeat(64),
      },
    }
    const worldTampered = {
      ...worldTamperedBody,
      packetDigest: digestGameIrValue(worldTamperedBody),
    }
    expect(() =>
      normalizeWorldSceneProjectionOperationPacket(worldTampered, phase4),
    ).toThrow(/authority|dependency|stale|detached/i)

    const presentationPacket = buildPresentationProjectionOperationPacket({
      source: presentation.source,
      mechanical: presentation.mechanical,
      phase4Authority: phase4,
      worldScene: world,
    })
    const presentationTamperedBody = {
      ...presentationPacket,
      dependencies: {
        ...presentationPacket.dependencies,
        worldSceneProjectionDigest: 'f'.repeat(64),
      },
    }
    const presentationTampered = {
      ...presentationTamperedBody,
      packetDigest: digestGameIrValue(presentationTamperedBody),
    }
    expect(() =>
      normalizePresentationProjectionOperationPacket(presentationTampered, {
        phase4Authority: phase4,
        worldScene: world,
      }),
    ).toThrow(/authority|dependency|stale|detached/i)

    const fixture = implementationVerificationFixture()
    const ivPacket = buildImplementationVerificationProjectionOperationPacket({
      phase6Authority: fixture.phase6Authority,
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
    })
    const ivTamperedBody = {
      ...ivPacket,
      dependencies: {
        ...ivPacket.dependencies,
        phase6ClosureDigest: 'f'.repeat(64),
      },
    }
    const ivTampered = {
      ...ivTamperedBody,
      packetDigest: digestGameIrValue(ivTamperedBody),
    }
    expect(() =>
      normalizeImplementationVerificationProjectionOperationPacket(
        ivTampered,
        fixture.phase6Authority,
      ),
    ).toThrow(/authority|dependency|stale|detached/i)
  })

  test('builders reject detached owner source identity', () => {
    const { phase4, world, presentation } = authorities()
    expect(() =>
      buildWorldSceneProjectionOperationPacket({
        source: detachedSource(world.source),
        mechanical: world.mechanical,
        phase4Authority: phase4,
      }),
    ).toThrow(/detached|authority|identity|source|digest|stale/i)
    expect(() =>
      buildPresentationProjectionOperationPacket({
        source: detachedSource(presentation.source),
        mechanical: presentation.mechanical,
        phase4Authority: phase4,
        worldScene: world,
      }),
    ).toThrow(/detached|authority|identity|source|digest|stale/i)

    const fixture = implementationVerificationFixture()
    expect(() =>
      buildImplementationVerificationProjectionOperationPacket({
        phase6Authority: fixture.phase6Authority,
        source: detachedSource(fixture.authority.source),
        mechanical: fixture.authority.mechanical,
      }),
    ).toThrow(/detached|authority|identity|source|digest|stale/i)
  })
})
