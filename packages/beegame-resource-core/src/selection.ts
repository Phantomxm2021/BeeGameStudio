import type {
  ResourceDimension,
  ResourceElement,
  ResourcePack,
  ResourceSelection,
  ResourceSelectionManifest,
  ResourceSelectionDependency,
  ResourceSlotRequirement,
} from './types'

export function selectResourceCandidates(
  packs: readonly ResourcePack[],
  elements: readonly ResourceElement[],
  requirements: readonly ResourceSlotRequirement[],
): ResourceSelectionManifest {
  const packById = new Map(packs.map(pack => [pack.id, pack]))
  const readyElementIds = new Set(elements.filter(element => element.status === 'ready').map(element => element.id))
  const selections: ResourceSelection[] = []
  const unmatchedSlotIds: string[] = []

  for (const requirement of requirements) {
    const candidates = rankResourceCandidates(packs, elements, requirement)
    const selected = candidates[0]
    if (selected) selections.push(selected)
    else unmatchedSlotIds.push(requirement.slotId)
  }

  return { selections, unmatchedSlotIds }
}

export function rankResourceCandidates(packs: readonly ResourcePack[], elements: readonly ResourceElement[], requirement: ResourceSlotRequirement): ResourceSelection[] {
  // Format is a hard runtime-compatibility boundary. A selection request that
  // omits it is incomplete, even if its semantic metadata happens to match.
  if (!requirement.acceptedFormats?.length) return []
  const packById = new Map(packs.map(pack => [pack.id, pack]))
  const readyElementIds = new Set(elements.filter(element => element.status === 'ready').map(element => element.id))
  const elementsById = new Map(elements.map(element => [element.id, element]))
  return elements.filter(element => isEligible(element, packById.get(element.packId), requirement, readyElementIds)).map(element => scoreCandidate(element, packById.get(element.packId)!, requirement, elementsById)).sort(compareSelection)
}

function isEligible(
  element: ResourceElement,
  pack: ResourcePack | undefined,
  requirement: ResourceSlotRequirement,
  readyElementIds: ReadonlySet<string>,
): boolean {
  if (!pack || pack.status !== 'published' || element.status !== 'ready') return false
  if (requirement.category && element.category !== requirement.category) return false
  if (requirement.acceptedFormats?.length && !requirement.acceptedFormats.map(normalize).includes(fileExtension(element.path))) return false
  if (element.dependencies.some(dependencyId => !readyElementIds.has(dependencyId))) return false
  if ((element.dependencyBindings ?? []).some(binding => !readyElementIds.has(binding.dependencyElementId))) return false
  // Style and game genre express fit, not binary technical compatibility.
  // A UI font or a generic effect can be valid across many game genres; score
  // those preferences below instead of silently excluding usable assets.
  if (requirement.tags?.length && !firstIntersection(requirement.tags, candidateTags(element))) return false
  return dimensionCompatible(requirement.dimension, element.dimensionOverride ?? pack.dimension)
}

function scoreCandidate(element: ResourceElement, pack: ResourcePack, requirement: ResourceSlotRequirement, elementsById: ReadonlyMap<string, ResourceElement>): ResourceSelection {
  let score = 0
  const reasons: string[] = ['status:ready', 'dependencies:ready']
  if (requirement.category === element.category) {
    score += 40
    reasons.push(`category:${element.category}`)
  }
  const extension = fileExtension(element.path)
  if (requirement.acceptedFormats?.length) {
    score += 30
    reasons.push(`format:${extension}`)
  }
  const candidateDimension = element.dimensionOverride ?? pack.dimension
  if (requirement.dimension && requirement.dimension !== 'agnostic' && candidateDimension === requirement.dimension) {
    score += 20
    reasons.push(`dimension:${candidateDimension}`)
  }
  const styleMatch = firstIntersection(requirement.styles, metadataValues(element.styleOverride ?? pack.style))
  if (styleMatch) {
    score += 10
    reasons.push(`style:${styleMatch}`)
  } else if (requirement.styles?.length) {
    reasons.push('style:unmatched')
  }
  const gameTypeMatch = firstIntersection(requirement.gameTypes, pack.gameTypes)
  if (gameTypeMatch) {
    score += 10
    reasons.push(`game-type:${gameTypeMatch}`)
  } else if (requirement.gameTypes?.length) {
    reasons.push('game-type:unmatched')
  }
  const tagMatch = firstIntersection(requirement.tags, candidateTags(element))
  if (tagMatch) {
    score += 10
    reasons.push(`tag:${tagMatch}`)
  }
  return { slotId: requirement.slotId, packId: pack.id, packVersion: pack.version, elementId: element.id, elementPath: element.path, score, reasons, dependencies: dependencyClosure(element, elementsById) }
}

function dependencyClosure(root: ResourceElement, elementsById: ReadonlyMap<string, ResourceElement>): ResourceSelectionDependency[] {
  const closure: ResourceSelectionDependency[] = []
  const visit = (element: ResourceElement, parentKey: string, ancestors: ReadonlySet<string>) => {
    for (const [index, binding] of (element.dependencyBindings ?? []).entries()) {
      const dependency = elementsById.get(binding.dependencyElementId)
      if (!dependency || ancestors.has(dependency.id)) continue
      const key = `${parentKey}.${index}`
      closure.push({ key, parentKey, elementId: dependency.id, elementPath: dependency.path, referencePath: binding.referencePath, ...(binding.kind ? { kind: binding.kind } : {}) })
      visit(dependency, key, new Set([...ancestors, dependency.id]))
    }
  }
  visit(root, 'root', new Set([root.id]))
  return closure
}

function compareSelection(left: ResourceSelection, right: ResourceSelection): number {
  return right.score - left.score || left.packId.localeCompare(right.packId) || left.elementId.localeCompare(right.elementId)
}

function dimensionCompatible(required: ResourceDimension | undefined, candidate: ResourceDimension): boolean {
  return !required || required === 'agnostic' || candidate === 'agnostic' || required === candidate
}

function fileExtension(path: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash ? normalize(path.slice(dot + 1)) : ''
}

function metadataValues(value: string | undefined): string[] {
  return (value ?? '').split('/').map(item => item.trim()).filter(Boolean)
}

/**
 * Pack tags describe broad library governance and discovery. Element usageTags
 * carry the specific capability that a project slot needs. They must never be
 * substituted for one another: a Pack may contain many unrelated resources.
 */
function candidateTags(element: ResourceElement): string[] {
  return [...new Set(element.usageTags ?? jsonStringArray(element.specs.usageTags))]
}

function jsonStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : []
  } catch {
    return []
  }
}

function firstIntersection(expected: readonly string[] | undefined, actual: readonly string[]): string | undefined {
  if (!expected?.length) return undefined
  const actualByNormalized = new Map(actual.map(value => [normalize(value), value]))
  for (const value of expected) {
    const match = actualByNormalized.get(normalize(value))
    if (match) return match
  }
  return undefined
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}
