import { describe, expect, test } from 'bun:test'
import type { ResourceElement } from '@bee-game-studio/beegame-resource-core'
import {
  buildResourceSemanticContentProjection,
  buildResourceSemanticVisualInput,
} from '../semantic-curation-evidence'
import { renderResourceModelPreview } from '../model-preview'
import {
  ResourceSemanticModelConfigurationError,
  ResourceSemanticModelResponseError,
  createResourceSemanticModelClient,
} from '../semantic-curation-model'
import { resolveResourceSemanticPreviewKind } from '../index'

const element: ResourceElement = {
  id: 'element-1', packId: 'pack-1', name: 'Tower Mesh', path: 'models/tower.glb',
  category: 'models', kind: 'model', assetKind: 'model',
  specs: { contentHash: 'b'.repeat(64), meshCount: 1, materialCount: 1 },
  contentProfile: {
    packaging: 'self-contained', components: [{ id: 'mesh:0', kind: 'mesh' }],
    inspection: { status: 'complete', source: 'server' },
  },
  preview: { kind: 'model', path: 'models/tower.glb' },
  dependencies: [], status: 'ready',
}

const responseDecision = {
  element_id: 'element-1',
  source_content_hash: 'b'.repeat(64),
  usageTags: ['building'],
  confidence: 'high',
  evidence: [{ source: 'content_preview', reference: 'element-1', observation: 'The rendered preview shows a building-like mesh.' }],
  curator_revision: 'semantic-curator-v1',
}
const responseUsage = {
  inputTokens: 100,
  cacheReadTokens: 20,
  cacheCreationTokens: 5,
  outputTokens: 30,
  totalTokens: 155,
  creditsMicro: 700,
}
describe('resource semantic model adapter', () => {
  test('uses individual rendered previews for one or two resources and Atlas for more than two', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const one = new File([png], 'one.png', { type: 'image/png' })
    const two = new File([png], 'two.png', { type: 'image/png' })
    const three = new File([png], 'three.png', { type: 'image/png' })

    const oneInput = await buildResourceSemanticVisualInput([{ elementId: 'element-1', file: one }])
    const twoInput = await buildResourceSemanticVisualInput([
      { elementId: 'element-1', file: one },
      { elementId: 'element-2', file: two },
    ])
    const threeInput = await buildResourceSemanticVisualInput([
      { elementId: 'element-1', file: one },
      { elementId: 'element-2', file: two },
      { elementId: 'element-3', file: three },
    ])

    expect(oneInput.mode).toBe('individual')
    expect(twoInput.mode).toBe('individual')
    expect(threeInput.mode).toBe('atlas')
    if (threeInput.mode === 'atlas') {
      expect(threeInput.cells).toEqual([
        { ordinal: 0, elementId: 'element-1' },
        { ordinal: 1, elementId: 'element-2' },
        { ordinal: 2, elementId: 'element-3' },
      ])
    }
  })

  test('normalizes rendered image bytes into the visual input contract', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const input = await buildResourceSemanticVisualInput([
      { elementId: 'element-1', file: new File([png], 'image.png', { type: 'image/png' }) },
      { elementId: 'element-2', file: new File([png], 'image.png', { type: 'image/png' }) },
    ])
    expect(input.mode).toBe('individual')
    if (input.mode === 'individual') expect(input.images.every(image => image.mediaType === 'image/jpeg' && image.dataBase64.length > 0)).toBe(true)
  })

  test('includes a generated model preview in the same Atlas as ordinary images', async () => {
    const modelPreview = await renderResourceModelPreview({
      meshes: [{
        vertices: [[-1, 0, 0], [1, 0, 0], [0, 2, 0]],
        faces: [[0, 1, 2]],
      }],
    })
    const visualInput = await buildResourceSemanticVisualInput([
      { elementId: 'model-1', file: modelPreview! },
    ])

    expect(visualInput.mode).toBe('individual')
    if (visualInput.mode === 'individual') expect(visualInput.images[0]?.elementId).toBe('model-1')
  })

  test('projects inspected facts without exposing filenames or paths', () => {
    const projection = buildResourceSemanticContentProjection(element)

    expect(projection.elementId).toBe('element-1')
    expect(projection.sourceContentHash).toBe('b'.repeat(64))
    expect(Object.hasOwn(projection, 'name')).toBe(false)
    expect(Object.hasOwn(projection, 'path')).toBe(false)
    expect(projection.dependencySummary).toEqual({ declaredCount: 0, boundCount: 0, relationKinds: [] })
    expect(projection).not.toHaveProperty('preview')
  })

  test('derives the required model preview from canonical element kind when legacy rows lack preview metadata', () => {
    expect(resolveResourceSemanticPreviewKind({ ...element, preview: undefined })).toBe('model')
  })

  test('sends one structured batch request and returns decisions with matching content hashes', async () => {
    let requestInit: RequestInit | undefined
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async (_input, init) => {
        requestInit = init
        return new Response(JSON.stringify({ content: JSON.stringify({ decisions: [responseDecision] }), usage: responseUsage }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })

    const result = await client.classifyBatch({
      ownerId: 'owner-1',
      modelConfigId: 'model-1',
      modelType: 'anthropic',
      runtimeEnv: { OPENAI_API_KEY: 'secret' },
      packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
      items: [{ elementId: 'element-1', attempt: 2, projection: buildResourceSemanticContentProjection(element) }],
      visualInput: await createTestVisualInput('element-1'),
    })

    expect(result.decisions[0]?.usageTags).toEqual(['building'])
    expect(result.usage).toEqual(responseUsage)
    expect(requestInit?.signal).toBeUndefined()
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(body.ownerId).toBe('owner-1')
    expect(body.modelConfigId).toBe('model-1')
    expect(body.modelType).toBe('anthropic')
    expect(body.packId).toBe('pack-1')
    expect(body.jobId).toBe('job-1')
    expect(body.batchId).toBe('batch-1')
    expect(body.curatorRevision).toBe('semantic-curator-v1')
    expect(body.items).toEqual([expect.objectContaining({ elementId: 'element-1', attempt: 2 })])
    expect(body).toHaveProperty('runtimeEnv')
    expect(requestInit?.headers).toEqual(expect.objectContaining({ 'x-beegame-resource-service-token': 'server-token' }))
  })

  test('rejects a model batch without rendered visual input before sending it to the runtime', async () => {
    let called = false
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => { called = true; return new Response('{}', { status: 500 }) },
    })

    await expect(client.classifyBatch({
      ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {},
      packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
      items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }],
      visualInput: undefined as never,
    })).rejects.toThrow('visual input')
    expect(called).toBe(false)
  })

  test('rejects a visual decision that does not cite rendered preview evidence', async () => {
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => new Response(JSON.stringify({ content: JSON.stringify({ decisions: [{ ...responseDecision, evidence: [{ source: 'technical_facts', reference: 'meshCount', observation: 'A mesh is present.' }] }] }) }), { status: 200 }),
    })

    await expect(client.classifyBatch({
      ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {},
      packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
      items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }],
      visualInput: await createTestVisualInput('element-1'),
    })).rejects.toThrow('content_preview')
  })

  test('rejects partial configuration and unsafe model responses', async () => {
    expect(() => createResourceSemanticModelClient({ runtimeServerUrl: '', serviceToken: 'token' })).toThrow(ResourceSemanticModelConfigurationError)
    expect(() => createResourceSemanticModelClient({ runtimeServerUrl: 'https://runtime.example.test', serviceToken: '' })).toThrow(ResourceSemanticModelConfigurationError)
    expect(() => createResourceSemanticModelClient({ runtimeServerUrl: 'file:///tmp/model', serviceToken: 'token' })).toThrow(ResourceSemanticModelConfigurationError)

    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => new Response(JSON.stringify({ content: JSON.stringify({ ...responseDecision, source_content_hash: 'c'.repeat(64) }) }), { status: 200 }),
    })
    await expect(client.classifyBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {}, packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1', items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }], visualInput: await createTestVisualInput('element-1') })).rejects.toThrow(ResourceSemanticModelResponseError)
  })

  test('preserves the runtime failure stage from a rejected batch request', async () => {
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => new Response(JSON.stringify({
        error: 'Resource semantic runtime failed',
        code: 'resource_semantic_runtime_failed',
        stage: 'usage_billing',
        message: 'unknown certificate verification error',
        traceId: 'trace-1',
      }), { status: 502 }),
    })

    await expect(client.classifyBatch({
      ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {},
      packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
      items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }],
      visualInput: await createTestVisualInput('element-1'),
    })).rejects.toEqual(expect.objectContaining({
      name: 'ResourceSemanticModelResponseError',
      stage: 'usage_billing',
      traceId: 'trace-1',
      message: 'unknown certificate verification error',
    }))
  })

  test('rejects a decision for another element', async () => {
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
        fetchImpl: async () => new Response(JSON.stringify({ content: JSON.stringify({ decisions: [{ ...responseDecision, element_id: 'element-2' }] }) }), { status: 200 }),
    })
    await expect(client.classifyBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {}, packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1', items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }], visualInput: await createTestVisualInput('element-1') })).rejects.toThrow(ResourceSemanticModelResponseError)
  })

  test('rejects an incomplete or duplicate batch before any commit can occur', async () => {
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => new Response(JSON.stringify({ content: JSON.stringify({ decisions: [responseDecision, responseDecision] }) }), { status: 200 }),
    })
    const item = { elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }
    await expect(client.classifyBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {}, packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1', items: [item], visualInput: await createTestVisualInput('element-1') })).rejects.toThrow('count does not match')
  })

  test('rejects markdown, prose, and truncated semantic model content without parsing a fallback format', async () => {
    for (const content of [
      '```json\n{"decisions": []}\n```',
      'Here is the result: {"decisions": []}',
      '{"decisions":',
    ]) {
      const client = createResourceSemanticModelClient({
        runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
        fetchImpl: async () => new Response(JSON.stringify({ content }), { status: 200 }),
      })
      await expect(client.classifyBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {}, packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1', items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }], visualInput: await createTestVisualInput('element-1') })).rejects.toThrow('content must be JSON')
    }
  })

  test('reports unexpected top-level response fields instead of hiding protocol contamination', async () => {
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => new Response(JSON.stringify({
        content: JSON.stringify({ decisions: [responseDecision], batchId: 'batch-1' }),
      }), { status: 200 }),
    })

    await expect(client.classifyBatch({
      ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {},
      packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1',
      items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }],
      visualInput: await createTestVisualInput('element-1'),
    })).rejects.toThrow('unexpected top-level fields: batchId')
  })

  test('rejects file format names used as evidence sources', async () => {
    const client = createResourceSemanticModelClient({
      runtimeServerUrl: 'https://runtime.example.test', serviceToken: 'server-token',
      fetchImpl: async () => new Response(JSON.stringify({ content: JSON.stringify({ decisions: [{ ...responseDecision, evidence: [{ source: 'fbx', reference: 'format', observation: 'A model file.' }] }] }) }), { status: 200 }),
    })
    await expect(client.classifyBatch({ ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: {}, packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1', items: [{ elementId: 'element-1', attempt: 1, projection: buildResourceSemanticContentProjection(element) }], visualInput: await createTestVisualInput('element-1') })).rejects.toThrow('evidence source is unsupported')
  })
})

async function createTestVisualInput(elementId: string) {
  const preview = await renderResourceModelPreview({
    meshes: [{
      vertices: [[-1, 0, 0], [1, 0, 0], [0, 2, 0]],
      faces: [[0, 1, 2]],
    }],
  })
  return buildResourceSemanticVisualInput([{ elementId, file: preview! }])
}
