import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitGameIrMechanicalProjectionReceipt,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  canonicalGameIrModuleSourceDocuments,
} from './domain-source'
import {
  admitGameplaySemanticResult,
  buildGameplaySemanticPacket,
} from './gameplay-producer'
import {
  admitBalanceSemanticResult,
  buildBalanceSemanticPacket,
} from './balance-producer'
import {
  admitWorldSceneSemanticResult,
  buildWorldSceneSemanticPacket,
  type WorldSceneSemanticReceipt,
} from './world-scene-producer'
import {
  admitPresentationSemanticResult,
  buildPresentationSemanticPacket,
  type PresentationSemanticReceipt,
} from './presentation-producer'
import {
  admitPhase5SemanticValidationResult,
  buildPhase5SemanticValidationPacket,
  replayAndBindPhase5SemanticReceipt,
} from './phase5-admission'
import { assembleWorldPresentationClosure } from './world-presentation-assembler'
import { assembleGameplayBalanceModules } from './gameplay-balance-assembler'
import { parseWorldSceneModule } from './world-scene-schema'
import { parsePresentationModule } from './presentation-schema'
import {
  canonicalGameIrJson,
  canonicalizeGameIrSourceSections,
  digestGameIrValue,
  type GameIrNode,
} from './model'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
} from './contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import { digestSectionIndex } from '../foundation-section-index'

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')
const digest = 'a'.repeat(64)
type Node = Omit<GameIrNode, 'producerMode' | 'bindings'>
const edge = (type: string, targetId: string, targetType: string) => ({
  type,
  targetId,
  targetType,
})

const gameplayNodes: Node[] = [
  {
    id: 'entity.player',
    kind: 'gameplay.entity',
    value: { label: 'Pilot' },
    references: [],
    edges: [],
  },
  {
    id: 'entity.scout',
    kind: 'gameplay.entity',
    value: { label: 'Scout' },
    references: [],
    edges: [],
  },
  {
    id: 'entity.warden',
    kind: 'gameplay.entity',
    value: { label: 'Warden' },
    references: [],
    edges: [],
  },
  {
    id: 'event.alarm',
    kind: 'gameplay.event',
    value: { label: 'Alarm' },
    references: [],
    edges: [],
  },
  {
    id: 'state.explore',
    kind: 'gameplay.state',
    value: { label: 'Explore', initial: true, terminal: 'none' },
    references: [],
    edges: [],
  },
]
const balanceNodes: Node[] = [
  {
    id: 'balance-unit',
    kind: 'balance.unit',
    value: {
      symbol: 'meter',
      dimensions: [],
      scale: { numerator: 1, denominator: 1 },
    },
    references: [],
    edges: [],
  },
]

const t2 = (x: number, y: number) => ({
  dimensions: '2d' as const,
  space: 'local' as const,
  position: { x, y },
  rotationRadians: 0.1,
  scale: { x: 1, y: 1 },
})
const t3 = (x: number, y: number, z: number) => ({
  dimensions: '3d' as const,
  space: 'local' as const,
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
})
const sceneEdge = (scene: string) => edge('scene', scene, 'world-scene.scene')
const world2d = 'world.scene-ice'
const world3d = 'world.scene-orbit'
const worldNodes: Node[] = [
  {
    id: world2d,
    kind: 'world-scene.scene',
    value: {
      label: 'Ice shelf',
      coordinateConvention: {
        dimensions: '2d',
        xDirection: 'right',
        yDirection: 'up',
        distanceUnit: 'meter',
      },
    },
    references: [],
    edges: [edge('root', 'world.ice-root', 'world-scene.node')],
  },
  {
    id: world3d,
    kind: 'world-scene.scene',
    value: {
      label: 'Orbital relay',
      coordinateConvention: {
        dimensions: '3d',
        handedness: 'right',
        upAxis: '+y',
        forwardAxis: '+z',
        distanceUnit: 'meter',
      },
    },
    references: [],
    edges: [edge('root', 'world.orbit-root', 'world-scene.node')],
  },
  {
    id: 'world.ice-root',
    kind: 'world-scene.node',
    value: {
      label: 'Ice root',
      nodeType: 'container',
      transform: { ...t2(0, 0), space: 'world' },
    },
    references: [],
    edges: [sceneEdge(world2d)],
  },
  {
    id: 'world.ice-gate',
    kind: 'world-scene.node',
    value: { label: 'Gate', nodeType: 'anchor', transform: t2(4, 1) },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('parent', 'world.ice-root', 'world-scene.node'),
    ],
  },
  {
    id: 'world.ice-yard',
    kind: 'world-scene.node',
    value: { label: 'Yard', nodeType: 'volume', transform: t2(8, 2) },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('parent', 'world.ice-gate', 'world-scene.node'),
      edge('zone', 'world.ice-danger', 'world-scene.zone'),
    ],
  },
  {
    id: 'world.ice-exit',
    kind: 'world-scene.node',
    value: { label: 'Exit', nodeType: 'anchor', transform: t2(12, 2) },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('parent', 'world.ice-yard', 'world-scene.node'),
    ],
  },
  {
    id: 'world.ice-danger',
    kind: 'world-scene.zone',
    value: {
      label: 'Whiteout',
      shape: { kind: 'circle', radius: 3 },
      transform: t2(8, 2),
    },
    references: [],
    edges: [sceneEdge(world2d)],
  },
  {
    id: 'world.ice-route',
    kind: 'world-scene.route',
    value: {
      label: 'Evacuation route',
      closed: false,
      waypointReferenceIndexes: [0, 1, 2],
    },
    references: [
      { targetId: 'world.ice-gate', targetType: 'world-scene.node' },
      { targetId: 'world.ice-yard', targetType: 'world-scene.node' },
      { targetId: 'world.ice-exit', targetType: 'world-scene.node' },
    ],
    edges: [sceneEdge(world2d)],
  },
  {
    id: 'world.ice-player',
    kind: 'world-scene.entity-instance',
    value: { label: 'Pilot instance' },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('entity', 'entity.player', 'gameplay.entity'),
      edge('location', 'world.ice-gate', 'world-scene.node'),
    ],
  },
  {
    id: 'world.ice-enemy',
    kind: 'world-scene.entity-instance',
    value: { label: 'Warden instance' },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('entity', 'entity.warden', 'gameplay.entity'),
      edge('location', 'world.ice-yard', 'world-scene.node'),
      edge('zone', 'world.ice-danger', 'world-scene.zone'),
    ],
  },
  {
    id: 'world.ice-wave-spawn',
    kind: 'world-scene.spawn',
    value: { label: 'Whiteout wave', quantity: 3, policy: 'wave' },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('location', 'world.ice-yard', 'world-scene.node'),
      edge('entity', 'entity.warden', 'gameplay.entity'),
    ],
  },
  {
    id: 'world.ice-patrol-spawn',
    kind: 'world-scene.spawn',
    value: { label: 'Patrol', quantity: 1, policy: 'repeat' },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('location', 'world.ice-gate', 'world-scene.node'),
      edge('entity', 'entity.scout', 'gameplay.entity'),
    ],
  },
  {
    id: 'world.ice-wave',
    kind: 'world-scene.encounter',
    value: { label: 'Whiteout wave', mode: 'triggered' },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('zone', 'world.ice-danger', 'world-scene.zone'),
      edge('spawn', 'world.ice-wave-spawn', 'world-scene.spawn'),
      edge('triggered-by', 'event.alarm', 'gameplay.event'),
    ],
  },
  {
    id: 'world.ice-patrol',
    kind: 'world-scene.encounter',
    value: { label: 'Gate patrol', mode: 'patrol' },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('zone', 'world.ice-danger', 'world-scene.zone'),
      edge('spawn', 'world.ice-patrol-spawn', 'world-scene.spawn'),
    ],
  },
  {
    id: 'world.ice-checkpoint',
    kind: 'world-scene.checkpoint',
    value: {
      label: 'Gate checkpoint',
      ordinal: 1,
      resetPolicy: 'last-checkpoint',
    },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('location', 'world.ice-gate', 'world-scene.node'),
      edge('respawn-state', 'state.explore', 'gameplay.state'),
    ],
  },
  {
    id: 'world.ice-camera',
    kind: 'world-scene.camera-region',
    value: { label: 'Yard camera', priority: 2, blendIn: 0.25, blendOut: 0.4 },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('zone', 'world.ice-danger', 'world-scene.zone'),
      edge('anchor', 'world.ice-gate', 'world-scene.node'),
    ],
  },
  {
    id: 'world.orbit-root',
    kind: 'world-scene.node',
    value: {
      label: 'Orbit root',
      nodeType: 'container',
      transform: { ...t3(0, 0, 0), space: 'world' },
    },
    references: [],
    edges: [sceneEdge(world3d)],
  },
  {
    id: 'world.orbit-dock',
    kind: 'world-scene.node',
    value: { label: 'Dock', nodeType: 'anchor', transform: t3(2, 1, 4) },
    references: [],
    edges: [
      sceneEdge(world3d),
      edge('parent', 'world.orbit-root', 'world-scene.node'),
    ],
  },
  {
    id: 'world.orbit-ring',
    kind: 'world-scene.node',
    value: { label: 'Ring', nodeType: 'volume', transform: t3(4, 2, 8) },
    references: [],
    edges: [
      sceneEdge(world3d),
      edge('parent', 'world.orbit-dock', 'world-scene.node'),
      edge('zone', 'world.orbit-zone', 'world-scene.zone'),
    ],
  },
  {
    id: 'world.orbit-zone',
    kind: 'world-scene.zone',
    value: {
      label: 'Relay volume',
      shape: { kind: 'box', size: { x: 5, y: 4, z: 3 } },
      transform: t3(4, 2, 8),
    },
    references: [],
    edges: [sceneEdge(world3d)],
  },
  {
    id: 'world.orbit-route',
    kind: 'world-scene.route',
    value: {
      label: 'Dock route',
      closed: true,
      waypointReferenceIndexes: [0, 1],
    },
    references: [
      { targetId: 'world.orbit-dock', targetType: 'world-scene.node' },
      { targetId: 'world.orbit-ring', targetType: 'world-scene.node' },
    ],
    edges: [sceneEdge(world3d)],
  },
]
// The closure assembler intentionally narrows external targets to the kinds its
// Presentation contract can consume. Exercise the full traversal graph at the
// World schema boundary, while the replayed closure uses that accepted slice.
const sortNodes = (nodes: readonly Node[]): Node[] =>
  [...nodes].sort((left, right) =>
    Buffer.from(left.id).compare(Buffer.from(right.id)),
  )
const sortedWorldNodes = sortNodes(worldNodes)
const closureWorldNodes = sortedWorldNodes.filter(node =>
  new Set([
    'world-scene.scene',
    'world-scene.node',
    'world-scene.zone',
    'world-scene.entity-instance',
    'world-scene.camera-region',
  ]).has(node.kind),
)

const requirement = (
  requirementId: string,
  kind: string,
  runtimeRole: string,
) => ({ requirementId, kind, runtimeRole })
const presentationNodes: Node[] = [
  {
    id: 'presentation.screen-hud',
    kind: 'presentation.ui-screen',
    value: {
      label: 'HUD',
      modal: false,
      requirements: [requirement('req.ui.hud', 'ui', 'screen')],
    },
    references: [],
    edges: [
      edge('initial-state', 'presentation.state-hud', 'presentation.ui-state'),
      edge('driven-by', 'state.explore', 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.screen-menu',
    kind: 'presentation.ui-screen',
    value: {
      label: 'Menu',
      modal: true,
      requirements: [requirement('req.ui.menu', 'ui', 'screen')],
    },
    references: [],
    edges: [
      edge('initial-state', 'presentation.state-menu', 'presentation.ui-state'),
      edge('driven-by', 'state.explore', 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.state-hud',
    kind: 'presentation.ui-state',
    value: { label: 'Live HUD', terminal: false },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-hud', 'presentation.ui-screen'),
      edge('driven-by', 'state.explore', 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.state-menu',
    kind: 'presentation.ui-state',
    value: { label: 'Pause menu', terminal: false },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-menu', 'presentation.ui-screen'),
      edge('driven-by', 'state.explore', 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.state-menu-open',
    kind: 'presentation.ui-state',
    value: { label: 'Menu alarm overlay', terminal: false },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-menu', 'presentation.ui-screen'),
      edge('driven-by', 'event.alarm', 'gameplay.event'),
    ],
  },
  {
    id: 'presentation.feedback-alarm',
    kind: 'presentation.feedback',
    value: { label: 'Alarm warning', channel: 'text' },
    references: [],
    edges: [
      edge('on', 'event.alarm', 'gameplay.event'),
      edge('screen', 'presentation.screen-hud', 'presentation.ui-screen'),
    ],
  },
  {
    id: 'presentation.camera-follow',
    kind: 'presentation.camera-behavior',
    value: { label: 'Follow pilot', mode: 'follow', duration: 0.3 },
    references: [],
    edges: [
      edge('region', 'world.ice-camera', 'world-scene.camera-region'),
      edge('on', 'state.explore', 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.clip-walk',
    kind: 'presentation.animation-clip',
    value: {
      label: 'Walk',
      loop: true,
      playbackRate: 1.2,
      requirements: [requirement('req.anim.walk', 'animation', 'clip')],
    },
    references: [],
    edges: [edge('target', 'world.ice-player', 'world-scene.entity-instance')],
  },
  {
    id: 'presentation.animation-walk',
    kind: 'presentation.animation-state',
    value: { label: 'Walking' },
    references: [],
    edges: [
      edge('clip', 'presentation.clip-walk', 'presentation.animation-clip'),
      edge('on', 'state.explore', 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.vfx-alarm',
    kind: 'presentation.vfx-cue',
    value: {
      label: 'Snow burst',
      trigger: 'instant',
      requirements: [requirement('req.vfx.alarm', 'vfx', 'effect')],
    },
    references: [],
    edges: [
      edge('on', 'event.alarm', 'gameplay.event'),
      edge('at', 'world.ice-danger', 'world-scene.zone'),
    ],
  },
  {
    id: 'presentation.audio-alarm',
    kind: 'presentation.audio-event',
    value: { label: 'Alarm event', spatial: true },
    references: [],
    edges: [edge('on', 'event.alarm', 'gameplay.event')],
  },
  {
    id: 'presentation.cue-alarm',
    kind: 'presentation.audio-cue',
    value: {
      label: 'Alarm cue',
      volume: 0.6,
      requirements: [requirement('req.audio.alarm', 'audio', 'cue')],
    },
    references: [],
    edges: [
      edge('event', 'presentation.audio-alarm', 'presentation.audio-event'),
      edge('at', 'world.ice-danger', 'world-scene.zone'),
    ],
  },
  {
    id: 'presentation.music-storm',
    kind: 'presentation.music-state',
    value: {
      label: 'Storm pulse',
      intensity: 0.8,
      requirements: [requirement('req.music.storm', 'music', 'music')],
    },
    references: [],
    edges: [edge('on', 'state.explore', 'gameplay.state')],
  },
  {
    id: 'presentation.transition-open',
    kind: 'presentation.transition',
    value: { label: 'Open alarm overlay', trigger: { kind: 'event' } },
    references: [],
    edges: [
      edge('from', 'presentation.state-menu', 'presentation.ui-state'),
      edge('to', 'presentation.state-menu-open', 'presentation.ui-state'),
      edge('on', 'event.alarm', 'gameplay.event'),
    ],
  },
]
const sortedPresentationNodes = sortNodes(presentationNodes)
const gameplayActionTarget: Node = {
  id: 'action.extract',
  kind: 'gameplay.action',
  value: { label: 'Extract sample' },
  references: [],
  edges: [
    edge('requires', 'condition.ready', 'gameplay.condition'),
    edge('causes', 'event.alarm', 'gameplay.event'),
  ],
}
const richPresentationNodes = sortNodes([
  ...presentationNodes,
  {
    id: 'presentation.ui-action-extract',
    kind: 'presentation.ui-action',
    value: { label: 'Extract', input: 'button' },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-hud', 'presentation.ui-screen'),
      edge('invokes', gameplayActionTarget.id, gameplayActionTarget.kind),
      edge('available-in', 'state.explore', 'gameplay.state'),
    ],
  },
]).map(node => ({ ...node, producerMode: 'semantic' as const, bindings: {} }))

function leafPointers(value: Record<string, unknown>): string[] {
  const out: string[] = []
  const visit = (entry: unknown, pointer: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) out.push(pointer)
      else entry.forEach((child, index) => visit(child, `${pointer}/${index}`))
      return
    }
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) out.push(pointer)
      else
        entries.forEach(([key, child]) =>
          visit(
            child,
            `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          ),
        )
      return
    }
    out.push(pointer)
  }
  Object.entries(value).forEach(([key, entry]) => visit(entry, `/value/${key}`))
  return out
}
const pointerValue = (node: Node, pointer: string): unknown => {
  if (pointer === '/id') return node.id
  if (pointer.startsWith('/references/'))
    return node.references[Number(pointer.slice(12))]
  if (pointer.startsWith('/edges/')) return node.edges[Number(pointer.slice(7))]
  let current: unknown = node.value
  for (const part of pointer
    .slice(7)
    .split('/')
    .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~')))
    current =
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)[part]
        : undefined
  return current
}
const pointers = (node: Node) => [
  '/id',
  ...leafPointers(node.value),
  ...node.references.map((_, index) => `/references/${index}`),
  ...node.edges.map((_, index) => `/edges/${index}`),
]
const allNodes = [
  ...gameplayNodes,
  ...balanceNodes,
  ...worldNodes,
  ...presentationNodes,
  gameplayActionTarget,
]
for (const node of allNodes) {
  ;(
    node.edges as Array<{ type: string; targetId: string; targetType: string }>
  ).sort((left, right) =>
    Buffer.from(`${left.type}\0${left.targetId}\0${left.targetType}`).compare(
      Buffer.from(`${right.type}\0${right.targetId}\0${right.targetType}`),
    ),
  )
  ;(node.references as Array<{ targetId: string; targetType: string }>).sort(
    (left, right) =>
      Buffer.from(`${left.targetId}\0${left.targetType}`).compare(
        Buffer.from(`${right.targetId}\0${right.targetType}`),
      ),
  )
}
const sourceRanges = new Map<string, string>()
let sourceBytes = ''
for (const node of [...allNodes].sort((a, b) =>
  Buffer.from(a.id).compare(Buffer.from(b.id)),
))
  for (const pointer of pointers(node).sort()) {
    const literal =
      typeof pointerValue(node, pointer) === 'string'
        ? String(pointerValue(node, pointer))
        : canonicalGameIrJson(pointerValue(node, pointer))
    const start = Buffer.byteLength(sourceBytes, 'utf8')
    sourceBytes += `${literal}\n`
    sourceRanges.set(
      `node:${node.id}#${pointer}`,
      `/bytes/${start}/${Buffer.byteLength(sourceBytes, 'utf8') - 1}`,
    )
  }
const fullIndex = canonicalizeGameIrSourceSections(
  CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
    documentPath,
    sectionId: `profile-${index}`,
    heading: documentPath,
    startLine: 1,
    endLine: sourceBytes.split('\n').length,
    digest: sha256(sourceBytes),
  })),
)
const foundationBody: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
  schemaVersion: 'foundation-ready-receipt.v1',
  projectId: 'traversal-profile',
  foundationRevision: 'b'.repeat(64),
  confirmedBriefDigest: digest,
  documentDigests: Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256(sourceBytes)]),
  ) as FoundationReadyReceipt['documentDigests'],
  sectionIndexPath: '.beegame/foundation/section-index.json',
  sectionIndexDigest: digestSectionIndex(fullIndex),
  authority: {
    kind: 'review',
    reviewDigest: digest,
    issueRegistryDigest: digest,
  },
}
const request = {
  schemaVersion: 'game-ir-compile-request.v1' as const,
  taskId: 'traversal-profile-task',
  publicationId: 'traversal-profile-publication',
  gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
  foundation: {
    ...foundationBody,
    receiptDigest: digestGameIrValue(foundationBody),
  },
}
const selectedDocs = (
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
): readonly FoundationDocumentPath[] =>
  canonicalGameIrModuleSourceDocuments(moduleId)
const source = (
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
) =>
  buildGameIrDomainSourceEnvelope({
    moduleId,
    request,
    sectionIndex: fullIndex,
    sectionBytes: Object.fromEntries(
      selectedDocs(moduleId).map(path => [
        `${path}#${fullIndex.find(section => section.documentPath === path)!.sectionId}`,
        sourceBytes,
      ]),
    ),
  })
const mechanical = (
  currentSource: ReturnType<typeof source>,
): GameIrMechanicalProjectionReceipt => {
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
const claims = (nodes: readonly Node[]) =>
  nodes
    .flatMap(node =>
      pointers(node)
        .sort()
        .map(pointer => ({
          subject: `node:${node.id}#${pointer}`,
          documentPath: 'docs/GDD.md' as FoundationDocumentPath,
          sectionId: 'profile-0',
          sourcePointer: sourceRanges.get(`node:${node.id}#${pointer}`)!,
          literal:
            typeof pointerValue(node, pointer) === 'string'
              ? String(pointerValue(node, pointer))
              : canonicalGameIrJson(pointerValue(node, pointer)),
        })),
    )
    .sort((a, b) =>
      Buffer.from(`${a.subject}\0${a.sourcePointer}`).compare(
        Buffer.from(`${b.subject}\0${b.sourcePointer}`),
      ),
    )
const balanceSectionId = fullIndex.find(
  section => section.documentPath === 'docs/BALANCE_DESIGN.md',
)!.sectionId
const balanceClaims = (nodes: readonly Node[]) =>
  nodes
    .flatMap(node =>
      pointers(node)
        .sort()
        .map(pointer => {
          const value =
            pointer.startsWith('/references/') || pointer.startsWith('/edges/')
              ? (
                  pointerValue(node, pointer) as
                    | { targetId: string }
                    | undefined
                )?.targetId
              : pointerValue(node, pointer)
          return {
            subject: `node:${node.id}#${pointer}`,
            documentPath: 'docs/BALANCE_DESIGN.md' as FoundationDocumentPath,
            sectionId: balanceSectionId,
            sourcePointer: sourceRanges.get(`node:${node.id}#${pointer}`)!,
            literal:
              typeof value === 'string' ? value : canonicalGameIrJson(value),
          }
        }),
    )
    .sort((a, b) =>
      Buffer.from(`${a.subject}\0${a.sourcePointer}`).compare(
        Buffer.from(`${b.subject}\0${b.sourcePointer}`),
      ),
    )
function phase4Authority() {
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
      sourceClaims: balanceClaims(balanceNodes),
    },
  )
  return {
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
}
function validationPacket(
  packet: ReturnType<typeof buildPhase5SemanticValidationPacket>,
) {
  return admitPhase5SemanticValidationResult(packet, {
    outcome: 'PASS',
    packetDigest: packet.packetDigest,
    checkIds: packet.checkIds,
    coveredTargets: packet.requiredTargets,
  })
}
function authority() {
  const phase4 = phase4Authority()
  const phase4Projection = assembleGameplayBalanceModules(phase4)
  const worldSource = source('world-scene')
  const worldMechanical = mechanical(worldSource)
  const worldPacket = buildWorldSceneSemanticPacket({
    source: worldSource,
    mechanical: worldMechanical,
  })
  const worldSemantic = admitWorldSceneSemanticResult(worldPacket, {
    outcome: 'PROJECTED',
    nodes: closureWorldNodes,
    sourceClaims: claims(closureWorldNodes),
  }) as WorldSceneSemanticReceipt
  const worldBound = replayAndBindPhase5SemanticReceipt({
    source: worldSource,
    mechanical: worldMechanical,
    packet: worldPacket,
    semantic: worldSemantic,
  })
  const worldModule = parseWorldSceneModule(
    worldBound.module,
    new Map(
      phase4Projection.gameplay.module.nodes.map(node => [node.id, node]),
    ),
  )
  const worldValidation = validationPacket(
    buildPhase5SemanticValidationPacket({
      source: worldSource,
      mechanical: worldMechanical,
      semantic: worldSemantic,
      module: worldModule,
      externalProjections: { gameplay: phase4Projection.gameplay },
    }),
  )
  const presentationSource = source('presentation')
  const presentationMechanical = mechanical(presentationSource)
  const presentationPacket = buildPresentationSemanticPacket({
    source: presentationSource,
    mechanical: presentationMechanical,
  })
  const presentationSemantic = admitPresentationSemanticResult(
    presentationPacket,
    {
      outcome: 'PROJECTED',
      nodes: sortedPresentationNodes,
      sourceClaims: claims(sortedPresentationNodes),
    },
  ) as PresentationSemanticReceipt
  const presentationBound = replayAndBindPhase5SemanticReceipt({
    source: presentationSource,
    mechanical: presentationMechanical,
    packet: presentationPacket,
    semantic: presentationSemantic,
  })
  const worldProjectionBody = {
    schemaVersion: 'game-ir-world-scene-module.v1' as const,
    taskId: worldSource.taskId,
    foundationRevision:
      worldSource.compileRequest.foundation.foundationRevision,
    module: worldModule,
    sourceDigest: worldSource.sourceDigest,
    mechanicalReceiptDigest: worldBound.mechanicalReceiptDigest,
    semanticReceiptDigest: worldBound.semanticReceiptDigest,
    semanticValidationResultDigest: digestGameIrValue(worldValidation),
  }
  const worldProjection = Object.freeze({
    ...worldProjectionBody,
    projectionDigest: digestGameIrValue(worldProjectionBody),
  })
  const presentationModule = parsePresentationModule(
    presentationBound.module,
    new Map(
      [...phase4Projection.gameplay.module.nodes, ...worldModule.nodes].map(
        node => [node.id, node],
      ),
    ),
  )
  const presentationValidation = validationPacket(
    buildPhase5SemanticValidationPacket({
      source: presentationSource,
      mechanical: presentationMechanical,
      semantic: presentationSemantic,
      module: presentationModule,
      externalProjections: {
        gameplay: phase4Projection.gameplay,
        worldScene: worldProjection as never,
      },
    }),
  )
  return {
    phase4Authority: phase4,
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
}

describe('Task 9 traversal/action World + Presentation profile', () => {
  test('assembles the complete nontrivial traversal/action graph with exact typed edges and requirements', () => {
    const authorityValue = authority()
    const closure = assembleWorldPresentationClosure(authorityValue)
    const world = closure.worldScene.module.nodes
    const presentation = closure.presentation.module.nodes
    expect(
      authorityValue.phase4Authority.gameplay.source.authoritySectionIndex,
    ).toEqual(fullIndex)
    expect(
      authorityValue.phase4Authority.gameplay.source.authoritySectionIndex,
    ).toHaveLength(8)
    for (const moduleId of [
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
    ] as const) {
      const envelope =
        moduleId === 'gameplay'
          ? authorityValue.phase4Authority.gameplay.source
          : moduleId === 'balance'
            ? authorityValue.phase4Authority.balance.source
            : moduleId === 'world-scene'
              ? authorityValue.worldScene.source
              : authorityValue.presentation.source
      expect(Object.keys(envelope.sectionBytes).sort()).toEqual(
        selectedDocs(moduleId)
          .map(
            path =>
              `${path}#${fullIndex.find(section => section.documentPath === path)!.sectionId}`,
          )
          .sort(),
      )
      expect(envelope.authoritySectionIndex).toEqual(fullIndex)
    }
    const richWorld = parseWorldSceneModule(
      { moduleId: 'world-scene', nodes: sortedWorldNodes } as never,
      new Map(
        closure.phase4.gameplay.module.nodes.map(node => [node.id, node]),
      ),
    )
    const richPresentation = parsePresentationModule(
      { moduleId: 'presentation', nodes: richPresentationNodes } as never,
      new Map(
        [
          ...closure.phase4.gameplay.module.nodes,
          ...closureWorldNodes,
          gameplayActionTarget,
        ].map(node => [node.id, node]),
      ) as never,
    )
    expect(
      richWorld.nodes
        .filter(node => node.kind === 'world-scene.route')
        .map(node => node.value.waypointReferenceIndexes),
    ).toEqual([
      [0, 1, 2],
      [0, 1],
    ])
    expect(
      richWorld.nodes
        .filter(node => node.kind === 'world-scene.encounter')
        .map(node => node.value.mode)
        .sort(),
    ).toEqual(['patrol', 'triggered'])
    expect(
      richPresentation.nodes.find(
        node => node.kind === 'presentation.ui-action',
      )?.edges,
    ).toContainEqual(edge('invokes', 'action.extract', 'gameplay.action'))
    expect(
      world
        .filter(node => node.kind === 'world-scene.scene')
        .map(node => node.id),
    ).toEqual([world2d, world3d])
    expect(
      world.filter(node => node.kind === 'world-scene.route'),
    ).toHaveLength(0)
    expect(
      world.filter(node => node.kind === 'world-scene.encounter'),
    ).toHaveLength(0)
    expect(
      world
        .filter(node => node.kind === 'world-scene.entity-instance')
        .map(node => node.edges.map(edge => edge.type)),
    ).toEqual([
      ['entity', 'location', 'scene', 'zone'],
      ['entity', 'location', 'scene'],
    ])
    expect(presentation.map(node => node.kind)).toEqual([
      'presentation.animation-state',
      'presentation.audio-event',
      'presentation.camera-behavior',
      'presentation.animation-clip',
      'presentation.audio-cue',
      'presentation.feedback',
      'presentation.music-state',
      'presentation.ui-screen',
      'presentation.ui-screen',
      'presentation.ui-state',
      'presentation.ui-state',
      'presentation.ui-state',
      'presentation.transition',
      'presentation.vfx-cue',
    ])
    expect(
      presentation.flatMap(
        node =>
          (
            node.value.requirements as
              | readonly { requirementId: string }[]
              | undefined
          )?.map(req => req.requirementId) ?? [],
      ),
    ).toEqual([
      'req.anim.walk',
      'req.audio.alarm',
      'req.music.storm',
      'req.ui.hud',
      'req.ui.menu',
      'req.vfx.alarm',
    ])
    expect(
      closure.presentation.module.nodes.find(
        node => node.id === 'presentation.cue-alarm',
      )?.edges,
    ).toContainEqual(edge('at', 'world.ice-danger', 'world-scene.zone'))
    expect(closure.worldScene.semanticValidationResultDigest).toBe(
      digestGameIrValue(authorityValue.worldScene.validation),
    )
    expect(closure.worldScene.projectionDigest).toBe(
      digestGameIrValue({
        schemaVersion: 'game-ir-world-scene-module.v1',
        taskId: closure.worldScene.taskId,
        foundationRevision: closure.worldScene.foundationRevision,
        module: closure.worldScene.module,
        sourceDigest: closure.worldScene.sourceDigest,
        mechanicalReceiptDigest: closure.worldScene.mechanicalReceiptDigest,
        semanticReceiptDigest: closure.worldScene.semanticReceiptDigest,
        semanticValidationResultDigest:
          closure.worldScene.semanticValidationResultDigest,
      }),
    )
    expect(closure.presentation.projectionDigest).toBe(
      digestGameIrValue({
        schemaVersion: 'game-ir-presentation-module.v1',
        taskId: closure.presentation.taskId,
        foundationRevision: closure.presentation.foundationRevision,
        module: closure.presentation.module,
        sourceDigest: closure.presentation.sourceDigest,
        mechanicalReceiptDigest: closure.presentation.mechanicalReceiptDigest,
        semanticReceiptDigest: closure.presentation.semanticReceiptDigest,
        semanticValidationResultDigest:
          closure.presentation.semanticValidationResultDigest,
      }),
    )
    for (const node of [
      ...closure.phase4.gameplay.module.nodes,
      ...closure.phase4.balance.module.nodes,
      ...world,
      ...presentation,
    ]) {
      expect(node.producerMode).toBe('semantic')
      expect(node.bindings).toHaveProperty('/id')
    }
  })
  test('is byte-identical across replay and preserves the frozen projections', () => {
    const first = assembleWorldPresentationClosure(authority())
    const second = assembleWorldPresentationClosure(authority())
    expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
    expect(first.closureDigest).toBe(second.closureDigest)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.phase4)).toBe(true)
    expect(Object.isFrozen(first.worldScene)).toBe(true)
    expect(Object.isFrozen(first.presentation)).toBe(true)
  })
  test('fails closed for source, mechanical, typed literal, graph, identity, and forbidden-target mutations', () => {
    const base = authority()
    expect(() => assembleWorldPresentationClosure(base)).not.toThrow()
    const worldNodesMissing = worldNodes.slice(0, -1)
    const worldPacket = buildWorldSceneSemanticPacket({
      source: base.worldScene.source,
      mechanical: base.worldScene.mechanical,
    })
    const worldSemantic = admitWorldSceneSemanticResult(worldPacket, {
      outcome: 'PROJECTED',
      nodes: worldNodesMissing,
      sourceClaims: claims(worldNodesMissing),
    }) as WorldSceneSemanticReceipt
    expect(() =>
      assembleWorldPresentationClosure({
        ...base,
        worldScene: { ...base.worldScene, semantic: worldSemantic },
      } as never),
    ).toThrow()
    expect(() =>
      assembleWorldPresentationClosure({
        ...base,
        worldScene: {
          ...base.worldScene,
          mechanical: {
            ...base.worldScene.mechanical,
            nodes: [
              {
                id: 'spoof',
                kind: 'world-scene.node',
                value: {},
                references: [],
                edges: [],
              },
            ],
          },
        },
      } as never),
    ).toThrow()
    const badPresentation = sortedPresentationNodes.map(node =>
      node.id === 'presentation.transition-open'
        ? { ...node, value: { ...node.value, trigger: { kind: 'automatic' } } }
        : node,
    )
    const presentationPacket = buildPresentationSemanticPacket({
      source: base.presentation.source,
      mechanical: base.presentation.mechanical,
    })
    const presentationSemantic = admitPresentationSemanticResult(
      presentationPacket,
      {
        outcome: 'PROJECTED',
        nodes: badPresentation,
        sourceClaims: claims(badPresentation),
      },
    ) as PresentationSemanticReceipt
    expect(() =>
      assembleWorldPresentationClosure({
        ...base,
        presentation: { ...base.presentation, semantic: presentationSemantic },
      } as never),
    ).toThrow()
    expect(() =>
      assembleWorldPresentationClosure({
        ...base,
        presentation: {
          ...base.presentation,
          source: { ...base.presentation.source, taskId: 'other-task' },
        },
      } as never),
    ).toThrow()
    const forbidden = presentationNodes.map(node =>
      node.id === 'presentation.camera-follow'
        ? {
            ...node,
            edges: node.edges.map(candidate =>
              candidate.type === 'region'
                ? {
                    ...candidate,
                    targetId: 'balance.energy',
                    targetType: 'balance.variable',
                  }
                : candidate,
            ),
          }
        : node,
    )
    const forbiddenSemantic = admitPresentationSemanticResult(
      presentationPacket,
      {
        outcome: 'PROJECTED',
        nodes: forbidden,
        sourceClaims: claims(forbidden),
      },
    ) as PresentationSemanticReceipt
    expect(() =>
      assembleWorldPresentationClosure({
        ...base,
        presentation: { ...base.presentation, semantic: forbiddenSemantic },
      } as never),
    ).toThrow()
  })
})
