import { expect, test, mock } from 'bun:test'
import { fetchOpenCodeGoModels, OPENCODE_GO_PROFILES, validateOpenCodeGoConfig } from '../opencode-go'
import { goCatalogResponse, goModelCatalog } from '../../../../tests/fixtures/opencode-go'

test('discovers new IDs by protocol without including Responses, Google, removed or unknown models', async () => {
  const get = mock(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).not.toHaveProperty('Authorization')
    return goCatalogResponse(String(url))
  })
  const catalog = await fetchOpenCodeGoModels(Object.assign(get, { preconnect: () => {} }))
  for (const provider of ['anthropic-compatible', 'openai-compatible'] as const)
    expect(catalog[provider]).toEqual([...goModelCatalog[provider]].sort())
  expect(get).toHaveBeenCalledTimes(2)
  const config = { provider: 'openai-compatible', baseUrl: OPENCODE_GO_PROFILES['openai-compatible'].baseUrl,
    model: 'new-chat-model', authMethods: ['byok'] }
  expect(() => validateOpenCodeGoConfig(config, catalog)).not.toThrow()
  expect(() => validateOpenCodeGoConfig({ ...config, model: 'new-anthropic-model' }, catalog)).toThrow()
})

test('catalog failures and malformed responses fail without retry or static fallback', async () => {
  for (const response of [() => Response.json({}, { status: 503 }), () => Response.json({ data: [] })]) {
    const get = mock(async () => response())
    await expect(fetchOpenCodeGoModels(get as unknown as typeof fetch)).rejects.toThrow()
    expect(get).toHaveBeenCalledTimes(2)
  }
})
