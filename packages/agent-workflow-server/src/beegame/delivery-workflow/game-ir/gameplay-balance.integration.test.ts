import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitGameIrMechanicalProjectionReceipt,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import { buildGameIrDomainSourceEnvelope } from './domain-source'
import {
  admitGameplaySemanticResult,
  buildGameplaySemanticPacket,
} from './gameplay-producer'
import {
  admitBalanceSemanticResult,
  buildBalanceSemanticPacket,
} from './balance-producer'
import { assembleGameplayBalanceModules } from './gameplay-balance-assembler'
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
  canonicalGameIrJson,
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

function readyRequest(
  overrides: Readonly<{
    taskId?: string
    foundationRevision?: string
    reviewDigest?: string
  }> = {},
): GameIrCompileRequest {
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
    foundationRevision: overrides.foundationRevision ?? 'foundation-ready-1',
    confirmedBriefDigest: sha256('brief'),
    documentDigests,
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(fullIndex),
    authority: {
      kind: 'review',
      reviewDigest: overrides.reviewDigest ?? sha256('review'),
      issueRegistryDigest: sha256('issues'),
    },
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: overrides.taskId ?? 'phase-4-gate-task',
    publicationId: 'phase-4-gate-publication',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundationBody,
      receiptDigest: digestGameIrValue(foundationBody),
    },
  }
}

function sourcePair(request = readyRequest()) {
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
  return admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: {
      ...body,
      receiptDigest: digestGameIrValue(body),
    },
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

function pairInputs(
  sources = sourcePair(),
  overrides: Readonly<{
    gameplayNodes?: readonly Record<string, unknown>[]
    balanceNodes?: readonly Record<string, unknown>[]
  }> = {},
) {
  const gameplayMechanical = emptyMechanical(sources.gameplay)
  const balanceMechanical = emptyMechanical(sources.balance)
  const gameplayPacket = buildGameplaySemanticPacket({
    source: sources.gameplay,
    mechanical: gameplayMechanical,
  })
  const balancePacket = buildBalanceSemanticPacket({
    source: sources.balance,
    mechanical: balanceMechanical,
  })
  const gameplaySemantic = admitGameplaySemanticResult(gameplayPacket, {
    outcome: 'PROJECTED',
    nodes: overrides.gameplayNodes ?? gameplayNodes,
    sourceClaims: gameplayClaims(),
  })
  const balanceSemantic = admitBalanceSemanticResult(balancePacket, {
    outcome: 'PROJECTED',
    nodes: overrides.balanceNodes ?? balanceNodes,
    sourceClaims: balanceClaims(),
  })
  return {
    gameplay: {
      source: sources.gameplay,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic,
    },
    balance: {
      source: sources.balance,
      mechanical: balanceMechanical,
      semantic: balanceSemantic,
    },
  }
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

    const inputs = pairInputs(first)
    const pair = assembleGameplayBalanceModules(inputs)
    const { gameplay, balance } = pair
    expect(
      canonicalGameIrJson({
        gameplay: gameplay.module,
        balance: balance.module,
      }),
    ).toMatchInlineSnapshot(
      `"{"balance":{"moduleId":"balance","nodes":[{"bindings":{"/edges/0":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/222/241"},"/edges/1":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/242/263"},"/edges/2":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/264/277"},"/id":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/278/300"},"/references/0":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/301/314"},"/references/1":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/315/334"},"/references/2":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/335/356"},"/value/label":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/357/371"}},"edges":[{"targetId":"balance.cost.finish","targetType":"balance.cost","type":"cost"},{"targetId":"balance.reward.finish","targetType":"balance.reward","type":"reward"},{"targetId":"action.finish","targetType":"gameplay.action","type":"triggered-by"}],"id":"balance.binding.finish","kind":"balance.reward-cost-binding","producerMode":"semantic","references":[{"targetId":"action.finish","targetType":"gameplay.action"},{"targetId":"balance.cost.finish","targetType":"balance.cost"},{"targetId":"balance.reward.finish","targetType":"balance.reward"}],"value":{"label":"Finish binding"}},{"bindings":{"/edges/0":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/154/171"},"/id":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/172/191"},"/references/0":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/192/209"},"/value/label":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/210/221"}},"edges":[{"targetId":"balance.player-hp","targetType":"balance.variable","type":"amount"}],"id":"balance.cost.finish","kind":"balance.cost","producerMode":"semantic","references":[{"targetId":"balance.player-hp","targetType":"balance.variable"}],"value":{"label":"Finish cost"}},{"bindings":{"/id":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/32/49"},"/references/0":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/50/65"},"/value/baseline":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/66/69"},"/value/label":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/70/79"},"/value/unitReferenceIndex":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/80/81"}},"edges":[],"id":"balance.player-hp","kind":"balance.variable","producerMode":"semantic","references":[{"targetId":"balance.unit.hp","targetType":"balance.unit"}],"value":{"baseline":100,"label":"Player HP","unitReferenceIndex":0}},{"bindings":{"/edges/0":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/82/99"},"/id":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/100/121"},"/references/0":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/122/139"},"/value/label":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/140/153"}},"edges":[{"targetId":"balance.player-hp","targetType":"balance.variable","type":"amount"}],"id":"balance.reward.finish","kind":"balance.reward","producerMode":"semantic","references":[{"targetId":"balance.player-hp","targetType":"balance.variable"}],"value":{"label":"Finish reward"}},{"bindings":{"/id":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/0/15"},"/value/dimensions/0/base":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/16/22"},"/value/dimensions/0/exponent":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/23/24"},"/value/scale/denominator":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/25/26"},"/value/scale/numerator":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/27/28"},"/value/symbol":{"documentPath":"docs/BALANCE_DESIGN.md","kind":"owner","sectionDigest":"f89505504b48cc2d97ce5d8b6c86a1830466730b0ba96fc54c0ae2ee11ec82a9","sectionId":"balance","sourcePointer":"/bytes/29/31"}},"edges":[],"id":"balance.unit.hp","kind":"balance.unit","producerMode":"semantic","references":[],"value":{"dimensions":[{"base":"health","exponent":1}],"scale":{"denominator":1,"numerator":1},"symbol":"hp"}}]},"gameplay":{"moduleId":"gameplay","nodes":[{"bindings":{"/edges/0":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/action.finish/edge/0"},"/edges/1":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/action.finish/edge/1"},"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/action.finish"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/action.finish/value/label"}},"edges":[{"targetId":"effect.spend-health","targetType":"gameplay.effect","type":"causes"},{"targetId":"condition.has-health","targetType":"gameplay.condition","type":"requires"}],"id":"action.finish","kind":"gameplay.action","producerMode":"semantic","references":[],"value":{"label":"Finish"}},{"bindings":{"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health"},"/references/0":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health/reference/0"},"/value/expression/kind":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health/value/expression/kind"},"/value/expression/left/kind":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health/value/expression/left/kind"},"/value/expression/left/referenceIndex":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health/value/expression/left/referenceIndex"},"/value/expression/operator":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health/value/expression/operator"},"/value/expression/right/kind":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health/value/expression/right/kind"},"/value/expression/right/value":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/condition.has-health/value/expression/right/value"}},"edges":[],"id":"condition.has-health","kind":"gameplay.condition","producerMode":"semantic","references":[{"targetId":"balance.player-hp","targetType":"balance.variable"}],"value":{"expression":{"kind":"compare","left":{"kind":"reference","referenceIndex":0},"operator":"gt","right":{"kind":"literal","value":0}}}},{"bindings":{"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/effect.spend-health"},"/references/0":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/effect.spend-health/reference/0"},"/value/effect/operation":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/effect.spend-health/value/effect/operation"},"/value/effect/targetReferenceIndex":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/effect.spend-health/value/effect/targetReferenceIndex"},"/value/effect/value":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/effect.spend-health/value/effect/value"}},"edges":[],"id":"effect.spend-health","kind":"gameplay.effect","producerMode":"semantic","references":[{"targetId":"balance.player-hp","targetType":"balance.variable"}],"value":{"effect":{"operation":"add","targetReferenceIndex":0,"value":-1}}},{"bindings":{"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/entity.player"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/entity.player/value/label"}},"edges":[],"id":"entity.player","kind":"gameplay.entity","producerMode":"semantic","references":[],"value":{"label":"Player"}},{"bindings":{"/edges/0":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/objective.finish/edge/0"},"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/objective.finish"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/objective.finish/value/label"}},"edges":[{"targetId":"outcome.win","targetType":"gameplay.outcome","type":"succeeds-with"}],"id":"objective.finish","kind":"gameplay.objective","producerMode":"semantic","references":[],"value":{"label":"Finish objective"}},{"bindings":{"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/outcome.win"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/outcome.win/value/label"},"/value/result":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/outcome.win/value/result"}},"edges":[],"id":"outcome.win","kind":"gameplay.outcome","producerMode":"semantic","references":[],"value":{"label":"Win","result":"win"}},{"bindings":{"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.done"},"/value/initial":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.done/value/initial"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.done/value/label"},"/value/terminal":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.done/value/terminal"}},"edges":[],"id":"state.done","kind":"gameplay.state","producerMode":"semantic","references":[],"value":{"initial":false,"label":"Done","terminal":"success"}},{"bindings":{"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.start"},"/value/initial":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.start/value/initial"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.start/value/label"},"/value/terminal":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/state.start/value/terminal"}},"edges":[],"id":"state.start","kind":"gameplay.state","producerMode":"semantic","references":[],"value":{"initial":true,"label":"Start","terminal":"none"}},{"bindings":{"/edges/0":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/transition.finish/edge/0"},"/edges/1":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/transition.finish/edge/1"},"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/transition.finish"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"b5f0780838455b5588352b190803ad6f38505bd5d4ba579a99c3cbe67f76d609","sectionId":"gameplay","sourcePointer":"/gameplay/transition.finish/value/label"}},"edges":[{"targetId":"state.start","targetType":"gameplay.state","type":"from"},{"targetId":"state.done","targetType":"gameplay.state","type":"to"}],"id":"transition.finish","kind":"gameplay.transition","producerMode":"semantic","references":[],"value":{"label":"Finish"}}]}}"`,
    )
    expect({
      gameplay: gameplay.projectionDigest,
      balance: balance.projectionDigest,
    }).toMatchInlineSnapshot(`
      {
        "balance": "e2035eff722ad671ef497e36887c6c1e43d337ccdd8c6d1a1d03282e88109acf",
        "gameplay": "e5a1b06ea5bace61ab6e165537165e2844f936584a0eb49062df53b6099cce9a",
      }
    `)
    expect(() =>
      admitGameplaySemanticResult(
        buildGameplaySemanticPacket({
          source: inputs.gameplay.source,
          mechanical: inputs.gameplay.mechanical,
        }),
        {
          outcome: 'PROJECTED',
          nodes: [{ ...gameplayNodes[0], kind: 'world-scene.entity' }],
          sourceClaims: [],
        },
      ),
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

    const repeat = assembleGameplayBalanceModules(inputs)
    expect(gameplay.projectionDigest).toBe(repeat.gameplay.projectionDigest)
    expect(balance.projectionDigest).toBe(repeat.balance.projectionDigest)

    expect(() =>
      (assembleGameplayBalanceModules as (...args: unknown[]) => unknown)({
        gameplay: {
          source: first.gameplay,
          mechanical: inputs.gameplay.mechanical,
          semantic: inputs.gameplay.semantic,
        },
        balance: new Map([['balance.player-hp', balance.module.nodes[0]!]]),
      }),
    ).toThrow(/balance|input|plain object|field/i)
    expect(() =>
      assembleGameplayBalanceModules({
        gameplay: {
          source: first.gameplay,
          mechanical: inputs.gameplay.mechanical,
          semantic: inputs.gameplay.semantic,
        },
        balance: {
          source: { ...first.balance, taskId: 'stale-task' },
          mechanical: inputs.balance.mechanical,
          semantic: inputs.balance.semantic,
        },
      }),
    ).toThrow(/task|stale|identity|source/i)
    expect(() =>
      assembleGameplayBalanceModules({
        gameplay: {
          source: first.gameplay,
          mechanical: inputs.gameplay.mechanical,
          semantic: inputs.gameplay.semantic,
        },
        balance: {
          source: sourcePair().balance,
          mechanical: inputs.balance.mechanical,
          semantic: { ...inputs.balance.semantic, taskId: 'stale-task' },
        },
      }),
    ).toThrow(/stale|identity|task|receipt/i)
  })

  test('revalidates both typed maps and one exact task, revision, and READY identity on every call', () => {
    const baseline = pairInputs()
    const otherTask = pairInputs(
      sourcePair(readyRequest({ taskId: 'other-task' })),
    )
    expect(() =>
      assembleGameplayBalanceModules({
        gameplay: baseline.gameplay,
        balance: otherTask.balance,
      }),
    ).toThrow(/same taskId|task/i)

    const otherRevision = pairInputs(
      sourcePair(readyRequest({ foundationRevision: 'other-revision' })),
    )
    expect(() =>
      assembleGameplayBalanceModules({
        gameplay: baseline.gameplay,
        balance: otherRevision.balance,
      }),
    ).toThrow(/Foundation revision|revision/i)

    const otherReady = pairInputs(
      sourcePair(readyRequest({ reviewDigest: sha256('other-review') })),
    )
    expect(() =>
      assembleGameplayBalanceModules({
        gameplay: baseline.gameplay,
        balance: otherReady.balance,
      }),
    ).toThrow(/READY source identity/i)

    const wrongGameplayNodes = gameplayNodes.map(node => ({
      ...node,
      references: node.references.map(reference =>
        reference.targetId === 'balance.player-hp'
          ? { ...reference, targetType: 'balance.parameter' }
          : reference,
      ),
      edges: node.edges.map(edge => ({ ...edge })),
    }))
    expect(() =>
      assembleGameplayBalanceModules(
        pairInputs(sourcePair(), { gameplayNodes: wrongGameplayNodes }),
      ),
    ).toThrow(/kind|target|reference/i)

    const wrongBalanceNodes = balanceNodes.map(node => ({
      ...node,
      references: node.references.map(reference =>
        reference.targetId === 'action.finish'
          ? { ...reference, targetType: 'gameplay.event' }
          : reference,
      ),
      edges: node.edges.map(edge =>
        edge.targetId === 'action.finish'
          ? { ...edge, targetType: 'gameplay.event' }
          : edge,
      ),
    }))
    expect(() =>
      assembleGameplayBalanceModules(
        pairInputs(sourcePair(), { balanceNodes: wrongBalanceNodes }),
      ),
    ).toThrow(/kind|target|reference/i)

    expect(() =>
      assembleGameplayBalanceModules({
        ...baseline,
        gameplay: {
          ...baseline.gameplay,
          semantic: {
            ...baseline.gameplay.semantic,
            nodes: [...baseline.gameplay.semantic.nodes].reverse(),
          },
        },
      }),
    ).toThrow(/canonical|receipt|digest/i)
  })
})
