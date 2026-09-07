import { createHash } from 'node:crypto'
import { buildFoundationSectionIndex, canonicalFoundationBlockIds } from './domain/foundation-section-index'
import type { FoundationDocumentPath } from './domain/types'
import { revisionBytesDigest } from './json-digest'

export type FoundationSectionPatchOperation = {
  scope: 'section'
  kind: 'INSERT' | 'REPLACE' | 'DELETE'
  documentPath: FoundationDocumentPath
  sectionId: string
  issueIds: string[]
  beforeDigest?: string
  afterDigest?: string
}

export type FoundationDocumentPatchOperation = {
  scope: 'document'
  kind: 'REPLACE'
  documentPath: FoundationDocumentPath
  issueIds: string[]
  beforeDigest: string
  afterDigest: string
}

export type PatchOperation = FoundationSectionPatchOperation | FoundationDocumentPatchOperation

const stableCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function normalizeServiceOwnedDocumentMetadata(markdown: string): string {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---') return markdown
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (closingIndex < 1) return markdown
  for (let index = 1; index < closingIndex; index += 1) {
    const separator = lines[index]!.indexOf(':')
    if (separator < 1) continue
    const field = lines[index]!.slice(0, separator).trim()
    if (field === 'version' || field === 'updated_at')
      lines[index] = `${field}: <service-owned>`
  }
  return lines.join('\n')
}

type ParsedSection = {
  sectionId: string
  text: string
  body: string
}

function parseSections(
  documentPath: FoundationDocumentPath,
  markdown: string,
): ParsedSection[] {
  // The existing contract-grounded index is deliberately the structural parser:
  // it rejects marker loss, duplicate markers, wrong headings and unknown markers.
  const index = buildFoundationSectionIndex({
    documents: { [documentPath]: markdown },
  })
  const lines = markdown.split('\n')
  return index
    .filter(section => section.documentPath === documentPath)
    .map(section => {
      const text = lines
        .slice(section.startLine - 1, section.endLine)
        .join('\n')
      const body = text.split('\n').slice(1).join('\n').trim()
      return { sectionId: section.sectionId, text, body }
    })
}

function sectionMap(
  sections: readonly ParsedSection[],
): Map<string, ParsedSection> {
  const output = new Map<string, ParsedSection>()
  for (const section of sections) {
    if (output.has(section.sectionId))
      throw new Error(`duplicate revision section: ${section.sectionId}`)
    output.set(section.sectionId, section)
  }
  return output
}

/** Derive section changes from canonical/staged bytes; worker declarations do not carry this evidence. */
export function deriveFoundationRevisionSectionDiff(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  stagedMarkdown: string
  authorizedSectionIds: readonly string[]
}): {
  base: ParsedSection[]
  staged: ParsedSection[]
  changed: ParsedSection[]
  changedSectionIds: string[]
} {
  const base = parseSections(input.documentPath, input.baseMarkdown)
  const staged = parseSections(input.documentPath, input.stagedMarkdown)
  sectionMap(base)
  sectionMap(staged)
  if (
    base.length !== staged.length ||
    base.some((section, index) => section.sectionId !== staged[index]?.sectionId)
  )
    throw new Error('revision changed section markers or section order')

  const changed = base.filter(
    (section, index) => section.text !== staged[index]!.text,
  )
  if (changed.some(section => !input.authorizedSectionIds.includes(section.sectionId)))
    throw new Error('revision changed an unauthorized section')
  const changedSectionIds = changed.map(section => section.sectionId)
  if (changedSectionIds.length === 0)
    throw new Error('revision contains no section progress')

  const outside = (markdown: string, allowed: ReadonlySet<string>) => {
    const lines = markdown.split('\n')
    const index = buildFoundationSectionIndex({
      documents: { [input.documentPath]: markdown },
    })
    const chunks: string[] = []
    let cursor = 0
    for (const section of index) {
      const start = section.startLine - 1
      const end = section.endLine
      chunks.push(lines.slice(cursor, start).join('\n'))
      if (allowed.has(section.sectionId))
        chunks.push(`\0${section.sectionId}\0`)
      else chunks.push(lines.slice(start, end).join('\n'))
      cursor = end
    }
    chunks.push(lines.slice(cursor).join('\n'))
    return normalizeServiceOwnedDocumentMetadata(chunks.join('\n'))
  }
  const allowed = new Set(input.authorizedSectionIds)
  if (outside(input.baseMarkdown, allowed) !== outside(input.stagedMarkdown, allowed))
    throw new Error('revision changed bytes outside authorized sections')

  return { base, staged, changed, changedSectionIds }
}

export function deriveFoundationRevisionChangedSectionIds(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  stagedMarkdown: string
  authorizedSectionIds: readonly string[]
}): string[] {
  return deriveFoundationRevisionSectionDiff(input).changedSectionIds
}

export function parseRevisionSections(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  authorizedSectionIds: readonly string[]
  output: string
}): Array<{ sectionId: string; sectionMarkdown: string }> {
  const index = buildFoundationSectionIndex({ documents: { [input.documentPath]: input.baseMarkdown } })
  const byId = new Map(index.map(section => [section.sectionId, section]))
  const headings = input.authorizedSectionIds.map(sectionId => {
    const section = byId.get(sectionId)
    if (!section)
      throw new Error(`foundation revision section is not canonical: ${sectionId}`)
    return {
      sectionId,
      heading: `${sectionId.startsWith('material.') ? '###' : '##'} ${section.heading}`,
    }
  })
  const lines = input.output.split('\n')
  const starts = headings.map(expected => ({
    ...expected,
    indexes: lines.flatMap((line, index) => line === expected.heading ? [index] : []),
  }))
  for (const entry of starts) {
    if (entry.indexes.length !== 1)
      throw new Error(`foundation revision output must contain exactly one authorized heading: ${entry.heading}`)
  }
  const ordered = starts
    .map(entry => ({ ...entry, index: entry.indexes[0] }))
    .sort((left, right) => left.index - right.index)
  if (lines.slice(0, ordered[0].index).some(line => line.trim()))
    throw new Error('foundation revision output contains prose outside authorized sections')
  return ordered.map((entry, index) => ({
    sectionId: entry.sectionId,
    sectionMarkdown: lines.slice(entry.index, ordered[index + 1]?.index ?? lines.length).join('\n').trim(),
  }))
}

export function applyFoundationRevisionSections(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  authorizedSectionIds: readonly string[]
  replacements: readonly { sectionId: string; sectionMarkdown: string }[]
}): { markdown: string; changedSectionIds: string[] } {
  const replacementIds = input.replacements.map(value => value.sectionId)
  if (new Set(replacementIds).size !== replacementIds.length)
    throw new Error('foundation revision contains duplicate section replacements')
  if (replacementIds.some(id => !input.authorizedSectionIds.includes(id)))
    throw new Error('foundation revision replacement is outside its authority')
  if (replacementIds.length !== input.authorizedSectionIds.length)
    throw new Error('foundation revision output omitted an authorized section')
  const sections = buildFoundationSectionIndex({ documents: { [input.documentPath]: input.baseMarkdown } })
  const byId = new Map(sections.map(section => [section.sectionId, section]))
  const lines = input.baseMarkdown.split('\n')
  const ordered = [...input.replacements].sort(
    (left, right) => byId.get(right.sectionId)!.startLine - byId.get(left.sectionId)!.startLine,
  )
  for (const replacement of ordered) {
    const section = byId.get(replacement.sectionId)
    if (!section) throw new Error('foundation revision replacement section is not canonical')
    const normalized = replacement.sectionMarkdown.replaceAll('\r\n', '\n').trim()
    if (/<!--\s*beegame-(?:section|material|executive-summary):?/i.test(normalized))
      throw new Error('foundation revision section Markdown cannot contain protocol markers')
    const sectionLines = normalized.split('\n')
    const expectedHeading = `${section.sectionId.startsWith('material.') ? '###' : '##'} ${section.heading}`
    if (sectionLines[0] !== expectedHeading)
      throw new Error(`foundation revision section Markdown must start with its canonical heading: ${expectedHeading}`)
    lines.splice(section.startLine - 1, section.endLine - section.startLine + 1, ...sectionLines, '')
  }
  const markdown = lines.join('\n')
  const changedSectionIds = deriveFoundationRevisionChangedSectionIds({
    documentPath: input.documentPath,
    baseMarkdown: input.baseMarkdown,
    stagedMarkdown: markdown,
    authorizedSectionIds: input.authorizedSectionIds,
  })
  return { markdown, changedSectionIds }
}

function comparePatchOperations(left: PatchOperation, right: PatchOperation): number {
  const document = left.documentPath.localeCompare(right.documentPath)
  if (document !== 0) return document
  const scope = left.scope.localeCompare(right.scope)
  if (scope !== 0) return scope
  const section = (left.scope === 'section' ? left.sectionId : '').localeCompare(
    right.scope === 'section' ? right.sectionId : '',
  )
  if (section !== 0) return section
  return stableJson(left).localeCompare(stableJson(right))
}

/** The mechanical, order-independent digest of validated patch operations. */
export function foundationPatchOperationsDigest(
  operations: readonly PatchOperation[],
): string {
  if (!Array.isArray(operations))
    throw new Error('foundation patch operations must be an array')
  return sha256(stableJson([...operations].sort(comparePatchOperations)))
}

/** Build section operations from a byte diff, binding no worker-provided body. */
export function deriveRevisionPatchOperations(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  stagedMarkdown: string
  authorizedSectionIds: readonly string[]
  issueIdsBySection: ReadonlyMap<string, readonly string[]> | Record<string, readonly string[]>
}): FoundationSectionPatchOperation[] {
  const authorityEntries: [string, readonly string[]][] = input.issueIdsBySection instanceof Map
    ? [...input.issueIdsBySection.entries()]
    : Object.entries(input.issueIdsBySection as Record<string, readonly string[]>)
  const authority = new Map(authorityEntries)
  const diff = deriveFoundationRevisionSectionDiff(input)
  const staged = sectionMap(diff.staged)
  const order = new Map(canonicalFoundationBlockIds(input.documentPath).map((id, index) => [id, index]))
  const issueIdsFor = (sectionId: string): string[] => {
    const values = authority.get(sectionId)
    if (!values?.length) throw new Error(`Revision changed a section without an admitted issue: ${sectionId}`)
    return [...values].sort(stableCompare)
  }
  const operations: FoundationSectionPatchOperation[] = [...diff.changed].sort((a, b) => (order.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER)).map(before => {
    const after = staged.get(before.sectionId)!
    const kind: FoundationSectionPatchOperation['kind'] = !before.body && after.body ? 'INSERT' : before.body && !after.body ? 'DELETE' : 'REPLACE'
    return { scope: 'section', kind, documentPath: input.documentPath, sectionId: before.sectionId, issueIds: issueIdsFor(before.sectionId),
      ...(kind !== 'INSERT' ? { beforeDigest: revisionBytesDigest(before.text) } : {}),
      ...(kind !== 'DELETE' ? { afterDigest: revisionBytesDigest(after.text) } : {}) }
  })
  if (authorityEntries.some(([sectionId, ids]) => !input.authorizedSectionIds.includes(sectionId) || !ids.length || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length))
    throw new Error('Revision operation issue authority is invalid')
  const expectedIds = [...new Set(authorityEntries.flatMap(([, ids]) => [...ids]))].sort(stableCompare)
  const actualIds = [...new Set(operations.flatMap(operation => operation.issueIds))].sort(stableCompare)
  if (expectedIds.length !== actualIds.length || expectedIds.some((id, index) => id !== actualIds[index]))
    throw new Error('revision issue coverage is not exact')
  return operations
}
