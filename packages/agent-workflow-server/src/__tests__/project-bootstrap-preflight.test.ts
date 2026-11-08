import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentWorkflowApp, type AgentWorkflowAppOptions } from '../app'
import type { BeeGameSessionRunnerStartInput, BeeGameSessionSubmitInput } from '../beegame/session-manager'
import { projectPreviewCapabilityPath } from '../beegame/project-preview-capability'
import { ImageAttemptStore } from '../image-generation/attempt'
import { DashboardRepository } from '../dashboard-repository'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'

async function fixture(options: {modelRuntimeHost?:AgentWorkflowAppOptions['modelRuntimeHost'];outboundTargetResolver?:AgentWorkflowAppOptions['outboundTargetResolver'];onSubmit?:(start:BeeGameSessionRunnerStartInput,turn:BeeGameSessionSubmitInput)=>Promise<void>} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bgs-bootstrap-preflight-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let runnerStarts = 0
  const contexts:string[]=[],prompts:string[]=[]
  const store = createLocalWorkflowStore(join(root, 'workflow'))
  const app = createAgentWorkflowApp({
    currentUser: { id: 'preflight-owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    workflowV3Store: store, modelConfigStore: false, skillsConfig: false, modelRuntimeHost:options.modelRuntimeHost, outboundTargetResolver:options.outboundTargetResolver,
    sessionRunner: { async start(input) {
      runnerStarts++
      contexts.push(input.systemContext ?? '')
      input.onNativeSessionId?.('11111111-2222-4333-8444-555555555555')
      return { stop() {}, async submit(turn) {
        prompts.push(typeof turn.prompt==='string'?turn.prompt:JSON.stringify(turn.prompt))
        await options.onSubmit?.(input,turn)
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
    expect(brief.default_first_release_scope.target).toBe('a small-scope game with a complete core experience')
    expect(brief.default_first_release_scope.content).toContain('integrated visual and sensory feedback appropriate to the game')
    expect(brief.default_first_release_scope.content).toContain('explicit user requirements remain in scope')
    expect(brief.default_first_release_scope.defer).toBe('unrequested content expansion and nonessential product features')
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


test('GDD reference images use plain JSON prompt checks with strict results through the real app entry', async () => {
  const previousKey=process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=Buffer.alloc(32,84).toString('base64')
  const calls:Parameters<NonNullable<AgentWorkflowAppOptions['modelRuntimeHost']>['generate']>[0][]=[], responses:Array<{status:number;body?:any}>=[]
  const results=['{"issues":[]}','{"issues":["The requested subject conflicts with the stated constraint."]}','{"issues":"invalid"}']
  const images=spyOn(ImageAttemptStore.prototype,'generate').mockResolvedValue({
    bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=','base64'),
    model:'fixture-image',mimeType:'image/png',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
  })
  const runtimeEnv=spyOn(DashboardRepository.prototype,'getRuntimeEnv').mockImplementation(async root=>{
    if(typeof root!=='string')throw Error('Fixture expected an owner-scoped runtime root')
    return {BEEGAME_CONFIG_DIR:root,BEEGAME_MODEL_TYPE:'openai',BEEGAME_API_PROTOCOL:'responses',BEEGAME_MODEL:'fixture',
      OPENAI_API_KEY:'fixture-model-key',BEEGAME_MODEL_BILLING_SOURCE:'byok'}
  })
  let resolveDone!:()=>void, callbackError:unknown
  const done=new Promise<void>(resolve=>{resolveDone=resolve})
  const f=await fixture({outboundTargetResolver:async value=>({url:new URL(value),addresses:['93.184.216.34'],lookup:(_host,_options,callback)=>callback(null,'93.184.216.34',4)}),modelRuntimeHost:{generate:async input=>{calls.push(input);return results[calls.length-1]!}},
    onSubmit:async(start)=>{
      try {
        const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(start.cwd,start.sessionId),'utf8'))
        for(let index=0;index<results.length;index++){
          const response=await fetch(capability.assets.imageEndpoint,{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({requestId:'reference-'+index,purpose:'reference',prompt:'An open game composition question'})})
          if(response.ok){await response.arrayBuffer();responses.push({status:response.status})}
          else responses.push({status:response.status,body:await response.json()})
        }
      }catch(error){callbackError=error}finally{resolveDone()}
    }})
  try {
    const connection=await f.app.request('/api/image-generation/connection',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({source:'byok',provider:'openai',model:'fixture-image',apiKey:'fixture-image-key'})})
    expect(connection.status,await connection.clone().text()).toBe(200)
    const started=await f.app.request('/api/projects/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.body)})
    expect(started.status,await started.clone().text()).toBe(202)
    await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Reference callback did not finish')),5000))])
    if(callbackError)throw callbackError
    expect(responses.map(value=>value.status),JSON.stringify({responses,modelCalls:calls.length})).toEqual([200,422,503])
    expect(responses[1]!.body).toMatchObject({code:'image-prompt-conflict'})
    expect(responses[2]!.body).toMatchObject({code:'prompt-review-unavailable',failureCode:'invalid-review-schema'})
    expect(images).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(3)
    for(const call of calls){
      expect(call).not.toHaveProperty('structuredOutput')
      expect(call.querySource).toBe('beegame_image_prompt_review')
      expect(call.systemPrompt).toContain('single field "issues"')
      expect(JSON.parse(call.messages[0]!.content as string)).toMatchObject({design:[],prompt:'An open game composition question'})
    }
  }finally{
    await f.close();images.mockRestore();runtimeEnv.mockRestore()
    if(previousKey===undefined)delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY;else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=previousKey
  }
},15000)
