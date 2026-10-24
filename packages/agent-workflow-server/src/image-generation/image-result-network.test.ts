import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  resolve4: async (hostname: string) =>
    ['cdn.example.test', 'unapproved.example.test'].includes(hostname)
      ? ['93.184.216.34']
      : [],
  resolve6: async () => [],
}

function generateWithResultUrl(
  resultUrl: string,
  options: Parameters<typeof createImageResultRequest>[0] = {
    dns: publicResolverOptions,
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

test('Cloudflare rejects private DNS and internal result URLs before downloading', async () => {
  const privateDnsOptions = {
    resolve4: async (hostname: string) => hostname === 'private.example.test' ? ['10.0.0.7'] : [],
    resolve6: async () => [],
  }
  for (const [resultUrl, options] of [
    ['https://private.example.test/internal.png', privateDnsOptions],
    ['https://127.0.0.1/internal.png', publicResolverOptions],
    ['https://169.254.169.254/internal.png', publicResolverOptions],
    ['https://[::1]/internal.png', publicResolverOptions],
  ] as const) {
    const output = await generateWithResultUrl(resultUrl, {
      dns: options,
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


test('result URL rejection logs identify the actual policy reason without signed URL contents', async () => {
  const logged: unknown[] = []
  const spy = spyOn(console, 'warn').mockImplementation((...args) => { logged.push(args) })
  try {
    for (const [resultUrl, reason, hostname, expectedDnsCalls] of [
      ['https://cdn.example.test:8443/private-image.png?signature=secret', 'port_not_allowed', 'cdn.example.test', 0],
      ['http://cdn.example.test/private-image.png?signature=secret', 'unsupported_protocol', 'cdn.example.test', 0],
      ['https://unresolved.example.test/private-image.png?signature=secret', 'dns_unresolved', 'unresolved.example.test', 1],
      ['https://private.example.test/private-image.png?signature=secret', 'address_not_public', 'private.example.test', 1],
    ] as const) {
      let dnsCalls = 0
      logged.length = 0
      const output = await generateWithResultUrl(resultUrl, {
        dns: {
          resolve4: async hostname => { dnsCalls++; return hostname === 'private.example.test' ? ['10.0.0.7'] : [] },
          resolve6: async () => [],
        },
      })
      expect(output.error).toMatchObject({ outcome: 'unknown', code: 'image-url-not-permitted' })
      expect(output.calls).toEqual([config.baseUrl])
      expect(logged).toEqual([['[image-generation]', { event: 'image-result-url-rejected', reason, hostname }]])
      expect(dnsCalls).toBe(expectedDnsCalls)
      expect(JSON.stringify(logged)).not.toContain('private-image.png')
      expect(JSON.stringify(logged)).not.toContain('signature')
      expect(JSON.stringify(logged)).not.toContain('secret')
    }
  } finally { spy.mockRestore() }
})

test('provider result hosts do not need the model allowlist, and model policy is unchanged', async () => {
  const modelPolicy = { ...publicResolverOptions, allowedHosts: ['api.example.test'],
    allowHttp: true, allowTrustedDevelopmentProxy: true }
  const resultUrl = 'https://unapproved.example.test/result.png'
  expect(await resolveApprovedOutboundTarget(resultUrl, modelPolicy)).toBeNull()
  const output = await generateWithResultUrl(resultUrl, { dns: modelPolicy })
  expect(output.result?.bytes).toEqual(PNG)
  expect(output.calls).toEqual([config.baseUrl, resultUrl])
  expect((output.resultInit as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined()
  expect(await resolveApprovedOutboundTarget(resultUrl, modelPolicy)).toBeNull()
  const insecure = await generateWithResultUrl('http://unapproved.example.test/result.png', { dns: modelPolicy })
  expect(insecure.error).toMatchObject({ code: 'image-url-not-permitted' })
  expect(insecure.calls).toEqual([config.baseUrl])
})

test('image results replace transparent proxy DNS with injected public DNS', async () => {
  const publicDnsCalls: string[] = []
  const output = await generateWithResultUrl('https://cdn.example.test/result.png', {
    dns: { resolve4: async () => ['198.18.0.7'], resolve6: async () => [] },
    resolvePublic4: async hostname => {
      publicDnsCalls.push(hostname)
      return ['93.184.216.34']
    },
  })
  expect(output.result?.bytes).toEqual(PNG)
  expect(output.calls).toEqual([config.baseUrl, 'https://cdn.example.test/result.png'])
  expect(publicDnsCalls).toEqual(['cdn.example.test'])
})

test('image results still reject private, mixed, and failed public DNS answers', async () => {
  const privateOutput = await generateWithResultUrl('https://cdn.example.test/result.png', {
    dns: { resolve4: async () => ['198.18.0.7'], resolve6: async () => [] },
    resolvePublic4: async () => ['10.0.0.7'],
  })
  expect(privateOutput.error).toMatchObject({ outcome: 'unknown', code: 'image-url-not-permitted' })
  expect(privateOutput.calls).toEqual([config.baseUrl])

  const mixedOutput = await generateWithResultUrl('https://cdn.example.test/result.png', {
    dns: { resolve4: async () => ['93.184.216.34', '10.0.0.7'], resolve6: async () => [] },
    resolvePublic4: async () => { throw Error('must not replace mixed answers') },
  })
  expect(mixedOutput.error).toMatchObject({ outcome: 'unknown', code: 'image-url-not-permitted' })
  expect(mixedOutput.calls).toEqual([config.baseUrl])

  const failedOutput = await generateWithResultUrl('https://cdn.example.test/result.png', {
    dns: { resolve4: async () => ['198.18.0.7'], resolve6: async () => [] },
    resolvePublic4: async () => { throw Error('public DNS unavailable') },
  })
  expect(failedOutput.error).toMatchObject({ outcome: 'unknown', code: 'image-url-not-permitted' })
  expect(failedOutput.calls).toEqual([config.baseUrl])
})

test('result downloads send only an anonymous GET, never caller headers or body', async () => {
  let received: RequestInit | undefined
  const request = createImageResultRequest({ dns: publicResolverOptions,
    baseFetch: (async (_url, init) => { received = init; return new Response(PNG) }) as typeof fetch })
  await request('https://cdn.example.test/result.png', {
    method: 'POST', headers: { authorization: 'Bearer api-secret', cookie: 'session=private' }, body: 'private payload',
  })
  expect(received?.method).toBe('GET')
  expect(received?.body).toBeUndefined()
  expect(new Headers(received?.headers).get('authorization')).toBeNull()
  expect(new Headers(received?.headers).get('cookie')).toBeNull()
})


test('result CDN TLS retains CA trust without presenting configured API client credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-result-tls-'))
  const keys = ['BEEGAME_CLIENT_CERT', 'BEEGAME_CLIENT_KEY', 'BEEGAME_CLIENT_KEY_PASSPHRASE', 'NODE_EXTRA_CA_CERTS'] as const
  const previous = keys.map(key => process.env[key])
  try {
    for (const [name, content] of [['cert', 'api-client-cert'], ['key', 'api-client-key'], ['ca', 'trusted-ca']])
      writeFileSync(join(root, name), content)
    process.env.BEEGAME_CLIENT_CERT = join(root, 'cert')
    process.env.BEEGAME_CLIENT_KEY = join(root, 'key')
    process.env.BEEGAME_CLIENT_KEY_PASSPHRASE = 'api-passphrase'
    process.env.NODE_EXTRA_CA_CERTS = join(root, 'ca')
    const output = await generateWithResultUrl('https://cdn.example.test/result.png')
    expect(output.result?.bytes).toEqual(PNG)
    const dispatcher = (output.resultInit as RequestInit & { dispatcher: object }).dispatcher
    const optionsKey = Object.getOwnPropertySymbols(dispatcher).find(symbol => symbol.description === 'options')!
    const connect = (dispatcher as Record<symbol, { connect: Record<string, unknown> }>)[optionsKey].connect
    expect(connect.ca).toContain('trusted-ca')
    for (const key of ['cert', 'key', 'passphrase']) expect(connect[key]).toBeUndefined()
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]
      else process.env[key] = previous[i]
    })
    rmSync(root, { recursive: true, force: true })
  }
})
