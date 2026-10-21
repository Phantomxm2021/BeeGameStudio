import assert from 'node:assert/strict'
import {mkdtemp,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {loadEnvFile} from './beegame-migration-cli'
import {createRemoteWorkflowStore,type WorkflowStore} from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import {createRun} from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import {createAgentGoalExecutor} from '../packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal'
import {BeeGameSessionManager} from '../packages/agent-workflow-server/src/beegame/session-manager'

// Explicit remote persistence acceptance only. Simulated native lifecycle;
// actual CLI/debug are separately covered by no-start-debug.test.ts. No model,
// schema/account changes, existing project artifacts or engine selection.
const args=process.argv.slice(2)
if(args.length!==5 || args[0]!=='--apply' || args[1]!=='--env-file' || args[3]!=='--source-project')
  throw Error('Usage: bun scripts/verify-workflow-v3-no-start.ts --apply --env-file PATH --source-project OWNED_ID')
loadEnvFile(args[2]!)
const config={url:process.env.BEEGAME_SUPABASE_URL!,serviceKey:process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY!}
if(!config.url || !config.serviceKey)throw Error('Normal database configuration required')
const rest=async(path:string,init:RequestInit={})=>{
  const r=await fetch(config.url.replace(/\/+$/,'')+'/rest/v1/'+path,{...init,headers:{apikey:config.serviceKey,
    authorization:'Bearer '+config.serviceKey,'content-type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)})
  if(!r.ok)throw Error('Synthetic metadata request failed (HTTP '+r.status+')')
  return r.status===204?undefined:r.json()
}
const source=(await rest('beegame_projects?select=owner_id,workspace_id&id=eq.'+encodeURIComponent(args[4]!)))[0]
if(!source)throw Error('Owned project metadata unavailable; no test records created')
const base=createRemoteWorkflowStore({...config,fetchImpl:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})})
const results:any[]=[]
for(const scenario of ['no-start','exit-write-outage'] as const) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-native-fault-db-'))),projectId='v3-native-fault-db-'+randomUUID()
  await rest('beegame_projects',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id:projectId,
    owner_id:source.owner_id,workspace_id:source.workspace_id,root_path:root,name:'Synthetic V3 native fault persistence only'})})
  console.log(JSON.stringify({fixtureProject:projectId,root,scenario,modelCalls:0,retained:true}))
  let starts=0,submissions=0,loseClaim=scenario==='no-start',exitOutage=scenario==='exit-write-outage',exitFailures=0
  const nativeId=randomUUID()
  const sessions=new BeeGameSessionManager({async start(input){
    assert.equal(await realpath(input.cwd),root);starts++;input.onNativeSessionId?.(nativeId)
    return {stop(){},async submit(turn){submissions++;await turn.onMessage({type:'result',subtype:'success',session_id:nativeId,
      result:'Synthetic persistence lifecycle only, not a game',usage:{input_tokens:0,output_tokens:0}} as any)}}
  }},join(root,'host'),async path=>({BEEGAME_CONFIG_DIR:path??join(root,'config')}),{},true)
  const chat=sessions.start({projectId,userId:source.owner_id,workspacePath:root,userDataRoot:join(root,'config')})
  const store:WorkflowStore={read:base.read,async commit(...values){
    if(exitOutage && values[4]==='agent.writer-quiesced'){exitFailures++;throw Error('Synthetic exit record unavailable')}
    await base.commit(...values)
    if(loseClaim && values[4]==='agent.turn-claimed'){loseClaim=false;throw Error('Synthetic committed claim response lost')}
  }}
  const executor=createAgentGoalExecutor({store,sessions}),other=createAgentGoalExecutor({store:base,sessions})
  try {
    let run=createRun({projectId,ownerId:source.owner_id,workspacePath:root,chatSessionId:chat.id,requestKey:'synthetic-original',
      text:JSON.stringify({kind:'confirmed_build_brief',idea:'Synthetic database fault acceptance only',settings:{},
        selected_option:{title:'Synthetic transport'},document_language:'en',game_user_visible_language:'en',
        agent_response_language:'en',resource_library_usage:'optional'}),constraints:{},ids:['goal']})
    run.agentTurns=[];await base.commit(projectId,source.owner_id,0,run,'synthetic.created')
    if(scenario==='no-start') {
      await assert.rejects(executor.start(run,{}),/response lost/)
      run=(await base.read(projectId,source.owner_id))!
      assert.equal(run.agentTurns![0]!.notStarted,true);assert.equal(run.writer,undefined);assert.equal(submissions,0)
      await executor.start(run,{});assert.equal(submissions,0)
      await executor.message(run,{requestKey:'synthetic-new-work',runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
        requirementsRevision:run.requirements.revision,intent:'work',text:'Explicit new synthetic work on current confirmed requirements.'},{})
      for(let i=0;i<100;i++){run=(await base.read(projectId,source.owner_id))!;if(!run.writer)break;await Bun.sleep(20)}
      assert.equal(run.writer,undefined);assert.equal(run.agentTurns![1]!.status,'ended',run.agentTurns![1]!.error);assert.equal(submissions,1)
      assert.equal(starts,1);assert.equal(run.requirementChanges,undefined)
    }else{
      await executor.start(run,{})
      for(let i=0;i<100;i++){run=(await base.read(projectId,source.owner_id))!;if(exitFailures && executor.writerLiveness(run)==='unknown')break;await Bun.sleep(20)}
      assert.ok(exitFailures);assert.equal(run.agentTurns![0]!.quiescedAt,undefined)
      assert.equal(await executor.recoveryEvidence(run),'original-host');assert.equal(await other.recoveryEvidence(run),'unavailable')
      const identity={expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence}
      await assert.rejects(other.recover(run,identity),/No durable native exit/)
      exitOutage=false;run=await executor.recover(run,identity)
      assert.equal(run.writer,undefined);assert.ok(run.agentTurns![0]!.quiescedAt)
      assert.equal(run.agentTurns![0]!.status,'interrupted');assert.equal(submissions,1)
    }
    assert.equal(run.deliveryEligible,false);assert.deepEqual(run.tasks,{});assert.deepEqual(run.plans,[])
    results.push({scenario,projectId,root,version:run.version,starts,simulatedNativeSubmissions:submissions,modelCalls:0,
      status:run.status,writer:'none',retained:true,passed:true})
  }finally{await executor.dispose();await other.dispose();await sessions.dispose()}
}
console.log(JSON.stringify({results,modelCalls:0,limits:['Real remote RPC and persisted records; native lifecycle simulated, no real model or game-quality acceptance.']},null,2))
