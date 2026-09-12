import { foundationReviewerInputDigest, type createFoundationReviewer, type ReviewerHandle, type ReviewerStartInput, type ReviewerResult, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import type { createFoundationRevision, RevisionHandle, RevisionStartInput, RevisionResult } from '../stage-modules/foundation-revision/public'
import type { DeliveryRun } from './types'
import type { RunStore, WorkflowLock } from './run-store'
import { createHash } from 'node:crypto'
import { projectFoundationReviewDisplay } from './foundation-review-display'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import { foundationAuthorWorkspaceBaseline, publishFoundationAcceptedArtifacts } from './foundation-accepted-artifacts'
import {
  DEFAULT_AUTOMATIC_REPAIR_LIMIT,
  FOUNDATION_ACCEPTANCE_POLICY_VERSION,
  assertFoundationAcceptanceDecision,
  evaluateFoundationAcceptance,
  type FoundationAcceptanceDecision,
  type FoundationPolicyAuthorization,
  type FoundationRiskDecision,
} from './foundation-acceptance-policy'
import {
  createFoundationInitialReviewRequest, createFoundationRepairRequest, createFoundationCandidateReviewRequest,
  foundationPublicJson, foundationResultBinding,
  type FoundationCandidateResult,
} from './foundation-public-handoff'

type ReviewerInvocation = { stage: 'reviewer'; request: ReviewerStartInput; handle?: ReviewerHandle; outcome?: ReviewerResult }
type RevisionInvocation = { stage: 'revision'; request: RevisionStartInput; handle?: RevisionHandle; outcome?: RevisionResult }
export type FoundationReviewLinkState = {
  protocolVersion: 1
  authorResultId: string
  /** Copied public provenance, never an execution handle for this project. */
  importedAuthorResult?: AuthorDocumentsResult
  sequence: number
  reviewTokenBudget?: number | null
  /** Opt-in copy policy: publish one review without starting a successor. */
  stopAfterReview?: boolean
  /** Set only after the settled public result has passed handoff binding checks. */
  reviewOnlyComplete?: true
  control: { sequence: number; appliedSequence: number; action: 'run' | 'stop'; reason?: string }
  invocation: ReviewerInvocation | RevisionInvocation
  sourceReview?: ReviewerReviewResult
  /** Stable report used to construct the currently reviewed candidate. */
  repairSourceReview?: ReviewerReviewResult
  /** Latest completed review, distinct from the revision source report. */
  latestReview?: ReviewerReviewResult
  candidate?: FoundationCandidateResult
  acceptedReview?: ReviewerReviewResult
  /** Versioned workflow decision; the Reviewer result remains immutable. */
  acceptanceDecision?: FoundationAcceptanceDecision
  /** Explicit, report-bound user risk decisions. */
  riskDecisions?: FoundationRiskDecision[]
  policyAuthorizations?: FoundationPolicyAuthorization[]
  policyVersion?: string
  automaticRepairLimit?: number
  completedRepairCount?: number
  /** Workflow-observed public invocation timing. These fields are absent for
   * legacy snapshots where the invocation boundary was never recorded. */
  invocationStartedAt?: string
  invocationCompletedAt?: string
  invocationLastObservedAt?: string
  invocationTimingRunning?: boolean
  currentCallElapsedMs?: number
  historicalElapsedMs?: number
  allowNoDocumentChangeOnce?: boolean
  observationError?: boolean
  /** Durable safety stop; ordinary resume cannot renew the repair budget. */
  convergenceStop?: 'repair_budget_exhausted' | 'no_document_change_blocked'
}

const PASSED_STOP = 'Foundation review accepted. Checklist handoff awaits acceptance.'
const REVIEW_ONLY_STOP = 'Reviewer-only run completed. Report available; no Revision or Checklist was started.'
const MAX_AUTOMATIC_REPAIR_ROUNDS = 6 // legacy links retain their original policy

function usesConvergencePolicy(link: FoundationReviewLinkState): boolean {
  if (link.policyVersion !== undefined && link.policyVersion !== FOUNDATION_ACCEPTANCE_POLICY_VERSION)
    throw new Error('Unknown Foundation acceptance policy version')
  return link.policyVersion === FOUNDATION_ACCEPTANCE_POLICY_VERSION
}

function repairLimit(link: FoundationReviewLinkState): number {
  return usesConvergencePolicy(link) ? link.automaticRepairLimit ?? DEFAULT_AUTOMATIC_REPAIR_LIMIT : MAX_AUTOMATIC_REPAIR_ROUNDS
}

function completedRepairs(link: FoundationReviewLinkState): number {
  return usesConvergencePolicy(link) ? link.completedRepairCount ?? 0 : Math.floor(link.sequence / 2)
}

function activeRiskDecisions(link: FoundationReviewLinkState, review: ReviewerReviewResult, identity: { ownerId: string; projectId: string }) {
  const binding = foundationResultBinding(identity, review)
  return (link.riskDecisions ?? []).filter(decision => decision.reviewResultId === review.resultId &&
    decision.reviewResultDigest === binding.resultDigest && decision.documentSetDigest === review.documentSetDigest)
}

export function assertImportedFoundationAuthorBoundary(run: Pick<DeliveryRun,
  'authorStage' | 'foundationReviewStage' | 'ownerId' | 'projectId' | 'confirmedBriefDigest' | 'foundationDraftState'>) {
  const link = run.foundationReviewStage
  const result = link?.importedAuthorResult
  if (!link || !result) return
  if (run.authorStage || result.ownerId !== run.ownerId || result.projectId === run.projectId ||
      result.confirmedBriefDigest !== run.confirmedBriefDigest || result.resultId !== link.authorResultId ||
      run.foundationDraftState.completedPaths.length || run.foundationDraftState.documents?.length)
    throw new Error('Imported Author provenance cannot replace identity or coexist with author execution')
  if (link.sequence === 0) {
    const input = link.invocation.request.input
    if (link.invocation.stage !== 'reviewer' || !('subject' in input) || input.subject.kind !== 'initial' ||
        input.subject.sourceResultId !== result.resultId || input.subject.sourceDocumentRevision !== result.documentRevision ||
        input.subject.confirmedBriefDigest !== result.confirmedBriefDigest || input.documents.length !== result.documents.length ||
        input.documents.some((document, index) => {
          const artifact = result.documents[index]!
          return document.path !== artifact.path || Buffer.byteLength(document.content, 'utf8') !== artifact.byteLength ||
            createHash('sha256').update(document.content).digest('hex') !== artifact.digest
        })) throw new Error('Imported Reviewer request does not bind frozen Author artifacts')
  }
}

/** Existing workflow orchestration only. Every execution/control operation is
 * delegated to a public port; no stage lease, worker or checkpoint is touched. */
export function createFoundationReviewLink(input: {
  workspacePath: string
  store: RunStore
  reviewer: ReturnType<typeof createFoundationReviewer>
  revision: ReturnType<typeof createFoundationRevision>
  pollIntervalMs?: number
}) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let closed = false
  async function locked<T>(runId: string, operation: (run: DeliveryRun, lock: WorkflowLock) => Promise<T>) {
    const lock = await input.store.mutationLock(runId)
    try {
      const run = await input.store.load(lock)
      if (!run || run.runId !== runId) throw new Error('Foundation public handoff run changed')
      return await operation(run, lock)
    } finally { await input.store.unlock(lock) }
  }
  async function save(run: DeliveryRun, lock: WorkflowLock, type: string) {
    return input.store.commit(run, { runId: run.runId, type, phase: run.phase, status: run.status, revision: run.revision }, undefined, lock)
  }
  function assertBoundary(run: DeliveryRun) {
    if (run.foundationReviewStage?.importedAuthorResult) {
      assertImportedFoundationAuthorBoundary(run)
      if (run.activeDispatch || run.foundationAuditState) throw new Error('Public review cannot coexist with legacy stage execution')
      return
    }
    if (!run.authorStage?.result || run.authorStage.status !== 'completed') throw new Error('Public Author completion is required')
    if (run.activeDispatch || run.foundationAuditState) throw new Error('Public review cannot coexist with legacy stage execution')
    const result = run.authorStage.result
    if (result.ownerId !== run.ownerId || result.projectId !== run.projectId || result.inputDigest !== run.authorStage.inputDigest ||
        result.confirmedBriefDigest !== run.confirmedBriefDigest ||
        (run.foundationReviewStage && run.foundationReviewStage.authorResultId !== result.resultId))
      throw new Error('Foundation public handoff author binding changed')
  }
  function requestId(run: DeliveryRun, sequence: number) { return `foundation:${run.runId}:${sequence}` }
  function queueCandidateReview(run: DeliveryRun, link: FoundationReviewLinkState, candidate: FoundationCandidateResult) {
    if (!link.sourceReview) throw new Error('Candidate review requires its source review')
    archiveInvocationTiming(link)
    const sequence = link.sequence + 1
    link.invocation = { stage: 'reviewer', request: createFoundationCandidateReviewRequest({
      ownerId: run.ownerId, projectId: run.projectId, requestId: requestId(run, sequence),
      source: link.sourceReview, candidate }) }
    if (link.reviewTokenBudget !== undefined) {
      link.invocation.request.tokenBudget = link.reviewTokenBudget
      link.invocation.request.inputDigest = foundationReviewerInputDigest(link.invocation.request)
    }
    link.candidate = structuredClone(candidate)
    link.sequence = sequence
  }
  function addInvocationElapsed(link: FoundationReviewLinkState, until: string) {
    if (link.invocationTimingRunning !== true || link.invocationLastObservedAt === undefined) return
    const fromMs = Date.parse(link.invocationLastObservedAt)
    const untilMs = Date.parse(until)
    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) return
    link.currentCallElapsedMs = (link.currentCallElapsedMs ?? 0) + Math.max(0, untilMs - fromMs)
    link.invocationLastObservedAt = until
  }
  function archiveInvocationTiming(link: FoundationReviewLinkState) {
    if (link.currentCallElapsedMs !== undefined && link.historicalElapsedMs !== undefined)
      link.historicalElapsedMs += link.currentCallElapsedMs
    delete link.invocationStartedAt
    delete link.invocationCompletedAt
    delete link.invocationLastObservedAt
    delete link.invocationTimingRunning
    delete link.currentCallElapsedMs
  }
  function watch(run: DeliveryRun) {
    const link = run.foundationReviewStage
    const stopPending = link?.control.action === 'stop' && Boolean(link.invocation.handle) &&
      (link.invocation.outcome?.status === 'running' || link.invocation.outcome?.billingStatus === 'pending')
    if (closed || timers.has(run.runId) || !link || link.acceptedReview || link.reviewOnlyComplete ||
        (run.status !== 'running' && !stopPending)) return
    const timer = setTimeout(() => {
      timers.delete(run.runId)
      void ensureProgress(run).catch(() => undefined) // ensureProgress records observation failure durably.
    }, input.pollIntervalMs ?? 250)
    timer.unref()
    timers.set(run.runId, timer)
  }
  function project(run: DeliveryRun, link: FoundationReviewLinkState): DeliveryRun {
    const outcome = link.invocation.outcome
    if (link.reviewOnlyComplete) return { ...run, foundationReviewStage: link,
      phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW', status: 'stopped',
      thinking: 'idle', currentMessage: REVIEW_ONLY_STOP, blockedReason: REVIEW_ONLY_STOP }
    if (link.convergenceStop) return { ...run, foundationReviewStage: link,
      status: link.control.action === 'stop' ? 'stopped' : 'needs_action',
      thinking: 'idle', currentMessage: undefined,
      blockedReason: (() => {
        const block = projectFoundationReviewDisplay(link, 'needs_action')!.block!
        return `${block.message} ${block.detail}`.slice(0, 2000)
      })() }
    const stopping = link.control.action === 'stop'
    const complete = Boolean(link.acceptedReview)
    const status = complete ? (stopping ? 'stopped' : 'needs_action')
      : !link.invocation.handle ? (stopping ? 'needs_action' : 'running')
      : outcome?.status === 'stopped' ? 'stopped'
      : outcome?.status === 'needs_action' ? 'needs_action'
      : outcome?.status === 'failed' ? 'failed'
      : stopping && outcome?.status !== 'running' ? 'needs_action' : 'running'
    const reason = complete ? PASSED_STOP : outcome?.status === 'needs_action' || outcome?.status === 'failed' ? outcome.reason
      : stopping ? link.control.reason ?? 'Foundation stage stop is awaiting acknowledgment.'
      : outcome?.status === 'completed' && outcome.billingStatus !== 'settled' ? 'Foundation public result is awaiting billing settlement.' : undefined
    return { ...run, foundationReviewStage: link,
      phase: link.invocation.stage === 'revision' && !complete ? 'FOUNDATION_REVISION' : 'DOCUMENT_REVIEW',
      documentStep: link.invocation.stage === 'revision' && !complete ? 'FOUNDATION_REVISION' : 'FOUNDATION_REVIEW',
      status, thinking: status === 'running' ? 'working' : 'idle', blockedReason: reason,
      currentMessage: complete ? PASSED_STOP : status === 'running'
        ? outcome?.progress ? `模型响应 ${outcome.progress.modelResponses} · ${outcome.progress.message}` : `Foundation ${link.invocation.stage} is running.` : undefined }
  }
  async function initialize(run: DeliveryRun, lock: WorkflowLock) {
    assertBoundary(run)
    if (run.foundationReviewStage || run.authorStage!.control.action === 'stop' || run.status === 'stopped' ||
        run.blockedReason === 'Foundation public handoff could not be safely completed. Explicit action is required.') return run
    const request = await createFoundationInitialReviewRequest({ workspacePath: input.workspacePath, requestId: requestId(run, 0),
      confirmedBriefContext: run.confirmedBriefContext,
      expected: { ownerId: run.ownerId, projectId: run.projectId, inputDigest: run.authorStage!.inputDigest,
        confirmedBriefDigest: run.confirmedBriefDigest }, result: run.authorStage!.result! })
    return save(project(run, { protocolVersion: 1, authorResultId: run.authorStage!.result!.resultId, sequence: 0,
      policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
      automaticRepairLimit: DEFAULT_AUTOMATIC_REPAIR_LIMIT,
      completedRepairCount: 0,
      historicalElapsedMs: 0,
      control: { sequence: 0, appliedSequence: 0, action: 'run' }, invocation: { stage: 'reviewer', request } }), lock,
    'foundation.public_review.requested')
  }
  async function observe(link: FoundationReviewLinkState): Promise<void> {
    if (link.convergenceStop || link.reviewOnlyComplete) return
    const invocation = link.invocation
    const observationStartedAt = new Date().toISOString()
    let controlTransition: 'run' | 'stop' | undefined
    if (invocation.stage === 'reviewer') {
      if (!invocation.handle && link.control.action === 'run') {
        link.invocationStartedAt = observationStartedAt
        link.currentCallElapsedMs = 0
        link.invocationLastObservedAt = observationStartedAt
        link.invocationTimingRunning = true
        invocation.handle = await input.reviewer.start(invocation.request)
      }
      if (!invocation.handle) return
      if (link.control.appliedSequence !== link.control.sequence) {
        const requestId = `${invocation.request.requestId}:control:${link.control.sequence}`
        controlTransition = link.control.action
        const transitionAt = new Date().toISOString()
        if (controlTransition === 'stop') {
          addInvocationElapsed(link, transitionAt)
          link.invocationTimingRunning = false
          await input.reviewer.stop({ handle: invocation.handle, requestId, reason: link.control.reason ?? 'user_requested' })
        } else {
          // Resume starts a fresh measured interval; the pause gap is not
          // attributed to the public invocation.
          link.invocationTimingRunning = true
          link.invocationLastObservedAt = transitionAt
          await input.reviewer.resume({ handle: invocation.handle, requestId })
        }
        link.control.appliedSequence = link.control.sequence
      }
      invocation.outcome = await input.reviewer.getResult(invocation.handle)
    } else {
      if (!invocation.handle && link.control.action === 'run') {
        link.invocationStartedAt = observationStartedAt
        link.currentCallElapsedMs = 0
        link.invocationLastObservedAt = observationStartedAt
        link.invocationTimingRunning = true
        invocation.handle = await input.revision.start(invocation.request)
      }
      if (!invocation.handle) return
      if (link.control.appliedSequence !== link.control.sequence) {
        const requestId = `${invocation.request.requestId}:control:${link.control.sequence}`
        controlTransition = link.control.action
        const transitionAt = new Date().toISOString()
        if (controlTransition === 'stop') {
          addInvocationElapsed(link, transitionAt)
          link.invocationTimingRunning = false
          await input.revision.stop({ handle: invocation.handle, requestId, reason: 'user_requested' })
        } else {
          link.invocationTimingRunning = true
          link.invocationLastObservedAt = transitionAt
          await input.revision.resume({ handle: invocation.handle, requestId })
        }
        link.control.appliedSequence = link.control.sequence
      }
      invocation.outcome = await input.revision.getResult(invocation.handle)
    }
    // Accumulate only intervals observed while the public invocation was
    // running. A stop/resume gap is intentionally excluded, and terminal
    // observations freeze the current value for idempotent replays.
    const observedAt = new Date().toISOString()
    if (invocation.outcome?.status === 'running') {
      if (controlTransition === 'run') {
        addInvocationElapsed(link, observedAt)
        link.invocationTimingRunning = true
        link.invocationLastObservedAt = observedAt
        delete link.invocationCompletedAt
      } else {
        addInvocationElapsed(link, observedAt)
      }
    } else if (invocation.outcome) {
      if (controlTransition !== 'stop') addInvocationElapsed(link, observedAt)
      if (link.invocationStartedAt && link.currentCallElapsedMs !== undefined)
        link.invocationCompletedAt = observedAt
      link.invocationTimingRunning = false
    }
    if (invocation.outcome?.handle.id !== invocation.handle?.id ||
        invocation.outcome?.handle.producer !== invocation.handle?.producer || invocation.outcome?.handle.protocolVersion !== 1)
      throw new Error('Foundation public result handle does not match invocation')
  }
  async function advance(run: DeliveryRun, link: FoundationReviewLinkState): Promise<void> {
    const invocation = link.invocation
    if (link.convergenceStop || link.reviewOnlyComplete || link.control.action !== 'run' || link.acceptedReview || invocation.outcome?.status !== 'completed' ||
        invocation.outcome.billingStatus !== 'settled') return
    const identity = { ownerId: run.ownerId, projectId: run.projectId }
    const nextSequence = link.sequence + 1
    if (invocation.stage === 'reviewer' && invocation.outcome.status === 'completed') {
      const result = invocation.outcome.result
      foundationResultBinding(identity, result)
      if (result.producer !== 'foundation-reviewer' || result.requestId !== invocation.request.requestId)
        throw new Error('Reviewer result does not match its request')
      if (result.inputDigest !== invocation.request.inputDigest ||
          foundationPublicJson(result.subject) !== foundationPublicJson(invocation.request.input.subject))
        throw new Error('Reviewer result source changed')
      if (invocation.request.input.subject.kind === 'candidate') {
        const candidateSource = link.repairSourceReview ?? link.sourceReview
        if (!candidateSource || !link.candidate || result.subject.kind !== 'candidate' ||
            result.subject.candidateResultId !== link.candidate.resultId || result.subject.candidateId !== link.candidate.candidateId ||
            result.subject.sourceReviewResultId !== candidateSource.resultId ||
            result.subject.sourceReviewResultDigest !== foundationResultBinding(identity, candidateSource).resultDigest)
          throw new Error('Reviewer candidate result source changed')
      }
      if (link.stopAfterReview) {
        if (link.sequence !== 0 || invocation.request.input.subject.kind !== 'initial')
          throw new Error('Reviewer-only policy requires the initial review')
        link.reviewOnlyComplete = true
        return
      }
      if (usesConvergencePolicy(link)) link.latestReview = structuredClone(result)
      const convergence = usesConvergencePolicy(link)
      const decision = convergence
        ? evaluateFoundationAcceptance({ ...identity, review: result, policyVersion: link.policyVersion,
            automaticRepairLimit: repairLimit(link), completedRepairCount: completedRepairs(link),
            riskDecisions: activeRiskDecisions(link, result, identity) })
        : undefined
      if (decision) link.acceptanceDecision = decision
      if (result.kind === 'passed' || (decision && ['accepted', 'accepted_with_advisories'].includes(decision.disposition))) {
        if (decision) link.acceptanceDecision = decision
        const expectedDocuments = invocation.request.input.documents
        const acceptedAuthor = link.importedAuthorResult ?? run.authorStage?.result
        // Actual project files must be published and verified before the
        // orchestration acknowledgment. Interrupted publication replays the
        // same accepted bytes; it never substitutes a snapshot read surface.
        run.revision = { ...run.revision, document: await publishFoundationAcceptedArtifacts({
          workspacePath: input.workspacePath, ...identity, review: result, expectedDocuments,
          ...(decision ? { acceptanceDecision: decision } : {}),
          ...(link.riskDecisions ? { riskDecisions: activeRiskDecisions(link, result, identity) } : {}),
          ...(acceptedAuthor ? { expectedWorkspaceDigests: foundationAuthorWorkspaceBaseline(acceptedAuthor) } : {}),
        }) }
        link.acceptedReview = structuredClone(result)
        return
      }
      if (result.kind !== 'issues_found') throw new Error('Reviewer result has no supported decision')
      if (decision?.disposition === 'needs_action') {
        link.sourceReview = structuredClone(result)
        link.convergenceStop = 'repair_budget_exhausted'
        return
      }
      // A candidate that did not change the document set gets one independent
      // re-review, but remains blocked if that review still has a blocker.
      if (decision?.disposition === 'repair_required' && link.candidate && !link.allowNoDocumentChangeOnce &&
          link.candidate.baseDocumentSetDigest === result.documentSetDigest) {
        link.acceptanceDecision = evaluateFoundationAcceptance({ ...identity, review: result, policyVersion: link.policyVersion,
          automaticRepairLimit: repairLimit(link), completedRepairCount: completedRepairs(link),
          riskDecisions: activeRiskDecisions(link, result, identity), noDocumentChange: true })
        link.sourceReview = structuredClone(result)
        link.convergenceStop = 'no_document_change_blocked'
        return
      }
      if (link.allowNoDocumentChangeOnce) delete link.allowNoDocumentChangeOnce
      // Durable legacy sequence also counts repairs across source-review resets.
      if (!decision && completedRepairs(link) >= repairLimit(link)) {
        link.convergenceStop = 'repair_budget_exhausted'
        return
      }
      if (decision && completedRepairs(link) >= repairLimit(link)) {
        link.sourceReview = structuredClone(result)
        link.convergenceStop = 'repair_budget_exhausted'
        return
      }
      link.sourceReview = structuredClone(result)
      archiveInvocationTiming(link)
      link.invocation = { stage: 'revision', request: createFoundationRepairRequest({ ...identity,
        requestId: requestId(run, nextSequence), source: link.sourceReview! }) }
    } else if (invocation.stage === 'revision' && invocation.outcome.status === 'completed') {
      const result = invocation.outcome.result
      foundationResultBinding(identity, result)
      if (!link.sourceReview || result.producer !== 'foundation-revision' || result.kind !== 'candidate_ready' ||
          invocation.outcome.inputDigest !== invocation.request.inputDigest || result.requestId !== invocation.request.requestId ||
          result.sourceReviewResultId !== link.sourceReview.resultId ||
          result.sourceReviewResultDigest !== foundationResultBinding(identity, link.sourceReview).resultDigest)
        throw new Error('Revision candidate does not match its accepted request')
      if (usesConvergencePolicy(link)) link.completedRepairCount = completedRepairs(link) + 1
      link.repairSourceReview = structuredClone(link.sourceReview!)
      // The prior report's decision used the previous budget snapshot. It is
      // not an acceptance of this candidate; recompute after its re-review.
      delete link.acceptanceDecision
      delete link.latestReview
      // Native summaries, including disputed findings without edits, go back
      // to Reviewer. The round limit bounds repetition, not byte heuristics.
      queueCandidateReview(run, link, result)
      return
    }
    link.sequence = nextSequence
  }
  async function tick(runId: string) {
    return locked(runId, async (current, lock) => {
      let run = await initialize(current, lock)
      if (!run.foundationReviewStage) return run
      const link = structuredClone(run.foundationReviewStage)
      if (link.acceptedReview || link.observationError || link.convergenceStop || link.reviewOnlyComplete) return run
      // Persisted request precedes start; only its public idempotency contract
      // is used after an ambiguous start. No worker ownership is inferred here.
      await observe(link)
      // Save the handle and observed result before constructing a successor.
      run = await save(project(run, link), lock, 'foundation.public_review.observed')
      const next = structuredClone(link)
      await advance(run, next)
      if (foundationPublicJson(next) !== foundationPublicJson(link))
        run = await save(project(run, next), lock, 'foundation.public_review.handoff')
      return run
    })
  }
  async function ensureProgress(run: DeliveryRun): Promise<DeliveryRun> {
    if (closed) return (await input.store.load()) ?? run
    try { const next = await tick(run.runId); watch(next); return next }
    catch (error) {
      const timer = timers.get(run.runId)
      if (timer) clearTimeout(timer)
      timers.delete(run.runId)
      await locked(run.runId, async (current, lock) => {
        if (current.status === 'stopped' || current.foundationReviewStage?.acceptedReview) return
        await save({ ...current, ...(current.foundationReviewStage ? {
          foundationReviewStage: { ...current.foundationReviewStage, observationError: true },
        } : {}), status: 'needs_action', thinking: 'idle', currentMessage: undefined,
          blockedReason: 'Foundation public handoff could not be safely completed. Explicit action is required.' }, lock,
        'foundation.public_review.needs_action')
      })
      throw error
    }
  }
  async function control(run: DeliveryRun, action: 'run' | 'stop', reason?: string) {
    await locked(run.runId, async (current, lock) => {
      assertBoundary(current)
      const original = current.foundationReviewStage
      if (original?.reviewOnlyComplete || (original?.convergenceStop && action === 'run')) return
      if (!original) {
        const author = current.authorStage!
        return save({ ...current, status: action === 'stop' ? 'stopped' : 'needs_action', blockedReason: reason,
          authorStage: { ...author, control: { ...author.control, sequence: author.control.sequence + 1, action,
            ...(reason ? { reason } : {}) } } }, lock, `foundation.public_review.${action}_before_start`)
      }
      if (action === 'run' && original.control.action === 'run' && current.status === 'running' &&
          original.control.appliedSequence === original.control.sequence && !original.observationError) return
      if (action === 'stop' && original.control.action === 'stop' &&
          original.control.reason === reason && !original.observationError) return
      const link = structuredClone(original)
      delete link.observationError
      // Repeated pending controls reuse the same durable command identity.
      if (link.control.action !== action || link.control.appliedSequence === link.control.sequence) {
        link.control = { sequence: link.control.sequence + 1, appliedSequence: link.control.appliedSequence, action,
          ...(reason ? { reason } : {}) }
      }
      await save(project(current, link), lock, `foundation.public_review.${action}_requested`)
    })
    return ensureProgress(run)
  }
  async function applyPolicyDecision(run: DeliveryRun, inputDecision: {
    riskDecisions?: FoundationRiskDecision[]
    /** HTTP request-level identity used to lock a multi-finding scope. */
    riskDecisionRequestId?: string
    authorization?: FoundationPolicyAuthorization
    precondition?: { runId: string; controlSequence: number; policyVersion?: string; automaticRepairLimit?: number; completedRepairCount?: number }
  }) {
    // A replay is an idempotent read of the durable decision. In particular,
    // it must not re-observe a legacy stopped invocation after an explicit
    // policy switch (a host may return a stale completed result and revive the
    // paused workflow if we call ensureProgress here).
    let shouldEnsureProgress = true
    await locked(run.runId, async (current, lock) => {
      const original = current.foundationReviewStage
      if (!original) throw new Error('Foundation convergence policy is not active for this run')
      if (inputDecision.riskDecisionRequestId && inputDecision.riskDecisions?.length) {
        const prefix = `${inputDecision.riskDecisionRequestId}:`
        const existingScope = (original.riskDecisions ?? [])
          .filter(decision => decision.decisionId.startsWith(prefix))
          .map(decision => decision.findingId)
          .sort()
        const requestedScope = inputDecision.riskDecisions.map(decision => decision.findingId).sort()
        if (existingScope.length && JSON.stringify(existingScope) !== JSON.stringify(requestedScope))
          throw new Error('Foundation risk decision ID payload conflict')
      }
      const replayAuthorization = inputDecision.authorization && (original.policyAuthorizations ?? []).find(item =>
        item.authorizationId === inputDecision.authorization!.authorizationId)
      if (replayAuthorization) {
        if (JSON.stringify(replayAuthorization) !== JSON.stringify(inputDecision.authorization))
          throw new Error('Foundation authorization ID payload conflict')
        shouldEnsureProgress = false
        return current
      }
      if (inputDecision.riskDecisions?.length && inputDecision.riskDecisions.every(decision =>
          (original.riskDecisions ?? []).some(existing => existing.decisionId === decision.decisionId && JSON.stringify(existing) === JSON.stringify(decision)))) {
        shouldEnsureProgress = false
        return current
      }
      const precondition = inputDecision.precondition
      if (precondition && (precondition.runId !== current.runId || precondition.controlSequence !== original.control.sequence ||
          precondition.policyVersion !== original.policyVersion || precondition.automaticRepairLimit !== original.automaticRepairLimit ||
          precondition.completedRepairCount !== original.completedRepairCount))
        throw new Error('Foundation policy decision is stale; reload the current workflow report')
      const switchingLegacyPolicy = inputDecision.authorization?.action === 'switch_policy' && original.policyVersion === undefined
      const stoppedLegacySwitch = switchingLegacyPolicy && current.status === 'stopped' && original.control.action === 'stop' &&
        original.invocation.outcome?.status === 'stopped' && original.invocation.outcome.billingStatus === 'settled'
      if ((!stoppedLegacySwitch && (current.status === 'running' || original.control.action === 'stop' || original.acceptedReview || original.invocation.outcome?.status !== 'completed' ||
          original.invocation.outcome.billingStatus !== 'settled' || !original.convergenceStop)))
        throw new Error('Foundation user decisions require a settled, stopped review')
      if (!switchingLegacyPolicy && !usesConvergencePolicy(original)) throw new Error('Foundation convergence policy is not active for this run')
      const link = structuredClone(original)
      if (inputDecision.riskDecisions?.length) {
        const currentReview = link.latestReview ?? link.sourceReview ?? (link.invocation.stage === 'reviewer' && link.invocation.outcome?.status === 'completed'
          ? link.invocation.outcome.result : undefined)
        if (!currentReview || currentReview.producer !== 'foundation-reviewer') throw new Error('No settled Foundation report is available for adjudication')
        const currentBinding = foundationResultBinding({ ownerId: current.ownerId, projectId: current.projectId }, currentReview)
        const existing = new Set((link.riskDecisions ?? []).map(decision => decision.decisionId))
        for (const decision of inputDecision.riskDecisions) {
          if (decision.reviewResultId !== currentReview.resultId || decision.reviewResultDigest !== currentBinding.resultDigest ||
              decision.documentSetDigest !== currentReview.documentSetDigest)
            throw new Error('Foundation risk decision is stale; reload the current workflow report')
          if (existing.has(decision.decisionId)) {
            const prior = link.riskDecisions!.find(item => item.decisionId === decision.decisionId)
            if (JSON.stringify(prior) !== JSON.stringify(decision)) throw new Error('Foundation risk decision ID payload conflict')
            continue
          }
          link.riskDecisions = [...(link.riskDecisions ?? []), structuredClone(decision)]
          existing.add(decision.decisionId)
        }
      }
      if (inputDecision.authorization) {
        const authorization = structuredClone(inputDecision.authorization)
        const priorAuthorization = (link.policyAuthorizations ?? []).find(item => item.authorizationId === authorization.authorizationId)
        if (priorAuthorization) {
          if (JSON.stringify(priorAuthorization) !== JSON.stringify(authorization)) throw new Error('Foundation authorization ID payload conflict')
          return current
        }
        if (authorization.action === 'grant_repair_budget') {
          if (authorization.toPolicyVersion !== FOUNDATION_ACCEPTANCE_POLICY_VERSION ||
              !Number.isSafeInteger(authorization.newAutomaticRepairLimit) ||
              authorization.newAutomaticRepairLimit! <= (link.automaticRepairLimit ?? DEFAULT_AUTOMATIC_REPAIR_LIMIT))
            throw new Error('Additional repair budget must increase the active policy limit')
          link.automaticRepairLimit = authorization.newAutomaticRepairLimit
          link.allowNoDocumentChangeOnce = true
          delete link.convergenceStop
        } else if (authorization.action === 'switch_policy') {
          if (original.policyVersion === FOUNDATION_ACCEPTANCE_POLICY_VERSION)
            throw new Error('Foundation policy switch is only valid for a legacy link')
          if (authorization.toPolicyVersion !== FOUNDATION_ACCEPTANCE_POLICY_VERSION)
            throw new Error('Unsupported Foundation policy switch')
          link.policyVersion = FOUNDATION_ACCEPTANCE_POLICY_VERSION
          link.completedRepairCount ??= Math.floor(link.sequence / 2)
          link.automaticRepairLimit = authorization.newAutomaticRepairLimit ?? link.completedRepairCount + DEFAULT_AUTOMATIC_REPAIR_LIMIT
          delete link.convergenceStop
        }
        link.policyAuthorizations = [...(link.policyAuthorizations ?? []), authorization]
      }
      if (inputDecision.riskDecisions?.length) delete link.convergenceStop
      if (inputDecision.riskDecisions?.length || inputDecision.authorization) delete link.acceptanceDecision
      await save(project(current, link), lock, 'foundation.public_review.policy_decision')
      if (stoppedLegacySwitch) shouldEnsureProgress = false
    })
    return shouldEnsureProgress ? ensureProgress(run) : ((await input.store.load()) ?? run)
  }
  return {
    ensureProgress,
    resume: (run: DeliveryRun) => control(run, 'run'),
    stop: (run: DeliveryRun, reason: string) => control(run, 'stop', reason),
    applyPolicyDecision,
    dispose() { closed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear() },
  }
}
