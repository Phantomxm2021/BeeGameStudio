import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  createModelConfig,
  deleteModelConfig,
  listModelConfigs,
  updateModelConfig,
  type ModelProviderKind,
} from '@claude-code-best/agent-workflow'
import {
  ConsoleSessionManager,
  type ConsoleProcessFactory,
} from './console/session-manager'
import { listDirectories } from './filesystem/directories'
import {
  loadModelConfigsFromStore,
  saveModelConfigsToStore,
  type ModelConfigStoreOptions,
} from './model-config-store'

type JsonObject = Record<string, unknown>

export type AgentWorkflowAppOptions = {
  processFactory?: ConsoleProcessFactory
  modelConfigStore?: ModelConfigStoreOptions | false
}

export function createAgentWorkflowApp(
  options: AgentWorkflowAppOptions = {},
): Hono {
  const app = new Hono()
  const consoleSessions = new ConsoleSessionManager(options.processFactory)
  const modelConfigStore = options.modelConfigStore
  if (modelConfigStore !== false && modelConfigStore !== undefined) {
    loadModelConfigsFromStore(modelConfigStore)
  }

  app.use('/api/*', cors())

  app.get('/health', c => c.json({ status: 'ok' }))

  app.get('/api/model-configs', c => {
    return c.json(listModelConfigs(getOwnerId(c.req.query('ownerId'))))
  })

  app.post('/api/model-configs', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['name', 'provider', 'apiKey', 'models'])
    if (error) return c.json({ error }, 400)

    const created = createModelConfig(getOwnerId(c.req.query('ownerId')), {
      name: String(body.name),
      provider: body.provider as ModelProviderKind,
      ...(typeof body.baseUrl === 'string' && body.baseUrl
        ? { baseUrl: body.baseUrl }
        : {}),
      apiKey: String(body.apiKey),
      models: toModelMap(body.models),
      isDefault: body.isDefault === true,
    })
    persistModelConfigs(modelConfigStore)
    return c.json(created)
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
    if (!updated) return c.json({ error: 'Config not found' }, 404)

    persistModelConfigs(modelConfigStore)
    return c.json(updated)
  })

  app.delete('/api/model-configs/:id', c => {
    const deleted = deleteModelConfig(c.req.param('id'))
    if (deleted) persistModelConfigs(modelConfigStore)
    return c.json({ deleted })
  })

  app.get('/api/filesystem/directories', async c => {
    try {
      return c.json(await listDirectories(c.req.query('path')))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get('/api/console/sessions', c => c.json(consoleSessions.list()))

  app.post('/api/console/sessions', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['workspacePath'])
    if (error) return c.json({ error }, 400)
    try {
      return c.json(
        consoleSessions.start({
          workspacePath: String(body.workspacePath),
          ...(typeof body.modelConfigId === 'string' && body.modelConfigId
            ? { modelConfigId: body.modelConfigId }
            : {}),
        }),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get('/api/console/sessions/:id', c => {
    const session = consoleSessions.get(c.req.param('id'))
    return session
      ? c.json(session)
      : c.json({ error: 'Session not found' }, 404)
  })

  app.get('/api/console/sessions/:id/events', c => {
    try {
      const after = Number.parseInt(c.req.query('after') || '0', 10)
      return c.json(consoleSessions.events(c.req.param('id'), after))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.post('/api/console/sessions/:id/input', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['text'])
    if (error) return c.json({ error }, 400)
    try {
      return c.json(
        await consoleSessions.send(c.req.param('id'), String(body.text)),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post('/api/console/sessions/:id/stop', c => {
    try {
      return c.json(consoleSessions.stop(c.req.param('id')))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  return app
}

function persistModelConfigs(
  modelConfigStore: ModelConfigStoreOptions | false | undefined,
): void {
  if (modelConfigStore !== false && modelConfigStore !== undefined) {
    saveModelConfigsToStore(modelConfigStore)
  }
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
