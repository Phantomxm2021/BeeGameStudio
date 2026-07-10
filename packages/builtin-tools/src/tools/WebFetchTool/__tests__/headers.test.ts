import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { readFile } from 'node:fs/promises'
import { logMock } from '../../../../../../tests/mocks/log'
import { setupAxiosMock } from '../../../../../../tests/mocks/axios'

type MockAxiosResponse = {
  data: ArrayBuffer
  headers: Record<string, unknown>
  status: number
  statusText: string
}

type MockAxiosError = Error & {
  isAxiosError: true
  response?: {
    headers: Record<string, unknown>
    status: number
  }
}

let getMock: (url: string) => Promise<MockAxiosResponse>
let getCalls: string[]

const deterministicOutboundOptions = {
  outboundTargetPolicyOptions: {
    resolve4: async () => ['93.184.216.34'],
    resolve6: async () => [],
  },
}

const axiosHandle = setupAxiosMock()
axiosHandle.stubs.get = (url: string) => {
  getCalls.push(url)
  return getMock(url)
}
axiosHandle.stubs.isAxiosError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { isAxiosError?: unknown }).isAxiosError === true

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/services/api/claude.js', () => ({
  queryHaiku: async () => ({ message: { content: [] } }),
}))

mock.module('src/utils/http.js', () => ({
  getWebFetchUserAgent: () => 'TestAgent/1.0',
}))

mock.module('src/utils/log.ts', logMock)

mock.module('src/utils/mcpOutputStorage.js', () => ({
  isBinaryContentType: (contentType: string) =>
    !contentType.toLowerCase().startsWith('text/'),
  persistBinaryContent: async () => ({
    filepath: '/tmp/webfetch-test.bin',
    size: 0,
  }),
}))

mock.module('src/utils/settings/settings.js', () => ({
  getInitialSettings: () => ({}),
  getSettings_DEPRECATED: () => ({ skipWebFetchPreflight: true }),
}))

beforeEach(() => {
  getCalls = []
  getMock = async () => ({
    data: new TextEncoder().encode('hello').buffer,
    headers: { 'content-type': 'text/plain' },
    status: 200,
    statusText: 'OK',
  })
})

beforeAll(() => {
  axiosHandle.useStubs = true
})

afterAll(() => {
  axiosHandle.useStubs = false
})

describe('WebFetch response headers', () => {
  test('resolves the final upgraded HTTPS endpoint and port before fetching', async () => {
    const resolvedUrls: string[] = []
    const target = {
      url: new URL('https://example.test:8443/path'),
      addresses: ['93.184.216.34'],
      lookup: (
        _hostname: string,
        _options: unknown,
        callback: (
          error: Error | null,
          address: string,
          family: 4 | 6,
        ) => void,
      ) => callback(null, '93.184.216.34', 4 as const),
    }
    const { clearWebFetchCache, getURLMarkdownContent } = await import(
      '../utils'
    )
    clearWebFetchCache()

    await getURLMarkdownContent(
      'http://example.test:8443/path',
      new AbortController(),
      {
        resolveOutboundTarget: async url => {
          resolvedUrls.push(url)
          return url === 'https://example.test:8443/path' ? target : null
        },
      },
    )

    expect(resolvedUrls).toEqual(['https://example.test:8443/path'])
    expect(getCalls).toEqual(['https://example.test:8443/path'])
  })

  test('reads redirect Location from AxiosHeaders-style get()', async () => {
    getMock = async () => {
      const error = new Error('redirect') as MockAxiosError
      error.isAxiosError = true
      error.response = {
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location' ? '/next' : undefined,
        },
        status: 302,
      }
      throw error
    }

    const { getWithPermittedRedirects } = await import('../utils')
    const result = await getWithPermittedRedirects(
      'https://example.com/old',
      new AbortController().signal,
      () => false,
      0,
      deterministicOutboundOptions,
    )

    expect(result).toEqual({
      type: 'redirect',
      originalUrl: 'https://example.com/old',
      redirectUrl: 'https://example.com/next',
      statusCode: 302,
    })
  })

  test('reads proxy block markers from normalized headers', async () => {
    getMock = async () => {
      const error = new Error('blocked') as MockAxiosError
      error.isAxiosError = true
      error.response = {
        headers: { 'x-proxy-error': 'blocked-by-allowlist' },
        status: 403,
      }
      throw error
    }

    const { getWithPermittedRedirects } = await import('../utils')

    await expect(
      getWithPermittedRedirects(
        'https://blocked.example/path',
        new AbortController().signal,
        () => false,
        0,
        deterministicOutboundOptions,
      ),
    ).rejects.toThrow('EGRESS_BLOCKED')
  })

  test('normalizes array content-type before cache and parsing', async () => {
    getMock = async () => ({
      data: new TextEncoder().encode('plain body').buffer,
      headers: { 'content-type': ['text/plain', 'charset=utf-8'] },
      status: 200,
      statusText: 'OK',
    })

    const { clearWebFetchCache, getURLMarkdownContent } = await import(
      '../utils'
    )
    clearWebFetchCache()

    const result = await getURLMarkdownContent(
      'https://example.com/plain.txt',
      new AbortController(),
      deterministicOutboundOptions,
    )

    expect('type' in result).toBe(false)
    if ('type' in result) {
      throw new Error('unexpected redirect result')
    }
    expect(result.content).toBe('plain body')
    expect(result.contentType).toBe('text/plain, charset=utf-8')
  })

  test('rejects a permitted www redirect that resolves to loopback without issuing its request', async () => {
    getMock = async url => {
      if (url === 'https://example.test/old') {
        const error = new Error('redirect') as MockAxiosError
        error.isAxiosError = true
        error.response = {
          headers: { location: 'https://www.example.test/next' },
          status: 302,
        }
        throw error
      }
      throw new Error(`unexpected request to ${url}`)
    }

    let resolverCalls = 0
    const { clearWebFetchCache, getURLMarkdownContent } = await import('../utils')
    clearWebFetchCache()

    await expect(
      getURLMarkdownContent(
        'https://example.test/old',
        new AbortController(),
        {
          outboundTargetPolicyOptions: {
            resolve4: async hostname => {
              resolverCalls += 1
              return hostname === 'www.example.test'
                ? ['127.0.0.1']
                : ['93.184.216.34']
            },
            resolve6: async () => [],
          },
        },
      ),
    ).rejects.toThrow('Outbound URL is not permitted')

    expect(getCalls).toEqual(['https://example.test/old'])
    expect(resolverCalls).toBe(2)
  })

  test('pins configured Tavily and Exa requests and disables their redirects', async () => {
    const requestConfigs: Array<Record<string, unknown>> = []
    axiosHandle.stubs.post = (
      _url: string,
      _body: unknown,
      config: Record<string, unknown>,
    ) => {
      requestConfigs.push(config)
      const data = requestConfigs.length === 1
        ? { url: 'https://example.test/page', raw_content: 'markdown' }
        : requestConfigs.length === 2
          ? { results: [] }
          : ''
      return Promise.resolve({ data })
    }

    const { clearWebFetchCache, fetchContentWithTavily } = await import('../utils')
    const { TavilySearchAdapter } = await import('../../WebSearchTool/adapters/tavilyAdapter')
    const { ExaSearchAdapter } = await import('../../WebSearchTool/adapters/exaAdapter')
    clearWebFetchCache()

    await fetchContentWithTavily(
      'https://example.test/page',
      new AbortController(),
      deterministicOutboundOptions,
    )
    await new TavilySearchAdapter(deterministicOutboundOptions).search('query', {})
    await new ExaSearchAdapter(deterministicOutboundOptions).search('query', {})

    expect(requestConfigs).toHaveLength(3)
    for (const config of requestConfigs) {
      expect(config.maxRedirects).toBe(0)
      expect(config.httpAgent).toBeDefined()
      expect(config.httpsAgent).toBeDefined()
    }
  })

  test('uses the shared security-core package rather than server-internal policy imports', async () => {
    const sourceFiles = [
      new URL('../utils.ts', import.meta.url),
      new URL('../../WebSearchTool/adapters/tavilyAdapter.ts', import.meta.url),
      new URL('../../WebSearchTool/adapters/exaAdapter.ts', import.meta.url),
    ]

    const sources = await Promise.all(sourceFiles.map(file => readFile(file, 'utf8')))

    for (const source of sources) {
      expect(source).not.toContain('agent-workflow-server/src/security/outbound-target-policy')
      expect(source).toContain('@bee-game-studio/security-core')
    }
  })
})
