import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const directory = 'packages/agent-workflow-server/src/beegame/delivery-workflow/'
export type ReviewerLifecycleSharedFile = 'controller.ts' | 'dispatch.ts' | 'transition.ts' | 'recovery.ts'
export const reviewerLifecycleBaseline = (file: ReviewerLifecycleSharedFile): string =>
  execFileSync('git', ['show', '2d2cb26f1:' + directory + file], { cwd: root, encoding: 'utf8' })

// Each adapter is byte-exact. Restoring only these approved delegations must
// reconstruct the complete trusted shared file, not merely selected functions.
const adapters: Record<ReviewerLifecycleSharedFile, { before: string; after: string }[]> = {
  "controller.ts": [
    {
      "before": "    if (\n      run.phase === 'DOCUMENT_REVIEW' &&\n      run.foundationAuditState &&\n      !isFoundationRevisionPhase(run.foundationAuditState.status)\n    ) {\n      const replayableFactDispatches = foundationRuntimeTasks(run.foundationAuditState)\n        .filter(task => task.status !== 'completed' && task.dispatch?.terminalResult && !terminalAdmissionInFlight.has(task.dispatch.dispatchId))\n        .map(task => task.dispatch!)\n      if (replayableFactDispatches.length) {\n        for (const dispatch of replayableFactDispatches)\n          await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked)\n        return\n      }\n    }",
      "after": "    if (\n      run.phase === 'DOCUMENT_REVIEW' &&\n      run.foundationAuditState &&\n      !isFoundationRevisionPhase(run.foundationAuditState.status)\n    ) {\n      const dispatches = new Map(foundationRuntimeTasks(run.foundationAuditState)\n        .filter(task => task.dispatch).map(task => [task.dispatch!.dispatchId, task.dispatch!]))\n      const replay = replayFoundationReviewTerminals(projectFoundationReviewReplay(run), {\n        isTerminalAdmissionInFlight: dispatchId => terminalAdmissionInFlight.has(dispatchId),\n        replayTerminal: async dispatchId => {\n          const dispatch = dispatches.get(dispatchId)\n          if (!dispatch) throw new Error('review replay dispatch is unavailable')\n          await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked)\n        },\n      })\n      if (replay) {\n        await replay\n        return\n      }\n    }"
    },
    {
      "before": "  async function failFoundationContinuation(\n    run: DeliveryRun,\n    error: unknown,\n  ): Promise<void> {\n    const reason = `foundation audit continuation failed: ${error instanceof Error ? error.message : String(error)}`\n    const lease = await store.mutationLock(run.runId)\n    try {\n      const locked = await store.load(lease)\n      if (!locked || locked.runId !== run.runId) return\n      await store.commit(\n        { ...locked, status: 'needs_action', blockedReason: reason, thinking: 'idle' },\n        { runId: locked.runId, type: 'foundation.audit.continuation_failed', phase: locked.phase, status: 'needs_action', revision: locked.revision, reason },\n        undefined,\n        lease,\n      )\n    } finally {\n      await store.unlock(lease)\n    }\n  }",
      "after": "  async function failFoundationContinuation(\n    run: DeliveryRun,\n    error: unknown,\n  ): Promise<void> {\n    const failure = foundationReviewContinuationFailure(error)\n    const reason = failure.reason\n    const lease = await store.mutationLock(run.runId)\n    try {\n      const locked = await store.load(lease)\n      if (!locked || locked.runId !== run.runId) return\n      await store.commit(\n        { ...locked, status: failure.status, blockedReason: reason, thinking: failure.thinking },\n        { runId: locked.runId, type: failure.eventType, phase: locked.phase, status: failure.status, revision: locked.revision, reason },\n        undefined,\n        lease,\n      )\n    } finally {\n      await store.unlock(lease)\n    }\n  }"
    },
    {
      "before": "",
      "after": "import { replayFoundationReviewTerminals, foundationReviewContinuationFailure } from './stages/foundation-review/public'\nimport { projectFoundationReviewReplay } from './foundation-review-boundary'\n"
    }
  ],
  "dispatch.ts": [
    {
      "before": "",
      "after": "import { foundationReviewFailureNeedsAction } from './stages/foundation-review/public'\n"
    },
    {
      "before": "  function isTerminalFoundationFactFailure(reason: string): boolean {\n    return /(?:fast model|model config|attempt cap|not configured)/i.test(reason)\n  }\n\n  async function completeFoundationFactDispatch(",
      "after": "  async function completeFoundationFactDispatch("
    },
    {
      "before": "        const needsAction = stage3Task && (isTerminalFoundationFactFailure(reason) || task.attempt >= (task.kind === 'confirmation' ? 1 : 2))",
      "after": "        const needsAction = stage3Task && foundationReviewFailureNeedsAction({ kind: task.kind, attempt: task.attempt, reason })"
    },
    {
      "before": "        let claimedFoundationState: FoundationFactTaskCollection | undefined\n        if (factRequest && !revisionFactRequest && current.foundationAuditState && request.taskId) {\n          const claimed = claimFoundationFactTasks({\n            revision: current.foundationAuditState.revision,\n            phaseStartedAt: current.foundationAuditState.phaseStartedAt!,\n            status: current.foundationAuditState.status === 'facts_staged' ? 'facts_staged' : 'extracting_facts',\n            tasks: foundationRuntimeTasks(current.foundationAuditState).filter(task => task.kind === 'document-facts'),\n            aggregateUsage: current.foundationAuditState.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 },\n          }, {\n            onlyTaskId: fastModelError ? undefined : request.taskId,\n            dispatchIdFor: () => record.dispatchId,\n            now: record.startedAt,\n            modelReady: !fastModelError && Boolean(request.workflowJsonSchema),\n          })\n          claimedFoundationState = claimed\n          const claimedTask = claimed.tasks.find(task => task.taskId === request.taskId)\n          if (!claimedTask || claimedTask.status !== 'running') {\n            const blocked = claimedTask?.failureReason ?? fastModelError ?? 'foundation fact task is not claimable'\n            await options.store.commit({ ...current, foundationAuditState: { ...current.foundationAuditState, tasks: claimed.tasks }, status: 'needs_action', blockedReason: blocked, thinking: 'idle' }, { runId: current.runId, type: 'foundation.fact.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, dispatchId: record.dispatchId, taskId: request.taskId, reason: blocked }, undefined, lease)\n            throw new DispatchError('blocked', blocked)\n          }\n        }\n        let claimedSemanticState: FoundationSemanticTaskCollection | undefined\n        if (semanticRequest && current.foundationAuditState && request.taskId) {\n          const semanticTasks = foundationRuntimeTasks(current.foundationAuditState).filter(task => task.kind === 'semantic' || task.kind === 'confirmation') as FoundationSemanticRuntimeTask[]\n          const claimed = claimFoundationSemanticTasks({ revision: current.foundationAuditState.revision, phaseStartedAt: current.foundationAuditState.phaseStartedAt!, status: 'semantic_review', tasks: semanticTasks, aggregateUsage: current.foundationAuditState.semantic?.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }, ...(current.foundationAuditState.semantic?.deepPhaseStartedAt ? { deepPhaseStartedAt: current.foundationAuditState.semantic.deepPhaseStartedAt } : {}), ...(current.foundationAuditState.semantic?.deepAggregateUsage ? { deepAggregateUsage: current.foundationAuditState.semantic.deepAggregateUsage } : {}) }, { onlyTaskId: fastModelError ? undefined : request.taskId, dispatchIdFor: () => record.dispatchId, now: record.startedAt, configuredTiers: { [request.contract.modelTier as string]: !fastModelError } })\n          claimedSemanticState = claimed\n          const claimedTask = claimed.tasks.find(task => task.taskId === request.taskId)\n          if (!claimedTask || claimedTask.status !== 'running') {\n            const blocked = claimedTask?.failureReason ?? fastModelError ?? 'foundation semantic task is not claimable'\n            await options.store.commit({ ...current, foundationAuditState: { ...current.foundationAuditState, tasks: current.foundationAuditState.tasks.map(task => claimed.tasks.find(candidate => candidate.taskId === task.taskId) ?? task), semantic: { aggregateUsage: claimed.aggregateUsage, ...(claimed.deepPhaseStartedAt ? { deepPhaseStartedAt: claimed.deepPhaseStartedAt } : {}), ...(claimed.deepAggregateUsage ? { deepAggregateUsage: claimed.deepAggregateUsage } : {}) } }, status: 'needs_action', blockedReason: blocked, thinking: 'idle' }, { runId: current.runId, type: 'foundation.semantic.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, dispatchId: record.dispatchId, taskId: request.taskId, reason: blocked }, undefined, lease)\n            throw new DispatchError('blocked', blocked)\n          }\n        }",
      "after": "        let claimedFoundationState: FoundationFactTaskCollection | undefined\n        if (factRequest && !revisionFactRequest && current.foundationAuditState && request.taskId) {\n          const prepared = prepareFoundationFactClaim(projectFoundationFactClaim(current, request, record, fastModelError))\n          const claimed = prepared.state\n          claimedFoundationState = claimed\n          if (prepared.kind === 'blocked') {\n            const blocked = prepared.reason\n            await options.store.commit({ ...current, foundationAuditState: { ...current.foundationAuditState, tasks: claimed.tasks }, status: 'needs_action', blockedReason: blocked, thinking: 'idle' }, { runId: current.runId, type: 'foundation.fact.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, dispatchId: record.dispatchId, taskId: request.taskId, reason: blocked }, undefined, lease)\n            throw new DispatchError('blocked', blocked)\n          }\n        }\n        let claimedSemanticState: FoundationSemanticTaskCollection | undefined\n        if (semanticRequest && current.foundationAuditState && request.taskId) {\n          const prepared = prepareFoundationSemanticClaim(projectFoundationSemanticClaim(current, request, record, fastModelError))\n          const claimed = prepared.state\n          claimedSemanticState = claimed\n          if (prepared.kind === 'blocked') {\n            const blocked = prepared.reason\n            await options.store.commit({ ...current, foundationAuditState: { ...current.foundationAuditState, tasks: current.foundationAuditState.tasks.map(task => claimed.tasks.find(candidate => candidate.taskId === task.taskId) ?? task), semantic: { aggregateUsage: claimed.aggregateUsage, ...(claimed.deepPhaseStartedAt ? { deepPhaseStartedAt: claimed.deepPhaseStartedAt } : {}), ...(claimed.deepAggregateUsage ? { deepAggregateUsage: claimed.deepAggregateUsage } : {}) } }, status: 'needs_action', blockedReason: blocked, thinking: 'idle' }, { runId: current.runId, type: 'foundation.semantic.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, dispatchId: record.dispatchId, taskId: request.taskId, reason: blocked }, undefined, lease)\n            throw new DispatchError('blocked', blocked)\n          }\n        }"
    },
    {
      "before": "",
      "after": "import { prepareFoundationFactClaim, prepareFoundationSemanticClaim } from './stages/foundation-review/public'\nimport { projectFoundationFactClaim, projectFoundationSemanticClaim } from './foundation-review-boundary'\n"
    },
    {
      "before": "          task: { ...task, status: 'retryable', attempt: Math.max(0, task.attempt - 1), failureReason: reason, dispatch: terminal } as FoundationAuditTask,",
      "after": "          task: task.kind === 'document-facts' || task.kind === 'semantic' || task.kind === 'confirmation'\n            ? stopFoundationReviewTask({ task: projectFoundationReviewLifecycleTask(task), reason, interruptDispatch: () => terminal }) as FoundationAuditTask\n            : { ...task, status: 'retryable', attempt: Math.max(0, task.attempt - 1), failureReason: reason, dispatch: terminal } as FoundationAuditTask,"
    },
    {
      "before": "",
      "after": "import { stopFoundationReviewTask, projectFoundationReviewLifecycleTask } from './stages/foundation-review/public'\n"
    }
  ],
  "transition.ts": [
    {
      "before": "        let auditRevived = false\n        const nextAuditState = auditState\n          ? {\n              ...auditState,\n              tasks: auditState.tasks.map(task => {\n                if (\n                  (!isEligibleFoundationRetryTask(task, event.taskId) &&\n                    !isUserStoppedFoundationRetryTask(task, event.taskId)) ||\n                  !['document-facts', 'semantic', 'confirmation'].includes(\n                    task.kind,\n                  )\n                )\n                  return task\n                auditRevived = true\n                return {\n                  ...task,\n                  status: 'pending' as const,\n                  failureReason: undefined,\n                }\n              }),\n            }\n          : undefined",
      "after": "        const auditRetry = auditState ? retryFoundationReviewStateTasks(auditState, event.taskId) : undefined\n        const auditRevived = auditRetry?.revived ?? false\n        const nextAuditState = auditState && auditRetry\n          ? { ...auditState, tasks: auditRetry.tasks }\n          : undefined"
    },
    {
      "before": "",
      "after": "import { retryFoundationReviewStateTasks } from './foundation-review-boundary'\n"
    }
  ],
  "recovery.ts": [
    {
      "before": "                  ? (() => {\n                      const terminal = interruptedDispatch(task.dispatch!)\n                      return projectTaskTerminalEvidence(\n                        {\n                          ...task,\n                          // A user stop interrupts the current attempt; it is\n                          // not a worker failure and must not consume the\n                          // attempt available to the next Continue action.\n                          status: 'retryable' as const,\n                          attempt: Math.max(0, task.attempt - 1),\n                          failureReason: input.reason,\n                          dispatch: terminal,\n                        } as FoundationAuditTask,\n                        terminal,\n                      )\n                    })()\n                  : task,",
      "after": "                  ? task.kind === 'document-facts' || task.kind === 'semantic' || task.kind === 'confirmation'\n                    ? stopFoundationReviewTask({ task: projectFoundationReviewLifecycleTask(task), reason: input.reason, interruptDispatch: interruptedDispatch }) as FoundationAuditTask\n                    : (() => {\n                      const terminal = interruptedDispatch(task.dispatch!)\n                      return projectTaskTerminalEvidence(\n                        {\n                          ...task,\n                          // A user stop interrupts the current attempt; it is\n                          // not a worker failure and must not consume the\n                          // attempt available to the next Continue action.\n                          status: 'retryable' as const,\n                          attempt: Math.max(0, task.attempt - 1),\n                          failureReason: input.reason,\n                          dispatch: terminal,\n                        } as FoundationAuditTask,\n                        terminal,\n                      )\n                    })()\n                  : task,"
    },
    {
      "before": "",
      "after": "import { stopFoundationReviewTask, projectFoundationReviewLifecycleTask } from './stages/foundation-review/public'\n"
    }
  ]
}

export function restoreReviewerLifecycleSource(file: ReviewerLifecycleSharedFile, source: string): string {
  for (const { before, after } of adapters[file]) {
    if (source.split(after).length !== 2) throw new Error('Reviewer lifecycle adapter changed without equivalence review: ' + file)
    source = source.replace(after, before)
  }
  return source
}
