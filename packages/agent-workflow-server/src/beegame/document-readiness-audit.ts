import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import {
  completeGameDocumentArtifactPath,
  validateCompleteGameDocumentMarkdown,
} from './complete-game-document'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
} from './delivery-workflow/types'

export const REQUIRED_PROJECT_DOCUMENTS = CANONICAL_PROJECT_DOCUMENTS
export const MAX_ACCEPTANCE_CHECKLIST_TASKS = 64

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
    const identifiers: string[] = []
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.trimStart()
      const marker = checklistMarker(line)
      if (!marker) continue
      const identifier = checklistIdentifier(line.slice(marker.length).trim())
      if (identifier && !identifiers.includes(identifier.value))
        identifiers.push(identifier.value)
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
    const issues: string[] = []
    const body = lines.slice(bodyStart).join('\n')
    if (body.includes('<svg'))
      issues.push(`${path}: inline SVG is not allowed in a committed document`)
    for (const material of getGameDocumentContract(path).productionMaterials) {
      if (material.format !== 'inline_svg') continue
      const artifactPath = completeGameDocumentArtifactPath(
        path,
        material.materialId,
      )
      const markdownPath = artifactPath.slice('docs/'.length)
      if (!body.includes(`](${markdownPath})`)) {
        issues.push(`${path}: external artifact reference is missing: ${material.materialId}`)
        continue
      }
      const absoluteArtifactPath = resolve(workspacePath, artifactPath)
      if (
        !existsSync(absoluteArtifactPath) ||
        !statSync(absoluteArtifactPath).isFile()
      ) {
        issues.push(`${path}: external artifact is missing: ${artifactPath}`)
        continue
      }
      const artifactBytes = readFileSync(absoluteArtifactPath, 'utf8')
      if (
        !(artifactBytes.includes('<svg ') || artifactBytes.includes('<svg>')) ||
        !artifactBytes.includes('</svg>')
      )
        issues.push(`${path}: external artifact SVG is invalid: ${artifactPath}`)
      const receiptArtifact = matchingReceiptArtifact({
        workspacePath,
        path,
        content,
        artifactPath,
      })
      if (
        receiptArtifact &&
        createHash('sha256').update(artifactBytes).digest('hex') !==
          receiptArtifact.digest
      )
        issues.push(`${path}: external artifact digest is stale: ${artifactPath}`)
    }
    return issues
  } catch (error) {
    return [
      `${path}: ${error instanceof Error ? error.message : 'complete document contract is invalid'}`,
    ]
  }
}

function matchingReceiptArtifact(input: {
  workspacePath: string
  path: string
  content: string
  artifactPath: string
}): { digest: string } | undefined {
  const receiptsPath = join(
    input.workspacePath,
    '.beegame/workflow/document-commits',
  )
  if (!existsSync(receiptsPath)) return undefined
  const documentDigest = createHash('sha256').update(input.content).digest('hex')
  for (const filename of readdirSync(receiptsPath).sort()) {
    if (!filename.endsWith('.json')) continue
    try {
      const receipt = JSON.parse(
        readFileSync(join(receiptsPath, filename), 'utf8'),
      ) as {
        targetPath?: string
        finalDigest?: string
        artifacts?: Array<{ path?: string; digest?: string }>
      }
      if (
        receipt.targetPath !== input.path ||
        receipt.finalDigest !== documentDigest
      )
        continue
      const artifact = receipt.artifacts?.find(
        candidate => candidate.path === input.artifactPath,
      )
      if (artifact?.digest?.match(/^[a-f0-9]{64}$/))
        return { digest: artifact.digest }
    } catch {
      continue
    }
  }
  return undefined
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
      issues.push(
        `${path}: Checklist task ${taskCount} has no stable identifier.`,
      )
      continue
    }
    if (identifiers.has(identifier.value)) {
      issues.push(
        `${path}: Checklist stable identifier is duplicated: ${identifier.value}`,
      )
      continue
    }
    identifiers.add(identifier.value)
    const detail = item.slice(identifier.sourceLength).trimStart()
    if (!detail) {
      issues.push(
        `${path}: Checklist task ${identifier.value} has no observable task description.`,
      )
    }
  }
  if (taskCount === 0) {
    issues.push(`${path}: Acceptance checklist contains no task items.`)
  }
  if (taskCount > MAX_ACCEPTANCE_CHECKLIST_TASKS) {
    issues.push(
      `${path}: Acceptance checklist has ${taskCount} tasks; the maximum is ${MAX_ACCEPTANCE_CHECKLIST_TASKS}. Group variants that share one setup, action and observable outcome.`,
    )
  }
  return issues
}

function checklistMarker(line: string): string | undefined {
  for (const marker of ['- [ ]', '- [x]', '- [X]', '* [ ]', '* [x]', '* [X]']) {
    if (line.startsWith(marker)) return marker
  }
  return undefined
}

function checklistIdentifier(
  item: string,
): { value: string; sourceLength: number } | undefined {
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
  while (end < item.length && !isIdentifierBoundary(item.charCodeAt(end)))
    end += 1
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
    if (
      character === '-' ||
      character === '_' ||
      character === '.' ||
      character === ':'
    ) {
      hasSeparator = true
      continue
    }
    return false
  }
  return hasAlphaNumeric && hasSeparator
}
