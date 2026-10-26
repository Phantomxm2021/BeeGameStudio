export type DeliveryEnvironment = {
  DELIVERY_BUCKET: { get(key: string): Promise<{ body: BodyInit | null } | null> }
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  PORTAL_ORIGIN?: string
  CONTENT_SECURITY_POLICY?: string
}

export type DeliveryWorker = {
  fetch(request: Request, env: DeliveryEnvironment): Promise<Response>
}

export function createDeliveryWorker(options?: {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}): DeliveryWorker

declare const worker: DeliveryWorker
export default worker
