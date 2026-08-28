import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { parseAcceptanceChecklist } from './acceptance-checklist'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
} from './delivery-workflow/types'

export const REQUIRED_PROJECT_DOCUMENTS = CANONICAL_PROJECT_DOCUMENTS

export type DocumentReadinessAudit = {
  valid: boolean
  issues: string[]
}

export type DocumentReadinessAuditOptions = {
  includeChecklist?: boolean
  includeAssetManifest?: boolean
  requireCompleteFoundation?: boolean
}

/** Returns stable checklist ids without interpreting any project-specific semantics. */
export function readAcceptanceChecklistIds(workspacePath: string): string[] {
  const path = join(
    resolve(workspacePath),
    'docs/acceptance/gameplay-checklist.md',
  )
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return []
    return parseAcceptanceChecklist(readFileSync(path, 'utf8')).tasks.map(
      task => task.id,
    )
  } catch {
    return []
  }
}

/**
 * Checks only deterministic delivery-contract facts. This deliberately does
 * not interpret game semantics or advance Bee Game Studio's task state.
 */
export function auditDocumentReadiness(
  workspacePath: string,
  options: DocumentReadinessAuditOptions = {},
): DocumentReadinessAudit {
  const workspace = resolve(workspacePath)
  const issues: string[] = []
  const documents = new Map<string, string>()
  const requiredDocuments =
    options.includeChecklist === false
      ? REQUIRED_PROJECT_DOCUMENTS.slice(0, -1)
      : REQUIRED_PROJECT_DOCUMENTS
  for (const projectPath of requiredDocuments) {
    const absolutePath = join(workspace, projectPath)
    try {
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        issues.push(`Required project document is missing: ${projectPath}`)
        continue
      }
      const content = readFileSync(absolutePath, 'utf8')
      documents.set(projectPath, content)
      if (!content.trim()) {
        issues.push(`Required project document is empty: ${projectPath}`)
      }
      if (
        options.requireCompleteFoundation === true &&
        CANONICAL_FOUNDATION_DOCUMENTS.includes(
          projectPath as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
        )
      )
        issues.push(
          ...auditCompleteFoundationDocument(
            workspace,
            projectPath as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
            content,
          ),
        )
    } catch {
      issues.push(`Required project document is unreadable: ${projectPath}`)
    }
  }

  const checklistPath = 'docs/acceptance/gameplay-checklist.md'
  const checklist = documents.get(checklistPath)
  if (checklist?.trim()) {
    issues.push(...auditChecklistStructure(checklist, checklistPath))
  }

  if (options.includeAssetManifest !== false) {
    const assetAudit = auditAssetContract(workspace)
    const manifestPath = relative(workspace, assetAudit.manifestPath)
      .split('\\')
      .join('/')
    if (!assetAudit.present) {
      issues.push(`Canonical asset contract is missing: ${manifestPath}`)
    } else if (!assetAudit.valid) {
      issues.push(
        ...assetAudit.issues.map(issue => `${manifestPath}: ${issue}`),
      )
    }
  }

  return { valid: issues.length === 0, issues }
}

function auditCompleteFoundationDocument(
  workspacePath: string,
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
  content: string,
): string[] {
  try {
    const lines = content.split('\n')
    let bodyStart = 0
    if (lines[0]?.trim() === '---') {
      const metadataEnd = lines.findIndex(
        (line, index) => index > 0 && line.trim() === '---',
      )
      if (metadataEnd < 0)
        throw new Error('complete game document front matter is incomplete')
      bodyStart = metadataEnd + 1
    }
    validateCompleteGameDocumentMarkdown(
      path,
      lines.slice(bodyStart).join('\n').trimStart(),
    )
    return []
  } catch (error) {
    return [
      `${path}: ${error instanceof Error ? error.message : 'complete document contract is invalid'}`,
    ]
  }
}

function auditChecklistStructure(content: string, path: string): string[] {
  return [...parseAcceptanceChecklist(content, path).issues]
}
