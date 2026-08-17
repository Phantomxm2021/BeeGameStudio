import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
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

export function foundationReviewOutputContractInstruction(): string {
  const rootShape = JSON.stringify({
    version: FOUNDATION_REVIEW_VERSION,
    scope: 'foundation',
    revision: '<assigned-64-hex-revision>',
    verdict: '<READY-or-NEEDS_REVISION>',
    conflicts: [
      {
        id: 'B1',
        title: '<blocking-defect-title>',
        problem: '<why-the-contract-cannot-be-implemented-or-verified>',
        evidence: [
          {
            path: 'docs/GDD.md',
            location: '<stable-location>',
            observed: '<bounded-observation>',
          },
        ],
        requiredOutcome: '<shared-required-outcome>',
        changes: [{ path: 'docs/GDD.md', action: '<required-action>' }],
        acceptance: ['<mechanically-checkable-condition>'],
      },
    ],
  })
  return [
    `The root object has exactly this shape: ${rootShape}`,
    'There is no root-level acceptance field. acceptance exists only inside each conflicts item. Do not add summary, severity, impact, coverage, notes or any other root or conflict field.',
    `version must be the integer ${FOUNDATION_REVIEW_VERSION}; scope must be the string foundation; revision must exactly equal the assigned revision; verdict must be READY or NEEDS_REVISION.`,
    'Conflict IDs must be B1, B2, B3 and so on with no suffix or descriptive text.',
    'Each conflict evidence must be an array of objects containing only path, location and observed; never use a string. Each conflict changes must be an array of objects containing only path and action, with each path appearing at most once. acceptance must be an array of testable strings.',
  ].join(' ')
}

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

export function foundationReviewLaneReceiptPath(
  workspacePath: string,
  revision: string,
  laneId: FoundationDocumentLaneId,
): string {
  foundationDocumentLaneById(laneId)
  return resolve(reviewDirectory(workspacePath, revision), 'parts', `${laneId}.md`)
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

export async function acceptFoundationReview(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  dispatchId: string
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
  if (input.revision !== input.currentRevision)
    throw new Error('canonical artifacts changed during foundation review')
  const review = foundationReviewSchema.parse(input.review)
  if (review.revision !== input.revision)
    throw new Error('foundation review revision does not match')
  const bytes = Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8')
  const validated = foundationReviewSchema.parse(
    JSON.parse(bytes.toString('utf8')),
  )
  const stagedPath = foundationReviewStagingPath(
    input.workspacePath,
    input.revision,
    input.dispatchId,
  )
  const committedPath = foundationReviewPath(
    input.workspacePath,
    input.revision,
  )
  await mkdir(dirname(stagedPath), { recursive: true })
  await writeFile(stagedPath, bytes)
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
    review: validated,
    path: relative(resolve(input.workspacePath), committedPath)
      .split('\\')
      .join('/'),
    digest: createHash('sha256').update(bytes).digest('hex'),
    affectedPaths: foundationReviewAffectedPaths(validated),
  }
}
