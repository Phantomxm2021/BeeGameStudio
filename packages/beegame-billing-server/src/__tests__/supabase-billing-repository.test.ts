import { expect, test } from 'bun:test'
import { createBeeGameSupabaseBillingRepositoryFromEnv } from '../supabase-billing-repository'

const row = {
  id: 'usage-1',
  idempotency_key: 'key-1',
  user_id: 'customer-a',
  session_id: 'session-1',
  turn_id: 'turn-1',
  project_id: 'project-a',
  pricing_version: 'weighted-v1',
  usage_source: 'model_runtime_host',
  prompt_tokens: 10,
  completion_tokens: 5,
  cache_read_tokens: 3,
  cache_creation_tokens: 2,
  total_tokens: 20,
  prompt_tokens_delta: 10,
  completion_tokens_delta: 5,
  cache_read_tokens_delta: 3,
  cache_creation_tokens_delta: 2,
  total_tokens_delta: 20,
  weighted_tokens: 18,
  weighted_tokens_delta: 18,
  credits_micro: 7,
  created_at: '2026-07-30T10:00:00.000Z',
  metadata: {},
}

test('usage reads use bounded REST pages and server-side summary RPC filters', async () => {
  const requests: Array<{ url: string; method: string; prefer?: string; body?: unknown }> = []
  const repository = createBeeGameSupabaseBillingRepositoryFromEnv(
    {
      BEEGAME_SUPABASE_URL: 'https://supabase.fixture.invalid',
      BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
    },
    async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      requests.push({
        url: `${url.pathname}${url.search}`,
        method: request.method,
        prefer: request.headers.get('prefer') ?? undefined,
        body: request.method === 'POST' ? await request.json() : undefined,
      })
      if (url.pathname.endsWith('/beegame_usage_events'))
        return new Response(JSON.stringify([row]), {
          status: 206,
          headers: { 'content-type': 'application/json', 'content-range': '2-2/3' },
        })
      return new Response(JSON.stringify({
        events_count: 3,
        prompt_tokens: 30,
        completion_tokens: 6,
        cache_read_tokens: 2,
        cache_creation_tokens: 1,
        total_tokens: 38,
        weighted_tokens: 40,
        credits_micro: 9,
      }), { headers: { 'content-type': 'application/json' } })
    },
  )
  const page = await repository.listUsageEventsPageForUser(
    'customer-a', 'project-a', new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-08-01T00:00:00.000Z'), 2, 500,
  )
  expect(page.total).toBe(3)
  expect(page.items[0]).toMatchObject({ id: 'usage-1', projectId: 'project-a' })
  expect(requests[0]).toMatchObject({
    method: 'GET',
    prefer: 'count=exact',
  })
  expect(requests[0]?.url).toContain('offset=2&limit=200')
  expect(requests[0]?.url).toContain('project_id=eq.project-a')
  expect(requests[0]?.url).toContain('created_at=gte.2026-07-01T00%3A00%3A00.000Z')
  expect(requests[0]?.url).toContain('created_at=lte.2026-08-01T00%3A00%3A00.000Z')

  await expect(repository.getUsageSummaryForUser(
    'customer-a', 'project-a', new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-08-01T00:00:00.000Z'),
  )).resolves.toEqual({
    eventsCount: 3, promptTokens: 30, completionTokens: 6,
    cacheReadTokens: 2, cacheCreationTokens: 1, totalTokens: 38,
    weightedTokens: 40, creditsMicro: 9,
  })
  expect(requests[1]).toMatchObject({
    method: 'POST',
    url: '/rest/v1/rpc/beegame_usage_summary',
    body: {
      p_user_id: 'customer-a', p_project_id: 'project-a',
      p_from: '2026-07-01T00:00:00.000Z', p_to: '2026-08-01T00:00:00.000Z',
    },
  })
})
