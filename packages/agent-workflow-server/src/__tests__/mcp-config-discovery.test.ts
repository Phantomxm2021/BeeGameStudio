import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverMcpServers, readDiscoveredMcpServerInput, upsertMcpServer, listMcpServers } from '../mcp-servers-store'

test('discovers stdio from Bgs and JSON client configs without exposing environment values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-discovery-'))
  const options = { dataDir: join(root, 'bgs'), homeDir: root }
  const bgs = join(root, '.bgs', 'config.toml')
  try {
    await mkdir(join(root, '.bgs'))
    await mkdir(join(root, '.cursor'))
    await writeFile(bgs, '[mcp_servers.blender]\ncommand = "/fixture/blender-mcp"\nargs = ["--safe"]\n[mcp_servers.blender.env]\nTOKEN = "fixture-private-token"\n')
    await writeFile(join(root, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
      duplicate: { command: '/fixture/blender-mcp', args: ['--safe'] },
      distinct: { command: '/fixture/other-mcp', args: [] },
    } }))
    const discovered = await discoverMcpServers(options)
    expect(discovered).toHaveLength(2)
    // Duplicate command/args configurations appear once, regardless of client.
    expect(discovered.filter(server => server.command === '/fixture/blender-mcp')).toHaveLength(1)
    expect(JSON.stringify(discovered)).not.toContain('fixture-private-token')
    expect(readDiscoveredMcpServerInput(bgs, 'blender', options)).toMatchObject({
      transport: 'stdio', command: '/fixture/blender-mcp', args: ['--safe'],
      env: [{ key: 'TOKEN', value: 'fixture-private-token' }],
    })
    // Imports cannot request arbitrary files, even if they contain valid MCP JSON.
    const arbitrary = join(root, 'private.json')
    await writeFile(arbitrary, JSON.stringify({ mcpServers: { stolen: { command: 'private' } } }))
    expect(readDiscoveredMcpServerInput(arbitrary, 'stolen', options)).toBeUndefined()
    expect(readDiscoveredMcpServerInput(bgs, 'missing', options)).toBeUndefined()
    await writeFile(bgs, 'invalid = "fixture-private-token')
    await expect(discoverMcpServers(options)).rejects.toThrow(`Unable to read MCP configuration: ${bgs}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('configuration discovery accepts new public HTTPS hosts and filters unsafe endpoints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-public-discovery-'))
  try {
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: {
      public: { url: 'https://new-mcp.example/mcp' },
      local: { url: 'https://127.0.0.1/mcp' },
      insecure: { url: 'http://new-mcp.example/mcp' },
    } }))
    const discovered = await discoverMcpServers({ dataDir: root, homeDir: root,
      outboundTargetPolicyOptions: { allowedHosts: ['model.example'], allowHttp: true,
        resolve4: () => ['93.184.216.34'], resolve6: () => [] },
    })
    expect(discovered.map(server => server.name)).toEqual(['public'])
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('stored stdio argv retains quoted whitespace and empty arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-discovery-'))
  try {
    const args = ['@playwright/mcp@latest', '--label', ' two words ', '']
    const options = { dataDir: root }
    const saved = upsertMcpServer({name:'playwright', enabled:true, autoStart:true, scope:'beegame',
      transport:'stdio', command:'npx', args}, options)
    expect(saved.args).toEqual(args)
    expect(listMcpServers(options)[0].args).toEqual(args)
  } finally { await rm(root, {recursive:true,force:true}) }
})


test('MCP tool selections survive import, storage and partial updates with explicit reset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-discovery-'))
  const options = { dataDir: join(root, 'store'), homeDir: root }
  const source = join(root, '.mcp.json')
  try {
    await writeFile(source, JSON.stringify({ mcpServers: {
      browser: { command: '/fixture/browser', enabled_tools: ['browser_run_code_unsafe'], disabled_tools: ['browser_click'] },
      blocked: { command: '/fixture/blocked', enabled_tools: [] },
      unrestricted: { command: '/fixture/browser' },
    } }))
    const discovered = await discoverMcpServers(options)
    expect(discovered.find(server => server.name === 'browser')).toMatchObject({
      enabledTools: ['browser_run_code_unsafe'], disabledTools: ['browser_click'],
    })
    expect(discovered.find(server => server.name === 'blocked')?.enabledTools).toEqual([])
    expect(discovered.filter(server => server.command === '/fixture/browser')).toHaveLength(2)
    const input = readDiscoveredMcpServerInput(source, 'browser', options)!
    const saved = upsertMcpServer(input, options)
    expect(listMcpServers(options)[0]).toMatchObject({
      enabledTools: ['browser_run_code_unsafe'], disabledTools: ['browser_click'],
    })
    upsertMcpServer({ ...input, id: saved.id, enabledTools: undefined, disabledTools: undefined, name: 'Renamed' }, options)
    expect(listMcpServers(options)[0]?.enabledTools).toEqual(['browser_run_code_unsafe'])
    for (const invalid of ['all', [''], [1]]) {
      expect(() => upsertMcpServer({ ...input, id: saved.id, enabledTools: invalid as any }, options)).toThrow('MCP tool selection')
      expect(listMcpServers(options)[0]?.enabledTools).toEqual(['browser_run_code_unsafe'])
    }
    upsertMcpServer({ ...input, id: saved.id, enabledTools: [], disabledTools: [] }, options)
    expect(listMcpServers(options)[0]?.enabledTools).toEqual([])
    upsertMcpServer({ ...input, id: saved.id, enabledTools: null, disabledTools: null }, options)
    expect(listMcpServers(options)[0]?.enabledTools).toBeUndefined()
    expect(listMcpServers(options)[0]?.disabledTools).toBeUndefined()
    await writeFile(source, JSON.stringify({ mcpServers: { bad: { command: '/fixture/bad', enabled_tools: [''] } } }))
    await expect(discoverMcpServers(options)).rejects.toThrow('MCP tool selection')
  } finally { await rm(root, { recursive: true, force: true }) }
})
