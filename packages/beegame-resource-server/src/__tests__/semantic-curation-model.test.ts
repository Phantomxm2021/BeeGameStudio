import { describe, expect, test } from 'bun:test'
import type { ResourceElement } from '@bee-game-studio/beegame-resource-core'
import { buildResourceSemanticContentProjection, buildResourceSemanticVisualInput } from '../semantic-curation-evidence'
import { renderResourceModelPreview } from '../model-preview'
import {
  ResourceSemanticModelConfigurationError,
  ResourceSemanticModelResponseError,
  createResourceSemanticModelClient,
  parseResourceSemanticModelContent,
} from '../semantic-curation-model'
import { resolveResourceSemanticPreviewKind } from '../index'

const element: ResourceElement = {
  id: 'element-1', packId: 'pack-1', name: 'Tower Mesh', path: 'models/tower.glb', category: 'models', kind: 'model', assetKind: 'model',
  specs: { contentHash: 'b'.repeat(64), meshCount: 1, materialCount: 1 },
  contentProfile: { packaging: 'self-contained', components: [{ id: 'mesh:0', kind: 'mesh' }], inspection: { status: 'complete', source: 'server' } },
  preview: { kind: 'model', path: 'models/tower.glb' }, dependencies: [], status: 'ready',
}

const responseDecision = {
  element_id: 'element-1', source_content_hash: 'b'.repeat(64), usageTags: ['building'], confidence: 'high',
  evidence: [{ source: 'content_preview', reference: 'element-1', observation: 'The rendered preview shows a building-like mesh.' }], curator_revision: 'semantic-curator-v1',
}

describe('resource semantic provider batch contract', () => {
  test('uses individual previews for one or two resources and Atlas for more than two', async () => {
    const preview = await renderResourceModelPreview({ meshes: [{ vertices: [[-1, 0, 0], [1, 0, 0], [0, 2, 0]], faces: [[0, 1, 2]] }] })
    const one = await buildResourceSemanticVisualInput([{ elementId: 'element-1', file: preview! }])
    const two = await buildResourceSemanticVisualInput([{ elementId: 'element-1', file: preview! }, { elementId: 'element-2', file: preview! }])
    const three = await buildResourceSemanticVisualInput([{ elementId: 'element-1', file: preview! }, { elementId: 'element-2', file: preview! }, { elementId: 'element-3', file: preview! }])
    expect(one.mode).toBe('individual')
    expect(two.mode).toBe('individual')
    expect(three.mode).toBe('atlas')
  })

  test('projects facts without filenames or paths and preserves the canonical model preview kind', () => {
    const projection = buildResourceSemanticContentProjection(element)
    expect(projection).not.toHaveProperty('name')
    expect(projection).not.toHaveProperty('path')
    expect(resolveResourceSemanticPreviewKind({ ...element, preview: undefined })).toBe('model')
  })

  test('submits one native provider batch containing independent visual requests', async () => {
    let body: Record<string, unknown> | undefined
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({ providerBatchId: 'provider-batch-1' })
      },
    })
    const request = await createRequest('element-1')
    const result = await client.submitBatch({ requests: [request] })
    expect(result).toEqual({ providerBatchId: 'provider-batch-1' })
    expect(body?.operation).toBe('submit')
    expect(body?.requests).toEqual([expect.objectContaining({ customId: 'job-1:subrequest:0' })])
  })

  test('retrieves provider results without a second semantic route and preserves usage', async () => {
    let requestedOperation = ''
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requestedOperation = String(body.operation)
        return Response.json({
          status: 'ended',
          results: [{ customId: 'job-1:subrequest:0', status: 'succeeded', content: JSON.stringify({ decisions: [responseDecision] }), usage: { inputTokens: 100, cacheReadTokens: 20, cacheCreationTokens: 5, outputTokens: 30, totalTokens: 155, creditsMicro: 0 } }],
        })
      },
    })
    const result = await client.retrieveBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, providerBatchId: 'provider-batch-1', jobId: 'job-1', batchId: 'batch-1' })
    expect(requestedOperation).toBe('retrieve')
    expect(result.status).toBe('ended')
    expect(result.results?.[0]?.content).toContain('element-1')
    expect(result.results?.[0]?.usage?.totalTokens).toBe(155)
  })

  test('uses one canonical parser for content preview evidence and rejects protocol contamination', () => {
    const request = { items: [{ elementId: 'element-1', projection: { sourceContentHash: 'b'.repeat(64) } }], curatorRevision: 'semantic-curator-v1' }
    expect(parseResourceSemanticModelContent(request, JSON.stringify({ decisions: [responseDecision] })).decisions[0]?.usageTags).toEqual(['building'])
    expect(() => parseResourceSemanticModelContent(request, JSON.stringify({ decisions: [responseDecision], raw_arguments: '{}' }))).toThrow('unexpected top-level fields')
    expect(() => parseResourceSemanticModelContent(request, JSON.stringify({ decisions: [{ ...responseDecision, evidence: [{ source: 'technical_facts', reference: 'meshCount', observation: 'A mesh is present.' }] }] }))).toThrow('content_preview')
  })

  test('rejects unsupported providers before submission', async () => {
    const client = createResourceSemanticModelClient({ runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token', fetchImpl: async () => Response.json({ providerBatchId: 'unexpected' }) })
    const request = await createRequest('element-1')
    await expect(client.submitBatch({ requests: [{ ...request, modelType: 'openai' }] })).rejects.toThrow(ResourceSemanticModelConfigurationError)
  })

  test('preserves runtime failure stages from the single provider batch route', async () => {
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => new Response(JSON.stringify({ stage: 'usage_billing', message: 'unknown certificate verification error', traceId: 'trace-1' }), { status: 502 }),
    })
    await expect(client.retrieveBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, providerBatchId: 'provider-batch-1', jobId: 'job-1', batchId: 'batch-1' })).rejects.toEqual(expect.objectContaining({ name: 'ResourceSemanticModelResponseError', stage: 'usage_billing', traceId: 'trace-1' }))
  })

  test('rejects invalid client configuration and malformed JSON', async () => {
    expect(() => createResourceSemanticModelClient({ runtimeServerUrl: '', serviceToken: 'token' })).toThrow(ResourceSemanticModelConfigurationError)
    expect(() => createResourceSemanticModelClient({ runtimeServerUrl: 'https://runtime.example.test', serviceToken: '' })).toThrow(ResourceSemanticModelConfigurationError)
    const request = await createRequest('element-1')
    const client = createResourceSemanticModelClient({ runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token', fetchImpl: async () => Response.json({ status: 'ended', results: [{ customId: request.customId, status: 'succeeded', content: 'not json' }] }) })
    const result = await client.retrieveBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, providerBatchId: 'provider-batch-1', jobId: 'job-1', batchId: 'batch-1' })
    expect(() => parseResourceSemanticModelContent(request, result.results![0]!.content!)).toThrow(ResourceSemanticModelResponseError)
  })
})

async function createRequest(elementId: string) {
  const preview = await renderResourceModelPreview({ meshes: [{ vertices: [[-1, 0, 0], [1, 0, 0], [0, 2, 0]], faces: [[0, 1, 2]] }] })
  return {
    customId: 'job-1:subrequest:0', ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic' as const, runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
    items: [{ elementId, attempt: 1, projection: buildResourceSemanticContentProjection(element) }],
    visualInput: await buildResourceSemanticVisualInput([{ elementId, file: preview! }]),
  }
}
