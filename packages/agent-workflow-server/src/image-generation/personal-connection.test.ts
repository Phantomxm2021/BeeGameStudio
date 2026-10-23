import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { loadPersonalImageConnection, publicPersonalImageConnection, savePersonalImageConnection } from './personal-connection'
import { ImageAttemptStore } from './attempt'
import { ImageGenerationService } from './service'
import { createAgentWorkflowApp, type AgentWorkflowAppOptions } from '../app'

test('personal image connection is private, encrypted, and never changes platform settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-image-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  const oldKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64')
  try {
    expect(loadPersonalImageConnection(first).source).toBe('platform')
    expect(publicPersonalImageConnection(loadPersonalImageConnection(first)).model).toBe('')
    const saved = savePersonalImageConnection(first, { source: 'byok', provider: 'openai',
      baseUrl: 'https://api.openai.com/v1/images/generations', model: 'my-image-model', apiKey: 'user-secret' })
    expect(saved).toMatchObject({ source: 'byok', hasApiKey: true, model: 'my-image-model' })
    expect(JSON.stringify(saved)).not.toContain('user-secret')
    expect(readFileSync(join(first, '.runtime/image-connection.json'), 'utf8')).not.toContain('user-secret')
    expect(loadPersonalImageConnection(first).config.apiKey).toBe('user-secret')
    expect(loadPersonalImageConnection(second).source).toBe('platform')
    savePersonalImageConnection(first, { source: 'platform' })
    expect(publicPersonalImageConnection(loadPersonalImageConnection(first)).source).toBe('platform')
    savePersonalImageConnection(first, { source: 'byok', provider: 'openai',
      baseUrl: 'https://api.openai.com/v1/images/generations', model: 'my-image-model' })
    expect(loadPersonalImageConnection(first).config.apiKey).toBe('user-secret')
    expect(() => savePersonalImageConnection(first, { source: 'byok', provider: 'openai',
      baseUrl: 'https://different.example/images', model: 'my-image-model' })).toThrow()
    expect(() => savePersonalImageConnection(first, { source: 'byok', provider: 'openai',
      baseUrl: 'http://private.example/images', model: 'my-image-model', apiKey: 'new-key' })).toThrow()
  } finally {
    if (oldKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = oldKey
    rmSync(root, { recursive: true, force: true })
  }
})

test('personal image request uses its own provider key without reserving platform Credits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-image-request-'))
  const config = { ...loadPersonalImageConnection(root).config, apiKey: 'user-key', billing: null,
    model: 'personal-image' }
  const actions: string[] = []
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async received => {
    calls++
    expect(received.apiKey).toBe('user-key')
    return { bytes: await sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer(),
      mimeType: 'image/png', model: received.model, usage: null }
  } }), { apply: async (_owner, request) => { actions.push(request.action); throw new Error('Platform wallet must not be used') } })
  try {
    const request = { ownerId: 'first', projectId: 'game', requestId: 'asset-1', config, request: { prompt: 'A game icon' } }
    const first = await service.generate(request, 'byok')
    const recovered = await service.generate(request, 'byok')
    expect(first.billingState).toBe('external')
    expect(first.chargedCreditsMicro).toBeNull()
    expect(recovered.billingState).toBe('external')
    expect(actions).toEqual([])
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('ordinary users can save only their own image connection; platform settings remain restricted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-image-route-'))
  const oldKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64')
  const options: Pick<AgentWorkflowAppOptions, 'defaultWorkspacePath' | 'dashboardDataRoot' | 'outboundTargetResolver'> = { defaultWorkspacePath: root, dashboardDataRoot: root,
    outboundTargetResolver: async (value: string) => ({ url: new URL(value), addresses: ['93.184.216.34'],
      lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4) }) }
  try {
    const first = createAgentWorkflowApp({ ...options, currentUser: { id: 'member-one', role: 'viewer' } })
    const second = createAgentWorkflowApp({ ...options, currentUser: { id: 'member-two', role: 'viewer' } })
    const put = await first.fetch(new Request('http://local/api/image-generation/connection', { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'byok', provider: 'openai',
        baseUrl: 'https://api.openai.com/v1/images/generations', model: 'personal-model', apiKey: 'member-secret' }) }))
    expect(put.status).toBe(200)
    expect(await put.text()).not.toContain('member-secret')
    const mine = await first.fetch(new Request('http://local/api/image-generation/connection'))
    expect(await mine.json()).toMatchObject({ source: 'byok', provider: 'openai', model: 'personal-model', hasApiKey: true })
    const theirs = await second.fetch(new Request('http://local/api/image-generation/connection'))
    expect(await theirs.json()).toMatchObject({ source: 'platform', hasApiKey: false })
    const admin = await first.fetch(new Request('http://local/api/image-generation/settings'))
    expect(admin.status).toBe(403)
  } finally {
    if (oldKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = oldKey
    rmSync(root, { recursive: true, force: true })
  }
})
