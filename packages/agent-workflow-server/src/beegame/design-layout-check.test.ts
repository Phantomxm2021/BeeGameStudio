import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignLayouts, checkReviewUiLayouts, checkReviewSceneLayouts, checkReviewDesignLayouts } from './design-layout-check'
import { designSupportingFileDigest } from './design-handoff'
import { runGameContentCommand } from './game-content-validation-cli'
import { uiLayoutFixture, sceneLayoutFixture } from './fixtures/layout-fixture'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bgs-design-layout-'))
  roots.push(root)
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  mkdirSync(join(root, 'docs'))
  const path = join(root, 'content/ui/menu.json')
  return { root, path, save: (value: unknown) => writeFileSync(path, JSON.stringify(value)) }
}

function sceneDraft() {
  const f = fixture(), scene = sceneLayoutFixture() as any
  mkdirSync(join(f.root, 'content/scenes'), { recursive: true })
  const path = join(f.root, 'content/scenes/level.json')
  const saveScene = () => writeFileSync(path, JSON.stringify(scene))
  saveScene()
  writeFileSync(join(f.root, 'docs/LEVEL_SCENE_DESIGN.md'), '# Scene\n[Level](../content/scenes/level.json)\n')
  return { ...f, scene, scenePath: path, saveScene }
}

test('UI Review rejects illegal resource slots before freezing but accepts genuinely unbound image drafts', () => {
  const f = fixture(), ui = uiLayoutFixture() as any
  writeFileSync(join(f.root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n')
  ui.data.nodes.push({ id: 'decoration', role: 'emitter', parentId: 'root',
    layout: { size: [20, 20] }, assetRef: 'future-effect' })
  f.save(ui)
  expect(checkReviewUiLayouts(f.root).issues.join(' ')).toContain('cannot own assetRef (decoration)')
  delete ui.data.nodes[2].assetRef
  ui.data.nodes[2].role = 'image'
  f.save(ui)
  expect(checkReviewUiLayouts(f.root).issues).toEqual([])
  expect(runGameContentCommand(f.root, ['--check-drafts', 'content/ui/menu.json'])).toMatchObject({ valid: true })
})

test('Review requires owner-linked Scene drafts, not an asset manifest, package or model PASS', () => {
  const f = sceneDraft()
  const before = readFileSync(f.scenePath, 'utf8')
  expect(checkReviewSceneLayouts(f.root)).toMatchObject({ valid: true, files: ['content/scenes/level.json'] })
  expect(readFileSync(f.scenePath, 'utf8')).toBe(before)
  rmSync(f.scenePath)
  expect(checkReviewSceneLayouts(f.root).valid).toBe(false)
  f.saveScene()
  writeFileSync(join(f.root, 'docs/LEVEL_SCENE_DESIGN.md'), '# Scene\n')
  expect(checkReviewSceneLayouts(f.root).issues.join(' ')).toContain('Link the planned Scene JSON')
})

test.each(['duplicate-node', 'missing-parent', 'cycle', 'wrong-kind', 'invalid-transform', 'missing-camera'])(
  'Scene Review rejects %s using saved inputs', fault => {
    const f = sceneDraft()
    if (fault === 'duplicate-node') f.scene.data.nodes.push(f.scene.data.nodes[1])
    if (fault === 'missing-parent') f.scene.data.nodes[1].parentId = 'missing'
    if (fault === 'cycle') f.scene.data.nodes[1].parentId = 'board'
    if (fault === 'wrong-kind') Object.assign(f.scene, uiLayoutFixture())
    if (fault === 'invalid-transform') f.scene.data.nodes[1].transform.position = [1, 2]
    if (fault === 'missing-camera') f.scene.data.cameraNodeId = 'board'
    f.saveScene()
    expect(checkReviewSceneLayouts(f.root).valid).toBe(false)
  })

test('Scene Review rejects symlink sources rather than granting repair scope through an alias', () => {
  const f = sceneDraft(), other = sceneDraft()
  rmSync(f.scenePath)
  symlinkSync(other.scenePath, f.scenePath)
  expect(checkReviewSceneLayouts(f.root).issues.join(' ')).toContain('must not be a symlink')
})

test('joint Review uses the same required Scene inside the allocated UI game-view, not standalone framing', () => {
  const f = sceneDraft(), ui = uiLayoutFixture() as any
  f.scene.data.nodes[0].components[0].data.framing = 'keep-height'
  f.scene.data.settings.requiredVisibleNodeIds = ['board']
  f.scene.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: { size: [700, 300] } }]
  f.saveScene(); f.save(ui)
  writeFileSync(join(f.root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n')
  expect(checkReviewDesignLayouts(f.root).issues.join(' ')).toContain('needs a layoutCamera link')
  ui.data.nodes.push({ id: 'game-view', role: 'container', parentId: 'root', layout: { size: [300, 300] } })
  ui.data.nodes[0].data.layoutCamera = { nodeId: 'game-view', path: 'content/scenes/level.json' }
  f.save(ui)
  expect(checkReviewDesignLayouts(f.root).issues.join(' ')).toContain('Scene required visibility failed: board')
  ui.data.nodes[2].layout.size = [560, 300]
  f.save(ui)
  expect(checkReviewDesignLayouts(f.root).valid).toBe(true)
})

test('a wrong UI viewport ID reports its source field once, not one generic error per target', () => {
  const f = sceneDraft(), ui = uiLayoutFixture() as any
  ui.data.nodes[0].data.targetViewports = [[960, 540], [1280, 720]]
  ui.data.nodes[0].data.layoutCamera = [{ nodeId: 'missing-view', path: 'content/scenes/level.json' }]
  f.save(ui)
  const check = checkDesignLayouts(f.root)
  expect(check.valid).toBe(false)
  expect(check.issues).toHaveLength(1)
  expect(check.issues[0]).toContain('root.data.layoutCamera.nodeId "missing-view"')
  expect(check.issues[0]).toContain('nodes[].id')
  expect(check.issues[0]).not.toContain('1280x720')
})

test('shared UI checks every linked Scene; a second level cannot escape framing checks', () => {
  const f = sceneDraft(), ui = uiLayoutFixture() as any
  f.scene.data.settings.requiredVisibleNodeIds = ['board']
  f.scene.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: { size: [100, 100] } }]
  f.saveScene()
  const other = structuredClone(f.scene)
  other.id = 'other'
  other.data.nodes[0].components[0].data.framing = 'keep-height'
  other.data.nodes[1].components[0].data.size = [1200, 300]
  writeFileSync(join(f.root, 'content/scenes/other.json'), JSON.stringify(other))
  writeFileSync(join(f.root, 'docs/LEVEL_SCENE_DESIGN.md'), '# Scene\n[First](../content/scenes/level.json)\n[Second](../content/scenes/other.json)\n')
  ui.data.nodes.push({ id: 'game-view', role: 'container', parentId: 'root', layout: { size: [560, 300] } })
  ui.data.nodes[0].data.layoutCamera = [
    { nodeId: 'game-view', path: 'content/scenes/level.json' },
    { nodeId: 'game-view', path: 'content/scenes/other.json' },
  ]
  f.save(ui)
  writeFileSync(join(f.root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n')
  const failed = checkReviewDesignLayouts(f.root)
  expect(failed.issues.join(' ')).toContain('Scene content/scenes/other.json')
  expect(failed.issues.join(' ')).toContain('required visibility failed: board')
  expect(failed.issues.join(' ')).not.toContain('needs a layoutCamera link')
  other.data.nodes[1].components[0].data.size = [100, 100]
  writeFileSync(join(f.root, 'content/scenes/other.json'), JSON.stringify(other))
  expect(checkReviewDesignLayouts(f.root).valid).toBe(true)
  ui.data.nodes[0].data.layoutCamera.push({ nodeId: 'game-view', path: '../outside.json' })
  f.save(ui)
  expect(checkReviewDesignLayouts(f.root).valid).toBe(false)
})

test('Review defers only unavailable TileSet visual bounds; Content remains strict', () => {
  const f = sceneDraft(), ui = uiLayoutFixture() as any
  f.scene.data.settings.requiredVisibleNodeIds = ['board']
  f.scene.data.nodes[1].components = [
    { id: 'grid', type: 'grid', data: { schema: 'grid.v1', cellSize: [32, 32] } },
    { id: 'map', type: 'tilemap', data: { schema: 'tilemap.v1', gridNodeId: 'board', cells: [{ x: 0, y: 0, tileId: 'wall' }] } },
    { id: 'renderer', type: 'tilemap-renderer', data: { schema: 'tilemap-renderer.v1' } },
  ]
  f.saveScene()
  ui.data.nodes.push({ id: 'game-view', role: 'container', parentId: 'root', layout: { size: [560, 300] } })
  ui.data.nodes[0].data.layoutCamera = { nodeId: 'game-view', path: 'content/scenes/level.json' }
  f.save(ui)
  writeFileSync(join(f.root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n')
  const before = readFileSync(f.scenePath, 'utf8')
  const review = checkReviewDesignLayouts(f.root)
  expect(review.issues).toEqual([])
  expect(review.valid).toBe(true)
  expect(review.deferred?.join(' ')).toContain('not a visibility PASS')
  expect(checkReviewDesignLayouts(f.root, undefined, false).valid).toBe(false)
  expect(checkDesignLayouts(f.root).valid).toBe(false)
  expect(runGameContentCommand(f.root, ['--design-layouts', '--draft'])).toMatchObject({ valid: true })
  expect(runGameContentCommand(f.root, ['--design-layouts'])).toMatchObject({ valid: false })
  expect(readFileSync(f.scenePath, 'utf8')).toBe(before)
  // Unknown sprite dimensions are an owner omission, not a future TileSet.
  f.scene.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: {} }]
  f.saveScene()
  expect(checkReviewDesignLayouts(f.root).valid).toBe(false)
  // A known out-of-view descendant still blocks even when its sibling awaits resources.
  f.scene.data.nodes[1].components = [
    { id: 'grid', type: 'grid', data: { schema: 'grid.v1', cellSize: [32, 32] } },
    { id: 'map', type: 'tilemap', data: { schema: 'tilemap.v1', gridNodeId: 'board', cells: [] } },
    { id: 'renderer', type: 'tilemap-renderer', data: { schema: 'tilemap-renderer.v1' } },
  ]
  f.scene.data.nodes.push({ id: 'outside', parentId: 'board', transform: { position: [10000, 0, 0] },
    components: [{ id: 'visual', type: 'sprite-renderer', data: { size: [100, 100] } }] })
  f.saveScene()
  expect(checkReviewDesignLayouts(f.root).issues.join(' ')).toContain('required visibility failed')
})

test('Scene draft and Content share component/coordinate rules; only missing resource bindings are deferred', () => {
  const f = sceneDraft()
  f.scene.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: { size: [100, 100] } }]
  f.saveScene()
  expect(checkReviewSceneLayouts(f.root).valid).toBe(true)
  f.scene.data.nodes[1].components.push({ id: 'collider', type: 'box-collider-2d', data: { size: [100, 100] } })
  delete f.scene.data.settings.coordinateSystem.units
  f.saveScene()
  const issues = checkReviewSceneLayouts(f.root).issues.join(' ')
  expect(issues).toContain('data.offset[2]')
  expect(issues).toContain('coordinateSystem.units')
  expect(issues).not.toContain('requires assetRef')
})

test('UI resource binding is not permission to replace Camera linkage or reduce authored typography', () => {
  const f = fixture(), ui = uiLayoutFixture() as any
  ui.data.nodes[1].style = { fontSize: 24 }
  f.save(ui)
  const before = designSupportingFileDigest(f.root, 'content/ui/menu.json')
  ui.data.nodes[1].data = { font: { assetRef: 'delivered-font' } }
  f.save(ui)
  expect(designSupportingFileDigest(f.root, 'content/ui/menu.json')).toBe(before)
  ui.data.nodes[1].style.fontSize = 12; f.save(ui)
  expect(designSupportingFileDigest(f.root, 'content/ui/menu.json')).not.toBe(before)
  ui.data.nodes[1].style.fontSize = 24
  ui.data.nodes[0].data.layoutCamera = { nodeId: 'game-view', path: 'content/scenes/other.json' }; f.save(ui)
  expect(designSupportingFileDigest(f.root, 'content/ui/menu.json')).not.toBe(before)
  delete ui.data.nodes[0].data.layoutCamera
  ui.data.nodes[1].responsive = { compact: { style: { fontSize: 12 } } }; f.save(ui)
  expect(designSupportingFileDigest(f.root, 'content/ui/menu.json')).not.toBe(before)
})

function layers() {
  const f = fixture()
  const base = uiLayoutFixture() as any
  base.data.nodes.push({ id: 'reserved', role: 'container', parentId: 'root',
    data: { layoutOcclusion: 'protected' }, layout: { anchor: 'middle-center', position: [-180, 0], size: [120, 80] },
    responsive: { compact: { layout: { position: [0, 0] } } } })
  const overlay = uiLayoutFixture(60) as any
  overlay.id = 'overlay'
  overlay.data.nodes[0].data.layoutUnderlay = { path: 'content/ui/menu.json', clearance: 'preserve' }
  overlay.data.nodes[1].data = { layoutOcclusion: 'occluder' }
  overlay.data.nodes[1].layout.size = [80, 60]
  f.save(base)
  const overlayPath = join(f.root, 'content/ui/overlay.json')
  writeFileSync(overlayPath, JSON.stringify(overlay))
  writeFileSync(join(f.root, 'docs/UI_UX_SPEC.md'), '# UI\n[Base](../content/ui/menu.json)\n[Overlay](../content/ui/overlay.json)\n')
  return { ...f, base, overlay, overlayPath, saveOverlay: () => writeFileSync(overlayPath, JSON.stringify(overlay)) }
}

test('multi-Scene clearance compares matching projections, including neutral overlays and canonical links', () => {
  const f = fixture()
  for (const [name, size] of [['a', 3], ['b', 6]] as const)
    writeFileSync(join(f.root, name + '.json'), JSON.stringify({ orthographic: true, orthographicSize: size,
      pixelsPerUnit: 100, viewport: { width: 1000, height: 600 }, framing: 'letterbox' }))
  const links = ['a', 'b'].map(name => ({ nodeId: 'view', path: name + '.json' }))
  const composition = (overlay: boolean): any => ({ schema: 'beegame-content.v1', id: overlay ? 'overlay' : 'base', kind: 'ui-screen', assetRefs: [],
    data: { rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', layout: { size: [1000, 600] }, data: { orientation: 'Landscape', referenceResolution: [1000, 600],
        targetViewports: [[1000, 600]], layoutCamera: links, ...(overlay ? { layoutUnderlay: { path: 'content/ui/menu.json', clearance: 'preserve' } } : {}) } },
      { id: 'view', role: 'container', parentId: 'root', layout: { size: [1000, 600] } },
      { id: 'plane', role: 'container', parentId: 'view', data: { space: 'camera-reference-2d' }, layout: { size: [1000, 600], item: { absolute: true } } },
      { id: overlay ? 'cover' : 'protected', role: 'container', parentId: 'plane', data: { layoutOcclusion: overlay ? 'occluder' : 'protected' },
        layout: { position: [0, overlay ? 0 : 80], size: [1000, overlay ? 80 : 520] } },
    ] } })
  const base = composition(false), overlay = composition(true)
  overlay.data.nodes[0].data.layoutCamera = links.map(link => ({ ...link, path: './' + link.path }))
  const overlayPath = join(f.root, 'content/ui/overlay.json')
  const saveOverlay = () => writeFileSync(overlayPath, JSON.stringify(overlay))
  f.save(base); saveOverlay()
  // A's protected band overlaps B's cover, but these states never coexist.
  expect(checkDesignLayouts(f.root)).toMatchObject({ valid: true, issues: [] })
  overlay.data.nodes[3].layout.position[1] = 90
  saveOverlay()
  const overlapping = checkDesignLayouts(f.root)
  expect(overlapping.valid).toBe(false)
  expect(overlapping.issues.some(issue => issue.includes('Scene a.json') && issue.includes('intersects'))).toBe(true)
  expect(overlapping.issues.some(issue => issue.includes('Scene b.json') && issue.includes('intersects'))).toBe(true)
  overlay.data.nodes[3].layout.position[1] = 0
  overlay.data.nodes[0].data.layoutCamera = [links[0]]
  saveOverlay()
  expect(checkDesignLayouts(f.root).valid).toBe(true) // An overlay authored only for A does not use B's coordinates.
  base.data.nodes[0].data.layoutCamera = [links[1]]; f.save(base)
  expect(checkDesignLayouts(f.root).issues.join(' ')).toContain('has no camera for Scene')
  base.data.nodes[0].data.layoutCamera = links; f.save(base)
  delete overlay.data.nodes[0].data.layoutCamera
  overlay.data.nodes = [overlay.data.nodes[0], { ...overlay.data.nodes[3], parentId: 'root' }]
  saveOverlay()
  expect(checkDesignLayouts(f.root).valid).toBe(true) // A screen-only overlay applies independently to both Scenes.
  overlay.data.nodes[1].layout.position[1] = 200; saveOverlay()
  expect(checkDesignLayouts(f.root).issues.some(issue => issue.includes('Scene b.json') && issue.includes('intersects'))).toBe(true)
})

test('declared combined clearance catches a compact-only cross-file intersection without copying geometry', () => {
  const f = layers()
  const before = [readFileSync(f.path, 'utf8'), readFileSync(f.overlayPath, 'utf8')]
  const check = checkReviewUiLayouts(f.root)
  expect(check.valid).toBe(false)
  expect(check.issues.join(' ')).toContain('600x360 occluder play intersects preserved content/ui/menu.json#reserved')
  expect(check.issues.some(issue => issue.includes('960x540'))).toBe(false)
  expect(check.compositions).toEqual([{ file: 'content/ui/overlay.json', underlay: 'content/ui/menu.json', clearance: 'preserve' }])
  expect(check.diagnostics.some(item => item.kind === 'underlay-occlusion' && item.geometry && item.closeWhen)).toBe(true)
  expect([readFileSync(f.path, 'utf8'), readFileSync(f.overlayPath, 'utf8')]).toEqual(before)
  f.overlay.data.nodes[1].layout.position = [0, 100]
  f.saveOverlay()
  expect(checkReviewUiLayouts(f.root).valid).toBe(true)
})

test('state-specific allowed cover is not a universal overlap ban and remains version-protected', () => {
  const f = layers()
  const before = designSupportingFileDigest(f.root, 'content/ui/overlay.json')
  f.overlay.data.nodes[0].data.layoutUnderlay.clearance = 'allow-cover'
  f.saveOverlay()
  expect(checkReviewUiLayouts(f.root).valid).toBe(true)
  expect(designSupportingFileDigest(f.root, 'content/ui/overlay.json')).not.toBe(before)
  f.overlay.data.nodes.push({ id: 'local-reserved', role: 'container', parentId: 'root', data: { layoutOcclusion: 'protected' },
    layout: { anchor: 'middle-center', size: [80, 60] } })
  f.saveOverlay()
  expect(checkReviewUiLayouts(f.root).issues.join(' ')).toContain('local-reserved')
})

test('combined clearance cannot use missing declarations, paths, mismatched orientations or cycles as proof', () => {
  const f = layers()
  delete f.overlay.data.nodes[1].data.layoutOcclusion
  f.saveOverlay()
  expect(checkReviewUiLayouts(f.root).issues.join(' ')).toContain('needs declared active occluders')
  const link = f.overlay.data.nodes[0].data.layoutUnderlay
  for (const path of ['/tmp/outside.json', '../outside.json', 'content/ui/missing.json', 'docs/not-ui.json']) {
    link.path = path; f.saveOverlay()
    expect(checkReviewUiLayouts(f.root).valid).toBe(false)
  }
  link.path = 'content/ui/menu.json'
  f.base.data.nodes[0].data.layoutUnderlay = { path: 'content/ui/overlay.json', clearance: 'allow-cover' }
  f.save(f.base); f.saveOverlay()
  expect(checkReviewUiLayouts(f.root).issues.join(' ')).toContain('underlay cycle')
  delete f.base.data.nodes[0].data.layoutUnderlay
  f.base.data.nodes[0].data.orientation = 'Portrait'
  f.save(f.base)
  expect(checkReviewUiLayouts(f.root).issues.join(' ')).toContain('orientations differ')
  delete link.clearance; f.saveOverlay()
  expect(checkReviewUiLayouts(f.root).issues.join(' ')).toContain('explicit clearance')
})

test('retained clearance follows a layer chain but a permitted cover ends inherited protection for that state', () => {
  const f = layers()
  f.overlay.data.nodes[1].layout.position = [0, 100]
  f.saveOverlay()
  const top = structuredClone(f.overlay)
  top.id = 'top'
  top.data.nodes[0].data.layoutUnderlay.path = 'content/ui/overlay.json'
  top.data.nodes[1].layout.position = [0, 0]
  writeFileSync(join(f.root, 'content/ui/top.json'), JSON.stringify(top))
  expect(checkDesignLayouts(f.root).issues.join(' ')).toContain('content/ui/menu.json#reserved')
  f.overlay.data.nodes[0].data.layoutUnderlay.clearance = 'allow-cover'
  f.overlay.data.nodes.push({ id: 'own-reserved', role: 'container', parentId: 'root',
    data: { layoutOcclusion: 'protected' }, layout: { anchor: 'middle-center', position: [-180, 0], size: [40, 40] } })
  f.saveOverlay()
  expect(checkDesignLayouts(f.root).valid).toBe(true)
})

test('final inputs are recalculated without resources, a new report or implicit portrait targets', () => {
  const { root, path, save } = fixture()
  const ui = uiLayoutFixture()
  ui.data.nodes[1]!.layout!.size = [500, 52]
  save(ui)
  const before = readFileSync(path, 'utf8')
  expect(checkDesignLayouts(root, { orientation: 'Landscape' })).toMatchObject({ valid: true, files: ['content/ui/menu.json'] })
  expect(runGameContentCommand(root, ['--design-layouts'])).toMatchObject({ valid: true, runtimeVerified: false, scope: 'design-layout-geometry' })
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(checkDesignLayouts(root, { orientation: 'Portrait' }).issues.join(' ')).toContain('differs from the confirmed brief')
})

test('Review recomputes linked saved geometry without a Content package or claimed PASS', () => {
  const { root } = fixture()
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Layout](../content/ui/menu.json)\n')
  const path = join(root, 'content/ui/menu.json')
  const ui = uiLayoutFixture(28)
  writeFileSync(path, JSON.stringify(ui))
  const before = readFileSync(path, 'utf8')
  expect(runGameContentCommand(root, ['--review-layouts'])).toMatchObject({ valid: false, runtimeVerified: false })
  expect(checkReviewUiLayouts(root).issues.join(' ')).toContain('UI_UX_SPEC.md: content/ui/menu.json:')
  expect(readFileSync(path, 'utf8')).toBe(before)
  ui.data.nodes[1]!.layout!.size![1] = 52
  writeFileSync(path, JSON.stringify(ui))
  expect(checkReviewUiLayouts(root)).toMatchObject({ valid: true, files: ['content/ui/menu.json'] })
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n')
  expect(checkReviewUiLayouts(root).issues.join(' ')).toContain('link this layout')
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Layout](content/ui/menu.json)\n')
  const wrongBase=checkReviewUiLayouts(root)
  expect(wrongBase.valid).toBe(false)
  expect(wrongBase.issues.join(' ')).toContain('[layout](../content/ui/menu.json)')
  expect(wrongBase.issues.join(' ')).toContain('docs/content/')
  expect(readFileSync(path,'utf8')).toBe(JSON.stringify(ui))
})

test('an expanded control is checked at all declared targets, including the compact allocation', () => {
  const { root } = fixture()
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Expanded layout](../content/ui/expanded.json)\n')
  const ui = { schema: 'beegame-content.v1', id: 'expanded', kind: 'ui-hud', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'hud-root', data: { orientation: 'Landscape', referenceResolution: [1000,600],
        targetViewports: [[700,400]], minimumControlSize: [40,40], compactMaxWidth: 750 }, layout: { size: [1000,600] } },
      { id: 'strip', parentId: 'root', role: 'container', layout: { size: [300,120], container: { direction: 'column', gap: 8 } },
        responsive: { compact: { layout: { size: [300,64] } } } },
      { id: 'trigger', parentId: 'strip', role: 'button', layout: { size: [40,40] } },
      { id: 'expanded-slider', parentId: 'strip', role: 'slider', enabled: true, layout: { size: [240,40] } },
    ] } }
  writeFileSync(join(root, 'content/ui/expanded.json'), JSON.stringify(ui))
  const check = checkReviewUiLayouts(root)
  expect(check.valid).toBe(false)
  expect(check.issues.join(' ')).toContain('700x400')
  expect(check.issues.join(' ')).toContain('expanded-slider')
  expect(check.issues.some(issue => issue.includes('1000x600'))).toBe(false)
})

test('one UI file permits binding completion but preserves the design fingerprint', () => {
  const { root, save } = fixture()
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Layout](../content/ui/menu.json)\n')
  const ui = uiLayoutFixture()
  writeFileSync(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
  const bound = structuredClone(ui) as any
  bound.data.nodes[1].bindings = { enabled: 'canPlay' }
  bound.data.nodes[1].responsive = { compact: { style: { texture: { assetRef: 'bound-resource' } } } }
  bound.data.nodes[1].layout = { size: [200,52], anchor: 'middle-center' }
  const before = designSupportingFileDigest(root, 'content/ui/menu.json')
  save(bound)
  expect(designSupportingFileDigest(root, 'content/ui/menu.json')).toBe(before)
  bound.data.nodes[1].layout.size = [200,60] // Still fits, but changes the owner decision.
  save(bound)
  expect(checkDesignLayouts(root).valid).toBe(true)
  expect(designSupportingFileDigest(root, 'content/ui/menu.json')).not.toBe(before)
})

test('Review checks overflowing flow labels in a panel with no controls', () => {
  const { root, save } = fixture()
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Layout](../content/ui/menu.json)\n')
  const ui = uiLayoutFixture() as any
  ui.data.nodes = [ui.data.nodes[0],
    { id: 'info', role: 'container', parentId: 'root',
      layout: { size: [240, 80], container: { direction: 'column', gap: 10 } } },
    { id: 'heading', role: 'text', text: 'Info', parentId: 'info', layout: { size: [200, 42] } },
    { id: 'description', role: 'text', text: 'Details', parentId: 'info', layout: { size: [200, 42] } },
  ]
  save(ui)
  const check = checkReviewUiLayouts(root)
  expect(check.valid).toBe(false)
  expect(check.issues.join(' ')).toContain('description')
  expect(check.issues.join(' ')).toContain('exceeds its allocated flow parent')
  const diagnostic = check.diagnostics.find(item => item.node === 'description' && item.kind === 'flow-overflow')!
  expect(diagnostic.closeWhen).toContain('parent content bounds')
  expect(diagnostic.geometry).toMatchObject({ space: 'host logical pixels', parent: {
    space: 'parent-local logical pixels', id: 'info', contentBounds: { bottom: 80 },
  } })
  const details = runGameContentCommand(root, ['--design-layouts', '--draft', '--details']) as any
  expect(details.measurements[0].nodes.some((node: any) => node.id === 'description')).toBe(true)
  expect(details.nodes).toBeUndefined()
  expect((runGameContentCommand(root, ['--design-layouts', '--draft']) as any).measurements).toBeUndefined()
  // The same saved-source check runs at Content, independently of a model verdict.
  expect(checkDesignLayouts(root).valid).toBe(false)
  ui.data.nodes[3].enabled = false
  save(ui)
  expect(checkReviewUiLayouts(root).valid).toBe(true)
  ui.data.nodes[3].enabled = true
  ui.data.nodes[3].layout.item = { absolute: true }
  save(ui)
  expect(checkReviewUiLayouts(root).valid).toBe(true)
  delete ui.data.nodes[3].layout.item
  ui.data.nodes[1].layout.size[1] = 94
  save(ui)
  expect(checkReviewUiLayouts(root).valid).toBe(true)
})

test('Scene atlas bindings preserve the fingerprint; geometry and unknown data remain protected', () => {
  const f = sceneDraft()
  f.scene.data.nodes[1].components = [{ id: 'sprite', type: 'sprite-renderer', data: { size: [32, 32] } }]
  f.saveScene()
  const before = designSupportingFileDigest(f.root, 'content/scenes/level.json')
  f.scene.assetRefs = ['delivered-atlas']
  const sprite = f.scene.data.nodes[1].components[0]
  sprite.assetRef = 'delivered-atlas'
  Object.assign(sprite.data, { member: 'assets/atlas.png', atlasMember: 'assets/atlas.json', frame: 'idle' })
  f.saveScene()
  expect(designSupportingFileDigest(f.root, 'content/scenes/level.json')).toBe(before)
  sprite.data.size = [48, 32]
  f.saveScene()
  expect(designSupportingFileDigest(f.root, 'content/scenes/level.json')).not.toBe(before)
  sprite.data.size = [32, 32]
  sprite.data.gameplayRule = 'new-rule'
  f.saveScene()
  expect(designSupportingFileDigest(f.root, 'content/scenes/level.json')).not.toBe(before)
})

test('reviewed compositions have distinct identities; XR without screen UI remains exempt', () => {
  const { root } = fixture()
  // XR is exempt from screen geometry, not from supplying its owner design.
  expect(checkReviewUiLayouts(root, { dimension: 'VR' }).valid).toBe(false)
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\nWorld-space UI only; no screen composition.\n')
  expect(checkReviewUiLayouts(root, { dimension: 'VR' }).valid).toBe(true)
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n[Expanded](../content/ui/expanded.json)\n')
  for (const file of ['menu.json', 'expanded.json']) writeFileSync(join(root, 'content/ui', file), JSON.stringify(uiLayoutFixture()))
  expect(checkReviewUiLayouts(root).issues.join(' ')).toContain('duplicate reviewed UI composition id')
})

test('Content cannot reorder reviewed flow children even when both layouts fit', () => {
  const { root, save } = fixture()
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  writeFileSync(join(root, 'docs/UI_UX_SPEC.md'), '# UI\n[Menu](../content/ui/menu.json)\n')
  const ui = uiLayoutFixture() as any
  ui.data.nodes[0].layout.container = { direction: 'column', gap: 10 }
  ui.data.nodes[1].layout = { size: [200, 52] }
  ui.data.nodes.push({ ...structuredClone(ui.data.nodes[1]), id: 'settings' })
  writeFileSync(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
  save(ui)
  const before = designSupportingFileDigest(root, 'content/ui/menu.json')
  ;[ui.data.nodes[1], ui.data.nodes[2]] = [ui.data.nodes[2], ui.data.nodes[1]]
  save(ui)
  expect(checkDesignLayouts(root).valid).toBe(true)
  expect(designSupportingFileDigest(root, 'content/ui/menu.json')).not.toBe(before)
})

test('linked Scene requirements are checked in the actual allocated game-view, not the whole window', () => {
  const { root, save } = fixture()
  const scene = { schema: 'beegame-content.v1', id: 'board', kind: 'scene-2d', assetRefs: [], data: {
    cameraNodeId: 'camera', settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 1000, height: 600, pixelsPerUnit: 100 }, requiredVisibleNodeIds: ['board'] }, nodes: [
      { id: 'camera', transform: { position: [500, 300, 10] }, components: [{ id: 'camera-component', type: 'camera',
        data: { orthographic: true, orthographicSize: 3, coordinateSpace: 'logical-pixels', viewport: { width: 1000, height: 600 }, framing: 'keep-height' } }] },
      { id: 'board', transform: { position: [500, 300, 0] }, components: [{ id: 'visual', type: 'sprite-renderer', data: { size: [900, 500] } }] },
      { id: 'optional', transform: { position: [5000, 5000, 0] }, components: [{ id: 'optional-visual', type: 'sprite-renderer', data: { size: [100, 100] } }] },
    ] } }
  const path = join(root, 'scene.json')
  writeFileSync(path, JSON.stringify(scene))
  const before = readFileSync(path, 'utf8')
  const ui = { schema: 'beegame-content.v1', id: 'game', kind: 'ui-hud', assetRefs: [], data: { rootId: 'root', nodes: [
    { id: 'root', role: 'hud-root', layout: { size: [1200, 800] }, data: { orientation: 'Landscape',
      referenceResolution: [1200, 800], targetViewports: [[1200, 800]], layoutCamera: { nodeId: 'view', path: 'scene.json' } } },
    { id: 'view', role: 'container', parentId: 'root', layout: { position: [0, 80], size: [600, 600] } },
  ] } }
  save(ui)
  expect(checkDesignLayouts(root).issues.join(' ')).toContain('Scene required visibility failed: board')
  const failure = checkDesignLayouts(root).diagnostics.find(item => item.kind === 'scene-visibility')!
  expect(failure.geometry).toMatchObject({ scene: { requiredVisibility: { outside: ['board'] },
    nodes: [{ id: 'board', fullyInside: false }] } })
  const inspected = runGameContentCommand(root, ['--layout-draft', 'content/ui/menu.json', '1200', '800']) as any
  expect(inspected.gameView.viewport).toEqual({ width: 600, height: 600 })
  expect(inspected.sceneInspection.requiredVisibility).toMatchObject({ status: 'failed', outside: ['board'],
    supportedAspect: { min: 1.5, max: null } })
  expect(readFileSync(path, 'utf8')).toBe(before)
  const camera = scene.data.nodes[0].components[0].data as any
  camera.framing = 'letterbox'
  writeFileSync(path, JSON.stringify(scene))
  expect(checkDesignLayouts(root).issues).toEqual([]) // Optional offscreen geometry is not a failure.
  const connected = runGameContentCommand(root, ['--layout-draft', 'content/ui/menu.json', '1200', '800', '--game-view', 'view', '--camera', 'scene.json']) as any
  expect(connected.sceneInspection.requiredVisibility.status).toBe('passed')
  expect(connected.sceneInspection.view.rect).toEqual({ x: 0, y: 120, width: 600, height: 360 })
})

test('declared minima are project-specific and apply after parent scale and rotation', () => {
  const { root, save } = fixture()
  const ui = uiLayoutFixture(28)
  save(ui)
  expect(checkDesignLayouts(root).issues.join(' ')).toContain('minimumControlSize')
  ui.data.nodes[0]!.data!.minimumControlSize = [24, 24]
  save(ui)
  expect(checkDesignLayouts(root).valid).toBe(true)
  ui.data.nodes[0]!.data!.minimumControlSize = [44, 44]
  Object.assign(ui.data.nodes[1]!.layout!, { rotation: 45, size: [100, 28] })
  save(ui)
  expect(checkDesignLayouts(root).issues.join(' ')).toContain('minimumControlSize')
  Object.assign(ui.data.nodes[1]!.layout!, { rotation: 0, size: [80, 80], scale: [.5, .5] })
  save(ui)
  expect(checkDesignLayouts(root).issues.join(' ')).toContain('[40,40]')
})

test('missing final input, unusable declarations and opposite-direction targets cannot be accepted', () => {
  const { root, save } = fixture()
  expect(checkDesignLayouts(root).valid).toBe(false)
  const ui = uiLayoutFixture()
  ui.data.nodes[0]!.data!.targetViewports = [[390, 844]]
  save(ui)
  expect(checkDesignLayouts(root).issues.join(' ')).toContain('unsupported orientation')
  ui.data.nodes[0]!.data!.targetViewports = [[600, 360]]
  ui.data.nodes[0]!.data!.minimumControlSize = [0, 44]
  save(ui)
  expect(checkDesignLayouts(root).valid).toBe(false)
})

test('latest frozen native failure is caught by final-screen minima without rewriting evidence', () => {
  const { root, save } = fixture()
  const baseline = new URL('../../../../docs/verification/layout-2026-10-01/ui-screen-control-recheck/final-drafts/', import.meta.url)
  const sourcePath = new URL('ui-game-base.json', baseline)
  const source = readFileSync(sourcePath, 'utf8')
  const camera = readFileSync(new URL('camera-draft.json', baseline), 'utf8')
  const ui = JSON.parse(source)
  ui.data.nodes[0].data = { orientation: 'Landscape', referenceResolution: [960, 540], targetViewports: [[800, 400]],
    minimumControlSize: [44, 44], layoutCamera: { nodeId: 'game-view', path: 'camera.json' } }
  writeFileSync(join(root, 'camera.json'), camera)
  save(ui)
  const issues = checkDesignLayouts(root).issues
  expect(issues.some(issue => issue.includes('pause-btn: 960x540 resolved control size') && issue.includes('minimumControlSize'))).toBe(true)
  expect(readFileSync(sourcePath, 'utf8')).toBe(source)
})

test('camera links and layout inputs cannot escape the project', () => {
  const { root, path, save } = fixture()
  const ui = uiLayoutFixture()
  const other = fixture()
  writeFileSync(join(other.root, 'camera.json'), '{}')
  Object.assign(ui.data.nodes[0]!.data!, { layoutCamera: { nodeId: 'game', path: join(other.root, 'camera.json') } })
  save(ui)
  expect(checkDesignLayouts(root).issues.join(' ')).toContain('workspace-relative path')
  symlinkSync(join(other.root, 'camera.json'), join(root, 'camera.json'))
  Object.assign(ui.data.nodes[0]!.data!, { layoutCamera: { nodeId: 'game', path: 'camera.json' } })
  save(ui)
  expect(checkDesignLayouts(root).issues.join(' ')).toContain('outside the project workspace')
  rmSync(path)
  symlinkSync(join(other.root, 'camera.json'), path)
  expect(checkDesignLayouts(root).valid).toBe(false)
})

test('checks declared world/screen clearance through the real camera projection and final inputs', () => {
  const { root, path, save } = fixture()
  writeFileSync(join(root, 'camera.json'), JSON.stringify({ orthographic: true, orthographicSize: 3,
    pixelsPerUnit: 100, viewport: { width: 1000, height: 600 }, framing: 'letterbox' }))
  const ui = {
    schema: 'beegame-content.v1', id: 'spatial', kind: 'ui-screen', assetRefs: [], data: { rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', layout: { size: [1000, 600] }, data: { orientation: 'Landscape',
        referenceResolution: [1000, 600], targetViewports: [[800, 480], [900, 540]],
        layoutCamera: { nodeId: 'view', path: 'camera.json' } } },
      { id: 'view', role: 'container', parentId: 'root', layout: { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] } },
      { id: 'plane', role: 'container', parentId: 'view', data: { space: 'camera-reference-2d' },
        layout: { size: [1000, 600], item: { absolute: true } } },
      { id: 'play-region', role: 'container', parentId: 'plane', data: { layoutOcclusion: 'protected' },
        layout: { position: [0, 80], size: [1000, 520] } },
      { id: 'overlay', role: 'container', parentId: 'root', data: { layoutOcclusion: 'occluder' },
        layout: { anchorMin: [0, 0], anchorMax: [1, 0], sizeDelta: [0, 80] } },
    ] } }
  save(ui)
  const before = readFileSync(path, 'utf8')
  const check = checkDesignLayouts(root)
  expect(check.valid).toBe(false)
  expect(check.issues.some(issue => issue.includes('800x480') && issue.includes('play-region') && issue.includes('overlay'))).toBe(true)
  expect(check.issues.some(issue => issue.includes('1000x600'))).toBe(false) // Edges only touch at reference size.
  const inspection = runGameContentCommand(root, ['--layout-draft', 'content/ui/menu.json', '800', '480']) as any
  expect(inspection.diagnostics.occlusionViolations).toEqual([['play-region', 'overlay']])
  expect(inspection.nodes.find((node: any) => node.id === 'play-region').bounds.top).toBeCloseTo(64)
  expect(runGameContentCommand(root, ['--design-layouts'])).toMatchObject({ valid: false, runtimeVerified: false })
  expect(readFileSync(path, 'utf8')).toBe(before)

  // Move both regions into the same authored reference space, not a second
  // hard-coded scale table. The shared consumer now preserves their clearance.
  Object.assign(ui.data.nodes[4]!, { parentId: 'plane', layout: { size: [1000, 80] } })
  save(ui)
  expect(checkDesignLayouts(root).issues).toEqual([])
  for (const size of [[800, 480], [900, 540], [1200, 720]]) {
    const result = runGameContentCommand(root, ['--layout-draft', 'content/ui/menu.json', ...size.map(String)]) as any
    expect(result.diagnostics.occlusionViolations).toEqual([])
  }
})
