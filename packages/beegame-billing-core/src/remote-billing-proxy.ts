import type { BeeGameBillingConfig } from './billing-config'

export type BeeGameBillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export async function proxyBeeGameBillingRequest(
  request: Request,
  billingConfig: BeeGameBillingConfig,
  path: string,
  fetchImpl: BeeGameBillingFetch = fetch,
): Promise<Response> {
  if (!billingConfig.remoteApiBaseUrl) {
    return Response.json({
      error: 'Remote billing failed',
      message: 'BEEGAME_BILLING_API_BASE_URL is required for remote billing mode',
    }, { status: 503 })
  }
  const headers = new Headers()
  const authorization = request.headers.get('authorization')
  if (authorization) headers.set('authorization', authorization)
  const origin = request.headers.get('origin')
  if (origin) headers.set('origin', origin)
  const accept = request.headers.get('accept')
  if (accept) headers.set('accept', accept)
  const method = request.method.toUpperCase()
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    const contentType = request.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    init.body = await request.text()
  }
  let response: Response
  try {
    response = await fetchImpl(buildBeeGameBillingUrl(billingConfig.remoteApiBaseUrl, path), init)
  } catch {
    return Response.json({
      error: 'Remote billing failed',
      message: 'Billing service is unavailable',
    }, { status: 503 })
  }
  const responseHeaders = new Headers()
  const contentType = response.headers.get('content-type')
  if (contentType) responseHeaders.set('content-type', contentType)
  return new Response(await response.text(), {
    status: response.status,
    headers: responseHeaders,
  })
}

export function buildBeeGameBillingUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalizedPath, normalizedBaseUrl).toString()
}
