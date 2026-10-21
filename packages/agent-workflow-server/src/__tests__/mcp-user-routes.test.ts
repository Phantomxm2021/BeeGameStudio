import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { getUserDashboardDataRoot } from '../local-runtime-service'
import { exportMcpServersSnapshot } from '../mcp-servers-store'

test('ordinary users manage only their own MCP entries without host discovery access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-user-'))
  const cleanups: Array<() => void> = []
  const makeApp = (id: string) => createAgentWorkflowApp({
    dashboardDataRoot: root,
    modelConfigStore: false,
    skillsConfig: false,
    currentUser: { id, role: 'viewer' },
    outboundTargetResolver: async value => ({ url: new URL(value), addresses: ['93.184.216.34'],
      lookup: (_host, _options, callback) => callback(null, '93.184.216.34', 4) }),
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const alice = makeApp('alice')
  const bob = makeApp('bob')
  const body = {
    name: 'My MCP', enabled: true, transport: 'http', scope: 'beegame', url: 'https://mcp.example.test',
  }
  try {
    const created = await alice.request('/api/mcp-servers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, id: 'injected-id' }),
    })
    expect(created.status).toBe(200)
    for (const route of ['/api/mcp-servers', '/api/mcp-servers/test']) {
      const legacy = await alice.request(route, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, transport: 'sse' }) })
      expect(legacy.status).toBe(400)
      expect(await legacy.text()).toContain('Streamable HTTP')
    }
    // Saving, updating, and testing all enforce the same host execution boundary.
    for (const transport of ['stdio', undefined, null, 1, {}, []]) {
      expect((await alice.request('/api/mcp-servers', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Host', command: 'never-executed', autoStart: true, transport }),
      })).status).toBe(403)
      expect((await alice.request('/api/mcp-servers/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Host', command: 'never-executed', transport }),
      })).status).toBe(403)
    }
    expect((await alice.request('/api/mcp-servers/test', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, transport: 'stdio', command: 'never-executed' }),
    })).status).toBe(403)
    const saved = await created.json() as { id: string; name: string }
    expect(saved.id).not.toBe('injected-id')
    expect((await alice.request(`/api/mcp-servers/${saved.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, transport: 'stdio', command: 'never-executed', autoStart: true }),
    })).status).toBe(403)
    expect((await (await alice.request('/api/mcp-servers')).json()).length).toBe(1)
    expect(await (await bob.request('/api/mcp-servers')).json()).toEqual([])
    expect((await bob.request(`/api/mcp-servers/${saved.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })).status).toBe(404)
    expect((await bob.request(`/api/mcp-servers/${saved.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await (await alice.request('/api/mcp-servers')).json()).length).toBe(1)
    const updated = await alice.request(`/api/mcp-servers/${saved.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, name: 'Updated MCP' }),
    })
    expect(updated.status).toBe(200)
    expect((await updated.json() as { name: string }).name).toBe('Updated MCP')
    expect((await alice.request(`/api/mcp-servers/${saved.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await (await alice.request('/api/mcp-servers')).json()).toEqual([])
    expect((await alice.request('/api/mcp-servers/discover')).status).toBe(403)
    expect((await alice.request('/api/mcp-servers/discover-active')).status).toBe(403)
    expect((await alice.request('/api/mcp-servers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'host-mcp', sourcePath: '/host/.mcp.json' }),
    })).status).toBe(403)
  } finally {
    cleanups.forEach(cleanup => cleanup())
    await rm(root, { recursive: true, force: true })
  }
})

test('host-authorized stdio imports preserve credentials on the backend and reject unknown sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-import-'))
  const previousKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 39).toString('base64')
  const cleanups: Array<() => void> = []
  const userRoot = getUserDashboardDataRoot(root, 'owner')
  const sourcePath = join(userRoot, '.mcp.json')
  const app = createAgentWorkflowApp({
    dashboardDataRoot: root, modelConfigStore: false, skillsConfig: false,
    currentUser: { id: 'owner', role: 'owner' },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const requestImport = (path: string) => app.request('/api/mcp-servers', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'fixture', sourcePath: path, command: 'browser-override' }),
  })
  try {
    await mkdir(userRoot, { recursive: true })
    await writeFile(sourcePath, JSON.stringify({ mcpServers: {
      fixture: { command: '/fixture/never-executed', env: { TOKEN: 'fixture-import-secret' } },
    } }))
    expect((await requestImport(join(root, 'unknown.json'))).status).toBe(404)
    const imported = await requestImport(sourcePath)
    expect(imported.status).toBe(200)
    const publicConfig = await imported.json()
    expect(publicConfig.command).toBe('/fixture/never-executed')
    expect(JSON.stringify(publicConfig)).not.toContain('fixture-import-secret')
    expect(exportMcpServersSnapshot({ dataDir: userRoot })[0]?.env).toEqual([
      { key: 'TOKEN', value: 'fixture-import-secret' },
    ])
    const missingName = await app.request('/api/mcp-servers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'fixture' }),
    })
    expect(missingName.status).toBe(400)
  } finally {
    cleanups.forEach(cleanup => cleanup())
    if (previousKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = previousKey
    await rm(root, { recursive: true, force: true })
  }
})
