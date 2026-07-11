import type {
  ResourceDimension,
  ResourceElement,
  ResourcePack,
  ResourceSelection,
  ResourceSelectionManifest,
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
  const packById = new Map(packs.map(pack => [pack.id, pack]))
  const readyElementIds = new Set(elements.filter(element => element.status === 'ready').map(element => element.id))
  return elements.filter(element => isEligible(element, packById.get(element.packId), requirement, readyElementIds)).map(element => scoreCandidate(element, packById.get(element.packId)!, requirement)).sort(compareSelection)
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
  if (requirement.tags?.length && !firstIntersection(requirement.tags, pack.tags ?? [])) return false
  return dimensionCompatible(requirement.dimension, element.dimensionOverride ?? pack.dimension)
}

function scoreCandidate(element: ResourceElement, pack: ResourcePack, requirement: ResourceSlotRequirement): ResourceSelection {
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
  }
  const gameTypeMatch = firstIntersection(requirement.gameTypes, pack.gameTypes)
  if (gameTypeMatch) {
    score += 10
    reasons.push(`game-type:${gameTypeMatch}`)
  }
  const tagMatch = firstIntersection(requirement.tags, pack.tags ?? [])
  if (tagMatch) {
    score += 10
    reasons.push(`tag:${tagMatch}`)
  }
  return { slotId: requirement.slotId, packId: pack.id, packVersion: pack.version, elementId: element.id, elementPath: element.path, score, reasons }
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
