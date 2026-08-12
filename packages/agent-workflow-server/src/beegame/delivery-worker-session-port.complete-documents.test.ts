import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCanonicalDocumentCommitContract,
  buildDocumentAuthorAuthorityBlock,
} from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  authoritySidecarPath,
  canonicalFoundationAuthoritySidecarBytes,
  createFoundationAuthoritySidecar,
} from './foundation-authority-sidecar'
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

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

async function writeAuthoritySource(
  workspacePath: string,
  path: FoundationDocumentPath,
): Promise<void> {
  const markdown = canonicalSource(
    path as 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md',
  )
  await writeFile(join(workspacePath, path), markdown)
  const prefix = path.slice('docs/'.length, -'.md'.length).toLowerCase()
  const sidecar = createFoundationAuthoritySidecar({
    documentPath: path,
    markdown,
    submission: {
      records: getGameDocumentContract(path)
        .sections.map(section => ({
          authorityId: `${prefix}.${section.sectionId}.primary`,
          sectionId: section.sectionId,
          kind: 'fact' as const,
          state: 'confirmed' as const,
          source: 'confirmed_brief' as const,
          evidenceRefs: [],
          statement: `Confirmed authority for ${section.sectionId}.`,
          responsibilityIds: [...section.responsibilityIds].sort(bytewise),
        }))
        .sort((left, right) => bytewise(left.authorityId, right.authorityId)),
    },
  })
  await writeFile(
    join(workspacePath, authoritySidecarPath(path)),
    canonicalFoundationAuthoritySidecarBytes(sidecar),
  )
}

describe('delivery worker complete document commit contract', () => {
  test('requires structured complete submissions for initial Foundation authors', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'complete-doc-contract-'),
    )
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
      expect(block).toContain('two or three consecutive parts')
      expect(block).toContain('one CommitCanonicalDocument call')
      expect(block).toContain('top-level parts array')
      expect(block).toContain(
        'Never issue multiple CommitCanonicalDocument calls in parallel',
      )
      expect(block).toContain('body content only, without any Markdown heading')
      expect(block).toContain('document_parts_prepared')
      expect(block).toContain(
        'Every audit decisionId must be the full future authorityId',
      )
      expect(block).toContain('at least one record per contracted section')
      expect(block).toContain('Do not hand-author')
      expect(block).toContain('write or edit the assigned path directly')
      expect(block).not.toContain('document_prepared')
      expect(block).toContain('Read the compact authority projection')
      expect(block).toContain('CommitCanonicalDocument')
      expect(block).toContain('submit two or three consecutive parts')
      expect(block).toContain('make one authority call')
      expect(block).not.toContain('Submit the complete Markdown body first')
      expect(block).toContain(
        'Read only the listed source sections when deeper rationale',
      )
      expect(block).toContain(
        '.beegame/workflow/authority-projections/dispatch-ui-authority.json',
      )
      const projected = JSON.parse(
        await readFile(
          join(
            workspacePath,
            '.beegame/workflow/authority-projections/dispatch-ui-authority.json',
          ),
          'utf8',
        ),
      )
      expect(projected.targetPath).toBe('docs/UI_UX_SPEC.md')
      expect(projected.records.length).toBeGreaterThan(0)
      expect(block).not.toContain('Authority content for')
      expect(block).not.toContain('Confirmed authority for')
      expect(block).not.toContain('Unprojected production material payload.')
      expect(block).not.toContain('STALE TARGET BODY')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
