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
  let inline: { length: number; line: number } | undefined
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
    for (let character = 0; character < rawLine.length;) {
      if (rawLine[character] !== '`') {
        character += 1
        continue
      }
      let slashes = 0
      for (let previous = character - 1; previous >= 0 && rawLine[previous] === '\\'; previous -= 1)
        slashes += 1
      let length = 1
      while (rawLine[character + length] === '`') length += 1
      character += length
      if (slashes % 2 !== 0) continue
      if (inline) {
        if (length === inline.length) inline = undefined
      } else {
        inline = { length, line: index }
      }
    }
  }
  if (open) {
    const language = open.language ? ` ${open.language}` : ''
    throw new Error(
      `Markdown${language} code fence is unclosed: ${blockId}:line ${startLine + open.line}`,
    )
  }
  if (inline)
    throw new Error(
      `Markdown inline code span is unclosed: ${blockId}:line ${startLine + inline.line}`,
    )
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
  const lines = body.split('\n').map(line => line.trim())
  const isTableLine = (line: string) => line.startsWith('|') && line.endsWith('|')
  const isDelimiter = (line: string) =>
    isTableLine(line) &&
    line
      .slice(1, -1)
      .split('|')
      .every(cell => /^:?-{3,}:?$/.test(cell.trim()))
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]!
    const delimiter = lines[index + 1]!
    if (!isTableLine(header) || !isDelimiter(delimiter)) continue
    const width = markdownTablePipeWidth(header)
    if (markdownTablePipeWidth(delimiter) !== width)
      throw new Error(
        `Markdown table pipes are uneven: ${blockId}:line ${startLine + index + 1}`,
      )
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex]!
      if (!row.startsWith('|')) break
      if (!row.endsWith('|') || markdownTablePipeWidth(row) !== width)
        throw new Error(
          `Markdown table pipes are uneven: ${blockId}:line ${startLine + rowIndex}`,
        )
    }
  }
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

type CompleteDocumentBlock = {
  id: string
  body: string
  startLine: number
}

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

function completeDocumentBlocks(
  path: FoundationDocumentPath,
  lines: readonly string[],
): CompleteDocumentBlock[] {
  const contract = getGameDocumentContract(path)
  const sectionMarkers = contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->`)
  const materialMarkers = contract.productionMaterials.map(material => `<!-- beegame-material:${material.materialId} -->`)
  const productionIndex = lines.indexOf('<!-- beegame-production-materials -->')
  const auditIndex = lines.indexOf('<!-- beegame-audit-appendix -->')
  const documentEnd = auditIndex >= 0 ? auditIndex : lines.length
  const sectionIndexes = sectionMarkers.map(marker => lines.indexOf(marker))
  const materialIndexes = materialMarkers.map(marker => lines.indexOf(marker))
  return [
    ...contract.sections.map((section, index): CompleteDocumentBlock => {
      const start = sectionIndexes[index]!
      const end = sectionIndexes[index + 1] ?? productionIndex
      const heading = nextNonBlankLine(lines, start)
      return {
        id: section.sectionId,
        body: lines.slice((heading?.index ?? start) + 1, end).join('\n'),
        startLine: (heading?.index ?? start) + 2,
      }
    }),
    ...contract.productionMaterials.map((material, index): CompleteDocumentBlock => {
      const start = materialIndexes[index]!
      const end = materialIndexes[index + 1] ?? documentEnd
      const heading = nextNonBlankLine(lines, start)
      return {
        id: `material.${material.materialId}`,
        body: lines.slice((heading?.index ?? start) + 1, end).join('\n'),
        startLine: (heading?.index ?? start) + 2,
      }
    }),
  ]
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
