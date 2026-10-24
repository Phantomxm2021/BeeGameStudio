import { describe, expect, test } from 'bun:test'
import worker, {
  fetchDeploymentMetadata,
  fetchGameMetadata,
  isTrustedGameUrl,
  handleGamePortalRequest,
  type GamePortalEnv,
} from './worker'
const env: GamePortalEnv = {
  ASSETS: {
    fetch: async () =>
      new Response(
        '<html><head><title>游戏 · Bee Play</title></head><body>Portal</body></html>',
      ),
  },
  BEEGAME_SUPABASE_URL: 'https://database.example.test',
  BEEGAME_SUPABASE_ANON_KEY: 'public-key',
  BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'private-key',
  BEEGAME_DELIVERY_ORIGIN: 'https://games.example.test',
}
const row = {
  project_id: 'project_1',
  owner_id: 'user_1',
  deployment_id: 'deploy_1',
  title: 'Bomb Rogue',
  author_name: 'Creator',
  game_url: 'https://games.example.test/deployments/deploy_1/files/index.html',
  published_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-10-23T00:00:00Z',
}
const mockFetch =
  (override = {}) =>
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    // Catalogue and game pages never read private project records.
    expect(url.pathname).toBe('/rest/v1/beegame_portal_games')
    expect(init?.headers).toEqual({
      apikey: 'public-key',
      authorization: 'Bearer public-key',
    })
    return Response.json([{ ...row, ...override }])
  }
describe('public Portal projection', () => {
  test('returns only explicit public metadata from the public projection', async () => {
    const response = await fetchGameMetadata('project_1', env, mockFetch())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      projectId: row.project_id,
      authorId: row.owner_id,
      authorName: row.author_name,
      title: row.title,
      gameUrl: row.game_url,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  test('returns confirmed public copy without exposing private source fields', async () => {
    const response = await fetchGameMetadata('project_1', env, mockFetch({ public_description: 'How to play\nMove with arrows.', private_document: 'Private design text' }))
    const result = await response.json()
    expect(result.description).toBe('How to play\nMove with arrows.')
    expect(result.private_document).toBeUndefined()
  })
  test('exposes only delivery-hosted covers in metadata, catalogue and sharing tags', async () => {
    const public_cover_url = 'https://games.example.test/deployments/cover_1/files/__bgs_publication/cover.webp'
    const metadata = await (await fetchGameMetadata('project_1', env, mockFetch({ public_cover_url }))).json()
    expect(metadata.coverUrl).toBe(public_cover_url)
    const catalogue = await (await handleGamePortalRequest(new Request('https://play.test/api/games'), env, mockFetch({ public_cover_url }))).json()
    expect(catalogue.games[0].coverUrl).toBe(public_cover_url)
    const html = await (await handleGamePortalRequest(new Request('https://play.test/g/project_1'), env, mockFetch({ public_cover_url }))).text()
    expect(html).toContain(`<meta property="og:image" content="${public_cover_url}">`)
    for (const value of ['https://evil.test/image.webp', 'data:image/svg+xml,unsafe', public_cover_url + '?token=private']) {
      expect((await (await fetchGameMetadata('project_1', env, mockFetch({ public_cover_url: value }))).json()).coverUrl).toBeUndefined()
    }
  })
  test('does not discover drafts or releases awaiting verification from deployment records', async () => {
    const response = await fetchGameMetadata(
      'private_project',
      env,
      async input => {
        expect(new URL(String(input)).pathname).toBe(
          '/rest/v1/beegame_portal_games',
        )
        return Response.json([])
      },
    )
    expect(response.status).toBe(404)
  })
  test.each([
    'https://evil.test/deployments/deploy_1/files/index.html',
    'https://games.example.test/deployments/deploy_1/files/index.html?secret=1',
    'javascript:alert(1)',
  ])('rejects untrusted game URLs: %s', async game_url => {
    expect(
      (await fetchGameMetadata('project_1', env, mockFetch({ game_url })))
        .status,
    ).toBe(404)
  })
  test('allows configured loopback HTTP delivery while keeping remote HTTP blocked', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const origin = `http://${host}:54100`
      expect(
        isTrustedGameUrl(`${origin}/deployments/demo/files/index.html`, origin),
      ).toBe(true)
    }
    expect(
      isTrustedGameUrl(
        'http://games.example.test/deployments/demo/files/index.html',
        'http://games.example.test',
      ),
    ).toBe(false)
    expect(
      isTrustedGameUrl(
        'http://127.0.0.1:54101/deployments/demo/files/index.html',
        'http://127.0.0.1:54100',
      ),
    ).toBe(false)
  })
  test('rejects malformed IDs before any database request', async () => {
    expect(
      (
        await fetchGameMetadata('project_1?select=*', env, async () => {
          throw Error('No query')
        })
      ).status,
    ).toBe(404)
  })
  test('keeps failures private', async () => {
    const response = await fetchGameMetadata(
      'project_1',
      env,
      async () => new Response('database secret', { status: 500 }),
    )
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('database secret')
  })
  test('lists a bounded page and filters authors by the shared Supabase user ID', async () => {
    const response = await handleGamePortalRequest(
      new Request('https://play.test/api/games?author=user_1&page=2'),
      env,
      async input => {
        const url = new URL(String(input))
        expect(url.pathname).toBe('/rest/v1/beegame_portal_games')
        expect(url.searchParams.get('owner_id')).toBe('eq.user_1')
        expect(url.searchParams.get('limit')).toBe('24')
        expect(url.searchParams.get('offset')).toBe('48')
        return Response.json([row])
      },
    )
    expect(((await response.json()) as any).games[0].authorId).toBe('user_1')
    for (const query of ['author=bad%26id', 'page=-1', 'page=Infinity']) {
      expect(
        (
          await handleGamePortalRequest(
            new Request('https://play.test/api/games?' + query),
            env,
          )
        ).status,
      ).toBe(400)
    }
  })
  test('renders escaped per-game share metadata and canonical stable URL on the server', async () => {
    const response = await handleGamePortalRequest(
      new Request('https://play.test/g/project_1?tracking=1'),
      env,
      mockFetch({ title: '<script>bad</script>"' }),
    )
    const html = await response.text()
    expect(html).toContain(
      '<title>&lt;script&gt;bad&lt;/script&gt;&quot; · Bee Play</title>',
    )
    expect(html).toContain('content="https://play.test/g/project_1"')
    expect(html).not.toContain('<script>bad</script>')
    expect(html).not.toContain('private-key')
  })
  test('returns proper missing-game status and a valid home page', async () => {
    expect(
      (
        await handleGamePortalRequest(
          new Request('https://play.test/g/none'),
          env,
          async () => Response.json([]),
        )
      ).status,
    ).toBe(404)
    const home = await handleGamePortalRequest(
      new Request('https://play.test/'),
      env,
    )
    expect(home.status).toBe(200)
    expect(await home.text()).toContain('Bee Play · 玩点不一样')
  })
  test('public auth configuration never includes the service role key', async () => {
    const response = await handleGamePortalRequest(
      new Request('https://play.test/api/config'),
      env,
    )
    expect(await response.json()).toEqual({
      supabaseUrl: env.BEEGAME_SUPABASE_URL,
      supabaseAnonKey: 'public-key',
    })
    const head = await worker.fetch(
      new Request('https://play.test/', { method: 'HEAD' }),
      env,
    )
    expect(await head.text()).toBe('')
    expect(
      (
        await handleGamePortalRequest(
          new Request('https://play.test/', { method: 'POST' }),
          env,
        )
      ).status,
    ).toBe(405)
  })
  test('historical Portal links accept verified rollback records referencing earlier bytes', async () => {
    const response = await fetchDeploymentMetadata(
      'rollback_2',
      env,
      async (input, init) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/beegame_deployments')) {
          expect(url.searchParams.get('id')).toBe('eq.rollback_2')
          expect(url.searchParams.get('portal_published_at')).toBe(
            'not.is.null',
          )
          expect(init?.headers).toEqual({
            apikey: 'private-key',
            authorization: 'Bearer private-key',
          })
          return Response.json([
            {
              project_id: row.project_id,
              url: row.game_url,
              portal_published_at: row.updated_at,
              public_description: 'Earlier controls',
              public_cover_url: 'https://games.example.test/deployments/earlier/files/__bgs_publication/cover.webp',
            },
          ])
        }
        return mockFetch({ public_description: 'Current controls' })(input, init)
      },
    )
    expect(response.status).toBe(200)
    const historic = await response.json()
    expect(historic.gameUrl).toBe(row.game_url)
    expect(historic.description).toBe('Earlier controls')
    expect(historic.coverUrl).toBe('https://games.example.test/deployments/earlier/files/__bgs_publication/cover.webp')
    expect(
      (
        await handleGamePortalRequest(
          new Request('https://play.test/deployments/id/files/game.js'),
          env,
        )
      ).status,
    ).toBe(404)
  })
})
