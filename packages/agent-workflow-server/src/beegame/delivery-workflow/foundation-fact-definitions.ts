import type { FoundationDocumentPath } from './types'

export const FOUNDATION_FACT_CATALOG_VERSION = 'foundation-facts.v2' as const

export type FoundationFactKey =
  | 'game.players.max'
  | 'game.boss.count'
  | 'game.mechanics'
  | 'game.resources'
  | 'game.states'
  | 'game.win_conditions'
  | 'game.loss_conditions'
  | 'game.platform'
  | 'level.required_entities'
  | 'level.required_assets'
  | 'level.complexity_budget'
  | 'balance.entity_ids'
  | 'balance.variable_ids'
  | 'technical.supported_actions'
  | 'technical.target_fps'
  | 'technical.content_kinds'
  | 'art.style_constraints'
  | 'ui.supported_actions'
  | 'ui.displayed_resources'
  | 'audio.event_ids'
  | 'asset.inventory_ids'
  | 'asset.covered_level_requirements'
  | 'asset.boss.count'
  | 'asset.art_constraint_refs'
  | 'asset.formats'

export type FoundationFactValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'

export type FoundationFactDefinition = {
  key: FoundationFactKey
  owner: {
    documentPath: FoundationDocumentPath
    sectionId: string
  }
  valueType: FoundationFactValueType
  /** Inclusive constraints for scalar values and list cardinality. */
  valueSpec: {
    enum?: readonly string[]
    min?: number
    max?: number
    minItems?: number
    maxItems?: number
    itemPattern?: string
  }
  presence: 'required' | 'optional'
  absentPolicy: 'schema_issue' | 'receipt_only' | 'semantic_clarification'
  uncertainPolicy: 'schema_issue' | 'receipt_only' | 'semantic_clarification'
  resolution: 'mechanical' | 'model_if_unresolved'
  extractionInstruction: string
  sourceOfTruthDirection: string
  consumers: readonly string[]
  /** True only when the key is retained for production acceptance evidence. */
  acceptanceOnlyRole?: string
}

const owner = (
  documentPath: FoundationDocumentPath,
  sectionId: string,
): FoundationFactDefinition['owner'] => ({ documentPath, sectionId })

const list = (
  key: FoundationFactKey,
  sectionOwner: FoundationFactDefinition['owner'],
  extractionInstruction: string,
  consumers: readonly string[],
  options: Partial<
    Pick<
      FoundationFactDefinition,
      | 'presence'
      | 'absentPolicy'
      | 'uncertainPolicy'
      | 'resolution'
      | 'sourceOfTruthDirection'
    >
  > = {},
): FoundationFactDefinition => ({
  key,
  owner: sectionOwner,
  valueType: 'string[]',
  valueSpec: { minItems: 1, maxItems: 256, itemPattern: '^\\S(?:.*\\S)?$' },
  presence: 'required',
  absentPolicy: 'schema_issue',
  uncertainPolicy: 'schema_issue',
  resolution: 'model_if_unresolved',
  extractionInstruction,
  sourceOfTruthDirection:
    options.sourceOfTruthDirection ?? 'owner section is authoritative',
  consumers,
  ...options,
})

const integer = (
  key: FoundationFactKey,
  sectionOwner: FoundationFactDefinition['owner'],
  extractionInstruction: string,
  min: number,
  max: number,
  consumers: readonly string[],
  options: Partial<
    Pick<
      FoundationFactDefinition,
      | 'presence'
      | 'absentPolicy'
      | 'uncertainPolicy'
      | 'resolution'
      | 'sourceOfTruthDirection'
    >
  > = {},
): FoundationFactDefinition => ({
  key,
  owner: sectionOwner,
  valueType: 'number',
  valueSpec: { min, max },
  presence: 'required',
  absentPolicy: 'schema_issue',
  uncertainPolicy: 'schema_issue',
  resolution: 'model_if_unresolved',
  extractionInstruction,
  sourceOfTruthDirection:
    options.sourceOfTruthDirection ?? 'owner section is authoritative',
  consumers,
  ...options,
})

const GDDVision = owner('docs/GDD.md', 'vision')
const GDDRules = owner('docs/GDD.md', 'rules_systems')
const GDDActions = owner('docs/GDD.md', 'player_actions')
const GDDStates = owner('docs/GDD.md', 'states_flow')

export const FOUNDATION_FACT_CATALOG: readonly FoundationFactDefinition[] =
  Object.freeze([
    integer(
      'game.players.max',
      GDDVision,
      'Read the authored maximum player count as one finite integer.',
      1,
      64,
      ['player-capacity-check'],
    ),
    integer(
      'game.boss.count',
      GDDRules,
      'Read the authored boss entity count as one finite integer.',
      0,
      64,
      ['boss-count-consistency'],
    ),
    list(
      'game.mechanics',
      GDDActions,
      'Read the GDD player_actions canonical player-facing action/mechanic labels as a list; these labels are the shared fact identity for downstream documents.',
      ['technical-action-coverage', 'level-encounter-coverage'],
      {
        resolution: 'model_if_unresolved',
        sourceOfTruthDirection:
          'GDD player_actions owns the canonical player-facing action/mechanic labels consumed by downstream documents.',
      },
    ),
    list(
      'game.resources',
      GDDRules,
      'Read the same canonical short labels used for tracked gameplay resources: include the HUD-tracked currency and health pool. Strip parenthetical English aliases and explanatory text; return only the short labels shared with UI displayed resources.',
      ['ui-resource-coverage', 'balance-resource-coverage'],
    ),
    list(
      'game.states',
      GDDStates,
      'Read the canonical gameplay state identifiers as a list.',
      ['state-flow-coverage'],
    ),
    list(
      'game.win_conditions',
      GDDStates,
      'Read the canonical win condition identifiers or short labels as a list.',
      ['win-condition-coverage'],
      { resolution: 'model_if_unresolved' },
    ),
    list(
      'game.loss_conditions',
      GDDStates,
      'Read the canonical loss condition identifiers or short labels as a list.',
      ['loss-condition-coverage'],
      { resolution: 'model_if_unresolved' },
    ),
    {
      key: 'game.platform',
      owner: GDDVision,
      valueType: 'string',
      valueSpec: {
        enum: ['quest', 'desktop', 'web', 'mobile', 'console', 'vr', 'ar'],
      },
      presence: 'required',
      absentPolicy: 'schema_issue',
      uncertainPolicy: 'semantic_clarification',
      resolution: 'model_if_unresolved',
      extractionInstruction: 'Read the one canonical target platform enum.',
      sourceOfTruthDirection:
        'GDD vision owns product platform; technical design confirms feasibility.',
      consumers: ['technical-platform-capability', 'asset-platform-format'],
    },
    list(
      'level.required_entities',
      owner('docs/LEVEL_SCENE_DESIGN.md', 'encounters'),
      'Read stable entity identifiers required by encounters.',
      ['level-entity-coverage'],
    ),
    list(
      'level.required_assets',
      owner('docs/LEVEL_SCENE_DESIGN.md', 'content_matrix'),
      'Read the natural-language requirement entries or labels authored in the LEVEL content_matrix, preserving the authored labels with surrounding whitespace normalized; never require, convert, or infer physical asset IDs.',
      ['level-asset-coverage'],
    ),
    integer(
      'level.complexity_budget',
      owner('docs/LEVEL_SCENE_DESIGN.md', 'production_acceptance'),
      'Read the finite non-negative level complexity budget.',
      0,
      1000000,
      ['technical-performance-budget'],
    ),
    list(
      'balance.entity_ids',
      owner('docs/BALANCE_DESIGN.md', 'entity_parameters'),
      'Read stable balance entity identifiers.',
      ['balance-entity-coverage'],
    ),
    list(
      'balance.variable_ids',
      owner('docs/BALANCE_DESIGN.md', 'units_variables'),
      'Read stable balance variable identifiers.',
      ['balance-variable-coverage'],
    ),
    list(
      'technical.supported_actions',
      owner('docs/TECHNICAL_DESIGN.md', 'input_interaction'),
      'Read the same GDD-owned player-action labels from Technical input_interaction. If Technical includes runtime ACTION codes or a mapping table, extract only the player-facing label column; never extract the ACTION codes as fact values.',
      ['technical-action-coverage'],
      {
        sourceOfTruthDirection:
          'GDD player_actions owns canonical player-facing action/mechanic labels; Technical input_interaction projects the same labels and may keep runtime ACTION codes only in an independent mapping column.',
      },
    ),
    integer(
      'technical.target_fps',
      owner('docs/TECHNICAL_DESIGN.md', 'performance'),
      'Read the target frame rate as one finite integer.',
      1,
      240,
      ['technical-performance-budget'],
    ),
    list(
      'technical.content_kinds',
      owner('docs/TECHNICAL_DESIGN.md', 'data_content'),
      'Read stable content kind identifiers.',
      ['asset-content-kind-coverage'],
    ),
    list(
      'art.style_constraints',
      owner('docs/ART_DIRECTION.md', 'visual_pillars'),
      'Read canonical visual pillar and prohibited-direction constraint identifiers.',
      ['asset-style-constraint-coverage'],
      { resolution: 'model_if_unresolved' },
    ),
    list(
      'ui.supported_actions',
      owner('docs/UI_UX_SPEC.md', 'input'),
      'Read stable UI input action identifiers.',
      ['ui-action-coverage'],
    ),
    list(
      'ui.displayed_resources',
      owner('docs/UI_UX_SPEC.md', 'hud'),
      'Read the same canonical short labels used for tracked gameplay resources: include the HUD-tracked currency and health pool. Strip parenthetical English aliases and explanatory text; return only the short labels shared with GDD game.resources.',
      ['ui-resource-coverage'],
    ),
    list(
      'audio.event_ids',
      owner('docs/AUDIO_DESIGN.md', 'event_taxonomy'),
      'Read stable audio event identifiers.',
      ['audio-event-coverage'],
    ),
    list(
      'asset.inventory_ids',
      owner('docs/ASSET_PLAN.md', 'inventory'),
      'Read stable asset inventory identifiers.',
      ['asset-inventory-coverage'],
    ),
    list(
      'asset.covered_level_requirements',
      owner('docs/ASSET_PLAN.md', 'inventory'),
      'Read only the Level requirement entries or labels on the left side of an explicit AssetPlan inventory mapping table. If that mapping table or its covered rows is absent or unclear, leave this fact absent or uncertain; never copy, transform, or infer values from asset.inventory_ids, filenames, or other physical asset IDs.',
      ['level-asset-coverage'],
      {
        sourceOfTruthDirection:
          'LEVEL content matrix owns required asset requirements; ASSET_PLAN inventory maps those requirements to physical inventory IDs.',
      },
    ),
    integer(
      'asset.boss.count',
      owner('docs/ASSET_PLAN.md', 'inventory'),
      'Read the authored boss asset count as one finite integer.',
      0,
      64,
      ['boss-count-consistency'],
      {
        sourceOfTruthDirection:
          'GDD rules owns boss count; ASSET_PLAN inventory is a downstream projection.',
      },
    ),
    list(
      'asset.art_constraint_refs',
      owner('docs/ASSET_PLAN.md', 'dependencies'),
      'Read references to ART_DIRECTION visual constraints used by assets.',
      ['asset-style-constraint-coverage'],
      {
        sourceOfTruthDirection:
          'ART_DIRECTION visual pillars own constraints; ASSET_PLAN dependencies projects them.',
      },
    ),
    list(
      'asset.formats',
      owner('docs/ASSET_PLAN.md', 'formats_budgets'),
      'Read canonical asset delivery format identifiers.',
      ['asset-platform-format'],
    ),
  ])

export const FOUNDATION_FACT_CATALOG_OWNER_SECTIONS: readonly FoundationFactDefinition['owner'][] = Object.freeze(
  [...new Map(FOUNDATION_FACT_CATALOG.map(definition => [
    `${definition.owner.documentPath}\0${definition.owner.sectionId}`,
    { ...definition.owner },
  ] as const)).values()].sort((left, right) =>
    left.documentPath.localeCompare(right.documentPath) ||
    left.sectionId.localeCompare(right.sectionId),
  ),
)

export const FOUNDATION_FACT_CATALOG_BY_KEY: ReadonlyMap<
  FoundationFactKey,
  FoundationFactDefinition
> = new Map(FOUNDATION_FACT_CATALOG.map(item => [item.key, item]))

export function foundationFactDefinition(
  key: string,
): FoundationFactDefinition | undefined {
  return FOUNDATION_FACT_CATALOG_BY_KEY.get(key as FoundationFactKey)
}

export function isFoundationFactKey(value: string): value is FoundationFactKey {
  return FOUNDATION_FACT_CATALOG_BY_KEY.has(value as FoundationFactKey)
}
