import { createHash } from 'node:crypto'
import {
  parseGameIrCompileRequest,
  type GameIrCompileRequest,
} from './contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'

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

export type GameIrNode = Readonly<{
  id: string
  kind: string
  producerMode: 'mechanical' | 'semantic' | 'derived'
  value: Readonly<Record<string, unknown>>
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
  digest: string
}>

type RecordValue = Record<string, unknown>

const FOUNDATION_DOCUMENTS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
const PRODUCER_MODES = new Set(['mechanical', 'semantic', 'derived'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA256 = /^[a-f0-9]{64}$/

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

function validateJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must contain a finite number`)
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) fail(`${path}/${index} is undefined`)
      validateJsonValue(value[index], `${path}/${index}`)
    }
    return
  }
  if (!isRecord(value)) fail(`${path} must contain only JSON values`)
  for (const [key, entry] of Object.entries(value)) {
    if (key.includes('\0')) fail(`${path} contains an unsafe object key`)
    validateJsonValue(entry, `${path}/${encodePointerSegment(key)}`)
  }
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
      ['documentPath', 'sectionId', 'digest'],
      'source section',
    )
    const documentPath = foundationDocumentPath(
      sectionValue.documentPath,
      'source section documentPath',
    )
    const sectionId = safeId(sectionValue.sectionId, 'source section sectionId')
    const sectionDigest = digest(sectionValue.digest, 'source section digest')
    if (!request.foundation.documentDigests[documentPath])
      fail('source section document is outside the Foundation receipt')
    const key = `${documentPath}\0${sectionId}`
    if (map.has(key)) fail('source sections contain a duplicate section')
    map.set(
      key,
      Object.freeze({ documentPath, sectionId, digest: sectionDigest }),
    )
  }
  return map
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
      entry.forEach((child, index) => visit(child, `${path}/${index}`))
      return
    }
    if (isRecord(entry)) {
      for (const [key, child] of Object.entries(entry))
        visit(child, `${path}/${encodePointerSegment(key)}`)
      return
    }
    leaves.push(path)
  }
  for (const [key, entry] of Object.entries(value))
    visit(entry, `/value/${encodePointerSegment(key)}`)
  return leaves
}

function localTargetExists(node: GameIrNode, pointer: string): boolean {
  const segments = pointerSegments(pointer)
  if (segments.length === 1 && segments[0] === 'id') return true
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
  return !Array.isArray(current) && !isRecord(current)
}

function parseNode(
  value: unknown,
  moduleId: string,
  sections: Map<string, GameIrSourceSection>,
  request: GameIrCompileRequest,
): GameIrNode {
  if (!isRecord(value)) fail(`node in module ${moduleId} must be an object`)
  exactKeys(value, ['id', 'kind', 'producerMode', 'value', 'bindings'], 'node')
  const id = safeId(value.id, 'node id')
  const kind = nonEmptyText(value.kind, `node ${id} kind`)
  if (
    typeof value.producerMode !== 'string' ||
    !PRODUCER_MODES.has(value.producerMode)
  )
    fail(`node ${id} has an unknown producer mode`)
  if (!isRecord(value.value)) fail(`node ${id} value must be an object`)
  validateJsonValue(value.value, `node ${id} value`)
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
    if (pointer !== '/id' && !pointer.startsWith('/value/'))
      fail(`node ${id} binding does not target /id or a value leaf`)
    const parsed = sourceBinding(binding, pointer, sections, request)
    parsedBindings[pointer] = parsed
  }

  const idBinding = parsedBindings['/id']
  if (!idBinding || idBinding.kind !== 'owner')
    fail(`node ${id} identity must have exactly one owner binding`)
  const leaves = valueLeafPointers(value.value)
  const leafSet = new Set(leaves)
  for (const pointer of Object.keys(parsedBindings)) {
    if (pointer !== '/id' && !leafSet.has(pointer))
      fail(`node ${id} binding ${pointer} does not target a value leaf`)
  }
  for (const pointer of leaves) {
    const binding = parsedBindings[pointer]
    if (!binding) fail(`node ${id} value leaf ${pointer} has no binding`)
    if (binding.kind === 'derived') {
      for (const input of binding.inputPointers) {
        if (
          !localTargetExists(
            { ...value, bindings: parsedBindings } as GameIrNode,
            input,
          )
        )
          fail(`node ${id} derived input ${input} does not target a local leaf`)
      }
    }
  }
  return {
    id,
    kind,
    producerMode: value.producerMode as GameIrNode['producerMode'],
    value: value.value,
    bindings: parsedBindings,
  }
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

export function parseGameIrCandidate(
  value: unknown,
  input: {
    request: GameIrCompileRequest
    sections: readonly GameIrSourceSection[]
  },
): GameIrCandidate {
  const request = parseGameIrCompileRequest(input.request)
  const sections = sourceSectionMap(input.sections, request)
  if (!isRecord(value)) fail('candidate must be an object')
  exactKeys(
    value,
    ['schemaVersion', 'taskId', 'foundationRevision', 'modules'],
    'candidate',
  )
  if (value.schemaVersion !== 'game-ir.v1')
    fail('candidate schemaVersion is invalid')
  const taskId = safeId(value.taskId, 'candidate taskId')
  if (taskId !== request.taskId)
    fail('candidate taskId does not match compile request')
  const foundationRevision = nonEmptyText(
    value.foundationRevision,
    'candidate foundationRevision',
  )
  if (foundationRevision !== request.foundation.foundationRevision)
    fail('candidate foundationRevision does not match compile request')
  if (!Array.isArray(value.modules)) fail('candidate modules must be an array')
  const modules = value.modules.map(module =>
    parseModule(module, sections, request),
  )
  for (let index = 1; index < modules.length; index += 1) {
    if (compare(modules[index - 1]!.moduleId, modules[index]!.moduleId) >= 0)
      fail('module IDs must be unique and sorted')
  }
  return deepFreeze({
    schemaVersion: 'game-ir.v1',
    taskId,
    foundationRevision,
    modules,
  })
}

export function canonicalGameIrJson(value: unknown): string {
  validateJsonValue(value, '$')
  return canonicalValue(value)
}

export function digestGameIrValue(value: unknown): string {
  return createHash('sha256').update(canonicalGameIrJson(value)).digest('hex')
}
