import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import {
  deriveFoundationAuditArtifacts,
  foundationAuditArtifactPaths,
  assertExactlyEightCommittedFoundationDocuments,
  loadCommittedFoundationDerivedArtifacts,
  publishFoundationDerivedArtifacts,
} from './foundation-audit-artifacts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { getGameDocumentContract } from './game-document-contracts'

function validDocument(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): string {
  const contract = getGameDocumentContract(path)
  return `${[
    `# ${path}`,
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      'body',
      '',
    ]),
  ].join('\n')}\n`
}

describe('foundation audit artifacts', () => {
  test('requires all eight canonical documents to have committed checkpoints', () => {
    const seven = CANONICAL_FOUNDATION_DOCUMENTS.slice(0, -1).map(path => ({
      path,
      status: 'committed' as const,
    }))
    expect(() => assertExactlyEightCommittedFoundationDocuments(seven)).toThrow(
      'exactly eight committed foundation documents',
    )
  })

  test('derives deterministic, revision-bound artifacts under the project workspace', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'foundation-audit-artifacts-'),
    )
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const documents = new Map(
        CANONICAL_FOUNDATION_DOCUMENTS.map(
          path => [path, validDocument(path)] as const,
        ),
      )
      for (const [path, content] of documents)
        await writeFile(join(workspacePath, path), content)
      const checkpoints = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
        path,
        status: 'committed' as const,
      }))
      const result = await deriveFoundationAuditArtifacts({
        workspacePath,
        revision: 'revision-1',
        checkpoints,
      })
      const paths = foundationAuditArtifactPaths(workspacePath, 'revision-1')

      expect(result.manifest.revision).toBe('revision-1')
      expect(result.documentDigests).toHaveLength(8)
      expect(paths.sectionIndex).toContain(
        join(
          workspacePath,
          '.beegame',
          'audit',
          'foundation',
          'revision-1',
          'staging',
        ),
      )
      expect(paths.sectionIndex.startsWith(workspacePath)).toBe(true)
      expect(await stat(paths.sectionIndex)).toBeTruthy()
      expect(paths.sectionIndex).toContain(`${join('foundation', 'revision-1', 'staging')}`)
      expect(Object.hasOwn(paths, 'factStore')).toBe(false)
      expect(JSON.parse(await readFile(paths.manifest, 'utf8'))).toEqual(
        result.manifest,
      )
      await writeFile(paths.manifest, '{}')
      await expect(
        deriveFoundationAuditArtifacts({
          workspacePath,
          revision: 'revision-1',
          checkpoints,
        }),
      ).rejects.toThrow('malformed')
      await writeFile(paths.manifest, `${JSON.stringify(result.manifest)}\n`)
      await writeFile(join(workspacePath, 'docs/GDD.md'), '# changed\n')
      await expect(
        deriveFoundationAuditArtifacts({
          workspacePath,
          revision: 'revision-1',
          checkpoints,
        }),
      ).rejects.toThrow('revision or digest')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects traversal revisions before constructing artifact paths', () => {
    for (const revision of ['', '.', '..', 'a/b', 'a\\b', '../escape'])
      expect(() =>
        foundationAuditArtifactPaths('/tmp/project', revision),
      ).toThrow()
  })

  test('fails closed when a revision has a partial or corrupt artifact set', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'foundation-audit-immutable-'),
    )
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
        await writeFile(join(workspacePath, path), validDocument(path))
      const checkpoints = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
        path,
        status: 'committed' as const,
      }))
      await deriveFoundationAuditArtifacts({
        workspacePath,
        revision: 'revision-immutable',
        checkpoints,
      })
      await rm(
        foundationAuditArtifactPaths(workspacePath, 'revision-immutable')
          .sectionIndex,
      )
      await expect(
        deriveFoundationAuditArtifacts({
          workspacePath,
          revision: 'revision-immutable',
          checkpoints,
        }),
      ).rejects.toThrow('partial')
      const paths = foundationAuditArtifactPaths(
        workspacePath,
        'revision-immutable',
      )
      await rm(paths.manifest)
      await expect(
        deriveFoundationAuditArtifacts({
          workspacePath,
          revision: 'revision-immutable',
          checkpoints,
        }),
      ).rejects.toThrow('missing')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('accepts only a fully bound committed derived directory', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-derived-atomic-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const documents = new Map(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, validDocument(path)] as const))
      for (const [path, content] of documents) await writeFile(join(workspacePath, path), content)
      const checkpoints = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const }))
      const staged = await deriveFoundationAuditArtifacts({ workspacePath, revision: 'revision-derived', checkpoints })
      const factStore = createFoundationFactStore([])
      const committed = await publishFoundationDerivedArtifacts({
        workspacePath,
        revision: 'revision-derived',
        documentDigests: staged.documentDigests,
        sectionIndex: staged.sectionIndex,
        factStore,
        normalizedFactDigest: digestFactStore(factStore),
        manifest: staged.manifest as unknown as Record<string, unknown>,
      })
      expect(await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'revision-derived' })).toEqual(committed)
      const markerPath = join(workspacePath, '.beegame/audit/foundation/revision-derived/derived/COMMITTED.json')
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
      await writeFile(markerPath, `${JSON.stringify({ ...marker, factStoreDigest: 'f'.repeat(64) })}\n`)
      await expect(loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'revision-derived' })).rejects.toThrow('binding')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
})
