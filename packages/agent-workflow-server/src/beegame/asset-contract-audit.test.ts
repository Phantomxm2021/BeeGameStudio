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
})
