import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import {
  createInitialDeliveryRun,
  createRunStore,
} from '../beegame/delivery-workflow/run-store'

describe('project stop route', () => {
  test('stops a durable workflow even when no ordinary project session exists', async () => {
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

      const store = createRunStore(workspace, ownerId)
      await store.save(
        createInitialDeliveryRun({
          runId: 'run-project-stop',
          projectId,
          ownerId,
          confirmedBriefDigest: 'brief-project-stop',
        }),
      )

      const response = await app.request(`/api/projects/${projectId}/stop`, {
        method: 'POST',
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        id: 'run-project-stop',
        cwd: workspace,
        status: 'stopped',
        turnStatus: 'idle',
      })
      expect(await store.load()).toMatchObject({
        status: 'stopped',
        blockedReason: 'user stopped workflow',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
