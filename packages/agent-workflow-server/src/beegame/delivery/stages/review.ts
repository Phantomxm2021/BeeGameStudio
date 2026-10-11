import { isDeepStrictEqual } from 'node:util'
import { AUTHOR_BATCHES, authorBatchReviewInstruction } from '../../project-author'
import { PROJECT_DOCUMENTS } from '../../project-content-authority'
import { checkDesignDocumentReferences } from '../../design-document-references'
import { isHigherDocumentVersion, checkDesignHandoff, checkDesignFindingSources, designReviewSourceHeadings, designReviewResultSchema,
  finalizeDesignDocuments, snapshotDesignRevisionFiles, designRevisionFileDigest, designImplementationRevisionDocuments,
  changedDesignSections, designSupportingFiles, designHandoffPath, designReviewReadScope, type DesignDocumentSnapshot, type DesignFinding, type DesignReviewStep } from '../../design-handoff'
import { designReviewResultIssues, findingDismissed, requiredDesignFindings, requiredDesignUserDecisions, designReviewQuestionIds, designReviewQuestionFindings } from '@bee-game-studio/agent-workflow/design-review-result'
import { answeredQuestionInput } from '../../user-question'
import { projectDeliveryPhase, type ProjectDeliveryPhase } from '../phases'
import type { DesignStageState } from '../design-state'
import { designCheck, projectAuthorDraftIssues, projectDesignNextConsumers, projectDesignReleaseReport, legacyIntermediateReview, LEGACY_INTERMEDIATE_REVIEW } from '../design-inputs'
import type { MilestoneResult } from '../../milestone-result'

const diagnosticOwner = (issue: string) => PROJECT_DOCUMENTS.find(name => issue.startsWith(name + ':') || issue.startsWith('docs/' + name + ':'))

/** The prompt, native permissions and completion read check consume one scope. */
export function prepareReviewAssignment(workspace: string, state: DesignStageState) {
  const review = state.designReview
  if (!review || state.status !== 'active' || projectDeliveryPhase(state) !== 'review') return
  const documents = review.writableDocuments ?? (review.step === 'inspect' ? [...PROJECT_DOCUMENTS]
    : [...new Set(requiredDesignFindings(review.findings, projectDesignNextConsumers(state)).flatMap(f => f.documents))])
  const writableFiles = review.step === 'revise'
    ? [...documents.map(designHandoffPath), ...designSupportingFiles(workspace, documents)] : []
  const readScope = !(review.combined && review.step === 'revise' && !review.affectedDocuments) &&
    (review.step !== 'inspect' || review.returnPhase)
    ? { ...Object.fromEntries(documents.map(name => [name, [] as string[]])),
      ...designReviewReadScope(workspace, review.affectedDocuments ?? documents, review.findings, review.changedSections) } : undefined
  const inputDocuments = readScope
    ? Object.keys(readScope).filter(name => readScope[name] === null || readScope[name]!.length > 0) : documents
  const inputs = [...inputDocuments, ...review.findings.flatMap(f => f.sources.map(source => source.document))]
  return {
    documents, writableFiles, readScope, inputDocuments, inputs,
    needsSpatial: inputs.some(name => ['LEVEL_SCENE_DESIGN.md', 'UI_UX_SPEC.md'].includes(name)),
    needsCalculation: inputs.some(name => ['BALANCE_DESIGN.md', 'LEVEL_SCENE_DESIGN.md'].includes(name)),
    needsFormat: documents.includes('TECHNICAL_DESIGN.md'),
    instruction: authorBatchReviewInstruction(state.authorBatch ?? AUTHOR_BATCHES.length - 1,
      review.step, review.findings, review.instruction, inputDocuments, projectDesignNextConsumers(state), review.combined),
    receiptContext: { step: review.step, combined: review.combined, findings: review.findings,
      affectedChange: !!(review.returnPhase && review.changedDocuments?.length),
      nextConsumers: projectDesignNextConsumers(state),
      sourceHeadings: designReviewSourceHeadings(workspace, Object.keys(review.snapshots)) },
  }
}

function prepareAffectedDesignResolution(workspace: string, state: DesignStageState, input: {
  findings?: DesignFinding[]; upgrade?: boolean
}): DesignStageState | undefined {
  const savedPhase = projectDeliveryPhase(state), phase = savedPhase === 'complete' ? 'acceptance' : savedPhase, baseline = state.designBaseline
  if (!baseline || !['resources', 'content', 'implementation', 'acceptance'].includes(phase)) return
  const original = checkDesignHandoff(workspace, PROJECT_DOCUMENTS, { digestVersion: baseline.digestVersion ?? 1 })
  const changed = Object.keys(baseline.snapshots).filter(name => baseline.snapshots[name] !== original.snapshots[name])
  const changedEvidence = Object.keys(baseline.evidenceHashes).filter(path => baseline.evidenceHashes[path] !== original.evidenceHashes[path])
  if (changedEvidence.length) for (const name of PROJECT_DOCUMENTS) {
    const own = checkDesignHandoff(workspace, [name], { digestVersion: baseline.digestVersion ?? 1, technicalBaseline: true })
    if (changedEvidence.some(path => Object.hasOwn(own.evidenceHashes, path)) && !changed.includes(name)) changed.push(name)
  }
  const release = projectDesignReleaseReport(workspace, state)
  const findings = [...input.findings ?? [], ...requiredDesignFindings(baseline.followUps, [phase])
    .filter(f => !input.findings?.some(reported => reported.id === f.id))]
  for (const finding of input.findings ?? []) {
    const recorded = baseline.followUps.find(old => old.id === finding.id)
    if (recorded && !isDeepStrictEqual({ ...recorded, impact: finding.impact }, finding))
      throw new Error(finding.id + ': a downstream report cannot redefine a recorded finding or its deadline.')
  }
  const invalid = checkDesignFindingSources(workspace, findings)
  if (new Set(findings.map(f => f.id)).size !== findings.length) invalid.push('Duplicate design issue IDs.')
  if (invalid.length) throw new Error('Design issue handoff is invalid: ' + invalid.join('; '))
  const repeated = state.designRepair?.status === 'resolved' &&
    state.designRepair.resolvedRevision === baseline.revision && !changed.length && !changedEvidence.length
    ? (input.findings ?? []).filter(f => !baseline.followUps.some(open => open.id === f.id) &&
      state.designRepair!.findings?.some(closed => closed.id === f.id ||
        isDeepStrictEqual({ ...closed, id: f.id }, f))) : []
  if (repeated.length) return { ...state, designRepair: { ...state.designRepair!, status: 'stopped' },
    lastValidationFailure: 'An already closed report was repeated against unchanged design sources; explicit resolution is required. ' +
      repeated.map(f => f.id).join(', ') }
  const upgrade = input.upgrade && (baseline.digestVersion ?? 1) < 2
  const owners = [...new Set([
    ...changed, ...release.issues.map(diagnosticOwner).filter((name): name is typeof PROJECT_DOCUMENTS[number] => !!name),
    ...(release.diagnostics.some(item => item.kind === 'scene-visibility' && item.scene) ? ['LEVEL_SCENE_DESIGN.md'] : []),
    ...findings.flatMap(f => f.documents), ...(upgrade ? ['UI_UX_SPEC.md'] : []),
  ])].filter((name): name is typeof PROJECT_DOCUMENTS[number] => PROJECT_DOCUMENTS.some(doc => doc === name))
  if (!owners.length) return
  // A resolved group is not a lifetime quota for unrelated later work.
  // An unfinished/stopped group still requires explicit direction, not a retry.
  if (state.designRepair && state.designRepair.status !== 'resolved') return { ...state, designRepair: { ...state.designRepair, status: 'stopped' },
    lastValidationFailure: 'The current design repair is unfinished or stopped; explicit resolution is required. ' +
      [...release.issues, ...changed, ...findings.map(f => f.id + ': ' + f.closeWhen)].join('; ') }
  const check = designCheck(workspace, { ...state, designReview: undefined })
  if (owners.some(name => !check.snapshots[name]))
    throw new Error('Affected design source is unavailable; preserve drafts and resolve the missing owner source before repair.')
  const recorded = [...findings]
  if (changed.length) {
    const headings = designReviewSourceHeadings(workspace, owners)
    const section = headings[owners[0]!]?.[0]
    if (!section) throw new Error('Changed sources lack a usable owner heading for provenance confirmation.')
    recorded.push({ id: 'bgs-change-provenance-' + baseline.revision.slice(0, 12), severity: 'blocker', action: 'decide', owner: 'user',
      documents: owners, sources: [{ document: owners[0]!, section }], neededBefore: phase as 'resources' | 'content' | 'implementation' | 'acceptance',
      impact: 'Saved design changed, but completed tool records do not establish all changes as this assignment output. Changes are not approved.',
      closeWhen: 'Ask the user to confirm whether these saved changes may be professionally reviewed and revised; retain the actual answer, then independently verify the affected design.' })
  }
  const step: DesignReviewStep = findings.length || changed.length || upgrade ? 'inspect' : 'revise'
  const normalized = designReviewResultSchema.shape.findings.parse(recorded)
  if (new Set(normalized.map(f => f.id)).size !== normalized.length) throw new Error('Design issue IDs conflict with the required provenance question.')
  const scope = step === 'revise' ? designImplementationRevisionDocuments(workspace, owners) : owners
  const reason = upgrade ? 'Verify previously unprotected UI design fields before upgrading the fingerprint baseline.'
    : changed.length ? 'Inspect actual saved design changes before adopting them.' : findings.length ? 'Inspect source-backed downstream design issue reports.' : 'Correct supplied deterministic design failures.'
  return { ...state, phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1, lastValidationFailure: undefined,
    designRepair: { turn: 'explicit-resolution-' + baseline.revision, returnPhase: phase, status: 'pending', reason, changedDocuments: changed, baselineRevision: baseline.revision },
    designReview: { step, combined: baseline.combined, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions,
      digestVersion: check.digestVersion, findings: normalized, writableDocuments: scope, changedDocuments: changed,
      returnPhase: phase, instruction: reason + ' Inspect only assigned sources and their necessary consumers; do not reopen unrelated design. Changes have not been accepted. If design changes invalidate downstream work, report resumeFrom as the earliest affected resources/content/implementation/acceptance stage with source-backed reasoning in closure evidence.' } }
}

export async function prepareReview(workspace: string, state: DesignStageState | undefined) {
  if (!state || state.status !== 'active' || projectDeliveryPhase(state) !== 'review') return state
  if (legacyIntermediateReview(state)) throw new Error(LEGACY_INTERMEDIATE_REVIEW)
  const draftIssues = await projectAuthorDraftIssues(workspace, AUTHOR_BATCHES.length - 1)
  if (draftIssues.length) throw new Error('Saved design drafts are unavailable: ' + draftIssues.join('; '))
  const check = designCheck(workspace, state)
  if (Object.keys(check.snapshots).length !== PROJECT_DOCUMENTS.length)
    throw new Error(`Saved design drafts are unavailable: ${check.issues.join('; ')}`)
  if (state.designReview) {
    if (state.designReview.stopped) throw new Error('Design review is stopped. Supply an explicit owner resolution through design-resolution; do not restart the automatic loop.')
    const checkpoint = state.designReview.interruptedWrite
    if (checkpoint && !checkpoint.files)
      throw new Error('Interrupted revision checkpoint lacks per-file write evidence; use an explicit owner resolution before resuming.')
    const resumable = state.designReview.step === 'revise' && checkpoint?.revision === check.revision &&
      checkpoint.files !== undefined && JSON.stringify(checkpoint.files) === JSON.stringify(snapshotDesignRevisionFiles(workspace))
    if (checkpoint ? !resumable : state.designReview.revision !== check.revision) throw new Error('Design changed after review handoff; identify the affected owner change before resuming, not a silent full re-review')
    return state
  }
  const initial = !state.designBaseline
  const next: DesignStageState = { ...state, designReview: { step: initial ? 'revise' : 'inspect',
    combined: initial || state.designBaseline?.combined,
    ...(initial ? { writableDocuments: [...PROJECT_DOCUMENTS], revisionDocuments: [...PROJECT_DOCUMENTS],
      pendingCheckIssues: [...check.issues, ...checkDesignDocumentReferences(workspace, AUTHOR_BATCHES.length - 1).issues] } : {}),
    revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, digestVersion: check.digestVersion, findings: state.designBaseline?.followUps ?? [] } }
  return next
}

export async function interruptedReview(workspace: string, state: DesignStageState | undefined, prepared: DesignStageState,
  before: DesignDocumentSnapshot, writes: { before: Record<string, string | null>; completed: Record<string, string | null> }) {
  const review = state?.designReview, prior = prepared.designReview
  if (!state || state.status !== 'active' || !review || review.stopped || review.step !== 'revise' || !prior ||
      review.revision !== prior.revision || review.instruction !== prior.instruction ||
      JSON.stringify(review.writableDocuments) !== JSON.stringify(prior.writableDocuments)) return
  const check = designCheck(workspace, state)
  const allowed = review.writableDocuments ?? requiredDesignFindings(review.findings, projectDesignNextConsumers(state)).flatMap(f => f.documents)
  const changed = Object.keys(check.snapshots).filter(name => check.snapshots[name] !== review.snapshots[name])
  if (changed.some(name => !allowed.includes(name as typeof PROJECT_DOCUMENTS[number]))) return
  const files = snapshotDesignRevisionFiles(workspace)
  // A successful write to one file cannot authorize its sibling index or
  // evidence. Compare this turn's start with the bytes observed at completion.
  for (const path of new Set([...Object.keys(writes.before), ...Object.keys(files)])) {
    const current = Object.hasOwn(files, path) ? files[path] : designRevisionFileDigest(workspace, path)
    if (current !== writes.before[path] &&
        (!Object.hasOwn(writes.completed, path) || writes.completed[path] !== current)) return
  }
  return { ...state, designReview: { ...review,
    interruptedWrite: { revision: check.revision, snapshots: check.snapshots, files, before: prior.interruptedWrite?.before ?? before } } }
}

export function designQuestionContext(workspace: string, state: DesignStageState | undefined, revision: string) {
  const review = state?.designReview
  if (!state || state.status !== 'active' || projectDeliveryPhase(state) !== 'review' || !review || review.stopped ||
      review.step !== 'revise' || review.revision !== revision)
    throw new Error('Design question is stale: its saved review version is no longer current.')
  const check = designCheck(workspace, state)
  return { step: 'revise' as const, findings: review.findings,
    sourceHeadings: designReviewSourceHeadings(workspace, Object.keys(check.snapshots)), sourceRevision: check.revision }
}

export async function recordReviewUserDecision(workspace: string, state: DesignStageState | undefined, revision: string,
  toolUseID: string, input: Record<string, unknown>, sourceRevision = revision) {
  if (!toolUseID.trim()) throw new Error('Design question requires its actual tool call ID.')
  const context = designQuestionContext(workspace, state, revision)
  const review = state!.designReview!
  if (context.sourceRevision !== sourceRevision)
    throw new Error('Design question is stale: its saved review version is no longer current.')
  const findings = designReviewQuestionFindings(input, context)
  const ids = designReviewQuestionIds(input, findings)
  const answered = answeredQuestionInput('AskUserQuestion', input, input.answers)
  const questions = answered.questions as Array<{ header: string; question: string }>
  const answers = answered.answers as Record<string, string>
  if (ids.some(id => review.userDecisions?.some(d => d.id === id))) throw new Error('Design decision already answered.')
  const decisions = questions.map(q => ({ id: q.header, revision, ...(sourceRevision !== revision ? { sourceRevision } : {}), toolUseID, question: q.question, answer: answers[q.question]! }))
  return { ...state!, designReview: { ...review, findings, userDecisions: [...review.userDecisions ?? [], ...decisions] } }
}

export async function requestReviewResolution(workspace: string, state: DesignStageState | undefined, input: {
  instruction: string; mode: DesignReviewStep; findings: DesignFinding[]
}) {
  if (!input.instruction.trim()) throw new Error('Owner resolution needs an explicit decision or evidence instruction')
  const validated = designReviewResultSchema.parse({ step: input.mode, findings: input.findings, resolved: [] })
  if (input.mode !== 'inspect' && !validated.findings.length || new Set(validated.findings.map(f => f.id)).size !== validated.findings.length)
    throw new Error('Owner resolution needs unique affected findings')
  if (!state) throw new Error('No project delivery to resolve')
  const recorded = state.designReview?.findings ?? state.designBaseline?.followUps ?? []
  const sourceIssues = checkDesignFindingSources(workspace, validated.findings.filter(f => !recorded.some(old => old.id === f.id)))
  if (sourceIssues.length) throw new Error(sourceIssues.join('; '))
  if (input.mode === 'inspect') {
    const phase = projectDeliveryPhase(state)
    if (phase === 'author' || phase === 'review') throw new Error('Initial author/review uses its scheduled handoff')
    if (state.designBaseline) {
      const next = prepareAffectedDesignResolution(workspace, { ...state, designRepair: undefined }, { findings: validated.findings, upgrade: true })
      if (!next) throw new Error('Affected inspection needs source-backed findings or changed/unverified sources; do not re-review a clean baseline.')
      const requested = { ...next, status: 'active' as const,
        designReview: { ...next.designReview!, instruction: input.instruction + '\n' + next.designReview!.instruction },
        designHistory: [...state.designHistory ?? [], { step: 'owner-request' as const, revision: next.designReview!.revision, findings: next.designReview!.findings, resolved: [], instruction: input.instruction }] }
      return requested
    }
    const check = designCheck(workspace, { ...state, authorBatch: AUTHOR_BATCHES.length - 1 })
    if (!check.valid) throw new Error('Prepare the missing saved design handoff through the authorized authors first: ' + check.issues.join('; '))
    const next: DesignStageState = { ...state, status: 'active', phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1,
      designReview: { step: 'inspect', revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions,
        digestVersion: check.digestVersion,
        findings: validated.findings, instruction: input.instruction, returnPhase: phase === 'complete' ? 'implementation' : phase }, designRepair: undefined, lastValidationFailure: undefined,
      designHistory: [{ step: 'owner-request', revision: check.revision, findings: validated.findings, resolved: [], instruction: input.instruction }] }
    return next
  }
  if (!state.designReview && !state.designBaseline) throw new Error('Legacy delivery needs an explicit inspect before affected resolution')
  const findings = [...(state.designReview?.findings ?? state.designBaseline?.followUps ?? [])]
  for (const finding of validated.findings) {
    const index = findings.findIndex(f => f.id === finding.id)
    if (index >= 0) {
      // Explicit decisions supply the answer, not permission to hide the recorded issue.
      if (!isDeepStrictEqual(findings[index], finding)) throw new Error('Do not redefine a recorded finding; supply its decision in instruction')
    } else findings.push(finding)
  }
  const phase = projectDeliveryPhase(state), batch = phase === 'review' ? state.authorBatch ?? 4 : state.designBaseline!.batch
  const check = designCheck(workspace, { ...state, authorBatch: batch })
  if (findings.some(f => f.documents.some(name => !check.snapshots[name]))) throw new Error('Affected scope must consist of delivered documents')
  if (input.mode === 'verify' && !check.valid) throw new Error(check.issues.join('; '))
  const allowed = new Set(designImplementationRevisionDocuments(workspace, findings.flatMap(f => f.documents)))
  const original = state.designReview?.snapshots ?? state.designBaseline!.snapshots
  const changed = Object.keys(original).filter(name => original[name] !== check.snapshots[name])
  if (changed.some(name => !allowed.has(name as typeof PROJECT_DOCUMENTS[number]))) throw new Error('Changed documents exceed the explicit affected scope')
  const originalVersions = state.designReview?.documentVersions ?? state.designBaseline?.documentVersions
  for (const name of changed) {
    const previous = originalVersions?.[name], current = check.documentVersions[name]
    if (previous && (!current || !isHigherDocumentVersion(current, previous)))
      throw new Error(name + ': revised document version must increase from ' + previous)
  }
  const next: DesignStageState = { ...state, status: 'active', phase: 'review', authorBatch: batch, lastValidationFailure: undefined,
    designReview: { step: input.mode, combined: state.designReview?.combined ?? state.designBaseline?.combined, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, findings,
      digestVersion: check.digestVersion,
      userDecisions: validated.findings.filter(f => f.owner === 'user' && f.action === 'decide').map(f =>
        ({ id: f.id, revision: check.revision, toolUseID: 'design-resolution', question: f.closeWhen, answer: input.instruction })),
      writableDocuments: designImplementationRevisionDocuments(workspace, validated.findings.flatMap(f => f.documents)),
      changedDocuments: changed, instruction: input.instruction,
      returnPhase: state.designReview?.returnPhase ?? (phase === 'review' ? undefined : phase === 'complete' ? 'implementation' : phase),
      returnAuthorBatch: state.designReview?.returnAuthorBatch ?? (phase === 'author' ? state.authorBatch : undefined) },
    designRepair: undefined, designHistory: [...state.designHistory ?? [], { step: 'owner-request', revision: check.revision, findings, resolved: [], instruction: input.instruction }] }
  return next
}

/** Business result only. The caller owns locking, persistence and dispatch. */
export async function advanceReview(workspacePath: string, initial: DesignStageState, conclusion?: MilestoneResult,
  documentSnapshot?: DesignDocumentSnapshot): Promise<{ state?: DesignStageState; phase: ProjectDeliveryPhase; shouldContinue: boolean; issues: string[] }> {
  let state = initial, updated: DesignStageState | undefined
  const phase = 'review' as const
  const record = (next: DesignStageState) => { updated = next }
  const evaluate = async (): Promise<{ phase: ProjectDeliveryPhase; shouldContinue: boolean; issues: string[] }> => {
    const parsed = designReviewResultSchema.safeParse(conclusion?.review)
    const review = state.designReview
    if (review?.stopped) return { phase, shouldContinue: false, issues: ['Review is stopped pending explicit owner resolution.'] }
    if (conclusion?.phase !== 'review' || !parsed.success || !review || parsed.data.step !== review.step)
      return { phase, shouldContinue: false, issues: ['Review has no valid version-bound result for its current step.', ...(conclusion?.validationIssues ?? [])] }
    const result = parsed.data
    let check = designCheck(workspacePath, state)
    let changed = Object.keys(check.snapshots).filter(name => check.snapshots[name] !== review.snapshots[name])
    if (review.step !== 'revise' && check.revision !== review.revision)
      return { phase, shouldContinue: false, issues: ['Read-only review changed its source documents or evidence.'] }
    // Recorded source locations belong to the inspected version. A legitimate
    // correction can delete an offending clause; do not require it to survive.
    const resultIssues = designReviewResultIssues(result, { step: review.step, combined: review.combined, findings: review.findings,
      affectedChange: !!(review.returnPhase && review.changedDocuments?.length), nextConsumers: projectDesignNextConsumers(state),
      sourceHeadings: designReviewSourceHeadings(workspacePath, Object.keys(check.snapshots)) }, conclusion.status === 'blocked' ? 'blocked' : 'complete')
    if (resultIssues.length) return { phase, shouldContinue: false, issues: resultIssues }
    // Local review receipts account only for their recorded assignment. Keep
    // unassigned baseline findings host-side, without broadening the reviewer.
    const retained = (state.designBaseline?.followUps ?? []).filter(f => !review.findings.some(assigned => assigned.id === f.id))
    for (const finding of result.findings) {
      const original = retained.find(old => old.id === finding.id)
      if (original && !isDeepStrictEqual(original, finding))
        return { phase, shouldContinue: false, issues: [finding.id + ': an unassigned baseline finding cannot be redefined; request its affected review.'] }
    }
    const withRetained = (findings: DesignFinding[]) => [
      ...retained.filter(f => !findings.some(current => current.id === f.id)), ...findings,
    ]
    const openFindings = withRetained(result.findings)
    state = { ...state, designHistory: [...state.designHistory ?? [], { step: review.step, revision: check.revision, findings: result.findings, resolved: result.resolved,
      ...(review.userDecisions?.length ? { userDecisions: review.userDecisions } : {}) }] }
    const nextReviewConsumers = projectDesignNextConsumers(state)
    // Necessary product choices close before freeze, even if mislabeled with
    // a later deadline. Genuine later production observations retain theirs.
    const required = requiredDesignFindings(openFindings, nextReviewConsumers)
    const stop = async (findings: DesignFinding[], reason: string) => {
      record({ ...state, designReview: { ...review, findings, stopped: true },
        ...(state.designRepair ? { designRepair: { ...state.designRepair, status: 'stopped' } } : {}), lastValidationFailure: reason })
      const pending = requiredDesignFindings(withRetained(findings), nextReviewConsumers)
      return { phase, shouldContinue: false, issues: [reason,
        ...(review.step === 'revise' && pending.length ? ['Recorded findings awaiting targeted verification (not revalidated by this failure):'] : []),
        ...pending.map(f => `${f.id}: owner ${f.owner}; ${f.impact}; close: ${f.closeWhen}`)] }
    }
    if (conclusion.status === 'blocked') return stop(result.findings,
      `Design ${review.step} did not complete: ${result.blockedReason ?? 'the agent reported blocked without an execution reason; inspect its recorded findings and tool failures.'} No release was granted.`)
    if (requiredDesignUserDecisions(review.findings, nextReviewConsumers).some(f => result.resolved.some(r => r.id === f.id) && !findingDismissed(result, f.id) && !review.userDecisions?.some(d => d.id === f.id)))
      return stop(review.findings, 'A user decision cannot be closed without a retained human answer.')
    let references = checkDesignDocumentReferences(workspacePath, state.authorBatch ?? AUTHOR_BATCHES.length - 1)
    if ((review.step === 'inspect' || review.step === 'verify') && (required.length || !check.valid || !references.valid || review.step === 'inspect' && review.changedDocuments?.length)) {
      if (required.some(f => f.action === 'evidence')) return stop(result.findings, 'Required factual evidence is unavailable; user approval cannot replace it.')
      if (review.step === 'verify') {
        const priorRequired = requiredDesignFindings(review.findings, nextReviewConsumers)
        if (!result.resolved.some(closed => priorRequired.some(finding => finding.id === closed.id)))
          return stop(result.findings, 'Targeted verification still has blockers with no independently confirmed closure of a required issue; automatic revision paused. Partial edits or reworded findings are not verified progress.')
        if (requiredDesignUserDecisions(review.findings, nextReviewConsumers).some(f => !findingDismissed(result, f.id) && !review.userDecisions?.some(d => d.id === f.id)))
          return stop(result.findings, 'Verification cannot continue without a retained answer to the required user decision.')
      }
      const deterministicIssues = [...check.issues, ...references.issues]
      // Program diagnostics name their actual source document. Their repair
      // must not depend on a model severity label or an invented prose finding.
      const sourceFor = (issue: string) => PROJECT_DOCUMENTS.find(name => Object.hasOwn(check.snapshots, name) &&
        (issue.startsWith(name + ':') || issue.startsWith('docs/' + name + ':')))
      if (deterministicIssues.some(issue => !sourceFor(issue)))
        return stop(result.findings, 'Deterministic failure has no delivered correction scope: ' + deterministicIssues.join('; '))
      const affectedDocuments = designImplementationRevisionDocuments(workspacePath,
        [...required.flatMap(f => f.documents), ...(review.step === 'inspect' ? review.changedDocuments ?? [] : []),
          ...(check.diagnostics.some(item => item.kind === 'scene-visibility' && item.scene) ? ['LEVEL_SCENE_DESIGN.md'] : []),
          ...deterministicIssues.map(issue => sourceFor(issue)!)].filter((name): name is typeof PROJECT_DOCUMENTS[number] => PROJECT_DOCUMENTS.some(doc => doc === name)))
      const writableDocuments = !state.designBaseline && !review.returnPhase ? [...PROJECT_DOCUMENTS] :
        review.revisionDocuments ?? designImplementationRevisionDocuments(workspacePath, review.writableDocuments ?? affectedDocuments)
      if (affectedDocuments.some(name => !writableDocuments.includes(name)))
        return stop(result.findings, 'Remaining corrections exceed the authorized published-design change scope; explicit owner direction is required.')
      record({ ...state, designReview: { ...review, step: 'revise', findings: result.findings, affectedDocuments,
        // Before first release the revision owns the integrated design, not
        // just the files an imperfect inspection predicted. Reading remains
        // finding-scoped; saved changes determine the Verify scope. Published
        // baselines still require an explicit, bounded owner change.
        writableDocuments, revisionDocuments: writableDocuments, pendingCheckIssues: [...new Set(deterministicIssues)], changedSections: undefined }, lastValidationFailure: undefined })
      return { phase, shouldContinue: true, issues: [] }
    }
    if (review.step === 'revise') {
      const unanswered = requiredDesignUserDecisions(result.findings, nextReviewConsumers).filter(f => !review.userDecisions?.some(d => d.id === f.id && d.revision === review.revision))
      if (unanswered.length) return stop(result.findings, 'Required user decisions have no validated answer: ' + unanswered.map(f => f.id).join(', '))
      const allowed = new Set(review.writableDocuments ?? requiredDesignFindings(review.findings, nextReviewConsumers).flatMap(f => f.documents))
      if (changed.some(name => !allowed.has(name as typeof PROJECT_DOCUMENTS[number]))) return stop(review.findings, 'Revision modified a document outside the recorded affected scope.')
      let finalizationIssues: string[] = []
      if (documentSnapshot) {
        const finalized = finalizeDesignDocuments(workspacePath, [...allowed], review.interruptedWrite?.before ?? documentSnapshot,
          review.returnPhase && state.designBaseline ? { changedDocuments: review.changedDocuments ?? [], documentVersions: state.designBaseline.documentVersions } : undefined)
        if (finalized.unsafeIssues.length) return stop(review.findings, 'Revision cannot safely finalize saved files: ' + finalized.unsafeIssues.join('; '))
        finalizationIssues = finalized.issues
        check = designCheck(workspacePath, state)
        changed = Object.keys(check.snapshots).filter(name => check.snapshots[name] !== review.snapshots[name])
        references = checkDesignDocumentReferences(workspacePath, state.authorBatch ?? AUTHOR_BATCHES.length - 1)
      }
      const versionIssues = changed.flatMap(name => {
        const previous = review.documentVersions?.[name], current = check.documentVersions[name]
        return previous && (!current || !isHigherDocumentVersion(current, previous))
          ? [name + ': revised document version must increase from ' + previous] : []
      })
      const staticIssues = [...check.issues, ...versionIssues, ...references.issues, ...finalizationIssues]
      if (staticIssues.length) {
        const remaining = [...new Set(staticIssues)], previous = review.pendingCheckIssues ?? []
        // Only the actual checker can establish deterministic progress. Merely
        // editing bytes, renaming an error or adding a new failure is not enough.
        if (remaining.length < previous.length && remaining.every(issue => previous.includes(issue)) && changed.length) {
          const changes = documentSnapshot ? changedDesignSections(workspacePath, documentSnapshot) :
            Object.fromEntries(changed.map(name => [name, null]))
          const pendingSections = { ...review.changedSections }
          for (const [name, sections] of Object.entries(changes))
            pendingSections[name] = sections === null || pendingSections[name] === null ? null :
              [...new Set([...pendingSections[name] ?? [], ...sections])]
          record({ ...state, lastValidationFailure: undefined, designReview: { ...review,
            interruptedWrite: undefined, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions,
            pendingCheckIssues: remaining, changedSections: pendingSections,
            changedDocuments: [...new Set([...review.changedDocuments ?? [], ...changed])],
          } })
          return { phase, shouldContinue: true, issues: [] }
        }
        return stop(review.findings, 'Revision still fails ' + (finalizationIssues.length ? 'saved handoff checks' : 'deterministic checks') +
          ' without confirmed progress: ' + remaining.join('; '))
      }
      const changedSections = documentSnapshot ? changedDesignSections(workspacePath, review.interruptedWrite?.before ?? documentSnapshot) :
        Object.fromEntries(changed.map(name => [name, null]))
      const verificationDocuments = [...new Set([
        ...result.findings.flatMap(f => f.documents),
        ...changed, ...review.changedDocuments ?? [], ...Object.keys(review.changedSections ?? {}),
      ])].filter((name): name is typeof PROJECT_DOCUMENTS[number] => PROJECT_DOCUMENTS.some(doc => doc === name))
      // Only a new clean joint review may omit the old verification handoff.
      // Preserve saved in-flight workflow and already changed downstream scope.
      if (!review.combined && !verificationDocuments.length)
        verificationDocuments.push(...review.affectedDocuments ?? review.writableDocuments ?? [])
      const verificationSections = { ...review.changedSections }
      for (const [name, sections] of Object.entries(changedSections))
        verificationSections[name] = sections === null || verificationSections[name] === null ? null :
          [...new Set([...verificationSections[name] ?? [], ...sections])]
      if (verificationDocuments.length) {
        record({ ...state, designReview: { ...review, interruptedWrite: undefined, findings: result.findings, step: 'verify', revision: check.revision, changedSections: verificationSections,
          revisionDocuments: review.revisionDocuments ?? review.writableDocuments,
          writableDocuments: verificationDocuments, affectedDocuments: verificationDocuments,
          snapshots: check.snapshots, documentVersions: check.documentVersions, changedDocuments: [...new Set([...review.changedDocuments ?? [], ...changed])] } })
        return { phase, shouldContinue: true, issues: [] }
      }
      // A clean joint inspection with no saved changes has nothing to re-verify.
    }
    if (review.step === 'verify') {
      if (requiredDesignUserDecisions(review.findings, nextReviewConsumers).some(f => !findingDismissed(result, f.id) && !review.userDecisions?.some(d => d.id === f.id)))
        return stop(review.findings, 'Verification cannot release a user decision without a retained human answer.')
    }
    if (!check.valid || !references.valid) return stop(result.findings, 'Deterministic release checks still fail: ' + [...check.issues, ...references.issues].join('; '))
    const batch = state.authorBatch ?? AUTHOR_BATCHES.length - 1
    let next = state.designBaseline ? review.returnPhase ?? 'resources' : 'resources'
    const changedSources = (review.returnPhase ? [...review.changedDocuments ?? []] : Object.keys(check.snapshots).filter(name => state.designBaseline?.snapshots[name] !== check.snapshots[name])) as Array<typeof PROJECT_DOCUMENTS[number]>
    const change = review.returnPhase && state.designBaseline?.revision !== check.revision
      ? { documents: changedSources.length ? changedSources : review.writableDocuments ?? [...new Set(review.findings.flatMap(f => f.documents))], instruction: review.instruction }
      : undefined
    if (review.returnPhase && changedSources.length) {
      // The shared receipt check enforces this before native Write succeeds;
      // keep the same check at the host boundary for older/native-free callers.
      const order = ['resources', 'content', 'implementation', 'acceptance']
      next = order[Math.min(order.indexOf(result.resumeFrom!), Math.max(0, order.indexOf(review.returnPhase)))] as ProjectDeliveryPhase
    }
    const nextAuthorBatch = review.returnAuthorBatch ?? batch + 1
    const nextConsumers: readonly string[] = next === 'author' ? AUTHOR_BATCHES[nextAuthorBatch] ?? [] : [next]
    const consumerCheck = designCheck(workspacePath, state, nextConsumers)
    if (!consumerCheck.valid) return stop(result.findings, 'Next-consumer delivery requirements still fail: ' + consumerCheck.issues.join('; '))
    const due = requiredDesignFindings(openFindings, nextConsumers)
    if (due.length) return stop(result.findings, 'A deferred required decision is due before the next consumer; it cannot be released as a follow-up.')
    const baseline = { batch: state.authorBatch ?? AUTHOR_BATCHES.length - 1, combined: review.combined ?? state.designBaseline?.combined, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, evidenceHashes: check.evidenceHashes, digestVersion: check.digestVersion,
      followUps: openFindings.filter(f => f.severity === 'follow-up'), ...(change ? { change } : {}) }
    record({ ...state, phase: next, ...(next === 'author' ? { authorBatch: nextAuthorBatch } : {}),
      designReview: undefined, designDrafts: undefined, designBaseline: baseline,
      ...(state.designRepair ? { designRepair: { ...state.designRepair, status: 'resolved',
        resolvedRevision: check.revision, findings: review.findings.filter(f => result.resolved.some(closed => closed.id === f.id)) } } : {}),
      lastValidationFailure: undefined })
    return { phase: next, shouldContinue: true, issues: [] }

  }
  return { ...await evaluate(), state: updated }
}
