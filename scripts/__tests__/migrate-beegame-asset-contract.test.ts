import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  applyAssetContractMigration,
  planAssetContractMigration,
} from '../migrate-beegame-asset-contract'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('offline asset contract migration', () => {
  test('removes the slot contract and relocates pinned imports without claiming integration evidence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'asset-contract-migration-'))
    workspaces.push(workspace)
    await mkdir(join(workspace, 'assets', 'library'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'library', 'root.glb'), 'root')
    await writeFile(join(workspace, 'assets', 'library', 'texture.png'), 'texture')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 4,
      project_target: { asset_format_capabilities: ['glb', 'png'], resource_library_usage: 'preferred' },
      slots: [{
        slot_id: 'world-art',
        description: 'World art',
        status: 'integrated',
        accepted_formats: ['glb'],
        resource_binding: { pack_id: 'old-pack' },
      }],
      imports: [{
        id: 'world-root',
        source: { type: 'resource-library', pack_id: 'pack', pack_version: '1', element_id: 'element', element_path: 'root.glb' },
        status: 'referenced',
        root_path: 'assets/library/root.glb',
        local_files: ['assets/library/root.glb', 'assets/library/texture.png'],
        selected_at: '2026-07-22T00:00:00.000Z',
        selection_reason: ['authored choice'],
        usage_evidence: { references: ['src/world.ts'] },
      }],
      compositions: [{ id: 'world', kind: 'scene', members: [{ import_id: 'world-root', role: 'world' }], status: 'integrated', integration_evidence: { references: ['src/world.ts'] } }],
    }))

    const plan = planAssetContractMigration({ workspace, runtimeAssetRoot: 'public/game-assets' })
    expect(plan.manifest).toEqual(expect.objectContaining({
      version: 5,
      requirements: [expect.objectContaining({ id: 'world-art', status: 'planned' })],
      imports: [expect.objectContaining({ status: 'available', root_path: 'public/game-assets/migrated/world-root/root.glb' })],
      compositions: [expect.objectContaining({ status: 'planned' })],
    }))
    expect(JSON.stringify(plan.manifest)).not.toContain('resource_binding')
    expect(JSON.stringify(plan.manifest)).not.toContain('usage_evidence')
    expect(JSON.stringify(plan.manifest)).not.toContain('integration_evidence')

    const backup = await applyAssetContractMigration(plan)
    expect(await readFile(join(workspace, 'public/game-assets/migrated/world-root/root.glb'), 'utf8')).toBe('root')
    expect(await readFile(join(workspace, 'public/game-assets/migrated/world-root/texture.png'), 'utf8')).toBe('texture')
    expect(await readFile(backup, 'utf8')).toContain('"slots"')
  })

  test('defaults to a dry plan and rejects unsafe paths before mutating files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'asset-contract-migration-'))
    workspaces.push(workspace)
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [],
      imports: [{ id: 'unsafe', root_path: '../outside.png', local_files: ['../outside.png'] }],
      compositions: [],
    }))
    expect(() => planAssetContractMigration({ workspace, runtimeAssetRoot: 'public/assets' })).toThrow('incomplete canonical identity')
  })

  test('preflights every move before writing a backup or relocating files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'asset-contract-migration-'))
    workspaces.push(workspace)
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'present.glb'), 'present')
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['glb'] },
      requirements: [],
      imports: [{
        id: 'incomplete',
        root_path: 'assets/present.glb',
        local_files: ['assets/present.glb', 'assets/missing.png'],
      }],
      compositions: [],
    }))
    const plan = planAssetContractMigration({ workspace, runtimeAssetRoot: 'public/assets' })
    await expect(applyAssetContractMigration(plan)).rejects.toThrow('migration source does not exist')
    expect(await readFile(join(workspace, 'assets', 'present.glb'), 'utf8')).toBe('present')
    await expect(access(join(workspace, 'public/assets/migrated/incomplete/present.glb'))).rejects.toBeDefined()
  })

  test('rolls completed moves back when a later filesystem operation fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'asset-contract-migration-'))
    workspaces.push(workspace)
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await mkdir(join(workspace, 'public/assets/migrated'), { recursive: true })
    await writeFile(join(workspace, 'assets', 'first.glb'), 'first')
    await writeFile(join(workspace, 'assets', 'second.glb'), 'second')
    await writeFile(join(workspace, 'public/assets/migrated/second'), 'destination-parent-is-a-file')
    const originalManifest = JSON.stringify({
      version: 5,
      project_target: { asset_format_capabilities: ['glb'] },
      requirements: [],
      imports: [
        { id: 'first', root_path: 'assets/first.glb', local_files: ['assets/first.glb'] },
        { id: 'second', root_path: 'assets/second.glb', local_files: ['assets/second.glb'] },
      ],
      compositions: [],
    })
    await writeFile(join(workspace, 'assets', 'asset-manifest.json'), originalManifest)

    const plan = planAssetContractMigration({ workspace, runtimeAssetRoot: 'public/assets' })
    await expect(applyAssetContractMigration(plan)).rejects.toBeDefined()
    expect(await readFile(join(workspace, 'assets', 'first.glb'), 'utf8')).toBe('first')
    expect(await readFile(join(workspace, 'assets', 'second.glb'), 'utf8')).toBe('second')
    expect(await readFile(join(workspace, 'assets', 'asset-manifest.json'), 'utf8')).toBe(originalManifest)
  })
})
