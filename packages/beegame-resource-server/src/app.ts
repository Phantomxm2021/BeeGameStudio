import {
  RESOURCE_CATEGORIES,
  RESOURCE_DIMENSIONS,
  selectResourceCandidates,
  type ResourceDimension,
  type ResourceCategory,
  type ResourcePack,
  type ResourceRepository,
  type ResourceSlotRequirement,
} from '@bee-game-studio/beegame-resource-core'
import {
  createLocalResourceUserResolver,
  hasResourceAdminPermission,
  type ResourceUserContext,
  type ResourceUserResolver,
} from './auth'
import { ResourceImportError } from './import-resource-pack'

export class ResourceLifecycleNotFoundError extends Error {}

export type BeeGameResourceServerAppOptions = {
  repository: ResourceRepository
  currentUser?: ResourceUserContext
  currentUserResolver?: ResourceUserResolver
  corsOrigin?: string
  importResourcePack?: (request: Request) => Promise<unknown>
  updateResourcePack?: (packId: string, body: Record<string, unknown>) => Promise<unknown>
  deleteResourcePack?: (packId: string) => Promise<boolean>
  uploadPackCover?: (packId: string, request: Request) => Promise<ResourcePack>
  addResourceElement?: (packId: string, request: Request) => Promise<unknown>
  updateResourceElement?: (packId: string, elementId: string, body: Record<string, unknown>) => Promise<unknown>
  deleteResourceElement?: (packId: string, elementId: string) => Promise<boolean>
  updateResourceFolder?: (packId: string, folderId: string, body: Record<string, unknown>) => Promise<unknown>
  deleteResourceFolder?: (packId: string, folderId: string) => Promise<boolean>
  getElementResourceUrl?: (packId: string, elementId: string) => Promise<string>
}

export function createBeeGameResourceServerApp(
  options: BeeGameResourceServerAppOptions,
) {
  const resolveUser = options.currentUserResolver ?? createLocalResourceUserResolver()
  return {
    fetch: async (request: Request): Promise<Response> => {
      if (request.method === 'OPTIONS') return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
      const user = options.currentUser ?? await resolveUser(request)
      if (!user) return corsResponse(jsonError(401, 'unauthorized', 'Authenticated resource user is required'), options.corsOrigin)
      if (!hasResourceAdminPermission(user)) {
        return corsResponse(jsonError(403, 'forbidden', 'Resource library administration is not allowed'), options.corsOrigin)
      }
      try {
      const pathname = new URL(request.url).pathname
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
        })))
        return corsResponse(Response.json({ selections, unmatchedSlotIds: manifest.unmatchedSlotIds }), options.corsOrigin)
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
          })
          return corsResponse(Response.json({ pack }, { status: 201 }), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(400, 'invalid_pack', error instanceof Error ? error.message : 'Invalid Pack'), options.corsOrigin)
        }
      }
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/resource-packs/import') {
        if (!options.importResourcePack) return corsResponse(jsonError(503, 'not_configured', 'Resource import is not configured'), options.corsOrigin)
        try { return corsResponse(Response.json({ pack: await options.importResourcePack(request) }, { status: 201 }), options.corsOrigin) } catch (error) {
          if (error instanceof ResourceImportError) return corsResponse(jsonError(error.status, error.code, error.message), options.corsOrigin)
          return corsResponse(jsonError(500, 'import_failed', error instanceof Error ? error.message : 'Resource import failed'), options.corsOrigin)
        }
      }
      const patchMatch = new URL(request.url).pathname.match(/^\/api\/resource-packs\/([^/]+)$/)
      if (request.method === 'DELETE' && patchMatch) {
        if (!options.deleteResourcePack) return corsResponse(jsonError(503, 'not_configured', 'Resource deletion is not configured'), options.corsOrigin)
        if (!await options.deleteResourcePack(decodeURIComponent(patchMatch[1]))) return corsResponse(jsonError(404, 'not_found', 'Resource Pack not found'), options.corsOrigin)
        return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
      }
      if (request.method === 'PATCH' && patchMatch) {
        if (!options.updateResourcePack) return corsResponse(jsonError(503, 'not_configured', 'Resource updates are not configured'), options.corsOrigin)
        const body = await request.json() as Record<string, unknown>
        const pack = await options.updateResourcePack(decodeURIComponent(patchMatch[1]), body)
        if (!pack) return corsResponse(jsonError(404, 'not_found', 'Resource Pack not found'), options.corsOrigin)
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
        return corsResponse(Response.json({ pack: await options.uploadPackCover(decodeURIComponent(coverMatch[1]), request) }), options.corsOrigin)
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
          const folder = await options.repository.createFolder(decodeURIComponent(folderMatch[1]), { id: body.id || `folder-${crypto.randomUUID()}`, name: body.name, parentId: body.parentId })
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
        const folder = options.updateResourceFolder ? await options.updateResourceFolder(packId, folderId, { name: body.name }) : await options.repository.updateFolder(packId, folderId, { name: body.name })
        if (!folder) return corsResponse(jsonError(404, 'not_found', 'Resource folder not found'), options.corsOrigin)
        return corsResponse(Response.json({ folder }), options.corsOrigin)
      }
      if (folderPatchMatch && request.method === 'DELETE') {
        const packId = decodeURIComponent(folderPatchMatch[1])
        const folderId = decodeURIComponent(folderPatchMatch[2])
        const deleted = options.deleteResourceFolder ? await options.deleteResourceFolder(packId, folderId) : await options.repository.deleteFolder(packId, folderId)
        if (!deleted) return corsResponse(jsonError(404, 'not_found', 'Resource folder not found'), options.corsOrigin)
        return corsResponse(new Response(null, { status: 204 }), options.corsOrigin)
      }
      const publishMatch = pathname.match(/^\/api\/resource-packs\/([^/]+)\/publish$/)
      if (publishMatch && request.method === 'POST') {
        try {
          const pack = await options.repository.publishPack(decodeURIComponent(publishMatch[1]))
          return corsResponse(Response.json({ pack }), options.corsOrigin)
        } catch (error) {
          return corsResponse(jsonError(400, 'publish_blocked', error instanceof Error ? error.message : 'Pack cannot be published'), options.corsOrigin)
        }
      }
      const elementMatch = new URL(request.url).pathname.match(/^\/api\/resource-packs\/([^/]+)\/elements$/)
      if (request.method === 'POST' && elementMatch) {
        if (!options.addResourceElement) return corsResponse(jsonError(503, 'not_configured', 'Resource element upload is not configured'), options.corsOrigin)
        return corsResponse(Response.json({ element: await options.addResourceElement(decodeURIComponent(elementMatch[1]), request) }, { status: 201 }), options.corsOrigin)
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
        const element = await options.updateResourceElement(decodeURIComponent(elementPatchMatch[1]), decodeURIComponent(elementPatchMatch[2]), body)
        if (!element) return corsResponse(jsonError(404, 'not_found', 'Resource element not found'), options.corsOrigin)
        return corsResponse(Response.json({ element }), options.corsOrigin)
      }
      if (request.method === 'DELETE' && elementPatchMatch) {
        const packId = decodeURIComponent(elementPatchMatch[1])
        const elementId = decodeURIComponent(elementPatchMatch[2])
        const deleted = options.deleteResourceElement ? await options.deleteResourceElement(packId, elementId) : await options.repository.deleteElement(packId, elementId)
        if (!deleted) return corsResponse(jsonError(404, 'not_found', 'Resource element not found'), options.corsOrigin)
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Selection request must be an object')
  const requirements = (value as Record<string, unknown>).requirements
  if (!Array.isArray(requirements) || requirements.length === 0) throw new Error('At least one resource requirement is required')
  return requirements.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Resource requirement ${index + 1} is invalid`)
    const record = entry as Record<string, unknown>
    const slotId = typeof record.slotId === 'string' ? record.slotId.trim() : ''
    if (!slotId) throw new Error(`Resource requirement ${index + 1} slotId is required`)
    const category = typeof record.category === 'string' && (RESOURCE_CATEGORIES as readonly string[]).includes(record.category)
      ? record.category as ResourceCategory
      : undefined
    if (record.category !== undefined && !category) throw new Error(`Resource requirement ${index + 1} category is unsupported`)
    const dimension = typeof record.dimension === 'string' && (RESOURCE_DIMENSIONS as readonly string[]).includes(record.dimension)
      ? record.dimension as ResourceDimension
      : undefined
    if (record.dimension !== undefined && !dimension) throw new Error(`Resource requirement ${index + 1} dimension is unsupported`)
    return {
      slotId,
      ...(category ? { category } : {}),
      ...(dimension ? { dimension } : {}),
      ...(stringList(record.acceptedFormats) ? { acceptedFormats: stringList(record.acceptedFormats)! } : {}),
      ...(stringList(record.styles) ? { styles: stringList(record.styles)! } : {}),
      ...(stringList(record.gameTypes) ? { gameTypes: stringList(record.gameTypes)! } : {}),
      ...(typeof record.purpose === 'string' && record.purpose.trim() ? { purpose: record.purpose.trim() } : {}),
    }
  })
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  if (values.length !== value.length) throw new Error('Resource requirement list values must be strings')
  return values.length ? values : undefined
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
