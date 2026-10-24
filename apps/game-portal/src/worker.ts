type AssetBinding = { fetch(request: Request): Promise<Response> }
type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>
export type GamePortalEnv = {
  ASSETS: AssetBinding
  BEEGAME_SUPABASE_URL: string
  BEEGAME_SUPABASE_ANON_KEY?: string
  BEEGAME_SUPABASE_SERVICE_ROLE_KEY?: string
  BEEGAME_DELIVERY_ORIGIN: string
}
type GameRow = {
  project_id: string
  owner_id: string
  deployment_id: string
  title: string
  author_name: string
  game_url: string
  published_at: string
  updated_at: string
  public_description?: string
  public_cover_url?: string | null
}
const ID = /^[A-Za-z0-9_-]{1,128}$/
const GAME_PATH = /^\/g\/([A-Za-z0-9_-]{1,128})\/?$/
const DEPLOYMENT_PATH =
  /^\/deployments\/([A-Za-z0-9_-]{1,128})\/files\/index\.html$/
const SELECT =
  'project_id,owner_id,deployment_id,title,author_name,game_url,published_at,updated_at,public_cover_url'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
export function isTrustedGameUrl(
  value: string,
  deliveryOrigin: string,
): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      url.origin === new URL(deliveryOrigin).origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      DEPLOYMENT_PATH.test(url.pathname)
    )
  } catch {
    return false
  }
}
async function queryRows(
  env: GamePortalEnv,
  params: URLSearchParams,
  fetchImpl: FetchImplementation,
): Promise<GameRow[]> {
  const key =
    env.BEEGAME_SUPABASE_ANON_KEY || env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
  if (!key || !env.BEEGAME_SUPABASE_URL || !env.BEEGAME_DELIVERY_ORIGIN)
    throw Error('Unavailable')
  const url = new URL('/rest/v1/beegame_portal_games', env.BEEGAME_SUPABASE_URL)
  url.search = params.toString()
  const response = await fetchImpl(url, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw Error('Unavailable')
  return (await response.json()) as GameRow[]
}
function isPublicGame(row: GameRow, env: GamePortalEnv) {
  return ID.test(row.project_id) && Boolean(row.title?.trim()) &&
    isTrustedGameUrl(row.game_url, env.BEEGAME_DELIVERY_ORIGIN)
}
async function rows(env: GamePortalEnv, params: URLSearchParams, fetchImpl: FetchImplementation) {
  return (await queryRows(env, params, fetchImpl)).filter(row => isPublicGame(row, env))
}

function publicCover(value: string | null | undefined, gameUrl: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value), game = new URL(gameUrl)
    if (url.origin === game.origin && !url.username && !url.password && !url.search && !url.hash &&
        /^\/deployments\/[A-Za-z0-9_-]{1,128}\/files\/__bgs_publication\/cover\.webp$/.test(url.pathname)) return url.href
  } catch { /* Invalid metadata must not become a public image URL. */ }
  return undefined
}
const metadata = (row: GameRow) => ({
  projectId: row.project_id,
  authorId: row.owner_id,
  authorName: row.author_name,
  title: row.title,
  gameUrl: row.game_url,
  publishedAt: row.published_at,
  updatedAt: row.updated_at,
  ...(typeof row.public_description === 'string' ? { description: row.public_description } : {}),
  ...(publicCover(row.public_cover_url, row.game_url) ? { coverUrl: publicCover(row.public_cover_url, row.game_url) } : {}),
})
export async function fetchGameMetadata(
  projectId: string,
  env: GamePortalEnv,
  fetchImpl: FetchImplementation = fetch,
): Promise<Response> {
  if (!ID.test(projectId)) return json({ error: 'not_found' }, 404)
  try {
    const games = await rows(
      env,
      new URLSearchParams({
        select: SELECT + ',public_description',
        project_id: `eq.${projectId}`,
        limit: '1',
      }),
      fetchImpl,
    )
    return games[0]
      ? json(metadata(games[0]))
      : json({ error: 'not_found' }, 404)
  } catch {
    return json({ error: 'unavailable' }, 503)
  }
}
export async function fetchDeploymentMetadata(
  deploymentId: string,
  env: GamePortalEnv,
  fetchImpl: FetchImplementation = fetch,
): Promise<Response> {
  // Historical links are public only for versions explicitly published to Portal.
  if (!ID.test(deploymentId)) return json({ error: 'not_found' }, 404)
  try {
    const key = env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
    if (!key) return json({ error: 'unavailable' }, 503)
    const url = new URL(
      '/rest/v1/beegame_deployments',
      env.BEEGAME_SUPABASE_URL,
    )
    url.search = new URLSearchParams({
      id: `eq.${deploymentId}`,
      status: 'eq.succeeded',
      portal_published_at: 'not.is.null',
      select: 'project_id,url,portal_published_at,public_description,public_cover_url',
      limit: '1',
    }).toString()
    const response = await fetchImpl(url, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw Error('Unavailable')
    const deployment = (
      (await response.json()) as Array<{
        project_id: string
        url: string
        portal_published_at: string
        public_description?: string
        public_cover_url?: string | null
      }>
    )[0]
    if (
      !deployment ||
      !isTrustedGameUrl(deployment.url, env.BEEGAME_DELIVERY_ORIGIN)
    )
      return json({ error: 'not_found' }, 404)
    const current = await fetchGameMetadata(
      deployment.project_id,
      env,
      fetchImpl,
    )
    if (!current.ok) return current
    return json({
      ...((await current.json()) as object),
      gameUrl: deployment.url,
      updatedAt: deployment.portal_published_at,
      description: deployment.public_description ?? '',
      coverUrl: publicCover(deployment.public_cover_url, deployment.url) ?? '',
    })
  } catch {
    return json({ error: 'unavailable' }, 503)
  }
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  )
// Public Markdown becomes a concise plain-text excerpt; all output contexts
// still escape it independently. No private source document is consulted.
function excerpt(value = '') {
  return value.replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ').replace(/^[ \t]*[>#*-]+[ \t]*/gm, '')
    .replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
}
function isoDate(value?: string) {
  const date = new Date(value || '')
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
async function sitemap(request: Request, env: GamePortalEnv, fetchImpl: FetchImplementation) {
  try {
    const entries = [`<url><loc>${escape(new URL('/', request.url).href)}</loc></url>`]
    // Page through the public projection: catalogue's 24-item page is not a sitemap.
    for (let offset = 0; ; offset += 500) {
      const page = await queryRows(env, new URLSearchParams({ select: SELECT,
        order: 'project_id.asc', limit: '500', offset: String(offset) }), fetchImpl)
      for (const game of page.filter(row => isPublicGame(row, env))) {
        if (entries.length >= 50_000) throw Error('Sitemap requires splitting')
        const modified = isoDate(game.updated_at)
        entries.push(`<url><loc>${escape(new URL(`/g/${game.project_id}`, request.url).href)}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ''}</url>`)
      }
      if (page.length < 500) break
    }
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`, {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' },
    })
  } catch { return json({ error: 'unavailable' }, 503) }
}
async function shell(
  request: Request,
  env: GamePortalEnv,
  game?: Record<string, string>,
  status = 200,
) {
  const asset = await env.ASSETS.fetch(
    new Request(new URL('/index.html', request.url)),
  )
  const title = game ? `${game.title} · Bee Play` : 'Bee Play · 玩点不一样'
  const description = game
    ? excerpt(game.description) || `在 Bee Play 游玩 ${game.title}，由 ${game.authorName} 创作。`
    : '发现创作者发布的游戏，打开即玩，分享快乐。'
  const canonical = new URL(game ? `/g/${game.projectId}` : '/', request.url)
    .href
  const structured = game ? {
    '@context': 'https://schema.org', '@type': 'VideoGame', '@id': canonical + '#game',
    name: game.title, description, url: canonical, gamePlatform: 'Web browser',
    applicationCategory: 'GameApplication',
    ...(game.authorName ? { creator: { '@type': 'Thing', name: game.authorName } } : {}),
    ...(game.coverUrl ? { image: game.coverUrl } : {}),
    ...(isoDate(game.publishedAt) ? { datePublished: isoDate(game.publishedAt) } : {}),
    ...(isoDate(game.updatedAt) ? { dateModified: isoDate(game.updatedAt) } : {}),
  } : { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Bee Play', url: canonical, description }
  const tags = [
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Bee Play">',
    `<meta property="og:url" content="${escape(canonical)}">`,
    `<meta name="twitter:card" content="${game?.coverUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escape(title)}">`,
    `<meta name="twitter:description" content="${escape(description)}">`,
    ...(game?.coverUrl ? [
      `<meta property="og:image" content="${escape(game.coverUrl)}">`,
      `<meta property="og:image:alt" content="${escape(game.title)}">`,
      '<meta property="og:image:type" content="image/webp">',
      `<meta name="twitter:image" content="${escape(game.coverUrl)}">`,
      `<meta name="twitter:image:alt" content="${escape(game.title)}">`,
    ] : []),
    ...(status === 200 ? [
      `<link rel="canonical" href="${escape(canonical)}">`,
      // Escaping '<' prevents creator text from terminating the script element.
      `<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script>`,
    ] : ['<meta name="robots" content="noindex">']),
  ]
  let html = (await asset.text()).replace('<title>游戏 · Bee Play</title>', tags.join('\n'))
  if (game) html = html.replace('</body>', `<noscript><h1>${escape(game.title)}</h1><p>${escape(description)}</p><p>启用 JavaScript 即可游玩。</p></noscript></body>`)
  return new Response(request.method === 'HEAD' ? null : html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  })
}
export async function handleGamePortalRequest(
  request: Request,
  env: GamePortalEnv,
  fetchImpl: FetchImplementation = fetch,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname
  if (!['GET', 'HEAD'].includes(request.method))
    return json({ error: 'method_not_allowed' }, 405)
  if (path === '/sitemap.xml') return sitemap(request, env, fetchImpl)
  if (path === '/robots.txt') return new Response(
    `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${new URL('/sitemap.xml', request.url).href}\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } },
  )
  if (path === '/api/config')
    return json({
      supabaseUrl: env.BEEGAME_SUPABASE_URL,
      supabaseAnonKey: env.BEEGAME_SUPABASE_ANON_KEY || '',
    })
  if (path === '/api/games') {
    const author = url.searchParams.get('author'),
      rawPage = url.searchParams.get('page') || '0'
    if ((author && !ID.test(author)) || !/^\d{1,5}$/.test(rawPage))
      return json({ error: 'bad_request' }, 400)
    const params = new URLSearchParams({
      select: SELECT,
      order: 'updated_at.desc,project_id.asc',
      limit: '24',
      offset: String(Number(rawPage) * 24),
    })
    if (author) params.set('owner_id', `eq.${author}`)
    try {
      return json({ games: (await rows(env, params, fetchImpl)).map(metadata) })
    } catch {
      return json({ error: 'unavailable' }, 503)
    }
  }
  const gameApi = /^\/api\/games\/([^/]+)\/?$/.exec(path)
  if (gameApi) return fetchGameMetadata(gameApi[1], env, fetchImpl)
  const deploymentApi = /^\/api\/deployments\/([^/]+)\/?$/.exec(path)
  if (deploymentApi)
    return fetchDeploymentMetadata(deploymentApi[1], env, fetchImpl)
  const game = GAME_PATH.exec(path),
    deployment = DEPLOYMENT_PATH.exec(path)
  if (game || deployment) {
    const response = game
      ? await fetchGameMetadata(game[1], env, fetchImpl)
      : await fetchDeploymentMetadata(deployment![1], env, fetchImpl)
    return shell(
      request,
      env,
      response.ok
        ? ((await response.json()) as Record<string, string>)
        : undefined,
      response.status,
    )
  }
  if (path === '/') return shell(request, env)
  if (
    path.startsWith('/api/') ||
    path.startsWith('/deployments/') ||
    path.startsWith('/g/')
  )
    return json({ error: 'not_found' }, 404)
  return env.ASSETS.fetch(request)
}
export default {
  async fetch(request: Request, env: GamePortalEnv): Promise<Response> {
    const response = await handleGamePortalRequest(request, env)
    return request.method === 'HEAD' ? new Response(null, response) : response
  },
}
