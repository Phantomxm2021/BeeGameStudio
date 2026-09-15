import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'bun:test'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { auditResourceDeliveryReadiness } from './resource-delivery-readiness'

const roots: string[] = []
const TEST_ACQUISITION_PROFILE = {
  dimensions: ['agnostic'] as const,
  asset_kinds: ['data'] as const,
  usage_tags: [],
  capabilities: [],
  styles: [],
}

afterEach(async () =>
  Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  ),
)

describe('resource delivery readiness', () => {
  it('uses Manifest bindings and does not require content files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resources-'))
    roots.push(workspace)
    await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
    await writeFile(join(workspace, 'assets/runtime/player.json'), '{}\n')
    await writeBeeGameAssetManifest(workspace, {
      version: 9,
      project_target: {
        asset_format_capabilities: ['json'],
        resource_library_usage: 'preferred',
        runtime_asset_root: 'assets/runtime',
        generated_asset_root: 'assets/generated',
      },
      requirements: [
        {
          id: 'visual.player',
          required: true,
          acquisition_profile: TEST_ACQUISITION_PROFILE,
        },
      ],
      resources: [
        {
          id: 'player-art',
          fulfills: ['visual.player'],
          source: {
            type: 'agent-authored',
            created_at: new Date().toISOString(),
            reason: 'fixture resource',
          },
          root_path: 'assets/runtime/player.json',
          file_paths: ['assets/runtime/player.json'],
          provisional: false,
          status: 'verified',
          selected_at: new Date().toISOString(),
          selection_reason: ['Matches the requirement.'],
          dimension: 'agnostic',
          asset_kind: 'data',
        },
      ],
    })

    expect(
      auditResourceDeliveryReadiness({ workspacePath: workspace }),
    ).toMatchObject({
      ready: true,
      requirementCount: 1,
      boundRequirementCount: 1,
      resourceCount: 1,
    })
  })

  it('rejects the retired assets/content root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resources-'))
    roots.push(workspace)
    await mkdir(join(workspace, 'assets/content'), { recursive: true })

    const result = auditResourceDeliveryReadiness({ workspacePath: workspace })

    expect(result.ready).toBe(false)
    expect(result.issues.join('\n')).toContain('Retired resource content root')
  })
})
