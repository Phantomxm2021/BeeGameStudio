import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  createModelConfig,
  deleteModelConfig,
  listModelConfigs,
  mapModelConfigToRuntime,
  updateModelConfig,
  type ModelProviderKind,
} from '@claude-code-best/agent-workflow'
import {
  BeeGameSessionManager,
  deleteSessionArtifactsFromTranscript,
  type BeeGameSessionRunner,
} from './beegame/session-manager'
import { listDirectories } from './filesystem/directories'
import { getDefaultWorkspacePath } from './filesystem/default-workspace'
import {
  loadModelConfigsFromStore,
  saveModelConfigsToStore,
  type ModelConfigStoreOptions,
} from './model-config-store'

type JsonObject = Record<string, unknown>

type BeeGameIntakeOption = {
  id: string
  title: string
  pitch: string
  gameplay: string
  recommendedPlatform: string
  recommendedDimension: string
  recommendedGenre: string
  recommendedStyle: string
  recommendedInputs: string[]
  scope: string
}

export type AgentWorkflowAppOptions = {
  sessionRunner?: BeeGameSessionRunner
  modelConfigStore?: ModelConfigStoreOptions | false
  defaultWorkspacePath?: string
}

export function createAgentWorkflowApp(
  options: AgentWorkflowAppOptions = {},
): Hono {
  const app = new Hono()
  const beeGameSessions = new BeeGameSessionManager(options.sessionRunner)
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

  app.get('/api/filesystem/default-workspace', async c => {
    try {
      return c.json({
        path: await getDefaultWorkspacePath({
          defaultWorkspacePath: options.defaultWorkspacePath,
        }),
      })
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post('/api/beegame-intake/options', async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['idea'])
    if (error) return c.json({ error }, 400)
    try {
      return c.json({
        options: await generateBeeGameIntakeOptions({
          idea: String(body.idea),
          ownerId: getOwnerId(c.req.query('ownerId')),
          modelConfigId:
            typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
        }),
      })
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  registerBeeGameSessionRoutes(
    app,
    '/api/beegame-sessions',
    beeGameSessions,
    options.defaultWorkspacePath,
  )
  registerBeeGameSessionRoutes(
    app,
    '/api/console/sessions',
    beeGameSessions,
    options.defaultWorkspacePath,
  )

  return app
}

async function generateBeeGameIntakeOptions(input: {
  idea: string
  ownerId: string
  modelConfigId?: string
}): Promise<BeeGameIntakeOption[]> {
  const configId =
    input.modelConfigId ??
    listModelConfigs(input.ownerId).find(config => config.isDefault)?.id
  if (!configId) {
    throw new Error('No default model config found')
  }

  const runtime = mapModelConfigToRuntime(configId)
  const env = runtime?.env ?? {}
  const baseUrl = env.OPENAI_BASE_URL
  const apiKey = env.OPENAI_API_KEY
  const model =
    env.OPENAI_DEFAULT_SONNET_MODEL ??
    env.OPENAI_DEFAULT_OPUS_MODEL ??
    env.OPENAI_DEFAULT_HAIKU_MODEL
  if (!baseUrl || !apiKey || !model) {
    throw new Error('BeeGame intake currently requires an OpenAI-compatible model config')
  }

  const response = await fetch(joinApiPath(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: [
            'You are BeeGame intake planner.',
            'Return only JSON with an options array of 2 to 4 game direction objects.',
            'Each object must include id, title, pitch, gameplay, recommendedPlatform, recommendedDimension, recommendedGenre, recommendedStyle, recommendedInputs, and scope.',
            'Every option must be gameplay-first, not implementation-first.',
            'For each option, make gameplay describe the Core Loop, Fun Hook, Skill Test, Risk/Reward, Failure Pressure, First 3 Minutes, and MVP Acceptance in concise language.',
            'Reject vague options that only say "add levels", "add items", or "make it fun" without explaining the player decisions and failure pressure.',
            'Do not mention dashboard source paths, package paths, commands, or implementation directories.',
            'Keep the response language aligned with the user idea.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Game idea: ${input.idea}`,
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`Model intake request failed: ${response.status}`)
  }
  const payload = (await response.json()) as JsonObject
  return parseBeeGameIntakeOptions(payload)
}

function parseBeeGameIntakeOptions(payload: JsonObject): BeeGameIntakeOption[] {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice = choices[0]
  const message =
    isObject(firstChoice) && isObject(firstChoice.message)
      ? firstChoice.message
      : undefined
  const content = typeof message?.content === 'string' ? message.content : ''
  const parsed = parseJsonObjectFromText(content)
  const options = Array.isArray(parsed.options) ? parsed.options : []
  const normalized: BeeGameIntakeOption[] = []
  for (const option of options) {
    const intakeOption = normalizeBeeGameIntakeOption(option)
    if (intakeOption) normalized.push(intakeOption)
  }
  if (normalized.length === 0) {
    throw new Error('Model intake response did not include valid options')
  }
  return normalized.slice(0, 4)
}

function normalizeBeeGameIntakeOption(
  value: unknown,
): BeeGameIntakeOption | undefined {
  if (!isObject(value)) return undefined
  const inputs = Array.isArray(value.recommendedInputs)
    ? value.recommendedInputs.map(item => String(item)).filter(Boolean)
    : []
  const option = {
    id: String(value.id || '').trim(),
    title: String(value.title || '').trim(),
    pitch: String(value.pitch || '').trim(),
    gameplay: String(value.gameplay || '').trim(),
    recommendedPlatform: String(value.recommendedPlatform || '').trim(),
    recommendedDimension: String(value.recommendedDimension || '').trim(),
    recommendedGenre: String(value.recommendedGenre || '').trim(),
    recommendedStyle: String(value.recommendedStyle || '').trim(),
    recommendedInputs: inputs,
    scope: String(value.scope || '').trim(),
  }
  if (
    !option.id ||
    !option.title ||
    !option.pitch ||
    !option.gameplay ||
    !option.recommendedPlatform ||
    !option.recommendedDimension ||
    !option.recommendedGenre ||
    !option.recommendedStyle ||
    option.recommendedInputs.length === 0 ||
    !option.scope
  ) {
    return undefined
  }
  return option
}

function parseJsonObjectFromText(text: string): JsonObject {
  try {
    return JSON.parse(text) as JsonObject
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) {
      throw new Error('Model intake response was not JSON')
    }
    return JSON.parse(text.slice(start, end + 1)) as JsonObject
  }
}

function joinApiPath(baseUrl: string, path: string): string {
  return `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}${path}`
}

function registerBeeGameSessionRoutes(
  app: Hono,
  basePath: string,
  beeGameSessions: BeeGameSessionManager,
  defaultWorkspacePath?: string,
): void {
  app.get(basePath, c => c.json(beeGameSessions.list()))

  app.post(basePath, async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['workspacePath'])
    if (error) return c.json({ error }, 400)
    try {
      const workspacePath = await resolveSessionWorkspacePath(
        String(body.workspacePath),
        defaultWorkspacePath,
      )
      return c.json(
        beeGameSessions.start({
          workspacePath,
          ...(typeof body.modelConfigId === 'string' && body.modelConfigId
            ? { modelConfigId: body.modelConfigId }
            : {}),
        }),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.get(`${basePath}/:id`, c => {
    const session = beeGameSessions.get(c.req.param('id'))
    return session
      ? c.json(session)
      : c.json({ error: 'Session not found' }, 404)
  })

  app.get(`${basePath}/:id/events`, c => {
    try {
      const after = Number.parseInt(c.req.query('after') || '0', 10)
      return c.json(beeGameSessions.events(c.req.param('id'), after))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.get(`${basePath}/:id/transcript`, c => {
    try {
      return c.json(beeGameSessions.transcript(c.req.param('id')))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.get(`${basePath}/:id/artifacts`, async c => {
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'Missing query: path' }, 400)
    try {
      return c.json(await beeGameSessions.readArtifact(c.req.param('id'), path))
    } catch (err) {
      const message = toErrorMessage(err)
      return c.json(
        { error: message },
        message === 'Artifact path must stay inside the session workspace'
          ? 400
          : 404,
      )
    }
  })

  app.post(`${basePath}/:id/input`, async c => {
    const body = await readJson(c.req.raw)
    const error = requireFields(body, ['text'])
    if (error) return c.json({ error }, 400)
    try {
      return c.json(
        await beeGameSessions.send(c.req.param('id'), String(body.text)),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 400)
    }
  })

  app.post(`${basePath}/:id/permissions/:toolUseID`, async c => {
    const body = await readJson(c.req.raw)
    const decision = body.decision
    if (decision !== 'allow' && decision !== 'deny') {
      return c.json({ error: 'Permission decision must be allow or deny' }, 400)
    }
    try {
      return c.json(
        beeGameSessions.resolvePermission(
          c.req.param('id'),
          c.req.param('toolUseID'),
          {
            behavior: decision,
            remember: body.remember === true,
            ...(typeof body.message === 'string'
              ? { message: body.message }
              : {}),
          },
        ),
      )
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.post(`${basePath}/:id/stop`, c => {
    try {
      return c.json(beeGameSessions.stop(c.req.param('id')))
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })

  app.delete(`${basePath}/:id`, async c => {
    const deleteArtifacts = c.req.query('deleteArtifacts') === '1'
    try {
      return c.json(
        await beeGameSessions.delete(c.req.param('id'), {
          deleteArtifacts,
        }),
      )
    } catch (err) {
      if (deleteArtifacts && toErrorMessage(err) === 'Session not found') {
        try {
          const workspacePath = await getDefaultWorkspacePath({
            defaultWorkspacePath,
          })
          return c.json({
            deleted: true,
            deletedArtifactPaths: await deleteSessionArtifactsFromTranscript(
              c.req.param('id'),
              workspacePath,
            ),
          })
        } catch (fallbackErr) {
          return c.json({ error: toErrorMessage(fallbackErr) }, 404)
        }
      }
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })
}

async function resolveSessionWorkspacePath(
  workspacePath: string,
  defaultWorkspacePath?: string,
): Promise<string> {
  const trimmed = workspacePath.trim()
  if (!isAbsolute(trimmed)) {
    throw new Error('Workspace path must be absolute')
  }
  const resolvedWorkspace = resolve(trimmed)
  if (!hasWorkspaceBoundary(defaultWorkspacePath)) {
    return resolvedWorkspace
  }
  const defaultWorkspace = resolve(
    await getDefaultWorkspacePath({ defaultWorkspacePath }),
  )
  if (!isInsideOrEqual(resolvedWorkspace, defaultWorkspace)) {
    throw new Error(
      `Workspace path must stay inside the default Projects directory: ${defaultWorkspace}`,
    )
  }
  return resolvedWorkspace
}

function hasWorkspaceBoundary(defaultWorkspacePath?: string): boolean {
  return Boolean(
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      defaultWorkspacePath?.trim(),
  )
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
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
