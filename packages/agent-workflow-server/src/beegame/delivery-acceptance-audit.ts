import { resolve } from 'node:path'
import { getNativeDeliveryState } from './native-delivery-state'

export type PersistedDeliveryAcceptance = {
  allowed: boolean
  outcome: 'passed' | 'blocked' | 'rejected'
  issues: string[]
}

/**
 * Passive deployment gate. BeeGame does not parse project requirements,
 * checklists, platform semantics, or repair state. It only verifies that the
 * native Claude Code document reviewer approved the current documents and the
 * native validator produced a terminal result for the exact workspace
 * revision that is about to be deployed.
 */
export function evaluatePersistedDeliveryAcceptance(
  workspacePath: string,
  provenance?: { dataRoot: string; sessionId: string },
): PersistedDeliveryAcceptance {
  if (!provenance) {
    return rejected('Deployment requires an observed native acceptance result.')
  }

  const state = getNativeDeliveryState({
    ...provenance,
    workspacePath: resolve(workspacePath),
  })
  if (state.status === 'passed') {
    return { allowed: true, outcome: 'passed', issues: [] }
  }
  if (state.status === 'blocked') {
    return {
      allowed: false,
      outcome: 'blocked',
      issues: [state.summary],
    }
  }
  if (state.reason === 'document_review_missing') {
    return rejected(
      'Deployment requires an observed native Document Reviewer result.',
    )
  }
  if (state.reason === 'document_review_stale') {
    return rejected(
      'Project documents changed after review; review the current document revision before deployment.',
    )
  }
  if (state.reason === 'acceptance_missing') {
    return rejected(
      'Deployment requires an observed native acceptance Validator result.',
    )
  }
  if (state.reason === 'acceptance_stale') {
    return rejected(
      'The project changed after native acceptance; validate the current revision before deployment.',
    )
  }
  return {
    allowed: false,
    outcome: 'rejected',
    issues: [state.summary],
  }
}

function rejected(issue: string): PersistedDeliveryAcceptance {
  return { allowed: false, outcome: 'rejected', issues: [issue] }
}
