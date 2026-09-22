import { auditAssetContract } from '../asset-contract-audit'
import {
  CONTENT_AUTHORING_CONTRACT_PATH,
  GAME_CONTENT_INSPECTION_COMMAND,
  GAME_CONTENT_VALIDATION_COMMAND,
} from '../scene-ui-content-authoring'
import { foundationPublicDigest } from '../foundation-public-result'
import { readBeeGameAssetManifestSync } from '../asset-contracts'
import {
  acceptBeeGameContentPackage,
  auditBeeGameContentPackage,
  loadBeeGameContentFileListForEditing,
  loadBeeGameContentPackageForEditing,
  saveBeeGameContentDocument,
  type BeeGameContentDocument,
} from '../game-content-package'
import { readAcceptanceChecklistIds } from '../document-readiness-audit'
import {
auditResourceDeliveryReadiness,
confirmedResourceLibraryUsage,
type ResourceDeliveryReadiness,
} from '../resource-delivery-readiness'
import type { createFoundationAuthoring } from '../stage-modules/foundation-authoring/public'
import type { createFoundationReviewer } from '../stage-modules/foundation-reviewer/public'
import { isFoundationStageActive, isPublicStageActive } from './public-stage-routing'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
import {
isProjectChange,
buildQuestionAnswerDispatch,
createChangeRequest,
} from './change-request'
import { createDeliveryDispatcher } from './dispatch'
import { directImplementationTask } from './direct-implementation-task'
import {
completeDocumentDraft,
startChecklistDraftStage,
} from './document-stage'
import { assertNoRetiredFoundationReviewRun, assertNoRetiredFoundationWorker } from './retired-foundation-review'
import { createFoundationAuthoringLink } from './foundation-authoring-link'
import { createFoundationReviewLink } from './foundation-review-link'
import {
completeImplementationTask,
bindImplementationEvidence,
implementationCompletionIssue,
refreshImplementationArtifacts,
startNextImplementationTask,
} from './implementation-stage'
import {
completeResourceTask,
startResourcePreparation,
} from './resource-stage'
import {
completeGameContentStage,
startGameContentStage,
} from './game-content-stage'
import { RETIRED_FOUNDATION_AUTHOR } from './retired-foundation-author'
import {
computeDocumentRevision,
computeResourceRevision,
computeWorkspaceRevision,
} from './revision'
import { createRunStore } from './run-store'
import { stopRun } from './recovery'
import { transitionDeliveryRun } from './transition'
import type {
DeliveryRun,
DeliveryWorkerPort,
DispatchRecord,
WorkerDispatchRequest
} from './types'
import {
CANONICAL_DOCUMENT_ARTIFACTS
} from './types'
import {
confirmAcceptanceFromImplementation,
enterAcceptance,
} from './validation-stage'
import {
type WorkerTerminalResult
} from './worker-contracts'
import { readRuntimeAcceptance } from './runtime-acceptance'
export function createDeliveryWorkflowController(input: {
  workspacePath: string
  ownerId: string
  workerPort: DeliveryWorkerPort
  assertWorkspaceIdle?: () => void
  author?: ReturnType<typeof createFoundationAuthoring>
  reviewer?: ReturnType<typeof createFoundationReviewer>
  handoffRecoveryGraceMs?: number
}) {
  const store = createRunStore(input.workspacePath, input.ownerId)
  const reviewLink = input.reviewer ? createFoundationReviewLink({ workspacePath: input.workspacePath,
    store, reviewer: input.reviewer,
    onCompleted: (run: DeliveryRun) => { void ensureProgress(run).catch(() => undefined) } }) : undefined
  const authorLink = input.author ? createFoundationAuthoringLink({ store, author: input.author,
    ...(reviewLink ? { onCompleted: (run: DeliveryRun) => ensureProgress(run) } : {}) }) : undefined
  async function progressPublicFoundation(run: DeliveryRun, resume = false) {
    input.assertWorkspaceIdle?.()
    if (run.foundationReviewStage?.acceptedReview && run.status !== 'stopped' &&
        run.foundationReviewStage.control.action !== 'stop') {
      const documentRevision = await computeDocumentRevision(
        input.workspacePath,
        run.confirmedBriefDigest,
      )
      const next: DeliveryRun = {
        ...run,
        phase: 'RESOURCE_PREPARATION',
        documentStep: undefined,
        status: 'running',
        activeDispatch: undefined,
        activeTaskId: undefined,
        tasks: [],
        revision: {
          ...run.revision,
          document: documentRevision,
          resource: undefined,
          content: undefined,
          implementation: undefined,
        },
        evidence: {},
        resourceProductionState: { currentTask: 'RESOURCE_DELIVERY' },
        blockedReason: undefined,
      }
      const saved = await persist(next, 'phase.entered')
      await resumeUnlocked(saved)
      return saved
    }
    if (run.foundationReviewStage || run.authorStage?.status === 'completed') {
      if (reviewLink) return resume ? reviewLink.resume(run) : reviewLink.ensureProgress(run)
      return run
    }
    return resume ? requireAuthorLink().resume(run) : requireAuthorLink().ensureProgress(run)
  }
  async function stopFoundation(run: DeliveryRun, reason: string): Promise<DeliveryRun> {
    const current = await store.load()
    if (!current || current.runId !== run.runId) throw new Error('Foundation stop run changed')
    if (!isPublicStageActive(current)) return stopRun({ store, runId: current.runId, reason,
      sessionIsOpen: dispatch => dispatcher.workerIsOpen(dispatch.dispatchId),
      stopDispatch: (dispatchId, stopReason) => dispatcher.stop(dispatchId, stopReason) })
    if ((current.foundationReviewStage || current.authorStage?.status === 'completed') && reviewLink) {
      const stopped = await reviewLink.stop(current, reason)
      return isFoundationStageActive(stopped) ? stopped : stopFoundation(stopped, reason)
    }
    const stopped = await requireAuthorLink().stop(current, reason)
    return stopped.authorStage?.status === 'completed' && reviewLink ? reviewLink.stop(stopped, reason) : stopped
  }
  function requireAuthorLink() {
    if (!authorLink) throw new Error('Foundation author public module is required; legacy author execution is retired')
    return authorLink
  }
  let dispatcher: ReturnType<typeof createDeliveryDispatcher>
  let controllerTail: Promise<void> = Promise.resolve()
  // A completed fact envelope may be durable before its serialized admission
  // callback starts. Recovery must not race that callback by replaying the
  // same envelope through the unlocked handler.
  const handoffRecoveryGraceMs = input.handoffRecoveryGraceMs ?? 1_000

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = controllerTail
    const current = previous.catch(() => undefined).then(operation)
    controllerTail = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  const transportDispatcher = createDeliveryDispatcher({
    store,
    workerPort: input.workerPort,
    onTerminal: async (record, result, request) =>
      handleTerminal(record, result, request),
  })
  dispatcher = {
    ...transportDispatcher,
    async dispatch(request) {
      input.assertWorkspaceIdle?.()
      if (isProjectChange(request)) throw new Error('Project requests use the native project conversation, not delivery dispatches')
      assertNoRetiredFoundationWorker(request)
      const run = await store.load()
      let contentContract: Record<string, unknown> = {}
      if (run && run.runId === request.runId && request.workerType === 'implementation-worker' && !isProjectChange(request)) {
        if (!run.gameContentReceipt)
          throw new Error('downstream work requires an accepted Scene/UI content receipt')
        const assetManifestRevision = run.revision.resource
        if (!assetManifestRevision)
          throw new Error('Scene/UI consumer requires an accepted Asset Manifest revision')
        let audit: ReturnType<typeof auditBeeGameContentPackage>
        try {
          audit = auditBeeGameContentPackage(input.workspacePath, {
            documentRevision: run.revision.document,
            assetManifestRevision,
            manifest: readBeeGameAssetManifestSync(input.workspacePath),
          })
        } catch (error) {
          audit = { valid: false, issues: [error instanceof Error ? error.message : String(error)] }
        }
        contentContract = {
          gameContent: { indexPath: 'content/index.json', contentIds: run.gameContentReceipt.contentIds,
            revision: audit.package?.digest ?? run.revision.content,
            authoringContractPath: CONTENT_AUTHORING_CONTRACT_PATH,
            validationCommand: GAME_CONTENT_VALIDATION_COMMAND,
            inspectionCommand: GAME_CONTENT_INSPECTION_COMMAND },
          ...(!audit.valid ? { currentImplementationIssues: [
            ...(Array.isArray(request.contract.currentImplementationIssues)
              ? request.contract.currentImplementationIssues : []),
            ...audit.issues,
          ] } : {}),
        }
      }
      return transportDispatcher.dispatch({ ...request,
        protectedPaths: [...new Set([...(request.protectedPaths ?? []), ...CANONICAL_DOCUMENT_ARTIFACTS,
          ...(request.workerType === 'content-author' ? ['assets/'] : [])])],
        contract: { ...request.contract, ...contentContract } })
    },
  }

  async function persist(
    run: DeliveryRun,
    eventType: string,
    details: Record<string, unknown> = {},
  ): Promise<DeliveryRun> {
    const previous = await store.load()
    const acceptedUnits = previous
      ? deriveAcceptedWorkflowUnits(previous, run)
      : []
    const committed = await store.commit(
      run,
      {
        runId: run.runId,
        type: eventType,
        phase: run.phase,
        status: run.status,
        revision: run.revision,
        activeTaskId: run.activeTaskId,
        ...details,
      },
      acceptedUnits,
    )
    scheduleOrphanedHandoffRecovery(committed)
    return committed
  }

  function scheduleOrphanedHandoffRecovery(run: DeliveryRun): void {
    if (
      handoffRecoveryGraceMs < 0 ||
      run.status !== 'running' ||
      run.activeDispatch
    )
      return
    const handoffUpdatedAt = run.updatedAt
    const timer = setTimeout(() => {
      void serialize(async () => {
        const current = await store.load()
        if (
          !current ||
          current.status !== 'running' ||
          current.activeDispatch ||
          current.updatedAt !== handoffUpdatedAt
        )
          return
        await resumeUnlocked(current)
      }).catch(() => undefined)
    }, handoffRecoveryGraceMs)
    timer.unref()
  }

  async function contractFactsFor(run: DeliveryRun): Promise<
    {
      checklistIds: string[]
      resourceIds: string[]
      contentIds: string[]
      resourceReadiness: ResourceDeliveryReadiness
    }
  > {
    const facts = await implementationContractFacts(
      input.workspacePath,
      run.confirmedBriefContext,
      run.resourceProductionState.deliveryReceipt?.catalogObserved ?? false,
    )
    return {
      ...facts,
      contentIds: [...(run.gameContentReceipt?.contentIds ?? [])],
    }
  }

  async function handleTerminal(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    assertNoRetiredFoundationWorker(record)
    return serialize(() => handleTerminalUnlocked(record, result, request))
  }

  async function handleTerminalUnlocked(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    const run = await store.load()
    // Foundation author terminals belong exclusively to the public module.
    // Late callbacks from the retired worker path cannot update its link.
    if (run && isPublicStageActive(run) || record.phase === 'DOCUMENT_DRAFTING') return
    if (!run || run.activeDispatch?.dispatchId !== record.dispatchId) return
    let next: DeliveryRun = { ...run, activeDispatch: undefined }
    if (isProjectChange(request) && result.workerType === 'implementation-worker') {
      // Drain an already persisted old dispatch, but never create/resume one.
      // Its native terminal is a request result, not delivery acceptance.
      const revision = await computeWorkspaceRevision(input.workspacePath)
      const changed = revision !== request.revision
      const previousStatus = request.contract.previousStatus as DeliveryRun['status']
      await persist({ ...next,
        status: changed || previousStatus === 'running' ? 'needs_action' : previousStatus ?? 'needs_action',
        ...(changed ? { completedAt: undefined, evidence: { ...next.evidence, acceptance: undefined } } : {}),
        blockedReason: changed ? 'Workspace changed after acceptance; revalidation is required.'
          : request.contract.previousBlockedReason as string | undefined,
        lastAnswer: result.summary,
        changeRequest: undefined, changeRoute: undefined,
        changeAffectedRequirementIds: undefined, changeAffectedChecklistIds: undefined, changeRationale: undefined,
      }, 'change.completed', { changed, answer: result.summary })
      return
    }
    if (result.workerType === 'change-impact-analyzer') {
      const message =
        typeof request?.contract.message === 'string'
          ? request.contract.message
          : ''
      const persistedChange = await createChangeRequest({
        store,
        run,
        message,
        impactResult: result,
      })
      next = {
        ...next,
        changeRequest: message,
        changeRoute: persistedChange.route,
        changeAffectedRequirementIds: persistedChange.affectedRequirementIds,
        changeAffectedChecklistIds: persistedChange.affectedChecklistIds,
        changeRationale: persistedChange.rationale,
      }
      if (result.classification === 'question') {
        await persist(next, 'change.question')
        await dispatcher.dispatch({
          ...buildQuestionAnswerDispatch(next, input.workspacePath, message),
          phase: next.phase,
        })
        return
      }
      const continued: DeliveryRun = {
        ...next,
        ...(run.confirmedBriefContext
          ? { confirmedBriefContext: run.confirmedBriefContext }
          : {}),
        changeRequest: message,
        changeRoute: result.classification,
        changeAffectedRequirementIds: result.affectedRequirementIds,
        changeAffectedChecklistIds: result.affectedChecklistIds,
        changeRationale: result.rationale,
        completedAt: undefined,
        phase:
          result.classification === 'documents_required'
            ? 'DOCUMENT_DRAFTING'
            : 'IMPLEMENTATION',
        documentStep:
          result.classification === 'documents_required'
            ? 'FOUNDATION_DRAFTING'
            : undefined,
        status: 'running',
        revision: {
          ...next.revision,
          document:
            result.classification === 'documents_required'
              ? 'uncomputed'
              : next.revision.document,
        },
        tasks:
          result.classification === 'documents_required'
            ? []
            : [],
        evidence:
          result.classification === 'documents_required'
            ? {}
            : {
                resourcePreparation: next.evidence.resourcePreparation,
              },
        foundationDraftState:
          result.classification === 'documents_required'
            ? { completedPaths: [] }
            : next.foundationDraftState,
        foundationAuditState:
          result.classification === 'documents_required'
            ? undefined
            : next.foundationAuditState,
        resourceProductionState:
          result.classification === 'documents_required'
            ? { currentTask: 'RESOURCE_DELIVERY' }
            : next.resourceProductionState,
        blockedReason: undefined,
      }
      // A change is a new revision of the same delivery run. Creating a child
      // run made the dashboard show two competing workflows and doubled the
      // token/dispatch accounting. Keep one durable run and append the change
      // to its event journal instead.
      await persist(continued, 'change.impact_applied')
      await resumeUnlocked(continued)
      return
    }
    if (result.workerType === 'question-answerer') {
      const saved = await persist(
        {
          ...next,
          status: 'completed',
          lastAnswer: result.answer,
          changeRequest: undefined,
          changeRoute: undefined,
          changeAffectedRequirementIds: undefined,
          changeAffectedChecklistIds: undefined,
          changeRationale: undefined,
          blockedReason: undefined,
        },
        'question.answered',
      )
      await store.appendEvent({
        runId: saved.runId,
        type: 'question.answer',
        phase: saved.phase,
        status: saved.status,
        revision: saved.revision,
        answer: result.answer,
      })
      return
    }
    if (result.workerType === 'document-author') {
      if (request?.contract.documentSet !== 'checklist') return
      next = await completeDocumentDraft({
        run: {
          ...next,
          activeDispatch: record,
          phase: 'DOCUMENT_REVIEW',
        },
        workspacePath: input.workspacePath,
        terminal: result,
        documentSet: 'checklist',
      })
      if (next.blockedReason && next.status === 'running') {
        next = {
          ...next,
          status: 'needs_action',
          blockedReason: next.blockedReason ?? 'document bundle is incomplete',
        }
      }
      await persist(
        next,
        next.status === 'running'
          ? 'phase.entered'
          : 'document.draft.incomplete',
      )
      await resumeUnlocked(next)
      return
    }
    if (result.workerType === 'resource-planner') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed during resource preparation; document review and downstream work must be rerun',
        )
        return
      }
      next = await completeResourceTask({
        // Resource completion validates the durable manifest and bindings before
        // clearing the dispatch and advancing the workflow.
        run,
        workspacePath: input.workspacePath,
        terminal: result,
      })
      next = await persist(
        next,
          next.phase === 'RESOURCE_PREPARATION' && next.status === 'running'
            ? 'resource.preparation.progressed'
            : next.phase === 'GAME_CONTENT' && next.status === 'running'
              ? 'resource.preparation.ready'
            : next.phase === 'DOCUMENT_REVIEW'
              ? 'resource.preparation.ready'
            : 'resource.preparation.needs_action',
      )
      await resumeUnlocked(next)
      return
    }
    if (result.workerType === 'content-author') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed during Scene/UI content authoring; downstream work must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(next) || await resourceRevisionChanged(next)) {
        await restartResourcePreparation(
          next,
          'approved resources changed during Scene/UI content authoring; resource delivery must be rerun',
        )
        return
      }
      next = completeGameContentStage({
        run,
        workspacePath: input.workspacePath,
        terminal: result,
      })
      next = await persist(
        next,
        next.phase === 'IMPLEMENTATION'
          ? 'game.content.ready'
          : 'game.content.needs_action',
      )
      await resumeUnlocked(next)
      return
    }
    if (result.workerType === 'implementation-worker') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed during implementation; document review and downstream work must be rerun',
        )
        return
      }
      if (
        result.status === 'completed' &&
        result.changedPaths.some(path => isCanonicalDocumentPath(path))
      ) {
        await restartDocumentStage(
          next,
          'implementation changed a canonical document; document review and downstream work must be rerun',
        )
        return
      }
      const activeTask = next.tasks.find(task => task.id === record.taskId)
      let completionFailureReason: string | undefined
      if (result.status === 'completed' && activeTask) {
        completionFailureReason = implementationCompletionIssue({
          task: activeTask,
          workspacePath: input.workspacePath,
          terminal: result,
        })
        if (!completionFailureReason) {
          try {
            next = await refreshImplementationArtifacts({ run: next, workspacePath: input.workspacePath })
          } catch (error) {
            completionFailureReason = error instanceof Error ? error.message : String(error)
          }
        }
      }
      const currentRevision = await computeWorkspaceRevision(
        input.workspacePath,
      )
      if (result.status === 'completed' && !completionFailureReason)
        await bindImplementationEvidence(input.workspacePath, result.evidencePath, currentRevision)
      next = completeImplementationTask({
        run: { ...next, phase: 'IMPLEMENTATION', activeTaskId: record.taskId },
        workspacePath: input.workspacePath,
        terminal: result,
        currentRevision,
        ...(completionFailureReason ? { completionFailureReason } : {}),
      })
      await persist(
        next,
        next.status === 'failed' ? 'task.failed' : 'task.completed',
      )
      if (next.status !== 'running') return
      if (next.tasks.every(task => task.status === 'completed')) {
        const auditFacts = await contractFactsFor(next)
        if (!auditFacts.resourceReadiness.ready) {
          await persist(
            resourceDeliveryBlocked(next, auditFacts.resourceReadiness),
            'resource.delivery.needs_action',
          )
          return
        }
        next = await persist(enterAcceptance(next), 'phase.entered')
        next = await confirmAcceptanceFromImplementation({
          run: next,
          workspacePath: input.workspacePath,
        })
        if (next.phase === 'DELIVERY') next = transitionDeliveryRun(next, { type: 'delivery_completed' })
        await persist(next, next.status === 'completed' ? 'run.completed' : 'acceptance.needs_action')
      } else {
        await startNextImplementationTask({
          run: next,
          workspacePath: input.workspacePath,
          revision: next.revision.workspace,
          dispatcher,
          beforeDispatch: started =>
            persist(started, 'task.started').then(() => undefined),
        })
      }
      return
    }
  }

  function resourceDeliveryBlocked(
    run: DeliveryRun,
    readiness: ResourceDeliveryReadiness,
  ): DeliveryRun {
    return {
      ...run,
      status: 'needs_action',
      activeDispatch: undefined,
      blockedReason: [...readiness.issues, ...readiness.readinessIssues].join(
        '; ',
      ),
      updatedAt: new Date().toISOString(),
    }
  }

  async function resourceRevisionChanged(run: DeliveryRun): Promise<boolean> {
    if (!run.revision.resource) return false
    const current = await computeResourceRevision(
      input.workspacePath,
      run.revision.document,
    )
    return current !== run.revision.resource
  }

  async function gameContentChanged(run: DeliveryRun): Promise<boolean> {
    if (!run.gameContentReceipt || !run.revision.content || !run.revision.resource)
      return true
    try {
      const audit = auditBeeGameContentPackage(input.workspacePath, {
        documentRevision: run.revision.document,
        assetManifestRevision: run.revision.resource,
        manifest: readBeeGameAssetManifestSync(input.workspacePath),
      })
      return !audit.package || audit.package.digest !== run.revision.content
    } catch {
      return true
    }
  }

  async function gameContentAuthority(run: DeliveryRun) {
    if (!run.revision.resource)
      throw new Error('Scene/UI editing requires accepted resources')
    return {
      documentRevision: run.revision.document,
      assetManifestRevision: run.revision.resource,
      manifest: readBeeGameAssetManifestSync(input.workspacePath),
    }
  }

  async function documentRevisionChanged(run: DeliveryRun): Promise<boolean> {
    const current = await computeDocumentRevision(
      input.workspacePath,
      run.confirmedBriefDigest,
    )
    return current !== run.revision.document
  }

  function resourcePreparationMissing(run: DeliveryRun): boolean {
    const evidence = run.evidence.resourcePreparation
    return (
      run.resourceProductionState.currentTask !== 'RESOURCE_DELIVERED' ||
      !run.resourceProductionState.deliveryReceipt ||
      !run.revision.resource ||
      evidence?.status !== 'passed' ||
      evidence.revision !== run.revision.resource
    )
  }

  async function restartResourcePreparation(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const invalidated = transitionDeliveryRun(run, {
      type: 'resource_preparation_required',
      reason,
    })
    const saved = await persist(invalidated, 'resource.revision.invalidated')
    await resumeUnlocked(saved)
  }

  async function restartGameContent(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const next: DeliveryRun = {
      ...run,
      phase: 'GAME_CONTENT',
      status: 'running',
      activeDispatch: undefined,
      activeTaskId: undefined,
      tasks: [],
      revision: { ...run.revision, content: undefined, implementation: undefined },
      gameContentReceipt: undefined,
      evidence: { ...run.evidence, gameContent: undefined, acceptance: undefined },
      blockedReason: reason,
    }
    await persist(next, 'game.content.required')
    await resumeUnlocked(next)
  }

  async function restartDocumentStage(
    _run: DeliveryRun,
    _reason: string,
  ): Promise<never> {
    throw new Error(RETIRED_FOUNDATION_AUTHOR)
  }

  async function ensureDirectImplementationTask(
    run: DeliveryRun,
  ): Promise<DeliveryRun> {
    if (run.phase !== 'IMPLEMENTATION' || run.tasks.length > 0) return run
    const facts = await contractFactsFor(run)
    const prepared: DeliveryRun = {
      ...run,
      tasks: [directImplementationTask(facts)],
      activeTaskId: undefined,
      activeDispatch: undefined,
    }
    const committed = await persist(prepared, 'implementation.task.created', {
      implementationTask: prepared.tasks[0],
    })
    return committed
  }

  async function resumeUnlocked(run: DeliveryRun): Promise<void> {
    input.assertWorkspaceIdle?.()
    if (isFoundationStageActive(run)) {
      await progressPublicFoundation(run)
      return
    }
    if (run.phase === 'DOCUMENT_DRAFTING') {
      if (run.status === 'running') await requireAuthorLink().start(run)
      return
    }
    assertNoRetiredFoundationReviewRun(run)
    if (run.status !== 'running') return
    // Replay a terminal from a phase that owns top-level dispatches. Foundation
    // review and revision terminals are nested under their own durable tasks
    // and never enter this route.
    if (
      run.activeDispatch?.terminalResult &&
      !run.foundationAuditState
    ) {
      // resumeUnlocked already owns the controller serialization lane. Reuse
      // the canonical terminal handler directly instead of queueing behind
      // ourselves through handleTerminal.
      await dispatcher.replayTerminal(
        run.activeDispatch,
        handleTerminalUnlocked,
      )
      return
    }
    if (run.changeRequest && run.changeRoute === undefined) {
      if (run.activeDispatch?.status === 'running') return
      throw new Error('Continue this project request in Chat; it is not a delivery workflow')
    }
    if (run.phase === 'DELIVERY' && !run.activeDispatch && !run.changeRequest) {
      // A blocked follow-up (e.g. a platform error) is not a new delivery job.
      // Explicit continue must not resurrect its old successful certificate.
      await persist({ ...run, status: 'needs_action',
        blockedReason: run.blockedReason ?? 'No delivery work is pending. Submit the specific follow-up request.' }, 'change.needs_action')
      return
    }
    if (
      run.changeRequest &&
      run.changeRoute === 'question' &&
      run.phase === 'DELIVERY'
    ) {
      await dispatcher.dispatch(
        buildQuestionAnswerDispatch(
          run,
          input.workspacePath,
          run.changeRequest,
        ),
      )
      return
    }
    if (run.phase === 'DOCUMENT_REVIEW') {
      if (run.documentStep === 'CHECKLIST_DRAFTING') {
        await startChecklistDraftStage({
          run,
          workspacePath: input.workspacePath,
          dispatcher,
        })
      }
      return
    }
    if (run.phase === 'RESOURCE_PREPARATION') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while resource preparation was paused; document review must be rerun',
        )
        return
      }
      await startResourcePreparation({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
      })
      return
    }
    if (run.phase === 'GAME_CONTENT') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while Scene/UI content authoring was paused; downstream work must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run) || await resourceRevisionChanged(run)) {
        await restartResourcePreparation(
          run,
          'resource delivery changed before Scene/UI content authoring',
        )
        return
      }
      // A stopped server can lose the in-memory terminal reconciliation after
      // the content author has already produced a complete package. The
      // package validator is the acceptance authority, so resume from that
      // durable output instead of paying for the same author turn again.
      if (!run.activeDispatch) {
        const recovered = completeGameContentStage({
          run,
          workspacePath: input.workspacePath,
          terminal: {
            workerType: 'content-author',
            revision: run.revision.resource!,
            status: 'completed',
            writtenPaths: [],
          },
        })
        if (recovered.phase === 'IMPLEMENTATION') {
          const accepted = await persist(recovered, 'game.content.ready')
          await resumeUnlocked(accepted)
          return
        }
      }
      await startGameContentStage({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
      })
      return
    }
    if (run.phase === 'IMPLEMENTATION') {
      const documentChanged = await documentRevisionChanged(run)
      if (documentChanged) {
        await restartDocumentStage(
          run,
          'canonical documents changed while implementation was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; implementation cannot start before the resource stage is complete',
        )
        return
      }
      if (!run.gameContentReceipt || !run.revision.content) {
        const contentRun = await persist(
          { ...run, phase: 'GAME_CONTENT', status: 'running', activeDispatch: undefined,
            blockedReason: undefined, tasks: [], activeTaskId: undefined },
          'game.content.required',
        )
        await resumeUnlocked(contentRun)
        return
      }
      run = await ensureDirectImplementationTask(run)
      await startNextImplementationTask({
        run,
        workspacePath: input.workspacePath,
        revision: run.revision.workspace,
        dispatcher,
        beforeDispatch: started =>
          persist(started, 'task.started').then(() => undefined),
      })
      return
    }
    if (run.phase === 'ACCEPTANCE') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while acceptance was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run) || await resourceRevisionChanged(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; acceptance cannot start before the resource stage is complete',
        )
        return
      }
      if (await gameContentChanged(run)) {
        await restartGameContent(run, 'accepted Scene/UI content changed before acceptance')
        return
      }
      const accepted = await confirmAcceptanceFromImplementation({
        run,
        workspacePath: input.workspacePath,
      })
      await persist(
        accepted.phase === 'DELIVERY' ? transitionDeliveryRun(accepted, { type: 'delivery_completed' }) : accepted,
        accepted.phase === 'DELIVERY' ? 'run.completed' : 'acceptance.needs_action',
      )
    }
  }

  function resume(run: DeliveryRun): Promise<void> {
    return serialize(async () => {
      const latest = await store.load()
      if (!latest || latest.runId !== run.runId) return
      if (isFoundationStageActive(latest)) {
        await progressPublicFoundation(latest, true)
        return
      }
      // Re-read durable state before legacy recognition; a stale caller must
      // not bypass retirement checks or overwrite a newly persisted public link.
      if (
        run.phase === 'DOCUMENT_DRAFTING' ||
        (run.phase === 'DOCUMENT_REVIEW' && !run.foundationAuditState)
      ) {
        const current = await store.load()
        if (!current || current.runId !== run.runId) return
        await resumeUnlocked(current)
        return
      }
      await resumeUnlocked(latest)
    })
  }

  function ensureProgress(run: DeliveryRun): Promise<void> {
    return serialize(async () => {
      const latest = await store.load()
      if (!latest || latest.runId !== run.runId) return
      if (isFoundationStageActive(latest)) {
        await progressPublicFoundation(latest)
        return
      }
      if (latest.phase === 'DOCUMENT_DRAFTING') {
        await resumeUnlocked(latest)
        return
      }
      assertNoRetiredFoundationReviewRun(latest)
      // Polling and retry requests may carry a stale snapshot. Reconcile the
      // durable nested task state first so an orphaned `running` projection
      // cannot preserve an admitted foundation `needs_action` terminal.
      const current = await store.reconcile(async dispatch => {
        try {
          return await dispatcher.workerIsOpen(dispatch.dispatchId)
        } catch {
          return false
        }
      })
      if (!current || current.runId !== run.runId) return
      if (current.status !== 'running') return
      if (current.activeDispatch?.status === 'running') return
      await resumeUnlocked(current)
    })
  }

  function requestChange(run: DeliveryRun, message: string): Promise<unknown> {
    return serialize(async () => {
      const latest = await store.load()
      if (latest && isPublicStageActive(latest)) throw new Error('Public document stage is still active; change routing is unavailable')
      if (!latest || latest.runId !== run.runId) throw new Error('Delivery run is unavailable')
      throw new Error('Project requests use the native project conversation, not delivery dispatches')
    })
  }

  async function loadGameContentForEditing() {
    // This is a read-only snapshot. Queuing it behind the workflow controller
    // makes both editors appear to hang for the full duration of an active
    // worker turn (and forever when a stop is stuck). Mutations remain
    // serialized below; reads use the durable run snapshot directly.
    const current = await store.load()
    if (!current) throw new Error('Workflow is unavailable')
    return loadBeeGameContentPackageForEditing(
      input.workspacePath,
      await gameContentAuthority(current),
    )
  }

  async function loadGameContentFileListForEditing() {
    const current = await store.load()
    if (!current) throw new Error('Workflow is unavailable')
    return loadBeeGameContentFileListForEditing(
      input.workspacePath,
      await gameContentAuthority(current),
    )
  }

  function saveGameContentEdit(edit: {
    path: string
    expectedRevision: string
    document: BeeGameContentDocument
  }) {
    return serialize(async () => {
      const current = await store.load()
      if (!current) throw new Error('Workflow is unavailable')
      if (hasActiveContentWork(current))
        throw new Error('Scene/UI cannot be edited while workflow work is active')
      return saveBeeGameContentDocument({
        workspacePath: input.workspacePath,
        ...edit,
        authority: await gameContentAuthority(current),
      })
    })
  }

  function publishGameContentEdits(expectedContentRevision: string) {
    return serialize(async () => {
      const current = await store.load()
      if (!current) throw new Error('Workflow is unavailable')
      if (hasActiveContentWork(current))
        throw new Error('Scene/UI cannot be published while workflow work is active')
      const receipt = acceptBeeGameContentPackage(
        input.workspacePath,
        await gameContentAuthority(current),
      )
      if (receipt.contentRevision !== expectedContentRevision)
        throw new Error('Scene/UI package revision changed before publish')
      if (receipt.contentRevision === current.revision.content) return current
      const observedAt = new Date().toISOString()
      const next = transitionDeliveryRun(current, {
        type: 'game_content_published',
        receipt,
        evidence: {
          path: receipt.indexPath,
          kind: 'game_content',
          revision: receipt.contentRevision,
          status: 'passed',
          observedAt,
        },
      })
      return persist(next, 'game.content.published', {
        contentRevision: receipt.contentRevision,
      })
    })
  }

  return {
    store,
    dispatcher,
    start: (run: DeliveryRun) => serialize(() => requireAuthorLink().start(run)),
    stopAuthor: stopFoundation,
    stopFoundation,
    async dispose(): Promise<void> {
      try {
        await serialize(async () => {
          const current = await store.load()
          if (current && current.status !== 'stopped' && (
            isPublicStageActive(current) || current.activeDispatch?.status === 'running'
          ))
            await stopFoundation(current, 'service_shutdown')
        })
      } finally { authorLink?.dispose(); reviewLink?.dispose() }
    },
    resume,
    ensureProgress,
    requestChange,
    loadGameContentForEditing,
    loadGameContentFileListForEditing,
    saveGameContentEdit,
    publishGameContentEdits,
  }
}

function isCanonicalDocumentPath(path: string): boolean {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  return CANONICAL_DOCUMENT_ARTIFACTS.includes(normalized as never)
}

function hasActiveContentWork(run: DeliveryRun): boolean {
  return run.status === 'running' || run.activeDispatch?.status === 'running' ||
    run.tasks.some(task => task.status === 'running')
}

async function implementationContractFacts(
  workspacePath: string,
  confirmedBriefContext?: string,
  catalogObserved = false,
): Promise<
  {
    checklistIds: string[]
    resourceIds: string[]
    contentIds: string[]
    resourceReadiness: ResourceDeliveryReadiness
  }
> {
  const assetContract = auditAssetContract(workspacePath)
  const resourceReadiness = auditResourceDeliveryReadiness({
    workspacePath,
    confirmedPolicy: confirmedResourceLibraryUsage(confirmedBriefContext),
    catalogObserved,
  })
  return {
    checklistIds: readAcceptanceChecklistIds(workspacePath),
    // Provisional resources are valid delivery records, but they are not
    // implementation inputs. Keep the implementation and acceptance
    // contracts aligned with the dispatch gate, which only exposes verified
    // resources to downstream agents.
    resourceIds: assetContract.resources
      .filter(resource => resource.status === 'verified')
      .map(resource => resource.id),
    contentIds: [],
    resourceReadiness,
  }
}

export type DeliveryWorkflowController = ReturnType<
  typeof createDeliveryWorkflowController
>
