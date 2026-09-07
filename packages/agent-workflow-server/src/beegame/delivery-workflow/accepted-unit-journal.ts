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

function acceptedDispatchIdentity(input: {
  run: DeliveryRun
  workerType: 'resource-content-author'
  taskId: string
}): { dispatchId: string; receiptRef: string } {
  const dispatch = input.run.activeDispatch
  const request = dispatch?.request
  const expectedPhase = 'RESOURCE_PREPARATION'
  const allowedDispatchCharacters = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(
      '',
    ),
  )
  if (
    !dispatch ||
    !request ||
    dispatch.workerType !== input.workerType ||
    dispatch.phase !== expectedPhase ||
    dispatch.status !== 'completed' ||
    !dispatch.dispatchId ||
    [...dispatch.dispatchId].some(
      character => !allowedDispatchCharacters.has(character),
    ) ||
    dispatch.taskId !== input.taskId ||
    request.dispatchId !== dispatch.dispatchId ||
    request.runId !== input.run.runId ||
    request.ownerId !== input.run.ownerId ||
    request.projectId !== input.run.projectId ||
    request.workerType !== input.workerType ||
    request.phase !== expectedPhase ||
    request.taskId !== input.taskId ||
    request.revision !== dispatch.revision
  )
    throw new Error(
      `accepted ${input.workerType} unit has no matching completed dispatch`,
    )
  if (
    input.workerType === 'resource-content-author' &&
    request.contract.task !== 'RESOURCE_CONTENT'
  )
    throw new Error(
      'accepted Resource Content unit contradicts its completed dispatch contract',
    )
  const directory = 'resource-content-commits'
  return {
    dispatchId: dispatch.dispatchId,
    receiptRef: `.beegame/workflow/${directory}/${dispatch.dispatchId}.json`,
  }
}

function acceptedResourceUnits(
  previous: DeliveryRun,
  next: DeliveryRun,
): AcceptedWorkflowUnit[] {
  const units: AcceptedWorkflowUnit[] = []
  const before = previous.resourceProductionState
  const after = next.resourceProductionState
  if (
    after.inventoryReceipt &&
    after.inventoryReceipt.revision !== before.inventoryReceipt?.revision
  )
    units.push(
      unit({
        unitId: 'resource:inventory',
        kind: 'resource-inventory',
        phase: next.phase,
        predecessorUnitIds: [],
        inputRevision: after.inventoryReceipt.revision,
        dependencyDigests: {},
        acceptedAt: after.inventoryReceipt.acceptedAt,
        payload: {
          bindings: after.inventoryReceipt.bindings,
          catalogObserved: after.inventoryReceipt.catalogObserved,
        },
      }),
    )
  if (
    before.currentTask === 'RESOURCE_CONTENT' &&
    after.currentTask === 'RESOURCE_GATE' &&
    after.contentReceipt &&
    after.contentReceipt.contentDigest !== before.contentReceipt?.contentDigest
  ) {
    const identity = acceptedDispatchIdentity({
      run: previous,
      workerType: 'resource-content-author',
      taskId: 'RESOURCE_CONTENT',
    })
    units.push(
      unit({
        unitId: 'resource:content',
        kind: 'resource-content',
        phase: next.phase,
        predecessorUnitIds: ['resource:inventory'],
        inputRevision: after.contentReceipt.contentDigest,
        dependencyDigests: { content: after.contentReceipt.contentDigest },
        ...identity,
        acceptedAt: after.contentReceipt.acceptedAt,
        payload: { contentDigest: after.contentReceipt.contentDigest },
      }),
    )
  }
  const gate = next.evidence.resourcePreparation
  if (
    gate?.status === 'passed' &&
    previous.evidence.resourcePreparation?.revision !== gate.revision
  )
    units.push(
      unit({
        unitId: 'resource:gate',
        kind: 'resource-gate',
        phase: next.phase,
        predecessorUnitIds: ['resource:content'],
        inputRevision: gate.revision,
        dependencyDigests: {},
        receiptRef: gate.path,
        acceptedAt: gate.observedAt,
        payload: { receiptRef: gate.path },
      }),
    )
  return units
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

  if (previous.tasks.length === 0 && next.tasks.length > 0)
    units.push(
      unit({
        unitId: 'plan:atomic',
        kind: 'atomic-plan',
        phase: next.phase,
        predecessorUnitIds: ['resource:gate'],
        inputRevision: next.revision.resource ?? next.revision.document,
        dependencyDigests: {},
        acceptedAt: next.updatedAt,
        payload: { taskIds: next.tasks.map(task => task.id) },
      }),
    )

  for (const task of next.tasks) {
    const prior = previous.tasks.find(candidate => candidate.id === task.id)
    if (task.status !== 'completed' || prior?.status === 'completed') continue
    units.push(
      unit({
        unitId: `implementation:${task.id}`,
        kind: 'implementation-task',
        phase: next.phase,
        predecessorUnitIds: task.dependsOn.map(id => `implementation:${id}`),
        inputRevision: task.completedRevision ?? next.revision.workspace,
        dependencyDigests: {},
        receiptRef: task.evidenceRefs[0],
        acceptedAt: next.updatedAt,
        payload: { taskId: task.id, evidenceRefs: task.evidenceRefs },
      }),
    )
  }

  const audit = next.evidence.implementationAudit
  if (
    audit?.status === 'passed' &&
    previous.evidence.implementationAudit?.revision !== audit.revision
  )
    units.push(
      unit({
        unitId: 'audit:implementation',
        kind: 'implementation-audit',
        phase: next.phase,
        predecessorUnitIds: next.tasks.map(task => `implementation:${task.id}`),
        inputRevision: audit.revision,
        dependencyDigests: {},
        receiptRef: audit.path,
        acceptedAt: audit.observedAt,
        payload: { receiptRef: audit.path },
      }),
    )

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
        predecessorUnitIds: ['audit:implementation'],
        inputRevision: acceptance.revision,
        dependencyDigests: {},
        receiptRef: acceptance.path,
        acceptedAt: acceptance.observedAt,
        payload: { receiptRef: acceptance.path },
      }),
    )
  return units
}
