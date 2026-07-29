import type {
  ResourceCatalogElement,
  ResourceCatalogFilter,
  ResourceCatalogPack,
  ResourceCatalogPage,
  ResourceCatalogRequest,
} from '@bee-game-studio/beegame-resource-core'
import { serializeQueryEngineError } from './query-engine-worker-protocol'

export type ResourceSelectionElementRelation = { kind: string; targetElementId: string; role?: string; required?: boolean }
export type ResourceSelectionDependencyResult = { key: string; parentKey: string; elementId: string; elementPath: string; referencePath: string; sourceUrl: string; kind?: string }
export type ResourceSelectionResult = { packId: string; packVersion: string; packName?: string; packStyle?: string; packGameTypes?: string[]; elementId: string; elementName?: string; elementPath: string; category?: string; usageTags?: string[]; dimension?: '2D' | '3D' | 'agnostic'; sourceUrl: string; assetKind?: string; capabilities?: string[]; contentProfile?: Record<string, unknown>; technicalFacts?: Record<string, string | number | boolean>; relations?: ResourceSelectionElementRelation[]; dependencies?: ResourceSelectionDependencyResult[] }
export type ResourceCatalogFilterInput = ResourceCatalogFilter
export type ResourceCatalogInput = ResourceCatalogRequest
export type ResourceCatalogPackResult = ResourceCatalogPack
export type ResourceCatalogElementResult = ResourceCatalogElement
export type ResourceCatalogPackPage = ResourceCatalogPage<ResourceCatalogPack>
export type ResourceCatalogElementPage = ResourceCatalogPage<ResourceCatalogElement>
export type ResourcePackInspectionResult = { pack: Record<string, unknown>; folders: Array<Record<string, unknown>>; summary?: Record<string, unknown> }
export type ResourceExplicitSelectionInput = { importId: string; packId: string; expectedPackVersion: string; elementId: string; destinationPath?: string; selectionReason: string[] }
export type ResourceResolvedSelection = ResourceSelectionResult & { importId: string; destinationPath?: string; selectionReason: string[] }

export function createResourceSelectionClient(options: { baseUrl: string; serviceToken: string; fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>; transportRetryAttempts?: number; transportRetryDelayMs?: number }) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const transportRetryAttempts = Number.isFinite(options.transportRetryAttempts)
    ? Math.max(0, Math.trunc(options.transportRetryAttempts!))
    : 2
  const transportRetryDelayMs = Number.isFinite(options.transportRetryDelayMs)
    ? Math.max(0, Math.trunc(options.transportRetryDelayMs!))
    : 100
  return {
    async browsePacks(input: ResourceCatalogInput): Promise<ResourceCatalogPackPage> {
      const response = await servicePost('/api/resource-catalog/packs', input)
      const body = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(errorMessage(body) || `Resource Pack catalog failed (${response.status})`)
      return parseCatalogPage(body, parseCatalogPack)
    },
    async browsePackElements(packId: string, input: ResourceCatalogInput): Promise<ResourceCatalogElementPage> {
      const response = await servicePost(`/api/resource-catalog/packs/${encodeURIComponent(packId)}/elements`, input)
      const body = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(errorMessage(body) || `Resource element catalog failed (${response.status})`)
      return parseCatalogPage(body, parseCatalogElement)
    },
    async inspectPack(packId: string): Promise<ResourcePackInspectionResult> {
      const response = await serviceFetch(`${baseUrl}/api/resource-catalog/packs/${encodeURIComponent(packId)}`, { headers: serviceHeaders(false) })
      const body = await response.json().catch(() => undefined) as ResourcePackInspectionResult & { error?: { message?: string } }
      if (!response.ok || !isRecord(body?.pack) || !Array.isArray(body?.folders)) throw new Error(body?.error?.message || `Resource Pack inspection failed (${response.status})`)
      return { pack: body.pack, folders: body.folders.filter(isRecord), ...(isRecord(body.summary) ? { summary: body.summary } : {}) }
    },
    async resolveSelections(selections: ResourceExplicitSelectionInput[]): Promise<ResourceResolvedSelection[]> {
      const response = await servicePost('/api/resource-imports/resolve', { selections })
      const body = await response.json().catch(() => undefined) as { selections?: unknown; error?: { message?: string } } | undefined
      if (!response.ok || !Array.isArray(body?.selections)) throw new Error(body?.error?.message || `Resource integration resolution failed (${response.status})`)
      return body.selections.map(parseResolvedSelection)
    },
  }

  function servicePost(path: string, body: unknown) {
    return serviceFetch(`${baseUrl}${path}`, { method: 'POST', headers: serviceHeaders(true), body: JSON.stringify(body) })
  }

  async function serviceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchImpl(input, init)
      } catch (error) {
        const classified = serializeQueryEngineError(error, 'Resource service transport failed')
        if (!classified.retryable || attempt >= transportRetryAttempts) throw error
        const delayMs = transportRetryDelayMs * 2 ** attempt
        if (delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  function serviceHeaders(json: boolean) {
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      'x-beegame-resource-service-token': options.serviceToken,
    }
  }
}

function parseCatalogPage<T>(value: unknown, parseItem: (item: unknown) => T): ResourceCatalogPage<T> {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.total !== 'number' || !isRecord(value.facets)) {
    throw new Error('Resource catalog response is invalid')
  }
  const facets = value.facets
  for (const key of ['dimensions', 'primaryCategories', 'categories', 'styles', 'gameTypes', 'packTags', 'usageTags', 'assetKinds', 'capabilities', 'formats']) {
    if (!stringArray(facets[key])) throw new Error('Resource catalog facets are invalid')
  }
  return {
    items: value.items.map(parseItem),
    total: value.total,
    ...(typeof value.nextCursor === 'string' && value.nextCursor ? { nextCursor: value.nextCursor } : {}),
    facets: facets as ResourceCatalogPage<T>['facets'],
  }
}

function parseCatalogPack(value: unknown): ResourceCatalogPack {
  if (!isRecord(value)) throw new Error('Resource catalog Pack is invalid')
  for (const key of ['packId', 'packVersion', 'packName', 'style', 'dimension', 'primaryCategory'] as const) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error('Resource catalog Pack is invalid')
  }
  for (const key of ['styles', 'gameTypes', 'categories', 'tags', 'assetKinds', 'usageTags', 'capabilities', 'formats', 'compatibleEngines'] as const) {
    if (!stringArray(value[key])) throw new Error('Resource catalog Pack is invalid')
  }
  if (typeof value.readyElementCount !== 'number') throw new Error('Resource catalog Pack is invalid')
  if (typeof value.license !== 'string' || !value.license.trim()) throw new Error('Resource catalog Pack is invalid')
  return value as unknown as ResourceCatalogPack
}

function parseCatalogElement(value: unknown): ResourceCatalogElement {
  if (!isRecord(value)) throw new Error('Resource catalog element is invalid')
  for (const key of ['packId', 'packVersion', 'packName', 'packStyle', 'elementId', 'elementName', 'elementPath', 'category', 'dimension'] as const) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error('Resource catalog element is invalid')
  }
  for (const key of ['packStyles', 'packGameTypes', 'usageTags', 'capabilities', 'relations'] as const) {
    if (!Array.isArray(value[key])) throw new Error('Resource catalog element is invalid')
  }
  if (typeof value.dependencyCount !== 'number') throw new Error('Resource catalog element is invalid')
  if (value.preview !== undefined && (!isRecord(value.preview) || !['image', 'model', 'audio', 'document'].includes(String(value.preview.kind)) || typeof value.preview.path !== 'string' || !value.preview.path.trim())) throw new Error('Resource catalog element preview is invalid')
  if (value.technicalFacts !== undefined && !isPrimitiveRecord(value.technicalFacts)) throw new Error('Resource catalog element technical facts are invalid')
  return value as unknown as ResourceCatalogElement
}

function errorMessage(value: unknown): string | undefined {
  return isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string' ? value.error.message : undefined
}

function parseResolvedSelection(value: unknown): ResourceResolvedSelection {
  if (!isRecord(value) || typeof value.importId !== 'string' || !value.importId.trim()) throw new Error('Resolved Resource selection is invalid')
  const selectionReason = stringArray(value.selectionReason) ? value.selectionReason : undefined
  if (!selectionReason?.length) throw new Error('Resolved Resource selection reason is invalid')
  return { ...parseSelectionRecord(value), importId: value.importId, ...(typeof value.destinationPath === 'string' && value.destinationPath.trim() ? { destinationPath: value.destinationPath } : {}), selectionReason }
}

function parseSelectionRecord(value: unknown): ResourceSelectionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resource selection response is invalid')
  const row = value as Record<string, unknown>
  const strings = ['packId', 'packVersion', 'elementId', 'elementPath'] as const
  for (const key of strings) if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error('Resource selection response is invalid')
  if (typeof row.sourceUrl !== 'string' || !row.sourceUrl.trim()) throw new Error('Resource selection response is invalid')
  const dependencies = Array.isArray(row.dependencies) ? row.dependencies.map(value => parseDependency(value, true)) : []
  const capabilities = Array.isArray(row.capabilities) && row.capabilities.every(item => typeof item === 'string') ? row.capabilities as string[] : undefined
  const packGameTypes = stringArray(row.packGameTypes) ? row.packGameTypes : undefined
  const usageTags = stringArray(row.usageTags) ? row.usageTags : undefined
  const relations = Array.isArray(row.relations) ? row.relations.map(parseElementRelation) : undefined
  const contentProfile = row.contentProfile && typeof row.contentProfile === 'object' && !Array.isArray(row.contentProfile) ? row.contentProfile as Record<string, unknown> : undefined
  const technicalFacts = primitiveRecord(row.technicalFacts)
  return { packId: String(row.packId), packVersion: String(row.packVersion), ...(typeof row.packName === 'string' ? { packName: row.packName } : {}), ...(typeof row.packStyle === 'string' ? { packStyle: row.packStyle } : {}), ...(packGameTypes?.length ? { packGameTypes } : {}), elementId: String(row.elementId), ...(typeof row.elementName === 'string' ? { elementName: row.elementName } : {}), elementPath: String(row.elementPath), ...(typeof row.category === 'string' ? { category: row.category } : {}), ...(usageTags?.length ? { usageTags } : {}), ...(row.dimension === '2D' || row.dimension === '3D' || row.dimension === 'agnostic' ? { dimension: row.dimension } : {}), sourceUrl: String(row.sourceUrl), ...(typeof row.assetKind === 'string' ? { assetKind: row.assetKind } : {}), ...(capabilities?.length ? { capabilities } : {}), ...(contentProfile ? { contentProfile } : {}), ...(technicalFacts ? { technicalFacts } : {}), ...(relations?.length ? { relations } : {}), dependencies }
}

function primitiveRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isPrimitiveRecord(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string | number | boolean] => {
    const item = entry[1]
    return typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function isPrimitiveRecord(value: unknown): value is Record<string, string | number | boolean> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function parseElementRelation(value: unknown): ResourceSelectionElementRelation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resource selection relation is invalid')
  const row = value as Record<string, unknown>
  if (typeof row.kind !== 'string' || !row.kind.trim() || typeof row.targetElementId !== 'string' || !row.targetElementId.trim()) throw new Error('Resource selection relation is invalid')
  return { kind: row.kind, targetElementId: row.targetElementId, ...(typeof row.role === 'string' && row.role.trim() ? { role: row.role } : {}), ...(typeof row.required === 'boolean' ? { required: row.required } : {}) }
}

function parseDependency(value: unknown, sourceUrlRequired = true): ResourceSelectionDependencyResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resource selection dependency is invalid')
  const row = value as Record<string, unknown>
  for (const key of ['key', 'parentKey', 'elementId', 'elementPath', 'referencePath'] as const) {
    if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error('Resource selection dependency is invalid')
  }
  if (sourceUrlRequired && (typeof row.sourceUrl !== 'string' || !row.sourceUrl.trim())) throw new Error('Resource selection dependency is invalid')
  return { key: String(row.key), parentKey: String(row.parentKey), elementId: String(row.elementId), elementPath: String(row.elementPath), referencePath: String(row.referencePath), sourceUrl: sourceUrlRequired ? String(row.sourceUrl) : '', ...(typeof row.kind === 'string' && row.kind.trim() ? { kind: row.kind } : {}) }
}
