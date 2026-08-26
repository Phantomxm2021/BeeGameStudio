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
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { assembleFoundationDocumentMarkdown } from './foundation-document-author-payload'

function completePayload(path: 'docs/GDD.md') {
  const contract = getGameDocumentContract(path)
  return {
    title: contract.discipline,
    executiveSummary: 'Complete game design production authority.',
    sections: Object.fromEntries(contract.sections.map((section, index) => [
      section.sectionId,
      `Authoritative production requirements ${index + 1}.`,
    ])),
    materials: Object.fromEntries(contract.productionMaterials.map(material => [
      material.materialId,
      material.format === 'evidence_register'
        ? '| Evidence | State |\n| --- | --- |\n| Ref | Pending |'
        : material.format === 'markdown_table'
          ? '| Field | Value |\n| --- | --- |\n| Owner | Game design |'
          : material.format === 'mermaid'
            ? '```mermaid\ngraph TD\n  A --> B\n```'
            : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    ])),
  }
}

describe('native authored document receipts', () => {
  test('commits and replays a service-assembled document from a structured payload', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-document-'))
    try {
      const targetPath = 'docs/GDD.md' as const
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const payload = completePayload(targetPath)
      const authored = assembleFoundationDocumentMarkdown(targetPath, payload)
      await writeFile(join(workspacePath, targetPath), authored)

      const first = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-gdd',
        targetPath,
        authoredPayload: payload,
        updatedAt: '2026-08-13T01:00:00.000+08:00',
      })
      const second = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-gdd',
        targetPath,
        authoredPayload: payload,
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
      const payload = completePayload('docs/GDD.md')
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        assembleFoundationDocumentMarkdown('docs/GDD.md', payload),
      )
      const receipt = await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'native-reconcile',
        targetPath: 'docs/GDD.md',
        authoredPayload: payload,
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

  test('rejects a structured payload when canonical bytes changed after dispatch', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'authored-stale-target-'))
    try {
      const targetPath = 'docs/GDD.md' as const
      const target = join(workspacePath, targetPath)
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(target, 'original authority')
      const expectedOriginalDigest = createHash('sha256')
        .update('original authority')
        .digest('hex')
      await writeFile(target, 'concurrent authority')

      await expect(
        commitAuthoredFoundationDocument({
          workspacePath,
          dispatchId: 'stale-author',
          targetPath,
          authoredPayload: completePayload(targetPath),
          expectedOriginalDigest,
        }),
      ).rejects.toThrow('target changed during generation')
      expect(await readFile(target, 'utf8')).toBe('concurrent authority')
      expect(
        await readAuthoredDocumentReceipt(workspacePath, 'stale-author'),
      ).toBeUndefined()
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
