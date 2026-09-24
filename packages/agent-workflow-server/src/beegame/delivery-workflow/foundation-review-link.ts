import { type createFoundationReviewer, type ReviewerHandle, type ReviewerStartInput, type ReviewerResult, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import type { DeliveryRun } from './types'
import type { RunStore, WorkflowLock } from './run-store'
import { isFoundationStageActive } from './public-stage-routing'
import { createHash } from 'node:crypto'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import { foundationAuthorWorkspaceBaseline, publishFoundationAcceptedArtifacts } from './foundation-accepted-artifacts'
import {
  createFoundationInitialReviewRequest,
  createFoundationCurrentReviewRequest,
  canonicalReviewSourceRevision,
  foundationPublicJson, foundationResultBinding,
} from './foundation-public-handoff'

type ReviewerInvocation = { stage: 'reviewer'; request: ReviewerStartInput; handle?: ReviewerHandle; outcome?: ReviewerResult }
export type FoundationReviewLinkState = {
  protocolVersion: 1
  authorResultId: string
  /** Copied public provenance, never an execution handle for this project. */
  importedAuthorResult?: AuthorDocumentsResult
  /** This review is bound to canonical project files changed after initial publication. */
  canonicalRecheck?: true
  control: { sequence: number; appliedSequence: number; action: 'run' | 'stop'; reason?: string }
  invocation: ReviewerInvocation
  acceptedReview?: ReviewerReviewResult
  /** Workflow-observed public invocation timing. These fields are absent for
   * legacy snapshots where the invocation boundary was never recorded. */
  invocationStartedAt?: string
  invocationCompletedAt?: string
  invocationLastObservedAt?: string
  invocationTimingRunning?: boolean
  currentCallElapsedMs?: number
  historicalElapsedMs?: number
  observationError?: boolean
}

const PASSED_STOP = 'Foundation document review and correction completed. Explicit continuation is required.'
const AUTO_HANDOFF = 'Foundation document review and correction completed. Preparing the acceptance checklist.'

function isComplete(link: FoundationReviewLinkState) {
  return Boolean(link.acceptedReview)
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
  const input = link.invocation.request.input
  if (link.invocation.stage !== 'reviewer' || input.subject.kind !== 'initial')
    throw new Error('Imported Reviewer request is invalid')
  if (link.canonicalRecheck) {
    if (!input.subject.sourceResultId.startsWith('canonical:') ||
        input.subject.confirmedBriefDigest !== result.confirmedBriefDigest || input.documents.length !== result.documents.length ||
        input.subject.sourceDocumentRevision !== canonicalReviewSourceRevision(input.documents) ||
        input.subject.sourceResultId !== `canonical:${input.subject.sourceDocumentRevision}`)
      throw new Error('Canonical Reviewer request does not bind the confirmed brief')
    return
  }
  if (
      input.subject.sourceResultId !== result.resultId || input.subject.sourceDocumentRevision !== result.documentRevision ||
      input.subject.confirmedBriefDigest !== result.confirmedBriefDigest || input.documents.length !== result.documents.length ||
      input.documents.some((document, index) => {
        const artifact = result.documents[index]!
        return document.path !== artifact.path || Buffer.byteLength(document.content, 'utf8') !== artifact.byteLength ||
          createHash('sha256').update(document.content).digest('hex') !== artifact.digest
      })) throw new Error('Imported Reviewer request does not bind frozen Author artifacts')
}

/** Existing workflow orchestration only. Every execution/control operation is
 * delegated to a public port; no stage lease, worker or checkpoint is touched. */
export function createFoundationReviewLink(input: {
  workspacePath: string
  store: RunStore
  reviewer: ReturnType<typeof createFoundationReviewer>
  pollIntervalMs?: number
  onCompleted?(run: DeliveryRun): void
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
    return input.store.commit(run, { runId: run.runId, type, phase: run.phase,
      ...(run.documentStep ? { documentStep: run.documentStep } : {}), status: run.status, revision: run.revision }, undefined, lock)
  }
  function assertBoundary(run: DeliveryRun) {
    const recheck = run.foundationReviewStage
    if (recheck?.canonicalRecheck && (
      recheck.invocation.request.input.subject.sourceDocumentRevision !==
        canonicalReviewSourceRevision(recheck.invocation.request.input.documents) ||
      recheck.invocation.request.input.subject.sourceResultId !==
        `canonical:${recheck.invocation.request.input.subject.sourceDocumentRevision}`))
      throw new Error('Canonical Reviewer request changed after capture')
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
  function addInvocationElapsed(link: FoundationReviewLinkState, until: string) {
    if (link.invocationTimingRunning !== true || link.invocationLastObservedAt === undefined) return
    const fromMs = Date.parse(link.invocationLastObservedAt)
    const untilMs = Date.parse(until)
    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) return
    link.currentCallElapsedMs = (link.currentCallElapsedMs ?? 0) + Math.max(0, untilMs - fromMs)
    link.invocationLastObservedAt = until
  }
  function watch(run: DeliveryRun) {
    const link = run.foundationReviewStage
    const stopPending = link?.control.action === 'stop' && Boolean(link.invocation.handle) &&
      (link.invocation.outcome?.status === 'running' || link.invocation.outcome?.billingStatus === 'pending')
    if (closed || timers.has(run.runId) || !link || isComplete(link) ||
        (run.status !== 'running' && !stopPending)) return
    const timer = setTimeout(() => {
      timers.delete(run.runId)
      void ensureProgress(run).catch(() => undefined) // ensureProgress records observation failure durably.
    }, input.pollIntervalMs ?? 1000)
    timer.unref()
    timers.set(run.runId, timer)
  }
  function project(run: DeliveryRun, link: FoundationReviewLinkState): DeliveryRun {
    const outcome = link.invocation.outcome
    const stopping = link.control.action === 'stop'
    const complete = isComplete(link)
    const status = complete ? (stopping ? 'stopped' : input.onCompleted ? 'running' : 'needs_action')
      : !link.invocation.handle ? (stopping ? 'needs_action' : 'running')
      : outcome?.status === 'stopped' ? 'stopped'
      : outcome?.status === 'needs_action' ? 'needs_action'
      : outcome?.status === 'failed' ? 'failed'
      : stopping && outcome?.status !== 'running' ? 'needs_action' : 'running'
    const reason = complete ? (status === 'needs_action' ? PASSED_STOP : undefined)
      : outcome?.status === 'needs_action' || outcome?.status === 'failed' ? outcome.reason
      : stopping ? link.control.reason ?? 'Foundation stage stop is awaiting acknowledgment.'
      : outcome?.status === 'completed' && outcome.billingStatus !== 'settled' ? 'Foundation public result is awaiting billing settlement.' : undefined
    const applyingRevision = !complete && outcome?.status === 'completed' && outcome.billingStatus === 'settled'
    return { ...run, foundationReviewStage: link,
      phase: 'DOCUMENT_REVIEW',
      documentStep: applyingRevision || complete ? 'FOUNDATION_REVISION' : 'FOUNDATION_REVIEW',
      status, thinking: status === 'running' ? 'working' : 'idle', blockedReason: reason,
      currentMessage: complete ? (input.onCompleted ? AUTO_HANDOFF : PASSED_STOP) : stopping && status !== 'stopped'
        ? '停止请求已提交，正在等待执行退出或清理确认。' : status === 'running'
        ? applyingRevision ? 'Applying reviewed document revisions.'
          : outcome?.progress ? `模型响应 ${outcome.progress.modelResponses} · ${outcome.progress.message}` : 'Foundation document review is running.' : undefined }
  }
  async function initialize(run: DeliveryRun, lock: WorkflowLock) {
    assertBoundary(run)
    if (run.foundationReviewStage || run.authorStage!.control.action === 'stop' || run.status === 'stopped' ||
        run.blockedReason === 'Foundation public handoff could not be safely completed. Explicit action is required.') return run
    const request = await createFoundationInitialReviewRequest({ workspacePath: input.workspacePath, requestId: requestId(run, 0),
      confirmedBriefContext: run.confirmedBriefContext,
      expected: { ownerId: run.ownerId, projectId: run.projectId, inputDigest: run.authorStage!.inputDigest,
        confirmedBriefDigest: run.confirmedBriefDigest }, result: run.authorStage!.result! })
    return save(project(run, { protocolVersion: 1, authorResultId: run.authorStage!.result!.resultId,
      historicalElapsedMs: 0,
      control: { sequence: 0, appliedSequence: 0, action: 'run' }, invocation: { stage: 'reviewer', request } }), lock,
    'foundation.public_review.requested')
  }
  async function observe(link: FoundationReviewLinkState): Promise<void> {
    const invocation = link.invocation
    const observationStartedAt = new Date().toISOString()
    let controlTransition: 'run' | 'stop' | undefined
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
    if (link.control.action !== 'run' || isComplete(link) || invocation.outcome?.status !== 'completed' ||
        invocation.outcome.billingStatus !== 'settled') return
    const identity = { ownerId: run.ownerId, projectId: run.projectId }
    const result = invocation.outcome.result
    foundationResultBinding(identity, result)
    if (result.producer !== 'foundation-reviewer' || result.requestId !== invocation.request.requestId)
      throw new Error('Reviewer result does not match its request')
    if (result.inputDigest !== invocation.request.inputDigest ||
        foundationPublicJson(result.subject) !== foundationPublicJson(invocation.request.input.subject))
      throw new Error('Reviewer result source changed')
    const acceptedAuthor = link.importedAuthorResult ?? run.authorStage?.result
    // Actual project files must be published and verified before the
    // orchestration acknowledgment. Interrupted publication replays the
    // same accepted bytes; it never substitutes a snapshot read surface.
    run.revision = { ...run.revision, document: await publishFoundationAcceptedArtifacts({
      workspacePath: input.workspacePath, ...identity, review: result, expectedDocuments: result.documents,
      ...(link.canonicalRecheck
        ? { expectedWorkspaceDigests: invocation.request.input.documents.map(document => ({ path: document.path,
          digest: createHash('sha256').update(document.content).digest('hex') })) }
        : acceptedAuthor ? { expectedWorkspaceDigests: foundationAuthorWorkspaceBaseline(acceptedAuthor) } : {}),
    }) }
    link.acceptedReview = structuredClone(result)
  }
  async function tick(runId: string) {
    return locked(runId, async (current, lock) => {
      if (!isFoundationStageActive(current)) return current
      let run = await initialize(current, lock)
      if (!run.foundationReviewStage) return run
      const link = structuredClone(run.foundationReviewStage)
      if (isComplete(link) || link.observationError) return run
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
    try {
      const next = await tick(run.runId)
      watch(next)
      if (next.foundationReviewStage?.acceptedReview && next.status !== 'stopped' &&
          next.foundationReviewStage.control.action !== 'stop') input.onCompleted?.(next)
      return next
    }
    catch (error) {
      const timer = timers.get(run.runId)
      if (timer) clearTimeout(timer)
      timers.delete(run.runId)
      await locked(run.runId, async (current, lock) => {
        if (current.status === 'stopped' || (current.foundationReviewStage && isComplete(current.foundationReviewStage))) return
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
    const handedOff = await locked(run.runId, async (current, lock) => {
      if (!isFoundationStageActive(current)) return current
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
    if (handedOff && !isFoundationStageActive(handedOff)) return handedOff
    return ensureProgress(run)
  }
  return {
    ensureProgress,
    async restartFromWorkspace(run: DeliveryRun, reason: string) {
      const restarted = await locked(run.runId, async (current, lock) => {
        assertBoundary(current)
        const prior = current.foundationReviewStage
        if (!prior?.acceptedReview) throw new Error('Canonical re-review requires accepted Foundation documents')
        const request = await createFoundationCurrentReviewRequest({ workspacePath: input.workspacePath,
          requestId: requestId(current, prior.control.sequence + 1),
          confirmedBriefContext: current.confirmedBriefContext,
          expected: { ownerId: current.ownerId, projectId: current.projectId,
            confirmedBriefDigest: current.confirmedBriefDigest } })
        const link: FoundationReviewLinkState = { protocolVersion: 1, authorResultId: prior.authorResultId,
          ...(prior.importedAuthorResult ? { importedAuthorResult: prior.importedAuthorResult } : {}),
          canonicalRecheck: true,
          historicalElapsedMs: (prior.historicalElapsedMs ?? 0) + (prior.currentCallElapsedMs ?? 0),
          control: { sequence: prior.control.sequence + 1, appliedSequence: prior.control.sequence + 1, action: 'run' },
          invocation: { stage: 'reviewer', request } }
        return save({ ...project(current, link), activeDispatch: undefined, activeTaskId: undefined,
          tasks: [], gameContentReceipt: undefined, resourceProductionState: { currentTask: 'RESOURCE_DELIVERY' },
          revision: { ...current.revision, resource: undefined, content: undefined, implementation: undefined },
          evidence: {}, blockedReason: reason }, lock, 'foundation.public_review.restarted')
      })
      return ensureProgress(restarted)
    },
    resume: (run: DeliveryRun) => control(run, 'run'),
    stop: (run: DeliveryRun, reason: string) => control(run, 'stop', reason),
    dispose() { closed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear() },
  }
}
