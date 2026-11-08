import { test, expect, spyOn } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRun, digest, type Run } from './state'
import { createLocalWorkflowStore } from './store'
import { createV3Executor } from './execution'
import { readContentView } from './content-view'
import { BeeGameSessionManager } from '../session-manager'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { createAgentWorkflowApp } from '../../app'

async function fixture(constraints:Record<string,unknown>={}, creation?:Run['creation']) {
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
  let run = createRun({projectId:'p',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Fixture requirements',constraints,ids:['req.play']})
  run.creation=creation
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
// Seed retained history, not a new editor operation. The production writer is retired.
async function historicalSourceEdit(f:Awaited<ReturnType<typeof fixture>>,requestKey:string):Promise<Run> {
  const body=await editValue(f),path='content/'+body.path
  const before=digest(await readFile(join(f.root,path))),after=digest(JSON.stringify(body.document))
  const run=structuredClone(f.run),attemptId='historical-'+requestKey
  run.version++;run.fence++;run.status='running'
  run.writer={attemptId,fence:run.fence,workerId:'old-host'}
  run.sourceEdits=[{...run.writer,requestKey,requestHash:after,sessionId:'host-edit:'+attemptId,
    requirementsRevision:run.requirements.revision,status:'running',startedAt:new Date().toISOString(),
    sourceEdit:{path,before,after,archive:'.beegame/workflow-v3-edits/'+attemptId+'/before.json',status:'reserved'}}]
  return run
}

test('an unresolved autonomous save cannot be released using a missing session or fabricated quiescence',async()=>{
  const f=await fixture()
  try {
    const reserved=await historicalSourceEdit(f,'lost')
    await f.store.commit('p','owner',f.run.version,reserved,'source-edit.reserved');f.run=reserved
    await expect(f.executor.recover(f.run,{expectedVersion:f.run.version,attemptId:f.run.writer!.attemptId,fence:f.run.writer!.fence})).rejects.toThrow('quiescence')
    const forged=structuredClone(f.run);forged.version++;forged.sourceEdits![0]!.quiescedAt=new Date().toISOString();delete forged.writer
    await expect(f.store.commit('p','owner',f.run.version,forged,'forged')).rejects.toThrow('retain its reserved writer')
    const edit=reserved.sourceEdits![0]!.sourceEdit
    expect(digest(await readFile(join(f.root,edit.path)))).toBe(edit.before)
  }finally{await f.dispose()}
})
test('retired executor rejects new saves without reserving or mutating the project',async()=>{
  const f=await fixture({platform:'PC',engine:'Godot'})
  try {
    const before=await readFile(join(f.root,'content/ui/menu.json')),run=JSON.stringify(f.run)
    await expect(f.executor.edit(f.run,{...await editValue(f),requestKey:'retired'})).rejects.toMatchObject({code:'editor-unavailable'})
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(before)
    expect(JSON.stringify(await f.current())).toBe(run)
    expect(f.starts).toBe(0)
  }finally{await f.dispose()}
})

test('an exited historical writer recovers without accepting or rewriting its candidates',async()=>{
  const f=await fixture()
  const receipts={async save(){},async read(){return {quiescedAt:new Date().toISOString()}}}
  const executor=createV3Executor({store:f.store,sessions:f.sessions,exitReceipts:receipts})
  try {
    const before=await readFile(join(f.root,'content/ui/menu.json'))
    f.run=await historicalSourceEdit(f,'historical')
    await f.store.commit('p','owner',f.run.version-1,f.run,'source-edit.reserved')
    const result=await executor.recover(f.run,{expectedVersion:f.run.version,attemptId:f.run.writer!.attemptId,fence:f.run.writer!.fence})
    expect(result.writer).toBeUndefined();expect(result.paused).toBeDefined()
    expect(result.sourceEdits![0]!.sourceEdit.status).toBe('failed')
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(before)
    expect(f.starts).toBe(0)
  }finally{await executor.dispose();await f.dispose()}
})

test('historical writer stop persists pause and only durable exit facts allow recovery',async()=>{
  const f=await fixture()
  try {
    const before=await readFile(join(f.root,'content/ui/menu.json'))
    f.run=await historicalSourceEdit(f,'persisted-exit')
    await f.store.commit('p','owner',f.run.version-1,f.run,'synthetic.historical-save')
    expect(f.executor.writerLiveness(f.run)).toBe('unknown')
    expect(await f.executor.recoveryEvidence(f.run)).toBe('unavailable')
    await expect(f.executor.stop(f.run)).rejects.toMatchObject({code:'writer-unresolved'})
    f.run=await f.current()
    expect(f.run.paused).toBeDefined();expect(f.run.writer).toBeDefined()
    const exited=structuredClone(f.run)
    exited.version++;exited.sourceEdits![0]!.quiescedAt=new Date().toISOString()
    await f.store.commit('p','owner',f.run.version,exited,'synthetic.persisted-exit')
    expect(await f.executor.recoveryEvidence(exited)).toBe('persisted')
    const result=await f.executor.recover(exited,{expectedVersion:exited.version,attemptId:exited.writer!.attemptId,fence:exited.writer!.fence})
    expect(result.writer).toBeUndefined();expect(result.paused).toEqual(exited.paused)
    expect(result.sourceEdits![0]!.status).toBe('failed')
    expect(f.executor.writerLiveness(result)).toBe('none')
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(before)
    expect(f.starts).toBe(0)
    await f.executor.dispose()
    await expect(f.executor.recover(exited,{expectedVersion:exited.version,attemptId:exited.writer!.attemptId,fence:exited.writer!.fence}))
      .rejects.toMatchObject({code:'worker-stopping'})
  }finally{await f.dispose()}
})

test.each([{platform:'Web',engine:'React'},{platform:'Web',engine:'Phaser'},{platform:'Web',engine:'Three.js'},{platform:'PC',engine:'Unity'},{platform:'PC',engine:'Godot'},{platform:'PC',engine:'Unreal'},{platform:'Mobile',engine:'Unity'},{platform:'XR',engine:'Unity'}])('all targets keep historical content read-only and reject editor writes: %j',async target=>{
  const f=await fixture(target,{initialDelivery:'design-led-first-version',editableContent:true}),cleanups:Array<()=>Promise<void>|void>=[]
  const app=createAgentWorkflowApp({defaultWorkspacePath:f.root,dashboardDataRoot:join(f.root,'.beegame/dashboard'),
    currentUser:{id:'owner',role:'owner'},sessionRunner:{async start(){throw Error('No model permitted')}},
    workflowV3Store:f.store,registerCleanup:fn=>cleanups.push(fn)})
  const json=(value:unknown)=>({headers:{'content-type':'application/json'},body:JSON.stringify(value)})
  try {
    const created=await app.request('/api/projects',{method:'POST',...json({id:'p',name:'Synthetic',root_path:f.root,created_at:Date.now()})})
    expect(created.status).toBe(200)
    const before=await readFile(join(f.root,'content/ui/menu.json'))
    const snapshot=await (await app.request('/api/projects/p/game-content')).json()
    expect(snapshot.readOnly).toBe(true)
    expect(snapshot.editing).toBeUndefined()
    const state=await (await app.request('/api/projects/p/runtime-state')).json()
    expect(state.scene_ui_editor_available).toBe(false)
    const payload={...await editValue(f),requestKey:'forbidden-save'}
    const reads=spyOn(f.store,'read').mockImplementation(async()=>{throw Error('Retired writes must not load workflow state')})
    try {
      const response=await app.request('/api/projects/p/game-content/document',{method:'PUT',...json(payload)})
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('editor-unavailable')
      expect(reads).not.toHaveBeenCalled()
    } finally { reads.mockRestore() }
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(before)
    const current=await f.current()
    expect(current.writer).toBeUndefined()
    expect(current.sourceEdits).toBeUndefined()
    expect(f.starts).toBe(0)
  } finally { for(const cleanup of cleanups.reverse())await cleanup(); await f.dispose() }
})
