import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import type { AuthorDocumentsResult } from './stage-modules/foundation-authoring/public'
import { foundationReviewerInputDigest } from './stage-modules/foundation-reviewer/public'
import {
  createFoundationInitialReviewRequest,
} from './delivery-workflow/foundation-public-handoff'
import {
  createInitialDeliveryRun,
  createRunStore,
} from './delivery-workflow/run-store'
import { parseDeliveryRun } from './delivery-workflow/schema'
import type { DeliveryRun } from './delivery-workflow/types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

type PublicSourceRun = Pick<
  DeliveryRun,
  | 'ownerId'
  | 'projectId'
  | 'confirmedBriefDigest'
  | 'confirmedBriefContext'
  | 'authorStage'
>

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

function artifactParts(path: string): string[] {
  const parts = path.split('/')
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    parts.some(part => part === '' || part === '.' || part === '..')
  )
    throw new Error('author exported artifact descriptor is invalid')
  if (
    path === '.beegame/workflow/run.json' ||
    path === '.beegame/workflow/events.jsonl' ||
    path.startsWith('.beegame/workflow/locks/')
  )
    throw new Error('author exported artifact path is reserved')
  return parts
}

async function readFrozenExport(
  sourceRoot: string,
  artifact: AuthorDocumentsResult['documents'][number],
): Promise<Buffer> {
  const parts = artifactParts(artifact.artifactPath)
  let cursor = sourceRoot
  for (const part of parts.slice(0, -1)) {
    cursor = join(cursor, part)
    const metadata = await lstat(cursor)
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error('author artifact parent must be a real directory')
  }
  const absolute = resolve(sourceRoot, artifact.artifactPath)
  const rel = relative(sourceRoot, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('author exported artifact escapes workspace')

  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size !== artifact.byteLength)
      throw new Error('author artifact size or kind mismatch')
    const bytes = await handle.readFile()
    if (
      bytes.byteLength !== artifact.byteLength ||
      createHash('sha256').update(bytes).digest('hex') !== artifact.digest
    )
      throw new Error('author artifact digest mismatch')
    return bytes
  } finally {
    await handle.close()
  }
}

function assertSourceRun(input: {
  sourceRun: PublicSourceRun
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): AuthorDocumentsResult {
  const { sourceRun } = input
  if (sourceRun.ownerId !== input.ownerId)
    throw new Error('review copy source owner does not match destination owner')
  if (sourceRun.projectId === input.projectId)
    throw new Error('review copy destination project must differ from its source')
  if (sourceRun.confirmedBriefContext !== input.confirmedBriefContext)
    throw new Error('review copy brief context does not match its source')
  const confirmedBriefDigest = createHash('sha256')
    .update(input.confirmedBriefContext)
    .digest('hex')
  if (sourceRun.confirmedBriefDigest !== confirmedBriefDigest)
    throw new Error('review copy source brief digest does not match its context')

  const author = sourceRun.authorStage
  if (!author || author.status !== 'completed' || !author.result)
    throw new Error('review copy requires a completed public author result')
  const result = author.result
  if (
    result.ownerId !== sourceRun.ownerId ||
    result.projectId !== sourceRun.projectId ||
    result.inputDigest !== author.inputDigest ||
    result.confirmedBriefDigest !== sourceRun.confirmedBriefDigest
  )
    throw new Error('review copy source author result binding does not match')
  return structuredClone(result)
}

export async function createReviewProjectCopy(input: {
  sourceWorkspacePath: string
  destinationWorkspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
  sourceRun: PublicSourceRun
}): Promise<ReviewProjectCopyResult> {
  if (!input.confirmedBriefContext.trim())
    throw new Error('confirmed brief context is required')
  const sourceWorkspacePath = resolve(input.sourceWorkspacePath)
  const destinationWorkspacePath = resolve(input.destinationWorkspacePath)
  if (sourceWorkspacePath === destinationWorkspacePath)
    throw new Error('review copy destination must differ from its source')
  if (await destinationExists(destinationWorkspacePath))
    throw new Error('review copy destination already exists')

  const sourceResult = assertSourceRun({
    sourceRun: input.sourceRun,
    ownerId: input.ownerId,
    projectId: input.projectId,
    confirmedBriefContext: input.confirmedBriefContext,
  })
  const sourceRoot = await realpath(sourceWorkspacePath)
  const sourceRequest = await createFoundationInitialReviewRequest({
    workspacePath: sourceRoot,
    confirmedBriefContext: input.confirmedBriefContext,
    requestId: `foundation:${input.sourceRun.projectId}:source`,
    expected: {
      ownerId: input.sourceRun.ownerId,
      projectId: input.sourceRun.projectId,
      inputDigest: input.sourceRun.authorStage!.inputDigest,
      confirmedBriefDigest: input.sourceRun.confirmedBriefDigest,
    },
    result: sourceResult,
  })
  const frozenExports = await Promise.all(
    sourceResult.documents.map(async artifact => ({
      artifact,
      bytes: await readFrozenExport(sourceRoot, artifact),
    })),
  )

  await mkdir(dirname(destinationWorkspacePath), { recursive: true })
  const temporaryWorkspacePath = join(
    dirname(destinationWorkspacePath),
    `.${basename(destinationWorkspacePath)}.${randomUUID()}.tmp`,
  )
  let claimedDestination = false

  try {
    await mkdir(temporaryWorkspacePath, { recursive: false })
    const writtenPaths = new Set<string>()
    for (const { artifact, bytes } of frozenExports)
      if (!writtenPaths.has(artifact.artifactPath)) {
        await writeDurableFile(join(temporaryWorkspacePath, artifact.artifactPath), bytes)
        writtenPaths.add(artifact.artifactPath)
      }
    if (!('documents' in sourceRequest.input))
      throw new Error('initial Reviewer request is required for review copy')
    for (const [index, document] of sourceRequest.input.documents.entries()) {
      const bytes = frozenExports[index]!.bytes
      const canonicalPath = CANONICAL_FOUNDATION_DOCUMENTS[index]!
      if (Buffer.byteLength(document.content, 'utf8') !== bytes.byteLength)
        throw new Error('author exported artifact content changed during copy')
      if (writtenPaths.has(canonicalPath)) {
        const existing = await readFile(join(temporaryWorkspacePath, canonicalPath))
        if (createHash('sha256').update(existing).digest('hex') !== createHash('sha256').update(bytes).digest('hex'))
          throw new Error('canonical view path conflicts with exported artifact')
      } else {
        await writeDurableFile(join(temporaryWorkspacePath, canonicalPath), bytes)
        writtenPaths.add(canonicalPath)
      }
    }

    const initial = createInitialDeliveryRun({
      projectId: input.projectId,
      ownerId: input.ownerId,
      confirmedBriefDigest: input.sourceRun.confirmedBriefDigest,
      confirmedBriefContext: input.confirmedBriefContext,
      documentRevision: sourceResult.documentRevision,
      workspaceRevision: sourceResult.workspaceRevision,
    })
    const request = {
      ...sourceRequest,
      projectId: input.projectId,
      requestId: `foundation:${initial.runId}:0`,
      inputDigest: foundationReviewerInputDigest({
        ownerId: input.ownerId,
        projectId: input.projectId,
        input: sourceRequest.input,
      }),
    }
    const run = parseDeliveryRun({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      foundationReviewStage: {
        protocolVersion: 1,
        authorResultId: sourceResult.resultId,
        importedAuthorResult: structuredClone(sourceResult),
        control: { sequence: 0, appliedSequence: 0, action: 'run' },
        invocation: { stage: 'reviewer', request },
      },
    })
    const store = createRunStore(temporaryWorkspacePath, input.ownerId)
    const saved = await store.save(run)

    // Claim the destination only after all source validation and temporary
    // writes succeed. A racing file or directory is never overwritten.
    await mkdir(destinationWorkspacePath, { recursive: false })
    claimedDestination = true
    for (const entry of await readdir(temporaryWorkspacePath))
      await rename(join(temporaryWorkspacePath, entry), join(destinationWorkspacePath, entry))
    await rmdir(temporaryWorkspacePath)
    return { workspacePath: destinationWorkspacePath, run: saved }
  } catch (error) {
    await rm(temporaryWorkspacePath, { recursive: true, force: true }).catch(
      () => undefined,
    )
    if (claimedDestination)
      await rm(destinationWorkspacePath, { recursive: true, force: true }).catch(
        () => undefined,
      )
    throw error
  }
}
