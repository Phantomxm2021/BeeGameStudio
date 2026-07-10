export type ResourceSelectionRequirement = { slotId: string; category?: string; dimension?: '2D' | '3D' | 'agnostic'; acceptedFormats?: string[]; styles?: string[]; gameTypes?: string[]; purpose?: string }
export type ResourceSelectionResult = { slotId: string; packId: string; packVersion: string; elementId: string; elementPath: string; sourceUrl: string; score: number; reasons: string[] }

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
  }
}

function parseSelection(value: unknown): ResourceSelectionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resource selection response is invalid')
  const row = value as Record<string, unknown>
  const strings = ['slotId', 'packId', 'packVersion', 'elementId', 'elementPath', 'sourceUrl'] as const
  for (const key of strings) if (typeof row[key] !== 'string' || !row[key].trim()) throw new Error('Resource selection response is invalid')
  if (typeof row.score !== 'number' || !Array.isArray(row.reasons) || row.reasons.some(item => typeof item !== 'string')) throw new Error('Resource selection response is invalid')
  return { slotId: String(row.slotId), packId: String(row.packId), packVersion: String(row.packVersion), elementId: String(row.elementId), elementPath: String(row.elementPath), sourceUrl: String(row.sourceUrl), score: row.score, reasons: row.reasons as string[] }
}
