import { z } from 'zod/v4'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

const MARKDOWN_DOCUMENT_REFERENCE = /docs\/[A-Za-z0-9._/-]+\.md/g

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
  sections: readonly { sectionId: string; body: string }[],
): void {
  for (const section of sections) {
    const seen = new Set<string>()
    let priorLevel = 2
    for (const heading of authoredHeadings(section.body)) {
      if (heading.level < 3 || heading.level > 4)
        throw new Error(
          `section heading level is invalid: ${section.sectionId}:H${heading.level}`,
        )
      if (heading.level > priorLevel + 1)
        throw new Error(
          `section heading level is skipped: ${section.sectionId}:H${heading.level}`,
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
  const valid =
    format === 'markdown_table' || format === 'evidence_register'
      ? lines.filter(line => line.startsWith('|') && line.endsWith('|')).length >= 3 &&
        lines.some(line => line.includes('---'))
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
  const actualH3 = scan.headings
    .filter(heading => heading.level === 3)
    .map(heading => heading.text)
  if (
    !exactSequence(actualH2, expectedH2) ||
    !exactSequence(actualH3, expectedH3)
  )
    return false
  const productionHeading = scan.headings.find(
    heading => heading.level === 2 && heading.text === 'Production Materials',
  )
  const materialHeadings = scan.headings.filter(heading => heading.level === 3)
  if (
    !productionHeading ||
    materialHeadings.some(heading => heading.lineIndex <= productionHeading.lineIndex)
  )
    return false
  const lines = body.split('\n')
  try {
    for (const [index, material] of contract.productionMaterials.entries()) {
      const heading = materialHeadings[index]
      if (!heading) return false
      const nextHeading = materialHeadings[index + 1]
      const materialBody = lines
        .slice(heading.lineIndex + 1, nextHeading?.lineIndex ?? lines.length)
        .join('\n')
      assertMaterialFormat(material.format, materialBody, material.materialId)
    }
  } catch {
    return false
  }
  return true
}

function exactSequence(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    expected.every((heading, index) => actual[index] === heading)
  )
}

const BALANCE_INLINE_CODE = /(?<!`)`([^`\n]+)`(?!`)/g
const BALANCE_SYMBOLIC_REFERENCE_PATTERN = '(?:[A-Z]\\d+[A-Z]?|[A-Z][A-Z0-9]*(?:[_-][A-Z0-9*]+)+|[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*\\.(?:[a-z][a-z0-9_]*|\\*))'
const BALANCE_SYMBOLIC_REFERENCE_TOKEN = `(?<![A-Za-z0-9_])${BALANCE_SYMBOLIC_REFERENCE_PATTERN}(?![A-Za-z0-9_*])`
const BALANCE_SYMBOLIC_REFERENCE = new RegExp(BALANCE_SYMBOLIC_REFERENCE_TOKEN, 'g')
const BALANCE_MERMAID_FENCE = /```mermaid[^\n]*\n([\s\S]*?)```/g
const BALANCE_MERMAID_EDGE_LABEL = /(?:[-=.~]+>)\|([^|\n]+)\|/g
const BALANCE_MERMAID_NODE_DECLARATION = /(^|\s)([A-Za-z][A-Za-z0-9_.-]*)\s*\[([^\]\n]*)\]/gm
const BALANCE_MERMAID_NODE_REFERENCE = /(^|\s)([A-Z]\d+)(?=\s*(?:\[|[-=.~]+>|$))/gm
const BALANCE_RANGE = /\b[A-Za-z_]*\d[A-Za-z0-9_]*\s*[–—-]\s*[A-Za-z_]*\d[A-Za-z0-9_]*\b/
const BALANCE_FORMULA_CALL = /\b[A-Za-z_][A-Za-z0-9_]*\s*\([^()\n]*\)/
const BALANCE_SYMBOLIC_EXPRESSION = new RegExp(
  `${BALANCE_SYMBOLIC_REFERENCE_TOKEN}\\s*(?:[+*/×÷−=<>≤≥^]|!=|==|<=|>=)\\s*${BALANCE_SYMBOLIC_REFERENCE_TOKEN}|${BALANCE_SYMBOLIC_REFERENCE_TOKEN}\\s+-\\s+${BALANCE_SYMBOLIC_REFERENCE_TOKEN}`,
)
const BALANCE_NUMERIC_LITERAL = /(?<![A-Za-z_])(?:\d+(?:\.\d+)?|\.\d+)(?:\s*%)?(?![A-Za-z_])/u

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectBalanceOwnerReferences(
  body: string,
  references: Set<string>,
): void {
  BALANCE_SYMBOLIC_REFERENCE.lastIndex = 0
  for (const match of body.matchAll(BALANCE_SYMBOLIC_REFERENCE)) {
    const reference = match[0]!
    references.add(reference)
    const parts = reference.split(/([_-])/)
    for (let index = 1; index < parts.length - 1; index += 2)
      references.add(`${parts.slice(0, index + 1).join('')}*`)
    const dottedParts = reference.split('.')
    for (let index = 1; index < dottedParts.length; index += 1)
      references.add(`${dottedParts.slice(0, index).join('.')}.*`)
  }
  BALANCE_SYMBOLIC_REFERENCE.lastIndex = 0
}

function stripAllowedMermaidReferenceLists(
  body: string,
  allowedReferences: ReadonlySet<string>,
): string {
  BALANCE_MERMAID_FENCE.lastIndex = 0
  return body.replace(BALANCE_MERMAID_FENCE, (fence: string) => {
    BALANCE_MERMAID_EDGE_LABEL.lastIndex = 0
    const withoutReferenceLists = fence.replace(BALANCE_MERMAID_EDGE_LABEL, (label: string, references: string) => {
      const listedReferences = references
        .trim()
        .split(/\s*(?:\/|,|、)\s*/)
      if (
        listedReferences.length > 0 &&
        listedReferences.every((reference: string) => allowedReferences.has(reference))
      )
        return label.replace(references, ' '.repeat(references.length))
      return label
    })
    BALANCE_MERMAID_NODE_REFERENCE.lastIndex = 0
    return withoutReferenceLists.replace(BALANCE_MERMAID_NODE_REFERENCE, '$1 ')
  })
}

function assertNoMermaidOwnerAliases(
  body: string,
  materialId: string,
  allowedReferences: ReadonlySet<string>,
): void {
  BALANCE_MERMAID_FENCE.lastIndex = 0
  body.replace(BALANCE_MERMAID_FENCE, (_fence: string, mermaidBody: string) => {
    BALANCE_MERMAID_NODE_DECLARATION.lastIndex = 0
    for (const match of mermaidBody.matchAll(BALANCE_MERMAID_NODE_DECLARATION)) {
      const nodeId = match[2]!.trim()
      const label = match[3]!.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
      if (!allowedReferences.has(nodeId) && allowedReferences.has(label))
        throw new Error(`Balance reference-only material contains undeclared Mermaid node alias: ${materialId}`)
    }
    return _fence
  })
}

function assertBalanceReferenceOnlyMaterial(
  body: string,
  materialId: string,
  materialTitle: string,
  structuralReferences: ReadonlySet<string>,
): void {
  const allowedReferences = new Set([
    ...structuralReferences,
    materialId,
    materialTitle,
  ])
  assertNoMermaidOwnerAliases(body, materialId, allowedReferences)
  for (const match of body.matchAll(BALANCE_INLINE_CODE)) {
    const code = match[1]!.trim()
    if (allowedReferences.has(code))
      continue
    throw new Error(`Balance reference-only material contains non-reference inline code: ${materialId}`)
  }

  const formulaScanBody = stripAllowedMermaidReferenceLists(body, allowedReferences)
  if (BALANCE_FORMULA_CALL.test(formulaScanBody))
    throw new Error(`Balance reference-only material contains a complete formula expression: ${materialId}`)
  if (BALANCE_SYMBOLIC_EXPRESSION.test(formulaScanBody))
    throw new Error(`Balance reference-only material contains a complete formula expression: ${materialId}`)
  if (BALANCE_RANGE.test(body))
    throw new Error(`Balance reference-only material contains a copied range: ${materialId}`)

  const structuralReferencePattern = [...new Set([
    ...structuralReferences,
    materialId,
    materialTitle,
  ])]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')
  const structuralReferenceToken = new RegExp(
    `(?<![A-Za-z0-9_])(?:${structuralReferencePattern})(?![A-Za-z0-9_*])`,
    'g',
  )
  const withoutReferences = stripAllowedMermaidReferenceLists(body, allowedReferences)
    .replace(structuralReferenceToken, ' ')
  if (BALANCE_NUMERIC_LITERAL.test(withoutReferences))
    throw new Error(`Balance reference-only material contains a copied numeric literal: ${materialId}`)
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
  const balanceStructuralReferences =
    path === 'docs/BALANCE_DESIGN.md'
      ? new Set<string>([
          ...CANONICAL_FOUNDATION_DOCUMENTS,
          ...contract.sections.flatMap(section => [
            section.title,
            `## ${section.title}`,
          ]),
          ...contract.productionMaterials
            .filter(material => material.authorityMode === 'owner')
            .flatMap(material => [material.materialId, material.title]),
        ])
      : undefined
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
    if (balanceStructuralReferences)
      collectBalanceOwnerReferences(
        lines.slice(heading.index + 1, end).join('\n'),
        balanceStructuralReferences,
      )
  })
  validateSectionHeadingStructure(
    contract.sections.map((section, index) => {
      const start = sectionIndexes[index]!
      const end = sectionIndexes[index + 1] ?? productionIndex
      const heading = nextNonBlankLine(lines, start)
      return {
        sectionId: section.sectionId,
        body: lines.slice((heading?.index ?? start) + 1, end).join('\n'),
      }
    }),
  )

  if (nextNonBlankLine(lines, productionIndex)?.value !== '## Production Materials')
    throw new Error('complete game document production materials heading is invalid')
  contract.productionMaterials.forEach((material, index) => {
    const start = materialIndexes[index]!
    const end = materialIndexes[index + 1] ?? documentEnd
    const heading = nextNonBlankLine(lines, start)
    if (heading?.value !== `### ${material.title}`)
      throw new Error(`production material title is invalid: ${material.materialId}`)
    const materialBody = lines.slice(heading.index + 1, end).join('\n').trim()
    assertMaterialFormat(
      material.format,
      materialBody,
      material.materialId,
    )
    if (path === 'docs/BALANCE_DESIGN.md' && material.authorityMode === 'reference_only')
      assertBalanceReferenceOnlyMaterial(
        materialBody,
        material.materialId,
        material.title,
        balanceStructuralReferences!,
      )
    if (balanceStructuralReferences && material.authorityMode === 'owner')
      collectBalanceOwnerReferences(materialBody, balanceStructuralReferences)
  })

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
