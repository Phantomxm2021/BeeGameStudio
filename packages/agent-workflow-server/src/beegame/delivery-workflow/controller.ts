import {
  applyAtomicTaskPlan,
  AtomicTaskPlanError,
  readAtomicTaskPlanningDocuments,
  validateAtomicTaskGraph,
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
  startChecklistDraftStage,
  startDocumentStage,
} from './document-stage'
import { canStartFoundationAudit } from './foundation-audit-boundary'
import { createFoundationAuditState } from './foundation-audit-state'
import { acceptFoundationAuditTerminal } from './foundation-audit-state'
import { deriveFoundationAuditArtifacts } from './foundation-audit-artifacts'
import { publishDerivedFoundationAuditArtifacts } from './foundation-audit-artifacts'
import { buildFoundationFactPackets, extractNormalizedFoundationFacts, validateFoundationFactResults } from './foundation-fact-extraction'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  completeResourceTask,
  reconcileCurrentResourcePreparation,
  startResourcePreparation,
} from './resource-stage'
import {
  completeImplementationTask,
  implementationCompletionIssue,
  startNextImplementationTask,
} from './implementation-stage'
import {
  computeDocumentRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
} from './revision'
import { createRunStore, type RunStore } from './run-store'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
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
  CANONICAL_FOUNDATION_DOCUMENTS,
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
import { recordFoundationFailure } from './foundation-authoring-batch'

async function deriveFoundationAudit(
  run: DeliveryRun,
  workspacePath: string,
): Promise<DeliveryRun> {
  if (run.foundationAuditState)
    return {
      ...run,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: run.foundationAuditState.status === 'derived_committed' ? 'needs_action' : 'running',
      activeDispatch: undefined,
      blockedReason: run.foundationAuditState.needsAction,
      thinking: run.foundationAuditState.status === 'derived_committed' ? 'idle' : 'working',
    }
  const checkpoints = run.foundationDraftState.documents ??
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      status: run.foundationDraftState.completedPaths.includes(path)
        ? ('committed' as const)
        : ('pending' as const),
    }))
  try {
    const artifacts = await deriveFoundationAuditArtifacts({
      workspacePath,
      revision: run.revision.document,
      checkpoints,
    })
    const documents = new Map(
      await Promise.all(
        CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path), 'utf8')] as const),
      ),
    )
    const mechanical = extractNormalizedFoundationFacts({
      documents,
      sectionIndex: artifacts.sectionIndex,
    })
    const packets = buildFoundationFactPackets({
      revision: artifacts.revision,
      documents,
      sectionIndex: artifacts.sectionIndex,
      unresolvedKeys: mechanical.unresolvedKeys,
    })
    await mkdir(join(workspacePath, '.beegame', 'audit', 'foundation', artifacts.revision, 'staging', 'packets'), { recursive: true })
    await writeFile(
      join(workspacePath, '.beegame', 'audit', 'foundation', artifacts.revision, 'staging', 'fact-store.json'),
      `${JSON.stringify({ receipts: mechanical.receipts, facts: mechanical.facts, normalizedFactDigest: mechanical.normalizedFactDigest })}\n`,
      'utf8',
    )
    for (const packet of packets)
      await writeFile(
        join(workspacePath, '.beegame', 'audit', 'foundation', artifacts.revision, 'staging', 'packets', `${Buffer.from(packet.sections[0]?.documentPath ?? packet.packetDigest).toString('base64url')}.json`),
        `${JSON.stringify(packet)}\n`,
        'utf8',
      )
    const tasks = packets.map(packet => ({
      taskId: `foundation-fact:${packet.sections[0]?.documentPath ?? packet.packetDigest}`,
      kind: 'foundation-fact-extraction' as const,
      revision: packet.revision,
      packetDigest: packet.packetDigest,
      modelTier: 'fast' as const,
      status: 'pending' as const,
      attempt: 0,
    }))
    const state = createFoundationAuditState({
      revision: artifacts.revision,
      documentDigests: artifacts.documentDigests,
      manifest: artifacts.manifest,
      tasks,
    })
    if (!packets.length) {
      await publishDerivedFoundationAuditArtifacts({
        workspacePath,
        revision: artifacts.revision,
        documentDigests: artifacts.documentDigests,
        sectionIndex: artifacts.sectionIndex,
        factStore: mechanical.facts,
        normalizedFactDigest: mechanical.normalizedFactDigest,
      })
      return {
        ...run,
        foundationAuditState: { ...state, status: 'derived_committed' as const },
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'needs_action',
        activeDispatch: undefined,
        blockedReason: 'foundation facts are committed; waiting for Task 4C deterministic audit',
        thinking: 'idle',
      }
    }
    return {
      ...run,
      foundationAuditState: { ...state, status: 'extracting_facts' as const },
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      activeDispatch: undefined,
      blockedReason: undefined,
      thinking: 'working',
    }
  } catch (error) {
    return {
      ...run,
      foundationAuditState: undefined,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      activeDispatch: undefined,
      blockedReason: `foundation audit derivation failed: ${error instanceof Error ? error.message : String(error)}`,
      thinking: 'idle',
    }
  }
}

export function createDeliveryWorkflowController(input: {
  workspacePath: string
  ownerId: string
  workerPort: DeliveryWorkerPort
  handoffRecoveryGraceMs?: number
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
    AtomicTaskContractFacts & {
      resourceIds: string[]
      contentIds: string[]
      resourceReadiness: ResourceDeliveryReadiness
    }
  > {
    return plannerContractFacts(
      input.workspacePath,
      run.confirmedBriefContext,
      run.resourceProductionState.inventoryReceipt?.catalogObserved ?? false,
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
    const foundationCheckpoint = run?.foundationDraftState.documents?.find(
      document => document.dispatch?.dispatchId === record.dispatchId,
    )
    if (
      !run ||
      (run.activeDispatch?.dispatchId !== record.dispatchId &&
        !foundationCheckpoint)
    )
      return
    let next: DeliveryRun = foundationCheckpoint
      ? { ...run, activeDispatch: record }
      : { ...run, activeDispatch: undefined }
    if (result.workerType === 'foundation-fact-extractor') {
      const auditState = next.foundationAuditState
      const auditTask = auditState?.tasks.find(task => task.taskId === result.taskId)
      if (!auditState || !auditTask) return
      if (auditTask.status !== 'completed' && request?.contract.packet) {
        const packet = request.contract.packet as Parameters<typeof validateFoundationFactResults>[0]['packet']
        const documents = new Map(
          await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(input.workspacePath, path), 'utf8')] as const)),
        )
        const artifacts = await deriveFoundationAuditArtifacts({
          workspacePath: input.workspacePath,
          revision: auditState.revision,
          checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })),
        })
        const admitted = validateFoundationFactResults({
          packet,
          expectedRevision: auditState.revision,
          documents,
          sectionIndex: artifacts.sectionIndex,
          results: result.results as never,
        })
        const stagedPath = join(input.workspacePath, '.beegame', 'audit', 'foundation', auditState.revision, 'staging', 'fact-store.json')
        const existing = JSON.parse(await readFile(stagedPath, 'utf8')) as { facts?: never[]; receipts?: unknown[] }
        const facts = createFoundationFactStore([...(existing.facts ?? []), ...admitted.facts])
        await writeFile(stagedPath, `${JSON.stringify({ facts, receipts: [...(existing.receipts ?? []), ...admitted.receipts], normalizedFactDigest: digestFactStore(facts) })}\n`, 'utf8')
      }
      const completedState = auditTask.status === 'completed'
        ? auditState
        : acceptFoundationAuditTerminal(auditState, {
            taskId: result.taskId,
            dispatchId: record.dispatchId,
            revision: result.revision,
            packetDigest: result.packetDigest,
            terminalDigest: result.terminalDigest,
            status: 'completed',
            durationMs: Math.max(0, Date.parse(record.finishedAt ?? new Date().toISOString()) - Date.parse(record.startedAt)),
          })
      next = { ...next, foundationAuditState: completedState }
      if (completedState.tasks.every(task => task.status === 'completed')) {
        const factsRaw = await readFile(
          join(input.workspacePath, '.beegame', 'audit', 'foundation', completedState.revision, 'staging', 'fact-store.json'),
          'utf8',
        ).catch(() => '{"facts":[],"normalizedFactDigest":"' + '0'.repeat(64) + '"}')
        const staged = JSON.parse(factsRaw) as { facts?: unknown[]; normalizedFactDigest?: string }
        await publishDerivedFoundationAuditArtifacts({
          workspacePath: input.workspacePath,
          revision: completedState.revision,
          documentDigests: Object.entries(completedState.documentDigests).map(([path, digest]) => ({ path: path as never, digest })),
          sectionIndex: (await deriveFoundationAuditArtifacts({ workspacePath: input.workspacePath, revision: completedState.revision, checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })) })).sectionIndex,
          factStore: staged.facts ?? [],
          normalizedFactDigest: staged.normalizedFactDigest ?? '0'.repeat(64),
        })
        next = { ...next, foundationAuditState: { ...completedState, status: 'derived_committed' as const, needsAction: 'foundation facts are committed; waiting for Task 4C deterministic audit' }, status: 'needs_action', blockedReason: 'foundation facts are committed; waiting for Task 4C deterministic audit', thinking: 'idle' }
      }
      await persist(next, 'foundation.fact_extraction.progressed')
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
        phase:
          result.classification === 'documents_required'
            ? 'DOCUMENT_DRAFTING'
            : 'ATOMIC_TASK_PLANNING',
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
            ? { currentTask: 'RESOURCE_PLAN' }
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
      const documentSet =
        request?.contract.documentSet === 'checklist'
          ? 'checklist'
          : 'foundation'
      next = await completeDocumentDraft({
            run: {
              ...next,
              activeDispatch: record,
              phase:
                documentSet === 'checklist'
                  ? 'DOCUMENT_REVIEW'
                  : 'DOCUMENT_DRAFTING',
            },
            workspacePath: input.workspacePath,
            terminal: result,
            documentSet,
      })
      if (documentSet === 'foundation' && canStartFoundationAudit(next))
        next = await deriveFoundationAudit(next, input.workspacePath)
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
    if (
      result.workerType === 'resource-planner' ||
      result.workerType === 'resource-curator' ||
      result.workerType === 'resource-content-author'
    ) {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed during resource preparation; document review and downstream work must be rerun',
        )
        return
      }
      next = await completeResourceTask({
        run: next,
        workspacePath: input.workspacePath,
        terminal: result,
      })
      next = await persist(
        next,
        next.phase === 'RESOURCE_PREPARATION' && next.status === 'running'
          ? 'resource.preparation.progressed'
          : next.phase === 'DOCUMENT_REVIEW'
            ? 'resource.preparation.ready'
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
      await persist(next, 'tasks.planned', { taskGraph: next.tasks })
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
        completionFailureReason = implementationCompletionIssue({
          task: activeTask,
          workspacePath: input.workspacePath,
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
        next = await persist(enterImplementationAudit(next), 'phase.entered')
        await startImplementationAudit({
          run: next,
          workspacePath: input.workspacePath,
          dispatcher,
          expectedChecklistIds: auditFacts.checklistIds,
          expectedResourceIds: auditFacts.resourceIds,
          expectedContentIds: auditFacts.contentIds,
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
        expectedResourceIds: auditFacts.resourceIds,
        expectedContentIds: auditFacts.contentIds,
        currentImplementationRevision: await computeWorkspaceRevision(
          input.workspacePath,
        ),
      })
      if (result.status !== 'passed') {
        if (result.status === 'blocked') {
          await persist(next, 'implementation.audit.reconciled', {
            findings: result.findings,
          })
          return
        }
        if (findingsRequireTaskReplan(next, result.findings)) {
          await restartAtomicTaskPlanning(
            next,
            'implementation audit found required artifacts outside every existing task scope; the atomic task graph must be rebuilt',
          )
          return
        }
        const invalidatedTaskIds = affectedImplementationTaskIds(
          next,
          result.findings,
        )
        next = resetImplementationTasks(next, invalidatedTaskIds)
        await persist(next, 'implementation.audit.remediation_planned', {
          findings: result.findings,
          invalidatedTaskIds,
        })
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
      await startAcceptance({
        run: next,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedResourceIds: acceptanceFacts.resourceIds,
        expectedContentIds: acceptanceFacts.contentIds,
        currentImplementationRevision:
          next.revision.implementation ?? next.revision.workspace,
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
      next = await reconcileAcceptance({
        run: { ...next, phase: 'ACCEPTANCE' },
        workspacePath: input.workspacePath,
        terminal: result,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedResourceIds: acceptanceFacts.resourceIds,
        expectedContentIds: acceptanceFacts.contentIds,
        currentImplementationRevision: await computeWorkspaceRevision(
          input.workspacePath,
        ),
      })
      if (next.phase === 'DELIVERY')
        next = transitionDeliveryRun(next, { type: 'delivery_completed' })
      if (result.status === 'failed') {
        if (findingsRequireTaskReplan(next, result.findings)) {
          await restartAtomicTaskPlanning(
            next,
            'acceptance found required artifacts outside every existing task scope; the atomic task graph must be rebuilt',
          )
          return
        }
        const invalidatedTaskIds = affectedImplementationTaskIds(
          next,
          result.findings,
        )
        next = resetImplementationTasks(next, invalidatedTaskIds)
        await persist(next, 'acceptance.remediation_planned', {
          findings: result.findings,
          invalidatedTaskIds,
        })
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

  function affectedImplementationTaskIds(
    run: DeliveryRun,
    findings: Array<{ taskIds: string[] }>,
  ): string[] {
    const affected = new Set(findings.flatMap(finding => finding.taskIds))
    let changed = true
    while (changed) {
      changed = false
      for (const task of run.tasks) {
        if (
          !affected.has(task.id) &&
          task.dependsOn.some(dependencyId => affected.has(dependencyId))
        ) {
          affected.add(task.id)
          changed = true
        }
      }
    }
    return run.tasks.map(task => task.id).filter(taskId => affected.has(taskId))
  }

  function findingsRequireTaskReplan(
    run: DeliveryRun,
    findings: Array<{ artifactPaths: string[] }>,
  ): boolean {
    return findings.some(finding =>
      finding.artifactPaths.some(
        artifactPath =>
          !run.tasks.some(task =>
            task.allowedPaths.some(scope => {
              const normalizedArtifact = normalizeTaskPath(artifactPath)
              const normalizedScope = normalizeTaskPath(scope)
              return (
                normalizedArtifact === normalizedScope ||
                normalizedArtifact.startsWith(`${normalizedScope}/`)
              )
            }),
          ),
      ),
    )
  }

  function normalizeTaskPath(path: string): string {
    let normalized = path.replaceAll('\\', '/')
    while (normalized.startsWith('./')) normalized = normalized.slice(2)
    while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized
  }

  function resetImplementationTasks(
    run: DeliveryRun,
    invalidatedTaskIds: string[],
  ): DeliveryRun {
    const invalidated = new Set(invalidatedTaskIds)
    return {
      ...run,
      phase: 'IMPLEMENTATION',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: undefined,
      revision: { ...run.revision, implementation: undefined },
      evidence: {
        ...run.evidence,
        implementationAudit: undefined,
        acceptance: undefined,
      },
      tasks: run.tasks.map(task =>
        invalidated.has(task.id)
          ? {
              ...task,
              status: 'pending',
              startedRevision: undefined,
              completedRevision: undefined,
              evidenceRefs: [],
            }
          : task,
      ),
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
      foundationDraftState: { completedPaths: [] },
      foundationAuditState: undefined,
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    }
    await persist(invalidated, 'document.revision.invalidated')
    await startDocumentStage({
      run: invalidated,
      workspacePath: input.workspacePath,
      dispatcher,
    })
  }

  async function restartAtomicTaskPlanning(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const invalidated: DeliveryRun = {
      ...run,
      phase: 'ATOMIC_TASK_PLANNING',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: reason,
      revision: { ...run.revision, implementation: undefined },
      tasks: [],
      evidence: {
        ...run.evidence,
        implementationAudit: undefined,
        acceptance: undefined,
      },
    }
    await persist(invalidated, 'atomic.task.plan.invalidated')
    await resumeUnlocked(invalidated)
  }

  async function resumeUnlocked(run: DeliveryRun): Promise<void> {
    if (run.status !== 'running') return
    if (
      run.phase === 'DOCUMENT_DRAFTING' &&
      run.foundationDraftState.documents
    ) {
      const replayable = run.foundationDraftState.documents.find(
        document => document.dispatch?.terminalResult,
      )?.dispatch
      if (replayable) {
        await dispatcher.replayTerminal(replayable, handleTerminalUnlocked)
        return
      }
      const runningDocuments = run.foundationDraftState.documents.filter(
        document => document.dispatch?.status === 'running',
      )
      if (runningDocuments.length) {
        const unavailable: typeof runningDocuments = []
        for (const document of runningDocuments) {
          const isOpen = await dispatcher
            .workerIsOpen(document.dispatch!.dispatchId)
            .catch(() => false)
          if (!isOpen) unavailable.push(document)
        }
        if (!unavailable.length) return
        let foundationDraftState = run.foundationDraftState
        for (const document of unavailable)
          foundationDraftState = recordFoundationFailure(
            foundationDraftState,
            document.path,
            'preserved native document session is unavailable',
          )
        const stillRunning = foundationDraftState.documents?.some(
          document => document.dispatch?.status === 'running',
        )
        const recovered = await persist(
          {
            ...run,
            foundationDraftState,
            status: stillRunning ? 'running' : 'needs_action',
            blockedReason: stillRunning
              ? undefined
              : 'one or more preserved native document sessions are unavailable',
          },
          'document.parallel.session_unavailable',
        )
        if (recovered.status === 'running') await resumeUnlocked(recovered)
        return
      }
    }
    if (run.activeDispatch?.terminalResult) {
      // resumeUnlocked already owns the controller serialization lane. Reuse
      // the canonical terminal handler directly instead of queueing behind
      // ourselves through handleTerminal.
      await dispatcher.replayTerminal(
        run.activeDispatch,
        handleTerminalUnlocked,
      )
      return
    }
    if (run.foundationAuditState?.status === 'extracting_facts') {
      const state = run.foundationAuditState
      if (state.tasks.some(task => task.status === 'running')) return
      const candidates = state.tasks.filter(task => task.status === 'pending' || task.status === 'retryable')
      for (const task of candidates.slice(0, 4)) {
        const documentPath = task.taskId.startsWith('foundation-fact:')
          ? task.taskId.slice('foundation-fact:'.length)
          : task.taskId
        const packetPath = join(
          input.workspacePath,
          '.beegame', 'audit', 'foundation', state.revision, 'staging', 'packets',
          `${Buffer.from(documentPath).toString('base64url')}.json`,
        )
        const packet = JSON.parse(await readFile(packetPath, 'utf8')) as Record<string, unknown>
        await dispatcher.dispatch({
          runId: run.runId,
          ownerId: run.ownerId,
          projectId: run.projectId,
          workspacePath: input.workspacePath,
          workerType: 'foundation-fact-extractor',
          phase: 'DOCUMENT_REVIEW',
          taskId: task.taskId,
          revision: state.revision,
          allowedPaths: [],
          contract: {
            packetDigest: task.packetDigest,
            packet,
            modelTier: 'fast',
          },
        })
      }
      return
    }
    if (run.activeDispatch?.status === 'running') return
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
      if (canStartFoundationAudit(run)) {
        const next = await deriveFoundationAudit(run, input.workspacePath)
        await persist(
          next,
          next.foundationAuditState
            ? 'foundation.audit.index_staged'
            : 'foundation.audit.derivation_failed',
        )
        if (next.status === 'running') await resumeUnlocked(next)
        return
      }
      await startDocumentStage({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
      })
      return
    }
    if (run.phase === 'DOCUMENT_REVIEW') {
      if (run.foundationAuditState?.status === 'derived_committed') return
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
      const reconciledResources = await reconcileCurrentResourcePreparation({
        run,
        workspacePath: input.workspacePath,
      })
      if (reconciledResources) {
        const saved = await persist(
          reconciledResources,
          'resource.preparation.reconciled',
        )
        await resumeUnlocked(saved)
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
      const planningFacts = await contractFactsFor(run)
      await dispatcher.dispatch({
        runId: run.runId,
        ownerId: run.ownerId,
        projectId: run.projectId,
        workspacePath: input.workspacePath,
        workerType: 'atomic-task-planner',
        phase: run.phase,
        revision: run.revision.document,
        allowedPaths: [],
        contract: {
          checklistIds: planningFacts.checklistIds,
          resourceIds: planningFacts.resourceIds,
          contentIds: planningFacts.contentIds,
          planningDocuments: await readAtomicTaskPlanningDocuments(
            input.workspacePath,
          ),
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
      try {
        validateAtomicTaskGraph(run.tasks, await contractFactsFor(run))
      } catch (error) {
        if (!(error instanceof AtomicTaskPlanError)) throw error
        await restartAtomicTaskPlanning(
          run,
          `atomic task graph is no longer valid: ${error.message}`,
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
      if (!auditFacts.resourceReadiness.ready) {
        await persist(
          resourceDeliveryBlocked(run, auditFacts.resourceReadiness),
          'resource.delivery.needs_action',
        )
        return
      }
      await startImplementationAudit({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: auditFacts.checklistIds,
        expectedResourceIds: auditFacts.resourceIds,
        expectedContentIds: auditFacts.contentIds,
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
        expectedResourceIds: acceptanceFacts.resourceIds,
        expectedContentIds: acceptanceFacts.contentIds,
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
      // Polling and retry requests may carry a stale snapshot. Always make the
      // recovery decision from the durable run so an orphaned `running` state
      // cannot be preserved by an outdated activeDispatch value.
      const current = await store.load()
      if (!current || current.runId !== run.runId) return
      if (current.status !== 'running') return
      if (current.activeDispatch?.status === 'running') return
      await resumeUnlocked(current)
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
  catalogObserved = false,
): Promise<
  AtomicTaskContractFacts & {
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
    contentIds: assetContract.content.files.map(file => file.id),
    resourceReadiness,
  }
}

export type DeliveryWorkflowController = ReturnType<
  typeof createDeliveryWorkflowController
>
