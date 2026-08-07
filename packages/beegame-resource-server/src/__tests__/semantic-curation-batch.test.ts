import { describe, expect, test } from 'bun:test'
import { buildResourceSemanticSubrequests, convertResourceSemanticProviderResults } from '../semantic-curation-batch'

describe('resource semantic provider batch partitioning', () => {
  test('partitions 161 resources into one native batch of 21 independent subrequests', () => {
    const contexts = Array.from({ length: 161 }, (_, index) => ({ elementId: `element-${index + 1}`, sourceContentHash: `${index + 1}`.repeat(64).slice(0, 64), curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1', jobId: 'job-1', attempt: 1 }))
    const requests = buildResourceSemanticSubrequests({
      batchId: 'batch-1', contexts,
      requestFor: (items, customId) => ({ customId, ownerId: 'owner-1', modelConfigId: 'model-1', modelType: 'anthropic', runtimeEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, packId: 'pack-1', jobId: 'job-1', batchId: 'batch-1', curatorRevision: 'semantic-curator-v1', items: items.map(item => ({ elementId: item.elementId, attempt: item.attempt, projection: { elementId: item.elementId, sourceContentHash: item.sourceContentHash!, category: 'models', technicalFacts: {}, dependencySummary: { declaredCount: 0, boundCount: 0, relationKinds: [] } } })), visualInput: { mode: 'individual', images: [{ elementId: items[0]!.elementId, mediaType: 'image/jpeg', dataBase64: 'preview' }] } }),
    })
    expect(requests).toHaveLength(21)
    expect(requests.map(request => request.items.length)).toEqual([...Array(20).fill(8), 1])
    expect(requests.slice(0, 2).map(request => request.customId)).toEqual(['batch-1:subrequest:0', 'batch-1:subrequest:1'])
    expect(requests.at(-1)?.customId).toBe('batch-1:subrequest:20')
  })

  test('matches results by custom id and scopes failed results to only their subrequest', async () => {
    const requests = [
      { customId: 'batch-1:subrequest:0', curatorRevision: 'semantic-curator-v1', items: [{ elementId: 'element-1', attempt: 1, projection: { elementId: 'element-1', sourceContentHash: '1'.repeat(64) } }] },
      { customId: 'batch-1:subrequest:1', curatorRevision: 'semantic-curator-v1', items: [{ elementId: 'element-2', attempt: 1, projection: { elementId: 'element-2', sourceContentHash: '2'.repeat(64) } }, { elementId: 'element-3', attempt: 1, projection: { elementId: 'element-3', sourceContentHash: '3'.repeat(64) } }] },
    ]
    const success = (elementId: string, hash: string) => JSON.stringify({ decisions: [{ element_id: elementId, source_content_hash: hash, usageTags: [], confidence: 'low', evidence: [{ source: 'content_preview', reference: elementId, observation: 'Rendered preview.' }], curator_revision: 'semantic-curator-v1' }] })
    const receipt = await convertResourceSemanticProviderResults({
      batchId: 'batch-1', requests,
      results: [
        { customId: requests[1]!.customId, status: 'errored', error: 'subrequest failed' },
        { customId: requests[0]!.customId, status: 'succeeded', content: success('element-1', '1'.repeat(64)) },
      ],
    })
    expect(receipt.items.map(item => item.elementId)).toEqual(['element-1'])
    expect(receipt.retryItems.map(item => item.elementId)).toEqual(['element-2', 'element-3'])
  })
})
