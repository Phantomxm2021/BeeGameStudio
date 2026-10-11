import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BeeGameSessionManager, type BeeGameSessionSubmitInput } from '../session-manager'
import { registerV3Routes } from './routes'
import { createLocalWorkflowStore, createRemoteWorkflowStore, assertCommit, type WorkflowStore } from './store'
import { createAgentGoalExecutor, agentGoalPrompt, agentMessagePrompt, agentProfessionalContext } from './agent-goal'
import { createRun, type Run } from './state'
import { openPreviewTestAccess } from '../preview-test-access'
import type { AgentPreviewAccess, AgentImageAccess } from './agent-tools'

test('image bridge binds real goal owner/project, never opens for discussion or duplicate intake',async()=>{
  const calls:any[]=[];let closes=0
  const f=await fixture('normal',false,undefined,undefined,value=>{
    calls.push(value);return {endpoint:'http://127.0.0.1:1/synthetic-image',instruction:'not a generation',
      close:async()=>{closes++}}
  })
  try {
    await f.call('/agent/goal','POST',f.body);let run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    expect(calls).toEqual([{user:{id:'owner',role:'owner'},projectId:'goal-project',workspacePath:f.root}])
    expect(closes).toBe(1)
    await f.call('/agent/goal','POST',f.body);expect(calls).toHaveLength(1)
    const make=(intent:string)=>({requestKey:intent,runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,intent,text:intent==='discuss'?'Explain current game':'Change a color'})
    await f.call('/agent/messages','POST',make('discuss'));run=await f.wait(r=>Boolean(r.agentTurns![1]?.finishedAt))
    expect(calls).toHaveLength(1)
    await f.call('/agent/messages','POST',make('change'));await f.wait(r=>Boolean(r.agentTurns![2]?.finishedAt))
    expect(calls).toHaveLength(2);expect(closes).toBe(2)
  }finally{await f.close()}
})


async function fixture(mode:'normal'|'fail'|'wait'='normal',failSettlement=false,resourceLibraryBaseUrl?:string,
  openAgentPreview?:(value:any)=>AgentPreviewAccess,openAgentImage?:(value:any)=>AgentImageAccess) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-goal-unit-')))
  const local=createLocalWorkflowStore(join(root,'host')), submissions:BeeGameSessionSubmitInput[]=[]
  const store:WorkflowStore={read:local.read,commit:async(...args)=>{
    if(failSettlement && args[4]==='agent.turn-settled') throw new Error('Synthetic settlement outage')
    await local.commit(...args)
  }}
  const starts:any[]=[]
  const sessions=new BeeGameSessionManager({async start(input){starts.push(input);input.onNativeSessionId?.('11111111-2222-4333-8444-555555555555');return {
    async submit(input) {
      submissions.push(input)
      await writeFile(join(root,'candidate.txt'),'Synthetic partial candidate')
      if(mode==='wait') await new Promise<void>(resolve=>{
        if(input.signal.aborted)resolve();else input.signal.addEventListener('abort',()=>resolve(),{once:true})
      })
      if(mode==='fail')throw new Error('Synthetic native failure')
      await input.onMessage({type:'result',subtype:'success',session_id:'11111111-2222-4333-8444-555555555555',
        total_cost_usd:0,usage:{input_tokens:40,output_tokens:8},modelUsage:{synthetic:{inputTokens:40,outputTokens:8}},result:'Synthetic end, not game acceptance'} as any)
    },stop(){},
  }}},join(root,'native'),async userDataRoot=>({BEEGAME_CONFIG_DIR:userDataRoot ?? join(root,'wrong-shared-config')}),{},true)
  const userDataRoot=join(root,'owner-config')
  const chat=sessions.start({workspacePath:root,projectId:'goal-project',userId:'owner',userDataRoot})
  let persistFails=false, owner='owner'
  const app=new Hono(),cleanup:(()=>Promise<void>)[]=[]
  registerV3Routes(app,{store,sessions,getUser:()=>({id:owner,role:'owner'}),
    resourceLibraryBaseUrl,
    openAgentPreview,
    openAgentImage,
    getProject:async(_r,u)=>u.id==='owner'?{id:'goal-project',name:'Synthetic',root_path:root,created_at:0}:undefined,
    getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,getUserDataRoot:()=>userDataRoot,assertNoLegacyRun:async()=>{},
    persistMode:async()=>{if(persistFails)throw Error('Synthetic mode write failure')},readBody:r=>r.json(),registerCleanup:fn=>cleanup.push(fn)})
  const body={requestKey:'confirmed-goal-1',chatSessionId:chat.id,
    brief:{kind:'confirmed_build_brief',idea:'Synthetic goal; preserve chosen engine',selected_option:{title:'One choice',loop:'collect-return'},
      settings:{engine:'Unity',orientation:'Landscape'},document_language:'en',game_user_visible_language:'ja',
      agent_response_language:'zh',resource_library_usage:'optional'}}
  const call=(tail:string,method='GET',value?:unknown)=>app.request('/api/projects/goal-project/workflow-v3'+tail,{
    method,...(value?{headers:{'content-type':'application/json'},body:JSON.stringify(value)}:{})})
  const wait=async(check:(run:Run)=>boolean)=> {
    for(let i=0;i<300;i++){const run=await local.read('goal-project','owner');if(run && check(run))return run;await Bun.sleep(5)}
    throw Error('Synthetic goal did not settle: '+JSON.stringify(await local.read('goal-project','owner')))
  }
  return {root,store:local,sessions,submissions,starts,body,call,wait,setMode:(v:typeof mode)=>{mode=v},setOwner:(v:string)=>{owner=v},setPersistFailure:(v:boolean)=>{persistFails=v},
    close:async()=>{await Promise.all(cleanup.map(fn=>fn()));await sessions.dispose();await rm(root,{recursive:true,force:true})}}
}

test('whole goal enters normal native conversation without host Tasks, stage flags or automatic continuation',async()=>{
  const f=await fixture()
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(f.submissions).toHaveLength(1)
    const submit=f.submissions[0]!
    expect(submit.directionAuthors).toBeUndefined();expect(submit.projectTurn).toBeUndefined()
    expect(submit.language).toBe('zh')
    expect(submit.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(JSON.stringify(submit.prompt)).toContain('Plan and execute autonomously')
    expect(JSON.stringify(submit.prompt)).not.toContain('Professional coverage:')
    expect(f.starts[0].systemContext).toBe(agentProfessionalContext)
    expect(Array.isArray(submit.prompt)).toBe(true)
    expect((submit.prompt as {type:string;text:string}[])[0]!.text).toContain('Optional BGS project tools')
    expect((submit.prompt as {type:string;text:string}[]).at(-1)!.text).toContain(JSON.stringify(f.body.brief))
    expect(Object.keys(run.tasks)).toHaveLength(0);expect(run.plans).toEqual([]);expect(run.attempts).toEqual([])
    expect(run.agentTurns![0]).toMatchObject({sessionId:f.body.chatSessionId,status:'ended',
      usage:expect.objectContaining({prompt_tokens:40,completion_tokens:8})})
    expect(run.agentTurns![0]!.quiescedAt).toBeDefined();expect(run.writer).toBeUndefined();expect(run.deliveryEligible).toBe(false)
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202);expect(f.submissions).toHaveLength(1)
    expect((await f.call('/agent/goal','POST',reverseKeys(f.body))).status).toBe(202)
    expect(f.submissions).toHaveLength(1)
    expect((await f.call('/agent/goal','POST',{...f.body,brief:{...f.body.brief,idea:'different'}})).status).toBe(409)
    expect((await f.call('/plan','PUT',{})).status).toBe(409)
    const events=await (await f.call('/events')).json()
    expect(events.events.some((e:any)=>e.type==='turn.completed')).toBe(true)
    expect(events.events.every((e:any)=>!e.workflowExecution)).toBe(true)
    expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toBe('Synthetic partial candidate')
  }finally{await f.close()}
})
test('same-project discussion/change reuse native history; one CAS changes revision, duplicates never dispatch again',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const message=(key:string,intent:'discuss'|'change',text:string)=>({requestKey:key,runId:run.id,
      chatSessionId:run.chatSessionId,expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text})
    const original=structuredClone(run.requirements),discussion=message('discuss-1','discuss','Explain the existing rules; do not change them')
    expect((await f.call('/agent/messages','POST',discussion)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.requirements).toEqual(original);expect(run.requirementChanges).toBeUndefined()
    expect(f.starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(f.starts[1].env.BEEGAME_CONFIG_DIR).toBe(f.starts[0].env.BEEGAME_CONFIG_DIR)
    expect(JSON.stringify(f.submissions[1]!.prompt)).toContain('answer only')
    expect(JSON.stringify(f.submissions[1]!.prompt)).not.toContain('GDD.md')
    expect(f.starts[1].systemContext).toBeUndefined()
    const change=message('change-1','change','Change the target to four, preserve unrelated notes and rerun the rule test')
    const [a,b]=await Promise.all([f.call('/agent/messages','POST',change),f.call('/agent/messages','POST',change)])
    expect([a.status,b.status].sort()).toEqual(expect.arrayContaining([202]))
    expect([a.status,b.status].every(n=>n===202||n===409)).toBe(true)
    run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt))
    expect(run.requirements.revision).not.toBe(original.revision)
    expect(run.requirementChanges).toHaveLength(1);expect(run.requirementChanges![0]!.before).toEqual(original)
    expect(JSON.parse(run.requirements.text).authorized_user_changes).toEqual([{requestKey:'change-1',text:change.text}])
    expect(run.agentTurns![2]!.requirementsRevision).toBe(run.requirements.revision)
    expect(run.tasks).toEqual({});expect(run.plans).toEqual([]);expect(run.deliveryEligible).toBe(false)
    expect((await f.call('/agent/messages','POST',change)).status).toBe(202)
    expect((await f.call('/agent/messages','POST',{...change,text:'Another change'})).status).toBe(409)
    expect((await f.call('/agent/messages','POST',{...change,requestKey:'stale-change'})).status).toBe(409)
    expect((await f.call('/agent/messages','POST',{...message('wrong-chat','discuss','Question'),chatSessionId:'foreign'})).status).toBe(400)
    // Original intake stays idempotent even after requirement revisions.
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    expect(f.submissions).toHaveLength(3)
    expect(JSON.stringify(f.submissions[2]!.prompt)).toContain('only affected domains')
    expect(JSON.stringify(f.submissions[2]!.prompt)).not.toContain('Professional coverage:')
    expect(f.starts[2].systemContext).toBe(agentProfessionalContext)
    const edited=structuredClone(run);edited.version++;edited.agentTurns![2]!.message!.text='Rewritten authorization'
    expect(()=>assertCommit(run.projectId,run.ownerId,run.version,edited,run)).toThrow('history')
  }finally{await f.close()}
})

test('professional responsibilities stay complete in stable system context, not repeated in user history', () => {
  const run={requirements:{text:'ORIGINAL_CONFIRMED_GOAL'}} as Run
  const message={intent:'change',text:'Change only movement speed'} as Parameters<typeof agentMessagePrompt>[0]
  const prompts=[agentGoalPrompt(run),agentMessagePrompt(message),agentMessagePrompt({...message,intent:'continue'})]
  for(const prompt of [agentProfessionalContext]) {
    for(const name of ['GDD.md','TECHNICAL_DESIGN.md','ART_DIRECTION.md','AUDIO_DESIGN.md','UI_UX_SPEC.md',
      'LEVEL_SCENE_DESIGN.md','BALANCE_DESIGN.md','ASSET_PLAN.md']) expect(prompt).toContain(name)
    expect(prompt).toContain('not stages')
    expect(prompt).toContain('merged')
    expect(prompt).toContain('native Skill tool')
    expect(prompt).toContain('under docs/')
    expect(prompt).not.toContain('gameplay/GDD.md')
    expect(prompt).toContain('Preserve existing paths/references')
    expect(prompt).toContain('concrete decisions, reasons')
    expect(prompt).toContain('representative real game view')
    expect(prompt).toContain('React/Canvas does not waive')
    expect(prompt).toContain('actual runtime must consume the saved data')
    expect(prompt).toContain('Unity/Godot use native scene/UI data')
    expect(prompt).toContain('obtain migration authorization')
    expect(prompt).toContain('Missing services are not empty catalogs')
    expect(prompt).toContain('actual runtime')
    expect(prompt).toContain('unverified')
    expect(prompt).toContain('single source')
    expect(prompt).not.toContain('Review authority')
    expect(prompt).not.toContain('ask the reviewer')
    expect(prompt).toContain('before final measurement')
    expect(prompt).toContain('BGS does not reset the conversation')
  }
  for(const prompt of prompts)expect(prompt).not.toContain('Professional coverage:')
  expect(prompts[0]).toContain('ORIGINAL_CONFIRMED_GOAL')
  expect(prompts[1]).not.toContain('ORIGINAL_CONFIRMED_GOAL')
  expect(prompts[1]).toContain('only affected domains')
  expect(prompts[2]).toContain('Do not blindly replay')
  expect(agentMessagePrompt({...message,intent:'discuss'})).not.toContain('ASSET_PLAN.md')
  expect(agentMessagePrompt({...message,intent:'discuss'})).not.toContain('deliver editable')
})
test('pause persists; explicit resume does not execute, continuation must address the latest interrupted turn',async()=>{
  const f=await fixture('wait')
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>f.submissions.length===1)
    await f.call('/stop','POST');let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const msg=()=>({requestKey:'continue-1',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',
      text:'Inspect partial results and continue; do not replay unknown operations',continuationOf:run.agentTurns![0]!.attemptId})
    expect((await f.call('/agent/messages','POST',msg())).status).toBe(409)
    expect((await f.call('/resume','POST',{planRevision:run.planRevision})).status).toBe(200)
    expect(f.submissions).toHaveLength(1);run=(await f.store.read('goal-project','owner'))!
    expect((await f.call('/agent/messages','POST',{...msg(),continuationOf:'old-unrelated'})).status).toBe(400)
    f.setMode('normal');const continuation=msg()
    expect((await f.call('/agent/messages','POST',continuation)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.agentTurns![0]!.status).toBe('interrupted');expect(run.agentTurns![1]!.status).toBe('ended')
    expect(run.agentTurns![1]!.nativeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(run.requirementChanges).toBeUndefined();expect(run.deliveryEligible).toBe(false)
    expect((await f.call('/agent/messages','POST',continuation)).status).toBe(202)
    expect(f.submissions).toHaveLength(2)
    const invalid={...msg(),requestKey:'already-ended',continuationOf:run.agentTurns![1]!.attemptId}
    expect((await f.call('/agent/messages','POST',invalid)).status).toBe(400)
  }finally{await f.close()}
})
for(const historyState of ['missing','empty'] as const) test(historyState+' saved conversation blocks a follow-up before model dispatch or requirement mutation',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body);const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const metadata=f.sessions.metadata(run.chatSessionId)!
    if(historyState==='missing')await rm(metadata.transcriptPath)
    else await writeFile(metadata.transcriptPath,'')
    const result=await f.call('/agent/messages','POST',{requestKey:'missing-history',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'change',text:'Change the target'})
    expect(result.status).toBe(503);expect((await result.json()).code).toBe('conversation-unavailable')
    expect(f.submissions).toHaveLength(1);expect((await f.store.read(run.projectId,run.ownerId))!.requirements).toEqual(run.requirements)
  }finally{await f.close()}
})
test('reconstructed worker resumes persisted native UUID and pause intent without replaying the original goal',async()=>{
  const f=await fixture('wait'),starts:any[]=[],submissions:BeeGameSessionSubmitInput[]=[]
  const sessions=new BeeGameSessionManager({async start(input){starts.push(input);input.onNativeSessionId?.(input.resumeSessionId!);return {
    async submit(turn){submissions.push(turn);await turn.onMessage({type:'result',subtype:'success',session_id:input.resumeSessionId,
      total_cost_usd:0,usage:{input_tokens:5,output_tokens:2},result:'Synthetic resumed end'} as any)},stop(){},
  }}},join(f.root,'native'),async()=>({}),{},true)
  const executor=createAgentGoalExecutor({store:f.store,sessions})
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>f.submissions.length===1)
    await f.call('/stop','POST');let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const partial=await readFile(join(f.root,'candidate.txt'),'utf8'),interrupted=structuredClone(run.agentTurns![0]!)
    await f.sessions.dispose()
    sessions.start({workspacePath:f.root,projectId:run.projectId,userId:run.ownerId,transcriptSessionId:run.chatSessionId})
    const message=()=>({requestKey:'restart-continue',runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,intent:'continue' as const,text:'Inspect the saved partial file and continue',continuationOf:interrupted.attemptId})
    await expect(executor.message(run,message(),{})).rejects.toThrow('resume')
    expect(submissions).toHaveLength(0)
    run=(await executor.resume(run))!
    await executor.message(run,message(),{})
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(starts[0].resumeSessionId).toBe(interrupted.nativeSessionId)
    expect(run.agentTurns![0]).toEqual(interrupted)
    expect(run.agentTurns![1]!.nativeSessionId).toBe(interrupted.nativeSessionId)
    expect(JSON.stringify(submissions[0]!.prompt)).not.toContain('Develop the game from this complete confirmed goal')
    expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toBe(partial)
    expect(sessions.transcript(run.chatSessionId).some(e=>e.type==='user.message' && JSON.stringify(e).includes(f.body.brief.idea))).toBe(true)
  }finally{await executor.dispose();await sessions.dispose();await f.close()}
})
test('failed authorized change retains its requirement version and request identity; no implicit second execution',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body);let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const original=run.requirements.revision
    f.setMode('fail')
    const body={requestKey:'failing-change',runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:original,intent:'change',text:'Change only the target and verify it'}
    expect((await f.call('/agent/messages','POST',body)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.agentTurns![1]!.status).toBe('failed');expect(run.requirements.revision).not.toBe(original)
    expect(run.requirementChanges).toHaveLength(1);expect(run.deliveryEligible).toBe(false)
    expect((await f.call('/agent/messages','POST',body)).status).toBe(202)
    expect(f.submissions).toHaveLength(2)
  }finally{await f.close()}
})
test('missing input/foreign Chat/mode persistence failure cannot dispatch; identical retry only reconciles intake',async()=>{
  const f=await fixture()
  try {
    expect((await f.call('/agent/goal','POST',{...f.body,chatSessionId:'foreign'})).status).toBe(400)
    expect((await f.call('/agent/goal','POST',{...f.body,brief:{idea:'missing choices'}})).status).toBe(400)
    expect(f.submissions).toHaveLength(0)
    f.setPersistFailure(true);expect((await f.call('/agent/goal','POST',f.body)).status).toBe(500)
    expect(f.submissions).toHaveLength(0)
    f.setPersistFailure(false);expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt));expect(f.submissions).toHaveLength(1)
    f.setOwner('other');expect((await f.call('')).status).toBe(404)
  }finally{await f.close()}
})
test('native failure preserves partial output and never repeats model work or marks game accepted',async()=>{
  const f=await fixture('fail')
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.agentTurns![0]!.status).toBe('failed');expect(run.writer).toBeUndefined()
    expect(run.agentTurns![0]!.error).toBe('Synthetic native failure')
    expect(run.deliveryEligible).toBe(false);expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toContain('partial')
    await f.call('/agent/goal','POST',f.body);expect(f.submissions).toHaveLength(1)
  }finally{await f.close()}
})
test('pause cancels real turn; resume only clears user pause, never restarts work',async()=>{
  const f=await fixture('wait')
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>f.submissions.length===1)
    expect((await f.call('/stop','POST')).status).toBe(202)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.paused).toBeDefined();expect(run.agentTurns![0]!.status).toBe('interrupted')
    expect((await f.call('/resume','POST',{planRevision:0})).status).toBe(200)
    expect((await f.store.read('goal-project','owner'))!.paused).toBeUndefined()
    await f.call('/agent/goal','POST',f.body);expect(f.submissions).toHaveLength(1)
  }finally{await f.close()}
})
test('native pause/cleanup revokes resource access before releasing its workspace writer',async()=>{
  const f=await fixture('wait',false,'https://unused-library.invalid')
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>f.submissions.length===1)
    const context=(f.submissions[0]!.prompt as {text:string}[])[0]!.text
    const path=context.match(/Assets: bun "([^"]+)"/)![1]!
    const source=await readFile(join(f.root,path),'utf8')
    const config=JSON.parse(source.split('\n')[0]!.slice('const TOOL_CONFIG = '.length))
    const url=config.libraryBaseUrl+'/api/resource-search'
    expect((await fetch(url)).status).toBe(503) // no user token; upstream never called
    await f.call('/stop','POST');await f.wait(r=>Boolean(r.agentTurns![0]!.finishedAt))
    await expect(fetch(url)).rejects.toThrow()
    expect((await f.store.read('goal-project','owner'))!.writer).toBeUndefined()
  }finally{await f.close()}
})

test('Preview is bound by the route; discussion and duplicate intake never open it; pause drains before unlock',async()=>{
  const calls:any[]=[];let release!:()=>void,closing=false
  const drain=new Promise<void>(resolve=>{release=resolve})
  const f=await fixture('normal',false,undefined,value=>{
    calls.push(value)
    return openPreviewTestAccess({start:async()=>({status:'idle'}),status:()=>({status:'idle'}),stop(){},
      browser:{start:async()=>{throw Error('Unused')},status:()=>({status:'not-running'}),
        close:async()=>{closing=true;if(calls.length===2)await drain}}})
  })
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(calls[0]).toMatchObject({workspacePath:f.root,sessionId:run.chatSessionId,user:{id:'owner'}})
    await f.call('/agent/goal','POST',f.body);expect(calls).toHaveLength(1)
    const msg=(key:string,intent:'discuss'|'change')=>({requestKey:key,runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text:'Synthetic message'})
    await f.call('/agent/messages','POST',msg('discussion','discuss'))
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt));expect(calls).toHaveLength(1)
    closing=false;f.setMode('wait');await f.call('/agent/messages','POST',msg('change','change'))
    await f.wait(()=>f.submissions.length===3);await f.call('/stop','POST')
    await f.wait(()=>closing)
    expect((await f.store.read('goal-project','owner'))!.writer).toBeDefined()
    release();run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt))
    expect(run.writer).toBeUndefined();expect(run.agentTurns![2]!.status).toBe('interrupted')
    expect(calls).toHaveLength(2)
  }finally{release();await f.close()}
})
test('unknown goal writer needs actual exit evidence; reload cannot retry or erase history',async()=>{
  const f=await fixture('normal',true)
  const recovery=createAgentGoalExecutor({store:f.store,sessions:f.sessions})
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.quiescedAt))
    // Let failed settlement unwind; reload is not permission to rerun the native call.
    await Bun.sleep(20)
    expect(recovery.writerLiveness(run)).toBe('unknown')
    const identity={expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence}
    const noExit=structuredClone(run);delete noExit.agentTurns![0]!.quiescedAt
    expect(()=>assertCommit(run.projectId,run.ownerId,run.version,{...noExit,version:run.version+1},run)).toThrow('history')
    const fixed=await recovery.recover(run,identity)
    expect(fixed!.writer).toBeUndefined();expect(fixed!.agentTurns![0]!.status).toBe('interrupted')
    expect(f.submissions).toHaveLength(1);expect(fixed!.deliveryEligible).toBe(false)
    const before=structuredClone(fixed!);before.agentTurns![0]!.status='ended';before.version++
    expect(()=>assertCommit(run.projectId,run.ownerId,fixed!.version,before,fixed!)).toThrow('history')
  }finally{await recovery.dispose();await f.close()}
})

test('failed Preview cleanup cannot record a quiesced writer or accept another turn',async()=>{
  let closed=0
  const f=await fixture('normal',false,undefined,()=>openPreviewTestAccess({
    start:async()=>({status:'idle'}),status:()=>({status:'idle'}),stop(){},
    browser:{start:async()=>{throw Error('Unused')},status:()=>({status:'not-running'}),
      close:async()=>{closed++;throw Error('Synthetic browser exit unconfirmed')}},
  }))
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>closed===1)
    await Bun.sleep(20)
    const run=(await f.store.read('goal-project','owner'))!
    expect(run.writer).toBeDefined();expect(run.agentTurns![0]!.quiescedAt).toBeUndefined()
    expect(run.agentTurns![0]!.finishedAt).toBeUndefined()
    expect(run.deliveryEligible).toBe(false)
  }finally{await f.close()}
})

test('failed preparation cannot lose an opened image capability or claim an unconfirmed writer exit',async()=>{
  let closes=0
  const f=await fixture('normal',false,undefined,()=>{throw Error('Synthetic preparation failure after opening image bridge')},()=>({
    endpoint:'http://127.0.0.1:1/synthetic',instruction:'not a generation',
    close:async()=>{closes++;throw Error('Synthetic in-flight image outcome unconfirmed')},
  }))
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>closes>0);await Bun.sleep(30)
    const run=(await f.store.read('goal-project','owner'))!
    expect(run.writer).toBeDefined();expect(run.agentTurns![0]!.quiescedAt).toBeUndefined()
    expect(run.agentTurns![0]!.finishedAt).toBeUndefined();expect(f.submissions).toHaveLength(0)
  }finally{await f.close()}
})

test('remote store also compares saved native history before submitting a new version to CAS',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    const saved=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt));let commits=0,current=reverseKeys(saved)
    const remote=createRemoteWorkflowStore({url:'https://synthetic-db.invalid',serviceKey:'synthetic-host-key',
      fetchImpl:async(url,input)=>{
        if(String(url).endsWith('/beegame_workflow_v3_read'))return Response.json(current)
        commits++;current=JSON.parse(String(input!.body)).p_state;return Response.json(current)
      }})
    const forged=structuredClone(saved);forged.version++;forged.agentTurns![0]!.usage={prompt_tokens:0,completion_tokens:0,total_tokens:0}
    await expect(remote.commit(saved.projectId,saved.ownerId,saved.version,forged,'agent.turn-rewrite')).rejects.toThrow('history')
    expect(commits).toBe(0)
    const paused=structuredClone(saved);paused.version++;paused.paused={at:new Date().toISOString()}
    await remote.commit(saved.projectId,saved.ownerId,saved.version,paused,'user.paused');expect(commits).toBe(1)
    await expect(remote.commit(saved.projectId,saved.ownerId,saved.version,paused,'user.paused')).rejects.toThrow('revision')
    expect(commits).toBe(1)
  }finally{await f.close()}
})
function reverseKeys(value:any):any {
  if(Array.isArray(value))return value.map(reverseKeys)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverseKeys(v)]))
  return value
}
test('a repeated native message survives database-style key reordering without a new model dispatch',async()=>{
  const f=await fixture(),executor=createAgentGoalExecutor({store:f.store,sessions:f.sessions})
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const message={requestKey:'db-order-message',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'discuss' as const,text:'Synthetic discussion'}
    await f.call('/agent/messages','POST',message)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    const duplicate=await executor.message(reverseKeys(run),message,{})
    expect(duplicate.attemptId).toBe(run.agentTurns![1]!.attemptId)
    expect(f.submissions).toHaveLength(2)
  }finally{await executor.dispose();await f.close()}
})
test('concurrent identical intake has one writer and one native turn, not two goal executions',async()=>{
  const f=await fixture('wait')
  try {
    const responses=await Promise.all([f.call('/agent/goal','POST',f.body),f.call('/agent/goal','POST',f.body)])
    expect(responses.some(r=>r.status===202)).toBe(true)
    expect(responses.every(r=>[202,409].includes(r.status))).toBe(true)
    await f.wait(()=>f.submissions.length===1)
    expect((await f.store.read('goal-project','owner'))!.agentTurns).toHaveLength(1)
    await f.call('/stop','POST');await f.wait(r=>Boolean(r.agentTurns![0]!.finishedAt))
    expect(f.submissions).toHaveLength(1)
  }finally{await f.close()}
})
test('a reconstructed worker cannot unlock a goal writer without recorded native exit',async()=>{
  const f=await fixture('wait')
  const unknownSessions=new BeeGameSessionManager({async start(){throw Error('No model allowed')}},join(f.root,'unknown'),async()=>({}),{},true)
  const recovery=createAgentGoalExecutor({store:f.store,sessions:unknownSessions})
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(()=>f.submissions.length===1)
    await expect(recovery.recover(run,{expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence}))
      .rejects.toThrow('No durable native exit')
    expect(f.submissions).toHaveLength(1);expect((await f.store.read('goal-project','owner'))!.writer).toEqual(run.writer)
  }finally{await recovery.dispose();await unknownSessions.dispose();await f.close()}
})
test('pause survives a simultaneous saved exit; rebasing does not execute a model',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-goal-pause-race-')))
  const base=createLocalWorkflowStore(join(root,'host'))
  const sessions=new BeeGameSessionManager({async start(){throw Error('No model allowed')}},join(root,'native'),async()=>({}),{},true)
  let raced=false
  const store:WorkflowStore={read:base.read,async commit(p,a,v,next,event){
    if(event==='agent.run-paused' && !raced) {
      raced=true
      const current=(await base.read(p,a))!,changed=structuredClone(current)
      changed.version++;changed.agentTurns![0]!.quiescedAt=new Date().toISOString()
      await base.commit(p,a,current.version,changed,'agent.writer-quiesced')
    }
    await base.commit(p,a,v,next,event)
  }}
  const executor=createAgentGoalExecutor({store,sessions})
  try {
    const run=createRun({projectId:'race',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'once',text:'Synthetic',constraints:{},ids:['goal']})
    run.agentTurns=[];await base.commit('race','owner',0,run,'created')
    const claimed=structuredClone(run);claimed.version++;claimed.fence++
    claimed.agentTurns!.push({attemptId:'old',requestKey:'once',sessionId:'chat',workerId:'old-host',fence:1,status:'running',startedAt:new Date().toISOString()})
    claimed.writer={attemptId:'old',workerId:'old-host',fence:1}
    await base.commit('race','owner',run.version,claimed,'claimed')
    const paused=await executor.stop(claimed)
    expect(paused!.paused).toBeDefined();expect(paused!.writer).toEqual(claimed.writer)
    expect(paused!.agentTurns![0]!.quiescedAt).toBeDefined()
    expect(paused!.agentTurns).toHaveLength(1)
  }finally{await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})
