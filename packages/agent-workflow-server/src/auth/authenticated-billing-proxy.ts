import type {
  BeeGameBillingConfig,
} from '@bee-game-studio/beegame-billing-core/billing-config'
import {
  proxyBeeGameBillingRequest,
  type BeeGameBillingFetch,
} from '@bee-game-studio/beegame-billing-core/remote-billing-proxy'
import {
  type BeeGameSessionAuth,
} from './session-routes'
import {
  authenticationRequiredResponse,
  createAuthenticatedServiceRequest,
} from './authenticated-service-request'

export async function proxyAuthenticatedBillingRequest(
  request: Request,
  billingConfig: BeeGameBillingConfig,
  path: string,
  sessionAuth?: BeeGameSessionAuth,
  fetchImpl?: BeeGameBillingFetch,
): Promise<Response> {
  const authenticatedRequest = await createAuthenticatedServiceRequest(
    request,
    sessionAuth,
  )
  if (!authenticatedRequest) return authenticationRequiredResponse()
  return proxyBeeGameBillingRequest(
    authenticatedRequest,
    billingConfig,
    path,
    fetchImpl,
  )
}
