import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, access, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { uploadBeeGameAsset, readBeeGameAssetManifest, writeBeeGameAssetManifest } from './asset-contracts'
import { validateResourceSelections } from './tilemap-contract'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4f8AAAAASUVORK5CYII=', 'base64')
const image = () => new File([png], 'icons.png', { type: 'image/png' })
const atlas = (suffix = 'json', width = 1) => new File([JSON.stringify({ frames: { play: { frame: { x: 0, y: 0, w: width, h: 1 } } } })], 'icons.' + suffix, { type: 'application/json' })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-upload-')); roots.push(root)
  await writeBeeGameAssetManifest(root, { version: 9, project_target: { asset_format_capabilities: ['png', 'json'],
    runtime_asset_root: 'assets/runtime', generated_asset_root: 'assets/generated', resource_library_usage: 'optional' }, requirements: [], resources: [] })
  return root
}

test('single-file upload remains an additive user resource and cannot overwrite an existing ID', async () => {
  const root = await fixture(), first = await uploadBeeGameAsset(root, 'new-image', image())
  expect(first.resource.file_paths).toEqual([first.path])
  await expect(uploadBeeGameAsset(root, 'new-image', new File(['changed'], 'icons.png'))).rejects.toThrow('already exists')
  expect(await readBeeGameAssetManifest(root)).toEqual(first.manifest)
  expect(Buffer.from(await readFile(join(root, first.path)))).toEqual(png)
})
for (const suffix of ['json', 'atlas.json']) test('grouped atlas upload validates and registers both files: ' + suffix, async () => {
  const root = await fixture(), result = await uploadBeeGameAsset(root, 'new-atlas', [atlas(suffix), image()])
  expect(result.path).toEndWith('/icons.png')
  expect(result.resource.file_paths).toHaveLength(2)
  expect(Object.keys(result.resource.local_file_hashes!)).toHaveLength(2)
  expect(result.resource.asset_kind).toBe('sprite-atlas')
  const issues: string[] = []
  validateResourceSelections(root, result.manifest, { assetRef: 'new-atlas', data: { frame: 'play' } }, issues)
  expect(issues).toEqual([])
})
for (const [name, files] of [
  ['outside bounds', [image(), atlas('json', 2)]],
  ['unmatched metadata', [image(), new File(['{}'], 'other.json')]],
  ['invalid metadata', [image(), new File(['{'], 'icons.json')]],
  ['duplicate filenames', [image(), image()]],
] as const) test('rejects ' + name + ' before any registry/file write', async () => {
  const root = await fixture(), before = await readBeeGameAssetManifest(root)
  await expect(uploadBeeGameAsset(root, 'invalid', files)).rejects.toThrow()
  expect(await readBeeGameAssetManifest(root)).toEqual(before)
  await expect(access(join(root, 'assets/runtime/user-provided/invalid/icons.png'))).rejects.toThrow()
})
test('grouped files and manifest roll back together when persistence fails', async () => {
  const root = await fixture(), before = await readBeeGameAssetManifest(root)
  await expect(uploadBeeGameAsset(root, 'rollback', [image(), atlas()], { persist: async () => { throw Error('offline persistence failure') } })).rejects.toThrow('persistence failure')
  expect(await readBeeGameAssetManifest(root)).toEqual(before)
  for (const name of ['icons.png', 'icons.json']) await expect(access(join(root, 'assets/runtime/user-provided/rollback', name))).rejects.toThrow()
})

test('rejects an upload through a linked runtime directory without writing outside or changing the manifest', async () => {
  const root = await fixture(), before = await readBeeGameAssetManifest(root)
  const outside = await mkdtemp(join(tmpdir(), 'bgs-upload-outside-')); roots.push(outside)
  await symlink(outside, join(root, 'assets/runtime'))
  await expect(uploadBeeGameAsset(root, 'escape', image())).rejects.toThrow('symbolic link')
  expect(await readdir(outside)).toEqual([])
  expect(await readBeeGameAssetManifest(root)).toEqual(before)
})

test('rejects a linked upload file and linked manifest directory without overwriting their targets', async () => {
  const root = await fixture(), before = await readBeeGameAssetManifest(root)
  const outside = await mkdtemp(join(tmpdir(), 'bgs-upload-target-')); roots.push(outside)
  const sentinel = join(outside, 'sentinel.png')
  await writeFile(sentinel, 'preserve')
  const directory = join(root, 'assets/runtime/user-provided/escape')
  await mkdir(directory, {recursive: true})
  await symlink(sentinel, join(directory, 'icons.png'))
  await expect(uploadBeeGameAsset(root, 'escape', image())).rejects.toThrow('symbolic link')
  expect(await readFile(sentinel, 'utf8')).toBe('preserve')
  await rm(join(root, 'assets/manifest'), {recursive: true})
  await symlink(outside, join(root, 'assets/manifest'))
  await expect(writeBeeGameAssetManifest(root, before)).rejects.toThrow('symbolic link')
  expect(await readdir(outside)).toEqual(['sentinel.png'])
})
