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

/** Returns stable checklist ids without interpreting any project-specific semantics. */
export function readAcceptanceChecklistIds(workspacePath: string): string[] {
  const path = join(resolve(workspacePath), 'docs/acceptance/gameplay-checklist.md')
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return []
    const identifiers: string[] = []
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.trimStart()
      const marker = checklistMarker(line)
      if (!marker) continue
      const identifier = checklistIdentifier(line.slice(marker.length).trim())
      if (identifier && !identifiers.includes(identifier.value)) identifiers.push(identifier.value)
    }
    return identifiers
  } catch {
    return []
  }
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
  const documents = new Map<string, string>()
  for (const projectPath of REQUIRED_PROJECT_DOCUMENTS) {
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
    } catch {
      issues.push(`Required project document is unreadable: ${projectPath}`)
    }
  }

  const checklistPath = 'docs/acceptance/gameplay-checklist.md'
  const checklist = documents.get(checklistPath)
  if (checklist?.trim()) {
    issues.push(...auditChecklistStructure(checklist, checklistPath))
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

function auditChecklistStructure(content: string, path: string): string[] {
  const issues: string[] = []
  const identifiers = new Set<string>()
  let taskCount = 0
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimStart()
    const marker = checklistMarker(line)
    if (!marker) continue
    taskCount += 1
    const item = line.slice(marker.length).trim()
    const identifier = checklistIdentifier(item)
    if (!identifier) {
      issues.push(`${path}: Checklist task ${taskCount} has no stable identifier.`)
      continue
    }
    if (identifiers.has(identifier.value)) {
      issues.push(`${path}: Checklist stable identifier is duplicated: ${identifier.value}`)
      continue
    }
    identifiers.add(identifier.value)
    const detail = item.slice(identifier.sourceLength).trimStart()
    if (!detail) {
      issues.push(`${path}: Checklist task ${identifier.value} has no observable task description.`)
    }
  }
  if (taskCount === 0) {
    issues.push(`${path}: Acceptance checklist contains no task items.`)
  }
  return issues
}

function checklistMarker(line: string): string | undefined {
  for (const marker of ['- [ ]', '- [x]', '- [X]', '* [ ]', '* [x]', '* [X]']) {
    if (line.startsWith(marker)) return marker
  }
  return undefined
}

function checklistIdentifier(item: string): { value: string; sourceLength: number } | undefined {
  if (!item) return undefined
  if (item.startsWith('[')) {
    const closing = item.indexOf(']', 1)
    if (closing > 1) {
      const value = item.slice(1, closing)
      return isStableIdentifier(value)
        ? { value, sourceLength: closing + 1 }
        : undefined
    }
  }
  if (item.startsWith('`')) {
    const closing = item.indexOf('`', 1)
    if (closing > 1) {
      const value = item.slice(1, closing)
      return isStableIdentifier(value)
        ? { value, sourceLength: closing + 1 }
        : undefined
    }
  }
  let end = 0
  while (end < item.length && !isIdentifierBoundary(item.charCodeAt(end))) end += 1
  const value = item.slice(0, end)
  return isStableIdentifier(value) ? { value, sourceLength: end } : undefined
}

function isIdentifierBoundary(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32 || code === 58
}

function isStableIdentifier(value: string): boolean {
  if (value.length < 3) return false
  let hasAlphaNumeric = false
  let hasSeparator = false
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      hasAlphaNumeric = true
      continue
    }
    if (code >= 48 && code <= 57) {
      hasAlphaNumeric = true
      continue
    }
    if (character === '-' || character === '_' || character === '.' || character === ':') {
      hasSeparator = true
      continue
    }
    return false
  }
  return hasAlphaNumeric && hasSeparator
}
