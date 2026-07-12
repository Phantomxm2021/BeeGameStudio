import {
  RESOURCE_CATEGORIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_PACK_PRIMARY_CATEGORIES,
  RESOURCE_USAGE_TAGS,
  evaluateResourcePackPublishReadiness,
  rankResourceCandidates,
  searchResourcePacks,
  selectResourceCandidates,
  type ResourceDimension,
  type ResourceCategory,
  type ResourcePack,
  type ResourceRepository,
  type ResourceSlotRequirement,
} from '@bee-game-studio/beegame-resource-core'
import {
  createConfiguredResourceUserResolver,
  createLocalResourceUserResolver,
  hasResourceAdminPermission,
  isLocalResourceFallbackAllowed,
  type ResourceUserContext,
  type ResourceUserResolver,
} from './auth'

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
  deleteResourceElement?: (packId: string, elementId: string) => Promise<boolean>
  updateResourceFolder?: (packId: string, folderId: string, body: Record<string, unknown>) => Promise<unknown>
  deleteResourceFolder?: (packId: string, folderId: string) => Promise<boolean>
  getElementResourceUrl?: (packId: string, elementId: string) => Promise<string>
  inspectPackStorage?: (packId: string) => Promise<{ missingPaths: string[]; orphanPaths: string[] }>
  recordAuditEvent?: (event: { actorId: string; action: string; packId?: string; elementId?: string; metadata?: Record<string, unknown> }) => Promise<void>
  serviceSelectionToken?: string
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
      const serviceSelectionRequest = request.method === 'POST' && (pathname === '/api/resource-selections' || pathname === '/api/resource-candidates' || pathname === '/api/resource-bindings/refresh') &&
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
      if (request.method === 'POST' && pathname === '/api/resource-selections') {
        if (!options.getElementResourceUrl) return corsResponse(jsonError(503, 'not_configured', 'Resource selection URLs are not configured'), options.corsOrigin)
        let requirements: ResourceSlotRequirement[]
        try {
          requirements = parseSelectionRequirements(await request.json())
        } catch (error) {
          return corsResponse(jsonError(400, 'invalid_selection_request', error instanceof Error ? error.message : 'Invalid resource selection request'), options.corsOrigin)
        }
        const packs = await options.repository.listPacks()
        const elements = (await Promise.all(packs.map(pack => options.repository.listElements(pack.id)))).flat()
        const manifest = selectResourceCandidates(packs, elements, requirements)
        const selections = await Promise.all(manifest.selections.map(async selection => ({
          ...selection,
          sourceUrl: await options.getElementResourceUrl!(selection.packId, selection.elementId),
          dependencies: await Promise.all((selection.dependencies ?? []).map(async dependency => ({
            ...dependency,
            sourceUrl: await options.getElementResourceUrl!(selection.packId, dependency.elementId),
          }))),
        })))
        return corsResponse(Response.json({ selections, unmatchedSlotIds: manifest.unmatchedSlotIds }), options.corsOrigin)
      }
      if (request.method === 'POST' && pathname === '/api/resource-bindings/refresh') {
        if (!serviceSelectionRequest || !options.getElementResourceUrl) return corsResponse(jsonError(403, 'forbidden', 'Resource binding refresh is not allowed'), options.corsOrigin)
        const body = await request.json().catch(() => undefined)
        if (!body || typeof body !== 'object' || Array.isArray(body)) return corsResponse(jsonError(400, 'invalid_binding', 'A resource binding is required'), options.corsOrigin)
        const binding = body as Record<string, unknown>
        const packId = typeof binding.packId === 'string' ? binding.packId : ''
        const packVersion = typeof binding.packVersion === 'string' ? binding.packVersion : ''
        const elementId = typeof binding.elementId === 'string' ? binding.elementId : ''
        if (!packId || !packVersion || !elementId) return corsResponse(jsonError(400, 'invalid_binding', 'Resource binding is incomplete'), options.corsOrigin)
        const pack = await options.repository.getPack(packId)
        if (!pack || pack.version !== packVersion) return corsResponse(jsonError(409, 'pinned_resource_unavailable', 'The pinned Pack version is no longer available'), options.corsOrigin)
        const element = await options.repository.getElement(packId, elementId)
        if (!element || element.status !== 'ready') return corsResponse(jsonError(409, 'pinned_resource_unavailable', 'The pinned resource is no longer ready'), options.corsOrigin)
        const dependencies = Array.isArray(binding.dependencies) ? binding.dependencies : []
        const refreshedDependencies: Array<{ key: string; sourceUrl: string }> = []
        for (const dependency of dependencies) {
          if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) return corsResponse(jsonError(400, 'invalid_binding', 'Resource dependency is invalid'), options.corsOrigin)
          const value = dependency as Record<string, unknown>
          const key = typeof value.key === 'string' ? value.key : ''
          const dependencyElementId = typeof value.elementId === 'string' ? value.elementId : ''
          if (!key || !dependencyElementId) return corsResponse(jsonError(400, 'invalid_binding', 'Resource dependency is incomplete'), options.corsOrigin)
          const dependencyElement = await options.repository.getElement(packId, dependencyElementId)
          if (!dependencyElement || dependencyElement.status !== 'ready') return corsResponse(jsonError(409, 'pinned_resource_unavailable', 'A pinned dependency is no longer ready'), options.corsOrigin)
          refreshedDependencies.push({ key, sourceUrl: await options.getElementResourceUrl(packId, dependencyElementId) })
        }
        return corsResponse(Response.json({ sourceUrl: await options.getElementResourceUrl(packId, elementId), dependencies: refreshedDependencies }), options.corsOrigin)
      }
      if (request.method === 'POST' && pathname === '/api/resource-candidates') {
        if (!serviceSelectionRequest || !options.getElementResourceUrl) return corsResponse(jsonError(403, 'forbidden', 'Resource candidate access is not allowed'), options.corsOrigin)
        const requirements = parseSelectionRequirements(await request.json())
        const requirement = requirements[0]
        if (!requirement) return corsResponse(jsonError(400, 'invalid_selection_request', 'A resource requirement is required'), options.corsOrigin)
        const packs = await options.repository.listPacks(); const elements = (await Promise.all(packs.map(pack => options.repository.listElements(pack.id)))).flat()
        const candidates = await Promise.all(
          rankResourceCandidates(packs, elements, requirement).slice(0, 24).map(async selection => ({
            ...selection,
            sourceUrl: await options.getElementResourceUrl!(selection.packId, selection.elementId),
            dependencies: await Promise.all(
              (selection.dependencies ?? []).map(async dependency => ({
                ...dependency,
                sourceUrl: await options.getElementResourceUrl!(selection.packId, dependency.elementId),
              })),
            ),
          })),
        )
        return corsResponse(Response.json({ candidates }), options.corsOrigin)
      }
      if (request.method === 'POST' && pathname === '/api/resource-packs') {
        try {
          const body = await request.json() as Record<string, unknown>
          const pack = await options.repository.createPack({
            id: typeof body.id === 'string' && body.id ? body.id : `pack-${crypto.randomUUID()}`,
            name: String(body.name || ''), style: String(body.style || ''),
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
          const body = await request.json() as { id?: string; name?: string; parentId?: string }
          if (!body.name) return corsResponse(jsonError(400, 'invalid_folder', 'Folder name is required'), options.corsOrigin)
          const packId = decodeURIComponent(folderMatch[1])
          const folder = await options.repository.createFolder(packId, { id: body.id || `folder-${crypto.randomUUID()}`, name: body.name, parentId: body.parentId })
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
        const body = await request.json() as { name?: unknown }
        if (typeof body.name !== 'string' || !body.name.trim()) return corsResponse(jsonError(400, 'invalid_folder', 'Folder name is required'), options.corsOrigin)
        const folder = (options.updateResourceFolder ? await options.updateResourceFolder(packId, folderId, { name: body.name }) : await options.repository.updateFolder(packId, folderId, { name: body.name })) as { path?: string } | undefined
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
        const element = await options.updateResourceElement(decodeURIComponent(elementPatchMatch[1]), decodeURIComponent(elementPatchMatch[2]), body)
        if (!element) return corsResponse(jsonError(404, 'not_found', 'Resource element not found'), options.corsOrigin)
        await audit({ actorId: user!.id, action: 'element.updated', packId: decodeURIComponent(elementPatchMatch[1]), elementId: decodeURIComponent(elementPatchMatch[2]), metadata: { fields: Object.keys(body).sort() } })
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
        return corsResponse(jsonError(500, 'resource_lifecycle_failed', error instanceof Error ? error.message : 'Resource lifecycle operation failed'), options.corsOrigin)
      }
    },
  }
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

function parseSelectionRequirements(value: unknown): ResourceSlotRequirement[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResourceRequestValidationError('Selection request must be an object')
  const requirements = (value as Record<string, unknown>).requirements
  if (!Array.isArray(requirements) || requirements.length === 0) throw new ResourceRequestValidationError('At least one resource requirement is required')
  return requirements.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ResourceRequestValidationError(`Resource requirement ${index + 1} is invalid`)
    const record = entry as Record<string, unknown>
    const slotId = typeof record.slotId === 'string' ? record.slotId.trim() : ''
    if (!slotId) throw new ResourceRequestValidationError(`Resource requirement ${index + 1} slotId is required`)
    const category = typeof record.category === 'string' && (RESOURCE_CATEGORIES as readonly string[]).includes(record.category)
      ? record.category as ResourceCategory
      : undefined
    if (record.category !== undefined && !category) throw new ResourceRequestValidationError(`Resource requirement ${index + 1} category is unsupported`)
    const dimension = typeof record.dimension === 'string' && (RESOURCE_DIMENSIONS as readonly string[]).includes(record.dimension)
      ? record.dimension as ResourceDimension
      : undefined
    if (record.dimension !== undefined && !dimension) throw new ResourceRequestValidationError(`Resource requirement ${index + 1} dimension is unsupported`)
    const tags = validatedUsageTags(record.tags, `Resource requirement ${index + 1}`)
    return {
      slotId,
      ...(category ? { category } : {}),
      ...(dimension ? { dimension } : {}),
      ...(stringList(record.acceptedFormats) ? { acceptedFormats: stringList(record.acceptedFormats)! } : {}),
      ...(stringList(record.styles) ? { styles: stringList(record.styles)! } : {}),
      ...(stringList(record.gameTypes) ? { gameTypes: stringList(record.gameTypes)! } : {}),
      ...(tags ? { tags } : {}),
      ...(typeof record.purpose === 'string' && record.purpose.trim() ? { purpose: record.purpose.trim() } : {}),
    }
  })
}

function validatedUsageTags(value: unknown, label: string): string[] | undefined {
  const values = stringList(value)
  if (!values) return undefined
  if (values.some(value => !(RESOURCE_USAGE_TAGS as readonly string[]).includes(value))) {
    throw new ResourceRequestValidationError(`${label} tags contain unsupported values`)
  }
  return values
}

function assertElementUsageTags(body: Record<string, unknown>): void {
  if (!Object.hasOwn(body, 'usageTags')) return
  const value = body.usageTags
  if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string' || !(RESOURCE_USAGE_TAGS as readonly string[]).includes(tag))) {
    throw new ResourceRequestValidationError('Element usageTags must contain supported values')
  }
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
