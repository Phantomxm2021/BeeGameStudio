import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { UsageBillingClient } from '../../../../billing/public'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import { authorDigest, authorHandleSchema, authorResumeSchema, authorStopSchema, parseAuthorStart,
  type AuthorConfiguration, type AuthorDocumentsResult, type AuthorHandle, type AuthorResult, type AuthorStartInput } from './contract'
import type { AuthorOperations } from './contract'
import { createAuthorPersistence } from './persistence'
import { createAuthorUsageJournal } from './usage-journal'
import { authorBaselineSchema, autonomousPreparedSchema, captureAuthorBaseline, captureAutonomousDocuments, initializeAutonomousFiles,
  publishAutonomousDocuments, validateAutonomousEvidence, validateAutonomousPrepared, validateAutonomousResult,
  readAutonomousFile, type AuthorBaseline, type AutonomousPrepared } from './autonomous-files'
import { runAutonomousAuthor, type AutonomousNativeExecutor } from './autonomous-native'
import { authorExecutionLimitsSchema, boundedFinishExecutionLimits, defaultAuthorExecutionLimits, type AuthorExecutionLimits } from './execution-budget'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'

export const AUTONOMOUS_AUTHOR_MODE = 'autonomous.v1' as const
export const authorRegistrationKey = (id: string) => authorDigest(['author-registration', id])
export const authorStartKey = (workspace: string, input: AuthorStartInput) => authorDigest(['author-start', workspace, input.ownerId, input.projectId, input.requestId])
const controlKey = (id: string) => authorDigest(['author-control', id])
const controlLockKey = (id: string) => authorDigest(['author-control-lock', id])
type Infrastructure = { billing?: UsageBillingClient; runtimeConfiguration?: RuntimeConfigurationClient }
type Registration = { mode: typeof AUTONOMOUS_AUTHOR_MODE; handle: AuthorHandle; start: AuthorStartInput;
  createdAt: string; workspacePath: string; baseline: AuthorBaseline; executionLimits?: AuthorExecutionLimits }
const controlSchema = z.strictObject({ sequence: z.number().int().nonnegative(), action: z.enum(['run', 'stop']),
  finishOnly: z.boolean().optional(), requests: z.record(z.string(), z.strictObject({ action: z.enum(['run', 'stop']), sequence: z.number().int().nonnegative(), reason: z.string().optional(), finishOnly: z.boolean().optional() })) })
type Control = z.infer<typeof controlSchema>
const stateSchema = z.strictObject({
  mode: z.literal(AUTONOMOUS_AUTHOR_MODE), registrationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['queued', 'running', 'needs_action', 'stopped', 'completed']),
  appliedSequence: z.number().int().nonnegative(), candidateReady: z.boolean(),
  historicalElapsedMs: z.number().nonnegative().optional(),
  attempt: z.strictObject({ id: z.string().uuid(), status: z.enum(['running', 'completed', 'failed', 'blocked', 'interrupted']),
    startedAt: z.string().datetime({ offset: true }), finishedAt: z.string().datetime({ offset: true }).optional() }).optional(),
  progress: z.strictObject({ modelResponses: z.number().int().nonnegative(), message: z.string().max(2000) }).optional(),
  reason: z.string().max(2000).optional(), summary: z.string().max(16000).optional(),
  prepared: autonomousPreparedSchema.optional(), result: z.unknown().optional(),
})
type State = Omit<z.infer<typeof stateSchema>, 'result'> & { result?: AuthorDocumentsResult }
const busy = (error: unknown) => error instanceof Error && /^author persistence key (is busy|recovery is busy)/.test(error.message)

/** New tasks have one native author for the complete bundle. The legacy
 * per-document scheduler is neither imported nor executed by this lifecycle. */
export function createAutonomousAuthorLifecycle(configuration: AuthorConfiguration,
  infrastructure: Infrastructure = {}, execute: AutonomousNativeExecutor = runAutonomousAuthor): AuthorOperations {
  const config = structuredClone(configuration)
  const store = createAuthorPersistence({ rootPath: config.privateRootPath })
  const active = new Map<string, Promise<void>>()
  const candidatePath = (id: string) => join(config.privateRootPath, `autonomous-${id}`, 'workspace')
  const nativeLog = (id: string, attempt: string) => join(config.privateRootPath, `autonomous-${id}`, `${attempt}.native-events.jsonl`)
  const usageJournal = (reg: Registration) => createAuthorUsageJournal(store,
    { runId: reg.handle.id, ownerId: reg.start.ownerId, projectId: reg.start.projectId }, infrastructure.billing)
  function validateOwner(owner: string) {
    if ((infrastructure.billing && infrastructure.billing.ownerId !== owner) ||
        (infrastructure.runtimeConfiguration && infrastructure.runtimeConfiguration.ownerId !== owner)) throw new Error('Author infrastructure owner mismatch')
  }
  async function lock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await store.withLock(key, operation) }
      catch (error) { if (!busy(error) || attempt >= 200) throw error; await new Promise(resolve => setTimeout(resolve, 10)) }
    }
  }
  const control = async (id: string) => controlSchema.parse(await store.load(controlKey(id)))
  async function registration(handle: AuthorHandle): Promise<Registration> {
    authorHandleSchema.parse(handle)
    const reg = await store.load<Registration>(authorRegistrationKey(handle.id))
    if (!reg || reg.mode !== AUTONOMOUS_AUTHOR_MODE || authorDigest(reg.handle) !== authorDigest(handle) ||
        reg.workspacePath !== await realpath(config.workspacePath)) throw new Error('Unknown autonomous author handle')
    parseAuthorStart(reg.start); validateOwner(reg.start.ownerId)
    authorBaselineSchema.parse(reg.baseline)
    if (reg.executionLimits) authorExecutionLimitsSchema.parse(reg.executionLimits)
    if (!Number.isFinite(Date.parse(reg.createdAt))) throw new Error('Invalid author registration')
    return reg
  }
  async function load(reg: Registration): Promise<State> {
    const parsed = stateSchema.parse(await store.load(reg.handle.id)) as State
    if (parsed.registrationDigest !== authorDigest(reg)) throw new Error('Author checkpoint registration changed')
    if (parsed.prepared) {
      validateAutonomousPrepared(parsed.prepared)
      if (parsed.prepared.inputDigest !== reg.start.inputDigest || authorDigest(parsed.prepared.baseline) !== authorDigest(reg.baseline))
        throw new Error('Author checkpoint package source changed')
    }
    if (parsed.result) {
      if (!parsed.prepared || parsed.status !== 'completed') throw new Error('Author completed checkpoint has no package')
      await validateAutonomousResult(reg.workspacePath, reg.start, parsed.prepared, parsed.result)
    } else if (parsed.status === 'completed') throw new Error('Author completed checkpoint has no result')
    return parsed
  }

  /** Never reuse a workspace while a detached native process might own it.
   * PID reuse conservatively blocks recovery rather than killing another job. */
  async function nativeMayBeAlive(reg: Registration, state: State): Promise<boolean> {
    if (!state.attempt || state.attempt.status !== 'running') return false
    try {
      const events = (await readFile(nativeLog(reg.handle.id, state.attempt.id), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      if (events.some(event => event.event === 'closed')) return false
      const pid = events.find(event => event.event === 'started')?.data?.pid
      if (!Number.isSafeInteger(pid) || pid <= 0) return false
      try { process.kill(pid, 0); return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; return true }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }

  /** Explicit resume may use the short finishing prompt only when a prior
   * attempt left every canonical candidate as a safe, non-empty draft. */
  async function hasCompleteCandidate(reg: Registration, state: State): Promise<boolean> {
    if (!state.candidateReady || !state.attempt) return false
    const candidate = candidatePath(reg.handle.id)
    let complete = true
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      let bytes: Buffer | undefined
      try { bytes = await readAutonomousFile(candidate, path) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { complete = false; continue }
        throw error
      }
      if (!bytes?.length) { complete = false; continue }
      // Admission later performs the same fatal UTF-8 check. Do it before
      // choosing finish mode so malformed bytes cannot reach a native call.
      if (!new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()) complete = false
    }
    return complete
  }

  function launch(reg: Registration): Promise<void> {
    const existing = active.get(reg.handle.id)
    if (existing) return existing
    let drove = false
    const promise = store.withLock(reg.handle.id, async () => {
      const state = await load(reg)
      if (state.result) return
      if (await nativeMayBeAlive(reg, state)) return
      await store.withLock(authorDigest(['author-workspace', reg.workspacePath]), async () => {
        drove = true
        await drive(reg, state)
      })
    }).catch(async error => {
      if (busy(error)) return
      // Storage failures remain visible to readers. Never convert a corrupt
      // checkpoint into permission for a fresh model execution.
      throw error
    }).finally(async () => {
      if (active.get(reg.handle.id) === promise) active.delete(reg.handle.id)
      if (drove) {
        const state = await load(reg), command = await control(reg.handle.id)
        if (!state.result && command.sequence > state.appliedSequence) void launch(reg)
      }
    })
    active.set(reg.handle.id, promise)
    void promise.catch(() => undefined)
    return promise
  }

  async function drive(reg: Registration, state: State): Promise<void> {
    const id = reg.handle.id, journal = usageJournal(reg)
    let ownsAttempt = false
    let command = await control(id)
    const save = () => store.save(id, state)
    const acknowledgeStop = async () => {
      state.status = 'stopped'; state.appliedSequence = command.sequence
      if (state.attempt?.status === 'running') state.attempt = { ...state.attempt, status: 'interrupted',
        ...(ownsAttempt ? { finishedAt: new Date().toISOString() } : {}) }
      await save()
    }
    await journal.sealInterrupted()
    await journal.flush()
    if (command.action === 'stop') { await acknowledgeStop(); return }
    if (state.attempt?.status === 'running') {
      // No trustworthy finish timestamp exists after an orphaned execution.
      state.attempt = { ...state.attempt, status: 'interrupted' }
      state.status = 'needs_action'; state.reason = 'Author execution was interrupted; preserved working files require explicit resume.'
      await save()
    }
    if (state.prepared) {
      // A stop after native completion retains the exact package. Explicit
      // resume completes publication without spending on another model call.
      if (['stopped', 'needs_action'].includes(state.status) && command.sequence <= state.appliedSequence) return
      try { await finish(reg, state, journal) }
      catch {
        state.status = 'needs_action'; state.reason = 'Author prepared package could not be safely published; explicit recovery is required.'
        state.appliedSequence = command.sequence; await save()
      }
      return
    }
    if (state.status !== 'queued' && command.sequence <= state.appliedSequence) return
    const finishOnly = command.finishOnly === true
    state.appliedSequence = command.sequence
    state.status = 'running'; delete state.reason; delete state.progress
    const attemptId = randomUUID()
    if (state.attempt?.finishedAt) state.historicalElapsedMs = (state.historicalElapsedMs ?? 0) +
      Math.max(0, Date.parse(state.attempt.finishedAt) - Date.parse(state.attempt.startedAt))
    state.attempt = { id: attemptId, status: 'running', startedAt: new Date().toISOString() }
    ownsAttempt = true
    await save() // Attempt identity is durable before any native side effect.
    const abort = new AbortController()
    let poll: ReturnType<typeof setInterval> | undefined
    let controlFailure: unknown
    let stoppedSequence: number | undefined
    let checks: Promise<unknown> = Promise.resolve()
    const checkControl = () => {
      checks = checks.then(async () => {
        command = await control(id)
        if (command.action === 'stop') { stoppedSequence = command.sequence; abort.abort() }
      })
        .catch(error => { controlFailure = error; abort.abort() })
      return checks
    }
    try {
      if (!state.candidateReady) {
        await initializeAutonomousFiles({ candidatePath: candidatePath(id), workspacePath: reg.workspacePath, start: reg.start, baseline: reg.baseline })
        state.candidateReady = true; await save()
      }
      await validateAutonomousEvidence(candidatePath(id), reg.start)
      await checkControl()
      if (abort.signal.aborted) { await acknowledgeStop(); return }
      const model = infrastructure.runtimeConfiguration ? await infrastructure.runtimeConfiguration.resolve({ ownerId: reg.start.ownerId }) : config.model
      poll = setInterval(() => { void checkControl() }, 50)
      const limits = reg.executionLimits ?? defaultAuthorExecutionLimits
      const attemptLimits = finishOnly ? boundedFinishExecutionLimits(limits) : limits
      const attemptStartedAt = state.attempt!.startedAt
      const outcome = await execute({ configuration: model, workspacePath: candidatePath(id), logPath: nativeLog(id, attemptId),
        signal: abort.signal, language: config.language,
        executionLimits: attemptLimits,
        finishOnly,
        attemptStartedAt,
        onUsage: value => journal.observe(attemptId, value),
        onProgress: async progress => { state.progress = { modelResponses: progress.modelResponses,
          message: (finishOnly ? '受限收尾：' : '') + progress.message.slice(0, finishOnly ? 1994 : 2000) }; await save() } })
      if (poll) { clearInterval(poll); poll = undefined }
      await checks
      await journal.observe(attemptId, outcome.usage, true)
      await journal.flush()
      if (controlFailure) throw controlFailure
      command = await control(id)
      if (command.action === 'stop') { await acknowledgeStop(); return }
      if (outcome.failure === 'stopped') {
        state.status = 'stopped'
        state.appliedSequence = stoppedSequence ?? state.appliedSequence
        state.attempt = { ...state.attempt!, status: 'interrupted', finishedAt: new Date().toISOString() }
        await save(); return
      }
      if (outcome.failure || !outcome.report || !outcome.usage) {
        state.attempt = { ...state.attempt!, status: 'failed', finishedAt: new Date().toISOString() }
        const budgetReasons: Record<string, string> = {
          document_progress_unavailable: 'Author document progress could not be safely inspected.',
        }
        state.status = 'needs_action'; state.reason =
          (budgetReasons[outcome.failure ?? ''] ?? 'Author did not produce a complete metered result.') +
          (finishOnly ? ' This was limited to a bounded finishing pass; drafts are retained.' : '') +
          ' Working files and usage are preserved. Explicit resume starts a new budgeted attempt; no automatic retry will occur.'
        await save(); return
      }
      state.summary = outcome.report.summary
      state.attempt = { ...state.attempt!, status: outcome.report.status === 'blocked' ? 'blocked' : 'completed', finishedAt: new Date().toISOString() }
      if (outcome.report.status === 'blocked') {
        state.status = 'needs_action'; state.reason = outcome.report.summary.slice(0, 2000); await save(); return
      }
      state.prepared = await captureAutonomousDocuments({ candidatePath: candidatePath(id), start: reg.start,
        baseline: reg.baseline, updatedAt: state.attempt.finishedAt! })
      await save()
      await finish(reg, state, journal)
    } catch {
      // A failed file/format/storage admission does not manufacture a repair
      // prompt or retry a model. The next action belongs to the user.
      if (poll) { clearInterval(poll); poll = undefined }
      await checks
      await journal.observe(attemptId, undefined, true)
      await journal.flush()
      command = await control(id)
      if (command.action === 'stop') await acknowledgeStop()
      else {
        state.status = 'needs_action'
        state.reason = 'Author document package could not be safely accepted; working files are preserved. Explicit recovery is required.'
        if (state.attempt?.status === 'running') state.attempt = { ...state.attempt, status: 'failed', finishedAt: new Date().toISOString() }
        await save()
      }
    } finally { if (poll) clearInterval(poll); await checks }
  }

  async function finish(reg: Registration, state: State, journal: ReturnType<typeof usageJournal>): Promise<void> {
    if (!state.prepared) throw new Error('Author publication has no prepared bundle')
    const billing = await journal.flush()
    if (billing.pending > 0) { state.status = 'running'; state.reason = 'Author result is awaiting billing settlement.'; await store.save(reg.handle.id, state); return }
    await lock(controlLockKey(reg.handle.id), async () => {
      const command = await control(reg.handle.id)
      state.appliedSequence = command.sequence
      if (command.action === 'stop') { state.status = 'stopped'; await store.save(reg.handle.id, state); return }
      const result = await publishAutonomousDocuments({ workspacePath: reg.workspacePath, start: reg.start, prepared: state.prepared! })
      state.result = result; state.status = 'completed'; delete state.reason
      await store.save(reg.handle.id, state)
    })
  }

  async function getResult(handle: AuthorHandle): Promise<AuthorResult> {
    const reg = await registration(handle)
    let state = await load(reg)
    // Reconcile an accepted command or an interrupted publication using the
    // durable lease. drive never restarts an already attempted call on reads.
    if (!state.result && !active.has(handle.id)) {
      void launch(reg)
    }
    const billing = await usageJournal(reg).status()
    const liveAttempt = state.attempt?.status === 'running' &&
      (active.has(handle.id) || await nativeMayBeAlive(reg, state))
    const envelope = { handle: structuredClone(handle), billingStatus: billing.pending ? 'pending' as const : 'settled' as const,
      timing: { currentCallElapsedMs: liveAttempt
        ? Math.max(0, Date.now() - Date.parse(state.attempt!.startedAt)) : 0,
        historicalElapsedMs: (state.historicalElapsedMs ?? 0) + (state.attempt?.finishedAt
          ? Math.max(0, Date.parse(state.attempt.finishedAt) - Date.parse(state.attempt.startedAt)) : 0) },
      ...(state.progress ? { progress: { ...state.progress } } : {}) }
    if (state.result) return { ...envelope, status: 'completed', result: structuredClone(state.result) }
    const command = await control(handle.id)
    if (command.sequence > state.appliedSequence || state.status === 'queued') return { ...envelope, status: 'running' }
    if (state.status === 'stopped') return { ...envelope, status: 'stopped' }
    if (state.status === 'needs_action') return { ...envelope, status: 'needs_action', reason: state.reason ?? 'Author requires explicit recovery.', resumable: true }
    return { ...envelope, status: 'running' }
  }

  return {
    async start(value) {
      const start = parseAuthorStart(value); validateOwner(start.ownerId)
      const workspacePath = await realpath(config.workspacePath)
      if (resolve(config.privateRootPath) !== join(workspacePath, '.beegame/workflow/foundation-authoring/state')) throw new Error('Invalid author state namespace')
      const key = authorStartKey(workspacePath, start)
      let reg = await store.load<Registration>(key)
      if (!reg) {
        reg = { mode: AUTONOMOUS_AUTHOR_MODE, handle: { protocolVersion: 1, producer: 'foundation-authoring', id: randomUUID() },
          start, workspacePath, createdAt: new Date().toISOString(), baseline: await captureAuthorBaseline(workspacePath),
          executionLimits: authorExecutionLimitsSchema.parse(config.executionLimits ?? defaultAuthorExecutionLimits) }
        await store.create(key, reg)
        reg = (await store.load<Registration>(key))!
      }
      if (reg.mode !== AUTONOMOUS_AUTHOR_MODE || reg.start.inputDigest !== start.inputDigest) throw new Error('Author request conflicts with its original invocation')
      await store.create(authorRegistrationKey(reg.handle.id), reg)
      await store.create(controlKey(reg.handle.id), { sequence: 0, action: 'run', requests: {} } satisfies Control)
      await store.create(reg.handle.id, { mode: AUTONOMOUS_AUTHOR_MODE, registrationDigest: authorDigest(reg),
        status: 'queued', candidateReady: false, appliedSequence: 0 } satisfies State)
      void launch(reg)
      return structuredClone(reg.handle)
    },
    async resume(value) {
      const input = authorResumeSchema.parse(value), reg = await registration(input.handle)
      await lock(controlLockKey(input.handle.id), async () => {
        const state = await load(reg), current = await control(input.handle.id)
        const key = authorDigest(['author-resume', input.requestId])
        if (current.requests[key]) return
        const next = state.result || (current.action === 'run' && ['running', 'queued'].includes(state.status)) ? current.sequence : current.sequence + 1
        let finishOnly = false
        if (next > current.sequence && !state.result && !state.prepared) {
          try {
            finishOnly = await hasCompleteCandidate(reg, state)
          } catch {
            // Unsafe candidate bytes are never handed to the native agent and
            // never fall back to a fresh regeneration attempt.
            state.status = 'needs_action'
            state.reason = 'Preserved candidate documents are unsafe to resume; working files are retained and require safe recovery.'
            state.appliedSequence = current.sequence
            await store.save(reg.handle.id, state)
            return
          }
        }
        await store.save(controlKey(input.handle.id), { ...current, sequence: next,
          action: next > current.sequence ? 'run' : current.action,
          ...(next > current.sequence ? { finishOnly } : {}),
          requests: { ...current.requests, [key]: { action: 'run', sequence: next, ...(finishOnly ? { finishOnly: true } : {}) } } })
      })
      void launch(reg)
      return structuredClone(input.handle)
    },
    async stop(value) {
      const input = authorStopSchema.parse(value), reg = await registration(input.handle)
      await lock(controlLockKey(input.handle.id), async () => {
        const state = await load(reg), current = await control(input.handle.id)
        if (state.result) return
        const key = authorDigest(['author-stop', input.requestId]), previous = current.requests[key]
        if (previous) { if (previous.reason !== input.reason) throw new Error('Author stop reason conflicts'); return }
        await store.save(controlKey(input.handle.id), { sequence: current.sequence + 1, action: 'stop',
          requests: { ...current.requests, [key]: { action: 'stop', sequence: current.sequence + 1, reason: input.reason } } })
      })
      await launch(reg)
      return getResult(input.handle)
    },
    getResult,
  }
}
