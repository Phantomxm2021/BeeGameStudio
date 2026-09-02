import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  admitPhase5SemanticResult,
  replayAndBindPhase5SemanticReceipt,
  type Phase5SemanticReceipt,
} from './phase5-admission'
import * as phase5Admission from './phase5-admission'
import {
  admitGameIrMechanicalProjectionReceipt,
  buildGameIrDomainSemanticPacket,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  admitGameplaySemanticResult,
  buildGameplaySemanticPacket,
  prepareGameplayModule,
} from './gameplay-producer'
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
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'

const digest = 'a'.repeat(64)

function source(
  bytes = 'bytes',
  moduleId: 'gameplay' | 'world-scene' | 'presentation' = 'world-scene',
  extraSelectedSection = false,
): GameIrDomainSourceEnvelope {
  const sectionIndex: readonly GameIrSourceSection[] = [
    ...CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `section-${index}`,
      heading: `Section ${index}`,
      startLine: 1,
      endLine: 1,
      digest: createHash('sha256').update(bytes).digest('hex'),
    })),
    ...(extraSelectedSection
      ? [
          {
            documentPath: 'docs/GDD.md' as const,
            sectionId: 'section-extra',
            heading: 'Extra section',
            startLine: 2,
            endLine: 2,
            digest: createHash('sha256').update(bytes).digest('hex'),
          },
        ]
      : []),
  ]
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
  const selectedPaths =
    moduleId === 'gameplay'
      ? ['docs/GDD.md']
      : moduleId === 'world-scene'
        ? ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md']
        : [
            'docs/GDD.md',
            'docs/ART_DIRECTION.md',
            'docs/UI_UX_SPEC.md',
            'docs/AUDIO_DESIGN.md',
          ]
  return buildGameIrDomainSourceEnvelope({
    request: requestBody,
    sectionIndex,
    sectionBytes: Object.fromEntries([
      ...selectedPaths.map(path => [
        `${path}#section-${CANONICAL_FOUNDATION_DOCUMENTS.indexOf(path as FoundationDocumentPath)}`,
        bytes,
      ]),
      ...(extraSelectedSection ? [['docs/GDD.md#section-extra', bytes]] : []),
    ]),
    moduleId,
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

function fullPhase5Packet(currentSource = source()) {
  const currentMechanical = mechanical(currentSource)
  const manifest =
    currentSource.moduleId === 'world-scene'
      ? WORLD_SCENE_DOMAIN_MANIFEST
      : PRESENTATION_DOMAIN_MANIFEST
  return buildGameIrDomainSemanticPacket({
    source: currentSource,
    mechanical: currentMechanical,
    allowedNodeKinds: Object.keys(manifest).sort(),
    allowedRelationshipTypes: [
      ...new Set(
        Object.values(manifest).flatMap(entry =>
          Object.keys(entry.relationships),
        ),
      ),
    ].sort(),
  })
}

function gameplayProjection(currentSource = source()) {
  const gameplaySource = source('bytes', 'gameplay')
  const gameplayMechanical = mechanical(gameplaySource)
  const gameplayPacket = buildGameplaySemanticPacket({
    source: gameplaySource,
    mechanical: gameplayMechanical,
  })
  const gameplaySemantic = admitGameplaySemanticResult(gameplayPacket, {
    outcome: 'PROJECTED',
    nodes: [
      {
        id: 'bytes',
        kind: 'gameplay.state',
        value: { label: 'Fixture state', initial: true, terminal: 'none' },
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
        subject: 'node:bytes#/value/initial',
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
      {
        subject: 'node:bytes#/value/terminal',
        documentPath: 'docs/GDD.md',
        sectionId: 'section-0',
        sourcePointer: '/bytes/0/5',
        literal: 'bytes',
      },
    ],
  })
  if ('reasonCode' in gameplaySemantic)
    throw new Error('expected independent Gameplay receipt')
  const prepared = prepareGameplayModule({
    source: gameplaySource,
    mechanical: gameplayMechanical,
    semantic: gameplaySemantic,
  })
  const body = {
    schemaVersion: 'game-ir-gameplay-module.v1' as const,
    taskId: currentSource.taskId,
    foundationRevision:
      currentSource.compileRequest.foundation.foundationRevision,
    module: prepared.module,
    mechanicalReceiptDigest: gameplayMechanical.receiptDigest,
    semanticReceiptDigest: gameplaySemantic.receiptDigest,
  }
  return { ...body, projectionDigest: digestGameIrValue(body) }
}

function worldSceneProjection(currentSource = source()) {
  const worldSource = source('bytes', 'world-scene')
  const worldMechanical = mechanical(worldSource)
  const worldSemantic = projected(worldSource)
  const bound = replayAndBindPhase5SemanticReceipt({
    source: worldSource,
    mechanical: worldMechanical,
    packet: packet(worldSource),
    semantic: worldSemantic,
  })
  const body = {
    schemaVersion: 'game-ir-world-scene-module.v1' as const,
    taskId: currentSource.taskId,
    foundationRevision:
      currentSource.compileRequest.foundation.foundationRevision,
    module: bound.module,
    sourceDigest: worldSource.sourceDigest,
    mechanicalReceiptDigest: worldMechanical.receiptDigest,
    semanticReceiptDigest: worldSemantic.receiptDigest,
    semanticValidationResultDigest: digestGameIrValue({
      outcome: 'PASS',
      sourceDigest: worldSource.sourceDigest,
      semanticReceiptDigest: worldSemantic.receiptDigest,
    }),
  }
  return { ...body, projectionDigest: digestGameIrValue(body) }
}

function projectedInputFor(moduleId: 'world-scene' | 'presentation') {
  return {
    ...projectedInput(),
    nodes: [
      {
        ...projectedInput().nodes[0],
        kind:
          moduleId === 'world-scene'
            ? 'world-scene.scene'
            : 'presentation.ui-screen',
      },
    ],
  }
}

function validationFixture(
  moduleId: 'world-scene' | 'presentation' = 'world-scene',
  extraSelectedSection = false,
) {
  const currentSource = source('bytes', moduleId, extraSelectedSection)
  const currentMechanical = mechanical(currentSource)
  const currentPacket = fullPhase5Packet(currentSource)
  const currentSemantic = admitPhase5SemanticResult(
    currentPacket,
    projectedInputFor(moduleId),
  )
  if ('reasonCode' in currentSemantic) throw new Error('expected receipt')
  const bound = replayAndBindPhase5SemanticReceipt({
    source: currentSource,
    mechanical: currentMechanical,
    packet: currentPacket,
    semantic: currentSemantic,
  })
  const externalProjections =
    moduleId === 'world-scene'
      ? {
          gameplay: gameplayProjection(currentSource),
        }
      : {
          gameplay: gameplayProjection(currentSource),
          worldScene: worldSceneProjection(currentSource),
        }
  const validationPacket = phase5Admission.buildPhase5SemanticValidationPacket({
    source: currentSource,
    mechanical: currentMechanical,
    semantic: currentSemantic,
    module: bound.module,
    externalProjections,
  })
  return {
    currentSource,
    validationPacket,
    builderInput: {
      source: currentSource,
      mechanical: currentMechanical,
      semantic: currentSemantic,
      module: bound.module,
      externalProjections,
    },
  }
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const nested of Object.values(value)) expectDeepFrozen(nested)
}

function repack(
  packet: phase5Admission.Phase5SemanticValidationPacket,
  module: unknown,
) {
  const parsed = module as {
    moduleId: string
    nodes: Array<{
      id: string
      value: Record<string, unknown>
      references: unknown[]
      edges: unknown[]
      bindings: Record<string, unknown>
    }>
  }
  const targets = parsed.nodes
    .flatMap(node => [
      `node:${node.id}#/id`,
      ...Object.keys(node.value).map(key => `node:${node.id}#/value/${key}`),
      ...node.references.map(
        (_, index) => `node:${node.id}#/references/${index}`,
      ),
      ...node.edges.map((_, index) => `node:${node.id}#/edges/${index}`),
    ])
    .sort()
  const ownerPointers = parsed.nodes.flatMap(node =>
    Object.entries(node.bindings)
      .filter(([, binding]) => (binding as { kind?: string }).kind === 'owner')
      .map(([pointer, binding]) => {
        const owner = binding as {
          documentPath: string
          sectionId: string
          sourcePointer: string
        }
        return `binding:${owner.documentPath}#${owner.sectionId}${owner.sourcePointer}`
      }),
  )
  const body = {
    ...packet,
    moduleBytes: canonicalGameIrJson(module),
    moduleDigest: digestGameIrValue(module),
    requiredTargets: targets,
    allowedEvidencePointers: [
      ...new Set([
        ...ownerPointers,
        ...packet.allowedEvidencePointers.filter(pointer =>
          pointer.startsWith('section:'),
        ),
      ]),
    ].sort(),
  }
  const { packetDigest: _ignored, ...withoutDigest } = body
  return { ...body, packetDigest: digestGameIrValue(withoutDigest) }
}

function repackValidation(
  packet: phase5Admission.Phase5SemanticValidationPacket,
  changes: Record<string, unknown>,
) {
  const body = { ...packet, ...changes }
  const { packetDigest: _ignored, ...withoutDigest } = body
  return { ...body, packetDigest: digestGameIrValue(withoutDigest) }
}

function repackExternalProjection(
  projection: Record<string, unknown>,
  module: unknown,
): Record<string, unknown> {
  const body = { ...projection, module }
  const { projectionDigest: _ignored, ...withoutDigest } = body as Record<
    string,
    unknown
  >
  return { ...body, projectionDigest: digestGameIrValue(withoutDigest) }
}

describe('shared Phase 5 admission', () => {
  test('keeps Phase 5/6/Resource production isolated from generic admission', () => {
    const directory = dirname(fileURLToPath(import.meta.url))
    for (const filename of [
      'phase5-admission.ts',
      'phase6-admission.ts',
      'resource-realization-producer.ts',
    ]) {
      expect(readFileSync(join(directory, filename), 'utf8')).not.toContain(
        'semantic-admission',
      )
    }
  })

  test('characterizes Phase 5 packet identity and validator coverage', () => {
    const { validationPacket } = validationFixture()
    expect(validationPacket.sourceDigest).toBe(
      'e19389cdff7e7e0918bc1f306bc91236187370200b774b004c7f53e7ec8411f2',
    )
    expect(validationPacket.moduleDigest).toBe(
      '62fa55785eaab2aa6da9d73f0563a4d1bc2421cbc85475036434115950a2e750',
    )
    expect(validationPacket.targetManifestDigest).toBe(
      '246132885176344c28bd5170984710fc83f71d5d974a8eb6fdaf2cdb0f59a4d2',
    )
    expect(validationPacket.packetDigest).toBe(
      '7cbd28966a37fa30a228f4ee0f7770f268b128c6c8f0e733d751371a36fdd9d5',
    )
    expect(validationPacket.checkIds).toEqual([
      'domain.world-scene',
      'projection.ambiguity',
      'projection.completeness',
      'projection.cross-module-invariants',
      'projection.fidelity',
      'projection.source-bounds',
    ])
    expect(validationPacket.moduleBytes).toBe(
      '{"moduleId":"world-scene","nodes":[{"bindings":{"/id":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9","sectionId":"section-0","sourcePointer":"/bytes/0/5"},"/value/label":{"documentPath":"docs/GDD.md","kind":"owner","sectionDigest":"277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9","sectionId":"section-0","sourcePointer":"/bytes/0/5"}},"edges":[],"id":"bytes","kind":"world-scene.scene","producerMode":"semantic","references":[],"value":{"label":"bytes"}}]}',
    )
    const presentation = validationFixture('presentation').validationPacket
    expect(presentation.targetManifestDigest).toBe(
      'ee9380aaa0d3117783fd80470fb861af6d6a48d1f1f3e057e136d2dba0d1108f',
    )
    expect(presentation.checkIds).toEqual([
      'domain.presentation',
      'projection.ambiguity',
      'projection.completeness',
      'projection.cross-module-invariants',
      'projection.fidelity',
      'projection.source-bounds',
    ])
    expect(
      presentation.sourceSections.map(section => section.ref.documentPath),
    ).toEqual([
      'docs/ART_DIRECTION.md',
      'docs/AUDIO_DESIGN.md',
      'docs/GDD.md',
      'docs/UI_UX_SPEC.md',
    ])
  })

  test('preserves the exact validation-result object error contract', () => {
    const { validationPacket } = validationFixture()
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(
        validationPacket,
        null,
      ),
    ).toThrow(
      'invalid Game IR Phase 5 admission: fidelity validation result must be an object',
    )
  })

  test('reconstructs a fidelity packet from the complete external projection', () => {
    const { currentSource, validationPacket } = validationFixture()
    const packetWithAuthority = validationPacket as typeof validationPacket & {
      authoritySectionIndex: readonly GameIrSourceSection[]
    }
    expect(packetWithAuthority.authoritySectionIndex).toEqual(
      currentSource.authoritySectionIndex,
    )
    expect(packetWithAuthority.authoritySectionIndex).toHaveLength(8)
    expect(Object.isFrozen(packetWithAuthority.authoritySectionIndex)).toBe(
      true,
    )
    expect(
      validationPacket.externalProjections.gameplay.module.nodes,
    ).toHaveLength(1)
    expect(validationPacket.requiredTargets).toEqual([
      'node:bytes#/id',
      'node:bytes#/value/label',
    ])
    expect(validationPacket.checkIds.length).toBeGreaterThan(0)
    expect(
      validationPacket.externalProjections.gameplay.mechanicalReceiptDigest,
    ).not.toBe(validationPacket.mechanicalReceiptDigest)
    expect(
      validationPacket.externalProjections.gameplay.semanticReceiptDigest,
    ).not.toBe(validationPacket.semanticReceiptDigest)
    expect(Object.isFrozen(validationPacket)).toBe(true)
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(
        {
          ...validationPacket,
          externalProjections: {
            gameplay: {
              ...validationPacket.externalProjections.gameplay,
              foundationRevision: 'stale',
            },
          },
        } as never,
        {
          outcome: 'PASS',
          packetDigest: validationPacket.packetDigest,
          checkIds: validationPacket.checkIds,
          coveredTargets: validationPacket.requiredTargets,
        },
      ),
    ).toThrow(/projection|identity|stale/i)
  })

  test('reconstructs the Presentation branch with its full World projection', () => {
    const { validationPacket } = validationFixture('presentation')
    expect(validationPacket.moduleId).toBe('presentation')
    expect(validationPacket.externalProjections).toHaveProperty('gameplay')
    expect(validationPacket.externalProjections).toHaveProperty('worldScene')
    if (!('worldScene' in validationPacket.externalProjections))
      throw new Error('expected Presentation worldScene projection')
    expect(
      validationPacket.externalProjections.worldScene.sourceDigest,
    ).not.toBe(validationPacket.sourceDigest)
    const result = phase5Admission.admitPhase5SemanticValidationResult(
      validationPacket,
      {
        outcome: 'PASS',
        packetDigest: validationPacket.packetDigest,
        checkIds: validationPacket.checkIds,
        coveredTargets: validationPacket.requiredTargets,
      },
    )
    expect(result.outcome).toBe('PASS')
  })

  test('requires exact projection branches, fields, and replay identities', () => {
    const world = validationFixture().validationPacket
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(world, {
        outcome: 'PASS',
        packetDigest: world.packetDigest,
        checkIds: world.checkIds,
        coveredTargets: world.requiredTargets,
      }),
    ).not.toThrow()
    const gameplay = world.externalProjections.gameplay
    const projectionMutations = [
      {},
      { worldScene: gameplay },
      {
        gameplay: {
          ...gameplay,
          module: { moduleId: 'world-scene', nodes: [] },
        },
      },
      {
        gameplay: Object.fromEntries(
          Object.entries(gameplay).filter(
            ([key]) => key !== 'semanticReceiptDigest',
          ),
        ),
      },
      { gameplay: { ...gameplay, unexpected: true } },
      {
        gameplay: {
          ...gameplay,
          mechanicalReceiptDigest: 'b'.repeat(64),
        },
      },
    ]
    for (const externalProjections of projectionMutations) {
      expect(() =>
        phase5Admission.admitPhase5SemanticValidationResult(
          { ...world, externalProjections } as never,
          {
            outcome: 'PASS',
            packetDigest: world.packetDigest,
            checkIds: world.checkIds,
            coveredTargets: world.requiredTargets,
          },
        ),
      ).toThrow(/projection|field|identity|receipt|module|key/i)
    }

    const presentation = validationFixture('presentation').validationPacket
    if (!('worldScene' in presentation.externalProjections))
      throw new Error('expected Presentation worldScene projection')
    const staleWorld = {
      ...presentation.externalProjections.worldScene,
      sourceDigest: 'b'.repeat(64),
    }
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(
        {
          ...presentation,
          externalProjections: {
            ...presentation.externalProjections,
            worldScene: staleWorld,
          },
        } as never,
        {
          outcome: 'PASS',
          packetDigest: presentation.packetDigest,
          checkIds: presentation.checkIds,
          coveredTargets: presentation.requiredTargets,
        },
      ),
    ).toThrow(/world|source|stale|projection/i)
  })

  test('rejects caller digest, manifest, canonical-byte, and unknown-key mutations', () => {
    const { validationPacket } = validationFixture()
    for (const mutation of [
      { compileRequestDigest: 'b'.repeat(64) },
      { authoritySectionIndexDigest: 'b'.repeat(64) },
      { targetManifestDigest: 'b'.repeat(64) },
      { moduleBytes: `${validationPacket.moduleBytes} ` },
      { callerField: true },
    ]) {
      expect(() =>
        phase5Admission.admitPhase5SemanticValidationResult(
          { ...validationPacket, ...mutation } as never,
          {
            outcome: 'PASS',
            packetDigest: validationPacket.packetDigest,
            checkIds: validationPacket.checkIds,
            coveredTargets: validationPacket.requiredTargets,
          },
        ),
      ).toThrow(/digest|manifest|canonical|unknown|key|packet/i)
    }
  })

  test('reconstructs the complete authority index without expanding selected closure', () => {
    const { currentSource, validationPacket } = validationFixture()
    const authority = validationPacket.authoritySectionIndex
    expect(authority).toEqual(currentSource.authoritySectionIndex)
    expect(validationPacket.sourceSections).toHaveLength(2)
    expect(
      validationPacket.allowedEvidencePointers.filter(pointer =>
        pointer.startsWith('section:docs/ART_DIRECTION.md'),
      ),
    ).toHaveLength(0)
    const authorityOnly = authority.find(
      section => section.documentPath === 'docs/ART_DIRECTION.md',
    )!
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(validationPacket, {
        outcome: 'FAIL',
        packetDigest: validationPacket.packetDigest,
        reasonCode: 'missing-projection',
        actual: 'missing',
        missingSubject: validationPacket.requiredTargets[0],
        expectedProjection: 'node',
        evidencePointers: [
          `section:${authorityOnly.documentPath}#${authorityOnly.sectionId}@${authorityOnly.digest}`,
        ],
      }),
    ).toThrow(/evidence|coverage|section/i)

    const mutations = [
      authority.slice(1),
      [...authority, authority[0]],
      [...authority].reverse(),
      authority.map(section =>
        section.documentPath === 'docs/GDD.md'
          ? { ...section, startLine: 2 }
          : section,
      ),
      authority.map(section =>
        section.documentPath === 'docs/GDD.md'
          ? { ...section, digest: 'b'.repeat(64) }
          : section,
      ),
      authority.map(section =>
        section.documentPath === 'docs/GDD.md'
          ? { ...section, digest: 'invalid' }
          : section,
      ),
      authority.map(section =>
        section.documentPath === 'docs/GDD.md'
          ? { ...section, unknown: true }
          : section,
      ),
    ]
    for (const authoritySectionIndex of mutations) {
      const mutated = repackValidation(validationPacket, {
        authoritySectionIndex,
        authoritySectionIndexDigest: digestGameIrValue(authoritySectionIndex),
      })
      expect(() =>
        phase5Admission.admitPhase5SemanticValidationResult(mutated as never, {
          outcome: 'PASS',
          packetDigest: mutated.packetDigest,
          checkIds: validationPacket.checkIds,
          coveredTargets: validationPacket.requiredTargets,
        }),
      ).toThrow(
        /authority|index|canonical|document|member|digest|section|closure/i,
      )
    }
    const extraAuthoritySection = {
      documentPath: 'docs/GDD.md' as const,
      sectionId: 'section-extra-authority',
      heading: 'Extra authority section',
      startLine: 99,
      endLine: 99,
      digest,
    }
    const withDistinctExtra = [
      authority[0]!,
      extraAuthoritySection,
      ...authority.slice(1),
    ]
    const staleAuthorityDigest = repackValidation(validationPacket, {
      authoritySectionIndex: withDistinctExtra,
    })
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(
        staleAuthorityDigest as never,
        {
          outcome: 'PASS',
          packetDigest: staleAuthorityDigest.packetDigest,
          checkIds: validationPacket.checkIds,
          coveredTargets: validationPacket.requiredTargets,
        },
      ),
    ).toThrow(/authority|index|digest/i)
  })

  test('requires exact selected source closure and excludes authority-only evidence', () => {
    const { validationPacket } = validationFixture('world-scene', true)
    expect(validationPacket.sourceSections).toHaveLength(3)
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(validationPacket, {
        outcome: 'PASS',
        packetDigest: validationPacket.packetDigest,
        checkIds: validationPacket.checkIds,
        coveredTargets: validationPacket.requiredTargets,
      }),
    ).not.toThrow()

    const extraRef = validationPacket.sourceSections.find(
      section => section.ref.sectionId === 'section-extra',
    )!.ref
    const withoutExtra = repackValidation(validationPacket, {
      sourceSections: validationPacket.sourceSections.filter(
        section => section.ref.sectionId !== extraRef.sectionId,
      ),
      allowedEvidencePointers: validationPacket.allowedEvidencePointers.filter(
        pointer => !pointer.includes(`#${extraRef.sectionId}@`),
      ),
    })
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(withoutExtra, {
        outcome: 'PASS',
        packetDigest: withoutExtra.packetDigest,
        checkIds: withoutExtra.checkIds,
        coveredTargets: withoutExtra.requiredTargets,
      }),
    ).toThrow(/closure|selected|source|section/i)

    const authorityOnly = validationPacket.authoritySectionIndex.find(
      section => section.documentPath === 'docs/ART_DIRECTION.md',
    )!
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(validationPacket, {
        outcome: 'FAIL',
        packetDigest: validationPacket.packetDigest,
        reasonCode: 'missing-projection',
        actual: 'missing',
        missingSubject: validationPacket.requiredTargets[0],
        expectedProjection: 'node',
        evidencePointers: [
          `section:${authorityOnly.documentPath}#${authorityOnly.sectionId}@${authorityOnly.digest}`,
        ],
      }),
    ).toThrow(/evidence|coverage|section/i)
  })

  test('rejects caller-supplied derived packet fields at the builder boundary', () => {
    const { builderInput } = validationFixture()
    for (const field of [
      { checkIds: [] },
      { targetManifestDigest: digest },
      { authoritySectionIndex: [] },
    ]) {
      expect(() =>
        phase5Admission.buildPhase5SemanticValidationPacket({
          ...builderInput,
          ...field,
        } as never),
      ).toThrow(/unknown|missing|field|key/i)
    }
  })

  test('delegates reference, edge, and binding invariants to Core', () => {
    const { validationPacket } = validationFixture()
    const baseline = JSON.parse(validationPacket.moduleBytes) as {
      nodes: Array<Record<string, unknown>>
    }
    const node = baseline.nodes[0]!
    const owner = (node.bindings as Record<string, unknown>)['/id']
    const validModule = {
      ...baseline,
      nodes: [
        {
          ...node,
          references: [
            { targetId: 'player', targetType: 'gameplay.entity' },
            { targetId: 'zombie', targetType: 'gameplay.entity' },
          ],
          edges: [
            {
              type: 'alpha',
              targetId: 'scene',
              targetType: 'world-scene.scene',
            },
            {
              type: 'root',
              targetId: 'scene',
              targetType: 'world-scene.scene',
            },
          ],
          bindings: {
            ...(node.bindings as Record<string, unknown>),
            '/references/0': owner,
            '/references/1': owner,
            '/edges/0': owner,
            '/edges/1': owner,
          },
        },
      ],
    }
    const validPacket = repack(validationPacket, validModule)
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(validPacket, {
        outcome: 'PASS',
        packetDigest: validPacket.packetDigest,
        checkIds: validPacket.checkIds,
        coveredTargets: validPacket.requiredTargets,
      }),
    ).not.toThrow()
    const descending = {
      ...validModule,
      nodes: [
        {
          ...validModule.nodes[0],
          references: [
            ...(validModule.nodes[0]!.references as unknown[]),
          ].reverse(),
        },
      ],
    }
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(
        repack(validationPacket, descending),
        {
          outcome: 'PASS',
          packetDigest: repack(validationPacket, descending).packetDigest,
          checkIds: validationPacket.checkIds,
          coveredTargets: validationPacket.requiredTargets,
        },
      ),
    ).toThrow(/sorted|reference/i)
    const descendingEdges = {
      ...validModule,
      nodes: [
        {
          ...validModule.nodes[0],
          edges: [...(validModule.nodes[0]!.edges as unknown[])].reverse(),
        },
      ],
    }
    const descendingEdgesPacket = repack(validationPacket, descendingEdges)
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(
        descendingEdgesPacket,
        {
          outcome: 'PASS',
          packetDigest: descendingEdgesPacket.packetDigest,
          checkIds: descendingEdgesPacket.checkIds,
          coveredTargets: descendingEdgesPacket.requiredTargets,
        },
      ),
    ).toThrow(/sorted|edge/i)
    for (const mutation of [
      {
        ...validModule,
        nodes: [
          {
            ...validModule.nodes[0],
            edges: [
              {
                type: 'reference',
                targetId: 'scene',
                targetType: 'world-scene.scene',
              },
              {
                type: 'root',
                targetId: 'scene',
                targetType: 'world-scene.scene',
              },
            ],
          },
        ],
      },
      {
        ...validModule,
        nodes: [
          {
            ...validModule.nodes[0],
            bindings: {
              ...(validModule.nodes[0]!.bindings as Record<string, unknown>),
              '/references/9': owner,
            },
          },
        ],
      },
      {
        ...validModule,
        nodes: [
          {
            ...validModule.nodes[0],
            producerMode: 'derived',
            bindings: {
              ...(validModule.nodes[0]!.bindings as Record<string, unknown>),
              '/value/label': {
                kind: 'derived',
                derivationRuleId: 'cycle',
                inputs: [{ kind: 'local', pointer: '/value/label' }],
              },
            },
          },
        ],
      },
    ]) {
      const mutatedPacket = repack(validationPacket, mutation)
      expect(() =>
        phase5Admission.admitPhase5SemanticValidationResult(mutatedPacket, {
          outcome: 'PASS',
          packetDigest: mutatedPacket.packetDigest,
          checkIds: mutatedPacket.checkIds,
          coveredTargets: mutatedPacket.requiredTargets,
        }),
      ).toThrow(/reserved|binding|derived|cycle|reference|conflicts/i)
    }
  })

  test('rejects Core-invalid external projections after all digest recomputation', () => {
    const { validationPacket } = validationFixture()
    const gameplay = validationPacket.externalProjections.gameplay
    const node = gameplay.module.nodes[0]!
    const invalidModule = {
      ...gameplay.module,
      nodes: [
        {
          ...node,
          edges: [
            {
              type: 'reference',
              targetId: node.id,
              targetType: node.kind,
            },
          ],
          bindings: {
            ...node.bindings,
            '/edges/0': node.bindings['/id'],
          },
        },
      ],
    }
    const invalidProjection = repackExternalProjection(
      gameplay as unknown as Record<string, unknown>,
      invalidModule,
    )
    const invalidPacket = repackValidation(validationPacket, {
      externalProjections: { gameplay: invalidProjection },
    })
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(
        invalidPacket as never,
        {
          outcome: 'PASS',
          packetDigest: invalidPacket.packetDigest,
          checkIds: validationPacket.checkIds,
          coveredTargets: validationPacket.requiredTargets,
        },
      ),
    ).toThrow(/reserved|reference|Core|edge/i)
  })

  test('admits only exact service-owned PASS coverage', () => {
    const { validationPacket } = validationFixture()
    const pass = phase5Admission.admitPhase5SemanticValidationResult(
      validationPacket,
      {
        outcome: 'PASS',
        packetDigest: validationPacket.packetDigest,
        checkIds: validationPacket.checkIds,
        coveredTargets: validationPacket.requiredTargets,
      },
    )
    expect(pass).toEqual({
      outcome: 'PASS',
      packetDigest: validationPacket.packetDigest,
      checkIds: validationPacket.checkIds,
      coveredTargets: validationPacket.requiredTargets,
    })
    for (const mutation of [
      { checkIds: validationPacket.checkIds.slice(1) },
      { coveredTargets: validationPacket.requiredTargets.slice(1) },
      {
        coveredTargets: [
          ...validationPacket.requiredTargets,
          validationPacket.requiredTargets[0],
        ],
      },
      { checkIds: [...validationPacket.checkIds].reverse() },
      { coveredTargets: [...validationPacket.requiredTargets].reverse() },
    ]) {
      expect(() =>
        phase5Admission.admitPhase5SemanticValidationResult(validationPacket, {
          outcome: 'PASS',
          packetDigest: validationPacket.packetDigest,
          checkIds: validationPacket.checkIds,
          coveredTargets: validationPacket.requiredTargets,
          ...mutation,
        }),
      ).toThrow(/coverage|check|target|exact/i)
    }
    for (const invalid of [
      true,
      { outcome: 'PASS', packetDigest: validationPacket.packetDigest },
      {
        outcome: 'PASS',
        packetDigest: 'b'.repeat(64),
        checkIds: [],
        coveredTargets: [],
      },
    ]) {
      expect(() =>
        phase5Admission.admitPhase5SemanticValidationResult(
          validationPacket,
          invalid,
        ),
      ).toThrow(/PASS|coverage|digest|object|key/i)
    }
  })

  test('binds mismatch evidence separately from section diagnostics', () => {
    const { validationPacket } = validationFixture()
    const sectionEvidence = validationPacket.allowedEvidencePointers.find(
      pointer => pointer.startsWith('section:'),
    )!
    const bindingEvidence = validationPacket.allowedEvidencePointers.find(
      pointer => pointer.startsWith('binding:'),
    )!
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(validationPacket, {
        outcome: 'FAIL',
        packetDigest: validationPacket.packetDigest,
        reasonCode: 'projection-mismatch',
        actual: 'different',
        evidencePointers: [sectionEvidence],
      }),
    ).toThrow(/owner|binding/i)
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(validationPacket, {
        outcome: 'FAIL',
        packetDigest: validationPacket.packetDigest,
        reasonCode: 'missing-projection',
        actual: 'missing',
        missingSubject: validationPacket.requiredTargets[0],
        expectedProjection: 'node',
        evidencePointers: [bindingEvidence],
      }),
    ).toThrow(/section|evidence/i)
    const admitted = phase5Admission.admitPhase5SemanticValidationResult(
      validationPacket,
      {
        outcome: 'FAIL',
        packetDigest: validationPacket.packetDigest,
        reasonCode: 'missing-projection',
        actual: 'missing',
        missingSubject: validationPacket.requiredTargets[0],
        expectedProjection: 'node',
        evidencePointers: [sectionEvidence],
      },
    )
    expect(admitted.outcome).toBe('FAIL')
    const ambiguous = phase5Admission.admitPhase5SemanticValidationResult(
      validationPacket,
      {
        outcome: 'AMBIGUOUS',
        packetDigest: validationPacket.packetDigest,
        reasonCode: 'ambiguous-projection',
        actual: 'ambiguous',
        missingSubject: validationPacket.requiredTargets[0],
        expectedProjection: 'node',
        evidencePointers: [sectionEvidence],
      },
    )
    expect(ambiguous.outcome).toBe('AMBIGUOUS')
    expect(Object.isFrozen(ambiguous)).toBe(true)
    if ('evidencePointers' in ambiguous)
      expect(Object.isFrozen(ambiguous.evidencePointers)).toBe(true)
  })

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

  test('rejects a current module relabel after its inner digests are recomputed', () => {
    const { validationPacket } = validationFixture()
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(validationPacket, {
        outcome: 'PASS',
        packetDigest: validationPacket.packetDigest,
        checkIds: validationPacket.checkIds,
        coveredTargets: validationPacket.requiredTargets,
      }),
    ).not.toThrow()
    const module = JSON.parse(validationPacket.moduleBytes) as Record<
      string,
      unknown
    >
    const relabeledModule = { ...module, moduleId: 'presentation' }
    const relabeledPacket = repackValidation(validationPacket, {
      moduleBytes: canonicalGameIrJson(relabeledModule),
      moduleDigest: digestGameIrValue(relabeledModule),
    })
    expect(relabeledPacket.moduleId).toBe('world-scene')
    expect(() =>
      phase5Admission.admitPhase5SemanticValidationResult(relabeledPacket, {
        outcome: 'PASS',
        packetDigest: relabeledPacket.packetDigest,
        checkIds: relabeledPacket.checkIds,
        coveredTargets: relabeledPacket.requiredTargets,
      }),
    ).toThrow(/module|expected|identity|Core/i)
  })

  test('deep-freezes deterministic packet and PASS, FAIL, and AMBIGUOUS results', () => {
    const first = validationFixture().validationPacket
    const second = validationFixture().validationPacket
    expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
    expect(first.packetDigest).toBe(second.packetDigest)
    expectDeepFrozen(first)
    const pass = phase5Admission.admitPhase5SemanticValidationResult(first, {
      outcome: 'PASS',
      packetDigest: first.packetDigest,
      checkIds: first.checkIds,
      coveredTargets: first.requiredTargets,
    })
    expectDeepFrozen(pass)
    const selectedEvidence = first.allowedEvidencePointers.find(pointer =>
      pointer.startsWith('section:'),
    )!
    const fail = phase5Admission.admitPhase5SemanticValidationResult(first, {
      outcome: 'FAIL',
      packetDigest: first.packetDigest,
      reasonCode: 'missing-projection',
      actual: 'missing',
      missingSubject: first.requiredTargets[0],
      expectedProjection: 'node',
      evidencePointers: [selectedEvidence],
    })
    expectDeepFrozen(fail)
    const ambiguous = phase5Admission.admitPhase5SemanticValidationResult(
      first,
      {
        outcome: 'AMBIGUOUS',
        packetDigest: first.packetDigest,
        reasonCode: 'ambiguous-projection',
        actual: 'ambiguous',
        missingSubject: first.requiredTargets[0],
        expectedProjection: 'node',
        evidencePointers: [selectedEvidence],
      },
    )
    expectDeepFrozen(ambiguous)
  })
})
