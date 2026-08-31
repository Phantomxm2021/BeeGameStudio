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
  prepareBalanceModule,
  buildBalanceSemanticPacket,
  type GameIrDomainSemanticReceipt,
} from './balance-producer'
import {
  canonicalGameIrJson,
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
  ...Array.from(
    { length: 12 },
    () =>
      'balance.player-hp balance.tick-rate balance.unit.hp balance.unit.none balance.formula.double balance.economy-source balance.economy-sink balance.reward balance.cost balance.curve balance.binding balance.empty balance.missing balance.typed-true balance.typed-false gameplay.action.start Double HP Earn HP Spend HP Reward Cost Difficulty depends-on amount unit reward cost triggered-by Binding Typed Player HP Tick rate health hp 10 0 100 2 1 4 [] {} café true false null 100 2 4 5 8 binary add multiply reference literal left right operator value unitReferenceIndex outputUnitReferenceIndex',
  ),
  `${'balance.player-hp '.repeat(12)}${'balance.unit.hp '.repeat(12)}${'balance.unit.none '.repeat(4)}binary multiply reference literal`,
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
              sections: submission.sections.map(section => ({
                ...section,
                body: `${section.body} ${profile} ${balanceBytes}`,
              })),
              productionMaterials: submission.productionMaterials.map(
                material =>
                  'body' in material
                    ? {
                        ...material,
                        body: `${material.body} ${profile} ${balanceBytes}`,
                      }
                    : material,
              ),
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
  return admitGameIrMechanicalProjectionReceipt({
    source: currentSource,
    receipt: { ...body, receiptDigest: digestGameIrValue(body) },
  })
}

function resignSemantic(
  semantic: GameIrDomainSemanticReceipt,
  sourceClaims: typeof semantic.sourceClaims,
) {
  const body = { ...semantic, sourceClaims }
  return { ...body, receiptDigest: digestGameIrValue(body) }
}

type BalanceTestNode = {
  id: string
  kind: string
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
}

function simpleNodes(
  profile: 'zero-resource' | 'formula-dense' = 'zero-resource',
): BalanceTestNode[] {
  const nodes: BalanceTestNode[] = [
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
  if (profile === 'formula-dense')
    nodes.push(
      {
        id: 'balance.formula.double',
        kind: 'balance.formula',
        value: {
          label: 'Double HP',
          expression: {
            kind: 'binary',
            operator: 'add',
            left: { kind: 'reference', referenceIndex: 0 },
            right: {
              kind: 'binary',
              operator: 'multiply',
              left: { kind: 'literal', value: 2, unitReferenceIndex: 2 },
              right: { kind: 'reference', referenceIndex: 0 },
            },
          },
          outputUnitReferenceIndex: 1,
        },
        references: [
          { targetId: 'balance.player-hp', targetType: 'balance.variable' },
          { targetId: 'balance.unit.hp', targetType: 'balance.unit' },
          { targetId: 'balance.unit.none', targetType: 'balance.unit' },
        ],
        edges: [
          {
            type: 'depends-on',
            targetId: 'balance.player-hp',
            targetType: 'balance.variable',
          },
        ],
      },
      {
        id: 'balance.economy-source',
        kind: 'balance.economy-source',
        value: { label: 'Earn HP' },
        references: [
          { targetId: 'balance.player-hp', targetType: 'balance.variable' },
          { targetId: 'balance.unit.hp', targetType: 'balance.unit' },
        ],
        edges: [
          {
            type: 'amount',
            targetId: 'balance.player-hp',
            targetType: 'balance.variable',
          },
          {
            type: 'unit',
            targetId: 'balance.unit.hp',
            targetType: 'balance.unit',
          },
        ],
      },
      {
        id: 'balance.economy-sink',
        kind: 'balance.economy-sink',
        value: { label: 'Spend HP' },
        references: [
          { targetId: 'balance.player-hp', targetType: 'balance.variable' },
          { targetId: 'balance.unit.hp', targetType: 'balance.unit' },
        ],
        edges: [
          {
            type: 'amount',
            targetId: 'balance.player-hp',
            targetType: 'balance.variable',
          },
          {
            type: 'unit',
            targetId: 'balance.unit.hp',
            targetType: 'balance.unit',
          },
        ],
      },
      {
        id: 'balance.reward',
        kind: 'balance.reward',
        value: { label: 'Reward' },
        references: [
          { targetId: 'balance.formula.double', targetType: 'balance.formula' },
        ],
        edges: [
          {
            type: 'amount',
            targetId: 'balance.formula.double',
            targetType: 'balance.formula',
          },
        ],
      },
      {
        id: 'balance.cost',
        kind: 'balance.cost',
        value: { label: 'Cost' },
        references: [
          { targetId: 'balance.player-hp', targetType: 'balance.variable' },
        ],
        edges: [
          {
            type: 'amount',
            targetId: 'balance.player-hp',
            targetType: 'balance.variable',
          },
        ],
      },
      {
        id: 'balance.curve',
        kind: 'balance.progression-curve',
        value: {
          label: 'Difficulty',
          points: [
            { input: 0, output: 1 },
            { input: 5, output: 8 },
          ],
        },
        references: [],
        edges: [],
      },
    )
  return nodes
}

function sourceClaims(
  nodes: readonly BalanceTestNode[],
  currentSource: GameIrDomainSourceEnvelope = source(),
) {
  const balanceSections = currentSource.sectionIndex.filter(
    section => section.documentPath === 'docs/BALANCE_DESIGN.md',
  )
  if (balanceSections.length === 0)
    throw new Error('complete fixture balance section missing')
  const fixtureSection = balanceSections.find(section =>
    currentSource.sectionBytes[
      `${section.documentPath}#${section.sectionId}`
    ]!.includes('balance.formula.double'),
  )
  const sectionForLiteral = (literal: string) => {
    const section =
      (fixtureSection &&
      currentSource.sectionBytes[
        `${fixtureSection.documentPath}#${fixtureSection.sectionId}`
      ]!.includes(literal)
        ? fixtureSection
        : undefined) ??
      balanceSections.find(candidate =>
        currentSource.sectionBytes[
          `${candidate.documentPath}#${candidate.sectionId}`
        ]!.includes(literal),
      )
    if (!section) throw new Error(`fixture literal missing: ${literal}`)
    return section
  }
  const claims: Array<Record<string, string>> = []
  for (const node of nodes) {
    claims.push({
      subject: `node:${node.id}#/id`,
      documentPath: 'docs/BALANCE_DESIGN.md',
      sectionId: sectionForLiteral(node.id).sectionId,
      sourcePointer: '/bytes/0/1',
      literal: node.id,
    })
    const leaves = (value: unknown, pointer: string): void => {
      if (Array.isArray(value)) {
        if (value.length === 0)
          claims.push({
            subject: `node:${node.id}#${pointer}`,
            documentPath: 'docs/BALANCE_DESIGN.md',
            sectionId: sectionForLiteral('[]').sectionId,
            sourcePointer: '/bytes/0/1',
            literal: '[]',
          })
        else
          value.forEach((entry, index) => leaves(entry, `${pointer}/${index}`))
        return
      }
      if (value && typeof value === 'object') {
        if (Object.keys(value as Record<string, unknown>).length === 0) {
          claims.push({
            subject: `node:${node.id}#${pointer}`,
            documentPath: 'docs/BALANCE_DESIGN.md',
            sectionId: sectionForLiteral('{}').sectionId,
            sourcePointer: '/bytes/0/1',
            literal: '{}',
          })
          return
        }
        return Object.entries(value as Record<string, unknown>).forEach(
          ([key, entry]) => leaves(entry, `${pointer}/${key}`),
        )
      }
      claims.push({
        subject: `node:${node.id}#${pointer}`,
        documentPath: 'docs/BALANCE_DESIGN.md',
        sectionId: sectionForLiteral(String(value)).sectionId,
        sourcePointer: '/bytes/0/1',
        literal: String(value),
      })
    }
    if (Object.keys(node.value).length === 0) leaves(node.value, '/value')
    else
      Object.entries(node.value).forEach(([key, value]) =>
        leaves(value, `/value/${key}`),
      )
    node.references.forEach((reference, index) =>
      claims.push({
        subject: `node:${node.id}#/references/${index}`,
        documentPath: 'docs/BALANCE_DESIGN.md',
        sectionId: sectionForLiteral(reference.targetId).sectionId,
        sourcePointer: '/bytes/0/1',
        literal: reference.targetId,
      }),
    )
    node.edges.forEach((edge, index) =>
      claims.push({
        subject: `node:${node.id}#/edges/${index}`,
        documentPath: 'docs/BALANCE_DESIGN.md',
        sectionId: sectionForLiteral(edge.targetId).sectionId,
        sourcePointer: '/bytes/0/1',
        literal: edge.targetId,
      }),
    )
  }
  const occurrences = new Map<string, number>()
  for (const claim of claims) {
    const occurrence = occurrences.get(claim.literal) ?? 0
    const section = currentSource.sectionIndex.find(
      candidate =>
        candidate.documentPath === 'docs/BALANCE_DESIGN.md' &&
        candidate.sectionId === claim.sectionId,
    )!
    const bytes = Buffer.from(
      currentSource.sectionBytes[
        `${section.documentPath}#${section.sectionId}`
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

function validResult(
  currentSource: GameIrDomainSourceEnvelope = source(),
  profile: 'zero-resource' | 'formula-dense' = 'zero-resource',
  includeBinding = false,
) {
  const nodes = simpleNodes(profile)
  if (includeBinding) nodes.push(bindingNode())
  return {
    outcome: 'PROJECTED' as const,
    nodes,
    sourceClaims: sourceClaims(nodes, currentSource),
  }
}

function admittedNodes(nodes: BalanceTestNode[], currentSource = source()) {
  const mechanicalReceipt = mechanical(currentSource)
  const packet = buildBalanceSemanticPacket({
    source: currentSource,
    mechanical: mechanicalReceipt,
  })
  const semantic = admitBalanceSemanticResult(packet, {
    outcome: 'PROJECTED',
    nodes,
    sourceClaims: sourceClaims(nodes, currentSource),
  })
  if (semantic.outcome !== 'PROJECTED') throw new Error('expected projection')
  return { currentSource, mechanicalReceipt, semantic }
}

function bindingNodes(
  options: { triggerType?: string; includeTrigger?: boolean } = {},
): BalanceTestNode[] {
  const nodes = simpleNodes('formula-dense')
  nodes.push(bindingNode(options))
  return nodes
}

function bindingNode(
  options: { triggerType?: string; includeTrigger?: boolean } = {},
): BalanceTestNode {
  return {
    id: 'balance.binding',
    kind: 'balance.reward-cost-binding',
    value: { label: 'Binding' },
    references: [
      { targetId: 'balance.cost', targetType: 'balance.cost' },
      { targetId: 'balance.reward', targetType: 'balance.reward' },
      ...(options.includeTrigger === false
        ? []
        : [
            {
              targetId: 'gameplay.action.start',
              targetType: options.triggerType ?? 'gameplay.action',
            },
          ]),
    ],
    edges: [
      { type: 'cost', targetId: 'balance.cost', targetType: 'balance.cost' },
      {
        type: 'reward',
        targetId: 'balance.reward',
        targetType: 'balance.reward',
      },
      ...(options.includeTrigger === false
        ? []
        : [
            {
              type: 'triggered-by',
              targetId: 'gameplay.action.start',
              targetType: options.triggerType ?? 'gameplay.action',
            },
          ]),
    ],
  }
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

describe('Balance producer admission and Core preparation', () => {
  test.each([
    ['FAIL', 'missing-projection'],
    ['AMBIGUOUS', 'ambiguous-projection'],
  ] as const)('admits a packet-bound %s projection diagnostic', (outcome, reasonCode) => {
    const { packet, currentSource } = packetAndSource()
    const section = currentSource.sectionIndex.find(
      candidate => candidate.documentPath === 'docs/BALANCE_DESIGN.md',
    )!
    const admitted = admitBalanceSemanticResult(packet, {
      outcome,
      reasonCode,
      actual: 'No unique source-backed value exists.',
      missingSubject: 'node:balance.hp#/value/baseline',
      expectedProjection: 'One exact Balance value.',
      evidencePointers: [
        `section:${section.documentPath}#${section.sectionId}@${section.digest}`,
      ],
    })
    expect(admitted).toMatchObject({
      outcome,
      reasonCode,
      packetDigest: packet.packetDigest,
      sourceDigest: packet.sourceDigest,
      taskId: packet.taskId,
      moduleId: 'balance',
    })
  })

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
    const first = prepareBalanceModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    const second = prepareBalanceModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    expect(digestGameIrValue(first)).toBe(digestGameIrValue(second))
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
    const { packet, currentSource, currentMechanical } = packetAndSource()
    const invalid = validResult()
    invalid.sourceClaims[0]!.documentPath = 'docs/ASSET_PLAN.md'
    const semantic = admitBalanceSemanticResult(packet, invalid)
    expect(() =>
      prepareBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic,
      }),
    ).toThrow(/source|document|scope/i)
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
      prepareBalanceModule({
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
      prepareBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: wrongOccurrence,
      }),
    ).toThrow(/exactly match|literal|source/i)

    const utfNodes = simpleNodes()
    utfNodes[2]!.value.label = 'café'
    const utfSemantic = admitBalanceSemanticResult(packet, {
      outcome: 'PROJECTED',
      nodes: utfNodes,
      sourceClaims: sourceClaims(utfNodes, currentSource),
    })
    const cafeStart = Buffer.from(balanceBytes, 'utf8').indexOf(
      Buffer.from('café', 'utf8'),
    )
    const splitSemantic = resignSemantic(
      utfSemantic,
      utfSemantic.sourceClaims.map(claim =>
        claim.literal === 'café'
          ? {
              ...claim,
              sourcePointer: `/bytes/${cafeStart + 4}/${cafeStart + 5}`,
            }
          : claim,
      ),
    )
    expect(() =>
      prepareBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic: splitSemantic,
      }),
    ).toThrow(/UTF-8|literal|source|range/i)
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
    expect(() =>
      admitGameIrMechanicalProjectionReceipt({
        source: currentSource,
        receipt: {
          ...body,
          receiptDigest: digestGameIrValue(body),
        },
      }),
    ).toThrow(/mechanical|unauthorized|empty/i)
  })

  test('rejects an independently admitted nonempty mechanical node receipt', () => {
    const { currentSource, currentMechanical, packet } = packetAndSource()
    const semantic = admitBalanceSemanticResult(packet, validResult())
    const assembled = prepareBalanceModule({
      source: currentSource,
      mechanical: currentMechanical,
      semantic,
    })
    const node = assembled.module.nodes[0]!
    const mechanicalNode = { ...node, producerMode: 'mechanical' as const }
    const ownedTargets = Object.keys(mechanicalNode.bindings)
      .map(pointer => `node:${mechanicalNode.id}#${pointer}`)
      .sort(compareCodeUnits)
    const body = {
      schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
      taskId: currentSource.taskId,
      moduleId: currentSource.moduleId,
      foundationRevision:
        currentSource.compileRequest.foundation.foundationRevision,
      sourceDigest: currentSource.sourceDigest,
      nodes: [mechanicalNode],
      verifiedClaims: [],
      ownedTargets,
    }
    expect(() =>
      admitGameIrMechanicalProjectionReceipt({
        source: currentSource,
        receipt: { ...body, receiptDigest: digestGameIrValue(body) },
      }),
    ).toThrow(/mechanical|unauthorized|empty/i)
  })

  test('covers typed UTF-8, repeated ranges, booleans, null, empty containers, and edges', () => {
    const currentSource = source()
    const nodes = simpleNodes('formula-dense')
    nodes[2]!.value.label = 'café'
    const result = {
      outcome: 'PROJECTED' as const,
      nodes,
      sourceClaims: sourceClaims(nodes, currentSource),
    }
    const labelClaim = result.sourceClaims.find(
      claim => claim.literal === 'café',
    )!
    expect(Number(labelClaim.sourcePointer.split('/')[2])).toBeGreaterThan(0)
    expect(
      Number(labelClaim.sourcePointer.split('/')[3]) -
        Number(labelClaim.sourcePointer.split('/')[2]),
    ).toBe(Buffer.byteLength('café', 'utf8'))
    const repeated = result.sourceClaims.filter(
      claim => claim.literal === 'balance.player-hp',
    )
    expect(
      new Set(repeated.map(claim => claim.sourcePointer)).size,
    ).toBeGreaterThan(1)
    expect(() =>
      admitBalanceSemanticResult(
        buildBalanceSemanticPacket({
          source: currentSource,
          mechanical: mechanical(currentSource),
        }),
        {
          outcome: 'PROJECTED',
          nodes,
          sourceClaims: sourceClaims(nodes, currentSource),
        },
      ),
    ).not.toThrow()

    for (const value of [true, null, {}]) {
      const invalidNodes = simpleNodes()
      invalidNodes[2]!.value.label = value
      const invalidClaims = sourceClaims(invalidNodes, currentSource)
      const claim = invalidClaims.find(item =>
        item.subject.endsWith('/value/label'),
      )!
      const oneStart = Buffer.from(balanceBytes, 'utf8').indexOf(
        Buffer.from('1', 'utf8'),
      )
      const swapped = invalidClaims.map(item =>
        item === claim
          ? {
              ...item,
              sourcePointer: `/bytes/${oneStart}/${oneStart + 1}`,
              literal: '1',
            }
          : item,
      )
      expect(() =>
        admitBalanceSemanticResult(
          buildBalanceSemanticPacket({
            source: currentSource,
            mechanical: mechanical(currentSource),
          }),
          { outcome: 'PROJECTED', nodes: invalidNodes, sourceClaims: swapped },
        ),
      ).toThrow(/literal|type|semantic/i)
    }

    for (const [flag, note] of [
      [true, null] as const,
      [false, null] as const,
    ]) {
      const typedNodes = simpleNodes()
      typedNodes.push({
        id: `balance.typed-${flag ? 'true' : 'false'}`,
        kind: 'balance.progression-curve',
        value: { label: 'Typed', points: [], flag, note },
        references: [],
        edges: [],
      })
      expect(() =>
        admitBalanceSemanticResult(
          buildBalanceSemanticPacket({
            source: currentSource,
            mechanical: mechanical(currentSource),
          }),
          {
            outcome: 'PROJECTED',
            nodes: typedNodes,
            sourceClaims: sourceClaims(typedNodes, currentSource),
          },
        ),
      ).not.toThrow()
    }

    const emptyNodes = simpleNodes()
    emptyNodes.push({
      id: 'balance.empty',
      kind: 'balance.progression-curve',
      value: {},
      references: [],
      edges: [],
    })
    const emptyPacket = buildBalanceSemanticPacket({
      source: currentSource,
      mechanical: mechanical(currentSource),
    })
    expect(() =>
      admitBalanceSemanticResult(emptyPacket, {
        outcome: 'PROJECTED',
        nodes: emptyNodes,
        sourceClaims: sourceClaims(emptyNodes, currentSource),
      }),
    ).not.toThrow()
  })

  test('proves source accounting and duplicate ownership guards', () => {
    const currentSource = source()
    const packet = buildBalanceSemanticPacket({
      source: currentSource,
      mechanical: mechanical(currentSource),
    })
    const valid = validResult(currentSource)
    expect(() =>
      admitBalanceSemanticResult(packet, {
        outcome: 'PROJECTED',
        nodes: valid.nodes,
        sourceClaims: valid.sourceClaims.slice(1),
      }),
    ).toThrow(/account|claim|target/i)
    const duplicateNodes = [...valid.nodes, { ...valid.nodes[0]! }]
    expect(() =>
      admitBalanceSemanticResult(packet, {
        outcome: 'PROJECTED',
        nodes: duplicateNodes,
        sourceClaims: valid.sourceClaims,
      }),
    ).toThrow(/duplicate|unique|claim/i)
    const duplicateClaims = [...valid.sourceClaims, valid.sourceClaims[0]!]
    expect(() =>
      admitBalanceSemanticResult(packet, {
        outcome: 'PROJECTED',
        nodes: valid.nodes,
        sourceClaims: duplicateClaims,
      }),
    ).toThrow(/duplicate|sorted|account/i)
  })

  test('compiles complete zero-resource and formula-dense Foundation profiles twice', () => {
    const digests: string[] = []
    const moduleBytes: string[] = []
    const projectionBytes: string[] = []
    for (const profile of ['zero-resource', 'formula-dense'] as const) {
      const currentSource = completeSource(profile)
      const currentMechanical = mechanical(currentSource)
      const packet = buildBalanceSemanticPacket({
        source: currentSource,
        mechanical: currentMechanical,
      })
      const semantic = admitBalanceSemanticResult(
        packet,
        validResult(currentSource, profile, profile === 'formula-dense'),
      )
      const first = prepareBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic,
      })
      const second = prepareBalanceModule({
        source: currentSource,
        mechanical: currentMechanical,
        semantic,
      })
      expect(digestGameIrValue(first)).toBe(digestGameIrValue(second))
      expect(digestGameIrValue(first.module)).toBe(
        digestGameIrValue(second.module),
      )
      expect(canonicalGameIrJson(first.module)).toBe(
        canonicalGameIrJson(second.module),
      )
      expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
      expect(
        first.module.nodes.some(node => node.kind === 'balance.formula'),
      ).toBe(profile === 'formula-dense')
      expect(
        first.module.nodes.some(node => node.kind === 'balance.economy-source'),
      ).toBe(profile === 'formula-dense')
      expect(
        first.module.nodes.some(node => node.kind === 'balance.reward'),
      ).toBe(profile === 'formula-dense')
      expect(
        first.module.nodes.some(
          node => node.kind === 'balance.reward-cost-binding',
        ),
      ).toBe(profile === 'formula-dense')
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
      digests.push(digestGameIrValue(first))
      moduleBytes.push(canonicalGameIrJson(first.module))
      projectionBytes.push(canonicalGameIrJson(first))
    }
    expect(digests[0]).not.toBe(digests[1])
    expect(moduleBytes[0]).not.toBe(moduleBytes[1])
    expect(projectionBytes[0]).not.toBe(projectionBytes[1])
  })
})
