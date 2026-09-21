import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import type { ImageBillingClient, ImageBillingReceipt } from '@bee-game-studio/beegame-billing-core/image-billing'
import { ImageAttemptStore } from './attempt'
import { ImageGenerationService } from './service'
import { imageConfigSchema } from './config'
import { imageChargeCreditsMicro } from './pricing'
import { ImageProviderError } from './provider'
import { openImageGenerationAccess } from './access'
import { ImageConfigurationError } from './runtime-config'

test('access exposes safe failure facts and identifies a replay without another upstream call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-error-access-'))
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++
    expect(readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')).toContain('request-received')
    throw new ImageProviderError('private upstream response with secret', 'unknown', 504, 'upstream-http')
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, loadConfig: async () => config, service })
  const url = access.instruction.match(/POST (http:\/\/\S+) with/)![1]!
  try {
    const request = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'error-1', prompt: 'private prompt' }) })
    const first = await request()
    expect(first.status).toBe(502)
    const details = await first.json() as any
    expect(details).toMatchObject({ code: 'upstream-http', upstreamStatus: 504, replayed: false, outcome: 'unknown' })
    expect(details.diagnosticId).toBeString()
    const second = await request()
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ diagnosticId: details.diagnosticId, replayed: true, upstreamStatus: 504 })
    expect(calls).toBe(1)
    expect(JSON.stringify(details)).not.toContain('private')
    const document = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(document).toContain('private prompt')
    expect(document).toContain(details.diagnosticId)
    expect(document).toContain('"replayed": true')
    expect(document.match(/<!-- image-request:/g)).toHaveLength(1)
    expect(document).not.toContain('private upstream response')
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('configuration failure is recorded without submitting upstream', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-config-record-'))
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++
    throw new Error('Unexpected submission')
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => { throw new ImageConfigurationError('database-http', {
      source: 'service-platform', databaseHttpStatus: 403, serviceHttpStatus: 503,
    }) }, service })
  try {
    const url = access.instruction.match(/POST (http:\/\/\S+) with/)![1]!
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'config-1', prompt: 'an icon' }) })
    const details = await response.json() as any
    expect(details).toMatchObject({ stage: 'configuration', promptRecord: 'recorded',
      code: 'database-http', source: 'service-platform', databaseHttpStatus: 403, serviceHttpStatus: 503 })
    expect(details.diagnosticId).toBeString()
    const doc = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(doc).toContain('"model": "unknown"')
    expect(doc).toContain('delivery-failed')
    expect(doc).not.toContain('private settings error')
    expect(calls).toBe(0)
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('record write failure does not discard a paid PNG or trigger regeneration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-write-failure-'))
  mkdirSync(join(root, 'project'))
  mkdirSync(join(root, 'outside'))
  symlinkSync(join(root, 'outside'), join(root, 'project/assets'))
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project',
    workspacePath: join(root, 'project'), loadConfig: async () => config, service })
  try {
    const url = access.instruction.match(/POST (http:\/\/\S+) with/)![1]!
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'write-1', prompt: 'an icon' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-image-prompt-record')).toBe('failed')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8)
    expect(calls).toBe(1)
    expect(existsSync(join(root, 'outside/ai-generation-prompts.md'))).toBe(false)
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

const pricing = { model: 'test-model', version: 'test-v1', textInputCreditsPerMillion: 10,
  imageInputCreditsPerMillion: 20, textOutputCreditsPerMillion: 0, imageOutputCreditsPerMillion: 30,
  maxRequestCredits: 2, projectBudgetCredits: 10 }
const config = imageConfigSchema.parse({ model: 'test-model', apiKey: 'secret', billing: pricing })
const usage = { input_tokens: 100, output_tokens: 200, total_tokens: 300,
  input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 200 } }
const input = { ownerId: 'owner', projectId: 'project', requestId: 'image-1', config, request: { prompt: 'an icon' } }
function fakeBilling() {
  let receipt: ImageBillingReceipt | undefined
  const actions: string[] = []
  const client: ImageBillingClient = { async apply(_user, request) {
    actions.push(request.action)
    if (request.action === 'reserve') {
      if (receipt) return { ...receipt, created: false }
      return receipt = { created: true, state: 'reserved', metadata: request.metadata!, reservedCreditsMicro: request.amountCreditsMicro, chargedCreditsMicro: 0 }
    }
    if (!receipt) throw new Error('No reservation')
    return receipt = { ...receipt, created: false, state: request.action === 'settle' ? 'settled' : 'released', chargedCreditsMicro: request.amountCreditsMicro }
  } }
  return { client, actions }
}
async function png() { return sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer() }

test('image pricing uses detailed usage and exact micro-Credits; missing or inconsistent usage is not free', () => {
  expect(imageChargeCreditsMicro(usage, pricing)).toBe(7000)
  expect(() => imageChargeCreditsMicro(null, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro({ ...usage, total_tokens: 0 }, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro({ ...usage, input_tokens_details: { ...usage.input_tokens_details, cached_tokens: 5 } }, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro(usage, { ...pricing, maxRequestCredits: 0.000001 })).toThrow()
})

test('service reserves before generating, settles usage, recovers without another provider call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-service-'))
  const billing = fakeBilling()
  let calls = 0
  const provider = { generate: async () => {
    expect(billing.actions.at(-1)).toBe('reserve'); calls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png' as const, usage }
  } }
  try {
    const first = await new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client).generate(input)
    const second = await new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client).generate(input)
    expect(first.bytes).toEqual(second.bytes)
    expect(second.chargedCreditsMicro).toBe(7000)
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'settle', 'reserve', 'settle'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('lost local receipt cannot reuse existing wallet reservation to generate again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-lost-'))
  const billing = fakeBilling()
  await billing.client.apply('owner', { projectId: 'project', requestId: 'image-1', digest: 'test', action: 'reserve', amountCreditsMicro: 2e6, projectBudgetCreditsMicro: 10e6, metadata: { pricing } })
  let calls = 0
  try {
    const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => { calls++; throw new Error() } }), billing.client)
    await expect(service.generate(input)).rejects.toMatchObject({ reason: 'unknown' })
    expect(calls).toBe(0)
    expect(billing.actions).not.toContain('release')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('only confirmed rejected requests release holds; unknown provider outcome does not', async () => {
  for (const outcome of ['rejected', 'unknown'] as const) {
    const root = mkdtempSync(join(tmpdir(), 'image-failure-'))
    const billing = fakeBilling()
    try {
      const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => { throw new ImageProviderError('failure', outcome) } }), billing.client)
      await expect(service.generate(input)).rejects.toMatchObject({ reason: outcome })
      expect(billing.actions).toEqual(outcome === 'rejected' ? ['reserve', 'release'] : ['reserve'])
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('missing billing or mismatched model never calls the provider or wallet', async () => {
  const billing = fakeBilling()
  const service = new ImageGenerationService(new ImageAttemptStore('/unused-image-path', { generate: async () => { throw new Error('should not call') } }), billing.client)
  await expect(service.generate({ ...input, config: { ...config, billing: null } })).rejects.toThrow()
  await expect(service.generate({ ...input, config: { ...config, model: 'changed' } })).rejects.toThrow()
  expect(billing.actions).toEqual([])
})

test('received image survives missing usage and settlement failure without another paid generation', async () => {
  for (const failure of ['usage', 'settle']) {
    const root = mkdtempSync(join(tmpdir(), 'image-paid-recovery-'))
    const billing = fakeBilling()
    let calls = 0
    const client: ImageBillingClient = { apply(user, request) {
      if (failure === 'settle' && request.action === 'settle') throw new Error('billing unavailable')
      return billing.client.apply(user, request)
    } }
    const provider = { generate: async () => {
      calls++
      return { bytes: await png(), model: config.model, mimeType: 'image/png' as const,
        usage: failure === 'usage' ? { keySource: 'Unified' } : usage }
    } }
    const service = new ImageGenerationService(new ImageAttemptStore(root, provider), client)
    const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
      loadConfig: async () => config, service })
    try {
      const url = access.instruction.match(/POST (http:\/\/\S+) with/)![1]!
      for (let replay = 0; replay < 2; replay++) {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: 'image-1', prompt: 'an icon' }) })
        expect(response.status).toBe(200)
        expect(response.headers.get('x-image-billing-state')).toBe('pending')
        expect(response.headers.has('x-image-credits-micro')).toBe(false)
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8)
      }
      expect(calls).toBe(1)
      expect(billing.actions).not.toContain('release')
    } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
  }
})

test('native curl endpoint binds identity, returns PNG, rejects arbitrary parameters and browser origins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-access-'))
  let calls = 0
  const billing = fakeBilling()
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, loadConfig: async () => config, service })
  const url = access.instruction.match(/POST (http:\/\/\S+) with/)![1]!
  const body = JSON.stringify({ requestId: 'image-1', prompt: 'an icon' })
  const headers = { 'content-type': 'application/json' }
  try {
    expect(access.instruction).not.toContain(config.apiKey)
    expect(access.instruction).toContain('no manual maintenance is needed')
    expect(existsSync(join(root, 'assets/ai-generation-prompts.md'))).toBe(false)
    expect((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'http://evil.test' }, body })).status).toBe(404)
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ requestId: 'x', prompt: 'x', userId: 'other' }) })).status).toBe(400)
    const response = await fetch(url, { method: 'POST', headers, body })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-image-credits-micro')).toBe('7000')
    expect(response.headers.get('x-image-prompt-record')).toBe('recorded')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8)
    expect(calls).toBe(1)
    const document = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(document).toContain('"prompt": "an icon"')
    expect(document).toContain('"model": "test-model"')
    expect(document).toContain('image-returned')
    expect(document).not.toContain(config.apiKey)
    expect(document).not.toContain(url)
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})
