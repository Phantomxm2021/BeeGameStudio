import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { parseDeliveryRun, parseWorkflowEvent } from './schema'
import { assertDeliveryRunInvariants } from './transition'
import {
  activeElapsedWithinStage,
  freezePreviousStageCard,
  isFrozenWorkflowStageCardEvent,
  lastStageBoundaryAt,
} from './workflow-stage-card-history'
import type {
  DeliveryRun,
  DispatchRecord,
  AcceptedWorkflowUnit,
  WorkflowEvent,
  WorkflowUnitAcceptedEvent,
  WorkflowUsage,
} from './types'
import { DELIVERY_RUN_SCHEMA_VERSION } from './types'
import { sanitizeWorkflowDisplayMessage } from './workflow-display-message'
import { projectTaskTerminalEvidence } from './task-terminal-evidence'
import { foundationRuntimeTasks } from './foundation-audit-state'
import type { FoundationAuditTask, FoundationRevisionTask } from './foundation-audit-state'

export type { WorkflowEvent } from './types'

export type WorkflowLock = {
  ownerId: string
  runId: string
  leaseId: string
  processId: number
  purpose: 'mutation' | 'recovery'
  acquiredAt: string
  heartbeatAt: string
}

export class WorkflowStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ownership'
      | 'locked'
      | 'invalid'
      | 'obsolete'
      | 'io'
      | 'conflict'
      | 'recovery_checkpoint_missing'
      | 'recovery_checkpoint_conflict'
      | 'recovery_artifact_digest_mismatch'
      | 'recovery_snapshot_changed',
  ) {
    super(message)
    this.name = 'WorkflowStoreError'
  }
}

export type WorkflowSnapshotInspection = {
  rawText: string
  digest: string
  parsedValue?: unknown
  currentRun?: DeliveryRun
  error?: WorkflowStoreError
}

function now(): string {
  return new Date().toISOString()
}

function foundationNeedsAction(run: DeliveryRun): boolean {
  return Boolean(
    run.foundationAuditState && foundationRuntimeTasks(run.foundationAuditState).some(
      task => task.status === 'needs_action',
    ),
  )
}

const FOUNDATION_REVISION_STATUSES = [
  'planning',
  'revising',
  'rebuilding_facts',
  'validating',
  'semantic_recheck',
  'publishing',
  'round_closing',
] as const

function isFoundationRevisionStatus(status: string): boolean {
  return FOUNDATION_REVISION_STATUSES.includes(
    status as (typeof FOUNDATION_REVISION_STATUSES)[number],
  )
}

function isFoundationRevisionTask(
  task: FoundationAuditTask,
): task is FoundationRevisionTask {
  return (
    task.kind === 'document-revision' ||
    task.kind === 'impacted-facts' ||
    task.kind === 'semantic-recheck'
  )
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function storageReadError(path: string, error: unknown): WorkflowStoreError {
  const detail = error instanceof Error ? error.message : String(error)
  return new WorkflowStoreError(
    `unable to read workflow state at ${path}: ${detail}`,
    'io',
  )
}

/** Read and classify run.json without flushing markers or rewriting it. */
export async function inspectWorkflowSnapshot(input: {
  snapshotPath: string
  ownerId?: string
}): Promise<WorkflowSnapshotInspection> {
  let rawText: string
  try {
    rawText = await readFile(input.snapshotPath, 'utf8')
  } catch (error) {
    throw storageReadError(input.snapshotPath, error)
  }
  const digest = createHash('sha256').update(rawText).digest('hex')
  let parsedValue: unknown
  try {
    parsedValue = JSON.parse(rawText) as unknown
  } catch (error) {
    return {
      rawText,
      digest,
      error: new WorkflowStoreError(
        `workflow snapshot JSON is invalid at ${input.snapshotPath}: ${error instanceof Error ? error.message : String(error)}`,
        'invalid',
      ),
    }
  }
  const snapshotVersion =
    parsedValue &&
    typeof parsedValue === 'object' &&
    !Array.isArray(parsedValue)
      ? (parsedValue as Record<string, unknown>).schemaVersion
      : undefined
  if (
    typeof snapshotVersion === 'number' &&
    Number.isInteger(snapshotVersion) &&
    snapshotVersion < DELIVERY_RUN_SCHEMA_VERSION
  )
    return {
      rawText,
      digest,
      parsedValue,
      error: new WorkflowStoreError(
        `workflow snapshot schema version ${snapshotVersion} is obsolete; start a new workflow with schema version ${DELIVERY_RUN_SCHEMA_VERSION}`,
        'obsolete',
      ),
    }
  if (
    typeof snapshotVersion === 'number' &&
    Number.isInteger(snapshotVersion) &&
    snapshotVersion > DELIVERY_RUN_SCHEMA_VERSION
  )
    return {
      rawText,
      digest,
      parsedValue,
      error: new WorkflowStoreError(
        `workflow snapshot schema version ${snapshotVersion} is newer than current version ${DELIVERY_RUN_SCHEMA_VERSION}`,
        'invalid',
      ),
    }
  try {
    const currentRun = parseDeliveryRun(parsedValue)
    if (input.ownerId && currentRun.ownerId !== input.ownerId)
      return {
        rawText,
        digest,
        parsedValue,
        error: new WorkflowStoreError(
          'workflow ownership mismatch',
          'ownership',
        ),
      }
    return { rawText, digest, parsedValue, currentRun }
  } catch (error) {
    return {
      rawText,
      digest,
      parsedValue,
      error: new WorkflowStoreError(
        `workflow snapshot schema is invalid at ${input.snapshotPath}: ${error instanceof Error ? error.message : String(error)}`,
        'invalid',
      ),
    }
  }
}

const mutationQueues = new Map<string, Promise<void>>()

async function enqueueMutation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve()
  let queued!: Promise<T>
  queued = previous.catch(() => undefined).then(operation)
  const marker = queued.then(
    () => undefined,
    () => undefined,
  )
  mutationQueues.set(key, marker)
  try {
    return await queued
  } finally {
    if (mutationQueues.get(key) === marker) mutationQueues.delete(key)
  }
}

function mergeUsage(
  left: WorkflowUsage | undefined,
  right: WorkflowUsage | undefined,
): WorkflowUsage | undefined {
  if (!left && !right) return undefined
  const a = left ?? {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
  const b = right ?? {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
  return {
    input_tokens: Math.max(a.input_tokens, b.input_tokens),
    cache_read_tokens: Math.max(a.cache_read_tokens, b.cache_read_tokens),
    cache_creation_tokens: Math.max(
      a.cache_creation_tokens,
      b.cache_creation_tokens,
    ),
    completion_tokens: Math.max(a.completion_tokens, b.completion_tokens),
    total_tokens: Math.max(a.total_tokens, b.total_tokens),
  }
}

function addUsage(
  left: WorkflowUsage | undefined,
  right: WorkflowUsage,
): WorkflowUsage {
  const a = left ?? {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
  return {
    input_tokens: a.input_tokens + right.input_tokens,
    cache_read_tokens: a.cache_read_tokens + right.cache_read_tokens,
    cache_creation_tokens:
      a.cache_creation_tokens + right.cache_creation_tokens,
    completion_tokens: a.completion_tokens + right.completion_tokens,
    total_tokens: a.total_tokens + right.total_tokens,
  }
}

function withDispatchUsage(
  run: DeliveryRun,
  dispatchId: string,
  usage: WorkflowUsage,
): DeliveryRun {
  const update = (dispatch: DispatchRecord | undefined) =>
    dispatch?.dispatchId === dispatchId ? { ...dispatch, usage } : dispatch
  const activeTaskIds = run.foundationAuditState
    ? new Set(foundationRuntimeTasks(run.foundationAuditState).map(task => task.taskId))
    : new Set<string>()
  return {
    ...run,
    activeDispatch: update(run.activeDispatch),
    foundationDraftState: {
      ...run.foundationDraftState,
      ...(run.foundationDraftState.documents
        ? {
            documents: run.foundationDraftState.documents.map(document => ({
              ...document,
              dispatch: update(document.dispatch),
            })),
          }
        : {}),
    },
    foundationAuditState: run.foundationAuditState
      ? {
          ...run.foundationAuditState,
          tasks: run.foundationAuditState.tasks.map(task =>
            activeTaskIds.has(task.taskId) && task.dispatch?.dispatchId === dispatchId
              ? { ...task, usage, dispatch: update(task.dispatch) }
              : task,
          ),
        }
      : run.foundationAuditState,
  }
}

function journalUsageHighWater(
  events: readonly WorkflowEvent[],
): WorkflowUsage | undefined {
  let usage: WorkflowUsage | undefined
  for (const event of events) {
    if (event.type !== 'usage.updated') continue
    const candidate = event.usage
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      continue
    const record = candidate as Record<string, unknown>
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
          typeof record[key] !== 'number' ||
          !Number.isFinite(record[key]) ||
          (record[key] as number) < 0,
      )
    )
      continue
    usage = mergeUsage(
      usage,
      Object.fromEntries(keys.map(key => [key, record[key]])) as WorkflowUsage,
    )
  }
  return usage
}

function paths(workspacePath: string) {
  const directory = join(resolve(workspacePath), '.beegame', 'workflow')
  return {
    directory,
    snapshot: join(directory, 'run.json'),
    events: join(directory, 'events.jsonl'),
    lock: join(directory, 'lock.json'),
  }
}

async function durableWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

async function durableAppend(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export function createInitialDeliveryRun(input: {
  runId?: string
  projectId: string
  ownerId: string
  confirmedBriefDigest: string
  confirmedBriefContext: string
  documentRevision?: string
  workspaceRevision?: string
}): DeliveryRun {
  if (!input.confirmedBriefContext.trim())
    throw new Error('confirmed brief context is required')
  const confirmedBriefDigest = createHash('sha256')
    .update(input.confirmedBriefContext)
    .digest('hex')
  if (confirmedBriefDigest !== input.confirmedBriefDigest)
    throw new Error('confirmed brief digest does not match its durable context')
  const timestamp = now()
  return {
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    runId: input.runId ?? randomUUID(),
    projectId: input.projectId,
    ownerId: input.ownerId,
    confirmedBriefDigest: input.confirmedBriefDigest,
    confirmedBriefContext: input.confirmedBriefContext,
    phase: 'BRIEF_CONFIRMED',
    status: 'running',
    lastProgressAt: timestamp,
    revision: {
      document: input.documentRevision ?? 'uncomputed',
      workspace: input.workspaceRevision ?? 'uncomputed',
    },
    tasks: [],
    evidence: {},
    foundationDraftState: { completedPaths: [] },
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createRunStore(workspacePath: string, ownerId: string) {
  const filePaths = paths(workspacePath)

  function processIsAlive(processId: number): boolean {
    try {
      process.kill(processId, 0)
      return true
    } catch (error) {
      return !(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ESRCH'
      )
    }
  }

  function parseLock(value: unknown): WorkflowLock {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof (value as WorkflowLock).ownerId !== 'string' ||
      typeof (value as WorkflowLock).runId !== 'string' ||
      typeof (value as WorkflowLock).leaseId !== 'string' ||
      !Number.isInteger((value as WorkflowLock).processId) ||
      ((value as WorkflowLock).purpose !== 'mutation' &&
        (value as WorkflowLock).purpose !== 'recovery')
    )
      throw new WorkflowStoreError('workflow project is locked', 'locked')
    return value as WorkflowLock
  }

  function createLease(
    runId: string,
    purpose: WorkflowLock['purpose'],
  ): WorkflowLock {
    const timestamp = now()
    return {
      ownerId,
      runId,
      leaseId: randomUUID(),
      processId: process.pid,
      purpose,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    }
  }

  async function writeExclusiveLease(
    runId: string,
    purpose: WorkflowLock['purpose'],
  ): Promise<WorkflowLock> {
    const lease = createLease(runId, purpose)
    await mkdir(filePaths.directory, { recursive: true })
    try {
      await writeFile(filePaths.lock, `${JSON.stringify(lease)}\n`, {
        flag: 'wx',
      })
    } catch {
      throw new WorkflowStoreError('workflow project is locked', 'locked')
    }
    return lease
  }

  async function acquireMutationLease(runId: string): Promise<WorkflowLock> {
    while (true) {
      try {
        return await enqueueMutation(filePaths.lock, () =>
          writeExclusiveLease(runId, 'mutation'),
        )
      } catch (error) {
        if (!(error instanceof WorkflowStoreError) || error.code !== 'locked')
          throw error
        let active: WorkflowLock
        try {
          active = parseLock(JSON.parse(await readFile(filePaths.lock, 'utf8')))
        } catch (readError) {
          if (isMissingFile(readError)) continue
          throw error
        }
        const ownerProcessAlive = processIsAlive(active.processId)
        if (ownerProcessAlive && active.purpose === 'recovery') throw error
        if (!ownerProcessAlive) {
          try {
            await enqueueMutation(filePaths.lock, async () => {
              const current = parseLock(
                JSON.parse(await readFile(filePaths.lock, 'utf8')),
              )
              if (
                current.leaseId === active.leaseId &&
                current.processId === active.processId
              )
                await unlink(filePaths.lock)
            })
          } catch (reclaimError) {
            if (!isMissingFile(reclaimError)) throw reclaimError
          }
          continue
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  async function acquireReadableLease(runId: string): Promise<WorkflowLock> {
    while (true) {
      try {
        return await acquireMutationLease(runId)
      } catch (error) {
        if (!(error instanceof WorkflowStoreError) || error.code !== 'locked')
          throw error
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  async function mutationLock(runId: string): Promise<WorkflowLock> {
    return acquireMutationLease(runId)
  }

  async function assertMutationLease(
    runId: string,
    lease?: WorkflowLock,
  ): Promise<void> {
    let active: WorkflowLock
    try {
      active = parseLock(JSON.parse(await readFile(filePaths.lock, 'utf8')))
    } catch (error) {
      if (isMissingFile(error)) {
        if (!lease) return
        throw new WorkflowStoreError('workflow lock is missing', 'locked')
      }
      throw new WorkflowStoreError('workflow project is locked', 'locked')
    }
    if (!lease)
      throw new WorkflowStoreError('workflow project is locked', 'locked')
    if (
      active.ownerId !== ownerId ||
      active.runId !== runId ||
      active.leaseId !== lease.leaseId ||
      active.processId !== lease.processId ||
      lease.processId !== process.pid
    )
      throw new WorkflowStoreError(
        'workflow lock ownership mismatch',
        'ownership',
      )
  }

  async function runMutation<T>(
    runId: string,
    lease: WorkflowLock | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const ownedLease = lease ?? (await acquireMutationLease(runId))
    try {
      return await enqueueMutation(filePaths.snapshot, async () => {
        await assertMutationLease(runId, ownedLease)
        return operation()
      })
    } finally {
      if (!lease) await unlock(ownedLease)
    }
  }

  async function readEventsUnlocked(): Promise<WorkflowEvent[]> {
    let content: string
    try {
      content = await readFile(filePaths.events, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return []
      throw storageReadError(filePaths.events, error)
    }
    try {
      return content
        .split('\n')
        .filter(Boolean)
        .map(line => parseWorkflowEvent(JSON.parse(line)))
    } catch (error) {
      throw new WorkflowStoreError(
        `workflow event journal is invalid at ${filePaths.events}: ${error instanceof Error ? error.message : String(error)}`,
        'invalid',
      )
    }
  }

  async function appendEventUnlocked(
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
  ): Promise<WorkflowEvent> {
    const record = parseWorkflowEvent({
      ...event,
      eventId: event.eventId ?? randomUUID(),
      createdAt: event.createdAt ?? now(),
    })
    const existing = await readEventsUnlocked()
    if (existing.some(candidate => candidate.eventId === record.eventId))
      return existing.find(candidate => candidate.eventId === record.eventId)!
    await durableAppend(filePaths.events, `${JSON.stringify(record)}\n`)
    return record
  }

  async function loadUnlocked(): Promise<DeliveryRun | null> {
    let snapshotText: string
    try {
      snapshotText = await readFile(filePaths.snapshot, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return null
      throw storageReadError(filePaths.snapshot, error)
    }
    let value: unknown
    try {
      value = JSON.parse(snapshotText) as unknown
    } catch (error) {
      throw new WorkflowStoreError(
        `workflow snapshot JSON is invalid at ${filePaths.snapshot}: ${error instanceof Error ? error.message : String(error)}`,
        'invalid',
      )
    }
    let run: DeliveryRun
    const snapshotVersion =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).schemaVersion
        : undefined
    if (
      typeof snapshotVersion === 'number' &&
      Number.isInteger(snapshotVersion) &&
      snapshotVersion < DELIVERY_RUN_SCHEMA_VERSION
    ) {
      throw new WorkflowStoreError(
        `workflow snapshot schema version ${snapshotVersion} is obsolete; start a new workflow with schema version ${DELIVERY_RUN_SCHEMA_VERSION}`,
        'obsolete',
      )
    }
    if (
      typeof snapshotVersion === 'number' &&
      Number.isInteger(snapshotVersion) &&
      snapshotVersion > DELIVERY_RUN_SCHEMA_VERSION
    )
      throw new WorkflowStoreError(
        `workflow snapshot schema version ${snapshotVersion} is newer than current version ${DELIVERY_RUN_SCHEMA_VERSION}`,
        'invalid',
      )
    try {
      run = parseDeliveryRun(value)
    } catch (error) {
      throw new WorkflowStoreError(
        `workflow snapshot schema is invalid at ${filePaths.snapshot}: ${error instanceof Error ? error.message : String(error)}`,
        'invalid',
      )
    }
    if (run.ownerId !== ownerId)
      throw new WorkflowStoreError('workflow ownership mismatch', 'ownership')
    if (run.pendingEvents?.length) {
      // Journal replay failures are operational failures, not malformed
      // snapshots. Keep the marker so the next load can retry safely.
      for (const event of run.pendingEvents) await appendEventUnlocked(event)
      const { pendingEvents: _pendingEvents, ...withoutPendingEvents } = run
      await durableWrite(
        filePaths.snapshot,
        `${JSON.stringify(withoutPendingEvents, null, 2)}\n`,
      )
      run = withoutPendingEvents
    }
    return run
  }

  async function load(lease?: WorkflowLock): Promise<DeliveryRun | null> {
    let runId = lease?.runId ?? 'unknown'
    if (!lease)
      try {
        const raw = JSON.parse(
          await readFile(filePaths.snapshot, 'utf8'),
        ) as Record<string, unknown>
        if (typeof raw.runId === 'string') runId = raw.runId
      } catch (error) {
        if (isMissingFile(error)) return null
      }
    if (lease) return runMutation(runId, lease, loadUnlocked)
    const readLease = await acquireReadableLease(runId)
    try {
      return await runMutation(runId, readLease, loadUnlocked)
    } finally {
      await unlock(readLease)
    }
  }

  async function inspectSnapshot(): Promise<WorkflowSnapshotInspection> {
    return inspectWorkflowSnapshot({
      snapshotPath: filePaths.snapshot,
      ownerId,
    })
  }

  async function saveUnlocked(
    run: DeliveryRun,
    touchUpdatedAt = true,
    preservePendingEvents = true,
    allowDispatchCompletion = false,
  ): Promise<DeliveryRun> {
    if (run.ownerId !== ownerId)
      throw new WorkflowStoreError('workflow ownership mismatch', 'ownership')
    let parsed = parseDeliveryRun({
      ...run,
      updatedAt: touchUpdatedAt ? now() : run.updatedAt,
    })
    assertDeliveryRunInvariants(parsed)
    let existing: DeliveryRun | undefined
    let existingSnapshot: string | undefined
    try {
      existingSnapshot = await readFile(filePaths.snapshot, 'utf8')
    } catch (error) {
      if (!isMissingFile(error)) {
        throw storageReadError(filePaths.snapshot, error)
      }
    }
    if (existingSnapshot !== undefined) {
      try {
        existing = parseDeliveryRun(JSON.parse(existingSnapshot) as unknown)
      } catch {
        // A malformed existing snapshot can be replaced by an explicit
        // recovery snapshot; the caller must not inherit its invalid shape.
      }
    }
    if (existing) {
      if (existing.ownerId !== ownerId)
        throw new WorkflowStoreError('workflow ownership mismatch', 'ownership')
      if (existing.runId === parsed.runId) {
        if (
          !allowDispatchCompletion &&
          existing.activeDispatch?.dispatchId ===
            parsed.activeDispatch?.dispatchId &&
          existing.activeDispatch?.status !== 'running' &&
          parsed.activeDispatch?.status === 'completed'
        ) {
          throw new WorkflowStoreError(
            'workflow snapshot changed while dispatch was completing',
            'locked',
          )
        }
        const usage = mergeUsage(existing.usage, parsed.usage)
        if (usage) parsed = parseDeliveryRun({ ...parsed, usage })
        if (
          preservePendingEvents &&
          existing.pendingEvents &&
          !parsed.pendingEvents
        ) {
          parsed = parseDeliveryRun({
            ...parsed,
            pendingEvents: existing.pendingEvents,
          })
        }
      }
    }
    assertDeliveryRunInvariants(parsed)
    await durableWrite(
      filePaths.snapshot,
      `${JSON.stringify(parsed, null, 2)}\n`,
    )
    return parsed
  }

  async function save(
    run: DeliveryRun,
    lease?: WorkflowLock,
  ): Promise<DeliveryRun> {
    return runMutation(run.runId, lease, () => saveUnlocked(run))
  }

  async function appendEvent(
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
    lease?: WorkflowLock,
  ): Promise<WorkflowEvent> {
    const record = parseWorkflowEvent({
      ...event,
      eventId: event.eventId ?? randomUUID(),
      createdAt: event.createdAt ?? now(),
    })
    return runMutation(record.runId, lease, () => appendEventUnlocked(record))
  }

  async function persistCommitUnlocked(
    run: DeliveryRun,
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
    acceptedUnits: AcceptedWorkflowUnit[],
    previous: DeliveryRun | null,
    events: WorkflowEvent[],
  ): Promise<DeliveryRun> {
    const createdAt = event.createdAt ?? now()
    const ordinaryEventBase = {
      ...event,
      runId: run.runId,
      phase: run.phase,
      status: run.status,
      revision: run.revision,
      eventId: event.eventId ?? randomUUID(),
      createdAt,
    }
    const runEvents = events.filter(event => event.runId === run.runId)
    const frozenEvents = runEvents.filter(isFrozenWorkflowStageCardEvent)
    const stageStartedAt = previous
      ? lastStageBoundaryAt(previous.createdAt, frozenEvents)
      : undefined
    const stageSnapshot =
      previous && stageStartedAt
        ? freezePreviousStageCard({
            previous,
            next: run,
            workspacePath: resolve(workspacePath),
            stageStartedAt,
            stageEndedAt: createdAt,
            elapsedMs: activeElapsedWithinStage({
              events: runEvents,
              stageStartedAt,
              stageEndedAt: createdAt,
            }),
          })
        : undefined
    const ordinaryEvent = {
      ...ordinaryEventBase,
      // tasks.planned has a strict event schema; all other workflow events
      // retain the catch-all stage card extension.
      ...(stageSnapshot && event.type !== 'tasks.planned'
        ? { stageSnapshot }
        : {}),
    } as WorkflowEvent
    const stageSnapshotEvent =
      stageSnapshot && event.type === 'tasks.planned'
        ? ({
            ...ordinaryEventBase,
            eventId: randomUUID(),
            type: 'workflow.stage_snapshot',
            stageSnapshot,
          } as WorkflowEvent)
        : undefined
    const pendingEvents: WorkflowEvent[] = [
      ordinaryEvent,
      ...(stageSnapshotEvent ? [stageSnapshotEvent] : []),
      ...acceptedUnits.map(
        unit =>
          ({
            eventId: randomUUID(),
            runId: run.runId,
            type: 'workflow.unit.accepted',
            phase: unit.phase,
            status: run.status,
            revision: run.revision,
            createdAt: unit.acceptedAt,
            projectId: run.projectId,
            ownerId: run.ownerId,
            unit,
          }) satisfies WorkflowUnitAcceptedEvent,
      ),
    ]
    // The pending marker is written together with the new authoritative
    // snapshot, so there is no unjournaled state window.
    const saved = await saveUnlocked(
      { ...run, pendingEvents },
      true,
      false,
      true,
    )
    for (const pendingEvent of pendingEvents)
      await appendEventUnlocked(pendingEvent)
    const { pendingEvents: _pendingEvents, ...committed } = saved
    await saveUnlocked(committed, false, false, true)
    return committed
  }

  async function commitUnlocked(
    run: DeliveryRun,
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
    acceptedUnits: AcceptedWorkflowUnit[] = [],
  ): Promise<DeliveryRun> {
    // Read the authoritative previous run and journal before writing the new
    // snapshot. Stage card timing is derived only from this durable history,
    // so a write-ahead marker can be replayed without changing the boundary.
    const previous = await loadUnlocked()
    const events = await readEventsUnlocked()
    return persistCommitUnlocked(run, event, acceptedUnits, previous, events)
  }

  async function commit(
    run: DeliveryRun,
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
    acceptedUnits?: AcceptedWorkflowUnit[],
    lease?: WorkflowLock,
  ): Promise<DeliveryRun> {
    return runMutation(run.runId, lease, () =>
      commitUnlocked(run, event, acceptedUnits),
    )
  }

  async function replaceSnapshotIfDigest(input: {
    expectedDigest: string
    run: DeliveryRun
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>
    acceptedUnits?: AcceptedWorkflowUnit[]
    lease?: WorkflowLock
  }): Promise<DeliveryRun> {
    return runMutation(input.run.runId, input.lease, async () => {
      let source: string
      try {
        source = await readFile(filePaths.snapshot, 'utf8')
      } catch (error) {
        if (isMissingFile(error))
          throw new WorkflowStoreError(
            'workflow snapshot disappeared before expected-digest replacement',
            'recovery_snapshot_changed',
          )
        throw storageReadError(filePaths.snapshot, error)
      }
      const currentDigest = createHash('sha256').update(source).digest('hex')
      if (currentDigest !== input.expectedDigest) {
        let current: DeliveryRun
        try {
          current = parseDeliveryRun(JSON.parse(source) as unknown)
        } catch {
          throw new WorkflowStoreError(
            'workflow snapshot changed before expected-digest replacement',
            'recovery_snapshot_changed',
          )
        }
        if (
          isDeepStrictEqual(
            JSON.parse(source) as unknown,
            JSON.parse(
              JSON.stringify({ ...input.run, updatedAt: current.updatedAt }),
            ) as unknown,
          )
        )
          return current
        throw new WorkflowStoreError(
          'workflow snapshot changed before expected-digest replacement',
          'recovery_snapshot_changed',
        )
      }
      // A recovery replacement may intentionally target malformed or obsolete
      // JSON. Only replay a previous run when the expected source parses;
      // otherwise persist against an empty previous snapshot context.
      let previous: DeliveryRun | null = null
      let sourceParses = false
      try {
        parseDeliveryRun(JSON.parse(source) as unknown)
        sourceParses = true
      } catch {
        // The expected digest authorizes replacing an unreadable snapshot.
      }
      if (sourceParses) previous = await loadUnlocked()
      const events = await readEventsUnlocked()
      return persistCommitUnlocked(
        input.run,
        input.event,
        input.acceptedUnits ?? [],
        previous,
        events,
      )
    })
  }

  async function readEvents(afterEventId?: string): Promise<WorkflowEvent[]> {
    const records = await readEventsUnlocked()
    if (!afterEventId) return records
    const index = records.findIndex(record => record.eventId === afterEventId)
    return index < 0 ? records : records.slice(index + 1)
  }

  async function lock(
    runId: string,
    sessionIsOpen: () => Promise<boolean> = async () => true,
  ): Promise<WorkflowLock> {
    while (true) {
      try {
        return await enqueueMutation(filePaths.lock, async () => {
          try {
            const existing = parseLock(
              JSON.parse(await readFile(filePaths.lock, 'utf8')),
            )
            if (existing.purpose === 'mutation')
              throw new WorkflowStoreError(
                'workflow project is locked',
                'locked',
              )
            if (
              existing.ownerId !== ownerId ||
              existing.runId !== runId ||
              processIsAlive(existing.processId) ||
              (await sessionIsOpen())
            )
              throw new WorkflowStoreError(
                'workflow project is locked',
                'locked',
              )
            // A recovery lease is reclaimable only when its exact owner process
            // is dead and the associated worker session is proven closed.
            await unlink(filePaths.lock)
          } catch (error) {
            if (error instanceof WorkflowStoreError) throw error
            if (!isMissingFile(error))
              throw new WorkflowStoreError(
                'workflow project is locked',
                'locked',
              )
          }
          return writeExclusiveLease(runId, 'recovery')
        })
      } catch (error) {
        if (!(error instanceof WorkflowStoreError) || error.code !== 'locked')
          throw error
        let active: WorkflowLock
        try {
          active = parseLock(JSON.parse(await readFile(filePaths.lock, 'utf8')))
        } catch (readError) {
          if (isMissingFile(readError)) continue
          throw error
        }
        if (active.purpose === 'recovery') throw error
        if (!processIsAlive(active.processId)) {
          try {
            await enqueueMutation(filePaths.lock, async () => {
              const current = parseLock(
                JSON.parse(await readFile(filePaths.lock, 'utf8')),
              )
              if (
                current.leaseId === active.leaseId &&
                current.processId === active.processId &&
                current.purpose === 'mutation'
              )
                await unlink(filePaths.lock)
            })
          } catch (reclaimError) {
            if (!isMissingFile(reclaimError)) throw reclaimError
          }
          continue
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  async function heartbeat(lease: WorkflowLock): Promise<WorkflowLock> {
    return enqueueMutation(filePaths.lock, async () => {
      let value: WorkflowLock
      try {
        value = parseLock(JSON.parse(await readFile(filePaths.lock, 'utf8')))
      } catch {
        throw new WorkflowStoreError('workflow lock is missing', 'locked')
      }
      if (
        value.ownerId !== ownerId ||
        value.runId !== lease.runId ||
        value.leaseId !== lease.leaseId ||
        value.processId !== lease.processId ||
        lease.processId !== process.pid
      )
        throw new WorkflowStoreError(
          'workflow lock ownership mismatch',
          'ownership',
        )
      const updated = { ...value, heartbeatAt: now() }
      await durableWrite(filePaths.lock, `${JSON.stringify(updated)}\n`)
      return updated
    })
  }

  async function unlock(lease: WorkflowLock): Promise<void> {
    return enqueueMutation(filePaths.lock, async () => {
      let value: WorkflowLock
      try {
        value = parseLock(JSON.parse(await readFile(filePaths.lock, 'utf8')))
      } catch {
        throw new WorkflowStoreError('workflow lock is missing', 'locked')
      }
      if (
        value.ownerId !== ownerId ||
        value.runId !== lease.runId ||
        value.leaseId !== lease.leaseId ||
        value.processId !== lease.processId ||
        lease.processId !== process.pid
      )
        throw new WorkflowStoreError(
          'workflow lock ownership mismatch',
          'ownership',
        )
      await unlink(filePaths.lock)
    })
  }

  async function reconcile(
    sessionIsOpen: (dispatch: DispatchRecord) => Promise<boolean> = async () =>
      false,
    lease?: WorkflowLock,
  ): Promise<DeliveryRun | null> {
    const inspection = await inspectSnapshot()
    if (!inspection.currentRun) return load(lease)
    const runId = lease?.runId ?? inspection.currentRun.runId
    return runMutation(runId, lease, async () => {
      const run = await loadUnlocked()
      if (!run) return run
      if (run.foundationAuditState) {
        const tasks = run.foundationAuditState.tasks
        const staleTerminalTasks =
          run.status !== 'running'
            ? foundationRuntimeTasks(run.foundationAuditState).filter(
                task => task.status === 'running' && task.dispatch?.status === 'running',
              )
            : []
        if (staleTerminalTasks.length) {
          const blockedReason =
            run.blockedReason ??
            'foundation workflow requires action after recovery'
          const staleTaskIds = new Set(
            staleTerminalTasks.map(task => task.taskId),
          )
          const nextState = {
            ...run.foundationAuditState,
            tasks: tasks.map(task => {
              if (!staleTaskIds.has(task.taskId) || !task.dispatch)
                return task
              const interruptedDispatch = {
                ...task.dispatch,
                status: 'interrupted' as const,
                finishedAt: now(),
                failureReason: blockedReason,
              }
              return projectTaskTerminalEvidence(
                {
                  ...task,
                  status: 'needs_action' as const,
                  failureReason: blockedReason,
                  dispatch: interruptedDispatch,
                },
                interruptedDispatch,
              )
            }),
          }
          const recovered = {
            ...run,
            status: 'needs_action' as const,
            thinking: 'idle' as const,
            blockedReason,
            foundationAuditState: nextState,
          }
          return commitUnlocked(recovered, {
            runId: recovered.runId,
            type: 'foundation.recovery.needs_action',
            phase: recovered.phase,
            status: recovered.status,
            revision: recovered.revision,
            reason: blockedReason,
          })
        }
        const runtimeTaskIds = new Set(foundationRuntimeTasks(run.foundationAuditState).map(task => task.taskId))
        const runningTasks = tasks.filter(task => runtimeTaskIds.has(task.taskId) && task.status === 'running')
        if (runningTasks.length > 4)
          throw new WorkflowStoreError('foundation recovery exceeds the four-worker limit', 'conflict')
        for (const task of tasks) {
          if (!runtimeTaskIds.has(task.taskId)) continue
          const dispatch = task.dispatch
          if (!dispatch) continue
          const request = dispatch.request
          const contract = request?.contract
          const contractRecord =
            contract && typeof contract === 'object' ? contract : undefined
          if (
            dispatch.taskId !== task.taskId ||
            dispatch.revision !== task.revision ||
            (typeof request?.taskId === 'string' && request.taskId !== task.taskId) ||
            (typeof request?.revision === 'string' && request.revision !== task.revision) ||
            (contractRecord &&
              'packetDigest' in contractRecord &&
              contractRecord.packetDigest !== task.packetDigest) ||
            (contractRecord &&
              isFoundationRevisionTask(task) &&
              (contractRecord.packetDigest !== task.packetDigest ||
                contractRecord.packetPath !== task.packetPath ||
                contractRecord.round !== task.round))
          )
            throw new WorkflowStoreError('foundation recovery dispatch identity is inconsistent', 'conflict')
        }
        const unavailable: typeof tasks = []
        for (const task of runningTasks) {
          if (!task.dispatch) continue
          if (!(await sessionIsOpen(task.dispatch))) unavailable.push(task)
        }
        if (unavailable.length) {
          const nextState = {
            ...run.foundationAuditState,
            tasks: tasks.map(task => {
              if (!unavailable.some(item => item.taskId === task.taskId)) return task
              const hasPersistedTerminal = Boolean(task.dispatch?.terminalResult)
              const failureReason = isFoundationRevisionTask(task)
                ? 'server stopped before the foundation revision terminal was admitted'
                : 'server stopped before the foundation fact terminal was admitted'
              const terminal = task.dispatch
                ? {
                    ...task.dispatch,
                    status: hasPersistedTerminal
                      ? ('completed' as const)
                      : ('interrupted' as const),
                    finishedAt: now(),
                    ...(hasPersistedTerminal ? {} : { failureReason }),
                  }
                : undefined
              const recovered = {
                ...task,
                // A terminal envelope is durable evidence for controller
                // replay. Keep the business task running until admission has
                // written its immutable receipt under the controller lock.
                status: hasPersistedTerminal
                  ? ('running' as const)
                  : isFoundationRevisionTask(task) || task.attempt < 2
                    ? ('retryable' as const)
                    : ('needs_action' as const),
                dispatch: terminal,
                ...(hasPersistedTerminal ? {} : { failureReason }),
              }
              return terminal ? projectTaskTerminalEvidence(recovered, terminal) : recovered
            }),
          }
          const nextStatus = foundationNeedsAction({ ...run, foundationAuditState: nextState }) ? 'needs_action' as const : 'running' as const
          const eventType = isFoundationRevisionStatus(run.foundationAuditState.status)
            ? 'foundation.revision.recovered'
            : 'foundation.fact.recovered'
          return commitUnlocked({ ...run, foundationAuditState: nextState, status: nextStatus, blockedReason: nextStatus === 'needs_action' ? run.blockedReason ?? 'foundation workflow requires action after recovery' : undefined, thinking: nextStatus === 'running' ? 'working' : 'idle' }, { runId: run.runId, type: eventType, phase: run.phase, status: nextStatus, revision: run.revision })
        }
      }
      if (!run.activeDispatch || run.activeDispatch.status !== 'running') {
        if (run.status !== 'running' || !foundationNeedsAction(run)) return run
        const recovered = {
          ...run,
          status: 'needs_action' as const,
          thinking: 'idle' as const,
          blockedReason: run.blockedReason ?? 'foundation workflow requires action after recovery',
        }
        return commitUnlocked(recovered, {
          runId: recovered.runId,
          type: 'foundation.recovery.needs_action',
          phase: recovered.phase,
          status: recovered.status,
          revision: recovered.revision,
          reason: recovered.blockedReason,
        })
      }
      if (await sessionIsOpen(run.activeDispatch)) return run
      const interrupted = {
        ...run,
        status: 'stopped' as const,
        thinking: 'idle' as const,
        blockedReason:
          'server stopped before the active worker produced a terminal result',
        activeDispatch: {
          ...run.activeDispatch,
          status: 'interrupted' as const,
          finishedAt: now(),
          failureReason:
            'server stopped before the active worker produced a terminal result',
        },
      }
      return commitUnlocked(interrupted, {
        runId: interrupted.runId,
        type: 'run.stopped',
        phase: interrupted.phase,
        status: interrupted.status,
        revision: interrupted.revision,
        dispatchId: interrupted.activeDispatch?.dispatchId,
        reason: interrupted.blockedReason,
      })
    })
  }

  async function addWorkflowUsage(
    runId: string,
    delta: WorkflowUsage,
    dispatchId: string,
  ): Promise<DeliveryRun | null> {
    return runMutation(runId, undefined, async () => {
      const run = await loadUnlocked()
      if (!run || run.runId !== runId) return run
      const usageDispatch =
        run.activeDispatch?.dispatchId === dispatchId
          ? run.activeDispatch
          : run.foundationDraftState.documents?.find(
              document => document.dispatch?.dispatchId === dispatchId,
            )?.dispatch
          ?? (run.foundationAuditState ? foundationRuntimeTasks(run.foundationAuditState).find(
              task => task.dispatch?.dispatchId === dispatchId,
          )?.dispatch : undefined)
      const acceptsRunningUsage =
        run.status === 'running' && usageDispatch?.status === 'running'
      const acceptsStoppedTailUsage =
        run.status === 'stopped' && usageDispatch?.status === 'interrupted'
      // Usage is emitted by the worker stream independently from terminal
      // admission. A terminal commit can win the storage lane before the
      // last usage callback acquires it, so accept that dispatch's durable
      // tail after terminal admission as well. Unknown dispatches remain a
      // strict no-op (the caller can distinguish them from a missing run).
      const acceptsTerminalUsage =
        usageDispatch !== undefined &&
        ['completed', 'failed', 'blocked', 'invalid'].includes(
          usageDispatch.status,
        )
      if (
        !usageDispatch ||
        (!acceptsRunningUsage &&
          !acceptsStoppedTailUsage &&
          !acceptsTerminalUsage)
      )
        return null
      const events = await readEventsUnlocked()
      const journalUsage = journalUsageHighWater(events)
      const dispatchUsage = addUsage(usageDispatch.usage, delta)
      const runWithDispatchUsage = withDispatchUsage(
        run,
        dispatchId,
        dispatchUsage,
      )
      const next = {
        ...runWithDispatchUsage,
        usage: addUsage(mergeUsage(run.usage, journalUsage), delta),
      }
      return persistCommitUnlocked(
        next,
        {
          runId: next.runId,
          type: 'usage.updated',
          phase: next.phase,
          status: next.status,
          revision: next.revision,
          usage: next.usage,
          dispatchId,
          dispatchUsage,
        },
        [],
        run,
        events,
      )
    })
  }

  async function updateProgress(
    runId: string,
    progress: {
      message?: string
      thinking?: DeliveryRun['thinking']
      workerType?: string
      dispatchId?: string
      currentItemId?: string | null
      /** False for UI activity that did not change durable workflow facts. */
      durable?: boolean
    },
  ): Promise<DeliveryRun | null> {
    return runMutation(runId, undefined, async () => {
      const run = await loadUnlocked()
      if (!run || run.runId !== runId) return run
      const progressDispatch = progress.dispatchId
        ? run.activeDispatch?.dispatchId === progress.dispatchId
          ? run.activeDispatch
          : run.foundationDraftState.documents?.find(
              document => document.dispatch?.dispatchId === progress.dispatchId,
            )?.dispatch
            ?? (run.foundationAuditState ? foundationRuntimeTasks(run.foundationAuditState).find(
              task => task.dispatch?.dispatchId === progress.dispatchId,
            )?.dispatch : undefined)
        : undefined
      if (
        progress.dispatchId &&
        (run.status !== 'running' || progressDispatch?.status !== 'running')
      )
        return run
      if (
        progress.dispatchId &&
        progressDispatch?.dispatchId !== progress.dispatchId
      )
        return run
      const message = progress.message
        ? sanitizeWorkflowDisplayMessage(progress.message)
        : ''
      const next = {
        ...run,
        ...(progress.durable === false ? {} : { lastProgressAt: now() }),
        ...(message ? { currentMessage: message } : {}),
        ...(progress.thinking ? { thinking: progress.thinking } : {}),
        ...(progress.currentItemId === null
          ? { currentItemId: undefined }
          : progress.currentItemId
            ? { currentItemId: progress.currentItemId }
            : {}),
      }
      return commitUnlocked(next, {
        runId: next.runId,
        type: 'workflow.progress',
        phase: next.phase,
        status: next.status,
        revision: next.revision,
        ...(message ? { message } : {}),
        ...(progress.thinking ? { thinking: progress.thinking } : {}),
        ...(progress.workerType ? { workerType: progress.workerType } : {}),
        ...(progress.dispatchId ? { dispatchId: progress.dispatchId } : {}),
        ...(progress.currentItemId !== undefined
          ? { currentItemId: progress.currentItemId }
          : {}),
        ...(progress.durable !== undefined
          ? { durableProgress: progress.durable }
          : {}),
      })
    })
  }

  return {
    workspacePath: resolve(workspacePath),
    ownerId,
    paths: filePaths,
    inspectWorkflowSnapshot: inspectSnapshot,
    load,
    save,
    commit,
    replaceSnapshotIfDigest,
    appendEvent,
    readEvents,
    lock,
    mutationLock,
    heartbeat,
    unlock,
    reconcile,
    addWorkflowUsage,
    updateProgress,
  }
}

export type RunStore = ReturnType<typeof createRunStore>
