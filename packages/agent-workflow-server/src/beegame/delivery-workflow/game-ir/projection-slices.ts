import {
  buildGameIrProjectionContract,
  buildGameIrProjectionSemanticJsonSchema,
  type GameIrProjectionContract,
  type GameIrProjectionModuleId,
} from './projection-contract'
import { canonicalGameIrJson, compareCodeUnits } from './model'
import type { FoundationDocumentPath } from '../types'

type EvidenceAuthority = Readonly<{
  sectionIndex: readonly Readonly<{
    documentPath: FoundationDocumentPath
    sectionId: string
    heading?: string
  }>[]
  sectionBytes: Readonly<Record<string, string>>
}>

export type GameIrEvidenceFragment = Readonly<{
  fragmentId: string
  documentPath: FoundationDocumentPath
  sectionId: string
  excerpt: string
}>

export type GameIrEvidenceFragmentCatalog = Readonly<{
  fragments: readonly GameIrEvidenceFragment[]
  modelSections: readonly Readonly<{
    documentPath: FoundationDocumentPath
    sectionId: string
    heading?: string
    evidenceFragments: readonly Readonly<{
      fragmentId: string
      text: string
    }>[]
  }>[]
}>

/** Builds the sole exact, model-selectable evidence catalog for a source. */
export function buildGameIrEvidenceFragmentCatalog(
  authority: EvidenceAuthority,
): GameIrEvidenceFragmentCatalog {
  const fragments: GameIrEvidenceFragment[] = []
  const modelSections = authority.sectionIndex.map((section, sectionIndex) => {
    const key = `${section.documentPath}#${section.sectionId}`
    const source = authority.sectionBytes[key]
    if (source === undefined)
      throw new Error(`Game IR evidence source section is missing: ${key}`)
    const evidenceFragments: Array<{ fragmentId: string; text: string }> = []
    let lineIndex = 0
    for (const match of source.matchAll(/[^\r\n]+/g)) {
      const excerpt = match[0]
      const fragmentId = `e${sectionIndex}.${lineIndex}`
      lineIndex += 1
      if (excerpt.trim().length === 0) continue
      const start = source.indexOf(excerpt)
      if (start !== match.index || source.indexOf(excerpt, start + 1) >= 0)
        continue
      fragments.push({
        fragmentId,
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        excerpt,
      })
      evidenceFragments.push({ fragmentId, text: excerpt })
    }
    if (evidenceFragments.length === 0 && source.trim().length > 0) {
      const fragmentId = `e${sectionIndex}.0`
      fragments.push({
        fragmentId,
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        excerpt: source,
      })
      evidenceFragments.push({ fragmentId, text: source })
    }
    return {
      documentPath: section.documentPath,
      sectionId: section.sectionId,
      ...(section.heading ? { heading: section.heading } : {}),
      evidenceFragments,
    }
  })
  return Object.freeze({
    fragments: Object.freeze(
      fragments.map(fragment => Object.freeze(fragment)),
    ),
    modelSections: Object.freeze(
      modelSections.map(section =>
        Object.freeze({
          ...section,
          evidenceFragments: Object.freeze(
            section.evidenceFragments.map(fragment => Object.freeze(fragment)),
          ),
        }),
      ),
    ),
  })
}

export function resolveGameIrEvidenceFragment(
  catalog: GameIrEvidenceFragmentCatalog,
  fragmentId: string,
): GameIrEvidenceFragment {
  const fragment = catalog.fragments.find(
    candidate => candidate.fragmentId === fragmentId,
  )
  if (!fragment)
    throw new Error(`unknown Game IR evidence fragment: ${fragmentId}`)
  return fragment
}

type ProjectionNodeContract = GameIrProjectionContract['nodes'][number]

export type GameIrProjectionSlice = Readonly<{
  sliceId: string
  nodeKinds: readonly string[]
  nodes: readonly ProjectionNodeContract[]
}>

export type GameIrProjectionSlicePlan = Readonly<{
  moduleId: GameIrProjectionModuleId
  slices: readonly GameIrProjectionSlice[]
}>

export type GameIrProjectionSliceContext = Readonly<{
  availablePriorNodes: readonly Readonly<{
    id: string
    kind: string
    value: Readonly<Record<string, unknown>>
  }>[]
  requiredCurrentNodes: readonly Readonly<{ id: string; kind: string }>[]
  admittedCurrentNodes: readonly Readonly<{ id: string; kind: string }>[]
}>

export type GameIrProjectionRetryDiagnostic =
  | Readonly<{ scope: 'slice'; sliceId: string; reason: string }>
  | Readonly<{
      scope: 'record'
      sliceId: string
      recordId: string
      fragmentId: string
      reason: string
    }>

function exactContextKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  )
}

/** Strictly admits the sole compact dependency context for one slice turn. */
export function normalizeGameIrProjectionSliceContext(input: {
  moduleId: GameIrProjectionModuleId
  sliceId: string
  value: unknown
}): GameIrProjectionSliceContext {
  if (
    !input.value ||
    typeof input.value !== 'object' ||
    Array.isArray(input.value)
  )
    throw new Error('Game IR projection slice context must be a plain object')
  const value = input.value as Record<string, unknown>
  if (!exactContextKeys(value, [
    'availablePriorNodes',
    'requiredCurrentNodes',
    'admittedCurrentNodes',
  ]))
    throw new Error('Game IR projection slice context is non-canonical')
  const plan = deriveProjectionSlicePlan(input.moduleId)
  const currentIndex = plan.slices.findIndex(
    slice => slice.sliceId === input.sliceId,
  )
  if (currentIndex < 0)
    throw new Error('Game IR projection slice context is detached')
  const priorKinds = new Set(
    plan.slices.slice(0, currentIndex).flatMap(slice => slice.nodeKinds),
  )
  const currentKinds = new Set(plan.slices[currentIndex]!.nodeKinds)
  const normalizeTargets = (
    raw: unknown,
    label: string,
    allowedKinds: ReadonlySet<string>,
    includeValue: boolean,
  ): readonly Readonly<{ id: string; kind: string }>[] => {
    if (!Array.isArray(raw))
      throw new Error(`Game IR projection ${label} must be an array`)
    const targets = raw.map((candidate, index) => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate) ||
        !exactContextKeys(
          candidate as Record<string, unknown>,
          includeValue ? ['id', 'kind', 'value'] : ['id', 'kind'],
        )
      )
        throw new Error(`Game IR projection ${label}[${index}] is invalid`)
      const { id, kind } = candidate as Record<string, unknown>
      if (
        typeof id !== 'string' ||
        id.trim().length === 0 ||
        typeof kind !== 'string' ||
        !allowedKinds.has(kind)
      )
        throw new Error(`Game IR projection ${label}[${index}] is detached`)
      if (!includeValue) return Object.freeze({ id, kind })
      if (
        !candidate.value ||
        typeof candidate.value !== 'object' ||
        Array.isArray(candidate.value)
      )
        throw new Error(`Game IR projection ${label}[${index}] is invalid`)
      return Object.freeze({
        id,
        kind,
        value: Object.freeze(
          JSON.parse(canonicalGameIrJson(candidate.value)) as Record<
            string,
            unknown
          >,
        ),
      })
    })
    const sorted = [...targets].sort((left, right) =>
      compareCodeUnits(
        `${left.id}\0${left.kind}`,
        `${right.id}\0${right.kind}`,
      ),
    )
    if (
      sorted.some(
        (target, index) =>
          target !== targets[index] ||
          (index > 0 && target.id === sorted[index - 1]!.id),
      )
    )
      throw new Error(`Game IR projection ${label} is not unique and sorted`)
    return Object.freeze(targets)
  }
  return Object.freeze({
    availablePriorNodes: normalizeTargets(
      value.availablePriorNodes,
      'availablePriorNodes',
      priorKinds,
      true,
    ) as GameIrProjectionSliceContext['availablePriorNodes'],
    requiredCurrentNodes: normalizeTargets(
      value.requiredCurrentNodes,
      'requiredCurrentNodes',
      currentKinds,
      false,
    ),
    admittedCurrentNodes: normalizeTargets(
      value.admittedCurrentNodes,
      'admittedCurrentNodes',
      currentKinds,
      false,
    ),
  })
}

function stronglyConnectedComponents(
  kinds: readonly string[],
  outgoing: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const indexes = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []
  let nextIndex = 0

  const visit = (kind: string): void => {
    indexes.set(kind, nextIndex)
    lowLinks.set(kind, nextIndex)
    nextIndex += 1
    stack.push(kind)
    onStack.add(kind)

    for (const target of outgoing.get(kind) ?? []) {
      if (!indexes.has(target)) {
        visit(target)
        lowLinks.set(kind, Math.min(lowLinks.get(kind)!, lowLinks.get(target)!))
      } else if (onStack.has(target)) {
        lowLinks.set(kind, Math.min(lowLinks.get(kind)!, indexes.get(target)!))
      }
    }

    if (lowLinks.get(kind) !== indexes.get(kind)) return
    const component: string[] = []
    let target: string
    do {
      target = stack.pop()!
      onStack.delete(target)
      component.push(target)
    } while (target !== kind)
    components.push(component.sort(compareCodeUnits))
  }

  for (const kind of kinds) if (!indexes.has(kind)) visit(kind)
  return components
}

function topologicallyOrderComponents(
  components: readonly string[][],
  outgoing: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const componentByKind = new Map<string, number>()
  components.forEach((component, index) => {
    component.forEach(kind => componentByKind.set(kind, index))
  })
  const componentEdges = components.map(() => new Set<number>())
  const indegree = components.map(() => 0)
  for (const [kind, targets] of outgoing) {
    const sourceComponent = componentByKind.get(kind)!
    for (const target of targets) {
      const targetComponent = componentByKind.get(target)!
      if (
        sourceComponent !== targetComponent &&
        !componentEdges[targetComponent]!.has(sourceComponent)
      ) {
        componentEdges[targetComponent]!.add(sourceComponent)
        indegree[sourceComponent] += 1
      }
    }
  }

  const componentKey = (index: number): string => components[index]!.join('\0')
  const ready = components
    .map((_, index) => index)
    .filter(index => indegree[index] === 0)
    .sort((left, right) =>
      compareCodeUnits(componentKey(left), componentKey(right)),
    )
  const remaining = new Set(components.map((_, index) => index))
  const frontiers: string[][] = []
  while (remaining.size) {
    const frontier = ready.splice(0)
    if (frontier.length === 0)
      throw new Error('projection slice dependency graph is not acyclic')
    frontiers.push(frontier.flatMap(index => components[index]!))
    for (const index of frontier) {
      remaining.delete(index)
      for (const target of componentEdges[index]!) indegree[target] -= 1
    }
    ready.push(
      ...[...remaining]
        .filter(index => indegree[index] === 0)
        .sort((left, right) =>
          compareCodeUnits(componentKey(left), componentKey(right)),
        ),
    )
  }
  return frontiers
}

export function deriveProjectionSlicePlan(
  moduleId: GameIrProjectionModuleId,
): GameIrProjectionSlicePlan {
  const contract = buildGameIrProjectionContract(moduleId)
  const nodesByKind = new Map(contract.nodes.map(node => [node.kind, node]))
  const kinds = [...nodesByKind.keys()].sort(compareCodeUnits)
  const kindSet = new Set(kinds)
  const outgoing = new Map<string, readonly string[]>()
  for (const node of contract.nodes) {
    outgoing.set(
      node.kind,
      Object.freeze(
        [
          ...new Set(
            node.relationships.flatMap(relationship =>
              relationship.targetKinds.filter(target => kindSet.has(target)),
            ),
          ),
        ].sort(compareCodeUnits),
      ),
    )
  }

  const components = topologicallyOrderComponents(
    stronglyConnectedComponents(kinds, outgoing),
    outgoing,
  )
  const slices = components.map((nodeKinds, index) =>
    Object.freeze({
      sliceId: `${moduleId}.slice.${index}`,
      nodeKinds: Object.freeze([...nodeKinds]),
      nodes: Object.freeze(nodeKinds.map(kind => nodesByKind.get(kind)!)),
    }),
  )
  return Object.freeze({
    moduleId,
    slices: Object.freeze(slices),
  })
}

export function buildGameIrProjectionSliceAdmissionJsonSchema(
  moduleId: GameIrProjectionModuleId,
  slice: GameIrProjectionSlice,
): Record<string, unknown> {
  const canonical = deriveProjectionSlicePlan(moduleId).slices.find(
    candidate => candidate.sliceId === slice.sliceId,
  )
  const nodeKinds = [...slice.nodeKinds]
  if (
    !canonical ||
    nodeKinds.length !== canonical.nodeKinds.length ||
    nodeKinds.some((kind, index) => kind !== canonical.nodeKinds[index]) ||
    slice.nodes.length !== canonical.nodes.length ||
    slice.nodes.some(
      (node, index) =>
        JSON.stringify(node) !== JSON.stringify(canonical.nodes[index]),
    )
  )
    throw new Error(`invalid projection slice for ${moduleId}`)
  const semanticWithDefinitions = buildGameIrProjectionSemanticJsonSchema(
    moduleId,
    nodeKinds,
  )
  const { $defs, ...semantic } = semanticWithDefinitions
  return {
    $defs,
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { const: 'completed' },
      sliceId: { const: slice.sliceId },
      semantic,
    },
    required: ['status', 'sliceId', 'semantic'],
  }
}
