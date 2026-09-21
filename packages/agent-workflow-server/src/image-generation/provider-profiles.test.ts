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
    if (url === config.baseUrl) {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer cloudflare-token')
      const body = JSON.parse(String(init.body))
      expect(body).toEqual({ model: 'openai/gpt-image-2.5-flare', input: { prompt: 'icon', quality: config.quality, size: config.size, output_format: 'png', background: 'auto' } })
      return Response.json({ result: { state: 'Completed', result: { image: 'https://cdn.example/result.png' }, gatewayMetadata: { keySource: 'Unified' } } })
    }
    expect(url).toBe('https://cdn.example/result.png')
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  })
  const result = await adapter.generate(config, { prompt: 'icon' })
  expect(result.bytes).toEqual(png)
  expect(calls).toEqual([config.baseUrl, 'https://cdn.example/result.png'])
})

test('legacy config migrates to one profile, all provider keys remain encrypted and isolated', async () => {
  const previous = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString('base64')
  try {
    const original = { ...defaultImageConfig('openrouter'), apiKey: 'original-key' }
    let settings = decodeImageSettings(encodeImageConfig(original))
    expect(selectImageConfig(settings)).toEqual(original)
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
      remote: true, billing: { mode: 'remote', usageBillingMode: 'realtime', remoteApiBaseUrl: 'https://service.test', creditControlToken: 'host-key' },
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
    expect(await get('?provider=openrouter')).toMatchObject({ model: 'router-image', hasApiKey: true })
    expect(await save({ provider: 'cloudflare', upstreamApiKey: '' })).toMatchObject({ hasApiKey: true, hasUpstreamApiKey: false })
    expect(JSON.stringify(await get())).not.toContain('secret')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    if (previous === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = previous
  }
})
