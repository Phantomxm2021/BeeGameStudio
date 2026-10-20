import { array, enum as enumeration, object, string } from 'zod'
import type { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'

// Document identities used by validation and persisted baseline hashing.
// Preserve this serialization order; writing order comes from DESIGN_METHODS below.
export const PROJECT_DOCUMENTS = [
  'GDD.md', 'LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md', 'TECHNICAL_DESIGN.md',
  'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md',
] as const
// Default writing order and responsibilities. Procedure bodies stay in Skills;
// navigation and initial dispatch share this map, not another execution scheduler.
export const DESIGN_METHODS = {
  'GDD.md': { responsibility: 'direction/gameplay', skills: ['game-creative-director-expert', 'game-systems-designer-expert'] },
  'LEVEL_SCENE_DESIGN.md': { responsibility: 'levels/scenes', skills: ['game-level-designer-expert'] },
  'BALANCE_DESIGN.md': { responsibility: 'balance', skills: ['game-balance-designer-expert'] },
  'ART_DIRECTION.md': { responsibility: 'art', skills: ['game-art-director-expert'] },
  'UI_UX_SPEC.md': { responsibility: 'UI/UX', skills: ['game-ui-ux-designer'] },
  'AUDIO_DESIGN.md': { responsibility: 'audio', skills: ['game-audio-designer'] },
  'ASSET_PLAN.md': { responsibility: 'resources', skills: ['game-content-pipeline-engineer'] },
  'TECHNICAL_DESIGN.md': { responsibility: 'technology/tasks', skills: ['gameplay-programmer', 'game-implementation-planning'] },
} as const satisfies Record<typeof PROJECT_DOCUMENTS[number], { responsibility: string; skills: readonly string[] }>
export const DESIGN_WRITING_ORDER = Object.keys(DESIGN_METHODS) as Array<keyof typeof DESIGN_METHODS>

const text = string().trim().min(1)
const document = enumeration(PROJECT_DOCUMENTS)
export const designReviewResultSchema = object({ step: enumeration(['inspect', 'revise', 'verify']),
  findings: array(object({ id: text, severity: enumeration(['blocker', 'follow-up']), action: enumeration(['correct', 'decide', 'evidence']),
    owner: enumeration([...PROJECT_DOCUMENTS, 'user']), documents: array(document).min(1),
    sources: array(object({ document, section: text }).strict()).min(1), impact: text, closeWhen: text,
    neededBefore: enumeration([...PROJECT_DOCUMENTS, 'resources', 'content', 'implementation', 'acceptance']).nullable() }).strict()),
  resolved: array(object({ id: text, evidence: text,
    disposition: enumeration(['fixed', 'not-applicable']).optional() }).strict()),
  // Affected review names the earliest actually invalidated downstream work.
  resumeFrom: enumeration(['resources', 'content', 'implementation', 'acceptance']).optional(),
  resumeReason: text.optional(),
  // Execution failure is not itself a design finding or a missing user choice.
  blockedReason: text.optional(),
}).strict()
export type DesignReviewResult = z.infer<typeof designReviewResultSchema>
export type DesignReviewStep = DesignReviewResult['step']
export type DesignFinding = DesignReviewResult['findings'][number]
// Host-recorded human input, separate from the model-written review receipt.
export const designUserDecisionSchema = object({ id: text, revision: text, sourceRevision: text.optional(), toolUseID: text, question: text, answer: text }).strict()
export type DesignUserDecision = z.infer<typeof designUserDecisionSchema>
/** Blockers are immediate; follow-ups become required at their actual consumer.
 * A deadline is not permission to silently turn every later correction into an
 * early blocker. The retained finding is checked again before that consumer. */
export function requiredDesignFindings(findings: readonly DesignFinding[], nextConsumers: readonly string[] = ['resources']) {
  const production = ['resources', 'content', 'implementation', 'acceptance']
  return findings.filter(f => f.severity === 'blocker' || f.neededBefore !== null &&
    (PROJECT_DOCUMENTS.some(name => name === f.neededBefore) || nextConsumers.includes(f.neededBefore) ||
      production.includes(f.neededBefore) && nextConsumers.some(consumer =>
        production.indexOf(consumer) >= production.indexOf(f.neededBefore!))))
}
export function requiredDesignUserDecisions(findings: DesignFinding[], nextConsumers?: readonly string[]) {
  return requiredDesignFindings(findings, nextConsumers).filter(f => f.owner === 'user')
}

/** Use the existing Question header to associate each choice with its finding.
 * This checks identity, not whether a proposed design is semantically sound. */
export function designReviewQuestionIds(input: Record<string, unknown>, findings: DesignFinding[]): string[] {
  const questions = input.questions as Array<{ header?: unknown; question?: unknown }> | undefined
  if (!Array.isArray(questions) || !questions.length || questions.length > 4 || questions.some(q =>
    !q || typeof q.header !== 'string' || typeof q.question !== 'string' || !q.question.trim() ||
    !findings.some(f => f.id === q.header && f.action === 'decide')))
    throw new Error('Each design question must use a recorded decide finding ID as its header.')
  const ids = questions.map(q => q.header as string)
  if (new Set(ids).size !== ids.length || new Set(questions.map(q => q.question)).size !== questions.length)
    throw new Error('Design questions must have unique finding IDs and question text.')
  return ids
}
export type DesignReviewReceiptContext = {
  step: DesignReviewStep
  // New joint review+repair; absent for preserved legacy in-flight work.
  combined?: boolean
  findings: DesignFinding[]
  // Actual headings from host-read, version-bound delivered documents.
  sourceHeadings: Record<string, string[]>
  // Host-owned consumers; omitted only by older native callers.
  nextConsumers?: readonly string[]
  // Host-recorded downstream review with actual accepted-source changes.
  affectedChange?: boolean
}

export function findingDismissed(result: DesignReviewResult, id: string) {
  return result.step !== 'revise' && result.resolved.some(item =>
    item.id === id && item.disposition === 'not-applicable')
}

/** New user decisions discovered during Revision travel with the existing
 * Question, not a new tool or another review loop. Recorded findings stay intact. */
export function designReviewQuestionFindings(input: Record<string, unknown>, context: DesignReviewReceiptContext): DesignFinding[] {
  const metadata = input.metadata as { designFindings?: unknown } | undefined
  const added = designReviewResultSchema.shape.findings.parse(metadata?.designFindings ?? [])
  const issues = designFindingSourceIssues(added, context.sourceHeadings)
  const ids = new Set(context.findings.map(f => f.id))
  const headers = (input.questions as Array<{ header?: string }> | undefined)?.map(q => q.header) ?? []
  for (const finding of added) {
    if (ids.has(finding.id)) issues.push(`${finding.id}: a new question cannot redefine a recorded finding`)
    ids.add(finding.id)
    if (finding.owner !== 'user' || finding.action !== 'decide' || finding.severity !== 'blocker')
      issues.push(`${finding.id}: new question findings must be blocker/user/decide`)
    if (!headers.includes(finding.id)) issues.push(`${finding.id}: new decision needs a matching question header`)
    if (finding.documents.some(name => !Object.hasOwn(context.sourceHeadings, name)))
      issues.push(`${finding.id}: affected documents must be delivered sources`)
  }
  if (issues.length) throw new Error(issues.join('; '))
  const findings = [...context.findings, ...added]
  designReviewQuestionIds(input, findings)
  return findings
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
    if (finding.owner === 'user' && finding.action !== 'decide') issues.push(`${finding.id}: user direction must use decide; approval is not factual evidence`)
    if (finding.severity === 'blocker' && finding.neededBefore === null) issues.push(`${finding.id}: blocker needs its first affected consumer`)
  }
  return issues
}

/** Transport/record integrity only; never certifies semantic quality or closure. */
export function designReviewResultIssues(result: DesignReviewResult, context: DesignReviewReceiptContext, status: 'complete' | 'blocked' = 'complete') {
  const issues: string[] = []
  if (result.step !== context.step) issues.push(`Expected review step ${context.step}`)
  if (new Set(result.findings.map(f => f.id)).size !== result.findings.length) issues.push('Duplicate review finding IDs.')
  if (new Set(result.resolved.map(r => r.id)).size !== result.resolved.length ||
      result.resolved.some(r => result.findings.some(f => f.id === r.id)))
    issues.push('A finding cannot have duplicate or simultaneous open/closed results.')
  issues.push(...designFindingSourceIssues(result.findings.filter(f => !context.findings.some(old => old.id === f.id)), context.sourceHeadings))
  if (result.findings.some(f => f.documents.some(name => !context.sourceHeadings[name])))
    issues.push('Findings must use actual delivered source clauses and affected documents.')
  // A later required correction may safely wait for its actual consumer.
  // Do not force its deadline to null merely because this is combined review:
  // that would turn an acknowledged defect into an optional improvement.
  // Whether a proposed enhancement is necessary remains a source-backed
  // review judgment, not something severity alone can establish.
  if (context.step === 'revise') {
    if (context.findings.some(old => !result.findings.some(f => isDeepStrictEqual(f, old))))
      issues.push('Revision must preserve review findings for independent verification.')
    if (result.resolved.length) issues.push('A reviser cannot certify its own finding closure.')
  } else {
    for (const finding of result.findings) {
      const old = context.findings.find(recorded => recorded.id === finding.id)
      // Verification may describe the remaining impact after a partial fix.
      // Keep identity, scope, severity, owner, closure condition and deadline
      // immutable; updated impact prose is not a closure or downgrade.
      if (old && !isDeepStrictEqual({ ...old, impact: finding.impact }, finding))
        issues.push(`${finding.id}: a recorded finding cannot be redefined to evade its closure or deadline.`)
    }
    for (const resolved of result.resolved)
      if (!context.findings.some(f => f.id === resolved.id)) issues.push(`${resolved.id}: resolved must reference a recorded finding ID, not a passed check; omit routine check conclusions.`)
    for (const resolved of result.resolved) if (resolved.disposition === 'not-applicable') {
      const original = context.findings.find(f => f.id === resolved.id)
      if (original?.id.startsWith('bgs-change-provenance-'))
        issues.push(`${resolved.id}: host-detected unattributed source changes require actual user authorization; semantic dismissal cannot authorize them.`)
      if (original && !original.sources.some(source =>
        resolved.evidence.includes(source.document) && resolved.evidence.includes(source.section)))
        issues.push(`${resolved.id}: dismissing a false finding requires its actual source document and section in evidence, plus why the unchanged selected design meets the confirmed requirement; it is not a user answer.`)
    }
    for (const old of context.findings)
      if (!result.resolved.some(r => r.id === old.id) && !result.findings.some(f => f.id === old.id)) issues.push(`${old.id}: recorded finding omitted without closure evidence.`)
  }
  if (status === 'complete' && context.step === 'verify' && context.affectedChange &&
      !requiredDesignFindings(result.findings, context.nextConsumers).length &&
      (!result.resumeFrom || !(result.resumeReason || result.resolved.length)))
    issues.push('Affected verification must specify resumeFrom (resources/content/implementation/acceptance) and source-backed downstream impact in resolved evidence or resumeReason. Select the earliest actually invalidated work, not a stage inferred from document names.')
  return issues
}

export function validateDesignReviewReceipt(content: string, context: DesignReviewReceiptContext) {
  const [status, ...lines] = content.trim().split(/\r?\n/)
  if (status !== 'complete' && status !== 'blocked') return ['First line must be complete or blocked, followed by the review JSON.']
  let value: unknown
  try { value = JSON.parse(lines.join('\n')) } catch { return ['Expected review JSON after the first status line.'] }
  const parsed = designReviewResultSchema.safeParse(value)
  if (!parsed.success) return parsed.error.issues.map(issue => `${issue.path.join('.') || 'review'}: ${issue.message}`)
  return designReviewResultIssues(parsed.data, context, status)
}
