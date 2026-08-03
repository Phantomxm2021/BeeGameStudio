import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { DELIVERY_RUN_SCHEMA_VERSION } from '../beegame/delivery-workflow/types'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

describe('obsolete workflow restart route', () => {
  test('exposes one explicit restart action and replaces the obsolete snapshot with the current protocol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-workflow-restart-'))
    const projectsRoot = join(root, 'projects')
    const ownerId = 'workflow-restart-owner'
    const projectId = 'workflow-restart-project'
    const workspace = join(projectsRoot, 'users', ownerId, projectId)
    const cleanup: Array<() => void> = []
    await mkdir(workspace, { recursive: true })

    try {
      const app = createAgentWorkflowApp({
        currentUser: { id: ownerId, role: 'owner' },
        dashboardDataRoot: join(root, 'dashboard'),
        defaultWorkspacePath: projectsRoot,
        modelConfigStore: false,
        skillsConfig: false,
        registerCleanup: callback => cleanup.push(callback),
        sessionRunner: {
          async start() {
            return {
              async submit() {},
              stop() {},
            }
          },
        },
      })
      const projectResponse = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Workflow restart route test',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectResponse.status).toBe(200)

      const store = createRunStore(workspace, ownerId)
      const obsolete = createTestDeliveryRun({
        runId: 'obsolete-run',
        projectId,
        ownerId,
        confirmedBriefContext: 'Build the confirmed game.',
      })
      await mkdir(store.paths.directory, { recursive: true })
      await writeFile(
        store.paths.snapshot,
        `${JSON.stringify({
          ...obsolete,
          schemaVersion: DELIVERY_RUN_SCHEMA_VERSION - 1,
          activeDispatch: { retiredStateMarker: true },
        })}\n`,
      )
      const historicalLogDirectory = join(
        store.paths.directory,
        'logs',
        obsolete.runId,
      )
      await mkdir(historicalLogDirectory, { recursive: true })
      await writeFile(
        join(historicalLogDirectory, 'index.json'),
        JSON.stringify({
          version: 1,
          project: projectId,
          updatedAt: new Date().toISOString(),
          sessions: {
            'completed-reviewer-session': {
              sessionId: 'completed-reviewer-session',
              transcript:
                '.beegame/workflow/logs/obsolete-run/reviewer/transcript.jsonl',
              agentRawLog:
                '.beegame/workflow/logs/obsolete-run/reviewer/agent.raw.jsonl',
              runtimeLog:
                '.beegame/workflow/logs/obsolete-run/reviewer/runtime.log',
              previewLog: 'logs/preview.log',
              deployLog: 'logs/deploy.log',
              updatedAt: new Date().toISOString(),
            },
          },
        }),
      )

      const readResponse = await app.request(
        `/api/projects/${projectId}/workflow`,
      )
      expect(readResponse.status).toBe(200)
      expect(await readResponse.json()).toMatchObject({
        workflow: {
          runId: 'workflow-state-error',
          status: 'needs_action',
          nextAction: 'restart',
        },
        events: [],
      })

      const restartResponse = await app.request(
        `/api/projects/${projectId}/workflow/restart`,
        { method: 'POST' },
      )
      const restarted = (await restartResponse.json()) as {
        schemaVersion: number
        runId: string
        error?: string
      }
      expect({
        status: restartResponse.status,
        error: restarted.error,
      }).toEqual({ status: 202, error: undefined })
      expect(restarted.schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
      expect(restarted.runId).not.toBe(obsolete.runId)
      expect((await store.load())?.schemaVersion).toBe(
        DELIVERY_RUN_SCHEMA_VERSION,
      )
    } finally {
      for (const dispose of cleanup) dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
