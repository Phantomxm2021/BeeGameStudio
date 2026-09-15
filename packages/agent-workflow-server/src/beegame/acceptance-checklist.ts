import { checklistAuthorityModeForSource } from './delivery-workflow/game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './foundation-documents'

export type AcceptanceChecklistTask = Readonly<{
  id: string
  source: string
  description: string
  line: number
}>

export type AcceptanceChecklistParseResult = Readonly<{
  tasks: readonly AcceptanceChecklistTask[]
  issues: readonly string[]
}>

/** The sole structural interpretation used by checklist validation and planning. */
export function parseAcceptanceChecklist(
  content: string,
  path = 'docs/acceptance/gameplay-checklist.md',
): AcceptanceChecklistParseResult {
  const tasks: AcceptanceChecklistTask[] = []
  const issues: string[] = []
  const identifiers = new Set<string>()
  for (const [index, rawLine] of content.split('\n').entries()) {
    const line = rawLine.trimStart()
    const marker = checklistMarker(line)
    if (!marker) continue
    const item = line.slice(marker.length).trim()
    const identifier = checklistIdentifier(item)
    const taskNumber = tasks.length + 1
    if (!identifier) {
      issues.push(`${path}: Checklist task ${taskNumber} has no stable identifier.`)
      continue
    }
    if (identifiers.has(identifier.value)) {
      issues.push(`${path}: Checklist stable identifier is duplicated: ${identifier.value}`)
      continue
    }
    identifiers.add(identifier.value)
    const source = checklistSource(item.slice(identifier.sourceLength).trimStart())
    if (!source) {
      issues.push(`${path}: Checklist task ${identifier.value} has no Checklist authority source tag.`)
      continue
    }
    const configuredMode = checklistAuthorityModeForSource(source.path, source.blockId)
    const mode = configuredMode ?? (CANONICAL_FOUNDATION_DOCUMENTS.includes(source.path as never) ? 'scenario' : undefined)
    if (!mode || mode === 'exclude') {
      issues.push(`${path}: Checklist task ${identifier.value} cites an excluded or unknown source: ${source.raw}.`)
      continue
    }
    const description = source.description
    if (!description) {
      issues.push(`${path}: Checklist task ${identifier.value} has no observable task description.`)
      continue
    }
    if (mode === 'gate_reference' && description !== GATE_REFERENCE_DESCRIPTION) {
      issues.push(`${path}: Checklist task ${identifier.value} must use the gate-reference form for ${source.raw}.`)
      continue
    }
    tasks.push({ id: identifier.value, source: source.raw, description, line: index + 1 })
  }
  if (!tasks.length && !issues.length)
    issues.push(`${path}: Acceptance checklist contains no task items.`)
  return { tasks, issues }
}

export const GATE_REFERENCE_DESCRIPTION =
  'Owner gate passes; evidence: linked owner validation.'

function checklistSource(value: string): {
  raw: string
  path: string
  blockId: string
  description: string
} | undefined {
  const match = /^\[(docs\/[A-Za-z0-9_./-]+\.md)#([A-Za-z0-9._-]+)\]\s+(.+)$/u.exec(value)
  if (!match) return undefined
  return {
    raw: `[${match[1]}#${match[2]}]`,
    path: match[1]!,
    blockId: match[2]!,
    description: match[3]!.trim(),
  }
}

function checklistMarker(line: string): string | undefined {
  for (const marker of ['- [ ]', '- [x]', '- [X]', '* [ ]', '* [x]', '* [X]'])
    if (line.startsWith(marker)) return marker
  return undefined
}

function checklistIdentifier(item: string): { value: string; sourceLength: number } | undefined {
  if (!item) return undefined
  if (item.startsWith('[') || item.startsWith('`')) {
    const closing = item.indexOf(item[0] === '[' ? ']' : '`', 1)
    if (closing > 1) {
      const value = item.slice(1, closing)
      return isStableIdentifier(value) ? { value, sourceLength: closing + 1 } : undefined
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
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
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
