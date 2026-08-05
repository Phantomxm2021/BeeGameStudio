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
      invalid('documentReviewState.activeCycle.findings contains an invalid finding')
    if (!currentCheckIds.has(finding.checkId))
      ambiguous(
        'documentReviewState.activeCycle.findings contains an unproven accepted check',
      )
    if (currentCheckOwnerById.get(finding.checkId) !== finding.owner)
      ambiguous(
        'documentReviewState.activeCycle.findings contains an unproven accepted owner',
      )
  }
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

  if (isRecord(dispatch.terminalResult) && dispatch.terminalResult.checks !== undefined)
    requireCurrentCheckRecords(
      dispatch.terminalResult.checks,
      'activeDispatch.terminalResult.checks',
    )
}

function migrateVersion11To12(snapshot: SnapshotRecord): SnapshotRecord {
  const migrated = structuredClone(snapshot)
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
  if (value.schemaVersion !== 11 && value.schemaVersion !== 12)
    throw new SnapshotMigrationError(
      'unsupported_version',
      `workflow snapshot schema version ${value.schemaVersion} is unsupported`,
    )

  const migratedFrom = value.schemaVersion
  let migrated = structuredClone(value)
  if (migrated.schemaVersion === 11)
    migrated = migrateVersion11To12(migrated)
  if (migrated.schemaVersion === 12)
    migrated = migrateVersion12To13(migrated)
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
