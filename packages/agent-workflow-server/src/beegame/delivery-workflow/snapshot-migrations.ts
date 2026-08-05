import { parseDeliveryRun } from './schema'
import {
  DELIVERY_RUN_SCHEMA_VERSION,
  DOCUMENT_REVIEW_CHECK_IDS,
  DOCUMENT_REVIEW_OWNER_BY_CHECK_ID,
} from './types'

export type SnapshotMigrationResult = {
  value: unknown
  migratedFrom?: number
}

export class SnapshotMigrationError extends Error {
  constructor(
    readonly code:
      | 'unsupported_version'
      | 'ambiguous_completed_unit'
      | 'invalid_migrated_snapshot',
    message: string,
  ) {
    super(message)
    this.name = 'SnapshotMigrationError'
  }
}

type SnapshotRecord = Record<string, unknown>

export type WorkflowSnapshotMigration = {
  from: number
  to: number
  migrate(snapshot: SnapshotRecord): SnapshotRecord
}

const currentCheckIds = new Set<string>(DOCUMENT_REVIEW_CHECK_IDS)
const currentCheckOwnerById = new Map(
  Object.entries(DOCUMENT_REVIEW_OWNER_BY_CHECK_ID),
)

function isRecord(value: unknown): value is SnapshotRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new SnapshotMigrationError('invalid_migrated_snapshot', message)
}

function ambiguous(message: string): never {
  throw new SnapshotMigrationError('ambiguous_completed_unit', message)
}

function asCheckIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string'))
    invalid(`${field} must be an array of check identifiers`)
  return value
}

function filterPendingRequiredCheckIds(
  value: unknown,
  field: string,
): string[] {
  return asCheckIds(value, field).filter(id => currentCheckIds.has(id))
}

function requireCurrentCheckIds(value: unknown, field: string): void {
  for (const id of asCheckIds(value, field))
    if (!currentCheckIds.has(id))
      ambiguous(`${field} contains an unproven accepted check`)
}

function requireCurrentCheckRecords(value: unknown, field: string): void {
  if (!Array.isArray(value)) invalid(`${field} must be an array of checks`)
  for (const check of value) {
    if (!isRecord(check) || typeof check.id !== 'string')
      invalid(`${field} contains an invalid check`)
    if (!currentCheckIds.has(check.id))
      ambiguous(`${field} contains an unproven accepted check`)
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    invalid(`${field} must be a non-empty string`)
  return value
}

function requireNonEmptyStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array`)
  return value.map((item, index) =>
    requireNonEmptyString(item, `${field}[${index}]`),
  )
}

function removeVersion11Fields(snapshot: SnapshotRecord): void {
  if (snapshot.parentRunId !== undefined)
    requireNonEmptyString(snapshot.parentRunId, 'parentRunId')
  if (snapshot.reviewedDocumentPaths !== undefined)
    requireNonEmptyStrings(
      snapshot.reviewedDocumentPaths,
      'reviewedDocumentPaths',
    )
  if (snapshot.checklistRemediation !== undefined) {
    const remediation = snapshot.checklistRemediation
    if (!isRecord(remediation)) invalid('checklistRemediation is invalid')
    const allowedKeys = new Set(['sourceRevision', 'attempt', 'issues'])
    if (Object.keys(remediation).some(key => !allowedKeys.has(key)))
      invalid('checklistRemediation contains unsupported fields')
    requireNonEmptyString(
      remediation.sourceRevision,
      'checklistRemediation.sourceRevision',
    )
    if (
      !Number.isInteger(remediation.attempt) ||
      Number(remediation.attempt) < 1
    )
      invalid('checklistRemediation.attempt must be a positive integer')
    const issues = requireNonEmptyStrings(
      remediation.issues,
      'checklistRemediation.issues',
    )
    if (issues.length === 0)
      invalid('checklistRemediation.issues must not be empty')
  }

  delete snapshot.parentRunId
  delete snapshot.reviewedDocumentPaths
  delete snapshot.checklistRemediation
}

function migrateHistoricalRepairPlan(cycle: SnapshotRecord): void {
  const repairPlan = cycle.repairPlan
  if (repairPlan === undefined) return
  if (!isRecord(repairPlan) || !Array.isArray(repairPlan.groups))
    invalid('documentReviewState.activeCycle.repairPlan is invalid')

  repairPlan.groups = repairPlan.groups.map((group, index) => {
    const field = `documentReviewState.activeCycle.repairPlan.groups[${index}]`
    if (!isRecord(group)) invalid(`${field} is invalid`)
    const hasHistoricalDecision = Object.hasOwn(group, 'decision')
    const hasHistoricalPaths = Object.hasOwn(group, 'affectedPaths')
    const hasCurrentDecision = Object.hasOwn(group, 'groupDecision')
    const hasCurrentPaths = Object.hasOwn(group, 'pathDecisions')
    const isHistorical = hasHistoricalDecision && hasHistoricalPaths
    const isCurrent = hasCurrentDecision && hasCurrentPaths
    if (
      (!isHistorical && !isCurrent) ||
      hasHistoricalDecision !== hasHistoricalPaths ||
      hasCurrentDecision !== hasCurrentPaths ||
      (isHistorical && isCurrent)
    )
      invalid(`${field} has an unsupported repair decision shape`)
    if (isCurrent) return group

    const decision = requireNonEmptyString(group.decision, `${field}.decision`)
    const affectedPaths = requireNonEmptyStrings(
      group.affectedPaths,
      `${field}.affectedPaths`,
    )
    if (affectedPaths.length === 0)
      invalid(`${field}.affectedPaths must not be empty`)
    const migrated: SnapshotRecord = {
      ...group,
      groupDecision: decision,
      pathDecisions: affectedPaths.map(path => ({ path, decision })),
    }
    delete migrated.decision
    delete migrated.affectedPaths
    return migrated
  })
}

function migrateApprovalChecks(state: SnapshotRecord): void {
  for (const key of [
    'foundationApproval',
    'checklistApproval',
    'comprehensiveApproval',
  ]) {
    const approval = state[key]
    if (approval === undefined) continue
    if (!isRecord(approval)) invalid(`documentReviewState.${key} is invalid`)
    requireCurrentCheckRecords(
      approval.checks,
      `documentReviewState.${key}.checks`,
    )
  }
}

function migrateActiveCycle(state: SnapshotRecord): void {
  const cycle = state.activeCycle
  if (cycle === undefined) return
  if (!isRecord(cycle)) invalid('documentReviewState.activeCycle is invalid')

  cycle.requiredCheckIds = filterPendingRequiredCheckIds(
    cycle.requiredCheckIds,
    'documentReviewState.activeCycle.requiredCheckIds',
  )
  requireCurrentCheckIds(
    cycle.completedCheckIds,
    'documentReviewState.activeCycle.completedCheckIds',
  )
  requireCurrentCheckRecords(
    cycle.checks,
    'documentReviewState.activeCycle.checks',
  )

  if (!Array.isArray(cycle.findings))
    invalid('documentReviewState.activeCycle.findings must be an array')
  for (const finding of cycle.findings) {
    if (
      !isRecord(finding) ||
      typeof finding.checkId !== 'string' ||
      typeof finding.owner !== 'string'
    )
      invalid(
        'documentReviewState.activeCycle.findings contains an invalid finding',
      )
    if (!currentCheckIds.has(finding.checkId))
      ambiguous(
        'documentReviewState.activeCycle.findings contains an unproven accepted check',
      )
    if (currentCheckOwnerById.get(finding.checkId) !== finding.owner)
      ambiguous(
        'documentReviewState.activeCycle.findings contains an unproven accepted owner',
      )
  }

  migrateHistoricalRepairPlan(cycle)
}

function migrateActiveDispatch(snapshot: SnapshotRecord): void {
  const dispatch = snapshot.activeDispatch
  if (dispatch === undefined) return
  if (!isRecord(dispatch)) invalid('activeDispatch is invalid')

  if (isRecord(dispatch.request) && isRecord(dispatch.request.contract)) {
    const contract = dispatch.request.contract
    if (contract.requiredCheckIds !== undefined)
      contract.requiredCheckIds = filterPendingRequiredCheckIds(
        contract.requiredCheckIds,
        'activeDispatch.request.contract.requiredCheckIds',
      )
    if (contract.currentCheckIds !== undefined)
      requireCurrentCheckIds(
        contract.currentCheckIds,
        'activeDispatch.request.contract.currentCheckIds',
      )
  }

  if (isRecord(dispatch.terminalResult)) {
    if (dispatch.terminalResult.checks !== undefined)
      requireCurrentCheckRecords(
        dispatch.terminalResult.checks,
        'activeDispatch.terminalResult.checks',
      )
    if (dispatch.terminalResult.reviewedDocumentPaths !== undefined) {
      requireNonEmptyStrings(
        dispatch.terminalResult.reviewedDocumentPaths,
        'activeDispatch.terminalResult.reviewedDocumentPaths',
      )
      delete dispatch.terminalResult.reviewedDocumentPaths
    }
  }
}

function migrateVersion11To12(snapshot: SnapshotRecord): SnapshotRecord {
  const migrated = structuredClone(snapshot)
  removeVersion11Fields(migrated)
  const state = migrated.documentReviewState
  if (!isRecord(state)) invalid('documentReviewState is invalid')

  migrateApprovalChecks(state)
  migrateActiveCycle(state)
  migrateActiveDispatch(migrated)
  migrated.schemaVersion = 12
  return migrated
}

function migrateVersion12To13(snapshot: SnapshotRecord): SnapshotRecord {
  const migrated = structuredClone(snapshot)
  if (migrated.pendingEvents !== undefined)
    invalid('version-12 snapshot contains an unsupported pending events marker')
  const pendingEvent = migrated.pendingEvent
  if (pendingEvent !== undefined) {
    if (!isRecord(pendingEvent)) invalid('pendingEvent is invalid')
    migrated.pendingEvents = [pendingEvent]
    delete migrated.pendingEvent
  }
  migrated.schemaVersion = 13
  return migrated
}

export const SUPPORTED_WORKFLOW_SNAPSHOT_VERSIONS = [
  11,
  12,
  DELIVERY_RUN_SCHEMA_VERSION,
] as const

export const WORKFLOW_SNAPSHOT_MIGRATIONS = [
  { from: 11, to: 12, migrate: migrateVersion11To12 },
  { from: 12, to: 13, migrate: migrateVersion12To13 },
] as const satisfies readonly WorkflowSnapshotMigration[]

export function migrateWorkflowSnapshot(
  value: unknown,
): SnapshotMigrationResult {
  if (!isRecord(value) || typeof value.schemaVersion !== 'number')
    throw new SnapshotMigrationError(
      'unsupported_version',
      'workflow snapshot has no supported schema version',
    )
  if (!Number.isInteger(value.schemaVersion))
    throw new SnapshotMigrationError(
      'unsupported_version',
      'workflow snapshot schema version must be an integer',
    )

  if (value.schemaVersion === DELIVERY_RUN_SCHEMA_VERSION) {
    try {
      return { value: parseDeliveryRun(value) }
    } catch {
      throw new SnapshotMigrationError(
        'invalid_migrated_snapshot',
        'workflow snapshot does not satisfy the current schema',
      )
    }
  }
  if (
    !SUPPORTED_WORKFLOW_SNAPSHOT_VERSIONS.some(
      version => version === value.schemaVersion,
    )
  )
    throw new SnapshotMigrationError(
      'unsupported_version',
      `workflow snapshot schema version ${value.schemaVersion} is unsupported`,
    )

  const migratedFrom = value.schemaVersion
  let migrated = structuredClone(value)
  while (migrated.schemaVersion !== DELIVERY_RUN_SCHEMA_VERSION) {
    const migration = WORKFLOW_SNAPSHOT_MIGRATIONS.find(
      candidate => candidate.from === migrated.schemaVersion,
    )
    if (!migration)
      throw new SnapshotMigrationError(
        'unsupported_version',
        `workflow snapshot migration chain is incomplete at version ${migrated.schemaVersion}`,
      )
    migrated = migration.migrate(migrated)
  }
  try {
    return {
      value: parseDeliveryRun(migrated),
      migratedFrom,
    }
  } catch (error) {
    if (error instanceof SnapshotMigrationError) throw error
    throw new SnapshotMigrationError(
      'invalid_migrated_snapshot',
      'migrated workflow snapshot does not satisfy the current schema',
    )
  }
}
