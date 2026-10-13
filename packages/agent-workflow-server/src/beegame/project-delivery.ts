import { advancePlanning, checkPlanningBaseline } from './delivery/stages/planning'
import { prepareReview, interruptedReview, designQuestionContext, recordReviewUserDecision, requestReviewResolution, advanceReview } from './delivery/stages/review'
import { legacyIntermediateReview, LEGACY_INTERMEDIATE_REVIEW } from './delivery/design-inputs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { projectContentAuthority } from './project-content-authority'
import { AUTHOR_BATCHES, authorBatchInstruction, authorBatchReviewInstruction } from './project-author'
import type { DesignDocumentSnapshot, DesignFinding, DesignReviewStep } from './design-handoff'
export { PROJECT_DOCUMENTS, projectContentAuthority } from './project-content-authority'
import { type BeeGameContentAuthority } from './game-content-package'
import { materializeSceneUiFormat } from './scene-ui-content-authoring'
import { ASSET_MANIFEST_AUTHORING_CONTRACT_PATH, materializeAssetManifestAuthoringContract } from './asset-manifest-authoring-contract'
import {
  readRuntimeAcceptanceReport,
  type AcceptanceDiagnostic,
} from './runtime-acceptance'

import { PROJECT_DELIVERY_REPORT_PATH } from './delivery/paths'
export { PROJECT_DELIVERY_REPORT_PATH, PROJECT_CONTENT_CONTRACT_PATH } from './delivery/paths'
import { resourcesInstruction, checkResourceResult } from './delivery/stages/resources'
import { contentInstruction, checkContentResult } from './delivery/stages/content'
import { checkProductionDesign } from './delivery/design-protection'
import { implementationInstruction, checkImplementationResult } from './delivery/stages/implementation'
import { acceptanceInstruction, captureAcceptance, checkAcceptanceGate, advanceAcceptance, checkAcceptanceFindings } from './delivery/stages/acceptance'

export { projectDeliveryPhase } from './delivery/phases'
export type { ProjectDeliveryPhase } from './delivery/phases'
import { projectDeliveryPhase, NEXT_PHASE, type ProjectDeliveryPhase } from './delivery/phases'
import type { ProjectDeliveryState } from './delivery/state'
import { readProjectDelivery, save, withStateMutation } from './delivery/state-store'
export { readProjectDelivery, projectDeliveryStatePath } from './delivery/state-store'

/** Deliverables and platform interfaces, not a script for the Agent's work. */
export function projectDeliveryPhaseInstruction(phase: ProjectDeliveryPhase, authorBatch = phase === 'review' ? AUTHOR_BATCHES.length - 1 : 0): string {
  switch (phase) {
    case 'author': return authorBatchInstruction(authorBatch)
    case 'review': return authorBatchReviewInstruction(authorBatch)
    case 'resources': return resourcesInstruction
    case 'content': return contentInstruction
    case 'implementation': return implementationInstruction
    case 'acceptance': return acceptanceInstruction
    case 'complete': return 'The original project delivery is complete. Follow the current user request.'
  }
}

export { projectDesignNextConsumers, projectDesignReleaseDiagnostics, projectDesignReleaseReport } from './delivery/design-inputs'

export async function prepareProjectDesignReview(workspace: string, dataRoot: string) {
  return withStateMutation(workspace, dataRoot, async () => {
    const state = await readProjectDelivery(workspace, dataRoot)
    const next = await prepareReview(workspace, state)
    if (!state || !next || next === state) return state
    const saved = { ...state, ...next }
    await save(workspace, dataRoot, saved)
    return saved
  })
}
export async function recordInterruptedDesignRevision(workspace: string, dataRoot: string, prepared: ProjectDeliveryState,
  before: DesignDocumentSnapshot, writes: { before: Record<string, string | null>; completed: Record<string, string | null> }) {
  return withStateMutation(workspace, dataRoot, async () => {
    const state = await readProjectDelivery(workspace, dataRoot)
    const next = await interruptedReview(workspace, state, prepared, before, writes)
    if (state && next) await save(workspace, dataRoot, { ...state, ...next })
  })
}
export async function projectDesignQuestionContext(workspace: string, dataRoot: string, revision: string) {
  return designQuestionContext(workspace, await readProjectDelivery(workspace, dataRoot), revision)
}
export async function recordProjectDesignUserDecision(workspace: string, dataRoot: string, revision: string,
  toolUseID: string, input: Record<string, unknown>, sourceRevision = revision) {
  return withStateMutation(workspace, dataRoot, async () => {
    const state = await readProjectDelivery(workspace, dataRoot)
    const next = await recordReviewUserDecision(workspace, state, revision, toolUseID, input, sourceRevision)
    await save(workspace, dataRoot, { ...state!, ...next })
  })
}
export async function requestProjectDesignResolution(workspace: string, dataRoot: string, input: {
  instruction: string; mode: DesignReviewStep; findings: DesignFinding[]
}) {
  return withStateMutation(workspace, dataRoot, async () => {
    const state = await readProjectDelivery(workspace, dataRoot)
    const next = await requestReviewResolution(workspace, state, input)
    const saved = { ...state!, ...next }
    await save(workspace, dataRoot, saved)
    return saved
  })
}

/** Before dispatch and after completion: a changed baseline is not permission for paid dependent work. */
export function checkProjectDesignBaseline(workspace: string, state: ProjectDeliveryState, finalizingDraft = false) {
  if (legacyIntermediateReview(state)) return [LEGACY_INTERMEDIATE_REVIEW]
  const phase = projectDeliveryPhase(state)
  if (phase === 'author') return checkPlanningBaseline(workspace, state, finalizingDraft)
  if (phase === 'review' || !state.designBaseline) return []
  return checkProductionDesign(workspace, { ...state.designBaseline, digestVersion: state.designBaseline.digestVersion ?? 1 },
    phase === 'complete' ? 'acceptance' : phase).issues
}

export async function projectRuntimeReview(workspace: string) {
  const report = await readRuntimeAcceptanceReport(workspace, PROJECT_DELIVERY_REPORT_PATH)
  return report ? { scope: report.scope, status: report.status, summary: report.summary } : undefined
}

export async function beginProjectDelivery(workspacePath: string, dataRoot: string, objective: string): Promise<ProjectDeliveryState> {
  return withStateMutation(workspacePath, dataRoot, async () => {
  const existing = await readProjectDelivery(workspacePath, dataRoot)
  if (existing) {
    if (existing.objective !== objective) throw new Error('Project delivery already has a different objective')
    return existing
  }
  const state: ProjectDeliveryState = { version: 1, objective, status: 'active', phase: 'author' }
  await ensureProjectAssetManifestContract(workspacePath)
  await materializeSceneUiFormat(workspacePath)
  await save(workspacePath, dataRoot, state)
  return state
  })
}

/** Project-local reference files expose the host's real resource interface to the Agent. */
export async function ensureProjectAssetManifestContract(workspacePath: string): Promise<void> {
  try {
    const files = await Promise.all([ASSET_MANIFEST_AUTHORING_CONTRACT_PATH, 'assets/manifest/check.mjs']
      .map(path => stat(join(workspacePath, path))))
    if (files.every(file => file.isFile() && file.size > 0)) return
  } catch { /* Missing project-local reference files are created below. */ }
  await materializeAssetManifestAuthoringContract(workspacePath)
}

export { prepareContentContract as refreshProjectContentContract } from './delivery/stages/content'

export async function pauseProjectDelivery(workspacePath: string, dataRoot: string): Promise<void> {
  await withStateMutation(workspacePath, dataRoot, async () => {
    const state = await readProjectDelivery(workspacePath, dataRoot)
    if (state) await save(workspacePath, dataRoot, { ...state, status: 'paused' })
  })
}

export async function resumeProjectDelivery(workspacePath: string, dataRoot: string): Promise<ProjectDeliveryState | undefined> {
  return withStateMutation(workspacePath, dataRoot, async () => {
  let state = await readProjectDelivery(workspacePath, dataRoot)
  if (state?.status === 'paused') {
    const resumed = { ...state, status: 'active' as const }
    await save(workspacePath, dataRoot, resumed)
    return resumed
  }
  return state
  })
}

/** Advance only after a successful native turn; validation issues keep the same milestone. */
export async function advanceProjectDeliveryAfterTurn(workspacePath: string, dataRoot: string, conclusion?: import('./milestone-result').MilestoneResult,
  completedAuthorBatch?: number, documentSnapshot?: DesignDocumentSnapshot): Promise<{
  phase: ProjectDeliveryPhase
  shouldContinue: boolean
  issues: string[]
  diagnostic?: AcceptanceDiagnostic
} | undefined> {
  return withStateMutation(workspacePath, dataRoot, async () => {
  const initial = await readProjectDelivery(workspacePath, dataRoot)
  if (!initial || initial.status !== 'active') return undefined
  let state: ProjectDeliveryState = initial
  const phase = projectDeliveryPhase(state)
  if (phase === 'complete') return { phase, shouldContinue: false, issues: [] }
  if (legacyIntermediateReview(state)) return { phase, shouldContinue: false, issues: [LEGACY_INTERMEDIATE_REVIEW] }
  if (conclusion?.phase === phase && conclusion.status === 'invalid')
    return { phase, shouldContinue: false, issues: conclusion.validationIssues ?? ['Invalid milestone receipt.'] }
  if (phase === 'author' || phase === 'review') {
    const result = phase === 'author'
      ? await advancePlanning(workspacePath, state, conclusion, completedAuthorBatch, documentSnapshot)
      : await advanceReview(workspacePath, state, conclusion, documentSnapshot)
    if (result.state) {
      await save(workspacePath, dataRoot, { ...state, ...result.state })
    }
    const { state: _updated, ...outcome } = result
    return outcome
  }
  const issues: string[] = []
  const acceptanceReport = phase === 'acceptance' ? await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH) : undefined
  const implementationCheck = phase === 'implementation' ? checkImplementationResult(workspacePath, state.designBaseline, conclusion) : undefined
  const productionCheck = (phase === 'content' || phase === 'resources') && state.designBaseline
    ? (phase === 'content' ? checkContentResult : checkResourceResult)(workspacePath, { objective: state.objective,
      baseline: { ...state.designBaseline, digestVersion: state.designBaseline.digestVersion ?? 1 } }, conclusion) : undefined
  {
    const report = acceptanceReport
    const findings = conclusion?.phase === phase ? conclusion.designIssues : report?.designIssues
    const checked = productionCheck ? { issues: productionCheck.blockingIssues, followUps: productionCheck.followUps }
      : implementationCheck ?? checkAcceptanceFindings(workspacePath, state.designBaseline, findings)
    if (checked.issues.length) {
      const reasons = checked.issues
      const reason = 'Frozen design is not reopened automatically. Correct production within the accepted requirements; a necessary design change needs explicit owner direction. ' + reasons.join('; ')
      await save(workspacePath, dataRoot, { ...state, lastValidationFailure: reason })
      return { phase, shouldContinue: false, issues: [reason] }
    }
    if (findings?.length && state.designBaseline) {
      state = { ...state, designBaseline: { ...state.designBaseline,
        followUps: checked.followUps } }
      await save(workspacePath, dataRoot, state)
    }
  }
  if (conclusion?.phase === phase && conclusion.status === 'blocked')
    return { phase, shouldContinue: false, issues: [conclusion.summary] }
  if (implementationCheck?.receiptIssues.length)
    return { phase, shouldContinue: false, issues: implementationCheck.receiptIssues }
  if (phase === 'content' || phase === 'resources') {
    if (!productionCheck) return { phase, shouldContinue: false, issues: [phase === 'content'
      ? 'Content handoff requires a reviewed design baseline.' : 'Resources handoff requires a reviewed design baseline.'] }
    if (productionCheck.receiptIssues.length) return { phase, shouldContinue: false, issues: productionCheck.receiptIssues }
    issues.push(...productionCheck.issues)
  } else if (phase === 'acceptance') {
    const { lastValidationFailure, lastProductFailureEvidence, ...result } = await advanceAcceptance(workspacePath, state, acceptanceReport)
    await save(workspacePath, dataRoot, { ...state, phase: result.phase, lastValidationFailure,
      lastProductFailureEvidence: lastProductFailureEvidence ?? state.lastProductFailureEvidence })
    return result
  }

  if (issues.length) {
    const failure = JSON.stringify([phase, [...issues].sort()])
    await save(workspacePath, dataRoot, { ...state, phase, lastValidationFailure: failure })
    // Send new diagnostic information once. Unrelated edits are not evidence
    // of progress and must not continually re-arm a paid automatic turn.
    // This deduplicates host dispatch, not the Agent's own repair attempts or
    // explicit user turns (which are always delivered).
    return { phase, shouldContinue: state.lastValidationFailure !== failure, issues }
  }
  const next = NEXT_PHASE[phase]
  await save(workspacePath, dataRoot, { ...state, phase: next,
    lastValidationFailure: undefined })
  return { phase: next, shouldContinue: next !== 'complete', issues: [] }
  })
}

/** Capture an Agent's fresh delivery report once. Later file changes cannot silently re-baseline it. */
export async function captureProjectDeliveryAcceptance(workspacePath: string, dataRoot: string, turnStartedAt: number): Promise<void> {
  await withStateMutation(workspacePath, dataRoot, async () => {
    const state = await readProjectDelivery(workspacePath, dataRoot)
    if (!state) return
    const accepted = await captureAcceptance(workspacePath, state, turnStartedAt)
    if (accepted) await save(workspacePath, dataRoot, { ...state,
      ...(state.accepted ? { acceptanceHistory: [...state.acceptanceHistory ?? [], state.accepted] } : {}), accepted })
  })
}

export async function evaluateProjectDeliveryGate(workspacePath: string, dataRoot: string, requireComplete = true) {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  return state ? checkAcceptanceGate(workspacePath, state, requireComplete) : undefined
}

/** Editor authority comes from the authored package, not a delivery phase snapshot. */
export function nativeContentAuthority(workspacePath: string): BeeGameContentAuthority {
  return projectContentAuthority(workspacePath)
}
