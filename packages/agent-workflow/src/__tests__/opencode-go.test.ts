import { expect, test, mock } from 'bun:test'
import { fetchOpenCodeGoModels, OPENCODE_GO_PROFILES, validateOpenCodeGoConfig } from '../opencode-go'
import { goCatalogResponse, goModelCatalog, goAvailable, goRegistry } from '../../../../tests/fixtures/opencode-go'

test('discovers new IDs by protocol including Responses while excluding Google, removed or unknown models', async () => {
  const get = mock(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).not.toHaveProperty('Authorization')
    return goCatalogResponse(String(url))
  })
  const catalog = await fetchOpenCodeGoModels(Object.assign(get, { preconnect: () => {} }))
  for (const provider of ['anthropic-compatible', 'openai-compatible', 'responses'] as const)
    expect(catalog[provider]).toEqual([...goModelCatalog[provider]].sort())
  expect(get).toHaveBeenCalledTimes(2)
  const config = { provider: 'openai-compatible', baseUrl: OPENCODE_GO_PROFILES['openai-compatible'].baseUrl,
    model: 'new-chat-model', authMethods: ['byok'] }
  expect(() => validateOpenCodeGoConfig(config, catalog)).not.toThrow()
  expect(() => validateOpenCodeGoConfig({ ...config, model: 'new-anthropic-model' }, catalog)).toThrow()
  expect(() => validateOpenCodeGoConfig({ ...config, model: 'new-responses-model' }, catalog)).toThrow()
  expect(() => validateOpenCodeGoConfig({ ...config, apiProtocol: 'responses', model: 'new-responses-model' }, catalog)).not.toThrow()
  expect(() => validateOpenCodeGoConfig({ ...config, apiProtocol: 'responses' }, catalog)).toThrow()
  for (const model of ['deepseek-v4.1-flash', 'deepseek-v4-pro']) {
    expect(() => validateOpenCodeGoConfig({ ...config, model }, catalog)).not.toThrow()
    expect(() => validateOpenCodeGoConfig({ ...config, model, apiProtocol: 'responses' }, catalog)).not.toThrow()
  }
  // The generic OpenCode entry fills a missing Go entry, not a missing live ID
  // or a conflicting Go-specific protocol/deprecation.
  expect(catalog.responses).toContain('grok-4.6')
  expect(catalog.responses).not.toContain('new-chat-model')
  expect(catalog.responses).not.toContain('deprecated-model')
  expect(catalog.responses).not.toContain('not-on-go')
})

test('documented Responses support never revives removed or deprecated Go models',async()=>{
  const available=structuredClone(goAvailable),registry=structuredClone(goRegistry)
  available.data=available.data.filter(model=>model.id!=='deepseek-v4.1-flash'&&model.id!=='grok-4.6')
  Object.assign(registry['opencode-go'].models,{'deepseek-v4-pro':{status:'deprecated'}})
  const get=mock(async(url:string|URL|Request)=>Response.json(String(url).includes('models.dev')?registry:available))
  const catalog=await fetchOpenCodeGoModels(Object.assign(get,{preconnect:()=>{}}))
  for(const models of Object.values(catalog)){
    expect(models).not.toContain('deepseek-v4.1-flash')
    expect(models).not.toContain('deepseek-v4-pro')
    expect(models).not.toContain('grok-4.6')
  }
  expect(get).toHaveBeenCalledTimes(2)
})

test('catalog failures and malformed responses fail without retry or static fallback', async () => {
  for (const response of [() => Response.json({}, { status: 503 }), () => Response.json({ data: [] })]) {
    const get = mock(async () => response())
    await expect(fetchOpenCodeGoModels(get as unknown as typeof fetch)).rejects.toThrow()
    expect(get).toHaveBeenCalledTimes(2)
  }
})
