import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import sharp from 'sharp'
import { audioProbeWav } from './workflow-v3/audio-consumption'
import { registerBeeGameAuthoredResources, readBeeGameAssetManifest, readBeeGameAssetManifestSync, toCanonicalBeeGameAssetManifest } from './asset-contracts'

test('encoded authored audio rejects generic audio type before registration and accepts canonical audio-clip', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-audio-kind-')); workspaces.push(root)
  const value=manifest(); value.resources=[]; value.project_target!.asset_format_capabilities=['wav']
  await writeBeeGameAssetManifest(root,value)
  await mkdir(join(root,'assets/runtime'),{recursive:true})
  const path='assets/runtime/tone.wav'
  await writeFile(join(root,path),audioProbeWav(false))
  const input={id:'tone',root_path:path,file_paths:[path],provisional:false,reason:'Synthetic encoded tone',selection_reason:['test'],asset_kind:'audio'}
  await expect(registerBeeGameAuthoredResources(root,[input])).rejects.toThrow('unsupported audio type audio; use audio-clip')
  expect((await readBeeGameAssetManifest(root)).resources).toHaveLength(0)
  const registered=await registerBeeGameAuthoredResources(root,[{...input,asset_kind:'audio-clip'}])
  expect(registered.resources[0]!.asset_kind).toBe('audio-clip')
  expect(registered.resources[0]!.status).toBe('verified')
  const invalid=structuredClone(registered); invalid.resources[0]!.asset_kind='audio'
  expect(parseCanonicalBeeGameAssetManifest(invalid).resources[0]!.asset_kind).toBe('audio')
  for (const kind of [undefined, 'audio-unknown']) {
    invalid.resources[0]!.asset_kind = kind
    expect(()=>parseCanonicalBeeGameAssetManifest(invalid)).toThrow('unsupported audio type')
  }
  invalid.resources[0]!.asset_kind='music'
  expect(parseCanonicalBeeGameAssetManifest(invalid).resources[0]!.asset_kind).toBe('music')
  const composite=manifest()
  composite.resources[0]!.asset_kind='data'
  composite.resources[0]!.file_paths.push('assets/runtime/embedded.wav')
  expect(parseCanonicalBeeGameAssetManifest(composite).resources[0]!.asset_kind).toBe('data')
})

test('reads legacy encoded audio without rewriting the manifest or relaxing new registration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-legacy-audio-')); workspaces.push(root)
  const value = manifest()
  const resource = value.resources[0]!
  resource.asset_kind = 'audio-clip'
  resource.root_path = 'assets/runtime/tone.wav'
  resource.file_paths = [resource.root_path]
  await writeBeeGameAssetManifest(root, value)
  const indexPath = join(root, 'assets/asset-manifest.json')
  const indexBefore = await readFile(indexPath, 'utf8')
  const modulePath = join(root, JSON.parse(indexBefore).modules.resources[0])
  const legacy = JSON.parse(await readFile(modulePath, 'utf8'))
  legacy.asset_kind = 'audio'
  const moduleBefore = JSON.stringify(legacy)
  await writeFile(modulePath, moduleBefore)

  const loaded = await readBeeGameAssetManifest(root)
  expect(loaded.resources[0]!.asset_kind).toBe('audio')
  expect(readBeeGameAssetManifestSync(root)).toEqual(loaded)
  expect(toCanonicalBeeGameAssetManifest(loaded).resources[0]!.asset_kind).toBe('audio')
  expect(await readFile(indexPath, 'utf8')).toBe(indexBefore)
  expect(await readFile(modulePath, 'utf8')).toBe(moduleBefore)
  legacy.root_path = 'assets/runtime/tone.json'
  legacy.file_paths = [legacy.root_path]
  expect(() => parseCanonicalBeeGameAssetManifest({ ...loaded, resources: [legacy] })).toThrow('unsupported audio type audio')
})

test('rejects editor-incompatible atlas rectangles and actual PNG overflow at resource acceptance', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'atlas-contract-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
  const value = manifest()
  const resource = value.resources[0]!
  resource.file_paths.push('assets/runtime/model.png')
  await writeBeeGameAssetManifest(workspace, value)
  await writeFile(join(workspace, 'assets/runtime/model.png'), await sharp({ create: {
    width: 256, height: 256, channels: 4, background: '#fff',
  } }).png().toBuffer())
  const sidecar = join(workspace, 'assets/runtime/model.json')
  await writeFile(sidecar, JSON.stringify({ frames: { panel_tl: { x: 2, y: 2, w: 16, h: 16 } } }))
  expect(auditAssetContract(workspace).issues.join(' ')).toContain('Invalid sprite atlas rectangle: panel_tl')
  await writeFile(sidecar, JSON.stringify({ frames: { big_morph_05: { frame: { x: 1, y: 217, w: 24, h: 52 } } } }))
  expect(auditAssetContract(workspace).issues.join(' ')).toContain('Atlas frame outside image: big_morph_05')
  await writeFile(sidecar, JSON.stringify({ frames: { idle: { frame: { x: 1, y: 1, w: 24, h: 52 } } } }))
  expect(auditAssetContract(workspace).valid).toBe(true)
})

test('rejects a PNG with a valid header but broken pixel stream', async () => {
  const value = manifest()
  value.resources[0]!.file_paths.push('assets/runtime/model.png')
  const workspace = await writeFixture(value)
  const pngPath = join(workspace, 'assets/runtime/model.png')
  const png = await sharp({ create: {
    width: 16, height: 16, channels: 4, background: '#fff',
  } }).png().toBuffer()
  await writeFile(pngPath, png)
  expect(auditAssetContract(workspace).valid).toBe(true)

  const broken = Buffer.from(png)
  const idat = broken.indexOf(Buffer.from('IDAT'))
  expect(idat).toBeGreaterThan(0)
  broken.fill(0, idat + 4, idat + 8)
  await writeFile(pngPath, broken)
  const audit = auditAssetContract(workspace)
  expect(audit.valid).toBe(false)
  expect(audit.issues.join('\n')).toContain('PNG pixel stream cannot be decoded')
})
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
