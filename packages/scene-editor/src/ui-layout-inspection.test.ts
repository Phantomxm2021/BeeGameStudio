import { expect, it } from 'vitest'
import { inspectUiLayout, inspectUiLayoutBoundaries, summarizeUiLayoutInspection } from './ui-layout-inspection'
import type { UiResponsiveNode } from './ui-responsive'
import type { SceneCameraInput } from './scene-camera'

const root: UiResponsiveNode = { id: 'root', layout: { size: [960, 540] } }

it('checks only declared clearance, with actual rotated rectangles rather than their AABBs', () => {
  const nodes: UiResponsiveNode[] = [root,
    { id: 'region', parentId: 'root', data: { layoutOcclusion: 'protected' },
      layout: { position: [100, 100], size: [100, 10], rotation: Math.PI / 4 } },
    { id: 'panel', parentId: 'root', data: { layoutOcclusion: 'occluder' },
      layout: { position: [80, 100], size: [5, 5] } },
  ]
  const source = JSON.stringify(nodes)
  // Both AABBs intersect; the actual polygons do not.
  expect(inspectUiLayout(nodes, 'root', { width: 960, height: 540 })[1]!.occludedBy).toEqual([])
  expect(JSON.stringify(nodes)).toBe(source)
  nodes[2]!.layout!.position = [102, 105]
  expect(summarizeUiLayoutInspection(inspectUiLayout(nodes, 'root', { width: 960, height: 540 })).occlusionViolations)
    .toEqual([['region', 'panel']])
  delete nodes[2]!.data!.layoutOcclusion
  expect(inspectUiLayout(nodes, 'root', { width: 960, height: 540 })[1]!.occludedBy).toEqual([])
})

it('preserves touching edges and applies responsive/ancestor visibility to clearance checks', () => {
  const nodes: UiResponsiveNode[] = [root,
    { id: 'region', parentId: 'root', data: { layoutOcclusion: 'protected' }, layout: { size: [100, 100] } },
    { id: 'group', parentId: 'root', layout: { size: [200, 100] } },
    { id: 'panel', parentId: 'group', data: { layoutOcclusion: 'occluder' }, layout: { position: [100, 0], size: [100, 100] },
      responsive: { compact: { enabled: false } } },
  ]
  expect(inspectUiLayout(nodes, 'root', { width: 960, height: 540 })[1]!.occludedBy).toEqual([])
  nodes[3]!.layout!.position = [50, 0]
  expect(inspectUiLayout(nodes, 'root', { width: 960, height: 540 })[1]!.occludedBy).toEqual(['panel'])
  expect(inspectUiLayout(nodes, 'root', { width: 600, height: 400 })[1]!.occludedBy).toEqual([])
  nodes[2]!.enabled = false
  expect(inspectUiLayout(nodes, 'root', { width: 960, height: 540 })[1]!.occludedBy).toEqual([])
})

it('does not silently accept malformed or collapsed protected regions', () => {
  const viewport = { width: 960, height: 540 }
  const node: UiResponsiveNode = { id: 'region', parentId: 'root', data: { layoutOcclusion: 'protected' }, layout: { size: [100, 100], scale: [0, 1] } }
  expect(() => inspectUiLayout([root, node], 'root', viewport)).toThrow('collapsed')
  node.layout!.scale = [1, 1]
  node.layout!.size = [0, 100]
  expect(() => inspectUiLayout([root, node], 'root', viewport)).toThrow('collapsed')
  node.layout!.size = [100, 100]
  node.data!.layoutOcclusion = 'unknown'
  expect(() => inspectUiLayout([root, node], 'root', viewport)).toThrow('layoutOcclusion')
})

it('exposes double anchor compensation without changing data', () => {
  const nodes: UiResponsiveNode[] = [root,
    { id: 'title', parentId: 'root', layout: { anchor: 'top-center', position: [-280, 96], size: [560, 80] } },
  ]
  const before = JSON.stringify(nodes)
  const result = inspectUiLayout(nodes, 'root', { width: 640, height: 360 })
  expect(result[1].bounds).toEqual({ left: -240, top: 96, right: 320, bottom: 176 })
  expect(result[1].outsideViewport).toBe(true)
  expect(JSON.stringify(nodes)).toBe(before)
})
it.each([[640, 360], [1280, 720]])('resolves stretch, centering and nested offsets at %s x %s', (width, height) => {
  const result = inspectUiLayout([root,
    { id: 'mask', parentId: 'root', layout: { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] } },
    { id: 'panel', parentId: 'root', layout: { anchor: 'middle-center', size: [200, 100] } },
    { id: 'child', parentId: 'panel', layout: { position: [10, 20], size: [30, 40] } },
  ], 'root', { width, height })
  expect(result[1].bounds).toEqual({ left: 0, top: 0, right: width, bottom: height })
  expect(result[3].bounds.left).toBe(width / 2 - 100 + 10)
  expect(result[3].bounds.top).toBe(height / 2 - 50 + 20)
})
it('applies responsive, pivot, rotation and disabled ancestors', () => {
  const result = inspectUiLayout([root,
    { id: 'panel', parentId: 'root', enabled: false, layout: { position: [-200, 0], size: [100, 100] } },
    { id: 'child', parentId: 'panel', layout: { size: [10, 10] } },
    { id: 'turn', parentId: 'root', data: { anchor: { x: 0, y: 0 } }, layout: { anchor: 'middle-center', size: [20, 10], rotation: Math.PI / 2 }, responsive: { compact: { layout: { size: [40, 10] } } } },
  ], 'root', { width: 400, height: 300 })
  expect(result[2].active).toBe(false)
  expect(result[2].outsideViewport).toBe(false)
  expect(result[3].bounds.left).toBeCloseTo(190)
  expect(result[3].bounds.bottom).toBeCloseTo(190)
})
it('rejects malformed geometry and hierarchy', () => {
  const viewport = { width: 640, height: 360 }
  expect(() => inspectUiLayout([root, root], 'root', viewport)).toThrow('Duplicate')
  expect(() => inspectUiLayout([root, { id: 'orphan' }], 'root', viewport)).toThrow('parent')
  expect(() => inspectUiLayout([root, { id: 'bad', parentId: 'root', layout: { size: [-1, 20] } }], 'root', viewport)).toThrow('Invalid')
})

it('reports text/text and text/control intersections even when all nodes fit inside the viewport', () => {
  const nodes: UiResponsiveNode[] = [root,
    { id: 'score', parentId: 'root', text: 'Score', layout: { position: [12, 10], size: [140, 28] } },
    { id: 'lives', parentId: 'root', text: 'Lives', layout: { position: [90, 10], size: [140, 28] } },
    { id: 'pause', parentId: 'root', text: 'Pause', layout: { position: [123, 8], size: [72, 32] } },
  ]
  const source = JSON.stringify(nodes)
  const result = inspectUiLayout(nodes, 'root', { width: 390, height: 844 })
  expect(result.every(node => !node.outsideViewport && !node.outsideParent)).toBe(true)
  expect(result.find(node => node.id === 'score')?.overlapCandidates).toEqual(['lives', 'pause'])
  expect(result.find(node => node.id === 'lives')?.overlapCandidates).toEqual(['score', 'pause'])
  expect(result.find(node => node.id === 'pause')?.overlapCandidates).toEqual(['score', 'lives'])
  expect(JSON.stringify(nodes)).toBe(source)
})

it('ignores disabled, zero-area, parent/child, and touching boxes, keeping backgrounds out of text candidates', () => {
  const nodes: (UiResponsiveNode & { role?: string })[] = [root,
    { id: 'background', role: 'image', text: 'Backdrop', parentId: 'root', layout: { size: [640, 360] } },
    { id: 'button', role: 'button', parentId: 'root', layout: { size: [100, 50] } },
    { id: 'label', role: 'text', parentId: 'button', text: 'Play', layout: { size: [100, 50] } },
    { id: 'next', role: 'button', parentId: 'root', layout: { position: [100, 0], size: [100, 50] } },
    { id: 'hidden', role: 'text', enabled: false, parentId: 'root', text: 'hidden', layout: { size: [100, 50] } },
    { id: 'empty', role: 'text', parentId: 'root', text: '', layout: { position: [50, 25], size: [0, 0] } },
  ]
  expect(inspectUiLayout(nodes, 'root', { width: 640, height: 360 }).every(node => node.overlapCandidates.length === 0)).toBe(true)
})

it('keeps interactive/control overlap detection and applies responsive visibility before checking', () => {
  const nodes: (UiResponsiveNode & { role?: string })[] = [root,
    { id: 'pause', role: 'button', parentId: 'root', layout: { size: [100, 50] } },
    { id: 'menu', role: 'dropdown', parentId: 'root', layout: { position: [20, 0], size: [100, 50] },
      responsive: { compact: { enabled: false } } },
  ]
  expect(inspectUiLayout(nodes, 'root', { width: 960, height: 540 })[1].overlapCandidates).toEqual(['menu'])
  expect(inspectUiLayout(nodes, 'root', { width: 390, height: 844 })[1].overlapCandidates).toEqual([])
})

it('checks the authored compact boundary and its next logical pixel without changing layout selection', () => {
  const nodes: UiResponsiveNode[] = [
    { id: 'root', data: { compactMaxWidth: 680 } },
    { id: 'title', parentId: 'root', text: 'Title', layout: { position: [0, -10], size: [100, 50] },
      responsive: { compact: { layout: { position: [0, 0] } } } },
  ]
  const source = JSON.stringify(nodes)
  const checks = inspectUiLayoutBoundaries(nodes, 'root', { width: 667, height: 375 })
  expect(checks).toEqual([
    { trigger: 'compact', viewport: { width: 680, height: 375 }, diagnostics: {
      outsideViewport: [], outsideParent: [], outsideContentArea: [], belowMinimumControlSize: [], overlapCandidates: [],
    } },
    { trigger: 'compact', viewport: { width: 681, height: 375 }, diagnostics: {
      outsideViewport: ['title'], outsideParent: ['title'], outsideContentArea: [], belowMinimumControlSize: [], overlapCandidates: [],
    } },
  ])
  expect(JSON.stringify(nodes)).toBe(source)
})

it('checks default compact and portrait boundaries only when those variants are declared', () => {
  expect(inspectUiLayoutBoundaries([root], 'root', { width: 390, height: 844 })).toEqual([])
  const nodes: UiResponsiveNode[] = [root,
    { id: 'label', parentId: 'root', text: 'Text', layout: { size: [20, 20] },
      responsive: { compact: { layout: { position: [0, 0] } }, portrait: { layout: { position: [-10, 0] } } } },
  ]
  const checks = inspectUiLayoutBoundaries(nodes, 'root', { width: 400, height: 399 })
  expect(checks.map(check => check.viewport)).toEqual([
    { width: 600, height: 399 }, { width: 601, height: 399 },
    { width: 400, height: 400 }, { width: 400, height: 401 },
  ])
  expect(checks[2].diagnostics.outsideViewport).toEqual([])
  expect(checks[3].diagnostics.outsideViewport).toEqual(['label'])
})

const camera: SceneCameraInput = { orthographic: true, orthographicSize: 3.36, pixelsPerUnit: 100,
  viewport: { width: 480, height: 672 }, framing: 'letterbox' }
function cameraUi(): (UiResponsiveNode & { role?: string })[] {
  return [structuredClone(root),
    { id: 'game', role: 'container', parentId: 'root', layout: { anchorMin: [.02, .02], anchorMax: [.98, .98] } },
    { id: 'world-ui', role: 'container', parentId: 'game', data: { space: 'camera-reference-2d' },
      layout: { size: [480, 672], item: { absolute: true } } },
    { id: 'prompt', role: 'text', parentId: 'world-ui', text: '发球', layout: { position: [120, 568], size: [240, 24] } },
  ]
}

it.each([
  [960, 540, 387.428571, 448.971429, 185.142857, 18.514286],
  [390, 844, 101.4, 602.96, 187.2, 18.72],
  [320, 480, 83.2, 388.48, 153.6, 15.36],
  [320, 568, 83.2, 432.48, 153.6, 15.36],
])('projects one unchanged world prompt at %s x %s including game-view and letterbox offsets', (width, height, left, top, w, h) => {
  const source = cameraUi(), before = JSON.stringify(source)
  const result = inspectUiLayout(source, 'root', { width, height }, { camera: { nodeId: 'game', input: camera } })
  const prompt = result.find(node => node.id === 'prompt')!
  expect(prompt.bounds.left).toBeCloseTo(left, 4)
  expect(prompt.bounds.top).toBeCloseTo(top, 4)
  expect(prompt.bounds.right - prompt.bounds.left).toBeCloseTo(w, 4)
  expect(prompt.bounds.bottom - prompt.bounds.top).toBeCloseTo(h, 4)
  expect(prompt).toMatchObject({ worldRootId: 'world-ui', outsideViewport: false, outsideParent: false, outsideCameraView: false })
  expect(result.find(node => node.id === 'world-ui')?.outsideParent).toBe(false)
  expect(JSON.stringify(source)).toBe(before)
})

it('reports projected world/screen foreground overlaps across containers, but not backgrounds or hidden planes', () => {
  const source = cameraUi()
  source.push({ id: 'screen-panel', role: 'container', parentId: 'root', layout: { size: [390, 844] } },
    { id: 'button', role: 'button', parentId: 'screen-panel', layout: { position: [101.4, 602.96], size: [187.2, 18.72] } },
    { id: 'background', role: 'image', parentId: 'screen-panel', layout: { size: [390, 844] } })
  const options = { camera: { nodeId: 'game', input: camera } }
  expect(inspectUiLayout(source, 'root', { width: 390, height: 844 }, options).find(node => node.id === 'prompt')?.overlapCandidates).toEqual(['button'])
  source.find(node => node.id === 'world-ui')!.enabled = false
  expect(inspectUiLayout(source, 'root', { width: 390, height: 844 }, options).every(node => !node.overlapCandidates.length)).toBe(true)
})

it('uses camera world span and units, diagnosing framing overflow even inside the host viewport', () => {
  const result = inspectUiLayout(cameraUi(), 'root', { width: 390, height: 844 }, {
    camera: { nodeId: 'game', input: { ...camera, orthographicSize: 1.68 } },
  })
  expect(result.find(node => node.id === 'prompt')).toMatchObject({ outsideViewport: false, outsideCameraView: true })
  expect(result.find(node => node.id === 'prompt')!.bounds.bottom - result.find(node => node.id === 'prompt')!.bounds.top).toBeCloseTo(37.44)
})

it('checks actual projected control sizes without forbidding reference-plane interaction', () => {
  const options = { camera: { nodeId: 'game', input: camera } }
  for (const role of ['button', 'slider', 'toggle', 'dropdown', 'tab']) {
    const source = cameraUi()
    source[0]!.data = { minimumControlSize: [44, 44] }
    source.push({ id: 'control', role, parentId: 'world-ui', layout: { size: [48, 48] } })
    const before = JSON.stringify(source)
    expect(inspectUiLayout(source, 'root', { width: 320, height: 480 }, options).find(node => node.id === 'control'))
      .toMatchObject({ controlSize: [30.72, 30.72], belowMinimumControlSize: true })
    source.find(node => node.id === 'control')!.layout!.size = [80, 80]
    expect(inspectUiLayout(source, 'root', { width: 320, height: 480 }, options).find(node => node.id === 'control')?.belowMinimumControlSize).toBe(false)
    source.find(node => node.id === 'control')!.layout!.size = [48, 48]
    expect(JSON.stringify(source)).toBe(before)
  }
  const source: (UiResponsiveNode & { role?: string; actions?: Record<string, string> })[] = [...cameraUi(), { id: 'action-label', role: 'text', parentId: 'world-ui',
    actions: { click: 'serve' }, text: '发球', layout: { size: [48, 48] } }]
  source[0]!.data = { minimumControlSize: [44, 44] }
  expect(inspectUiLayout(source, 'root', { width: 390, height: 844 }, options).find(node => node.id === 'action-label')?.belowMinimumControlSize).toBe(true)
})

it('rejects missing or incompatible camera reference inputs rather than treating world coordinates as screen pixels', () => {
  const source = cameraUi(), viewport = { width: 390, height: 844 }
  expect(() => inspectUiLayout(source, 'root', viewport)).toThrow('connected game-view')
  expect(() => inspectUiLayout(source, 'root', viewport, { camera: { nodeId: 'game', input: { ...camera, pixelsPerUnit: undefined } } })).toThrow('pixelsPerUnit')
  expect(() => inspectUiLayout(source, 'root', viewport, { camera: { nodeId: 'game', input: { ...camera, orthographic: false, fieldOfView: 60 } } })).toThrow('orthographic')
  source[2].data!.space = 'world'
  expect(() => inspectUiLayout(source, 'root', viewport, { camera: { nodeId: 'game', input: camera } })).toThrow('Scene/runtime projection')
  source[2].data!.space = 'camera-reference-2d'
  source[2].layout!.size = [240, 336]
  expect(() => inspectUiLayout(source, 'root', viewport, { camera: { nodeId: 'game', input: camera } })).toThrow('reference size')
})
