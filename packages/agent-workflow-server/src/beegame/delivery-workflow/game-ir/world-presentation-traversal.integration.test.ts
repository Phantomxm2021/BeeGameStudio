import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  admitGameIrMechanicalProjectionReceipt,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  buildGameIrDomainSourceEnvelope,
  canonicalGameIrModuleSourceDocuments,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  admitGameplaySemanticResult,
  buildGameplaySemanticPacket,
  type GameIrDomainSemanticReceipt as GameplaySemanticReceipt,
} from './gameplay-producer'
import {
  admitBalanceSemanticResult,
  buildBalanceSemanticPacket,
  type GameIrDomainSemanticReceipt as BalanceSemanticReceipt,
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
  type WorldSceneModuleProjection,
} from './phase5-admission'
import { GAME_IR_SEMANTIC_VALIDATOR_MANIFEST } from './semantic-admission'
import { assembleWorldPresentationClosure } from './world-presentation-assembler'
import { assembleGameplayBalanceModules } from './gameplay-balance-assembler'
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
    id: 'action.extract',
    kind: 'gameplay.action',
    value: { label: 'Extract sample' },
    references: [
      { targetId: 'condition.ready', targetType: 'gameplay.condition' },
      { targetId: 'effect.alarm', targetType: 'gameplay.effect' },
      { targetId: 'event.alarm', targetType: 'gameplay.event' },
    ],
    edges: [
      edge('causes', 'effect.alarm', 'gameplay.effect'),
      edge('causes', 'event.alarm', 'gameplay.event'),
      edge('requires', 'condition.ready', 'gameplay.condition'),
    ],
  },
  {
    id: 'capability.player-extract',
    kind: 'gameplay.capability',
    value: { label: 'Can extract' },
    references: [],
    edges: [edge('belongs-to', 'entity.player', 'gameplay.entity')],
  },
  {
    id: 'condition.ready',
    kind: 'gameplay.condition',
    value: { expression: { kind: 'reference', referenceIndex: 0 } },
    references: [
      {
        targetId: 'capability.player-extract',
        targetType: 'gameplay.capability',
      },
    ],
    edges: [],
  },
  {
    id: 'effect.alarm',
    kind: 'gameplay.effect',
    value: { effect: { operation: 'emit', targetReferenceIndex: 0 } },
    references: [{ targetId: 'event.alarm', targetType: 'gameplay.event' }],
    edges: [],
  },
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
    id: 'objective.extract',
    kind: 'gameplay.objective',
    value: { label: 'Extract the sample' },
    references: [],
    edges: [
      edge('fails-with', 'outcome.loss', 'gameplay.outcome'),
      edge('succeeds-with', 'outcome.win', 'gameplay.outcome'),
    ],
  },
  {
    id: 'outcome.loss',
    kind: 'gameplay.outcome',
    value: { label: 'Loss', result: 'loss' },
    references: [],
    edges: [],
  },
  {
    id: 'outcome.win',
    kind: 'gameplay.outcome',
    value: { label: 'Win', result: 'win' },
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
    id: 'world.ice-objective',
    kind: 'world-scene.objective-placement',
    value: { label: 'Sample extraction point' },
    references: [],
    edges: [
      sceneEdge(world2d),
      edge('objective', 'objective.extract', 'gameplay.objective'),
      edge('location', 'world.ice-exit', 'world-scene.node'),
      edge('zone', 'world.ice-danger', 'world-scene.zone'),
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
const sortNodes = (nodes: readonly Node[]): Node[] =>
  [...nodes].sort((left, right) =>
    Buffer.from(left.id).compare(Buffer.from(right.id)),
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
    id: 'presentation.ui-action-extract',
    kind: 'presentation.ui-action',
    value: { label: 'Extract', input: 'button' },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-hud', 'presentation.ui-screen'),
      edge('invokes', 'action.extract', 'gameplay.action'),
      edge('available-in', 'state.explore', 'gameplay.state'),
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
    value: { label: 'Open extraction overlay', trigger: { kind: 'action' } },
    references: [],
    edges: [
      edge('from', 'presentation.state-menu', 'presentation.ui-state'),
      edge('to', 'presentation.state-menu-open', 'presentation.ui-state'),
      edge('on', 'action.extract', 'gameplay.action'),
    ],
  },
]

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
const candidateView = (nodes: readonly Node[]) =>
  sortNodes(nodes).map(({ id, kind, value, references, edges }) => ({
    id,
    kind,
    value,
    references,
    edges,
  }))
const closureView = (nodes: readonly GameIrNode[]) =>
  nodes.map(({ id, kind, value, references, edges }) => ({
    id,
    kind,
    value,
    references,
    edges,
  }))
const targetSubjects = (nodes: readonly Node[]) =>
  nodes
    .flatMap(node =>
      pointers(node).map(pointer => `node:${node.id}#${pointer}`),
    )
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
const expectedCheckIds = (moduleId: 'world-scene' | 'presentation') =>
  GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.find(
    module => module.moduleId === moduleId,
  )!.checkIds
const allNodes = [
  ...gameplayNodes,
  ...balanceNodes,
  ...worldNodes,
  ...presentationNodes,
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
type FixtureOverrides = Partial<{
  gameplay: readonly Node[]
  balance: readonly Node[]
  world: readonly Node[]
  presentation: readonly Node[]
}>
const baseContext = {
  sourceBytes,
  sourceRanges,
  fullIndex,
  request,
}
const fixtureContext = (overrides: FixtureOverrides = {}) => {
  const modules = {
    gameplay: overrides.gameplay ?? gameplayNodes,
    balance: overrides.balance ?? balanceNodes,
    world: overrides.world ?? worldNodes,
    presentation: overrides.presentation ?? presentationNodes,
  }
  const nodes = [
    ...modules.gameplay,
    ...modules.balance,
    ...modules.world,
    ...modules.presentation,
  ]
  const ranges = new Map<string, string>()
  let bytes = ''
  for (const node of [...nodes].sort((a, b) =>
    Buffer.from(a.id).compare(Buffer.from(b.id)),
  ))
    for (const pointer of pointers(node).sort()) {
      const value = pointerValue(node, pointer)
      const literal =
        typeof value === 'string' ? value : canonicalGameIrJson(value)
      const start = Buffer.byteLength(bytes, 'utf8')
      bytes += `${literal}\n`
      ranges.set(
        `node:${node.id}#${pointer}`,
        `/bytes/${start}/${Buffer.byteLength(bytes, 'utf8') - 1}`,
      )
    }
  const index = canonicalizeGameIrSourceSections(
    CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `profile-${index}`,
      heading: documentPath,
      startLine: 1,
      endLine: bytes.split('\n').length,
      digest: sha256(bytes),
    })),
  )
  const foundation = {
    ...foundationBody,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256(bytes)]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexDigest: digestSectionIndex(index),
  }
  return {
    sourceBytes: bytes,
    sourceRanges: ranges,
    fullIndex: index,
    request: {
      ...request,
      foundation: {
        ...foundation,
        receiptDigest: digestGameIrValue(foundation),
      },
    },
    modules,
  }
}
const selectedDocs = (
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
): readonly FoundationDocumentPath[] =>
  canonicalGameIrModuleSourceDocuments(moduleId)
const source = (
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
  context: {
    sourceBytes: string
    fullIndex: typeof fullIndex
    request: typeof request
  } = baseContext,
) =>
  buildGameIrDomainSourceEnvelope({
    moduleId,
    request: context.request,
    sectionIndex: context.fullIndex,
    sectionBytes: Object.fromEntries(
      selectedDocs(moduleId).map(path => [
        `${path}#${context.fullIndex.find(section => section.documentPath === path)!.sectionId}`,
        context.sourceBytes,
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
const claims = (
  nodes: readonly Node[],
  ranges: ReadonlyMap<string, string> = sourceRanges,
) =>
  nodes
    .flatMap(node =>
      pointers(node)
        .sort()
        .map(pointer => ({
          subject: `node:${node.id}#${pointer}`,
          documentPath: 'docs/GDD.md' as FoundationDocumentPath,
          sectionId: 'profile-0',
          sourcePointer: ranges.get(`node:${node.id}#${pointer}`)!,
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
const balanceClaims = (
  nodes: readonly Node[],
  ranges: ReadonlyMap<string, string> = sourceRanges,
) =>
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
            sourcePointer: ranges.get(`node:${node.id}#${pointer}`)!,
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
function phase4Authority(
  context: ReturnType<typeof fixtureContext> | typeof baseContext = baseContext,
  overrides: FixtureOverrides = {},
) {
  const gameplaySource = source('gameplay', context)
  const balanceSource = source('balance', context)
  const gameplay = overrides.gameplay ?? gameplayNodes
  const balance = overrides.balance ?? balanceNodes
  const gameplayMechanical = mechanical(gameplaySource)
  const balanceMechanical = mechanical(balanceSource)
  const gameplaySemantic = admitGameplaySemanticResult(
    buildGameplaySemanticPacket({
      source: gameplaySource,
      mechanical: gameplayMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: gameplay,
      sourceClaims: claims(gameplay, context.sourceRanges),
    },
  )
  const balanceSemantic = admitBalanceSemanticResult(
    buildBalanceSemanticPacket({
      source: balanceSource,
      mechanical: balanceMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: balance,
      sourceClaims: balanceClaims(balance, context.sourceRanges),
    },
  )
  return {
    gameplay: {
      source: gameplaySource,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic as GameplaySemanticReceipt,
    },
    balance: {
      source: balanceSource,
      mechanical: balanceMechanical,
      semantic: balanceSemantic as BalanceSemanticReceipt,
    },
  }
}
function validationPacket(
  packet: ReturnType<typeof buildPhase5SemanticValidationPacket>,
): Extract<
  ReturnType<typeof admitPhase5SemanticValidationResult>,
  { outcome: 'PASS' }
> {
  const result = admitPhase5SemanticValidationResult(packet, {
    outcome: 'PASS',
    packetDigest: packet.packetDigest,
    checkIds: packet.checkIds,
    coveredTargets: packet.requiredTargets,
  })
  if (result.outcome !== 'PASS') throw new Error('fixture validation must pass')
  return result
}
const redigestMechanical = (
  receipt: GameIrMechanicalProjectionReceipt,
  patch: Record<string, unknown>,
) => {
  const body = { ...receipt, ...patch }
  const { receiptDigest: _receiptDigest, ...unsigned } = body
  return { ...unsigned, receiptDigest: digestGameIrValue(unsigned) }
}
const redigestSemantic = (
  receipt: WorldSceneSemanticReceipt | PresentationSemanticReceipt,
  patch: Record<string, unknown>,
) => {
  const body = { ...receipt, ...patch }
  const { receiptDigest: _receiptDigest, ...unsigned } = body
  return { ...unsigned, receiptDigest: digestGameIrValue(unsigned) }
}
function freezeFixture(value: unknown): void {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      freezeFixture(child)
    Object.freeze(value)
  }
}
function assertOwnerBindings(
  nodes: readonly GameIrNode[],
  sourceClaims: readonly {
    subject: string
    documentPath: FoundationDocumentPath
    sectionId: string
    sourcePointer: string
    literal: string
  }[],
  source: GameIrDomainSourceEnvelope,
): void {
  const claimsBySubject = new Map(
    sourceClaims.map(claim => [claim.subject, claim]),
  )
  for (const node of nodes) {
    const nodePointers = pointers(node)
    expect(Object.keys(node.bindings).sort()).toEqual([...nodePointers].sort())
    for (const pointer of nodePointers) {
      const claim = claimsBySubject.get(`node:${node.id}#${pointer}`)
      const section = source.authoritySectionIndex.find(
        item =>
          item.documentPath === claim?.documentPath &&
          item.sectionId === claim?.sectionId,
      )
      expect(claim).toBeDefined()
      expect(section).toBeDefined()
      expect(node.bindings[pointer]).toEqual({
        kind: 'owner',
        documentPath: claim!.documentPath,
        sectionId: claim!.sectionId,
        sectionDigest: section!.digest,
        sourcePointer: claim!.sourcePointer,
      })
    }
  }
}
function expectAssemblyError(
  authorityInput: Parameters<typeof assembleWorldPresentationClosure>[0],
  expectedMessage: string,
): void {
  let caught: unknown
  try {
    assembleWorldPresentationClosure(authorityInput)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).message).toBe(expectedMessage)
}
function authority(overrides: FixtureOverrides = {}) {
  const context = fixtureContext(overrides)
  const phase4 = phase4Authority(context, overrides)
  const phase4Projection = assembleGameplayBalanceModules(phase4)
  const worldSource = source('world-scene', context)
  const worldMechanical = mechanical(worldSource)
  const worldPacket = buildWorldSceneSemanticPacket({
    source: worldSource,
    mechanical: worldMechanical,
  })
  const worldSemantic = admitWorldSceneSemanticResult(worldPacket, {
    outcome: 'PROJECTED',
    nodes: sortNodes(overrides.world ?? worldNodes),
    sourceClaims: claims(
      sortNodes(overrides.world ?? worldNodes),
      context.sourceRanges,
    ),
  }) as WorldSceneSemanticReceipt
  const worldBound = replayAndBindPhase5SemanticReceipt({
    source: worldSource,
    mechanical: worldMechanical,
    packet: worldPacket,
    semantic: worldSemantic,
  })
  const worldModule: WorldSceneModuleProjection['module'] = Object.freeze({
    ...worldBound.module,
    moduleId: 'world-scene',
  })
  const worldValidationPacket = buildPhase5SemanticValidationPacket({
    source: worldSource,
    mechanical: worldMechanical,
    semantic: worldSemantic,
    module: worldModule,
    externalProjections: { gameplay: phase4Projection.gameplay },
  })
  const worldValidation = validationPacket(worldValidationPacket)
  const presentationSource = source('presentation', context)
  const presentationMechanical = mechanical(presentationSource)
  const presentationPacket = buildPresentationSemanticPacket({
    source: presentationSource,
    mechanical: presentationMechanical,
  })
  const presentationSemantic = admitPresentationSemanticResult(
    presentationPacket,
    {
      outcome: 'PROJECTED',
      nodes: sortNodes(overrides.presentation ?? presentationNodes),
      sourceClaims: claims(
        sortNodes(overrides.presentation ?? presentationNodes),
        context.sourceRanges,
      ),
    },
  ) as PresentationSemanticReceipt
  const presentationBound = replayAndBindPhase5SemanticReceipt({
    source: presentationSource,
    mechanical: presentationMechanical,
    packet: presentationPacket,
    semantic: presentationSemantic,
  })
  const worldProjectionBody: Omit<
    WorldSceneModuleProjection,
    'projectionDigest'
  > = {
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
  const worldProjection: WorldSceneModuleProjection = Object.freeze({
    ...worldProjectionBody,
    projectionDigest: digestGameIrValue(worldProjectionBody),
  })
  const presentationModule = presentationBound.module
  const presentationValidationPacket = buildPhase5SemanticValidationPacket({
    source: presentationSource,
    mechanical: presentationMechanical,
    semantic: presentationSemantic,
    module: presentationModule,
    externalProjections: {
      gameplay: phase4Projection.gameplay,
      worldScene: worldProjection,
    },
  })
  const presentationValidation = validationPacket(presentationValidationPacket)
  return {
    authority: {
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
    },
    worldValidationPacket,
    presentationValidationPacket,
  }
}

describe('Task 9 traversal/action World + Presentation profile', () => {
  test('assembles the complete nontrivial traversal/action graph with exact typed edges and requirements', () => {
    const authorityValue = authority()
    const closure = assembleWorldPresentationClosure(authorityValue.authority)
    const world = closure.worldScene.module.nodes
    const presentation = closure.presentation.module.nodes
    expect(closureView(closure.phase4.gameplay.module.nodes)).toEqual(
      candidateView(gameplayNodes),
    )
    expect(closureView(closure.phase4.balance.module.nodes)).toEqual(
      candidateView(balanceNodes),
    )
    expect(closureView(world)).toEqual(candidateView(worldNodes))
    expect(closureView(presentation)).toEqual(candidateView(presentationNodes))
    expect(
      closure.phase4.gameplay.module.nodes
        .filter(node =>
          ['gameplay.action', 'gameplay.objective'].includes(node.kind),
        )
        .map(node => node.id),
    ).toEqual(['action.extract', 'objective.extract'])
    expect(
      authorityValue.authority.phase4Authority.gameplay.source
        .authoritySectionIndex,
    ).toEqual(fullIndex)
    expect(
      authorityValue.authority.phase4Authority.gameplay.source
        .authoritySectionIndex,
    ).toHaveLength(8)
    expect(authorityValue.worldValidationPacket.requiredTargets).toEqual(
      targetSubjects(worldNodes),
    )
    expect(authorityValue.presentationValidationPacket.requiredTargets).toEqual(
      targetSubjects(presentationNodes),
    )
    expect(authorityValue.worldValidationPacket.checkIds).toEqual(
      expectedCheckIds('world-scene'),
    )
    expect(authorityValue.presentationValidationPacket.checkIds).toEqual(
      expectedCheckIds('presentation'),
    )
    expect(authorityValue.authority.worldScene.validation.checkIds).toEqual(
      expectedCheckIds('world-scene'),
    )
    expect(authorityValue.authority.presentation.validation.checkIds).toEqual(
      expectedCheckIds('presentation'),
    )
    expect(
      authorityValue.authority.worldScene.validation.coveredTargets,
    ).toEqual(authorityValue.worldValidationPacket.requiredTargets)
    expect(
      authorityValue.authority.presentation.validation.coveredTargets,
    ).toEqual(authorityValue.presentationValidationPacket.requiredTargets)
    for (const moduleId of [
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
    ] as const) {
      const envelope =
        moduleId === 'gameplay'
          ? authorityValue.authority.phase4Authority.gameplay.source
          : moduleId === 'balance'
            ? authorityValue.authority.phase4Authority.balance.source
            : moduleId === 'world-scene'
              ? authorityValue.authority.worldScene.source
              : authorityValue.authority.presentation.source
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
    expect(
      world
        .filter(node => node.kind === 'world-scene.scene')
        .map(node => node.id),
    ).toEqual([world2d, world3d])
    expect(
      world
        .filter(node => node.kind === 'world-scene.route')
        .map(node => node.value.waypointReferenceIndexes),
    ).toEqual([
      [0, 1, 2],
      [0, 1],
    ])
    expect(
      world
        .filter(node => node.kind === 'world-scene.encounter')
        .map(node => node.value.mode)
        .sort(),
    ).toEqual(['patrol', 'triggered'])
    expect(
      world.find(node => node.kind === 'world-scene.objective-placement')
        ?.edges,
    ).toContainEqual(
      edge('objective', 'objective.extract', 'gameplay.objective'),
    )
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
      'presentation.ui-action',
      'presentation.vfx-cue',
    ])
    expect(
      presentation.find(node => node.kind === 'presentation.ui-action')?.edges,
    ).toContainEqual(edge('invokes', 'action.extract', 'gameplay.action'))
    expect(
      presentation.find(node => node.kind === 'presentation.transition')?.edges,
    ).toContainEqual(edge('on', 'action.extract', 'gameplay.action'))
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
      digestGameIrValue(authorityValue.authority.worldScene.validation),
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
    assertOwnerBindings(
      closure.phase4.gameplay.module.nodes,
      authorityValue.authority.phase4Authority.gameplay.semantic.sourceClaims,
      authorityValue.authority.phase4Authority.gameplay.source,
    )
    assertOwnerBindings(
      closure.phase4.balance.module.nodes,
      authorityValue.authority.phase4Authority.balance.semantic.sourceClaims,
      authorityValue.authority.phase4Authority.balance.source,
    )
    assertOwnerBindings(
      world,
      authorityValue.authority.worldScene.semantic.sourceClaims,
      authorityValue.authority.worldScene.source,
    )
    assertOwnerBindings(
      presentation,
      authorityValue.authority.presentation.semantic.sourceClaims,
      authorityValue.authority.presentation.source,
    )
  })
  test('is byte-identical across replay and preserves the frozen projections', () => {
    const profile = authority()
    freezeFixture(profile)
    const first = assembleWorldPresentationClosure(profile.authority)
    const second = assembleWorldPresentationClosure(profile.authority)
    expect(canonicalGameIrJson(first.phase4.gameplay.module)).toBe(
      canonicalGameIrJson(second.phase4.gameplay.module),
    )
    expect(first.phase4.gameplay.projectionDigest).toBe(
      second.phase4.gameplay.projectionDigest,
    )
    expect(canonicalGameIrJson(first.phase4.balance.module)).toBe(
      canonicalGameIrJson(second.phase4.balance.module),
    )
    expect(first.phase4.balance.projectionDigest).toBe(
      second.phase4.balance.projectionDigest,
    )
    expect(canonicalGameIrJson(first.worldScene.module)).toBe(
      canonicalGameIrJson(second.worldScene.module),
    )
    expect(first.worldScene.projectionDigest).toBe(
      second.worldScene.projectionDigest,
    )
    expect(canonicalGameIrJson(first.presentation.module)).toBe(
      canonicalGameIrJson(second.presentation.module),
    )
    expect(first.presentation.projectionDigest).toBe(
      second.presentation.projectionDigest,
    )
    expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
    expect(first.closureDigest).toBe(second.closureDigest)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.phase4)).toBe(true)
    expect(Object.isFrozen(first.worldScene)).toBe(true)
    expect(Object.isFrozen(first.presentation)).toBe(true)
  })
  test('fails closed for source, mechanical, typed literal, graph, identity, and forbidden-target mutations', () => {
    const base = authority().authority
    assembleWorldPresentationClosure(base)
    const worldNodesMissing = sortNodes(worldNodes).map(node =>
      node.id === 'world.ice-objective'
        ? {
            ...node,
            edges: node.edges.filter(
              candidate => candidate.type !== 'objective',
            ),
          }
        : node,
    )
    const worldGraphProfile = authority({ world: worldNodesMissing })
    expectAssemblyError(
      worldGraphProfile.authority,
      'invalid World/Scene module: node world.ice-objective relationship objective must occur exactly once',
    )
    const worldNumeric = sortNodes(worldNodes).map(node =>
      node.id === 'world.ice-danger'
        ? {
            ...node,
            value: {
              ...node.value,
              shape: { kind: 'circle', radius: 0 },
            },
          }
        : node,
    )
    const worldNumericProfile = authority({ world: worldNumeric })
    expectAssemblyError(
      worldNumericProfile.authority,
      'invalid World/Scene module: node world.ice-danger shape.radius must be positive',
    )
    const mechanicalNodes = redigestMechanical(base.worldScene.mechanical, {
      nodes: [{ id: 'spoof', kind: 'world-scene.node' }],
    })
    const mechanicalNodesAuthority = {
      ...base,
      worldScene: { ...base.worldScene, mechanical: mechanicalNodes },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      mechanicalNodesAuthority,
      'invalid Game IR domain projection: isolated domain mechanical nodes and verifiedClaims must be empty',
    )
    const mechanicalClaims = redigestMechanical(base.worldScene.mechanical, {
      verifiedClaims: ['node:spoof#/id'],
    })
    const mechanicalClaimsAuthority = {
      ...base,
      worldScene: { ...base.worldScene, mechanical: mechanicalClaims },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      mechanicalClaimsAuthority,
      'invalid Game IR domain projection: isolated domain mechanical nodes and verifiedClaims must be empty',
    )
    const mechanicalOwned = redigestMechanical(base.worldScene.mechanical, {
      ownedTargets: ['node:spoof#/id'],
    })
    const mechanicalOwnedAuthority = {
      ...base,
      worldScene: { ...base.worldScene, mechanical: mechanicalOwned },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      mechanicalOwnedAuthority,
      'invalid Game IR domain projection: ownedTargets must exactly account for every mechanical node target',
    )
    const sourceKey = Object.keys(base.worldScene.source.sectionBytes)[0]!
    const sourceBytesTampered = {
      ...base.worldScene.source,
      sectionBytes: {
        ...base.worldScene.source.sectionBytes,
        [sourceKey]: `${base.worldScene.source.sectionBytes[sourceKey]}tamper`,
      },
    }
    const sourceBytesAuthority = {
      ...base,
      worldScene: { ...base.worldScene, source: sourceBytesTampered },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      sourceBytesAuthority,
      'invalid Game IR domain source: source envelope bytes do not match docs/GDD.md#profile-0',
    )
    const literalClaims = base.worldScene.semantic.sourceClaims.map(
      (claim, index) =>
        index === 0 ? { ...claim, literal: 'wrong literal' } : claim,
    )
    const literalSemantic = redigestSemantic(base.worldScene.semantic, {
      sourceClaims: literalClaims,
    }) as WorldSceneSemanticReceipt
    const literalAuthority = {
      ...base,
      worldScene: { ...base.worldScene, semantic: literalSemantic },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      literalAuthority,
      'invalid Game IR Phase 5 admission: source literal does not match the semantic record',
    )
    const rangeClaims = base.worldScene.semantic.sourceClaims.map(
      (claim, index) =>
        index === 0 ? { ...claim, sourcePointer: '/bytes/0/0' } : claim,
    )
    const rangeSemantic = redigestSemantic(base.worldScene.semantic, {
      sourceClaims: rangeClaims,
    }) as WorldSceneSemanticReceipt
    const rangeAuthority = {
      ...base,
      worldScene: { ...base.worldScene, semantic: rangeSemantic },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      rangeAuthority,
      'invalid Game IR Phase 5 admission: sourceClaims[0].sourcePointer must contain a non-empty byte range',
    )
    const stalePresentationValidation = {
      ...base.presentation.validation,
      packetDigest: base.worldScene.validation.packetDigest,
    }
    const stalePresentationAuthority = {
      ...base,
      presentation: {
        ...base.presentation,
        validation: stalePresentationValidation,
      },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      stalePresentationAuthority,
      'invalid Game IR Phase 5 admission: fidelity PASS packet digest does not match packet',
    )
    const badPresentation = sortNodes(presentationNodes).map(node =>
      node.id === 'presentation.transition-open'
        ? { ...node, value: { ...node.value, trigger: { kind: 'foobar' } } }
        : node,
    )
    const badPresentationProfile = authority({ presentation: badPresentation })
    expectAssemblyError(
      badPresentationProfile.authority,
      'invalid Presentation module: node presentation.transition-open trigger kind is invalid',
    )
    const badUiAction = sortNodes(presentationNodes).map(node =>
      node.id === 'presentation.ui-action-extract'
        ? { ...node, value: { ...node.value, input: 'joystick' } }
        : node,
    )
    const badUiActionProfile = authority({ presentation: badUiAction })
    expectAssemblyError(
      badUiActionProfile.authority,
      'invalid Presentation module: node presentation.ui-action-extract input is invalid',
    )
    const badRequirement = sortNodes(presentationNodes).map(node =>
      node.id === 'presentation.screen-hud'
        ? {
            ...node,
            value: {
              ...node.value,
              requirements: [requirement('req.ui.hud', 'audio', 'cue')],
            },
          }
        : node,
    )
    const badRequirementProfile = authority({ presentation: badRequirement })
    expectAssemblyError(
      badRequirementProfile.authority,
      'invalid Presentation module: node presentation.screen-hud requirement policy does not match',
    )
    const presentationIdentityAuthority = {
      ...base,
      presentation: {
        ...base.presentation,
        source: { ...base.presentation.source, taskId: 'other-task' },
      },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      presentationIdentityAuthority,
      'invalid Game IR domain source: source envelope taskId does not match compile request',
    )
    const gameplayIdentityAuthority = {
      ...base,
      phase4Authority: {
        ...base.phase4Authority,
        gameplay: {
          ...base.phase4Authority.gameplay,
          source: {
            ...base.phase4Authority.gameplay.source,
            taskId: 'other-task',
          },
        },
      },
    } as Parameters<typeof assembleWorldPresentationClosure>[0]
    expectAssemblyError(
      gameplayIdentityAuthority,
      'invalid Game IR domain source: source envelope taskId does not match compile request',
    )
    const changedGameplay = gameplayNodes.map(node =>
      node.id === 'entity.player'
        ? { ...node, value: { ...node.value, label: 'PiloT' } }
        : node,
    )
    const changedGameplayProfile = authority({ gameplay: changedGameplay })
    assembleWorldPresentationClosure(changedGameplayProfile.authority)
    const staleWorldValidationAuthority = {
      ...changedGameplayProfile.authority,
      worldScene: {
        ...changedGameplayProfile.authority.worldScene,
        validation: base.worldScene.validation,
      },
    }
    expectAssemblyError(
      staleWorldValidationAuthority,
      'invalid Game IR Phase 5 admission: fidelity PASS packet digest does not match packet',
    )
    const changedWorld = worldNodes.map(node =>
      node.id === world2d
        ? { ...node, value: { ...node.value, label: 'Ice shElf' } }
        : node,
    )
    const changedWorldProfile = authority({ world: changedWorld })
    assembleWorldPresentationClosure(changedWorldProfile.authority)
    const stalePresentationWorldAuthority = {
      ...changedWorldProfile.authority,
      presentation: {
        ...changedWorldProfile.authority.presentation,
        validation: base.presentation.validation,
      },
    }
    expectAssemblyError(
      stalePresentationWorldAuthority,
      'invalid Game IR Phase 5 admission: fidelity PASS packet digest does not match packet',
    )
    const forbidden = presentationNodes.map(node =>
      node.id === 'presentation.camera-follow'
        ? {
            ...node,
            edges: node.edges.map(candidate =>
              candidate.type === 'region'
                ? {
                    ...candidate,
                    targetId: 'entity.player',
                    targetType: 'gameplay.entity',
                  }
                : candidate,
            ),
          }
        : node,
    )
    const forbiddenProfile = authority({ presentation: forbidden })
    expectAssemblyError(
      forbiddenProfile.authority,
      'invalid Presentation module: node presentation.camera-follow role region has wrong target kind',
    )
  })
})
