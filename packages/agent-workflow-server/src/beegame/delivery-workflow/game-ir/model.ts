import { createHash } from 'node:crypto'
import {
  parseGameIrCompileRequest,
  type GameIrCompileRequest,
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
      inputPointers: readonly string[]
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
  const actual = Object.keys(value).sort(compare)
  const wanted = [...expected].sort(compare)
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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
    .sort(compare)
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
  const map = new Map<string, GameIrSourceSection>()
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
    const key = `${documentPath}\0${sectionId}`
    if (map.has(key)) fail('source sections contain a duplicate section')
    map.set(
      key,
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
  const index = [...map.values()]
  for (
    let indexPosition = 1;
    indexPosition < index.length;
    indexPosition += 1
  ) {
    if (sectionOrder(index[indexPosition - 1]!, index[indexPosition]!) >= 0)
      fail('source sections must be unique and sorted')
  }
  if (
    digestSectionIndex(index as readonly SectionRef[]) !==
    request.foundation.sectionIndexDigest
  )
    fail('source sections do not match the receipt section index digest')
  return map
}

function sectionLine(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    fail(`${label} must be a positive line number`)
  return value
}

function sectionOrder(
  left: GameIrSourceSection,
  right: GameIrSourceSection,
): number {
  const leftKey = `${left.documentPath}\0${left.startLine}\0${left.sectionId}`
  const rightKey = `${right.documentPath}\0${right.startLine}\0${right.sectionId}`
  return leftKey.localeCompare(rightKey)
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
      ['kind', 'derivationRuleId', 'inputPointers'],
      `derived binding ${pointer}`,
    )
    const derivationRuleId = safeId(
      value.derivationRuleId,
      `derived binding ${pointer} derivationRuleId`,
    )
    if (!Array.isArray(value.inputPointers) || value.inputPointers.length === 0)
      fail(`derived binding ${pointer} inputPointers must not be empty`)
    const inputPointers: string[] = []
    for (const input of value.inputPointers) {
      if (!isSafeJsonPointer(input))
        fail(`derived binding ${pointer} contains an unsafe input pointer`)
      inputPointers.push(input)
    }
    for (let index = 1; index < inputPointers.length; index += 1) {
      if (compare(inputPointers[index - 1]!, inputPointers[index]!) >= 0)
        fail(
          `derived binding ${pointer} inputPointers must be unique and sorted`,
        )
    }
    return { kind: 'derived', derivationRuleId, inputPointers }
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

function localTargetExists(node: GameIrNode, pointer: string): boolean {
  const segments = pointerSegments(pointer)
  if (segments.length === 1 && segments[0] === 'id') return true
  if (
    segments.length === 2 &&
    (segments[0] === 'references' || segments[0] === 'edges') &&
    /^(0|[1-9]\d*)$/.test(segments[1]!)
  ) {
    const entries = segments[0] === 'references' ? node.references : node.edges
    return Number(segments[1]) < entries.length
  }
  if (segments.length === 1 && segments[0] === 'value')
    return Object.keys(node.value).length === 0
  if (segments.length < 2 || segments[0] !== 'value') return false
  let current: unknown = node.value
  for (const segment of segments.slice(1)) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment) || Number(segment) >= current.length)
        return false
      current = current[Number(segment)]
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
    } else return false
  }
  return (
    (!Array.isArray(current) && !isRecord(current)) ||
    (Array.isArray(current) && current.length === 0) ||
    (isRecord(current) && Object.keys(current).length === 0)
  )
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
    if (!isSafeJsonPointer(rawPointer))
      fail(`node ${id} has an unsafe binding pointer`)
    const pointer = localPointer(rawPointer)
    if (normalizedPointers.has(pointer))
      fail(`node ${id} has duplicate binding pointers`)
    normalizedPointers.add(pointer)
    if (
      pointer !== '/id' &&
      pointer !== '/value' &&
      !pointer.startsWith('/value/') &&
      !STRUCTURAL_POINTER.test(pointer)
    )
      fail(
        `node ${id} binding does not target /id, a value leaf, reference, or edge`,
      )
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
  const states = new Map<string, 'visiting' | 'done'>()
  const reachesOwner = (pointer: string): boolean => {
    const normalized = localPointer(pointer)
    if (normalized === '/id') return true
    if (!localTargetExists(parsedNode, normalized))
      fail(`node ${id} derived input ${pointer} does not target a local leaf`)
    const binding = parsedBindings[normalized]
    if (!binding) fail(`node ${id} derived input ${pointer} has no binding`)
    if (binding.kind === 'owner') return true
    if (states.get(normalized) === 'visiting')
      fail(`node ${id} derived bindings contain a dependency cycle`)
    if (states.get(normalized) === 'done') return true
    states.set(normalized, 'visiting')
    for (const input of binding.inputPointers) reachesOwner(input)
    states.set(normalized, 'done')
    return true
  }
  for (const pointer of leaves) {
    const binding = parsedBindings[pointer]!
    if (binding.kind === 'derived') {
      for (const input of binding.inputPointers) reachesOwner(input)
    }
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
    if (compare(nodes[index - 1]!.id, nodes[index]!.id) >= 0)
      fail(`module ${moduleId} node IDs must be unique and sorted`)
  }
  return { moduleId, nodes }
}

function referenceOrder(left: GameIrReference, right: GameIrReference): number {
  return compare(
    `${left.targetId}\0${left.targetType}`,
    `${right.targetId}\0${right.targetType}`,
  )
}

function edgeOrder(
  left: GameIrRelationshipEdge,
  right: GameIrRelationshipEdge,
): number {
  return compare(
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
  const normalizedSections = normalizeJsonValue(
    input.sections,
    'source sections',
  )
  if (!Array.isArray(normalizedSections))
    fail('source sections must be an array')
  const sections = sourceSectionMap(
    normalizedSections as GameIrSourceSection[],
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
    parseModule(module, sections, request),
  )
  for (let index = 1; index < modules.length; index += 1) {
    if (compare(modules[index - 1]!.moduleId, modules[index]!.moduleId) >= 0)
      fail('module IDs must be unique and sorted')
  }
  const nodes = new Map<string, GameIrNode>()
  for (const module of modules) {
    for (const node of module.nodes) {
      if (nodes.has(node.id))
        fail(`duplicate node ID ${node.id} across modules`)
      nodes.set(node.id, node)
    }
  }
  for (const module of modules) {
    for (const node of module.nodes) {
      for (const reference of node.references) {
        const target = nodes.get(reference.targetId)
        if (!target) fail(`reference ${node.id} targets an unknown node`)
        if (target.kind !== reference.targetType)
          fail(`reference ${node.id} target type does not match target node`)
      }
      for (const edge of node.edges) {
        const target = nodes.get(edge.targetId)
        if (!target) fail(`edge ${node.id} targets an unknown node`)
        if (target.kind !== edge.targetType)
          fail(`edge ${node.id} target type does not match target node`)
      }
    }
  }
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
