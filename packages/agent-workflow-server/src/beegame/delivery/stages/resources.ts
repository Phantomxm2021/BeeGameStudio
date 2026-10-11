import { ASSET_MANIFEST_AUTHORING_CONTRACT_PATH } from '../../asset-manifest-authoring-contract'
import type { ProductionCheckInput } from '@bee-game-studio/agent-workflow/production-check-input'
import type { MilestoneResult } from '../../milestone-result'
import { validateResourceDelivery } from '../../resource-validation-cli'
import { checkProductionDesign } from '../design-protection'
import { checkProductionFindings } from '../production-findings'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, isAbsolute, sep } from 'node:path'

// Track actual saved resource work, not receipt wording or unrelated code.
// Do not follow links: an outside asset is a diagnostic, never progress evidence.
function resourceProgress(workspace: string, revision: string) {
  workspace = realpathSync(workspace)
  const hash = createHash('sha256').update(revision)
  const collect = (path: string) => {
    let entries
    try {
      const part = relative(workspace, realpathSync(join(workspace, path)))
      if (isAbsolute(part) || part === '..' || part.startsWith('..' + sep)) throw new Error('Resource input escapes workspace: ' + path)
      entries = readdirSync(join(workspace, path), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      hash.update('missing:' + path); return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path + '/' + entry.name
      if (entry.isSymbolicLink()) { hash.update('unsupported-symlink:' + file); continue }
      if (entry.isDirectory()) collect(file)
      // Generated manifest helpers are tooling, not resource production.
      else if (entry.isFile() && (!file.startsWith('assets/manifest/') || file.endsWith('.json')))
        hash.update(file).update('\0').update(readFileSync(join(workspace, file))).update('\0')
    }
  }
  collect('assets')
  return hash.digest('hex')
}

export function prepareResources(workspace: string, input: ProductionCheckInput) {
  const checked = checkProductionDesign(workspace, input.baseline, 'resources')
  return { ready: !checked.issues.length, issues: checked.issues,
    recovery: 'Saved resources are preserved. For a necessary design change use the existing project design-resolution action with explicit owner instructions; do not regenerate valid resources or adopt changed design automatically.' }
}

/** Resource production only: does not claim binding, font fit or gameplay passed. */
export function checkResourceHandoff(workspace: string, input: ProductionCheckInput) {
  const issues: string[] = []
  let protectionIssues: string[] = [], sourceRevision: string | undefined
  try {
    const design = checkProductionDesign(workspace, input.baseline, 'resources')
    protectionIssues = design.issues
    issues.push(...protectionIssues, ...validateResourceDelivery(workspace, input.objective).issues)
    sourceRevision = resourceProgress(workspace, design.revision)
  } catch (error) {
    issues.push('Resource validation failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  return { scope: 'resources-handoff' as const, runtimeVerified: false as const, bindingVerified: false as const,
    valid: !issues.length, issues, protectionIssues, sourceRevision }
}

export function checkResourceResult(workspace: string, input: ProductionCheckInput, result?: MilestoneResult) {
  const sources = checkResourceHandoff(workspace, input)
  const reported = checkProductionFindings(workspace, 'resources', input.baseline.followUps ?? [],
    result?.phase === 'resources' ? result.designIssues : [])
  const receiptIssues = result?.phase !== 'resources' ? ['The resources milestone has no explicit completion result from this turn.']
    : result.validationIssues?.length ? result.validationIssues
    : result.status === 'invalid' ? ['Invalid resources milestone receipt.']
    : result.status === 'blocked' ? [result.summary] : []
  return { ...sources,
    valid: sources.valid && !reported.issues.length && !reported.blockingIssues.length && !receiptIssues.length,
    issues: [...sources.issues, ...reported.issues, ...reported.blockingIssues, ...receiptIssues],
    blockingIssues: [...sources.protectionIssues, ...reported.issues, ...reported.blockingIssues],
    followUps: reported.followUps, receiptIssues }
}

export const resourceWorkBoundaries = 'The ordinary resources owner chooses tools and delegation. Scoped visual/font and audio task inputs are available for independent work; BGS has not automatically launched group jobs. Use planned disjoint output paths and applicable professional Skills, and return saved files, registration requests and actual limits. Only the main resources owner registers shared asset-manifest.json and submits the final receipt; do not run concurrent registry writers. Use resources.mjs atlas for deterministic frame metadata plus registration requests, then resources.mjs --register-from to combine saved requests without copying hashes/paths. inspect-design.mjs --resources --report performs decoding and font cmap coverage; candidate comparisons before binding are not a final-font or UI-fit PASS. Continue the same saved task after interruption and preserve valid files. Legacy private task identities require reconciliation before switching workflows; never silently repartition or regenerate them.'

export const resourcesInstruction = `Current delivery milestone: resources.
Using the reviewed ASSET_PLAN.md together with the art, audio, UI, scene and technical documents, complete the required resources for this delivery. Optional resources do not block completion.
Inspect existing resources, reuse those that meet the requirements and fill the gaps. Each required resource must correspond to a usable file or reproducible procedural output, with its intended use and usage explained.
For a planned generated file or reusable procedural resource, deliver the usable output or executable generator with its inputs and usage; a promise to create it later is not resource completion. Simple shapes or effects intentionally expressed by content parameters and runtime behavior need not become separate asset files or generator frameworks. Identify those design references and remaining content/runtime integration briefly in the handoff; do not claim that integration is already tested.
Choose built-in library assets, web assets, AI generation or procedural creation according to actual needs. First meet the design requirements, visual consistency and target-platform constraints, then compare time and cost. Approved fallbacks in the documents are valid; do not lower requirements on your own.
Use the reviewed Art/UI clauses and any supplied visual references when choosing and producing visual resources. Preserve their intended treatment and independent layers; a design-reference image is not automatically a usable runtime asset, and copying a whole UI picture does not supply editable controls or text. Do not create standalone HTML/SVG mockups.
Read the planned Scene/UI sources and their resource requirements: font family/weights/glyph range, logical image dimensions/proportions, pivots, cropping, transparency, named frames and loop behavior must suit their consumers. Reuse critical samples retained during planning when suitable, with provenance; they do not imply the rest of the resource set is complete. If delivered resources cannot meet the reviewed layout/visual/audio requirements, use an authorized fallback or report the affected owner decision rather than silently changing it.
Preserve the planned delivery structure and required variants as well as appearance: changing the production source does not silently cancel an atlas, animation or TileSet. Prefer compatible small 2D sprites with shared loading lifetime in atlases; keep large backgrounds, fonts, audio and models separate as appropriate. For AI-sourced small sprites or UI elements of one style that fit at usable detail, prefer one generation request for a shared sheet, not one request per element followed by optional packing. Request distinguishable, separated elements with useful spacing; choose transparency for their use. Split generation only for a concrete composition, detail or independent-use need and briefly explain it; a planned atlas is not optional merely because its source images were generated separately. The image model produces pixels, not authoritative frame coordinates: inspect the actual sheet and register named, in-bounds regions with logical display sizes, pivots and applicable padding/nine-slice metadata. Elements that vary independently must remain independently addressable. Functional text, interactions and layout belong in subsequent content data.
AI image generation defaults to 1024x1024 and low quality. Choose transparency, image count and organization for the intended use; change size only for a concrete need. Consult the available capability instructions for tool usage and registration formats. Resource registration interface: ${ASSET_MANIFEST_AUTHORING_CONTRACT_PATH}.
Atlas priority applies regardless of source: AI, retrieved images and procedurally drawn static sprites. For procedural sprites, prefer drawing directly into a shared sheet and emitting exact frame metadata from those drawing coordinates; existing separate sprites may be packed without regenerating their art. Group by concurrent use and compatible filtering, not source, and avoid loading unrelated content in a giant atlas. Keep dynamic text, live bars and simple parameter-driven geometry as runtime drawing where designed. Preserve source files when useful, but register runtime atlas/member bindings rather than loading both packed and source images for the same use.
Check resource quality and import requirements, including the visual, audio and technical properties relevant to its type. Building a complete game is not a prerequisite for resource checks. Successful generation, file existence or valid format alone does not establish design compliance.
Use game-technical-artist for applicable animation/effect/material production decisions; preserve the authored visual intent and distinguish usable resource output from later content bindings and runtime motion. Do not require advanced techniques or new asset files for effects already designed as simple runtime behavior.
Deliver the selected files and assets/asset-manifest.json, recording origins and necessary usage metadata. Check licenses for third-party assets; downloaded fonts remain third-party resources, not procedural creations. Accurately record generation origins for AI and procedural assets. Verify image/font decoding in the target browser where applicable, not just extensions or file existence. Scene and UI layouts already exist; Content binds these delivered resources into those same files.
When a required resource cannot be delivered, report the missing item, reason and feasible options. Do not edit the reviewed design documents or mark missing resources complete.
Briefly report delivery results and unresolved issues. Check and invoke applicable Skills; use subagents in parallel for independent tasks with clear dependencies, choosing the task split yourself.`
