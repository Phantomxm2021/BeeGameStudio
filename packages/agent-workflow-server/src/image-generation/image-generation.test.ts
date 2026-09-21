import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageConfigSchema, publicImageConfig, updateImageConfig } from './config'
import { loadLocalImageConfig, saveLocalImageConfig } from './config-store'
import { OpenAIImageProvider } from './openai-provider'
import { createAgentWorkflowApp } from '../app'

test('OpenAI provider uses configured endpoint/model, one submission, and preserves usage', async () => {
  let calls = 0
  const usage = { input_tokens: 10, output_tokens: 20 }
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
  const provider = new OpenAIImageProvider(async (url, init) => {
    calls++
    expect(url).toBe('https://images.example/v1/images/generations')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'custom-image', n: 1, output_format: 'png', background: 'transparent' })
    expect(init.redirect).toBe('error')
    return Response.json({ data: [{ b64_json: png.toString('base64') }], usage }, { headers: { 'x-request-id': 'request-1' } })
  })
  const result = await provider.generate(imageConfigSchema.parse({ baseUrl: 'https://images.example/v1/images/generations', model: 'custom-image', apiKey: 'test-key' }), { prompt: 'A game icon', background: 'transparent' })
  expect(result.usage).toEqual(usage)
  expect(result.providerRequestId).toBe('request-1')
  expect(result.bytes).toEqual(png)
  expect(calls).toBe(1)
})

test('unknown upstream outcomes never retry or leak upstream error bodies', async () => {
  let calls = 0
  const config = imageConfigSchema.parse({ apiKey: 'secret-key' })
  for (const response of [undefined, new Response('secret-key', { status: 500 }), Response.json({ data: [] })]) {
    const provider = new OpenAIImageProvider(async () => { calls++; if (!response) throw new Error('secret-key'); return response })
    await expect(provider.generate(config, { prompt: 'icon' })).rejects.toMatchObject({ outcome: 'unknown' })
  }
  expect(calls).toBe(3)
})

test('platform config preserves omitted keys, supports removal and encrypts local storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'image-config-'))
  const oldKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  try {
    const config = imageConfigSchema.parse({ apiKey: 'private-image-key' })
    expect(config.model).toBe('gpt-image-2.5-flare')
    saveLocalImageConfig(dir, config)
    expect(readFileSync(join(dir, 'image-generation.json'), 'utf8')).not.toContain('private-image-key')
    expect(loadLocalImageConfig(dir)).toEqual(config)
    const longKeyConfig = imageConfigSchema.parse({ apiKey: 'k'.repeat(8192) })
    saveLocalImageConfig(dir, longKeyConfig)
    expect(loadLocalImageConfig(dir)).toEqual(longKeyConfig)
    expect(updateImageConfig(config, { model: 'another-model' }).apiKey).toBe(config.apiKey)
    expect(publicImageConfig(config)).not.toHaveProperty('apiKey')
    expect(updateImageConfig(config, { apiKey: '' }).apiKey).toBe('')
    expect(() => imageConfigSchema.parse({ baseUrl: 'https://user:password@host/v1' })).toThrow()
    expect(() => imageConfigSchema.parse({ baseUrl: 'http://remote.test/v1' })).toThrow()
  } finally {
    if (oldKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = oldKey
    rmSync(dir, { recursive: true, force: true })
  }
})

test('image settings API is admin-only and never returns the key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'image-settings-route-'))
  const oldKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64')
  try {
    const member = createAgentWorkflowApp({ defaultWorkspacePath: dir, dashboardDataRoot: dir, currentUser: { id: 'member', role: 'viewer' } })
    expect((await member.fetch(new Request('http://local/api/image-generation/settings'))).status).toBe(403)
    const admin = createAgentWorkflowApp({ defaultWorkspacePath: dir, dashboardDataRoot: dir, currentUser: { id: 'admin', role: 'owner' } })
    const saved = await admin.fetch(new Request('http://local/api/image-generation/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'private-key', model: 'custom-model' }) }))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ hasApiKey: true, model: 'custom-model' })
    const loaded = await admin.fetch(new Request('http://local/api/image-generation/settings'))
    expect(await loaded.text()).not.toContain('private-key')
  } finally {
    if (oldKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = oldKey
    rmSync(dir, { recursive: true, force: true })
  }
})
