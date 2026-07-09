import type { Hono } from 'hono'
import {
  BeeGameSkillValidationError,
  type BeeGameSkillsRepository,
  type BeeGameSkillsUserContext,
} from './types'
import { parseSkillZipPackage } from './store'

export type BeeGameSkillsRouteDeps = {
  repository: BeeGameSkillsRepository
  getCurrentUser: (request: Request) => BeeGameSkillsUserContext
  hasPermission: (user: BeeGameSkillsUserContext, permission: 'skills.manage') => boolean
  serviceToken?: string
}

export function registerBeeGameSkillsRoutes(
  app: Hono,
  deps: BeeGameSkillsRouteDeps,
): void {
  app.get('/api/user-skills', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    const forbidden = requireSkillsPermission(user, deps)
    if (forbidden) return c.json(forbidden, 403)
    return c.json((await deps.repository.listUserSkills(user.id)).map(toUserSkillResponse))
  })

  app.post('/api/user-skills/import', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    const forbidden = requireSkillsPermission(user, deps)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const body = await c.req.parseBody()
      const file = body.skill
      if (!(file instanceof File)) {
        return c.json({ error: 'Validation failed', message: 'Skill zip file is required' }, 400)
      }
      if (!file.name.toLowerCase().endsWith('.zip')) {
        return c.json({ error: 'Validation failed', message: 'Skill import requires a .zip file' }, 400)
      }
      const files = parseSkillZipPackage(await file.arrayBuffer())
      const saved = await deps.repository.importUserSkill(user.id, {
        enabled: true,
        files,
      })
      return c.json(toUserSkillResponse(saved))
    } catch (err) {
      if (err instanceof BeeGameSkillValidationError) {
        return c.json({ error: 'Validation failed', message: err.message }, 400)
      }
      throw err
    }
  })

  app.put('/api/user-skills/:id/enabled', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    const forbidden = requireSkillsPermission(user, deps)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
      const saved = await deps.repository.updateUserSkillEnabled(
        user.id,
        c.req.param('id'),
        body.enabled === true,
      )
      return c.json(toUserSkillResponse(saved))
    } catch (err) {
      if (err instanceof BeeGameSkillValidationError) {
        return c.json({ error: 'Validation failed', message: err.message }, 400)
      }
      throw err
    }
  })

  app.delete('/api/user-skills/:id', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    const forbidden = requireSkillsPermission(user, deps)
    if (forbidden) return c.json(forbidden, 403)
    const deleted = await deps.repository.deleteUserSkill(user.id, c.req.param('id'))
    return c.json({ deleted })
  })

  app.get('/api/internal/user-skills/enabled', async c => {
    const forbidden = requireServiceToken(c.req.raw, deps.serviceToken)
    if (forbidden) return c.json(forbidden, 401)
    const userId = c.req.query('userId')?.trim()
    if (!userId) {
      return c.json({ error: 'Validation failed', message: 'userId is required' }, 400)
    }
    return c.json((await deps.repository.listEnabledUserSkills(userId)).map(toUserSkillResponse))
  })
}

function requireSkillsPermission(
  user: BeeGameSkillsUserContext,
  deps: BeeGameSkillsRouteDeps,
): { error: string; message: string } | null {
  return deps.hasPermission(user, 'skills.manage')
    ? null
    : { error: 'Forbidden', message: 'missing permission: skills.manage' }
}

function requireServiceToken(
  request: Request,
  expectedToken: string | undefined,
): { error: string; message: string } | null {
  if (!expectedToken) return null
  const authorization = request.headers.get('authorization')?.trim() ?? ''
  return authorization === `Bearer ${expectedToken}`
    ? null
    : { error: 'Unauthorized', message: 'invalid service token' }
}

function toUserSkillResponse(skill: {
  id: string
  slug: string
  name: string
  description: string
  enabled: boolean
  files: { path: string; content: string }[]
  createdAt: string
  updatedAt: string
}) {
  const skillFile = skill.files.find(file => file.path === 'SKILL.md')
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    content: skillFile?.content ?? '',
    references: skill.files
      .filter(file => file.path !== 'SKILL.md')
      .map(file => ({ path: file.path, content: file.content })),
    files: skill.files,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }
}
