import { test, expect } from 'bun:test'
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, publishPlan, claimTask, finishTask, pauseRun, V3_PROTOCOL, type Run } from './state'
import { createLocalWorkflowStore, type WorkflowStore } from './store'
import { createV3Executor } from './execution'
import { BeeGameSessionManager } from '../session-manager'
import { reserveSourceEdit } from './changes'

async function fixture(root: string, store: WorkflowStore) {
  await writeFile(join(root,'rules.json'),'{}'); await writeFile(join(root,'notes.json'),'{"untouched":true}')
  let run=createRun({projectId:'p',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Synthetic recovery',constraints:{},ids:['req.play']})
  await store.commit('p','owner',0,run,'created')
  const task={id:'rules',kind:'game.develop' as const,goal:'Rules',dependsOn:[],requirementIds:['req.play'],inputs:[],writablePaths:['rules.json'],expectedOutputs:['rules.json'],checks:['artifact-json' as const]}
  const next=publishPlan(run,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:run.requirements.revision,tasks:[task,{...task,id:'notes',writablePaths:['notes.json'],expectedOutputs:['notes.json']}]})
  await store.commit('p','owner',run.version,next,'planned');run=next
  const started=claimTask(run,{taskId:'notes',requestKey:'notes',workerId:'synthetic',sessionId:'notes',inputVersions:[]})
  await store.commit('p','owner',run.version,started,'claimed')
  const completed=finishTask(started,started.writer!.attemptId,started.fence,{checks:[{id:'artifact-json',version:'fixture',status:'passed',inputs:[],observation:'Synthetic baseline only',createdAt:new Date().toISOString()}]},true)
  await store.commit('p','owner',started.version,completed,'settled');return completed
}
const identity=(run:Run)=>({expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence})
async function waitFor(check:()=>Promise<boolean>) {for(let n=0;n<400;n++){if(await check())return;await Bun.sleep(5)}throw Error('Fixture did not reach expected state')}

test('host quiescence survives failed settlement and worker reload; explicit recovery neither accepts nor retries partial work',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-recovery-'))), base=createLocalWorkflowStore(join(root,'host'))
  let calls=0,disposed=0,failures=0
  const store:WorkflowStore={read:base.read,async commit(p,a,v,next,event){if(event==='attempt.settled'){failures++;throw Error('Synthetic database response failure')}await base.commit(p,a,v,next,event)}}
  const sessions=new BeeGameSessionManager({async start(){return{stop(){},async dispose(){disposed++},async submit(turn){calls++;await turn.onMessage({type:'result',subtype:'success',result:'Fixture'})}}}},join(root,'native'),async()=>({}),{},true)
  const executor=createV3Executor({store,sessions})
  let restarted:ReturnType<typeof createV3Executor>|undefined
  const restartedSessions=new BeeGameSessionManager({async start(){throw Error('Recovery must not start a new native process')}},join(root,'native'),async()=>({}),{},true)
  try {
    const planned=await fixture(root,base), notes=structuredClone(planned.tasks.notes)
    await executor.start(planned,'rules','one-request',{})
    await waitFor(async()=>failures===1);await executor.dispose()
    const current=(await base.read('p','owner'))!
    expect(current.attempts.at(-1)!.quiescedAt).toBeDefined();expect(disposed).toBe(1)
    const paused=pauseRun(current);await base.commit('p','owner',current.version,paused,'paused')
    restarted=createV3Executor({store:createLocalWorkflowStore(join(root,'host')),sessions:restartedSessions})
    expect(restarted.writerLiveness(paused)).toBe('unknown')
    await expect(restarted.recover(paused,{...identity(paused),fence:paused.fence+1})).rejects.toThrow('current writer')
    await expect(restarted.recover(paused,identity(current))).rejects.toThrow('current Run')
    const recovered=await restarted.recover(paused,identity(paused))
    expect(recovered.writer).toBeUndefined();expect(recovered.paused).toEqual(paused.paused)
    expect(recovered.tasks.rules!.status).toBe('failed');expect(recovered.tasks.notes).toEqual(notes)
    expect(recovered.attempts.at(-1)!.checks).toBeUndefined();expect(recovered.deliveryEligible).toBe(false)
    expect(await readFile(join(root,'notes.json'),'utf8')).toBe('{"untouched":true}')
    expect(calls).toBe(1)
    await expect(restarted.recover(recovered,identity(paused))).rejects.toThrow('current Run')
    expect(await restarted.start(recovered,'rules','one-request',{})).toEqual(recovered.attempts.at(-1)!)
    expect(calls).toBe(1)
  }finally{await executor.dispose();await restarted?.dispose();await sessions.dispose();await restartedSessions.dispose();await rm(root,{recursive:true,force:true})}
})

test('missing session, old timestamps and user assertion cannot release an unknown writer',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-unknown-'))),store=createLocalWorkflowStore(join(root,'host'))
  const sessions=new BeeGameSessionManager({async start(){throw Error('Never execute')}},join(root,'native'),async()=>({}),{},true),executor=createV3Executor({store,sessions})
  try {
    const run=await fixture(root,store),claimed=claimTask(run,{taskId:'rules',requestKey:'old',workerId:'lost',sessionId:'missing',inputVersions:[]})
    claimed.attempts.at(-1)!.startedAt='2000-01-01T00:00:00.000Z'
    await store.commit('p','owner',run.version,claimed,'claimed')
    await expect(executor.recover(claimed,identity(claimed))).rejects.toThrow('No durable host quiescence evidence')
    expect((await store.read('p','owner'))!).toEqual(claimed)
  }finally{await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})

test('cleanup rejection cannot create exit evidence or accept a task',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-cleanup-failure-'))),store=createLocalWorkflowStore(join(root,'host'))
  let cleanupCalls=0
  const sessions=new BeeGameSessionManager({async start(){return{stop(){},async dispose(){cleanupCalls++;throw Error('Synthetic exit unconfirmed')},async submit(turn){await turn.onMessage({type:'result',subtype:'success',result:'Done'})}}}},join(root,'native'),async()=>({}),{},true)
  const executor=createV3Executor({store,sessions})
  try {
    const run=await fixture(root,store);await executor.start(run,'rules','once',{});await waitFor(async()=>cleanupCalls>0);await executor.dispose()
    const unresolved=(await store.read('p','owner'))!
    expect(unresolved.writer).toBeDefined();expect(unresolved.attempts.at(-1)!.quiescedAt).toBeUndefined()
    expect(unresolved.tasks.rules!.status).toBe('running')
    await expect(executor.recover(unresolved,identity(unresolved))).rejects.toThrow('shutting down')
    const restarted=createV3Executor({store,sessions})
    await expect(restarted.recover(unresolved,identity(unresolved))).rejects.toThrow('No durable host quiescence evidence')
    await restarted.dispose()
  }finally{await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})

test('exit receipt is absent until runtime disposal completes; an active writer cannot be recovered',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-disposal-drain-'))),store=createLocalWorkflowStore(join(root,'host'))
  let release:(()=>void)|undefined
  const sessions=new BeeGameSessionManager({async start(){return{stop(){},dispose(){return new Promise<void>(resolve=>{release=resolve})},async submit(turn){await turn.onMessage({type:'result',subtype:'success',result:'Done'})}}}},join(root,'native'),async()=>({}),{},true)
  const executor=createV3Executor({store,sessions})
  try {
    const run=await fixture(root,store);await executor.start(run,'rules','once',{});await waitFor(async()=>!!release)
    const active=(await store.read('p','owner'))!
    expect(active.attempts.at(-1)!.quiescedAt).toBeUndefined()
    await expect(executor.recover(active,identity(active))).rejects.toThrow('still active')
    release!();await waitFor(async()=>!(await store.read('p','owner'))!.writer)
    expect((await store.read('p','owner'))!.tasks.rules!.status).toBe('succeeded')
  }finally{release?.();await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})

test('host edit recovery preserves its invalidated owner and unrelated result; receipts cannot be moved or removed',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-edit-recovery-'))),store=createLocalWorkflowStore(join(root,'host'))
  const sessions=new BeeGameSessionManager({async start(){throw Error('No native execution')}},join(root,'native'),async()=>({}),{},true),executor=createV3Executor({store,sessions})
  try {
    const run=await fixture(root,store),reserved=reserveSourceEdit(run,{path:'rules.json',before:'a'.repeat(64),after:'b'.repeat(64),workerId:'lost-host',requestKey:'edit'})
    await store.commit('p','owner',run.version,reserved,'source-edit.reserved')
    const receipt=structuredClone(reserved);receipt.version++;receipt.attempts.at(-1)!.quiescedAt=new Date().toISOString()
    await store.commit('p','owner',reserved.version,receipt,'fixture.host-quiesced')
    for(const mutation of ['remove','identity','time'] as const){
      const invalid=structuredClone(receipt);invalid.version++
      if(mutation==='remove')invalid.attempts.pop()
      else if(mutation==='identity')invalid.attempts.at(-1)!.workerId='another'
      else invalid.attempts.at(-1)!.quiescedAt='2000-01-01T00:00:00.000Z'
      await expect(store.commit('p','owner',receipt.version,invalid,'invalid')).rejects.toThrow('quiescence')
    }
    const recovered=await executor.recover(receipt,identity(receipt))
    expect(recovered.writer).toBeUndefined();expect(recovered.tasks.rules!.status).toBe('pending')
    expect(recovered.attempts.at(-1)!.sourceEdit!.status).toBe('failed')
    expect(recovered.attempts.at(-1)!.status).toBe('failed');expect(recovered.tasks.notes).toEqual(run.tasks.notes)
    expect(await readFile(join(root,'rules.json'),'utf8')).toBe('{}')
  }finally{await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})
