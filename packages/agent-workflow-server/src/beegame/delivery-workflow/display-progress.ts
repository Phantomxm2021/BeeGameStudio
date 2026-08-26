import { DELIVERY_PHASES } from './schema'

/**
 * Display-only stages. `FOUNDATION_REVISION` is deliberately not a durable
 * delivery phase: audit and revision still share DOCUMENT_REVIEW authority,
 * but the dashboard must freeze audit at stage 3 and show repair at stage 4.
 */
export const DELIVERY_PROGRESS_STAGES = [
  ...DELIVERY_PHASES.slice(0, 3),
  'FOUNDATION_REVISION',
  ...DELIVERY_PHASES.slice(3),
] as const

export const DELIVERY_PROGRESS_SUBSTAGES = [
  'INITIAL_DRAFTING',
  'INITIAL_REVIEW',
  'REPAIRING',
  'CHECKLIST_DRAFTING',
] as const

export type DeliveryProgressSubstage =
  (typeof DELIVERY_PROGRESS_SUBSTAGES)[number]

export type DeliveryProgressStage = (typeof DELIVERY_PROGRESS_STAGES)[number]

export const FOUNDATION_REVISION_STAGE = 'FOUNDATION_REVISION' as const

const FOUNDATION_REVISION_PHASES = [
  'planning',
  'revising',
  'rebuilding_facts',
  'validating',
  'semantic_recheck',
  'publishing',
  'round_closing',
] as const

/**
 * Revision remains inside DOCUMENT_REVIEW's top-level delivery phase, but it
 * shares the audit state's durable collection. A completed revision is
 * cleared when the workflow proceeds to checklist drafting.
 */
export function isActiveFoundationRepairState(
  value: unknown,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as { status?: unknown }
  return (
    FOUNDATION_REVISION_PHASES.includes(
      state.status as (typeof FOUNDATION_REVISION_PHASES)[number],
    ) && state.status !== 'completed'
  )
}

export type DeliveryProgress = {
  stageId: DeliveryProgressStage
  phaseIndex: number
  phaseCount: number
  substage?: DeliveryProgressSubstage
}

export function projectDeliveryProgress(
  workflow: Record<string, unknown>,
): DeliveryProgress | undefined {
  if (!DELIVERY_PHASES.includes(workflow.phase as never)) return undefined
  const activeFoundationRepair = isActiveFoundationRepairState(
    workflow.foundationAuditState,
  )
  const stageId =
    workflow.phase === 'DOCUMENT_REVIEW' &&
    (workflow.documentStep === 'CHECKLIST_DRAFTING' ||
      activeFoundationRepair)
      ? FOUNDATION_REVISION_STAGE
      : (workflow.phase as DeliveryProgressStage)
  const substage: DeliveryProgressSubstage | undefined =
    workflow.documentStep === 'FOUNDATION_DRAFTING'
      ? 'INITIAL_DRAFTING'
      : workflow.documentStep === 'FOUNDATION_REVIEW'
        ? isActiveFoundationRepairState(workflow.foundationAuditState)
          ? 'REPAIRING'
          : 'INITIAL_REVIEW'
        : workflow.documentStep === 'CHECKLIST_DRAFTING'
          ? 'CHECKLIST_DRAFTING'
          : activeFoundationRepair
            ? 'REPAIRING'
            : undefined
  return {
    stageId,
    phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf(stageId) + 1,
    phaseCount: DELIVERY_PROGRESS_STAGES.length,
    ...(substage ? { substage } : {}),
  }
}
