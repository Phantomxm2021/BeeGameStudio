import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  appendWorkflowEvent,
  createArtifact,
  createGameProject,
  createGameRun,
  createModelConfig,
  deleteModelConfig,
  getRunDetail,
  listGameProjectsByOwner,
  listModelConfigs,
  listWorkers,
  updateModelConfig,
  updateRunPhase,
  type ArtifactKind,
  type ModelProviderKind,
  type PhaseStatus,
  type WorkflowEventType,
} from '@claude-code-best/agent-workflow'

type JsonObject = Record<string, unknown>

export function createAgentWorkflowApp(): Hono {
  const app = new Hono()

  app.use('/api/*', cors())

  app.get('/health', c => c.json({ status: 'ok' }))

  app.get('/api/model-configs', c => {
    return c.json(listModelConfigs(getOwnerId(c.req.query('ownerId'))))
  })

  app.post('/api/model-configs', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['name', 'provider', 'apiKey', 'models'])
    if (error) return c.json({ error }, 400)

    return c.json(
      createModelConfig(getOwnerId(c.req.query('ownerId')), {
        name: String(body.name),
        provider: body.provider as ModelProviderKind,
        ...(typeof body.baseUrl === 'string' && body.baseUrl
          ? { baseUrl: body.baseUrl }
          : {}),
        apiKey: String(body.apiKey),
        models: toModelMap(body.models),
        isDefault: body.isDefault === true,
      }),
    )
  })

  app.patch('/api/model-configs/:id', async c => {
    const body = await readJson(c.req.raw)
    const updated = updateModelConfig(c.req.param('id'), {
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.provider === 'string'
        ? { provider: body.provider as ModelProviderKind }
        : {}),
      ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
      ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
      ...(isObject(body.models) ? { models: toModelMap(body.models) } : {}),
      ...(typeof body.isDefault === 'boolean'
        ? { isDefault: body.isDefault }
        : {}),
    })
    return updated
      ? c.json(updated)
      : c.json({ error: 'Config not found' }, 404)
  })

  app.delete('/api/model-configs/:id', c => {
    return c.json({ deleted: deleteModelConfig(c.req.param('id')) })
  })

  app.get('/api/projects', c => {
    return c.json(listGameProjectsByOwner(getOwnerId(c.req.query('ownerId'))))
  })

  app.post('/api/projects', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, [
      'name',
      'idea',
      'targetRuntime',
      'workspacePath',
    ])
    if (error) return c.json({ error }, 400)

    return c.json(
      createGameProject(getOwnerId(c.req.query('ownerId')), {
        name: String(body.name),
        idea: String(body.idea),
        targetRuntime: String(body.targetRuntime),
        workspacePath: String(body.workspacePath),
      }),
    )
  })

  app.post('/api/runs', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['projectId', 'modelConfigId'])
    if (error) return c.json({ error }, 400)

    try {
      return c.json(
        createGameRun({
          projectId: String(body.projectId),
          modelConfigId: String(body.modelConfigId),
        }),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.get('/api/runs/:id', c => {
    const detail = getRunDetail(c.req.param('id'))
    return detail ? c.json(detail) : c.json({ error: 'Run not found' }, 404)
  })

  app.post('/api/runs/:id/phase', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['phase', 'status'])
    if (error) return c.json({ error }, 400)
    const run = updateRunPhase(
      c.req.param('id'),
      String(body.phase),
      body.status as PhaseStatus,
    )
    return run ? c.json(run) : c.json({ error: 'Run phase not found' }, 404)
  })

  app.post('/api/runs/:id/events', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['type', 'message'])
    if (error) return c.json({ error }, 400)
    try {
      return c.json(
        appendWorkflowEvent(c.req.param('id'), {
          type: body.type as WorkflowEventType,
          message: String(body.message),
          ...(typeof body.phase === 'string' ? { phase: body.phase } : {}),
          ...(typeof body.agentName === 'string'
            ? { agentName: body.agentName }
            : {}),
          ...(typeof body.artifactId === 'string'
            ? { artifactId: body.artifactId }
            : {}),
        }),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.post('/api/artifacts', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['projectId', 'runId', 'kind', 'title'])
    if (error) return c.json({ error }, 400)

    try {
      return c.json(
        createArtifact({
          projectId: String(body.projectId),
          runId: String(body.runId),
          kind: body.kind as ArtifactKind,
          title: String(body.title),
          ...(typeof body.path === 'string' ? { path: body.path } : {}),
          ...(typeof body.url === 'string' ? { url: body.url } : {}),
          ...(typeof body.mimeType === 'string'
            ? { mimeType: body.mimeType }
            : {}),
        }),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get('/api/workers', c => c.json(listWorkers()))

  return app
}

function getOwnerId(ownerId: string | undefined): string {
  return ownerId?.trim() || 'default-owner'
}

async function readJson(request: Request): Promise<JsonObject> {
  const value = await request.json()
  return isObject(value) ? value : {}
}

function requireFields(body: JsonObject, fields: string[]): string | null {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === '') {
      return `Missing field: ${field}`
    }
  }
  return null
}

function toModelMap(value: unknown): {
  fast?: string
  balanced?: string
  strong?: string
} {
  if (!isObject(value)) return {}
  return {
    ...(typeof value.fast === 'string' ? { fast: value.fast } : {}),
    ...(typeof value.balanced === 'string' ? { balanced: value.balanced } : {}),
    ...(typeof value.strong === 'string' ? { strong: value.strong } : {}),
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}
