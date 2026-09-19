import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import {
  parseCanonicalBeeGameAssetManifest,
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from './asset-contracts'

const workspaces: string[] = []

test('encoded ambience accepts JSON sidecars but JSON-only synthesis remains provisional', () => {
  const value = manifest()
  const resource = value.resources[0]!
  resource.asset_kind = 'ambience'
  resource.root_path = 'assets/runtime/owls.ogg'
  resource.file_paths = [resource.root_path, 'assets/runtime/owls.json']
  expect(() => parseCanonicalBeeGameAssetManifest(value)).not.toThrow()
  resource.root_path = 'assets/runtime/owls.json'
  resource.file_paths = [resource.root_path]
  expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('programmatic audio')
  resource.asset_kind = 'audio-bank'
  resource.provisional = true
  expect(() => parseCanonicalBeeGameAssetManifest(value)).not.toThrow()
  resource.file_paths.push('assets/runtime/script.js')
  expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow()
})

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
  test('accepts descriptive vocabulary and preserves resource/source annotations', async () => {
    const value = manifest()
    value.requirements[0]!.acquisition_profile.usage_tags = ['world', 'gameplay', 'custom-harbor']
    value.requirements[0]!.acquisition_profile.capabilities = ['texturepacker-array-json']
    const resource = { ...value.resources[0]!, usage_tags: ['user-defined'], capabilities: ['my-format'],
      notes: 'Independent art notes', source: { ...value.resources[0]!.source, toolchain: 'Pillow' } }
    value.resources = [resource]
    expect(parseCanonicalBeeGameAssetManifest(value).resources[0]).toMatchObject({ notes: 'Independent art notes', source: { toolchain: 'Pillow' } })
    expect(auditAssetContract(await writeFixture(value)).valid).toBe(true)
  })

  test('does not treat an unconsumed hash spelling as verified integrity', () => {
    const value = manifest()
    value.resources = [{ ...value.resources[0]!, hashes: { sha256: {} } } as never]
    expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('use local_file_hashes')
  })

  test('retains real entry-file and integrity checks', async () => {
    const value = manifest()
    value.resources[0]!.root_path = 'assets/runtime'
    expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('root_path must be listed')
    value.resources[0]!.root_path = 'assets/runtime/model.json'
    value.resources[0]!.local_file_hashes = { 'assets/runtime/model.json': '0'.repeat(64) }
    const workspace = await writeFixture(value)
    expect(auditAssetContract(workspace).issues.join('\n')).toContain('hash does not match')
    await rm(join(workspace, 'assets/runtime/model.json'))
    expect(auditAssetContract(workspace).issues.join('\n')).toContain('File does not exist')
  })

  test('rejects symlinked resource files escaping the project', async () => {
    const workspace = await writeFixture(manifest())
    const outside = await mkdtemp(join(tmpdir(), 'beegame-outside-'))
    workspaces.push(outside)
    await writeFile(join(outside, 'data.json'), '{}')
    await rm(join(workspace, 'assets/runtime/model.json'))
    await symlink(join(outside, 'data.json'), join(workspace, 'assets/runtime/model.json'))
    expect(auditAssetContract(workspace).issues.join('\n')).toContain('escapes the project')
  })
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
