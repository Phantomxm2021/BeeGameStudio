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

type PackRow = Omit<ResourcePack, 'gameTypes' | 'coverPath'> & {
  game_types: string[]
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
    if (!response.ok) throw new Error(`Resource repository request failed (${response.status})`)
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
    if (!response.ok) throw new Error(`Resource repository mutation failed (${response.status})`)
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
      const rows = await mutate<PackRow>('beegame_resource_packs', { method: 'POST', body: JSON.stringify({ id: pack.id, name: pack.name, style: pack.style, game_types: pack.gameTypes, dimension: pack.dimension, categories: pack.categories, license: pack.license, version: pack.version, status: 'draft', cover_path: pack.coverPath ?? null, element_count: 0 }) })
      return await toPack(rows[0])
    },
    async listFolders(packId) {
      return (await request<FolderRow>('beegame_resource_folders', { pack_id: `eq.${packId}`, order: 'path.asc' })).map(toFolder)
    },
    async createFolder(packId, input) {
      const parent = input.parentId ? (await request<FolderRow>('beegame_resource_folders', { id: `eq.${input.parentId}`, pack_id: `eq.${packId}` }))[0] : undefined
      if (input.parentId && !parent) throw new Error('Parent folder not found')
      const path = parent ? `${parent.path}/${input.name}` : input.name
      const rows = await mutate<FolderRow>('beegame_resource_folders', { method: 'POST', body: JSON.stringify({ id: input.id, pack_id: packId, name: input.name, parent_id: input.parentId ?? null, path }) })
      return toFolder(rows[0])
    },
    async publishPack(packId) {
      const incomplete = await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}`, status: 'in.(queued,uploading,failed)' })
      if (incomplete.length > 0) throw new Error('Pack has incomplete uploads')
      const rows = await mutate<PackRow>('beegame_resource_packs', { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, { id: `eq.${packId}` })
      return await toPack(rows[0])
    },
  }
}

export type { ResourceCategory }
