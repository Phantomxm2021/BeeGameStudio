import { z } from 'zod/v4'

export const designReviewDispositionSchema = z.object({
  finding: z.number().int().min(1).describe('1-based index in the current revision findings'),
  status: z.enum(['corrected', 'rejected', 'unresolved']),
  evidence: z.string().trim().min(1).describe('Saved definitions and locations supporting this disposition; for derived claims include the applicable entities, conditions and calculation, not agreement with a suggested answer'),
}).strict()
export type DesignReviewDisposition = z.infer<typeof designReviewDispositionSchema>

// The reviewer supplies evidence, not a certification of game quality.
const reportSchema = z.object({
  summary: z.string().trim().min(1),
  findings: z.array(z.object({
    location: z.string().trim().min(1),
    issue: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    impact: z.string().trim().min(1),
  }).strict()),
  resolutions: z.array(designReviewDispositionSchema).optional().describe('Omit on initial review. On follow-up, explicitly verify every current revision finding, including rejected findings; omission from findings is not resolution'),
}).strict()

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
  'Return one JSON object matching this schema, with concise user-language conclusions in summary and source-supported corrective issues in findings.\n' + JSON.stringify(z.toJSONSchema(reportSchema, { target: 'draft-7' })),
].join('\n\n')

export function assertDesignReviewCoverage(dispositions: readonly DesignReviewDisposition[], findingCount: number, kind = 'GDD') {
  const indices = dispositions.map(item => item.finding).sort((a, b) => a - b)
  if (indices.length !== findingCount || indices.some((id, index) => id !== index + 1))
    throw Error('Every original ' + kind + ' finding requires exactly one evidence-backed disposition; missing, duplicate or unknown findings cannot be accepted')
}

export function parseDesignReview(text: string, findingCount = 0): DesignReviewReport {
  let value: unknown
  try { value = JSON.parse(text) }
  catch { throw Error('Independent GDD review returned invalid JSON; no automatic retry') }
  const result = reportSchema.safeParse(value)
  if (!result.success) throw Error('Independent GDD review returned an invalid report; no automatic retry')
  assertDesignReviewCoverage(result.data.resolutions ?? [], findingCount)
  return result.data
}

export function assertDesignReviewReady(source: { path: string; sha256: string }, reviews: readonly DesignReviewReceipt[]) {
  const review = reviews.at(-1)
  if (!review) throw Error('GDD has no completed independent review')
  if (review.source.path !== source.path || review.source.sha256 !== source.sha256)
    throw Error('GDD changed after its independent review; the final source is unreviewed')
  if (reviews.length > 1) {
    const findingCount = reviews.slice(0, -1).reduce((pending, item) => pendingDesignReviewFindings(item.report, pending), [] as DesignReviewReport['findings']).length
    assertDesignReviewCoverage(review.authorResponses ?? [], findingCount)
    assertDesignReviewCoverage(review.report.resolutions ?? [], findingCount)
  }
  if (review.report.findings.length || review.report.resolutions?.some(item => item.status === 'unresolved'))
    throw Error('GDD still has unresolved review findings; preserve the draft')
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
