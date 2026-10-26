import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentWorkflowApp } from '../app'
import { DashboardRepository } from '../dashboard-repository'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-bootstrap-preflight-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let runnerStarts = 0
  const store = createLocalWorkflowStore(join(root, 'workflow'))
  const app = createAgentWorkflowApp({
    currentUser: { id: 'preflight-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    workflowV3Store: store, modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start() { runnerStarts++; throw Error('Preflight must not start a model') } },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const model = await app.request('/api/model-configs', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Offline fixture', provider: 'openai-compatible',
      apiKey: 'synthetic', model: 'fixture', isDefault: true }),
  })
  expect(model.status).toBe(200)
  const body = {
    project: { id: 'preflight-fixture', name: 'Synthetic project', created_at: Date.now() },
    brief: { idea: 'Synthetic request', option: { title: 'Selected direction' },
      settings: { orientation: 'Landscape', resourceLibraryUsage: 'optional' },
      attachments: [{ type: 'file', filename: 'brief.txt', mediaType: 'text/plain',
        data: Buffer.from('Synthetic reference').toString('base64') }],
      documentLanguage: 'en', gameUserVisibleLanguage: 'en', agentResponseLanguage: 'en' },
  }
  async function assertNoWorkspace() {
    const directories = await readdir(join(root, 'projects', 'users', 'preflight-owner'))
      .catch(error => { if (error.code === 'ENOENT') return []; throw error })
    expect(directories).toEqual([])
    expect(runnerStarts).toBe(0)
  }
  return { app, body, assertNoWorkspace,
    async assertNoProject() {
      expect(await (await app.request('/api/projects')).json()).toEqual([])
      expect(await (await app.request('/api/beegame-sessions')).json()).toEqual([])
      expect(await store.read(body.project.id, 'preflight-owner')).toBeUndefined()
      await assertNoWorkspace()
    },
    async close() {
      for (const cleanup of cleanups.reverse()) await cleanup()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test.each(['language', 'resource policy', 'selected option'])(
  'invalid bootstrap %s creates no project, session, workspace or attachments', async invalid => {
    const f = await fixture()
    try {
      const body: any = structuredClone(f.body)
      if (invalid === 'language') body.brief.documentLanguage = 'unsupported'
      if (invalid === 'resource policy') body.brief.settings.resourceLibraryUsage = 'unsupported'
      if (invalid === 'selected option') delete body.brief.option
      const response = await f.app.request('/api/projects/bootstrap', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(response.status).toBe(400)
      await f.assertNoProject()
    } finally { await f.close() }
  },
)

test('failed model configuration lookup creates no bootstrap workspace', async () => {
  const f = await fixture()
  const lookup = spyOn(DashboardRepository.prototype, 'listModelConfigs')
    .mockRejectedValueOnce(Error('Synthetic configuration failure'))
  try {
    const response = await f.app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.body) })
    expect(response.status).toBe(400)
    // The previous Promise.all could leave a rejected lookup's mkdir running.
    await Bun.sleep(10)
    await f.assertNoProject()
  } finally { lookup.mockRestore(); await f.close() }
})

test('project quota rejection happens before creating a workspace or reference attachments', async () => {
  const previousLimit = process.env.BEEGAME_MAX_PROJECTS_PER_USER
  process.env.BEEGAME_MAX_PROJECTS_PER_USER = '1'
  const f = await fixture()
  try {
    const existing = { id: 'existing-project', name: 'Existing project', created_at: Date.now() }
    expect((await f.app.request('/api/projects', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(existing) })).status).toBe(200)
    const response = await f.app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.body) })
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_QUOTA_EXCEEDED', limit: 1, projectCount: 1 })
    expect(await (await f.app.request('/api/projects')).json()).toMatchObject([existing])
    expect(await (await f.app.request('/api/beegame-sessions')).json()).toEqual([])
    await f.assertNoWorkspace()
  } finally {
    if (previousLimit === undefined) delete process.env.BEEGAME_MAX_PROJECTS_PER_USER
    else process.env.BEEGAME_MAX_PROJECTS_PER_USER = previousLimit
    await f.close()
  }
})
