import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetAgentWorkflow } from '@claude-code-best/agent-workflow'
import { createAgentWorkflowApp } from '../app'

describe('agent workflow server routes', () => {
  const app = createAgentWorkflowApp()

  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('creates and lists masked model configs for an owner', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.apiKey).toBeUndefined()
    expect(created.apiKeyPreview).toBe('sk-d...cret')

    const listRes = await app.request('/api/model-configs?ownerId=owner-a')
    expect(listRes.status).toBe(200)
    expect(await listRes.json()).toEqual([
      expect.objectContaining({ id: created.id, name: 'Primary LLM' }),
    ])
  })

  test('does not expose the removed workflow run API', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(404)
  })

  test('persists model configs across app instances when storage is enabled', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-models-'))

    try {
      const firstApp = createAgentWorkflowApp({
        modelConfigStore: { dataDir },
      })
      const createRes = await firstApp.request(
        '/api/model-configs?ownerId=owner-a',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Persistent LLM',
            provider: 'openai-compatible',
            baseUrl: 'https://llm.example.invalid/v1',
            apiKey: 'sk-persistent-secret',
            models: { balanced: 'balanced-model' },
            isDefault: true,
          }),
        },
      )
      expect(createRes.status).toBe(200)
      const created = await createRes.json()

      resetAgentWorkflow()
      const secondApp = createAgentWorkflowApp({
        modelConfigStore: { dataDir },
      })
      const listRes = await secondApp.request(
        '/api/model-configs?ownerId=owner-a',
      )

      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        expect.objectContaining({
          id: created.id,
          name: 'Persistent LLM',
          apiKeyPreview: 'sk-p...cret',
        }),
      ])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('persists BeeGame project metadata across app instances in SQLite', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-project-store-'))

    try {
      const firstApp = createAgentWorkflowApp({
        defaultWorkspacePath: workspace,
      })
      const createRes = await firstApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_beegame_sqlite',
          name: 'SQLite Project',
          root_path: join(workspace, 'sqlite-project'),
          created_at: 1710000000000,
        }),
      })
      expect(createRes.status).toBe(200)

      const secondApp = createAgentWorkflowApp({
        defaultWorkspacePath: workspace,
      })
      const listRes = await secondApp.request('/api/projects')

      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        {
          id: 'project_beegame_sqlite',
          name: 'SQLite Project',
          root_path: join(workspace, 'sqlite-project'),
          created_at: 1710000000000,
        },
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('analyzes BeeGame intake and returns game-mode options from the default model config', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    const fetchCalls: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = (async (url, init) => {
      fetchCalls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')),
      })
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                maturity: 'vague',
                needs_options: true,
                needs_clarification: false,
                detected_constraints: ['browser playable demo'],
                recommended_next_step: 'choose_direction',
                options: [
                  {
                    id: 'llm_mode',
                    title: 'LLM Mode',
                    pitch: 'LLM generated pitch.',
                    coreGameplayHypothesis: 'LLM generated hypothesis.',
                    experienceSnapshot: 'LLM generated snapshot.',
                    playerFirstMinute: 'LLM generated first minute.',
                    whyFitsIdea: 'LLM generated fit.',
                    playablePrototype: 'LLM generated playable build.',
                    validationTarget: 'LLM generated validation target.',
                    coreMechanic: 'LLM generated core mechanic.',
                    firstBuild: 'LLM generated first build.',
                    validationGoal: 'LLM generated validation goal.',
                    risk: 'LLM generated risk.',
                    fit: 'LLM generated fit.',
                    firstPlayableValidation: 'LLM generated validation.',
                    riskComplexity: 'LLM generated complexity.',
                    gameplay: 'LLM generated gameplay rules.',
                    recommendedPlatform: 'Web',
                    recommendedDimension: '2D',
                    recommendedGenre: 'Strategy',
                    recommendedStyle: 'Pixel',
                    recommendedInputs: ['Keyboard/mouse'],
                    scope: 'Playable demo',
                  },
                  { id: 'mode_two', title: 'Mode Two', gameplay: 'Second playable mode.' },
                  { id: 'mode_three', title: 'Mode Three', gameplay: 'Third playable mode.' },
                  { id: 'mode_four', title: 'Mode Four', gameplay: 'Fourth playable mode.' },
                ],
              }),
            },
          },
        ],
      })
    }) as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake).toEqual(expect.objectContaining({
        maturity: 'vague',
        needsOptions: true,
        needsClarification: false,
        clarificationQuestions: [],
        detectedConstraints: ['browser playable demo'],
        recommendedNextStep: 'choose_direction',
      }))
      expect(intake.options).toHaveLength(3)
      expect(intake.options.map((option: { id: string }) => option.id)).toEqual([
        'llm_mode',
        'mode_two',
        'mode_three',
      ])
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_mode',
        title: 'LLM Mode',
        coreGameplayHypothesis: 'LLM generated hypothesis.',
        playerFirstMinute: 'LLM generated first minute.',
        whyFitsIdea: 'LLM generated fit.',
        playablePrototype: 'LLM generated playable build.',
        validationTarget: 'LLM generated validation target.',
        fit: 'LLM generated fit.',
        firstPlayableValidation: 'LLM generated validation.',
        riskComplexity: 'LLM generated complexity.',
        recommendedPlatform: 'Web',
      }))
      expect(fetchCalls[0]?.url).toBe('https://llm.example.invalid/v1/chat/completions')
      expect(fetchCalls[0]?.body).toEqual(expect.objectContaining({
        model: 'balanced-model',
        response_format: { type: 'json_object' },
      }))
      const requestBody = fetchCalls[0]?.body as { messages?: Array<{ role: string; content: string }> }
      const systemPrompt = requestBody.messages?.find(message => message.role === 'system')?.content || ''
      expect(systemPrompt).toContain('understand the game request before proposing game modes')
      expect(systemPrompt).toContain('title must be a game mode name')
      expect(systemPrompt).toContain('gameplay must explain the playable rules')
      expect(systemPrompt).toContain('coreGameplayHypothesis')
      expect(systemPrompt).toContain('whyFitsIdea')
      expect(systemPrompt).toContain('playablePrototype')
      expect(systemPrompt).toContain('validationTarget')
      expect(systemPrompt).toContain('game mode')
      expect(systemPrompt).toContain('target briefs')
      expect(systemPrompt).toContain('not full design documents')
      expect(systemPrompt).toContain('Do not write full GDD')
      expect(systemPrompt).toContain('Do not output internal rubric names')
      expect(systemPrompt).toContain('maturity')
      expect(systemPrompt).toContain('needs_options')
      expect(systemPrompt).toContain('At least one option must stay faithful to the original idea')
      expect(systemPrompt).toContain('Choose recommended metadata from these lists')
      expect(systemPrompt).toContain('recommendedPlatform: Web, Unity, Godot, XR, Native')
      expect(systemPrompt).toContain('recommendedDimension: 2D, 3D, Mixed')
      expect(systemPrompt).toContain('recommendedInputs: Keyboard/mouse, Gamepad, Touch, Voice, Hand tracking XR')
      expect(systemPrompt).toContain('Do not output Auto for recommended metadata')
      expect(systemPrompt).not.toContain('prototype title')
      expect(systemPrompt).not.toContain('playable prototype name')
      expect(systemPrompt).not.toContain('Core Loop')
      expect(systemPrompt).not.toContain('Fun Hook')
      expect(systemPrompt).not.toContain('Risk/Reward')
      expect(systemPrompt).not.toContain('First 3 Minutes')
      expect(systemPrompt).not.toContain('MVP Acceptance')
      expect(systemPrompt).not.toContain('FPS')
      expect(systemPrompt).not.toContain('2D Arcade')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('returns structured clarification when the model cannot recommend modes yet', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'vague',
              needs_options: false,
              needs_clarification: true,
              clarification: {
                prompt: 'Which interpretation should BeeGame use?',
                options: [
                  { id: 'direction_a', label: 'Direction A', description: 'Use direction A.' },
                  { id: 'direction_b', label: 'Direction B', value: 'Use direction B.' },
                ],
                freeform_label: 'Add detail',
              },
              clarification_questions: [],
              detected_constraints: [],
              recommended_next_step: 'clarify',
              options: [],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'idea requiring clarification' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake).toEqual({
        maturity: 'vague',
        needsOptions: false,
        needsClarification: true,
        clarification: {
          prompt: 'Which interpretation should BeeGame use?',
          options: [
            { id: 'direction_a', label: 'Direction A', description: 'Use direction A.' },
            { id: 'direction_b', label: 'Direction B', value: 'Use direction B.' },
          ],
          freeformLabel: 'Add detail',
        },
        clarificationQuestions: [],
        detectedConstraints: [],
        recommendedNextStep: 'clarify',
        options: [],
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts minimal LLM game-mode options and derives internal brief fields', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'directional',
              needs_options: true,
              needs_clarification: false,
              recommended_next_step: 'choose_direction',
              options: [
                {
                  id: 'llm_minimal_mode',
                  title: 'LLM Minimal Mode',
                  gameplay: 'LLM generated playable rules.',
                  recommended_platform: 'Web',
                  recommended_dimension: '2D',
                  recommended_genre: 'Action',
                  recommended_style: 'Minimal',
                  recommended_inputs: ['Keyboard/mouse'],
                  scope: 'Playable demo',
                },
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_minimal_mode',
        title: 'LLM Minimal Mode',
        gameplay: 'LLM generated playable rules.',
        pitch: 'LLM generated playable rules.',
        coreGameplayHypothesis: 'LLM generated playable rules.',
        playablePrototype: 'LLM generated playable rules.',
        recommendedPlatform: 'Web',
        recommendedDimension: '2D',
        recommendedGenre: 'Action',
        recommendedStyle: 'Minimal',
        recommendedInputs: ['Keyboard/mouse'],
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts OpenAI-compatible content arrays for intake options', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  maturity: 'directional',
                  needs_options: true,
                  needs_clarification: false,
                  recommended_next_step: 'choose_direction',
                  options: [
                    {
                      id: 'llm_content_array_mode',
                      title: 'LLM Content Array Mode',
                      gameplay: 'LLM generated playable rules from content array.',
                      recommended_platform: 'Web',
                      recommended_dimension: '2D',
                      recommended_genre: 'Action',
                      recommended_style: 'Minimal',
                      recommended_inputs: ['Keyboard/mouse'],
                      scope: 'Playable demo',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_content_array_mode',
        title: 'LLM Content Array Mode',
        gameplay: 'LLM generated playable rules from content array.',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts LLM metadata strings or arrays without dropping valid game modes', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              options: [
                {
                  id: 'llm_array_metadata_mode',
                  title: 'LLM Array Metadata Mode',
                  gameplay: 'LLM generated playable rules with array metadata.',
                  recommendedPlatform: ['PC', 'Mobile'],
                  recommendedDimension: '2.5D',
                  recommendedGenre: 'STG',
                  recommendedStyle: 'Vector',
                  recommendedInputs: ['Keyboard/mouse', 'Touch'],
                  scope: 'Playable demo',
                },
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_array_metadata_mode',
        recommendedPlatform: 'PC, Mobile',
        recommendedDimension: '2.5D',
        recommendedGenre: 'STG',
        recommendedStyle: 'Vector',
        recommendedInputs: ['Keyboard/mouse', 'Touch'],
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('does not reject otherwise valid intake options when optional inputs are omitted', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'directional',
              needs_options: true,
              options: [
                {
                  id: 'llm_no_inputs_mode',
                  title: 'LLM No Inputs Mode',
                  gameplay: 'LLM generated playable rules without input metadata.',
                  recommendedPlatform: 'Web',
                  recommendedDimension: '2D',
                  recommendedGenre: 'Action',
                  recommendedStyle: 'Minimal',
                  scope: 'Playable demo',
                },
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_no_inputs_mode',
        recommendedInputs: [],
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('extracts the first complete JSON object from prose-wrapped model output', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const modelJson = JSON.stringify({
      maturity: 'directional',
      needs_options: true,
      options: [
        {
          id: 'llm_wrapped_mode',
          title: 'LLM Wrapped Mode',
          gameplay: 'LLM generated playable rules from wrapped output.',
          recommendedPlatform: 'Web',
          recommendedDimension: '2D',
          recommendedGenre: 'Action',
          recommendedStyle: 'Minimal',
          scope: 'Playable demo',
        },
      ],
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: `这里是模型的说明：\n${modelJson}\n补充说明里的 {中文内容} 不应该进入 JSON 解析。`,
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_wrapped_mode',
        title: 'LLM Wrapped Mode',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts game-mode options with only title and gameplay', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=dashboard-local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              options: [
                {
                  title: 'LLM Lean Mode',
                  gameplay: 'LLM generated playable rules without metadata.',
                },
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options?ownerId=dashboard-local', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'mode_1',
        title: 'LLM Lean Mode',
        gameplay: 'LLM generated playable rules without metadata.',
        recommendedPlatform: '',
        recommendedDimension: '',
        recommendedGenre: '',
        recommendedStyle: '',
        recommendedInputs: [],
        scope: '',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
