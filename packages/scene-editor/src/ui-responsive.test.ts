import { describe, expect, it } from 'vitest'
import { resolveUiNodesForViewport } from './ui-responsive'

const nodes = [
  { id: 'root', layout: { size: [1280, 720] as [number, number] } },
  { id: 'title', layout: { position: [640, 80] as [number, number], size: [400, 72] as [number, number] }, style: { fontSize: 40, color: '#fff' },
    responsive: {
      compact: { layout: { position: [0, 60] as [number, number], size: [320, 56] as [number, number] }, style: { fontSize: 26 } },
      portrait: { layout: { position: [0, 100] as [number, number] } },
    } },
]

describe('UI viewport projection', () => {
  it('keeps base data untouched and applies compact before portrait', () => {
    const phone = resolveUiNodesForViewport(nodes, 'root', { width: 390, height: 844 })
    expect(phone[0]?.layout?.size).toEqual([390, 844])
    expect(phone[1]).toMatchObject({ layout: { position: [0, 100], size: [320, 56] }, style: { fontSize: 26, color: '#fff' } })
    expect(nodes[1]?.layout?.position).toEqual([640, 80])
    const landscape = resolveUiNodesForViewport(nodes, 'root', { width: 844, height: 390 })
    expect(landscape[1]?.layout?.position).toEqual([0, 60])
    const desktop = resolveUiNodesForViewport(nodes, 'root', { width: 1280, height: 720 })
    expect(desktop[1]?.layout?.position).toEqual([640, 80])
  })

  it('preserves world-space root size and rejects invalid viewports', () => {
    expect(resolveUiNodesForViewport([{ id: 'world', data: { space: 'world' }, layout: { size: [3, 2] as [number, number] } }], 'world', { width: 390, height: 844 })[0]?.layout?.size).toEqual([3, 2])
    expect(() => resolveUiNodesForViewport(nodes, 'root', { width: 0, height: 100 })).toThrow('positive finite')
  })
})
