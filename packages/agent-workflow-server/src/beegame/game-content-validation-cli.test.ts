import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { CONTENT_CHECK_HELP, CONTENT_DRAFT_EXAMPLES, formatGameContentResult, generateUiLayoutAppendix, inspectGameContent, runGameContentCommand, summarizeContentLoadFootprint } from './game-content-validation-cli'
import { parseBeeGameContentIndex, type BeeGameContentPackage } from './game-content-package'
import type { BeeGameAssetManifest } from './asset-contracts'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import type { inspectUiLayout } from '../../../scene-editor/src/ui-layout-inspection'
import { materializeSceneUiFormat } from './scene-ui-content-authoring'
import { CONTENT_CHECKER_ENTRY, sharedContentChecker } from './content-checker-runtime'
import { DESIGN_HANDOFF_INSTRUCTION, checkDesignHandoffDraft, designHandoffPath } from './design-handoff'
import { sceneLayoutFixture, uiLayoutFixture, writeDesignDocumentFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'

test('camera draft accepts the actual Scene envelope and standalone Camera; diagnoses the selected source without writes',()=>{
  const root=mkdtempSync(join(tmpdir(),'bgs-camera-input-'))
  try {
    const scene=sceneLayoutFixture() as any
    const camera=scene.data.nodes.find((n:any)=>n.id===scene.data.cameraNodeId).components.find((c:any)=>c.type==='camera').data
    const bytes=JSON.stringify(scene)
    writeFileSync(join(root,'scene.json'),bytes)
    writeFileSync(join(root,'camera.json'),JSON.stringify({...camera,pixelsPerUnit:scene.data.settings.coordinateSystem.pixelsPerUnit}))
    const inspect=(path:string)=>runGameContentCommand(root,['--camera-draft',path,'1280','720']) as any
    const actual=inspect('scene.json')
    expect(actual.view).toEqual(inspect('camera.json').view)
    expect(actual.cameraNodeId).toBe(scene.data.cameraNodeId)
    expect(actual.runtimeVerified).toBe(false)
    expect(readFileSync(join(root,'scene.json'),'utf8')).toBe(bytes)
    writeFileSync(join(root,'ui.json'),JSON.stringify(uiLayoutFixture()))
    expect(()=>inspect('ui.json')).toThrow('ui.json: --camera-draft expects')
    delete scene.data.cameraNodeId
    scene.data.nodes.push({...structuredClone(scene.data.nodes[0]),id:'other-camera'})
    writeFileSync(join(root,'ambiguous.json'),JSON.stringify(scene))
    expect(()=>inspect('ambiguous.json')).toThrow('Choose one active authored Camera')
    writeFileSync(join(root,'invalid.json'),'{}')
    expect(()=>inspect('invalid.json')).toThrow('invalid.json: --camera-draft expects')
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('layout CLI returns selected node geometry once, with explicit spaces and unknown IDs',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bgs-layout-selected-'))
  try {
    const doc={schema:'beegame-content.v1',id:'menu',kind:'ui-screen',assetRefs:[],data:{rootId:'root',nodes:[
      {id:'root',role:'screen-root'}, {id:'label',parentId:'root',role:'text',text:'Label',layout:{anchor:'top-left',position:[12,16],size:[100,30]}},
      {id:'button',parentId:'root',role:'button',layout:{anchor:'top-right',position:[-8,12],size:[90,40]}},
    ]}}
    const bytes=JSON.stringify(doc);writeFileSync(join(root,'menu.json'),bytes)
    await initializeUiLayout()
    const args=['--layout-draft','menu.json','600','300','--nodes','label','button']
    const result=formatGameContentResult(runGameContentCommand(root,args)) as any
    expect(result.selectedGeometry.map((n:any)=>n.id)).toEqual(['label','button'])
    expect(result.selectedGeometry[0].bounds).toMatchObject({left:12,top:16,right:112,bottom:46})
    expect(result.geometrySpace).toContain('parent-local')
    expect(result.nodes).toBeUndefined()
    expect(()=>runGameContentCommand(root,[...args.slice(0,5),'unknown'])).toThrow('Available IDs: root, label, button')
    expect(()=>runGameContentCommand(root,args.slice(0,5))).toThrow('Usage')
    expect(readFileSync(join(root,'menu.json'),'utf8')).toBe(bytes)
  }finally{rmSync(root,{recursive:true,force:true})}
})

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('input identity follows saved sources/links, not a generator public copy, and changes with actual bytes',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bgs-input-identity-'));roots.push(root)
  await writeDesignDocumentsFixture(root)
  const ui=uiLayoutFixture() as any
  ui.data.nodes[0].data.layoutCamera={nodeId:'play',path:'content/scenes/level.json'}
  writeFileSync(join(root,'content/ui/menu.json'),JSON.stringify(ui))
  mkdirSync(join(root,'public/content/scenes'),{recursive:true})
  writeFileSync(join(root,'public/content/scenes/level.json'),JSON.stringify({...sceneLayoutFixture(),id:'wrong-copy'}))
  const first=runGameContentCommand(root,['--inspect-draft','content/ui/menu.json']) as any
  const source=first.inputLocation.sources.find((f:any)=>f.path==='content/scenes/level.json')
  expect(first.inputLocation.contentRoot).toBe(join(realpathSync(root),'content'))
  expect(source.sha256).toBe(createHash('sha256').update(readFileSync(join(root,source.path))).digest('hex'))
  const publicBefore=readFileSync(join(root,'public/content/scenes/level.json'),'utf8')
  writeFileSync(join(root,'public/content/scenes/level.json'),'changed wrong copy')
  expect((runGameContentCommand(root,['--inspect-draft','content/ui/menu.json']) as any).inputLocation).toEqual(first.inputLocation)
  writeFileSync(join(root,source.path),readFileSync(join(root,source.path),'utf8')+'\n')
  const changed=runGameContentCommand(root,['--inspect-draft','content/ui/menu.json']) as any
  expect(changed.inputLocation.sources.find((f:any)=>f.path===source.path).sha256).not.toBe(source.sha256)
  expect(changed.runtimeVerified).toBe(false)
  expect(publicBefore).toContain('wrong-copy')
  const format=runGameContentCommand(root,['--format','index']) as any
  expect(format.value.documentRevision).toContain('--authority')
  expect(format.value.assetManifestRevision).toContain('--authority')
  expect(CONTENT_CHECK_HELP).toContain('NOT JSON')
  expect(CONTENT_CHECK_HELP).toContain('--authority [--inputs]')
  expect(CONTENT_CHECK_HELP).toContain('legacy revision metadata')
  expect(CONTENT_CHECK_HELP).toContain('does not certify design or quality')
})

test('input snapshots do not follow links outside the project or change validity claims',()=>{
  const root=mkdtempSync(join(tmpdir(),'bgs-input-linked-'));roots.push(root)
  const ui=uiLayoutFixture() as any
  ui.data.nodes[0].data.layoutUnderlay={path:'../private.json',clearance:'allow-cover'}
  writeFileSync(join(root,'draft.json'),JSON.stringify(ui))
  const result=runGameContentCommand(root,['--inspect-draft','draft.json']) as any
  expect(result.inputLocation.sources.find((f:any)=>f.path==='../private.json').state).toBeDefined()
  expect(result.runtimeVerified).toBe(false)
})

test('Scene batch discovers saved paths with spaces, reports all inputs and never requires a shell loop', () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-scene-batch-')); roots.push(root)
  mkdirSync(join(root, 'content/scenes/chapter one'), { recursive: true })
  const scene = sceneLayoutFixture()
  writeFileSync(join(root, 'content/scenes/chapter one/level one.json'), JSON.stringify(scene))
  writeFileSync(join(root, 'content/scenes/broken.json'), '{')
  const args = ['--scene-layouts', '960', '540', '600', '360']
  const result = runGameContentCommand(root, args) as any
  expect(result.valid).toBe(false)
  expect(result.files).toHaveLength(2)
  expect(result.issues.join(' ')).toContain('broken.json')
  expect(result.inspections).toHaveLength(2)
  expect((runGameContentCommand(root, [...args, '960', '540']) as any).inspections).toEqual(result.inspections)
  expect(result.inspections[0].source).toBe('content/scenes/chapter one/level one.json')
  expect(result.inspections[0].nodes).toBeUndefined()
  expect((runGameContentCommand(root, [...args, '--details']) as any).inspections[0].nodes).toHaveLength(2)
  expect(result.runtimeVerified).toBe(false)
  expect(() => runGameContentCommand(root, ['--scene-layouts', '960 540'])).toThrow('Usage')
  expect(() => runGameContentCommand(root, ['--scene-layouts', '0', '540'])).toThrow('positive')
  expect(CONTENT_CHECK_HELP).toContain('measurements:[{source,scene?,viewport,nodes}]')
})

test('batch inspection checks missing planned pages and matches confirmed host settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-layout-coverage-')); roots.push(root)
  await writeDesignDocumentsFixture(root)
  const file = join(root, 'docs/UI_UX_SPEC.md')
  writeFileSync(file, readFileSync(file, 'utf8') + '\n[Required results](../content/ui/results.json)\n')
  const result = runGameContentCommand(root, ['--review-layouts', '--orientation', 'Portrait']) as any
  expect(result.valid).toBe(false)
  expect(result.issues.join(' ')).toContain('orientation differs')
  expect(result.coverage.missing).toEqual(['content/ui/results.json'])
  expect(result.inputs.confirmed.orientation).toBe('Portrait')
  expect(() => runGameContentCommand(root, ['--review-layouts', '--orientation', 'wrong'])).toThrow('Invalid --orientation')
})

test('Scene planning uses each saved Camera viewport once; explicit common targets remain available', () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-scene-own-viewports-')); roots.push(root)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  for (const [id, width, height] of [['wide', 1200, 600], ['square', 640, 640]] as const) {
    const scene = sceneLayoutFixture()
    scene.id = id
    scene.data.nodes[0]!.components[0]!.data.viewport = { width, height }
    writeFileSync(join(root, 'content/scenes/' + id + '.json'), JSON.stringify(scene))
  }
  const own = runGameContentCommand(root, ['--scene-layouts']) as any
  expect(own.valid).toBe(true)
  expect(own.coverage.basis).toBe('saved-camera-per-scene')
  expect(own.inspections.map((item: any) => [item.source, item.viewport])).toEqual([
    ['content/scenes/square.json', { width: 640, height: 640 }],
    ['content/scenes/wide.json', { width: 1200, height: 600 }],
  ])
  const explicit = runGameContentCommand(root, ['--scene-layouts', '1200', '600', '640', '640']) as any
  expect(explicit.inspections).toHaveLength(4)
  expect(explicit.coverage.basis).toBe('explicit-common-viewports')
  const broken = sceneLayoutFixture()
  delete (broken.data.nodes[0]!.components[0]!.data as any).viewport
  writeFileSync(join(root, 'content/scenes/missing.json'), JSON.stringify({ ...broken, id: 'missing' }))
  const failure = runGameContentCommand(root, ['--scene-layouts']) as any
  expect(failure.valid).toBe(false)
  expect(failure.issues.join(' ')).toContain('viewport')
  expect(failure.inspections).toHaveLength(2)
  expect(failure.runtimeVerified).toBe(false)
})

test('final technical CLI shares completion coverage checking without host version requirements', async () => {
  const root = mkdtempSync(join(tmpdir(), 'handoff-cli-final-')); roots.push(root)
  await writeDesignDocumentsFixture(root)
  const args = ['--check-handoff-drafts', 'docs/TECHNICAL_DESIGN.md', '--final-technical']
  expect(runGameContentCommand(root, args)).toMatchObject({ valid: true })
  const file = join(root, designHandoffPath('TECHNICAL_DESIGN.md'))
  const original = JSON.parse(readFileSync(file, 'utf8'))
  for (const mode of ['uncovered', 'duplicate', 'unknown'] as const) {
    const index = structuredClone(original)
    if (mode === 'uncovered') index.implementationItems.pop()
    if (mode === 'duplicate') index.implementationItems.push(structuredClone(index.implementationItems[0]))
    if (mode === 'unknown') index.implementationItems[0].requirementRefs[0].id = 'unknown-output'
    writeFileSync(file, JSON.stringify(index))
    const saved = readFileSync(file, 'utf8')
    const result = runGameContentCommand(root, args) as any
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(checkDesignHandoffDraft(root, 'TECHNICAL_DESIGN.md', { finalTechnical: true }).issues)
    expect(readFileSync(file, 'utf8')).toBe(saved)
    if (mode === 'uncovered')
      expect(runGameContentCommand(root, ['--check-handoff-drafts', 'TECHNICAL_DESIGN.md'])).toMatchObject({ valid: true })
  }
  for (const invalid of [
    ['--check-handoff-drafts', '--final-technical'],
    ['--check-handoff-drafts', 'UI_UX_SPEC.md', '--final-technical'],
    ['--check-handoff-drafts', '--final-technical', 'TECHNICAL_DESIGN.md'],
  ]) expect(() => runGameContentCommand(root, invalid)).toThrow()
})

test('handoff draft CLI accepts document names and their docs paths without changing files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'handoff-cli-path-')); roots.push(root)
  await writeDesignDocumentFixture(root, 'UI_UX_SPEC.md')
  const file = join(root, '.beegame/design-handoffs/UI_UX_SPEC.json')
  const before = readFileSync(file, 'utf8')
  const expected = runGameContentCommand(root, ['--check-handoff-drafts', 'UI_UX_SPEC.md'])
  expect(expected).toMatchObject({ valid: true })
  expect(runGameContentCommand(root, ['--check-handoff-drafts', 'docs/UI_UX_SPEC.md'])).toEqual(expected)
  for (const argument of ['../docs/UI_UX_SPEC.md', '/docs/UI_UX_SPEC.md', 'content/UI_UX_SPEC.md', 'docs/UNKNOWN.md']) {
    const result = runGameContentCommand(root, ['--check-handoff-drafts', argument]) as any
    expect(result.valid).toBe(false)
    expect(result.issues.join(' ')).toContain('Expected NAME.md or docs/NAME.md')
    expect(result.issues.join(' ')).toContain('UI_UX_SPEC.md')
  }
  expect(readFileSync(file, 'utf8')).toBe(before)
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'content-inspection-'))
  roots.push(root)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  const index = { schema: 'beegame-content-package.v2' as const, id: 'test', dimension: '2d' as const,
    documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
    sceneModel: 'game-object-v2' as const, entryScene: 'level', files: ['scenes/level.json'] }
  const nodes = Array.from({ length: 600 }, (_, i) => ({
    id: `node-${i}`, semantic: ['platform'],
    transform: { position: [i * 20, -40, 0] },
    data: { customAuthoredField: 'x'.repeat(600) },
  }))
  const doc = { schema: 'beegame-content.v1', id: 'level', kind: 'scene-2d', assetRefs: [],
    data: { nodes, settings: { coordinateSystem: { origin: 'top-left' } } } }
  writeFileSync(join(root, 'content/index.json'), JSON.stringify(index))
  writeFileSync(join(root, 'content/scenes/level.json'), JSON.stringify(doc))
  return { root, doc, index }
}

test('checker bundle retains English validation but no unused Zod locales', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-checker-bundle-')); roots.push(root)
  const checker = join(root, 'check-content.mjs'), metadata = join(root, 'meta.json')
  const build = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL('./game-content-validation-cli.ts', import.meta.url)),
    '--target=bun', '--production', `--outfile=${checker}`, `--metafile=${metadata}`], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exit] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited])
  expect({ exit, stderr, hasOutput: Boolean(stdout) }).toEqual({ exit: 0, stderr: '', hasOutput: true })
  const meta = JSON.parse(readFileSync(metadata, 'utf8')) as { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> }
  const locales = Object.keys(Object.values(meta.outputs)[0]!.inputs).filter(path =>
    path.includes('/zod/v4/locales/') && Object.values(meta.outputs)[0]!.inputs[path]!.bytesInOutput > 0)
  expect(locales).toHaveLength(1)
  expect(locales[0]).toEndWith('/en.js')
  const invalid = uiLayoutFixture(); invalid.data.nodes[1]!.role = 'not-a-role'
  writeFileSync(join(root, 'invalid.json'), JSON.stringify(invalid))
  const child = Bun.spawn([process.execPath, checker, '--layout-draft', 'invalid.json', '960', '540'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(error).toBe('')
  expect(code).toBe(1)
  const result = JSON.parse(output)
  expect(result.valid).toBe(false)
  expect(result.issues.join(' ')).toContain('Invalid option: expected one of')
})

test('project checker entry exposes no implementation and fails explicitly without its BGS runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-checker-entry-')); roots.push(root)
  await materializeSceneUiFormat(root)
  const path = join(root, '.beegame/delivery/check-content.mjs')
  expect(readFileSync(path, 'utf8')).toBe(CONTENT_CHECKER_ENTRY)
  expect(CONTENT_CHECKER_ENTRY).not.toContain('base64')
  for (const moduleUrl of ['', 'file:///nonexistent-bgs-checker.mjs']) {
    const child = Bun.spawn([process.execPath, path, '--help'], { cwd: root,
      env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(code).toBe(1)
    expect(err).toBe('')
    expect(JSON.parse(out)).toMatchObject({ valid: false, issues: [expect.any(String)] })
    if (!moduleUrl) expect(JSON.parse(out).issues[0]).toContain('BGS project execution environment')
  }
})

test('materialized Review geometry command fails saved errors and passes corrected inputs without writing reports', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-review-layout-cli-')); roots.push(root)
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n')
  await writeDesignDocumentFixture(root, 'LEVEL_SCENE_DESIGN.md')
  await materializeSceneUiFormat(root)
  const runtime = await sharedContentChecker()
  for (const [height, valid] of [[28, false], [52, true]] as const) {
    const path = join(root, 'content/ui/menu.json'), source = JSON.stringify(uiLayoutFixture(height))
    writeFileSync(path, source)
    const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/check-content.mjs'), '--review-layouts'],
      { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(error).toBe('')
    expect(exit).toBe(valid ? 0 : 1)
    expect(JSON.parse(output)).toMatchObject({ valid, runtimeVerified: false, scope: 'review-layout-geometry' })
    expect(readFileSync(path, 'utf8')).toBe(source)
  }
})

test('draft geometry checks targets without unfinished prose; final Review still requires linked sources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-draft-geometry-cli-')); roots.push(root)
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  await materializeSceneUiFormat(root)
  const path = join(root, 'content/ui/menu.json'), ui = uiLayoutFixture()
  // The format's responsive shape is consumed at node level by the real schema.
  const format = runGameContentCommand(root, ['--format', 'uiDocument']) as any
  const responsive = structuredClone(format.value.data.nodes[0].responsive)
  Object.assign(ui.data.nodes[1]!, { responsive })
  writeFileSync(path, JSON.stringify(ui))
  const before = readFileSync(path, 'utf8')
  expect(runGameContentCommand(root, ['--design-layouts'])).toMatchObject({ valid: true, runtimeVerified: false })
  expect(runGameContentCommand(root, ['--review-layouts'])).toMatchObject({ valid: false })
  // A fitting reference is not enough: the target variant remains checked.
  responsive.compact.layout.size = [160, 28]
  writeFileSync(path, JSON.stringify(ui))
  const invalid = runGameContentCommand(root, ['--design-layouts']) as any
  expect(invalid.valid).toBe(false)
  expect(invalid.issues.join(' ')).toContain('600x360')
  expect(invalid.issues.join(' ')).toContain('minimumControlSize')
  // Schema failures also remain explicit issues, never an empty geometry PASS.
  delete responsive.compact.layout.container.direction
  writeFileSync(path, JSON.stringify(ui))
  const schemaFailure = runGameContentCommand(root, ['--design-layouts']) as any
  expect(schemaFailure.valid).toBe(false)
  expect(schemaFailure.issues.join(' ')).toContain('direction')
  writeFileSync(path, before)
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n')
  await writeDesignDocumentFixture(root, 'LEVEL_SCENE_DESIGN.md')
  expect(runGameContentCommand(root, ['--review-layouts'])).toMatchObject({ valid: true })
  expect(readFileSync(path, 'utf8')).toBe(before)
})

test('handoff contract help exits successfully without a document or resource prerequisite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-handoff-help-')); roots.push(root)
  await materializeSceneUiFormat(root)
  const runtime = await sharedContentChecker()
  const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/check-content.mjs'), '--design-handoff-help'],
    { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(error).toBe('')
  expect(exit).toBe(0)
  expect(JSON.parse(output)).toMatchObject({ ok: true, scope: 'design-handoff-help' })
  expect(JSON.parse(output).instruction).toBe(DESIGN_HANDOFF_INSTRUCTION)
})

test('format entry reads one actual contract section without full Content or resource prerequisites', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-format-section-')); roots.push(root)
  await materializeSceneUiFormat(root)
  const path = join(root, '.beegame/delivery/content-format.json'), before = readFileSync(path, 'utf8')
  const format = JSON.parse(before)
  expect(format).not.toHaveProperty('layoutDraftAppendixCommand')
  expect(runGameContentCommand(root, ['--format'])).toMatchObject({ ok: true, sections: Object.keys(format) })
  const result = runGameContentCommand(root, ['--format', 'coordinates'])
  expect(result).toMatchObject({ ok: true, value: format.coordinates })
  expect(JSON.stringify(result).length).toBeLessThan(before.length / 8)
  for (const section of ['missing', '__proto__']) expect(() => runGameContentCommand(root, ['--format', section])).toThrow()
  expect(() => runGameContentCommand(root, ['--format', 'coordinates', 'extra'])).toThrow()
  expect(() => runGameContentCommand(root, ['--format', 'section', 'coordinates'])).toThrow('example: --format coordinates')
  for (const instructions of [CONTENT_CHECK_HELP]) {
    const example = instructions.match(/bun \.beegame\/delivery\/check-content\.mjs --format coordinates/)
    expect(example).not.toBeNull()
    expect(runGameContentCommand(root, example![0].split(' ').slice(2))).toMatchObject({ ok: true, value: format.coordinates })
  }
  expect(runGameContentCommand(root, ['--format', 'coordinates', 'runtimeConsumption', 'coordinates']))
    .toEqual({ ok: true, scope: 'content-format-selection',
      values: { coordinates: format.coordinates, runtimeConsumption: format.runtimeConsumption } })
  expect(() => runGameContentCommand(root, ['--format', 'coordinates', 'missing'])).toThrow()
  expect(readFileSync(path, 'utf8')).toBe(before)
  const runtime = await sharedContentChecker()
  const command = ['--format', 'uiDocument', 'uiVocabulary', 'uiLayoutContract']
  const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/check-content.mjs'), ...command],
    { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
  const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(error).toBe('')
  expect(exit).toBe(0)
  expect(JSON.parse(output)).toEqual(runGameContentCommand(root, command))
  expect(output.trim().split('\n')).toHaveLength(1)
  expect(output.length).toBeLessThan(30_000)
  expect(JSON.parse(output).values.uiVocabulary.behaviorBindings.example).toEqual({
    actions: { click: 'game.start' }, bindings: { text: 'session.label', enabled: 'session.canStart' },
  })
  const scene = runGameContentCommand(root, ['--format', 'sceneVocabulary']) as any
  expect(scene.value.requiredData.grid.schema).toBe('grid.v1')
  expect(scene.value.requiredData.tilemap.schema).toBe('tilemap.v1')
  expect(scene.value.requiredData['tilemap-renderer'].schema).toBe('tilemap-renderer.v1')
  expect(scene.value.tilemapHierarchy).toContain('ancestor')
})

test('published linked UI and Tilemap examples run through real draft checks without production assets', async () => {
  await initializeUiLayout()
  const root = mkdtempSync(join(tmpdir(), 'bgs-connected-format-')); roots.push(root)
  await materializeSceneUiFormat(root)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  const tilemap = (runGameContentCommand(root, ['--format', 'tilemap']) as any).value.examples.scene
  const uiNodes = (runGameContentCommand(root, ['--format', 'uiLayoutContract']) as any).value.linkedGameViewExample.nodes
  const ui = { schema: 'beegame-content.v1', id: 'linked-example', kind: 'ui-hud', assetRefs: [], data: { rootId: 'root', nodes: uiNodes } }
  const tilePath = join(root, 'content/scenes/tiles.json'), uiPath = join(root, 'content/ui/hud.json')
  writeFileSync(tilePath, JSON.stringify(tilemap))
  writeFileSync(join(root, 'content/scenes/world.json'), JSON.stringify(CONTENT_DRAFT_EXAMPLES.scene))
  writeFileSync(uiPath, JSON.stringify(ui))
  expect(runGameContentCommand(root, ['--check-drafts', 'content/scenes/tiles.json', 'content/scenes/world.json', 'content/ui/hud.json']))
    .toMatchObject({ valid: true, issues: [], runtimeVerified: false })
  expect(runGameContentCommand(root, ['--design-layouts', '--draft', '--orientation', 'Landscape', '--dimension', '2D']))
    .toMatchObject({ valid: true, issues: [], runtimeVerified: false })
  const sceneCheck = runGameContentCommand(root, ['--scene-layouts']) as any
  expect(sceneCheck).toMatchObject({ valid: true, issues: [], runtimeVerified: false })

  // The published hierarchy matters: a gridNodeId without ancestry is invalid.
  delete tilemap.data.nodes.find((node: any) => node.id === 'ground').parentId
  writeFileSync(tilePath, JSON.stringify(tilemap))
  const brokenGrid = runGameContentCommand(root, ['--check-drafts', 'content/scenes/tiles.json']) as any
  expect(brokenGrid.valid).toBe(false)
  expect(brokenGrid.issues.join(' ')).toContain('ancestor')

  // nodeId selects a UI region; the Scene owns its separate Camera identity.
  uiNodes[0].data.layoutCamera.nodeId = 'camera'
  writeFileSync(uiPath, JSON.stringify(ui))
  const brokenLink = runGameContentCommand(root, ['--design-layouts', '--draft']) as any
  expect(brokenLink.valid).toBe(false)
  expect(brokenLink.issues.join(' ')).toContain('camera')
})

test('final task diagnostics identify malformed tasks and expose valid sources without losing other coverage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-task-diagnostics-')); roots.push(root)
  await writeDesignDocumentsFixture(root)
  const path = join(root, '.beegame/design-handoffs/TECHNICAL_DESIGN.json')
  const index = JSON.parse(readFileSync(path, 'utf8'))
  index.implementationItems[0].requirementRefs = []
  const before = JSON.stringify(index)
  writeFileSync(path, before)
  const result = runGameContentCommand(root, ['--check-handoff-drafts', 'TECHNICAL_DESIGN.md', '--final-technical']) as any
  expect(result.valid).toBe(false)
  expect(result.issues.join('\n')).toContain('implementationItems.0.requirementRefs (id: "fixture-GDD")')
  expect(result.issues.join('\n')).toContain('GDD.md#play has no implementation item')
  expect(result.issues.join('\n')).not.toContain('AUDIO_DESIGN.md#ready has no implementation item')
  expect(result.availableRequirements).toContainEqual({ document: 'GDD.md', id: 'play', section: 'Design' })
  expect(result.availableRequirements).toContainEqual({ document: 'TECHNICAL_DESIGN.md', id: 'ready', section: 'Design' })
  expect(result.issues.join('\n')).not.toContain('"origin":')
  expect(readFileSync(path, 'utf8')).toBe(before)
  index.implementationItems[0].requirementRefs = [{ document: 'GDD.md', id: 'play' }]
  writeFileSync(path, JSON.stringify(index))
  const valid = runGameContentCommand(root, ['--check-handoff-drafts', 'TECHNICAL_DESIGN.md', '--final-technical']) as any
  expect(valid).toMatchObject({ valid: true, issues: [] })
  expect(valid.availableRequirements).toBeUndefined()
})

test('help examples execute without resources/index and document actual result shapes', async () => {
  await initializeUiLayout()
  const root = mkdtempSync(join(tmpdir(), 'content-help-')); roots.push(root)
  const examples = CONTENT_CHECK_HELP.split('\n').map(line => line.replace('Minimal Scene draft: ', ''))
    .filter(line => line.startsWith('{"schema"')).map(line => JSON.parse(line))
  expect(examples).toHaveLength(2)
  writeFileSync(join(root, 'menu.json'), JSON.stringify(examples[0]))
  writeFileSync(join(root, 'scene.json'), JSON.stringify(examples[1]))
  expect(runGameContentCommand('/nonexistent', ['--help'])).toMatchObject({ ok: true, scope: 'help' })
  for (const file of ['menu.json', 'scene.json']) {
    expect(runGameContentCommand(root, ['--check-drafts', file])).toMatchObject({ valid: true, issues: [], runtimeVerified: false })
    const full = runGameContentCommand(root, ['--layout-draft', file, '960', '540', '--details'])
    const compact = formatGameContentResult(full)
    expect('nodes' in full).toBe(true); expect('nodes' in compact).toBe(false)
    expect(formatGameContentResult(full, true)).toEqual(full)
    expect('nodeCount' in compact && compact.nodeCount).toBe(2)
    if (file === 'menu.json') expect(compact).toMatchObject({ diagnostics: {
      textFit: { unmeasured: ['play'], exceedsIntrinsicBounds: [] },
    } })
  }
  expect(CONTENT_CHECK_HELP).toContain('NOT authored role/style/text')
})

test('draft structure checks the selected batch only and detects shared component IDs before Review', () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-early-drafts-')); roots.push(root)
  const scene = structuredClone(CONTENT_DRAFT_EXAMPLES.scene)
  scene.data.nodes.push({ ...structuredClone(scene.data.nodes[1]!), id: 'second-shape' })
  writeFileSync(join(root, 'scene.json'), JSON.stringify(scene))
  writeFileSync(join(root, 'menu.json'), JSON.stringify(CONTENT_DRAFT_EXAMPLES.ui))
  writeFileSync(join(root, 'unfinished.json'), '{')
  const before = readFileSync(join(root, 'scene.json'), 'utf8')
  const structure = runGameContentCommand(root, ['--check-drafts', 'scene.json', 'menu.json']) as any
  expect(structure).toMatchObject({ valid: false, runtimeVerified: false, files: ['scene.json', 'menu.json'] })
  expect(structure.issues.join(' ')).toContain('duplicate scene component id shape-sprite')
  const geometry = runGameContentCommand(root, ['--layout-draft', 'scene.json', '960', '540']) as any
  expect(geometry).toMatchObject({ ok: false, valid: false, issues: structure.issues })
  expect(readFileSync(join(root, 'scene.json'), 'utf8')).toBe(before)
  expect(runGameContentCommand(root, ['--check-drafts', 'menu.json'])).toMatchObject({ valid: true })
  expect(() => runGameContentCommand(root, ['--check-drafts'])).toThrow('Usage')
})

test('connected UI checks retain linked Scene structural failures rather than a geometry-only success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-connected-draft-')); roots.push(root)
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  const ui = structuredClone(CONTENT_DRAFT_EXAMPLES.ui) as any
  ui.data.nodes[0].data.layoutCamera = { nodeId: 'play', path: 'scene.json' }
  const scene = structuredClone(CONTENT_DRAFT_EXAMPLES.scene)
  scene.data.nodes.push({ ...structuredClone(scene.data.nodes[1]!), id: 'other' })
  writeFileSync(join(root, 'scene.json'), JSON.stringify(scene))
  writeFileSync(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
  const result = runGameContentCommand(root, ['--design-layouts']) as any
  expect(result.valid).toBe(false)
  expect(result.issues.join(' ')).toContain('duplicate scene component id shape-sprite')
  expect(() => runGameContentCommand(root, ['--layout-draft', 'content/ui/menu.json', '960', '540']))
    .toThrow('duplicate scene component id')
})

test('draft inspection returns exact multiple nodes/fields without package prerequisites or a full Scene replay', () => {
  const { root, doc } = fixture()
  rmSync(join(root, 'content/index.json'))
  const path = join(root, 'content/scenes/level.json'), before = readFileSync(path, 'utf8')
  const result = runGameContentCommand(root, ['--inspect-draft', 'content/scenes/level.json',
    '--node', 'node-3', '--node', 'node-300', '--pointer', '/data/settings']) as any
  expect(result).toMatchObject({ ok: true, runtimeVerified: false, nodes: [doc.data.nodes[3], doc.data.nodes[300]],
    fields: [{ pointer: '/data/settings', value: doc.data.settings }] })
  expect(JSON.stringify(result).length).toBeLessThan(before.length / 50)
  const overview = runGameContentCommand(root, ['--inspect-draft', 'content/scenes/level.json']) as any
  expect(overview.nodeCount).toBe(600)
  expect(overview).not.toHaveProperty('nodes')
  expect(readFileSync(path, 'utf8')).toBe(before)
  for (const suffix of [['--node', 'missing'], ['--pointer', '/data/missing'], ['--pointer', '/__proto__'],
    ['--pointer', '/data/bad~3'], ['--node'], ['--unknown', 'field']])
    expect(() => runGameContentCommand(root, ['--inspect-draft', 'content/scenes/level.json', ...suffix])).toThrow()
  const external = mkdtempSync(join(tmpdir(), 'bgs-draft-external-')); roots.push(external)
  writeFileSync(join(external, 'scene.json'), before)
  symlinkSync(join(external, 'scene.json'), join(root, 'escape.json'))
  expect(() => runGameContentCommand(root, ['--inspect-draft', 'escape.json'])).toThrow('inside')
  expect(() => runGameContentCommand(root, ['--check-drafts', 'escape.json'])).not.toThrow()
  expect(runGameContentCommand(root, ['--check-drafts', 'escape.json'])).toMatchObject({ valid: false })
})

test('design appendix comes from actual shared geometry, preserves sources and never certifies success', async () => {
  await initializeUiLayout()
  const root = mkdtempSync(join(tmpdir(), 'layout-appendix-')); roots.push(root)
  const source = { schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [],
    data: { rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', data: { targetViewports: [[640,360], [960,540]], minimumControlSize: [44,44] },
        layout: { container: { direction: 'column', align: 'center', justify: 'center', gap: 12 } } },
      { id: 'play', role: 'button', parentId: 'root', text: 'Play', layout: { size: [160,32] } },
    ] } }
  const path = join(root, 'draft.json'), original = JSON.stringify(source)
  writeFileSync(path, original)
  const args = ['--layout-draft', 'draft.json', '960', '540']
  const appendix = generateUiLayoutAppendix(root, args)
  expect(appendix.match(/## 960 × 540/g)).toHaveLength(1)
  expect(appendix).toContain('## 640 × 360')
  expect(appendix).toContain('SHA-256:')
  expect(appendix).toContain('this is not a PASS')
  expect(appendix).toMatch(/"belowMinimumControlSize":\s*\[\s*"play"/)
  expect(appendix).toContain('"unmeasured"')
  const inspection = runGameContentCommand(root, args)
  if (!('nodes' in inspection)) throw Error('Expected geometry')
  const play = inspection.nodes.find(n => n.id === 'play')!
  if (!('bounds' in play)) throw Error('Expected UI bounds')
  expect(appendix).toContain(JSON.stringify(play.bounds))
  expect(readFileSync(path, 'utf8')).toBe(original)
  await materializeSceneUiFormat(root)
  const runtime = await sharedContentChecker()
  const child = Bun.spawn([process.execPath, join(root,'.beegame/delivery/check-content.mjs'), ...args, '--appendix'],
    { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
  expect(await new Response(child.stdout).text()).toBe(appendix + '\n')
  expect(await child.exited).toBe(0)
  expect(readFileSync(path, 'utf8')).toBe(original)
  source.data.nodes[0]!.data!.targetViewports = [[0,360]]
  writeFileSync(path, JSON.stringify(source))
  expect(() => generateUiLayoutAppendix(root, args)).toThrow('positive')
  expect(() => generateUiLayoutAppendix(root, ['--layout-draft', '../draft.json', '960','540'])).toThrow()
})

test('compact Scene diagnostics retain clipping and unknown geometry, including linked Scene results', () => {
  const scene = { view: { projection: 'orthographic' }, requiredVisibility: { status: 'failed' }, nodes: [
    { id: 'visible', enabled: true, fullyInside: true },
    { id: 'cropped', enabled: true, fullyInside: false },
    { id: 'unknown', enabled: true, geometryUnavailable: 'Explicit size required' },
    { id: 'disabled', enabled: false, fullyInside: false },
  ] }
  for (const result of [
    { ok: true, scope: 'scene-layout-draft-inspection', runtimeVerified: false, ...scene },
    { ok: true, scope: 'layout-draft-inspection', runtimeVerified: false, nodes: [], sceneInspection: scene },
  ]) {
    const compact = formatGameContentResult(result) as any
    const measured = compact.sceneInspection ?? compact
    expect(measured.requiredVisibility.status).toBe('failed')
    expect(measured.diagnostics).toEqual({ outsideCameraView: ['cropped'],
      geometryUnavailable: [{ id: 'unknown', reason: 'Explicit size required' }] })
    expect(measured.nodes).toBeUndefined()
  }
})

test('large detailed layout JSON survives a slow stdout pipe including failed checks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-layout-pipe-')); roots.push(root)
  await materializeSceneUiFormat(root)
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  const source = uiLayoutFixture(28) as any
  source.data.nodes.push(...Array.from({ length: 500 }, (_, i) => ({
    id: 'decor-' + i, role: 'container', parentId: 'root', layout: { size: [10, 10] },
  })))
  writeFileSync(join(root, 'content/ui/menu.json'), JSON.stringify(source))
  const runtime = await sharedContentChecker()
  const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/check-content.mjs'),
    '--design-layouts', '--draft', '--details'], {
    cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe',
  })
  // Pipe backpressure, not a file redirect; reports must not end at a pipe-buffer boundary.
  const reader = child.stdout.getReader(), chunks: Uint8Array[] = []
  while (true) {
    await Bun.sleep(1)
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const output = Buffer.concat(chunks).toString('utf8')
  expect(await new Response(child.stderr).text()).toBe('')
  expect(await child.exited).toBe(1)
  expect(output.length).toBeGreaterThan(262144)
  expect(JSON.parse(output)).toMatchObject({ valid: false })
}, 30000)

test('large healthy layout output stays concise without changing the full inspection API', () => {
  const root = mkdtempSync(join(tmpdir(), 'content-summary-')); roots.push(root)
  const source = JSON.stringify({ schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [], data: {
    rootId: 'root', nodes: [{ id: 'root', role: 'screen-root' }, ...Array.from({ length: 500 }, (_, i) => ({
      id: 'decor-' + i, role: 'container', parentId: 'root', layout: { size: [10, 10] },
    }))],
  } })
  writeFileSync(join(root, 'ui.json'), source)
  const full = runGameContentCommand(root, ['--layout-draft', 'ui.json', '960', '540'])
  const compact = formatGameContentResult(full)
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 20)
  expect(compact).toMatchObject({ ok: true, nodeCount: 501, diagnostics: { outsideViewport: [], outsideParent: [] } })
  expect(readFileSync(join(root, 'ui.json'), 'utf8')).toBe(source)
})

test('one connected UI source projects world text with screen controls for drafts, registered content and boundary probes', () => {
  const { root, index } = fixture()
  const ui = { schema: 'beegame-content.v1', kind: 'ui-screen', id: 'combined', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root' },
      { id: 'game', role: 'container', parentId: 'root', layout: { anchorMin: [.02, .02], anchorMax: [.98, .98] },
        responsive: { compact: { layout: { anchorMin: [.3, .1], anchorMax: [.7, .9] } } } },
      { id: 'world-ui', role: 'container', parentId: 'game', data: { space: 'camera-reference-2d' },
        layout: { size: [480, 672], item: { absolute: true } } },
      { id: 'prompt', role: 'text', parentId: 'world-ui', text: '发球', layout: { position: [120, 568], size: [240, 24] } },
      { id: 'screen-btn', role: 'button', parentId: 'root', layout: { position: [160, 700], size: [200, 25] } },
    ],
  } }
  const camera = { orthographic: true, orthographicSize: 3.36, pixelsPerUnit: 100,
    viewport: { width: 480, height: 672 }, framing: 'letterbox' }
  const source = JSON.stringify(ui), cameraSource = JSON.stringify(camera)
  writeFileSync(join(root, 'draft.json'), source)
  writeFileSync(join(root, 'camera.json'), cameraSource)
  mkdirSync(join(root, 'content/ui'))
  writeFileSync(join(root, 'content/ui/combined.json'), source)
  index.files.push('ui/combined.json')
  writeFileSync(join(root, 'content/index.json'), JSON.stringify(index))
  for (const args of [['--layout-draft', 'draft.json'], ['--layout', 'ui/combined.json']]) {
    expect(runGameContentCommand(root, [...args, '390', '844', '--game-view', 'game', '--camera', 'camera.json'])).toMatchObject({
      ok: true, runtimeVerified: false, diagnostics: { outsideCameraView: [], overlapCandidates: [] },
      nodes: [{ id: 'root' }, { id: 'game' }, { id: 'world-ui', worldRootId: 'world-ui', outsideParent: false },
        { id: 'prompt', worldRootId: 'world-ui', outsideCameraView: false }, { id: 'screen-btn' }],
      boundaryChecks: [
        { viewport: { width: 600, height: 844 }, diagnostics: { overlapCandidates: [], outsideCameraView: [] } },
        { viewport: { width: 601, height: 844 }, diagnostics: { overlapCandidates: [['prompt', 'screen-btn']], outsideCameraView: [] } },
      ],
    })
  }
  expect(readFileSync(join(root, 'draft.json'), 'utf8')).toBe(source)
  expect(readFileSync(join(root, 'content/ui/combined.json'), 'utf8')).toBe(source)
  expect(readFileSync(join(root, 'camera.json'), 'utf8')).toBe(cameraSource)
  const interactive = structuredClone(ui)
  Object.assign(interactive.data.nodes[0]!, { data: { minimumControlSize: [44, 44] } })
  interactive.data.nodes.push({ id: 'projected-control', role: 'button', parentId: 'world-ui', layout: { position: [0, 0], size: [48, 48] } })
  const unsupported = JSON.stringify(interactive)
  writeFileSync(join(root, 'draft.json'), unsupported)
  writeFileSync(join(root, 'content/ui/combined.json'), unsupported)
  for (const args of [['--layout-draft', 'draft.json'], ['--layout', 'ui/combined.json']])
    expect(runGameContentCommand(root, [...args, '320', '480', '--game-view', 'game', '--camera', 'camera.json']))
      .toMatchObject({ ok: true, runtimeVerified: false, diagnostics: { belowMinimumControlSize: ['screen-btn', 'projected-control'] } })
  expect(readFileSync(join(root, 'draft.json'), 'utf8')).toBe(unsupported)
  expect(readFileSync(join(root, 'content/ui/combined.json'), 'utf8')).toBe(unsupported)
})

test('draft and registered UI inspections expose text/control overlaps without turning candidates into a failed gate', () => {
  const { root, index } = fixture()
  const ui = { schema: 'beegame-content.v1', kind: 'ui-screen', id: 'hud', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root' },
      { id: 'score', role: 'text', text: 'Score', parentId: 'root', layout: { position: [12, 10], size: [140, 28] } },
      { id: 'lives', role: 'text', text: 'Lives', parentId: 'root', layout: { position: [90, 10], size: [140, 28] } },
      { id: 'pause', role: 'button', parentId: 'root', layout: { position: [123, 8], size: [72, 32] } },
    ],
  } }
  const source = JSON.stringify(ui)
  writeFileSync(join(root, 'draft.json'), source)
  mkdirSync(join(root, 'content/ui'))
  writeFileSync(join(root, 'content/ui/hud.json'), source)
  index.files.push('ui/hud.json')
  writeFileSync(join(root, 'content/index.json'), JSON.stringify(index))
  for (const args of [['--layout-draft', 'draft.json'], ['--layout', 'ui/hud.json']]) {
    expect(runGameContentCommand(root, [...args, '390', '844'])).toMatchObject({
      ok: true, runtimeVerified: false, boundaryChecks: [], diagnostics: {
        outsideViewport: [], outsideParent: [], outsideContentArea: [],
        overlapCandidates: [['score', 'lives'], ['score', 'pause'], ['lives', 'pause']],
      },
    })
  }
  expect(readFileSync(join(root, 'draft.json'), 'utf8')).toBe(source)
  expect(readFileSync(join(root, 'content/ui/hud.json'), 'utf8')).toBe(source)
})

test('one draft inspection includes authored threshold neighbours instead of only its requested reference size', () => {
  const root = mkdtempSync(join(tmpdir(), 'layout-boundary-'))
  roots.push(root)
  const ui = { schema: 'beegame-content.v1', kind: 'ui-screen', id: 'menu', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', data: { compactMaxWidth: 740 } },
      { id: 'title', role: 'text', parentId: 'root', text: 'Title', layout: { position: [0, -10], size: [100, 50] },
        responsive: { compact: { layout: { position: [0, 0] } } } },
    ],
  } }
  const source = JSON.stringify(ui)
  writeFileSync(join(root, 'draft.json'), source)
  const result = runGameContentCommand(root, ['--layout-draft', 'draft.json', '700', '400'])
  expect(result).toMatchObject({ ok: true, diagnostics: { outsideViewport: [] }, boundaryChecks: [
    { trigger: 'compact', viewport: { width: 740, height: 400 }, diagnostics: { outsideViewport: [] } },
    { trigger: 'compact', viewport: { width: 741, height: 400 }, diagnostics: { outsideViewport: ['title'] } },
  ] })
  expect(readFileSync(join(root, 'draft.json'), 'utf8')).toBe(source)
})

test('planning CLI computes required container extent and exposes padding overflow without mutating input', async () => {
  await initializeUiLayout()
  const root = mkdtempSync(join(tmpdir(), 'layout-capacity-'))
  roots.push(root)
  const ui = { schema: 'beegame-content.v1', kind: 'ui-screen', id: 'controls', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', layout: { container: { direction: 'column', align: 'stretch' } } },
      { id: 'group', role: 'container', parentId: 'root', layout: { container: {
        direction: 'column', gap: 8, padding: [16, 16, 24, 16],
      } } },
      ...['first', 'second', 'third'].map(id => ({ id, role: 'button', parentId: 'group',
        layout: { size: [80, 48], minSize: [80, 48] } })),
    ],
  } }
  const source = JSON.stringify(ui)
  writeFileSync(join(root, 'auto.json'), source)
  const natural = runGameContentCommand(root, ['--layout-draft', 'auto.json', '375', '667'])
  if (!('nodes' in natural) || !natural.nodes || natural.scope !== 'layout-draft-inspection') throw new Error('Expected UI nodes')
  const group = natural.nodes.find(node => node.id === 'group')
  if (!group || !('layout' in group)) throw new Error('Expected UI group')
  expect(group.layout?.size).toEqual([375, 200])
  expect(natural.runtimeVerified).toBe(false)
  const constrained = structuredClone(ui)
  Object.assign(constrained.data.nodes[1].layout, { size: [375, 190] })
  writeFileSync(join(root, 'constrained.json'), JSON.stringify(constrained))
  const tooSmall = runGameContentCommand(root, ['--layout-draft', 'constrained.json', '375', '667'])
  if (!('nodes' in tooSmall) || !tooSmall.nodes) throw new Error('Expected UI nodes')
  expect(tooSmall.nodes.find(node => node.id === 'third')).toMatchObject({
    outsideParent: false, outsideViewport: false, outsideContentArea: true,
  })
  expect(readFileSync(join(root, 'auto.json'), 'utf8')).toBe(source)
})

test('portrait and landscape compositions supply their computed game-view size to Scene framing', async () => {
  await initializeUiLayout()
  const root = mkdtempSync(join(tmpdir(), 'spatial-draft-'))
  roots.push(root)
  const ui = { schema: 'beegame-content.v1', kind: 'ui-hud', id: 'hud', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'hud-root', layout: { container: { direction: 'row', align: 'stretch' } },
        responsive: { portrait: { layout: { container: { direction: 'column' } } } } },
      { id: 'hud', role: 'container', parentId: 'root', layout: { item: { basis: 120 } },
        responsive: { portrait: { layout: { item: { basis: 48 } } } } },
      { id: 'game-view', role: 'container', parentId: 'root', layout: { item: { grow: 1 } } },
    ],
  } }
  const scene = { schema: 'beegame-content.v1', kind: 'scene-2d', id: 'world', assetRefs: [], data: {
    settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 200, height: 200, pixelsPerUnit: 100 } }, cameraNodeId: 'camera', nodes: [
      { id: 'camera', components: [{ id: 'cam', type: 'camera', data: {
        orthographic: true, orthographicSize: 1, coordinateSpace: 'logical-pixels', viewport: { width: 200, height: 200 }, framing: 'expand',
      } }] },
      { id: 'board', components: [{ id: 'sprite', type: 'sprite-renderer', data: { size: [200, 200] } }] },
    ],
  } }
  const before = JSON.stringify(ui)
  writeFileSync(join(root, 'ui.json'), before)
  writeFileSync(join(root, 'scene.json'), JSON.stringify(scene))
  writeFileSync(join(root, 'camera.json'), JSON.stringify(scene.data.nodes[0].components[0].data))
  for (const [w, h, expected] of [
    [390, 844, { left: 0, top: 48, right: 390, bottom: 844 }],
    [667, 375, { left: 120, top: 0, right: 667, bottom: 375 }],
    [400, 399, { left: 120, top: 0, right: 400, bottom: 399 }],
    [400, 400, { left: 120, top: 0, right: 400, bottom: 400 }],
    [400, 401, { left: 0, top: 48, right: 400, bottom: 401 }],
  ] as const) {
    const result = runGameContentCommand(root, ['--layout-draft', 'ui.json', String(w), String(h)])
    if (!('nodes' in result) || !result.nodes || result.scope !== 'layout-draft-inspection') throw new Error('Expected UI layout')
    const nodes = result.nodes as ReturnType<typeof inspectUiLayout>
    const game = nodes.find(node => node.id === 'game-view')!
    expect(game.bounds).toEqual(expected)
    const hud = nodes.find(node => node.id === 'hud')!
    expect(hud.bounds).toEqual(h > w ? { left: 0, top: 0, right: w, bottom: 48 }
      : { left: 0, top: 0, right: 120, bottom: h })
    expect(nodes.every(node => !node.outsideViewport && !node.outsideParent)).toBe(true)
    const width = game.bounds.right - game.bounds.left, height = game.bounds.bottom - game.bounds.top
    const connected = runGameContentCommand(root, ['--layout-draft', 'ui.json', String(w), String(h),
      '--game-view', 'game-view', '--camera', 'camera.json'])
    expect(connected).toMatchObject({ runtimeVerified: false,
      gameView: { nodeId: 'game-view', bounds: expected, viewport: { width, height } },
      cameraView: { rect: { x: 0, y: 0, width, height } },
    })
    const framing = runGameContentCommand(root, ['--layout-draft', 'scene.json', String(width), String(height)])
    expect(framing).toMatchObject({ runtimeVerified: false,
      view: { rect: { x: 0, y: 0, width, height } }, nodes: [{ id: 'camera' }, { id: 'board', fullyInside: true }],
    })
  }
  expect(readFileSync(join(root, 'ui.json'), 'utf8')).toBe(before)
  const changed = structuredClone(ui)
  const portraitItem = changed.data.nodes[1].responsive?.portrait.layout.item
  if (!portraitItem) throw new Error('Expected portrait HUD item in fixture')
  portraitItem.basis = 96
  writeFileSync(join(root, 'changed.json'), JSON.stringify(changed))
  expect(runGameContentCommand(root, ['--layout-draft', 'changed.json', '390', '844',
    '--game-view', 'game-view', '--camera', 'camera.json'])).toMatchObject({
    gameView: { bounds: { left: 0, top: 96, right: 390, bottom: 844 }, viewport: { width: 390, height: 748 } },
    cameraView: { rect: { width: 390, height: 748 } },
  })
  expect(() => runGameContentCommand(root, ['--layout-draft', 'ui.json', '390', '844',
    '--game-view', 'absent', '--camera', 'camera.json'])).toThrow('exist and be active')
  const hidden = structuredClone(ui)
  Object.assign(hidden.data.nodes[2], { enabled: false })
  writeFileSync(join(root, 'hidden.json'), JSON.stringify(hidden))
  expect(() => runGameContentCommand(root, ['--layout-draft', 'hidden.json', '390', '844',
    '--game-view', 'game-view', '--camera', 'camera.json'])).toThrow('exist and be active')
  expect(() => runGameContentCommand(root, ['--layout-draft', 'ui.json', '390', '844',
    '--game-view', 'game-view', '--camera', join(root, 'camera.json')])).toThrow('inside')
  expect(() => runGameContentCommand(root, ['--layout-draft', 'ui.json', '390', '844',
    '--game-view', 'game-view', '--unknown', 'camera.json'])).toThrow('Usage')
  expect(() => readFileSync(join(root, 'content/index.json'))).toThrow()
})

test.each(['--camera-draft', '--layout-draft', '--layout'])('%s diagnoses argument-boundary errors before file or capability checks', command => {
  const { root } = fixture()
  for (const dimensions of [['700 410'], ['700 410', '--game-view'], ['700', 'NaN'], ['0', '410'], ['Infinity', '410']])
    expect(() => runGameContentCommand(root, [command, 'not-created.json', ...dimensions]))
      .toThrow('two separate positive numeric arguments')
})

test('camera draft reuses shared projection math and rejects invalid size and escaped files', () => {
  const { root } = fixture()
  const camera = { orthographic: false, fieldOfView: 60,
    viewport: { width: 960, height: 540 }, framing: 'expand' }
  const source = JSON.stringify(camera)
  writeFileSync(join(root, 'camera.json'), source)
  const result = runGameContentCommand(root, ['--camera-draft', 'camera.json', '390', '796'])
  expect(result).toMatchObject({ scope: 'camera-framing-draft-inspection', runtimeVerified: false,
    view: { projection: 'perspective', rect: { width: 390, height: 796 } } })
  if (!('view' in result) || !result.view) throw new Error('Expected camera view')
  expect(result.view.verticalFieldOfView).toBeGreaterThan(60)
  expect(readFileSync(join(root, 'camera.json'), 'utf8')).toBe(source)
  expect(() => runGameContentCommand(root, ['--camera-draft', 'camera.json', '0', '796'])).toThrow('positive')
  expect(() => runGameContentCommand(root, ['--camera-draft', join(root, 'camera.json'), '390', '796'])).toThrow('inside')
  const outside = mkdtempSync(join(tmpdir(), 'spatial-outside-'))
  roots.push(outside)
  writeFileSync(join(outside, 'camera.json'), source)
  symlinkSync(join(outside, 'camera.json'), join(root, 'escaped.json'))
  expect(() => runGameContentCommand(root, ['--camera-draft', 'escaped.json', '390', '796'])).toThrow('inside')
})

test('large scenes have a compact node index and exact node access without rewriting content', () => {
  const { root, doc, index } = fixture()
  const path = join(root, 'content/scenes/level.json')
  const before = readFileSync(path)
  expect(before.length).toBeGreaterThan(256 * 1024)
  expect(inspectGameContent(root).index).toEqual(index)
  const summary = inspectGameContent(root, 'scenes/level.json')
  expect(summary.nodeCount).toBe(600)
  expect(summary.nodeIds).toEqual(doc.data.nodes.map(n => n.id))
  expect(JSON.stringify(summary).length).toBeLessThan(before.length / 20)
  const result = runGameContentCommand(root, ['--inspect', 'scenes/level.json', '--node', 'node-300'])
  expect('node' in result && result.node).toEqual(doc.data.nodes[300])
  expect(readFileSync(path)).toEqual(before)
})

test('missing CLI inputs still identify the actual workspace and missing source', async () => {
  const root=mkdtempSync(join(tmpdir(),'bgs-missing-check-input-'));roots.push(root)
  const checker=await sharedContentChecker()
  const entry=join(root,'check-content.mjs');writeFileSync(entry,CONTENT_CHECKER_ENTRY)
  const child=Bun.spawn([process.execPath,entry,root,'--layout-draft','content/ui/missing.json','640','360'],
    {env:{...process.env,BEEGAME_CONTENT_CHECKER_MODULE:checker.moduleUrl},stdout:'pipe',stderr:'pipe'})
  const [output,errors,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
  expect(code,errors).toBe(1)
  const result=JSON.parse(output)
  expect(result.valid).toBe(false)
  expect(result.inputLocation.workspace).toBe(realpathSync(root))
  expect(result.inputLocation.sources).toContainEqual({path:'content/ui/missing.json',state:'unavailable'})
})

test('inspection fails explicitly for unknown files/nodes, ambiguous nodes and invalid arguments', () => {
  const { root, doc } = fixture()
  expect(() => inspectGameContent(root, '../outside.json')).toThrow('registered')
  expect(() => inspectGameContent(root, 'scenes/level.json', 'absent')).toThrow('found 0')
  doc.data.nodes.push(doc.data.nodes[0]!)
  writeFileSync(join(root, 'content/scenes/level.json'), JSON.stringify(doc))
  expect(() => inspectGameContent(root, 'scenes/level.json', 'node-0')).toThrow('found 2')
  expect(() => runGameContentCommand(root, ['--inspect', 'scenes/level.json', '--node'])).toThrow('Usage')
  expect(() => runGameContentCommand(root, ['--unknown'])).toThrow('Usage')
})

test('inspection does not follow indexed symlinks outside the content directory', () => {
  const { root } = fixture()
  const path = join(root, 'content/scenes/level.json')
  rmSync(path)
  writeFileSync(join(root, 'outside.json'), '{}')
  symlinkSync(join(root, 'outside.json'), path)
  expect(() => inspectGameContent(root, 'scenes/level.json')).toThrow('outside')
})

test('layout command resolves screen rectangles read-only and rejects invalid requests', () => {
  const { root, index } = fixture()
  mkdirSync(join(root, 'content/ui'))
  index.files.push('ui/menu.json')
  writeFileSync(join(root, 'content/index.json'), JSON.stringify(index))
  const path = join(root, 'content/ui/menu.json')
  writeFileSync(path, JSON.stringify({ kind: 'ui-screen', data: { rootId: 'root', nodes: [
    { id: 'root', layout: { size: [960, 540] } },
    { id: 'title', parentId: 'root', layout: { anchor: 'top-center', size: [200, 40] } },
  ] } }))
  const before = readFileSync(path)
  const result = runGameContentCommand(root, ['--layout', 'ui/menu.json', '640', '360'])
  expect(result).toMatchObject({ ok: true, scope: 'layout-inspection', runtimeVerified: false,
    nodes: [{ id: 'root' }, { id: 'title', bounds: { left: 220, right: 420, top: 0, bottom: 40 } }] })
  expect(runGameContentCommand(root, ['--layout', 'content/ui/menu.json', '640', '360'])).toEqual(result)
  expect(readFileSync(path)).toEqual(before)
  expect(() => runGameContentCommand(root, ['--layout', 'ui/menu.json', '0', '360'])).toThrow('positive')
  expect(() => runGameContentCommand(root, ['--layout', 'scenes/level.json', '640', '360'])).toThrow('pixelsPerUnit')
  expect(() => runGameContentCommand(root, ['--layout', '../outside.json', '640', '360'])).toThrow('registered')
  expect(() => runGameContentCommand(root, ['--layout', 'ui/menu.json'])).toThrow('Usage')
})

test('planning geometry needs neither an index nor resources and cannot read outside the workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-layout-draft-'))
  roots.push(root)
  const document = { schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [], data: { rootId: 'root', nodes: [
    { id: 'root', role: 'screen-root', layout: { container: { direction: 'column', gap: 12, align: 'center', justify: 'center' } } },
    { id: 'play', parentId: 'root', role: 'button', text: 'Start', layout: { size: [180, 44], minSize: [120, 44] } },
    { id: 'help', parentId: 'root', role: 'button', layout: { size: [180, 44] } },
  ] } }
  const file = join(root, 'draft.json')
  writeFileSync(file, JSON.stringify(document))
  const before = readFileSync(file)
  const result = runGameContentCommand(root, ['--layout-draft', 'draft.json', '390', '300'])
  expect(result).toMatchObject({ scope: 'layout-draft-inspection', runtimeVerified: false,
    nodes: [{ id: 'root' }, { id: 'play', textFit: 'unmeasured', bounds: { left: 105, top: 100, right: 285, bottom: 144 } }, { id: 'help' }] })
  expect(readFileSync(file)).toEqual(before)
  expect(() => runGameContentCommand(root, ['--layout-draft', 'draft.json', '0', '300'])).toThrow('positive')
  const external = mkdtempSync(join(tmpdir(), 'ui-layout-external-'))
  roots.push(external)
  writeFileSync(join(external, 'outside.json'), JSON.stringify(document))
  symlinkSync(join(external, 'outside.json'), join(root, 'link.json'))
  expect(() => runGameContentCommand(root, ['--layout-draft', 'link.json', '390', '300'])).toThrow('inside')
})

test('scene geometry uses the authored Camera without requiring document authority or mutating source', () => {
  const {root}=fixture()
  const file=join(root,'content/scenes/level.json')
  const document={schema:'beegame-content.v1',id:'level',kind:'scene-2d',assetRefs:[],data:{cameraNodeId:'camera',
    settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:1280,height:720,pixelsPerUnit:100}},nodes:[
      {id:'camera',transform:{position:[640,360,1000]},components:[{id:'cam',type:'camera',data:{orthographic:true,orthographicSize:2,
        coordinateSpace:'logical-pixels',viewport:{width:1280,height:720},framing:'expand'}}]},
      {id:'player',transform:{position:[640,360,0]},components:[{id:'sprite',type:'sprite-renderer',data:{size:[40,40]}}]},
    ]}}
  const before=JSON.stringify(document);writeFileSync(file,before)
  const result=runGameContentCommand(root,['--layout','scenes/level.json','390','844'])
  expect(result).toMatchObject({scope:'scene-layout-inspection',runtimeVerified:false,cameraNodeId:'camera',
    nodes:[{id:'camera'},{id:'player',fullyInside:true}]})
  const draft=runGameContentCommand(root,['--layout-draft','content/scenes/level.json','390','844'])
  expect(draft).toMatchObject({scope:'scene-layout-draft-inspection',runtimeVerified:false})
  expect(readFileSync(file,'utf8')).toBe(before)
})

test('validation feedback never claims runtime or playability verification', () => {
  const { root } = fixture()
  mkdirSync(join(root, '.beegame/workflow'), { recursive: true })
  writeFileSync(join(root, '.beegame/workflow/run.json'), JSON.stringify({ revision: {} }))
  const result = runGameContentCommand(root)
  expect(result).toMatchObject({
    valid: false, scope: 'content-contract-and-references', runtimeVerified: false,
  })
})

test('load footprint separates startup files and deduplicates assets shared with deferred documents', () => {
  const index = parseBeeGameContentIndex({
    schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
    documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
    entryScene: 'level', files: ['scenes/level.json', 'ui/menu.json', 'vfx/spark.json'],
    sceneModel: 'game-object-v2', documents: [
      { id: 'level', path: 'scenes/level.json', kind: 'scene-2d', loadPhase: 'startup' },
      { id: 'menu', path: 'ui/menu.json', kind: 'ui-screen', loadPhase: 'startup' },
      { id: 'spark', path: 'vfx/spark.json', kind: 'vfx', loadPhase: 'on-demand' },
    ],
  })
  const content = { documents: [
    { id: 'level', assetRefs: ['terrain', 'shared'] },
    { id: 'menu', assetRefs: ['shared'] },
    { id: 'spark', assetRefs: ['shared', 'spark'] },
  ] } as unknown as BeeGameContentPackage
  const manifest = { resources: [
    { id: 'terrain', file_paths: ['terrain.webp'] },
    { id: 'shared', file_paths: ['shared.webp'] },
    { id: 'spark', file_paths: ['spark.webp'] },
  ] } as BeeGameAssetManifest
  const sizes = new Map([['terrain.webp', 100], ['shared.webp', 20], ['spark.webp', 40]])

  expect(summarizeContentLoadFootprint(index, content, manifest, path => sizes.get(path) ?? 0)).toEqual({
    basis: 'static manifest-file estimate; deferredOnly excludes startup assets/files; raw bytes, not transfer size or runtime proof',
    startup: { documentCount: 2, assetCount: 2, fileCount: 2, rawBytes: 120 },
    deferredOnly: { documentCount: 1, assetCount: 1, fileCount: 1, rawBytes: 40 },
  })
})

test('migrated native projects validate authored content instead of stale workflow revisions', () => {
  const { root } = fixture()
  mkdirSync(join(root, '.beegame/workflow'), { recursive: true })
  mkdirSync(join(root, '.beegame/delivery'), { recursive: true })
  writeFileSync(join(root, '.beegame/workflow/run.json'), JSON.stringify({ revision: {} }))
  writeFileSync(join(root, '.beegame/delivery/content-contract.json'), '{}')
  const result = runGameContentCommand(root)
  expect(result).toMatchObject({ scope: 'content-contract-and-references', runtimeVerified: false })
  expect('issues' in result && result.issues).not.toContain('An accepted Asset Manifest revision is required.')
})
