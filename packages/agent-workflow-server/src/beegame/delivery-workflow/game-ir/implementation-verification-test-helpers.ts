import {
  admitGameIrMechanicalProjectionReceipt,
  gameIrSemanticPointerValue,
  gameIrSemanticTargetPointers,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  buildImplementationVerificationSemanticPacket,
  admitImplementationVerificationSemanticResult,
  type ImplementationVerificationSemanticProjectionAuthority,
  type ImplementationVerificationSemanticProjectionPacket,
  type ImplementationVerificationSemanticReceipt,
} from './implementation-verification-producer'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  type GameIrModuleCandidate,
  type GameIrNode,
  type GameIrSourceSection,
} from './model'
import type { GameIrSemanticCandidateNode } from './semantic-fidelity'
import {
  assembleResourceRealizationClosure,
  type ResourceRealizationClosure,
} from './resource-realization-assembler'
import {
  admitResourceRealizationSemanticResult,
  prepareResourceRealizationSemanticProjectionPacket,
  type ResourceRealizationSemanticReceipt,
} from './resource-realization-producer'
import {
  admitResourceRealizationSemanticValidationResult,
  prepareResourceRealizationSemanticValidationPacket,
} from './phase6-admission'
import {
  completeResourceInput,
  realAuthority,
  validationAuthority as buildValidationAuthority,
} from './resource-realization-test-helpers'

const edge = (type: string, targetId: string, targetType: string) => ({
  type,
  targetId,
  targetType,
})

const IV_SOURCE_LITERALS = Object.freeze([
  'implementation-verification',
  'implementation-verification.target',
  'implementation-verification.unit',
  'implementation-verification.acceptance-scenario',
  'implementation-verification.evidence-requirement',
  'implementation-verification.invariant',
  'target-secondary',
  'artifact-main-2',
  'artifact-alt',
  'artifact-runtime',
  'artifact-format',
  'player-acquisition',
  'runtime-player-model',
  'runtime-import-ready',
  'player-model',
  'player',
  'web',
  'desktop',
  'assets/runtime/player-model.glb',
  'assets/runtime/player-model.png',
  'resource',
  'integration-test',
  'file-inspection',
  ...[
    ['depends-on', 'artifact-alt', 'implementation-verification.unit'],
    ['targets', 'target-secondary', 'implementation-verification.target'],
    ['owned-by', 'artifact-main-2', 'implementation-verification.unit'],
    ['owned-by', 'artifact-alt', 'implementation-verification.unit'],
    [
      'proved-by',
      'player-acquisition',
      'implementation-verification.evidence-requirement',
    ],
    [
      'proved-by',
      'runtime-player-model',
      'implementation-verification.evidence-requirement',
    ],
    ['constrains', 'artifact-alt', 'implementation-verification.unit'],
    ['constrains', 'balance-unit', 'balance.unit'],
  ].map(([type, targetId, targetType]) =>
    canonicalGameIrJson(edge(type!, targetId!, targetType!)),
  ),
  ...[
    ['state-start', 'gameplay.state'],
    ['balance-unit', 'balance.unit'],
    ['world-scene-main', 'world-scene.scene'],
    ['world-node-root', 'world-scene.node'],
    ['presentation-screen-main', 'presentation.ui-screen'],
    ['presentation-state-main', 'presentation.ui-state'],
    [
      'resource.requirement.player-model',
      'resource-realization.logical-resource',
    ],
    ['profile-main', 'resource-realization.acquisition-profile'],
    ['target-main', 'resource-realization.delivery-target'],
    ['variant-main', 'resource-realization.variant'],
    ['artifact-main', 'resource-realization.delivery-artifact'],
    [
      'resource.requirement.screen-main',
      'resource-realization.logical-resource',
    ],
    ['profile-screen-main', 'resource-realization.acquisition-profile'],
    ['variant-screen-main', 'resource-realization.variant'],
    ['artifact-screen-main', 'resource-realization.delivery-artifact'],
  ].flatMap(([targetId, targetType]) =>
    ['implements', 'covers'].map(type =>
      canonicalGameIrJson(edge(type, targetId, targetType)),
    ),
  ),
  ...Array.from({ length: 24 }, (_, index) => {
    const suffix = String(index).padStart(2, '0')
    return [
      `expanded-evidence-${suffix}`,
      `expanded-scenario-${suffix}`,
      canonicalGameIrJson(
        edge('owned-by', 'artifact-main-2', 'implementation-verification.unit'),
      ),
      canonicalGameIrJson(
        edge(
          'proved-by',
          `expanded-evidence-${suffix}`,
          'implementation-verification.evidence-requirement',
        ),
      ),
      canonicalGameIrJson(edge('covers', 'state-start', 'gameplay.state')),
    ]
  }).flat(),
])

function sortedEdges(
  edges: readonly { type: string; targetId: string; targetType: string }[],
) {
  return [...edges].sort((left, right) =>
    compareCodeUnits(
      `${left.type}\0${left.targetId}\0${left.targetType}`,
      `${right.type}\0${right.targetId}\0${right.targetType}`,
    ),
  )
}

function sourceFor(
  phase5Authority: ReturnType<typeof realAuthority>['phase5Authority'],
  documentPath: string,
  resourceSource: ReturnType<
    typeof realAuthority
  >['resourceRealization']['source'],
) {
  if (documentPath === 'docs/GDD.md')
    return phase5Authority.phase4Authority.gameplay.source
  if (documentPath === 'docs/LEVEL_SCENE_DESIGN.md')
    return phase5Authority.worldScene.source
  if (documentPath === 'docs/BALANCE_DESIGN.md')
    return phase5Authority.phase4Authority.balance.source
  return resourceSource
}

function phase6Fixture(
  additionalTechnicalSourceLiterals: readonly string[] = [],
): {
  closure: ResourceRealizationClosure
  phase6Authority: ReturnType<typeof buildValidationAuthority> & {
    resourceRealization: { validation: unknown }
  }
  priorModules: readonly GameIrModuleCandidate[]
  phase5Authority: ReturnType<typeof realAuthority>['phase5Authority']
  resourceSource: ReturnType<
    typeof realAuthority
  >['resourceRealization']['source']
  resource: ResourceRealizationSemanticReceipt
} {
  const projectionAuthority = realAuthority({
    additionalTechnicalSourceLiterals,
  })
  const packet =
    prepareResourceRealizationSemanticProjectionPacket(projectionAuthority)
  const resource = admitResourceRealizationSemanticResult(
    projectionAuthority,
    packet,
    completeResourceInput(
      packet,
      projectionAuthority.resourceRealization.source.sectionBytes,
    ),
  )
  if (resource.outcome !== 'PROJECTED')
    throw new Error('fixture resource semantic result must be projected')
  const validationAuthority = buildValidationAuthority(
    projectionAuthority,
    resource,
  )
  const validationPacket =
    prepareResourceRealizationSemanticValidationPacket(validationAuthority)
  const validation = admitResourceRealizationSemanticValidationResult(
    validationAuthority,
    validationPacket,
    {
      outcome: 'PASS',
      packetDigest: validationPacket.packetDigest,
      checkIds: validationPacket.checkIds,
      coveredTargets: validationPacket.requiredTargets,
    },
  )
  const closure = assembleResourceRealizationClosure({
    ...validationAuthority,
    resourceRealization: {
      ...validationAuthority.resourceRealization,
      validation,
    },
  })
  return {
    closure,
    phase6Authority: {
      ...validationAuthority,
      resourceRealization: {
        ...validationAuthority.resourceRealization,
        validation,
      },
    },
    priorModules: [
      closure.phase5.phase4.gameplay.module,
      closure.phase5.phase4.balance.module,
      closure.phase5.worldScene.module,
      closure.phase5.presentation.module,
      closure.resourceRealization.module,
    ],
    phase5Authority: projectionAuthority.phase5Authority,
    resourceSource: projectionAuthority.resourceRealization.source,
    resource,
  }
}

function ivNodes(
  priorModules: readonly GameIrModuleCandidate[],
  expandedCount = 0,
): GameIrSemanticCandidateNode[] {
  const priorNodes = priorModules.flatMap(module => module.nodes)
  const target = {
    id: 'target-secondary',
    kind: 'implementation-verification.target',
    value: {
      label: 'player-model',
      runtime: 'web',
      platforms: ['desktop', 'web'],
      projectRoots: [
        'assets/runtime/player-model.glb',
        'assets/runtime/player-model.png',
      ],
    },
    references: [],
    edges: [],
  }
  const main = {
    id: 'artifact-main-2',
    kind: 'implementation-verification.unit',
    value: {
      label: 'player-acquisition',
      responsibility: 'player',
      ownedPaths: ['assets/runtime/player-model.glb'],
    },
    references: [],
    edges: [
      edge('depends-on', 'artifact-alt', 'implementation-verification.unit'),
      edge('targets', target.id, target.kind),
      ...priorNodes
        .filter((_, index) => index % 2 === 0)
        .map(node => edge('implements', node.id, node.kind)),
    ],
  }
  const verification = {
    id: 'artifact-alt',
    kind: 'implementation-verification.unit',
    value: {
      label: 'runtime-player-model',
      responsibility: 'runtime-import-ready',
      ownedPaths: ['assets/runtime/player-model.png'],
    },
    references: [],
    edges: [
      edge('targets', target.id, target.kind),
      ...priorNodes
        .filter((_, index) => index % 2 === 1)
        .map(node => edge('implements', node.id, node.kind)),
    ],
  }
  const evidenceMain = {
    id: 'player-acquisition',
    kind: 'implementation-verification.evidence-requirement',
    value: {
      label: 'player',
      kind: 'integration-test',
      expected: 'runtime-import-ready',
      artifactPaths: ['assets/runtime/player-model.glb'],
    },
    references: [],
    edges: [edge('owned-by', main.id, main.kind)],
  }
  const evidenceVerification = {
    id: 'runtime-player-model',
    kind: 'implementation-verification.evidence-requirement',
    value: {
      label: 'runtime-player-model',
      kind: 'file-inspection',
      expected: 'runtime-import-ready',
      artifactPaths: ['assets/runtime/player-model.png'],
    },
    references: [],
    edges: [edge('owned-by', verification.id, verification.kind)],
  }
  const scenario = {
    id: 'artifact-runtime',
    kind: 'implementation-verification.acceptance-scenario',
    value: {
      label: 'player',
      precondition: 'runtime-import-ready',
      action: 'player',
      expectedOutcome: 'runtime-import-ready',
    },
    references: [],
    edges: [
      ...priorNodes.map(node => edge('covers', node.id, node.kind)),
      edge('owned-by', main.id, main.kind),
      edge('proved-by', evidenceMain.id, evidenceMain.kind),
      edge('proved-by', evidenceVerification.id, evidenceVerification.kind),
    ],
  }
  const invariant = {
    id: 'artifact-format',
    kind: 'implementation-verification.invariant',
    value: {
      label: 'runtime-player-model',
      assertion: 'runtime-import-ready',
      scope: 'resource',
    },
    references: [],
    edges: [
      edge('constrains', verification.id, verification.kind),
      edge(
        'constrains',
        priorNodes.find((_, index) => index % 2 === 1)!.id,
        priorNodes.find((_, index) => index % 2 === 1)!.kind,
      ),
      edge('proved-by', evidenceVerification.id, evidenceVerification.kind),
    ],
  }
  const expanded = Array.from({ length: expandedCount }, (_, index) => {
    const suffix = String(index).padStart(2, '0')
    const evidence = {
      id: `expanded-evidence-${suffix}`,
      kind: 'implementation-verification.evidence-requirement',
      value: {
        label: 'runtime-player-model',
        kind: 'file-inspection',
        expected: 'runtime-import-ready',
        artifactPaths: ['assets/runtime/player-model.png'],
      },
      references: [],
      edges: [edge('owned-by', main.id, main.kind)],
    }
    const scenario = {
      id: `expanded-scenario-${suffix}`,
      kind: 'implementation-verification.acceptance-scenario',
      value: {
        label: 'player',
        precondition: 'runtime-import-ready',
        action: 'player',
        expectedOutcome: 'runtime-import-ready',
      },
      references: [],
      edges: [
        edge('covers', 'state-start', 'gameplay.state'),
        edge('owned-by', main.id, main.kind),
        edge('proved-by', evidence.id, evidence.kind),
      ],
    }
    return [evidence, scenario]
  }).flat()
  return [
    target,
    main,
    verification,
    evidenceMain,
    evidenceVerification,
    scenario,
    invariant,
    ...expanded,
  ].map(node => ({ ...node, edges: sortedEdges(node.edges) }))
}

function sourceAndClaims(
  phase5Authority: ReturnType<typeof realAuthority>['phase5Authority'],
  resourceSource: ReturnType<
    typeof realAuthority
  >['resourceRealization']['source'],
  nodes: readonly GameIrSemanticCandidateNode[],
): {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semanticValue: {
    outcome: 'PROJECTED'
    nodes: readonly GameIrSemanticCandidateNode[]
    sourceClaims: readonly Record<string, string>[]
  }
} {
  const sectionIndex =
    phase5Authority.phase4Authority.gameplay.source.authoritySectionIndex
  const wanted = new Set([
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
  ])
  const originalBytes = Object.fromEntries(
    sectionIndex
      .filter(section => wanted.has(section.documentPath))
      .map(section => {
        const source = sourceFor(
          phase5Authority,
          section.documentPath,
          resourceSource,
        )
        return [
          `${section.documentPath}#${section.sectionId}`,
          source.sectionBytes[`${section.documentPath}#${section.sectionId}`]!,
        ]
      }),
  )
  const request = phase5Authority.phase4Authority.gameplay.source.compileRequest
  const source = buildGameIrDomainSourceEnvelope({
    moduleId: 'implementation-verification',
    request,
    sectionIndex,
    sectionBytes: Object.fromEntries(
      sectionIndex
        .filter(section => wanted.has(section.documentPath))
        .map(section => [
          `${section.documentPath}#${section.sectionId}`,
          originalBytes[`${section.documentPath}#${section.sectionId}`]!,
        ]),
    ),
  })
  const mechanicalBody = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: request.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
  }
  const mechanical = admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: {
      ...mechanicalBody,
      receiptDigest: digestGameIrValue(mechanicalBody),
    },
  })
  const claimSections = source.sectionIndex
  const sourceClaims = nodes
    .flatMap(node =>
      gameIrSemanticTargetPointers([node]).map(pointer => {
        const value = gameIrSemanticPointerValue(
          node,
          pointer.slice(pointer.indexOf('#') + 1),
        )
        const literal =
          typeof value === 'string' ? value : canonicalGameIrJson(value)
        const section = claimSections.find(candidate =>
          source.sectionBytes[
            `${candidate.documentPath}#${candidate.sectionId}`
          ]!.includes(literal),
        )
        if (!section) throw new Error(`fixture literal missing: ${literal}`)
        const bytes =
          source.sectionBytes[`${section.documentPath}#${section.sectionId}`]!
        const offset = bytes.indexOf(literal)
        const start = Buffer.byteLength(bytes.slice(0, offset), 'utf8')
        return {
          subject: pointer,
          documentPath: section.documentPath,
          sectionId: section.sectionId,
          sourcePointer: `/bytes/${start}/${start + Buffer.byteLength(literal, 'utf8')}`,
          literal,
        }
      }),
    )
    .sort((left, right) =>
      compareCodeUnits(
        `${left.subject}\0${left.sourcePointer}\0${left.literal}`,
        `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
      ),
    )
  return {
    source,
    mechanical,
    semanticValue: { outcome: 'PROJECTED', nodes, sourceClaims },
  }
}

export function implementationVerificationFixture(expandedCount = 0) {
  const phase6 = phase6Fixture(IV_SOURCE_LITERALS)
  const nodes = ivNodes(phase6.priorModules, expandedCount)
  const built = sourceAndClaims(
    phase6.phase5Authority,
    phase6.resourceSource,
    nodes,
  )
  const authority: ImplementationVerificationSemanticProjectionAuthority = {
    source: built.source,
    mechanical: built.mechanical,
  }
  const packet: ImplementationVerificationSemanticProjectionPacket =
    buildImplementationVerificationSemanticPacket(authority)
  const semantic = admitImplementationVerificationSemanticResult(
    authority,
    packet,
    built.semanticValue,
  )
  if (semantic.outcome !== 'PROJECTED')
    throw new Error('fixture IV semantic result must be projected')
  return {
    ...phase6,
    authority,
    packet,
    semantic: semantic as ImplementationVerificationSemanticReceipt,
    priorModules: phase6.priorModules,
    nodes,
  }
}
