import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile, resolveWorkflowEvidencePath } from './evidence'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DeliveryRun, EvidenceRef } from './types'

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

  const evidencePath = `.beegame/workflow/evidence/acceptance-host-${revision}.json`
  const target = resolveWorkflowEvidencePath(input.workspacePath, evidencePath)
  if (!target) throw new Error('acceptance evidence path is invalid')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify({
    version: 1,
    kind: 'host-delivery-confirmation',
    revision,
    implementationEvidence: taskEvidence,
    note: 'The implementation Agent performed the runtime inspection. This receipt confirms artifact identity and does not replace its observations.',
  }, null, 2)}\n`, 'utf8')
  const evidence: EvidenceRef = {
    path: evidencePath,
    kind: 'acceptance',
    revision,
    status: 'passed',
    observedAt: new Date().toISOString(),
  }
  return transitionDeliveryRun(input.run, { type: 'acceptance_passed', evidence })
}
