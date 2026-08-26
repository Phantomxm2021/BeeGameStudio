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
}

export type GameDocumentUpstreamProjection = {
  path: FoundationDocumentPath
  sectionIds: readonly string[]
}

export type GameDocumentOutputPolicy = Readonly<{
  sectionStyle: 'final_owned_decisions'
  productionMaterialStyle: 'canonical_compact_views'
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
}

export const GAME_DOCUMENT_OUTPUT_POLICY: GameDocumentOutputPolicy =
  Object.freeze({
    sectionStyle: 'final_owned_decisions',
    productionMaterialStyle: 'canonical_compact_views',
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
): GameDocumentProductionMaterialContract =>
  Object.freeze({ materialId, title, format, purpose })

const upstream = (
  path: FoundationDocumentPath,
  ...sectionIds: string[]
): GameDocumentUpstreamProjection =>
  Object.freeze({ path, sectionIds: Object.freeze(sectionIds) })

const PRODUCTION_MATERIALS = {
  'docs/GDD.md': [
    material('product-gameplay-overview', 'Product and Gameplay Overview', 'markdown_table', 'Summarize the playable promise, audience, scope, loops and completion definition.'),
    material('core-loop-diagram', 'Core Loop Diagram', 'mermaid', 'Show the moment, session and long-term loop relationships.'),
    material('game-state-flow', 'Game State Flow', 'mermaid', 'Show playable, menu, completion, failure and recovery transitions.'),
  ],
  'docs/LEVEL_SCENE_DESIGN.md': [
    material('world-structure-diagram', 'World Structure Diagram', 'mermaid', 'Show the spatial hierarchy and traversal boundaries.'),
    material('route-choice-diagram', 'Route and Choice Diagram', 'mermaid', 'Show objectives, route alternatives and convergence.'),
    material('pacing-beat-table', 'Pacing Beat Table', 'markdown_table', 'Map authored beats to intensity, recovery and required content.'),
    material('scene-transition-diagram', 'Scene Transition Diagram', 'mermaid', 'Show scene lifecycle, spawn, checkpoint and recovery transitions.'),
  ],
  'docs/BALANCE_DESIGN.md': [
    material('variable-parameter-table', 'Variable and Parameter Table', 'markdown_table', 'Provide the canonical units, defaults, ranges and owners.'),
    material('formula-boundary-table', 'Formula and Boundary Table', 'markdown_table', 'Connect formulas to ordering, clamping and worked boundary cases.'),
    material('economy-flow-diagram', 'Economy Flow Diagram', 'mermaid', 'Show sources, sinks, conversions and progression gates.'),
    material('tuning-validation-matrix', 'Tuning Validation Matrix', 'markdown_table', 'Define scenarios, sensitivity inputs and acceptance intervals.'),
  ],
  'docs/TECHNICAL_DESIGN.md': [
    material('architecture-diagram', 'Architecture Diagram', 'mermaid', 'Show components, responsibilities and dependency direction.'),
    material('data-flow-diagram', 'Data Flow Diagram', 'mermaid', 'Show content, runtime, persistence and presentation data flow.'),
    material('runtime-lifecycle-diagram', 'Runtime Lifecycle Diagram', 'mermaid', 'Show state ownership and lifecycle transitions.'),
    material('save-recovery-table', 'Save and Recovery Table', 'markdown_table', 'Define persistence triggers, corruption handling and recovery evidence.'),
  ],
  'docs/ART_DIRECTION.md': [
    material('visual-pillar-board', 'Visual Pillar Board', 'inline_svg', 'Make the visual hierarchy and prohibited directions inspectable.'),
    material('palette-board', 'Palette Board', 'inline_svg', 'Show semantic palette roles, contrast and accessibility variants.'),
    material('silhouette-scale-board', 'Silhouette and Scale Board', 'inline_svg', 'Show entity differentiation, proportions and gameplay scale.'),
    material('animation-vfx-state-table', 'Animation and VFX State Table', 'markdown_table', 'Map authored states and events to motion and effect requirements.'),
  ],
  'docs/UI_UX_SPEC.md': [
    material('information-architecture-diagram', 'Information Architecture Diagram', 'mermaid', 'Show navigation, layers and entry points.'),
    material('player-flow-diagram', 'Player Flow Diagram', 'mermaid', 'Show complete player journeys and recovery paths.'),
    material('screen-state-table', 'Screen and State Table', 'markdown_table', 'Map screens, overlays and empty, loading and error states.'),
    material('wireframe-board', 'Wireframe Board', 'inline_svg', 'Show representative layout, HUD and modal spatial relationships.'),
    material('focus-accessibility-matrix', 'Focus and Accessibility Matrix', 'markdown_table', 'Map input, focus, scaling and non-visual alternatives.'),
  ],
  'docs/AUDIO_DESIGN.md': [
    material('event-cue-matrix', 'Event to Cue Matrix', 'markdown_table', 'Map stable gameplay and interface events to cue behavior.'),
    material('music-state-diagram', 'Music State Diagram', 'mermaid', 'Show music states, transitions and intensity.'),
    material('bus-ducking-diagram', 'Bus and Ducking Diagram', 'mermaid', 'Show mix buses, priorities and ducking relationships.'),
    material('loudness-delivery-table', 'Loudness and Delivery Table', 'markdown_table', 'Define loudness, format, streaming and acceptance requirements.'),
    material('sound-reference-register', 'Sound Reference Register', 'evidence_register', 'Record traceable references, intent and licensing boundaries.'),
  ],
  'docs/ASSET_PLAN.md': [
    material('asset-inventory-table', 'Asset Inventory Table', 'markdown_table', 'Provide the complete semantic bill of materials.'),
    material('responsibility-matrix', 'Responsibility Matrix', 'markdown_table', 'Assign creation, approval, consumption and status authority.'),
    material('dependency-integration-diagram', 'Dependency and Integration Diagram', 'mermaid', 'Show blocking dependencies and integration order.'),
    material('license-register', 'License Register', 'evidence_register', 'Record source, evidence, attribution, restrictions and replacement rights.'),
    material('milestone-maturity-table', 'Milestone and Maturity Table', 'markdown_table', 'Map deliverables to batches, status and acceptance.'),
  ],
} satisfies Record<FoundationDocumentPath, readonly GameDocumentProductionMaterialContract[]>

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
      section('world_structure', 'World and Scene Structure', 'Define world hierarchy, scene relationships, topology and traversal boundaries.', 'level_and_world'),
      section('level_sequence', 'Level and Content Sequence', 'Define the ordered content journey, unlock conditions and dependency graph.', 'level_and_world', 'narrative_and_content'),
      section('objectives_routes', 'Objectives, Routes and Player Choices', 'Define objectives, paths, decision points, optional routes and completion logic.', 'level_and_world', 'gameplay_systems'),
      section('pacing_beats', 'Pacing and Gameplay Beats', 'Define beat cadence, intensity changes, rest, escalation and recovery windows.', 'level_and_world', 'player_experience'),
      section('encounters', 'Encounters and Challenge Placement', 'Define encounter roles, composition rules, spatial support and counterplay.', 'level_and_world', 'gameplay_systems'),
      section('spawn_checkpoint', 'Spawn, Checkpoint and Recovery Rules', 'Define placement, reset, checkpoint, persistence and retry behavior.', 'level_and_world', 'game_states'),
      section('camera_readability', 'Camera, Scale and Readability', 'Define camera constraints, spatial scale, sightlines and gameplay readability.', 'level_and_world', 'art_and_visual_language', 'ui_and_interaction'),
      section('scene_states', 'Scene States and Transitions', 'Define scene lifecycle, transitions, streaming boundaries and persistent changes.', 'level_and_world', 'game_states'),
      section('content_matrix', 'Content Matrix and Replay Structure', 'Define reusable content units, variation, replay, difficulty and authored coverage.', 'level_and_world', 'asset_and_content_production'),
      section('production_acceptance', 'Level Production and Acceptance', 'Define ownership, dependencies, budgets, validation evidence and completion criteria.', 'production_planning', 'quality_and_acceptance', 'risks_and_dependencies'),
    ],
  ),
  'docs/BALANCE_DESIGN.md': contract(
    'docs/BALANCE_DESIGN.md',
    'Systems and Economy Designer',
    'Own all numeric variables, formulas, curves, constraints and tuning authority.',
    [
      section('units_variables', 'Units, Variables and Conventions', 'Define every owned unit, variable, precision rule and comparison convention.', 'balance_and_math'),
      section('entity_parameters', 'Entity and Ability Parameters', 'Define parameter families, base values, relationships and allowed ranges.', 'balance_and_math', 'gameplay_systems'),
      section('formulas', 'Authoritative Formulas', 'Define calculations, ordering, clamping, rounding and worked boundary examples.', 'balance_and_math'),
      section('economy', 'Economy Sources, Sinks and Constraints', 'Define resource flows, costs, rewards, affordability and deadlock prevention.', 'progression_and_economy', 'balance_and_math'),
      section('progression_curves', 'Progression and Capability Curves', 'Define growth, unlock, power and content progression with target ranges.', 'progression_and_economy', 'balance_and_math'),
      section('challenge_model', 'Challenge and Pressure Model', 'Define difficulty inputs, opposition scaling, pacing pressure and recovery capacity.', 'balance_and_math', 'player_experience'),
      section('rewards_value', 'Rewards and Relative Value', 'Define reward valuation, exchange relationships and choice tradeoffs.', 'progression_and_economy', 'balance_and_math'),
      section('bounds_exploits', 'Bounds, Degenerate Strategies and Exploit Controls', 'Define hard limits, invariants, abuse cases and corrective constraints.', 'balance_and_math', 'quality_and_acceptance'),
      section('tuning_validation', 'Tuning and Validation Method', 'Define scenarios, sensitivity checks, telemetry inputs and acceptance intervals.', 'analytics_and_success_metrics', 'quality_and_acceptance'),
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
      section('visual_pillars', 'Visual Pillars and References', 'Define visual intent, reference principles, originality boundaries and prohibited directions.', 'art_and_visual_language'),
      section('composition_readability', 'Composition and Gameplay Readability', 'Define hierarchy, silhouettes, contrast, navigation cues and information separation.', 'art_and_visual_language', 'player_experience'),
      section('character_style', 'Characters and Entities', 'Define shape language, proportions, identity, variation and gameplay-state readability.', 'art_and_visual_language'),
      section('environment_style', 'World, Environment and Props', 'Define environment language, modularity, scale, materials and spatial support.', 'art_and_visual_language', 'level_and_world'),
      section('color_lighting', 'Color, Lighting and Material Rules', 'Define palette systems, lighting states, materials, contrast and accessibility constraints.', 'art_and_visual_language', 'accessibility_and_localization'),
      section('animation', 'Animation Language', 'Define motion principles, state coverage, timing intent, transitions and technical constraints.', 'animation_and_vfx'),
      section('vfx', 'Visual Effects and Feedback', 'Define effect hierarchy, event coverage, clarity, intensity and performance boundaries.', 'animation_and_vfx', 'ui_and_interaction'),
      section('camera_presentation', 'Camera and Presentation', 'Define framing, motion, presentation states and relationship to level and UI authority.', 'art_and_visual_language', 'level_and_world'),
      section('asset_specifications', 'Art Asset Specifications', 'Define asset categories, quality bars, budgets, variants, handoff and acceptance evidence.', 'asset_and_content_production', 'quality_and_acceptance'),
      section('pipeline_risks', 'Art Pipeline, Schedule and Risks', 'Define ownership, dependencies, milestones, outsourcing/licensing boundaries and production risks.', 'production_planning', 'risks_and_dependencies'),
    ],
  ),
  'docs/UI_UX_SPEC.md': contract(
    'docs/UI_UX_SPEC.md',
    'UX, UI and Accessibility Lead',
    'Own complete player journeys, interface states, interaction and inclusive-use requirements.',
    [
      section('experience_architecture', 'Experience and Information Architecture', 'Define navigation, content hierarchy, entry points and global interaction model.', 'ui_and_interaction'),
      section('player_journeys', 'Player Journeys and Task Flows', 'Define end-to-end flows for onboarding, play, progression, configuration and recovery.', 'ui_and_interaction', 'player_experience'),
      section('screen_inventory', 'Screen and Interface State Inventory', 'Define every required screen, overlay, modal, transition and empty/loading/error state.', 'ui_and_interaction', 'game_states'),
      section('hud', 'HUD and In-Game Information', 'Define visible information, priority, timing, scaling and gameplay linkage.', 'ui_and_interaction', 'gameplay_systems'),
      section('input', 'Input, Focus and Interaction', 'Define actions, navigation, focus, remapping, pointer/touch/controller applicability and conflicts.', 'ui_and_interaction', 'accessibility_and_localization'),
      section('feedback_errors', 'Feedback, Errors and Recovery', 'Define confirmation, warnings, failure messages, undo, retry and interruption behavior.', 'ui_and_interaction', 'quality_and_acceptance'),
      section('onboarding', 'Onboarding and Learnability', 'Define teaching sequence, progressive disclosure, help and mastery support.', 'player_experience', 'ui_and_interaction'),
      section('accessibility', 'Accessibility Requirements', 'Define perceptual, motor, cognitive and configurable accessibility behavior.', 'accessibility_and_localization'),
      section('localization', 'Localization and Culturalization', 'Define text expansion, fonts, layout direction, pluralization, input and cultural review constraints.', 'accessibility_and_localization'),
      section('prototype_acceptance', 'Prototype, Usability and Acceptance', 'Define prototype scope, usability evidence, metrics, ownership and interface acceptance criteria.', 'quality_and_acceptance', 'analytics_and_success_metrics', 'production_planning'),
    ],
  ),
  'docs/AUDIO_DESIGN.md': contract(
    'docs/AUDIO_DESIGN.md',
    'Audio Director and Technical Sound Designer',
    'Own event-to-audio behavior, music, mix and audio production requirements.',
    [
      section('audio_pillars', 'Audio Pillars and Experience', 'Define the sonic identity, emotional goals, clarity priorities and silence strategy.', 'audio_and_music', 'player_experience'),
      section('event_taxonomy', 'Event and Cue Taxonomy', 'Define stable event families, cue responsibilities, priorities and state coverage.', 'audio_and_music', 'gameplay_systems'),
      section('sfx', 'Gameplay and Environment Sound', 'Define SFX categories, variation, spatial behavior, repetition control and environment coverage.', 'audio_and_music', 'level_and_world'),
      section('music', 'Music System and States', 'Define music structure, states, transitions, intensity, looping and narrative applicability.', 'audio_and_music', 'game_states'),
      section('ambience', 'Ambience and World Audio', 'Define ambience layers, zones, transitions, environmental storytelling and spatial rules.', 'audio_and_music', 'level_and_world'),
      section('ui_feedback', 'UI, Feedback and Accessibility Cues', 'Define interface cues, gameplay confirmations, warnings and non-visual alternatives.', 'audio_and_music', 'ui_and_interaction', 'accessibility_and_localization'),
      section('voice', 'Voice and Dialogue Applicability', 'Define voice scope, dialogue pipeline, localization and fallback behavior when applicable.', 'audio_and_music', 'narrative_and_content', 'accessibility_and_localization'),
      section('mix', 'Mix, Buses and Dynamic Rules', 'Define buses, priorities, ducking, loudness, dynamic range and critical cue protection.', 'audio_and_music', 'performance_and_reliability'),
      section('implementation', 'Audio Data and Technical Budgets', 'Define formats, memory/streaming budgets, naming, event integration and diagnostics.', 'audio_and_music', 'technical_architecture', 'performance_and_reliability'),
      section('production', 'Audio Production and Acceptance', 'Define asset list, recording/source strategy, licensing, milestones, ownership and acceptance evidence.', 'asset_and_content_production', 'production_planning', 'quality_and_acceptance', 'risks_and_dependencies'),
    ],
  ),
  'docs/ASSET_PLAN.md': contract(
    'docs/ASSET_PLAN.md',
    'Producer, Asset Lead and Content Pipeline Lead',
    'Own the complete production inventory and delivery plan for game content and media.',
    [
      section('inventory', 'Asset and Content Inventory', 'Define the complete bill of materials with stable semantic IDs, categories and intended uses.', 'asset_and_content_production'),
      section('ownership', 'Ownership and Responsibility', 'Define creators, approvers, consumers, handoff responsibilities and status authority.', 'production_planning', 'asset_and_content_production'),
      section('dependencies', 'Dependencies and Integration Order', 'Define upstream/downstream relationships, blocking dependencies and integration sequence.', 'risks_and_dependencies', 'production_planning'),
      section('source_license', 'Source, Originality and Licensing', 'Define creation/source strategy, licensing evidence, attribution, restrictions and replacement rights.', 'asset_and_content_production', 'network_security_and_privacy'),
      section('formats_budgets', 'Formats, Variants and Budgets', 'Define engine-neutral format capabilities, variants, dimensions, compression and technical budgets.', 'asset_and_content_production', 'performance_and_reliability'),
      section('pipeline', 'Production Pipeline and Naming', 'Define stable naming, versioning, review, conversion, storage and delivery workflow.', 'asset_and_content_production', 'production_planning'),
      section('milestones', 'Milestones, Capacity and Schedule', 'Define production batches, estimates, staffing/capacity assumptions and milestone acceptance.', 'production_planning'),
      section('validation', 'Validation and Quality Status', 'Define validation checks, status lifecycle, evidence, defect handling and readiness criteria.', 'quality_and_acceptance'),
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
