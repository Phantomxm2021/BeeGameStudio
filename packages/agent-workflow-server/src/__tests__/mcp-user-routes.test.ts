import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'

test('ordinary users manage only their own MCP entries without host discovery access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-user-'))
  const cleanups: Array<() => void> = []
  const makeApp = (id: string) => createAgentWorkflowApp({
    dashboardDataRoot: root,
    modelConfigStore: false,
    skillsConfig: false,
    currentUser: { id, role: 'viewer' },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const alice = makeApp('alice')
  const bob = makeApp('bob')
  const body = {
    name: 'My MCP', enabled: true, transport: 'stdio', scope: 'beegame', command: 'echo',
  }
  try {
    const created = await alice.request('/api/mcp-servers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, id: 'injected-id' }),
    })
    expect(created.status).toBe(200)
    const saved = await created.json() as { id: string; name: string }
    expect(saved.id).not.toBe('injected-id')
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
  } finally {
    cleanups.forEach(cleanup => cleanup())
    await rm(root, { recursive: true, force: true })
  }
})
