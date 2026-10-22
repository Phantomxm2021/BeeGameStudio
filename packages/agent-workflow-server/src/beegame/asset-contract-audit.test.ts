import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { auditAssetContract } from './asset-contract-audit'
import { validateResourceSelections } from './tilemap-contract'
import { editorAtlasPath } from '../../../scene-editor/src/ui-preview/uiAtlas'
import sharp from 'sharp'
import { audioProbeWav } from './workflow-v3/audio-consumption'
import { registerBeeGameLocalResources, readBeeGameAssetManifest, readBeeGameAssetManifestSync, toCanonicalBeeGameAssetManifest } from './asset-contracts'

test('encoded authored audio rejects generic audio type before registration and accepts canonical audio-clip', async () => {
  const root = await mkdtemp(join(tmpdir(),'bgs-audio-kind-')); workspaces.push(root)
  const value=manifest(); value.resources=[]; value.project_target!.asset_format_capabilities=['wav']
  await writeBeeGameAssetManifest(root,value)
  await mkdir(join(root,'assets/runtime'),{recursive:true})
  const path='assets/runtime/tone.wav'
  await writeFile(join(root,path),audioProbeWav(false))
  const input={id:'tone',root_path:path,file_paths:[path],provisional:false,reason:'Synthetic encoded tone',selection_reason:['test'],asset_kind:'audio'}
  await expect(registerBeeGameLocalResources(root,[input])).rejects.toThrow('unsupported audio type audio; use audio-clip')
  expect((await readBeeGameAssetManifest(root)).resources).toHaveLength(0)
  const registered=await registerBeeGameLocalResources(root,[{...input,asset_kind:'audio-clip'}])
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
  expect(toCanonicalBeeGameAssetManifest(loaded)).toMatchObject({ resources: [expect.objectContaining({ asset_kind: 'audio' })] })
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

async function spriteAtlasFixture(metadata: unknown = { frames: { orb: { frame: { x: 0, y: 0, w: 8, h: 8 } } } },
  configure?: (value: BeeGameAssetManifest) => void, metadataSuffix = ".json") {
  const value = manifest(), resource = value.resources[0]!
  value.project_target!.asset_format_capabilities = ['png', 'json']
  value.requirements[0]!.acquisition_profile.asset_kinds = ['sprite']
  resource.asset_kind = 'sprite-atlas'
  resource.root_path = 'assets/runtime/model.png'
  const metadataPath = 'assets/runtime/model' + metadataSuffix
  resource.file_paths = [resource.root_path, metadataPath]
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#fff0' } }).png().toBuffer()
  const json = JSON.stringify(metadata)
  resource.local_file_hashes = {
    [resource.root_path]: createHash('sha256').update(png).digest('hex'),
    [metadataPath]: createHash('sha256').update(json).digest('hex'),
  }
  configure?.(value)
  const workspace = await writeFixture(value)
  await writeFile(join(workspace, 'assets/runtime/model.png'), png)
  await writeFile(join(workspace, metadataPath), json)
  return workspace
}

test.each(['.json', '.atlas.json'])('atlas %s resolves consistently while retaining frame, registration, bounds and hash checks', async suffix => {
  const workspace = await spriteAtlasFixture(undefined, undefined, suffix)
  const value = readBeeGameAssetManifestSync(workspace), resource = value.resources[0]!
  const metadataPath = 'assets/runtime/model' + suffix
  expect(editorAtlasPath(resource, resource.root_path)).toBe(metadataPath)
  const selection = { assetRef: resource.id, data: { frame: 'orb' } }
  const check = (input = selection, manifest = value) => {
    const issues: string[] = []
    validateResourceSelections(workspace, manifest, input, issues)
    return issues
  }
  expect(check()).toEqual([])
  const audit = auditAssetContract(workspace)
  expect(audit.valid, audit.issues.join(' ')).toBe(true)
  expect(audit.resources[0]!.fileEvidence.find(file => file.path === metadataPath)!.facts)
    .toMatchObject({ atlasImage: resource.root_path, namedFrameCount: 1 })
  expect(check({ assetRef: resource.id, data: { frame: 'missing' } }).join(' ')).toContain('Sprite atlas has no frame "missing"')

  const unregistered = structuredClone(value)
  unregistered.resources[0]!.file_paths = [resource.root_path]
  const missing = check(selection, unregistered).join(' ')
  expect(missing).toContain('expected assets/runtime/model.json or assets/runtime/model.atlas.json')
  expect(missing).toContain('Registered JSON files: (none)')
  const explicitIssues: string[] = []
  validateResourceSelections(workspace, unregistered, { assetRef: resource.id, data: { frame: 'orb', atlasMember: metadataPath } }, explicitIssues)
  expect(explicitIssues.join(' ')).toContain('Missing or ambiguous member')

  await writeFile(join(workspace, metadataPath), JSON.stringify({ frames: { orb: { frame: { x: 15, y: 0, w: 8, h: 8 } } } }))
  const invalid = auditAssetContract(workspace)
  expect(invalid.valid).toBe(false)
  expect(invalid.issues.join(' ')).toContain('Atlas frame outside image: orb')
  expect(invalid.issues.join(' ')).toContain('File hash does not match manifest: ' + metadataPath)
})

test('a verified named atlas supplies sprite structure without changing its registered kind', async () => {
  const workspace = await spriteAtlasFixture()
  const audit = auditAssetContract(workspace)
  expect(audit.valid).toBe(true)
  expect(audit.requirements[0]!.structure).toMatchObject({ status: 'passed' })
  expect(audit.requirements[0]!.structure!.observations[0]).toContain('1 named sprite frames verified')
  expect(readBeeGameAssetManifestSync(workspace).resources[0]!.asset_kind).toBe('sprite-atlas')
  expect(readBeeGameAssetManifestSync(workspace).requirements[0]!.acquisition_profile.asset_kinds).toEqual(['sprite'])
})

test.each(['atlas', 'atlas-regions'])('image capability %s consumes registered atlas evidence without changing declarations', async capability => {
  const workspace = await spriteAtlasFixture(undefined, value => {
    const profile = value.requirements[0]!.acquisition_profile
    profile.asset_kinds = ['image']
    if (capability === 'atlas-regions') profile.coverage = [{ asset_kinds: ['image'], capabilities: ['atlas-regions'] }]
    else profile.capabilities = [capability]
    value.resources[0]!.asset_kind = 'image'
    value.resources[0]!.capabilities = [capability]
  })
  const before = JSON.stringify(readBeeGameAssetManifestSync(workspace))
  const audit = auditAssetContract(workspace)
  expect(audit.valid, audit.issues.join(' ')).toBe(true)
  expect(audit.requirements[0]!.structure!.status).toBe('passed')
  const observation = audit.requirements[0]!.structure!.observations.join(' ')
  expect(observation).toContain('1 named sprite frames verified in assets/runtime/model.json against assets/runtime/model.png')
  expect(observation).toContain('runtime use/quality unverified')
  expect(JSON.stringify(readBeeGameAssetManifestSync(workspace))).toBe(before)
})

test.each(['missing metadata', 'missing image hash', 'missing metadata hash', 'bad hash', 'provisional',
  'missing declaration', 'different declaration', 'unsupported root'])('atlas capability retains evidence boundaries: %s', async kind => {
  const workspace = await spriteAtlasFixture(undefined, value => {
    value.requirements[0]!.acquisition_profile.asset_kinds = ['image']
    value.requirements[0]!.acquisition_profile.capabilities = ['atlas']
    const resource = value.resources[0]!
    resource.asset_kind = 'image'; resource.capabilities = ['atlas']
    if (kind === 'missing metadata') {
      resource.file_paths = [resource.root_path]
      delete resource.local_file_hashes!['assets/runtime/model.json']
    }
    if (kind === 'missing image hash') delete resource.local_file_hashes![resource.root_path]
    if (kind === 'missing metadata hash') delete resource.local_file_hashes!['assets/runtime/model.json']
    if (kind === 'bad hash') resource.local_file_hashes!['assets/runtime/model.json'] = '0'.repeat(64)
    if (kind === 'provisional') resource.provisional = true
    if (kind === 'missing declaration') resource.capabilities = []
    if (kind === 'different declaration') resource.capabilities = ['atlas-regions']
    if (kind === 'unsupported root') resource.root_path = 'assets/runtime/model.json'
  })
  const audit = auditAssetContract(workspace)
  const failed = kind === 'missing metadata' || kind === 'bad hash'
  expect(audit.valid).toBe(!failed)
  const structure = audit.requirements[0]!.structure!
  expect(structure.status).toBe(failed ? 'failed' : 'unverified')
  if (kind === 'missing image hash' || kind === 'missing metadata hash')
    expect(structure.observations.join(' ')).toContain('recorded hashes are missing')
  if (kind === 'missing declaration' || kind === 'different declaration')
    expect(structure.observations.join(' ')).toContain('declared coverage incomplete')
})

test.each([
  ['empty atlas', { frames: {} }],
  ['unrecognized metadata', {}],
  ['unsupported rectangles', { frames: { orb: { x: 0, y: 0, w: 8, h: 8 } } }],
  ['overflow', { frames: { orb: { frame: { x: 15, y: 0, w: 8, h: 8 } } } }],
  ['rotated frame', { frames: { orb: { frame: { x: 0, y: 0, w: 8, h: 8 }, rotated: true } } }],
])('sprite compatibility and image atlas capability reject %s even with matching recorded hashes', async (_, metadata) => {
  for (const image of [false, true]) {
    const audit = auditAssetContract(await spriteAtlasFixture(metadata, value => {
      if (!image) return
      value.requirements[0]!.acquisition_profile.asset_kinds = ['image']
      value.requirements[0]!.acquisition_profile.capabilities = ['atlas']
      value.resources[0]!.asset_kind = 'image'; value.resources[0]!.capabilities = ['atlas']
    }))
    expect(audit.valid).toBe(false)
    expect(audit.requirements[0]!.structure!.status).toBe('failed')
    expect(audit.issues.join(' ')).toContain('expected kinds ['+(image ? 'image' : 'sprite')+']')
    expect(audit.issues.join(' ')).toContain('res-model ('+(image ? 'image' : 'sprite-atlas')+')')
  }
})

test('atlas sprite compatibility retains metadata, hash and additional-capability checks', async () => {
  const noMetadata = await spriteAtlasFixture(undefined, value => {
    value.resources[0]!.file_paths.pop()
    delete value.resources[0]!.local_file_hashes!['assets/runtime/model.json']
  })
  expect(auditAssetContract(noMetadata).requirements[0]!.structure!.status).toBe('failed')
  const missingHash = await spriteAtlasFixture(undefined, value => { delete value.resources[0]!.local_file_hashes })
  const missing = auditAssetContract(missingHash).requirements[0]!
  expect(missing.structure!.status).toBe('unverified')
  expect(missing.structure!.observations[0]).toContain('recorded hashes are missing')
  const badHash = await spriteAtlasFixture(undefined, value => { value.resources[0]!.local_file_hashes!['assets/runtime/model.json'] = '0'.repeat(64) })
  expect(auditAssetContract(badHash).requirements[0]!.structure!.status).toBe('failed')
  const alpha = await spriteAtlasFixture(undefined, value => {
    value.requirements[0]!.acquisition_profile.capabilities = ['alpha']
    value.resources[0]!.capabilities = ['alpha']
  })
  expect(auditAssetContract(alpha).requirements[0]!.structure!.status).toBe('unverified')
  const reverse = await spriteAtlasFixture(undefined, value => {
    value.requirements[0]!.acquisition_profile.asset_kinds = ['sprite-atlas']
    value.resources[0]!.asset_kind = 'sprite'
  })
  expect(auditAssetContract(reverse).requirements[0]!.structure!.status).toBe('failed')
})
import {
  parseCanonicalBeeGameAssetManifest,
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from './asset-contracts'

const workspaces: string[] = []

test('resource enum errors expose exact short values or the existing contract without coercion', () => {
  const value = manifest()
  const profile = value.requirements[0]!.acquisition_profile
  Object.assign(profile, { dimensions: ['2d'] })
  const before = JSON.stringify(value)
  expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('requirements[0].acquisition_profile.dimensions')
  expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('Allowed: 2D, 3D, agnostic.')
  expect(JSON.stringify(value)).toBe(before)
  Object.assign(profile, { dimensions: ['2D'], asset_kinds: ['audio'] })
  expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('Use resources.mjs --contract for the exact allowed values.')
  Object.assign(profile, { asset_kinds: ['data'] })
  Object.assign(value.resources[0]!, { dimension: '2d' })
  expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('resources[0].dimension must be a canonical resource dimension (case-sensitive). Allowed: 2D, 3D, agnostic.')
  Object.assign(value.resources[0]!, { dimension: '2D' })
  expect(() => parseCanonicalBeeGameAssetManifest(value)).not.toThrow()
  Object.assign(value.requirements[0]!, { acquisition_profile: null })
  expect(() => parseCanonicalBeeGameAssetManifest(value)).toThrow('acquisition_profile must be an object with dimensions, asset_kinds and styles arrays')
})

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

describe('resource contract boundaries', () => {
  test('uses Manifest bindings and does not require content files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resources-'))
    workspaces.push(workspace)
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
          acquisition_profile: { dimensions: ['agnostic'], asset_kinds: ['data'], usage_tags: [], capabilities: [], styles: [] },
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
      auditAssetContract(workspace),
    ).toMatchObject({
      present: true,
      valid: true,
      requirements: [expect.objectContaining({id:'visual.player'})],
      bindings: [{requirementId:'visual.player',resourceIds:['player-art']}],
      resources: [expect.objectContaining({id:'player-art'})],
    })
  })

  test('rejects the retired assets/content root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resources-'))
    workspaces.push(workspace)
    await mkdir(join(workspace, 'assets/content'), { recursive: true })

    const result = auditAssetContract(workspace)

    expect(result.valid).toBe(false)
    expect(result.issues.join('\n')).toContain('Retired resource content root')
  })

})
