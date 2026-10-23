import { randomUUID } from 'node:crypto'
import type { BeeGameBillingConfig } from '@bee-game-studio/beegame-billing-core/billing-config'
import { decodeImageSettings, selectImageConfig, loadLocalImageConfig } from './config-store'
import { CHATGPT_IMAGE_ENDPOINT } from './config'
import { getUserDashboardDataRoot } from '../local-runtime-service'
import { hasChatGPTAccount } from '../model-connections'

type Facts = { source: 'local-platform' | 'service-platform'; serviceHttpStatus?: number;
  databaseHttpStatus?: number; databaseHost?: string; rowExists?: boolean }
export class ImageConfigurationError extends Error {
  readonly diagnosticId = randomUUID()
  constructor(readonly code: string, readonly facts: Facts) {
    super('Image configuration unavailable: ' + code)
  }
}

/** Same storage mode as Dashboard; runtime never needs a database master key. */
export async function loadRuntimeImageConfig(dataRoot: string,
  options: { remote: boolean; billing: BeeGameBillingConfig },
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch) {
  const facts: Facts = { source: options.remote ? 'service-platform' : 'local-platform' }
  const fail = (code: string): never => {
    const error = new ImageConfigurationError(code, facts)
    console.warn('[image-generation]', { event: 'configuration-failed', diagnosticId: error.diagnosticId, code, ...facts })
    throw error
  }
  let config
  if (!options.remote) {
    try { config = loadLocalImageConfig(dataRoot) } catch { return fail('local-config-invalid') }
  } else {
    const { remoteApiBaseUrl, creditControlToken } = options.billing
    if (!remoteApiBaseUrl || !creditControlToken) return fail('config-service-unconfigured')
    let response: Response
    try {
      response = await fetchImpl(remoteApiBaseUrl.replace(/\/+$/, '') + '/api/internal/images/config', {
        headers: { 'x-beegame-credit-control-token': creditControlToken }, redirect: 'error',
      })
    } catch { return fail('config-service-network') }
    facts.serviceHttpStatus = response.status
    let body: any
    try { body = await response.json() } catch { return fail('config-service-response') }
    if (Number.isInteger(body?.httpStatus) && body.httpStatus >= 100 && body.httpStatus <= 599)
      facts.databaseHttpStatus = body.httpStatus
    if (typeof body?.rowExists === 'boolean') facts.rowExists = body.rowExists
    if (typeof body?.databaseHost === 'string' && /^[a-zA-Z0-9.:[\]-]+$/.test(body.databaseHost))
      facts.databaseHost = body.databaseHost
    const codes = ['database-config-missing', 'database-network', 'database-http', 'database-response', 'platform-row-missing']
    if (!response.ok || body?.code)
      return fail(codes.includes(body?.code) ? body.code : 'config-service-http')
    if (!body?.config || body.rowExists !== true) return fail('platform-row-missing')
    try { config = selectImageConfig(decodeImageSettings(body.config)) }
    catch { return fail('config-decode-or-schema') }
  }
  if (config.provider === 'chatgpt-subscription') {
    if (!config.subscriptionOwnerId || !config.responseModel || config.baseUrl !== CHATGPT_IMAGE_ENDPOINT || config.apiKey || config.upstreamApiKey)
      return fail('subscription-config-invalid')
    if (!hasChatGPTAccount(getUserDashboardDataRoot(dataRoot, config.subscriptionOwnerId)))
      return fail('subscription-login-unavailable')
  } else if (!config.apiKey) return fail('provider-key-missing')
  console.info('[image-generation]', { event: 'configuration-loaded', ...facts,
    provider: config.provider, model: config.model })
  return config
}
