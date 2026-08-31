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

function source(
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation' = 'balance',
): GameIrDomainSourceEnvelope {
  const bytes = 'bytes'
  const sectionIndex: readonly GameIrSourceSection[] =
    CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `section-${index}`,
      heading: `Section ${index}`,
      startLine: 1,
      endLine: 1,
      digest: createHash('sha256').update(bytes).digest('hex'),
    }))
  const foundationWithoutDigest: Omit<FoundationReadyReceipt, 'receiptDigest'> =
    {
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
    moduleId,
    request,
    sectionIndex,
    sectionBytes: Object.fromEntries(
      (moduleId === 'balance'
        ? ['docs/BALANCE_DESIGN.md', 'docs/GDD.md']
        : moduleId === 'gameplay'
          ? ['docs/GDD.md']
          : moduleId === 'world-scene'
            ? ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md']
            : [
                'docs/GDD.md',
                'docs/ART_DIRECTION.md',
                'docs/UI_UX_SPEC.md',
                'docs/AUDIO_DESIGN.md',
              ]
      ).map(documentPath => {
        const index = CANONICAL_FOUNDATION_DOCUMENTS.indexOf(
          documentPath as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
        )
        return [`${documentPath}#section-${index}`, bytes]
      }),
    ),
  })
}

function receipt(overrides: Partial<GameIrMechanicalProjectionReceipt> = {}) {
  const currentSource = source()
  const base = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: currentSource.taskId,
    moduleId: currentSource.moduleId,
    foundationRevision:
      currentSource.compileRequest.foundation.foundationRevision,
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
    receiptDigest: createHash('sha256')
      .update(canonical(withoutDigest))
      .digest('hex'),
  }
}

describe('Game IR domain producer contracts', () => {
  test('admits a valid empty mechanical receipt', () => {
    const admitted = admitGameIrMechanicalProjectionReceipt({
      source: source(),
      receipt: receipt(),
    })
    expect(admitted.nodes).toEqual([])
    expect(admitted.verifiedClaims).toEqual([])
    expect(admitted.ownedTargets).toEqual([])
    expect(Object.isFrozen(admitted)).toBe(true)
  })

  test('rejects all Gameplay and Balance mechanical nodes and verified claims', () => {
    const gameplaySource = source('gameplay')
    const gameplayReceipt = receipt({
      taskId: gameplaySource.taskId,
      moduleId: 'gameplay',
      sourceDigest: gameplaySource.sourceDigest,
      nodes: [{ ...mechanicalNode, kind: 'gameplay.entity' }] as never,
      ownedTargets: [
        'node:balance.var.hp#/id',
        'node:balance.var.hp#/value/baseline',
      ],
    })
    expect(() =>
      admitGameIrMechanicalProjectionReceipt({
        source: gameplaySource,
        receipt: gameplayReceipt,
      }),
    ).toThrow(/mechanical.*empty|unauthorized/i)

    expect(() =>
      admitGameIrMechanicalProjectionReceipt({
        source: source(),
        receipt: receipt({
          verifiedClaims: [
            {
              subject: 'node:balance.var.hp#/value/baseline',
              sourcePointer: '/bytes/0/1',
              literal: '1',
            },
          ],
        }),
      }),
    ).toThrow(/mechanical.*empty|unauthorized/i)
  })

  test('accepts empty mechanical receipts for every isolated domain', () => {
    for (const moduleId of [
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
    ] as const) {
      const currentSource = source(moduleId)
      const admitted = admitGameIrMechanicalProjectionReceipt({
        source: currentSource,
        receipt: receipt({
          taskId: currentSource.taskId,
          moduleId,
          sourceDigest: currentSource.sourceDigest,
        }),
      })
      expect(admitted.nodes).toEqual([])
      expect(admitted.verifiedClaims).toEqual([])
      expect(admitted.ownedTargets).toEqual([])
    }
  })

  test('rejects legacy positional mechanical and semantic packet calls', () => {
    expect(() =>
      (
        admitGameIrMechanicalProjectionReceipt as (
          ...args: unknown[]
        ) => unknown
      )(source(), receipt()),
    ).toThrow(/input|plain object|unknown|missing/i)
    const mechanical = admitGameIrMechanicalProjectionReceipt({
      source: source(),
      receipt: receipt(),
    })
    expect(() =>
      (buildGameIrDomainSemanticPacket as (...args: unknown[]) => unknown)(
        source(),
        mechanical,
      ),
    ).toThrow(/input|plain object|unknown|missing/i)
  })

  test('rejects stale task, revision, or source identity', () => {
    for (const overrides of [
      { taskId: 'other-task' },
      { foundationRevision: 'other-revision' },
      { sourceDigest: 'b'.repeat(64) },
    ]) {
      expect(() =>
        admitGameIrMechanicalProjectionReceipt({
          source: source(),
          receipt: receipt(overrides),
        }),
      ).toThrow(/task|revision|source|digest/i)
    }
  })

  test('rejects duplicate or unsorted owned targets', () => {
    for (const targets of [
      ['z', 'z'],
      ['z', 'a'],
    ]) {
      expect(() =>
        admitGameIrMechanicalProjectionReceipt({
          source: source(),
          receipt: receipt({ ownedTargets: targets }),
        }),
      ).toThrow(/target|duplicate|sorted|unique/i)
    }
  })

  test('rejects semantic packets that relabel source identity or mechanical ownership', () => {
    const mechanical = admitGameIrMechanicalProjectionReceipt({
      source: source(),
      receipt: receipt(),
    })
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
