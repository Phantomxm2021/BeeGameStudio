import {
  authenticationRequiredResponse,
  createAuthenticatedServiceRequest,
} from './authenticated-service-request'
import type { BeeGameSessionAuth } from './session-routes'

export type BeeGameResourceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'if-none-match',
  'range',
] as const

const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
  'location',
] as const

export async function proxyAuthenticatedResourceRequest(
  request: Request,
  resourceApiBaseUrl: string,
  path: string,
  sessionAuth?: BeeGameSessionAuth,
  fetchImpl: BeeGameResourceFetch = fetch,
): Promise<Response> {
  const authenticatedRequest = await createAuthenticatedServiceRequest(
    request,
    sessionAuth,
  )
  if (!authenticatedRequest) return authenticationRequiredResponse()

  const headers = pickHeaders(
    authenticatedRequest.headers,
    FORWARDED_REQUEST_HEADERS,
  )
  const method = authenticatedRequest.method.toUpperCase()
  const init: RequestInit = {
    method,
    headers,
    signal: authenticatedRequest.signal,
  }
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = authenticatedRequest.body
  }

  let response: Response
  try {
    response = await fetchImpl(
      buildResourceServiceUrl(resourceApiBaseUrl, path),
      init,
    )
  } catch {
    return Response.json(
      {
        error: {
          code: 'resource_service_unavailable',
          message: 'Resource service is unavailable',
        },
      },
      { status: 503 },
    )
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: pickHeaders(response.headers, FORWARDED_RESPONSE_HEADERS),
  })
}

export function buildResourceServiceUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalizedPath, normalizedBaseUrl).toString()
}

function pickHeaders(
  input: Headers,
  names: readonly string[],
): Headers {
  const headers = new Headers()
  for (const name of names) {
    const value = input.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}
