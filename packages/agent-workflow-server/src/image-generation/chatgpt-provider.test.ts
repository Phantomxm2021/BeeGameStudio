import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { getValidChatGPTAuth } from '../../../../src/services/api/openai/chatgptAuth'
import { CHATGPT_IMAGE_ENDPOINT, imageConfigSchema } from './config'
import { ChatGPTSubscriptionImageProvider } from './chatgpt-provider'
import { ImageAttemptStore } from './attempt'
import { ImageGenerationService } from './service'
import { openImageGenerationAccess } from './access'
import { loadPersonalImageConnection, savePersonalImageConnection } from './personal-connection'
import { createAgentWorkflowApp } from '../app'

const config = imageConfigSchema.parse({ baseUrl: CHATGPT_IMAGE_ENDPOINT, model: 'test-image-model', responseModel: 'test-response-model' })
const token = (name: string, exp = Math.floor(Date.now() / 1000) + 3600) =>
  'test.' + Buffer.from(JSON.stringify({ name, exp })).toString('base64url') + '.signature'
function login(directory: string, name: string, exp?: number) {
  mkdirSync(directory, { recursive: true })
  const value = { auth_mode: 'chatgpt', tokens: { access_token: token(name, exp), refresh_token: 'PRIVATE_REFRESH_' + name,
    id_token: 'PRIVATE_ID_' + name, account_id: 'account-' + name } }
  writeFileSync(join(directory, 'openai-chatgpt-auth.json'), JSON.stringify(value))
  return value
}
const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n'
const image = (encoded: string, id = 'image-one') => ({ type: 'image_generation_call', id, status: 'completed', result: encoded })
function response(encoded: string, options: { events?: unknown[]; terminal?: boolean; usage?: unknown; imageUsage?: unknown } = {}) {
  const item = image(encoded)
  const events = options.events ?? [
    { type: 'response.image_generation_call.partial_image', partial_image_b64: 'NOT_FINAL' },
    { type: 'response.output_item.done', output_index: 0, item: { ...item, ...(options.imageUsage ? { usage: options.imageUsage } : {}) } },
  ]
  return new Response(events.map(frame).join('') + (options.terminal === false ? '' :
    frame({ type: 'response.completed', response: { id: 'response-one', status: 'completed', output: [item], usage: options.usage } }))
    + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request-one',
      'x-codex-primary-used-percent': '12.5', 'x-codex-primary-window-minutes': '300',
      'x-codex-secondary-used-percent': 'not-a-number' } })
}
const png = () => sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer()

test('subscription stream reuses the selected local login, keeps final PNG and actual usage, and never sends API keys', async () => {
  const root = mkdtempSync(join(tmpdir(), 'subscription-image-'))
  const first = join(root, 'first'), second = join(root, 'second')
  const one = login(first, 'one'), two = login(second, 'two')
  const bytes = await png(), usage = { input_tokens: 17, output_tokens: 25, total_tokens: 42 }
  let calls = 0
  const request = (async (url, init) => {
    calls++
    expect(url).toBe(CHATGPT_IMAGE_ENDPOINT)
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer ' + one.tokens.access_token)
    expect(headers.get('ChatGPT-Account-Id')).toBe('account-one')
    expect(init?.redirect).toBe('error')
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: config.responseModel, stream: true, store: false,
      tool_choice: { type: 'image_generation' }, tools: [{ type: 'image_generation', model: config.model,
        partial_images: 0, output_format: 'png', background: 'transparent' }] })
    expect(JSON.stringify(body)).not.toContain(one.tokens.refresh_token)
    expect(JSON.stringify(body)).not.toContain(one.tokens.access_token)
    expect(JSON.stringify(body)).not.toContain(one.tokens.id_token)
    return response(bytes.toString('base64'), { usage, imageUsage: { output_tokens: 5 } })
  }) as typeof fetch
  try {
    const result = await new ChatGPTSubscriptionImageProvider(first, request).generate(config, { prompt: 'PRIVATE_PROMPT', background: 'transparent' })
    expect(result.bytes).toEqual(bytes)
    expect(result.usage).toEqual({ source: 'chatgpt-subscription', response: usage, image: { output_tokens: 5 },
      limits: { 'x-codex-primary-used-percent': 12.5, 'x-codex-primary-window-minutes': 300 } })
    expect(result.providerRequestId).toBe('request-one')
    expect(calls).toBe(1)
    expect(JSON.parse(readFileSync(join(second, 'openai-chatgpt-auth.json'), 'utf8'))).toEqual(two)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test.each([401, 403, 429, 500])('subscription HTTP %s is explicit, sanitized and not retried', async status => {
  const root = mkdtempSync(join(tmpdir(), 'subscription-http-'))
  login(root, 'one')
  let calls = 0
  try {
    const provider = new ChatGPTSubscriptionImageProvider(root, (async (_url, _init) => {
      calls++; return new Response('PRIVATE_PROMPT PRIVATE_TOKEN', { status })
    }) as typeof fetch)
    await expect(provider.generate(config, { prompt: 'PRIVATE_PROMPT' })).rejects.toMatchObject({ status,
      outcome: status === 500 ? 'unknown' : 'rejected',
      code: status === 429 ? 'subscription-limit' : status === 500 ? 'subscription-image-failed' : 'subscription-access-denied',
      message: 'Subscription image request was not delivered' })
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test.each(['eof', 'failed', 'incomplete', 'multiple', 'invalid', 'cancelled'] as const)('subscription %s is never a completed image or an automatic retry', async kind => {
  const root = mkdtempSync(join(tmpdir(), 'subscription-invalid-'))
  login(root, 'one')
  const encoded = (await png()).toString('base64')
  let calls = 0
  try {
    const provider = new ChatGPTSubscriptionImageProvider(root, (async (_url, _init) => {
      calls++
      if (kind === 'cancelled') throw new DOMException('PRIVATE_TOKEN', 'AbortError')
      if (kind === 'invalid') return response('not-valid-base64!')
      const events = [{ type: 'response.output_item.done', item: image(encoded) }]
      if (kind === 'failed' || kind === 'incomplete') events.push({ type: 'response.' + kind, item: undefined } as any)
      if (kind === 'multiple') events.push({ type: 'response.output_item.done', item: image(encoded, 'image-two') })
      return response(encoded, { events, terminal: kind !== 'eof' })
    }) as typeof fetch)
    await expect(provider.generate(config, { prompt: 'PRIVATE_PROMPT' })).rejects.toMatchObject({ outcome: 'unknown' })
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('explicit account directory never falls back to another account; refresh updates only its own login', async () => {
  const root = mkdtempSync(join(tmpdir(), 'subscription-login-'))
  const first = join(root, 'first'), second = join(root, 'second'), missing = join(root, 'missing')
  const one = login(first, 'one', 1), two = login(second, 'two')
  const previousFetch = globalThis.fetch
  const oldCodexHome = process.env.CODEX_HOME, oldScrub = process.env.BGS_SUBPROCESS_ENV_SCRUB
  // Even a regression must only encounter fake alternate-account credentials.
  process.env.CODEX_HOME = second
  delete process.env.BGS_SUBPROCESS_ENV_SCRUB
  writeFileSync(join(second, 'auth.json'), JSON.stringify(two))
  let refreshes = 0
  const fresh = token('renewed')
  globalThis.fetch = (async (url, init) => {
    refreshes++
    expect(url).toBe('https://auth.openai.com/oauth/token')
    expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe(one.tokens.refresh_token)
    return Response.json({ access_token: fresh, id_token: 'PRIVATE_NEW_ID' })
  }) as typeof fetch
  try {
    await expect(getValidChatGPTAuth(missing)).rejects.toThrow('not logged in')
    expect(refreshes).toBe(0)
    expect((await getValidChatGPTAuth(first)).accessToken).toBe(fresh)
    expect(refreshes).toBe(1)
    const saved = JSON.parse(readFileSync(join(first, 'openai-chatgpt-auth.json'), 'utf8'))
    expect(saved.tokens.refresh_token).toBe(one.tokens.refresh_token)
    expect(saved.tokens.account_id).toBe('account-one')
    expect(JSON.parse(readFileSync(join(second, 'openai-chatgpt-auth.json'), 'utf8'))).toEqual(two)
  } finally {
    globalThis.fetch = previousFetch
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldCodexHome
    if (oldScrub === undefined) delete process.env.BGS_SUBPROCESS_ENV_SCRUB; else process.env.BGS_SUBPROCESS_ENV_SCRUB = oldScrub
    rmSync(root, { recursive: true, force: true })
  }
})

test.each([429, 500])('subscription HTTP %s receipt survives restart without a second submission or wallet debit', async status => {
  const root = mkdtempSync(join(tmpdir(), 'subscription-recovery-'))
  const auth = join(root, 'login'), receipts = join(root, 'receipts')
  login(auth, 'one')
  let calls = 0, walletCalls = 0
  const provider = new ChatGPTSubscriptionImageProvider(auth, (async (_url, _init) => {
    calls++; return new Response('PRIVATE_TOKEN', { status })
  }) as typeof fetch)
  const make = () => new ImageGenerationService(new ImageAttemptStore(receipts, provider), {
    apply: async () => { walletCalls++; throw new Error('Unexpected wallet debit') },
  })
  const input = { ownerId: 'one', projectId: 'fixture', requestId: 'failed-once', config, request: { prompt: 'PRIVATE_PROMPT' } }
  try {
    for (let index = 0; index < 2; index++) {
      await expect(make().generate(input, 'chatgpt-subscription')).rejects.toMatchObject({
        reason: status === 429 ? 'rejected' : 'unknown', status, replayed: index === 1 })
    }
    expect(calls).toBe(1); expect(walletCalls).toBe(0)
    const receipt = readFileSync(join(receipts, readdirSync(receipts)[0]!, 'receipt.json'), 'utf8')
    expect(receipt).not.toContain('PRIVATE_')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('concurrent users of one shared login refresh an expired token once, and a failed refresh is not cached', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-login-refresh-'))
  login(root, 'shared', 1)
  const previousFetch = globalThis.fetch
  let calls = 0, fail = true
  const fresh = token('shared-new')
  globalThis.fetch = (async (_url, _init) => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 20))
    if (fail) return new Response('fixture failure', { status: 401 })
    return Response.json({ access_token: fresh, id_token: 'PRIVATE_NEW_ID' })
  }) as typeof fetch
  try {
    const rejected = await Promise.allSettled([getValidChatGPTAuth(root), getValidChatGPTAuth(root)])
    expect(rejected.every(result => result.status === 'rejected')).toBe(true)
    expect(calls).toBe(1)
    fail = false
    const renewed = await Promise.all([getValidChatGPTAuth(root), getValidChatGPTAuth(root)])
    expect(renewed.every(result => result.accessToken === fresh)).toBe(true)
    expect(calls).toBe(2)
  } finally { globalThis.fetch = previousFetch; rmSync(root, { recursive: true, force: true }) }
})

test('capability quote is read-only; subscription delivery/recovery preserves usage and never debits platform Credits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'subscription-delivery-'))
  const auth = join(root, 'account'), receipts = join(root, 'receipts'), workspace = join(root, 'fixture')
  login(auth, 'one'); mkdirSync(workspace)
  const bytes = await png(), usage = { input_tokens: 3, output_tokens: 7 }
  let calls = 0, walletCalls = 0
  const provider = new ChatGPTSubscriptionImageProvider(auth, (async (_url, _init) => {
    calls++; return response(bytes.toString('base64'), { usage })
  }) as typeof fetch)
  const make = () => new ImageGenerationService(new ImageAttemptStore(receipts, provider), {
    apply: async () => { walletCalls++; throw new Error('Subscription must not use platform billing') },
  })
  const service = make()
  const access = openImageGenerationAccess({ userId: 'one', projectId: 'fixture', workspacePath: workspace,
    source: 'chatgpt-subscription', loadConfig: async () => config, service })
  const request = { requestId: 'image-one', purpose: 'experiment', prompt: 'PRIVATE_PROMPT' }
  try {
    const quote = await fetch(access.endpoint)
    expect(await quote.json()).toMatchObject({ available: true, billingSource: 'subscription', maxRequestCredits: null,
      upstreamAvailability: 'unverified', dailyImagesRemaining: null })
    expect(calls).toBe(0); expect(walletCalls).toBe(0)
    for (let index = 0; index < 2; index++) {
      const delivered = await fetch(access.endpoint, { method: 'POST', body: JSON.stringify(request) })
      expect(delivered.status).toBe(200)
      expect(delivered.headers.get('x-image-billing-state')).toBe('subscription')
      expect(delivered.headers.has('x-image-credits-micro')).toBe(false)
      expect(Buffer.from(await delivered.arrayBuffer()).equals(bytes)).toBe(true)
    }
    const input = { ownerId: 'one', projectId: 'fixture', requestId: request.requestId, config, request: { prompt: request.prompt } }
    const restored = await make().generate(input, 'chatgpt-subscription')
    expect(restored.billingState).toBe('subscription'); expect(restored.chargedCreditsMicro).toBeNull()
    expect((restored.usage as any).response).toEqual(usage)
    await expect(make().generate({ ...input, config: { ...config, responseModel: 'different' } }, 'chatgpt-subscription')).rejects.toMatchObject({ reason: 'conflict' })
    expect(calls).toBe(1); expect(walletCalls).toBe(0)
    const receipt = readFileSync(join(receipts, readdirSync(receipts)[0]!, 'receipt.json'), 'utf8')
    expect(receipt).not.toContain('PRIVATE_'); expect(receipt).toContain('subscription')
  } finally { await access.close(); rmSync(root, { recursive: true, force: true }) }
})

test('subscription connection is backend-only, opt-in and cannot redirect OAuth to a provider URL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'subscription-connection-'))
  const previous = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString('base64')
  try {
    const first = join(root, 'first'), second = join(root, 'second')
    expect(loadPersonalImageConnection(first).source).toBe('platform')
    const result = savePersonalImageConnection(first, { source: 'chatgpt-subscription', model: config.model, responseModel: config.responseModel })
    expect(result).toMatchObject({ source: 'chatgpt-subscription', hasApiKey: false, model: config.model, responseModel: config.responseModel })
    expect(loadPersonalImageConnection(first).config.baseUrl).toBe(CHATGPT_IMAGE_ENDPOINT)
    expect(loadPersonalImageConnection(second).source).toBe('platform')
    expect(() => savePersonalImageConnection(first, { source: 'chatgpt-subscription', baseUrl: 'https://other.example' })).toThrow()
    expect(() => savePersonalImageConnection(first, { source: 'chatgpt-subscription', apiKey: 'PRIVATE_KEY' })).toThrow()
    const app = createAgentWorkflowApp({ dashboardDataRoot: root, defaultWorkspacePath: root, currentUser: { id: 'owner', role: 'viewer' } })
    const saved = await app.fetch(new Request('http://local/api/image-generation/connection', { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'chatgpt-subscription', model: config.model, responseModel: config.responseModel }) }))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ source: 'chatgpt-subscription', hasApiKey: false })
    const loaded = await app.fetch(new Request('http://local/api/image-generation/connection'))
    expect(await loaded.json()).toMatchObject({ source: 'chatgpt-subscription', responseModel: config.responseModel })
  } finally {
    if (previous === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = previous
    rmSync(root, { recursive: true, force: true })
  }
})
