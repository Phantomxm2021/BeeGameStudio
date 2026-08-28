import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildChecklistAuthorityProjection } from './checklist-authority-projection'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true })))
})

test('projects only Checklist-relevant owner blocks, never a prior checklist baseline', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'checklist-projection-'))
  workspaces.push(workspacePath)
  await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => {
    const contract = getGameDocumentContract(path)
    const body = [
      '# Document',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      'summary must not project',
      ...contract.sections.flatMap(section => [
        `<!-- beegame-section:${section.sectionId} -->`,
        `## ${section.title}`,
        `${section.checklistRelevant ? 'relevant' : 'omitted'} ${section.sectionId}`,
      ]),
      '<!-- beegame-production-materials -->',
      '## Production Materials',
      ...contract.productionMaterials.flatMap(material => [
        `<!-- beegame-material:${material.materialId} -->`,
        `### ${material.title}`,
        `${material.checklistRelevant ? 'relevant' : 'omitted'} ${material.materialId}`,
      ]),
      '<!-- beegame-audit-appendix -->',
      '## Audit Appendix',
      'audit must not project',
    ].join('\n')
    await mkdir(join(workspacePath, path, '..'), { recursive: true })
    await writeFile(join(workspacePath, path), body)
  }))

  const projection = await buildChecklistAuthorityProjection({
    workspacePath,
    approvedDocumentRevision: 'revision-1',
  })

  expect(projection).toContain('Approved document revision: revision-1')
  expect(projection).toContain('relevant core_loop')
  expect(projection).toContain('relevant variable-parameter-table')
  expect(projection).not.toContain('summary must not project')
  expect(projection).not.toContain('audit must not project')
  expect(projection).not.toContain('omitted product_vision')
})
