import type { AuditIssue } from './foundation-issue-registry'
import type { FoundationDocumentPath } from './types'
import type { FoundationFactKey } from './foundation-fact-definitions'

export type FoundationDeterministicContractDeclaration = {
  id: string
  sourceFactKey: FoundationFactKey
  targetFactKey: FoundationFactKey
  relation: 'exists' | 'equal' | 'numeric-equal' | 'contains-all'
  source: { documentPath: FoundationDocumentPath; sectionId: string }
  target: { documentPath: FoundationDocumentPath; sectionId: string }
  severity: AuditIssue['severity']
}

const declaration = (
  id: string,
  sourceFactKey: FoundationFactKey,
  targetFactKey: FoundationFactKey,
  relation: FoundationDeterministicContractDeclaration['relation'],
  source: FoundationDeterministicContractDeclaration['source'],
  target: FoundationDeterministicContractDeclaration['target'],
): FoundationDeterministicContractDeclaration => Object.freeze({
  id,
  sourceFactKey,
  targetFactKey,
  relation,
  source: Object.freeze({ ...source }),
  target: Object.freeze({ ...target }),
  severity: 'HIGH',
})

/** The sole service-owned deterministic contract declaration source. */
export const FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS = Object.freeze([
  declaration('technical-actions-authority', 'technical.supported_actions', 'game.mechanics', 'contains-all', { documentPath: 'docs/TECHNICAL_DESIGN.md', sectionId: 'input_interaction' }, { documentPath: 'docs/GDD.md', sectionId: 'player_actions' }),
  declaration('asset-boss-count-authority', 'asset.boss.count', 'game.boss.count', 'numeric-equal', { documentPath: 'docs/ASSET_PLAN.md', sectionId: 'inventory' }, { documentPath: 'docs/GDD.md', sectionId: 'rules_systems' }),
  declaration('ui-resources-authority', 'ui.displayed_resources', 'game.resources', 'contains-all', { documentPath: 'docs/UI_UX_SPEC.md', sectionId: 'hud' }, { documentPath: 'docs/GDD.md', sectionId: 'rules_systems' }),
  declaration('asset-level-requirement-coverage', 'asset.covered_level_requirements', 'level.required_assets', 'contains-all', { documentPath: 'docs/ASSET_PLAN.md', sectionId: 'inventory' }, { documentPath: 'docs/LEVEL_SCENE_DESIGN.md', sectionId: 'content_matrix' }),
] as const)

export const TECHNICAL_IMPOSSIBILITY_REASON_CODE =
  'technical-impossibility' as const

export type FoundationFixTarget = {
  documentPath: FoundationDocumentPath
  sectionId: string
}

export type FoundationFixResolutionInput = {
  source: FoundationFixTarget
  target?: FoundationFixTarget
  severity: AuditIssue['severity']
  reasonCode?: string
  /** Contract bindings encode the downstream document as source. */
  edgeDirection?: 'downstream-contract'
}

const authorityRank = (path: FoundationDocumentPath): number => {
  if (path === 'docs/GDD.md') return 0
  if (path === 'docs/TECHNICAL_DESIGN.md') return 1
  if (path === 'docs/LEVEL_SCENE_DESIGN.md' || path === 'docs/BALANCE_DESIGN.md') return 2
  if (path === 'docs/ART_DIRECTION.md' || path === 'docs/UI_UX_SPEC.md' || path === 'docs/AUDIO_DESIGN.md') return 3
  return 4
}

/**
 * The only production source-of-truth/fix policy. A downstream document is
 * corrected when it conflicts with its upstream authority. Technical design
 * may send an explicit impossibility blocker back to GDD; no other reverse
 * edge is accepted.
 */
export function resolveFoundationFixTarget(
  input: FoundationFixResolutionInput,
): FoundationFixTarget {
  if (!input.target) return input.source
  if (
    input.edgeDirection === 'downstream-contract' &&
    input.source.documentPath !== 'docs/GDD.md' &&
    input.target.documentPath === 'docs/GDD.md'
  )
    return input.source
  const sourceRank = authorityRank(input.source.documentPath)
  const targetRank = authorityRank(input.target.documentPath)
  if (sourceRank < targetRank) return input.target
  if (
    input.source.documentPath === 'docs/TECHNICAL_DESIGN.md' &&
    input.target.documentPath === 'docs/GDD.md'
  ) {
    if (
      input.severity === 'BLOCKER' &&
      input.reasonCode === TECHNICAL_IMPOSSIBILITY_REASON_CODE
    )
      return input.target
    throw new Error(
      'authority violation: Technical to GDD requires technical-impossibility BLOCKER',
    )
  }
  if (sourceRank > targetRank) return input.source
  return input.target
}

export function applyFoundationFixAuthority(
  issues: readonly AuditIssue[],
): AuditIssue[] {
  return issues.map(issue => {
    if (issue.remediation.kind !== 'patch') return issue
    const target = resolveFoundationFixTarget({
      source: issue.source,
      target: issue.target,
      severity: issue.severity,
      reasonCode: issue.reasonCode,
      ...(issue.type === 'contract' ? { edgeDirection: 'downstream-contract' as const } : {}),
    })
    return {
      ...issue,
      remediation: {
        kind: 'patch' as const,
        documentPath: target.documentPath,
        sectionIds: [target.sectionId],
      },
    }
  })
}
