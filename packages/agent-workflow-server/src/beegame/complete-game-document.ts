import { z } from 'zod/v4'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

const upstreamReferenceSchema = z
  .object({
    path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    authorityId: z.string().trim().min(1),
  })
  .strict()

const riskSchema = z
  .object({
    riskId: z.string().trim().min(1),
    statement: z.string().trim().min(1),
    mitigation: z.string().trim().min(1),
    owner: z.string().trim().min(1),
  })
  .strict()

const openDecisionSchema = z
  .object({
    decisionId: z.string().trim().min(1),
    question: z.string().trim().min(1),
    owner: z.string().trim().min(1),
    neededBy: z.string().trim().min(1),
  })
  .strict()

const completeGameDocumentSectionSchema = z
  .object({
    sectionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
  })
  .strict()

const productionMaterialSchema = z
  .object({
    materialId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    format: z.enum(['markdown_table', 'mermaid', 'inline_svg']),
    body: z.string().trim().min(1),
  })
  .strict()

export const completeGameDocumentSubmissionSchema = z
  .object({
    title: z.string().trim().min(1),
    executiveSummary: z.string().trim().min(1),
    sections: z.array(completeGameDocumentSectionSchema).min(1),
    productionMaterials: z.array(productionMaterialSchema).min(1),
    auditAppendix: z
      .object({
        acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
        upstreamReferences: z.array(upstreamReferenceSchema),
        risks: z.array(riskSchema),
        openDecisions: z.array(openDecisionSchema),
      })
      .strict(),
  })
  .strict()

export type CompleteGameDocumentSubmission = z.infer<
  typeof completeGameDocumentSubmissionSchema
>

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

function assertUniqueIds(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} IDs are duplicated`)
}

function assertMaterialFormat(
  format: 'markdown_table' | 'mermaid' | 'inline_svg',
  body: string,
  materialId: string,
): void {
  const lines = body.split('\n').map(line => line.trim())
  const valid =
    format === 'markdown_table'
      ? lines.filter(line => line.startsWith('|') && line.endsWith('|')).length >= 3 &&
        lines.some(line => line.includes('---'))
      : format === 'mermaid'
        ? lines.includes('```mermaid') && lines.includes('```')
        : (body.includes('<svg ') || body.includes('<svg>')) && body.includes('</svg>')
  if (!valid)
    throw new Error(`production material format is invalid: ${materialId}:${format}`)
}

export function validateCompleteGameDocumentSubmission(
  path: FoundationDocumentPath,
  value: unknown,
): CompleteGameDocumentSubmission {
  const submitted = completeGameDocumentSubmissionSchema.parse(value)
  const parsed: CompleteGameDocumentSubmission = {
    ...submitted,
    productionMaterials: submitted.productionMaterials.map(material => ({
      ...material,
      body:
        material.format === 'mermaid' &&
        !material.body.split('\n').some(line => line.trim() === '```mermaid')
          ? `\`\`\`mermaid\n${material.body.trim()}\n\`\`\``
          : material.body,
    })),
  }
  const contract = getGameDocumentContract(path)
  assertExactOrder(
    parsed.sections.map(section => section.sectionId),
    contract.sections.map(section => section.sectionId),
    'complete game document sections',
    path,
  )
  assertExactOrder(
    parsed.productionMaterials.map(material => material.materialId),
    contract.productionMaterials.map(material => material.materialId),
    'complete game document production materials',
    path,
  )

  parsed.sections.forEach((section, index) => {
    if (section.title !== contract.sections[index]?.title)
      throw new Error(`complete game document section title is invalid: ${section.sectionId}`)
  })
  parsed.productionMaterials.forEach((material, index) => {
    const expected = contract.productionMaterials[index]
    if (material.title !== expected?.title || material.format !== expected.format)
      throw new Error(`production material contract is invalid: ${material.materialId}`)
    assertMaterialFormat(material.format, material.body, material.materialId)
  })

  const allowedUpstreamPaths = new Set(contract.allowedUpstreamPaths)
  if (
    parsed.auditAppendix.upstreamReferences.some(
      reference => !allowedUpstreamPaths.has(reference.path),
    )
  )
    throw new Error(`upstream authority reference is not allowed for ${path}`)
  assertUniqueIds(
    parsed.auditAppendix.risks.map(risk => risk.riskId),
    'risk',
  )
  assertUniqueIds(
    parsed.auditAppendix.openDecisions.map(decision => decision.decisionId),
    'open decision',
  )
  return parsed
}

export function renderCompleteGameDocument(
  path: FoundationDocumentPath,
  value: CompleteGameDocumentSubmission,
): string {
  const parsed = validateCompleteGameDocumentSubmission(path, value)
  const lines: string[] = [
    `# ${parsed.title}`,
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    '',
    parsed.executiveSummary,
    '',
  ]
  for (const section of parsed.sections)
    lines.push(
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      section.body,
      '',
    )

  lines.push(
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    '',
  )
  for (const material of parsed.productionMaterials)
    lines.push(
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      '',
      material.body,
      '',
    )

  lines.push(
    '<!-- beegame-audit-appendix -->',
    '## Audit Appendix',
    '',
    '### Acceptance Criteria',
    '',
    ...parsed.auditAppendix.acceptanceCriteria.map(item => `- ${item}`),
    '',
  )
  if (parsed.auditAppendix.upstreamReferences.length)
    lines.push(
      '### Upstream Authority',
      '',
      ...parsed.auditAppendix.upstreamReferences.map(
        reference => `- ${reference.path} — ${reference.authorityId}`,
      ),
      '',
    )
  if (parsed.auditAppendix.risks.length)
    lines.push(
      '### Risks',
      '',
      ...parsed.auditAppendix.risks.map(
        risk =>
          `- **${risk.riskId}** — ${risk.statement}; mitigation: ${risk.mitigation}; owner: ${risk.owner}`,
      ),
      '',
    )
  if (parsed.auditAppendix.openDecisions.length)
    lines.push(
      '### Open Decisions',
      '',
      ...parsed.auditAppendix.openDecisions.map(
        decision =>
          `- **${decision.decisionId}** — ${decision.question}; owner: ${decision.owner}; needed by: ${decision.neededBy}`,
      ),
      '',
    )
  return `${lines.join('\n').trim()}\n`
}

export function completeGameDocumentSectionMarkers(
  path: FoundationDocumentPath,
): readonly string[] {
  return getGameDocumentContract(path).sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
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
    if (!trimmed) {
      flush()
      continue
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('<!--') || trimmed === '---') {
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

function markerIndex(lines: readonly string[], marker: string): number {
  return lines.indexOf(marker)
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

/** Validate the compact Markdown transport used by real document workers. */
export function validateCompleteGameDocumentMarkdown(
  path: FoundationDocumentPath,
  value: unknown,
): string {
  const body = z.string().trim().min(1).parse(value)
  const lines = body.split('\n').map(line => line.trimEnd())
  if (!lines[0]?.startsWith('# ') || lines[0].startsWith('## '))
    throw new Error('complete game document requires one document title')
  if (EMPTY_TEMPLATE_SENTENCES.some(sentence => body.includes(sentence)))
    throw new Error('complete game document contains an empty template sentence')

  const blocks = substantiveContentBlocks(lines)
  if (new Set(blocks).size !== blocks.length)
    throw new Error('complete game document repeats a substantive content block')

  const contract = getGameDocumentContract(path)
  const summaryMarker = '<!-- beegame-executive-summary -->'
  const productionMarker = '<!-- beegame-production-materials -->'
  const auditMarker = '<!-- beegame-audit-appendix -->'
  const sectionMarkers = contract.sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
  const materialMarkers = contract.productionMaterials.map(
    material => `<!-- beegame-material:${material.materialId} -->`,
  )
  const actualSectionMarkers = lines.filter(line => line.startsWith('<!-- beegame-section:'))
  const actualMaterialMarkers = lines.filter(line => line.startsWith('<!-- beegame-material:'))
  assertExactOrder(actualSectionMarkers, sectionMarkers, 'complete game document sections', path)
  assertExactOrder(actualMaterialMarkers, materialMarkers, 'complete game document production materials', path)

  const summaryIndex = markerIndex(lines, summaryMarker)
  const productionIndex = markerIndex(lines, productionMarker)
  const auditIndex = markerIndex(lines, auditMarker)
  const sectionIndexes = sectionMarkers.map(marker => markerIndex(lines, marker))
  const materialIndexes = materialMarkers.map(marker => markerIndex(lines, marker))
  const orderedIndexes = [summaryIndex, ...sectionIndexes, productionIndex, ...materialIndexes, auditIndex]
  if (orderedIndexes.some(index => index < 0) || orderedIndexes.some((index, offset) => offset > 0 && index <= orderedIndexes[offset - 1]!))
    throw new Error(`complete game document structure must exactly match the canonical order for ${path}`)

  if (lines[summaryIndex + 1] !== '## Executive Summary')
    throw new Error('complete game document executive summary heading is invalid')
  assertNonEmptyRange(lines, summaryIndex + 1, sectionIndexes[0]!, 'executive summary')

  contract.sections.forEach((section, index) => {
    const start = sectionIndexes[index]!
    const end = sectionIndexes[index + 1] ?? productionIndex
    if (lines[start + 1] !== `## ${section.title}`)
      throw new Error(`complete game document section title is invalid: ${section.sectionId}`)
    assertNonEmptyRange(lines, start + 1, end, `section:${section.sectionId}`)
  })

  if (lines[productionIndex + 1] !== '## Production Materials')
    throw new Error('complete game document production materials heading is invalid')
  contract.productionMaterials.forEach((material, index) => {
    const start = materialIndexes[index]!
    const end = materialIndexes[index + 1] ?? auditIndex
    if (lines[start + 1] !== `### ${material.title}`)
      throw new Error(`production material title is invalid: ${material.materialId}`)
    const materialBody = lines.slice(start + 2, end).join('\n').trim()
    assertMaterialFormat(material.format, materialBody, material.materialId)
  })

  if (lines[auditIndex + 1] !== '## Audit Appendix')
    throw new Error('complete game document audit appendix heading is invalid')
  const acceptanceIndex = lines.indexOf('### Acceptance Criteria', auditIndex + 1)
  const acceptanceLines = lines.slice(acceptanceIndex + 1)
  const hasAcceptanceList = acceptanceLines.some(line =>
    line.trim().startsWith('- '),
  )
  const acceptanceTableLines = acceptanceLines.filter(line => {
    const trimmed = line.trim()
    return trimmed.startsWith('|') && trimmed.endsWith('|')
  })
  const hasAcceptanceTable =
    acceptanceTableLines.length >= 3 &&
    acceptanceTableLines.some(line => line.includes('---'))
  if (
    acceptanceIndex < auditIndex ||
    (!hasAcceptanceList && !hasAcceptanceTable)
  )
    throw new Error('complete game document acceptance criteria are empty or invalid')
  return `${body}\n`
}

export function canonicalizeCompleteGameDocumentMarkdown(
  path: FoundationDocumentPath,
  value: unknown,
  metadata: { version: string; updatedAt: string },
): string {
  const authored = z.string().trim().min(1).parse(value)
  const lines = authored.split('\n')
  const bodyStart =
    lines[0]?.trim() === '---'
      ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') + 1
      : 0
  if (bodyStart === 0 && lines[0]?.trim() === '---')
    throw new Error('complete game document front matter is incomplete')
  const bodyLines = lines.slice(bodyStart)
  const contract = getGameDocumentContract(path)
  const canonicalMarkers = new Map<string, string>([
    ...contract.sections.map(
      section =>
        [
          `beegame-section:${section.sectionId}`,
          `<!-- beegame-section:${section.sectionId} -->`,
        ] as const,
    ),
    ...contract.productionMaterials.map(
      material =>
        [
          `beegame-material:${material.materialId}`,
          `<!-- beegame-material:${material.materialId} -->`,
        ] as const,
    ),
  ])
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index]!.trim()
    if (!line.startsWith('<!--') || !line.endsWith('-->')) continue
    const inner = line.slice('<!--'.length, -'-->'.length).trim()
    const separator = inner.indexOf(':')
    if (separator < 0) continue
    const key = `${inner.slice(0, separator).trim()}:${inner
      .slice(separator + 1)
      .trim()}`
    const canonical = canonicalMarkers.get(key)
    if (canonical) bodyLines[index] = canonical
  }
  const normalizeMarkerHeading = (
    marker: string,
    heading: string,
    acceptLocalizedHeading = false,
  ) => {
    const markerIndex = bodyLines.findIndex(line => line.trim() === marker)
    if (markerIndex < 0) return
    const headingIndex = bodyLines.findIndex(
      (line, index) => index > markerIndex && line.trim().length > 0,
    )
    if (headingIndex <= markerIndex) return
    const authoredHeading = bodyLines[headingIndex]!.trim()
    if (authoredHeading !== heading && !(acceptLocalizedHeading && authoredHeading.startsWith('## ')))
      return
    bodyLines.splice(markerIndex + 1, headingIndex - markerIndex, heading)
  }
  for (const [marker, heading] of [
    ['<!-- beegame-executive-summary -->', '## Executive Summary'],
    ['<!-- beegame-production-materials -->', '## Production Materials'],
    ['<!-- beegame-audit-appendix -->', '## Audit Appendix'],
  ] as const) {
    normalizeMarkerHeading(marker, heading, true)
  }
  for (const section of contract.sections)
    normalizeMarkerHeading(
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
    )
  for (const material of contract.productionMaterials)
    normalizeMarkerHeading(
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
    )
  const body = validateCompleteGameDocumentMarkdown(
    path,
    bodyLines.join('\n').trimStart(),
  )
  const documentId = CANONICAL_PROJECT_DOCUMENT_IDS[path]
  return [
    '---',
    `document_id: ${documentId}`,
    `version: ${metadata.version}`,
    `updated_at: ${metadata.updatedAt}`,
    '---',
    body.trimEnd(),
    '',
  ].join('\n')
}
