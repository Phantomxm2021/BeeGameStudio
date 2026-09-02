import { describe, expect, test } from 'bun:test'
import {
  WORLD_SCENE_DOMAIN_MANIFEST,
  parseWorldSceneModule,
} from './world-scene-schema'
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

type MutableModule = { moduleId: 'world-scene'; nodes: MutableNode[] }

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
  references: MutableNode['references'] = [],
): MutableNode => ({
  id,
  kind,
  producerMode: 'semantic',
  value,
  references,
  edges,
  bindings: {},
})

const convention2d = {
  dimensions: '2d',
  xDirection: 'right',
  yDirection: 'up',
  distanceUnit: 'meter',
} as const

const transform2d = (space: 'local' | 'world' = 'local') => ({
  dimensions: '2d',
  space,
  position: { x: 0, y: 0 },
  rotationRadians: 0,
  scale: { x: 1, y: 1 },
})

function validModule(): MutableModule {
  return {
    moduleId: 'world-scene',
    nodes: [
      node(
        'node.root',
        'world-scene.node',
        {
          label: 'Root',
          nodeType: 'container',
          transform: transform2d('world'),
        },
        [edge('scene', 'scene.main', 'world-scene.scene')],
      ),
      node(
        'scene.main',
        'world-scene.scene',
        {
          label: 'Main scene',
          coordinateConvention: convention2d,
        },
        [edge('root', 'node.root', 'world-scene.node')],
      ),
    ],
  }
}

function cloneModule(module: MutableModule): MutableModule {
  return structuredClone(module)
}

function admitted(module: MutableModule): GameIrModuleCandidate {
  return module as unknown as GameIrModuleCandidate
}

function expectExactError(action: () => unknown, message: string): void {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(Error)
  expect((thrown as Error).message).toBe(message)
}

function richModule(): MutableModule {
  const module = validModule()
  module.nodes.push(
    node(
      'camera.main',
      'world-scene.camera-region',
      {
        label: 'Camera',
        priority: 1,
        blendIn: 0,
        blendOut: 0.5,
      },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('zone', 'zone.spawn', 'world-scene.zone'),
        edge('anchor', 'node.anchor', 'world-scene.node'),
      ],
    ),
    node(
      'checkpoint.one',
      'world-scene.checkpoint',
      {
        label: 'Checkpoint',
        ordinal: 0,
        resetPolicy: 'restart',
      },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('location', 'node.anchor', 'world-scene.node'),
        edge('respawn-state', 'gameplay.state.playing', 'gameplay.state'),
      ],
    ),
    node(
      'encounter.patrol',
      'world-scene.encounter',
      {
        label: 'Patrol encounter',
        mode: 'patrol',
      },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('zone', 'zone.spawn', 'world-scene.zone'),
        edge('spawn', 'spawn.hero', 'world-scene.spawn'),
      ],
    ),
    node(
      'instance.hero',
      'world-scene.entity-instance',
      { label: 'Hero instance' },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('entity', 'gameplay.entity.hero', 'gameplay.entity'),
        edge('location', 'node.anchor', 'world-scene.node'),
        edge('zone', 'zone.spawn', 'world-scene.zone'),
      ],
    ),
    node(
      'node.anchor',
      'world-scene.node',
      {
        label: 'Anchor',
        nodeType: 'anchor',
        transform: transform2d(),
      },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('parent', 'node.root', 'world-scene.node'),
      ],
    ),
    node(
      'node.visual',
      'world-scene.node',
      {
        label: 'Visual',
        nodeType: 'visual',
        transform: transform2d(),
      },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('parent', 'node.root', 'world-scene.node'),
      ],
    ),
    node(
      'node.volume',
      'world-scene.node',
      {
        label: 'Volume',
        nodeType: 'volume',
        transform: transform2d(),
      },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('parent', 'node.root', 'world-scene.node'),
        edge('zone', 'zone.spawn', 'world-scene.zone'),
      ],
    ),
    node(
      'objective.place',
      'world-scene.objective-placement',
      { label: 'Objective' },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('objective', 'gameplay.objective.exit', 'gameplay.objective'),
        edge('location', 'node.anchor', 'world-scene.node'),
      ],
    ),
    node(
      'route.patrol',
      'world-scene.route',
      {
        label: 'Route',
        closed: true,
        waypointReferenceIndexes: [0, 1, 0],
      },
      [edge('scene', 'scene.main', 'world-scene.scene')],
      [
        { targetId: 'node.anchor', targetType: 'world-scene.node' },
        { targetId: 'node.visual', targetType: 'world-scene.node' },
      ],
    ),
    node(
      'spawn.hero',
      'world-scene.spawn',
      {
        label: 'Hero spawn',
        quantity: 1,
        policy: 'once',
      },
      [
        edge('scene', 'scene.main', 'world-scene.scene'),
        edge('location', 'node.anchor', 'world-scene.node'),
        edge('entity', 'gameplay.entity.hero', 'gameplay.entity'),
      ],
    ),
    node(
      'zone.spawn',
      'world-scene.zone',
      {
        label: 'Spawn zone',
        shape: { kind: 'rectangle', size: { x: 10, y: 4 } },
        transform: transform2d(),
      },
      [edge('scene', 'scene.main', 'world-scene.scene')],
    ),
  )
  module.nodes.sort((left, right) => compareCodeUnits(left.id, right.id))
  return module
}

function externalTargets(): ReadonlyMap<string, GameIrNode> {
  return new Map([
    [
      'gameplay.entity.hero',
      { id: 'gameplay.entity.hero', kind: 'gameplay.entity' },
    ],
    [
      'gameplay.event.alarm',
      { id: 'gameplay.event.alarm', kind: 'gameplay.event' },
    ],
    [
      'gameplay.state.playing',
      { id: 'gameplay.state.playing', kind: 'gameplay.state' },
    ],
    [
      'gameplay.objective.exit',
      { id: 'gameplay.objective.exit', kind: 'gameplay.objective' },
    ],
  ] as const) as unknown as ReadonlyMap<string, GameIrNode>
}

function nodeById(module: MutableModule, id: string): MutableNode {
  return module.nodes.find(candidate => candidate.id === id)!
}

function set3d(value: Record<string, unknown>): void {
  value.transform = {
    dimensions: '3d',
    space: 'local',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  }
}

function threeDimensionalModule(): MutableModule {
  const module = validModule()
  nodeById(module, 'scene.main').value.coordinateConvention = {
    dimensions: '3d',
    handedness: 'right',
    upAxis: '+y',
    forwardAxis: '+z',
    distanceUnit: 'meter',
  }
  nodeById(module, 'node.root').value.transform = {
    dimensions: '3d',
    space: 'world',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  }
  return module
}

describe('World/Scene Game IR schema', () => {
  test('exposes the closed ten-kind manifest', () => {
    expect(Object.keys(WORLD_SCENE_DOMAIN_MANIFEST)).toHaveLength(10)
    const { valueJsonSchema: _schema, ...sceneManifest } =
      WORLD_SCENE_DOMAIN_MANIFEST['world-scene.scene']
    expect(sceneManifest).toEqual({
      relationships: {
        root: {
          targetKinds: ['world-scene.node'],
          cardinality: 'exactly-one',
        },
      },
    })
    for (const descriptor of Object.values(WORLD_SCENE_DOMAIN_MANIFEST))
      expect(descriptor.valueJsonSchema).toBeDefined()
    expect(WORLD_SCENE_DOMAIN_MANIFEST['world-scene.route'].references).toEqual(
      {
        targetKinds: ['world-scene.node'],
        unique: true,
        sorted: true,
        minTraversalLength: 2,
        requireAllReferences: true,
      },
    )
  })

  test('accepts a minimal world scene and freezes the result', () => {
    const parsed = parseWorldSceneModule(admitted(validModule()))
    expect(parsed.moduleId).toBe('world-scene')
    expect(parsed.nodes).toHaveLength(2)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0]!.value)).toBe(true)
  })

  test('enforces the exact admitted module and semantic node envelopes', () => {
    const valid = validModule()
    const parsed = parseWorldSceneModule(admitted(valid))
    expect(parsed.nodes.map(node => node.id)).toEqual([
      'node.root',
      'scene.main',
    ])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)

    const unknownModuleField = cloneModule(valid) as MutableModule &
      Record<string, unknown>
    unknownModuleField.extra = true
    expectExactError(
      () => parseWorldSceneModule(admitted(unknownModuleField)),
      'invalid World/Scene module: module has unknown or missing fields',
    )

    const unknownNodeField = cloneModule(valid)
    ;(unknownNodeField.nodes[0] as unknown as Record<string, unknown>).extra =
      true
    expectExactError(
      () => parseWorldSceneModule(admitted(unknownNodeField)),
      'invalid World/Scene module: node node.root has unknown or missing fields',
    )

    const hiddenNodeField = cloneModule(valid)
    Object.defineProperty(hiddenNodeField.nodes[0], 'hidden', {
      value: true,
      enumerable: false,
    })
    expectExactError(
      () => parseWorldSceneModule(admitted(hiddenNodeField)),
      'invalid World/Scene module: node node.root has a non-JSON property',
    )

    const accessorNodeField = cloneModule(valid)
    Object.defineProperty(accessorNodeField.nodes[0], 'accessor', {
      get: () => true,
      enumerable: true,
    })
    expectExactError(
      () => parseWorldSceneModule(admitted(accessorNodeField)),
      'invalid World/Scene module: node node.root has a non-JSON property',
    )

    const symbolNodeField = cloneModule(valid)
    Object.defineProperty(symbolNodeField.nodes[0], Symbol('extra'), {
      value: true,
      enumerable: true,
    })
    expectExactError(
      () => parseWorldSceneModule(admitted(symbolNodeField)),
      'invalid World/Scene module: node node.root has an unknown symbol key',
    )

    for (const producerMode of ['mechanical', 'derived'] as const) {
      const mutation = cloneModule(valid)
      ;(mutation.nodes[0] as unknown as Record<string, unknown>).producerMode =
        producerMode
      expectExactError(
        () => parseWorldSceneModule(admitted(mutation)),
        `invalid World/Scene module: node node.root producerMode must be semantic`,
      )
    }
  })

  test('rejects a zero quaternion or non-positive scale', () => {
    const zeroQuaternion = threeDimensionalModule()
    expect(() => parseWorldSceneModule(admitted(zeroQuaternion))).not.toThrow()
    const zeroQuaternionMutation = cloneModule(zeroQuaternion)
    const rootTransform = nodeById(zeroQuaternionMutation, 'node.root').value
      .transform as { rotation: Record<string, number> }
    rootTransform.rotation = { x: 0, y: 0, z: 0, w: 0 }
    expect(() =>
      parseWorldSceneModule(admitted(zeroQuaternionMutation)),
    ).toThrow('rotation quaternion must be non-zero')

    const nonPositiveScale = validModule()
    expect(() =>
      parseWorldSceneModule(admitted(nonPositiveScale)),
    ).not.toThrow()
    const nonPositiveScaleMutation = cloneModule(nonPositiveScale)
    ;(
      nodeById(nonPositiveScaleMutation, 'node.root').value.transform as {
        scale: { x: number }
      }
    ).scale.x = 0
    expect(() =>
      parseWorldSceneModule(admitted(nonPositiveScaleMutation)),
    ).toThrow('scale must be positive')
  })

  test('accepts every node kind, value union, external Gameplay target, and route revisit', () => {
    const parsed = parseWorldSceneModule(
      admitted(richModule()),
      externalTargets(),
    )
    expect(parsed.nodes.map(node => node.kind)).toEqual([
      'world-scene.camera-region',
      'world-scene.checkpoint',
      'world-scene.encounter',
      'world-scene.entity-instance',
      'world-scene.node',
      'world-scene.node',
      'world-scene.node',
      'world-scene.node',
      'world-scene.objective-placement',
      'world-scene.route',
      'world-scene.scene',
      'world-scene.spawn',
      'world-scene.zone',
    ])
    expect(
      parsed.nodes.find(node => node.id === 'route.patrol')?.value,
    ).toEqual({
      label: 'Route',
      closed: true,
      waypointReferenceIndexes: [0, 1, 0],
    })
    expect(
      parsed.nodes.find(node => node.id === 'route.patrol')?.edges,
    ).toEqual([edge('scene', 'scene.main', 'world-scene.scene')])
  })

  test('rejects external World targets instead of supplementing local nodes', () => {
    const baseline = richModule()
    const baselineTargets = externalTargets()
    expect(() =>
      parseWorldSceneModule(admitted(baseline), baselineTargets),
    ).not.toThrow()
    const mutation = cloneModule(baseline)
    nodeById(mutation, 'spawn.hero').edges[1] = edge(
      'location',
      'external.node',
      'world-scene.node',
    )
    const targets = new Map(baselineTargets)
    targets.set('external.node', {
      id: 'external.node',
      kind: 'world-scene.node',
    } as GameIrNode)
    expect(() => parseWorldSceneModule(admitted(mutation), targets)).toThrow(
      'external target external.node cannot supply a local World kind',
    )
  })

  test('rejects malformed external kinds with a schema error', () => {
    const baseline = richModule()
    const targets = externalTargets()
    expect(() =>
      parseWorldSceneModule(admitted(baseline), targets),
    ).not.toThrow()
    const malformed = new Map(targets)
    malformed.set('malformed.target', {
      id: 'malformed.target',
      kind: 42,
    } as unknown as GameIrNode)
    expect(() => parseWorldSceneModule(admitted(baseline), malformed)).toThrow(
      'external target malformed.target kind must be text',
    )
  })

  test('rejects a forbidden external kind after a legal Gameplay baseline', () => {
    const baseline = richModule()
    const targets = externalTargets()
    expect(() =>
      parseWorldSceneModule(admitted(baseline), targets),
    ).not.toThrow()
    const mutation = new Map(targets)
    const entity = mutation.get('gameplay.entity.hero')!
    mutation.set('gameplay.entity.hero', {
      ...entity,
      kind: 'balance.variable',
    } as GameIrNode)
    expect(() => parseWorldSceneModule(admitted(baseline), mutation)).toThrow(
      'external target gameplay.entity.hero kind is forbidden by the World manifest',
    )
  })

  test.each([
    ['rectangle', { kind: 'rectangle', size: { x: 1, y: 2 } }],
    ['circle', { kind: 'circle', radius: 2 }],
    ['capsule-2d', { kind: 'capsule-2d', radius: 1, length: 3 }],
  ] as const)('accepts 2D %s zone geometry', (_name, shape) => {
    const module = richModule()
    nodeById(module, 'zone.spawn').value.shape = shape
    expect(() =>
      parseWorldSceneModule(admitted(module), externalTargets()),
    ).not.toThrow()
  })

  test.each([
    ['box', { kind: 'box', size: { x: 1, y: 2, z: 3 } }],
    ['sphere', { kind: 'sphere', radius: 2 }],
    ['capsule-3d', { kind: 'capsule-3d', radius: 1, height: 3 }],
  ] as const)('accepts 3D %s zone geometry', (_name, shape) => {
    const module = richModule()
    nodeById(module, 'scene.main').value.coordinateConvention = {
      dimensions: '3d',
      handedness: 'right',
      upAxis: '+y',
      forwardAxis: '+z',
      distanceUnit: 'meter',
    }
    for (const id of [
      'node.root',
      'node.anchor',
      'node.visual',
      'node.volume',
      'zone.spawn',
    ])
      set3d(nodeById(module, id).value)
    nodeById(module, 'node.root').value.transform = {
      ...(nodeById(module, 'node.root').value.transform as Record<
        string,
        unknown
      >),
      space: 'world',
    }
    nodeById(module, 'zone.spawn').value.shape = shape
    expect(() =>
      parseWorldSceneModule(admitted(module), externalTargets()),
    ).not.toThrow()
  })

  test('rejects invalid coordinate axes, dimensions, finite numbers, and geometry positivity', () => {
    const sameAxes = richModule()
    nodeById(sameAxes, 'scene.main').value.coordinateConvention = {
      dimensions: '3d',
      handedness: 'right',
      upAxis: '+y',
      forwardAxis: '-y',
      distanceUnit: 'meter',
    }
    expect(() =>
      parseWorldSceneModule(admitted(sameAxes), externalTargets()),
    ).toThrow(/axes|distinct/i)

    const mismatch = richModule()
    nodeById(mismatch, 'zone.spawn').value.shape = {
      kind: 'box',
      size: { x: 1, y: 1, z: 1 },
    }
    expect(() =>
      parseWorldSceneModule(admitted(mismatch), externalTargets()),
    ).toThrow(/dimension/i)

    const nonFinite = richModule()
    ;(
      nodeById(nonFinite, 'node.root').value.transform as {
        position: { x: number }
      }
    ).position.x = Number.NaN
    expect(() =>
      parseWorldSceneModule(admitted(nonFinite), externalTargets()),
    ).toThrow(/finite/i)

    const zeroGeometry = richModule()
    nodeById(zeroGeometry, 'zone.spawn').value.shape = {
      kind: 'circle',
      radius: 0,
    }
    expect(() =>
      parseWorldSceneModule(admitted(zeroGeometry), externalTargets()),
    ).toThrow(/positive/i)
  })

  test('enforces exact value fields, root world space, and conditional node-zone cardinality', () => {
    const unknownField = richModule()
    nodeById(unknownField, 'node.root').value.extra = true
    expect(() =>
      parseWorldSceneModule(admitted(unknownField), externalTargets()),
    ).toThrow(/field|value/i)

    const badRootSpace = richModule()
    nodeById(badRootSpace, 'node.root').value.transform = transform2d()
    expect(() =>
      parseWorldSceneModule(admitted(badRootSpace), externalTargets()),
    ).toThrow(/root.*world/i)

    const missingVolumeZone = richModule()
    nodeById(missingVolumeZone, 'node.volume').edges = nodeById(
      missingVolumeZone,
      'node.volume',
    ).edges.filter(edge => edge.type !== 'zone')
    expect(() =>
      parseWorldSceneModule(admitted(missingVolumeZone), externalTargets()),
    ).toThrow(/zone|exactly/i)

    const unexpectedZone = richModule()
    nodeById(unexpectedZone, 'node.visual').edges.push(
      edge('zone', 'zone.spawn', 'world-scene.zone'),
    )
    expect(() =>
      parseWorldSceneModule(admitted(unexpectedZone), externalTargets()),
    ).toThrow(/zone|occur/i)

    const hiddenTarget = richModule()
    nodeById(hiddenTarget, 'node.visual').value.label = 'node.anchor'
    expect(() =>
      parseWorldSceneModule(admitted(hiddenTarget), externalTargets()),
    ).toThrow(/target|id|value/i)
  })

  test('guards roots, parent closure, cycles, orphan nodes, cross-scene links, and singleton edges', () => {
    const noRoot = richModule()
    expect(() =>
      parseWorldSceneModule(admitted(noRoot), externalTargets()),
    ).not.toThrow()
    const noRootMutation = cloneModule(noRoot)
    nodeById(noRootMutation, 'scene.main').edges = []
    expect(() =>
      parseWorldSceneModule(admitted(noRootMutation), externalTargets()),
    ).toThrow('relationship root must occur exactly once')

    const cycle = richModule()
    nodeById(cycle, 'node.visual').edges = nodeById(
      cycle,
      'node.visual',
    ).edges.map(edgeValue =>
      edgeValue.type === 'parent'
        ? edge('parent', 'node.anchor', 'world-scene.node')
        : edgeValue,
    )
    expect(() =>
      parseWorldSceneModule(admitted(cycle), externalTargets()),
    ).not.toThrow()
    const cycleMutation = cloneModule(cycle)
    nodeById(cycleMutation, 'node.anchor').edges = nodeById(
      cycleMutation,
      'node.anchor',
    ).edges.map(edgeValue =>
      edgeValue.type === 'parent'
        ? edge('parent', 'node.visual', 'world-scene.node')
        : edgeValue,
    )
    expect(() =>
      parseWorldSceneModule(admitted(cycleMutation), externalTargets()),
    ).toThrow('parent hierarchy contains a cycle')

    const orphan = richModule()
    nodeById(orphan, 'node.visual').edges = nodeById(
      orphan,
      'node.visual',
    ).edges.filter(edge => edge.type !== 'parent')
    expect(() =>
      parseWorldSceneModule(admitted(orphan), externalTargets()),
    ).toThrow(/root|exactly/i)

    const crossScene = richModule()
    crossScene.nodes.push(
      node(
        'scene.other',
        'world-scene.scene',
        {
          label: 'Other',
          coordinateConvention: convention2d,
        },
        [edge('root', 'node.other-root', 'world-scene.node')],
      ),
    )
    crossScene.nodes.push(
      node(
        'node.other-root',
        'world-scene.node',
        {
          label: 'Other root',
          nodeType: 'container',
          transform: transform2d('world'),
        },
        [edge('scene', 'scene.other', 'world-scene.scene')],
      ),
    )
    nodeById(crossScene, 'node.anchor').edges[0] = edge(
      'scene',
      'scene.other',
      'world-scene.scene',
    )
    crossScene.nodes.sort((left, right) => compareCodeUnits(left.id, right.id))
    expect(() =>
      parseWorldSceneModule(admitted(crossScene), externalTargets()),
    ).toThrow(/cross|scene/i)

    const duplicate = richModule()
    nodeById(duplicate, 'node.anchor').edges.push(
      edge('scene', 'scene.main', 'world-scene.scene'),
    )
    expect(() =>
      parseWorldSceneModule(admitted(duplicate), externalTargets()),
    ).toThrow(/duplicate|exactly/i)
  })

  test('guards route indexes and declared-reference usage', () => {
    const tooShort = richModule()
    nodeById(tooShort, 'route.patrol').value.waypointReferenceIndexes = [0]
    expect(() =>
      parseWorldSceneModule(admitted(tooShort), externalTargets()),
    ).toThrow(/two|waypoint/i)

    const outOfRange = richModule()
    nodeById(outOfRange, 'route.patrol').value.waypointReferenceIndexes = [0, 2]
    expect(() =>
      parseWorldSceneModule(admitted(outOfRange), externalTargets()),
    ).toThrow(/range/i)

    const unused = richModule()
    nodeById(unused, 'route.patrol').value.waypointReferenceIndexes = [0, 0]
    expect(() =>
      parseWorldSceneModule(admitted(unused), externalTargets()),
    ).toThrow(/every|reference/i)

    const unsorted = richModule()
    nodeById(unsorted, 'route.patrol').references.reverse()
    expect(() =>
      parseWorldSceneModule(admitted(unsorted), externalTargets()),
    ).toThrow(/sorted|reference/i)
  })

  test('guards encounter modes and duplicate spawn edges', () => {
    for (const mode of ['triggered', 'patrol', 'scripted'] as const) {
      const module = richModule()
      nodeById(module, 'encounter.patrol').value.mode = mode
      if (mode === 'triggered')
        nodeById(module, 'encounter.patrol').edges.push(
          edge('triggered-by', 'gameplay.event.alarm', 'gameplay.event'),
        )
      expect(() =>
        parseWorldSceneModule(admitted(module), externalTargets()),
      ).not.toThrow()
    }
    const wrongModeEdge = richModule()
    nodeById(wrongModeEdge, 'encounter.patrol').edges.push(
      edge('triggered-by', 'gameplay.event.alarm', 'gameplay.event'),
    )
    expect(() =>
      parseWorldSceneModule(admitted(wrongModeEdge), externalTargets()),
    ).toThrow(/triggered|relationship/i)
    const missingTrigger = richModule()
    nodeById(missingTrigger, 'encounter.patrol').value.mode = 'triggered'
    expect(() =>
      parseWorldSceneModule(admitted(missingTrigger), externalTargets()),
    ).toThrow(/triggered|relationship/i)
    const duplicateSpawn = richModule()
    nodeById(duplicateSpawn, 'encounter.patrol').edges.push(
      edge('spawn', 'spawn.hero', 'world-scene.spawn'),
    )
    expect(() =>
      parseWorldSceneModule(admitted(duplicateSpawn), externalTargets()),
    ).toThrow(/duplicate|spawn/i)
  })

  test('guards numeric boundaries, camera anchors, dangling and forbidden targets', () => {
    for (const [field, value] of [
      ['quantity', 0],
      ['quantity', Number.MAX_SAFE_INTEGER + 1],
      ['ordinal', -1],
    ] as const) {
      const module = richModule()
      nodeById(
        module,
        field === 'quantity' ? 'spawn.hero' : 'checkpoint.one',
      ).value[field] = value
      expect(() =>
        parseWorldSceneModule(admitted(module), externalTargets()),
      ).toThrow(/positive|safe|non-negative/i)
    }
    const badBlend = richModule()
    nodeById(badBlend, 'camera.main').value.blendIn = -1
    expect(() =>
      parseWorldSceneModule(admitted(badBlend), externalTargets()),
    ).toThrow(/non-negative/i)
    const duplicateOrdinal = richModule()
    const checkpoint = nodeById(duplicateOrdinal, 'checkpoint.one')
    duplicateOrdinal.nodes.push({ ...checkpoint, id: 'checkpoint.two' })
    duplicateOrdinal.nodes.sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    )
    expect(() =>
      parseWorldSceneModule(admitted(duplicateOrdinal), externalTargets()),
    ).toThrow(/ordinal/i)
    const badAnchor = richModule()
    nodeById(badAnchor, 'camera.main').edges = nodeById(
      badAnchor,
      'camera.main',
    ).edges.map(edgeValue =>
      edgeValue.type === 'anchor'
        ? edge('anchor', 'node.visual', 'world-scene.node')
        : edgeValue,
    )
    expect(() =>
      parseWorldSceneModule(admitted(badAnchor), externalTargets()),
    ).toThrow(/anchor/i)
    const dangling = richModule()
    nodeById(dangling, 'spawn.hero').edges[2] = edge(
      'entity',
      'gameplay.entity.missing',
      'gameplay.entity',
    )
    expect(() =>
      parseWorldSceneModule(admitted(dangling), externalTargets()),
    ).toThrow(/unknown|target/i)
  })
})
