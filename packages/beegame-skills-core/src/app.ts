import { Hono, type Context, type Next } from 'hono'
import { cors } from 'hono/cors'
import {
  registerBeeGameSkillsRoutes,
  type BeeGameSkillsRouteDeps,
} from './routes'
import type {
  BeeGameSkillsUserContext,
} from './types'

export type BeeGameSkillsAppOptions = BeeGameSkillsRouteDeps & {
  requireRequestUser?: boolean
  resolveRequestUser: (request: Request) => Promise<BeeGameSkillsUserContext | undefined>
  serviceName?: string
}

export function createBeeGameSkillsApp(options: BeeGameSkillsAppOptions): Hono {
  const app = new Hono()
  app.use('/api/*', cors())
  const requireUser = async (c: Context, next: Next) => {
    if (options.requireRequestUser === false) {
      await next()
      return
    }
    const user = await options.resolveRequestUser(c.req.raw)
    if (!user) {
      return c.json({ error: 'Unauthorized', message: 'authentication required' }, 401)
    }
    await next()
  }
  app.use('/api/user-skills', requireUser)
  app.use('/api/user-skills/*', requireUser)
  app.get('/health', c => c.json({
    status: 'ok',
    service: options.serviceName ?? 'beegame-skills',
  }))
  registerBeeGameSkillsRoutes(app, options)
  return app
}
