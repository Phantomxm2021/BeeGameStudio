import { randomUUID } from 'node:crypto'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../../billing/public'
import { createReviewerRegistrationStore, type ReviewerRequestRegistration } from './review-registration'
import { parseReviewerFormatCandidateStart, prepareReviewerCandidateInput, type ReviewerCandidateStart } from './candidate-contract'
import { reviewerCandidateSubject } from './targeted-preparation'
import { buildReviewerFullFormatResult } from './full-format-publication'
import { parseReviewerInitialStart, reviewerResumeSchema, reviewerStopSchema, type ReviewerResult, type ReviewerHandle, type ReviewerInitialStart, type ReviewerResume, type ReviewerStop } from './initial-contract'
import { openReviewerFactJournal, ReviewJournalConflictError } from './fact-journal'
import { createReviewerFactController } from './fact-controller'
import { createReviewerSemanticController } from './semantic-controller'
import { flushReviewerUsage } from './usage-outbox'
import { buildReviewerPublishedResult, readReviewerPublishedResult, publishReviewerDerivedResult } from './review-publication'
import { reviewerDigest } from './review-summary'
import { applyReviewerJournalEvent, type ReviewerJournalEvent, type ReviewerJournalState } from './review-state'

export type ReviewerInitialOperations = { start(input: ReviewerInitialStart): Promise<ReviewerHandle>; resume(input: ReviewerResume): Promise<ReviewerResult>;
  stop(input: ReviewerStop): Promise<ReviewerResult>; getResult(handle: ReviewerHandle): Promise<ReviewerResult> }
export type ReviewerInfrastructure = { runtimeConfiguration: RuntimeConfigurationClient; billing: UsageBillingClient }

/** Initial-review lifecycle. Kept private until candidate rechecks share the public contract. */
export function createReviewerInitialLifecycle(workspacePath: string, infrastructure: ReviewerInfrastructure): ReviewerInitialOperations {
  return createReviewerFullLifecycle(workspacePath, infrastructure, false)
}
export function createReviewerFormatCandidateLifecycle(workspacePath: string, infrastructure: ReviewerInfrastructure) {
  return createReviewerFullLifecycle(workspacePath, infrastructure, true)
}
type FullStart = ReviewerInitialStart | ReviewerCandidateStart
type FullRegistration = ReviewerRequestRegistration<FullStart>
function createReviewerFullLifecycle(workspacePath: string, infrastructure: ReviewerInfrastructure, formatCandidate: boolean) {
  if (!infrastructure || Object.keys(infrastructure).sort().join(',') !== 'billing,runtimeConfiguration' ||
    infrastructure.billing?.protocolVersion !== 1 || infrastructure.runtimeConfiguration?.protocolVersion !== 1 ||
    !infrastructure.billing.ownerId || infrastructure.billing.ownerId !== infrastructure.runtimeConfiguration.ownerId ||
    typeof infrastructure.billing.submitUsage !== 'function' || typeof infrastructure.runtimeConfiguration.resolve !== 'function')
    throw new Error('review lifecycle requires owner-bound public configuration and billing clients')
  const clients = { ...infrastructure }
  const registrations = createReviewerRegistrationStore<FullStart>(workspacePath, clients.billing.ownerId,
    formatCandidate ? parseReviewerFormatCandidateStart : value => {
      return parseReviewerInitialStart(value)
    })
  const active = new Map<string, Promise<void>>()
  const reviewInput = (registration: FullRegistration) => {
    if ('documents' in registration.start.input) return registration.start.input
    const candidate = prepareReviewerCandidateInput(registration.start.input)
    return { documents: candidate.documents, subject: reviewerCandidateSubject(candidate) }
  }
  const journalInput = (registration: FullRegistration) => ({ workspacePath,
    identity: { ownerId: registration.start.ownerId, projectId: registration.start.projectId, requestId: registration.start.requestId },
    documents: reviewInput(registration).documents, binding: { inputDigest: registration.start.inputDigest, subject: reviewInput(registration).subject } })
  const resultFor = (registration: FullRegistration, state: ReviewerJournalState) => 'documents' in registration.start.input
    ? buildReviewerPublishedResult({ ...journalInput(registration), subject: reviewInput(registration).subject, state })
    : buildReviewerFullFormatResult({ requestId: registration.start.requestId, candidate: prepareReviewerCandidateInput(registration.start.input), state })
  const isFinal = (state: ReviewerJournalState) => state.phase === 'format_issues' || state.semantic?.phase === 'semantic_staged'
  const hasRunning = (state: ReviewerJournalState) => [...state.collection.tasks, ...(state.semantic?.collection.tasks ?? [])].some(task => task.status === 'running')
  async function append(journal: Awaited<ReturnType<typeof openReviewerFactJournal>>, commandId: string, event: ReviewerJournalEvent) {
    for (let retry = 0; ; retry++) try { return await journal.append(commandId, event) }
    catch (error) { if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error }
  }

  async function drive(registration: FullRegistration, resumeId?: string) {
    const input = journalInput(registration)
    const journal = await openReviewerFactJournal(input)
    if (resumeId && await journal.leaseStatus() === 'stale') await journal.recoverUnstartedExecution()
    const lease = await journal.tryExecutionLease()
    if (lease.kind !== 'owned') return
    let operation: 'execution_failed' | 'publication_failed' = 'execution_failed'
    try {
      try {
        await lease.assertOwned()
        if (resumeId) await append(journal, `resume:${reviewerDigest(resumeId)}`, { kind: 'lifecycle_resume' })
        let state = await journal.read()
        if (!state.control?.stopped && !state.control?.failure) {
          if (state.phase === 'extracting_facts') await (await createReviewerFactController(input, clients.runtimeConfiguration, lease)).run()
          state = await journal.read()
          if (state.phase === 'facts_staged' && !state.control?.stopped && !state.control?.failure)
            await (await createReviewerSemanticController(input, clients.runtimeConfiguration, lease)).run()
        }
        state = await journal.read()
        if (isFinal(state)) {
          operation = 'publication_failed'
          await lease.assertOwned()
          await publishReviewerDerivedResult(workspacePath, resultFor(registration, state))
        }
      } catch {
        await lease.assertOwned()
        const state = await journal.read()
        // A durable stop can win the fact->semantic transition before seeding.
        if (!state.control?.stopped) await append(journal, randomUUID(), { kind: 'lifecycle_failure', code: operation })
      }
      // Controllers await worker cleanup before returning or throwing. Account
      // for sealed actual usage even when execution or publication has failed.
      try { await flushReviewerUsage(input, clients.billing, lease) }
      catch {
        await lease.assertOwned()
        if (!(await journal.read()).control?.failure)
          await append(journal, randomUUID(), { kind: 'lifecycle_failure', code: 'billing_failed' })
      }
    } finally { await lease.release() }
  }
  function kick(registration: FullRegistration, resumeId?: string) {
    if (active.has(registration.handle.id)) return
    const promise = drive(registration, resumeId)
    active.set(registration.handle.id, promise)
    void promise.finally(() => { if (active.get(registration.handle.id) === promise) active.delete(registration.handle.id) }).catch(() => {})
  }
  function billingStatus(state: ReviewerJournalState): 'pending' | 'settled' {
    const tasks = [...state.collection.tasks, ...(state.semantic?.collection.tasks ?? [])]
    return tasks.every(task => [...(task.attemptHistory ?? []), ...(task.dispatch ? [task.dispatch] : [])].every(dispatch =>
      state.billing?.entries.some(entry => entry.dispatchId === dispatch.dispatchId && entry.receipt))) ? 'settled' : 'pending'
  }
  function canResume(state: ReviewerJournalState, registration: FullRegistration) {
    if (hasRunning(state)) return false
    try {
      applyReviewerJournalEvent(state, reviewInput(registration).documents, { kind: 'lifecycle_resume' }, new Date().toISOString(),
        { runId: 'read-only-resume-policy', path: '', digest: '' })
      return true
    } catch { return false }
  }
  async function view(registration: FullRegistration): Promise<ReviewerResult> {
    const input = journalInput(registration)
    const journal = await openReviewerFactJournal({ ...input, readOnly: true })
    const state = await journal.read()
    const base = { handle: structuredClone(registration.handle), billingStatus: billingStatus(state) }
    if (isFinal(state)) {
      const expected = resultFor(registration, state)
      const published = await readReviewerPublishedResult(workspacePath, expected)
      if (published) return { ...base, status: 'completed', result: published }
    }
    const execution = await journal.leaseStatus()
    if (execution === 'stale') return { ...base, status: 'needs_action', reason: 'The previous execution owner was lost; explicit recovery evidence is required.',
      resumable: canResume(state, registration) && await journal.canRecoverUnstartedExecution() }
    if (state.control?.stopped) return execution === 'free' && !active.has(registration.handle.id)
      ? { ...base, status: 'stopped' } : { ...base, status: 'needs_action', reason: 'Stop is recorded; execution cleanup is still in progress.', resumable: false }
    if (execution === 'busy' || active.has(registration.handle.id)) return { ...base, status: 'running' }
    if (state.phase === 'stopped' || state.semantic?.phase === 'stopped') return { ...base, status: 'stopped' }
    return { ...base, status: 'needs_action', reason: state.control?.failure === 'publication_failed'
      ? 'Result publication could not be completed safely.' : 'Review execution requires explicit continuation or operator action.', resumable: canResume(state, registration) }
  }
  return Object.freeze({
    async start(value: FullStart) {
      const registration = await registrations.register(value)
      const journal = await openReviewerFactJournal(journalInput(registration))
      const state = await journal.read()
      // A brand-new format review is already locally final and must publish.
      // An existing final/faulted call requires explicit continuation instead
      // of using duplicate start to repair a missing publication marker.
      if (journal.createdInput || (!isFinal(state) && !state.control?.failure && !state.control?.stopped && state.phase !== 'stopped'))
        kick(registration)
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
      const journal = await openReviewerFactJournal(journalInput(registration))
      // Stop is not cleanup evidence for a claim whose execution owner vanished.
      if (hasRunning(await journal.read()) && await journal.leaseStatus() !== 'busy' && !active.has(registration.handle.id))
        return view(registration)
      await append(journal, `stop:${reviewerDigest(request.requestId)}`, { kind: 'lifecycle_stop', reason: request.reason })
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
