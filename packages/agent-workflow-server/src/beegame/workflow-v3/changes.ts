import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { digest, publishPlan, V3_PROTOCOL, WorkflowError, taskSchema, type Run, type TaskSpec } from './state'

export const requirementChangeSchema = z.object({ expectedVersion: z.number().int().positive(),
  requirementsRevision: z.string().min(1), requestKey: z.string().min(1),
  requirements: z.object({ text: z.string().trim().min(1), constraints: z.record(z.string(), z.unknown()),
    ids: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)).min(1) }).strict(),
  tasks: z.array(taskSchema).min(1),
}).strict()

/** A revised task graph is explicit user authorization, not inferred by a model.
 * All tasks see the full confirmed requirements: a changed snapshot revokes all
 * current qualifications. Original snapshots remain in append-only history. */
export function changeRequirements(run: Run, value: unknown): Run {
  const body = requirementChangeSchema.parse(value)
  const sha256 = digest(JSON.stringify(body.requirements))
  const duplicate = run.requirementChanges?.find(c => c.requestKey === body.requestKey)
  if (duplicate) {
    if (duplicate.after.sha256 !== sha256) throw new WorkflowError('idempotency-conflict', 'Change request key belongs to different requirements')
    if (run.requirements.revision !== duplicate.after.revision) throw new WorkflowError('revision-conflict', 'This change is historical; read current requirements')
    // A reused key may not silently authorize a different task scope.
    const plan = run.plans.find(p => p.plan.requirementsRevision === duplicate.after.revision)
    if (JSON.stringify(plan?.plan.tasks) !== JSON.stringify(normalizeRequirementInputs(body.tasks, duplicate.after.revision)))
      throw new WorkflowError('idempotency-conflict', 'Change request key belongs to a different task plan')
    return run
  }
  if (run.version !== body.expectedVersion || run.requirements.revision !== body.requirementsRevision)
    throw new WorkflowError('revision-conflict', 'Read the current Run and confirmed requirements before changing them')
  if (run.writer) throw new WorkflowError('writer-unresolved', 'Wait for the current writer to stop before changing requirements')
  if (new Set(body.requirements.ids).size !== body.requirements.ids.length)
    throw new WorkflowError('invalid-requirements', 'Requirement IDs must be unique', 400)
  if (run.requirements.sha256 === sha256) throw new WorkflowError('requirements-unchanged', 'No requirement change; use an affected task plan instead', 400)
  const requirements = { ...structuredClone(body.requirements), revision: randomUUID(), sha256 }
  const base = structuredClone(run)
  base.requirements = requirements
  base.requirementChanges = [...(run.requirementChanges ?? []), { requestKey: body.requestKey, actorId: run.ownerId,
    at: new Date().toISOString(), before: structuredClone(run.requirements), after: structuredClone(requirements) }]
  // Directed findings/decisions from another requirement version cannot grant
  // new repair authority. Submit a current normal review/task plan instead.
  if (body.tasks.some(t => t.repairOf || t.reviewOf || t.previewIssues))
    throw new WorkflowError('historical-review-scope', 'Remove historical repairOf/reviewOf/previewIssues from the changed-requirement plan; obtain a new current review', 400)
  const next = publishPlan(base, { protocol: V3_PROTOCOL, baseRevision: run.planRevision, requirementsRevision: requirements.revision,
    tasks: normalizeRequirementInputs(body.tasks, requirements.revision) }, Object.keys(run.tasks))
  requireRebuild(next)
  return next
}
function normalizeRequirementInputs(tasks: TaskSpec[], revision: string): TaskSpec[] {
  return tasks.map(t => ({ ...t, inputs: t.inputs.map(i => i.startsWith('requirement:') ? i.split('@')[0]+'@'+revision : i) }))
}
/** Never promote the old static output as a newly edited game's measurement.
 * The host source-copy build is the existing evidence that actual current
 * sources (not an author-selected subset) produced the measured artifact. */
export function requireRebuild(run: Run, affected?: string[]) {
  for (const task of Object.values(run.tasks)) {
    if (affected && !affected.includes(task.spec.id) || task.status === 'superseded' || task.status === 'succeeded' || !task.spec.checks.includes('runtime-smoke')) continue
    const seen = new Set<string>()
    const built = (id: string): boolean => {
      if (seen.has(id)) return false
      seen.add(id)
      const spec = run.tasks[id]?.spec
      return Boolean(spec && (spec.editableProject && spec.checks.includes('build') && spec.runtimeArtifact === task.spec.runtimeArtifact || spec.dependsOn.some(built)))
    }
    if (!built(task.spec.id)) throw new WorkflowError('rebuild-required', 'Changed version needs an editableProject source-copy build before runtime-smoke: '+task.spec.id+'. Revise the authorized plan; old static measurements cannot be reused.', 400)
  }
}
export function contentOwners(run: Run, path: string) {
  return Object.values(run.tasks).filter(t => t.status !== 'superseded' && t.spec.kind === 'game.develop' &&
    t.spec.expectedOutputs.includes(path) && t.spec.writablePaths.some(s => s === path || s.endsWith('/**') && path.startsWith(s.slice(0, -2))))
}
export function findSourceEdit(run: Run, attemptId: string) {
  return run.agentTurns ? run.sourceEdits?.find(a => a.attemptId === attemptId) : run.attempts.find(a => a.attemptId === attemptId)
}
export function reserveSourceEdit(run: Run, input: { path: string; before: string; after: string; workerId: string; requestKey: string; requestHash?: string }): Run {
  if (run.writer) throw new WorkflowError('workspace-busy', 'Wait for the current writer to stop before editing')
  if (run.paused) throw new WorkflowError('run-paused', 'Explicitly resume before saving source changes')
  if (run.agentTurns) {
    if (!input.requestHash) throw new WorkflowError('invalid-edit', 'An autonomous save needs its exact request identity', 400)
    if (run.sourceEdits?.some(a => a.requestKey === input.requestKey)) throw new WorkflowError('duplicate-request', 'Edit request key already exists')
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
  const owners = contentOwners(run, input.path)
  if (!owners.length) throw new WorkflowError('edit-owner-missing', 'No current development task owns this registered source; authorize its owner in the plan first', 400)
  if (run.attempts.some(a => a.requestKey === input.requestKey)) throw new WorkflowError('duplicate-request', 'Edit request key already exists')
  const next = publishPlan(run, { protocol: V3_PROTOCOL, baseRevision: run.planRevision, requirementsRevision: run.requirements.revision,
    tasks: Object.values(run.tasks).filter(t => t.status !== 'superseded').map(t => t.spec) }, owners.map(t => t.spec.id))
  requireRebuild(next, Object.keys(next.plans.at(-1)!.impact ?? {}))
  next.fence++
  const attemptId = randomUUID()
  next.writer = { attemptId, fence: next.fence, workerId: input.workerId }
  // The edit is an audited host operation, not a native task PASS. Its owner
  // stays pending until explicit execution and fresh checks.
  next.attempts.push({ runId: run.id, taskId: owners[0]!.spec.id, attemptId, fence: next.fence, workerId: input.workerId,
    planRevision: next.planRevision, sessionId: 'host-edit:'+attemptId, requestKey: input.requestKey,
    inputVersions: [{ path: input.path, sha256: input.before }], status: 'running', startedAt: new Date().toISOString(),
    sourceEdit: { path: input.path, before: input.before, after: input.after, archive: '.beegame/workflow-v3-edits/'+attemptId+'/before.json', status: 'reserved' } })
  return next
}
export function settleSourceEdit(run: Run, attemptId: string, fence: number, error?: string): Run {
  if (run.writer?.attemptId !== attemptId || run.writer.fence !== fence)
    throw new WorkflowError('stale-attempt', 'Edit no longer owns the workspace writer')
  const next = structuredClone(run), attempt = findSourceEdit(next, attemptId)
  if (!attempt?.sourceEdit || attempt.sourceEdit.status !== 'reserved') throw new WorkflowError('invalid-edit', 'Not an unresolved host edit')
  if (!attempt.quiescedAt) throw new WorkflowError('writer-unresolved', 'Saving must drain before its writer can be released')
  attempt.sourceEdit.status = error ? 'failed' : 'saved'; attempt.finishedAt = new Date().toISOString()
  attempt.status = error ? 'failed' : 'blocked' // Saved candidate is deliberately not task acceptance.
  if (error) attempt.error = error
  delete next.writer; next.version++
  next.status = next.paused || next.agentTurns ? 'blocked' : 'running'
  next.blockedReason = next.paused ? 'User pause retained. Edited candidates and old measurements are not accepted.' :
    error ? 'Source edit failed: '+error+' Inspect actual saved sources and this edit record; no save/game acceptance or automatic retry.' :
    next.agentTurns ? 'Source edit ended. Saved candidates are unmeasured; explicitly ask the Agent to reconcile, rebuild and measure. No automatic dispatch.' :
    'Saved edit is an unmeasured candidate. Execute affected owner tasks and rebuild/measure; no automatic dispatch.'
  return next
}
