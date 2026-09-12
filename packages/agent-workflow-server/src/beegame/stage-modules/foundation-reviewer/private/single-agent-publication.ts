import { captureSingleReviewInput, reviewDigest, reviewHash, singleReviewInputSchema, NATIVE_FILE_REVIEW_POLICY,
  type SingleReviewInput, type SingleReviewReport } from './single-agent-contract'
import { z } from 'zod/v4'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const tokenBudget = z.number().int().positive().safe().nullable()
export const singleReviewHandleSchema = z.object({ protocolVersion: z.literal(1), producer: z.literal('foundation-reviewer'), id: z.uuid() }).strict()
export const singleReviewStartSchema = z.object({ protocolVersion: z.literal(1), ownerId: id, projectId: id,
  requestId: id, inputDigest: digest, input: singleReviewInputSchema, tokenBudget: tokenBudget.optional() }).strict()
export const singleReviewResumeSchema = z.object({ handle: singleReviewHandleSchema, requestId: id }).strict()
export const singleReviewStopSchema = singleReviewResumeSchema.extend({ reason: z.string().min(1).max(2000) }).strict()
export type SingleReviewStart = z.infer<typeof singleReviewStartSchema>
export type SingleReviewHandle = z.infer<typeof singleReviewHandleSchema>
export type SingleReviewResume = z.infer<typeof singleReviewResumeSchema>
export type SingleReviewStop = z.infer<typeof singleReviewStopSchema>
export function singleReviewInputDigest(value: { ownerId: string; projectId: string; input: SingleReviewInput; tokenBudget?: number | null }): string {
  const identity = z.object({ ownerId: id, projectId: id }).strict().parse({ ownerId: value.ownerId, projectId: value.projectId })
  return reviewDigest({ ...identity, input: captureSingleReviewInput(value.input), policy: NATIVE_FILE_REVIEW_POLICY,
    ...(value.tokenBudget === undefined ? {} : { tokenBudget: tokenBudget.parse(value.tokenBudget) }) })
}
export function parseSingleReviewStart(value: unknown): SingleReviewStart {
  const start = singleReviewStartSchema.parse(structuredClone(value))
  start.input = captureSingleReviewInput(start.input)
  if (singleReviewInputDigest(start) !== start.inputDigest) throw new Error('Review input digest mismatch or unsupported old request')
  return start
}
export function buildSingleReviewResult(start: SingleReviewStart, report: SingleReviewReport) {
  const documents = start.input.documents.map(document => ({ ...document, digest: reviewHash(document.content), byteLength: Buffer.byteLength(document.content) }))
  const documentSetDigest = reviewHash(JSON.stringify(documents.map(({ path, digest }) => [path, digest])))
  const issues = report.findings.map(finding => {
    const document = documents.find(document => document.path === finding.documentPath)!
    const body = { type: 'semantic' as const, reasonCode: 'SINGLE_AGENT_FINDING' as const,
      severity: finding.severity, title: finding.title, actual: finding.actual, expected: finding.expected,
      source: { scope: 'document' as const, documentPath: document.path, digest: document.digest } }
    return { issue: { id: reviewDigest(body), ...body } }
  }).sort((a, b) => a.issue.id.localeCompare(b.issue.id))
  const audit = { policy: NATIVE_FILE_REVIEW_POLICY, summary: report.summary }
  const body = { protocolVersion: 3 as const, producer: 'foundation-reviewer' as const,
    ownerId: start.ownerId, projectId: start.projectId, requestId: start.requestId, inputDigest: start.inputDigest,
    subject: start.input.subject, requirements: start.input.requirements,
    ...(start.input.comparison || start.tokenBudget !== undefined ? { inputContext: {
      ...(start.input.comparison ? { comparison: start.input.comparison } : {}),
      ...(start.tokenBudget !== undefined ? { tokenBudget: start.tokenBudget } : {}),
    } } : {}),
    kind: issues.length ? 'issues_found' as const : 'passed' as const, documents, documentSetDigest,
    policyDigest: reviewDigest(NATIVE_FILE_REVIEW_POLICY), issueRegistryDigest: reviewDigest(issues.map(entry => entry.issue)),
    evidenceDigest: reviewDigest({ audit, issues }), issues, audit,
  }
  return { ...body, resultId: reviewDigest(body) }
}
export type SingleReviewPublishedResult = ReturnType<typeof buildSingleReviewResult>
export type SingleReviewResult = (
  | { status: 'running' | 'stopped'; handle: SingleReviewHandle }
  | { status: 'needs_action'; handle: SingleReviewHandle; reason: string; resumable: boolean }
  | { status: 'failed'; handle: SingleReviewHandle; code: string; reason: string }
  | { status: 'completed'; handle: SingleReviewHandle; result: SingleReviewPublishedResult }
) & { billingStatus: 'pending' | 'settled'; progress?: { modelResponses: number; message: string } }
