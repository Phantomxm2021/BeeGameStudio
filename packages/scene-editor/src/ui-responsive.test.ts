import { describe, expect, it } from 'vitest'
import { resolveUiNodesForViewport, uiViewportVariants, type UiResponsiveNode } from './ui-responsive'
import { initializeUiLayout } from './ui-container-layout'
import { createUiTextMeasurer } from './ui-text-measurement'
import { uiNodeStyle } from './ui-preview/UiContentRenderer'

const nodes = [
  { id: 'root', layout: { size: [1280, 720] as [number, number] } },
  { id: 'title', layout: { position: [640, 80] as [number, number], size: [400, 72] as [number, number] }, style: { fontSize: 40, color: '#fff' },
    responsive: {
      compact: { layout: { position: [0, 60] as [number, number], size: [320, 56] as [number, number] }, style: { fontSize: 26 } },
      portrait: { layout: { position: [0, 100] as [number, number] } },
    } },
]

describe('UI viewport projection', () => {
  it('uses inherited/variant typography for both Yoga measurement and editor appearance', async () => {
    await initializeUiLayout()
    const source: any[] = [
      { id: 'root', role: 'screen-root', style: { fontSize: 48, fontFamily: 'Authored', fontWeight: 700, align: 'right' },
        layout: { container: { direction: 'column', align: 'start' } }, responsive: { compact: { style: { fontSize: 24, textAlign: 'left' } } } },
      { id: 'text', parentId: 'root', role: 'text', text: 'MMMM' },
      { id: 'panel', parentId: 'root', role: 'container', layout: { size: [100, 50] }, style: { backgroundColor: '#ff0000', borderRadius: 12 } },
    ]
    const before = structuredClone(source)
    const context = { font: '', measureText(text: string) { return { width: text.length * Number(this.font.match(/([\d.]+)px/)![1]) } as TextMetrics } }
    const measureText = createUiTextMeasurer(context)
    for (const [width, size, align] of [[900, 48, 'right'], [400, 24, 'left']] as const) {
      const resolved = resolveUiNodesForViewport(source, 'root', { width, height: 200 }, { measureText })
      expect(resolved[1].style).toMatchObject({ fontSize: size, fontWeight: 700, textAlign: align })
      expect(resolved[1].layout!.size![0]).toBeCloseTo(size * 4, 3)
      expect(resolved[1].layout!.size![1]).toBeCloseTo(size * 1.35, 3)
      expect(context.font).toBe(`700 ${size}px Authored`)
      expect(uiNodeStyle(resolved[1], false, {}, resolved)).toMatchObject({ fontSize: size, fontWeight: 700, textAlign: align, fontFamily: 'Authored' })
      expect(uiNodeStyle(resolved[2], false, {}, resolved)).toMatchObject({ backgroundColor: '#ff0000', borderRadius: 12 })
    }
    expect(source).toEqual(before)
  })

  it('inherits font references while allowing an explicit child family or resource override', () => {
    const source: UiResponsiveNode[] = [
      { id: 'root', data: { font: { assetRef: 'FONT', member: 'regular.ttf' } }, style: { color: 'blue' } },
      { id: 'inherited', parentId: 'root' },
      { id: 'system', parentId: 'root', style: { fontFamily: 'serif' } },
      { id: 'own', parentId: 'root', data: { font: { assetRef: 'OTHER' } } },
      { id: 'shape', parentId: 'root', role: 'shape', layout: { size: [20, 20] } },
    ]
    const result = resolveUiNodesForViewport(source, 'root', { width: 900, height: 200 })
    expect(result[1].data?.font).toEqual(source[0].data?.font)
    expect(result[2].data?.font).toBeUndefined()
    expect(result[3].data?.font).toEqual({ assetRef: 'OTHER' })
    expect(uiNodeStyle(result[4] as any, false, {}, result as any).backgroundColor).toBeUndefined()
    expect(source[1].data).toBeUndefined()
  })

  it('reports the same default/authored width boundary and portrait precedence used by projection', () => {
    expect(uiViewportVariants(undefined, { width: 600, height: 400 })).toEqual({
      compactMaxWidth: 600, compactMaxWidthSource: 'default', compact: true, portrait: false,
    })
    expect(uiViewportVariants(undefined, { width: 601, height: 390 }).compact).toBe(false)
    const root = { id: 'root', data: { compactMaxWidth: 900 } }
    expect(uiViewportVariants(root, { width: 844, height: 390 })).toEqual({
      compactMaxWidth: 900, compactMaxWidthSource: 'authored', compact: true, portrait: false,
    })
    expect(uiViewportVariants(root, { width: 960, height: 390 }).compact).toBe(false)
    expect(uiViewportVariants(root, { width: 390, height: 844 }).portrait).toBe(true)
    expect(uiViewportVariants({ id: 'root', data: { compactMaxWidth: -1 } }, { width: 844, height: 390 })
      .compactMaxWidthSource).toBe('default')
  })

  it.each([[720, 640], [390, 844], [1280, 720]])('preserves a stretched screen root at %s × %s', (width, height) => {
    const authored: UiResponsiveNode[] = [
      { id: 'root', layout: { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] } },
      { id: 'panel', parentId: 'root', layout: { anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [-40, -60] } },
    ]
    const result = resolveUiNodesForViewport(authored, 'root', { width, height })
    expect(result[0]?.layout?.size).toEqual([width, height])
    expect(result[1]?.layout?.size).toEqual([width - 40, height - 60])
    expect(authored[0]?.layout?.size).toBeUndefined()
  })

  it('does not collapse a world root with stretch metadata', () => {
    expect(resolveUiNodesForViewport([{ id: 'root', data: { space: 'world' }, layout: {
      size: [3, 2], anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0],
    } }], 'root', { width: 720, height: 640 })[0]?.layout?.size).toEqual([3, 2])
  })
  it('keeps base data untouched and applies compact before portrait', () => {
    const phone = resolveUiNodesForViewport(nodes, 'root', { width: 390, height: 844 })
    expect(phone[0]?.layout?.size).toEqual([390, 844])
    expect(phone[1]).toMatchObject({ layout: { position: [0, 100], size: [320, 56] }, style: { fontSize: 26, color: '#fff' } })
    expect(nodes[1]?.layout?.position).toEqual([640, 80])
    const landscape = resolveUiNodesForViewport(nodes, 'root', { width: 844, height: 390 })
    expect(landscape[1]?.layout?.position).toEqual([640, 80])
    const desktop = resolveUiNodesForViewport(nodes, 'root', { width: 1280, height: 720 })
    expect(desktop[1]?.layout?.position).toEqual([640, 80])
  })

  it('preserves world-space root size and rejects invalid viewports', () => {
    expect(resolveUiNodesForViewport([{ id: 'world', data: { space: 'world' }, layout: { size: [3, 2] as [number, number] } }], 'world', { width: 390, height: 844 })[0]?.layout?.size).toEqual([3, 2])
    expect(() => resolveUiNodesForViewport(nodes, 'root', { width: 0, height: 100 })).toThrow('positive finite')
  })

  it('resolves nested stretch anchors from the actual parent size without mutating authored layout', () => {
    const layoutNodes = [
      { id: 'root', layout: { size: [960, 540] as [number, number] } },
      { id: 'panel', parentId: 'root', layout: { anchorMin: [0, 0] as [number, number], anchorMax: [1, 1] as [number, number], sizeDelta: [-40, -60] as [number, number], position: [0, 0] as [number, number] } },
      { id: 'bar', parentId: 'panel', layout: { anchorMin: [0, 0] as [number, number], anchorMax: [1, 0] as [number, number], sizeDelta: [0, 40] as [number, number] } },
    ]
    const resolved = resolveUiNodesForViewport(layoutNodes, 'root', { width: 800, height: 600 })
    expect(resolved[1]?.layout).toMatchObject({ size: [760, 540], position: [0, 0] })
    expect(resolved[2]?.layout).toMatchObject({ size: [760, 40], position: [0, 0] })
    expect(layoutNodes[1]?.layout).not.toHaveProperty('size')
  })

  it('uses an authored compact breakpoint for mobile landscape without classifying a short desktop iframe as mobile', () => {
    const authored: UiResponsiveNode[] = [{ id: 'root', data: { compactMaxWidth: 900 } }, ...nodes.slice(1)]
    expect(resolveUiNodesForViewport(authored, 'root', { width: 844, height: 390 })[1]?.layout?.position).toEqual([0, 60])
    expect(resolveUiNodesForViewport(authored, 'root', { width: 960, height: 540 })[1]?.layout?.position).toEqual([640, 80])
  })
})
