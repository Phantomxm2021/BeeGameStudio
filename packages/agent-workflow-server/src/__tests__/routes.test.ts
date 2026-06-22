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

  test('generates BeeGame intake options from the default model config', async () => {
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
                options: [
                  {
                    id: 'web_tactics',
                    title: 'Web 战术版',
                    pitch: '先做浏览器可玩的战术原型。',
                    gameplay: '用短局目标验证操作节奏。',
                    recommendedPlatform: 'Web',
                    recommendedDimension: '2D',
                    recommendedGenre: 'Strategy',
                    recommendedStyle: 'Pixel',
                    recommendedInputs: ['Keyboard/mouse'],
                    scope: 'Playable demo',
                  },
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
        body: JSON.stringify({ idea: '战术贪吃蛇' }),
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        options: [
          expect.objectContaining({
            id: 'web_tactics',
            title: 'Web 战术版',
            recommendedPlatform: 'Web',
          }),
        ],
      })
      expect(fetchCalls[0]?.url).toBe('https://llm.example.invalid/v1/chat/completions')
      expect(fetchCalls[0]?.body).toEqual(expect.objectContaining({
        model: 'balanced-model',
      }))
      const requestBody = fetchCalls[0]?.body as { messages?: Array<{ role: string; content: string }> }
      const systemPrompt = requestBody.messages?.find(message => message.role === 'system')?.content || ''
      expect(systemPrompt).toContain('Core Loop')
      expect(systemPrompt).toContain('Fun Hook')
      expect(systemPrompt).toContain('Risk/Reward')
      expect(systemPrompt).toContain('First 3 Minutes')
      expect(systemPrompt).toContain('MVP Acceptance')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
