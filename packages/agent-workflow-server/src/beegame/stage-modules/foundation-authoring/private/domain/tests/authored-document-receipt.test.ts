import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  commitAuthoredFoundationDocument,
  readAuthoredDocumentReceipt,
  reconcileAuthoredDocumentReceipt,
} from '../authored-document-receipt'
import { FROZEN_DOCUMENTS } from '../../test-fixtures/frozen-documents'
import { getGameDocumentContract } from '../game-document-contracts'
import type { FoundationDocumentPath } from '../types'
import {
  canonicalFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
  foundationProjectionRelativePath,
} from '../foundation-authority-projection'

function completeDocument(path: 'docs/GDD.md'): string { return FROZEN_DOCUMENTS[path] }

function completeFoundationDocument(path: FoundationDocumentPath): string {
  return FROZEN_DOCUMENTS[path]
}

async function writeProjectionForTarget(
  workspacePath: string,
  dispatchId: string,
  targetPath: FoundationDocumentPath,
  documents: ReadonlyMap<FoundationDocumentPath, string>,
): Promise<void> {
  const contract = getGameDocumentContract(targetPath)
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: foundationAuthoringSources(targetPath).map(source => source.path),
    documents,
  })
  const projectionPath = join(workspacePath, foundationProjectionRelativePath(dispatchId))
  await mkdir(join(workspacePath, '.beegame/workflow/foundation-authoring/projections'), { recursive: true })
  await writeFile(projectionPath, canonicalFoundationAuthorityProjectionBytes(projection))
}

async function writeCommittedProjection(
  workspacePath: string,
  dispatchId: string,
  targetPath: 'docs/GDD.md',
): Promise<void> {
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: [],
    documents: new Map(),
  })
  const projectionPath = join(workspacePath, foundationProjectionRelativePath(dispatchId))
  await mkdir(join(workspacePath, '.beegame/workflow/foundation-authoring/projections'), { recursive: true })
  await writeFile(projectionPath, canonicalFoundationAuthorityProjectionBytes(projection))
}

describe('native authored document receipts', () => {
  test('commits and replays a document written with native file tools', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-document-'))
    try {
      const targetPath = 'docs/GDD.md' as const
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const authored = completeDocument(targetPath)
      await writeFile(join(workspacePath, targetPath), authored)
      await writeCommittedProjection(workspacePath, 'native-gdd', targetPath)

      const first = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-gdd',
        targetPath,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })
      const second = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-gdd',
        targetPath,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })

      expect(second).toEqual(first)
      const committedMarkdown = await readFile(
        join(workspacePath, targetPath),
        'utf8',
      )
      expect(first).toMatchObject({
        schemaVersion: 5,
        documentId: 'GDD',
        byteLength: Buffer.byteLength(committedMarkdown),
        status: 'committed',
      })
      expect(committedMarkdown).not.toBe(authored)
      expect(committedMarkdown).toContain(
        'updated_at: 2026-08-13T01:00:00.000+08:00',
      )
      expect(first.finalDigest).toBe(
        createHash('sha256').update(committedMarkdown).digest('hex'),
      )
      await expect(
        access(join(workspacePath, '.beegame/workflow/document-audits/native-gdd.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(
        access(join(workspacePath, 'docs/GDD.authority.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' })
      expect(first).not.toHaveProperty('authorityPath')
      expect(first).not.toHaveProperty('authorityDigest')
      await expect(
        readAuthoredDocumentReceipt(workspacePath, 'native-gdd'),
      ).resolves.toEqual(first)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reconciles a crash after native document files landed', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-reconcile-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        completeDocument('docs/GDD.md'),
      )
      await writeCommittedProjection(workspacePath, 'native-reconcile', 'docs/GDD.md')
      const receipt = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-reconcile',
        targetPath: 'docs/GDD.md',
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })
      const receiptPath = join(
        workspacePath,
        '.beegame/workflow/foundation-authoring/receipts/native-reconcile.json',
      )
      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...receipt, status: 'package_prepared' }, null, 2)}\n`,
      )

      await expect(reconcileAuthoredDocumentReceipt({
        workspacePath,
        dispatchId: 'native-reconcile',
      })).resolves.toMatchObject({ status: 'committed' })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects legacy custom-tool receipts', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-no-legacy-'))
    try {
      const receiptDir = join(
        workspacePath,
        '.beegame/workflow/foundation-authoring/receipts',
      )
      await mkdir(receiptDir, { recursive: true })
      await writeFile(
        join(receiptDir, 'legacy.json'),
        JSON.stringify({
          schemaVersion: 1,
          dispatchId: 'legacy',
          targetPath: 'docs/GDD.md',
          baselineDigest: null,
          finalDigest: createHash('sha256').update('old').digest('hex'),
          documentId: 'GDD',
          version: '1.0.0',
          updatedAt: new Date().toISOString(),
          status: 'committed',
        }),
      )

      await expect(
        readAuthoredDocumentReceipt(workspacePath, 'legacy'),
      ).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('requires and resolves the committed upstream projection at the document commit boundary', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-authority-'))
    try {
      const upstreamPath = 'docs/GDD.md' as const
      const targetPath = 'docs/LEVEL_SCENE_DESIGN.md' as const
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const upstream = completeDocument(upstreamPath).replace(
        '## Game States and Flow\n\n',
        '## Game States and Flow\n\n| ID | Value |\n| --- | --- |\n| `state.flow` | canonical |\n\n',
      )
      await writeFile(join(workspacePath, upstreamPath), upstream)
      const target = FROZEN_DOCUMENTS[targetPath].replace(
        'Production-ready World and Scene Structure authority',
        'Production-ready World and Scene Structure authority. Owner reference: `state.flow`.',
      )
      await writeFile(join(workspacePath, targetPath), target)
      const projection = projectFoundationAuthority({
        targetPath,
        availableUpstreamPaths: [upstreamPath],
        documents: new Map([[upstreamPath, upstream]]),
      })
      const projectionPath = join(workspacePath, foundationProjectionRelativePath('authority-pass'))
      await mkdir(join(workspacePath, '.beegame/workflow/foundation-authoring/projections'), { recursive: true })
      await writeFile(projectionPath, canonicalFoundationAuthorityProjectionBytes(projection))
      await expect(commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'authority-pass',
        targetPath,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })).resolves.toMatchObject({ status: 'committed', targetPath })

      const mismatched = JSON.parse(canonicalFoundationAuthorityProjectionBytes(projection)) as Record<string, unknown>
      mismatched.targetPath = 'docs/GDD.md'
      await writeFile(
        join(workspacePath, foundationProjectionRelativePath('authority-mismatch')),
        `${JSON.stringify(mismatched, null, 2)}\n`,
      )
      await expect(commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'authority-mismatch',
        targetPath,
        authoredBody: target,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })).rejects.toThrow(/projection|contract|target/i)

      await writeFile(
        join(workspacePath, foundationProjectionRelativePath('authority-stale')),
        canonicalFoundationAuthorityProjectionBytes(projection),
      )
      await writeFile(join(workspacePath, 'docs/GDD.md'), `${upstream}\nchanged`)
      await expect(commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'authority-stale',
        targetPath,
        authoredBody: target,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })).rejects.toThrow(/stale|current committed authority/i)

      await expect(commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'authority-missing',
        targetPath,
        authoredBody: target,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })).rejects.toThrow(/ENOENT|missing|projection/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('commits semantic-looking Markdown without a Stage 2 content gate', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-markdown-content-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const targetPath = 'docs/GDD.md' as const
      const target = completeFoundationDocument(targetPath).replace(
        '<!-- beegame-audit-appendix -->',
        'Owner reference: `material.variable-parameter-table`.\n\n<!-- beegame-audit-appendix -->',
      )
      await writeFile(join(workspacePath, targetPath), target)
      await writeProjectionForTarget(
        workspacePath,
        'semantic-markdown-content',
        targetPath,
        new Map(),
      )

      await expect(commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'semantic-markdown-content',
        targetPath,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })).resolves.toMatchObject({ status: 'committed' })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('commits nonempty raw Markdown without performing Review work in Stage 2', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-raw-markdown-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const targetPath = 'docs/GDD.md' as const
      await writeProjectionForTarget(workspacePath, 'raw-markdown', targetPath, new Map())
      const receipt = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'raw-markdown',
        targetPath,
        authoredBody: '# draft title\n\nAn incomplete but valid authoring result.\n',
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })
      expect(receipt.status).toBe('committed')
      expect(await readFile(join(workspacePath, targetPath), 'utf8')).toContain('# draft title')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('commits exact canonical raw Markdown with service-owned block markers', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-service-markers-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const targetPath = 'docs/GDD.md' as const
      await writeProjectionForTarget(workspacePath, 'service-markers', targetPath, new Map())
      const marked = completeFoundationDocument(targetPath)
      const authoredBody = marked
        .split('<!-- beegame-audit-appendix -->')[0]!
        .split('\n')
        .filter(line => !line.trim().startsWith('<!-- beegame-'))
        .join('\n')
      await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'service-markers',
        targetPath,
        authoredBody,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })
      const committed = await readFile(join(workspacePath, targetPath), 'utf8')
      const body = committed.split('---\n').slice(2).join('---\n')
      expect(body).toContain('<!-- beegame-section:vision -->')
      expect(body).toContain('<!-- beegame-material:core-loop-diagram -->')
      expect(body).toContain('<!-- beegame-production-materials -->')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

})
import { foundationAuthoringSources } from '../foundation-authoring-contract'
