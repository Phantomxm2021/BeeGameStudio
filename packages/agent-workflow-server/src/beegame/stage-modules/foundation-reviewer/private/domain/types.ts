export const CANONICAL_FOUNDATION_DOCUMENTS = [
  'docs/GDD.md',
  'docs/LEVEL_SCENE_DESIGN.md',
  'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
] as const

export type FoundationDocumentPath = (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
export type FoundationRevisionRound = number
export type WorkflowUsage = {
  input_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  completion_tokens: number
  total_tokens: number
}

// Reviewer-owned execution evidence only; never the shared workflow request/run.
export type DispatchRecord = {
  dispatchId: string
  workerType: 'foundation-fact-extractor' | 'foundation-semantic-reviewer'
  phase: 'DOCUMENT_REVIEW'
  taskId?: string
  revision: string
  status: 'created' | 'running' | 'completed' | 'failed' | 'interrupted' | 'needs_action'
  terminalEvidencePath?: string
  failureReason?: string
  terminalResult?: Record<string, unknown>
  startingUsage?: WorkflowUsage
  usage?: WorkflowUsage
  startedAt: string
  finishedAt?: string
}
