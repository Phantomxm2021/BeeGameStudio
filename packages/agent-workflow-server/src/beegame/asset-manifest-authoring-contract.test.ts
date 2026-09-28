import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readBeeGameAssetManifestSync, writeBeeGameAssetManifest } from './asset-contracts'
import { validateResourceDelivery } from './resource-validation-cli'
import {
  assetManifestAuthoringExamples,
  assetSourceAuthoringExamples,
  materializeAssetManifestAuthoringContract,
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

test('materialized contract describes the same modular interface', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'asset-contract-doc-'))
  const path = await materializeAssetManifestAuthoringContract(workspace)
  const text = await Bun.file(join(workspace, path)).text()
  expect(text).toContain('"version": 9')
  expect(text).toContain('assets/manifest/requirements/example.json')
  expect(text).toContain('assets/manifest/resources/example-runtime-data.json')
  expect(text).toContain('local_file_hashes')
  expect(text).toContain('loadable entry **file**')
  expect(text).toContain('bun assets/manifest/check.mjs')
  expect(text).toContain('not an authoring document')
  expect(text).toContain('"pack_version": "1"')
  expect(text).toContain('"retrieved_at": "2026-01-01T00:00:00.000Z"')
  expect((await Bun.file(join(workspace, 'assets/manifest/check.mjs')).text()).startsWith('// Generated validator: run this file')).toBe(true)
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

test('project-local checker matches the host on pass and actionable failure without rewriting assets', async () => {
  workspace = await mkdtemp(join(tmpdir(), 'asset-checker-parity-'))
  await materializeAssetManifestAuthoringContract(workspace)
  const value = assetManifestAuthoringExamples().canonical
  await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
  const asset = join(workspace, 'assets/runtime/example/resource.json')
  await writeFile(asset, '{"original":true}')
  await writeBeeGameAssetManifest(workspace, value)
  const check = async (valid: boolean) => {
    const child = Bun.spawn([process.execPath, 'assets/manifest/check.mjs'], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(child.stdout).text()
    const stderr = await new Response(child.stderr).text()
    expect(stderr).toBe('')
    expect(await child.exited).toBe(valid ? 0 : 1)
    const result = JSON.parse(stdout)
    const host = validateResourceDelivery(workspace)
    expect(result.valid).toBe(host.valid)
    expect(result.issues).toEqual(host.issues)
  }
  await check(true)
  expect(await Bun.file(asset).text()).toBe('{"original":true}')
  await rm(asset)
  await check(false)
})
