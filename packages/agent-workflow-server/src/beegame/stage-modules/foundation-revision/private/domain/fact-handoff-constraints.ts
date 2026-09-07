import type { FoundationDocumentPath } from './types'

/** The version of the Reviewer-owned fact catalog projected into Revision. */
export const REVISION_FACT_HANDOFF_CATALOG_VERSION = 'foundation-facts.v3' as const

export type RevisionFactValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'

export type RevisionFactValueSpec = Readonly<{
  enum?: readonly string[]
  min?: number
  max?: number
  minItems?: number
  maxItems?: number
  itemPattern?: string
}>

/**
 * Data-only projection needed to validate a copied fact.  Audit policy,
 * extraction execution, consumers and resolution behavior deliberately do not cross
 * the Reviewer/Revision boundary.
 */
export type RevisionFactHandoffConstraint = Readonly<{
  key: string
  owner: Readonly<{ documentPath: FoundationDocumentPath; sectionId: string }>
  valueType: RevisionFactValueType
  valueSpec: RevisionFactValueSpec
  presence: 'required' | 'optional'
  extractionInstruction: string
  sourceOfTruthDirection: string
}>

const owner = (documentPath: FoundationDocumentPath, sectionId: string) => ({ documentPath, sectionId })
const listSpec = (overrides: RevisionFactValueSpec = {}): RevisionFactValueSpec => ({
  minItems: 1,
  maxItems: 256,
  itemPattern: '^\\S(?:.*\\S)?$',
  ...overrides,
})
const list = (
  key: string,
  factOwner: Readonly<{ documentPath: FoundationDocumentPath; sectionId: string }>,
  extractionInstruction: string,
  sourceOfTruthDirection = 'owner section is authoritative',
  valueSpec = listSpec(),
): RevisionFactHandoffConstraint => ({
  key,
  owner: factOwner,
  valueType: 'string[]',
  valueSpec,
  presence: 'required',
  extractionInstruction,
  sourceOfTruthDirection,
})
const integer = (
  key: string,
  factOwner: Readonly<{ documentPath: FoundationDocumentPath; sectionId: string }>,
  extractionInstruction: string,
  min: number,
  max: number,
  sourceOfTruthDirection = 'owner section is authoritative',
): RevisionFactHandoffConstraint => ({
  key,
  owner: factOwner,
  valueType: 'number',
  valueSpec: { min, max },
  presence: 'required',
  extractionInstruction,
  sourceOfTruthDirection,
})

const GDDVision = owner('docs/GDD.md', 'vision')
const GDDRules = owner('docs/GDD.md', 'rules_systems')
const GDDActions = owner('docs/GDD.md', 'player_actions')
const GDDStates = owner('docs/GDD.md', 'states_flow')

const project = (constraint: RevisionFactHandoffConstraint): RevisionFactHandoffConstraint =>
  Object.freeze({
    ...constraint,
    owner: Object.freeze({ ...constraint.owner }),
    valueSpec: Object.freeze({
      ...constraint.valueSpec,
      ...(constraint.valueSpec.enum ? { enum: Object.freeze([...constraint.valueSpec.enum]) } : {}),
    }),
  })

/** Frozen projection of the 23-key Reviewer fact catalog. */
export const REVISION_FACT_HANDOFF_CONSTRAINTS: readonly RevisionFactHandoffConstraint[] = Object.freeze([
  integer('game.players.max', GDDVision, 'Read the authored maximum player count as one finite integer.', 1, 64),
  list('game.mechanics', GDDActions, 'Read the GDD player_actions canonical player-facing action/mechanic labels as a list; these labels are the shared fact identity for downstream documents.', 'GDD player_actions owns the canonical player-facing action/mechanic labels consumed by downstream documents.'),
  list('game.resources', GDDRules, 'Read the same canonical short labels used for tracked gameplay resources: include the HUD-tracked currency and health pool. Strip parenthetical English aliases and explanatory text; return only the short labels shared with UI displayed resources.'),
  list('game.states', GDDStates, 'Read the canonical gameplay state identifiers as a list.'),
  list('game.win_conditions', GDDStates, 'Read the canonical win condition identifiers or short labels as a list.', 'owner section is authoritative'),
  list('game.loss_conditions', GDDStates, 'Read the canonical loss condition identifiers or short labels as a list. An explicit empty list is authoritative when the game intentionally has no failure state.', 'owner section is authoritative', listSpec({ minItems: 0 })),
  {
    key: 'game.platform', owner: GDDVision, valueType: 'string' as const, valueSpec: { enum: ['quest', 'desktop', 'web', 'mobile', 'console', 'vr', 'ar'] },
    presence: 'required' as const, extractionInstruction: 'Read the one canonical target platform enum.',
    sourceOfTruthDirection: 'GDD vision owns product platform; technical design confirms feasibility.',
  } as RevisionFactHandoffConstraint,
  list('level.required_entities', owner('docs/LEVEL_SCENE_DESIGN.md', 'encounters'), 'Read stable entity identifiers required by encounters.'),
  list('level.required_assets', owner('docs/LEVEL_SCENE_DESIGN.md', 'content_matrix'), 'Read the natural-language requirement entries or labels authored in the LEVEL content_matrix, preserving the authored labels with surrounding whitespace normalized; never require, convert, or infer physical asset IDs.'),
  integer('level.complexity_budget', owner('docs/LEVEL_SCENE_DESIGN.md', 'production_acceptance'), 'Read the finite non-negative level complexity budget.', 0, 1000000),
  list('balance.entity_ids', owner('docs/BALANCE_DESIGN.md', 'entity_parameters'), 'Read stable balance entity identifiers.'),
  list('balance.variable_ids', owner('docs/BALANCE_DESIGN.md', 'material.variable-parameter-table'), 'Read stable numeric balance variable identifiers from the canonical variable-parameter-table; do not infer them from Units, Variables and Conventions prose.'),
  list('technical.supported_actions', owner('docs/TECHNICAL_DESIGN.md', 'input_interaction'), 'Read the same GDD-owned player-action labels from Technical input_interaction. If Technical includes runtime ACTION codes or a mapping table, extract only the player-facing label column; never extract the ACTION codes as fact values.', 'GDD player_actions owns canonical player-facing action/mechanic labels; Technical input_interaction projects the same labels and may keep runtime ACTION codes only in an independent mapping column.'),
  integer('technical.target_fps', owner('docs/TECHNICAL_DESIGN.md', 'performance'), 'Read the target frame rate as one finite integer.', 1, 240),
  list('technical.content_kinds', owner('docs/TECHNICAL_DESIGN.md', 'data_content'), 'Read stable content kind identifiers.'),
  list('art.style_constraints', owner('docs/ART_DIRECTION.md', 'visual_pillars'), 'Read canonical visual pillar and prohibited-direction constraint identifiers.'),
  list('ui.supported_actions', owner('docs/UI_UX_SPEC.md', 'input'), 'Read stable UI input action identifiers.'),
  list('ui.displayed_resources', owner('docs/UI_UX_SPEC.md', 'hud'), 'Read the same canonical short labels used for tracked gameplay resources: include the HUD-tracked currency and health pool. Strip parenthetical English aliases and explanatory text; return only the short labels shared with GDD game.resources.'),
  list('audio.event_ids', owner('docs/AUDIO_DESIGN.md', 'material.event-cue-matrix'), 'Read stable audio event identifiers from the canonical Event to Cue Matrix owner material.'),
  list('asset.inventory_ids', owner('docs/ASSET_PLAN.md', 'material.asset-inventory-table'), 'Read stable asset inventory identifiers from the canonical Asset Inventory Table owner material.'),
  list('asset.covered_level_requirements', owner('docs/ASSET_PLAN.md', 'material.asset-inventory-table'), 'Read only the Level requirement entries or labels on the left side of an explicit AssetPlan inventory mapping table. If that mapping table or its covered rows is absent or unclear, leave this fact absent or uncertain; never copy, transform, or infer values from asset.inventory_ids, filenames, or other physical asset IDs.', 'LEVEL content matrix owns required asset requirements; ASSET_PLAN inventory maps those requirements to physical inventory IDs.'),
  list('asset.art_constraint_refs', owner('docs/ASSET_PLAN.md', 'material.dependency-integration-diagram'), 'Read references to ART_DIRECTION visual constraints from the canonical dependency and integration owner material.', 'ART_DIRECTION visual pillars own constraints; ASSET_PLAN dependencies projects them.'),
  list('asset.formats', owner('docs/ASSET_PLAN.md', 'material.asset-inventory-table'), 'Read canonical delivered file format identifiers from the Asset Inventory Table file column.'),
].map(project))

export const REVISION_FACT_HANDOFF_CONSTRAINTS_BY_KEY: ReadonlyMap<string, RevisionFactHandoffConstraint> = new Map(
  REVISION_FACT_HANDOFF_CONSTRAINTS.map(constraint => [constraint.key, constraint]),
)

/** Contract edges are data only; Revision does not evaluate their relation. */
export const REVISION_DETERMINISTIC_CONTRACT_ENDPOINTS = Object.freeze([
  Object.freeze({ sourceFactKey: 'technical.supported_actions', targetFactKey: 'game.mechanics' }),
  Object.freeze({ sourceFactKey: 'ui.displayed_resources', targetFactKey: 'game.resources' }),
  Object.freeze({ sourceFactKey: 'asset.covered_level_requirements', targetFactKey: 'level.required_assets' }),
] as const)
