// No credentials, HTML injection or native Storage replacement. Preview's
// existing bearer host selects the namespace; callers never select an owner.
export const PREVIEW_STORAGE_PATH = '/__bgs/preview-storage'
export const PREVIEW_STORAGE_HEADER = 'X-BeeGame-Preview-Storage'
export const PREVIEW_STORAGE_VERSION = 'project-v1'
export const PREVIEW_STORAGE_MAX_VALUE = 64 * 1024
const utf8 = value => new TextEncoder().encode(value).length
export class PreviewStorageError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}
export function validatePreviewStorageItem(key, value) {
  if (typeof key !== 'string' || !key.length || utf8(key) > 256 || value !== null && typeof value !== 'string')
    throw new PreviewStorageError('Expected a nonempty key (at most 256 UTF-8 bytes) and a string or null value')
  if (value !== null && utf8(value) > PREVIEW_STORAGE_MAX_VALUE)
    throw new PreviewStorageError('Preview value exceeds 64 KiB', 413)
}
export function setPreviewStorageItem(entries, key, value) {
  validatePreviewStorageItem(key, value)
  const next = new Map(entries)
  if (value === null) next.delete(key); else next.set(key, value)
  if (next.size > 128 || [...next].reduce((sum, [k, v]) => sum + utf8(k) + utf8(v), 0) > 256 * 1024)
    throw new PreviewStorageError('Preview project storage quota exceeded (128 keys / 256 KiB)', 413)
  entries.clear(); for (const [k, v] of next) entries.set(k, v)
}

/** Shared by the actual Preview and disposable measurement namespaces. */
export async function handlePreviewStorageRequest(request, store, authorize = async () => {}) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'X-Content-Type-Options': 'nosniff' }
  const json = (value, status = 200) => Response.json(value, { status, headers })
  try {
    const url = new URL(request.url), origin = request.headers.get('origin')
    if (origin && origin !== 'null' && origin !== url.origin) throw new PreviewStorageError('Origin not allowed', 403)
    if (url.pathname !== PREVIEW_STORAGE_PATH) throw new PreviewStorageError('Not found', 404)
    if (request.method === 'OPTIONS') { await authorize(); return new Response(null, { status: 204, headers }) }
    if (request.method === 'GET') {
      if ([...url.searchParams.keys()].join(',') !== 'key') throw new PreviewStorageError('GET accepts one key only')
      const key = url.searchParams.get('key'); validatePreviewStorageItem(key, null)
      await authorize()
      return json({ value: store.getItem(key) })
    }
    if (request.method !== 'POST') throw new PreviewStorageError('Method not allowed', 405)
    if (url.search || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      throw new PreviewStorageError('POST accepts JSON {key,value} only')
    const reader = request.body?.getReader(), parts = []; let size = 0
    if (!reader) throw new PreviewStorageError('Missing JSON body')
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        size += value.byteLength
        if (size > PREVIEW_STORAGE_MAX_VALUE * 6 + 2048) {
          await reader.cancel(); throw new PreviewStorageError('Preview request too large', 413)
        }
        parts.push(value)
      }
    } finally { reader.releaseLock() }
    let body
    try { body = JSON.parse(await new Blob(parts).text()) } catch { throw new PreviewStorageError('Invalid JSON') }
    if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'key,value')
      throw new PreviewStorageError('POST accepts key and value only; scope is host-owned')
    validatePreviewStorageItem(body.key, body.value)
    // Recheck after streaming the untrusted body, immediately before the
    // synchronous store mutation. Closing an old Preview cannot grant a write.
    await authorize()
    store.setItem(body.key, body.value)
    return json({ saved: true })
  } catch (error) {
    return json({ error: error instanceof PreviewStorageError ? error.message : 'Preview storage unavailable; nothing acknowledged' },
      error instanceof PreviewStorageError ? error.status : 503)
  }
}

/** Portable async API. Deployment uses its own native localStorage, never the
 * Preview store. Failed persistence rejects instead of falling back to memory. */
export async function createGameStorage(documentUrl = globalThis.location.href, fetcher = globalThis.fetch) {
  const url = new URL(documentUrl)
  const head = await fetcher(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store', redirect: 'error' })
  if (!head.ok) throw Error('Storage environment unavailable: HTTP ' + head.status)
  if (head.headers.get(PREVIEW_STORAGE_HEADER) === PREVIEW_STORAGE_VERSION) {
    const endpoint = new URL(PREVIEW_STORAGE_PATH, url)
    const request = async (key, value, write) => {
      validatePreviewStorageItem(key, write ? value : null)
      const target = new URL(endpoint)
      if (!write) target.searchParams.set('key', key)
      const response = await fetcher(target, { method: write ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
        ...(write ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) } : {}) })
      if (!response.ok) throw Error('Preview storage failed: HTTP ' + response.status)
      const result = await response.json()
      if (write ? result.saved !== true : result.value !== null && typeof result.value !== 'string') throw Error('Invalid Preview storage response')
      return write ? undefined : result.value
    }
    return { kind: 'preview', getItem: key => request(key, null, false),
      async setItem(key, value) { if (typeof value !== 'string') throw Error('setItem requires a string'); await request(key, value, true) },
      removeItem: key => request(key, null, true) }
  }
  const native = globalThis.localStorage, prefix = 'bgs-game:' + new URL('.', url).pathname + ':'
  return { kind: 'deployment', async getItem(key) { validatePreviewStorageItem(key, null); return native.getItem(prefix + key) },
    async setItem(key, value) { validatePreviewStorageItem(key, value); if (typeof value !== 'string') throw Error('setItem requires a string'); native.setItem(prefix + key, value) },
    async removeItem(key) { validatePreviewStorageItem(key, null); native.removeItem(prefix + key) } }
}
