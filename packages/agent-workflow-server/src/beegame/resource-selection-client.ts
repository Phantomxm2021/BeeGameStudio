export type ResourceSelectionRequirement = { slotId: string; category?: string; dimension?: '2D' | '3D' | 'agnostic'; acceptedFormats?: string[]; styles?: string[]; gameTypes?: string[]; tags?: string[]; purpose?: string }
export type ResourceSelectionDependencyResult = { key: string; parentKey: string; elementId: string; elementPath: string; referencePath: string; sourceUrl: string; kind?: string }
export type ResourceSelectionResult = { slotId: string; packId: string; packVersion: string; elementId: string; elementPath: string; sourceUrl: string; score: number; reasons: string[]; dependencies?: ResourceSelectionDependencyResult[] }
export type ResourceBindingRefreshInput = { packId: string; packVersion: string; elementId: string; dependencies?: Array<{ key: string; elementId: string }> }
export type ResourceBindingRefreshResult = { sourceUrl: string; dependencies: Array<{ key: string; sourceUrl: string }> }

export function createResourceSelectionClient(options: { baseUrl: string; serviceToken: string; fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }) {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  return {
    async select(requirements: ResourceSelectionRequirement[]): Promise<ResourceSelectionResult[]> {
      const response = await fetchImpl(`${baseUrl}/api/resource-selections`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-beegame-resource-service-token': options.serviceToken }, body: JSON.stringify({ requirements }) })
      const body = await response.json().catch(() => undefined) as { selections?: unknown; error?: { message?: string } } | undefined
      if (!response.ok || !Array.isArray(body?.selections)) throw new Error(body?.error?.message || `Resource selection failed (${response.status})`)
      return body.selections.map(parseSelection)
    },
    async candidates(requirement: ResourceSelectionRequirement): Promise<ResourceSelectionResult[]> {
      const response = await fetchImpl(`${baseUrl}/api/resource-candidates`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-beegame-resource-service-token': options.serviceToken }, body: JSON.stringify({ requirements: [requirement] }) })
      const body = await response.json().catch(() => undefined) as { candidates?: unknown; error?: { message?: string } } | undefined
      if (!response.ok || !Array.isArray(body?.candidates)) throw new Error(body?.error?.message || `Resource candidates failed (${response.status})`)
      return body.candidates.map(parseSelection)
    },
    async refreshBinding(binding: ResourceBindingRefreshInput): Promise<ResourceBindingRefreshResult> {
      const response = await fetchImpl(`${baseUrl}/api/resource-bindings/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-beegame-resource-service-token': options.serviceToken }, body: JSON.stringify(binding) })
      const body = await response.json().catch(() => undefined) as { sourceUrl?: unknown; dependencies?: unknown; error?: { message?: string } } | undefined
      if (!response.ok || typeof body?.sourceUrl !== 'string' || !Array.isArray(body.dependencies)) throw new Error(body?.error?.message || `Resource binding refresh failed (${response.status})`)
      const dependencies = body.dependencies.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resource binding refresh response is invalid')
        const row = value as Record<string, unknown>
        if (typeof row.key !== 'string' || typeof row.sourceUrl !== 'string') throw new Error('Resource binding refresh response is invalid')
        return { key: row.key, sourceUrl: row.sourceUrl }
      })
      return { sourceUrl: body.sourceUrl, dependencies }
    },
  }
}

function parseSelection(value: unknown): ResourceSelectionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resource selection response is invalid')
  const row = value as Record<string, unknown>
  const strings = ['slotId', 'packId', 'packVersion', 'elementId', 'elementPath', 'sourceUrl'] as const
  for (const key of strings) if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error('Resource selection response is invalid')
  if (typeof row.score !== 'number' || !Array.isArray(row.reasons) || row.reasons.some(item => typeof item !== 'string')) throw new Error('Resource selection response is invalid')
  const dependencies = Array.isArray(row.dependencies) ? row.dependencies.map(parseDependency) : []
  return { slotId: String(row.slotId), packId: String(row.packId), packVersion: String(row.packVersion), elementId: String(row.elementId), elementPath: String(row.elementPath), sourceUrl: String(row.sourceUrl), score: row.score, reasons: row.reasons as string[], dependencies }
}

function parseDependency(value: unknown): ResourceSelectionDependencyResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resource selection dependency is invalid')
  const row = value as Record<string, unknown>
  for (const key of ['key', 'parentKey', 'elementId', 'elementPath', 'referencePath', 'sourceUrl'] as const) {
    if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error('Resource selection dependency is invalid')
  }
  return { key: String(row.key), parentKey: String(row.parentKey), elementId: String(row.elementId), elementPath: String(row.elementPath), referencePath: String(row.referencePath), sourceUrl: String(row.sourceUrl), ...(typeof row.kind === 'string' && row.kind.trim() ? { kind: row.kind } : {}) }
}
