import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, digest, pauseRun, type Run, type TaskSpec } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { createV3Executor } from './execution'
import { changeRequirements, reserveSourceEdit, settleSourceEdit } from './changes'
import { prepareSourceEdit, writeSourceEdit } from './source-edit'
import { bindInputs, runChecks, assertFreshDependencies } from './checks'
import { readContentView } from './content-view'
import { selectMeasuredBuild, exportMeasuredBuild } from './measured-build'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { createAgentWorkflowApp } from '../../app'

const owner = (id:string,path:string):TaskSpec => ({id,kind:'game.develop',goal:'Maintain formal '+id,dependsOn:[],requirementIds:['req.play'],
  inputs:[path],writablePaths:[path],expectedOutputs:[path],checks:['content-schema']})
const game:TaskSpec = {id:'game',kind:'game.develop',goal:'Build current sources and measure',dependsOn:['ui','scene'],requirementIds:['req.play'],inputs:[],
  writablePaths:['dist/**'],expectedOutputs:['dist/index.html'],checks:['build','runtime-smoke'],runtimeArtifact:'dist',editableProject:true}
async function fixture(autonomous=false) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-change-'))), data = join(root,'.beegame/store')
  for (const dir of ['content/ui','content/scenes','src']) await mkdir(join(root,dir),{recursive:true})
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs'}}))
  await writeFile(join(root,'build.mjs'),"import {cp,mkdir} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
  await writeFile(join(root,'src/index.html'),'<html><body>Fixture<script>fetch("/content/ui/menu.json").then(r=>r.json()).then(d=>document.body.dataset.height=d.data.nodes[1].layout.size[1]);</script></body></html>')
  await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(uiLayoutFixture()))
  await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
  await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',documentRevision:'a'.repeat(64),
    assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json','scenes/level.json'],documents:[
      {path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},{path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
  await writeFile(join(root,'notes.json'),'{}')
  let run = createRun({projectId:'p',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Fixture requirements',constraints:{},ids:['req.play']})
  if(autonomous)run.agentTurns=[]
  const store = createLocalWorkflowStore(data)
  await store.commit('p','owner',0,run,'run.created')
  const tasks:TaskSpec[] = [owner('ui','content/ui/menu.json'),owner('scene','content/scenes/level.json'),
    {id:'notes',kind:'game.develop',goal:'Independent saved note',dependsOn:[],requirementIds:['req.play'],inputs:[],writablePaths:['notes.json'],expectedOutputs:['notes.json'],checks:['artifact-json']},game]
  if(!autonomous) {
    const next = publishPlan(run,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:run.requirements.revision,tasks})
    await store.commit('p','owner',run.version,next,'plan.published');run=next
  }
  let starts=0
  const sessions = new BeeGameSessionManager({async start(){starts++;throw Error('No provider permitted')}},data,async()=>({}),{},true)
  const executor = createV3Executor({store,sessions})
  return { root,store,sessions,executor,get starts(){return starts},get run(){return run},set run(value:Run){run=value},
    async current(){run=(await store.read('p','owner'))!;return run},
    async check(id:string){const spec=run.tasks[id]!.spec, claimed=claimTask(run,{taskId:id,requestKey:crypto.randomUUID(),workerId:'synthetic-check',sessionId:'synthetic',inputVersions:await bindInputs(run,spec)})
      await store.commit('p','owner',run.version,claimed,'attempt.claimed');const attempt=claimed.attempts.at(-1)!
      const result=await runChecks(root,spec,attempt.inputVersions,undefined,run.requirements.constraints,{run:claimed,attempt})
      expect(result.checks.map(c=>[c.id,c.status,c.observation])).toEqual(result.checks.map(c=>[c.id,'passed',expect.any(String)]))
      run=finishTask(claimed,attempt.attemptId,claimed.fence,result,true);await store.commit('p','owner',claimed.version,run,'attempt.settled')},
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
  requestKey:crypto.randomUUID(),requirements:{text,constraints:run.requirements.constraints,ids:run.requirements.ids},
  tasks:Object.values(run.tasks).filter(t=>t.status!=='superseded').map(t=>t.spec)} }

test('autonomous UI/Scene saves retain exact originals, preserve native history, deduplicate and never create Tasks or dispatch a model',async()=>{
  const f=await fixture(true)
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
    expect(f.run.planRevision).toBe(0);expect(f.run.tasks).toEqual({});expect(f.run.attempts).toEqual([]);expect(f.run.plans).toEqual([])
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
  const f=await fixture(true)
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
    expect(f.run.sourceEdits![0]!.sourceEdit.status).toBe('failed');expect(f.run.writer).toBeUndefined()
    await expect(executor.edit(f.run,f.run.sourceEdits![0]!.requestKey==='a'?a:b)).rejects.toThrow('historical/failed')
    f.run=await executor.stop(f.run)
    await expect(executor.edit(f.run,{...await editValue(f),requestKey:'paused'})).rejects.toThrow('resume')
    expect(f.starts).toBe(0)
  }finally{await executor.dispose();await f.dispose()}
})

test('an unresolved autonomous save cannot be released using a missing session or fabricated quiescence',async()=>{
  const f=await fixture(true)
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

test('autonomous save API enforces owner permission, routes pause/recovery to host saves and never invokes native tools',async()=>{
  const f=await fixture(true),app=new Hono(),cleanups:Array<()=>Promise<void>>=[]
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
  const f=await fixture(true)
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

test('formal UI and Scene saves invalidate actual owners/consumers before writing; old preview/export rejected; actual rebuild has new measurement',async()=>{
  const f=await fixture()
  try {
    for(const id of ['ui','scene','notes','game'])await f.check(id)
    const old=f.run,oldAttempt=old.tasks.game!.attemptId!,oldArtifact=(await selectMeasuredBuild(old,'game',oldAttempt)).artifact.sha256
    const note=f.run.tasks.notes!,scene=f.run.tasks.scene!,original=await readFile(join(f.root,'content/ui/menu.json'))
    const noChange=await f.executor.edit(f.run,{...(await editValue(f)),document:JSON.parse(original.toString('utf8'))})
    expect(noChange.workflow).toEqual(workflow(old));expect((await f.current()).version).toBe(old.version)
    expect(f.run.tasks.game!.attemptId).toBe(oldAttempt);expect(f.run.attempts).toEqual(old.attempts)
    const value=await editValue(f),saved=await f.executor.edit(f.run,value);await f.current()
    expect(saved.unmeasured).toBe(true);expect(saved.workflow).toEqual(workflow(f.run));expect(f.run.tasks.ui!.status).toBe('pending')
    expect(await readContentView(f.root)).toMatchObject({state:'draft',contentRevision:saved.contentRevision})
    expect(f.run.tasks.game!.status).toBe('pending');expect(f.run.tasks.notes).toEqual(note);expect(f.run.tasks.scene).toEqual(scene)
    const record=f.run.attempts.at(-1)!
    expect(record.sourceEdit?.status).toBe('saved');expect(record.status).toBe('blocked');expect(record.checks).toBeUndefined();expect(f.run.writer).toBeUndefined()
    expect(await readFile(join(f.root,record.sourceEdit!.archive))).toEqual(original)
    expect(f.run.attempts.find(a=>a.attemptId===oldAttempt)).toEqual(old.attempts.find(a=>a.attemptId===oldAttempt))
    await expect(selectMeasuredBuild(f.run,'game',oldAttempt)).rejects.toThrow('current successful attempt')
    await expect(exportMeasuredBuild(f.run,'game',oldAttempt,{read:()=>f.current(),busy:()=>false})).rejects.toThrow()
    await expect(f.executor.edit(f.run,value)).rejects.toThrow('Run/requirements changed')
    await f.check('ui');await f.check('game')
    const fresh=(await selectMeasuredBuild(f.run,'game',f.run.tasks.game!.attemptId!))
    expect(fresh.artifact.sha256).not.toBe(oldArtifact);expect(fresh.attempt.attemptId).not.toBe(oldAttempt)
    expect(JSON.parse(await readFile(join(f.root,'dist/content/ui/menu.json'),'utf8')).data.nodes[1].layout.size[1]).toBe(64)
    const sceneValue=await editValue(f,'scenes/level.json');await f.executor.edit(f.run,sceneValue);await f.current()
    expect(f.run.tasks.scene!.status).toBe('pending');expect(f.run.tasks.ui!.status).toBe('succeeded');expect(f.run.tasks.notes).toEqual(note)
    await f.check('scene');await f.check('game')
    expect((await exportMeasuredBuild(f.run,'game',f.run.tasks.game!.attemptId!,{read:()=>f.current(),busy:()=>false},'project')).kind).toBe('project')
    expect(f.starts).toBe(0)
  } finally {await f.dispose()}
},30000)

test('confirmed requirement changes are append-only user scope, invalidate every qualification even if artifact bytes identical, no automatic execution',async()=>{
  const f=await fixture()
  try {
    for(const id of ['ui','scene','notes','game'])await f.check(id)
    const original=f.run,oldAttempt=original.tasks.game!.attemptId!,oldArtifact=(await selectMeasuredBuild(f.run,'game',oldAttempt)).artifact
    const body=changeValue(f.run),next=changeRequirements(f.run,body)
    expect(next.version).toBe(original.version+1);expect(next.requirements.revision).not.toBe(original.requirements.revision)
    expect(next.requirementChanges![0]!.before).toEqual(original.requirements);expect(next.requirementChanges![0]!.after).toEqual(next.requirements)
    expect(next.attempts).toEqual(original.attempts);expect(Object.values(next.tasks).every(t=>t.status==='pending'&&!t.attemptId)).toBe(true)
    await f.store.commit('p','owner',f.run.version,next,'requirements.changed');f.run=next
    expect(changeRequirements(next,body)).toBe(next)
    expect(()=>changeRequirements(next,{...body,tasks:body.tasks.map(t=>({...t,goal:t.goal+' widened'}))})).toThrow('different task plan')
    await expect(selectMeasuredBuild(next,'game',oldAttempt)).rejects.toThrow()
    const forged=structuredClone(next);forged.tasks.game=original.tasks.game!
    await expect(assertFreshDependencies(forged,{...game,dependsOn:['game']})).rejects.toThrow('evidence changed')
    expect(()=>assertCommit('p','owner',next.version,{...next,version:next.version+1,requirementChanges:[]},next)).toThrow('history')
    for(const id of ['ui','scene','notes','game'])await f.check(id)
    const fresh=await selectMeasuredBuild(f.run,'game',f.run.tasks.game!.attemptId!)
    expect(fresh.artifact).toEqual(oldArtifact);expect(fresh.attempt.attemptId).not.toBe(oldAttempt)
    expect(fresh.smoke.inputs.find(v=>v.path.startsWith('requirement:'))).toEqual({path:'requirement:'+next.requirements.revision,sha256:next.requirements.sha256})
    expect((await createLocalWorkflowStore(join(f.root,'.beegame/store')).read('p','owner'))!.requirementChanges).toEqual(next.requirementChanges)
    const second=changeRequirements(f.run,changeValue(f.run,'Third authorized goal'));expect(second.requirementChanges![1]!.before).toEqual(f.run.requirements)
    await f.store.commit('p','owner',f.run.version,second,'requirements.changed');expect(f.starts).toBe(0)
  } finally {await f.dispose()}
},30000)

test('a measured source-copy build is invalidated by its actually built JSON even when the task omitted that dependency',async()=>{
  const f=await fixture()
  try {
    const tasks=Object.values(f.run.tasks).map(t=>t.spec.id==='game'?{...t.spec,dependsOn:[]}:t.spec)
    const planned=publishPlan(f.run,{protocol:V3_PROTOCOL,baseRevision:f.run.planRevision,requirementsRevision:f.run.requirements.revision,tasks})
    await f.store.commit('p','owner',f.run.version,planned,'plan.published');f.run=planned
    await f.check('ui');await f.check('game');const old=f.run.tasks.game!.attemptId!
    expect(f.run.attempts.find(a=>a.attemptId===old)!.checks![0]!.projectBuild!.files.map(v=>v.path)).toContain('content/ui/menu.json')
    await f.executor.edit(f.run,await editValue(f));await f.current()
    expect(f.run.plans.at(-1)!.impact?.game).toContain('ui');expect(f.run.tasks.game!.status).toBe('pending')
    await expect(selectMeasuredBuild(f.run,'game',old)).rejects.toThrow('current successful attempt')
  }finally{await f.dispose()}
},30000)

test('missing rebuild authority, invalid scope/identity, stale hashes, aliases and writer contention never overwrite a candidate',async()=>{
  const f=await fixture()
  try {
    const body=await editValue(f),original=await readFile(join(f.root,'content/ui/menu.json'))
    for(const modified of [{...body,path:'../src/index.html'}, {...body,expectedRevision:'0'.repeat(64)}, {...body,document:{...body.document,id:'changed'}},
      {...body,workflow:{...body.workflow,requirementsRevision:'stale'}}])await expect(f.executor.edit(f.run,modified)).rejects.toThrow()
    const missing=structuredClone(f.run);delete missing.tasks.ui
    await expect(f.executor.edit(missing,body)).rejects.toThrow('owns this registered source')
    const noBuild=structuredClone(f.run);delete noBuild.tasks.game!.spec.editableProject
    await expect(f.executor.edit(noBuild,body)).rejects.toThrow('needs an editableProject')
    expect(()=>changeRequirements(noBuild,changeValue(noBuild))).toThrow('needs an editableProject')
    const writer={...f.run,writer:{attemptId:crypto.randomUUID(),workerId:'other',fence:1}}
    await expect(f.executor.edit(writer,body)).rejects.toThrow('current writer')
    expect(()=>changeRequirements(writer,changeValue(writer))).toThrow('writer')
    const prior=await f.current();expect(prior.version).toBe(body.workflow.version);expect(prior.attempts).toHaveLength(0)
    expect(await readFile(join(f.root,'content/ui/menu.json'))).toEqual(original)
    await rm(join(f.root,'content/ui/menu.json'));await writeFile(join(f.root,'source.json'),original);await symlink(join(f.root,'source.json'),join(f.root,'content/ui/menu.json'))
    await expect(f.executor.edit(f.run,body)).rejects.toThrow('symlinks');expect(f.starts).toBe(0)
  } finally {await f.dispose()}
})

test('cancelled/interrupted edit never preserves old acceptance; durable lease/history survive restart, pause retained, no blind rollback or retry',async()=>{
  const f=await fixture()
  try {
    const value=await editValue(f),edit=await prepareSourceEdit(f.run,value),reserved=reserveSourceEdit(f.run,{path:edit.path,before:edit.beforeHash,after:edit.afterHash,workerId:'lost-worker',requestKey:'edit'})
    await f.store.commit('p','owner',f.run.version,reserved,'source-edit.reserved');f.run=reserved
    const restored=(await createLocalWorkflowStore(join(f.root,'.beegame/store')).read('p','owner'))!
    expect(f.executor.writerLiveness(restored)).toBe('unknown');await expect(f.executor.resume(restored)).rejects.toThrow('writer')
    expect(()=>publishPlan(restored,{...restored.plans.at(-1)!.plan,baseRevision:restored.planRevision})).toThrow('Previous writer')
    const signal=new AbortController();signal.abort();await expect(writeSourceEdit(restored,restored.writer!.attemptId,edit,signal.signal)).rejects.toThrow('cancelled')
    expect(digest(await readFile(join(f.root,edit.path)))).toBe(edit.beforeHash)
    const paused=pauseRun(restored);await f.store.commit('p','owner',restored.version,paused,'run.paused')
    // Only after the host operation has actually exited, not elapsed time.
    expect(()=>settleSourceEdit(paused,paused.writer!.attemptId,paused.writer!.fence)).toThrow('drain')
    const quiet=structuredClone(paused);quiet.version++;quiet.attempts.at(-1)!.quiescedAt=new Date().toISOString()
    await f.store.commit('p','owner',paused.version,quiet,'writer.quiesced')
    const settled=settleSourceEdit(quiet,quiet.writer!.attemptId,quiet.writer!.fence,'Host edit exited after cancellation')
    await f.store.commit('p','owner',quiet.version,settled,'source-edit.settled');f.run=settled
    expect(settled.paused).toEqual(paused.paused);expect(settled.writer).toBeUndefined();expect(settled.tasks.ui!.status).toBe('pending')
    expect(settled.attempts.at(-1)!.sourceEdit?.status).toBe('failed');expect(f.starts).toBe(0)
  } finally {await f.dispose()}
})

test('actual app routes expose only authorized formal editor saves; changed requirements need current user plan; legacy publish stays closed',async()=>{
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
    const value=await editValue(f),saved=await app.request('/api/projects/p/game-content/document',{method:'PUT',...json(value)})
    expect(saved.status).toBe(200);expect((await saved.json()).unmeasured).toBe(true);await f.current()
    const events=await app.request('/api/projects/p/workflow-v3/events');expect(events.status).toBe(200);expect((await events.json()).events).toEqual([])
    expect((await app.request('/api/projects/p/game-content/publish',{method:'POST',...json({contentRevision:'a'.repeat(64)})})).status).toBe(409)
    user.role='viewer';expect((await (await app.request('/api/projects/p/game-content')).json()).readOnly).toBe(true)
    expect((await app.request('/api/projects/p/game-content/document',{method:'PUT',...json(await editValue(f))})).status).toBe(403)
    expect((await app.request('/api/projects/p/workflow-v3/requirements',{method:'POST',...json(changeValue(f.run))})).status).toBe(403)
    user.role='owner';const change=changeValue(f.run)
    const changed=await app.request('/api/projects/p/workflow-v3/requirements',{method:'POST',...json(change)})
    expect(changed.status).toBe(200);expect((await changed.json()).dispatched).toBe(false);await f.current()
    expect((await app.request('/api/projects/p/workflow-v3/requirements',{method:'POST',...json(change)})).status).toBe(200)
    expect(f.starts).toBe(0)
  }finally{for(const cleanup of cleanups.reverse())await cleanup();await f.dispose()}
})
