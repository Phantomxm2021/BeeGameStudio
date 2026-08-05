import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'bun:test'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { auditResourceDeliveryReadiness } from './resource-delivery-readiness'

const roots: string[] = []
afterEach(async () =>
  Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  ),
)

describe('resource-content readiness', () => {
  it('requires verified resources and JSON/YAML coverage', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-content-'))
    roots.push(workspace)
    await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
    await mkdir(join(workspace, 'assets', 'content'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/runtime/player.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    )
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['svg', 'json', 'yaml'],
        resource_library_usage: 'optional',
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [{ id: 'visual.player', required: true }],
      resources: [
        {
          id: 'player-art',
          source: {
            type: 'agent-authored',
            created_at: new Date().toISOString(),
            reason: 'placeholder',
          },
          root_path: 'assets/runtime/player.svg',
          file_paths: ['assets/runtime/player.svg'],
          provisional: true,
          status: 'verified',
          selected_at: new Date().toISOString(),
          selection_reason: ['No suitable library material was selected.'],
        },
      ],
    })
    expect(
      auditResourceDeliveryReadiness({ workspacePath: workspace }).ready,
    ).toBe(false)
    await writeFile(
      join(workspace, 'assets/content/resource-registry.json'),
      JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'registry',
        kind: 'resource-registry',
        fulfills: ['visual.player'],
        resources: ['player-art'],
        data: {
          bindings: [
            { requirementId: 'visual.player', resourceIds: ['player-art'] },
          ],
        },
      }),
    )
    expect(
      auditResourceDeliveryReadiness({ workspacePath: workspace }),
    ).toMatchObject({ ready: true, contentFileCount: 1 })
  })
})
