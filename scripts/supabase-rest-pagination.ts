export async function fetchAllSupabaseRows<T>(input: {
  baseUrl: string
  path: string
  headers: Record<string, string>
  fetchImpl?: typeof fetch
  pageSize?: number
  signal?: AbortSignal
}): Promise<T[]> {
  const pageSize = input.pageSize ?? 1_000
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000)
    throw new Error('Supabase REST page size must be between 1 and 1000')
  const request = input.fetchImpl ?? fetch
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const response = await request(
      `${input.baseUrl.replace(/\/+$/, '')}/rest/v1/${input.path}`,
      {
        headers: {
          ...input.headers,
          range: `${offset}-${offset + pageSize - 1}`,
        },
        ...(input.signal ? { signal: input.signal } : {}),
      },
    )
    if (!response.ok) {
      throw new Error(
        `Supabase paginated request failed (${response.status}): ${await response.text()}`,
      )
    }
    const page = (await response.json()) as unknown
    if (!Array.isArray(page))
      throw new Error('Supabase paginated request did not return an array')
    rows.push(...(page as T[]))
    if (page.length < pageSize) return rows
  }
}
