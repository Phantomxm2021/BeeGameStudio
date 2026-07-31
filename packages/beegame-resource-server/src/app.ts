import { createHash } from 'node:crypto'
import {
  RESOURCE_CATEGORIES,
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
  RESOURCE_RELATION_KINDS,
  RESOURCE_USAGE_TAGS,
  browseResourcePackElements,
  browseResourceCatalogPacks,
  browseResourceCatalogPackSummaries,
  hasElementCatalogFilters,
  queryResourceCatalogElements,
  ResourceCatalogCursorError,
  evaluateResourcePackPublishReadiness,
  resolveExactResourceElement,
  searchResourcePacks,
  type ResourceDimension,
  type ResourceCategory,
  type ResourceAssetKind,
  type ResourceCapability,
  type ResourceUsageTag,
  type ResourcePack,
  type ResourceFolder,
  type ResourceRepository,
  type ResourceCatalogRequest,
} from '@bee-game-studio/beegame-resource-core'
import {
  createConfiguredResourceUserResolver,
  createLocalResourceUserResolver,
  hasResourceAdminPermission,
  isLocalResourceFallbackAllowed,
  type ResourceUserContext,
  type ResourceUserResolver,
} from './auth'
import type { ResourceProcessingHandlers } from './resource-processing-jobs'

export class ResourceLifecycleNotFoundError extends Error {}
export class ResourceRequestValidationError extends Error {}

export type BeeGameResourceServerAppOptions = {
  repository: ResourceRepository
  currentUser?: ResourceUserContext
  currentUserResolver?: ResourceUserResolver
  /** Required when the backing repository uses a service-role credential that bypasses RLS. */
  canManagePack?: (user: ResourceUserContext, packId: string) => Promise<boolean> | boolean
  corsOrigin?: string
  updateResourcePack?: (packId: string, body: Record<string, unknown>) => Promise<unknown>
  deleteResourcePack?: (packId: string) => Promise<boolean>
  uploadPackCover?: (packId: string, request: Request) => Promise<ResourcePack>
  addResourceElement?: (packId: string, request: Request) => Promise<unknown>
  updateResourceElement?: (packId: string, elementId: string, body: Record<string, unknown>) => Promise<unknown>
  inspectResourceElement?: (packId: string, elementId: string) => Promise<unknown>
  deleteResourceElement?: (packId: string, elementId: string) => Promise<boolean>
  updateResourceFolder?: (packId: string, folderId: string, body: Record<string, unknown>) => Promise<unknown>
  deleteResourceFolder?: (packId: string, folderId: string) => Promise<boolean>
  getElementResourceUrl?: (packId: string, elementId: string) => Promise<string>
  inspectPackStorage?: (packId: string) => Promise<{ missingPaths: string[]; orphanPaths: string[] }>
  recordAuditEvent?: (event: { actorId: string; action: string; packId?: string; elementId?: string; metadata?: Record<string, unknown> }) => Promise<void>
  serviceSelectionToken?: string
  resourceProcessing?: Omit<ResourceProcessingHandlers, 'resumePending'>
}

export function createBeeGameResourceServerApp(
  options: BeeGameResourceServerAppOptions,
) {
  const resolveUser = options.currentUserResolver ??
    createConfiguredResourceUserResolver() ??
    (isLocalResourceFallbackAllowed() ? createLocalResourceUserResolver() : (() => undefined))
  const audit = async (event: { actorId: string; action: string; packId?: string; elementId?: string; metadata?: Record<string, unknown> }) => {
    try { await options.recordAuditEvent?.(event) } catch (error) { console.warn('Resource audit write failed:', error) }
  }
  return {
    fetch: async (request: Request): Promise<Response> => {
      if (request.method === 'OPTIONS') return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
      const pathname = new URL(request.url).pathname
      if (request.method === 'GET' && pathname === '/health') {
        return corsResponse(Response.json({ status: 'ok' }), options.corsOrigin)
      }
      const serviceSelectionRequest = (
        (request.method === 'POST' && [
          '/api/resource-catalog/packs',
          '/api/resource-catalog/elements',
          '/api/resource-imports/resolve',
        ].includes(pathname)) ||
        (request.method === 'GET' && /^\/api\/resource-catalog\/packs\/[^/]+$/.test(pathname)) ||
        (request.method === 'POST' && /^\/api\/resource-catalog\/packs\/[^/]+\/elements$/.test(pathname))
      ) &&
        Boolean(options.serviceSelectionToken) && request.headers.get('x-beegame-resource-service-token') === options.serviceSelectionToken
      const user = options.currentUser ?? await resolveUser(request)
      if (!serviceSelectionRequest && !user) return corsResponse(jsonError(401, 'unauthorized', 'Authenticated resource user is required'), options.corsOrigin)
      if (!serviceSelectionRequest && !hasResourceAdminPermission(user!)) {
        return corsResponse(jsonError(403, 'forbidden', 'Resource library administration is not allowed'), options.corsOrigin)
      }
      const packPathMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)(?:\/|$)/)
      if (!serviceSelectionRequest && packPathMatch && options.canManagePack) {
        try {
          if (!await options.canManagePack(user!, decodeURIComponent(packPathMatch[1]))) {
            return corsResponse(jsonError(403, 'forbidden', 'You are not allowed to manage this Resource Pack'), options.corsOrigin)
          }
        } catch (error) {
          return corsResponse(jsonError(500, 'resource_access_failed', error instanceof Error ? error.message : 'Resource Pack ownership could not be verified'), options.corsOrigin)
        }
      }
      try {
      if (request.method === 'GET' && pathname === '/api/resource-search') {
        const url = new URL(request.url)
        return corsResponse(Response.json({ packs: searchResourcePacks(await options.repository.listPacks(), {
          dimensions: enumQuery(url.searchParams, 'dimension', RESOURCE_DIMENSIONS),
          primaryCategories: enumQuery(url.searchParams, 'primaryCategory', RESOURCE_PACK_PRIMARY_CATEGORIES),
          statuses: enumQuery(url.searchParams, 'status', ['draft', 'published', 'archived'] as const),
          tags: listQuery(url.searchParams, 'tag'),
          gameTypes: listQuery(url.searchParams, 'gameType'),
        }) }), options.corsOrigin)
      }
      if (request.method === 'POST' && pathname === '/api/resource-catalog/packs') {
        const catalogRequest = parseCatalogRequest(await request.json())
        if (
          options.repository.listCatalogPacks &&
          !hasElementCatalogFilters(catalogRequest.filters)
        ) {
          return corsResponse(Response.json(browseResourceCatalogPackSummaries(await options.repository.listCatalogPacks(), catalogRequest)), options.corsOrigin)
        }
        const packs = await options.repository.listPacks()
        const elements = (await Promise.all(packs.map(pack => options.repository.listElements(pack.id)))).flat()
        return corsResponse(Response.json(browseResourceCatalogPacks(packs, elements, catalogRequest)), options.corsOrigin)
      }
      if (request.method === 'POST' && pathname === '/api/resource-catalog/elements') {
        const catalogRequest = parseCatalogRequest(await request.json())
        const packs = await options.repository.listPacks()
        const elements = (
          await Promise.all(
            packs.map(pack => options.repository.listElements(pack.id)),
          )
        ).flat()
        const catalogRevision = resourceCatalogRevision(packs, elements)
        return corsResponse(
          Response.json(
            {
              ...queryResourceCatalogElements(
                packs,
                elements,
                catalogRequest,
                catalogRevision,
              ),
              catalogRevision,
              normalizedFilters: catalogRequest.filters ?? {},
            },
          ),
          options.corsOrigin,
        )
      }
      const packElementsMatch = pathname.match(/^\/api\/resource-catalog\/packs\/([^/]+)\/elements$/)
      if (request.method === 'POST' && packElementsMatch) {
        const packId = decodeURIComponent(packElementsMatch[1])
        const catalogRequest = parseCatalogRequest(await request.json())
        const pack = await options.repository.getPack(packId)
        if (!pack || pack.status !== 'published') return corsResponse(jsonError(404, 'not_found', 'Published Resource Pack not found'), options.corsOrigin)
        const elements = await options.repository.listElements(packId)
        return corsResponse(Response.json(browseResourcePackElements([pack], elements, packId, catalogRequest)), options.corsOrigin)
      }
      const explorePackMatch = pathname.match(/^\/api\/resource-catalog\/packs\/([^/]+)$/)
      if (request.method === 'GET' && explorePackMatch) {
        const packId = decodeURIComponent(explorePackMatch[1])
        const pack = await options.repository.getPack(packId)
        if (!pack || pack.status !== 'published') return corsResponse(jsonError(404, 'not_found', 'Published Resource Pack not found'), options.corsOrigin)
        const [catalog, folders] = await Promise.all([
          options.repository.listCatalogPacks?.(),
          options.repository.listFolders(packId),
        ])
        const summary = catalog?.find(candidate => candidate.packId === packId)
        return corsResponse(Response.json({ pack, folders, summary: summary ?? null }), options.corsOrigin)
      }
      if (request.method === 'POST' && pathname === '/api/resource-imports/resolve') {
        if (!options.getElementResourceUrl) return corsResponse(jsonError(503, 'not_configured', 'Resource import URLs are not configured'), options.corsOrigin)
        const requested = parseIntegrationSelections(await request.json())
        const resolved = []
        for (const selection of requested) {
          const pack = await options.repository.getPack(selection.packId)
          if (!pack || pack.status !== 'published') throw new ResourceRequestValidationError(`Published Resource Pack ${selection.packId} was not found`)
          const elements = await options.repository.listElements(pack.id)
          const element = elements.find(candidate => candidate.id === selection.elementId && candidate.status === 'ready')
          if (!element) throw new ResourceRequestValidationError(`Ready Resource element ${selection.elementId} was not found in Pack ${pack.id}`)
          if (pack.version !== selection.expectedPackVersion) {
            throw new ResourceRequestValidationError(`Resource Pack ${pack.id} changed from version ${selection.expectedPackVersion} to ${pack.version}; inspect the Pack again before importing`)
          }
          const candidate = resolveExactResourceElement(pack, elements, element.id)
          if (!candidate) throw new ResourceRequestValidationError(`Resource element ${selection.elementId} has an incomplete dependency closure`)
          resolved.push({
            ...candidate,
            importId: selection.importId,
            destinationPath: selection.destinationPath,
            selectionReason: selection.selectionReason,
            sourceUrl: await options.getElementResourceUrl(pack.id, element.id),
            dependencies: await Promise.all((candidate.dependencies ?? []).map(async dependency => ({
              ...dependency,
              sourceUrl: await options.getElementResourceUrl!(pack.id, dependency.elementId),
            }))),
          })
        }
        return corsResponse(Response.json({ selections: resolved }), options.corsOrigin)
      }
      if (request.method === 'POST' && pathname === '/api/resource-packs') {
        try {
          const body = await request.json() as Record<string, unknown>
          assertElementDefaults(body.elementDefaults)
          const styles = stringList(body.styles)
          const pack = await options.repository.createPack({
            id: typeof body.id === 'string' && body.id ? body.id : `pack-${crypto.randomUUID()}`,
            name: String(body.name || ''),
            ...(styles?.length ? { styles } : {}),
            style: styles?.join(' / ') || String(body.style || ''),
            gameTypes: Array.isArray(body.gameTypes) ? body.gameTypes.map(String) : [],
            dimension: body.dimension as ResourceDimension,
            primaryCategory: body.primaryCategory as ResourcePack['primaryCategory'],
            categories: body.categories as ResourceCategory[],
            license: typeof body.license === 'string' ? body.license : 'unassigned',
            version: typeof body.version === 'string' ? body.version : '0.1.0', status: 'draft',
            ...(typeof body.description === 'string' && body.description.trim() ? { description: body.description.trim() } : {}),
            ...(stringList(body.tags) ? { tags: stringList(body.tags) } : {}),
            ...(typeof body.source === 'string' && body.source.trim() ? { source: body.source.trim() } : {}),
            ...(typeof body.author === 'string' && body.author.trim() ? { author: body.author.trim() } : {}),
            ...(typeof body.licenseEvidence === 'string' && body.licenseEvidence.trim() ? { licenseEvidence: body.licenseEvidence.trim() } : {}),
            ...(stringList(body.compatibleEngines) ? { compatibleEngines: stringList(body.compatibleEngines) } : {}),
            ...(body.elementDefaults ? { elementDefaults: body.elementDefaults as ResourcePack['elementDefaults'] } : {}),
          }, { createdBy: user!.id })
          await audit({ actorId: user!.id, action: 'pack.created', packId: pack.id, metadata: { primaryCategory: pack.primaryCategory, dimension: pack.dimension } })
          return corsResponse(Response.json({ pack }, { status: 201 }), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(400, 'invalid_pack', error instanceof Error ? error.message : 'Invalid Pack'), options.corsOrigin)
        }
      }
      if (request.method === 'GET' && pathname === '/api/resource-packs' && options.canManagePack) {
        const packs = await options.repository.listPacks()
        const permitted = await Promise.all(packs.map(async pack => ({ pack, allowed: await options.canManagePack!(user!, pack.id) })))
        return corsResponse(Response.json({ packs: permitted.filter(entry => entry.allowed).map(entry => entry.pack) }), options.corsOrigin)
      }
      const patchMatch = new URL(request.url).pathname.match(/^\/api\/resource-packs\/([^/]+)$/)
      if (request.method === 'DELETE' && patchMatch) {
        if (!options.deleteResourcePack) return corsResponse(jsonError(503, 'not_configured', 'Resource deletion is not configured'), options.corsOrigin)
        const packId = decodeURIComponent(patchMatch[1])
        if (!await options.deleteResourcePack(packId)) return corsResponse(jsonError(404, 'not_found', 'Resource Pack not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'pack.deleted', packId })
        return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
      }
      if (request.method === 'PATCH' && patchMatch) {
        if (!options.updateResourcePack) return corsResponse(jsonError(503, 'not_configured', 'Resource updates are not configured'), options.corsOrigin)
        const body = await request.json() as Record<string, unknown>
        assertElementDefaults(body.elementDefaults)
        const pack = await options.updateResourcePack(decodeURIComponent(patchMatch[1]), body)
        if (!pack) return corsResponse(jsonError(404, 'not_found', 'Resource Pack not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'pack.updated', packId: decodeURIComponent(patchMatch[1]), metadata: { fields: Object.keys(body).sort() } })
        return corsResponse(Response.json({ pack }), options.corsOrigin)
      }
      const coverMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/cover$/)
      if (request.method === 'POST' && coverMatch) {
        if (!options.uploadPackCover) return corsResponse(jsonError(503, 'not_configured', 'Resource cover upload is not configured'), options.corsOrigin)
        const form = await request.clone().formData()
        const file = form.get('file')
        if (!(file instanceof File) || !isSupportedCover(file)) {
          return corsResponse(jsonError(400, 'invalid_cover', 'Cover must be a jpg, jpeg, png, webp, gif, mp4, or webm file'), options.corsOrigin)
        }
        const packId = decodeURIComponent(coverMatch[1])
        const pack = await options.uploadPackCover(packId, request)
        await audit({ actorId: user!.id, action: 'pack.cover_uploaded', packId, metadata: { filename: file.name } })
        return corsResponse(Response.json({ pack }), options.corsOrigin)
      }
      const processingCollectionMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/processing-jobs$/)
      if (processingCollectionMatch && request.method === 'GET') {
        if (!options.resourceProcessing) return corsResponse(jsonError(503, 'not_configured', 'Resource processing is not configured'), options.corsOrigin)
        const job = await options.resourceProcessing.latest(decodeURIComponent(processingCollectionMatch[1]))
        return corsResponse(Response.json({ job: job ?? null }), options.corsOrigin)
      }
      if (processingCollectionMatch && request.method === 'POST') {
        if (!options.resourceProcessing) return corsResponse(jsonError(503, 'not_configured', 'Resource processing is not configured'), options.corsOrigin)
        const body = await request.json().catch(() => ({})) as { elementIds?: unknown }
        if (body.elementIds !== undefined && (!Array.isArray(body.elementIds) || body.elementIds.some(id => typeof id !== 'string' || !id.trim()))) {
          return corsResponse(jsonError(400, 'invalid_processing_job', 'elementIds must contain valid resource element ids'), options.corsOrigin)
        }
        const packId = decodeURIComponent(processingCollectionMatch[1])
        const job = await options.resourceProcessing.start(packId, body.elementIds as string[] | undefined)
        await audit({ actorId: user!.id, action: 'processing.started', packId, metadata: { jobId: job.id, totalItems: job.totalItems } })
        return corsResponse(Response.json({ job }, { status: 202 }), options.corsOrigin)
      }
      const processingJobMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/processing-jobs\/([^/]+)$/)
      const processingRetryMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/processing-jobs\/([^/]+)\/retry$/)
      if (processingRetryMatch && request.method === 'POST') {
        if (!options.resourceProcessing) return corsResponse(jsonError(503, 'not_configured', 'Resource processing is not configured'), options.corsOrigin)
        const packId = decodeURIComponent(processingRetryMatch[1]); const jobId = decodeURIComponent(processingRetryMatch[2])
        const job = await options.resourceProcessing.retry(packId, jobId)
        if (!job) return corsResponse(jsonError(404, 'not_found', 'Resource processing job not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'processing.retried', packId, metadata: { jobId } })
        return corsResponse(Response.json({ job }), options.corsOrigin)
      }
      if (processingJobMatch && request.method === 'GET') {
        if (!options.resourceProcessing) return corsResponse(jsonError(503, 'not_configured', 'Resource processing is not configured'), options.corsOrigin)
        const job = await options.resourceProcessing.get(decodeURIComponent(processingJobMatch[1]), decodeURIComponent(processingJobMatch[2]))
        return job ? corsResponse(Response.json({ job }), options.corsOrigin) : corsResponse(jsonError(404, 'not_found', 'Resource processing job not found'), options.corsOrigin)
      }
      if (processingJobMatch && request.method === 'DELETE') {
        if (!options.resourceProcessing) return corsResponse(jsonError(503, 'not_configured', 'Resource processing is not configured'), options.corsOrigin)
        const packId = decodeURIComponent(processingJobMatch[1]); const jobId = decodeURIComponent(processingJobMatch[2])
        const job = await options.resourceProcessing.cancel(packId, jobId)
        if (!job) return corsResponse(jsonError(404, 'not_found', 'Resource processing job not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'processing.cancelled', packId, metadata: { jobId } })
        return corsResponse(Response.json({ job }), options.corsOrigin)
      }
      const folderMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/folders$/)
      if (folderMatch && request.method === 'GET') {
        try {
          return corsResponse(Response.json({ folders: await options.repository.listFolders(decodeURIComponent(folderMatch[1])) }), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(500, 'resource_read_failed', error instanceof Error ? error.message : 'Resource folders could not be loaded'), options.corsOrigin)
        }
      }
      if (folderMatch && request.method === 'POST') {
        try {
          const body = await request.json() as { id?: string; name?: string; parentId?: string; elementDefaults?: unknown }
          if (!body.name) return corsResponse(jsonError(400, 'invalid_folder', 'Folder name is required'), options.corsOrigin)
          assertElementDefaults(body.elementDefaults)
          const packId = decodeURIComponent(folderMatch[1])
          const folder = await options.repository.createFolder(packId, { id: body.id || `folder-${crypto.randomUUID()}`, name: body.name, parentId: body.parentId, ...(body.elementDefaults ? { elementDefaults: body.elementDefaults as ResourceFolder['elementDefaults'] } : {}) })
          await audit({ actorId: user!.id, action: 'folder.created', packId, metadata: { folderId: folder.id, path: folder.path } })
          return corsResponse(Response.json({ folder }, { status: 201 }), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(400, 'invalid_folder', error instanceof Error ? error.message : 'Invalid folder'), options.corsOrigin)
        }
      }
      const folderPatchMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/folders\/([^/]+)$/)
      if (folderPatchMatch && request.method === 'PATCH') {
        const packId = decodeURIComponent(folderPatchMatch[1])
        const folderId = decodeURIComponent(folderPatchMatch[2])
        const body = await request.json() as { name?: unknown; elementDefaults?: unknown }
        if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) return corsResponse(jsonError(400, 'invalid_folder', 'Folder name is required'), options.corsOrigin)
        assertElementDefaults(body.elementDefaults)
        if (body.name === undefined && body.elementDefaults === undefined) return corsResponse(jsonError(400, 'invalid_folder', 'Folder update is empty'), options.corsOrigin)
        const update = { ...(typeof body.name === 'string' ? { name: body.name } : {}), ...(body.elementDefaults !== undefined ? { elementDefaults: body.elementDefaults as ResourceFolder['elementDefaults'] } : {}) }
        const folder = (options.updateResourceFolder ? await options.updateResourceFolder(packId, folderId, update) : await options.repository.updateFolder(packId, folderId, update)) as { path?: string } | undefined
        if (!folder) return corsResponse(jsonError(404, 'not_found', 'Resource folder not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'folder.updated', packId, metadata: { folderId, path: folder.path } })
        return corsResponse(Response.json({ folder }), options.corsOrigin)
      }
      if (folderPatchMatch && request.method === 'DELETE') {
        const packId = decodeURIComponent(folderPatchMatch[1])
        const folderId = decodeURIComponent(folderPatchMatch[2])
        const deleted = options.deleteResourceFolder ? await options.deleteResourceFolder(packId, folderId) : await options.repository.deleteFolder(packId, folderId)
        if (!deleted) return corsResponse(jsonError(404, 'not_found', 'Resource folder not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'folder.deleted', packId, metadata: { folderId } })
        return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
      }
      const readinessMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/publish-readiness$/)
      if (readinessMatch && request.method === 'GET') {
        const packId = decodeURIComponent(readinessMatch[1])
        const pack = await options.repository.getPack(packId)
        if (!pack) return corsResponse(jsonError(404, 'not_found', 'Resource Pack not found'), options.corsOrigin)
        const elements = await options.repository.listElements(packId)
        const baseline = evaluateResourcePackPublishReadiness(pack, elements)
        const storage = options.inspectPackStorage ? await options.inspectPackStorage(packId) : undefined
        const blocking = [...baseline.blocking, ...(storage?.missingPaths || []).map(path => ({ code: 'storage_object_missing', message: `Storage object is missing: ${path}` }))]
        const warnings = [...baseline.warnings, ...(storage?.orphanPaths || []).map(path => ({ code: 'storage_object_orphaned', message: `Storage object is not referenced by this Pack: ${path}` }))]
        return corsResponse(Response.json({ report: { blocking, warnings, canPublish: blocking.length === 0 } }), options.corsOrigin)
      }
      const publishMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/publish$/)
      if (publishMatch && request.method === 'POST') {
        try {
          const pack = await options.repository.publishPack(decodeURIComponent(publishMatch[1]))
          await audit({ actorId: user!.id, action: 'pack.published', packId: decodeURIComponent(publishMatch[1]) })
          return corsResponse(Response.json({ pack }), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(400, 'publish_blocked', error instanceof Error ? error.message : 'Pack cannot be published'), options.corsOrigin)
        }
      }
      const archiveMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/archive$/)
      if (archiveMatch && request.method === 'POST') {
        try {
          const packId = decodeURIComponent(archiveMatch[1])
          const pack = await options.repository.archivePack(packId)
          await audit({ actorId: user!.id, action: 'pack.archived', packId, metadata: { version: pack.version, deprecatedAt: pack.deprecatedAt } })
          return corsResponse(Response.json({ pack }), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(400, 'archive_failed', error instanceof Error ? error.message : 'Pack could not be archived'), options.corsOrigin)
        }
      }
      const elementMatch = new URL(request.url).pathname.match(/^\/api\/resource-packs\/([^/]+)\/elements$/)
      if (request.method === 'POST' && elementMatch) {
        if (!options.addResourceElement) return corsResponse(jsonError(503, 'not_configured', 'Resource element upload is not configured'), options.corsOrigin)
        const packId = decodeURIComponent(elementMatch[1])
        const element = await options.addResourceElement(packId, request) as { id?: unknown; name?: unknown }
        await audit({ actorId: user!.id, action: 'element.uploaded', packId, ...(typeof element?.id === 'string' ? { elementId: element.id } : {}), ...(typeof element?.name === 'string' ? { metadata: { name: element.name } } : {}) })
        return corsResponse(Response.json({ element }, { status: 201 }), options.corsOrigin)
      }
      const elementPatchMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/elements\/([^/]+)$/)
      const elementUrlMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/elements\/([^/]+)\/resource-url$/)
      const elementInspectionMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/elements\/([^/]+)\/inspection$/)
      if (request.method === 'POST' && elementInspectionMatch) {
        if (!options.inspectResourceElement) return corsResponse(jsonError(503, 'not_configured', 'Resource element inspection is not configured'), options.corsOrigin)
        const packId = decodeURIComponent(elementInspectionMatch[1])
        const elementId = decodeURIComponent(elementInspectionMatch[2])
        const element = await options.inspectResourceElement(packId, elementId)
        if (!element) return corsResponse(jsonError(404, 'not_found', 'Resource element not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'element.inspected', packId, elementId })
        return corsResponse(Response.json({ element }), options.corsOrigin)
      }
      if (request.method === 'GET' && elementUrlMatch) {
        if (!options.getElementResourceUrl) return corsResponse(jsonError(503, 'not_configured', 'Element resource URLs are not configured'), options.corsOrigin)
        const packId = decodeURIComponent(elementUrlMatch[1])
        const elementId = decodeURIComponent(elementUrlMatch[2])
        if (!await options.repository.getElement(packId, elementId)) return corsResponse(jsonError(404, 'not_found', 'Resource element not found'), options.corsOrigin)
        return corsResponse(Response.json({ url: await options.getElementResourceUrl(packId, elementId) }), options.corsOrigin)
      }
      if (request.method === 'PATCH' && elementPatchMatch) {
        if (!options.updateResourceElement) return corsResponse(jsonError(503, 'not_configured', 'Resource element updates are not configured'), options.corsOrigin)
        const body = await request.json() as Record<string, unknown>
        assertElementUsageTags(body)
        assertElementAssetMetadata(body)
        const packId = decodeURIComponent(elementPatchMatch[1])
        const elementId = decodeURIComponent(elementPatchMatch[2])
        const saved = await options.updateResourceElement(packId, elementId, body)
        if (!saved) return corsResponse(jsonError(404, 'not_found', 'Resource element not found'), options.corsOrigin)
        // Return the repository view so inherited Pack/folder metadata is
        // visible immediately after an explicit element update.
        const element = await options.repository.getElement(packId, elementId) ?? saved
        await audit({ actorId: user!.id, action: 'element.updated', packId, elementId, metadata: { fields: Object.keys(body).sort() } })
        return corsResponse(Response.json({ element }), options.corsOrigin)
      }
      if (request.method === 'DELETE' && elementPatchMatch) {
        const packId = decodeURIComponent(elementPatchMatch[1])
        const elementId = decodeURIComponent(elementPatchMatch[2])
        const deleted = options.deleteResourceElement ? await options.deleteResourceElement(packId, elementId) : await options.repository.deleteElement(packId, elementId)
        if (!deleted) return corsResponse(jsonError(404, 'not_found', 'Resource element not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'element.deleted', packId, elementId })
        return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
      }
        try {
          return corsResponse(await routeRequest(request, options.repository), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(500, 'resource_read_failed', error instanceof Error ? error.message : 'Resource request failed'), options.corsOrigin)
        }
      } catch (error) {
        if (error instanceof ResourceLifecycleNotFoundError) {
          return corsResponse(jsonError(404, 'not_found', error.message), options.corsOrigin)
        }
        if (error instanceof ResourceRequestValidationError) {
          return corsResponse(jsonError(400, 'invalid_request', error.message), options.corsOrigin)
        }
        if (error instanceof ResourceCatalogCursorError) {
          return corsResponse(jsonError(400, 'invalid_cursor', error.message), options.corsOrigin)
        }
        return corsResponse(jsonError(500, 'resource_lifecycle_failed', error instanceof Error ? error.message : 'Resource lifecycle operation failed'), options.corsOrigin)
      }
    },
  }
}

function resourceCatalogRevision(
  packs: readonly ResourcePack[],
  elements: readonly import('@bee-game-studio/beegame-resource-core').ResourceElement[],
): string {
  const snapshot = {
    packs: [...packs]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(canonicalCatalogValue),
    elements: [...elements]
      .sort(
        (left, right) =>
          left.packId.localeCompare(right.packId) ||
          left.id.localeCompare(right.id),
      )
      .map(canonicalCatalogValue),
  }
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function canonicalCatalogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCatalogValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [key, canonicalCatalogValue(field)]),
  )
}

function isSupportedCover(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'webp' || extension === 'gif' || extension === 'mp4' || extension === 'webm'
}

async function routeRequest(request: Request, repository: ResourceRepository): Promise<Response> {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (request.method !== 'GET' || parts[0] !== 'api' || parts[1] !== 'resource-packs') {
    return jsonError(404, 'not_found', 'Resource route not found')
  }
  if (parts.length === 2) return Response.json({ packs: await repository.listPacks() })
  const packId = parts[2]
  if (!packId) return jsonError(400, 'invalid_request', 'Pack id is required')
  const pack = await repository.getPack(packId)
  if (!pack) return jsonError(404, 'not_found', 'Resource Pack not found')
  if (parts.length === 3) return Response.json({ pack })
  if (parts[3] !== 'elements') return jsonError(404, 'not_found', 'Resource route not found')
  if (parts.length === 4) {
    const category = parseCategory(url.searchParams.get('category'))
    if (url.searchParams.has('category') && !category) {
      return jsonError(400, 'invalid_category', 'Resource category is unsupported')
    }
    const elements = await repository.listElements(packId, category)
    const folderPath = url.searchParams.get('folderPath')
    if (!folderPath) return Response.json({ elements })
    const normalizedPath = folderPath.split('/').filter(Boolean).join('/')
    return Response.json({ elements: elements.filter((element) => element.path === normalizedPath || element.path.startsWith(`${normalizedPath}/`)) })
  }
  const element = await repository.getElement(packId, parts[4])
  return element
    ? Response.json({ element })
    : jsonError(404, 'not_found', 'Resource element not found')
}

function parseCategory(value: string | null): ResourceCategory | undefined {
  if (!value) return undefined
  return (RESOURCE_CATEGORIES as readonly string[]).includes(value)
    ? value as ResourceCategory
    : undefined
}

function parseCatalogRequest(value: unknown): ResourceCatalogRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResourceRequestValidationError('Resource catalog request must be an object')
  }
  const record = value as Record<string, unknown>
  const filtersValue = record.filters
  if (filtersValue !== undefined && (!filtersValue || typeof filtersValue !== 'object' || Array.isArray(filtersValue))) {
    throw new ResourceRequestValidationError('Resource catalog filters must be an object')
  }
  const filters = (filtersValue ?? {}) as Record<string, unknown>
  const packIds = stringList(filters.packIds)
  const dimensions = validatedEnumList(filters.dimensions, RESOURCE_DIMENSIONS, 'Resource catalog dimensions') as ResourceDimension[] | undefined
  const primaryCategories = validatedEnumList(filters.primaryCategories, RESOURCE_PACK_PRIMARY_CATEGORIES, 'Resource catalog primaryCategories') as ResourcePack['primaryCategory'][] | undefined
  const categories = validatedEnumList(filters.categories, RESOURCE_CATEGORIES, 'Resource catalog categories') as ResourceCategory[] | undefined
  const styles = stringList(filters.styles)
  const gameTypes = stringList(filters.gameTypes)
  const packTags = stringList(filters.packTags)
  const usageTags = validatedEnumList(filters.usageTags, RESOURCE_USAGE_TAGS, 'Resource catalog usageTags') as ResourceUsageTag[] | undefined
  const assetKinds = validatedEnumList(filters.assetKinds, RESOURCE_ASSET_KINDS, 'Resource catalog assetKinds') as ResourceAssetKind[] | undefined
  const capabilities = validatedEnumList(filters.capabilities, RESOURCE_CAPABILITIES, 'Resource catalog capabilities') as ResourceCapability[] | undefined
  const formats = stringList(filters.formats)?.map(format => format.replace(/^\./, '').toLocaleLowerCase())
  if (record.cursor !== undefined && typeof record.cursor !== 'string') {
    throw new ResourceRequestValidationError('Resource catalog cursor must be a string')
  }
  const limit = optionalBoundedInteger(record.limit, 'limit', 1, 64)
  return {
    filters: {
      ...(packIds ? { packIds } : {}),
      ...(dimensions ? { dimensions } : {}),
      ...(primaryCategories ? { primaryCategories } : {}),
      ...(categories ? { categories } : {}),
      ...(styles ? { styles } : {}),
      ...(gameTypes ? { gameTypes } : {}),
      ...(packTags ? { packTags } : {}),
      ...(usageTags ? { usageTags } : {}),
      ...(assetKinds ? { assetKinds } : {}),
      ...(capabilities ? { capabilities } : {}),
      ...(formats ? { formats } : {}),
    },
    ...(typeof record.cursor === 'string' && record.cursor ? { cursor: record.cursor } : {}),
    ...(limit ? { limit } : {}),
  }
}

function parseIntegrationSelections(value: unknown): Array<{ importId: string; packId: string; expectedPackVersion: string; elementId: string; destinationPath?: string; selectionReason: string[] }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResourceRequestValidationError('Resource import request must be an object')
  const selections = (value as Record<string, unknown>).selections
  if (!Array.isArray(selections) || selections.length === 0) throw new ResourceRequestValidationError('At least one explicit Resource element selection is required')
  if (selections.length > 64) throw new ResourceRequestValidationError('At most 64 Resource elements may be resolved at once')
  return selections.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResourceRequestValidationError(`Resource import selection ${index + 1} is invalid`)
    const record = value as Record<string, unknown>
    const importId = requiredString(record.importId, `Resource import selection ${index + 1} importId`)
    const packId = requiredString(record.packId, `Resource import selection ${index + 1} packId`)
    const expectedPackVersion = requiredString(record.expectedPackVersion, `Resource import selection ${index + 1} expectedPackVersion`)
    const elementId = requiredString(record.elementId, `Resource import selection ${index + 1} elementId`)
    const selectionReason = Array.isArray(record.selectionReason)
      ? record.selectionReason.map(item => requiredString(item, `Resource import selection ${index + 1} selectionReason`))
      : []
    if (!selectionReason.length) throw new ResourceRequestValidationError(`Resource import selection ${index + 1} selectionReason is required`)
    const destinationPath = typeof record.destinationPath === 'string' && record.destinationPath.trim() ? record.destinationPath.trim() : undefined
    return { importId, packId, expectedPackVersion, elementId, ...(destinationPath ? { destinationPath } : {}), selectionReason }
  })
}

function optionalBoundedInteger(value: unknown, name: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new ResourceRequestValidationError(`${name} must be an integer from ${minimum} to ${maximum}`)
  return Number(value)
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ResourceRequestValidationError(`${name} is required`)
  return value.trim()
}

function validatedEnumList(
  value: unknown,
  allowed: readonly string[],
  label: string,
): string[] | undefined {
  const values = stringList(value)
  if (!values) return undefined
  if (values.some(item => !allowed.includes(item))) {
    throw new ResourceRequestValidationError(`${label} contain unsupported values`)
  }
  return values
}

function assertElementUsageTags(body: Record<string, unknown>): void {
  if (Object.hasOwn(body, 'usageTagsMode') && !['inherit', 'override', 'manual-only'].includes(String(body.usageTagsMode))) {
    throw new ResourceRequestValidationError('Element usageTagsMode is unsupported')
  }
  if (!Object.hasOwn(body, 'usageTags')) return
  const value = body.usageTags
  if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string' || !(RESOURCE_USAGE_TAGS as readonly string[]).includes(tag))) {
    throw new ResourceRequestValidationError('Element usageTags must contain supported values')
  }
}

function assertElementDefaults(value: unknown): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResourceRequestValidationError('Element defaults must be an object')
  const usageTags = (value as Record<string, unknown>).usageTags
  if (usageTags !== undefined && (!Array.isArray(usageTags) || usageTags.some(tag => typeof tag !== 'string' || !(RESOURCE_USAGE_TAGS as readonly string[]).includes(tag)))) {
    throw new ResourceRequestValidationError('Element default usageTags must contain supported values')
  }
}

function assertElementAssetMetadata(body: Record<string, unknown>): void {
  if (Object.hasOwn(body, 'assetKind') &&
      body.assetKind !== null &&
      (typeof body.assetKind !== 'string' || !(RESOURCE_ASSET_KINDS as readonly string[]).includes(body.assetKind))) {
    throw new ResourceRequestValidationError('Element assetKind is unsupported')
  }
  if (Object.hasOwn(body, 'capabilities')) {
    const value = body.capabilities
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !(RESOURCE_CAPABILITIES as readonly string[]).includes(item))) {
      throw new ResourceRequestValidationError('Element capabilities must contain supported values')
    }
  }
  if (Object.hasOwn(body, 'contentProfile') && !isContentProfileUpdate(body.contentProfile)) {
    throw new ResourceRequestValidationError('Element contentProfile must contain inspected logical-asset contents')
  }
  if (Object.hasOwn(body, 'relations')) {
    const value = body.relations
    if (!Array.isArray(value) || value.some(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return true
      const relation = item as Record<string, unknown>
      return typeof relation.kind !== 'string' ||
        !(RESOURCE_RELATION_KINDS as readonly string[]).includes(relation.kind) ||
        typeof relation.targetElementId !== 'string' || !relation.targetElementId.trim() ||
        (relation.role !== undefined && (typeof relation.role !== 'string' || !relation.role.trim())) ||
        (relation.required !== undefined && typeof relation.required !== 'boolean')
    })) {
      throw new ResourceRequestValidationError('Element relations must contain supported semantic relations')
    }
  }
}

function isContentProfileUpdate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const profile = value as Record<string, unknown>
  if (!['self-contained', 'external-dependencies', 'unknown'].includes(String(profile.packaging))) return false
  if (!Array.isArray(profile.components) || profile.components.some(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return true
    const component = item as Record<string, unknown>
    return typeof component.id !== 'string' || !component.id.trim() ||
      typeof component.kind !== 'string' || !(RESOURCE_EMBEDDED_COMPONENT_KINDS as readonly string[]).includes(component.kind)
  })) return false
  if (!profile.inspection || typeof profile.inspection !== 'object' || Array.isArray(profile.inspection)) return false
  const inspection = profile.inspection as Record<string, unknown>
  return ['complete', 'partial', 'unavailable'].includes(String(inspection.status)) &&
    ['server', 'client', 'admin'].includes(String(inspection.source))
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  if (values.length !== value.length) throw new ResourceRequestValidationError('Resource requirement list values must be strings')
  return values.length ? values : undefined
}

function listQuery(params: URLSearchParams, key: string): string[] | undefined {
  const values = params.getAll(key).map(value => value.trim()).filter(Boolean)
  return values.length ? values : undefined
}

function enumQuery<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T[] | undefined {
  const values = listQuery(params, key)
  if (!values) return undefined
  if (values.some(value => !allowed.includes(value as T))) throw new Error(`Unsupported ${key}`)
  return values as T[]
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}

function corsResponse(response: Response, origin = '*'): Response {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(response.body, { status: response.status, headers })
}
