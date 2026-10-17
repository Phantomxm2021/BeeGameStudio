import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp, type AgentWorkflowAppOptions } from '../app'
import { createRun } from '../beegame/workflow-v3/state'
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
    expect((await f.request('/api/projects/fixture/preview/restart','POST',{})).status).toBe(200)
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
