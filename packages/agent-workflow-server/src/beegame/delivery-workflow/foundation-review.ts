import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  foundationDocumentLaneById,
  type FoundationDocumentLaneId,
} from './foundation-document-lanes'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

export const FOUNDATION_REVIEW_VERSION = 3

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const conflictIdSchema = z.string().regex(/^B[1-9][0-9]*$/u)
const foundationPathSchema = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)

const evidenceSchema = z
  .object({
    path: foundationPathSchema,
    location: z.string().trim().min(1).max(300),
    observed: z.string().trim().min(1).max(1_200),
  })
  .strict()

const changeSchema = z
  .object({
    path: foundationPathSchema,
    action: z.string().trim().min(1).max(1_200),
  })
  .strict()

export const foundationReviewConflictContentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    problem: z.string().trim().min(1).max(2_000),
    evidence: z.array(evidenceSchema).min(1).max(32),
    requiredOutcome: z.string().trim().min(1).max(1_200),
    changes: z.array(changeSchema).min(1).max(8),
    acceptance: z.array(z.string().trim().min(1).max(600)).min(1).max(24),
  })
  .strict()

const conflictSchema = foundationReviewConflictContentSchema.safeExtend({
  id: conflictIdSchema,
})

export const foundationReviewSchema = z
  .object({
    version: z.literal(FOUNDATION_REVIEW_VERSION),
    scope: z.literal('foundation'),
    revision: digestSchema,
    verdict: z.enum(['READY', 'NEEDS_REVISION']),
    conflicts: z.array(conflictSchema).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    const conflictIds = value.conflicts.map(conflict => conflict.id)
    const conflictIdSet = new Set(conflictIds)
    if (conflictIdSet.size !== conflictIds.length)
      context.addIssue({
        code: 'custom',
        path: ['conflicts'],
        message: 'foundation review conflict IDs must be unique',
      })
    if (value.verdict === 'READY' && value.conflicts.length)
      context.addIssue({
        code: 'custom',
        path: ['conflicts'],
        message: 'READY foundation review cannot contain conflicts',
      })
    if (value.verdict === 'NEEDS_REVISION' && !value.conflicts.length)
      context.addIssue({
        code: 'custom',
        path: ['conflicts'],
        message: 'NEEDS_REVISION foundation review requires conflicts',
      })
  })

export type FoundationReview = z.infer<typeof foundationReviewSchema>

function assertDigest(value: string): void {
  digestSchema.parse(value)
}

function assertSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value))
    throw new Error(`${label} is not a safe path segment`)
}

function reviewDirectory(workspacePath: string, revision: string): string {
  assertDigest(revision)
  return resolve(workspacePath, '.beegame', 'reviews', 'foundation', revision)
}

export function foundationReviewPath(
  workspacePath: string,
  revision: string,
): string {
  return resolve(reviewDirectory(workspacePath, revision), 'review.json')
}

export async function removeFoundationReviewStagingDirectory(
  workspacePath: string,
  revision: string,
): Promise<void> {
  const directoryPath = reviewDirectory(workspacePath, revision)
  await rm(resolve(directoryPath, '.staging'), {
    recursive: true,
    force: true,
  })
  const directory = await open(directoryPath, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export function foundationReviewLaneReceiptPath(
  workspacePath: string,
  revision: string,
  laneId: FoundationDocumentLaneId,
): string {
  foundationDocumentLaneById(laneId)
  return resolve(
    reviewDirectory(workspacePath, revision),
    'parts',
    `${laneId}.md`,
  )
}

export function foundationReviewLaneReceiptStagingPath(
  workspacePath: string,
  revision: string,
  laneId: FoundationDocumentLaneId,
): string {
  foundationDocumentLaneById(laneId)
  return resolve(
    reviewDirectory(workspacePath, revision),
    '.staging',
    'parts',
    `${laneId}.md`,
  )
}

export function foundationReviewSelectionPath(
  workspacePath: string,
  revision: string,
): string {
  return resolve(reviewDirectory(workspacePath, revision), 'selection.md')
}

export function foundationReviewSelectionStagingPath(
  workspacePath: string,
  revision: string,
  dispatchId: string,
): string {
  assertSegment(dispatchId, 'foundation review dispatch ID')
  return resolve(
    reviewDirectory(workspacePath, revision),
    '.staging',
    dispatchId,
    'selection.md',
  )
}

export function foundationReviewAffectedPaths(
  review: FoundationReview,
): FoundationDocumentPath[] {
  const affected = new Set(
    review.conflicts.flatMap(conflict =>
      conflict.changes.map(change => change.path),
    ),
  )
  return CANONICAL_FOUNDATION_DOCUMENTS.filter(path => affected.has(path))
}

async function readReview(path: string): Promise<{
  bytes: Buffer
  review: FoundationReview
}> {
  const file = await lstat(path)
  if (!file.isFile()) throw new Error('foundation review is not a regular file')
  const bytes = await readFile(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('foundation review is not valid UTF-8')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('foundation review is not valid JSON')
  }
  return { bytes, review: foundationReviewSchema.parse(value) }
}

export async function readFoundationReviewArtifact(input: {
  workspacePath: string
  path: string
  expectedDigest?: string
}): Promise<{
  review: FoundationReview
  path: string
  digest: string
  affectedPaths: FoundationDocumentPath[]
}> {
  const workspaceRoot = resolve(input.workspacePath)
  const absolutePath = resolve(workspaceRoot, input.path)
  const projectPath = relative(workspaceRoot, absolutePath)
    .split('\\')
    .join('/')
  if (
    projectPath === '..' ||
    projectPath.startsWith('../') ||
    projectPath.split('/').includes('..')
  )
    throw new Error('foundation review path escapes the active project')
  const accepted = await readReview(absolutePath)
  if (
    absolutePath !==
    foundationReviewPath(input.workspacePath, accepted.review.revision)
  )
    throw new Error('foundation review path does not match its revision')
  const digest = createHash('sha256').update(accepted.bytes).digest('hex')
  if (input.expectedDigest && input.expectedDigest !== digest)
    throw new Error('foundation review digest does not match')
  return {
    review: accepted.review,
    path: projectPath,
    digest,
    affectedPaths: foundationReviewAffectedPaths(accepted.review),
  }
}

export async function commitAssembledFoundationReview(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  dispatchId: string
  review: FoundationReview
}): Promise<{
  review: FoundationReview
  path: string
  digest: string
  affectedPaths: FoundationDocumentPath[]
}> {
  assertDigest(input.revision)
  assertDigest(input.currentRevision)
  assertSegment(input.dispatchId, 'foundation review dispatch ID')
  if (input.revision !== input.currentRevision)
    throw new Error('canonical artifacts changed during foundation review')
  const review = foundationReviewSchema.parse(input.review)
  if (review.revision !== input.revision)
    throw new Error('foundation review revision does not match')
  const bytes = Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8')
  const validated = foundationReviewSchema.parse(
    JSON.parse(bytes.toString('utf8')),
  )
  const committedPath = foundationReviewPath(
    input.workspacePath,
    input.revision,
  )
  await mkdir(dirname(committedPath), { recursive: true })
  const temporaryPath = `${committedPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    const stagedFile = await open(temporaryPath, 'wx')
    try {
      await stagedFile.writeFile(bytes)
      await stagedFile.sync()
    } finally {
      await stagedFile.close()
    }
    try {
      await link(temporaryPath, committedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await readFile(committedPath)
      if (!existing.equals(bytes))
        throw new Error('foundation review already exists with different bytes')
    }
  } finally {
    await rm(temporaryPath, { force: true })
  }
  const directory = await open(dirname(committedPath), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }

  return {
    review: validated,
    path: relative(resolve(input.workspacePath), committedPath)
      .split('\\')
      .join('/'),
    digest: createHash('sha256').update(bytes).digest('hex'),
    affectedPaths: foundationReviewAffectedPaths(validated),
  }
}
