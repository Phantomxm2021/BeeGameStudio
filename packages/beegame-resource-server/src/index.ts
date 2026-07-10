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
    ...(baseUrl && serviceRoleKey ? createSupabaseResourceAuthoringHandlers({ baseUrl, serviceRoleKey }) : {}),
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
  })
  const server = Bun.serve({ hostname: host, port, fetch: app.fetch })
  console.log(`BeeGame resource server listening on http://${host}:${server.port}`)
}

type SupabaseAuthoringOptions = { baseUrl: string; serviceRoleKey: string; fetchImpl?: FetchImplementation; storageBucket?: string }

/** Keeps storage object keys and database paths in lock-step for explorer edits. */
export function createSupabaseResourceAuthoringHandlers(options: SupabaseAuthoringOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const storageBucket = options.storageBucket ?? 'beegame-resource-packs'
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}` }
  const rest = `${baseUrl}/rest/v1`
  const storagePath = (packId: string, relativePath: string) => `${safeStorageComponent(packId, 'Pack id')}/${safeRelativeStoragePath(relativePath, 'Resource path')}`
  const getRows = async <T>(table: string, query: string): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${table}?${query}`, { headers })
    if (!response.ok) throw new Error(`Resource metadata lookup failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const patchRows = async <T>(table: string, query: string, body: Record<string, unknown>): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${table}?${query}`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Resource metadata update failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const deleteRows = async <T>(table: string, query: string): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${table}?${query}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=representation' } })
    if (!response.ok) throw new Error(`Resource metadata deletion failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const moveObject = async (source: string, destination: string) => {
    if (source === destination) return
    const response = await fetchImpl(`${baseUrl}/storage/v1/object/move`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ bucketId: storageBucket, sourceKey: source, destinationKey: destination }) })
    if (!response.ok) throw new Error(`Resource storage move failed (${response.status})`)
  }
  const deleteObject = async (path: string) => {
    const response = await fetchImpl(`${baseUrl}/storage/v1/object/${storageBucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers })
    if (!response.ok) throw new Error(`Resource storage deletion failed (${response.status})`)
  }
  type ElementRow = Record<string, unknown> & { id: string; pack_id: string; name: string; path: string }
  type FolderRow = { id: string; pack_id: string; name: string; parent_id?: string | null; path: string }
  const updateElement = async (packId: string, elementId: string, body: Record<string, unknown>) => {
    const current = (await getRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=*`))[0]
    if (!current) return undefined
    const row = toElementRow(body)
    const oldPath = safeRelativeStoragePath(current.path, 'Resource element path')
    const nextPath = Object.hasOwn(row, 'path') ? safeRelativeStoragePath(String(row.path), 'Resource element path') : oldPath
    let moved = false
    if (nextPath !== oldPath) { await moveObject(storagePath(packId, oldPath), storagePath(packId, nextPath)); moved = true }
    try {
      const saved = (await patchRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}`, row))[0]
      if (!saved) throw new ResourceLifecycleNotFoundError('Resource element not found')
      return toResourceElement(saved)
    } catch (error) {
      if (moved) await moveObject(storagePath(packId, nextPath), storagePath(packId, oldPath)).catch(() => undefined)
      throw error
    }
  }
  return {
    updateResourceElement: updateElement,
    deleteResourceElement: async (packId: string, elementId: string) => {
      const current = (await getRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}&select=*`))[0]
      if (!current) return false
      await deleteObject(storagePath(packId, current.path))
      return (await deleteRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(elementId)}&pack_id=eq.${encodeURIComponent(packId)}`)).length > 0
    },
    updateResourceFolder: async (packId: string, folderId: string, body: Record<string, unknown>) => {
      const folders = await getRows<FolderRow>('beegame_resource_folders', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)
      const folder = folders.find((item) => item.id === folderId)
      if (!folder) return undefined
      const name = String(body.name || '').trim()
      if (!name || name.includes('/') || name.includes('\\')) throw new Error('Folder name is invalid')
      const parent = folder.parent_id ? folders.find((item) => item.id === folder.parent_id) : undefined
      const nextPath = parent ? `${parent.path}/${name}` : name
      if (folders.some((item) => item.id !== folderId && item.path === nextPath)) throw new Error('Folder path already exists')
      const oldPath = folder.path
      const replacePath = (value: string) => value === oldPath ? nextPath : value.startsWith(`${oldPath}/`) ? `${nextPath}${value.slice(oldPath.length)}` : value
      const elements = (await getRows<ElementRow>('beegame_resource_elements', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)).filter((item) => item.path === oldPath || item.path.startsWith(`${oldPath}/`))
      const moves = elements.map((item) => ({ from: item.path, to: replacePath(item.path) }))
      try {
        for (const move of moves) await moveObject(storagePath(packId, move.from), storagePath(packId, move.to))
        for (const item of folders.filter((candidate) => candidate.path === oldPath || candidate.path.startsWith(`${oldPath}/`))) await patchRows<FolderRow>('beegame_resource_folders', `id=eq.${encodeURIComponent(item.id)}&pack_id=eq.${encodeURIComponent(packId)}`, { ...(item.id === folderId ? { name } : {}), path: replacePath(item.path) })
        for (const item of elements) await patchRows<ElementRow>('beegame_resource_elements', `id=eq.${encodeURIComponent(item.id)}&pack_id=eq.${encodeURIComponent(packId)}`, { path: replacePath(item.path) })
      } catch (error) {
        for (const move of [...moves].reverse()) await moveObject(storagePath(packId, move.to), storagePath(packId, move.from)).catch(() => undefined)
        throw error
      }
      return { id: folder.id, packId, name, ...(folder.parent_id ? { parentId: folder.parent_id } : {}), path: nextPath }
    },
    deleteResourceFolder: async (packId: string, folderId: string) => {
      const folders = await getRows<FolderRow>('beegame_resource_folders', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)
      const folder = folders.find((item) => item.id === folderId)
      if (!folder) return false
      const elements = await getRows<ElementRow>('beegame_resource_elements', `pack_id=eq.${encodeURIComponent(packId)}&select=*`)
      if (folders.some((item) => item.parent_id === folderId) || elements.some((item) => item.path === folder.path || item.path.startsWith(`${folder.path}/`))) throw new Error('Folder is not empty')
      return (await deleteRows<FolderRow>('beegame_resource_folders', `id=eq.${encodeURIComponent(folderId)}&pack_id=eq.${encodeURIComponent(packId)}`)).length > 0
    },
  }
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
    name: 'name', path: 'path', category: 'category', kind: 'kind', preview: 'preview', specs: 'specs',
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
    if (!response.ok) throw new Error(`Resource storage deletion failed (${response.status}) for ${path}${await safeStorageFailureDetail(response)}`)
  }
  const signObject = async (path: string): Promise<string> => {
    const response = await fetchImpl(`${baseUrl}/storage/v1/object/sign/${storageBucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) })
    if (!response.ok) throw new Error(`Resource URL signing failed (${response.status})`)
    const signedURL = (await response.json() as { signedURL?: string }).signedURL
    if (!signedURL) throw new Error('Resource URL signing returned no URL')
    return normalizeSupabaseSignedObjectUrl(baseUrl, signedURL)
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
      const visitedPrefixes = new Set<string>()
      const clearPrefix = async (currentPrefix: string): Promise<void> => {
        if (visitedPrefixes.has(currentPrefix)) return
        visitedPrefixes.add(currentPrefix)
        for (;;) {
          const listed = await fetchImpl(`${baseUrl}/storage/v1/object/list/${storageBucket}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: currentPrefix, limit: pageSize, offset: 0 }) })
          if (!listed.ok) throw new Error(`Resource storage listing failed (${listed.status}) for ${currentPrefix}${await safeStorageFailureDetail(listed)}`)
          const entries = await listed.json() as Array<{ name?: unknown; id?: unknown; metadata?: unknown }>
          const folders: string[] = []
          let removedObject = false
          for (const entry of entries) {
            if (typeof entry.name !== 'string' || !entry.name) continue
            const path = storageListEntryPath(currentPrefix, entry.name)
            if (!isSafeStoragePath(path, prefix)) throw new Error('Resource storage contains an unsafe resource storage entry')
            if (entry.id != null || entry.metadata != null) {
              await deleteObject(path)
              removedObject = true
            } else {
              folders.push(`${path.replace(/\/+$/, '')}/`)
            }
          }
          let visitedFolder = false
          for (const folderPrefix of [...new Set(folders)]) {
            if (!visitedPrefixes.has(folderPrefix)) {
              visitedFolder = true
              await clearPrefix(folderPrefix)
            }
          }
          // Object deletion shifts the first page; always restart at offset zero.
          // Directory-only pages can legitimately contain virtual empty folders.
          if (!removedObject && !visitedFolder) break
        }
      }
      await clearPrefix(prefix)
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

function normalizeSupabaseSignedObjectUrl(baseUrl: string, signedURL: string): string {
  try {
    new URL(signedURL)
    return signedURL
  } catch {
    // Supabase Storage may return either an absolute URL or a storage-relative path.
  }

  if (!signedURL.startsWith('/') || signedURL.startsWith('//')) {
    throw new Error('Resource URL signing returned an unexpected relative URL')
  }

  const relative = new URL(signedURL, 'https://relative-url.invalid')
  const suffix = `${relative.pathname}${relative.search}${relative.hash}`
  if (relative.pathname.startsWith('/object/')) return `${baseUrl}/storage/v1${suffix}`
  if (relative.pathname.startsWith('/storage/v1/')) return `${baseUrl}${suffix}`
  throw new Error('Resource URL signing returned an unexpected relative URL')
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

function storageListEntryPath(prefix: string, name: string): string {
  const trimmedName = name.endsWith('/') ? name.slice(0, -1) : name
  return trimmedName.startsWith(prefix) ? trimmedName : `${prefix}${trimmedName}`
}

async function safeStorageFailureDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  if (!body) return ''
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const detail = [parsed.code, parsed.message, parsed.error].find(value => typeof value === 'string')
    if (typeof detail !== 'string') return ''
    const normalized = detail.trim().slice(0, 240)
    return normalized && [...normalized].every(character => character >= ' ' && character !== '\u007f') ? `: ${normalized}` : ''
  } catch {
    return ''
  }
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
