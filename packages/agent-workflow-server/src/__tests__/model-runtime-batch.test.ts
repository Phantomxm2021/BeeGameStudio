import { describe, expect, test } from 'bun:test'
import {
  createProcessIsolatedModelRuntimeHost,
  type BeeGameModelBatchRequest,
  type BeeGameModelGenerateInput,
} from '../beegame/model-runtime-host'

const input: BeeGameModelGenerateInput = {
  cwd: '/tmp/beegame-runtime',
  modelType: 'anthropic',
  runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
  systemPrompt: 'system',
  messages: [{ role: 'user', content: 'classify' }],
  querySource: 'resource-semantic-batch-test',
}

describe('model runtime provider batch capability', () => {
  test('submits one native provider batch with stable custom ids', async () => {
    const submissions: BeeGameModelBatchRequest[][] = []
    const host = createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions: { allowedHosts: ['api.anthropic.com'] },
      runBatchWorker: async requests => {
        submissions.push([...requests])
        return { providerBatchId: 'provider-batch-1' }
      },
    })

    const result = await host.batch!.submit([
      { customId: 'job-1:0', input },
      { customId: 'job-1:1', input: { ...input, querySource: 'resource-semantic-batch-test:1' } },
    ])

    expect(result).toEqual({ providerBatchId: 'provider-batch-1' })
    expect(submissions).toHaveLength(1)
    expect(submissions[0]!.map(request => request.customId)).toEqual(['job-1:0', 'job-1:1'])
  })

  test('returns provider results by custom id rather than response order', async () => {
    const host = createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions: { allowedHosts: ['api.anthropic.com'] },
      runBatchWorker: async () => ({ providerBatchId: 'provider-batch-2' }),
      retrieveBatchWorker: async () => ({
        status: 'ended',
        results: [
          { customId: 'job-1:1', status: 'succeeded', generation: { content: 'second' } },
          { customId: 'job-1:0', status: 'errored', error: 'provider error' },
        ],
      }),
    })

    const result = await host.batch!.retrieve('provider-batch-2', {
      cwd: input.cwd,
      modelType: input.modelType,
      runtimeEnv: input.runtimeEnv,
      querySource: input.querySource,
    })

    expect(result.status).toBe('ended')
    expect(result.results?.map(item => item.customId)).toEqual(['job-1:1', 'job-1:0'])
    expect(result.results?.[0]).toEqual(expect.objectContaining({ generation: { content: 'second' } }))
  })

  test('rejects an unsupported provider without calling synchronous generate', async () => {
    let syncCalled = false
    const host = createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions: { allowedHosts: ['api.openai.example'] },
      runWorker: async () => {
        syncCalled = true
        return '{}'
      },
      runBatchWorker: async () => ({ providerBatchId: 'should-not-submit' }),
    })

    await expect(host.assertBatchProvider!('openai')).rejects.toThrow('Native provider batch is not supported for model provider "openai"')
    expect(syncCalled).toBe(false)
  })

  test('recovery retrieval uses the persisted provider batch id', async () => {
    const retrieved: string[] = []
    const host = createProcessIsolatedModelRuntimeHost({
      outboundTargetPolicyOptions: { allowedHosts: ['api.anthropic.com'] },
      runBatchWorker: async () => ({ providerBatchId: 'provider-batch-3' }),
      retrieveBatchWorker: async providerBatchId => {
        retrieved.push(providerBatchId)
        return { status: 'processing' }
      },
    })

    await expect(host.batch!.retrieve('provider-batch-3', {
      cwd: input.cwd,
      modelType: input.modelType,
      runtimeEnv: input.runtimeEnv,
      querySource: input.querySource,
    })).resolves.toEqual({ status: 'processing' })
    expect(retrieved).toEqual(['provider-batch-3'])
  })
})
