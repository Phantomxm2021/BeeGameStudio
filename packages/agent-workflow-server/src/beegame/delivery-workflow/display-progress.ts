import { DELIVERY_PHASES } from './schema'

export const DELIVERY_PROGRESS_STAGES = [...DELIVERY_PHASES] as const

export const DELIVERY_PROGRESS_SUBSTAGES = [
  'INITIAL_DRAFTING',
  'INITIAL_REVIEW',
  'REPAIRING',
  'CHECKLIST_DRAFTING',
  'CHECKLIST_REVIEW',
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
  const reviewState = record(workflow.documentReviewState)
  const review = record(reviewState?.activeRun)
  const attempt =
    typeof review?.attempt === 'number' && Number.isInteger(review.attempt)
      ? review.attempt
      : undefined
  const substage: DeliveryProgressSubstage | undefined =
    workflow.documentStep === 'FOUNDATION_DRAFTING'
      ? review?.verdict === 'NEEDS_REVISION'
        ? 'REPAIRING'
        : 'INITIAL_DRAFTING'
      : workflow.documentStep === 'FOUNDATION_REVIEW'
        ? 'INITIAL_REVIEW'
        : workflow.documentStep === 'CHECKLIST_DRAFTING'
          ? review?.verdict === 'NEEDS_REVISION'
            ? 'REPAIRING'
            : 'CHECKLIST_DRAFTING'
          : workflow.documentStep === 'CHECKLIST_REVIEW'
            ? 'CHECKLIST_REVIEW'
            : workflow.documentStep === 'COMPREHENSIVE_REVIEW'
              ? 'INITIAL_REVIEW'
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
