import type { AcceptedWorkflowUnit, DeliveryRun } from './types'
import { RETIRED_FOUNDATION_AUTHOR } from './retired-foundation-author'

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (!value || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null'
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableValue(record[key])}`)
    .join(',')}}`
}

function unit(
  value: Omit<AcceptedWorkflowUnit, 'eventSchemaVersion'>,
): AcceptedWorkflowUnit {
  return { eventSchemaVersion: 1, ...value }
}

function acceptedResourceUnits(
  previous: DeliveryRun,
  next: DeliveryRun,
): AcceptedWorkflowUnit[] {
  const after = next.resourceProductionState
  const irDependency: Record<string, string> = after.irResultId ? { gameIr: after.irResultId } : {}
  const gate = next.evidence.resourcePreparation
  if (
    gate?.status === 'passed' &&
    previous.evidence.resourcePreparation?.revision !== gate.revision
  )
    return [
      unit({
        unitId: 'resource:delivery',
        kind: 'resource-delivery',
        phase: next.phase,
        predecessorUnitIds: [],
        inputRevision: gate.revision,
        dependencyDigests: after.deliveryReceipt
          ? { ...irDependency, content: after.deliveryReceipt.contentDigest }
          : irDependency,
        receiptRef: gate.path,
        acceptedAt: gate.observedAt,
        payload: {
          receiptRef: gate.path,
          bindings: after.deliveryReceipt?.bindings ?? [],
          catalogObserved: after.deliveryReceipt?.catalogObserved ?? false,
        },
      }),
    ]
  return []
}

export function deriveAcceptedWorkflowUnits(
  previous: DeliveryRun,
  next: DeliveryRun,
): AcceptedWorkflowUnit[] {
  const units: AcceptedWorkflowUnit[] = []
  if (next.phase === 'DOCUMENT_DRAFTING' &&
    stableValue(previous.foundationDraftState) !== stableValue(next.foundationDraftState))
    throw new Error(RETIRED_FOUNDATION_AUTHOR)
  units.push(...acceptedResourceUnits(previous, next))
  const irDependency: Record<string, string> = next.resourceProductionState.irResultId
    ? { gameIr: next.resourceProductionState.irResultId } : {}

  for (const task of next.tasks) {
    const prior = previous.tasks.find(candidate => candidate.id === task.id)
    if (task.status !== 'completed' || prior?.status === 'completed') continue
    const predecessorUnitIds = ['resource:delivery']
    units.push(
      unit({
        unitId: `implementation:${task.id}`,
        kind: 'implementation-task',
        phase: next.phase,
        predecessorUnitIds,
        inputRevision: task.completedRevision ?? next.revision.workspace,
        dependencyDigests: irDependency,
        receiptRef: task.evidenceRefs[0],
        acceptedAt: next.updatedAt,
        payload: { taskId: task.id, evidenceRefs: task.evidenceRefs },
      }),
    )
  }

  const acceptance = next.evidence.acceptance
  if (
    acceptance?.status === 'passed' &&
    previous.evidence.acceptance?.revision !== acceptance.revision
  )
    units.push(
      unit({
        unitId: 'acceptance:delivery',
        kind: 'acceptance',
        phase: next.phase,
        predecessorUnitIds: next.tasks.map(task => `implementation:${task.id}`),
        inputRevision: acceptance.revision,
        dependencyDigests: irDependency,
        receiptRef: acceptance.path,
        acceptedAt: acceptance.observedAt,
        payload: { receiptRef: acceptance.path },
      }),
    )
  return units
}
