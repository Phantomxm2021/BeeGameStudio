import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import {
  createProcessIsolatedModelRuntimeHost,
  getModelRuntimeWorkerEnvironment,
  serializeStructuredModelToolResult,
  type ModelRuntimeWorkerGenerateInput,
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

  test('passes only approved, resolved provider targets to the isolated worker', async () => {
    const workerInputs: ModelRuntimeWorkerGenerateInput[] = []
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
