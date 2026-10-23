import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareNativeMcpConfig } from './native-mcp-config'
import { sceneLayoutFixture, uiLayoutFixture } from './fixtures/layout-fixture'
import { runGameContentCommand } from './game-content-validation-cli'
import { writeBeeGameAssetManifest, type BeeGameAssetManifest } from './asset-contracts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const conditions = { platform: 'Web', inputs: ['Touch'], orientation: 'Landscape', dimension: '2D' }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bgs-scene-tool-')); roots.push(root)
  mkdirSync(join(root, 'content/scenes'), { recursive: true })
  const scene: any = sceneLayoutFixture()
  scene.data.settings.requiredVisibleNodeIds = ['actor']
  scene.data.nodes[1].transform.position = [20, -10, 0]
  scene.data.nodes.push({ id: 'actor', parentId: 'board', transform: { position: [100, 50, 0] }, components: [
    { id: 'visual', type: 'sprite-renderer', data: { size: [20, 10], color: '#fff' } },
  ] })
  const save = (path: string, value: unknown) => writeFileSync(join(root, path), JSON.stringify(value, null, 2) + '\n')
  save('content/scenes/level.json', scene)
  return { root, scene, save }
}
async function connect(root: string) {
  const prepared = await prepareNativeMcpConfig({}, root, conditions)
  const servers = prepared.config.mcp_servers as Record<string, ConstructorParameters<typeof StdioClientTransport>[0]>
  expect(Object.keys(servers)).toEqual(['bgs-ui-layout'])
  const client = new Client({ name: 'offline-scene-test', version: '1' })
  try { await client.connect(new StdioClientTransport(servers['bgs-ui-layout']!)) }
  catch (error) { await client.close(); await prepared.close(); throw error }
  return { client, close: async () => { await client.close(); await prepared.close() } }
}
function text(result: Awaited<ReturnType<Client['callTool']>>) {
  return (result.content as Array<{ text?: string }>).map(c => c.text ?? '').join('\n')
}

test('native Scene tool reports actual hierarchy and Camera coordinates read-only, and sees saved source edits', async () => {
  const { root, scene, save } = fixture()
  scene.data.nodes.push({ id: 'optional', transform: { position: [3000, 0, 0] }, components: [
    { id: 'optional-visual', type: 'sprite-renderer', data: { color: '#fff', size: [20, 20] } },
  ] })
  save('content/scenes/level.json', scene)
  const before = readFileSync(join(root, 'content/scenes/level.json')), files = readdirSync(root, { recursive: true })
  const access = await connect(root)
  try {
    const tool = (await access.client.listTools()).tools.find(t => t.name === 'CheckSceneLayouts')!
    expect(tool.annotations?.readOnlyHint).toBe(true)
    const summary = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })
    expect(summary.isError).toBe(false)
    expect(text(summary)).toContain('Camera reference viewports only, not the UI game-view')
    expect(text(summary)).toContain('"outsideCameraView":["optional"]')
    expect(text(summary)).toContain('"status":"passed"')
    expect(text(summary)).not.toContain('844') // No host viewport is substituted for the authored Camera reference.
    expect(text(summary)).not.toContain('| World origin |')
    const details = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: { detailsFor: 'content/scenes/level.json' } })
    expect(details.isError).toBe(false)
    expect(text(details)).toContain('"pixelsPerUnit":100')
    expect(text(details)).toContain('"framing":"expand"')
    expect(text(details)).toContain('| "actor" | "board" | true |')
    expect(text(details)).toContain('[120,40]')
    const expected: any = runGameContentCommand(root, ['--scene-layouts', '--details'], conditions)
    expect(text(details)).toContain(JSON.stringify(expected.inspections[0].nodes.find((n: any) => n.id === 'actor').screenBounds))
    expect(readFileSync(join(root, 'content/scenes/level.json'))).toEqual(before)
    expect(readdirSync(root, { recursive: true })).toEqual(files)
    scene.data.nodes[0].components[0].data.orthographicSize = 5.4
    save('content/scenes/level.json', scene)
    const changed = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: { detailsFor: 'content/scenes/level.json' } })
    expect(changed.isError).toBe(false)
    expect(text(changed)).toContain('"orthographicSize":5.4')
    expect(text(changed)).not.toBe(text(details))
    expect(JSON.parse(readFileSync(join(root, 'content/scenes/level.json'), 'utf8')).data.nodes[2].transform)
      .toEqual(scene.data.nodes[2].transform)
  } finally { await access.close() }
}, 20_000)

test('Camera-reference success cannot substitute for actual UI allocation; normal Camera edits recheck both', async () => {
  const { root, scene, save } = fixture()
  scene.data.nodes[0].components[0].data.framing = 'keep-height'
  save('content/scenes/level.json', scene)
  mkdirSync(join(root, 'content/ui'))
  const ui: any = uiLayoutFixture()
  ui.data.nodes[0].data.layoutCamera = { nodeId: 'game', path: 'content/scenes/level.json' }
  ui.data.nodes.push({ id: 'game', role: 'container', parentId: 'root', layout: { size: [80, 320] } })
  save('content/ui/menu.json', ui)
  const access = await connect(root)
  try {
    expect((await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })).isError).toBe(false)
    const narrow = await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })
    expect(narrow.isError).toBe(true)
    expect(text(narrow)).toContain('Scene required visibility failed: actor')
    scene.data.nodes[0].components[0].data.orthographicSize = 5.4
    save('content/scenes/level.json', scene)
    expect((await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })).isError).toBe(false)
    expect((await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })).isError).toBe(false)
  } finally { await access.close() }
}, 20_000)

test('Scene details never narrow batch scope and 3D geometry stays explicitly unverified', async () => {
  const { root, scene, save } = fixture()
  const second = structuredClone(scene); second.id = 'other'; second.data.nodes[2].transform.position = [4000, 0, 0]
  save('content/scenes/other.json', second)
  const third: any = sceneLayoutFixture(); third.kind = 'scene-3d'; third.id = 'world'
  third.data.settings.coordinateSystem = { origin: 'world', units: 'meters' }
  save('content/scenes/world.json', third)
  const access = await connect(root)
  try {
    const response = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: { detailsFor: 'content/scenes/level.json' } })
    expect(response.isError).toBe(true)
    expect(text(response)).toContain('content/scenes/other.json: 960x540 required Scene geometry outside Camera: actor')
    expect(text(response)).toContain('content/scenes/world.json: 3D/XR framing requires target-runtime observation; structure checked only.')
    expect(text(response)).toContain('| World origin |')
    rmSync(join(root, 'content/scenes/other.json'))
    const only3d = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: { detailsFor: 'content/scenes/world.json' } })
    expect(only3d.isError).toBe(true)
    expect(text(only3d)).toContain('no measured static 2D geometry')
    writeFileSync(join(root, 'content/scenes/other.json'), '{')
    expect((await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })).isError).toBe(true)
  } finally { await access.close() }
}, 20_000)

test('Scene and UI checks share real TileSet bounds; missing geometry stays unverified and edits invalidate cached bounds', async () => {
  const { root, scene, save } = fixture()
  scene.assetRefs = ['TILES']; scene.data.settings.requiredVisibleNodeIds = ['board']
  scene.data.nodes = scene.data.nodes.slice(0, 2); scene.data.nodes[1].transform.position = [0, 0, 0]
  scene.data.nodes[1].components = [
    { id: 'grid', type: 'grid', data: { schema: 'grid.v1', cellSize: [16, 16] } },
    { id: 'map', type: 'tilemap', assetRef: 'TILES', data: { schema: 'tilemap.v1', gridNodeId: 'board', cells: [{ x: 0, y: 0, tileId: 'wall' }] } },
    { id: 'renderer', type: 'tilemap-renderer', data: { schema: 'tilemap-renderer.v1' } },
  ]
  save('content/scenes/level.json', scene)
  mkdirSync(join(root, 'content/ui'))
  const ui: any = uiLayoutFixture()
  ui.data.nodes[0].data.layoutCamera = { nodeId: 'root', path: 'content/scenes/level.json' }
  save('content/ui/menu.json', ui)
  const access = await connect(root)
  try {
    const missing = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })
    expect(missing.isError).toBe(false) // Saved structure passed; required geometry is still unverified.
    expect(text(missing)).toContain('"status":"unverified"')
    expect(text(missing)).toContain('TileSet required; cell size is not the visual tile size')
    mkdirSync(join(root, 'assets/runtime'), { recursive: true })
    const manifest: BeeGameAssetManifest = { version: 9, requirements: [],
      project_target: { asset_format_capabilities: ['json', 'png'], runtime_asset_root: 'assets/runtime', generated_asset_root: 'assets/generated' },
      resources: [['TILES', 'assets/runtime/tiles.json'], ['PIXELS', 'assets/runtime/pixel.png']].map(([id, path]) => ({
        id: id!, fulfills: [], root_path: path!, file_paths: [path!], source: { type: 'agent-authored', created_at: '2026-10-17T00:00:00Z', reason: 'Offline fixture' },
        provisional: false, status: 'verified', selected_at: '2026-10-17T00:00:00Z', selection_reason: ['Offline fixture'], dimension: 'agnostic', asset_kind: 'data',
      })) }
    await writeBeeGameAssetManifest(root, manifest)
    const tiles = { schema: 'beegame-tileset.v1', tiles: { wall: { sprite: { assetRef: 'PIXELS', member: 'assets/runtime/pixel.png' }, size: [40, 80] } } }
    save('assets/runtime/tiles.json', tiles)
    writeFileSync(join(root, 'assets/runtime/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'))
    const details = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: { detailsFor: 'content/scenes/level.json' } })
    expect(details.isError).toBe(false)
    expect(text(details)).toContain('"left":-12,"top":-32,"right":28,"bottom":48')
    expect(text(details)).toContain('"status":"passed"')
    expect((await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })).isError).toBe(false)
    tiles.tiles.wall.size = [2000, 80]; save('assets/runtime/tiles.json', tiles)
    expect((await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })).isError).toBe(true)
    expect((await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })).isError).toBe(true)
    tiles.tiles.wall.sprite.member = 'assets/runtime/not-registered.png'; save('assets/runtime/tiles.json', tiles)
    const invalid = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })
    expect(invalid.isError).toBe(true)
    expect(text(invalid)).toContain('unregistered file')
  } finally { await access.close() }
}, 20_000)

test('Scene tool rejects scope overrides and aliases, reports missing inputs, and never writes reports', async () => {
  const { root } = fixture(), access = await connect(root)
  try {
    for (const args of [{ width: 844 }, { workspace: '/tmp' }, { command: '--anything' }, { files: ['one'] },
      { detailsFor: 'content/ui/menu.json' }, { detailsFor: '../private.json' }, { detailsFor: 'content/scenes/../private.json' },
      { detailsFor: 'content\\scenes\\one.json' }])
      expect((await access.client.callTool({ name: 'CheckSceneLayouts', arguments: args })).isError).toBe(true)
    const missing = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: { detailsFor: 'content/scenes/missing.json' } })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('no measured static 2D geometry')
    const privateFile = join(root, 'private.json'); writeFileSync(privateFile, 'PRIVATE_SENTINEL')
    symlinkSync(privateFile, join(root, 'content/scenes/escape.json'))
    const alias = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })
    expect(alias.isError).toBe(true)
    expect(text(alias)).toContain('symlinks')
    expect(text(alias)).not.toContain('PRIVATE_SENTINEL')
    rmSync(join(root, 'content/scenes'), { recursive: true })
    const empty = await access.client.callTool({ name: 'CheckSceneLayouts', arguments: {} })
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('No saved Scene JSON')
    expect(readdirSync(root, { recursive: true }).some(path => String(path).includes('layout-reports'))).toBe(false)
  } finally { await access.close() }
}, 20_000)
