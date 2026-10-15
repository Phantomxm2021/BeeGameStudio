import { expect, test } from 'bun:test'
import { compileUiReferenceBoard } from './ui-reference-board.mjs'

const request = (width: number, height: number, count: number) => ({
  requestId: 'board',
  uiReference: { viewport: { width, height }, style: 'Flat, readable UI',
    screens: Array.from({ length: count }, (_, i) => ({ id: `screen-${i}`, description: `Full gameplay state ${i} with HUD` })) },
})

test('grid preserves arbitrary project ratios, every screen and equal nonoverlapping in-bounds cells', () => {
  for (const [width, height] of [[1280, 720], [720, 1280], [1000, 1000], [2100, 900], [1170, 2532]]) {
    for (const count of [1, 2, 3, 4, 5, 8, 12, 64]) {
      const input = request(width!, height!, count)
      const { layout, request: compiled } = compileUiReferenceBoard(input)
      expect(layout.panels.map(panel => panel.id)).toEqual(input.uiReference.screens.map(screen => screen.id))
      expect(layout.rows * layout.columns).toBe(count + layout.emptyCells)
      expect(compiled.prompt).toContain(`Grid: ${layout.columns} columns x ${layout.rows} rows`)
      expect(compiled.prompt).toContain(`ratio ${width}:${height}`)
      expect(compiled).not.toHaveProperty('uiReference')
      expect(compiled).toMatchObject({ quality: 'low', background: 'opaque' })
      for (const [index, panel] of layout.panels.entries()) {
        expect(panel.width / panel.height).toBeCloseTo(width! / height!, 10)
        expect(panel.width).toBe(layout.panels[0]!.width)
        expect(panel.height).toBe(layout.panels[0]!.height)
        expect(panel.row).toBe(Math.floor(index / layout.columns) + 1)
        expect(panel.column).toBe(index % layout.columns + 1)
        expect(panel.x).toBeGreaterThanOrEqual(32 - 1e-8)
        expect(panel.y).toBeGreaterThanOrEqual(32 - 1e-8)
        expect(panel.x + panel.width).toBeLessThanOrEqual(layout.canvas.width - 32 + 1e-8)
        expect(panel.y + panel.height).toBeLessThanOrEqual(layout.canvas.height - 32 + 1e-8)
        for (const other of layout.panels.slice(index + 1)) {
          expect(panel.x + panel.width <= other.x + 1e-8 || panel.y + panel.height <= other.y + 1e-8).toBe(true)
        }
      }
    }
  }
})

test('canvas/grid choice follows ratio and list length, not screen names or a prescribed board orientation', () => {
  for (const [width, height, count, size, columns, rows] of [
    [1280, 720, 3, '1024x1536', 1, 3],
    [720, 1280, 3, '1536x1024', 3, 1],
    [1280, 720, 4, '1536x1024', 2, 2],
  ] as const) {
    const compiled = compileUiReferenceBoard(request(width, height, count))
    expect(compiled.request.size).toBe(size)
    expect(compiled.layout).toMatchObject({ columns, rows })
    expect(compileUiReferenceBoard(request(width * 2, height * 2, count)).layout.panels).toEqual(compiled.layout.panels)
    const fixed = compileUiReferenceBoard({ ...request(width, height, count), size: '1024x1024' })
    expect(fixed.request.size).toBe('1024x1024')
  }
})

test('missing evidence and model-specified board geometry are rejected', () => {
  const valid = request(1280, 720, 3)
  for (const uiReference of [null, {}, { ...valid.uiReference, viewport: { width: 0, height: 720 } },
    { ...valid.uiReference, screens: [] }, { ...valid.uiReference, screens: [valid.uiReference.screens[0], valid.uiReference.screens[0]] },
    { ...valid.uiReference, columns: 2 }, { ...valid.uiReference, count: 6 }]) {
    expect(() => compileUiReferenceBoard({ ...valid, uiReference })).toThrow()
  }
  expect(() => compileUiReferenceBoard({ ...valid, prompt: 'hero panel plus strip' })).toThrow('free-form')
  expect(() => compileUiReferenceBoard({ ...valid, background: 'transparent' })).toThrow('opaque')
  expect(() => compileUiReferenceBoard(valid, 'Portrait')).toThrow('confirmed Portrait')
  expect(() => compileUiReferenceBoard(request(720, 1280, 3), 'Landscape')).toThrow('confirmed Landscape')
})
