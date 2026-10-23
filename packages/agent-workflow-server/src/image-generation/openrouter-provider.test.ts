import { expect, test } from 'bun:test'
import { createImageGenerationProvider } from './index'
import { imageConfigSchema } from './config'

test('OpenRouter uses its explicit endpoint and preserves raw supplier usage without inferring tokens', async () => {
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
