import { DELIVERY_PHASES } from './schema'

export const DELIVERY_PROGRESS_STAGES = [
  'BRIEF_CONFIRMED',
  'DOCUMENT_DRAFTING',
  'DOCUMENT_REVIEW',
  'DOCUMENT_CONVERGENCE',
  'RESOURCE_PREPARATION',
  'COMPREHENSIVE_CONVERGENCE',
  'ATOMIC_TASK_PLANNING',
  'IMPLEMENTATION',
  'IMPLEMENTATION_AUDIT',
  'ACCEPTANCE',
  'DELIVERY',
] as const

export const DELIVERY_PROGRESS_SUBSTAGES = [
  'INITIAL_DRAFTING',
  'INITIAL_REVIEW',
  'REPAIR_PLANNING',
  'REPAIRING',
  'CLOSURE_REVIEW',
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
  const reviewState = record(workflow.documentReviewState)
  const cycle = record(reviewState?.activeCycle)
  const repairPlan = record(cycle?.repairPlan)
  const repairPasses = record(reviewState?.repairPasses)
  const comprehensiveConvergence =
    (workflow.phase === 'DOCUMENT_REVIEW' &&
      workflow.documentStep === 'COMPREHENSIVE_REVIEW') ||
    cycle?.originScope === 'complete'
  const documentConvergence =
    !comprehensiveConvergence &&
    ((workflow.phase === 'DOCUMENT_DRAFTING' &&
      cycle?.acceptedSemanticResult === true &&
      cycle.activeTarget === 'foundation') ||
      (workflow.phase === 'DOCUMENT_REVIEW' &&
        (workflow.documentStep === 'CHECKLIST_DRAFTING' ||
          workflow.documentStep === 'CHECKLIST_REVIEW' ||
          cycle?.mode === 'closure')))
  const progressStage = comprehensiveConvergence
    ? 'COMPREHENSIVE_CONVERGENCE'
    : documentConvergence
      ? 'DOCUMENT_CONVERGENCE'
      : DELIVERY_PHASES.includes(workflow.phase as never)
        ? (workflow.phase as (typeof DELIVERY_PHASES)[number])
        : undefined
  if (!progressStage) return undefined
  const activeTarget =
    cycle?.activeTarget === 'foundation' ||
    cycle?.activeTarget === 'checklist' ||
    cycle?.activeTarget === 'resource'
      ? cycle.activeTarget
      : undefined
  const acceptedPacketSet = cycle?.acceptedSemanticResult === true
  const substage: DeliveryProgressSubstage | undefined = cycle
    ? acceptedPacketSet && activeTarget
      ? activeTarget === 'foundation' && !repairPlan
        ? 'REPAIR_PLANNING'
        : 'REPAIRING'
      : cycle.mode === 'closure'
        ? 'CLOSURE_REVIEW'
        : 'INITIAL_REVIEW'
    : workflow.documentStep === 'CHECKLIST_DRAFTING'
      ? 'CHECKLIST_DRAFTING'
      : workflow.documentStep === 'CHECKLIST_REVIEW'
        ? 'CHECKLIST_REVIEW'
        : workflow.documentStep === 'FOUNDATION_DRAFTING'
          ? 'INITIAL_DRAFTING'
          : undefined
  const passValue = activeTarget ? Number(repairPasses?.[activeTarget]) : 0
  const convergencePass =
    substage &&
    ['REPAIR_PLANNING', 'REPAIRING', 'CLOSURE_REVIEW'].includes(substage) &&
    Number.isInteger(passValue) &&
    passValue > 0
      ? passValue
      : undefined
  return {
    stageId: progressStage,
    phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf(progressStage) + 1,
    phaseCount: DELIVERY_PROGRESS_STAGES.length,
    ...(substage ? { substage } : {}),
    ...(convergencePass ? { convergencePass } : {}),
  }
}
