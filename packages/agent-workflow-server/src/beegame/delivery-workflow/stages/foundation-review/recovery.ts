export type FoundationReviewReplayContext = Readonly<{
  tasks: readonly Readonly<{
    status: string
    dispatchId?: string
    hasTerminalResult: boolean
  }>[]
}>

export interface FoundationReviewReplayPorts {
  isTerminalAdmissionInFlight(dispatchId: string): boolean
  replayTerminal(dispatchId: string): Promise<void>
}

/** Recover pending nested terminals before stage scheduling resumes. */
export function replayFoundationReviewTerminals(
  context: FoundationReviewReplayContext | undefined,
  ports: FoundationReviewReplayPorts,
): Promise<void> | undefined {
  if (!context) return undefined
  const tasks = context.tasks.map(task => ({
    status: task.status,
    dispatchId: task.dispatchId,
    hasTerminalResult: task.hasTerminalResult,
  }))
  const replayable = tasks
    .filter(task => task.status !== 'completed' && task.hasTerminalResult &&
      task.dispatchId !== undefined && !ports.isTerminalAdmissionInFlight(task.dispatchId))
    .map(task => task.dispatchId!)
  // Do not introduce an await/microtask boundary when nothing is replayable.
  if (!replayable.length) return undefined
  return (async () => {
    for (const dispatchId of replayable) await ports.replayTerminal(dispatchId)
  })()
}

/** Preserve Reviewer continuation failures as an explicit stage result. */
export function foundationReviewContinuationFailure(error: unknown): {
  reason: string
  status: 'needs_action'
  thinking: 'idle'
  eventType: 'foundation.audit.continuation_failed'
} {
  return {
    reason: `foundation audit continuation failed: ${error instanceof Error ? error.message : String(error)}`,
    status: 'needs_action',
    thinking: 'idle',
    eventType: 'foundation.audit.continuation_failed',
  }
}

export function foundationReviewFailureNeedsAction(input: {
  kind: 'document-facts' | 'semantic' | 'confirmation'
  attempt: number
  reason: string
}): boolean {
  return /(?:fast model|model config|attempt cap|not configured)/i.test(input.reason) ||
    input.attempt >= (input.kind === 'confirmation' ? 1 : 2)
}
