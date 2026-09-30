import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectGameContent, runGameContentCommand, summarizeContentLoadFootprint } from './game-content-validation-cli'
import { parseBeeGameContentIndex, type BeeGameContentPackage } from './game-content-package'
import type { BeeGameAssetManifest } from './asset-contracts'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import type { inspectUiLayout } from '../../../scene-editor/src/ui-layout-inspection'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
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
      { id: 'root', role: 'container', layout: { container: { direction: 'row', align: 'stretch' } },
        responsive: { portrait: { layout: { container: { direction: 'column' } } } } },
      { id: 'hud', role: 'container', parentId: 'root', layout: { item: { basis: 120 } },
        responsive: { portrait: { layout: { item: { basis: 48 } } } } },
      { id: 'game-view', role: 'container', parentId: 'root', layout: { item: { grow: 1 } } },
    ],
  } }
  const scene = { schema: 'beegame-content.v1', kind: 'scene-2d', id: 'world', assetRefs: [], data: {
    settings: { coordinateSystem: { pixelsPerUnit: 100 } }, cameraNodeId: 'camera', nodes: [
      { id: 'camera', components: [{ id: 'cam', type: 'camera', data: {
        orthographic: true, orthographicSize: 1, viewport: { width: 200, height: 200 }, framing: 'expand',
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
