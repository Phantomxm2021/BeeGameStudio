import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { getUserDashboardDataRoot } from '../local-runtime-service'

test('retired migration and content-publish endpoints are absent for an owned project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-retired-routes-'))
  const cleanups: Array<() => void | Promise<void>> = []
  try {
    const workspace = join(root, 'projects/users/owner/game')
    await mkdir(workspace, { recursive: true })
    const app = createAgentWorkflowApp({ currentUser: { id: 'owner', role: 'owner' },
      dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
      modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup) })
    const archivedRoot = getUserDashboardDataRoot(join(root, 'dashboard'), 'owner')
    await mkdir(archivedRoot, { recursive: true })
    const archivedPath = join(archivedRoot, 'web-tools.json')
    const archivedConfig = JSON.stringify({ version: 1, config: { braveApiKey: 'historical-test-secret' } })
    await writeFile(archivedPath, archivedConfig)
    expect((await app.request('/api/web-tools')).status).toBe(404)
    expect((await app.request('/api/web-tools', { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clearSecret: true }) })).status).toBe(404)
    expect(await readFile(archivedPath, 'utf8')).toBe(archivedConfig)
    const created = await app.request('/api/projects', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'game', name: 'Game', root_path: workspace, created_at: Date.now() }) })
    expect(created.status).toBe(200)
    expect((await app.request('/api/projects/game/production-migration', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/api/projects/game/quality-review', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect((await app.request('/api/projects/game/production')).status).toBe(404)
    expect((await app.request('/api/projects/game/design-review')).status).toBe(404)
    expect((await app.request('/api/projects/game/design-resolution', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect((await app.request('/api/projects/game/queued-messages')).status).toBe(404)
    expect((await app.request('/api/projects/game/queued-messages/old', { method: 'DELETE' })).status).toBe(404)
    expect((await app.request('/api/projects/game/queued-messages/old/steer', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/api/projects/game/stop', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/api/projects/game/game-content/publish', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
