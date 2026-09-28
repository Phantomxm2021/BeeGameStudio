import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'

describe('project stop route', () => {
  test('returns 404 when no Agent session exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-project-stop-'))
    const projectsRoot = join(root, 'projects')
    const ownerId = 'project-stop-owner'
    const projectId = 'project-stop-test'
    const workspace = join(projectsRoot, 'users', ownerId, projectId)
    await mkdir(workspace, { recursive: true })

    try {
      const app = createAgentWorkflowApp({
        currentUser: { id: ownerId, role: 'owner' },
        dashboardDataRoot: join(root, 'dashboard'),
        defaultWorkspacePath: projectsRoot,
        modelConfigStore: false,
        skillsConfig: false,
      })
      const projectResponse = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Project stop route test',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectResponse.status).toBe(200)

      const response = await app.request(`/api/projects/${projectId}/stop`, {
        method: 'POST',
      })

      expect(response.status).toBe(404)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
