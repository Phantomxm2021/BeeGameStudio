import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorkflowDispatchStopBridge,
  createAgentWorkflowApp,
  stopWorkflowDispatchById,
} from '../app'
import {
  createRunStore,
} from '../beegame/delivery-workflow/run-store'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

describe('project stop route', () => {
  test('routes project stop through the live session-manager dispatch', async () => {
    const disposed: string[] = []
    const fallbackStops: string[] = []
    const bridge = createWorkflowDispatchStopBridge({
      isManagedDispatchOpen: dispatchId => dispatchId === 'dispatch-live',
      disposeManagedDispatch: async dispatchId => {
        disposed.push(dispatchId)
        return 1
      },
      fallbackIsOpen: async () => false,
      fallbackStop: async dispatchId => {
        fallbackStops.push(dispatchId)
      },
    })

    expect(
      await bridge.sessionIsOpen({ dispatchId: 'dispatch-live' }),
    ).toBe(true)
    await bridge.stopDispatch('dispatch-live', 'user stopped workflow')
    expect(disposed).toEqual(['dispatch-live'])
    expect(fallbackStops).toEqual([])
  })

  test('waits for the exact session-manager dispatch before returning', async () => {
    let releaseDisposal!: () => void
    const disposalGate = new Promise<void>(resolve => {
      releaseDisposal = resolve
    })
    const disposedDispatches: string[] = []
    const fallbackDispatches: string[] = []

    let settled = false
    const stopping = stopWorkflowDispatchById({
      dispatchId: 'dispatch-live',
      reason: 'user stopped workflow',
      disposeWorkflowDispatch: async dispatchId => {
        disposedDispatches.push(dispatchId)
        await disposalGate
        return 1
      },
      fallbackStop: async dispatchId => {
        fallbackDispatches.push(dispatchId)
      },
    }).then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(disposedDispatches).toEqual(['dispatch-live'])
    expect(settled).toBe(false)
    releaseDisposal()
    await stopping
    expect(fallbackDispatches).toEqual([])
  })

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
        createTestDeliveryRun({
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
