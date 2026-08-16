import { DELIVERY_PHASES } from './schema'

export const DELIVERY_PROGRESS_STAGES = [...DELIVERY_PHASES] as const

export const DELIVERY_PROGRESS_SUBSTAGES = [
  'INITIAL_DRAFTING',
  'INITIAL_REVIEW',
  'REPAIRING',
  'CHECKLIST_DRAFTING',
] as const

export type DeliveryProgressSubstage =
  (typeof DELIVERY_PROGRESS_SUBSTAGES)[number]

export type DeliveryProgressStage = (typeof DELIVERY_PROGRESS_STAGES)[number]

export type DeliveryProgress = {
  stageId: DeliveryProgressStage
  phaseIndex: number
  phaseCount: number
  substage?: DeliveryProgressSubstage
  convergencePass?: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function projectDeliveryProgress(
  workflow: Record<string, unknown>,
): DeliveryProgress | undefined {
  if (!DELIVERY_PHASES.includes(workflow.phase as never)) return undefined
  const stageId = workflow.phase as DeliveryProgressStage
  const review = record(workflow.foundationReviewState)
  const attempt =
    typeof review?.attempt === 'number' && Number.isInteger(review.attempt)
      ? review.attempt
      : undefined
  const substage: DeliveryProgressSubstage | undefined =
    workflow.documentStep === 'FOUNDATION_DRAFTING'
      ? record(workflow.foundationRemediationState)
        ? 'REPAIRING'
        : 'INITIAL_DRAFTING'
      : workflow.documentStep === 'FOUNDATION_REVIEW'
        ? 'INITIAL_REVIEW'
        : workflow.documentStep === 'CHECKLIST_DRAFTING'
          ? 'CHECKLIST_DRAFTING'
          : undefined
  return {
    stageId,
    phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf(stageId) + 1,
    phaseCount: DELIVERY_PROGRESS_STAGES.length,
    ...(substage ? { substage } : {}),
    ...(substage === 'REPAIRING' && attempt && attempt > 0
      ? { convergencePass: attempt }
      : {}),
  }
}
