import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { parseDeliveryRun } from './schema'
import { assertDeliveryRunInvariants } from './transition'
import type {
  DeliveryRun,
  DispatchRecord,
  WorkflowEvent,
  WorkflowUsage,
} from './types'
import { sanitizeWorkflowDisplayMessage } from './workflow-display-message'

export type { WorkflowEvent } from './types'

export type WorkflowLock = {
  ownerId: string
  runId: string
  acquiredAt: string
  heartbeatAt: string
}

export class WorkflowStoreError extends Error {
  constructor(
    message: string,
    readonly code: 'ownership' | 'locked' | 'invalid' | 'io' | 'conflict',
  ) {
    super(message)
    this.name = 'WorkflowStoreError'
  }
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
  confirmedBriefContext?: string
  parentRunId?: string
  documentRevision?: string
  workspaceRevision?: string
}): DeliveryRun {
  const timestamp = now()
  return {
    schemaVersion: 1,
    runId: input.runId ?? randomUUID(),
    projectId: input.projectId,
    ownerId: input.ownerId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    confirmedBriefDigest: input.confirmedBriefDigest,
    ...(input.confirmedBriefContext
      ? { confirmedBriefContext: input.confirmedBriefContext }
      : {}),
    phase: 'BRIEF_CONFIRMED',
    status: 'running',
    lastProgressAt: timestamp,
    revision: {
      document: input.documentRevision ?? 'uncomputed',
      workspace: input.workspaceRevision ?? 'uncomputed',
    },
    tasks: [],
    evidence: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createRunStore(workspacePath: string, ownerId: string) {
  const filePaths = paths(workspacePath)

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
        .map(line => JSON.parse(line) as WorkflowEvent)
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
    const record = {
      ...event,
      eventId: event.eventId ?? randomUUID(),
      createdAt: event.createdAt ?? now(),
    } as WorkflowEvent
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
    let shouldRewriteCanonicalSnapshot =
      JSON.stringify(value) !== JSON.stringify(run)
    if (run.pendingEvent) {
      // Journal replay failures are operational failures, not malformed
      // snapshots. Keep the marker so the next load can retry safely.
      await appendEventUnlocked(run.pendingEvent)
      const { pendingEvent: _pendingEvent, ...withoutPendingEvent } = run
      await durableWrite(
        filePaths.snapshot,
        `${JSON.stringify(withoutPendingEvent, null, 2)}\n`,
      )
      run = withoutPendingEvent
      shouldRewriteCanonicalSnapshot = false
    }
    if (shouldRewriteCanonicalSnapshot)
      await durableWrite(
        filePaths.snapshot,
        `${JSON.stringify(run, null, 2)}\n`,
      )
    return run
  }

  async function load(): Promise<DeliveryRun | null> {
    return enqueueMutation(filePaths.snapshot, loadUnlocked)
  }

  async function saveUnlocked(
    run: DeliveryRun,
    touchUpdatedAt = true,
    preservePendingEvent = true,
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
          preservePendingEvent &&
          existing.pendingEvent &&
          !parsed.pendingEvent
        ) {
          parsed = parseDeliveryRun({
            ...parsed,
            pendingEvent: existing.pendingEvent,
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

  async function save(run: DeliveryRun): Promise<DeliveryRun> {
    return enqueueMutation(filePaths.snapshot, () => saveUnlocked(run))
  }

  async function appendEvent(
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
  ): Promise<WorkflowEvent> {
    return enqueueMutation(filePaths.snapshot, () => appendEventUnlocked(event))
  }

  async function commitUnlocked(
    run: DeliveryRun,
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
  ): Promise<DeliveryRun> {
    // Recover a previous marker before replacing the snapshot. This keeps a
    // failed append retryable and prevents a later commit from overwriting
    // an event that was waiting for journal recovery.
    await loadUnlocked()
    const pendingEvent = {
      ...event,
      runId: run.runId,
      phase: run.phase,
      status: run.status,
      revision: run.revision,
      eventId: event.eventId ?? randomUUID(),
      createdAt: event.createdAt ?? now(),
    } as WorkflowEvent
    // The pending marker is written together with the new authoritative
    // snapshot, so there is no unjournaled state window.
    const saved = await saveUnlocked(
      { ...run, pendingEvent },
      true,
      false,
      true,
    )
    await appendEventUnlocked(pendingEvent)
    const { pendingEvent: _pendingEvent, ...committed } = saved
    await saveUnlocked(committed, false, false, true)
    return committed
  }

  async function commit(
    run: DeliveryRun,
    event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
      Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
  ): Promise<DeliveryRun> {
    return enqueueMutation(filePaths.snapshot, () => commitUnlocked(run, event))
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
    const timestamp = now()
    try {
      const existing = JSON.parse(
        await readFile(filePaths.lock, 'utf8'),
      ) as WorkflowLock
      if (
        existing.ownerId !== ownerId ||
        existing.runId !== runId ||
        (await sessionIsOpen())
      ) {
        throw new WorkflowStoreError('workflow project is locked', 'locked')
      }
      // A process may have exited after acquiring the lock. Once the caller
      // has confirmed that the associated worker is closed, the stale lock is
      // recoverable; leaving it in place would make resume permanently fail.
      await unlink(filePaths.lock)
    } catch (error) {
      if (error instanceof WorkflowStoreError) throw error
    }
    const value: WorkflowLock = {
      ownerId,
      runId,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    }
    try {
      await writeFile(filePaths.lock, `${JSON.stringify(value)}\n`, {
        flag: 'wx',
      })
    } catch {
      throw new WorkflowStoreError('workflow project is locked', 'locked')
    }
    return value
  }

  async function heartbeat(runId: string): Promise<WorkflowLock> {
    let value: WorkflowLock
    try {
      value = JSON.parse(await readFile(filePaths.lock, 'utf8')) as WorkflowLock
    } catch {
      throw new WorkflowStoreError('workflow lock is missing', 'locked')
    }
    if (value.ownerId !== ownerId || value.runId !== runId)
      throw new WorkflowStoreError(
        'workflow lock ownership mismatch',
        'ownership',
      )
    const updated = { ...value, heartbeatAt: now() }
    await durableWrite(filePaths.lock, `${JSON.stringify(updated)}\n`)
    return updated
  }

  async function unlock(runId: string): Promise<void> {
    try {
      const value = JSON.parse(
        await readFile(filePaths.lock, 'utf8'),
      ) as WorkflowLock
      if (value.ownerId !== ownerId || value.runId !== runId)
        throw new WorkflowStoreError(
          'workflow lock ownership mismatch',
          'ownership',
        )
      await unlink(filePaths.lock)
    } catch (error) {
      if (error instanceof WorkflowStoreError) throw error
    }
  }

  async function reconcile(
    sessionIsOpen: (dispatch: DispatchRecord) => Promise<boolean> = async () =>
      false,
  ): Promise<DeliveryRun | null> {
    const run = await load()
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
    return commit(interrupted, {
      runId: interrupted.runId,
      type: 'run.stopped',
      phase: interrupted.phase,
      status: interrupted.status,
      revision: interrupted.revision,
      dispatchId: interrupted.activeDispatch?.dispatchId,
      reason: interrupted.blockedReason,
    })
  }

  async function updateUsage(
    runId: string,
    usage: WorkflowUsage,
  ): Promise<DeliveryRun | null> {
    return enqueueMutation(filePaths.snapshot, async () => {
      const run = await loadUnlocked()
      if (!run || run.runId !== runId) return run
      return commitUnlocked(
        { ...run, usage },
        {
          runId: run.runId,
          type: 'usage.updated',
          phase: run.phase,
          status: run.status,
          revision: run.revision,
          usage,
        },
      )
    })
  }

  async function addWorkflowUsage(
    runId: string,
    delta: WorkflowUsage,
  ): Promise<DeliveryRun | null> {
    return enqueueMutation(filePaths.snapshot, async () => {
      const run = await loadUnlocked()
      if (!run || run.runId !== runId) return run
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
      reviewedDocumentPath?: string
      /** False for UI activity that did not change durable workflow facts. */
      durable?: boolean
    },
  ): Promise<DeliveryRun | null> {
    return enqueueMutation(filePaths.snapshot, async () => {
      const run = await loadUnlocked()
      if (!run || run.runId !== runId) return run
      if (
        progress.dispatchId &&
        run.activeDispatch?.dispatchId !== progress.dispatchId
      )
        return run
      const message = progress.message
        ? sanitizeWorkflowDisplayMessage(progress.message)
        : ''
      const reviewedDocumentPaths = progress.reviewedDocumentPath
        ? [
            ...new Set([
              ...(run.reviewedDocumentPaths ?? []),
              progress.reviewedDocumentPath,
            ]),
          ]
        : run.reviewedDocumentPaths
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
        ...(reviewedDocumentPaths ? { reviewedDocumentPaths } : {}),
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
    load,
    save,
    commit,
    appendEvent,
    readEvents,
    lock,
    heartbeat,
    unlock,
    reconcile,
    updateUsage,
    addWorkflowUsage,
    updateProgress,
  }
}

export type RunStore = ReturnType<typeof createRunStore>
