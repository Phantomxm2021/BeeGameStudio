import { expect, test } from 'bun:test'
import { compileUiReferenceBoard, compileUiAssetSheet } from './ui-reference-board.mjs'

const request = (width: number, height: number, count: number) => ({
  requestId: 'board',
  uiReference: { viewport: { width, height }, style: 'Flat, readable UI',
    screens: Array.from({ length: count }, (_, i) => ({ id: `screen-${i}`, description: `Full gameplay state ${i} with HUD` })) },
})

test('UI production compiles selected-design skins, never a screen board or invented atlas coordinates', () => {
  const input = { requestId: 'skins', purpose: 'production', requirementIds: ['ui-skins'], referenceImagePath: 'assets/visual/selected.png',
    uiAssets: { elements: [{ id: 'panel', description: 'The translucent rounded panel in the selected design', width: 600, height: 400 },
      { id: 'button-normal', description: 'The decorated primary control, normal state, without its label', width: 240, height: 64 }] } }
  const before = structuredClone(input), plan = compileUiAssetSheet(input)
  expect(input).toEqual(before)
  expect(plan.request).toMatchObject({ purpose: 'production', referenceImagePath: input.referenceImagePath, background: 'transparent', quality: 'low' })
  expect(plan.request).not.toHaveProperty('uiAssets')
  expect(plan.request.prompt).toContain('not a new design')
  expect(plan.note).toContain('not an aesthetic verdict or measured atlas')
  for (const invalid of [{ referenceImagePath: undefined }, { purpose: 'reference' }, { requirementIds: [] },
    { prompt: 'redesign this' }, { background: 'opaque' },
    { uiAssets: { elements: [input.uiAssets.elements[0], input.uiAssets.elements[0]] } }])
    expect(() => compileUiAssetSheet({ ...input, ...invalid } as Parameters<typeof compileUiAssetSheet>[0])).toThrow()
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

test('reference prompts preserve design content without imposing pixel coordinates; production keeps its cell data', () => {
  const input = request(1440, 900, 4)
  input.uiReference.style = 'Design viewport 1440x900; borders 8px; warm colors'
  const before = structuredClone(input), plan = compileUiReferenceBoard(input)
  expect(input).toEqual(before)
  expect(plan.request.prompt).toContain(input.uiReference.style)
  for (const screen of input.uiReference.screens) expect(plan.request.prompt).toContain(screen.description)
  expect(plan.request.prompt).toContain('logical design proportions, not literal output pixels')
  expect(plan.request.prompt).not.toMatch(/rectangle x=|pixel screen frame|fixed equal-cell|gutters are \d+px/)
  const skins = compileUiAssetSheet({ requestId: 'control-skins', purpose: 'production', requirementIds: ['controls'], referenceImagePath: 'assets/reference/design.png',
    uiAssets: { elements: [{ id: 'control', description: 'Selected control skin', width: 240, height: 60 }] } })
  expect(skins.request.prompt).toContain(JSON.stringify(skins.layout.panels[0]))
  expect(skins.request).toMatchObject({ background: 'transparent', quality: 'low' })
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
