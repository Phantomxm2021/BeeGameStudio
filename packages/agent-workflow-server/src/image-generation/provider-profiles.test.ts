import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { defaultImageConfig, publicImageConfig } from './config'
import { decodeImageSettings, encodeImageSettings, encodeImageConfig, selectImageConfig, updateImageSettings } from './config-store'
import { loadRuntimeImageConfig } from './runtime-config'
import { createImageGenerationProvider } from './index'

test('Vercel uses the exact configured endpoint', async () => {
  const config = { ...defaultImageConfig('vercel'), apiKey: 'gateway-key' }
  let calls = 0
  const adapter = createImageGenerationProvider('vercel', async (url, init) => {
    calls++
    expect(url).toBe(config.baseUrl)
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer gateway-key')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe(config.model)
    expect(body.response_format).toBe('b64_json')
    return Response.json({ data: [{ b64_json: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }], usage: { input_tokens: 1 } })
  })
  await adapter.generate(config, { prompt: 'icon' })
  expect(calls).toBe(1)
})

test('Cloudflare uses the exact /ai/run endpoint, native envelope, and downloads result URL', async () => {
  const config = { ...defaultImageConfig('cloudflare'), apiKey: 'cloudflare-token', model: 'gpt-image-2.5-flare' }
  const png = Buffer.from([137,80,78,71,13,10,26,10])
  const calls: string[] = []
  const adapter = createImageGenerationProvider('cloudflare', async (url, init) => {
    calls.push(url)
    expect(url).toBe(config.baseUrl)
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer cloudflare-token')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({ model: 'openai/gpt-image-2.5-flare', input: { prompt: 'icon', quality: config.quality, size: config.size, output_format: 'png', background: 'auto' } })
    return Response.json({ result: { state: 'Completed', result: { image: 'https://cdn.example/result.png' }, gatewayMetadata: { keySource: 'Unified' } } })
  }, async (url, init) => {
    calls.push(url)
    expect(url).toBe('https://cdn.example/result.png')
    expect(init.redirect).toBe('error')
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  })
  const result = await adapter.generate(config, { prompt: 'icon' })
  expect(result.bytes).toEqual(png)
  expect(result.usage).toBeNull()
  expect(calls).toEqual([config.baseUrl, 'https://cdn.example/result.png'])
})

test('Cloudflare sends a reference image through the native images field', async () => {
  const config = { ...defaultImageConfig('cloudflare'), apiKey: 'cloudflare-token' }
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const adapter = createImageGenerationProvider('cloudflare', async (url, init) => {
    expect(url).toBe(config.baseUrl)
    const body = JSON.parse(String(init.body))
    expect(body.input.images).toEqual([`data:image/png;base64,${png.toString('base64')}`])
    expect(body.input.size).toBe('1536x1024')
    return Response.json({ result: { state: 'Completed', result: { image: 'https://cdn.example/edited.png' } } })
  }, async (url, init) => {
    expect(url).toBe('https://cdn.example/edited.png')
    expect(init.redirect).toBe('error')
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  })
  const result = await adapter.generate(config, { prompt: 'matching UI elements',
    size: '1536x1024',
    referenceImage: { bytes: png, sha256: 'a'.repeat(64), mimeType: 'image/png' } })
  expect(result.bytes).toEqual(png)
})

test('legacy config migrates to one profile, all provider keys remain encrypted and isolated', async () => {
  const previous = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString('base64')
  try {
    const original = { ...defaultImageConfig('openrouter'), apiKey: 'original-key' }
    let settings = decodeImageSettings(encodeImageConfig(original))
    expect(selectImageConfig(settings)).toEqual(original)
    const retired = { ...encodeImageConfig(original), billing: {
      model: original.model, version: 'fixed-v1', fixedRequestCredits: 0.04,
      textInputCreditsPerMillion: 0, imageInputCreditsPerMillion: 0,
      textOutputCreditsPerMillion: 0, imageOutputCreditsPerMillion: 0,
      maxRequestCredits: 1, projectBudgetCredits: 10 } }
    expect(selectImageConfig(decodeImageSettings(retired)).billing).toBeNull()
    const priorTokenRates = { ...encodeImageConfig(original), billing: {
      model: original.model, version: '2026-09-27', textInputUsdPerMillion: 5,
      cachedTextInputUsdPerMillion: 1.25, imageInputUsdPerMillion: 8,
      cachedImageInputUsdPerMillion: 3, imageOutputUsdPerMillion: 30,
      maxRequestCredits: 20, projectBudgetCredits: 100,
    } }
    expect(selectImageConfig(decodeImageSettings(priorTokenRates)).billing).toMatchObject({
      version: '2026-09-27-v2', markupMultiplier: 1.5,
    })
    for (const provider of ['openai', 'vercel', 'cloudflare'] as const) {
      expect(selectImageConfig(settings, provider).apiKey).toBe('')
      settings = updateImageSettings(settings, { provider, apiKey: provider + '-secret', model: provider + '-model', ...(provider === 'cloudflare' ? { upstreamApiKey: 'upstream-secret' } : {}) })
    }
    settings = updateImageSettings(settings, { provider: 'openrouter', size: '512x512' })
    const encoded = encodeImageSettings(settings)
    expect(JSON.stringify(encoded)).not.toContain('original-key')
    expect(JSON.stringify(encoded)).not.toContain('upstream-secret')
    const restored = decodeImageSettings(encoded)
    expect(selectImageConfig(restored).apiKey).toBe('original-key')
    expect(selectImageConfig(restored, 'vercel').apiKey).toBe('vercel-secret')
    expect(selectImageConfig(restored, 'cloudflare').upstreamApiKey).toBe('upstream-secret')
    expect(publicImageConfig(selectImageConfig(restored, 'cloudflare'))).not.toHaveProperty('upstreamApiKey')
    const runtime = await loadRuntimeImageConfig('/unused', {
      remote: true, billing: { mode: 'remote', remoteApiBaseUrl: 'https://service.test', creditControlToken: 'host-key' },
    }, async () => Response.json({ config: encoded, rowExists: true }))
    expect(runtime.provider).toBe('openrouter')
    expect(runtime.apiKey).toBe('original-key')
  } finally {
    if (previous === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = previous
  }
})

test('settings API reads individual profiles without activation, saves and clears only target keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'image-profiles-'))
  const previous = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  try {
    const app = createAgentWorkflowApp({ defaultWorkspacePath: dir, dashboardDataRoot: dir, currentUser: { id: 'admin', role: 'owner' } })
    const get = async (query = '') => (await app.fetch(new Request('http://local/api/image-generation/settings' + query))).json()
    const save = async (body: unknown) => {
      const res = await app.fetch(new Request('http://local/api/image-generation/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      expect(res.status).toBe(200)
      return res.json()
    }
    await save({ provider: 'openrouter', apiKey: 'router-secret', model: 'router-image' })
    expect(await get('?provider=vercel')).toMatchObject({ provider: 'vercel', hasApiKey: false, baseUrl: 'https://ai-gateway.vercel.sh/v1/images/generations' })
    expect(await get()).toMatchObject({ provider: 'openrouter', hasApiKey: true })
    await save({ provider: 'cloudflare', apiKey: 'cloudflare-secret', upstreamApiKey: 'upstream-secret' })
    await save({ provider: 'cloudflare', billing: { model: 'openai/gpt-image-2.5-flare', version: '2026-09-27-v2', markupMultiplier: 1.5,
      textInputUsdPerMillion: 5, cachedTextInputUsdPerMillion: 1.25,
      imageInputUsdPerMillion: 8, cachedImageInputUsdPerMillion: 3,
      imageOutputUsdPerMillion: 30, maxRequestCredits: 20, projectBudgetCredits: 1_000_000_000 } })
    expect(await get('?provider=cloudflare')).toMatchObject({ billing: { imageOutputUsdPerMillion: 30,
      fixedCreditsByVariant: { 'medium:1024x1024': 8 } }, fixedPricePresets: { 'low:1024x1024': 3 } })
    await save({ provider: 'cloudflare', billing: { model: 'openai/gpt-image-2.5-flare', version: '2026-09-27-v2', markupMultiplier: 1.5,
      textInputUsdPerMillion: 5, cachedTextInputUsdPerMillion: 1.25,
      imageInputUsdPerMillion: 8, cachedImageInputUsdPerMillion: 3,
      imageOutputUsdPerMillion: 30, maxRequestCredits: 20, projectBudgetCredits: 1_000_000_000,
      fixedCreditsByVariant: { 'medium:1024x1024': 9 } } })
    expect(await get('?provider=cloudflare')).toMatchObject({ billing: { fixedCreditsByVariant: { 'medium:1024x1024': 9 } } })
    expect(await get('?provider=openrouter')).toMatchObject({ model: 'router-image', hasApiKey: true })
    expect(await save({ provider: 'cloudflare', upstreamApiKey: '' })).toMatchObject({ hasApiKey: true, hasUpstreamApiKey: false })
    expect(JSON.stringify(await get())).not.toContain('secret')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    if (previous === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = previous
  }
})
