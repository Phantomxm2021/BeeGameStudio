import { z } from 'zod/v4'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

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

function assertProtocolMarkerIntegrity(
  lines: readonly string[],
  sectionMarkers: readonly string[],
  materialMarkers: readonly string[],
): void {
  const expected = new Set([...sectionMarkers, ...materialMarkers])
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (
      trimmed.includes('<!-- beegame-section:') ||
      trimmed.includes('<!-- beegame-material:')
    ) {
      if (!expected.has(trimmed)) {
        const materialId = /<!-- beegame-material:([^\s>]+)[^>]*-->/.exec(trimmed)?.[1]
        const label = materialId ? `material ${materialId}` : 'protocol'
        throw new Error(
          `complete game document ${label} marker is malformed:line ${index + 1}`,
        )
      }
    }
  }
  const present = new Set(lines.map(line => line.trim()))
  for (const marker of materialMarkers) {
    if (!present.has(marker)) {
      const materialId = marker.slice('<!-- beegame-material:'.length, -' -->'.length)
      throw new Error(
        `complete game document production materials ${materialId} marker is missing`,
      )
    }
  }
}

export function assertMaterialFormat(
  format: 'markdown_table' | 'mermaid' | 'inline_svg' | 'evidence_register',
  body: string,
  materialId: string,
  startLine = 1,
): void {
  assertMarkdownIntegrity(body, materialId, startLine)
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
    throw new Error(
      `production material format is invalid: ${materialId}:${format}:line ${startLine}`,
    )
}

type OpenMarkdownFence = {
  marker: string
  line: number
  language: string
}

function markdownFence(line: string): { marker: string; rest: string } | undefined {
  const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
  return match ? { marker: match[1]!, rest: match[2]! } : undefined
}

function assertMarkdownFenceAndInlineIntegrity(
  body: string,
  blockId: string,
  startLine: number,
): void {
  let open: OpenMarkdownFence | undefined
  for (const [index, rawLine] of body.split('\n').entries()) {
    const candidate = markdownFence(rawLine)
    if (candidate) {
      if (!open) {
        open = {
          marker: candidate.marker,
          line: index,
          language: candidate.rest.trim().split(/\s+/, 1)[0] ?? '',
        }
      } else if (
        candidate.marker[0] === open.marker[0] &&
        candidate.marker.length >= open.marker.length &&
        candidate.rest.trim() === ''
      ) {
        open = undefined
      }
      continue
    }
    if (open) continue
    let backticks = 0
    for (let character = 0; character < rawLine.length; character += 1) {
      if (
        rawLine[character] === '`' &&
        (character === 0 || rawLine[character - 1] !== '\\')
      )
        backticks += 1
    }
    if (backticks % 2 !== 0)
      throw new Error(
        `Markdown inline code span is unclosed: ${blockId}:line ${startLine + index}`,
      )
  }
}

function markdownTablePipeWidth(line: string): number {
  let width = 0
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '|' && line[index - 1] !== '\\') width += 1
  }
  return width
}

function assertMarkdownTableIntegrity(
  body: string,
  blockId: string,
  startLine: number,
): void {
  let candidate: Array<{ line: string; index: number }> = []
  const flush = () => {
    if (!candidate.length) return
    const widths = candidate.map(item => markdownTablePipeWidth(item.line))
    const malformed = candidate.some(item => {
      const line = item.line.trim()
      return !line.startsWith('|') || !line.endsWith('|')
    }) || widths.some(width => width !== widths[0])
    if (malformed)
      throw new Error(
        `Markdown table pipes are uneven: ${blockId}:line ${startLine + candidate[0]!.index}`,
      )
    candidate = []
  }
  for (const [index, rawLine] of body.split('\n').entries()) {
    const line = rawLine.trim()
    if (line.startsWith('|') || line.endsWith('|')) {
      candidate.push({ line, index })
      continue
    }
    flush()
  }
  flush()
}

function assertMarkdownIntegrity(
  body: string,
  blockId: string,
  startLine: number,
): void {
  assertMarkdownFenceAndInlineIntegrity(body, blockId, startLine)
  assertMarkdownTableIntegrity(body, blockId, startLine)
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
const DECLARATION_SYNTAX = /\b(?:owner\s+)?(?:declaration|declare)\s*[:=]\s*([^\n]+)/gi
const DECLARATION_COLUMN = /^(?:ID|Key|Identifier|Stable ID)$/
const REFERENCE_COLUMN = /^(?:Reference ID|Owner ID|Inventory ID|(?:Owner|Asset|Path|Section|Material|Formula|Acceptance|Stable) Ref)$/
const VALUE_COLUMN = /^(?:Value|Range|Formula|Result|Bound|Threshold|Interval|Expression)$/i

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
  kind: 'declaration' | 'reference'
  cells: string[]
  headers: string[]
  line: number
}

function explicitIds(block: CompleteDocumentBlock): {
  semantic: string[]
  semanticDeclarations: string[]
  semanticReferences: string[]
  aliases: string[]
  localDeclarations: Array<{ value: string; line: number }>
  localReferences: Array<{ value: string; line: number }>
  factRows: StructuredFactRow[]
} {
  const allowDeclarations = true
  const semantic: string[] = []
  const semanticDeclarations: string[] = []
  const semanticReferences: string[] = []
  const aliases: string[] = []
  const localDeclarations: Array<{ value: string; line: number }> = []
  const localReferences: Array<{ value: string; line: number }> = []
  const factRows: StructuredFactRow[] = []
  const add = (raw: string, line: number, declaration: boolean) => {
    const value = unquoteId(raw)
    if (SEMANTIC_ID.test(value)) {
      semantic.push(value)
      if (declaration) semanticDeclarations.push(value)
      else semanticReferences.push(value)
    }
    else if (SEMANTIC_ID_ALIAS.test(value)) aliases.push(value)
    else if (declaration && LOCAL_OWNER_KEY.test(value))
      localDeclarations.push({ value, line })
    else if (!declaration && (LOCAL_OWNER_KEY.test(value) || LOCAL_OWNER_KEY_ALIAS.test(value)))
      localReferences.push({ value, line })
  }
  for (const row of tableRows(block.body)) {
    const declarationColumn = DECLARATION_COLUMN.test(row.headers[0] ?? '')
    const referenceColumn = REFERENCE_COLUMN.test(row.headers[0] ?? '')
    const idColumn = declarationColumn || referenceColumn
    if (idColumn) {
      const value = unquoteId(row.cells[0] ?? '')
      if ((declarationColumn || referenceColumn) && (CJK_ID.test(value) || PLACEHOLDER_ID.test(value)))
        throw new Error(`owner-scoped ID is invalid: ${block.id}:line ${block.startLine + row.line - 1}`)
      add(value, block.startLine + row.line - 1, declarationColumn && allowDeclarations)
      if ((declarationColumn && allowDeclarations || referenceColumn) && (SEMANTIC_ID.test(value) || LOCAL_OWNER_KEY.test(value)))
        factRows.push({ id: value, kind: declarationColumn ? 'declaration' : 'reference', cells: row.cells.slice(1), headers: row.headers.slice(1), line: block.startLine + row.line - 1 })
      for (const [cellIndex, cell] of row.cells.slice(1).entries()) {
        const explicit = unquoteId(cell)
        if (REFERENCE_COLUMN.test(row.headers[cellIndex + 1] ?? '')) {
          if (CJK_ID.test(explicit) || PLACEHOLDER_ID.test(explicit))
            throw new Error(`owner-scoped ID is invalid: ${block.id}:line ${block.startLine + row.line - 1}`)
          add(explicit, block.startLine + row.line - 1, false)
        }
      }
    }
  }
  for (const match of block.body.matchAll(REFERENCE_SYNTAX)) {
    const line = block.startLine + block.body.slice(0, match.index ?? 0).split('\n').length - 1
    // Reference syntax is the only prose form admitted as an owner-local
    // reference. Ordinary code spans and narrative text remain Reviewer input.
    for (const token of match[1]!.matchAll(/`([^`\n]+)`|\b[A-Za-z][A-Za-z0-9_.-]*\b/g)) {
      const value = unquoteId(token[1] ?? token[0])
      if (PLACEHOLDER_ID.test(value) || (token[1] !== undefined && CJK_ID.test(value)))
        throw new Error(`owner-scoped ID is invalid: ${block.id}:line ${line}`)
      add(value, line, false)
    }
  }
  for (const match of block.body.matchAll(DECLARATION_SYNTAX)) {
    const line = block.startLine + block.body.slice(0, match.index ?? 0).split('\n').length - 1
    for (const token of match[1]!.matchAll(/`([^`\n]+)`|\b[A-Za-z][A-Za-z0-9_.-]*\b/g)) {
      const value = unquoteId(token[1] ?? token[0])
      if (SEMANTIC_ID.test(value)) {
        semantic.push(value)
        semanticDeclarations.push(value)
      } else if (SEMANTIC_ID_ALIAS.test(value)) {
        aliases.push(value)
      } else if (LOCAL_OWNER_KEY.test(value)) {
        localDeclarations.push({ value, line })
      } else if (PLACEHOLDER_ID.test(value) || (token[1] !== undefined && CJK_ID.test(value))) {
        throw new Error(`owner-scoped ID is invalid: ${block.id}:line ${line}`)
      }
    }
  }
  return { semantic, semanticDeclarations, semanticReferences, aliases, localDeclarations, localReferences, factRows }
}

function assertOwnerScopedAuthority(
  path: FoundationDocumentPath,
  sections: readonly CompleteDocumentBlock[],
  materials: readonly CompleteDocumentBlock[],
): void {
  const blocks = [...sections, ...materials]
  const allSemantic = new Set<string>()
  const allAliases = new Set<string>()
  const semanticDeclarations = new Map<string, { block: string; line: number }>()
  const declarations = new Map<string, { block: string; line: number }>()
  const references: Array<{ value: string; block: string; line: number }> = []
  const ownerFacts = new Map<string, { block: string; values: string[] }>()
  const blockFacts = new Map<string, StructuredFactRow[]>()
  for (const block of blocks) {
    const ids = explicitIds(block)
    ids.semantic.forEach(id => allSemantic.add(id))
    ids.aliases.forEach(alias => allAliases.add(alias))
    ids.semanticDeclarations.forEach(id => {
      const prior = semanticDeclarations.get(id)
      if (prior && prior.block !== block.id)
        throw new Error(`semantic ID is declared by multiple owners: ${id}`)
      semanticDeclarations.set(id, { block: block.id, line: block.startLine })
    })
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
        if (row.kind !== 'declaration') continue
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
  if (allAliases.size)
    throw new Error(`semantic ID alias is not canonical: ${path}:${[...allAliases][0]}`)
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

export type CompleteGameDocumentAuthoritySymbol = Readonly<{
  id: string
  documentPath: FoundationDocumentPath
  sectionId: string
}>

function completeDocumentBlocks(
  path: FoundationDocumentPath,
  lines: readonly string[],
): CompleteDocumentBlock[] {
  const contract = getGameDocumentContract(path)
  const sectionMarkers = contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->`)
  const materialMarkers = contract.productionMaterials.map(material => `<!-- beegame-material:${material.materialId} -->`)
  const productionIndex = lines.indexOf('<!-- beegame-production-materials -->')
  const documentEnd = lines.indexOf('<!-- beegame-audit-appendix -->') >= 0
    ? lines.indexOf('<!-- beegame-audit-appendix -->')
    : lines.length
  const sectionIndexes = sectionMarkers.map(marker => lines.indexOf(marker))
  const materialIndexes = materialMarkers.map(marker => lines.indexOf(marker))
  return [
    ...contract.sections.map((section, index): CompleteDocumentBlock => {
      const start = sectionIndexes[index]!
      const end = sectionIndexes[index + 1] ?? productionIndex
      const heading = nextNonBlankLine(lines, start)
      return { id: section.sectionId, body: lines.slice((heading?.index ?? start) + 1, end).join('\n'), startLine: (heading?.index ?? start) + 2 }
    }),
    ...contract.productionMaterials.map((material, index): CompleteDocumentBlock => {
      const start = materialIndexes[index]!
      const end = materialIndexes[index + 1] ?? documentEnd
      const heading = nextNonBlankLine(lines, start)
      return { id: `material.${material.materialId}`, body: lines.slice((heading?.index ?? start) + 1, end).join('\n'), startLine: (heading?.index ?? start) + 2 }
    }),
  ]
}

/** Collects only explicit owner declarations for the committed projection. */
export function collectCompleteGameDocumentAuthoritySymbols(
  path: FoundationDocumentPath,
  markdown: string,
): readonly CompleteGameDocumentAuthoritySymbol[] {
  return completeDocumentBlocks(path, markdown.split('\n')).flatMap(block => {
    const ids = explicitIds(block)
    const tableSymbols = ids.factRows
      .filter(row => row.kind === 'declaration')
      .filter(row => SEMANTIC_ID.test(row.id))
      .map(row => row.id)
    const declarationSymbols = ids.semanticDeclarations.filter(id => !tableSymbols.includes(id))
    return [...new Set([...tableSymbols, ...declarationSymbols])].map(id => ({
      id,
      documentPath: path,
      sectionId: block.id,
    }))
  })
}

/** Collects cross-document IDs from explicit Reference/ref syntax and exact reference columns. */
export function collectCompleteGameDocumentAuthorityReferences(
  path: FoundationDocumentPath,
  markdown: string,
): readonly string[] {
  const references: string[] = []
  for (const block of completeDocumentBlocks(path, markdown.split('\n'))) {
    const ids = explicitIds(block)
    references.push(...ids.semanticReferences)
  }
  for (const match of markdown.matchAll(REFERENCE_SYNTAX)) {
    for (const token of match[1]!.matchAll(/`([^`\n]+)`|\b[A-Za-z][A-Za-z0-9_.-]*\b/g)) {
      const value = unquoteId(token[1] ?? token[0])
      if (SEMANTIC_ID.test(value)) references.push(value)
    }
  }
  return [...new Set(references)]
}

function collectCompleteGameDocumentAuthorityDeclarations(
  path: FoundationDocumentPath,
  markdown: string,
): readonly string[] {
  return completeDocumentBlocks(path, markdown.split('\n')).flatMap(block => explicitIds(block).semanticDeclarations)
}

export function assertCompleteGameDocumentCrossDocumentReferences(
  path: FoundationDocumentPath,
  markdown: string,
  projection: {
    targetPath: FoundationDocumentPath
    sources: readonly { path: FoundationDocumentPath; sections: readonly { sectionId: string }[] }[]
    symbols: readonly CompleteGameDocumentAuthoritySymbol[]
  },
): void {
  const contract = getGameDocumentContract(path)
  if (projection.targetPath !== path)
    throw new Error(`committed upstream projection target does not match document: ${path}`)
  const contracted = new Set(contract.upstreamSections.map(source => source.path))
  if (projection.sources.some(source => !contracted.has(source.path)))
    throw new Error(`committed upstream projection contains an undeclared source: ${path}`)
  const symbols = new Map(projection.symbols.map(symbol => [symbol.id, symbol]))
  const ownDeclarations = new Set(collectCompleteGameDocumentAuthorityDeclarations(path, markdown))
  for (const id of collectCompleteGameDocumentAuthorityReferences(path, markdown)) {
    if (ownDeclarations.has(id)) continue
    if ((path === 'docs/AUDIO_DESIGN.md' || path === 'docs/ART_DIRECTION.md') && id.startsWith('asset.'))
      throw new Error(`future Asset inventory ID is not available to ${path}: ${id}`)
    const owner = symbols.get(id)
    if (!owner)
      throw new Error(`undefined cross-document semantic ID: ${path}:${id}`)
    const source = projection.sources.find(candidate => candidate.path === owner.documentPath)
    if (!source)
      throw new Error(`cross-document semantic ID is outside committed upstream projection: ${path}:${id}`)
    const sourceContract = getGameDocumentContract(source.path)
    const materialSectionId = sourceContract.productionMaterials.some(
      material => `material.${material.materialId}` === owner.sectionId,
    )
    const declaredSection = sourceContract.sections.some(
      section => section.sectionId === owner.sectionId,
    )
    if (!materialSectionId && (!declaredSection || !source.sections.some(section => section.sectionId === owner.sectionId)))
      throw new Error(`cross-document semantic ID is outside committed upstream projection: ${path}:${id}`)
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
  assertProtocolMarkerIntegrity(lines, sectionMarkers, materialMarkers)
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
  const blocksById = new Map(completeDocumentBlocks(path, lines).map(block => [block.id, block]))
  const sectionBodies = contract.sections.map(section => blocksById.get(section.sectionId)!)
  const materialBodies = contract.productionMaterials.map(material => blocksById.get(`material.${material.materialId}`)!)
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
      materialBodies[index]!.startLine,
    )
  })

  for (const section of sectionBodies)
    assertMarkdownIntegrity(section.body, section.id, section.startLine)

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
