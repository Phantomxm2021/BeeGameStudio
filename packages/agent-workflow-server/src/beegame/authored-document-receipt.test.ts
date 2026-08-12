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
import { renderTestCompleteGameDocument } from '../__tests__/complete-game-document-fixture'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'

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
  return [
    '---',
    'document_id: GDD',
    'version: 1.0.0',
    'updated_at: 2026-08-12T00:00:00.000Z',
    '---',
    body,
  ].join('\n')
}

describe('native authored document receipts', () => {
  test('commits and replays a document written with native file tools', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-document-'))
    try {
      const targetPath = 'docs/GDD.md' as const
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const authored = completeDocument(targetPath)
      await writeFile(join(workspacePath, targetPath), authored)

      const first = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-gdd',
        targetPath,
      })
      const second = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-gdd',
        targetPath,
      })

      expect(second).toEqual(first)
      expect(first).toMatchObject({
        schemaVersion: 4,
        documentId: 'GDD',
        status: 'committed',
      })
      expect(await readFile(join(workspacePath, targetPath), 'utf8')).toBe(
        authored,
      )
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
      const receipt = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-reconcile',
        targetPath: 'docs/GDD.md',
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
})
