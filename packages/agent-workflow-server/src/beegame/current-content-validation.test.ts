import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { runGameContentCommand } from './game-content-validation-cli'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { readBeeGameAssetManifestSync, writeBeeGameAssetManifest } from './asset-contracts'
import { sceneLayoutFixture, uiLayoutFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { projectContentAuthority } from './project-content-authority'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import { CONTENT_CHECKER_ENTRY, CURRENT_CONTENT_CHECKER_ENTRY, sharedContentChecker } from './content-checker-runtime'
import { readContentView } from './workflow-v3/content-view'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-current-package-')); roots.push(root)
  await mkdir(join(root, 'content/scenes'), { recursive: true })
  await mkdir(join(root, 'content/ui'), { recursive: true })
  await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
  const manifest = assetManifestAuthoringExamples().canonical
  const member = manifest.resources[0]!.file_paths[0]!
  await writeFile(join(root, member), '{}')
  manifest.resources[0]!.local_file_hashes = { [member]: hash('{}') }
  await writeBeeGameAssetManifest(root, manifest)
  const index = { schema: 'beegame-content-package.v2', id: 'synthetic', dimension: '2d',
    sceneModel: 'game-object-v2', entryScene: 'level', files: ['scenes/level.json', 'ui/menu.json'],
    documentRevision: hash('saved compatibility tag, not a design approval'),
    assetManifestRevision: hash(JSON.stringify(readBeeGameAssetManifestSync(root))) }
  await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
  await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
  await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture()))
  return { root, index, manifest, member }
}

test('first index metadata is read-only, explicit and consumable without a legacy design release', async () => {
  const { root, index, manifest } = await fixture()
  await rm(join(root, 'content/index.json'))
  const operands = ['content/scenes/level.json', 'content/ui/menu.json']
  const saved = await Promise.all(operands.map(path => readFile(join(root, path))))
  const metadata = runGameContentCommand(root, ['--package-metadata', ...operands]) as any
  expect(metadata).toMatchObject({ scope: 'current-package-metadata', valid: true, designVerified: false, runtimeVerified: false })
  expect(metadata.inputs.map((item: any) => [item.path, item.sha256, item.bytes])).toEqual(
    operands.map((path, i) => [path, hash(saved[i]!), saved[i]!.length]))
  expect(metadata.indexMetadata.assetManifestRevision).toBe(index.assetManifestRevision)
  expect(metadata.indexMetadata.documentRevision).toBe(hash(JSON.stringify(operands.map((path, i) => [path, hash(saved[i]!)]))))
  expect((runGameContentCommand(root, ['--package-metadata', ...operands.toReversed(), operands[0]!]) as any).indexMetadata).toEqual(metadata.indexMetadata)
  await expect(access(join(root, 'content/index.json'))).rejects.toThrow()
  await expect(access(join(root, 'docs'))).rejects.toThrow()
  await expect(access(join(root, '.beegame/design-handoffs'))).rejects.toThrow()
  expect((runGameContentCommand(root, ['--current']) as any).issues.join(' ')).toContain('--package-metadata')
  expect(JSON.stringify(runGameContentCommand(root, ['--format', 'index']))).toContain('--package-metadata')
  // The author, not the metadata helper, chooses this actual registry.
  await writeFile(join(root, 'content/index.json'), JSON.stringify({ ...index, ...metadata.indexMetadata,
    documents: [{ id: 'level', kind: 'scene-2d', path: 'scenes/level.json', loadPhase: 'startup' },
      { id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'on-demand' }] }))
  const registered = runGameContentCommand(root, ['--current']) as any
  expect(Boolean(registered.valid), String(registered.issues.join(' '))).toBe(true)
  const view = await readContentView(root)
  expect(view.state).toBe('draft')
  if (view.state === 'draft') expect(view.documents).toHaveLength(2)
  expect((runGameContentCommand(root) as any).valid).toBe(false)
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs/DESIGN.md'), '# Combined decisions\nNo runtime change.\n')
  expect((runGameContentCommand(root, ['--package-metadata', ...operands]) as any).indexMetadata).toEqual(metadata.indexMetadata)
  const changed = uiLayoutFixture(); changed.data.nodes[1]!.actions = { click: 'changed' }
  await writeFile(join(root, operands[1]!), JSON.stringify(changed))
  expect((runGameContentCommand(root, ['--package-metadata', ...operands]) as any).indexMetadata.documentRevision).not.toBe(metadata.indexMetadata.documentRevision)
  await writeFile(join(root, operands[1]!), saved[1]!)
  manifest.resources[0]!.selection_reason = ['Different actual resource decision']
  await writeBeeGameAssetManifest(root, manifest)
  expect((runGameContentCommand(root, ['--package-metadata', ...operands]) as any).indexMetadata.assetManifestRevision).not.toBe(metadata.indexMetadata.assetManifestRevision)
  manifest.resources[0]!.selection_reason = assetManifestAuthoringExamples().canonical.resources[0]!.selection_reason
  await writeBeeGameAssetManifest(root, manifest)
  // Listing selected inputs is not proof of complete package coverage.
  const extra = { ...uiLayoutFixture(), id: 'unregistered' }
  await writeFile(join(root, 'content/ui/unregistered.json'), JSON.stringify(extra))
  expect((runGameContentCommand(root, ['--package-metadata', ...operands]) as any).valid).toBe(true)
  const incomplete = runGameContentCommand(root, ['--current']) as any
  expect(incomplete.valid).toBe(false)
  expect(incomplete.issues.join(' ')).toContain('unregistered.json')
  expect(await readFile(join(root, operands[0]!))).toEqual(saved[0]!)
})

test('first-index metadata rejects missing, unsafe or invalid operands and never returns partial hashes as success', async () => {
  const { root } = await fixture()
  const metadata = (...args: string[]) => runGameContentCommand(root, ['--package-metadata', ...args]) as any
  expect(() => metadata()).toThrow('Usage: --package-metadata')
  expect(() => metadata('--current')).toThrow('Usage: --package-metadata')
  for (const path of ['content/ui/missing.json', 'content/index.json', '../content/ui/menu.json',
    'content/ui/../ui/menu.json', join(root, 'content/ui/menu.json'), 'public/content/ui/menu.json']) {
    const result = metadata('content/scenes/level.json', path)
    expect(result.valid, path).toBe(false)
    expect(result.indexMetadata, path).toBeUndefined()
    expect(result.designVerified).toBe(false)
  }
  await writeFile(join(root, 'content/ui/bad.json'), '{')
  expect(metadata('content/ui/bad.json')).toMatchObject({ valid: false })
  await writeFile(join(root, 'content/ui/duplicate.json'), await readFile(join(root, 'content/ui/menu.json')))
  expect(metadata('content/ui/menu.json', 'content/ui/duplicate.json').issues.join(' ')).toContain('Duplicate document id')
  await symlink(join(root, 'content/ui/menu.json'), join(root, 'content/ui/alias.json'))
  expect(metadata('content/ui/alias.json').issues.join(' ')).toContain('symlinks')
  const before = await readFile(join(root, 'content/index.json'))
  await writeFile(join(root, 'assets/asset-manifest.json'), '{invalid')
  const badManifest = metadata('content/ui/menu.json')
  expect(badManifest.valid).toBe(false)
  expect(badManifest.indexMetadata).toBeUndefined()
  expect(badManifest.issues.join(' ')).toContain('Asset Manifest')
  expect(await readFile(join(root, 'content/index.json'))).toEqual(before)
})

test('current package needs real content/resources but no eight-document release; does not create one', async () => {
  const { root, index } = await fixture()
  await initializeUiLayout()
  const before = await readFile(join(root, 'content/index.json'), 'utf8')
  const current = runGameContentCommand(root, ['--current']) as any
  expect(current).toMatchObject({ valid: true, runtimeVerified: false, designVerified: false, contentCount: 2 })
  expect(current.authority).toBeUndefined()
  expect(current.registry.assetManifestRevision).toBe(index.assetManifestRevision)
  expect(current.inputLocation.sources.map((item: any) => item.path)).toEqual(['content/index.json', 'content/scenes/level.json', 'content/ui/menu.json'])
  expect(current.note).toContain('NOT a verified design baseline')
  expect(runGameContentCommand(root)).toMatchObject({ valid: false }) // compatibility entry still requires real documents
  await expect(access(join(root, 'docs'))).rejects.toThrow()
  await expect(access(join(root, '.beegame/design-handoffs'))).rejects.toThrow()
  expect(await readFile(join(root, 'content/index.json'), 'utf8')).toBe(before)
  await mkdir(join(root, 'assets/manifest'), { recursive: true })
  await writeFile(join(root, 'assets/asset-manifest.json'), '{invalid registry')
  expect(runGameContentCommand(root, ['--current'])).toMatchObject({ valid: false })
})

test('prose revision does not churn autonomous runtime metadata; legacy baseline still detects it', async () => {
  const { root, index } = await fixture()
  await writeDesignDocumentsFixture(root)
  index.documentRevision = projectContentAuthority(root).documentRevision
  await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
  expect((runGameContentCommand(root) as any).valid).toBe(true)
  const before = await readFile(join(root, 'content/index.json'), 'utf8')
  const doc = join(root, 'docs/UI_UX_SPEC.md')
  await writeFile(doc, (await readFile(doc, 'utf8')) + '\nClarify a test limitation; no runtime data changed.\n')
  expect((runGameContentCommand(root, ['--current']) as any).valid).toBe(true)
  expect((runGameContentCommand(root) as any).issues.join(' ')).toContain('documentRevision does not match authority')
  expect(await readFile(join(root, 'content/index.json'), 'utf8')).toBe(before)
})

test('current preflight retains actual registry, member integrity and geometry failures, never silently repairs', async () => {
  const { root, manifest, member } = await fixture()
  await initializeUiLayout()
  const before = await readFile(join(root, 'content/index.json'), 'utf8')
  manifest.resources[0]!.selection_reason = ['Changed real resource choice']
  await writeBeeGameAssetManifest(root, manifest)
  const changed = runGameContentCommand(root, ['--current']) as any
  expect(changed.valid).toBe(false)
  expect(changed.issues.join(' ')).toContain('assetManifestRevision differs')
  expect(changed.issues.join(' ')).not.toContain('--authority')
  expect(changed.registry.assetManifestRevision).not.toBe(JSON.parse(before).assetManifestRevision)
  const index = { ...JSON.parse(before), assetManifestRevision: changed.registry.assetManifestRevision }
  await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
  await writeFile(join(root, member), '{"changed":true}')
  expect((runGameContentCommand(root, ['--current']) as any).issues.join(' ')).toContain('File hash does not match manifest')
  await writeFile(join(root, member), '{}')
  const ui = uiLayoutFixture(); (ui.data.nodes[1]!.layout as any).position = [4000, 0]
  await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
  const overflow = runGameContentCommand(root, ['--current']) as any
  expect(overflow.valid).toBe(false)
  expect(overflow.issues.join(' ')).toContain('outside the viewport')
  expect(overflow.runtimeVerified).toBe(false)
  await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture()))
  const scene = sceneLayoutFixture() as any; scene.assetRefs = ['missing-resource']
  await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(scene))
  expect((runGameContentCommand(root, ['--current']) as any).valid).toBe(false)
  expect(await readFile(join(root, 'content/index.json'), 'utf8')).toBe(JSON.stringify(index))
})

test('missing/malformed indexes, malformed registry and an escaped index remain failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-current-invalid-')); roots.push(root)
  expect(runGameContentCommand(root, ['--current'])).toMatchObject({ valid: false })
  await mkdir(join(root, 'content'))
  await writeFile(join(root, 'content/index.json'), '{')
  expect(runGameContentCommand(root, ['--current'])).toMatchObject({ valid: false })
  const { root: valid } = await fixture()
  const external = await mkdtemp(join(tmpdir(), 'bgs-current-external-')); roots.push(external)
  await writeFile(join(external, 'index.json'), await readFile(join(valid, 'content/index.json')))
  await rm(join(valid, 'content/index.json'))
  await symlink(join(external, 'index.json'), join(valid, 'content/index.json'))
  expect((runGameContentCommand(valid, ['--current']) as any).issues.join(' ')).toContain('inside the project')
})

test('published autonomous default works without docs; explicit legacy and ordinary delivery defaults stay strict', async () => {
  const { root, index } = await fixture()
  const module = await sharedContentChecker()
  await writeFile(join(root, 'current.mjs'), CURRENT_CONTENT_CHECKER_ENTRY)
  await writeFile(join(root, 'legacy.mjs'), CONTENT_CHECKER_ENTRY)
  const run = async (entry: string, args: string[] = []) => {
    const child = Bun.spawn([process.execPath, entry, ...args], { cwd: root,
      env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: module.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, out, err }
  }
  await rm(join(root, 'content/index.json'))
  const first = await run('current.mjs', ['--package-metadata', 'content/scenes/level.json', 'content/ui/menu.json'])
  expect(first.code, first.out + first.err).toBe(0)
  const metadata = JSON.parse(first.out)
  expect(metadata).toMatchObject({ scope: 'current-package-metadata', designVerified: false, runtimeVerified: false })
  await expect(access(join(root, 'content/index.json'))).rejects.toThrow()
  await writeFile(join(root, 'content/index.json'), JSON.stringify({ ...index, ...metadata.indexMetadata }))
  for (const args of [[], [root], ['--current']]) {
    const result = await run('current.mjs', args)
    expect(result.code, result.out + result.err).toBe(0)
    expect(JSON.parse(result.out)).toMatchObject({ valid: true, designVerified: false, runtimeVerified: false })
  }
  expect((await run('current.mjs', ['--authority'])).code).toBe(1)
  expect((await run('legacy.mjs')).code).toBe(1)
  expect((await run('current.mjs', ['--help'])).out).toContain('V3 autonomous entry defaults to --current')
}, 30000)
