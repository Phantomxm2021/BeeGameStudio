import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDesignLayouts, checkReviewUiLayouts } from './design-layout-check'
import { designSupportingFileDigest } from './design-handoff'
import { runGameContentCommand } from './game-content-validation-cli'
import { uiLayoutFixture } from './fixtures/layout-fixture'

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

test('declared combined clearance catches a compact-only cross-file intersection without copying geometry', () => {
  const f = layers()
  const before = [readFileSync(f.path, 'utf8'), readFileSync(f.overlayPath, 'utf8')]
  const check = checkReviewUiLayouts(f.root)
  expect(check.valid).toBe(false)
  expect(check.issues.join(' ')).toContain('600x360 occluder play intersects preserved content/ui/menu.json#reserved')
  expect(check.issues.some(issue => issue.includes('960x540'))).toBe(false)
  expect(check.compositions).toEqual([{ file: 'content/ui/overlay.json', underlay: 'content/ui/menu.json', clearance: 'preserve' }])
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
  bound.data.nodes[1].responsive = { compact: { style: { background: 'bound-resource' } } }
  bound.data.nodes[1].layout = { size: [200,52], anchor: 'middle-center' }
  const before = designSupportingFileDigest(root, 'content/ui/menu.json')
  save(bound)
  expect(designSupportingFileDigest(root, 'content/ui/menu.json')).toBe(before)
  bound.data.nodes[1].layout.size = [200,60] // Still fits, but changes the owner decision.
  save(bound)
  expect(checkDesignLayouts(root).valid).toBe(true)
  expect(designSupportingFileDigest(root, 'content/ui/menu.json')).not.toBe(before)
})

test('reviewed compositions have distinct identities; XR without screen UI remains exempt', () => {
  const { root } = fixture()
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
    cameraNodeId: 'camera', settings: { coordinateSystem: { pixelsPerUnit: 100 }, requiredVisibleNodeIds: ['board'] }, nodes: [
      { id: 'camera', transform: { position: [500, 300, 10] }, components: [{ id: 'camera-component', type: 'camera',
        data: { orthographic: true, orthographicSize: 3, viewport: { width: 1000, height: 600 }, framing: 'keep-height' } }] },
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
