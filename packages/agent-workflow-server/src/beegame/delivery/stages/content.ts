import { PROJECT_CONTENT_CONTRACT_PATH } from '../paths'
import type { ProductionCheckInput } from '@bee-game-studio/agent-workflow/production-check-input'
import { auditBeeGameContentPackage } from '../../game-content-package'
import { projectContentAuthority } from '../../project-content-authority'
import { buildSceneUiContentAuthoringAuthority, materializeSceneUiAuthoringContract } from '../../scene-ui-content-authoring'
import { checkReviewDesignLayouts } from '../../design-layout-check'
import { checkProductionDesign } from '../design-protection'
import { checkProductionFindings } from '../production-findings'
import type { MilestoneResult } from '../../milestone-result'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, isAbsolute, sep } from 'node:path'

/** Next-stage reference preparation belongs to Content entry, not the
 * predecessor's commit. Failure here must preserve completed upstream work. */
export function prepareContentContract(workspace: string) {
  return materializeSceneUiAuthoringContract(workspace,
    buildSceneUiContentAuthoringAuthority(projectContentAuthority(workspace)))
}

// Progress identity includes bindings/index bytes, not only protected design.
// It never becomes release evidence and excludes unrelated code/chat history.
function contentProgress(workspace: string, designRevision: string) {
  workspace = realpathSync(workspace)
  const hash = createHash('sha256').update(designRevision)
  const read = (path: string) => {
    hash.update(path).update('\0')
    try { hash.update(readFileSync(join(workspace, path))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; hash.update('missing') }
    hash.update('\0')
  }
  const collect = (path: string) => {
    let entries
    try {
      const part = relative(workspace, realpathSync(join(workspace, path)))
      if (isAbsolute(part) || part === '..' || part.startsWith('..' + sep)) throw new Error('Content check input escapes workspace: ' + path)
      entries = readdirSync(join(workspace, path), { withFileTypes: true })
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; hash.update('missing:' + path); return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) { hash.update('unsupported-symlink:' + path + '/' + entry.name); continue }
      if (entry.isDirectory()) collect(path + '/' + entry.name)
      else if (entry.isFile() && entry.name.endsWith('.json')) read(path + '/' + entry.name)
    }
  }
  collect('content')
  collect('assets')
  return hash.digest('hex')
}

/** Local structure/layout checks; alone these do not authorize release. */
export function checkContentSources(workspace: string, objective: string) {
  const issues: string[] = []
  try {
    const audit = auditBeeGameContentPackage(workspace, projectContentAuthority(workspace))
    issues.push(...audit.issues)
    let settings: { orientation?: unknown; dimension?: unknown } = {}
    try { settings = JSON.parse(objective)?.settings ?? {} } catch { /* Legacy text objective. */ }
    if (audit.valid) issues.push(...checkReviewDesignLayouts(workspace, settings, false).issues)
  } catch (error) {
    issues.push('Content validation failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  return { valid: !issues.length, issues }
}

/** Read-only, shared by preflight, the BGS handoff check and host advancement.
 * Rendering and gameplay remain observable work, not proven by this check. */
export function checkContentHandoff(workspace: string, input: ProductionCheckInput) {
  const issues: string[] = []
  let sourceRevision: string | undefined
  let protectionIssues: string[] = []
  try {
    const protectedDesign = checkProductionDesign(workspace, input.baseline, 'content')
    sourceRevision = contentProgress(workspace, protectedDesign.revision)
    protectionIssues = protectedDesign.issues
    issues.push(...protectionIssues, ...checkContentSources(workspace, input.objective).issues)
  } catch (error) {
    issues.push('Content validation failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  return { scope: 'content-handoff' as const, runtimeVerified: false as const,
    valid: issues.length === 0, issues, sourceRevision, protectionIssues }
}

/** The phase-owned interpretation of an actual receipt, separate from source preflight. */
export function checkContentResult(workspace: string, input: ProductionCheckInput, result?: MilestoneResult) {
  const sources = checkContentHandoff(workspace, input)
  const reported = checkProductionFindings(workspace, 'content', input.baseline.followUps ?? [],
    result?.phase === 'content' ? result.designIssues : [])
  const receiptIssues = result?.phase !== 'content' ? ['The content milestone has no explicit completion result from this turn.']
    : result.validationIssues?.length ? result.validationIssues
    : result.status === 'invalid' ? ['Invalid Content milestone receipt.']
    : result.status === 'blocked' ? [result.summary] : []
  const blockingIssues = [...sources.protectionIssues, ...reported.issues, ...reported.blockingIssues]
  const issues = [...sources.issues, ...reported.issues, ...reported.blockingIssues, ...receiptIssues]
  return { ...sources, valid: !issues.length, issues, blockingIssues,
    followUps: reported.followUps, receiptIssues }
}

/** Entry checks do not demand finished Content: interrupted bindings are legitimate work.
 * Changed design needs the existing explicit owner resolution, not a new retry workflow. */
export function prepareContent(workspace: string, input: ProductionCheckInput) {
  const checked = checkProductionDesign(workspace, input.baseline, 'content')
  if (!checked.issues.length) return { ready: true as const, issues: [] }
  return { ready: false as const, issues: checked.issues,
    recovery: 'Content has not been restarted and saved bindings are preserved. Use the existing project design-resolution action with mode "inspect", source-backed findings (or [] for detected source changes), and explicit owner instructions. This opens affected inspection/revision; it does not approve changed design. After authorized repair/verification, continue Content from its saved files.' }
}

export const contentInstruction = `Current delivery milestone: content. Bind delivered resources and runtime interfaces into the existing reviewed Scene/UI sources, and finish content/index.json.

Inputs and scope:
Read the relevant reviewed design clauses and resource handoff. Read the owner-linked content/scenes and content/ui files and complete them in place: preserve document/node/component identities, text, order, hierarchy, placement, collision geometry, Camera, colors, layout constraints, responsive geometry, supported sizes and control minima. There is no second planning layout to translate. Keep existing valid state/action bindings; fill only missing or incorrect bindings against explicit owner requirements. Bind delivered fonts, images, atlas members/frames and runtime references without inventing resources or selecting another composition. Unknown Scene fields remain protected; a necessary design change uses the existing affected owner revision and version increase. Account for every planned screen and level through the existing source files, not copied or regenerated layouts. Only create genuinely missing, explicitly required non-layout data such as VFX configuration. A missing planned Scene/UI source is an upstream handoff gap, not permission to redesign it.
Use the schemas, coordinate semantics, supported components, resource references and BGS-supplied revision values in ${PROJECT_CONTENT_CONTRACT_PATH} and its referenced format guidance. These are platform inputs, not algorithms to reverse-engineer. Choose representations suited to the confirmed 2D, 3D or XR target; do not introduce components merely to satisfy an unrelated example.

Binding work:
Use bind-content.mjs --inspect FILE ... to obtain exact current file hashes, node/component identities and saved bindings together. Apply explicit changes using bind-content.mjs mapping.json; it validates the whole batch before writing and preserves design fields. Do not clear valid bindings or strip color/tint after adding a texture. Inspect full nodes only for unresolved details using check-content.mjs --inspect-draft.
Identify existing node/action/state references that runtime code must connect for dynamic behavior and feedback. Data declaration is not executable gameplay; do not silently omit a requirement because it needs code, or invent unsupported fields to make it appear implemented. Keep standalone gameplay configuration outside the Scene/UI/VFX registry as the contract requires. Use source prose and retained Art/UI samples to resolve actual ambiguities, not to reconstruct already saved layout values.

Checks and completion:
Use the saved layout values; do not choose a new layout or interaction design. Complete related binding changes before checking. Run check-content.mjs for package format/references, then check-content.mjs --design-layouts --report for all saved UI compositions and linked Scene framing with delivered TileSets. This uses each actual UI game-view, not the full browser window. Do not separately enumerate Scene/window size combinations or repeat individual --layout inspections unless diagnosing a reported issue. Unlinked Scene/3D/XR coverage still needs its applicable check or an explicit unresolved handoff.
Render every defined UI composition and relevant expanded state at supported targets with inspect-design.mjs --ui-all --report. Include legal longest dynamic labels via its existing --samples input. Inspect actual font fit, glyph fallback, image dimensions/pivots/cropping and appearance using delivered resources. Read the returned report and exact capture paths; do not rebuild a browser driver or rerun unchanged checks to discover result fields. After corrections rerun affected checks; never reuse a stale result. A successful schema/geometry/render command is not visual, gameplay or runtime acceptance.
Preserve planned Tilemap/TileSet bindings; report an incompatible resource instead of replacing its representation. Correct ordinary binding errors here. Missing resources, contradictory design, unavailable rendering/font checks or a necessary layout change must be reported as unresolved, not PASS or an invented fallback. A needed layout/design change requires the existing affected owner revision and version increase.
Briefly hand off the delivered content, the runtime behavior still to connect and any unresolved gaps, using existing files and references rather than creating a separate mandatory report. Building the full game is not required in this stage, and runtime verification remains to be completed after implementation. Tools, task order and subagent collaboration are yours to choose.`
