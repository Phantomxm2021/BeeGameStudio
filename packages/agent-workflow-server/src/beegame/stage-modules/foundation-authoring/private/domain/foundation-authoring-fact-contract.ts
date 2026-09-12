import type { FoundationDocumentPath } from './types'

/** Author-owned data projection, not a dependency on Reviewer execution. */
const facts: Record<FoundationDocumentPath, readonly (readonly [string, string, string?])[]> = {
  'docs/GDD.md': [['game.players.max', 'vision'], ['game.platform', 'vision'], ['game.mechanics', 'player_actions', 'actionId'],
    ['game.resources', 'rules_systems', 'resourceId'], ['game.states', 'states_flow', 'stateId'],
    ['game.win_conditions', 'states_flow', 'winConditionId'], ['game.loss_conditions', 'states_flow', 'lossConditionId']],
  'docs/LEVEL_SCENE_DESIGN.md': [['level.required_entities', 'encounters', 'entityId'], ['level.required_assets', 'content_matrix', 'requirementId'], ['level.complexity_budget', 'production_acceptance']],
  'docs/BALANCE_DESIGN.md': [['balance.entity_ids', 'entity_parameters', 'entityId'], ['balance.variable_ids', 'material.variable-parameter-table', 'parameterId']],
  'docs/TECHNICAL_DESIGN.md': [['technical.supported_actions', 'input_interaction', 'actionId'], ['technical.target_fps', 'performance'], ['technical.content_kinds', 'data_content', 'contentKindId']],
  'docs/ART_DIRECTION.md': [['art.style_constraints', 'visual_pillars', 'constraintId']],
  'docs/UI_UX_SPEC.md': [['ui.supported_actions', 'input', 'actionId'], ['ui.displayed_resources', 'hud', 'resourceId']],
  'docs/AUDIO_DESIGN.md': [['audio.event_ids', 'material.event-cue-matrix', 'eventId']],
  'docs/ASSET_PLAN.md': [['asset.inventory_ids', 'material.asset-inventory-table', 'assetId'], ['asset.covered_level_requirements', 'material.asset-inventory-table', 'requirementId'],
    ['asset.art_constraint_refs', 'material.dependency-integration-diagram', 'constraintId'], ['asset.formats', 'material.asset-inventory-table']],
}

export function foundationAuthoringFactContract(path: FoundationDocumentPath) {
  return {
    version: 'foundation-author-facts.v1',
    facts: facts[path].map(([key, ownerSectionId, identityColumn]) => ({ key, ownerSectionId, ...(identityColumn ? { identityColumn } : {}) })),
    identityRule: 'When a fact is an identity list, author stable ASCII semantic IDs in its declared identityColumn, and keep a separate displayLabel column. Reuse upstream semantic IDs exactly even when display labels are translated. Runtime ACTION codes, filenames, physical asset IDs and requirement IDs are separate mappings, never inferred aliases. Each row may retain its existing production-detail columns; do not create duplicate prose lists or duplicate tables merely to satisfy extraction.',
    applicabilityRule: 'Catalog membership does not mandate an otherwise unnecessary feature. For an intentionally inapplicable list fact other than game.states, record the decision and concrete rationale once in its owner block: `<exact fact key>: N/A — <reason>`. In a table-only material use a three-column table headed factKey | applicability | reason and a row `<exact fact key> | not_applicable | <reason>`. Missing content, an unavailable upstream source and extraction uncertainty are not N/A. Scalar platform/player-count/performance decisions remain explicit. Do not use an invented entity or audio event as a placeholder for N/A.',
    materialRule: 'Canonical production materials remain the sole owner of their detailed records. Owner prose references those materials instead of repeating their IDs, numeric rows, transitions or mappings. Use the same stable IDs in diagrams and reference columns.',
    ...(path === 'docs/AUDIO_DESIGN.md' ? { audioDeliveryRule: 'Consume the committed Technical data_content audioDeliveryMode and capability evidence. Own cue, mix and state behavior within that mode; do not choose a conflicting delivery mode. Code synthesis requires source/runtime integration, not managed JSON audio resources or physical audio files. Do not turn missing capability evidence into an invented implementation claim.' } : {}),
    ...(path === 'docs/BALANCE_DESIGN.md' ? { numericTablesRule: 'Keep numeric inputs only in the canonical parameter table with explicit ID, unit, value columns (ID | 单位 | 取值 is also supported). In formulas, use formulaId | expression | unit | assumptions columns for scalar computations; reference parameter/variable/formula IDs instead of copying numeric inputs or persisting derived totals. The bounded verifier supports + - * / ^, parentheses, min/max/clamp, abs/sqrt, and dimensionless floor/ceil/round. Preserve complex or conditional rules explicitly rather than fabricating a scalar formula; unsupported notation remains unverified. Counts are dimensionless for arithmetic only, not interchangeable entity kinds.' } : {}),
  }
}
