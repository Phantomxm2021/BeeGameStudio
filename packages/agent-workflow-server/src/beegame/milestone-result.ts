import { readFile } from 'node:fs/promises'
import { designReviewResultSchema, type DesignReviewResult } from './design-handoff'
import { array, object, string } from 'zod'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'

const documentName = string().transform(value => value.startsWith('docs/') ? value.slice(5) : value)
  .pipe(designReviewResultSchema.shape.findings.element.shape.documents.element)
const productionFinding = designReviewResultSchema.shape.findings.element.extend({
  owner: string().transform(value => value.startsWith('docs/') ? value.slice(5) : value)
    .pipe(designReviewResultSchema.shape.findings.element.shape.owner),
  documents: array(documentName).min(1),
  sources: array(object({ document: documentName, section: string().trim().min(1) }).strict()).min(1),
})
export const productionHandoffSchema = object({ summary: string().trim().min(1),
  designIssues: array(productionFinding), resolved: designReviewResultSchema.shape.resolved.optional(),
}).strict()
export const PRODUCTION_HANDOFF_INSTRUCTION = `Optional JSON after the status line: {summary:nonempty string,designIssues:[{id,severity:"blocker"|"follow-up",action:"correct"|"decide"|"evidence",owner,documents,sources:[{document,section:exact Markdown heading}],impact,closeWhen,neededBefore:resources|content|implementation|acceptance|null}],resolved?:[{id,evidence,disposition:"fixed"|"not-applicable"}]}. Document values are ${PROJECT_DOCUMENTS.join(', ')}; the docs/ prefix is also accepted. Only owner may be "user". Cite the owning document/section; mention supporting Scene/UI paths in impact or evidence, not documents/sources.document. No other envelope keys. Preserve reported issues during format repair; if an earlier issue is withdrawn or fixed, retain its ID in resolved with the concrete reason/evidence. Plain-text receipts remain valid when no issues were reported.`

/** Explicit Agent conclusion, not a quality judgment inferred from chat text. */
export type MilestoneResult = {
  phase: 'author' | 'review' | 'resources' | 'content' | 'implementation'
  // invalid is a reader diagnostic, never an Agent completion signal.
  status: 'complete' | 'blocked' | 'invalid'
  summary: string
  review?: DesignReviewResult
  designIssues?: DesignReviewResult['findings']
  validationIssues?: string[]
  resolved?: DesignReviewResult['resolved']
  /** IDs from even malformed envelopes must not vanish during format repair. */
  reportedIssueIds?: string[]
}

export async function readMilestoneResult(path: string, phase: MilestoneResult['phase']): Promise<MilestoneResult | undefined> {
  try {
    return parseMilestoneResult(await readFile(path, 'utf8'), phase)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

/** The same explicit conclusion may travel in a file or a native final result.
 * Never infer completion from intermediate chat text or saved-file existence. */
export function parseMilestoneResult(content: string, phase: MilestoneResult['phase'], label = 'Milestone receipt'): MilestoneResult {
  const [statusLine, ...lines] = content.trim().split(/\r?\n/)
  // Normalize only the status token, not reasons or case-sensitive review JSON.
  const status = statusLine.trim().toLowerCase()
  if (status !== 'complete' && status !== 'blocked') return {
    phase, status: 'invalid', summary: '',
    validationIssues: [label + ' first line must be complete or blocked (case-insensitive).'],
  }
  const summary = lines.join('\n').trim()
  if (status === 'blocked' && !summary) return {
    phase, status: 'invalid', summary: '',
    validationIssues: [label === 'Milestone receipt' ? 'Blocked milestone receipt must include a reason or review JSON after its status line.'
      : 'Blocked ' + label.toLowerCase() + ' must include a reason after its status line.'],
  }
  if (phase === 'review') {
    let value: unknown
    try { value = JSON.parse(summary) } catch {
      return { phase, status, summary, validationIssues: ['Review receipt must contain JSON after its status line.'] }
    }
    const parsed = designReviewResultSchema.safeParse(value)
    if (!parsed.success) return { phase, status, summary, validationIssues: parsed.error.issues.map(issue =>
      `Review receipt ${issue.path.join('.') || 'review'}: ${issue.message}`) }
    return { phase, status, summary, review: parsed.data }
  }
  // Optional structured handoff; existing plain-text receipts remain valid.
  if (summary.startsWith('{')) {
    let value: unknown
    try { value = JSON.parse(summary) } catch {
      return summary.includes('"designIssues"')
        ? { phase, status: 'invalid', summary, validationIssues: ['Malformed designIssues JSON; use {summary, designIssues}.'] }
        : { phase, status, summary }
    }
    // Old receipts may contain arbitrary JSON/text reasons. Only the explicit
    // designIssues envelope selects this new optional transport.
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'designIssues'))
      return { phase, status, summary }
    const data = value as Record<string, unknown>
    const reportedIssueIds = Array.isArray(data.designIssues) ? data.designIssues.flatMap(issue =>
      issue && typeof issue.id === 'string' && issue.id.trim() ? [issue.id.trim()] : []) : []
    const parsed = productionHandoffSchema.safeParse(data)
    if (!parsed.success) return { phase, status: 'invalid', summary, reportedIssueIds,
      validationIssues: parsed.error.issues.map(issue => `Milestone ${issue.path.join('.') || 'JSON'}: ${issue.message}`) }
    return { phase, status, summary: parsed.data.summary, designIssues: parsed.data.designIssues,
      ...(parsed.data.resolved ? { resolved: parsed.data.resolved } : {}), reportedIssueIds }
  }
  return { phase, status, summary }
}
