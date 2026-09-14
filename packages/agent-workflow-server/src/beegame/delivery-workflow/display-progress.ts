import { DELIVERY_PHASES } from './schema'
export const DELIVERY_PROGRESS_STAGES = [
  ...DELIVERY_PHASES.slice(0, 3),
  'CHECKLIST_AUTHORING',
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

export const CHECKLIST_AUTHORING_STAGE = 'CHECKLIST_AUTHORING' as const

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
  const authorStage = workflow.authorStage
  const authorLinkPresent =
    Boolean(authorStage) &&
    typeof authorStage === 'object' &&
    !Array.isArray(authorStage)
  // A completed public author result still belongs to the drafting stage until
  // Document review has durable state. This prevents the handoff gap from
  // being rendered as a started review.
  const authorStillOwnsDisplay =
    authorLinkPresent &&
    (workflow.phase === 'DOCUMENT_DRAFTING' ||
      (workflow.phase === 'DOCUMENT_REVIEW' &&
        !workflow.foundationReviewStage &&
        (typeof workflow.foundationAuditState !== 'object' ||
          workflow.foundationAuditState === null ||
          Array.isArray(workflow.foundationAuditState))))
  if (authorStillOwnsDisplay)
    return {
      stageId: 'DOCUMENT_DRAFTING',
      phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf('DOCUMENT_DRAFTING') + 1,
      phaseCount: DELIVERY_PROGRESS_STAGES.length,
      substage: 'INITIAL_DRAFTING',
    }
  const stageId =
    workflow.phase === 'DOCUMENT_REVIEW' &&
    workflow.documentStep === 'CHECKLIST_DRAFTING'
      ? CHECKLIST_AUTHORING_STAGE
      : (workflow.phase as DeliveryProgressStage)
  const substage: DeliveryProgressSubstage | undefined =
    workflow.documentStep === 'FOUNDATION_DRAFTING'
      ? 'INITIAL_DRAFTING'
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
  }
}
