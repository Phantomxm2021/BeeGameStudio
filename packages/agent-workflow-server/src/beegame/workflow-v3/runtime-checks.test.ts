import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, cp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { taskSchema, type TaskSpec } from './state'
import { checkIsCurrent } from './checks'
import { runChecks } from './checker-test-driver'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { observeStaticBuild, observeStaticPublication } from './runtime-checks'
import { readVersion } from './checks'
import type { CheckResult } from './state'

export const artifactTask: TaskSpec = { id: 'verify', kind: 'game.verify', goal: 'Check current static package', dependsOn: [], requirementIds: ['req.loop'], inputs: [],
  writablePaths: [], expectedOutputs: ['dist/index.html'], checks: ['delivery-package'], runtimeArtifact: 'dist' }

test.each([
  ['absolute-button', '<button style="position:absolute;left:50px;top:50px">Play</button>', 'passed'],
  ['absolute-canvas', '<canvas width="100" height="80" style="position:absolute;left:50px;top:50px"></canvas>', 'passed'],
  ['hidden-button', '<button style="position:absolute;display:none">Play</button>', 'unverified'],
  ['transparent-parent', '<div style="opacity:0"><button style="position:absolute">Play</button></div>', 'unverified'],
  ['outside-viewport', '<button style="position:absolute;left:2000px;top:50px">Play</button>', 'unverified'],
  ['blank-flow', '<div style="height:200px"></div>', 'unverified'],
  ['text-with-script', 'Visible text<script>void 0</script>', 'passed'],
] as const)('static smoke observes actual surface rather than body flow: %s',async(_name,html,expected)=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-surface-'))
  try {
    await mkdir(join(root,'dist'))
    await writeFile(join(root,'dist/index.html'),'<!doctype html><body style="margin:0">'+html+'</body>')
    const check=(await runChecks(root,{...artifactTask,checks:['runtime-smoke']},[])).checks[0]!
    expect(check.status,check.observation).toBe(expected)
    expect(JSON.parse(check.observation).surfacePresent).toBe(expected==='passed')
    expect(await checkIsCurrent(root,{...check,version:'v3-static-artifact.1'})).toBe(false)
  }finally{await rm(root,{recursive:true,force:true})}
},30000)

test('Preview smoke observes opaque-origin storage/Canvas failures without changing standalone publication semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-preview-smoke-'))
  try {
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'dist/pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')
    const check = () => runChecks(root, { ...artifactTask, checks: ['runtime-smoke'] }, []).then(result => result.checks[0]!)
    await writeFile(join(root, 'dist/index.html'), '<button>Play</button><script>localStorage.setItem("fixture","1")</script>')
    const storage = await check()
    expect(storage.status, storage.observation).toBe('failed')
    expect(JSON.parse(storage.observation).environment).toMatchObject({ embedding: 'sandboxed-iframe', origin: 'null' })
    await observeStaticPublication(root, 'dist', 'http://publication.invalid/nested/index.html')
    for (const crossOrigin of [false, true]) {
      await writeFile(join(root, 'dist/index.html'), '<button>Play</button><script>const image=new Image();' +
        (crossOrigin ? 'image.crossOrigin="anonymous";' : '') +
        'image.onload=()=>{const c=document.createElement("canvas");c.width=c.height=2;c.getContext("2d").drawImage(image,0,0);c.toDataURL();};image.src="./pixel.svg";</script>')
      const image = await check()
      expect(image.status, image.observation).toBe(crossOrigin ? 'passed' : 'failed')
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-package-'))
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist/index.html'), '<!doctype html><body>Playable fixture</body>')
  await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'content/scenes'), { recursive: true })
  await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
  const manifest = assetManifestAuthoringExamples().canonical
  await writeBeeGameAssetManifest(root, manifest)
  await writeFile(join(root, 'assets/runtime/example/resource.json'), '{}')
  const ui = uiLayoutFixture() as any
  ui.assetRefs = [manifest.resources[0]!.id]; ui.data.nodes[1].data = { image: { assetRef: manifest.resources[0]!.id } }
  await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
  await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
  await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'fixture', dimension: '2d',
    documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64), sceneModel: 'game-object-v2', entryScene: 'level',
    files: ['scenes/level.json', 'ui/menu.json'], documents: [
      { id: 'level', kind: 'scene-2d', path: 'scenes/level.json', loadPhase: 'startup' },
      { id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'startup' },
    ] }))
  await cp(join(root, 'content'), join(root, 'dist/content'), { recursive: true })
  await cp(join(root, 'assets'), join(root, 'dist/assets'), { recursive: true })
  return root
}

test('Preview measurement rejects root-relative resources but accepts build-relative resources under its subpath', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-preview-base-'))
  try {
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'dist/data.json'), '{"value":1}')
    for (const prefix of ['/', './']) {
      await writeFile(join(root, 'dist/index.html'), '<button>Play</button><script type="module">' +
        'const response=await fetch("'+prefix+'data.json");if(!response.ok)throw Error("Fixture resource failed");await response.json();</script>')
      const check = (await runChecks(root, { ...artifactTask, checks: ['runtime-smoke'] }, [])).checks[0]!
      expect(check.status, check.observation).toBe(prefix === '/' ? 'failed' : 'passed')
      const observed = JSON.parse(check.observation)
      expect(observed.missingFiles).toEqual(prefix === '/' ? ['/data.json (outside publication base /previews/measurement/)'] : [])
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)

test('a stalled browser evaluation reaches the host deadline and does not block the next observation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-browser-deadline-'))
  try {
    await mkdir(join(root, 'dist'))
    const path = 'dist/index.html'
    await writeFile(join(root, path), '<button>Play</button><script>' +
      'Object.defineProperty(window,"innerWidth",{get(){while(true){}}});</script>')
    const result: CheckResult = { id: 'runtime-smoke', version: 'deadline-fixture', inputs: [await readVersion(root, path)],
      status: 'unverified', observation: '', createdAt: new Date().toISOString() }
    const started = Date.now()
    await expect(observeStaticBuild(root, 'dist', [path], result, undefined, undefined, undefined, undefined, 2000))
      .rejects.toThrow('Browser observation timed out after 2000ms; no automatic retry')
    expect(Date.now() - started).toBeLessThan(8000)
    await writeFile(join(root, path), '<button>Play</button>')
    const next = (await runChecks(root, { ...artifactTask, checks: ['runtime-smoke'] }, [])).checks[0]!
    expect(next.status, next.observation).toBe('passed')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)

test('runtime artifact is an optional local path, never an arbitrary URL/host metadata', () => {
  expect(taskSchema.safeParse({ ...artifactTask, runtimeArtifact: '../other' }).success).toBe(false)
  expect(taskSchema.safeParse({ ...artifactTask, runtimeArtifact: '/tmp/other' }).success).toBe(false)
  expect(taskSchema.safeParse({ ...artifactTask, runtimeArtifact: '.beegame' }).success).toBe(false)
})

test('actual package bytes/resources checked without eight documents; additions and source edits invalidate historical checks', async () => {
  const root = await fixture()
  try {
    const result = (await runChecks(root, artifactTask, [])).checks[0]!
    expect(result.status).toBe('passed')
    expect(result.observation).toContain('Not runtime data consumption')
    expect(result.artifacts?.[0]?.path).toBe('dist')
    expect(await checkIsCurrent(root, result)).toBe(true)
    await writeFile(join(root, 'dist/new.js'), 'new output')
    expect(await checkIsCurrent(root, result)).toBe(false)
    // index.html did not change. The measured directory still invalidates the check.
    await rm(join(root, 'dist/new.js'))
    await writeFile(join(root, 'content/ui/extra.json'), '{}')
    expect(await checkIsCurrent(root, result)).toBe(false)
    await rm(join(root, 'content/ui/extra.json'))
    await writeFile(join(root, 'assets/runtime/example/resource.json'), '{"changed":true}')
    expect(await checkIsCurrent(root, result)).toBe(false)
    const stale = (await runChecks(root, artifactTask, [])).checks[0]!
    expect(stale.status).toBe('failed'); expect(stale.observation).toContain('Packaged bytes differ')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('empty registry, stale ID, absent packed member and unregistered JSON cannot pass', async () => {
  const root = await fixture()
  try {
    await rm(join(root, 'dist/assets/runtime/example/resource.json'))
    expect((await runChecks(root, artifactTask, [])).checks[0]!.status).toBe('unverified')
    await cp(join(root, 'assets'), join(root, 'dist/assets'), { recursive: true })
    const index = await Bun.file(join(root, 'content/index.json')).json()
    index.documents[0].id = 'wrong'
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
    expect((await runChecks(root, artifactTask, [])).checks[0]!.status).toBe('failed')
    index.documents = []
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index))
    expect((await runChecks(root, artifactTask, [])).checks[0]!.status).toBe('unverified')
  } finally { await rm(root, { recursive: true, force: true }) }
  const other = await fixture()
  try {
    await writeFile(join(other, 'content/ui/unregistered.json'), JSON.stringify(uiLayoutFixture()))
    expect((await runChecks(other, artifactTask, [])).checks[0]!.observation).toContain('Unregistered')
  } finally { await rm(other, { recursive: true, force: true }) }
})

test('artifact aliases/escapes and cancellation are not accepted or allowed to write source', async () => {
  const root = await fixture(), outside = await mkdtemp(join(tmpdir(), 'bgs-v3-outside-'))
  try {
    await writeFile(join(outside, 'secret.txt'), 'not a game asset')
    await symlink(join(outside, 'secret.txt'), join(root, 'dist/secret.txt'))
    expect((await runChecks(root, artifactTask, [])).checks[0]!.status).toBe('execution-error')
    const controller = new AbortController(); controller.abort()
    const result = (await runChecks(root, artifactTask, [], controller.signal)).checks[0]!
    expect(result.status).toBe('execution-error')
    expect(result.observation).toContain('cancelled')
    const noDriver = (await runChecks(root, { ...artifactTask, runtimeArtifact: undefined, checks: ['runtime-smoke'] }, [])).checks[0]!
    expect(noDriver.status).toBe('unverified')
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
