import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'

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
  const decision = documentReviewDecisionSchema.parse(
    JSON.parse(
      await readFile(
        reviewDecisionPath(input.workspacePath, input.scope, input.revision),
        'utf8',
      ),
    ),
  )
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

  const report = await readFile(reportPath)
  return {
    decision,
    reportPath,
    reportDigest: createHash('sha256').update(report).digest('hex'),
  }
}
