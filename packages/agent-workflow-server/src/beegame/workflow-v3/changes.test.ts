import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createRun, digest, pauseRun, type Run } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { createV3Executor } from './execution'
import { reserveSourceEdit, settleSourceEdit } from './changes'
import { prepareSourceEdit, writeSourceEdit } from './source-edit'
import { readContentView } from './content-view'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { createAgentWorkflowApp } from '../../app'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-change-'))), data = join(root,'.beegame/store')
  for (const dir of ['content/ui','content/scenes','src']) await mkdir(join(root,dir),{recursive:true})
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs'}}))
  await writeFile(join(root,'build.mjs'),"import {cp,mkdir} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
  await writeFile(join(root,'src/index.html'),'<html><body>Fixture<script>fetch("./content/ui/menu.json").then(r=>r.json()).then(d=>document.body.dataset.height=d.data.nodes[1].layout.size[1]);</script></body></html>')
  await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(uiLayoutFixture()))
  await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
  await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',documentRevision:'a'.repeat(64),
    assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json','scenes/level.json'],documents:[
      {path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},{path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
  await writeFile(join(root,'notes.json'),'{}')
  let run = createRun({projectId:'p',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Fixture requirements',constraints:{},ids:['req.play']})
  run.agentTurns=[]
  const store = createLocalWorkflowStore(data)
  await store.commit('p','owner',0,run,'run.created')
  let starts=0
  const sessions = new BeeGameSessionManager({async start(){starts++;throw Error('No provider permitted')}},data,async()=>({}),{},true)
  const executor = createV3Executor({store,sessions})
  return { root,store,sessions,executor,get starts(){return starts},get run(){return run},set run(value:Run){run=value},
    async current(){run=(await store.read('p','owner'))!;return run},
    async dispose(){await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})} }
}
function workflow(run:Run){return {version:run.version,planRevision:run.planRevision,requirementsRevision:run.requirements.revision}}
async function editValue(f:Awaited<ReturnType<typeof fixture>>,path='ui/menu.json') {
  const full=await readContentView(f.root)
  if(full.state!=='draft')throw Error('Source fixture missing')
  const entry=full.documents.find(d=>d.path===path)!
  if(!('document' in entry) || !entry.document)throw Error('Full source expected')
  const document=structuredClone(entry.document)
  if(document.kind==='scene-2d') (document.data as any).nodes[1].transform.position[0]=30
  else (document.data as any).nodes[1].layout.size[1]=64
  return {path,expectedRevision:entry.revision,document,workflow:workflow(f.run)}
}
function changeValue(run:Run,text='New confirmed fixture goal') {return {expectedVersion:run.version,requirementsRevision:run.requirements.revision,
  requestKey:crypto.randomUUID(),requirements:{text,constraints:run.requirements.constraints,ids:run.requirements.ids}} }

test('autonomous UI/Scene saves retain exact originals, preserve native history, deduplicate and never create Tasks or dispatch a model',async()=>{
  const f=await fixture()
  try {
    const initial=structuredClone(f.run),original=await readFile(join(f.root,'content/ui/menu.json'))
    const body={...await editValue(f),requestKey:'ui-save'}
    await expect(f.executor.edit(f.run,{...body,requestKey:undefined})).rejects.toThrow('requestKey')
    const noop=await f.executor.edit(f.run,{...body,document:JSON.parse(original.toString())})
    expect(noop).toMatchObject({unchanged:true});expect((await f.current()).version).toBe(initial.version)
    const saved=await f.executor.edit(f.run,body);await f.current()
    const record=f.run.sourceEdits![0]!
    expect(saved.sourceEditId).toBe(record.attemptId);expect(record.sourceEdit.status).toBe('saved')
    expect(record.quiescedAt).toBeDefined();expect(f.run.writer).toBeUndefined()
    expect(await readFile(join(f.root,record.sourceEdit.archive))).toEqual(original)
    expect(f.run.agentTurns).toEqual(initial.agentTurns);expect(f.run.requirements).toEqual(initial.requirements)
    expect(f.run.planRevision).toBe(0);expect(['plans','tasks','attempts'].some(key=>key in f.run)).toBe(false)
    const version=f.run.version
    expect(await f.executor.edit(f.run,body)).toMatchObject({replayed:true})
    expect((await f.current()).version).toBe(version);expect(f.run.sourceEdits).toHaveLength(1)
    await expect(f.executor.edit(f.run,{...body,document:JSON.parse(original.toString())})).rejects.toThrow('different request')
    await expect(f.executor.edit(f.run,{...body,requestKey:'new-but-stale'})).rejects.toThrow('Run/requirements changed')
    await f.executor.edit(f.run,{...await editValue(f,'scenes/level.json'),requestKey:'scene-save'});await f.current()
    expect(f.run.sourceEdits).toHaveLength(2);expect(f.run.sourceEdits![0]).toEqual(record)
    await expect(f.executor.edit(f.run,body)).rejects.toThrow('historical/failed')
    const changed=structuredClone(f.run);changed.version++;changed.sourceEdits![0]!.sourceEdit.before='0'.repeat(64)
    await expect(f.store.commit('p','owner',f.run.version,changed,'forged')).rejects.toThrow('cannot be rewritten')
    expect(await readFile(join(f.root,'notes.json'),'utf8')).toBe('{}');expect(f.starts).toBe(0)
  } finally {await f.dispose()}
})

test('autonomous editor has a single CAS writer, refuses stale/paused scope, and recovers only a drained save after settlement failure',async()=>{
  const f=await fixture()
  let failSettlement=true
  const executor=createV3Executor({sessions:f.sessions,store:{read:f.store.read,async commit(...args){
    if(args[4]==='source-edit.settled' && failSettlement)throw Error('Synthetic storage outage')
    await f.store.commit(...args)
  }}})
  try {
    const a={...await editValue(f),requestKey:'a'},b={...await editValue(f,'scenes/level.json'),requestKey:'b'}
    const results=await Promise.allSettled([executor.edit(f.run,a),executor.edit(f.run,b)])
    expect(results.every(r=>r.status==='rejected')).toBe(true)
    await f.current();expect(f.run.sourceEdits).toHaveLength(1);expect(f.run.writer).toBeDefined()
    expect(f.run.sourceEdits![0]!.quiescedAt).toBeDefined();expect(executor.writerLiveness(f.run)).toBe('unknown')
    const identity={expectedVersion:f.run.version,attemptId:f.run.writer!.attemptId,fence:f.run.writer!.fence}
    failSettlement=false
    f.run=await executor.recover(f.run,identity)
    expect(f.run.paused).toBeDefined()
    expect(f.run.sourceEdits![0]!.sourceEdit.status).toBe('failed');expect(f.run.writer).toBeUndefined()
    expect(f.run.blockedReason).toContain('Source edit failed:')
    expect(f.run.blockedReason).not.toContain('Saved candidates are unmeasured')
    await expect(executor.edit(f.run,f.run.sourceEdits![0]!.requestKey==='a'?a:b)).rejects.toThrow('resume')
    f.run=await executor.resume(f.run)
    await expect(executor.edit(f.run,f.run.sourceEdits![0]!.requestKey==='a'?a:b)).rejects.toThrow('historical/failed')
    f.run=await executor.stop(f.run)
    await expect(executor.edit(f.run,{...await editValue(f),requestKey:'paused'})).rejects.toThrow('resume')
    expect(f.starts).toBe(0)
  }finally{await executor.dispose();await f.dispose()}
})

test('an unresolved autonomous save cannot be released using a missing session or fabricated quiescence',async()=>{
  const f=await fixture()
  try {
    const edit=await prepareSourceEdit(f.run,{...await editValue(f),requestKey:'lost'})
    const reserved=reserveSourceEdit(f.run,{path:edit.path,before:edit.beforeHash,after:edit.afterHash,workerId:'lost',requestKey:'lost',requestHash:'synthetic'})
    await f.store.commit('p','owner',f.run.version,reserved,'source-edit.reserved');f.run=reserved
    await expect(f.executor.recover(f.run,{expectedVersion:f.run.version,attemptId:f.run.writer!.attemptId,fence:f.run.writer!.fence})).rejects.toThrow('quiescence')
    const forged=structuredClone(f.run);forged.version++;forged.sourceEdits![0]!.quiescedAt=new Date().toISOString();delete forged.writer
    await expect(f.store.commit('p','owner',f.run.version,forged,'forged')).rejects.toThrow('retain its reserved writer')
    expect(digest(await readFile(join(f.root,edit.path)))).toBe(edit.beforeHash)
  }finally{await f.dispose()}
})
test('original host observes a completed save despite failed exit persistence; explicit recovery cannot rewrite sources or be inferred by a new host',async()=>{
  const f=await fixture()
  let outage=true
  const store={read:f.store.read,async commit(...args:Parameters<typeof f.store.commit>){
    if(args[4]==='writer.quiesced' && outage)throw Error('Synthetic exit write outage')
    await f.store.commit(...args)
  }}
  const executor=createV3Executor({sessions:f.sessions,store}),other=createV3Executor({sessions:f.sessions,store:f.store})
  try {
    const body={...await editValue(f),requestKey:'exit-outage'},scene=await readFile(join(f.root,'content/scenes/level.json'))
    await expect(executor.edit(f.run,body)).rejects.toThrow('exit write outage');await f.current()
    expect(f.run.sourceEdits![0]!.quiescedAt).toBeUndefined()
    expect(await executor.recoveryEvidence(f.run)).toBe('original-host');expect(await other.recoveryEvidence(f.run)).toBe('unavailable')
    const saved=await readFile(join(f.root,'content/ui/menu.json'))
    const identity={expectedVersion:f.run.version,attemptId:f.run.writer!.attemptId,fence:f.run.writer!.fence}
    await expect(other.recover(f.run,identity)).rejects.toThrow('quiescence')
    outage=false;f.run=await executor.recover(f.run,identity)
    expect(f.run.writer).toBeUndefined();expect(f.run.sourceEdits![0]!.sourceEdit.status).toBe('failed')
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(saved)
    expect(await readFile(join(f.root,'content/scenes/level.json'))).toEqual(scene);expect(f.starts).toBe(0)
    expect(await executor.recoveryEvidence(f.run)).toBe('unavailable')
  }finally{await executor.dispose();await other.dispose();await f.dispose()}
})

test('autonomous save API enforces owner permission, routes pause/recovery to host saves and never invokes native tools',async()=>{
  const f=await fixture(),app=new Hono(),cleanups:Array<()=>Promise<void>>=[]
  let role:'owner'|'viewer'='owner',owned=true,failSettlement=false
  const store={read:f.store.read,async commit(...args:Parameters<typeof f.store.commit>){
    if(args[4]==='source-edit.settled' && failSettlement)throw Error('Synthetic API settlement outage')
    await f.store.commit(...args)
  }}
  const routes=registerV3Routes(app,{store,sessions:f.sessions,getUser:()=>({id:'owner',role}),
    getProject:async()=>owned?{id:'p',root_path:f.root} as any:undefined,getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,
    assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json(),registerCleanup:fn=>cleanups.push(fn)})
  app.get('/view',async c=>{try{return c.json(await routes.contentView(c.req.raw,'p',false))}catch(e:any){return c.json({code:e.code},e.status??500)}})
  app.put('/save',async c=>{try{return c.json(await routes.saveContent(c.req.raw,'p',await c.req.json()))}catch(e:any){return c.json({code:e.code},e.status??500)}})
  const call=(path:string,body:unknown,method='POST')=>app.request(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  try {
    const body={...await editValue(f),requestKey:'api-save'}
    expect((await (await app.request('/view')).json()).editing.planRevision).toBe(0)
    role='viewer';expect((await call('/save',body,'PUT')).status).toBe(403)
    expect((await (await app.request('/view')).json()).readOnly).toBe(true)
    role='owner';owned=false;expect((await call('/save',body,'PUT')).status).toBe(404);owned=true
    failSettlement=true;expect((await call('/save',body,'PUT')).status).toBe(500)
    await f.current();expect(f.run.sourceEdits![0]!.quiescedAt).toBeDefined()
    const view=await (await app.request('/api/projects/p/workflow-v3')).json();expect(view.writerLiveness).toBe('unknown')
    const identity={expectedVersion:f.run.version,attemptId:f.run.writer!.attemptId,fence:f.run.writer!.fence}
    failSettlement=false
    const recovered=await call('/api/projects/p/workflow-v3/recover-writer',identity)
    expect(recovered.status,await recovered.clone().text()).toBe(200)
    expect((await recovered.json()).dispatched).toBe(false);await f.current()
    expect(f.run.sourceEdits![0]!.sourceEdit.status).toBe('failed');expect(f.run.agentTurns).toEqual([])
    expect((await call('/api/projects/p/workflow-v3/stop',{})).status).toBe(202)
    expect((await (await app.request('/view')).json()).readOnly).toBe(true)
    expect((await call('/api/projects/p/workflow-v3/resume',{planRevision:0})).status).toBe(200)
    await f.current()
    const saved=await call('/save',{...await editValue(f,'scenes/level.json'),requestKey:'new-scene'},'PUT')
    expect(saved.status,await saved.clone().text()).toBe(200);expect(f.starts).toBe(0)
  }finally{await Promise.all(cleanups.map(f=>f()));await f.dispose()}
})

test('pause during source-save reservation prevents later replacement; archive aliases cannot create outside descendants',async()=>{
  const f=await fixture()
  const executor=createV3Executor({sessions:f.sessions,store:{read:f.store.read,async commit(...args){
    await f.store.commit(...args)
    if(args[4]==='source-edit.reserved') {
      const current=(await f.store.read('p','owner'))!,paused=pauseRun(current)
      await f.store.commit('p','owner',current.version,paused,'run.paused')
    }
  }}})
  try {
    const before=await readFile(join(f.root,'content/ui/menu.json'))
    await expect(executor.edit(f.run,{...await editValue(f),requestKey:'pause-race'})).rejects.toThrow('cancelled')
    await f.current();expect(f.run.paused).toBeDefined();expect(f.run.writer).toBeUndefined()
    expect(f.run.sourceEdits![0]!.sourceEdit.status).toBe('failed')
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(before)
    f.run=await f.executor.resume(f.run)
    const outside=join(f.root,'synthetic-outside-archive');await mkdir(outside)
    await symlink(outside,join(f.root,'.beegame/workflow-v3-edits'))
    await expect(f.executor.edit(f.run,{...await editValue(f),requestKey:'alias'})).rejects.toThrow('alias')
    const files=await import('node:fs/promises').then(fs=>fs.readdir(outside));expect(files).toEqual([])
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(before);expect(f.starts).toBe(0)
  }finally{await executor.dispose();await f.dispose()}
})

test('actual app routes expose authorized editor saves while retired requirements route stays closed',async()=>{
  const f=await fixture(),data=join(f.root,'.beegame/dashboard'),user:{id:string;role:'owner'|'viewer'}={id:'owner',role:'owner'},cleanups:Array<()=>Promise<void>|void>=[]
  const app=createAgentWorkflowApp({defaultWorkspacePath:f.root,dashboardDataRoot:data,currentUser:user,
    sessionRunner:{async start(){throw Error('No native provider permitted')}},workflowV3Store:f.store,registerCleanup:fn=>cleanups.push(fn)})
  const json=(value:unknown)=>({headers:{'content-type':'application/json'},body:JSON.stringify(value)})
  try {
    // Register a synthetic owned project through the normal metadata route.
    const created=await app.request('/api/projects',{method:'POST',...json({id:'p',name:'Synthetic',root_path:f.root,created_at:Date.now()})})
    expect(created.status).toBe(200)
    const view=await app.request('/api/projects/p/game-content');expect(view.status).toBe(200)
    const snapshot=await view.json();expect(snapshot.readOnly).toBe(false);expect(snapshot.editing.paths).toContain('ui/menu.json')
    const value=await editValue(f),saved=await app.request('/api/projects/p/game-content/document',{method:'PUT',...json({...value,requestKey:'formal-ui-save'})})
    expect(saved.status).toBe(200);expect((await saved.json()).unmeasured).toBe(true);await f.current()
    expect((await app.request('/api/projects/p/game-content/publish',{method:'POST',...json({contentRevision:'a'.repeat(64)})})).status).toBe(409)
    user.role='viewer';expect((await (await app.request('/api/projects/p/game-content')).json()).readOnly).toBe(true)
    expect((await app.request('/api/projects/p/game-content/document',{method:'PUT',...json(await editValue(f))})).status).toBe(403)
    expect((await app.request('/api/projects/p/workflow-v3/requirements',{method:'POST',...json(changeValue(f.run))})).status).toBe(404)
    user.role='owner'
    expect((await app.request('/api/projects/p/workflow-v3/requirements',{method:'POST',...json(changeValue(f.run))})).status).toBe(404)
    expect(f.starts).toBe(0)
  }finally{for(const cleanup of cleanups.reverse())await cleanup();await f.dispose()}
})
