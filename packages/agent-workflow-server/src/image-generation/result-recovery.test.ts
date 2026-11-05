import { expect, spyOn, test } from 'bun:test'
import { readdirSync, readFileSync, rmSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { createHostedImageGenerationProvider } from './index'
import { ImageAttemptStore } from './attempt'
import { ImageGenerationService } from './service'
import { createImageResultRequest } from './image-result-network'
import { imageConfigSchema } from './config'
import { CLOUDFLARE_INITIAL_FIXED_CREDITS } from './pricing'
import { ImageProviderError, type ImageGenerationProvider, type ImageResult } from './provider'
import type { ImageBillingClient, ImageBillingReceipt } from '@bee-game-studio/beegame-billing-core/image-billing'

const resultUrl = 'https://ai-gateway-outputs.example.test/result.png?signature=do-not-log'
const pricing = {
  model: 'openai/gpt-image-2.5-flare', version: 'test', markupMultiplier: 1,
  textInputUsdPerMillion: 1, cachedTextInputUsdPerMillion: 1,
  imageInputUsdPerMillion: 1, cachedImageInputUsdPerMillion: 1,
  imageOutputUsdPerMillion: 1, maxRequestCredits: 20, projectBudgetCredits: 100,
  fixedCreditsByVariant: CLOUDFLARE_INITIAL_FIXED_CREDITS,
}
const config = imageConfigSchema.parse({
  provider: 'cloudflare', model: pricing.model, apiKey: 'test-secret',
  baseUrl: 'https://api.example.test/ai/run', quality: 'low', size: '1024x1024',
  billing: pricing,
})

async function png() {
  return Buffer.from(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#f0b429' } }).png().toBuffer())
}

function wallet() {
  let receipt: ImageBillingReceipt | undefined
  const actions: Array<'reserve' | 'settle' | 'release'> = []
  const client: ImageBillingClient = {
    async apply(_user, input) {
      actions.push(input.action)
      if (input.action === 'reserve') {
        if (receipt) return { ...receipt, created: false }
        return receipt = {
          created: true, state: 'reserved', reservedCreditsMicro: input.amountCreditsMicro,
          chargedCreditsMicro: 0, metadata: input.metadata ?? {},
        }
      }
      if (!receipt) throw new Error('reservation missing')
      if (input.action === 'settle') {
        return receipt = { ...receipt, created: false, state: 'settled', chargedCreditsMicro: input.amountCreditsMicro }
      }
      return receipt = { ...receipt, created: false, state: 'released', chargedCreditsMicro: 0 }
    },
  }
  return { client, actions }
}

function input() {
  return {
    ownerId: 'owner', projectId: 'recovery-project', requestId: 'result-1', config,
    request: { prompt: 'a paper-cut forest creature', quality: 'low' as const, size: '1024x1024' as const },
  }
}

test('completed Cloudflare output recovers through the safe downloader without a second POST', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-result-recovery-'))
  const bytes = await png()
  let posts = 0
  let gets = 0
  let failFirstGet = true
  let publicDns = true
  const warnings: unknown[] = []
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args) })
  const infoSpy = spyOn(console, 'info').mockImplementation((...args) => { warnings.push(args) })
  const request = (async (url: string, init?: RequestInit) => {
    if (url === config.baseUrl) {
      posts++
      return Response.json({
        result: { state: 'Completed', result: { image: resultUrl } },
        usage: null,
      })
    }
    gets++
    if (failFirstGet) {
      failFirstGet = false
      const saved = JSON.parse(readFileSync(join(root, readdirSync(root)[0]!, 'receipt.json'), 'utf8'))
      expect(saved.state).toBe('pending')
      expect(saved.reference.url).toBe(resultUrl)
      throw new Error('connection reset')
    }
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
  }) as typeof fetch
  const resultRequest = createImageResultRequest({ baseFetch: request,
    dns: { resolve4: async () => publicDns ? ['93.184.216.34'] : ['10.0.0.7'], resolve6: async () => [] } })
  const provider = createHostedImageGenerationProvider(root, request, resultRequest)
  const billing = wallet()
  try {
    const firstService = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
    const failure = await firstService.generate(input()).catch(error => error)
    expect(failure).toMatchObject({ reason: 'unknown', code: 'image-download-network' })
    expect(JSON.stringify(failure)).not.toContain(resultUrl)
    expect(posts).toBe(1)
    expect(gets).toBe(1)
    expect(billing.actions).toEqual(['reserve'])

    const receiptDirectory = readdirSync(root)[0]!
    const receiptPath = join(root, receiptDirectory, 'receipt.json')
    const receipt = readFileSync(receiptPath, 'utf8')
    expect(statSync(receiptPath).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, receiptDirectory)).mode & 0o777).toBe(0o700)
    // The URL is needed for a host-only recovery, but must not enter logs or
    // the user-facing ImageAttemptError/diagnostic record.
    expect(receipt).toContain(resultUrl)
    expect(receipt).not.toContain(config.apiKey)
    expect(receipt).not.toContain('a paper-cut forest creature')
    expect(JSON.stringify(warnings)).not.toContain(resultUrl)

    publicDns = false
    const blocked = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
    await expect(blocked.generate(input())).rejects.toMatchObject({ reason: 'unknown', code: 'image-url-not-permitted' })
    expect(posts).toBe(1)
    expect(gets).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'reserve'])

    publicDns = true
    const secondService = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
    const recovered = await secondService.generate(input())
    expect(recovered.billingState).toBe('settled')
    expect(recovered.chargedCreditsMicro).toBe(3_000_000)
    expect(Buffer.from(recovered.bytes)).toEqual(bytes)
    expect(posts).toBe(1)
    expect(gets).toBe(2)
    expect(billing.actions).toEqual(['reserve', 'reserve', 'reserve', 'settle'])
    expect(JSON.stringify(recovered)).not.toContain(resultUrl)

    const thirdService = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
    const replayed = await thirdService.generate(input())
    expect(Buffer.from(replayed.bytes)).toEqual(bytes)
    expect(posts).toBe(1)
    expect(gets).toBe(2)
    expect(billing.actions).toEqual(['reserve', 'reserve', 'reserve', 'settle', 'reserve', 'settle'])
    const finalReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    expect(finalReceipt.state).toBe('received')
    // Successful recovery removes the bearer URL from the durable receipt.
    expect(JSON.stringify(finalReceipt)).not.toContain(resultUrl)
  } finally {
    warnSpy.mockRestore()
    infoSpy.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})

test.each(['network-error', 'request-aborted'])('unknown %s receipt without a result reference remains non-retryable after restart', async code => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-result-no-reference-'))
  const billing = wallet()
  let calls = 0
  const failure = new ImageProviderError('upstream outcome unknown', 'unknown', undefined, code)
  const provider: ImageGenerationProvider = {
    async generate(): Promise<ImageResult> {
      calls++
      throw failure
    },
  }
  const first = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
  try {
    await expect(first.generate(input())).rejects.toMatchObject({ reason: 'unknown', code })
    const receipt = JSON.parse(readFileSync(join(root, readdirSync(root)[0]!, 'receipt.json'), 'utf8'))
    expect(receipt).toMatchObject({ state: 'unknown', code, diagnosticId: failure.diagnosticId })
    const second = new ImageGenerationService(new ImageAttemptStore(root, provider), billing.client)
    await expect(second.generate(input())).rejects.toMatchObject({ reason: 'unknown', code, diagnosticId: receipt.diagnosticId, replayed: true })
    expect(calls).toBe(1)
    expect(billing.actions).toEqual(['reserve', 'reserve'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

