import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

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

const conflictSchema = z
  .object({
    id: conflictIdSchema,
    title: z.string().trim().min(1).max(160),
    problem: z.string().trim().min(1).max(2_000),
    evidence: z.array(evidenceSchema).min(1).max(32),
    requiredOutcome: z.string().trim().min(1).max(1_200),
    changes: z.array(changeSchema).min(1).max(8),
    acceptance: z.array(z.string().trim().min(1).max(600)).min(1).max(24),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.changes.map(change => change.path)).size !== value.changes.length)
      context.addIssue({
        code: 'custom',
        path: ['changes'],
        message: 'foundation review conflict change paths must be unique',
      })
  })

const priorConflictStatusSchema = z
  .object({
    id: conflictIdSchema,
    status: z.enum(['closed', 'open']),
  })
  .strict()

export const foundationReviewSchema = z
  .object({
    version: z.literal(2),
    scope: z.literal('foundation'),
    revision: digestSchema,
    verdict: z.enum(['READY', 'NEEDS_REVISION']),
    priorReviewDigest: digestSchema.optional(),
    priorConflictStatus: z.array(priorConflictStatusSchema).max(64),
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
    const priorIds = value.priorConflictStatus.map(status => status.id)
    if (new Set(priorIds).size !== priorIds.length)
      context.addIssue({
        code: 'custom',
        path: ['priorConflictStatus'],
        message: 'foundation review prior conflict IDs must be unique',
      })
    if (!value.priorReviewDigest && value.priorConflictStatus.length)
      context.addIssue({
        code: 'custom',
        path: ['priorReviewDigest'],
        message: 'foundation review prior status requires a prior digest',
      })
    for (const [index, prior] of value.priorConflictStatus.entries()) {
      const present = conflictIdSet.has(prior.id)
      if (prior.status === 'open' && !present)
        context.addIssue({
          code: 'custom',
          path: ['priorConflictStatus', index],
          message: 'open foundation conflict must remain in current conflicts',
        })
      if (prior.status === 'closed' && present)
        context.addIssue({
          code: 'custom',
          path: ['priorConflictStatus', index],
          message: 'closed foundation conflict cannot remain current',
        })
    }
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
  return resolve(
    workspacePath,
    '.beegame',
    'reviews',
    'foundation',
    revision,
  )
}

export function foundationReviewPath(
  workspacePath: string,
  revision: string,
): string {
  return resolve(reviewDirectory(workspacePath, revision), 'review.json')
}

export function foundationReviewStagingPath(
  workspacePath: string,
  revision: string,
  dispatchId: string,
): string {
  assertSegment(dispatchId, 'foundation review dispatch ID')
  return resolve(
    reviewDirectory(workspacePath, revision),
    '.staging',
    dispatchId,
    'review.json',
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

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
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

function validatePriorReview(
  current: FoundationReview,
  prior:
    | {
        review: FoundationReview
        digest: string
      }
    | undefined,
): void {
  if (!prior) {
    if (current.priorReviewDigest || current.priorConflictStatus.length)
      throw new Error('foundation review has unexpected prior review state')
    return
  }
  assertDigest(prior.digest)
  if (current.priorReviewDigest !== prior.digest)
    throw new Error('foundation review prior digest does not match')
  const expected = new Set(prior.review.conflicts.map(conflict => conflict.id))
  const actual = new Set(current.priorConflictStatus.map(status => status.id))
  if (
    expected.size !== actual.size ||
    [...expected].some(id => !actual.has(id))
  )
    throw new Error('foundation review does not account for every prior conflict')
}

export async function acceptFoundationReview(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  dispatchId: string
  priorReview?: { review: FoundationReview; digest: string }
}): Promise<{
  review: FoundationReview
  path: string
  digest: string
  affectedPaths: FoundationDocumentPath[]
}> {
  assertDigest(input.revision)
  assertDigest(input.currentRevision)
  if (input.revision !== input.currentRevision)
    throw new Error('canonical artifacts changed during foundation review')
  const stagedPath = foundationReviewStagingPath(
    input.workspacePath,
    input.revision,
    input.dispatchId,
  )
  const committedPath = foundationReviewPath(
    input.workspacePath,
    input.revision,
  )
  if (await exists(committedPath))
    throw new Error('foundation review is already committed')
  const accepted = await readReview(stagedPath)
  if (accepted.review.revision !== input.revision)
    throw new Error('foundation review revision does not match')
  validatePriorReview(accepted.review, input.priorReview)

  const stagedFile = await open(stagedPath, 'r')
  try {
    await stagedFile.sync()
  } finally {
    await stagedFile.close()
  }
  await mkdir(dirname(committedPath), { recursive: true })
  await rename(stagedPath, committedPath)
  const directory = await open(dirname(committedPath), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }

  return {
    review: accepted.review,
    path: relative(resolve(input.workspacePath), committedPath)
      .split('\\')
      .join('/'),
    digest: createHash('sha256').update(accepted.bytes).digest('hex'),
    affectedPaths: foundationReviewAffectedPaths(accepted.review),
  }
}
