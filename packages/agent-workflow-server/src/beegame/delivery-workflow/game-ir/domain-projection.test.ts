import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitGameIrMechanicalProjectionReceipt,
  assertDisjointDomainTargets,
  buildGameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import { type GameIrSourceSection } from './model'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'

const digest = 'a'.repeat(64)

const mechanicalNode = {
  id: 'balance.var.hp',
  kind: 'balance.variable',
  producerMode: 'mechanical' as const,
  value: { baseline: 10 },
  references: [],
  edges: [],
  bindings: {
    '/id': {
      kind: 'owner' as const,
      documentPath: 'docs/GDD.md' as const,
      sectionId: 'section-0',
      sectionDigest: createHash('sha256').update('bytes').digest('hex'),
      sourcePointer: '/balance/variables/hp',
    },
    '/value/baseline': {
      kind: 'owner' as const,
      documentPath: 'docs/GDD.md' as const,
      sectionId: 'section-0',
      sectionDigest: createHash('sha256').update('bytes').digest('hex'),
      sourcePointer: '/balance/variables/hp/baseline',
    },
  },
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function source(): GameIrDomainSourceEnvelope {
  const bytes = 'bytes'
  const sectionIndex: readonly GameIrSourceSection[] = CANONICAL_FOUNDATION_DOCUMENTS.map(
    (documentPath, index) => ({
      documentPath,
      sectionId: `section-${index}`,
      heading: `Section ${index}`,
      startLine: 1,
      endLine: 1,
      digest: createHash('sha256').update(bytes).digest('hex'),
    }),
  )
  const foundationWithoutDigest: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'revision-1',
    confirmedBriefDigest: digest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    authority: {
      kind: 'review',
      reviewDigest: digest,
      issueRegistryDigest: digest,
    },
  }
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundationWithoutDigest,
      receiptDigest: createHash('sha256')
        .update(canonical(foundationWithoutDigest))
        .digest('hex'),
    },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'balance',
    request,
    sectionIndex,
    sectionBytes: {
      'docs/BALANCE_DESIGN.md#section-2': bytes,
      'docs/GDD.md#section-0': bytes,
    },
  })
}

function receipt(overrides: Partial<GameIrMechanicalProjectionReceipt> = {}) {
  const currentSource = source()
  const base = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: currentSource.taskId,
    moduleId: currentSource.moduleId,
    foundationRevision: currentSource.compileRequest.foundation.foundationRevision,
    sourceDigest: currentSource.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
    receiptDigest: digest,
  }
  const value = { ...base, ...overrides }
  const { receiptDigest: _ignored, ...withoutDigest } = value
  return {
    ...value,
    receiptDigest: createHash('sha256').update(canonical(withoutDigest)).digest('hex'),
  }
}

describe('Game IR domain producer contracts', () => {
  test('admits a valid empty mechanical receipt', () => {
    const admitted = admitGameIrMechanicalProjectionReceipt(
      source(),
      receipt(),
    )
    expect(admitted.nodes).toEqual([])
    expect(admitted.verifiedClaims).toEqual([])
    expect(admitted.ownedTargets).toEqual([])
    expect(Object.isFrozen(admitted)).toBe(true)
  })

  test('rejects stale task, revision, or source identity', () => {
    for (const overrides of [
      { taskId: 'other-task' },
      { foundationRevision: 'other-revision' },
      { sourceDigest: 'b'.repeat(64) },
    ]) {
      expect(() =>
        admitGameIrMechanicalProjectionReceipt(source(), receipt(overrides)),
      ).toThrow(/task|revision|source|digest/i)
    }
  })

  test('rejects duplicate or unsorted owned targets', () => {
    for (const targets of [
      ['z', 'z'],
      ['z', 'a'],
    ]) {
      expect(() =>
        admitGameIrMechanicalProjectionReceipt(
          source(),
          receipt({ ownedTargets: targets }),
        ),
      ).toThrow(/target|duplicate|sorted|unique/i)
    }
  })

  test('rejects incomplete node-to-target ownership accounting', () => {
    expect(() =>
      admitGameIrMechanicalProjectionReceipt(
          source(),
          receipt({ nodes: [mechanicalNode] as never, ownedTargets: [] }),
      ),
    ).toThrow(/owned|target|account/i)
  })

  test('rejects malformed nested node references, edges, and bindings', () => {
    const nodeVariants = [
      {
        ...mechanicalNode,
        references: [{ targetId: 'bad' }],
        bindings: {
          ...mechanicalNode.bindings,
          '/references/0': mechanicalNode.bindings['/id'],
        },
        ownedTargets: [
          'node:balance.var.hp#/id',
          'node:balance.var.hp#/references/0',
          'node:balance.var.hp#/value/baseline',
        ],
      },
      {
        ...mechanicalNode,
        edges: [{ type: 'depends-on', targetId: 'bad' }],
        bindings: {
          ...mechanicalNode.bindings,
          '/edges/0': mechanicalNode.bindings['/id'],
        },
        ownedTargets: [
          'node:balance.var.hp#/edges/0',
          'node:balance.var.hp#/id',
          'node:balance.var.hp#/value/baseline',
        ],
      },
      {
        ...mechanicalNode,
        bindings: { '/id': { kind: 'owner' } },
        ownedTargets: ['node:balance.var.hp#/id'],
      },
    ]
    for (const { ownedTargets, ...node } of nodeVariants) {
      expect(() =>
        admitGameIrMechanicalProjectionReceipt(
          source(),
          receipt({ nodes: [node] as never, ownedTargets }),
        ),
      ).toThrow(/invalid Game IR candidate: .*?(reference|edge|binding)/i)
    }
  })

  test('rejects noncanonical owned target spellings', () => {
    expect(() =>
      admitGameIrMechanicalProjectionReceipt(
        source(),
        receipt({
          nodes: [mechanicalNode] as never,
          ownedTargets: ['balance.var.hp#/value/baseline'],
        }),
      ),
    ).toThrow(/owned|target|canonical|account/i)
  })

  test('rejects semantic packets that relabel source identity or mechanical ownership', () => {
    const mechanical = admitGameIrMechanicalProjectionReceipt(
      source(),
      receipt({
        nodes: [mechanicalNode],
        ownedTargets: [
          'node:balance.var.hp#/id',
          'node:balance.var.hp#/value/baseline',
        ],
      }),
    )
    const packet = buildGameIrDomainSemanticPacket({
      source: source(),
      mechanical,
      allowedNodeKinds: ['balance.variable'],
      allowedRelationshipTypes: ['balance.depends-on'],
    })
    expect(packet.taskId).toBe(source().taskId)
    expect(packet.moduleId).toBe(source().moduleId)
    expect(packet.forbiddenTargets).toEqual(mechanical.ownedTargets)
    expect(Object.isFrozen(packet)).toBe(true)
    expect(() =>
      buildGameIrDomainSemanticPacket({
        source: { ...source(), taskId: 'relabeled-task' },
        mechanical,
      }),
    ).toThrow(/task|identity|source/i)
  })

  test('rejects overlap even when values are identical', () => {
    expect(() =>
      assertDisjointDomainTargets(
        ['node:balance.var.hp#/value/baseline'],
        ['node:balance.var.hp#/value/baseline'],
      ),
    ).toThrow(/overlap/i)
  })
})
