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
 * Browse published Packs without assigning project-specific game roles.
 * Filtering is exact and metadata-driven; free-form intent remains Claude
 * Code's reasoning input and is never interpreted here with name heuristics.
 */
export function browseResourceCatalogPacks(
  packs: readonly ResourcePack[],
  elements: readonly ResourceElement[],
  request: ResourceCatalogRequest,
): ResourceCatalogPage<ResourceCatalogPack> {
  const catalogRequest = resolveCatalogRequest(request, 'packs')
  const published = packs.filter(pack => pack.status === 'published')
  const readyIds = readyDependencyIds(elements)
  const readyByPack = new Map<string, ResourceElement[]>()
  for (const element of elements) {
    if (element.status !== 'ready' || !hasCompleteDependencyClosure(element, readyIds)) continue
    const list = readyByPack.get(element.packId) ?? []
    list.push(element)
    readyByPack.set(element.packId, list)
  }
  const available = published
    .map(pack => ({ pack, elements: readyByPack.get(pack.id) ?? [] }))
  const filtered = available
    .filter(entry => packMatches(entry.pack, entry.elements, catalogRequest.filters))
    .sort((left, right) => compareText(left.pack.name, right.pack.name) || compareText(left.pack.id, right.pack.id))
  const facets = collectFacets(available.map(entry => entry.pack), available.flatMap(entry => entry.elements))
  return page(filtered.map(({ pack, elements: packElements }) => summarizePack(pack, packElements)), catalogRequest, facets, item => item.packId)
}

/** Browse pre-aggregated Pack summaries without loading every element. */
export function browseResourceCatalogPackSummaries(
  summaries: readonly ResourceCatalogPack[],
  request: ResourceCatalogRequest,
): ResourceCatalogPage<ResourceCatalogPack> {
  const catalogRequest = resolveCatalogRequest(request, 'pack-summaries')
  const filtered = summaries
    .filter(pack => catalogPackMatches(pack, catalogRequest.filters))
    .sort((left, right) => compareText(left.packName, right.packName) || compareText(left.packId, right.packId))
  return page(filtered, catalogRequest, collectSummaryFacets(summaries), item => item.packId)
}

/**
 * Query reusable logical roots across every published Pack. Every returned
 * element satisfies the complete filter conjunction itself; Pack aggregates
 * never manufacture a candidate from unrelated elements.
 */
export function queryResourceCatalogElements(
  packs: readonly ResourcePack[],
  elements: readonly ResourceElement[],
  request: ResourceCatalogRequest,
  catalogRevision?: string,
): ResourceCatalogPage<ResourceCatalogElement> {
  const catalogRequest = resolveCatalogRequest(
    request,
    catalogRevision ? `elements:${catalogRevision}` : 'elements',
  )
  const published = packs.filter(pack => pack.status === 'published')
  const packById = new Map(published.map(pack => [pack.id, pack]))
  const readyIds = readyDependencyIds(elements)
  const available = elements.filter(element => {
    const pack = packById.get(element.packId)
    return Boolean(
      pack &&
        element.status === 'ready' &&
        hasCompleteDependencyClosure(element, readyIds),
    )
  })
  const eligible = available
    .filter(element =>
      elementMatches(element, packById.get(element.packId)!, catalogRequest.filters),
    )
    .sort((left, right) => {
      const leftPack = packById.get(left.packId)!
      const rightPack = packById.get(right.packId)!
      return (
        compareText(leftPack.name, rightPack.name) ||
        compareText(left.path, right.path) ||
        compareText(left.id, right.id)
      )
    })
  return page(
    eligible.map(element =>
      summarizeElement(packById.get(element.packId)!, element),
    ),
    catalogRequest,
    collectFacets(published, available),
    item => `${item.packId}/${item.elementId}`,
  )
}

export function hasElementCatalogFilters(
  filters?: ResourceCatalogFilter,
): boolean {
  return Boolean(
    filters?.categories?.length ||
      filters?.usageTags?.length ||
      filters?.assetKinds?.length ||
      filters?.capabilities?.length ||
      filters?.formats?.length,
  )
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
  const catalogRequest = resolveCatalogRequest(request, `pack-elements:${packId}`)
  const published = packs.filter(pack => pack.status === 'published')
  const packById = new Map(published.map(pack => [pack.id, pack]))
  const readyIds = readyDependencyIds(elements)
  const available = elements
    .filter(element => element.packId === packId && element.status === 'ready' && packById.has(element.packId) && hasCompleteDependencyClosure(element, readyIds))
  const eligible = available
    .filter(element => elementMatches(element, packById.get(element.packId)!, catalogRequest.filters))
    .sort((left, right) => {
      const leftPack = packById.get(left.packId)!
      const rightPack = packById.get(right.packId)!
      return (
        compareText(leftPack.name, rightPack.name) || compareText(left.path, right.path) || compareText(left.id, right.id)
      )
    })
  const scopedPacks = [...new Map(available.map(element => [element.packId, packById.get(element.packId)!])).values()]
  const facets = collectFacets(scopedPacks, available)
  return page(eligible.map(element => summarizeElement(packById.get(element.packId)!, element)), catalogRequest, facets, item => item.elementId)
}

function packMatches(pack: ResourcePack, elements: readonly ResourceElement[], filters?: ResourceCatalogFilter): boolean {
  if (!filters) return true
  if (filters.packIds?.length && !filters.packIds.includes(pack.id)) return false
  if (filters.dimensions?.length && !filters.dimensions.includes(pack.dimension)) return false
  if (filters.primaryCategories?.length && !filters.primaryCategories.includes(pack.primaryCategory)) return false
  if (filters.styles?.length && !intersectsNormalized(filters.styles, normalizedPackStyles(pack))) return false
  if (filters.gameTypes?.length && !intersectsNormalized(filters.gameTypes, pack.gameTypes)) return false
  if (filters.packTags?.length && !intersectsNormalized(filters.packTags, pack.tags ?? [])) return false
  return (
    !hasElementCatalogFilters(filters) ||
    elements.some(element => elementMatches(element, pack, filters))
  )
}

function elementMatches(element: ResourceElement, pack: ResourcePack, filters?: ResourceCatalogFilter): boolean {
  if (!filters) return true
  if (filters.packIds?.length && !filters.packIds.includes(pack.id)) return false
  const dimension = element.dimensionOverride ?? pack.dimension
  if (filters.dimensions?.length && !filters.dimensions.includes(dimension)) return false
  if (filters.primaryCategories?.length && !filters.primaryCategories.includes(pack.primaryCategory)) return false
  if (filters.categories?.length && !filters.categories.includes(element.category)) return false
  if (filters.styles?.length && !intersectsNormalized(filters.styles, element.styleOverride ? [element.styleOverride] : normalizedPackStyles(pack))) return false
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
    styles: normalizedPackStyles(pack),
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
    packStyles: element.styleOverride ? [element.styleOverride] : normalizedPackStyles(pack),
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
    styles: unique([...packs.flatMap(pack => normalizedPackStyles(pack)), ...elements.map(element => element.styleOverride).filter((value): value is string => Boolean(value))]),
    gameTypes: unique(packs.flatMap(pack => [...pack.gameTypes])),
    packTags: unique(packs.flatMap(pack => [...(pack.tags ?? [])])),
    usageTags: unique<ResourceUsageTag>(elements.flatMap(element => [...(element.usageTags ?? [])])),
    assetKinds: unique<ResourceAssetKind>(elements.map(element => element.assetKind).filter((value): value is ResourceAssetKind => Boolean(value))),
    capabilities: unique<ResourceCapability>(elements.flatMap(element => [...(element.capabilities ?? [])])),
    formats: unique(elements.map(element => fileExtension(element.path)).filter(Boolean)),
  }
}

function normalizedPackStyles(pack: ResourcePack): string[] {
  return unique(pack.styles.map(value => value.trim()).filter(Boolean))
}

export class ResourceCatalogCursorError extends Error {}

type ResolvedCatalogRequest = {
  filters?: ResourceCatalogFilter
  cursorId?: string
  limit?: number
  scope: string
}

function page<T>(items: readonly T[], request: ResolvedCatalogRequest, facets: ResourceCatalogFacets, idOf: (item: T) => string): ResourceCatalogPage<T> {
  const offset = request.cursorId
    ? (() => {
        const index = items.findIndex(item => idOf(item) === request.cursorId)
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
    ...(nextOffset < items.length && pageItems.length ? { nextCursor: encodeCursor(request.scope, request.filters, idOf(pageItems[pageItems.length - 1]!)) } : {}),
    facets,
  }
}

function resolveCatalogRequest(
  request: ResourceCatalogRequest,
  scope: string,
): ResolvedCatalogRequest {
  if (!request.cursor) {
    return {
      ...(request.filters ? { filters: request.filters } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      scope,
    }
  }

  const parsed = parseCursor(request.cursor)
  if (parsed.scope !== scope)
    throw new ResourceCatalogCursorError('Resource catalog cursor does not belong to this catalog')
  if (
    request.filters &&
    canonicalFilterKey(request.filters) !== canonicalFilterKey(parsed.filters)
  )
    throw new ResourceCatalogCursorError('Resource catalog cursor does not belong to these filters')

  return {
    filters: parsed.filters,
    cursorId: parsed.id,
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    scope,
  }
}

function encodeCursor(
  scope: string,
  filters: ResourceCatalogFilter | undefined,
  id: string,
): string {
  const payload = JSON.stringify({ scope, filters: canonicalFilters(filters) })
  return `v3:${encodeURIComponent(payload)}:${encodeURIComponent(id)}`
}

function parseCursor(cursor: string): {
  scope: string
  filters: ResourceCatalogFilter
  id: string
} {
  if (!cursor.startsWith('v3:'))
    throw new ResourceCatalogCursorError('Resource catalog cursor is invalid')
  const body = cursor.slice(3)
  const separator = body.indexOf(':')
  if (separator <= 0 || separator === body.length - 1)
    throw new ResourceCatalogCursorError('Resource catalog cursor is invalid')
  try {
    const payload = JSON.parse(decodeURIComponent(body.slice(0, separator))) as unknown
    const id = decodeURIComponent(body.slice(separator + 1))
    if (!id || !isCursorPayload(payload))
      throw new ResourceCatalogCursorError('Resource catalog cursor is invalid')
    return { scope: payload.scope, filters: payload.filters, id }
  } catch (error) {
    if (error instanceof ResourceCatalogCursorError) throw error
    throw new ResourceCatalogCursorError('Resource catalog cursor is invalid')
  }
}

function canonicalFilters(filters?: ResourceCatalogFilter): ResourceCatalogFilter {
  if (!filters) return {}
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, values]) => Array.isArray(values) && values.length > 0)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, values]) => [
        key,
        [...(values as readonly string[])].sort(compareText),
      ]),
  ) as ResourceCatalogFilter
}

function canonicalFilterKey(filters?: ResourceCatalogFilter): string {
  return JSON.stringify(canonicalFilters(filters))
}

function isCursorPayload(value: unknown): value is {
  scope: string
  filters: ResourceCatalogFilter
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.scope !== 'string' || !record.scope) return false
  if (!record.filters || typeof record.filters !== 'object' || Array.isArray(record.filters)) return false
  const allowedKeys = new Set([
    'packIds',
    'dimensions',
    'primaryCategories',
    'categories',
    'styles',
    'gameTypes',
    'packTags',
    'usageTags',
    'assetKinds',
    'capabilities',
    'formats',
  ])
  return Object.entries(record.filters as Record<string, unknown>).every(
    ([key, values]) =>
      allowedKeys.has(key) &&
      Array.isArray(values) &&
      values.length > 0 &&
      values.every(item => typeof item === 'string' && item.trim().length > 0),
  )
}

function readyDependencyIds(elements: readonly ResourceElement[]): ReadonlySet<string> {
  return new Set(elements.filter(element => element.status === 'ready').map(element => element.id))
}

function hasCompleteDependencyClosure(element: ResourceElement, readyIds: ReadonlySet<string>): boolean {
  return (
    element.dependencies.every(dependencyId => readyIds.has(dependencyId)) &&
    (element.dependencyBindings ?? []).every(binding => readyIds.has(binding.dependencyElementId)) &&
    (element.relations ?? []).every(relation => relation.required === false || readyIds.has(relation.targetElementId))
  )
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
