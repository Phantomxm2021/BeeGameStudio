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
  test('projects the accepted nested remediation report into the repair turn', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'repair-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await mkdir(
        join(workspacePath, '.beegame/reviews/foundation/revision'),
        { recursive: true },
      )
      await writeFile(join(workspacePath, 'docs/GDD.md'), '# Current GDD\n')
      await writeFile(
        join(
          workspacePath,
          '.beegame/reviews/foundation/revision/review.md',
        ),
        '# Accepted review\n\nRepair the owned findings.\n',
      )

      const block = await buildDocumentAuthorAuthorityBlock({
        dispatchId: 'dispatch-remediation-authority',
        runId: 'run-remediation-authority',
        workerType: 'document-author',
        workspacePath,
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'remediation',
          documentSet: 'foundation',
          foundationDocumentPath: 'docs/GDD.md',
          remediation: {
            reviewReportPath:
              '.beegame/reviews/foundation/revision/review.md',
            affectedPaths: ['docs/GDD.md'],
            sourceRevision: 'revision',
          },
        },
      } as never)

      expect(block).toContain('BEGIN ACCEPTED REVIEW REPORT')
      expect(block).toContain('Repair the owned findings.')
      expect(block).toContain('BEGIN CANONICAL REPAIR TARGET')
      expect(block).toContain('# Current GDD')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('persists only the exact selected upstream authority as complete input', async () => {
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
      expect(block).not.toContain(
        'Write the complete assigned Markdown document directly',
      )
      expect(block).toContain('complete selected upstream authority')
      expect(block).toContain('BEGIN FOUNDATION AUTHORITY')
      expect(block).not.toContain('complete when the turn ends')
      expect(block).not.toContain('file-operation sequence')
      expect(block).not.toContain('completeDocumentContract')
      expect(block).not.toContain('CommitCanonicalDocument')
      expect(block).not.toContain('document_parts_prepared')
      expect(block).not.toContain('write or edit the assigned path directly')
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
            content?: unknown
            digest?: unknown
          }>
        }) =>
          source.sections?.every(
            section =>
              typeof section.sectionId === 'string' &&
              Number.isInteger(section.startLine) &&
              Number(section.startLine) > 0 &&
              Number.isInteger(section.lineCount) &&
              Number(section.lineCount) > 0 &&
              typeof section.content === 'string' &&
              section.content.includes(
                `Authority content for ${String(section.sectionId)}.`,
              ) &&
              typeof section.digest === 'string' &&
              /^[a-f0-9]{64}$/.test(section.digest),
          ),
        ),
      ).toBe(true)
      expect(projected.sources[0]).not.toHaveProperty('sectionIds')
      expect(projected).not.toHaveProperty('records')
      expect(projected.sources[0].sections[0]).not.toHaveProperty('contentLines')
      expect(block).toContain('Authority content for')
      expect(block).not.toContain('Confirmed authority for')
      expect(block).not.toContain('Unprojected production material payload.')
      expect(block).not.toContain('STALE TARGET BODY')
      expect(block).not.toContain('remaining bounded checkpoint sequence')
      expect(block).not.toContain('do not perform a separate target read')
      expect(block).not.toContain('Follow that sequence')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
