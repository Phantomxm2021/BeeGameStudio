import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readBeeGameAssetManifestSync, writeBeeGameAssetManifest } from './asset-contracts'
import { auditAssetContract } from './asset-contract-audit'
import {
  assetManifestAuthoringExamples,
  assetSourceAuthoringExamples,
  renderAssetManifestAuthoringContract,
} from './asset-manifest-authoring-contract'

let workspace = ''

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
  workspace = ''
})

test('the visible authoring example is accepted by the host parser', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'asset-contract-example-'))
  const example = assetManifestAuthoringExamples()
  const entries = [
    ['assets/asset-manifest.json', example.index],
    ['assets/manifest/requirements/example.json', example.requirementsModule],
    ['assets/manifest/resources/example-runtime-data.json', example.resourceModule],
  ] as const
  for (const [path, value] of entries) {
    const target = join(workspace, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, JSON.stringify(value), 'utf8')
  }

  const parsed = readBeeGameAssetManifestSync(workspace)
  expect(parsed.requirements).toHaveLength(1)
  expect(parsed.resources).toHaveLength(1)
})

test('rendered contract describes the modular interface and current tool scope', () => {
  const text = renderAssetManifestAuthoringContract()
  expect(text).toContain('"version": 9')
  expect(text).toContain('assets/manifest/requirements/example.json')
  expect(text).toContain('assets/manifest/resources/example-runtime-data.json')
  expect(text).toContain('local_file_hashes')
  expect(text).toContain('loadable entry **file**')
  expect(text).toContain('check-content.mjs --current')
  expect(text).toContain('This command requires a content index.')
  expect(text).toContain('--list only reads saved registration records.')
  expect(text).not.toContain('assets/manifest/check.mjs')
  expect(text).not.toContain('CONTRACT.md')
  expect(text).toContain('"pack_version": "1"')
  expect(text).toContain('"retrieved_at": "2026-01-01T00:00:00.000Z"')
})

test('every documented source example passes the host source validation', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'asset-source-examples-'))
  const example = assetManifestAuthoringExamples()
  await mkdir(join(workspace, 'assets/manifest/requirements'), { recursive: true })
  await mkdir(join(workspace, 'assets/manifest/resources'), { recursive: true })
  await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify(example.index))
  await writeFile(join(workspace, 'assets/manifest/requirements/example.json'), JSON.stringify(example.requirementsModule))
  for (const source of Object.values(assetSourceAuthoringExamples)) {
    await writeFile(join(workspace, 'assets/manifest/resources/example-runtime-data.json'),
      JSON.stringify({ ...example.resourceModule, source }))
    expect(readBeeGameAssetManifestSync(workspace).resources[0]?.source).toEqual(source)
  }
})

test('production asset audit checks real bytes without rewriting the registry or assets', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'asset-checker-parity-'))
  const value = assetManifestAuthoringExamples().canonical
  await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
  const asset = join(workspace, 'assets/runtime/example/resource.json')
  await writeFile(asset, '{"original":true}')
  await writeBeeGameAssetManifest(workspace, value)
  const index = JSON.parse(await readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8'))
  const registryFiles: string[] = ['assets/asset-manifest.json', index.modules.requirements, ...index.modules.resources]
  const check = async (valid: boolean) => {
    const before = await Promise.all(registryFiles.map(path => readFile(join(workspace, path), 'utf8')))
    const result = auditAssetContract(workspace)
    expect(result.present).toBe(true)
    expect(result.valid).toBe(valid)
    if (!valid) expect(result.issues.join(' ')).toContain('assets/runtime/example/resource.json')
    expect(await Promise.all(registryFiles.map(path => readFile(join(workspace, path), 'utf8')))).toEqual(before)
  }
  await check(true)
  expect(await Bun.file(asset).text()).toBe('{"original":true}')
  await rm(asset)
  await check(false)
  expect(await Bun.file(asset).exists()).toBe(false)
})
