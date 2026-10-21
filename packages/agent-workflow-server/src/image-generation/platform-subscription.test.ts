import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { ImageBillingClient, ImageBillingReceipt } from '@bee-game-studio/beegame-billing-core/image-billing'
import { createAgentWorkflowApp } from '../app'
import { getUserDashboardDataRoot } from '../local-runtime-service'
import { writeProjectAssetCommand } from '../beegame/project-asset-command'
import { CHATGPT_IMAGE_ENDPOINT, imageConfigSchema } from './config'
import { loadLocalImageConfig, saveLocalImageConfig } from './config-store'
import { loadRuntimeImageConfig } from './runtime-config'
import { savePersonalImageConnection } from './personal-connection'
import { createHostedImageGenerationProvider } from './index'
import { ImageAttemptStore } from './attempt'
import { ImageGenerationService } from './service'
import { openImageGenerationAccess } from './access'
import { getValidChatGPTAuth } from '../bgs/auth'

const config = imageConfigSchema.parse({ provider: 'chatgpt-subscription', baseUrl: CHATGPT_IMAGE_ENDPOINT,
  subscriptionOwnerId: 'administrator', model: 'fixture-image', responseModel: 'fixture-response',
  billing: { model: 'fixture-image', version: 'fixture-fixed', markupMultiplier: 1,
    textInputUsdPerMillion: 0, cachedTextInputUsdPerMillion: 0, imageInputUsdPerMillion: 0,
    cachedImageInputUsdPerMillion: 0, imageOutputUsdPerMillion: 0,
    maxRequestCredits: 20, projectBudgetCredits: 100,
    fixedCreditsByVariant: { 'medium:1024x1024': 3 } } })
function login(root: string, owner: string) {
  const directory = join(getUserDashboardDataRoot(root, owner), '.runtime/app')
  mkdirSync(join(directory, 'bgs'), { recursive: true })
  const token = 'fixture.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.' + owner
  writeFileSync(join(directory, 'bgs', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: {
    access_token: token, refresh_token: 'PRIVATE_REFRESH_' + owner, id_token: 'PRIVATE_ID_' + owner, account_id: 'account-' + owner } }))
  return token
}
function wallet() {
  const receipts = new Map<string, ImageBillingReceipt>()
  const actions: Array<{ user: string; action: string; amount: number }> = []
  const client: ImageBillingClient = { async apply(user, request) {
    actions.push({ user, action: request.action, amount: request.amountCreditsMicro })
    const id = JSON.stringify([user, request.projectId, request.requestId]), previous = receipts.get(id)
    if (request.action === 'reserve' && previous) return { ...previous, created: false }
    const receipt: ImageBillingReceipt = request.action === 'reserve'
      ? { created: true, state: 'reserved', reservedCreditsMicro: request.amountCreditsMicro, chargedCreditsMicro: 0, metadata: request.metadata! }
      : { ...previous!, created: false, state: request.action === 'settle' ? 'settled' : 'released', chargedCreditsMicro: request.amountCreditsMicro }
    receipts.set(id, receipt)
    return receipt
  } }
  return { client, actions, receipts }
}
const bytes = () => sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer()
function stream(png: Buffer) {
  return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed',
    output: [{ type: 'image_generation_call', id: 'image', status: 'completed', result: png.toString('base64') }],
    usage: { input_tokens: 10, output_tokens: 20 } } }) + '\n\ndata: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream', 'x-codex-primary-used-percent': '25' } })
}

test('only platform administrator can bind their own existing login; other profiles and credentials remain private', async () => {
  const root = mkdtempSync(join(tmpdir(), 'platform-image-settings-'))
  const oldKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString('base64')
  const create = (id: string, role: 'owner' | 'viewer') => createAgentWorkflowApp({ defaultWorkspacePath: root,
    dashboardDataRoot: root, currentUser: { id, role } })
  const put = (app: ReturnType<typeof create>, body: unknown) => app.fetch(new Request('http://local/api/image-generation/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  try {
    const admin = create('administrator', 'owner'), member = create('member', 'viewer'), other = create('other-admin', 'owner')
    expect((await put(member, config)).status).toBe(403)
    expect((await put(admin, config)).status).toBe(400)
    await put(admin, { provider: 'openai', apiKey: 'PRIVATE_OLD_API_KEY' })
    login(root, 'administrator'); login(root, 'member')
    const saved = await put(admin, { ...config, subscriptionOwnerId: 'member' })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ provider: 'chatgpt-subscription', subscriptionConnected: true, hasApiKey: false })
    expect(loadLocalImageConfig(root).subscriptionOwnerId).toBe('administrator')
    const publicConfig = await (await admin.fetch(new Request('http://local/api/image-generation/settings'))).text()
    expect(publicConfig).not.toContain('subscriptionOwnerId')
    expect(publicConfig).not.toContain('PRIVATE_')
    expect(await (await other.fetch(new Request('http://local/api/image-generation/settings'))).json()).toMatchObject({ subscriptionConnected: false })
    expect((await put(other, config)).status).toBe(400)
    for (const patch of [{ baseUrl: 'https://other.example/responses' }, { apiKey: 'key' }, { responseModel: '' }])
      expect((await put(admin, { ...config, ...patch })).status).not.toBe(200)
    const original = await (await admin.fetch(new Request('http://local/api/image-generation/settings?provider=openai'))).json()
    expect(original).toMatchObject({ hasApiKey: true })
    expect(loadLocalImageConfig(root).provider).toBe('chatgpt-subscription')
    expect(() => savePersonalImageConnection(getUserDashboardDataRoot(root, 'member'), {
      source: 'byok', provider: 'chatgpt-subscription', apiKey: 'key' })).toThrow()
    expect((await member.fetch(new Request('http://local/api/image-generation/settings'))).status).toBe(403)
  } finally {
    if (oldKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = oldKey
    rmSync(root, { recursive: true, force: true })
  }
})

test('local and service-backed platform config require the designated login, never the requesting member account', async () => {
  const root = mkdtempSync(join(tmpdir(), 'platform-image-runtime-'))
  try {
    saveLocalImageConfig(root, config)
    login(root, 'member')
    const billing = { mode: 'remote' as const, usageBillingMode: 'realtime' as const, remoteApiBaseUrl: 'https://fixture.service', creditControlToken: 'fixture' }
    await expect(loadRuntimeImageConfig(root, { remote: false, billing })).rejects.toMatchObject({ code: 'subscription-login-unavailable' })
    login(root, 'administrator')
    expect(await loadRuntimeImageConfig(root, { remote: false, billing })).toEqual(config)
    const remote = await loadRuntimeImageConfig(root, { remote: true, billing }, async () => Response.json({ rowExists: true, config }))
    expect(remote).toEqual(config)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('shared login generates once per user, charges each user the frozen fixed price, and retains actual usage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'platform-image-wallet-')), billing = wallet(), png = await bytes()
  const administrator = login(root, 'administrator')
  login(root, 'member-one'); login(root, 'member-two')
  let calls = 0
  const provider = createHostedImageGenerationProvider(root, (async (url, init) => {
    calls++
    expect(url).toBe(CHATGPT_IMAGE_ENDPOINT)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + administrator)
    return stream(png)
  }) as typeof fetch)
  const make = () => new ImageGenerationService(new ImageAttemptStore(join(root, 'attempts'), provider), billing.client)
  try {
    for (const ownerId of ['member-one', 'member-two']) {
      const input = { ownerId, projectId: 'fixture', requestId: 'same-request-id', config, request: { prompt: 'fixture artwork' } }
      const first = await make().generate(input)
      expect(first.billingState).toBe('settled'); expect(first.chargedCreditsMicro).toBe(3e6)
      expect(first.usage).toMatchObject({ response: { input_tokens: 10 }, limits: { 'x-codex-primary-used-percent': 25 } })
      const changedPrice = { ...config, billing: { ...config.billing!, fixedCreditsByVariant: { 'medium:1024x1024': 9 } } }
      const recovered = await make().generate({ ...input, config: changedPrice })
      expect(recovered.bytes).toEqual(png); expect(recovered.chargedCreditsMicro).toBe(3e6)
      await expect(make().generate({ ...input, config: { ...config, subscriptionOwnerId: 'member-one' } })).rejects.toMatchObject({ reason: 'conflict' })
    }
    expect(calls).toBe(2)
    expect(billing.actions.every(action => action.user.startsWith('member-'))).toBe(true)
    expect(billing.actions.filter(action => action.action === 'settle').every(action => action.amount === 3e6)).toBe(true)
    const receipts = readdirSync(join(root, 'attempts')).map(id => readFileSync(join(root, 'attempts', id, 'receipt.json'), 'utf8')).join('')
    expect(receipts).not.toContain(administrator); expect(receipts).not.toContain('PRIVATE_')
    await expect(make().generate({ ownerId: 'member', projectId: 'fixture', requestId: 'unpriced', config,
      request: { prompt: 'fixture', quality: 'high' } })).rejects.toMatchObject({ stage: 'price-unavailable' })
    expect(calls).toBe(2)
    unlinkSync(join(getUserDashboardDataRoot(root, 'administrator'), '.runtime/app/bgs/auth.json'))
    await expect(provider.generate(config, { prompt: 'fixture' }, { ownerId: 'member-one', source: 'platform' }))
      .rejects.toMatchObject({ outcome: 'rejected', code: 'subscription-login-unavailable' })
    expect(calls).toBe(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test.each([429, 500])('shared upstream HTTP %s has durable failure receipts, correct holds and no resubmission', async status => {
  const root = mkdtempSync(join(tmpdir(), 'platform-image-failure-')), billing = wallet()
  login(root, 'administrator')
  let calls = 0
  const provider = createHostedImageGenerationProvider(root, (async (_url, _init) => { calls++; return new Response('PRIVATE_', { status }) }) as typeof fetch)
  const make = () => new ImageGenerationService(new ImageAttemptStore(join(root, 'attempts'), provider), billing.client)
  const input = { ownerId: 'member', projectId: 'fixture', requestId: 'failed', config, request: { prompt: 'fixture' } }
  try {
    await expect(make().generate(input)).rejects.toMatchObject({ reason: status === 429 ? 'rejected' : 'unknown' })
    await expect(make().generate(input)).rejects.toThrow()
    expect(calls).toBe(1)
    expect(billing.actions.some(action => action.action === 'release')).toBe(status === 429)
    expect(billing.actions.some(action => action.action === 'settle')).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('shared capability quotes fixed Credits without exposing administrator identity or credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'platform-image-capability-')), billing = wallet(), png = await bytes()
  login(root, 'administrator')
  let calls = 0
  const provider = createHostedImageGenerationProvider(root, (async (_url, _init) => { calls++; return stream(png) }) as typeof fetch)
  const access = openImageGenerationAccess({ userId: 'member', projectId: 'fixture', workspacePath: root,
    source: 'platform', loadConfig: async () => config,
    service: new ImageGenerationService(new ImageAttemptStore(join(root, 'attempts'), provider), billing.client) })
  try {
    const quote = await (await fetch(access.endpoint)).json()
    expect(quote).toMatchObject({ available: true, quotedCreditsMicro: 3e6, billingSource: 'platform',
      upstreamQuotaSource: 'platform-subscription', upstreamAvailability: 'unverified', dailyImagesRemaining: null })
    expect(JSON.stringify(quote)).not.toContain('administrator'); expect(calls).toBe(0)
    expect(await (await fetch(access.endpoint + '?quality=high')).json()).toMatchObject({ available: false, quotedCreditsMicro: null })
    const result = await fetch(access.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'experiment', requestId: 'shared', prompt: 'fixture' }) })
    expect(result.status).toBe(200); expect(result.headers.get('x-image-credits-micro')).toBe('3000000')
    expect(result.headers.get('x-image-billing-state')).toBe('settled'); expect(Buffer.from(await result.arrayBuffer()).equals(png)).toBe(true)
    expect(calls).toBe(1)
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('asset CLI shows the shared fixed price and refuses a missing quote before submission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'platform-image-cli-')), png = await bytes()
  let calls = 0, price: number | null = null
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET') return Response.json({ provider: 'chatgpt-subscription', billingSource: 'platform', available: true, quotedCreditsMicro: price })
    calls++
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'x-image-credits-micro': String(price) } })
  } })
  try {
    const script = join(root, 'assets.mjs'), input = join(root, 'request.json')
    await writeProjectAssetCommand(script, { imageEndpoint: `http://127.0.0.1:${server.port}/generate` })
    writeFileSync(input, JSON.stringify({ purpose: 'experiment', requestId: 'fixture', prompt: 'fixture' }))
    const run = async (output: string) => {
      const child = Bun.spawn([process.execPath, script, 'generate', input, output], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, stdout, stderr }
    }
    const missing = await run('assets/missing.png')
    expect(missing.code).not.toBe(0); expect(missing.stderr).toContain('no fixed Credit price'); expect(calls).toBe(0)
    price = 3e6
    const generated = await run('assets/output.png')
    expect(generated.code).toBe(0); expect(generated.stderr).toContain('Image price: 3 Credits')
    expect(calls).toBe(1); expect(readFileSync(join(root, 'assets/output.png')).equals(png)).toBe(true)
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }) }
})
