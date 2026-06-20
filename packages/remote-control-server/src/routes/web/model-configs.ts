import { Hono } from 'hono'
import type { Context } from 'hono'
import { uuidAuth } from '../../auth/middleware'
import {
  createModelConfig,
  deleteModelConfig,
  getModelConfig,
  listModelConfigs,
  updateModelConfig,
  type ModelConfigInput,
  type ModelConfigUpdate,
  type ModelProviderKind,
  type PublicModelConfig,
} from '../../services/model-config'

const app = new Hono()

const PROVIDERS = new Set<ModelProviderKind>([
  'anthropic-compatible',
  'openai-compatible',
  'gemini',
  'grok',
])

app.get('/model-configs', uuidAuth, c => {
  const uuid = c.get('uuid')!
  return c.json(listModelConfigs(uuid), 200)
})

app.post('/model-configs', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const body = (await c.req.json()) as Partial<ModelConfigInput>
  const validation = validateCreateInput(body)
  if (validation.error) return errorResponse(c, validation.message)

  const config = createModelConfig(uuid, {
    name: body.name!,
    provider: body.provider!,
    ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
    apiKey: body.apiKey!,
    models: body.models ?? {},
    isDefault: body.isDefault,
  })
  return c.json(config, 200)
})

app.patch('/model-configs/:id', uuidAuth, async c => {
  const uuid = c.get('uuid')!
  const id = c.req.param('id')
  if (!id) return notFound(c)
  const existing = getOwnedConfig(id, uuid)
  if (!existing) return notFound(c)

  const body = (await c.req.json()) as ModelConfigUpdate
  const validation = validateUpdateInput(body)
  if (validation.error) return errorResponse(c, validation.message)

  const updated = updateModelConfig(existing.id, body)
  if (!updated) return notFound(c)
  return c.json(updated, 200)
})

app.delete('/model-configs/:id', uuidAuth, c => {
  const uuid = c.get('uuid')!
  const id = c.req.param('id')
  if (!id) return notFound(c)
  const existing = getOwnedConfig(id, uuid)
  if (!existing) return notFound(c)

  deleteModelConfig(existing.id)
  return c.json({ ok: true }, 200)
})

app.post('/model-configs/:id/test', uuidAuth, c => {
  const uuid = c.get('uuid')!
  const id = c.req.param('id')
  if (!id) return notFound(c)
  const config = getOwnedConfig(id, uuid)
  if (!config) return notFound(c)

  const model =
    config.models.balanced ?? config.models.strong ?? config.models.fast
  if (!model) {
    return c.json(
      {
        ok: false,
        error: { type: 'validation', message: 'No model configured' },
      },
      400,
    )
  }

  return c.json({ ok: true, provider: config.provider, model }, 200)
})

function getOwnedConfig(
  id: string,
  ownerId: string,
): PublicModelConfig | undefined {
  const config = getModelConfig(id)
  if (!config || config.ownerId !== ownerId) return undefined
  return config
}

function validateCreateInput(
  input: Partial<ModelConfigInput>,
): { error: false } | { error: true; message: string } {
  if (!input.name || input.name.trim().length === 0) {
    return { error: true, message: 'Name is required' }
  }
  if (!input.provider || !PROVIDERS.has(input.provider)) {
    return { error: true, message: 'Invalid provider' }
  }
  if (!input.apiKey || input.apiKey.trim().length === 0) {
    return { error: true, message: 'API key is required' }
  }
  if (input.baseUrl && !isValidUrl(input.baseUrl)) {
    return { error: true, message: 'Invalid base URL' }
  }
  return { error: false }
}

function validateUpdateInput(
  input: ModelConfigUpdate,
): { error: false } | { error: true; message: string } {
  if (input.name !== undefined && input.name.trim().length === 0) {
    return { error: true, message: 'Name is required' }
  }
  if (input.provider !== undefined && !PROVIDERS.has(input.provider)) {
    return { error: true, message: 'Invalid provider' }
  }
  if (
    input.baseUrl !== undefined &&
    input.baseUrl &&
    !isValidUrl(input.baseUrl)
  ) {
    return { error: true, message: 'Invalid base URL' }
  }
  if (input.apiKey !== undefined && input.apiKey.trim().length === 0) {
    return { error: true, message: 'API key is required' }
  }
  return { error: false }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function errorResponse(c: Context, message: string) {
  return c.json({ error: { type: 'validation', message } }, 400)
}

function notFound(c: Context) {
  return c.json(
    { error: { type: 'not_found', message: 'Model config not found' } },
    404,
  )
}

export default app
