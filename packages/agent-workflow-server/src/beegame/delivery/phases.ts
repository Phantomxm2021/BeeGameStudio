
export type ProjectDeliveryPhase =
  'author' | 'review' | 'resources' | 'content' | 'implementation' | 'acceptance' | 'complete'

export const NEXT_PHASE: Record<Exclude<ProjectDeliveryPhase, 'complete'>, ProjectDeliveryPhase> = {
  author: 'review', review: 'resources', resources: 'content',
  content: 'implementation', implementation: 'acceptance', acceptance: 'complete',
}

export function projectDeliveryPhase(state: { phase?: ProjectDeliveryPhase; accepted?: unknown }): ProjectDeliveryPhase {
  return state.phase ?? (state.accepted ? 'complete' : 'author')
}

