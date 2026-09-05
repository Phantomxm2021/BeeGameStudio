import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationDocumentPath } from './types'

// Stage 2 input selection only. The shared contract graph is frozen audit
// evidence and must not change when authoring dependencies are improved.
type AuthoringSource = Readonly<{
  path: FoundationDocumentPath
  sectionIds: readonly string[]
}>

const source = (path: FoundationDocumentPath, ...sectionIds: string[]): AuthoringSource =>
  Object.freeze({ path, sectionIds: Object.freeze(sectionIds) })

const INPUTS: Record<FoundationDocumentPath, readonly AuthoringSource[]> = {
  'docs/GDD.md': [],
  'docs/LEVEL_SCENE_DESIGN.md': [
    source('docs/GDD.md', 'experience_pillars', 'core_loop', 'player_actions', 'rules_systems', 'progression', 'challenge_recovery', 'accessibility_localization', 'metrics', 'material.core-loop-diagram', 'material.game-state-flow'),
  ],
  'docs/BALANCE_DESIGN.md': [
    source('docs/GDD.md', 'rules_systems', 'progression', 'challenge_recovery', 'metrics', 'material.core-loop-diagram', 'material.game-state-flow'),
    source('docs/LEVEL_SCENE_DESIGN.md', 'encounters', 'spawn_checkpoint', 'pacing_beats', 'material.world-structure-diagram', 'material.route-choice-diagram', 'material.pacing-beat-table'),
  ],
  'docs/UI_UX_SPEC.md': [
    source('docs/GDD.md', 'player_actions', 'rules_systems', 'accessibility_localization', 'content_narrative', 'material.core-loop-diagram', 'material.game-state-flow'),
    source('docs/LEVEL_SCENE_DESIGN.md', 'camera_readability', 'scene_states', 'material.world-structure-diagram', 'material.route-choice-diagram', 'material.pacing-beat-table'),
  ],
  'docs/ART_DIRECTION.md': [
    source('docs/GDD.md', 'experience_pillars', 'rules_systems', 'content_narrative', 'accessibility_localization'),
    source('docs/LEVEL_SCENE_DESIGN.md', 'camera_readability', 'material.world-structure-diagram'),
    source('docs/UI_UX_SPEC.md', 'hud', 'feedback_errors', 'material.wireframe-board'),
  ],
  'docs/TECHNICAL_DESIGN.md': [
    source('docs/GDD.md', 'rules_systems', 'accessibility_localization', 'metrics', 'material.game-state-flow'),
    source('docs/LEVEL_SCENE_DESIGN.md', 'spawn_checkpoint', 'scene_states', 'material.world-structure-diagram', 'material.route-choice-diagram', 'material.pacing-beat-table'),
    source('docs/BALANCE_DESIGN.md', 'units_variables', 'formulas', 'bounds_exploits', 'material.variable-parameter-table'),
    source('docs/UI_UX_SPEC.md', 'feedback_errors', 'material.screen-state-table', 'material.focus-accessibility-matrix'),
  ],
  'docs/AUDIO_DESIGN.md': [
    source('docs/GDD.md', 'experience_pillars', 'rules_systems', 'accessibility_localization', 'material.game-state-flow'),
    source('docs/LEVEL_SCENE_DESIGN.md', 'scene_states', 'material.pacing-beat-table'),
    source('docs/UI_UX_SPEC.md', 'feedback_errors', 'accessibility', 'material.screen-state-table'),
  ],
  'docs/ASSET_PLAN.md': [
    source('docs/GDD.md', 'scope_risks'),
    source('docs/LEVEL_SCENE_DESIGN.md', 'material.world-structure-diagram', 'material.route-choice-diagram', 'material.pacing-beat-table'),
    source('docs/TECHNICAL_DESIGN.md', 'data_content', 'performance', 'build_release'),
    source('docs/ART_DIRECTION.md', 'asset_specifications', 'material.visual-language-board', 'material.animation-vfx-state-table'),
    source('docs/UI_UX_SPEC.md', 'localization', 'material.screen-state-table', 'material.focus-accessibility-matrix'),
    source('docs/AUDIO_DESIGN.md', 'implementation', 'material.event-cue-matrix', 'material.music-state-diagram', 'material.loudness-delivery-table'),
  ],
}

export function foundationAuthoringSources(path: FoundationDocumentPath): readonly AuthoringSource[] {
  return Object.freeze(INPUTS[path])
}

export function foundationAuthoringMarker(blockId: string): string {
  return blockId.startsWith('material.')
    ? `<!-- beegame-material:${blockId.slice('material.'.length)} -->`
    : `<!-- beegame-section:${blockId} -->`
}

export const FOUNDATION_AUTHORING_INSTRUCTION = [
  'Write one complete raw Markdown document from the confirmed brief and supplied upstream blocks.',
  'Confirmed product constraints remain binding. Own decisions in one section or material; other blocks reference that owner without retelling its table or state transitions.',
  'Choose production scope appropriate to this actual game. Do not invent staffing, approval procedures, optional variants or elaborate subsystems merely to fill a heading.',
  'Keep every required heading. Explain N/A once in its owner block with its consequence; retain only a reference in another required block if necessary.',
  'Collect materially distinct acceptance scenarios in their declared acceptance sections or materials. Other sections state decisions without repeating equivalent test cases.',
  'Distinguish design targets, calculated results and observed test results. Never describe an unexecuted test or unobserved asset/license as verified.',
  'Follow each section and material authority rule for examples; reference owner inputs and formulas rather than duplicating definitions.',
  'Use the supplied evidence while authoring; leave cross-section consistency, format and quality review to Reviewer and Revision. Do not output a self-review report, call tools or launch a separate review.',
  'Use the existing canonical headings and material formats. Return Markdown, without a wrapper fence, JSON output or completion prose.',
].join(' ')

const GUIDANCE: Record<FoundationDocumentPath, string> = {
  'docs/GDD.md': 'Own gameplay behavior, actions, states and outcomes. Keep keyboard accessibility and the action table consistent. Preserve brief constraints. State tolerance and difficulty as targets unless supported by explicit calculation; do not guarantee an untested strategy succeeds. Use the loop/state materials as the sole transition records.',
  'docs/LEVEL_SCENE_DESIGN.md': 'Own coordinates, path topology, build positions and complete wave composition/timing. Provide actual computable schedules rather than adjectives alone. Distinguish number of grid points from path distance and keep wave intentions consistent with the schedule. Reference gameplay success/failure rules without redefining them. Tactical claims dependent on future combat parameters remain validation targets.',
  'docs/BALANCE_DESIGN.md': 'Own combat/economy parameters, units, formulas and tuning evidence, not upstream geometry or wave schedules. Reference supplied Level values instead of inventing new coordinates, counts or timing. Keep fixed brief values fixed. Define affordability, damage and tolerance using the owned inputs and formulas; distinguish illustrative calculations from proposed playtest criteria. Resolve direct-hit and status damage ordering consistently with gameplay death/leak precedence. Do not claim a layout clears a wave without its placement and inputs.',
  'docs/UI_UX_SPEC.md': 'Own input mappings, focus, screen behavior and responsive geometry within GDD behavior. Cover loading failure, unavailable media and unrecoverable session error presentation without inventing gameplay transitions. Define focus-loss/resume behavior explicitly for Technical and Audio to implement. Keep viewport, panel, grid, cell and hit-target dimensions consistent. Treat SVG as a compact labeled representation of those same constraints; do not create a separate set of schematic pixel claims. Preserve keyboard accessibility granted by GDD.',
  'docs/ART_DIRECTION.md': 'Own silhouettes, palette, animation and VFX semantics. Use the supplied UI minimum displayed sizes. Keep contrast, layer ordering, effect extent and containment requirements mutually achievable with the chosen values. Assess readability at actual minimum entity size. Reuse visual forms where semantics permit; avoid unnecessary variants. Resource IDs, sources, licenses and schedules belong to Asset Plan.',
  'docs/TECHNICAL_DESIGN.md': 'Own runtime implementation of the supplied gameplay and UI interfaces. Specify the simulation step and input/event ordering. Implement the UI pause/resume/error contract rather than selecting another behavior. Keep camera/focus interactions distinct from frozen gameplay. Preserve the supplied system delivery boundary. Keep recovery cases in their designated owner table, not a circular reference between prose and material.',
  'docs/AUDIO_DESIGN.md': 'Own event/cue mappings, playback parameters and audio delivery constraints. Define actual concurrency, retrigger and encoding choices here; do not delegate new audio parameters to an already-completed Balance document. State cue priorities, ducking exceptions and pause/restart behavior consistently. Preserve silent play and media failure isolation. Use only music layers, variants and ambient loops justified by this game; optional richness is not automatically required production scope.',
  'docs/ASSET_PLAN.md': 'Map supplied visual, scene, interface and audio requirements to deliverables; this delivery mapping is not a restatement of upstream design. Preserve upstream quantities and cue/layer semantics, and do not automatically reduce cues, layers or file variants. Do not redesign silhouettes or invent missing upstream definitions. Allow many requirements per resource and multiple files per resource; do not require one effect or cue per file. Specify concrete delivery formats consistent with upstream. Distinguish planned source and evidence required from observed source and actual evidence. When the same responsibility, license or milestone applies to multiple resources, one row may list explicit inventory IDs; retain exceptions and do not require a repeated all-resource workflow. Use only necessary handoff/dependency steps; an early milestone must not require files that its own rules prohibit producing until a later milestone.',
}

// Stage 2 gives Asset authors a purpose view that points each repeated fact
// domain at its existing owner material. The shared audit contract remains
// unchanged; only the model-facing section prose is narrowed here.
const ASSET_SECTION_PURPOSES: Readonly<Record<string, string>> = Object.freeze({
  inventory: 'Reference asset-inventory-table for complete resource identity, semantic requirement mappings, type, instance, file, quantity and unique detail. Add only inventory requirements not owned by that material; do not reproduce its table in section prose.',
  ownership: 'Reference responsibility-matrix for creator, approver, consumer and handoff mappings keyed by inventory IDs. Keep in section prose the rule for who is authorized to update status; reference milestone-maturity-table for each resource\'s maturity and status facts. Add only ownership context not owned by those materials; do not reproduce the responsibility matrix in section prose. Shared responsibility may use one row with explicit inventory IDs while exceptions remain explicit.',
  dependencies: 'Reference dependency-integration-diagram for upstream/downstream relationships, blocking dependencies and integration order keyed by inventory IDs. Add only dependency context not owned by that material; do not reproduce its diagram or repeat a full resource workflow in section prose.',
  source_license: 'Keep creation/source strategy and replacement rights as prose-only policy. Reference license-register for per-resource source, originality, attribution, restrictions and license evidence details keyed by inventory IDs. Add only sourcing or licensing context not owned by that material; do not reproduce its register in section prose. Shared licensing may use one row with explicit inventory IDs while exceptions remain explicit.',
  formats_budgets: 'Define engine-neutral format capabilities, variants, dimensions, compression and technical file-budget rules. Reference asset-inventory-table for each resource\'s concrete type, instance, file and unique detail; do not restate per-resource specifications here.',
  milestones: 'Reference milestone-maturity-table for production batches, capacity, schedule, maturity and status keyed by inventory IDs. Retain necessary estimates and capacity assumptions in prose without inventing staffing or headcount. Add only milestone context not owned by that material; do not reproduce its table in section prose. Shared milestones may use one row with explicit inventory IDs while exceptions remain explicit.',
  validation: 'Define validation methods, status lifecycle, evidence, defect handling and readiness criteria against the unique inventory and owner-material records. Do not output a separate derived-totals table; recompute any totals from unique detail and retain the validation method and status.',
})

// This is a model-facing Stage 2 view, never a replacement for the audit
// contract. Preserve heading identities and serialization for downstream readers.
export function foundationAuthoringDocumentContract(path: FoundationDocumentPath) {
  const shared = getGameDocumentContract(path)
  return {
    path,
    discipline: shared.discipline,
    documentAuthorityRule: GUIDANCE[path],
    outputPolicy: shared.outputPolicy,
    mergeReferenceRule: shared.mergeReferenceRule,
    sections: shared.sections.map(section => ({
      sectionId: section.sectionId,
      title: section.title,
      purpose: path === 'docs/ASSET_PLAN.md'
        ? ASSET_SECTION_PURPOSES[section.sectionId] ?? section.purpose
        : section.purpose,
    })),
    productionMaterials: shared.productionMaterials.map(({ checklistMode: _mode, ...material }) => material),
  }
}
