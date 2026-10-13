import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy, isEnvDefinedFalsy } from './envUtils.js'

// Public per-process switches. An absent value retains the CLI's existing gate.
// Callers still check the corresponding build capability.
export function isVerificationAgentEnabled(): boolean {
  const value = process.env.CLAUDE_CODE_VERIFICATION_AGENT_ENABLED
  if (isEnvDefinedFalsy(value)) return false
  if (isEnvTruthy(value)) return true
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false)
}

export function isAwaySummaryEnabled(defaultValue = false): boolean {
  const value = process.env.CLAUDE_CODE_AWAY_SUMMARY_ENABLED
  if (isEnvDefinedFalsy(value)) return false
  if (isEnvTruthy(value)) return true
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_sedge_lantern', defaultValue)
}
