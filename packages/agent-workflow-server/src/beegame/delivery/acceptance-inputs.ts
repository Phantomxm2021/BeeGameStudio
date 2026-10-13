import type { RuntimeAcceptance } from '../runtime-acceptance'
import type { DesignStageState } from './design-state'

/** Persisted acceptance fields passed by value; only the common store saves them. */
export type AcceptanceRecord = {
  revision: string
  source: 'report'
  reportPath: string
  reportSha256: string
  reports: RuntimeAcceptance[]
}
export type AcceptanceInput = DesignStageState & {
  // Acceptance-owned deduplication survives other stages' transient diagnostics.
  // One identity in the existing state, not another task/retry store.
  lastProductFailureEvidence?: string
  accepted?: AcceptanceRecord
}
