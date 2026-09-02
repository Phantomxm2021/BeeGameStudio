import type { FoundationAuditTask } from './foundation-audit-state'
import type { DispatchRecord, FoundationRevisionTask } from './types'

function dispatchDurationMs(record: DispatchRecord): number | undefined {
  if (!record.finishedAt) return undefined
  const startedAt = Date.parse(record.startedAt)
  const finishedAt = Date.parse(record.finishedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt))
    return undefined
  return Math.max(0, finishedAt - startedAt)
}

export function projectTaskTerminalEvidence<
  T extends FoundationAuditTask | FoundationRevisionTask,
>(task: T, record: DispatchRecord): T {
  if (record.status === 'running') return task
  const durationMs = dispatchDurationMs(record)
  // Business admission can classify a completed provider terminal as
  // retryable/needs_action (for example, a final structured payload cap).
  // The dispatch record may have no failureReason because the provider call
  // itself completed successfully. Preserve that durable admission reason;
  // an explicit record reason always wins, and a truly completed task clears
  // stale reasons.
  const failureReason =
    record.failureReason ??
    (task.status === 'retryable' || task.status === 'needs_action'
      ? task.failureReason
      : undefined)
  return {
    ...task,
    dispatch: record,
    ...(record.usage ? { usage: record.usage } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(failureReason !== undefined
      ? { failureReason }
      : { failureReason: undefined }),
  } as T
}
