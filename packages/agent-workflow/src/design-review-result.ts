import { z } from 'zod'

// Shared by the host release boundary and the native receipt-write boundary.
export const PROJECT_DOCUMENTS = [
  'GDD.md', 'LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md', 'TECHNICAL_DESIGN.md',
  'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md',
] as const
const text = z.string().trim().min(1)
const document = z.enum(PROJECT_DOCUMENTS)
export const designReviewResultSchema = z.object({ step: z.enum(['inspect', 'revise', 'verify']),
  findings: z.array(z.object({ id: text, severity: z.enum(['blocker', 'follow-up']), action: z.enum(['correct', 'decide', 'evidence']),
    owner: z.enum([...PROJECT_DOCUMENTS, 'user']), documents: z.array(document).min(1),
    sources: z.array(z.object({ document, section: text }).strict()).min(1), impact: text, closeWhen: text,
    neededBefore: z.enum([...PROJECT_DOCUMENTS, 'resources', 'content', 'implementation', 'acceptance']).nullable() }).strict()),
  resolved: z.array(z.object({ id: text, evidence: text }).strict()),
}).strict()
export type DesignReviewResult = z.infer<typeof designReviewResultSchema>
export type DesignReviewStep = DesignReviewResult['step']
export type DesignFinding = DesignReviewResult['findings'][number]
export type DesignReviewReceiptContext = {
  step: DesignReviewStep
  findings: DesignFinding[]
  // Actual headings from host-read, version-bound delivered documents.
  sourceHeadings: Record<string, string[]>
}

export function designFindingSourceIssues(findings: DesignFinding[], headings: Record<string, string[]>) {
  const issues: string[] = []
  for (const finding of findings) {
    for (const source of finding.sources) {
      if (!headings[source.document]) issues.push(`${finding.id}: unavailable source ${source.document}`)
      else if (!headings[source.document]!.includes(source.section))
        issues.push(`${finding.id}: absent source ${source.document} / ${source.section}; section must be exact Markdown heading text, without commentary`)
    }
    if (finding.owner !== 'user' && !finding.documents.includes(finding.owner)) issues.push(`${finding.id}: affected scope excludes decision owner`)
    if (finding.severity === 'blocker' && finding.neededBefore === null) issues.push(`${finding.id}: blocker needs its first affected consumer`)
  }
  return issues
}

/** Transport/record integrity only; never certifies semantic quality or closure. */
export function designReviewResultIssues(result: DesignReviewResult, context: DesignReviewReceiptContext) {
  const issues: string[] = []
  if (result.step !== context.step) issues.push(`Expected review step ${context.step}`)
  if (new Set(result.findings.map(f => f.id)).size !== result.findings.length) issues.push('Duplicate review finding IDs.')
  if (new Set(result.resolved.map(r => r.id)).size !== result.resolved.length ||
      result.resolved.some(r => result.findings.some(f => f.id === r.id)))
    issues.push('A finding cannot have duplicate or simultaneous open/closed results.')
  issues.push(...designFindingSourceIssues(result.findings.filter(f => !context.findings.some(old => old.id === f.id)), context.sourceHeadings))
  if (result.findings.some(f => f.documents.some(name => !context.sourceHeadings[name])))
    issues.push('Findings must use actual delivered source clauses and affected documents.')
  if (context.step === 'revise') {
    if (JSON.stringify(result.findings) !== JSON.stringify(context.findings)) issues.push('Revision must preserve review findings for independent verification.')
    if (result.resolved.length) issues.push('A reviser cannot certify its own finding closure.')
  } else {
    for (const finding of result.findings) {
      const old = context.findings.find(recorded => recorded.id === finding.id)
      // Verification may describe the remaining impact after a partial fix.
      // Keep identity, scope, severity, owner, closure condition and deadline
      // immutable; updated impact prose is not a closure or downgrade.
      if (old && JSON.stringify({ ...old, impact: finding.impact }) !== JSON.stringify(finding))
        issues.push(`${finding.id}: a recorded finding cannot be redefined to evade its closure or deadline.`)
    }
    for (const resolved of result.resolved)
      if (!context.findings.some(f => f.id === resolved.id)) issues.push(`${resolved.id}: resolved must reference a recorded finding ID, not a passed check; omit routine check conclusions.`)
    for (const old of context.findings)
      if (!result.resolved.some(r => r.id === old.id) && !result.findings.some(f => f.id === old.id)) issues.push(`${old.id}: recorded finding omitted without closure evidence.`)
  }
  return issues
}

export function validateDesignReviewReceipt(content: string, context: DesignReviewReceiptContext) {
  const [status, ...lines] = content.trim().split(/\r?\n/)
  if (status !== 'complete' && status !== 'blocked') return ['First line must be complete or blocked, followed by the review JSON.']
  let value: unknown
  try { value = JSON.parse(lines.join('\n')) } catch { return ['Expected review JSON after the first status line.'] }
  const parsed = designReviewResultSchema.safeParse(value)
  if (!parsed.success) return parsed.error.issues.map(issue => `${issue.path.join('.') || 'review'}: ${issue.message}`)
  return designReviewResultIssues(parsed.data, context)
}
