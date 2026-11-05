import { WorkflowError, type Run } from './state'

export function findSourceEdit(run: Run, attemptId: string) {
  return run.sourceEdits?.find(edit => edit.attemptId === attemptId)
}

// Settle an interrupted historical save; new editor writes are retired.
export function settleSourceEdit(run: Run, attemptId: string, fence: number, error: string): Run {
  if (run.writer?.attemptId !== attemptId || run.writer.fence !== fence)
    throw new WorkflowError('stale-attempt', 'Edit no longer owns the workspace writer')
  const next = structuredClone(run), attempt = findSourceEdit(next, attemptId)
  if (!attempt?.sourceEdit || attempt.sourceEdit.status !== 'reserved')
    throw new WorkflowError('invalid-edit', 'Not an unresolved host edit')
  if (!attempt.quiescedAt)
    throw new WorkflowError('writer-unresolved', 'Saving must drain before its writer can be released')
  attempt.sourceEdit.status = 'failed'
  attempt.finishedAt = new Date().toISOString()
  attempt.status = 'failed'
  attempt.error = error
  delete next.writer; next.version++
  next.status = 'blocked'
  next.blockedReason = (next.paused ? 'User pause retained. ' : '')+'Source edit failed: '+error
  return next
}
