import { INITIAL_FOUNDATION_UPSTREAM_PATHS } from './foundation-document-topology'
import type { FoundationDocumentPath } from './types'

export const GAME_DOCUMENT_RESPONSIBILITIES = [
  'product_vision',
  'audience_and_market',
  'player_experience',
  'gameplay_systems',
  'game_states',
  'progression_and_economy',
  'narrative_and_content',
  'level_and_world',
  'balance_and_math',
  'technical_architecture',
  'data_and_persistence',
  'performance_and_reliability',
  'network_security_and_privacy',
  'art_and_visual_language',
  'animation_and_vfx',
  'ui_and_interaction',
  'accessibility_and_localization',
  'audio_and_music',
  'asset_and_content_production',
  'production_planning',
  'quality_and_acceptance',
  'analytics_and_success_metrics',
  'risks_and_dependencies',
  'release_and_operations',
] as const

export type GameDocumentResponsibility =
  (typeof GAME_DOCUMENT_RESPONSIBILITIES)[number]

export type GameDocumentSectionContract = {
  sectionId: string
  title: string
  purpose: string
  responsibilityIds: readonly GameDocumentResponsibility[]
}

export type GameDocumentProductionMaterialContract = {
  materialId: string
  title: string
  purpose: string
  format: 'markdown_table' | 'mermaid' | 'inline_svg' | 'evidence_register'
  authorityMode: 'owner' | 'reference_only'
  authorityRule: string
}

export type GameDocumentUpstreamProjection = {
  path: FoundationDocumentPath
  sectionIds: readonly string[]
}

export type GameDocumentOutputPolicy = Readonly<{
  sectionStyle: 'final_owned_decisions'
  executiveSummaryStyle: 'authority_index'
  mutableFactPolicy: 'single_owner_no_copied_totals'
  workedExamples: 'one_per_distinct_boundary'
  acceptanceScenarios: 'materially_distinct_only'
}>

export type GameDocumentContract = {
  path: FoundationDocumentPath
  discipline: string
  purpose: string
  allowedUpstreamPaths: readonly FoundationDocumentPath[]
  productionMaterials: readonly GameDocumentProductionMaterialContract[]
  upstreamSections: readonly GameDocumentUpstreamProjection[]
  sections: readonly GameDocumentSectionContract[]
  outputPolicy: GameDocumentOutputPolicy
  documentAuthorityRule: string
  mergeReferenceRule: string
}

export const GAME_DOCUMENT_OUTPUT_POLICY: GameDocumentOutputPolicy =
  Object.freeze({
    sectionStyle: 'final_owned_decisions',
    executiveSummaryStyle: 'authority_index',
    mutableFactPolicy: 'single_owner_no_copied_totals',
    workedExamples: 'one_per_distinct_boundary',
    acceptanceScenarios: 'materially_distinct_only',
  })

const section = (
  sectionId: string,
  title: string,
  purpose: string,
  ...responsibilityIds: GameDocumentResponsibility[]
): GameDocumentSectionContract =>
  Object.freeze({
    sectionId,
    title,
    purpose,
    responsibilityIds: Object.freeze(responsibilityIds),
  })

const material = (
  materialId: string,
  title: string,
  format: GameDocumentProductionMaterialContract['format'],
  purpose: string,
  authorityMode: GameDocumentProductionMaterialContract['authorityMode'],
  authorityRule: string,
): GameDocumentProductionMaterialContract =>
  Object.freeze({ materialId, title, format, purpose, authorityMode, authorityRule })

const upstream = (
  path: FoundationDocumentPath,
  ...sectionIds: string[]
): GameDocumentUpstreamProjection =>
  Object.freeze({ path, sectionIds: Object.freeze(sectionIds) })

const PRODUCTION_MATERIALS = {
  'docs/GDD.md': [
    material('core-loop-diagram', 'Core Loop Diagram', 'mermaid', 'Compact, inspectable loop evidence that references core_loop decisions; do not restate section prose.', 'reference_only', 'Reference the GDD core_loop owner; merge loop decisions into that section and omit duplicated rules or outcomes here.'),
    material('game-state-flow', 'Game State Flow', 'mermaid', 'Compact, inspectable state-transition evidence that references states_flow decisions; do not restate section prose.', 'reference_only', 'Reference the GDD states_flow owner; merge state transitions into that section and omit duplicated transition rules here.'),
  ],
  'docs/LEVEL_SCENE_DESIGN.md': [
    material('world-structure-diagram', 'World Structure Diagram', 'mermaid', 'Canonical topology evidence owning world_structure coordinate, path, grid, trigger and off-screen literals.', 'owner', 'Own canonical Level topology, coordinate, path, grid, trigger and off-screen literals; corresponding prose and other materials reference this diagram.'),
    material('route-choice-diagram', 'Route and Choice Diagram', 'mermaid', 'Canonical route evidence owning objectives_routes path, slot, trigger and choice mappings.', 'owner', 'Own canonical Level route, choice, path, slot, trigger and mutual-exclusion mappings; corresponding prose and other materials reference this diagram.'),
    material('pacing-beat-table', 'Pacing Beat Table', 'markdown_table', 'Canonical computable beat rows owning pacing_beats cadence, intensity, recovery and authored content IDs.', 'owner', 'Own canonical Level pacing beat rows, cadence, intensity and recovery windows; corresponding prose and other materials reference these rows and authored content IDs.'),
    material('scene-transition-diagram', 'Scene Transition Diagram', 'mermaid', 'Compact lifecycle evidence referencing scene_states and spawn_checkpoint decisions.', 'reference_only', 'Reference the Level scene_states and spawn_checkpoint owners; merge lifecycle rules there and omit duplicated transitions here.'),
  ],
  'docs/BALANCE_DESIGN.md': [
    material('variable-parameter-table', 'Variable and Parameter Table', 'markdown_table', 'Canonical owner table for units, variables, values, ranges and source references.', 'owner', 'Own Balance units, variables, parameters, values, ranges and source references; all other Balance materials reference these owner IDs.'),
    material('formula-boundary-table', 'Formula and Boundary Table', 'markdown_table', 'Reference-only boundary view keyed to owner variables and formula IDs; do not copy literal values, results, totals or complete formulas.', 'reference_only', 'Reference Balance variable and formula owners; merge formulas and boundaries into owner sections and omit copied literals, results, totals and complete expressions here.'),
    material('economy-flow-diagram', 'Economy Flow Diagram', 'mermaid', 'Reference-only flow view keyed to owner variables and formulas; do not copy literal values, results, totals or complete formulas.', 'reference_only', 'Reference Balance variable and formula owners; merge economy facts into owner sections and omit copied literals, results, totals and complete expressions here.'),
    material('tuning-validation-matrix', 'Tuning Validation Matrix', 'markdown_table', 'Reference-only scenario view keyed to owner variables and formulas; do not copy literal values, results, totals or complete formulas.', 'reference_only', 'Reference Balance variable, formula and scenario owners; merge validation facts into owner sections and omit copied literals, results, totals and complete expressions here.'),
  ],
  'docs/TECHNICAL_DESIGN.md': [
    material('architecture-diagram', 'Architecture Diagram', 'mermaid', 'Compact runtime boundary evidence referencing architecture decisions.', 'reference_only', 'Reference the Technical architecture owner; merge runtime boundaries into that section and omit duplicated component decisions here.'),
    material('data-flow-diagram', 'Data Flow Diagram', 'mermaid', 'Compact content/data boundary evidence referencing data_content and persistence owners.', 'reference_only', 'Reference Technical data_content and persistence owners; merge schemas and data boundaries there and omit duplicated content facts here.'),
    material('runtime-lifecycle-diagram', 'Runtime Lifecycle Diagram', 'mermaid', 'Inspectable lifecycle evidence referencing runtime_state; do not restate gameplay rules.', 'reference_only', 'Reference the Technical runtime_state owner; merge lifecycle decisions into that section and omit duplicated gameplay rules here.'),
    material('save-recovery-table', 'Save and Recovery Table', 'markdown_table', 'Canonical computable persistence and recovery acceptance rows owning save_load decisions.', 'owner', 'Own canonical Technical persistence, migration, corruption and recovery acceptance rows; corresponding prose and other materials reference this table.'),
  ],
  'docs/ART_DIRECTION.md': [
    material('visual-language-board', 'Visual Language Board', 'inline_svg', 'One compact visual-language board combining hierarchy, palette, silhouette and prohibited-direction evidence as unique visual acceptance evidence; reference visual_pillars and color_lighting, consume Level/UI geometry, and do not restate prose.', 'owner', 'Own the compact visual language and visual acceptance evidence; reference Level/UI geometry and omit Asset Plan resource, sourcing, licensing and schedule facts.'),
    material('animation-vfx-state-table', 'Animation and VFX State Table', 'markdown_table', 'Canonical inspectable state/event rows owning animation and VFX decisions.', 'owner', 'Own canonical Art animation and VFX state/event mappings, timing intent and acceptance evidence; corresponding prose references this table.'),
  ],
  'docs/UI_UX_SPEC.md': [
    material('information-architecture-diagram', 'Information Architecture Diagram', 'mermaid', 'Canonical navigation evidence owning experience_architecture hierarchy and entry-point mappings.', 'owner', 'Own canonical UI navigation, hierarchy and entry-point mappings; corresponding prose and other materials reference this diagram.'),
    material('player-flow-diagram', 'Player Flow Diagram', 'mermaid', 'Canonical journey evidence owning player_journeys and feedback_errors task-flow mappings.', 'owner', 'Own canonical UI onboarding, play, progression, configuration and recovery journey mappings; corresponding prose and other materials reference this diagram.'),
    material('screen-state-table', 'Screen and State Table', 'markdown_table', 'Canonical screen/state evidence owned by screen_inventory.', 'owner', 'Own the canonical UI screen and interface state inventory; all other UI materials reference these screen and state IDs.'),
    material('wireframe-board', 'Wireframe Board', 'inline_svg', 'Canonical layout evidence owning responsive geometry, minimum regions and screen presentation.', 'owner', 'Own canonical UI responsive layout, region and screen geometry literals; corresponding prose and other materials reference this board.'),
    material('focus-accessibility-matrix', 'Focus and Accessibility Matrix', 'markdown_table', 'Canonical focus and accessibility evidence owning input, remapping and inclusive-use mappings.', 'owner', 'Own canonical UI focus, input, remapping and accessibility mappings; corresponding prose and other materials reference this matrix.'),
  ],
  'docs/AUDIO_DESIGN.md': [
    material('event-cue-matrix', 'Event to Cue Matrix', 'markdown_table', 'Canonical mapping owner for stable events, cues, priorities and exceptions.', 'owner', 'Own canonical Audio event-to-cue mappings, priorities and exceptions; all other Audio materials reference these event and cue IDs.'),
    material('music-state-diagram', 'Music State Diagram', 'mermaid', 'Canonical state evidence owning music decisions, transitions and event-cue mappings.', 'owner', 'Own canonical Audio music state and transition mappings, including pause, focus-loss and restoration behavior; corresponding prose references this diagram.'),
    material('bus-ducking-diagram', 'Bus and Ducking Diagram', 'mermaid', 'Canonical mix evidence owning bus, priority and ducking policy mappings.', 'owner', 'Own canonical Audio bus, priority and ducking mappings with critical-cue protection; corresponding prose references this diagram.'),
    material('loudness-delivery-table', 'Loudness and Delivery Table', 'markdown_table', 'Canonical computable loudness and delivery acceptance rows owning implementation constraints.', 'owner', 'Own canonical Audio loudness, dynamic-range and delivery acceptance rows; corresponding prose references this table and Asset Plan owns resource facts.'),
    material('sound-reference-register', 'Sound Reference Register', 'evidence_register', 'Reference-only pointers to Asset Plan inventory IDs for source/licensing evidence; do not own or duplicate asset inventory.', 'reference_only', 'Reference Asset Plan inventory IDs for source and licensing evidence; merge resource facts into Asset Plan and omit duplicated inventory here.'),
  ],
  'docs/ASSET_PLAN.md': [
    material('asset-inventory-table', 'Asset Inventory Table', 'markdown_table', 'Canonical inventory owner for semantic IDs, type, instance and file, quantities, status and unique detail.', 'owner', 'Own resource IDs, type, instance, file, quantities, status, responsibility, sourcing, licensing and milestone facts; all other Asset materials reference inventory IDs.'),
    material('responsibility-matrix', 'Responsibility Matrix', 'markdown_table', 'Canonical computable ownership rows owning creator, approver, consumer, handoff and status mappings keyed by inventory IDs.', 'owner', 'Own canonical Asset responsibility, creator, approver, consumer, handoff and status mappings keyed by inventory IDs; corresponding prose references this matrix.'),
    material('dependency-integration-diagram', 'Dependency and Integration Diagram', 'mermaid', 'Canonical integration evidence owning dependency and integration-order mappings keyed by inventory IDs.', 'owner', 'Own canonical Asset dependency and integration-order mappings keyed by inventory IDs; corresponding prose references this diagram.'),
    material('license-register', 'License Register', 'evidence_register', 'Canonical traceable source/licensing evidence owning records keyed by inventory IDs.', 'owner', 'Own canonical Asset source, originality, attribution, restriction and license evidence keyed by inventory IDs; corresponding prose references this register.'),
    material('milestone-maturity-table', 'Milestone and Maturity Table', 'markdown_table', 'Canonical computable milestone and maturity rows owning schedule and status keyed by inventory IDs.', 'owner', 'Own canonical Asset milestone, capacity, schedule and maturity rows keyed by inventory IDs; corresponding prose references this table.'),
  ],
} satisfies Record<FoundationDocumentPath, readonly GameDocumentProductionMaterialContract[]>

export const FOUNDATION_DOCUMENT_AUTHORITY_RULES = Object.freeze({
  'docs/GDD.md': 'Behavior, state and gameplay rules are authoritative here; numeric values only declare Balance ownership and do not create a duplicate parameter table.',
  'docs/LEVEL_SCENE_DESIGN.md': 'One canonical coordinate/layout source owns coordinate, path, slot and trigger literals; other tables and diagrams reference it without duplicating them.',
  'docs/BALANCE_DESIGN.md': 'Variables and formulas own numeric values; explanations and materials reference them without copying results or totals.',
  'docs/TECHNICAL_DESIGN.md': 'Cover runtime and data boundaries only; do not repeat gameplay, write tutorials or include large pseudocode blocks.',
  'docs/ART_DIRECTION.md': 'Own visual language and visual acceptance conditions; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
  'docs/UI_UX_SPEC.md': 'One canonical responsive geometry/layout source owns layout; wireframes and flows reference it without repeating the screen-state catalog.',
  'docs/AUDIO_DESIGN.md': 'Audio owns event-to-cue behavior and technical acceptance; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
  'docs/ASSET_PLAN.md': 'The inventory uniquely owns semantic IDs, quantity and status; other materials reference IDs without repeating Art/UI/Audio specifications.',
} satisfies Record<FoundationDocumentPath, string>)

const FOUNDATION_DOCUMENT_MERGE_REFERENCE_RULES = Object.freeze({
  'docs/GDD.md': 'Merge loop, state and gameplay outcomes into their single owner sections; omit equivalent repetition from Executive Summary and Production Materials, which remain reference-only authority indexes.',
  'docs/LEVEL_SCENE_DESIGN.md': 'Merge spatial topology, placement and traversal literals into one canonical coordinate/layout source; omit duplicated literals from prose and materials, keep reference-only views stable, and delegate non-spatial facts to their owning discipline.',
  'docs/BALANCE_DESIGN.md': 'Merge mutable values into Units/Variables and formulas into Formula owners; omit copied literals, results, totals and complete formulas from explanatory and production material views, which remain reference-only, and delegate progression/economy decisions to these owners.',
  'docs/TECHNICAL_DESIGN.md': 'Merge runtime and data boundary decisions into their owner sections; omit repeated gameplay or content facts from diagrams and tables, retaining only reference-only evidence and technical persistence acceptance.',
  'docs/ART_DIRECTION.md': 'Merge visual language and visual acceptance conditions into Art owners; omit repeated prose and geometry, keep reference-only support constrained to stable authority references, and delegate resource responsibility, source, license and schedule facts to Asset Plan.',
  'docs/UI_UX_SPEC.md': 'Merge responsive geometry/layout and screen-state ownership into their canonical sections; omit equivalent repetition while keeping material evidence aligned to stable owners and reference-only content limited to authority pointers.',
  'docs/AUDIO_DESIGN.md': 'Merge event-to-cue behavior and technical audio constraints into Audio owners; omit repeated mappings and resource facts, keep reference-only evidence as stable pointers, and delegate resource IDs, source, license and schedule facts to Asset Plan.',
  'docs/ASSET_PLAN.md': 'Merge each resource ID with its quantity, status, responsibility, source/license and milestone facts into the inventory authority; omit duplicate resource facts from prose, while any reference-only pointer remains keyed to the canonical inventory.',
} satisfies Record<FoundationDocumentPath, string>)

const UPSTREAM_SECTIONS = {
  'docs/GDD.md': [],
  'docs/LEVEL_SCENE_DESIGN.md': [
    upstream('docs/GDD.md', 'experience_pillars', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'challenge_recovery', 'accessibility_localization', 'scope_risks'),
  ],
  'docs/BALANCE_DESIGN.md': [
    upstream('docs/GDD.md', 'core_loop', 'rules_systems', 'states_flow', 'progression', 'challenge_recovery', 'metrics', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'level_sequence', 'objectives_routes', 'pacing_beats', 'encounters', 'spawn_checkpoint', 'content_matrix', 'production_acceptance'),
  ],
  'docs/TECHNICAL_DESIGN.md': [
    upstream('docs/GDD.md', 'player_actions', 'rules_systems', 'states_flow', 'accessibility_localization', 'metrics', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'spawn_checkpoint', 'camera_readability', 'scene_states', 'content_matrix', 'production_acceptance'),
    upstream('docs/BALANCE_DESIGN.md', 'units_variables', 'formulas', 'bounds_exploits', 'tuning_validation', 'risks_dependencies'),
  ],
  'docs/ART_DIRECTION.md': [
    upstream('docs/GDD.md', 'experience_pillars', 'rules_systems', 'content_narrative', 'accessibility_localization', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'camera_readability', 'content_matrix', 'production_acceptance'),
  ],
  'docs/UI_UX_SPEC.md': [
    upstream('docs/GDD.md', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'challenge_recovery', 'accessibility_localization', 'content_narrative'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'objectives_routes', 'pacing_beats', 'spawn_checkpoint', 'camera_readability', 'scene_states'),
  ],
  'docs/AUDIO_DESIGN.md': [
    upstream('docs/GDD.md', 'experience_pillars', 'core_loop', 'rules_systems', 'states_flow', 'content_narrative', 'accessibility_localization'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'pacing_beats', 'encounters', 'scene_states'),
    upstream('docs/UI_UX_SPEC.md', 'hud', 'input', 'feedback_errors', 'onboarding', 'accessibility'),
  ],
  'docs/ASSET_PLAN.md': [
    upstream('docs/GDD.md', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'content_matrix', 'production_acceptance'),
    upstream('docs/TECHNICAL_DESIGN.md', 'data_content', 'performance', 'build_release', 'risks'),
    upstream('docs/ART_DIRECTION.md', 'asset_specifications', 'pipeline_risks'),
    upstream('docs/UI_UX_SPEC.md', 'screen_inventory', 'localization', 'prototype_acceptance'),
    upstream('docs/AUDIO_DESIGN.md', 'implementation', 'production'),
  ],
} satisfies Record<FoundationDocumentPath, readonly GameDocumentUpstreamProjection[]>

const contract = (
  path: FoundationDocumentPath,
  discipline: string,
  purpose: string,
  sections: readonly GameDocumentSectionContract[],
): GameDocumentContract =>
  Object.freeze({
    path,
    discipline,
    purpose,
    allowedUpstreamPaths: Object.freeze([
      ...INITIAL_FOUNDATION_UPSTREAM_PATHS[path],
    ]),
    productionMaterials: Object.freeze([...PRODUCTION_MATERIALS[path]]),
    upstreamSections: Object.freeze([...UPSTREAM_SECTIONS[path]]),
    sections: Object.freeze([...sections]),
    outputPolicy: GAME_DOCUMENT_OUTPUT_POLICY,
    documentAuthorityRule: FOUNDATION_DOCUMENT_AUTHORITY_RULES[path],
    mergeReferenceRule: FOUNDATION_DOCUMENT_MERGE_REFERENCE_RULES[path],
  })

export const GAME_DOCUMENT_CONTRACTS = Object.freeze({
  'docs/GDD.md': contract(
    'docs/GDD.md',
    'Game Director and Lead Designer',
    'Own the complete product and gameplay authority consumed by every downstream discipline.',
    [
      section('vision', 'Vision and Product Promise', 'Define the game promise, audience, value, scope and non-goals.', 'product_vision', 'audience_and_market'),
      section('experience_pillars', 'Player Experience and Design Pillars', 'Define intended emotions, experience pillars and the decisions that protect them.', 'player_experience'),
      section('core_loop', 'Core and Session Loops', 'Define moment-to-moment, session and long-term loops with entry, exit and reward conditions.', 'gameplay_systems', 'player_experience'),
      section('player_actions', 'Player Actions and Controls', 'Define the canonical player-facing action/mechanic labels in GDD player_actions, plus targeting, interaction, control intent and action constraints without binding an engine.', 'gameplay_systems', 'ui_and_interaction'),
      section('rules_systems', 'Gameplay Rules and Systems', 'Define authoritative mechanics, entities, resources, rule priorities and system interactions.', 'gameplay_systems'),
      section('states_flow', 'Game States and Flow', 'Define menus, play states, transitions, pause, completion, failure and recovery.', 'game_states'),
      section('progression', 'Progression, Rewards and Economy Boundary', 'Define unlocks, rewards, progression cadence and the economy responsibilities delegated to Balance.', 'progression_and_economy'),
      section('content_narrative', 'Content and Narrative Framework', 'Define theme, setting, content taxonomy, narrative applicability and content boundaries.', 'narrative_and_content'),
      section('challenge_recovery', 'Challenge, Failure and Recovery', 'Define challenge sources, fairness, fail states, recovery rules and counterplay expectations.', 'gameplay_systems', 'quality_and_acceptance'),
      section('accessibility_localization', 'Accessibility and Localization Intent', 'Define inclusive play requirements, configurable interaction and localization boundaries.', 'accessibility_and_localization'),
      section('metrics', 'Success Metrics and Analytics Intent', 'Define observable product, engagement and gameplay outcomes without prescribing a provider.', 'analytics_and_success_metrics'),
      section('scope_risks', 'Scope, Dependencies and Open Decisions', 'Define production scope, external dependencies, risks, assumptions and unresolved authority.', 'production_planning', 'risks_and_dependencies'),
    ],
  ),
  'docs/LEVEL_SCENE_DESIGN.md': contract(
    'docs/LEVEL_SCENE_DESIGN.md',
    'World and Level Design Lead',
    'Own spatial structure, authored content flow and level production requirements.',
    [
      section('world_structure', 'World and Scene Structure', 'Define world hierarchy, scene relationships, topology and traversal boundaries in one explicit coordinate space, including path, grid, trigger and off-screen policies.', 'level_and_world'),
      section('level_sequence', 'Level and Content Sequence', 'Define the ordered content journey, unlock conditions and dependency graph.', 'level_and_world', 'narrative_and_content'),
      section('objectives_routes', 'Objectives, Routes and Player Choices', 'Define objectives, paths, decision points, optional routes and completion logic with explicit path/slot/trigger semantics, mutual exclusion rules and computable layout evidence.', 'level_and_world', 'gameplay_systems'),
      section('pacing_beats', 'Pacing and Gameplay Beats', 'Define beat cadence, intensity changes, rest, escalation and recovery windows.', 'level_and_world', 'player_experience'),
      section('encounters', 'Encounters and Challenge Placement', 'Define encounter roles, composition rules, spatial support and counterplay.', 'level_and_world', 'gameplay_systems'),
      section('spawn_checkpoint', 'Spawn, Checkpoint and Recovery Rules', 'Define placement, reset, checkpoint, persistence and retry behavior.', 'level_and_world', 'game_states'),
      section('camera_readability', 'Camera, Scale and Readability', 'Define camera constraints, spatial scale, sightlines and gameplay readability using the shared coordinate space and explicit off-screen behavior.', 'level_and_world', 'art_and_visual_language', 'ui_and_interaction'),
      section('scene_states', 'Scene States and Transitions', 'Define scene lifecycle, transitions, streaming boundaries and persistent changes.', 'level_and_world', 'game_states'),
      section('content_matrix', 'Content Matrix and Replay Structure', 'Define reusable content units, variation, replay, difficulty and authored coverage.', 'level_and_world', 'asset_and_content_production'),
      section('production_acceptance', 'Level Production and Acceptance', 'Define ownership, dependencies, budgets and completion criteria with computable layout evidence for coordinate, path/slot/trigger/off-screen policies and mutual exclusion.', 'production_planning', 'quality_and_acceptance', 'risks_and_dependencies'),
    ],
  ),
  'docs/BALANCE_DESIGN.md': contract(
    'docs/BALANCE_DESIGN.md',
    'Systems and Economy Designer',
    'Own all numeric variables, formulas, curves, constraints and tuning authority.',
    [
      section('units_variables', 'Units, Variables and Conventions', 'Define all owned units and variables, precision rules and comparison conventions from explicit owner inputs; the variable-parameter-table is the owner material and other Balance materials reference it.', 'balance_and_math'),
      section('entity_parameters', 'Entity and Ability Parameters', 'Define parameter families, base values, relationships and allowed ranges.', 'balance_and_math', 'gameplay_systems'),
      section('formulas', 'Authoritative Formulas', 'Define authoritative formulas, ordering, clamping, rounding and boundaries with recomputable worked results and totals; derived views reference formulas and do not store independent totals.', 'balance_and_math'),
      section('economy', 'Economy Sources, Sinks and Constraints', 'Define resource flows, costs, rewards, affordability and deadlock prevention, making recomputable results and totals derive from owner inputs without independent derived totals.', 'progression_and_economy', 'balance_and_math'),
      section('progression_curves', 'Progression and Capability Curves', 'Define growth, unlock, power and content progression, making recomputable results and totals derive from owner inputs rather than independent derived totals.', 'progression_and_economy', 'balance_and_math'),
      section('challenge_model', 'Challenge and Pressure Model', 'Define difficulty inputs, opposition scaling, pacing pressure and recovery capacity, making recomputable results and totals derive from owner inputs rather than independent derived totals.', 'balance_and_math', 'player_experience'),
      section('rewards_value', 'Rewards and Relative Value', 'Define reward valuation, exchange relationships and choice tradeoffs.', 'progression_and_economy', 'balance_and_math'),
      section('bounds_exploits', 'Bounds, Degenerate Strategies and Exploit Controls', 'Define hard limits, invariants, abuse cases and corrective constraints.', 'balance_and_math', 'quality_and_acceptance'),
      section('tuning_validation', 'Tuning and Validation Method', 'Define scenarios, sensitivity checks, telemetry inputs and acceptance intervals with an auditable validation chain from inputs through results to acceptance.', 'analytics_and_success_metrics', 'quality_and_acceptance'),
      section('risks_dependencies', 'Balance Dependencies and Risks', 'Define upstream dependencies, uncertain values, assumptions and tuning risks.', 'risks_and_dependencies'),
    ],
  ),
  'docs/TECHNICAL_DESIGN.md': contract(
    'docs/TECHNICAL_DESIGN.md',
    'Technical Director and Lead Engineer',
    'Own the engine-neutral system architecture and production runtime boundaries.',
    [
      section('architecture', 'System Architecture and Boundaries', 'Define components, responsibilities, data flow and dependency direction without selecting an engine.', 'technical_architecture'),
      section('runtime_state', 'Runtime State and Lifecycle', 'Define state ownership, transitions, deterministic behavior and failure boundaries.', 'technical_architecture', 'game_states'),
      section('data_content', 'Data and Content Contracts', 'Define schemas, identifiers, validation, versioning and content loading authority.', 'data_and_persistence', 'asset_and_content_production'),
      section('save_load', 'Persistence, Save and Migration', 'Define persistence scope, checkpoints, migration, corruption handling and recovery.', 'data_and_persistence', 'performance_and_reliability'),
      section('input_interaction', 'Input and Interaction Boundary', 'Define input delivery for the same canonical player-action labels owned by GDD player_actions; runtime ACTION codes may appear only in an independent mapping column, never as the fact identity.', 'ui_and_interaction', 'accessibility_and_localization'),
      section('performance', 'Performance and Capacity Budgets', 'Define measurable CPU, memory, storage, loading, rendering and content budgets.', 'performance_and_reliability'),
      section('online_boundary', 'Online, Networking and Service Applicability', 'Define whether network services exist and, when present, authority, consistency, reconnect and latency boundaries.', 'network_security_and_privacy'),
      section('security_privacy', 'Security, Privacy and Data Safety', 'Define trust boundaries, sensitive data, permissions, abuse resistance and privacy obligations.', 'network_security_and_privacy'),
      section('diagnostics', 'Diagnostics, Analytics and Operability', 'Define logging, metrics, crash evidence, gameplay telemetry and operational visibility.', 'analytics_and_success_metrics', 'release_and_operations'),
      section('build_release', 'Build, Configuration and Release', 'Define configuration, environments, packaging, compatibility and release responsibilities without platform lock-in.', 'release_and_operations'),
      section('testing', 'Technical Verification Strategy', 'Define automated, integration, performance, compatibility and recovery verification.', 'quality_and_acceptance'),
      section('risks', 'Technical Risks and Dependencies', 'Define feasibility risks, external dependencies, prototypes and mitigation ownership.', 'risks_and_dependencies', 'production_planning'),
    ],
  ),
  'docs/ART_DIRECTION.md': contract(
    'docs/ART_DIRECTION.md',
    'Art Director',
    'Own the visual language, readability rules and art production acceptance bar.',
    [
      section('visual_pillars', 'Visual Pillars and References', 'Define visual intent, reference principles, originality boundaries and prohibited directions; visual-language-board is the one owner material for compact visual acceptance evidence and equivalent board repetition is omitted.', 'art_and_visual_language'),
      section('composition_readability', 'Composition and Gameplay Readability', 'Define hierarchy, silhouettes, contrast, navigation cues and information separation while consuming Level and UI geometry; do not invent layout dimensions.', 'art_and_visual_language', 'player_experience'),
      section('character_style', 'Characters and Entities', 'Define shape language, proportions, identity, variation and gameplay-state readability.', 'art_and_visual_language'),
      section('environment_style', 'World, Environment and Props', 'Define environment language, modularity, scale, materials and spatial support.', 'art_and_visual_language', 'level_and_world'),
      section('color_lighting', 'Color, Lighting and Material Rules', 'Define palette systems, lighting states, materials, contrast and accessibility constraints.', 'art_and_visual_language', 'accessibility_and_localization'),
      section('animation', 'Animation Language', 'Define motion principles, state coverage, timing intent, transitions and technical constraints.', 'animation_and_vfx'),
      section('vfx', 'Visual Effects and Feedback', 'Define effect hierarchy, event coverage, clarity, intensity and performance boundaries.', 'animation_and_vfx', 'ui_and_interaction'),
      section('camera_presentation', 'Camera and Presentation', 'Define framing, motion and presentation states while consuming Level and UI geometry; do not invent layout dimensions.', 'art_and_visual_language', 'level_and_world'),
      section('asset_specifications', 'Art Asset Specifications', 'Define visual constraints, quality bars, variants, handoff inputs and visual acceptance evidence; Asset Plan owns resource IDs, production responsibility, source, licensing and schedule.', 'quality_and_acceptance'),
      section('pipeline_risks', 'Art Pipeline Risks', 'Define art-specific feasibility risks and visual handoff constraints; reference Asset Plan for resource responsibility, source, licensing and milestones.', 'risks_and_dependencies'),
    ],
  ),
  'docs/UI_UX_SPEC.md': contract(
    'docs/UI_UX_SPEC.md',
    'UX, UI and Accessibility Lead',
    'Own complete player journeys, interface states, interaction and inclusive-use requirements.',
    [
      section('experience_architecture', 'Experience and Information Architecture', 'Define navigation, content hierarchy, entry points and global interaction model across the minimum viewport, safe-area, breakpoints, minimum region sizes and compression order.', 'ui_and_interaction'),
      section('player_journeys', 'Player Journeys and Task Flows', 'Define end-to-end flows for onboarding, play, progression, configuration and recovery.', 'ui_and_interaction', 'player_experience'),
      section('screen_inventory', 'Screen and Interface State Inventory', 'Define every required screen, overlay, modal, transition and empty/loading/error state; screen-state-table is the owner material and other UI materials reference its stable IDs.', 'ui_and_interaction', 'game_states'),
      section('hud', 'HUD and In-Game Information', 'Define visible information, priority, timing, scaling and gameplay linkage against the minimum viewport and minimum region sizes.', 'ui_and_interaction', 'gameplay_systems'),
      section('input', 'Input, Focus and Interaction', 'Define actions, navigation, focus, remapping, pointer/touch/controller applicability and conflicts with hit/focus evidence.', 'ui_and_interaction', 'accessibility_and_localization'),
      section('feedback_errors', 'Feedback, Errors and Recovery', 'Define confirmation, warnings, failure messages, undo, retry and interruption behavior.', 'ui_and_interaction', 'quality_and_acceptance'),
      section('onboarding', 'Onboarding and Learnability', 'Define teaching sequence, progressive disclosure, help and mastery support.', 'player_experience', 'ui_and_interaction'),
      section('accessibility', 'Accessibility Requirements', 'Define perceptual, motor, cognitive and configurable accessibility behavior.', 'accessibility_and_localization'),
      section('localization', 'Localization and Culturalization', 'Define text expansion, fonts, layout direction, pluralization, input and cultural review constraints.', 'accessibility_and_localization'),
      section('prototype_acceptance', 'Prototype, Usability and Acceptance', 'Define prototype scope, usability metrics, ownership and interface acceptance criteria including overflow/scroll behavior and evidence.', 'quality_and_acceptance', 'analytics_and_success_metrics', 'production_planning'),
    ],
  ),
  'docs/AUDIO_DESIGN.md': contract(
    'docs/AUDIO_DESIGN.md',
    'Audio Director and Technical Sound Designer',
    'Own event-to-audio behavior, music, mix and audio production requirements.',
    [
      section('audio_pillars', 'Audio Pillars and Experience', 'Define the sonic identity, emotional goals, clarity priorities and silence strategy.', 'audio_and_music', 'player_experience'),
      section('event_taxonomy', 'Event and Cue Taxonomy', 'Define stable event families, cue responsibilities, priorities and state coverage; event-cue-matrix is the owner material and other Audio materials reference its stable IDs.', 'audio_and_music', 'gameplay_systems'),
      section('sfx', 'Gameplay and Environment Sound', 'Define SFX categories, variation, spatial behavior, repetition control and environment coverage.', 'audio_and_music', 'level_and_world'),
      section('music', 'Music System and States', 'Define music structure, transitions and intensity with explicit state mappings for manual pause, focus loss and restoration.', 'audio_and_music', 'game_states'),
      section('ambience', 'Ambience and World Audio', 'Define ambience layers, zones, transitions, environmental storytelling and spatial rules.', 'audio_and_music', 'level_and_world'),
      section('ui_feedback', 'UI, Feedback and Accessibility Cues', 'Define interface cues, gameplay confirmations, warnings and non-visual alternatives.', 'audio_and_music', 'ui_and_interaction', 'accessibility_and_localization'),
      section('voice', 'Voice and Dialogue Applicability', 'Define voice scope, dialogue pipeline, localization and fallback behavior when applicable.', 'audio_and_music', 'narrative_and_content', 'accessibility_and_localization'),
      section('mix', 'Mix, Buses and Dynamic Rules', 'Define buses, priorities, ducking, loudness, dynamic range and critical cue protection with explicit mute state mappings.', 'audio_and_music', 'performance_and_reliability'),
      section('implementation', 'Audio Data and Technical Budgets', 'Define formats, memory/streaming budgets, naming, event integration and diagnostics.', 'audio_and_music', 'technical_architecture', 'performance_and_reliability'),
      section('production', 'Audio Production and Acceptance', 'Define event-to-cue implementation constraints and audio acceptance evidence; Asset Plan owns resource IDs, source, licensing, responsibility and milestones. Never mark available upstream as unavailable.', 'quality_and_acceptance', 'risks_and_dependencies'),
    ],
  ),
  'docs/ASSET_PLAN.md': contract(
    'docs/ASSET_PLAN.md',
    'Producer, Asset Lead and Content Pipeline Lead',
    'Own the complete production inventory and delivery plan for game content and media.',
    [
      section('inventory', 'Asset and Content Inventory', 'Define the complete bill of materials with stable semantic IDs, categories and intended uses, distinguishing type, instance and file; asset-inventory-table is the owner material for resource facts and adjacent materials reference its IDs.', 'asset_and_content_production'),
      section('ownership', 'Ownership and Responsibility', 'Define creators, approvers, consumers, handoff responsibilities and status authority.', 'production_planning', 'asset_and_content_production'),
      section('dependencies', 'Dependencies and Integration Order', 'Define upstream/downstream relationships, blocking dependencies and integration sequence.', 'risks_and_dependencies', 'production_planning'),
      section('source_license', 'Source, Originality and Licensing', 'Define creation/source strategy, licensing evidence, attribution, restrictions and replacement rights.', 'asset_and_content_production', 'network_security_and_privacy'),
      section('formats_budgets', 'Formats, Variants and Budgets', 'Define engine-neutral format capabilities, variants, dimensions, compression and technical file budgets without conflating type, instance and file.', 'asset_and_content_production', 'performance_and_reliability'),
      section('pipeline', 'Production Pipeline and Naming', 'Define stable naming, versioning, review, conversion, storage and delivery workflow.', 'asset_and_content_production', 'production_planning'),
      section('milestones', 'Milestones, Capacity and Schedule', 'Define production batches, estimates, staffing/capacity assumptions and milestone acceptance.', 'production_planning'),
      section('validation', 'Validation and Quality Status', 'Define validation checks, status lifecycle, evidence, defect handling and readiness criteria with totals recomputed from unique detail.', 'quality_and_acceptance'),
      section('placeholder_replacement', 'Placeholder and Replacement Strategy', 'Define replaceable placeholder responsibilities and the same-path transition to final content.', 'asset_and_content_production', 'technical_architecture'),
      section('delivery_risks', 'Delivery, Release and Risks', 'Define packaging handoff, release readiness, outstanding risks, contingencies and final acceptance.', 'release_and_operations', 'risks_and_dependencies', 'quality_and_acceptance'),
    ],
  ),
} satisfies Record<FoundationDocumentPath, GameDocumentContract>)

export function getGameDocumentContract(
  path: FoundationDocumentPath,
): GameDocumentContract {
  return GAME_DOCUMENT_CONTRACTS[path]
}
