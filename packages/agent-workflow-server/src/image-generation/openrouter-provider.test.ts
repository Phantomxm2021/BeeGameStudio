import { expect, test } from 'bun:test'
import { createImageGenerationProvider } from './index'
import { imageConfigSchema } from './config'
import { imageChargeCreditsMicro } from './pricing'

test('OpenRouter uses its explicit endpoint and preserves actual supplier cost', async () => {
  for (const baseUrl of ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/images/']) {
    let calls = 0
    const provider = createImageGenerationProvider('openrouter', async (url, init) => {
      calls++
      expect(url).toBe(baseUrl)
      expect(JSON.parse(String(init.body)).n).toBe(1)
      return Response.json({ data: [{ b64_json: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') }], usage: { cost: 0.042 } })
    })
    const result = await provider.generate(imageConfigSchema.parse({ provider: 'openrouter', baseUrl, apiKey: 'test-key' }), { prompt: 'icon' })
    expect(result.usage).toEqual({ cost: 0.042 })
    expect(calls).toBe(1)
  }
})

test('supplier USD cost converts exactly; unknown costs never become free', () => {
  const pricing = { model: 'test', version: 'test', creditsPerUsd: 100, textInputCreditsPerMillion: 0, imageInputCreditsPerMillion: 0, textOutputCreditsPerMillion: 0, imageOutputCreditsPerMillion: 0, maxRequestCredits: 100, projectBudgetCredits: 100 }
  expect(imageChargeCreditsMicro({ cost: 0.042 }, pricing)).toBe(4200000)
  expect(imageChargeCreditsMicro({ cost: 1e-9 }, pricing)).toBe(1)
  expect(imageChargeCreditsMicro({ cost: 0 }, pricing)).toBe(0)
  for (const usage of [{}, { cost: null }, { cost: -1 }, { cost: '0.04' }, { cost: 2 }]) {
    expect(() => imageChargeCreditsMicro(usage, pricing)).toThrow()
  }
})
