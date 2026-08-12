import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  canonicalizeCompleteGameDocumentMarkdown,
  type CompleteGameDocumentArtifact,
} from './complete-game-document'
import {
  authoritySidecarPath,
  canonicalFoundationAuthoritySidecarBytes,
  createDocumentSectionAuthoritySidecar,
  validateFoundationAuthoritySidecar,
} from './foundation-authority-sidecar'
import {
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

const artifactReceiptSchema = z
  .object({
    artifactId: z.string().min(1),
    path: z.string().min(1),
    mediaType: z.literal('image/svg+xml'),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const authoredDocumentReceiptSchema = z
  .object({
    schemaVersion: z.literal(3),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    baselineDigest: z.null(),
    finalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    authorityPath: z.string().min(1),
    authorityDigest: z.string().regex(/^[a-f0-9]{64}$/),
    artifacts: z.array(artifactReceiptSchema),
    documentId: z.string().min(1),
    version: z.literal('1.0.0'),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['package_prepared', 'committed']),
  })
  .strict()

export type AuthoredDocumentReceipt = {
  schemaVersion: 3
  dispatchId: string
  targetPath: string
  baselineDigest: null
  finalDigest: string
  authorityPath: string
  authorityDigest: string
  artifacts: readonly Omit<CompleteGameDocumentArtifact, 'content'>[]
  documentId: string
  version: '1.0.0'
  updatedAt: string
  status: 'package_prepared' | 'committed'
}

/**
 * Record the result of a complete Markdown file written through Claude Code's
 * native file tools. BGS owns only metadata, validation and durable recovery.
 */
export async function commitAuthoredFoundationDocument(input: {
  workspacePath: string
  dispatchId: string
  targetPath: FoundationDocumentPath
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
  const authored = await readFile(target, 'utf8')
  const updatedAt = new Date().toISOString()
  const markdown = canonicalizeCompleteGameDocumentMarkdown(
    input.targetPath,
    authored,
    { version: '1.0.0', updatedAt },
  )
  const sidecar = createDocumentSectionAuthoritySidecar({
    documentPath: input.targetPath,
    markdown,
  })
  const sidecarBytes = canonicalFoundationAuthoritySidecarBytes(sidecar)
  const prepared: AuthoredDocumentReceipt = {
    schemaVersion: 3,
    dispatchId: input.dispatchId,
    targetPath: input.targetPath,
    baselineDigest: null,
    finalDigest: digest(markdown),
    authorityPath: authoritySidecarPath(input.targetPath),
    authorityDigest: digest(sidecarBytes),
    artifacts: [],
    documentId,
    version: '1.0.0',
    updatedAt,
    status: 'package_prepared',
  }
  const preparedFiles = await Promise.all([
    prepareDurableFile(target, markdown),
    prepareDurableFile(
      resolve(input.workspacePath, prepared.authorityPath),
      sidecarBytes,
    ),
  ])
  try {
    await durableWrite(
      authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
      `${JSON.stringify(prepared, null, 2)}\n`,
    )
    for (const file of preparedFiles) await rename(file.temporary, file.target)
    await syncDirectories(preparedFiles.map(file => dirname(file.target)))
  } catch (error) {
    await Promise.all(
      preparedFiles.map(file => unlink(file.temporary).catch(() => undefined)),
    )
    throw error
  }
  const committed: AuthoredDocumentReceipt = {
    ...prepared,
    status: 'committed',
  }
  await durableWrite(
    authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(committed, null, 2)}\n`,
  )
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
  for (const artifact of receipt.artifacts) {
    const content = await readOptionalFile(
      resolve(input.workspacePath, artifact.path),
    )
    if (content === undefined || digest(content) !== artifact.digest)
      return undefined
  }
  const authorityRaw = await readOptionalFile(
    resolve(input.workspacePath, receipt.authorityPath),
  )
  if (
    authorityRaw === undefined ||
    digest(authorityRaw) !== receipt.authorityDigest
  )
    return undefined
  let authority: unknown
  try {
    authority = JSON.parse(authorityRaw)
  } catch {
    return undefined
  }
  validateFoundationAuthoritySidecar({
    documentPath: receipt.targetPath as FoundationDocumentPath,
    markdown: target,
    value: authority,
  })
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
  const allowed = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(''),
  )
  if (!dispatchId || [...dispatchId].some(character => !allowed.has(character)))
    throw new Error('authored document dispatch identity is invalid')
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'document-commits',
    `${dispatchId}.json`,
  )
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

async function prepareDurableFile(
  target: string,
  content: string,
): Promise<{ temporary: string; target: string }> {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
  return { temporary, target }
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
