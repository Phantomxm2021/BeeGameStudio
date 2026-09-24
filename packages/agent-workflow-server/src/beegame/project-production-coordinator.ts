import { createHash } from 'node:crypto'
import { createInitialDeliveryRun, createRunStore } from './delivery-workflow/run-store'
import { transitionDeliveryRun } from './delivery-workflow/transition'
import type { DeliveryRun } from './delivery-workflow/types'
import { isFoundationStageActive } from './delivery-workflow/public-stage-routing'
import { FOUNDATION_AUTHOR_REVIEW_HANDOFF_REASON } from './delivery-workflow/foundation-authoring-link'

export const PROJECT_PRODUCTION_STATE_DIRECTORY = '.beegame/delivery/production'

// This is a read-only view of the existing delivery cursor, not another
// scheduler or a second source of truth for stage acceptance.
const PROJECT_DELIVERY_STAGES = [
  'DOCUMENT_DRAFTING', 'DOCUMENT_REVIEW', 'RESOURCE_PREPARATION',
  'GAME_CONTENT', 'IMPLEMENTATION', 'ACCEPTANCE',
] as const

export function projectProductionCheckpoint(run: DeliveryRun) {
  const currentIndex = PROJECT_DELIVERY_STAGES.findIndex(stage => stage === run.phase)
  return {
    status: run.status,
    currentPhase: run.phase,
    ...(run.status !== 'completed' && run.phase !== 'DELIVERY'
      ? { nextRequiredStage: run.phase === 'BRIEF_CONFIRMED'
      ? PROJECT_DELIVERY_STAGES[0] : run.phase } : {}),
    ...(run.documentStep ? { currentStep: run.documentStep } : {}),
    requiredStages: PROJECT_DELIVERY_STAGES,
    recordedPriorStages: currentIndex >= 0
      ? PROJECT_DELIVERY_STAGES.slice(0, currentIndex)
      : run.status === 'completed' ? PROJECT_DELIVERY_STAGES : [],
    ...(run.blockedReason ? { blockedReason: run.blockedReason } : {}),
  }
}

export function readProjectProductionRun(workspacePath: string, ownerId: string) {
  return createRunStore(workspacePath, ownerId, {
    stateDirectory: PROJECT_PRODUCTION_STATE_DIRECTORY,
  }).load()
}

/** A public stage can still be acknowledging Stop after the main session has stopped. */
export function isInterruptedProjectProductionRun(run: DeliveryRun): boolean {
  return run.status === 'stopped' || (run.status === 'needs_action' &&
    isFoundationStageActive(run) &&
    (run.foundationReviewStage
      ? run.foundationReviewStage.control.action === 'stop'
      : run.authorStage?.control.action === 'stop'))
}

/** A project request may be followed by more delivery work in the same session.
 * Terminal success is the only state that has no remaining production work. */
export function isIncompleteProjectProductionRun(run: DeliveryRun): boolean {
  return run.status !== 'completed'
}

/** Author has committed its documents, but Reviewer could not start while the
 * main project conversation still owned the workspace. This is a handoff, not
 * a failed review or a request to rerun Author. */
export function isPendingProjectProductionReview(run: DeliveryRun): boolean {
  return run.status === 'needs_action' && run.phase === 'DOCUMENT_REVIEW' &&
    run.authorStage?.status === 'completed' && run.authorStage.control.action === 'run' &&
    !run.foundationReviewStage &&
    run.blockedReason === FOUNDATION_AUTHOR_REVIEW_HANDOFF_REASON
}

export type ProjectProductionController = {
  start(run: DeliveryRun): Promise<unknown>
  resume(run: DeliveryRun): Promise<unknown>
  ensureProgress(run: DeliveryRun): Promise<unknown>
  stopFoundation(run: DeliveryRun, reason: string): Promise<DeliveryRun>
  dispose(): Promise<void>
}

/**
 * Owns only the project-level start/recovery boundary. Stage rules and worker
 * execution stay in the stage modules and their controller; HTTP and Chat do
 * not sequence individual stages.
 */
export function createProjectProductionCoordinator(input: {
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
  controller: ProjectProductionController
}) {
  const store = createRunStore(input.workspacePath, input.ownerId, {
    stateDirectory: PROJECT_PRODUCTION_STATE_DIRECTORY,
  })
  const briefDigest = createHash('sha256').update(input.confirmedBriefContext).digest('hex')

  async function existingOrStart(): Promise<{ run: DeliveryRun; created: boolean }> {
    const existing = await store.load()
    if (existing) {
      if (existing.projectId !== input.projectId || existing.confirmedBriefDigest !== briefDigest)
        throw new Error('A different production brief is already bound to this project')
      return { run: existing, created: false }
    }

    const initial = createInitialDeliveryRun({
      ownerId: input.ownerId,
      projectId: input.projectId,
      confirmedBriefDigest: briefDigest,
      confirmedBriefContext: input.confirmedBriefContext,
    })
    const created = await store.commit(initial, {
      runId: initial.runId,
      type: 'run.created',
      phase: initial.phase,
      status: initial.status,
      revision: initial.revision,
    })
    const drafting = transitionDeliveryRun(created, { type: 'documents_ready' })
    const saved = await store.commit(drafting, {
      runId: drafting.runId,
      type: 'phase.entered',
      phase: drafting.phase,
      status: drafting.status,
      revision: drafting.revision,
    })
    return { run: saved, created: true }
  }

  return {
    getRun: () => store.load(),
    async start(): Promise<DeliveryRun> {
      const { run, created } = await existingOrStart()
      if (created)
        await input.controller.start(run)
      else if (run.status === 'running' || isPendingProjectProductionReview(run))
        await input.controller.ensureProgress(run)
      return (await store.load()) ?? run
    },
    async resume(): Promise<DeliveryRun | undefined> {
      const run = await store.load()
      if (!run || run.projectId !== input.projectId) return undefined
      if (isIncompleteProjectProductionRun(run))
        await input.controller.resume(run)
      return (await store.load()) ?? run
    },
    async stop(reason = 'user_stop'): Promise<DeliveryRun | undefined> {
      const run = await store.load()
      if (!run || run.projectId !== input.projectId ||
          (run.status !== 'running' && !isPendingProjectProductionReview(run))) return run ?? undefined
      return input.controller.stopFoundation(run, reason)
    },
    async dispose(): Promise<void> {
      await input.controller.dispose()
    },
  }
}
