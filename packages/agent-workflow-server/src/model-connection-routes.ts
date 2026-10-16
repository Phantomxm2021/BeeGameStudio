import type { Hono } from 'hono'
import type { DashboardRepository } from './dashboard-repository'
import type { BeeGameUserContext } from './auth/user-context'
import { OPENCODE_GO_ID, isOpenCodeGoProvider } from '@bee-game-studio/agent-workflow/opencode-go'
import { connectionStatus, disconnectAccount, disconnectConnection, fetchClaudeSubscriptionUsage, ModelConnectionLogins, PERSONAL_BYOK_ID, PERSONAL_CHATGPT_ID, PERSONAL_CLAUDE_ID, personalModelConfig, saveConnection } from './model-connections'
import type { ModelAuthMethod, ModelProviderKind } from '@bee-game-studio/agent-workflow'

export function registerModelConnectionRoutes(app: Hono, options: {
  repository: DashboardRepository
  getUser(request: Request): BeeGameUserContext
  getRoot(request: Request): string
  changed(ownerId: string): void
  isBusy?(ownerId: string): boolean
  assertPermittedUrl?(url: string): Promise<void>
  registerCleanup?: (cleanup: () => void) => void
}) {
  for (const path of ['/api/model-catalog', '/api/model-connections/*', '/api/model-logins/*', '/api/model-accounts/*', '/api/model-configs', '/api/model-configs/*']) {
    app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  }
  const beforeAccountChange = (owner: string) => {
    // Native CLI owns token refresh. Never replace its credential file while
    // that user's task can still refresh and write the previous account.
    if (options.isBusy?.(owner)) throw new Error('Wait for running tasks before changing subscription accounts')
    options.changed(owner)
  }
  const logins = new ModelConnectionLogins(beforeAccountChange)
  options.registerCleanup?.(() => logins.dispose())
  const catalog = async (request: Request) => {
    const user = options.getUser(request)
    const root = options.getRoot(request)
    const published = (await options.repository.listModelConfigs(request, user)).filter(config => config.published !== false)
    const personal = [PERSONAL_BYOK_ID, PERSONAL_CLAUDE_ID, PERSONAL_CHATGPT_ID, OPENCODE_GO_ID].filter(id => !published.some(config => config.id === id)).map(id => personalModelConfig(root, user.id, id)!)
    return [...published, ...personal]
  }
  app.get('/api/model-catalog', async c => c.json((await catalog(c.req.raw)).map(config => ({
    ...config, apiKeyPreview: '', connection: connectionStatus(options.getRoot(c.req.raw), config),
  }))))
  app.get('/api/model-accounts/claude/usage', async c => {
    try {
      return c.json({ usage: await fetchClaudeSubscriptionUsage(options.getRoot(c.req.raw)) })
    } catch {
      return c.json({ error: 'Claude subscription usage is unavailable' }, 502)
    }
  })
  app.put('/api/model-connections/:id', async c => {
    try {
      const body = await c.req.json()
      const root = options.getRoot(c.req.raw)
      const id = c.req.param('id')
      if (id === OPENCODE_GO_ID && (!isOpenCodeGoProvider(body.provider) || !body.models)) return c.json({ error: 'Choose an OpenCode Go protocol and three models' }, 400)
      const config = id === PERSONAL_BYOK_ID || id === OPENCODE_GO_ID
        ? personalModelConfig(root, options.getUser(c.req.raw).id, id, body.provider as ModelProviderKind)
        : (await catalog(c.req.raw)).find(item => item.id === c.req.param('id'))
      if (!config) return c.json({ error: 'Published model not found' }, 404)
      if (typeof body.method !== 'string' || (body.apiKey !== undefined && typeof body.apiKey !== 'string') || (body.baseUrl !== undefined && typeof body.baseUrl !== 'string') || (body.models !== undefined && (!body.models || typeof body.models !== 'object' || ['fast', 'balanced', 'strong'].some(tier => typeof body.models[tier] !== 'string')))) return c.json({ error: 'Invalid connection' }, 400)
      if (body.method !== 'byok' && (body.baseUrl !== undefined || body.models !== undefined)) return c.json({ error: 'Personal endpoint and models require BYOK' }, 400)
      if (c.req.param('id') === PERSONAL_BYOK_ID && (!['anthropic-compatible', 'openai-compatible', 'gemini', 'grok'].includes(body.provider) || !body.baseUrl || !body.models)) return c.json({ error: 'BYOK requires provider, URL, key and three models' }, 400)
      if (body.method === 'byok' && body.baseUrl) {
        try { await options.assertPermittedUrl?.(body.baseUrl) }
        catch { return c.json({ error: 'Model provider endpoint is blocked by the deployment outbound policy. Check the host allowlist and DNS configuration.' }, 400) }
      }
      const result = saveConnection(root, config, body.method as ModelAuthMethod, body.apiKey, body.preferred === true, { baseUrl: body.baseUrl, models: body.models })
      options.changed(options.getUser(c.req.raw).id)
      return c.json(result)
    } catch { return c.json({ error: 'Connection could not be saved. Check the allowed method, API key or account login.' }, 400) }
  })
  app.delete('/api/model-connections/:id', async c => {
    const config = (await catalog(c.req.raw)).find(item => item.id === c.req.param('id'))
    if (!config) return c.json({ error: 'Published model not found' }, 404)
    disconnectConnection(options.getRoot(c.req.raw), config.id)
    options.changed(options.getUser(c.req.raw).id)
    return c.json({ disconnected: true })
  })
  app.post('/api/model-connections/:id/login', async c => {
    try {
      if (options.isBusy?.(options.getUser(c.req.raw).id)) return c.json({ error: 'Wait for running tasks before changing subscription accounts' }, 409)
      const config = (await catalog(c.req.raw)).find(item => item.id === c.req.param('id'))
      if (!config) return c.json({ error: 'Published model not found' }, 404)
      const body = await c.req.json()
      return c.json(await logins.start(options.getUser(c.req.raw).id, options.getRoot(c.req.raw), config, body.method))
    } catch { return c.json({ error: 'Could not start subscription login. Check model access and provider availability.' }, 400) }
  })
  app.get('/api/model-logins/:id', c => {
    try { return c.json(logins.status(c.req.param('id'), options.getUser(c.req.raw).id)) }
    catch { return c.json({ error: 'Login not found or expired' }, 404) }
  })
  app.post('/api/model-logins/:id', async c => {
    try {
      const body = await c.req.json()
      if (typeof body.code !== 'string') return c.json({ error: 'Paste the complete code#state' }, 400)
      const result = await logins.complete(c.req.param('id'), options.getUser(c.req.raw).id, body.code)
      options.changed(options.getUser(c.req.raw).id)
      return c.json(result)
    } catch { return c.json({ error: 'Login failed or expired. Check the complete code#state, or start again.' }, 400) }
  })
  app.delete('/api/model-logins/:id', c => {
    try { logins.cancel(c.req.param('id'), options.getUser(c.req.raw).id); return c.json({ cancelled: true }) }
    catch { return c.json({ error: 'Login not found or expired' }, 404) }
  })
  app.delete('/api/model-accounts/:provider', c => {
    const provider = c.req.param('provider')
    if (provider !== 'claude' && provider !== 'chatgpt') return c.json({ error: 'Unknown subscription provider' }, 400)
    const owner = options.getUser(c.req.raw).id
    if (options.isBusy?.(owner)) return c.json({ error: 'Wait for running tasks before signing out' }, 409)
    logins.cancelOwner(owner)
    disconnectAccount(options.getRoot(c.req.raw), provider)
    options.changed(owner)
    return c.json({ disconnected: true })
  })
}
