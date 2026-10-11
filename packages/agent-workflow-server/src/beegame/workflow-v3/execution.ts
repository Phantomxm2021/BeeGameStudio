import { randomUUID } from 'node:crypto'
import type { BeeGameSessionManager, BeeGameSessionLanguage } from '../session-manager'
import { bindInputs, runChecks, settlementInputs, checkIsCurrent, assertFreshDependencies } from './checks'
import { claimTask, finishTask, pauseRun, resumeRun, WorkflowError, digest, type Run, type Attempt } from './state'
import type { WorkflowStore } from './store'
import { taskContext, skillEvidence, skillUseCheck } from './context'
import { bindingOperands, executeTaskBindings } from './binding'
import { reviewQuestionGuard, type ReviewDecision } from './review'
import { editSchema, prepareSourceEdit, writeSourceEdit } from './source-edit'
import { findSourceEdit, reserveSourceEdit, settleSourceEdit } from './changes'

export function createV3Executor(input: { store: WorkflowStore; sessions: BeeGameSessionManager }) {
  const workerId = randomUUID(), pending = new Set<Promise<unknown>>(), active = new Map<string, { sessionId: string; controller: AbortController }>()
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
      await input.store.commit(run.projectId, run.ownerId, run.version, next, 'source-edit.reserved')
      const attempt = findSourceEdit(next, next.writer!.attemptId)!, controller = new AbortController()
      active.set(attempt.attemptId, { sessionId: attempt.sessionId, controller })
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
          const result = settleSourceEdit(current, attempt.attemptId, attempt.fence, failure ? failure instanceof WorkflowError ? failure.message : 'Source edit filesystem operation failed; reload saved candidates. No task acceptance.' : undefined)
          try { await input.store.commit(run.projectId, run.ownerId, current.version, result, 'source-edit.settled'); settled = result; break }
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
      if (!attempt?.quiescedAt || attempt.workerId !== current.writer.workerId || attempt.fence !== identity.fence)
        throw new WorkflowError('writer-unresolved', 'No durable host quiescence evidence. Verify/stop the original writer; elapsed time, missing session and user claims cannot unlock it')
      const error = 'Recovered interrupted settlement from host quiescence evidence. Partial candidates retained, not accepted; external outcomes remain unverified. No automatic retry.'
      const next = attempt.sourceEdit ? settleSourceEdit(current, attempt.attemptId, attempt.fence, error) :
        finishTask(current, attempt.attemptId, attempt.fence, { error }, true)
      await input.store.commit(run.projectId, run.ownerId, current.version, next, 'writer.recovered')
      return next
    },
    async start(run: Run, taskId: string, requestKey: string, options: { modelConfigId?: string; language?: BeeGameSessionLanguage; authToken?: string; getValidAuthToken?: (o?: { forceRefresh?: boolean }) => Promise<string | undefined> }) {
      if (disposing) throw new WorkflowError('worker-stopping', 'Worker is shutting down')
      const duplicate = run.attempts.find(a => a.requestKey === requestKey)
      if (duplicate) {
        if (duplicate.taskId !== taskId || duplicate.planRevision !== run.planRevision)
          throw new WorkflowError('idempotency-conflict', 'Request key belongs to a different task/plan; inspect the recorded attempt or use a new key for newly authorized work')
        return duplicate
      }
      if (input.sessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath)) throw new WorkflowError('workspace-busy', 'Another project turn is still active')
      const task = run.tasks[taskId]?.spec
      if (!task) throw new WorkflowError('unknown-task', 'Task not found', 404)
      if (run.paused) throw new WorkflowError('run-paused', 'Explicitly resume this user-paused Run before starting new work')
      await assertFreshDependencies(run, task)
      const next = claimTask(run, { taskId, requestKey, workerId, sessionId: 'beegame_'+randomUUID().replaceAll('-', ''), inputVersions: await bindInputs(run, task) })
      await input.store.commit(run.projectId, run.ownerId, run.version, next, 'attempt.claimed')
      const attempt = next.attempts.at(-1)!
      const controller = new AbortController(); active.set(attempt.attemptId, { sessionId: attempt.sessionId, controller })
      if (disposing) controller.abort()
      const work = execute(next, attempt, options, controller.signal).finally(() => { pending.delete(work); active.delete(attempt.attemptId) })
      pending.add(work)
      // Failure leaves the durable writer unresolved. Never retry or announce success.
      void work.catch(error => console.error('[BGS V3] Execution settlement failed', { attemptId: attempt.attemptId, code: error instanceof WorkflowError ? error.code : 'settlement-error' }))
      return attempt
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
      if (input.sessions.get(task.sessionId)) input.sessions.stop(task.sessionId, 'workflow_v3_user_stop')
      return paused
    },
    async resume(run: Run) { return changeControl(run, true) },
    async dispose() {
      disposing = true
      for (const task of active.values()) { task.controller.abort(); if (input.sessions.get(task.sessionId)) input.sessions.stop(task.sessionId, 'workflow_v3_worker_stop') }
      await Promise.allSettled([...pending])
    },
  }
  async function recordQuiescence(run: Run, attempt: Pick<Attempt, 'attemptId' | 'fence'>, audit?: Parameters<typeof finishTask>[3]) {
    for (let rebase = 0; rebase < 2; rebase++) {
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current || current.id !== run.id || current.writer?.attemptId !== attempt.attemptId ||
          current.writer.fence !== attempt.fence || current.writer.workerId !== workerId)
        throw new WorkflowError('stale-attempt', 'Stopped operation no longer owns the current writer')
      const next = structuredClone(current), record = findSourceEdit(next, attempt.attemptId)!
      if (record.quiescedAt) return
      // Keep actual accounting/question provenance across settlement failure,
      // but do not retain passed checks as a recovery acceptance shortcut.
      if (audit) for (const key of ['usage','nativeSessionId','turnId','accountingEpochs','skillUses','decisions'] as const)
        if (audit[key] !== undefined) Object.assign(record, { [key]: audit[key] })
      record.quiescedAt = new Date().toISOString(); next.version++
      try { await input.store.commit(run.projectId, run.ownerId, current.version, next, 'writer.quiesced'); return }
      catch (error) { if (rebase || !(error instanceof WorkflowError) || error.code !== 'revision-conflict') throw error }
    }
  }
  async function changeControl(run: Run, resume: boolean): Promise<Run> {
    for (let rebase = 0; rebase < 2; rebase++) {
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current || current.id !== run.id || current.planRevision !== run.planRevision)
        throw new WorkflowError('revision-conflict', 'Read the current Run/plan before changing pause intent')
      const next = resume ? resumeRun(current) : pauseRun(current)
      if (next === current) return current
      try { await input.store.commit(run.projectId, run.ownerId, current.version, next, resume ? 'run.resumed' : 'run.paused'); return next }
      catch (error) { if (rebase || !(error instanceof WorkflowError) || error.code !== 'revision-conflict') throw error }
    }
    throw new WorkflowError('revision-conflict', 'Pause state changed concurrently; read the current Run')
  }
  async function execute(run: Run, attempt: Attempt, options: { modelConfigId?: string; language?: BeeGameSessionLanguage; authToken?: string; getValidAuthToken?: (o?: { forceRefresh?: boolean }) => Promise<string | undefined> }, signal: AbortSignal) {
    let result: Parameters<typeof finishTask>[3] = {}, stopped = false, checkInputs = attempt.inputVersions
    try {
      if (signal.aborted) throw new Error('Task cancelled before native start')
      const task = run.tasks[attempt.taskId]!.spec
      const session = input.sessions.start({ workspacePath: run.workspacePath, projectId: run.projectId, userId: run.ownerId,
        transcriptSessionId: attempt.sessionId, workflowExecution: { runId: run.id, taskId: attempt.taskId, attemptId: attempt.attemptId },
        ...(task.repairOf ? { workflowQuestionGuard: reviewQuestionGuard(run, attempt, input.store) } : {}), ...options })
      if (session.id !== attempt.sessionId) throw new WorkflowError('session-identity-conflict', 'Task must have a distinct native context')
      const operands = task.bindingPlan ? await bindingOperands(run, attempt.taskId) : undefined
      await input.sessions.sendWithDisplay(session.id, taskContext(run, attempt, operands), { displayKind: 'workflow_v3_task', ...options })
      await input.sessions.waitForSessionIdle(session.id)
      const events = input.sessions.transcript(session.id), terminal = events.findLast(e => ['turn.completed', 'turn.failed', 'turn.empty'].includes(e.type))
      const snapshot = input.sessions.runtimeSnapshot(session.id)
      result = { nativeSessionId: snapshot.nativeSessionId, turnId: terminal?.turnId, usage: snapshot.usage,
        accountingEpochs: [...new Set(events.flatMap(e => typeof e.payload?.nativeAccountingEpoch === 'string' ? [e.payload.nativeAccountingEpoch] : []))] }
      if (terminal?.type !== 'turn.completed') result.error = 'Native execution did not complete normally; no automatic retry.'
      else if (snapshot.activeSubagentToolUseIds?.length) result.error = 'Native background writer is unfinished; outputs are not accepted.'
      // Dispose the normally ended native runtime before checks, including remaining background work.
      input.sessions.stop(session.id, 'workflow_v3_task_finished')
      await input.sessions.waitForSessionIdle(session.id); stopped = true
      if (!result.error) {
        checkInputs = await settlementInputs(run.workspacePath, task, attempt.inputVersions)
        if (task.bindingPlan) {
          const bound = await executeTaskBindings(run, attempt, input.store, signal)
          result.binding = bound.binding; result.checks = [bound.check]; checkInputs = bound.checkInputs
        }
        result.decisions = events.filter(event=>event.type==='workflow.question.validated').map(event=>event.payload as unknown as ReviewDecision)
        const checked = await runChecks(run.workspacePath, task, checkInputs, signal, run.requirements.constraints, { run, attempt, decisions: result.decisions })
        result.outputs = checked.outputs; result.review = checked.review; result.checks = [...(result.checks ?? []), ...checked.checks]
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Execution failed'
      if (input.sessions.get(attempt.sessionId)) {
        input.sessions.stop(attempt.sessionId, 'workflow_v3_failed')
        await input.sessions.waitForSessionIdle(attempt.sessionId); stopped = true
        result.usage = input.sessions.runtimeSnapshot(attempt.sessionId).usage
      } else stopped = true // Native start was never accepted in this process.
    }
    if (input.sessions.get(attempt.sessionId)) {
      const snapshot = input.sessions.runtimeSnapshot(attempt.sessionId), events = input.sessions.transcript(attempt.sessionId)
      result.usage = snapshot.usage; result.nativeSessionId = snapshot.nativeSessionId
      result.turnId = events.findLast(e => ['turn.completed', 'turn.failed', 'turn.empty'].includes(e.type))?.turnId
      result.accountingEpochs = [...new Set(events.flatMap(e => typeof e.payload?.nativeAccountingEpoch === 'string' ? [e.payload.nativeAccountingEpoch] : []))]
      result.skillUses = skillEvidence(events)
      result.decisions = events.filter(event=>event.type==='workflow.question.validated').map(event=>event.payload as unknown as ReviewDecision)
      const requiredSkills = run.tasks[attempt.taskId]!.spec.skills ?? []
      if (requiredSkills.length) (result.checks ??= []).push(skillUseCheck({ ...attempt, inputVersions: checkInputs }, requiredSkills, result.skillUses))
    }
    if (signal.aborted) result.error = 'Task cancelled; partial outputs retained, not accepted.'
    for (const check of result.checks ?? []) if (check.status === 'passed' && !await checkIsCurrent(run.workspacePath, check, run.tasks[attempt.taskId]!.spec)) {
      check.status = 'unverified'; check.observation = 'Checked files, artifacts or driver version changed before acceptance.'
    }
    if (!stopped) throw new WorkflowError('writer-unresolved', 'Native writer exit has not been verified')
    await recordQuiescence(run, attempt, result)
    // Rebase only the pure settlement record once if user pause won the CAS.
    // Native execution, file writes, bindings and checks are never repeated.
    for (let rebase = 0; rebase < 2; rebase++) {
      const current = await input.store.read(run.projectId, run.ownerId)
      if (!current) throw new WorkflowError('run-missing', 'Run disappeared during settlement')
      if (signal.aborted) result.error = 'Task cancelled; partial outputs retained, not accepted.'
      const next = finishTask(current, attempt.attemptId, attempt.fence, result, stopped)
      try { await input.store.commit(run.projectId, run.ownerId, current.version, next, 'attempt.settled'); return }
      catch (error) { if (rebase || !(error instanceof WorkflowError) || error.code !== 'revision-conflict') throw error }
    }
  }
}
