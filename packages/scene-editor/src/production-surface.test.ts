import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderProductionScene2d } from './production-surface'
import type { SceneSpatialData, SceneSpatialNode } from './scene-layout-inspection'

const viewport = { width: 200, height: 100 }
function scene(nodes: SceneSpatialNode[]): SceneSpatialData {
  return { cameraNodeId: 'camera', settings: { coordinateSystem: { pixelsPerUnit: 100 } }, nodes: [
    { id: 'camera', transform: { position: [100, 50, 0] }, components: [{ type: 'camera', data: {
      orthographic: true, orthographicSize: .5, coordinateSpace: 'logical-pixels', viewport,
    } }] }, ...nodes,
  ] }
}

// Record Canvas commands, not a browser/pixel or gameplay acceptance test.
function recordingCanvas() {
  const fills: Array<{ color: string; rect: number[] }> = [], alphas: number[] = [], texts: string[] = [], transforms: number[][] = []
  const context = { fillStyle: '', font: '', textBaseline: '', globalAlpha: 1,
    clearRect() {}, beginPath() {}, rect() {}, clip() {}, save() {}, restore() {},
    setTransform(...values: number[]) { transforms.push(values) },
    fillRect(...rect: number[]) { fills.push({ color: context.fillStyle, rect }); alphas.push(context.globalAlpha) },
    fillText(text: string) { texts.push(text) },
  }
  const stagingSizes: number[] = []
  const present = vi.fn(), created = vi.fn(() => {
    const stage = { getContext: () => context }
    for (const key of ['width', 'height']) {
      let size = 0
      Object.defineProperty(stage,key,{get: () => size,set: value => { size = Math.trunc(value); stagingSizes.push(value) }})
    }
    return stage
  })
  const destination = { drawImage: present, save() {}, restore() {}, setTransform() {} }
  vi.stubGlobal('document', { createElement: created })
  const canvas = { getContext: () => destination } as unknown as HTMLCanvasElement
  return { canvas, fills, alphas, texts, transforms, present, created, context, stagingSizes }
}

afterEach(() => vi.unstubAllGlobals())

describe('static production Scene presentation', () => {
  it('reuses the staging canvas and dimensions while honoring in-place edits and rejecting new invalid data', () => {
    const data = scene([{ id: 'sprite', transform: { position: [20, 30, 0] }, components: [
      { type: 'sprite-renderer', data: { size: [10, 10], color: '#ff0000' } },
    ] }])
    const output = recordingCanvas(), sizes: number[] = []
    for (const key of ['width', 'height'] as const) {
      let size = 0
      Object.defineProperty(output.canvas,key,{get: () => size,set: value => { size = value; sizes.push(value) }})
    }
    renderProductionScene2d(output.canvas,data,viewport)
    data.nodes[1].transform!.position = [40, 50, 0]
    data.nodes[1].components![0].data!.color = '#00ff00'
    renderProductionScene2d(output.canvas,data,viewport)
    expect(output.created).toHaveBeenCalledOnce()
    expect(sizes).toEqual([200,100])
    expect(output.stagingSizes).toEqual([200,100])
    expect(output.transforms.at(-1)).toEqual([1,0,0,1,40,50])
    expect(output.fills.at(-1)?.color).toBe('#00ff00')
    data.nodes[1].components![0].data!.opacity = 2
    expect(() => renderProductionScene2d(output.canvas,data,viewport)).toThrow('opacity')
    expect(output.present).toHaveBeenCalledTimes(2)
    delete data.nodes[1].components![0].data!.opacity
    data.nodes[1].parentId = 'missing'
    expect(() => renderProductionScene2d(output.canvas,data,viewport)).toThrow('Unknown scene parent')
    delete data.nodes[1].parentId
    renderProductionScene2d(output.canvas,data,{width:400,height:100})
    renderProductionScene2d(output.canvas,data,{width:400.5,height:100.5})
    renderProductionScene2d(output.canvas,data,{width:400.5,height:100.5})
    expect(sizes).toEqual([200,100,400])
    expect(output.stagingSizes).toEqual([200,100,400])
    expect(output.created).toHaveBeenCalledOnce()
  })

  it('paints Image/Text on a world-space Canvas using existing parent-local RectTransforms', () => {
    const rect = (position: number[], size: number[]) => ({ type: 'rect-transform', data: {
      anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], anchoredPosition: position, sizeDelta: size,
    } })
    const data = scene([
      { id: 'canvas', transform: { position: [50, 25, 0] }, components: [
        { type: 'canvas', data: { renderMode: 'world-space' } }, rect([0, 0], [100, 50]),
      ] },
      { id: 'image', parentId: 'canvas', components: [rect([10, 20], [40, 10]),
        { type: 'canvas-renderer', data: {} }, { type: 'image', data: { color: '#ff0000' } }] },
      { id: 'text', parentId: 'canvas', components: [rect([10, 35], [40, 10]),
        { type: 'canvas-renderer', data: {} }, { type: 'text', data: { text: 'OK', fontSize: 10, fontFamily: 'sans-serif' } }] },
    ])
    const before = structuredClone(data), output = recordingCanvas()
    const inspection = renderProductionScene2d(output.canvas, data, viewport)
    expect(output.fills).toEqual([{ color: '#ff0000', rect: [-0, -0, 40, 10] }])
    expect(output.texts).toEqual(['OK'])
    expect(output.transforms).toEqual([[1, 0, 0, 1, 60, 45], [1, 0, 0, 1, 60, 60]])
    expect(inspection.nodes.find(node => node.id === 'image')?.screenBounds).toEqual({ left: 60, top: 45, right: 100, bottom: 55 })
    expect(output.present).toHaveBeenCalledOnce()
    data.nodes[1].enabled = false
    renderProductionScene2d(output.canvas, data, viewport)
    expect(output.fills).toHaveLength(1)
    expect(output.texts).toHaveLength(1)
    delete data.nodes[1].enabled
    expect(data).toEqual(before)
  })

  it.each(['screen-space-overlay', 'screen-space-camera'])('rejects %s Canvas without replacing the previous canvas', renderMode => {
    const data = scene([{ id: 'canvas', components: [{ type: 'canvas', data: { renderMode } }] }])
    const output = recordingCanvas()
    expect(() => renderProductionScene2d(output.canvas, data, viewport)).toThrow('only world-space is supported')
    expect(output.present).not.toHaveBeenCalled()
  })

  it('paints lower zIndex first and retains source order for ties', () => {
    const data = scene([['front', 10], ['back', -2], ['tie', -2]].map(([id, zIndex]) => ({
      id: String(id), zIndex: Number(zIndex), components: [{ type: 'sprite-renderer', data: { size: [10, 10], color: id } }],
    })))
    const before = structuredClone(data), output = recordingCanvas()
    renderProductionScene2d(output.canvas, data, viewport)
    expect(output.fills.map(fill => fill.color)).toEqual(['back', 'tie', 'front'])
    expect(data).toEqual(before)
  })

  it('keeps layer priority above node zIndex, including negative layers and a default layer', () => {
    const data = scene([
      { id: 'near', layer: 'near', zIndex: -1000000 },
      { id: 'default', layer: 'unknown', zIndex: 0 },
      { id: 'far', layer: 'far', zIndex: 1000000 },
    ].map(node => ({ ...node, components: [{ type: 'sprite-renderer', data: { size: [10, 10], color: node.id } }] })))
    data.settings!.layers = [{ id: 'far', order: -2 }, { id: 'near', order: 3 }]
    const output = recordingCanvas()
    renderProductionScene2d(output.canvas, data, viewport)
    expect(output.fills.map(fill => fill.color)).toEqual(['far', 'default', 'near'])
  })

  it('continues rejecting unsupported components and component sorting overrides', () => {
    const output = recordingCanvas()
    expect(() => renderProductionScene2d(output.canvas, scene([{ id: 'body', components: [{ type: 'rigidbody-2d' }] }]), viewport))
      .toThrow('Unsupported production Scene component')
    expect(() => renderProductionScene2d(output.canvas, scene([{ id: 'sprite', components: [
      { type: 'sprite-renderer', data: { size: [10, 10], color: '#fff', sortingOrder: 2 } },
    ] }]), viewport)).toThrow('Unsupported production Scene field: sprite/sortingOrder')
    expect(output.present).not.toHaveBeenCalled()
  })
})

it('checks and draws the same flat/nested Scene opacity and rejects invalid values before presentation', async () => {
  const { inspectProductionSceneSupport } = await import('./production-surface')
  const data = scene([{ id: 'sprite', components: [{ type: 'sprite-renderer', data: {
    size: [10, 10], color: '#ff0000', opacity: 1, material: { color: '#00ff00', opacity: .25 },
  } }] }])
  const before = structuredClone(data), output = recordingCanvas()
  expect(inspectProductionSceneSupport(data).supported).toBe(true)
  renderProductionScene2d(output.canvas, data, viewport)
  expect(output.fills[0].color).toBe('#00ff00')
  expect(output.alphas).toEqual([.25])
  expect(data).toEqual(before)
  for (const opacity of [-.1, 1.1, NaN, '0.5']) {
    const invalid = structuredClone(data)
    invalid.nodes[1].components![0].data!.material = { opacity }
    expect(inspectProductionSceneSupport(invalid).issues[0].reason).toContain('opacity')
    expect(() => renderProductionScene2d(output.canvas, invalid, viewport)).toThrow('opacity')
  }
  expect(output.present).toHaveBeenCalledOnce()
})
