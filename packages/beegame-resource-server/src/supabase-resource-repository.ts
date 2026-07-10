import type {
  PackSummary,
  ResourceCategory,
  ResourceElement,
  ResourcePack,
  ResourceRepository,
} from '@bee-game-studio/beegame-resource-core'

type SupabaseResourceRepositoryOptions = {
  baseUrl: string
  serviceRoleKey: string
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
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

export function createSupabaseResourceRepository(
  options: SupabaseResourceRepositoryOptions,
): ResourceRepository {
  const fetchImpl = options.fetchImpl ?? fetch
  const apiBase = `${options.baseUrl.replace(/\/+$/, '')}/rest/v1`
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
  const toPack = (row: PackRow): PackSummary => ({
    id: row.id,
    name: row.name,
    style: row.style,
    gameTypes: row.game_types,
    dimension: row.dimension,
    categories: row.categories,
    license: row.license,
    version: row.version,
    status: row.status,
    ...(row.cover_path ? { coverPath: row.cover_path } : {}),
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
  return {
    async listPacks() {
      return (await request<PackRow>('beegame_resource_packs', { order: 'name.asc' })).map(toPack)
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
  }
}

export type { ResourceCategory }
