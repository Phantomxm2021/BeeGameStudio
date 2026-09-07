import { FOUNDATION_FACT_CATALOG, type FoundationFactKey } from './domain/foundation-fact-definitions'
import { FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS } from './domain/foundation-audit-authority'
import type { FoundationReviewIssue } from './domain/foundation-issue-registry'

/**
 * Public handoff needs the untouched side of each potentially affected contract.
 * Select from frozen owner declarations, not from whichever facts happened to resolve.
 * Dependencies do not recursively expand the repair authority or audit scope.
 */
export function reviewerRepairEvidenceKeys(issue: FoundationReviewIssue): FoundationFactKey[] {
  const repair = issue.remediation
  const changedKeys = new Set(FOUNDATION_FACT_CATALOG.filter(definition =>
    definition.owner.documentPath === repair.documentPath &&
    (repair.scope === 'document' || repair.sectionIds.includes(definition.owner.sectionId)),
  ).map(definition => definition.key))
  const selected = new Set(changedKeys)
  const refs = [issue.source, ...('target' in issue && issue.target ? [issue.target] : []), ...('supportingSections' in issue && issue.supportingSections ? issue.supportingSections : [])]
  for (const definition of FOUNDATION_FACT_CATALOG)
    if (refs.some(ref => ref.documentPath === definition.owner.documentPath &&
      (!('sectionId' in ref) || ref.sectionId === definition.owner.sectionId)))
      selected.add(definition.key)
  for (const declaration of FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS)
    if (changedKeys.has(declaration.sourceFactKey) || changedKeys.has(declaration.targetFactKey)) {
      selected.add(declaration.sourceFactKey)
      selected.add(declaration.targetFactKey)
    }
  return [...selected].sort()
}
