import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCanonicalDocumentCommitContract,
  buildDocumentAuthorAuthorityBlock,
} from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'

function canonicalSource(path: 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md'): string {
  const contract = getGameDocumentContract(path)
  return [
    `# ${contract.discipline}`,
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Authority content for ${section.sectionId}.`,
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    'Unprojected production material payload.',
  ].join('\n')
}

describe('delivery worker complete document commit contract', () => {
  test('requires structured complete submissions for initial Foundation authors', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'complete-doc-contract-'))
    try {
      const contract = await buildCanonicalDocumentCommitContract(
        {
          workerType: 'document-author',
          workspacePath,
          allowedPaths: ['docs/GDD.md'],
          contract: {
            authoringMode: 'initial',
            documentSet: 'foundation',
            foundationDocumentPath: 'docs/GDD.md',
          },
        } as never,
        'dispatch-complete-document',
      )
      expect(contract).toMatchObject({
        targetPath: 'docs/GDD.md',
        submissionKind: 'complete_game_document',
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('projects document authority as paths and section ids without source bodies', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'focused-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), canonicalSource('docs/GDD.md'))
      await writeFile(
        join(workspacePath, 'docs/LEVEL_SCENE_DESIGN.md'),
        canonicalSource('docs/LEVEL_SCENE_DESIGN.md'),
      )
      await writeFile(
        join(workspacePath, 'docs/UI_UX_SPEC.md'),
        '# Stale target\n\nSTALE TARGET BODY',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        workerType: 'document-author',
        workspacePath,
        allowedPaths: ['docs/UI_UX_SPEC.md'],
        contract: {
          authoringMode: 'initial',
          documentSet: 'foundation',
          foundationDocumentPath: 'docs/UI_UX_SPEC.md',
          upstreamDocumentPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
        },
      } as never)
      const projection = getGameDocumentContract('docs/UI_UX_SPEC.md').upstreamSections
      for (const source of projection)
        for (const sectionId of source.sectionIds) {
          expect(block).toContain(`upstreamPath=${source.path}`)
          expect(block).toContain(`sectionId=${sectionId}`)
        }
      expect(block).toContain('Read only the listed sections from disk when needed')
      expect(block).not.toContain('Authority content for')
      expect(block).not.toContain('Unprojected production material payload.')
      expect(block).not.toContain('STALE TARGET BODY')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
