import { expect, test } from 'bun:test'
import { readSceneData, readUiData, parseSpriteSheet, spriteSheetSelection, compose2d, affine2d, point2d, uiPaintOrder, UI_PAINT_CONFORMANCE_FIXTURE } from './game-content-consumer'
import { parseBeeGameContentDocument } from './game-content-package'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const scene = { schema: 'beegame-content.v1', id: 'level', kind: 'scene-2d', assetRefs: [],
  data: { nodes: [{ id: 'root', transform: { position: [10, 20, 0] } }], settings: { width: 1280 } } }

test('consumer and host use the same contract; no silent flat-envelope fallback', () => {
  expect(readSceneData(scene)).toEqual(parseBeeGameContentDocument(scene).data)
  expect(() => readSceneData({ ...scene, data: undefined, nodes: scene.data.nodes })).toThrow()
  expect(() => readUiData(scene)).toThrow('Expected UI')
  expect(readUiData({ schema: 'beegame-content.v1', id: 'hud', kind: 'ui-hud', assetRefs: [],
    data: { rootId: 'hud', nodes: [{ id: 'hud', role: 'hud-root' }] } }).rootId).toBe('hud')
  expect(point2d(compose2d(affine2d(10, 20), affine2d(5, 6)), 0, 0)).toEqual([15, 26])
  const atlas = parseSpriteSheet({ frames: { 'walk.png': { frame: { x: 16, y: 0, w: 16, h: 32 } } } })
  expect(spriteSheetSelection(atlas, { frame: 'walk' }).frame).toEqual({ x: 16, y: 0, width: 16, height: 32 })
  expect(() => spriteSheetSelection(atlas, { frame: 'missing' })).toThrow()
  expect(uiPaintOrder(UI_PAINT_CONFORMANCE_FIXTURE.nodes, UI_PAINT_CONFORMANCE_FIXTURE.rootId))
    .toEqual([...UI_PAINT_CONFORMANCE_FIXTURE.expected])
})

test('portable ESM runs without BGS filesystem, Three.js or package dependencies', async () => {
  const source = await bundleContentConsumer()
  expect(source).not.toContain('node:fs')
  expect(source).not.toContain('node:crypto')
  expect(source).not.toContain('three')
  const directory = await mkdtemp(join(tmpdir(), 'beegame-consumer-'))
  try {
    const file = join(directory, 'consumer.mjs')
    await writeFile(file, source)
    const module = await import(file)
    expect(module.readSceneData(scene).nodes[0].id).toBe('root')
    expect(module.uiPaintOrder(module.UI_PAINT_CONFORMANCE_FIXTURE.nodes, 'root'))
      .toEqual(module.UI_PAINT_CONFORMANCE_FIXTURE.expected)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
