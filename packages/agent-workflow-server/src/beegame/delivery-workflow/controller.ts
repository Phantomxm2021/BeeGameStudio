import {
  applyAtomicTaskPlan,
  type AtomicTaskContractFacts,
} from './atomic-task-planner'
import { auditAssetContract } from '../asset-contract-audit'
import { createDeliveryDispatcher } from './dispatch'
import {
  buildChangeImpactDispatch,
  buildQuestionAnswerDispatch,
  createChangeRequest,
} from './change-request'
import {
  completeDocumentDraft,
  reconcileDocumentReview,
  startChecklistDraftStage,
  startDocumentStage,
} from './document-stage'
import {
  auditResourcesForPreparation,
  completeResourcePreparation,
  startResourcePreparation,
} from './resource-stage'
import {
  completeImplementationTask,
  startNextImplementationTask,
} from './implementation-stage'
import { applyImplementationResourceBindings } from './resource-integration'
import {
  computeDocumentRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
} from './revision'
import { createRunStore, type RunStore } from './run-store'
import { transitionDeliveryRun } from './transition'
import {
  enterImplementationAudit,
  reconcileAcceptance,
  reconcileImplementationAudit,
  startAcceptance,
  startImplementationAudit,
} from './validation-stage'
import { readAcceptanceChecklistIds } from '../document-readiness-audit'
import {
  CANONICAL_DOCUMENT_ARTIFACTS,
  WORKFLOW_EVIDENCE_DIRECTORY,
} from './types'
import {
  auditResourceDeliveryReadiness,
  confirmedResourceLibraryUsage,
  type ResourceDeliveryReadiness,
} from '../resource-delivery-readiness'
import type {
  DeliveryWorkerPort,
  DeliveryRun,
  DispatchRecord,
  WorkerDispatchRequest,
} from './types'
import {
  parseWorkerTerminalResult,
  type WorkerTerminalResult,
} from './worker-contracts'
import type { NativeResourceLibraryEvidenceState } from '../native-resource-library-evidence'

export function createDeliveryWorkflowController(input: {
  workspacePath: string
  ownerId: string
  workerPort: DeliveryWorkerPort
  handoffRecoveryGraceMs?: number
  getResourceLibraryEvidence?: (
    runId: string,
  ) => NativeResourceLibraryEvidenceState
}) {
  const store = createRunStore(input.workspacePath, input.ownerId)
  let dispatcher: ReturnType<typeof createDeliveryDispatcher>
  let controllerTail: Promise<void> = Promise.resolve()
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

  dispatcher = createDeliveryDispatcher({
    store,
    workerPort: input.workerPort,
    onTerminal: async (record, result, request) =>
      handleTerminal(record, result, request),
  })

  async function persist(
    run: DeliveryRun,
    eventType: string,
  ): Promise<DeliveryRun> {
    const committed = await store.commit(run, {
      runId: run.runId,
      type: eventType,
      phase: run.phase,
      status: run.status,
      revision: run.revision,
      activeTaskId: run.activeTaskId,
    })
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
    AtomicTaskContractFacts & {
      importIds: string[]
      compositionIds: string[]
      resourceReadiness: ResourceDeliveryReadiness
    }
  > {
    const observed = input.getResourceLibraryEvidence?.(run.runId)
    const resourceEvidence =
      run.resourceEvidence?.state === 'current'
        ? run.resourceEvidence
        : observed?.state === 'missing' && run.resourceEvidence
          ? run.resourceEvidence
          : observed
    return plannerContractFacts(
      input.workspacePath,
      run.confirmedBriefContext,
      resourceEvidence,
    )
  }

  async function handleTerminal(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    return serialize(() => handleTerminalUnlocked(record, result, request))
  }

  async function handleTerminalUnlocked(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    const run = await store.load()
    if (!run || run.activeDispatch?.dispatchId !== record.dispatchId) return
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
            : 'ATOMIC_TASK_PLANNING',
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
            : next.tasks.map(task => ({
                ...task,
                status: 'pending',
                attempt: 0,
                evidenceRefs: [],
                startedRevision: undefined,
                completedRevision: undefined,
              })),
        evidence:
          result.classification === 'documents_required'
            ? {}
            : { documentReview: next.evidence.documentReview },
        checklistRemediation:
          result.classification === 'documents_required'
            ? undefined
            : next.checklistRemediation,
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
          lastAnswer: result.answer,
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
      const documentSet =
        request?.contract.documentSet === 'checklist'
          ? 'checklist'
          : 'foundation'
      next = await completeDocumentDraft({
        run: {
          ...next,
          phase:
            documentSet === 'checklist'
              ? 'DOCUMENT_REVIEW'
              : 'DOCUMENT_DRAFTING',
        },
        workspacePath: input.workspacePath,
        terminal: result,
        documentSet,
      })
      const observedResourceEvidence = input.getResourceLibraryEvidence?.(
        next.runId,
      )
      if (observedResourceEvidence)
        next = { ...next, resourceEvidence: observedResourceEvidence }
      if (
        next.blockedReason &&
        next.status === 'running' &&
        !(documentSet === 'checklist' && next.checklistRemediation)
      ) {
        next = {
          ...next,
          status: 'needs_action',
          blockedReason: next.blockedReason ?? 'document bundle is incomplete',
        }
      }
      next = await persist(
        next,
        next.status === 'running'
          ? documentSet === 'checklist' && next.checklistRemediation
            ? 'document.checklist.remediation_requested'
            : 'phase.entered'
          : 'document.draft.incomplete',
      )
      await resumeUnlocked(next)
      return
    }
    if (result.workerType === 'document-reviewer') {
      const reviewScope =
        request?.contract.reviewScope === 'foundation'
          ? 'foundation'
          : 'complete'
      const currentReviewRevision =
        reviewScope === 'foundation'
          ? await computeDocumentRevision(
              input.workspacePath,
              next.confirmedBriefDigest,
            )
          : await computeResourceRevision(
              input.workspacePath,
              next.revision.document,
            )
      next = await reconcileDocumentReview({
        run: { ...next, phase: 'DOCUMENT_REVIEW' },
        workspacePath: input.workspacePath,
        terminal: result,
        currentDocumentRevision: currentReviewRevision,
        scope: reviewScope,
      })
      await persist(
        next,
        reviewScope === 'foundation'
          ? 'document.foundation.review.reconciled'
          : 'document.review.reconciled',
      )
      // The persisted phase/documentStep is the durable handoff marker. Use
      // the same resume path for every next-stage transition so a process
      // interruption between the persist and dispatch can be recovered by a
      // later ensureProgress call.
      await resumeUnlocked(next)
      return
    }
    if (result.workerType === 'resource-preparer') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed during resource preparation; document review and downstream work must be rerun',
        )
        return
      }
      const observedResourceEvidence = input.getResourceLibraryEvidence?.(
        next.runId,
      )
      const resourceEvidence =
        next.resourceEvidence?.state === 'current'
          ? next.resourceEvidence
          : observedResourceEvidence
      const resourceAudit = auditResourcesForPreparation({
        workspacePath: input.workspacePath,
        confirmedBriefContext: next.confirmedBriefContext,
        ...(resourceEvidence ? { resourceEvidence } : {}),
      })
      next = await completeResourcePreparation({
        run: { ...next, phase: 'RESOURCE_PREPARATION' },
        workspacePath: input.workspacePath,
        terminal: result,
        audit: resourceAudit,
        ...(resourceEvidence ? { resourceEvidence } : {}),
      })
      next = await persist(
        next,
        next.phase === 'DOCUMENT_REVIEW'
          ? 'phase.entered'
          : 'resource.preparation.needs_action',
      )
      await resumeUnlocked(next)
      return
    }
    if (result.workerType === 'atomic-task-planner') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed before atomic task planning; document review and downstream work must be rerun',
        )
        return
      }
      if (
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'approved resources changed before atomic task planning; resource preparation must be rerun',
        )
        return
      }
      next = applyAtomicTaskPlan({
        run: { ...next, phase: 'ATOMIC_TASK_PLANNING' },
        terminal: result,
        facts: await contractFactsFor(next),
        workspacePath: input.workspacePath,
      })
      await persist(next, 'tasks.planned')
      await startNextImplementationTask({
        run: next,
        workspacePath: input.workspacePath,
        revision: next.revision.workspace,
        dispatcher,
        beforeDispatch: started =>
          persist(started, 'task.started').then(() => undefined),
      })
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
          'resource preparation is missing or approved resources changed during implementation; resource preparation and task planning must be rerun',
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
        try {
          await applyImplementationResourceBindings({
            workspacePath: input.workspacePath,
            task: activeTask,
            terminal: result,
          })
        } catch (error) {
          completionFailureReason =
            error instanceof Error ? error.message : String(error)
        }
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
        if (!auditFacts.resourceReadiness.integrationReady) {
          await persist(
            resourceIntegrationBlocked(next, auditFacts.resourceReadiness),
            'resource.integration.needs_action',
          )
          return
        }
        next = await persist(enterImplementationAudit(next), 'phase.entered')
        await startImplementationAudit({
          run: next,
          workspacePath: input.workspacePath,
          dispatcher,
          expectedChecklistIds: auditFacts.checklistIds,
          expectedImportIds: auditFacts.importIds,
          expectedCompositionIds: auditFacts.compositionIds,
          resourceReadiness: auditFacts.resourceReadiness,
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
    if (result.workerType === 'implementation-auditor') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed before implementation audit; document review and downstream work must be rerun',
        )
        return
      }
      if (
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'resource preparation is missing or approved resources changed before implementation audit; resource preparation and task planning must be rerun',
        )
        return
      }
      const auditFacts = await contractFactsFor(next)
      next = reconcileImplementationAudit({
        run: { ...next, phase: 'IMPLEMENTATION_AUDIT' },
        workspacePath: input.workspacePath,
        terminal: result,
        expectedChecklistIds: auditFacts.checklistIds,
        expectedImportIds: auditFacts.importIds,
        expectedCompositionIds: auditFacts.compositionIds,
        currentImplementationRevision: await computeWorkspaceRevision(
          input.workspacePath,
        ),
      })
      if (next.phase === 'IMPLEMENTATION') {
        next = resetImplementationTasks(
          next,
          result.findings.join('; ') || 'implementation audit failed',
        )
        await persist(next, 'implementation.audit.reconciled')
        await startNextImplementationTask({
          run: next,
          workspacePath: input.workspacePath,
          revision: next.revision.workspace,
          dispatcher,
          beforeDispatch: started =>
            persist(started, 'task.started').then(() => undefined),
        })
        return
      }
      await persist(next, 'implementation.audit.reconciled')
      const acceptanceFacts = await contractFactsFor(next)
      await dispatcher.dispatch({
        runId: next.runId,
        ownerId: next.ownerId,
        projectId: next.projectId,
        workspacePath: input.workspacePath,
        workerType: 'acceptance-validator',
        phase: 'ACCEPTANCE',
        revision: next.revision.implementation ?? next.revision.workspace,
        allowedPaths: [WORKFLOW_EVIDENCE_DIRECTORY],
        contract: acceptanceFacts,
      })
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
          'resource preparation is missing or approved resources changed before acceptance; resource preparation and task planning must be rerun',
        )
        return
      }
      const acceptanceFacts = await contractFactsFor(next)
      next = reconcileAcceptance({
        run: { ...next, phase: 'ACCEPTANCE' },
        workspacePath: input.workspacePath,
        terminal: result,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedImportIds: acceptanceFacts.importIds,
        expectedCompositionIds: acceptanceFacts.compositionIds,
        currentImplementationRevision: await computeWorkspaceRevision(
          input.workspacePath,
        ),
      })
      if (next.phase === 'DELIVERY')
        next = transitionDeliveryRun(next, { type: 'delivery_completed' })
      if (next.phase === 'IMPLEMENTATION') {
        next = resetImplementationTasks(
          next,
          result.findings.join('; ') || 'runtime acceptance failed',
        )
        await persist(next, 'acceptance.reconciled')
        await startNextImplementationTask({
          run: next,
          workspacePath: input.workspacePath,
          revision: next.revision.workspace,
          dispatcher,
          beforeDispatch: started =>
            persist(started, 'task.started').then(() => undefined),
        })
      } else {
        await persist(
          next,
          next.status === 'completed'
            ? 'run.completed'
            : 'acceptance.reconciled',
        )
      }
    }
  }

  function resetImplementationTasks(
    run: DeliveryRun,
    reason: string,
  ): DeliveryRun {
    return {
      ...run,
      phase: 'IMPLEMENTATION',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: reason,
      revision: { ...run.revision, implementation: undefined },
      tasks: run.tasks.map(task => ({
        ...task,
        status: 'pending',
        attempt: task.attempt,
        startedRevision: undefined,
        completedRevision: undefined,
        evidenceRefs: [],
      })),
    }
  }

  function resourceIntegrationBlocked(
    run: DeliveryRun,
    readiness: ResourceDeliveryReadiness,
  ): DeliveryRun {
    return {
      ...run,
      status: 'needs_action',
      activeDispatch: undefined,
      blockedReason: [...readiness.issues, ...readiness.integrationIssues].join(
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
      !run.revision.resource ||
      evidence?.status !== 'passed' ||
      evidence.revision !== run.revision.resource
    )
  }

  function comprehensiveReviewMissing(run: DeliveryRun): boolean {
    const evidence = run.evidence.documentReview
    return (
      !run.revision.resource ||
      evidence?.status !== 'ready' ||
      evidence.revision !== run.revision.resource
    )
  }

  async function restartResourcePreparation(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const invalidated: DeliveryRun = {
      ...run,
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: reason,
      revision: {
        ...run.revision,
        resource: undefined,
        implementation: undefined,
      },
      tasks: [],
      evidence: {
        documentReview: run.evidence.documentReview,
      },
    }
    await persist(invalidated, 'resource.revision.invalidated')
    await startResourcePreparation({
      run: invalidated,
      workspacePath: input.workspacePath,
      dispatcher,
    })
  }

  async function restartDocumentStage(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const documentRevision = await computeDocumentRevision(
      input.workspacePath,
      run.confirmedBriefDigest,
    )
    const workspaceRevision = await computeWorkspaceRevision(
      input.workspacePath,
    )
    const invalidated: DeliveryRun = {
      ...run,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: reason,
      revision: {
        ...run.revision,
        document: documentRevision,
        resource: undefined,
        implementation: undefined,
        workspace: workspaceRevision,
      },
      tasks: [],
      evidence: {},
      checklistRemediation: undefined,
    }
    await persist(invalidated, 'document.revision.invalidated')
    await startDocumentStage({
      run: invalidated,
      workspacePath: input.workspacePath,
      dispatcher,
    })
  }

  async function resumeUnlocked(run: DeliveryRun): Promise<void> {
    if (run.status !== 'running') return
    if (run.activeDispatch?.terminalResult) {
      await dispatcher.replayTerminal(run.activeDispatch)
      return
    }
    if (run.activeDispatch?.status === 'running') return
    if (
      run.activeDispatch?.status === 'invalid' &&
      run.activeDispatch.workerType === 'document-author' &&
      run.activeDispatch.terminalOutput &&
      run.activeDispatch.request?.runId === run.runId &&
      run.activeDispatch.request.ownerId === run.ownerId &&
      run.activeDispatch.request.projectId === run.projectId &&
      run.activeDispatch.request.workspacePath === input.workspacePath &&
      run.activeDispatch.request.phase === run.phase &&
      run.activeDispatch.request.workerType === 'document-author'
    ) {
      let recovered: WorkerTerminalResult | undefined
      try {
        recovered = parseWorkerTerminalResult(run.activeDispatch.terminalOutput)
      } catch {
        // The retained result is not a valid document-author completion.
        // Continue through the normal retry path and start a fresh worker.
      }
      if (recovered?.workerType === 'document-author') {
        await handleTerminalUnlocked(
          run.activeDispatch,
          recovered,
          run.activeDispatch.request,
        )
        return
      }
    }
    if (run.changeRequest && !run.changeRoute && run.phase === 'DELIVERY') {
      await dispatcher.dispatch(
        buildChangeImpactDispatch(run, input.workspacePath, run.changeRequest),
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
    if (run.phase === 'DOCUMENT_DRAFTING') {
      const changeMessage = run.changeRequest
      if (changeMessage) {
        await dispatcher.dispatch({
          runId: run.runId,
          ownerId: run.ownerId,
          projectId: run.projectId,
          workspacePath: input.workspacePath,
          workerType: 'document-author',
          phase: run.phase,
          revision: run.revision.document,
          allowedPaths: ['docs/'],
          contract: {
            confirmedBriefDigest: run.confirmedBriefDigest,
            changeRequest: changeMessage,
          },
        })
      } else {
        await startDocumentStage({
          run,
          workspacePath: input.workspacePath,
          dispatcher,
        })
      }
      return
    }
    if (run.phase === 'DOCUMENT_REVIEW') {
      if (run.documentStep === 'CHECKLIST_DRAFTING') {
        await startChecklistDraftStage({
          run,
          workspacePath: input.workspacePath,
          dispatcher,
        })
      } else {
        const reviewScope =
          run.documentStep === 'FOUNDATION_REVIEW' ? 'foundation' : 'complete'
        await dispatcher.dispatch({
          runId: run.runId,
          ownerId: run.ownerId,
          projectId: run.projectId,
          workspacePath: input.workspacePath,
          workerType: 'document-reviewer',
          phase: run.phase,
          revision:
            reviewScope === 'complete'
              ? (run.revision.resource ?? run.revision.document)
              : run.revision.document,
          allowedPaths: [WORKFLOW_EVIDENCE_DIRECTORY],
          contract: {
            canonicalDocuments: true,
            reviewScope,
            ...(run.documentRemediation
              ? { priorRemediation: run.documentRemediation }
              : {}),
          },
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
    if (run.phase === 'ATOMIC_TASK_PLANNING') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while task planning was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; the resource stage must be completed before task planning',
        )
        return
      }
      if (comprehensiveReviewMissing(run)) {
        const awaitingReview = await persist(
          {
            ...run,
            phase: 'DOCUMENT_REVIEW',
            documentStep: 'CHECKLIST_REVIEW',
            activeDispatch: undefined,
            status: 'running',
            blockedReason: undefined,
          },
          'comprehensive.review.required',
        )
        await resumeUnlocked(awaitingReview)
        return
      }
      await dispatcher.dispatch({
        runId: run.runId,
        ownerId: run.ownerId,
        projectId: run.projectId,
        workspacePath: input.workspacePath,
        workerType: 'atomic-task-planner',
        phase: run.phase,
        revision: run.revision.document,
        allowedPaths: [WORKFLOW_EVIDENCE_DIRECTORY],
        contract: {
          ...(await contractFactsFor(run)),
          ...(run.changeRequest ? { changeRequest: run.changeRequest } : {}),
        },
      })
      return
    }
    if (run.phase === 'IMPLEMENTATION') {
      if (await documentRevisionChanged(run)) {
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
    if (run.phase === 'IMPLEMENTATION_AUDIT') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while implementation audit was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; implementation audit cannot start before the resource stage is complete',
        )
        return
      }
      const auditFacts = await contractFactsFor(run)
      if (!auditFacts.resourceReadiness.integrationReady) {
        await persist(
          resourceIntegrationBlocked(run, auditFacts.resourceReadiness),
          'resource.integration.needs_action',
        )
        return
      }
      await startImplementationAudit({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: auditFacts.checklistIds,
        expectedImportIds: auditFacts.importIds,
        expectedCompositionIds: auditFacts.compositionIds,
        resourceReadiness: auditFacts.resourceReadiness,
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
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; acceptance cannot start before the resource stage is complete',
        )
        return
      }
      const acceptanceFacts = await contractFactsFor(run)
      await startAcceptance({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedImportIds: acceptanceFacts.importIds,
        expectedCompositionIds: acceptanceFacts.compositionIds,
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
    return serialize(() => resumeUnlocked(run))
  }

  function ensureProgress(run: DeliveryRun): Promise<void> {
    return serialize(async () => {
      if (run.status !== 'running') return
      if (run.activeDispatch?.status === 'running') return
      await resumeUnlocked(run)
    })
  }

  function requestChange(run: DeliveryRun, message: string): Promise<unknown> {
    return serialize(() => requestChangeUnlocked(run, message))
  }

  return {
    store,
    dispatcher,
    start: (run: DeliveryRun) =>
      startDocumentStage({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
      }),
    resume,
    ensureProgress,
    requestChange,
  }
}

function isCanonicalDocumentPath(path: string): boolean {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  return CANONICAL_DOCUMENT_ARTIFACTS.includes(normalized as never)
}

async function plannerContractFacts(
  workspacePath: string,
  confirmedBriefContext?: string,
  resourceEvidence?: NativeResourceLibraryEvidenceState,
): Promise<
  AtomicTaskContractFacts & {
    importIds: string[]
    compositionIds: string[]
    resourceReadiness: ResourceDeliveryReadiness
  }
> {
  const assetContract = auditAssetContract(workspacePath)
  const resourceReadiness = auditResourceDeliveryReadiness({
    workspacePath,
    confirmedPolicy: confirmedResourceLibraryUsage(confirmedBriefContext),
    ...(resourceEvidence ? { resourceEvidence } : {}),
  })
  return {
    requirementIds: assetContract.requirements.map(
      requirement => requirement.id,
    ),
    checklistIds: readAcceptanceChecklistIds(workspacePath),
    importIds: (assetContract.imports ?? []).map(
      resourceImport => resourceImport.id,
    ),
    compositionIds: assetContract.compositions.map(
      composition => composition.id,
    ),
    resourceReadiness,
  }
}

export type DeliveryWorkflowController = ReturnType<
  typeof createDeliveryWorkflowController
>
