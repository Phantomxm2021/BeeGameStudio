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

/** Read and classify run.json without migrating, flushing markers or rewriting it. */
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
        `unsupported workflow snapshot schema version ${snapshotVersion}; current version is ${DELIVERY_RUN_SCHEMA_VERSION}`,
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
    documentReviewState: {
      repairPasses: { foundation: 0, checklist: 0, resource: 0 },
    },
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
        `unsupported workflow snapshot schema version ${snapshotVersion}; current version is ${DELIVERY_RUN_SCHEMA_VERSION}`,
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
    acceptedUnits: AcceptedWorkflowUnit[] = [],
  ): Promise<DeliveryRun> {
    // Read the authoritative previous run and journal before writing the new
    // snapshot.  Stage card timing is derived only from this durable history,
    // so a write-ahead marker can be replayed without changing the boundary.
    const previous = await loadUnlocked()
    const events = await readEventsUnlocked()
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
    const frozenEvents = events.filter(isFrozenWorkflowStageCardEvent)
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
              events,
              stageStartedAt,
              stageEndedAt: createdAt,
            }),
          })
        : undefined
    const ordinaryEvent = {
      ...ordinaryEventBase,
      ...(stageSnapshot ? { stageSnapshot } : {}),
    } as WorkflowEvent
    const pendingEvents: WorkflowEvent[] = [
      ordinaryEvent,
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
    return persistCommitUnlocked(run, event, acceptedUnits)
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
      return persistCommitUnlocked(input.run, input.event, input.acceptedUnits)
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
      if (!run?.activeDispatch || run.activeDispatch.status !== 'running')
        return run
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
      if (
        run.status !== 'running' ||
        run.activeDispatch?.status !== 'running' ||
        run.activeDispatch.dispatchId !== dispatchId
      )
        return null
      const next = { ...run, usage: addUsage(run.usage, delta) }
      return commitUnlocked(next, {
        runId: next.runId,
        type: 'usage.updated',
        phase: next.phase,
        status: next.status,
        revision: next.revision,
        usage: next.usage,
      })
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
      if (
        progress.dispatchId &&
        (run.status !== 'running' || run.activeDispatch?.status !== 'running')
      )
        return run
      if (
        progress.dispatchId &&
        run.activeDispatch?.dispatchId !== progress.dispatchId
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
