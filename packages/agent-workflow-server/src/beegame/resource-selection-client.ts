import type {
  ResourceCatalogElement,
  ResourceRequirementMatchRequest,
  ResourceRequirementMatchResult,
} from '@bee-game-studio/beegame-resource-core'
import { serializeQueryEngineError } from './query-engine-worker-protocol'

export type ResourceSelectionElementRelation = {
  kind: string
  targetElementId: string
  role?: string
  required?: boolean
}
export type ResourceSelectionDependencyResult = {
  key: string
  parentKey: string
  elementId: string
  elementPath: string
  referencePath: string
  sourceUrl: string
  sourceHash: string
  kind?: string
}
export type ResourceSelectionResult = {
  packId: string
  packVersion: string
  packName?: string
  packStyles?: string[]
  packGameTypes?: string[]
  elementId: string
  elementName?: string
  elementPath: string
  category?: string
  usageTags?: string[]
  dimension?: '2D' | '3D' | 'agnostic'
  sourceUrl: string
  sourceHash: string
  assetKind?: string
  capabilities?: string[]
  contentProfile?: Record<string, unknown>
  technicalFacts?: Record<string, string | number | boolean>
  relations?: ResourceSelectionElementRelation[]
  dependencies?: ResourceSelectionDependencyResult[]
}
export type ResourceCatalogElementResult = ResourceCatalogElement
export type ResourceSelectionInput = {
  resourceId: string
  packId: string
  expectedPackVersion: string
  elementId: string
  destinationPath?: string
  selectionReason: string[]
}
export type ResourceResolvedSelection = ResourceSelectionResult & {
  resourceId: string
  destinationPath?: string
  selectionReason: string[]
}
export type ResourceRequirementMatchResponse = ResourceRequirementMatchResult & {
  catalogRevision: string
}

export function createResourceSelectionClient(options: {
  baseUrl: string
  serviceToken: string
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>
  transportRetryAttempts?: number
  transportRetryDelayMs?: number
}) {
  const fetchImpl = options.fetchImpl ?? fetch
  let baseUrl = options.baseUrl
  while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
  const transportRetryAttempts = Number.isFinite(options.transportRetryAttempts)
    ? Math.max(0, Math.trunc(options.transportRetryAttempts!))
    : 2
  const transportRetryDelayMs = Number.isFinite(options.transportRetryDelayMs)
    ? Math.max(0, Math.trunc(options.transportRetryDelayMs!))
    : 100
  return {
    async matchRequirements(
      input: ResourceRequirementMatchRequest,
    ): Promise<ResourceRequirementMatchResponse> {
      const response = await servicePost('/api/resource-catalog/matches', input)
      const body = await response.json().catch(() => undefined)
      if (!response.ok)
        throw new Error(
          errorMessage(body) ||
            `Resource requirement matching failed (${response.status})`,
        )
      return parseRequirementMatchResponse(body)
    },
    async resolveResources(
      catalogRevision: string,
      selections: ResourceSelectionInput[],
    ): Promise<ResourceResolvedSelection[]> {
      const response = await servicePost('/api/resource-library/resolve', {
        catalogRevision,
        selections,
      })
      const body = (await response.json().catch(() => undefined)) as
        | { selections?: unknown; error?: { message?: string } }
        | undefined
      if (!response.ok || !Array.isArray(body?.selections))
        throw new Error(
          body?.error?.message ||
            `Resource integration resolution failed (${response.status})`,
        )
      return body.selections.map(parseResolvedSelection)
    },
  }

  function servicePost(path: string, body: unknown) {
    return serviceFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: serviceHeaders(true),
      body: JSON.stringify(body),
    })
  }

  async function serviceFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchImpl(input, init)
      } catch (error) {
        const classified = serializeQueryEngineError(
          error,
          'Resource service transport failed',
        )
        if (!classified.retryable || attempt >= transportRetryAttempts)
          throw error
        const delayMs = transportRetryDelayMs * 2 ** attempt
        if (delayMs > 0)
          await new Promise<void>(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  function serviceHeaders(json: boolean) {
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      'x-beegame-resource-service-token': options.serviceToken,
    }
  }
}

export function parseRequirementMatchResponse(
  value: unknown,
): ResourceRequirementMatchResponse {
  if (
    !isRecord(value) ||
    typeof value.catalogRevision !== 'string' ||
    !value.catalogRevision.trim() ||
    !Array.isArray(value.groups)
  ) {
    throw new Error('Resource requirement match response is invalid')
  }
  return {
    catalogRevision: value.catalogRevision,
    groups: value.groups.map(group => {
      if (
        !isRecord(group) ||
        typeof group.requirementId !== 'string' ||
        !group.requirementId.trim() ||
        !['matched', 'no-match', 'unclassified'].includes(
          String(group.status),
        ) ||
        !Array.isArray(group.candidates) ||
        !Number.isSafeInteger(group.unclassifiedElementCount) ||
        Number(group.unclassifiedElementCount) < 0
      ) {
        throw new Error('Resource requirement match group is invalid')
      }
      return {
        requirementId: group.requirementId,
        status: group.status as 'matched' | 'no-match' | 'unclassified',
        candidates: group.candidates.map(candidate => {
          if (!isRecord(candidate) || !isRecord(candidate.delivery)) {
            throw new Error('Resource requirement match candidate is invalid')
          }
          const delivery = candidate.delivery
          if (
            typeof delivery.sourceFormat !== 'string' ||
            !delivery.sourceFormat.trim() ||
            typeof delivery.targetFormat !== 'string' ||
            !delivery.targetFormat.trim() ||
            !['direct', 'convert'].includes(String(delivery.disposition)) ||
            (delivery.adapterId !== undefined &&
              (typeof delivery.adapterId !== 'string' ||
                !delivery.adapterId.trim()))
          ) {
            throw new Error('Resource requirement match delivery is invalid')
          }
          return {
            ...parseCatalogElement(candidate),
            delivery: {
              sourceFormat: delivery.sourceFormat,
              disposition: delivery.disposition as 'direct' | 'convert',
              targetFormat: delivery.targetFormat,
              ...(typeof delivery.adapterId === 'string'
                ? { adapterId: delivery.adapterId }
                : {}),
            },
          }
        }),
        unclassifiedElementCount: Number(group.unclassifiedElementCount),
      }
    }),
  }
}

function parseCatalogElement(value: unknown): ResourceCatalogElement {
  if (!isRecord(value)) throw new Error('Resource catalog element is invalid')
  for (const key of [
    'packId',
    'packVersion',
    'packName',
    'elementId',
    'elementName',
    'elementPath',
    'category',
    'dimension',
  ] as const) {
    if (typeof value[key] !== 'string' || !value[key].trim())
      throw new Error('Resource catalog element is invalid')
  }
  for (const key of [
    'packStyles',
    'packGameTypes',
    'usageTags',
    'capabilities',
    'relations',
  ] as const) {
    if (!Array.isArray(value[key]))
      throw new Error('Resource catalog element is invalid')
  }
  if (typeof value.dependencyCount !== 'number')
    throw new Error('Resource catalog element is invalid')
  if (
    value.preview !== undefined &&
    (!isRecord(value.preview) ||
      !['image', 'model', 'audio', 'document'].includes(
        String(value.preview.kind),
      ) ||
      typeof value.preview.path !== 'string' ||
      !value.preview.path.trim())
  )
    throw new Error('Resource catalog element preview is invalid')
  if (
    value.technicalFacts !== undefined &&
    !isPrimitiveRecord(value.technicalFacts)
  )
    throw new Error('Resource catalog element technical facts are invalid')
  return value as unknown as ResourceCatalogElement
}

function errorMessage(value: unknown): string | undefined {
  return isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.message === 'string'
    ? value.error.message
    : undefined
}

function parseResolvedSelection(value: unknown): ResourceResolvedSelection {
  if (
    !isRecord(value) ||
    typeof value.resourceId !== 'string' ||
    !value.resourceId.trim()
  )
    throw new Error('Resolved Resource selection is invalid')
  const selectionReason = stringArray(value.selectionReason)
    ? value.selectionReason
    : undefined
  if (!selectionReason?.length)
    throw new Error('Resolved Resource selection reason is invalid')
  return {
    ...parseSelectionRecord(value),
    resourceId: value.resourceId,
    ...(typeof value.destinationPath === 'string' &&
    value.destinationPath.trim()
      ? { destinationPath: value.destinationPath }
      : {}),
    selectionReason,
  }
}

function parseSelectionRecord(value: unknown): ResourceSelectionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Resource selection response is invalid')
  const row = value as Record<string, unknown>
  const strings = ['packId', 'packVersion', 'elementId', 'elementPath'] as const
  for (const key of strings)
    if (typeof row[key] !== 'string' || !row[key].trim())
      throw new Error('Resource selection response is invalid')
  if (typeof row.sourceUrl !== 'string' || !row.sourceUrl.trim())
    throw new Error('Resource selection response is invalid')
  if (!isSha256String(row.sourceHash))
    throw new Error('Resource selection source hash is invalid')
  const dependencies = Array.isArray(row.dependencies)
    ? row.dependencies.map(value => parseDependency(value, true))
    : []
  const capabilities =
    Array.isArray(row.capabilities) &&
    row.capabilities.every(item => typeof item === 'string')
      ? (row.capabilities as string[])
      : undefined
  const packStyles = stringArray(row.packStyles) ? row.packStyles : undefined
  const packGameTypes = stringArray(row.packGameTypes)
    ? row.packGameTypes
    : undefined
  const usageTags = stringArray(row.usageTags) ? row.usageTags : undefined
  const relations = Array.isArray(row.relations)
    ? row.relations.map(parseElementRelation)
    : undefined
  const contentProfile =
    row.contentProfile &&
    typeof row.contentProfile === 'object' &&
    !Array.isArray(row.contentProfile)
      ? (row.contentProfile as Record<string, unknown>)
      : undefined
  const technicalFacts = primitiveRecord(row.technicalFacts)
  return {
    packId: String(row.packId),
    packVersion: String(row.packVersion),
    ...(typeof row.packName === 'string' ? { packName: row.packName } : {}),
    ...(packStyles?.length ? { packStyles } : {}),
    ...(packGameTypes?.length ? { packGameTypes } : {}),
    elementId: String(row.elementId),
    ...(typeof row.elementName === 'string'
      ? { elementName: row.elementName }
      : {}),
    elementPath: String(row.elementPath),
    ...(typeof row.category === 'string' ? { category: row.category } : {}),
    ...(usageTags?.length ? { usageTags } : {}),
    ...(row.dimension === '2D' ||
    row.dimension === '3D' ||
    row.dimension === 'agnostic'
      ? { dimension: row.dimension }
      : {}),
    sourceUrl: String(row.sourceUrl),
    sourceHash: String(row.sourceHash),
    ...(typeof row.assetKind === 'string' ? { assetKind: row.assetKind } : {}),
    ...(capabilities?.length ? { capabilities } : {}),
    ...(contentProfile ? { contentProfile } : {}),
    ...(technicalFacts ? { technicalFacts } : {}),
    ...(relations?.length ? { relations } : {}),
    dependencies,
  }
}

function primitiveRecord(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!isPrimitiveRecord(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | number | boolean] => {
      const item = entry[1]
      return (
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item))
      )
    },
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function isPrimitiveRecord(
  value: unknown,
): value is Record<string, string | number | boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      item =>
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)),
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function parseElementRelation(
  value: unknown,
): ResourceSelectionElementRelation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Resource selection relation is invalid')
  const row = value as Record<string, unknown>
  if (
    typeof row.kind !== 'string' ||
    !row.kind.trim() ||
    typeof row.targetElementId !== 'string' ||
    !row.targetElementId.trim()
  )
    throw new Error('Resource selection relation is invalid')
  return {
    kind: row.kind,
    targetElementId: row.targetElementId,
    ...(typeof row.role === 'string' && row.role.trim()
      ? { role: row.role }
      : {}),
    ...(typeof row.required === 'boolean' ? { required: row.required } : {}),
  }
}

function parseDependency(
  value: unknown,
  sourceUrlRequired = true,
): ResourceSelectionDependencyResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Resource selection dependency is invalid')
  const row = value as Record<string, unknown>
  for (const key of [
    'key',
    'parentKey',
    'elementId',
    'elementPath',
    'referencePath',
  ] as const) {
    if (typeof row[key] !== 'string' || !row[key].trim())
      throw new Error('Resource selection dependency is invalid')
  }
  if (
    sourceUrlRequired &&
    ((typeof row.sourceUrl !== 'string' || !row.sourceUrl.trim()) ||
      !isSha256String(row.sourceHash))
  )
    throw new Error('Resource selection dependency is invalid')
  return {
    key: String(row.key),
    parentKey: String(row.parentKey),
    elementId: String(row.elementId),
    elementPath: String(row.elementPath),
    referencePath: String(row.referencePath),
    sourceUrl: sourceUrlRequired ? String(row.sourceUrl) : '',
    sourceHash: sourceUrlRequired ? String(row.sourceHash) : '',
    ...(typeof row.kind === 'string' && row.kind.trim()
      ? { kind: row.kind }
      : {}),
  }
}

function isSha256String(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 64) return false
  for (const character of value.toLocaleLowerCase())
    if (!'0123456789abcdef'.includes(character)) return false
  return true
}
