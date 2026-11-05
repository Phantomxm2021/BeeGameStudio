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
      playCount: 0,
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
  test('returns editor-authored banner copy as plain public metadata, with no title fallback', async () => {
    const withCaption = await (await fetchGameMetadata('project_1', env, mockFetch({ featured_caption: '<b>Play</b>\nNow' }))).json();
    expect(withCaption.featuredCaption).toBe('<b>Play</b>\nNow');
    const empty = await (await fetchGameMetadata('project_1', env, mockFetch({ featured_caption: '' }))).json();
    expect(empty.featuredCaption).toBe('');
  });
  test('renders escaped per-game share metadata and canonical stable URL on the server', async () => {
    const response = await handleGamePortalRequest(
      new Request('https://play.test/g/project_1?tracking=1'),
      env,
      mockFetch({ title: '<script>bad</script>"' }),
    )
    const html = await response.text()
    expect(html).toContain(
      '<title>&lt;script&gt;bad&lt;/script&gt;&quot; · Bee Play · Bee Game Studio（BGS）</title>',
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
    expect(await home.text()).toContain('Bee Play · 在线玩创作者游戏 | Bee Game Studio（BGS）')
  })
  test('public auth configuration never includes the service role key', async () => {
    const response = await handleGamePortalRequest(
      new Request('https://play.test/api/config'),
      env,
    )
    expect(await response.json()).toEqual({
      supabaseUrl: env.BEEGAME_SUPABASE_URL,
      supabaseAnonKey: 'public-key',
      bgsSsoEnabled: false,
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


describe('Portal SEO', () => {
  test('home owns the brand card while each game keeps its own title, introduction, cover and creator', async () => {
    const home = await (await handleGamePortalRequest(new Request('https://play.test/'), env)).text()
    expect(home).toContain('property="og:image" content="https://play.test/share-card.png"')
    expect(home).toContain('property="og:image:type" content="image/png"')
    const homeData = JSON.parse(home.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!)
    expect(homeData).toMatchObject({ '@type': 'WebSite', name: 'Bee Play', publisher: { name: 'Bee Game Studio', alternateName: 'BGS' } })
    for (const name of ['Harbor', 'Forest']) {
      const cover = `https://games.example.test/deployments/${name}/files/__bgs_publication/cover.webp`
      const html = await (await handleGamePortalRequest(new Request(`https://play.test/g/${name}`), env,
        mockFetch({ project_id: name, public_description: `# ${name}\n\n## Controls\nPress E.\n\n## Introduction\nExplore ${name}.`, public_cover_url: cover }))).text()
      expect(html).toContain(`property="og:title" content="${name} · Bee Play · Bee Game Studio（BGS）"`)
      expect(html).toContain(`property="og:description" content="Explore ${name}. 在 Bee Play 即开即玩，由 Bee Game Studio（BGS）提供平台支持。"`)
      expect(html).toContain(`property="og:image" content="${cover}"`)
      expect(html).toContain(`name="twitter:image" content="${cover}"`)
      expect(html).not.toContain('/share-card.png')
      expect(html).not.toContain('content="Press E.')
      const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!)
      expect(data).toMatchObject({ name, creator: { name: 'Creator' }, isPartOf: { name: 'Bee Play', publisher: { name: 'Bee Game Studio' } } })
      expect(data.publisher).toBeUndefined()
    }
  })

  test('plain-text introductions omit a repeated title and section labels from the summary', async () => {
    const html = await (await handleGamePortalRequest(new Request('https://play.test/g/project_1'), env,
      mockFetch({ title: 'River·Escape', public_description: 'River · Escape\n\n游戏简介\n\nCross the river before sunset.\n\n操作\n\nMove with arrows.' }))).text()
    expect(html).toContain('property="og:description" content="Cross the river before sunset. 在 Bee Play 即开即玩，由 Bee Game Studio（BGS）提供平台支持。"')
  })
  test('renders Twitter cards and script-safe VideoGame JSON-LD from public metadata', async () => {
    const title = 'Game </script><script>alert(1)</script>'
    const cover = 'https://games.example.test/deployments/cover/files/__bgs_publication/cover.webp'
    const html = await (await handleGamePortalRequest(new Request('https://play.test/g/project_1?tracking=1'), env,
      mockFetch({ title, public_description: '**Play** with [arrows](https://example.test).', public_cover_url: cover }))).text()
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain(`name="twitter:image" content="${cover}"`)
    expect(html).toContain('name="description" content="Play with arrows. 在 Bee Play 即开即玩，由 Bee Game Studio（BGS）提供平台支持。"')
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!)
    expect(data).toMatchObject({ '@type': 'VideoGame', name: title, url: 'https://play.test/g/project_1', image: cover })
    expect(html).not.toContain('<script>alert(1)</script>')
    const noCover = await (await handleGamePortalRequest(new Request('https://play.test/g/project_1'), env, mockFetch())).text()
    expect(noCover).toContain('name="twitter:card" content="summary"')
    expect(noCover).not.toContain('name="twitter:image"')
    const missing = await (await handleGamePortalRequest(new Request('https://play.test/g/missing'), env, async () => Response.json([]))).text()
    expect(missing).toContain('name="robots" content="noindex"')
    expect(missing).not.toContain('application/ld+json')
  })
  test('sitemap reads every public page, excludes invalid URLs, and includes actual modification dates', async () => {
    const offsets: string[] = []
    const response = await handleGamePortalRequest(new Request('https://play.test/sitemap.xml'), env, async (input, init) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/rest/v1/beegame_portal_games')
      expect(init?.headers).toMatchObject({ apikey: 'public-key' })
      offsets.push(url.searchParams.get('offset')!)
      return Response.json(offsets.length === 1 ? Array.from({ length: 500 }, (_, i) => ({ ...row, project_id: `p_${i}` }))
        : [{ ...row, project_id: 'last_game' }, { ...row, project_id: 'private', game_url: 'https://evil.test/' }])
    })
    const xml = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')
    expect(offsets).toEqual(['0', '500'])
    expect(xml).toContain('<loc>https://play.test/g/last_game</loc>')
    expect(xml).toContain('<lastmod>2026-10-23T00:00:00.000Z</lastmod>')
    expect(xml).not.toContain('/g/private')
    expect(xml).not.toContain('/deployments/')
    const failed = await handleGamePortalRequest(new Request('https://play.test/sitemap.xml'), env, async () => new Response('secret', { status: 500 }))
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain('secret')
    const robots = await (await handleGamePortalRequest(new Request('https://play.test/robots.txt'), env)).text()
    expect(robots).toContain('Sitemap: https://play.test/sitemap.xml')
    expect(robots).toContain('Disallow: /api/')
  })
})


describe('reviewed publication names', () => {
  test('uses the public H1 in catalogue, game metadata and initial SEO HTML', async () => {
    const published = mockFetch({ public_description: '# 《Night Harbor》\n\n## Controls\nE: refuel' })
    const game = await (await fetchGameMetadata(row.project_id, env, published)).json()
    expect(game.title).toBe('Night Harbor')
    const catalogue = await (await handleGamePortalRequest(new Request('https://play.test/api/games'), env, published)).json()
    expect(catalogue.games[0].title).toBe('Night Harbor')
    const html = await (await handleGamePortalRequest(new Request('https://play.test/g/project_1'), env, published)).text()
    expect(html).toContain('<title>Night Harbor · Bee Play · Bee Game Studio（BGS）</title>')
    expect(html).toContain('property="og:title" content="Night Harbor · Bee Play · Bee Game Studio（BGS）"')
    expect(html).toContain('"name":"Night Harbor"')
  })
  test('historical names come from that version, and unnamed releases keep the stored project title', async () => {
    for (const [description, title] of [['# Earlier Harbor\n\nIntro', 'Earlier Harbor'], ['## Controls\nE: refuel', row.title]]) {
      const response = await fetchDeploymentMetadata('earlier', env, async (input, init) => {
        if (new URL(String(input)).pathname === '/rest/v1/beegame_deployments') return Response.json([
          { project_id: row.project_id, url: row.game_url, portal_published_at: row.updated_at, public_description: description },
        ])
        return mockFetch({ public_description: '# Current Harbor\n\nIntro' })(input, init)
      })
      expect((await response.json()).title).toBe(title)
    }
  })
})

describe('BeePlay recommendations', () => {
  test('uses the saved recommendation order and includes lifetime plays', async () => {
    const response = await handleGamePortalRequest(new Request('https://portal.test/api/featured'), env, async input => {
      const url = new URL(String(input))
      expect(url.searchParams.get('featured_position')).toBe('not.is.null')
      expect(url.searchParams.get('order')).toBe('featured_position.asc')
      expect(url.searchParams.get('limit')).toBe('5')
      return Response.json([{ ...row, play_count: 42 }])
    })
    const body = await response.json() as { games: { playCount: number }[] }
    expect(body.games[0].playCount).toBe(42)
  })
})


describe('independent BeePlay administration', () => {
  test('serves the separate admin document without indexing, caching or framing', async () => {
    for (const path of ['/admin', '/admin/', '/admin.html']) {
      const response = await handleGamePortalRequest(new Request('https://play.test' + path), {
        ...env, ASSETS: { fetch: async request => {
          expect(new URL(request.url).pathname).toBe('/admin.html')
          return new Response('<main id="beeplay-admin-root"></main>')
        } },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-robots-tag')).toContain('noindex')
      expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
      expect(await response.text()).toContain('beeplay-admin-root')
    }
  })
})


describe('public catalogue search', () => {
  test('searches the public projection across stored names, confirmed copy and creators, with pagination', async () => {
    const query = 'a,b)';
    const response = await handleGamePortalRequest(new Request(`https://play.test/api/games?${new URLSearchParams({ q: query, page: '1' })}`), env, async input => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/rest/v1/beegame_portal_games');
      expect(url.searchParams.get('or')).toBe('(title.ilike."%a,b)%",author_name.ilike."%a,b)%",public_description.ilike."%a,b)%")');
      expect(url.searchParams.get('offset')).toBe('24');
      return Response.json([{ ...row, public_description: '# Public name' }]);
    });
    expect(response.status).toBe(200);
    expect((await response.json() as any).games[0].title).toBe('Public name');
  });
  test('rejects overlong search before querying the database and preserves real search failures', async () => {
    let requests = 0;
    const fetchImpl = async () => { requests++; return new Response('Unavailable', { status: 503 }); };
    const overlong = await handleGamePortalRequest(new Request(`https://play.test/api/games?q=${'a'.repeat(121)}`), env, fetchImpl);
    expect(overlong.status).toBe(400);
    expect(requests).toBe(0);
    const failed = await handleGamePortalRequest(new Request('https://play.test/api/games?q=game'), env, fetchImpl);
    expect(failed.status).toBe(503);
    expect(requests).toBe(1);
  });
});
