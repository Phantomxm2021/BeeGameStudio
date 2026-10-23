import type { BeeGameBillingConfig } from './billing-config'

/** Encrypted platform settings, transferred only between trusted services. */
export type ImageConfigRead = {
  source: 'supabase-platform'
  databaseHost?: string
  httpStatus?: number
  rowExists?: boolean
  code?: 'database-config-missing' | 'database-network' | 'database-http' | 'database-response' | 'platform-row-missing'
  config?: unknown
}

/** Amounts are integer micro-Credits, supplied only by the trusted host. */
export type ImageBillingInput = {
  projectId: string
  requestId: string
  digest: string
  action: 'reserve' | 'settle' | 'release'
  amountCreditsMicro: number
  projectBudgetCreditsMicro: number
  metadata?: Record<string, unknown>
}
export type ImageBillingReceipt = {
  created: boolean
  /** A different ID matched an unresolved request; this receipt authorizes no new work. */
  blockedByRequestId?: string
  state: 'reserved' | 'settled' | 'released'
  reservedCreditsMicro: number
  chargedCreditsMicro: number
  metadata: Record<string, unknown>
}
export interface ImageBillingClient {
  apply(userId: string, input: ImageBillingInput): Promise<ImageBillingReceipt>
}
export function validImageBillingInput(value: unknown): value is ImageBillingInput {
  if (!value || typeof value !== 'object') return false
  const input = value as ImageBillingInput
  return [input.projectId, input.requestId, input.digest].every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 256)
    && ['reserve', 'settle', 'release'].includes(input.action)
    && [input.amountCreditsMicro, input.projectBudgetCreditsMicro].every(v => Number.isSafeInteger(v) && v >= 0)
    && (input.action !== 'reserve' || (input.amountCreditsMicro > 0 && input.projectBudgetCreditsMicro >= input.amountCreditsMicro))
    && (input.action !== 'release' || input.amountCreditsMicro === 0)
    && (input.metadata === undefined || (input.metadata !== null && typeof input.metadata === 'object' && !Array.isArray(input.metadata)))
}
export function createImageBillingClient(config: BeeGameBillingConfig, fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch): ImageBillingClient {
  return { async apply(userId, input) {
    if (config.mode !== 'remote' || !config.remoteApiBaseUrl || !config.creditControlToken)
      throw new Error('Image billing is not configured')
    if (!userId.trim() || !validImageBillingInput(input)) throw new Error('Invalid image billing request')
    const response = await fetchImpl(`${config.remoteApiBaseUrl.replace(/\/+$/, '')}/api/internal/images/billing`, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-beegame-credit-control-token': config.creditControlToken },
      body: JSON.stringify({ userId, ...input }),
    })
    if (!response.ok) throw new Error(`Image billing unavailable (${response.status}); no automatic retry`)
    const receipt = await response.json() as ImageBillingReceipt
    if (receipt.blockedByRequestId !== undefined &&
      (typeof receipt.blockedByRequestId !== 'string' || !receipt.blockedByRequestId.trim() ||
       receipt.blockedByRequestId.length > 256 || receipt.created !== false || receipt.state !== 'reserved'))
      throw new Error('Invalid blocked image billing receipt')
    if (!['reserved', 'settled', 'released'].includes(receipt.state)
      || typeof receipt.created !== 'boolean'
      || ![receipt.reservedCreditsMicro, receipt.chargedCreditsMicro].every(v => Number.isSafeInteger(v) && v >= 0)
      || !receipt.metadata || typeof receipt.metadata !== 'object') throw new Error('Invalid image billing receipt')
    return receipt
  } }
}
