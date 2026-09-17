import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_SOURCE_KINDS,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import { parseCanonicalBeeGameAssetManifest } from '../../../asset-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../../../foundation-documents'
import { foundationPublicDigest } from '../../../foundation-public-result'
import type { FoundationIrInput } from '../input'
import { parseGameIrCompileRequest } from './core/contracts'
import { foundationReadyReceiptFromInput } from './core/source-input'
import { admitDirectGameIrDraft, renderDirectGameIrAuthority, renderDirectGameIrInputFiles } from './direct-authority'
import { commitDirectGameIrPublication, validateDirectGameIrPublication } from './direct-publication'

const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

function sourceFixture(): FoundationIrInput {
  const content = '# Fixture\n\nCaptured source.\n', digest = sha(content)
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content, digest,
    byteLength: Buffer.byteLength(content), sections: [{ ordinal: 0, kind: 'heading' as const,
      headingLevel: 1, headingText: 'Fixture', startByte: 0, endByte: Buffer.byteLength(content), digest }] }))
  const documentSetDigest = foundationPublicDigest(documents.map(document => [document.path, document.digest]))
  return { protocolVersion: 1, ownerId: 'owner', projectId: 'project', foundationResultId: sha('result'),
    foundationResultDigest: sha('result-digest'), publishedDocumentRevision: documentSetDigest, documentSetDigest,
    confirmedBriefDigest: sha('brief'), confirmedRequirementsDigest: sha('brief'), documents,
    sourceIndexDigest: foundationPublicDigest(documents.map(document => ({ path: document.path, digest: document.digest,
      byteLength: document.byteLength, sections: document.sections }))) }
}

test('admits and atomically publishes one compact CLI-authored IR document', async () => {
  const source = sourceFixture(), foundation = foundationReadyReceiptFromInput(source)
  const request = parseGameIrCompileRequest({ schemaVersion: 'game-ir-compile-request.v2', taskId: 'task',
    publicationId: 'publication', gameIrSchemaVersion: 'game-ir.v2', foundation })
  const draft = {
    schemaVersion: 'game-ir-direct-draft.v2',
    parameters: { playerSpeed: 4 },
    assets: [{ id: 'sprite.player', name: 'Player sprite', required: true, purpose: 'player rendering',
      dimensions: ['2D'], kinds: ['image'], usageTags: ['scene'], capabilities: [], styles: ['bright'],
      acceptanceCriteria: ['transparent background'], coverage: [], sourcing: {
        allowedSourceKinds: ['web'], licenseConstraints: ['commercial use'], responsibleParty: 'resource stage',
        handoffCriteria: ['registered and verified'],
      } }],
    scenes: [{ id: 'scene.main', name: 'Main', assetIds: ['sprite.player'], config: { objective: 'collect' } }],
    ui: [{ id: 'ui.hud', name: 'HUD', assetIds: [], config: { counters: ['score'] } }],
    vfx: [], logic: { startScene: 'scene.main' },
  }
  const candidate = admitDirectGameIrDraft({ draft, request })
  expect(candidate).toMatchObject({ schemaVersion: 'game-ir.v2', taskId: 'task',
    sourceRevision: foundation.foundationRevision, parameters: { playerSpeed: 4 } })
  expect(candidate.scenes[0]?.assetIds).toEqual(['sprite.player'])

  const workspacePath = await mkdtemp('/private/tmp/direct-ir-publication-')
  try {
    const authority = { workspacePath, publicationId: request.publicationId, request, candidate }
    const ready = await commitDirectGameIrPublication(authority)
    const restored = await validateDirectGameIrPublication(authority)
    expect(restored.ready).toEqual(ready)
    expect(restored.candidate).toEqual(candidate)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }

  const prompt = renderDirectGameIrAuthority({ request })
  expect(prompt).not.toMatch(/subagent|reviewer|retry|step-by-step/i)
  expect(prompt).toContain('compact, engine-neutral implementation data')
  expect(prompt).toContain('not animation states')
  expect(prompt).toContain('assetKinds')
  expect(prompt).toContain('gameplay states, transitions, rules and events')
  expect(prompt).toContain('Write one JSON object')
  expect(prompt.length).toBeLessThan(1_500)
  const format = JSON.parse(renderDirectGameIrInputFiles()['game-ir-format.json']!)
  const vocabulary = JSON.parse(renderDirectGameIrInputFiles()['resource-vocabulary.json']!)
  expect(format).toHaveProperty('scenes')
  expect(format).not.toHaveProperty('modules')
  expect(vocabulary).toMatchObject({ dimensions: [...RESOURCE_DIMENSIONS], kinds: [...RESOURCE_ASSET_KINDS],
    usageTags: [...RESOURCE_USAGE_TAGS], capabilities: [...RESOURCE_CAPABILITIES],
    allowedSourceKinds: [...RESOURCE_SOURCE_KINDS] })

  const asset = candidate.assets[0]!
  expect(() => parseCanonicalBeeGameAssetManifest({
    version: 9,
    project_target: { asset_format_capabilities: ['png'], runtime_asset_root: 'assets/runtime',
      generated_asset_root: 'assets/generated' },
    requirements: [{ id: asset.id, name: asset.name, purpose: asset.purpose, required: asset.required,
      acquisition_profile: { dimensions: asset.dimensions, asset_kinds: asset.kinds,
        usage_tags: asset.usageTags, capabilities: asset.capabilities, styles: asset.styles,
        acceptance_criteria: asset.acceptanceCriteria, sourcing_policy: {
          allowed_source_kinds: asset.sourcing.allowedSourceKinds,
          license_constraints: asset.sourcing.licenseConstraints,
          responsible_party: asset.sourcing.responsibleParty,
          handoff_criteria: asset.sourcing.handoffCriteria,
        } } }],
    resources: [],
  })).not.toThrow()
})

test('rejects dangling asset references and unknown root fields', () => {
  const source = sourceFixture(), foundation = foundationReadyReceiptFromInput(source)
  const request = parseGameIrCompileRequest({ schemaVersion: 'game-ir-compile-request.v2', taskId: 'task',
    publicationId: 'publication', gameIrSchemaVersion: 'game-ir.v2', foundation })
  const base = { schemaVersion: 'game-ir-direct-draft.v2', parameters: {}, assets: [],
    scenes: [{ id: 'scene.main', name: 'Main', assetIds: ['missing'], config: {} }], ui: [], vfx: [], logic: {} }
  expect(() => admitDirectGameIrDraft({ draft: base, request })).toThrow('unknown asset missing')
  expect(() => admitDirectGameIrDraft({ draft: { ...base, extra: true }, request })).toThrow('fields must be exactly')
})

test('accepts only resource-composition coverage fields and keeps atomic capabilities separate', () => {
  const source = sourceFixture(), foundation = foundationReadyReceiptFromInput(source)
  const request = parseGameIrCompileRequest({ schemaVersion: 'game-ir-compile-request.v2', taskId: 'task',
    publicationId: 'publication', gameIrSchemaVersion: 'game-ir.v2', foundation })
  const asset = { id: 'sprite.player', name: 'Player sprite', required: true, purpose: 'player rendering',
    dimensions: ['2D'], kinds: ['image'], usageTags: ['scene'], capabilities: [], styles: [],
    acceptanceCriteria: ['renders correctly'], coverage: [{ assetKinds: ['image'], capabilities: ['frame-sequence'] }], sourcing: {
      allowedSourceKinds: ['web'], licenseConstraints: ['commercial use'], responsibleParty: 'resource stage',
      handoffCriteria: ['registered and verified'],
    } }
  const draft = { schemaVersion: 'game-ir-direct-draft.v2', parameters: {}, assets: [asset],
    scenes: [{ id: 'scene.main', name: 'Main', assetIds: ['sprite.player'], config: {} }], ui: [], vfx: [], logic: {} }
  expect(admitDirectGameIrDraft({ draft, request }).assets[0]?.coverage).toEqual([
    { assetKinds: ['image'], capabilities: ['frame-sequence'] },
  ])
  expect(() => admitDirectGameIrDraft({ draft: { ...draft, assets: [{ ...asset, coverage: [{ state: ['idle'] }] }] }, request }))
    .toThrow('unknown field state')
  expect(() => admitDirectGameIrDraft({ draft: { ...draft, assets: [{ ...asset, capabilities: ['frame-sequence'] }] }, request }))
    .toThrow('capabilities must be empty when coverage is present')
  expect(() => admitDirectGameIrDraft({ draft: { ...draft, assets: [{ ...asset, coverage: [], kinds: ['audio'] }] }, request }))
    .toThrow('unsupported value audio')
})
