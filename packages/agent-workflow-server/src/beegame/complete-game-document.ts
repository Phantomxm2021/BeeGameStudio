import { z } from 'zod/v4'
import {
  getGameDocumentContract,
} from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
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
