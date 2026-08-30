import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitGameIrMechanicalProjectionReceipt,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  admitGameplaySemanticResult,
  assembleGameplayModule,
  buildGameplaySemanticPacket,
  type GameIrDomainSemanticReceipt,
} from './gameplay-producer'
import {
  digestGameIrValue,
  compareCodeUnits,
  type GameIrNode,
  type GameIrSourceSection,
} from './model'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
} from '../foundation-section-index'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../../__tests__/delivery-workflow-test-helpers'

const sectionBytes = '# Gameplay\n\nThe player wins.'
const sectionDigest = createHash('sha256').update(sectionBytes).digest('hex')

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function source(): GameIrDomainSourceEnvelope {
  const fullIndex: GameIrSourceSection[] = CANONICAL_FOUNDATION_DOCUMENTS.map(
    (documentPath, index) => ({
      documentPath,
      sectionId:
        documentPath === 'docs/GDD.md' ? 'gameplay' : `section-${index}`,
      heading: documentPath === 'docs/GDD.md' ? 'Gameplay' : `Section ${index}`,
      startLine: 1,
      endLine: documentPath === 'docs/GDD.md' ? 3 : 1,
      digest:
        documentPath === 'docs/GDD.md'
          ? sectionDigest
          : createHash('sha256').update(`# ${documentPath}`).digest('hex'),
    }),
  )
  const foundationBody: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: 'a'.repeat(64),
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'a'.repeat(64)]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(fullIndex),
    authority: {
      kind: 'review',
      reviewDigest: 'a'.repeat(64),
      issueRegistryDigest: 'a'.repeat(64),
    },
  }
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'gameplay-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundationBody,
      receiptDigest: createHash('sha256')
        .update(canonical(foundationBody))
        .digest('hex'),
    },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'gameplay',
    request,
    sectionIndex: fullIndex,
    sectionBytes: { 'docs/GDD.md#gameplay': sectionBytes },
  })
}

function mechanical(
  currentSource: GameIrDomainSourceEnvelope = source(),
): GameIrMechanicalProjectionReceipt {
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: currentSource.taskId,
    moduleId: currentSource.moduleId,
    foundationRevision:
      currentSource.compileRequest.foundation.foundationRevision,
    sourceDigest: currentSource.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
  }
  return admitGameIrMechanicalProjectionReceipt(currentSource, {
    ...body,
    receiptDigest: digestGameIrValue(body),
  })
}

function mechanicalWithNode(
  currentSource: GameIrDomainSourceEnvelope,
  id = 'mechanical.entity',
): GameIrMechanicalProjectionReceipt {
  const section = currentSource.sectionIndex[0]!
  const node = {
    id,
    kind: 'gameplay.entity',
    producerMode: 'mechanical' as const,
    value: { label: 'Mechanical' },
    references: [],
    edges: [],
    bindings: {
      '/id': {
        kind: 'owner' as const,
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sectionDigest: section.digest,
        sourcePointer: `/mechanical/${id}`,
      },
      '/value/label': {
        kind: 'owner' as const,
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sectionDigest: section.digest,
        sourcePointer: `/mechanical/${id}/label`,
      },
    },
  } as const
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: currentSource.taskId,
    moduleId: currentSource.moduleId,
    foundationRevision:
      currentSource.compileRequest.foundation.foundationRevision,
    sourceDigest: currentSource.sourceDigest,
    nodes: [node],
    verifiedClaims: [],
    ownedTargets: [`node:${id}#/id`, `node:${id}#/value/label`],
  }
  return admitGameIrMechanicalProjectionReceipt(currentSource, {
    ...body,
    receiptDigest: digestGameIrValue(body),
  })
}

type SemanticNode = {
  id: string
  kind: string
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
}

function gameplayNodes(): SemanticNode[] {
  return [
    {
      id: 'entity.player',
      kind: 'gameplay.entity',
      value: { label: 'Player' },
      references: [],
      edges: [],
    },
    {
      id: 'objective.finish',
      kind: 'gameplay.objective',
      value: { label: 'Finish' },
      references: [],
      edges: [
        {
          type: 'succeeds-with',
          targetId: 'outcome.win',
          targetType: 'gameplay.outcome',
        },
      ],
    },
    {
      id: 'outcome.win',
      kind: 'gameplay.outcome',
      value: { label: 'Win', result: 'win' },
      references: [],
      edges: [],
    },
    {
      id: 'state.start',
      kind: 'gameplay.state',
      value: { label: 'Start', initial: true, terminal: 'none' },
      references: [],
      edges: [],
    },
    {
      id: 'state.win',
      kind: 'gameplay.state',
      value: { label: 'Won', initial: false, terminal: 'success' },
      references: [],
      edges: [],
    },
    {
      id: 'transition.finish',
      kind: 'gameplay.transition',
      value: { label: 'Finish' },
      references: [],
      edges: [
        { type: 'from', targetId: 'state.start', targetType: 'gameplay.state' },
        { type: 'to', targetId: 'state.win', targetType: 'gameplay.state' },
      ],
    },
  ]
}

function sourceClaims(nodes: readonly SemanticNode[], sectionId = 'gameplay') {
  const claims: Array<Record<string, string>> = []
  for (const node of nodes) {
    claims.push({
      subject: `node:${node.id}#/id`,
      documentPath: 'docs/GDD.md',
      sectionId,
      sourcePointer: `/gameplay/${node.id}`,
      literal: node.id,
    })
    for (const key of Object.keys(node.value))
      claims.push({
        subject: `node:${node.id}#/value/${key}`,
        documentPath: 'docs/GDD.md',
        sectionId,
        sourcePointer: `/gameplay/${node.id}/${key}`,
        literal: String(node.value[key]),
      })
    for (let index = 0; index < node.edges.length; index += 1)
      claims.push({
        subject: `node:${node.id}#/edges/${index}`,
        documentPath: 'docs/GDD.md',
        sectionId,
        sourcePointer: `/gameplay/${node.id}/edges/${index}`,
        literal: node.edges[index]!.targetId,
      })
  }
  return claims.sort((left, right) =>
    compareCodeUnits(
      `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
      `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
    ),
  )
}

function packetFor(currentSource: GameIrDomainSourceEnvelope) {
  return buildGameplaySemanticPacket({
    source: currentSource,
    mechanical: mechanical(currentSource),
  })
}

function packet() {
  return packetFor(source())
}

function resultValue(
  overrides: Record<string, unknown> = {},
  sectionId = 'gameplay',
) {
  const nodes = gameplayNodes()
  return {
    nodes,
    sourceClaims: sourceClaims(nodes, sectionId),
    ...overrides,
  }
}

function admittedSemanticFor(
  currentSource: GameIrDomainSourceEnvelope,
  sectionId = 'gameplay',
): GameIrDomainSemanticReceipt {
  return admitGameplaySemanticResult(
    packetFor(currentSource),
    resultValue({}, sectionId),
  )
}

function admittedSemantic(): GameIrDomainSemanticReceipt {
  return admittedSemanticFor(source())
}

function completeFixtureSource(profile: string): {
  source: GameIrDomainSourceEnvelope
  fullIndex: readonly GameIrSourceSection[]
} {
  const documents = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
      const submission = completeTestSubmission(path)
      const profileSubmission =
        path === 'docs/GDD.md'
          ? {
              ...submission,
              executiveSummary: `${submission.executiveSummary} Rule-driven Gameplay profile ${profile}.`,
              sections: submission.sections.map((section, index) =>
                index === 0
                  ? {
                      ...section,
                      body: `Rule-driven Gameplay profile ${profile}.`,
                    }
                  : section,
              ),
            }
          : submission
      const authored = renderTestCompleteGameDocument(path, profileSubmission)
      return [path, withTestDocumentMetadata(path, authored)] as const
    }),
  ) as Record<FoundationDocumentPath, string>
  const fullIndex = buildFoundationSectionIndex({ documents })
  const documentDigests = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [
      path,
      createHash('sha256').update(documents[path]).digest('hex'),
    ]),
  ) as FoundationReadyReceipt['documentDigests']
  const foundationBody: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'complete-fixture-project',
    foundationRevision: `complete-${profile}`,
    confirmedBriefDigest: 'c'.repeat(64),
    documentDigests,
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(fullIndex),
    authority: {
      kind: 'review',
      reviewDigest: 'd'.repeat(64),
      issueRegistryDigest: 'e'.repeat(64),
    },
  }
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: `gameplay-${profile}`,
    publicationId: `publication-${profile}`,
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundationBody,
      receiptDigest: digestGameIrValue(foundationBody),
    },
  }
  const gddSections = fullIndex.filter(
    section => section.documentPath === 'docs/GDD.md',
  )
  const sectionBytes = Object.fromEntries(
    gddSections.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      documents[section.documentPath]
        .split('\n')
        .slice(section.startLine - 1, section.endLine)
        .join('\n'),
    ]),
  )
  return {
    source: buildGameIrDomainSourceEnvelope({
      moduleId: 'gameplay',
      request,
      sectionIndex: fullIndex,
      sectionBytes,
    }),
    fullIndex,
  }
}

describe('Gameplay producer admission and assembler', () => {
  test('builds a service-owned packet from source and mechanical receipt', () => {
    const value = packet()
    expect(value.moduleId).toBe('gameplay')
    expect(value.allowedNodeKinds).toContain('gameplay.entity')
    expect(value.allowedRelationshipTypes).toContain('succeeds-with')
    expect(value.forbiddenTargets).toEqual([])
    expect(Object.isFrozen(value)).toBe(true)
  })

  test('rejects worker identity and digest fields', () => {
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({ taskId: 'attacker-task' }),
      ),
    ).toThrow(/field|task|identity/i)
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({ packetDigest: 'a'.repeat(64) }),
      ),
    ).toThrow(/field|packet|digest/i)
  })

  test('rejects unknown kinds and relationship roles', () => {
    const unknownKind = gameplayNodes()
    unknownKind[0]!.kind = 'gameplay.unknown'
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({ nodes: unknownKind }),
      ),
    ).toThrow(/kind/i)

    const unknownRole = gameplayNodes()
    unknownRole[1]!.edges[0]!.type = 'causes'
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({
          nodes: unknownRole,
          sourceClaims: sourceClaims(unknownRole),
        }),
      ),
    ).toThrow(/role|relationship/i)
  })

  test('rejects source claims outside exact Gameplay source scope and missing claims', () => {
    const outside = sourceClaims(gameplayNodes())
    outside[0]!.documentPath = 'docs/BALANCE_DESIGN.md'
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({ sourceClaims: outside }),
      ),
    ).toThrow(/source|document|scope/i)

    const claims = sourceClaims(gameplayNodes()).slice(1)
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({ sourceClaims: claims }),
      ),
    ).toThrow(/claim|binding|complete|missing/i)
  })

  test('assembles deterministically and rejects a DTO-valid but unreachable graph', () => {
    const currentSource = source()
    const currentMechanical = mechanical(currentSource)
    const semantic = admittedSemantic()
    const first = assembleGameplayModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    const second = assembleGameplayModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    expect(first.projectionDigest).toBe(second.projectionDigest)
    expect(first.module.nodes.map(node => node.id)).toEqual(
      [...first.module.nodes.map(node => node.id)].sort(compareCodeUnits),
    )

    const unreachableNodes = gameplayNodes().filter(
      node => node.id !== 'transition.finish',
    )
    const unreachable = admitGameplaySemanticResult(
      packet(),
      resultValue({
        nodes: unreachableNodes,
        sourceClaims: sourceClaims(unreachableNodes),
      }),
    )
    expect(() =>
      assembleGameplayModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: unreachable,
      }),
    ).toThrow(/unreachable/i)
  })

  test('rejects stale semantic receipts and caller projection digests', () => {
    const currentSource = source()
    const currentMechanical = mechanical(currentSource)
    const semantic = admittedSemantic()
    expect(() =>
      assembleGameplayModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: { ...semantic, sourceDigest: 'b'.repeat(64) },
      }),
    ).toThrow(/source|stale|digest/i)
    expect(() =>
      assembleGameplayModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic,
        // @ts-expect-error intentional authority probe
        projectionDigest: 'a'.repeat(64),
      }),
    ).toThrow(/input|field|projection/i)
  })

  test('rejects every worker-owned identity, mode, binding, and digest field', () => {
    const cases = [
      ['moduleId', { moduleId: 'balance' }],
      ['foundationRevision', { foundationRevision: 'worker-revision' }],
      [
        'producerMode',
        {
          nodes: gameplayNodes().map(node => ({
            ...node,
            producerMode: 'semantic',
          })),
        },
      ],
      [
        'bindings',
        { nodes: gameplayNodes().map(node => ({ ...node, bindings: {} })) },
      ],
      ['sourceDigest', { sourceDigest: 'a'.repeat(64) }],
      ['mechanicalReceiptDigest', { mechanicalReceiptDigest: 'a'.repeat(64) }],
      ['receiptDigest', { receiptDigest: 'a'.repeat(64) }],
    ] as const
    for (const [field, override] of cases)
      expect(() =>
        admitGameplaySemanticResult(packet(), resultValue(override)),
      ).toThrow(
        field === 'producerMode' || field === 'bindings'
          ? /nodes.*unknown or missing fields/i
          : /semantic result.*unknown or missing fields/i,
      )
  })

  test('rejects stale or relabelled packet fields before admitting a result', () => {
    expect(() =>
      admitGameplaySemanticResult(
        { ...packet(), sourceDigest: 'b'.repeat(64) },
        resultValue(),
      ),
    ).toThrow(/packet digest is stale/i)
    expect(() =>
      admitGameplaySemanticResult(
        { ...packet(), moduleId: 'balance' as never },
        resultValue(),
      ),
    ).toThrow(/packet digest is stale|moduleId/i)
  })

  test('rejects a nonexistent GDD section during exact source binding', () => {
    const currentSource = source()
    const currentPacket = packetFor(currentSource)
    const invalidSection = admitGameplaySemanticResult(
      currentPacket,
      resultValue({}, 'does-not-exist'),
    )
    expect(() =>
      assembleGameplayModule({
        source: currentSource,
        mechanical: mechanical(currentSource),
        semantic: invalidSection,
      }),
    ).toThrow(/exact Gameplay source sections/i)
  })

  test('rejects semantic ownership overlapping mechanical ownership', () => {
    const currentSource = source()
    const currentMechanical = mechanicalWithNode(currentSource, 'entity.player')
    expect(() =>
      admitGameplaySemanticResult(
        buildGameplaySemanticPacket({
          source: currentSource,
          mechanical: currentMechanical,
        }),
        resultValue(),
      ),
    ).toThrow(/overlap/i)
  })

  test('rejects extra and missing source-target accounting with dedicated errors', () => {
    const nodes = gameplayNodes()
    const missing = sourceClaims(nodes).slice(1)
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({ sourceClaims: missing }),
      ),
    ).toThrow(/exactly account for every semantic target/i)

    const extra = sourceClaims(nodes)
      .map((claim, index) =>
        index === 0
          ? {
              ...claim,
              subject: 'node:entity.player#/edges/0',
              sourcePointer: '/gameplay/entity.player/edges/0',
              literal: 'extra',
            }
          : claim,
      )
      .sort((left, right) =>
        compareCodeUnits(
          `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
          `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
        ),
      )
    expect(() =>
      admitGameplaySemanticResult(
        packet(),
        resultValue({ sourceClaims: extra }),
      ),
    ).toThrow(/exactly account for every semantic target/i)
  })

  test('rejects duplicate IDs across mechanical and semantic receipts', () => {
    const currentSource = source()
    const currentMechanical = mechanicalWithNode(currentSource, 'entity.player')
    const duplicatePacket = buildGameplaySemanticPacket({
      source: currentSource,
      mechanical: currentMechanical,
    })
    const admitted = admittedSemanticFor(currentSource)
    const forgedBody = {
      ...admitted,
      mechanicalReceiptDigest: duplicatePacket.mechanicalReceiptDigest,
      packetDigest: duplicatePacket.packetDigest,
    }
    const forged = {
      ...forgedBody,
      receiptDigest: digestGameIrValue(forgedBody),
    } as GameIrDomainSemanticReceipt
    expect(() =>
      assembleGameplayModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: forged,
      }),
    ).toThrow(/overlap/i)
  })

  test('canonicalizes differently ordered worker DTOs before signing', () => {
    const currentSource = source()
    const currentMechanical = mechanical(currentSource)
    const currentPacket = buildGameplaySemanticPacket({
      source: currentSource,
      mechanical: currentMechanical,
    })
    const semantic = admitGameplaySemanticResult(currentPacket, resultValue())
    const reordered = admitGameplaySemanticResult(
      currentPacket,
      resultValue({ nodes: [...gameplayNodes()].reverse() }),
    )
    expect(canonical(semantic)).toBe(canonical(reordered))
    expect(semantic.receiptDigest).toBe(reordered.receiptDigest)
    const first = assembleGameplayModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    const second = assembleGameplayModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic: reordered,
    })
    expect(canonical(first)).toBe(canonical(second))
    expect(first.projectionDigest).toBe(second.projectionDigest)
  })

  test('rejects a post-sign receipt reorder even when its digest is retained', () => {
    const currentSource = source()
    const currentMechanical = mechanical(currentSource)
    const semantic = admittedSemanticFor(currentSource)
    const reordered = {
      ...semantic,
      nodes: [...semantic.nodes].reverse(),
      receiptDigest: semantic.receiptDigest,
    }
    expect(() =>
      assembleGameplayModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: reordered,
      }),
    ).toThrow(/canonical|sorted|receipt/i)
  })

  test('compiles two complete Foundation fixture source profiles twice deterministically', () => {
    const projections = ['alpha', 'beta'].map(profile => {
      const { source: currentSource, fullIndex } =
        completeFixtureSource(profile)
      expect(currentSource.authoritySectionIndex).toEqual(fullIndex)
      expect(
        new Set(
          currentSource.authoritySectionIndex.map(
            section => section.documentPath,
          ),
        ),
      ).toEqual(new Set(CANONICAL_FOUNDATION_DOCUMENTS))
      expect(
        fullIndex.find(
          section =>
            section.documentPath === 'docs/ASSET_PLAN.md' &&
            section.sectionId === 'executive_summary',
        )?.startLine,
      ).toBe(9)
      expect(
        fullIndex.find(
          section =>
            section.documentPath === 'docs/ASSET_PLAN.md' &&
            section.sectionId === 'material.milestone-maturity-table',
        )?.startLine,
      ).toBe(96)
      expect(currentSource.sectionIndex).toEqual(
        currentSource.authoritySectionIndex.filter(
          section => section.documentPath === 'docs/GDD.md',
        ),
      )
      return currentSource.sectionIndex.map(section => {
        const currentMechanical = mechanical(currentSource)
        const semantic = admittedSemanticFor(currentSource, section.sectionId)
        const first = assembleGameplayModule({
          source: currentSource,
          mechanical: currentMechanical,
          semantic,
        })
        const second = assembleGameplayModule({
          source: currentSource,
          mechanical: currentMechanical,
          semantic,
        })
        expect(digestGameIrValue(first.module)).toBe(
          digestGameIrValue(second.module),
        )
        expect(canonical(first)).toBe(canonical(second))
        expect(first.projectionDigest).toBe(second.projectionDigest)
        return first
      })
    })
    expect(canonical(projections[0]!)).not.toBe(canonical(projections[1]!))
    expect(projections[0]).toHaveLength(projections[1]!.length)
    expect(
      projections[0]!.map(projection => digestGameIrValue(projection.module)),
    ).not.toEqual(
      projections[1]!.map(projection => digestGameIrValue(projection.module)),
    )
    expect(
      projections[0]!.map(projection => projection.projectionDigest),
    ).not.toEqual(
      projections[1]!.map(projection => projection.projectionDigest),
    )
  })
})
