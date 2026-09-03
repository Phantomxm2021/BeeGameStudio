import { createHash } from 'node:crypto'
import { getGameDocumentContract } from '../game-document-contracts'
import type { FoundationDocumentPath } from '../types'
import {
  GAME_IR_DOMAIN_IDS,
  GAME_IR_MODULE_SOURCE_DOCUMENTS,
  type GameIrDomainId,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  buildGameIrEvidenceFragmentCatalog,
  deriveProjectionSlicePlan,
  type GameIrProjectionRetryDiagnostic,
  type GameIrProjectionSlice,
  type GameIrProjectionSliceContext,
} from './projection-slices'
import {
  type GameIrProjectionOperationPacket,
} from './projection-slice-journal'
import type { GameIrSemanticObligationInventory } from './semantic-obligation-inventory'
import { canonicalGameIrJson, compareCodeUnits, digestGameIrValue } from './model'

export type GameIrProjectionSliceSourceSelector = Readonly<{
  documentPath: FoundationDocumentPath
  sectionId: string
}>

const refs = (
  documentPath: FoundationDocumentPath,
  sectionIds: readonly string[],
): readonly GameIrProjectionSliceSourceSelector[] => {
  const contract = getGameDocumentContract(documentPath)
  const selectors = sectionIds.map(sectionId => {
    const knownSection = contract.sections.some(
      section => section.sectionId === sectionId,
    )
    const knownMaterial = contract.productionMaterials.some(
      material => material.materialId === sectionId.replace(/^material\./u, ''),
    )
    if (!knownSection && !knownMaterial)
      throw new Error(
        `unknown Game IR authority section ${documentPath}#${sectionId}`,
      )
    return Object.freeze({ documentPath, sectionId })
  })
  const sorted = [...selectors].sort((left, right) =>
    compareCodeUnits(
      `${left.documentPath}#${left.sectionId}`,
      `${right.documentPath}#${right.sectionId}`,
    ),
  )
  if (
    sorted.some(
      (selector, index) =>
        index > 0 &&
        `${selector.documentPath}#${selector.sectionId}` ===
          `${sorted[index - 1]!.documentPath}#${sorted[index - 1]!.sectionId}`,
    )
  )
    throw new Error(`duplicate Game IR authority section ${documentPath}`)
  return Object.freeze(sorted)
}

const selectorKey = (selector: GameIrProjectionSliceSourceSelector): string =>
  `${selector.documentPath}#${selector.sectionId}`

const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

const RAW_GAME_IR_SLICE_SOURCE_SECTIONS = {
  'gameplay.slice.0': refs('docs/GDD.md', ['core_loop', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'challenge_recovery', 'material.game-state-flow']),
  'gameplay.slice.1': refs('docs/GDD.md', ['vision', 'experience_pillars', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'material.core-loop-diagram', 'material.game-state-flow']),
  'balance.slice.0': [...refs('docs/GDD.md', ['rules_systems', 'progression']), ...refs('docs/BALANCE_DESIGN.md', ['units_variables', 'entity_parameters', 'progression_curves', 'material.variable-parameter-table'])],
  'balance.slice.1': [...refs('docs/GDD.md', ['rules_systems']), ...refs('docs/BALANCE_DESIGN.md', ['units_variables', 'entity_parameters', 'formulas', 'material.variable-parameter-table'])],
  'balance.slice.2': [...refs('docs/GDD.md', ['rules_systems', 'progression']), ...refs('docs/BALANCE_DESIGN.md', ['formulas', 'economy', 'rewards_value'])],
  'balance.slice.3': [...refs('docs/GDD.md', ['player_actions', 'rules_systems']), ...refs('docs/BALANCE_DESIGN.md', ['economy', 'rewards_value'])],
  'world-scene.slice.0': refs('docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'camera_readability', 'scene_states', 'material.world-structure-diagram']),
  'world-scene.slice.1': [...refs('docs/GDD.md', ['states_flow', 'progression']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['level_sequence', 'objectives_routes', 'spawn_checkpoint', 'camera_readability', 'scene_states', 'content_matrix', 'material.route-choice-diagram'])],
  'world-scene.slice.2': [...refs('docs/GDD.md', ['rules_systems', 'challenge_recovery']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['level_sequence', 'pacing_beats', 'encounters', 'spawn_checkpoint', 'content_matrix', 'material.pacing-beat-table'])],
  'presentation.slice.0': [...refs('docs/GDD.md', ['rules_systems', 'states_flow']), ...refs('docs/ART_DIRECTION.md', ['visual_pillars', 'composition_readability', 'animation', 'vfx', 'camera_presentation', 'material.animation-vfx-state-table']), ...refs('docs/UI_UX_SPEC.md', ['experience_architecture', 'screen_inventory', 'hud', 'material.information-architecture-diagram', 'material.screen-state-table']), ...refs('docs/AUDIO_DESIGN.md', ['event_taxonomy', 'music', 'ambience', 'material.event-cue-matrix', 'material.music-state-diagram'])],
  'presentation.slice.1': [...refs('docs/GDD.md', ['player_actions', 'states_flow']), ...refs('docs/ART_DIRECTION.md', ['animation', 'vfx']), ...refs('docs/UI_UX_SPEC.md', ['player_journeys', 'input', 'feedback_errors', 'onboarding', 'accessibility', 'material.player-flow-diagram', 'material.screen-state-table']), ...refs('docs/AUDIO_DESIGN.md', ['event_taxonomy', 'sfx', 'ui_feedback'])],
  'resource-realization.slice.0': [...refs('docs/ASSET_PLAN.md', ['inventory', 'formats_budgets', 'material.asset-inventory-table']), ...refs('docs/TECHNICAL_DESIGN.md', ['architecture', 'data_content', 'build_release'])],
  'resource-realization.slice.1': refs('docs/ASSET_PLAN.md', ['ownership', 'dependencies', 'source_license', 'pipeline', 'material.responsibility-matrix', 'material.license-register']),
  'resource-realization.slice.2': [...refs('docs/ASSET_PLAN.md', ['formats_budgets', 'validation', 'placeholder_replacement']), ...refs('docs/TECHNICAL_DESIGN.md', ['performance', 'build_release']), ...refs('docs/ART_DIRECTION.md', ['asset_specifications']), ...refs('docs/UI_UX_SPEC.md', ['prototype_acceptance']), ...refs('docs/AUDIO_DESIGN.md', ['implementation', 'production', 'material.loudness-delivery-table']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['production_acceptance'])],
  'implementation-verification.slice.0': refs('docs/TECHNICAL_DESIGN.md', ['architecture', 'build_release']),
  'implementation-verification.slice.1': [...refs('docs/GDD.md', ['core_loop', 'rules_systems']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'objectives_routes', 'production_acceptance']), ...refs('docs/TECHNICAL_DESIGN.md', ['architecture', 'runtime_state', 'data_content', 'input_interaction', 'build_release'])],
  'implementation-verification.slice.2': [...refs('docs/LEVEL_SCENE_DESIGN.md', ['production_acceptance']), ...refs('docs/TECHNICAL_DESIGN.md', ['diagnostics', 'testing', 'build_release'])],
  'implementation-verification.slice.3': [...refs('docs/GDD.md', ['rules_systems', 'states_flow', 'challenge_recovery', 'scope_risks']), ...refs('docs/BALANCE_DESIGN.md', ['bounds_exploits', 'tuning_validation', 'risks_dependencies']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['production_acceptance']), ...refs('docs/TECHNICAL_DESIGN.md', ['performance', 'testing', 'risks'])],
} as const

export const GAME_IR_SLICE_SOURCE_SECTIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_GAME_IR_SLICE_SOURCE_SECTIONS).map(([sliceId, selectors]) => [
      sliceId,
      Object.freeze(
        [...selectors].sort((left, right) =>
          compareCodeUnits(selectorKey(left), selectorKey(right)),
        ),
      ),
    ]),
  ),
) as unknown as Readonly<{
  [sliceId in keyof typeof RAW_GAME_IR_SLICE_SOURCE_SECTIONS]: readonly GameIrProjectionSliceSourceSelector[]
}>

type SliceSourceMap = typeof GAME_IR_SLICE_SOURCE_SECTIONS

function moduleForSlice(sliceId: string): GameIrDomainId {
  const moduleId = GAME_IR_DOMAIN_IDS.find(module =>
    deriveProjectionSlicePlan(module).slices.some(
      slice => slice.sliceId === sliceId,
    ),
  )
  if (!moduleId) throw new Error(`unknown Game IR projection slice: ${sliceId}`)
  return moduleId
}

export function sourceSectionsForGameIrProjectionSlice(
  sliceId: string,
): readonly GameIrProjectionSliceSourceSelector[] {
  const selectors = (GAME_IR_SLICE_SOURCE_SECTIONS as SliceSourceMap)[
    sliceId as keyof SliceSourceMap
  ]
  if (!selectors) throw new Error(`unknown Game IR projection slice: ${sliceId}`)
  const moduleId = moduleForSlice(sliceId)
  const allowed = new Set(GAME_IR_MODULE_SOURCE_DOCUMENTS[moduleId])
  if (selectors.some(selector => !allowed.has(selector.documentPath)))
    throw new Error(`Game IR projection selector is outside module authority: ${sliceId}`)
  const keys = selectors.map(selectorKey)
  if (new Set(keys).size !== keys.length)
    throw new Error(`Game IR projection selectors contain duplicates: ${sliceId}`)
  return selectors
}

export type { GameIrProjectionRetryDiagnostic }

export type GameIrProjectionSliceAuthority = Readonly<{
  schemaVersion: 'game-ir-projection-slice-authority.v1'
  identity: Readonly<{
    taskId: string
    foundationRevision: string
    foundationReadyReceiptDigest: string
    compileRequestDigest: string
  }>
  moduleId: GameIrDomainId
  slice: GameIrProjectionSlice
  sourceFragments: readonly Readonly<{
    fragmentId: string
    documentPath: FoundationDocumentPath
    sectionId: string
    text: string
  }>[]
  availablePriorNodes: GameIrProjectionSliceContext['availablePriorNodes']
  requiredCurrentNodes: GameIrProjectionSliceContext['requiredCurrentNodes']
  admittedCurrentNodes: readonly Readonly<{ id: string; kind: string }>[]
  retryDiagnostic?: GameIrProjectionRetryDiagnostic
}>

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      freeze(nested)
    Object.freeze(value)
  }
  return value
}

function selectedSourceFragments(
  source: GameIrDomainSourceEnvelope,
  selectors: readonly GameIrProjectionSliceSourceSelector[],
): GameIrProjectionSliceAuthority['sourceFragments'] {
  const selectedKeys = new Set(selectors.map(selectorKey))
  const sectionIndex = new Map(
    source.sectionIndex.map(section => [selectorKey(section), section]),
  )
  for (const selector of selectors) {
    const key = selectorKey(selector)
    const section = sectionIndex.get(key)
    if (!section)
      throw new Error(`Game IR projection source section is missing: ${key}`)
    const text = source.sectionBytes[key]
    if (text === undefined)
      throw new Error(`Game IR projection source bytes are missing: ${key}`)
    if (sha256(text) !== section.digest)
      throw new Error(`Game IR projection source bytes are stale: ${key}`)
  }
  const catalog = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: source.sectionIndex,
    sectionBytes: source.sectionBytes,
  })
  const fragments = catalog.fragments
    .filter(fragment =>
      selectedKeys.has(`${fragment.documentPath}#${fragment.sectionId}`),
    )
    .map(fragment => ({
      fragmentId: fragment.fragmentId,
      documentPath: fragment.documentPath,
      sectionId: fragment.sectionId,
      text: fragment.excerpt,
    }))
  if (fragments.length === 0)
    throw new Error('Game IR projection authority has no source fragments')
  return Object.freeze(fragments.map(fragment => Object.freeze(fragment)))
}

function cloneContext(
  context: GameIrProjectionSliceContext,
  directDependencyKinds: ReadonlySet<string>,
  requiredCurrentNodes: readonly Readonly<{ id: string; kind: string }>[] =
    context.requiredCurrentNodes,
): GameIrProjectionSliceContext {
  return {
    availablePriorNodes: context.availablePriorNodes
      .filter(node => directDependencyKinds.has(node.kind))
      .map(node => ({
        id: node.id,
        kind: node.kind,
        value: JSON.parse(canonicalGameIrJson(node.value)) as Record<
          string,
          unknown
        >,
      })),
    requiredCurrentNodes: requiredCurrentNodes.map(node => ({
      id: node.id,
      kind: node.kind,
    })),
    admittedCurrentNodes: context.admittedCurrentNodes.map(node => ({
      id: node.id,
      kind: node.kind,
    })),
  }
}

export function buildGameIrProjectionSliceAuthority(input: {
  packet: GameIrProjectionOperationPacket
  slice: GameIrProjectionSlice
  sliceContext: GameIrProjectionSliceContext
  compileRequestDigest?: string
  foundationReadyReceiptDigest?: string
  retryDiagnostic?: GameIrProjectionRetryDiagnostic
  obligationInventory: GameIrSemanticObligationInventory
}): GameIrProjectionSliceAuthority {
  const source = input.packet.source
  const moduleId = moduleForSlice(input.slice.sliceId)
  if (source.moduleId !== moduleId || input.slice.sliceId !== `${moduleId}.${input.slice.sliceId.split('.').slice(1).join('.')}`)
    throw new Error('Game IR projection slice authority is detached')
  const canonicalSlice = deriveProjectionSlicePlan(moduleId).slices.find(
    slice => slice.sliceId === input.slice.sliceId,
  )!
  if (canonicalGameIrJson(input.slice) !== canonicalGameIrJson(canonicalSlice))
    throw new Error('Game IR projection slice authority slice is non-canonical')
  const expectedCompileRequestDigest = digestGameIrValue(source.compileRequest)
  const compileRequestDigest = input.compileRequestDigest ?? expectedCompileRequestDigest
  if (compileRequestDigest !== expectedCompileRequestDigest)
    throw new Error('Game IR projection compile request digest is stale')
  const foundationRevision = source.compileRequest.foundation.foundationRevision
  const foundationReadyReceiptDigest = source.compileRequest.foundation.receiptDigest
  if (
    input.foundationReadyReceiptDigest !== undefined &&
    input.foundationReadyReceiptDigest !== foundationReadyReceiptDigest
  )
    throw new Error('Game IR projection Foundation receipt digest is stale')
  if (input.retryDiagnostic && input.retryDiagnostic.sliceId !== input.slice.sliceId)
    throw new Error('Game IR projection retry diagnostic is detached')
  const selectors = sourceSectionsForGameIrProjectionSlice(input.slice.sliceId)
  const sourceFragments = selectedSourceFragments(source, selectors)
  let visibleFragments = sourceFragments
  const retryDiagnostic = input.retryDiagnostic
  if (retryDiagnostic?.scope === 'record') {
    const selected = sourceFragments.filter(
      fragment => fragment.fragmentId === retryDiagnostic.fragmentId,
    )
    if (selected.length === 0)
      throw new Error('Game IR projection retry diagnostic fragment is stale')
    visibleFragments = Object.freeze(selected)
  }
  const directDependencyKinds = new Set(
    input.slice.nodes.flatMap(node =>
      node.relationships.flatMap(relationship => relationship.targetKinds),
    ),
  )
  const inventory = input.obligationInventory
  if (
    inventory.moduleId !== source.moduleId ||
    inventory.sourceDigest !== source.sourceDigest ||
    inventory.digest !==
      digestGameIrValue(
        (({ digest: _digest, ...body }) => body)(inventory),
      )
  )
    throw new Error('Game IR projection obligation inventory is stale')
  const requiredCurrentNodes = inventory.obligations
    .filter(obligation => obligation.ownerSliceId === input.slice.sliceId)
    .map(obligation => ({ id: obligation.targetId, kind: obligation.targetKind }))
  const context = cloneContext(
    input.sliceContext,
    directDependencyKinds,
    requiredCurrentNodes,
  )
  return freeze({
    schemaVersion: 'game-ir-projection-slice-authority.v1',
    identity: {
      taskId: source.taskId,
      foundationRevision,
      foundationReadyReceiptDigest,
      compileRequestDigest,
    },
    moduleId,
    slice: canonicalSlice,
    sourceFragments: visibleFragments,
    availablePriorNodes: context.availablePriorNodes,
    requiredCurrentNodes: context.requiredCurrentNodes,
    admittedCurrentNodes: context.admittedCurrentNodes.map(node => ({
      id: node.id,
      kind: node.kind,
    })),
    ...(retryDiagnostic ? { retryDiagnostic: { ...retryDiagnostic } } : {}),
  })
}

function tableCell(value: unknown): string {
  return canonicalGameIrJson(value).replace(/\|/gu, '\\|')
}

export function renderGameIrProjectionSliceAuthority(
  authority: GameIrProjectionSliceAuthority,
): string {
  const lines = [
    '# SELECTED_AUTHORITY',
    '',
    '## Identity',
    '',
    '| field | value |',
    '| --- | --- |',
    `| taskId | ${authority.identity.taskId} |`,
    `| foundationRevision | ${authority.identity.foundationRevision} |`,
    `| foundationReadyReceiptDigest | ${authority.identity.foundationReadyReceiptDigest} |`,
    `| compileRequestDigest | ${authority.identity.compileRequestDigest} |`,
    '',
    '## Current slice',
    '',
    '| field | value |',
    '| --- | --- |',
    `| moduleId | ${authority.moduleId} |`,
    `| sliceId | ${authority.slice.sliceId} |`,
    `| nodeKinds | ${tableCell(authority.slice.nodeKinds)} |`,
    '',
    '### Node value contracts',
    '',
    '| kind | required | optional | fields | edge rules | reference policy |',
    '| --- | --- | --- | --- | --- | --- |',
    ...authority.slice.nodes.map(node =>
      `| ${node.kind} | ${tableCell(node.value.required)} | ${tableCell(node.value.optional)} | ${tableCell(node.value.fields)} | ${tableCell(node.relationships)} | ${tableCell(node.referencePolicy ?? '')} |`,
    ),
    '',
    '## Dependency context',
    '',
    '### Available prior nodes',
    '',
    '| id | kind | value |',
    '| --- | --- | --- |',
    ...authority.availablePriorNodes.map(node =>
      `| ${node.id} | ${node.kind} | ${tableCell(node.value)} |`,
    ),
    '',
    '### Required current nodes',
    '',
    '| id | kind |',
    '| --- | --- |',
    ...authority.requiredCurrentNodes.map(node => `| ${node.id} | ${node.kind} |`),
    '',
    '### Admitted current prefix',
    '',
    '| id | kind |',
    '| --- | --- |',
    ...authority.admittedCurrentNodes.map(node => `| ${node.id} | ${node.kind} |`),
    '',
    '## Source fragments',
    '',
  ]
  for (const fragment of authority.sourceFragments) {
    lines.push(`### ${fragment.fragmentId} — ${fragment.documentPath}#${fragment.sectionId}`, '', fragment.text, '')
  }
  if (authority.retryDiagnostic) {
    lines.push(
      '## Retry diagnostic',
      '',
      '| field | value |',
      '| --- | --- |',
      `| scope | ${authority.retryDiagnostic.scope} |`,
      `| recordId | ${authority.retryDiagnostic.scope === 'record' ? authority.retryDiagnostic.recordId : ''} |`,
      `| reason | ${authority.retryDiagnostic.reason} |`,
      '',
    )
  }
  lines.push(
    '## Output contract',
    '',
    'Return only the strict raw NDJSON record stream for this exact slice.',
    'Each node record must contain record, sliceId, fragmentId and node.',
    'Emit only declared node fields: id, kind, value, references and edges.',
    'For a resumed slice, emit only node IDs strictly after the final admitted current-prefix ID; emit done when the slice is complete.',
    'Finish with one done record for the exact sliceId.',
  )
  return `${lines.join('\n')}\n`
}
