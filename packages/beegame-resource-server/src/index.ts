import { createInMemoryResourceRepository, type ResourcePack } from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp } from './app'
import { resolveBeeGameResourceListenOptions } from './env'
import { createSupabaseResourceRepository } from './supabase-resource-repository'
import { createSupabaseResourcePackImporter } from './import-resource-pack'

export { createBeeGameResourceServerApp } from './app'
export type { BeeGameResourceServerAppOptions } from './app'

if (import.meta.main) {
  await loadResourceSupabaseEnv()
  const { host, port } = resolveBeeGameResourceListenOptions()
  const baseUrl = process.env.BEEGAME_SUPABASE_URL
  const serviceRoleKey = process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
  const app = createBeeGameResourceServerApp({
    repository: createConfiguredResourceRepository(),
    importResourcePack: baseUrl && serviceRoleKey ? createSupabaseResourcePackImporter({ baseUrl, serviceRoleKey, uploadConcurrency: Number(process.env.BEEGAME_RESOURCE_UPLOAD_CONCURRENCY || 1) }) : undefined,
    ...(baseUrl && serviceRoleKey ? createSupabaseResourceLifecycleHandlers({ baseUrl, serviceRoleKey }) : {}),
    addResourceElement: baseUrl && serviceRoleKey ? async (packId, request) => {
      const form = await request.formData(); const file = form.get('file'); const category = String(form.get('category') || 'assets'); const folderPath = trimPath(String(form.get('folderPath') || category))
      if (!(file instanceof File)) throw new Error('Element file is required')
      if (!folderPath || folderPath.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Element folder path is invalid')
      const relativePath = `${folderPath}/${file.name}`
      const path = `${packId}/${relativePath}`
      const storageUrl = `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/beegame-resource-packs/${path.split('/').map(encodeURIComponent).join('/')}`
      const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' }
      const uploaded = await fetch(storageUrl, { method: 'POST', headers, body: await file.arrayBuffer() })
      if (!uploaded.ok) throw new Error('Element storage upload failed')
      const id = `${packId}-${crypto.randomUUID()}`; const row = { id, pack_id: packId, name: file.name, path: relativePath, category, kind: inferElementKind(file), specs: { size: file.size, mimeType: file.type || 'application/octet-stream', extension: extensionFromName(file.name) }, dependencies: [], status: 'ready' }
      const saved = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_elements`, { method: 'POST', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(row) })
      if (!saved.ok) { await fetch(storageUrl, { method: 'DELETE', headers }); throw new Error('Element metadata persistence failed') }
      return (await saved.json() as unknown[])[0]
    } : undefined,
    updateResourceElement: baseUrl && serviceRoleKey ? async (packId, elementId, body) => {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(toElementRow(body)) })
      if (!response.ok) throw new Error(`Resource element update failed (${response.status})`)
      return (await response.json() as unknown[])[0]
    } : undefined,
  })
  const server = Bun.serve({ hostname: host, port, fetch: app.fetch })
  console.log(`BeeGame resource server listening on http://${host}:${server.port}`)
}

async function loadResourceSupabaseEnv(): Promise<void> {
  for (const path of ['.env.billing', 'docker/.env.billing', '.env.local']) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    const text = await file.text()
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(BEEGAME_SUPABASE_(?:URL|SERVICE_ROLE_KEY|ANON_KEY))\s*=\s*(.*)\s*$/)
      if (match?.[1] && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

function createConfiguredResourceRepository(
  env: NodeJS.ProcessEnv = process.env,
) {
  const baseUrl = env.BEEGAME_SUPABASE_URL?.trim()
  const serviceRoleKey = env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (baseUrl && serviceRoleKey) {
    return createSupabaseResourceRepository({ baseUrl, serviceRoleKey })
  }
  if (env.BEEGAME_RESOURCE_REPOSITORY === 'memory' || env.NODE_ENV !== 'production') {
    return createInMemoryResourceRepository({ packs: [], elements: [] })
  }
  throw new Error('Resource repository requires Supabase configuration in production')
}

function trimPath(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '/') start += 1
  while (end > start && value[end - 1] === '/') end -= 1
  return value.slice(start, end)
}

function toElementRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    row[key === 'packId' ? 'pack_id' : key === 'styleOverride' ? 'style_override' : key === 'dimensionOverride' ? 'dimension_override' : key] = value
  }
  return row
}

export function toPackUpdateRow(body: Record<string, unknown>): Record<string, unknown> {
  const editable: Record<string, string> = {
    name: 'name', style: 'style', gameTypes: 'game_types', dimension: 'dimension',
    primaryCategory: 'primary_category', categories: 'categories', license: 'license', version: 'version',
  }
  const row: Record<string, unknown> = {}
  for (const [input, column] of Object.entries(editable)) {
    if (Object.hasOwn(body, input)) row[column] = body[input]
  }
  return row
}

export function extensionFromName(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : ''
}

export function inferElementKind(file: File): string {
  const extension = extensionFromName(file.name)
  const mimeType = file.type.toLowerCase()
  if (['glb', 'gltf', 'obj', 'fbx', 'dae', 'blend', 'stl', 'usd', 'usdz'].includes(extension) || mimeType.startsWith('model/')) return 'model'
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(extension)) return 'audio'
  if (mimeType.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(extension)) return 'video'
  if (mimeType.startsWith('font/') || ['ttf', 'otf', 'woff', 'woff2'].includes(extension)) return 'font'
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'].includes(extension)) return 'image'
  if (mimeType === 'application/pdf' || ['pdf', 'txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) return 'document'
  return 'file'
}

type SupabaseLifecycleOptions = { baseUrl: string; serviceRoleKey: string; fetchImpl?: typeof fetch; storageBucket?: string }

export function createSupabaseResourceLifecycleHandlers(options: SupabaseLifecycleOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const storageBucket = options.storageBucket ?? 'beegame-resource-packs'
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}` }
  const objectUrl = (path: string) => `${baseUrl}/storage/v1/object/${storageBucket}/${path.split('/').map(encodeURIComponent).join('/')}`
  const safePrefix = (packId: string) => `${packId.replaceAll('/', '%2F')}/`
  const deleteObject = async (path: string) => { await fetchImpl(objectUrl(path), { method: 'DELETE', headers }) }
  return {
    updateResourcePack: async (packId: string, body: Record<string, unknown>) => {
      const row = toPackUpdateRow(body)
      if (Object.keys(row).length === 0) throw new Error('No editable Pack fields were supplied')
      const response = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(row) })
      if (!response.ok) throw new Error(`Resource Pack update failed (${response.status})`)
      return (await response.json() as unknown[])[0]
    },
    deleteResourcePack: async (packId: string) => {
      const prefix = safePrefix(packId)
      const listed = await fetchImpl(`${baseUrl}/storage/v1/object/list/${storageBucket}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefix, limit: 1000, offset: 0 }) })
      if (!listed.ok) throw new Error(`Resource storage listing failed (${listed.status})`)
      const objects = await listed.json() as Array<{ name?: unknown }>
      for (const object of objects) {
        if (typeof object.name !== 'string') continue
        const path = object.name.startsWith(prefix) ? object.name : `${prefix}${object.name}`
        if (isSafeStoragePath(path, prefix)) await deleteObject(path)
      }
      const deleted = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=representation' } })
      if (!deleted.ok) throw new Error(`Resource Pack deletion failed (${deleted.status})`)
      return true
    },
    uploadPackCover: async (packId: string, request: Request): Promise<ResourcePack> => {
      const form = await request.formData(); const file = form.get('file')
      if (!(file instanceof File)) throw new Error('Cover file is required')
      const current = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}&select=cover_path`, { headers })
      if (!current.ok) throw new Error(`Resource Pack lookup failed (${current.status})`)
      const previous = (await current.json() as Array<{ cover_path?: string | null }>)[0]?.cover_path
      const coverPath = `cover/${crypto.randomUUID()}-${file.name}`
      const storagePath = `${packId}/${coverPath}`
      const uploaded = await fetchImpl(objectUrl(storagePath), { method: 'POST', headers: { ...headers, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: await file.arrayBuffer() })
      if (!uploaded.ok) throw new Error(`Cover storage upload failed (${uploaded.status})`)
      const saved = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ cover_path: coverPath }) })
      if (!saved.ok) { await deleteObject(storagePath); throw new Error(`Resource Pack cover update failed (${saved.status})`) }
      if (previous) await deleteObject(`${packId}/${previous}`)
      return toResourcePack((await saved.json() as Array<Record<string, unknown>>)[0])
    },
    getElementResourceUrl: async (packId: string, elementId: string) => {
      const lookup = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=pack_id,path`, { headers })
      if (!lookup.ok) throw new Error(`Resource element lookup failed (${lookup.status})`)
      const element = (await lookup.json() as Array<{ pack_id?: string; path?: string }>)[0]
      if (!element?.pack_id || !element.path || element.pack_id !== packId) throw new Error('Resource element not found in Pack')
      const signed = await fetchImpl(`${baseUrl}/storage/v1/object/sign/${storageBucket}/${`${packId}/${element.path}`.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) })
      if (!signed.ok) throw new Error(`Resource URL signing failed (${signed.status})`)
      const signedURL = (await signed.json() as { signedURL?: string }).signedURL
      if (!signedURL) throw new Error('Resource URL signing returned no URL')
      return new URL(signedURL, baseUrl).toString()
    },
  }
}

function toResourcePack(row: Record<string, unknown>): ResourcePack {
  return { id: String(row.id), name: String(row.name), style: String(row.style), gameTypes: Array.isArray(row.game_types) ? row.game_types.map(String) : [], dimension: row.dimension as ResourcePack['dimension'], primaryCategory: row.primary_category as ResourcePack['primaryCategory'], categories: Array.isArray(row.categories) ? row.categories as ResourcePack['categories'] : [], license: String(row.license), version: String(row.version), status: row.status as ResourcePack['status'], ...(typeof row.cover_path === 'string' ? { coverPath: row.cover_path } : {}) }
}

function isSafeStoragePath(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && path.slice(prefix.length).split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
