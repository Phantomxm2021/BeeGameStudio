import { readDesignImplementationChecklist } from '../design-handoff'
import { checkProductionDesign } from './design-protection'
import type { DesignStageState } from './design-state'

/** Shared execution/verification input, not a second task database. */
export function reviewedImplementationInput(workspace: string, state: DesignStageState) {
  const candidate = readDesignImplementationChecklist(workspace)
  const baseline = state.designBaseline
  if (!baseline || checkProductionDesign(workspace, { ...baseline, digestVersion: baseline.digestVersion ?? 1 },
    state.phase === 'acceptance' ? 'acceptance' : 'implementation').issues.length)
    throw new Error('Implementation checklist does not match the reviewed design baseline; request an affected design resolution.')
  // Per-source snapshots establish identity; aggregate traversal order does not.
  return { ...candidate, designRevision: baseline.revision }
}
