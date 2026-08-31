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
  admitWorldSceneSemanticResult,
  buildWorldSceneSemanticPacket,
} from './world-scene-producer'
import {
  replayAndBindPhase5SemanticReceipt,
  type Phase5SemanticReceipt,
} from './phase5-admission'
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
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'

const digest = 'a'.repeat(64)

function source(bytes = 'scene'): GameIrDomainSourceEnvelope {
  const bytesDigest = createHash('sha256').update(bytes).digest('hex')
  const sectionIndex: readonly GameIrSourceSection[] =
    CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `section-${index}`,
      heading: `Section ${index}`,
      startLine: 1,
      endLine: 1,
      digest: bytesDigest,
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
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'task-world',
    publicationId: 'publication-world',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundation,
      receiptDigest: digestGameIrValue(foundation),
    },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'world-scene',
    request,
    sectionIndex,
    sectionBytes: {
      'docs/GDD.md#section-0': bytes,
      'docs/LEVEL_SCENE_DESIGN.md#section-1': bytes,
    },
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

function packet() {
  const currentSource = source()
  return {
    source: currentSource,
    mechanical: mechanical(currentSource),
    packet: buildWorldSceneSemanticPacket({
      source: currentSource,
      mechanical: mechanical(currentSource),
    }),
  }
}

function resultInput(id = 'scene', kind = 'world-scene.scene') {
  return {
    outcome: 'PROJECTED' as const,
    nodes: [{ id, kind, value: { label: 'scene' }, references: [], edges: [] }],
    sourceClaims: [
      {
        subject: `node:${id}#/id`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'section-0',
        sourcePointer: '/bytes/0/5',
        literal: id === 'scene' ? 'scene' : id,
      },
      {
        subject: `node:${id}#/value/label`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'section-0',
        sourcePointer: '/bytes/0/5',
        literal: 'scene',
      },
    ],
  }
}

function valueLeafPointers(value: Record<string, unknown>): string[] {
  const pointers: string[] = []
  const escape = (key: string) =>
    key.replaceAll('~', '~0').replaceAll('/', '~1')
  const visit = (entry: unknown, pointer: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) pointers.push(pointer)
      else entry.forEach((child, index) => visit(child, `${pointer}/${index}`))
    } else if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) pointers.push(pointer)
      else
        entries.forEach(([key, child]) =>
          visit(child, `${pointer}/${escape(key)}`),
        )
    } else pointers.push(pointer)
  }
  Object.entries(value).forEach(([key, entry]) =>
    visit(entry, `/value/${escape(key)}`),
  )
  return pointers
}

function pointerValue(value: unknown, pointer: string): unknown {
  const segments = pointer
    .slice(1)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  let current = value
  for (const segment of segments)
    current = (current as Record<string, unknown>)[segment]
  return current
}

function sourceLiteral(value: unknown): string {
  return typeof value === 'string' ? value : canonicalGameIrJson(value)
}

function replayFixture() {
  const nodes = [
    {
      id: 'scene',
      kind: 'world-scene.scene',
      value: { label: 'scene' },
      references: [],
      edges: [
        { type: 'root', targetId: 'child', targetType: 'world-scene.node' },
      ],
    },
    {
      id: 'child',
      kind: 'world-scene.node',
      value: {
        label: 'child',
        transform: {
          dimensions: '2d',
          space: 'world',
          position: { x: 1, y: 2 },
          rotationRadians: 0.5,
          scale: { x: 1, y: 1 },
        },
      },
      references: [],
      edges: [
        { type: 'scene', targetId: 'scene', targetType: 'world-scene.scene' },
      ],
    },
    {
      id: 'zone',
      kind: 'world-scene.zone',
      value: {
        label: 'zone',
        shape: { kind: 'circle', radius: 2 },
        transform: {
          dimensions: '2d',
          space: 'world',
          position: { x: 0, y: 0 },
          rotationRadians: 0,
          scale: { x: 1, y: 1 },
        },
      },
      references: [],
      edges: [
        { type: 'scene', targetId: 'scene', targetType: 'world-scene.scene' },
      ],
    },
    {
      id: 'route',
      kind: 'world-scene.route',
      value: {
        label: 'route',
        closed: true,
        waypointReferenceIndexes: [0, 1, 1],
      },
      references: [
        { targetId: 'waypoint-a', targetType: 'world-scene.node' },
        { targetId: 'waypoint-b', targetType: 'world-scene.node' },
      ],
      edges: [
        { type: 'scene', targetId: 'scene', targetType: 'world-scene.scene' },
      ],
    },
    {
      id: 'waypoint-a',
      kind: 'world-scene.node',
      value: { label: 'waypoint-a' },
      references: [],
      edges: [
        { type: 'scene', targetId: 'scene', targetType: 'world-scene.scene' },
      ],
    },
    {
      id: 'waypoint-b',
      kind: 'world-scene.node',
      value: { label: 'waypoint-b' },
      references: [],
      edges: [
        { type: 'scene', targetId: 'scene', targetType: 'world-scene.scene' },
      ],
    },
  ] as const
  const literals = nodes.flatMap(node => [
    node.id,
    ...valueLeafPointers(node.value).map(pointer =>
      sourceLiteral(pointerValue(node, pointer)),
    ),
    ...node.references.map(reference => canonicalGameIrJson(reference)),
    ...node.edges.map(edge => canonicalGameIrJson(edge)),
  ])
  const bytes = [...new Set(literals)].join('|')
  const currentSource = source(bytes)
  const currentMechanical = mechanical(currentSource)
  const currentPacket = buildWorldSceneSemanticPacket({
    source: currentSource,
    mechanical: currentMechanical,
  })
  const sourceClaims = nodes.flatMap(node => {
    const claims = [
      {
        subject: `node:${node.id}#/id`,
        literal: node.id,
      },
      ...valueLeafPointers(node.value).map(pointer => ({
        subject: `node:${node.id}#${pointer}`,
        literal: sourceLiteral(pointerValue(node, pointer)),
      })),
      ...node.references.map((reference, index) => ({
        subject: `node:${node.id}#/references/${index}`,
        literal: canonicalGameIrJson(reference),
      })),
      ...node.edges.map((edge, index) => ({
        subject: `node:${node.id}#/edges/${index}`,
        literal: canonicalGameIrJson(edge),
      })),
    ]
    return claims.map(claim => ({
      ...claim,
      documentPath: 'docs/GDD.md' as const,
      sectionId: 'section-0',
      sourcePointer: `/bytes/${bytes.indexOf(claim.literal)}/${
        bytes.indexOf(claim.literal) + Buffer.byteLength(claim.literal)
      }`,
    }))
  })
  const semantic = admitWorldSceneSemanticResult(currentPacket, {
    outcome: 'PROJECTED',
    nodes,
    sourceClaims: sourceClaims.sort((left, right) =>
      left.subject.localeCompare(right.subject),
    ),
  })
  if ('reasonCode' in semantic) throw new Error('expected World/Scene receipt')
  return { currentSource, currentMechanical, currentPacket, semantic }
}

function reissueReceipt(
  receipt: Phase5SemanticReceipt,
  patch: Record<string, unknown>,
): Phase5SemanticReceipt {
  const { receiptDigest: _receiptDigest, ...body } = { ...receipt, ...patch }
  return {
    ...body,
    receiptDigest: digestGameIrValue(body),
  } as Phase5SemanticReceipt
}

describe('World/Scene semantic producer wrapper', () => {
  test('derives exact GDD/Level closure and all kinds/roles from the manifest', () => {
    const {
      source: currentSource,
      mechanical: currentMechanical,
      packet: currentPacket,
    } = packet()
    expect(
      currentSource.sectionIndex.map(section => section.documentPath),
    ).toEqual(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'])
    expect(currentMechanical.nodes).toEqual([])
    expect(currentMechanical.verifiedClaims).toEqual([])
    expect(currentMechanical.ownedTargets).toEqual([])
    expect(currentPacket.allowedNodeKinds).toEqual(
      Object.keys(WORLD_SCENE_DOMAIN_MANIFEST).sort(),
    )
    expect(currentPacket.allowedRelationshipTypes).toEqual(
      [
        ...new Set(
          Object.values(WORLD_SCENE_DOMAIN_MANIFEST).flatMap(item =>
            Object.keys(item.relationships),
          ),
        ),
      ].sort(),
    )
  })

  test('admits every manifest World kind through the shared result boundary', () => {
    const { packet: currentPacket } = packet()
    for (const [index, kind] of Object.keys(
      WORLD_SCENE_DOMAIN_MANIFEST,
    ).entries()) {
      const result = admitWorldSceneSemanticResult(
        currentPacket,
        resultInput(`node-${index}`, kind),
      )
      expect(result).toMatchObject({
        outcome: 'PROJECTED',
        moduleId: 'world-scene',
      })
    }
  })

  test('rejects stale or relabelled packets and preserves empty mechanical policy', () => {
    const { packet: currentPacket } = packet()
    expect(() =>
      admitWorldSceneSemanticResult(
        { ...currentPacket, moduleId: 'presentation' } as typeof currentPacket,
        resultInput(),
      ),
    ).toThrow()
    expect(currentPacket.forbiddenTargets).toEqual([])
  })

  test('admits missing and ambiguous diagnostics only with exact section evidence', () => {
    const { packet: currentPacket } = packet()
    const base = {
      actual: 'not declared',
      missingSubject: 'node:scene#/value/label',
      expectedProjection: 'scene label',
      evidencePointers: [currentPacket.allowedEvidencePointers[0]!],
    }
    expect(
      admitWorldSceneSemanticResult(currentPacket, {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        ...base,
      }),
    ).toMatchObject({ outcome: 'FAIL', moduleId: 'world-scene' })
    expect(
      admitWorldSceneSemanticResult(currentPacket, {
        outcome: 'AMBIGUOUS',
        reasonCode: 'ambiguous-projection',
        ...base,
      }),
    ).toMatchObject({ outcome: 'AMBIGUOUS', moduleId: 'world-scene' })
    expect(() =>
      admitWorldSceneSemanticResult(currentPacket, {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        ...base,
        evidencePointers: ['section:docs/ART_DIRECTION.md#section-2@' + digest],
      }),
    ).toThrow()
  })

  test('accepts a graph beyond ordinary size without a business cap', () => {
    const graph = Array.from({ length: 256 }, (_, index) => ({
      id: `node-${index}`,
      kind: 'world-scene.node',
      value: { label: 'scene' },
      references: [],
      edges: [],
    }))
    expect(graph.length).toBeGreaterThan(100)
    expect(canonicalGameIrJson(graph[0])).toContain('world-scene.node')
  })

  test('replays transform, geometry, route index, reference, and edge claims at the shared boundary', () => {
    const fixture = replayFixture()
    const bound = replayAndBindPhase5SemanticReceipt({
      source: fixture.currentSource,
      mechanical: fixture.currentMechanical,
      packet: fixture.currentPacket,
      semantic: fixture.semantic,
    })
    const route = bound.module.nodes.find(node => node.id === 'route')!
    const child = bound.module.nodes.find(node => node.id === 'child')!
    const zone = bound.module.nodes.find(node => node.id === 'zone')!
    expect(child.value).toHaveProperty('transform')
    expect(zone.value).toHaveProperty('shape')
    expect(route.value).toEqual({
      label: 'route',
      closed: true,
      waypointReferenceIndexes: [0, 1, 1],
    })
    expect(route.references).toHaveLength(2)
    expect(route.edges[0]).toEqual({
      type: 'scene',
      targetId: 'scene',
      targetType: 'world-scene.scene',
    })
    expect(Object.keys(child.bindings)).toContain('/value/transform/position/x')
    expect(Object.keys(route.bindings)).toContain('/references/1')
    expect(Object.keys(route.bindings)).toContain('/edges/0')
  })

  test('rejects UTF-8 range and edge-role tampering in the shared replay helper', () => {
    const utf8 = source('scene|bé')
    const currentMechanical = mechanical(utf8)
    const currentPacket = buildWorldSceneSemanticPacket({
      source: utf8,
      mechanical: currentMechanical,
    })
    const utf8Result = admitWorldSceneSemanticResult(currentPacket, {
      outcome: 'PROJECTED',
      nodes: [
        {
          id: 'scene',
          kind: 'world-scene.scene',
          value: { label: 'bé' },
          references: [],
          edges: [],
        },
      ],
      sourceClaims: [
        {
          subject: 'node:scene#/id',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/0/5',
          literal: 'scene',
        },
        {
          subject: 'node:scene#/value/label',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/6/9',
          literal: 'bé',
        },
      ],
    })
    if ('reasonCode' in utf8Result) throw new Error('expected UTF-8 receipt')
    const split = reissueReceipt(utf8Result, {
      sourceClaims: utf8Result.sourceClaims.map(claim =>
        claim.subject.endsWith('/label')
          ? { ...claim, sourcePointer: '/bytes/6/8' }
          : claim,
      ),
    })
    expect(() =>
      replayAndBindPhase5SemanticReceipt({
        source: utf8,
        mechanical: currentMechanical,
        packet: currentPacket,
        semantic: split,
      }),
    ).toThrow()

    const fixture = replayFixture()
    const edgeTampered = reissueReceipt(fixture.semantic, {
      nodes: fixture.semantic.nodes.map(node =>
        node.id === 'scene'
          ? { ...node, edges: [{ ...node.edges[0]!, type: 'parent' }] }
          : node,
      ),
    })
    expect(() =>
      replayAndBindPhase5SemanticReceipt({
        source: fixture.currentSource,
        mechanical: fixture.currentMechanical,
        packet: fixture.currentPacket,
        semantic: edgeTampered,
      }),
    ).toThrow()
  })
})
