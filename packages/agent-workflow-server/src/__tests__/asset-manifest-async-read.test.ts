import { afterEach, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBeeGameAssetManifest, readBeeGameAssetManifestSync } from '../beegame/asset-contracts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-manifest-read-'))
  roots.push(root)
  await mkdir(join(root, 'assets/manifest/requirements'), { recursive: true })
  await writeFile(join(root, 'assets/asset-manifest.json'), JSON.stringify({ version: 9, modules: { requirements: 'assets/manifest/requirements/test.json', resources: [] } }))
  await writeFile(join(root, 'assets/manifest/requirements/test.json'), JSON.stringify({ requirements: [] }))
  return root
}

it('returns the same validated manifest through async and sync readers', async () => {
  const root = await fixture()
  const expected = readBeeGameAssetManifestSync(root)
  const results = await Promise.all(Array.from({ length: 16 }, () => readBeeGameAssetManifest(root)))
  for (const result of results) expect(result).toEqual(expected)
})

it('does not cache stale modules or skip validation after an edit', async () => {
  const root = await fixture()
  await readBeeGameAssetManifest(root)
  await writeFile(join(root, 'assets/manifest/requirements/test.json'), '{"requirements":[],"unknown":true}')
  await expect(readBeeGameAssetManifest(root)).rejects.toThrow('unknown')
  await writeFile(join(root, 'assets/manifest/requirements/test.json'), '{')
  await expect(readBeeGameAssetManifest(root)).rejects.toThrow('valid JSON')
})

it('matches the empty-manifest behavior only for an absent index', async () => {
  const root = await fixture()
  await rm(join(root, 'assets/manifest/requirements/test.json'))
  await expect(readBeeGameAssetManifest(root)).rejects.toThrow('every registered manifest module')
  await rm(join(root, 'assets/asset-manifest.json'))
  expect(await readBeeGameAssetManifest(root)).toEqual(readBeeGameAssetManifestSync(root))
})
