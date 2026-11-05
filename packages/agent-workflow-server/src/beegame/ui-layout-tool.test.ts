import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV, NATIVE_READ_TOOLS } from './native-mcp-config'
import { uiLayoutFixture, sceneLayoutFixture } from './fixtures/layout-fixture'
import type { LayoutConstraints } from './ui-layout-audit'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
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
async function connect(root: string, constraints: LayoutConstraints = conditions) {
  const prepared = await prepareNativeMcpConfig({}, root, constraints)
  const servers = prepared.config.mcp_servers as Record<string, ConstructorParameters<typeof StdioClientTransport>[0]>
  expect(Object.keys(servers)).toEqual(['bgs-ui-layout'])
  const client = new Client({ name: 'offline-layout-test', version: '1' })
  try { await client.connect(new StdioClientTransport(servers['bgs-ui-layout']!)) }
  catch (error) { await client.close(); await prepared.close(); throw error }
  return { client, close: async () => { await client.close(); await prepared.close() } }
}

test('host tool is turn-scoped and cannot be replaced by an external MCP record', async () => {
  const { root } = fixture()
  expect((await prepareNativeMcpConfig({}, root)).config).toEqual({})
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
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Offline fixture' })
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

test.each([
  {platform:'Web',engine:'React'}, {platform:'Web',engine:'Phaser'}, {platform:'Web',engine:'Three.js'},
  {platform:'PC',engine:'Unity'}, {platform:'PC',engine:'Godot'}, {platform:'PC',engine:'Unreal'},
  {platform:'Mobile',engine:'Unity'}, {platform:'XR',engine:'Unity'}, {},
])('all targets expose project reads, not BGS editor operations: %j', async target => {
  const {root}=fixture()
  const manifest=assetManifestAuthoringExamples().canonical; manifest.resources=[];manifest.requirements=[]
  await writeBeeGameAssetManifest(root,manifest)
  const before=readFileSync(join(root,'content/ui/menu.json')), files=readdirSync(root,{recursive:true})
  const access=await connect(root,{...conditions,...target})
  try {
    const tools=(await access.client.listTools()).tools
    expect(tools.map(t=>t.name).sort()).toEqual([...NATIVE_READ_TOOLS].sort())
    expect(tools.every(t=>t.annotations?.readOnlyHint===true)).toBe(true)
    const designRead=tools.find(tool=>tool.name==='ReadDesignHandoff')!
    expect(designRead.description).toContain('that heading and its descendant sections')
    expect(designRead.description).toContain('the document title reads the full file')
    expect(tools.map(t=>t.name)).not.toContain('CheckUiLayouts')
    expect(tools.map(t=>t.name)).not.toContain('CheckSceneLayouts')
    const resourceRead=tools.find(tool=>tool.name==='CheckResourcesAndBindings')!
    expect(resourceRead.description).toContain('registered-file facts, missing structural evidence and actual contract issues')
    expect(resourceRead.description).not.toMatch(/runtime evidence|visual quality|native scene/i)
    const resources=await access.client.callTool({name:'CheckResourcesAndBindings',arguments:{}})
    expect(resources.isError).toBe(false)
    expect(JSON.parse(text(resources))).toMatchObject({valid:true,scope:'registered-resources'})
    for(const name of ['CheckUiLayouts','CheckSceneLayouts'])
      expect((await access.client.callTool({name,arguments:{}})).isError).toBe(true)
    expect(readFileSync(join(root,'content/ui/menu.json'))).toEqual(before)
    expect(readdirSync(root,{recursive:true})).toEqual(files)
  } finally {await access.close()}
},20_000)

test('resource reads reject missing Manifest and retired node requests without creating content',async()=>{
  const {root}=fixture(),access=await connect(root,{platform:'PC',engine:'Godot'})
  try {
    const result=await access.client.callTool({name:'CheckResourcesAndBindings',arguments:{}})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('manifest.json is missing')
    expect((await access.client.callTool({name:'CheckResourcesAndBindings',arguments:{detailsFor:'content/ui/menu.json'}})).isError).toBe(true)
  }finally{await access.close()}
})
