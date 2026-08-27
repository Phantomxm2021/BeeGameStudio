import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  commitAuthoredFoundationDocument,
  readAuthoredDocumentReceipt,
  reconcileAuthoredDocumentReceipt,
} from './authored-document-receipt'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../__tests__/complete-game-document-fixture'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import {
  canonicalFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
  foundationProjectionRelativePath,
} from './foundation-authority-projection'

function completeDocument(path: 'docs/GDD.md'): string {
  const contract = getGameDocumentContract(path)
  const body = renderTestCompleteGameDocument(path, {
    title: contract.discipline,
    executiveSummary: 'Complete game design production authority.',
    sections: contract.sections.map((section, index) => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Authoritative production requirements ${index + 1}.`,
    })),
    productionMaterials: contract.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            entries: [{
              evidenceId: `${material.materialId}.pending`,
              category: 'search_direction' as const,
              displayName: 'Pending reference direction',
              purpose: 'Record a production need before source selection.',
              state: 'source_not_selected' as const,
              evidenceRefs: [],
            }],
          }
        : {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            body:
              material.format === 'markdown_table'
                ? '| Field | Value |\n| --- | --- |\n| Owner | Game design |'
                : material.format === 'mermaid'
                  ? '```mermaid\ngraph TD\n  A --> B\n```'
                  : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
          },
    ),
    auditAppendix: {
      acceptanceCriteria: ['All game design requirements are implementation-ready.'],
      upstreamReferences: [],
      risks: [],
      openDecisions: [],
    },
  })
  return body
}

function completeFoundationDocument(path: FoundationDocumentPath): string {
  return renderTestCompleteGameDocument(path, completeTestSubmission(path))
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
    availableUpstreamPaths: contract.upstreamSections.map(source => source.path),
    documents,
  })
  const projectionPath = join(workspacePath, foundationProjectionRelativePath(dispatchId))
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), { recursive: true })
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
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), { recursive: true })
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
      const audit = JSON.parse(
        await readFile(
          join(
            workspacePath,
            '.beegame/workflow/document-audits/native-gdd.json',
          ),
          'utf8',
        ),
      )
      expect(audit).toEqual({
        schemaVersion: 1,
        dispatchId: 'native-gdd',
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        documentDigest: first.finalDigest,
        checks: {
          canonicalStructure: 'passed',
          productionMaterials: 'passed',
          repeatedContent: 'passed',
        },
      })
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
        '.beegame/workflow/document-commits/native-reconcile.json',
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
        '.beegame/workflow/document-commits',
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
      const target = renderTestCompleteGameDocument(targetPath, completeTestSubmission(targetPath)).replace(
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
      await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), { recursive: true })
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

  test('rejects undefined cross-document references and future Asset IDs at the commit boundary', async () => {
    const cases = [
      {
        targetPath: 'docs/LEVEL_SCENE_DESIGN.md' as const,
        reference: 'state.undefined',
        upstreamPaths: ['docs/GDD.md'] as const,
        tableReference: true,
      },
      {
        targetPath: 'docs/AUDIO_DESIGN.md' as const,
        reference: 'asset.futurecue',
        upstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/UI_UX_SPEC.md'] as const,
      },
      {
        targetPath: 'docs/ART_DIRECTION.md' as const,
        reference: 'asset.futurevisual',
        upstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'] as const,
      },
    ]
    for (const [index, current] of cases.entries()) {
      const workspacePath = await mkdtemp(join(tmpdir(), `authored-cross-ref-${index}-`))
      try {
        await mkdir(join(workspacePath, 'docs'), { recursive: true })
        const documents = new Map<FoundationDocumentPath, string>()
        for (const upstreamPath of current.upstreamPaths) {
          const markdown = completeFoundationDocument(upstreamPath)
          documents.set(upstreamPath, markdown)
          await writeFile(join(workspacePath, upstreamPath), markdown)
        }
        let target = completeFoundationDocument(current.targetPath)
        target = current.tableReference
          ? target.replace(
              '| Field | Value |',
              `| Reference ID | Value |\n| --- | --- |\n| \`${current.reference}\` | copied |\n\n| Field | Value |`,
            )
          : target.replace(
              '<!-- beegame-audit-appendix -->',
              `Owner reference: \`${current.reference}\`.\n\n<!-- beegame-audit-appendix -->`,
            )
        await writeFile(join(workspacePath, current.targetPath), target)
        await writeProjectionForTarget(workspacePath, `cross-ref-${index}`, current.targetPath, documents)
        await expect(commitAuthoredFoundationDocument({
          workspacePath,
          dispatchId: `cross-ref-${index}`,
          targetPath: current.targetPath,
          updatedAt: '2026-08-13T01:00:00.000+08:00',
        })).rejects.toThrow(/undefined|future Asset|semantic ID/i)
      } finally {
        await rm(workspacePath, { recursive: true, force: true })
      }
    }

    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-self-ref-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const upstream = completeFoundationDocument('docs/GDD.md')
      await writeFile(join(workspacePath, 'docs/GDD.md'), upstream)
      const selfReference = completeFoundationDocument('docs/LEVEL_SCENE_DESIGN.md').replace(
        '<!-- beegame-audit-appendix -->',
        'Owner declaration: `level.route`. Owner reference: `level.route`.\n\n<!-- beegame-audit-appendix -->',
      )
      await writeFile(join(workspacePath, 'docs/LEVEL_SCENE_DESIGN.md'), selfReference)
      await writeProjectionForTarget(
        workspacePath,
        'self-ref-pass',
        'docs/LEVEL_SCENE_DESIGN.md',
        new Map([['docs/GDD.md', upstream]]),
      )
      await expect(commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'self-ref-pass',
        targetPath: 'docs/LEVEL_SCENE_DESIGN.md',
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })).resolves.toMatchObject({ status: 'committed' })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }

    const duplicateWorkspace = await mkdtemp(join(tmpdir(), 'authored-duplicate-semantic-'))
    try {
      await mkdir(join(duplicateWorkspace, 'docs'), { recursive: true })
      const upstream = completeFoundationDocument('docs/GDD.md')
      await writeFile(join(duplicateWorkspace, 'docs/GDD.md'), upstream)
      const duplicate = completeFoundationDocument('docs/LEVEL_SCENE_DESIGN.md')
        .replace('## World and Scene Structure\n\n', '## World and Scene Structure\n\nOwner declaration: `level.route`.\n\n')
        .replace('## Objectives, Routes and Player Choices\n\n', '## Objectives, Routes and Player Choices\n\nOwner declaration: `level.route`.\n\n')
      await writeFile(join(duplicateWorkspace, 'docs/LEVEL_SCENE_DESIGN.md'), duplicate)
      await writeProjectionForTarget(
        duplicateWorkspace,
        'duplicate-semantic',
        'docs/LEVEL_SCENE_DESIGN.md',
        new Map([['docs/GDD.md', upstream]]),
      )
      await expect(commitAuthoredFoundationDocument({
        workspacePath: duplicateWorkspace,
        dispatchId: 'duplicate-semantic',
        targetPath: 'docs/LEVEL_SCENE_DESIGN.md',
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })).rejects.toThrow(/declared by multiple owners|semantic ID/i)
    } finally {
      await rm(duplicateWorkspace, { recursive: true, force: true })
    }
  })
})
