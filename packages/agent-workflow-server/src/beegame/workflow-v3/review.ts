import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod/v4'
import { CHECK_IDS, projectPathSchema, WorkflowError, type Run, type Attempt, type TaskSpec, type FileVersion, type CheckResult } from './state'
import { readVersion, versionsMatch, checkIsCurrent } from './checks'
import type { WorkflowStore } from './store'
import { digest } from './state'
import { assertIssueSources } from './preview-issues'
import { STATIC_ARTIFACT_CHECK_VERSION } from './runtime-checks'
import { CHECK_VERSIONS } from './check-versions'

const text = z.string().trim().min(1), key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const source = z.object({ path: projectPathSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), quote: text }).strict()
export const findingSchema = z.object({ id: key, requirementId: key, ownerTaskId: key, severity: z.enum(['blocker','advisory']),
  sources: z.array(source).min(1), impact: text, close: text, verifyWith: z.array(z.enum(CHECK_IDS)), needsUserDecision: z.boolean().optional(),
}).strict()
const closureSchema = z.object({ id: key, repairAttemptId: z.string().uuid(), sources: z.array(source).min(1), observed: text }).strict()
export const reviewReportSchema = z.object({ requirementsRevision: text, planRevision: z.number().int().positive(),
  findings: z.array(findingSchema), closed: z.array(closureSchema), limitations: z.array(text).min(1),
  observations: z.array(z.object({ id: z.string().uuid(), findingIds: z.array(key),
    disposition: z.enum(['finding', 'not-reproduced', 'out-of-scope']), reason: text }).strict()).optional(),
}).strict()
export type Finding = z.infer<typeof findingSchema>
export type ReviewOutcome = z.infer<typeof reviewReportSchema> & { report: FileVersion }
export type ReviewDecision = { toolUseID: string; findingIds: string[]; requirementsRevision: string; planRevision: number; sources: FileVersion[]; questions?: unknown; answers: unknown }
export type ReviewContext = { run: Run; attempt: Attempt; decisions?: ReviewDecision[] }
const owns = (task: TaskSpec, file: string) => task.writablePaths.some(scope => file === scope || scope.endsWith('/**') && file.startsWith(scope.slice(0,-2)))
export function attemptSpec(run: Run, attempt: Attempt): TaskSpec | undefined {
  return run.plans.find(plan => plan.revision === attempt.planRevision)?.plan.tasks.find(task => task.id === attempt.taskId)
}
export function repairFindings(run: Run, task: TaskSpec): { original: Attempt; findings: Finding[] } {
  const original = run.attempts.find(attempt => attempt.attemptId === task.repairOf?.attemptId)
  if (!original?.review) throw new WorkflowError('invalid-repair', 'Repair must reference an actual saved review attempt', 400)
  const findings = task.repairOf!.findingIds.map(id => original.review!.findings.find(finding => finding.id === id))
  if (findings.some(finding => !finding) || new Set(task.repairOf!.findingIds).size !== findings.length)
    throw new WorkflowError('invalid-repair', 'Repair finding IDs are absent or duplicated', 400)
  const ownerOf = (id: string) => run.plans.find(plan=>plan.revision===original.planRevision)?.plan.tasks.find(task=>task.id===id)
  for (const finding of findings as Finding[]) {
    const owner = ownerOf(finding.ownerTaskId)
    if (!owner || owner.kind !== 'game.develop') throw new WorkflowError('invalid-repair', 'Finding has no current development owner: '+finding.id, 400)
    if (!finding.verifyWith.every(id => task.checks.includes(id))) throw new WorkflowError('invalid-repair', 'Repair omits required consumer checks: '+finding.id, 400)
  }
  if (task.expectedOutputs.some(file => !(findings as Finding[]).some(finding => owns(ownerOf(finding.ownerTaskId)!, file))) ||
      task.writablePaths.some(scope => !(findings as Finding[]).some(finding => {
        const owner = ownerOf(finding.ownerTaskId)!
        return owner.writablePaths.some(allowed => scope === allowed || allowed.endsWith('/**') && scope.startsWith(allowed.slice(0,-2)))
      }))) throw new WorkflowError('invalid-repair', 'Repair expands the recorded owners’ write scope', 400)
  return { original, findings: findings as Finding[] }
}
export function validateRepairPlans(run: Run): void {
  const issues: string[] = []
  for (const task of run.plans.at(-1)?.plan.tasks ?? []) if (task.repairOf) {
    try { repairFindings(run, task) } catch (error) { issues.push(task.id+': '+(error instanceof Error ? error.message : 'Invalid repair')) }
  }
  if (issues.length) throw new WorkflowError('invalid-plan', issues.join('; '), 400)
}
/** Add only relevant immutable report pointers and finding sources. A failed
 * review is provenance for repair, not a successful dependency qualification. */
export async function reviewInputs(run: Run, task: TaskSpec): Promise<FileVersion[]> {
  await assertIssueSources(run, task)
  const files: FileVersion[] = []
  const prior = task.repairOf ? repairFindings(run, task).original : run.attempts.find(a => a.attemptId === task.reviewOf)
  if (task.repairOf || task.reviewOf) {
    if (!prior?.review || prior.review.requirementsRevision !== run.requirements.revision) throw new WorkflowError('stale-review', 'Previous review is absent or bound to another requirement revision')
    const saved = await readVersion(run.workspacePath, prior.review.report.path)
    if (saved.sha256 !== prior.review.report.sha256) throw new WorkflowError('stale-review', 'Referenced review report changed; do not guess its earlier findings')
    files.push(saved)
  }
  if (task.repairOf) for (const finding of repairFindings(run, task).findings) for (const source of finding.sources) {
    if (!await versionsMatch(run.workspacePath, [source])) throw new WorkflowError('stale-review', 'Finding source changed before repair: '+source.path)
    files.push({ path: source.path, sha256: source.sha256 })
  }
  return files
}
async function validateSources(root: string, refs: z.infer<typeof source>[], inputs: FileVersion[], run: Run) {
  for (const ref of refs) {
    const recorded = inputs.find(file => file.path === ref.path && file.sha256 === ref.sha256)
    if (!recorded) throw new WorkflowError('invalid-review-source', 'Review source is not a current bound input: '+ref.path, 400)
    const body = ref.path === 'requirement:'+run.requirements.revision ? run.requirements.text :
      (await readVersion(root, ref.path)).sha256 === ref.sha256 ? await readFile(resolve(root, ref.path), 'utf8') : undefined
    if (!body?.includes(ref.quote)) throw new WorkflowError('invalid-review-source', 'Quoted source missing or changed: '+ref.path, 400)
  }
}
export async function runReviewCheck(root: string, task: TaskSpec, inputs: FileVersion[], context: ReviewContext): Promise<{ check: CheckResult; review?: ReviewOutcome }> {
  const check: CheckResult = { id: 'review-findings', version: CHECK_VERSIONS['review-findings'], status: 'unverified', inputs: [...inputs], createdAt: new Date().toISOString(),
    observation: 'Review requires saved current source-backed findings. Format/source validation does not prove absence of semantic defects.' }
  if (!task.reviewReport) return { check }
  try {
    const { run, attempt } = context, report = await readVersion(root, task.reviewReport)
    for (const id of task.previewIssues ?? []) {
      const issue = run.previewIssues?.find(i=>i.id===id), measuredTask = issue && run.tasks[issue.taskId]
      const measured = run.attempts.find(a=>a.attemptId===measuredTask?.attemptId)
      const smoke = measured?.checks?.find(c=>c.id==='runtime-smoke' && c.status==='passed' && c.version===STATIC_ARTIFACT_CHECK_VERSION)
      if (!issue || measuredTask?.status!=='succeeded' || measured?.status!=='succeeded' || !smoke?.coverage?.files.length ||
          !smoke.artifacts?.some(a=>a.path===measuredTask.spec.runtimeArtifact) || !await checkIsCurrent(root,smoke))
        throw new WorkflowError('stale-review', 'Preview observation has no current measured consumer evidence: '+id)
      // Pin directory membership too: an added file during Review cannot escape
      // the final check merely because the originally bound files still match.
      check.inputs.push(...smoke.inputs); (check.artifacts ??= []).push(...(smoke.artifacts ?? []))
    }
    const outcome = reviewReportSchema.parse(JSON.parse(await readFile(resolve(root, task.reviewReport), 'utf8')))
    if (outcome.requirementsRevision !== run.requirements.revision || outcome.planRevision !== attempt.planRevision)
      throw new WorkflowError('stale-review', 'Report does not match the current requirement/attempt plan revision')
    if (new Set([...outcome.findings.map(f=>f.id), ...outcome.closed.map(f=>f.id)]).size !== outcome.findings.length+outcome.closed.length)
      throw new WorkflowError('invalid-review', 'Finding/closure IDs must be unique', 400)
    const observations = outcome.observations ?? [], expected = task.previewIssues ?? []
    if (observations.length !== expected.length || new Set(observations.map(o => o.id)).size !== observations.length ||
        observations.some(o => !expected.includes(o.id)))
      throw new WorkflowError('invalid-review', 'Each selected Preview observation needs an explicit disposition; omission is not resolution', 400)
    for (const observation of observations) {
      if (new Set(observation.findingIds).size !== observation.findingIds.length ||
          observation.findingIds.some(id => !outcome.findings.some(f => f.id === id) && !outcome.closed.some(f => f.id === id)) ||
          (observation.disposition === 'finding') !== (observation.findingIds.length > 0))
        throw new WorkflowError('invalid-review', 'Observation disposition must link actual findings or verified closures, not a fabricated PASS', 400)
      const old = task.reviewOf ? run.attempts.find(a => a.attemptId === task.reviewOf)?.review?.observations?.find(o => o.id === observation.id) : undefined
      if (old?.findingIds.some(id => !observation.findingIds.includes(id) && !outcome.closed.some(f => f.id === id)))
        throw new WorkflowError('invalid-closure', 'Previously linked observation findings cannot be silently discarded', 400)
    }
    for (const finding of outcome.findings) {
      if (!task.requirementIds.includes(finding.requirementId)) throw new WorkflowError('invalid-review', 'Finding requirement outside review scope: '+finding.id, 400)
      const owner = run.tasks[finding.ownerTaskId]?.spec
      if (!owner || owner.kind !== 'game.develop' || !finding.sources.some(source => owns(owner, source.path)))
        throw new WorkflowError('invalid-review', 'Finding owner does not own its cited source: '+finding.id, 400)
      await validateSources(root, finding.sources, inputs, run)
    }
    const previous = task.reviewOf ? run.attempts.find(a => a.attemptId === task.reviewOf) : undefined
    if (outcome.closed.length && !previous?.review) throw new WorkflowError('invalid-closure', 'Closing findings requires a previous actual review', 400)
    for (const closed of outcome.closed) {
      const finding = previous?.review?.findings.find(f=>f.id === closed.id), repaired = run.attempts.find(a=>a.attemptId === closed.repairAttemptId)
      const spec = repaired && attemptSpec(run, repaired)
      if (!finding || !repaired || repaired.status !== 'succeeded' || run.tasks[repaired.taskId]?.attemptId !== repaired.attemptId ||
          spec?.repairOf?.attemptId !== previous?.attemptId || !spec?.repairOf?.findingIds.includes(closed.id))
        throw new WorkflowError('invalid-closure', 'Closure lacks a current accepted authorized repair: '+closed.id, 400)
      await validateSources(root, closed.sources, inputs, run)
      if (!closed.sources.some(source=>finding.sources.some(old=>old.path===source.path) && repaired.outputs?.some(output=>output.path===source.path && output.sha256===source.sha256)))
        throw new WorkflowError('invalid-closure', 'Closure does not cite the actual repaired source output: '+closed.id, 400)
      for (const id of [...finding.verifyWith, 'repair-verification']) {
        const evidence = repaired.checks?.find(check=>check.id===id && check.status==='passed')
        if (!evidence || !await checkIsCurrent(root, evidence, spec)) throw new WorkflowError('invalid-closure', 'Repair consumer evidence absent or stale: '+id)
        check.inputs.push(...evidence.inputs); (check.artifacts ??= []).push(...(evidence.artifacts ?? []))
      }
    }
    for (const old of previous?.review?.findings.filter(f=>f.severity==='blocker') ?? []) {
      if (!outcome.findings.some(f=>f.id===old.id && f.severity==='blocker') && !outcome.closed.some(f=>f.id===old.id))
        throw new WorkflowError('invalid-closure', 'Previous blocker omitted or downgraded without closure: '+old.id, 400)
    }
    const review = { ...outcome, report }
    check.status = outcome.findings.some(f=>f.severity==='blocker') ? 'failed' : 'passed'
    check.observation = check.status === 'failed' ? 'Source-backed blockers require owner repair or a real user question: '+outcome.findings.filter(f=>f.severity==='blocker').map(f=>f.id).join(', ')
      : 'Directed review/report protocol and required repair evidence checked. Semantic judgement remains model/human review, not independent proof of complete game quality.'
    check.coverage = { files: [...new Set(outcome.findings.flatMap(f=>f.sources.map(s=>s.path)).concat(outcome.closed.flatMap(f=>f.sources.map(s=>s.path))))],
      limitations: outcome.limitations.concat('Source locations and actual check execution are verified; semantic merit, unseen omissions, taste and enjoyment are not guaranteed.') }
    return { check, review }
  } catch (error) {
    check.status = error instanceof WorkflowError && error.code === 'stale-review' ? 'unverified' : 'failed'
    check.observation = error instanceof Error ? error.message : 'Review failed'
    return { check }
  }
}
export async function runRepairCheck(root: string, task: TaskSpec, inputs: FileVersion[], checks: CheckResult[], context: ReviewContext): Promise<CheckResult> {
  const check: CheckResult = { id: 'repair-verification', version: CHECK_VERSIONS['repair-verification'], status: 'unverified', inputs: [...inputs], createdAt: new Date().toISOString(), observation: 'Repair needs original findings and actual consumer evidence, not a completion claim.' }
  const { findings } = repairFindings(context.run, task)
  for (const finding of findings) {
    if (finding.needsUserDecision && !context.decisions?.some(decision => decision.findingIds.includes(finding.id) &&
      decision.requirementsRevision === context.run.requirements.revision && decision.planRevision === context.attempt.planRevision)) {
      check.observation = 'Required real user question was not answered/validated: '+finding.id; return check
    }
    const observed = finding.verifyWith.filter(id => !['artifact-json','content-schema','skill-use','review-findings','repair-verification'].includes(id))
    if (!observed.length) { check.observation = 'No actual close verification for '+finding.id+'; user answers authorize a direction but do not prove factual/consumer closure. Escalate, do not loop or declare fixed'; return check }
    for (const id of finding.verifyWith) {
      const evidence = checks.find(check=>check.id===id && check.status==='passed')
      if (!evidence || !await checkIsCurrent(root, evidence, task)) { check.observation = 'Required consumer verification did not pass: '+finding.id+'/'+id; return check }
      check.inputs.push(...evidence.inputs); (check.artifacts ??= []).push(...(evidence.artifacts ?? []))
    }
  }
  check.status = 'passed'; check.observation = 'Authorized owner scope, required real decisions and actual consumer checks verified. Requires directed follow-up review; not proof that semantic findings or whole-game acceptance are closed.'
  return check
}

export function reviewQuestionGuard(run: Run, attempt: Attempt, store: Pick<WorkflowStore, 'read'>) {
  const task = run.tasks[attempt.taskId]!.spec, { original, findings } = repairFindings(run, task)
  const pending = new Map<string, string>()
  return async (request: { toolUseID: string; input: Record<string, unknown> }, decision?: { source?: string; updatedInput?: Record<string, unknown> }): Promise<Record<string, unknown>> => {
    const current = await store.read(run.projectId, run.ownerId)
    if (current?.id !== run.id || current.paused || current.requirements.revision !== run.requirements.revision ||
        current.planRevision !== attempt.planRevision || current.writer?.attemptId !== attempt.attemptId || current.writer.fence !== attempt.fence)
      throw new WorkflowError('stale-question', 'Question no longer owns the current requirement/plan/writer')
    const questions = request.input.questions as { header?: unknown }[] | undefined
    if (!Array.isArray(questions) || !questions.length || request.input.answers !== undefined || request.input.metadata !== undefined)
      throw new WorkflowError('invalid-question', 'Use standard unanswered AskUserQuestion; do not supply answers or custom metadata', 400)
    const ids = questions.map(question=>question.header)
    if (new Set(ids).size !== ids.length || ids.some(id=>!findings.some(f=>f.id===id && f.needsUserDecision)))
      throw new WorkflowError('invalid-question', 'Question headers must match selected decision-required finding IDs', 400)
    const sources = [original.review!.report, ...findings.filter(f=>ids.includes(f.id)).flatMap(f=>f.sources.map(({path,sha256})=>({path,sha256})))]
    if (!await versionsMatch(run.workspacePath, sources)) throw new WorkflowError('stale-question', 'Decision sources changed; obtain a new source-backed finding/question before continuing')
    const identity = digest(JSON.stringify(request.input))
    if (!decision) pending.set(request.toolUseID, identity)
    else if (decision.source !== 'user' || !decision.updatedInput?.answers || pending.get(request.toolUseID) !== identity)
      throw new WorkflowError('invalid-question', 'Only the actual user reply to this unchanged native question is authorization')
    return { findingIds: ids, requirementsRevision: run.requirements.revision, planRevision: attempt.planRevision, sources }
  }
}
