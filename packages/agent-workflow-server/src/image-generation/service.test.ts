import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import type { ImageBillingClient, ImageBillingReceipt } from '@bee-game-studio/beegame-billing-core/image-billing'
import { ImageAttemptStore } from './attempt'
import { ImageGenerationService } from './service'
import { imageConfigSchema } from './config'
import { imageChargeCreditsMicro, fixedImageChargeCreditsMicro, CLOUDFLARE_INITIAL_FIXED_CREDITS } from './pricing'
import { ImageProviderError } from './provider'
import { openImageGenerationAccess } from './access'
import { ImageConfigurationError } from './runtime-config'
import { compileUiReferenceBoard } from './ui-reference-board.mjs'
import { writeBeeGameAssetManifest, type BeeGameAssetManifest } from '../beegame/asset-contracts'

test.each(['platform', 'byok'] as const)('resource intent rejects new incompatible requests before billing/provider and does not alter recovery: %s', async source => {
  const root = mkdtempSync(join(tmpdir(), 'image-resource-intent-'))
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(join(root,'host'), { generate: async (_config, request) => {
    calls++
    expect(request).not.toHaveProperty('purpose')
    expect(request).not.toHaveProperty('requirementIds')
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const manifest: BeeGameAssetManifest = { version: 9, resources: [], requirements: [
    { id: 'surface', acquisition_profile: { dimensions: ['3D'], asset_kinds: ['texture'], styles: [] } },
    { id: 'actor', acquisition_profile: { dimensions: ['3D'], asset_kinds: ['model'], styles: [], capabilities: ['rigged'] } },
    { id: 'licensed', acquisition_profile: { dimensions: ['2D'], asset_kinds: ['image'], styles: [],
      sourcing_policy: {allowed_source_kinds:['resource-library'],license_constraints:['licensed'],responsible_party:'author',handoff_criteria:['usable file']} } },
  ] }
  await writeBeeGameAssetManifest(root, manifest)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, source,
    loadConfig: async () => config, service })
  const send = (metadata: object) => fetch(access.endpoint, {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({requestId:'production',prompt:'Surface artwork',...metadata})})
  try {
    for (const metadata of [{}, {purpose:'production'}, {purpose:'production',requirementIds:['absent']},
      {purpose:'production',requirementIds:['actor']}, {purpose:'production',requirementIds:['licensed']},
      {purpose:'reference',requirementIds:['surface']}, {purpose:'experiment',requirementIds:['surface']}]) {
      const response = await send(metadata)
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({code:'resource-intent'})
    }
    expect(calls).toBe(0)
    expect(billing.actions).toEqual([])
    const valid = await send({purpose:'production',requirementIds:['surface']})
    expect(valid.status).toBe(200)
    const bytes = await valid.arrayBuffer()
    expect(calls).toBe(1)
    expect(readFileSync(join(root,'assets/ai-generation-prompts.md'),'utf8')).toContain('surface')
    // A changed Manifest and missing/new metadata cannot invalidate paid bytes.
    await writeBeeGameAssetManifest(root,{...manifest,requirements:[]})
    const recovered = await send({})
    expect(recovered.status).toBe(200)
    expect(await recovered.arrayBuffer()).toEqual(bytes)
    const rebound = await send({purpose:'production',requirementIds:['removed']})
    expect(rebound.status).toBe(200)
    await rebound.arrayBuffer()
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(source === 'byok' ? [] : ['reserve','settle','reserve','settle','reserve','settle'])
  } finally { await access.close(); rmSync(root,{recursive:true,force:true}) }
})

test('a pre-metadata paid receipt is recoverable through the new bridge', async () => {
  const root = mkdtempSync(join(tmpdir(),'image-legacy-intent-'))
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root,{generate:async()=>{
    calls++; return {bytes:await png(),model:config.model,mimeType:'image/png',usage}
  }}),billing.client)
  await service.generate(input) // Historical request: no resource-intent metadata.
  const access = openImageGenerationAccess({userId:'owner',projectId:'project',workspacePath:root,loadConfig:async()=>config,service})
  try {
    const response=await fetch(access.endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({requestId:input.requestId,prompt:input.request.prompt})})
    expect(response.status).toBe(200); await response.arrayBuffer()
    expect(calls).toBe(1)
  } finally { await access.close();rmSync(root,{recursive:true,force:true}) }
})

test('host compiles UI board before billing, records the actual prompt and rejects invalid inventory/orientation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-ui-board-'))
  const billing = fakeBilling(), received: unknown[] = []
  let configurations = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (_config, request) => {
    received.push(request)
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    screenOrientation: 'Landscape', requiredQuality: 'low', loadConfig: async () => { configurations++; return cloudflareConfig }, service })
  const input = { purpose: 'reference', requestId: 'ui-board', uiReference: { viewport: { width: 1280, height: 720 },
    style: 'Readable flat UI', screens: ['play', 'pause', 'result'].map(id => ({ id, description: `Full ${id} screen with HUD` })) } }
  const submit = (body: unknown) => fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    for (const body of [
      { ...input, prompt: 'custom collage' },
      { ...input, uiReference: { ...input.uiReference, viewport: { width: 720, height: 1280 } } },
      { ...input, uiReference: { ...input.uiReference, rows: 2 } },
      { ...input, uiReference: { ...input.uiReference, screens: [input.uiReference.screens[0], input.uiReference.screens[0]] } },
    ]) expect((await submit(body)).status).toBe(400)
    expect(received).toEqual([])
    expect(billing.actions).toEqual([])
    expect(configurations).toBe(0)
    const response = await submit(input)
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    const expected = compileUiReferenceBoard(input).request
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ prompt: expected.prompt, size: '1024x1536', quality: 'low', background: 'opaque' })
    expect(received[0]).not.toHaveProperty('uiReference')
    const record = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(record).toContain(JSON.stringify(expected.prompt))
    expect(billing.actions).toEqual(['reserve', 'settle'])
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('closing image access drains an in-flight paid outcome before workspace quiescence',async()=>{
  const root=mkdtempSync(join(tmpdir(),'image-access-drain-'))
  let release!:()=>void,entered!:()=>void
  const wait=new Promise<void>(r=>{release=r}),started=new Promise<void>(r=>{entered=r})
  const service=new ImageGenerationService(new ImageAttemptStore(root,{generate:async()=>{
    entered();await wait;return {bytes:await png(),model:config.model,mimeType:'image/png',usage}
  }}),fakeBilling().client)
  const access=openImageGenerationAccess({userId:'owner',projectId:'synthetic',workspacePath:root,loadConfig:async()=>config,service})
  try {
    const response=fetch(access.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'experiment',requestId:'one',prompt:'synthetic'})})
    await started
    let drained=false;const closing=access.close().then(()=>{drained=true})
    await Bun.sleep(20);expect(drained).toBe(false)
    release();expect((await response).status).toBe(200);await (await response).arrayBuffer();await closing
    expect(drained).toBe(true)
    expect(readFileSync(join(root,'assets/ai-generation-prompts.md'),'utf8')).toContain('image-returned')
    // Bun may retain a keep-alive socket; either connection refusal or the
    // closed capability's 404 is valid. Neither may initiate another call.
    const after=await fetch(access.endpoint).catch(()=>undefined)
    if(after)expect(after.status).toBe(404)
  }finally{release();await access.close();rmSync(root,{recursive:true,force:true})}
})

test('access exposes safe failure facts and identifies a replay without another upstream call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-error-access-'))
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++
    expect(readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')).toContain('request-received')
    throw new ImageProviderError('private upstream response with secret', 'unknown', 504, 'upstream-http')
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, loadConfig: async () => config, service })
  const url = access.endpoint
  try {
    const request = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'error-1', prompt: 'private prompt' }) })
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
    const url = access.endpoint
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'config-1', prompt: 'an icon' }) })
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
    const url = access.endpoint
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'write-1', prompt: 'an icon' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-image-prompt-record')).toBe('failed')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8)
    expect(calls).toBe(1)
    expect(existsSync(join(root, 'outside/ai-generation-prompts.md'))).toBe(false)
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})

const pricing = { model: 'test-model', version: 'test-v2', markupMultiplier: 1.5, textInputUsdPerMillion: 5,
  cachedTextInputUsdPerMillion: 1.25, imageInputUsdPerMillion: 8,
  cachedImageInputUsdPerMillion: 3, imageOutputUsdPerMillion: 30,
  maxRequestCredits: 2, projectBudgetCredits: 10 }
const config = imageConfigSchema.parse({ model: 'test-model', apiKey: 'secret', billing: pricing })

test('delivery image access keeps every generation at low quality', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-low-delivery-'))
  const qualities: Array<string | undefined> = []
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (_config, request) => {
    qualities.push(request.quality)
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), fakeBilling().client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    requiredQuality: 'low', loadConfig: async () => config, service })
  try {
    expect(await (await fetch(access.endpoint)).json()).toMatchObject({ quality: 'low' })
    expect((await fetch(`${access.endpoint}?quality=medium`)).status).toBe(200)
    expect(await (await fetch(`${access.endpoint}?quality=medium`)).json()).toMatchObject({ available: false })
    const rejected = await fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'wrong-quality', prompt: 'an icon', quality: 'medium' }) })
    expect(rejected.status).toBe(422)
    expect(qualities).toHaveLength(0)
    const accepted = await fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'low-quality', prompt: 'an icon' }) })
    expect(accepted.status).toBe(200)
    expect(qualities).toEqual(['low'])
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})
const usage = { input_tokens: 100, output_tokens: 200, total_tokens: 300,
  input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 200 } }
const input = { ownerId: 'owner', projectId: 'project', requestId: 'image-1', config, request: { prompt: 'an icon' } }
test('a renamed unresolved billing receipt blocks upstream work and exposes the original ID', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-unresolved-retry-'))
  let providerCalls = 0
  const actions: string[] = []
  const billing: ImageBillingClient = { async apply(_user, request) {
    actions.push(request.action)
    return { created: false, state: 'reserved', blockedByRequestId: 'original',
      reservedCreditsMicro: 100, chargedCreditsMicro: 0, metadata: {} }
  } }
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    providerCalls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => config, service })
  try {
    const response = await fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'renamed', prompt: 'an icon' }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'unresolved-image-request', requestId: 'renamed', recoveryRequestId: 'original' })
    expect(providerCalls).toBe(0)
    expect(actions).toEqual(['reserve'])
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})
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
  expect(imageChargeCreditsMicro(usage, pricing)).toBe(975000)
  expect(imageChargeCreditsMicro(usage, { ...pricing, markupMultiplier: 1 })).toBe(650000)
  expect(imageChargeCreditsMicro({ ...usage, input_tokens_details: { text_tokens: 100, image_tokens: 0,
    cached_text_tokens: 40, cached_image_tokens: 0 } }, pricing)).toBe(952500)
  const mixedUsage = { input_tokens: 200, output_tokens: 200, total_tokens: 400,
    input_tokens_details: { text_tokens: 100, image_tokens: 100,
      cached_text_tokens: 20, cached_image_tokens: 40 },
    output_tokens_details: { text_tokens: 0, image_tokens: 200 } }
  expect(imageChargeCreditsMicro(mixedUsage, pricing)).toBe(1053750)
  expect(imageChargeCreditsMicro(mixedUsage, { ...pricing, imageOutputUsdPerMillion: 40 })).toBe(1353750)
  expect(() => imageChargeCreditsMicro(null, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro({ ...usage, total_tokens: 0 }, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro({ ...usage, input_tokens_details: { ...usage.input_tokens_details, cached_tokens: 5 } }, pricing)).toThrow()
  expect(() => imageChargeCreditsMicro(usage, { ...pricing, maxRequestCredits: 0.000001 })).toThrow()
})

test('a reservation from before markup keeps its frozen 1x price', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-old-price-'))
  const { markupMultiplier: _markup, ...oldPricing } = pricing
  let charged = -1
  const billing: ImageBillingClient = { async apply(_owner, request) {
    if (request.action === 'reserve') return { created: true, state: 'reserved',
      reservedCreditsMicro: request.amountCreditsMicro, chargedCreditsMicro: 0,
      metadata: { pricing: oldPricing } }
    charged = request.amountCreditsMicro
    return { created: false, state: 'settled', reservedCreditsMicro: 2_000_000,
      chargedCreditsMicro: charged, metadata: { pricing: oldPricing } }
  } }
  try {
    const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => ({
      bytes: await png(), model: config.model, mimeType: 'image/png', usage,
    }) }), billing)
    const result = await service.generate(input)
    expect(result.chargedCreditsMicro).toBe(650000)
    expect(charged).toBe(650000)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const cloudflareConfig = imageConfigSchema.parse({ ...config, provider: 'cloudflare', billing: {
  ...pricing, maxRequestCredits: 20, projectBudgetCredits: 100,
  fixedCreditsByVariant: CLOUDFLARE_INITIAL_FIXED_CREDITS,
} })

test('configured Cloudflare prices cover exactly the approved low and medium variants', () => {
  const configured = cloudflareConfig.billing!
  for (const [variant, credits] of Object.entries(CLOUDFLARE_INITIAL_FIXED_CREDITS)) {
    const [quality, size] = variant.split(':')
    expect(fixedImageChargeCreditsMicro(configured, quality!, size!)).toBe(credits * 1_000_000)
  }
  expect(() => fixedImageChargeCreditsMicro(configured, 'high', '1024x1024')).toThrow()
})

test('Cloudflare settles a configured fixed price without token usage and rejects unpriced variants before billing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-cloudflare-fixed-'))
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, {
    generate: async () => { calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png' as const, usage: null } },
  }), billing.client)
  try {
    await expect(service.generate({ ...input, config: cloudflareConfig, request: { prompt: 'an icon', quality: 'high' } }))
      .rejects.toMatchObject({ stage: 'price-unavailable' })
    expect(billing.actions).toEqual([])
    const first = await service.generate({ ...input, config: cloudflareConfig })
    const recovered = await service.generate({ ...input, config: cloudflareConfig })
    expect(first.chargedCreditsMicro).toBe(8_000_000)
    expect(recovered.chargedCreditsMicro).toBe(8_000_000)
    expect(billing.actions).toEqual(['reserve', 'settle', 'reserve', 'settle'])
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
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
    expect(second.chargedCreditsMicro).toBe(975000)
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'settle', 'reserve', 'settle'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a paid request identity cannot be silently changed on replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-request-identity-'))
  const billing = fakeBilling()
  let calls = 0
  const provider = { generate: async () => {
    calls++
    return { bytes: await png(), model: config.model, mimeType: 'image/png' as const, usage }
  } }
  const service = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
  try {
    await service.generate(input)
    await service.generate(input)
    await expect(service.generate({ ...input, request: { ...input.request,
      prompt: 'different icon' } })).rejects.toMatchObject({ reason: 'conflict' })
    await expect(service.generate({ ...input, request: { ...input.request,
      background: 'transparent' as const } })).rejects.toMatchObject({ reason: 'conflict' })
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('reference images on other providers fail before any wallet reservation', async () => {
  const billing = fakeBilling()
  const service = new ImageGenerationService(new ImageAttemptStore('/unused-image-path', {
    generate: async () => { throw new Error('should not call provider') },
  }), billing.client)
  await expect(service.generate({ ...input, request: { prompt: 'icon',
    referenceImage: { bytes: await png(), sha256: 'a'.repeat(64), mimeType: 'image/png' } } }))
    .rejects.toMatchObject({ code: 'provider-unsupported' })
  expect(billing.actions).toEqual([])
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
      const url = access.endpoint
      for (let replay = 0; replay < 2; replay++) {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ purpose: 'experiment', requestId: 'image-1', prompt: 'an icon' }) })
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

test('image capability binds identity, reports cost without secrets, and rejects arbitrary parameters and browser origins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-access-'))
  let calls = 0
  const billing = fakeBilling()
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async () => {
    calls++; return { bytes: await png(), model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root, loadConfig: async () => config, service })
  const url = access.endpoint
  const body = JSON.stringify({ purpose: 'experiment', requestId: 'image-1', prompt: 'an icon' })
  const headers = { 'content-type': 'application/json' }
  try {
    expect(access.instruction).not.toContain(config.apiKey)
    expect(access.instruction).toContain('no manual maintenance is needed')
    expect(access.instruction).not.toContain(url)
    expect(await (await fetch(url)).json()).toMatchObject({ available: true,
      quality: 'medium', size: '1024x1024', maxRequestCredits: 2,
      creditFaceValuePerUsd: 100, modelPriceMultiplier: 1.5 })
    expect(await (await fetch(url)).text()).not.toContain(config.apiKey)
    expect(existsSync(join(root, 'assets/ai-generation-prompts.md'))).toBe(false)
    expect((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'http://evil.test' }, body })).status).toBe(404)
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ purpose: 'experiment', requestId: 'x', prompt: 'x', userId: 'other' }) })).status).toBe(400)
    const response = await fetch(url, { method: 'POST', headers, body })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-image-credits-micro')).toBe('975000')
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

test('Cloudflare reference request reads only a project image before billing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-reference-access-'))
  mkdirSync(join(root, 'assets/generated'), { recursive: true })
  const image = await png()
  writeFileSync(join(root, 'assets/generated/board.png'), image)
  const billing = fakeBilling()
  let calls = 0
  const service = new ImageGenerationService(new ImageAttemptStore(root, { generate: async (_config, request) => {
    calls++
    expect(request.referenceImage?.bytes).toEqual(image)
    return { bytes: image, model: config.model, mimeType: 'image/png', usage }
  } }), billing.client)
  const access = openImageGenerationAccess({ userId: 'owner', projectId: 'project', workspacePath: root,
    loadConfig: async () => cloudflareConfig, service })
  try {
    expect(await (await fetch(access.endpoint)).json()).toMatchObject({ referenceImageSupported: true,
      provider: 'cloudflare',
      available: true, quotedCreditsMicro: 8_000_000,
      availableSizes: ['1024x1024', '1024x1536', '1536x1024'] })
    expect(await (await fetch(access.endpoint + '?quality=low&size=1536x1024')).json()).toMatchObject({
      available: true, quality: 'low', size: '1536x1024', quotedCreditsMicro: 4_000_000,
    })
    expect(await (await fetch(access.endpoint + '?quality=high')).json()).toMatchObject({
      available: false, quotedCreditsMicro: null,
    })
    const send = (requestId: string, referenceImagePath: string) => fetch(access.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId, prompt: 'matching UI elements', referenceImagePath }),
    })
    const denied = await send('denied', '../secret.png')
    expect(denied.status).toBe(400)
    expect((await denied.json() as any).code).toBe('path')
    expect(billing.actions).toEqual([])
    const accepted = await send('board-1', 'assets/generated/board.png')
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('x-image-credits-micro')).toBe('8000000')
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'settle'])
    expect(readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8'))
      .toContain('assets/generated/board.png')
  } finally { access.close(); rmSync(root, { recursive: true, force: true }) }
})
