import { AUTHOR_BATCHES } from '../../project-author'
import { nativeWritingAuthors, type NativeWritingBatch } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { PROJECT_DOCUMENTS } from '../../project-content-authority'
import { checkDesignHandoff, checkDesignHandoffDraft, isHigherDocumentVersion, finalizeDesignDocuments, type DesignDocumentSnapshot } from '../../design-handoff'
import { checkDesignDocumentReferences } from '../../design-document-references'
import type { MilestoneResult } from '../../milestone-result'
import type { ProjectDeliveryPhase } from '../phases'
import type { DesignStageState } from '../design-state'
import { legacyIntermediateReview, LEGACY_INTERMEDIATE_REVIEW, projectAuthorDraftIssues, designCheck } from '../design-inputs'

export function preparePlanningAssignment(state: DesignStageState) {
  const batch = state.authorBatch ?? 0
  const documents = AUTHOR_BATCHES[batch]
  if (!documents) throw new Error('Unknown planning author batch: ' + batch)
  return {
    batch: batch as NativeWritingBatch,
    documents,
    authors: [1, 2, 3, 4].includes(batch) ? nativeWritingAuthors(batch as NativeWritingBatch) : undefined,
    needsSpatial: documents.some(name => name === 'LEVEL_SCENE_DESIGN.md' || name === 'UI_UX_SPEC.md'),
    needsFormat: documents.some(name => ['LEVEL_SCENE_DESIGN.md', 'UI_UX_SPEC.md', 'TECHNICAL_DESIGN.md'].includes(name)),
    needsCalculation: documents.some(name => name === 'BALANCE_DESIGN.md'),
    needsSceneCalculation: documents.some(name => name === 'LEVEL_SCENE_DESIGN.md'),
  }
}

export function checkPlanningBaseline(workspace: string, state: DesignStageState, finalizingDraft = false) {
  if (legacyIntermediateReview(state)) return [LEGACY_INTERMEDIATE_REVIEW]
  const baseline = state.designBaseline ?? state.designDrafts
  if (!baseline) return []
  const scheduled = AUTHOR_BATCHES[state.authorBatch ?? 0] ?? []
  const documents = [...new Set([...Object.keys(baseline.snapshots), ...scheduled])] as Array<typeof PROJECT_DOCUMENTS[number]>
  const check = checkDesignHandoff(workspace, documents,
    { technicalBaseline: baseline.batch < AUTHOR_BATCHES.length - 1,
      digestVersion: baseline.digestVersion ?? 1,
      nextConsumers: [] })
  const changed = Object.keys(baseline.snapshots).filter(name => baseline.snapshots[name] !== check.snapshots[name] &&
    !scheduled?.some(assigned => assigned === name))
  const changedEvidencePaths = Object.keys(baseline.evidenceHashes).filter(path => baseline.evidenceHashes[path] !== check.evidenceHashes[path])
  // Scheduled owners may revise their evidence too. Shared evidence still
  // belongs to every protected consumer, not just the current writer.
  const protectedEvidence = changedEvidencePaths.length
    ? checkDesignHandoff(workspace, Object.keys(baseline.snapshots).filter(name => !scheduled.some(assigned => assigned === name)) as Array<typeof PROJECT_DOCUMENTS[number]>).evidenceHashes
    : check.evidenceHashes
  const changedEvidence = changedEvidencePaths.filter(path => Object.hasOwn(protectedEvidence, path))
  const versionIssues = !finalizingDraft ? scheduled.flatMap(name => {
    const previous = baseline.documentVersions?.[name]
    return previous && baseline.snapshots[name] !== check.snapshots[name] &&
      (!check.documentVersions[name] || !isHigherDocumentVersion(check.documentVersions[name]!, previous))
      ? [name + ': revised document version must increase from ' + previous] : []
  }) : []
  // Draft handoffs are inspected together after all authors finish. While
  // writing, protect delivered bytes without turning a draft into approval.
  return [...versionIssues, ...(changed.length || changedEvidence.length ? [
    'Reviewed design/evidence changed outside scheduled owner scope; request an affected design-resolution before dependent work.',
    ...(changed.length ? ['Changed design owners: ' + changed.join(', ') + '.'] : []),
    ...(changedEvidence.length ? ['Changed design sources/evidence: ' + changedEvidence.join(', ') + '.'] : []),
  ] : [])]
}

export async function advancePlanning(workspacePath: string, state: DesignStageState, conclusion?: MilestoneResult,
  completedAuthorBatch?: number, documentSnapshot?: DesignDocumentSnapshot): Promise<{ state?: DesignStageState; phase: ProjectDeliveryPhase; shouldContinue: boolean; issues: string[] }> {
  let updated: DesignStageState | undefined
  const phase = 'author' as const, issues: string[] = []
  const record = (next: DesignStageState) => { updated = next }
  const evaluate = async (): Promise<{ phase: ProjectDeliveryPhase; shouldContinue: boolean; issues: string[] }> => {
    const baselineIssues = checkPlanningBaseline(workspacePath, state, !!documentSnapshot)
    if (baselineIssues.length) return { phase, shouldContinue: false, issues: baselineIssues }
    if (conclusion?.phase === phase && conclusion.status === 'blocked') return { phase, shouldContinue: false, issues: [conclusion.summary] }
    if ((state.authorBatch ?? 0) === 0 && (conclusion?.phase !== phase || conclusion.status !== 'complete'))
      return { phase, shouldContinue: false, issues: ['The author milestone has no explicit completion result from this turn.'] }
    const batch = state.authorBatch ?? 0
    if (batch > 0 && completedAuthorBatch !== batch)
      return { phase, shouldContinue: false, issues: ['The scheduled writing owners have no completion result from this turn.'] }
    issues.push(...await projectAuthorDraftIssues(workspacePath, batch))
    // GDD's terminal conclusion replaces its receipt, not its saved-draft
    // requirements. Use the host validator before accepting the handoff;
    // file existence alone cannot advance a missing/malformed outcome index.
    if (batch === 0) issues.push(...checkDesignHandoffDraft(workspacePath, 'GDD.md').issues)
    issues.push(...checkDesignDocumentReferences(workspacePath, batch).issues)
    // A completed chat or a draft file does not establish that the Agent's
    // first GDD assignment is finished. No paid repair
    // turn is dispatched for a contradictory completion signal.
    if (issues.length) {
      record({ ...state, lastValidationFailure: JSON.stringify([phase, [...issues].sort()]) })
      return { phase, shouldContinue: false, issues }
    }
    if (documentSnapshot) {
      const finalized = finalizeDesignDocuments(workspacePath, AUTHOR_BATCHES[batch], documentSnapshot)
      if (finalized.unsafeIssues.length) {
        record({ ...state, lastValidationFailure: JSON.stringify([phase, finalized.unsafeIssues]) })
        return { phase, shouldContinue: false, issues: finalized.unsafeIssues }
      }
      if (finalized.issues.length) issues.push('Saved draft handoff diagnostics await the joint inspection: ' + finalized.issues.join('; '))
    }

    const next = batch === AUTHOR_BATCHES.length - 1 ? 'review' : 'author'
    const check = designCheck(workspacePath, state)
    const designDrafts = { batch, revision: check.revision, snapshots: check.snapshots,
      documentVersions: check.documentVersions, evidenceHashes: check.evidenceHashes, digestVersion: check.digestVersion }
    record({ ...state, phase: next, authorBatch: next === 'author' ? batch + 1 : batch,
      designDrafts, lastValidationFailure: undefined })
    return { phase: next, shouldContinue: true, issues }

  }
  return { ...await evaluate(), state: updated }
}
