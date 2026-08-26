import { z } from 'zod/v4'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'
import type { GameDocumentContract } from './delivery-workflow/game-document-contracts'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

const blockBody = z.string().trim().min(1)

function exactBlocks(ids: readonly string[], label: string) {
  return z
    .object(
      Object.fromEntries(ids.map(id => [id, blockBody])) as Record<
        string,
        typeof blockBody
      >,
    )
    .strict()
    .superRefine((value, context) => {
      const actual = Object.keys(value)
      if (actual.length !== ids.length || actual.some(id => !ids.includes(id)))
        context.addIssue({
          code: 'custom',
          message: `${label} IDs must exactly cover the contract`,
        })
    })
}

export function foundationDocumentAuthorPayloadSchema(
  path: FoundationDocumentPath,
) {
  const contract = getGameDocumentContract(path)
  const sections = exactBlocks(
    contract.sections.map(section => section.sectionId),
    'section',
  )
  const materials = exactBlocks(
    contract.productionMaterials.map(material => material.materialId),
    'material',
  )
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1)
        .refine(value => !/[\r\n#]/.test(value), {
          message: 'document title must be plain one-line text',
        }),
      executiveSummary: blockBody,
      sections,
      materials,
    })
    .strict()
}

export type FoundationDocumentAuthorPayload = ReturnType<
  typeof foundationDocumentAuthorPayloadSchema
>['_output']

export function buildFoundationDocumentAuthorStructuredOutputJsonSchema(
  contract: GameDocumentContract,
): Record<string, unknown> {
  const sectionIds = contract.sections.map(section => section.sectionId)
  const materialIds = contract.productionMaterials.map(material => material.materialId)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1, pattern: '^[^#\\r\\n]*\\S[^#\\r\\n]*$' },
      executiveSummary: { type: 'string', minLength: 1, pattern: '\\S' },
      sections: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          sectionIds.map(id => [id, { type: 'string', minLength: 1, pattern: '\\S' }]),
        ),
        required: sectionIds,
      },
      materials: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          materialIds.map(id => [id, { type: 'string', minLength: 1, pattern: '\\S' }]),
        ),
        required: materialIds,
      },
    },
    required: ['title', 'executiveSummary', 'sections', 'materials'],
  }
}

export function assembleFoundationDocumentMarkdown(
  path: FoundationDocumentPath,
  value: unknown,
): string {
  const contract = getGameDocumentContract(path)
  const payload = foundationDocumentAuthorPayloadSchema(path).parse(value)
  const lines = [
    `# ${payload.title}`,
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    payload.executiveSummary,
    '',
  ]
  for (const section of contract.sections) {
    lines.push(
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      payload.sections[section.sectionId]!,
      '',
    )
  }
  lines.push('<!-- beegame-production-materials -->', '## Production Materials', '')
  for (const material of contract.productionMaterials) {
    lines.push(
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      payload.materials[material.materialId]!,
      '',
    )
  }
  const markdown = `${lines.join('\n').trimEnd()}\n`
  return validateCompleteGameDocumentMarkdown(path, markdown)
}
