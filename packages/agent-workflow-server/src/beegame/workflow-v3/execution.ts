import type { BeeGameSessionManager } from '../session-manager'
import { pauseRun, resumeRun, WorkflowError, type Run, type SourceEdit } from './state'
import type { WorkflowStore } from './store'
import { findSourceEdit, settleSourceEdit } from './changes'
import type { HostExitReceipts, HostExitFacts } from './host-exit-receipt'

export function createV3Executor(input: { store: WorkflowStore; sessions: BeeGameSessionManager; exitReceipts?: HostExitReceipts }) {
  let disposing = false
  return {
    async edit(_run: Run, _value: unknown) {
      throw new WorkflowError('editor-unavailable', 'BGS Scene/UI editing has been retired; use the selected engine sources', 409)
    },
    writerLiveness(run: Run): 'none' | 'unknown' {
      return run.writer ? 'unknown' : 'none'
    },
    async recoveryEvidence(run:Run) {
      const attempt=run.writer && findSourceEdit(run,run.writer.attemptId)
      const matches=attempt && run.writer?.fence===attempt.fence && run.writer.workerId===attempt.workerId
      if(!matches)return 'unavailable'
      if(attempt.quiescedAt)return 'persisted'
      try {return await input.exitReceipts?.read(run)?'host-receipt':'unavailable'} catch {return 'unavailable'}
    },
    async recover(run: Run, identity: { expectedVersion: number; attemptId: string; fence: number }) {
      if (disposing) throw new WorkflowError('worker-stopping', 'Worker is shutting down')
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current || current.id !== run.id || current.version !== identity.expectedVersion)
        throw new WorkflowError('revision-conflict', 'Read the current Run before recovering its writer')
      if (current.writer?.attemptId !== identity.attemptId || current.writer.fence !== identity.fence)
        throw new WorkflowError('stale-attempt', 'Recovery does not address the current writer')
      if (input.sessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath))
        throw new WorkflowError('workspace-busy', 'The writer is still active; recovery cannot stop or replace it')
      const attempt = findSourceEdit(current, identity.attemptId)
      if (!attempt || attempt.workerId !== current.writer.workerId || attempt.fence !== identity.fence)
        throw new WorkflowError('writer-unresolved', 'No durable host quiescence evidence. Verify/stop the original writer; elapsed time, missing session and user claims cannot unlock it')
      if(!attempt.quiescedAt) {
        const receipt=await input.exitReceipts?.read(current)
        if(!receipt)
          throw new WorkflowError('writer-unresolved','No durable host quiescence evidence; missing session and user claims cannot unlock it')
        await recordQuiescence(current,attempt,receipt)
      }
      const quiet=(await input.store.read(run.projectId,run.ownerId))!,paused=pauseRun(quiet)
      if(paused!==quiet)await input.store.commit(run.projectId,run.ownerId,quiet.version,paused,'run.paused')
      const error = 'Recovered interrupted settlement from host quiescence evidence. Partial candidates retained, not accepted; external outcomes remain unverified. No automatic retry.'
      const next = settleSourceEdit(paused, attempt.attemptId, attempt.fence, error)
      await input.store.commit(run.projectId, run.ownerId, paused.version, next, 'writer.recovered')
      return next
    },
    async stop(run: Run) {
      // Persist intent first, including when idle or the old writer is unknown.
      // A concurrent settlement may clear the writer, but cannot clear pause.
      const paused = await changeControl(run, false)
      if (!paused.writer) return paused
      // Historical saves have no local executor. Persist pause, then require
      // actual exit evidence; never claim to stop an unknown writer.
      const current = await input.store.read(run.projectId, run.ownerId)
      if (current?.id === paused.id && current.paused && !current.writer) return current
      throw new WorkflowError('writer-unresolved', 'Run is paused, but the writer is owned by another/restarted worker; verify its actual exit before recovery')
    },
    async resume(run: Run) { return changeControl(run, true) },
    async dispose() {
      disposing = true
    },
  }
  async function recordQuiescence(run: Run, attempt: Pick<SourceEdit, 'attemptId' | 'fence'>, facts:HostExitFacts) {
    // The retired editor cannot observe new local saves. Only the existing
    // verified host receipt can supply missing historical exit facts.
    for (let rebase = 0; rebase < 2; rebase++) {
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current || current.id !== run.id || current.writer?.attemptId !== attempt.attemptId ||
          current.writer.fence !== attempt.fence || current.writer.workerId !== run.writer!.workerId)
        throw new WorkflowError('stale-attempt', 'Stopped operation no longer owns the current writer')
      const next = structuredClone(current), record = findSourceEdit(next, attempt.attemptId)!
      if (record.quiescedAt) return
      // Keep actual accounting/question provenance across settlement failure,
      // but do not retain passed checks as a recovery acceptance shortcut.
      for (const key of ['usage','nativeSessionId','turnId','skillUses'] as const)
        if (facts[key] !== undefined) Object.assign(record, { [key]: facts[key] })
      record.quiescedAt = facts.quiescedAt; next.version++
      try { await input.store.commit(run.projectId, run.ownerId, current.version, next, 'writer.quiesced'); return }
      catch (error) { if (rebase || !(error instanceof WorkflowError) || error.code !== 'revision-conflict') throw error }
    }
  }
  async function changeControl(run: Run, resume: boolean): Promise<Run> {
    for (let rebase = 0; rebase < 2; rebase++) {
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current || current.id !== run.id || current.planRevision !== run.planRevision)
        throw new WorkflowError('revision-conflict', 'Read the current Run before changing pause intent')
      const next = resume ? resumeRun(current) : pauseRun(current)
      if (next === current) return current
      try { await input.store.commit(run.projectId, run.ownerId, current.version, next, resume ? 'run.resumed' : 'run.paused'); return next }
      catch (error) { if (rebase || !(error instanceof WorkflowError) || error.code !== 'revision-conflict') throw error }
    }
    throw new WorkflowError('revision-conflict', 'Pause state changed concurrently; read the current Run')
  }
}
