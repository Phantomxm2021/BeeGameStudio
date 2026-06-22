import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { realpath, rm } from 'node:fs/promises'
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
  readSessionTranscriptFromDisk,
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
  projectFolderName: string
  pitch: string
  gameplay: string
  coreGameplayHypothesis: string
  experienceSnapshot: string
  playerFirstMinute: string
  whyFitsIdea: string
  playablePrototype: string
  validationTarget: string
  coreMechanic: string
  firstBuild: string
  validationGoal: string
  risk: string
  fit: string
  firstPlayableValidation: string
  riskComplexity: string
  recommendedPlatform: string
  recommendedDimension: string
  recommendedGenre: string
  recommendedStyle: string
  recommendedInputs: string[]
  scope: string
}

type BeeGameClarificationOption = {
  id: string
  label: string
  description?: string
  value?: string
}

type BeeGameClarification = {
  prompt: string
  options: BeeGameClarificationOption[]
  freeformLabel?: string
}

type BeeGameIntakeAnalysis = {
  maturity: 'vague' | 'directional' | 'concrete'
  needsOptions: boolean
  needsClarification: boolean
  clarification?: BeeGameClarification
  clarificationQuestions: string[]
  detectedConstraints: string[]
  recommendedNextStep: string
  options: BeeGameIntakeOption[]
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
  const dashboardDataRoot = getDashboardDataRoot(options.defaultWorkspacePath)
  const beeGameSessions = new BeeGameSessionManager(
    options.sessionRunner,
    dashboardDataRoot,
  )
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
        ...(await generateBeeGameIntakeOptions({
          idea: String(body.idea),
          ownerId: getOwnerId(c.req.query('ownerId')),
          modelConfigId:
            typeof body.modelConfigId === 'string' ? body.modelConfigId : undefined,
        })),
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
}): Promise<BeeGameIntakeAnalysis> {
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
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are BeeGame intake planner.',
            'First understand the game request before proposing game modes. The options are playable game modes, not project management delivery strategies.',
            'Return only JSON with this schema: maturity, needs_options, needs_clarification, clarification, clarification_questions, detected_constraints, recommended_next_step, options.',
            'maturity must be one of vague, directional, concrete.',
            'Set needs_options=true only when the idea is vague or broad enough that the user should choose between 2 to 4 directions.',
            'Set needs_options=false for concrete ideas that already specify the main platform, presentation, game mode, core loop, constraints, or MVP scope; in that case return exactly one recommended option and recommended_next_step="configure_details".',
            'Set needs_clarification=true only when a blocking contradiction or missing decision prevents a useful recommendation.',
            'When needs_clarification=true, clarification must contain exactly one prompt string for the most blocking question, 2 to 4 short options with id, label, optional description, and optional value, plus optional freeform_label. Do not bundle multiple questions into one prompt.',
            'When needs_clarification=true, recommended_next_step must be "clarify"; options may be empty because the user must answer first.',
            'When needs_clarification=false, return 1 to 4 valid options.',
            'Each option must include id, title, projectFolderName, pitch, gameplay, coreGameplayHypothesis, playerFirstMinute, whyFitsIdea, playablePrototype, validationTarget, risk, experienceSnapshot, coreMechanic, firstBuild, validationGoal, fit, firstPlayableValidation, riskComplexity, recommendedPlatform, recommendedDimension, recommendedGenre, recommendedStyle, recommendedInputs, and scope.',
            'projectFolderName must be an English lowercase kebab-case directory name based on the actual game concept, not a random identifier and not a BeeGame/dashboard name.',
            'title must be a game mode name, such as an objective, combat, puzzle, survival, race, sandbox, boss, narrative, simulation, or strategy mode name. Do not copy the user idea into the title and do not write an abstract production or delivery title.',
            'gameplay must explain the playable rules: player goal, main actions, opposition or pressure, scoring or progress, and win/fail/round end condition. Do not write abstract experience prose.',
            'Every option must be experience-first and gameplay-first, not implementation-first. Platform and presentation are supporting metadata, not the main point.',
            'Choose recommended metadata from these lists based on the full user request and game mode, not keyword matching.',
            'recommendedPlatform: Web, Unity, Godot, XR, Native',
            'recommendedDimension: 2D, 3D, Mixed',
            'recommendedGenre: Arcade, Puzzle, Action, Adventure, Casual, Simulation, Strategy',
            'recommendedStyle: Pixel, Cartoon, Minimal, Painterly, Sci-fi, Fantasy, Realistic',
            'recommendedInputs: Keyboard/mouse, Gamepad, Touch, Voice, Hand tracking XR',
            'Do not output Auto for recommended metadata.',
            'coreGameplayHypothesis must state the playable assumption being tested, in the form "if players do X under Y pressure, Z fun/decision should emerge".',
            'experienceSnapshot must let the user imagine what they will see and feel on screen when the first playable exists.',
            'playerFirstMinute must describe exactly what the player does in the first 60 seconds.',
            'whyFitsIdea must explain how this game mode preserves the user request and constraints.',
            'playablePrototype must describe the concrete first playable build for this mode, including scene/map, player actions, feedback, win/fail state, and what is omitted.',
            'validationTarget must describe what demand, fun, control feel, clarity, or risk this game mode validates.',
            'coreMechanic must name the main repeatable interaction or decision, not a production task.',
            'firstBuild must describe the concrete first playable deliverable, including scene/map, player actions, feedback, win/fail state, and what is omitted.',
            'validationGoal must describe what design assumption this playable validates.',
            'risk must describe the largest gameplay or delivery risk in plain language.',
            'At least one option must stay faithful to the original idea. Do not transform explicit user constraints such as genre, platform, perspective, controls, reference game, or intended fidelity unless the option clearly explains that it is a lower-cost validation alternative.',
            'fit must explain why this direction suits the user idea.',
            'firstPlayableValidation must explain what the first playable build validates.',
            'riskComplexity must explain the main delivery risk and complexity level.',
            'Avoid generic production strategy titles such as "faithful prototype", "core loop validation", or "high fidelity slice". Titles should name an actual game mode.',
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
  return parseBeeGameIntakeAnalysis(payload)
}

function parseBeeGameIntakeAnalysis(payload: JsonObject): BeeGameIntakeAnalysis {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice = choices[0]
  const message =
    isObject(firstChoice) && isObject(firstChoice.message)
      ? firstChoice.message
      : undefined
  const content = message ? extractMessageContentText(message) : ''
  const parsed = parseJsonObjectFromText(content)
  const options = Array.isArray(parsed.options) ? parsed.options : []
  const normalized: BeeGameIntakeOption[] = []
  const rejectedReasons: string[] = []
  for (let index = 0; index < options.length; index += 1) {
    const intakeOption = normalizeBeeGameIntakeOption(
      options[index],
      rejectedReasons,
      index,
    )
    if (intakeOption) normalized.push(intakeOption)
  }
  const needsClarification = getBooleanField(parsed, 'needsClarification', 'needs_clarification') ?? false
  const clarification = normalizeBeeGameClarification(parsed.clarification)
  if (normalized.length === 0 && !(needsClarification && clarification)) {
    const keys = Object.keys(parsed).join(', ') || 'none'
    const reason = rejectedReasons.slice(0, 3).join('; ')
    throw new Error(
      `Model intake response did not include valid options. Parsed keys: ${keys}${reason ? `. Rejected: ${reason}` : ''}`,
    )
  }
  const maturity = normalizeMaturity(parsed.maturity)
  return {
    maturity,
    needsOptions: getBooleanField(parsed, 'needsOptions', 'needs_options') ?? maturity !== 'concrete',
    needsClarification,
    ...(clarification ? { clarification } : {}),
    clarificationQuestions: getStringArrayField(parsed, 'clarificationQuestions', 'clarification_questions'),
    detectedConstraints: getStringArrayField(parsed, 'detectedConstraints', 'detected_constraints'),
    recommendedNextStep: getStringField(parsed, 'recommendedNextStep', 'recommended_next_step') || (needsClarification ? 'clarify' : maturity === 'concrete' ? 'configure_details' : 'choose_direction'),
    options: normalized.slice(0, 4),
  }
}

function normalizeBeeGameClarification(value: unknown): BeeGameClarification | undefined {
  if (!isObject(value)) return undefined
  const prompt = getStringField(value, 'prompt')
  if (!prompt) return undefined
  const rawOptions = Array.isArray(value.options) ? value.options : []
  const options = rawOptions
    .map((option, index): BeeGameClarificationOption | undefined => {
      if (!isObject(option)) return undefined
      const label = getStringField(option, 'label')
      if (!label) return undefined
      const description = getStringField(option, 'description')
      const optionValue = getStringField(option, 'value')
      return {
        id: getStringField(option, 'id') || `clarification_${index + 1}`,
        label,
        ...(description ? { description } : {}),
        ...(optionValue ? { value: optionValue } : {}),
      }
    })
    .filter((option): option is BeeGameClarificationOption => Boolean(option))
    .slice(0, 4)
  const freeformLabel = getStringField(value, 'freeformLabel', 'freeform_label')
  return {
    prompt,
    options,
    ...(freeformLabel ? { freeformLabel } : {}),
  }
}

function extractMessageContentText(message: JsonObject): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (!isObject(item)) return ''
        const text = item.text ?? item.content
        return typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  const parsed = message.parsed
  if (isObject(parsed)) return JSON.stringify(parsed)
  return ''
}

function normalizeBeeGameIntakeOption(
  value: unknown,
  rejectedReasons?: string[],
  optionIndex = 0,
): BeeGameIntakeOption | undefined {
  if (!isObject(value)) {
    rejectedReasons?.push('option was not an object')
    return undefined
  }
  const inputs = getStringArrayField(value, 'recommendedInputs', 'recommended_inputs')
  const gameplay = String(value.gameplay || '').trim()
  const pitch = String(value.pitch || '').trim() || gameplay
  const option = {
    id: String(value.id || '').trim() || `mode_${optionIndex + 1}`,
    title: String(value.title || '').trim(),
    projectFolderName: getStringField(value, 'projectFolderName', 'project_folder_name'),
    pitch,
    gameplay,
    coreGameplayHypothesis: getStringField(value, 'coreGameplayHypothesis', 'core_gameplay_hypothesis') || gameplay,
    experienceSnapshot: getStringField(value, 'experienceSnapshot', 'experience_snapshot') || pitch,
    playerFirstMinute: getStringField(value, 'playerFirstMinute', 'player_first_minute') || gameplay,
    whyFitsIdea: getStringField(value, 'whyFitsIdea', 'why_fits_idea') || getStringField(value, 'fit') || pitch,
    playablePrototype: getStringField(value, 'playablePrototype', 'playable_prototype') || getStringField(value, 'firstBuild', 'first_build') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    validationTarget: getStringField(value, 'validationTarget', 'validation_target') || getStringField(value, 'validationGoal', 'validation_goal') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    coreMechanic: getStringField(value, 'coreMechanic', 'core_mechanic') || getStringField(value, 'coreGameplayHypothesis', 'core_gameplay_hypothesis') || gameplay,
    firstBuild: getStringField(value, 'firstBuild', 'first_build') || getStringField(value, 'playablePrototype', 'playable_prototype') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    validationGoal: getStringField(value, 'validationGoal', 'validation_goal') || getStringField(value, 'validationTarget', 'validation_target') || getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    risk: getStringField(value, 'risk') || getStringField(value, 'riskComplexity', 'risk_complexity') || 'Complexity depends on selected scope.',
    fit: getStringField(value, 'fit') || pitch,
    firstPlayableValidation: getStringField(value, 'firstPlayableValidation', 'first_playable_validation') || gameplay,
    riskComplexity: getStringField(value, 'riskComplexity', 'risk_complexity') || 'Complexity depends on selected scope.',
    recommendedPlatform: getStringishField(value, 'recommendedPlatform', 'recommended_platform'),
    recommendedDimension: getStringishField(value, 'recommendedDimension', 'recommended_dimension'),
    recommendedGenre: getStringishField(value, 'recommendedGenre', 'recommended_genre'),
    recommendedStyle: getStringishField(value, 'recommendedStyle', 'recommended_style'),
    recommendedInputs: inputs,
    scope: getStringishField(value, 'scope'),
  }
  if (
    !option.title ||
    !option.gameplay
  ) {
    rejectedReasons?.push(
      [
        !option.title ? 'title' : '',
        !option.gameplay ? 'gameplay' : '',
      ].filter(Boolean).join(', '),
    )
    return undefined
  }
  return option
}

function normalizeMaturity(value: unknown): 'vague' | 'directional' | 'concrete' {
  return value === 'directional' || value === 'concrete' || value === 'vague'
    ? value
    : 'vague'
}

function getBooleanField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): boolean | undefined {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  return typeof candidate === 'boolean' ? candidate : undefined
}

function getStringField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): string {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function getStringishField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): string {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  if (typeof candidate === 'string') return candidate.trim()
  if (Array.isArray(candidate)) {
    return candidate
      .map(item => String(item).trim())
      .filter(Boolean)
      .join(', ')
  }
  return ''
}

function getStringArrayField(
  value: JsonObject,
  primary: string,
  fallback?: string,
): string[] {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined)
  return Array.isArray(candidate)
    ? candidate.map(item => String(item)).filter(Boolean)
    : []
}

function parseJsonObjectFromText(text: string): JsonObject {
  try {
    return JSON.parse(text) as JsonObject
  } catch {
    const fenced = extractFencedJson(text)
    if (fenced) {
      try {
        return JSON.parse(fenced) as JsonObject
      } catch {
        // Fall through to balanced object scanning.
      }
    }
    const objectText = extractFirstBalancedJsonObject(text)
    if (!objectText) throw new Error('Model intake response was not JSON')
    try {
      return JSON.parse(objectText) as JsonObject
    } catch {
      throw new Error('Model intake response was not valid JSON')
    }
  }
}

function extractFencedJson(text: string): string | undefined {
  const fenceStart = text.indexOf('```')
  if (fenceStart < 0) return undefined
  const contentStart = text.indexOf('\n', fenceStart)
  if (contentStart < 0) return undefined
  const fenceEnd = text.indexOf('```', contentStart + 1)
  if (fenceEnd < 0) return undefined
  return text.slice(contentStart + 1, fenceEnd).trim()
}

function extractFirstBalancedJsonObject(text: string): string | undefined {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = inString
        continue
      }
      if (char === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (char === '{') depth += 1
      if (char === '}') {
        depth -= 1
        if (depth === 0) {
          const candidate = text.slice(start, index + 1)
          try {
            JSON.parse(candidate)
            return candidate
          } catch {
            break
          }
        }
      }
    }
  }
  return undefined
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
      await assertSessionWorkspaceIsProjectDirectory(
        workspacePath,
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
      const workspacePath = c.req.query('workspacePath')
      if (toErrorMessage(err) === 'Session not found' && workspacePath) {
        return readTranscriptFromWorkspace(
          c.req.param('id'),
          workspacePath,
          defaultWorkspacePath,
          getDashboardDataRoot(defaultWorkspacePath),
        )
      }
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
    const workspacePathQuery = c.req.query('workspacePath')
    try {
      return c.json(
        await beeGameSessions.delete(c.req.param('id'), {
          deleteArtifacts,
        }),
      )
    } catch (err) {
      if (deleteArtifacts && toErrorMessage(err) === 'Session not found') {
        try {
          const workspacePath = workspacePathQuery
            ? await resolveSessionWorkspacePath(
                workspacePathQuery,
                defaultWorkspacePath,
              )
            : await getDefaultWorkspacePath({ defaultWorkspacePath })
          const dashboardDataRoot = getDashboardDataRoot(defaultWorkspacePath)
          const deletedArtifactPaths = await deleteSessionArtifactsFromTranscript(
            c.req.param('id'),
            workspacePath,
            dashboardDataRoot,
          ).catch((): string[] => [])
          const deletedWorkspacePath = await deleteWorkspaceDirectoryIfSafe(
            workspacePath,
            dashboardDataRoot,
          )
          if (deletedWorkspacePath) deletedArtifactPaths.push(deletedWorkspacePath)
          return c.json({
            deleted: true,
            deletedArtifactPaths,
          })
        } catch (fallbackErr) {
          return c.json({ error: toErrorMessage(fallbackErr) }, 404)
        }
      }
      return c.json({ error: toErrorMessage(err) }, 404)
    }
  })
}

async function deleteWorkspaceDirectoryIfSafe(
  workspacePath: string,
  dashboardDataRoot: string,
): Promise<string | undefined> {
  const workspaceRoot = await realpath(resolve(workspacePath))
  const dataRoot = await realpath(resolve(dashboardDataRoot))
  if (workspaceRoot === dataRoot) return undefined
  const rel = relative(dataRoot, workspaceRoot)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  await rm(workspaceRoot, { recursive: true, force: true })
  return workspaceRoot
}

async function readTranscriptFromWorkspace(
  sessionId: string,
  workspacePath: string,
  defaultWorkspacePath?: string,
  dashboardDataRoot?: string,
): Promise<Response> {
  try {
    const resolvedWorkspace = await resolveSessionWorkspacePath(
      workspacePath,
      defaultWorkspacePath,
    )
    return Response.json(
      await readSessionTranscriptFromDisk(
        sessionId,
        resolvedWorkspace,
        dashboardDataRoot,
      ),
    )
  } catch (err) {
    return Response.json({ error: toErrorMessage(err) }, { status: 404 })
  }
}

async function assertSessionWorkspaceIsProjectDirectory(
  workspacePath: string,
  defaultWorkspacePath?: string,
): Promise<void> {
  if (!hasWorkspaceBoundary(defaultWorkspacePath)) return
  const defaultWorkspace = resolve(
    await getDefaultWorkspacePath({ defaultWorkspacePath }),
  )
  const resolvedWorkspace = resolve(workspacePath)
  if (resolvedWorkspace !== defaultWorkspace) return
  throw new Error(
    `Workspace path must target a project directory under the default Projects directory, not the Projects root: ${defaultWorkspace}`,
  )
}

function getDashboardDataRoot(defaultWorkspacePath?: string): string {
  return resolve(
    defaultWorkspacePath?.trim() ||
      process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      resolve(process.cwd(), 'Projects'),
  )
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
  const canonicalWorkspace = canonicalizeWorkspaceCandidate(
    resolvedWorkspace,
    defaultWorkspace,
    defaultWorkspacePath,
  )
  if (!isInsideOrEqual(canonicalWorkspace, defaultWorkspace)) {
    throw new Error(
      `Workspace path must stay inside the default Projects directory: ${defaultWorkspace}`,
    )
  }
  return canonicalWorkspace
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

function canonicalizeWorkspaceCandidate(
  candidate: string,
  canonicalRoot: string,
  defaultWorkspacePath?: string,
): string {
  if (isInsideOrEqual(candidate, canonicalRoot)) return candidate
  const configuredRoot = resolve(
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      defaultWorkspacePath?.trim() ||
      resolve(process.cwd(), 'Projects'),
  )
  const rel = relative(configuredRoot, candidate)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolve(canonicalRoot, rel)
  }
  return candidate
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
