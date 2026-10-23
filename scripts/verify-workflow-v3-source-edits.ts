import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,basename} from 'node:path'
import {randomUUID} from 'node:crypto'
import {loadEnvFile} from './beegame-migration-cli'
import {createLocalWorkflowStore,createRemoteWorkflowStore,type WorkflowStore} from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import {createRun,digest,WorkflowError,type Run} from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import {createV3Executor} from '../packages/agent-workflow-server/src/beegame/workflow-v3/execution'
import {BeeGameSessionManager} from '../packages/agent-workflow-server/src/beegame/session-manager'
import {uiLayoutFixture,sceneLayoutFixture} from '../packages/agent-workflow-server/src/beegame/fixtures/layout-fixture'

// Explicit synthetic fault acceptance. No model, real game, engine selection,
// schema changes, retry or forcibly unlocked writer. Credentials travel only
// over a child stdin pipe; never argv/stdout or a retained fixture file.
type Database={url:string;serviceKey:string}
type Job={root:string;projectId:string;ownerId:string;database?:Database;run:Run;body:unknown;
  fault?:'reserved-crash'|'quiesced-crash'|'lost-settlement-response'|'lost-reservation-response';startAt?:number}
const storeFor=(job:Pick<Job,'root'|'database'>):WorkflowStore=>job.database
  ?createRemoteWorkflowStore({...job.database,fetchImpl:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})})
  :createLocalWorkflowStore(join(job.root,'.beegame/test-store'))
const sessionsFor=(root:string)=>new BeeGameSessionManager({async start(){throw Error('No model permitted in source-edit acceptance')}},
  join(root,'.beegame/test-sessions'),async()=>({}),{},true)
async function worker(job:Job) {
  const root=await realpath(job.root)
  if(dirname(root)!==await realpath(tmpdir()) || !basename(root).startsWith('bgs-v3-edit-fault-') ||
    !job.projectId.startsWith('v3-edit-fault-') || job.run.workspacePath!==root)
    throw Error('Only this retained synthetic temporary fixture may be edited')
  const base=storeFor(job),sessions=sessionsFor(root)
  const store:WorkflowStore={read:base.read,async commit(...args){
    await base.commit(...args)
    if(job.fault==='lost-settlement-response' && args[4]==='source-edit.settled')
      throw Error('Synthetic committed response lost')
    if(job.fault==='lost-reservation-response' && args[4]==='source-edit.reserved')
      throw Error('Synthetic reservation response lost before any filesystem operation')
    if(job.fault==='reserved-crash' && args[4]==='source-edit.reserved' ||
        job.fault==='quiesced-crash' && args[4]==='writer.quiesced') {
      console.log(JSON.stringify({checkpoint:args[4],pid:process.pid}))
      await new Promise(()=>{}) // Parent kills this exact child after persisted checkpoint.
    }
  }}
  const executor=createV3Executor({store,sessions})
  await Bun.sleep(Math.max(0,(job.startAt??0)-Date.now()))
  try {
    const saved=await executor.edit(job.run,job.body)
    console.log(JSON.stringify({ok:true,pid:process.pid,replayed:saved.replayed??false}))
  }catch(e){console.log(JSON.stringify({ok:false,pid:process.pid,code:e instanceof WorkflowError?e.code:'synthetic-response-lost'}))}
  finally{await executor.dispose();await sessions.dispose()}
}
export async function verifySourceEditFaults(input:{database?:Database;ownerId:string;
  provision?:(projectId:string,root:string)=>Promise<void>}) {
  const fixtures:Array<{projectId:string;root:string;scenario:string;writerUnresolved:boolean}>=[],passed:string[]=[]
  const check=(truth:unknown,name:string)=>{assert.ok(truth,name);passed.push(name)}
  // The local store explicitly supports one process only. Cross-process CAS
  // belongs to the actual remote RPC test, not this development backend.
  const scenarios=input.database?['race','lost-settlement-response','lost-reservation-response','quiesced-crash','reserved-crash'] as const:
    ['lost-settlement-response','lost-reservation-response','quiesced-crash','reserved-crash'] as const
  for(const scenario of scenarios) {
    const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-edit-fault-'))),projectId='v3-edit-fault-'+randomUUID()
    const fixture={projectId,root,scenario,writerUnresolved:false};fixtures.push(fixture)
    // Retain exact roots even on assertion failure; never lose unresolved evidence.
    console.log(JSON.stringify({fixture,synthetic:true,modelCalls:0}))
    for(const dir of ['content/ui','content/scenes'])await mkdir(join(root,dir),{recursive:true})
    const original=Buffer.from(JSON.stringify(uiLayoutFixture())),scene=Buffer.from(JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(root,'content/ui/menu.json'),original);await writeFile(join(root,'content/scenes/level.json'),scene)
    await writeFile(join(root,'notes.json'),'Synthetic independent evidence\n')
    await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fault-fixture',dimension:'2d',
      documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',
      files:['ui/menu.json','scenes/level.json'],documents:[{path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},
        {path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
    await input.provision?.(projectId,root)
    let run=createRun({projectId,ownerId:input.ownerId,workspacePath:root,chatSessionId:'synthetic-edit-'+randomUUID(),
      requestKey:'fixture-create',text:'Synthetic edit faults only, not a game or technical-route decision',constraints:{},ids:['fixture']})
    run.agentTurns=[]
    const store=storeFor({root,database:input.database});await store.commit(projectId,input.ownerId,0,run,'synthetic.created')
    const document=JSON.parse(original.toString());document.data.nodes.find((n:{id:string})=>n.id==='play').layout.size[1]=64
    const body={path:'ui/menu.json',expectedRevision:digest(original),document,requestKey:'synthetic-save',
      workflow:{version:run.version,planRevision:0,requirementsRevision:run.requirements.revision}}
    const job:Job={root,projectId,ownerId:input.ownerId,database:input.database,run,body,startAt:Date.now()+250,
      ...(scenario==='race'?{}:{fault:scenario})}
    const spawn=(value:Job)=>Bun.spawn([process.execPath,import.meta.path,'--worker'],{
      stdin:new TextEncoder().encode(JSON.stringify(value)),stdout:'pipe',stderr:'pipe'})
    const children=scenario==='race'?[spawn(job),spawn({...job,body:{...body,requestKey:'synthetic-racing-save'}})]:[spawn(job)]
    const killTimeout=setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL')},30000)
    const sessions=sessionsFor(root),executor=createV3Executor({store,sessions})
    try {
      if(scenario.endsWith('crash')) {
        const child=children[0]!,reader=child.stdout.getReader(),chunk=await reader.read()
        assert.ok(chunk.value,'Child must report its persisted checkpoint before kill')
        const notice=JSON.parse(new TextDecoder().decode(chunk.value))
        check(notice.pid===child.pid && notice.checkpoint===(scenario==='reserved-crash'?'source-edit.reserved':'writer.quiesced'),scenario+': actual child checkpoint')
        child.kill('SIGKILL');await child.exited;reader.releaseLock()
      } else {
        const results=await Promise.all(children.map(async child=>{
          const [exit,out]=await Promise.all([child.exited,new Response(child.stdout).text()])
          assert.equal(exit,0,'Synthetic worker process must exit normally');return JSON.parse(out)
        }))
        if(scenario==='race') {
          check(new Set(results.map(r=>r.pid)).size===2,'race: independent processes')
          check(results.filter(r=>r.ok).length===1 && results.some(r=>r.code==='revision-conflict'),'race: one CAS winner, no losing write')
        }else check(results[0].ok===false,'lost response: caller cannot claim success')
      }
      run=(await store.read(projectId,input.ownerId))!
      check(run.sourceEdits?.length===1,scenario+': exactly one durable save reservation')
      const edit=run.sourceEdits![0]!
      if(scenario==='lost-reservation-response') {
        check(!run.writer && Boolean(edit.quiescedAt) && edit.sourceEdit.status==='failed',
          'lost reservation response: living original host records no-write exit instead of orphaning its writer')
        check((await readFile(join(root,'content/ui/menu.json'))).equals(original),'lost reservation response: no file write or automatic retry')
        check(run.blockedReason?.includes('before execution'),'lost reservation response: handoff reports actual failure, not a saved candidate')
        await assert.rejects(executor.edit(run,body),/historical\/failed/)
      } else if(scenario==='reserved-crash') {
        fixture.writerUnresolved=true
        await assert.rejects(executor.recover(run,{expectedVersion:run.version,attemptId:edit.attemptId,fence:edit.fence}),/quiescence/)
        await assert.rejects(executor.stop(run),/writer/)
        run=(await store.read(projectId,input.ownerId))!
        await assert.rejects(executor.resume(run),/writer/)
        check(Boolean(run.writer)&&Boolean(run.paused)&&!edit.quiescedAt,'reserved crash: pause retained; missing exit never unlocks')
        check((await readFile(join(root,'content/ui/menu.json'))).equals(original),'reserved crash: original source untouched')
      }else {
        check(Boolean(edit.quiescedAt),scenario+': save quiescence persisted')
        check((await readFile(join(root,edit.sourceEdit.archive))).equals(original),scenario+': exact prior source archived')
        check(digest(await readFile(join(root,'content/ui/menu.json')))===edit.sourceEdit.after,scenario+': saved bytes retained')
        if(scenario==='quiesced-crash') {
          run=await executor.recover(run,{expectedVersion:run.version,attemptId:edit.attemptId,fence:edit.fence})
          check(!run.writer && run.sourceEdits![0]!.sourceEdit.status==='failed','quiesced crash: recovery releases writer without accepting/retrying')
          await assert.rejects(executor.edit(run,body),/historical\/failed/)
        }else {
          check(!run.writer && edit.sourceEdit.status==='saved',scenario+': saved commit has no unresolved writer')
          const version=run.version
          // Use the winning request, not the losing race request.
          const result=await executor.edit(run,{...body,requestKey:edit.requestKey})
          check(result.replayed===true && (await store.read(projectId,input.ownerId))!.version===version,scenario+': explicit replay reads commit without another write')
        }
      }
      check((await readFile(join(root,'content/scenes/level.json'))).equals(scene),scenario+': unrelated scene unchanged')
      check(await readFile(join(root,'notes.json'),'utf8')==='Synthetic independent evidence\n',scenario+': unrelated notes unchanged')
      check(!run.deliveryEligible && !run.plans.length && !run.attempts.length && !Object.keys(run.tasks).length && !run.agentTurns!.length,
        scenario+': no model, Task, plan or game qualification')
    }finally{
      clearTimeout(killTimeout)
      for(const child of children)if(child.exitCode===null){child.kill('SIGKILL');await child.exited}
      await executor.dispose();await sessions.dispose()
    }
  }
  return {passed,fixtures,retained:true,modelCalls:0,limitations:[
    'Synthetic save faults only, not game quality, engine/paid external outcomes or a crash at every filesystem instruction.',
    'Reserved-crash fixture intentionally stays paused with unresolved writer; absence of a process does not fabricate durable exit evidence.']}
}
if(import.meta.main) {
  if(process.argv[2]==='--worker')await worker(JSON.parse(await Bun.stdin.text()))
  else {
    const args=process.argv.slice(2)
    if(args.length!==5 || args[0]!=='--apply' || args[1]!=='--env-file' || args[3]!=='--source-project')
      throw Error('Usage: bun scripts/verify-workflow-v3-source-edits.ts --apply --env-file PATH --source-project OWNED_ID')
    loadEnvFile(args[2]!)
    const database={url:process.env.BEEGAME_SUPABASE_URL!,serviceKey:process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY!}
    if(!database.url || !database.serviceKey)throw Error('Normal database configuration required')
    const rest=async(path:string,init:RequestInit={})=>{
      const r=await fetch(database.url.replace(/\/+$/,'')+'/rest/v1/'+path,{...init,headers:{apikey:database.serviceKey,
        authorization:'Bearer '+database.serviceKey,'content-type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)})
      if(!r.ok)throw Error('Synthetic metadata request failed (HTTP '+r.status+')')
      return r.status===204?undefined:r.json()
    }
    const source=(await rest('beegame_projects?select=owner_id,workspace_id&id=eq.'+encodeURIComponent(args[4]!)))[0]
    if(!source)throw Error('Source project metadata unavailable; no fixture provisioned')
    console.log(JSON.stringify(await verifySourceEditFaults({database,ownerId:source.owner_id,provision:async(id,root)=>{
      await rest('beegame_projects',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id,
        owner_id:source.owner_id,workspace_id:source.workspace_id,root_path:root,name:'Synthetic V3 source-edit fault acceptance'})})
    }}),null,2))
  }
}
