import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { DocumentReviewAssignment } from './document-review-topology'

export type DocumentReviewScope = 'foundation' | 'checklist' | 'complete'
export type DocumentReviewVerdict = 'READY' | 'NEEDS_REVISION'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)

export const documentReviewDecisionSchema = z
  .object({
    version: z.literal(1),
    scope: z.enum(['foundation', 'checklist', 'complete']),
    revision: digestSchema,
    verdict: z.enum(['READY', 'NEEDS_REVISION']),
    affectedPaths: z.array(z.string().min(1)).max(32),
    reportPath: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.affectedPaths).size !== value.affectedPaths.length)
      context.addIssue({
        code: 'custom',
        path: ['affectedPaths'],
        message: 'document review affected paths must be unique',
      })
    if (value.verdict === 'READY' && value.affectedPaths.length)
      context.addIssue({
        code: 'custom',
        path: ['affectedPaths'],
        message: 'READY cannot affect paths',
      })
    if (value.verdict === 'NEEDS_REVISION' && !value.affectedPaths.length)
      context.addIssue({
        code: 'custom',
        path: ['affectedPaths'],
        message: 'NEEDS_REVISION requires affected paths',
      })
  })

export type DocumentReviewDecision = z.infer<
  typeof documentReviewDecisionSchema
>

function assertRevision(revision: string): void {
  digestSchema.parse(revision)
}

function assertSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value))
    throw new Error(`${label} is not a safe path segment`)
}

export function reviewRevisionDirectory(
  workspacePath: string,
  scope: DocumentReviewScope,
  revision: string,
): string {
  assertRevision(revision)
  return resolve(workspacePath, '.beegame', 'reviews', scope, revision)
}

export function reviewStagingPath(
  workspacePath: string,
  scope: DocumentReviewScope,
  revision: string,
  dispatchId: string,
  filename: string,
): string {
  assertSegment(dispatchId, 'document review dispatch ID')
  assertSegment(filename, 'document review staging filename')
  if (basename(filename) !== filename)
    throw new Error('document review staging filename is not safe')
  return resolve(
    reviewRevisionDirectory(workspacePath, scope, revision),
    '.staging',
    dispatchId,
    filename,
  )
}

export function reviewPartPath(
  workspacePath: string,
  scope: DocumentReviewScope,
  revision: string,
  role: string,
): string {
  assertSegment(role, 'document review role')
  return resolve(
    reviewRevisionDirectory(workspacePath, scope, revision),
    'parts',
    `${role}.md`,
  )
}

export function reviewReportPath(
  workspacePath: string,
  scope: DocumentReviewScope,
  revision: string,
): string {
  return resolve(
    reviewRevisionDirectory(workspacePath, scope, revision),
    'review.md',
  )
}

export function reviewDecisionPath(
  workspacePath: string,
  scope: DocumentReviewScope,
  revision: string,
): string {
  return resolve(
    reviewRevisionDirectory(workspacePath, scope, revision),
    'decision.json',
  )
}

function projectRelativePath(workspacePath: string, path: string): string {
  return relative(resolve(workspacePath), resolve(path)).split('\\').join('/')
}

function safeProjectPath(path: string): boolean {
  const normalized = path.split('\\').join('/')
  return (
    !isAbsolute(path) &&
    normalized !== '..' &&
    !normalized.startsWith('../') &&
    !normalized.split('/').includes('..')
  )
}

function assertCurrentRevision(
  revision: string,
  currentRevision: string,
): void {
  assertRevision(revision)
  assertRevision(currentRevision)
  if (revision !== currentRevision)
    throw new Error('canonical artifacts changed during document review')
}

function assertWorkspacePath(workspacePath: string, path: string): void {
  if (!safeProjectPath(projectRelativePath(workspacePath, path)))
    throw new Error('document review path escapes the active project')
}

async function readMarkdownReport(path: string): Promise<Buffer> {
  const file = await lstat(path)
  if (!file.isFile())
    throw new Error('document review report is not a regular file')
  const bytes = await readFile(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('document review report is not valid UTF-8')
  }
  if (
    !text
      .split(/\r?\n/u)
      .some(line => line.trim() && !line.trimStart().startsWith('#'))
  )
    throw new Error('document review report has no review content')
  return bytes
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function persistStagedFile(
  stagedPath: string,
  committedPath: string,
): Promise<void> {
  if (await pathExists(committedPath))
    throw new Error('document review report is already committed')
  await mkdir(dirname(committedPath), { recursive: true })
  await rename(stagedPath, committedPath)
  const directory = await open(dirname(committedPath), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

function assertAssignment(input: {
  assignment: DocumentReviewAssignment
  workspacePath: string
  revision: string
  role: 'specialist' | 'final'
}): void {
  if (input.assignment.scope === undefined)
    throw new Error('document review assignment has no scope')
  if (
    (input.role === 'final' && input.assignment.role !== 'final') ||
    (input.role === 'specialist' && input.assignment.role === 'final')
  )
    throw new Error('document review assignment role does not match')
  for (const path of [
    ...input.assignment.sourcePaths,
    ...input.assignment.stagingOutputPaths,
    ...input.assignment.committedOutputPaths,
  ])
    assertWorkspacePath(input.workspacePath, path)
  const sourcePaths = new Set(
    input.assignment.sourcePaths.map(path => resolve(path)),
  )
  if (
    [
      ...input.assignment.stagingOutputPaths,
      ...input.assignment.committedOutputPaths,
    ]
      .map(path => resolve(path))
      .some(path => sourcePaths.has(path))
  )
    throw new Error('document review output overlaps a reviewed source')
  assertRevision(input.revision)
}

export async function acceptSpecialistReport(input: {
  assignment: DocumentReviewAssignment
  workspacePath: string
  revision: string
  currentRevision: string
}): Promise<{ role: string; path: string; digest: string }> {
  assertAssignment({ ...input, role: 'specialist' })
  assertCurrentRevision(input.revision, input.currentRevision)
  if (
    input.assignment.stagingOutputPaths.length !== 1 ||
    input.assignment.committedOutputPaths.length !== 1
  )
    throw new Error('document review specialist output contract does not match')
  const stagedPath = input.assignment.stagingOutputPaths[0]
  const committedPath = input.assignment.committedOutputPaths[0]
  const bytes = await readMarkdownReport(stagedPath)
  await persistStagedFile(stagedPath, committedPath)
  return {
    role: input.assignment.role,
    path: projectRelativePath(input.workspacePath, committedPath),
    digest: createHash('sha256').update(bytes).digest('hex'),
  }
}

export async function acceptReviewDecision(input: {
  workspacePath: string
  scope: DocumentReviewScope
  revision: string
  allowedAffectedPaths: readonly string[]
}): Promise<{
  decision: DocumentReviewDecision
  reportPath: string
  reportDigest: string
}> {
  assertRevision(input.revision)
  const decision = await readReviewDecision(
    reviewDecisionPath(input.workspacePath, input.scope, input.revision),
  )
  validateReviewDecision({ ...input, decision })

  const reportPath = reviewReportPath(
    input.workspacePath,
    input.scope,
    input.revision,
  )
  const report = await readMarkdownReport(reportPath)
  return {
    decision,
    reportPath,
    reportDigest: createHash('sha256').update(report).digest('hex'),
  }
}

async function readReviewDecision(
  path: string,
): Promise<DocumentReviewDecision> {
  return documentReviewDecisionSchema.parse(
    JSON.parse(await readFile(path, 'utf8')),
  )
}

function validateReviewDecision(input: {
  workspacePath: string
  scope: DocumentReviewScope
  revision: string
  allowedAffectedPaths: readonly string[]
  decision: DocumentReviewDecision
}): void {
  const { decision } = input
  if (decision.scope !== input.scope)
    throw new Error('document review decision scope does not match')
  if (decision.revision !== input.revision)
    throw new Error('document review decision revision does not match')

  const reportPath = reviewReportPath(
    input.workspacePath,
    input.scope,
    input.revision,
  )
  if (
    !safeProjectPath(decision.reportPath) ||
    decision.reportPath !== projectRelativePath(input.workspacePath, reportPath)
  )
    throw new Error('document review decision report path does not match')

  const allowed = new Set(input.allowedAffectedPaths)
  for (const path of decision.affectedPaths)
    if (!safeProjectPath(path) || !allowed.has(path))
      throw new Error('document review decision affected path is not allowed')
}

export async function acceptFinalReport(input: {
  assignment: DocumentReviewAssignment
  workspacePath: string
  revision: string
  currentRevision: string
  allowedAffectedPaths: readonly string[]
  partDigests: Readonly<Record<string, string>>
}): Promise<{
  decision: DocumentReviewDecision
  reportPath: string
  reportDigest: string
}> {
  assertAssignment({ ...input, role: 'final' })
  assertCurrentRevision(input.revision, input.currentRevision)
  if (
    input.assignment.stagingOutputPaths.length !== 2 ||
    input.assignment.committedOutputPaths.length !== 2
  )
    throw new Error('document review final output contract does not match')

  const expectedPartPaths = input.assignment.sourcePaths.map(path =>
    projectRelativePath(input.workspacePath, path),
  )
  if (
    Object.keys(input.partDigests).length !== expectedPartPaths.length ||
    expectedPartPaths.some(
      path => !digestSchema.safeParse(input.partDigests[path]).success,
    )
  )
    throw new Error('document review part digest contract does not match')
  for (const sourcePath of input.assignment.sourcePaths) {
    const bytes = await readMarkdownReport(sourcePath)
    const path = projectRelativePath(input.workspacePath, sourcePath)
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      input.partDigests[path]
    )
      throw new Error('document review part report changed before final review')
  }

  const [stagedReportPath, stagedDecisionPath] =
    input.assignment.stagingOutputPaths
  const [committedReportPath, committedDecisionPath] =
    input.assignment.committedOutputPaths
  const reportBytes = await readMarkdownReport(stagedReportPath)
  const decision = await readReviewDecision(stagedDecisionPath)
  validateReviewDecision({
    workspacePath: input.workspacePath,
    scope: input.assignment.scope,
    revision: input.revision,
    allowedAffectedPaths: input.allowedAffectedPaths,
    decision,
  })

  await persistStagedFile(stagedReportPath, committedReportPath)
  await persistStagedFile(stagedDecisionPath, committedDecisionPath)
  const accepted = await acceptReviewDecision({
    workspacePath: input.workspacePath,
    scope: input.assignment.scope,
    revision: input.revision,
    allowedAffectedPaths: input.allowedAffectedPaths,
  })
  const stagedDigest = createHash('sha256').update(reportBytes).digest('hex')
  if (accepted.reportDigest !== stagedDigest)
    throw new Error('document review report changed while being committed')
  return accepted
}
