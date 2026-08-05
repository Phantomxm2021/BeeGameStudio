import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readCanonicalDocumentCommitReceipt } from '../native-canonical-document-tool'
import {
  artifactsForDocumentReviewCheck,
  documentReviewArtifactDigests,
  readDocumentReviewArtifacts,
} from './document-review-input'
import { INITIAL_FOUNDATION_UPSTREAM_PATHS } from './document-repair-graph'
import {
  computeDocumentRevision,
  computeResourceContentDigest,
  computeResourceInventoryRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
  resolveWorkspaceRelativePath,
} from './revision'
import {
  acceptedWorkflowUnitSchema,
  parseAtomicTask,
  parseDeliveryRun,
  workflowUnitAcceptedEventSchema,
} from './schema'
import {
  createInitialDeliveryRun,
  inspectWorkflowSnapshot,
  WorkflowStoreError,
  type WorkflowSnapshotInspection,
} from './run-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS,
  COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type AcceptedWorkflowUnit,
  type AtomicTask,
  type DeliveryRun,
  type DocumentReviewApproval,
  type DocumentReviewCheck,
  type DocumentReviewCheckId,
  type DocumentReviewFinding,
  type DocumentReviewScope,
  type Revision,
  type WorkflowEvent,
  type WorkflowUnitAcceptedEvent,
  type WorkflowUsage,
} from './types'

export { inspectWorkflowSnapshot }
export type { WorkflowSnapshotInspection }

const CHECKLIST_UNIT_ID =
  'checklist:docs/acceptance/gameplay-checklist.md' as const
const RESOURCE_INVENTORY_UNIT_ID = 'resource:inventory' as const
const RESOURCE_CONTENT_UNIT_ID = 'resource:content' as const
const RESOURCE_GATE_UNIT_ID = 'resource:gate' as const
const ATOMIC_PLAN_UNIT_ID = 'plan:atomic' as const
const IMPLEMENTATION_AUDIT_UNIT_ID = 'audit:implementation' as const
const ACCEPTANCE_UNIT_ID = 'acceptance:delivery' as const

type RecoveryErrorCode =
  | 'recovery_checkpoint_missing'
  | 'recovery_checkpoint_conflict'
  | 'recovery_artifact_digest_mismatch'
  | 'recovery_snapshot_changed'

type ProvenUnit = {
  unit: AcceptedWorkflowUnit
  source: 'journal' | 'snapshot'
}

type RecoveryJournalMetadata = {
  runId?: string
  createdAt?: string
  usage?: WorkflowUsage
}

function recoveryError(code: RecoveryErrorCode, message: string): never {
  throw new WorkflowStoreError(message, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some(item => !stringValue(item)))
    return undefined
  return value as string[]
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`)
    .join(',')}}`
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function reviewUnitId(checkId: DocumentReviewCheckId): string {
  return `review:${checkId}`
}

function documentUnitId(path: string): string {
  return `document:${path}`
}

const FOUNDATION_REVIEW_UNIT_IDS =
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.map(reviewUnitId)
const COMPREHENSIVE_ADDITIONAL_UNIT_IDS =
  COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS.map(reviewUnitId)
const CURRENT_REVIEW_UNIT_IDS = new Set([
  ...FOUNDATION_REVIEW_UNIT_IDS,
  ...CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS.map(reviewUnitId),
  ...COMPREHENSIVE_ADDITIONAL_UNIT_IDS,
])
const CURRENT_REVIEW_CHECK_IDS = new Set<DocumentReviewCheckId>([
  ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  ...CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS,
  ...COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS,
])

function fixedUnitIds(): string[] {
  return [
    ...CANONICAL_FOUNDATION_DOCUMENTS.map(documentUnitId),
    ...FOUNDATION_REVIEW_UNIT_IDS,
    ...CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS.map(reviewUnitId),
    CHECKLIST_UNIT_ID,
    RESOURCE_INVENTORY_UNIT_ID,
    RESOURCE_CONTENT_UNIT_ID,
    RESOURCE_GATE_UNIT_ID,
    ...COMPREHENSIVE_ADDITIONAL_UNIT_IDS,
    ATOMIC_PLAN_UNIT_ID,
  ]
}

function expectedFixedPredecessors(unitId: string): string[] | undefined {
  const documentIndex = CANONICAL_FOUNDATION_DOCUMENTS.findIndex(
    path => documentUnitId(path) === unitId,
  )
  if (documentIndex >= 0)
    return documentIndex === 0
      ? []
      : [documentUnitId(CANONICAL_FOUNDATION_DOCUMENTS[documentIndex - 1]!)]
  const foundationIndex = FOUNDATION_REVIEW_UNIT_IDS.indexOf(unitId)
  if (foundationIndex >= 0)
    return foundationIndex === 0
      ? []
      : [FOUNDATION_REVIEW_UNIT_IDS[foundationIndex - 1]!]
  if (unitId === reviewUnitId('checklist_traceability')) return []
  if (unitId === CHECKLIST_UNIT_ID)
    return [reviewUnitId('checklist_traceability')]
  if (unitId === RESOURCE_INVENTORY_UNIT_ID) return [CHECKLIST_UNIT_ID]
  if (unitId === RESOURCE_CONTENT_UNIT_ID) return [RESOURCE_INVENTORY_UNIT_ID]
  if (unitId === RESOURCE_GATE_UNIT_ID) return [RESOURCE_CONTENT_UNIT_ID]
  const comprehensiveIndex = COMPREHENSIVE_ADDITIONAL_UNIT_IDS.indexOf(unitId)
  if (comprehensiveIndex >= 0)
    return comprehensiveIndex === 0
      ? [FOUNDATION_REVIEW_UNIT_IDS.at(-1)!]
      : [COMPREHENSIVE_ADDITIONAL_UNIT_IDS[comprehensiveIndex - 1]!]
  if (unitId === ATOMIC_PLAN_UNIT_ID)
    return [COMPREHENSIVE_ADDITIONAL_UNIT_IDS.at(-1)!]
  return undefined
}

function expectedKind(
  unitId: string,
): AcceptedWorkflowUnit['kind'] | undefined {
  if (
    CANONICAL_FOUNDATION_DOCUMENTS.some(path => documentUnitId(path) === unitId)
  )
    return 'document'
  if (CURRENT_REVIEW_UNIT_IDS.has(unitId)) return 'review-check'
  if (unitId === CHECKLIST_UNIT_ID) return 'checklist'
  if (unitId === RESOURCE_INVENTORY_UNIT_ID) return 'resource-inventory'
  if (unitId === RESOURCE_CONTENT_UNIT_ID) return 'resource-content'
  if (unitId === RESOURCE_GATE_UNIT_ID) return 'resource-gate'
  if (unitId === ATOMIC_PLAN_UNIT_ID) return 'atomic-plan'
  if (unitId === IMPLEMENTATION_AUDIT_UNIT_ID) return 'implementation-audit'
  if (unitId === ACCEPTANCE_UNIT_ID) return 'acceptance'
  return undefined
}

function acceptedUnitPayload(unit: AcceptedWorkflowUnit) {
  const payload = record(unit.payload)
  if (!payload)
    recoveryError(
      'recovery_checkpoint_conflict',
      `accepted unit ${unit.unitId} has no current payload`,
    )
  return payload
}

function reviewCheckFromUnit(unit: AcceptedWorkflowUnit): DocumentReviewCheck {
  return acceptedUnitPayload(unit).check as DocumentReviewCheck
}

function reviewFindingsFromUnit(
  unit: AcceptedWorkflowUnit,
): DocumentReviewFinding[] {
  return acceptedUnitPayload(unit).findings as DocumentReviewFinding[]
}

function assertUnitPayloadIdentity(unit: AcceptedWorkflowUnit): void {
  const payload = acceptedUnitPayload(unit)
  if (unit.kind === 'document') {
    if (
      documentUnitId(stringValue(payload.path) ?? '') !== unit.unitId ||
      payload.revision !== unit.inputRevision
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        `document checkpoint ${unit.unitId} has contradictory identity`,
      )
  } else if (unit.kind === 'review-check') {
    const check = record(payload.check)
    const checkId = check?.id as DocumentReviewCheckId
    if (reviewUnitId(checkId) !== unit.unitId)
      recoveryError(
        'recovery_checkpoint_conflict',
        `review checkpoint ${unit.unitId} has contradictory identity`,
      )
    if (
      stableValue(payload.dependencyDigests) !==
      stableValue({ [checkId]: unit.dependencyDigests })
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        `review checkpoint ${unit.unitId} has contradictory dependency digests`,
      )
  } else if (unit.kind === 'checklist') {
    if (
      unit.unitId !== CHECKLIST_UNIT_ID ||
      payload.revision !== unit.inputRevision
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        'Checklist checkpoint has contradictory revision identity',
      )
  } else if (unit.kind === 'resource-content') {
    if (
      payload.contentDigest !== unit.inputRevision ||
      unit.dependencyDigests.content !== payload.contentDigest
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        'Resource Content checkpoint has contradictory canonical digest',
      )
  } else if (unit.kind === 'implementation-task') {
    if (`implementation:${stringValue(payload.taskId) ?? ''}` !== unit.unitId)
      recoveryError(
        'recovery_checkpoint_conflict',
        `implementation checkpoint ${unit.unitId} has contradictory task identity`,
      )
  }
}

function parseAcceptedEvents(input: {
  events: WorkflowEvent[]
  ownerId: string
  projectId: string
  snapshotRunId?: string
}): WorkflowUnitAcceptedEvent[] {
  const accepted: WorkflowUnitAcceptedEvent[] = []
  const eventIds = new Set<string>()
  const unitIds = new Set<string>()
  let runId = input.snapshotRunId
  for (const event of input.events) {
    if (event.type !== 'workflow.unit.accepted') continue
    const parsed = workflowUnitAcceptedEventSchema.safeParse(event)
    if (!parsed.success)
      recoveryError(
        'recovery_checkpoint_conflict',
        `accepted-unit journal contains an event outside the current schema: ${parsed.error.message}`,
      )
    const record = parsed.data
    if (
      record.ownerId !== input.ownerId ||
      record.projectId !== input.projectId
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        'accepted-unit journal identity does not match the owned project',
      )
    if (runId && record.runId !== runId)
      recoveryError(
        'recovery_checkpoint_conflict',
        'accepted-unit journal contains more than one run identity',
      )
    runId = record.runId
    if (eventIds.has(record.eventId) || unitIds.has(record.unit.unitId))
      recoveryError(
        'recovery_checkpoint_conflict',
        `accepted-unit journal duplicates ${record.unit.unitId}`,
      )
    eventIds.add(record.eventId)
    unitIds.add(record.unit.unitId)
    assertUnitPayloadIdentity(record.unit)
    accepted.push(record)
  }
  return accepted
}

function workflowUsage(
  value: unknown,
  source: 'snapshot' | 'journal',
): WorkflowUsage | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const keys = [
    'input_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'completion_tokens',
    'total_tokens',
  ] as const
  if (
    keys.some(
      key =>
        typeof usage[key] !== 'number' ||
        !Number.isFinite(usage[key]) ||
        (usage[key] as number) < 0,
    )
  )
    recoveryError(
      'recovery_checkpoint_conflict',
      `${source} cumulative usage is outside the current schema`,
    )
  return Object.fromEntries(keys.map(key => [key, usage[key]])) as WorkflowUsage
}

function recoveryJournalMetadata(input: {
  events: WorkflowEvent[]
  expectedRunId?: string
}): RecoveryJournalMetadata {
  let runId = input.expectedRunId
  let createdAt: string | undefined
  let usage: WorkflowUsage | undefined
  for (const event of input.events) {
    if (event.type !== 'run.created' && event.type !== 'usage.updated') continue
    const eventRunId = stringValue(event.runId)
    const eventTimestamp = stringValue(event.createdAt)
    if (
      !eventRunId ||
      !eventTimestamp ||
      !Number.isFinite(Date.parse(eventTimestamp))
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        `${event.type} journal proof is outside the current schema`,
      )
    if (runId && eventRunId !== runId)
      recoveryError(
        'recovery_checkpoint_conflict',
        `${event.type} journal proof contradicts the current run identity`,
      )
    runId = eventRunId
    if (event.type === 'run.created') {
      if (createdAt)
        recoveryError(
          'recovery_checkpoint_conflict',
          'accepted-unit ledger contains duplicate run.created proofs',
        )
      createdAt = eventTimestamp
      continue
    }
    const currentUsage = workflowUsage(event.usage, 'journal')
    if (!currentUsage)
      recoveryError(
        'recovery_checkpoint_conflict',
        'usage.updated journal proof has no cumulative usage',
      )
    usage = currentUsage
  }
  return { runId, createdAt, usage }
}

function rawSnapshotRecord(
  inspection: WorkflowSnapshotInspection,
): Record<string, unknown> | undefined {
  return record(inspection.parsedValue)
}

function assertSnapshotIdentity(input: {
  snapshot?: Record<string, unknown>
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): string | undefined {
  const snapshot = input.snapshot
  if (!snapshot) return undefined
  const ownerId = stringValue(snapshot.ownerId)
  const projectId = stringValue(snapshot.projectId)
  if (
    (ownerId && ownerId !== input.ownerId) ||
    (projectId && projectId !== input.projectId)
  )
    recoveryError(
      'recovery_checkpoint_conflict',
      'snapshot identity does not match the owned project',
    )
  const context = stringValue(snapshot.confirmedBriefContext)
  const contextDigest = stringValue(snapshot.confirmedBriefDigest)
  const expectedDigest = sha256(input.confirmedBriefContext)
  if (
    (context && context !== input.confirmedBriefContext) ||
    (contextDigest && contextDigest !== expectedDigest)
  )
    recoveryError(
      'recovery_checkpoint_conflict',
      'snapshot confirmed brief authority conflicts with recovery input',
    )
  return stringValue(snapshot.runId)
}

function checkpointComparable(unit: AcceptedWorkflowUnit): unknown {
  return {
    unitId: unit.unitId,
    kind: unit.kind,
    inputRevision: unit.inputRevision,
    dependencyDigests: unit.dependencyDigests,
    receiptRef: unit.receiptRef,
    payload: unit.payload,
  }
}

function addSnapshotProof(
  proofs: Map<string, ProvenUnit>,
  unit: AcceptedWorkflowUnit,
): void {
  const parsed = acceptedWorkflowUnitSchema.safeParse(unit)
  if (!parsed.success)
    recoveryError(
      'recovery_checkpoint_conflict',
      `snapshot checkpoint ${unit.unitId} does not satisfy the current schema`,
    )
  const existing = proofs.get(unit.unitId)
  if (existing) {
    if (
      stableValue(checkpointComparable(existing.unit)) !==
      stableValue(checkpointComparable(parsed.data))
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        `snapshot and journal contradict ${unit.unitId}`,
      )
    return
  }
  proofs.set(unit.unitId, { unit: parsed.data, source: 'snapshot' })
}

function snapshotTimestamp(snapshot: Record<string, unknown>): string {
  return (
    stringValue(snapshot.updatedAt) ??
    stringValue(snapshot.createdAt) ??
    new Date(0).toISOString()
  )
}

function historicalReviewFacts(input: {
  snapshot: Record<string, unknown>
  proofs: Map<string, ProvenUnit>
  revision: Revision
}): void {
  const state = record(input.snapshot.documentReviewState)
  if (!state) return
  const activeCycle = record(state.activeCycle)
  const approvals = [
    record(state.foundationApproval),
    record(state.checklistApproval),
    record(state.comprehensiveApproval),
  ].filter((value): value is Record<string, unknown> => Boolean(value))
  const completedIds = new Set<string>()
  for (const id of stringArray(activeCycle?.completedCheckIds) ?? [])
    completedIds.add(id)
  for (const approval of approvals)
    for (const check of Array.isArray(approval.checks) ? approval.checks : []) {
      const id = stringValue(record(check)?.id)
      if (id) completedIds.add(id)
    }
  for (const id of completedIds)
    if (!CURRENT_REVIEW_CHECK_IDS.has(id as DocumentReviewCheckId))
      recoveryError(
        'recovery_checkpoint_conflict',
        `snapshot contains unknown completed review unit ${id}`,
      )

  const checks = new Map<string, unknown>()
  const digests = new Map<string, Record<string, string>>()
  const acceptedAtById = new Map<string, string>()
  const findingsById = new Map<string, unknown[]>()
  if (activeCycle) {
    for (const check of Array.isArray(activeCycle.checks)
      ? activeCycle.checks
      : []) {
      const id = stringValue(record(check)?.id)
      if (id) checks.set(id, check)
    }
    const digestRecord = record(activeCycle.checkEvidenceDigests)
    for (const id of completedIds) {
      const value = record(digestRecord?.[id])
      if (value) digests.set(id, value as Record<string, string>)
    }
    for (const finding of Array.isArray(activeCycle.findings)
      ? activeCycle.findings
      : []) {
      const id = stringValue(record(finding)?.checkId)
      if (id) findingsById.set(id, [...(findingsById.get(id) ?? []), finding])
    }
  }
  for (const approval of approvals) {
    const acceptedAt =
      stringValue(approval.approvedAt) ?? snapshotTimestamp(input.snapshot)
    const digestRecord = record(approval.checkEvidenceDigests)
    for (const check of Array.isArray(approval.checks) ? approval.checks : []) {
      const id = stringValue(record(check)?.id)
      if (!id) continue
      if (!checks.has(id)) checks.set(id, check)
      const value = record(digestRecord?.[id])
      if (value && !digests.has(id))
        digests.set(id, value as Record<string, string>)
      acceptedAtById.set(id, acceptedAt)
    }
  }

  for (const id of completedIds) {
    const unitId = reviewUnitId(id as DocumentReviewCheckId)
    const check = checks.get(id)
    if (!check)
      recoveryError(
        'recovery_checkpoint_missing',
        `snapshot has no accepted terminal for ${unitId}`,
      )
    const dependencyDigests = digests.get(id) ?? {}
    const currentUnit = acceptedWorkflowUnitSchema.safeParse({
      eventSchemaVersion: 1,
      unitId,
      kind: 'review-check',
      phase: 'DOCUMENT_REVIEW',
      predecessorUnitIds: expectedFixedPredecessors(unitId) ?? [],
      inputRevision:
        id === 'checklist_traceability' ||
        FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.includes(id as never)
          ? input.revision.document
          : (input.revision.resource ?? input.revision.document),
      dependencyDigests,
      acceptedAt: acceptedAtById.get(id) ?? snapshotTimestamp(input.snapshot),
      payload: {
        check,
        findings: findingsById.get(id) ?? [],
        dependencyDigests: { [id]: dependencyDigests },
      },
    })
    if (!currentUnit.success)
      recoveryError(
        'recovery_checkpoint_conflict',
        `historical review checkpoint ${unitId} is invalid`,
      )
    addSnapshotProof(input.proofs, currentUnit.data)
  }
}

async function historicalDocumentFacts(input: {
  snapshot: Record<string, unknown>
  proofs: Map<string, ProvenUnit>
  workspacePath: string
  revision: Revision
}): Promise<void> {
  const completedPaths = stringArray(
    record(input.snapshot.foundationDraftState)?.completedPaths,
  )
  if (!completedPaths) return
  const expectedPrefix = CANONICAL_FOUNDATION_DOCUMENTS.slice(
    0,
    completedPaths.length,
  )
  if (!sameStrings(completedPaths, expectedPrefix))
    recoveryError(
      'recovery_checkpoint_conflict',
      'snapshot completed documents are outside the current canonical prefix',
    )
  const receiptDirectory = join(
    resolve(input.workspacePath),
    '.beegame',
    'workflow',
    'document-commits',
  )
  let receiptNames: string[] = []
  try {
    receiptNames = (await readdir(receiptDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      recoveryError(
        'recovery_checkpoint_conflict',
        'canonical document receipt directory cannot be inspected',
      )
  }
  const receipts = []
  for (const name of receiptNames) {
    const dispatchId = name.slice(0, -'.json'.length)
    try {
      const receipt = await readCanonicalDocumentCommitReceipt(
        input.workspacePath,
        dispatchId,
      )
      if (receipt) receipts.push(receipt)
    } catch {
      recoveryError(
        'recovery_checkpoint_conflict',
        'canonical document receipt is outside the current schema',
      )
    }
  }
  for (const [index, path] of completedPaths.entries()) {
    const unitId = documentUnitId(path)
    if (input.proofs.has(unitId)) continue
    let currentDigest: string
    try {
      currentDigest = sha256(
        await readFile(join(resolve(input.workspacePath), path)),
      )
    } catch {
      recoveryError(
        'recovery_artifact_digest_mismatch',
        `snapshot-completed document ${path} is unavailable`,
      )
    }
    const receiptsForPath = receipts.filter(
      receipt => receipt.targetPath === path,
    )
    if (receiptsForPath.length === 0)
      recoveryError(
        'recovery_checkpoint_missing',
        `snapshot-completed document ${path} has no canonical receipt`,
      )
    const matches = receiptsForPath
      .filter(receipt => receipt.finalDigest === currentDigest)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    const receipt = matches.at(-1)
    if (!receipt)
      recoveryError(
        'recovery_artifact_digest_mismatch',
        `snapshot-completed document ${path} contradicts its canonical receipt`,
      )
    addSnapshotProof(input.proofs, {
      eventSchemaVersion: 1,
      unitId,
      kind: 'document',
      phase: 'DOCUMENT_DRAFTING',
      predecessorUnitIds:
        index === 0 ? [] : [documentUnitId(completedPaths[index - 1]!)],
      inputRevision: input.revision.document,
      dependencyDigests: { [path]: receipt.finalDigest },
      receiptRef: `.beegame/workflow/document-commits/${receipt.dispatchId}.json`,
      acceptedAt: receipt.updatedAt,
      payload: { path, revision: input.revision.document },
    })
  }
}

function historicalResourceFacts(input: {
  snapshot: Record<string, unknown>
  proofs: Map<string, ProvenUnit>
  revision: Revision
}): void {
  const state = record(input.snapshot.resourceProductionState)
  const inventory = record(state?.inventoryReceipt)
  if (inventory) {
    const unit = {
      eventSchemaVersion: 1,
      unitId: RESOURCE_INVENTORY_UNIT_ID,
      kind: 'resource-inventory',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: [CHECKLIST_UNIT_ID],
      inputRevision: inventory.revision,
      dependencyDigests: {},
      acceptedAt: inventory.acceptedAt,
      payload: {
        bindings: inventory.bindings,
        catalogObserved: inventory.catalogObserved,
      },
    } as AcceptedWorkflowUnit
    addSnapshotProof(input.proofs, unit)
  }
  const content = record(state?.contentReceipt)
  const journalContent = input.proofs.get(RESOURCE_CONTENT_UNIT_ID)?.unit
  if (content && journalContent) {
    const payload = acceptedUnitPayload(journalContent)
    if (content.contentDigest !== payload.contentDigest)
      recoveryError(
        'recovery_checkpoint_conflict',
        'snapshot and journal contradict the canonical Resource Content digest',
      )
  } else if (content) {
    addSnapshotProof(input.proofs, {
      eventSchemaVersion: 1,
      unitId: RESOURCE_CONTENT_UNIT_ID,
      kind: 'resource-content',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: [RESOURCE_INVENTORY_UNIT_ID],
      inputRevision: content.contentDigest as string,
      dependencyDigests: { content: content.contentDigest as string },
      acceptedAt: content.acceptedAt as string,
      payload: { contentDigest: content.contentDigest },
    })
  }
  const evidence = record(record(input.snapshot.evidence)?.resourcePreparation)
  if (evidence?.status === 'passed') {
    const journalGate = input.proofs.get(RESOURCE_GATE_UNIT_ID)?.unit
    if (journalGate && evidence.revision !== journalGate.inputRevision)
      recoveryError(
        'recovery_checkpoint_conflict',
        'snapshot and journal contradict the Resource Gate revision',
      )
    if (!journalGate)
      addSnapshotProof(input.proofs, {
        eventSchemaVersion: 1,
        unitId: RESOURCE_GATE_UNIT_ID,
        kind: 'resource-gate',
        phase: 'DOCUMENT_REVIEW',
        predecessorUnitIds: [RESOURCE_CONTENT_UNIT_ID],
        inputRevision: evidence.revision as string,
        dependencyDigests: {},
        receiptRef: evidence.path as string,
        acceptedAt: evidence.observedAt as string,
        payload: { receiptRef: evidence.path },
      })
  }
}

function historicalChecklistFact(input: {
  snapshot: Record<string, unknown>
  proofs: Map<string, ProvenUnit>
}): void {
  if (input.proofs.has(CHECKLIST_UNIT_ID)) return
  const approval = record(
    record(input.snapshot.documentReviewState)?.checklistApproval,
  )
  if (!approval) return
  const reviewProof = input.proofs.get(reviewUnitId('checklist_traceability'))
  if (!reviewProof) return
  addSnapshotProof(input.proofs, {
    eventSchemaVersion: 1,
    unitId: CHECKLIST_UNIT_ID,
    kind: 'checklist',
    phase: 'DOCUMENT_REVIEW',
    predecessorUnitIds: [reviewUnitId('checklist_traceability')],
    inputRevision: approval.revision as string,
    dependencyDigests: reviewProof.unit.dependencyDigests,
    receiptRef: approval.evidencePath as string,
    acceptedAt: approval.approvedAt as string,
    payload: {
      revision: approval.revision,
      evidencePath: approval.evidencePath,
      checkIds: (approval.checks as Array<Record<string, unknown>>).map(
        check => check.id,
      ),
    },
  })
}

function reconcileSourceRevision(input: {
  label: 'document' | 'workspace'
  snapshot?: string
  journal?: string
  current: string
}): string {
  if (input.snapshot && input.journal && input.snapshot !== input.journal)
    recoveryError(
      'recovery_checkpoint_conflict',
      `snapshot and journal contradict the ${input.label} revision`,
    )
  const durable = input.snapshot ?? input.journal
  if (!durable)
    recoveryError(
      'recovery_checkpoint_missing',
      `recovery cannot prove the current ${input.label} revision`,
    )
  if (durable !== input.current)
    recoveryError(
      'recovery_artifact_digest_mismatch',
      `current ${input.label} revision contradicts durable recovery sources`,
    )
  return input.current
}

async function snapshotRevision(
  snapshot: Record<string, unknown> | undefined,
  accepted: WorkflowUnitAcceptedEvent[],
  workspacePath: string,
  confirmedBriefDigest: string,
): Promise<Revision> {
  const raw = record(snapshot?.revision)
  const rawDocument = stringValue(raw?.document)
  const rawWorkspace = stringValue(raw?.workspace)
  const latest = accepted.at(-1)?.revision
  const [currentDocument, currentWorkspace] = await Promise.all([
    computeDocumentRevision(workspacePath, confirmedBriefDigest),
    computeWorkspaceRevision(workspacePath),
  ])
  const document = reconcileSourceRevision({
    label: 'document',
    snapshot: rawDocument,
    journal: latest?.document,
    current: currentDocument,
  })
  const workspace = reconcileSourceRevision({
    label: 'workspace',
    snapshot: rawWorkspace,
    journal: latest?.workspace,
    current: currentWorkspace,
  })
  return {
    document,
    ...((stringValue(raw?.resource) ?? latest?.resource)
      ? { resource: stringValue(raw?.resource) ?? latest?.resource }
      : {}),
    ...((stringValue(raw?.implementation) ?? latest?.implementation)
      ? {
          implementation:
            stringValue(raw?.implementation) ?? latest?.implementation,
        }
      : {}),
    workspace,
  }
}

function planTaskIds(proofs: Map<string, ProvenUnit>): string[] | undefined {
  const plan = proofs.get(ATOMIC_PLAN_UNIT_ID)?.unit
  if (!plan) return undefined
  const taskIds = stringArray(acceptedUnitPayload(plan).taskIds)
  if (
    !taskIds ||
    taskIds.length === 0 ||
    new Set(taskIds).size !== taskIds.length
  )
    recoveryError(
      'recovery_checkpoint_conflict',
      'atomic plan checkpoint has an invalid task identity set',
    )
  return taskIds
}

function snapshotTasks(
  snapshot: Record<string, unknown> | undefined,
  taskIds: string[] | undefined,
): AtomicTask[] {
  if (!taskIds) return []
  if (!Array.isArray(snapshot?.tasks))
    recoveryError(
      'recovery_checkpoint_missing',
      'accepted atomic plan has no recoverable current task graph',
    )
  const tasks: AtomicTask[] = []
  for (const value of snapshot.tasks) {
    try {
      tasks.push(parseAtomicTask(value))
    } catch {
      recoveryError(
        'recovery_checkpoint_conflict',
        'snapshot atomic task graph is outside the current schema',
      )
    }
  }
  if (
    !sameStrings(
      tasks.map(task => task.id),
      taskIds,
    )
  )
    recoveryError(
      'recovery_checkpoint_conflict',
      'snapshot atomic task graph contradicts the accepted plan',
    )
  return tasks
}

function assertRawCompletedClaimsHaveAcceptedProof(input: {
  snapshot: Record<string, unknown> | undefined
  proofs: Map<string, ProvenUnit>
}): void {
  if (Array.isArray(input.snapshot?.tasks))
    for (const value of input.snapshot.tasks) {
      const rawTask = record(value)
      if (rawTask?.status !== 'completed') continue
      let task: AtomicTask
      try {
        task = parseAtomicTask(value)
      } catch {
        recoveryError(
          'recovery_checkpoint_conflict',
          'snapshot completed task is outside the current schema',
        )
      }
      if (!input.proofs.has(`implementation:${task.id}`))
        recoveryError(
          'recovery_checkpoint_missing',
          `snapshot-completed task ${task.id} has no accepted terminal`,
        )
    }

  const evidence = record(input.snapshot?.evidence)
  for (const claim of [
    {
      value: record(evidence?.implementationAudit),
      unitId: IMPLEMENTATION_AUDIT_UNIT_ID,
      label: 'Implementation Audit',
    },
    {
      value: record(evidence?.acceptance),
      unitId: ACCEPTANCE_UNIT_ID,
      label: 'Acceptance',
    },
  ])
    if (claim.value?.status === 'passed' && !input.proofs.has(claim.unitId))
      recoveryError(
        'recovery_checkpoint_missing',
        `snapshot-passed ${claim.label} has no accepted terminal`,
      )
}

function assertSnapshotCompletedClaims(input: {
  snapshot: Record<string, unknown> | undefined
  proofs: Map<string, ProvenUnit>
  tasks: AtomicTask[]
}): void {
  for (const task of input.tasks) {
    if (task.status !== 'completed') continue
    const unitId = `implementation:${task.id}`
    const proof = input.proofs.get(unitId)?.unit
    if (!proof)
      recoveryError(
        'recovery_checkpoint_missing',
        `snapshot-completed task ${task.id} has no accepted terminal`,
      )
    const payload = acceptedUnitPayload(proof)
    const evidenceRefs = stringArray(payload.evidenceRefs)
    if (
      task.completedRevision !== proof.inputRevision ||
      !evidenceRefs ||
      !sameStrings(task.evidenceRefs, evidenceRefs)
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        `snapshot and journal contradict completed task ${task.id}`,
      )
  }

  const evidence = record(input.snapshot?.evidence)
  for (const claim of [
    {
      value: record(evidence?.implementationAudit),
      unitId: IMPLEMENTATION_AUDIT_UNIT_ID,
      label: 'Implementation Audit',
    },
    {
      value: record(evidence?.acceptance),
      unitId: ACCEPTANCE_UNIT_ID,
      label: 'Acceptance',
    },
  ]) {
    if (claim.value?.status !== 'passed') continue
    const proof = input.proofs.get(claim.unitId)?.unit
    if (!proof)
      recoveryError(
        'recovery_checkpoint_missing',
        `snapshot-passed ${claim.label} has no accepted terminal`,
      )
    const payload = acceptedUnitPayload(proof)
    if (
      claim.value.path !== proof.receiptRef ||
      claim.value.path !== payload.receiptRef ||
      claim.value.revision !== proof.inputRevision ||
      claim.value.observedAt !== proof.acceptedAt
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        `snapshot and journal contradict ${claim.label}`,
      )
  }
}

function completeUnitGraph(input: { taskIds?: string[] }): string[] {
  const graph = fixedUnitIds()
  if (!input.taskIds) return graph
  return [
    ...graph,
    ...input.taskIds.map(taskId => `implementation:${taskId}`),
    IMPLEMENTATION_AUDIT_UNIT_ID,
    ACCEPTANCE_UNIT_ID,
  ]
}

function expectedPredecessors(input: {
  unitId: string
  tasks: AtomicTask[]
}): string[] | undefined {
  const fixed = expectedFixedPredecessors(input.unitId)
  if (fixed) return fixed
  const task = input.tasks.find(
    candidate => `implementation:${candidate.id}` === input.unitId,
  )
  if (task)
    return task.dependsOn.map(dependency => `implementation:${dependency}`)
  if (input.unitId === IMPLEMENTATION_AUDIT_UNIT_ID)
    return input.tasks.map(task => `implementation:${task.id}`)
  if (input.unitId === ACCEPTANCE_UNIT_ID) return [IMPLEMENTATION_AUDIT_UNIT_ID]
  return undefined
}

function assertCurrentUnitGraph(input: {
  proofs: Map<string, ProvenUnit>
  graph: string[]
  tasks: AtomicTask[]
  journal: WorkflowUnitAcceptedEvent[]
}): string[] {
  const graphSet = new Set(input.graph)
  for (const { unit } of input.proofs.values()) {
    if (!graphSet.has(unit.unitId))
      recoveryError(
        'recovery_checkpoint_conflict',
        `accepted checkpoint ${unit.unitId} is not in the current unit graph`,
      )
    const kind =
      expectedKind(unit.unitId) ??
      (input.tasks.some(task => `implementation:${task.id}` === unit.unitId)
        ? 'implementation-task'
        : undefined)
    const predecessors = expectedPredecessors({
      unitId: unit.unitId,
      tasks: input.tasks,
    })
    if (
      !kind ||
      unit.kind !== kind ||
      !predecessors ||
      !sameStrings(unit.predecessorUnitIds, predecessors)
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        `accepted checkpoint ${unit.unitId} contradicts the current unit graph`,
      )
  }
  const journalPositions = input.journal.map(event =>
    input.graph.indexOf(event.unit.unitId),
  )
  if (
    journalPositions.some(position => position < 0) ||
    journalPositions.some(
      (position, index) =>
        index > 0 && position <= journalPositions[index - 1]!,
    )
  )
    recoveryError(
      'recovery_checkpoint_conflict',
      'accepted-unit journal order contradicts the current unit graph',
    )

  let prefixLength = 0
  while (
    prefixLength < input.graph.length &&
    input.proofs.has(input.graph[prefixLength]!)
  )
    prefixLength += 1
  if (
    input.graph.slice(prefixLength + 1).some(unitId => input.proofs.has(unitId))
  )
    recoveryError(
      'recovery_checkpoint_missing',
      `accepted checkpoint ${input.graph[prefixLength]} is missing before later accepted work`,
    )
  return input.graph.slice(0, prefixLength)
}

function reviewScope(checkId: DocumentReviewCheckId): DocumentReviewScope {
  if (checkId === 'checklist_traceability') return 'checklist'
  if (
    COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS.includes(
      checkId as never,
    )
  )
    return 'complete'
  return 'foundation'
}

async function validateAcceptedArtifacts(input: {
  units: AcceptedWorkflowUnit[]
  workspacePath: string
  confirmedBriefContext: string
  confirmedBriefDigest: string
  documentRevision: string
}): Promise<void> {
  const artifactsByScope = new Map<
    DocumentReviewScope,
    ReturnType<typeof readDocumentReviewArtifacts>
  >()
  const artifactsForScope = (scope: DocumentReviewScope) => {
    let pending = artifactsByScope.get(scope)
    if (!pending) {
      pending = readDocumentReviewArtifacts(input.workspacePath, scope, {
        confirmedBriefContext: input.confirmedBriefContext,
        confirmedBriefDigest: input.confirmedBriefDigest,
      })
      artifactsByScope.set(scope, pending)
    }
    return pending
  }
  const finalAcceptedDocument = input.units
    .filter(unit => unit.kind === 'document')
    .at(-1)
  for (const unit of input.units) {
    if (
      unit === finalAcceptedDocument &&
      unit.inputRevision !== input.documentRevision
    )
      recoveryError(
        'recovery_artifact_digest_mismatch',
        'final accepted document proof contradicts the current document revision',
      )
    if (unit.kind === 'review-check') {
      if (Object.keys(unit.dependencyDigests).length === 0)
        recoveryError(
          'recovery_checkpoint_missing',
          `accepted review checkpoint ${unit.unitId} has no dependency proof`,
        )
      const check = reviewCheckFromUnit(unit)
      let current: Record<string, string>
      try {
        current = documentReviewArtifactDigests(
          artifactsForDocumentReviewCheck(
            await artifactsForScope(reviewScope(check.id)),
            check.id,
          ),
        )
      } catch {
        recoveryError(
          'recovery_artifact_digest_mismatch',
          `current artifacts for ${unit.unitId} cannot be verified`,
        )
      }
      if (stableValue(unit.dependencyDigests) !== stableValue(current))
        recoveryError(
          'recovery_artifact_digest_mismatch',
          `accepted dependencies changed after ${unit.unitId}`,
        )
      continue
    }
    if (unit.kind === 'resource-inventory') {
      if (
        unit.inputRevision !==
        (await computeResourceInventoryRevision(input.workspacePath))
      )
        recoveryError(
          'recovery_artifact_digest_mismatch',
          'canonical resource inventory changed after acceptance',
        )
      continue
    }
    if (unit.kind === 'resource-content') {
      const currentDigest = await computeResourceContentDigest(
        input.workspacePath,
      )
      if (unit.inputRevision !== currentDigest)
        recoveryError(
          'recovery_artifact_digest_mismatch',
          'canonical Resource Content digest changed after acceptance',
        )
      continue
    }
    if (unit.kind === 'resource-gate') {
      if (
        unit.inputRevision !==
        (await computeResourceRevision(
          input.workspacePath,
          input.documentRevision,
        ))
      )
        recoveryError(
          'recovery_artifact_digest_mismatch',
          'canonical resource revision changed after Resource Gate acceptance',
        )
      continue
    }
    if (unit.kind === 'checklist') {
      const reviewProof = input.units.find(
        candidate =>
          candidate.unitId === reviewUnitId('checklist_traceability'),
      )
      if (!reviewProof)
        recoveryError(
          'recovery_checkpoint_missing',
          'accepted Checklist has no accepted review dependency',
        )
      if (
        stableValue(unit.dependencyDigests) !==
        stableValue(reviewProof.dependencyDigests)
      )
        recoveryError(
          'recovery_checkpoint_conflict',
          'accepted Checklist contradicts its review dependency proof',
        )
      continue
    }
    for (const [path, expected] of Object.entries(unit.dependencyDigests)) {
      const absolute = resolveWorkspaceRelativePath(input.workspacePath, path)
      if (!absolute)
        recoveryError(
          'recovery_checkpoint_conflict',
          `checkpoint ${unit.unitId} references an invalid dependency path`,
        )
      let current: string
      try {
        current = sha256(await readFile(absolute))
      } catch {
        recoveryError(
          'recovery_artifact_digest_mismatch',
          `accepted dependency for ${unit.unitId} is unavailable`,
        )
      }
      if (current !== expected)
        recoveryError(
          'recovery_artifact_digest_mismatch',
          `accepted dependency changed after ${unit.unitId}`,
        )
    }
  }
}

function rawActiveUnitId(input: {
  snapshot: Record<string, unknown> | undefined
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): string | undefined {
  const snapshot = input.snapshot
  if (!snapshot) return undefined
  const dispatch = record(snapshot.activeDispatch)
  const currentItemId = stringValue(snapshot.currentItemId)
  if (
    currentItemId &&
    CANONICAL_FOUNDATION_DOCUMENTS.includes(currentItemId as never)
  ) {
    if (
      snapshot.phase !== 'DOCUMENT_DRAFTING' ||
      snapshot.documentStep !== 'FOUNDATION_DRAFTING'
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        'canonical document current item contradicts the raw workflow phase',
      )
    const request = record(dispatch?.request)
    if (!dispatch || !request)
      recoveryError(
        'recovery_checkpoint_missing',
        'unfinished canonical document has no active dispatch proof',
      )
    const contract = record(request.contract)
    const dispatchId = stringValue(dispatch.dispatchId)
    const runId = stringValue(snapshot.runId)
    const dispatchTaskId = stringValue(dispatch.taskId)
    const requestTaskId = stringValue(request.taskId)
    const dispatchRevision = stringValue(dispatch.revision)
    const requestRevision = stringValue(request.revision)
    const documentRevision = stringValue(record(snapshot.revision)?.document)
    const requestWorkspacePath = stringValue(request.workspacePath)
    const allowedPaths = stringArray(request.allowedPaths)
    const completedPaths = stringArray(
      record(snapshot.foundationDraftState)?.completedPaths,
    )
    const targetIndex = CANONICAL_FOUNDATION_DOCUMENTS.indexOf(
      currentItemId as never,
    )
    const expectedBriefDigest = sha256(input.confirmedBriefContext)
    const upstreamPaths = stringArray(contract?.upstreamDocumentPaths)
    if (
      !dispatchId ||
      !runId ||
      !dispatchTaskId ||
      !requestTaskId ||
      !dispatchRevision ||
      !requestRevision ||
      !documentRevision ||
      !requestWorkspacePath ||
      dispatch.status !== 'running' ||
      dispatch.workerType !== 'document-author' ||
      dispatch.phase !== 'DOCUMENT_DRAFTING' ||
      dispatchTaskId !== currentItemId ||
      request.dispatchId !== dispatchId ||
      request.runId !== runId ||
      request.ownerId !== input.ownerId ||
      request.projectId !== input.projectId ||
      snapshot.ownerId !== input.ownerId ||
      snapshot.projectId !== input.projectId ||
      resolve(requestWorkspacePath) !== resolve(input.workspacePath) ||
      request.workerType !== dispatch.workerType ||
      request.phase !== dispatch.phase ||
      requestTaskId !== currentItemId ||
      requestRevision !== dispatchRevision ||
      dispatchRevision !== documentRevision ||
      snapshot.confirmedBriefDigest !== expectedBriefDigest ||
      contract?.confirmedBriefDigest !== expectedBriefDigest ||
      contract?.documentSet !== 'foundation' ||
      contract.authoringMode !== 'initial' ||
      contract.foundationDocumentPath !== currentItemId ||
      !allowedPaths ||
      !sameStrings(allowedPaths, [currentItemId]) ||
      !upstreamPaths ||
      !sameStrings(
        upstreamPaths,
        INITIAL_FOUNDATION_UPSTREAM_PATHS[currentItemId as never],
      ) ||
      !completedPaths ||
      targetIndex < 0 ||
      !sameStrings(
        completedPaths,
        CANONICAL_FOUNDATION_DOCUMENTS.slice(0, targetIndex),
      )
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        'canonical document current item contradicts its active dispatch proof',
      )
    return documentUnitId(currentItemId)
  }
  const cycle = record(record(snapshot.documentReviewState)?.activeCycle)
  const completed = new Set(stringArray(cycle?.completedCheckIds) ?? [])
  if (snapshot.phase === 'DOCUMENT_REVIEW' && cycle) {
    const required = (stringArray(cycle.requiredCheckIds) ?? []).filter(id =>
      CURRENT_REVIEW_CHECK_IDS.has(id as DocumentReviewCheckId),
    )
    const next = required.find(id => !completed.has(id))
    if (next) return reviewUnitId(next as DocumentReviewCheckId)
  }
  const contract = record(record(dispatch?.request)?.contract)
  const currentChecks = (stringArray(contract?.currentCheckIds) ?? []).filter(
    id => CURRENT_REVIEW_CHECK_IDS.has(id as DocumentReviewCheckId),
  )
  if (currentChecks[0])
    return reviewUnitId(currentChecks[0] as DocumentReviewCheckId)
  const activeTaskId = stringValue(snapshot.activeTaskId)
  if (activeTaskId) return `implementation:${activeTaskId}`
  const resourceTask = stringValue(
    record(snapshot.resourceProductionState)?.currentTask,
  )
  if (snapshot.phase === 'RESOURCE_PREPARATION') {
    if (resourceTask === 'RESOURCE_INVENTORY') return RESOURCE_INVENTORY_UNIT_ID
    if (resourceTask === 'RESOURCE_CONTENT') return RESOURCE_CONTENT_UNIT_ID
    if (resourceTask === 'RESOURCE_GATE') return RESOURCE_GATE_UNIT_ID
  }
  if (snapshot.phase === 'ATOMIC_TASK_PLANNING') return ATOMIC_PLAN_UNIT_ID
  if (snapshot.phase === 'IMPLEMENTATION_AUDIT')
    return IMPLEMENTATION_AUDIT_UNIT_ID
  if (snapshot.phase === 'ACCEPTANCE') return ACCEPTANCE_UNIT_ID
  return undefined
}

export function proveExactRawActiveUnitId(input: {
  inspection: WorkflowSnapshotInspection
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): string | undefined {
  return rawActiveUnitId({
    ...input,
    snapshot: rawSnapshotRecord(input.inspection),
  })
}

function usageFromSnapshot(
  snapshot: Record<string, unknown> | undefined,
): WorkflowUsage | undefined {
  return workflowUsage(snapshot?.usage, 'snapshot')
}

function timestampFromSnapshot(
  snapshot: Record<string, unknown> | undefined,
  field: 'createdAt' | 'updatedAt' | 'lastProgressAt',
): string | undefined {
  const value = stringValue(snapshot?.[field])
  return value && Number.isFinite(Date.parse(value)) ? value : undefined
}

function acceptedReviewUnits(
  replayedUnitIds: string[],
  proofs: Map<string, ProvenUnit>,
  ids: readonly DocumentReviewCheckId[],
): AcceptedWorkflowUnit[] {
  const replayed = new Set(replayedUnitIds)
  return ids.flatMap(id => {
    const unitId = reviewUnitId(id)
    const proof = proofs.get(unitId)
    return replayed.has(unitId) && proof ? [proof.unit] : []
  })
}

function approvalFromReviewUnits(input: {
  scope: DocumentReviewScope
  revision: string
  units: AcceptedWorkflowUnit[]
  evidencePath?: string
  approvedAt?: string
}): DocumentReviewApproval | undefined {
  if (!input.evidencePath || !input.approvedAt) return undefined
  return {
    scope: input.scope,
    revision: input.revision,
    checks: input.units.map(reviewCheckFromUnit),
    checkEvidenceDigests: Object.fromEntries(
      input.units.map(unit => [
        reviewCheckFromUnit(unit).id,
        unit.dependencyDigests,
      ]),
    ),
    evidencePath: input.evidencePath,
    approvedAt: input.approvedAt,
  }
}

function buildProjectionRun(input: {
  snapshot?: Record<string, unknown>
  acceptedEvents: WorkflowUnitAcceptedEvent[]
  journalMetadata: RecoveryJournalMetadata
  proofs: Map<string, ProvenUnit>
  replayedUnitIds: string[]
  activeUnitId?: string
  revision: Revision
  tasks: AtomicTask[]
  activeSourceArtifactDigests?: Record<string, string>
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): DeliveryRun {
  const runId =
    stringValue(input.snapshot?.runId) ??
    input.acceptedEvents[0]?.runId ??
    input.journalMetadata.runId
  if (!runId)
    recoveryError(
      'recovery_checkpoint_missing',
      'recovery cannot prove the original run identity',
    )
  const confirmedBriefDigest = sha256(input.confirmedBriefContext)
  const base = createInitialDeliveryRun({
    runId,
    projectId: input.projectId,
    ownerId: input.ownerId,
    confirmedBriefContext: input.confirmedBriefContext,
    confirmedBriefDigest,
    documentRevision: input.revision.document,
    workspaceRevision: input.revision.workspace,
  })
  const replayed = new Set(input.replayedUnitIds)
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
    replayed.has(documentUnitId(path)),
  )
  const foundationUnits = acceptedReviewUnits(
    input.replayedUnitIds,
    input.proofs,
    FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  )
  const checklistUnits = acceptedReviewUnits(
    input.replayedUnitIds,
    input.proofs,
    CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS,
  )
  const comprehensiveUnits = acceptedReviewUnits(
    input.replayedUnitIds,
    input.proofs,
    COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  )
  const checklistProof = replayed.has(CHECKLIST_UNIT_ID)
    ? input.proofs.get(CHECKLIST_UNIT_ID)?.unit
    : undefined
  const checklistPayload = checklistProof
    ? acceptedUnitPayload(checklistProof)
    : undefined
  const checklistApproval = checklistProof
    ? approvalFromReviewUnits({
        scope: 'checklist',
        revision: checklistProof.inputRevision,
        units: checklistUnits,
        evidencePath:
          checklistProof.receiptRef ??
          stringValue(checklistPayload?.evidencePath),
        approvedAt: checklistProof.acceptedAt,
      })
    : undefined
  if (checklistProof && !checklistApproval)
    recoveryError(
      'recovery_checkpoint_missing',
      'accepted Checklist has no canonical approval receipt',
    )

  const inventory = replayed.has(RESOURCE_INVENTORY_UNIT_ID)
    ? input.proofs.get(RESOURCE_INVENTORY_UNIT_ID)?.unit
    : undefined
  const content = replayed.has(RESOURCE_CONTENT_UNIT_ID)
    ? input.proofs.get(RESOURCE_CONTENT_UNIT_ID)?.unit
    : undefined
  const gate = replayed.has(RESOURCE_GATE_UNIT_ID)
    ? input.proofs.get(RESOURCE_GATE_UNIT_ID)?.unit
    : undefined
  const audit = replayed.has(IMPLEMENTATION_AUDIT_UNIT_ID)
    ? input.proofs.get(IMPLEMENTATION_AUDIT_UNIT_ID)?.unit
    : undefined
  const acceptance = replayed.has(ACCEPTANCE_UNIT_ID)
    ? input.proofs.get(ACCEPTANCE_UNIT_ID)?.unit
    : undefined
  const inventoryPayload = inventory
    ? acceptedUnitPayload(inventory)
    : undefined
  const contentPayload = content ? acceptedUnitPayload(content) : undefined
  const gatePayload = gate ? acceptedUnitPayload(gate) : undefined
  const auditPayload = audit ? acceptedUnitPayload(audit) : undefined
  const acceptancePayload = acceptance
    ? acceptedUnitPayload(acceptance)
    : undefined

  let phase: DeliveryRun['phase'] = 'DELIVERY'
  let documentStep: DeliveryRun['documentStep']
  let currentItemId: string | undefined
  let resourceTask: DeliveryRun['resourceProductionState']['currentTask'] =
    'RESOURCE_PLAN'
  const activeUnitId = input.activeUnitId
  if (activeUnitId?.startsWith('document:')) {
    phase = 'DOCUMENT_DRAFTING'
    documentStep = 'FOUNDATION_DRAFTING'
    currentItemId = activeUnitId.slice('document:'.length)
  } else if (FOUNDATION_REVIEW_UNIT_IDS.includes(activeUnitId ?? '')) {
    phase = 'DOCUMENT_REVIEW'
    documentStep = 'FOUNDATION_REVIEW'
    currentItemId = activeUnitId?.slice('review:'.length)
  } else if (
    activeUnitId === reviewUnitId('checklist_traceability') ||
    activeUnitId === CHECKLIST_UNIT_ID
  ) {
    phase = 'DOCUMENT_REVIEW'
    documentStep = 'CHECKLIST_REVIEW'
    currentItemId =
      activeUnitId === CHECKLIST_UNIT_ID
        ? 'docs/acceptance/gameplay-checklist.md'
        : 'checklist_traceability'
  } else if (activeUnitId === RESOURCE_INVENTORY_UNIT_ID) {
    phase = 'RESOURCE_PREPARATION'
    resourceTask = 'RESOURCE_INVENTORY'
  } else if (activeUnitId === RESOURCE_CONTENT_UNIT_ID) {
    phase = 'RESOURCE_PREPARATION'
    resourceTask = 'RESOURCE_CONTENT'
  } else if (activeUnitId === RESOURCE_GATE_UNIT_ID) {
    phase = 'RESOURCE_PREPARATION'
    resourceTask = 'RESOURCE_GATE'
  } else if (COMPREHENSIVE_ADDITIONAL_UNIT_IDS.includes(activeUnitId ?? '')) {
    phase = 'DOCUMENT_REVIEW'
    documentStep = 'COMPREHENSIVE_REVIEW'
    currentItemId = activeUnitId?.slice('review:'.length)
    resourceTask = 'RESOURCE_GATE'
  } else if (activeUnitId === ATOMIC_PLAN_UNIT_ID) {
    phase = 'ATOMIC_TASK_PLANNING'
    resourceTask = 'RESOURCE_GATE'
  } else if (
    input.tasks.some(task => `implementation:${task.id}` === activeUnitId)
  ) {
    phase = 'IMPLEMENTATION'
    resourceTask = 'RESOURCE_GATE'
  } else if (activeUnitId === IMPLEMENTATION_AUDIT_UNIT_ID) {
    phase = 'IMPLEMENTATION_AUDIT'
    resourceTask = 'RESOURCE_GATE'
  } else if (activeUnitId === ACCEPTANCE_UNIT_ID) {
    phase = 'ACCEPTANCE'
    resourceTask = 'RESOURCE_GATE'
  }

  const activeReviewIds =
    documentStep === 'FOUNDATION_REVIEW'
      ? FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS
      : documentStep === 'CHECKLIST_REVIEW'
        ? CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS
        : documentStep === 'COMPREHENSIVE_REVIEW'
          ? COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS
          : undefined
  const activeReviewUnits = activeReviewIds
    ? acceptedReviewUnits(input.replayedUnitIds, input.proofs, activeReviewIds)
    : []
  const sourceArtifactDigests =
    input.activeSourceArtifactDigests ??
    (Object.assign(
      {},
      ...activeReviewUnits.map(unit => unit.dependencyDigests),
    ) as Record<string, string>)
  const activeCycle = activeReviewIds
    ? {
        cycleId:
          stringValue(
            record(record(input.snapshot?.documentReviewState)?.activeCycle)
              ?.cycleId,
          ) ?? `${runId}:recovered-review`,
        originScope:
          documentStep === 'FOUNDATION_REVIEW'
            ? ('foundation' as const)
            : documentStep === 'CHECKLIST_REVIEW'
              ? ('checklist' as const)
              : ('complete' as const),
        scope:
          documentStep === 'FOUNDATION_REVIEW'
            ? ('foundation' as const)
            : documentStep === 'CHECKLIST_REVIEW'
              ? ('checklist' as const)
              : ('complete' as const),
        mode: 'initial' as const,
        sourceRevision:
          documentStep === 'COMPREHENSIVE_REVIEW'
            ? (input.revision.resource ?? input.revision.document)
            : input.revision.document,
        requiredCheckIds: [...activeReviewIds],
        completedCheckIds: activeReviewUnits.map(
          unit => reviewCheckFromUnit(unit).id,
        ),
        checks: activeReviewUnits.map(reviewCheckFromUnit),
        checkEvidenceDigests: Object.fromEntries(
          activeReviewUnits.map(unit => [
            reviewCheckFromUnit(unit).id,
            unit.dependencyDigests,
          ]),
        ),
        findings: activeReviewUnits.flatMap(reviewFindingsFromUnit),
        acceptedSemanticResult: false,
        changedPaths: [],
        sourceArtifactDigests,
      }
    : undefined

  const rawRepairPasses = record(
    record(input.snapshot?.documentReviewState)?.repairPasses,
  )
  const repairPasses = {
    foundation:
      typeof rawRepairPasses?.foundation === 'number'
        ? rawRepairPasses.foundation
        : 0,
    checklist:
      typeof rawRepairPasses?.checklist === 'number'
        ? rawRepairPasses.checklist
        : 0,
    resource:
      typeof rawRepairPasses?.resource === 'number'
        ? rawRepairPasses.resource
        : 0,
  }
  const snapshotCreatedAt = timestampFromSnapshot(input.snapshot, 'createdAt')
  const createdAt = input.journalMetadata.createdAt
  const updatedAt =
    timestampFromSnapshot(input.snapshot, 'updatedAt') ??
    input.acceptedEvents.at(-1)?.createdAt
  if (!createdAt || !updatedAt)
    recoveryError(
      'recovery_checkpoint_missing',
      'recovery cannot prove the original run timestamps',
    )
  if (snapshotCreatedAt && snapshotCreatedAt !== createdAt)
    recoveryError(
      'recovery_checkpoint_conflict',
      'snapshot and journal contradict the original run start',
    )
  const snapshotUsage = usageFromSnapshot(input.snapshot)
  const usage = input.journalMetadata.usage
  if (!usage)
    recoveryError(
      'recovery_checkpoint_missing',
      'recovery cannot prove cumulative workflow usage',
    )
  if (snapshotUsage && stableValue(snapshotUsage) !== stableValue(usage))
    recoveryError(
      'recovery_checkpoint_conflict',
      'snapshot and journal contradict cumulative workflow usage',
    )

  const projectedTasks = input.tasks.map(task => {
    const proof = input.proofs.get(`implementation:${task.id}`)?.unit
    if (!proof)
      return {
        ...task,
        status: 'pending' as const,
        startedRevision: undefined,
        completedRevision: undefined,
        evidenceRefs: [],
      }
    const payload = acceptedUnitPayload(proof)
    return {
      ...task,
      status: 'completed' as const,
      completedRevision: proof.inputRevision,
      evidenceRefs: payload.evidenceRefs as string[],
    }
  })
  const projected: DeliveryRun = {
    ...base,
    phase,
    ...(documentStep ? { documentStep } : {}),
    status: activeUnitId ? 'running' : 'completed',
    revision: {
      ...input.revision,
      ...(gate ? { resource: gate.inputRevision } : {}),
    },
    ...(currentItemId ? { currentItemId } : {}),
    tasks: projectedTasks,
    evidence: {
      ...(gate
        ? {
            resourcePreparation: {
              path:
                gate.receiptRef ??
                stringValue(gatePayload?.receiptRef) ??
                recoveryError(
                  'recovery_checkpoint_missing',
                  'Resource Gate checkpoint has no canonical receipt',
                ),
              kind: 'resource_preparation' as const,
              revision: gate.inputRevision,
              status: 'passed' as const,
              observedAt: gate.acceptedAt,
            },
          }
        : {}),
      ...(audit
        ? {
            implementationAudit: {
              path:
                audit.receiptRef ??
                stringValue(auditPayload?.receiptRef) ??
                recoveryError(
                  'recovery_checkpoint_missing',
                  'Implementation Audit checkpoint has no canonical receipt',
                ),
              kind: 'implementation_audit' as const,
              revision: audit.inputRevision,
              status: 'passed' as const,
              observedAt: audit.acceptedAt,
            },
          }
        : {}),
      ...(acceptance
        ? {
            acceptance: {
              path:
                acceptance.receiptRef ??
                stringValue(acceptancePayload?.receiptRef) ??
                recoveryError(
                  'recovery_checkpoint_missing',
                  'Acceptance checkpoint has no canonical receipt',
                ),
              kind: 'acceptance' as const,
              revision: acceptance.inputRevision,
              status: 'passed' as const,
              observedAt: acceptance.acceptedAt,
            },
          }
        : {}),
    },
    documentReviewState: {
      repairPasses,
      ...(checklistApproval ? { checklistApproval } : {}),
      ...(activeCycle ? { activeCycle } : {}),
    },
    foundationDraftState: { completedPaths: documents },
    resourceProductionState: {
      currentTask: resourceTask,
      ...(inventory
        ? {
            inventoryReceipt: {
              revision: inventory.inputRevision,
              bindings: inventoryPayload?.bindings as never,
              catalogObserved: inventoryPayload?.catalogObserved as boolean,
              acceptedAt: inventory.acceptedAt,
            },
          }
        : {}),
      ...(content
        ? {
            contentReceipt: {
              contentDigest: contentPayload?.contentDigest as string,
              acceptedAt: content.acceptedAt,
            },
          }
        : {}),
    },
    usage,
    thinking: activeUnitId ? 'idle' : undefined,
    lastProgressAt:
      timestampFromSnapshot(input.snapshot, 'lastProgressAt') ?? updatedAt,
    createdAt,
    ...(activeUnitId ? {} : { completedAt: updatedAt }),
    updatedAt,
  }
  try {
    return parseDeliveryRun(projected)
  } catch (error) {
    recoveryError(
      'recovery_checkpoint_conflict',
      `projected run does not satisfy the current schema: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function assertSnapshotUnchanged(input: {
  inspection: WorkflowSnapshotInspection
  workspacePath: string
}): Promise<void> {
  if (sha256(input.inspection.rawText) !== input.inspection.digest)
    recoveryError(
      'recovery_snapshot_changed',
      'snapshot inspection digest does not match its captured bytes',
    )
  let current: string
  try {
    current = await readFile(
      join(resolve(input.workspacePath), '.beegame', 'workflow', 'run.json'),
      'utf8',
    )
  } catch {
    recoveryError(
      'recovery_snapshot_changed',
      'workflow snapshot disappeared after inspection',
    )
  }
  if (sha256(current) !== input.inspection.digest)
    recoveryError(
      'recovery_snapshot_changed',
      'workflow snapshot changed after inspection',
    )
}

export async function projectExactResumeRun(input: {
  inspection: WorkflowSnapshotInspection
  events: WorkflowEvent[]
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
  receiptReconciliation?: {
    sourceInspection: WorkflowSnapshotInspection
    successorActiveUnitId: string
  }
}): Promise<{
  run: DeliveryRun
  activeUnitId?: string
  replayedUnitIds: string[]
  sourceSnapshotDigest: string
}> {
  await assertSnapshotUnchanged(input)
  if (
    input.receiptReconciliation &&
    (input.receiptReconciliation.sourceInspection.digest !==
      input.inspection.digest ||
      input.receiptReconciliation.sourceInspection.rawText !==
        input.inspection.rawText)
  )
    recoveryError(
      'recovery_checkpoint_conflict',
      'receipt reconciliation does not belong to the projected raw snapshot',
    )
  const snapshot = rawSnapshotRecord(input.inspection)
  const snapshotRunId = assertSnapshotIdentity({
    snapshot,
    ownerId: input.ownerId,
    projectId: input.projectId,
    confirmedBriefContext: input.confirmedBriefContext,
  })
  const acceptedEvents = parseAcceptedEvents({
    events: input.events,
    ownerId: input.ownerId,
    projectId: input.projectId,
    snapshotRunId,
  })
  const journalMetadata = recoveryJournalMetadata({
    events: input.events,
    expectedRunId: snapshotRunId ?? acceptedEvents[0]?.runId,
  })
  if (!snapshot && acceptedEvents.length === 0)
    recoveryError(
      'recovery_checkpoint_missing',
      'malformed snapshot has no accepted-unit journal',
    )
  const revision = await snapshotRevision(
    snapshot,
    acceptedEvents,
    input.workspacePath,
    sha256(input.confirmedBriefContext),
  )
  const proofs = new Map<string, ProvenUnit>(
    acceptedEvents.map(event => [
      event.unit.unitId,
      { unit: event.unit, source: 'journal' as const },
    ]),
  )
  if (snapshot) {
    await historicalDocumentFacts({
      snapshot,
      proofs,
      workspacePath: input.workspacePath,
      revision,
    })
    historicalReviewFacts({ snapshot, proofs, revision })
    historicalChecklistFact({ snapshot, proofs })
    historicalResourceFacts({ snapshot, proofs, revision })
  }
  assertRawCompletedClaimsHaveAcceptedProof({ snapshot, proofs })
  const taskIds = planTaskIds(proofs)
  const tasks = snapshotTasks(snapshot, taskIds)
  assertSnapshotCompletedClaims({ snapshot, proofs, tasks })
  const graph = completeUnitGraph({ taskIds })
  const replayedUnitIds = assertCurrentUnitGraph({
    proofs,
    graph,
    tasks,
    journal: acceptedEvents,
  })
  const activeUnitId = graph[replayedUnitIds.length]
  const rawProofInspection =
    input.receiptReconciliation?.sourceInspection ?? input.inspection
  const rawProofActiveUnitId = proveExactRawActiveUnitId({
    inspection: rawProofInspection,
    workspacePath: input.workspacePath,
    ownerId: input.ownerId,
    projectId: input.projectId,
    confirmedBriefContext: input.confirmedBriefContext,
  })
  let hintedActiveUnitId = rawProofActiveUnitId
  if (input.receiptReconciliation) {
    if (!rawProofActiveUnitId)
      recoveryError(
        'recovery_checkpoint_missing',
        'receipt reconciliation has no exact raw active-unit proof',
      )
    if (
      replayedUnitIds.at(-1) !== rawProofActiveUnitId ||
      input.receiptReconciliation.successorActiveUnitId !== activeUnitId
    )
      recoveryError(
        'recovery_checkpoint_conflict',
        'receipt reconciliation does not advance the proven raw active unit',
      )
    hintedActiveUnitId = input.receiptReconciliation.successorActiveUnitId
  }
  if (hintedActiveUnitId && hintedActiveUnitId !== activeUnitId) {
    const hintedPosition = graph.indexOf(hintedActiveUnitId)
    if (hintedPosition > replayedUnitIds.length)
      recoveryError(
        'recovery_checkpoint_missing',
        `snapshot active unit ${hintedActiveUnitId} follows an unproven checkpoint`,
      )
    if (hintedPosition >= 0)
      recoveryError(
        'recovery_checkpoint_conflict',
        `snapshot active unit ${hintedActiveUnitId} contradicts the accepted prefix`,
      )
  }
  const replayedUnits = replayedUnitIds.map(unitId => proofs.get(unitId)!.unit)
  await validateAcceptedArtifacts({
    units: replayedUnits,
    workspacePath: input.workspacePath,
    confirmedBriefContext: input.confirmedBriefContext,
    confirmedBriefDigest: sha256(input.confirmedBriefContext),
    documentRevision: revision.document,
  })
  if (activeUnitId && !hintedActiveUnitId)
    recoveryError(
      'recovery_checkpoint_missing',
      'snapshot has no durable identity for the exact unfinished unit',
    )
  const activeReviewScope = FOUNDATION_REVIEW_UNIT_IDS.includes(
    activeUnitId ?? '',
  )
    ? ('foundation' as const)
    : activeUnitId === reviewUnitId('checklist_traceability')
      ? ('checklist' as const)
      : COMPREHENSIVE_ADDITIONAL_UNIT_IDS.includes(activeUnitId ?? '')
        ? ('complete' as const)
        : undefined
  const activeSourceArtifactDigests = activeReviewScope
    ? documentReviewArtifactDigests(
        await readDocumentReviewArtifacts(
          input.workspacePath,
          activeReviewScope,
          {
            confirmedBriefContext: input.confirmedBriefContext,
            confirmedBriefDigest: sha256(input.confirmedBriefContext),
          },
        ),
      )
    : undefined
  const run = buildProjectionRun({
    snapshot,
    acceptedEvents,
    journalMetadata,
    proofs,
    replayedUnitIds,
    activeUnitId,
    revision,
    tasks,
    ...(activeSourceArtifactDigests ? { activeSourceArtifactDigests } : {}),
    ownerId: input.ownerId,
    projectId: input.projectId,
    confirmedBriefContext: input.confirmedBriefContext,
  })
  return {
    run,
    ...(activeUnitId ? { activeUnitId } : {}),
    replayedUnitIds,
    sourceSnapshotDigest: input.inspection.digest,
  }
}
