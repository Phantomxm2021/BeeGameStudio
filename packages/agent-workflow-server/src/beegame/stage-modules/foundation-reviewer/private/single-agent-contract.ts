import { createHash } from 'node:crypto'
import { z } from 'zod/v4'

export const NATIVE_FILE_REVIEW_POLICY = 'native-file-audit-and-correct.v5' as const

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
  subject: z.object({ kind: z.literal('initial'), sourceResultId: id,
    sourceDocumentRevision: digest, confirmedBriefDigest: digest }).strict(),
  requirements: reviewRequirementsSchema,
  documents: z.array(reviewDocumentSchema).length(8),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.documents.map(doc => doc.path)).size !== 8)
    ctx.addIssue({ code: 'custom', message: 'Review requires all eight distinct documents' })
  if (value.requirements.status === 'available' && (!value.requirements.content.trim() || reviewHash(value.requirements.content) !== value.requirements.digest))
    ctx.addIssue({ code: 'custom', message: 'Requirements content binding mismatch' })
  if (value.requirements.status === 'available' && value.subject.confirmedBriefDigest !== value.requirements.digest)
    ctx.addIssue({ code: 'custom', message: 'Requirements do not match the confirmed brief' })
  if (value.documents.reduce((size, doc) => size + Buffer.byteLength(doc.content), 0) > 16 * 1024 * 1024)
    ctx.addIssue({ code: 'custom', message: 'Review input exceeds the 16 MiB document storage safety limit; no content was truncated' })
})
export type SingleReviewInput = z.infer<typeof singleReviewInputSchema>
export function captureSingleReviewInput(value: unknown): SingleReviewInput {
  const input = singleReviewInputSchema.parse(JSON.parse(reviewJson(value)))
  input.documents.sort((a, b) => REVIEW_DOCUMENT_PATHS.indexOf(a.path) - REVIEW_DOCUMENT_PATHS.indexOf(b.path))
  return input
}

const text = z.string().trim().min(1).max(8000)
export const singleReviewReportSchema = z.object({
  summary: text,
}).strict()
export type SingleReviewReport = z.infer<typeof singleReviewReportSchema>
export function admitSingleReviewReport(_input: SingleReviewInput, value: unknown): SingleReviewReport {
  return singleReviewReportSchema.parse(value)
}
