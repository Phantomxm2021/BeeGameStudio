import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDocumentAuthorAuthorityBlock,
} from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

function canonicalSource(
  path: 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md',
): string {
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

async function writeAuthoritySource(
  workspacePath: string,
  path: FoundationDocumentPath,
): Promise<void> {
  const markdown = canonicalSource(
    path as 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md',
  )
  await writeFile(join(workspacePath, path), markdown)
}

describe('delivery worker complete document boundary', () => {
  test('projects document authority as paths and section ids without source bodies', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'focused-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeAuthoritySource(workspacePath, 'docs/GDD.md')
      await writeAuthoritySource(workspacePath, 'docs/LEVEL_SCENE_DESIGN.md')
      await writeFile(
        join(workspacePath, 'docs/UI_UX_SPEC.md'),
        '# Stale target\n\nSTALE TARGET BODY',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        dispatchId: 'dispatch-ui-authority',
        runId: 'run-ui-authority',
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
      const projection =
        getGameDocumentContract('docs/UI_UX_SPEC.md').upstreamSections
      for (const source of projection)
        for (const sectionId of source.sectionIds) {
          expect(block).toContain(`upstreamPath=${source.path}`)
          expect(block).toContain(`sectionId=${sectionId}`)
        }
      expect(block).not.toContain(
        'Write the complete assigned Markdown document directly',
      )
      expect(block).toContain(
        'The assigned Markdown file must be complete when the turn ends',
      )
      expect(block).toContain(
        'The native runtime owns the file-operation sequence',
      )
      expect(block).toContain('Bee Game Studio')
      expect(block).toContain('workflow service only validates')
      expect(block).toContain('Read the compact document projection')
      expect(block).toContain('file itself is the sole authority')
      expect(block).not.toContain('CommitCanonicalDocument')
      expect(block).not.toContain('document_parts_prepared')
      expect(block).not.toContain('write or edit the assigned path directly')
      expect(block).toContain(
        'Read only the listed source sections when deeper rationale',
      )
      expect(block).toContain(
        '.beegame/workflow/document-projections/dispatch-ui-authority.json',
      )
      const projected = JSON.parse(
        await readFile(
          join(
            workspacePath,
            '.beegame/workflow/document-projections/dispatch-ui-authority.json',
          ),
          'utf8',
        ),
      )
      expect(projected.targetPath).toBe('docs/UI_UX_SPEC.md')
      expect(projected.sources.length).toBeGreaterThan(0)
      expect(
        projected.sources.every((source: {
          sections?: Array<{
            sectionId?: unknown
            startLine?: unknown
            lineCount?: unknown
          }>
        }) =>
          source.sections?.every(
            section =>
              typeof section.sectionId === 'string' &&
              Number.isInteger(section.startLine) &&
              Number(section.startLine) > 0 &&
              Number.isInteger(section.lineCount) &&
              Number(section.lineCount) > 0,
          ),
        ),
      ).toBe(true)
      expect(projected.sources[0]).not.toHaveProperty('sectionIds')
      expect(projected).not.toHaveProperty('records')
      expect(block).not.toContain('Authority content for')
      expect(block).not.toContain('Confirmed authority for')
      expect(block).not.toContain('Unprojected production material payload.')
      expect(block).not.toContain('STALE TARGET BODY')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
