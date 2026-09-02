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
  type Phase5SemanticValidationPacket,
} from './phase5-admission'
import {
  assembleWorldPresentationClosure,
  preparePresentationSemanticValidationPacket,
  prepareWorldSceneSemanticValidationPacket,
} from './world-presentation-assembler'
import {
  canonicalGameIrJson,
  canonicalizeGameIrSourceSections,
  digestGameIrValue,
  type GameIrNode,
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

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')
const digest = 'c'.repeat(64)
type Node = Omit<GameIrNode, 'producerMode' | 'bindings'>
const edge = (type: string, targetId: string, targetType: string) => ({
  type,
  targetId,
  targetType,
})
const scene = 'world.scene-lattice'
const entity = 'entity.solver'
const stateIdle = 'state.idle'
const stateSolved = 'state.solved'
const eventRune = 'event.rune-turned'
const actionTurn = 'action.turn-rune'
const objectiveEast = 'objective.east'
const objectiveWest = 'objective.west'
const ACCEPTED_TASK9_CLOSURE_DIGEST =
  'ade4e1917c8ae5d55e7212b14ee6232439cd64c532f7d902a76ae3068e3fccc1'

let gameplayNodes: Node[] = [
  {
    id: actionTurn,
    kind: 'gameplay.action',
    value: { label: 'Turn rune' },
    references: [
      { targetId: 'condition.rune-ready', targetType: 'gameplay.condition' },
      { targetId: 'effect.advance', targetType: 'gameplay.effect' },
      { targetId: eventRune, targetType: 'gameplay.event' },
    ],
    edges: [
      edge('requires', 'condition.rune-ready', 'gameplay.condition'),
      edge('causes', 'effect.advance', 'gameplay.effect'),
      edge('causes', eventRune, 'gameplay.event'),
    ],
  },
  {
    id: 'condition.rune-ready',
    kind: 'gameplay.condition',
    value: { expression: { kind: 'boolean', value: true } },
    references: [],
    edges: [],
  },
  {
    id: 'effect.advance',
    kind: 'gameplay.effect',
    value: { effect: { operation: 'emit', targetReferenceIndex: 0 } },
    references: [{ targetId: eventRune, targetType: 'gameplay.event' }],
    edges: [],
  },
  {
    id: 'transition.solved',
    kind: 'gameplay.transition',
    value: { label: 'Rune alignment complete' },
    references: [],
    edges: [
      edge('from', stateIdle, 'gameplay.state'),
      edge('to', stateSolved, 'gameplay.state'),
      edge('on', eventRune, 'gameplay.event'),
    ],
  },
  {
    id: entity,
    kind: 'gameplay.entity',
    value: { label: 'Puzzle solver' },
    references: [],
    edges: [],
  },
  {
    id: eventRune,
    kind: 'gameplay.event',
    value: { label: 'Rune turned' },
    references: [],
    edges: [],
  },
  {
    id: objectiveEast,
    kind: 'gameplay.objective',
    value: { label: 'Align east glyph' },
    references: [],
    edges: [
      edge('succeeds-with', 'outcome.complete', 'gameplay.outcome'),
      edge('fails-with', 'outcome.reset', 'gameplay.outcome'),
    ],
  },
  {
    id: objectiveWest,
    kind: 'gameplay.objective',
    value: { label: 'Align west glyph' },
    references: [],
    edges: [
      edge('succeeds-with', 'outcome.complete', 'gameplay.outcome'),
      edge('fails-with', 'outcome.reset', 'gameplay.outcome'),
    ],
  },
  {
    id: 'outcome.complete',
    kind: 'gameplay.outcome',
    value: { label: 'Complete', result: 'win' },
    references: [],
    edges: [],
  },
  {
    id: 'outcome.reset',
    kind: 'gameplay.outcome',
    value: { label: 'Reset', result: 'loss' },
    references: [],
    edges: [],
  },
  {
    id: stateIdle,
    kind: 'gameplay.state',
    value: { label: 'Unsolved', initial: true, terminal: 'none' },
    references: [],
    edges: [],
  },
  {
    id: stateSolved,
    kind: 'gameplay.state',
    value: { label: 'Solved', initial: false, terminal: 'success' },
    references: [],
    edges: [],
  },
]
let balanceNodes: Node[] = [
  {
    id: 'balance-turn-delay',
    kind: 'balance.unit',
    value: {
      symbol: 'second',
      dimensions: [],
      scale: { numerator: 1, denominator: 1 },
    },
    references: [],
    edges: [],
  },
]
const t2 = (x: number, y: number, space: 'local' | 'world' = 'local') => ({
  dimensions: '2d' as const,
  space,
  position: { x, y },
  rotationRadians: 0.25,
  scale: { x: 1, y: 1 },
})
const worldEdge = (type: string, targetId: string, targetType: string) =>
  edge(type, targetId, targetType)
let worldNodes: Node[] = [
  {
    id: scene,
    kind: 'world-scene.scene',
    value: {
      label: 'Lattice chamber',
      coordinateConvention: {
        dimensions: '2d',
        xDirection: 'right',
        yDirection: 'up',
        distanceUnit: 'meter',
      },
    },
    references: [],
    edges: [worldEdge('root', 'world.lattice-root', 'world-scene.node')],
  },
  {
    id: 'world.branch-a',
    kind: 'world-scene.node',
    value: { label: 'East branch', nodeType: 'anchor', transform: t2(4, 1) },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('parent', 'world.lattice-hub', 'world-scene.node'),
    ],
  },
  {
    id: 'world.branch-b',
    kind: 'world-scene.node',
    value: { label: 'West branch', nodeType: 'anchor', transform: t2(-4, 1) },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('parent', 'world.lattice-hub', 'world-scene.node'),
    ],
  },
  {
    id: 'world.glyph-east',
    kind: 'world-scene.node',
    value: { label: 'East glyph', nodeType: 'visual', transform: t2(7, 1) },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('parent', 'world.branch-a', 'world-scene.node'),
    ],
  },
  {
    id: 'world.glyph-west',
    kind: 'world-scene.node',
    value: { label: 'West glyph', nodeType: 'visual', transform: t2(-7, 1) },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('parent', 'world.branch-b', 'world-scene.node'),
    ],
  },
  {
    id: 'world.lattice-hub',
    kind: 'world-scene.node',
    value: { label: 'Shared hub', nodeType: 'container', transform: t2(0, 1) },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('parent', 'world.lattice-root', 'world-scene.node'),
    ],
  },
  {
    id: 'world.lattice-root',
    kind: 'world-scene.node',
    value: {
      label: 'Chamber root',
      nodeType: 'container',
      transform: t2(0, 0, 'world'),
    },
    references: [],
    edges: [worldEdge('scene', scene, 'world-scene.scene')],
  },
  {
    id: 'world.puzzle-zone',
    kind: 'world-scene.zone',
    value: {
      label: 'Rune floor',
      shape: { kind: 'rectangle', size: { x: 8, y: 3 } },
      transform: t2(0, 1),
    },
    references: [],
    edges: [worldEdge('scene', scene, 'world-scene.scene')],
  },
  {
    id: 'world.solver-instance',
    kind: 'world-scene.entity-instance',
    value: { label: 'Solver avatar' },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('entity', entity, 'gameplay.entity'),
      worldEdge('location', 'world.lattice-hub', 'world-scene.node'),
      worldEdge('zone', 'world.puzzle-zone', 'world-scene.zone'),
    ],
  },
  {
    id: 'world.route-east',
    kind: 'world-scene.route',
    value: {
      label: 'East solution line',
      closed: false,
      waypointReferenceIndexes: [0, 1, 2, 1, 3],
    },
    references: [
      { targetId: 'world.branch-a', targetType: 'world-scene.node' },
      { targetId: 'world.glyph-east', targetType: 'world-scene.node' },
      { targetId: 'world.lattice-hub', targetType: 'world-scene.node' },
      { targetId: 'world.lattice-root', targetType: 'world-scene.node' },
    ],
    edges: [worldEdge('scene', scene, 'world-scene.scene')],
  },
  {
    id: 'world.route-west',
    kind: 'world-scene.route',
    value: {
      label: 'West solution line',
      closed: false,
      waypointReferenceIndexes: [0, 1, 2, 1, 3],
    },
    references: [
      { targetId: 'world.branch-b', targetType: 'world-scene.node' },
      { targetId: 'world.glyph-west', targetType: 'world-scene.node' },
      { targetId: 'world.lattice-hub', targetType: 'world-scene.node' },
      { targetId: 'world.lattice-root', targetType: 'world-scene.node' },
    ],
    edges: [worldEdge('scene', scene, 'world-scene.scene')],
  },
  {
    id: 'world.spawn-riddle',
    kind: 'world-scene.spawn',
    value: { label: 'Riddle marker', quantity: 1, policy: 'once' },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('location', 'world.branch-a', 'world-scene.node'),
      worldEdge('entity', entity, 'gameplay.entity'),
    ],
  },
  {
    id: 'world.encounter-riddle',
    kind: 'world-scene.encounter',
    value: { label: 'Rune challenge', mode: 'triggered' },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('spawn', 'world.spawn-riddle', 'world-scene.spawn'),
      worldEdge('zone', 'world.puzzle-zone', 'world-scene.zone'),
      worldEdge('triggered-by', eventRune, 'gameplay.event'),
    ],
  },
  {
    id: 'world.checkpoint-east',
    kind: 'world-scene.checkpoint',
    value: { label: 'East reset point', ordinal: 0, resetPolicy: 'manual' },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('location', 'world.glyph-east', 'world-scene.node'),
      worldEdge('respawn-state', stateIdle, 'gameplay.state'),
    ],
  },
  {
    id: 'world.camera-rune',
    kind: 'world-scene.camera-region',
    value: { label: 'Rune focus', priority: 3, blendIn: 0.4, blendOut: 0.8 },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('zone', 'world.puzzle-zone', 'world-scene.zone'),
      worldEdge('anchor', 'world.branch-a', 'world-scene.node'),
    ],
  },
  {
    id: 'world.objective-east',
    kind: 'world-scene.objective-placement',
    value: { label: 'East objective marker' },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('objective', objectiveEast, 'gameplay.objective'),
      worldEdge('location', 'world.glyph-east', 'world-scene.node'),
    ],
  },
  {
    id: 'world.objective-west',
    kind: 'world-scene.objective-placement',
    value: { label: 'West objective marker' },
    references: [],
    edges: [
      worldEdge('scene', scene, 'world-scene.scene'),
      worldEdge('objective', objectiveWest, 'gameplay.objective'),
      worldEdge('location', 'world.glyph-west', 'world-scene.node'),
    ],
  },
]
const requirement = (
  requirementId: string,
  kind: string,
  runtimeRole: string,
) => ({ requirementId, kind, runtimeRole })
let presentationNodes: Node[] = [
  {
    id: 'presentation.screen-board',
    kind: 'presentation.ui-screen',
    value: {
      label: 'Puzzle board',
      modal: false,
      requirements: [requirement('req.board', 'ui', 'screen')],
    },
    references: [],
    edges: [
      edge(
        'initial-state',
        'presentation.state-unsolved',
        'presentation.ui-state',
      ),
      edge('driven-by', stateIdle, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.screen-overlay',
    kind: 'presentation.ui-screen',
    value: {
      label: 'Clue overlay',
      modal: true,
      requirements: [requirement('req.overlay', 'ui', 'screen')],
    },
    references: [],
    edges: [
      edge('initial-state', 'presentation.state-clue', 'presentation.ui-state'),
      edge('driven-by', eventRune, 'gameplay.event'),
    ],
  },
  {
    id: 'presentation.state-clue',
    kind: 'presentation.ui-state',
    value: { label: 'Clue visible', terminal: false },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-overlay', 'presentation.ui-screen'),
      edge('driven-by', eventRune, 'gameplay.event'),
    ],
  },
  {
    id: 'presentation.state-solved',
    kind: 'presentation.ui-state',
    value: { label: 'Solved board', terminal: true },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-board', 'presentation.ui-screen'),
      edge('driven-by', stateSolved, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.state-unsolved',
    kind: 'presentation.ui-state',
    value: { label: 'Unsolved board', terminal: false },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-board', 'presentation.ui-screen'),
      edge('driven-by', stateIdle, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.action-turn',
    kind: 'presentation.ui-action',
    value: { label: 'Rotate glyph', input: 'pointer' },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-board', 'presentation.ui-screen'),
      edge('invokes', actionTurn, 'gameplay.action'),
      edge('available-in', stateIdle, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.feedback-rune',
    kind: 'presentation.feedback',
    value: { label: 'Alignment feedback', channel: 'icon' },
    references: [],
    edges: [
      edge('on', eventRune, 'gameplay.event'),
      edge('screen', 'presentation.screen-board', 'presentation.ui-screen'),
    ],
  },
  {
    id: 'presentation.camera-rune',
    kind: 'presentation.camera-behavior',
    value: { label: 'Focus glyph', mode: 'blend', duration: 0.75 },
    references: [],
    edges: [
      edge('region', 'world.camera-rune', 'world-scene.camera-region'),
      edge('on', stateSolved, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.clip-solve',
    kind: 'presentation.animation-clip',
    value: {
      label: 'Glyph spin',
      loop: false,
      playbackRate: 0.9,
      requirements: [requirement('req.spin', 'animation', 'clip')],
    },
    references: [],
    edges: [
      edge('target', 'world.solver-instance', 'world-scene.entity-instance'),
    ],
  },
  {
    id: 'presentation.animation-solve',
    kind: 'presentation.animation-state',
    value: { label: 'Solving' },
    references: [],
    edges: [
      edge('clip', 'presentation.clip-solve', 'presentation.animation-clip'),
      edge('on', eventRune, 'gameplay.event'),
    ],
  },
  {
    id: 'presentation.vfx-solve',
    kind: 'presentation.vfx-cue',
    value: {
      label: 'Glyph shimmer',
      trigger: 'persistent',
      requirements: [requirement('req.shimmer', 'vfx', 'effect')],
    },
    references: [],
    edges: [
      edge('on', stateSolved, 'gameplay.state'),
      edge('at', 'world.glyph-east', 'world-scene.node'),
    ],
  },
  {
    id: 'presentation.audio-rune',
    kind: 'presentation.audio-event',
    value: { label: 'Rune click', spatial: true },
    references: [],
    edges: [edge('on', eventRune, 'gameplay.event')],
  },
  {
    id: 'presentation.cue-rune',
    kind: 'presentation.audio-cue',
    value: {
      label: 'Click cue',
      volume: 0.35,
      requirements: [requirement('req.click', 'audio', 'cue')],
    },
    references: [],
    edges: [
      edge('event', 'presentation.audio-rune', 'presentation.audio-event'),
      edge('at', 'world.puzzle-zone', 'world-scene.zone'),
    ],
  },
  {
    id: 'presentation.music-puzzle',
    kind: 'presentation.music-state',
    value: {
      label: 'Puzzle pulse',
      intensity: 0.45,
      requirements: [requirement('req.pulse', 'music', 'music')],
    },
    references: [],
    edges: [edge('on', stateIdle, 'gameplay.state')],
  },
  {
    id: 'presentation.transition-solve',
    kind: 'presentation.transition',
    value: { label: 'Reveal solved board', trigger: { kind: 'state' } },
    references: [],
    edges: [
      edge('from', 'presentation.state-unsolved', 'presentation.ui-state'),
      edge('to', 'presentation.state-solved', 'presentation.ui-state'),
      edge('on', stateSolved, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.transition-clue',
    kind: 'presentation.transition',
    value: { label: 'Refresh clue on same screen', trigger: { kind: 'event' } },
    references: [],
    edges: [
      edge('from', 'presentation.state-clue', 'presentation.ui-state'),
      edge('to', 'presentation.state-clue', 'presentation.ui-state'),
      edge('on', eventRune, 'gameplay.event'),
    ],
  },
]

const expandedWorldNodes: Node[] = [
  {
    id: 'world.scene-echo',
    kind: 'world-scene.scene',
    value: {
      label: 'Echo chamber',
      coordinateConvention: {
        dimensions: '2d',
        xDirection: 'right',
        yDirection: 'up',
        distanceUnit: 'meter',
      },
    },
    references: [],
    edges: [worldEdge('root', 'world.echo-root', 'world-scene.node')],
  },
  {
    id: 'world.echo-root',
    kind: 'world-scene.node',
    value: {
      label: 'Echo root',
      nodeType: 'container',
      transform: t2(12, 0, 'world'),
    },
    references: [],
    edges: [worldEdge('scene', 'world.scene-echo', 'world-scene.scene')],
  },
  {
    id: 'world.echo-waypoint',
    kind: 'world-scene.node',
    value: {
      label: 'Shared echo waypoint',
      nodeType: 'anchor',
      transform: t2(14, 1),
    },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('parent', 'world.echo-root', 'world-scene.node'),
    ],
  },
  {
    id: 'world.echo-goal',
    kind: 'world-scene.node',
    value: {
      label: 'Echo goal',
      nodeType: 'visual',
      transform: t2(17, 1),
    },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('parent', 'world.echo-root', 'world-scene.node'),
    ],
  },
  {
    id: 'world.echo-zone',
    kind: 'world-scene.zone',
    value: {
      label: 'Echo floor',
      shape: { kind: 'circle', radius: 2.5 },
      transform: t2(15, 1),
    },
    references: [],
    edges: [worldEdge('scene', 'world.scene-echo', 'world-scene.scene')],
  },
  {
    id: 'world.route-echo-a',
    kind: 'world-scene.route',
    value: {
      label: 'Echo approach',
      closed: false,
      waypointReferenceIndexes: [0, 1, 2, 1, 2],
    },
    references: [
      { targetId: 'world.echo-goal', targetType: 'world-scene.node' },
      { targetId: 'world.echo-root', targetType: 'world-scene.node' },
      { targetId: 'world.echo-waypoint', targetType: 'world-scene.node' },
    ],
    edges: [worldEdge('scene', 'world.scene-echo', 'world-scene.scene')],
  },
  {
    id: 'world.route-echo-b',
    kind: 'world-scene.route',
    value: {
      label: 'Echo return',
      closed: true,
      waypointReferenceIndexes: [0, 1, 2, 1, 0, 2],
    },
    references: [
      { targetId: 'world.echo-goal', targetType: 'world-scene.node' },
      { targetId: 'world.echo-root', targetType: 'world-scene.node' },
      { targetId: 'world.echo-waypoint', targetType: 'world-scene.node' },
    ],
    edges: [worldEdge('scene', 'world.scene-echo', 'world-scene.scene')],
  },
  {
    id: 'world.echo-instance',
    kind: 'world-scene.entity-instance',
    value: { label: 'Echo solver avatar' },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('entity', entity, 'gameplay.entity'),
      worldEdge('location', 'world.echo-root', 'world-scene.node'),
      worldEdge('zone', 'world.echo-zone', 'world-scene.zone'),
    ],
  },
  {
    id: 'world.echo-spawn',
    kind: 'world-scene.spawn',
    value: { label: 'Echo spawn', quantity: 2, policy: 'repeat' },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('location', 'world.echo-waypoint', 'world-scene.node'),
      worldEdge('entity', entity, 'gameplay.entity'),
    ],
  },
  {
    id: 'world.echo-encounter',
    kind: 'world-scene.encounter',
    value: { label: 'Echo challenge', mode: 'triggered' },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('spawn', 'world.echo-spawn', 'world-scene.spawn'),
      worldEdge('zone', 'world.echo-zone', 'world-scene.zone'),
      worldEdge('triggered-by', eventRune, 'gameplay.event'),
    ],
  },
  {
    id: 'world.echo-checkpoint',
    kind: 'world-scene.checkpoint',
    value: {
      label: 'Echo checkpoint',
      ordinal: 1,
      resetPolicy: 'last-checkpoint',
    },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('location', 'world.echo-goal', 'world-scene.node'),
      worldEdge('respawn-state', stateSolved, 'gameplay.state'),
    ],
  },
  {
    id: 'world.echo-camera',
    kind: 'world-scene.camera-region',
    value: { label: 'Echo focus', priority: 4, blendIn: 0.3, blendOut: 0.6 },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('zone', 'world.echo-zone', 'world-scene.zone'),
      worldEdge('anchor', 'world.echo-waypoint', 'world-scene.node'),
    ],
  },
  {
    id: 'world.echo-objective',
    kind: 'world-scene.objective-placement',
    value: { label: 'Echo objective marker' },
    references: [],
    edges: [
      worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
      worldEdge('objective', objectiveEast, 'gameplay.objective'),
      worldEdge('location', 'world.echo-goal', 'world-scene.node'),
      worldEdge('zone', 'world.echo-zone', 'world-scene.zone'),
    ],
  },
]

const expandedPresentationNodes: Node[] = [
  {
    id: 'presentation.screen-echo',
    kind: 'presentation.ui-screen',
    value: {
      label: 'Echo board',
      modal: false,
      requirements: [requirement('req.echo-board', 'ui', 'screen')],
    },
    references: [],
    edges: [
      edge('initial-state', 'presentation.state-echo', 'presentation.ui-state'),
      edge('driven-by', stateSolved, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.state-echo',
    kind: 'presentation.ui-state',
    value: { label: 'Echo clue', terminal: false },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-echo', 'presentation.ui-screen'),
      edge('driven-by', stateSolved, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.state-finale',
    kind: 'presentation.ui-state',
    value: { label: 'Finale', terminal: true },
    references: [],
    edges: [
      edge('screen', 'presentation.screen-echo', 'presentation.ui-screen'),
      edge('driven-by', stateSolved, 'gameplay.state'),
    ],
  },
  {
    id: 'presentation.feedback-echo',
    kind: 'presentation.feedback',
    value: { label: 'Echo feedback', channel: 'flash' },
    references: [],
    edges: [
      edge('on', stateSolved, 'gameplay.state'),
      edge('screen', 'presentation.screen-echo', 'presentation.ui-screen'),
    ],
  },
  {
    id: 'presentation.audio-echo',
    kind: 'presentation.audio-event',
    value: { label: 'Echo chime', spatial: true },
    references: [],
    edges: [edge('on', stateSolved, 'gameplay.state')],
  },
  {
    id: 'presentation.cue-echo',
    kind: 'presentation.audio-cue',
    value: {
      label: 'Echo cue',
      volume: 0.55,
      requirements: [requirement('req.echo-cue', 'audio', 'cue')],
    },
    references: [],
    edges: [
      edge('event', 'presentation.audio-echo', 'presentation.audio-event'),
      edge('at', 'world.echo-camera', 'world-scene.camera-region'),
    ],
  },
  {
    id: 'presentation.vfx-echo',
    kind: 'presentation.vfx-cue',
    value: {
      label: 'Echo flare',
      trigger: 'instant',
      requirements: [requirement('req.echo-vfx', 'vfx', 'effect')],
    },
    references: [],
    edges: [
      edge('on', stateSolved, 'gameplay.state'),
      edge('at', 'world.echo-goal', 'world-scene.node'),
    ],
  },
  {
    id: 'presentation.music-echo',
    kind: 'presentation.music-state',
    value: {
      label: 'Echo cadence',
      intensity: 0.8,
      requirements: [requirement('req.echo-music', 'music', 'music')],
    },
    references: [],
    edges: [edge('on', stateSolved, 'gameplay.state')],
  },
  {
    id: 'presentation.transition-echo',
    kind: 'presentation.transition',
    value: { label: 'Enter finale', trigger: { kind: 'state' } },
    references: [],
    edges: [
      edge('from', 'presentation.state-echo', 'presentation.ui-state'),
      edge('to', 'presentation.state-finale', 'presentation.ui-state'),
      edge('on', stateSolved, 'gameplay.state'),
    ],
  },
]

const sortNodes = (nodes: readonly Node[]): Node[] =>
  [...nodes].sort((a, b) => Buffer.from(a.id).compare(Buffer.from(b.id)))
const pointerValue = (node: Node, pointer: string): unknown => {
  if (pointer === '/id') return node.id
  if (pointer.startsWith('/references/'))
    return node.references[Number(pointer.slice(12))]
  if (pointer.startsWith('/edges/')) return node.edges[Number(pointer.slice(7))]
  let current: unknown = node.value
  for (const part of pointer
    .slice(7)
    .split('/')
    .map(p => p.replaceAll('~1', '/').replaceAll('~0', '~')))
    current =
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)[part]
        : undefined
  return current
}
const leafPointers = (value: Record<string, unknown>): string[] => {
  const result: string[] = []
  const visit = (entry: unknown, pointer: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) result.push(pointer)
      else entry.forEach((v, i) => visit(v, `${pointer}/${i}`))
      return
    }
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) result.push(pointer)
      else
        entries.forEach(([k, v]) =>
          visit(
            v,
            `${pointer}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          ),
        )
      return
    }
    result.push(pointer)
  }
  Object.entries(value).forEach(([k, v]) => visit(v, `/value/${k}`))
  return result
}
const pointers = (node: Node): string[] => [
  '/id',
  ...leafPointers(node.value),
  ...node.references.map((_, i) => `/references/${i}`),
  ...node.edges.map((_, i) => `/edges/${i}`),
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
    .flatMap(n => pointers(n).map(pointer => `node:${n.id}#${pointer}`))
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))
const EXPECTED_WORLD_CHECK_IDS = [
  'domain.world-scene',
  'projection.ambiguity',
  'projection.completeness',
  'projection.cross-module-invariants',
  'projection.fidelity',
  'projection.source-bounds',
] as const
const EXPECTED_PRESENTATION_CHECK_IDS = [
  'domain.presentation',
  'projection.ambiguity',
  'projection.completeness',
  'projection.cross-module-invariants',
  'projection.fidelity',
  'projection.source-bounds',
] as const
const normalizeNodes = (nodes: readonly Node[]): Node[] =>
  nodes.map(node => ({
    ...node,
    references: [...node.references].sort((a, b) =>
      Buffer.from(`${a.targetId}\0${a.targetType}`).compare(
        Buffer.from(`${b.targetId}\0${b.targetType}`),
      ),
    ),
    edges: [...node.edges].sort((a, b) =>
      Buffer.from(`${a.type}\0${a.targetId}\0${a.targetType}`).compare(
        Buffer.from(`${b.type}\0${b.targetId}\0${b.targetType}`),
      ),
    ),
  }))
gameplayNodes = normalizeNodes(gameplayNodes)
balanceNodes = normalizeNodes(balanceNodes)
worldNodes = normalizeNodes(worldNodes)
presentationNodes = normalizeNodes(presentationNodes)
const expandedPuzzleWorldNodes = normalizeNodes([
  ...worldNodes,
  ...expandedWorldNodes,
])
const expandedPuzzlePresentationNodes = normalizeNodes([
  ...presentationNodes,
  ...expandedPresentationNodes,
])

type Context = {
  sourceBytes: string
  sourceRanges: Map<string, string>
  fullIndex: ReturnType<typeof canonicalizeGameIrSourceSections>
  request: GameIrCompileRequest
  modules: {
    gameplay: readonly Node[]
    balance: readonly Node[]
    world: readonly Node[]
    presentation: readonly Node[]
  }
}
const makeContext = (overrides: Partial<Context['modules']> = {}): Context => {
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
  let sourceBytes = ''
  const sourceRanges = new Map<string, string>()
  for (const node of sortNodes(nodes))
    for (const pointer of pointers(node).sort()) {
      const value = pointerValue(node, pointer)
      const literal =
        typeof value === 'string' ? value : canonicalGameIrJson(value)
      const start = Buffer.byteLength(sourceBytes)
      sourceBytes += `${literal}\n`
      sourceRanges.set(
        `node:${node.id}#${pointer}`,
        `/bytes/${start}/${Buffer.byteLength(sourceBytes) - 1}`,
      )
    }
  const fullIndex = canonicalizeGameIrSourceSections(
    CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
      documentPath,
      sectionId: `puzzle-${index}`,
      heading: `Puzzle authority ${index}`,
      startLine: 1,
      endLine: sourceBytes.split('\n').length,
      digest: sha256(sourceBytes),
    })),
  )
  const body: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'puzzle-profile',
    foundationRevision: 'd'.repeat(64),
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
  const foundation = {
    ...body,
    receiptDigest: digestGameIrValue(body),
  } as FoundationReadyReceipt
  return {
    sourceBytes,
    sourceRanges,
    fullIndex,
    request: {
      schemaVersion: 'game-ir-compile-request.v1',
      taskId: 'puzzle-profile-task',
      publicationId: 'puzzle-profile-publication',
      gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
      foundation,
    },
    modules,
  }
}
const selectedDocs = (
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
) => canonicalGameIrModuleSourceDocuments(moduleId)
const source = (
  moduleId: 'gameplay' | 'balance' | 'world-scene' | 'presentation',
  context: Context,
): GameIrDomainSourceEnvelope =>
  buildGameIrDomainSourceEnvelope({
    moduleId,
    request: context.request,
    sectionIndex: context.fullIndex,
    sectionBytes: Object.fromEntries(
      selectedDocs(moduleId).map(path => [
        `${path}#${context.fullIndex.find(s => s.documentPath === path)!.sectionId}`,
        context.sourceBytes,
      ]),
    ),
  })
const mechanical = (
  currentSource: GameIrDomainSourceEnvelope,
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
  context: Context,
  documentPath: FoundationDocumentPath = 'docs/GDD.md',
) =>
  nodes
    .flatMap(node =>
      pointers(node)
        .sort()
        .map(pointer => ({
          subject: `node:${node.id}#${pointer}`,
          documentPath,
          sectionId: context.fullIndex.find(
            s => s.documentPath === documentPath,
          )!.sectionId,
          sourcePointer: context.sourceRanges.get(
            `node:${node.id}#${pointer}`,
          )!,
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
const balanceClaims = (nodes: readonly Node[], context: Context) => {
  const bySubject = new Map<string, unknown>(
    nodes.flatMap(node =>
      pointers(node).map(
        pointer =>
          [`node:${node.id}#${pointer}`, pointerValue(node, pointer)] as const,
      ),
    ),
  )
  return claims(nodes, context, 'docs/BALANCE_DESIGN.md').map(claim => {
    const value = bySubject.get(claim.subject)
    return {
      ...claim,
      literal:
        claim.subject.includes('/references/') ||
        claim.subject.includes('/edges/')
          ? String((value as { targetId: string }).targetId)
          : claim.literal,
    }
  })
}
const phase4Authority = (
  context: Context,
  overrides: Partial<Context['modules']> = {},
) => {
  const gameplaySource = source('gameplay', context)
  const balanceSource = source('balance', context)
  const gameplayMechanical = mechanical(gameplaySource)
  const balanceMechanical = mechanical(balanceSource)
  const gameplay = overrides.gameplay ?? context.modules.gameplay
  const balance = overrides.balance ?? context.modules.balance
  const gameplaySemantic = admitGameplaySemanticResult(
    buildGameplaySemanticPacket({
      source: gameplaySource,
      mechanical: gameplayMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: gameplay,
      sourceClaims: claims(gameplay, context),
    },
  ) as GameplaySemanticReceipt
  const balanceSemantic = admitBalanceSemanticResult(
    buildBalanceSemanticPacket({
      source: balanceSource,
      mechanical: balanceMechanical,
    }),
    {
      outcome: 'PROJECTED',
      nodes: balance,
      sourceClaims: balanceClaims(balance, context),
    },
  ) as BalanceSemanticReceipt
  return {
    gameplay: {
      source: gameplaySource,
      mechanical: gameplayMechanical,
      semantic: gameplaySemantic,
    },
    balance: {
      source: balanceSource,
      mechanical: balanceMechanical,
      semantic: balanceSemantic,
    },
  }
}
const pass = (packet: Phase5SemanticValidationPacket) => {
  const result = admitPhase5SemanticValidationResult(packet, {
    outcome: 'PASS',
    packetDigest: packet.packetDigest,
    checkIds: packet.checkIds,
    coveredTargets: packet.requiredTargets,
  })
  if (result.outcome !== 'PASS') throw new Error('puzzle validation must pass')
  return result
}
const makeAuthority = (overrides: Partial<Context['modules']> = {}) => {
  const context = makeContext(overrides)
  const phase4 = phase4Authority(context, overrides)
  const worldSource = source('world-scene', context)
  const worldMechanical = mechanical(worldSource)
  const worldPacket = buildWorldSceneSemanticPacket({
    source: worldSource,
    mechanical: worldMechanical,
  })
  const world = overrides.world ?? context.modules.world
  const worldSemantic = admitWorldSceneSemanticResult(worldPacket, {
    outcome: 'PROJECTED',
    nodes: sortNodes(world),
    sourceClaims: claims(sortNodes(world), context),
  }) as WorldSceneSemanticReceipt
  const worldValidationPacket = prepareWorldSceneSemanticValidationPacket({
    phase4Authority: phase4,
    worldScene: {
      source: worldSource,
      mechanical: worldMechanical,
      semantic: worldSemantic,
    },
  })
  const worldValidation = pass(worldValidationPacket)
  const presentationSource = source('presentation', context)
  const presentationMechanical = mechanical(presentationSource)
  const presentationPacket = buildPresentationSemanticPacket({
    source: presentationSource,
    mechanical: presentationMechanical,
  })
  const presentation = overrides.presentation ?? context.modules.presentation
  const presentationSemantic = admitPresentationSemanticResult(
    presentationPacket,
    {
      outcome: 'PROJECTED',
      nodes: sortNodes(presentation),
      sourceClaims: claims(sortNodes(presentation), context),
    },
  ) as PresentationSemanticReceipt
  const presentationValidationPacket =
    preparePresentationSemanticValidationPacket({
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
      },
    })
  const presentationValidation = pass(presentationValidationPacket)
  return {
    context,
    packets: {
      world: worldValidationPacket,
      presentation: presentationValidationPacket,
    },
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
  }
}
const closure = (overrides: Partial<Context['modules']> = {}) =>
  assembleWorldPresentationClosure(makeAuthority(overrides).authority)
const assembleValidBaseline = (): void => {
  assembleWorldPresentationClosure(makeAuthority().authority)
}
const expectedError = (operation: () => unknown, message: string) => {
  let thrown: unknown
  try {
    operation()
  } catch (error) {
    thrown = error
  }
  if (!(thrown instanceof Error))
    throw new Error('expected operation to throw an Error')
  expect((thrown as Error).message).toBe(message)
}
const assertOwnerBindings = (
  nodes: readonly GameIrNode[],
  sourceClaims: readonly {
    subject: string
    documentPath: FoundationDocumentPath
    sectionId: string
    sourcePointer: string
  }[],
  envelope: GameIrDomainSourceEnvelope,
) => {
  const claimsBySubject = new Map(
    sourceClaims.map(claim => [claim.subject, claim]),
  )
  for (const node of nodes)
    for (const pointer of pointers(node)) {
      const claim = claimsBySubject.get(`node:${node.id}#${pointer}`)
      expect(claim).toBeDefined()
      const section = envelope.authoritySectionIndex.find(
        item =>
          item.documentPath === claim?.documentPath &&
          item.sectionId === claim?.sectionId,
      )
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
const freezeFixture = (value: unknown): void => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      freezeFixture(child)
    Object.freeze(value)
  }
}
const deeplyFrozen = (value: unknown, seen = new Set<object>()): boolean => {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  seen.add(value)
  return (
    Object.isFrozen(value) &&
    Object.values(value as Record<string, unknown>).every(child =>
      deeplyFrozen(child, seen),
    )
  )
}
const redigestMechanical = (
  receipt: GameIrMechanicalProjectionReceipt,
  patch: Record<string, unknown>,
) => {
  const body = { ...receipt, ...patch }
  const { receiptDigest: _digest, ...unsigned } = body
  return { ...unsigned, receiptDigest: digestGameIrValue(unsigned) }
}
const redigestSemantic = (
  receipt: WorldSceneSemanticReceipt | PresentationSemanticReceipt,
  patch: Record<string, unknown>,
) => {
  const body = { ...receipt, ...patch }
  const { receiptDigest: _digest, ...unsigned } = body
  return { ...unsigned, receiptDigest: digestGameIrValue(unsigned) }
}
const sortedMutation = (nodes: readonly Node[]) =>
  nodes.map(node => ({
    ...node,
    references: [...node.references].sort((a, b) =>
      Buffer.from(`${a.targetId}\0${a.targetType}`).compare(
        Buffer.from(`${b.targetId}\0${b.targetType}`),
      ),
    ),
    edges: [...node.edges].sort((a, b) =>
      Buffer.from(`${a.type}\0${a.targetId}\0${a.targetType}`).compare(
        Buffer.from(`${b.type}\0${b.targetId}\0${b.targetType}`),
      ),
    ),
  }))
const expandedAuthority = () =>
  makeAuthority({
    world: expandedPuzzleWorldNodes,
    presentation: expandedPuzzlePresentationNodes,
  })
const requirementObjects = (nodes: readonly Node[]) =>
  nodes.flatMap(node => {
    const requirements = (node.value as { requirements?: unknown }).requirements
    return Array.isArray(requirements) ? requirements : []
  })

describe('Task 10 branching/puzzle World + Presentation profile', () => {
  test('assembles distinct shared-waypoint puzzle routes and same-screen transitions', () => {
    const result = closure()
    expect(closureView(result.phase4.gameplay.module.nodes)).toEqual(
      candidateView(gameplayNodes),
    )
    expect(closureView(result.phase4.balance.module.nodes)).toEqual(
      candidateView(balanceNodes),
    )
    expect(closureView(result.worldScene.module.nodes)).toEqual(
      candidateView(worldNodes),
    )
    expect(closureView(result.presentation.module.nodes)).toEqual(
      candidateView(presentationNodes),
    )
    const worldRoutes = result.worldScene.module.nodes.filter(
      node => node.kind === 'world-scene.route',
    )
    expect(worldRoutes.map(node => node.id)).toEqual([
      'world.route-east',
      'world.route-west',
    ])
    expect(
      worldRoutes.map(node => node.value.waypointReferenceIndexes),
    ).toEqual([
      [0, 1, 2, 1, 3],
      [0, 1, 2, 1, 3],
    ])
    expect(
      result.presentation.module.nodes.find(
        node => node.id === 'presentation.transition-clue',
      )?.edges,
    ).toContainEqual(
      edge('from', 'presentation.state-clue', 'presentation.ui-state'),
    )
    expect(
      result.presentation.module.nodes.find(
        node => node.id === 'presentation.transition-clue',
      )?.edges,
    ).toContainEqual(
      edge('to', 'presentation.state-clue', 'presentation.ui-state'),
    )
    expect(
      result.presentation.module.nodes.flatMap(
        node =>
          (
            node.value.requirements as
              | readonly { requirementId: string }[]
              | undefined
          )?.map(requirement => requirement.requirementId) ?? [],
      ),
    ).toEqual([
      'req.spin',
      'req.click',
      'req.pulse',
      'req.board',
      'req.overlay',
      'req.shimmer',
    ])
    expect(
      result.worldScene.module.nodes.some(
        node => node.kind === 'world-scene.entity-instance',
      ),
    ).toBe(true)
    expect(
      result.worldScene.module.nodes.some(
        node => node.kind === 'world-scene.encounter',
      ),
    ).toBe(true)
    expect(
      result.presentation.module.nodes.some(
        node => node.kind === 'presentation.vfx-cue',
      ),
    ).toBe(true)
    expect(
      result.presentation.module.nodes.some(
        node => node.kind === 'presentation.audio-cue',
      ),
    ).toBe(true)
    expect(
      result.presentation.module.nodes.some(
        node => node.kind === 'presentation.music-state',
      ),
    ).toBe(true)
    const profile = makeAuthority()
    assertOwnerBindings(
      result.phase4.gameplay.module.nodes,
      profile.authority.phase4Authority.gameplay.semantic.sourceClaims,
      profile.authority.phase4Authority.gameplay.source,
    )
    assertOwnerBindings(
      result.phase4.balance.module.nodes,
      profile.authority.phase4Authority.balance.semantic.sourceClaims,
      profile.authority.phase4Authority.balance.source,
    )
    assertOwnerBindings(
      result.worldScene.module.nodes,
      profile.authority.worldScene.semantic.sourceClaims,
      profile.authority.worldScene.source,
    )
    assertOwnerBindings(
      result.presentation.module.nodes,
      profile.authority.presentation.semantic.sourceClaims,
      profile.authority.presentation.source,
    )
  })

  test('admits an expanded multi-scene puzzle without caps and preserves unrelated insertion order', () => {
    const expanded = expandedAuthority()
    const expandedResult = assembleWorldPresentationClosure(expanded.authority)
    const expandedWorld = expandedResult.worldScene.module.nodes
    const expandedPresentation = expandedResult.presentation.module.nodes
    expect(expandedWorld).toHaveLength(30)
    expect(expandedPresentation).toHaveLength(25)
    expect(
      expandedWorld.filter(node => node.kind === 'world-scene.scene'),
    ).toHaveLength(2)
    expect(
      expandedWorld.filter(node => node.kind === 'world-scene.route'),
    ).toHaveLength(4)
    expect(
      expandedWorld.filter(node => node.kind === 'world-scene.node'),
    ).toHaveLength(9)
    expect(
      expandedPresentation.filter(
        node => node.kind === 'presentation.ui-screen',
      ),
    ).toHaveLength(3)
    expect(
      expandedPresentation.filter(
        node => node.kind === 'presentation.ui-state',
      ),
    ).toHaveLength(5)
    expect(
      expandedPresentation.filter(
        node => node.kind === 'presentation.transition',
      ),
    ).toHaveLength(3)
    expect(
      expandedPresentation.filter(
        node => node.kind === 'presentation.audio-cue',
      ),
    ).toHaveLength(2)
    expect(
      expandedWorld
        .filter(node => node.kind === 'world-scene.route')
        .every(node => {
          const indexes = (node.value as { waypointReferenceIndexes: number[] })
            .waypointReferenceIndexes
          return indexes.length >= 5 && new Set(indexes).size < indexes.length
        }),
    ).toBe(true)
    expect(expandedResult.closureDigest).not.toBe(ACCEPTED_TASK9_CLOSURE_DIGEST)

    const insertedWorld: Node = {
      id: 'world.zz-unrelated-marker',
      kind: 'world-scene.node',
      value: {
        label: 'Unrelated marker',
        nodeType: 'visual',
        transform: t2(19, 2),
      },
      references: [],
      edges: [
        worldEdge('scene', 'world.scene-echo', 'world-scene.scene'),
        worldEdge('parent', 'world.echo-root', 'world-scene.node'),
      ],
    }
    const insertedPresentation: Node = {
      id: 'presentation.zz-unrelated-feedback',
      kind: 'presentation.feedback',
      value: { label: 'Unrelated feedback', channel: 'text' },
      references: [],
      edges: [edge('on', stateSolved, 'gameplay.state')],
    }
    const insertedAuthority = makeAuthority({
      world: normalizeNodes([...expandedPuzzleWorldNodes, insertedWorld]),
      presentation: normalizeNodes([
        ...expandedPuzzlePresentationNodes,
        insertedPresentation,
      ]),
    })
    const insertedResult = assembleWorldPresentationClosure(
      insertedAuthority.authority,
    )
    expect(
      requirementObjects(insertedResult.presentation.module.nodes),
    ).toEqual(requirementObjects(expandedResult.presentation.module.nodes))
    expect(
      insertedResult.presentation.module.nodes
        .filter(node => node.id !== insertedPresentation.id)
        .map(node => node.id),
    ).toEqual(expandedResult.presentation.module.nodes.map(node => node.id))
    expect(
      insertedResult.worldScene.module.nodes
        .filter(node => node.id !== insertedWorld.id)
        .map(node => node.id),
    ).toEqual(expandedResult.worldScene.module.nodes.map(node => node.id))
    const existingRoutes = (nodes: readonly GameIrNode[]) =>
      nodes
        .filter(node => node.kind === 'world-scene.route')
        .map(node => ({
          id: node.id,
          references: node.references,
          edges: node.edges,
          value: node.value,
        }))
    expect(existingRoutes(insertedResult.worldScene.module.nodes)).toEqual(
      existingRoutes(expandedResult.worldScene.module.nodes),
    )
  })

  test('replays frozen authority deterministically and keeps puzzle digest distinct by construction', () => {
    const profile = makeAuthority()
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
    expect(first.closureDigest).toBe(second.closureDigest)
    expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
    expect(digestGameIrValue(first)).toBe(digestGameIrValue(second))
    expect(deeplyFrozen(profile)).toBe(true)
    expect(deeplyFrozen(first)).toBe(true)
    const authorityValue = profile
    expect(
      authorityValue.authority.worldScene.source.authoritySectionIndex,
    ).toHaveLength(8)
    expect(
      authorityValue.authority.presentation.source.authoritySectionIndex,
    ).toHaveLength(8)
    expect(
      Object.values(authorityValue.authority.worldScene.source.sectionBytes),
    ).toEqual(
      Object.values(
        authorityValue.authority.presentation.source.sectionBytes,
      ).slice(0, 2),
    )
    expect(
      first.worldScene.module.nodes.some(
        node => node.kind === 'world-scene.route',
      ),
    ).toBe(true)
    expect(first.closureDigest).not.toBe(ACCEPTED_TASK9_CLOSURE_DIGEST)
    expect(
      first.presentation.module.nodes.find(
        node => node.id === 'presentation.camera-rune',
      )?.edges,
    ).toEqual([
      edge('on', stateSolved, 'gameplay.state'),
      edge('region', 'world.camera-rune', 'world-scene.camera-region'),
    ])
  })

  test('retains complete source and validator coverage for both domains', () => {
    const authorityValue = makeAuthority()
    expect(authorityValue.packets.world.requiredTargets).toEqual(
      targetSubjects(worldNodes),
    )
    expect(authorityValue.packets.presentation.requiredTargets).toEqual(
      targetSubjects(presentationNodes),
    )
    expect(authorityValue.packets.world.checkIds).toEqual(
      EXPECTED_WORLD_CHECK_IDS,
    )
    expect(authorityValue.packets.presentation.checkIds).toEqual(
      EXPECTED_PRESENTATION_CHECK_IDS,
    )
    expect(
      authorityValue.authority.worldScene.validation.coveredTargets,
    ).toEqual(targetSubjects(worldNodes))
    expect(
      authorityValue.authority.presentation.validation.coveredTargets,
    ).toEqual(targetSubjects(presentationNodes))
    expect(authorityValue.authority.worldScene.validation.checkIds).toEqual(
      EXPECTED_WORLD_CHECK_IDS,
    )
    expect(authorityValue.authority.presentation.validation.checkIds).toEqual(
      EXPECTED_PRESENTATION_CHECK_IDS,
    )
    expect(
      Object.keys(authorityValue.authority.worldScene.source.sectionBytes),
    ).toContain('docs/GDD.md#puzzle-0')
    expect(
      Object.keys(authorityValue.authority.worldScene.source.sectionBytes),
    ).toContain('docs/LEVEL_SCENE_DESIGN.md#puzzle-1')
    expect(
      Object.keys(authorityValue.authority.presentation.source.sectionBytes),
    ).toContain('docs/ART_DIRECTION.md#puzzle-4')
    expect(
      Object.keys(authorityValue.authority.presentation.source.sectionBytes),
    ).toContain('docs/UI_UX_SPEC.md#puzzle-5')
    expect(
      Object.keys(authorityValue.authority.presentation.source.sectionBytes),
    ).toContain('docs/AUDIO_DESIGN.md#puzzle-6')
  })

  test('rejects typed graph mutations before closure', () => {
    assembleValidBaseline()
    const missingParent = worldNodes.map(node =>
      node.id === 'world.branch-a'
        ? {
            ...node,
            edges: node.edges.filter(candidate => candidate.type !== 'parent'),
          }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ world: missingParent }),
      'invalid World/Scene module: scene world.scene-lattice must have exactly one root node',
    )
    const wrongTarget = presentationNodes.map(node =>
      node.id === 'presentation.vfx-solve'
        ? {
            ...node,
            edges: node.edges.map(candidate =>
              candidate.type === 'at'
                ? edge('at', 'event.rune-turned', 'gameplay.event')
                : candidate,
            ),
          }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ presentation: sortedMutation(wrongTarget) }),
      'invalid Presentation module: node presentation.vfx-solve role at has wrong target kind',
    )
    const invalidRoute = worldNodes.map(node =>
      node.id === 'world.route-east'
        ? {
            ...node,
            value: { ...node.value, waypointReferenceIndexes: [0, 1, 2, 1, 9] },
          }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ world: invalidRoute }),
      'invalid World/Scene module: route world.route-east waypoint index is out of range',
    )
    const forbiddenResource = presentationNodes.map(node =>
      node.id === 'presentation.feedback-rune'
        ? {
            ...node,
            edges: [
              ...node.edges,
              edge('on', 'resource.sound', 'resource-realization.asset'),
            ],
          }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ presentation: sortedMutation(forbiddenResource) }),
      'invalid Presentation module: node presentation.feedback-rune edge targets unknown node resource.sound',
    )
  })

  test('rejects malformed numeric, UI, trigger, requirement, and source authorities', () => {
    assembleValidBaseline()
    const badTransform = worldNodes.map(node =>
      node.id === 'world.glyph-east'
        ? {
            ...node,
            value: {
              ...node.value,
              transform: {
                ...(node.value.transform as object),
                scale: { x: 0, y: 1 },
              },
            },
          }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ world: badTransform }),
      'invalid World/Scene module: node world.glyph-east transform.scale must be positive',
    )
    const badScreen = presentationNodes.map(node =>
      node.id === 'presentation.screen-board'
        ? { ...node, value: { ...node.value, modal: 'false' } }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ presentation: badScreen }),
      'invalid Presentation module: node presentation.screen-board modal must be boolean',
    )
    const badTrigger = presentationNodes.map(node =>
      node.id === 'presentation.transition-solve'
        ? { ...node, value: { ...node.value, trigger: { kind: 'future' } } }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ presentation: badTrigger }),
      'invalid Presentation module: node presentation.transition-solve trigger kind is invalid',
    )
    const badRequirement = presentationNodes.map(node =>
      node.id === 'presentation.clip-solve'
        ? {
            ...node,
            value: {
              ...node.value,
              requirements: [
                {
                  requirementId: 'req.spin',
                  kind: 'audio',
                  runtimeRole: 'cue',
                },
              ],
            },
          }
        : node,
    )
    assembleValidBaseline()
    expectedError(
      () => makeAuthority({ presentation: badRequirement }),
      'invalid Presentation module: node presentation.clip-solve requirement policy does not match',
    )
    const context = makeContext()
    const changed = {
      ...context,
      sourceBytes: `${context.sourceBytes}tamper\n`,
    }
    expectedError(
      () => source('world-scene', changed),
      'invalid Game IR domain source: Markdown bytes do not match Section Index digest for docs/GDD.md#puzzle-0',
    )
  })

  test('does not admit delivery/resource nodes and rejects stale external authority', () => {
    assembleValidBaseline()
    const detached = worldNodes.map(node =>
      node.id === 'world.lattice-root'
        ? {
            ...node,
            edges: [
              ...node.edges,
              edge('resource', 'asset.mesh', 'resource-realization.asset'),
            ],
          }
        : node,
    )
    expectedError(
      () => closure({ world: detached }),
      'invalid Game IR Phase 5 admission: nodes[8] has a relationship type outside the semantic packet',
    )
    const changedGameplay = makeAuthority({
      gameplay: gameplayNodes.map(node =>
        node.id === actionTurn
          ? { ...node, value: { ...node.value, label: 'Turn echo rune' } }
          : node,
      ),
    })
    const mixedChangedUpstream = {
      ...changedGameplay.authority,
      worldScene: makeAuthority().authority.worldScene,
      presentation: makeAuthority().authority.presentation,
    }
    assembleValidBaseline()
    expectedError(
      () => assembleWorldPresentationClosure(mixedChangedUpstream),
      'invalid Game IR World/Presentation assembly: all modules must bind one task, revision, READY receipt, compile request, and authority index',
    )
    const base = makeAuthority().authority
    assembleWorldPresentationClosure(base)
    const mechanicalNodes = redigestMechanical(base.worldScene.mechanical, {
      nodes: [
        {
          id: 'spoof',
          kind: 'world-scene.node',
          value: {},
          references: [],
          edges: [],
          bindings: {},
        },
      ],
    })
    const mechanicalAuthority = {
      ...base,
      worldScene: { ...base.worldScene, mechanical: mechanicalNodes },
    }
    expectedError(
      () => assembleWorldPresentationClosure(mechanicalAuthority),
      'invalid Game IR domain projection: isolated domain mechanical nodes and verifiedClaims must be empty',
    )
    const mechanicalClaims = redigestMechanical(base.worldScene.mechanical, {
      verifiedClaims: [
        {
          subject: 'node:spoof#/id',
          sourcePointer: '/bytes/0/5',
          literal: 'spoof',
        },
      ],
    })
    const mechanicalClaimsAuthority = {
      ...base,
      worldScene: {
        ...base.worldScene,
        mechanical: mechanicalClaims,
      },
    }
    expectedError(
      () => assembleWorldPresentationClosure(mechanicalClaimsAuthority),
      'invalid Game IR domain projection: isolated domain mechanical nodes and verifiedClaims must be empty',
    )
    const mechanicalTargets = redigestMechanical(base.worldScene.mechanical, {
      ownedTargets: ['node:spoof#/id'],
    })
    const mechanicalTargetsAuthority = {
      ...base,
      worldScene: {
        ...base.worldScene,
        mechanical: mechanicalTargets,
      },
    }
    expectedError(
      () => assembleWorldPresentationClosure(mechanicalTargetsAuthority),
      'invalid Game IR domain projection: ownedTargets must exactly account for every mechanical node target',
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
    }
    expectedError(
      () => assembleWorldPresentationClosure(rangeAuthority),
      'invalid Game IR Phase 5 admission: sourceClaims[0].sourcePointer must contain a non-empty byte range',
    )
    const gameplayIdentity = {
      ...base,
      phase4Authority: {
        ...base.phase4Authority,
        gameplay: {
          ...base.phase4Authority.gameplay,
          source: {
            ...base.phase4Authority.gameplay.source,
            taskId: 'other-puzzle-task',
          },
        },
      },
    }
    expectedError(
      () => assembleWorldPresentationClosure(gameplayIdentity),
      'invalid Game IR domain source: source envelope taskId does not match compile request',
    )
    const presentationIdentity = {
      ...base,
      presentation: {
        ...base.presentation,
        source: { ...base.presentation.source, taskId: 'other-puzzle-task' },
      },
    }
    expectedError(
      () => assembleWorldPresentationClosure(presentationIdentity),
      'invalid Game IR domain source: source envelope taskId does not match compile request',
    )
  })
})
