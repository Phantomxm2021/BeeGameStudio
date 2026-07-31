import {
  resolveValidRequestAccessToken,
  type BeeGameSessionAuth,
} from './session-routes'

export async function createAuthenticatedServiceRequest(
  request: Request,
  sessionAuth?: BeeGameSessionAuth,
): Promise<Request | undefined> {
  const accessToken = await resolveValidRequestAccessToken(request, sessionAuth)
  if (!accessToken) return undefined

  const headers = new Headers(request.headers)
  headers.delete('cookie')
  headers.set('authorization', `Bearer ${accessToken}`)
  return new Request(request, { headers })
}

export function authenticationRequiredResponse(): Response {
  return Response.json(
    {
      error: 'Unauthorized',
      message: 'authentication required',
    },
    { status: 401 },
  )
}
