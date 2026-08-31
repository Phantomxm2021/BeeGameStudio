import { createHash } from 'node:crypto'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
} from './model'
import { GAME_IR_SCHEMA_VERSION } from './contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'
import { buildGameIrDomainSourceEnvelope } from './domain-source'
import { admitGameIrMechanicalProjectionReceipt } from './domain-projection'
import {
  buildGameplaySemanticPacket,
  admitGameplaySemanticResult,
} from './gameplay-producer'
import {
  buildBalanceSemanticPacket,
  admitBalanceSemanticResult,
} from './balance-producer'
import {
  buildWorldSceneSemanticPacket,
  admitWorldSceneSemanticResult,
  type WorldSceneSemanticReceipt,
} from './world-scene-producer'
import {
  buildPresentationSemanticPacket,
  admitPresentationSemanticResult,
  type PresentationSemanticReceipt,
} from './presentation-producer'
import { admitPhase5SemanticValidationResult } from './phase5-admission'
import {
  preparePresentationSemanticValidationPacket,
  prepareWorldSceneSemanticValidationPacket,
} from './world-presentation-assembler'
import type {
  ResourceRealizationSemanticProjectionAuthority,
  ResourceRealizationSemanticProjectionPacket,
  ResourceRealizationSemanticReceipt,
} from './resource-realization-producer'
import type { ResourceRealizationValidationPreparationAuthority } from './phase6-admission'

export type ResourceFixtureNode = {
  id: string
  kind: string
  value: Record<string, unknown>
  references: { targetId: string; targetType: string }[]
  edges: { type: string; targetId: string; targetType: string }[]
}

export type PresentationRequirementFixture = {
  requirementId: string
  kind: 'ui'
  runtimeRole: 'screen'
  owner?: 'main' | 'secondary'
}

export function realAuthority(
  options: {
    presentationRequirements?: readonly PresentationRequirementFixture[]
  } = {},
): ResourceRealizationSemanticProjectionAuthority {
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
  const presentationRequirements = options.presentationRequirements ?? [
    { requirementId: 'screen-main', kind: 'ui', runtimeRole: 'screen' },
  ]
  const mainRequirements = presentationRequirements.filter(
    requirement => requirement.owner !== 'secondary',
  )
  const secondaryRequirements = presentationRequirements.filter(
    requirement => requirement.owner === 'secondary',
  )
  const presentationNodes: Node[] = [
    {
      id: 'presentation-screen-main',
      kind: 'presentation.ui-screen',
      value: {
        label: 'Main',
        modal: false,
        requirements: mainRequirements.map(
          ({ requirementId, kind, runtimeRole }) => ({
            requirementId,
            kind,
            runtimeRole,
          }),
        ),
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
    ...(secondaryRequirements.length > 0
      ? [
          {
            id: 'presentation-screen-secondary',
            kind: 'presentation.ui-screen',
            value: {
              label: 'Secondary',
              modal: false,
              requirements: secondaryRequirements.map(
                ({ requirementId, kind, runtimeRole }) => ({
                  requirementId,
                  kind,
                  runtimeRole,
                }),
              ),
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
                targetId: 'presentation-state-secondary',
                targetType: 'presentation.ui-state',
              },
            ],
          },
        ]
      : []),
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
    ...(secondaryRequirements.length > 0
      ? [
          {
            id: 'presentation-state-secondary',
            kind: 'presentation.ui-state',
            value: { label: 'Secondary', terminal: false },
            references: [],
            edges: [
              {
                type: 'driven-by',
                targetId: 'state-start',
                targetType: 'gameplay.state',
              },
              {
                type: 'screen',
                targetId: 'presentation-screen-secondary',
                targetType: 'presentation.ui-screen',
              },
            ],
          },
        ]
      : []),
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
    ...presentationRequirements.flatMap(({ requirementId }) => [
      `profile-${requirementId}`,
      `variant-${requirementId}`,
      `artifact-${requirementId}`,
      `assets/runtime/${requirementId}.svg`,
      canonicalGameIrJson({
        type: 'describes',
        targetId: `resource.requirement.${requirementId}`,
        targetType: 'resource-realization.logical-resource',
      }),
      canonicalGameIrJson({
        type: 'realizes',
        targetId: `resource.requirement.${requirementId}`,
        targetType: 'resource-realization.logical-resource',
      }),
      canonicalGameIrJson({
        type: 'part-of',
        targetId: `variant-${requirementId}`,
        targetType: 'resource-realization.variant',
      }),
    ]),
    'player-model',
    'resource.requirement.player-model',
    'profile-main',
    'target-main',
    'profile-screen-main',
    'variant-screen-main',
    'artifact-screen-main',
    'variant-main',
    'artifact-main',
    'model',
    'player',
    '3D',
    'character',
    'agent-authored',
    'project-license',
    'art-team',
    'runtime-import-ready',
    'glb',
    'skinned',
    'stylized',
    'desktop',
    'web',
    'required',
    'true',
    'assets/runtime/player-model.glb',
    'assets/runtime/screen-main.svg',
    'assets/runtime/../evil.glb',
    'assets/runtime/player-model.txt',
    'target-secondary',
    'observed',
    'actualResource',
    '角色',
    'ui-asset',
    canonicalGameIrJson(['glb']),
    'runtime-resource',
    '2D',
    'ui-screen',
    'ui',
    'ui-states',
    'svg',
    'screen',
    canonicalGameIrJson({
      type: 'required-by',
      targetId: 'state-start',
      targetType: 'gameplay.state',
    }),
    canonicalGameIrJson({
      type: 'describes',
      targetId: 'resource.requirement.player-model',
      targetType: 'resource-realization.logical-resource',
    }),
    canonicalGameIrJson({
      type: 'realizes',
      targetId: 'resource.requirement.player-model',
      targetType: 'resource-realization.logical-resource',
    }),
    canonicalGameIrJson({
      type: 'part-of',
      targetId: 'variant-main',
      targetType: 'resource-realization.variant',
    }),
    canonicalGameIrJson({
      type: 'describes',
      targetId: 'resource.requirement.screen-main',
      targetType: 'resource-realization.logical-resource',
    }),
    canonicalGameIrJson({
      type: 'realizes',
      targetId: 'resource.requirement.screen-main',
      targetType: 'resource-realization.logical-resource',
    }),
    canonicalGameIrJson({
      type: 'part-of',
      targetId: 'variant-screen-main',
      targetType: 'resource-realization.variant',
    }),
  ].join('\n')
  const hash = (value: string): string =>
    createHash('sha256').update(value, 'utf8').digest('hex')
  const assetProfileSectionBytes = [
    'asset-plan-profile-section',
    'profile-main',
    'resource.requirement.player-model',
    'model',
    'player',
    '3D',
    'character',
    'agent-authored',
    'project-license',
    'art-team',
    'runtime-import-ready',
    'skinned',
    'stylized',
    'true',
    canonicalGameIrJson({
      type: 'describes',
      targetId: 'resource.requirement.player-model',
      targetType: 'resource-realization.logical-resource',
    }),
    '角色',
  ].join('\n')
  const technicalSectionBytes = [
    'technical-design-section',
    resourceSourceBytes,
  ].join('\n')
  const bytesFor = (documentPath: string): string =>
    documentPath === 'docs/ASSET_PLAN.md'
      ? `${resourceSourceBytes}\n${assetProfileSectionBytes}`
      : documentPath === 'docs/TECHNICAL_DESIGN.md'
        ? technicalSectionBytes
        : baseSourceBytes
  const bytesForSection = (documentPath: string, sectionId: string): string => {
    if (documentPath === 'docs/ASSET_PLAN.md')
      return sectionId === 'section-asset-extra'
        ? assetProfileSectionBytes
        : resourceSourceBytes
    return documentPath === 'docs/TECHNICAL_DESIGN.md'
      ? technicalSectionBytes
      : baseSourceBytes
  }
  const sectionIndex = [
    ...CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `section-${index}`,
      heading: documentPath,
      startLine: 1,
      endLine:
        documentPath === 'docs/ASSET_PLAN.md'
          ? resourceSourceBytes.split('\n').length
          : bytesFor(documentPath).split('\n').length,
      digest: hash(
        documentPath === 'docs/ASSET_PLAN.md'
          ? resourceSourceBytes
          : bytesFor(documentPath),
      ),
    })),
    {
      documentPath: 'docs/ASSET_PLAN.md' as const,
      sectionId: 'section-asset-extra',
      heading: 'Asset plan details',
      startLine: resourceSourceBytes.split('\n').length + 1,
      endLine:
        resourceSourceBytes.split('\n').length +
        assetProfileSectionBytes.split('\n').length,
      digest: hash(assetProfileSectionBytes),
    },
  ]
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
            bytesForSection(section.documentPath, section.sectionId),
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

export function completeResourceInput(
  packet: ResourceRealizationSemanticProjectionPacket,
  sourceBytes: Readonly<Record<string, string>>,
  artifactRuntimeRole = 'player',
  mutate?: (nodes: ResourceFixtureNode[]) => ResourceFixtureNode[],
) {
  const baseNodes: ResourceFixtureNode[] = [
    {
      id: 'resource.requirement.player-model',
      kind: 'resource-realization.logical-resource',
      value: {
        requirementId: 'player-model',
        resourceKind: 'model',
        runtimeRole: 'player',
      },
      references: [],
      edges: [
        {
          type: 'required-by',
          targetId: 'state-start',
          targetType: 'gameplay.state',
        },
      ],
    },
    {
      id: 'profile-main',
      kind: 'resource-realization.acquisition-profile',
      value: {
        required: true,
        dimensions: ['3D'],
        assetKinds: ['model'],
        usageTags: ['character'],
        capabilities: ['skinned'],
        styles: ['stylized'],
        sourcingPolicy: {
          allowedSourceKinds: ['agent-authored'],
          licenseConstraints: ['project-license'],
          responsibleParty: 'art-team',
          handoffCriteria: ['runtime-import-ready'],
        },
      },
      references: [],
      edges: [
        {
          type: 'describes',
          targetId: 'resource.requirement.player-model',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'target-main',
      kind: 'resource-realization.delivery-target',
      value: {
        platform: 'desktop',
        runtime: 'web',
        assetFormatCapabilities: ['glb', 'svg'],
      },
      references: [],
      edges: [],
    },
    {
      id: 'variant-main',
      kind: 'resource-realization.variant',
      value: { activation: { kind: 'required' } },
      references: [],
      edges: [
        {
          type: 'realizes',
          targetId: 'resource.requirement.player-model',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'artifact-main',
      kind: 'resource-realization.delivery-artifact',
      value: {
        artifactClass: 'runtime-resource',
        path: 'assets/runtime/player-model.glb',
        format: 'glb',
        runtimeRole: artifactRuntimeRole,
      },
      references: [],
      edges: [
        {
          type: 'part-of',
          targetId: 'variant-main',
          targetType: 'resource-realization.variant',
        },
      ],
    },
    {
      id: 'profile-screen-main',
      kind: 'resource-realization.acquisition-profile',
      value: {
        required: true,
        dimensions: ['2D'],
        assetKinds: ['ui-screen'],
        usageTags: ['ui'],
        capabilities: ['ui-states'],
        styles: ['stylized'],
        sourcingPolicy: {
          allowedSourceKinds: ['agent-authored'],
          licenseConstraints: ['project-license'],
          responsibleParty: 'art-team',
          handoffCriteria: ['runtime-import-ready'],
        },
      },
      references: [],
      edges: [
        {
          type: 'describes',
          targetId: 'resource.requirement.screen-main',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'variant-screen-main',
      kind: 'resource-realization.variant',
      value: { activation: { kind: 'required' } },
      references: [],
      edges: [
        {
          type: 'realizes',
          targetId: 'resource.requirement.screen-main',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'artifact-screen-main',
      kind: 'resource-realization.delivery-artifact',
      value: {
        artifactClass: 'runtime-resource',
        path: 'assets/runtime/screen-main.svg',
        format: 'svg',
        runtimeRole: 'screen',
      },
      references: [],
      edges: [
        {
          type: 'part-of',
          targetId: 'variant-screen-main',
          targetType: 'resource-realization.variant',
        },
      ],
    },
  ]
  const presentationNodes: ResourceFixtureNode[] =
    packet.presentationRequirements.flatMap(requirement => [
      {
        id: `profile-${requirement.requirementId}`,
        kind: 'resource-realization.acquisition-profile',
        value: {
          required: true,
          dimensions: ['2D'],
          assetKinds: ['ui-screen'],
          usageTags: ['ui'],
          capabilities: ['ui-states'],
          styles: ['stylized'],
          sourcingPolicy: {
            allowedSourceKinds: ['agent-authored'],
            licenseConstraints: ['project-license'],
            responsibleParty: 'art-team',
            handoffCriteria: ['runtime-import-ready'],
          },
        },
        references: [],
        edges: [
          {
            type: 'describes',
            targetId: `resource.requirement.${requirement.requirementId}`,
            targetType: 'resource-realization.logical-resource',
          },
        ],
      },
      {
        id: `variant-${requirement.requirementId}`,
        kind: 'resource-realization.variant',
        value: { activation: { kind: 'required' } },
        references: [],
        edges: [
          {
            type: 'realizes',
            targetId: `resource.requirement.${requirement.requirementId}`,
            targetType: 'resource-realization.logical-resource',
          },
        ],
      },
      {
        id: `artifact-${requirement.requirementId}`,
        kind: 'resource-realization.delivery-artifact',
        value: {
          artifactClass: 'runtime-resource',
          path: `assets/runtime/${requirement.requirementId}.svg`,
          format: 'svg',
          runtimeRole: requirement.runtimeRole,
        },
        references: [],
        edges: [
          {
            type: 'part-of',
            targetId: `variant-${requirement.requirementId}`,
            targetType: 'resource-realization.variant',
          },
        ],
      },
    ])
  const nodes = [
    ...baseNodes.filter(node => !node.id.includes('screen-main')),
    ...presentationNodes,
  ]
  const candidateNodes = mutate ? mutate(structuredClone(nodes)) : nodes
  const sectionFor = (node: (typeof nodes)[number]) => {
    const documentPath = node.id.includes('screen')
      ? 'docs/TECHNICAL_DESIGN.md'
      : 'docs/ASSET_PLAN.md'
    const sections = packet.sourceSections.filter(
      item => item.documentPath === documentPath,
    )
    return sections[node.id === 'profile-main' ? 1 : 0]!
  }
  const literal = (node: (typeof nodes)[number], pointer: string): string => {
    if (pointer === '/id') return node.id
    if (pointer.startsWith('/edges/'))
      return canonicalGameIrJson(
        node.edges[Number(pointer.slice('/edges/'.length))],
      )
    let current: unknown = node.value
    for (const part of pointer.slice('/value/'.length).split('/'))
      current = (current as Record<string, unknown>)[part]
    return typeof current === 'string' ? current : canonicalGameIrJson(current)
  }
  const leaves = (value: unknown, pointer: string, output: string[]): void => {
    if (Array.isArray(value))
      value.forEach((item, index) =>
        leaves(item, `${pointer}/${index}`, output),
      )
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([key, item]) =>
        leaves(item, `${pointer}/${key}`, output),
      )
    else output.push(pointer)
  }
  const pointers = (node: (typeof nodes)[number]) => {
    const output = ['/id']
    const valuePointers: string[] = []
    leaves(node.value, '/value', valuePointers)
    output.push(
      ...valuePointers,
      ...node.edges.map((_, index) => `/edges/${index}`),
    )
    return output
  }
  const claims = candidateNodes
    .flatMap(node => {
      const section = sectionFor(node)
      const bytes = sourceBytes[`${section.documentPath}#${section.sectionId}`]!
      return pointers(node).map(pointer => {
        const value = literal(node, pointer)
        const start = bytes.indexOf(value)
        if (start < 0) throw new Error(`fixture literal missing: ${value}`)
        const startBytes = Buffer.byteLength(bytes.slice(0, start), 'utf8')
        return {
          subject: `node:${node.id}#${pointer}`,
          documentPath: section.documentPath,
          sectionId: section.sectionId,
          sourcePointer: `/bytes/${startBytes}/${startBytes + Buffer.byteLength(value, 'utf8')}`,
          literal: value,
        }
      })
    })
    .sort((left, right) =>
      compareCodeUnits(
        `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
        `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
      ),
    )
  return {
    outcome: 'PROJECTED' as const,
    nodes: candidateNodes,
    sourceClaims: claims,
  }
}

export function validationAuthority(
  authority: ResourceRealizationSemanticProjectionAuthority,
  semantic: ResourceRealizationSemanticReceipt,
): ResourceRealizationValidationPreparationAuthority {
  return {
    phase5Authority: authority.phase5Authority,
    resourceRealization: { ...authority.resourceRealization, semantic },
  }
}
