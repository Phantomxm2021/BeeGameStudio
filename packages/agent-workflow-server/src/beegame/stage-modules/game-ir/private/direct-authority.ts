import Ajv from 'ajv'
import { GAME_IR_CANONICAL_MODULE_IDS, parseGameIrCompileRequest, type GameIrCompileRequest, type GameIrModuleId } from './core/contracts'
import { buildGameIrProjectionContract, buildGameIrProjectionSemanticJsonSchema } from './core/projection-contract'
import { canonicalGameIrJson, compareCodeUnits, parseGameIrCandidate, type GameIrCandidate, type GameIrSourceBinding, type GameIrSourceSection } from './core/model'

type DirectNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly Readonly<{ targetId: string; targetType: string }>[]
  edges: readonly Readonly<{ type: string; targetId: string; targetType: string }>[]
  source: Readonly<{ documentPath: string; sectionId: string }>
}>

export type DirectGameIrAuthority = Readonly<{
  request: GameIrCompileRequest
  sections: readonly GameIrSourceSection[]
  candidate: GameIrCandidate
}>

export type DirectGameIrInputFiles = Readonly<Record<string, string>>

const ajv = new Ajv({ allErrors: true, strict: true })
const validators = new Map<GameIrModuleId, ReturnType<typeof ajv.compile>>()

function exactObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits)
  const expected = [...keys].sort(compareCodeUnits)
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new Error(`${label} fields must be exactly ${expected.join(', ')}`)
}

function leafPointers(value: Record<string, unknown>): string[] {
  const result: string[] = []
  const escape = (part: string) => part.replace(/~/gu, '~0').replace(/\//gu, '~1')
  const visit = (entry: unknown, path: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) result.push(path)
      else entry.forEach((child, index) => visit(child, `${path}/${index}`))
      return
    }
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) result.push(path)
      else for (const [key, child] of entries) visit(child, `${path}/${escape(key)}`)
      return
    }
    result.push(path)
  }
  visit(value, '/value')
  return result
}

function validator(moduleId: GameIrModuleId) {
  const existing = validators.get(moduleId)
  if (existing) return existing
  const kinds = buildGameIrProjectionContract(moduleId).nodes.map(node => node.kind)
  const compiled = ajv.compile(buildGameIrProjectionSemanticJsonSchema(moduleId, kinds))
  validators.set(moduleId, compiled)
  return compiled
}

function validateRelationshipCounts(moduleId: GameIrModuleId, nodes: readonly DirectNode[]): void {
  const contract = buildGameIrProjectionContract(moduleId)
  const byKind = new Map(contract.nodes.map(node => [node.kind, node]))
  for (const node of nodes) {
    const nodeContract = byKind.get(node.kind)!
    for (const relationship of nodeContract.relationships) {
      const count = node.edges.filter(edge => edge.type === relationship.role).length
      const valid = relationship.cardinality === 'exactly-one' ? count === 1
        : relationship.cardinality === 'zero-or-one' ? count <= 1
          : relationship.cardinality === 'at-least-one' ? count >= 1 : true
      if (!valid) throw new Error(`${moduleId} node ${node.id} relationship ${relationship.role} requires ${relationship.cardinality}`)
    }
  }
}

function binding(section: GameIrSourceSection): GameIrSourceBinding {
  return { kind: 'owner', documentPath: section.documentPath, sectionId: section.sectionId,
    sectionDigest: section.digest, sourcePointer: '/section' }
}

const REFERENCE_INDEX_FIELDS = new Set([
  'referenceIndex',
  'unitReferenceIndex',
  'outputUnitReferenceIndex',
  'targetReferenceIndex',
  'waypointReferenceIndex',
])

function normalizeDirectNode(node: DirectNode, label: string): DirectNode {
  if (!Array.isArray(node.references)) throw new Error(`${label}.references must be an array`)
  const entries = node.references.map((rawReference, oldIndex) => {
    const reference = exactObject(rawReference, `${label}.references[${oldIndex}]`)
    exactKeys(reference, ['targetId', 'targetType'], `${label}.references[${oldIndex}]`)
    if (typeof reference.targetId !== 'string' || typeof reference.targetType !== 'string')
      throw new Error(`${label}.references[${oldIndex}] targetId and targetType must be strings`)
    return { oldIndex, key: `${reference.targetId}\0${reference.targetType}`,
      reference: { targetId: reference.targetId, targetType: reference.targetType } }
  })
  const unique = new Map(entries.map(entry => [entry.key, entry.reference]))
  const references = [...unique.entries()].sort(([left], [right]) => compareCodeUnits(left, right)).map(([, reference]) => reference)
  const indexByKey = new Map(references.map((reference, index) => [`${reference.targetId}\0${reference.targetType}`, index]))
  const remap = new Map(entries.map(entry => [entry.oldIndex, indexByKey.get(entry.key)!]))
  const remapValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remapValue)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      REFERENCE_INDEX_FIELDS.has(key) && Number.isInteger(child) && remap.has(child as number)
        ? remap.get(child as number)!
        : remapValue(child),
    ]))
  }
  return { ...node, value: remapValue(node.value) as Readonly<Record<string, unknown>>, references }
}

/** Convert one compact CLI-authored draft into the stable public IR model. */
export function admitDirectGameIrDraft(input: {
  draft: unknown
  request: GameIrCompileRequest
  sections: readonly GameIrSourceSection[]
}): GameIrCandidate {
  const request = parseGameIrCompileRequest(input.request)
  const root = exactObject(input.draft, 'IR draft')
  exactKeys(root, ['schemaVersion', 'modules'], 'IR draft')
  if (root.schemaVersion !== 'game-ir-direct-draft.v1' || !Array.isArray(root.modules))
    throw new Error('IR draft schema or modules are invalid')
  const sectionMap = new Map(input.sections.map(section => [`${section.documentPath}\0${section.sectionId}`, section]))
  const rawModules = root.modules.map((raw, index) => {
    const module = exactObject(raw, `module ${index}`)
    exactKeys(module, ['moduleId', 'nodes'], `module ${index}`)
    if (!GAME_IR_CANONICAL_MODULE_IDS.includes(module.moduleId as GameIrModuleId) || !Array.isArray(module.nodes))
      throw new Error(`module ${index} identity or nodes are invalid`)
    const moduleId = module.moduleId as GameIrModuleId
    if (module.nodes.length === 0) throw new Error(`module ${moduleId} must not be empty`)
    const directNodes = module.nodes.map((rawNode, nodeIndex) => {
      const node = exactObject(rawNode, `${moduleId} node ${nodeIndex}`)
      exactKeys(node, ['id', 'kind', 'value', 'references', 'edges', 'source'], `${moduleId} node ${nodeIndex}`)
      const source = exactObject(node.source, `${moduleId} node ${nodeIndex} source`)
      exactKeys(source, ['documentPath', 'sectionId'], `${moduleId} node ${nodeIndex} source`)
      return normalizeDirectNode(node as unknown as DirectNode, `${moduleId} node ${nodeIndex}`)
    })
    const semantic = { nodes: directNodes.map(({ source: _source, ...node }) => node), sourceEvidenceGroups: [] }
    const validate = validator(moduleId)
    if (!validate(semantic))
      throw new Error(`${moduleId} node contract failed: ${ajv.errorsText(validate.errors, { separator: '; ' })}`)
    validateRelationshipCounts(moduleId, directNodes)
    const nodes = directNodes.map(node => {
      const section = sectionMap.get(`${node.source.documentPath}\0${node.source.sectionId}`)
      if (!section) throw new Error(`${moduleId} node ${node.id} source section is unknown`)
      const owner = binding(section)
      const pointers = ['/id', ...leafPointers(node.value),
        ...node.references.map((_, index) => `/references/${index}`),
        ...node.edges.map((_, index) => `/edges/${index}`)]
      return { id: node.id, kind: node.kind, producerMode: 'semantic' as const, value: node.value,
        references: node.references,
        edges: [...node.edges].sort((a, b) => compareCodeUnits(`${a.type}\0${a.targetId}\0${a.targetType}`, `${b.type}\0${b.targetId}\0${b.targetType}`)),
        bindings: Object.fromEntries(pointers.sort(compareCodeUnits).map(pointer => [pointer, owner])) }
    }).sort((a, b) => compareCodeUnits(a.id, b.id))
    return { moduleId, nodes }
  }).sort((a, b) => compareCodeUnits(a.moduleId, b.moduleId))
  if (rawModules.length !== GAME_IR_CANONICAL_MODULE_IDS.length ||
      rawModules.some((module, index) => module.moduleId !== [...GAME_IR_CANONICAL_MODULE_IDS].sort(compareCodeUnits)[index]))
    throw new Error('IR draft must contain each canonical module exactly once')
  const candidate = parseGameIrCandidate({ schemaVersion: 'game-ir.v1', taskId: request.taskId,
    foundationRevision: request.foundation.foundationRevision, modules: rawModules }, { request, sections: input.sections })
  const verification = candidate.modules.find(module => module.moduleId === 'implementation-verification')!
  if (!verification.nodes.some(node => node.kind === 'implementation-verification.acceptance-scenario'))
    throw new Error('implementation-verification must contain an acceptance scenario')
  return candidate
}

export function renderDirectGameIrAuthority(input: {
  request: GameIrCompileRequest
  sections: readonly GameIrSourceSection[]
}): string {
  return [
    '# Game IR CLI task',
    '',
    'Create the smallest six-domain Game IR execution projection needed by downstream resource delivery, content configuration, target implementation and acceptance.',
    'Use your judgment to select only requirements those downstream consumers must address. Keep supporting prose and unconsumed detail in the source documents instead of copying them into IR.',
    'Include each canonical module exactly once. Do not emit a node merely because its kind exists, and do not split every sentence, scalar, UI string or example into a separate node. Do not invent requirements absent from the documents.',
    'Preserve concrete resource acceptance facts from the source documents in acquisition-profile.acceptanceCriteria. Do not collapse visual medium, palette, material, lighting or cross-asset coherence into broad style tags.',
    'Every node must cite one exact source section from the catalog. IDs must be globally unique. Every reference and edge must resolve to an emitted node with the exact target kind.',
    '',
    '## Output shape',
    '',
    '- Root fields: `schemaVersion` (exactly `game-ir-direct-draft.v1`) and `modules`.',
    '- Module fields: `moduleId` and `nodes`.',
    '- Node fields: `id`, `kind`, `value`, `references`, `edges`, and `source`.',
    '- Every reference is exactly `{ "targetId": "...", "targetType": "..." }`.',
    '- Every edge is exactly `{ "type": "<relationship role>", "targetId": "...", "targetType": "..." }`.',
    '- Relationship obligations are defined only by `cardinality` in `node-contracts.json`.',
    '- Source fields: `documentPath` and `sectionId` from the catalog below.',
    '',
    'Read `source-sections.json` for valid source citations and `node-contracts.json` for the six-domain contracts.',
  ].join('\n')
}

export function renderDirectGameIrInputFiles(input: {
  sections: readonly GameIrSourceSection[]
}): DirectGameIrInputFiles {
  const serialize = (value: unknown): string => `${JSON.stringify(value)}\n`
  const contracts = Object.fromEntries(GAME_IR_CANONICAL_MODULE_IDS.map(moduleId => {
    const contract = buildGameIrProjectionContract(moduleId)
    return [moduleId, { moduleId, nodes: contract.nodes }]
  }))
  const result: Record<string, string> = {
    'source-sections.json': serialize(input.sections.map(section => ({ documentPath: section.documentPath,
      sectionId: section.sectionId, heading: section.heading, startLine: section.startLine, endLine: section.endLine }))),
    'node-contracts.json': serialize(contracts),
  }
  return result
}
