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

export class ResourceLibraryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ResourceLibraryApiError'
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
    async updatePack(packId: string, body: Partial<ResourcePackSummary>): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Resource update failed (${response.status})`, response.status, result.error?.code || 'resource_update_failed')
      return result.pack
    },
    async importPack(file: File): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/import`, { method: 'POST', body: (() => { const form = new FormData(); form.set('file', file); return form })() })
      const body = await response.json().catch(() => undefined) as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } } | undefined
      if (!response.ok || !body?.pack) throw new ResourceLibraryApiError(body?.error?.message || `Resource import failed (${response.status})`, response.status, body?.error?.code || 'resource_import_failed')
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
  }
}

export const resourceLibraryApi = createResourceLibraryApi()
