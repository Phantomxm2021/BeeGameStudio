import type { DispatchRecord } from './types'

export const RETIRED_FOUNDATION_REVIEW =
  'Legacy Foundation review/revision is retired and old projects are unsupported; start a new project through the public Foundation stage chain.'

export function assertNoRetiredFoundationReviewRun(run: { phase?: unknown; documentStep?: unknown; foundationReviewStage?: unknown; foundationAuditState?: unknown }): void {
  if (run.foundationAuditState !== undefined) throw new Error(RETIRED_FOUNDATION_REVIEW)
  if (!run.foundationReviewStage && (run.phase === 'FOUNDATION_REVISION' ||
      run.phase === 'DOCUMENT_REVIEW' && run.documentStep !== 'CHECKLIST_DRAFTING'))
    throw new Error(RETIRED_FOUNDATION_REVIEW)
}

export function assertNoRetiredFoundationWorker(value: { workerType?: unknown }): void {
  if (['foundation-fact-extractor', 'foundation-semantic-reviewer', 'foundation-document-reviser'].includes(String(value.workerType)))
    throw new Error(RETIRED_FOUNDATION_REVIEW)
}

/** Process-safety recognition only. Never parse, migrate, resume, or publish old review state. */
export function retiredFoundationRunningDispatches(value: unknown): DispatchRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const state = (value as Record<string, unknown>).foundationAuditState
  if (!state || typeof state !== 'object' || Array.isArray(state)) return []
  const tasks = (state as Record<string, unknown>).tasks
  if (!Array.isArray(tasks)) return []
  return tasks.flatMap(task => {
    if (!task || typeof task !== 'object' || task.status !== 'running') return []
    const dispatch = task.dispatch
    return dispatch && typeof dispatch === 'object' && dispatch.status === 'running'
      ? [dispatch as DispatchRecord] : []
  })
}
