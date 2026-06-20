import { Hono } from 'hono'
import type { Context } from 'hono'
import { uuidAuth } from '../../auth/middleware'
import {
  createArtifact,
  createGameProject,
  createGameRun,
  getGameProject,
  getGameRun,
  listArtifactsByRun,
  listGameProjectsByOwner,
  type ArtifactKind,
  type TargetPlatform,
} from '../../services/dashboard-projects'

const app = new Hono()

const TARGET_PLATFORMS = new Set<TargetPlatform>([
  'web',
  'unity',
  'godot',
  'custom',
])

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'gdd',
  'tech_design',
  'implementation_plan',
  'source_file',
  'test_report',
  'preview',
])

app.get('/projects', uuidAuth, c => {
  const uuid = c.get('uuid')!
  return c.json(listGameProjectsByOwner(uuid), 200)
})

app.post('/projects', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const body = (await c.req.json()) as {
    name?: string
    idea?: string
    targetPlatform?: TargetPlatform
    workspacePath?: string
  }

  if (!body.name || body.name.trim().length === 0) {
    return validationError(c, 'Name is required')
  }
  if (!body.idea || body.idea.trim().length === 0) {
    return validationError(c, 'Idea is required')
  }
  if (!body.targetPlatform || !TARGET_PLATFORMS.has(body.targetPlatform)) {
    return validationError(c, 'Invalid target platform')
  }
  if (!body.workspacePath || body.workspacePath.trim().length === 0) {
    return validationError(c, 'Workspace path is required')
  }

  return c.json(
    createGameProject(uuid, {
      name: body.name.trim(),
      idea: body.idea.trim(),
      targetPlatform: body.targetPlatform,
      workspacePath: body.workspacePath.trim(),
    }),
    200,
  )
})

app.post('/runs', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const body = (await c.req.json()) as {
    projectId?: string
    modelConfigId?: string
  }
  if (!body.projectId) return validationError(c, 'Project id is required')
  if (!body.modelConfigId)
    return validationError(c, 'Model config id is required')

  const project = getOwnedProject(body.projectId, uuid)
  if (!project) return notFound(c, 'Project not found')

  return c.json(
    createGameRun({
      projectId: project.id,
      modelConfigId: body.modelConfigId,
    }),
    200,
  )
})

app.get('/runs/:id', uuidAuth, c => {
  const uuid = c.get('uuid')!
  const id = c.req.param('id')
  if (!id) return notFound(c, 'Run not found')

  const run = getGameRun(id)
  if (!run) return notFound(c, 'Run not found')
  const project = getOwnedProject(run.projectId, uuid)
  if (!project) return notFound(c, 'Run not found')

  return c.json(
    {
      run,
      project,
      artifacts: listArtifactsByRun(run.id),
    },
    200,
  )
})

app.post('/artifacts', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const body = (await c.req.json()) as {
    projectId?: string
    runId?: string
    kind?: ArtifactKind
    title?: string
    path?: string
    url?: string
    mimeType?: string
  }

  if (!body.projectId) return validationError(c, 'Project id is required')
  if (!body.runId) return validationError(c, 'Run id is required')
  if (!body.kind || !ARTIFACT_KINDS.has(body.kind)) {
    return validationError(c, 'Invalid artifact kind')
  }
  if (!body.title || body.title.trim().length === 0) {
    return validationError(c, 'Title is required')
  }

  const project = getOwnedProject(body.projectId, uuid)
  if (!project) return notFound(c, 'Project not found')
  const run = getGameRun(body.runId)
  if (!run || run.projectId !== project.id) return notFound(c, 'Run not found')

  try {
    return c.json(
      createArtifact({
        projectId: project.id,
        runId: run.id,
        kind: body.kind,
        title: body.title.trim(),
        ...(body.path ? { path: body.path } : {}),
        ...(body.url ? { url: body.url } : {}),
        ...(body.mimeType ? { mimeType: body.mimeType } : {}),
      }),
      200,
    )
  } catch (err) {
    return validationError(c, (err as Error).message)
  }
})

function getOwnedProject(projectId: string, ownerId: string) {
  const project = getGameProject(projectId)
  if (!project || project.ownerId !== ownerId) return undefined
  return project
}

function validationError(c: Context, message: string) {
  return c.json({ error: { type: 'validation', message } }, 400)
}

function notFound(c: Context, message: string) {
  return c.json({ error: { type: 'not_found', message } }, 404)
}

export default app
