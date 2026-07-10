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

export type BeeGameResourceServerAppOptions = {
  repository: ResourceRepository
  currentUser?: ResourceUserContext
  currentUserResolver?: ResourceUserResolver
}

export function createBeeGameResourceServerApp(
  options: BeeGameResourceServerAppOptions,
) {
  const resolveUser = options.currentUserResolver ?? createLocalResourceUserResolver()
  return {
    fetch: async (request: Request): Promise<Response> => {
      const user = options.currentUser ?? await resolveUser(request)
      if (!user) return jsonError(401, 'unauthorized', 'Authenticated resource user is required')
      if (!hasResourceAdminPermission(user)) {
        return jsonError(403, 'forbidden', 'Resource library administration is not allowed')
      }
      return routeRequest(request, options.repository)
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
