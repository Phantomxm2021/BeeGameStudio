import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitPhase5SemanticResult,
  replayAndBindPhase5SemanticReceipt,
  type Phase5SemanticReceipt,
} from './phase5-admission'
import {
  admitGameIrMechanicalProjectionReceipt,
  buildGameIrDomainSemanticPacket,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  canonicalGameIrJson,
  digestGameIrValue,
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
import { digestSectionIndex } from '../foundation-section-index'

const digest = 'a'.repeat(64)

function source(bytes = 'bytes'): GameIrDomainSourceEnvelope {
  const sectionIndex: readonly GameIrSourceSection[] =
    CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `section-${index}`,
      heading: `Section ${index}`,
      startLine: 1,
      endLine: 1,
      digest: createHash('sha256').update(bytes).digest('hex'),
    }))
  const foundation: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
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
  const requestBody: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundation,
      receiptDigest: digestGameIrValue(foundation),
    },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'world-scene',
    request: requestBody,
    sectionIndex,
    sectionBytes: Object.fromEntries(
      ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'].map(path => [
        `${path}#section-${CANONICAL_FOUNDATION_DOCUMENTS.indexOf(path as FoundationDocumentPath)}`,
        bytes,
      ]),
    ),
  })
}

function mechanical(currentSource = source()) {
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

function packet(currentSource = source()) {
  const currentMechanical = mechanical(currentSource)
  return buildGameIrDomainSemanticPacket({
    source: currentSource,
    mechanical: currentMechanical,
    allowedNodeKinds: ['world-scene.scene'],
    allowedRelationshipTypes: ['root'],
  })
}

function projected(
  currentSource = source(),
  currentPacket = packet(currentSource),
): Phase5SemanticReceipt {
  const result = admitPhase5SemanticResult(currentPacket, {
    outcome: 'PROJECTED',
    nodes: [
      {
        id: 'bytes',
        kind: 'world-scene.scene',
        value: { label: 'bytes' },
        references: [],
        edges: [],
      },
    ],
    sourceClaims: [
      {
        subject: 'node:bytes#/id',
        documentPath: 'docs/GDD.md',
        sectionId: 'section-0',
        sourcePointer: '/bytes/0/5',
        literal: 'bytes',
      },
      {
        subject: 'node:bytes#/value/label',
        documentPath: 'docs/GDD.md',
        sectionId: 'section-0',
        sourcePointer: '/bytes/0/5',
        literal: 'bytes',
      },
    ],
  })
  if ('reasonCode' in result) throw new Error('expected projected receipt')
  return result
}

describe('shared Phase 5 admission', () => {
  test('admits identity-injected semantic nodes and exact source claims', () => {
    const currentSource = source()
    const receipt = projected(currentSource)
    expect(receipt.moduleId).toBe('world-scene')
    expect(receipt.nodes[0]?.producerMode).toBe('semantic')
    expect(receipt.nodes[0]).not.toHaveProperty('bindings')
    expect(Object.isFrozen(receipt)).toBe(true)

    const bound = replayAndBindPhase5SemanticReceipt({
      source: currentSource,
      mechanical: mechanical(currentSource),
      packet: packet(currentSource),
      semantic: receipt,
    })
    expect(bound.module.nodes[0]?.bindings['/id']?.kind).toBe('owner')
    expect(Object.isFrozen(bound.module)).toBe(true)
  })

  test('rejects worker identity or binding fields', () => {
    expect(() =>
      admitPhase5SemanticResult(packet(), {
        outcome: 'PROJECTED',
        nodes: [
          {
            id: 'bytes',
            kind: 'world-scene.scene',
            producerMode: 'semantic',
            value: { label: 'bytes' },
            references: [],
            edges: [],
            bindings: {},
          },
        ],
        sourceClaims: [],
      }),
    ).toThrow(/unknown|missing|producerMode|binding/i)
  })

  test('rejects a byte-valid but semantically contrary edge literal', () => {
    const bytes =
      'bytes{}{"type":"root","targetId":"target","targetType":"world-scene.node"}'
    const currentSource = source(bytes)
    const currentPacket = packet(currentSource)
    const base = admitPhase5SemanticResult(currentPacket, {
      outcome: 'PROJECTED',
      nodes: [
        {
          id: 'bytes',
          kind: 'world-scene.scene',
          value: {},
          references: [],
          edges: [
            {
              type: 'root',
              targetId: 'target',
              targetType: 'world-scene.node',
            },
          ],
        },
      ],
      sourceClaims: [
        {
          subject: 'node:bytes#/edges/0',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/7/80',
          literal:
            '{"targetId":"target","targetType":"world-scene.node","type":"root"}',
        },
        {
          subject: 'node:bytes#/id',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/0/5',
          literal: 'bytes',
        },
        {
          subject: 'node:bytes#/value',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/5/7',
          literal: '{}',
        },
      ],
    })
    if ('reasonCode' in base) throw new Error('expected projected receipt')
    const tamperedNode = {
      ...base.nodes[0]!,
      edges: [{ ...base.nodes[0]!.edges[0]!, type: 'other' }],
    }
    const tamperedBody = { ...base, nodes: [tamperedNode] }
    const { receiptDigest: _ignored, ...withoutDigest } = tamperedBody
    const tampered = {
      ...tamperedBody,
      receiptDigest: digestGameIrValue(withoutDigest),
    }
    expect(() =>
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: currentPacket,
        semantic: tampered as Phase5SemanticReceipt,
      }),
    ).toThrow(/literal|semantic|edge|does not match/i)
  })

  test('rejects relabeled Phase 5 packets', () => {
    const currentPacket = packet()
    expect(() =>
      admitPhase5SemanticResult(
        { ...currentPacket, moduleId: 'presentation' },
        {
          outcome: 'FAIL',
          reasonCode: 'missing-projection',
          actual: 'x',
          missingSubject: 'node:bytes#/id',
          expectedProjection: 'x',
          evidencePointers: ['section:docs/GDD.md#section-0@' + 'a'.repeat(64)],
        },
      ),
    ).toThrow(/digest|identity|packet|module/i)
  })
})
