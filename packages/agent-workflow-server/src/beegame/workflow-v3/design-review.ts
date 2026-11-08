import { z } from 'zod/v4'

export const designReviewDispositionSchema = z.object({
  finding: z.number().int().min(1).describe('1-based index in the current revision findings'),
  status: z.enum(['corrected', 'rejected', 'unresolved']),
  evidence: z.string().trim().min(1).describe('Saved definitions and locations supporting this disposition; for derived claims include the applicable entities, conditions and calculation, not agreement with a suggested answer'),
}).strict()
export type DesignReviewDisposition = z.infer<typeof designReviewDispositionSchema>

const authorSummary = z.string().trim().min(1).describe('User-facing outcome or concrete blocker in the response language')

export function designAuthorResultSchema() {
  return z.object({
    status: z.enum(['ready', 'blocked']),
    summary: authorSummary,
    // Retain saved author notes; only the independent reviewer resolves findings.
    reviewResponses: z.array(designReviewDispositionSchema).optional(),
  }).strict()
}

export function designAuthorOutputSchema(allowAnswer = false) {
  // The author contract stays identical across drafts and revisions. Exact
  // evidence-backed finding coverage belongs to the follow-up reviewer.
  return z.toJSONSchema(z.object({
    status: z.enum(allowAnswer ? ['ready', 'blocked', 'answered'] : ['ready', 'blocked'])
      .describe(allowAnswer ? 'Use answered for a reply without changing or submitting the GDD; ready submits the saved design, blocked reports an unresolved dependency' : 'Ready submits the saved design; blocked reports an unresolved dependency'),
    summary: authorSummary,
  }).strict(), { target: 'draft-7' })
}

// The reviewer supplies evidence, not a certification of game quality.
const reportFields = {
  summary: z.string().trim().min(1),
  findings: z.array(z.object({
    location: z.string().trim().min(1),
    issue: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    impact: z.string().trim().min(1),
  }).strict()),
}
const reportSchema = z.object({
  ...reportFields,
  resolutions: z.array(designReviewDispositionSchema).optional(),
}).strict()

/** Final-report guidance retains the coverage checked locally after generation. */
export function designReviewOutputSchema(findingCount: number) {
  return z.toJSONSchema(z.object({
    ...reportFields,
    ...(findingCount ? { resolutions: z.array(designReviewDispositionSchema.extend({
      finding: z.number().int().min(1).max(findingCount),
    })).length(findingCount) } : {}),
  }).strict(), { target: 'draft-7' })
}

export type DesignReviewReport = z.infer<typeof reportSchema>
export type DesignReviewReceipt = {
  source: { path: string; sha256: string }
  nativeThreadId: string
  nativeTurnId: string
  startedAt: string
  finishedAt: string
  response?: string
  authorResponses?: DesignReviewDisposition[]
  report: DesignReviewReport
}

export const DESIGN_REVIEW_INSTRUCTIONS = [
  'Review the confirmed brief and saved GDD together for requirement preservation, compatible product rules, and a connected player flow from entry through play and outcomes to the agreed restart or recovery. Judge the current MVP or explicitly requested scope. Requirements settled in the brief need not be repeated in the GDD.',
  'Each finding requires corrective work before handoff. Report an issue once when the supplied clauses demonstrate a changed user requirement, an undetermined required player action/information/outcome, or mutually incompatible outcomes under the same applicable conditions. Cite those clauses and the concrete consequence. Read local details together with global definitions. Clarifications and suggestions without a demonstrated violation may be summarized, not turned into findings. Return an empty findings array when no violation is supported. A real contradiction remains a finding even when its clauses are author proposals; a provisional choice does not override an explicit requirement.',
  'Use the complete supplied snapshot. Check product decisions and preserve user-stated appearance and source constraints. Asset availability, sourcing, generation, atlas preparation, registration and runtime checks belong to production, not this review. Stay read-only; source identity is checked by BGS. Use read-only tools only for a necessary calculation or evidence absent from the snapshot. Do not load Skills, browse, delegate, read histories or unrelated files, or write. Implementation tuning and hypothetical bad implementations are outside this document review.',
  'At completion, return one JSON object matching the supplied final JSON contract, with concise user-language conclusions in summary and source-supported corrective issues in findings.',
].join('\n\n')

export function assertDesignReviewCoverage(dispositions: readonly DesignReviewDisposition[], findingCount: number, kind = 'GDD') {
  const indices = dispositions.map(item => item.finding).sort((a, b) => a - b)
  if (indices.length !== findingCount || indices.some((id, index) => id !== index + 1)) {
    const seen = new Set(indices)
    const missing = Array.from({ length: findingCount }, (_, index) => index + 1).filter(id => !seen.has(id))
    const duplicate = [...new Set(indices.filter((id, index) => index > 0 && indices[index - 1] === id))]
    const unknown = [...seen].filter(id => id < 1 || id > findingCount)
    throw Error('Every original ' + kind + ' finding requires exactly one evidence-backed disposition; missing, duplicate or unknown findings cannot be accepted. ' +
      JSON.stringify({ expectedCount: findingCount, received: indices, missing, duplicate, unknown }))
  }
}

export function parseDesignReview(text: string, findingCount = 0, round = 1): DesignReviewReport {
  let value: unknown
  try { value = JSON.parse(text) }
  catch { throw Error('Independent GDD review returned invalid JSON; no automatic retry') }
  const result = reportSchema.safeParse(value)
  if (!result.success) throw Error('Independent GDD review returned an invalid report; no automatic retry')
  assertDesignReviewCoverage(result.data.resolutions ?? [], findingCount, 'GDD reviewer round ' + round)
  return result.data
}

export function assertDesignReviewReady(source: { path: string; sha256: string }, reviews: readonly DesignReviewReceipt[]) {
  const review = reviews.at(-1)
  if (!review) throw Error('GDD has no completed independent review')
  if (review.source.path !== source.path || review.source.sha256 !== source.sha256)
    throw Error('GDD changed after its independent review; the final source is unreviewed')
  if (designReviewProgress(reviews).findings.length)
    throw Error('GDD still has unresolved review findings; preserve the draft')
}

/** Rebuild the existing review loop from durable receipts, including after stop. */
export function designReviewProgress(reviews: readonly DesignReviewReceipt[]) {
  let findings: DesignReviewReport['findings'] = [], bestCount = Infinity, stalled = 0
  for (const [index, receipt] of reviews.entries()) {
    assertDesignReviewCoverage(receipt.report.resolutions ?? [], findings.length, 'GDD reviewer round ' + (index + 1))
    findings = pendingDesignReviewFindings(receipt.report, findings)
    if (findings.length) {
      stalled = findings.length < bestCount ? 0 : stalled + 1
      bestCount = Math.min(bestCount, findings.length)
    } else { bestCount = Infinity; stalled = 0 }
  }
  return { findings, rounds: reviews.length, bestCount, stalled }
}

/** Resolutions refer to the immediately preceding revision list. Unresolved
 * issues survive even if the reviewer omits them from its new findings. */
export function pendingDesignReviewFindings<Finding extends { evidence: string }>(
  report: { findings: Finding[]; resolutions?: DesignReviewDisposition[] }, previous: Finding[],
): Finding[] {
  return [...(report.resolutions ?? []).filter(item => item.status === 'unresolved').map(item => ({
    ...previous[item.finding - 1]!, evidence: item.evidence,
  })), ...report.findings]
}
