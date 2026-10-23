import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { readBeeGameAssetManifestModulePathsSync, writeBeeGameAssetManifest } from '../asset-contracts'
import { artifactDigest } from '../runtime-acceptance'
import { buildEditableProject, projectFiles } from './editable-project'
import { measurementSummary } from './agent-measurement'
import { staticArtifactFiles } from './runtime-checks'
import { digest, type AgentMeasurement } from './state'

// Synthetic build scripts only; no native Agent, image/audio service or browser.
const buildStart = `import {cp,mkdir,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
async function copy(path){await mkdir(dirname('dist/'+path),{recursive:true});await cp(path,'dist/'+path,{recursive:true})}
await copy('index.html');`
const task = { editableProject: true as const, runtimeArtifact: 'dist', writablePaths: ['dist/**'] }
async function fixture(script: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-package-composition-')))
  const save = async (path: string, data: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), data)
  }
  await save('package.json', JSON.stringify({ scripts: { build: 'bun build.mjs' } }))
  await save('build.mjs', buildStart + script)
  await save('index.html', '<html><body>Offline package fixture</body></html>')
  return { root, save, close: () => rm(root, { recursive: true, force: true }) }
}

test.each(['broad-copy', 'selected-files'] as const)('package composition measures actual full build: %s', async mode => {
  const f = await fixture(mode === 'broad-copy' ? `await copy('assets');await copy('content');` : `
const index=JSON.parse(await readFile('assets/asset-manifest.json','utf8'));
await copy('assets/asset-manifest.json');await copy(index.modules.requirements);
for(const path of index.modules.resources){await copy(path);const r=JSON.parse(await readFile(path,'utf8'));
for(const file of new Set([...r.file_paths,...(r.dependencies??[]).map(d=>d.local_path)]))await copy(file)}
await copy('content/index.json');const content=JSON.parse(await readFile('content/index.json','utf8'));
for(const file of content.files)await copy('content/'+file);await copy('assets/licenses/NOTICE.txt');`)
  try {
    const runtime = ['assets/runtime/sheet.png', 'assets/runtime/sheet.json', 'assets/runtime/on-demand.wav', 'assets/source/needed.png']
    await f.save(runtime[0]!, 'synthetic-pixel-bytes')
    await f.save(runtime[1]!, '{"frames":{"play":{"x":0,"y":0,"w":1,"h":1}}}')
    await f.save(runtime[2]!, 'synthetic-audio-bytes')
    await f.save(runtime[3]!, 'registered-source-is-runtime')
    await f.save('assets/source/original.png', 'synthetic-pixel-bytes')
    await f.save('assets/source/frames/crop.png', 'synthetic-pixel-bytes')
    await f.save('assets/visual/ui-board.png', 'reference-only')
    await f.save('assets/licenses/NOTICE.txt', 'synthetic required license')
    // No Scene/UI assetRefs: dynamic resources must not be pruned by that subset.
    await f.save('content/index.json', JSON.stringify({ files: ['ui/menu.json'] }))
    await f.save('content/ui/menu.json', JSON.stringify({ assetRefs: [] }))
    const manifest = assetManifestAuthoringExamples().canonical
    delete manifest.project_target
    manifest.requirements = []
    manifest.resources = [{ ...manifest.resources[0]!, id: 'runtime', fulfills: [],
      root_path: runtime[0]!, file_paths: runtime, dependencies: [{ key: 'atlas', parent_key: 'sheet',
        element_id: 'play', element_path: 'frames.play', reference_path: 'sheet.json', local_path: runtime[1]!, kind: 'atlas' }] }]
    await writeBeeGameAssetManifest(f.root, manifest)
    const before = await projectFiles(f.root, 'dist', [])
    const check = await buildEditableProject(f.root, task, [], [])
    expect(check.status, check.observation).toBe('passed')
    const report = check.projectBuild!.packageComposition!
    const actual = await staticArtifactFiles(f.root, 'dist')
    const actualBytes = await Promise.all(actual.map(async path => (await readFile(join(f.root, path))).length))
    expect(report.fileCount).toBe(actual.length)
    expect(report.totalBytes).toBe(actualBytes.reduce((a, b) => a + b, 0))
    expect(report.artifact).toEqual({ path: 'dist', sha256: await artifactDigest(f.root, 'dist', true) })
    expect(report.directories.reduce((n, d) => n + d.bytes, 0)).toBe(report.totalBytes)
    expect(report.fileTypes.reduce((n, d) => n + d.fileCount, 0)).toBe(report.fileCount)
    expect(report.largestFiles).toHaveLength(Math.min(10, actual.length))
    expect(report.largestFiles[0]!.bytes).toBe(Math.max(...actualBytes))
    expect(report.productionMaterials.status).toBe('manifest-read')
    for (const path of [...runtime, ...readBeeGameAssetManifestModulePathsSync(f.root),
      'content/index.json', 'content/ui/menu.json', 'assets/licenses/NOTICE.txt']) expect(actual).toContain('dist/' + path)
    expect(report.productionMaterials.candidates!.map(file => file.path)).toEqual(mode === 'broad-copy' ? [
      'assets/source/frames/crop.png', 'assets/source/original.png', 'assets/visual/ui-board.png',
    ] : [])
    const repeated = Buffer.byteLength('synthetic-pixel-bytes')
    expect(report.duplicateBytes).toBe(mode === 'broad-copy' ? repeated * 2 : 0)
    expect(report.duplicates).toEqual(mode === 'broad-copy' ? [{ sha256: digest('synthetic-pixel-bytes'),
      bytesPerFile: repeated, duplicateBytes: repeated * 2,
      paths: ['assets/runtime/sheet.png', 'assets/source/frames/crop.png', 'assets/source/original.png'] }] : [])
    expect(await projectFiles(f.root, 'dist', [])).toEqual(before)

    const record: AgentMeasurement = { id: 'synthetic', requestKey: 'test', runtimeArtifact: 'dist',
      reportPaths: [], reports: [], requirementsRevision: 'test', startedAt: new Date().toISOString(), checks: [check] }
    for (const details of [false, true]) {
      expect(measurementSummary(record, details).packageComposition).toEqual(report)
      expect(measurementSummary(record, details).quality).toBe('unverified')
    }
    const legacy = structuredClone(record)
    delete legacy.checks[0]!.projectBuild!.packageComposition
    expect(measurementSummary(legacy).packageComposition).toBeNull()
  } finally { await f.close() }
}, 30000)

test.each(['missing', 'invalid'] as const)('package classification stays unverified with %s Manifest', async mode => {
  const f = await fixture(`await copy('assets');`)
  try {
    await f.save('assets/source/original.png', 'unclassified production material')
    if (mode === 'invalid') await f.save('assets/asset-manifest.json', '{broken')
    const check = await buildEditableProject(f.root, task, [], [])
    expect(check.status, check.observation).toBe('passed')
    expect(check.projectBuild!.packageComposition!.fileCount).toBe(mode === 'invalid' ? 3 : 2)
    expect(check.projectBuild!.packageComposition!.productionMaterials).toMatchObject({ status: 'unverified', candidates: null })
  } finally { await f.close() }
}, 30000)
