import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
export const REQUIRED_PROJECT_DOCUMENTS = [...CANONICAL_FOUNDATION_DOCUMENTS, 'docs/acceptance/gameplay-checklist.md'] as const
export type DocumentReadinessAudit = { valid: boolean; issues: string[] }
export type DocumentReadinessAuditOptions = { includeChecklist?: boolean; includeAssetManifest?: boolean }
/** Author closure of the old deterministic readiness branch. Resource and checklist algorithms remain outside this stage. */
export function auditDocumentReadiness(workspacePath: string, options: DocumentReadinessAuditOptions = {}): DocumentReadinessAudit {
  const workspace = resolve(workspacePath); const issues: string[] = []
  const required = options.includeChecklist === false ? REQUIRED_PROJECT_DOCUMENTS.slice(0, -1) : REQUIRED_PROJECT_DOCUMENTS
  for (const projectPath of required) { const absolute = join(workspace, projectPath); try { if (!existsSync(absolute) || !statSync(absolute).isFile()) { issues.push(`Required project document is missing: ${projectPath}`); continue }; const content = readFileSync(absolute, 'utf8'); if (!content.trim()) issues.push(`Required project document is empty: ${projectPath}`) } catch { issues.push(`Required project document is unreadable: ${projectPath}`) } }
  return { valid: issues.length === 0, issues }
}
