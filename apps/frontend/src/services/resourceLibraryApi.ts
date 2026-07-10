import { authenticatedFetch } from './apiClient'

export type ResourcePackSummary = {
  id: string
  name: string
  style: string
  gameTypes?: readonly string[]
  dimension: '2D' | '3D' | 'agnostic'
  categories?: readonly string[]
  license?: string
  version?: string
  status?: string
  coverPath?: string
  elementCount: number
}

export type CreateResourcePackInput = {
  name: string
  style: string
  dimension: '2D' | '3D' | 'agnostic'
  gameTypes: string[]
  categories: string[]
  license?: string
  version?: string
}

export type ResourceElement = {
  id: string
  packId: string
  name: string
  path: string
  category: string
  kind: string
  preview?: { kind: string; path: string }
  specs: Record<string, string | number | boolean>
  dependencies: readonly string[]
  status: string
  styleOverride?: string
  dimensionOverride?: '2D' | '3D' | 'agnostic'
}

export type ResourceFolder = { id: string; packId: string; name: string; parentId?: string; path: string }

export class ResourceLibraryApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message)
    this.name = 'ResourceLibraryApiError'
    this.status = status
    this.code = code
  }
}

type ResourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function createResourceLibraryApi(fetchImpl: ResourceFetch = authenticatedFetch) {
  const baseUrl = String(import.meta.env.VITE_RESOURCE_API_BASE_URL ?? '').replace(/\/+$/, '')
  const request = async <T>(path: string): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`)
    const body = await response.json().catch(() => undefined) as T | { error?: { code?: string; message?: string } } | undefined
    if (!response.ok) {
      const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined
      throw new ResourceLibraryApiError(
        error?.message || `Resource request failed (${response.status})`,
        response.status,
        error?.code || 'resource_request_failed',
      )
    }
    return body as T
  }
  return {
    async createPack(input: CreateResourcePackInput): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Pack creation failed (${response.status})`, response.status, result.error?.code || 'resource_pack_create_failed')
      return result.pack
    },
    async updatePack(packId: string, body: Partial<ResourcePackSummary>): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Resource update failed (${response.status})`, response.status, result.error?.code || 'resource_update_failed')
      return result.pack
    },
    async publishPack(packId: string): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/publish`, { method: 'POST' })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Pack publish failed (${response.status})`, response.status, result.error?.code || 'resource_publish_failed')
      return result.pack
    },
    async addElement(packId: string, file: File, category: string, folderPath?: string): Promise<ResourceElement> {
      const form = new FormData(); form.set('file', file); form.set('category', category); if (folderPath) form.set('folderPath', folderPath)
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/elements`, { method: 'POST', body: form })
      const result = await response.json() as { element?: ResourceElement; error?: { code?: string; message?: string } }
      if (!response.ok || !result.element) throw new ResourceLibraryApiError(result.error?.message || `Element upload failed (${response.status})`, response.status, result.error?.code || 'element_upload_failed')
      return result.element
    },
    async importPack(file: File, onProgress?: (progress: number, phase: 'uploading' | 'processing') => void): Promise<ResourcePackSummary> {
      onProgress?.(8, 'uploading')
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/import`, { method: 'POST', body: (() => { const form = new FormData(); form.set('file', file); return form })() })
      onProgress?.(72, 'processing')
      const body = await response.json().catch(() => undefined) as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } } | undefined
      if (!response.ok || !body?.pack) throw new ResourceLibraryApiError(body?.error?.message || `Resource import failed (${response.status})`, response.status, body?.error?.code || 'resource_import_failed')
      onProgress?.(100, 'processing')
      return body.pack
    },
    async listPacks(): Promise<ResourcePackSummary[]> {
      const result = await request<{ packs: ResourcePackSummary[] }>('/api/resource-packs')
      return result.packs
    },
    async getPack(packId: string): Promise<ResourcePackSummary> {
      const result = await request<{ pack: ResourcePackSummary }>(`/api/resource-packs/${encodeURIComponent(packId)}`)
      return result.pack
    },
    async listFolders(packId: string): Promise<ResourceFolder[]> {
      const result = await request<{ folders: ResourceFolder[] }>(`/api/resource-packs/${encodeURIComponent(packId)}/folders`)
      return result.folders
    },
    async createFolder(packId: string, input: { id?: string; name: string; parentId?: string }): Promise<ResourceFolder> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      const result = await response.json() as { folder?: ResourceFolder; error?: { code?: string; message?: string } }
      if (!response.ok || !result.folder) throw new ResourceLibraryApiError(result.error?.message || `Folder creation failed (${response.status})`, response.status, result.error?.code || 'resource_folder_create_failed')
      return result.folder
    },
    async listElements(packId: string, category?: string): Promise<ResourceElement[]> {
      const query = category ? `?category=${encodeURIComponent(category)}` : ''
      const result = await request<{ elements: ResourceElement[] }>(
        `/api/resource-packs/${encodeURIComponent(packId)}/elements${query}`,
      )
      return result.elements
    },
    async getElement(packId: string, elementId: string): Promise<ResourceElement> {
      const result = await request<{ element: ResourceElement }>(
        `/api/resource-packs/${encodeURIComponent(packId)}/elements/${encodeURIComponent(elementId)}`,
      )
      return result.element
    },
    async updateElement(packId: string, elementId: string, body: Partial<ResourceElement>): Promise<ResourceElement> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/elements/${encodeURIComponent(elementId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as { element?: ResourceElement; error?: { code?: string; message?: string } }
      if (!response.ok || !result.element) throw new ResourceLibraryApiError(result.error?.message || `Element update failed (${response.status})`, response.status, result.error?.code || 'element_update_failed')
      return result.element
    },
  }
}

export const resourceLibraryApi = createResourceLibraryApi()
