import type { Context, Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  BeeGameSkillDuplicateError,
  BeeGameSkillValidationError,
  type BeeGameSkillsRepository,
  type BeeGameSkillsUserContext,
} from './types'
import { parseSkillZipPackage } from './store'
import { MAX_SKILL_REQUEST_BYTES } from './client'
import { readRequestBytes, RequestBodyLimitError } from './request-body'

export type BeeGameSkillsRouteDeps = {
  repository: BeeGameSkillsRepository
  getCurrentUser: (request: Request) => BeeGameSkillsUserContext
  hasPermission: (user: BeeGameSkillsUserContext, permission: typeof SKILLS_ROUTE_PERMISSION.userSkills) => boolean
  serviceToken?: string
}

export const SKILLS_ROUTE_PERMISSION = {
  userSkills: 'skills.manage',
} as const

export function registerBeeGameSkillsRoutes(
  app: Hono,
  deps: BeeGameSkillsRouteDeps,
): void {
  app.get('/api/user-skills', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    const forbidden = requireSkillsPermission(user, deps)
    if (forbidden) return c.json(forbidden, 403)
    try {
      return c.json((await deps.repository.listUserSkills(user.id)).map(toUserSkillResponse))
    } catch (error) {
      return tracedRouteError(c, 'user-skills.list', error)
    }
  })

  app.post('/api/user-skills/import', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    const forbidden = requireSkillsPermission(user, deps)
    if (forbidden) return c.json(forbidden, 403)
    const traceId = randomUUID()
    try {
      const body = await new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        body: new Blob([await readRequestBytes(c.req.raw, MAX_SKILL_REQUEST_BYTES)]),
      }).formData()
      const file = body.get('skill')
      if (!(file instanceof File)) {
        throw new BeeGameSkillValidationError('Skill zip file is required')
      }
      if (!file.name.toLowerCase().endsWith('.zip')) {
        throw new BeeGameSkillValidationError('Skill import requires a .zip file')
      }
      const files = parseSkillZipPackage(await file.arrayBuffer())
      const saved = await deps.repository.importUserSkill(user.id, {
        enabled: true,
        files,
      })
      return c.json(toUserSkillResponse(saved))
    } catch (err) {
      logSkillImportFailure(traceId, err)
      return c.json({ error: 'Skill import failed', traceId }, 400)
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
      return tracedRouteError(c, 'user-skills.enable', err)
    }
  })

  app.delete('/api/user-skills/:id', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    const forbidden = requireSkillsPermission(user, deps)
    if (forbidden) return c.json(forbidden, 403)
    try {
      const deleted = await deps.repository.deleteUserSkill(user.id, c.req.param('id'))
      return c.json({ deleted })
    } catch (error) {
      return tracedRouteError(c, 'user-skills.delete', error)
    }
  })

  app.get('/api/internal/user-skills/enabled', async c => {
    const forbidden = requireServiceToken(c.req.raw, deps.serviceToken)
    if (forbidden) return c.json(forbidden, 401)
    const userId = c.req.query('userId')?.trim()
    if (!userId) {
      return c.json({ error: 'Validation failed', message: 'userId is required' }, 400)
    }
    try {
      return c.json((await deps.repository.listEnabledUserSkills(userId)).map(toUserSkillResponse))
    } catch (error) {
      return tracedRouteError(c, 'internal.user-skills.enabled.list', error)
    }
  })
}

function logSkillImportFailure(traceId: string, error: unknown): void {
  const reason = error instanceof RequestBodyLimitError
    ? 'request_too_large'
    : error instanceof BeeGameSkillDuplicateError
      ? 'duplicate_skill'
      : error instanceof BeeGameSkillValidationError
        ? 'validation_failed'
        : 'unexpected_error'
  console.warn('[BeeGameSkills] skill import failed', { traceId, reason })
}

function requireSkillsPermission(
  user: BeeGameSkillsUserContext,
  deps: BeeGameSkillsRouteDeps,
): { error: string; message: string } | null {
  return deps.hasPermission(user, SKILLS_ROUTE_PERMISSION.userSkills)
    ? null
    : { error: 'Forbidden', message: `missing permission: ${SKILLS_ROUTE_PERMISSION.userSkills}` }
}

function requireServiceToken(
  request: Request,
  expectedToken: string | undefined,
): { error: string; message: string } | null {
  if (!expectedToken) return { error: 'Unauthorized', message: 'invalid service token' }
  const authorization = request.headers.get('authorization')?.trim() ?? ''
  return authorization === `Bearer ${expectedToken}`
    ? null
    : { error: 'Unauthorized', message: 'invalid service token' }
}

function tracedRouteError(c: Context, route: string, error: unknown): Response {
  const traceId = randomUUID()
  console.warn('[BeeGameSkills] route failed', {
    traceId,
    route,
    cause: error instanceof Error ? error.name : 'unknown_error',
  })
  return c.json({ error: 'Request failed', traceId }, 500)
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
