import { describe, expect, test } from 'bun:test'
import {
  PRESENTATION_DOMAIN_MANIFEST,
  parsePresentationModule,
} from './presentation-schema'
import {
  compareCodeUnits,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'

type MutableNode = {
  id: string
  kind: string
  producerMode: 'semantic'
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
  bindings: Record<string, never>
}
type MutableModule = { moduleId: 'presentation'; nodes: MutableNode[] }

const edge = (type: string, targetId: string, targetType: string) => ({
  type,
  targetId,
  targetType,
})

const node = (
  id: string,
  kind: string,
  value: Record<string, unknown>,
  edges: MutableNode['edges'] = [],
): MutableNode => ({
  id,
  kind,
  producerMode: 'semantic',
  value,
  references: [],
  edges,
  bindings: {},
})

const external = (id: string, kind: string) =>
  ({ id, kind }) as unknown as GameIrNode

const gameplayTargets = new Map<string, GameIrNode>([
  ['gameplay.action.open', external('gameplay.action.open', 'gameplay.action')],
  ['gameplay.event.start', external('gameplay.event.start', 'gameplay.event')],
  ['gameplay.event.hit', external('gameplay.event.hit', 'gameplay.event')],
  [
    'gameplay.state.playing',
    external('gameplay.state.playing', 'gameplay.state'),
  ],
  ['gameplay.entity.hero', external('gameplay.entity.hero', 'gameplay.entity')],
])

const worldTargets = new Map<string, GameIrNode>([
  [
    'world-scene.scene.main',
    external('world-scene.scene.main', 'world-scene.scene'),
  ],
  [
    'world-scene.camera.main',
    external('world-scene.camera.main', 'world-scene.camera-region'),
  ],
  [
    'world-scene.node.anchor',
    external('world-scene.node.anchor', 'world-scene.node'),
  ],
  [
    'world-scene.zone.main',
    external('world-scene.zone.main', 'world-scene.zone'),
  ],
  [
    'world-scene.instance.hero',
    external('world-scene.instance.hero', 'world-scene.entity-instance'),
  ],
])

function externalTargets(): ReadonlyMap<string, GameIrNode> {
  return new Map([...gameplayTargets, ...worldTargets])
}

function validModule(): MutableModule {
  const module: MutableModule = {
    moduleId: 'presentation',
    nodes: [
      node(
        'screen.home',
        'presentation.ui-screen',
        {
          label: 'Home',
          modal: false,
          requirements: [
            { requirementId: 'req.ui.home', kind: 'ui', runtimeRole: 'screen' },
          ],
        },
        [
          edge('initial-state', 'state.home', 'presentation.ui-state'),
          edge('driven-by', 'gameplay.state.playing', 'gameplay.state'),
        ],
      ),
      node(
        'state.home',
        'presentation.ui-state',
        { label: 'Home state', terminal: false },
        [
          edge('screen', 'screen.home', 'presentation.ui-screen'),
          edge('driven-by', 'gameplay.state.playing', 'gameplay.state'),
        ],
      ),
      node(
        'transition.start',
        'presentation.transition',
        { label: 'Start', trigger: { kind: 'event' } },
        [
          edge('from', 'state.home', 'presentation.ui-state'),
          edge('to', 'state.home', 'presentation.ui-state'),
          edge('on', 'gameplay.event.start', 'gameplay.event'),
        ],
      ),
      node(
        'action.open',
        'presentation.ui-action',
        { label: 'Open', input: 'button' },
        [
          edge('screen', 'screen.home', 'presentation.ui-screen'),
          edge('invokes', 'gameplay.action.open', 'gameplay.action'),
        ],
      ),
      node(
        'feedback.hit',
        'presentation.feedback',
        { label: 'Hit', channel: 'flash' },
        [
          edge('on', 'gameplay.event.hit', 'gameplay.event'),
          edge('screen', 'screen.home', 'presentation.ui-screen'),
        ],
      ),
      node(
        'camera.follow',
        'presentation.camera-behavior',
        { label: 'Follow', mode: 'follow', duration: 0 },
        [
          edge(
            'region',
            'world-scene.camera.main',
            'world-scene.camera-region',
          ),
        ],
      ),
      node(
        'clip.hero',
        'presentation.animation-clip',
        {
          label: 'Hero',
          loop: true,
          playbackRate: 1,
          requirements: [
            {
              requirementId: 'req.anim.hero',
              kind: 'animation',
              runtimeRole: 'clip',
            },
          ],
        },
        [
          edge(
            'target',
            'world-scene.instance.hero',
            'world-scene.entity-instance',
          ),
        ],
      ),
      node(
        'animation.idle',
        'presentation.animation-state',
        { label: 'Idle' },
        [
          edge('clip', 'clip.hero', 'presentation.animation-clip'),
          edge('on', 'gameplay.event.start', 'gameplay.event'),
        ],
      ),
      node(
        'vfx.hit',
        'presentation.vfx-cue',
        {
          label: 'Impact',
          trigger: 'instant',
          requirements: [
            {
              requirementId: 'req.vfx.hit',
              kind: 'vfx',
              runtimeRole: 'effect',
            },
          ],
        },
        [
          edge('on', 'gameplay.event.hit', 'gameplay.event'),
          edge('at', 'world-scene.node.anchor', 'world-scene.node'),
        ],
      ),
      node(
        'audio.event.hit',
        'presentation.audio-event',
        { label: 'Hit sound', spatial: true },
        [edge('on', 'gameplay.event.hit', 'gameplay.event')],
      ),
      node(
        'audio.cue.hit',
        'presentation.audio-cue',
        {
          label: 'Hit cue',
          volume: 1,
          requirements: [
            {
              requirementId: 'req.audio.hit',
              kind: 'audio',
              runtimeRole: 'cue',
            },
          ],
        },
        [
          edge('event', 'audio.event.hit', 'presentation.audio-event'),
          edge('at', 'world-scene.zone.main', 'world-scene.zone'),
        ],
      ),
      node(
        'music.playing',
        'presentation.music-state',
        {
          label: 'Playing',
          intensity: 0.5,
          requirements: [
            {
              requirementId: 'req.music.playing',
              kind: 'music',
              runtimeRole: 'music',
            },
          ],
        },
        [edge('on', 'gameplay.state.playing', 'gameplay.state')],
      ),
    ],
  }
  module.nodes.sort((left, right) => compareCodeUnits(left.id, right.id))
  return module
}

function cloneModule(module: MutableModule): MutableModule {
  return structuredClone(module)
}

function admitted(module: MutableModule): GameIrModuleCandidate {
  return module as unknown as GameIrModuleCandidate
}

function nodeById(module: MutableModule, id: string): MutableNode {
  return module.nodes.find(candidate => candidate.id === id)!
}

describe('Presentation Game IR schema', () => {
  test('exposes exactly twelve manifest kinds and manifest-owned requirement policy', () => {
    expect(Object.keys(PRESENTATION_DOMAIN_MANIFEST)).toHaveLength(12)
    expect(PRESENTATION_DOMAIN_MANIFEST['presentation.ui-screen']).toEqual({
      valueFields: ['label', 'modal'],
      optionalValueFields: ['requirements'],
      requirementPolicy: { kind: 'ui', runtimeRoles: ['screen'] },
      relationships: {
        'initial-state': {
          targetKinds: ['presentation.ui-state'],
          cardinality: 'exactly-one',
        },
        'driven-by': {
          targetKinds: [
            'gameplay.state',
            'gameplay.event',
            'world-scene.scene',
          ],
          cardinality: 'exactly-one',
        },
      },
    })
    expect(
      PRESENTATION_DOMAIN_MANIFEST['presentation.audio-cue']?.requirementPolicy,
    ).toEqual({
      kind: 'audio',
      runtimeRoles: ['cue', 'voice'],
    })
  })

  test('accepts the closed presentation graph, optional requirements, and freezes output', () => {
    const parsed = parsePresentationModule(
      admitted(validModule()),
      externalTargets(),
    )
    expect(parsed.moduleId).toBe('presentation')
    expect(parsed.nodes).toHaveLength(12)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0]!.value)).toBe(true)
    expect(
      parsed.nodes.find(candidate => candidate.id === 'screen.home')?.value,
    ).toEqual({
      label: 'Home',
      modal: false,
      requirements: [
        { requirementId: 'req.ui.home', kind: 'ui', runtimeRole: 'screen' },
      ],
    })
  })

  test('accepts labels that look like files without inferring artifacts', () => {
    const module = validModule()
    nodeById(module, 'screen.home').value.label = 'death.wav'
    expect(() =>
      parsePresentationModule(admitted(module), externalTargets()),
    ).not.toThrow()
  })

  test('enforces strict values, requirement ownership, sorted unique IDs, and numeric boundaries', () => {
    const unknown = cloneModule(validModule())
    unknown.nodes[0]!.value.fileName = 'ui.png'
    expect(() =>
      parsePresentationModule(admitted(unknown), externalTargets()),
    ).toThrow(/field|unknown/i)

    const wrongRequirement = cloneModule(validModule())
    ;(
      nodeById(wrongRequirement, 'screen.home').value.requirements as Array<
        Record<string, unknown>
      >
    )[0]!.kind = 'audio'
    expect(() =>
      parsePresentationModule(admitted(wrongRequirement), externalTargets()),
    ).toThrow(/requirement|policy|kind/i)

    const duplicateRequirements = cloneModule(validModule())
    ;(
      nodeById(duplicateRequirements, 'screen.home').value
        .requirements as Array<Record<string, unknown>>
    ).push({ requirementId: 'req.ui.home', kind: 'ui', runtimeRole: 'screen' })
    expect(() =>
      parsePresentationModule(
        admitted(duplicateRequirements),
        externalTargets(),
      ),
    ).toThrow(/unique|sorted|requirement/i)

    const unsafeRequirement = cloneModule(validModule())
    ;(
      nodeById(unsafeRequirement, 'screen.home').value.requirements as Array<
        Record<string, unknown>
      >
    )[0]!.requirementId = 'ui/home'
    expect(() =>
      parsePresentationModule(admitted(unsafeRequirement), externalTargets()),
    ).toThrow(/identifier|requirement/i)

    for (const [id, field, value, message] of [
      ['camera.follow', 'duration', -1, 'duration'],
      ['clip.hero', 'playbackRate', 0, 'playbackRate'],
      ['audio.cue.hit', 'volume', 2, 'volume'],
      ['music.playing', 'intensity', Number.NaN, 'intensity'],
    ] as const) {
      const mutation = cloneModule(validModule())
      nodeById(mutation, id).value[field] = value
      expect(() =>
        parsePresentationModule(admitted(mutation), externalTargets()),
      ).toThrow(message)
    }
  })

  test('requires exact trigger discriminants and rejects animation-state machine fields', () => {
    const badTrigger = cloneModule(validModule())
    nodeById(badTrigger, 'transition.start').value.trigger = {
      kind: 'event',
      extra: true,
    }
    expect(() =>
      parsePresentationModule(admitted(badTrigger), externalTargets()),
    ).toThrow(/trigger|field/i)

    const machine = cloneModule(validModule())
    machine.nodes.push(
      node(
        'animation.machine',
        'presentation.animation-state',
        { label: 'Machine', initial: true, terminal: false, machine: 'x' },
        [
          edge('clip', 'clip.hero', 'presentation.animation-clip'),
          edge('on', 'gameplay.event.start', 'gameplay.event'),
        ],
      ),
    )
    machine.nodes.sort((left, right) => compareCodeUnits(left.id, right.id))
    expect(() =>
      parsePresentationModule(admitted(machine), externalTargets()),
    ).toThrow(/field|unknown/i)
  })

  test('guards UI reachability, initial backlinks, terminal states, same-screen transitions, and singleton edges', () => {
    const missingInitialBacklink = cloneModule(validModule())
    nodeById(missingInitialBacklink, 'state.home').edges = nodeById(
      missingInitialBacklink,
      'state.home',
    ).edges.filter(edgeValue => edgeValue.type !== 'screen')
    expect(() =>
      parsePresentationModule(
        admitted(missingInitialBacklink),
        externalTargets(),
      ),
    ).toThrow(/screen|back|exactly/i)

    const unreachable = cloneModule(validModule())
    unreachable.nodes.push(
      node(
        'state.unreachable',
        'presentation.ui-state',
        { label: 'Unreachable', terminal: false },
        [
          edge('screen', 'screen.home', 'presentation.ui-screen'),
          edge('driven-by', 'gameplay.state.playing', 'gameplay.state'),
        ],
      ),
    )
    unreachable.nodes.sort((left, right) => compareCodeUnits(left.id, right.id))
    expect(() =>
      parsePresentationModule(admitted(unreachable), externalTargets()),
    ).toThrow(/reach/i)

    const terminal = cloneModule(validModule())
    nodeById(terminal, 'state.home').value.terminal = true
    expect(() =>
      parsePresentationModule(admitted(terminal), externalTargets()),
    ).toThrow(/terminal|outgoing/i)

    const crossScreen = cloneModule(validModule())
    crossScreen.nodes.push(
      node(
        'screen.other',
        'presentation.ui-screen',
        { label: 'Other', modal: false },
        [
          edge('initial-state', 'state.other', 'presentation.ui-state'),
          edge('driven-by', 'world-scene.scene.main', 'world-scene.scene'),
        ],
      ),
      node(
        'state.other',
        'presentation.ui-state',
        { label: 'Other', terminal: false },
        [
          edge('screen', 'screen.other', 'presentation.ui-screen'),
          edge('driven-by', 'world-scene.scene.main', 'world-scene.scene'),
        ],
      ),
    )
    const transition = nodeById(crossScreen, 'transition.start')
    transition.edges[1] = edge('to', 'state.other', 'presentation.ui-state')
    crossScreen.nodes.sort((left, right) => compareCodeUnits(left.id, right.id))
    expect(() =>
      parsePresentationModule(admitted(crossScreen), externalTargets()),
    ).toThrow(/same screen|cross/i)

    const duplicateSingleton = cloneModule(validModule())
    nodeById(duplicateSingleton, 'screen.home').edges.push(
      edge('initial-state', 'state.home', 'presentation.ui-state'),
    )
    expect(() =>
      parsePresentationModule(admitted(duplicateSingleton), externalTargets()),
    ).toThrow(/exactly|duplicate/i)
  })

  test('guards role cardinality and exact trigger target kinds', () => {
    const automatic = cloneModule(validModule())
    nodeById(automatic, 'transition.start').value.trigger = {
      kind: 'automatic',
    }
    expect(() =>
      parsePresentationModule(admitted(automatic), externalTargets()),
    ).toThrow(/automatic|on/i)

    const wrongEventKind = cloneModule(validModule())
    nodeById(wrongEventKind, 'transition.start').value.trigger = {
      kind: 'action',
    }
    expect(() =>
      parsePresentationModule(admitted(wrongEventKind), externalTargets()),
    ).toThrow(/target|action/i)

    const missingRole = cloneModule(validModule())
    nodeById(missingRole, 'vfx.hit').edges = nodeById(
      missingRole,
      'vfx.hit',
    ).edges.filter(edgeValue => edgeValue.type !== 'at')
    expect(() =>
      parsePresentationModule(admitted(missingRole), externalTargets()),
    ).toThrow(/at|exactly/i)
  })

  test('guards animation, VFX, audio, camera, music, and duplicate audio triggers', () => {
    const missingClip = cloneModule(validModule())
    nodeById(missingClip, 'animation.idle').edges[0] = edge(
      'clip',
      'clip.missing',
      'presentation.animation-clip',
    )
    expect(() =>
      parsePresentationModule(admitted(missingClip), externalTargets()),
    ).toThrow(/unknown|target|clip/i)

    const duplicateAudio = cloneModule(validModule())
    duplicateAudio.nodes.push(
      node(
        'audio.event.duplicate',
        'presentation.audio-event',
        { label: 'Duplicate', spatial: false },
        [edge('on', 'gameplay.event.hit', 'gameplay.event')],
      ),
    )
    duplicateAudio.nodes.sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    )
    expect(() =>
      parsePresentationModule(admitted(duplicateAudio), externalTargets()),
    ).toThrow(/audio|trigger|duplicate/i)

    const nonSpatialContext = cloneModule(validModule())
    nodeById(nonSpatialContext, 'audio.event.hit').value.spatial = false
    expect(() =>
      parsePresentationModule(admitted(nonSpatialContext), externalTargets()),
    ).toThrow(/spatial|context|at/i)

    const spatialMissingContext = cloneModule(validModule())
    nodeById(spatialMissingContext, 'audio.cue.hit').edges = nodeById(
      spatialMissingContext,
      'audio.cue.hit',
    ).edges.filter(edgeValue => edgeValue.type !== 'at')
    expect(() =>
      parsePresentationModule(
        admitted(spatialMissingContext),
        externalTargets(),
      ),
    ).toThrow(/spatial|at|exactly/i)

    const cueOn = cloneModule(validModule())
    nodeById(cueOn, 'audio.cue.hit').edges.push(
      edge('on', 'gameplay.event.hit', 'gameplay.event'),
    )
    expect(() =>
      parsePresentationModule(admitted(cueOn), externalTargets()),
    ).toThrow(/unknown|role|on/i)
  })

  test('rejects dangling, forbidden, and cross-domain targets while accepting legal external targets', () => {
    expect(() =>
      parsePresentationModule(admitted(validModule()), externalTargets()),
    ).not.toThrow()
    const dangling = cloneModule(validModule())
    nodeById(dangling, 'camera.follow').edges[0] = edge(
      'region',
      'world-scene.camera.missing',
      'world-scene.camera-region',
    )
    expect(() =>
      parsePresentationModule(admitted(dangling), externalTargets()),
    ).toThrow(/unknown|target/i)

    const forbidden = new Map(externalTargets())
    forbidden.set(
      'balance.damage',
      external('balance.damage', 'balance.variable'),
    )
    const forbiddenModule = cloneModule(validModule())
    nodeById(forbiddenModule, 'camera.follow').edges[0] = edge(
      'region',
      'balance.damage',
      'balance.variable',
    )
    expect(() =>
      parsePresentationModule(admitted(forbiddenModule), forbidden),
    ).toThrow(/forbidden|admitted|target/i)

    const crossDomain = cloneModule(validModule())
    nodeById(crossDomain, 'clip.hero').edges[0] = edge(
      'target',
      'world-scene.scene.main',
      'world-scene.scene',
    )
    expect(() =>
      parsePresentationModule(admitted(crossDomain), externalTargets()),
    ).toThrow(/target|entity|kind/i)
  })
})
