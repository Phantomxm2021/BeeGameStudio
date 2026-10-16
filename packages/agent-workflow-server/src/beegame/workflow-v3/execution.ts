import { randomUUID } from 'node:crypto'
import type { BeeGameSessionManager } from '../session-manager'
import { pauseRun, resumeRun, WorkflowError, digest, type Run, type SourceEdit } from './state'
import type { WorkflowStore } from './store'
import { editSchema, prepareSourceEdit, writeSourceEdit } from './source-edit'
import { findSourceEdit, reserveSourceEdit, settleSourceEdit } from './changes'
import { saveHostExitReceipt, type HostExitReceipts, type HostExitFacts } from './host-exit-receipt'

export function createV3Executor(input: { store: WorkflowStore; sessions: BeeGameSessionManager; exitReceipts?: HostExitReceipts }) {
  const workerId = randomUUID(), pending = new Set<Promise<unknown>>(), active = new Map<string, { controller: AbortController }>()
  const observedExits=new Map<string,{runId:string;at:string}>()
  let disposing = false
  return {
    async edit(run: Run, value: unknown) {
      if (disposing) throw new WorkflowError('worker-stopping', 'Worker is shutting down')
      if (run.writer || input.sessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath))
        throw new WorkflowError('workspace-busy', 'Wait for the current writer to stop before editing')
      if (run.paused) throw new WorkflowError('run-paused', 'Explicitly resume before saving source changes')
      const body = editSchema.parse(value), requestHash = digest(JSON.stringify(body))
      if (run.agentTurns && !body.requestKey) throw new WorkflowError('invalid-request', 'Prepare a stable requestKey for this source save', 400)
      const duplicate = run.sourceEdits?.find(e => e.requestKey === body.requestKey)
      if (duplicate && duplicate.requestHash !== requestHash) throw new WorkflowError('idempotency-conflict', 'Save key belongs to a different request')
      if (duplicate && (duplicate.sourceEdit.status !== 'saved' || !duplicate.quiescedAt ||
          duplicate.requirementsRevision !== run.requirements.revision || duplicate !== run.sourceEdits?.at(-1)))
        throw new WorkflowError('edit-already-recorded', 'Inspect the recorded save and reload current sources; historical/failed saves are never replayed')
      const edit = await prepareSourceEdit(run, duplicate ? { ...body, expectedRevision: duplicate.sourceEdit.after,
        workflow: { version: run.version, planRevision: run.planRevision, requirementsRevision: run.requirements.revision } } : body)
      if (edit.unchanged) {
        const current = await input.store.read(run.projectId, run.ownerId)
        if (!current || current.id !== run.id || current.version !== run.version || current.writer ||
            input.sessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath))
          throw new WorkflowError('revision-conflict', 'Workflow changed while reading saved sources; refresh')
        return { path: edit.relativePath, revision: edit.beforeHash, document: edit.document, contentRevision: edit.contentRevision,
          workflow: { version: run.version, planRevision: run.planRevision, requirementsRevision: run.requirements.revision },
          unmeasured: true, unchanged: !duplicate, ...(duplicate ? { sourceEditId: duplicate.attemptId, replayed: true } : {}) }
      }
      const next = reserveSourceEdit(run, { path: edit.path, before: edit.beforeHash, after: edit.afterHash, workerId,
        requestKey: body.requestKey ?? randomUUID(), requestHash })
      // Durable invalidation + exclusive writer precede any source replacement.
      try { await input.store.commit(run.projectId, run.ownerId, run.version, next, 'source-edit.reserved') }
      catch (error) {
        // A commit can succeed while its response is lost. This ORIGINAL live
        // host knows writeSourceEdit has not run; verify its exact reservation
        // and record that no-write exit, never replay the write or guess that
        // an unknown/restarted worker has exited.
        await settleUnstartedReservation(next)
        throw error
      }
      const attempt = findSourceEdit(next, next.writer!.attemptId)!, controller = new AbortController()
      active.set(attempt.attemptId, { controller })
      if (disposing) controller.abort()
      const work = (async () => {
        let failure: unknown
        try {
          const current = await input.store.read(run.projectId, run.ownerId)
          if (!current || current.id !== run.id || current.writer?.attemptId !== attempt.attemptId || current.writer.fence !== attempt.fence)
            throw new WorkflowError('stale-attempt', 'Source save no longer owns the reserved writer')
          // Pause can commit while reservation is returning, before active.set.
          if (current.paused) controller.abort()
          await writeSourceEdit(next, attempt.attemptId, edit, controller.signal)
        }
        catch (error) { failure = error }
        await recordQuiescence(next, attempt)
        let settled: Run | undefined
        for (let rebase = 0; rebase < 2; rebase++) {
          const current = await input.store.read(run.projectId, run.ownerId)
          if (!current || current.id !== run.id) throw new WorkflowError('run-missing', 'Run disappeared during edit settlement')
          const result = settleSourceEdit(current, attempt.attemptId, attempt.fence, failure ? failure instanceof WorkflowError ? failure.message : 'Source edit filesystem operation failed; reload saved candidates. No game acceptance.' : undefined)
          try { await input.store.commit(run.projectId, run.ownerId, current.version, result, 'source-edit.settled');observedExits.delete(attempt.attemptId); settled = result; break }
          catch (error) { if (rebase || !(error instanceof WorkflowError) || error.code !== 'revision-conflict') throw error }
        }
        if (failure) throw failure
        return { path: edit.relativePath, revision: edit.afterHash, document: edit.document, contentRevision: edit.nextContentRevision,
          workflow: { version: settled!.version, planRevision: settled!.planRevision, requirementsRevision: settled!.requirements.revision },
          unmeasured: true, ...(run.agentTurns ? { sourceEditId: attempt.attemptId } : {}) }
      })().finally(() => { pending.delete(work); active.delete(attempt.attemptId) })
      pending.add(work)
      return work
    },
    writerLiveness(run: Run): 'none' | 'local-active' | 'unknown' {
      return !run.writer ? 'none' : run.writer.workerId === workerId && active.has(run.writer.attemptId) ? 'local-active' : 'unknown'
    },
    async recoveryEvidence(run:Run) {
      const attempt=run.writer && findSourceEdit(run,run.writer.attemptId)
      const matches=attempt && run.writer?.fence===attempt.fence && run.writer.workerId===attempt.workerId
      if(!matches)return 'unavailable'
      if(attempt.quiescedAt)return 'persisted'
      if(attempt.workerId===workerId && observedExits.get(attempt.attemptId)?.runId===run.id)return 'original-host'
      try {return await input.exitReceipts?.read(run)?'host-receipt':'unavailable'} catch {return 'unavailable'}
    },
    async recover(run: Run, identity: { expectedVersion: number; attemptId: string; fence: number }) {
      if (disposing) throw new WorkflowError('worker-stopping', 'Worker is shutting down')
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current || current.id !== run.id || current.version !== identity.expectedVersion)
        throw new WorkflowError('revision-conflict', 'Read the current Run before recovering its writer')
      if (current.writer?.attemptId !== identity.attemptId || current.writer.fence !== identity.fence)
        throw new WorkflowError('stale-attempt', 'Recovery does not address the current writer')
      if (active.has(identity.attemptId) || input.sessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath))
        throw new WorkflowError('workspace-busy', 'The writer is still active; recovery cannot stop or replace it')
      const attempt = findSourceEdit(current, identity.attemptId)
      if (!attempt || attempt.workerId !== current.writer.workerId || attempt.fence !== identity.fence)
        throw new WorkflowError('writer-unresolved', 'No durable host quiescence evidence. Verify/stop the original writer; elapsed time, missing session and user claims cannot unlock it')
      if(!attempt.quiescedAt) {
        const original=attempt.workerId===workerId && observedExits.get(attempt.attemptId)?.runId===run.id
        const receipt=original?undefined:await input.exitReceipts?.read(current)
        if(!original && !receipt)
          throw new WorkflowError('writer-unresolved','No durable host quiescence evidence or original-host observation; missing session and user claims cannot unlock it')
        await recordQuiescence(current,attempt,receipt)
      }
      const quiet=(await input.store.read(run.projectId,run.ownerId))!,paused=pauseRun(quiet)
      if(paused!==quiet)await input.store.commit(run.projectId,run.ownerId,quiet.version,paused,'run.paused')
      const error = 'Recovered interrupted settlement from host quiescence evidence. Partial candidates retained, not accepted; external outcomes remain unverified. No automatic retry.'
      const next = settleSourceEdit(paused, attempt.attemptId, attempt.fence, error)
      next.blockedReason = 'User pause retained. Source edit failed: '+error
      await input.store.commit(run.projectId, run.ownerId, paused.version, next, 'writer.recovered')
      observedExits.delete(attempt.attemptId)
      return next
    },
    async stop(run: Run) {
      // Persist intent first, including when idle or the old writer is unknown.
      // A concurrent settlement may clear the writer, but cannot clear pause.
      const paused = await changeControl(run, false)
      if (!paused.writer) return paused
      const task = active.get(paused.writer.attemptId)
      if (paused.writer.workerId !== workerId || !task) {
        // A normal settlement can finish between the pause commit and lookup.
        // Only its durable cleared lease counts, never elapsed time/liveness guesses.
        const current = await input.store.read(run.projectId, run.ownerId)
        if (current?.id === paused.id && current.paused && !current.writer) return current
        throw new WorkflowError('writer-unresolved', 'Run is paused, but the writer is owned by another/restarted worker; verify its actual exit before recovery')
      }
      task.controller.abort()
      return paused
    },
    async resume(run: Run) { return changeControl(run, true) },
    async dispose() {
      disposing = true
      for (const task of active.values()) task.controller.abort()
      await Promise.allSettled([...pending])
      observedExits.clear()
    },
  }
  async function settleUnstartedReservation(run: Run) {
    const writer=run.writer!
    observedExits.set(writer.attemptId,{runId:run.id,at:new Date().toISOString()})
    await saveHostExitReceipt(input.exitReceipts,run,{quiescedAt:observedExits.get(writer.attemptId)!.at})
    const current=await input.store.read(run.projectId,run.ownerId)
    if(!current || current.id!==run.id || current.writer?.attemptId!==writer.attemptId ||
        current.writer.fence!==writer.fence || current.writer.workerId!==workerId){observedExits.delete(writer.attemptId);return}
    const attempt=findSourceEdit(current,writer.attemptId)!
    await recordQuiescence(current,attempt)
    for(let i=0;i<2;i++) {
      const quiet=await input.store.read(run.projectId,run.ownerId)
      if(!quiet || quiet.id!==run.id)throw new WorkflowError('run-missing','Reserved operation disappeared before no-start settlement')
      const error='Reservation response failed before execution. Original host confirmed no file/tool work started; no automatic retry.'
      const next=settleSourceEdit(quiet,attempt.attemptId,attempt.fence,error)
      try {await input.store.commit(run.projectId,run.ownerId,quiet.version,next,'source-edit.settled');observedExits.delete(attempt.attemptId);return}
      catch(e){if(i || !(e instanceof WorkflowError) || e.code!=='revision-conflict')throw e}
    }
  }
  async function recordQuiescence(run: Run, attempt: Pick<SourceEdit, 'attemptId' | 'fence'>, receipt?:HostExitFacts) {
    // Called only after this host's actual filesystem/native cleanup, or a
    // known no-start failure. Retain that observation if DB persistence fails;
    // A signed host receipt can preserve this fact across a restart; missing
    // receipts never manufacture an observation or justify a forced release.
    if(!receipt && !observedExits.has(attempt.attemptId))observedExits.set(attempt.attemptId,{runId:run.id,at:new Date().toISOString()})
    const exit=observedExits.get(attempt.attemptId)
    const facts:HostExitFacts=receipt ?? {quiescedAt:exit!.at}
    if(!receipt)await saveHostExitReceipt(input.exitReceipts,run,facts)
    for (let rebase = 0; rebase < 2; rebase++) {
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current || current.id !== run.id || current.writer?.attemptId !== attempt.attemptId ||
          current.writer.fence !== attempt.fence || current.writer.workerId !== (receipt?run.writer!.workerId:workerId))
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
