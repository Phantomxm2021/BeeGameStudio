import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { computeWorkspaceRevision, resolveWorkspaceRelativePath } from './workspace-revision'
import { PROJECT_DOCUMENTS, projectContentAuthority } from './project-content-authority'
import { AUTHOR_BATCHES, authorBatchInstruction } from './project-author'
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
export function projectDeliveryPhaseInstruction(phase: ProjectDeliveryPhase, authorBatch = 0): string {
  switch (phase) {
    case 'author': return authorBatchInstruction(authorBatch)
    case 'review': return `Current delivery milestone: review. This stage includes review and revision.
Review the current eight files in docs/ against the confirmed requirements and platform agreements. Establish findings from current source definitions and necessary dependencies: earlier authoring summaries, completion labels and your own previous conclusions are claims to check, not evidence that the design is correct.
Determine whether a developer can implement the agreed experience and an acceptance reviewer can verify it from these documents, without inventing missing product decisions. Cover the whole design:
- Gameplay, states and content: objectives, legal actions, outcomes, interactions, transitions and recovery fit together and cover the agreed release.
- Rules and quantities: important conclusions follow from the authoritative rules and actual content. Check the modeled situation as well as arithmetic; use legal actions to support feasibility and distinguish examples, bounds and playtest hypotheses.
- UI and scene: every planned screen/state is represented by its layout input or a referenced shared composition, including menus and modal contents, not only HUD/game-view regions. Check that declared adaptation is actually in these inputs and final resolved control bounds meet the declared host-pixel usability minima; local sizes or minSize alone do not establish that. Use the supplied spatial calculator on final inputs at the reference, smallest supported and layout-transition sizes. Investigate child containment, reserved padding and unreadable or unmeasured content; calculate required container space from child constraints rather than accepting a prose minimum. Calculate UI allocation first and use its game-view rectangle for scene framing, not the whole host window. Different screen shapes may select different compositions; check each against gameplay visibility and permitted overlay regions, including the full HUD/control footprint rather than only whether it touches game objects. UI_UX_SPEC owns allocation and layout selection; LEVEL_SCENE_DESIGN owns world/framing requirements and references that allocation. TECHNICAL_DESIGN explains consumption and coordinate conversion without duplicating final rectangles or camera offsets. Examples and verification expectations reference these same inputs/results rather than establishing another layout baseline.
- Art, audio, resources and technology: the intended presentation is preserved; required versus optional deliverables, triggers, loading, failure handling and lifecycle responsibilities agree across their producers and consumers. Reconcile UI placement and animation with the art direction; when a decision changes, update the affected source and consumer clauses as well as its calculation input, not just the review conclusion.
Establish concrete findings from the files before revising: identify the source requirement, the contradictory or unsupported claim, and the affected dependencies. Follow dependencies rather than limiting the review to items already labelled unresolved. Use applicable Skills; methods, tools and subagent collaboration are yours to choose.
The review conclusion must match the requirements actually checked and the observed results; a passing subset of calculations or a subagent's agreement does not establish a whole-design pass. Keep concise working evidence so the basis and limits of consequential conclusions can be rechecked.
Correct the affected documents directly, then verify each correction against its source requirements and affected consumers, including new claims and layout selection conditions. When layout decisions change, synchronize affected source and consumer region bounds and claims, update their calculation inputs and rerun affected compositions/sizes; updating prose or a camera result alone does not verify controls and overlays. Do not relax agreed usability minima merely to fit a chosen projection. Reconcile document references to the final inputs/results and remove superseded duplicate layout values. Keep findings and verification concise and traceable to source sections; no separate report, author self-review or independent checker is required.
Preserve the confirmed scope and technical implementation freedom. If a correction requires changing the confirmed gameplay promise or delivery scope, explain the issue and leave that decision to the user. Resolve decisions needed for development here. Record concrete runtime checks for visual quality, feel and other assumptions that require a running game; do not defer contradictions or invalid calculations as playtest questions.
Pass only when no development blockers remain and the corrected design has been rechecked. Update version information in revised documents and mark the design as the implementation and acceptance baseline; do not rewrite unchanged documents merely to synchronize version numbers. Briefly report the outcome, important findings and their verification, unresolved issues and runtime checks; do not claim checks you did not perform.`
    case 'resources': return `Current delivery milestone: resources.
Using the reviewed ASSET_PLAN.md together with the art, audio, UI, scene and technical documents, complete the required resources for this delivery. Optional resources do not block completion.
Inspect existing resources, reuse those that meet the requirements and fill the gaps. Each required resource must correspond to a usable file or reproducible procedural output, with its intended use and usage explained.
For a planned generated file or reusable procedural resource, deliver the usable output or executable generator with its inputs and usage; a promise to create it later is not resource completion. Simple shapes or effects intentionally expressed by content parameters and runtime behavior need not become separate asset files or generator frameworks. Identify those design references and remaining content/runtime integration briefly in the handoff; do not claim that integration is already tested.
Choose built-in library assets, web assets, AI generation or procedural creation according to actual needs. First meet the design requirements, visual consistency and target-platform constraints, then compare time and cost. Approved fallbacks in the documents are valid; do not lower requirements on your own.
Preserve the planned delivery structure and required variants as well as appearance: changing the production source does not silently cancel an atlas, animation or TileSet. Prefer compatible small 2D sprites with shared loading lifetime in atlases; keep large backgrounds, fonts, audio and models separate as appropriate. For AI-sourced small sprites or UI elements of one style that fit at usable detail, prefer one generation request for a shared sheet, not one request per element followed by optional packing. Request distinguishable, separated elements with useful spacing; choose transparency for their use. Split generation only for a concrete composition, detail or independent-use need and briefly explain it; a planned atlas is not optional merely because its source images were generated separately. The image model produces pixels, not authoritative frame coordinates: inspect the actual sheet and register named, in-bounds regions with logical display sizes, pivots and applicable padding/nine-slice metadata. Elements that vary independently must remain independently addressable. Functional text, interactions and layout belong in subsequent content data.
AI image generation defaults to 1024x1024 and low quality. Choose transparency, image count and organization for the intended use; change size only for a concrete need. Consult the available capability instructions for tool usage and registration formats. Resource registration interface: ${ASSET_MANIFEST_AUTHORING_CONTRACT_PATH}.
Atlas priority applies regardless of source: AI, retrieved images and procedurally drawn static sprites. For procedural sprites, prefer drawing directly into a shared sheet and emitting exact frame metadata from those drawing coordinates; existing separate sprites may be packed without regenerating their art. Group by concurrent use and compatible filtering, not source, and avoid loading unrelated content in a giant atlas. Keep dynamic text, live bars and simple parameter-driven geometry as runtime drawing where designed. Preserve source files when useful, but register runtime atlas/member bindings rather than loading both packed and source images for the same use.
Check resource quality and import requirements, including the visual, audio and technical properties relevant to its type. Building a complete game is not a prerequisite for resource checks. Successful generation, file existence or valid format alone does not establish design compliance.
Deliver the selected files and assets/asset-manifest.json, recording origins and necessary usage metadata. Check licenses for third-party assets; downloaded fonts remain third-party resources, not procedural creations. Accurately record generation origins for AI and procedural assets. Verify image/font decoding in the target browser where applicable, not just extensions or file existence. The content stage handles scene and UI layout and bindings.
When a required resource cannot be delivered, report the missing item, reason and feasible options. Do not edit the reviewed design documents or mark missing resources complete.
Briefly report delivery results and unresolved issues. Check and invoke applicable Skills; use subagents in parallel for independent tasks with clear dependencies, choosing the task split yourself.`
    case 'content': return `Current delivery milestone: content. Translate the reviewed design and delivered resources into editable Scene/UI/VFX data and content/index.json for the agreed game.

Inputs and scope:
Read the relevant reviewed design documents and resource handoff. Account for every planned screen and level, reusing shared components, scenes and procedural definitions where appropriate rather than duplicating files for every state or generated level. Preserve existing correct data.
Use the schemas, coordinate semantics, supported components, resource references and BGS-supplied revision values in ${PROJECT_CONTENT_CONTRACT_PATH} and its referenced format guidance. These are platform inputs, not algorithms to reverse-engineer. Choose representations suited to the confirmed 2D, 3D or XR target; do not introduce components merely to satisfy an unrelated example.

Design-to-data handoff:
Preserve the reviewed spatial composition: scene hierarchy, transforms, camera/framing, visual layers, placements and applicable generation parameters. For UI, carry through each screen's elements, content, layout, adaptation and state/action bindings, including the play-area placement relative to UI. Use the actual delivered resources and their registered members/frames rather than inventing missing assets.
Express static design and supported state configuration in the content format. Identify the existing node/action/state references that runtime code must connect for dynamic behavior and feedback. Data declaration is not executable gameplay; do not silently omit a requirement because it needs code, or invent unsupported fields to make it appear implemented. Keep standalone gameplay configuration outside the Scene/UI/VFX registry as the contract requires.

Checks and completion:
Derive concrete values from the reviewed layout rules; do not choose a new layout or interaction design. If a necessary design decision is missing, identify the requirement and affected content instead of silently deciding it here.
Use the supplied --layout inspection at chosen viewport sizes using the Editor's shared coordinate functions. Keep the reviewed layout selection and space allocation; use resolved UI rectangles to determine the Scene viewport instead of independently sizing both against the whole window. Investigate anchors, stretch and containment; inspect actual Editor previews for text, visual hierarchy and intended overlaps. Geometry inspection does not certify appearance or gameplay. Preserve planned Tilemap/TileSet bindings; report an incompatible resource rather than silently replacing its representation.
Compare the resulting data against the applicable document requirements, including space allocation and adaptation, and use the provided read-only content checker for format and reference errors. A valid schema alone does not establish design coverage or runtime correctness. Correct data omissions against explicit design requirements; report missing resources, contradictory design or requirements the format cannot express, without changing reviewed documents or silently simplifying the design.
Briefly hand off the delivered content, the runtime behavior still to connect and any unresolved gaps, using existing files and references rather than creating a separate mandatory report. Building the full game is not required in this stage, and runtime verification remains to be completed after implementation. Tools, task order and subagent collaboration are yours to choose.`
    case 'implementation': return `Current delivery milestone: implementation. Deliver the complete runnable game defined by the reviewed design and delivered content.

Design and data inputs:
Read the reviewed eight documents in docs/ for the agreed gameplay, presentation, interactions and first-release scope. Inspect existing code, resources and content; preserve correct work rather than rebuilding it.
The documents define intended design. Consume content/index.json, its registered Scene/UI/VFX documents and assets/asset-manifest.json. Data semantics and runtimeConsumption are in .beegame/delivery/content-format.json; content-format files define data syntax, not gameplay design.
Content remains the editable source for static hierarchy, transforms, layout, responsive variants, Tilemap cells and resource bindings. Runtime code parses these and implements gameplay and dynamic presentation; do not maintain a separate substitute layout.
For atlas assets, share loading and decoded image/texture sources by resolved asset URL within their useful lifetime, including concurrent requests. Frames reference regions of that source; avoid per-frame fetch/decode or copied pixel buffers merely to select a region. Use the chosen engine's existing cache where available, release owned resources when no longer needed, and keep unrelated atlas groups on demand. Sharing a sheet does not by itself guarantee rendering batches.

Implementation approach:
Work incrementally in this same project session. Technology, tools and task granularity are yours to choose. The following are dependency-aware working steps, not additional delivery stages or approval gates; do not stop between them for BGS to dispatch another assignment.
Reuse an existing valid plan, or form a concise checklist connecting required features, screens, scenes and key states to document/data references, implementation tasks and observable checks. Mark existing, missing and conflicting work; keep this plan current for interruption/resumption without separate step reports. Resume from unresolved work, not automatically from step one.

1. Establish and verify data consumption before expanding presentation.
Use representative real project UI and Scene data, including nested elements and resources where present. Verify rendered geometry, text, images/atlas regions, layering and enabled states against that data at the reference and constrained container sizes specified by the design. Use the supplied coordinate/format references or optional helpers; test actual rendering, not just parsed JSON. A representative temporary layout/resource change must affect the intended rendered element and be restored. Verify Tilemaps only where the project uses them.
Completion: the foundation supports the representative content correctly, demonstrated in the target runtime. Fix discovered parsing/rendering errors before reusing that foundation across more screens; a hard-coded replacement or successful build does not close this step. Identify unsupported data or design conflicts and continue independent work where possible.

2. Deliver a representative vertical slice that establishes the core experience.
Connect loading, entry, a small portion of core play, its applicable end condition and restart using real content and the agreed rules. Integrate enough intended UI, art and feedback to verify the design and its technical feasibility, rather than leaving presentation entirely to the end. Target the documented quality, not open-ended polishing or new art direction. Non-blocking presentation refinements may remain on the existing checklist for completion before handoff; do not defer broken parsing, unreadable controls or feedback needed to understand play. Verify actual input and repeatability, including restart cleanup. For games without a conventional win/lose loop, use their documented equivalent.
Completion: the representative experience works and dependencies needed for expansion are verified. An intermediate playable version is not final delivery; track all remaining scope explicitly.

3. Expand through independently verifiable feature units.
Split remaining scope by observable player outcomes and dependencies, not just files or disciplines such as "finish UI" then "finish gameplay". In the existing concise checklist, associate each unit with its document/data references, required behavior and relevant entry/exit or recovery paths, presentation/feedback, dependencies and a practical completion check. Shared rules may be referenced; do not create another set of design documents or prescribe a fixed task count.
Complete the applicable rules, data bindings, interaction, presentation and verification together for each unit. Group work by a testable player behavior, not individual widgets or edits. Use deterministic tests for rules/calculations and target-runtime observation for presentation/input; batch related checks instead of launching a browser for every small task. Reuse checks shared by several units and recheck affected consumers when shared code changes. Cover the remaining agreed scope without silently substituting placeholders.
Completion: every required item has an implementation and an observed check, or is explicitly unresolved. Optional enhancements do not block; required omissions are not optional polish. All planned screens and levels must work in the production build.

4. Integrate and hand off the current build.
Reconcile the checklist with the final build and existing evidence. Reuse evidence that remains valid for the current implementation; check remaining integration risks and results invalidated by final changes in the target environment, rather than repeating every earlier check. Preserve reusable tests and evidence, and clean up only test resources you started.
Completion: required scope is implemented and checked for the handed-off version, or remaining gaps are explicitly reported. Implementation self-checks do not replace subsequent acceptance: that stage evaluates overall coverage and fills evidence gaps, not automatically rerunning the whole implementation test suite. Distinguish game defects from unavailable environments or faulty test drivers. Briefly hand off scope, actual results, evidence locations and unresolved issues; a successful build alone is not complete delivery.

Parallel work:
Use subagents for bounded feature units, independent modules or focused verification when useful. Establish the relevant shared state, data and interface agreements before parallelizing dependent work. Give each a bounded objective, relevant document/data references, owned files and completion checks. Avoid concurrent edits to the same parser or interface; the main Agent maintains the plan and integrates shared decisions in this project session. Do not split entire gameplay, UI and audio systems into disconnected efforts and postpone their integration until the end. Delegates do not each recreate the whole game or repeat full acceptance. Integrate and verify their combined result before claiming completion; a subagent's PASS alone is not integration evidence. You may adapt task order or combine steps for a small project whose slice covers most of its scope, but do not treat an unverified dependency as complete.

Design consistency and issue handling:
Implement the full agreed scope, including necessary elements, interaction states, feedback and adaptation, not only the normal play path.
If code fails to implement the design or consume data correctly, fix the implementation. If content omits or contradicts an explicit document requirement, correct the data while preserving valid formats and references.
The reviewed eight documents are the implementation baseline. Do not edit them during implementation. If they conflict, lack a necessary design decision or require something the current contract cannot express, report specific evidence, impact and a proposed resolution. Do not silently reduce scope or change the specification to fit the implementation. Continue unaffected work where possible, but do not mark the unresolved requirement complete.

Keep verification proportional to project complexity and risk; unobserved work remains unverified.`
    case 'acceptance': return `Current delivery milestone: acceptance. Determine whether the current game fully implements the reviewed design and is usable in the agreed runtime environment.

Acceptance basis:
Derive checks from the confirmed scope and reviewed eight documents, including completion conditions and runtime-dependent questions left open in those documents. Scene/UI and resource data describe the corresponding content; neither the existing implementation nor an Agent summary replaces the agreed requirements.
Read the implementation handoff and existing evidence to identify remaining verification. Reuse results still valid for the current version; do not repeat the whole development process or write a separate long acceptance plan.

Verification:
Choose methods and order appropriate to the project, covering applicable requirements:
- Complete experience: agreed gameplay, screens and levels, and the transitions through start, play, outcomes, retry and other key states.
- Rules and boundaries: behavior, calculations and state transitions against the design, including important edge cases and abnormal operations.
- Player-facing result: actual composition, framing, resources, text, interaction feedback and audio against the design under the agreed display conditions and input methods. Verify usable control bounds, not merely element presence or successful navigation. Keep visual captures or equivalent target-device evidence where relevant.
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
  accepted?: ProjectDeliveryAcceptance
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
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (state?.status === 'paused') {
    const resumed = { ...state, status: 'active' as const }
    await save(workspacePath, dataRoot, resumed)
    return resumed
  }
  return state
  })
}

/** Advance only after a successful native turn; validation issues keep the same milestone. */
export async function advanceProjectDeliveryAfterTurn(workspacePath: string, dataRoot: string, conclusion?: import('./milestone-result').MilestoneResult): Promise<{
  phase: ProjectDeliveryPhase
  shouldContinue: boolean
  issues: string[]
  diagnostic?: AcceptanceDiagnostic
} | undefined> {
  return withStateMutation(workspacePath, dataRoot, async () => {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (!state || state.status !== 'active') return undefined
  const phase = projectDeliveryPhase(state)
  if (phase === 'complete') return { phase, shouldContinue: false, issues: [] }
  const issues: string[] = []
  let diagnostic: AcceptanceDiagnostic | undefined
  if (phase === 'review' || phase === 'implementation') {
    if (conclusion?.phase !== phase || conclusion.status !== 'complete') {
      return { phase, shouldContinue: false, issues: [conclusion?.phase === phase && conclusion.status === 'blocked'
        ? conclusion.summary : `The ${phase} milestone has no explicit completion result from this turn.`] }
    }
  } else if (phase === 'author') {
    const batch = state.authorBatch ?? 0
    if (!AUTHOR_BATCHES[batch]) throw new Error('Invalid author batch')
    for (const name of AUTHOR_BATCHES.slice(0, batch + 1).flat()) {
      const path = join(workspacePath, 'docs', name)
    try { const file = await stat(path); if (!file.isFile() || file.size === 0) issues.push(`docs/${name} is missing or empty`) }
      catch { issues.push(`docs/${name} is missing`) }
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
  if (issues.length) {
    const failure = JSON.stringify([phase, [...issues].sort()])
    await save(workspacePath, dataRoot, { ...state, phase, lastValidationFailure: failure })
    // Send new diagnostic information once. Unrelated edits are not evidence
    // of progress and must not continually re-arm a paid automatic turn.
    // This deduplicates host dispatch, not the Agent's own repair attempts or
    // explicit user turns (which are always delivered).
    return { phase, shouldContinue: state.lastValidationFailure !== failure, issues, ...(diagnostic ? { diagnostic } : {}) }
  }
  if (phase === 'author' && (state.authorBatch ?? 0) < AUTHOR_BATCHES.length - 1) {
    await save(workspacePath, dataRoot, {
      ...state, authorBatch: (state.authorBatch ?? 0) + 1, lastValidationFailure: undefined,
    })
    return { phase, shouldContinue: true, issues: [] }
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
