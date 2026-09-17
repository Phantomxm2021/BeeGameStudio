import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  RESOURCE_SOURCE_KINDS,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import { parseGameIrCompileRequest, type GameIrCompileRequest } from './core/contracts'
import { parseGameIrCandidate, type GameIrCandidate } from './core/model'

export type DirectGameIrAuthority = Readonly<{
  request: GameIrCompileRequest
  candidate: GameIrCandidate
}>

export type DirectGameIrInputFiles = Readonly<Record<string, string>>

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
    throw new Error(`${label} fields must be exactly ${wanted.join(', ')}`)
}

/** Attach trusted publication identity to one compact CLI-authored IR document. */
export function admitDirectGameIrDraft(input: {
  draft: unknown
  request: GameIrCompileRequest
}): GameIrCandidate {
  const request = parseGameIrCompileRequest(input.request)
  const draft = object(input.draft, 'IR draft')
  exactKeys(draft, ['schemaVersion', 'parameters', 'assets', 'scenes', 'ui', 'vfx', 'logic'], 'IR draft')
  if (draft.schemaVersion !== 'game-ir-direct-draft.v2')
    throw new Error('IR draft schemaVersion must be game-ir-direct-draft.v2')
  return parseGameIrCandidate({
    schemaVersion: 'game-ir.v2',
    taskId: request.taskId,
    sourceRevision: request.foundation.foundationRevision,
    parameters: draft.parameters,
    assets: draft.assets,
    scenes: draft.scenes,
    ui: draft.ui,
    vfx: draft.vfx,
    logic: draft.logic,
  }, { request })
}

export function renderDirectGameIrAuthority(_input: {
  request: GameIrCompileRequest
}): string {
  return [
    '# Game IR task',
    '',
    'Read the eight game documents and create the compact, engine-neutral implementation data that later resource, editor, and game implementation work actually needs.',
    'Use your judgment. Preserve concrete values and relationships needed to build the game, but do not copy explanatory prose, acceptance checklists, document structure, or speculative systems into the IR.',
    'Represent each asset requirement once. Scene, UI, and VFX entries reference assets only by asset ID. Keep editable configuration inside each entry config object and shared tuning values in parameters.',
    'Use only values from resource-vocabulary.json for resource vocabulary fields. dimensions and kinds must be non-empty; use the agnostic dimension for resources such as audio and fonts that are neither 2D nor 3D.',
    '`coverage` describes multiple independently sourced components, not animation states, variants or features. Use [] for an atomic asset. Coverage objects use non-empty assetKinds, usageTags, capabilities, relationKinds or embeddedKinds arrays; when used, the asset-level capabilities must be [].',
    'Put engine-neutral gameplay states, transitions, rules and events needed by implementation in logic. Do not omit behavior merely because a target implementation will express it as code.',
    'Write one JSON object matching game-ir-format.json. Empty UI or VFX arrays are allowed when the documents do not require them. Do not create additional registries or output files.',
  ].join('\n')
}

export function renderDirectGameIrRepairAuthority(input: { diagnostic: string }): string {
  return [
    '# Repair Game IR',
    '',
    `Host validation rejected the previous output: ${input.diagnostic}`,
    'Correct previous-output.txt against game-ir-format.json and resource-vocabulary.json.',
    'Preserve valid content, IDs and references. Return the complete corrected JSON object and do not restart the design from the source documents.',
  ].join('\n')
}

export function renderDirectGameIrInputFiles(): DirectGameIrInputFiles {
  return {
    'game-ir-format.json': `${JSON.stringify({
      schemaVersion: 'game-ir-direct-draft.v2',
      parameters: { '<shared-key>': '<JSON value>' },
      assets: [{
        id: 'stable.asset.id',
        name: 'display name',
        required: true,
        purpose: 'runtime purpose',
        dimensions: ['2D'],
        kinds: ['image'],
        usageTags: ['scene'],
        capabilities: [],
        styles: [],
        acceptanceCriteria: ['observable acceptance condition'],
        coverage: [],
        sourcing: {
          allowedSourceKinds: ['web', 'agent-authored'],
          licenseConstraints: ['known license or original authorship'],
          responsibleParty: 'resource stage',
          handoffCriteria: ['resource is registered and verified'],
        },
      }],
      scenes: [{ id: 'scene.main', name: 'Main scene', assetIds: ['stable.asset.id'], config: {} }],
      ui: [{ id: 'ui.hud', name: 'HUD', assetIds: [], config: {} }],
      vfx: [{ id: 'vfx.primary', name: 'Primary VFX', assetIds: [], config: {} }],
      logic: { '<system-or-rule>': '<engine-neutral JSON value>' },
    }, null, 2)}\n`,
    'resource-vocabulary.json': `${JSON.stringify({
      dimensions: RESOURCE_DIMENSIONS,
      kinds: RESOURCE_ASSET_KINDS,
      usageTags: RESOURCE_USAGE_TAGS,
      capabilities: RESOURCE_CAPABILITIES,
      allowedSourceKinds: RESOURCE_SOURCE_KINDS,
      coverage: {
        assetKinds: RESOURCE_ASSET_KINDS,
        usageTags: RESOURCE_USAGE_TAGS,
        capabilities: RESOURCE_CAPABILITIES,
        relationKinds: RESOURCE_RELATION_KINDS,
        embeddedKinds: RESOURCE_EMBEDDED_COMPONENT_KINDS,
      },
    }, null, 2)}\n`,
  }
}
