import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { ReviewAdmissionError } from './single-agent-diagnostic'

export const NATIVE_FILE_REVIEW_POLICY = 'native-file-audit.v1' as const

// Owned wire constants, not imports from another stage's private implementation.
export const REVIEW_DOCUMENT_PATHS = ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md', 'docs/ART_DIRECTION.md', 'docs/UI_UX_SPEC.md', 'docs/AUDIO_DESIGN.md', 'docs/ASSET_PLAN.md'] as const
export const reviewHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
export function reviewJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(reviewJson).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${reviewJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  throw new Error('Review data must be finite plain JSON')
}
export const reviewDigest = (value: unknown) => reviewHash(reviewJson(value))
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(200)
export const reviewPathSchema = z.enum(REVIEW_DOCUMENT_PATHS)
export const reviewDocumentSchema = z.object({ path: reviewPathSchema, content: z.string().min(1) }).strict()
export function reviewDocumentSetDigest(documents: readonly z.infer<typeof reviewDocumentSchema>[]): string {
  return reviewHash(JSON.stringify([...documents]
    .sort((a, b) => REVIEW_DOCUMENT_PATHS.indexOf(a.path) - REVIEW_DOCUMENT_PATHS.indexOf(b.path))
    .map(document => [document.path, reviewHash(document.content)])))
}
export const reviewRequirementsSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), content: z.string().min(1), digest }).strict(),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1).max(2000) }).strict(),
])
export const singleReviewInputSchema = z.object({
  subject: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('initial'), sourceResultId: id, sourceDocumentRevision: digest, confirmedBriefDigest: digest }).strict(),
    z.object({ kind: z.literal('candidate'), candidateId: id, candidateResultId: digest, sourceReviewResultId: digest,
      sourceReviewResultDigest: digest, baseDocumentSetDigest: digest, round: z.number().int().positive().safe() }).strict(),
  ]),
  requirements: reviewRequirementsSchema,
  documents: z.array(reviewDocumentSchema).length(8),
  // Optional context for candidate re-reviews, never a second audit protocol.
  comparison: z.object({ baseDocuments: z.array(reviewDocumentSchema).length(8),
    // Bound predecessor evidence, not instructions or accepted repair verdicts.
    reviewEvidence: z.object({
      revisionSummary: z.string().trim().min(1).max(8000).optional(),
      issues: z.array(z.object({ id, title: z.string().min(1).max(8000),
        actual: z.string().max(8000), expected: z.string().max(8000),
        documentPath: reviewPathSchema }).strict()).max(200),
    }).strict().optional(),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.comparison) {
    const baseline = value.comparison.baseDocuments
    const evidence = value.comparison.reviewEvidence
    if (evidence) {
      const ids = new Set(evidence.issues.map(issue => issue.id))
      if (ids.size !== evidence.issues.length)
        ctx.addIssue({ code: 'custom', message: 'Predecessor evidence has duplicate or unknown issue IDs' })
    }
    if (value.subject.kind !== 'candidate')
      ctx.addIssue({ code: 'custom', message: 'Only candidate reviews may include a comparison baseline' })
    else if (reviewDocumentSetDigest(baseline) !== value.subject.baseDocumentSetDigest)
      ctx.addIssue({ code: 'custom', message: 'Comparison baseline does not match the reviewed document version' })
    if (new Set(baseline.map(document => document.path)).size !== 8)
      ctx.addIssue({ code: 'custom', message: 'Comparison requires all eight distinct baseline documents' })
    if (baseline.reduce((size, document) => size + Buffer.byteLength(document.content), 0) > 16 * 1024 * 1024)
      ctx.addIssue({ code: 'custom', message: 'Comparison baseline exceeds the 16 MiB storage safety limit; no content was truncated' })
  }
  if (new Set(value.documents.map(doc => doc.path)).size !== 8)
    ctx.addIssue({ code: 'custom', message: 'Review requires all eight distinct documents' })
  if (value.requirements.status === 'available' && (!value.requirements.content.trim() || reviewHash(value.requirements.content) !== value.requirements.digest))
    ctx.addIssue({ code: 'custom', message: 'Requirements content binding mismatch' })
  if (value.subject.kind === 'initial' && value.requirements.status === 'available' && value.subject.confirmedBriefDigest !== value.requirements.digest)
    ctx.addIssue({ code: 'custom', message: 'Requirements do not match the confirmed brief' })
  if (value.documents.reduce((size, doc) => size + Buffer.byteLength(doc.content), 0) > 16 * 1024 * 1024)
    ctx.addIssue({ code: 'custom', message: 'Review input exceeds the 16 MiB document storage safety limit; no content was truncated' })
})
export type SingleReviewInput = z.infer<typeof singleReviewInputSchema>
export function captureSingleReviewInput(value: unknown): SingleReviewInput {
  const input = singleReviewInputSchema.parse(JSON.parse(reviewJson(value)))
  input.documents.sort((a, b) => REVIEW_DOCUMENT_PATHS.indexOf(a.path) - REVIEW_DOCUMENT_PATHS.indexOf(b.path))
  input.comparison?.baseDocuments.sort((a, b) => REVIEW_DOCUMENT_PATHS.indexOf(a.path) - REVIEW_DOCUMENT_PATHS.indexOf(b.path))
  return input
}

const text = z.string().trim().min(1).max(8000)
export const auditReviewFindingSchema = z.object({
  documentPath: reviewPathSchema, severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']),
  title: z.string().trim().min(1).max(300), actual: text, expected: text,
}).strict()
export const singleReviewReportSchema = z.object({
  status: z.enum(['completed', 'blocked']), summary: text,
  findings: z.array(auditReviewFindingSchema).max(200),
}).strict()
export type SingleReviewReport = z.infer<typeof singleReviewReportSchema>
export function admitSingleReviewReport(_input: SingleReviewInput, value: unknown): SingleReviewReport {
  const report = singleReviewReportSchema.parse(value)
  if (report.status !== 'completed') throw new ReviewAdmissionError({ stage: 'admission', reason: 'audit_incomplete' })
  const seen = new Set<string>()
  report.findings = report.findings.filter(finding => {
    const key = reviewDigest(finding)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return report
}
