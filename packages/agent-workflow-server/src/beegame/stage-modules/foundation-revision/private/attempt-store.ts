import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, link, unlink, readdir } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { z } from 'zod/v4'
import { acceptRevisionRequest, readRevisionRequestByHandle } from './request-store'
import { prepareRevisionRequest } from './request-preparation'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import { getLatestRevisionRuntimeUsage, type RevisionUsageEvent } from './native-usage'
import type { AcceptedRevisionWorkerOutput } from './worker-output'
import { compatibleRevisionBillingReceipts, revisionBillingReceiptSchema } from './usage-billing'
import { createRevisionExecutionReducer, revisionExecutionEventSchema as eventSchema, revisionObservationSchema,
  revisionSettlementSchema, revisionStopSchema, revisionResumeSchema, revisionLifecycleFailureSchema, type RevisionExecutionEvent as Event,
  type RevisionExecutionState as State, type RevisionStarted, type RevisionSettled } from './request-execution-state'

const MAX_EVENT_BYTES = 32 * 1024 * 1024
class RevisionExecutionConflict extends Error {
  constructor() { super('Revision request execution CAS conflict') }
}

async function assertDirectories(path: string): Promise<void> {
  let cursor = path
  while (cursor !== parse(cursor).root) {
    const stat = await lstat(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Revision attempt parent must be a real directory')
    cursor = dirname(cursor)
  }
}

async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await file.sync() } finally { await file.close() }
}

async function ensureChild(parent: string, name: string): Promise<string> {
  await assertDirectories(parent)
  const path = join(parent, name)
  try { await mkdir(path, { mode: 0o700 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  await assertDirectories(path)
  await syncDirectory(parent)
  return path
}

function eventName(index: number): string { return `${String(index).padStart(16, '0')}.json` }

async function readEvent(path: string): Promise<Event> {
  await assertDirectories(dirname(path))
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_EVENT_BYTES)
    throw new Error('Revision attempt event invalid size or kind')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_EVENT_BYTES) throw new Error('Revision attempt event invalid size or kind')
    const bytes = await file.readFile('utf8')
    if (Buffer.byteLength(bytes) > MAX_EVENT_BYTES) throw new Error('Revision attempt event too large')
    const event = eventSchema.parse(JSON.parse(bytes))
    if (bytes !== `${revisionCanonicalJson(event)}\n`) throw new Error('Revision attempt event is not canonical')
    return event
  } finally { await file.close() }
}

async function appendEvent(root: string, event: Event): Promise<Event> {
  const body = `${revisionCanonicalJson(event)}\n`
  if (Buffer.byteLength(body) > MAX_EVENT_BYTES) throw new Error('Revision attempt event too large')
  await assertDirectories(root)
  const temporary = join(root, `.pending-${randomUUID()}`)
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  let committed = event
  try {
    try { await file.writeFile(body); await file.sync() } finally { await file.close() }
    await assertDirectories(root)
    // The event number is a compare-and-create slot, never a mutable head.
    // A losing writer must reload; it must not dispatch its proposed attempt.
    const path = join(root, eventName(event.sequence))
    try { await link(temporary, path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const winner = await readEvent(path)
      // Concurrent owners can observe identical settlement at different wall
      // clock instants. Only the winning event's timing is durable and returned.
      const comparable = winner.kind === 'attempt_settled' && event.kind === 'attempt_settled'
        ? { ...winner, finishedAt: event.finishedAt, durationMs: event.durationMs } : winner
      if (revisionCanonicalJson(comparable) !== revisionCanonicalJson(event))
        throw new RevisionExecutionConflict()
      committed = winner
    }
    await syncDirectory(root)
    return committed
  } finally {
    try { await unlink(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Request-wide owner journal: every dispatch, usage, stop, terminal and
 * publication decision competes for the same immutable sequence slot.
 * It does not authenticate callers or adopt crashed native processes.
 */
export async function openRevisionAttemptStore(workspacePath: string, requestValue: unknown, options: { readOnlyHandle?: string } = {}) {
  const request = JSON.parse(revisionCanonicalJson(requestValue)) as unknown
  const readOnlyHandle = options.readOnlyHandle
  const accepted = readOnlyHandle
    ? await readRevisionRequestByHandle(workspacePath, readOnlyHandle, prepareRevisionRequest(request).request.ownerId)
    : await acceptRevisionRequest(workspacePath, request)
  if (accepted.record.requestDigest !== revisionDigest(request)) throw new Error('Revision read-only request binding mismatch')
  const requestRoot = dirname(join(resolve(workspacePath), accepted.artifactPath))
  // This private, unshipped layout is intentionally not auto-migrated. Never
  // mistake an old per-document active attempt for a fresh empty request.
  try {
    await lstat(join(requestRoot, 'attempts'))
    throw new Error('Revision legacy per-document execution requires explicit migration')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const root = readOnlyHandle ? join(requestRoot, 'execution-events') : await ensureChild(requestRoot, 'execution-events')
  if (readOnlyHandle) await assertDirectories(root)
  const reducer = createRevisionExecutionReducer(request, accepted.record)
  const same = (a: unknown, b: unknown) => revisionCanonicalJson(a) === revisionCanonicalJson(b)
  async function load(): Promise<State> {
    await assertDirectories(root)
    const names = (await readdir(root)).filter(name => !/^\.pending-[0-9a-f-]{36}$/i.test(name)).sort()
    if (names.some((name, index) => name !== eventName(index + 1))) throw new Error('Revision execution journal has a gap or unexpected entry')
    const state = reducer.initial()
    for (const name of names) reducer.apply(state, await readEvent(join(root, name)))
    return state
  }
  function header(state: State) {
    return { protocolVersion: 1 as const, producer: 'foundation-revision' as const,
      requestDigest: accepted.record.requestDigest, handle: accepted.record.handle,
      sequence: state.events.length + 1, previousDigest: state.events.length ? revisionDigest(state.events.at(-1)) : null }
  }
  async function commit(state: State, event: Event): Promise<Event | undefined> {
    if (readOnlyHandle) throw new Error('Revision read-only journal cannot append')
    reducer.apply(state, event)
    try { return await appendEvent(root, event) }
    catch (error) { if (error instanceof RevisionExecutionConflict) return undefined; throw error }
  }
  function requestSnapshot(state: State) {
    return { stopped: state.stopped, failure: state.failure,
      phase: state.published ? 'published' as const : state.publication ? 'publishing' as const : state.stopped ? 'stopped' as const : 'running' as const,
      activeAttemptIds: [...state.workers.values()].flatMap(worker => worker.active ? [worker.active.attemptId] : []),
      eventCount: state.events.length }
  }
  function workerSnapshot(state: State, documentValue: unknown) {
    const binding = reducer.authority(documentValue)
    const current = state.workers.get(binding.documentPath)!
    const last = current.events.at(-1)
    return structuredClone({ status: current.active ? 'running' as const : current.completed ? 'completed' as const
      : last?.kind === 'attempt_settled' ? last.settlement.status : 'pending' as const,
      attempt: current.attempt, active: current.active, completed: current.completed,
      lastSettlement: last?.kind === 'attempt_settled' ? last.settlement : null,
      lastReceipt: last?.kind === 'attempt_settled' ? last : null,
      observedUsageEvents: current.usageEvents, observedUsage: getLatestRevisionRuntimeUsage(current.usageEvents),
      output: (current.completed?.output ?? null) as AcceptedRevisionWorkerOutput | null, eventCount: current.events.length })
  }
  async function control(kind: 'stop_requested' | 'resumed', value: unknown) {
    const captured = kind === 'stop_requested' ? revisionStopSchema.parse(JSON.parse(revisionCanonicalJson(value)))
      : revisionResumeSchema.parse(JSON.parse(revisionCanonicalJson(value)))
    for (;;) {
      const state = await load()
      const existing = state.controls.get(captured.requestId)
      if (existing) {
        if (existing.kind !== kind || !same(existing.control, captured)) throw new Error('Revision control request immutable conflict')
        await syncDirectory(root)
        return requestSnapshot(state)
      }
      const event = eventSchema.parse({ ...header(state), kind, control: captured })
      if (await commit(state, event)) return requestSnapshot(state)
    }
  }
  return {
    async read(documentPath: unknown) { return workerSnapshot(await load(), documentPath) },
    async readRequest() { const state = await load(); await syncDirectory(root); return requestSnapshot(state) },
    async readAuthorizedCandidate() {
      const state = await load()
      return state.publication ? structuredClone(reducer.candidate(state).candidate) : null
    },
    async readControl(value: unknown) {
      const requestId = z.string().min(1).max(200).parse(value)
      return structuredClone((await load()).controls.get(requestId) ?? null)
    },
    async readUsageOutbox() {
      const state = await load()
      const entries = reducer.usageOutbox(state)
      // Observing a linked terminal before its writer's fsync is insufficient
      // authority to make an external billing call. Resync before returning it.
      await syncDirectory(root)
      return structuredClone({ entries, activeAttemptIds: requestSnapshot(state).activeAttemptIds })
    },
    async acknowledgeUsage(value: unknown) {
      const captured = z.object({ attemptId: z.uuid(), receipt: revisionBillingReceiptSchema }).strict()
        .parse(JSON.parse(revisionCanonicalJson(value)))
      for (;;) {
        const state = await load()
        const receipt = reducer.billingReceipt(state, captured.attemptId, captured.receipt)
        const existing = state.billing.get(captured.attemptId)
        if (existing) {
          if (!compatibleRevisionBillingReceipts(existing, receipt)) throw new Error('Revision billing acknowledgement immutable conflict')
          await syncDirectory(root)
          return structuredClone(existing)
        }
        const event: Event = { ...header(state), kind: 'billing_ack', attemptId: captured.attemptId, receipt }
        const committed = await commit(state, event)
        if (committed) {
          if (committed.kind !== 'billing_ack') throw new Error('Revision billing acknowledgement kind mismatch')
          return structuredClone(committed.receipt)
        }
      }
    },
    requestStop(value: unknown) { return control('stop_requested', value) },
    resume(value: unknown) { return control('resumed', value) },
    async recordFailure(value: unknown) {
      const code = revisionLifecycleFailureSchema.parse(value)
      for (;;) {
        const state = await load()
        if (state.failure && (code === 'billing_failed' || state.failure !== 'billing_failed')) {
          await syncDirectory(root)
          return requestSnapshot(state)
        }
        if (await commit(state, { ...header(state), kind: 'lifecycle_failed', code })) return requestSnapshot(state)
      }
    },
    async observeUsage(documentPath: unknown, value: unknown) {
      const captured = revisionObservationSchema.parse(JSON.parse(revisionCanonicalJson(value)))
      getLatestRevisionRuntimeUsage([captured.event as RevisionUsageEvent])
      const binding = reducer.authority(documentPath)
      for (;;) {
        const state = await load()
        const current = state.workers.get(binding.documentPath)!
        const previous = current.events.find(event => event.kind === 'attempt_usage_observed' &&
          event.observation.attemptId === captured.attemptId && event.observation.observationIndex === captured.observationIndex)
        if (previous?.kind === 'attempt_usage_observed') {
          if (!same(previous.observation, captured)) throw new Error('Revision conflicting usage observation replay')
          await syncDirectory(root)
          return structuredClone(previous)
        }
        const event: Event = { ...header(state), ...binding, kind: 'attempt_usage_observed', observation: captured }
        const committed = await commit(state, event)
        if (committed) return structuredClone(committed)
      }
    },
    async begin(documentPath: unknown) {
      const binding = reducer.authority(documentPath)
      const attemptId = randomUUID()
      const startedAt = Date.now()
      for (;;) {
        const state = await load()
        const current = state.workers.get(binding.documentPath)!
        if (current.completed) throw new Error('Revision attempt already completed; replay receipt instead of dispatch')
        if (current.active) throw new Error('Revision attempt still running; explicit recovery required')
        const event = eventSchema.parse({ ...header(state), ...binding, kind: 'attempt_started',
          attemptId, startedAt, attempt: current.attempt + 1 }) as RevisionStarted
        const committed = await commit(state, event)
        if (committed) return structuredClone(committed as RevisionStarted)
      }
    },
    async settle(documentPath: unknown, value: unknown) {
      const captured = revisionSettlementSchema.parse(JSON.parse(revisionCanonicalJson(value)))
      const binding = reducer.authority(documentPath)
      for (;;) {
        const state = await load()
        const current = state.workers.get(binding.documentPath)!
        const previous = current.events.find(event => event.kind === 'attempt_settled' && event.settlement.attemptId === captured.attemptId)
        if (previous?.kind === 'attempt_settled') {
          if (!same(previous.submittedSettlement, captured) && !same(previous.settlement, captured))
            throw new Error('Revision attempt conflicting terminal replay')
          await syncDirectory(root)
          return structuredClone(previous)
        }
        if (!current.active || current.active.attemptId !== captured.attemptId) throw new Error('Revision attempt stale settlement')
        const settlement = reducer.effectiveSettlement(state, captured)
        const derived = reducer.deriveSettlement(binding.documentPath, settlement,
          new Date(current.active.startedAt).toISOString())
        const finishedAt = Date.now()
        const startedAt = current.active.startedAt
        const event: RevisionSettled = { ...header(state), ...binding, kind: 'attempt_settled', submittedSettlement: captured,
          settlement, ...derived, finishedAt, durationMs: Math.max(0, finishedAt - startedAt) }
        const committed = await commit(state, event)
        if (committed) {
          if (committed.kind !== 'attempt_settled' || committed.durationMs !== Math.max(0, committed.finishedAt - startedAt))
            throw new Error('Revision attempt duration mismatch')
          return structuredClone(committed)
        }
      }
    },
    async preparePublication() {
      for (;;) {
        const state = await load()
        const prepared = reducer.candidate(state)
        if (state.publication) {
          await syncDirectory(root)
          return { ...structuredClone(prepared), authorizationDigest: revisionDigest(state.publication) }
        }
        const event: Event = { ...header(state), kind: 'candidate_authorized', candidateResultId: prepared.candidate.resultId,
          candidateResultDigest: revisionDigest(prepared.candidate), receiptDigests: prepared.receipts.map(revisionDigest) }
        const committed = await commit(state, event)
        if (committed) return { ...structuredClone(prepared), authorizationDigest: revisionDigest(committed) }
      }
    },
    async markPublished(value: unknown) {
      const authorizationDigest = z.string().regex(/^[a-f0-9]{64}$/).parse(value)
      for (;;) {
        const state = await load()
        if (state.published) {
          if (!state.publication || revisionDigest(state.publication) !== authorizationDigest) throw new Error('Revision publication completion authority mismatch')
          await syncDirectory(root)
          return requestSnapshot(state)
        }
        const event: Event = { ...header(state), kind: 'candidate_published', authorizationDigest }
        if (await commit(state, event)) return requestSnapshot(state)
      }
    },
  }
}
