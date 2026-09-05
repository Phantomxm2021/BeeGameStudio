import type { DeliveryRun, WorkflowEvent } from './types'
import { authorReadyForHandoff } from './foundation-authoring-state'

export type FoundationAuthoringPause = 'requested' | 'reached'

/** Read the pause control stream; null is an explicit consumed value. */
export function readFoundationAuthoringPause(
  events: readonly WorkflowEvent[],
  runId: string,
): FoundationAuthoringPause | undefined {
  let pause: FoundationAuthoringPause | undefined
  for (const event of events) {
    const isCreated = event.type === 'run.created'
    const isPauseChange = event.type === 'foundation.authoring.pause_changed'
    if (!isCreated && !isPauseChange) continue
    const value = event.foundationAuthoringPause
    if (isCreated && value === undefined) continue
    if (event.runId !== runId)
      throw new Error('foundation authoring pause journal identity mismatch')
    if (isCreated) {
      if (value !== 'requested')
        throw new Error('invalid foundation authoring pause request')
      pause = value
      continue
    }
    if (value !== 'reached' && value !== null)
      throw new Error('invalid foundation authoring pause change')
    pause = value === null ? undefined : value
  }
  return pause
}

// Global handoff adapter; Reviewer receives only published documents/checkpoints.
export function canStartFoundationAudit(run: DeliveryRun): boolean {
  return authorReadyForHandoff(run.foundationDraftState)
}

/**
 * Convert the one-shot authoring handoff intent into the ordinary stopped
 * workflow state.  This boundary owns no audit/revision state and is safe to
 * call repeatedly with the current durable authoring snapshot.
 */
export function pauseFoundationAuthoringHandoff(
  run: DeliveryRun,
  pause: FoundationAuthoringPause | undefined,
): DeliveryRun | undefined {
  if (
    run.foundationAuditState ||
    !(
      run.phase === 'DOCUMENT_DRAFTING' ||
      (run.phase === 'DOCUMENT_REVIEW' &&
        run.documentStep === 'FOUNDATION_REVIEW')
    ) ||
    !authorReadyForHandoff(run.foundationDraftState) ||
    (pause !== 'requested' && pause !== 'reached')
  )
    return undefined
  if (
    pause === 'reached' &&
    run.status === 'stopped' &&
    run.phase === 'DOCUMENT_DRAFTING' &&
    run.documentStep === 'FOUNDATION_DRAFTING'
  )
    return run
  return {
    ...run,
    phase: 'DOCUMENT_DRAFTING',
    documentStep: 'FOUNDATION_DRAFTING',
    status: 'stopped',
    currentMessage: undefined,
    thinking: 'idle',
    blockedReason: 'foundation authoring complete; paused before review',
    updatedAt: new Date().toISOString(),
  }
}
