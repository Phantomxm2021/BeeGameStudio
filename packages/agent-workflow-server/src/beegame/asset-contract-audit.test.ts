import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { auditAssetContract } from './asset-contract-audit'
import { writeBeeGameAssetManifest } from './asset-contracts'

describe('v7 asset and content audit', () => {
  test('audits JSON and YAML references without an assembly graph', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-audit-'))
    try {
      await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
      await mkdir(join(workspace, 'assets', 'content'), { recursive: true })
      await writeFile(join(workspace, 'assets/runtime/world.svg'), '<svg/>')
      await writeBeeGameAssetManifest(workspace, {
        version: 7,
        project_target: { asset_format_capabilities: ['svg', 'yaml'], runtime_asset_root: 'assets/runtime', content_root: 'assets/content', generated_asset_root: 'assets/generated' },
        requirements: [{ id: 'world.layout', required: true }],
        resources: [{ id: 'world-art', source: { type: 'agent-authored', created_at: new Date().toISOString(), reason: 'placeholder' }, root_path: 'assets/runtime/world.svg', file_paths: ['assets/runtime/world.svg'], provisional: true, status: 'verified', selected_at: new Date().toISOString(), selection_reason: ['Project-authored material.'] }],
      })
      await writeFile(join(workspace, 'assets/content/world.yaml'), 'schema: beegame-content-v1\nid: world\nkind: scene-definitions\nfulfills:\n  - world.layout\nresources:\n  - world-art\ndata:\n  objects: []\n')
      const audit = auditAssetContract(workspace)
      expect(audit.valid).toBe(true)
      expect(audit.content.files[0]).toMatchObject({ id: 'world', kind: 'scene-definitions' })
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('enforces JSON ownership for events and waves and YAML ownership for scenes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-audit-'))
    try {
      await mkdir(join(workspace, 'assets/content'), { recursive: true })
      await writeBeeGameAssetManifest(workspace, {
        version: 7,
        project_target: { asset_format_capabilities: ['json', 'yaml'], runtime_asset_root: 'assets/runtime', content_root: 'assets/content', generated_asset_root: 'assets/generated' },
        requirements: [],
        resources: [],
      })
      const header = { schema: 'beegame-content-v1', fulfills: [], resources: [], data: {} }
      await writeFile(join(workspace, 'assets/content/events.yaml'), 'schema: beegame-content-v1\nid: events\nkind: event-definitions\nfulfills: []\nresources: []\ndata: {}\n')
      await writeFile(join(workspace, 'assets/content/scene.json'), JSON.stringify({ ...header, id: 'scene', kind: 'scene-definitions' }))

      expect(auditAssetContract(workspace).issues).toEqual(expect.arrayContaining([
        expect.stringContaining('events.yaml: YAML kind must be one of'),
        expect.stringContaining('scene.json: JSON kind must be one of'),
      ]))

      await rm(join(workspace, 'assets/content/events.yaml'))
      await rm(join(workspace, 'assets/content/scene.json'))
      await writeFile(join(workspace, 'assets/content/events.json'), JSON.stringify({ ...header, id: 'events', kind: 'event-definitions' }))
      await writeFile(join(workspace, 'assets/content/waves.json'), JSON.stringify({ ...header, id: 'waves', kind: 'wave-definitions' }))
      await writeFile(join(workspace, 'assets/content/scene.yaml'), 'schema: beegame-content-v1\nid: scene\nkind: scene-definitions\nfulfills: []\nresources: []\ndata: {}\n')
      expect(auditAssetContract(workspace).valid).toBe(true)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})
