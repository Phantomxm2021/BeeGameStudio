import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitGameIrMechanicalProjectionReceipt,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import { buildGameIrDomainSourceEnvelope } from './domain-source'
import {
  admitGameplaySemanticResult,
  assembleGameplayModule,
  buildGameplaySemanticPacket,
} from './gameplay-producer'
import {
  admitBalanceSemanticResult,
  assembleBalanceModule,
  buildBalanceSemanticPacket,
} from './balance-producer'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  canonicalizeGameIrSourceSections,
  digestGameIrValue,
  type GameIrSourceSection,
} from './model'
import { digestSectionIndex } from '../foundation-section-index'

const gddBytes = '# Gameplay\n\nThe player spends health to finish.\n'
const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

function balanceBytes(): string {
  let output = ''
  for (const node of balanceNodes) {
    const pointers = [
      '/id',
      ...leafPointers(node.value),
      ...node.references.map((_, index) => `/references/${index}`),
      ...node.edges.map((_, index) => `/edges/${index}`),
    ]
    for (const pointer of pointers.sort())
      output += `${balanceLiteral(node, pointer)}\n`
  }
  return output
}

function readyRequest(): GameIrCompileRequest {
  const documentDigests = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256(path)]),
  ) as Record<FoundationDocumentPath, string>
  const fullIndex: GameIrSourceSection[] = CANONICAL_FOUNDATION_DOCUMENTS.map(
    (documentPath, index) => ({
      documentPath,
      sectionId:
        documentPath === 'docs/GDD.md'
          ? 'gameplay'
          : documentPath === 'docs/BALANCE_DESIGN.md'
            ? 'balance'
            : `section-${index}`,
      heading: documentPath,
      startLine: 1,
      endLine:
        documentPath === 'docs/GDD.md'
          ? gddBytes.split('\n').length
          : documentPath === 'docs/BALANCE_DESIGN.md'
            ? balanceBytes().split('\n').length
            : 1,
      digest:
        documentPath === 'docs/GDD.md'
          ? sha256(gddBytes)
          : documentPath === 'docs/BALANCE_DESIGN.md'
            ? sha256(balanceBytes())
            : sha256(documentPath),
    }),
  )
  const foundationBody: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'phase-4-gate',
    foundationRevision: 'foundation-ready-1',
    confirmedBriefDigest: sha256('brief'),
    documentDigests,
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(fullIndex),
    authority: {
      kind: 'review',
      reviewDigest: sha256('review'),
      issueRegistryDigest: sha256('issues'),
    },
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'phase-4-gate-task',
    publicationId: 'phase-4-gate-publication',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundationBody,
      receiptDigest: digestGameIrValue(foundationBody),
    },
  }
}

function sourcePair() {
  const request = readyRequest()
  const fullIndex = canonicalizeGameIrSourceSections(
    CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId:
        documentPath === 'docs/GDD.md'
          ? 'gameplay'
          : documentPath === 'docs/BALANCE_DESIGN.md'
            ? 'balance'
            : `section-${index}`,
      heading: documentPath,
      startLine: 1,
      endLine:
        documentPath === 'docs/GDD.md'
          ? gddBytes.split('\n').length
          : documentPath === 'docs/BALANCE_DESIGN.md'
            ? balanceBytes().split('\n').length
            : 1,
      digest:
        documentPath === 'docs/GDD.md'
          ? sha256(gddBytes)
          : documentPath === 'docs/BALANCE_DESIGN.md'
            ? sha256(balanceBytes())
            : sha256(documentPath),
    })),
  )
  return {
    gameplay: buildGameIrDomainSourceEnvelope({
      moduleId: 'gameplay',
      request,
      sectionIndex: [...fullIndex].reverse(),
      sectionBytes: { 'docs/GDD.md#gameplay': gddBytes },
    }),
    balance: buildGameIrDomainSourceEnvelope({
      moduleId: 'balance',
      request,
      sectionIndex: fullIndex,
      sectionBytes: {
        'docs/GDD.md#gameplay': gddBytes,
        'docs/BALANCE_DESIGN.md#balance': balanceBytes(),
      },
    }),
  }
}

function emptyMechanical(
  source: ReturnType<typeof sourcePair>[keyof ReturnType<typeof sourcePair>],
): GameIrMechanicalProjectionReceipt {
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
  }
  return admitGameIrMechanicalProjectionReceipt(source, {
    ...body,
    receiptDigest: digestGameIrValue(body),
  })
}

function leafPointers(value: Record<string, unknown>): string[] {
  const output: string[] = []
  const visit = (entry: unknown, pointer: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) output.push(pointer)
      else entry.forEach((child, index) => visit(child, `${pointer}/${index}`))
    } else if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry)
      if (entries.length === 0) output.push(pointer)
      else entries.forEach(([key, child]) => visit(child, `${pointer}/${key}`))
    } else output.push(pointer)
  }
  Object.entries(value).forEach(([key, entry]) => visit(entry, `/value/${key}`))
  return output
}

const gameplayNodes = [
  {
    id: 'entity.player',
    kind: 'gameplay.entity',
    value: { label: 'Player' },
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
    id: 'state.done',
    kind: 'gameplay.state',
    value: { label: 'Done', initial: false, terminal: 'success' },
    references: [],
    edges: [],
  },
  {
    id: 'condition.has-health',
    kind: 'gameplay.condition',
    value: {
      expression: {
        kind: 'compare',
        operator: 'gt',
        left: { kind: 'reference', referenceIndex: 0 },
        right: { kind: 'literal', value: 0 },
      },
    },
    references: [
      { targetId: 'balance.player-hp', targetType: 'balance.variable' },
    ],
    edges: [],
  },
  {
    id: 'effect.spend-health',
    kind: 'gameplay.effect',
    value: { effect: { operation: 'add', targetReferenceIndex: 0, value: -1 } },
    references: [
      { targetId: 'balance.player-hp', targetType: 'balance.variable' },
    ],
    edges: [],
  },
  {
    id: 'action.finish',
    kind: 'gameplay.action',
    value: { label: 'Finish' },
    references: [],
    edges: [
      {
        type: 'causes',
        targetId: 'effect.spend-health',
        targetType: 'gameplay.effect',
      },
      {
        type: 'requires',
        targetId: 'condition.has-health',
        targetType: 'gameplay.condition',
      },
    ],
  },
  {
    id: 'transition.finish',
    kind: 'gameplay.transition',
    value: { label: 'Finish' },
    references: [],
    edges: [
      { type: 'from', targetId: 'state.start', targetType: 'gameplay.state' },
      { type: 'to', targetId: 'state.done', targetType: 'gameplay.state' },
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
    id: 'objective.finish',
    kind: 'gameplay.objective',
    value: { label: 'Finish objective' },
    references: [],
    edges: [
      {
        type: 'succeeds-with',
        targetId: 'outcome.win',
        targetType: 'gameplay.outcome',
      },
    ],
  },
] as const

function gameplayClaims() {
  return gameplayNodes
    .flatMap(node => [
      {
        subject: `node:${node.id}#/id`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'gameplay',
        sourcePointer: `/gameplay/${node.id}`,
        literal: node.id,
      },
      ...leafPointers(node.value).map(pointer => ({
        subject: `node:${node.id}#${pointer}`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'gameplay',
        sourcePointer: `/gameplay/${node.id}${pointer}`,
        literal: pointer,
      })),
      ...node.references.map((reference, index) => ({
        subject: `node:${node.id}#/references/${index}`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'gameplay',
        sourcePointer: `/gameplay/${node.id}/reference/${index}`,
        literal: reference.targetId,
      })),
      ...node.edges.map((edge, index) => ({
        subject: `node:${node.id}#/edges/${index}`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'gameplay',
        sourcePointer: `/gameplay/${node.id}/edge/${index}`,
        literal: edge.targetId,
      })),
    ])
    .sort((left, right) =>
      `${left.subject}\0${left.sourcePointer}\0${left.literal}`.localeCompare(
        `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
      ),
    )
}

const balanceNodes = [
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
    id: 'balance.player-hp',
    kind: 'balance.variable',
    value: { label: 'Player HP', baseline: 100, unitReferenceIndex: 0 },
    references: [{ targetId: 'balance.unit.hp', targetType: 'balance.unit' }],
    edges: [],
  },
  {
    id: 'balance.reward.finish',
    kind: 'balance.reward',
    value: { label: 'Finish reward' },
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
    id: 'balance.cost.finish',
    kind: 'balance.cost',
    value: { label: 'Finish cost' },
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
    id: 'balance.binding.finish',
    kind: 'balance.reward-cost-binding',
    value: { label: 'Finish binding' },
    references: [
      { targetId: 'action.finish', targetType: 'gameplay.action' },
      { targetId: 'balance.cost.finish', targetType: 'balance.cost' },
      { targetId: 'balance.reward.finish', targetType: 'balance.reward' },
    ],
    edges: [
      {
        type: 'cost',
        targetId: 'balance.cost.finish',
        targetType: 'balance.cost',
      },
      {
        type: 'reward',
        targetId: 'balance.reward.finish',
        targetType: 'balance.reward',
      },
      {
        type: 'triggered-by',
        targetId: 'action.finish',
        targetType: 'gameplay.action',
      },
    ],
  },
] as const

function balanceLiteral(
  node: (typeof balanceNodes)[number],
  pointer: string,
): string {
  if (pointer === '/id') return node.id
  if (pointer.startsWith('/references/'))
    return node.references[Number(pointer.slice(12))]!.targetId
  if (pointer.startsWith('/edges/'))
    return node.edges[Number(pointer.slice(7))]!.targetId
  if (pointer === '/value') return JSON.stringify(node.value)
  let current: unknown = node.value
  for (const segment of pointer.slice('/value/'.length).split('/'))
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment]
  return typeof current === 'string' ? current : JSON.stringify(current)
}

function balanceClaims() {
  const records: Array<{
    subject: string
    documentPath: 'docs/BALANCE_DESIGN.md'
    sectionId: string
    sourcePointer: string
    literal: string
  }> = []
  let offset = 0
  for (const node of balanceNodes) {
    const pointers = [
      '/id',
      ...leafPointers(node.value),
      ...node.references.map((_, index) => `/references/${index}`),
      ...node.edges.map((_, index) => `/edges/${index}`),
    ]
    for (const pointer of pointers.sort()) {
      const literal = balanceLiteral(node, pointer)
      const bytes = `${literal}\n`
      records.push({
        subject: `node:${node.id}#${pointer}`,
        documentPath: 'docs/BALANCE_DESIGN.md',
        sectionId: 'balance',
        sourcePointer: `/bytes/${offset}/${offset + Buffer.byteLength(literal)}`,
        literal,
      })
      offset += Buffer.byteLength(bytes)
    }
  }
  return records.sort((left, right) =>
    `${left.subject}\0${left.sourcePointer}\0${left.literal}`.localeCompare(
      `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
    ),
  )
}

describe('Phase 4 Gameplay and Balance cross-domain completion gate', () => {
  test('builds a deterministic pair from one READY authority and closes typed references in both directions', () => {
    const first = sourcePair()
    const second = sourcePair()
    expect(first.gameplay.authoritySectionIndex).toEqual(
      first.balance.authoritySectionIndex,
    )
    expect(first.gameplay.authoritySectionIndex).toEqual(
      second.gameplay.authoritySectionIndex,
    )
    expect(first.gameplay.sourceDigest).toBe(second.gameplay.sourceDigest)
    expect(first.balance.sourceDigest).toBe(second.balance.sourceDigest)

    const gameplayMechanical = emptyMechanical(first.gameplay)
    const gameplayPacket = buildGameplaySemanticPacket({
      source: first.gameplay,
      mechanical: gameplayMechanical,
    })
    const gameplaySemantic = admitGameplaySemanticResult(gameplayPacket, {
      nodes: gameplayNodes,
      sourceClaims: gameplayClaims(),
    })
    const balanceTargets = new Map([
      [
        'balance.player-hp',
        {
          id: 'balance.player-hp',
          kind: 'balance.variable',
          value: { label: 'Player HP', baseline: 100, unitReferenceIndex: 0 },
          references: [
            { targetId: 'balance.unit.hp', targetType: 'balance.unit' },
          ],
          edges: [],
          bindings: {},
          producerMode: 'semantic' as const,
        },
      ],
    ])
    const gameplay = assembleGameplayModule({
      source: first.gameplay,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic,
      externalTargets: balanceTargets,
    })

    const balanceMechanical = emptyMechanical(first.balance)
    const balancePacket = buildBalanceSemanticPacket({
      source: first.balance,
      mechanical: balanceMechanical,
    })
    const balanceSemantic = admitBalanceSemanticResult(balancePacket, {
      nodes: balanceNodes,
      sourceClaims: balanceClaims(),
    })
    const balance = assembleBalanceModule({
      source: first.balance,
      mechanical: balanceMechanical,
      semantic: balanceSemantic,
      gameplay,
    })
    const boundGameplay = assembleGameplayModule({
      source: first.gameplay,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic,
      externalTargets: new Map(
        balance.module.nodes.map(node => [node.id, node]),
      ),
    })
    const boundBalance = assembleBalanceModule({
      source: first.balance,
      mechanical: balanceMechanical,
      semantic: balanceSemantic,
      gameplay: boundGameplay,
    })
    expect(boundGameplay.projectionDigest).toBe(gameplay.projectionDigest)
    expect(boundBalance.projectionDigest).toBe(balance.projectionDigest)
    expect(() =>
      admitGameplaySemanticResult(gameplayPacket, {
        nodes: [{ ...gameplayNodes[0], kind: 'world-scene.entity' }],
        sourceClaims: [],
      }),
    ).toThrow(/unknown Gameplay kind/)
    expect(
      gameplay.module.nodes.find(node => node.id === 'condition.has-health')
        ?.references[0]?.targetType,
    ).toBe('balance.variable')
    expect(
      balance.module.nodes
        .find(node => node.id === 'balance.binding.finish')
        ?.edges.at(-1)?.targetType,
    ).toBe('gameplay.action')

    const repeatGameplay = assembleGameplayModule({
      source: first.gameplay,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic,
      externalTargets: balanceTargets,
    })
    const repeatBalance = assembleBalanceModule({
      source: first.balance,
      mechanical: balanceMechanical,
      semantic: balanceSemantic,
      gameplay,
    })
    expect(gameplay.projectionDigest).toBe(repeatGameplay.projectionDigest)
    expect(balance.projectionDigest).toBe(repeatBalance.projectionDigest)

    expect(() =>
      assembleGameplayModule({
        source: first.gameplay,
        mechanical: gameplayMechanical,
        semantic: gameplaySemantic,
        externalTargets: new Map([
          ['balance.player-hp', { ...gameplay.module.nodes[0]! }],
        ]),
      }),
    ).toThrow(/external target/)
    expect(() =>
      assembleBalanceModule({
        source: first.balance,
        mechanical: balanceMechanical,
        semantic: balanceSemantic,
        gameplay: { ...gameplay, taskId: 'stale-task' },
      }),
    ).toThrow(/stale or relabeled/)
    expect(() =>
      assembleBalanceModule({
        source: first.balance,
        mechanical: balanceMechanical,
        semantic: balanceSemantic,
        gameplay: {
          ...gameplay,
          module: { ...gameplay.module, moduleId: 'balance' as 'gameplay' },
        },
      }),
    ).toThrow(/stale or relabeled|module ID|digest/)
  })
})
