import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { BeeGameAuthUnavailableError } from '../auth/user-context'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'
import { createRun } from '../beegame/workflow-v3/state'

test('an issued preview remains readable when the identity upstream is unavailable; new access still requires auth', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-preview-auth-')))
  const projects = join(root, 'projects'), workspace = join(projects, 'users', 'owner', 'fixture')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
  let unavailable = false, identityCalls = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return new Response('fixture') } })
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({
    currentUserResolver: async request => {
      identityCalls++
      if (unavailable) throw new BeeGameAuthUnavailableError()
      return request.headers.get('authorization') === 'Bearer fixture' ? { id: 'owner', role: 'owner' } : undefined
    },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: projects,
    modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { async start() { throw new Error('No Agent may start') } },
    previewRunner: () => ({ kill() {} }), previewPortAllocator: async () => upstream.port!,
    previewReadinessProbe: async () => true,
  })
  const post = (path: string, body: unknown = {}) => app.request(path, { method: 'POST',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post('/api/projects', { id: 'fixture', name: 'Fixture', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    await post('/api/model-configs', { name: 'Fake', provider: 'openai-compatible', apiKey: 'fake', model: 'fake', isDefault: true })
    const ensured = await post('/api/projects/fixture/session/ensure')
    expect(ensured.status).toBe(200)
    const { session } = await ensured.json()
    const response = await post('/api/projects/fixture/preview')
    expect(response.status, await response.clone().text()).toBe(200)
    const preview = await response.json()
    const ungrantedPath = `/previews/${session.id}/src/main.ts`
    const spoofedHeaders: HeadersInit[] = [{ origin: 'null' }, { 'sec-fetch-dest': 'script', 'sec-fetch-mode': 'cors' }]
    for (const headers of spoofedHeaders) {
      expect((await app.request(ungrantedPath, { headers })).status).toBe(401)
    }
    const calls = identityCalls
    unavailable = true
    const html = await app.request(preview.url)
    expect(html.status).toBe(200)
    expect(await html.text()).toBe('fixture')
    const path = new URL(preview.url, 'http://studio').pathname
    const module = await app.request(path + 'src/main.ts', { headers: { origin: 'null', 'sec-fetch-dest': 'script', 'sec-fetch-mode': 'cors' } })
    expect(module.status).toBe(200)
    await module.text()
    expect(identityCalls).toBe(calls)
    expect((await app.request(ungrantedPath)).status).toBe(503)
    expect(identityCalls).toBe(calls + 1)
    unavailable = false
    expect((await app.request('/api/projects/fixture/preview', {
      method: 'DELETE', headers: { authorization: 'Bearer fixture' },
    })).status).toBe(200)
    expect((await app.request(path + 'src/main.ts', { headers: { origin: 'null' } })).status).toBe(404)
  } finally {
    for (const cleanup of cleanups) await cleanup()
    upstream.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})


test('Agent preview returns the authorized proxy path for opaque-origin resources and stops with its writer', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-preview-auth-')))
  const projects=join(root,'projects'),workspace=join(projects,'users/owner/fixture')
  await mkdir(workspace,{recursive:true})
  const source=JSON.stringify({scripts:{dev:'vite'}})
  await writeFile(join(workspace,'package.json'),source)
  const store=createLocalWorkflowStore(join(root,'workflow'))
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response('fixture')}})
  const cleanups:Array<()=>void|Promise<void>>=[]
  let previewUrl='',launches=0
  const app=createAgentWorkflowApp({
    currentUserResolver:request=>request.headers.get('authorization')==='Bearer fixture'?{id:'owner',role:'owner'}:undefined,
    dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:projects,
    modelConfigStore:false,skillsConfig:false,workflowV3Store:store,registerCleanup:cleanup=>cleanups.push(cleanup),
    sessionRunner:{async start(input){
      input.onNativeSessionId?.(crypto.randomUUID())
      return {stop(){},async submit(turn){
        const result=await turn.workflow!({action:'preview',operation:'start'},turn.signal) as {status:string;url:string}
        expect(result.status).toBe('running');previewUrl=result.url
        await new Promise<void>(resolve=>{
          if(turn.signal.aborted)resolve();else turn.signal.addEventListener('abort',()=>resolve(),{once:true})
        })
      }}
    }},
    previewRunner:()=>{launches++;return {kill(){}}},previewPortAllocator:async()=>upstream.port!,previewReadinessProbe:async()=>true,
  })
  const post=(path:string,body:unknown={})=>app.request(path,{method:'POST',headers:{authorization:'Bearer fixture',
    'content-type':'application/json'},body:JSON.stringify(body)})
  try {
    expect((await post('/api/projects',{id:'fixture',name:'Fixture',root_path:workspace,created_at:Date.now()})).status).toBe(200)
    await post('/api/model-configs',{name:'Fake',provider:'openai-compatible',apiKey:'fake',model:'fake',isDefault:true})
    const {session}=await (await post('/api/projects/fixture/session/ensure')).json()
    const started=await post('/api/projects/fixture/workflow-v3/agent/goal',{
      requestKey:'preview-check',chatSessionId:session.id,
      brief:{kind:'confirmed_build_brief',idea:'Inspect existing implementation',selected_option:{title:'Fixture',loop:'play'},
        settings:{engine:'React',platform:'Web',dimension:'2D',orientation:'Landscape'},resource_library_usage:'optional',
        document_language:'en',game_user_visible_language:'en',agent_response_language:'en'},
    })
    expect(started.status,await started.clone().text()).toBe(202)
    for(let i=0;i<500 && !previewUrl;i++)await Bun.sleep(5)
    expect(previewUrl).toStartWith('http://localhost/previews/')
    expect(launches).toBe(1)
    for(const asset of ['','src/main.ts','assets/atlas.png','assets/music.ogg']) {
      const response=await app.request(previewUrl+asset,{headers:{origin:'null'}})
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(await response.text()).toContain('fixture')
    }
    expect((await app.request(`/previews/${session.id}/src/main.ts`,{headers:{origin:'null'}})).status).toBe(401)
    expect((await post('/api/projects/fixture/workflow-v3/stop')).status).toBe(202)
    for(let i=0;i<500 && !(await store.read('fixture','owner'))?.agentTurns?.[0]?.finishedAt;i++)await Bun.sleep(5)
    expect((await store.read('fixture','owner'))?.agentTurns?.[0]?.status).toBe('interrupted')
    expect((await app.request(previewUrl+'src/main.ts',{headers:{origin:'null'}})).status).toBe(404)
    expect(await readFile(join(workspace,'package.json'),'utf8')).toBe(source)
  } finally {
    for(const cleanup of cleanups)await cleanup()
    upstream.stop(true);await rm(root,{recursive:true,force:true})
  }
})


for(const withCandidate of [false,true]) test(`stopping after entering V3 closes the old development preview and grants (candidate=${withCandidate})`,async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-preview-auth-')))
  const projects=join(root,'projects'),workspace=join(projects,'users/owner/fixture'),otherWorkspace=join(projects,'users/owner/other')
  const source=JSON.stringify({scripts:{dev:'vite'}})
  for(const path of [workspace,otherWorkspace]){
    await mkdir(path,{recursive:true});await writeFile(join(path,'package.json'),source)
  }
  const store=createLocalWorkflowStore(join(root,'workflow'))
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response('development')}})
  const cleanups:Array<()=>void|Promise<void>>=[]
  const kills:string[]=[]
  const app=createAgentWorkflowApp({
    currentUserResolver:request=>{
      const token=request.headers.get('authorization')
      return token==='Bearer owner'?{id:'owner',role:'owner'}:token==='Bearer viewer'?{id:'owner',role:'viewer'}:
        token==='Bearer other'?{id:'other',role:'owner'}:undefined
    },
    dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:projects,workflowV3Store:store,
    workflowV3PreviewOrigin:'http://localhost:12345',modelConfigStore:false,skillsConfig:false,
    registerCleanup:cleanup=>cleanups.push(cleanup),sessionRunner:{async start(){throw Error('No Agent may start')}},
    previewRunner:(_command,options)=>({kill(){kills.push(options.workspacePath)}}),
    previewPortAllocator:async()=>upstream.port!,previewReadinessProbe:async()=>true,
  })
  const request=(path:string,method='GET',body?:unknown,token='owner')=>app.request(path,{method,
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  try {
    for(const [id,path] of [['fixture',workspace],['other',otherWorkspace]]) {
      expect((await request('/api/projects','POST',{id,name:id,root_path:path,created_at:Date.now()})).status).toBe(200)
    }
    await request('/api/model-configs','POST',{name:'Fake',provider:'openai-compatible',apiKey:'fake',model:'fake',isDefault:true})
    const old=(await (await request('/api/projects/fixture/preview','POST',{})).json())
    const other=(await (await request('/api/projects/other/preview','POST',{})).json())
    expect(old.status).toBe('running');expect(other.status).toBe('running')
    const run=createRun({projectId:'fixture',ownerId:'owner',workspacePath:workspace,chatSessionId:'different-current-chat',
      requestKey:'saved-run',text:'Local fixture',constraints:{},ids:['goal']})
    run.paused={at:new Date().toISOString()}
    await store.commit('fixture','owner',0,run,'fixture.saved')
    const before=await store.read('fixture','owner')
    let candidateUrl=''
    if(withCandidate){
      await mkdir(join(workspace,'dist'));await writeFile(join(workspace,'dist/index.html'),'candidate')
      const opened=await request('/api/projects/fixture/preview','POST',{})
      expect(opened.status,await opened.clone().text()).toBe(200)
      candidateUrl=(await opened.json()).url
      expect((await app.request(candidateUrl)).status).toBe(200)
    }
    expect((await request('/api/projects/fixture/preview','DELETE',undefined,'viewer')).status).toBe(403)
    expect((await request('/api/projects/fixture/preview','DELETE',undefined,'other')).status).toBe(404)
    expect(kills).toEqual([])
    expect((await app.request(old.url)).status).toBe(200)
    const stopped=await request('/api/projects/fixture/preview','DELETE')
    expect(stopped.status,await stopped.clone().text()).toBe(200)
    expect(await stopped.json()).toMatchObject({status:'stopped',url:''})
    expect(kills).toEqual([workspace])
    expect((await app.request(old.url)).status).toBe(404)
    // Replaying either original bearer form must not grant the real session path.
    const oldUrl=new URL(old.url,'http://localhost')
    expect((await app.request(`/previews/${old.sessionId}/src/main.ts`+oldUrl.search)).status).toBe(401)
    if(candidateUrl)expect((await app.request(candidateUrl)).status).toBe(404)
    expect((await app.request(other.url)).status).toBe(200)
    expect((await request('/api/projects/fixture/preview','DELETE')).status).toBe(200)
    expect(kills).toEqual([workspace])
    expect(await store.read('fixture','owner')).toEqual(before)
    expect(await readFile(join(workspace,'package.json'),'utf8')).toBe(source)
  }finally{
    for(const cleanup of cleanups)await cleanup()
    upstream.stop(true);await rm(root,{recursive:true,force:true})
  }
})
