import { describe, expect, test, spyOn } from 'bun:test'
import type { RuntimeModelConfig } from '@bee-game-studio/agent-workflow'
import type { AuthenticationClient } from '../auth/public'
import { SupabaseRuntimeEnvRequestError } from '../supabase-runtime-env-client'
import {
  createRuntimeConfigurationClient,
  RUNTIME_CONFIGURATION_PROTOCOL_VERSION,
  type RuntimeConfigurationClientFactoryOptions,
} from './public'

function authFixture(
  tokens: Array<string | undefined>,
): { authentication: AuthenticationClient; calls: Array<{ ownerId: string; forceRefresh?: boolean }> } {
  const calls: Array<{ ownerId: string; forceRefresh?: boolean }> = []
  const authentication: AuthenticationClient = {
    protocolVersion: 1,
    ownerId: 'owner-1',
    async getAccessToken(input) {
      calls.push(input)
      return tokens.shift()
    },
  }
  return { authentication, calls }
}

function options(overrides: Partial<RuntimeConfigurationClientFactoryOptions> = {}) {
  const auth = authFixture(['token-1'])
  const calls: Array<readonly [string | undefined, string | undefined, string | undefined, string | undefined]> = []
  const base: RuntimeConfigurationClientFactoryOptions = {
    ownerId: 'owner-1',
    dataDir: '/tmp/beegame-owner-1',
    modelConfigId: 'model-1',
    authentication: auth.authentication,
    repository: {
      async getRuntimeEnv(dataDir, ownerId, token, modelConfigId) {
        calls.push([dataDir, ownerId, token, modelConfigId])
        return { OPENAI_BASE_URL: 'https://openai.example' }
      },
    },
    command: ['native-model', '--protocol'],
    ...overrides,
  }
  Object.defineProperty(base, 'auth', { value: auth })
  Object.defineProperty(base, 'calls', { value: calls })
  return base as RuntimeConfigurationClientFactoryOptions & {
    auth: typeof auth
    calls: typeof calls
  }
}

describe('public runtime configuration client', () => {
  test('preserves supported explicit provider selection and rejects unknown providers', async () => {
    for (const modelType of ['openai','anthropic','gemini','grok'] as const) {
      const client=createRuntimeConfigurationClient(options({runtime:{modelType,env:{}}}))
      expect((await client.resolve({ownerId:'owner-1'})).env.BEEGAME_MODEL_TYPE).toBe(modelType)
    }
    const client=createRuntimeConfigurationClient(options({repository:{async getRuntimeEnv(){return {BEEGAME_MODEL_TYPE:'unknown'}}}}))
    await expect(client.resolve({ownerId:'owner-1'})).rejects.toThrow()
  })

  test('diagnostics distinguish auth, refresh, HTTP, network and validation failures without secrets', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {})
    const warning = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const cases = [
        { tokens: [undefined], repository: async () => ({}), expected: { step: 'authentication', code: 'token_unavailable' } },
        { tokens: ['secret-token', undefined], repository: async () => { throw new SupabaseRuntimeEnvRequestError(401, 'secret-body') },
          expected: { step: 'authentication_refresh', code: 'token_unavailable' } },
        { tokens: ['secret-token', 'secret-refreshed'], repository: async () => { throw new SupabaseRuntimeEnvRequestError(403, 'secret-body') },
          expected: { step: 'runtime_environment_retry', code: 'authorization_failed', httpStatus: 403 } },
        { tokens: ['secret-token'], repository: async () => { throw new SupabaseRuntimeEnvRequestError(503, 'secret-body') },
          expected: { step: 'runtime_environment', code: 'repository_unavailable', httpStatus: 503 } },
        { tokens: ['secret-token'], repository: async () => { throw new Error('https://secret-host', { cause: { code: 'ECONNRESET' } }) },
          expected: { step: 'runtime_environment', code: 'repository_unavailable', networkCode: 'ECONNRESET' } },
        { tokens: ['secret-token'], repository: async () => ({ BEEGAME_MODEL_TYPE: 'unknown', OPENAI_API_KEY: 'secret-openai' }),
          expected: { step: 'environment_validation', code: 'invalid_environment' } },
      ]
      for (const item of cases) {
        const client = createRuntimeConfigurationClient(options({
          authentication: authFixture(item.tokens).authentication,
          repository: { getRuntimeEnv: item.repository },
        }))
        let failure: unknown
        try { await client.resolve({ ownerId: 'owner-1' }) } catch (error) { failure = error }
        expect(failure).toMatchObject({ diagnostic: item.expected })
        const diagnostic = (failure as { diagnostic: { traceId: string; elapsedMs: number; httpStatus?: number } }).diagnostic
        expect(diagnostic.traceId).toMatch(/^[0-9a-f-]{36}$/)
        expect(diagnostic.elapsedMs).toBeGreaterThanOrEqual(0)
        if (item.expected.step === 'authentication_refresh') expect(diagnostic.httpStatus).toBeUndefined()
        expect(JSON.parse(log.mock.calls.at(-1)![1] as string)).toEqual(diagnostic)
      }
      expect(JSON.stringify([log.mock.calls, warning.mock.calls])).not.toContain('secret')
    } finally { log.mockRestore(); warning.mockRestore() }
  })

  test('resolves an owner-bound command and infers the single provider', async () => {
    const fixture = options()
    const client = createRuntimeConfigurationClient(fixture)
    const result = await client.resolve({ ownerId: 'owner-1' })

    expect(client.protocolVersion).toBe(RUNTIME_CONFIGURATION_PROTOCOL_VERSION)
    expect(client.ownerId).toBe('owner-1')
    expect(result).toEqual({
      command: ['native-model', '--protocol'],
      env: {
        OPENAI_BASE_URL: 'https://openai.example',
        BEEGAME_MODEL_TYPE: 'openai',
      },
    })
    expect(fixture.calls).toEqual([['/tmp/beegame-owner-1', 'owner-1', 'token-1', 'model-1']])
  })

  test('lets explicit Responses model settings override repository settings', async () => {
    const client = createRuntimeConfigurationClient(options({
      repository:{async getRuntimeEnv(){return {OPENAI_API_KEY:'repo',BEEGAME_MODEL:'repo-model'}}},
      runtime:{modelType:'openai',env:{OPENAI_API_KEY:'selected',BEEGAME_MODEL:'selected-model'}}
    }))
    expect((await client.resolve({ownerId:'owner-1'})).env).toMatchObject({OPENAI_API_KEY:'selected',BEEGAME_MODEL:'selected-model',BEEGAME_MODEL_TYPE:'openai'})
  })

  test('refreshes once on a repository auth failure and retries with the refreshed token', async () => {
    const auth = authFixture(['stale-token', 'fresh-token'])
    const calls: string[] = []
    const client = createRuntimeConfigurationClient({
      ...options(),
      authentication: auth.authentication,
      repository: {
        async getRuntimeEnv(_dataDir, _ownerId, token) {
          calls.push(token as string)
          if (calls.length === 1) throw new SupabaseRuntimeEnvRequestError(401, 'expired')
          return { OPENAI_API_KEY: 'key' }
        },
      },
    })
    await expect(client.resolve({ ownerId: 'owner-1' })).resolves.toMatchObject({
      env: { OPENAI_API_KEY: 'key', BEEGAME_MODEL_TYPE: 'openai' },
    })
    expect(calls).toEqual(['stale-token', 'fresh-token'])
    expect(auth.calls).toEqual([
      { ownerId: 'owner-1' },
      { ownerId: 'owner-1', forceRefresh: true },
    ])
  })

  test('does not refresh twice when the retry is also unauthorized', async () => {
    const auth = authFixture(['stale-token', 'fresh-token', 'should-not-be-used'])
    let repositoryCalls = 0
    const client = createRuntimeConfigurationClient({
      ...options(),
      authentication: auth.authentication,
      repository: {
        async getRuntimeEnv() {
          repositoryCalls += 1
          throw new SupabaseRuntimeEnvRequestError(403, 'denied')
        },
      },
    })
    await expect(client.resolve({ ownerId: 'owner-1' })).rejects.toThrow('authorization failed')
    expect(repositoryCalls).toBe(2)
    expect(auth.calls).toEqual([
      { ownerId: 'owner-1' },
      { ownerId: 'owner-1', forceRefresh: true },
    ])
  })

  test('does not refresh ordinary status-403 repository failures', async () => {
    const auth = authFixture(['token-1', 'should-not-be-used'])
    let repositoryCalls = 0
    const client = createRuntimeConfigurationClient({
      ...options(),
      authentication: auth.authentication,
      repository: {
        async getRuntimeEnv() {
          repositoryCalls += 1
          throw { status: 403, message: 'runtime backend unavailable: secret-token' }
        },
      },
    })
    let error: unknown
    try {
      await client.resolve({ ownerId: 'owner-1' })
    } catch (caught) {
      error = caught
    }
    expect(String(error)).toContain('repository unavailable')
    expect(String(error)).not.toContain('secret-token')
    expect(repositoryCalls).toBe(1)
    expect(auth.calls).toEqual([{ ownerId: 'owner-1' }])
  })

  test('fails closed without a token and rejects foreign owners', async () => {
    const noToken = options()
    const noTokenAuth = authFixture([undefined])
    let repositoryCalls = 0
    const noTokenClient = createRuntimeConfigurationClient({
      ...noToken,
      authentication: noTokenAuth.authentication,
      repository: {
        async getRuntimeEnv() {
          repositoryCalls += 1
          return {}
        },
      },
    })
    await expect(noTokenClient.resolve({ ownerId: 'owner-1' })).rejects.toThrow('token unavailable')
    expect(repositoryCalls).toBe(0)
    await expect(noTokenClient.resolve({ ownerId: 'other-owner' })).rejects.toThrow('ownerId')
  })

  test('rejects extra factory and resolve fields before calling dependencies', async () => {
    const fixture = options()
    expect(() => createRuntimeConfigurationClient({
      ...fixture,
      unexpected: 'secret',
    } as never)).toThrow(/unexpected fields/)
    const client = createRuntimeConfigurationClient(fixture)
    await expect(client.resolve({ ownerId: 'owner-1', modelConfigId: 'foreign-model' } as never)).rejects.toThrow(/invalid/)
    expect(fixture.auth.calls).toHaveLength(0)
    expect(fixture.calls).toHaveLength(0)
  })

  test('returns fresh snapshots and exposes no repository or runtime state', async () => {
    const auth = authFixture(['token-1', 'token-2'])
    const fixture = options({ authentication: auth.authentication })
    const runtime: RuntimeModelConfig = { modelType: 'openai', env: { SECRET: 'value' } }
    const command = ['native-model', '--protocol']
    const client = createRuntimeConfigurationClient({ ...fixture, command, runtime })
    command.push('caller-mutation')
    runtime.env.SECRET = 'caller-mutation'
    const first = await client.resolve({ ownerId: 'owner-1' })
    first.command.push('mutated')
    first.env.SECRET = 'mutated'
    const second = await client.resolve({ ownerId: 'owner-1' })
    expect(second.command).toEqual(['native-model', '--protocol'])
    expect(second.env.SECRET).toBe('value')
    expect(Object.keys(client).sort()).toEqual(['ownerId', 'protocolVersion', 'resolve'])
    expect(Object.isFrozen(client)).toBe(true)
  })
})
