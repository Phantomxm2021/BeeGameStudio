import {
  compareCodeUnits,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'
import {
  projectionBoolean,
  projectionEnum,
  projectionFiniteNumber,
  projectionText,
  projectionValueFields,
  projectionValueOptionalFields,
  projectionValueSchema,
} from './projection-schema'

const PRESENTATION_TRIGGER = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      enum: [
        'automatic',
        'event',
        'action',
        'state',
        'world-scene',
        'camera-region',
      ],
    },
  },
  required: ['kind'],
} as const
const PRESENTATION_REQUIREMENTS = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      requirementId: {
        type: 'string',
        minLength: 1,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
      },
      kind: { enum: ['ui', 'animation', 'vfx', 'audio', 'music'] },
      runtimeRole: {
        enum: ['screen', 'clip', 'effect', 'cue', 'voice', 'music'],
      },
    },
    required: ['requirementId', 'kind', 'runtimeRole'],
  },
} as const

export type PresentationRelationshipCardinality =
  | 'exactly-one'
  | 'zero-or-one'
  | 'transition-trigger-dependent'
  | 'audio-event-spatial-dependent'
export type PresentationRelationshipRole = Readonly<{
  targetKinds: readonly string[]
  cardinality: PresentationRelationshipCardinality
}>
export type PresentationRequirementPolicy = Readonly<{
  kind: 'ui' | 'animation' | 'vfx' | 'audio' | 'music'
  runtimeRoles: readonly (
    | 'screen'
    | 'clip'
    | 'effect'
    | 'cue'
    | 'voice'
    | 'music'
  )[]
}>
export type PresentationTransitionTrigger =
  | Readonly<{ kind: 'automatic' }>
  | Readonly<{ kind: 'event' }>
  | Readonly<{ kind: 'action' }>
  | Readonly<{ kind: 'state' }>
  | Readonly<{ kind: 'world-scene' }>
  | Readonly<{ kind: 'camera-region' }>
export type PresentationLogicalResourceRequirement = Readonly<{
  requirementId: string
  kind: 'ui' | 'animation' | 'vfx' | 'audio' | 'music'
  runtimeRole: 'screen' | 'clip' | 'effect' | 'cue' | 'voice' | 'music'
}>

type PresentationManifestEntry = Readonly<{
  valueJsonSchema: Readonly<Record<string, unknown>>
  requirementPolicy?: PresentationRequirementPolicy
  relationships: Readonly<Record<string, PresentationRelationshipRole>>
}>
const role = (
  targetKinds: readonly string[],
  cardinality: PresentationRelationshipCardinality,
): PresentationRelationshipRole =>
  Object.freeze({ targetKinds: Object.freeze([...targetKinds]), cardinality })
const requirement = (
  kind: PresentationRequirementPolicy['kind'],
  runtimeRoles: PresentationRequirementPolicy['runtimeRoles'],
): PresentationRequirementPolicy =>
  Object.freeze({ kind, runtimeRoles: Object.freeze([...runtimeRoles]) })

/** The sole Presentation authority for kinds, values, targets, and policy. */
export const PRESENTATION_DOMAIN_MANIFEST: Readonly<
  Record<string, PresentationManifestEntry>
> = Object.freeze({
  'presentation.ui-screen': Object.freeze({
    valueJsonSchema: projectionValueSchema(
      {
        label: projectionText('UI screen label'),
        modal: projectionBoolean('whether the screen is modal'),
        requirements: PRESENTATION_REQUIREMENTS,
      },
      ['requirements'],
    ),
    requirementPolicy: requirement('ui', ['screen']),
    relationships: Object.freeze({
      'initial-state': role(['presentation.ui-state'], 'exactly-one'),
      'driven-by': role(
        ['gameplay.state', 'gameplay.event', 'world-scene.scene'],
        'exactly-one',
      ),
    }),
  }),
  'presentation.ui-state': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('UI state label'),
      terminal: projectionBoolean('whether the UI state is terminal'),
    }),
    relationships: Object.freeze({
      screen: role(['presentation.ui-screen'], 'exactly-one'),
      'driven-by': role(
        ['gameplay.state', 'gameplay.event', 'world-scene.scene'],
        'exactly-one',
      ),
    }),
  }),
  'presentation.ui-action': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('UI action label'),
      input: projectionEnum(
        ['button', 'pointer', 'key', 'gesture', 'system'],
        'input kind',
      ),
    }),
    relationships: Object.freeze({
      screen: role(['presentation.ui-screen'], 'exactly-one'),
      invokes: role(['gameplay.action'], 'exactly-one'),
      'available-in': role(['gameplay.state'], 'zero-or-one'),
    }),
  }),
  'presentation.feedback': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('feedback label'),
      channel: projectionEnum(
        ['text', 'icon', 'meter', 'haptic', 'flash'],
        'feedback channel',
      ),
    }),
    relationships: Object.freeze({
      on: role(
        ['gameplay.event', 'gameplay.state', 'gameplay.action'],
        'exactly-one',
      ),
      screen: role(['presentation.ui-screen'], 'zero-or-one'),
    }),
  }),
  'presentation.camera-behavior': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('camera behavior label'),
      mode: projectionEnum(
        ['follow', 'fixed', 'blend', 'cut', 'shake'],
        'camera mode',
      ),
      duration: projectionFiniteNumber('camera duration'),
    }),
    relationships: Object.freeze({
      region: role(['world-scene.camera-region'], 'exactly-one'),
      on: role(
        ['gameplay.event', 'gameplay.state', 'gameplay.action'],
        'zero-or-one',
      ),
    }),
  }),
  'presentation.animation-clip': Object.freeze({
    valueJsonSchema: projectionValueSchema(
      {
        label: projectionText('animation clip label'),
        loop: projectionBoolean('whether animation loops'),
        playbackRate: projectionFiniteNumber('animation playback rate'),
        requirements: PRESENTATION_REQUIREMENTS,
      },
      ['requirements'],
    ),
    requirementPolicy: requirement('animation', ['clip']),
    relationships: Object.freeze({
      target: role(
        ['world-scene.entity-instance', 'gameplay.entity'],
        'exactly-one',
      ),
    }),
  }),
  'presentation.animation-state': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('animation state label'),
    }),
    relationships: Object.freeze({
      clip: role(['presentation.animation-clip'], 'exactly-one'),
      on: role(
        ['gameplay.event', 'gameplay.state', 'gameplay.action'],
        'exactly-one',
      ),
    }),
  }),
  'presentation.vfx-cue': Object.freeze({
    valueJsonSchema: projectionValueSchema(
      {
        label: projectionText('VFX cue label'),
        trigger: projectionEnum(
          ['instant', 'attached', 'persistent'],
          'VFX trigger',
        ),
        requirements: PRESENTATION_REQUIREMENTS,
      },
      ['requirements'],
    ),
    requirementPolicy: requirement('vfx', ['effect']),
    relationships: Object.freeze({
      on: role(
        ['gameplay.event', 'gameplay.state', 'gameplay.action'],
        'exactly-one',
      ),
      at: role(
        ['world-scene.node', 'world-scene.zone', 'world-scene.camera-region'],
        'exactly-one',
      ),
    }),
  }),
  'presentation.audio-event': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('audio event label'),
      spatial: projectionBoolean('whether audio is spatial'),
    }),
    relationships: Object.freeze({
      on: role(
        ['gameplay.event', 'gameplay.state', 'gameplay.action'],
        'exactly-one',
      ),
    }),
  }),
  'presentation.audio-cue': Object.freeze({
    valueJsonSchema: projectionValueSchema(
      {
        label: projectionText('audio cue label'),
        volume: projectionFiniteNumber('audio cue volume'),
        requirements: PRESENTATION_REQUIREMENTS,
      },
      ['requirements'],
    ),
    requirementPolicy: requirement('audio', ['cue', 'voice']),
    relationships: Object.freeze({
      event: role(['presentation.audio-event'], 'exactly-one'),
      at: role(
        [
          'world-scene.scene',
          'world-scene.node',
          'world-scene.zone',
          'world-scene.entity-instance',
          'world-scene.camera-region',
        ],
        'audio-event-spatial-dependent',
      ),
    }),
  }),
  'presentation.music-state': Object.freeze({
    valueJsonSchema: projectionValueSchema(
      {
        label: projectionText('music state label'),
        intensity: projectionFiniteNumber('music intensity'),
        requirements: PRESENTATION_REQUIREMENTS,
      },
      ['requirements'],
    ),
    requirementPolicy: requirement('music', ['music']),
    relationships: Object.freeze({
      on: role(
        ['gameplay.event', 'gameplay.state', 'gameplay.action'],
        'exactly-one',
      ),
    }),
  }),
  'presentation.transition': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('presentation transition label'),
      trigger: PRESENTATION_TRIGGER,
    }),
    relationships: Object.freeze({
      from: role(['presentation.ui-state'], 'exactly-one'),
      to: role(['presentation.ui-state'], 'exactly-one'),
      on: role(
        [
          'gameplay.event',
          'gameplay.action',
          'gameplay.state',
          'world-scene.scene',
          'world-scene.camera-region',
        ],
        'transition-trigger-dependent',
      ),
    }),
  }),
})

type RecordValue = Record<string, unknown>
type ParsedNode = GameIrNode & { value: Readonly<Record<string, unknown>> }
type KnownTarget = Pick<GameIrNode, 'id' | 'kind'> &
  Partial<Pick<GameIrNode, 'value'>>
type NodeValidationOptions = Readonly<{
  allowUnknownTargets?: boolean
  requirementIds?: Set<string>
}>
const NODE_KINDS = new Set(Object.keys(PRESENTATION_DOMAIN_MANIFEST))
const TRIGGER_KINDS = new Set([
  'automatic',
  'event',
  'action',
  'state',
  'world-scene',
  'camera-region',
])
const INPUTS = new Set(['button', 'pointer', 'key', 'gesture', 'system'])
const CHANNELS = new Set(['text', 'icon', 'meter', 'haptic', 'flash'])
const CAMERA_MODES = new Set(['follow', 'fixed', 'blend', 'cut', 'shake'])
const VFX_TRIGGERS = new Set(['instant', 'attached', 'persistent'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
function fail(message: string): never {
  throw new Error(`invalid Presentation module: ${message}`)
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
function allowedKeys(
  value: RecordValue,
  allowed: readonly string[],
  label: string,
): void {
  const permitted = new Set(allowed)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !permitted.has(key))
      fail(`${label} has unknown or missing fields`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    )
      fail(`${label} has a non-JSON property`)
  }
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail(`${label} must be non-empty text`)
  return value
}
function safeId(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SAFE_ID.test(result)) fail(`${label} is not a safe identifier`)
  return result
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(`${label} must be finite`)
  return value
}
function bounded(value: unknown, label: string): number {
  const result = finite(value, label)
  if (result < 0 || result > 1) fail(`${label} must be between zero and one`)
  return result
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
function parseTrigger(
  value: unknown,
  label: string,
): PresentationTransitionTrigger {
  if (!isRecord(value)) fail(`${label} must be an object`)
  exactKeys(value, ['kind'], label)
  if (typeof value.kind !== 'string' || !TRIGGER_KINDS.has(value.kind))
    fail(`${label} kind is invalid`)
  return { kind: value.kind as PresentationTransitionTrigger['kind'] }
}
function requirementList(
  value: unknown,
  nodeId: string,
  policy: PresentationRequirementPolicy,
  ids: Set<string>,
): readonly PresentationLogicalResourceRequirement[] {
  if (!Array.isArray(value))
    fail(`node ${nodeId} requirements must be an array`)
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.enumerable !== false
  )
    fail(`node ${nodeId} requirements has a non-JSON length property`)
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/.test(key))
      fail(`node ${nodeId} requirements has an unknown property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    )
      fail(`node ${nodeId} requirements has a non-JSON property`)
  }
  const requirements: PresentationLogicalResourceRequirement[] = []
  let previous: string | undefined
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry))
      fail(`node ${nodeId} requirement ${index} must be an object`)
    exactKeys(
      entry,
      ['requirementId', 'kind', 'runtimeRole'],
      `node ${nodeId} requirement`,
    )
    const requirementId = safeId(
      entry.requirementId,
      `node ${nodeId} requirementId`,
    )
    if (
      previous !== undefined &&
      compareCodeUnits(previous, requirementId) >= 0
    )
      fail(`node ${nodeId} requirements must be unique and sorted`)
    if (ids.has(requirementId))
      fail(`requirement ${requirementId} must be globally unique`)
    if (
      entry.kind !== policy.kind ||
      !policy.runtimeRoles.includes(entry.runtimeRole as never)
    )
      fail(`node ${nodeId} requirement policy does not match`)
    ids.add(requirementId)
    previous = requirementId
    requirements.push({
      requirementId,
      kind: policy.kind,
      runtimeRole:
        entry.runtimeRole as PresentationLogicalResourceRequirement['runtimeRole'],
    })
  }
  return requirements
}
function parseValue(
  node: GameIrNode,
  requirementIds: Set<string>,
): Readonly<Record<string, unknown>> {
  if (!isRecord(node.value)) fail(`node ${node.id} value must be an object`)
  const descriptor = PRESENTATION_DOMAIN_MANIFEST[node.kind]!
  allowedKeys(
    node.value,
    projectionValueFields(descriptor.valueJsonSchema),
    `node ${node.id} value`,
  )
  const result: RecordValue = {
    label: text(node.value.label, `node ${node.id} label`),
  }
  if (node.kind === 'presentation.ui-screen') {
    if (typeof node.value.modal !== 'boolean')
      fail(`node ${node.id} modal must be boolean`)
    result.modal = node.value.modal
  } else if (node.kind === 'presentation.ui-state') {
    if (typeof node.value.terminal !== 'boolean')
      fail(`node ${node.id} terminal must be boolean`)
    result.terminal = node.value.terminal
  } else if (node.kind === 'presentation.ui-action') {
    if (typeof node.value.input !== 'string' || !INPUTS.has(node.value.input))
      fail(`node ${node.id} input is invalid`)
    result.input = node.value.input
  } else if (node.kind === 'presentation.feedback') {
    if (
      typeof node.value.channel !== 'string' ||
      !CHANNELS.has(node.value.channel)
    )
      fail(`node ${node.id} channel is invalid`)
    result.channel = node.value.channel
  } else if (node.kind === 'presentation.camera-behavior') {
    if (
      typeof node.value.mode !== 'string' ||
      !CAMERA_MODES.has(node.value.mode)
    )
      fail(`node ${node.id} mode is invalid`)
    result.mode = node.value.mode
    const duration = finite(node.value.duration, `node ${node.id} duration`)
    if (duration < 0) fail(`node ${node.id} duration must be non-negative`)
    result.duration = duration
  } else if (node.kind === 'presentation.animation-clip') {
    if (typeof node.value.loop !== 'boolean')
      fail(`node ${node.id} loop must be boolean`)
    result.loop = node.value.loop
    const playbackRate = finite(
      node.value.playbackRate,
      `node ${node.id} playbackRate`,
    )
    if (playbackRate <= 0) fail(`node ${node.id} playbackRate must be positive`)
    result.playbackRate = playbackRate
  } else if (node.kind === 'presentation.animation-state') {
    // The manifest's exact fields intentionally leave no machine-state authority here.
  } else if (node.kind === 'presentation.vfx-cue') {
    if (
      typeof node.value.trigger !== 'string' ||
      !VFX_TRIGGERS.has(node.value.trigger)
    )
      fail(`node ${node.id} trigger is invalid`)
    result.trigger = node.value.trigger
  } else if (node.kind === 'presentation.audio-event') {
    if (typeof node.value.spatial !== 'boolean')
      fail(`node ${node.id} spatial must be boolean`)
    result.spatial = node.value.spatial
  } else if (node.kind === 'presentation.audio-cue') {
    result.volume = bounded(node.value.volume, `node ${node.id} volume`)
  } else if (node.kind === 'presentation.music-state') {
    result.intensity = bounded(
      node.value.intensity,
      `node ${node.id} intensity`,
    )
  } else if (node.kind === 'presentation.transition') {
    result.trigger = parseTrigger(node.value.trigger, `node ${node.id} trigger`)
  } else fail(`node ${node.id} has an unknown kind`)
  if (
    projectionValueOptionalFields(descriptor.valueJsonSchema).includes(
      'requirements',
    ) &&
    Object.hasOwn(node.value, 'requirements')
  ) {
    if (node.value.requirements === undefined)
      fail(`node ${node.id} requirements must be JSON`)
    result.requirements = requirementList(
      node.value.requirements,
      node.id,
      descriptor.requirementPolicy!,
      requirementIds,
    )
  }
  return result
}

/** Domain-owned intrinsic value parsing for deterministic IR admission. */
function manifestTargetKinds(): ReadonlySet<string> {
  const targetKinds = new Set<string>()
  for (const descriptor of Object.values(PRESENTATION_DOMAIN_MANIFEST))
    for (const relationship of Object.values(descriptor.relationships))
      relationship.targetKinds.forEach(kind => targetKinds.add(kind))
  return targetKinds
}
function targetMap(
  nodes: readonly GameIrNode[],
  externalTargets: ReadonlyMap<string, GameIrNode> | undefined,
): Map<string, GameIrNode> {
  const targets = new Map<string, GameIrNode>()
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node)) fail(`node ${index} must be an object`)
    const id = safeId(node.id, `node ${index} id`)
    if (targets.has(id)) fail(`duplicate node ID ${id}`)
    if (typeof node.kind !== 'string' || !NODE_KINDS.has(node.kind))
      fail(`node ${id} has an unknown kind`)
    targets.set(id, node)
  }
  const allowedExternal = manifestTargetKinds()
  for (const [id, node] of externalTargets ?? []) {
    if (!isRecord(node) || id !== node.id)
      fail(`external target key does not match node ${id}`)
    safeId(id, `external target ${id}`)
    if (typeof node.kind !== 'string')
      fail(`external target ${id} kind must be text`)
    if (NODE_KINDS.has(node.kind))
      fail(`external target ${id} cannot supply a local Presentation kind`)
    if (!allowedExternal.has(node.kind))
      fail(
        `external target ${id} kind is forbidden by the Presentation manifest`,
      )
    if (targets.has(id)) fail(`duplicate node ID ${id}`)
    targets.set(id, node)
  }
  return targets
}
function validateEdges(
  node: GameIrNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): void {
  if (!Array.isArray(node.references) || !Array.isArray(node.edges))
    fail(`node ${node.id} references and edges must be arrays`)
  if (node.references.length > 0)
    fail(`node ${node.id} does not support references`)
  const seen = new Set<string>()
  for (const [index, candidate] of node.edges.entries()) {
    if (!isRecord(candidate))
      fail(`node ${node.id} edge ${index} must be an object`)
    exactKeys(
      candidate,
      ['type', 'targetId', 'targetType'],
      `node ${node.id} edge`,
    )
    const type = text(candidate.type, `node ${node.id} edge type`)
    const targetId = safeId(candidate.targetId, `node ${node.id} edge targetId`)
    const targetType = text(
      candidate.targetType,
      `node ${node.id} edge targetType`,
    )
    const target = targets.get(targetId)
    if (!target) {
      if (options.allowUnknownTargets) continue
      fail(`node ${node.id} edge targets unknown node ${targetId}`)
    }
    if (target.kind !== targetType)
      fail(`node ${node.id} edge target kind does not match ${targetId}`)
    const key = `${type}\0${targetId}\0${targetType}`
    if (seen.has(key)) fail(`node ${node.id} has duplicate relationship edge`)
    seen.add(key)
  }
}
function edge(
  node: GameIrNode,
  type: string,
): GameIrNode['edges'][number] | undefined {
  return node.edges.find(candidate => candidate.type === type)
}
function effectiveCardinality(
  node: ParsedNode,
  name: string,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): 'exactly-one' | 'zero-or-one' | undefined {
  const cardinality =
    PRESENTATION_DOMAIN_MANIFEST[node.kind]!.relationships[name]!.cardinality
  if (cardinality === 'transition-trigger-dependent') {
    const trigger = node.value.trigger as PresentationTransitionTrigger
    return trigger.kind === 'automatic' ? 'zero-or-one' : 'exactly-one'
  }
  if (cardinality === 'audio-event-spatial-dependent') {
    const event = edge(node, 'event')
    const target = event ? targets.get(event.targetId) : undefined
    if (!target || target.kind !== 'presentation.audio-event') {
      if (options.allowUnknownTargets && !target) return undefined
      fail(`node ${node.id} event target is invalid`)
    }
    if (!target.value) {
      if (options.allowUnknownTargets) return undefined
      fail(`node ${node.id} event target has no parsed value`)
    }
    return (target.value as RecordValue).spatial === true
      ? 'exactly-one'
      : 'zero-or-one'
  }
  return cardinality
}
function triggerTargetKind(
  trigger: PresentationTransitionTrigger,
  roleRule: PresentationRelationshipRole,
): string | undefined {
  if (trigger.kind === 'world-scene')
    return roleRule.targetKinds.find(kind => kind === 'world-scene.scene')
  if (trigger.kind === 'camera-region')
    return roleRule.targetKinds.find(
      kind => kind === 'world-scene.camera-region',
    )
  return roleRule.targetKinds.find(kind => kind === `gameplay.${trigger.kind}`)
}
function validateRoles(
  node: ParsedNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): void {
  const descriptor = PRESENTATION_DOMAIN_MANIFEST[node.kind]!
  const counts = new Map<string, number>()
  for (const candidate of node.edges) {
    const rule = descriptor.relationships[candidate.type]
    if (!rule)
      fail(`node ${node.id} has unknown relationship role ${candidate.type}`)
    if (!rule.targetKinds.includes(candidate.targetType))
      fail(`node ${node.id} role ${candidate.type} has wrong target kind`)
    if (!targets.has(candidate.targetId) && !options.allowUnknownTargets)
      fail(`node ${node.id} role target is invalid`)
    counts.set(candidate.type, (counts.get(candidate.type) ?? 0) + 1)
  }
  for (const [name, rule] of Object.entries(descriptor.relationships)) {
    const count = counts.get(name) ?? 0
    const cardinality = effectiveCardinality(node, name, targets, options)
    if (cardinality === undefined) continue
    if (
      node.kind === 'presentation.transition' &&
      name === 'on' &&
      (node.value.trigger as PresentationTransitionTrigger).kind ===
        'automatic' &&
      count !== 0
    )
      fail(`node ${node.id} automatic transition must not have an on edge`)
    if (cardinality === 'exactly-one' && count !== 1)
      fail(`node ${node.id} relationship ${name} must occur exactly once`)
    if (cardinality === 'zero-or-one' && count > 1)
      fail(`node ${node.id} relationship ${name} may occur at most once`)
    if (
      node.kind === 'presentation.transition' &&
      name === 'on' &&
      count === 1
    ) {
      const trigger = node.value.trigger as PresentationTransitionTrigger
      const expected = triggerTargetKind(trigger, rule)
      if (
        trigger.kind !== 'automatic' &&
        node.edges.find(candidate => candidate.type === name)!.targetType !==
          expected
      )
        fail(`node ${node.id} transition trigger target kind does not match`)
    }
    if (
      rule.cardinality === 'audio-event-spatial-dependent' &&
      count > 0 &&
      cardinality === 'zero-or-one'
    )
      fail(`node ${node.id} non-spatial audio event must not have an at edge`)
  }
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
function validateGraph(
  nodes: readonly ParsedNode[],
  targets: ReadonlyMap<string, GameIrNode>,
): void {
  const local = new Map(nodes.map(node => [node.id, node]))
  const screens = nodes.filter(node => node.kind === 'presentation.ui-screen')
  const states = nodes.filter(node => node.kind === 'presentation.ui-state')
  const transitions = nodes.filter(
    node => node.kind === 'presentation.transition',
  )
  const statesByScreen = new Map<string, ParsedNode[]>()
  for (const state of states) {
    const screen = local.get(edge(state, 'screen')!.targetId)
    if (!screen || screen.kind !== 'presentation.ui-screen')
      fail(`state ${state.id} screen is invalid`)
    const list = statesByScreen.get(screen.id) ?? []
    list.push(state)
    statesByScreen.set(screen.id, list)
  }
  for (const screen of screens) {
    const initial = local.get(edge(screen, 'initial-state')!.targetId)
    if (!initial || initial.kind !== 'presentation.ui-state')
      fail(`screen ${screen.id} initial state is invalid`)
    if (edge(initial, 'screen')?.targetId !== screen.id)
      fail(`screen ${screen.id} initial state does not point back`)
    const reachable = new Set<string>([initial.id])
    const pending = [initial.id]
    while (pending.length > 0) {
      const current = local.get(pending.pop()!)!
      for (const transition of transitions) {
        if (edge(transition, 'from')!.targetId !== current.id) continue
        const targetId = edge(transition, 'to')!.targetId
        if (!reachable.has(targetId)) {
          reachable.add(targetId)
          pending.push(targetId)
        }
      }
    }
    for (const state of statesByScreen.get(screen.id) ?? [])
      if (!reachable.has(state.id))
        fail(`state ${state.id} is not reachable from screen ${screen.id}`)
  }
  const transitionKeys = new Set<string>()
  for (const transition of transitions) {
    const from = local.get(edge(transition, 'from')!.targetId)
    const to = local.get(edge(transition, 'to')!.targetId)
    if (!from || !to) fail(`transition ${transition.id} endpoints are invalid`)
    if (edge(from, 'screen')!.targetId !== edge(to, 'screen')!.targetId)
      fail(`transition ${transition.id} crosses screens`)
    if ((from.value as RecordValue).terminal === true)
      fail(`transition ${transition.id} leaves a terminal state`)
    const on = edge(transition, 'on')
    const trigger = (transition.value as RecordValue)
      .trigger as PresentationTransitionTrigger
    const key = `${from.id}\0${to.id}\0${on?.targetId ?? ''}\0${on?.targetType ?? ''}\0${trigger.kind}`
    if (transitionKeys.has(key))
      fail(`transition ${transition.id} duplicates an existing transition edge`)
    transitionKeys.add(key)
  }
  const audioTriggers = new Set<string>()
  for (const audioEvent of nodes.filter(
    node => node.kind === 'presentation.audio-event',
  )) {
    const trigger = edge(audioEvent, 'on')!
    if (audioTriggers.has(trigger.targetId))
      fail(`audio trigger ${trigger.targetId} is owned more than once`)
    audioTriggers.add(trigger.targetId)
  }
  for (const node of nodes) {
    if (node.kind === 'presentation.animation-state') {
      const clip = local.get(edge(node, 'clip')!.targetId)
      if (!clip || clip.kind !== 'presentation.animation-clip')
        fail(`animation state ${node.id} targets an invalid clip`)
    }
    if (node.kind === 'presentation.audio-cue') {
      const event = local.get(edge(node, 'event')!.targetId)
      if (!event || event.kind !== 'presentation.audio-event')
        fail(`audio cue ${node.id} targets an invalid event`)
    }
    if (!targets.has(node.id)) fail(`node ${node.id} is not in the target map`)
  }
}

/**
 * Parses one Presentation node through the same local semantic rules used by
 * the complete module parser. UI graph reachability stays below.
 */
export function parsePresentationProjectionNode(
  node: GameIrNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): ParsedNode {
  if (node.producerMode !== undefined && node.producerMode !== 'semantic')
    fail(`node ${node.id} must be semantic-owned`)
  validateEdges(node, targets, options)
  const parsedValue = parseValue(node, options.requirementIds ?? new Set())
  assertNoEmbeddedTargetIds(
    parsedValue,
    new Set(targets.keys()),
    `node ${node.id} value`,
  )
  const parsedNode = {
    ...node,
    value: parsedValue,
    references: [],
    edges: node.edges.map(edgeValue => ({ ...edgeValue })),
    bindings: cloneJson(node.bindings) as GameIrNode['bindings'],
  } as ParsedNode
  validateRoles(parsedNode, targets, options)
  return parsedNode
}

export function parsePresentationModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate {
  if (!isRecord(module) || module.moduleId !== 'presentation')
    fail('module ID must be presentation')
  exactKeys(module, ['moduleId', 'nodes'], 'presentation module')
  if (!Array.isArray(module.nodes)) fail('module nodes must be an array')
  const targets = targetMap(module.nodes, externalTargets)
  const requirementIds = new Set<string>()
  const parsed: ParsedNode[] = []
  for (const [index, value] of module.nodes.entries()) {
    if (isRecord(value))
      exactKeys(
        value,
        [
          'id',
          'kind',
          'producerMode',
          'value',
          'references',
          'edges',
          'bindings',
        ],
        `node ${index}`,
      )
    const node = value as GameIrNode
    if (node.producerMode !== 'semantic')
      fail(`node ${index} must be semantic-owned`)
    parsed.push(parsePresentationProjectionNode(node, targets, { requirementIds }))
  }
  for (let index = 1; index < parsed.length; index += 1)
    if (compareCodeUnits(parsed[index - 1]!.id, parsed[index]!.id) >= 0)
      fail('node IDs must be unique and sorted')
  validateGraph(parsed, targets)
  return deepFreeze({ moduleId: 'presentation', nodes: parsed })
}
