import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp, type AgentWorkflowAppOptions } from '../app'
import { createRun, type Run } from '../beegame/workflow-v3/state'
import { assertCommit } from '../beegame/workflow-v3/store'
import { projectPreviewCapabilityPath } from '../beegame/project-preview-capability'
import { sharedPlaywright } from '../beegame/shared-playwright'

async function fixture(options: Partial<AgentWorkflowAppOptions> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-project-preview-v3-')))
  const projects = join(root, 'projects'), workspace = join(projects, 'users/owner/fixture')
  await mkdir(workspace, { recursive: true })
  const run = createRun({projectId:'fixture',ownerId:'owner',workspacePath:workspace,chatSessionId:'persisted-chat',
    requestKey:'create',text:'Synthetic preview',constraints:{},ids:['goal']})
  run.paused = { at: new Date().toISOString() }
  const before = structuredClone(run), cleanups: Array<() => void | Promise<void>> = []
  let models = 0, commits = 0, processes = 0
  const app = createAgentWorkflowApp({
    dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:projects,workflowV3PreviewOrigin:'http://localhost:12345',
    workflowV3Store:{async read(id, owner) { return id==='fixture'&&owner==='owner'?run:undefined },async commit(){commits++;throw Error('Preview cannot mutate the Run')}},
    currentUserResolver:request => request.headers.get('authorization')==='Bearer owner'?{id:'owner',role:'owner'}:
      request.headers.get('authorization')==='Bearer viewer'?{id:'owner',role:'viewer'}:
      request.headers.get('authorization')==='Bearer other'?{id:'other',role:'owner'}:undefined,
    modelConfigStore:false,skillsConfig:false,invitationService:false,
    sessionRunner:{async start(){models++;throw Error('Preview cannot start an Agent')}},
    previewRunner:()=>{processes++;throw Error('Static Preview cannot start a project process')},
    registerCleanup:cleanup=>cleanups.push(cleanup),...options,
  })
  const request = (path:string, method='GET', body?:unknown, token='owner') => app.request(path,{method,
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const created=await request('/api/projects','POST',{id:'fixture',name:'Synthetic',root_path:workspace,created_at:Date.now()})
  expect(created.status,await created.clone().text()).toBe(200)
  return {root,workspace,run,before,app,request,counts:()=>({models,commits,processes}),async close(){for(const cleanup of cleanups)await cleanup();await rm(root,{recursive:true,force:true})}}
}

test('actual Agent production Preview API serves the isolated existing build without starting a project process',async()=>{
  let current:Run|undefined,starts=0,previewUrl='',observedError:unknown
  let f:Awaited<ReturnType<typeof fixture>>|undefined
  try {
    f=await fixture({workflowV3Store:{async read(){return current?structuredClone(current):undefined},
      async commit(project,owner,version,next){
        expect(current?.version??0).toBe(version)
        assertCommit(project,owner,version,next,current);current=structuredClone(next)
      }},sessionRunner:{async start(start){
        starts++;const nativeId=crypto.randomUUID();start.onNativeSessionId?.(nativeId)
        return {async submit(input){
          try {
            const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(start.cwd,start.sessionId),'utf8'))
            const response=await fetch(capability.apiUrl+'/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'production'})})
            const result=await response.json()
            expect(response.status,JSON.stringify(result)).toBe(200)
            previewUrl=result.preview.url
            expect(result.preview.mode).toBe('production')
            const asset=await f!.app.request(new URL('/assets/main.js',previewUrl))
            expect(asset.status).toBe(200);expect(await asset.text()).toBe('/* existing build */')
            expect(asset.headers.get('Access-Control-Allow-Origin')).toBe('*')
            expect((await f!.app.request(new URL('/api/projects',previewUrl))).status).toBe(404)
          }catch(error){observedError=error;throw error}
          await input.onMessage({type:'result',subtype:'success',session_id:nativeId,total_cost_usd:0,result:'Synthetic Preview only, not acceptance'} as any)
        },stop(){}}
      }}})
    await mkdir(join(f.workspace,'dist/assets'),{recursive:true})
    await writeFile(join(f.workspace,'dist/index.html'),'<!doctype html><script src="/assets/main.js"></script>')
    await writeFile(join(f.workspace,'dist/assets/main.js'),'/* existing build */')
    await writeFile(join(f.workspace,'package.json'),JSON.stringify({scripts:{build:'touch MUST_NOT_BUILD'}}))
    const session=await f.request('/api/projects/fixture/session/ensure','POST',{})
    expect(session.status,await session.clone().text()).toBe(200)
    const chatSessionId=(await session.json()).session.id
    const accepted=await f.request('/api/projects/fixture/workflow-v3/agent/goal','POST',{requestKey:'preview-only',chatSessionId,
      brief:{kind:'confirmed_build_brief',idea:'Synthetic Preview fixture',selected_option:{title:'Fixture',loop:'play'},
        settings:{engine:'React',platform:'Web',dimension:'2D',orientation:'Landscape'},resource_library_usage:'optional',
        document_language:'en',game_user_visible_language:'en',agent_response_language:'en'}})
    expect(accepted.status,await accepted.clone().text()).toBe(202)
    for(let i=0;i<500&&!current?.agentTurns?.[0]?.finishedAt;i++)await Bun.sleep(10)
    expect(observedError).toBeUndefined()
    expect(previewUrl).not.toBe('');expect(starts).toBe(1)
    expect(current?.agentTurns?.[0]?.finishedAt).toBeDefined();expect(current?.writer).toBeUndefined()
    expect(f.counts().processes).toBe(0)
    expect(await Bun.file(join(f.workspace,'MUST_NOT_BUILD')).exists()).toBe(false)
    expect((await f.app.request(previewUrl)).status).toBe(404)
  }finally{await f?.close()}
},30000)

test('ordinary V3 Preview opens an existing build with no native session, valid content index or Measure; delivery still requires evidence', async () => {
  const f=await fixture()
  try {
    const bytes='<!doctype html><title>Candidate</title>'
    await mkdir(join(f.workspace,'dist'));await writeFile(join(f.workspace,'dist/index.html'),bytes)
    await mkdir(join(f.workspace,'content'));await writeFile(join(f.workspace,'content/index.json'),'{invalid')
    const response=await f.request('/api/projects/fixture/preview','POST',{})
    expect(response.status,await response.clone().text()).toBe(200)
    const preview=await response.json()
    expect(preview).toMatchObject({status:'running',mode:'production',sessionId:'persisted-chat'})
    expect(preview.message).toContain('not measured delivery')
    const runtime=await f.request('/api/projects/fixture/runtime-state')
    expect(runtime.status).toBe(200)
    expect((await runtime.json()).build_report).toMatchObject({
      status:'passed',build_url:preview.url,agents:['candidate-preview'],
      summary:expect.stringContaining('not measured delivery'),
      checks:[{name:'existing-static-build',status:'passed'}],
    })
    const frame=await f.app.request(preview.url)
    expect(frame.status).toBe(200);expect(await frame.text()).toBe(bytes)
    expect(frame.headers.get('X-BeeGame-Preview-Mode')).toBe('candidate-static')
    expect(frame.headers.get('X-BeeGame-Preview-Storage')).toBe('project-v1')
    const saves=new URL('/__bgs/preview-storage',preview.url)
    expect((await f.app.request(saves,{method:'POST',headers:{origin:'null','content-type':'application/json'},
      body:JSON.stringify({key:'best',value:'44'})})).status).toBe(200)
    expect((await f.app.request(new URL('/api/projects',preview.url))).status).toBe(404)
    expect((await f.app.request(preview.url,{method:'POST'})).status).toBe(405)
    expect((await f.request('/api/projects/fixture/preview','POST',{},'other')).status).toBe(404)
    for(const method of ['POST','DELETE'])expect((await f.request('/api/projects/fixture/preview',method,method==='POST'?{}:undefined,'viewer')).status).toBe(403)
    await writeFile(join(f.workspace,'README.md'),'Changed report, not a Preview freshness gate')
    const again=await f.request('/api/projects/fixture/preview','POST',{})
    expect(again.status).toBe(200);expect((await again.json()).url).toBe(preview.url)
    expect(await (await f.request('/api/projects/fixture/deployment-readiness')).json()).toMatchObject({allowed:false,code:'deployment-unverified'})
    const exported=await f.request('/api/projects/fixture/workflow-v3/export','POST',{
      measurementId:crypto.randomUUID(),requirementsRevision:f.run.requirements.revision,kind:'project'})
    expect(exported.status).toBe(409);expect((await exported.json()).code).toBe('preview-unverified')
    const restarted=await f.request('/api/projects/fixture/preview/restart','POST',{})
    expect(restarted.status).toBe(200)
    const reopenedUrl=(await restarted.json()).url
    expect(await (await f.app.request(new URL('/__bgs/preview-storage?key=best',reopenedUrl))).json()).toEqual({value:'44'})
    expect(await Bun.file(join(f.workspace,'preview-saves/saves.sqlite')).exists()).toBe(false)
    expect((await f.request('/api/projects/fixture/preview','DELETE')).status).toBe(200)
    expect((await (await f.request('/api/projects/fixture/runtime-state')).json()).build_report).toBeNull()
    expect((await f.app.request(preview.url)).status).toBe(404)
    expect(f.run).toEqual(f.before);expect(f.counts()).toEqual({models:0,commits:0,processes:0})
    expect(await readFile(join(f.workspace,'dist/index.html'),'utf8')).toBe(bytes)
  }finally{await f.close()}
})

test('missing builds explain the normal build requirement; unsafe build links never expose another project', async () => {
  const f=await fixture()
  try {
    const missing=await f.request('/api/projects/fixture/preview','POST',{})
    expect(missing.status).toBe(409)
    expect(await missing.json()).toMatchObject({code:'preview-build-missing',error:expect.stringContaining('Measure is not required')})
    const outside=join(f.root,'other-project')
    await mkdir(outside);await writeFile(join(outside,'index.html'),'private other-project data')
    await symlink(outside,join(f.workspace,'dist'))
    const unsafe=await f.request('/api/projects/fixture/preview','POST',{})
    expect(unsafe.status).toBe(409);expect((await unsafe.json()).code).toBe('preview-build-invalid')
    expect(f.run).toEqual(f.before);expect(f.counts()).toEqual({models:0,commits:0,processes:0})
  }finally{await f.close()}
})

test('ordinary Preview is interactive in an opaque browser frame; changed build bytes need only reopening, never Measure', async () => {
  let f:Awaited<ReturnType<typeof fixture>>|undefined,previewUrl='',browser:any
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>new URL(request.url).pathname==='/host'
    ?new Response('<!doctype html><iframe sandbox="allow-scripts" src="'+previewUrl+'"></iframe>',{headers:{'content-type':'text/html'}})
    :f!.app.fetch(request)})
  try {
    f=await fixture({workflowV3PreviewOrigin:'http://localhost:'+server.port})
    await mkdir(join(f.workspace,'dist'))
    const html=(label:string)=>'<!doctype html><h1>'+label+'</h1><button id="play">Play</button><output id="count">0</output><script>let n=0;document.querySelector("#play").onclick=()=>document.querySelector("#count").textContent=++n</script>'
    await writeFile(join(f.workspace,'dist/index.html'),html('First build'))
    previewUrl=(await (await f.request('/api/projects/fixture/preview','POST',{})).json()).url
    const {chromium}=await import(sharedPlaywright().moduleUrl)
    browser=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()})
    const page=await browser.newPage();await page.goto('http://localhost:'+server.port+'/host')
    const frame=page.frameLocator('iframe')
    await frame.locator('#play').click();expect(await frame.locator('#count').innerText()).toBe('1')
    expect(await frame.locator('body').evaluate(()=>{try{return Boolean(window.parent.document.body)}catch{return false}})).toBe(false)
    const oldUrl=previewUrl
    await writeFile(join(f.workspace,'dist/index.html'),html('Changed build, no Measure'))
    expect((await f.app.request(oldUrl)).status).toBe(409)
    const opened=await f.request('/api/projects/fixture/preview','POST',{})
    expect(opened.status).toBe(200);previewUrl=(await opened.json()).url
    await page.reload();expect(await frame.locator('h1').innerText()).toBe('Changed build, no Measure')
    expect(f.run).toEqual(f.before);expect(f.counts()).toEqual({models:0,commits:0,processes:0})
    await f.request('/api/projects/fixture/preview','DELETE')
    expect((await f.app.request(previewUrl)).status).toBe(404)
  }finally{await browser?.close();server.stop(true);await f?.close()}
},30000)
