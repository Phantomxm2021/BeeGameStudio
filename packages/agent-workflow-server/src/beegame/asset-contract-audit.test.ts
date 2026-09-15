import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import {
  parseCanonicalBeeGameAssetManifest,
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from './asset-contracts'

const workspaces: string[] = []

afterEach(async () => {
  for (const workspace of workspaces.splice(0))
    await rm(workspace, { recursive: true, force: true })
})

function manifest(fulfills: string[] = ['req-model']): BeeGameAssetManifest {
  return {
    version: 9,
    project_target: {
      asset_format_capabilities: ['json'],
      runtime_asset_root: 'assets/runtime',
      generated_asset_root: 'assets/generated',
    },
    requirements: [
      {
        id: 'req-model',
        required: true,
        acquisition_profile: {
          dimensions: ['agnostic'],
          asset_kinds: ['data'],
          usage_tags: [],
          capabilities: [],
          styles: [],
        },
      },
    ],
    resources: [
      {
        id: 'res-model',
        fulfills,
        source: {
          type: 'agent-authored',
          created_at: '2026-09-15T00:00:00.000Z',
          reason: 'test fixture',
        },
        root_path: 'assets/runtime/model.json',
        file_paths: ['assets/runtime/model.json'],
        provisional: false,
        status: 'verified',
        selected_at: '2026-09-15T00:00:00.000Z',
        selection_reason: ['Matches the requirement.'],
        dimension: 'agnostic',
        asset_kind: 'data',
      },
    ],
  }
}

async function writeFixture(value: BeeGameAssetManifest): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-audit-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
  await writeFile(join(workspace, 'assets/runtime/model.json'), '{}\n')
  await writeBeeGameAssetManifest(workspace, value)
  return workspace
}

describe('Manifest-owned resource bindings', () => {
  test('accepts a verified resource that fulfills a current requirement', async () => {
    const workspace = await writeFixture(manifest())

    const audit = auditAssetContract(workspace)

    expect(audit.valid).toBe(true)
    expect(audit.bindings).toEqual([
      { requirementId: 'req-model', resourceIds: ['res-model'] },
    ])
  })

  test('rejects a required requirement without a Manifest binding', async () => {
    const workspace = await writeFixture(manifest([]))

    const audit = auditAssetContract(workspace)

    expect(audit.valid).toBe(false)
    expect(audit.issues.join('\n')).toContain(
      'req-model: Required requirement has no resource binding.',
    )
  })

  test('rejects a resource binding to an unknown requirement', () => {
    expect(() =>
      parseCanonicalBeeGameAssetManifest({
        ...manifest(),
        resources: [{ ...manifest().resources[0], fulfills: ['req-unknown'] }],
      }),
    ).toThrow(/unknown requirement/i)
  })

  test('rejects the removed content_root target field', () => {
    expect(() =>
      parseCanonicalBeeGameAssetManifest({
        ...manifest(),
        project_target: {
          ...manifest().project_target,
          content_root: 'assets/content',
        },
      }),
    ).toThrow(/unknown fields/i)
  })
})
