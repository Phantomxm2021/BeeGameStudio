import { createInMemoryResourceRepository, type PackSummary, type ResourceElement, type ResourcePack } from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp, ResourceLifecycleNotFoundError } from './app'
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
      const form = await request.formData(); const file = form.get('file'); const category = String(form.get('category') || 'assets'); const folderPath = safeRelativeStoragePath(trimPath(String(form.get('folderPath') || category)), 'Element folder path')
      if (!(file instanceof File)) throw new Error('Element file is required')
      const storagePackId = safeStorageComponent(packId, 'Pack id')
      const filename = safeStorageComponent(file.name, 'Element filename')
      const relativePath = `${folderPath}/${filename}`
      const path = `${storagePackId}/${relativePath}`
      const storageUrl = `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/beegame-resource-packs/${path.split('/').map(encodeURIComponent).join('/')}`
      const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' }
      const uploaded = await fetch(storageUrl, { method: 'POST', headers, body: await file.arrayBuffer() })
      if (!uploaded.ok) throw new Error('Element storage upload failed')
      const row = buildElementUploadRow(storagePackId, category, file, `${storagePackId}-${crypto.randomUUID()}`, relativePath, filename)
      const saved = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_elements`, { method: 'POST', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(row) })
      if (!saved.ok) { await fetch(storageUrl, { method: 'DELETE', headers }); throw new Error('Element metadata persistence failed') }
      return toResourceElement((await saved.json() as Array<Record<string, unknown>>)[0])
    } : undefined,
    updateResourceElement: baseUrl && serviceRoleKey ? async (packId, elementId, body) => {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(toElementRow(body)) })
      if (!response.ok) throw new Error(`Resource element update failed (${response.status})`)
      const row = (await response.json() as Array<Record<string, unknown>>)[0]
      if (!row) throw new ResourceLifecycleNotFoundError('Resource element not found')
      return toResourceElement(row)
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

export function toElementRow(body: Record<string, unknown>): Record<string, unknown> {
  const editable: Record<string, string> = {
    name: 'name', category: 'category', kind: 'kind', preview: 'preview', specs: 'specs',
    dependencies: 'dependencies', status: 'status', styleOverride: 'style_override', dimensionOverride: 'dimension_override',
  }
  const row: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(editable)) {
    if (Object.hasOwn(body, key)) row[column] = body[key]
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

export function buildElementUploadRow(packId: string, category: string, file: File, id = `${packId}-${crypto.randomUUID()}`, path = `${category}/${file.name}`, name = file.name): Record<string, unknown> {
  return { id, pack_id: packId, name, path, category, kind: inferElementKind(file), specs: { size: file.size, mimeType: file.type || 'application/octet-stream', extension: extensionFromName(name) }, dependencies: [], status: 'ready' }
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type SupabaseLifecycleOptions = { baseUrl: string; serviceRoleKey: string; fetchImpl?: FetchImplementation; storageBucket?: string }

export function createSupabaseResourceLifecycleHandlers(options: SupabaseLifecycleOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const storageBucket = options.storageBucket ?? 'beegame-resource-packs'
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}` }
  const objectUrl = (path: string) => `${baseUrl}/storage/v1/object/${storageBucket}/${path.split('/').map(encodeURIComponent).join('/')}`
  const safePrefix = (packId: string) => `${safeStorageComponent(packId, 'Pack id')}/`
  const deleteObject = async (path: string) => {
    const response = await fetchImpl(objectUrl(path), { method: 'DELETE', headers })
    if (!response.ok) throw new Error(`Resource storage deletion failed (${response.status})`)
  }
  const signObject = async (path: string): Promise<string> => {
    const response = await fetchImpl(`${baseUrl}/storage/v1/object/sign/${storageBucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) })
    if (!response.ok) throw new Error(`Resource URL signing failed (${response.status})`)
    const signedURL = (await response.json() as { signedURL?: string }).signedURL
    if (!signedURL) throw new Error('Resource URL signing returned no URL')
    return new URL(signedURL, baseUrl).toString()
  }
  const toClientPack = async (packId: string, row: Record<string, unknown>): Promise<PackSummary> => {
    const pack = toResourcePack(row)
    if (typeof row.cover_path !== 'string') return pack
    const storagePackId = safeStorageComponent(packId, 'Pack id')
    const coverPath = safeRelativeStoragePath(row.cover_path, 'Resource Pack cover path')
    return { ...pack, coverPath: await signObject(`${storagePackId}/${coverPath}`) }
  }
  return {
    updateResourcePack: async (packId: string, body: Record<string, unknown>) => {
      const row = toPackUpdateRow(body)
      if (Object.keys(row).length === 0) throw new Error('No editable Pack fields were supplied')
      const response = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(row) })
      if (!response.ok) throw new Error(`Resource Pack update failed (${response.status})`)
      const savedRow = (await response.json() as Array<Record<string, unknown>>)[0]
      if (!savedRow) throw new ResourceLifecycleNotFoundError('Resource Pack not found')
      return toClientPack(packId, savedRow)
    },
    deleteResourcePack: async (packId: string) => {
      const prefix = safePrefix(packId)
      const pageSize = 1000
      for (;;) {
        const listed = await fetchImpl(`${baseUrl}/storage/v1/object/list/${storageBucket}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefix, limit: pageSize, offset: 0 }) })
        if (!listed.ok) throw new Error(`Resource storage listing failed (${listed.status})`)
        const objects = await listed.json() as Array<{ name?: unknown }>
        for (const object of objects) {
          if (typeof object.name !== 'string') continue
          const path = object.name.startsWith(prefix) ? object.name : `${prefix}${object.name}`
          if (!isSafeStoragePath(path, prefix)) throw new Error('Resource storage contains an unsafe resource storage entry')
          await deleteObject(path)
        }
        if (objects.length === 0) break
      }
      const deleted = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=representation' } })
      if (!deleted.ok) throw new Error(`Resource Pack deletion failed (${deleted.status})`)
      return (await deleted.json() as Array<unknown>).length > 0
    },
    uploadPackCover: async (packId: string, request: Request): Promise<ResourcePack> => {
      const form = await request.formData(); const file = form.get('file')
      if (!(file instanceof File)) throw new Error('Cover file is required')
      const storagePackId = safeStorageComponent(packId, 'Pack id')
      const current = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}&select=cover_path`, { headers })
      if (!current.ok) throw new Error(`Resource Pack lookup failed (${current.status})`)
      const currentRow = (await current.json() as Array<{ cover_path?: string | null }>)[0]
      if (!currentRow) throw new ResourceLifecycleNotFoundError('Resource Pack not found')
      const previous = currentRow.cover_path
      const coverPath = `cover/${crypto.randomUUID()}-${sanitizeStorageBasename(file.name)}`
      const storagePath = `${storagePackId}/${coverPath}`
      const uploaded = await fetchImpl(objectUrl(storagePath), { method: 'POST', headers: { ...headers, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: await file.arrayBuffer() })
      if (!uploaded.ok) throw new Error(`Cover storage upload failed (${uploaded.status})`)
      let signedCoverUrl: string
      try { signedCoverUrl = await signObject(storagePath) } catch (error) { await deleteObject(storagePath); throw error }
      const saved = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ cover_path: coverPath }) })
      if (!saved.ok) { await deleteObject(storagePath); throw new Error(`Resource Pack cover update failed (${saved.status})`) }
      if (typeof previous === 'string' && isSafeRelativeStoragePath(previous)) await deleteObject(`${storagePackId}/${previous}`)
      const row = (await saved.json() as Array<Record<string, unknown>>)[0]
      if (!row) throw new ResourceLifecycleNotFoundError('Resource Pack not found')
      return { ...toResourcePack(row), coverPath: signedCoverUrl }
    },
    getElementResourceUrl: async (packId: string, elementId: string) => {
      const lookup = await fetchImpl(`${baseUrl}/rest/v1/beegame_resource_elements?id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=pack_id,path`, { headers })
      if (!lookup.ok) throw new Error(`Resource element lookup failed (${lookup.status})`)
      const element = (await lookup.json() as Array<{ pack_id?: string; path?: string }>)[0]
      if (!element?.pack_id || !element.path || element.pack_id !== packId) throw new Error('Resource element not found in Pack')
      const storagePackId = safeStorageComponent(packId, 'Pack id')
      const relativePath = safeRelativeStoragePath(element.path, 'Resource element path')
      return signObject(`${storagePackId}/${relativePath}`)
    },
  }
}

export function toResourcePack(row: Record<string, unknown>): PackSummary {
  return { id: String(row.id), name: String(row.name), style: String(row.style), gameTypes: Array.isArray(row.game_types) ? row.game_types.map(String) : [], dimension: row.dimension as ResourcePack['dimension'], primaryCategory: row.primary_category as ResourcePack['primaryCategory'], categories: Array.isArray(row.categories) ? row.categories as ResourcePack['categories'] : [], license: String(row.license), version: String(row.version), status: row.status as ResourcePack['status'], ...(typeof row.cover_path === 'string' ? { coverPath: row.cover_path } : {}), elementCount: typeof row.element_count === 'number' ? row.element_count : 0 }
}

export function toResourceElement(row: Record<string, unknown>): ResourceElement {
  return {
    id: String(row.id), packId: String(row.pack_id), name: String(row.name), path: String(row.path),
    category: String(row.category) as ResourceElement['category'], kind: String(row.kind),
    ...(row.preview && typeof row.preview === 'object' ? { preview: row.preview as ResourceElement['preview'] } : {}),
    specs: row.specs && typeof row.specs === 'object' ? row.specs as ResourceElement['specs'] : {},
    dependencies: Array.isArray(row.dependencies) ? row.dependencies.map(String) : [],
    status: row.status as ResourceElement['status'],
    ...(typeof row.style_override === 'string' ? { styleOverride: row.style_override } : {}),
    ...(typeof row.dimension_override === 'string' ? { dimensionOverride: row.dimension_override as ResourceElement['dimensionOverride'] } : {}),
  }
}

function isSafeStoragePath(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && path.slice(prefix.length).split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

export function sanitizeStorageBasename(name: string): string {
  const basename = name.split(/[\\/]/).at(-1) ?? ''
  return safeStorageComponent(basename, 'Cover filename')
}

function safeStorageComponent(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function isSafeRelativeStoragePath(value: string): boolean {
  try { safeRelativeStoragePath(value, 'Storage path'); return true } catch { return false }
}

function safeRelativeStoragePath(value: string, label: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid`)
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`${label} is invalid`)
  return value
}
