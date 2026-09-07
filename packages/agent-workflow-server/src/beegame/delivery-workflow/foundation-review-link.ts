import type { createFoundationReviewer, ReviewerHandle, ReviewerStartInput, ReviewerResult, ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import type { createFoundationRevision, RevisionHandle, RevisionStartInput, RevisionResult } from '../stage-modules/foundation-revision/public'
import type { DeliveryRun } from './types'
import type { RunStore, WorkflowLock } from './run-store'
import { createHash } from 'node:crypto'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import { foundationAuthorWorkspaceBaseline, publishFoundationAcceptedArtifacts } from './foundation-accepted-artifacts'
import {
  createFoundationInitialReviewRequest, createFoundationRepairRequest, createFoundationCandidateReviewRequest,
  foundationPublicJson, foundationResultBinding,
  type FoundationCandidateResult, type FoundationPreviousReview,
} from './foundation-public-handoff'

type ReviewerInvocation = { stage: 'reviewer'; request: ReviewerStartInput; handle?: ReviewerHandle; outcome?: ReviewerResult }
type RevisionInvocation = { stage: 'revision'; request: RevisionStartInput; handle?: RevisionHandle; outcome?: RevisionResult }
export type FoundationReviewLinkState = {
  protocolVersion: 1
  authorResultId: string
  /** Copied public provenance, never an execution handle for this project. */
  importedAuthorResult?: AuthorDocumentsResult
  sequence: number
  control: { sequence: number; appliedSequence: number; action: 'run' | 'stop'; reason?: string }
  invocation: ReviewerInvocation | RevisionInvocation
  sourceReview?: ReviewerReviewResult
  candidate?: FoundationCandidateResult
  previous?: FoundationPreviousReview
  acceptedReview?: ReviewerReviewResult
  observationError?: boolean
}

const PASSED_STOP = 'Foundation review passed. Checklist handoff awaits acceptance.'

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
  function watch(run: DeliveryRun) {
    const link = run.foundationReviewStage
    if (closed || timers.has(run.runId) || !link || link.acceptedReview || run.status !== 'running') return
    const timer = setTimeout(() => {
      timers.delete(run.runId)
      void ensureProgress(run).catch(() => undefined) // ensureProgress records observation failure durably.
    }, input.pollIntervalMs ?? 250)
    timer.unref()
    timers.set(run.runId, timer)
  }
  function project(run: DeliveryRun, link: FoundationReviewLinkState): DeliveryRun {
    const outcome = link.invocation.outcome
    const stopping = link.control.action === 'stop'
    const complete = Boolean(link.acceptedReview)
    const status = complete ? (stopping ? 'stopped' : 'needs_action')
      : !link.invocation.handle ? (stopping ? 'needs_action' : 'running')
      : outcome?.status === 'stopped' ? 'stopped'
      : outcome?.status === 'needs_action' ? 'needs_action'
      : outcome?.status === 'failed' ? 'failed'
      : stopping ? 'needs_action' : 'running'
    const reason = complete ? PASSED_STOP : outcome?.status === 'needs_action' || outcome?.status === 'failed' ? outcome.reason
      : stopping ? link.control.reason ?? 'Foundation stage stop is awaiting acknowledgment.'
      : outcome?.status === 'completed' && outcome.billingStatus !== 'settled' ? 'Foundation public result is awaiting billing settlement.' : undefined
    return { ...run, foundationReviewStage: link,
      phase: link.invocation.stage === 'revision' && !complete ? 'FOUNDATION_REVISION' : 'DOCUMENT_REVIEW',
      documentStep: link.invocation.stage === 'revision' && !complete ? 'FOUNDATION_REVISION' : 'FOUNDATION_REVIEW',
      status, thinking: status === 'running' ? 'working' : 'idle', blockedReason: reason,
      currentMessage: complete ? PASSED_STOP : status === 'running' ? `Foundation ${link.invocation.stage} is running.` : undefined }
  }
  async function initialize(run: DeliveryRun, lock: WorkflowLock) {
    assertBoundary(run)
    if (run.foundationReviewStage || run.authorStage!.control.action === 'stop' || run.status === 'stopped' ||
        run.blockedReason === 'Foundation public handoff could not be safely completed. Explicit action is required.') return run
    const request = await createFoundationInitialReviewRequest({ workspacePath: input.workspacePath, requestId: requestId(run, 0),
      expected: { ownerId: run.ownerId, projectId: run.projectId, inputDigest: run.authorStage!.inputDigest,
        confirmedBriefDigest: run.confirmedBriefDigest }, result: run.authorStage!.result! })
    return save(project(run, { protocolVersion: 1, authorResultId: run.authorStage!.result!.resultId, sequence: 0,
      control: { sequence: 0, appliedSequence: 0, action: 'run' }, invocation: { stage: 'reviewer', request } }), lock,
    'foundation.public_review.requested')
  }
  async function observe(link: FoundationReviewLinkState): Promise<void> {
    const invocation = link.invocation
    if (invocation.stage === 'reviewer') {
      if (!invocation.handle && link.control.action === 'run') invocation.handle = await input.reviewer.start(invocation.request)
      if (!invocation.handle) return
      if (link.control.appliedSequence !== link.control.sequence) {
        const requestId = `${invocation.request.requestId}:control:${link.control.sequence}`
        if (link.control.action === 'stop') await input.reviewer.stop({ handle: invocation.handle, requestId, reason: link.control.reason ?? 'user_requested' })
        else await input.reviewer.resume({ handle: invocation.handle, requestId })
        link.control.appliedSequence = link.control.sequence
      }
      invocation.outcome = await input.reviewer.getResult(invocation.handle)
    } else {
      if (!invocation.handle && link.control.action === 'run') invocation.handle = await input.revision.start(invocation.request)
      if (!invocation.handle) return
      if (link.control.appliedSequence !== link.control.sequence) {
        const requestId = `${invocation.request.requestId}:control:${link.control.sequence}`
        if (link.control.action === 'stop') await input.revision.stop({ handle: invocation.handle, requestId, reason: 'user_requested' })
        else await input.revision.resume({ handle: invocation.handle, requestId })
        link.control.appliedSequence = link.control.sequence
      }
      invocation.outcome = await input.revision.getResult(invocation.handle)
    }
    if (invocation.outcome?.handle.id !== invocation.handle?.id ||
        invocation.outcome?.handle.producer !== invocation.handle?.producer || invocation.outcome?.handle.protocolVersion !== 1)
      throw new Error('Foundation public result handle does not match invocation')
  }
  async function advance(run: DeliveryRun, link: FoundationReviewLinkState): Promise<void> {
    const invocation = link.invocation
    if (link.control.action !== 'run' || link.acceptedReview || invocation.outcome?.status !== 'completed' ||
        invocation.outcome.billingStatus !== 'settled') return
    const identity = { ownerId: run.ownerId, projectId: run.projectId }
    const nextSequence = link.sequence + 1
    if (invocation.stage === 'reviewer' && invocation.outcome.status === 'completed') {
      const result = invocation.outcome.result
      foundationResultBinding(identity, result)
      if (result.producer !== 'foundation-reviewer' || result.requestId !== invocation.request.requestId)
        throw new Error('Reviewer result does not match its request')
      if (!('kind' in invocation.request.input)) {
        if (result.inputDigest !== invocation.request.inputDigest ||
            foundationPublicJson(result.subject) !== foundationPublicJson(invocation.request.input.subject))
          throw new Error('Initial Reviewer result source changed')
      } else {
        if (!link.sourceReview || !link.candidate || result.subject.kind !== 'candidate' ||
            result.subject.candidateResultId !== link.candidate.resultId || result.subject.candidateId !== link.candidate.candidateId ||
            result.subject.sourceReviewResultId !== link.sourceReview.resultId ||
            result.subject.sourceReviewResultDigest !== foundationResultBinding(identity, link.sourceReview).resultDigest ||
            result.recheck?.candidateResultDigest !== foundationResultBinding(identity, link.candidate).resultDigest)
          throw new Error('Reviewer candidate result source changed')
      }
      if (result.kind === 'passed') {
        const expectedDocuments = 'subject' in invocation.request.input
          ? invocation.request.input.documents : link.candidate!.documents
        const acceptedAuthor = link.importedAuthorResult ?? run.authorStage?.result
        // Actual project files must be published and verified before the
        // orchestration acknowledgment. Interrupted publication replays the
        // same accepted bytes; it never substitutes a snapshot read surface.
        run.revision = { ...run.revision, document: await publishFoundationAcceptedArtifacts({
          workspacePath: input.workspacePath, ...identity, review: result, expectedDocuments,
          ...(acceptedAuthor ? { expectedWorkspaceDigests: foundationAuthorWorkspaceBaseline(acceptedAuthor) } : {}),
        }) }
        link.acceptedReview = structuredClone(result)
        return
      }
      if (result.kind !== 'issues_found') throw new Error('Reviewer result has no supported decision')
      if (result.recheck?.kind === 'targeted' && result.recheck.decision === 'retry_same_round') {
        if (!link.sourceReview || !link.candidate) throw new Error('Same-round retry requires accepted predecessors')
        link.previous = { candidate: structuredClone(link.candidate), recheck: structuredClone(result) }
      } else {
        link.sourceReview = structuredClone(result)
        delete link.previous
      }
      link.invocation = { stage: 'revision', request: createFoundationRepairRequest({ ...identity,
        requestId: requestId(run, nextSequence), source: link.sourceReview!, ...(link.previous ? { previous: link.previous } : {}) }) }
    } else if (invocation.stage === 'revision' && invocation.outcome.status === 'completed') {
      const result = invocation.outcome.result
      foundationResultBinding(identity, result)
      if (!link.sourceReview || result.producer !== 'foundation-revision' || result.kind !== 'candidate_ready' ||
          invocation.outcome.inputDigest !== invocation.request.inputDigest || result.requestId !== invocation.request.requestId ||
          result.sourceReviewResultId !== link.sourceReview.resultId ||
          result.sourceReviewResultDigest !== foundationResultBinding(identity, link.sourceReview).resultDigest)
        throw new Error('Revision candidate does not match its accepted request')
      link.candidate = structuredClone(result)
      link.invocation = { stage: 'reviewer', request: createFoundationCandidateReviewRequest({ ...identity,
        requestId: requestId(run, nextSequence), source: link.sourceReview, candidate: result,
        ...(link.previous ? { previous: link.previous } : {}) }) }
    }
    link.sequence = nextSequence
  }
  async function tick(runId: string) {
    return locked(runId, async (current, lock) => {
      let run = await initialize(current, lock)
      if (!run.foundationReviewStage) return run
      const link = structuredClone(run.foundationReviewStage)
      if (link.acceptedReview || link.observationError) return run
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
  return {
    ensureProgress,
    resume: (run: DeliveryRun) => control(run, 'run'),
    stop: (run: DeliveryRun, reason: string) => control(run, 'stop', reason),
    dispose() { closed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear() },
  }
}
