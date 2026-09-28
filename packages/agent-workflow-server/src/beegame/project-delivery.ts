import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { computeWorkspaceRevision, resolveWorkspaceRelativePath } from './workspace-revision'
import { PROJECT_DOCUMENTS, projectContentAuthority } from './project-content-authority'
export { PROJECT_DOCUMENTS, projectContentAuthority } from './project-content-authority'
import { auditBeeGameContentPackage, type BeeGameContentAuthority } from './game-content-package'
import { buildSceneUiContentAuthoringAuthority, materializeSceneUiAuthoringContract, materializeSceneUiFormat } from './scene-ui-content-authoring'
import { validateResourceDelivery } from './resource-validation-cli'
import { ASSET_MANIFEST_AUTHORING_CONTRACT_PATH, ASSET_MANIFEST_VALIDATION_COMMAND, materializeAssetManifestAuthoringContract } from './asset-manifest-authoring-contract'
import {
  readRuntimeAcceptanceReport,
  runtimeEvidenceIsCurrent,
  type RuntimeAcceptance,
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
export function projectDeliveryPhaseInstruction(phase: ProjectDeliveryPhase): string {
  switch (phase) {
    case 'author': return `Current delivery milestone: author. Write the eight implementable design documents in docs/ from the confirmed requirements: ${PROJECT_DOCUMENTS.join(', ')}. Preserve useful drafts. Include version, author and date. Cover every planned screen and level, layout/size rules, interactions and device constraints appropriate to the chosen 2D, 3D or XR target; editable Scene/UI layouts belong in content data. For each planned UI screen, specify all visible and interactive elements, their parent-relative geometry, visual and interaction states, and relevant responsive changes; equivalent screens may share a pattern. Screen UI uses top-left logical pixels (+X right, +Y down); the child pivot defaults to its anchor. A middle-center panel at position [0,0] is centered; subtracting half its size again moves it off center. Make the visual composition implementable before coding: show how the play area, controls, HUD, backgrounds and focal elements share space at the target view and relevant aspect ratios, and how each planned level's spatial arrangement supports gameplay and visual readability. Use sketches, diagrams, relative proportions or coordinates as useful; a coordinate list alone need not communicate the intended composition. Keep art direction tied to the actual screens and scenes, including intentional empty space and depth or layering where appropriate. Give each gameplay rule and completion condition one authoritative definition across the documents. For the core player path, show why the planned abilities, space, timing and opposition permit progress; use a calculation, a small prototype or another suitable check when a claim is uncertain, and identify assumptions that remain unverified instead of presenting them as proven. State the evidence conditions and limits of strong design claims, such as a mechanic being necessary or an ordinary player succeeding; a simplified simulation does not establish real-player difficulty. Keep runtime-dependent questions identifiable in the relevant document for later acceptance. Describe observable outcomes for the agreed release scope so implementation and acceptance can use the same baseline. Shared gameplay tunables need one project-owned data source; the Scene/UI/VFX package does not register arbitrary gameplay configuration files. For unusually costly bespoke assets, establish a feasible source or fallback; if feasibility is uncertain, validate one representative sample before committing to full production. Planning, self-checks and delegation are yours. Format references: .beegame/delivery/content-format.json; ${ASSET_MANIFEST_AUTHORING_CONTRACT_PATH}.`
    case 'review': return 'Current delivery milestone: review. Review the authored documents for feasibility, contradictions and missing decisions across all planned screens and levels, including whether the planned UI and scene compositions remain readable without unintended overlap, occlusion or unused space at the target view and relevant aspect ratios. Check the critical path from player action to completion against the planned abilities, geometry, timing and opposition; check that rules repeated across documents have one consistent meaning. Challenge strong design claims against their stated evidence: if a result contradicts a claim, correct the claim or its basis now rather than calling it closed. Distinguish a demonstrated route from an unverified design assumption; keep questions requiring the playable runtime in the documents for acceptance, separate from document findings. Revise the documents to resolve findings within this milestone; for each changed document update its header version, author and date. Report any unresolved document findings or an explicit no-findings result, and separately name runtime-dependent questions that remain; no document findings does not mean those questions are verified. Review methods and delegation are yours.'
    case 'resources': return `Current delivery milestone: resources. Read the reviewed ART_DIRECTION.md, UI_UX_SPEC.md, LEVEL_SCENE_DESIGN.md and ASSET_PLAN.md. Create the artwork those documents call for directly in this stage: use the available AI image capability for suitable UI graphics, cover illustrations and, when needed, 2D characters or effects. There is no separate visual-board or user-approval prerequisite. Select other library, licensed web or procedural assets when they better serve the game; there is no mandatory source order. Choose the assets, methods and image count yourself. Deliver only usable files and assets/asset-manifest.json with source/license facts and atlas/TileSet metadata where appropriate. For reusable UI artwork, an image can contain distinct, non-overlapping elements in one sheet. Choose transparent, opaque or automatic background according to the artwork's actual use; the image model generates the image, not cuts, packaging or frame coordinates. If using a sheet, keep the generated image intact. After generation, inspect the actual image and record each element's name and rectangle in the same-basename JSON sidecar; the editor and game then render subrectangles from that image. The project asset command's atlas operation copies the source PNG unchanged and writes the frame sidecar, without cutting or repacking. Keep large background or cover illustrations as separate images. Use 1024x1024 and low quality by default for Cloudflare generation, changing size only for a concrete asset need. Keep text, state, interactions and responsive layout in UI data rather than baking a whole screen into a texture. The host records actual generation prompts at assets/ai-generation-prompts.md; do not duplicate that record. Registry interface: ${ASSET_MANIFEST_AUTHORING_CONTRACT_PATH}. Run the local format checker with ${ASSET_MANIFEST_VALIDATION_COMMAND}; its generated code is not an authoring reference.`
    case 'content': return `Current delivery milestone: content. Deliver Scene/UI/VFX data and content/index.json covering every planned screen and level: hierarchy, transforms, layout, text/images, placements and interaction bindings. Preserve the reviewed spatial composition in the authored data, including the play-area placement relative to UI; do not silently replace planned visual layers or responsive layouts with an empty background or runtime-only positions. UI layout.position offsets the parent anchor and the child pivot defaults to that anchor; middle-center [0,0] centers a panel, while [-width/2,-height/2] does not. Shared scenes and procedural levels keep their layouts or generation parameters in registered content. The Scene/UI/VFX registry does not accept standalone gameplay tuning documents; keep project-owned configuration outside this package. A Tilemap includes cells and registered TileSet metadata; a Grid or behavior name alone is not a populated map. Choose representations suited to the project's 2D, 3D or XR target. Schemas and ready-to-use document/resource revisions: ${PROJECT_CONTENT_CONTRACT_PATH}. These are platform inputs, not algorithms to reverse-engineer.`
    case 'implementation': return `Current delivery milestone: implementation. Read the reviewed eight documents in docs/ as the intended behavior, presentation and release scope before implementing; content-format files define data syntax, not gameplay design. Deliver a playable project that consumes content/index.json, its registered Scene/UI/VFX documents and assets/asset-manifest.json. Data semantics and runtimeConsumption are in .beegame/delivery/content-format.json. Content remains the editable source for hierarchy, transforms, layout, responsive variants, Tilemap cells and resource bindings; runtime code loads these and implements gameplay. Reading text/style while replacing node geometry with hand-written CSS or engine positions is not data-driven rendering. If responsive requirements and authored layout conflict, resolve the source data rather than silently ignoring it. If a documented rule proves infeasible or must change, update the affected documents and content with the implementation rather than silently substituting a different game. Framework, parser, compilation/caching, tests and delegation are yours. All planned screens and levels must work in the production build. Check the core rules and completion path against the documents; a successful build or one partial playthrough does not establish the full agreed scope. Verify representative layout, scene and resource changes in the target runtime; text-only changes and a green build do not establish these bindings. If a binding is ignored, fix it before claiming implementation complete. Distinguish game defects from unavailable browser environments or faulty test drivers; disclose what remains unverified.`
    case 'acceptance': return `Current delivery milestone: acceptance. Derive the acceptance checks from the confirmed scope and reviewed eight documents, including the actual completion conditions and runtime-dependent questions left open in those documents; do not substitute a generic test route for their requirements. Verify the current playable version in its actual target runtime, address defects and disclose unresolved or unverified areas. Do not treat a document-stage simulation or review conclusion as runtime evidence; record any still-unverified release requirement in the acceptance result. Use deterministic checks where they establish rules more directly than a long autonomous playthrough; retain target-runtime evidence for the player-facing result. For a visual game, inspect the player-facing composition of representative screens and gameplay scenes at the target view and relevant aspect ratios; element presence and successful navigation alone do not establish visual quality. Check that active controls and overlays are fully within the actual viewport or safe area; a screenshot count or DOM isVisible result is not a bounds check. Keep visual captures or equivalent target-device evidence with the delivery result, and state any view that could not be inspected. Distinguish observed product failures from browser/environment failures and inconclusive test-driver behavior in the result and its evidence; do not count a bot's inability to navigate as proof of a game defect or as proof that gameplay works. If target-runtime verification is unavailable, report blocked rather than passed; simulated checks remain useful diagnostics. Publish consumes the evidence-backed result at ${PROJECT_DELIVERY_REPORT_PATH}; verification methods and delegation are yours.`
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
export async function advanceProjectDeliveryAfterTurn(workspacePath: string, dataRoot: string): Promise<{
  phase: ProjectDeliveryPhase
  shouldContinue: boolean
  issues: string[]
} | undefined> {
  return withStateMutation(workspacePath, dataRoot, async () => {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (!state || state.status !== 'active') return undefined
  const phase = projectDeliveryPhase(state)
  if (phase === 'complete') return { phase, shouldContinue: false, issues: [] }
  const issues: string[] = []
  if (phase === 'author') {
    for (const name of PROJECT_DOCUMENTS) {
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
    if (!report) issues.push(`${PROJECT_DELIVERY_REPORT_PATH} is missing`)
    else if (report.status === 'blocked' && !report.invalidRecord) {
      await save(workspacePath, dataRoot, { ...state, phase, lastValidationFailure: JSON.stringify([phase, report.summary]) })
      return { phase, shouldContinue: false, issues: [report.summary] }
    } else if (report.invalidRecord) issues.push(report.summary)
    else if (report.scope !== 'delivery') issues.push(`${PROJECT_DELIVERY_REPORT_PATH} must have scope "delivery"`)
    else if (report.status === 'failed') issues.push(`${PROJECT_DELIVERY_REPORT_PATH} reports failed; address its recorded findings`)
    else {
      const gate = await evaluateProjectDeliveryGate(workspacePath, dataRoot, false)
      if (!gate?.allowed) issues.push(...(gate?.issues ?? ['Current-version acceptance could not be verified']))
    }
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
} | undefined> {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (!state) return undefined
  if (!state.accepted) {
    const report = await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
    return { allowed: false, issues: report?.status === 'blocked'
      ? [report.summary] : ['Current project has no verified delivery acceptance.'] }
  }
  if (requireComplete && projectDeliveryPhase(state) !== 'complete')
    return { allowed: false, issues: ['Project delivery is still in progress.'] }
  const { accepted } = state
  if (accepted.revision !== await computeWorkspaceRevision(workspacePath))
    return { allowed: false, issues: ['Workspace changed after acceptance; revalidation is required.'] }
  if (accepted.source !== 'report') {
    return { allowed: false, issues: ['Current version requires a delivery acceptance report.'] }
  }
  if (accepted.reportPath !== PROJECT_DELIVERY_REPORT_PATH)
    return { allowed: false, issues: ['Delivery evidence changed after acceptance; revalidation is required.'] }
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
    return { allowed: false, issues: ['Delivery acceptance report is missing.'] }
  }
  const currentReport = await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
  if (currentReport?.scope !== 'delivery' || currentReport.status !== 'passed')
    return { allowed: false, issues: currentReport?.status === 'blocked'
      ? [currentReport.summary] : ['Delivery acceptance report is not a current delivery PASS.'] }
  if (reportSha256 !== accepted.reportSha256 ||
      !await runtimeEvidenceIsCurrent(workspacePath, accepted.reports))
    return { allowed: false, issues: ['Delivery evidence changed after acceptance; revalidation is required.'] }
  return { allowed: true, issues: [] }
}

/** Editor authority comes from the authored package, not a delivery phase snapshot. */
export function nativeContentAuthority(workspacePath: string): BeeGameContentAuthority {
  return projectContentAuthority(workspacePath)
}
