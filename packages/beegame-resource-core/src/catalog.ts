import type {
  ResourceAssetKind,
  ResourceCapability,
  ResourceCatalogElement,
  ResourceCatalogFacets,
  ResourceCatalogFilter,
  ResourceCatalogPack,
  ResourceCatalogPage,
  ResourceCatalogRequest,
  ResourceCategory,
  ResourceDimension,
  ResourceElement,
  ResourcePack,
  ResourcePackPrimaryCategory,
  ResourceUsageTag,
} from './types'
import { normalizeResourceTechnicalFacts } from './technical-facts'

/**
 * Browse published Packs without first inventing requirement slots or roles.
 * Filtering is exact and metadata-driven; free-form intent remains Claude
 * Code's reasoning input and is never interpreted here with name heuristics.
 */
export function browseResourceCatalogPacks(
  packs: readonly ResourcePack[],
  elements: readonly ResourceElement[],
  request: ResourceCatalogRequest,
): ResourceCatalogPage<ResourceCatalogPack> {
  const published = packs.filter(pack => pack.status === 'published')
  const readyIds = readyDependencyIds(elements)
  const readyByPack = new Map<string, ResourceElement[]>()
  for (const element of elements) {
    if (element.status !== 'ready' || !hasCompleteDependencyClosure(element, readyIds)) continue
    const list = readyByPack.get(element.packId) ?? []
    list.push(element)
    readyByPack.set(element.packId, list)
  }
  const filtered = published
    .map(pack => ({ pack, elements: readyByPack.get(pack.id) ?? [] }))
    .filter(entry => packMatches(entry.pack, entry.elements, request.filters))
    .sort((left, right) => compareText(left.pack.name, right.pack.name) || compareText(left.pack.id, right.pack.id))
  const facets = collectFacets(filtered.map(entry => entry.pack), filtered.flatMap(entry => entry.elements))
  return page(filtered.map(({ pack, elements: packElements }) => summarizePack(pack, packElements)), request, facets, item => item.packId)
}

/** Browse pre-aggregated Pack summaries without loading every element. */
export function browseResourceCatalogPackSummaries(
  summaries: readonly ResourceCatalogPack[],
  request: ResourceCatalogRequest,
): ResourceCatalogPage<ResourceCatalogPack> {
  const filtered = summaries
    .filter(pack => catalogPackMatches(pack, request.filters))
    .sort((left, right) => compareText(left.packName, right.packName) || compareText(left.packId, right.packId))
  return page(filtered, request, collectSummaryFacets(filtered), item => item.packId)
}

/**
 * Browse reusable logical roots inside one Pack. The Pack is the default
 * style/licensing coherence boundary; callers may deliberately inspect more
 * than one Pack, but the catalog never mixes them into one automatic result.
 */
export function browseResourcePackElements(
  packs: readonly ResourcePack[],
  elements: readonly ResourceElement[],
  packId: string,
  request: ResourceCatalogRequest,
): ResourceCatalogPage<ResourceCatalogElement> {
  const published = packs.filter(pack => pack.status === 'published')
  const packById = new Map(published.map(pack => [pack.id, pack]))
  const readyIds = readyDependencyIds(elements)
  const eligible = elements
    .filter(element => element.packId === packId && element.status === 'ready' && packById.has(element.packId) && hasCompleteDependencyClosure(element, readyIds))
    .filter(element => elementMatches(element, packById.get(element.packId)!, request.filters))
    .sort((left, right) => {
      const leftPack = packById.get(left.packId)!
      const rightPack = packById.get(right.packId)!
      return compareText(leftPack.name, rightPack.name) || compareText(left.path, right.path) || compareText(left.id, right.id)
    })
  const scopedPacks = [...new Map(eligible.map(element => [element.packId, packById.get(element.packId)!])).values()]
  const facets = collectFacets(scopedPacks, eligible)
  return page(eligible.map(element => summarizeElement(packById.get(element.packId)!, element)), request, facets, item => item.elementId)
}

function packMatches(pack: ResourcePack, elements: readonly ResourceElement[], filters?: ResourceCatalogFilter): boolean {
  if (!filters) return true
  if (filters.packIds?.length && !filters.packIds.includes(pack.id)) return false
  if (filters.dimensions?.length && !filters.dimensions.includes(pack.dimension)) return false
  if (filters.primaryCategories?.length && !filters.primaryCategories.includes(pack.primaryCategory)) return false
  if (filters.styles?.length && !intersectsNormalized(filters.styles, packStyles(pack))) return false
  if (filters.gameTypes?.length && !intersectsNormalized(filters.gameTypes, pack.gameTypes)) return false
  if (filters.packTags?.length && !intersectsNormalized(filters.packTags, pack.tags ?? [])) return false
  if (filters.categories?.length && !elements.some(element => filters.categories!.includes(element.category))) return false
  if (filters.usageTags?.length && !elements.some(element => intersects(filters.usageTags!, element.usageTags ?? []))) return false
  if (filters.assetKinds?.length && !elements.some(element => element.assetKind && filters.assetKinds!.includes(element.assetKind))) return false
  if (filters.capabilities?.length && !elements.some(element => filters.capabilities!.every(capability => element.capabilities?.includes(capability)))) return false
  if (filters.formats?.length && !elements.some(element => includesFormat(filters.formats!, element.path))) return false
  return true
}

function elementMatches(element: ResourceElement, pack: ResourcePack, filters?: ResourceCatalogFilter): boolean {
  if (!filters) return true
  if (filters.packIds?.length && !filters.packIds.includes(pack.id)) return false
  const dimension = element.dimensionOverride ?? pack.dimension
  if (filters.dimensions?.length && !filters.dimensions.includes(dimension)) return false
  if (filters.primaryCategories?.length && !filters.primaryCategories.includes(pack.primaryCategory)) return false
  if (filters.categories?.length && !filters.categories.includes(element.category)) return false
  if (filters.styles?.length && !intersectsNormalized(filters.styles, element.styleOverride ? [element.styleOverride] : packStyles(pack))) return false
  if (filters.gameTypes?.length && !intersectsNormalized(filters.gameTypes, pack.gameTypes)) return false
  if (filters.packTags?.length && !intersectsNormalized(filters.packTags, pack.tags ?? [])) return false
  if (filters.usageTags?.length && !intersects(filters.usageTags, element.usageTags ?? [])) return false
  if (filters.assetKinds?.length && (!element.assetKind || !filters.assetKinds.includes(element.assetKind))) return false
  if (filters.capabilities?.length && !filters.capabilities.every(capability => element.capabilities?.includes(capability))) return false
  if (filters.formats?.length && !includesFormat(filters.formats, element.path)) return false
  return true
}

function summarizePack(pack: ResourcePack, elements: readonly ResourceElement[]): ResourceCatalogPack {
  return {
    packId: pack.id,
    packVersion: pack.version,
    packName: pack.name,
    style: pack.style,
    styles: packStyles(pack),
    gameTypes: [...pack.gameTypes],
    dimension: pack.dimension,
    primaryCategory: pack.primaryCategory,
    categories: unique(elements.map(element => element.category)),
    tags: [...(pack.tags ?? [])],
    readyElementCount: elements.length,
    assetKinds: unique(elements.map(element => element.assetKind).filter((value): value is ResourceAssetKind => Boolean(value))),
    usageTags: unique(elements.flatMap(element => [...(element.usageTags ?? [])])),
    capabilities: unique(elements.flatMap(element => [...(element.capabilities ?? [])])),
    formats: unique(elements.map(element => fileExtension(element.path)).filter(Boolean)),
    ...(pack.description ? { description: pack.description } : {}),
    license: pack.license,
    ...(pack.author ? { author: pack.author } : {}),
    ...(pack.source ? { source: pack.source } : {}),
    compatibleEngines: [...(pack.compatibleEngines ?? [])],
  }
}

function catalogPackMatches(pack: ResourceCatalogPack, filters?: ResourceCatalogFilter): boolean {
  if (!filters) return true
  if (filters.packIds?.length && !filters.packIds.includes(pack.packId)) return false
  if (filters.dimensions?.length && !filters.dimensions.includes(pack.dimension)) return false
  if (filters.primaryCategories?.length && !filters.primaryCategories.includes(pack.primaryCategory)) return false
  if (filters.styles?.length && !intersectsNormalized(filters.styles, pack.styles)) return false
  if (filters.gameTypes?.length && !intersectsNormalized(filters.gameTypes, pack.gameTypes)) return false
  if (filters.packTags?.length && !intersectsNormalized(filters.packTags, pack.tags)) return false
  if (filters.categories?.length && !intersects(filters.categories, pack.categories)) return false
  if (filters.usageTags?.length && !intersects(filters.usageTags, pack.usageTags)) return false
  if (filters.assetKinds?.length && !intersects(filters.assetKinds, pack.assetKinds)) return false
  if (filters.capabilities?.length && !filters.capabilities.every(value => pack.capabilities.includes(value))) return false
  if (filters.formats?.length && !intersectsNormalized(filters.formats.map(value => value.replace(/^\./, '')), pack.formats)) return false
  return true
}

function collectSummaryFacets(packs: readonly ResourceCatalogPack[]): ResourceCatalogFacets {
  return {
    dimensions: unique(packs.map(pack => pack.dimension)),
    primaryCategories: unique(packs.map(pack => pack.primaryCategory)),
    categories: unique(packs.flatMap(pack => [...pack.categories])),
    styles: unique(packs.flatMap(pack => [...pack.styles])),
    gameTypes: unique(packs.flatMap(pack => [...pack.gameTypes])),
    packTags: unique(packs.flatMap(pack => [...pack.tags])),
    usageTags: unique(packs.flatMap(pack => [...pack.usageTags])),
    assetKinds: unique(packs.flatMap(pack => [...pack.assetKinds])),
    capabilities: unique(packs.flatMap(pack => [...pack.capabilities])),
    formats: unique(packs.flatMap(pack => [...pack.formats])),
  }
}

function summarizeElement(pack: ResourcePack, element: ResourceElement): ResourceCatalogElement {
  return {
    packId: pack.id,
    packVersion: pack.version,
    packName: pack.name,
    packStyle: element.styleOverride ?? pack.style,
    packStyles: element.styleOverride ? [element.styleOverride] : packStyles(pack),
    packGameTypes: [...pack.gameTypes],
    elementId: element.id,
    elementName: element.name,
    elementPath: element.path,
    ...(element.preview ? { preview: element.preview } : {}),
    category: element.category,
    dimension: element.dimensionOverride ?? pack.dimension,
    usageTags: [...(element.usageTags ?? [])],
    ...(element.assetKind ? { assetKind: element.assetKind } : {}),
    capabilities: [...(element.capabilities ?? [])],
    ...(element.contentProfile ? { contentProfile: element.contentProfile } : {}),
    ...(Object.keys(element.specs).length ? { technicalFacts: normalizeResourceTechnicalFacts(element.specs) } : {}),
    relations: [...(element.relations ?? [])],
    dependencyCount: element.dependencies.length + (element.dependencyBindings?.length ?? 0),
  }
}

function collectFacets(packs: readonly ResourcePack[], elements: readonly ResourceElement[]): ResourceCatalogFacets {
  return {
    dimensions: unique<ResourceDimension>([
      ...packs.map(pack => pack.dimension),
      ...elements.map(element => element.dimensionOverride).filter((value): value is ResourceDimension => Boolean(value)),
    ]),
    primaryCategories: unique<ResourcePackPrimaryCategory>(packs.map(pack => pack.primaryCategory)),
    categories: unique<ResourceCategory>(elements.map(element => element.category)),
    styles: unique([...packs.flatMap(pack => packStyles(pack)), ...elements.map(element => element.styleOverride).filter((value): value is string => Boolean(value))]),
    gameTypes: unique(packs.flatMap(pack => [...pack.gameTypes])),
    packTags: unique(packs.flatMap(pack => [...(pack.tags ?? [])])),
    usageTags: unique<ResourceUsageTag>(elements.flatMap(element => [...(element.usageTags ?? [])])),
    assetKinds: unique<ResourceAssetKind>(elements.map(element => element.assetKind).filter((value): value is ResourceAssetKind => Boolean(value))),
    capabilities: unique<ResourceCapability>(elements.flatMap(element => [...(element.capabilities ?? [])])),
    formats: unique(elements.map(element => fileExtension(element.path)).filter(Boolean)),
  }
}

function packStyles(pack: ResourcePack): string[] {
  if (pack.styles?.length) return unique(pack.styles.map(value => value.trim()).filter(Boolean))
  return pack.style.split('/').map(value => value.trim()).filter(Boolean)
}

export class ResourceCatalogCursorError extends Error {}

function page<T>(items: readonly T[], request: ResourceCatalogRequest, facets: ResourceCatalogFacets, idOf: (item: T) => string): ResourceCatalogPage<T> {
  const cursorId = parseCursor(request.cursor)
  const offset = cursorId
    ? (() => {
        const index = items.findIndex(item => idOf(item) === cursorId)
        if (index < 0) throw new ResourceCatalogCursorError('Resource catalog cursor is stale or invalid')
        return index + 1
      })()
    : 0
  const limit = Math.min(Math.max(Math.trunc(request.limit ?? 24), 1), 64)
  const nextOffset = offset + limit
  const pageItems = items.slice(offset, nextOffset)
  return {
    items: pageItems,
    total: items.length,
    ...(nextOffset < items.length && pageItems.length ? { nextCursor: encodeCursor(idOf(pageItems[pageItems.length - 1]!)) } : {}),
    facets,
  }
}

function encodeCursor(id: string): string {
  return `v1:${encodeURIComponent(id)}`
}

function parseCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined
  if (!cursor.startsWith('v1:')) throw new ResourceCatalogCursorError('Resource catalog cursor is invalid')
  try {
    const id = decodeURIComponent(cursor.slice(3))
    if (!id) throw new ResourceCatalogCursorError('Resource catalog cursor is invalid')
    return id
  } catch (error) {
    if (error instanceof ResourceCatalogCursorError) throw error
    throw new ResourceCatalogCursorError('Resource catalog cursor is invalid')
  }
}

function readyDependencyIds(elements: readonly ResourceElement[]): ReadonlySet<string> {
  return new Set(elements.filter(element => element.status === 'ready').map(element => element.id))
}

function hasCompleteDependencyClosure(element: ResourceElement, readyIds: ReadonlySet<string>): boolean {
  return element.dependencies.every(dependencyId => readyIds.has(dependencyId)) &&
    (element.dependencyBindings ?? []).every(binding => readyIds.has(binding.dependencyElementId)) &&
    (element.relations ?? []).every(relation => relation.required === false || readyIds.has(relation.targetElementId))
}

function includesFormat(formats: readonly string[], path: string): boolean {
  const extension = fileExtension(path)
  return formats.some(format => normalize(format).replace(/^\./, '') === extension)
}

function fileExtension(path: string): string {
  const filename = path.split('/').pop() ?? ''
  const index = filename.lastIndexOf('.')
  return index >= 0 ? normalize(filename.slice(index + 1)) : ''
}

function intersectsNormalized(left: readonly string[], right: readonly string[]): boolean {
  const normalized = new Set(right.map(normalize))
  return left.some(value => normalized.has(normalize(value)))
}

function intersects<T>(left: readonly T[], right: readonly T[]): boolean {
  const values = new Set(right)
  return left.some(value => values.has(value))
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareText)
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en', { sensitivity: 'base' })
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
