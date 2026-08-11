import { z } from 'zod/v4'
import {
  getGameDocumentContract,
} from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

const decisionSchema = z
  .object({
    decisionId: z.string().trim().min(1),
    statement: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
  })
  .strict()

const productionDetailSchema = z
  .object({
    detailId: z.string().trim().min(1),
    statement: z.string().trim().min(1),
    owner: z.string().trim().min(1),
    acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()

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
    decisions: z.array(decisionSchema).min(1),
    productionDetails: z.array(productionDetailSchema).min(1),
    upstreamReferences: z.array(upstreamReferenceSchema),
    risks: z.array(riskSchema),
    openDecisions: z.array(openDecisionSchema),
  })
  .strict()

export const completeGameDocumentSubmissionSchema = z
  .object({
    title: z.string().trim().min(1),
    sections: z.array(completeGameDocumentSectionSchema).min(1),
  })
  .strict()

export type CompleteGameDocumentSubmission = z.infer<
  typeof completeGameDocumentSubmissionSchema
>

function assertUniqueIds(
  values: readonly string[],
  label: string,
  sectionId: string,
): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} IDs are duplicated in section ${sectionId}`)
}

export function validateCompleteGameDocumentSubmission(
  path: FoundationDocumentPath,
  value: unknown,
): CompleteGameDocumentSubmission {
  const parsed = completeGameDocumentSubmissionSchema.parse(value)
  const contract = getGameDocumentContract(path)
  const expectedSectionIds = contract.sections.map(section => section.sectionId)
  const actualSectionIds = parsed.sections.map(section => section.sectionId)
  if (
    expectedSectionIds.length !== actualSectionIds.length ||
    expectedSectionIds.some(
      (sectionId, index) => actualSectionIds[index] !== sectionId,
    )
  )
    throw new Error(
      `complete game document sections must exactly match the canonical order for ${path}`,
    )

  const allowedUpstreamPaths = new Set(contract.allowedUpstreamPaths)
  for (const section of parsed.sections) {
    assertUniqueIds(
      section.decisions.map(decision => decision.decisionId),
      'decision',
      section.sectionId,
    )
    assertUniqueIds(
      section.productionDetails.map(detail => detail.detailId),
      'production detail',
      section.sectionId,
    )
    assertUniqueIds(
      section.risks.map(risk => risk.riskId),
      'risk',
      section.sectionId,
    )
    assertUniqueIds(
      section.openDecisions.map(decision => decision.decisionId),
      'open decision',
      section.sectionId,
    )
    if (
      section.upstreamReferences.some(
        reference => !allowedUpstreamPaths.has(reference.path),
      )
    )
      throw new Error(
        `upstream authority reference is not allowed for ${path}:${section.sectionId}`,
      )
  }
  return parsed
}

const list = (values: readonly string[], empty: string): string[] =>
  values.length ? values.map(value => `- ${value}`) : [`- ${empty}`]

export function renderCompleteGameDocument(
  path: FoundationDocumentPath,
  value: CompleteGameDocumentSubmission,
): string {
  const parsed = validateCompleteGameDocumentSubmission(path, value)
  const lines: string[] = [`# ${parsed.title}`, '']
  for (const section of parsed.sections) {
    lines.push(
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      section.body,
      '',
      '### Authoritative Decisions',
      '',
      ...section.decisions.flatMap(decision => [
        `- **${decision.decisionId}** — ${decision.statement}`,
        `  - Rationale: ${decision.rationale}`,
      ]),
      '',
      '### Production Details',
      '',
      ...section.productionDetails.flatMap(detail => [
        `- **${detail.detailId}** — ${detail.statement}`,
        `  - Owner: ${detail.owner}`,
        ...detail.acceptanceCriteria.map(
          criterion => `  - Acceptance: ${criterion}`,
        ),
      ]),
      '',
      '### Upstream Authority',
      '',
      ...list(
        section.upstreamReferences.map(
          reference => `${reference.path} — ${reference.authorityId}`,
        ),
        'No upstream authority; this section is an original fact owner.',
      ),
      '',
      '### Risks',
      '',
      ...list(
        section.risks.map(
          risk =>
            `**${risk.riskId}** — ${risk.statement}; mitigation: ${risk.mitigation}; owner: ${risk.owner}`,
        ),
        'No known section-specific risks.',
      ),
      '',
      '### Open Decisions',
      '',
      ...list(
        section.openDecisions.map(
          decision =>
            `**${decision.decisionId}** — ${decision.question}; owner: ${decision.owner}; needed by: ${decision.neededBy}`,
        ),
        'No unresolved section decisions.',
      ),
      '',
    )
  }
  return `${lines.join('\n').trim()}\n`
}

export function completeGameDocumentSectionMarkers(
  path: FoundationDocumentPath,
): readonly string[] {
  return getGameDocumentContract(path).sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
}

const REQUIRED_SECTION_SUBHEADINGS = [
  '### Authoritative Decisions',
  '### Production Details',
  '### Upstream Authority',
  '### Risks',
  '### Open Decisions',
] as const

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
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('<!--') ||
      trimmed === '---'
    ) {
      flush()
      continue
    }
    current.push(trimmed)
  }
  flush()
  return blocks
}

/**
 * Validate the compact Markdown transport used by real document workers.
 * The exact structural tokens are service-owned; authored prose remains free.
 */
export function validateCompleteGameDocumentMarkdown(
  path: FoundationDocumentPath,
  value: unknown,
): string {
  const body = z.string().trim().min(1).parse(value)
  const lines = body.split('\n').map(line => line.trimEnd())
  if (!lines[0]?.startsWith('# ') || lines[0].startsWith('## '))
    throw new Error('complete game document requires one document title')

  const blocks = substantiveContentBlocks(lines)
  if (new Set(blocks).size !== blocks.length)
    throw new Error('complete game document repeats a substantive content block')

  const contract = getGameDocumentContract(path)
  const expectedMarkers = contract.sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
  const actualMarkers = lines.filter(line =>
    line.startsWith('<!-- beegame-section:'),
  )
  if (
    actualMarkers.length !== expectedMarkers.length ||
    expectedMarkers.some((marker, index) => actualMarkers[index] !== marker)
  )
    throw new Error(
      `complete game document sections must exactly match the canonical order for ${path}`,
    )

  for (const [sectionIndex, section] of contract.sections.entries()) {
    const marker = expectedMarkers[sectionIndex]!
    const start = lines.indexOf(marker)
    const end =
      sectionIndex + 1 < expectedMarkers.length
        ? lines.indexOf(expectedMarkers[sectionIndex + 1]!)
        : lines.length
    if (start < 0 || end <= start)
      throw new Error(`complete game document section is invalid: ${section.sectionId}`)
    const sectionLines = lines.slice(start + 1, end)
    if (!sectionLines.includes(`## ${section.title}`))
      throw new Error(`complete game document section title is invalid: ${section.sectionId}`)

    let previousIndex = -1
    for (const heading of REQUIRED_SECTION_SUBHEADINGS) {
      const headingIndex = sectionLines.indexOf(heading)
      if (headingIndex <= previousIndex)
        throw new Error(
          `complete game document section contract is incomplete: ${section.sectionId}`,
        )
      const nextHeadingIndex = REQUIRED_SECTION_SUBHEADINGS.slice(
        REQUIRED_SECTION_SUBHEADINGS.indexOf(heading) + 1,
      )
        .map(candidate => sectionLines.indexOf(candidate))
        .find(index => index > headingIndex)
      const contentEnd = nextHeadingIndex ?? sectionLines.length
      if (
        !sectionLines
          .slice(headingIndex + 1, contentEnd)
          .some(line => line.trim().length > 0)
      )
        throw new Error(
          `complete game document section contract is empty: ${section.sectionId}:${heading}`,
        )
      previousIndex = headingIndex
    }
  }
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
  const body = validateCompleteGameDocumentMarkdown(
    path,
    lines.slice(bodyStart).join('\n').trimStart(),
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
