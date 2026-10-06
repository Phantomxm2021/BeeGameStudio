import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { computeWorkspaceRevision, resolveWorkspaceRelativePath } from './workspace-revision'
import { PROJECT_DOCUMENTS, projectContentAuthority } from './project-content-authority'
import { AUTHOR_BATCHES, authorBatchInstruction, authorBatchReviewInstruction } from './project-author'
import { checkReviewUiLayouts } from './design-layout-check'
import { checkDesignDocumentReferences } from './design-document-references'
import { isHigherDocumentVersion, checkDesignHandoff, checkDesignFindingSources, designReviewSourceHeadings, designReviewResultSchema,
  finalizeDesignDocuments, type DesignDocumentSnapshot, type DesignFinding, type DesignReviewStep } from './design-handoff'
import { designReviewResultIssues } from '@bee-game-studio/agent-workflow/design-review-result'
export { PROJECT_DOCUMENTS, projectContentAuthority } from './project-content-authority'
import { auditBeeGameContentPackage, type BeeGameContentAuthority } from './game-content-package'
import { buildSceneUiContentAuthoringAuthority, materializeSceneUiAuthoringContract, materializeSceneUiFormat } from './scene-ui-content-authoring'
import { validateResourceDelivery } from './resource-validation-cli'
import { ASSET_MANIFEST_AUTHORING_CONTRACT_PATH, materializeAssetManifestAuthoringContract } from './asset-manifest-authoring-contract'
import {
  readRuntimeAcceptanceReport,
  runtimeEvidenceIsCurrent,
  type RuntimeAcceptance,
  type AcceptanceDiagnostic,
} from './runtime-acceptance'

export const PROJECT_DELIVERY_REPORT_PATH = '.beegame/delivery/acceptance.json'
export const PROJECT_CONTENT_CONTRACT_PATH = '.beegame/delivery/content-contract.json'

export type ProjectDeliveryPhase =
  'author' | 'review' | 'resources' | 'content' | 'implementation' | 'acceptance' | 'complete'

const NEXT_PHASE: Record<Exclude<ProjectDeliveryPhase, 'complete'>, ProjectDeliveryPhase> = {
  author: 'review', review: 'resources', resources: 'content',
  content: 'implementation', implementation: 'acceptance', acceptance: 'complete',
}

export function projectDeliveryPhase(state: ProjectDeliveryState): ProjectDeliveryPhase {
  return state.phase ?? (state.accepted ? 'complete' : 'author')
}

/** Deliverables and platform interfaces, not a script for the Agent's work. */
export function projectDeliveryPhaseInstruction(phase: ProjectDeliveryPhase, authorBatch = phase === 'review' ? AUTHOR_BATCHES.length - 1 : 0): string {
  switch (phase) {
    case 'author': return authorBatchInstruction(authorBatch)
    case 'review': return authorBatchReviewInstruction(authorBatch)
    case 'resources': return `Current delivery milestone: resources.
Using the reviewed ASSET_PLAN.md together with the art, audio, UI, scene and technical documents, complete the required resources for this delivery. Optional resources do not block completion.
Inspect existing resources, reuse those that meet the requirements and fill the gaps. Each required resource must correspond to a usable file or reproducible procedural output, with its intended use and usage explained.
For a planned generated file or reusable procedural resource, deliver the usable output or executable generator with its inputs and usage; a promise to create it later is not resource completion. Simple shapes or effects intentionally expressed by content parameters and runtime behavior need not become separate asset files or generator frameworks. Identify those design references and remaining content/runtime integration briefly in the handoff; do not claim that integration is already tested.
Choose built-in library assets, web assets, AI generation or procedural creation according to actual needs. First meet the design requirements, visual consistency and target-platform constraints, then compare time and cost. Approved fallbacks in the documents are valid; do not lower requirements on your own.
Inspect the retained Art/UI samples linked from their documents when choosing and producing visual resources. Preserve their intended treatment and independent layers; a design-reference image is not automatically a usable runtime asset, and copying a whole UI picture does not supply editable controls or text.
Preserve the planned delivery structure and required variants as well as appearance: changing the production source does not silently cancel an atlas, animation or TileSet. Prefer compatible small 2D sprites with shared loading lifetime in atlases; keep large backgrounds, fonts, audio and models separate as appropriate. For AI-sourced small sprites or UI elements of one style that fit at usable detail, prefer one generation request for a shared sheet, not one request per element followed by optional packing. Request distinguishable, separated elements with useful spacing; choose transparency for their use. Split generation only for a concrete composition, detail or independent-use need and briefly explain it; a planned atlas is not optional merely because its source images were generated separately. The image model produces pixels, not authoritative frame coordinates: inspect the actual sheet and register named, in-bounds regions with logical display sizes, pivots and applicable padding/nine-slice metadata. Elements that vary independently must remain independently addressable. Functional text, interactions and layout belong in subsequent content data.
AI image generation defaults to 1024x1024 and low quality. Choose transparency, image count and organization for the intended use; change size only for a concrete need. Consult the available capability instructions for tool usage and registration formats. Resource registration interface: ${ASSET_MANIFEST_AUTHORING_CONTRACT_PATH}.
Atlas priority applies regardless of source: AI, retrieved images and procedurally drawn static sprites. For procedural sprites, prefer drawing directly into a shared sheet and emitting exact frame metadata from those drawing coordinates; existing separate sprites may be packed without regenerating their art. Group by concurrent use and compatible filtering, not source, and avoid loading unrelated content in a giant atlas. Keep dynamic text, live bars and simple parameter-driven geometry as runtime drawing where designed. Preserve source files when useful, but register runtime atlas/member bindings rather than loading both packed and source images for the same use.
Check resource quality and import requirements, including the visual, audio and technical properties relevant to its type. Building a complete game is not a prerequisite for resource checks. Successful generation, file existence or valid format alone does not establish design compliance.
Use game-technical-artist for applicable animation/effect/material production decisions; preserve the authored visual intent and distinguish usable resource output from later content bindings and runtime motion. Do not require advanced techniques or new asset files for effects already designed as simple runtime behavior.
Deliver the selected files and assets/asset-manifest.json, recording origins and necessary usage metadata. Check licenses for third-party assets; downloaded fonts remain third-party resources, not procedural creations. Accurately record generation origins for AI and procedural assets. Verify image/font decoding in the target browser where applicable, not just extensions or file existence. The content stage handles scene and UI layout and bindings.
When a required resource cannot be delivered, report the missing item, reason and feasible options. Do not edit the reviewed design documents or mark missing resources complete.
Briefly report delivery results and unresolved issues. Check and invoke applicable Skills; use subagents in parallel for independent tasks with clear dependencies, choosing the task split yourself.`
    case 'content': return `Current delivery milestone: content. Translate the reviewed design and delivered resources into editable Scene/UI/VFX data and content/index.json for the agreed game.

Inputs and scope:
Read the relevant reviewed design documents and resource handoff. This is the milestone that completes the formal Scene/UI/VFX package, state/action bindings, resource references and content/index.json. Read the UI-linked content/ui files and complete them in place: preserve their document/node identities, text, order, hierarchy, layout constraints, responsive geometry, supported sizes and control minima. There is no second planning layout to translate or compare. Bind the actual delivered assets and runtime references without inventing resources or selecting another composition; request an owner revision for a necessary layout change. The host protects layout decisions through the existing design baseline while allowing resource/style/action bindings. Account for every planned screen and level, reusing shared components, scenes and procedural definitions where appropriate rather than duplicating files for every state or generated level. Preserve existing correct data.
Use the schemas, coordinate semantics, supported components, resource references and BGS-supplied revision values in ${PROJECT_CONTENT_CONTRACT_PATH} and its referenced format guidance. These are platform inputs, not algorithms to reverse-engineer. Choose representations suited to the confirmed 2D, 3D or XR target; do not introduce components merely to satisfy an unrelated example.

Design-to-data handoff:
Read the actual retained UI composition sample and the applicable Art sample with their prose. Carry through the selected proportions, hierarchy, type/icon treatment and visual details in editable data; do not turn a flattened reference into a background with unrelated generic controls. Samples illustrate the documented relationships, not a substitute coordinate table or production asset manifest.
Preserve the reviewed spatial composition: scene hierarchy, transforms, camera/framing, visual layers, placements and applicable generation parameters. For UI, carry through each screen's elements, content, layout, adaptation and state/action bindings, including the play-area placement relative to UI. Use the actual delivered resources and their registered members/frames rather than inventing missing assets.
Express static design and supported state configuration in the content format. Identify the existing node/action/state references that runtime code must connect for dynamic behavior and feedback. Data declaration is not executable gameplay; do not silently omit a requirement because it needs code, or invent unsupported fields to make it appear implemented. Keep standalone gameplay configuration outside the Scene/UI/VFX registry as the contract requires.

Checks and completion:
Derive concrete values from the reviewed layout rules; do not choose a new layout or interaction design. If a necessary design decision is missing, identify the requirement and affected content instead of silently deciding it here.
Use the supplied --layout inspection at chosen viewport sizes using the Editor's shared coordinate functions. Keep the reviewed layout selection and space allocation; use resolved UI rectangles to determine the Scene viewport instead of independently sizing both against the whole window. Investigate anchors, stretch and containment; inspect actual Editor previews for text, visual hierarchy and intended overlaps. Geometry inspection does not certify appearance or gameplay. Preserve planned Tilemap/TileSet bindings; report an incompatible resource rather than silently replacing its representation.
Measure the design's authored labels and legal longest counter values with delivered fonts here, using the supplied browser helper or equivalent actual-font checks. Identify glyph fallback, wrapping or overflow rather than treating geometry or candidate measurements as final. Preserve the reviewed design; report a required design change instead of silently shrinking text or editing upstream documents. Handoff unresolved complete-runtime composition and rendering checks explicitly.
Compare the resulting data against the applicable document requirements, including space allocation and adaptation. Use the provided read-only content checker for format, references and saved layout geometry. Recalculate after binding resources. Render every defined UI composition and relevant expanded state from these actual saved files with delivered resources/fonts at the supported targets; inspect text fit and complete composition, not partial hand-authored samples or node presence alone. Use existing preview/browser capabilities and the shared consumer, without hardcoding a parallel layout or building gameplay for this check. Report unavailable rendering/font checks as blocked, not PASS. A valid schema or geometry result alone does not establish design coverage, appearance or runtime correctness. Correct data omissions against explicit design requirements within the protected layout; a needed layout/design change requires the UI owner revision and version increase. Report missing resources, contradictory design or requirements the format cannot express, without silently simplifying the design.
Briefly hand off the delivered content, the runtime behavior still to connect and any unresolved gaps, using existing files and references rather than creating a separate mandatory report. Building the full game is not required in this stage, and runtime verification remains to be completed after implementation. Tools, task order and subagent collaboration are yours to choose.`
    case 'implementation': return `Current delivery milestone: implementation. Deliver the complete runnable game defined by the reviewed design and delivered content.

Design and data inputs:
Read the reviewed eight documents in docs/ for the agreed gameplay, presentation, interactions and first-release scope. Inspect existing code, resources and content; preserve correct work rather than rebuilding it.
Use owned outputs declaring acceptance as source-linked implementation completion checks: read their pointed conditions/actions and expected results, implement them and retain the applicable tests or observations for acceptance. These pointers supplement the confirmed scope; unmarked requirements are not optional. Keep each result linked to its actual owner source rather than creating a second specification. Do not silently resolve a missing necessary decision while writing code.
The documents define intended design. Consume content/index.json, its registered Scene/UI/VFX documents and assets/asset-manifest.json. Data semantics and runtimeConsumption are in .beegame/delivery/content-format.json; content-format files define data syntax, not gameplay design.
Content remains the editable source for static hierarchy, transforms, layout, responsive variants, Tilemap cells and resource bindings. Runtime code parses these and implements gameplay and dynamic presentation; do not maintain a separate substitute layout.
For atlas assets, share loading and decoded image/texture sources by resolved asset URL within their useful lifetime, including concurrent requests. Frames reference regions of that source; avoid per-frame fetch/decode or copied pixel buffers merely to select a region. Use the chosen engine's existing cache where available, release owned resources when no longer needed, and keep unrelated atlas groups on demand. Sharing a sheet does not by itself guarantee rendering batches.

Implementation and verification outcomes:
Compare the actual rendered game with the retained visual samples and their authoritative clauses at corresponding states and supported sizes. Preserve the selected visual standard, including hierarchy, spacing, typography/icon alignment and restrained effects, not just element counts or functional navigation. Correct lost or substituted treatment within the existing design; report a missing necessary owner choice rather than redesigning. A user taste vote or another approval stage is not required.
Use gameplay-programmer for real-time rules, movement/contact execution and lifecycle correctness, and game-technical-artist for applicable animation, effects, materials and camera presentation. Game-feel design supplies the intended response; these implementation responsibilities realize it without redefining rules or style. Invoke the relevant Skills for actual work, not to staff a fixed roster.
Choose the plan, tools, task split and execution order for this project; no fixed step sequence, prescribed tool calls or extra approval gates are required. Reuse correct work and keep unresolved requirements traceable to the reviewed design. A representative vertical slice may help test coupled risks, but is not a mandatory new stage.
Deliver real data consumption, the complete agreed player journey and all planned screens/levels with their rules, presentation, feedback and recovery behavior. An intermediate playable version is not final delivery. Target the documented quality, not new art direction or open-ended polishing; required omissions are not optional refinements.
Use code tests for deterministic rules/calculations and target-runtime observation for rendering, input and feedback. Verify representative authored geometry, text, resources, layering and states at the supported sizes. Temporary changes to applicable layout/resource data should affect the intended rendered output and be restored; parsed JSON or a successful build does not establish consumption. Check Tilemaps only when used.
Reuse existing numerical scripts and the shared layout algorithm; do not hand-maintain derived tables or substitute code-owned layouts. Batch related checks and reuse evidence still valid for the current version, retesting behavior invalidated by changes. State unavailable environments and faulty test drivers separately from game defects; unobserved behavior remains unverified.
If delegating, give bounded outcomes, relevant authoritative sources, dependency boundaries, owned files and completion checks. Coordinate shared interfaces and conflicting writes, not the delegate's reasoning process. Integrate combined results before claiming completion; a subagent's PASS alone is not integration evidence.
Briefly hand off the current build, scope, actual checks, evidence and unresolved issues. Preserve reusable tests/evidence and clean up only resources you started. Implementation self-checks do not replace subsequent acceptance; acceptance fills coverage/evidence gaps rather than automatically rerunning the whole implementation test suite.
Design consistency and issue handling:
Implement the full agreed scope, including necessary elements, interaction states, feedback and adaptation, not only the normal play path.
If code fails to implement the design or consume data correctly, fix the implementation. If content omits or contradicts an explicit document requirement, correct the data while preserving valid formats and references.
The reviewed eight documents are the implementation baseline. Do not edit them during implementation. If they conflict, lack a necessary design decision or require something the current contract cannot express, report specific evidence, impact and a proposed resolution. Do not silently reduce scope or change the specification to fit the implementation. Continue unaffected work where possible, but do not mark the unresolved requirement complete.

Keep verification proportional to project complexity and risk; unobserved work remains unverified.`
    case 'acceptance': return `Current delivery milestone: acceptance. Determine whether the current game fully implements the reviewed design and is usable in the agreed runtime environment.

Acceptance basis:
Derive checks from the confirmed scope and reviewed eight documents, including completion conditions and runtime-dependent questions left open in those documents. Scene/UI and resource data describe the corresponding content; neither the existing implementation nor an Agent summary replaces the agreed requirements.
Cover each owned output declaring acceptance against its actual source conditions and expected results, reusing valid implementation evidence. Also inspect the confirmed scope for necessary checks the author omitted; a complete declared checklist does not establish a complete game. Missing design decisions go to the owner; missing implementation or evidence is corrected here against the existing requirement.
Read the implementation handoff and existing evidence to identify remaining verification. Reuse results still valid for the current version; do not repeat the whole development process or write a separate long acceptance plan.

Verification:
Choose methods and order appropriate to the project, covering applicable requirements:
- Complete experience: agreed gameplay, screens and levels, and the transitions through start, play, outcomes, retry and other key states.
- Rules and boundaries: behavior, calculations and state transitions against the design, including important edge cases and abnormal operations.
- Player-facing result: actual composition, framing, resources, text, interaction feedback and audio against the design under the agreed display conditions and input methods. Compare corresponding rendered states with the retained Art/UI samples and their source clauses, allowing documented adaptation but identifying lost hierarchy, inconsistent type/icon treatment, crude substitutions or missing finish. Describe concrete visible defects, not invented aesthetic scores; user silence is not visual acceptance. Verify usable control bounds, not merely element presence or successful navigation. Keep visual captures or equivalent target-device evidence where relevant.
- Experience evidence: use game-playtest-performance to distinguish rule correctness, understandable feedback and intended experience. An Agent's route or a bot pass is not real-player approval. Report experience observations and unresolved hypotheses within the agreed scope; do not fabricate player reactions or add a mandatory human-study gate.
- Data consumption: the corresponding Scene/UI and resource data actually drives runtime behavior rather than merely loading before an independent substitute implementation runs.
Use deterministic tests for rules where useful, and observation in the actual target runtime for presentation and interaction. Match depth to project complexity and risk without expanding the agreed platform, device or content scope. Document-stage simulations and review conclusions are not runtime evidence.

Evidence and judgments:
Connect each conclusion to the requirement, the check performed and the observed outcome. A check establishes only what it directly covers; a similar visible effect is not proof of the required behavior.
Select binding checks applicable to the registered documents and actual components. Do not claim Tilemap verification for a scene without a Tilemap component. Successful resource loading does not establish that changing a resource reference changes the rendered or played asset.
For binding verification, change representative applicable data in a temporary copy or recoverable test setup and observe the corresponding runtime result. Restore test changes and keep them out of the delivered version.
Distinguish product defects, unavailable environments and inconclusive test-driver behavior. Record unobserved requirements as unverified rather than inferring success or failure. Fill report fields from the actual data and evidence, not to populate unrelated check categories. A report-format check is not verification of the report's claims or runtime evidence.

Defects and retesting:
Fix implementation or content defects against explicit design requirements and retest affected behavior. Expand regression only as the impact requires; a local correction does not automatically require every check to run again.
If documents conflict, necessary design decisions are missing or resolving the issue would change the confirmed scope, report evidence and impact. Do not edit the reviewed design or lower requirements to obtain a pass. Continue unaffected checks where useful.
The final conclusion and saved evidence must apply to the delivered version. Revalidate results invalidated by fixes and record the actual tested deployment artifacts, not temporary test variants.

Delivery result:
Report passed only when the agreed scope is complete, required checks pass and no in-scope issues or unverified requirements remain. Record confirmed unresolved defects as failed; when necessary verification or a required decision is unavailable, report blocked and explain the limitation. Disclose all known issues and unverified requirements regardless of the overall status; never reclassify an in-scope gap as outsideScope to obtain a pass.
Save the result and evidence using the existing report contract at ${PROJECT_DELIVERY_REPORT_PATH}, including evidencePaths and artifactPaths for the tested delivery. A conversational PASS does not replace this record. Briefly report the conclusion, major findings/fixes, verified scope and unresolved issues.
Tools, verification methods and subagent delegation are yours to choose.`
    case 'complete': return 'The original project delivery is complete. Follow the current user request.'
  }
}

type ProjectDeliveryAcceptance = {
  revision: string
  source: 'report'
  reportPath: string
  reportSha256: string
  reports: RuntimeAcceptance[]
}

type ProjectDeliveryState = {
  version: 1
  objective: string
  status: 'active' | 'paused'
  phase?: ProjectDeliveryPhase
  authorBatch?: number
  lastValidationFailure?: string
  // Saved drafts protect other owners' bytes during dependent writing. They
  // are not a review certificate and cannot authorize downstream production.
  designDrafts?: { batch: number; revision: string; snapshots: Record<string, string>; documentVersions?: Record<string, string>; evidenceHashes: Record<string, string> }
  designReview?: { step: DesignReviewStep; revision: string; snapshots: Record<string, string>; documentVersions?: Record<string, string>; findings: DesignFinding[]; changedDocuments?: string[];
    stopped?: boolean; instruction?: string; returnPhase?: ProjectDeliveryPhase; returnAuthorBatch?: number; writableDocuments?: Array<typeof PROJECT_DOCUMENTS[number]> }
  designBaseline?: { batch: number; revision: string; snapshots: Record<string, string>; documentVersions?: Record<string, string>; evidenceHashes: Record<string, string>; followUps: DesignFinding[];
    change?: { documents: Array<typeof PROJECT_DOCUMENTS[number]>; instruction?: string } }
  designHistory?: Array<{ step: DesignReviewStep | 'owner-request'; revision: string; findings: DesignFinding[]; resolved: Array<{ id: string; evidence: string }>; instruction?: string }>
  accepted?: ProjectDeliveryAcceptance
}

function legacyIntermediateReview(state: ProjectDeliveryState) {
  return projectDeliveryPhase(state) === 'review' && (state.authorBatch ?? AUTHOR_BATCHES.length - 1) < AUTHOR_BATCHES.length - 1 ||
    projectDeliveryPhase(state) === 'author' && !!state.designBaseline && state.designBaseline.batch < AUTHOR_BATCHES.length - 1
}

const LEGACY_INTERMEDIATE_REVIEW = 'This delivery retains an earlier per-batch review. It cannot be treated as the joint eight-document inspection; explicit owner migration is required before continuing.'

/** Basic saved delivery, not semantic approval of an author's design. */
async function projectAuthorDraftIssues(workspace: string, batch: number) {
  if (!AUTHOR_BATCHES[batch]) throw new Error('Invalid author batch')
  const issues: string[] = []
  for (const name of new Set(AUTHOR_BATCHES.slice(0, batch + 1).flat())) {
    try {
      const path = join(workspace, 'docs', name), file = await stat(path)
      if (!file.isFile() || !(await readFile(path, 'utf8')).trim()) issues.push(`docs/${name} is missing or empty`)
    } catch { issues.push(`docs/${name} is missing`) }
  }
  return issues
}

function designCheck(workspace: string, state: ProjectDeliveryState, nextConsumers?: readonly string[]) {
  const batch = state.authorBatch ?? (projectDeliveryPhase(state) === 'author' ? 0 : AUTHOR_BATCHES.length - 1)
  const documents = [...new Set(AUTHOR_BATCHES.slice(0, batch + 1).flat())]
  let settings: { inputs?: string[]; orientation?: unknown; dimension?: unknown } | undefined
  try { settings = JSON.parse(state.objective).settings } catch { /* Plain-text brief. */ }
  const handoff = checkDesignHandoff(workspace, documents, { nextConsumers: nextConsumers ?? (state.designReview?.returnPhase ? [state.designReview.returnPhase] : AUTHOR_BATCHES[batch + 1] ?? ['resources']),
    technicalBaseline: batch < AUTHOR_BATCHES.length - 1, inputs: settings?.inputs })
  const geometry = documents.includes('UI_UX_SPEC.md') ? checkReviewUiLayouts(workspace, settings).issues : []
  return { ...handoff, valid: handoff.valid && !geometry.length, issues: [...handoff.issues, ...geometry] }
}

export function projectDesignReleaseDiagnostics(workspace: string, state: ProjectDeliveryState) {
  return [...designCheck(workspace, state).issues,
    ...checkDesignDocumentReferences(workspace, state.authorBatch ?? AUTHOR_BATCHES.length - 1).issues]
}

/** Capture the actual inspected version before native dispatch, including legacy projects. */
export async function prepareProjectDesignReview(workspace: string, dataRoot: string) {
  return withStateMutation(workspace, dataRoot, async () => {
    const state = await readProjectDelivery(workspace, dataRoot)
    if (!state || state.status !== 'active' || projectDeliveryPhase(state) !== 'review') return state
    if (legacyIntermediateReview(state)) throw new Error(LEGACY_INTERMEDIATE_REVIEW)
    const draftIssues = await projectAuthorDraftIssues(workspace, AUTHOR_BATCHES.length - 1)
    if (draftIssues.length) throw new Error('Saved design drafts are unavailable: ' + draftIssues.join('; '))
    const check = designCheck(workspace, state)
    if (Object.keys(check.snapshots).length !== PROJECT_DOCUMENTS.length)
      throw new Error(`Saved design drafts are unavailable: ${check.issues.join('; ')}`)
    if (state.designReview) {
      if (state.designReview.stopped) throw new Error('Design review is stopped. Supply an explicit owner resolution through design-resolution; do not restart the automatic loop.')
      if (state.designReview.revision !== check.revision) throw new Error('Design changed after review handoff; identify the affected owner change before resuming, not a silent full re-review')
      return state
    }
    const next = { ...state, designReview: { step: 'inspect' as const, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, findings: state.designBaseline?.followUps ?? [] } }
    await save(workspace, dataRoot, next)
    return next
  })
}

/** A trusted, explicit user/owner request re-arms only the identified affected scope.
 * No natural-language message is silently interpreted as closure or authorization.
 */
export async function requestProjectDesignResolution(workspace: string, dataRoot: string, input: {
  instruction: string; mode: DesignReviewStep; findings: DesignFinding[]
}) {
  return withStateMutation(workspace, dataRoot, async () => {
    if (!input.instruction.trim()) throw new Error('Owner resolution needs an explicit decision or evidence instruction')
    const validated = designReviewResultSchema.parse({ step: input.mode, findings: input.findings, resolved: [] })
    if (input.mode !== 'inspect' && !validated.findings.length || new Set(validated.findings.map(f => f.id)).size !== validated.findings.length)
      throw new Error('Owner resolution needs unique affected findings')
    const state = await readProjectDelivery(workspace, dataRoot)
    if (!state) throw new Error('No project delivery to resolve')
    const recorded = state.designReview?.findings ?? state.designBaseline?.followUps ?? []
    const sourceIssues = checkDesignFindingSources(workspace, validated.findings.filter(f => !recorded.some(old => old.id === f.id)))
    if (sourceIssues.length) throw new Error(sourceIssues.join('; '))
    if (input.mode === 'inspect') {
      if (state.designReview || state.designBaseline) throw new Error('Use affected revise/verify, not a full re-review of a recorded baseline')
      const phase = projectDeliveryPhase(state)
      if (phase === 'author' || phase === 'review') throw new Error('Initial author/review uses its scheduled handoff')
      const check = designCheck(workspace, { ...state, authorBatch: AUTHOR_BATCHES.length - 1 })
      if (!check.valid) throw new Error('Prepare the missing saved design handoff through the authorized authors first: ' + check.issues.join('; '))
      const next: ProjectDeliveryState = { ...state, status: 'active', phase: 'review', authorBatch: AUTHOR_BATCHES.length - 1,
        designReview: { step: 'inspect', revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions,
          findings: validated.findings, instruction: input.instruction, returnPhase: phase === 'complete' ? 'implementation' : phase }, accepted: undefined, lastValidationFailure: undefined,
        designHistory: [{ step: 'owner-request', revision: check.revision, findings: validated.findings, resolved: [], instruction: input.instruction }] }
      await save(workspace, dataRoot, next)
      return next
    }
    if (!state.designReview && !state.designBaseline) throw new Error('Legacy delivery needs an explicit inspect before affected resolution')
    const findings = [...(state.designReview?.findings ?? state.designBaseline?.followUps ?? [])]
    for (const finding of validated.findings) {
      const index = findings.findIndex(f => f.id === finding.id)
      if (index >= 0) {
        // Explicit decisions supply the answer, not permission to hide the recorded issue.
        if (JSON.stringify(findings[index]) !== JSON.stringify(finding)) throw new Error('Do not redefine a recorded finding; supply its decision in instruction')
      } else findings.push(finding)
    }
    const phase = projectDeliveryPhase(state), batch = phase === 'review' ? state.authorBatch ?? 4 : state.designBaseline!.batch
    const check = designCheck(workspace, { ...state, authorBatch: batch })
    if (findings.some(f => f.documents.some(name => !check.snapshots[name]))) throw new Error('Affected scope must consist of delivered documents')
    if (input.mode === 'verify' && !check.valid) throw new Error(check.issues.join('; '))
    const allowed = new Set(findings.flatMap(f => f.documents))
    const original = state.designReview?.snapshots ?? state.designBaseline!.snapshots
    const changed = Object.keys(original).filter(name => original[name] !== check.snapshots[name])
    if (changed.some(name => !allowed.has(name as typeof PROJECT_DOCUMENTS[number]))) throw new Error('Changed documents exceed the explicit affected scope')
    const originalVersions = state.designReview?.documentVersions ?? state.designBaseline?.documentVersions
    for (const name of changed) {
      const previous = originalVersions?.[name], current = check.documentVersions[name]
      if (previous && (!current || !isHigherDocumentVersion(current, previous)))
        throw new Error(name + ': revised document version must increase from ' + previous)
    }
    const next: ProjectDeliveryState = { ...state, status: 'active', phase: 'review', authorBatch: batch, lastValidationFailure: undefined,
      designReview: { step: input.mode, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, findings,
        writableDocuments: [...new Set(validated.findings.flatMap(f => f.documents))],
        changedDocuments: changed, instruction: input.instruction,
        returnPhase: state.designReview?.returnPhase ?? (phase === 'review' ? undefined : phase === 'complete' ? 'implementation' : phase),
        returnAuthorBatch: state.designReview?.returnAuthorBatch ?? (phase === 'author' ? state.authorBatch : undefined) },
      accepted: undefined, designHistory: [...state.designHistory ?? [], { step: 'owner-request', revision: check.revision, findings, resolved: [], instruction: input.instruction }] }
    await save(workspace, dataRoot, next)
    return next
  })
}

/** Before dispatch and after completion: a changed baseline is not permission for paid dependent work. */
export function checkProjectDesignBaseline(workspace: string, state: ProjectDeliveryState, finalizingDraft = false) {
  if (legacyIntermediateReview(state)) return [LEGACY_INTERMEDIATE_REVIEW]
  const phase = projectDeliveryPhase(state)
  if (phase === 'review') return []
  const baseline = state.designBaseline ?? (phase === 'author' ? state.designDrafts : undefined)
  if (!baseline) return []
  const scheduled = phase === 'author' ? AUTHOR_BATCHES[state.authorBatch ?? 0] ?? [] : []
  const documents = [...new Set([...Object.keys(baseline.snapshots), ...scheduled])] as Array<typeof PROJECT_DOCUMENTS[number]>
  const check = checkDesignHandoff(workspace, documents,
    { technicalBaseline: baseline.batch < AUTHOR_BATCHES.length - 1,
      nextConsumers: phase === 'author' ? [] : [phase] })
  const changed = Object.keys(baseline.snapshots).filter(name => baseline.snapshots[name] !== check.snapshots[name] &&
    !scheduled?.some(assigned => assigned === name))
  const changedEvidencePaths = Object.keys(baseline.evidenceHashes).filter(path => baseline.evidenceHashes[path] !== check.evidenceHashes[path])
  // Scheduled owners may revise their evidence too. Shared evidence still
  // belongs to every protected consumer, not just the current writer.
  const protectedEvidence = phase === 'author' && changedEvidencePaths.length
    ? checkDesignHandoff(workspace, Object.keys(baseline.snapshots).filter(name => !scheduled.some(assigned => assigned === name)) as Array<typeof PROJECT_DOCUMENTS[number]>).evidenceHashes
    : check.evidenceHashes
  const changedEvidence = changedEvidencePaths.some(path => phase !== 'author' || Object.hasOwn(protectedEvidence, path))
  const versionIssues = phase === 'author' && !finalizingDraft ? (scheduled ?? []).flatMap(name => {
    const previous = baseline.documentVersions?.[name]
    return previous && baseline.snapshots[name] !== check.snapshots[name] &&
      (!check.documentVersions[name] || !isHigherDocumentVersion(check.documentVersions[name]!, previous))
      ? [name + ': revised document version must increase from ' + previous] : []
  }) : []
  // Draft handoffs are inspected together after all authors finish. While
  // writing, protect delivered bytes without turning a draft into approval.
  const integrityIssues = phase === 'author' ? [] : check.issues
  return [...integrityIssues, ...versionIssues, ...(changed.length || changedEvidence ? ['Reviewed design/evidence changed outside scheduled owner scope; request an affected design-resolution before dependent work.'] : []),
    ...(state.designBaseline?.followUps ?? []).filter(f => phase !== 'author' && f.neededBefore === phase).map(f => `${f.id} is due before ${phase}; owner ${f.owner}: ${f.closeWhen}`)]
}

function statePath(workspacePath: string, dataRoot: string): string {
  const absolute = resolve(workspacePath)
  const canonical = realpathSync.native(absolute)
  const identity = createHash('sha256').update(canonical).digest('hex')
  return join(dataRoot, 'project-delivery', identity, 'state.json')
}

export const projectDeliveryStatePath = statePath

const stateMutations = new Map<string, Promise<void>>()
async function withStateMutation<T>(workspacePath: string, dataRoot: string, mutate: () => Promise<T>): Promise<T> {
  const key = statePath(workspacePath, dataRoot)
  const previous = stateMutations.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => current)
  stateMutations.set(key, tail)
  await previous
  try { return await mutate() }
  finally {
    release()
    if (stateMutations.get(key) === tail) stateMutations.delete(key)
  }
}

async function save(workspacePath: string, dataRoot: string, state: ProjectDeliveryState): Promise<void> {
  const path = statePath(workspacePath, dataRoot)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function readProjectDelivery(workspacePath: string, dataRoot: string): Promise<ProjectDeliveryState | undefined> {
  let raw: string
  try { raw = await readFile(statePath(workspacePath, dataRoot), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value as ProjectDeliveryState).version !== 1 ||
      typeof (value as ProjectDeliveryState).objective !== 'string' ||
      !['active', 'paused'].includes((value as ProjectDeliveryState).status))
    throw new Error('Invalid project delivery state')
  // One-time normalization for projects that were paused at the removed milestone.
  if ((value as { phase?: unknown }).phase === 'visual-review') {
    const { visualReviewApprovedDigest: _oldApproval, ...previous } = value as ProjectDeliveryState & { visualReviewApprovedDigest?: string }
    return { ...previous, phase: 'resources' }
  }
  return value as ProjectDeliveryState
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

export async function refreshProjectContentContract(workspacePath: string) {
  return materializeSceneUiAuthoringContract(workspacePath,
    buildSceneUiContentAuthoringAuthority(projectContentAuthority(workspacePath)))
}

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
  const issues: string[] = []
  let diagnostic: AcceptanceDiagnostic | undefined
  // Design release has its own bounded result, not an LLM complete string.
  if (phase === 'review') {
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
    const resultIssues = designReviewResultIssues(result, { step: review.step, findings: review.findings,
      sourceHeadings: designReviewSourceHeadings(workspacePath, Object.keys(check.snapshots)) })
    if (resultIssues.length) return { phase, shouldContinue: false, issues: resultIssues }
    state = { ...state, designHistory: [...state.designHistory ?? [], { step: review.step, revision: check.revision, findings: result.findings, resolved: result.resolved }] }
    const blockers = result.findings.filter(f => f.severity === 'blocker')
    const stop = async (findings: DesignFinding[], reason: string) => {
      await save(workspacePath, dataRoot, { ...state, designReview: { ...review, findings, stopped: true }, lastValidationFailure: reason })
      return { phase, shouldContinue: false, issues: [reason, ...findings.filter(f => f.severity === 'blocker').map(f => `${f.id}: owner ${f.owner}; ${f.impact}; close: ${f.closeWhen}`)] }
    }
    if (conclusion.status === 'blocked') return stop(result.findings, 'Review requires evidence or an owner/user decision; no automatic retry.')
    let references = checkDesignDocumentReferences(workspacePath, state.authorBatch ?? AUTHOR_BATCHES.length - 1)
    if (review.step === 'inspect' && (blockers.length || !check.valid || !references.valid)) {
      if (blockers.some(f => f.action !== 'correct' || f.owner === 'user')) return stop(result.findings, 'Required decision/evidence cannot be selected by the reviewer.')
      const deterministicIssues = [...check.issues, ...references.issues]
      // Program diagnostics name their actual source document. Their repair
      // must not depend on a model severity label or an invented prose finding.
      const sourceFor = (issue: string) => PROJECT_DOCUMENTS.find(name => Object.hasOwn(check.snapshots, name) &&
        (issue.startsWith(name + ':') || issue.startsWith('docs/' + name + ':')))
      if (deterministicIssues.some(issue => !sourceFor(issue)))
        return stop(result.findings, 'Deterministic failure has no delivered correction scope: ' + deterministicIssues.join('; '))
      await save(workspacePath, dataRoot, { ...state, designReview: { ...review, step: 'revise', findings: result.findings,
        writableDocuments: [...new Set([...blockers.flatMap(f => f.documents), ...deterministicIssues.map(issue => sourceFor(issue)!)])] } })
      return { phase, shouldContinue: true, issues: [] }
    }
    if (review.step === 'revise') {
      const allowed = new Set(review.writableDocuments ?? review.findings.filter(f => f.severity === 'blocker').flatMap(f => f.documents))
      if (changed.some(name => !allowed.has(name as typeof PROJECT_DOCUMENTS[number]))) return stop(review.findings, 'Revision modified a document outside the recorded affected scope.')
      if (documentSnapshot) {
        const finalized = finalizeDesignDocuments(workspacePath, [...allowed], documentSnapshot)
        if (finalized.issues.length) return stop(review.findings, 'The one revision pass still fails saved handoff checks: ' + finalized.issues.join('; '))
        check = designCheck(workspacePath, state)
        changed = Object.keys(check.snapshots).filter(name => check.snapshots[name] !== review.snapshots[name])
        references = checkDesignDocumentReferences(workspacePath, state.authorBatch ?? AUTHOR_BATCHES.length - 1)
      }
      const versionIssues = changed.flatMap(name => {
        const previous = review.documentVersions?.[name], current = check.documentVersions[name]
        return previous && (!current || !isHigherDocumentVersion(current, previous))
          ? [name + ': revised document version must increase from ' + previous] : []
      })
      const staticIssues = [...check.issues, ...versionIssues, ...references.issues]
      if (staticIssues.length) return stop(review.findings, 'The one revision pass still fails deterministic checks: ' + staticIssues.join('; '))
      await save(workspacePath, dataRoot, { ...state, designReview: { ...review, step: 'verify', revision: check.revision,
        snapshots: check.snapshots, documentVersions: check.documentVersions, changedDocuments: changed } })
      return { phase, shouldContinue: true, issues: [] }
    }
    if (review.step === 'verify') {
      if (blockers.length) return stop(result.findings, 'Targeted verification still has blockers; the one revision pass is exhausted.')
    }
    if (!check.valid || !references.valid) return stop(result.findings, 'Deterministic release checks still fail: ' + [...check.issues, ...references.issues].join('; '))
    const batch = state.authorBatch ?? AUTHOR_BATCHES.length - 1
    let next = review.returnPhase ?? 'resources'
    const changedSources = Object.keys(check.snapshots).filter(name => state.designBaseline?.snapshots[name] !== check.snapshots[name]) as Array<typeof PROJECT_DOCUMENTS[number]>
    const change = review.returnPhase && state.designBaseline?.revision !== check.revision
      ? { documents: changedSources.length ? changedSources : review.writableDocuments ?? [...new Set(review.findings.flatMap(f => f.documents))], instruction: review.instruction }
      : undefined
    // Formal content binds the design revision. A changed baseline cannot jump
    // straight back to implementation with stale content or resource bindings.
    if (review.returnPhase && ['content', 'implementation', 'acceptance'].includes(review.returnPhase) &&
        state.designBaseline?.revision !== check.revision) {
      next = changedSources.some(name => ['ART_DIRECTION.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md'].includes(name)) ? 'resources' : 'content'
    }
    const nextAuthorBatch = review.returnAuthorBatch ?? batch + 1
    const nextConsumers: readonly string[] = next === 'author' ? AUTHOR_BATCHES[nextAuthorBatch] ?? [] : [next]
    const consumerCheck = designCheck(workspacePath, state, nextConsumers)
    if (!consumerCheck.valid) return stop(result.findings, 'Next-consumer delivery requirements still fail: ' + consumerCheck.issues.join('; '))
    const due = result.findings.filter(f => f.neededBefore !== null &&
      (nextConsumers.includes(f.neededBefore) || PROJECT_DOCUMENTS.some(name => name === f.neededBefore)))
    if (due.length) return stop(result.findings, 'A deferred required decision is due before the next consumer; it cannot be released as a follow-up.')
    const baseline = { batch: state.authorBatch ?? AUTHOR_BATCHES.length - 1, revision: check.revision, snapshots: check.snapshots, documentVersions: check.documentVersions, evidenceHashes: check.evidenceHashes,
      followUps: result.findings.filter(f => f.severity === 'follow-up'), ...(change ? { change } : {}) }
    if (next === 'content') await refreshProjectContentContract(workspacePath)
    await save(workspacePath, dataRoot, { ...state, phase: next, ...(next === 'author' ? { authorBatch: nextAuthorBatch } : {}),
      designReview: undefined, designDrafts: undefined, designBaseline: baseline, lastValidationFailure: undefined })
    return { phase: next, shouldContinue: true, issues: [] }
  }
  const baselineIssues = checkProjectDesignBaseline(workspacePath, state, phase === 'author' && !!documentSnapshot)
  if (baselineIssues.length) return { phase, shouldContinue: false, issues: baselineIssues }
  if (phase === 'implementation' || phase === 'author' && (state.authorBatch ?? 0) === 0) {
    if (conclusion?.phase !== phase || conclusion.status !== 'complete') {
      return { phase, shouldContinue: false, issues: [conclusion?.phase === phase && conclusion.status === 'blocked'
        ? conclusion.summary : `The ${phase} milestone has no explicit completion result from this turn.`] }
    }
  }
  if (phase === 'author') {
    const batch = state.authorBatch ?? 0
    if (batch > 0 && completedAuthorBatch !== batch)
      return { phase, shouldContinue: false, issues: ['The scheduled writing owners have no completion result from this turn.'] }
    issues.push(...await projectAuthorDraftIssues(workspacePath, batch))
    // A completed chat or a draft file does not establish that the Agent's
    // first GDD assignment is finished. No paid repair
    // turn is dispatched for a contradictory completion signal.
    if (issues.length) {
      await save(workspacePath, dataRoot, { ...state, lastValidationFailure: JSON.stringify([phase, [...issues].sort()]) })
      return { phase, shouldContinue: false, issues }
    }
    if (documentSnapshot) {
      const finalized = finalizeDesignDocuments(workspacePath, AUTHOR_BATCHES[batch], documentSnapshot)
      if (finalized.unsafeIssues.length) {
        await save(workspacePath, dataRoot, { ...state, lastValidationFailure: JSON.stringify([phase, finalized.unsafeIssues]) })
        return { phase, shouldContinue: false, issues: finalized.unsafeIssues }
      }
      if (finalized.issues.length) issues.push('Saved draft handoff diagnostics await the joint inspection: ' + finalized.issues.join('; '))
    }
  } else if (phase === 'resources') {
    try {
      const validation = validateResourceDelivery(workspacePath, state.objective)
      if (!validation.valid) issues.push(...validation.issues)
    } catch (error) {
      issues.push(`Resource validation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else if (phase === 'content') {
    try {
      const audit = auditBeeGameContentPackage(workspacePath, projectContentAuthority(workspacePath))
      if (!audit.valid) issues.push(...audit.issues)
      // Recalculate the same UI source after resource/behavior binding.
      let settings: { orientation?: unknown; dimension?: unknown } = {}
      try { settings = JSON.parse(state.objective).settings ?? {} } catch { /* Legacy objectives may be plain text. */ }
      if (audit.valid) {
        issues.push(...checkReviewUiLayouts(workspacePath, settings).issues)
      }
    }
    catch (error) { issues.push(`Content validation failed: ${error instanceof Error ? error.message : String(error)}`) }
  } else if (phase === 'acceptance') {
    const report = await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
    diagnostic = report?.diagnostic
    if (!report) issues.push(`${PROJECT_DELIVERY_REPORT_PATH} is missing`)
    else if (diagnostic?.category === 'report-invalid') issues.push(diagnostic.message)
    else if (report.status === 'blocked' || diagnostic?.category === 'verification-incomplete' || diagnostic?.category === 'product-failed') {
      await save(workspacePath, dataRoot, { ...state, phase, lastValidationFailure: JSON.stringify([phase, report.summary]) })
      return { phase, shouldContinue: false, issues: [report.summary], diagnostic }
    } else if (report.scope !== 'delivery') issues.push(`${PROJECT_DELIVERY_REPORT_PATH} must have scope "delivery"`)
    else if (report.status === 'failed') issues.push(`${PROJECT_DELIVERY_REPORT_PATH} reports failed; address its recorded findings`)
    else {
      const gate = await evaluateProjectDeliveryGate(workspacePath, dataRoot, false)
      if (!gate?.allowed) issues.push(...(gate?.issues ?? ['Current-version acceptance could not be verified'])
        .map(issue => `Publish readiness (${gate?.layer ?? 'acceptance-record'}): ${issue}`))
    }
  }
  if (issues.length && phase !== 'author') {
    const failure = JSON.stringify([phase, [...issues].sort()])
    await save(workspacePath, dataRoot, { ...state, phase, lastValidationFailure: failure })
    // Send new diagnostic information once. Unrelated edits are not evidence
    // of progress and must not continually re-arm a paid automatic turn.
    // This deduplicates host dispatch, not the Agent's own repair attempts or
    // explicit user turns (which are always delivered).
    return { phase, shouldContinue: state.lastValidationFailure !== failure, issues, ...(diagnostic ? { diagnostic } : {}) }
  }
  if (phase === 'author') {
    const batch = state.authorBatch ?? 0, next = batch === AUTHOR_BATCHES.length - 1 ? 'review' : 'author'
    const check = designCheck(workspacePath, state)
    const designDrafts = { batch, revision: check.revision, snapshots: check.snapshots,
      documentVersions: check.documentVersions, evidenceHashes: check.evidenceHashes }
    await save(workspacePath, dataRoot, { ...state, phase: next, authorBatch: next === 'author' ? batch + 1 : batch,
      designDrafts, lastValidationFailure: undefined })
    return { phase: next, shouldContinue: true, issues }
  }
  const next = NEXT_PHASE[phase]
  if (next === 'content') await refreshProjectContentContract(workspacePath)
  await save(workspacePath, dataRoot, { ...state, phase: next, lastValidationFailure: undefined })
  return { phase: next, shouldContinue: next !== 'complete', issues: [] }
  })
}

/** Capture an Agent's fresh delivery report once. Later file changes cannot silently re-baseline it. */
export async function captureProjectDeliveryAcceptance(workspacePath: string, dataRoot: string, turnStartedAt: number): Promise<void> {
  await withStateMutation(workspacePath, dataRoot, async () => {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (!state || state.status !== 'active') return
  if (!['acceptance', 'complete'].includes(projectDeliveryPhase(state))) return

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
  if (state.accepted?.source === 'report' &&
      state.accepted.reportSha256 === reportSha256) return
  const revision = await computeWorkspaceRevision(workspacePath)
  await save(workspacePath, dataRoot, { ...state, accepted: {
    source: 'report',
    revision, reportPath: latest.path, reportSha256, reports: [report],
  } })
  })
}

export async function evaluateProjectDeliveryGate(workspacePath: string, dataRoot: string, requireComplete = true): Promise<{
  allowed: boolean
  issues: string[]
  layer: 'report' | 'acceptance-record' | 'delivery' | 'revision' | 'ready'
} | undefined> {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (!state) return undefined
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
  return { allowed: true, layer: 'ready', issues: [] }
}

/** Editor authority comes from the authored package, not a delivery phase snapshot. */
export function nativeContentAuthority(workspacePath: string): BeeGameContentAuthority {
  return projectContentAuthority(workspacePath)
}
