import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile, resolveWorkflowEvidencePath } from './evidence'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DeliveryRun, EvidenceRef, WorkerDispatchRequest } from './types'
import type { WorkerTerminalResult } from './worker-contracts'
import { runtimeEvidenceIsCurrent, type RuntimeAcceptance } from './runtime-acceptance'

function currentImplementationRevision(run: DeliveryRun): string {
  return run.revision.implementation ?? run.revision.workspace
}

function allTasksComplete(run: DeliveryRun): boolean {
  return (
    run.tasks.length > 0 &&
    run.tasks.every(
      task =>
        task.status === 'completed' &&
        Boolean(task.completedRevision) &&
        task.evidenceRefs.length > 0,
    )
  )
}

export function enterAcceptance(run: DeliveryRun): DeliveryRun {
  if (run.phase !== 'IMPLEMENTATION' || !allTasksComplete(run))
    throw new Error(
      'cannot enter acceptance before implementation is complete',
    )
  if (!run.gameContentReceipt || !run.revision.content ||
      run.gameContentReceipt.contentRevision !== run.revision.content)
    throw new Error('cannot enter acceptance without the accepted Scene/UI content package')
  return {
    ...run,
    phase: 'ACCEPTANCE',
    activeTaskId: undefined,
    activeDispatch: undefined,
    updatedAt: new Date().toISOString(),
  }
}

export async function startAcceptance(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: { dispatch(request: WorkerDispatchRequest): Promise<unknown> }
  checklistIds: string[]
  resourceIds: string[]
  contentIds: string[]
}): Promise<unknown> {
  if (input.run.phase !== 'ACCEPTANCE' || !allTasksComplete(input.run))
    throw new Error('acceptance requires completed implementation')
  if (input.run.activeDispatch?.status === 'running') return input.run.activeDispatch
  return input.dispatcher.dispatch({ runId: input.run.runId, ownerId: input.run.ownerId,
    projectId: input.run.projectId, workspacePath: input.workspacePath,
    workerType: 'acceptance-validator', phase: 'ACCEPTANCE',
    revision: currentImplementationRevision(input.run), allowedPaths: [],
    contract: { taskIds: input.run.tasks.map(task => task.id), checklistIds: input.checklistIds,
      resourceIds: input.resourceIds, contentIds: input.contentIds } })
}

export async function confirmAcceptanceFromValidator(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'acceptance-validator' }>
}): Promise<DeliveryRun> {
  const revision = currentImplementationRevision(input.run)
  if (input.run.phase !== 'ACCEPTANCE' || input.terminal.revision !== revision ||
      !isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath))
    throw new Error('independent acceptance evidence does not match the current run')
  const path = resolveWorkflowEvidencePath(input.workspacePath, input.terminal.evidencePath)!
  const recorded = JSON.parse(await readFile(path, 'utf8'))
  if (recorded.workerType !== 'acceptance-validator' || recorded.revision !== revision ||
      recorded.evidencePath !== input.terminal.evidencePath)
    throw new Error('independent acceptance evidence binding changed')
  const report = recorded.runtimeAcceptance as RuntimeAcceptance | undefined
  if (!report) throw new Error('independent acceptance report is missing')
  const implementation = await confirmAcceptanceFromImplementation({ run: input.run, workspacePath: input.workspacePath })
  const current = await runtimeEvidenceIsCurrent(input.workspacePath, [report])
  const status: EvidenceRef['status'] = implementation.evidence.acceptance?.status !== 'passed'
    ? 'blocked' : report.status === 'failed' ? 'failed'
      : report.status === 'passed' && current && !report.verification?.knownIssues.length &&
        !report.verification?.unverified.length ? 'passed' : 'blocked'
  const evidence: EvidenceRef = { path: input.terminal.evidencePath, kind: 'acceptance', revision,
    status, observedAt: new Date().toISOString() }
  const next = transitionDeliveryRun(input.run, { type: status === 'passed' ? 'acceptance_passed'
    : status === 'failed' ? 'acceptance_failed' : 'acceptance_blocked', evidence })
  return status === 'passed' ? next : { ...next, blockedReason: report.summary }
}

/**
 * Acceptance is a host confirmation of the implementation turn's current
 * evidence, not a second default model audit. The implementation Agent owns
 * the normal run/inspect/fix loop; this receipt only proves which artifacts
 * and revision were handed to delivery.
 */
export async function confirmAcceptanceFromImplementation(input: {
  run: DeliveryRun
  workspacePath: string
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'ACCEPTANCE')
    throw new Error('acceptance requires ACCEPTANCE phase')
  const revision = currentImplementationRevision(input.run)
  if (!allTasksComplete(input.run))
    throw new Error('acceptance requires completed implementation evidence')
  const taskEvidence = input.run.tasks.flatMap(task => {
    if (task.completedRevision !== revision)
      throw new Error('implementation evidence revision is stale')
    return task.evidenceRefs
  })
  if (!taskEvidence.length || taskEvidence.some(
    path => !isWorkflowEvidenceFile(input.workspacePath, path),
  ))
    throw new Error('acceptance requires implementation evidence in the workspace')
  const runtimeReports: RuntimeAcceptance[] = []
  for (const path of taskEvidence) {
    const evidenceFile = resolveWorkflowEvidencePath(input.workspacePath, path)!
    const recorded = JSON.parse(await readFile(evidenceFile, 'utf8'))
    if (recorded.revision !== revision) throw new Error('implementation evidence contents reference a different revision')
    // Persisted evidence is immutable here. A later Agent report cannot
    // silently reinterpret an old status based on its English summary text.
    if (recorded.runtimeAcceptance) runtimeReports.push(recorded.runtimeAcceptance)
  }

  let status: EvidenceRef['status'] = 'ready'
  if (runtimeReports.some(report => report.status === 'failed')) status = 'failed'
  else if (runtimeReports.some(report => report.status === 'blocked')) status = 'blocked'
  else if (runtimeReports.length === taskEvidence.length)
    status = await runtimeEvidenceIsCurrent(input.workspacePath, runtimeReports) ? 'passed' : 'blocked'

  const evidencePath = `.beegame/delivery/evidence/acceptance-host-${revision}.json`
  const target = resolveWorkflowEvidencePath(input.workspacePath, evidencePath)
  if (!target) throw new Error('acceptance evidence path is invalid')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify({
    version: 1,
    kind: 'host-delivery-confirmation',
    scope: status === 'ready' ? 'artifact-handoff' : 'agent-runtime-verification',
    runtimeVerification: status === 'ready' ? 'not-assessed-by-host' : 'agent-reported',
    status,
    runtimeReports,
    revision,
    implementationEvidence: taskEvidence,
    note: status === 'ready'
      ? 'This receipt confirms artifact handoff only; runtime acceptance has not been established.'
      : 'The Agent owns this runtime conclusion. The host binds its saved observations to the implementation revision and verifies evidence files, not their semantic quality.',
  }, null, 2)}\n`, 'utf8')
  const evidence: EvidenceRef = {
    path: evidencePath,
    kind: 'acceptance',
    revision,
    status,
    observedAt: new Date().toISOString(),
  }
  const next = transitionDeliveryRun(input.run, {
    type: status === 'ready' ? 'artifact_handoff_ready' : status === 'passed' ? 'acceptance_passed' : status === 'failed' ? 'acceptance_failed' : 'acceptance_blocked', evidence,
  })
  return status === 'failed' || status === 'blocked'
    ? { ...next, blockedReason: runtimeReports.filter(report => report.status !== 'passed').map(report => report.summary).join('; ') || 'Runtime evidence is missing or changed after verification.' }
    : next
}
