import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { materializeBeeGameAttachments } from '../beegame/session-manager'

test('only the owning project can retrieve an attachment, including after app recreation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-attachment-route-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const projects = join(root, 'projects')
  const workspace = join(projects, 'users', 'owner', 'p')
  const makeApp = (id: string) => createAgentWorkflowApp({
    currentUser: { id, role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: projects, modelConfigStore: false, skillsConfig: false,
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    await mkdir(workspace, { recursive: true })
    const app = makeApp('owner')
    expect((await app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'p', name: 'Attachments', root_path: workspace, created_at: Date.now() }),
    })).status).toBe(200)
    const [attachment] = await materializeBeeGameAttachments(workspace, [
      { type: 'image', filename: 'ref.png', mediaType: 'image/png', data: 'aW1hZ2U=' },
    ])
    const path = `/api/projects/p/chat-attachments/${attachment!.storageId}`
    const restored = await makeApp('owner').request(path)
    expect(restored.status).toBe(200)
    expect(await restored.text()).toBe('image')
    expect((await makeApp('other-owner').request(path)).status).toBe(404)
    expect((await app.request('/api/projects/p/chat-attachments/unknown')).status).toBe(404)
  } finally {
    for (const cleanup of cleanups) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
