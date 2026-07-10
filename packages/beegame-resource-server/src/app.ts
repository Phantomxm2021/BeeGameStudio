import {
  RESOURCE_CATEGORIES,
  type ResourceDimension,
  type ResourceCategory,
  type ResourcePack,
  type ResourceRepository,
} from '@bee-game-studio/beegame-resource-core'
import {
  createLocalResourceUserResolver,
  hasResourceAdminPermission,
  type ResourceUserContext,
  type ResourceUserResolver,
} from './auth'
import { ResourceImportError } from './import-resource-pack'

export type BeeGameResourceServerAppOptions = {
  repository: ResourceRepository
  currentUser?: ResourceUserContext
  currentUserResolver?: ResourceUserResolver
  corsOrigin?: string
  importResourcePack?: (request: Request) => Promise<unknown>
  updateResourcePack?: (packId: string, body: Record<string, unknown>) => Promise<unknown>
  addResourceElement?: (packId: string, request: Request) => Promise<unknown>
  updateResourceElement?: (packId: string, elementId: string, body: Record<string, unknown>) => Promise<unknown>
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
      const pathname = new URL(request.url).pathname
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
      if (request.method === 'PATCH' && patchMatch) {
        if (!options.updateResourcePack) return corsResponse(jsonError(503, 'not_configured', 'Resource updates are not configured'), options.corsOrigin)
        const body = await request.json() as Record<string, unknown>
        return corsResponse(Response.json({ pack: await options.updateResourcePack(decodeURIComponent(patchMatch[1]), body) }), options.corsOrigin)
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
      if (request.method === 'PATCH' && elementPatchMatch) {
        if (!options.updateResourceElement) return corsResponse(jsonError(503, 'not_configured', 'Resource element updates are not configured'), options.corsOrigin)
        const body = await request.json() as Record<string, unknown>
        return corsResponse(Response.json({ element: await options.updateResourceElement(decodeURIComponent(elementPatchMatch[1]), decodeURIComponent(elementPatchMatch[2]), body) }), options.corsOrigin)
      }
      try {
        return corsResponse(await routeRequest(request, options.repository), options.corsOrigin)
      } catch (error) {
        return corsResponse(jsonError(500, 'resource_read_failed', error instanceof Error ? error.message : 'Resource request failed'), options.corsOrigin)
      }
    },
  }
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
