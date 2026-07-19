import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'

describe('asset contract audit', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('does not require an asset contract for projects that do not declare one', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-no-assets-'))
    expect(auditAssetContract(workspace)).toMatchObject({ present: false, valid: true })
  })

  test('rejects integrated slots whose files or references are missing', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-missing-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['glb'] },
      slots: [{
        id: 'character-primary',
        status: 'integrated',
        target: { path: 'assets/models/character.glb' },
        uploaded_files: ['assets/models/character.glb'],
      }],
    }))

    const audit = auditAssetContract(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.slots[0]).toMatchObject({ stage: 'failed' })
    expect(audit.issues).toContain('character-primary: Integrated slot files are missing from the project.')
  })

  test('reports exact canonical manifest shape errors instead of treating legacy maps as missing fields', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-shape-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      project_target: { asset_format_capabilities: { models: ['glb'] } },
      slots: { character: { target: { path: 'assets/character.glb' } } },
    }))

    expect(auditAssetContract(workspace).issues).toEqual([
      'slots must be an array; received object.',
      'project_target.asset_format_capabilities must be an array of strings; received object.',
    ])
  })

  test('rejects an invented resource library usage without inferring it from the platform', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-policy-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: {
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'web-assets',
      },
      slots: [],
    }))

    expect(auditAssetContract(workspace).issues).toEqual([
      'project_target.resource_library_usage must be one of optional, preferred, required; received "web-assets".',
    ])
  })

  test('treats manifest runtime event IDs as declarations rather than proof', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-complete-'))
    await mkdir(join(workspace, 'assets', 'models'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'models', 'character.glb'), 'asset')
    await writeFile(join(workspace, 'src', 'game-entry.ts'), 'export const character = true\n')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['glb'] },
      slots: [{
        id: 'character-primary',
        status: 'integrated',
        target: { path: 'assets/models/character.glb' },
        uploaded_files: ['assets/models/character.glb'],
        resource_binding: { pack_id: 'pack', element_id: 'element', version: '1' },
        integration_evidence: {
          references: ['src/game-entry.ts'],
          runtime_event_ids: ['runtime-check-1'],
        },
      }],
    }))

    expect(auditAssetContract(workspace)).toMatchObject({
      present: true,
      valid: true,
      slots: [{
        id: 'character-primary',
        stage: 'referenced',
        runtimeEventIds: ['runtime-check-1'],
      }],
    })
  })

  test('uses the explicit project target capability contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-format-'))
    await mkdir(join(workspace, 'assets', 'models'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'models', 'character.engineasset'), 'asset')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['portable-model'] },
      slots: [{
        id: 'character-primary',
        status: 'placeholder',
        target: { path: 'assets/models/character.engineasset' },
        uploaded_files: ['assets/models/character.engineasset'],
      }],
    }))

    expect(auditAssetContract(workspace).issues).toContain(
      'character-primary: File format is outside project_target capabilities: assets/models/character.engineasset',
    )
  })

  test('accepts sparse authored intent when technical integration formats are explicit', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-selection-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['portable-model'] },
      slots: [{
        id: 'primary-visual',
        status: 'missing',
        target: { path: 'assets/primary.portable-model' },
        resource_requirement: {
          accepted_formats: ['portable-model'],
        },
      }],
    }))

    expect(auditAssetContract(workspace)).toMatchObject({ valid: true })
  })

  test('accepts an explicit platform-neutral resource exploration requirement', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-selection-valid-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['glb'] },
      slots: [{
        id: 'primary-visual',
        status: 'missing',
        target: { path: 'assets/primary.glb' },
        resource_requirement: {
          category: 'models',
          dimension: '3D',
          accepted_formats: ['glb'],
          tags: ['character'],
        },
      }],
    }))

    expect(auditAssetContract(workspace)).toMatchObject({ valid: true })
  })

  test('does not treat embedded source references as uploaded resource files', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-embedded-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'embedded-visual.ts'), 'export const visual = `<svg />`\n')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['svg'] },
      slots: [{
        id: 'embedded-visual',
        delivery_mode: 'embedded',
        status: 'integrated',
        target: { path: 'src/embedded-visual.ts' },
        integration_evidence: {
          references: ['src/embedded-visual.ts'],
          runtime_event_ids: ['visual-observed'],
        },
      }],
    }))

    expect(auditAssetContract(workspace)).toMatchObject({
      valid: true,
      slots: [{
        id: 'embedded-visual',
        deliveryMode: 'embedded',
        stage: 'referenced',
      }],
    })
  })

  test('reports the canonical usage-tag vocabulary with invalid values', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-tag-vocabulary-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['portable-audio'] },
      slots: [{
        id: 'feedback-audio',
        status: 'missing',
        target: { path: 'assets/feedback.portable-audio' },
        resource_requirement: {
          category: 'audio',
          dimension: 'agnostic',
          accepted_formats: ['portable-audio'],
          tags: ['noncanonical-purpose'],
        },
      }],
    }))

    const issue = auditAssetContract(workspace).issues.find(value =>
      value.startsWith('feedback-audio: Unbound resource_requirement.tags contains unsupported usage tags:'),
    )
    expect(issue).toContain('Allowed canonical values:')
  })

  test('validates an engine-neutral composition against its member slots and recipe', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-composition-'))
    await mkdir(join(workspace, 'assets', 'models'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'models', 'hero.glb'), 'asset')
    await writeFile(join(workspace, 'src', 'hero-recipe.ts'), 'export const hero = true\n')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['glb'] },
      slots: [{
        id: 'hero-model', status: 'integrated', target: { path: 'assets/models/hero.glb' },
        uploaded_files: ['assets/models/hero.glb'], resource_binding: { pack_id: 'pack' },
        integration_evidence: { references: ['src/hero-recipe.ts'] },
      }],
      compositions: [{
        id: 'hero', kind: 'character', status: 'integrated',
        members: [{ slot_id: 'hero-model', role: 'visual', required: true }],
        recipe: { path: 'src/hero-recipe.ts' },
        integration_evidence: { references: ['src/hero-recipe.ts'] },
      }],
    }))

    expect(auditAssetContract(workspace)).toMatchObject({
      valid: true,
      compositions: [{ id: 'hero', kind: 'character', status: 'integrated', memberSlotIds: ['hero-model'], issues: [] }],
    })
  })

  test('rejects an assembled composition with an unknown member or missing recipe', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-composition-invalid-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: [] },
      slots: [],
      compositions: [{ id: 'level', kind: 'scene', status: 'assembled', members: [{ slot_id: 'missing-layout', role: 'layout' }] }],
    }))

    expect(auditAssetContract(workspace).issues).toEqual(expect.arrayContaining([
      'level: Member references an unknown slot: missing-layout',
      'level: Assembled composition must declare recipe.path.',
    ]))
  })

  test('allows a direct composition to load one complete logical asset without a recipe', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-direct-composition-'))
    await mkdir(join(workspace, 'assets', 'models'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'models', 'hero.glb'), 'glTF')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['glb'] },
      slots: [{ id: 'hero-root', required: true, target: { path: 'assets/models/hero.glb' }, uploaded_files: ['assets/models/hero.glb'], resource_binding: { pack_id: 'characters', pack_version: '1.0.0', element_id: 'hero', source_url: 'https://resource.test/hero.glb', selected_at: '2026-01-01T00:00:00Z', selection_reason: ['compatible'] }, integration_evidence: { references: ['assets/models/hero.glb'] }, status: 'integrated' }],
      compositions: [{ id: 'hero', kind: 'character', assembly_mode: 'direct', status: 'integrated', members: [{ slot_id: 'hero-root', role: 'primary' }] }],
    }))

    const result = await auditAssetContract(workspace)
    expect(result.compositions).toEqual([expect.objectContaining({ id: 'hero', status: 'integrated', issues: [] })])
  })

  test('accepts reusable imports composed by target-native project code', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-canonical-composition-'))
    await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'ground.glb'), 'glTF')
    await writeFile(join(workspace, 'assets', 'library', 'tower.glb'), 'glTF')
    await writeFile(join(workspace, 'src', 'level.ts'), 'export const level = true')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['glb'], resource_library_usage: 'preferred' },
      requirements: [{ id: 'playable-level', required: true, status: 'satisfied', satisfied_by: { composition_ids: ['level-one'] } }],
      imports: [
        { id: 'ground', source: { type: 'resource-library', pack_id: 'kit', pack_version: '1', element_id: 'ground', element_path: 'ground.glb' }, status: 'referenced', root_path: 'assets/library/ground.glb', local_files: ['assets/library/ground.glb'], selected_at: 'now', selection_reason: ['Fits the approved composition'], usage_evidence: { references: ['src/level.ts'] } },
        { id: 'tower', source: { type: 'resource-library', pack_id: 'kit', pack_version: '1', element_id: 'tower', element_path: 'tower.glb' }, status: 'referenced', root_path: 'assets/library/tower.glb', local_files: ['assets/library/tower.glb'], selected_at: 'now', selection_reason: ['Fits the approved composition'], usage_evidence: { references: ['src/level.ts'] } },
      ],
      compositions: [{ id: 'level-one', kind: 'scene', assembly_mode: 'composed', status: 'integrated', members: [{ import_id: 'ground', role: 'ground' }, { import_id: 'tower', role: 'tower-variants' }], recipe: { path: 'src/level.ts' }, integration_evidence: { runtime_event_ids: ['level.loaded'] } }],
    }))

    expect(auditAssetContract(workspace)).toMatchObject({ valid: true, imports: [{ id: 'ground' }, { id: 'tower' }], compositions: [{ id: 'level-one', status: 'integrated' }] })
  })

  test('rejects unproven imports and cyclic composition graphs', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-canonical-composition-invalid-'))
    await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'root.glb'), 'glTF')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['glb'] },
      requirements: [],
      imports: [{ id: 'root', source: { type: 'resource-library', pack_id: 'kit', pack_version: '1', element_id: 'root', element_path: 'root.glb' }, status: 'referenced', root_path: 'assets/library/root.glb', local_files: ['assets/library/root.glb'], selected_at: 'now', selection_reason: [] }],
      compositions: [
        { id: 'a', kind: 'scene', status: 'planned', members: [{ composition_id: 'b', role: 'nested' }] },
        { id: 'b', kind: 'scene', status: 'planned', members: [{ composition_id: 'a', role: 'nested' }] },
      ],
    }))

    expect(auditAssetContract(workspace).issues).toEqual(expect.arrayContaining([
      'root: A referenced import must include usage_evidence.',
      'Composition cycle is not allowed: a -> b -> a',
    ]))
  })

  test('does not let a copied library element satisfy a game requirement by itself', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-canonical-copy-is-not-use-'))
    await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'wall.glb'), 'glTF')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['glb'] },
      requirements: [{ id: 'play-space', status: 'satisfied', satisfied_by: { import_ids: ['wall'] } }],
      imports: [{ id: 'wall', source: { type: 'resource-library', pack_id: 'kit', pack_version: '1', element_id: 'wall', element_path: 'wall.glb' }, status: 'available', root_path: 'assets/library/wall.glb', local_files: ['assets/library/wall.glb'], selected_at: 'now', selection_reason: [] }],
      compositions: [],
    }))

    expect(auditAssetContract(workspace).issues).toContain('play-space: A copied import cannot satisfy a requirement until project usage is evidenced: wall')
  })

  test('accepts objective primitive technical facts and rejects target settings or nested guesses', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-canonical-technical-facts-'))
    await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'root.glb'), 'glTF')
    const manifest = {
      version: 5,
      project_target: { asset_format_capabilities: ['glb'] },
      requirements: [],
      imports: [{ id: 'root', source: { type: 'resource-library', pack_id: 'kit', pack_version: '1', element_id: 'root', element_path: 'root.glb' }, status: 'available', root_path: 'assets/library/root.glb', local_files: ['assets/library/root.glb'], selected_at: 'now', selection_reason: ['Reviewed source root'], technical_facts: { boundsSizeY: 4, hasNormals: true } }],
      compositions: [],
    }
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify(manifest))
    expect(auditAssetContract(workspace).valid).toBe(true)

    manifest.imports[0]!.technical_facts = { boundsSizeY: { guessedScale: 0.2 } } as unknown as typeof manifest.imports[0]['technical_facts']
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify(manifest))
    expect(auditAssetContract(workspace).issues).toContain('root: technical_facts must contain only finite primitive source-file facts.')
  })
})
