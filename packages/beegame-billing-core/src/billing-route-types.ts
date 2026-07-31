import type {
  BeeGameBillingRouteRepository,
} from './billing-ports'
import type {
  BeeGameBillingConfig,
} from './billing-config'

export type BeeGameBillingUserContext = {
  id: string
  role?: string
  permissions?: string[]
  email?: string
}

export type BillingRouteDeps = {
  billingConfig: BeeGameBillingConfig
  dashboardRepository: BeeGameBillingRouteRepository
  proxyRemoteBillingRequest?: (
    request: Request,
    path: string,
  ) => Promise<Response>
  getCurrentUser: (request?: Request) => BeeGameBillingUserContext
  hasPermission: (
    user: BeeGameBillingUserContext,
    permission: 'audit.read' | 'credits.admin',
  ) => boolean
}
