import {
  RESOURCE_SEMANTIC_EVIDENCE_SOURCES,
  RESOURCE_USAGE_TAGS,
  type ResourceAssetKind,
  type ResourceCategory,
  type ResourceContentProfile,
  type ResourceElement,
  type ResourceSemanticEvidence,
  type ResourceSemanticSuggestion,
  type ResourceTechnicalFacts,
  type ResourceUsageTag,
} from './types'

export { RESOURCE_SEMANTIC_EVIDENCE_SOURCES } from './types'
export type { ResourceSemanticEvidence, ResourceSemanticEvidenceSource } from './types'

/** The single structured response contract used by the semantic curator. */
export const RESOURCE_SEMANTIC_MODEL_TOOL_NAME = 'submit_resource_semantic_batch'
export const RESOURCE_SEMANTIC_MODEL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'element_id',
          'source_content_hash',
          'usageTags',
          'confidence',
          'evidence',
          'curator_revision',
        ],
        properties: {
          element_id: { type: 'string' },
          source_content_hash: { type: 'string' },
          usageTags: {
            type: 'array',
            items: { type: 'string', enum: [...RESOURCE_USAGE_TAGS] },
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'reference', 'observation'],
              properties: {
                source: { type: 'string', enum: [...RESOURCE_SEMANTIC_EVIDENCE_SOURCES] },
                reference: { type: 'string' },
                observation: { type: 'string' },
              },
            },
          },
          curator_revision: { type: 'string' },
        },
      },
    },
  },
} as const

export type ResourceSemanticVisualImage = {
  mediaType: 'image/jpeg'
  dataBase64: string
}

export type ResourceSemanticVisualInput =
  | {
      mode: 'individual'
      images: readonly (ResourceSemanticVisualImage & { elementId: string })[]
    }
  | {
      mode: 'atlas'
      image: ResourceSemanticVisualImage
      cells: readonly { ordinal: number; elementId: string }[]
    }

export type ResourceSemanticRuntimeFailureStage =
  | 'runtime_transport'
  | 'model_request'
  | 'model_response'
  | 'usage_billing'

/**
 * The only model input projection. It contains inspected facts and content
 * evidence, never filenames, paths, transcripts, or project context.
 */
export type ResourceSemanticContentProjection = {
  elementId: string
  sourceContentHash: string
  category: ResourceCategory
  assetKind?: ResourceAssetKind
  technicalFacts: ResourceTechnicalFacts
  contentProfile?: ResourceContentProfile
  dependencySummary: ResourceSemanticDependencySummary
}

export function resolveResourceSemanticVisualKind(
  element: Pick<ResourceElement, 'category' | 'kind' | 'assetKind'>,
): 'image' | 'model' | undefined {
  if (
    element.category === 'models' ||
    element.kind === 'model' ||
    element.assetKind === 'model' ||
    element.assetKind === 'mesh'
  ) return 'model'
  if (
    element.kind === 'image' ||
    element.assetKind === 'image' ||
    element.assetKind === 'texture' ||
    element.assetKind === 'sprite' ||
    element.assetKind === 'sprite-sheet' ||
    element.assetKind === 'sprite-atlas'
  ) return 'image'
  return undefined
}

export function assertResourceSemanticVisualInput(
  input: ResourceSemanticVisualInput | undefined,
  expectedElementIds: ReadonlySet<string>,
): void {
  if (!input || (input.mode !== 'individual' && input.mode !== 'atlas')) {
    throw new ResourceSemanticDecisionError('Resource semantic visual input is required')
  }
  if (input.mode === 'individual') {
    if (expectedElementIds.size > 2 || input.images.length < 1 || input.images.length > 2) {
      throw new ResourceSemanticDecisionError('individual visual input requires one or two elements')
    }
    const ids = input.images.map(image => image.elementId)
    assertVisualElementIds(ids, expectedElementIds)
    for (const image of input.images) assertVisualImage(image)
    return
  }
  if (expectedElementIds.size <= 2 || input.cells.length !== expectedElementIds.size) {
    throw new ResourceSemanticDecisionError('Atlas visual input requires more than two elements')
  }
  assertVisualElementIds(input.cells.map(cell => cell.elementId), expectedElementIds)
  if (input.cells.some((cell, index) => cell.ordinal !== index)) {
    throw new ResourceSemanticDecisionError('Atlas visual input cells must be ordered')
  }
  assertVisualImage(input.image)
}

export function assertResourceSemanticVisualDecision(
  decision: ResourceSemanticModelDecision,
): void {
  if (!decision.evidence.some(
    evidence => evidence.source === 'content_preview' && evidence.reference === decision.elementId,
  )) {
    throw new ResourceSemanticDecisionError(
      `visual semantic decision for ${decision.elementId} requires content_preview evidence`,
    )
  }
}

export type ResourceSemanticDependencySummary = {
  declaredCount: number
  boundCount: number
  relationKinds: readonly string[]
}

export type ResourceSemanticModelDecision = {
  elementId: string
  sourceContentHash: string
  usageTags: readonly ResourceUsageTag[]
  confidence: 'high' | 'medium' | 'low'
  evidence: readonly ResourceSemanticEvidence[]
  curatorRevision: string
}

export class ResourceSemanticDecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceSemanticDecisionError'
  }
}

export type ResourceSemanticCommitOutcome = 'committed' | 'suggested' | 'skipped'
export type ResourceSemanticCommitMode = 'standard' | 'refresh-suggestion'
export type ResourceSemanticCommitResult = {
  receiptId: string
  outcome: ResourceSemanticCommitOutcome
  element: ResourceElement
}

export function parseResourceSemanticModelDecision(value: unknown): ResourceSemanticModelDecision {
  if (!isRecord(value)) throw new ResourceSemanticDecisionError('semantic decision must be an object')
  assertExactKeys(value, [
    'element_id',
    'source_content_hash',
    'usageTags',
    'confidence',
    'evidence',
    'curator_revision',
  ], 'semantic decision')

  const sourceContentHash = requireContentHash(value.source_content_hash)
  const elementId = requireNonEmptyString(value.element_id, 'element_id')
  if (!Array.isArray(value.usageTags)) {
    throw new ResourceSemanticDecisionError('usageTags must be an array')
  }
  const usageTags = value.usageTags.map((tag) => {
    if (!isResourceUsageTag(tag)) {
      throw new ResourceSemanticDecisionError('usageTags must contain only canonical semantic roles')
    }
    return tag
  })
  const evidence = parseEvidence(value.evidence)
  if (!isAllowed(value.confidence, ['high', 'medium', 'low'] as const)) {
    throw new ResourceSemanticDecisionError('confidence is unsupported')
  }
  const curatorRevision = requireNonEmptyString(value.curator_revision, 'curator_revision')

  return {
    elementId,
    sourceContentHash,
    usageTags: uniqueSorted(usageTags),
    confidence: value.confidence,
    evidence,
    curatorRevision,
  }
}

export function isResourceSemanticCommitEligible(
  decision: ResourceSemanticModelDecision,
): boolean {
  return decision.confidence === 'high' && decision.usageTags.length > 0 && decision.evidence.length > 0
}

export function isResourceUsageTag(value: unknown): value is ResourceUsageTag {
  return isAllowed(value, RESOURCE_USAGE_TAGS)
}

export function isResourceContentHash(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && [...value].every(character => '0123456789abcdef'.includes(character))
}

export function buildResourceSemanticAISuggestion(
  decision: ResourceSemanticModelDecision,
  generatedAt: string,
): ResourceSemanticSuggestion {
  return {
    sourceContentHash: decision.sourceContentHash,
    usageTags: decision.usageTags,
    styles: [],
    relations: [],
    evidence: decision.evidence,
    confidence: decision.confidence,
    generatedAt,
    generatorRevision: decision.curatorRevision,
  }
}

export function semanticDecisionReceiptId(decision: ResourceSemanticModelDecision): string {
  return `semantic:${decision.elementId}:${decision.sourceContentHash}:${decision.curatorRevision}`
}

export function applyResourceSemanticDecision(
  element: ResourceElement,
  decision: ResourceSemanticModelDecision,
  generatedAt: string,
  effectiveUsageTags: readonly ResourceUsageTag[],
  options: { commitMode?: ResourceSemanticCommitMode } = {},
): ResourceSemanticCommitResult {
  if (element.id !== decision.elementId) throw new ResourceSemanticDecisionError('semantic decision element identity does not match')
  if (element.specs.contentHash !== decision.sourceContentHash) throw new ResourceSemanticDecisionError('semantic decision content hash is stale')
  const receiptId = semanticDecisionReceiptId(decision)
  if (element.usageTagsMode === 'manual-only') return { receiptId, outcome: 'skipped', element }
  const hasElementOwnedUsageTags = element.usageTagsMode === 'override' ||
    (element.usageTagsMode === undefined && Boolean(element.usageTags?.length))
  if (options.commitMode !== 'refresh-suggestion' && hasElementOwnedUsageTags) return { receiptId, outcome: 'skipped', element }
  if (options.commitMode === 'refresh-suggestion') {
    return {
      receiptId,
      outcome: 'suggested',
      element: {
        ...element,
        semanticSuggestion: buildResourceSemanticAISuggestion(decision, generatedAt),
      },
    }
  }
  if (isResourceSemanticCommitEligible(decision)) {
    return {
      receiptId,
      outcome: 'committed',
      element: {
        ...element,
        usageTags: decision.usageTags,
        usageTagsMode: 'override',
        semanticSuggestion: undefined,
      },
    }
  }
  return {
    receiptId,
    outcome: 'suggested',
    element: {
      ...element,
      semanticSuggestion: buildResourceSemanticAISuggestion(decision, generatedAt),
    },
  }
}

function parseEvidence(value: unknown): ResourceSemanticEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ResourceSemanticDecisionError('evidence must contain at least one item')
  }
  const evidence = value.map((item, index): ResourceSemanticEvidence => {
    if (!isRecord(item)) throw new ResourceSemanticDecisionError(`evidence[${index}] must be an object`)
    assertExactKeys(item, ['source', 'reference', 'observation'], `evidence[${index}]`)
    if (!isAllowed(item.source, RESOURCE_SEMANTIC_EVIDENCE_SOURCES)) {
      throw new ResourceSemanticDecisionError(`evidence source is unsupported at evidence[${index}].source: ${safeDiagnosticValue(item.source)}`)
    }
    return {
      source: item.source,
      reference: requireNonEmptyString(item.reference, `evidence[${index}].reference`),
      observation: requireNonEmptyString(item.observation, `evidence[${index}].observation`),
    }
  })
  return evidence.sort((left, right) => {
    const leftKey = `${left.source}\u0000${left.reference}\u0000${left.observation}`
    const rightKey = `${right.source}\u0000${right.reference}\u0000${right.observation}`
    return leftKey.localeCompare(rightKey)
  })
}

function assertVisualElementIds(ids: readonly string[], expected: ReadonlySet<string>): void {
  if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some(id => !expected.has(id))) {
    throw new ResourceSemanticDecisionError('visual input element identities do not match the batch')
  }
}

function assertVisualImage(image: ResourceSemanticVisualImage): void {
  if (image.mediaType !== 'image/jpeg' || !image.dataBase64.trim()) {
    throw new ResourceSemanticDecisionError('visual input must contain a non-empty JPEG image')
  }
}

function requireContentHash(value: unknown): string {
  const hash = requireNonEmptyString(value, 'sourceContentHash')
  if (!isResourceContentHash(hash)) {
    throw new ResourceSemanticDecisionError('sourceContentHash must be a 64-character SHA-256 hex string')
  }
  return hash
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ResourceSemanticDecisionError(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function isAllowed<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const expectedKeys = new Set(expected)
  const unexpected = Object.keys(value).filter(key => !expectedKeys.has(key))
  if (unexpected.length) {
    throw new ResourceSemanticDecisionError(`${context} contains unsupported fields: ${unexpected.join(', ')}`)
  }
}

function safeDiagnosticValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.trim().slice(0, 80))
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return typeof value
}
