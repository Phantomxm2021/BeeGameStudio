import type { ResourceProcessingBatchContext, ResourceProcessingBatchReceipt, ResourceProcessingBatchRetry, ResourceProcessingUsage } from './resource-processing-jobs'
import { parseResourceSemanticModelContent, type ResourceSemanticModelBatchRequest } from './semantic-curation-model'

export type ResourceSemanticModelSubrequestMetadata = {
  customId: string
  curatorRevision: string
  items: readonly { elementId: string; attempt: number; projection: { elementId: string; sourceContentHash: string } }[]
}

export function partitionResourceSemanticBatch<T>(items: readonly T[], maxItems = 8): T[][] {
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) throw new Error('Resource semantic provider batch partition size is invalid')
  const result: T[][] = []
  for (let index = 0; index < items.length; index += maxItems) result.push(items.slice(index, index + maxItems))
  return result
}

export function resourceSemanticSubrequestId(batchId: string, ordinal: number): string {
  return `${batchId}:subrequest:${ordinal}`
}

export function buildResourceSemanticSubrequests(input: {
  batchId: string
  contexts: readonly ResourceProcessingBatchContext[]
  requestFor: (contexts: readonly ResourceProcessingBatchContext[], customId: string) => ResourceSemanticModelBatchRequest
}): ResourceSemanticModelBatchRequest[] {
  return partitionResourceSemanticBatch(input.contexts).map((contexts, ordinal) => input.requestFor(contexts, resourceSemanticSubrequestId(input.batchId, ordinal)))
}

export function buildResourceSemanticSubrequestMetadata(input: {
  batchId: string
  contexts: readonly ResourceProcessingBatchContext[]
  requestFor: (contexts: readonly ResourceProcessingBatchContext[], customId: string) => ResourceSemanticModelSubrequestMetadata
}): ResourceSemanticModelSubrequestMetadata[] {
  return partitionResourceSemanticBatch(input.contexts).map((contexts, ordinal) => input.requestFor(contexts, resourceSemanticSubrequestId(input.batchId, ordinal)))
}

export async function convertResourceSemanticProviderResults(input: {
  batchId: string
  requests: readonly ResourceSemanticModelSubrequestMetadata[]
  results: readonly {
    customId: string
    status: 'succeeded' | 'errored' | 'cancelled' | 'expired'
    content?: string
    usage?: ResourceProcessingUsage
    error?: string
  }[]
  commitDecision?: (decision: Awaited<ReturnType<typeof parseResourceSemanticModelContent>>['decisions'][number]) => Promise<{ receiptId: string }>
}): Promise<ResourceProcessingBatchReceipt> {
  const requestById = new Map(input.requests.map(request => [request.customId, request]))
  const items: { elementId: string; receiptId: string }[] = []
  const retryItems: ResourceProcessingBatchRetry[] = []
  let usage: ResourceProcessingUsage | undefined
  const seen = new Set<string>()
  for (const result of input.results) {
    const request = requestById.get(result.customId)
    if (!request) throw new Error(`Resource semantic provider batch returned unknown custom id ${result.customId}`)
    if (result.status !== 'succeeded' || !result.content) {
      for (const item of request.items) retryItems.push({ elementId: item.elementId, error: result.error?.trim() || `Resource semantic provider batch result ${result.status}` })
      continue
    }
    const parsed = parseResourceSemanticModelContent(request, result.content, result.usage)
    usage = addUsage(usage, parsed.usage)
    for (const decision of parsed.decisions) {
      if (seen.has(decision.elementId)) throw new Error('Resource semantic provider batch returned a duplicate element')
      seen.add(decision.elementId)
      const committed = input.commitDecision
        ? await input.commitDecision(decision)
        : { receiptId: `${input.batchId}:${result.customId}:${decision.elementId}` }
      items.push({ elementId: decision.elementId, receiptId: committed.receiptId })
    }
  }
  const returnedIds = new Set([...items.map(item => item.elementId), ...retryItems.map(item => item.elementId)])
  for (const request of input.requests) {
    for (const item of request.items) {
      if (!returnedIds.has(item.elementId)) retryItems.push({ elementId: item.elementId, error: 'Resource semantic provider batch did not return a result' })
    }
  }
  return { batchId: input.batchId, items, retryItems, ...(usage ? { usage } : {}) }
}

function addUsage(left: ResourceProcessingUsage | undefined, right: ResourceProcessingUsage | undefined): ResourceProcessingUsage | undefined {
  if (!left && !right) return undefined
  return {
    inputTokens: (left?.inputTokens ?? 0) + (right?.inputTokens ?? 0),
    cacheReadTokens: (left?.cacheReadTokens ?? 0) + (right?.cacheReadTokens ?? 0),
    cacheCreationTokens: (left?.cacheCreationTokens ?? 0) + (right?.cacheCreationTokens ?? 0),
    outputTokens: (left?.outputTokens ?? 0) + (right?.outputTokens ?? 0),
    totalTokens: (left?.totalTokens ?? 0) + (right?.totalTokens ?? 0),
    creditsMicro: (left?.creditsMicro ?? 0) + (right?.creditsMicro ?? 0),
  }
}
