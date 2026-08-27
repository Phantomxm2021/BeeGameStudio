import { z } from 'zod/v4'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'
import type { FoundationAuthorityProjection } from './foundation-authority-projection'

const MARKDOWN_DOCUMENT_REFERENCE =
  /docs\/[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*/g

function assertCanonicalMarkdownReferences(markdown: string): void {
  const canonical = new Set(CANONICAL_FOUNDATION_DOCUMENTS)
  for (const reference of markdown.matchAll(MARKDOWN_DOCUMENT_REFERENCE)) {
    if (!canonical.has(reference[0] as FoundationDocumentPath))
      throw new Error(`complete game document contains non-canonical document reference: ${reference[0]}`)
  }
}

function normalizedHeading(text: string): string {
  return text.normalize('NFKC').trim().replaceAll(/\s+/g, ' ').toLowerCase()
}

type AuthoredHeading = { level: number; text: string; lineIndex: number }

type CompleteDocumentBlock = {
  id: string
  body: string
  startLine: number
}

function authoredHeadingScan(markdown: string): {
  headings: AuthoredHeading[]
  fenceOpen: boolean
} {
  const headings: AuthoredHeading[] = []
  let fence: string | undefined
  for (const [lineIndex, rawLine] of markdown.split('\n').entries()) {
    const line = rawLine.trimStart()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      const marker = line.slice(0, 3)
      fence = fence === undefined ? marker : fence === marker ? undefined : fence
      continue
    }
    if (fence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match)
      headings.push({ level: match[1]!.length, text: match[2]!, lineIndex })
  }
  return { headings, fenceOpen: fence !== undefined }
}

function authoredHeadings(markdown: string): Array<{ level: number; text: string }> {
  return authoredHeadingScan(markdown).headings.map(({ level, text }) => ({ level, text }))
}

function validateSectionHeadingStructure(
  sections: readonly { id: string; body: string }[],
): void {
  for (const section of sections) {
    const seen = new Set<string>()
    let priorLevel = 2
    for (const heading of authoredHeadings(section.body)) {
      if (heading.level < 3 || heading.level > 4)
        throw new Error(
          `section heading level is invalid: ${section.id}:H${heading.level}`,
        )
      if (heading.level > priorLevel + 1)
        throw new Error(
          `section heading level is skipped: ${section.id}:H${heading.level}`,
        )
      const normalized = normalizedHeading(heading.text)
      if (seen.has(normalized))
        throw new Error(`section heading is duplicated: ${heading.text}`)
      seen.add(normalized)
      priorLevel = heading.level
    }
  }
}

function assertExactOrder(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
  path: FoundationDocumentPath,
): void {
  if (
    actual.length !== expected.length ||
    expected.some((value, index) => actual[index] !== value)
  )
    throw new Error(`${label} must exactly match the canonical order for ${path}`)
}

export function assertMaterialFormat(
  format: 'markdown_table' | 'mermaid' | 'inline_svg' | 'evidence_register',
  body: string,
  materialId: string,
): void {
  const lines = body.split('\n').map(line => line.trim())
  const tableBlocks = lines.reduce<string[][]>((blocks, line) => {
    if (!line.startsWith('|') || !line.endsWith('|')) return [...blocks, []]
    const block = blocks.at(-1)
    if (block) block.push(line)
    else blocks.push([line])
    return blocks
  }, []).filter(block => block.length > 0)
  const validTableBlock = (tableLines: readonly string[]) => {
    const widths = tableLines.map(line =>
      line.split('').reduce(
        (count, character, index, source) =>
          character === '|' && source[index - 1] !== '\\' ? count + 1 : count,
        0,
      ),
    )
    return tableLines.length >= 3 &&
      widths[0]! >= 3 &&
      widths.every(width => width === widths[0]) &&
      tableLines.some(line => line.includes('---'))
  }
  const valid =
    format === 'markdown_table' || format === 'evidence_register'
      ? tableBlocks.length > 0 && tableBlocks.every(validTableBlock)
      : format === 'mermaid'
        ? lines.includes('```mermaid') && lines.includes('```')
        : (body.includes('<svg ') || body.includes('<svg>')) &&
          body.includes('</svg>')
  if (!valid)
    throw new Error(`production material format is invalid: ${materialId}:${format}`)
}

/** Structural-only admission used before a native Markdown result is forwarded. */
export function isCompleteGameDocumentMarkdownStructure(
  path: FoundationDocumentPath,
  value: string,
): boolean {
  const body = value.trim()
  if (!body) return false
  const scan = authoredHeadingScan(body)
  if (scan.fenceOpen) return false
  const contract = getGameDocumentContract(path)
  if (!contract) return false
  const expectedH2 = [
    'Executive Summary',
    ...contract.sections.map(section => section.title),
    'Production Materials',
  ]
  const expectedH3 = contract.productionMaterials.map(material => material.title)
  const actualH2 = scan.headings
    .filter(heading => heading.level === 2)
    .map(heading => heading.text)
  const productionHeading = scan.headings.find(
    heading => heading.level === 2 && heading.text === 'Production Materials',
  )
  if (!productionHeading || !exactSequence(actualH2, expectedH2))
    return false
  const materialHeadings = scan.headings.filter(
    heading => heading.level === 3 && heading.lineIndex > productionHeading.lineIndex,
  )
  const actualH3 = materialHeadings.map(heading => heading.text)
  if (!exactSequence(actualH3, expectedH3))
    return false
  return true
}

function exactSequence(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    expected.every((heading, index) => actual[index] === heading)
  )
}

function substantiveContentBlocks(lines: readonly string[]): string[] {
  const blocks: string[] = []
  let current: string[] = []
  const flush = () => {
    const normalized = current.map(line => line.trim()).join(' ').trim()
    current = []
    if (normalized.length >= 160) blocks.push(normalized)
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('<!--') || trimmed === '---') {
      flush()
      continue
    }
    current.push(trimmed)
  }
  flush()
  return blocks
}

const EMPTY_TEMPLATE_SENTENCES = [
  'No upstream authority; this section is an original fact owner.',
  'No known section-specific risks.',
  'No unresolved section decisions.',
] as const

function assertNonEmptyRange(
  lines: readonly string[],
  start: number,
  end: number,
  label: string,
): void {
  if (start < 0 || end <= start || !lines.slice(start + 1, end).some(line => line.trim()))
    throw new Error(`complete game document ${label} is empty or invalid`)
}

function nextNonBlankLine(
  lines: readonly string[],
  index: number,
): { index: number; value: string } | undefined {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor]!.trim())
      return { index: cursor, value: lines[cursor]! }
  }
  return undefined
}

const LOCAL_OWNER_KEY = /^(?:[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+|[A-Z]{1,4}\d+)$/
const LOCAL_OWNER_KEY_ALIAS = /^(?:[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+|[a-z]{1,4}\d+)$/
const SEMANTIC_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/
const SEMANTIC_ID_ALIAS = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
const CJK_ID = /[\u3400-\u9fff\u{20000}-\u{2ffff}]/u
const PLACEHOLDER_ID = /^(?:placeholder|tbd|todo|unknown)(?:[._-].*)?$/i
const REFERENCE_SYNTAX = /\b(?:owner\s+)?(?:reference|ref)\s*[:=]\s*([^\n]+)/gi
const ID_COLUMN = /^(?:id|key|identifier|stable(?:\s+|-)?id)$/i
const VALUE_COLUMN = /(?:value|range|formula|result|bound|threshold|interval|expression)/i

function unquoteId(value: string): string {
  return value.trim().replace(/^`|`$/g, '').replace(/^['"]|['"]$/g, '').trim()
}

function tableRows(body: string): Array<{ headers: string[]; cells: string[]; line: number }> {
  const lines = body.split('\n')
  const rows: Array<{ headers: string[]; cells: string[]; line: number }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) continue
    const headers = line.split('|').slice(1, -1).map(cell => cell.trim())
    const separator = lines[index + 1]?.trim()
    if (!separator?.startsWith('|') || !separator.endsWith('|') || !separator.includes('---')) continue
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex]!.trim()
      if (!row.startsWith('|') || !row.endsWith('|')) break
      rows.push({
        headers,
        cells: row.split('|').slice(1, -1).map(cell => cell.trim()),
        line: rowIndex + 1,
      })
    }
  }
  return rows
}

type StructuredFactRow = {
  id: string
  cells: string[]
  headers: string[]
  line: number
}

function explicitIds(block: CompleteDocumentBlock): {
  semantic: string[]
  aliases: string[]
  localDeclarations: Array<{ value: string; line: number }>
  localReferences: Array<{ value: string; line: number }>
  factRows: StructuredFactRow[]
} {
  const allowDeclarations = block.id.startsWith('material.')
  const semantic: string[] = []
  const aliases: string[] = []
  const localDeclarations: Array<{ value: string; line: number }> = []
  const localReferences: Array<{ value: string; line: number }> = []
  const factRows: StructuredFactRow[] = []
  const add = (raw: string, line: number, declaration: boolean) => {
    const value = unquoteId(raw)
    if (SEMANTIC_ID.test(value)) semantic.push(value)
    else if (SEMANTIC_ID_ALIAS.test(value)) aliases.push(value)
    else if (declaration && LOCAL_OWNER_KEY.test(value))
      localDeclarations.push({ value, line })
    else if (!declaration && (LOCAL_OWNER_KEY.test(value) || LOCAL_OWNER_KEY_ALIAS.test(value)))
      localReferences.push({ value, line })
  }
  for (const row of tableRows(block.body)) {
    const firstHeader = row.headers[0]?.toLowerCase() ?? ''
    const idColumn = ID_COLUMN.test(firstHeader)
    if (idColumn) {
      const value = unquoteId(row.cells[0] ?? '')
      if (allowDeclarations && (CJK_ID.test(value) || PLACEHOLDER_ID.test(value)))
        throw new Error(`owner-scoped ID is invalid: ${block.id}:line ${block.startLine + row.line - 1}`)
      add(value, block.startLine + row.line - 1, allowDeclarations)
      if (SEMANTIC_ID.test(value) || LOCAL_OWNER_KEY.test(value))
        factRows.push({ id: value, cells: row.cells.slice(1), headers: row.headers.slice(1), line: block.startLine + row.line - 1 })
      for (const [cellIndex, cell] of row.cells.slice(1).entries()) {
        const explicit = unquoteId(cell)
        if (SEMANTIC_ID.test(explicit) || SEMANTIC_ID_ALIAS.test(explicit))
          add(explicit, block.startLine + row.line - 1, false)
        else if (/(?:reference|ref|owner)/i.test(row.headers[cellIndex + 1] ?? ''))
          add(explicit, block.startLine + row.line - 1, false)
      }
      if (!allowDeclarations)
        for (const cell of row.cells.slice(1)) add(cell, block.startLine + row.line - 1, false)
    }
  }
  for (const match of block.body.matchAll(REFERENCE_SYNTAX)) {
    const line = block.startLine + block.body.slice(0, match.index ?? 0).split('\n').length - 1
    // Reference syntax is the only prose form admitted as an owner-local
    // reference. Ordinary code spans and narrative text remain Reviewer input.
    for (const token of match[1]!.matchAll(/`([^`\n]+)`|\b[A-Za-z][A-Za-z0-9_.-]*\b/g))
      add(token[1] ?? token[0], line, false)
  }
  return { semantic, aliases, localDeclarations, localReferences, factRows }
}

function assertOwnerScopedAuthority(
  path: FoundationDocumentPath,
  sections: readonly CompleteDocumentBlock[],
  materials: readonly CompleteDocumentBlock[],
): void {
  const blocks = [...sections, ...materials]
  const allSemantic = new Set<string>()
  const allAliases = new Set<string>()
  const declarations = new Map<string, { block: string; line: number }>()
  const references: Array<{ value: string; block: string; line: number }> = []
  const ownerFacts = new Map<string, { block: string; values: string[] }>()
  const blockFacts = new Map<string, StructuredFactRow[]>()
  for (const block of blocks) {
    const ids = explicitIds(block)
    ids.semantic.forEach(id => allSemantic.add(id))
    ids.aliases.forEach(alias => allAliases.add(alias))
    for (const declaration of ids.localDeclarations) {
      const prior = declarations.get(declaration.value)
      if (prior && prior.block !== block.id)
        throw new Error(`owner-local ID is declared by multiple owners: ${declaration.value}`)
      declarations.set(declaration.value, { block: block.id, line: declaration.line })
    }
    references.push(...ids.localReferences.map(reference => ({ ...reference, block: block.id })))
    blockFacts.set(block.id, ids.factRows)
    if (block.id === 'material.variable-parameter-table' && path === 'docs/BALANCE_DESIGN.md')
      for (const row of ids.factRows) {
        if (ownerFacts.has(row.id))
          throw new Error(`Balance owner fact ID is duplicated: ${row.id}`)
        ownerFacts.set(row.id, { block: block.id, values: row.cells.filter((cell, index) => VALUE_COLUMN.test(row.headers[index] ?? '')).map(unquoteId).filter(Boolean) })
      }
  }
  for (const semantic of allSemantic) {
    const alias = semantic.replaceAll('.', '_').toUpperCase()
    if (allAliases.has(alias))
      throw new Error(`semantic ID alias must match canonical spelling: ${path}:${semantic}/${alias}`)
  }
  for (const reference of references) {
    if (declarations.has(reference.value)) continue
    const canonical = reference.value.replaceAll('_', '-').toUpperCase()
    const alias = [...declarations.keys()].find(key => key.replaceAll('_', '-').toUpperCase() === canonical)
    if (alias)
      throw new Error(`owner-local ID alias must be byte-for-byte: ${reference.block}:line ${reference.line}: ${reference.value}`)
    throw new Error(`owner-local ID is undefined: ${reference.block}:line ${reference.line}: ${reference.value}`)
  }

  if (path === 'docs/BALANCE_DESIGN.md') {
    for (const block of blocks.filter(block => block.id !== 'material.variable-parameter-table')) {
      for (const row of blockFacts.get(block.id) ?? []) {
        const owner = ownerFacts.get(row.id)
        if (!owner) continue
        const values = row.cells.filter((cell, index) => VALUE_COLUMN.test(row.headers[index] ?? '')).map(unquoteId).filter(Boolean)
        if (values.some(value => owner.values.includes(value)))
          throw new Error(`Balance non-owner block duplicates owner fact ${row.id}: ${block.id}:line ${row.line}`)
      }
      for (const match of block.body.matchAll(REFERENCE_SYNTAX)) {
        const text = match[1]!
        for (const [id, owner] of ownerFacts) {
          if (text.includes(id) && owner.values.some(value => text.includes(value)))
            throw new Error(`Balance non-owner block duplicates owner fact ${id}: ${block.id}`)
        }
      }
    }
  }
}

/**
 * Bee Game Studio owns protocol comments, while the native author owns every
 * human-readable heading and body. Normalize only the service comments after
 * proving that the authored heading contract is already complete and ordered.
 */
export function normalizeCompleteGameDocumentProtocol(
  path: FoundationDocumentPath,
  value: unknown,
): string {
  const body = z.string().trim().min(1).parse(value)
  assertCanonicalMarkdownReferences(body)
  const contract = getGameDocumentContract(path)
  const markerByHeading = new Map<string, string>([
    ['## Executive Summary', '<!-- beegame-executive-summary -->'],
    ...contract.sections.map(
      section =>
        [`## ${section.title}`, `<!-- beegame-section:${section.sectionId} -->`] as const,
    ),
    ['## Production Materials', '<!-- beegame-production-materials -->'],
    ...contract.productionMaterials.map(
      material =>
        [`### ${material.title}`, `<!-- beegame-material:${material.materialId} -->`] as const,
    ),
  ])
  const recognizedMarkers = new Set(markerByHeading.values())
  const lines = body.split('\n').map(line => line.trimEnd())
  const authoredLines = lines.filter(line => {
    const trimmed = line.trim()
    if (recognizedMarkers.has(trimmed)) return false
    if (
      trimmed.startsWith('<!-- beegame-section:') ||
      trimmed.startsWith('<!-- beegame-material:') ||
      trimmed === '<!-- beegame-executive-summary -->' ||
      trimmed === '<!-- beegame-production-materials -->'
    )
      throw new Error('complete game document contains an unknown protocol marker')
    return true
  })

  const visibleHeadingIndexes = new Map<string, number[]>()
  let fence: string | undefined
  authoredLines.forEach((rawLine, index) => {
    const line = rawLine.trimStart()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      const marker = line.slice(0, 3)
      fence = fence === undefined ? marker : fence === marker ? undefined : fence
      return
    }
    if (fence || !markerByHeading.has(rawLine)) return
    const indexes = visibleHeadingIndexes.get(rawLine) ?? []
    indexes.push(index)
    visibleHeadingIndexes.set(rawLine, indexes)
  })

  const expectedHeadings = [...markerByHeading.keys()]
  const orderedIndexes = expectedHeadings.map(heading => {
    const indexes = visibleHeadingIndexes.get(heading) ?? []
    if (indexes.length !== 1)
      throw new Error(
        `complete game document canonical heading must appear exactly once: ${heading}`,
      )
    return indexes[0]!
  })
  if (
    orderedIndexes.some(
      (index, offset) => offset > 0 && index <= orderedIndexes[offset - 1]!,
    )
  )
    throw new Error(
      `complete game document headings must exactly match the canonical order for ${path}`,
    )

  const normalized: string[] = []
  for (const line of authoredLines) {
    const marker = markerByHeading.get(line)
    if (marker) normalized.push(marker)
    normalized.push(line)
  }
  return validateCompleteGameDocumentMarkdown(path, normalized.join('\n'))
}

/**
 * Validate one complete Markdown file after the native Bee Game Studio worker
 * wrote it. This module has no structured document payload and no renderer;
 * BGS is a mechanical gate, never a document author or transport.
 */
export function validateCompleteGameDocumentMarkdown(
  path: FoundationDocumentPath,
  value: unknown,
): string {
  const body = z.string().trim().min(1).parse(value)
  assertCanonicalMarkdownReferences(body)
  const contract = getGameDocumentContract(path)
  const lines = body.split('\n').map(line => line.trimEnd())
  if (!lines[0]?.startsWith('# ') || lines[0].startsWith('## '))
    throw new Error('complete game document requires one document title')
  if (EMPTY_TEMPLATE_SENTENCES.some(sentence => body.includes(sentence)))
    throw new Error('complete game document contains an empty template sentence')

  const blocks = substantiveContentBlocks(lines)
  if (new Set(blocks).size !== blocks.length)
    throw new Error('complete game document repeats a substantive content block')

  const summaryMarker = '<!-- beegame-executive-summary -->'
  const productionMarker = '<!-- beegame-production-materials -->'
  const auditMarker = '<!-- beegame-audit-appendix -->'
  const sectionMarkers = contract.sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
  const materialMarkers = contract.productionMaterials.map(
    material => `<!-- beegame-material:${material.materialId} -->`,
  )
  assertExactOrder(
    lines.filter(line => line.startsWith('<!-- beegame-section:')),
    sectionMarkers,
    'complete game document sections',
    path,
  )
  assertExactOrder(
    lines.filter(line => line.startsWith('<!-- beegame-material:')),
    materialMarkers,
    'complete game document production materials',
    path,
  )

  const summaryIndex = lines.indexOf(summaryMarker)
  const productionIndex = lines.indexOf(productionMarker)
  const auditIndex = lines.indexOf(auditMarker)
  const documentEnd = auditIndex >= 0 ? auditIndex : lines.length
  const sectionIndexes = sectionMarkers.map(marker => lines.indexOf(marker))
  const materialIndexes = materialMarkers.map(marker => lines.indexOf(marker))
  const sectionBodies = contract.sections.map((section, index): CompleteDocumentBlock => {
    const start = sectionIndexes[index]!
    const end = sectionIndexes[index + 1] ?? productionIndex
    const heading = nextNonBlankLine(lines, start)
    return {
      id: section.sectionId,
      body: lines.slice((heading?.index ?? start) + 1, end).join('\n'),
      startLine: (heading?.index ?? start) + 2,
    }
  })
  const materialBodies = contract.productionMaterials.map((material, index): CompleteDocumentBlock => {
    const start = materialIndexes[index]!
    const end = materialIndexes[index + 1] ?? documentEnd
    const heading = nextNonBlankLine(lines, start)
    return {
      id: `material.${material.materialId}`,
      body: lines.slice((heading?.index ?? start) + 1, end).join('\n').trim(),
      startLine: (heading?.index ?? start) + 2,
    }
  })
  const orderedIndexes = [
    summaryIndex,
    ...sectionIndexes,
    productionIndex,
    ...materialIndexes,
    ...(auditIndex >= 0 ? [auditIndex] : []),
  ]
  if (
    orderedIndexes.some(index => index < 0) ||
    orderedIndexes.some(
      (index, offset) => offset > 0 && index <= orderedIndexes[offset - 1]!,
    )
  )
    throw new Error(
      `complete game document structure must exactly match the canonical order for ${path}`,
    )

  const summaryHeading = nextNonBlankLine(lines, summaryIndex)
  if (summaryHeading?.value !== '## Executive Summary')
    throw new Error('complete game document executive summary heading is invalid')
  assertNonEmptyRange(
    lines,
    summaryHeading.index,
    sectionIndexes[0]!,
    'executive summary',
  )

  contract.sections.forEach((section, index) => {
    const start = sectionIndexes[index]!
    const end = sectionIndexes[index + 1] ?? productionIndex
    const heading = nextNonBlankLine(lines, start)
    if (heading?.value !== `## ${section.title}`)
      throw new Error(`complete game document section title is invalid: ${section.sectionId}`)
    assertNonEmptyRange(lines, heading.index, end, `section:${section.sectionId}`)
  })
  validateSectionHeadingStructure(sectionBodies)

  if (nextNonBlankLine(lines, productionIndex)?.value !== '## Production Materials')
    throw new Error('complete game document production materials heading is invalid')

  contract.productionMaterials.forEach((material, index) => {
    const start = materialIndexes[index]!
    const end = materialIndexes[index + 1] ?? documentEnd
    const heading = nextNonBlankLine(lines, start)
    if (heading?.value !== `### ${material.title}`)
      throw new Error(`production material title is invalid: ${material.materialId}`)
    const materialBody = materialBodies[index]!.body
    assertMaterialFormat(
      material.format,
      materialBody,
      material.materialId,
    )
  })

  assertOwnerScopedAuthority(path, sectionBodies, materialBodies)

  if (auditIndex >= 0) {
    if (nextNonBlankLine(lines, auditIndex)?.value !== '## Audit Appendix')
      throw new Error('complete game document audit appendix heading is invalid')
    const acceptanceIndex = lines.indexOf(
      '### Acceptance Criteria',
      auditIndex + 1,
    )
    const acceptanceLines = lines.slice(acceptanceIndex + 1)
    const hasAcceptanceList = acceptanceLines.some(line =>
      line.trim().startsWith('- '),
    )
    const tableLines = acceptanceLines.filter(line => {
      const trimmed = line.trim()
      return trimmed.startsWith('|') && trimmed.endsWith('|')
    })
    const hasAcceptanceTable =
      tableLines.length >= 3 && tableLines.some(line => line.includes('---'))
    if (
      acceptanceIndex < auditIndex ||
      (!hasAcceptanceList && !hasAcceptanceTable)
    )
      throw new Error(
        'complete game document acceptance criteria are empty or invalid',
      )
  }
  return `${body}\n`
}

export type CompleteGameDocumentOwnerSymbol = Readonly<{
  documentPath: FoundationDocumentPath
  sectionId: string
}>

export type CompleteGameDocumentWorkspaceAuthority = Readonly<{
  projection: FoundationAuthorityProjection
  ownerSymbols: ReadonlyMap<string, CompleteGameDocumentOwnerSymbol> | Readonly<Record<string, CompleteGameDocumentOwnerSymbol>>
}>

/**
 * Workspace-aware admission layered on the sole Markdown validator. The
 * projection and symbol table are committed inputs; prose that does not use
 * an explicit ID column or reference syntax remains outside this mechanical
 * gate and is left to Reviewer.
 */
export function validateCompleteGameDocumentMarkdownWithWorkspaceAuthority(
  path: FoundationDocumentPath,
  value: unknown,
  authority: CompleteGameDocumentWorkspaceAuthority,
): string {
  const canonical = validateCompleteGameDocumentMarkdown(path, value)
  const contract = getGameDocumentContract(path)
  if (authority.projection.targetPath !== path)
    throw new Error(`committed upstream projection target does not match document: ${path}`)
  const contractedUpstream = new Set(contract.upstreamSections.map(source => source.path))
  if (authority.projection.sources.some(source => !contractedUpstream.has(source.path)))
    throw new Error(`committed upstream projection contains an undeclared source: ${path}`)
  const lines = canonical.split('\n')
  const sectionMarkers = contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->`)
  const materialMarkers = contract.productionMaterials.map(material => `<!-- beegame-material:${material.materialId} -->`)
  const blocks = [
    ...contract.sections.map((section, index): CompleteDocumentBlock => {
      const start = lines.indexOf(sectionMarkers[index]!)
      const end = lines.indexOf(sectionMarkers[index + 1] ?? '<!-- beegame-production-materials -->')
      const heading = nextNonBlankLine(lines, start)
      return { id: section.sectionId, body: lines.slice((heading?.index ?? start) + 1, end).join('\n'), startLine: (heading?.index ?? start) + 2 }
    }),
    ...contract.productionMaterials.map((material, index): CompleteDocumentBlock => {
      const start = lines.indexOf(materialMarkers[index]!)
      const end = lines.indexOf(materialMarkers[index + 1] ?? '<!-- beegame-audit-appendix -->')
      const heading = nextNonBlankLine(lines, start)
      return { id: `material.${material.materialId}`, body: lines.slice((heading?.index ?? start) + 1, end < 0 ? lines.length : end).join('\n'), startLine: (heading?.index ?? start) + 2 }
    }),
  ]
  const symbols = authority.ownerSymbols instanceof Map
    ? authority.ownerSymbols
    : new Map(Object.entries(authority.ownerSymbols))
  const ownIds = new Set<string>()
  const references = new Set<string>()
  for (const block of blocks) {
    const ids = explicitIds(block)
    ids.factRows.forEach(row => ownIds.add(row.id))
    ids.semantic.forEach(id => references.add(id))
  }
  const projected = new Map<string, Set<string>>()
  for (const source of authority.projection.sources) {
    projected.set(source.path, new Set(source.sections.map(section => section.sectionId)))
  }
  for (const id of references) {
    if (ownIds.has(id)) continue
    if ((path === 'docs/AUDIO_DESIGN.md' || path === 'docs/ART_DIRECTION.md') && id.startsWith('asset.'))
      throw new Error(`future Asset inventory ID is not available to ${path}: ${id}`)
    const owner = symbols.get(id)
    if (!owner)
      throw new Error(`undefined cross-document semantic ID: ${path}:${id}`)
    if (owner.documentPath === path) continue
    const sections = projected.get(owner.documentPath)
    if (!sections || !sections.has(owner.sectionId))
      throw new Error(`cross-document semantic ID is outside committed upstream projection: ${path}:${id}`)
  }
  return canonical
}
