import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { computeWorkspaceRevision, resolveWorkspaceRelativePath } from '../../workspace-revision'
import { readRuntimeAcceptanceReport, runtimeEvidenceIsCurrent, type RuntimeAcceptance } from '../../runtime-acceptance'
import { checkProductionDesign } from '../design-protection'
import { projectDeliveryPhase } from '../phases'
import type { AcceptanceInput, AcceptanceRecord } from '../acceptance-inputs'
import type { AcceptanceDiagnostic } from '../../runtime-acceptance'
import type { ProjectDeliveryPhase } from '../phases'
import { checkReleasedDesignFindings } from '../production-findings'
import type { DesignStageState } from '../design-state'
import type { DesignFinding } from '../../design-handoff'
import { PROJECT_DELIVERY_REPORT_PATH } from '../paths'
export { reviewedImplementationInput as prepareAcceptance } from '../implementation-inputs'

export function checkAcceptanceFindings(workspace: string, baseline: DesignStageState['designBaseline'], findings?: DesignFinding[]) {
  return checkReleasedDesignFindings(workspace, 'acceptance', baseline, findings)
}

export async function validateQualityReview(workspace: string, state: AcceptanceInput | undefined,
  review: NonNullable<AcceptanceInput['qualityReview']>) {
  if (!state || !['acceptance', 'complete'].includes(projectDeliveryPhase(state)))
    throw new Error('Owner feedback requires an eight-document release candidate')
  if (!['accepted', 'changes-required'].includes(review.decision) || !review.note.trim() || !review.reviewerId.trim() ||
      review.revision !== await computeWorkspaceRevision(workspace))
    throw new Error('Owner feedback needs a reviewer, note and current revision')
  if (review.decision === 'accepted') {
    const report = await readRuntimeAcceptanceReport(workspace, PROJECT_DELIVERY_REPORT_PATH)
    if (!report || report.scope !== 'delivery' || report.status !== 'passed' || !await runtimeEvidenceIsCurrent(workspace, [report]))
      throw new Error('Repair or verify the current release before recording acceptance feedback')
  }
}

const PRODUCT_REPAIR_PREFIX = 'acceptance-product-failed:'

/** Route only evidenced product failures. Environment/coverage gaps stay here. */
export async function advanceAcceptance(workspace: string, state: AcceptanceInput,
  report: RuntimeAcceptance | undefined): Promise<{
    phase: ProjectDeliveryPhase; shouldContinue: boolean; issues: string[];
    diagnostic?: AcceptanceDiagnostic; lastValidationFailure?: string; lastProductFailureEvidence?: string
  }> {
  const phase = 'acceptance' as const, diagnostic = report?.diagnostic
  const stop = (issues: string[], failure = JSON.stringify([phase, issues])) =>
    ({ phase, shouldContinue: false, issues, diagnostic, lastValidationFailure: failure })
  const issues: string[] = []
  if (!report) issues.push(`${PROJECT_DELIVERY_REPORT_PATH} is missing`)
  else if (diagnostic?.category === 'report-invalid') issues.push(diagnostic.message)
  else if (report.scope !== 'delivery') issues.push(`${PROJECT_DELIVERY_REPORT_PATH} must have scope "delivery"`)
  else if (diagnostic?.category === 'product-failed') {
    // The same failure report cannot repeatedly schedule paid implementation.
    // Use observed outputs/evidence, not unrelated source edits or a rewritten summary.
    if (!report.evidence.length || !report.artifacts?.length)
      return stop([report.summary, 'Product repair requires saved failure evidence and the tested artifacts.'])
    const observed = [...report.evidence].sort((a, b) => a.path.localeCompare(b.path))
    const failure = PRODUCT_REPAIR_PREFIX + createHash('sha256').update(JSON.stringify(observed)).digest('hex')
    // The reader hashes the current artifact bytes. A rebuild changes those
    // hashes even when nobody reran acceptance; it is not a new observation.
    // Retain compatibility with an old in-flight repair marker without migration.
    const legacyFailure = PRODUCT_REPAIR_PREFIX + createHash('sha256').update(JSON.stringify({
      evidence: observed,
      artifacts: [...report.artifacts].sort((a, b) => a.path.localeCompare(b.path)),
    })).digest('hex')
    if (state.lastProductFailureEvidence === failure || state.lastValidationFailure === failure || state.lastValidationFailure === legacyFailure)
      return { ...stop([report.summary,
        'The same failed verification has already been handed to implementation; save actual recheck evidence before another automatic repair.'], failure),
        lastProductFailureEvidence: failure }
    return { phase: 'implementation', shouldContinue: true, issues: [report.summary],
      diagnostic, lastValidationFailure: failure, lastProductFailureEvidence: failure }
  } else if (report.status === 'blocked' || diagnostic?.category === 'verification-incomplete')
    return stop([report.summary])
  else if (report.status === 'failed') return stop([report.summary])
  else {
    const gate = await checkAcceptanceGate(workspace, state, false)
    if (!gate?.allowed) issues.push(...(gate?.issues ?? ['Current-version acceptance could not be verified'])
      .map(issue => `Publish readiness (${gate?.layer ?? 'acceptance-record'}): ${issue}`))
  }
  if (!issues.length) return { phase: 'complete', shouldContinue: false, issues: [] }
  const failure = JSON.stringify([phase, [...issues].sort()])
  return { phase, shouldContinue: state.lastValidationFailure !== failure, issues,
    diagnostic, lastValidationFailure: failure }
}

function acceptanceDesignIssues(workspace: string, state: AcceptanceInput) {
  if (!state.designBaseline) return []
  return checkProductionDesign(workspace,
    { ...state.designBaseline, digestVersion: state.designBaseline.digestVersion ?? 1 }, 'acceptance').issues
}

export async function captureAcceptance(workspacePath: string, state: AcceptanceInput, turnStartedAt: number): Promise<AcceptanceRecord | undefined> {
  if (!state || state.status !== 'active') return
  if (!['acceptance', 'complete'].includes(projectDeliveryPhase(state))) return
  // A new runtime report cannot adopt an unreviewed design mutation.
  if (state.designBaseline && (acceptanceDesignIssues(workspacePath, state).length || (state.designBaseline.digestVersion ?? 1) < 2)) return

  const canonicalWorkspace = await realpath(workspacePath)
  const freshReports: Array<{ path: string; absolutePath: string; mtimeMs: number; report?: RuntimeAcceptance }> = []
  for (const path of [PROJECT_DELIVERY_REPORT_PATH]) {
    const candidatePath = resolveWorkspaceRelativePath(workspacePath, path)
    if (!candidatePath) continue
    let canonicalReportPath: string
    try { canonicalReportPath = await realpath(candidatePath) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const relativeReportPath = relative(canonicalWorkspace, canonicalReportPath)
    if (!relativeReportPath || relativeReportPath === '..' ||
        relativeReportPath.startsWith(`..${sep}`) || isAbsolute(relativeReportPath)) continue

    let reportStat
    try { reportStat = await stat(canonicalReportPath) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    // A previous report cannot certify work performed in this turn.
    if (!reportStat.isFile() || reportStat.mtimeMs < turnStartedAt) continue

    let raw: unknown
    try { raw = JSON.parse(await readFile(canonicalReportPath, 'utf8')) }
    catch { continue }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const scope = (raw as { scope?: unknown }).scope
    // Only the current delivery-scoped Chat report is authoritative.
    if (scope !== 'delivery') continue
    freshReports.push({
      path,
      absolutePath: canonicalReportPath,
      mtimeMs: reportStat.mtimeMs,
      report: await readRuntimeAcceptanceReport(workspacePath, path),
    })
  }

  // Do not fall back to an older passing report if the latest delivery report
  // from this turn is failed, blocked, malformed, or has stale evidence.
  const latest = freshReports.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]
  const report = latest?.report
  if (!latest || latest.path !== PROJECT_DELIVERY_REPORT_PATH || !report ||
      report.scope !== 'delivery' || report.status !== 'passed' ||
      !await runtimeEvidenceIsCurrent(workspacePath, [report])) return
  const reportSha256 = createHash('sha256').update(await readFile(latest.absolutePath)).digest('hex')
  const revision = await computeWorkspaceRevision(workspacePath)
  if (state.accepted?.source === 'report' && state.accepted.reportSha256 === reportSha256 &&
      state.accepted.revision === revision && JSON.stringify(state.accepted.reports) === JSON.stringify([report])) return
  return { source: 'report', revision, reportPath: latest.path, reportSha256, reports: [report] }
}

export async function checkAcceptanceGate(workspacePath: string, state: AcceptanceInput, requireComplete = true): Promise<{
  allowed: boolean
  issues: string[]
  layer: 'report' | 'acceptance-record' | 'delivery' | 'revision' | 'ready'
  acceptance?: { revision: string; artifacts: Array<{ path: string; sha256: string }> }
} | undefined> {
  if (!state) return undefined
  if (state.designRepair && state.designRepair.status !== 'resolved')
    return { allowed: false, layer: 'delivery', issues: ['Affected design is pending or stopped; earlier acceptance does not cover current sources.'] }
  if (state.designBaseline) {
    const issues = acceptanceDesignIssues(workspacePath, state)
    if ((state.designBaseline.digestVersion ?? 1) < 2) issues.push('Legacy UI fingerprint requires affected inspection before current-version release.')
    if (issues.length) return { allowed: false, layer: 'revision', issues }
  }
  if (state.qualityReview?.decision === 'changes-required' &&
      state.qualityReview.revision === await computeWorkspaceRevision(workspacePath))
    return { allowed: false, layer: 'delivery', issues: [state.qualityReview.note] }
  if (!state.accepted) {
    const report = await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
    return { allowed: false, layer: report?.status === 'blocked' ? 'report' : 'acceptance-record', issues: report?.status === 'blocked'
      ? [report.summary] : ['Current project has no verified delivery acceptance.'] }
  }
  if (requireComplete && projectDeliveryPhase(state) !== 'complete')
    return { allowed: false, layer: 'delivery', issues: ['Project delivery is still in progress.'] }
  const { accepted } = state
  if (accepted.revision !== await computeWorkspaceRevision(workspacePath))
    return { allowed: false, layer: 'revision', issues: ['Workspace changed after acceptance; revalidation is required.'] }
  if (accepted.source !== 'report') {
    return { allowed: false, layer: 'acceptance-record', issues: ['Current version requires a delivery acceptance report.'] }
  }
  if (accepted.reportPath !== PROJECT_DELIVERY_REPORT_PATH)
    return { allowed: false, layer: 'revision', issues: ['Delivery evidence changed after acceptance; revalidation is required.'] }
  let reportSha256: string
  try {
    const candidate = resolveWorkspaceRelativePath(workspacePath, accepted.reportPath)
    if (!candidate) throw new Error('invalid report path')
    const actual = await realpath(candidate)
    const relativePath = relative(await realpath(workspacePath), actual)
    if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath))
      throw new Error('report escapes project workspace')
    reportSha256 = createHash('sha256')
      .update(await readFile(candidate))
      .digest('hex')
  } catch {
    return { allowed: false, layer: 'report', issues: ['Delivery acceptance report is missing.'] }
  }
  const currentReport = await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
  if (currentReport?.scope !== 'delivery' || currentReport.status !== 'passed')
    return { allowed: false, layer: 'report', issues: currentReport?.status === 'blocked'
      ? [currentReport.summary] : ['Delivery acceptance report is not a current delivery PASS.'] }
  if (reportSha256 !== accepted.reportSha256 ||
      !await runtimeEvidenceIsCurrent(workspacePath, accepted.reports))
    return { allowed: false, layer: 'revision', issues: ['Delivery evidence changed after acceptance; revalidation is required.'] }
  return { allowed: true, layer: 'ready', issues: [],
    acceptance: { revision: accepted.revision, artifacts: accepted.reports.flatMap(report => report.artifacts ?? []) } }
}



export const acceptanceInstruction = `Current delivery milestone: acceptance. Determine whether the current game fully implements the reviewed design and is usable in the agreed runtime environment.

Acceptance basis:
Derive checks from the confirmed scope and reviewed eight documents, including completion conditions and runtime-dependent questions left open in those documents. Scene/UI and resource data describe the corresponding content; neither the existing implementation nor an Agent summary replaces the agreed requirements.
Cover each owned output declaring acceptance against its actual source conditions and expected results, reusing valid implementation evidence. Also inspect the confirmed scope for necessary checks the author omitted; a complete declared checklist does not establish a complete game. Missing design decisions go to the owner; missing implementation returns to implementation, while missing verification evidence is collected here against the existing requirement.
Read the implementation handoff and existing evidence to identify remaining verification. Reuse results still valid for the current version; do not repeat the whole development process or write a separate long acceptance plan.

Verification:
Choose methods and order appropriate to the project, covering applicable requirements:
- Complete experience: agreed gameplay, screens and levels, and the transitions through start, play, outcomes, retry and other key states.
- Rules and boundaries: behavior, calculations and state transitions against the design, including important edge cases and abnormal operations.
- Player-facing result: actual composition, framing, resources, text, interaction feedback and audio against the reviewed Art/UI clauses and actual Scene/UI data under the agreed display conditions and input methods. Use supplied visual references where relevant, allowing documented adaptation but identifying lost hierarchy, inconsistent type/icon treatment, crude substitutions or missing finish. Describe concrete visible defects, not invented aesthetic scores; user silence is not visual acceptance. Verify usable control bounds, not merely element presence or successful navigation. Keep actual visual captures or equivalent target-device evidence where relevant, not independently authored mockups.
- Experience evidence: use game-playtest-performance to distinguish rule correctness, understandable feedback and intended experience. An Agent's route or a bot pass is not real-player approval. Report experience observations and unresolved hypotheses within the agreed scope; do not fabricate player reactions or add a mandatory human-study gate.
- Data consumption: the corresponding Scene/UI and resource data actually drives runtime behavior rather than merely loading before an independent substitute implementation runs.
Use deterministic tests for rules where useful, and observation in the actual target runtime for presentation and interaction. Match depth to project complexity and risk without expanding the agreed platform, device or content scope. Document-stage simulations and review conclusions are not runtime evidence.

Evidence and judgments:
Connect each conclusion to the requirement, the check performed and the observed outcome. A check establishes only what it directly covers; a similar visible effect is not proof of the required behavior.
Select binding checks applicable to the registered documents and actual components. Do not claim Tilemap verification for a scene without a Tilemap component. Successful resource loading does not establish that changing a resource reference changes the rendered or played asset.
For binding verification, change representative applicable data in a temporary copy or recoverable test setup and observe the corresponding runtime result. Restore test changes and keep them out of the delivered version.
Distinguish product defects, unavailable environments and inconclusive test-driver behavior. Record unobserved requirements as unverified rather than inferring success or failure. Fill report fields from the actual data and evidence, not to populate unrelated check categories. A report-format check is not verification of the report's claims or runtime evidence.

Defects and retesting:
Record implementation/content defects with their exact requirement, failing behavior, saved evidence and tested artifacts. Hand product corrections back to implementation; do not silently rewrite the game during acceptance. After implementation repairs the defect, recheck affected behavior and reuse still-valid evidence. A local correction does not automatically require every check to run again.
If documents conflict, necessary design decisions are missing or resolving the issue would change the confirmed scope, report evidence and impact. Do not edit the reviewed design or lower requirements to obtain a pass. Continue unaffected checks where useful.
The final conclusion and saved evidence must apply to the delivered version. Revalidate results invalidated by fixes and record the actual tested deployment artifacts, not temporary test variants.

Delivery result:
Report passed only when the agreed scope is complete, required checks pass and no in-scope issues or unverified requirements remain. Record confirmed unresolved defects as failed; when necessary verification or a required decision is unavailable, report blocked and explain the limitation. Disclose all known issues and unverified requirements regardless of the overall status; never reclassify an in-scope gap as outsideScope to obtain a pass.
Save the result and evidence using the existing report contract at ${PROJECT_DELIVERY_REPORT_PATH}, including evidencePaths and artifactPaths for the tested delivery. A conversational PASS does not replace this record. Briefly report the conclusion, major findings/fixes, verified scope and unresolved issues.
artifactPaths must cover the complete tested static output (prefer its build directory, not only index.html). Publishing copies these verified bytes without rebuilding.
Tools, verification methods and subagent delegation are yours to choose.`
