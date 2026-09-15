import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import {
  completedChecklistRun,
  createAcceptedIrChecklistFixture,
  disposeAcceptedIrChecklistFixture,
} from '../beegame/delivery-workflow/test-fixtures/accepted-ir-checklist'

test('Scene/UI endpoint reports that assets and content do not exist after IR alone', async () => {
  const fixture = await createAcceptedIrChecklistFixture()
  const dashboardRoot = await mkdtemp(join(tmpdir(), 'game-content-route-'))
  try {
    const run = completedChecklistRun(fixture)
    await createRunStore(fixture.workspace, run.ownerId).save(run)
    const app = createAgentWorkflowApp({
      currentUser: { id: run.ownerId, role: 'owner' },
      dashboardDataRoot: dashboardRoot,
      defaultWorkspacePath: fixture.workspace,
      modelConfigStore: false,
      skillsConfig: false,
    })
    const created = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: run.projectId,
        name: 'IR-only project',
        root_path: fixture.workspace,
        created_at: Date.now(),
      }),
    })
    expect(created.status).toBe(200)

    const response = await app.request(
      `/api/projects/${run.projectId}/game-content`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'awaiting_assets' })
  } finally {
    await disposeAcceptedIrChecklistFixture(fixture)
    await rm(dashboardRoot, { recursive: true, force: true })
  }
})
