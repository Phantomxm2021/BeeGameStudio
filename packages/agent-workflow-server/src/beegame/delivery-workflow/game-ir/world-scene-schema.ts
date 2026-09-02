import {
  compareCodeUnits,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'
import {
  projectionArray,
  projectionBoolean,
  projectionEnum,
  projectionFiniteNumber,
  projectionInteger,
  projectionText,
  projectionValueRequiredFields,
  projectionValueSchema,
} from './projection-schema'

const WORLD_VECTOR2 = {
  type: 'object',
  additionalProperties: false,
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
} as const
const WORLD_VECTOR3 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
  },
  required: ['x', 'y', 'z'],
} as const
const WORLD_COORDINATE_CONVENTION = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimensions: { const: '2d' },
        xDirection: { enum: ['left', 'right'] },
        yDirection: { enum: ['up', 'down'] },
        distanceUnit: { enum: ['pixel', 'centimeter', 'meter'] },
      },
      required: ['dimensions', 'xDirection', 'yDirection', 'distanceUnit'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimensions: { const: '3d' },
        handedness: { enum: ['left', 'right'] },
        upAxis: { enum: ['+x', '-x', '+y', '-y', '+z', '-z'] },
        forwardAxis: { enum: ['+x', '-x', '+y', '-y', '+z', '-z'] },
        distanceUnit: { enum: ['centimeter', 'meter'] },
      },
      required: [
        'dimensions',
        'handedness',
        'upAxis',
        'forwardAxis',
        'distanceUnit',
      ],
    },
  ],
} as const
const WORLD_TRANSFORM = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimensions: { const: '2d' },
        space: { enum: ['local', 'world'] },
        position: WORLD_VECTOR2,
        rotationRadians: { type: 'number' },
        scale: WORLD_VECTOR2,
      },
      required: ['dimensions', 'space', 'position', 'rotationRadians', 'scale'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimensions: { const: '3d' },
        space: { enum: ['local', 'world'] },
        position: WORLD_VECTOR3,
        rotation: {
          type: 'object',
          additionalProperties: false,
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
            w: { type: 'number' },
          },
          required: ['x', 'y', 'z', 'w'],
        },
        scale: WORLD_VECTOR3,
      },
      required: ['dimensions', 'space', 'position', 'rotation', 'scale'],
    },
  ],
} as const
const WORLD_GEOMETRY = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { const: 'rectangle' }, size: WORLD_VECTOR2 },
      required: ['kind', 'size'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { const: 'circle' }, radius: { type: 'number' } },
      required: ['kind', 'radius'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { const: 'capsule-2d' },
        radius: { type: 'number' },
        length: { type: 'number' },
      },
      required: ['kind', 'radius', 'length'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { const: 'box' }, size: WORLD_VECTOR3 },
      required: ['kind', 'size'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { const: 'sphere' }, radius: { type: 'number' } },
      required: ['kind', 'radius'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { const: 'capsule-3d' },
        radius: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['kind', 'radius', 'height'],
    },
  ],
} as const

export type WorldSceneRelationshipCardinality =
  | 'exactly-one'
  | 'zero-or-one'
  | 'at-least-one'
  | 'volume-exactly-one-otherwise-zero'
  | 'triggered-exactly-one-otherwise-zero'

export type WorldSceneRelationshipRole = Readonly<{
  targetKinds: readonly string[]
  cardinality: WorldSceneRelationshipCardinality
}>

export type WorldCoordinateConvention =
  | Readonly<{
      dimensions: '2d'
      xDirection: 'left' | 'right'
      yDirection: 'up' | 'down'
      distanceUnit: 'pixel' | 'centimeter' | 'meter'
    }>
  | Readonly<{
      dimensions: '3d'
      handedness: 'left' | 'right'
      upAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
      forwardAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
      distanceUnit: 'centimeter' | 'meter'
    }>

export type WorldTransformValue =
  | Readonly<{
      dimensions: '2d'
      space: 'local' | 'world'
      position: Readonly<{ x: number; y: number }>
      rotationRadians: number
      scale: Readonly<{ x: number; y: number }>
    }>
  | Readonly<{
      dimensions: '3d'
      space: 'local' | 'world'
      position: Readonly<{ x: number; y: number; z: number }>
      rotation: Readonly<{ x: number; y: number; z: number; w: number }>
      scale: Readonly<{ x: number; y: number; z: number }>
    }>

export type WorldZoneGeometry =
  | Readonly<{ kind: 'rectangle'; size: Readonly<{ x: number; y: number }> }>
  | Readonly<{ kind: 'circle'; radius: number }>
  | Readonly<{ kind: 'capsule-2d'; radius: number; length: number }>
  | Readonly<{
      kind: 'box'
      size: Readonly<{ x: number; y: number; z: number }>
    }>
  | Readonly<{ kind: 'sphere'; radius: number }>
  | Readonly<{ kind: 'capsule-3d'; radius: number; height: number }>

const role = (
  targetKinds: readonly string[],
  cardinality: WorldSceneRelationshipCardinality,
): WorldSceneRelationshipRole =>
  Object.freeze({
    targetKinds: Object.freeze([...targetKinds]),
    cardinality,
  })

/** The sole World/Scene authority for kinds, values, targets, and cardinality. */
export const WORLD_SCENE_DOMAIN_MANIFEST: Readonly<
  Record<
    string,
    Readonly<{
      valueJsonSchema: Readonly<Record<string, unknown>>
      relationships: Readonly<Record<string, WorldSceneRelationshipRole>>
      references?: Readonly<{
        targetKinds: readonly string[]
        unique: boolean
        sorted: boolean
        minTraversalLength: number
        requireAllReferences: boolean
      }>
    }>
  >
> = Object.freeze({
  'world-scene.scene': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('scene label'),
      coordinateConvention: WORLD_COORDINATE_CONVENTION,
    }),
    relationships: Object.freeze({
      root: role(['world-scene.node'], 'exactly-one'),
    }),
  }),
  'world-scene.node': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('scene node label'),
      nodeType: projectionEnum(
        ['container', 'anchor', 'volume', 'visual'],
        'scene node type',
      ),
      transform: WORLD_TRANSFORM,
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
      parent: role(['world-scene.node'], 'zero-or-one'),
      zone: role(['world-scene.zone'], 'volume-exactly-one-otherwise-zero'),
    }),
  }),
  'world-scene.zone': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('zone label'),
      shape: WORLD_GEOMETRY,
      transform: WORLD_TRANSFORM,
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
    }),
  }),
  'world-scene.entity-instance': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('entity instance label'),
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
      entity: role(['gameplay.entity'], 'exactly-one'),
      location: role(['world-scene.node'], 'exactly-one'),
      zone: role(['world-scene.zone'], 'zero-or-one'),
    }),
  }),
  'world-scene.route': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('route label'),
      closed: projectionBoolean('whether route closes'),
      waypointReferenceIndexes: projectionArray(
        projectionInteger('waypoint reference index', 0),
        'ordered waypoint reference indexes',
      ),
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
    }),
    references: Object.freeze({
      targetKinds: Object.freeze(['world-scene.node']),
      unique: true,
      sorted: true,
      minTraversalLength: 2,
      requireAllReferences: true,
    }),
  }),
  'world-scene.spawn': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('spawn label'),
      quantity: projectionInteger('positive spawn quantity', 1),
      policy: projectionEnum(['once', 'wave', 'repeat'], 'spawn policy'),
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
      location: role(['world-scene.node'], 'exactly-one'),
      entity: role(['gameplay.entity'], 'exactly-one'),
    }),
  }),
  'world-scene.encounter': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('encounter label'),
      mode: projectionEnum(
        ['triggered', 'patrol', 'scripted'],
        'encounter mode',
      ),
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
      zone: role(['world-scene.zone'], 'exactly-one'),
      spawn: role(['world-scene.spawn'], 'at-least-one'),
      'triggered-by': role(
        ['gameplay.event'],
        'triggered-exactly-one-otherwise-zero',
      ),
    }),
  }),
  'world-scene.checkpoint': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('checkpoint label'),
      ordinal: projectionInteger('checkpoint ordinal', 0),
      resetPolicy: projectionEnum(
        ['restart', 'last-checkpoint', 'manual'],
        'checkpoint reset policy',
      ),
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
      location: role(['world-scene.node'], 'exactly-one'),
      'respawn-state': role(['gameplay.state'], 'exactly-one'),
    }),
  }),
  'world-scene.camera-region': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('camera region label'),
      priority: projectionFiniteNumber('camera priority'),
      blendIn: projectionFiniteNumber('camera blend-in duration'),
      blendOut: projectionFiniteNumber('camera blend-out duration'),
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
      zone: role(['world-scene.zone'], 'exactly-one'),
      anchor: role(['world-scene.node'], 'exactly-one'),
    }),
  }),
  'world-scene.objective-placement': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('objective placement label'),
    }),
    relationships: Object.freeze({
      scene: role(['world-scene.scene'], 'exactly-one'),
      objective: role(['gameplay.objective'], 'exactly-one'),
      location: role(['world-scene.node'], 'exactly-one'),
      zone: role(['world-scene.zone'], 'zero-or-one'),
    }),
  }),
})

type RecordValue = Record<string, unknown>
type ParsedNode = GameIrNode & { value: Readonly<Record<string, unknown>> }
const NODE_KINDS = new Set(Object.keys(WORLD_SCENE_DOMAIN_MANIFEST))
const NODE_TYPES = new Set(['container', 'anchor', 'volume', 'visual'])
const SPAWN_POLICIES = new Set(['once', 'wave', 'repeat'])
const ENCOUNTER_MODES = new Set(['triggered', 'patrol', 'scripted'])
const RESET_POLICIES = new Set(['restart', 'last-checkpoint', 'manual'])
const AXES = new Set(['+x', '-x', '+y', '-y', '+z', '-z'])
const DIMENSION_2D_GEOMETRY = new Set(['rectangle', 'circle', 'capsule-2d'])

function manifestTargetKinds(): ReadonlySet<string> {
  const targetKinds = new Set<string>()
  for (const descriptor of Object.values(WORLD_SCENE_DOMAIN_MANIFEST)) {
    for (const relationship of Object.values(descriptor.relationships))
      relationship.targetKinds.forEach(kind => targetKinds.add(kind))
    descriptor.references?.targetKinds.forEach(kind => targetKinds.add(kind))
  }
  return targetKinds
}

function manifestExternalTargetKinds(): ReadonlySet<string> {
  return new Set(
    [...manifestTargetKinds()].filter(kind => !NODE_KINDS.has(kind)),
  )
}

function fail(message: string): never {
  throw new Error(`invalid World/Scene module: ${message}`)
}
function isRecord(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function exactKeys(
  value: RecordValue,
  expected: readonly string[],
  label: string,
): void {
  const ownKeys = Reflect.ownKeys(value)
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail(`${label} has an unknown symbol key`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    )
      fail(`${label} has a non-JSON property`)
  }
  const actual = (ownKeys as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail(`${label} must be non-empty text`)
  return value
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(`${label} must be finite`)
  return value
}
function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    fail(`${label} must be a safe integer`)
  return value
}
function positiveSafeInteger(value: unknown, label: string): number {
  const parsed = safeInteger(value, label)
  if (parsed <= 0) fail(`${label} must be positive`)
  return parsed
}
function positiveFinite(value: unknown, label: string): number {
  const parsed = finite(value, label)
  if (parsed <= 0) fail(`${label} must be positive`)
  return parsed
}
function nonNegativeFinite(value: unknown, label: string): number {
  const parsed = finite(value, label)
  if (parsed < 0) fail(`${label} must be non-negative`)
  return parsed
}
function label(value: RecordValue, nodeId: string): string {
  return text(value.label, `node ${nodeId} label`)
}
function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson)
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]),
    )
  return value
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as RecordValue)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function parseCoordinateConvention(value: unknown): WorldCoordinateConvention {
  if (!isRecord(value)) fail('coordinateConvention must be an object')
  if (value.dimensions === '2d') {
    exactKeys(
      value,
      ['dimensions', 'xDirection', 'yDirection', 'distanceUnit'],
      'coordinateConvention',
    )
    if (!['left', 'right'].includes(String(value.xDirection)))
      fail('coordinateConvention xDirection is invalid')
    if (!['up', 'down'].includes(String(value.yDirection)))
      fail('coordinateConvention yDirection is invalid')
    if (!['pixel', 'centimeter', 'meter'].includes(String(value.distanceUnit)))
      fail('coordinateConvention distanceUnit is invalid')
    return {
      dimensions: '2d',
      xDirection: value.xDirection as 'left' | 'right',
      yDirection: value.yDirection as 'up' | 'down',
      distanceUnit: value.distanceUnit as 'pixel' | 'centimeter' | 'meter',
    }
  }
  if (value.dimensions !== '3d') fail('coordinateConvention dimensions invalid')
  exactKeys(
    value,
    ['dimensions', 'handedness', 'upAxis', 'forwardAxis', 'distanceUnit'],
    'coordinateConvention',
  )
  if (!['left', 'right'].includes(String(value.handedness)))
    fail('coordinateConvention handedness is invalid')
  const upAxis = value.upAxis
  const forwardAxis = value.forwardAxis
  if (typeof upAxis !== 'string' || !AXES.has(upAxis))
    fail('coordinateConvention upAxis is invalid')
  if (typeof forwardAxis !== 'string' || !AXES.has(forwardAxis))
    fail('coordinateConvention forwardAxis is invalid')
  if (upAxis.slice(1) === forwardAxis.slice(1))
    fail('coordinateConvention axes must be distinct')
  if (!['centimeter', 'meter'].includes(String(value.distanceUnit)))
    fail('coordinateConvention distanceUnit is invalid')
  return {
    dimensions: '3d',
    handedness: value.handedness as 'left' | 'right',
    upAxis: upAxis as '+x' | '-x' | '+y' | '-y' | '+z' | '-z',
    forwardAxis: forwardAxis as '+x' | '-x' | '+y' | '-y' | '+z' | '-z',
    distanceUnit: value.distanceUnit as 'centimeter' | 'meter',
  }
}
function vector(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, number> {
  if (!isRecord(value)) fail(`${label} must be an object`)
  exactKeys(value, keys, label)
  return Object.fromEntries(
    keys.map(key => [key, finite(value[key], `${label}.${key}`)]),
  )
}
function parseTransform(value: unknown, label: string): WorldTransformValue {
  if (!isRecord(value)) fail(`${label} must be an object`)
  if (value.dimensions === '2d') {
    exactKeys(
      value,
      ['dimensions', 'space', 'position', 'rotationRadians', 'scale'],
      label,
    )
    if (!['local', 'world'].includes(String(value.space)))
      fail(`${label} space is invalid`)
    const position = vector(value.position, ['x', 'y'], `${label}.position`)
    const scale = vector(value.scale, ['x', 'y'], `${label}.scale`)
    for (const component of Object.values(scale))
      positiveFinite(component, `${label}.scale`)
    return {
      dimensions: '2d',
      space: value.space as 'local' | 'world',
      position: position as { x: number; y: number },
      rotationRadians: finite(
        value.rotationRadians,
        `${label}.rotationRadians`,
      ),
      scale: scale as { x: number; y: number },
    }
  }
  if (value.dimensions !== '3d') fail(`${label} dimensions is invalid`)
  exactKeys(
    value,
    ['dimensions', 'space', 'position', 'rotation', 'scale'],
    label,
  )
  if (!['local', 'world'].includes(String(value.space)))
    fail(`${label} space is invalid`)
  const position = vector(value.position, ['x', 'y', 'z'], `${label}.position`)
  const rotation = vector(
    value.rotation,
    ['x', 'y', 'z', 'w'],
    `${label}.rotation`,
  )
  const scale = vector(value.scale, ['x', 'y', 'z'], `${label}.scale`)
  for (const component of Object.values(scale))
    positiveFinite(component, `${label}.scale`)
  const norm = Object.values(rotation).reduce(
    (sum, component) => sum + component * component,
    0,
  )
  if (!Number.isFinite(norm) || norm <= 0)
    fail(`${label}.rotation quaternion must be non-zero`)
  return {
    dimensions: '3d',
    space: value.space as 'local' | 'world',
    position: position as { x: number; y: number; z: number },
    rotation: rotation as { x: number; y: number; z: number; w: number },
    scale: scale as { x: number; y: number; z: number },
  }
}
function parseGeometry(value: unknown, label: string): WorldZoneGeometry {
  if (!isRecord(value) || typeof value.kind !== 'string')
    fail(`${label} must declare a geometry kind`)
  if (value.kind === 'rectangle') {
    exactKeys(value, ['kind', 'size'], label)
    const size = vector(value.size, ['x', 'y'], `${label}.size`)
    for (const component of Object.values(size))
      positiveFinite(component, `${label}.size`)
    return { kind: 'rectangle', size: size as { x: number; y: number } }
  }
  if (value.kind === 'circle') {
    exactKeys(value, ['kind', 'radius'], label)
    return {
      kind: 'circle',
      radius: positiveFinite(value.radius, `${label}.radius`),
    }
  }
  if (value.kind === 'capsule-2d') {
    exactKeys(value, ['kind', 'radius', 'length'], label)
    return {
      kind: 'capsule-2d',
      radius: positiveFinite(value.radius, `${label}.radius`),
      length: positiveFinite(value.length, `${label}.length`),
    }
  }
  if (value.kind === 'box') {
    exactKeys(value, ['kind', 'size'], label)
    const size = vector(value.size, ['x', 'y', 'z'], `${label}.size`)
    for (const component of Object.values(size))
      positiveFinite(component, `${label}.size`)
    return { kind: 'box', size: size as { x: number; y: number; z: number } }
  }
  if (value.kind === 'sphere') {
    exactKeys(value, ['kind', 'radius'], label)
    return {
      kind: 'sphere',
      radius: positiveFinite(value.radius, `${label}.radius`),
    }
  }
  if (value.kind === 'capsule-3d') {
    exactKeys(value, ['kind', 'radius', 'height'], label)
    return {
      kind: 'capsule-3d',
      radius: positiveFinite(value.radius, `${label}.radius`),
      height: positiveFinite(value.height, `${label}.height`),
    }
  }
  fail(`${label} has an unknown geometry kind`)
}
function parseValue(node: GameIrNode): Readonly<Record<string, unknown>> {
  if (!isRecord(node.value)) fail(`node ${node.id} value must be an object`)
  const descriptor = WORLD_SCENE_DOMAIN_MANIFEST[node.kind]
  exactKeys(
    node.value,
    projectionValueRequiredFields(descriptor.valueJsonSchema),
    `node ${node.id} value`,
  )
  if (node.kind === 'world-scene.scene')
    return {
      label: label(node.value, node.id),
      coordinateConvention: parseCoordinateConvention(
        node.value.coordinateConvention,
      ),
    }
  if (node.kind === 'world-scene.node') {
    if (
      typeof node.value.nodeType !== 'string' ||
      !NODE_TYPES.has(node.value.nodeType)
    )
      fail(`node ${node.id} nodeType is invalid`)
    return {
      label: label(node.value, node.id),
      nodeType: node.value.nodeType,
      transform: parseTransform(
        node.value.transform,
        `node ${node.id} transform`,
      ),
    }
  }
  if (node.kind === 'world-scene.zone')
    return {
      label: label(node.value, node.id),
      shape: parseGeometry(node.value.shape, `node ${node.id} shape`),
      transform: parseTransform(
        node.value.transform,
        `node ${node.id} transform`,
      ),
    }
  if (node.kind === 'world-scene.entity-instance')
    return { label: label(node.value, node.id) }
  if (node.kind === 'world-scene.route') {
    if (typeof node.value.closed !== 'boolean')
      fail(`node ${node.id} closed is invalid`)
    if (!Array.isArray(node.value.waypointReferenceIndexes))
      fail(`node ${node.id} waypointReferenceIndexes must be an array`)
    return {
      label: label(node.value, node.id),
      closed: node.value.closed,
      waypointReferenceIndexes: node.value.waypointReferenceIndexes.map(
        (entry, index) =>
          safeInteger(
            entry,
            `node ${node.id} waypointReferenceIndexes[${index}]`,
          ),
      ),
    }
  }
  if (node.kind === 'world-scene.spawn') {
    if (
      typeof node.value.policy !== 'string' ||
      !SPAWN_POLICIES.has(node.value.policy)
    )
      fail(`node ${node.id} policy is invalid`)
    return {
      label: label(node.value, node.id),
      quantity: positiveSafeInteger(
        node.value.quantity,
        `node ${node.id} quantity`,
      ),
      policy: node.value.policy,
    }
  }
  if (node.kind === 'world-scene.encounter') {
    if (
      typeof node.value.mode !== 'string' ||
      !ENCOUNTER_MODES.has(node.value.mode)
    )
      fail(`node ${node.id} mode is invalid`)
    return { label: label(node.value, node.id), mode: node.value.mode }
  }
  if (node.kind === 'world-scene.checkpoint') {
    if (
      typeof node.value.resetPolicy !== 'string' ||
      !RESET_POLICIES.has(node.value.resetPolicy)
    )
      fail(`node ${node.id} resetPolicy is invalid`)
    const ordinal = safeInteger(node.value.ordinal, `node ${node.id} ordinal`)
    if (ordinal < 0) fail(`node ${node.id} ordinal must be non-negative`)
    return {
      label: label(node.value, node.id),
      ordinal,
      resetPolicy: node.value.resetPolicy,
    }
  }
  if (node.kind === 'world-scene.camera-region')
    return {
      label: label(node.value, node.id),
      priority: safeInteger(node.value.priority, `node ${node.id} priority`),
      blendIn: nonNegativeFinite(node.value.blendIn, `node ${node.id} blendIn`),
      blendOut: nonNegativeFinite(
        node.value.blendOut,
        `node ${node.id} blendOut`,
      ),
    }
  if (node.kind === 'world-scene.objective-placement')
    return { label: label(node.value, node.id) }
  fail(`node ${node.id} has an unknown kind`)
}
function assertNoEmbeddedTargetIds(
  value: unknown,
  targetIds: ReadonlySet<string>,
  label: string,
): void {
  if (typeof value === 'string') {
    if (targetIds.has(value)) fail(`${label} embeds target ID in a value`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoEmbeddedTargetIds(entry, targetIds, `${label}[${index}]`),
    )
    return
  }
  if (isRecord(value))
    for (const [key, entry] of Object.entries(value))
      assertNoEmbeddedTargetIds(entry, targetIds, `${label}.${key}`)
}
function targetMap(
  nodes: readonly GameIrNode[],
  externalTargets: ReadonlyMap<string, GameIrNode> | undefined,
): Map<string, GameIrNode> {
  const targets = new Map<string, GameIrNode>()
  for (const node of nodes) {
    if (targets.has(node.id)) fail(`duplicate node ID ${node.id}`)
    targets.set(node.id, node)
  }
  if (externalTargets)
    for (const [id, node] of externalTargets) {
      if (!isRecord(node) || id !== node.id)
        fail(`external target key does not match node ${id}`)
      if (typeof node.kind !== 'string')
        fail(`external target ${id} kind must be text`)
      if (NODE_KINDS.has(node.kind))
        fail(`external target ${id} cannot supply a local World kind`)
      if (!manifestExternalTargetKinds().has(node.kind))
        fail(`external target ${id} kind is forbidden by the World manifest`)
      if (targets.has(id)) fail(`duplicate node ID ${id}`)
      targets.set(id, node as GameIrNode)
    }
  return targets
}
function validateReferences(
  node: GameIrNode,
  targets: ReadonlyMap<string, GameIrNode>,
): void {
  const metadata = WORLD_SCENE_DOMAIN_MANIFEST[node.kind].references
  if (!metadata && node.references.length > 0)
    fail(`node ${node.id} has unsupported references`)
  const seen = new Set<string>()
  let previous: string | undefined
  for (const reference of node.references) {
    const target = targets.get(reference.targetId)
    if (!target)
      fail(
        `node ${node.id} reference targets unknown node ${reference.targetId}`,
      )
    if (target.kind !== reference.targetType)
      fail(
        `node ${node.id} reference target kind does not match ${reference.targetId}`,
      )
    if (!metadata?.targetKinds.includes(reference.targetType))
      fail(`node ${node.id} reference target kind is not admitted`)
    const key = `${reference.targetId}\0${reference.targetType}`
    if (metadata.unique && seen.has(key))
      fail(`node ${node.id} references must be unique`)
    if (
      metadata.sorted &&
      previous !== undefined &&
      compareCodeUnits(previous, key) >= 0
    )
      fail(`node ${node.id} references must be sorted`)
    seen.add(key)
    previous = key
  }
  for (const edge of node.edges) {
    const target = targets.get(edge.targetId)
    if (!target)
      fail(`node ${node.id} edge targets unknown node ${edge.targetId}`)
    if (target.kind !== edge.targetType)
      fail(`node ${node.id} edge target kind does not match ${edge.targetId}`)
  }
}
function effectiveCardinality(
  node: GameIrNode,
  rule: WorldSceneRelationshipRole,
  value: Readonly<Record<string, unknown>>,
): WorldSceneRelationshipCardinality {
  if (rule.cardinality === 'volume-exactly-one-otherwise-zero')
    return value.nodeType === 'volume' ? 'exactly-one' : 'zero-or-one'
  if (rule.cardinality === 'triggered-exactly-one-otherwise-zero')
    return value.mode === 'triggered' ? 'exactly-one' : 'zero-or-one'
  return rule.cardinality
}
function validateRoles(
  node: GameIrNode,
  value: Readonly<Record<string, unknown>>,
  targets: ReadonlyMap<string, GameIrNode>,
): void {
  const manifest = WORLD_SCENE_DOMAIN_MANIFEST[node.kind]
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const edge of node.edges) {
    const rule = manifest.relationships[edge.type]
    if (!rule)
      fail(`node ${node.id} has unknown relationship role ${edge.type}`)
    if (!rule.targetKinds.includes(edge.targetType))
      fail(`node ${node.id} role ${edge.type} has wrong target kind`)
    const key = `${edge.type}\0${edge.targetId}\0${edge.targetType}`
    if (seen.has(key)) fail(`node ${node.id} has duplicate relationship edge`)
    seen.add(key)
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1)
    if (!targets.has(edge.targetId))
      fail(`node ${node.id} role target is invalid`)
  }
  for (const [name, rule] of Object.entries(manifest.relationships)) {
    const count = counts.get(name) ?? 0
    const cardinality = effectiveCardinality(node, rule, value)
    if (
      rule.cardinality === 'volume-exactly-one-otherwise-zero' &&
      value.nodeType !== 'volume' &&
      count !== 0
    )
      fail(
        `node ${node.id} relationship ${name} must be absent for non-volume nodes`,
      )
    if (
      rule.cardinality === 'triggered-exactly-one-otherwise-zero' &&
      value.mode !== 'triggered' &&
      count !== 0
    )
      fail(
        `node ${node.id} relationship ${name} must be absent for non-triggered encounters`,
      )
    if (cardinality === 'exactly-one' && count !== 1)
      fail(`node ${node.id} relationship ${name} must occur exactly once`)
    if (cardinality === 'zero-or-one' && count > 1)
      fail(`node ${node.id} relationship ${name} may occur at most once`)
    if (cardinality === 'at-least-one' && count < 1)
      fail(`node ${node.id} relationship ${name} must occur at least once`)
  }
}
function sceneId(node: GameIrNode): string {
  const edge = node.edges.find(candidate => candidate.type === 'scene')
  if (!edge) fail(`node ${node.id} is missing scene membership`)
  return edge.targetId
}
function validateGraph(nodes: readonly ParsedNode[]): void {
  const local = new Map(nodes.map(node => [node.id, node]))
  const scenes = nodes.filter(node => node.kind === 'world-scene.scene')
  if (scenes.length === 0)
    fail('World/Scene module must declare at least one scene')
  const membersByScene = new Map<string, ParsedNode[]>()
  for (const node of nodes.filter(
    candidate => candidate.kind !== 'world-scene.scene',
  )) {
    const id = sceneId(node)
    const scene = local.get(id)
    if (!scene || scene.kind !== 'world-scene.scene')
      fail(`node ${node.id} scene membership is invalid`)
    const members = membersByScene.get(id) ?? []
    members.push(node)
    membersByScene.set(id, members)
  }
  for (const scene of scenes) {
    const rootEdge = scene.edges.find(edge => edge.type === 'root')
    const root = rootEdge ? local.get(rootEdge.targetId) : undefined
    if (!root || root.kind !== 'world-scene.node')
      fail(`scene ${scene.id} root is invalid`)
    const members = membersByScene.get(scene.id) ?? []
    const sceneNodes = members.filter(node => node.kind === 'world-scene.node')
    if (!sceneNodes.includes(root))
      fail(`scene ${scene.id} root is cross-scene`)
    const roots = sceneNodes.filter(
      node => !node.edges.some(edge => edge.type === 'parent'),
    )
    if (roots.length !== 1 || roots[0]!.id !== root.id)
      fail(`scene ${scene.id} must have exactly one root node`)
    const convention = scene.value
      .coordinateConvention as WorldCoordinateConvention
    if ((root.value.transform as WorldTransformValue).space !== 'world')
      fail(`scene ${scene.id} root transform must use world space`)
    const ordinals = new Set<number>()
    for (const node of members) {
      if (
        node.kind === 'world-scene.node' ||
        node.kind === 'world-scene.zone'
      ) {
        const transform = node.value.transform as WorldTransformValue
        if (transform.dimensions !== convention.dimensions)
          fail(`node ${node.id} transform dimensions do not match scene`)
      }
      if (node.kind === 'world-scene.zone') {
        const geometry = node.value.shape as WorldZoneGeometry
        const geometryIs2d = DIMENSION_2D_GEOMETRY.has(geometry.kind)
        if (geometryIs2d !== (convention.dimensions === '2d'))
          fail(`zone ${node.id} geometry dimensions do not match scene`)
      }
      if (node.kind === 'world-scene.camera-region') {
        const anchor = node.edges.find(edge => edge.type === 'anchor')
        const target = anchor ? local.get(anchor.targetId) : undefined
        if (
          !target ||
          target.kind !== 'world-scene.node' ||
          target.value.nodeType !== 'anchor'
        )
          fail(`camera region ${node.id} anchor must be an anchor node`)
      }
      if (node.kind === 'world-scene.checkpoint') {
        const ordinal = node.value.ordinal as number
        if (ordinals.has(ordinal))
          fail(`scene ${scene.id} has duplicate checkpoint ordinal`)
        ordinals.add(ordinal)
      }
    }
    for (const node of sceneNodes) {
      const parentEdge = node.edges.find(edge => edge.type === 'parent')
      if (!parentEdge) continue
      const parent = local.get(parentEdge.targetId)
      if (
        !parent ||
        parent.kind !== 'world-scene.node' ||
        sceneId(parent) !== scene.id
      )
        fail(`node ${node.id} parent is cross-scene or invalid`)
      const visited = new Set([node.id])
      let cursor = parent
      while (cursor.id !== root.id) {
        if (visited.has(cursor.id))
          fail(`scene ${scene.id} parent hierarchy contains a cycle`)
        visited.add(cursor.id)
        const next = cursor.edges.find(edge => edge.type === 'parent')
        if (!next) fail(`node ${node.id} parent hierarchy does not reach root`)
        const nextNode = local.get(next.targetId)
        if (
          !nextNode ||
          nextNode.kind !== 'world-scene.node' ||
          sceneId(nextNode) !== scene.id
        )
          fail(`node ${node.id} parent hierarchy leaves scene`)
        cursor = nextNode
      }
    }
  }
  for (const node of nodes) {
    const referenceMetadata = WORLD_SCENE_DOMAIN_MANIFEST[node.kind].references
    if (referenceMetadata) {
      const id = sceneId(node)
      const indexes = node.value.waypointReferenceIndexes as readonly number[]
      const refs = node.references
      if (indexes.length < referenceMetadata.minTraversalLength)
        fail(
          `node ${node.id} must have at least ${referenceMetadata.minTraversalLength} waypoints`,
        )
      if (
        referenceMetadata.requireAllReferences &&
        new Set(indexes).size !== refs.length
      )
        fail(`node ${node.id} must use every declared reference`)
      for (const index of indexes) {
        if (index < 0 || index >= refs.length)
          fail(`route ${node.id} waypoint index is out of range`)
        const target = nodes.find(
          candidate => candidate.id === refs[index]!.targetId,
        )
        if (!target || sceneId(target) !== id)
          fail(`route ${node.id} waypoint leaves its scene`)
      }
    }
    if (node.kind === 'world-scene.encounter') {
      const spawns = node.edges
        .filter(edge => edge.type === 'spawn')
        .map(edge => edge.targetId)
      if (new Set(spawns).size !== spawns.length)
        fail(`encounter ${node.id} has duplicate spawns`)
    }
    if (node.kind !== 'world-scene.scene') {
      const ownerScene = sceneId(node)
      for (const edge of node.edges) {
        if (
          edge.targetType === 'world-scene.scene' ||
          !NODE_KINDS.has(edge.targetType)
        )
          continue
        const target = local.get(edge.targetId)
        if (target && sceneId(target) !== ownerScene)
          fail(`node ${node.id} has a cross-scene relationship`)
      }
    }
  }
}

export function parseWorldSceneModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate {
  if (!isRecord(module)) fail('module must be an object')
  exactKeys(module, ['moduleId', 'nodes'], 'module')
  if (module.moduleId !== 'world-scene') fail('module ID must be world-scene')
  if (!Array.isArray(module.nodes)) fail('module nodes must be an array')
  const targets = targetMap(module.nodes, externalTargets)
  const parsed: ParsedNode[] = []
  for (let index = 0; index < module.nodes.length; index += 1) {
    const node = module.nodes[index]!
    if (!isRecord(node)) fail(`node ${index} must be an object`)
    const idDescriptor = Object.getOwnPropertyDescriptor(node, 'id')
    const nodeId =
      idDescriptor && 'value' in idDescriptor ? idDescriptor.value : undefined
    if (typeof nodeId !== 'string' || nodeId.length === 0)
      fail(`node ${index} has an invalid ID`)
    exactKeys(
      node,
      [
        'id',
        'kind',
        'producerMode',
        'value',
        'references',
        'edges',
        'bindings',
      ],
      `node ${nodeId}`,
    )
    const admittedNode = node as unknown as GameIrNode
    if (
      typeof admittedNode.kind !== 'string' ||
      !NODE_KINDS.has(admittedNode.kind)
    )
      fail(`node ${admittedNode.id} has an unknown kind`)
    if (admittedNode.producerMode !== 'semantic')
      fail(`node ${admittedNode.id} producerMode must be semantic`)
    if (
      !Array.isArray(admittedNode.references) ||
      !Array.isArray(admittedNode.edges)
    )
      fail(`node ${admittedNode.id} references and edges must be arrays`)
    validateReferences(admittedNode, targets)
    const parsedValue = parseValue(admittedNode)
    assertNoEmbeddedTargetIds(
      parsedValue,
      new Set(targets.keys()),
      `node ${admittedNode.id} value`,
    )
    validateRoles(admittedNode, parsedValue, targets)
    parsed.push({
      ...admittedNode,
      value: parsedValue,
      references: admittedNode.references.map(reference => ({ ...reference })),
      edges: admittedNode.edges.map(edge => ({ ...edge })),
      bindings: cloneJson(admittedNode.bindings) as GameIrNode['bindings'],
    })
  }
  for (let index = 1; index < parsed.length; index += 1)
    if (compareCodeUnits(parsed[index - 1]!.id, parsed[index]!.id) >= 0)
      fail('node IDs must be unique and sorted')
  validateGraph(parsed)
  return deepFreeze({ moduleId: 'world-scene', nodes: parsed })
}
