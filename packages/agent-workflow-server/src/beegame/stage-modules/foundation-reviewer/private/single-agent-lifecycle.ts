import { runFileReview } from './native-files'
import { randomUUID } from 'node:crypto'
import { createEvidenceWriter, evidenceSecrets } from './single-agent-evidence'
import { join } from 'node:path'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../../billing/public'
import { journalImmutableFiles as files, ReviewJournalConflictError } from './journal-storage'
import { reviewDigest, reviewJson, admitSingleReviewReport } from './single-agent-contract'
import { openSingleReviewJournal, singleReviewRoot, type SingleReviewEvent, type SingleReviewState } from './single-agent-journal'
import { buildSingleReviewResult, parseSingleReviewStart, singleReviewHandleSchema, singleReviewResumeSchema, singleReviewStopSchema,
  type SingleReviewStart, type SingleReviewHandle, type SingleReviewResult, type SingleReviewResume, type SingleReviewStop } from './single-agent-publication'

type Infrastructure = { runtimeConfiguration: RuntimeConfigurationClient; billing: UsageBillingClient }
type Journal = Awaited<ReturnType<typeof openSingleReviewJournal>>
export type SingleReviewerOperations = { start(input: SingleReviewStart): Promise<SingleReviewHandle>;
  getResult(handle: SingleReviewHandle): Promise<SingleReviewResult>; resume(input: SingleReviewResume): Promise<SingleReviewResult>;
  stop(input: SingleReviewStop): Promise<SingleReviewResult> }
function handleFor(start: SingleReviewStart): SingleReviewHandle {
  const hash = reviewDigest({ ownerId: start.ownerId, projectId: start.projectId, requestId: start.requestId })
  return { protocolVersion: 1, producer: 'foundation-reviewer',
    id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}` }
}
const billingStatus = (state: SingleReviewState) => state.attempts.every(attempt => attempt.receipt) ? 'settled' as const : 'pending' as const
const evidenceIdentity = (start: SingleReviewStart, handle: SingleReviewHandle, attemptId: string) => ({
  runId: /^foundation:([^:]+):\d+$/.exec(start.requestId)?.[1] ?? handle.id,
  reviewerHandleId: handle.id, hostRequestId: start.requestId, attemptId,
})
const canResume = (state: SingleReviewState) => state.attempts.every(attempt => attempt.closed?.usageObserved)

/** One native auditor; no strategy selection or historical protocol replay. */
export function createSingleReviewerLifecycle(workspacePath: string, infrastructure: Infrastructure): SingleReviewerOperations {
  if (!infrastructure || Object.keys(infrastructure).sort().join(',') !== 'billing,runtimeConfiguration' ||
    infrastructure.billing?.protocolVersion !== 1 || infrastructure.runtimeConfiguration?.protocolVersion !== 1 ||
    !infrastructure.billing.ownerId || infrastructure.billing.ownerId !== infrastructure.runtimeConfiguration.ownerId ||
    typeof infrastructure.billing.submitUsage !== 'function' || typeof infrastructure.runtimeConfiguration.resolve !== 'function')
    throw new Error('Reviewer requires owner-bound public infrastructure')
  const ownerId = infrastructure.billing.ownerId
  const clients = { billing: infrastructure.billing, runtimeConfiguration: infrastructure.runtimeConfiguration }
  const active = new Map<string, Promise<void>>()
  const root = (handle: SingleReviewHandle) => singleReviewRoot(workspacePath, ownerId, handle.id)
  async function load(value: SingleReviewHandle) {
    const handle = singleReviewHandleSchema.parse(structuredClone(value))
    await files.assertDirectories(root(handle))
    const start = parseSingleReviewStart(await files.readJson(join(root(handle), 'request.json')))
    if (start.ownerId !== ownerId || reviewJson(handleFor(start)) !== reviewJson(handle)) throw new Error('Review handle owner binding mismatch')
    return { handle, start }
  }
  async function append(journal: Journal, event: SingleReviewEvent, commandId: string = randomUUID()): Promise<SingleReviewState> {
    for (let retry = 0; ; retry++) {
      try { return await journal.append(commandId, event) }
      catch (error) { if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error }
    }
  }
  async function resolveConfiguration(journal: Journal) {
    let polling = false
    let poll: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        clients.runtimeConfiguration.resolve({ ownerId }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Runtime configuration timed out')), 30_000)
          poll = setInterval(() => {
            if (polling) return
            polling = true
            void journal.read().then(state => {
              if (state.stopped || state.failure) reject(new Error('Review configuration cancelled'))
            }, reject).finally(() => { polling = false })
          }, 250)
        }),
      ])
    } finally {
      if (poll) clearInterval(poll)
      if (timeout) clearTimeout(timeout)
    }
  }
  async function settle(journal: Journal, start: SingleReviewStart, handle: SingleReviewHandle, assertOwned: () => Promise<void>) {
    for (const attempt of (await journal.read()).attempts) {
      if (attempt.receipt || !attempt.closed?.usageObserved) continue
      await assertOwned()
      const usage = attempt.closed.usage
      const eventId = reviewDigest({ producer: 'foundation-reviewer', handle: handle.id, attemptId: attempt.id, usage })
      const submission = { ownerId, projectId: start.projectId, sessionId: handle.id,
        turnId: attempt.id, eventId, usage: { ...usage }, metadata: { producer: 'foundation-reviewer', strategy: 'single-agent', attemptId: attempt.id,
          ...(attempt.closed.summary ? { nativeUsageSource: attempt.closed.summary.usageSource } : {}) } }
      // A lost acknowledgement may follow a successful debit. Replay only the
      // same sealed event, before committing failure, and never rerun the audit.
      let receipt: Awaited<ReturnType<UsageBillingClient['submitUsage']>>
      try { receipt = await clients.billing.submitUsage(structuredClone(submission)) }
      catch {
        await assertOwned()
        receipt = await clients.billing.submitUsage(structuredClone(submission))
      }
      if (receipt.protocolVersion !== 1 || receipt.ownerId !== ownerId || receipt.eventId !== eventId || receipt.idempotencyKey !== eventId ||
        receipt.pricingVersion !== 'weighted-v1' || receipt.usageSource !== 'runtime_snapshot' || reviewJson(receipt.usage) !== reviewJson(usage) ||
        ('skipped' in receipt ? receipt.skipped !== true || usage.total_tokens !== 0 : !receipt.recorded?.eventId || !receipt.debited?.eventId))
        throw new Error('Billing receipt does not bind the sealed review usage')
      await assertOwned()
      await append(journal, { kind: 'settled', attemptId: attempt.id, receipt: JSON.parse(reviewJson(receipt)) }, `settled:${attempt.id}`)
    }
  }
  async function publish(journal: Journal, start: SingleReviewStart, handle: SingleReviewHandle, assertOwned: () => Promise<void>) {
    const state = await journal.read()
    if (!state.report || state.stopped || state.failure || billingStatus(state) !== 'settled') return
    admitSingleReviewReport(start.input, state.report)
    if (!state.documents) throw new Error('Review document snapshot is missing')
    const result = buildSingleReviewResult(start, state.report, state.documents)
    const destination = join(root(handle), 'result')
    await assertOwned(); await files.ensureDirectories(destination)
    await files.publishJson(join(destination, 'result.json'), result)
    await files.publishJson(join(destination, 'COMMITTED.json'), { resultId: result.resultId, resultDigest: reviewDigest(result) })
    await assertOwned()
    await append(journal, { kind: 'published', resultId: result.resultId }, `published:${result.resultId}`)
    const evidence = createEvidenceWriter({ enabled: process.env.BEEGAME_REVIEW_EVIDENCE === '1', directory: join(root(handle), 'evidence'),
      ids: evidenceIdentity(start, handle, state.attempts.at(-1)?.id ?? 'publication'),
      secrets: evidenceSecrets(process.env) })
    evidence.record('report_published', { admittedReport: state.report, result, resultDigest: reviewDigest(result) })
    evidence.close()
  }
  async function drive(start: SingleReviewStart, handle: SingleReviewHandle, resumeId?: string) {
    const journal = await openSingleReviewJournal(workspacePath, handle.id, start)
    if (resumeId && await journal.leaseStatus() === 'stale') await journal.recoverUnstartedExecution()
    const lease = await journal.tryExecutionLease()
    if (lease.kind !== 'owned') return
    let failureCode = 'execution_failed'
    try {
      if (resumeId) await append(journal, { kind: 'resume' }, `resume:${reviewDigest(resumeId)}`)
      failureCode = 'billing_failed'
      await settle(journal, start, handle, lease.assertOwned)
      failureCode = 'execution_failed'
      let state = await journal.read()
      if (state.stopped || state.failure) return
      if (state.report) { failureCode = 'publication_failed'; await publish(journal, start, handle, lease.assertOwned); return }
      const configuration = await resolveConfiguration(journal)
      state = await journal.read()
      if (state.stopped || state.failure) return
      const attemptId = randomUUID()
      const directory = join(root(handle), 'native', attemptId)
      await files.ensureDirectories(directory)
      await lease.assertOwned()
      await append(journal, { kind: 'claim', attemptId }, `claim:${attemptId}`)
      const abort = new AbortController()
      let polling = false
      const poll = setInterval(() => {
        if (polling) return
        polling = true
        void journal.read().then(current => { if (current.stopped) abort.abort() }, () => abort.abort())
          .finally(() => { polling = false })
      }, 250)
      const started = performance.now()
      try {
        const completion = await runFileReview({ source: start.input, directory, configuration, signal: abort.signal,
          onUsage: async usage => {
            await lease.assertOwned(); await append(journal, { kind: 'usage', attemptId, usage })
          },
          onProgress: async progress => {
            await lease.assertOwned(); await append(journal, { kind: 'progress', attemptId, progress })
          },
        })
        await lease.assertOwned()
        await append(journal, { kind: 'closed', attemptId, usage: completion.usage, usageObserved: completion.usageObserved,
          sealScope: 'direct-child', elapsedMs: Math.ceil(performance.now() - started), summary: completion.summary,
          outcome: completion.report && completion.documents && !completion.failure
            ? { kind: 'accepted', report: completion.report, documents: completion.documents }
            : { kind: 'failed', code: completion.failure ?? 'invalid_output',
              ...(completion.diagnostic ? { diagnostic: completion.diagnostic } : {}) } }, `closed:${attemptId}`)
        failureCode = 'billing_failed'
        await settle(journal, start, handle, lease.assertOwned)
        if (completion.report && !completion.failure) {
          failureCode = 'publication_failed'
          await publish(journal, start, handle, lease.assertOwned)
        }
      } finally { clearInterval(poll) }
    } catch {
      await lease.assertOwned()
      if (!(await journal.read()).failure) await append(journal, { kind: 'failure', code: failureCode })
    } finally {
      await lease.release()
    }
  }
  function kick(start: SingleReviewStart, handle: SingleReviewHandle, resumeId?: string) {
    if (active.has(handle.id)) return
    const running = drive(start, handle, resumeId)
    active.set(handle.id, running)
    void running.finally(() => { if (active.get(handle.id) === running) active.delete(handle.id) }).catch(() => {})
  }
  async function view(start: SingleReviewStart, handle: SingleReviewHandle): Promise<SingleReviewResult> {
    const journal = await openSingleReviewJournal(workspacePath, handle.id, start, true)
    // Observe ownership before reading terminal facts. Otherwise publication
    // can finish and release its lease between read() and leaseStatus(), leaving
    // an old unpublished snapshot incorrectly projected as needs_action.
    const execution = await journal.leaseStatus()
    const state = await journal.read()
    const base = { handle: structuredClone(handle), billingStatus: billingStatus(state), ...(state.progress ? { progress: state.progress } : {}) }
    if (state.published && state.report) {
      admitSingleReviewReport(start.input, state.report)
      if (!state.documents) throw new Error('Review document snapshot is missing')
      const expected = buildSingleReviewResult(start, state.report, state.documents)
      const destination = join(root(handle), 'result')
      await files.assertDirectories(destination)
      const result = await files.readJson(join(destination, 'result.json'))
      const marker = await files.readJson(join(destination, 'COMMITTED.json'))
      if (state.published !== expected.resultId || reviewJson(expected) !== reviewJson(result) ||
        reviewJson(marker) !== reviewJson({ resultId: expected.resultId, resultDigest: reviewDigest(expected) }))
        throw new Error('Published review binding mismatch')
      return { ...base, status: 'completed', result: expected }
    }
    if (execution === 'stale') return { ...base, status: 'needs_action', reason: 'Review execution owner was lost; worker cleanup and metering cannot be inferred.',
      resumable: await journal.canRecoverUnstartedExecution() }
    if (execution === 'busy' || active.has(handle.id)) return { ...base, status: 'running' }
    if (state.stopped) return { ...base, status: 'stopped' }
    const lastOutcome = state.attempts.at(-1)?.closed?.outcome
    const diagnostic = lastOutcome?.kind === 'failed' ? lastOutcome.diagnostic : undefined
    const failureCode = lastOutcome?.kind === 'failed' ? ` [${lastOutcome.code}]` : ''
    const detail = failureCode + (diagnostic ? ` (${diagnostic.stage}${diagnostic.reason ? ':' + diagnostic.reason : ''})` : '')
    return { ...base, status: 'needs_action', reason: state.failure
      ? `Single-agent review requires attention: ${state.failure}${detail}. No pass has been published.`
      : 'Review awaits explicit continuation. No pass has been published.', resumable: canResume(state) }
  }
  return Object.freeze({
    async start(value: SingleReviewStart) {
      const start = parseSingleReviewStart(value)
      if (start.ownerId !== ownerId) throw new Error('Review owner mismatch')
      const handle = handleFor(start)
      await files.ensureDirectories(root(handle))
      try {
        const existing = parseSingleReviewStart(await files.readJson(join(root(handle), 'request.json')))
        if (reviewJson(existing) !== reviewJson(start)) throw new Error('Review request binding mismatch')
        await openSingleReviewJournal(workspacePath, handle.id, existing)
        return structuredClone(handle)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const created = await files.publishJson(join(root(handle), 'request.json'), start)
      await openSingleReviewJournal(workspacePath, handle.id, start)
      if (created) kick(start, handle)
      return structuredClone(handle)
    },
    async getResult(value: SingleReviewHandle) { const { start, handle } = await load(value); return view(start, handle) },
    async resume(value: SingleReviewResume) {
      const request = singleReviewResumeSchema.parse(structuredClone(value))
      const { start, handle } = await load(request.handle)
      const current = await view(start, handle)
      if (current.status === 'completed' || current.status === 'running' || (current.status === 'needs_action' && !current.resumable)) return current
      kick(start, handle, request.requestId)
      return view(start, handle)
    },
    async stop(value: SingleReviewStop) {
      const request = singleReviewStopSchema.parse(structuredClone(value))
      const { start, handle } = await load(request.handle)
      const journal = await openSingleReviewJournal(workspacePath, handle.id, start)
      await append(journal, { kind: 'stop', reason: request.reason }, `stop:${reviewDigest(request.requestId)}`)
      return view(start, handle)
    },
  })
}
