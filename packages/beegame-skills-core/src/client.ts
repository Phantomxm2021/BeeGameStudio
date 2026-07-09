import type {
  BeeGameSkillsConfig,
} from './config'
import type {
  BeeGameUserSkill,
} from './types'

export async function fetchEnabledUserSkills(
  config: BeeGameSkillsConfig,
  userId: string,
): Promise<BeeGameUserSkill[]> {
  const response = await fetch(
    `${config.apiBaseUrl}/api/internal/user-skills/enabled?userId=${encodeURIComponent(userId)}`,
    {
      headers: {
        ...(config.serviceToken ? { authorization: `Bearer ${config.serviceToken}` } : {}),
      },
    },
  )
  if (!response.ok) {
    throw new Error(`BeeGame skills request failed: ${response.status} ${response.statusText}`)
  }
  const payload = await response.json()
  if (!Array.isArray(payload)) {
    throw new Error('BeeGame skills request returned an invalid payload')
  }
  return payload as BeeGameUserSkill[]
}

export async function proxyBeeGameSkillsRequest(
  config: BeeGameSkillsConfig,
  request: Request,
  path: string,
): Promise<Response> {
  const headers = new Headers()
  const authorization = request.headers.get('authorization')
  if (authorization) headers.set('authorization', authorization)
  const contentType = request.headers.get('content-type')
  const init: RequestInit = {
    method: request.method,
    headers,
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (contentType) headers.set('content-type', contentType)
    init.body = await request.arrayBuffer()
  }
  const response = await fetch(`${config.apiBaseUrl}${path}`, init)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: filterResponseHeaders(response.headers),
  })
}

function filterResponseHeaders(input: Headers): Headers {
  const headers = new Headers()
  const contentType = input.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  return headers
}
