import { beforeAll, describe, expect, it } from 'vitest'
import { initializeUiLayout } from './ui-container-layout'
import { inspectUiLayout } from './ui-layout-inspection'
import { resolveUiNodesForViewport, type UiResponsiveNode } from './ui-responsive'

beforeAll(initializeUiLayout)
const viewport = { width: 400, height: 300 }

describe('deterministic UI containers', () => {
  it('centers a nested menu without authored button positions and preserves the source', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'column', justify: 'center', align: 'center', gap: 20 } } },
      { id: 'title', parentId: 'root', layout: { size: [200, 50] } },
      { id: 'actions', parentId: 'root', layout: { container: { direction: 'column', gap: 10 } } },
      { id: 'play', parentId: 'actions', layout: { size: [180, 44] } },
      { id: 'help', parentId: 'actions', layout: { size: [180, 44] } },
    ]
    const before = JSON.stringify(nodes)
    const rects = inspectUiLayout(nodes, 'root', viewport)
    expect(rects[1].bounds).toEqual({ left: 100, top: 66, right: 300, bottom: 116 })
    expect(rects[2].layout?.size).toEqual([180, 98])
    expect(rects[4].bounds.top).toBe(190)
    expect(rects.every(rect => !rect.outsideViewport && !rect.outsideParent)).toBe(true)
    expect(JSON.stringify(nodes)).toBe(before)
  })
  it('allocates HUD space, preserves a custom pivot and leaves anchored overlays out of flow', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'row', gap: 8, padding: [12, 12, 12, 12], align: 'start' } } },
      { id: 'score', parentId: 'root', data: { anchor: { x: .5, y: .5 } }, layout: { size: [80, 44], item: { grow: 1 }, minSize: [80, 44] } },
      { id: 'pause', parentId: 'root', layout: { anchor: 'top-right', size: [44, 44] } },
      { id: 'toast', parentId: 'root', layout: { anchor: 'bottom-center', position: [0, -12], size: [200, 40], item: { absolute: true } } },
    ]
    const rects = inspectUiLayout(nodes, 'root', viewport)
    expect(rects[1].layout?.size).toEqual([324, 44])
    expect(rects[1].bounds.left).toBe(12)
    expect(rects[2].bounds).toEqual({ left: 344, top: 12, right: 388, bottom: 56 })
    expect(rects[3].bounds).toEqual({ left: 100, top: 248, right: 300, bottom: 288 })
  })
  it('wraps controls instead of implicitly shrinking them', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'row', wrap: true, gap: 12, padding: [10, 10, 10, 10], align: 'start' } } },
      ...['a', 'b', 'c'].map(id => ({ id, parentId: 'root', layout: { size: [180, 44] as [number, number] } })),
    ]
    const rects = inspectUiLayout(nodes, 'root', { width: 390, height: 300 })
    expect(rects[2].bounds.top).toBe(66)
    expect(rects[3].bounds.top).toBe(122)
    expect(rects[1].layout?.size).toEqual([180, 44])
  })
  it('reports insufficient space instead of hiding it through automatic scaling', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'row', gap: 10 } } },
      { id: 'a', parentId: 'root', layout: { size: [240, 44] } },
      { id: 'b', parentId: 'root', layout: { size: [240, 44] } },
    ]
    const rects = inspectUiLayout(nodes, 'root', viewport)
    expect(rects[2].outsideParent).toBe(true)
    expect(rects[2].outsideViewport).toBe(true)
    expect(rects[2].layout?.size).toEqual([240, 44])
  })
  it('derives required grid height from controls and detects lost padding before outer overflow', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'column', align: 'stretch' } } },
      { id: 'controls', parentId: 'root', layout: { container: {
        direction: 'grid', columns: 3, gap: 8, padding: [16, 16, 24, 16],
      } } },
      ...Array.from({ length: 9 }, (_, index) => ({ id: `cell-${index}`, parentId: 'controls',
        layout: { size: [48, 48] as [number, number], minSize: [48, 48] as [number, number] } })),
    ]
    const before = JSON.stringify(nodes)
    const natural = inspectUiLayout(nodes, 'root', { width: 375, height: 667 })
    expect(natural[1].layout?.size).toEqual([375, 200])
    expect(natural.every(node => !node.outsideContentArea && !node.outsideParent)).toBe(true)
    const constrained = structuredClone(nodes)
    constrained[1].layout!.size = [375, 190]
    const compact = inspectUiLayout(constrained, 'root', { width: 375, height: 667 })
    expect(compact.filter(node => node.outsideContentArea).map(node => node.id))
      .toEqual(['cell-6', 'cell-7', 'cell-8'])
    expect(compact.every(node => !node.outsideParent && !node.outsideViewport)).toBe(true)
    expect(JSON.stringify(nodes)).toBe(before)
  })
  it('checks all modal contents and permits anchored overlays to opt out of flow padding', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'column', padding: [24, 24, 24, 24] } } },
      { id: 'panel', parentId: 'root', layout: { size: [380, 180] } },
      { id: 'close', parentId: 'root', layout: { size: [20, 20], item: { absolute: true } } },
      { id: 'inactive', parentId: 'root', enabled: false, layout: { size: [500, 500] } },
    ]
    const rects = inspectUiLayout(nodes, 'root', { width: 375, height: 667 })
    expect(rects[1].outsideContentArea).toBe(true)
    expect(rects[1].outsideViewport).toBe(true)
    expect(rects[2].outsideContentArea).toBe(false)
    expect(rects[3].outsideContentArea).toBe(false)
  })
  it('resolves an equal-width grid and excludes disabled cells', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'grid', columns: 2, gap: 10, padding: [10, 10, 10, 10], align: 'start' } } },
      ...['a', 'b', 'c'].map(id => ({ id, parentId: 'root', layout: { size: [1, 44] as [number, number] } })),
      { id: 'hidden', parentId: 'root', enabled: false, layout: { size: [500, 500] } },
    ]
    const rects = inspectUiLayout(nodes, 'root', viewport)
    expect(rects[1].layout?.size).toEqual([185, 44])
    expect(rects[2].bounds.left).toBe(205)
    expect(rects[3].bounds.top).toBe(64)
    expect(rects[4].active).toBe(false)
  })
  it('propagates allocated sizes to nested stretch children and applies responsive container direction', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'row', gap: 10 } },
        responsive: { portrait: { layout: { container: { direction: 'column' } } } } },
      { id: 'panel', parentId: 'root', layout: { size: [100, 50], item: { grow: 1 } } },
      { id: 'pause', parentId: 'root', layout: { size: [44, 44] } },
      { id: 'child', parentId: 'panel', layout: { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [-20, -20], position: [10, 10] } },
    ]
    expect(resolveUiNodesForViewport(nodes, 'root', viewport)[3].layout?.size).toEqual([326, 30])
    const portrait = inspectUiLayout(nodes, 'root', { width: 300, height: 400 })
    expect(portrait[2].bounds.top).toBe(356)
  })
  it('uses supplied real-font metrics for auto-sized text and exposes unmeasured/fitting text separately', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root', layout: { container: { direction: 'column', align: 'start' } } },
      { id: 'label', parentId: 'root', text: 'Real glyphs' },
    ]
    expect(() => resolveUiNodesForViewport(nodes, 'root', viewport)).toThrow('Text measurement required')
    const rects = inspectUiLayout(nodes, 'root', viewport, { measureText: () => ({ width: 137.5, height: 28 }) })
    expect(rects[1].layout?.size).toEqual([137.5, 28])
    expect(rects[1].textFit).toBe('fits-intrinsic-bounds')
    const fixed = [{ id: 'root' }, { id: 'text', parentId: 'root', text: 'large', layout: { size: [50, 20] as [number, number] } }]
    expect(inspectUiLayout(fixed, 'root', viewport)[1].textFit).toBe('unmeasured')
    expect(inspectUiLayout(fixed, 'root', viewport, { measureText: () => ({ width: 100, height: 25 }) })[1].textFit).toBe('exceeds-intrinsic-bounds')
  })
  it('rejects conflicting anchors, impossible limits and cyclic containers without leaking a Yoga tree', () => {
    const root: UiResponsiveNode = { id: 'root', layout: { container: { direction: 'row' } } }
    expect(() => resolveUiNodesForViewport([root, { id: 'bad', parentId: 'root', layout: { anchorMin: [0, 0], anchorMax: [1, 1] } }], 'root', viewport)).toThrow('Flow child')
    expect(() => resolveUiNodesForViewport([root, { id: 'bad', parentId: 'root', layout: { minSize: [60, 20], maxSize: [40, 20] } }], 'root', viewport)).toThrow('minSize')
    expect(() => resolveUiNodesForViewport([{ ...root, parentId: 'root' }], 'root', viewport)).toThrow('cycle')
    // A failed allocation must not poison subsequent independent resolutions.
    expect(resolveUiNodesForViewport([root], 'root', viewport)[0].layout?.size).toEqual([400, 300])
  })
  it('derives an anchored auto-sized group and respects limits on stretched regions', () => {
    const nodes: UiResponsiveNode[] = [
      { id: 'root' },
      { id: 'group', parentId: 'root', layout: { anchor: 'middle-center', container: { direction: 'column', gap: 12 } } },
      { id: 'a', parentId: 'group', layout: { size: [220, 44] } },
      { id: 'b', parentId: 'group', layout: { size: [220, 44] } },
      { id: 'panel', parentId: 'root', layout: { anchorMin: [0, 0], anchorMax: [1, 0], sizeDelta: [-40, 44], maxSize: [280, 44] } },
    ]
    const rects = inspectUiLayout(nodes, 'root', viewport)
    expect(rects[1].bounds).toEqual({ left: 90, top: 100, right: 310, bottom: 200 })
    expect(rects[4].layout?.size).toEqual([280, 44])
  })
})
