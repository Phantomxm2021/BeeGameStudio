import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CURRENT_ASSET_MANIFEST_VERSION,
  parseCanonicalBeeGameAssetManifest,
  readBeeGameAssetManifest,
  readBeeGameAssetManifestModulePathsSync,
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from '../asset-contracts'
import { auditBeeGameContent } from '../content-contracts'
import { CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS } from '../configured-provisional-resource-adapters'
import { beeGameProgrammaticAudioResourceSchema, parseBeeGameProgrammaticAudioResource } from '../programmatic-audio-resource'
import { buildFoundationAuthoringDeliveryContract } from './foundation-authoring-delivery-contract'
import { buildWorkerPrompt } from './worker-prompts'

const temporaryWorkspaces: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryWorkspaces.splice(0).map(path =>
      rm(path, { recursive: true, force: true }),
    ),
  )
})

function validManifest(): BeeGameAssetManifest {
  return {
    version: CURRENT_ASSET_MANIFEST_VERSION,
    project_target: {
      asset_format_capabilities: ['json'],
      resource_library_usage: 'preferred' as const,
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [
      {
        id: 'world.visual',
        name: 'World visual',
        purpose: 'A loadable world resource.',
        required: true,
        acquisition_profile: {
          dimensions: ['agnostic'] as const,
          asset_kinds: ['data'] as const,
          usage_tags: [],
          capabilities: [],
          styles: ['canonical'],
        },
      },
    ],
    resources: [
      {
        id: 'world-resource',
        source: {
          type: 'agent-authored' as const,
          created_at: '2026-09-05T00:00:00.000Z',
          reason: 'Offline contract fixture.',
        },
        root_path: 'assets/runtime/world.json',
        file_paths: ['assets/runtime/world.json'],
        provisional: false,
        status: 'verified' as const,
        selected_at: '2026-09-05T00:00:00.000Z',
        selection_reason: ['Fixture resource selected for the world.'],
        asset_kind: 'data',
      },
    ],
  }
}

describe('foundation authoring delivery contract', () => {
  test('covers the real d60195 format-label and multi-file audio failures', () => {
    const manifest = validManifest()
    manifest.project_target!.asset_format_capabilities = ['audio-variants', 'loop-points']
    expect(() => parseCanonicalBeeGameAssetManifest(manifest)).toThrow()
    manifest.project_target!.asset_format_capabilities = ['json']
    expect(() => parseCanonicalBeeGameAssetManifest(manifest)).not.toThrow()
    Object.assign(manifest.resources[0]!, {
      asset_kind: 'audio-cue', provisional: true,
      root_path: 'assets/runtime/patch-atk.json',
      file_paths: ['assets/runtime/patch-atk.json', 'assets/runtime/patch-hit.json'],
    })
    expect(() => parseCanonicalBeeGameAssetManifest(manifest)).toThrow(/one provisional audio-cue or audio-bank JSON root/)
    const contract = buildFoundationAuthoringDeliveryContract()
    expect(contract.formatRule).toContain('lowercase ASCII')
    expect(contract.programmaticAudio.manifestRule).toContain('single JSON root')
  })

  test('registers authored cue/bank JSON but rejects a multi-cue audio-cue', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-authoring-audio-'))
    temporaryWorkspaces.push(workspace)
    await writeBeeGameAssetManifest(workspace, validManifest())
    await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
    const cue = { id: 'attack', duration_ms: 100, voices: [{
      source: { type: 'oscillator', waveform: 'sine', frequency_hz: 440 },
      start_ms: 0, duration_ms: 100, gain: 0.2,
    }] }
    const audio = { format: 'beegame-programmatic-audio-v1', cues: [cue] }
    const path = 'assets/runtime/audio.json'
    const input = { id: 'audio', root_path: path, file_paths: [path],
      provisional: true, reason: 'Regression fixture', selection_reason: ['Authored audio'], asset_kind: 'audio-cue' }
    await writeFile(join(workspace, path), JSON.stringify(audio))
    expect((await registerBeeGameAuthoredResources(workspace, [input])).resources.find(r => r.id === 'audio')?.status).toBe('verified')
    audio.cues.push({ ...cue, id: 'hit' })
    await writeFile(join(workspace, path), JSON.stringify(audio))
    await expect(registerBeeGameAuthoredResources(workspace, [input])).rejects.toThrow(/exactly one cue/)
    expect((await registerBeeGameAuthoredResources(workspace, [{ ...input, asset_kind: 'audio-bank' }])).resources.find(r => r.id === 'audio')?.asset_kind).toBe('audio-bank')
    expect(() => parseBeeGameProgrammaticAudioResource({ ...audio, nodes: [] })).toThrow()
    expect(() => parseBeeGameProgrammaticAudioResource({ ...audio, cues: [cue, cue] })).toThrow(/unique/)
    expect(() => parseBeeGameProgrammaticAudioResource({ ...audio, cues: [{ ...cue, duration_ms: 50 }] })).toThrow(/within cue/)
    const contract = buildFoundationAuthoringDeliveryContract()
    expect(contract.programmaticAudio.cueRule).toContain('exactly one cue')
    expect(contract.programmaticAudio.schema).toHaveProperty('properties.format')
    expect(contract.programmaticAudio.authoredRegistration).toContain('registerBeeGameAuthoredResources')
  })

  test('projects configured placeholder support without claiming JSON audio generation', () => {
    const contract = buildFoundationAuthoringDeliveryContract()
    expect(contract.placeholderAdapters).toEqual(CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS.map(adapter => ({
      format: adapter.format, assetKinds: [...adapter.assetKinds],
    })))
    expect(contract.placeholderAdapters.find(a => a.format === 'json')?.assetKinds).not.toContain('audio-cue')
    expect(contract.placeholderRule).toContain('does not imply')
    expect(contract.programmaticAudio.authoredRegistration).toContain('not itself a worker tool')
    expect(contract.programmaticAudio.schema).toEqual(z.toJSONSchema(beeGameProgrammaticAudioResourceSchema))
  })

  test('keeps schema refinements enforceable through the real audio parser', () => {
    const voice = { source: { type: 'noise', color: 'pink' }, start_ms: 0, duration_ms: 100, gain: 0.5 }
    const cue = { id: 'cue', duration_ms: 100, voices: [voice] }
    const resource = (candidate: unknown) => ({ format: 'beegame-programmatic-audio-v1', cues: [candidate] })
    expect(() => parseBeeGameProgrammaticAudioResource(resource(cue))).not.toThrow()
    for (const candidate of [
      { ...cue, loop: { start_ms: 50, end_ms: 50 } },
      { ...cue, loop: { start_ms: 0, end_ms: 101 } },
      { ...cue, voices: [{ ...voice, start_ms: 1 }] },
      { ...cue, voices: [{ ...voice, attack_ms: 60, release_ms: 41 }] },
      { ...cue, voices: [{ ...voice, filter: {} }] },
      { ...cue, voices: [{ ...voice, source: { type: 'noise', color: 'blue' } }] },
      { ...cue, voices: [{ ...voice, gain: 1.1 }] },
    ]) expect(() => parseBeeGameProgrammaticAudioResource(resource(candidate))).toThrow()
  })
  test('rejects an Asset author manifest field that the real parser does not support', () => {
    const selfInventedManifest = {
      version: 8,
      project_target: {
        asset_format_capabilities: ['json'],
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [],
      resources: [],
      visual_constants: {
        kind: 'visual-constants',
        values: { primary: '#ffcc00' },
      },
    }

    expect(() => parseCanonicalBeeGameAssetManifest(selfInventedManifest)).toThrow(
      /unknown fields: visual_constants/,
    )
  })

  test('accepts the representative manifest and round-trips its real disk modules', async () => {
    const manifest = validManifest()
    expect(parseCanonicalBeeGameAssetManifest(manifest)).toEqual(manifest)

    const workspace = await mkdtemp(join(tmpdir(), 'beegame-authoring-contract-'))
    temporaryWorkspaces.push(workspace)
    await writeBeeGameAssetManifest(workspace, manifest)

    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/content/resource-registry.json'),
      `${JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'resource-registry',
        kind: 'resource-registry',
        fulfills: ['world.visual'],
        resources: ['world-resource'],
        data: {
          bindings: [
            { requirementId: 'world.visual', resourceIds: ['world-resource'] },
          ],
        },
      })}\n`,
    )

    await expect(readBeeGameAssetManifest(workspace)).resolves.toEqual(manifest)
    expect(auditBeeGameContent(workspace, manifest)).toMatchObject({
      valid: true,
      coveredRequirementIds: ['world.visual'],
      referencedResourceIds: ['world-resource'],
    })
    const modulePaths = readBeeGameAssetManifestModulePathsSync(workspace)
    expect(modulePaths).toEqual([
      'assets/asset-manifest.json',
      expect.stringMatching(/^assets\/manifest\/requirements\/[^/]+\.json$/),
      expect.stringMatching(/^assets\/manifest\/resources\/[^/]+\.json$/),
    ])
    const adapter = buildFoundationAuthoringDeliveryContract()
    const index = JSON.parse(
      readFileSync(join(workspace, modulePaths[0]!), 'utf8'),
    ) as Record<string, unknown>
    const requirementModule = JSON.parse(
      readFileSync(join(workspace, modulePaths[1]!), 'utf8'),
    ) as Record<string, unknown>
    const resourceModule = JSON.parse(
      readFileSync(join(workspace, modulePaths[2]!), 'utf8'),
    ) as Record<string, unknown>
    expect(Object.keys(index).sort()).toEqual(
      adapter.canonicalAssetManifest.indexFields.slice().sort(),
    )
    expect(Object.keys(index.modules as object).sort()).toEqual(
      adapter.canonicalAssetManifest.moduleLayout.indexModulesFields
        .slice()
        .sort(),
    )
    expect(Object.keys(requirementModule)).toEqual(
      [
        ...adapter.canonicalAssetManifest.moduleLayout.requirements.moduleFields,
      ],
    )
    expect(Object.keys(resourceModule)).toEqual(
      expect.arrayContaining(adapter.resources.requiredFields),
    )
    expect(Object.keys(resourceModule)).not.toEqual(
      expect.arrayContaining(['resource']),
    )
  })

  test('rejects unsupported content kinds and reversed registry IDs through the real audit', async () => {
    const manifest = validManifest()
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-authoring-negative-'))
    temporaryWorkspaces.push(workspace)
    await writeBeeGameAssetManifest(workspace, manifest)
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/content/visual-constants.json'),
      `${JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'visual-constants',
        kind: 'visual-constants',
        fulfills: [],
        resources: [],
        data: {},
      })}\n`,
    )
    await writeFile(
      join(workspace, 'assets/content/resource-registry.json'),
      `${JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'resource-registry',
        kind: 'resource-registry',
        fulfills: ['world-resource'],
        resources: ['world.visual'],
        data: {
          bindings: [
            { requirementId: 'world-resource', resourceIds: ['world.visual'] },
          ],
        },
      })}\n`,
    )

    const audit = auditBeeGameContent(workspace, manifest)
    expect(audit.valid).toBe(false)
    expect(audit.issues.join('\n')).toContain(
      'JSON kind must be one of',
    )
    expect(audit.issues.join('\n')).toContain(
      'unknown registry requirement: world-resource',
    )
    expect(audit.issues.join('\n')).toContain(
      'unknown or unverified registry resource: world.visual',
    )
  })

  test('gives Technical and Asset authors the actual private delivery contract', () => {
    const contract = buildFoundationAuthoringDeliveryContract()
    expect(contract.canonicalAssetManifest.moduleLayout).toMatchObject({
      requirements: {
        root: 'assets/manifest/requirements',
        cardinality: 'exactly_one',
      },
      resources: {
        root: 'assets/manifest/resources',
        cardinality: 'one_per_resource',
      },
    })
    expect(contract.requirements.fields).toContain('acquisition_profile')
    expect(contract.requirements.requiredFields).toEqual([
      'id',
      'acquisition_profile',
    ])
    expect(contract.requirements.optionalFields).toContain('purpose')
    expect(contract.resources.fields).toContain('local_file_hashes')
    expect(contract.resources.requiredFields).not.toContain('asset_kind')
    expect(contract.resources.optionalFields).toContain('asset_kind')
    expect(contract.resources.sourceShapes['agent-authored']).toEqual({
      fields: ['type', 'created_at', 'reason'],
      requiredFields: ['type', 'created_at', 'reason'],
    })
    expect(contract.content.jsonKinds).toContain('resource-registry')
    expect(contract.content.yamlKinds).toContain('world-definition')
    expect(contract.resourceRegistry.bindingFields).toEqual([
      'requirementId',
      'resourceIds',
    ])

    for (const foundationDocumentPath of [
      'docs/TECHNICAL_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ] as const) {
      const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision',
        allowedPaths: [foundationDocumentPath],
        contract: {
          documentSet: 'foundation',
          authoringMode: 'parallel-draft',
          foundationDocumentPath,
        },
      })

      expect(prompt).toContain('authoringDeliveryContract')
      expect(prompt).toContain('beegame-programmatic-audio-v1')
      expect(prompt).toContain('exactly one cue')
      expect(prompt).toContain('placeholderAdapters')
      expect(prompt).toContain('resource-registry')
      expect(prompt).toContain('requirementId')
      expect(prompt).toContain('resourceIds')
      expect(prompt).toContain('do not invent manifest fields or unsupported content kinds')
      expect(prompt).not.toContain('systemDeliveryContract')
    }
  })
})
