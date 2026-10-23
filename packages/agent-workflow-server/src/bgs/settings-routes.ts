import type { Hono } from 'hono'
import { loadReasoningCapabilities } from './preferences'
import { saveReasoningPreference } from './preferences-store'

export function registerBgsSettingsRoutes(app: Hono, options: {
  environment(request: Request): Promise<Record<string, string>>
  changed(request: Request): void
  command?: readonly string[]
}) {
  app.get('/api/bgs/settings', async c => {
    c.header('Cache-Control', 'no-store')
    try { return c.json(await loadReasoningCapabilities(await options.environment(c.req.raw), options.command)) }
    catch { return c.json({ error: 'BGS settings are unavailable; check the selected model connection' }, 503) }
  })
  app.put('/api/bgs/settings', async c => {
    c.header('Cache-Control', 'no-store')
    const body = await c.req.json().catch(() => null)
    if (!body || (body.effort !== null && typeof body.effort !== 'string') || typeof body.connectionKey !== 'string')
      return c.json({ error: 'Invalid BGS setting' }, 400)
    try {
      const env = await options.environment(c.req.raw)
      const capabilities = await loadReasoningCapabilities(env, options.command)
      if (body.connectionKey !== capabilities.connectionKey) return c.json({ error: 'The selected connection changed; refresh BGS settings' }, 409)
      if (body.effort !== null && !capabilities.efforts.includes(body.effort))
        return c.json({ error: 'The selected model does not advertise this reasoning effort' }, 400)
      saveReasoningPreference(env, capabilities.connectionKey, body.effort)
      options.changed(c.req.raw)
      return c.json({ ...capabilities, effort: body.effort })
    } catch { return c.json({ error: 'BGS settings could not be saved; check the selected model connection' }, 503) }
  })
}
