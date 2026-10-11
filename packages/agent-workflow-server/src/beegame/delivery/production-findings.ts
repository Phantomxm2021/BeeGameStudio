import { isDeepStrictEqual } from 'node:util'
import { requiredDesignFindings, type DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignFindingSources } from '../design-handoff'
import { checkProductionDesign } from './design-protection'
import type { DesignStageState } from './design-state'

/** Shared authority policy, separate from each stage's completion semantics. */
export function checkReleasedDesignFindings(workspace: string, phase: 'implementation' | 'acceptance',
  baseline: DesignStageState['designBaseline'], reported?: DesignFinding[]) {
  const result = checkProductionFindings(workspace, phase, baseline?.followUps ?? [], reported)
  const designIssues = baseline ? checkProductionDesign(workspace,
    { ...baseline, digestVersion: baseline.digestVersion ?? 1 }, phase).issues : []
  return { issues: [...designIssues, ...result.issues, ...result.blockingIssues], followUps: result.followUps }
}

/** Production may report observations, not redefine an owner's decision or deadline.
 * No persistence or model dispatch: callers save only a validated result. */
export function checkProductionFindings(workspace: string,
  phase: 'resources' | 'content' | 'implementation' | 'acceptance',
  recorded: DesignFinding[], reported: DesignFinding[] = []) {
  const issues = checkDesignFindingSources(workspace, reported)
  if (new Set(reported.map(f => f.id)).size !== reported.length) issues.push('Duplicate production design issue IDs.')
  for (const finding of reported) {
    const previous = recorded.find(old => old.id === finding.id)
    if (previous && !isDeepStrictEqual({ ...previous, impact: finding.impact }, finding))
      issues.push(finding.id + ': a production report cannot redefine a recorded finding or deadline.')
  }
  const due = requiredDesignFindings(reported, [phase])
  const blockingIssues = due.map(f => `${f.id}: ${f.impact}; requested decision: ${f.closeWhen}`)
  return { issues, blockingIssues,
    followUps: issues.length ? recorded : [...new Map([...recorded, ...reported].map(f => [f.id, f])).values()] }
}
