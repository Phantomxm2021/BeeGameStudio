import { resolve } from 'node:path'
import { getObservedNativeAcceptance } from './native-acceptance-evidence'

export type PersistedDeliveryAcceptance = {
  allowed: boolean
  outcome: 'passed' | 'blocked' | 'rejected'
  issues: string[]
}

/**
 * Passive deployment gate. BeeGame does not parse project requirements,
 * checklists, platform semantics, or repair state. It only verifies that the
 * native Claude Code validator produced a terminal result for the exact
 * workspace revision that is about to be deployed.
 */
export function evaluatePersistedDeliveryAcceptance(
  workspacePath: string,
  provenance?: { dataRoot: string; sessionId: string },
): PersistedDeliveryAcceptance {
  if (!provenance) {
    return rejected('Deployment requires an observed native acceptance result.')
  }

  const observation = getObservedNativeAcceptance({
    ...provenance,
    workspacePath: resolve(workspacePath),
  })
  if (observation.state === 'missing') {
    return rejected('Deployment requires an observed native acceptance Validator result.')
  }
  if (observation.state === 'stale') {
    return rejected('The project changed after native acceptance; validate the current revision before deployment.')
  }

  if (observation.evidence.status === 'passed') {
    return { allowed: true, outcome: 'passed', issues: [] }
  }
  if (observation.evidence.status === 'blocked') {
    return {
      allowed: false,
      outcome: 'blocked',
      issues: [observation.evidence.summary],
    }
  }
  return {
    allowed: false,
    outcome: 'rejected',
    issues: [observation.evidence.summary],
  }
}

function rejected(issue: string): PersistedDeliveryAcceptance {
  return { allowed: false, outcome: 'rejected', issues: [issue] }
}
