import {
  assertResourceSemanticVisualDecision,
  assertResourceSemanticVisualInput,
  parseResourceSemanticModelDecision,
  withResourceExternalTransport,
  type ResourceSemanticContentProjection,
  type ResourceSemanticModelDecision,
  type ResourceSemanticRuntimeFailureStage,
  type ResourceSemanticVisualInput,
} from '@bee-game-studio/beegame-resource-core'
import type { RuntimeModelConfig } from '@bee-game-studio/agent-workflow'
import type { ResourceProcessingUsage } from './resource-processing-jobs'

type ResourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class ResourceSemanticModelConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceSemanticModelConfigurationError'
  }
}

export class ResourceSemanticModelResponseError extends Error {
  readonly usage?: ResourceProcessingUsage
  readonly stage?: ResourceSemanticRuntimeFailureStage
  readonly traceId?: string

  constructor(
    message: string,
    usage?: ResourceProcessingUsage,
    options: {
      stage?: ResourceSemanticRuntimeFailureStage
      traceId?: string
    } = {},
  ) {
    super(message)
    this.name = 'ResourceSemanticModelResponseError'
    this.usage = usage
    this.stage = options.stage
    this.traceId = options.traceId
  }
}

export type ResourceSemanticModelBatchItem = {
  elementId: string
  attempt: number
  projection: ResourceSemanticContentProjection
}

export type ResourceSemanticModelBatchRequest = {
  ownerId: string
  modelConfigId: string
  modelType: RuntimeModelConfig['modelType']
  runtimeEnv: Record<string, string>
  packId: string
  jobId: string
  batchId: string
  curatorRevision: string
  items: readonly ResourceSemanticModelBatchItem[]
  visualInput: ResourceSemanticVisualInput
}

export type ResourceSemanticModelBatchResult = {
  decisions: readonly ResourceSemanticModelDecision[]
  usage?: ResourceProcessingUsage
}

export type ResourceSemanticModelClient = {
  classifyBatch(input: ResourceSemanticModelBatchRequest): Promise<ResourceSemanticModelBatchResult>
}

export function createResourceSemanticModelClient(options: {
  runtimeServerUrl: string
  serviceToken: string
  fetchImpl?: ResourceFetch
}): ResourceSemanticModelClient {
  const endpoint = validateEndpoint(options.runtimeServerUrl)
  const serviceToken = options.serviceToken.trim()
  if (!serviceToken) throw new ResourceSemanticModelConfigurationError('Resource service token is required')
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async classifyBatch(input) {
      if (!input.ownerId.trim() || !input.modelConfigId.trim()) {
        throw new ResourceSemanticModelResponseError('Resource semantic model identity is required')
      }
      if (!input.batchId.trim() || !input.curatorRevision.trim() || input.items.length === 0 || input.items.length > 8) {
        throw new ResourceSemanticModelResponseError('Resource semantic model batch is invalid')
      }
      const ids = new Set<string>()
      for (const item of input.items) {
        if (!item.elementId.trim() || item.attempt < 1 || ids.has(item.elementId) || item.projection.elementId !== item.elementId) {
          throw new ResourceSemanticModelResponseError('Resource semantic model batch item identity is invalid')
        }
        ids.add(item.elementId)
      }
      try {
        assertResourceSemanticVisualInput(input.visualInput, ids)
      } catch (error) {
        throw new ResourceSemanticModelResponseError(error instanceof Error ? error.message : 'Resource semantic visual input is invalid')
      }
      let response: Response
      try {
        response = await withResourceExternalTransport({
          service: 'resource-runtime',
          operation: 'semantic curation request',
          execute: () => fetchImpl(new URL('/api/internal/resource-semantic-curation', endpoint), {
            method: 'POST',
            headers: {
              authorization: `Bearer ${serviceToken}`,
              'content-type': 'application/json',
              'x-beegame-resource-service-token': serviceToken,
            },
            body: JSON.stringify(input),
          }),
        })
      } catch (error) {
        throw new ResourceSemanticModelResponseError(
          error instanceof Error ? error.message : 'Resource semantic runtime request failed',
          undefined,
          { stage: 'runtime_transport' },
        )
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        const runtimeFailure = parseRuntimeFailure(detail)
        throw new ResourceSemanticModelResponseError(
          runtimeFailure?.message ?? `Resource semantic runtime request failed (${response.status})${detail ? ` - ${detail}` : ''}`,
          undefined,
          runtimeFailure
            ? { stage: runtimeFailure.stage, traceId: runtimeFailure.traceId }
            : { stage: 'runtime_transport' },
        )
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new ResourceSemanticModelResponseError('Resource semantic model response must be JSON')
      }
      const usage = isRecord(body) ? parseResourceSemanticModelUsage(body.usage) : undefined
      const content = isRecord(body) && typeof body.content === 'string' ? body.content : ''
      if (!content.trim()) throw new ResourceSemanticModelResponseError('Resource semantic model response must contain JSON content', usage)
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch {
        throw new ResourceSemanticModelResponseError('Resource semantic model response content must be JSON', usage)
      }
      try {
        const unexpectedTopLevelFields = isRecord(parsed)
          ? Object.keys(parsed).filter(key => key !== 'decisions')
          : []
        if (!isRecord(parsed)) {
          throw new ResourceSemanticModelResponseError('Resource semantic model batch response must contain only decisions; top-level value must be an object', usage)
        }
        if (unexpectedTopLevelFields.length > 0) {
          throw new ResourceSemanticModelResponseError(
            `Resource semantic model batch response must contain only decisions; unexpected top-level fields: ${unexpectedTopLevelFields.join(', ')}`,
            usage,
          )
        }
        if (!Array.isArray(parsed.decisions)) {
          throw new ResourceSemanticModelResponseError('Resource semantic model batch response must contain only decisions; decisions must be an array', usage)
        }
        const decisions = parsed.decisions.map(parseResourceSemanticModelDecision)
        if (decisions.length !== input.items.length) throw new ResourceSemanticModelResponseError('Resource semantic model batch response count does not match', usage)
        const expected = new Map(input.items.map(item => [item.elementId, item.projection.sourceContentHash]))
        const seen = new Set<string>()
        for (const decision of decisions) {
          const expectedHash = expected.get(decision.elementId)
          if (!expectedHash || seen.has(decision.elementId)) throw new ResourceSemanticModelResponseError('Resource semantic model batch response contains an unknown or duplicate element', usage)
          if (decision.sourceContentHash !== expectedHash) throw new ResourceSemanticModelResponseError('Resource semantic model decision content hash is stale', usage)
          if (decision.curatorRevision !== input.curatorRevision) throw new ResourceSemanticModelResponseError('Resource semantic model decision curator revision does not match', usage)
          try {
            assertResourceSemanticVisualDecision(decision)
          } catch (error) {
            throw new ResourceSemanticModelResponseError(error instanceof Error ? error.message : 'Resource semantic decision lacks rendered preview evidence', usage)
          }
          seen.add(decision.elementId)
        }
        if (seen.size !== expected.size) throw new ResourceSemanticModelResponseError('Resource semantic model batch response is missing an element', usage)
        return { decisions, ...(usage ? { usage } : {}) }
      } catch (error) {
        if (error instanceof ResourceSemanticModelResponseError) {
          if (error.usage || !usage) throw error
          throw new ResourceSemanticModelResponseError(error.message, usage, {
            stage: error.stage,
            traceId: error.traceId,
          })
        }
        throw new ResourceSemanticModelResponseError(error instanceof Error ? error.message : 'Resource semantic model decision is invalid', usage)
      }
    },
  }
}

function validateEndpoint(value: string): string {
  const endpoint = value.trim()
  if (!endpoint) throw new ResourceSemanticModelConfigurationError('Workflow runtime URL is required')
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new ResourceSemanticModelConfigurationError('Workflow runtime URL must be a URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new ResourceSemanticModelConfigurationError('Workflow runtime URL is unsafe')
  }
  return parsed.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRuntimeFailure(value: string): {
  message: string
  stage: ResourceSemanticRuntimeFailureStage
  traceId?: string
} | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (!isRecord(parsed) || typeof parsed.message !== 'string' || !parsed.message.trim()) return undefined
    const stage = parsed.stage
    if (
      stage !== 'runtime_transport' &&
      stage !== 'model_request' &&
      stage !== 'model_response' &&
      stage !== 'usage_billing'
    ) return undefined
    return {
      message: parsed.message,
      stage,
      ...(typeof parsed.traceId === 'string' && parsed.traceId.trim()
        ? { traceId: parsed.traceId }
        : {}),
    }
  } catch {
    return undefined
  }
}

function parseResourceSemanticModelUsage(value: unknown): ResourceProcessingUsage | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ResourceSemanticModelResponseError('Resource semantic model usage must be an object')
  const usage: ResourceProcessingUsage = {
    inputTokens: value.inputTokens,
    cacheReadTokens: value.cacheReadTokens,
    cacheCreationTokens: value.cacheCreationTokens,
    outputTokens: value.outputTokens,
    totalTokens: value.totalTokens,
    creditsMicro: value.creditsMicro,
  } as ResourceProcessingUsage
  if (Object.values(usage).some(token => !Number.isSafeInteger(token) || token < 0)) {
    throw new ResourceSemanticModelResponseError('Resource semantic model usage contains invalid counters')
  }
  return usage
}
