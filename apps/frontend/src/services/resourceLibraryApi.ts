import { resolveAuthTokenAsync } from './apiClient'

export type ResourcePackPrimaryCategory =
  | '2d-art'
  | '3d-assets'
  | 'animation-rig'
  | 'ui-kit'
  | 'vfx'
  | 'audio'
  | 'fonts'
  | 'world-scene'
  | 'mixed'

export type ResourcePackSummary = {
  id: string
  name: string
  style: string
  styles?: readonly string[]
  gameTypes?: readonly string[]
  dimension: '2D' | '3D' | 'agnostic'
  primaryCategory: ResourcePackPrimaryCategory
  categories: readonly string[]
  license?: string
  version?: string
  status?: string
  coverPath?: string
  description?: string
  tags?: readonly string[]
  source?: string
  author?: string
  licenseEvidence?: string
  compatibleEngines?: readonly string[]
  deprecatedAt?: string
  elementDefaults?: { usageTags?: readonly string[] }
  elementCount: number
}

export type CreateResourcePackInput = {
  name: string
  styles: string[]
  dimension: '2D' | '3D' | 'agnostic'
  primaryCategory: ResourcePackPrimaryCategory
  gameTypes: string[]
  categories: string[]
  license?: string
  version?: string
  description?: string
  tags?: string[]
  source?: string
  author?: string
  licenseEvidence?: string
  compatibleEngines?: string[]
  deprecatedAt?: string
  elementDefaults?: { usageTags?: readonly string[] }
}

export type UpdateResourcePackInput = Partial<Pick<
  CreateResourcePackInput,
  'name' | 'styles' | 'dimension' | 'primaryCategory' | 'gameTypes' | 'categories' | 'license' | 'version' | 'description' | 'tags' | 'source' | 'author' | 'licenseEvidence' | 'compatibleEngines' | 'deprecatedAt' | 'elementDefaults'
>>

export type ResourceElement = {
  id: string
  packId: string
  name: string
  path: string
  category: string
  kind: string
  preview?: { kind: string; path: string }
  specs: Record<string, string | number | boolean | null>
  usageTags?: readonly string[]
  usageTagsMode?: 'inherit' | 'override' | 'manual-only'
  usageTagsSource?: 'element' | 'folder' | 'pack' | 'none'
  assetKind?: string | null
  capabilities?: readonly string[]
  contentProfile?: {
    packaging: 'self-contained' | 'external-dependencies' | 'unknown'
    components: readonly { id: string; kind: string; name?: string; roles?: readonly string[]; specs?: Record<string, string | number | boolean>; skeletonSignature?: string }[]
    inspection: { status: 'complete' | 'partial' | 'unavailable'; source: 'server' | 'client' | 'admin'; inspectedAt?: string; inspectorVersion?: string }
  }
  relations?: readonly { kind: string; targetElementId: string; role?: string; required?: boolean }[]
  dependencies: readonly string[]
  dependencyBindings?: readonly { referencePath: string; dependencyElementId: string; kind?: string }[]
  status: string
  styleOverride?: string | null
  dimensionOverride?: '2D' | '3D' | 'agnostic'
}

export type ResourceFolder = { id: string; packId: string; name: string; parentId?: string; path: string; elementDefaults?: { usageTags?: readonly string[] } }

export type ResourcePublishIssue = { code: string; message: string; elementId?: string }
export type ResourcePublishReadiness = { blocking: readonly ResourcePublishIssue[]; warnings: readonly ResourcePublishIssue[]; canPublish: boolean }
export type ResourceProcessingJob = { id: string; packId: string; kind: 'inspect-elements'; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; totalItems: number; completedItems: number; failedItems: number; failures?: readonly { elementId: string; error: string }[]; createdAt: string; updatedAt: string }
export type ResourceElementUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

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

/**
 * The resource service intentionally runs on its own origin in local
 * development. It is nevertheless a configured first-party service, so its
 * requests must carry the logged-in Supabase bearer token. We keep this
 * scoped to this client instead of allowing auth headers on arbitrary URLs.
 */
const authenticatedResourceFetch: ResourceFetch = async (input, init = {}) => {
  const headers = new Headers(init.headers)
  const token = await resolveAuthTokenAsync()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

export function createResourceLibraryApi(fetchImpl: ResourceFetch = authenticatedResourceFetch) {
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
    async updatePack(packId: string, body: UpdateResourcePackInput): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Resource update failed (${response.status})`, response.status, result.error?.code || 'resource_update_failed')
      return result.pack
    },
    async deletePack(packId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}`, { method: 'DELETE' })
      if (response.status === 204) return
      const result = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined
      throw new ResourceLibraryApiError(result?.error?.message || `Pack deletion failed (${response.status})`, response.status, result?.error?.code || 'resource_pack_delete_failed')
    },
    async uploadPackCover(packId: string, file: File): Promise<ResourcePackSummary> {
      const form = new FormData()
      form.set('file', file)
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/cover`, { method: 'POST', body: form })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Pack cover upload failed (${response.status})`, response.status, result.error?.code || 'resource_pack_cover_upload_failed')
      return result.pack
    },
    async publishPack(packId: string): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/publish`, { method: 'POST' })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Pack publish failed (${response.status})`, response.status, result.error?.code || 'resource_publish_failed')
      return result.pack
    },
    async archivePack(packId: string): Promise<ResourcePackSummary> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/archive`, { method: 'POST' })
      const result = await response.json() as { pack?: ResourcePackSummary; error?: { code?: string; message?: string } }
      if (!response.ok || !result.pack) throw new ResourceLibraryApiError(result.error?.message || `Pack archive failed (${response.status})`, response.status, result.error?.code || 'resource_archive_failed')
      return result.pack
    },
    async getPublishReadiness(packId: string): Promise<ResourcePublishReadiness> {
      const result = await request<{ report: ResourcePublishReadiness }>(`/api/resource-packs/${encodeURIComponent(packId)}/publish-readiness`)
      return result.report
    },
    async addElement(packId: string, file: File, category: string, folderPath?: string, options?: ResourceElementUploadOptions): Promise<ResourceElement> {
      const form = new FormData(); form.set('file', file); form.set('category', category); if (folderPath) form.set('folderPath', folderPath)
      const url = `${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/elements`
      if (options && typeof XMLHttpRequest !== 'undefined' && fetchImpl === authenticatedResourceFetch) {
        return uploadElementWithProgress(url, form, options)
      }
      const response = await fetchImpl(url, { method: 'POST', body: form, signal: options?.signal })
      const result = await response.json() as { element?: ResourceElement; error?: { code?: string; message?: string } }
      if (!response.ok || !result.element) throw new ResourceLibraryApiError(result.error?.message || `Element upload failed (${response.status})`, response.status, result.error?.code || 'element_upload_failed')
      return result.element
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
    async createFolder(packId: string, input: { id?: string; name: string; parentId?: string; elementDefaults?: ResourceFolder['elementDefaults'] }): Promise<ResourceFolder> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      const result = await response.json() as { folder?: ResourceFolder; error?: { code?: string; message?: string } }
      if (!response.ok || !result.folder) throw new ResourceLibraryApiError(result.error?.message || `Folder creation failed (${response.status})`, response.status, result.error?.code || 'resource_folder_create_failed')
      return result.folder
    },
    async updateFolder(packId: string, folderId: string, input: { name?: string; elementDefaults?: ResourceFolder['elementDefaults'] }): Promise<ResourceFolder> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/folders/${encodeURIComponent(folderId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      const result = await response.json() as { folder?: ResourceFolder; error?: { code?: string; message?: string } }
      if (!response.ok || !result.folder) throw new ResourceLibraryApiError(result.error?.message || `Folder update failed (${response.status})`, response.status, result.error?.code || 'resource_folder_update_failed')
      return result.folder
    },
    async deleteFolder(packId: string, folderId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' })
      if (response.status === 204) return
      const result = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined
      throw new ResourceLibraryApiError(result?.error?.message || `Folder deletion failed (${response.status})`, response.status, result?.error?.code || 'resource_folder_delete_failed')
    },
    async listElements(packId: string, category?: string, folderPath?: string): Promise<ResourceElement[]> {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      if (folderPath) params.set('folderPath', folderPath)
      const query = params.toString() ? `?${params.toString()}` : ''
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
    async getElementResourceUrl(packId: string, elementId: string): Promise<string> {
      const result = await request<{ url: string }>(
        `/api/resource-packs/${encodeURIComponent(packId)}/elements/${encodeURIComponent(elementId)}/resource-url`,
      )
      return result.url
    },
    async updateElement(packId: string, elementId: string, body: Partial<ResourceElement>): Promise<ResourceElement> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/elements/${encodeURIComponent(elementId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as { element?: ResourceElement; error?: { code?: string; message?: string } }
      if (!response.ok || !result.element) throw new ResourceLibraryApiError(result.error?.message || `Element update failed (${response.status})`, response.status, result.error?.code || 'element_update_failed')
      return result.element
    },
    async inspectElement(packId: string, elementId: string): Promise<ResourceElement> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/elements/${encodeURIComponent(elementId)}/inspection`, { method: 'POST' })
      const result = await response.json() as { element?: ResourceElement; error?: { code?: string; message?: string } }
      if (!response.ok || !result.element) throw new ResourceLibraryApiError(result.error?.message || `Element inspection failed (${response.status})`, response.status, result.error?.code || 'element_inspection_failed')
      return result.element
    },
    async startProcessingJob(packId: string, elementIds?: string[]): Promise<ResourceProcessingJob> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/processing-jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(elementIds?.length ? { elementIds } : {}) }) })
      const result = await response.json() as { job?: ResourceProcessingJob; error?: { code?: string; message?: string } }
      if (!response.ok || !result.job) throw new ResourceLibraryApiError(result.error?.message || `Resource processing failed (${response.status})`, response.status, result.error?.code || 'resource_processing_failed')
      return result.job
    },
    async getLatestProcessingJob(packId: string): Promise<ResourceProcessingJob | undefined> {
      const result = await request<{ job: ResourceProcessingJob | null }>(`/api/resource-packs/${encodeURIComponent(packId)}/processing-jobs`)
      return result.job ?? undefined
    },
    async getProcessingJob(packId: string, jobId: string): Promise<ResourceProcessingJob> {
      const result = await request<{ job: ResourceProcessingJob }>(`/api/resource-packs/${encodeURIComponent(packId)}/processing-jobs/${encodeURIComponent(jobId)}`)
      return result.job
    },
    async retryProcessingJob(packId: string, jobId: string): Promise<ResourceProcessingJob> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/processing-jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' })
      const result = await response.json() as { job?: ResourceProcessingJob; error?: { code?: string; message?: string } }
      if (!response.ok || !result.job) throw new ResourceLibraryApiError(result.error?.message || `Resource processing retry failed (${response.status})`, response.status, result.error?.code || 'resource_processing_retry_failed')
      return result.job
    },
    async cancelProcessingJob(packId: string, jobId: string): Promise<ResourceProcessingJob> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/processing-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
      const result = await response.json() as { job?: ResourceProcessingJob; error?: { code?: string; message?: string } }
      if (!response.ok || !result.job) throw new ResourceLibraryApiError(result.error?.message || `Resource processing cancellation failed (${response.status})`, response.status, result.error?.code || 'resource_processing_cancel_failed')
      return result.job
    },
    async deleteElement(packId: string, elementId: string): Promise<void> {
      const response = await fetchImpl(`${baseUrl}/api/resource-packs/${encodeURIComponent(packId)}/elements/${encodeURIComponent(elementId)}`, { method: 'DELETE' })
      if (response.status === 204) return
      const result = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined
      throw new ResourceLibraryApiError(result?.error?.message || `Element deletion failed (${response.status})`, response.status, result?.error?.code || 'element_delete_failed')
    },
  }
}

async function uploadElementWithProgress(
  url: string,
  form: FormData,
  options: ResourceElementUploadOptions,
): Promise<ResourceElement> {
  const token = await resolveAuthTokenAsync()
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    request.open('POST', url)
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`)
    request.responseType = 'json'
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total)
    }
    request.onerror = () => reject(new ResourceLibraryApiError('Element upload failed', 0, 'element_upload_network_failed'))
    request.onabort = () => reject(new DOMException('Element upload was cancelled', 'AbortError'))
    request.onload = () => {
      const result = request.response && typeof request.response === 'object'
        ? request.response as { element?: ResourceElement; error?: { code?: string; message?: string } }
        : parseUploadResponse(request.responseText)
      if (request.status >= 200 && request.status < 300 && result.element) {
        resolve(result.element)
      } else {
        reject(new ResourceLibraryApiError(result.error?.message || `Element upload failed (${request.status})`, request.status, result.error?.code || 'element_upload_failed'))
      }
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    request.send(form)
  })
}

function parseUploadResponse(value: string): { element?: ResourceElement; error?: { code?: string; message?: string } } {
  try {
    return JSON.parse(value) as { element?: ResourceElement; error?: { code?: string; message?: string } }
  } catch {
    return {}
  }
}

export const resourceLibraryApi = createResourceLibraryApi()
