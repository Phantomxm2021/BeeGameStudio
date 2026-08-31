import { createHash } from 'node:crypto'
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
  type GameIrSourceBinding,
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
import { digestSectionIndex } from '../foundation-section-index'
import { receiptDigest } from './contracts'

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

const edge = (type: string, targetId: string, targetType: string) => ({
  type,
  targetId,
  targetType,
})

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
) {
  if (documentPath === 'docs/GDD.md')
    return phase5Authority.phase4Authority.gameplay.source
  if (documentPath === 'docs/LEVEL_SCENE_DESIGN.md')
    return phase5Authority.worldScene.source
  if (documentPath === 'docs/BALANCE_DESIGN.md')
    return phase5Authority.phase4Authority.balance.source
  return realAuthority().resourceRealization.source
}

function rebindPriorModules(
  modules: readonly GameIrModuleCandidate[],
  oldDigest: string,
  newDigest: string,
): readonly GameIrModuleCandidate[] {
  return modules.map(module => ({
    ...module,
    nodes: module.nodes.map(node => ({
      ...node,
      bindings: Object.fromEntries(
        Object.entries(node.bindings).map(([pointer, binding]) => [
          pointer,
          binding.kind === 'owner' && binding.sectionDigest === oldDigest
            ? { ...binding, sectionDigest: newDigest }
            : binding,
        ]),
      ) as Readonly<Record<string, GameIrSourceBinding>>,
    })),
  }))
}

function phase6Fixture(): {
  closure: ResourceRealizationClosure
  priorModules: readonly GameIrModuleCandidate[]
  phase5Authority: ReturnType<typeof realAuthority>['phase5Authority']
  resource: ResourceRealizationSemanticReceipt
} {
  const projectionAuthority = realAuthority()
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
    priorModules: [
      closure.phase5.phase4.gameplay.module,
      closure.phase5.phase4.balance.module,
      closure.phase5.worldScene.module,
      closure.phase5.presentation.module,
      closure.resourceRealization.module,
    ],
    phase5Authority: projectionAuthority.phase5Authority,
    resource,
  }
}

function ivNodes(
  priorModules: readonly GameIrModuleCandidate[],
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
  return [
    target,
    main,
    verification,
    evidenceMain,
    evidenceVerification,
    scenario,
    invariant,
  ].map(node => ({ ...node, edges: sortedEdges(node.edges) }))
}

function sourceAndClaims(
  phase5Authority: ReturnType<typeof realAuthority>['phase5Authority'],
  priorModules: readonly GameIrModuleCandidate[],
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
        const source = sourceFor(phase5Authority, section.documentPath)
        return [
          `${section.documentPath}#${section.sectionId}`,
          source.sectionBytes[`${section.documentPath}#${section.sectionId}`]!,
        ]
      }),
  )
  const literals = nodes.flatMap(node =>
    gameIrSemanticTargetPointers([node]).map(pointer => {
      const value = gameIrSemanticPointerValue(
        node,
        pointer.slice(pointer.indexOf('#') + 1),
      )
      return typeof value === 'string' ? value : canonicalGameIrJson(value)
    }),
  )
  const technicalSection = sectionIndex.find(
    section => section.documentPath === 'docs/TECHNICAL_DESIGN.md',
  )!
  const technicalKey = `${technicalSection.documentPath}#${technicalSection.sectionId}`
  const technicalBytes = `${originalBytes[technicalKey]}\n${literals.join('\n')}`
  const augmentedIndex = sectionIndex.map(section =>
    section === technicalSection
      ? { ...section, digest: sha256(technicalBytes) }
      : section,
  )
  const oldFoundation =
    phase5Authority.phase4Authority.gameplay.source.compileRequest.foundation
  const { receiptDigest: _oldReceiptDigest, ...oldFoundationBody } =
    oldFoundation
  const foundationBody = {
    ...oldFoundationBody,
    documentDigests: {
      ...oldFoundation.documentDigests,
      'docs/TECHNICAL_DESIGN.md': sha256(technicalBytes),
    },
    sectionIndexDigest: digestSectionIndex(augmentedIndex),
  }
  const request = {
    ...phase5Authority.phase4Authority.gameplay.source.compileRequest,
    foundation: {
      ...foundationBody,
      receiptDigest: receiptDigest(foundationBody),
    },
  }
  const source = buildGameIrDomainSourceEnvelope({
    moduleId: 'implementation-verification',
    request,
    sectionIndex: augmentedIndex,
    sectionBytes: Object.fromEntries(
      augmentedIndex
        .filter(section => wanted.has(section.documentPath))
        .map(section => [
          `${section.documentPath}#${section.sectionId}`,
          section.documentPath === technicalSection.documentPath &&
          section.sectionId === technicalSection.sectionId
            ? technicalBytes
            : originalBytes[`${section.documentPath}#${section.sectionId}`]!,
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
        )!
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

export function implementationVerificationFixture() {
  const phase6 = phase6Fixture()
  const priorModules = rebindPriorModules(
    phase6.priorModules,
    phase6.phase5Authority.phase4Authority.gameplay.source.authoritySectionIndex.find(
      section => section.documentPath === 'docs/TECHNICAL_DESIGN.md',
    )!.digest,
    // Filled after source augmentation; prior bindings are updated below.
    '0'.repeat(64),
  )
  const nodes = ivNodes(priorModules)
  const built = sourceAndClaims(phase6.phase5Authority, priorModules, nodes)
  const oldDigest =
    phase6.phase5Authority.phase4Authority.gameplay.source.authoritySectionIndex.find(
      section => section.documentPath === 'docs/TECHNICAL_DESIGN.md',
    )!.digest
  const newDigest = built.source.authoritySectionIndex.find(
    section => section.documentPath === 'docs/TECHNICAL_DESIGN.md',
  )!.digest
  const reboundPriorModules = rebindPriorModules(
    phase6.priorModules,
    oldDigest,
    newDigest,
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
    priorModules: reboundPriorModules,
    nodes,
  }
}
