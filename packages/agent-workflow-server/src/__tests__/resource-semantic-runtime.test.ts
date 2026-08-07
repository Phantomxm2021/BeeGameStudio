import { describe, expect, test } from 'bun:test'
import { RESOURCE_SEMANTIC_EVIDENCE_SOURCES, RESOURCE_USAGE_TAGS } from '../../../beegame-resource-core/src/types'
import { RESOURCE_SEMANTIC_MODEL_OUTPUT_SCHEMA, RESOURCE_SEMANTIC_MODEL_TOOL_NAME } from '../../../beegame-resource-core/src/semantic-curation'
import { createAgentWorkflowApp } from '../app'
import type { BeeGameModelBatchRequest } from '../beegame/model-runtime-host'

const visualInput = {
  mode: 'individual',
  images: [{ elementId: 'element-1', mediaType: 'image/jpeg', dataBase64: 'rendered-preview' }],
} as const

function request(customId = 'job-1:subrequest:0') {
  return {
    customId,
    ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
    packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
    items: [{ elementId: 'element-1', attempt: 1, projection: { elementId: 'element-1', sourceContentHash: 'a'.repeat(64) } }],
    visualInput,
  }
}

describe('resource semantic native provider batch runtime bridge', () => {
  test('submits one native provider batch with independent visual subrequests', async () => {
    let submitted: readonly BeeGameModelBatchRequest[] = []
    let syncCalled = false
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: {
        generate: async () => { syncCalled = true; return '{}' },
        batch: {
          submit: async requests => { submitted = requests; return { providerBatchId: 'provider-batch-1' } },
          retrieve: async () => ({ status: 'processing' }),
        },
      },
      resourceSelectionRuntimeConfig: { baseUrl: 'http://resource.test', serviceToken: 'resource-token' },
    })

    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST', headers: { 'x-beegame-resource-service-token': 'resource-token', 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'submit', requests: [{ customId: request().customId, request: request() }, { customId: 'job-1:subrequest:1', request: { ...request('job-1:subrequest:1'), items: [{ elementId: 'element-2', attempt: 1, projection: { elementId: 'element-2', sourceContentHash: 'b'.repeat(64) } }], visualInput: { mode: 'individual', images: [{ elementId: 'element-2', mediaType: 'image/jpeg', dataBase64: 'preview-2' }] } } }] }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ providerBatchId: 'provider-batch-1' })
    expect(submitted).toHaveLength(2)
    expect(submitted.every(request => {
      const content = request.input.messages[0]?.content
      return Array.isArray(content) && content.some(block => block.type === 'image')
    })).toBe(true)
    expect(syncCalled).toBe(false)
  })

  test('retrieves by durable provider batch id and returns per-subrequest usage', async () => {
    let retrievedId = ''
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: {
        generate: async () => '{}',
        batch: {
          submit: async () => ({ providerBatchId: 'unused' }),
          retrieve: async (providerBatchId, context) => {
            retrievedId = `${providerBatchId}:${context.querySource}`
            return {
              status: 'ended',
              results: [{ customId: 'job-1:subrequest:0', status: 'succeeded', generation: {
                content: JSON.stringify({ decisions: [{ element_id: 'element-1', source_content_hash: 'a'.repeat(64), usageTags: [], confidence: 'low', evidence: [{ source: 'content_preview', reference: 'element-1', observation: 'Rendered preview.' }], curator_revision: 'semantic-curator-v1' }] }),
                usage: { input_tokens: 100, cache_read_tokens: 20, cache_creation_tokens: 5, output_tokens: 30, total_tokens: 155 },
              } }],
            }
          },
        },
      },
      resourceSelectionRuntimeConfig: { baseUrl: 'http://resource.test', serviceToken: 'resource-token' },
    })

    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST', headers: { 'x-beegame-resource-service-token': 'resource-token', 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'retrieve', ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, providerBatchId: 'provider-batch-1', jobId: 'job-1', batchId: 'batch-1' }),
    }))

    expect(response.status).toBe(200)
    expect(retrievedId).toContain('provider-batch-1')
    expect(await response.json()).toEqual(expect.objectContaining({ status: 'ended', results: [expect.objectContaining({ customId: 'job-1:subrequest:0', status: 'succeeded', content: expect.stringContaining('element-1'), usage: expect.objectContaining({ totalTokens: 155 }) })] }))
  })

  test('does not expose the bridge without the existing resource service token', async () => {
    const app = createAgentWorkflowApp({ currentUser: { id: 'owner-1', role: 'owner' }, resourceSelectionRuntimeConfig: { baseUrl: 'http://resource.test', serviceToken: 'resource-token' }, modelRuntimeHost: { generate: async () => '{}' } })
    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', { method: 'POST' }))
    expect(response.status).toBe(401)
  })

  test('rejects a submit request without rendered visual input before invoking batch runtime', async () => {
    let called = false
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: { generate: async () => '{}', batch: { submit: async () => { called = true; return { providerBatchId: 'unexpected' } }, retrieve: async () => ({ status: 'processing' }) } },
      resourceSelectionRuntimeConfig: { baseUrl: 'http://resource.test', serviceToken: 'resource-token' },
    })
    const invalid = { ...request(), visualInput: undefined }
    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST', headers: { 'x-beegame-resource-service-token': 'resource-token', 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'submit', requests: [{ customId: invalid.customId, request: invalid }] }),
    }))
    expect(response.status).toBe(400)
    expect(called).toBe(false)
  })

  test('keeps the canonical resource vocabulary and evidence source contract in the route prompt', () => {
    expect(RESOURCE_USAGE_TAGS).toContain('environment')
    expect(RESOURCE_SEMANTIC_EVIDENCE_SOURCES).toContain('content_preview')
    expect(RESOURCE_SEMANTIC_MODEL_TOOL_NAME).toBe('submit_resource_semantic_batch')
    expect(RESOURCE_SEMANTIC_MODEL_OUTPUT_SCHEMA).toHaveProperty('properties')
  })
})
