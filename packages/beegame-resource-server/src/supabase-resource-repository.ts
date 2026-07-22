import type {
  PackSummary,
  ResourceCategory,
  ResourceElement,
  ResourceFolder,
  ResourceCatalogPack,
  ResourcePack,
  ResourceRepository,
} from '@bee-game-studio/beegame-resource-core'
import { assertResourcePackPublishable, resolveResourceElementMetadata } from '@bee-game-studio/beegame-resource-core'
import { externalReferencesFromInspection, normalizeResourceReference, reconcileResourceDependencySpecs, resolveResourceDependencyBindings } from './resource-dependency-bindings'

type SupabaseResourceRepositoryOptions = {
  baseUrl: string
  serviceRoleKey: string
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  storageBucket?: string
  getStorageObjectUrl?: (storageObjectId: string, packId: string) => Promise<string | undefined>
}

type PackRow = Omit<ResourcePack, 'gameTypes' | 'primaryCategory' | 'coverPath'> & {
  game_types: string[]
  primary_category: ResourcePack['primaryCategory']
  cover_path?: string | null
  cover_storage_object_id?: string | null
  styles?: string[] | null
  element_count?: number
  description?: string | null
  tags?: string[] | null
  source?: string | null
  author?: string | null
  license_evidence?: string | null
  compatible_engines?: string[] | null
  deprecated_at?: string | null
  element_defaults?: ResourcePack['elementDefaults'] | null
}

type ElementRow = Omit<ResourceElement, 'packId' | 'preview' | 'usageTags' | 'usageTagsMode' | 'usageTagsSource' | 'assetKind' | 'capabilities' | 'contentProfile' | 'relations' | 'dependencyBindings' | 'styleOverride' | 'dimensionOverride'> & {
  pack_id: string
  preview?: ResourceElement['preview'] | null
  usage_tags?: string[] | null
  usage_tags_mode?: ResourceElement['usageTagsMode'] | null
  asset_kind?: ResourceElement['assetKind'] | null
  capabilities?: ResourceElement['capabilities'] | null
  content_profile?: ResourceElement['contentProfile'] | null
  relations?: ResourceElement['relations'] | null
  dependency_bindings?: ResourceElement['dependencyBindings'] | null
  style_override?: string | null
  dimension_override?: ResourceElement['dimensionOverride'] | null
}

type FolderRow = { id: string; pack_id: string; name: string; parent_id?: string | null; path: string; element_defaults?: ResourceFolder['elementDefaults'] | null }

type CatalogPackRow = {
  pack_id: string
  pack_version: string
  pack_name: string
  style: string
  styles: string[] | null
  game_types: string[] | null
  dimension: ResourcePack['dimension']
  primary_category: ResourcePack['primaryCategory']
  categories: string[] | null
  tags: string[] | null
  ready_element_count: number
  asset_kinds: string[] | null
  usage_tags: string[] | null
  capabilities: string[] | null
  formats: string[] | null
  description?: string | null
  license: string
  author?: string | null
  source?: string | null
  compatible_engines?: string[] | null
}

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
    return body.signedURL ? normalizeSupabaseSignedObjectUrl(options.baseUrl, body.signedURL) : ''
  }
  const resolveCoverPath = async (row: PackRow): Promise<string | undefined> => {
    if (row.cover_storage_object_id && options.getStorageObjectUrl) {
      const storageObjectUrl = await options.getStorageObjectUrl(row.cover_storage_object_id, row.id)
      if (storageObjectUrl) return storageObjectUrl
    }
    return row.cover_path ? signPath(packCoverStoragePath(row.id, row.cover_path)) : undefined
  }
  const toPack = async (row: PackRow, elementCount = row.element_count ?? 0): Promise<PackSummary> => {
    const coverPath = await resolveCoverPath(row)
    return {
    id: row.id,
    name: row.name,
    style: normalizePackStyles(row.styles, row.style).join(' / '),
    styles: normalizePackStyles(row.styles, row.style),
    gameTypes: row.game_types,
    dimension: row.dimension,
    primaryCategory: row.primary_category,
    categories: row.categories,
    license: row.license,
    version: row.version,
    status: row.status,
    ...(row.description ? { description: row.description } : {}),
    ...(row.tags?.length ? { tags: row.tags } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.author ? { author: row.author } : {}),
    ...(row.license_evidence ? { licenseEvidence: row.license_evidence } : {}),
    ...(row.compatible_engines?.length ? { compatibleEngines: row.compatible_engines } : {}),
    ...(row.deprecated_at ? { deprecatedAt: row.deprecated_at } : {}),
    ...(row.element_defaults ? { elementDefaults: row.element_defaults } : {}),
    ...(coverPath ? { coverPath } : {}),
    elementCount,
    }
  }
  const toElement = (row: ElementRow): ResourceElement => ({
    id: row.id,
    packId: row.pack_id,
    name: row.name,
    path: row.path,
    category: row.category,
    kind: row.kind,
    ...(row.preview ? { preview: row.preview } : {}),
    specs: row.specs,
    ...(row.usage_tags?.length ? { usageTags: row.usage_tags as ResourceElement['usageTags'] } : {}),
    ...(row.usage_tags_mode ? { usageTagsMode: row.usage_tags_mode } : {}),
    ...(row.asset_kind ? { assetKind: row.asset_kind } : {}),
    ...(row.capabilities?.length ? { capabilities: row.capabilities } : {}),
    ...(row.content_profile ? { contentProfile: row.content_profile } : {}),
    ...(row.relations?.length ? { relations: row.relations } : {}),
    dependencies: row.dependencies,
    ...(row.dependency_bindings?.length ? { dependencyBindings: row.dependency_bindings } : {}),
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
    ...(row.element_defaults ? { elementDefaults: row.element_defaults } : {}),
  })
  const deriveLegacyDependencyBindings = (rows: ElementRow[], packRows: ElementRow[]): ElementRow[] => rows.map(row => {
    const references = [...new Set([
      ...externalReferencesFromInspection(row.specs?.externalReferences),
      ...externalReferencesFromInspection(row.specs?.unresolvedTextureReferences),
    ])]
    if (!references.length) return row
    const persistedBindings = (row.dependency_bindings ?? []).flatMap(binding => {
      const referencePath = normalizeResourceReference(binding.referencePath)
      return referencePath ? [{ ...binding, referencePath }] : []
    })
    const persistedReferences = new Set(persistedBindings.map(binding => binding.referencePath))
    const derivedBindings = resolveResourceDependencyBindings(
      row.path,
      references.filter(reference => !persistedReferences.has(reference)),
      packRows.map(candidate => ({ id: candidate.id, path: candidate.path, kind: candidate.kind })),
    )
    const bindings = [...persistedBindings, ...derivedBindings]
    return {
      ...row,
      specs: reconcileResourceDependencySpecs(row.specs, references, bindings),
      dependencies: [...new Set([...row.dependencies, ...bindings.map(binding => binding.dependencyElementId)])],
      ...(bindings.length ? { dependency_bindings: bindings } : {}),
    }
  })
  const resolveRows = async (packId: string, rows: ElementRow[], allElementRows: ElementRow[] = rows): Promise<ResourceElement[]> => {
    const dependencyResolvedRows = deriveLegacyDependencyBindings(rows, allElementRows)
    const [packRows, folderRows] = await Promise.all([
      request<PackRow>('beegame_resource_packs', { id: `eq.${packId}` }),
      request<FolderRow>('beegame_resource_folders', { pack_id: `eq.${packId}` }),
    ])
    const pack = packRows[0]
    if (!pack) return dependencyResolvedRows.map(toElement)
    const mappedPack = await toPack(pack)
    const folders = folderRows.map(toFolder)
    return dependencyResolvedRows.map(row => resolveResourceElementMetadata(mappedPack, folders, toElement(row)))
  }
  return {
    async listPacks() {
      const [packRows, elementRows] = await Promise.all([
        request<PackRow>('beegame_resource_packs', { order: 'name.asc' }),
        request<Pick<ElementRow, 'pack_id'>>('beegame_resource_elements', { select: 'pack_id' }),
      ])
      const counts = new Map<string, number>()
      for (const element of elementRows) counts.set(element.pack_id, (counts.get(element.pack_id) ?? 0) + 1)
      return await Promise.all(packRows.map(row => toPack(row, counts.get(row.id) ?? 0)))
    },
    async listCatalogPacks() {
      const rows = await request<CatalogPackRow>('beegame_resource_pack_catalog', { order: 'pack_name.asc,pack_id.asc' })
      return rows.map((row): ResourceCatalogPack => {
        const styles = normalizePackStyles(row.styles, row.style)
        return {
          packId: row.pack_id,
          packVersion: row.pack_version,
          packName: row.pack_name,
          style: styles.join(' / '),
          styles,
          gameTypes: row.game_types ?? [],
          dimension: row.dimension,
          primaryCategory: row.primary_category,
          categories: (row.categories ?? []) as ResourceCatalogPack['categories'],
          tags: row.tags ?? [],
          readyElementCount: Number(row.ready_element_count || 0),
          assetKinds: (row.asset_kinds ?? []) as ResourceCatalogPack['assetKinds'],
          usageTags: (row.usage_tags ?? []) as ResourceCatalogPack['usageTags'],
          capabilities: (row.capabilities ?? []) as ResourceCatalogPack['capabilities'],
          formats: row.formats ?? [],
          ...(row.description ? { description: row.description } : {}),
          license: row.license,
          ...(row.author ? { author: row.author } : {}),
          ...(row.source ? { source: row.source } : {}),
          compatibleEngines: row.compatible_engines ?? [],
        }
      })
    },
    async getPack(packId) {
      const [rows, elements] = await Promise.all([
        request<PackRow>('beegame_resource_packs', { id: `eq.${packId}` }),
        request<Pick<ElementRow, 'id'>>('beegame_resource_elements', { pack_id: `eq.${packId}`, select: 'id' }),
      ])
      return rows[0] ? toPack(rows[0], elements.length) : undefined
    },
    async listElements(packId, category) {
      const params: Record<string, string> = { pack_id: `eq.${packId}`, order: 'path.asc' }
      if (category) params.category = `eq.${category}`
      const rows = await request<ElementRow>('beegame_resource_elements', params)
      const allRows = category ? await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}`, order: 'path.asc' }) : rows
      return resolveRows(packId, rows, allRows)
    },
    async getElement(packId, elementId) {
      const rows = await request<ElementRow>('beegame_resource_elements', {
        pack_id: `eq.${packId}`,
        id: `eq.${elementId}`,
      })
      if (!rows[0]) return undefined
      const allRows = await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}`, order: 'path.asc' })
      return (await resolveRows(packId, [rows[0]], allRows))[0]
    },
    async createPack(pack, lifecycle) {
      const styles = normalizePackStyles(pack.styles, pack.style)
      const rows = await mutate<PackRow>('beegame_resource_packs', { method: 'POST', body: JSON.stringify({ id: pack.id, name: pack.name, style: styles.join(' / '), styles, game_types: pack.gameTypes, dimension: pack.dimension, primary_category: pack.primaryCategory, categories: pack.categories, license: pack.license, version: pack.version, status: 'draft', cover_path: pack.coverPath ?? null, element_count: 0, description: pack.description ?? null, tags: pack.tags ?? [], source: pack.source ?? null, author: pack.author ?? null, license_evidence: pack.licenseEvidence ?? null, compatible_engines: pack.compatibleEngines ?? [], deprecated_at: pack.deprecatedAt ?? null, element_defaults: pack.elementDefaults ?? {}, ...(lifecycle?.createdBy ? { created_by: lifecycle.createdBy } : {}) }) })
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
      const rows = await mutate<FolderRow>('beegame_resource_folders', { method: 'POST', body: JSON.stringify({ id: input.id, pack_id: packId, name: input.name, parent_id: input.parentId ?? null, path, element_defaults: input.elementDefaults ?? {} }) })
      return toFolder(rows[0])
    },
    async updateFolder(packId, folderId, input) {
      const folder = (await request<FolderRow>('beegame_resource_folders', { id: `eq.${folderId}`, pack_id: `eq.${packId}` }))[0]
      if (!folder) return undefined
      const name = input.name?.trim() ?? folder.name
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
      const updatedDefaults = input.elementDefaults ?? folder.element_defaults ?? undefined
      if (input.elementDefaults !== undefined) await mutate<FolderRow>('beegame_resource_folders', { method: 'PATCH', body: JSON.stringify({ element_defaults: input.elementDefaults }) }, { id: `eq.${folderId}`, pack_id: `eq.${packId}` })
      return { ...toFolder(folder), name, path, ...(updatedDefaults ? { elementDefaults: updatedDefaults } : {}) }
    },
    async deleteFolder(packId, folderId) {
      const folder = (await request<FolderRow>('beegame_resource_folders', { id: `eq.${folderId}`, pack_id: `eq.${packId}` }))[0]
      if (!folder) return false
      const folderPrefix = `${folder.path}/`
      const folders = await request<FolderRow>('beegame_resource_folders', { pack_id: `eq.${packId}` })
      const elements = await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}` })
      for (const element of elements.filter(item => item.path === folder.path || item.path.startsWith(folderPrefix))) {
        await mutate<ElementRow>('beegame_resource_elements', { method: 'DELETE' }, { id: `eq.${element.id}`, pack_id: `eq.${packId}` })
      }
      const descendants = folders.filter(item => item.path === folder.path || item.path.startsWith(folderPrefix)).sort((left, right) => right.path.length - left.path.length)
      for (const descendant of descendants) {
        await mutate<FolderRow>('beegame_resource_folders', { method: 'DELETE' }, { id: `eq.${descendant.id}`, pack_id: `eq.${packId}` })
      }
      return true
    },
    async updateElement(packId, elementId, input) {
      const rows = await mutate<ElementRow>('beegame_resource_elements', { method: 'PATCH', body: JSON.stringify({ name: input.name, path: input.path, category: input.category, kind: input.kind, preview: input.preview, specs: input.specs, usage_tags: input.usageTags, usage_tags_mode: input.usageTagsMode, asset_kind: input.assetKind, capabilities: input.capabilities, content_profile: input.contentProfile, relations: input.relations, dependencies: input.dependencies, dependency_bindings: input.dependencyBindings, status: input.status, style_override: input.styleOverride, dimension_override: input.dimensionOverride }) }, { id: `eq.${elementId}`, pack_id: `eq.${packId}` })
      if (!rows[0]) return undefined
      const allRows = await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}`, order: 'path.asc' })
      return (await resolveRows(packId, [rows[0]], allRows))[0]
    },
    async deleteElement(packId, elementId) {
      const rows = await mutate<ElementRow>('beegame_resource_elements', { method: 'DELETE' }, { id: `eq.${elementId}`, pack_id: `eq.${packId}` })
      return rows.length > 0
    },
    async publishPack(packId) {
      const pack = (await request<PackRow>('beegame_resource_packs', { id: `eq.${packId}` }))[0]
      if (!pack) throw new Error('Resource Pack not found')
      assertResourcePackPublishable({
        id: pack.id, name: pack.name, style: normalizePackStyles(pack.styles, pack.style).join(' / '), styles: normalizePackStyles(pack.styles, pack.style), gameTypes: pack.game_types, dimension: pack.dimension,
        primaryCategory: pack.primary_category, categories: pack.categories, license: pack.license, version: pack.version,
        status: pack.status, ...(pack.cover_path ? { coverPath: pack.cover_path } : {}),
      }, await resolveRows(packId, await request<ElementRow>('beegame_resource_elements', { pack_id: `eq.${packId}` })))
      const rows = await mutate<PackRow>('beegame_resource_packs', { method: 'PATCH', body: JSON.stringify({ status: 'published', deprecated_at: null }) }, { id: `eq.${packId}` })
      return await toPack(rows[0])
    },
    async archivePack(packId) {
      const rows = await mutate<PackRow>('beegame_resource_packs', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived', deprecated_at: new Date().toISOString() }),
      }, { id: `eq.${packId}` })
      if (!rows[0]) throw new Error('Resource Pack not found')
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

function normalizeSupabaseSignedObjectUrl(baseUrl: string, signedURL: string): string {
  try {
    new URL(signedURL)
    return signedURL
  } catch {
    // Storage returns relative URLs for some deployments.
  }
  if (!signedURL.startsWith('/') || signedURL.startsWith('//')) {
    throw new Error('Resource URL signing returned an unexpected relative URL')
  }
  const relative = new URL(signedURL, 'https://relative-url.invalid')
  const suffix = `${relative.pathname}${relative.search}${relative.hash}`
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  if (relative.pathname.startsWith('/object/')) return `${normalizedBase}/storage/v1${suffix}`
  if (relative.pathname.startsWith('/storage/v1/')) return `${normalizedBase}${suffix}`
  throw new Error('Resource URL signing returned an unexpected relative URL')
}

function packCoverStoragePath(packId: string, coverPath: string): string {
  const normalized = coverPath.replace(/^\/+/, '')
  return normalized === packId || normalized.startsWith(`${packId}/`)
    ? normalized
    : `${packId}/${normalized}`
}

function normalizePackStyles(styles: readonly string[] | null | undefined, legacyStyle: string | undefined): string[] {
  const values = styles?.length ? styles : (legacyStyle ?? '').split('/')
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

export type { ResourceCategory }
