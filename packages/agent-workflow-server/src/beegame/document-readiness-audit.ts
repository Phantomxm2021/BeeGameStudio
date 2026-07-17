import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'

export const REQUIRED_PROJECT_DOCUMENTS = [
  'docs/GDD.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
  'docs/acceptance/gameplay-checklist.md',
] as const

export type DocumentReadinessAudit = {
  valid: boolean
  issues: string[]
}

/**
 * Checks only deterministic delivery-contract facts. This deliberately does
 * not interpret game semantics or advance Claude Code's task state.
 */
export function auditDocumentReadiness(
  workspacePath: string,
): DocumentReadinessAudit {
  const workspace = resolve(workspacePath)
  const issues: string[] = []
  for (const projectPath of REQUIRED_PROJECT_DOCUMENTS) {
    const absolutePath = join(workspace, projectPath)
    try {
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        issues.push(`Required project document is missing: ${projectPath}`)
        continue
      }
      if (!readFileSync(absolutePath, 'utf8').trim()) {
        issues.push(`Required project document is empty: ${projectPath}`)
      }
    } catch {
      issues.push(`Required project document is unreadable: ${projectPath}`)
    }
  }

  const assetAudit = auditAssetContract(workspace)
  const manifestPath = relative(workspace, assetAudit.manifestPath)
    .split('\\')
    .join('/')
  if (!assetAudit.present) {
    issues.push(`Canonical asset contract is missing: ${manifestPath}`)
  } else if (!assetAudit.valid) {
    issues.push(...assetAudit.issues.map(issue => `${manifestPath}: ${issue}`))
  }

  return { valid: issues.length === 0, issues }
}
