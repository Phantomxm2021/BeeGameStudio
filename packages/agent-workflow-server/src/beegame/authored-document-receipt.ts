import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  CANONICAL_PROJECT_DOCUMENT_IDS,
} from './delivery-workflow/types'

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

/**
 * Commit only the service-owned metadata of an accepted remediation. The
 * document author owns the Markdown body; BGS owns version and updated_at.
 */
export async function commitRemediatedDocumentMetadata(input: {
  workspacePath: string
  targetPath: string
  previousVersion: string
  previousUpdatedAt: string
  updatedAt?: string
}): Promise<void> {
  const previousParts = input.previousVersion.split('.').map(Number)
  if (
    previousParts.length !== 3 ||
    previousParts.some((part, index) =>
      !Number.isInteger(part) ||
      part < 0 ||
      String(part) !== input.previousVersion.split('.')[index]
    )
  )
    throw new Error('remediated document previous version is invalid')
  const previousTimestamp = Date.parse(input.previousUpdatedAt)
  if (!Number.isFinite(previousTimestamp))
    throw new Error('remediated document previous updated_at is invalid')
  const updatedAt =
    input.updatedAt ??
    new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString()
  if (
    !Number.isFinite(Date.parse(updatedAt)) ||
    Date.parse(updatedAt) <= previousTimestamp
  )
    throw new Error('remediated document updated_at must advance')

  const target = resolve(input.workspacePath, input.targetPath)
  const workspaceRoot = `${resolve(input.workspacePath)}/`
  if (!target.startsWith(workspaceRoot))
    throw new Error('remediated document path escapes the workspace')
  const lines = (await readFile(target, 'utf8')).split('\n')
  if (lines[0]?.trim() !== '---')
    throw new Error('remediated document front matter is missing')
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (closingIndex < 1)
    throw new Error('remediated document front matter is invalid')
  let versionCount = 0
  let updatedAtCount = 0
  const nextVersion = `${previousParts[0]}.${previousParts[1]}.${previousParts[2]! + 1}`
  for (let index = 1; index < closingIndex; index += 1) {
    const field = lines[index]!.slice(0, lines[index]!.indexOf(':')).trim()
    if (field === 'version') {
      lines[index] = `version: ${nextVersion}`
      versionCount += 1
    }
    if (field === 'updated_at') {
      lines[index] = `updated_at: ${updatedAt}`
      updatedAtCount += 1
    }
  }
  if (versionCount !== 1 || updatedAtCount !== 1)
    throw new Error('remediated document service metadata is invalid')
  await durableWrite(target, lines.join('\n'))
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
