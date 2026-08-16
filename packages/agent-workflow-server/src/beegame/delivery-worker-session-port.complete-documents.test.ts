import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
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
  test('projects the accepted conflict list and every coordinated repair target', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'repair-authority-'))
    try {
      const revision = 'a'.repeat(64)
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await mkdir(
        join(workspacePath, '.beegame/reviews/foundation', revision),
        { recursive: true },
      )
      await writeFile(join(workspacePath, 'docs/GDD.md'), '# Current GDD\n')
      await writeFile(
        join(workspacePath, 'docs/TECHNICAL_DESIGN.md'),
        '# Current Technical Design\n',
      )
      const reviewPath = `.beegame/reviews/foundation/${revision}/review.json`
      const reviewBytes = `${JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'NEEDS_REVISION',
        priorConflictStatus: [],
        conflicts: [
          {
            id: 'B1',
            title: 'Runtime authority disagrees',
            problem: 'Gameplay and runtime name incompatible states.',
            evidence: [
              {
                path: 'docs/GDD.md',
                location: 'Runtime state',
                observed: 'The GDD names state A.',
              },
            ],
            requiredOutcome: 'Both documents use one runtime state.',
            changes: [
              { path: 'docs/GDD.md', action: 'Use canonical state B.' },
              {
                path: 'docs/TECHNICAL_DESIGN.md',
                action: 'Implement canonical state B.',
              },
            ],
            acceptance: ['Both documents use state B.'],
          },
        ],
      })}\n`
      const reviewDigest = createHash('sha256').update(reviewBytes).digest('hex')
      await writeFile(join(workspacePath, reviewPath), reviewBytes)

      const block = await buildDocumentAuthorAuthorityBlock({
        dispatchId: 'dispatch-remediation-authority',
        runId: 'run-remediation-authority',
        workerType: 'document-author',
        workspacePath,
        allowedPaths: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
        contract: {
          authoringMode: 'remediation',
          documentSet: 'foundation',
          remediation: {
            reviewPath,
            reviewDigest,
            affectedPaths: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
            sourceRevision: revision,
          },
        },
      } as never)

      expect(block).toContain('BEGIN ACCEPTED FOUNDATION REVIEW JSON')
      expect(block).toContain('Runtime authority disagrees')
      expect(block).toContain('BEGIN CANONICAL REPAIR TARGET')
      expect(block).toContain('# Current GDD')
      expect(block).toContain('# Current Technical Design')
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
