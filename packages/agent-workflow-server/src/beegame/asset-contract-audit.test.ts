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

  test('rejects integrated slots whose files or runtime evidence are missing', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-missing-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 1,
      project_target: { asset_format_capabilities: ['glb'] },
      slots: [{
        id: 'character-primary',
        status: 'integrated',
        target: { path: 'assets/models/character.glb' },
      }],
    }))

    const audit = auditAssetContract(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.slots[0]).toMatchObject({ stage: 'failed' })
    expect(audit.issues).toContain('character-primary: Integrated slot files are missing from the project.')
    expect(audit.issues).toContain('character-primary: Integrated slot has no runtime load evidence.')
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

  test('verifies declared, bound, copied, referenced and runtime-loaded states separately', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-assets-complete-'))
    await mkdir(join(workspace, 'assets', 'models'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'models', 'character.glb'), 'asset')
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
      slots: [{ id: 'character-primary', stage: 'runtime_loaded' }],
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
      }],
    }))

    expect(auditAssetContract(workspace).issues).toContain(
      'character-primary: File format is outside project_target capabilities: assets/models/character.engineasset',
    )
  })

  test('rejects unbound selection requirements that cannot be safely matched', async () => {
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

    const audit = auditAssetContract(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain(
      'primary-visual: Unbound resource_requirement.category is required for safe automatic selection.',
    )
    expect(audit.issues).toContain(
      'primary-visual: Unbound resource_requirement.tags must include at least one canonical usage tag for safe automatic selection.',
    )
  })

  test('accepts an explicit platform-neutral automatic selection requirement', async () => {
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
})
