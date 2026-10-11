import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod/v4'

export const V3_PROTOCOL = 'bgs.workflow.v3' as const
export const CHECK_IDS = ['artifact-json', 'content-schema', 'content-structure', 'content-layout', 'content-resources', 'build', 'rule-tests', 'runtime-smoke', 'delivery-package', 'ui-data-consumption', 'pixel-data-consumption', 'font-data-consumption', 'audio-data-consumption', 'review-findings', 'repair-verification'] as const
const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const path = z.string().min(1).refine(value => !value.startsWith('/') && !value.includes('\\') &&
  !value.split('/').some(part => !part || part === '..' || part === '.' || part === '.git' || part === '.beegame'), 'Use project-relative paths outside host metadata')
export const projectPathSchema = path
export const uiProbeSchema = z.object({ document: path, nodeId: z.string().trim().min(1), selector: z.string().trim().min(1),
  viewport: z.tuple([z.number().int().min(1).max(8192), z.number().int().min(1).max(8192)]),
  steps: z.array(z.object({ click: z.string().trim().min(1) }).strict()).optional(),
}).strict()
export const taskSchema = z.object({
  id: key, kind: z.enum(['game.develop', 'game.verify']), goal: z.string().trim().min(1),
  dependsOn: z.array(key), requirementIds: z.array(key).min(1), inputs: z.array(z.string().min(1)),
  writablePaths: z.array(path), expectedOutputs: z.array(path).min(1), checks: z.array(z.enum(CHECK_IDS)).min(1),
  skills: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*$/)).optional(),
  bindingPlan: path.refine(value => value.endsWith('.json'), 'Binding plan must be a saved JSON file').optional(),
  // A static web build, not an arbitrary URL or executable runtime driver.
  runtimeArtifact: path.optional(),
  editableProject: z.literal(true).optional(),
  uiProbes: z.array(uiProbeSchema).min(1).optional(),
  pixelProbes: z.array(uiProbeSchema.extend({ componentId: z.string().trim().min(1).optional() })).min(1).optional(),
  audioProbes: z.array(uiProbeSchema.extend({
    componentId: z.string().trim().min(1),
    playSteps: z.array(z.object({ click: z.string().trim().min(1) }).strict()).min(1),
    stopSteps: z.array(z.object({ click: z.string().trim().min(1) }).strict()).min(1),
  })).min(1).optional(),
  reviewReport: path.optional(),
  reviewOf: z.string().uuid().optional(),
  previewIssues: z.array(z.string().uuid()).min(1).optional(),
  repairOf: z.object({ attemptId: z.string().uuid(), findingIds: z.array(key).min(1) }).strict().optional(),
}).strict()
export const planSchema = z.object({ protocol: z.literal(V3_PROTOCOL), baseRevision: z.number().int().nonnegative(),
  requirementsRevision: z.string().min(1), tasks: z.array(taskSchema).min(1) }).strict()
export type TaskSpec = z.infer<typeof taskSchema>
export type Plan = z.infer<typeof planSchema>
export type FileVersion = { path: string; sha256: string }
export type PreviewIssue = { id: string; requestKey: string; createdAt: string; reporterId: string;
  requirementsRevision: string; planRevision: number; taskId: string; attemptId: string; artifact: FileVersion;
  requirementIds: string[]; steps: string; expected: string; observed: string }
export type CheckResult = { id: string; version: string; status: 'passed' | 'failed' | 'unverified' | 'execution-error';
  inputs: FileVersion[]; observation: string; createdAt: string; artifacts?: FileVersion[];
  coverage?: { files: string[]; limitations: string[] }; projectBuild?: {
    version: 'v3-editable-build.1'; files: FileVersion[]; excludedReports: string[];
    artifact: FileVersion; dependencySha256?: string; runtime: string;
  } }
export type ExecutionIdentity = { runId: string; taskId: string; attemptId: string }
export type SkillUse = { name: string; toolUseID: string; eventId: number; parentToolUseID?: string; status: 'loaded' | 'failed' | 'unverified' }
export type BindingOutcome = { mapping: FileVersion; valid: boolean; written: Array<{ file: string; sha256: string; nodes: string[]; changed: boolean }>;
  pending: string[]; issues: string[] }
export type Attempt = ExecutionIdentity & { fence: number; workerId: string; planRevision: number; sessionId: string;
  requestKey: string; inputVersions: FileVersion[]; status: 'running' | 'succeeded' | 'failed' | 'blocked';
  startedAt: string; finishedAt?: string; nativeSessionId?: string; turnId?: string; accountingEpochs?: string[];
  usage?: unknown; checks?: CheckResult[]; outputs?: FileVersion[]; skillUses?: SkillUse[]; binding?: BindingOutcome;
  review?: import('./review').ReviewOutcome; decisions?: import('./review').ReviewDecision[]; error?: string;
  // Host records this only after native cleanup AND all owned host operations
  // have drained. It proves quiescence, never output validity or external success.
  quiescedAt?: string;
  sourceEdit?: { path: string; before: string; after: string; archive: string; status: 'reserved' | 'saved' | 'failed' } }
export type Run = {
  protocol: typeof V3_PROTOCOL; id: string; projectId: string; ownerId: string; workspacePath: string; chatSessionId: string;
  version: number; requestKey: string; status: 'planning' | 'running' | 'blocked' | 'completed';
  requirements: { revision: string; text: string; constraints: Record<string, unknown>; ids: string[]; sha256: string };
  planRevision: number; plans: Array<{ revision: number; plan: Plan; impact?: Record<string, string> }>;
  tasks: Record<string, { spec: TaskSpec; status: 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'superseded'; attemptId?: string }>;
  attempts: Attempt[]; writer?: { attemptId: string; fence: number; workerId: string }; fence: number;
  // Native goal turns, not host-created Task specifications or release checks.
  agentTurns?: AgentTurn[];
  // User-authorized host saves; these are neither native turns nor Task plans.
  sourceEdits?: SourceEdit[];
  // Task checks are not a release acceptance. V3-06 connects target-runtime evidence.
  deliveryEligible: false; createdAt: string;
  // Durable user intent; neither settlement, replanning nor restart clears it.
  paused?: { at: string };
  blockedReason?: string;
  previewIssues?: PreviewIssue[];
  requirementChanges?: Array<{ requestKey: string; actorId: string; at: string; before: Run['requirements']; after: Run['requirements'] }>;
}
export class WorkflowError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 409) { super(message) }
}
export type AgentTurn = {
  attemptId: string; requestKey: string; sessionId: string; workerId: string; fence: number;
  status: 'running' | 'ended' | 'failed' | 'interrupted'; startedAt: string; finishedAt?: string;
  turnId?: string; nativeSessionId?: string; usage?: unknown; skillUses?: SkillUse[];
  quiescedAt?: string; error?: string;
  // Original user request, not a host-authored execution/repair plan.
  message?: AgentMessage;
  requirementsRevision?: string;
  // Optional host-observed source-copy build/smoke facts, never a quality verdict.
  measurements?: AgentMeasurement[];
}
export type AgentMeasurement = {
  id: string; requestKey: string; runtimeArtifact: string; reportPaths: string[];
  requirementsRevision: string; startedAt: string; finishedAt?: string;
  sourceEditId?: string;
  reports: FileVersion[]; checks: CheckResult[]; error?: string;
}
export type SourceEdit = Pick<Attempt, 'attemptId' | 'fence' | 'workerId' | 'sessionId' | 'requestKey' |
  'startedAt' | 'finishedAt' | 'quiescedAt' | 'error'> & {
  status: 'running' | 'blocked' | 'failed'; sourceEdit: NonNullable<Attempt['sourceEdit']>;
  requirementsRevision: string; requestHash: string;
}
export type AgentMessage = {
  requestKey: string; runId: string; chatSessionId: string; expectedVersion: number;
  requirementsRevision: string; intent: 'discuss' | 'change' | 'continue'; text: string;
  continuationOf?: string;
}
export function pauseRun(run: Run): Run {
  if (run.paused) return run
  const next = structuredClone(run); next.version++; next.paused = { at: new Date().toISOString() }
  next.status = 'blocked'; next.blockedReason = 'User paused this Run. Partial work is not accepted and no new task may start until explicit resume.'
  return next
}
export function resumeRun(run: Run): Run {
  if (run.writer) throw new WorkflowError('writer-unresolved', 'Confirm the previous writer stopped before resuming; resume cannot release an unknown writer')
  if (!run.paused) return run
  const next = structuredClone(run); next.version++; delete next.paused
  const runnable = Object.values(next.tasks).some(t => t.status === 'pending' && t.spec.dependsOn.every(dep => next.tasks[dep]?.status === 'succeeded'))
  next.status = runnable ? 'running' : 'blocked'
  if (runnable) delete next.blockedReason
  else next.blockedReason = 'Resumed without retrying failed or incomplete work. Submit an affected repair plan or inspect outstanding checks.'
  return next
}
export function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
export function createRun(input: { projectId: string; ownerId: string; workspacePath: string; chatSessionId: string;
  requestKey: string; text: string; constraints: Record<string, unknown>; ids: string[] }): Run {
  if (!input.text.trim() || !input.requestKey || !input.ids.length || new Set(input.ids).size !== input.ids.length)
    throw new WorkflowError('invalid-requirements', 'Original requirements, request key and unique requirement IDs are required', 400)
  for (const id of input.ids) key.parse(id)
  return { protocol: V3_PROTOCOL, id: randomUUID(), projectId: input.projectId, ownerId: input.ownerId,
    workspacePath: input.workspacePath, chatSessionId: input.chatSessionId, version: 1, requestKey: input.requestKey,
    requirements: { revision: randomUUID(), text: input.text, constraints: structuredClone(input.constraints), ids: [...input.ids],
      sha256: digest(JSON.stringify({ text: input.text, constraints: input.constraints, ids: input.ids })) },
    planRevision: 0, plans: [], tasks: {}, attempts: [], fence: 0, status: 'planning', deliveryEligible: false,
    createdAt: new Date().toISOString() }
}
export function publishPlan(run: Run, value: unknown, staleTasks: readonly string[] = []): Run {
  const parsed = planSchema.safeParse(value)
  if (!parsed.success) throw new WorkflowError('invalid-plan', JSON.stringify(parsed.error.issues), 400)
  const plan = parsed.data, issues: string[] = []
  if (plan.baseRevision !== run.planRevision) issues.push('baseRevision is not the current plan revision')
  if (plan.requirementsRevision !== run.requirements.revision) issues.push('requirementsRevision is not the host snapshot')
  if (run.writer) issues.push('Previous writer must be confirmed stopped before revising a plan')
  const ids = new Set(plan.tasks.map(task => task.id))
  if (ids.size !== plan.tasks.length) issues.push('Task IDs must be unique')
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) { issues.push('Dependency cycle: '+id); return }
    if (visited.has(id)) return
    visiting.add(id)
    for (const dep of plan.tasks.find(task => task.id === id)?.dependsOn ?? []) if (ids.has(dep)) visit(dep)
    visiting.delete(id); visited.add(id)
  }
  for (const task of plan.tasks) {
    if (task.editableProject && (task.kind !== 'game.develop' || !task.runtimeArtifact || !task.checks.includes('build') ||
        !task.checks.includes('runtime-smoke') || !task.writablePaths.includes(task.runtimeArtifact+'/**')))
      issues.push(task.id+': editableProject requires a development build/runtime-smoke task and full runtimeArtifact/** write authority')
    if (task.pixelProbes && (!task.runtimeArtifact || !task.checks.includes('pixel-data-consumption')))
      issues.push(task.id+': pixelProbes requires runtimeArtifact and pixel-data-consumption')
    if (task.checks.includes('pixel-data-consumption') && (!task.pixelProbes || !task.runtimeArtifact))
      issues.push(task.id+': pixel-data-consumption requires actual pixelProbes and runtimeArtifact')
    if (task.uiProbes && (!task.runtimeArtifact || !task.checks.some(c => c === 'ui-data-consumption' || c === 'font-data-consumption')))
      issues.push(task.id+': uiProbes requires runtimeArtifact and ui-data-consumption or font-data-consumption')
    if (task.checks.includes('ui-data-consumption') && (!task.uiProbes || !task.runtimeArtifact))
      issues.push(task.id+': ui-data-consumption requires runtimeArtifact and actual uiProbes')
    if (task.checks.includes('font-data-consumption') && (!task.uiProbes || !task.runtimeArtifact))
      issues.push(task.id+': font-data-consumption requires runtimeArtifact and actual uiProbes')
    if (task.audioProbes && (!task.runtimeArtifact || !task.checks.includes('audio-data-consumption')))
      issues.push(task.id+': audioProbes requires runtimeArtifact and audio-data-consumption')
    if (task.checks.includes('audio-data-consumption') && (!task.audioProbes || !task.runtimeArtifact))
      issues.push(task.id+': audio-data-consumption requires runtimeArtifact and actual audioProbes')
    if (task.reviewReport && (task.kind !== 'game.verify' || !task.expectedOutputs.includes(task.reviewReport) || !task.checks.includes('review-findings')))
      issues.push(task.id+': reviewReport requires a verify task, a declared report output and review-findings')
    if (task.checks.includes('review-findings') && !task.reviewReport) issues.push(task.id+': review-findings requires reviewReport')
    if (task.reviewOf && !task.reviewReport) issues.push(task.id+': reviewOf requires reviewReport')
    if (task.previewIssues && (!task.reviewReport || new Set(task.previewIssues).size !== task.previewIssues.length ||
        task.previewIssues.some(id => !run.previewIssues?.some(issue => issue.id === id && issue.requirementsRevision === run.requirements.revision))))
      issues.push(task.id+': previewIssues requires unique saved observations and a directed review')
    if (task.reviewOf && (!run.attempts.some(attempt => attempt.attemptId === task.reviewOf && attempt.review) ||
        run.attempts.find(attempt=>attempt.attemptId===task.reviewOf)?.review?.report.path === task.reviewReport))
      issues.push(task.id+': reviewOf requires an actual prior review and a separate follow-up report')
    if (task.repairOf && (task.kind !== 'game.develop' || !task.checks.includes('repair-verification')))
      issues.push(task.id+': repairOf requires a development task and repair-verification')
    if (task.checks.includes('repair-verification') && !task.repairOf) issues.push(task.id+': repair-verification requires actual repairOf findings')
    if (task.repairOf && !run.attempts.some(attempt=>attempt.attemptId === task.repairOf!.attemptId && attempt.review))
      issues.push(task.id+': repairOf must reference an actual prior review')
    if (task.bindingPlan && (task.kind !== 'game.develop' || /^content\/(ui|scenes)\//.test(task.bindingPlan) || !task.expectedOutputs.includes(task.bindingPlan) ||
        !task.expectedOutputs.some(file => /^content\/(ui|scenes)\/.+\.json$/.test(file))))
      issues.push(task.id+': bindingPlan requires a development task, a separate mapping outside Scene/UI directories, and mapping/target files in expectedOutputs')
    for (const dep of task.dependsOn) if (!ids.has(dep)) issues.push(task.id+': missing dependency '+dep)
    for (const id of task.requirementIds) if (!run.requirements.ids.includes(id)) issues.push(task.id+': unknown requirement '+id)
    for (const item of task.inputs) {
      if (item.startsWith('requirement:')) {
        if (!run.requirements.ids.some(id => item === `requirement:${id}@${run.requirements.revision}`)) issues.push(task.id+': unknown requirement input '+item)
      } else if (item.startsWith('output:')) {
        const [dep, ...parts] = item.slice(7).split('/')
        if (!task.dependsOn.includes(dep!) || !plan.tasks.find(t => t.id === dep)?.expectedOutputs.includes(parts.join('/')))
          issues.push(task.id+': unknown dependency output '+item)
      } else if (!path.safeParse(item).success) issues.push(task.id+': invalid input '+item)
    }
    for (const output of task.expectedOutputs) if (!task.writablePaths.some(p => output === p || (p.endsWith('/**') && output.startsWith(p.slice(0, -2)))))
      issues.push(task.id+': output outside declared write scope '+output)
    visit(task.id)
  }
  for (const id of run.requirements.ids) if (!plan.tasks.some(t => t.requirementIds.includes(id))) issues.push('Missing registered requirement '+id)
  if (!plan.tasks.some(t => t.kind === 'game.develop')) issues.push('Game delivery requires an actual development task')
  if (issues.length) throw new WorkflowError('invalid-plan', issues.join('; '), 400)
  const next = structuredClone(run); next.version++; next.planRevision++; next.status = 'running'
  const impact: Record<string, string> = {}
  for (const spec of plan.tasks) {
    const prior = run.tasks[spec.id]
    if (!prior || prior.status === 'superseded' || JSON.stringify(taskSchema.parse(prior.spec)) !== JSON.stringify(spec)) impact[spec.id] = 'Task contract changed or newly authorized'
    else if (staleTasks.includes(spec.id)) impact[spec.id] = 'Recorded inputs, outputs or checks are no longer current'
  }
  for (const id of Object.keys(run.tasks)) if (!ids.has(id) && run.tasks[id]!.status !== 'superseded') impact[id] = 'Task removed from the current plan'
  const covered = (file: string, scope: string) => file === scope || scope.endsWith('/**') && file.startsWith(scope.slice(0, -2))
  // Follow explicit dependencies and saved observed file inputs. Bash can hide
  // indirect reads; this is a conservative local impact set, not a perfect DAG.
  let expanded = true
  while (expanded) {
    expanded = false
    for (const spec of plan.tasks) {
      if (impact[spec.id]) continue
      const attempt = run.attempts.find(a => a.attemptId === run.tasks[spec.id]?.attemptId)
      const reads = [...spec.inputs, ...(attempt?.inputVersions.map(v => v.path) ?? []), ...(attempt?.checks?.flatMap(c => [...c.inputs.map(v => v.path), ...(c.projectBuild?.files.map(v => v.path) ?? [])]) ?? [])]
      const cause = Object.keys(impact).find(id => spec.dependsOn.includes(id) ||
        [...(run.tasks[id]?.spec.writablePaths ?? []), ...(plan.tasks.find(t => t.id === id)?.writablePaths ?? [])].some(scope => reads.some(file => covered(file, scope))))
      if (cause) { impact[spec.id] = 'Depends on or reads the revised writer scope: '+cause; expanded = true }
    }
  }
  next.plans.push({ revision: next.planRevision, plan, impact })
  for (const [id, task] of Object.entries(next.tasks)) if (!ids.has(id)) task.status = 'superseded'
  for (const spec of plan.tasks) next.tasks[spec.id] = !impact[spec.id] && next.tasks[spec.id]
    ? { ...next.tasks[spec.id]!, spec } : { spec, status: 'pending' }
  const runnable = Object.values(next.tasks).some(t => t.status === 'pending' && t.spec.dependsOn.every(dep => next.tasks[dep]?.status === 'succeeded'))
  next.status = runnable ? 'running' : 'blocked'
  if (runnable) delete next.blockedReason
  else next.blockedReason = 'No newly authorized runnable task. Unchanged failed work is not automatically retried; task success alone is not delivery acceptance.'
  if (next.paused) { next.status = 'blocked'; next.blockedReason = 'Run remains user-paused after plan revision; explicit resume is required.' }
  return next
}
export function claimTask(run: Run, input: { taskId: string; requestKey: string; workerId: string; sessionId: string; inputVersions: FileVersion[] }): Run {
  const task = run.tasks[input.taskId]
  if (run.paused) throw new WorkflowError('run-paused', 'Explicitly resume this user-paused Run before starting new work')
  if (run.writer) throw new WorkflowError('writer-unresolved', 'Previous writer must be confirmed stopped; elapsed time does not authorize a replacement')
  if (run.status !== 'running' || task?.status !== 'pending') throw new WorkflowError('task-not-ready', 'Task is not pending in the current plan')
  for (const dep of task.spec.dependsOn) if (run.tasks[dep]?.status !== 'succeeded') throw new WorkflowError('dependency-unverified', 'Dependency is not currently successful: '+dep)
  if (run.attempts.some(a => a.requestKey === input.requestKey)) throw new WorkflowError('duplicate-request', 'Execution request already exists')
  const next = structuredClone(run), attemptId = randomUUID(); next.version++; next.fence++
  next.writer = { attemptId, workerId: input.workerId, fence: next.fence }
  next.tasks[input.taskId]!.status = 'running'; next.tasks[input.taskId]!.attemptId = attemptId
  next.attempts.push({ runId: run.id, taskId: input.taskId, attemptId, fence: next.fence, workerId: input.workerId,
    planRevision: run.planRevision, requestKey: input.requestKey, sessionId: input.sessionId,
    inputVersions: input.inputVersions, status: 'running', startedAt: new Date().toISOString() })
  return next
}
export function finishTask(run: Run, attemptId: string, fence: number, result: Pick<Attempt,
  'checks' | 'outputs' | 'usage' | 'error' | 'nativeSessionId' | 'turnId' | 'accountingEpochs' | 'skillUses' | 'binding' | 'review' | 'decisions'>, writerStopped: boolean): Run {
  const attempt = run.attempts.find(a => a.attemptId === attemptId)
  if (!attempt || run.writer?.attemptId !== attemptId || run.writer.fence !== fence || attempt.planRevision !== run.planRevision)
    throw new WorkflowError('stale-attempt', 'Result does not own the current writer/plan')
  if (!writerStopped) throw new WorkflowError('writer-unresolved', 'Native writer exit has not been confirmed')
  const next = structuredClone(run), target = next.attempts.find(a => a.attemptId === attemptId)!
  Object.assign(target, result, { finishedAt: new Date().toISOString() })
  const spec = next.tasks[target.taskId]!.spec
  const required: string[] = [...spec.checks, ...(spec.skills?.length ? ['skill-use'] : []), ...(spec.bindingPlan ? ['content-binding'] : [])]
  target.status = result.error || result.checks?.some(c => c.status === 'failed') ? 'failed' : required.every(id => result.checks?.some(c => c.id === id && c.status === 'passed')) ? 'succeeded' : 'blocked'
  next.tasks[target.taskId]!.status = target.status; delete next.writer; next.version++
  const allTasksFinished = Object.values(next.tasks).every(t => ['succeeded', 'superseded'].includes(t.status))
  // One failed branch does not revoke an unrelated pending task's authorization.
  // No dispatch is performed here: a fresh explicit execute request is required.
  const runnable = Object.values(next.tasks).some(t => t.status === 'pending' && t.spec.dependsOn.every(dep => next.tasks[dep]?.status === 'succeeded'))
  next.status = runnable ? 'running' : 'blocked'
  if (allTasksFinished) next.blockedReason = 'Task checks finished. Static-load smoke/package checks do not establish formal content consumption or complete game delivery acceptance.'
  else if (target.status !== 'succeeded') next.blockedReason = result.error ?? 'Required task checks did not pass; inspect the stored diagnostics.'
  if (next.paused) { next.status = 'blocked'; next.blockedReason = 'Run remains user-paused. Stopped task evidence/history is retained; resume does not automatically retry partial work.' }
  return next
}
