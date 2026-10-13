import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createHmac } from 'node:crypto'
import { Hono } from 'hono'
import { createRun, pauseRun, publishPlan, V3_PROTOCOL, type Run } from './state'
import { createLocalWorkflowStore } from './store'
import { createHostExitReceipts, type HostExitReceipts } from './host-exit-receipt'
import { createAgentGoalExecutor } from './agent-goal'
import { createV3Executor } from './execution'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { readContentView } from './content-view'

async function fixture(autonomous=true) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-exit-crash-'))),workspace=join(root,'workspace'),key=randomBytes(32)
  await mkdir(workspace);await mkdir(join(root,'host'));await writeFile(join(workspace,'untouched.txt'),'Retained independent synthetic result')
  const store=createLocalWorkflowStore(join(root,'store'))
  const run=createRun({projectId:'synthetic-exit-project',ownerId:'synthetic-owner',workspacePath:workspace,
    chatSessionId:'beegame_syntheticexit',requestKey:'goal',text:JSON.stringify({kind:'confirmed_build_brief',idea:'Synthetic only',
      selected_option:{title:'Synthetic'},settings:{},document_language:'en',game_user_visible_language:'en',
      agent_response_language:'en',resource_library_usage:'optional'}),constraints:{},ids:['req.play']})
  if(autonomous)run.agentTurns=[];await store.commit(run.projectId,run.ownerId,0,run,'created')
  const receipts=()=>createHostExitReceipts({dataRoot:join(root,'host'),key})!
  let calls=0
  const sessions=new BeeGameSessionManager({async start(){calls++;throw Error('Recovery cannot start native')}},join(root,'sessions'),async()=>({}),{},true)
  return {root,workspace,key,run,store,receipts,sessions,get calls(){return calls},
    current:async()=>(await store.read(run.projectId,run.ownerId))!,
    close:async()=>{await sessions.dispose();await rm(root,{recursive:true,force:true})}}
}
const identity=(run:Run)=>({expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence})
async function killAt(f:Awaited<ReturnType<typeof fixture>>,mode:'agent'|'source'|'no-start'|'before-exit',body?:unknown) {
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'host-exit-crash-fixture.ts')],{cwd:process.cwd(),stdin:'pipe',stdout:'pipe',stderr:'pipe'})
  child.stdin.write(JSON.stringify({root:f.root,key:f.key.toString('hex'),run:f.run,mode,body}));child.stdin.end()
  let output='',errors='';let reached=false
  const stdout=(async()=>{for await(const bytes of child.stdout){output+=new TextDecoder().decode(bytes);if(output.includes('"checkpoint"'))reached=true}})()
  const stderr=(async()=>{for await(const bytes of child.stderr)errors+=new TextDecoder().decode(bytes)})()
  try {
    for(let i=0;i<1000 && !reached && child.exitCode===null;i++)await Bun.sleep(10)
    if(!reached)throw Error('Synthetic crash checkpoint absent: '+errors.slice(-1500))
    const checkpoint=output.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return {}}}).find(e=>e.checkpoint)
    expect(checkpoint.pid).toBe(child.pid)
    expect(checkpoint.checkpoint).toBe(mode==='before-exit'?'before-exit':'receipt-before-database')
    child.kill('SIGKILL');await child.exited;await Promise.all([stdout,stderr])
  }finally{if(child.exitCode===null)child.kill('SIGKILL');await child.exited}
  const run=await f.current()
  expect(run.writer).toBeDefined()
  expect((run.sourceEdits?.at(-1) ?? run.agentTurns!.at(-1))!.quiescedAt).toBeUndefined()
  return run
}

for(const mode of ['agent','source','no-start'] as const)test('signed exit survives actual host SIGKILL before database persistence: '+mode,async()=>{
  const f=await fixture();let executor:ReturnType<typeof createAgentGoalExecutor>|ReturnType<typeof createV3Executor>|undefined
  try {
    let body:unknown,original:Buffer|undefined
    if(mode==='source') {
      await mkdir(join(f.workspace,'content/ui'),{recursive:true});await mkdir(join(f.workspace,'content/scenes'))
      await writeFile(join(f.workspace,'content/ui/menu.json'),JSON.stringify(uiLayoutFixture()))
      await writeFile(join(f.workspace,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
      await writeFile(join(f.workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'synthetic',dimension:'2d',
        documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json','scenes/level.json'],
        documents:[{path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},
          {path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
      const view=await readContentView(f.workspace)
      if(view.state!=='draft')throw Error('Synthetic registered content missing')
      const saved=view.documents.find(d=>d.path==='ui/menu.json')!
      if(!('document' in saved) || !saved.document)throw Error('Synthetic source missing')
      const document=structuredClone(saved.document);(document.data as any).nodes[1].layout.size[1]=64
      original=await readFile(join(f.workspace,'content/ui/menu.json'))
      body={requestKey:'save',path:'ui/menu.json',expectedRevision:saved.revision,document,
        workflow:{version:f.run.version,planRevision:f.run.planRevision,requirementsRevision:f.run.requirements.revision}}
    }
    let run=await killAt(f,mode,body)
    const receipts=f.receipts(),facts=await receipts.read(run)
    expect(facts?.quiescedAt).toBeDefined();expect(facts).not.toHaveProperty('checks');expect(facts).not.toHaveProperty('outputs')
    if(mode==='no-start')expect(facts!.notStarted).toBe(true)
    if(mode==='agent')expect(facts!.nativeSessionId).toBe('11111111-2222-4333-8444-555555555555')
    const candidate=mode==='source'?await readFile(join(f.workspace,'content/ui/menu.json')):undefined
    if(candidate)expect(candidate.equals(original!)).toBe(false)
    const paused=pauseRun(run);await f.store.commit(run.projectId,run.ownerId,run.version,paused,'paused');run=paused
    executor=mode==='source'?createV3Executor({store:f.store,sessions:f.sessions,exitReceipts:receipts}):
      createAgentGoalExecutor({store:f.store,sessions:f.sessions,exitReceipts:receipts})
    expect(await executor.recoveryEvidence(run)).toBe('host-receipt')
    const app=new Hono(),cleanups:Array<()=>Promise<void>>=[]
    registerV3Routes(app,{store:f.store,sessions:f.sessions,exitReceipts:receipts,
      getUser:()=>({id:run.ownerId,role:'owner'}),getProject:async()=>({id:run.projectId,name:'Synthetic',root_path:f.workspace,created_at:0}),
      getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},
      readBody:r=>r.json(),registerCleanup:fn=>cleanups.push(fn)})
    const url='/api/projects/'+run.projectId+'/workflow-v3'
    const summary=await (await app.request(url)).json()
    expect(summary.recoveryEvidence).toBe('host-receipt');expect(summary.hostExitReceiptsConfigured).toBe(true)
    expect((await f.current()).writer).toEqual(run.writer);expect(f.calls).toBe(0)
    const hasActive=f.sessions.hasActiveProjectTurn.bind(f.sessions)
    try {
      f.sessions.hasActiveProjectTurn=()=>true
      await expect(executor.recover(run,identity(run))).rejects.toThrow('still active')
    }finally{f.sessions.hasActiveProjectTurn=hasActive}
    await expect(executor.recover(run,{...identity(run),fence:run.fence+1})).rejects.toThrow('current writer')
    await expect(executor.recover(run,{...identity(run),expectedVersion:run.version-1})).rejects.toThrow(/current.*[Rr]un|current.*version/)
    const response=await app.request(url+'/recover-writer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(identity(run))})
    expect(response.status,await response.clone().text()).toBe(200)
    const recovered=await f.current(),record=recovered.sourceEdits?.at(-1) ?? recovered.agentTurns!.at(-1)!
    expect(recovered.writer).toBeUndefined();expect(recovered.paused).toEqual(run.paused)
    expect(record.quiescedAt).toBe(facts!.quiescedAt);expect(record.status).toBe(mode==='source'?'failed':'interrupted')
    expect(recovered.requirements).toEqual(f.run.requirements);expect(recovered.deliveryEligible).toBe(false)
    if(mode==='source') {
      expect(recovered.sourceEdits![0]!.sourceEdit.status).toBe('failed')
      expect((await readFile(join(f.workspace,'content/ui/menu.json'))).equals(candidate!)).toBe(true)
      expect((await readFile(join(f.workspace,recovered.sourceEdits![0]!.sourceEdit.archive))).equals(original!)).toBe(true)
    }
    if(mode==='no-start') {
      expect(recovered.agentTurns![0]!.notStarted).toBe(true)
      const goal=createAgentGoalExecutor({store:f.store,sessions:f.sessions,exitReceipts:receipts})
      await expect(goal.message(recovered,{requestKey:'not-continue',runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:recovered.version,requirementsRevision:recovered.requirements.revision,intent:'continue',
        continuationOf:record.attemptId,text:'continue'},{})).rejects.toThrow('resume')
      const resumed=await goal.resume(recovered)
      await expect(goal.message(resumed,{requestKey:'still-not-continue',runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:resumed.version,requirementsRevision:resumed.requirements.revision,intent:'continue',
        continuationOf:record.attemptId,text:'continue'},{})).rejects.toThrow('never started')
      await goal.dispose()
    }
    expect(await readFile(join(f.workspace,'untouched.txt'),'utf8')).toBe('Retained independent synthetic result')
    expect(f.calls).toBe(0);expect((await readdir(join(f.root,'host/workflow-v3-exits'))).filter(n=>n.endsWith('.json'))).toHaveLength(1)
    if(mode==='source')expect(await readFile(join(f.workspace,'content/scenes/level.json'),'utf8')).toBe(JSON.stringify(sceneLayoutFixture()))
    await Promise.all(cleanups.map(fn=>fn()))
  }finally{await executor?.dispose();await f.close()}
},30000)

test('SIGKILL before observed exit cannot create a recovery proof',async()=>{
  const f=await fixture(),executor=createAgentGoalExecutor({store:f.store,sessions:f.sessions,exitReceipts:f.receipts()})
  try {
    const run=await killAt(f,'before-exit')
    expect(await f.receipts().read(run)).toBeUndefined();expect(await executor.recoveryEvidence(run)).toBe('unavailable')
    await expect(executor.recover(run,identity(run))).rejects.toThrow('No durable native exit')
    expect(await f.current()).toEqual(run);expect(f.calls).toBe(0)
  }finally{await executor.dispose();await f.close()}
},30000)

test('corrupt, copied, unsigned, symlinked or differently keyed host records never unlock a writer',async()=>{
  const f=await fixture(),executor=createAgentGoalExecutor({store:f.store,sessions:f.sessions,exitReceipts:f.receipts()})
  try {
    const run=await killAt(f,'no-start'),root=join(f.root,'host/workflow-v3-exits'),file=join(root,(await readdir(root)).find(n=>n.endsWith('.json'))!)
    const bytes=await readFile(file),receipts=f.receipts(),facts=(await receipts.read(run))!
    expect(createHostExitReceipts({dataRoot:join(f.root,'host')})).toBeUndefined()
    await expect(createHostExitReceipts({dataRoot:join(f.root,'host'),key:randomBytes(32)})!.read(run)).rejects.toThrow('untrusted')
    await expect(receipts.save(run,{...facts,quiescedAt:new Date(Date.now()+1000).toISOString()})).rejects.toThrow('untrusted')
    expect(await readFile(file)).toEqual(bytes)
    for(const mutation of ['ownerId','projectId','id','chatSessionId','workspacePath'] as const) {
      const wrong=structuredClone(run)
      if(mutation==='workspacePath'){wrong.workspacePath=join(f.root,'other-workspace');await mkdir(wrong.workspacePath)}
      else wrong[mutation]+='-different'
      expect(await receipts.read(wrong)).toBeUndefined()
    }
    for(const mutation of ['workerId','fence','requestKey','requirementsRevision'] as const) {
      const wrong=structuredClone(run),turn=wrong.agentTurns![0]!
      if(mutation==='fence'){turn.fence++;wrong.writer!.fence++}
      else if(mutation==='workerId'){turn.workerId+='-different';wrong.writer!.workerId=turn.workerId}
      else turn[mutation]=(turn[mutation]??'')+'-different'
      expect(await receipts.read(wrong)).toBeUndefined()
    }
    const envelope=JSON.parse(bytes.toString()),body=JSON.parse(envelope.payload)
    body.binding.workerId='forged';envelope.payload=JSON.stringify(body)
    await writeFile(file,JSON.stringify(envelope))
    expect(await executor.recoveryEvidence(run)).toBe('unavailable')
    await expect(executor.recover(run,identity(run))).rejects.toThrow('untrusted');expect(await f.current()).toEqual(run)
    await writeFile(file,'{"payload":')
    await expect(receipts.read(run)).rejects.toThrow('untrusted')
    await writeFile(file,bytes);await expect(receipts.save(run,{...facts,checks:[]} as any)).rejects.toThrow()
    // Valid host signature with a mismatched binding is still not usable.
    const key=createHmac('sha256',f.key).update('bgs.workflow.v3.host-exit-receipt.1').digest()
    envelope.signature=createHmac('sha256',key).update(envelope.payload).digest('hex')
    await writeFile(file,JSON.stringify(envelope));await expect(receipts.read(run)).rejects.toThrow('untrusted')
    await rm(file);const alias=join(f.root,'receipt-copy.json');await writeFile(alias,bytes);await symlink(alias,file)
    await expect(receipts.read(run)).rejects.toThrow('untrusted')
    await expect(createHostExitReceipts({dataRoot:f.workspace,key:f.key})!.save(run,facts)).rejects.toThrow('untrusted')
    expect(await readdir(f.workspace)).not.toContain('workflow-v3-exits')
    expect(f.calls).toBe(0)
  }finally{await executor.dispose();await f.close()}
},30000)

test('receipt write outage does not block normal database settlement; native cleanup rejection produces no receipt',async()=>{
  for(const cleanupFails of [false,true]) {
    const f=await fixture();let submitted=0,disposed=0,writes=0
    const sessions=new BeeGameSessionManager({async start(){return {stop(){},async dispose(){disposed++;if(cleanupFails)throw Error('Synthetic cleanup failed')},
      async submit(turn){submitted++;await turn.onMessage({type:'result',subtype:'success',result:'Synthetic'} as any)}}}},join(f.root,'normal-native'),async()=>({}),{},true)
    const receipts:HostExitReceipts={read:f.receipts().read,save:async()=>{writes++;throw Error('Synthetic filesystem outage')}}
    const executor=createAgentGoalExecutor({store:f.store,sessions,exitReceipts:receipts})
    try {
      await executor.start(f.run,{})
      for(let i=0;i<400;i++){if(disposed && (cleanupFails || !(await f.current()).writer))break;await Bun.sleep(5)}
      await executor.dispose();const run=await f.current()
      expect(submitted).toBe(1);expect(disposed).toBe(1)
      if(cleanupFails){expect(writes).toBe(0);expect(run.writer).toBeDefined();expect(run.agentTurns![0]!.quiescedAt).toBeUndefined()}
      else {expect(writes).toBe(1);expect(run.writer).toBeUndefined();expect(run.agentTurns![0]!.status).toBe('ended')}
    }finally{await executor.dispose();await sessions.dispose();await f.close()}
  }
})

test('compatible task recovery restores only accounting facts, not passed checks or acceptance',async()=>{
  const f=await fixture(false);let calls=0,outage=true,exitWrites=0
  await writeFile(join(f.workspace,'rules.json'),'{}')
  const planned=publishPlan(f.run,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:f.run.requirements.revision,
    tasks:[{id:'rules',kind:'game.develop',goal:'Synthetic rule file',dependsOn:[],requirementIds:['req.play'],inputs:[],
      writablePaths:['rules.json'],expectedOutputs:['rules.json'],checks:['artifact-json']}]})
  await f.store.commit(planned.projectId,planned.ownerId,f.run.version,planned,'planned')
  const store={read:f.store.read,async commit(...args:Parameters<typeof f.store.commit>){
    if(outage && args[4]==='writer.quiesced'){exitWrites++;throw Error('Synthetic database outage')}
    await f.store.commit(...args)
  }}
  const sessions=new BeeGameSessionManager({async start(input){input.onNativeSessionId?.('11111111-2222-4333-8444-555555555555');return {
    stop(){},async dispose(){},async submit(turn){calls++;await writeFile(join(f.workspace,'rules.json'),'{"candidate":true}')
      await turn.onMessage({type:'result',subtype:'success',session_id:'11111111-2222-4333-8444-555555555555',
        usage:{input_tokens:5,output_tokens:2},result:'Synthetic task'} as any)}
  }}},join(f.root,'task-native'),async()=>({}),{},true)
  const original=createV3Executor({store,sessions,exitReceipts:f.receipts()}),restarted=createV3Executor({store:f.store,sessions:f.sessions,exitReceipts:f.receipts()})
  try {
    await original.start(planned,'rules','one-request',{})
    for(let i=0;i<400 && !exitWrites;i++)await Bun.sleep(5)
    expect(exitWrites).toBe(1);await original.dispose()
    let run=await f.current();expect(run.writer).toBeDefined();expect(run.attempts[0]!.quiescedAt).toBeUndefined()
    const facts=(await f.receipts().read(run))!;expect(facts.nativeSessionId).toBeDefined();expect(facts).not.toHaveProperty('checks')
    const otherTask=structuredClone(run);otherTask.attempts[0]!.taskId='another-task'
    expect(await f.receipts().read(otherTask)).toBeUndefined()
    expect(await restarted.recoveryEvidence(run)).toBe('host-receipt');outage=false
    run=await restarted.recover(run,identity(run))
    expect(run.writer).toBeUndefined();expect(run.tasks.rules!.status).toBe('failed');expect(run.attempts[0]!.checks).toBeUndefined()
    expect(run.attempts[0]!.nativeSessionId).toBe(facts.nativeSessionId);expect(run.deliveryEligible).toBe(false)
    expect(await readFile(join(f.workspace,'rules.json'),'utf8')).toBe('{"candidate":true}')
    expect(await readFile(join(f.workspace,'untouched.txt'),'utf8')).toBe('Retained independent synthetic result')
    expect(calls).toBe(1);expect(f.calls).toBe(0)
  }finally{await original.dispose();await restarted.dispose();await sessions.dispose();await f.close()}
})
