import { createHash } from 'node:crypto'
import { canonicalGameIrJson, compareCodeUnits, digestGameIrValue } from './model'
import { GAME_IR_SCHEMA_VERSION } from './contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'
import { buildGameIrDomainSourceEnvelope } from './domain-source'
import { admitGameIrMechanicalProjectionReceipt } from './domain-projection'
import { buildGameplaySemanticPacket, admitGameplaySemanticResult } from './gameplay-producer'
import { buildBalanceSemanticPacket, admitBalanceSemanticResult } from './balance-producer'
import { buildWorldSceneSemanticPacket, admitWorldSceneSemanticResult, type WorldSceneSemanticReceipt } from './world-scene-producer'
import { buildPresentationSemanticPacket, admitPresentationSemanticResult, type PresentationSemanticReceipt } from './presentation-producer'
import { admitPhase5SemanticValidationResult } from './phase5-admission'
import { preparePresentationSemanticValidationPacket, prepareWorldSceneSemanticValidationPacket } from './world-presentation-assembler'
import type { ResourceRealizationSemanticProjectionAuthority } from './resource-realization-producer'

export function realAuthority(): ResourceRealizationSemanticProjectionAuthority {
  type Node = {
    id: string
    kind: string
    value: Record<string, unknown>
    references: readonly { targetId: string; targetType: string }[]
    edges: readonly { type: string; targetId: string; targetType: string }[]
  }
  const gameplayNodes: Node[] = [
    {
      id: 'state-start',
      kind: 'gameplay.state',
      value: { label: 'Start', initial: true, terminal: 'none' },
      references: [],
      edges: [],
    },
  ]
  const balanceNodes: Node[] = [
    {
      id: 'balance-unit',
      kind: 'balance.unit',
      value: {
        symbol: 'unit',
        dimensions: [],
        scale: { numerator: 1, denominator: 1 },
      },
      references: [],
      edges: [],
    },
  ]
  const worldNodes: Node[] = [
    {
      id: 'world-scene-main',
      kind: 'world-scene.scene',
      value: {
        label: 'Main',
        coordinateConvention: {
          dimensions: '2d',
          xDirection: 'right',
          yDirection: 'up',
          distanceUnit: 'meter',
        },
      },
      references: [],
      edges: [
        {
          type: 'root',
          targetId: 'world-node-root',
          targetType: 'world-scene.node',
        },
      ],
    },
    {
      id: 'world-node-root',
      kind: 'world-scene.node',
      value: {
        label: 'Root',
        nodeType: 'container',
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
        {
          type: 'scene',
          targetId: 'world-scene-main',
          targetType: 'world-scene.scene',
        },
      ],
    },
  ]
  const presentationNodes: Node[] = [
    {
      id: 'presentation-screen-main',
      kind: 'presentation.ui-screen',
      value: {
        label: 'Main',
        modal: false,
        requirements: [
          { requirementId: 'screen-main', kind: 'ui', runtimeRole: 'screen' },
        ],
      },
      references: [],
      edges: [
        {
          type: 'driven-by',
          targetId: 'state-start',
          targetType: 'gameplay.state',
        },
        {
          type: 'initial-state',
          targetId: 'presentation-state-main',
          targetType: 'presentation.ui-state',
        },
      ],
    },
    {
      id: 'presentation-state-main',
      kind: 'presentation.ui-state',
      value: { label: 'Main', terminal: false },
      references: [],
      edges: [
        {
          type: 'driven-by',
          targetId: 'state-start',
          targetType: 'gameplay.state',
        },
        {
          type: 'screen',
          targetId: 'presentation-screen-main',
          targetType: 'presentation.ui-screen',
        },
      ],
    },
  ]
  const leafPointers = (value: Record<string, unknown>): string[] => {
    const output: string[] = []
    const visit = (entry: unknown, pointer: string): void => {
      if (Array.isArray(entry)) {
        if (entry.length === 0) output.push(pointer)
        else
          entry.forEach((child, index) => visit(child, `${pointer}/${index}`))
      } else if (entry && typeof entry === 'object') {
        const entries = Object.entries(entry as Record<string, unknown>)
        if (entries.length === 0) output.push(pointer)
        else
          entries.forEach(([key, child]) => visit(child, `${pointer}/${key}`))
      } else output.push(pointer)
    }
    Object.entries(value).forEach(([key, child]) =>
      visit(child, `/value/${key}`),
    )
    return output
  }
  const pointers = (node: Node): string[] => [
    '/id',
    ...leafPointers(node.value),
    ...node.references.map((_, index) => `/references/${index}`),
    ...node.edges.map((_, index) => `/edges/${index}`),
  ]
  const valueAt = (node: Node, pointer: string): unknown => {
    if (pointer === '/id') return node.id
    if (pointer.startsWith('/references/'))
      return node.references[Number(pointer.slice('/references/'.length))]
    if (pointer.startsWith('/edges/'))
      return node.edges[Number(pointer.slice('/edges/'.length))]
    let current: unknown = node.value
    for (const segment of pointer.slice(7).split('/')) {
      if (current && typeof current === 'object')
        current = (current as Record<string, unknown>)[segment]
      else return undefined
    }
    return current
  }
  const literal = (value: unknown): string =>
    typeof value === 'string' ? value : canonicalGameIrJson(value)
  const allNodes = [
    ...gameplayNodes,
    ...balanceNodes,
    ...worldNodes,
    ...presentationNodes,
  ]
  const baseSourceBytes = allNodes
    .flatMap(node =>
      pointers(node).map(pointer => literal(valueAt(node, pointer))),
    )
    .join('\n')
  const resourceSourceBytes = [
    baseSourceBytes,
    'player-model', 'resource.requirement.player-model', 'profile-main', 'target-main',
    'profile-screen-main', 'variant-screen-main', 'artifact-screen-main',
    'variant-main', 'artifact-main', 'model', 'player', '3D', 'character', 'agent-authored',
    'project-license', 'art-team', 'runtime-import-ready', 'glb', 'skinned',
    'stylized', 'desktop', 'web', 'required', 'true',
    'assets/runtime/player-model.glb', 'assets/runtime/screen-main.svg',
    'runtime-resource', '2D', 'ui-screen', 'ui', 'ui-states', 'svg', 'screen',
    canonicalGameIrJson({ type: 'required-by', targetId: 'state-start', targetType: 'gameplay.state' }),
    canonicalGameIrJson({ type: 'describes', targetId: 'resource.requirement.player-model', targetType: 'resource-realization.logical-resource' }),
    canonicalGameIrJson({ type: 'realizes', targetId: 'resource.requirement.player-model', targetType: 'resource-realization.logical-resource' }),
    canonicalGameIrJson({ type: 'part-of', targetId: 'variant-main', targetType: 'resource-realization.variant' }),
    canonicalGameIrJson({ type: 'describes', targetId: 'resource.requirement.screen-main', targetType: 'resource-realization.logical-resource' }),
    canonicalGameIrJson({ type: 'realizes', targetId: 'resource.requirement.screen-main', targetType: 'resource-realization.logical-resource' }),
    canonicalGameIrJson({ type: 'part-of', targetId: 'variant-screen-main', targetType: 'resource-realization.variant' }),
  ].join('\n')
  const hash = (value: string): string =>
    createHash('sha256').update(value, 'utf8').digest('hex')
  const resourceDocuments = new Set([
    'docs/ASSET_PLAN.md',
    'docs/TECHNICAL_DESIGN.md',
  ])
  const bytesFor = (documentPath: string): string =>
    resourceDocuments.has(documentPath) ? resourceSourceBytes : baseSourceBytes
  const sectionIndex = CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `section-${index}`,
      heading: documentPath,
      startLine: 1,
      endLine: bytesFor(documentPath).split('\n').length,
      digest: hash(bytesFor(documentPath)),
    }),
  )
  const foundationBody = {
    schemaVersion: 'foundation-ready-receipt.v1' as const,
    projectId: 'resource-producer-fixture',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: 'a'.repeat(64),
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, hash(bytesFor(path))]),
    ) as Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>,
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    authority: {
      kind: 'review' as const,
      reviewDigest: 'b'.repeat(64),
      issueRegistryDigest: 'c'.repeat(64),
    },
  }
  const request = {
    schemaVersion: 'game-ir-compile-request.v1' as const,
    taskId: 'resource-producer-fixture',
    publicationId: 'resource-producer-publication',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundationBody,
      receiptDigest: digestGameIrValue(foundationBody),
    },
  }
  const source = (
    moduleId:
      | 'gameplay'
      | 'balance'
      | 'world-scene'
      | 'presentation'
      | 'resource-realization',
  ) => {
    const documents =
      moduleId === 'gameplay'
        ? ['docs/GDD.md']
        : moduleId === 'balance'
          ? ['docs/GDD.md', 'docs/BALANCE_DESIGN.md']
          : moduleId === 'world-scene'
            ? ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md']
            : moduleId === 'presentation'
              ? [
                  'docs/GDD.md',
                  'docs/ART_DIRECTION.md',
                  'docs/UI_UX_SPEC.md',
                  'docs/AUDIO_DESIGN.md',
                ]
              : [
                  'docs/ASSET_PLAN.md',
                  'docs/TECHNICAL_DESIGN.md',
                  'docs/ART_DIRECTION.md',
                  'docs/UI_UX_SPEC.md',
                  'docs/AUDIO_DESIGN.md',
                  'docs/LEVEL_SCENE_DESIGN.md',
                ]
    return buildGameIrDomainSourceEnvelope({
      moduleId,
      request,
      sectionIndex,
      sectionBytes: Object.fromEntries(
        sectionIndex
          .filter(section => documents.includes(section.documentPath))
          .map(section => [
            `${section.documentPath}#${section.sectionId}`,
            bytesFor(section.documentPath),
          ]),
      ),
    })
  }
  const claims = (nodes: readonly Node[]) =>
    nodes
      .flatMap(node =>
        pointers(node).map(pointer => {
          const value = literal(valueAt(node, pointer))
          const offset = baseSourceBytes.indexOf(value)
          return {
            subject: `node:${node.id}#${pointer}`,
            documentPath: 'docs/GDD.md' as const,
            sectionId: 'section-0',
            sourcePointer: `/bytes/${Buffer.byteLength(baseSourceBytes.slice(0, offset), 'utf8')}/${Buffer.byteLength(baseSourceBytes.slice(0, offset + value.length), 'utf8')}`,
            literal: value,
          }
        }),
      )
      .sort((left, right) =>
        compareCodeUnits(
          `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
          `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
        ),
      )
  const mechanical = (currentSource: ReturnType<typeof source>) => {
    const body = {
      schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
      taskId: currentSource.taskId,
      moduleId: currentSource.moduleId,
      foundationRevision: request.foundation.foundationRevision,
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
  const gameplaySource = source('gameplay')
  const balanceSource = source('balance')
  const gameplayMechanical = mechanical(gameplaySource)
  const balanceMechanical = mechanical(balanceSource)
  const gameplaySemantic = admitGameplaySemanticResult(
    buildGameplaySemanticPacket({
      source: gameplaySource,
      mechanical: gameplayMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: gameplayNodes,
      sourceClaims: claims(gameplayNodes),
    },
  )
  const balanceSemantic = admitBalanceSemanticResult(
    buildBalanceSemanticPacket({
      source: balanceSource,
      mechanical: balanceMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: balanceNodes,
      sourceClaims: claims(balanceNodes),
    },
  )
  const phase4Authority = {
    gameplay: {
      source: gameplaySource,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic as never,
    },
    balance: {
      source: balanceSource,
      mechanical: balanceMechanical,
      semantic: balanceSemantic as never,
    },
  }
  const worldSource = source('world-scene')
  const worldMechanical = mechanical(worldSource)
  const worldSemantic = admitWorldSceneSemanticResult(
    buildWorldSceneSemanticPacket({
      source: worldSource,
      mechanical: worldMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: worldNodes,
      sourceClaims: claims(worldNodes),
    },
  ) as WorldSceneSemanticReceipt
  const worldValidationPacket = prepareWorldSceneSemanticValidationPacket({
    phase4Authority,
    worldScene: {
      source: worldSource,
      mechanical: worldMechanical,
      semantic: worldSemantic,
    },
  })
  const worldValidation = admitPhase5SemanticValidationResult(
    worldValidationPacket,
    {
      outcome: 'PASS',
      packetDigest: worldValidationPacket.packetDigest,
      checkIds: worldValidationPacket.checkIds,
      coveredTargets: worldValidationPacket.requiredTargets,
    },
  )
  const presentationSource = source('presentation')
  const presentationMechanical = mechanical(presentationSource)
  const presentationSemantic = admitPresentationSemanticResult(
    buildPresentationSemanticPacket({
      source: presentationSource,
      mechanical: presentationMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: presentationNodes,
      sourceClaims: claims(presentationNodes),
    },
  ) as PresentationSemanticReceipt
  const presentationValidationPacket =
    preparePresentationSemanticValidationPacket({
      phase4Authority,
      worldScene: {
        source: worldSource,
        mechanical: worldMechanical,
        semantic: worldSemantic,
        validation: worldValidation,
      },
      presentation: {
        source: presentationSource,
        mechanical: presentationMechanical,
        semantic: presentationSemantic,
      },
    })
  const presentationValidation = admitPhase5SemanticValidationResult(
    presentationValidationPacket,
    {
      outcome: 'PASS',
      packetDigest: presentationValidationPacket.packetDigest,
      checkIds: presentationValidationPacket.checkIds,
      coveredTargets: presentationValidationPacket.requiredTargets,
    },
  )
  const phase5Authority = {
    phase4Authority,
    worldScene: {
      source: worldSource,
      mechanical: worldMechanical,
      semantic: worldSemantic,
      validation: worldValidation,
    },
    presentation: {
      source: presentationSource,
      mechanical: presentationMechanical,
      semantic: presentationSemantic,
      validation: presentationValidation,
    },
  }
  const resourceSource = source('resource-realization')
  const resourceMechanical = mechanical(resourceSource)
  return {
    phase5Authority,
    resourceRealization: {
      source: resourceSource,
      mechanical: resourceMechanical,
    },
  }
}
