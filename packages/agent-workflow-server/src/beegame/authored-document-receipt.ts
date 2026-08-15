import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  normalizeCompleteGameDocumentProtocol,
} from './complete-game-document'
import {
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'
import { appendDocumentReceiptObservation } from './runtime-observability'

const authoredDocumentReceiptSchema = z
  .object({
    schemaVersion: z.literal(5),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    finalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().positive(),
    documentId: z.string().min(1),
    version: z.literal('1.0.0'),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['package_prepared', 'committed']),
  })
  .strict()

export type AuthoredDocumentReceipt = {
  schemaVersion: 5
  dispatchId: string
  targetPath: string
  finalDigest: string
  byteLength: number
  documentId: string
  version: '1.0.0'
  updatedAt: string
  status: 'package_prepared' | 'committed'
}

/**
 * Record the result of a complete Markdown file written through Bee Game
 * Studio's native file tools. The authored body is the only human document
 * authority; this function validates it, injects deterministic service-owned
 * metadata, writes a machine audit sidecar, and commits the resulting bytes.
 */
export async function commitAuthoredFoundationDocument(input: {
  workspacePath: string
  dispatchId: string
  targetPath: FoundationDocumentPath
  updatedAt?: string
  authoredBody?: string
  expectedOriginalDigest?: string | null
}): Promise<AuthoredDocumentReceipt> {
  const documentId = CANONICAL_PROJECT_DOCUMENT_IDS[input.targetPath]
  const existing = await readAuthoredDocumentReceipt(
    input.workspacePath,
    input.dispatchId,
  )
  if (existing?.status === 'committed') {
    if (
      existing.targetPath !== input.targetPath ||
      existing.documentId !== documentId
    )
      throw new Error('authored document receipt does not match dispatch')
    return existing
  }
  if (existing)
    throw new Error('authored document receipt is not safely replayable')

  const target = resolve(input.workspacePath, input.targetPath)
  if (input.expectedOriginalDigest !== undefined) {
    const current = await readOptionalFile(target)
    const currentDigest = current === undefined ? null : digest(current)
    if (currentDigest !== input.expectedOriginalDigest)
      throw new Error('authored document target changed during generation')
  }
  const authored = input.authoredBody ?? await readFile(target, 'utf8')
  const updatedAt = input.updatedAt ?? new Date().toISOString()
  z.string().datetime({ offset: true }).parse(updatedAt)
  const canonical = canonicalizeAuthoredDocument(
    input.targetPath,
    authored,
    updatedAt,
  )
  await durableWrite(target, canonical)
  const audit = {
    schemaVersion: 1 as const,
    dispatchId: input.dispatchId,
    targetPath: input.targetPath,
    documentId,
    documentDigest: digest(canonical),
    checks: {
      canonicalStructure: 'passed' as const,
      productionMaterials: 'passed' as const,
      repeatedContent: 'passed' as const,
    },
  }
  await durableWrite(
    authoredDocumentAuditPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(audit, null, 2)}\n`,
  )
  const prepared: AuthoredDocumentReceipt = {
    schemaVersion: 5,
    dispatchId: input.dispatchId,
    targetPath: input.targetPath,
    finalDigest: audit.documentDigest,
    byteLength: Buffer.byteLength(canonical),
    documentId,
    version: '1.0.0',
    updatedAt,
    status: 'package_prepared',
  }
  await syncFile(target)
  await durableWrite(
    authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(prepared, null, 2)}\n`,
  )
  const committed: AuthoredDocumentReceipt = {
    ...prepared,
    status: 'committed',
  }
  await durableWrite(
    authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  await appendDocumentReceiptObservation({
    workspacePath: input.workspacePath,
    sessionId: input.dispatchId,
    dispatchId: input.dispatchId,
    targetPath: committed.targetPath,
    digest: committed.finalDigest,
  })
  return committed
}

export async function readAuthoredDocumentReceipt(
  workspacePath: string,
  dispatchId: string,
): Promise<AuthoredDocumentReceipt | undefined> {
  const raw = await readOptionalFile(
    authoredDocumentReceiptPath(workspacePath, dispatchId),
  )
  if (raw === undefined) return undefined
  const parsed = authoredDocumentReceiptSchema.parse(
    JSON.parse(raw),
  ) as AuthoredDocumentReceipt
  if (parsed.dispatchId !== dispatchId)
    throw new Error('authored document receipt is invalid')
  if (
    CANONICAL_PROJECT_DOCUMENT_IDS[
      parsed.targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
    ] !== parsed.documentId
  )
    throw new Error('authored document receipt identity is invalid')
  return parsed
}

export async function reconcileAuthoredDocumentReceipt(input: {
  workspacePath: string
  dispatchId: string
}): Promise<AuthoredDocumentReceipt | undefined> {
  const receipt = await readAuthoredDocumentReceipt(
    input.workspacePath,
    input.dispatchId,
  )
  if (!receipt) return undefined
  const target = await readOptionalFile(
    resolve(input.workspacePath, receipt.targetPath),
  )
  if (target === undefined || digest(target) !== receipt.finalDigest)
    return undefined
  try {
    if (
      canonicalizeAuthoredDocument(
        receipt.targetPath as FoundationDocumentPath,
        target,
        receipt.updatedAt,
      ) !== target
    )
      return undefined
  } catch {
    return undefined
  }
  if (receipt.status === 'committed') return receipt
  const committed: AuthoredDocumentReceipt = {
    ...receipt,
    status: 'committed',
  }
  await durableWrite(
    authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  return committed
}

function authoredDocumentReceiptPath(
  workspacePath: string,
  dispatchId: string,
): string {
  validateDispatchId(dispatchId)
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'document-commits',
    `${dispatchId}.json`,
  )
}

function authoredDocumentAuditPath(
  workspacePath: string,
  dispatchId: string,
): string {
  validateDispatchId(dispatchId)
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'document-audits',
    `${dispatchId}.json`,
  )
}

function validateDispatchId(dispatchId: string): void {
  const allowed = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(''),
  )
  if (!dispatchId || [...dispatchId].some(character => !allowed.has(character)))
    throw new Error('authored document dispatch identity is invalid')
}

async function durableWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
    await syncDirectories([dirname(path)])
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function syncFile(target: string): Promise<void> {
  const handle = await open(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectories([dirname(target)])
}

async function syncDirectories(paths: readonly string[]): Promise<void> {
  for (const path of [...new Set(paths)].sort()) {
    const handle = await open(path, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function canonicalizeAuthoredDocument(
  path: FoundationDocumentPath,
  markdown: string,
  updatedAt: string,
): string {
  const expectedDocumentId = CANONICAL_PROJECT_DOCUMENT_IDS[path]
  const lines = markdown.split('\n')
  const body =
    lines[0] === '---' && lines[4] === '---'
      ? lines.slice(5).join('\n')
      : markdown
  const validatedBody = normalizeCompleteGameDocumentProtocol(path, body)
  return [
    '---',
    `document_id: ${expectedDocumentId}`,
    'version: 1.0.0',
    `updated_at: ${updatedAt}`,
    '---',
    validatedBody,
  ].join('\n')
}
