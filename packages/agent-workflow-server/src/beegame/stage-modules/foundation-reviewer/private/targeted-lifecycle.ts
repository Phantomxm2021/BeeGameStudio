import { randomUUID } from 'node:crypto'
import { parseReviewerCandidateStart, type ReviewerCandidateStart } from './candidate-contract'
import { createReviewerRegistrationStore, type ReviewerRequestRegistration } from './review-registration'
import { reviewerResumeSchema, reviewerStopSchema, type ReviewerHandle, type ReviewerResult, type ReviewerResume, type ReviewerStop } from './initial-contract'
import type { ReviewerInfrastructure } from './initial-lifecycle'
import { openReviewerTargetedJournal, ReviewJournalConflictError } from './targeted-journal'
import { applyReviewerTargetedEvent, type ReviewerTargetedEvent, type ReviewerTargetedState } from './targeted-state'
import { createReviewerTargetedController } from './targeted-controller'
import { flushReviewerTargetedUsage } from './targeted-usage-outbox'
import { buildReviewerTargetedResultFromState, publishReviewerTargetedResult } from './targeted-publication'
import { readReviewerPublishedResult } from './review-publication'
import { reviewerDigest } from './review-summary'

type Registration = ReviewerRequestRegistration<ReviewerCandidateStart>
export type ReviewerTargetedOperations = { start(input: ReviewerCandidateStart): Promise<ReviewerHandle>; resume(input: ReviewerResume): Promise<ReviewerResult>;
  stop(input: ReviewerStop): Promise<ReviewerResult>; getResult(handle: ReviewerHandle): Promise<ReviewerResult> }
const isFinal = (state: ReviewerTargetedState) => state.phase === 'deterministic_failed' || state.phase === 'targeted_staged'
const hasRunning = (state: ReviewerTargetedState) => [...state.factTasks, ...state.semanticTasks].some(task => task.status === 'running')

/** Candidate-only owner lifecycle. It never calls Revision or writes document bodies. */
export function createReviewerTargetedLifecycle(workspacePath: string, infrastructure: ReviewerInfrastructure): ReviewerTargetedOperations {
  if (!infrastructure || Object.keys(infrastructure).sort().join(',') !== 'billing,runtimeConfiguration' ||
    infrastructure.billing?.protocolVersion !== 1 || infrastructure.runtimeConfiguration?.protocolVersion !== 1 ||
    !infrastructure.billing.ownerId || infrastructure.billing.ownerId !== infrastructure.runtimeConfiguration.ownerId ||
    typeof infrastructure.billing.submitUsage !== 'function' || typeof infrastructure.runtimeConfiguration.resolve !== 'function')
    throw new Error('targeted lifecycle requires owner-bound public configuration and billing clients')
  const clients = { ...infrastructure }
  const registrations = createReviewerRegistrationStore(workspacePath, clients.billing.ownerId, parseReviewerCandidateStart)
  const active = new Map<string, Promise<void>>()
  const journalInput = (registration: Registration) => ({ workspacePath,
    identity: { ownerId: registration.start.ownerId, projectId: registration.start.projectId, requestId: registration.start.requestId },
    candidate: registration.start.input })
  async function append(journal: Awaited<ReturnType<typeof openReviewerTargetedJournal>>, commandId: string, event: ReviewerTargetedEvent) {
    for (let retry = 0; ; retry++) try { return await journal.append(commandId, event) }
    catch (error) { if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error }
  }

  async function drive(registration: Registration, resumeId?: string) {
    const input = journalInput(registration)
    const journal = await openReviewerTargetedJournal(input)
    if (resumeId && await journal.leaseStatus() === 'stale') await journal.recoverUnstartedExecution()
    const lease = await journal.tryExecutionLease()
    if (lease.kind !== 'owned') return
    let operation: 'execution_failed' | 'publication_failed' = 'execution_failed'
    try {
      try {
        await lease.assertOwned()
        if (resumeId) await append(journal, `resume:${reviewerDigest(resumeId)}`, { kind: 'lifecycle_resume' })
        let state = await journal.read()
        if (!state.control?.failure && state.phase !== 'stopped' && !isFinal(state))
          await (await createReviewerTargetedController(input, clients.runtimeConfiguration, lease)).run()
        state = await journal.read()
        if (isFinal(state)) {
          operation = 'publication_failed'
          await lease.assertOwned()
          await publishReviewerTargetedResult({ workspacePath, requestId: registration.start.requestId, candidate: journal.candidate, state })
        }
      } catch {
        await lease.assertOwned()
        await append(journal, randomUUID(), { kind: 'lifecycle_failure', code: operation })
      }
      // Accounting is attempted after the controller has awaited its own
      // worker cleanup, including a failed or stopped execution. Unknown
      // snapshots remain pending; they are never replaced with zero usage.
      try { await flushReviewerTargetedUsage(input, clients.billing, lease) }
      catch {
        await lease.assertOwned()
        if (!(await journal.read()).control?.failure)
          await append(journal, randomUUID(), { kind: 'lifecycle_failure', code: 'billing_failed' })
      }
    } finally { await lease.release() }
  }
  function kick(registration: Registration, resumeId?: string) {
    if (active.has(registration.handle.id)) return
    const promise = drive(registration, resumeId)
    active.set(registration.handle.id, promise)
    void promise.finally(() => { if (active.get(registration.handle.id) === promise) active.delete(registration.handle.id) }).catch(() => {})
  }
  function billingStatus(state: ReviewerTargetedState): 'pending' | 'settled' {
    return [...state.factTasks, ...state.semanticTasks].every(task => [...(task.attemptHistory ?? []), ...(task.dispatch ? [task.dispatch] : [])].every(dispatch =>
      state.billing?.entries.some(entry => entry.dispatchId === dispatch.dispatchId && entry.receipt))) ? 'settled' : 'pending'
  }
  function canResume(state: ReviewerTargetedState, candidate: Awaited<ReturnType<typeof openReviewerTargetedJournal>>['candidate']) {
    if (hasRunning(state)) return false
    try { applyReviewerTargetedEvent(state, candidate, { kind: 'lifecycle_resume' }, new Date().toISOString()); return true }
    catch { return false }
  }
  async function view(registration: Registration): Promise<ReviewerResult> {
    const journal = await openReviewerTargetedJournal({ ...journalInput(registration), readOnly: true })
    const state = await journal.read()
    const base = { handle: structuredClone(registration.handle), billingStatus: billingStatus(state) }
    if (isFinal(state)) {
      const expected = buildReviewerTargetedResultFromState({ requestId: registration.start.requestId, candidate: journal.candidate, state })
      const published = await readReviewerPublishedResult(workspacePath, expected)
      if (published) return { ...base, status: 'completed', result: published }
    }
    const execution = await journal.leaseStatus()
    if (execution === 'stale') return { ...base, status: 'needs_action', reason: 'The previous execution owner was lost; explicit native cleanup evidence is required.',
      resumable: canResume(state, journal.candidate) && await journal.canRecoverUnstartedExecution() }
    if (state.phase === 'stopped') return execution === 'free' && !active.has(registration.handle.id)
      ? { ...base, status: 'stopped' } : { ...base, status: 'needs_action', reason: 'Stop is recorded; native cleanup is still in progress.', resumable: false }
    if (execution === 'busy' || active.has(registration.handle.id)) return { ...base, status: 'running' }
    if (hasRunning(state)) return { ...base, status: 'needs_action', reason: 'A claimed native worker has no execution owner; explicit recovery is required.', resumable: false }
    return { ...base, status: 'needs_action', reason: state.control?.failure === 'publication_failed'
      ? 'Candidate result publication could not be completed safely.' : 'Candidate review requires explicit continuation or operator action.', resumable: canResume(state, journal.candidate) }
  }
  return Object.freeze({
    async start(value: ReviewerCandidateStart) {
      const registration = await registrations.register(value)
      const journal = await openReviewerTargetedJournal(journalInput(registration))
      const state = await journal.read()
      // A repeated start is idempotent after a terminal or lifecycle-failure
      // state. Publication repair is an explicit resume operation only.
      if (!isFinal(state) && state.phase !== 'stopped' && !state.control?.failure) kick(registration)
      return structuredClone(registration.handle)
    },
    async getResult(handle: ReviewerHandle) { return view(await registrations.load(handle)) },
    async resume(value: ReviewerResume) {
      const request = reviewerResumeSchema.parse(value)
      const registration = await registrations.load(request.handle)
      const current = await view(registration)
      if (current.status === 'needs_action' && !current.resumable) return current
      kick(registration, request.requestId)
      return view(registration)
    },
    async stop(value: ReviewerStop) {
      const request = reviewerStopSchema.parse(value)
      const registration = await registrations.load(request.handle)
      const journal = await openReviewerTargetedJournal(journalInput(registration))
      // Stop intent is not evidence that a predecessor's worker was cleaned
      // up. Do not turn unowned claims into resumable tasks through stop.
      if (hasRunning(await journal.read()) && await journal.leaseStatus() !== 'busy' && !active.has(registration.handle.id))
        return view(registration)
      await append(journal, `stop:${reviewerDigest(request.requestId)}`, { kind: 'stop' })
      const running = active.get(registration.handle.id)
      if (running) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try { await Promise.race([running.catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000) })]) }
        finally { if (timer) clearTimeout(timer) }
      }
      return view(registration)
    },
  })
}
