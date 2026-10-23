import { expect, test } from 'bun:test'
import { resolveApprovedOutboundTarget } from '@bee-game-studio/security-core'
import { defaultImageConfig } from './config'
import { CloudflareImageProvider } from './cloudflare-provider'
import { createImageResultRequest } from './image-result-network'
import { ImageProviderError } from './provider'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const config = {
  ...defaultImageConfig('cloudflare'),
  apiKey: 'cloudflare-token',
  baseUrl: 'https://api.example.test/ai/run',
}

const publicResolverOptions = {
  allowedHosts: ['cdn.example.test'],
  resolve4: async (hostname: string) =>
    ['cdn.example.test', 'unapproved.example.test'].includes(hostname)
      ? ['93.184.216.34']
      : [],
  resolve6: async () => [],
}

function generateWithResultUrl(
  resultUrl: string,
  options: Parameters<typeof createImageResultRequest>[0] = {
    resolveOutboundTarget: resolveApprovedOutboundTarget,
    outboundTargetPolicyOptions: publicResolverOptions,
  },
  resultResponse: Response = new Response(PNG, { headers: { 'content-type': 'image/png' } }),
  signal?: AbortSignal,
) {
  const calls: string[] = []
  let resultInit: RequestInit | undefined
  const baseFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    if (url === config.baseUrl)
      return Response.json({ result: { state: 'Completed', result: { image: resultUrl } } })
    resultInit = init
    if (init?.signal?.aborted) throw new Error('result request cancelled')
    return resultResponse
  }) as typeof fetch
  const resultRequest = createImageResultRequest({ ...options, baseFetch })
  const provider = new CloudflareImageProvider(baseFetch, resultRequest)
  return provider.generate(config, { prompt: 'icon', signal }).then(
    result => ({ result, error: undefined, calls, resultInit }),
    error => ({ result: undefined, error, calls, resultInit }),
  )
}

test('Cloudflare result downloads use the production approved target and pinned dispatcher', async () => {
  const output = await generateWithResultUrl('https://cdn.example.test/result.png')
  expect(output.result?.bytes).toEqual(PNG)
  expect(output.calls).toEqual([config.baseUrl, 'https://cdn.example.test/result.png'])
  expect(output.resultInit?.redirect).toBe('error')
  expect((output.resultInit as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined()
  expect(new Headers(output.resultInit?.headers).get('authorization')).toBeNull()
})

test('Cloudflare rejects private DNS and unapproved result URLs before downloading', async () => {
  const privateDnsOptions = {
    allowedHosts: ['private.example.test'],
    resolve4: async (hostname: string) => hostname === 'private.example.test' ? ['10.0.0.7'] : [],
    resolve6: async () => [],
  }
  for (const [resultUrl, options] of [
    ['https://private.example.test/internal.png', privateDnsOptions],
    ['https://127.0.0.1/internal.png', publicResolverOptions],
    ['https://unapproved.example.test/result.png', publicResolverOptions],
  ] as const) {
    const output = await generateWithResultUrl(resultUrl, {
      resolveOutboundTarget: resolveApprovedOutboundTarget,
      outboundTargetPolicyOptions: options,
    })
    expect(output.error).toBeInstanceOf(ImageProviderError)
    expect(output.error).toMatchObject({ outcome: 'unknown', code: 'image-url-not-permitted' })
    expect(output.calls).toEqual([config.baseUrl])
  }
})

test('Cloudflare result downloads do not follow redirects', async () => {
  const output = await generateWithResultUrl(
    'https://cdn.example.test/result.png',
    undefined,
    new Response(null, { status: 302, headers: { location: 'https://unapproved.example.test/other.png' } }),
  )
  expect(output.error).toBeInstanceOf(ImageProviderError)
  expect(output.error).toMatchObject({ outcome: 'unknown', code: 'image-download-http' })
  expect(output.resultInit?.redirect).toBe('error')
})

test('Cloudflare result cancellation remains unknown and makes no retry', async () => {
  const controller = new AbortController()
  controller.abort()
  const output = await generateWithResultUrl(
    'https://cdn.example.test/result.png',
    undefined,
    undefined,
    controller.signal,
  )
  expect(output.error).toMatchObject({ outcome: 'unknown', code: 'image-download-network' })
  expect(output.calls).toEqual([config.baseUrl, 'https://cdn.example.test/result.png'])
})

test('Cloudflare refuses result downloads when the safe downloader is not injected', async () => {
  let calls = 0
  const request = async () => {
    calls++
    return Response.json({ result: { state: 'Completed', result: { image: 'https://cdn.example.test/result.png' } } })
  }
  let error: unknown
  try {
    await new CloudflareImageProvider(request).generate(config, { prompt: 'icon' })
  } catch (caught) {
    error = caught
  }
  expect(error).toMatchObject({ outcome: 'rejected', code: 'image-result-downloader-unconfigured' })
  expect(calls).toBe(0)
})
