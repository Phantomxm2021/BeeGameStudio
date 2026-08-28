import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'

/**
 * A frozen, Markdown-only view of the approved facts that Checklist may use.
 * It deliberately excludes executive summaries, audit appendices, and prior
 * checklist output: none of those are Checklist authority. Scenario blocks
 * retain their owner text; gate references retain only their stable identity.
 */
export async function buildChecklistAuthorityProjection(input: {
  workspacePath: string
  approvedDocumentRevision: string
}): Promise<string> {
  const documents = await Promise.all(
    CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [
      path,
      await readFile(resolve(input.workspacePath, path), 'utf8'),
    ] as const),
  )
  const blocks = documents.flatMap(([path, content]) => {
    const contract = getGameDocumentContract(path)
    const blocks = [
      ...contract.sections
        .filter(section => section.checklistMode !== 'exclude')
        .map(section => ({
          id: section.sectionId,
          title: section.title,
          mode: section.checklistMode,
        })),
      ...contract.productionMaterials
        .filter(material => material.checklistMode !== 'exclude')
        .map(material => ({
          id: `material.${material.materialId}`,
          title: material.title,
          mode: material.checklistMode,
        })),
    ]
    return blocks.map(block => ({
      path,
      ...block,
      ...(block.mode === 'scenario' ? { content: markedBlock(content, block.id) } : {}),
    }))
  })
  return [
    '# Checklist Authority Projection',
    '',
    `Approved document revision: ${input.approvedDocumentRevision}`,
    '',
    'This is the sole Checklist content authority. Scenario blocks contain approved player-observable source text. Gate references are owner checks, not text to expand. Do not infer scenarios from omitted blocks, prior checklists, or generic best practice.',
    '',
    ...blocks.flatMap(block => block.mode === 'scenario'
      ? [
          `--- BEGIN SCENARIO ${block.path}#${block.id} ---`,
          block.content,
          `--- END SCENARIO ${block.path}#${block.id} ---`,
          '',
        ]
      : [
          `--- GATE REFERENCE ${block.path}#${block.id}: ${block.title} ---`,
          '',
        ]),
  ].join('\n')
}

function markedBlock(markdown: string, id: string): string {
  const marker = id.startsWith('material.')
    ? `<!-- beegame-material:${id.slice('material.'.length)} -->`
    : `<!-- beegame-section:${id} -->`
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => line.trim() === marker)
  if (start < 0) throw new Error(`checklist authority block is missing: ${id}`)
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      /^(?:<!--\s*beegame-(?:section:[a-z0-9._-]+|production-materials|material:[a-z0-9._-]+|audit-appendix)\s*-->)$/.test(
        line.trim(),
      ),
  )
  return lines.slice(start, end < 0 ? lines.length : end).join('\n')
}
