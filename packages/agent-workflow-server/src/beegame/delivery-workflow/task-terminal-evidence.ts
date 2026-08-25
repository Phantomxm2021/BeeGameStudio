import type { FoundationAuditTask } from './foundation-audit-state'
import type { DispatchRecord, FoundationRevisionTask } from './types'

function dispatchDurationMs(record: DispatchRecord): number | undefined {
  if (!record.finishedAt) return undefined
  const startedAt = Date.parse(record.startedAt)
  const finishedAt = Date.parse(record.finishedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return undefined
  return Math.max(0, finishedAt - startedAt)
}

export function projectTaskTerminalEvidence<T extends FoundationAuditTask | FoundationRevisionTask>(
  task: T,
  record: DispatchRecord,
): T {
  if (record.status === 'running') return task
  const durationMs = dispatchDurationMs(record)
  return {
    ...task,
    dispatch: record,
    ...(record.usage ? { usage: record.usage } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(record.failureReason
      ? { failureReason: record.failureReason }
      : { failureReason: undefined }),
  } as T
}
