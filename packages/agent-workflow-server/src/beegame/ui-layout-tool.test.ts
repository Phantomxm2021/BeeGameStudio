import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV } from './native-mcp-config'
import { uiLayoutFixture, sceneLayoutFixture } from './fixtures/layout-fixture'
import { runGameContentCommand } from './game-content-validation-cli'
import { BeeGameSessionManager, type BeeGameSessionRunnerStartInput } from './session-manager'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bgs-ui-tool-')); roots.push(root)
  mkdirSync(join(root, 'content/ui'), { recursive: true })
  const save = (name: string, value: unknown) => writeFileSync(join(root, 'content', name), JSON.stringify(value))
  save('ui/menu.json', uiLayoutFixture())
  return { root, save }
}
const conditions = { platform: 'Web', inputs: ['Touch'], orientation: 'Landscape', dimension: '2D' }
async function connect(root: string) {
  const prepared = await prepareNativeMcpConfig({}, root, conditions)
  expect(prepared.flags.filter(flag => flag.startsWith('--allowedTools')))
    .toEqual(['--allowedTools=mcp__bgs-ui-layout__CheckUiLayouts'])
  const config = JSON.parse(readFileSync(prepared.flags[1]!, 'utf8'))
  const client = new Client({ name: 'offline-layout-test', version: '1' })
  try { await client.connect(new StdioClientTransport(config.mcpServers['bgs-ui-layout'])) }
  catch (error) { await client.close(); await prepared.close(); throw error }
  return { client, close: async () => { await client.close(); await prepared.close() } }
}

test('host tool is turn-scoped and cannot be replaced by an external MCP record', async () => {
  const { root } = fixture()
  expect((await prepareNativeMcpConfig({}, root)).flags).toEqual([])
  const external = { id: 'ui-layout', name: 'External', enabled: true, autoStart: true,
    scope: 'project', cwd: root, transport: 'stdio', command: process.execPath, args: ['never-run'] }
  await expect(prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: JSON.stringify([external]) }, root, conditions))
    .rejects.toThrow('reserved')
})
function text(result: Awaited<ReturnType<Client['callTool']>>) {
  return (result.content as Array<{ type: string; text?: string }>).map(c => c.text ?? '').join('\n')
}

test('project turn preparation forwards host UI conditions and clears them for a turn without that capability', async () => {
  const { root } = fixture()
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ start: async input => {
    starts.push(input)
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Offline fixture' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    for (const uiLayoutConstraints of [conditions, { ...conditions, orientation: 'Portrait' }, undefined]) {
      await manager.sendWithDisplay(session.id, 'Offline host capability fixture', {
        prepareTurn: async () => ({ systemContext: 'Same system text', uiLayoutConstraints }),
      })
      await manager.waitForSessionIdle(session.id)
      expect(starts.at(-1)?.uiLayoutConstraints).toEqual(uiLayoutConstraints)
    }
    expect(starts).toHaveLength(3)
  } finally { await manager.dispose() }
})

test('native MCP exposes the read-only always-loaded tool and preserves host sizes, coordinates and source bytes', async () => {
  const { root } = fixture()
  const before = readFileSync(join(root, 'content/ui/menu.json'))
  const files = readdirSync(root, { recursive: true })
  const access = await connect(root)
  try {
    const tools = (await access.client.listTools()).tools
    expect(tools.map(t => t.name)).toEqual(['CheckUiLayouts'])
    expect(tools[0]!.annotations?.readOnlyHint).toBe(true)
    expect(tools[0]!._meta?.['anthropic/alwaysLoad']).toBe(true)
    const summary = await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })
    expect(summary.isError).toBe(false)
    expect(text(summary)).toContain('PASS (reported scope only)')
    expect(text(summary)).toContain('[844,390]')
    expect(text(summary)).toContain('sha256')
    expect(text(summary)).not.toContain('| Host bounds |')
    expect(text(summary)).not.toContain('Full result:')
    const detailed = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/menu.json' } })
    expect(detailed.isError).toBe(false)
    expect(text(detailed)).toContain('Host bounds')
    expect(text(detailed)).toContain('600 × 360')
    expect(text(detailed)).toContain('844 × 390')
    const expected = runGameContentCommand(root, ['--design-layouts', '--details'], conditions) as any
    expect(text(detailed)).toContain(JSON.stringify(expected.measurements[0].nodes.find((n: any) => n.id === 'play').bounds))
    expect(readFileSync(join(root, 'content/ui/menu.json'))).toEqual(before)
    expect(readdirSync(root, { recursive: true })).toEqual(files)
  } finally { await access.close() }
}, 20_000)

test('expanding one UI never hides other files, linked Cameras or underlay failures', async () => {
  const { root, save } = fixture()
  mkdirSync(join(root, 'content/scenes'))
  save('scenes/level.json', sceneLayoutFixture())
  const hud: any = uiLayoutFixture()
  hud.kind = 'ui-hud'; hud.id = 'hud'; hud.data.nodes[0].role = 'hud-root'
  hud.data.nodes[0].data.layoutCamera = { nodeId: 'root', path: 'content/scenes/level.json' }
  hud.data.nodes.push({ id: 'protected', role: 'container', parentId: 'root',
    data: { layoutOcclusion: 'protected' }, layout: { anchor: 'middle-center', size: [100, 100] } })
  save('ui/hud.json', hud)
  const overlay: any = uiLayoutFixture()
  overlay.id = 'overlay'
  overlay.data.nodes[0].data.layoutUnderlay = { path: 'content/ui/hud.json', clearance: 'preserve' }
  overlay.data.nodes[1].data = { layoutOcclusion: 'occluder' }
  save('ui/overlay.json', overlay)
  const access = await connect(root)
  try {
    const result = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/menu.json' } })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('underlay-occlusion')
    expect(text(result)).toContain('content/ui/overlay.json')
    expect(text(result)).toContain('content/scenes/level.json')
    expect(text(result)).toContain('content/ui/menu.json — 960 × 540')
    expect(text(result)).toContain('Measured geometry:')
  } finally { await access.close() }
}, 20_000)

test('tool rejects command/size/workspace overrides, preserves missing-input errors and rejects symlinks without reading their contents', async () => {
  const { root } = fixture()
  const access = await connect(root)
  try {
    for (const args of [{ width: '960 540' }, { workspace: '/tmp' }, { command: 'anything' },
      { detailsFor: '../private.json' }, { detailsFor: '/tmp/private.json' }, { detailsFor: 'content/ui/../private.json' }]) {
      expect((await access.client.callTool({ name: 'CheckUiLayouts', arguments: args })).isError).toBe(true)
    }
    const missing = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/missing.json' } })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('no measured screen/HUD geometry')
    const outside = join(root, 'private.json')
    writeFileSync(outside, 'PRIVATE_SENTINEL')
    symlinkSync(outside, join(root, 'content/ui/escape.json'))
    const linked = await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })
    expect(linked.isError).toBe(true)
    expect(text(linked)).toContain('symbolic links')
    expect(text(linked)).not.toContain('PRIVATE_SENTINEL')
    rmSync(join(root, 'content/ui'), { recursive: true })
    const absent = await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })
    expect(absent.isError).toBe(true)
    expect(text(absent)).toContain('unavailable')
  } finally { await access.close() }
}, 20_000)
