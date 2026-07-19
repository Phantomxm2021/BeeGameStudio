import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import {
  createProcessIsolatedModelRuntimeHost,
  type ModelRuntimeWorkerRequest,
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
})
