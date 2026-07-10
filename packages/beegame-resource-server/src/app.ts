import {
  RESOURCE_CATEGORIES,
  type ResourceCategory,
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
      return corsResponse(await routeRequest(request, options.repository), options.corsOrigin)
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
    return Response.json({ elements: await repository.listElements(packId, category) })
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
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(response.body, { status: response.status, headers })
}
