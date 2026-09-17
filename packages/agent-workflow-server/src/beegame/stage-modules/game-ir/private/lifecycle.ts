import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod/v4'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../../billing/public'
import { captureFoundationIrInput, type FoundationIrInput } from '../input'
import { journalImmutableFiles as files, journalCanonical, ReviewJournalConflictError,
  openJournalStorage, type JournalRecord } from '../../../stage-runtime/journal-storage'
import type { ReviewNativeUsage } from '../../../stage-runtime/native-usage'
import { gameIrHandleSchema } from '../public'
import type { GameIrHandle, GameIrProgress, GameIrReadyResult, GameIrResult,
  GameIrResumeInput, GameIrStartInput, GameIrStopInput, GameIrReviseInput } from '../public'
import { parseGameIrReadyReceipt } from '../private/core/contracts'
import { foundationReadyReceiptFromInput } from '../private/core/source-input'
import { compileGameIr, loadGameIrCompilerAuthority, publishGameIrCorrection, type GameIrCompileInput, type GameIrCompileResult } from './compiler'
import { readPublishedGameIr, type GameIrPublishedView } from './reader'
import { runNativeIrOperation, type NativeIrOperation } from './native-operation'

type Infrastructure = Readonly<{ runtimeConfiguration: RuntimeConfigurationClient; billing: UsageBillingClient }>

/** Trusted private seam. The public module never exposes this callback. */
export type GameIrCompiler = (input: GameIrCompileInput) => Promise<GameIrCompileResult>

type Closed = {
  usage: ReviewNativeUsage
  usageObserved: boolean
  elapsedMs: number
  output?: string
  failure?: string
}
type Attempt = { id: string; operationDigest: string; usage?: ReviewNativeUsage; closed?: Closed; receipt?: unknown }
type IrState = {
  attempts: Attempt[]
  stopped: boolean
  failure?: string
  failureRecoverable?: boolean
  ready?: GameIrReadyResult
  progress?: GameIrProgress
  elapsedMs?: number
}
type IrEvent =
  | { kind: 'claim'; attemptId: string; operationDigest: string }
  | { kind: 'usage'; attemptId: string; usage: ReviewNativeUsage }
  | { kind: 'progress'; progress: GameIrProgress }
  | { kind: 'closed'; attemptId: string; closed: Closed }
  | { kind: 'settled'; attemptId: string; receipt: unknown }
  | { kind: 'ready'; ready: GameIrReadyResult }
  | { kind: 'elapsed'; elapsedMs: number }
  | { kind: 'stop'; reason: string }
  | { kind: 'resume' }
  | { kind: 'failure'; code: string; recoverable?: boolean }

const count = z.number().int().nonnegative().safe()
const usageSchema = z.object({ prompt_tokens: count, completion_tokens: count, cache_read_tokens: count,
  cache_creation_tokens: count, total_tokens: count }).strict().refine(value =>
  value.total_tokens === value.prompt_tokens + value.completion_tokens + value.cache_read_tokens + value.cache_creation_tokens)
const progressSchema = z.object({ operation: z.string().max(2000).optional(), completedOperations: count,
  totalOperations: count, message: z.string().max(2000) }).strict()
const startSchema = z.object({ protocolVersion: z.literal(1), ownerId: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200), requestId: z.string().min(1).max(200), acceptedReview: z.unknown(),
  publishedDocumentRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const closedSchema = z.object({ usage: usageSchema, usageObserved: z.boolean(), elapsedMs: count,
  output: z.string().max(16 * 1024 * 1024).optional(), failure: z.string().max(2000).optional() }).strict()
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), attemptId: z.string().min(1), operationDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal('usage'), attemptId: z.string().min(1), usage: usageSchema }).strict(),
  z.object({ kind: z.literal('progress'), progress: progressSchema }).strict(),
  z.object({ kind: z.literal('closed'), attemptId: z.string().min(1), closed: closedSchema }).strict(),
  z.object({ kind: z.literal('settled'), attemptId: z.string().min(1), receipt: z.json() }).strict(),
  z.object({ kind: z.literal('ready'), ready: z.json() }).strict(),
  z.object({ kind: z.literal('elapsed'), elapsedMs: count }).strict(),
  z.object({ kind: z.literal('stop'), reason: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('failure'), code: z.string().min(1).max(2000), recoverable: z.boolean().optional() }).strict(),
]) as unknown as { parse(value: unknown): IrEvent }
type EventRecord = JournalRecord<IrEvent>
const eventRecordSchema = z.object({ version: z.literal(1), index: count,
  previousDigest: z.string(), commandId: z.string().min(1), commandDigest: z.string(), at: z.string(),
  event: eventSchema, digest: z.string() }).strict() as unknown as z.ZodType<EventRecord>

function digest(value: unknown): string {
  return createHash('sha256').update(journalCanonical(value)).digest('hex')
}
function handleFor(input: GameIrStartInput, inputDigest: string): GameIrHandle {
  return { protocolVersion: 1, producer: 'game-ir', id: digest({ ownerId: input.ownerId, projectId: input.projectId,
    requestId: input.requestId, inputDigest }) }
}
function root(workspacePath: string, ownerId: string, id: string): string {
  return join(workspacePath, '.beegame/workflow/game-ir/native-v1', digest(ownerId), id)
}
function billingStatus(state: IrState): 'pending' | 'settled' {
  return state.attempts.every(attempt => attempt.receipt !== undefined) ? 'settled' : 'pending'
}
function canResume(state: IrState): boolean {
  return state.failureRecoverable !== false && state.attempts.every(attempt => Boolean(attempt.closed?.usageObserved))
}
function reduce(prior: IrState, event: IrEvent): IrState {
  const state = structuredClone(prior)
  const attempt = 'attemptId' in event ? state.attempts.find(item => item.id === event.attemptId) : undefined
  if (event.kind === 'claim') {
    if (state.stopped || state.ready || state.attempts.some(item => !item.closed || !item.receipt))
      throw new Error('Game IR cannot claim another operation')
    state.attempts.push({ id: event.attemptId, operationDigest: event.operationDigest })
  } else if (event.kind === 'usage') {
    if (!attempt || attempt.closed) throw new Error('Game IR usage does not belong to an open operation')
    attempt.usage = event.usage
  } else if (event.kind === 'progress') state.progress = event.progress
  else if (event.kind === 'closed') {
    if (!attempt || attempt.closed) throw new Error('Game IR close does not belong to an open operation')
    attempt.closed = event.closed
    attempt.usage = event.closed.usage
    if (!event.closed.usageObserved) state.failure = 'usage_unavailable'
  } else if (event.kind === 'settled') {
    if (!attempt?.closed || attempt.receipt || !attempt.closed.usageObserved)
      throw new Error('Game IR cannot settle unobserved usage')
    attempt.receipt = event.receipt
  } else if (event.kind === 'ready') {
    if (state.stopped || state.failure || state.attempts.some(item => !item.closed || !item.receipt))
      throw new Error('Game IR cannot publish incomplete execution')
    state.ready = parseGameIrReadyReceipt(event.ready)
  } else if (event.kind === 'elapsed') state.elapsedMs = event.elapsedMs
  else if (event.kind === 'stop') {
    if (!state.ready) state.stopped = true
  } else if (event.kind === 'resume') {
    if (!canResume(state)) throw new Error('Game IR cleanup or metering needs operator evidence')
    state.stopped = false
    delete state.failure
    delete state.failureRecoverable
  } else {
    state.failure = event.code
    state.failureRecoverable = event.recoverable
  }
  return state
}

type Journal = Awaited<ReturnType<typeof openJournalStorage<IrState, IrEvent, EventRecord>>>

export type GameIrLifecycle = {
  start(input: GameIrStartInput): Promise<GameIrHandle>
  getResult(handle: GameIrHandle): Promise<GameIrResult>
  resume(input: GameIrResumeInput): Promise<GameIrResult>
  stop(input: GameIrStopInput): Promise<GameIrResult>
  readResult(input: { handle: GameIrHandle; foundationRevision: string }): Promise<GameIrPublishedView>
  revise(input: GameIrReviseInput): Promise<GameIrResult>
}

export function createGameIrLifecycle(workspacePath: string, infrastructure: Infrastructure, compiler: GameIrCompiler = compileGameIr): GameIrLifecycle {
  if (!infrastructure || infrastructure.billing?.protocolVersion !== 1 || infrastructure.runtimeConfiguration?.protocolVersion !== 1 ||
    infrastructure.billing.ownerId !== infrastructure.runtimeConfiguration.ownerId || typeof infrastructure.billing.submitUsage !== 'function' ||
    typeof infrastructure.runtimeConfiguration.resolve !== 'function') throw new Error('Game IR requires owner-bound public infrastructure')
  const ownerId = infrastructure.billing.ownerId
  const active = new Map<string, Promise<void>>()
  const getRoot = (handle: GameIrHandle) => root(workspacePath, ownerId, handle.id)

  async function open(start: GameIrStartInput, handle: GameIrHandle, readOnly = false): Promise<Journal> {
    const source = captureFoundationIrInput(start)
    const header = { ...structuredClone(start), source }
    return openJournalStorage({ workspacePath, root: join(getRoot(handle), 'journal'), runId: handle.id, ownerId,
      header, readOnly, eventSchema: eventRecordSchema, parseEvent: value => eventSchema.parse(value),
      initialState: (): IrState => ({ attempts: [], stopped: false }),
      canRecoverUnstartedExecution: state => state.attempts.length === 0, reduce,
    })
  }
  async function append(journal: Journal, event: IrEvent, commandId: string = randomUUID()): Promise<IrState> {
    for (let retry = 0; ; retry++) {
      try { return await journal.append(commandId, event) }
      catch (error) { if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error }
    }
  }
  async function load(handleValue: GameIrHandle) {
    const handle = gameIrHandleSchema.parse(structuredClone(handleValue)) as GameIrHandle
    const request = await files.readJson(join(getRoot(handle), 'journal/input.json')) as Record<string, unknown>
    const start = z.object({ protocolVersion: z.literal(1), ownerId: z.string().min(1).max(200), projectId: z.string().min(1).max(200),
      requestId: z.string().min(1).max(200), acceptedReview: z.unknown(), publishedDocumentRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse({
        protocolVersion: request.protocolVersion, ownerId: request.ownerId, projectId: request.projectId,
        requestId: request.requestId, acceptedReview: request.acceptedReview,
        publishedDocumentRevision: request.publishedDocumentRevision,
      }) as GameIrStartInput
    const source = captureFoundationIrInput(start)
    if (start.ownerId !== ownerId || handleFor(start, digest(source)).id !== handle.id) throw new Error('Game IR handle owner binding mismatch')
    return { handle, start }
  }
  async function settle(journal: Journal, start: GameIrStartInput, handle: GameIrHandle, assertOwned: () => Promise<void>): Promise<void> {
    for (const attempt of (await journal.read()).attempts) {
      if (attempt.receipt || !attempt.closed?.usageObserved) continue
      await assertOwned()
      const usage = attempt.closed.usage
      const eventId = digest({ producer: 'game-ir', handle: handle.id, attemptId: attempt.id, usage })
      const submission = { ownerId, projectId: start.projectId, sessionId: handle.id, turnId: attempt.id, eventId,
        usage: { ...usage }, metadata: { producer: 'game-ir', attemptId: attempt.id, operationDigest: attempt.operationDigest } }
      let receipt: Awaited<ReturnType<UsageBillingClient['submitUsage']>>
      try { receipt = await infrastructure.billing.submitUsage(structuredClone(submission)) }
      catch { await assertOwned(); receipt = await infrastructure.billing.submitUsage(structuredClone(submission)) }
      await assertOwned()
      const supplied = receipt as unknown as Record<string, unknown>
      if (supplied.protocolVersion !== 1 || supplied.ownerId !== ownerId || supplied.eventId !== eventId ||
        supplied.idempotencyKey !== eventId || supplied.pricingVersion !== 'weighted-v1' ||
        supplied.usageSource !== 'runtime_snapshot' || journalCanonical(supplied.usage) !== journalCanonical(usage))
        throw new Error('Game IR billing receipt does not bind sealed usage')
      if (supplied.skipped === true) {
        if (usage.total_tokens !== 0 || supplied.duplicate !== false) throw new Error('Game IR billing skip receipt is invalid')
      } else {
        const recorded = supplied.recorded as Record<string, unknown> | undefined
        const debited = supplied.debited as Record<string, unknown> | undefined
        if (supplied.skipped !== undefined || recorded?.eventId !== eventId || debited?.eventId !== eventId)
          throw new Error('Game IR billing receipt debit is not bound to sealed usage')
      }
      await append(journal, { kind: 'settled', attemptId: attempt.id, receipt: JSON.parse(journalCanonical(receipt)) }, `settled:${attempt.id}`)
    }
  }
  async function resolveConfiguration(journal: Journal) {
    let checking = false
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      return await Promise.race([
        infrastructure.runtimeConfiguration.resolve({ ownerId }),
        new Promise<never>((_resolve, reject) => {
          timer = setInterval(() => { if (checking) return; checking = true; void journal.read().then(state => {
            if (state.stopped) reject(new Error('Game IR configuration cancelled'))
          }, reject).finally(() => { checking = false }) }, 250)
        }),
      ])
    } finally { if (timer) clearInterval(timer) }
  }
  async function drive(start: GameIrStartInput, handle: GameIrHandle, resumeId?: string): Promise<void> {
    const journal = await open(start, handle)
    if (resumeId && await journal.leaseStatus() === 'stale') await journal.recoverUnstartedExecution()
    const lease = await journal.tryExecutionLease()
    if (lease.kind !== 'owned') return
    const started = performance.now()
    const pendingProgress = new Set<Promise<unknown>>()
    const drainProgress = async () => { while (pendingProgress.size) await Promise.allSettled([...pendingProgress]) }
    try {
      if (resumeId) await append(journal, { kind: 'resume' }, `resume:${digest(resumeId)}`)
      let state = await journal.read()
      if (state.stopped || state.ready) return
      const executionAbort = new AbortController()
      // Usage settlement is durable and must be recoverable without a live
      // runtime configuration (or a second native invocation).
      await settle(journal, start, handle, lease.assertOwned)
      state = await journal.read()
      if (state.stopped) return
      const configuration = await resolveConfiguration(journal)
      state = await journal.read()
      if (state.stopped) return
      const header = await files.readJson(join(getRoot(handle), 'journal/input.json')) as { source: FoundationIrInput }
      const source = header.source
      const cached: Record<string, string> = {}
      for (const attempt of state.attempts)
        if (attempt.closed?.output !== undefined && !attempt.closed.failure && attempt.receipt)
          cached[attempt.operationDigest] = attempt.closed.output
      const runOperation = async (operation: NativeIrOperation): Promise<string> => {
        const operationDigest = digest(operation)
        const existing = cached[operationDigest]
        if (existing !== undefined) return existing
        const attemptId = randomUUID()
        await append(journal, { kind: 'claim', attemptId, operationDigest }, `claim:${attemptId}`)
        const directory = join(getRoot(handle), 'native', attemptId)
        await files.ensureDirectories(directory)
        let polling = false
        const poll = setInterval(() => { if (polling) return; polling = true; void journal.read().then(current => {
          if (current.stopped) executionAbort.abort()
        }, () => executionAbort.abort()).finally(() => { polling = false }) }, 250)
        const opStarted = performance.now()
        try {
          const result = await runNativeIrOperation({ source, directory, configuration, signal: executionAbort.signal, operation,
            onUsage: async usage => { await lease.assertOwned(); await append(journal, { kind: 'usage', attemptId, usage }) },
            onProgress: async progress => { await lease.assertOwned(); await append(journal, { kind: 'progress', progress: {
            operation: operation.kind, completedOperations: progress.modelResponses, totalOperations: progress.modelResponses, message: progress.message,
            } }) },
          })
          const output = result.text ?? ''
          await lease.assertOwned()
          await append(journal, { kind: 'closed', attemptId, closed: { usage: result.usage, usageObserved: result.usageObserved,
            elapsedMs: Math.ceil(performance.now() - opStarted), ...(output ? { output } : {}), ...(result.failure ? { failure: result.failure } : {}) } }, `closed:${attemptId}`)
          await settle(journal, start, handle, lease.assertOwned)
          const current = await journal.read()
          if (current.stopped) throw new Error('Game IR operation stopped')
          if (result.failure || !result.usageObserved) throw new Error(result.failure ?? 'usage_unavailable')
          cached[operationDigest] = output
          return output
        } finally { clearInterval(poll) }
      }
      const foundationReceipt = foundationReadyReceiptFromInput(source)
      const result = await compiler({
        workspacePath,
        identity: { runId: handle.id, taskId: handle.id, publicationId: handle.id,
          confirmedBriefDigest: source.confirmedBriefDigest, foundationRevision: source.publishedDocumentRevision,
          foundationReadyReceiptDigest: foundationReceipt.receiptDigest },
        foundationInput: source,
        signal: executionAbort.signal,
        execute: async operation => runOperation({ kind: operation.kind, prompt: operation.prompt,
          ...(operation.readOnlyFiles ? { readOnlyFiles: operation.readOnlyFiles } : {}), outputFormat: operation.outputFormat }),
        onEvent: event => {
          const write = lease.assertOwned().then(() => append(journal, { kind: 'progress', progress: {
            operation: `${event.step}/${event.domain}`, completedOperations: event.status === 'completed' ? 1 : 0,
            totalOperations: 1, message: event.status,
          } })).catch(() => undefined)
          pendingProgress.add(write)
          void write.finally(() => pendingProgress.delete(write))
        },
      })
      await drainProgress()
      if (result.status !== 'ready') {
        await append(journal, { kind: 'failure', code: result.diagnostic.reason.slice(0, 2000),
          recoverable: result.diagnostic.recoverable })
        return
      }
      const ready = parseGameIrReadyReceipt(result.readyReceipt)
      await lease.assertOwned()
      await settle(journal, start, handle, lease.assertOwned)
      state = await journal.read()
      if (!state.stopped && billingStatus(state) === 'settled') {
        await append(journal, { kind: 'ready', ready }, `ready:${digest(ready)}`)
      }
    } catch (error) {
      const ownsLease = await lease.assertOwned().then(() => true, () => false)
      const current = await journal.read().catch(() => undefined)
      if (ownsLease && current && !current.ready && !current.failure && !current.stopped)
        await append(journal, { kind: 'failure', code: error instanceof Error ? error.message.slice(0, 2000) : 'execution_failed' }).catch(() => undefined)
    } finally {
      await drainProgress()
      await lease.assertOwned().then(() => append(journal, { kind: 'elapsed', elapsedMs: Math.ceil(performance.now() - started) }, `elapsed:${handle.id}:${Math.ceil(performance.now() - started)}`)).catch(() => undefined)
      await lease.release().catch(() => undefined)
    }
  }
  function kick(start: GameIrStartInput, handle: GameIrHandle, resumeId?: string) {
    if (active.has(handle.id)) return
    const promise = drive(start, handle, resumeId)
    active.set(handle.id, promise)
    void promise.finally(() => { if (active.get(handle.id) === promise) active.delete(handle.id) }).catch(() => undefined)
  }
  async function view(start: GameIrStartInput, handle: GameIrHandle): Promise<GameIrResult> {
    const journal = await open(start, handle, true)
    const execution = await journal.leaseStatus()
    const state = await journal.read()
    const base = { handle: structuredClone(handle), billingStatus: billingStatus(state), ...(state.progress ? { progress: state.progress } : {}), ...(state.elapsedMs !== undefined ? { elapsedMs: state.elapsedMs } : {}) }
    if (state.ready) return { ...base, status: 'completed', result: structuredClone(state.ready) }
    if (execution === 'stale') return { ...base, status: 'needs_action', reason: 'Game IR execution owner was lost; cleanup and metering cannot be inferred.', resumable: await journal.canRecoverUnstartedExecution() }
    if (execution === 'busy' || active.has(handle.id)) return { ...base, status: 'running' }
    if (state.stopped) {
      if (billingStatus(state) !== 'settled')
        return { ...base, status: 'needs_action', reason: 'Game IR stop completed but final usage is unknown or unsettled.', resumable: canResume(state) }
      return { ...base, status: 'stopped' }
    }
    return { ...base, status: 'needs_action', reason: state.failure ? `Game IR requires attention: ${state.failure}.` : 'Game IR awaits explicit continuation.', resumable: canResume(state) }
  }
  return Object.freeze({
    async revise(value: GameIrReviseInput) {
      const { start, handle } = await load(value.handle)
      const current = await view(start, handle)
      if (current.status !== 'completed' || current.billingStatus !== 'settled' ||
          digest(current.result) !== value.expectedResultDigest)
        throw new Error('IR correction requires the expected settled publication')
      const source = captureFoundationIrInput(start)
      const foundation = foundationReadyReceiptFromInput(source)
      const authority = await loadGameIrCompilerAuthority({ workspacePath, identity: {
        runId: handle.id, taskId: handle.id, publicationId: current.result.publicationId,
        confirmedBriefDigest: source.confirmedBriefDigest, foundationRevision: source.publishedDocumentRevision,
        foundationReadyReceiptDigest: foundation.receiptDigest,
      } })
      await readPublishedGameIr({ workspacePath, foundationInput: source, ready: current.result, authority })
      const nextStart = { ...start, requestId: `revision:${digest({ parent: current.result, draft: value.draft })}` }
      const nextHandle = handleFor(nextStart, digest(source))
      const journal = await open(nextStart, nextHandle)
      const ready = await publishGameIrCorrection({ workspacePath, foundationInput: source,
        identity: { runId: nextHandle.id, taskId: nextHandle.id, publicationId: nextHandle.id,
          confirmedBriefDigest: source.confirmedBriefDigest, foundationRevision: source.publishedDocumentRevision,
          foundationReadyReceiptDigest: foundation.receiptDigest },
        execute: async () => { throw new Error('Explicit IR correction must not start an agent') },
      }, value.draft)
      await append(journal, { kind: 'ready', ready }, `revision:${nextHandle.id}`)
      return view(nextStart, nextHandle)
    },
    async start(value: GameIrStartInput) {
      const input = startSchema.parse(structuredClone(value)) as GameIrStartInput
      if (input.ownerId !== ownerId) throw new Error('Game IR start owner/protocol mismatch')
      const source = captureFoundationIrInput(input)
      const handle = handleFor(input, digest(source))
      await files.ensureDirectories(getRoot(handle))
      try {
        const existing = await files.readJson(join(getRoot(handle), 'journal/input.json'))
        if (journalCanonical(existing) !== journalCanonical({ ...input, source })) throw new Error('Game IR request binding mismatch')
        return structuredClone(handle)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const journal = await open(input, handle)
      if (journal.createdInput) kick(input, handle)
      return structuredClone(handle)
    },
    async getResult(value: GameIrHandle) { const { start, handle } = await load(value); return view(start, handle) },
    async resume(value: GameIrResumeInput) {
      const { start, handle } = await load(value.handle)
      // A stop is durable, but the old drive may still be unwinding a native
      // callback.  If resume arrives in that narrow window, wait only for
      // this stopped drive so the intent is not lost behind its final state.
      const journal = await open(start, handle, true)
      const persisted = await journal.read()
      if (persisted.stopped) {
        const oldDrive = active.get(handle.id)
        if (oldDrive) {
          await oldDrive.catch(() => undefined)
          if (active.get(handle.id) === oldDrive) active.delete(handle.id)
        }
      }
      const current = await view(start, handle)
      if (current.status === 'completed' || current.status === 'running' || (current.status === 'needs_action' && !current.resumable)) return current
      kick(start, handle, value.requestId)
      return view(start, handle)
    },
    async stop(value: GameIrStopInput) {
      const { start, handle } = await load(value.handle)
      const journal = await open(start, handle)
      await append(journal, { kind: 'stop', reason: value.reason }, `stop:${digest(value.requestId)}`)
      return view(start, handle)
    },
    async readResult(value: { handle: GameIrHandle; foundationRevision: string }): Promise<GameIrPublishedView> {
      const { start, handle } = await load(value.handle)
      const viewed = await view(start, handle)
      if (viewed.status !== 'completed') throw new Error('Game IR ready result is not available')
      if (viewed.result.foundationRevision !== value.foundationRevision) throw new Error('Game IR foundation revision mismatch')
      const source = captureFoundationIrInput(start)
      const foundation = foundationReadyReceiptFromInput(source)
      const authority = await loadGameIrCompilerAuthority({ workspacePath, identity: {
        runId: handle.id, taskId: handle.id, publicationId: viewed.result.publicationId,
        confirmedBriefDigest: source.confirmedBriefDigest, foundationRevision: source.publishedDocumentRevision,
        foundationReadyReceiptDigest: foundation.receiptDigest,
      } })
      return readPublishedGameIr({ workspacePath, foundationInput: source, ready: viewed.result, authority })
    },
  })
}
