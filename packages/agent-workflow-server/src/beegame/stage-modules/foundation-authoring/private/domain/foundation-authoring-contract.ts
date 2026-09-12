import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationDocumentPath } from './types'

// Stage 2 input selection only. The shared contract graph is frozen audit
// evidence and must not change when authoring dependencies are improved.
export type FoundationAuthoringInputBlock = Readonly<{
  /** The canonical section/material marker that owns the supplied facts. */
  ownerBlock: string
  purpose: string
}>

export type FoundationAuthoringSource = Readonly<{
  path: FoundationDocumentPath
  /** Block metadata is the declaration; sectionIds is a derived projection. */
  blocks: readonly FoundationAuthoringInputBlock[]
  sectionIds: readonly string[]
}>

const block = (
  ownerBlock: string,
  purpose: string,
): FoundationAuthoringInputBlock =>
  Object.freeze({ ownerBlock, purpose })

const source = (
  path: FoundationDocumentPath,
  ...declaredBlocks: FoundationAuthoringInputBlock[]
): FoundationAuthoringSource => {
  const blocks = Object.freeze(declaredBlocks)
  return Object.freeze({
    path,
    blocks,
    // Keep this shape for the existing projector/scheduler. It is derived
    // from the same block declarations above, rather than a second matrix.
    sectionIds: Object.freeze(blocks.map(value => value.ownerBlock)),
  })
}

// The producer instruction and its consumers select these same blocks. A
// material name alone is not evidence that its referenced facts were supplied.
// This is input metadata only: no new output syntax or runtime quality gate.
export const FOUNDATION_AUTHORING_SOURCE_GROUPS = Object.freeze({
  fairness: {
    path: 'docs/GDD.md' as const,
    rule: 'Keep fairness, advance-information requirements and counterplay obligations in challenge_recovery; use state materials only for transitions.',
    blocks: [block('challenge_recovery', 'Fairness, required advance information, challenge and recovery obligations.')],
  },
  waveComposition: {
    path: 'docs/LEVEL_SCENE_DESIGN.md' as const,
    rule: 'Own complete encounter composition (entity types, quantities, group identities and computable spawn timing) in encounters, spawn/recovery semantics in spawn_checkpoint, and beat cadence/intensity references in material.pacing-beat-table. Do not replace composition with beat IDs or repeat totals in prose.',
    blocks: [
      block('encounters', 'Complete encounter composition: entity types, quantities, group identities and spawn timing.'),
      block('spawn_checkpoint', 'Spawn and checkpoint semantics needed to interpret composition.'),
      block('material.pacing-beat-table', 'Beat cadence and authored group references, interpreted with complete composition.'),
    ],
  },
  interaction: {
    path: 'docs/UI_UX_SPEC.md' as const,
    rule: 'Keep action conflicts and focus-loss semantics in input, failures in feedback_errors, accessibility exceptions in accessibility, and concrete state/input mappings in material.screen-state-table and material.focus-accessibility-matrix. These together define the implementation handoff; do not redefine their behavior elsewhere.',
    blocks: [
      block('input', 'Action conflicts, focus loss and restoration semantics.'),
      block('feedback_errors', 'Feedback, rejection and error behavior.'),
      block('accessibility', 'Accessibility and media-failure exceptions.'),
      block('material.screen-state-table', 'Canonical screen states and permitted inputs.'),
      block('material.focus-accessibility-matrix', 'Canonical focus and keyboard mappings.'),
    ],
  },
  audioDelivery: {
    path: 'docs/AUDIO_DESIGN.md' as const,
    rule: 'Keep variation semantics in sfx, integration fields in implementation, and cue identities, music transitions and delivery parameters in their event-cue-matrix, music-state-diagram and loudness-delivery-table owners. Refer to those records rather than repeating values.',
    blocks: [
      block('sfx', 'Source and variation semantics required for file delivery.'),
      block('implementation', 'Audio integration fields and constraints.'),
      block('material.event-cue-matrix', 'Canonical cue and variant requirements.'),
      block('material.music-state-diagram', 'Music states and delivered layer requirements.'),
      block('material.loudness-delivery-table', 'Canonical media/encoding delivery requirements.'),
    ],
  },
})

const INPUTS: Record<FoundationDocumentPath, readonly FoundationAuthoringSource[]> = {
  'docs/GDD.md': [],
  'docs/LEVEL_SCENE_DESIGN.md': [
    source('docs/GDD.md',
      block('experience_pillars', 'Confirmed player-experience constraints for scene tone and scope.'),
      block('core_loop', 'Core loop entry and reward semantics for level flow.'),
      block('player_actions', 'Canonical player-facing actions and mechanics used by encounter coverage.'),
      block('rules_systems', 'Tracked gameplay resources and rules used to size objectives and rewards.'),
      block('progression', 'Progression decisions that shape level unlock and escalation.'),
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.fairness.blocks,
      block('accessibility_localization', 'Confirmed accessibility and localization constraints for scene presentation.'),
      block('metrics', 'Confirmed session-duration target used by pacing and completion expectations.'),
      block('material.core-loop-diagram', 'Canonical loop evidence for entry, exit and reward transitions.'),
      block('material.game-state-flow', 'Canonical state and recovery evidence for level transitions.'),
    ),
  ],
  'docs/BALANCE_DESIGN.md': [
    source('docs/GDD.md',
      block('rules_systems', 'Gameplay rules and tracked resources used by affordability and reward formulas.'),
      block('progression', 'Progression decisions and costs that Balance parameterizes.'),
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.fairness.blocks,
      block('metrics', 'Confirmed session-duration target used by balance pacing scenarios.'),
      block('material.core-loop-diagram', 'Canonical reward and progression transitions used as Balance context.'),
      block('material.game-state-flow', 'Canonical win, loss and recovery transitions used by Balance context.'),
    ),
    source('docs/LEVEL_SCENE_DESIGN.md',
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.waveComposition.blocks,
      block('pacing_beats', 'Authored beat cadence and recovery windows used by balance scenarios.'),
      block('material.world-structure-diagram', 'Canonical path and placement literals referenced by Balance.'),
      block('material.route-choice-diagram', 'Canonical route and choice mappings referenced by Balance.'),
    ),
  ],
  'docs/UI_UX_SPEC.md': [
    source('docs/GDD.md',
      block('player_actions', 'Canonical player-facing actions represented by UI controls.'),
      block('rules_systems', 'Tracked gameplay resources represented in the HUD.'),
      block('accessibility_localization', 'Confirmed keyboard, accessibility and localization constraints for UI.'),
      block('metrics', 'Confirmed session-duration target used to size UI flow and feedback.'),
      block('content_narrative', 'Content labels and narrative context shown in UI states.'),
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.fairness.blocks,
      block('material.core-loop-diagram', 'Canonical loop transitions referenced by player journeys.'),
      block('material.game-state-flow', 'Canonical state and recovery transitions referenced by screen states.'),
    ),
    source('docs/LEVEL_SCENE_DESIGN.md',
      block('camera_readability', 'Camera and off-screen readability constraints for UI overlays.'),
      block('scene_states', 'Scene state identities used by UI screen behavior.'),
      block('material.world-structure-diagram', 'Canonical world/layout literals referenced by UI geometry.'),
      block('material.route-choice-diagram', 'Canonical route and choice mappings shown by UI.'),
      block('material.pacing-beat-table', 'Canonical pacing rows used by UI feedback timing.'),
    ),
  ],
  'docs/ART_DIRECTION.md': [
    source('docs/GDD.md',
      block('experience_pillars', 'Confirmed visual experience pillars and prohibited directions.'),
      block('rules_systems', 'Gameplay rules that determine visual state and feedback semantics.'),
      block('content_narrative', 'Narrative/content identities represented by visual assets.'),
      block('accessibility_localization', 'Contrast, readability and localization constraints for visuals.'),
      block('metrics', 'Confirmed session-duration target used to bound presentation density.'),
    ),
    source('docs/LEVEL_SCENE_DESIGN.md',
      block('camera_readability', 'Camera, scale and off-screen readability constraints.'),
      block('material.world-structure-diagram', 'Canonical topology and coordinate literals consumed by Art.'),
    ),
    source('docs/UI_UX_SPEC.md',
      block('hud', 'HUD display sizes and visual states required for readability.'),
      block('feedback_errors', 'Feedback and error states requiring visual treatment.'),
      block('material.wireframe-board', 'Canonical labeled UI geometry and minimum regions consumed by Art.'),
    ),
  ],
  'docs/TECHNICAL_DESIGN.md': [
    source('docs/GDD.md',
      block('rules_systems', 'Gameplay interfaces and rules implemented by runtime systems.'),
      block('accessibility_localization', 'Accessibility and localization behaviors implemented by runtime/UI.'),
      block('metrics', 'Confirmed session-duration target used to bound runtime/session behavior.'),
      block('material.game-state-flow', 'Canonical state and recovery transitions implemented by runtime.'),
    ),
    source('docs/LEVEL_SCENE_DESIGN.md',
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.waveComposition.blocks,
      block('scene_states', 'Scene state identities and transitions implemented by runtime.'),
      block('material.world-structure-diagram', 'Canonical world topology and coordinates consumed by runtime.'),
      block('material.route-choice-diagram', 'Canonical route and choice mappings consumed by runtime.'),
    ),
    source('docs/BALANCE_DESIGN.md',
      block('units_variables', 'Units and variable semantics required for runtime data.'),
      block('formulas', 'Owned formulas required for deterministic simulation.'),
      block('bounds_exploits', 'Bounds and exploit constraints required for runtime safeguards.'),
      block('material.variable-parameter-table', 'Canonical numeric variable IDs, values and ranges bound by runtime.'),
    ),
    source('docs/UI_UX_SPEC.md',
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.interaction.blocks,
    ),
  ],
  'docs/AUDIO_DESIGN.md': [
    source('docs/GDD.md',
      block('experience_pillars', 'Confirmed emotional and sensory experience pillars for audio.'),
      block('rules_systems', 'Gameplay rules and states that trigger audio feedback.'),
      block('accessibility_localization', 'Accessibility and localization constraints for audio delivery.'),
      block('metrics', 'Confirmed session-duration target used to bound music and feedback density.'),
      block('material.game-state-flow', 'Canonical state and recovery transitions requiring audio cues.'),
    ),
    source('docs/LEVEL_SCENE_DESIGN.md',
      block('scene_states', 'Scene state identities requiring audio state transitions.'),
      block('material.pacing-beat-table', 'Canonical pacing rows used to scope audio timing and layers.'),
    ),
    source('docs/UI_UX_SPEC.md',
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.interaction.blocks,
    ),
    source('docs/TECHNICAL_DESIGN.md',
      block('data_content', 'Committed audioDeliveryMode and explicit runtime audio capability evidence; Audio consumes this selection without imposing obligations from another mode.'),
    ),
  ],
  'docs/ASSET_PLAN.md': [
    source('docs/GDD.md', block('scope_risks', 'Confirmed production scope and risk constraints for asset delivery.')),
    source('docs/LEVEL_SCENE_DESIGN.md',
      block('material.world-structure-diagram', 'Canonical topology and scene literals mapped to deliverables.'),
      block('material.route-choice-diagram', 'Canonical route and choice literals mapped to deliverables.'),
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.waveComposition.blocks,
    ),
    source('docs/TECHNICAL_DESIGN.md',
      block('data_content', 'Stable content kinds and data boundaries required for delivery mapping.'),
      block('performance', 'Target runtime performance constraints used to check delivery budgets.'),
      block('build_release', 'Build and release constraints for delivered resources.'),
    ),
    source('docs/ART_DIRECTION.md',
      block('character_style', 'Character silhouette and variant constraints required by concrete deliverables.'),
      block('environment_style', 'Environment form constraints required by concrete deliverables.'),
      block('color_lighting', 'Palette and lighting constraints required by concrete deliverables.'),
      block('asset_specifications', 'Concrete visual asset specifications and required variants.'),
      block('material.visual-language-board', 'Canonical visual-language acceptance evidence mapped to resources.'),
      block('material.animation-vfx-state-table', 'Canonical animation/VFX state requirements mapped to resources.'),
    ),
    source('docs/UI_UX_SPEC.md',
      block('localization', 'Localized text and media requirements mapped to resources.'),
      block('material.screen-state-table', 'Canonical screens and states mapped to resource deliverables.'),
      block('material.focus-accessibility-matrix', 'Canonical focus/accessibility requirements mapped to resources.'),
    ),
    source('docs/AUDIO_DESIGN.md',
      ...FOUNDATION_AUTHORING_SOURCE_GROUPS.audioDelivery.blocks,
    ),
  ],
}

export function foundationAuthoringSources(path: FoundationDocumentPath): readonly FoundationAuthoringSource[] {
  return Object.freeze(INPUTS[path])
}

export function foundationAuthoringMarker(blockId: string): string {
  return blockId.startsWith('material.')
    ? `<!-- beegame-material:${blockId.slice('material.'.length)} -->`
    : `<!-- beegame-section:${blockId} -->`
}

export const FOUNDATION_AUTHORING_CONTENT_INSTRUCTION = [
  'Confirmed product constraints remain binding. Treat each section as the final decision record: complete every required section and material, using the minimum sufficient content for distinct implementable decisions and traceability, not document length. Keep rationale to the minimum needed for a production decision.',
  'Represent each decision once in its owner section or material; elsewhere reference that owner. Do not narrate tables or diagrams, repeat state transitions, or expand a contract purpose phrase by phrase into H3 headings.',
  'Choose production scope appropriate to this actual game. Do not invent staffing, approval procedures, optional variants or elaborate subsystems merely to fill a heading.',
  'Complete every required block. Explain N/A once in its owner block with its consequence; retain only a reference in another required block if necessary.',
  'Collect materially distinct acceptance scenarios in their declared acceptance sections or materials. Other sections state decisions without repeating equivalent test cases.',
  'Distinguish design targets, calculated results and observed test results. Never describe an unexecuted test or unobserved asset/license as verified.',
  'Omit generic best-practice essays, tutorials, speculative alternatives, boilerplate and repeated derivations. Preserve required parameters, formulas, geometry, interfaces and materially distinct boundary examples under their authority rules; reference existing owner inputs and results instead of deriving them again. Do not impose fixed token, word, time or example caps or targets.',
  'Use the supplied evidence while authoring; leave cross-section consistency, format and quality review to Reviewer and Revision. Do not output a self-review report, call tools or launch a separate review.',
].join(' ')

export const FOUNDATION_AUTHORING_INSTRUCTION = [
  'Write one complete raw Markdown document from the confirmed brief and supplied upstream blocks.',
  FOUNDATION_AUTHORING_CONTENT_INSTRUCTION,
  'Keep every required heading. Use the existing canonical headings and material formats. Return Markdown, without a wrapper fence, JSON output or completion prose.',
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
  inventory: 'Reference asset-inventory-table for complete resource identity, semantic requirement mappings, type, instance, file, quantity and delivery-specific detail. Add only inventory requirements not owned by that material; do not reproduce its table in section prose.',
  ownership: 'Reference responsibility-matrix for creator, approver, consumer and handoff mappings keyed by inventory IDs. Keep in section prose the rule for who is authorized to update status; reference milestone-maturity-table for each resource\'s maturity and status facts. Add only ownership context not owned by those materials; do not reproduce the responsibility matrix in section prose. Shared responsibility may use one row with explicit inventory IDs while exceptions remain explicit.',
  dependencies: 'Reference dependency-integration-diagram for upstream/downstream relationships, blocking dependencies and integration order keyed by inventory IDs. Add only dependency context not owned by that material; do not reproduce its diagram or repeat a full resource workflow in section prose.',
  source_license: 'Keep creation/source strategy and replacement rights as prose-only policy. Reference license-register for per-resource source, originality, attribution, restrictions and license evidence details keyed by inventory IDs. Add only sourcing or licensing context not owned by that material; do not reproduce its register in section prose. Shared licensing may use one row with explicit inventory IDs while exceptions remain explicit.',
  formats_budgets: 'Define only delivery-specific format capabilities and file-budget rules not already owned upstream. Reference upstream encoding, variants, dimensions and compression constraints without re-deriving them. Reference asset-inventory-table for per-resource files and delivery exceptions. Do not design runtime adapters or a second set of budgets. Different upper bounds alone are not a conflict; record only an evidenced incompatibility, without inventing a replacement target.',
  milestones: 'Reference milestone-maturity-table for production batches, capacity, schedule, maturity and status keyed by inventory IDs. Retain necessary estimates and capacity assumptions in prose without inventing staffing or headcount. Add only milestone context not owned by that material; do not reproduce its table in section prose. Shared milestones may use one row with explicit inventory IDs while exceptions remain explicit.',
  validation: 'Define validation methods, status lifecycle, evidence, defect handling and readiness criteria against the unique inventory and owner-material records. Reference upstream acceptance checks instead of reproducing their specifications. Do not output a separate derived-totals table; describe how to check the owned records without performing a second design audit.',
})

// Stage 2 narrows only Level prose that re-derived the canonical layout
// materials. The materials themselves remain the complete literal owners;
// unique production facts stay in their existing owner sections.
const LEVEL_SECTION_PURPOSES: Readonly<Record<string, string>> = Object.freeze({
  world_structure: 'Reference world-structure-diagram for the complete coordinate, path, grid, trigger and off-screen literals. Keep only unique world hierarchy, scene relationships and traversal-boundary semantics here; do not reproduce geometry or derived coverage tables.',
  objectives_routes: 'Explain objectives, player choices and completion semantics. Reference route-choice-diagram for path, slot, trigger and mutual-exclusion mappings and world-structure-diagram for layout literals; do not derive another geometry or coverage table.',
  encounters: 'Own complete encounter composition under the document authority rule; reference spawn_checkpoint for spawn/recovery semantics and pacing-beat-table for cadence without repeating their records.',
  pacing_beats: 'State pacing intent and dependencies on combat parameters. Reference encounters for complete composition and pacing-beat-table for beat records; do not maintain another wave count, schedule or repeated arithmetic summary.',
  camera_readability: 'State camera and readability requirements. Reference world-structure-diagram for geometry; do not invent derived minimum distances or repeat coordinates as proofs of readability.',
  content_matrix: 'Own distinct content identities and reuse relationships. Reference encounters for composition and world-structure-diagram for scene geometry instead of restating their quantities and derived totals.',
  production_acceptance: 'Define production ownership, dependencies, budgets including a concrete finite non-negative complexity budget, and distinct completion checks. Describe how to check the existing world-structure-diagram and route-choice-diagram for layout constraints; reference their evidence without repeating geometry or coverage calculations.',
})

// The following are private author-view purposes. They preserve the shared
// contract's section/material identities while making repeated owner duties
// explicit only where the author would otherwise be asked to emit the same
// table, diagram, geometry or state record again.
const PRIVATE_SECTION_PURPOSES: Readonly<Partial<Record<FoundationDocumentPath, Readonly<Record<string, string>>>>> = Object.freeze({
  'docs/GDD.md': Object.freeze({
    core_loop: 'Explain the loop meaning, pacing intent and player-facing consequences; reference core-loop-diagram for the canonical entry, exit and reward transitions instead of restating them.',
    states_flow: 'Explain state ownership, invariants and recovery consequences; reference game-state-flow for the canonical transition record instead of repeating the diagram in prose.',
    rules_systems: 'Own authoritative mechanics, entities, resources and rule priorities; reference core-loop-diagram and game-state-flow for transitions and avoid duplicating their records.',
    challenge_recovery: 'Own fairness, challenge sources and counterplay expectations; reference game-state-flow for failure and recovery transitions instead of defining a second state machine.',
    metrics: 'Own observable product and gameplay targets plus their measurement meaning; do not restate mechanics, formulas or transition records.',
  }),
  'docs/BALANCE_DESIGN.md': Object.freeze({
    units_variables: 'Define units, precision and comparison conventions; reference variable-parameter-table for numeric IDs, values and ranges instead of copying parameter entries.',
    entity_parameters: 'Define parameter identities, semantic roles and relationships; reference variable-parameter-table for numeric values and ranges instead of maintaining a second parameter list.',
    formulas: 'Own formula IDs, symbolic ordering, clamping, rounding and distinct boundary cases; reference variable-parameter-table inputs without copying numeric rows or derived totals.',
    economy: 'Explain resource flows, affordability and deadlock prevention by referencing parameter and formula IDs; do not reproduce their inputs or totals.',
    progression_curves: 'Explain growth and unlock relationships by referencing parameter and formula IDs; keep only progression semantics not already represented by those owners.',
    challenge_model: 'Explain difficulty, pressure and recovery relationships by referencing parameter and formula IDs; do not restate encounter schedules or numeric owner rows.',
    rewards_value: 'Explain reward valuation and choice tradeoffs by referencing owned parameter and formula IDs; keep only distinct economic semantics.',
    tuning_validation: 'Define validation methods, sensitivity scenarios, telemetry inputs and acceptance intervals with an auditable chain from inputs through calculated or observed results to acceptance; do not claim global playthrough or wave-clear proof and do not copy owner numeric inputs.',
    risks_dependencies: 'Record uncertain inputs, assumptions and tuning risks; reference their owning sections without recreating a second parameter or schedule record.',
  }),
  'docs/TECHNICAL_DESIGN.md': Object.freeze({
    architecture: 'Reference architecture-diagram for component boundaries and dependency direction. Keep only interface fields, ordering and implementation constraints not represented by that diagram.',
    runtime_state: 'Reference runtime-lifecycle-diagram for lifecycle transitions. Keep only deterministic timing, queue and recovery details not represented by that diagram.',
    data_content: 'Reference data-flow-diagram for content and persistence boundaries. Keep only schema fields, versioning and loading contracts not represented by that diagram.',
    save_load: 'Reference save-recovery-table for canonical persistence acceptance rows. Keep only persistence boundaries, migration behavior and error semantics not represented by that table.',
    input_interaction: 'Own delivery of the canonical GDD action labels and runtime mapping constraints; reference focus-accessibility-matrix for focus/remapping rows without duplicating them.',
    performance: 'Own measurable runtime and capacity targets; reference the relevant architecture/data owners and do not restate their component or content maps.',
    diagnostics: 'Own logging, crash evidence and telemetry fields; reference metrics and lifecycle owners instead of repeating gameplay or state records.',
    testing: 'Define technical verification methods and evidence; reference the owned interfaces and acceptance materials instead of reproducing their specifications.',
  }),
  'docs/ART_DIRECTION.md': Object.freeze({
    visual_pillars: 'Define visual intent, originality boundaries and prohibited directions; reference visual-language-board for compact visual acceptance evidence and do not repeat that evidence in prose.',
    composition_readability: 'Define hierarchy, silhouettes and readability semantics while consuming Level/UI geometry; do not create another layout or wireframe record.',
    animation: 'Define motion principles, state coverage and timing intent; reference animation-vfx-state-table for canonical state/event rows instead of repeating them.',
    vfx: 'Define effect semantics, hierarchy and performance boundaries; reference animation-vfx-state-table for canonical VFX state/event rows instead of duplicating mappings.',
    camera_presentation: 'Define framing and presentation semantics while consuming Level/UI geometry; reference their owner materials and do not invent a second geometry set.',
    asset_specifications: 'Define visual quality bars, variants and handoff constraints; reference visual-language-board and animation-vfx-state-table for acceptance evidence, while Asset Plan owns resource identity and delivery.',
    pipeline_risks: 'Record art-specific feasibility and handoff risks; reference Asset Plan for resource responsibility, source, licensing and milestones without reproducing those records.',
  }),
  'docs/UI_UX_SPEC.md': Object.freeze({
    experience_architecture: 'Reference information-architecture-diagram for hierarchy and entry mappings. Keep only global interaction semantics and breakpoint/compression decisions not represented there; responsive geometry belongs to wireframe-board.',
    player_journeys: 'Reference player-flow-diagram for canonical task flows. Keep only user goals, branch meaning and recovery intent not represented in that diagram.',
    screen_inventory: 'Reference screen-state-table for the canonical screen and interface-state catalog. Keep only state-specific exceptions and presentation consequences, not another inventory.',
    hud: 'Own information priority, timing and gameplay linkage; reference wireframe-board for all responsive geometry and screen-state-table for state identity.',
    input: 'Own action conflicts, navigation semantics and remapping policy; reference focus-accessibility-matrix for canonical focus and input mappings instead of duplicating its rows.',
    feedback_errors: 'Own confirmation, warning, failure and interruption semantics; reference player-flow-diagram and screen-state-table for canonical flow/state identities.',
    accessibility: 'Own perceptual, motor and cognitive behavior; reference focus-accessibility-matrix for concrete mappings without recreating its evidence.',
    localization: 'Own expansion, font, direction and culturalization constraints; reference screen-state-table for affected interfaces instead of copying screen inventory.',
    prototype_acceptance: 'Define usability methods and interface acceptance evidence; reference wireframe-board and focus-accessibility-matrix for owned geometry and focus facts.',
  }),
  'docs/AUDIO_DESIGN.md': Object.freeze({
    event_taxonomy: 'Define event-family meaning and cue responsibilities; reference event-cue-matrix for stable IDs, priorities and exceptions instead of repeating its rows.',
    sfx: 'Define SFX variation, spatial behavior, repetition control and environment coverage; reference event-cue-matrix for event identity and cue ownership.',
    music: 'Define musical structure and intensity semantics; reference music-state-diagram for canonical state transitions, including pause, focus loss and restoration.',
    ambience: 'Define ambience layers, zones and environmental storytelling; reference music-state-diagram only for shared state transitions and keep ambience-specific behavior here.',
    ui_feedback: 'Define UI cue semantics and non-visual alternatives; reference event-cue-matrix and focus-accessibility-matrix for stable event/focus mappings.',
    mix: 'Define bus, ducking, loudness and critical-cue protection semantics; reference bus-ducking-diagram for canonical bus/priority mappings.',
    implementation: 'Define audio integration fields, naming, diagnostics and delivery constraints not owned by event-cue-matrix or loudness-delivery-table; reference those materials for their canonical rows.',
    production: 'Define implementation acceptance and handoff evidence; reference event-cue-matrix, music-state-diagram and loudness-delivery-table instead of reproducing their mappings or delivery rows.',
  }),
})

/** Historical receipts are read, never upgraded into new dispatch authority. */
export function foundationAuthoringRecordedSourcesMatch(
  path: FoundationDocumentPath,
  actual: readonly FoundationDocumentPath[] | undefined,
  authorBodyVersion?: unknown,
): boolean {
  if (authorBodyVersion !== undefined && authorBodyVersion !== 'foundation-author-body.v2') return false
  const current = foundationAuthoringSources(path).map(source => source.path)
  const exact = (expected: readonly FoundationDocumentPath[]) => !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index])
  return exact(current) || (authorBodyVersion === undefined && path === 'docs/AUDIO_DESIGN.md' &&
    exact(current.filter(source => source !== 'docs/TECHNICAL_DESIGN.md')))
}

// This is a model-facing Stage 2 view, never a replacement for the audit
// contract. Preserve heading identities and serialization for downstream readers.
export function foundationAuthoringDocumentContract(path: FoundationDocumentPath) {
  const shared = getGameDocumentContract(path)
  return {
    path,
    discipline: shared.discipline,
    documentAuthorityRule: [GUIDANCE[path], ...Object.values(FOUNDATION_AUTHORING_SOURCE_GROUPS).filter(group => group.path === path).map(group => group.rule)].join(' '),
    outputPolicy: shared.outputPolicy,
    mergeReferenceRule: shared.mergeReferenceRule,
    sections: shared.sections.map(section => ({
      sectionId: section.sectionId,
      title: section.title,
      purpose: path === 'docs/ASSET_PLAN.md'
        ? ASSET_SECTION_PURPOSES[section.sectionId] ?? section.purpose
        : path === 'docs/LEVEL_SCENE_DESIGN.md'
          ? LEVEL_SECTION_PURPOSES[section.sectionId] ?? section.purpose
          : PRIVATE_SECTION_PURPOSES[path]?.[section.sectionId] ?? section.purpose,
    })),
    productionMaterials: shared.productionMaterials.map(({ checklistMode: _mode, ...material }) =>
      path === 'docs/ASSET_PLAN.md' && material.materialId === 'asset-inventory-table'
        ? {
            ...material,
            purpose: 'Own resource IDs, upstream requirement references, type, instance, files, quantities and delivery-specific exceptions. Unique detail means information needed to produce or hand off the deliverable, not copied gameplay, visual or audio design. Reference upstream owner IDs or sections for existing semantics, priorities, timings and design rationale; retain concrete delivery specifications and every required variant.',
          }
        : material),
  }
}
