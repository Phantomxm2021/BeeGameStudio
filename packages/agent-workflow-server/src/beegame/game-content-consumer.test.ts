import { expect, test } from 'bun:test'
import { readSceneData, readUiData, contentDocumentsForLoad, contentDocumentPath, fetchContentDocument, fetchStartupContentDocuments, parseSpriteSheet, spriteSheetSelection, compose2d, affine2d, point2d, uiPaintOrder, UI_PAINT_CONFORMANCE_FIXTURE, parseGridData, parseTilemapData, parseTileSet, tileRect, resolveUiNodesForViewport } from './game-content-consumer'
import { parseBeeGameContentDocument } from './game-content-package'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { uiAnchor, uiLocalMatrix } from './game-content-consumer'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const scene = { schema: 'beegame-content.v1', id: 'level', kind: 'scene-2d', assetRefs: [],
  data: { nodes: [{ id: 'root', transform: { position: [10, 20, 0] } }], settings: { width: 1280 } } }
const contentIndex = {
  schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
  documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
  entryScene: 'level', files: ['scenes/level.json', 'ui/title.json', 'vfx/spark.json', 'scenes/bonus.json'],
  sceneModel: 'game-object-v2',
  documents: [
    { id: 'level', path: 'scenes/level.json', kind: 'scene-2d', loadPhase: 'startup' },
    { id: 'title', path: 'ui/title.json', kind: 'ui-screen', loadPhase: 'startup' },
    { id: 'spark', path: 'vfx/spark.json', kind: 'vfx', loadPhase: 'on-demand' },
    { id: 'bonus', path: 'scenes/bonus.json', kind: 'scene-2d', loadPhase: 'on-demand' },
  ],
}

test('document failures identify the reference and distinguish transport, JSON and schema errors', async () => {
  const url = 'https://example.test/previews/game/content/index.json'
  await expect(fetchContentDocument(contentIndex, 'SPARK', url)).rejects.toThrow('not registered: SPARK')
  await expect(fetchContentDocument(contentIndex, 'spark', url, async () => { throw new Error('offline') }))
    .rejects.toThrow('Failed to fetch content document spark (vfx/spark.json): offline')
  await expect(fetchContentDocument(contentIndex, 'spark', url, async () => new Response('<html>fallback</html>')))
    .rejects.toThrow('Invalid JSON for content document spark (vfx/spark.json)')
  await expect(fetchContentDocument(contentIndex, 'spark', url, async () => Response.json({})))
    .rejects.toThrow('Invalid content document spark (vfx/spark.json)')
  const abort = new DOMException('Aborted', 'AbortError')
  await expect(fetchContentDocument(contentIndex, 'spark', url, async () => { throw abort })).rejects.toBe(abort)
})

test('registered loading preserves both root and nested deployment bases', async () => {
  for (const base of ['https://example.test/', 'https://example.test/previews/game/']) {
    const urls: string[] = []
    await fetchContentDocument(contentIndex, 'bonus', base + 'content/index.json', async input => {
      urls.push(String(input))
      return Response.json({ ...scene, id: 'bonus' })
    })
    expect(urls).toEqual([base + 'content/scenes/bonus.json'])
  }
})

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
  expect(uiPaintOrder([
    { id: 'root' }, { id: 'hidden', parentId: 'root', enabled: false },
    { id: 'hidden-label', parentId: 'hidden' }, { id: 'visible', parentId: 'root' },
  ], 'root').map(step => step.nodeId)).toEqual(['root', 'root', 'visible', 'visible'])
})

test('responsive UI overrides validate and resolve through the same public consumer', () => {
  const data = readUiData({ schema: 'beegame-content.v1', id: 'hud', kind: 'ui-hud', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'hud-root', layout: { size: [1280, 720] } },
      { id: 'score', parentId: 'root', role: 'text', layout: { position: [20, 20] }, responsive: {
        compact: { layout: { position: [10, 10] }, style: { fontSize: 18 } },
      } },
    ],
  } })
  expect(resolveUiNodesForViewport(data.nodes, data.rootId, { width: 390, height: 844 })[1]).toMatchObject({
    layout: { position: [10, 10] }, style: { fontSize: 18 },
  })
  expect(() => readUiData({ schema: 'beegame-content.v1', id: 'hud', kind: 'ui-hud', assetRefs: [], data: {
    rootId: 'root', nodes: [{ id: 'root', role: 'hud-root', responsive: { compact: { layout: { size: [-1, 4] } } } }],
  } })).toThrow()
})

test('responsive adaptation preserves authored geometry rather than substituting a fixed CSS layout', () => {
  const data = readUiData({ schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', layout: { size: [960, 540] } },
      { id: 'play', parentId: 'root', role: 'button', layout: { anchor: 'top-center', position: [0, 120], size: [240, 52] },
        responsive: { portrait: { layout: { position: [0, 200], size: [180, 64] } } } },
    ],
  } })
  const bounds = (width: number, height: number) => {
    const [root, button] = resolveUiNodesForViewport(data.nodes, data.rootId, { width, height })
    const layout = button!.layout!
    return { position: point2d(uiLocalMatrix(root!.layout!.size!, layout.size!, uiAnchor(layout.anchor), layout.position!), 0, 0), size: layout.size }
  }
  expect(bounds(1280, 720)).toEqual({ position: [520, 120], size: [240, 52] })
  expect(bounds(390, 844)).toEqual({ position: [105, 200], size: [180, 64] })
  data.nodes[1]!.responsive!.portrait!.layout = { position: [20, 250], size: [120, 80] }
  expect(bounds(390, 844)).toEqual({ position: [155, 250], size: [120, 80] })
  expect(bounds(1280, 720)).toEqual({ position: [520, 120], size: [240, 52] })
})

test('stretch layout is validated and resolved through the public content consumer', () => {
  const document = { schema: 'beegame-content.v1', id: 'hud', kind: 'ui-hud', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'hud-root', layout: { size: [960, 540] } },
      { id: 'bar', parentId: 'root', role: 'container', layout: {
        anchorMin: [0, 0], anchorMax: [1, 0], sizeDelta: [-40, 48], position: [20, 12],
      }, responsive: { compact: { layout: { sizeDelta: [-20, 48] } } } },
    ],
  } }
  const data = readUiData(document)
  expect(resolveUiNodesForViewport(data.nodes, data.rootId, { width: 800, height: 600 })[1]?.layout)
    .toMatchObject({ position: [20, 12], size: [760, 48] })
  expect(resolveUiNodesForViewport(data.nodes, data.rootId, { width: 390, height: 844 })[1]?.layout)
    .toMatchObject({ position: [20, 12], size: [370, 48] })
  expect(() => readUiData({ ...document, data: { ...document.data, nodes: [
    document.data.nodes[0], { ...document.data.nodes[1], layout: { anchorMin: [0, 0], sizeDelta: [0, 48] } },
  ] } })).toThrow()
})

test('tile geometry is parsed with the same engine-neutral contract as Scene Editor', () => {
  const grid = parseGridData({ schema: 'grid.v1', cellSize: [32, 32], cellGap: [2, 2] })
  const map = parseTilemapData({ schema: 'tilemap.v1', gridNodeId: 'grid',
    cells: [{ x: 2, y: 1, tileId: 'ground' }] })
  const tiles = parseTileSet({ schema: 'beegame-tileset.v1', tiles: {
    ground: { sprite: { assetRef: 'ground', member: 'ground.png' }, size: [32, 32] },
  } })
  expect(tileRect(grid, map, map.cells[0]!, tiles.tiles.ground!)).toMatchObject({
    x: 68, y: 34, width: 32, height: 32,
  })
  expect(() => parseTilemapData({ ...map, cells: [...map.cells, map.cells[0]] }))
    .toThrow('duplicate cell')
})

test('document registry separates first-frame documents from deferred content', () => {
  expect(contentDocumentsForLoad(contentIndex, 'startup').map(document => document.id))
    .toEqual(['level', 'title'])
  expect(contentDocumentsForLoad(contentIndex, 'on-demand').map(document => document.id))
    .toEqual(['spark', 'bonus'])
  expect(contentDocumentPath(contentIndex, 'spark')).toBe('vfx/spark.json')
  expect(() => contentDocumentPath(contentIndex, 'missing')).toThrow('not registered: missing')

  const legacyIndex = { ...contentIndex, documents: undefined }
  expect(() => contentDocumentsForLoad(legacyIndex, 'startup')).toThrow('no document load registry')
})

test('staged fetch requests only the chosen phase and verifies document identity', async () => {
  const requested: string[] = []
  const payloads: Record<string, unknown> = {
    'https://games.test/demo/content/scenes/level.json': scene,
    'https://games.test/demo/content/ui/title.json': {
      schema: 'beegame-content.v1', id: 'title', kind: 'ui-screen', assetRefs: [],
      data: { rootId: 'root', nodes: [{ id: 'root', role: 'screen-root' }] },
    },
    'https://games.test/demo/content/vfx/spark.json': {
      schema: 'beegame-content.v1', id: 'spark', kind: 'vfx', assetRefs: [], data: { nodes: [] },
    },
  }
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    return new Response(JSON.stringify(payloads[url]), { status: 200 })
  }
  const loaded = await fetchStartupContentDocuments(contentIndex,
    'https://games.test/demo/content/index.json', fetcher)

  expect(loaded.map(document => document.id)).toEqual(['level', 'title'])
  expect(requested).toEqual([
    'https://games.test/demo/content/scenes/level.json',
    'https://games.test/demo/content/ui/title.json',
  ])
  const deferredRequests: string[] = []
  await expect(fetchContentDocument(contentIndex, 'spark',
    'https://games.test/demo/content/index.json', async input => {
      deferredRequests.push(String(input))
      return new Response(JSON.stringify({ ...scene, id: 'wrong' }))
    })).rejects.toThrow('does not match registry: spark')
  expect(deferredRequests).toEqual(['https://games.test/demo/content/vfx/spark.json'])
  await expect(fetchContentDocument(contentIndex, 'title',
    'https://games.test/demo/content/index.json', async () => new Response('{}')))
    .rejects.toThrow('is not on-demand: title')
  await expect(fetchStartupContentDocuments(contentIndex,
    'https://games.test/demo/content/index.json', async () => new Response('', { status: 404 })))
    .rejects.toThrow('HTTP 404')
  const unsafeIndex = { ...contentIndex, documents: contentIndex.documents.map((entry, index) =>
    index === 0 ? { ...entry, path: '../outside.json' } : entry) }
  await expect(fetchStartupContentDocuments(unsafeIndex,
    'https://games.test/demo/content/index.json', async () => new Response('{}')))
    .rejects.toThrow('Unsafe content document path')
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
    expect(module.contentDocumentsForLoad(contentIndex, 'startup').map((document: { id: string }) => document.id))
      .toEqual(['level', 'title'])
    expect(module.contentDocumentPath(contentIndex, 'spark')).toBe('vfx/spark.json')
    expect(typeof module.fetchContentDocument).toBe('function')
    const fetched: string[] = []
    const staged = await module.fetchStartupContentDocuments(contentIndex,
      'https://games.test/content/index.json', async (input: RequestInfo | URL) => {
        const url = String(input)
        fetched.push(url)
        const document = url.endsWith('/ui/title.json') ? {
          schema: 'beegame-content.v1', id: 'title', kind: 'ui-screen', assetRefs: [],
          data: { rootId: 'root', nodes: [{ id: 'root', role: 'screen-root' }] },
        } : scene
        return new Response(JSON.stringify(document), { status: 200 })
      })
    expect(staged.map((document: { id: string }) => document.id)).toEqual(['level', 'title'])
    expect(fetched).toEqual([
      'https://games.test/content/scenes/level.json',
      'https://games.test/content/ui/title.json',
    ])
    const deferred = await module.fetchContentDocument(contentIndex, 'spark',
      'https://games.test/content/index.json', async () => new Response(JSON.stringify({
        schema: 'beegame-content.v1', id: 'spark', kind: 'vfx', assetRefs: [], data: { nodes: [{ id: 'spark-emitter', type: 'particle-system' }] },
      })))
    expect(deferred.id).toBe('spark')
    expect(module.uiPaintOrder(module.UI_PAINT_CONFORMANCE_FIXTURE.nodes, 'root'))
      .toEqual(module.UI_PAINT_CONFORMANCE_FIXTURE.expected)
    expect(module.tileRect({ schema: 'grid.v1', cellSize: [32, 32] },
      { schema: 'tilemap.v1', gridNodeId: 'grid', cells: [] },
      { x: 1, y: 0, tileId: 'ground' },
      { sprite: { assetRef: 'ground', member: 'ground.png' }, size: [32, 32] }).x).toBe(32)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
