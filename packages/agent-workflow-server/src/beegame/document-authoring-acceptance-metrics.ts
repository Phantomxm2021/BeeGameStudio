import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

export const GDD_AUTHORING_RAW_TOKEN_CEILING = 600_000
export const EIGHT_DOCUMENT_AUTHORING_RAW_TOKEN_CEILING = 4_000_000

export const DOCUMENT_AUTHORING_RAW_TOKEN_CEILINGS = Object.freeze({
  'docs/GDD.md': GDD_AUTHORING_RAW_TOKEN_CEILING,
  'docs/TECHNICAL_DESIGN.md': 550_000,
  'docs/LEVEL_SCENE_DESIGN.md': 500_000,
  'docs/BALANCE_DESIGN.md': 500_000,
  'docs/ART_DIRECTION.md': 450_000,
  'docs/UI_UX_SPEC.md': 450_000,
  'docs/AUDIO_DESIGN.md': 400_000,
  'docs/ASSET_PLAN.md': 450_000,
} satisfies Record<FoundationDocumentPath, number>)

type Usage = Readonly<{
  input_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  completion_tokens: number
  total_tokens: number
}>

export type DocumentAuthoringEvidence = Readonly<{
  documents: readonly Readonly<{
    path: string
    dispatchId: string
    usage: Usage
    modelStops: number
    toolCalls: Readonly<Record<string, number>>
    elapsedMs: number
    bytes: number
    lines: number
    accepted: boolean
  }>[]
}>

export type DocumentAuthoringAcceptanceReport = Readonly<{
  documents: readonly Readonly<{
    path: FoundationDocumentPath
    dispatchId: string
    rawTokens: number
    ceiling: number
    withinBudget: boolean
    accepted: boolean
  }>[]
  total: Readonly<{
    freshInputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    outputTokens: number
    rawTokens: number
  }>
  completeDocumentSet: boolean
  withinAuthoringBudget: boolean
}>

export function summarizeDocumentAuthoringAcceptance(
  input: DocumentAuthoringEvidence,
): DocumentAuthoringAcceptanceReport {
  const paths = new Set<string>()
  const dispatchIds = new Set<string>()
  const documents = input.documents.map(document => {
    if (!CANONICAL_FOUNDATION_DOCUMENTS.includes(document.path as never))
      throw new Error(`document authoring evidence path is not canonical: ${document.path}`)
    if (paths.has(document.path) || dispatchIds.has(document.dispatchId))
      throw new Error('document authoring evidence contains a duplicate path or dispatch')
    paths.add(document.path)
    dispatchIds.add(document.dispatchId)
    const path = document.path as FoundationDocumentPath
    const ceiling = DOCUMENT_AUTHORING_RAW_TOKEN_CEILINGS[path]
    return Object.freeze({
      path,
      dispatchId: document.dispatchId,
      rawTokens: document.usage.total_tokens,
      ceiling,
      withinBudget: document.usage.total_tokens <= ceiling,
      accepted: document.accepted,
    })
  })
  const total = Object.freeze({
    freshInputTokens: sum(input.documents, 'input_tokens'),
    cacheReadTokens: sum(input.documents, 'cache_read_tokens'),
    cacheCreationTokens: sum(input.documents, 'cache_creation_tokens'),
    outputTokens: sum(input.documents, 'completion_tokens'),
    rawTokens: sum(input.documents, 'total_tokens'),
  })
  const completeDocumentSet =
    paths.size === CANONICAL_FOUNDATION_DOCUMENTS.length &&
    CANONICAL_FOUNDATION_DOCUMENTS.every(path => paths.has(path))
  return Object.freeze({
    documents: Object.freeze(documents),
    total,
    completeDocumentSet,
    withinAuthoringBudget:
      documents.every(document => document.accepted && document.withinBudget) &&
      total.rawTokens <= EIGHT_DOCUMENT_AUTHORING_RAW_TOKEN_CEILING,
  })
}

function sum(
  documents: DocumentAuthoringEvidence['documents'],
  key: keyof Usage,
): number {
  return documents.reduce((total, document) => total + document.usage[key], 0)
}
