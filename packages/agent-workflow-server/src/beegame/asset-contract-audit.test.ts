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

  test('rejects legacy slots manifests instead of silently validating a second contract', async () => {
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
    expect(audit.slots).toEqual([])
    expect(audit.issues).toEqual([
      'requirements must be an array. Legacy slots manifests are not accepted; migrate inventory to imports and game responsibilities to requirements/compositions.',
    ])
  })

  test('reports exact canonical manifest shape errors instead of treating legacy maps as missing fields', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-shape-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      project_target: { asset_format_capabilities: { models: ['glb'] } },
      slots: { character: { target: { path: 'assets/character.glb' } } },
    }))

    expect(auditAssetContract(workspace).issues).toEqual([
      'requirements must be an array. Legacy slots manifests are not accepted; migrate inventory to imports and game responsibilities to requirements/compositions.',
    ])
  })

  test('rejects a stale canonical schema version explicitly', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-version-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 4,
      project_target: { asset_format_capabilities: ['glb'] },
      requirements: [],
      imports: [],
      compositions: [],
    }))

    expect(auditAssetContract(workspace).issues).toContain('version must be 5; received 4.')
  })

  test('rejects an invented resource library usage without inferring it from the platform', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-policy-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: {
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'web-assets',
      },
      requirements: [],
      imports: [],
      compositions: [],
    }))

    expect(auditAssetContract(workspace).issues).toEqual([
      'project_target.resource_library_usage must be one of optional, preferred, required; received "web-assets".',
    ])
  })

  test('reports canonical usage-tag values for an invalid authored requirement', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-tag-vocabulary-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['ogg'] },
      requirements: [{
        id: 'feedback-audio',
        status: 'planned',
        resource_requirement: {
          accepted_formats: ['ogg'],
          tags: ['noncanonical-purpose'],
        },
      }],
      imports: [],
      compositions: [],
    }))

    const issue = auditAssetContract(workspace).issues.find(value =>
      value.startsWith('feedback-audio: Unbound resource_requirement.tags contains unsupported usage tags:'),
    )
    expect(issue).toContain('Allowed canonical values:')
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

  test('rejects empty files and directories masquerading as imported artifacts', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-canonical-import-artifacts-'))
    await mkdir(join(workspace, 'assets', 'library', 'directory.glb'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'empty.glb'), '')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['glb'] },
      requirements: [],
      imports: [
        { id: 'directory', source: { type: 'resource-library', pack_id: 'kit', pack_version: '1', element_id: 'directory', element_path: 'directory.glb' }, status: 'available', root_path: 'assets/library/directory.glb', local_files: ['assets/library/directory.glb'], selected_at: 'now', selection_reason: ['Selected logical root'] },
        { id: 'empty', source: { type: 'resource-library', pack_id: 'kit', pack_version: '1', element_id: 'empty', element_path: 'empty.glb' }, status: 'available', root_path: 'assets/library/empty.glb', local_files: ['assets/library/empty.glb'], selected_at: 'now', selection_reason: ['Selected logical root'] },
      ],
      compositions: [],
    }))

    expect(auditAssetContract(workspace).issues).toEqual(expect.arrayContaining([
      'directory: Imported artifact is not a file: assets/library/directory.glb',
      'empty: Imported file is empty: assets/library/empty.glb',
    ]))
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
