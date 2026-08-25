import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { computeDocumentRevision } from './delivery-workflow/revision'
import {
  createInitialDeliveryRun,
  createRunStore,
} from './delivery-workflow/run-store'
import { parseDeliveryRun } from './delivery-workflow/schema'
import type { DeliveryRun } from './delivery-workflow/types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

export type ReviewProjectCopyResult = {
  workspacePath: string
  run: DeliveryRun
}

async function destinationExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return false
    throw error
  }
}

async function writeDurableFile(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function readCanonicalSourceDocument(
  sourceWorkspacePath: string,
  path: string,
): Promise<Buffer> {
  const absolute = join(sourceWorkspacePath, path)
  let metadata
  try {
    metadata = await lstat(absolute)
  } catch {
    throw new Error(`canonical source document is missing: ${path}`)
  }
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`canonical source document must be a regular file: ${path}`)
  if (metadata.size > MAX_DOCUMENT_BYTES)
    throw new Error(`canonical source document exceeds 2 MiB: ${path}`)
  const bytes = await readFile(absolute)
  if (bytes.byteLength > MAX_DOCUMENT_BYTES)
    throw new Error(`canonical source document exceeds 2 MiB: ${path}`)
  return bytes
}

export async function createReviewProjectCopy(input: {
  sourceWorkspacePath: string
  destinationWorkspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): Promise<ReviewProjectCopyResult> {
  if (!input.confirmedBriefContext.trim())
    throw new Error('confirmed brief context is required')
  const sourceWorkspacePath = resolve(input.sourceWorkspacePath)
  const destinationWorkspacePath = resolve(input.destinationWorkspacePath)
  if (sourceWorkspacePath === destinationWorkspacePath)
    throw new Error('review copy destination must differ from its source')
  if (await destinationExists(destinationWorkspacePath))
    throw new Error('review copy destination already exists')

  const documents = await Promise.all(
    CANONICAL_FOUNDATION_DOCUMENTS.map(async path => ({
      path,
      bytes: await readCanonicalSourceDocument(sourceWorkspacePath, path),
    })),
  )
  await mkdir(dirname(destinationWorkspacePath), { recursive: true })
  const temporaryWorkspacePath = join(
    dirname(destinationWorkspacePath),
    `.${basename(destinationWorkspacePath)}.${randomUUID()}.tmp`,
  )

  try {
    await mkdir(temporaryWorkspacePath, { recursive: false })
    for (const document of documents)
      await writeDurableFile(
        join(temporaryWorkspacePath, document.path),
        document.bytes,
      )

    const confirmedBriefDigest = createHash('sha256')
      .update(input.confirmedBriefContext)
      .digest('hex')
    const documentRevision = await computeDocumentRevision(
      temporaryWorkspacePath,
      confirmedBriefDigest,
    )
    const initial = createInitialDeliveryRun({
      projectId: input.projectId,
      ownerId: input.ownerId,
      confirmedBriefDigest,
      confirmedBriefContext: input.confirmedBriefContext,
      documentRevision,
      workspaceRevision: 'uncomputed',
    })
    const run = parseDeliveryRun({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      foundationDraftState: {
        completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      },
    })
    const store = createRunStore(temporaryWorkspacePath, input.ownerId)
    const saved = await store.save(run)
    await rename(temporaryWorkspacePath, destinationWorkspacePath)
    return { workspacePath: destinationWorkspacePath, run: saved }
  } catch (error) {
    await rm(temporaryWorkspacePath, { recursive: true, force: true }).catch(
      () => undefined,
    )
    throw error
  }
}
