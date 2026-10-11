import type { AcceptanceInput, AcceptanceRecord } from './acceptance-inputs'
import type { DesignStageState } from './design-state'

// Existing persisted v1 schema. Stage extraction does not migrate project data.
export type ProjectDeliveryState = DesignStageState & AcceptanceInput & {
  version: 1
  acceptanceHistory?: AcceptanceRecord[]
}
