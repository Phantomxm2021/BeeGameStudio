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
  admitBalanceSemanticResult,
  assembleBalanceModule,
  buildBalanceSemanticPacket,
  type BalanceModuleProjection,
} from './balance-producer'
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
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
} from '../foundation-section-index'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../../__tests__/delivery-workflow-test-helpers'

const balanceBytes = [
  '| id | baseline | range | unit |',
  '| player_hp | 10 | 0..100 | hp |',
  '| tick_rate | 2 | 1..4 | 1 |',
  'balance.player-hp balance.tick-rate balance.unit.hp balance.unit.none balance.unit.hp balance.unit.none balance.unit.hp balance.unit.none Player HP Tick rate health hp 10 0 100 2 1 4 [] 1 1 1 1 0 0 100 100 2 4',
].join('\n')

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function source(): GameIrDomainSourceEnvelope {
  const fullIndex: GameIrSourceSection[] = CANONICAL_FOUNDATION_DOCUMENTS.map(
    (documentPath, index) => {
      const bytes =
        documentPath === 'docs/BALANCE_DESIGN.md'
          ? balanceBytes
          : `# ${documentPath}`
      return {
        documentPath,
        sectionId:
          documentPath === 'docs/BALANCE_DESIGN.md'
            ? 'balance-table'
            : `section-${index}`,
        heading:
          documentPath === 'docs/BALANCE_DESIGN.md'
            ? 'Balance'
            : `Section ${index}`,
        startLine: 1,
        endLine: bytes.split('\n').length,
        digest: sha256(bytes),
      }
    },
  )
  const foundation: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'balance-project',
    foundationRevision: 'balance-revision',
    confirmedBriefDigest: 'a'.repeat(64),
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'b'.repeat(64)]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(fullIndex),
    authority: {
      kind: 'review',
      reviewDigest: 'c'.repeat(64),
      issueRegistryDigest: 'd'.repeat(64),
    },
  }
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'balance-task',
    publicationId: 'balance-publication',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: { ...foundation, receiptDigest: digestGameIrValue(foundation) },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'balance',
    request,
    sectionIndex: fullIndex,
    sectionBytes: {
      'docs/BALANCE_DESIGN.md#balance-table': balanceBytes,
      'docs/GDD.md#section-0': '# docs/GDD.md',
    },
  })
}

function completeSource(
  profile: 'zero-resource' | 'formula-dense',
): GameIrDomainSourceEnvelope {
  const documents = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
      const submission = completeTestSubmission(path)
      const profiled =
        path === 'docs/BALANCE_DESIGN.md'
          ? {
              ...submission,
              executiveSummary: `${submission.executiveSummary} ${profile} ${balanceBytes}`,
            }
          : submission
      return [
        path,
        withTestDocumentMetadata(
          path,
          renderTestCompleteGameDocument(path, profiled),
        ),
      ] as const
    }),
  ) as Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>
  const fullIndex = buildFoundationSectionIndex({ documents })
  const documentDigests = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256(documents[path])]),
  ) as FoundationReadyReceipt['documentDigests']
  const foundation: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'complete-balance-project',
    foundationRevision: `complete-${profile}`,
    confirmedBriefDigest: 'e'.repeat(64),
    documentDigests,
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(fullIndex),
    authority: {
      kind: 'review',
      reviewDigest: 'f'.repeat(64),
      issueRegistryDigest: '0'.repeat(64),
    },
  }
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: `balance-${profile}`,
    publicationId: `publication-${profile}`,
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: { ...foundation, receiptDigest: digestGameIrValue(foundation) },
  }
  const selected = fullIndex.filter(
    section =>
      section.documentPath === 'docs/GDD.md' ||
      section.documentPath === 'docs/BALANCE_DESIGN.md',
  )
  const sectionBytes = Object.fromEntries(
    selected.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      documents[section.documentPath]
        .split('\n')
        .slice(section.startLine - 1, section.endLine)
        .join('\n'),
    ]),
  )
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'balance',
    request,
    sectionIndex: fullIndex,
    sectionBytes,
  })
}

function mechanical(
  currentSource = source(),
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

function resignSemantic(
  semantic: ReturnType<typeof admitBalanceSemanticResult>,
  sourceClaims: typeof semantic.sourceClaims,
) {
  const body = { ...semantic, sourceClaims }
  return { ...body, receiptDigest: digestGameIrValue(body) }
}

function simpleNodes(): Array<{
  id: string
  kind: string
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
}> {
  return [
    {
      id: 'balance.unit.hp',
      kind: 'balance.unit',
      value: {
        symbol: 'hp',
        dimensions: [{ base: 'health', exponent: 1 }],
        scale: { numerator: 1, denominator: 1 },
      },
      references: [],
      edges: [],
    },
    {
      id: 'balance.unit.none',
      kind: 'balance.unit',
      value: {
        symbol: '1',
        dimensions: [],
        scale: { numerator: 1, denominator: 1 },
      },
      references: [],
      edges: [],
    },
    {
      id: 'balance.player-hp',
      kind: 'balance.variable',
      value: {
        label: 'Player HP',
        baseline: 10,
        minimum: 0,
        maximum: 100,
        unitReferenceIndex: 0,
      },
      references: [{ targetId: 'balance.unit.hp', targetType: 'balance.unit' }],
      edges: [],
    },
    {
      id: 'balance.tick-rate',
      kind: 'balance.parameter',
      value: {
        label: 'Tick rate',
        baseline: 2,
        minimum: 1,
        maximum: 4,
        unitReferenceIndex: 0,
      },
      references: [
        { targetId: 'balance.unit.none', targetType: 'balance.unit' },
      ],
      edges: [],
    },
  ]
}

function sourceClaims(
  nodes: readonly ReturnType<typeof simpleNodes>[number][],
  currentSource: GameIrDomainSourceEnvelope = source(),
) {
  const balanceSection = currentSource.sectionIndex.find(section => {
    const bytes =
      currentSource.sectionBytes[`${section.documentPath}#${section.sectionId}`]
    return (
      section.documentPath === 'docs/BALANCE_DESIGN.md' &&
      bytes?.includes(balanceBytes.split('\n')[0]!)
    )
  })
  if (!balanceSection)
    throw new Error('complete fixture balance section missing')
  const claims: Array<Record<string, string>> = []
  for (const node of nodes) {
    claims.push({
      subject: `node:${node.id}#/id`,
      documentPath: 'docs/BALANCE_DESIGN.md',
      sectionId: balanceSection.sectionId,
      sourcePointer: '/bytes/0/1',
      literal: node.id,
    })
    const leaves = (value: unknown, pointer: string): void => {
      if (Array.isArray(value)) {
        if (value.length === 0)
          claims.push({
            subject: `node:${node.id}#${pointer}`,
            documentPath: 'docs/BALANCE_DESIGN.md',
            sectionId: balanceSection.sectionId,
            sourcePointer: '/bytes/0/1',
            literal: '[]',
          })
        else
          value.forEach((entry, index) => leaves(entry, `${pointer}/${index}`))
        return
      }
      if (value && typeof value === 'object')
        return Object.entries(value as Record<string, unknown>).forEach(
          ([key, entry]) => leaves(entry, `${pointer}/${key}`),
        )
      claims.push({
        subject: `node:${node.id}#${pointer}`,
        documentPath: 'docs/BALANCE_DESIGN.md',
        sectionId: balanceSection.sectionId,
        sourcePointer: '/bytes/0/1',
        literal: String(value),
      })
    }
    Object.entries(node.value).forEach(([key, value]) =>
      leaves(value, `/value/${key}`),
    )
    node.references.forEach((reference, index) =>
      claims.push({
        subject: `node:${node.id}#/references/${index}`,
        documentPath: 'docs/BALANCE_DESIGN.md',
        sectionId: balanceSection.sectionId,
        sourcePointer: '/bytes/0/1',
        literal: reference.targetId,
      }),
    )
  }
  const occurrences = new Map<string, number>()
  for (const claim of claims) {
    const occurrence = occurrences.get(claim.literal) ?? 0
    const bytes = Buffer.from(
      currentSource.sectionBytes[
        `${balanceSection.documentPath}#${balanceSection.sectionId}`
      ]!,
      'utf8',
    )
    let cursor = 0
    for (let index = 0; index < occurrence; index += 1) {
      const next = bytes.indexOf(Buffer.from(claim.literal, 'utf8'), cursor)
      cursor = next + Buffer.byteLength(claim.literal, 'utf8')
    }
    const exactStart = bytes.indexOf(Buffer.from(claim.literal, 'utf8'), cursor)
    if (exactStart < 0)
      throw new Error(`fixture literal missing: ${claim.literal}`)
    const end = exactStart + Buffer.byteLength(claim.literal, 'utf8')
    claim.sourcePointer = `/bytes/${exactStart}/${end}`
    occurrences.set(claim.literal, occurrence + 1)
  }
  return claims.sort((left, right) =>
    compareCodeUnits(
      `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
      `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
    ),
  )
}

function validResult(currentSource: GameIrDomainSourceEnvelope = source()) {
  const nodes = simpleNodes()
  return { nodes, sourceClaims: sourceClaims(nodes, currentSource) }
}

function packetAndSource() {
  const currentSource = source()
  const currentMechanical = mechanical(currentSource)
  return {
    currentSource,
    currentMechanical,
    packet: buildBalanceSemanticPacket({
      source: currentSource,
      mechanical: currentMechanical,
    }),
  }
}

describe('Balance producer admission and assembler', () => {
  test('declares complete variable and parameter records semantic-owned with empty mechanical receipt', () => {
    const { packet, currentMechanical } = packetAndSource()
    expect(currentMechanical.nodes).toEqual([])
    expect(packet.moduleId).toBe('balance')
    expect(packet.allowedNodeKinds).toContain('balance.variable')
    expect(packet.allowedNodeKinds).toContain('balance.parameter')
    expect(packet.allowedRelationshipTypes).toContain('depends-on')
    expect(Object.isFrozen(packet)).toBe(true)
  })

  test('admits exact Balance literals and rejects a changed numeric claim', () => {
    const { packet } = packetAndSource()
    const admitted = admitBalanceSemanticResult(packet, validResult())
    expect(admitted.nodes.every(node => node.producerMode === 'semantic')).toBe(
      true,
    )
    const invalid = validResult()
    invalid.sourceClaims = invalid.sourceClaims.map(claim =>
      claim.subject.endsWith('/baseline') ? { ...claim, literal: '11' } : claim,
    )
    invalid.sourceClaims.sort((left, right) =>
      compareCodeUnits(
        `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
        `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
      ),
    )
    expect(() => admitBalanceSemanticResult(packet, invalid)).toThrow(
      /literal|byte|source/i,
    )
  })

  test('assembles a frozen deterministic Balance module and rejects an unimplemented target', () => {
    const { currentSource, currentMechanical, packet } = packetAndSource()
    const semantic = admitBalanceSemanticResult(packet, validResult())
    const first = assembleBalanceModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    const second = assembleBalanceModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    expect(first.projectionDigest).toBe(second.projectionDigest)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.module)).toBe(true)

    const malformed = validResult()
    malformed.nodes[0]!.references = [
      { targetId: 'world.foo', targetType: 'world.entity' },
    ]
    expect(() => admitBalanceSemanticResult(packet, malformed)).toThrow(
      /literal|claim|target/i,
    )
  })

  test('rejects source claims outside the exact Balance closure', () => {
    const { packet } = packetAndSource()
    const invalid = validResult()
    invalid.sourceClaims[0]!.documentPath = 'docs/ASSET_PLAN.md'
    expect(() => admitBalanceSemanticResult(packet, invalid)).toThrow(
      /source|document|scope/i,
    )
  })

  test('requires canonical exact UTF-8 byte ranges and rejects wrong source occurrences', () => {
    const { packet, currentSource, currentMechanical } = packetAndSource()
    const semantic = admitBalanceSemanticResult(packet, validResult())
    const malformed = validResult()
    malformed.sourceClaims[0]!.sourcePointer = '/bytes/00/1'
    expect(() => admitBalanceSemanticResult(packet, malformed)).toThrow(
      /canonical|bytes|range/i,
    )

    const outOfBounds = validResult()
    outOfBounds.sourceClaims[0]!.sourcePointer = '/bytes/0/999999'
    const outOfBoundsReceipt = admitBalanceSemanticResult(packet, outOfBounds)
    expect(() =>
      assembleBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: outOfBoundsReceipt,
      }),
    ).toThrow(/outside|range|bytes/i)

    const wrongOccurrence = resignSemantic(
      semantic,
      semantic.sourceClaims.map((claim, index) =>
        index === 0 ? { ...claim, sourcePointer: '/bytes/0/1' } : claim,
      ),
    )
    expect(() =>
      assembleBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: wrongOccurrence,
      }),
    ).toThrow(/exactly match|literal|source/i)
  })

  test('rejects any Balance mechanical output under the non-fixed table contract', () => {
    const currentSource = source()
    const body = {
      schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
      taskId: currentSource.taskId,
      moduleId: currentSource.moduleId,
      foundationRevision:
        currentSource.compileRequest.foundation.foundationRevision,
      sourceDigest: currentSource.sourceDigest,
      nodes: [],
      verifiedClaims: [
        {
          subject: 'node:x#/id',
          sourcePointer: '/bytes/0/1',
          literal: 'x',
        },
      ],
      ownedTargets: [],
    }
    const currentMechanical = admitGameIrMechanicalProjectionReceipt(
      currentSource,
      {
        ...body,
        receiptDigest: digestGameIrValue(body),
      },
    )
    expect(() =>
      buildBalanceSemanticPacket({
        source: currentSource,
        mechanical: currentMechanical,
      }),
    ).toThrow(/mechanical|unauthorized|empty/i)
  })

  test('compiles complete zero-resource and formula-dense Foundation profiles twice', () => {
    const digests: string[] = []
    for (const profile of ['zero-resource', 'formula-dense'] as const) {
      const currentSource = completeSource(profile)
      const currentMechanical = mechanical(currentSource)
      const packet = buildBalanceSemanticPacket({
        source: currentSource,
        mechanical: currentMechanical,
      })
      const semantic = admitBalanceSemanticResult(
        packet,
        validResult(currentSource),
      )
      const first = assembleBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic,
      })
      const second = assembleBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic,
      })
      expect(first.projectionDigest).toBe(second.projectionDigest)
      expect(digestGameIrValue(first.module)).toBe(
        digestGameIrValue(second.module),
      )
      expect(
        new Set(
          currentSource.authoritySectionIndex.map(
            section => section.documentPath,
          ),
        ),
      ).toEqual(new Set(CANONICAL_FOUNDATION_DOCUMENTS))
      expect(
        currentSource.sectionIndex.every(
          section =>
            section.documentPath === 'docs/GDD.md' ||
            section.documentPath === 'docs/BALANCE_DESIGN.md',
        ),
      ).toBe(true)
      digests.push(first.projectionDigest)
    }
    expect(digests[0]).not.toBe(digests[1])
  })
})
