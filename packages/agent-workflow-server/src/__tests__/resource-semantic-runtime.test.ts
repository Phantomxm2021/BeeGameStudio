import { describe, expect, test } from 'bun:test'
import { RESOURCE_SEMANTIC_EVIDENCE_SOURCES, RESOURCE_USAGE_TAGS } from '../../../beegame-resource-core/src/types'
import { RESOURCE_SEMANTIC_MODEL_OUTPUT_SCHEMA, RESOURCE_SEMANTIC_MODEL_TOOL_NAME } from '../../../beegame-resource-core/src/semantic-curation'
import { createAgentWorkflowApp } from '../app'
import { BeeGameUsageBillingError } from '@bee-game-studio/beegame-billing-core/usage-control-client'

const SINGLE_VISUAL_INPUT = {
  mode: 'individual',
  images: [{ elementId: 'element-1', mediaType: 'image/jpeg', dataBase64: 'rendered-preview' }],
} as const

const THREE_ATLAS_VISUAL_INPUT = {
  mode: 'atlas',
  image: { mediaType: 'image/jpeg', dataBase64: 'rendered-atlas' },
  cells: [
    { ordinal: 0, elementId: 'element-1' },
    { ordinal: 1, elementId: 'element-2' },
    { ordinal: 2, elementId: 'element-3' },
  ],
} as const

describe('resource semantic model runtime bridge', () => {
  test('runs semantic curation through the existing model runtime with the supplied backend config', async () => {
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: {
        generate: async () => '{}',
        generateWithUsage: async input => {
          expect((input as { modelType?: string }).modelType).toBe('anthropic')
          expect(input.runtimeEnv).toEqual({ OPENAI_API_KEY: 'backend-secret' })
          expect(input.querySource).toContain('beegame_resource_semantic_curation')
          expect(input.maxTokens).toBeGreaterThan(1024)
          const userText = (input.messages[0]?.content[0] as { text?: string }).text ?? ''
          expect(userText).not.toContain('batchId')
          expect(userText).not.toContain('curatorRevision')
          expect(input.systemPrompt).toContain('curator_revision must be exactly "semantic-curator-v1"')
          expect(input.systemPrompt).toContain(`Canonical usageTags are exactly: ${RESOURCE_USAGE_TAGS.join(', ')}`)
          expect(input.systemPrompt).toContain(`Evidence source is exactly one of: ${RESOURCE_SEMANTIC_EVIDENCE_SOURCES.join(', ')}`)
          expect(input.structuredOutput).toEqual({
            name: RESOURCE_SEMANTIC_MODEL_TOOL_NAME,
            description: expect.any(String),
            inputSchema: RESOURCE_SEMANTIC_MODEL_OUTPUT_SCHEMA,
          })
          return {
            content: JSON.stringify({
              decisions: [{
                element_id: 'element-1',
                source_content_hash: 'a'.repeat(64),
                usageTags: [],
                confidence: 'low',
                evidence: [{ source: 'technical_facts', reference: 'contentHash', observation: 'The content hash is present.' }],
                curator_revision: 'semantic-curator-v1',
              }],
            }),
            usage: { input_tokens: 100, cache_read_tokens: 20, cache_creation_tokens: 5, output_tokens: 30, total_tokens: 155 },
          }
        },
      },
      resourceSelectionRuntimeConfig: {
        baseUrl: 'http://resource.test',
        serviceToken: 'resource-token',
      },
    })

    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST',
      headers: {
        'x-beegame-resource-service-token': 'resource-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ownerId: 'owner-1',
        modelConfigId: 'model-1',
        modelType: 'anthropic',
        runtimeEnv: { OPENAI_API_KEY: 'backend-secret' },
        packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
        items: [{ elementId: 'element-1', attempt: 2, projection: { elementId: 'element-1', sourceContentHash: 'a'.repeat(64) } }],
        visualInput: SINGLE_VISUAL_INPUT,
      }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ content: expect.stringContaining('element-1'), usage: expect.objectContaining({ inputTokens: 100, totalTokens: 155 }) }))
  })

  test('does not expose the bridge without the existing resource service token', async () => {
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      resourceSelectionRuntimeConfig: { baseUrl: 'http://resource.test', serviceToken: 'resource-token' },
      modelRuntimeHost: { generate: async () => '{}' },
    })
    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', { method: 'POST' }))
    expect(response.status).toBe(401)
  })

  test('rejects a model projection without rendered visual input before invoking the model runtime', async () => {
    let called = false
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: {
        generate: async () => '{}',
        generateWithUsage: async () => { called = true; return { content: '{}' } },
      },
      resourceSelectionRuntimeConfig: { baseUrl: 'http://resource.test', serviceToken: 'resource-token' },
    })

    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST',
      headers: { 'x-beegame-resource-service-token': 'resource-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { OPENAI_API_KEY: 'secret' },
        packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
        items: [{ elementId: 'element-1', attempt: 1, projection: { elementId: 'element-1', sourceContentHash: 'a'.repeat(64), preview: { kind: 'model' } } }],
      }),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Resource semantic visual input mode is required' })
    expect(called).toBe(false)
  })

  test('sends one Atlas image for a batch larger than two resources', async () => {
    let imageBlockCount = -1
    let userText = ''
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: {
        generate: async () => '{}',
        generateWithUsage: async input => {
          const messageContent = input.messages[0]?.content
          const content = Array.isArray(messageContent) ? messageContent : []
          imageBlockCount = content.filter(block => block.type === 'image').length
          userText = (content.find(block => block.type === 'text') as { text?: string } | undefined)?.text ?? ''
          return {
            content: JSON.stringify({ decisions: [
              { element_id: 'element-1', source_content_hash: 'a'.repeat(64), usageTags: [], confidence: 'low', evidence: [{ source: 'content_preview', reference: 'element-1', observation: 'Rendered atlas cell.' }], curator_revision: 'semantic-curator-v1' },
              { element_id: 'element-2', source_content_hash: 'b'.repeat(64), usageTags: [], confidence: 'low', evidence: [{ source: 'content_preview', reference: 'element-2', observation: 'Rendered atlas cell.' }], curator_revision: 'semantic-curator-v1' },
              { element_id: 'element-3', source_content_hash: 'c'.repeat(64), usageTags: [], confidence: 'low', evidence: [{ source: 'content_preview', reference: 'element-3', observation: 'Rendered atlas cell.' }], curator_revision: 'semantic-curator-v1' },
            ] }),
          }
        },
      },
      resourceSelectionRuntimeConfig: { baseUrl: 'http://resource.test', serviceToken: 'resource-token' },
    })

    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST',
      headers: { 'x-beegame-resource-service-token': 'resource-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { OPENAI_API_KEY: 'secret' },
        packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
        items: [
          { elementId: 'element-1', attempt: 1, projection: { elementId: 'element-1', sourceContentHash: 'a'.repeat(64) } },
          { elementId: 'element-2', attempt: 1, projection: { elementId: 'element-2', sourceContentHash: 'b'.repeat(64) } },
          { elementId: 'element-3', attempt: 1, projection: { elementId: 'element-3', sourceContentHash: 'c'.repeat(64) } },
        ],
        visualInput: THREE_ATLAS_VISUAL_INPUT,
      }),
    }))

    expect(response.status).toBe(200)
    expect(imageBlockCount).toBe(1)
    expect(userText).toContain('"mode":"atlas"')
    expect(userText).toContain('"elementId":"element-3"')
  })

  test('returns the runtime failure detail to the resource worker as a dependency error', async () => {
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: {
        generate: async () => '{}',
        generateWithUsage: async () => {
          throw new Error('provider rejected the semantic tool request')
        },
      },
      resourceSelectionRuntimeConfig: {
        baseUrl: 'http://resource.test',
        serviceToken: 'resource-token',
      },
    })

    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST',
      headers: {
        'x-beegame-resource-service-token': 'resource-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ownerId: 'owner-1',
        modelConfigId: 'model-1',
        modelType: 'anthropic',
        runtimeEnv: { OPENAI_API_KEY: 'backend-secret' },
        packId: 'pack-1',
        jobId: 'job-1',
        batchId: 'batch-1',
        curatorRevision: 'semantic-curator-v1',
        items: [{
          elementId: 'element-1',
          attempt: 2,
          projection: { elementId: 'element-1', sourceContentHash: 'a'.repeat(64) },
        }],
        visualInput: SINGLE_VISUAL_INPUT,
      }),
    }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: 'Resource semantic runtime failed',
      code: 'resource_semantic_runtime_failed',
      stage: 'model_request',
      message: 'provider rejected the semantic tool request',
      traceId: expect.any(String),
    })
  })

  test('returns usage billing failures as usage failures instead of model failures', async () => {
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      modelRuntimeHost: {
        generate: async () => '{}',
        generateWithUsage: async () => {
          throw new BeeGameUsageBillingError('billing transport failed', true)
        },
      },
      resourceSelectionRuntimeConfig: {
        baseUrl: 'http://resource.test',
        serviceToken: 'resource-token',
      },
    })

    const response = await app.fetch(new Request('http://runtime.test/api/internal/resource-semantic-curation', {
      method: 'POST',
      headers: {
        'x-beegame-resource-service-token': 'resource-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ownerId: 'owner-1',
        modelConfigId: 'model-1',
        modelType: 'anthropic',
        runtimeEnv: { OPENAI_API_KEY: 'backend-secret' },
        packId: 'pack-1',
        jobId: 'job-1',
        batchId: 'batch-1',
        curatorRevision: 'semantic-curator-v1',
        items: [{
          elementId: 'element-1',
          attempt: 2,
          projection: { elementId: 'element-1', sourceContentHash: 'a'.repeat(64) },
        }],
        visualInput: SINGLE_VISUAL_INPUT,
      }),
    }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: 'Resource semantic runtime failed',
      code: 'resource_semantic_runtime_failed',
      stage: 'usage_billing',
      message: 'billing transport failed',
      traceId: expect.any(String),
    })
  })
})
