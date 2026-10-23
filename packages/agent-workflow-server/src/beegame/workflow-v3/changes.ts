import { randomUUID } from 'node:crypto'
import { WorkflowError, type Run } from './state'

export function findSourceEdit(run: Run, attemptId: string) {
  return run.sourceEdits?.find(edit => edit.attemptId === attemptId)
}

export function reserveSourceEdit(run: Run, input: { path: string; before: string; after: string; workerId: string; requestKey: string; requestHash?: string }): Run {
  if (!Array.isArray(run.agentTurns)) throw new WorkflowError('unsupported-run', 'Source editing requires a current Agent Run')
  if (run.writer) throw new WorkflowError('workspace-busy', 'Wait for the current writer to stop before editing')
  if (run.paused) throw new WorkflowError('run-paused', 'Explicitly resume before saving source changes')
  if (!input.requestHash) throw new WorkflowError('invalid-edit', 'An autonomous save needs its exact request identity', 400)
  if (run.sourceEdits?.some(edit => edit.requestKey === input.requestKey))
    throw new WorkflowError('duplicate-request', 'Edit request key already exists')
  const next = structuredClone(run), attemptId = randomUUID()
  next.fence++; next.version++; next.status = 'running'
  next.writer = { attemptId, fence: next.fence, workerId: input.workerId }
  next.sourceEdits ??= []
  next.sourceEdits.push({ ...next.writer, requestKey: input.requestKey, requestHash: input.requestHash,
    sessionId: 'host-edit:'+attemptId, requirementsRevision: run.requirements.revision,
    status: 'running', startedAt: new Date().toISOString(),
    sourceEdit: { path: input.path, before: input.before, after: input.after,
      archive: '.beegame/workflow-v3-edits/'+attemptId+'/before.json', status: 'reserved' } })
  return next
}

export function settleSourceEdit(run: Run, attemptId: string, fence: number, error?: string): Run {
  if (run.writer?.attemptId !== attemptId || run.writer.fence !== fence)
    throw new WorkflowError('stale-attempt', 'Edit no longer owns the workspace writer')
  const next = structuredClone(run), attempt = findSourceEdit(next, attemptId)
  if (!attempt?.sourceEdit || attempt.sourceEdit.status !== 'reserved')
    throw new WorkflowError('invalid-edit', 'Not an unresolved host edit')
  if (!attempt.quiescedAt)
    throw new WorkflowError('writer-unresolved', 'Saving must drain before its writer can be released')
  attempt.sourceEdit.status = error ? 'failed' : 'saved'
  attempt.finishedAt = new Date().toISOString()
  attempt.status = error ? 'failed' : 'blocked'
  if (error) attempt.error = error
  delete next.writer; next.version++
  next.status = 'blocked'
  next.blockedReason = next.paused ? 'User pause retained. Edited candidates and old measurements are not accepted.' :
    error ? 'Source edit failed: '+error+' Inspect actual saved sources and this edit record; no save/game acceptance or automatic retry.' :
    'Source edit ended. Saved candidates are unmeasured; explicitly ask the Agent to reconcile, rebuild and measure. No automatic dispatch.'
  return next
}
