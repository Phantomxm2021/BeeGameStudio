import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV, NATIVE_READ_TOOLS } from './native-mcp-config'
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
    .toEqual(['--allowedTools=' + NATIVE_READ_TOOLS.map(name => 'mcp__bgs-ui-layout__' + name).join(',')])
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
    expect(tools.map(t => t.name).sort()).toEqual([...NATIVE_READ_TOOLS].sort())
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

test('details return exact saved node facts once per selected source, without defaults or writes', async () => {
  const { root, save } = fixture()
  const draft: any = uiLayoutFixture()
  Object.assign(draft.data.nodes[1], {
    text: '开始游戏', style: { fontSize: 28, color: '#56E0FF' },
    bindings: { text: 'session.startLabel' }, data: { font: { assetRef: 'font-ui', member: 'font.woff2' } },
    responsive: { compact: { style: { fontSize: 22 } } },
  })
  save('ui/menu.json', draft)
  const other: any = uiLayoutFixture()
  other.id = 'other'; other.data.nodes[1].text = 'OTHER_SOURCE_TEXT'
  save('ui/other.json', other)
  const access = await connect(root)
  const marker = '## Saved node facts — '
  const facts = (result: Awaited<ReturnType<Client['callTool']>>) => {
    const body = text(result)
    expect(body.split(marker)).toHaveLength(2)
    return JSON.parse(body.trim().split('\n').at(-1)!)
  }
  try {
    const before = readFileSync(join(root, 'content/ui/menu.json'))
    const files = readdirSync(root, { recursive: true })
    const summary = await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })
    expect(text(summary)).not.toContain(marker)
    expect(text(summary)).not.toContain('开始游戏')
    const detailed = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/menu.json' } })
    expect(detailed.isError).toBe(false)
    expect(text(detailed)).toContain('600 × 360')
    expect(text(detailed)).toContain('960 × 540')
    expect(text(detailed)).toContain('content/ui/other.json') // Full check scope is retained.
    expect(text(detailed)).not.toContain('## content/ui/other.json')
    expect(text(detailed)).not.toContain('OTHER_SOURCE_TEXT')
    const saved = facts(detailed)
    expect(saved).toMatchObject({ path: 'content/ui/menu.json', documentId: 'menu',
      scope: 'draft-source-inspection', runtimeVerified: false })
    expect(saved.fields).toEqual([{ pointer: '/data/nodes', value: draft.data.nodes }])
    const play = saved.fields[0].value[1]
    expect(play).toMatchObject({ text: '开始游戏', style: { fontSize: 28, color: '#56E0FF' },
      actions: { click: 'start' }, bindings: { text: 'session.startLabel' },
      data: { font: { assetRef: 'font-ui', member: 'font.woff2' } },
      responsive: { compact: { style: { fontSize: 22 } } } })
    expect(play.data).not.toHaveProperty('text')
    expect(play.data.font).not.toHaveProperty('fontSize')
    expect(saved.fields[0].value[0]).not.toHaveProperty('style')
    expect(readFileSync(join(root, 'content/ui/menu.json'))).toEqual(before)

    // A local source correction must be visible even when geometry fails.
    draft.data.nodes[1].text = '重新开始'
    draft.data.nodes[1].layout.size = [2000, 52]
    save('ui/menu.json', draft)
    const authored = readFileSync(join(root, 'content/ui/menu.json'))
    const overflow = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/menu.json' } })
    expect(overflow.isError).toBe(true)
    expect(facts(overflow).fields[0].value[1].text).toBe('重新开始')
    expect(readFileSync(join(root, 'content/ui/menu.json'))).toEqual(authored)
    expect(readdirSync(root, { recursive: true })).toEqual(files)
  } finally { await access.close() }
}, 20_000)

test('batch UI details share global facts, omit unselected summaries and retain every selected viewport and unrelated failure', async () => {
  const { root, save } = fixture()
  for (const id of ['pause', 'healthy', 'overflow']) {
    const draft: any = uiLayoutFixture()
    draft.id = id; draft.data.nodes[1].text = id + '_TEXT'
    if (id === 'overflow') draft.data.nodes[1].layout.size = [2000, 52]
    save('ui/' + id + '.json', draft)
  }
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
  const before = files.filter(path => path.endsWith('.json')).map(path => readFileSync(join(root, path)))
  const access = await connect(root)
  try {
    const call = (detailsFor: string | string[]) => access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor } })
    const menu = text(await call('content/ui/menu.json'))
    expect(text(await call(['content/ui/menu.json']))).toBe(menu) // String compatibility.
    const pause = text(await call('content/ui/pause.json'))
    const result = await call(['content/ui/menu.json', 'content/ui/pause.json', 'content/ui/menu.json'])
    const body = text(result)
    expect(result.isError).toBe(true) // Unselected overflow still fails the full check.
    for (const label of ['Saved-input checks:', 'Current source snapshot:', 'Coverage:', 'Authored values,'])
      expect(body.split(label)).toHaveLength(2)
    for (const id of ['menu', 'pause']) {
      expect(body.split('## Saved node facts — content/ui/' + id + '.json')).toHaveLength(2)
      for (const viewport of ['960 × 540', '600 × 360', '844 × 390'])
        expect(body).toContain('## content/ui/' + id + '.json — ' + viewport)
      const facts = (value: string) => value.split('## Saved node facts — content/ui/' + id + '.json\n\n')[1]!.split('\n')[0]!
      expect(JSON.parse(facts(body))).toEqual(JSON.parse(facts(id === 'menu' ? menu : pause)))
    }
    for (const id of ['healthy', 'overflow']) {
      expect(body).toContain('content/ui/' + id + '.json')
      expect(body).not.toContain('## content/ui/' + id + '.json')
      expect(body).not.toContain(id + '_TEXT')
    }
    const global = (value: string) => value.split('\n\n## ')[0]
    expect(global(body)).toBe(global(menu)) // Every diagnostic/issue and source hash retained.
    expect(body.length).toBeLessThan(menu.length + pause.length)
    const partial = await call(['content/ui/menu.json', 'content/ui/missing.json'])
    expect(partial.isError).toBe(true)
    expect(text(partial)).toContain('## Saved node facts — content/ui/menu.json')
    expect(text(partial)).toContain('"content/ui/missing.json": no measured screen/HUD geometry')
    expect(text(partial)).not.toContain('## Saved node facts — content/ui/missing.json')
    expect(readdirSync(root, { recursive: true })).toEqual(files)
    expect(files.filter(path => path.endsWith('.json')).map(path => readFileSync(join(root, path)))).toEqual(before)
    expect((await access.client.callTool({ name: 'CheckSceneLayouts', arguments: { detailsFor: ['content/scenes/level.json'] } })).isError).toBe(true)
  } finally { await access.close() }
}, 20_000)

test('reports variant selection, effective flow constraints and existing spatial observations without treating overlap as failure', async () => {
  const { root, save } = fixture()
  const draft: any = uiLayoutFixture()
  draft.data.nodes[0].data.targetViewports = [[844, 390]]
  draft.data.nodes.splice(1, 1,
    { id: 'group', role: 'container', parentId: 'root', layout: { anchor: 'middle-center', size: [320, 200],
      container: { direction: 'column', gap: 20, align: 'center', justify: 'center' } },
      responsive: { compact: { layout: { container: { direction: 'column', gap: 8 } } } } },
    { id: 'caption', role: 'text', text: 'Synthetic', parentId: 'group', layout: { size: [200, 30] } },
    { id: 'play', role: 'button', parentId: 'group', actions: { click: 'start' },
      layout: { size: [200, 52], minSize: [88, 44], maxSize: [240, 60] } },
    { id: 'overlay', role: 'button', parentId: 'group', layout: { anchor: 'bottom-right', size: [44, 44], item: { absolute: true } } },
    { id: 'hidden', role: 'text', text: 'Hidden', parentId: 'group', enabled: false, layout: { size: [200, 30] } },
    ...['one', 'two'].map(id => ({ id, role: 'text', text: id, parentId: 'root', layout: { position: [10, 10], size: [100, 30] } })))
  save('ui/menu.json', draft)
  const access = await connect(root)
  try {
    const before = readFileSync(join(root, 'content/ui/menu.json'))
    const files = readdirSync(root, { recursive: true })
    const summary = await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })
    expect(summary.isError).toBe(false)
    expect(text(summary)).toContain('"compactMaxWidth":600,"compactMaxWidthSource":"default","compact":false')
    expect(text(summary)).toContain('"overlapCandidates":[["one","two"]]')
    expect(text(summary)).toContain('not automatic failures')
    expect(text(summary)).not.toContain('Effective layout constraints')
    expect(text(summary)).not.toContain('| Host bounds |')
    expect(readFileSync(join(root, 'content/ui/menu.json'))).toEqual(before)

    // A normal source edit selects compact; the tool must read it afresh and
    // report the inherited alignment as well as the overriding gap.
    draft.data.nodes[0].data.compactMaxWidth = 900
    save('ui/menu.json', draft)
    const authored = readFileSync(join(root, 'content/ui/menu.json'))
    const detailed = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/menu.json' } })
    expect(detailed.isError).toBe(false)
    const body = text(detailed), phone = body.split('## content/ui/menu.json — 844 × 390')[1]!
    expect(phone).toContain('"compactMaxWidth":900,"compactMaxWidthSource":"authored","compact":true')
    expect(body).toContain('"compactMaxWidthSource":"authored","compact":false') // 960 stays base.
    const effective = JSON.parse(phone.split('\n').find(line => line.startsWith('Effective layout constraints'))!.split(': ')[1]!)
    expect(effective.find((node: any) => node.id === 'group').container)
      .toEqual({ direction: 'column', gap: 8, align: 'center', justify: 'center' })
    expect(phone).toContain('"id":"play","positionControlledBy":"flow:group","minSize":[88,44],"maxSize":[240,60]')
    expect(phone).toContain('"id":"overlay","positionControlledBy":"anchor","item":{"absolute":true}')
    expect(phone).toContain('"id":"hidden","positionControlledBy":"inactive"')
    const measured: any = runGameContentCommand(root, ['--design-layouts', '--details'], conditions)
    const nodes = measured.measurements.find((m: any) => m.viewport[0] === 844).nodes
    expect(phone).toContain(JSON.stringify(nodes.find((n: any) => n.id === 'play').bounds))
    expect(nodes.find((n: any) => n.id === 'play').bounds.top - nodes.find((n: any) => n.id === 'caption').bounds.bottom).toBe(8)
    expect(readFileSync(join(root, 'content/ui/menu.json'))).toEqual(authored)
    expect(readdirSync(root, { recursive: true })).toEqual(files)

    draft.data.nodes[1].layout.size = [160, 40]
    save('ui/menu.json', draft)
    const overflow = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/menu.json' } })
    expect(overflow.isError).toBe(true)
    expect(text(overflow)).toContain('"outsideContentArea"')
    expect(text(overflow)).toContain('Containment geometry:')
    expect(text(overflow)).toContain('"contentBounds"')
  } finally { await access.close() }
}, 20_000)

test('tool rejects command/size/workspace overrides, preserves missing-input errors and rejects symlinks without reading their contents', async () => {
  const { root } = fixture()
  const access = await connect(root)
  try {
    for (const args of [{ width: '960 540' }, { workspace: '/tmp' }, { command: 'anything' },
      { detailsFor: '../private.json' }, { detailsFor: '/tmp/private.json' }, { detailsFor: 'content/ui/../private.json' },
      { detailsFor: [] }, { detailsFor: [42] }, { detailsFor: ['content/ui/menu.json', '../private.json'] }]) {
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
    const linkedDetails = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: 'content/ui/escape.json' } })
    expect(linkedDetails.isError).toBe(true)
    expect(text(linkedDetails)).not.toContain('PRIVATE_SENTINEL')
    expect(text(linkedDetails)).not.toContain('## Saved node facts')
    const mixed = await access.client.callTool({ name: 'CheckUiLayouts', arguments: { detailsFor: ['content/ui/menu.json', 'content/ui/escape.json'] } })
    expect(mixed.isError).toBe(true)
    expect(text(mixed)).toContain('symbolic links')
    expect(text(mixed)).not.toContain('## Saved node facts') // Existing discovery rejects the entire unsafe UI input set.
    expect(text(mixed)).not.toContain('PRIVATE_SENTINEL')
    rmSync(join(root, 'content/ui'), { recursive: true })
    const absent = await access.client.callTool({ name: 'CheckUiLayouts', arguments: {} })
    expect(absent.isError).toBe(true)
    expect(text(absent)).toContain('unavailable')
  } finally { await access.close() }
}, 20_000)
