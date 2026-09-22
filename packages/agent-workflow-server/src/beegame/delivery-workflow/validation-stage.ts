import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile, resolveWorkflowEvidencePath } from './evidence'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DeliveryRun, EvidenceRef } from './types'
import { readRuntimeAcceptance, runtimeEvidenceIsCurrent, type RuntimeAcceptance } from './runtime-acceptance'

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
    // Only retry a failed parse. Never re-baseline successfully captured hashes:
    // a changed build still requires fresh Agent verification, not another click.
    const previous = recorded.runtimeAcceptance as RuntimeAcceptance | undefined
    const dispatchId = /^\.beegame\/workflow\/evidence\/implementation-([\w-]+)\.json$/.exec(path)?.[1]
    if (dispatchId && previous?.status === 'blocked' && previous.environment === 'not-established' &&
        previous.summary.startsWith('Invalid runtime acceptance record:')) {
      const refreshed = await readRuntimeAcceptance(input.workspacePath, dispatchId)
      if (refreshed) {
        recorded.runtimeAcceptance = refreshed
        await writeFile(evidenceFile, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8')
      }
    }
    // Older host versions replaced an agent pass solely because a limitation
    // list was nonempty. Re-evaluate that derived verdict, never its hash baseline.
    if (dispatchId && previous?.status === 'blocked' &&
        /^(Delivery has unresolved issues:|Delivery has unverified work:)/.test(previous.summary)) {
      const refreshed = await readRuntimeAcceptance(input.workspacePath, dispatchId)
      if (refreshed?.status === 'passed' &&
          previous.summary.endsWith(`\nAgent report: ${refreshed.summary}`) &&
          JSON.stringify(previous.verification) === JSON.stringify(refreshed.verification) &&
          JSON.stringify(previous.evidence) === JSON.stringify(refreshed.evidence) &&
          JSON.stringify(previous.artifacts) === JSON.stringify(refreshed.artifacts) &&
          await runtimeEvidenceIsCurrent(input.workspacePath, [{ ...previous, status: 'passed' }])) {
        recorded.runtimeAcceptance = { ...previous, status: 'passed', summary: refreshed.summary }
        await writeFile(evidenceFile, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8')
      }
    }
    if (recorded.runtimeAcceptance) runtimeReports.push(recorded.runtimeAcceptance)
  }

  let status: EvidenceRef['status'] = 'ready'
  if (runtimeReports.some(report => report.status === 'failed')) status = 'failed'
  else if (runtimeReports.some(report => report.status === 'blocked')) status = 'blocked'
  else if (runtimeReports.length === taskEvidence.length)
    status = await runtimeEvidenceIsCurrent(input.workspacePath, runtimeReports) ? 'passed' : 'blocked'

  const evidencePath = `.beegame/workflow/evidence/acceptance-host-${revision}.json`
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
