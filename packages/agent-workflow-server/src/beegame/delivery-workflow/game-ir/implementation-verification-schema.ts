import { BALANCE_DOMAIN_MANIFEST, parseBalanceModule } from './balance-schema'
import {
  GAMEPLAY_DOMAIN_MANIFEST,
  parseGameplayModule,
} from './gameplay-schema'
import {
  PRESENTATION_DOMAIN_MANIFEST,
  parsePresentationModule,
} from './presentation-schema'
import {
  RESOURCE_REALIZATION_DOMAIN_MANIFEST,
  parseResourceRealizationModule,
} from './resource-realization-schema'
import {
  WORLD_SCENE_DOMAIN_MANIFEST,
  parseWorldSceneModule,
} from './world-scene-schema'
import type { GameIrCompileRequest } from './contracts'
import {
  compareCodeUnits,
  parseGameIrCandidate,
  parseGameIrModuleSet,
  type GameIrModuleCandidate,
  type GameIrNode,
  type GameIrSourceSection,
} from './model'

const role = (
  targetKinds: readonly string[],
  cardinality: 'exactly-one' | 'at-least-one' | 'zero-or-more',
) =>
  Object.freeze({ targetKinds: Object.freeze([...targetKinds]), cardinality })
const IMPLEMENTATION_VERIFICATION_PRIOR_NODE_KINDS = Object.freeze(
  [
    ...Object.keys(GAMEPLAY_DOMAIN_MANIFEST),
    ...Object.keys(BALANCE_DOMAIN_MANIFEST),
    ...Object.keys(WORLD_SCENE_DOMAIN_MANIFEST),
    ...Object.keys(PRESENTATION_DOMAIN_MANIFEST),
    ...Object.keys(RESOURCE_REALIZATION_DOMAIN_MANIFEST),
  ].sort(compareCodeUnits),
)
const IMPLEMENTATION_VERIFICATION_UNIT_TARGET_KINDS = Object.freeze(
  ['implementation-verification.unit'].sort(compareCodeUnits),
)
const IMPLEMENTATION_VERIFICATION_CONSTRAINT_TARGET_KINDS = Object.freeze(
  [
    ...IMPLEMENTATION_VERIFICATION_PRIOR_NODE_KINDS,
    'implementation-verification.unit',
  ].sort(compareCodeUnits),
)
export const IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST = Object.freeze({
  'implementation-verification.target': Object.freeze({
    valueFields: Object.freeze([
      'label',
      'runtime',
      'platforms',
      'projectRoots',
    ]),
    relationships: Object.freeze({}),
  }),
  'implementation-verification.unit': Object.freeze({
    valueFields: Object.freeze(['label', 'responsibility', 'ownedPaths']),
    relationships: Object.freeze({
      targets: role(['implementation-verification.target'], 'exactly-one'),
      implements: role(
        IMPLEMENTATION_VERIFICATION_PRIOR_NODE_KINDS,
        'at-least-one',
      ),
      'depends-on': role(
        IMPLEMENTATION_VERIFICATION_UNIT_TARGET_KINDS,
        'zero-or-more',
      ),
    }),
  }),
  'implementation-verification.acceptance-scenario': Object.freeze({
    valueFields: Object.freeze([
      'label',
      'precondition',
      'action',
      'expectedOutcome',
    ]),
    relationships: Object.freeze({
      covers: role(
        IMPLEMENTATION_VERIFICATION_PRIOR_NODE_KINDS,
        'at-least-one',
      ),
      'owned-by': role(['implementation-verification.unit'], 'exactly-one'),
      'proved-by': role(
        ['implementation-verification.evidence-requirement'],
        'at-least-one',
      ),
    }),
  }),
  'implementation-verification.invariant': Object.freeze({
    valueFields: Object.freeze(['label', 'assertion', 'scope']),
    relationships: Object.freeze({
      constrains: role(
        IMPLEMENTATION_VERIFICATION_CONSTRAINT_TARGET_KINDS,
        'at-least-one',
      ),
      'proved-by': role(
        ['implementation-verification.evidence-requirement'],
        'at-least-one',
      ),
    }),
  }),
  'implementation-verification.evidence-requirement': Object.freeze({
    valueFields: Object.freeze(['label', 'kind', 'expected']),
    optionalValueFields: Object.freeze(['artifactPaths']),
    relationships: Object.freeze({
      'owned-by': role(['implementation-verification.unit'], 'exactly-one'),
    }),
  }),
} as const)

export type ImplementationVerificationTargetValue = Readonly<{
  label: string
  runtime: string
  platforms: readonly string[]
  projectRoots: readonly string[]
}>
export type ImplementationVerificationUnitValue = Readonly<{
  label: string
  responsibility: string
  ownedPaths: readonly string[]
}>
export type ImplementationVerificationAcceptanceScenarioValue = Readonly<{
  label: string
  precondition: string
  action: string
  expectedOutcome: string
}>
export type ImplementationVerificationInvariantValue = Readonly<{
  label: string
  assertion: string
  scope: 'runtime' | 'state' | 'numeric' | 'resource' | 'persistence'
}>
export type ImplementationVerificationEvidenceRequirementValue = Readonly<{
  label: string
  kind:
    | 'unit-test'
    | 'integration-test'
    | 'build'
    | 'runtime-observation'
    | 'visual-observation'
    | 'audio-observation'
    | 'file-inspection'
  expected: string
  artifactPaths?: readonly string[]
}>

export type ImplementationVerificationProjectionPayload =
  | Readonly<{ kind: 'implementation-verification.target'; value: ImplementationVerificationTargetValue }>
  | Readonly<{ kind: 'implementation-verification.unit'; value: ImplementationVerificationUnitValue }>
  | Readonly<{ kind: 'implementation-verification.acceptance-scenario'; value: ImplementationVerificationAcceptanceScenarioValue }>
  | Readonly<{ kind: 'implementation-verification.invariant'; value: ImplementationVerificationInvariantValue }>
  | Readonly<{ kind: 'implementation-verification.evidence-requirement'; value: ImplementationVerificationEvidenceRequirementValue }>

const PRIOR_SEQUENCE = [
  'gameplay',
  'balance',
  'world-scene',
  'presentation',
  'resource-realization',
] as const
const LOCAL_KINDS = new Set(
  Object.keys(IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST),
)
const PRIOR_KINDS = new Set(IMPLEMENTATION_VERIFICATION_PRIOR_NODE_KINDS)
const ALL_KINDS = new Set([...LOCAL_KINDS, ...PRIOR_KINDS])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const EVIDENCE_KINDS = new Set([
  'unit-test',
  'integration-test',
  'build',
  'runtime-observation',
  'visual-observation',
  'audio-observation',
  'file-inspection',
])
const SCOPES = new Set([
  'runtime',
  'state',
  'numeric',
  'resource',
  'persistence',
])
type RecordValue = Record<string, unknown>
type ParsedNode = GameIrNode & { value: RecordValue }

function fail(message: string): never {
  throw new Error(`invalid Implementation/Verification module: ${message}`)
}
function record(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}
function exact(
  value: RecordValue,
  expected: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string'))
    fail(`${label} has a symbol key`)
  const actual = (keys as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    actual.length !== wanted.length ||
    actual.some((key, i) => key !== wanted[i])
  )
    fail(`${label} has unknown or missing fields`)
  for (const key of actual) {
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
function path(value: unknown, label: string): string {
  const result = text(value, label)
  if (
    result.startsWith('/') ||
    result.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(result) ||
    result.includes('\\') ||
    result.includes('\0') ||
    result.split('/').some(part => part === '' || part === '.' || part === '..')
  )
    fail(`${label} must be a safe project-relative path`)
  return result
}
function strings(
  value: unknown,
  label: string,
  paths = false,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0)
    fail(`${label} must be a non-empty array`)
  const result = value.map((item, i) =>
    paths ? path(item, `${label}[${i}]`) : text(item, `${label}[${i}]`),
  )
  for (let i = 1; i < result.length; i++)
    if (compareCodeUnits(result[i - 1]!, result[i]!) >= 0)
      fail(`${label} must be unique and sorted`)
  return result
}
function prefix(left: string, right: string): boolean {
  const a = left.split('/')
  const b = right.split('/')
  return a.length <= b.length && a.every((part, i) => part === b[i])
}
function overlap(left: string, right: string): boolean {
  return prefix(left, right) || prefix(right, left)
}
function disjoint(paths: readonly string[], label: string): void {
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++)
      if (overlap(paths[i]!, paths[j]!)) fail(`${label} overlap`)
}
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => clone(item)) as T
  if (record(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    ) as T
  return value
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value as RecordValue)) freeze(item)
    Object.freeze(value)
  }
  return value
}
function edge(
  node: GameIrNode,
  type: string,
): readonly GameIrNode['edges'][number][] {
  return node.edges.filter(item => item.type === type)
}

function targetMap(
  moduleId: string,
  prior: ReadonlyMap<string, GameIrModuleCandidate>,
): ReadonlyMap<string, GameIrNode> {
  const allowed =
    moduleId === 'gameplay'
      ? new Set(Object.keys(BALANCE_DOMAIN_MANIFEST))
      : moduleId === 'balance'
        ? new Set(Object.keys(GAMEPLAY_DOMAIN_MANIFEST))
        : moduleId === 'world-scene'
          ? new Set(
              [
                ...Object.values(WORLD_SCENE_DOMAIN_MANIFEST).flatMap(item =>
                  Object.values(item.relationships).flatMap(r => r.targetKinds),
                ),
              ].filter(
                kind =>
                  !Object.keys(WORLD_SCENE_DOMAIN_MANIFEST).includes(kind),
              ),
            )
          : new Set(
              [
                ...Object.values(PRESENTATION_DOMAIN_MANIFEST).flatMap(item =>
                  Object.values(item.relationships).flatMap(r => r.targetKinds),
                ),
              ].filter(
                kind =>
                  !Object.keys(PRESENTATION_DOMAIN_MANIFEST).includes(kind),
              ),
            )
  const result = new Map<string, GameIrNode>()
  for (const [id, module] of prior)
    if (id !== moduleId)
      for (const node of module.nodes)
        if (allowed.has(node.kind)) result.set(node.id, node)
  return result
}

function admitPrior(
  modules: readonly GameIrModuleCandidate[],
  raw: ReadonlyMap<string, GameIrModuleCandidate>,
  request: GameIrCompileRequest,
  sections: readonly GameIrSourceSection[],
): readonly GameIrModuleCandidate[] {
  return modules.map(module => {
    const targets = targetMap(module.moduleId, raw)
    if (module.moduleId === 'gameplay')
      return parseGameplayModule(module, targets)
    if (module.moduleId === 'balance')
      return parseBalanceModule(module, targets)
    if (module.moduleId === 'world-scene')
      return parseWorldSceneModule(module, targets)
    if (module.moduleId === 'presentation')
      return parsePresentationModule(module, targets)
    return parseResourceRealizationModule(module, {
      request,
      sections,
      externalModules: modules.slice(0, 4),
    })
  })
}

function parseValue(node: GameIrNode): RecordValue {
  if (!record(node.value)) fail(`node ${node.id} value must be an object`)
  if (node.kind === 'implementation-verification.target') {
    exact(
      node.value,
      ['label', 'runtime', 'platforms', 'projectRoots'],
      `node ${node.id} value`,
    )
    const roots = strings(
      node.value.projectRoots,
      `node ${node.id} projectRoots`,
      true,
    )
    disjoint(roots, `node ${node.id} projectRoots`)
    return {
      label: text(node.value.label, 'label'),
      runtime: text(node.value.runtime, 'runtime'),
      platforms: strings(node.value.platforms, 'platforms'),
      projectRoots: roots,
    }
  }
  if (node.kind === 'implementation-verification.unit') {
    exact(
      node.value,
      ['label', 'responsibility', 'ownedPaths'],
      `node ${node.id} value`,
    )
    return {
      label: text(node.value.label, 'label'),
      responsibility: text(node.value.responsibility, 'responsibility'),
      ownedPaths: strings(node.value.ownedPaths, 'ownedPaths', true),
    }
  }
  if (node.kind === 'implementation-verification.acceptance-scenario') {
    exact(
      node.value,
      ['label', 'precondition', 'action', 'expectedOutcome'],
      `node ${node.id} value`,
    )
    return {
      label: text(node.value.label, 'label'),
      precondition: text(node.value.precondition, 'precondition'),
      action: text(node.value.action, 'action'),
      expectedOutcome: text(node.value.expectedOutcome, 'expectedOutcome'),
    }
  }
  if (node.kind === 'implementation-verification.invariant') {
    exact(node.value, ['label', 'assertion', 'scope'], `node ${node.id} value`)
    const scope = text(node.value.scope, 'scope')
    if (!SCOPES.has(scope)) fail(`node ${node.id} scope is invalid`)
    return {
      label: text(node.value.label, 'label'),
      assertion: text(node.value.assertion, 'assertion'),
      scope,
    }
  }
  exact(
    node.value,
    [
      'label',
      'kind',
      'expected',
      ...(Object.hasOwn(node.value, 'artifactPaths') ? ['artifactPaths'] : []),
    ],
    `node ${node.id} value`,
  )
  const kind = text(node.value.kind, 'kind')
  if (!EVIDENCE_KINDS.has(kind))
    fail(`node ${node.id} evidence kind is invalid`)
  return {
    label: text(node.value.label, 'label'),
    kind,
    expected: text(node.value.expected, 'expected'),
    ...(Object.hasOwn(node.value, 'artifactPaths')
      ? {
          artifactPaths: strings(
            node.value.artifactPaths,
            'artifactPaths',
            true,
          ),
        }
      : {}),
  }
}

/** Domain-owned projection parsing. Consumers must not duplicate Phase 7 value rules. */
export function parseImplementationVerificationProjectionPayload(
  node: GameIrNode,
): ImplementationVerificationProjectionPayload {
  const value = parseValue(node)
  switch (node.kind) {
    case 'implementation-verification.target':
      return { kind: node.kind, value: value as ImplementationVerificationTargetValue }
    case 'implementation-verification.unit':
      return { kind: node.kind, value: value as ImplementationVerificationUnitValue }
    case 'implementation-verification.acceptance-scenario':
      return { kind: node.kind, value: value as ImplementationVerificationAcceptanceScenarioValue }
    case 'implementation-verification.invariant':
      return { kind: node.kind, value: value as ImplementationVerificationInvariantValue }
    case 'implementation-verification.evidence-requirement':
      return { kind: node.kind, value: value as ImplementationVerificationEvidenceRequirementValue }
    default:
      return fail(`node ${node.id} has an unknown projection kind`)
  }
}

function parseCurrent(
  module: GameIrModuleCandidate,
  prior: ReadonlyMap<string, GameIrModuleCandidate>,
): GameIrModuleCandidate {
  const targets = new Map<string, GameIrNode>()
  for (const item of prior.values())
    for (const node of item.nodes) targets.set(node.id, node)
  const nodes: ParsedNode[] = module.nodes.map(node => {
    if (
      !node.kind.startsWith('implementation-verification.') ||
      !LOCAL_KINDS.has(node.kind)
    )
      fail(`node ${node.id} has an unknown kind`)
    if (node.producerMode !== 'semantic')
      fail(`node ${node.id} must be semantic-owned`)
    if (node.references.length !== 0)
      fail(`node ${node.id} references must be empty; use manifest edges`)
    for (const item of node.edges) {
      const target = targets.get(item.targetId)
      if (
        (!target && !LOCAL_KINDS.has(item.targetType)) ||
        (target && target.kind !== item.targetType) ||
        !ALL_KINDS.has(item.targetType)
      )
        fail(`node ${node.id} edge target is invalid`)
    }
    return {
      ...node,
      value: parseValue(node),
      references: [...node.references],
      edges: [...node.edges],
      bindings: clone(node.bindings),
    }
  })
  return { moduleId: 'implementation-verification', nodes }
}

function cycle(deps: ReadonlyMap<string, readonly string[]>): void {
  const states = new Map<string, number>()
  const visit = (id: string): void => {
    if (states.get(id) === 1) fail(`unit dependencies contain a cycle`)
    if (states.get(id) === 2) return
    states.set(id, 1)
    for (const next of deps.get(id) ?? []) visit(next)
    states.set(id, 2)
  }
  for (const id of deps.keys()) visit(id)
}
function support(
  id: string,
  units: ReadonlyMap<string, ParsedNode>,
): ReadonlySet<string> {
  const result = new Set<string>()
  const visit = (current: string): void => {
    if (result.has(current)) return
    result.add(current)
    for (const item of edge(units.get(current)!, 'depends-on'))
      visit(item.targetId)
  }
  visit(id)
  return result
}

function validate(
  nodes: readonly ParsedNode[],
  prior: ReadonlyMap<string, GameIrNode>,
): void {
  const local = new Map(nodes.map(node => [node.id, node]))
  const all = new Map([...prior, ...local])
  const targets = nodes.filter(node => node.kind.endsWith('.target'))
  const units = nodes.filter(node => node.kind.endsWith('.unit'))
  const scenarios = nodes.filter(node =>
    node.kind.endsWith('acceptance-scenario'),
  )
  const invariants = nodes.filter(node => node.kind.endsWith('.invariant'))
  const evidence = nodes.filter(node =>
    node.kind.endsWith('evidence-requirement'),
  )
  if (
    targets.length !== 1 ||
    units.length === 0 ||
    scenarios.length === 0 ||
    invariants.length === 0 ||
    evidence.length === 0
  )
    fail(
      'module requires one target, units, scenarios, invariants, and evidence',
    )
  const descriptor = (kind: string) =>
    IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST[
      kind as keyof typeof IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST
    ] as {
      relationships: Readonly<
        Record<string, { targetKinds: readonly string[]; cardinality: string }>
      >
    }
  for (const node of nodes) {
    const counts = new Map<string, number>()
    const seen = new Set<string>()
    for (const item of node.edges) {
      const target = all.get(item.targetId)
      if (!target || target.kind !== item.targetType)
        fail(`node ${node.id} edge target is invalid`)
      const rule = descriptor(node.kind).relationships[item.type]
      if (!rule)
        fail(`node ${node.id} has unknown relationship role ${item.type}`)
      const allowed = rule.targetKinds
      if (!allowed.includes(item.targetType))
        fail(`node ${node.id} role ${item.type} has wrong target kind`)
      const key = `${item.type}\0${item.targetId}\0${item.targetType}`
      if (seen.has(key)) fail(`node ${node.id} has duplicate relationship edge`)
      seen.add(key)
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1)
    }
    for (const [name, rule] of Object.entries(
      descriptor(node.kind).relationships,
    )) {
      const count = counts.get(name) ?? 0
      if (
        (rule.cardinality === 'exactly-one' && count !== 1) ||
        (rule.cardinality === 'at-least-one' && count < 1)
      )
        fail(`node ${node.id} relationship ${name} has invalid cardinality`)
    }
  }
  const target = targets[0]!
  const roots = target.value.projectRoots as readonly string[]
  const owned: string[] = []
  const implementer = new Map<string, string>()
  const deps = new Map<string, string[]>()
  for (const unit of units) {
    if (
      edge(unit, 'targets').length !== 1 ||
      edge(unit, 'targets')[0]!.targetId !== target.id
    )
      fail(`unit ${unit.id} must reach sole target`)
    for (const item of unit.value.ownedPaths as readonly string[]) {
      if (!roots.some(root => prefix(root, item)))
        fail(`unit ${unit.id} owned path is outside target root`)
      owned.push(item)
    }
    const dependencies = edge(unit, 'depends-on').map(item => {
      if (local.get(item.targetId)?.kind !== 'implementation-verification.unit')
        fail(`unit ${unit.id} dependency is invalid`)
      return item.targetId
    })
    deps.set(unit.id, dependencies)
    for (const item of edge(unit, 'implements')) {
      const priorNode = prior.get(item.targetId)
      if (!priorNode || priorNode.kind !== item.targetType)
        fail(`unit ${unit.id} implements an unknown prior node`)
      if (implementer.has(item.targetId))
        fail(`prior node ${item.targetId} is implemented more than once`)
      implementer.set(item.targetId, unit.id)
    }
  }
  disjoint(owned, 'unit ownedPaths')
  if (
    implementer.size !== prior.size ||
    [...prior.keys()].some(id => !implementer.has(id))
  )
    fail('implementation ownership must cover every prior node exactly once')
  cycle(deps)
  const covered = new Set<string>()
  const constrained = new Set<string>()
  const requiredOwners = (subject: ParsedNode): Set<string> => {
    const owners = new Set<string>()
    const owner = edge(subject, 'owned-by')[0]?.targetId
    if (owner) owners.add(owner)
    for (const item of edge(
      subject,
      subject.kind.endsWith('acceptance-scenario') ? 'covers' : 'constrains',
    )) {
      if (prior.has(item.targetId)) {
        owners.add(implementer.get(item.targetId)!)
        ;(subject.kind.endsWith('acceptance-scenario')
          ? covered
          : constrained
        ).add(item.targetId)
      } else if (
        local.get(item.targetId)?.kind === 'implementation-verification.unit'
      )
        owners.add(item.targetId)
      else fail(`subject ${subject.id} target is invalid`)
    }
    return owners
  }
  const proof = (subject: ParsedNode, owners: ReadonlySet<string>): void => {
    const union = new Set<string>()
    for (const item of edge(subject, 'proved-by')) {
      const proofNode = local.get(item.targetId)
      const owner = proofNode && edge(proofNode, 'owned-by')[0]?.targetId
      if (!owner) fail(`subject ${subject.id} proof owner is invalid`)
      const closure = support(owner, local as ReadonlyMap<string, ParsedNode>)
      if (![...owners].some(id => closure.has(id)))
        fail(`subject ${subject.id} has irrelevant proof owner`)
      for (const id of closure) union.add(id)
    }
    for (const id of owners)
      if (!union.has(id))
        fail(`subject ${subject.id} proof closure is incomplete`)
  }
  for (const subject of scenarios) {
    const owner = edge(subject, 'owned-by')[0]!.targetId
    const closure = support(owner, local as ReadonlyMap<string, ParsedNode>)
    for (const item of edge(subject, 'covers'))
      if (!closure.has(implementer.get(item.targetId)!))
        fail(`scenario ${subject.id} does not support covered prior node`)
    proof(subject, requiredOwners(subject))
  }
  for (const subject of invariants) proof(subject, requiredOwners(subject))
  const referenced = new Set([...covered, ...constrained])
  if (referenced.size !== prior.size)
    fail('every prior node must be scenario-covered or invariant-constrained')
  const supported = new Set<string>()
  for (const subject of [...scenarios, ...invariants]) {
    for (const owner of requiredOwners(subject))
      for (const id of support(owner, local as ReadonlyMap<string, ParsedNode>))
        supported.add(id)
  }
  if (units.some(unit => !supported.has(unit.id)))
    fail('unit is orphaned from scenario/invariant support')
  for (const item of evidence)
    if (
      ![...scenarios, ...invariants].some(subject =>
        edge(subject, 'proved-by').some(
          proofNode => proofNode.targetId === item.id,
        ),
      )
    )
      fail(`evidence ${item.id} is orphaned`)
}

export function parseImplementationVerificationModule(
  value: unknown,
  input: Readonly<{
    request: GameIrCompileRequest
    sections: readonly GameIrSourceSection[]
    priorModules: readonly unknown[]
  }>,
): GameIrModuleCandidate {
  const set = parseGameIrModuleSet(value, {
    request: input.request,
    sections: input.sections,
    expectedModuleId: 'implementation-verification',
    externalModules: input.priorModules,
  })
  if (set.external.length !== PRIOR_SEQUENCE.length)
    fail('prior modules must contain the complete Phase 6 sequence')
  for (const [index, module] of set.external.entries())
    if (module.moduleId !== PRIOR_SEQUENCE[index])
      fail(`prior modules must follow the Phase 6 sequence`)
  const raw = new Map(set.external.map(module => [module.moduleId, module]))
  const prior = admitPrior(set.external, raw, input.request, input.sections)
  const current = parseCurrent(set.current, raw)
  const priorMap = new Map(
    prior.flatMap(module => module.nodes).map(node => [node.id, node]),
  )
  validate(current.nodes, priorMap)
  const candidate = parseGameIrCandidate(
    {
      schemaVersion: 'game-ir.v1',
      taskId: input.request.taskId,
      foundationRevision: input.request.foundation.foundationRevision,
      modules: [...prior, current].sort((a, b) =>
        compareCodeUnits(a.moduleId, b.moduleId),
      ),
    },
    { request: input.request, sections: input.sections },
  )
  return freeze(
    candidate.modules.find(
      module => module.moduleId === 'implementation-verification',
    )!,
  )
}
