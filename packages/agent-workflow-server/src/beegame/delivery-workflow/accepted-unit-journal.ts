import type {
  AcceptedWorkflowUnit,
  DeliveryRun,
  DocumentReviewCheckId,
} from './types'

const CHECKLIST_PATH = 'docs/acceptance/gameplay-checklist.md'

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

function approvalIdentity(
  approval: DeliveryRun['documentReviewState']['checklistApproval'],
): string | undefined {
  if (!approval) return undefined
  return stableValue({
    scope: approval.scope,
    revision: approval.revision,
    evidencePath: approval.evidencePath,
    checks: approval.checks,
    checkEvidenceDigests: approval.checkEvidenceDigests,
  })
}

function unit(
  value: Omit<AcceptedWorkflowUnit, 'eventSchemaVersion'>,
): AcceptedWorkflowUnit {
  return { eventSchemaVersion: 1, ...value }
}

function priorDocumentUnitId(
  paths: readonly string[],
  index: number,
): string[] {
  return index > 0 ? [`document:${paths[index - 1]}`] : []
}

function reviewUnitId(id: DocumentReviewCheckId): string {
  return `review:${id}`
}

function priorApprovalCheckIds(
  previous: DeliveryRun,
): Set<DocumentReviewCheckId> {
  const accepted = new Set<DocumentReviewCheckId>()
  const approvals = [
    previous.documentReviewState.foundationApproval,
    previous.documentReviewState.checklistApproval,
    previous.documentReviewState.comprehensiveApproval,
  ] as const
  for (const approval of approvals)
    for (const check of approval?.checks ?? []) accepted.add(check.id)
  return accepted
}

function acceptedDispatchIdentity(input: {
  run: DeliveryRun
  workerType: 'document-author' | 'resource-content-author'
  taskId: string
}): { dispatchId: string; receiptRef: string } {
  const dispatch = input.run.activeDispatch
  const request = dispatch?.request
  const expectedPhase =
    input.workerType === 'document-author'
      ? 'DOCUMENT_DRAFTING'
      : 'RESOURCE_PREPARATION'
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
    input.workerType === 'document-author' &&
    (request.contract.authoringMode !== 'initial' ||
      request.contract.foundationDocumentPath !== input.taskId ||
      request.allowedPaths?.length !== 1 ||
      request.allowedPaths[0] !== input.taskId)
  )
    throw new Error(
      'accepted document unit contradicts its completed dispatch contract',
    )
  if (
    input.workerType === 'resource-content-author' &&
    request.contract.task !== 'RESOURCE_CONTENT'
  )
    throw new Error(
      'accepted Resource Content unit contradicts its completed dispatch contract',
    )
  const directory =
    input.workerType === 'document-author'
      ? 'document-commits'
      : 'resource-content-commits'
  return {
    dispatchId: dispatch.dispatchId,
    receiptRef: `.beegame/workflow/${directory}/${dispatch.dispatchId}.json`,
  }
}

function acceptedReviewUnits(
  previous: DeliveryRun,
  next: DeliveryRun,
): AcceptedWorkflowUnit[] {
  const before = previous.documentReviewState.activeCycle
  const after = next.documentReviewState.activeCycle
  const approval = [
    [
      previous.documentReviewState.foundationApproval,
      next.documentReviewState.foundationApproval,
    ],
    [
      previous.documentReviewState.checklistApproval,
      next.documentReviewState.checklistApproval,
    ],
    [
      previous.documentReviewState.comprehensiveApproval,
      next.documentReviewState.comprehensiveApproval,
    ],
  ].find(
    ([previousApproval, nextApproval]) =>
      approvalIdentity(previousApproval) !== approvalIdentity(nextApproval),
  )?.[1]
  const completedCheckIds =
    after?.completedCheckIds ?? approval?.checks.map(check => check.id)
  const sourceRevision = after?.sourceRevision ?? approval?.revision
  if (!completedCheckIds || !sourceRevision) return []
  const completedBefore = new Set<DocumentReviewCheckId>([
    ...(before?.completedCheckIds ?? []),
    ...priorApprovalCheckIds(previous),
  ])
  const checks = new Map(
    (after?.checks ?? approval?.checks ?? []).map(check => [check.id, check]),
  )
  const findingsByCheckId = new Map<DocumentReviewCheckId, unknown[]>(
    completedCheckIds.map(id => [id, []]),
  )
  for (const finding of after?.findings ?? [])
    findingsByCheckId.get(finding.checkId)?.push(finding)

  return completedCheckIds
    .filter(id => !completedBefore.has(id))
    .map(id => {
      const check = checks.get(id)
      if (!check) return undefined
      const priorCompleted = completedCheckIds.indexOf(id)
      const predecessor =
        priorCompleted > 0
          ? [reviewUnitId(completedCheckIds[priorCompleted - 1])]
          : []
      const dependencyDigests =
        after?.checkEvidenceDigests[id] ??
        approval?.checkEvidenceDigests[id] ??
        {}
      return unit({
        unitId: reviewUnitId(id),
        kind: 'review-check',
        phase: next.phase,
        predecessorUnitIds: predecessor,
        inputRevision: sourceRevision,
        dependencyDigests,
        acceptedAt: next.updatedAt,
        payload: {
          check,
          findings: findingsByCheckId.get(id) ?? [],
          dependencyDigests: { [id]: dependencyDigests },
        },
      })
    })
    .filter((candidate): candidate is AcceptedWorkflowUnit =>
      Boolean(candidate),
    )
}

function acceptedChecklistUnit(
  previous: DeliveryRun,
  next: DeliveryRun,
): AcceptedWorkflowUnit[] {
  const before = previous.documentReviewState.checklistApproval
  const approval = next.documentReviewState.checklistApproval
  if (!approval || approvalIdentity(before) === approvalIdentity(approval))
    return []
  const dependencyDigests =
    approval.checkEvidenceDigests.checklist_traceability ?? {}
  return [
    unit({
      unitId: `checklist:${CHECKLIST_PATH}`,
      kind: 'checklist',
      phase: next.phase,
      predecessorUnitIds: ['review:checklist_traceability'],
      inputRevision: approval.revision,
      dependencyDigests,
      receiptRef: approval.evidencePath,
      acceptedAt: approval.approvedAt,
      payload: {
        revision: approval.revision,
        evidencePath: approval.evidencePath,
        checkIds: approval.checks.map(check => check.id),
      },
    }),
  ]
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
        predecessorUnitIds: [`checklist:${CHECKLIST_PATH}`],
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
  const previousDocuments = previous.foundationDraftState.completedPaths
  const acceptedDocuments = next.foundationDraftState.completedPaths.slice(
    previousDocuments.length,
  )
  if (acceptedDocuments.length > 1)
    throw new Error(
      'accepted document transition contains more than one dispatch-backed unit',
    )
  for (const path of acceptedDocuments) {
    const index = next.foundationDraftState.completedPaths.indexOf(path)
    const identity = acceptedDispatchIdentity({
      run: previous,
      workerType: 'document-author',
      taskId: path,
    })
    units.push(
      unit({
        unitId: `document:${path}`,
        kind: 'document',
        phase: next.phase,
        predecessorUnitIds: priorDocumentUnitId(
          next.foundationDraftState.completedPaths,
          index,
        ),
        inputRevision: next.revision.document,
        dependencyDigests: {},
        ...identity,
        acceptedAt: next.updatedAt,
        payload: { path, revision: next.revision.document },
      }),
    )
  }
  units.push(...acceptedReviewUnits(previous, next))
  units.push(...acceptedChecklistUnit(previous, next))
  units.push(...acceptedResourceUnits(previous, next))

  if (previous.tasks.length === 0 && next.tasks.length > 0)
    units.push(
      unit({
        unitId: 'plan:atomic',
        kind: 'atomic-plan',
        phase: next.phase,
        predecessorUnitIds: ['review:resource_content_consistency'],
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
