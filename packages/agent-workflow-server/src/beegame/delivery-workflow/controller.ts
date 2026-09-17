import { auditAssetContract } from '../asset-contract-audit'
import { foundationPublicDigest } from '../foundation-public-result'
import { readBeeGameAssetManifestSync } from '../asset-contracts'
import {
  acceptBeeGameContentPackage,
  auditBeeGameContentPackage,
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
import type { GameIrOperations } from '../stage-modules/game-ir/public'
import { createGameIrLink } from './game-ir-link'
import { assertDispatchedIr, assertResourceIr, consumesGameIr, downstreamIrEntryIds, downstreamIrForRequest, isDownstreamIrPhase, readDownstreamIr } from './downstream-ir'
import { isFoundationStageActive, isIrStageActive, isPublicStageActive } from './public-stage-routing'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
import {
buildChangeImpactDispatch,
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
implementationCompletionIssue,
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
enterAcceptance,
reconcileAcceptance,
startAcceptance,
} from './validation-stage'
import {
type WorkerTerminalResult
} from './worker-contracts'
export function createDeliveryWorkflowController(input: {
  workspacePath: string
  ownerId: string
  workerPort: DeliveryWorkerPort
  author?: ReturnType<typeof createFoundationAuthoring>
  reviewer?: ReturnType<typeof createFoundationReviewer>
  ir?: GameIrOperations
  handoffRecoveryGraceMs?: number
}) {
  const store = createRunStore(input.workspacePath, input.ownerId)
  const irLink = input.ir ? createGameIrLink({ store, ir: input.ir,
    onCompleted: run => { void ensureProgress(run).catch(() => undefined) } }) : undefined
  const reviewLink = input.reviewer ? createFoundationReviewLink({ workspacePath: input.workspacePath,
    store, reviewer: input.reviewer,
    ...(irLink ? { onCompleted: (run: DeliveryRun) => { void ensureProgress(run).catch(() => undefined) } } : {}) }) : undefined
  const authorLink = input.author ? createFoundationAuthoringLink({ store, author: input.author,
    ...(reviewLink ? { onCompleted: (run: DeliveryRun) => ensureProgress(run) } : {}) }) : undefined
  async function progressPublicFoundation(run: DeliveryRun, resume = false) {
    if (run.foundationReviewStage?.acceptedReview && irLink && run.status !== 'stopped' &&
        run.foundationReviewStage.control.action !== 'stop') return irLink.ensureProgress(run)
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
    if (isIrStageActive(current)) {
      if (!irLink) throw new Error('IR public module is required')
      const stopped = await irLink.stop(current, reason)
      return isIrStageActive(stopped) ? stopped : stopFoundation(stopped, reason)
    }
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
      if (!consumesGameIr(request.workerType)) return transportDispatcher.dispatch(request)
      const run = await store.load()
      if (!run || run.runId !== request.runId) throw new Error('IR consumer run changed')
      const gameIr = await readDownstreamIr({ run, workspacePath: input.workspacePath, ir: input.ir })
      assertResourceIr(run, gameIr, request.workerType === 'resource-planner')
      const active = run.activeDispatch
      if (active && active.phase === request.phase && active.workerType === request.workerType &&
          active.taskId === request.taskId && active.revision === request.revision &&
          (active.status === 'running' || active.status === 'completed'))
        assertDispatchedIr(active.request, gameIr)
      let contentContract: Record<string, unknown> = {}
      if (['implementation-worker', 'acceptance-validator'].includes(request.workerType)) {
        if (!run.gameContentReceipt)
          throw new Error('downstream work requires an accepted Scene/UI content receipt')
        const assetManifestRevision = run.revision.resource
        if (!assetManifestRevision)
          throw new Error('Scene/UI consumer requires an accepted Asset Manifest revision')
        const audit = auditBeeGameContentPackage(input.workspacePath, {
          irRevision: gameIr.resultId,
          assetManifestRevision,
          irEntryIds: downstreamIrEntryIds(gameIr),
          manifest: readBeeGameAssetManifestSync(input.workspacePath),
        })
        if (!audit.package || audit.package.digest !== run.revision.content)
          throw new Error(`downstream work requires the accepted Scene/UI package: ${audit.issues.join('; ')}`)
        contentContract = { gameContent: audit.package }
      }
      return transportDispatcher.dispatch({ ...request,
        protectedPaths: [...new Set([...(request.protectedPaths ?? []), ...CANONICAL_DOCUMENT_ARTIFACTS,
          '.beegame/ir/', '.beegame/workflow/game-ir/',
          ...(['content-author', 'implementation-worker'].includes(request.workerType) ? ['assets/'] : []),
          ...(request.workerType === 'implementation-worker' ? ['content/'] : [])])],
        contract: { ...request.contract, ...contentContract,
          gameIr: downstreamIrForRequest(request, gameIr) } })
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
    if (consumesGameIr(record.workerType)) {
      try {
        const gameIr = await readDownstreamIr({ run, workspacePath: input.workspacePath, ir: input.ir })
        assertResourceIr(run, gameIr, record.workerType === 'resource-planner')
        assertDispatchedIr(run.activeDispatch.request, gameIr)
      } catch (error) {
        await persist({ ...run, status: 'needs_action',
          blockedReason: error instanceof Error ? error.message : 'IR consumer binding failed' },
          'ir.consumer.rejected', { dispatchId: record.dispatchId })
        return
      }
    }
    let next: DeliveryRun = { ...run, activeDispatch: undefined }
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
        ir: input.ir,
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
        // Resource completion validates the durable artifacts against the exact
        // IR injected into this dispatch. Keep that dispatch available until
        // completion has derived the binding and receipts; completeResourceTask
        // clears it in the returned run.
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
      const gameIr = await readDownstreamIr({
        run,
        workspacePath: input.workspacePath,
        ir: input.ir,
      })
      next = completeGameContentStage({
        run,
        workspacePath: input.workspacePath,
        gameIr,
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
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'resource delivery is missing or approved resources changed during implementation; resource delivery must be rerun',
        )
        return
      }
      if (await gameContentChanged(next)) {
        await restartGameContent(
          next,
          'accepted Scene/UI content changed during implementation; content authoring must be rerun',
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
          gameIr: run.activeDispatch?.request?.contract.gameIr,
          terminal: result,
        })
      }
      const currentRevision = await computeWorkspaceRevision(
        input.workspacePath,
      )
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
        await startAcceptance({
          run: next,
          workspacePath: input.workspacePath,
          dispatcher,
          expectedChecklistIds: auditFacts.checklistIds,
          expectedContentIds: auditFacts.contentIds,
          expectedResourceIds: auditFacts.resourceIds,
        })
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
    if (result.workerType === 'acceptance-validator') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed before acceptance; document review and downstream work must be rerun',
        )
        return
      }
      if (
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'resource delivery is missing or approved resources changed before acceptance; resource delivery must be rerun',
        )
        return
      }
      if (await gameContentChanged(next)) {
        await restartGameContent(
          next,
          'accepted Scene/UI content changed before acceptance; content authoring must be rerun',
        )
        return
      }
      const acceptanceFacts = await contractFactsFor(next)
      next = await reconcileAcceptance({
        run: { ...next, phase: 'ACCEPTANCE' },
        workspacePath: input.workspacePath,
        terminal: result,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        currentImplementationRevision: await computeWorkspaceRevision(
          input.workspacePath,
        ),
      })
      if (next.phase === 'DELIVERY')
        next = transitionDeliveryRun(next, { type: 'delivery_completed' })
      await persist(
        next,
        next.status === 'completed'
          ? 'run.completed'
          : result.status === 'failed'
            ? 'acceptance.needs_action'
            : 'acceptance.reconciled',
        result.status === 'failed' ? { findings: result.findings } : undefined,
      )
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
      const gameIr = await readDownstreamIr({
        run,
        workspacePath: input.workspacePath,
        ir: input.ir,
      })
      const audit = auditBeeGameContentPackage(input.workspacePath, {
        irRevision: gameIr.resultId,
        assetManifestRevision: run.revision.resource,
        irEntryIds: downstreamIrEntryIds(gameIr),
        manifest: readBeeGameAssetManifestSync(input.workspacePath),
      })
      return !audit.package || audit.package.digest !== run.revision.content
    } catch {
      return true
    }
  }

  async function gameContentAuthority(run: DeliveryRun) {
    if (!run.gameContentReceipt || !run.revision.resource)
      throw new Error('Scene/UI editing requires accepted content and resources')
    const gameIr = await readDownstreamIr({
      run,
      workspacePath: input.workspacePath,
      ir: input.ir,
    })
    return {
      irRevision: gameIr.resultId,
      assetManifestRevision: run.revision.resource,
      irEntryIds: downstreamIrEntryIds(gameIr),
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
      !run.resourceProductionState.irResultId ||
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
    if (isIrStageActive(run)) {
      if (!irLink) throw new Error('IR public module is required')
      await irLink.ensureProgress(run)
      return
    }
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
    if (isDownstreamIrPhase(run.phase)) {
      try {
        const gameIr = await readDownstreamIr({ run, workspacePath: input.workspacePath, ir: input.ir })
        assertResourceIr(run, gameIr, run.phase === 'RESOURCE_PREPARATION')
      } catch (error) {
        await persist({ ...run, status: 'needs_action',
          blockedReason: error instanceof Error ? error.message : 'IR consumer binding failed' },
          'ir.consumer.rejected')
        return
      }
    }
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
          ir: input.ir,
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
      const gameIr = await readDownstreamIr({
        run,
        workspacePath: input.workspacePath,
        ir: input.ir,
      })
      const settled = await completeResourceTask({
        run,
        workspacePath: input.workspacePath,
        gameIr,
      })
      if (settled.phase !== 'RESOURCE_PREPARATION') {
        const saved = await persist(settled, 'resource.preparation.ready')
        await resumeUnlocked(saved)
        return
      }
      if (settled.status !== 'running') {
        await persist(settled, 'resource.preparation.needs_action')
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
      const gameIr = await readDownstreamIr({
        run,
        workspacePath: input.workspacePath,
        ir: input.ir,
      })
      await startGameContentStage({
        run,
        workspacePath: input.workspacePath,
        gameIr,
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
      if (resourcePreparationMissing(run) || await resourceRevisionChanged(run)) {
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
      if (await gameContentChanged(run)) {
        await restartGameContent(run, 'accepted Scene/UI content changed before implementation')
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
      const acceptanceFacts = await contractFactsFor(run)
      await startAcceptance({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedContentIds: acceptanceFacts.contentIds,
        expectedResourceIds: acceptanceFacts.resourceIds,
      })
    }
  }

  async function requestChangeUnlocked(
    run: DeliveryRun,
    message: string,
  ): Promise<unknown> {
    if (
      run.status === 'running' &&
      run.activeDispatch &&
      (run.activeDispatch.status === 'running' ||
        Boolean(run.activeDispatch.terminalResult))
    ) {
      throw new Error(
        'A workflow worker result is still being reconciled; wait for the current phase to settle before submitting another change.',
      )
    }
    const analysisRun: DeliveryRun = {
      ...run,
      status: 'running',
      activeDispatch: undefined,
      blockedReason: undefined,
      changeRequest: message,
      changeRoute: undefined,
      changeAffectedRequirementIds: undefined,
      changeAffectedChecklistIds: undefined,
      changeRationale: undefined,
    }
    await persist(analysisRun, 'change.request_received')
    const request = buildChangeImpactDispatch(
      analysisRun,
      input.workspacePath,
      message,
    )
    const dispatch = await dispatcher.dispatch(request)
    return { runId: analysisRun.runId, dispatch }
  }

  function resume(run: DeliveryRun): Promise<void> {
    return serialize(async () => {
      const latest = await store.load()
      if (!latest || latest.runId !== run.runId) return
      if (isIrStageActive(latest)) {
        if (!irLink) throw new Error('IR public module is required')
        await irLink.resume(latest)
        return
      }
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
      if (isIrStageActive(latest)) {
        if (!irLink) throw new Error('IR public module is required')
        await irLink.ensureProgress(latest)
        return
      }
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
      return requestChangeUnlocked(run, message)
    })
  }

  function reviseGameIr(edit: { expectedResultDigest: string; draft: unknown }) {
    return serialize(async () => {
      const observed = await store.load()
      if (!observed) throw new Error('Workflow is unavailable')
      const lock = await store.mutationLock(observed.runId)
      try {
        const current = await store.load(lock)
        const link = current?.gameIrStage
        if (!current || current.runId !== observed.runId || !input.ir || !link?.handle || link.outcome?.status !== 'completed')
          throw new Error('A published IR is required')
        if (current.phase !== 'RESOURCE_PREPARATION' || current.status === 'running' ||
            current.resourceProductionState.deliveryReceipt || current.evidence.resourcePreparation ||
            current.revision.content || current.revision.implementation ||
            current.activeDispatch?.status === 'running')
          throw new Error('IR correction requires idle resource preparation before accepted delivery')
        if (foundationPublicDigest(link.outcome.result) !== edit.expectedResultDigest)
          throw new Error('IR publication changed before correction')
        await readDownstreamIr({ run: current, workspacePath: input.workspacePath, ir: input.ir })
        const outcome = await input.ir.revise({ handle: link.handle, ...edit })
        if (outcome.status !== 'completed' || outcome.billingStatus !== 'settled')
          throw new Error('IR correction was not published')
        const next: DeliveryRun = { ...current, status: 'needs_action', thinking: 'idle',
          activeDispatch: undefined, activeTaskId: undefined,
          blockedReason: 'IR revised; existing resources require validation against the new publication.',
          gameIrStage: { ...link, handle: outcome.handle, outcome },
          resourceProductionState: { currentTask: 'RESOURCE_DELIVERY' },
        }
        await readDownstreamIr({ run: next, workspacePath: input.workspacePath, ir: input.ir })
        return await store.commit(next, { runId: next.runId, type: 'game_ir.revised',
          phase: next.phase, status: next.status, revision: next.revision,
          previousResultDigest: edit.expectedResultDigest,
          resultDigest: foundationPublicDigest(outcome.result) }, undefined, lock)
      } finally { await store.unlock(lock) }
    })
  }

  function loadGameContentForEditing() {
    return serialize(async () => {
      const current = await store.load()
      if (!current) throw new Error('Workflow is unavailable')
      return loadBeeGameContentPackageForEditing(
        input.workspacePath,
        await gameContentAuthority(current),
      )
    })
  }

  function saveGameContentEdit(edit: {
    path: string
    expectedRevision: string
    document: BeeGameContentDocument
  }) {
    return serialize(async () => {
      const current = await store.load()
      if (!current) throw new Error('Workflow is unavailable')
      if (
        current.status === 'running' ||
        current.activeDispatch ||
        current.activeTaskId
      )
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
      if (current.activeDispatch || current.activeTaskId)
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
          if (current && isPublicStageActive(current) && current.status !== 'stopped')
            await stopFoundation(current, 'Application host is shutting down.')
        })
      } finally { authorLink?.dispose(); reviewLink?.dispose(); irLink?.dispose() }
    },
    resume,
    ensureProgress,
    requestChange,
    reviseGameIr,
    loadGameContentForEditing,
    saveGameContentEdit,
    publishGameContentEdits,
  }
}

function isCanonicalDocumentPath(path: string): boolean {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  return CANONICAL_DOCUMENT_ARTIFACTS.includes(normalized as never)
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
    resourceIds: assetContract.resources.map(resource => resource.id),
    contentIds: [],
    resourceReadiness,
  }
}

export type DeliveryWorkflowController = ReturnType<
  typeof createDeliveryWorkflowController
>
