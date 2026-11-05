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
  const contexts:string[]=[],prompts:string[]=[]
  const store = createLocalWorkflowStore(join(root, 'workflow'))
  const app = createAgentWorkflowApp({
    currentUser: { id: 'preflight-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    workflowV3Store: store, modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
      runnerStarts++
      contexts.push(input.systemContext ?? '')
      input.onNativeSessionId?.('11111111-2222-4333-8444-555555555555')
      return { stop() {}, async submit(turn) {
        prompts.push(typeof turn.prompt==='string'?turn.prompt:JSON.stringify(turn.prompt))
        await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic document task ended' })
      } }
    } },
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
  return { app, body, store, contexts, prompts, assertNoWorkspace,
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


test.each(['creative', 'blueprint'])('new %s bootstrap excludes cached automatic scope while preserving explicit requirements and settings', async creationMode => {
  const f = await fixture()
  try {
    const idea = 'Make ten levels with hand-drawn art and no external artwork downloads.'
    const notes = 'Keep the ten-level requirement and keyboard controls.'
    const response = await f.app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f.body,
        brief: { ...f.body.brief, creationMode, idea,
          option: { title: 'Selected direction', gameplay: 'Catch falling objects and restart after the result.',
            recommendedStyle: 'Minimal', scope: 'Hidden generated SVG-only restriction' },
          settings: { ...f.body.brief.settings, platform: 'Web', engine: 'React', dimension: '2D',
            visualStyle: 'Hand-drawn', notes, scope: 'Hidden generated geometry-only restriction' },
        },
      }) })
    expect(response.status, await response.clone().text()).toBe(202)
    const run = (await f.store.read(f.body.project.id, 'preflight-owner'))!
    const brief = JSON.parse(run.requirements.text)
    expect(brief.idea).toBe(idea)
    expect(brief.default_first_release_scope.target).toBe('playable MVP for first user playtesting')
    expect(brief.default_first_release_scope.content).toContain('explicit user requirements remain in scope')
    expect(brief.settings).toMatchObject({ visualStyle: 'Hand-drawn', notes, orientation: 'Landscape', resourceLibraryUsage: 'optional' })
    expect(brief.selected_option).toEqual({ title: 'Selected direction', gameplay: 'Catch falling objects and restart after the result.' })
    expect(brief.settings).not.toHaveProperty('scope')
    expect(run.requirements.constraints).not.toHaveProperty('scope')
    expect(run.requirements.text).not.toContain('Hidden generated')
    expect(brief.reference_files).toHaveLength(1)
    const current = await f.store.read(f.body.project.id, 'preflight-owner')
    expect(current!.requirements).toEqual(run.requirements)
  } finally { await f.close() }
})


test.each(['Auto','Landscape','Portrait','Invalid'])('bootstrap preserves explicit %s direction and rejects unknown directions before project creation',async orientation=>{
  const f=await fixture()
  try {
    const response=await f.app.request('/api/projects/bootstrap',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({...f.body,brief:{...f.body.brief,settings:{...f.body.brief.settings,platform:'Web',engine:'React',dimension:'2D',orientation}}})})
    expect(response.status).toBe(orientation==='Invalid'?400:202)
    if(orientation==='Invalid'){await f.assertNoProject();return}
    const run=(await f.store.read(f.body.project.id,'preflight-owner'))!
    expect(run.requirements.constraints.orientation).toBe(orientation)
    expect(JSON.parse(run.requirements.text).settings.orientation).toBe(orientation)
    for(let i=0;i<100&&!f.prompts.length;i++)await Bun.sleep(5)
    expect(f.prompts[0]).toContain('BGS current production stage: design')
    if(orientation==='Auto')expect(f.contexts[0]).toContain('orientation Auto means adapting the same game to landscape and portrait containers')
    expect(run.requirements.text).not.toContain('minimum usable host dimensions')
    expect(run.requirements.text).not.toContain('rotation/size message')
  }finally{await f.close()}
})
