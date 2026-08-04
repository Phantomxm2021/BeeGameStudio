import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commitCanonicalDocument,
  reconcileCanonicalDocumentCommitReceipt,
} from './native-canonical-document-tool'

describe('canonical document commit', () => {
  test('owns metadata and returns the same durable commit idempotently', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-document-'))
    try {
      const contract = {
        dispatchId: 'dispatch-create-gdd',
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        operation: 'create' as const,
        baselineDigest: null,
      }
      const first = await commitCanonicalDocument({
        workspacePath,
        contract,
        body: '# Game Design\n\nRules.',
      })
      const second = await commitCanonicalDocument({
        workspacePath,
        contract,
        body: '# Game Design\n\nRules.',
      })
      expect(second).toEqual(first)
      expect(first).toMatchObject({
        version: '1.0.0',
        documentId: 'GDD',
        status: 'committed',
      })
      const content = await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8')
      expect(content).toContain('document_id: GDD')
      expect(content).toContain('version: 1.0.0')
      expect(content).toContain(`updated_at: ${first.updatedAt}`)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('increments PATCH and makes updated_at strictly monotonic', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-revision-'))
    try {
      const baseline =
        '---\ndocument_id: GDD\nversion: 1.2.3\nupdated_at: 2099-01-01T00:00:00.000Z\n---\n\n# Old\n'
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), baseline)
      const receipt = await commitCanonicalDocument({
        workspacePath,
        contract: {
          dispatchId: 'dispatch-revise-gdd',
          targetPath: 'docs/GDD.md',
          documentId: 'GDD',
          operation: 'revise',
          baselineDigest: createHash('sha256').update(baseline).digest('hex'),
          baselineVersion: '1.2.3',
          baselineUpdatedAt: '2099-01-01T00:00:00.000Z',
        },
        body: '# New\n\nRepaired rules.',
      })
      expect(receipt.version).toBe('1.2.4')
      expect(Date.parse(receipt.updatedAt)).toBeGreaterThan(
        Date.parse('2099-01-01T00:00:00.000Z'),
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reconciles a prepared receipt whose final file already landed', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-recovery-'))
    try {
      const receipt = await commitCanonicalDocument({
        workspacePath,
        contract: {
          dispatchId: 'dispatch-recover-gdd',
          targetPath: 'docs/GDD.md',
          documentId: 'GDD',
          operation: 'create',
          baselineDigest: null,
        },
        body: '# Game Design\n\nRules.',
      })
      const receiptPath = join(
        workspacePath,
        '.beegame/workflow/document-commits/dispatch-recover-gdd.json',
      )
      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...receipt, status: 'prepared' }, null, 2)}\n`,
      )
      await expect(
        reconcileCanonicalDocumentCommitReceipt({
          workspacePath,
          dispatchId: 'dispatch-recover-gdd',
        }),
      ).resolves.toMatchObject({ status: 'committed' })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects model-owned front matter', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-frontmatter-'))
    try {
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-invalid-gdd',
            targetPath: 'docs/GDD.md',
            documentId: 'GDD',
            operation: 'create',
            baselineDigest: null,
          },
          body: '---\nversion: 9.9.9\n---\n# Invalid',
        }),
      ).rejects.toThrow('must not include YAML front matter')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a document identity that does not own the target path', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-identity-'))
    try {
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-wrong-identity',
            targetPath: 'docs/GDD.md',
            documentId: 'BALANCE_DESIGN',
            operation: 'create',
            baselineDigest: null,
          },
          body: '# Wrong identity',
        }),
      ).rejects.toThrow('canonical document identity is invalid')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a revision without an existing baseline', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-missing-'))
    try {
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-missing-gdd',
            targetPath: 'docs/GDD.md',
            documentId: 'GDD',
            operation: 'revise',
            baselineDigest: null,
            baselineVersion: '1.0.0',
            baselineUpdatedAt: '2026-08-04T00:00:00.000Z',
          },
          body: '# Missing baseline',
        }),
      ).rejects.toThrow('revision requires an existing baseline')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects an invalid revision timestamp instead of replacing it', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'canonical-time-'))
    try {
      const baseline = '# Existing\n'
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), baseline)
      await expect(
        commitCanonicalDocument({
          workspacePath,
          contract: {
            dispatchId: 'dispatch-invalid-time-gdd',
            targetPath: 'docs/GDD.md',
            documentId: 'GDD',
            operation: 'revise',
            baselineDigest: createHash('sha256').update(baseline).digest('hex'),
            baselineVersion: '1.0.0',
            baselineUpdatedAt: 'invalid',
          },
          body: '# Revised',
        }),
      ).rejects.toThrow('revision requires valid baseline metadata')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
