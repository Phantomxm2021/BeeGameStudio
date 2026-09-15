import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { writeBeeGameAssetManifest } from '../beegame/asset-contracts'
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

test('Scene Editor can read only verified files registered by the project Manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scene-editor-resource-route-'))
  const workspace = join(root, 'project')
  const dashboardRoot = join(root, 'dashboard')
  const assetPath = 'assets/runtime/background.png'
  try {
    await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
    await writeFile(join(workspace, assetPath), new Uint8Array([137, 80, 78, 71]))
    await writeBeeGameAssetManifest(workspace, {
      version: 9,
      requirements: [],
      resources: [{
        id: 'asset.background',
        fulfills: [],
        source: {
          type: 'agent-authored',
          created_at: '2026-09-16T00:00:00.000Z',
          reason: 'route fixture',
        },
        root_path: assetPath,
        file_paths: [assetPath],
        provisional: false,
        status: 'verified',
        selected_at: '2026-09-16T00:00:00.000Z',
        selection_reason: ['Scene fixture'],
      }],
    })
    const app = createAgentWorkflowApp({
      currentUser: { id: 'dashboard-local', role: 'owner' },
      dashboardDataRoot: dashboardRoot,
      defaultWorkspacePath: root,
      modelConfigStore: false,
      skillsConfig: false,
    })
    const created = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'scene-resource-project',
        name: 'Scene resource project',
        root_path: workspace,
        created_at: Date.now(),
      }),
    })
    expect(created.status).toBe(200)

    const response = await app.request(
      `/api/projects/scene-resource-project/assets/resources/asset.background/file?path=${encodeURIComponent(assetPath)}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71])

    const rejected = await app.request(
      '/api/projects/scene-resource-project/assets/resources/asset.background/file?path=content/index.json',
    )
    expect(rejected.status).toBe(404)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
