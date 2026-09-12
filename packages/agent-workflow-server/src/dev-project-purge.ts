import type { Hono } from 'hono'
import type { BeeGameUserContext } from './auth/user-context'

export const DEV_PROJECT_PURGE_CONFIRMATION = 'DELETE_ALL_MY_PROJECTS'
export const DEV_PROJECT_PURGE_PATH = '/api/dev/projects/purge'

export function isDevProjectPurgeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') &&
    env.BEEGAME_ENABLE_DEV_PROJECT_PURGE === '1'
}

type Project = { id: string; name: string }
type DeleteResult = { deleted: boolean; deletedWorkspacePath?: string }

/** Register after authentication middleware. No caller-supplied owner or paths. */
export function registerDevProjectPurgeRoutes(app: Hono, dependencies: {
  enabled?: () => boolean
  getUser: (request: Request) => BeeGameUserContext
  listProjects: (request: Request, user: BeeGameUserContext) => Promise<Project[]>
  deleteProject: (request: Request, user: BeeGameUserContext, id: string) => Promise<DeleteResult>
}) {
  const enabled = dependencies.enabled ?? isDevProjectPurgeEnabled
  const busyOwners = new Set<string>()
  app.get(DEV_PROJECT_PURGE_PATH, async c => {
    if (!enabled()) return c.json({ code: 'NOT_FOUND' }, 404)
    const user = dependencies.getUser(c.req.raw)
    const projects = await dependencies.listProjects(c.req.raw, user)
    return c.json({ projectCount: projects.length, projects: projects.map(({ id, name }) => ({ id, name })) })
  })
  app.post(DEV_PROJECT_PURGE_PATH, async c => {
    if (!enabled()) return c.json({ code: 'NOT_FOUND' }, 404)
    const user = dependencies.getUser(c.req.raw)
    // A JSON-only body also prevents a cross-site HTML form from submitting
    // the destructive request through cookie authentication.
    if (!c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase().endsWith('/json'))
      return c.json({ code: 'INVALID_PURGE_CONFIRMATION' }, 400)
    const body: unknown = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return c.json({ code: 'INVALID_PURGE_CONFIRMATION' }, 400)
    const record = body as Record<string, unknown>
    const ids = record.projectIds
    if (Object.keys(record).sort().join('|') !== 'confirmation|projectIds' ||
      record.confirmation !== DEV_PROJECT_PURGE_CONFIRMATION || !Array.isArray(ids) ||
      !ids.every(id => typeof id === 'string' && id.length > 0) || new Set(ids).size !== ids.length)
      return c.json({ code: 'INVALID_PURGE_CONFIRMATION' }, 400)
    if (busyOwners.has(user.id)) return c.json({ code: 'PROJECT_PURGE_IN_PROGRESS' }, 409)
    busyOwners.add(user.id)
    try {
      const projects = await dependencies.listProjects(c.req.raw, user)
      const currentIds = projects.map(project => project.id).sort()
      const expectedIds = [...ids].sort()
      if (currentIds.length !== expectedIds.length || currentIds.some((id, index) => id !== expectedIds[index]))
        return c.json({ code: 'PROJECT_PURGE_LIST_CHANGED', projectCount: projects.length }, 409)
      // Work from the confirmed snapshot, never from a dynamically expanding
      // list. Projects created after admission are intentionally not deleted.
      const results: Array<{ projectId: string; deleted: boolean; code?: string }> = []
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, currentIds.length) }, async () => {
        while (next < currentIds.length) {
          const projectId = currentIds[next++]!
          try {
            const result = await dependencies.deleteProject(c.req.raw, user, projectId)
            results.push({ projectId, deleted: result.deleted, ...(!result.deleted ? { code: 'PROJECT_NOT_DELETED' } : {}) })
          } catch {
            // Never leak provider credentials or opaque storage errors.
            results.push({ projectId, deleted: false, code: 'PROJECT_DELETE_FAILED' })
          }
        }
      }))
      results.sort((a, b) => a.projectId.localeCompare(b.projectId))
      return c.json({ requested: currentIds.length, deleted: results.filter(result => result.deleted).length,
        failed: results.filter(result => !result.deleted).length, results })
    } finally {
      busyOwners.delete(user.id)
    }
  })
}
