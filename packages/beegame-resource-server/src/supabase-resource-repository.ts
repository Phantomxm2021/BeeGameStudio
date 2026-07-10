import type {
  PackSummary,
  ResourceCategory,
  ResourceElement,
  ResourceFolder,
  ResourcePack,
  ResourceRepository,
} from '@bee-game-studio/beegame-resource-core'

type SupabaseResourceRepositoryOptions = {
  baseUrl: string
  serviceRoleKey: string
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  storageBucket?: string
}

type PackRow = Omit<ResourcePack, 'gameTypes' | 'primaryCategory' | 'coverPath'> & {
  game_types: string[]
  primary_category: ResourcePack['primaryCategory']
  cover_path?: string | null
  element_count?: number
}

type ElementRow = Omit<ResourceElement, 'packId' | 'preview' | 'styleOverride' | 'dimensionOverride'> & {
  pack_id: string
  preview?: ResourceElement['preview'] | null
  style_override?: string | null
  dimension_override?: ResourceElement['dimensionOverride'] | null
}

type FolderRow = { id: string; pack_id: string; name: string; parent_id?: string | null; path: string }

class SupabaseResourceRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function createSupabaseResourceRepository(
  options: SupabaseResourceRepositoryOptions,
): ResourceRepository {
  const fetchImpl = options.fetchImpl ?? fetch
  const apiBase = `${options.baseUrl.replace(/\/+$/, '')}/rest/v1`
  const storageBucket = options.storageBucket ?? 'beegame-resource-packs'
  const request = async <T>(table: string, params: Record<string, string> = {}): Promise<T[]> => {
    const url = new URL(`${apiBase}/${table}`)
    url.searchParams.set('select', '*')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetchImpl(new Request(url, {
      headers: {
        apikey: options.serviceRoleKey,
        authorization: `Bearer ${options.serviceRoleKey}`,
        accept: 'application/json',
      },
    }))
    if (!response.ok) throw new SupabaseResourceRequestError(response.status, `Resource repository request failed (${response.status}): ${await supabaseErrorDetail(response)}`)
    return await response.json() as T[]
  }
  const mutate = async <T>(table: string, init: RequestInit, params: Record<string, string> = {}): Promise<T[]> => {
    const url = new URL(`${apiBase}/${table}`)
    url.searchParams.set('select', '*')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        apikey: options.serviceRoleKey,
        authorization: `Bearer ${options.serviceRoleKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
        prefer: 'return=representation',
        ...(init.headers || {}),
      },
    })
    if (!response.ok) throw new SupabaseResourceRequestError(response.status, `Resource repository mutation failed (${response.status}): ${await supabaseErrorDetail(response)}`)
    return await response.json() as T[]
  }
  const signPath = async (path: string): Promise<string> => {
    const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, '')}/storage/v1/object/sign/${storageBucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    })
    if (!response.ok) throw new Error('Failed to sign resource preview URL')
    const body = await response.json() as { signedURL?: string }
    return body.signedURL || ''
  }
  const toPack = async (row: PackRow): Promise<PackSummary> => ({
    id: row.id,
    name: row.name,
    style: row.style,
    gameTypes: row.game_types,
    dimension: row.dimension,
    primaryCategory: row.primary_category,
    categories: row.categories,
    license: row.license,
    version: row.version,
    status: row.status,
    ...(row.cover_path ? { coverPath: await signPath(`${row.id}/${row.cover_path}`) } : {}),
    elementCount: row.element_count ?? 0,
  })
  const toElement = (row: ElementRow): ResourceElement => ({
    id: row.id,
    packId: row.pack_id,
    name: row.name,
    path: row.path,
    category: row.category,
    kind: row.kind,
    ...(row.preview ? { preview: row.preview } : {}),
    specs: row.specs,
    dependencies: row.dependencies,
    status: row.status,
    ...(row.style_override ? { styleOverride: row.style_override } : {}),
    ...(row.dimension_override ? { dimensionOverride: row.dimension_override } : {}),
  })
  const toFolder = (row: FolderRow): ResourceFolder => ({
    id: row.id,
    packId: row.pack_id,
    name: row.name,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    path: row.path,
  })
  return {
    async listPacks() {
      return await Promise.all((await request<PackRow>('beegame_resource_packs', { order: 'name.asc' })).map(toPack))
    },
    async getPack(packId) {
      const rows = await request<PackRow>('beegame_resource_packs', { id: `eq.${packId}` })
      return rows[0] ? toPack(rows[0]) : undefined
    },
    async listElements(packId, category) {
      const params: Record<string, string> = { pack_id: `eq.${packId}`, order: 'path.asc' }
      if (category) params.category = `eq.${category}`
      return (await request<ElementRow>('beegame_resource_elements', params)).map(toElement)
    },
    async getElement(packId, elementId) {
      const rows = await request<ElementRow>('beegame_resource_elements', {
        pack_id: `eq.${packId}`,
        id: `eq.${elementId}`,
      })
      return rows[0] ? toElement(rows[0]) : undefined
    },
    async createPack(pack) {
      const rows = await mutate<PackRow>('beegame_resource_packs', { method: 'POST', body: JSON.stringify({ id: pack.id, name: pack.name, style: pack.style, game_types: pack.gameTypes, dimension: pack.dimension, primary_category: pack.primaryCategory, categories: pack.categories, license: pack.license, version: pack.version, status: 'draft', cover_path: pack.coverPath ?? null, element_count: 0 }) })
      return await toPack(rows[0])
    },
    async listFolders(packId) {
      try {
        return (await request<FolderRow>('beegame_resource_folders', { pack_id: `eq.${packId}`, order: 'path.asc' })).map(toFolder)
      } catch (error) {
        if (error instanceof SupabaseResourceRequestError && error.status === 404) return []
        throw error
      }
    },
    async createFolder(packId, input) {
      const parent = input.parentId ? (await request<FolderRow>('beegame_resource_folders', { id: `eq.${input.parentId}`, pack_id: `eq.${packId}` }))[0] : undefined
      if (input.parentId && !parent) throw new Error('Parent folder not found')
      const path = parent ? `${parent.path}/${input.name}` : input.name
      const rows = await mutate<FolderRow>('beegame_resource_folders', { method: 'POST', body: JSON.stringify({ id: input.id, pack_id: packId, name: input.name, parent_id: input.parentId ?? null, path }) })
      return toFolder(rows[0])
    },
    async updateFolder(packId, folderId, input) {
      const folder = (await request<FolderRow>('beegame_resource_folders', { id: `eq.${folderId}`, pack_id: `eq.${packId}` }))[0]
      if (!folder) return undefined
      const name = input.name.trim()
      if (!name || name.includes('/') || name.includes('\\')) throw new Error('Folder name is invalid')
      const parent = folder.parent_id ? (await request<FolderRow>('beegame_resource_folders', { id: `eq.${folder.parent_id}`, pack_id: `eq.${packId}` }))[0] : undefined
      const oldPath = folder.path
      const path = parent ? `${parent.path}/${name}` : name
      const existing = await request<FolderRow>('beegame_resource_folders', { pack_id: `eq.${packId}`, path: `eq.${path}` })
      if (existing.some(item => item.id !== folderId)) throw new Error('Folder path already exists')
      const allFolders = await request<FolderRow>('beegame_resource_folders', { pack_id: `eq.${packId}` })
      const allElements = await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}` })
      const replacePath = (value: string) => value === oldPath ? path : value.startsWith(`${oldPath}/`) ? `${path}${value.slice(oldPath.length)}` : value
      for (const item of allFolders.filter(item => item.path === oldPath || item.path.startsWith(`${oldPath}/`))) {
        await mutate<FolderRow>('beegame_resource_folders', { method: 'PATCH', body: JSON.stringify({ ...(item.id === folderId ? { name } : {}), path: replacePath(item.path) }) }, { id: `eq.${item.id}`, pack_id: `eq.${packId}` })
      }
      for (const item of allElements.filter(item => item.path === oldPath || item.path.startsWith(`${oldPath}/`))) {
        await mutate<ElementRow>('beegame_resource_elements', { method: 'PATCH', body: JSON.stringify({ path: replacePath(item.path) }) }, { id: `eq.${item.id}`, pack_id: `eq.${packId}` })
      }
      return { ...toFolder(folder), name, path }
    },
    async deleteFolder(packId, folderId) {
      const folder = (await request<FolderRow>('beegame_resource_folders', { id: `eq.${folderId}`, pack_id: `eq.${packId}` }))[0]
      if (!folder) return false
      const children = await request<FolderRow>('beegame_resource_folders', { pack_id: `eq.${packId}`, parent_id: `eq.${folderId}` })
      const elements = await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}` })
      if (children.length > 0 || elements.some(item => item.path === folder.path || item.path.startsWith(`${folder.path}/`))) throw new Error('Folder is not empty')
      await mutate<FolderRow>('beegame_resource_folders', { method: 'DELETE' }, { id: `eq.${folderId}`, pack_id: `eq.${packId}` })
      return true
    },
    async updateElement(packId, elementId, input) {
      const rows = await mutate<ElementRow>('beegame_resource_elements', { method: 'PATCH', body: JSON.stringify({ name: input.name, path: input.path, category: input.category, kind: input.kind, preview: input.preview, specs: input.specs, dependencies: input.dependencies, status: input.status, style_override: input.styleOverride, dimension_override: input.dimensionOverride }) }, { id: `eq.${elementId}`, pack_id: `eq.${packId}` })
      return rows[0] ? toElement(rows[0]) : undefined
    },
    async deleteElement(packId, elementId) {
      const rows = await mutate<ElementRow>('beegame_resource_elements', { method: 'DELETE' }, { id: `eq.${elementId}`, pack_id: `eq.${packId}` })
      return rows.length > 0
    },
    async publishPack(packId) {
      const incomplete = await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}`, status: 'in.(queued,uploading,failed)' })
      if (incomplete.length > 0) throw new Error('Pack has incomplete uploads')
      const rows = await mutate<PackRow>('beegame_resource_packs', { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, { id: `eq.${packId}` })
      return await toPack(rows[0])
    },
    async deletePack(packId) {
      const rows = await mutate<PackRow>('beegame_resource_packs', { method: 'DELETE' }, { id: `eq.${packId}` })
      return rows.length > 0
    },
  }
}

async function supabaseErrorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => undefined)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response.statusText || 'Unknown Supabase error'
  const error = body as Record<string, unknown>
  const code = typeof error.code === 'string' ? error.code.trim() : ''
  const message = typeof error.message === 'string' ? error.message.trim() : ''
  const details = typeof error.details === 'string' ? error.details.trim() : ''
  const hint = typeof error.hint === 'string' ? error.hint.trim() : ''
  return [code && `[${code}]`, message, details, hint].filter(Boolean).join(' ')
}

export type { ResourceCategory }
