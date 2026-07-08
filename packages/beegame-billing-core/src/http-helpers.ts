export type JsonObject = Record<string, unknown>

export async function readJson(request: Request): Promise<JsonObject> {
  const body = await request.json().catch(() => ({}))
  return isObject(body) ? body : {}
}

export function getRequestOrigin(request: Request): string {
  const origin = request.headers.get('origin')?.trim()
  if (origin) return origin.replace(/\/+$/, '')
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
