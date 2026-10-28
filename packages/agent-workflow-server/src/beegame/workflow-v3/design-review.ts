import { z } from 'zod/v4'

export const designReviewDispositionSchema = z.object({
  finding: z.number().int().min(1).describe('1-based index in the initial review findings'),
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
  resolutions: z.array(designReviewDispositionSchema).optional().describe('Omit on initial review. On follow-up, explicitly verify every original finding, including rejected findings; omission from findings is not resolution'),
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
  'Independently review the saved GDD against the supplied confirmed requirements, including the selected platform and engine. Read the complete candidate once; use targeted rereads and read-only calculations for concrete uncertainties. Do not read author history, execution logs, other reviews or unrelated project files. Do not browse, load additional Skills, write project files or delegate.',
  'Check consequential requirement mismatches, contradictory rules, and whether derived claims follow from their authoritative definitions, affected entities, units, timing and conditions. Recompute consequential examples from the saved definitions, not from an author summary. Distinguish a demonstrated contradiction from missing evidence or an explicitly conditional assumption.',
  'Every finding prevents handoff: include only a demonstrated requirement violation, consequential contradiction or invalid derivation, or a missing design decision needed to implement the agreed behavior consistently. Give its location, authoritative definitions, counterexample or missing prerequisite, and impact. Merge duplicates. Omit wording improvements and optional suggestions from the report. Diagnose the defect without prescribing replacement prose or a replacement answer; numerical counterexamples must identify their source, entities and conditions. The author must derive a correction from the saved definitions, not copy a recommended value. Do not treat a model judgment as proof.',
  'Respect design ownership: final geometry, per-frame asset specifications and runtime observations may belong to later visual/resource/implementation work. Do not demand them in the GDD unless the GDD already relies on them for a consequential claim. Playtest-dependent balance, feel and aesthetics remain explicitly unverified hypotheses; they are not automatically blockers.',
  'For a follow-up, verify each numbered author response against the current saved definitions and affected dependent claims. Return exactly one evidence-backed resolution for every original finding: corrected, rejected (the original finding was disproven), or unresolved. Your original diagnosis can be wrong; recompute the disputed relation rather than checking agreement with your prior report or the author summary. Keep outstanding defects, including contradictions introduced by these edits, in findings. Do not start another broad audit or add unrelated improvements.',
  'Return only one JSON object matching this schema. Keep the summary and each finding concise, in the user response language. An empty findings array means no material issue was found within this review, not guaranteed correctness.\n' + JSON.stringify(z.toJSONSchema(reportSchema, { target: 'draft-7' })),
].join('\n\n')

export const DESIGN_REVIEW_AUTHOR_GUIDANCE = 'Maintain a recoverable working GDD with the existing file tools; do not defer saving its body to the final result. Check a decision and its necessary calculations while writing its owning section, and reuse that evidence. Once the requested design responsibilities have a complete saved candidate, return ready for independent review. Do not perform another section-by-section semantic self-audit or reopen settled decisions for wording. A ready result requests review, not acceptance. BGS supplies the confirmed requirements and saved source to a separate read-only reviewer; do not spawn reviewers. If findings return, inspect only the implicated definitions and dependencies. Derive each disposition from those definitions, not a suggested replacement or agreement with the reviewer. Batch related edits with the existing atomic edit tool and check their affected dependencies. Return one reviewResponses entry per numbered finding with corrected/rejected/unresolved and its concrete evidence; a blanket statement that all findings were checked is insufficient. Put short necessary derivations in their owning GDD section and reference them in the response instead of repeating the document. Keep saving recoverable work. Unresolved findings leave a draft; do not regenerate or start another review loop. BGS allows one concentrated revision and one targeted follow-up. Audit completion is not game-quality certification.'


export function assertDesignReviewCoverage(dispositions: readonly DesignReviewDisposition[], findingCount: number) {
  const indices = dispositions.map(item => item.finding).sort((a, b) => a - b)
  if (indices.length !== findingCount || indices.some((id, index) => id !== index + 1))
    throw Error('Every original GDD finding requires exactly one evidence-backed disposition; missing, duplicate or unknown findings cannot be accepted')
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
    const findingCount = reviews[0]!.report.findings.length
    assertDesignReviewCoverage(review.authorResponses ?? [], findingCount)
    assertDesignReviewCoverage(review.report.resolutions ?? [], findingCount)
  }
  if (review.report.findings.length || review.report.resolutions?.some(item => item.status === 'unresolved') ||
      review.authorResponses?.some(item => item.status === 'unresolved'))
    throw Error('GDD still has unresolved review findings; preserve the draft')
}
