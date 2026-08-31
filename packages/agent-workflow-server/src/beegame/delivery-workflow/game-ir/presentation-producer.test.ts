import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitGameIrMechanicalProjectionReceipt,
  type GameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  admitPresentationSemanticResult,
  buildPresentationSemanticPacket,
} from './presentation-producer'
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
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'

const digest = 'a'.repeat(64)
const selectedDocuments = [
  'docs/GDD.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
] as const

function source(
  bytes = 'screen|state|action|feedback|audio-event|audio-cue',
): GameIrDomainSourceEnvelope {
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
    taskId: 'task-presentation',
    publicationId: 'publication-presentation',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundation,
      receiptDigest: digestGameIrValue(foundation),
    },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'presentation',
    request,
    sectionIndex,
    sectionBytes: Object.fromEntries(
      selectedDocuments.map((documentPath, index) => [
        `${documentPath}#section-${CANONICAL_FOUNDATION_DOCUMENTS.indexOf(documentPath)}`,
        bytes,
      ]),
    ),
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
  const currentMechanical = mechanical(currentSource)
  return {
    source: currentSource,
    mechanical: currentMechanical,
    packet: buildPresentationSemanticPacket({
      source: currentSource,
      mechanical: currentMechanical,
    }),
  }
}

function resultInput(id = 'screen', kind = 'presentation.ui-screen') {
  return {
    outcome: 'PROJECTED' as const,
    nodes: [{ id, kind, value: { label: id }, references: [], edges: [] }],
    sourceClaims: [
      {
        subject: `node:${id}#/id`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'section-0',
        sourcePointer: `/bytes/0/${Buffer.byteLength(id)}`,
        literal: id,
      },
      {
        subject: `node:${id}#/value/label`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'section-0',
        sourcePointer: `/bytes/0/${Buffer.byteLength(id)}`,
        literal: id,
      },
    ],
  }
}

function reissuePacket(
  packetValue: GameIrDomainSemanticPacket,
  patch: Record<string, unknown>,
): GameIrDomainSemanticPacket {
  const { packetDigest: _packetDigest, ...body } = {
    ...packetValue,
    ...patch,
  }
  return {
    ...body,
    packetDigest: digestGameIrValue(body),
  } as GameIrDomainSemanticPacket
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
  let current = value
  for (const segment of pointer
    .slice(1)
    .split('/')
    .map(entry => entry.replaceAll('~1', '/').replaceAll('~0', '~')))
    current = (current as Record<string, unknown>)[segment]
  return current
}

function sourceLiteral(value: unknown): string {
  return typeof value === 'string' ? value : canonicalGameIrJson(value)
}

function replayFixture() {
  const nodes = [
    {
      id: 'audio-cue',
      kind: 'presentation.audio-cue',
      value: {
        label: 'audio-cue',
        volume: 0.8,
        requirements: [
          { requirementId: 'audio.wav', kind: 'audio', runtimeRole: 'cue' },
        ],
      },
      references: [
        { targetId: 'external-audio', targetType: 'presentation.audio-event' },
      ],
      edges: [
        {
          type: 'at',
          targetId: 'scene',
          targetType: 'world-scene.scene',
        },
        {
          type: 'event',
          targetId: 'audio-event',
          targetType: 'presentation.audio-event',
        },
      ],
    },
    {
      id: 'audio-event',
      kind: 'presentation.audio-event',
      value: { label: 'audio-event', spatial: true },
      references: [],
      edges: [
        { type: 'on', targetId: 'trigger', targetType: 'gameplay.event' },
      ],
    },
    {
      id: 'action',
      kind: 'presentation.ui-action',
      value: { label: 'action', input: 'button' },
      references: [],
      edges: [
        {
          type: 'available-in',
          targetId: 'state',
          targetType: 'gameplay.state',
        },
        { type: 'invokes', targetId: 'invoke', targetType: 'gameplay.action' },
        {
          type: 'screen',
          targetId: 'scene',
          targetType: 'presentation.ui-screen',
        },
      ],
    },
    {
      id: 'feedback',
      kind: 'presentation.feedback',
      value: { label: 'feedback', channel: 'text' },
      references: [],
      edges: [
        { type: 'on', targetId: 'trigger', targetType: 'gameplay.event' },
        {
          type: 'screen',
          targetId: 'scene',
          targetType: 'presentation.ui-screen',
        },
      ],
    },
    {
      id: 'scene',
      kind: 'presentation.ui-screen',
      value: { label: 'scene', modal: false },
      references: [],
      edges: [],
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
  const currentPacket = buildPresentationSemanticPacket({
    source: currentSource,
    mechanical: currentMechanical,
  })
  const sourceClaims = nodes.flatMap(node => {
    const claims = [
      { subject: `node:${node.id}#/id`, literal: node.id },
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
  const semantic = admitPresentationSemanticResult(currentPacket, {
    outcome: 'PROJECTED',
    nodes,
    sourceClaims: sourceClaims.sort((left, right) =>
      left.subject.localeCompare(right.subject),
    ),
  })
  if ('reasonCode' in semantic) throw new Error('expected Presentation receipt')
  return { currentSource, currentMechanical, currentPacket, semantic }
}

describe('Presentation semantic producer wrapper', () => {
  test('derives exact GDD/Art/UI/Audio closure and manifest kinds/roles', () => {
    const {
      source: currentSource,
      mechanical: currentMechanical,
      packet: currentPacket,
    } = packet()
    expect(
      currentSource.sectionIndex.map(section => section.documentPath),
    ).toEqual([...selectedDocuments].sort())
    expect(currentMechanical.nodes).toEqual([])
    expect(currentMechanical.verifiedClaims).toEqual([])
    expect(currentMechanical.ownedTargets).toEqual([])
    expect(currentPacket.allowedNodeKinds).toEqual(
      Object.keys(PRESENTATION_DOMAIN_MANIFEST).sort(),
    )
    expect(currentPacket.allowedRelationshipTypes).toEqual(
      [
        ...new Set(
          Object.values(PRESENTATION_DOMAIN_MANIFEST).flatMap(item =>
            Object.keys(item.relationships),
          ),
        ),
      ].sort(),
    )
  })

  test('admits every manifest Presentation kind through shared admission', () => {
    const { packet: currentPacket } = packet()
    for (const [index, kind] of Object.keys(
      PRESENTATION_DOMAIN_MANIFEST,
    ).entries()) {
      expect(
        admitPresentationSemanticResult(
          currentPacket,
          resultInput(`node-${index}`, kind),
        ),
      ).toMatchObject({ outcome: 'PROJECTED', moduleId: 'presentation' })
    }
  })

  test('rejects stale packet and recomputed relabels at the correct boundaries', () => {
    const { packet: currentPacket } = packet()
    expect(() =>
      admitPresentationSemanticResult(
        { ...currentPacket, packetDigest: 'b'.repeat(64) },
        resultInput(),
      ),
    ).toThrow('semantic packet digest is stale or invalid')
    const relabelled = reissuePacket(currentPacket, { moduleId: 'world-scene' })
    expect(() =>
      admitPresentationSemanticResult(relabelled, resultInput()),
    ).toThrow('invalid Presentation semantic result module')
  })

  test('rejects same-module widened kind and relationship role after shared admission', () => {
    const { packet: currentPacket } = packet()
    const widenedKind = reissuePacket(currentPacket, {
      allowedNodeKinds: [
        ...currentPacket.allowedNodeKinds,
        'presentation.rogue',
      ].sort(),
    })
    expect(() =>
      admitPresentationSemanticResult(
        widenedKind,
        resultInput('rogue', 'presentation.rogue'),
      ),
    ).toThrow('Presentation semantic packet manifest identity')
    const widenedRole = reissuePacket(currentPacket, {
      allowedRelationshipTypes: [
        ...currentPacket.allowedRelationshipTypes,
        'rogue-role',
      ].sort(),
    })
    expect(() =>
      admitPresentationSemanticResult(widenedRole, {
        ...resultInput(),
        nodes: [
          {
            id: 'screen',
            kind: 'presentation.ui-screen',
            value: { label: 'screen' },
            references: [],
            edges: [{ type: 'rogue-role', targetId: 'x', targetType: 'x' }],
          },
        ],
        sourceClaims: [
          ...resultInput().sourceClaims,
          {
            subject: 'node:screen#/edges/0',
            documentPath: 'docs/GDD.md',
            sectionId: 'section-0',
            sourcePointer: '/bytes/0/1',
            literal: '{"targetId":"x","targetType":"x","type":"rogue-role"}',
          },
        ].sort((left, right) => left.subject.localeCompare(right.subject)),
      }),
    ).toThrow('Presentation semantic packet manifest identity')
  })

  test('lets shared admission reject raw packet accessors before wrapper narrowing', () => {
    const { packet: currentPacket } = packet()
    const descriptors: PropertyDescriptorMap =
      Object.getOwnPropertyDescriptors(currentPacket)
    descriptors.moduleId = {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error('raw packet read')
      },
    }
    const accessorPacket = Object.create(
      Object.getPrototypeOf(currentPacket),
      descriptors,
    ) as typeof currentPacket
    expect(() =>
      admitPresentationSemanticResult(accessorPacket, resultInput()),
    ).toThrow('invalid Game IR Phase 5 admission')
  })

  test('admits missing and ambiguous diagnostics only with selected section evidence', () => {
    const { packet: currentPacket } = packet()
    const base = {
      actual: 'not declared',
      missingSubject: 'node:screen#/value/label',
      expectedProjection: 'screen label',
      evidencePointers: [currentPacket.allowedEvidencePointers[0]!],
    }
    expect(
      admitPresentationSemanticResult(currentPacket, {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        ...base,
      }),
    ).toMatchObject({ outcome: 'FAIL', moduleId: 'presentation' })
    expect(
      admitPresentationSemanticResult(currentPacket, {
        outcome: 'AMBIGUOUS',
        reasonCode: 'ambiguous-projection',
        ...base,
      }),
    ).toMatchObject({ outcome: 'AMBIGUOUS', moduleId: 'presentation' })
    expect(() =>
      admitPresentationSemanticResult(currentPacket, {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        ...base,
        evidencePointers: ['section:docs/ASSET_PLAN.md#section-7@' + digest],
      }),
    ).toThrow('outside the exact source closure')
  })

  test('rejects fidelity binding evidence in producer diagnostics', () => {
    const fixture = replayFixture()
    const claim = fixture.semantic.sourceClaims.find(
      entry => entry.subject === 'node:scene#/id',
    )!
    const bindingPointer = `binding:${claim.documentPath}#${claim.sectionId}${claim.sourcePointer}`
    expect(() =>
      admitPresentationSemanticResult(fixture.currentPacket, {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        actual: 'not declared',
        missingSubject: 'node:scene#/value/label',
        expectedProjection: 'scene label',
        evidencePointers: [bindingPointer],
      }),
    ).toThrow('outside the exact source closure')
  })

  test('admits and replays a large graph without a business cap', () => {
    const graph = Array.from({ length: 256 }, (_, index) => ({
      id: `state-${index}`,
      kind: 'presentation.ui-state',
      value: { label: `state-${index}` },
      references: [],
      edges: [],
    }))
    const bytes = graph.map(node => node.id).join('|')
    const currentSource = source(bytes)
    const currentMechanical = mechanical(currentSource)
    const currentPacket = buildPresentationSemanticPacket({
      source: currentSource,
      mechanical: currentMechanical,
    })
    const sourceClaims = graph.flatMap(node => [
      {
        subject: `node:${node.id}#/id`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'section-0',
        sourcePointer: `/bytes/${bytes.indexOf(node.id)}/${
          bytes.indexOf(node.id) + Buffer.byteLength(node.id)
        }`,
        literal: node.id,
      },
      {
        subject: `node:${node.id}#/value/label`,
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'section-0',
        sourcePointer: `/bytes/${bytes.indexOf(node.id)}/${
          bytes.indexOf(node.id) + Buffer.byteLength(node.id)
        }`,
        literal: node.id,
      },
    ])
    const admitted = admitPresentationSemanticResult(currentPacket, {
      outcome: 'PROJECTED',
      nodes: graph,
      sourceClaims: sourceClaims.sort((left, right) =>
        left.subject.localeCompare(right.subject),
      ),
    })
    if ('reasonCode' in admitted)
      throw new Error('expected Presentation receipt')
    const bound = replayAndBindPhase5SemanticReceipt({
      source: currentSource,
      mechanical: currentMechanical,
      packet: currentPacket,
      semantic: admitted,
    })
    expect(admitted.nodes).toHaveLength(256)
    expect(bound.module.nodes).toHaveLength(256)
  })

  test('replays logical requirements, UI/action/feedback/audio references and edges with complete owner bindings', () => {
    const fixture = replayFixture()
    const bound = replayAndBindPhase5SemanticReceipt({
      source: fixture.currentSource,
      mechanical: fixture.currentMechanical,
      packet: fixture.currentPacket,
      semantic: fixture.semantic,
    })
    const cue = bound.module.nodes.find(node => node.id === 'audio-cue')!
    expect(cue.value).toEqual(
      fixture.semantic.nodes.find(node => node.id === 'audio-cue')!.value,
    )
    expect(cue.references).toEqual(
      fixture.semantic.nodes.find(node => node.id === 'audio-cue')!.references,
    )
    expect(cue.edges).toEqual(
      fixture.semantic.nodes.find(node => node.id === 'audio-cue')!.edges,
    )
    for (const expectedNode of fixture.semantic.nodes) {
      const actualNode = bound.module.nodes.find(
        node => node.id === expectedNode.id,
      )!
      const pointers = [
        '/id',
        ...valueLeafPointers(expectedNode.value),
        ...expectedNode.references.map((_, index) => `/references/${index}`),
        ...expectedNode.edges.map((_, index) => `/edges/${index}`),
      ]
      for (const pointer of pointers) {
        const claim = fixture.semantic.sourceClaims.find(
          entry => entry.subject === `node:${expectedNode.id}#${pointer}`,
        )!
        const section = fixture.currentSource.sectionIndex.find(
          entry =>
            entry.documentPath === claim.documentPath &&
            entry.sectionId === claim.sectionId,
        )!
        expect(actualNode.bindings[pointer]).toEqual({
          kind: 'owner',
          documentPath: claim.documentPath,
          sectionId: claim.sectionId,
          sectionDigest: section.digest,
          sourcePointer: claim.sourcePointer,
        })
      }
    }
  })

  test('rejects split UTF-8 and edge-role tampering in shared replay', () => {
    const utf8 = source('screen|bé')
    const currentMechanical = mechanical(utf8)
    const currentPacket = buildPresentationSemanticPacket({
      source: utf8,
      mechanical: currentMechanical,
    })
    const utf8Result = admitPresentationSemanticResult(currentPacket, {
      outcome: 'PROJECTED',
      nodes: [
        {
          id: 'screen',
          kind: 'presentation.ui-screen',
          value: { label: 'bé' },
          references: [],
          edges: [],
        },
      ],
      sourceClaims: [
        {
          subject: 'node:screen#/id',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/0/6',
          literal: 'screen',
        },
        {
          subject: 'node:screen#/value/label',
          documentPath: 'docs/GDD.md',
          sectionId: 'section-0',
          sourcePointer: '/bytes/7/10',
          literal: 'bé',
        },
      ],
    })
    if ('reasonCode' in utf8Result) throw new Error('expected UTF-8 receipt')
    const split = reissueReceipt(utf8Result, {
      sourceClaims: utf8Result.sourceClaims.map(claim =>
        claim.subject.endsWith('/label')
          ? { ...claim, sourcePointer: '/bytes/7/9' }
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
        node.id === 'audio-event'
          ? { ...node, edges: [{ ...node.edges[0]!, type: 'rogue-role' }] }
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
