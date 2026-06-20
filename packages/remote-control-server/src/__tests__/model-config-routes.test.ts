import { describe, test, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { resetModelConfigs } from '../services/model-config'
import webModelConfigs from '../routes/web/model-configs'

function resJson(res: Response) {
  return res.json() as Promise<any>
}

function createApp() {
  const app = new Hono()
  app.route('/web', webModelConfigs)
  return app
}

describe('model config Web routes', () => {
  let app: Hono

  beforeEach(() => {
    resetModelConfigs()
    app = createApp()
  })

  test('GET /web/model-configs returns configs for the browser UUID', async () => {
    const res = await app.request('/web/model-configs?uuid=browser-user')

    expect(res.status).toBe(200)
    expect(await resJson(res)).toEqual([])
  })

  test('POST /web/model-configs creates a masked config without returning apiKey', async () => {
    const res = await app.request('/web/model-configs?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'OpenRouter',
        provider: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test-secret',
        models: {
          fast: 'openai/gpt-4.1-mini',
          balanced: 'anthropic/claude-sonnet-4',
          strong: 'anthropic/claude-opus-4',
        },
        isDefault: true,
      }),
    })

    expect(res.status).toBe(200)
    const body = await resJson(res)
    expect(body.id).toMatch(/^llm_/)
    expect(body.ownerId).toBe('browser-user')
    expect(body.apiKeyPreview).toBe('sk-t...cret')
    expect(body.apiKey).toBeUndefined()
  })

  test('PATCH /web/model-configs/:id changes the default config', async () => {
    const firstRes = await app.request('/web/model-configs?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'First',
        provider: 'anthropic-compatible',
        apiKey: 'first-secret',
        models: {},
        isDefault: true,
      }),
    })
    const secondRes = await app.request(
      '/web/model-configs?uuid=browser-user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Second',
          provider: 'gemini',
          apiKey: 'second-secret',
          models: { balanced: 'gemini-2.5-pro' },
          isDefault: false,
        }),
      },
    )
    const first = await resJson(firstRes)
    const second = await resJson(secondRes)

    const patchRes = await app.request(
      `/web/model-configs/${second.id}?uuid=browser-user`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      },
    )

    expect(patchRes.status).toBe(200)
    const listRes = await app.request('/web/model-configs?uuid=browser-user')
    const configs = await resJson(listRes)
    expect(configs.find((c: any) => c.id === first.id).isDefault).toBe(false)
    expect(configs.find((c: any) => c.id === second.id).isDefault).toBe(true)
  })

  test('POST /web/model-configs/:id/test validates configured model locally', async () => {
    const createRes = await app.request(
      '/web/model-configs?uuid=browser-user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Gemini',
          provider: 'gemini',
          apiKey: 'gemini-secret',
          models: { balanced: 'gemini-2.5-pro' },
          isDefault: true,
        }),
      },
    )
    const config = await resJson(createRes)

    const testRes = await app.request(
      `/web/model-configs/${config.id}/test?uuid=browser-user`,
      { method: 'POST' },
    )

    expect(testRes.status).toBe(200)
    expect(await resJson(testRes)).toEqual({
      ok: true,
      provider: 'gemini',
      model: 'gemini-2.5-pro',
    })
  })

  test('DELETE /web/model-configs/:id removes the config', async () => {
    const createRes = await app.request(
      '/web/model-configs?uuid=browser-user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Delete Me',
          provider: 'grok',
          apiKey: 'grok-secret',
          models: { balanced: 'grok-4' },
          isDefault: true,
        }),
      },
    )
    const config = await resJson(createRes)

    const deleteRes = await app.request(
      `/web/model-configs/${config.id}?uuid=browser-user`,
      { method: 'DELETE' },
    )

    expect(deleteRes.status).toBe(200)
    expect(await resJson(deleteRes)).toEqual({ ok: true })
    const listRes = await app.request('/web/model-configs?uuid=browser-user')
    expect(await resJson(listRes)).toEqual([])
  })

  test('POST /web/model-configs rejects invalid base URL', async () => {
    const res = await app.request('/web/model-configs?uuid=browser-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad URL',
        provider: 'openai-compatible',
        baseUrl: 'not-a-url',
        apiKey: 'sk-test-secret',
        models: {},
      }),
    })

    expect(res.status).toBe(400)
    const body = await resJson(res)
    expect(body.error.message).toBe('Invalid base URL')
  })
})
