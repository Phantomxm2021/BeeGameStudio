import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import {
  deriveFoundationAuditArtifacts,
  foundationAuditArtifactPaths,
  foundationDerivedArtifactPaths,
  assertExactlyEightCommittedFoundationDocuments,
  loadCommittedFoundationDerivedArtifacts,
  publishFoundationDerivedArtifacts,
  publishDeterministicFoundationReview,
  loadDeterministicFoundationReview,
  publishFoundationSemanticReview,
  loadFoundationSemanticReview,
} from './foundation-audit-artifacts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { getGameDocumentContract } from './game-document-contracts'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from './foundation-semantic-audit'
import { FOUNDATION_FACT_CATALOG, FOUNDATION_FACT_CATALOG_VERSION } from './foundation-fact-definitions'

function validDocument(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): string {
  const contract = getGameDocumentContract(path)
  return `${[
    `# ${path}`,
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    '',
    'summary authority',
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      'body',
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    '',
    ...contract.productionMaterials.flatMap(material => [
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      '',
      `material ${material.materialId}`,
      '',
    ]),
  ].join('\n')}\n`
}

describe('foundation audit artifacts', () => {
  test('persists a document-scoped format issue in the deterministic registry', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-format-review-'))
    try {
      const digest = 'a'.repeat(64)
      const issue = {
        id: 'AUD-AAAAAAAAAAAAAAAAAAAAAAAA',
        severity: 'BLOCKER' as const,
        type: 'contract' as const,
        source: {
          scope: 'document' as const,
          documentPath: 'docs/GDD.md' as const,
          digest,
        },
        expected: 'canonical Foundation Markdown format',
        actual: '[MARKDOWN_FORMAT_INVALID] document title is missing',
        remediation: {
          kind: 'patch' as const,
          scope: 'document' as const,
          documentPath: 'docs/GDD.md' as const,
        },
        reasonCode: 'DOCUMENT_FORMAT_INVALID' as const,
      }
      const published = await publishDeterministicFoundationReview({
        workspacePath,
        revision: 'format-review-revision',
        documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
          path,
          digest,
        })),
        sectionIndex: [],
        factStore: [],
        issues: [issue],
      })

      expect(published.issues).toEqual([issue])
      const loaded = await loadDeterministicFoundationReview({
        workspacePath,
        revision: 'format-review-revision',
        reviewDigest: published.reviewDigest,
      })
      expect(loaded?.issues).toEqual([issue])
      const registry = JSON.parse(
        await readFile(published.paths.issueRegistry, 'utf8'),
      ) as Record<string, unknown>
      expect(registry).toMatchObject({
        revision: 'format-review-revision',
        status: 'deterministic_prefix',
        documentDigests: published.documentDigests,
        issues: [issue],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a format issue that mixes document and SectionRef scopes', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-format-review-shape-'))
    try {
      const digest = 'a'.repeat(64)
      const issue = {
        id: 'AUD-BBBBBBBBBBBBBBBBBBBBBBBB',
        severity: 'BLOCKER' as const,
        type: 'contract' as const,
        source: {
          scope: 'document' as const,
          documentPath: 'docs/GDD.md' as const,
          digest,
        },
        expected: 'canonical Foundation Markdown format',
        actual: '[MARKDOWN_FORMAT_INVALID] document title is missing',
        remediation: {
          kind: 'patch' as const,
          scope: 'section' as const,
          documentPath: 'docs/GDD.md' as const,
          sectionIds: ['vision'],
        },
        reasonCode: 'DOCUMENT_FORMAT_INVALID' as const,
      }
      await expect(
        publishDeterministicFoundationReview({
          workspacePath,
          revision: 'format-review-invalid-scope',
          documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
            path,
            digest,
          })),
          sectionIndex: [],
          factStore: [],
          issues: [issue as never],
        }),
      ).rejects.toThrow(/document remediation|classification|scope/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('fails closed when a final registry issue has invalid classification or target shape', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-final-review-corrupt-'))
    try {
      const digest = 'a'.repeat(64)
      const ledger = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => ({ checkId: check.checkId, packetIdentity: digest, admittedResultDigest: digest }))
      const issue = { id: 'AUD-AAAAAAAAAAAAAAAAAAAAAAAA', severity: 'HIGH' as const, type: 'semantic' as const, source: { documentPath: 'docs/GDD.md' as const, sectionId: 'vision', heading: 'Vision', startLine: 1, endLine: 1, digest }, expected: 'expected', actual: 'actual', remediation: { kind: 'patch' as const, scope: 'section' as const, documentPath: 'docs/GDD.md' as const, sectionIds: ['vision'] } }
      const published = await publishFoundationSemanticReview({ workspacePath, revision: 'rev', documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest })), sectionIndexDigest: digest, factStoreDigest: digest, deterministicReviewDigest: digest, semanticManifest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST, semanticResultDigests: ledger, issues: [issue] })
      const issuePath = join(workspacePath, '.beegame/audit/foundation/rev/review', published.reviewDigest, 'issue-registry.json')
      const markerPath = join(workspacePath, '.beegame/audit/foundation/rev/review', published.reviewDigest, 'COMMITTED.json')
      const corruptIssueText = `${JSON.stringify({ ...(JSON.parse(await readFile(issuePath, 'utf8')) as Record<string, unknown>), issues: [{ ...issue, severity: 'INVALID' }] }, null, 2)}\n`
      await writeFile(issuePath, corruptIssueText)
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
      marker.issueRegistryDigest = createHash('sha256').update(corruptIssueText).digest('hex')
      await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`)
      await expect(loadFoundationSemanticReview({ workspacePath, revision: 'rev', reviewDigest: published.reviewDigest })).rejects.toThrow(/classification|invalid|severity/i)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('atomically publishes and reloads one final semantic review with an exact result ledger', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-final-review-'))
    try {
      const digest = 'a'.repeat(64)
      const ledger = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => ({ checkId: check.checkId, packetIdentity: digest, admittedResultDigest: digest }))
      const published = await publishFoundationSemanticReview({ workspacePath, revision: 'rev', documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest })), sectionIndexDigest: digest, factStoreDigest: digest, deterministicReviewDigest: digest, semanticManifest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST, semanticResultDigests: ledger, issues: [] })
      const loaded = await loadFoundationSemanticReview({ workspacePath, revision: 'rev', reviewDigest: published.reviewDigest })
      expect(loaded?.reviewDigest).toBe(published.reviewDigest)
      expect(loaded?.issues).toEqual([])
      const markerPath = join(workspacePath, '.beegame/audit/foundation/rev/review', published.reviewDigest, 'COMMITTED.json')
      const originalMarker = await readFile(markerPath, 'utf8')
      const replayed = await publishFoundationSemanticReview({ workspacePath, revision: 'rev', documentDigests: [...CANONICAL_FOUNDATION_DOCUMENTS].reverse().map(path => ({ path, digest })), sectionIndexDigest: digest, factStoreDigest: digest, deterministicReviewDigest: digest, semanticManifest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST, semanticResultDigests: [...ledger].reverse(), issues: [] })
      expect(replayed.reviewDigest).toBe(published.reviewDigest)
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
      marker.semanticResultDigests = [...(marker.semanticResultDigests as unknown[]).slice(1)]
      await writeFile(markerPath, `${JSON.stringify(marker)}\n`)
      await expect(loadFoundationSemanticReview({ workspacePath, revision: 'rev', reviewDigest: published.reviewDigest })).rejects.toThrow(/binding|ledger|invalid/i)
      await writeFile(markerPath, originalMarker)
      await rm(markerPath)
      await expect(loadFoundationSemanticReview({ workspacePath, revision: 'rev', reviewDigest: published.reviewDigest })).rejects.toThrow()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
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
      const loaded = await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'revision-derived' })
      expect(loaded).toEqual(committed)
      expect(loaded?.sectionIndex).toEqual(staged.sectionIndex)
      expect(loaded?.factStore).toEqual(factStore)
      const markerPath = join(workspacePath, '.beegame/audit/foundation/revision-derived/derived/COMMITTED.json')
      const manifestPath = join(workspacePath, '.beegame/audit/foundation/revision-derived/derived/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
      expect(manifest.catalogVersion).toBe(FOUNDATION_FACT_CATALOG_VERSION)
      expect(manifest.catalogKeys).toEqual(FOUNDATION_FACT_CATALOG.map(item => item.key))
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
      await writeFile(markerPath, `${JSON.stringify({ ...marker, factStoreDigest: 'f'.repeat(64) })}\n`)
      await expect(loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'revision-derived' })).rejects.toThrow('binding')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('rejects committed derived manifests from an old or missing catalog contract', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-derived-catalog-cutover-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(workspacePath, path), validDocument(path))
      const checkpoints = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const }))
      const staged = await deriveFoundationAuditArtifacts({ workspacePath, revision: 'revision-catalog-cutover', checkpoints })
      const factStore = createFoundationFactStore([])
      await publishFoundationDerivedArtifacts({ workspacePath, revision: 'revision-catalog-cutover', documentDigests: staged.documentDigests, sectionIndex: staged.sectionIndex, factStore, normalizedFactDigest: digestFactStore(factStore), manifest: staged.manifest as unknown as Record<string, unknown> })
      const manifestPath = join(workspacePath, '.beegame/audit/foundation/revision-catalog-cutover/derived/manifest.json')
      const original = await readFile(manifestPath, 'utf8')
      await writeFile(manifestPath, `${JSON.stringify({ ...(JSON.parse(original) as Record<string, unknown>), catalogVersion: 'foundation-facts.v1' })}\n`)
      await expect(loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'revision-catalog-cutover' })).rejects.toThrow('binding')
      await writeFile(manifestPath, `${JSON.stringify((({ catalogVersion: _catalogVersion, ...rest }) => rest)(JSON.parse(original) as Record<string, unknown>))}\n`)
      await expect(loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'revision-catalog-cutover' })).rejects.toThrow('binding')
      const originalManifest = JSON.parse(original) as Record<string, unknown>
      await writeFile(manifestPath, `${JSON.stringify({ ...originalManifest, catalogKeys: (originalManifest.catalogKeys as string[]).slice(0, -1) })}\n`)
      await expect(loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'revision-catalog-cutover' })).rejects.toThrow('binding')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('does not rename an invalid temporary derived publication into authority', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-derived-invalid-temp-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const documents = new Map(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, validDocument(path)] as const))
      for (const [path, content] of documents) await writeFile(join(workspacePath, path), content)
      const checkpoints = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const }))
      const staged = await deriveFoundationAuditArtifacts({ workspacePath, revision: 'revision-invalid-temp', checkpoints })
      const factStore = createFoundationFactStore([])
      await expect(publishFoundationDerivedArtifacts({
        workspacePath,
        revision: 'revision-invalid-temp',
        documentDigests: staged.documentDigests,
        sectionIndex: staged.sectionIndex,
        factStore,
        normalizedFactDigest: 'f'.repeat(64),
        manifest: staged.manifest as unknown as Record<string, unknown>,
      })).rejects.toThrow()
      await expect(stat(foundationDerivedArtifactPaths(workspacePath, 'revision-invalid-temp').derived)).rejects.toThrow()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
})
