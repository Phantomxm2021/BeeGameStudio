import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverMcpServers, readDiscoveredMcpServerInput } from '../mcp-servers-store'

test('discovers stdio from Codex and JSON client configs without exposing environment values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-discovery-'))
  const options = { dataDir: join(root, 'bgs'), homeDir: root }
  const codex = join(root, '.codex', 'config.toml')
  try {
    await mkdir(join(root, '.codex'))
    await mkdir(join(root, '.cursor'))
    await writeFile(codex, '[mcp_servers.blender]\ncommand = "/fixture/blender-mcp"\nargs = ["--safe"]\n[mcp_servers.blender.env]\nTOKEN = "fixture-private-token"\n')
    await writeFile(join(root, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
      duplicate: { command: '/fixture/blender-mcp', args: ['--safe'] },
      distinct: { command: '/fixture/other-mcp', args: [] },
    } }))
    await writeFile(join(root, '.claude.json'), JSON.stringify({ mcpServers: {
      claude: { command: '/fixture/claude-mcp' },
    } }))
    const discovered = await discoverMcpServers(options)
    expect(discovered).toHaveLength(3)
    // Duplicate command/args configurations appear once, regardless of client.
    expect(discovered.filter(server => server.command === '/fixture/blender-mcp')).toHaveLength(1)
    expect(JSON.stringify(discovered)).not.toContain('fixture-private-token')
    expect(readDiscoveredMcpServerInput(codex, 'blender', options)).toMatchObject({
      transport: 'stdio', command: '/fixture/blender-mcp', args: ['--safe'],
      env: [{ key: 'TOKEN', value: 'fixture-private-token' }],
    })
    // Imports cannot request arbitrary files, even if they contain valid MCP JSON.
    const arbitrary = join(root, 'private.json')
    await writeFile(arbitrary, JSON.stringify({ mcpServers: { stolen: { command: 'private' } } }))
    expect(readDiscoveredMcpServerInput(arbitrary, 'stolen', options)).toBeUndefined()
    expect(readDiscoveredMcpServerInput(codex, 'missing', options)).toBeUndefined()
    await writeFile(codex, 'invalid = "fixture-private-token')
    await expect(discoverMcpServers(options)).rejects.toThrow(`Unable to read MCP configuration: ${codex}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
