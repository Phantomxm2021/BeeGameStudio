import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mapStoredModelConfigToRuntime } from '@bee-game-studio/agent-workflow'
import { OPENCODE_GO_PROFILES } from '@bee-game-studio/agent-workflow/opencode-go'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import {
  createProcessIsolatedModelRuntimeHost,
  getModelRuntimeWorkerEnvironment,
  serializeStructuredModelToolResult,
  type ModelRuntimeWorkerRequest,
  type ModelRuntimeWorkerResponse,
} from '../beegame/model-runtime-host'

const providerUrl = 'https://provider.example.test/v1'
const privateProviderUrl = 'https://127.0.0.1/v1'

const approvedProviderTarget: ApprovedOutboundTarget = {
  url: new URL(providerUrl),
  addresses: ['93.184.216.34'],
  lookup: (_hostname, _options, callback) =>
    callback(null, '93.184.216.34', 4),
}

describe('OpenAI-compatible provider pinning', () => {
  let testRoot = ''

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'provider-pinning-'))
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  for (const provider of ['openai-compatible', 'anthropic-compatible'] as const) {
    test(`the real isolated worker routes ${provider} Go side queries to the configured endpoint`, async () => {
      const profile = OPENCODE_GO_PROFILES[provider]
      const runtime = mapStoredModelConfigToRuntime({ provider, baseUrl: profile.baseUrl,
        apiKey: 'offline-go-key', models: profile.defaults })
      const requests: Array<Record<string, unknown>> = []
      let child: ReturnType<typeof Bun.spawn>
      let timeout: ReturnType<typeof setTimeout>
      const result = new Promise<ModelRuntimeWorkerResponse>((resolve, reject) => {
        child = Bun.spawn([process.execPath, '--preload', new URL('./model-runtime-worker.fixture.ts', import.meta.url).pathname,
          new URL('../beegame/model-runtime-worker.ts', import.meta.url).pathname], {
          env: { ...getModelRuntimeWorkerEnvironment(), BGS_SIMPLE: '1', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            BEEGAME_CONFIG_DIR: join(testRoot, 'config'), NODE_ENV: 'test' },
          stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
          ipc(raw) {
            const response = raw as ModelRuntimeWorkerResponse | { type: 'fixture.request'; [key: string]: unknown }
            if (response.type === 'fixture.request') requests.push(response)
            if (response.type === 'model.result' || response.type === 'model.error') resolve(response)
          },
        })
        timeout = setTimeout(() => reject(new Error('Offline worker did not finish')), 10_000)
        child.send({ type: 'model.generate', requestId: 'offline', input: {
          cwd: testRoot, runtimeEnv: { BGS_USE_OPENAI: '', BGS_USE_GEMINI: '', BGS_USE_GROK: '',
            ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '', ...runtime.env },
          approvedOutboundTargets: { provider: { url: profile.baseUrl, addresses: ['93.184.216.34'], trustedDevelopmentProxy: true } },
          systemPrompt: 'Return OFFLINE_OK.', messages: [{ role: 'user', content: 'Offline fixture' }],
          maxTokens: 16, querySource: 'beegame_idea_intake',
        } })
      })
      try {
        const response = await result
        expect(response).toMatchObject({ type: 'model.result', content: 'OFFLINE_OK', usage: { input_tokens: 10, output_tokens: 1 } })
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({
          url: profile.baseUrl + (provider === 'openai-compatible' ? '/chat/completions' : '/v1/messages?beta=true'),
          model: profile.defaults.balanced, sessionHeaderPresent: true,
          [provider === 'openai-compatible' ? 'bearerMatches' : 'apiKeyMatches']: true,
        })
      } finally {
        clearTimeout(timeout!)
        child!.kill()
        await child!.exited
      }
    })
  }

  test('passes only approved, resolved provider targets to the isolated worker', async () => {
    const workerInputs: ModelRuntimeWorkerRequest['input'][] = []
    const host = createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions: {
        allowedHosts: ['provider.example.test'],
      },
      resolveOutboundTarget: async () => approvedProviderTarget,
      runWorker: async input => {
        workerInputs.push(input)
        return 'model result'
      },
    })

    const result = await host.generate({
      cwd: testRoot,
      runtimeEnv: { OPENAI_BASE_URL: providerUrl },
      systemPrompt: 'Return a structured result.',
      messages: [{ role: 'user', content: 'Generate the result.' }],
      querySource: 'provider_pinning_test',
    })

    expect(result).toBe('model result')
    expect(workerInputs).toHaveLength(1)
    expect(workerInputs[0]?.approvedOutboundTargets).toEqual({
      OPENAI_BASE_URL: {
        url: providerUrl,
        addresses: ['93.184.216.34'],
      },
    })
  })

  test('passes the approved network trust settings to the isolated model worker', () => {
    const keys = [
      'HTTPS_PROXY',
      'NO_PROXY',
      'NODE_EXTRA_CA_CERTS',
      'CLAUDE_CODE_CLIENT_CERT',
      'CLAUDE_CODE_CLIENT_KEY',
    ] as const
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
    const previousSecret = process.env.ANTHROPIC_API_KEY
    try {
      process.env.HTTPS_PROXY = 'https://proxy.example.test:8443'
      process.env.NO_PROXY = '127.0.0.1,localhost'
      process.env.NODE_EXTRA_CA_CERTS = '/tmp/runtime-ca.pem'
      process.env.CLAUDE_CODE_CLIENT_CERT = '/tmp/client-cert.pem'
      process.env.CLAUDE_CODE_CLIENT_KEY = '/tmp/client-key.pem'
      process.env.ANTHROPIC_API_KEY = 'must-not-cross-process-boundary'

      expect(getModelRuntimeWorkerEnvironment()).toMatchObject({
        BGS_PROVIDER_MANAGED_BY_HOST: '1',
        HTTPS_PROXY: 'https://proxy.example.test:8443',
        NO_PROXY: '127.0.0.1,localhost',
        NODE_EXTRA_CA_CERTS: '/tmp/runtime-ca.pem',
        CLAUDE_CODE_CLIENT_CERT: '/tmp/client-cert.pem',
        CLAUDE_CODE_CLIENT_KEY: '/tmp/client-key.pem',
      })
      expect(getModelRuntimeWorkerEnvironment().ANTHROPIC_API_KEY).toBeUndefined()
    } finally {
      for (const key of keys) {
        const value = previous[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      if (previousSecret === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previousSecret
    }
  })

  test('worker transport accepts the legacy socket only when the BGS socket is unset', () => {
    const keys = ['BGS_API_UNIX_SOCKET', 'ANTHROPIC_UNIX_SOCKET'] as const
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
    try {
      process.env.ANTHROPIC_UNIX_SOCKET = '/tmp/legacy-fixture.sock'
      delete process.env.BGS_API_UNIX_SOCKET
      expect(getModelRuntimeWorkerEnvironment().BGS_API_UNIX_SOCKET).toBe('/tmp/legacy-fixture.sock')
      process.env.BGS_API_UNIX_SOCKET = '/tmp/bgs-fixture.sock'
      expect(getModelRuntimeWorkerEnvironment().BGS_API_UNIX_SOCKET).toBe('/tmp/bgs-fixture.sock')
      process.env.BGS_API_UNIX_SOCKET = ''
      expect(getModelRuntimeWorkerEnvironment().BGS_API_UNIX_SOCKET).toBe('')
      expect(getModelRuntimeWorkerEnvironment()).not.toHaveProperty('ANTHROPIC_UNIX_SOCKET')
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    }
  })

  test('rejects an unapproved provider before starting the isolated worker', async () => {
    let workerCalls = 0
    const host = createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions: { allowedHosts: [] },
      resolveOutboundTarget: async () => null,
      runWorker: async () => {
        workerCalls += 1
        return 'unexpected result'
      },
    })

    await expect(
      host.generate({
        cwd: testRoot,
        runtimeEnv: { OPENAI_BASE_URL: privateProviderUrl },
        systemPrompt: 'Return a structured result.',
        messages: [{ role: 'user', content: 'Generate the result.' }],
        querySource: 'provider_pinning_test',
      }),
    ).rejects.toThrow('Outbound URL is not permitted')
    expect(workerCalls).toBe(0)
  })

  test('requires exactly one forced structured tool result', () => {
    expect(serializeStructuredModelToolResult({
      content: [{ type: 'tool_use', name: 'submit_resource_semantic_batch', input: { decisions: [] } }],
    }, 'submit_resource_semantic_batch')).toBe('{"decisions":[]}')
    expect(() => serializeStructuredModelToolResult({
      content: [{ type: 'text', text: '{"decisions":[]}' }],
    }, 'submit_resource_semantic_batch')).toThrow('exactly one')
  })

  test('unwraps the provider argument envelope at the runtime boundary', () => {
    expect(serializeStructuredModelToolResult({
      content: [{
        type: 'tool_use',
        name: 'submit_resource_semantic_batch',
        input: {
          decisions: [],
          raw_arguments: '{"decisions":[]}',
        },
      }],
    }, 'submit_resource_semantic_batch')).toBe('{"decisions":[]}')
  })

  test('rejects malformed provider argument envelopes at the runtime boundary', () => {
    expect(() => serializeStructuredModelToolResult({
      content: [{
        type: 'tool_use',
        name: 'submit_resource_semantic_batch',
        input: { raw_arguments: '{"decisions":' },
      }],
    }, 'submit_resource_semantic_batch')).toThrow(
      'Structured model tool arguments are not valid JSON',
    )
  })

  test('drops a malformed provider diagnostic when canonical tool fields are present', () => {
    expect(serializeStructuredModelToolResult({
      content: [{
        type: 'tool_use',
        name: 'submit_resource_semantic_batch',
        input: {
          decisions: [],
          raw_arguments: '{"decisions":',
        },
      }],
    }, 'submit_resource_semantic_batch')).toBe('{"decisions":[]}')
  })

  test('reports provider truncation before attempting to parse incomplete raw arguments', () => {
    expect(() => serializeStructuredModelToolResult({
      stop_reason: 'max_tokens',
      content: [{
        type: 'tool_use',
        name: 'submit_resource_semantic_batch',
        input: { decisions: [] },
      }],
    }, 'submit_resource_semantic_batch')).toThrow('provider output was truncated')
  })
})
