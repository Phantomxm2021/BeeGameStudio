import { test, expect, spyOn } from 'bun:test'
import { OpenRouterImageProvider } from './openrouter-provider'
import { imageConfigSchema } from './config'

test('upstream error logs preserve URL/status/message while redacting secrets and echoed content', async () => {
  const logged: unknown[] = []
  const spy = spyOn(console, 'info').mockImplementation((...args) => { logged.push(args) })
  const config = imageConfigSchema.parse({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/images', apiKey: 'private-key-for-test' })
  const prompt = 'private "art" request'
  let calls = 0
  try {
    const provider = new OpenRouterImageProvider(async () => {
      calls++
      return Response.json({
        error: { code: 'invalid_parameter', message: 'Unsupported size; ' + config.apiKey + ' ' + prompt, param: 'size' },
        request: { prompt }, api_key: 'another-secret', b64_json: 'private-image-content',
      }, { status: 400, headers: { 'x-request-id': 'req-test-1' } })
    })
    await expect(provider.generate(config, { prompt })).rejects.toMatchObject({ outcome: 'rejected', status: 400 })
    const output = JSON.stringify(logged)
    for (const secret of [config.apiKey, 'private-image-content', 'another-secret', 'private', 'art']) {
      expect(output).not.toContain(secret)
    }
    expect(output).toContain('Unsupported size')
    expect(output).toContain('invalid_parameter')
    expect(output).toContain('https://openrouter.ai/api/v1/images')
    expect(output).toContain('req-test-1')
    expect(output).toContain('"status":400')
    expect(calls).toBe(1)
  } finally { spy.mockRestore() }
})

test('non-JSON errors are logged, bounded and retain their HTTP classification', async () => {
  const logged: any[] = []
  const spy = spyOn(console, 'info').mockImplementation((...args) => { logged.push(args) })
  try {
    const provider = new OpenRouterImageProvider(async () => new Response('<html>Route not found</html>' + ' padding '.repeat(2000), { status: 404 }))
    await expect(provider.generate(imageConfigSchema.parse({ provider: 'openrouter', apiKey: 'test-key' }), { prompt: 'icon' })).rejects.toMatchObject({ status: 404, outcome: 'rejected' })
    expect(logged[0][1].body).toContain('Route not found')
    expect(logged[0][1].body.length).toBe(8192)
    expect(logged[0][1].truncated).toBe(true)
  } finally { spy.mockRestore() }
})
