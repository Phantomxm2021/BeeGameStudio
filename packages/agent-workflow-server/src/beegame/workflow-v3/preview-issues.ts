import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { selectMeasuredBuild } from './measured-build'
import { readVersion, staleTaskIds } from './checks'
import { attemptSpec, validateRepairPlans } from './review'
import { publishPlan, WorkflowError, type Run, type TaskSpec } from './state'

export const issueSchema = z.object({ requestKey: z.string().trim().min(1), taskId: z.string().min(1), attemptId: z.string().uuid(),
  planRevision: z.number().int().positive(), artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  requirementIds: z.array(z.string().min(1)).min(1), steps: z.string().trim().min(1), expected: z.string().trim().min(1), observed: z.string().trim().min(1),
}).strict()
/** An authenticated user's observation, never a trusted defect or a PASS. */
export async function recordPreviewIssue(run: Run, value: unknown, busy: boolean) {
  const body = issueSchema.parse(value), prior = run.previewIssues?.find(i => i.requestKey === body.requestKey)
  if (prior) {
    const saved = { requestKey: prior.requestKey, taskId: prior.taskId, attemptId: prior.attemptId, planRevision: prior.planRevision,
      artifactSha256: prior.artifact.sha256, requirementIds: prior.requirementIds, steps: prior.steps, expected: prior.expected, observed: prior.observed }
    if (JSON.stringify(saved) !== JSON.stringify(body)) throw new WorkflowError('duplicate-request', 'Observation request key was used for different content')
    return { run, issue: prior }
  }
  if (body.planRevision !== run.planRevision) throw new WorkflowError('revision-conflict', 'Read the current plan before recording the observation')
  if (new Set(body.requirementIds).size !== body.requirementIds.length || body.requirementIds.some(id => !run.requirements.ids.includes(id)))
    throw new WorkflowError('invalid-observation', 'Select unique confirmed requirement IDs', 400)
  const selected = await selectMeasuredBuild(run, body.taskId, body.attemptId, busy)
  if (selected.artifact.sha256 !== body.artifactSha256) throw new WorkflowError('preview-stale', 'Observation does not match the measured build')
  const issue = { id: randomUUID(), requestKey: body.requestKey, createdAt: new Date().toISOString(), reporterId: run.ownerId,
    requirementsRevision: run.requirements.revision, planRevision: run.planRevision, taskId: body.taskId, attemptId: body.attemptId,
    artifact: selected.artifact, requirementIds: body.requirementIds, steps: body.steps, expected: body.expected, observed: body.observed }
  const next = structuredClone(run); next.version++; (next.previewIssues ??= []).push(issue)
  return { run: next, issue }
}
export async function assertIssueSources(run: Run, task: TaskSpec) {
  if (task.reviewOf) {
    const prior = run.attempts.find(a => a.attemptId === task.reviewOf), spec = prior && attemptSpec(run, prior)
    if (JSON.stringify([...(spec?.previewIssues ?? [])].sort()) !== JSON.stringify([...(task.previewIssues ?? [])].sort()))
      throw new WorkflowError('invalid-review', 'Follow-up must retain exactly the previously reviewed Preview observations', 400)
    return // Historical observation; current Repair and source checks govern follow-up.
  }
  for (const id of task.previewIssues ?? []) {
    const issue = run.previewIssues?.find(i => i.id === id)
    if (!issue) throw new WorkflowError('observation-not-found', 'Saved Preview observation missing', 400)
    const selected = await selectMeasuredBuild(run, issue.taskId, issue.attemptId)
    if (selected.artifact.sha256 !== issue.artifact.sha256) throw new WorkflowError('preview-stale', 'Observation measurement changed; make a new explicit review selection')
  }
}
export async function prepareIssueReview(run: Run, id: string) {
  const issue = run.previewIssues?.find(i => i.id === id)
  if (!issue) throw new WorkflowError('observation-not-found', 'Saved Preview observation missing', 404)
  const taskId = 'preview-review.'+id
  if (run.tasks[taskId]?.spec.previewIssues?.includes(id)) return run // Idempotent, never restart a failed review.
  const selected = await selectMeasuredBuild(run, issue.taskId, issue.attemptId)
  if (selected.artifact.sha256 !== issue.artifact.sha256) throw new WorkflowError('preview-stale', 'Observation refers to a different measured version')
  const report = 'reviews/preview-'+id+'.json'
  const task: TaskSpec = { id: taskId, kind: 'game.verify', goal: 'Inspect the saved Preview observation against actual sources and confirmed requirements. Reproduce where possible; assign any defect to its actual source owner. No source repair or new requirements.',
    requirementIds: issue.requirementIds, dependsOn: [issue.taskId], inputs: selected.smoke.inputs.filter(v => !v.path.startsWith('requirement:')).map(v => v.path),
    writablePaths: [report], expectedOutputs: [report], checks: ['review-findings'], reviewReport: report, previewIssues: [id] }
  return publishPlan(run, { ...run.plans.at(-1)!.plan, baseRevision: run.planRevision,
    tasks: [...Object.values(run.tasks).filter(t => t.status !== 'superseded').map(t => t.spec), task] }, await staleTaskIds(run))
}
/** Explicit preparation only: existing executor still requires an execute action
 * for each task. No model dispatch, loop, new owner scope or guessed closure. */
export async function prepareReviewedRepair(run: Run, attemptId: string, findingIds: string[]) {
  const prior = run.attempts.find(a => a.attemptId === attemptId), oldReview = prior && attemptSpec(run, prior)
  if (!prior?.review || !oldReview?.previewIssues || run.tasks[prior.taskId]?.attemptId !== prior.attemptId)
    throw new WorkflowError('invalid-review', 'Select the current source-backed Preview review', 400)
  const findings = prior.review.findings.filter(f => findingIds.includes(f.id))
  if (!findings.length || new Set(findingIds).size !== findingIds.length || findings.length !== findingIds.length ||
      prior.review.findings.some(f => f.severity === 'blocker' && !findingIds.includes(f.id)))
    throw new WorkflowError('invalid-repair', 'Select every current blocker for the concentrated repair; unresolved disagreements require a question, not omission', 400)
  if (oldReview.reviewOf) throw new WorkflowError('review-escalation', 'The directed follow-up is not closed; inspect evidence/ask the authorized decision owner. No automatic repair loop.')
  if ((await readVersion(run.workspacePath, prior.review.report.path)).sha256 !== prior.review.report.sha256)
    throw new WorkflowError('stale-review', 'Saved review report changed; authorize an affected review instead of guessing old findings')
  for (const finding of findings) for (const source of finding.sources)
    if ((source.path === 'requirement:'+run.requirements.revision ? run.requirements.sha256 : (await readVersion(run.workspacePath, source.path)).sha256) !== source.sha256)
      throw new WorkflowError('stale-review', 'Finding source changed; authorize an affected review instead of using an old finding')
  const specs = Object.values(run.tasks).filter(t => t.status !== 'superseded').map(t => t.spec)
  const owners = [...new Set(findings.map(f => f.ownerTaskId))]
  for (const id of owners) {
    const originalOwner = run.plans.find(p => p.revision === prior.planRevision)?.plan.tasks.find(t => t.id === id)
    const currentOwner = run.tasks[id]?.spec
    if (!originalOwner || JSON.stringify(originalOwner) !== JSON.stringify(currentOwner))
      throw new WorkflowError('owner-changed', 'Owner contract changed; explicitly plan an affected repair, do not infer new authority')
    const selected = findings.filter(f => f.ownerTaskId === id)
    const replacement = { ...originalOwner, goal: 'Repair only the selected Preview findings within the original owner scope: '+selected.map(f => f.id).join(', '),
      inputs: [...new Set([...originalOwner.inputs, ...selected.flatMap(f => f.sources.filter(s=>!s.path.startsWith('requirement:')).map(s => s.path))])],
      checks: [...new Set([...originalOwner.checks, ...selected.flatMap(f => f.verifyWith), 'repair-verification' as const])],
      repairOf: { attemptId, findingIds: selected.map(f => f.id) } }
    specs[specs.findIndex(t => t.id === id)] = replacement
  }
  // Follow-up waits for both the original measured consumer and actual repairs.
  const report = 'reviews/preview-followup-'+attemptId+'.json'
  specs[specs.findIndex(t => t.id === prior.taskId)] = { ...oldReview, goal: 'Directed follow-up of the selected Preview findings and actual owner repair evidence; retain unresolved blockers.',
    dependsOn: [...new Set([...oldReview.dependsOn, ...owners])], reviewOf: attemptId, reviewReport: report, writablePaths: [report], expectedOutputs: [report] }
  const next = publishPlan(run, { ...run.plans.at(-1)!.plan, baseRevision: run.planRevision, tasks: specs }, await staleTaskIds(run))
  validateRepairPlans(next)
  return next
}
