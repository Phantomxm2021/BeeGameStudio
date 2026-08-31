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

function packet(
  currentSource = source(),
  allowedNodeKinds: readonly string[] = ['world-scene.scene'],
  allowedRelationshipTypes: readonly string[] = ['root'],
) {
  const currentMechanical = mechanical(currentSource)
  return buildGameIrDomainSemanticPacket({
    source: currentSource,
    mechanical: currentMechanical,
    allowedNodeKinds,
    allowedRelationshipTypes,
  })
}

function projected(
  currentSource = source(),
  currentPacket = packet(currentSource),
): Phase5SemanticReceipt {
  const result = admitPhase5SemanticResult(currentPacket, projectedInput())
  if ('reasonCode' in result) throw new Error('expected projected receipt')
  return result
}

function projectedInput() {
  return {
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
  } as const
}

function candidateInput(receipt: Phase5SemanticReceipt) {
  return {
    outcome: 'PROJECTED' as const,
    nodes: receipt.nodes.map(
      ({ producerMode: _producerMode, ...node }) => node,
    ),
    sourceClaims: receipt.sourceClaims,
  }
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

  test('rejects worker producerMode and bindings as independent mutations', () => {
    const validWorkerDto = projectedInput()
    expect(() =>
      admitPhase5SemanticResult(packet(), validWorkerDto),
    ).not.toThrow()
    for (const mutation of [{ producerMode: 'semantic' }, { bindings: {} }]) {
      expect(() =>
        admitPhase5SemanticResult(packet(), {
          ...validWorkerDto,
          nodes: [{ ...validWorkerDto.nodes[0], ...mutation }],
        }),
      ).toThrow(/unknown or missing fields/i)
    }
  })

  test('treats empty packet allow-lists as allow-none', () => {
    const currentSource = source()
    const emptyPacket = packet(currentSource, [], [])
    const emptyResult = admitPhase5SemanticResult(emptyPacket, {
      outcome: 'PROJECTED',
      nodes: [],
      sourceClaims: [],
    })
    if ('reasonCode' in emptyResult)
      throw new Error('expected projected receipt')
    expect(
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: emptyPacket,
        semantic: emptyResult,
      }).module.nodes,
    ).toEqual([])
    expect(() =>
      admitPhase5SemanticResult(emptyPacket, {
        outcome: 'PROJECTED',
        nodes: [
          {
            id: 'bytes',
            kind: 'world-scene.scene',
            value: {},
            references: [],
            edges: [],
          },
        ],
        sourceClaims: [],
      }),
    ).toThrow(/node kind|packet/i)

    const nodeOnlyPacket = packet(currentSource, ['world-scene.scene'], [])
    expect(() =>
      admitPhase5SemanticResult(nodeOnlyPacket, {
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
                targetId: 'bytes',
                targetType: 'world-scene.scene',
              },
            ],
          },
        ],
        sourceClaims: [],
      }),
    ).toThrow(/relationship type|packet/i)
  })

  test('rejects duplicate, omitted, or unsorted claim ownership after a valid baseline', () => {
    const currentSource = source()
    const currentPacket = packet(currentSource)
    const baseline = projected(currentSource, currentPacket)
    expect(
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: currentPacket,
        semantic: baseline,
      }).module.nodes,
    ).toHaveLength(1)
    const candidate = candidateInput(baseline)
    for (const claims of [
      [...candidate.sourceClaims, candidate.sourceClaims[0]],
      candidate.sourceClaims.slice(1),
      [...candidate.sourceClaims].reverse(),
    ]) {
      expect(() =>
        admitPhase5SemanticResult(currentPacket, {
          ...candidate,
          sourceClaims: claims,
        }),
      ).toThrow(/claim|target|sorted|unique/i)
    }
  })

  test('replays exact UTF-8 ranges and rejects every malformed range form', () => {
    const currentSource = source('bytesé')
    const currentPacket = packet(currentSource)
    const baselineInput = {
      outcome: 'PROJECTED' as const,
      nodes: [
        {
          id: 'bytes',
          kind: 'world-scene.scene',
          value: { label: 'é' },
          references: [],
          edges: [],
        },
      ],
      sourceClaims: [
        {
          subject: 'node:bytes#/id',
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'section-0',
          sourcePointer: '/bytes/0/5',
          literal: 'bytes',
        },
        {
          subject: 'node:bytes#/value/label',
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'section-0',
          sourcePointer: '/bytes/5/7',
          literal: 'é',
        },
      ],
    }
    const baseline = admitPhase5SemanticResult(currentPacket, baselineInput)
    if ('reasonCode' in baseline) throw new Error('expected projected receipt')
    expect(
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: currentPacket,
        semantic: baseline,
      }).module.nodes,
    ).toHaveLength(1)
    for (const sourcePointer of [
      '/bytes/00/5',
      '/bytes/-1/5',
      '/bytes/0/9007199254740992',
      '/bytes/0/0',
      '/bytes/5/0',
      '/bytes/0/999',
      '/bytes/5/6',
    ]) {
      const mutated = {
        ...baselineInput,
        sourceClaims: baselineInput.sourceClaims.map(claim =>
          claim.subject === 'node:bytes#/value/label'
            ? { ...claim, sourcePointer }
            : claim,
        ),
      }
      if (sourcePointer === '/bytes/0/999' || sourcePointer === '/bytes/5/6') {
        const admitted = admitPhase5SemanticResult(currentPacket, mutated)
        if ('reasonCode' in admitted) throw new Error('expected receipt')
        expect(() =>
          replayAndBindPhase5SemanticReceipt({
            source: currentSource,
            mechanical: mechanical(currentSource),
            packet: currentPacket,
            semantic: admitted,
          }),
        ).toThrow(/outside|bytes|range|UTF-8|boundar/i)
      } else {
        expect(() => admitPhase5SemanticResult(currentPacket, mutated)).toThrow(
          /range|pointer|byte/i,
        )
      }
    }
  })

  test('rejects primitive and node-ID literal mismatches', () => {
    const bytes = 'bytestrue1'
    const currentSource = source(bytes)
    const currentPacket = packet(currentSource)
    const validInput = {
      outcome: 'PROJECTED' as const,
      nodes: [
        {
          id: 'bytes',
          kind: 'world-scene.scene',
          value: { enabled: true, count: 1 },
          references: [],
          edges: [],
        },
      ],
      sourceClaims: [
        {
          subject: 'node:bytes#/id',
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'section-0',
          sourcePointer: '/bytes/0/5',
          literal: 'bytes',
        },
        {
          subject: 'node:bytes#/value/count',
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'section-0',
          sourcePointer: '/bytes/9/10',
          literal: '1',
        },
        {
          subject: 'node:bytes#/value/enabled',
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'section-0',
          sourcePointer: '/bytes/5/9',
          literal: 'true',
        },
      ],
    }
    const baseline = admitPhase5SemanticResult(currentPacket, validInput)
    if ('reasonCode' in baseline) throw new Error('expected projected receipt')
    expect(
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: currentPacket,
        semantic: baseline,
      }).module.nodes,
    ).toHaveLength(1)
    for (const [subject, literal] of [
      ['node:bytes#/id', 'other'],
      ['node:bytes#/value/count', '2'],
      ['node:bytes#/value/enabled', 'false'],
    ]) {
      expect(() =>
        admitPhase5SemanticResult(currentPacket, {
          ...validInput,
          sourceClaims: validInput.sourceClaims.map(claim =>
            claim.subject === subject ? { ...claim, literal } : claim,
          ),
        }),
      ).toThrow(/literal|semantic|match/i)
    }
  })

  test('rejects an independent string literal mismatch after valid replay', () => {
    const currentSource = source()
    const currentPacket = packet(currentSource)
    const baseline = projected(currentSource, currentPacket)
    expect(
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: currentPacket,
        semantic: baseline,
      }).module.nodes[0]?.value,
    ).toEqual({ label: 'bytes' })
    const tamperedBody = {
      ...baseline,
      nodes: [{ ...baseline.nodes[0]!, value: { label: 'other' } }],
    }
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
        semantic: tampered,
      }),
    ).toThrow(/source literal does not match the semantic record/i)
  })

  test('canonicalizes node order while requiring canonical claim order', () => {
    const bytes = 'alpha{}bytes{}'
    const currentSource = source(bytes)
    const currentPacket = packet(currentSource)
    const result = admitPhase5SemanticResult(currentPacket, {
      outcome: 'PROJECTED',
      nodes: [
        {
          id: 'bytes',
          kind: 'world-scene.scene',
          value: {},
          references: [],
          edges: [],
        },
        {
          id: 'alpha',
          kind: 'world-scene.scene',
          value: {},
          references: [],
          edges: [],
        },
      ],
      sourceClaims: [
        {
          subject: 'node:alpha#/id',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/0/5',
          literal: 'alpha',
        },
        {
          subject: 'node:alpha#/value',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/5/7',
          literal: '{}',
        },
        {
          subject: 'node:bytes#/id',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/7/12',
          literal: 'bytes',
        },
        {
          subject: 'node:bytes#/value',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/12/14',
          literal: '{}',
        },
      ],
    })
    if ('reasonCode' in result) throw new Error('expected projected receipt')
    expect(result.nodes.map(node => node.id)).toEqual(['alpha', 'bytes'])
    expect(() =>
      admitPhase5SemanticResult(currentPacket, {
        outcome: 'PROJECTED',
        nodes: result.nodes.map(
          ({ producerMode: _producerMode, ...node }) => node,
        ),
        sourceClaims: [...result.sourceClaims].reverse(),
      }),
    ).toThrow(/claim|sorted|target/i)
  })

  test('verifies reference target literals on receipt replay', () => {
    const referenceLiteral = canonicalGameIrJson({
      targetId: 'bytes',
      targetType: 'world-scene.scene',
    })
    const bytes = `bytes${referenceLiteral}{}`
    const currentSource = source(bytes)
    const currentPacket = packet(currentSource)
    const baseline = admitPhase5SemanticResult(currentPacket, {
      outcome: 'PROJECTED',
      nodes: [
        {
          id: 'bytes',
          kind: 'world-scene.scene',
          value: {},
          references: [{ targetId: 'bytes', targetType: 'world-scene.scene' }],
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
          subject: 'node:bytes#/references/0',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: `/bytes/5/${5 + Buffer.byteLength(referenceLiteral)}`,
          literal: referenceLiteral,
        },
        {
          subject: 'node:bytes#/value',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: `/bytes/${5 + Buffer.byteLength(referenceLiteral)}/${Buffer.byteLength(bytes)}`,
          literal: '{}',
        },
      ],
    })
    if ('reasonCode' in baseline) throw new Error('expected projected receipt')
    expect(
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: currentPacket,
        semantic: baseline,
      }).module.nodes[0]?.references,
    ).toEqual([{ targetId: 'bytes', targetType: 'world-scene.scene' }])
    const tamperedNode = {
      ...baseline.nodes[0]!,
      references: [{ targetId: 'other', targetType: 'world-scene.scene' }],
    }
    const tamperedBody = { ...baseline, nodes: [tamperedNode] }
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
    ).toThrow(/literal|reference|semantic|match/i)
  })

  test('rejects a recomputed packet relabel during source-bound replay', () => {
    const currentSource = source()
    const currentMechanical = mechanical(currentSource)
    const currentPacket = packet(currentSource)
    const baseline = projected(currentSource, currentPacket)
    const relabeledBody = {
      ...currentPacket,
      moduleId: 'presentation' as const,
    }
    const { packetDigest: _ignored, ...withoutDigest } = relabeledBody
    const relabeledPacket = {
      ...relabeledBody,
      packetDigest: digestGameIrValue(withoutDigest),
    }
    expect(() =>
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: currentMechanical,
        packet: relabeledPacket,
        semantic: baseline,
      }),
    ).toThrow(/packet|relabel|identity|source/i)
  })

  test('rejects hidden and accessor DTO fields', () => {
    const hiddenNode = {
      id: 'bytes',
      kind: 'world-scene.scene',
      value: {},
      references: [],
      edges: [],
    }
    Object.defineProperty(hiddenNode, 'workerBinding', {
      value: {},
      enumerable: false,
    })
    expect(() =>
      admitPhase5SemanticResult(packet(), {
        outcome: 'PROJECTED',
        nodes: [hiddenNode],
        sourceClaims: [],
      }),
    ).toThrow(/hidden|unknown|binding/i)

    const accessorClaim = {
      subject: 'node:bytes#/id',
      documentPath: 'docs/GDD.md',
      sectionId: 'section-0',
      sourcePointer: '/bytes/0/5',
      get literal(): string {
        throw new Error('accessor must not run')
      },
    }
    expect(() =>
      admitPhase5SemanticResult(packet(), {
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
        sourceClaims: [accessorClaim],
      }),
    ).toThrow(/hidden|accessor|claim/i)
  })

  test('rejects a byte-valid but semantically contrary edge literal', () => {
    const edgeLiteral = canonicalGameIrJson({
      type: 'root',
      targetId: 'bytes',
      targetType: 'world-scene.scene',
    })
    const bytes = `bytes{}${edgeLiteral}`
    const currentSource = source(bytes)
    const currentPacket = packet(
      currentSource,
      ['world-scene.scene'],
      ['other', 'root'],
    )
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
              targetId: 'bytes',
              targetType: 'world-scene.scene',
            },
          ],
        },
      ],
      sourceClaims: [
        {
          subject: 'node:bytes#/edges/0',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: `/bytes/7/${Buffer.byteLength(bytes)}`,
          literal: edgeLiteral,
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
    expect(
      replayAndBindPhase5SemanticReceipt({
        source: currentSource,
        mechanical: mechanical(currentSource),
        packet: currentPacket,
        semantic: base,
      }).module.nodes[0]?.edges,
    ).toEqual([
      { type: 'root', targetId: 'bytes', targetType: 'world-scene.scene' },
    ])
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
