import { createHash } from 'node:crypto'
import {
  GAME_IR_CANONICAL_MODULE_IDS,
  parseGameIrCompileRequest,
  type GameIrCompileRequest,
  type GameIrModuleId,
} from './contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import {
  digestSectionIndex,
  type SectionRef,
} from '../foundation-section-index'

export type GameIrSourceBinding =
  | Readonly<{
      kind: 'owner'
      documentPath: FoundationDocumentPath
      sectionId: string
      sectionDigest: string
      sourcePointer: string
    }>
  | Readonly<{
      kind: 'derived'
      derivationRuleId: string
      inputs: readonly GameIrDerivedInput[]
    }>

export type GameIrDerivedInput =
  | Readonly<{
      kind: 'local'
      pointer: string
    }>
  | Readonly<{
      kind: 'external'
      moduleId: GameIrModuleId
      nodeId: string
      pointer: string
      targetDigest: string
    }>

export type GameIrReference = Readonly<{
  targetId: string
  targetType: string
}>

export type GameIrRelationshipEdge = Readonly<{
  type: string
  targetId: string
  targetType: string
}>

export type GameIrNode = Readonly<{
  id: string
  kind: string
  producerMode: 'mechanical' | 'semantic' | 'derived'
  value: Readonly<Record<string, unknown>>
  references: readonly GameIrReference[]
  edges: readonly GameIrRelationshipEdge[]
  bindings: Readonly<Record<string, GameIrSourceBinding>>
}>

export type GameIrModuleCandidate = Readonly<{
  moduleId: string
  nodes: readonly GameIrNode[]
}>

export type GameIrCandidate = Readonly<{
  schemaVersion: 'game-ir.v1'
  taskId: string
  foundationRevision: string
  modules: readonly GameIrModuleCandidate[]
}>

export type GameIrSourceSection = Readonly<{
  documentPath: FoundationDocumentPath
  sectionId: string
  heading: string
  startLine: number
  endLine: number
  digest: string
}>

type RecordValue = Record<string, unknown>

const FOUNDATION_DOCUMENTS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
const PRODUCER_MODES = new Set(['mechanical', 'semantic', 'derived'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA256 = /^[a-f0-9]{64}$/
const STRUCTURAL_POINTER = /^\/(references|edges)\/(0|[1-9]\d*)$/

function fail(message: string): never {
  throw new Error(`invalid Game IR candidate: ${message}`)
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
  const actual = Object.keys(value).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sourceSectionCanonicalKey(section: GameIrSourceSection): string {
  return `${section.documentPath}\0${section.startLine}\0${section.sectionId}`
}

export function canonicalizeGameIrSourceSections(
  sections: readonly GameIrSourceSection[],
): GameIrSourceSection[] {
  const identities = new Set<string>()
  for (const section of sections) {
    const identity = `${section.documentPath}\0${section.sectionId}`
    if (identities.has(identity))
      fail('source sections contain a duplicate section')
    identities.add(identity)
  }
  return [...sections].sort((left, right) =>
    compareCodeUnits(
      sourceSectionCanonicalKey(left),
      sourceSectionCanonicalKey(right),
    ),
  )
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail(`${label} must be non-empty text`)
  return value
}

function safeId(value: unknown, label: string): string {
  const text = nonEmptyText(value, label)
  if (!SAFE_ID.test(text)) fail(`${label} is not a safe identifier`)
  return text
}

function safeModuleId(value: unknown, label: string): GameIrModuleId {
  const moduleId = safeId(value, label)
  if (!GAME_IR_CANONICAL_MODULE_IDS.includes(moduleId as GameIrModuleId))
    fail(`${label} is not a canonical module ID`)
  return moduleId as GameIrModuleId
}

function derivedInputKey(input: GameIrDerivedInput): string {
  return input.kind === 'local'
    ? `local\0${input.pointer}`
    : `external\0${input.moduleId}\0${input.nodeId}\0${input.pointer}`
}

function digest(value: unknown, label: string): string {
  const text = nonEmptyText(value, label)
  if (!SHA256.test(text)) fail(`${label} must be a SHA-256 digest`)
  return text
}

function foundationDocumentPath(
  value: unknown,
  label: string,
): FoundationDocumentPath {
  const path = nonEmptyText(value, label)
  if (!FOUNDATION_DOCUMENTS.has(path))
    fail(`${label} is not a Foundation document`)
  return path as FoundationDocumentPath
}

function isSafeJsonPointer(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.includes('\0')
  )
    return false
  const segments = value.slice(1).split('/')
  if (segments.some(segment => segment.length === 0)) return false
  for (const segment of segments) {
    if (
      segment === '.' ||
      segment === '..' ||
      segment.includes('\\') ||
      segment.includes('__proto__') ||
      segment.includes('constructor') ||
      segment.includes('prototype') ||
      /~(?![01])/.test(segment)
    )
      return false
  }
  return true
}

function pointerSegments(pointer: string): string[] {
  return pointer
    .slice(1)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function encodePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

function localPointer(pointer: string): string {
  return `/${pointerSegments(pointer).map(encodePointerSegment).join('/')}`
}

/**
 * Parse the pointer namespace that can identify a node-owned Game IR target.
 * The returned pointer is normalized by the same JSON Pointer parser used by
 * model bindings; target existence is intentionally checked by the caller.
 */
export function parseGameIrTargetPointer(value: unknown): string {
  if (!isSafeJsonPointer(value))
    fail('target pointer must be a safe JSON pointer')
  const pointer = localPointer(value)
  if (
    pointer === '/id' ||
    pointer === '/value' ||
    pointer.startsWith('/value/') ||
    STRUCTURAL_POINTER.test(pointer)
  )
    return pointer
  fail('target pointer must identify /id, a value path, reference, or edge')
}

function normalizeJsonValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must contain a finite number`)
    return value
  }
  if (Array.isArray(value)) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      lengthDescriptor.enumerable !== false ||
      lengthDescriptor.configurable !== false
    )
      fail(`${path} has a non-JSON length descriptor`)
    const normalized: unknown[] = []
    const ownKeys = Reflect.ownKeys(value)
    for (const key of ownKeys) {
      if (key === 'length') continue
      if (typeof key !== 'string' || !/^\d+$/.test(key))
        fail(`${path} contains a symbol or hidden array property`)
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index >= value.length)
        fail(`${path} contains an invalid array index`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor ||
        !('value' in descriptor) ||
        descriptor.enumerable !== true
      )
        fail(`${path}/${index} has a non-JSON property descriptor`)
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, String(index)))
        fail(`${path}/${index} is undefined in a sparse array`)
      normalized.push(normalizeJsonValue(value[index], `${path}/${index}`))
    }
    return normalized
  }
  if (!isRecord(value)) fail(`${path} must contain only JSON values`)
  const normalized: RecordValue = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${path} contains a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    )
      fail(`${path}/${key} has a non-JSON property descriptor`)
    Object.defineProperty(normalized, key, {
      value: normalizeJsonValue(
        descriptor.value,
        `${path}/${encodePointerSegment(key)}`,
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return normalized
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      fail('canonical JSON cannot contain a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalValue(entry)).join(',')}]`
  }
  if (!isRecord(value)) fail('canonical JSON accepts only JSON values')
  return `{${Object.keys(value)
    .sort(compareCodeUnits)
    .map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
    .join(',')}}`
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as RecordValue)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function sourceSectionMap(
  sections: readonly GameIrSourceSection[],
  request: GameIrCompileRequest,
): Map<string, GameIrSourceSection> {
  if (!Array.isArray(sections)) fail('source sections must be an array')
  const normalized: GameIrSourceSection[] = []
  for (const sectionValue of sections) {
    if (!isRecord(sectionValue)) fail('source section must be an object')
    exactKeys(
      sectionValue,
      [
        'documentPath',
        'sectionId',
        'heading',
        'startLine',
        'endLine',
        'digest',
      ],
      'source section',
    )
    const documentPath = foundationDocumentPath(
      sectionValue.documentPath,
      'source section documentPath',
    )
    const sectionId = safeId(sectionValue.sectionId, 'source section sectionId')
    const heading = nonEmptyText(sectionValue.heading, 'source section heading')
    const startLine = sectionLine(
      sectionValue.startLine,
      'source section startLine',
    )
    const endLine = sectionLine(sectionValue.endLine, 'source section endLine')
    if (endLine < startLine)
      fail('source section endLine must not precede startLine')
    const sectionDigest = digest(sectionValue.digest, 'source section digest')
    if (!request.foundation.documentDigests[documentPath])
      fail('source section document is outside the Foundation receipt')
    normalized.push(
      Object.freeze({
        documentPath,
        sectionId,
        heading,
        startLine,
        endLine,
        digest: sectionDigest,
      }),
    )
  }
  const index = canonicalizeGameIrSourceSections(normalized)
  if (
    digestSectionIndex(index as readonly SectionRef[]) !==
    request.foundation.sectionIndexDigest
  )
    fail('source sections do not match the receipt section index digest')
  return new Map(
    index.map(section => [
      `${section.documentPath}\0${section.sectionId}`,
      section,
    ]),
  )
}

function normalizeSourceSections(
  value: readonly GameIrSourceSection[],
): GameIrSourceSection[] {
  const normalized = normalizeJsonValue(value, 'source sections')
  if (!Array.isArray(normalized)) fail('source sections must be an array')
  return normalized as GameIrSourceSection[]
}

function sectionLine(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    fail(`${label} must be a positive line number`)
  return value
}

function sourceBinding(
  value: unknown,
  pointer: string,
  sections: Map<string, GameIrSourceSection>,
  request: GameIrCompileRequest,
): GameIrSourceBinding {
  if (!isRecord(value)) fail(`binding ${pointer} must be an object`)
  if (value.kind === 'owner') {
    exactKeys(
      value,
      ['kind', 'documentPath', 'sectionId', 'sectionDigest', 'sourcePointer'],
      `owner binding ${pointer}`,
    )
    const documentPath = foundationDocumentPath(
      value.documentPath,
      `owner binding ${pointer} documentPath`,
    )
    const sectionId = safeId(
      value.sectionId,
      `owner binding ${pointer} sectionId`,
    )
    const sectionDigest = digest(
      value.sectionDigest,
      `owner binding ${pointer} sectionDigest`,
    )
    if (!request.foundation.documentDigests[documentPath])
      fail(`owner binding ${pointer} is outside the Foundation receipt`)
    if (!isSafeJsonPointer(value.sourcePointer))
      fail(`owner binding ${pointer} has an unsafe source pointer`)
    const section = sections.get(`${documentPath}\0${sectionId}`)
    if (!section)
      fail(`owner binding ${pointer} refers to an unknown Section Index entry`)
    if (section.digest !== sectionDigest)
      fail(`owner binding ${pointer} has the wrong section digest`)
    return {
      kind: 'owner',
      documentPath,
      sectionId,
      sectionDigest,
      sourcePointer: value.sourcePointer,
    }
  }
  if (value.kind === 'derived') {
    exactKeys(
      value,
      ['kind', 'derivationRuleId', 'inputs'],
      `derived binding ${pointer}`,
    )
    const derivationRuleId = safeId(
      value.derivationRuleId,
      `derived binding ${pointer} derivationRuleId`,
    )
    if (!Array.isArray(value.inputs) || value.inputs.length === 0)
      fail(`derived binding ${pointer} inputs must not be empty`)
    const inputs: GameIrDerivedInput[] = []
    for (const input of value.inputs) {
      if (!isRecord(input))
        fail(`derived binding ${pointer} input must be an object`)
      if (input.kind === 'local') {
        exactKeys(
          input,
          ['kind', 'pointer'],
          `derived binding ${pointer} local input`,
        )
        inputs.push({
          kind: 'local',
          pointer: parseGameIrTargetPointer(input.pointer),
        })
        continue
      }
      if (input.kind === 'external') {
        exactKeys(
          input,
          ['kind', 'moduleId', 'nodeId', 'pointer', 'targetDigest'],
          `derived binding ${pointer} external input`,
        )
        inputs.push({
          kind: 'external',
          moduleId: safeModuleId(
            input.moduleId,
            `derived binding ${pointer} external moduleId`,
          ),
          nodeId: safeId(
            input.nodeId,
            `derived binding ${pointer} external nodeId`,
          ),
          pointer: parseGameIrTargetPointer(input.pointer),
          targetDigest: digest(
            input.targetDigest,
            `derived binding ${pointer} external targetDigest`,
          ),
        })
        continue
      }
      fail(`derived binding ${pointer} input has an unknown kind`)
    }
    for (let index = 1; index < inputs.length; index += 1) {
      const previous = derivedInputKey(inputs[index - 1]!)
      const current = derivedInputKey(inputs[index]!)
      if (compareCodeUnits(previous, current) >= 0)
        fail(`derived binding ${pointer} inputs must be unique and sorted`)
    }
    return { kind: 'derived', derivationRuleId, inputs }
  }
  fail(`binding ${pointer} has an unknown kind`)
}

function valueLeafPointers(value: RecordValue): string[] {
  const leaves: string[] = []
  const visit = (entry: unknown, path: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) {
        leaves.push(path)
        return
      }
      entry.forEach((child, index) => visit(child, `${path}/${index}`))
      return
    }
    if (isRecord(entry)) {
      if (Object.keys(entry).length === 0) {
        leaves.push(path)
        return
      }
      for (const [key, child] of Object.entries(entry))
        visit(child, `${path}/${encodePointerSegment(key)}`)
      return
    }
    leaves.push(path)
  }
  if (Object.keys(value).length === 0) {
    leaves.push('/value')
    return leaves
  }
  for (const [key, entry] of Object.entries(value))
    visit(entry, `/value/${encodePointerSegment(key)}`)
  return leaves
}

export function resolveTargetLeaf(node: GameIrNode, pointer: string): unknown {
  const normalized = parseGameIrTargetPointer(pointer)
  const segments = pointerSegments(pointer)
  if (segments.length === 1 && segments[0] === 'id') return node.id
  if (
    segments.length === 2 &&
    (segments[0] === 'references' || segments[0] === 'edges') &&
    /^(0|[1-9]\d*)$/.test(segments[1]!)
  ) {
    const entries = segments[0] === 'references' ? node.references : node.edges
    const entry = entries[Number(segments[1])]
    if (!entry) fail(`target ${normalized} does not exist on node ${node.id}`)
    return entry
  }
  if (segments.length === 1 && segments[0] === 'value')
    if (Object.keys(node.value).length === 0) return node.value
    else fail(`target ${normalized} is not a leaf on node ${node.id}`)
  if (segments.length < 2 || segments[0] !== 'value')
    fail(`target ${normalized} does not exist on node ${node.id}`)
  let current: unknown = node.value
  for (const segment of segments.slice(1)) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment) || Number(segment) >= current.length)
        fail(`target ${normalized} does not exist on node ${node.id}`)
      current = current[Number(segment)]
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
    } else fail(`target ${normalized} does not exist on node ${node.id}`)
  }
  if (
    (Array.isArray(current) && current.length > 0) ||
    (isRecord(current) && Object.keys(current).length > 0)
  )
    fail(`target ${normalized} is not a leaf on node ${node.id}`)
  return current
}

function parseNode(
  value: unknown,
  moduleId: string,
  sections: Map<string, GameIrSourceSection>,
  request: GameIrCompileRequest,
): GameIrNode {
  if (!isRecord(value)) fail(`node in module ${moduleId} must be an object`)
  exactKeys(
    value,
    ['id', 'kind', 'producerMode', 'value', 'references', 'edges', 'bindings'],
    'node',
  )
  const id = safeId(value.id, 'node id')
  const kind = nonEmptyText(value.kind, `node ${id} kind`)
  if (
    typeof value.producerMode !== 'string' ||
    !PRODUCER_MODES.has(value.producerMode)
  )
    fail(`node ${id} has an unknown producer mode`)
  if (!isRecord(value.value)) fail(`node ${id} value must be an object`)
  if (!Array.isArray(value.references))
    fail(`node ${id} references must be an array`)
  const references: GameIrReference[] = value.references.map((entry, index) => {
    if (!isRecord(entry))
      fail(`node ${id} reference ${index} must be an object`)
    exactKeys(entry, ['targetId', 'targetType'], `node ${id} reference`)
    return {
      targetId: safeId(entry.targetId, `node ${id} reference targetId`),
      targetType: nonEmptyText(
        entry.targetType,
        `node ${id} reference targetType`,
      ),
    }
  })
  for (let index = 1; index < references.length; index += 1) {
    if (referenceOrder(references[index - 1]!, references[index]!) >= 0)
      fail(`node ${id} references must be unique and sorted`)
  }
  if (!Array.isArray(value.edges)) fail(`node ${id} edges must be an array`)
  const edges: GameIrRelationshipEdge[] = value.edges.map((entry, index) => {
    if (!isRecord(entry)) fail(`node ${id} edge ${index} must be an object`)
    exactKeys(entry, ['type', 'targetId', 'targetType'], `node ${id} edge`)
    if (entry.type === 'reference')
      fail(`node ${id} edge type reference is reserved for references`)
    return {
      type: nonEmptyText(entry.type, `node ${id} edge type`),
      targetId: safeId(entry.targetId, `node ${id} edge targetId`),
      targetType: nonEmptyText(entry.targetType, `node ${id} edge targetType`),
    }
  })
  for (let index = 1; index < edges.length; index += 1) {
    if (edgeOrder(edges[index - 1]!, edges[index]!) >= 0)
      fail(`node ${id} edges must be unique and sorted`)
  }
  if (!isRecord(value.bindings)) fail(`node ${id} bindings must be an object`)

  const parsedBindings: Record<string, GameIrSourceBinding> = {}
  const normalizedPointers = new Set<string>()
  for (const [rawPointer, binding] of Object.entries(value.bindings)) {
    const pointer = parseGameIrTargetPointer(rawPointer)
    if (normalizedPointers.has(pointer))
      fail(`node ${id} has duplicate binding pointers`)
    normalizedPointers.add(pointer)
    if (STRUCTURAL_POINTER.test(pointer)) {
      const [collection, indexText] = pointer.slice(1).split('/')
      const entries = collection === 'references' ? references : edges
      if (Number(indexText) >= entries.length)
        fail(
          `node ${id} binding ${pointer} targets a missing ${collection} entry`,
        )
    }
    const parsed = sourceBinding(binding, pointer, sections, request)
    parsedBindings[pointer] = parsed
  }

  const idBinding = parsedBindings['/id']
  if (!idBinding || idBinding.kind !== 'owner')
    fail(`node ${id} identity must have exactly one owner binding`)
  const leaves = valueLeafPointers(value.value)
  const leafSet = new Set(leaves)
  for (const pointer of Object.keys(parsedBindings)) {
    const structural = STRUCTURAL_POINTER.test(pointer)
    if (pointer !== '/id' && !structural && !leafSet.has(pointer))
      fail(`node ${id} binding ${pointer} does not target a value leaf`)
  }
  for (const pointer of leaves) {
    const binding = parsedBindings[pointer]
    if (!binding) fail(`node ${id} value leaf ${pointer} has no binding`)
    const expectedKind = value.producerMode === 'derived' ? 'derived' : 'owner'
    if (binding.kind !== expectedKind)
      fail(`node ${id} ${pointer} conflicts with producer mode`)
  }
  for (const collection of ['references', 'edges'] as const) {
    const entries = collection === 'references' ? references : edges
    entries.forEach((_, index) => {
      const pointer = `/${collection}/${index}`
      const binding = parsedBindings[pointer]
      if (!binding)
        fail(`node ${id} ${collection} entry ${index} has no binding`)
      if (binding.kind !== 'owner')
        fail(
          `node ${id} ${collection} entry ${index} must have an owner binding`,
        )
    })
  }
  const parsedNode: GameIrNode = {
    id,
    kind,
    producerMode: value.producerMode as GameIrNode['producerMode'],
    value: value.value,
    references,
    edges,
    bindings: parsedBindings,
  }
  return parsedNode
}

function parseModule(
  value: unknown,
  sections: Map<string, GameIrSourceSection>,
  request: GameIrCompileRequest,
): GameIrModuleCandidate {
  if (!isRecord(value)) fail('module must be an object')
  exactKeys(value, ['moduleId', 'nodes'], 'module')
  const moduleId = safeId(value.moduleId, 'moduleId')
  if (!Array.isArray(value.nodes))
    fail(`module ${moduleId} nodes must be an array`)
  const nodes = value.nodes.map(node =>
    parseNode(node, moduleId, sections, request),
  )
  for (let index = 1; index < nodes.length; index += 1) {
    if (compareCodeUnits(nodes[index - 1]!.id, nodes[index]!.id) >= 0)
      fail(`module ${moduleId} node IDs must be unique and sorted`)
  }
  return { moduleId, nodes }
}

type ModuleInput = Readonly<{
  request: GameIrCompileRequest
  sections: readonly GameIrSourceSection[]
  expectedModuleId?: GameIrModuleId
  externalModules?: readonly unknown[]
}>

function parseGameIrModuleCandidateInternal(
  value: unknown,
  sections: Map<string, GameIrSourceSection>,
  request: GameIrCompileRequest,
  expectedModuleId?: GameIrModuleId,
): GameIrModuleCandidate {
  const module = parseModule(value, sections, request)
  if (expectedModuleId && module.moduleId !== expectedModuleId)
    fail('module ID does not match expected module')
  return module
}

type ModuleSet = Readonly<{
  modules: readonly GameIrModuleCandidate[]
  validateRelations?: boolean
  rawExternalModuleIds?: ReadonlySet<string>
}>

function moduleNodeKey(moduleId: string, nodeId: string): string {
  return `${moduleId}\0${nodeId}`
}

function dependencyEndpointKey(
  moduleId: string,
  nodeId: string,
  pointer: string,
): string {
  return `${moduleId}\0${nodeId}\0${pointer}`
}

function validateModuleSet({
  modules,
  validateRelations,
  rawExternalModuleIds,
}: ModuleSet): void {
  const modulesById = new Map<string, GameIrModuleCandidate>()
  const nodesByKey = new Map<string, GameIrNode>()
  const nodesById = new Map<string, GameIrNode>()
  for (const module of modules) {
    if (modulesById.has(module.moduleId))
      fail(`duplicate module ID ${module.moduleId}`)
    modulesById.set(module.moduleId, module)
    for (const node of module.nodes) {
      const key = moduleNodeKey(module.moduleId, node.id)
      if (nodesByKey.has(key)) fail(`duplicate node ID ${node.id}`)
      if (nodesById.has(node.id))
        fail(`duplicate node ID ${node.id} across modules`)
      nodesByKey.set(key, node)
      nodesById.set(node.id, node)
    }
  }
  if (validateRelations) {
    for (const module of modules) {
      for (const node of module.nodes) {
        for (const reference of node.references) {
          const target = nodesById.get(reference.targetId)
          if (!target) fail(`reference ${node.id} targets an unknown node`)
          if (target.kind !== reference.targetType)
            fail(`reference ${node.id} target type does not match target node`)
        }
        for (const edge of node.edges) {
          const target = nodesById.get(edge.targetId)
          if (!target) fail(`edge ${node.id} targets an unknown node`)
          if (target.kind !== edge.targetType)
            fail(`edge ${node.id} target type does not match target node`)
        }
      }
    }
  }

  const states = new Map<string, 'visiting' | 'done'>()
  const visit = (
    ownerModuleId: string,
    ownerNode: GameIrNode,
    pointer: string,
  ): void => {
    const normalized = parseGameIrTargetPointer(pointer)
    const key = dependencyEndpointKey(ownerModuleId, ownerNode.id, normalized)
    const state = states.get(key)
    if (state === 'visiting')
      fail(`derived bindings contain a dependency cycle at ${key}`)
    if (state === 'done') return
    const binding = ownerNode.bindings[normalized]
    if (!binding)
      fail(`node ${ownerNode.id} derived input ${pointer} has no binding`)
    resolveTargetLeaf(ownerNode, normalized)
    if (binding.kind === 'owner') {
      states.set(key, 'done')
      return
    }
    states.set(key, 'visiting')
    for (const input of binding.inputs) {
      let targetModuleId = ownerModuleId
      let targetNodeId = ownerNode.id
      if (input.kind === 'external') {
        if (input.moduleId === ownerModuleId && input.nodeId === ownerNode.id)
          fail(`node ${ownerNode.id} external input may not target itself`)
        if (
          rawExternalModuleIds?.has(ownerModuleId) &&
          !rawExternalModuleIds.has(input.moduleId)
        )
          fail(
            `raw prior module ${ownerModuleId} may not depend on current module ${input.moduleId}`,
          )
        targetModuleId = input.moduleId
        targetNodeId = input.nodeId
      }
      const targetModule = modulesById.get(targetModuleId)
      if (!targetModule)
        fail(`node ${ownerNode.id} derived input targets an unknown module`)
      const targetNode = nodesByKey.get(
        moduleNodeKey(targetModuleId, targetNodeId),
      )
      if (!targetNode)
        fail(`node ${ownerNode.id} derived input targets an unknown node`)
      const leaf = resolveTargetLeaf(targetNode, input.pointer)
      if (input.kind === 'external') {
        const actualDigest = digestGameIrValue(leaf)
        if (actualDigest !== input.targetDigest)
          fail(
            `node ${ownerNode.id} external input has the wrong target digest`,
          )
      }
      visit(targetModuleId, targetNode, input.pointer)
    }
    states.set(key, 'done')
  }

  for (const module of modules) {
    for (const node of module.nodes) {
      for (const [pointer, binding] of Object.entries(node.bindings)) {
        if (binding.kind === 'derived') visit(module.moduleId, node, pointer)
      }
    }
  }
}

export function parseGameIrModuleCandidate(
  value: unknown,
  input: ModuleInput,
): GameIrModuleCandidate {
  const request = parseGameIrCompileRequest(input.request)
  const sections = sourceSectionMap(
    normalizeSourceSections(input.sections),
    request,
  )
  const local = parseGameIrModuleCandidateInternal(
    normalizeJsonValue(value, 'module'),
    sections,
    request,
    input.expectedModuleId,
  )
  const externalModules = (input.externalModules ?? []).map((module, index) => {
    const parsed = parseGameIrModuleCandidateInternal(
      normalizeJsonValue(module, `external module ${index}`),
      sections,
      request,
    )
    safeModuleId(parsed.moduleId, `external module ${index} moduleId`)
    return parsed
  })
  validateModuleSet({
    modules: [local, ...externalModules],
    validateRelations: false,
    rawExternalModuleIds: new Set(
      externalModules.map(module => module.moduleId),
    ),
  })
  return deepFreeze(local)
}

function referenceOrder(left: GameIrReference, right: GameIrReference): number {
  return compareCodeUnits(
    `${left.targetId}\0${left.targetType}`,
    `${right.targetId}\0${right.targetType}`,
  )
}

function edgeOrder(
  left: GameIrRelationshipEdge,
  right: GameIrRelationshipEdge,
): number {
  return compareCodeUnits(
    `${left.type}\0${left.targetId}\0${left.targetType}`,
    `${right.type}\0${right.targetId}\0${right.targetType}`,
  )
}

export function parseGameIrCandidate(
  value: unknown,
  input: {
    request: GameIrCompileRequest
    sections: readonly GameIrSourceSection[]
  },
): GameIrCandidate {
  const request = parseGameIrCompileRequest(input.request)
  const sections = sourceSectionMap(
    normalizeSourceSections(input.sections),
    request,
  )
  const normalizedValue = normalizeJsonValue(value, 'candidate')
  if (!isRecord(normalizedValue)) fail('candidate must be an object')
  exactKeys(
    normalizedValue,
    ['schemaVersion', 'taskId', 'foundationRevision', 'modules'],
    'candidate',
  )
  if (normalizedValue.schemaVersion !== 'game-ir.v1')
    fail('candidate schemaVersion is invalid')
  const taskId = safeId(normalizedValue.taskId, 'candidate taskId')
  if (taskId !== request.taskId)
    fail('candidate taskId does not match compile request')
  const foundationRevision = nonEmptyText(
    normalizedValue.foundationRevision,
    'candidate foundationRevision',
  )
  if (foundationRevision !== request.foundation.foundationRevision)
    fail('candidate foundationRevision does not match compile request')
  if (!Array.isArray(normalizedValue.modules))
    fail('candidate modules must be an array')
  const modules = normalizedValue.modules.map(module =>
    parseGameIrModuleCandidateInternal(module, sections, request),
  )
  for (let index = 1; index < modules.length; index += 1) {
    if (
      compareCodeUnits(
        modules[index - 1]!.moduleId,
        modules[index]!.moduleId,
      ) >= 0
    )
      fail('module IDs must be unique and sorted')
  }
  validateModuleSet({ modules, validateRelations: true })
  return deepFreeze({
    schemaVersion: 'game-ir.v1',
    taskId,
    foundationRevision,
    modules,
  })
}

export function canonicalGameIrJson(value: unknown): string {
  return canonicalValue(normalizeJsonValue(value, '$'))
}

export function digestGameIrValue(value: unknown): string {
  return createHash('sha256').update(canonicalGameIrJson(value)).digest('hex')
}
