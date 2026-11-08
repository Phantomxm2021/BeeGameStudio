import { produceResources } from '../resource-production'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { createHash } from 'node:crypto'
import { BeeGamePreviewManager } from '../preview-manager'
import { resolve } from 'node:path'
import { initializeProjectRepository } from '../../local-runtime-service'
import { ProductionBlockedError } from '../production-blocked'
import { test, expect, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BeeGameSessionManager, type BeeGameSessionSubmitInput } from '../session-manager'
import { registerV3Routes } from './routes'
import { createLocalWorkflowStore, createRemoteWorkflowStore, assertCommit, type WorkflowStore } from './store'
import { createAgentGoalExecutor, agentGoalPrompt, agentMessagePrompt, agentProfessionalContextForRun, focusedExecutionFacts } from './agent-goal'
import { createRun, digest, type Run } from './state'
import { PRODUCTION_WORKFLOW_GUIDANCE, DESIGN_DECISION_SCOPE } from './production-workflow'
import type { AgentImageAccess } from './agent-tools'
import { initializeProjectGuide, PROJECT_WORKING_CONVENTIONS } from './project-guide'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'
import { DESIGN_ACCEPTANCE_PATH } from '../design-handoff'
import { readContentView } from './content-view'
import { createV3Executor } from './execution'
import { projectPreviewCapabilityPath } from '../project-preview-capability'

async function recordSyntheticDesignReview(input: BeeGameSessionSubmitInput) {
  const review = input.finalOutput!.designReview!
  const {source} = await review.candidate({status:'ready',summary:'Synthetic candidate'})
  await review.record({source,nativeThreadId:'synthetic-reviewer',nativeTurnId:'synthetic-review-turn',
    startedAt:'2026-01-01T00:00:00.000Z',finishedAt:'2026-01-01T00:00:01.000Z',
    report:{summary:'Synthetic independent report',findings:[]}})
}

test('retired visual saves reject without mutation while authorized later work preserves requirements',async()=>{
  const f=await fixture('wait'),editor=createV3Executor({store:f.store,sessions:f.sessions})
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>f.submissions.length===1)
    await writeDesignDocumentsFixture(f.root)
    await writeFile(join(f.root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',entryScene:'level',
      files:['ui/menu.json','scenes/level.json'],documents:[{id:'menu',path:'ui/menu.json',kind:'ui-screen',loadPhase:'startup'},{id:'level',path:'scenes/level.json',kind:'scene-2d',loadPhase:'startup'}]}))
    run=(await f.store.read(run.projectId,run.ownerId))!
    const originalRequirements=structuredClone(run.requirements)
    f.setMode('normal')
    await f.call('/stop','POST')
    run=await f.wait(r=>!r.writer)
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    const view=await readContentView(f.root)
    if(view.state!=='draft')throw Error('Fixture UI missing')
    const entry=view.documents.find(doc=>doc.path==='ui/menu.json')!
    if(!('document' in entry)||!entry.document)throw Error('Fixture document missing')
    const document=structuredClone(entry.document) as any
    document.data.nodes[1].layout.size[1]=64
    const originalDocument=await readFile(join(f.root,'content/ui/menu.json'),'utf8')
    await expect(editor.edit(run,{path:'ui/menu.json',expectedRevision:entry.revision,document,requestKey:'exact-save',
      workflow:{version:run.version,planRevision:run.planRevision,requirementsRevision:run.requirements.revision}})).rejects.toMatchObject({code:'editor-unavailable',status:409})
    expect(await readFile(join(f.root,'content/ui/menu.json'),'utf8')).toBe(originalDocument)
    expect(await f.store.read(run.projectId,run.ownerId)).toEqual(run)
    run=(await f.store.read(run.projectId,run.ownerId))!
    expect(run.designBaseline).toBeUndefined()
    expect(run.requirements).toEqual(originalRequirements)
    for(const intent of ['work','message','change'] as const) {
      const response=await f.call('/agent/messages','POST',{requestKey:intent,runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text:intent==='change'?'Explicitly revise the requested design':'Inspect or implement the existing design'})
      expect(response.status,await response.clone().text()).toBe(202)
      run=await f.wait(r=>Boolean(r.agentTurns!.at(-1)?.finishedAt)&&r.agentTurns!.at(-1)?.requestKey===intent)
      expect(run.designBaseline).toBeUndefined()
    }
    expect(run.requirementChanges?.at(-1)?.after.text).toContain('Explicitly revise the requested design')
  }finally{await editor.dispose();await f.close()}
},30000)

test('resource context preserves source preferences and authorization without a sourcing tour', () => {
  for (const prompt of [agentProfessionalContextForRun({} as Run), agentProfessionalContextForRun({} as Run, true)]) {
    expect(prompt).not.toContain('purpose: production')
    expect(prompt).not.toContain('file_paths')
    expect(prompt).not.toContain('local_path')
    expect(prompt).toContain('required licenses')
    expect(prompt).not.toContain('Default sourcing order')
    expect(prompt).toContain('resource-library preferences')
    expect(prompt).not.toContain('Resource-library usage optional permits other artwork sources')
    expect(prompt).not.toContain('absence of user-named asset files')
    expect(prompt).not.toContain('actual source findings and current tool capabilities')
    expect(prompt).not.toContain('not untested assumptions that generation is risky or slow')
    expect(prompt).not.toContain('Resource-library usage governs library sourcing')
    expect(prompt).not.toMatch(/gpt-image|image2\.5|must generate/i)
    expect(prompt).not.toContain('Failed sourcing does not authorize changing those requirements')
    expect(prompt).toContain('usage rights')
    expect(prompt).not.toContain('For paid generation')
    expect(prompt).not.toContain('quote and submission contract')
    expect(prompt).not.toContain('including model work')
    expect(prompt).not.toContain('Compare production cost')
    expect(prompt).not.toContain('per-image approval')
    expect(prompt).not.toContain('automatic paid retry')
    expect(prompt).not.toContain('fixed-order shelf packer')
    expect(prompt).not.toContain('Run assets.mjs ui-board-plan')
  }
})

test('task-specific countdown procedure stays in tool help instead of the universal production context', () => {
  expect(PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run)).not.toContain('--countdown-blur-sample')
  expect(PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run)).not.toContain('a screenshot does not verify motion or interaction')
  expect(PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run)).not.toContain('## Required design dependencies')
})

test('ended native goal exposes independent host evidence, never author acceptance',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt) &&
      f.sessions.transcript(r.chatSessionId).some(e=>e.payload?.subtype==='host_evidence'))
    const events=f.sessions.transcript(run.chatSessionId)
    const host=events.find(event=>event.payload?.subtype==='host_evidence')!
    expect(host).toBeDefined()
    expect(host.type).toBe('system.status')
    expect(host.payload).toMatchObject({execution:'ended',quality:'unverified',deliveryEligible:false})
    expect(host.payload).not.toHaveProperty('checkStatuses')
    expect(host.text).not.toContain('audio-data-consumption')
    expect(host.text).not.toContain('runtime-smoke')
    expect(host.turnId).toBe(run.agentTurns![0]!.turnId)
    expect(run.deliveryEligible).toBe(false)
    expect(run.status).toBe('completed')
    const facts={attemptId:'synthetic-report',execution:'ended',note:'Only saved host facts, not 0-assertion author report'}
    f.sessions.recordHostEvidence(run.chatSessionId,facts)
    f.sessions.recordHostEvidence(run.chatSessionId,facts)
    const evidence=f.sessions.transcript(run.chatSessionId).filter(event=>event.payload?.attemptId==='synthetic-report')
    expect(evidence).toHaveLength(1)
    expect(evidence[0]!.payload).toMatchObject({quality:'unverified',deliveryEligible:false})
    expect(evidence[0]!.text).not.toContain('audio-data-consumption')
  } finally {await f.close()}
})

test('image bridge binds real goal owner/project and never opens for duplicate intake',async()=>{
  const calls:any[]=[];let closes=0
  const f=await fixture('normal',false,undefined,value=>{
    calls.push(value);return {fetch: (request:Request) => fetch(new Request('http://127.0.0.1:1/synthetic-image', request)),instruction:'not a generation',
      close:async()=>{closes++}}
  },0,{},undefined,false,async root=>{
    const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(root,f.body.chatSessionId),'utf8'))
    expect((await fetch(capability.assets.imageEndpoint)).status).toBe(409) // Deliberately offline image backend.
  })
  try {
    await f.call('/agent/goal','POST',f.body);let run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    expect(calls).toEqual([{user:{id:'owner',role:'owner'},projectId:'goal-project',workspacePath:f.root,
      visualHandoffVersion:1,screenOrientation:'Landscape',requireGdd:false,
      confirmedRequirements:run.requirements.text,sessionId:run.chatSessionId,modelConfigId:undefined,request:expect.any(Request)}])
    expect(calls[0].request.method).toBe('POST')
    expect(new URL(calls[0].request.url).pathname).toEndWith('/agent/goal')
    expect(closes).toBe(1)
    await f.call('/agent/goal','POST',f.body);expect(calls).toHaveLength(1)
    const make=(intent:string)=>({requestKey:intent,runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,intent,text:'Change a color'})
    await f.call('/agent/messages','POST',make('change'));await f.wait(r=>Boolean(r.agentTurns![1]?.finishedAt))
    expect(calls).toHaveLength(2);expect(calls[1].visualHandoffVersion).toBe(1);expect(closes).toBe(2)
  }finally{await f.close()}
})

test('ordinary Chat preserves discussion text and rejects the retired discuss mode without dispatch',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const message={
      requestKey:'ordinary-chat-1',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,
      text:'Which checks passed? Do not change files.',
    }
    expect((await f.call('/agent/messages','POST',{...message,intent:'discuss'})).status).toBe(400)
    expect(f.submissions).toHaveLength(1)
    expect((await f.store.read(run.projectId,run.ownerId))?.version).toBe(run.version)
    const response=await f.call('/agent/messages','POST',message)
    expect(response.status).toBe(202)
    const after=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(after.requirementChanges).toBeUndefined()
    expect(after.requirements).toEqual(run.requirements)
    expect(after.planRevision).toBe(run.planRevision)
    expect(after.agentTurns?.[1]?.message?.intent).toBe('message')
    expect(f.submissions[1]!.prompt).toBe('User message:\n'+message.text)
    expect(f.starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(f.starts[1].systemContext).toContain('no additional implementation handoff is required')
    expect(f.starts[1].systemContext).not.toContain('end this turn; BGS continues')
    expect(f.events.filter(event=>event==='requirements.changed')).toHaveLength(0)
  }finally{await f.close()}
})


async function fixture(mode:'normal'|'fail'|'wait'='normal',failSettlement=false,resourceLibraryBaseUrl?:string,
  openAgentImage?:(value:any)=>AgentImageAccess, extraEvents=0,
  faults:{startupFailure?:boolean;afterSettlement?:()=>Promise<void>;claimResponses?:number;exitWrites?:boolean;exitFailures?:number;missingEntrySkill?:boolean;nativeGoalStatus?:'active'|'complete'|'blocked'|'budgetLimited';nativeGoalBudget?:number|null;pauseTokens?:number;pauseUnavailable?:boolean;noAssistant?:boolean;omitVerificationResult?:boolean}={},libraryAuthToken?:string,blankProject=false, onSubmit?:(root:string,input:BeeGameSessionSubmitInput,context:string)=>Promise<void>, developmentPreview?:()=>BeeGamePreviewManager) {
  const container=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-goal-unit-')))
  const root=join(container,'project')
  await mkdir(root)
  // Production host state lives outside project sources. Keep the existing
  // nonblank fixture explicit rather than relying on nested host directories.
  if(!blankProject)await writeFile(join(root,'existing.txt'),'Existing fixture project')
  const local=createLocalWorkflowStore(join(container,'host')), submissions:BeeGameSessionSubmitInput[]=[], events:string[]=[]
  const store:WorkflowStore={read:local.read,commit:async(...args)=>{
    if(failSettlement && args[4]==='agent.turn-settled') throw new Error('Synthetic settlement outage')
    if(faults.exitWrites && args[4]==='agent.writer-quiesced'){faults.exitFailures=(faults.exitFailures??0)+1;throw Error('Synthetic exit persistence outage')}
    await local.commit(...args)
    events.push(args[4])
    if(args[4]==='agent.turn-settled')await faults.afterSettlement?.()
    if((faults.claimResponses??0)>0 && ['agent.turn-claimed','requirements.changed'].includes(args[4])) {
      faults.claimResponses!--;throw Error('Synthetic committed claim response lost')
    }
  }}
  const starts:any[]=[]
  const sessions=new BeeGameSessionManager({async start(input){starts.push(input);const nativeId=input.resumeSessionId??(starts.length===1?'11111111':String(starts.length).padStart(8,'0'))+'-2222-4333-8444-555555555555';input.onNativeSessionId?.(nativeId);if(faults.startupFailure && (!input.finalOutput || input.finalOutput.designReview && !input.finalOutput.readOnly))throw Error('Synthetic runner startup failed');const onNativeUsage=input.onNativeUsage;let currentInput:BeeGameSessionSubmitInput|undefined;let terminalStatus:string|undefined;return {
    async completeGoal(status:'complete'|'blocked'='complete') {
      terminalStatus=status
      await currentInput!.onMessage({type:'runtime_event',runtime:'bgs',eventType:'system.status',subtype:'native_goal',threadId:nativeId,
        nativeGoal:{status,objective:'Synthetic original assignment',tokenBudget:null,tokensUsed:48,timeUsedSeconds:1}})
    },
    async submit(input) {
      currentInput=input;submissions.push(input)
      const goalEvent=async(status:string,tokensUsed=48)=>input.onMessage({type:'runtime_event',runtime:'bgs',eventType:'system.status',
        subtype:'native_goal',threadId:nativeId,nativeGoal:{status,objective:'Synthetic original assignment',tokenBudget:faults.nativeGoalBudget??null,tokensUsed,timeUsedSeconds:1}})
      if(faults.nativeGoalStatus && input.nativeGoal)
        await goalEvent('active',faults.pauseUnavailable ? faults.pauseTokens : undefined)
      const prompt = typeof input.prompt === 'string' ? input.prompt : ''
      if (prompt.startsWith('/bgs-builtins:') && !faults.missingEntrySkill) await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'system.status', text: 'Loaded entry skill', skill: {name:prompt.slice(1,prompt.indexOf(' ')),messageId:'entry-body',source:'command',status:'loaded'} })
      await writeFile(join(root,'candidate.txt'),'Synthetic partial candidate')
      await onSubmit?.(root,input,String(starts.at(-1).systemContext))
      if(input.finalOutput?.schema.properties &&
          (input.finalOutput.schema.properties as any).observations?.type==='array' && !input.signal.aborted && mode==='normal' && !faults.omitVerificationResult) {
        const current=await local.read('goal-project','owner')
        if(!current!.agentTurns!.at(-1)!.implementationVerification)
          await input.finalOutput.accept({summary:'Synthetic required checks observed through current input',observations:[{outcome:'Required player action',status:'passed',evidence:'Delivered input produced the required outcome'}]})
      }
      for(let i=0;i<extraEvents;i++)await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic audit event ' + i, assistantBlockId: 'synthetic-' + i })
      if(mode==='wait') await new Promise<void>(resolve=>{
        if(input.signal.aborted)resolve();else input.signal.addEventListener('abort',()=>resolve(),{once:true})
      })
      if(!terminalStatus && faults.nativeGoalStatus && input.nativeGoal)await goalEvent(input.signal.aborted && !faults.pauseUnavailable ? 'paused' : faults.nativeGoalStatus, input.signal.aborted ? faults.pauseTokens : undefined)
      if(mode==='fail')throw new Error('Synthetic native failure')
      onNativeUsage?.({prompt_tokens:40,completion_tokens:8,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:48})
      if(!faults.noAssistant)await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic end, not game acceptance' })
    },stop(){},
  }}},join(container,'native'),async userDataRoot=>({BEEGAME_CONFIG_DIR:userDataRoot ?? join(root,'wrong-shared-config')}),{},true)
  const userDataRoot=join(root,'owner-config')
  const chat=sessions.start({workspacePath:root,projectId:'goal-project',userId:'owner',userDataRoot})
  let persistFails=false, owner='owner'
  const app=new Hono(),cleanup:(()=>Promise<void>)[]=[]
  registerV3Routes(app,{store,sessions,getUser:()=>({id:owner,role:'owner'}),
    resourceLibraryBaseUrl,
    developmentPreview,
    openAgentImage,
    getProject:async(_r,u)=>u.id==='owner'?{id:'goal-project',name:'Synthetic',root_path:root,created_at:0}:undefined,
    getAuthToken:()=>libraryAuthToken,getValidAuthToken:()=>undefined,getUserDataRoot:()=>userDataRoot,assertNoLegacyRun:async()=>{},
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
  // An old Goal is established through the real session/transcript path, not
  // inferred from a new task or forced into the current workflow dispatcher.
  const seedHistoricalGoal=async()=>{
    expect(await local.read('goal-project','owner')).toBeUndefined()
    const run=createRun({projectId:'goal-project',ownerId:'owner',workspacePath:root,chatSessionId:chat.id,
      requestKey:body.requestKey,text:JSON.stringify(body.brief),constraints:body.brief.settings,ids:['goal']})
    const startedAt=new Date().toISOString(),followingMode=mode
    let turnId:string|undefined
    mode='wait'
    try {
      await sessions.sendWithDisplay(chat.id,'Historical implementation assignment',{
        confirmedBriefContext:run.requirements.text,
        nativeGoal:{mode:'start',objective:'Synthetic original assignment',
          ...(faults.nativeGoalBudget==null?{}:{tokenBudget:faults.nativeGoalBudget})},
        onTurnAccepted:id=>{turnId=id},
      })
      for(let i=0;i<300&&!submissions.length;i++)await Bun.sleep(5)
      expect(submissions).toHaveLength(1)
      expect(sessions.transcript(chat.id).findLast(event=>event.turnId===turnId &&
        event.payload?.subtype==='native_goal')).toMatchObject({payload:{nativeGoal:{status:'active'}}})
      sessions.stop(chat.id,'historical_goal_paused')
      await sessions.waitForSessionIdle(chat.id)
    }finally{mode=followingMode}
    const nativeSessionId=sessions.runtimeSnapshot(chat.id).nativeSessionId
    if(!turnId||!nativeSessionId)throw Error('Historical Goal fixture has no native turn identity')
    const events=sessions.transcript(chat.id)
    expect(events.findLast(event=>event.payload?.subtype==='native_goal')).toMatchObject({turnId,
      payload:{threadId:nativeSessionId,nativeGoal:{objective:'Synthetic original assignment',
        status:faults.pauseUnavailable?'active':'paused',tokenBudget:faults.nativeGoalBudget??null,
        tokensUsed:faults.pauseTokens??48}}})
    const finishedAt=new Date().toISOString()
    run.status='blocked';run.paused={at:finishedAt};run.fence=1
    run.agentTurns=[{attemptId:'historical-goal',requestKey:run.requestKey,sessionId:chat.id,workerId:'historical-host',
      fence:1,status:'interrupted',startedAt,finishedAt,quiescedAt:finishedAt,turnId,nativeRuntime:'bgs',nativeSessionId,
      requirementsRevision:run.requirements.revision}]
    await local.commit(run.projectId,run.ownerId,0,run,'agent.turn-settled')
    return run
  }
  return {root,hostRoot:join(container,'host'),store:local,sessions,submissions,starts,events,body,call,wait,seedHistoricalGoal,setMode:(v:typeof mode)=>{mode=v},setOwner:(v:string)=>{owner=v},setPersistFailure:(v:boolean)=>{persistFails=v},setSettlementFailure:(v:boolean)=>{failSettlement=v},
    close:async()=>{await Promise.all(cleanup.map(fn=>fn()));await sessions.dispose();await rm(container,{recursive:true,force:true})}}
}

for (const creationMode of ['creative','blueprint']) test('new '+creationMode+' project carries only its adopted direction through reviewed design, resources, implementation and verification',async()=>{
  const stages:string[]=[]
  let providerSubmissions=0, waiting=false
  const requests:string[]=[]
  const discoverySummary='Compare motion cues at the same tempo; timing remains open.'
  const f=await fixture('normal',false,undefined,()=>({
    instruction:'Simulated image service',close:async()=>{},fetch:async(request:Request)=>{
      if(request.method==='GET')return Response.json({available:true})
      const {requestId}=await request.json()
      if(!requests.includes(requestId))providerSubmissions++
      requests.push(requestId)
      // The provider completed this image but the first delivery failed.
      return requests.length===1 ? Response.json({error:'delivery interrupted'},{status:503}) :
        new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}})
    }
  }),0,{},undefined,true,async(root,input,systemContext)=>{
    const stage=(await f.store.read('goal-project','owner'))!.agentTurns!.at(-1)!.production!.stage
    stages.push(stage)
    const prompt=systemContext+"\n"+JSON.stringify(input.prompt)
    const chosen='assets/reference/selected/opening.svg'
    const alternate='assets/reference/alternative.html'
    const write=async(path:string,content:string)=>{
      await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content)
    }
    if(stage==='discovery') {
      expect(prompt).toContain('Once the evidence supports a meaningful comparison, return ready')
      expect(prompt).not.toMatch(/Managed Vite Preview|native scene, UI and resource sources|localStorage\/sessionStorage|after cleanup|Use BgsWorkflow for status/)
      expect(prompt).toContain('confirmed platform')  // current project constraint still applies
      expect(prompt).toContain('brief, sources and research images needed by its consumer')
      expect(prompt).toContain('Creative Direction develops the candidate treatments')
      expect(prompt).not.toContain('Summarize the choice the evidence supports')
      const brief='docs/ResearchBrief.md', reference='docs/research/study.svg'
      const observation='Observed input sequence from '+reference+'. Inference: use motion to reveal input.'
      if (!input.nativeRecovery) {
        await write(reference,'<svg/>')
        if(creationMode==='creative') await write(brief,observation)
        waiting=true
        await new Promise<void>(done=>input.signal.addEventListener('abort',()=>done(),{once:true}))
        return
      }
      expect(input.prompt).toEqual([])
      expect(systemContext).toContain(creationMode==='creative' ? 'Continue from the saved draft at '+brief : 'observations and reference material already retained')
      expect(await readFile(join(root,reference),'utf8')).toBe('<svg/>')
      if(creationMode==='creative') expect(await readFile(join(root,brief),'utf8')).toBe(observation)
      const findings={status:'ready',summary:discoverySummary,sections:[],files:[brief]}
      if(creationMode==='blueprint') {
        await write(brief,'Observed input sequence from the supplied study.')
        await expect(input.finalOutput!.accept(findings)).rejects.toThrow('traceable')
        await write(brief,observation)
      }
      await input.finalOutput!.accept({...findings,files:[brief,reference]})
    } else if(stage==='direction') {
      expect(prompt).toContain('develop candidate expressions and their visual studies')
      expect(prompt).toContain('where its result could change the direction')
      expect(prompt).toContain('outstanding production or implementation work')
      expect(prompt).not.toMatch(/Managed Vite Preview|native scene, UI and resource sources|localStorage\/sessionStorage/)
      if(!input.nativeRecovery) {
        // This is what the direction model receives in the new task, not what the store retained.
        const raw=typeof input.prompt==='string' ? input.prompt : input.prompt.flatMap(item=>item.type==='text' ? [item.text] : []).join('\n')
        const payload=raw.split('Saved creative input (source data):\n')[1]
        expect(payload).toBeDefined()
        expect(JSON.parse(payload!.split('\n')[0])).toMatchObject({summary:discoverySummary,
          text:'Observed input sequence from docs/research/study.svg. Inference: use motion to reveal input.',
          files:['docs/ResearchBrief.md','docs/research/study.svg']})
      }
      if(creationMode==='creative') {
        const doc=input.nativeRecovery?'recovered-request.json':'initial-request.json'
        await write(doc,JSON.stringify({purpose:'reference',prompt:'Chosen direction study'}))
        const child=Bun.spawn([process.execPath,input.imageGenerationEntry!,'generate',doc,'assets/reference/study.png'],{
          cwd:root,env:{...process.env,BEEGAME_ASSET_CAPABILITY_FILE:projectPreviewCapabilityPath(root,f.body.chatSessionId)},stderr:'pipe',stdout:'pipe'})
        const diagnosis=await new Response(child.stderr).text()
        expect(await child.exited,diagnosis).toBe(input.nativeRecovery?0:1)
        if(!input.nativeRecovery) {
          waiting=true
          await new Promise<void>(done=>input.signal.addEventListener('abort',()=>done(),{once:true}))
          return
        }
        expect(requests).toHaveLength(2)
        expect(requests[0]).toBe(requests[1])
        expect(providerSubmissions).toBe(1)
      }
      await write(chosen,'<svg xmlns="http://www.w3.org/2000/svg"><circle r="8"/></svg>');await write(alternate,'<button/>')
      await write('docs/VisualContract.md','Selected motion begins with a visible response.')
      const result={status:'ready',summary:'Selected motion',sections:[],files:['docs/VisualContract.md',chosen]}
      await expect(input.finalOutput!.accept({...result,files:[...result.files,alternate]})).rejects.toThrow('only the adopted direction')
      await input.finalOutput!.accept(result)
      if(creationMode==='blueprint') {
        waiting=true
        await new Promise<void>(done=>input.signal.addEventListener('abort',()=>done(),{once:true}))
      }
    } else {
      expect(prompt).toContain('Selected motion begins')
      expect(prompt).toContain(chosen)
      expect(prompt).not.toContain(alternate)
      expect(prompt).not.toContain('docs/research/study.svg')
      expect(prompt).not.toContain(discoverySummary)
      if(stage==='design') {
        await input.finalOutput!.writeDocument!.authorize()
        await write('docs/GDD.md','# Rules\n## Play\nRespond to input.')
        await recordSyntheticDesignReview(input)
        await input.finalOutput!.accept({status:'ready',summary:'Reviewed design'})
      } else if(stage==='resources') {
        const example=assetManifestAuthoringExamples().canonical,item=example.resources[0]!
        await write(item.root_path,'{}')
        await write('assets/production/unused-export.png','unused production variant')
        const handoff={status:'ready',summary:'Produced piece',sections:['Play'],files:item.file_paths}
        await expect(input.finalOutput!.accept(handoff)).rejects.toThrow('registered runtime files')
        await produceResources(root,{operation:'register',projectTarget:{...example.project_target!,resource_library_usage:'optional'},requirements:example.requirements,
          resources:[{id:item.id,fulfills:item.fulfills,root_path:item.root_path,file_paths:item.file_paths,provisional:false,reason:'Runtime art',selection_reason:['Matches selected direction']}]},undefined,'optional')
        await input.finalOutput!.accept(handoff)
      } else if(stage==='implementation') {
        expect(prompt).toContain(assetManifestAuthoringExamples().canonical.resources[0]!.root_path)
        expect(prompt).not.toContain('unused-export.png')
        await write('index.html','<canvas></canvas>')
        await input.workflow!({action:'advance',summary:'Runtime ready',sections:[],files:['index.html']})
      } else {
        expect(prompt).toContain('index.html')
        await input.finalOutput!.accept({summary:'Observed response',observations:[{outcome:'Respond to input',status:'passed',evidence:'Visible response'},{outcome:'Physical device feel',status:'coverage-limit',evidence:'Pointer tested in emulation'}],externalBlocker:null})
      }
    }
  })
  Object.assign(f.body.brief,{creation_mode:creationMode,build_source:null,settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}})
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    for(const pausedStage of ['discovery','direction']) {
      await f.wait(r=>waiting||Boolean(r.agentTurns?.at(-1)?.error))
      expect(stages.at(-1)).toBe(pausedStage)
      expect(waiting,(await f.store.read('goal-project','owner'))?.blockedReason).toBe(true)
      waiting=false
      await f.call('/stop','POST')
      let stopped=await f.wait(r=>Boolean(r.paused) && !r.writer)
      await f.call('/resume','POST',{planRevision:stopped.planRevision})
      stopped=(await f.store.read('goal-project','owner'))!
      const result=pausedStage==='direction' && creationMode==='blueprint' ? await f.call('/agent/continue-production','POST',{expectedVersion:stopped.version,afterAttemptId:stopped.agentTurns!.at(-1)!.attemptId}) : await f.call('/agent/messages','POST',{requestKey:'resume-'+pausedStage,runId:stopped.id,chatSessionId:stopped.chatSessionId,expectedVersion:stopped.version,requirementsRevision:stopped.requirements.revision,intent:'continue',continuationOf:stopped.agentTurns!.at(-1)!.attemptId,text:''})
      expect(result.status,JSON.stringify([await result.clone().text(),stopped.agentTurns!.at(-1)?.error])).toBe(202)
    }
    const run=await f.wait(r=>r.status==='completed'||Boolean(r.agentTurns?.at(-1)?.error))
    expect(stages,run.blockedReason).toEqual(['discovery','discovery','direction',...(creationMode==='creative'?['direction']:[]),'design','resources','implementation','verification'])
    expect(run.agentTurns!.find(t=>t.production?.stage==='design')!.designReviews).toHaveLength(1)
    expect(run.status,run.blockedReason).toBe('completed')
  }finally{await f.close()}
},30000)

// Existing GDD-only projects can enter production explicitly; a fresh complete
// game already advances automatically and is not a valid fixture for that case.
async function seedGddOnlyRun(f:Awaited<ReturnType<typeof fixture>>, historicalFullGame=false) {
  const run=createRun({projectId:'goal-project',ownerId:'owner',workspacePath:f.root,
    chatSessionId:f.body.chatSessionId,requestKey:f.body.requestKey,text:JSON.stringify(f.body.brief),
    constraints:f.body.brief.settings,ids:['goal']})
  run.productionWorkflow=1
  if(historicalFullGame)run.creation={initialDelivery:'design-led-first-version',editableContent:false}
  await f.store.commit(run.projectId,run.ownerId,0,run,'synthetic-gdd-only-project')
}

async function seedLegacyIsolatedRun(f: Awaited<ReturnType<typeof fixture>>, isolated = true) {
  const run=createRun({projectId:'goal-project',ownerId:'owner',workspacePath:f.root,
    chatSessionId:f.body.chatSessionId,requestKey:f.body.requestKey,text:JSON.stringify(f.body.brief),
    constraints:f.body.brief.settings,ids:['goal']})
  run.creation={initialDelivery:'complete-game',editableContent:false,...(isolated ? {verification:'isolated' as const} : {})}
  run.productionWorkflow=1
  await f.store.commit(run.projectId,run.ownerId,0,run,'synthetic-retained-isolated-policy')
}

async function seedLegacyVisualRun(f: Awaited<ReturnType<typeof fixture>>, draft: string) {
  await mkdir(join(f.root, 'docs'), { recursive: true })
  await writeFile(join(f.root, 'docs/GDD.md'), draft)
  const run = createRun({ projectId:'goal-project', ownerId:'owner', workspacePath:f.root,
    chatSessionId:f.body.chatSessionId, requestKey:f.body.requestKey, text:JSON.stringify(f.body.brief),
    constraints:f.body.brief.settings, ids:['goal'] })
  run.creation = { initialDelivery:'design-led-first-version', editableContent:false }
  run.productionWorkflow = 1; run.visualHandoffVersion = 1; run.fence = 1; run.status = 'blocked'
  run.agentTurns = [{ attemptId:'00000000-0000-4000-8000-000000000001', requestKey:f.body.requestKey,
    sessionId:run.chatSessionId, workerId:'historical-host', fence:1, status:'ended',
    startedAt:'2026-01-01T00:00:00.000Z', finishedAt:'2026-01-01T00:00:01.000Z', quiescedAt:'2026-01-01T00:00:01.000Z',
    turnId:'historical-design-turn', nativeRuntime:'bgs', nativeSessionId:'11111111-2222-4333-8444-555555555555',
    requirementsRevision:run.requirements.revision, production:{stage:'design',originRequestKey:run.requestKey,stopAfter:'implementation'},
    productionHandoff:{request:{action:'advance',summary:'Historical reviewed GDD',sections:[],files:['docs/GDD.md']},
      sources:[{path:'docs/GDD.md',sha256:createHash('sha256').update(draft).digest('hex')}],
      next:{stage:'visual',originRequestKey:run.requestKey,stopAfter:'implementation'}} }]
  await f.store.commit(run.projectId, run.ownerId, 0, run, 'synthetic-retained-visual-handoff')
  return run
}

async function acceptSyntheticVisualHandoff(input:BeeGameSessionSubmitInput,result:{status:'ready';summary:string;sections:string[];files:string[]}) {
  expect(input.finalOutput).not.toHaveProperty('visualReview')
  await input.finalOutput!.accept(result)
}

test('existing sources and an already-running goal never receive a backfilled guide',async()=>{
  const existing=await fixture()
  const running=await fixture('wait',false,undefined,undefined,0,{},undefined,true)
  Object.assign(running.body.brief,{creation_mode:'creative',build_source:null})
  try {
    await writeFile(join(existing.root,'README.md'),'Existing project source')
    Object.assign(existing.body.brief,{creation_mode:'creative',build_source:null})
    expect((await existing.call('/agent/goal','POST',existing.body)).status).toBe(202)
    await existing.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    await expect(readFile(join(existing.root,'AGENTS.md'),'utf8')).rejects.toThrow()

    expect((await running.call('/agent/goal','POST',running.body)).status).toBe(202)
    await running.wait(r=>Boolean(r.writer) && running.submissions.length===1)
    await rm(join(running.root,'AGENTS.md'))
    expect((await running.call('/agent/goal','POST',running.body)).status).toBe(202)
    expect(running.submissions).toHaveLength(1)
    await expect(readFile(join(running.root,'AGENTS.md'),'utf8')).rejects.toThrow()
  }finally{await existing.close();await running.close()}
},30000)

test('saved guide markers do not trigger host repair or retain an exited writer',async()=>{
  const f=await fixture()
  try {
    await initializeProjectGuide(f.root)
    const path=join(f.root,'AGENTS.md'),damaged='<!-- bgs:source-navigation:start -->\nLEGACY_USER_NAVIGATION\n'+(await readFile(path,'utf8'))
    await writeFile(path,damaged)
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.agentTurns![0].status).toBe('ended')
    expect(run.writer).toBeUndefined()
    expect(run.blockedReason).toBeUndefined()
    expect(await readFile(path,'utf8')).toBe(damaged)
  }finally{await f.close()}
})

test('existing React/Web sources retain their own entry across goal intake and ordinary modification, without managed-boot migration',async()=>{
  const f=await fixture()
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}})
  try {
    await writeFile(join(f.root,'index.html'),'EXISTING_AUTHOR_ENTRY')
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    expect(run.creation).toBeUndefined();expect(run.webBoot).toBeUndefined()
    await f.call('/agent/messages','POST',{requestKey:'modify-existing',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Modify only existing implementation; do not migrate the entry.'})
    run=await f.wait(r=>Boolean(r.agentTurns![1]?.finishedAt))
    expect(run.webBoot).toBeUndefined();expect(f.starts.every(start=>start.managedWebBoot===undefined)).toBe(true)
    expect(await readFile(join(f.root,'index.html'),'utf8')).toBe('EXISTING_AUTHOR_ENTRY')
    expect(await Bun.file(join(f.root,'src/bgs-entry.mjs')).exists()).toBe(false)
    expect(await Bun.file(join(f.root,'src/bgs-storage.mjs')).exists()).toBe(false)
  }finally{await f.close()}
})

test('running autonomous events use the actual host-accepted turn, not a previous Chat turn or an unbound cold host',async()=>{
  const f=await fixture('normal',false,undefined,undefined,240)
  const coldCleanups:Array<()=>Promise<void>>=[]
  try {
    await f.call('/agent/goal','POST',f.body)
    const before=await f.wait(r=>Boolean(r.agentTurns![0]!.finishedAt)),old=before.agentTurns![0]!
    f.setMode('wait')
    await f.call('/agent/messages','POST',{requestKey:'live-events',runId:before.id,chatSessionId:before.chatSessionId,
      expectedVersion:before.version,requirementsRevision:before.requirements.revision,intent:'work',text:'Synthetic next running work'})
    const running=await f.wait(r=>Boolean(r.writer) && f.submissions.length===2 &&
      f.sessions.transcriptFacts(r.chatSessionId).filter(e=>e.type==='assistant.message').length>=480)
    const current=running.agentTurns!.at(-1)!
    expect(current.turnId).toBeUndefined() // It is not durable until actual exit settlement.
    const page=await (await f.call('/events')).json()
    expect(page.attemptId).toBe(current.attemptId);expect(page.events).toHaveLength(100)
    expect(page.turnId).not.toBe(old.turnId)
    expect(page.events.every((e:any)=>e.turnId===page.turnId)).toBe(true)
    const older=await (await f.call('/events?attemptId='+old.attemptId)).json()
    expect(older.turnId).toBe(old.turnId);expect(older.events).toHaveLength(100)
    // A reconstructed/other host shares the Chat, but has no acceptance receipt
    // for this writer. Never fall back to runtimeSnapshot's most recent turn.
    const cold=new Hono()
    registerV3Routes(cold,{store:f.store,sessions:f.sessions,getUser:()=>({id:'owner',role:'owner'}),
      getProject:async()=>({id:'goal-project',name:'Synthetic',root_path:f.root,created_at:0}),
      getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},
      persistMode:async()=>{},readBody:r=>r.json(),registerCleanup:fn=>coldCleanups.push(fn)})
    const unbound=await (await cold.request('/api/projects/goal-project/workflow-v3/events')).json()
    expect(unbound.events).toEqual([]);expect(unbound.note).toContain('not been bound')
    expect((await f.call('/events?attemptId=foreign-attempt')).status).toBe(404)
    f.setOwner('foreign');expect((await f.call('/events')).status).toBe(404);f.setOwner('owner')
    expect((await f.store.read('goal-project','owner'))!.version).toBe(running.version)
    expect(f.submissions).toHaveLength(2)
  }finally{await Promise.all(coldCleanups.map(fn=>fn()));await f.close()}
})

test('autonomous debug events are paged by actual attempt without changing native history, scope or execution',async()=>{
  const f=await fixture('normal',false,undefined,undefined,240)
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt)),turn=run.agentTurns![0]!
    const original=f.sessions.transcript(run.chatSessionId)
    const page=await (await f.call('/events?limit=20')).json()
    expect(page).toMatchObject({runId:run.id,attemptId:turn.attemptId,turnId:turn.turnId,limit:20,hasMore:true,historyUnavailable:[]})
    expect(page.events).toHaveLength(20)
    const older=await (await f.call('/events?limit=20&beforeId='+page.nextBeforeId+'&attemptId='+turn.attemptId)).json()
    expect(older.events.at(-1).id).toBeLessThan(page.events[0].id)
    expect(older.events.every((event:any)=>event.turnId===turn.turnId)).toBe(true)
    expect((await f.call('/events?limit=201')).status).toBe(400)
    expect((await f.call('/events?beforeId=-1')).status).toBe(400)
    expect((await f.call('/events?attemptId=foreign')).status).toBe(404)
    const formatted=f.sessions.transcript.bind(f.sessions)
    try {
      f.sessions.transcript=()=>{throw Error('Full display formatting is not needed for facts/pages')}
      expect((await f.call('/events?limit=20')).status).toBe(200)
      const question=await (await f.call('/questions')).json()
      expect(question.historyUnavailable).toEqual([]);expect(question.questions).toEqual([])
    }finally{f.sessions.transcript=formatted}
    expect(f.sessions.transcript(run.chatSessionId)).toEqual(original)
    expect(f.submissions).toHaveLength(1);expect(await f.store.read(run.projectId,run.ownerId)).toEqual(run)
  }finally{await f.close()}
})

test('initial goal continues through visual direction without host Tasks or a second authorization',async()=>{
  const f=await fixture()
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&f.sessions.transcript(r.chatSessionId).some(e=>e.payload?.subtype==='host_evidence'))
    expect(f.submissions).toHaveLength(1)
    const submit=f.submissions[0]!
    expect(submit.language).toBe('zh')
    expect(submit.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(JSON.stringify(submit.prompt)).not.toContain('first assignment ends at visual-direction handoff')
    expect(JSON.stringify(submit.prompt)).not.toContain('Professional coverage:')
    expect(f.starts[0].systemContext).toContain(agentProfessionalContextForRun(run))
    expect(f.starts[0].systemContext).not.toContain('actual source findings and current tool capabilities')
    expect(f.starts[0].systemContext).toContain('No root project guide exists')
    expect(f.starts[0].systemContext).toContain('Current BGS tools directory')
    expect(f.starts[0].systemContext).not.toContain('BgsMeasurement')
    expect(f.starts[0].systemContext).not.toContain('Document navigation: ReadDesignHandoff {} lists files')
    expect(f.starts[0].systemContext).not.toContain('Plain documents need no index or finalization')
    expect(f.starts[0].systemContext).not.toContain('Document authoring contract:')
    expect(f.starts[0].systemContext).not.toContain('Maintain root AGENTS.md')
    expect(f.starts[0].systemContext).not.toContain('project-navigation-sources')
    expect(JSON.stringify(submit.prompt)).not.toContain('BGS current assignment')
    expect(f.starts[0].systemContext.split('Acquisition: bun assets.mjs --help.')).toHaveLength(2)
    expect(f.starts[0].systemContext).not.toContain('Optional BGS project tools')
    expect(JSON.stringify(submit.prompt)).not.toContain('Optional BGS project tools')
    expect(String(submit.prompt)).not.toContain(JSON.stringify(f.body.brief))
    expect(submit.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false)
    expect(run.agentTurns![0]).toMatchObject({sessionId:f.body.chatSessionId,status:'ended',
      usage:expect.objectContaining({prompt_tokens:40,completion_tokens:8})})
    expect(run.agentTurns![0]!.quiescedAt).toBeDefined();expect(run.writer).toBeUndefined();expect(run.deliveryEligible).toBe(false)
    expect(run.status).toBe('completed')
    expect(run.blockedReason).toBeUndefined()
    expect(f.sessions.transcript(run.chatSessionId).findLast(e=>e.payload?.subtype==='host_evidence')?.text).toContain('execution completion is not independent game-quality acceptance')
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202);expect(f.submissions).toHaveLength(1)
    expect((await f.call('/agent/goal','POST',reverseKeys(f.body))).status).toBe(202)
    expect(f.submissions).toHaveLength(1)
    expect((await f.call('/agent/goal','POST',{...f.body,brief:{...f.body.brief,idea:'different'}})).status).toBe(409)
    expect((await f.call('/plan','PUT',{})).status).toBe(404)
    const events=await (await f.call('/events')).json()
    expect(events.events.some((e:any)=>e.type==='turn.completed')).toBe(true)
    expect(events.events.every((e:any)=>!e.workflowExecution)).toBe(true)
    expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toBe('Synthetic partial candidate')
  }finally{await f.close()}
})
test('goal and follow-ups leave catalog reads to the Agent and preserve user source choices',async()=>{
  const calls:unknown[]=[]
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    calls.push({path:new URL(request.url).pathname,body:await request.json(),submissions:f.submissions.length})
    return Response.json({total:1,items:[{packId:'fixture-audio',packName:'Existing audio',dimension:'agnostic',
      primaryCategory:'audio',readyElementCount:54,formats:['ogg'],styles:[],tags:[],license:'CC0'}]})
  }})
  const f=await fixture('normal',false,upstream.url.origin,undefined,0,{},'synthetic-user')
  f.body.brief.idea='Synthetic goal: use the user-supplied character; AI only for the requested background.'
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(calls).toHaveLength(0)
    const initial=f.starts[0].systemContext
    expect(initial).not.toContain('fixture-audio')
    expect(f.submissions[0]!.confirmedBriefContext).toContain(f.body.brief.idea)
    expect(initial).toContain('Honor explicit resource sources')
    expect(JSON.parse(run.requirements.text)).toEqual(f.body.brief)
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    for(const intent of ['work','change'] as const) {
      const turnCount=run.agentTurns!.length
      expect((await f.call('/agent/messages','POST',{requestKey:'followup-'+intent,runId:run.id,
        chatSessionId:run.chatSessionId,expectedVersion:run.version,requirementsRevision:run.requirements.revision,
        intent,text:'Synthetic follow-up; preserve the source choice'})).status).toBe(202)
      run=await f.wait(r=>Boolean(r.agentTurns?.[turnCount]?.finishedAt))
      expect(JSON.stringify(f.submissions[turnCount]!.prompt)).not.toContain('Initial built-in resource catalog')
    }
    expect(calls).toHaveLength(0)
    expect(f.submissions).toHaveLength(3)
  }finally{await f.close();upstream.stop(true)}
})

test('same-project work/change reuse native history; one CAS changes revision, duplicates never dispatch again',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const message=(key:string,intent:'work'|'change',text:string)=>({requestKey:key,runId:run.id,
      chatSessionId:run.chatSessionId,expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text})
    const original=structuredClone(run.requirements),work=message('work-1','work','Inspect the existing rules; do not change them')
    expect((await f.call('/agent/messages','POST',work)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.requirements).toEqual(original);expect(run.requirementChanges).toBeUndefined()
    expect(f.starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(f.starts[1].env.BEEGAME_CONFIG_DIR).toBe(f.starts[0].env.BEEGAME_CONFIG_DIR)
    expect(String(f.submissions[1]!.prompt)).toContain(work.text)
    expect(JSON.stringify(f.submissions[1]!.prompt)).not.toContain('GDD.md')
    expect(f.starts[1].systemContext).not.toContain('Professional coverage:')
    expect(f.starts[1].systemContext).toContain('No root project guide exists')
    const change=message('change-1','change','Change the target to four, preserve unrelated notes and rerun the rule test')
    const [a,b]=await Promise.all([f.call('/agent/messages','POST',change),f.call('/agent/messages','POST',change)])
    expect([a.status,b.status].sort()).toEqual(expect.arrayContaining([202]))
    expect([a.status,b.status].every(n=>n===202||n===409)).toBe(true)
    run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt))
    expect(run.requirements.revision).not.toBe(original.revision)
    expect(run.requirementChanges).toHaveLength(1);expect(run.requirementChanges![0]!.before).toEqual(original)
    expect(JSON.parse(run.requirements.text).authorized_user_changes).toEqual([{requestKey:'change-1',text:change.text}])
    expect(run.agentTurns![2]!.requirementsRevision).toBe(run.requirements.revision)
    expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false);expect(run.deliveryEligible).toBe(false)
    expect((await f.call('/agent/messages','POST',change)).status).toBe(202)
    expect((await f.call('/agent/messages','POST',{...change,text:'Another change'})).status).toBe(409)
    expect((await f.call('/agent/messages','POST',{...change,requestKey:'stale-change'})).status).toBe(409)
    expect((await f.call('/agent/messages','POST',{...message('wrong-chat','work','Question'),chatSessionId:'foreign'})).status).toBe(400)
    // Original intake stays idempotent even after requirement revisions.
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    expect(f.submissions).toHaveLength(3)
    expect(JSON.stringify(f.submissions[2]!.prompt)).not.toContain('only affected domains')
    expect(JSON.stringify(f.submissions[2]!.prompt)).not.toContain('Professional coverage:')
    expect(f.starts[2].systemContext).toContain(agentProfessionalContextForRun(run,true))
    expect(f.starts[2].systemContext).not.toContain('absence of user-named asset files')
    expect(f.starts[2].systemContext).not.toContain('New design-led first-version deliverables')
    expect(f.starts[2].systemContext).toContain('No root project guide exists')
    expect(f.starts[2].systemContext).not.toContain('## Required design dependencies')
    const locator = /Current BGS tools directory \(absolute path\): ("[^"]+")/
    const firstDirectory = f.starts[0].systemContext.match(locator)[1]
    const currentDirectory = f.starts[2].systemContext.match(locator)[1]
    expect(currentDirectory).not.toBe(firstDirectory)
    expect(f.starts[2].systemContext).not.toContain(firstDirectory)
    const edited=structuredClone(run);edited.version++;edited.agentTurns![2]!.message!.text='Rewritten authorization'
    expect(()=>assertCommit(run.projectId,run.ownerId,run.version,edited,run)).toThrow('history')
  }finally{await f.close()}
})

test('formal natural-language chat preserves the exact request without a UI intent choice',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const question={requestKey:'chat-question',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,
      text:'Why is this level difficult?'}
    expect((await f.call('/agent/messages','POST',question)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(JSON.stringify(f.submissions[1]!.prompt)).toContain(question.text)
    expect(f.submissions[1]!.prompt).toBe('User message:\n'+question.text)
    expect(run.requirements.revision).toBe(question.requirementsRevision)
    expect(JSON.parse(run.requirements.text)).not.toHaveProperty('user_messages')
    expect(run.agentTurns![1]!.message!.text).toBe(question.text)
    const change={...question,requestKey:'chat-change',expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,text:'Make the level easier and update the design record.'}
    expect((await f.call('/agent/messages','POST',change)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt))
    expect(JSON.stringify(f.submissions[2]!.prompt)).toContain(change.text)
    expect(run.requirements.revision).toBe(question.requirementsRevision)
    expect(run.agentTurns![2]!.message!.text).toBe(change.text)
    expect(run.requirementChanges).toBeUndefined()
    const explicit={...change,requestKey:'explicit-change',intent:'change',expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,text:'Confirmed change: lower the target.'}
    expect((await f.call('/agent/messages','POST',explicit)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[3]?.finishedAt))
    expect(run.requirements.revision).not.toBe(question.requirementsRevision)
    expect(run.requirementChanges).toHaveLength(1)
    const brief=JSON.parse(run.requirements.text)
    expect(brief).not.toHaveProperty('user_messages')
    expect(brief.authorized_user_changes).toEqual([{requestKey:explicit.requestKey,text:explicit.text}])
    expect(run.agentTurns![1]!.message!.text).toBe(question.text)
  } finally {await f.close()}
})

test('V3 attachments reach the native turn without storing base64 in the Run',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const request={requestKey:'chat-file',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,
      text:'',attachments:[{type:'file',mediaType:'text/plain',filename:'note.txt',data:Buffer.from('A design note').toString('base64')}]}
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202)
    const saved=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(saved.agentTurns![1]!.message?.attachmentDigests).toHaveLength(1)
    expect(JSON.stringify(saved)).not.toContain(request.attachments[0]!.data)
    expect(JSON.stringify(f.submissions[1]!.prompt)).toContain('note.txt')
    expect((await f.call('/agent/messages','POST',{...request,
      attachments:[{...request.attachments[0],data:Buffer.from('Different note').toString('base64')}] })).status).toBe(409)
    expect((await f.call('/agent/messages','POST',{...request,requestKey:'invalid-file',
      attachments:[{...request.attachments[0],data:'not-base64'}] })).status).toBe(400)
  } finally {await f.close()}
})

test('first follow-up preserves requirements and resumes native history unless focused was requested',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const original=structuredClone(run.requirements),planRevision=run.planRevision
    const message={requestKey:'existing-goal-work',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Check and repair the existing goal, not a new requirement'}
    expect((await f.call('/agent/messages','POST',message)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.requirements).toEqual(original);expect(run.requirementChanges).toBeUndefined()
    expect(run.planRevision).toBe(planRevision)
    expect(f.starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(run.agentTurns![1]!.nativeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(f.submissions[1]!.prompt).toBe('User message:\n'+message.text)
    expect(f.starts[1].systemContext).toContain('BGS current assignment')
    expect(f.starts[1].systemContext).not.toContain('reportSemantics')
    expect(JSON.stringify(f.submissions[1]!.prompt)).not.toContain('authorized_user_changes')
    expect(run.deliveryEligible).toBe(false)
    expect((await f.call('/agent/messages','POST',message)).status).toBe(202)
    expect(f.submissions).toHaveLength(2)
    expect((await f.call('/agent/messages','POST',{...message,requestKey:'not-continuation',intent:'continue'})).status).toBe(400)
  }finally{await f.close()}
})

test('project guide refreshes at the next work turn without repeating user history or changing requirements',async()=>{
  const f=await fixture()
  try {
    const file=join(f.root,'AGENTS.md'),first='# Project navigation\nGUIDE_ROUTE_ONE\nRun: existing actual command\n'+
      PROJECT_WORKING_CONVENTIONS+'\n'
    await writeFile(file,first)
    await f.call('/agent/goal','POST',f.body);let run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    const requirements=structuredClone(run.requirements)
    expect(f.starts[0].systemContext).not.toContain('GUIDE_ROUTE_ONE')
    expect(f.starts[0].systemContext).not.toContain(PROJECT_WORKING_CONVENTIONS)
    expect(f.starts[0].systemContext).not.toContain('## Required design dependencies')
    expect(f.starts[0].systemContext).toContain('Follow applicable project working conventions within current user authorization')
    expect(await readFile(file,'utf8')).toBe(first)
    expect(JSON.stringify(f.submissions[0].prompt)).not.toContain('GUIDE_ROUTE_ONE')
    const send=async(intent:string,key:string)=>{
      await f.call('/agent/messages','POST',{requestKey:key,runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text:'Inspect existing project navigation'})
      run=await f.wait(r=>Boolean(r.agentTurns?.at(-1)?.finishedAt) && r.agentTurns!.at(-1)!.requestKey===key)
    }
    await writeFile(file,first.replace('GUIDE_ROUTE_ONE','GUIDE_ROUTE_TWO'))
    await send('work','guide-refresh')
    expect(f.starts[1].systemContext).not.toContain('GUIDE_ROUTE_TWO')
    expect(f.starts[1].systemContext).toContain(digest(first.replace('GUIDE_ROUTE_ONE','GUIDE_ROUTE_TWO')))
    expect(f.starts[1].systemContext).not.toContain(PROJECT_WORKING_CONVENTIONS)
    expect(f.starts[1].systemContext).not.toContain('## Required design dependencies')
    expect(await readFile(file,'utf8')).toBe(first.replace('GUIDE_ROUTE_ONE','GUIDE_ROUTE_TWO'))
    expect(f.starts[1].systemContext).not.toContain('GUIDE_ROUTE_ONE')
    await writeFile(file, PROJECT_WORKING_CONVENTIONS)
    await send('work', 'guide-current')
    expect(await readFile(file, 'utf8')).toBe(PROJECT_WORKING_CONVENTIONS)
    await rm(file);await send('work','guide-missing')
    expect(f.starts[3].systemContext).toContain('No root project guide exists')
    expect(f.starts[3].systemContext).not.toContain('GUIDE_ROUTE_TWO')
    expect(run.requirements).toEqual(requirements)
    expect(run.requirementChanges).toBeUndefined()
    expect(new Set(run.agentTurns!.map(t=>t.nativeSessionId)).size).toBe(1)
    for(const submission of f.submissions)expect(JSON.stringify(submission.prompt)).not.toContain('GUIDE_ROUTE_')
  }finally{await f.close()}
})

test('focused work is explicit and retains Chat/sources but does not resume the old native context',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body);let run=await f.wait(r=>Boolean(r.agentTurns?.at(-1)?.finishedAt))
    const original=structuredClone(run.requirements),chat=run.chatSessionId,native=run.agentTurns![0]!.nativeSessionId
    const make=(key:string,intent:string,mode?:string)=>({requestKey:key,runId:run.id,chatSessionId:chat,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text:'Specific existing work',...(mode?{contextMode:mode}:{})})
    expect((await f.call('/agent/messages','POST',make('invalid-message','message','focused'))).status).toBe(400)
    const request=make('focused-work','work','focused')
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202)
    run=await f.wait(r=>r.agentTurns!.at(-1)!.requestKey==='focused-work'&&Boolean(r.agentTurns!.at(-1)!.finishedAt))
    expect(f.starts[1].resumeSessionId).toBeUndefined()
    expect(run.agentTurns![1]!.nativeSessionId).not.toBe(native)
    expect(run.chatSessionId).toBe(chat);expect(run.requirements).toEqual(original)
    expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false)
    expect(f.starts[1].systemContext).toContain('saved-user-inputs-and-current-requirements')
    const facts=JSON.parse(f.starts[1].systemContext.split('BGS current assignment: ')[1]!)
    expect(facts.executionContext.requirements).toMatchObject({revision:run.requirements.revision})
    expect(facts.executionContext.requirements).not.toHaveProperty('text')
    expect(f.submissions[1].confirmedBriefContext).toBe(run.requirements.text)
    expect(facts.executionContext.omitted).toContain('previously loaded Skill bodies are not transferred')
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202)
    expect(f.submissions).toHaveLength(2)
    const next=make('resume-focused','work')
    expect((await f.call('/agent/messages','POST',next)).status).toBe(202)
    run=await f.wait(r=>r.agentTurns!.at(-1)!.requestKey==='resume-focused'&&Boolean(r.agentTurns!.at(-1)!.finishedAt))
    expect(f.starts[2].resumeSessionId).toBe(run.agentTurns![1]!.nativeSessionId)
    expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toBe('Synthetic partial candidate')
    f.setMode('fail');await f.call('/agent/messages','POST',make('unfinished','work'))
    run=await f.wait(r=>r.agentTurns!.at(-1)!.requestKey==='unfinished'&&Boolean(r.agentTurns!.at(-1)!.finishedAt))
    const failed=structuredClone(run.agentTurns!.at(-1)!)
    expect(failed.status).toBe('failed');expect(failed.quiescedAt).toBeTruthy()
    const newWork=make('new-work-after-exit','work','focused')
    expect((await f.call('/agent/messages','POST',newWork)).status).toBe(202)
    run=await f.wait(r=>r.agentTurns!.at(-1)!.requestKey==='new-work-after-exit'&&Boolean(r.agentTurns!.at(-1)!.finishedAt))
    expect(f.submissions).toHaveLength(5)
    expect(f.starts[4].resumeSessionId).toBeUndefined()
    const focusedFacts=JSON.parse(f.starts[4].systemContext.split('BGS current assignment: ')[1]!).executionContext
    expect(focusedFacts.previousExecution).toMatchObject({attemptId:failed.attemptId,status:'failed',error:'Synthetic native failure',
      finishedAt:failed.finishedAt,quiescedAt:failed.quiescedAt,externalOutcomes:'not-inferred'})
    expect(run.agentTurns![3]).toEqual(failed)
    expect((await f.call('/agent/messages','POST',newWork)).status).toBe(202)
    expect(f.submissions).toHaveLength(5)
  }finally{await f.close()}
})

test('focused new work requires a settled exit and remains an explicit request, not automatic recovery',async()=>{
  const f=await fixture('wait')
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>f.submissions.length===1)
    const make=(key:string)=>({requestKey:key,runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,intent:'work',contextMode:'focused',text:'Inspect the complete game, preserve current sources'})
    expect((await f.call('/agent/messages','POST',make('active-writer'))).status).toBe(409)
    expect((await f.call('/stop','POST')).status).toBe(202)
    run=await f.wait(r=>Boolean(r.paused&&r.agentTurns!.at(-1)!.finishedAt))
    expect(run.agentTurns!.at(-1)!.status).toBe('interrupted')
    expect((await f.call('/agent/messages','POST',make('paused'))).status).toBe(409)
    expect((await f.call('/resume','POST',{planRevision:run.planRevision})).status).toBe(200)
    run=(await f.store.read(run.projectId,run.ownerId))!
    expect(f.submissions).toHaveLength(1)
    const saved=structuredClone(run.agentTurns!.at(-1)!)
    for(const field of ['quiescedAt','finishedAt'] as const) {
      // Malformed read fixture, not rewriting immutable saved exit evidence.
      const malformed=structuredClone(run);delete malformed.agentTurns!.at(-1)![field]
      const executor=createAgentGoalExecutor({store:{...f.store,async read(){return malformed}},sessions:f.sessions})
      await expect(executor.message(malformed,make('missing-'+field) as Parameters<typeof executor.message>[1],{}))
        .rejects.toThrow('No saved native conversation or settled turn')
      expect(f.submissions).toHaveLength(1)
    }
    f.setMode('normal')
    expect((await f.call('/agent/messages','POST',make('explicit-new-work'))).status).toBe(202)
    run=await f.wait(r=>r.agentTurns!.length===2&&Boolean(r.agentTurns![1]!.finishedAt))
    expect(f.starts[1].resumeSessionId).toBeUndefined()
    expect(run.agentTurns![0]).toEqual(saved)
    expect(f.submissions).toHaveLength(2)
  }finally{await f.close()}
})

test('focused facts retain failed execution and unresolved tool identities without replay bodies or permissions',()=>{
  const run={requirements:{text:'CURRENT_REQUIREMENTS',revision:'rev'},agentTurns:[
    {attemptId:'prior',requestKey:'prior',turnId:'prior-turn',status:'failed',error:'Original host observed native failure',
      finishedAt:'finished',quiescedAt:'exited',measurements:[{id:'pending',requestKey:'pending-measure',startedAt:'started'}]},
    {attemptId:'current',requestKey:'current',message:{intent:'work',text:'New full acceptance'}},
  ]} as Run
  const events:any[]=[
    {id:1,turnId:'prior-turn',type:'tool.started',payload:{toolUseID:'completed',toolName:'Read'}},
    {id:2,turnId:'prior-turn',type:'tool.completed',payload:{toolUseID:'completed'},text:'PRIVATE_OUTPUT'},
    {id:3,turnId:'prior-turn',type:'tool.started',payload:{toolUseID:'pending',toolName:'Bash',input:{command:'PRIVATE_REPLAY_COMMAND'}}},
    {id:4,turnId:'prior-turn',type:'tool.started',payload:{toolUseID:'failed',toolName:'Bash'}},
    {id:5,turnId:'prior-turn',type:'tool.failed',payload:{toolUseID:'failed'},text:'PRIVATE_TOOL_ERROR'},
    {id:6,turnId:'unrelated',type:'tool.started',payload:{toolUseID:'unrelated',toolName:'Bash'}},
    {id:7,turnId:'prior-turn',type:'permission.resolved',payload:{toolName:'Bash',decision:'allow',scope:'session'}},
  ]
  const facts=focusedExecutionFacts(run,events)
  expect(facts.previousExecution).toMatchObject({attemptId:'prior',status:'failed',externalOutcomes:'not-inferred',
    unconfirmedTools:[{toolUseID:'pending',toolName:'Bash',eventId:3,status:'no-terminal-event'},
      {toolUseID:'failed',toolName:'Bash',eventId:5,status:'failed'}]})
  for(const value of ['PRIVATE_OUTPUT','PRIVATE_REPLAY_COMMAND','PRIVATE_TOOL_ERROR','unrelated','session'])
    expect(JSON.stringify(facts.previousExecution)).not.toContain(value)
})

test('follow-up transport forwards the literal task without an execution prescription',()=>{
  const text='Inspect all eight design domains, relevant Skills and the full player journey. Change only actual defects; preserve unrelated results.'
  for(const intent of ['message','work','change','continue'] as const) {
    const prompt=agentMessagePrompt({intent,text} as Parameters<typeof agentMessagePrompt>[0])
    expect(prompt).toBe('User message:\n'+text)
    expect(prompt).not.toContain('only affected domains')
    expect(prompt).not.toContain('not a new eight-document production run')
  }
})

test('goal settlement leaves the project guide unchanged after native source writes',async()=>{
  const f=await fixture()
  try {
    await initializeProjectGuide(f.root)
    const guide=await readFile(join(f.root,'AGENTS.md'),'utf8')
    await f.call('/agent/goal','POST',f.body)
    await f.wait(run=>Boolean(run.agentTurns?.[0]?.finishedAt))
    expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toBe('Synthetic partial candidate')
    expect(await readFile(join(f.root,'AGENTS.md'),'utf8')).toBe(guide)
  }finally{await f.close()}
})

test('local and remote stores read saved discuss messages without rewriting their history',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-legacy-discuss-'))
  try {
    const run=createRun({projectId:'legacy',ownerId:'owner',workspacePath:root,chatSessionId:'chat',
      requestKey:'goal',text:'Original requirements',constraints:{},ids:['goal']})
    const message={requestKey:'old-discussion',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:1,requirementsRevision:run.requirements.revision,intent:'discuss' as const,text:'Keep the blue option'}
    run.agentTurns=[{attemptId:'old-turn',requestKey:message.requestKey,sessionId:run.chatSessionId,
      workerId:'old-worker',fence:1,status:'ended',startedAt:run.createdAt,finishedAt:run.createdAt,message}]
    const local=createLocalWorkflowStore(root)
    await local.commit(run.projectId,run.ownerId,0,run,'legacy.fixture')
    const remote=createRemoteWorkflowStore({url:'https://fixture.invalid',serviceKey:'synthetic',
      fetchImpl:async()=>Response.json(run)})
    for(const store of [local,remote]) {
      const restored=await store.read(run.projectId,run.ownerId)
      expect(restored).toEqual(run)
      expect(restored?.agentTurns?.[0]?.message).toEqual(message)
    }
  }finally{await rm(root,{recursive:true,force:true})}
})

test('focused facts retain legacy discuss records and answered Questions, never tool history or permission grants',()=>{
  const requirements={text:JSON.stringify({idea:'CONFIRMED_GOAL',
    user_messages:[{requestKey:'saved-message',text:'Keep the selected theme'}],
    authorized_user_changes:[{requestKey:'saved-change',text:'Use keyboard controls'}]}),revision:'rev',constraints:{},ids:['goal'],sha256:'fixture-sha'}
  const run={requirements,agentTurns:[
    {attemptId:'message',requestKey:'saved-message',message:{intent:'message',text:'Keep the selected theme'}},
    {attemptId:'change',requestKey:'saved-change',message:{intent:'change',text:'Use keyboard controls'}},
    {attemptId:'work',requestKey:'old-work',message:{intent:'work',text:'OLD_EXECUTION_INSTRUCTION'}},
    {attemptId:'continue',requestKey:'old-continue',message:{intent:'continue',text:'OLD_CONTINUATION_INSTRUCTION'}},
    {attemptId:'prior',requestKey:'prior',message:{intent:'discuss',text:'Use the blue option'}},
    {attemptId:'current',requestKey:'current',message:{intent:'work',text:'CURRENT_WORK'}},
  ]} as Run
  const events:any[]=[{id:0,type:'user.message',text:'Literal ordinary Chat user choice'},
    {id:1,type:'assistant.message',text:'PRIVATE_OLD_MODEL_HISTORY'},
    {id:2,type:'tool.completed',text:'PRIVATE_OLD_TOOL_OUTPUT'},
    {id:3,type:'permission.resolved',payload:{toolName:'Bash',decision:'allow',input:{command:'OLD_PERMISSION'}}},
    {id:4,type:'permission.resolved',payload:{toolName:'AskUserQuestion',decision:'allow',input:{questions:[{question:'Theme?'}],answers:{'Theme?':'Blue'}}}},
    {id:5,type:'permission.requested',payload:{toolName:'AskUserQuestion',toolUseID:'declined',input:{questions:[{question:'Unchosen route?'}]}}},
    {id:6,type:'permission.resolved',payload:{toolName:'AskUserQuestion',toolUseID:'declined',decision:'deny'}}]
  const facts=focusedExecutionFacts(run,events),text=JSON.stringify(facts)
  expect(text).toContain('Use the blue option');expect(text).toContain('Theme?');expect(text).toContain('Blue')
  expect(text).toContain('Literal ordinary Chat user choice')
  const {text: _confirmedBrief, ...metadata} = requirements
  expect(facts.requirements).toEqual(metadata)
  expect(text).not.toContain('Use keyboard controls') // Explicit change retained in the confirmed brief.
  expect(facts.priorUserRequests).toEqual([
    {requestKey:'saved-message',intent:'message',text:'Keep the selected theme'},
    {requestKey:'prior',intent:'discuss',text:'Use the blue option'},
  ])
  for(const value of ['PRIVATE_OLD_MODEL_HISTORY','PRIVATE_OLD_TOOL_OUTPUT','OLD_PERMISSION','CURRENT_WORK',
    'OLD_EXECUTION_INSTRUCTION','OLD_CONTINUATION_INSTRUCTION'])expect(text).not.toContain(value)
  expect(facts.answeredQuestions).toHaveLength(2)
  expect(facts.answeredQuestions[1]).toMatchObject({status:'deny',questions:[{question:'Unchosen route?'}]})
  expect(facts.answeredQuestions[1]).not.toHaveProperty('answers')
})

test('shared guide keeps ownership once without host method routing',()=>{
  const run={creation:{initialDelivery:'design-led-first-version',editableContent:true}} as Run
  for(const followup of [false,true]) {
    const savedGuide=PROJECT_WORKING_CONVENTIONS+'\nPROJECT_SPECIFIC_ROUTE'
    const professional=agentProfessionalContextForRun(run,followup)
    expect(professional).not.toContain('## Implementation decisions')
    expect(professional).not.toContain('## Required design dependencies')
    expect(professional).not.toContain('game-content-pipeline-engineer')
    expect(professional).not.toContain('Phaser for 2D')
    expect(professional).not.toContain('BGS limited parallel work')
    const context=professional+'\n'+savedGuide
    expect(context.split('Production methods and implementation choices belong to the current authorized work')).toHaveLength(2)
    expect(context.split('## Source ownership')).toHaveLength(2)
    for(const value of ['Production methods and implementation choices belong to the current authorized work','docs/GDD.md','PROJECT_SPECIFIC_ROUTE',
      'Preserve confirmed requirements, design standards, budget, authorization','required licenses'])expect(context).toContain(value)
  }
})

test.each([undefined,'# Custom navigation\nRun the saved command'])('goal dispatch does not supplement a missing or custom guide: %s',async guide=>{
  const f=await fixture()
  try {
    if(guide!==undefined)await writeFile(join(f.root,'AGENTS.md'),guide)
    await f.call('/agent/goal','POST',f.body)
    await f.wait(run=>Boolean(run.agentTurns?.[0]?.finishedAt))
    const context=f.starts[0].systemContext
    expect(context).not.toContain('## Implementation decisions')
    expect(context).not.toContain('## Required design dependencies')
    expect(context).toContain('Current BGS tools directory')
    expect(context).toContain('Preserve the user-selected engine and platform')
    expect(context).not.toContain('verify required behavior and presentation in the target runtime')
    if(guide!==undefined) {
      expect(context).not.toContain(guide)
      expect(context).toContain(digest(guide))
      expect(await readFile(join(f.root,'AGENTS.md'),'utf8')).toBe(guide)
    } else {
      expect(context).toContain('No root project guide exists')
      expect(await readFile(join(f.root,'AGENTS.md'),'utf8').catch(()=>null)).toBeNull()
    }
  }finally{await f.close()}
})

// Prompt contracts do not prove that a model read, understood or reproduced art.
test.each([1, undefined] as const)('first-version deliverables do not become a follow-up production schedule: %s', visualHandoffVersion => {
  const run = createRun({ projectId: 'prompt', ownerId: 'owner', workspacePath: '/synthetic', chatSessionId: 'chat', requestKey: 'once', text: 'ORIGINAL_CONFIRMED_GOAL', constraints: { engine: 'React', platform: 'Web' }, ids: ['goal'] })
  run.visualHandoffVersion = visualHandoffVersion
  run.creation = { initialDelivery: 'design-led-first-version', editableContent: true }
  const first=agentProfessionalContextForRun(run), followup=agentProfessionalContextForRun(run,true)
  expect(first).not.toContain('design dependencies and professional methods in the project guide')
  expect(first).toBe(followup)
  expect(first).not.toContain('GDD.md,')
  expect(first).not.toContain('Draft technical/resource plans first')
  expect(followup).not.toContain('eight documents')
  expect(followup).not.toContain('New design-led first-version deliverables')
  expect(followup).not.toContain('content/scenes/*.json')
  expect(followup).toContain('BGS Scene/UI editor JSON and content/index.json are not production deliverables on any platform')
  expect(followup).toContain('use the confirmed engine/platform native scene, UI and resource sources')
  expect(followup).not.toContain(PROJECT_WORKING_CONVENTIONS)
  expect(followup).not.toContain('Before creating or changing visual implementation')
  expect(agentProfessionalContextForRun({...run,creation:undefined})).not.toContain('eight documents')
  expect(agentGoalPrompt(run)).not.toContain('ORIGINAL_CONFIRMED_GOAL')
  expect(agentGoalPrompt(run)).toContain('bgsConfirmedBrief')
})

test('stable system context preserves design authority and evidence boundaries, not implementation recipes', () => {
  const message={intent:'change',text:'Change only movement speed'} as Parameters<typeof agentMessagePrompt>[0]
  for(const prompt of [false,true].map(followup=>PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run,followup))) {
    expect(prompt).toContain('Production methods and implementation choices belong to the current authorized work')
    expect(prompt).toContain(PROJECT_WORKING_CONVENTIONS)
    expect(prompt).toContain('BGS Scene/UI editor JSON and content/index.json are not production deliverables on any platform')
    expect(prompt).not.toContain('Prose, palettes and JSON geometry do not replace visual design')
    expect(prompt).not.toContain('do not create runtime scene/UI content here')
    expect(prompt).not.toContain('Use actual asset metrics and existing checks when binding resources')
    expect(prompt).not.toContain('Technical/resource plans start as drafts')
    expect(prompt).not.toContain('file_paths')
    expect(prompt).not.toContain('local_path')
    expect(prompt).not.toContain('request a separate shared PNG sheet')
    expect(prompt).not.toContain('computed equal-cell grid')
    expect(prompt.split(PROJECT_WORKING_CONVENTIONS)).toHaveLength(2)
  }
  for(const intent of ['message','change','continue'] as const) {
    const prompt=agentMessagePrompt({...message,intent})
    expect(prompt).not.toContain('eight documents')
    expect(prompt).not.toContain('full design or resource-production cycle')
    expect(prompt).toContain('Change only movement speed')
  }
})
for(const contextMode of ['resume','focused'] as const) test(contextMode+' continuation preserves pause, identity and native budget without automatic execution',async()=>{
  const f=await fixture('wait',false,undefined,undefined,0,{nativeGoalStatus:'active',nativeGoalBudget:80,pauseTokens:60})
  try {
    let run=await f.seedHistoricalGoal()
    const msg=()=>({requestKey:'continue-1',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',
      text:'Inspect partial results and continue; do not replay unknown operations',contextMode,continuationOf:run.agentTurns![0]!.attemptId})
    expect((await f.call('/agent/messages','POST',msg())).status).toBe(409)
    expect((await f.call('/resume','POST',{planRevision:run.planRevision})).status).toBe(200)
    expect(f.submissions).toHaveLength(1);run=(await f.store.read('goal-project','owner'))!
    expect((await f.call('/agent/messages','POST',{...msg(),continuationOf:'old-unrelated'})).status).toBe(400)
    f.setMode('normal');const continuation=msg()
    expect((await f.call('/agent/messages','POST',continuation)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.agentTurns![0]!.status).toBe('interrupted');expect(run.agentTurns![1]!.status).toBe('ended')
    if(contextMode==='resume') {
      expect(run.agentTurns![1]!.nativeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
      expect(f.submissions[1]!.nativeGoal).toEqual({mode:'resume'})
    } else {
      expect(f.submissions[1]!.nativeGoal).toEqual({mode:'start',objective:'Synthetic original assignment',tokenBudget:20})
      expect(f.starts[1].resumeSessionId).toBeUndefined()
      expect(run.agentTurns![1]!.nativeSessionId).not.toBe(run.agentTurns![0]!.nativeSessionId)
      const facts=JSON.parse(f.starts[1].systemContext.split('BGS current assignment: ')[1]!).executionContext
      expect(facts.previousExecution).toMatchObject({attemptId:continuation.continuationOf,status:'interrupted',externalOutcomes:'not-inferred'})
      expect(facts.requirements).not.toHaveProperty('text')
      expect(f.submissions[1].confirmedBriefContext).toBe(run.requirements.text)
      expect(facts.omitted).toContain('session permissions')
      expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toBe('Synthetic partial candidate')
    }
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
    await f.call('/agent/goal','POST',f.body)
    // Settlement persists the Run before it appends its final host evidence.
    // Finish those writes before intentionally removing the saved history.
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt) && f.sessions.transcript(r.chatSessionId).some(event=>
      event.payload?.subtype==='host_evidence' && event.payload?.attemptId===r.agentTurns![0]!.attemptId))
    const metadata=f.sessions.metadata(run.chatSessionId)!
    if(historyState==='missing')await rm(metadata.transcriptPath)
    else await writeFile(metadata.transcriptPath,'')
    const result=await f.call('/agent/messages','POST',{requestKey:'missing-history',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'change',text:'Change the target'})
    expect(result.status,await result.clone().text()).toBe(503);expect((await result.json()).code).toBe('conversation-unavailable')
    expect(f.submissions).toHaveLength(1);expect((await f.store.read(run.projectId,run.ownerId))!.requirements).toEqual(run.requirements)
  }finally{await f.close()}
})
test('restoring an older project transcript reports history mismatch without changing or replaying the native run',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const transcript=f.sessions.metadata(run.chatSessionId)!.transcriptPath
    const backup=await readFile(transcript,'utf8')
    const message=(key:string,text:string)=>({requestKey:key,runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'message',text})
    expect((await f.call('/agent/messages','POST',message('second-turn','Continue the authorized work'))).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.agentTurns![1].nativeSessionId).toBe(run.agentTurns![0].nativeSessionId)
    expect((await readFile(transcript,'utf8'))).toContain(run.agentTurns![1].turnId!)
    // Simulate restoring project files only; the authoritative Run retains turn two.
    await writeFile(transcript,backup)
    const result=await f.call('/agent/messages','POST',message('after-restore','Continue'))
    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({code:'conversation-history-mismatch',
      error:expect.stringContaining('restoring files does not roll back workflow or native conversation history')})
    expect(f.submissions).toHaveLength(2)
    expect(await f.store.read(run.projectId,run.ownerId)).toEqual(run)
    expect(await readFile(transcript,'utf8')).toBe(backup)
  }finally{await f.close()}
})
test('reconstructed worker resumes persisted native UUID and pause intent without replaying the original goal',async()=>{
  const f=await fixture('wait'),starts:any[]=[],submissions:BeeGameSessionSubmitInput[]=[]
  const sessions=new BeeGameSessionManager({async start(input){starts.push(input);input.onNativeSessionId?.(input.resumeSessionId!);return {
    async submit(turn){submissions.push(turn);input.onNativeUsage?.({prompt_tokens:5,completion_tokens:2,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:7});await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic resumed end' })},stop(){},
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
    expect(JSON.stringify(submissions[0]!.prompt)).not.toContain('first assignment ends at visual-direction handoff')
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
    const requirements=structuredClone(run.requirements), previous=structuredClone(run.agentTurns![0]!)
    f.setMode('normal')
    const continuation={requestKey:'explicit-failure-continuation',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',
      continuationOf:previous.attemptId,text:'Continue the original task using saved partial work'}
    expect((await f.call('/agent/messages','POST',continuation)).status).toBe(202)
    const resumed=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions).toHaveLength(2)
    expect(resumed.chatSessionId).toBe(run.chatSessionId)
    expect(resumed.requirements).toEqual(requirements)
    expect(resumed.agentTurns![0]).toEqual(previous)
    expect(await readFile(join(f.root,'candidate.txt'),'utf8')).toContain('partial')
    expect((await f.call('/agent/messages','POST',continuation)).status).toBe(202)
    expect(f.submissions).toHaveLength(2)
  }finally{await f.close()}
})
test('pause cancels real turn; resume only clears user pause, never restarts work',async()=>{
  const f=await fixture('wait')
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>f.submissions.length===1)
    expect((await f.call('/stop','POST')).status).toBe(202)
    const run=(await f.store.read('goal-project','owner'))!
    expect(run.writer).toBeUndefined()
    expect(run.paused).toBeDefined();expect(run.agentTurns![0]!.status).toBe('interrupted')
    expect((await f.call('/resume','POST',{planRevision:0})).status).toBe(200)
    expect((await f.store.read('goal-project','owner'))!.paused).toBeUndefined()
    await f.call('/agent/goal','POST',f.body);expect(f.submissions).toHaveLength(1)
  }finally{await f.close()}
})
test('native pause/cleanup revokes resource access before releasing its workspace writer',async()=>{
  const f=await fixture('wait',false,'https://unused-library.invalid')
  try {
    await f.call('/agent/goal','POST',f.body);const run=await f.wait(()=>f.submissions.length===1)
    const capabilityFile=projectPreviewCapabilityPath(f.root,run.chatSessionId)
    const config=JSON.parse(await readFile(capabilityFile,'utf8'))
    const url=config.assets.libraryBaseUrl+'/api/resource-search'
    expect((await fetch(url)).status).toBe(503) // no user token; upstream never called
    await f.call('/stop','POST');await f.wait(r=>Boolean(r.agentTurns![0]!.finishedAt))
    await expect(fetch(url)).rejects.toThrow()
    expect((await f.store.read('goal-project','owner'))!.writer).toBeUndefined()
  }finally{await f.close()}
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

for (const action of ['stop','resume'] as const) test(action+' settles proven leftover ownership without manual recovery or native dispatch',async()=>{
  const f=await fixture('normal',true)
  try {
    await f.call('/agent/goal','POST',f.body)
    await f.wait(r=>Boolean(r.agentTurns?.[0]?.quiescedAt))
    await Bun.sleep(20)
    f.setSettlementFailure(false)
    const response=await f.call('/'+action,'POST',action==='resume'?{planRevision:0}:{})
    expect(response.status).toBe(action==='stop'?202:200)
    const run=(await response.json()).run as Run
    expect(run.writer).toBeUndefined()
    expect(run.agentTurns![0]!.status).toBe('interrupted')
    expect(run.agentTurns![0]!.finishedAt).toBeDefined()
    expect(Boolean(run.paused)).toBe(action==='stop')
    expect(f.submissions).toHaveLength(1)
    expect(run.deliveryEligible).toBe(false)
  }finally{await f.close()}
})

test('failed image cleanup cannot claim an unconfirmed writer exit',async()=>{
  let closes=0
  const f=await fixture('normal',false,undefined,()=>({
    fetch: (request:Request) => fetch(new Request('http://127.0.0.1:1/synthetic', request)),instruction:'not a generation',
    close:async()=>{closes++;throw Error('Synthetic in-flight image outcome unconfirmed')},
  }),0,{},undefined,false,async root=>{
    const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(root,f.body.chatSessionId),'utf8'))
    expect((await fetch(capability.assets.imageEndpoint)).status).toBe(409)
  })
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>closes>0);await Bun.sleep(30)
    const run=(await f.store.read('goal-project','owner'))!
    expect(run.writer).toBeDefined();expect(run.agentTurns![0]!.quiescedAt).toBeUndefined()
    expect(run.agentTurns![0]!.finishedAt).toBeUndefined();expect(f.submissions).toHaveLength(1)
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
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'message' as const,text:'Synthetic question'}
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
test('lost goal claim response records a no-start failure without leaving a writer or replaying native work',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-goal-lost-claim-'))),base=createLocalWorkflowStore(join(root,'host'))
  let starts=0
  const sessions=new BeeGameSessionManager({async start(){starts++;throw Error('No model allowed')}},join(root,'native'),async()=>({}),{},true)
  const store:WorkflowStore={read:base.read,async commit(...args){
    await base.commit(...args)
    if(args[4]==='agent.turn-claimed')throw Error('Synthetic successful claim response lost')
  }}
  const executor=createAgentGoalExecutor({store,sessions})
  try {
    const run=createRun({projectId:'lost-claim',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'once',
      text:JSON.stringify({idea:'Synthetic no-start transport test'}),constraints:{},ids:['goal']})
    run.agentTurns=[];await base.commit(run.projectId,run.ownerId,0,run,'created')
    await expect(executor.start(run,{})).rejects.toThrow('response lost')
    const actual=(await base.read(run.projectId,run.ownerId))!
    expect(actual.writer).toBeUndefined();expect(actual.agentTurns).toHaveLength(1)
    expect(actual.agentTurns![0]).toMatchObject({status:'failed',quiescedAt:expect.any(String),finishedAt:expect.any(String)})
    expect(actual.agentTurns![0]!.turnId).toBeUndefined();expect(actual.agentTurns![0]!.nativeSessionId).toBeUndefined()
    expect(actual.agentTurns![0]!.error).toContain('before execution')
    expect(await executor.start(actual,{})).toEqual(actual.agentTurns![0])
    expect((await base.read(run.projectId,run.ownerId))!.version).toBe(actual.version);expect(starts).toBe(0)
    expect(actual.agentTurns![0]!.notStarted).toBe(true)
    // New work is distinct from continuation. Never fabricate a resumed UUID.
    await expect(executor.message(actual,{requestKey:'explicit-after-no-start',runId:actual.id,chatSessionId:actual.chatSessionId,
      expectedVersion:actual.version,requirementsRevision:actual.requirements.revision,intent:'continue',
      continuationOf:actual.agentTurns![0]!.attemptId,text:'Synthetic explicit follow-up'},{}))
      .rejects.toThrow('never started')
    expect(starts).toBe(0)
    const legacy=(await base.read(run.projectId,run.ownerId))!;delete legacy.agentTurns![0]!.notStarted
    await expect(executor.message(legacy,{requestKey:'no-proof',runId:actual.id,chatSessionId:actual.chatSessionId,
      expectedVersion:actual.version,requirementsRevision:actual.requirements.revision,intent:'work',text:'Synthetic new work'},{}))
      .rejects.toThrow('No saved native conversation or settled turn')
  }finally{await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})
test('proven no-start requires a new explicit work request; duplicate goal, pause and stale authorization never dispatch',async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{claimResponses:1})
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(500)
    let run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    expect(run.agentTurns![0]).toMatchObject({status:'failed',notStarted:true});expect(f.submissions).toHaveLength(0)
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202);expect(f.submissions).toHaveLength(0)
    const body={requestKey:'explicit-work',runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,intent:'work',text:'Explicit new work: implement the current confirmed requirements in the existing project.'}
    await f.call('/stop','POST');run=(await f.store.read(run.projectId,run.ownerId))!
    expect((await f.call('/agent/messages','POST',{...body,expectedVersion:run.version})).status).toBe(409)
    await f.call('/resume','POST',{planRevision:0});run=(await f.store.read(run.projectId,run.ownerId))!
    expect((await f.call('/agent/messages','POST',body)).status).toBe(409);expect(f.submissions).toHaveLength(0)
    const request={...body,expectedVersion:run.version}
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202)
    const ended=await f.wait(r=>Boolean(r.agentTurns![1]?.finishedAt))
    expect(ended.agentTurns![1]!.status).toBe('ended');expect(ended.agentTurns![1]!.notStarted).toBeUndefined()
    expect(ended.requirements).toEqual(run.requirements);expect(ended.id).toBe(run.id)
    expect(f.submissions).toHaveLength(1);expect(f.starts[0].resumeSessionId).toBeUndefined()
    expect(JSON.stringify(f.submissions[0]!.prompt)).toContain(body.text)
    expect(JSON.stringify(f.submissions[0]!.prompt)).not.toContain('first assignment ends at visual-direction handoff')
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202);expect(f.submissions).toHaveLength(1)
    const forged=structuredClone(ended);forged.version++;delete forged.agentTurns![0]!.notStarted
    await expect(f.store.commit(run.projectId,run.ownerId,ended.version,forged,'forged')).rejects.toThrow('history')
  }finally{await f.close()}
})
test('unsubmitted design changes are carried once without duplicating system context',async()=>{
  const faults={claimResponses:0},change='PENDING-DESIGN-CHANGE: retain the user constraint'
  let verify=false
  const f=await fixture('normal',false,undefined,undefined,0,faults,undefined,true,async(_root,input,context)=>{
    if(!verify)return // An unfinished initial design is retained, not submitted.
    const prompt=JSON.stringify(input.prompt)
    expect(prompt.split('Confirmed user data not previously submitted to native:')).toHaveLength(2)
    expect(prompt.split(change)).toHaveLength(2)
    expect(context).not.toContain('Confirmed user data not previously submitted to native:')
    expect(input.finalOutput!.answer).toBeDefined()
    expect(await input.finalOutput!.answer!({status:'answered',summary:'Retained pending design request.'})).toBe('Retained pending design request.')
    expect(await input.finalOutput!.answer!({status:'answered',summary:'Retained pending design request.',sections:[],files:[],reviewResponses:[]})).toBe('Retained pending design request.')
    expect(await input.finalOutput!.answer!({status:'answered',summary:'Must not submit a source.',files:['docs/GDD.md']})).toBeUndefined()
  })
  Object.assign(f.body.brief,{creation_mode:'blueprint',build_source:null})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    faults.claimResponses=1
    const response=await f.call('/agent/messages','POST',{requestKey:'unsubmitted-change',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'change',text:change})
    expect(response.status).toBe(500)
    run=await f.wait(r=>Boolean(r.agentTurns!.at(-1)?.notStarted)&&!r.writer)
    expect(f.submissions).toHaveLength(1)
    expect(run.requirements.text).toContain(change)
    verify=true
    const next=await f.call('/agent/messages','POST',{requestKey:'inspect-pending-design',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text:'Explain current design progress without editing.'})
    expect(next.status,await next.clone().text()).toBe(202)
    run=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='inspect-pending-design'&&Boolean(r.agentTurns!.at(-1)?.finishedAt)&&!r.writer)
    expect(run.agentTurns!.at(-1)!.status,run.agentTurns!.at(-1)!.error).toBe('ended')
    expect(run.requirements.text).toContain(change)
    expect(f.submissions).toHaveLength(2)
  }finally{await f.close()}
})

test('original host can explicitly persist observed native exit after DB failure',async()=>{
  const faults={exitWrites:true,exitFailures:0},f=await fixture('normal',false,undefined,undefined,0,faults)
  const other=createAgentGoalExecutor({store:f.store,sessions:f.sessions})
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>faults.exitFailures>0)
    expect(run.agentTurns![0]!.quiescedAt).toBeUndefined();expect(f.submissions).toHaveLength(1)
    const detail=await (await f.call('')).json();expect(detail.recoveryEvidence).toBe('original-host')
    expect(await other.recoveryEvidence(run)).toBe('host-idle')
    faults.exitWrites=false
    const response=await f.call('/recover-writer','POST',{expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence})
    expect(response.status,await response.clone().text()).toBe(200)
    run=(await f.store.read(run.projectId,run.ownerId))!
    expect(run.writer).toBeUndefined();expect(run.agentTurns![0]!.quiescedAt).toBeDefined()
    expect(run.agentTurns![0]!.status).toBe('interrupted');expect(run.agentTurns![0]!.nativeSessionId).toBeDefined()
    expect(f.submissions).toHaveLength(1);expect(run.deliveryEligible).toBe(false)
  }finally{await other.dispose();await f.close()}
})
test('a reconstructed executor cannot unlock an active project turn',async()=>{
  const f=await fixture('wait')
  const recovery=createAgentGoalExecutor({store:f.store,sessions:f.sessions})
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(()=>f.submissions.length===1)
    await expect(recovery.recover(run,{expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence}))
      .rejects.toThrow('still active')
    await expect(recovery.resume(run)).rejects.toThrow('still active')
    expect(f.submissions).toHaveLength(1);expect((await f.store.read('goal-project','owner'))!.writer).toEqual(run.writer)
  }finally{await recovery.dispose();await f.close()}
})
test('lost change claim response preserves the authorized requirement change without launching another native turn',async()=>{
  const f=await fixture(),executor=createAgentGoalExecutor({sessions:f.sessions,store:{read:f.store.read,async commit(...args){
    await f.store.commit(...args)
    if(args[4]==='requirements.changed')throw Error('Synthetic authorized change response lost')
  }}})
  try {
    await f.call('/agent/goal','POST',f.body)
    const before=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    const message={requestKey:'lost-change',runId:before.id,chatSessionId:before.chatSessionId,expectedVersion:before.version,
      requirementsRevision:before.requirements.revision,intent:'change' as const,text:'Synthetic new color requirement'}
    await expect(executor.message(before,message,{})).rejects.toThrow('response lost')
    const after=(await f.store.read(before.projectId,before.ownerId))!
    expect(after.writer).toBeUndefined();expect(after.agentTurns![1]!.status).toBe('failed')
    expect(after.requirements.revision).not.toBe(before.requirements.revision)
    expect(after.requirementChanges![0]!.before).toEqual(before.requirements)
    expect(after.requirementChanges![0]!.after).toEqual(after.requirements)
    expect(['plans','tasks','attempts'].some(key=>key in after)).toBe(false);expect(f.submissions).toHaveLength(1)
    expect(await executor.message(after,message,{})).toEqual(after.agentTurns![1])
    expect(f.submissions).toHaveLength(1)
    expect(after.agentTurns![1]!.notStarted).toBe(true)
    expect(after.agentTurns![1]!.nativeSessionId).toBe(before.agentTurns![0]!.nativeSessionId)
    await executor.message(after,{requestKey:'new-work-after-change',runId:after.id,chatSessionId:after.chatSessionId,
      expectedVersion:after.version,requirementsRevision:after.requirements.revision,intent:'work',text:'Implement the current changed requirements.'},{})
    const completed=await f.wait(r=>Boolean(r.agentTurns![2]?.finishedAt))
    expect(completed.agentTurns![2]!.status).toBe('ended')
    expect(f.starts[1].resumeSessionId).toBe(before.agentTurns![0]!.nativeSessionId)
    expect(f.submissions).toHaveLength(2)
    expect(JSON.stringify(f.submissions[1]!.prompt)).toContain('authorized_user_changes')
    expect(JSON.stringify(f.submissions[1]!.prompt)).toContain('Synthetic new color requirement')
  }finally{await executor.dispose();await f.close()}
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
    expect(paused!.paused).toBeDefined();expect(paused!.writer).toBeUndefined()
    expect(paused!.agentTurns![0]!.status).toBe('interrupted')
    expect(paused!.agentTurns![0]!.quiescedAt).toBeDefined()
    expect(paused!.agentTurns).toHaveLength(1)
  }finally{await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})


test('first and resumed goals retain professional coverage and design dependencies within the confirmed scope', () => {
  const run = createRun({ projectId: 'prompt', ownerId: 'owner', workspacePath: '/synthetic', chatSessionId: 'chat', requestKey: 'once', text: 'CONFIRMED_GAME', constraints: { engine: 'React', platform: 'Web' }, ids: ['goal'] })
  run.creation = { initialDelivery: 'design-led-first-version', editableContent: true }
  for (const professional of [agentProfessionalContextForRun(run),agentProfessionalContextForRun(run,true)]) {
    const prompt=PROJECT_WORKING_CONVENTIONS+'\n'+professional
    expect(prompt).toContain(PROJECT_WORKING_CONVENTIONS)
    for (const source of ['docs/GDD.md','Manifest','Native resource metadata, code/data and configuration']) expect(prompt).toContain(source)
    expect(prompt).not.toContain('Cover applicable gameplay, space, balance, art, UI/UX, audio, resources and technical responsibilities')
    expect(prompt).not.toContain('Use actual asset metrics and existing checks when binding resources')
    expect(prompt).toContain('The current user assignment determines deliverables and stopping point')
    expect(prompt).toContain('Preserve confirmed requirements')
    expect(prompt).toContain('Production methods and implementation choices belong to the current authorized work')
    expect(prompt).not.toContain('Verification records')
    expect(prompt).toContain('Reuse valid observations for unchanged conditions')
    expect(professional).not.toContain('Select applicable Skills for concrete problems')
    expect(professional).not.toContain('verify required behavior and presentation in the target runtime')
    for(const name of ['gameplay-programmer','game-technical-artist','game-feel-designer','root-cause-debugging'])
      expect(professional).not.toContain(name)
    expect(prompt).not.toContain('not certification')
    expect(prompt).not.toContain('game-quality acceptance')
    expect(prompt).toContain('disclose known defects and unverified behavior')
  }
  expect(agentGoalPrompt(run)).toContain('Stop at the requested boundary')
  expect(agentGoalPrompt(run)).not.toContain('Plan and execute autonomously')
  expect(agentGoalPrompt(run)).not.toContain('CONFIRMED_GAME')
  expect(agentGoalPrompt(run)).toContain('bgsConfirmedBrief')
  const slice={...run,creation:{initialDelivery:'playable-slice'}} as Run
  expect(agentGoalPrompt(slice)).toContain('Reduced content quantity does not waive the required design dependencies')
  for(const prompt of [agentGoalPrompt(run),agentGoalPrompt(slice)]) {
    expect(prompt).not.toContain('game-quality acceptance')
    expect(prompt).toContain('Reuse valid observations and recheck affected behavior after changes')
    expect(prompt).toContain('remaining defects, unverified behavior or external blockers')
  }
})

test('turn-end host evidence lists actual design changes even when the native answer omits them',async()=>{
  const f=await fixture('wait')
  try {
    await writeDesignDocumentsFixture(f.root)
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>f.submissions.length===1)
    const path='content/ui/menu.json'
    await writeFile(join(f.root,path),(await readFile(join(f.root,path),'utf8'))+'\n')
    // The synthetic native final answer contains no changed-file list.
    await f.call('/stop','POST')
    run=await f.wait(r=>!r.writer)
    const files=run.agentTurns![0]!.designFileChanges!
    expect(files).toMatchObject({status:'observed',attemptId:run.agentTurns![0]!.attemptId})
    expect(files.files).toContainEqual({path,change:'modified'})
    const host=f.sessions.transcript(run.chatSessionId).find(event=>event.payload?.subtype==='host_evidence')!
    expect(host.payload!.designFileChanges).toEqual(files)
    expect(host.text).toContain(path)
    expect(run.deliveryEligible).toBe(false)
  } finally {await f.close()}
})


test('ordinary questions retain answers and task identity without an unlock or extra turn',async()=>{
  const f=await fixture('wait')
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(()=>f.submissions.length===1)
    const before=structuredClone(run),question='Which resource treatment is intended?'
    const answer=f.submissions[0]!.requestPermission({toolUseID:'resource-question',toolName:'AskUserQuestion',message:question,
      input:{questions:[{question,options:[{label:'Static'},{label:'Animated'}]}]}})
    for(let i=0;i<200&&!f.sessions.pendingPermissionsForProject('owner',run.projectId,f.root).length;i++)await Bun.sleep(5)
    const pending=f.sessions.pendingPermissionsForProject('owner',run.projectId,f.root)[0]!
    expect(pending).not.toHaveProperty('designChangeAllowed')
    expect(()=>f.sessions.resolvePermission(run.chatSessionId,pending.toolUseID,
      {behavior:'allow',answers:{[question]:'Animated'},intent:'change'})).toThrow('Question answers do not rewrite')
    f.sessions.resolvePermission(run.chatSessionId,pending.toolUseID,{behavior:'allow',answers:{[question]:'Animated'}})
    expect((await answer).behavior).toBe('allow')
    expect(await f.store.read(run.projectId,run.ownerId)).toEqual(before)
    expect(f.submissions).toHaveLength(1)
  } finally {await f.close()}
},30000)

test('new and resumed goals retain requested scope while Agent selects Skills; follow-ups preserve literal intent', () => {
  const run={creation:{initialDelivery:'design-led-first-version'},requirements:{text:'BRIEF budget 20000000'}} as Run
  expect(agentGoalPrompt(run)).not.toStartWith('$')
  expect(agentGoalPrompt(run)).not.toContain('Select relevant Skills, organize the work')
  expect(agentGoalPrompt(run)).toContain('Stop at the requested boundary')
  expect(agentGoalPrompt(run)).toContain('Respect the production dependencies for work in scope')
  expect(agentGoalPrompt(run)).toContain('do not infer additional deliverables from the project creation mode')
  expect(agentGoalPrompt(run)).not.toContain(run.requirements.text)
  expect(agentGoalPrompt(run)).toContain('bgsConfirmedBrief')
  for(const other of [{...run,creation:undefined},{...run,creation:{initialDelivery:'playable-slice'}},
    {...run,agentTurns:[{nativeSessionId:'existing-context'}]}]) {
    expect(agentGoalPrompt(other as Run)).not.toStartWith('/')
    expect(agentGoalPrompt(other as Run)).not.toContain('$game-creative-director-expert')
    expect(agentGoalPrompt(other as Run)).toContain('Complete the currently authorized player behavior, presentation and feedback')
    expect(agentGoalPrompt(other as Run)).toContain('Judge completion against those requirements and repair observed deviations')
    expect(agentGoalPrompt(other as Run)).not.toContain('Alternative cosmetic preferences')
    expect(agentProfessionalContextForRun(other as Run)).toContain(DESIGN_DECISION_SCOPE)
    expect(agentProfessionalContextForRun(other as Run,true).split(DESIGN_DECISION_SCOPE)).toHaveLength(2)
    expect(DESIGN_DECISION_SCOPE).toContain('Explicitly requested scope takes precedence')
    expect(DESIGN_DECISION_SCOPE).toContain('presentation and feedback for the agreed gameplay remain implementation work')
    expect(DESIGN_DECISION_SCOPE).toContain('User-specified layouts and selected visual designs remain constraints')
    expect(DESIGN_DECISION_SCOPE).toContain('initial layout proposal remains to be developed in concrete visual work, not confirmed by document completion or review')
    expect(agentGoalPrompt(other as Run)).toContain('Reuse valid observations and recheck affected behavior after changes')
  }
  for(const intent of ['message','work','continue','change'] as const)
    expect(agentMessagePrompt({intent,text:'继续处理'} as any)).not.toContain('/bgs-builtins:')
})

test('Web/React uses native code on initial and resumed work regardless of historical editor flags', () => {
  const run=createRun({projectId:'sample',ownerId:'owner',workspacePath:'/unused',chatSessionId:'chat',
    requestKey:'start',text:'Confirmed Web project',constraints:{platform:'Web',engine:'React'},ids:['goal']})
  for (const editableContent of [true,false]) for (const followup of [true,false]) {
    run.creation={initialDelivery:'design-led-first-version',editableContent}
    const context=agentProfessionalContextForRun(run,followup)
    expect(context).toContain('use the confirmed engine/platform native scene, UI and resource sources')
    expect(context).toContain('Preserve existing runtime dependencies')
    expect(context).toContain('Managed Vite Preview already rebases file-like root-relative static URLs')
    expect(context).toContain('extensionless app/API routes are unchanged')
    expect(context).toContain('localStorage/sessionStorage can throw in the opaque iframe')
    expect(context).not.toContain('root-absolute asset/content URLs can escape')
    expect(context).toContain('use the confirmed engine/platform native scene, UI and resource sources')
    expect(context).not.toContain('BGS Editor reads')
    expect(context).not.toContain('This project requires BGS visual editing')
  }
})


test('initial native completion needs no report or receipt while later design-only work retains its own scope',async()=>{
  const faults={noAssistant:false}
  const f=await fixture('normal',false,undefined,undefined,0,faults)
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(f.submissions).toHaveLength(1)
    expect(f.starts[0].nativeGoal).toEqual(f.submissions[0]!.nativeGoal)
    expect(f.submissions[0]!.nativeGoal).toBeUndefined()
    expect(f.submissions[0]!.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(run.status).toBe('completed')
    expect(run.blockedReason).toBeUndefined()
    expect(run.writer).toBeUndefined()
    expect(run.deliveryEligible).toBe(false)
    expect(run.agentTurns![0]!.status).toBe('ended')
    expect(run.agentTurns![0]!.deliverySubmission).toBeUndefined()
    expect(run.agentTurns![0]!.measurements).toBeUndefined()
    expect(f.submissions[0]!.prompt).toContain('End with the implemented result, checks actually performed')
    await expect(readFile(join(f.root,DESIGN_ACCEPTANCE_PATH))).rejects.toMatchObject({code:'ENOENT'})
    const events=f.sessions.transcript(run.chatSessionId)
    expect(events.some(event=>event.type==='turn.completed')).toBe(true)
    expect(events.some(event=>event.type==='turn.empty')).toBe(false)
    expect(events.find(event=>event.payload?.subtype==='host_evidence')?.payload)
      .toMatchObject({quality:'unverified',deliveryEligible:false})
    await f.call('/agent/messages','POST',{requestKey:'design-only-after-build',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Review the GDD design only; do not implement or run the game.'})
    const designOnly=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(designOnly.status).toBe('completed')
    expect(designOnly.agentTurns![1]!.status).toBe('ended')
    expect(designOnly.deliveryEligible).toBe(false)
    faults.noAssistant=true
    await f.call('/agent/messages','POST',{requestKey:'empty-answer',runId:designOnly.id,chatSessionId:designOnly.chatSessionId,
      expectedVersion:designOnly.version,requirementsRevision:designOnly.requirements.revision,text:'Explain progress only.'})
    const empty=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt)),turnId=empty.agentTurns![2]!.turnId
    expect(empty.agentTurns![2]!.status).toBe('failed')
    expect(empty.status).toBe('blocked')
    expect(empty.deliveryEligible).toBe(false)
    const terminal=f.sessions.transcript(empty.chatSessionId).filter(event=>event.turnId===turnId)
    expect(terminal.some(event=>event.type==='turn.empty')).toBe(true)
    expect(terminal.some(event=>event.type==='turn.completed')).toBe(false)
  }finally{await f.close()}
})

test('interrupted implementation resumes and completes without report, measurement or explicit submission',async()=>{
  const f=await fixture('wait')
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>f.submissions.length===1)
    await f.call('/stop','POST')
    run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.agentTurns![0]!.status).toBe('interrupted')
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    f.setMode('normal')
    const continuation={requestKey:'continue-initial-build',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue' as const,
      continuationOf:run.agentTurns![0]!.attemptId,text:'Continue the interrupted implementation.'}
    expect((await f.call('/agent/messages','POST',continuation)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions).toHaveLength(2)
    expect(f.submissions[1]!.nativeGoal).toBeUndefined()
    expect(f.starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(run.agentTurns![1]!.status).toBe('ended')
    expect(run.status).toBe('completed')
    expect(run.blockedReason).toBeUndefined()
    expect(run.deliveryEligible).toBe(false)
    expect(f.sessions.transcript(run.chatSessionId).some(event=>event.payload?.subtype==='delivery_submission')).toBe(false)
  }finally{await f.close()}
})

for(const status of ['blocked','budgetLimited'] as const)test(`native Goal ${status} ends execution without claiming completion or dispatching another request`,async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{nativeGoalStatus:status})
  try {
    let run=await f.seedHistoricalGoal()
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    await f.call('/agent/messages','POST',{requestKey:'historical-'+status,runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',
      continuationOf:run.agentTurns![0]!.attemptId,text:'Continue the saved Goal.'})
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions[1]!.nativeGoal).toEqual({mode:'resume'})
    expect(run.status).toBe('blocked')
    expect(run.blockedReason).toContain('Codex Goal '+status)
    expect(run.deliveryEligible).toBe(false)
    expect(run.writer).toBeUndefined()
    expect(f.submissions).toHaveLength(2)
  }finally{await f.close()}
})

test('explicit continuation preserves native Goal while ordinary Chat does not activate it',async()=>{
  const f=await fixture('wait',false,undefined,undefined,0,{nativeGoalStatus:'active'})
  try {
    let run=await f.seedHistoricalGoal()
    const native=run.chatSessionId
    const previous=run.agentTurns![0]!
    expect(previous.status).toBe('interrupted')
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    f.setMode('normal')
    const request={requestKey:'goal-native-resume',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',
      continuationOf:previous.attemptId,text:'Continue the interrupted work.'}
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions[1]!.nativeGoal).toEqual({mode:'resume'})
    expect(f.starts[1].nativeGoal).toEqual({mode:'resume'})
    expect(f.starts[1].resumeSessionId).toBe(previous.nativeSessionId)
    expect(run.chatSessionId).toBe(native)
    const question={requestKey:'goal-question',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text:'Explain the current progress only.'}
    expect((await f.call('/agent/messages','POST',question)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt))
    expect(f.submissions[2]!.nativeGoal).toBeUndefined()
    expect(f.starts[2].nativeGoal).toBeUndefined()
    expect(f.submissions[2]!.prompt).toBe('User message:\n'+question.text)
    expect(f.submissions).toHaveLength(3)
  }finally{await f.close()}
})

test('native completion observation cannot hide an execution failure',async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{nativeGoalStatus:'complete'})
  try {
    let run=await f.seedHistoricalGoal()
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    f.setMode('fail')
    await f.call('/agent/messages','POST',{requestKey:'failed-native-completion',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',
      continuationOf:run.agentTurns![0]!.attemptId,text:'Continue the saved Goal.'})
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions[1]!.nativeGoal).toEqual({mode:'resume'})
    expect(f.sessions.transcript(run.chatSessionId).findLast(event=>event.turnId===run.agentTurns![1]!.turnId &&
      event.payload?.subtype==='native_goal')).toMatchObject({payload:{nativeGoal:{status:'complete'}}})
    expect(run.status).toBe('blocked')
    expect(run.agentTurns![1]!.status).toBe('failed')
    expect(run.deliveryEligible).toBe(false)
  }finally{await f.close()}
})


test('BGS assignments preserve full scope without automatically imposing a token budget',async()=>{
  const f=await fixture()
  try {
    Object.assign(f.body.brief.settings,{tokenBudget:999999999})
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(f.submissions[0]!.nativeGoal).toBeUndefined()
    expect(f.starts[0].nativeGoal).toBeUndefined()
    expect(f.submissions[0]!.prompt).toBe(agentGoalPrompt(run))
    expect(f.submissions[0]!.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(run.requirements.text).toBe(JSON.stringify(f.body.brief))
    const work={requestKey:'budgeted-followup',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Finish the requested remaining behavior.'}
    expect((await f.call('/agent/messages','POST',work)).status).toBe(202)
    await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions[1]!.nativeGoal).toBeUndefined()
    expect(f.submissions[1]!.prompt).toContain(work.text)
    expect(f.starts[1].systemContext).toContain('no additional implementation handoff is required')
  }finally{await f.close()}
})

for(const contextMode of ['resume','focused'] as const)test(contextMode+' continuation preserves an unlimited Goal regardless of its recorded token usage',async()=>{
  const f=await fixture('wait',false,undefined,undefined,0,{nativeGoalStatus:'active',nativeGoalBudget:null,pauseTokens:2000000,pauseUnavailable:true})
  try {
    let run=await f.seedHistoricalGoal()
    const previous=run.agentTurns![0]!
    await f.call('/resume','POST',{planRevision:run.planRevision});run=(await f.store.read(run.projectId,run.ownerId))!
    f.setMode('normal')
    expect((await f.call('/agent/messages','POST',{requestKey:'bounded-legacy-'+contextMode,runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',contextMode,
      continuationOf:previous.attemptId,text:'Continue the saved assignment.'})).status).toBe(202)
    await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions[1]!.nativeGoal).toEqual(contextMode==='resume' ? {mode:'resume'} :
      {mode:'start',objective:'Synthetic original assignment'})
  }finally{await f.close()}
})

test('focused continuation preserves an explicitly configured native budget when pause accounting is unavailable',async()=>{
  const f=await fixture('wait',false,undefined,undefined,0,{nativeGoalStatus:'active',nativeGoalBudget:80,pauseUnavailable:true})
  try {
    let run=await f.seedHistoricalGoal()
    const previous=run.agentTurns![0]!
    await f.call('/resume','POST',{planRevision:run.planRevision});run=(await f.store.read(run.projectId,run.ownerId))!
    expect((await f.call('/agent/messages','POST',{requestKey:'unknown-budget',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',contextMode:'focused',
      continuationOf:previous.attemptId,text:'Continue.'})).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions).toHaveLength(1)
    expect(run.status).toBe('blocked')
    expect(run.blockedReason).toContain('no final usage snapshot')
  }finally{await f.close()}
})


async function workflowCommand(root:string,context:string,value:unknown) {
  const directory=JSON.parse(context.match(/Current BGS tools directory \(absolute path\): ("[^"\n]+")./)![1]!)
  const command=await readFile(resolve(root,directory,'workflow.mjs'),'utf8')
  const sessionId=JSON.parse(command.match(/capability.sessionId!==("[^"\n]+")/)![1]!)
  const {assets:{registrationEndpoint:endpoint}}=JSON.parse(await readFile(projectPreviewCapabilityPath(root,sessionId),'utf8'))
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workflow:value})})
  const result=await response.json() as any
  if(!response.ok)throw Error(result.error)
  return result
}

for(const settings of [{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}, {platform:'PC',engine:'Unity',dimension:'3D',orientation:'Landscape'}])
test(`one GDD author hands the reviewed document directly to implementation without a duplicate author audit: ${settings.engine}`,async()=>{
  const source='# Synthetic design\n\n'+('A saved decision from the complete source.\n'.repeat(650))
  const userText='Synthetic goal; preserve chosen engine, 3 lives and a 60-second limit'
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input,context)=>{
    if(!input.finalOutput)return
    if(!input.finalOutput.writeDocument) {
      if(input.finalOutput.answer) {
        expect(await input.finalOutput.answer({status:'answered',summary:'The reviewed GDD is saved.'})).toBe('The reviewed GDD is saved.')
        return
      }
      throw new ProductionBlockedError('Synthetic visual boundary')
    }
    expect(input.nativeGoal).toBeUndefined()
    expect(input.workflow).toBeDefined();expect(input).not.toHaveProperty('measurement');expect(input).not.toHaveProperty('finishDelivery')
    expect(input.finalOutput.readOnly).toBe(true)
    const reviewContext=input.finalOutput.designReview!.context
    for (const clause of reviewContext.split('\n')) expect(context).toContain(clause)
    expect(context).toContain(DESIGN_DECISION_SCOPE)
    expect(reviewContext).toContain(DESIGN_DECISION_SCOPE)
    expect(reviewContext).toContain('remain provisional rather than acceptance obligations')
    expect(input.confirmedBriefContext).toContain('3 lives and a 60-second limit')
    expect(context.split(DESIGN_DECISION_SCOPE)).toHaveLength(2)
    expect(reviewContext.split(DESIGN_DECISION_SCOPE)).toHaveLength(2)
    expect(context).not.toContain('Record governing gameplay quantities')
    expect(reviewContext).not.toContain('Record governing gameplay quantities')
    expect(reviewContext).toContain('Current design work develops the confirmed player experience.')
    expect(reviewContext).toContain('Its design record and any selected visual sources feed implementation')
    expect(reviewContext).not.toContain('WriteProjectFile')
    expect(reviewContext).not.toContain('Skills')
    for(const value of [context,reviewContext])
      expect(value).not.toMatch(/Phaser|Three\.js|sandboxed opaque iframe|URL subpath|localStorage|sessionStorage/)
    expect(context).not.toContain('Current BGS tools directory')
    expect(context).not.toContain('Self-check the complete confirmed scope')
    expect(context).not.toContain('For returned findings')
    expect(context).not.toContain('Keep resources registered')
    expect(context).not.toContain('observe actual rendering')
    expect(input.prompt).toContain('BGS current production stage: design')
    expect(input.prompt).toContain('from the confirmed brief and existing work')
    expect(input.prompt).not.toContain('and actual pictures')
    expect(input.prompt).not.toContain(userText)
    expect(input.confirmedBriefContext).toContain(userText)
    expect(input.prompt).toContain('Choose the design methods and the content, structure and depth')
    expect(context).not.toContain('Determine the product decisions still needed')
    expect(context).toContain('small-scope game with a complete core experience')
    expect(reviewContext).not.toContain('Select artwork sources and representations')
    expect(String(input.prompt)).not.toContain('usable initial tuning')
    expect(String(input.prompt)).not.toContain('identified current feasibility question')
    await expect(readFile(join(root,'docs/GDD.md'),'utf8')).rejects.toThrow()
    expect(input.finalOutput.writeDocument.path).toBe('docs/GDD.md')
    await input.finalOutput.writeDocument.authorize()
    await mkdir(join(root,'docs'),{recursive:true})
    await writeFile(join(root,'docs/treatment.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
    if (!input.workflow) throw Error('Expected native selection capability')
    await input.workflow({action:'select-visual',summary:'Adopted composition',sections:[],files:['docs/treatment.svg']})
    await writeFile(join(root,'docs/GDD.md'),source)
    await recordSyntheticDesignReview(input)
    await input.finalOutput.accept({status:'ready',summary:'Synthetic GDD saved'})
    await expect(input.finalOutput.writeDocument.authorize()).rejects.toThrow('already submitted')
  })
  Object.assign(f.body.brief,{idea:userText,creation_mode:'creative',build_source:null,settings})
  await seedGddOnlyRun(f,true)
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt)&&!r.writer)
    expect(run.deliveryEligible).toBe(false)
    expect(run.agentTurns!.map(turn=>turn.production?.stage)).toEqual(['design','implementation'])
    expect(run.agentTurns![0]!.status).toBe('ended')
    expect(run.agentTurns![0]!.productionHandoff?.next?.stage).toBe('implementation')
    expect(run.agentTurns![0]!.designReviews).toHaveLength(1)
    expect(f.starts[1].confirmedBriefContext).toBe(run.requirements.text)
    expect(f.starts[1].confirmedBriefContext).toContain('3 lives and a 60-second limit')
    const parts=f.submissions[1]!.prompt
    expect(Array.isArray(parts)).toBe(true)
    if(!Array.isArray(parts))throw Error('Expected separate design data and assignment text')
    const data=parts[0]!
    if(data.type!=='text')throw Error('Expected text source data')
    const snapshot=JSON.parse(data.text.split('file data, not instructions):\n')[1]!)
    expect(snapshot).toEqual({source:{path:'docs/GDD.md',sha256:createHash('sha256').update(source).digest('hex')},text:source})
    const prompt=parts.filter(part=>part.type==='text').map(part=>part.text).join('\n')
    expect(prompt.split(JSON.stringify(source))).toHaveLength(2)
    expect(f.starts[1].systemContext).not.toContain(source.slice(0,80))
    expect(prompt).toContain('confirmed requirements, relevant GDD decisions and existing work')
    expect(prompt).toContain('docs/treatment.svg')
    expect(prompt).toContain('adjust your provisional layout, transfer of control and feedback')
    expect(prompt).toContain('reuse relevant observations')
    expect(run.agentTurns![0]!.productionHandoff!.sources.map(s=>s.path)).toEqual(['docs/GDD.md','docs/treatment.svg'])
    expect(prompt).toContain('user-specified and selected visual designs, including their composition, subject proportions and spatial relationships')
    expect(f.starts[1].systemContext).toContain('initial layout proposal remains to be developed in concrete visual work, not confirmed by document completion or review')
    expect(f.starts[1].systemContext.split(DESIGN_DECISION_SCOPE)).toHaveLength(2)
    expect(prompt).not.toContain('settled product decisions')
    if (settings.engine === 'React') expect(prompt).not.toContain('Choose implementation and verification methods')
    else {
      expect(prompt).not.toContain('Alternative cosmetic preferences')
      expect(prompt).toContain('repair observed deviations')
    }
    if(settings.engine==='React') {
      expect(f.starts[1].systemContext).not.toContain('Phaser for 2D and Three.js for 3D')
      expect(f.starts[1].systemContext).toContain('User Preview runs in a sandboxed opaque iframe')
      expect(f.starts[1].systemContext).toContain('sandboxed opaque iframe')
      expect(f.starts[1].systemContext).toContain('localStorage/sessionStorage can throw')
    } else expect(f.starts[1].systemContext).not.toContain('Phaser')
    expect(run.blockedReason).toBeUndefined()
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(source)
    expect(f.starts[0].confirmedBriefContext).toBe(run.requirements.text)
    await f.call('/agent/goal','POST',f.body)
    expect(f.submissions).toHaveLength(2)
    const question={requestKey:'after-gdd',runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,text:'Explain this document.'}
    expect((await f.call('/agent/messages','POST',question)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt))
    expect(f.submissions[2]!.finalOutput).toBeUndefined()
    expect(f.submissions[2]!.finalOutput?.writeDocument).toBeUndefined()
    expect(f.submissions[2]!.nativeGoal).toBeUndefined()
    expect(run.agentTurns![2]!.production?.stage).toBe('implementation')
    expect(f.submissions[2]!.prompt).toBe('User message:\n'+question.text)
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(source)
  }finally{await f.close()}
},30000)

for(const outcome of ['missing','changed','failed','paused'] as const)test('production does not automatically advance after '+outcome,async()=>{
  let handed=false
  const f=await fixture(outcome==='failed'?'fail':outcome==='paused'?'wait':'normal',false,undefined,undefined,0,{},undefined,true,async(root,_input,context)=>{
    if(outcome==='missing')return
    await mkdir(join(root,'docs'),{recursive:true})
    await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nSaved design facts.\n')
    await _input.finalOutput!.writeDocument!.authorize()
    await recordSyntheticDesignReview(_input)
    await _input.finalOutput!.accept({status:'ready',summary:'Synthetic handoff'})
    if(outcome==='changed')await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nChanged after handoff.\n')
    handed=true
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    if(outcome==='paused') {await f.wait(()=>handed);await f.call('/stop','POST')}
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt) && (outcome==='paused' ||
      f.sessions.transcript(r.chatSessionId).some(e=>e.payload?.category==='workflow-blocked')))
    expect(run.status).toBe('blocked');expect(f.submissions).toHaveLength(1);expect(run.writer).toBeUndefined()
    if(outcome==='changed')expect(run.blockedReason).toContain('changed after submission')
    const notices=f.sessions.transcript(run.chatSessionId).filter(e=>e.payload?.category==='workflow-blocked')
    expect(notices).toHaveLength(outcome==='paused'?0:1)
    if(outcome!=='paused')expect(notices[0]!.payload?.subtype).toBe('delivery_error')
    if(outcome==='missing') {
      expect(notices[0]!.text).toContain('缺少有效交接')
      expect(run.blockedReason).toContain('without its source-bound workflow handoff')
      const response=await f.call('/agent/messages','POST',{requestKey:'explicit-resume',runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:run.agentTurns![0]!.attemptId,text:'Continue the unfinished design'})
      expect(response.status,await response.clone().text()).toBe(202)
      run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
      expect(run.agentTurns![1]!.production).toEqual(run.agentTurns![0]!.production)
      expect(f.starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
      expect(f.submissions[1]!.nativeGoal).toBeUndefined()
    }
  }finally{await f.close()}
},30000)

for(const intent of ['message','work','change'] as const)test(`later ${intent} implementation entry retains only that user assignment; ordinary design ends without Goal`,async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,false,async(root,input,context)=>{
    if(String(input.prompt)==='User message:\nImplement only the authorized local correction.')
      await workflowCommand(root,context,{action:'implement',summary:'Current local implementation',sections:[],files:[]})
  })
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const message=(requestKey:string,text:string)=>({requestKey,runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,intent,text})
    await f.call('/agent/messages','POST',message('design-only','Revise only the design.'))
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.status).toBe('completed');expect(f.submissions[1]!.nativeGoal).toBeUndefined()
    expect(f.starts[1].systemContext).toContain('When implementation is authorized, use the confirmed engine/platform native scene, UI and resource sources')
    expect(f.submissions).toHaveLength(2)
    await f.call('/agent/messages','POST',message('local-implementation','Implement only the authorized local correction.'))
    run=await f.wait(r=>Boolean(r.agentTurns?.[3]?.finishedAt))
    expect(f.submissions[2]!.nativeGoal).toBeUndefined()
    expect(f.submissions[3]!.nativeGoal).toBeUndefined()
    expect(f.submissions[3]!.prompt).toContain('Original authorized assignment:\nImplement only the authorized local correction.')
    expect(f.submissions[3]!.prompt).not.toContain('full confirmed new-game brief')
    expect(run.status).toBe('completed')
    expect(run.agentTurns![3]!.production?.originRequestKey).toBe('local-implementation')
    expect(run.agentTurns![2]!.message?.intent).toBe(intent)
    expect(new Set(run.agentTurns!.slice(0,3).map(turn=>turn.nativeSessionId)).size).toBe(1)
    expect(f.starts[3].resumeSessionId).toBeUndefined()
    expect(run.agentTurns![3]!.nativeSessionId).not.toBe(run.agentTurns![2]!.nativeSessionId)
    expect(run.blockedReason).toBeUndefined()
    expect(run.deliveryEligible).toBe(false)
    expect(f.submissions).toHaveLength(4)
  }finally{await f.close()}
},30000)


for(const outcome of ['paused','failed'] as const)test(`unfinished GDD ${outcome} retains its draft and resumes with current authority`,async()=>{
  let resume=false,entered=false,oldAuthorize:(()=>Promise<void>)|undefined
  const source='# Existing GDD\nExisting decisions.\n',document='# Complete GDD\nFinal decisions.\n'
  const f=await fixture(outcome==='paused'?'wait':'fail',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    if(!input.finalOutput?.writeDocument)throw new ProductionBlockedError('Synthetic implementation boundary')
    if(!resume) {
      oldAuthorize=input.finalOutput!.writeDocument!.authorize
      await oldAuthorize()
      await mkdir(join(root,'docs'),{recursive:true});await writeFile(join(root,'docs/GDD.md'),source)
      entered=true
    } else {
      expect(await readFile(join(root,'docs/GDD.md'),'utf8')).toBe(source)
      await expect(oldAuthorize!()).rejects.toThrow('writer changed or paused')
      await input.finalOutput!.writeDocument!.authorize()
      await writeFile(join(root,'docs/GDD.md'),document)
      await recordSyntheticDesignReview(input)
      await input.finalOutput!.accept({status:'ready',summary:'Resumed document saved'})
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    if(outcome==='paused'){await f.wait(()=>entered);await f.call('/stop','POST')}
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    const original=run.agentTurns![0]!
    expect(original.status).toBe(outcome==='paused'?'interrupted':'failed')
    expect(original.productionHandoff).toBeUndefined()
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(source)
    if(run.paused){await f.call('/resume','POST',{planRevision:run.planRevision});run=(await f.store.read(run.projectId,run.ownerId))!}
    resume=true;f.setMode('normal')
    const response=await f.call('/agent/messages','POST',{requestKey:'resume-gdd',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:original.attemptId,text:''})
    expect(response.status,await response.clone().text()).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt)&&!r.writer)
    expect(run.agentTurns![1]!.status).toBe('ended')
    expect(run.agentTurns![1]!.productionHandoff?.next?.stage).toBe('implementation')
    expect(run.agentTurns![2]!.production?.stage).toBe('implementation')
    expect(run.blockedReason).toContain('Synthetic implementation boundary')
    expect(f.submissions).toHaveLength(3)
    expect(f.starts[1]).toMatchObject({resumeSessionId:original.nativeSessionId,nativeRecovery:true})
    expect(f.starts[1].systemContext).toContain('Preserve the user-selected engine and platform')
    for(const value of [f.starts[1].systemContext,f.starts[1].finalOutput!.designReview!.context])
      expect(value).not.toMatch(/Phaser|Three\.js|sandboxed opaque iframe|URL subpath|localStorage|sessionStorage/)
    expect(f.starts[1].systemContext).not.toContain('Self-check the complete confirmed scope')
    expect(f.starts[1].systemContext).not.toContain('Keep resources registered')
    expect(f.starts[1].systemContext).not.toContain('observe actual rendering')
    expect(f.starts[1].systemContext).toContain('small-scope game with a complete core experience')
    expect(f.starts[1].systemContext).not.toContain('Determine the product decisions still needed')
    expect(f.submissions[0]!.prompt).toContain('BGS current production stage: design')
    expect(f.submissions[1]!.prompt).toEqual([])
    expect(f.starts[1].systemContext).not.toContain('usable initial tuning')
    expect(f.starts[1].systemContext).not.toContain('identified current feasibility question')
    expect(f.starts[1].systemContext).toContain('The confirmed brief and explicit user changes define required scope')
    expect(f.starts[1].systemContext.split(DESIGN_DECISION_SCOPE)).toHaveLength(2)
    expect(f.starts[1].finalOutput!.designReview!.context).not.toContain('Select artwork sources and representations')
    expect(f.starts[1].finalOutput!.designReview!.context).toContain('remain provisional rather than acceptance obligations')
    expect(f.starts[1].systemContext).not.toContain('BGS Scene/UI editing is not part of this target')
    expect(run.agentTurns![1]!.production).toEqual(original.production)
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(document)
  }finally{await f.close()}
},30000)

test('empty continuation resumes native history through the existing message route without replaying an assignment', async () => {
  const f = await fixture('fail')
  try {
    await f.call('/agent/goal', 'POST', f.body)
    const run = await f.wait(r => Boolean(r.agentTurns?.[0]?.finishedAt))
    const previous = run.agentTurns![0]!
    expect(f.submissions).toHaveLength(1)
    const body = { requestKey: 'native-recovery', runId: run.id, chatSessionId: run.chatSessionId,
      expectedVersion: run.version, requirementsRevision: run.requirements.revision,
      intent: 'continue', continuationOf: previous.attemptId, text: '' }
    expect((await f.call('/agent/messages', 'POST', { ...body, contextMode: 'focused' })).status).toBe(400)
    expect((await f.call('/agent/messages', 'POST', { ...body, continuationOf: 'stale' })).status).toBe(400)
    expect((await f.call('/agent/messages', 'POST', { ...body, expectedVersion: run.version - 1 })).status).toBe(409)
    expect(f.submissions).toHaveLength(1)
    f.setMode('normal')
    const response = await f.call('/agent/messages', 'POST', body)
    expect(response.status, await response.clone().text()).toBe(202)
    const after = await f.wait(r => Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.starts[1]).toMatchObject({ nativeRecovery: true, resumeSessionId: previous.nativeSessionId })
    expect(f.submissions[1]).toMatchObject({ nativeRecovery: true, prompt: [] })
    expect(f.submissions[1]!.nativeGoal).toBeUndefined()
    expect(f.starts[1].systemContext).not.toContain('This bounded assignment starts without a native Goal')
    expect(after.requirements).toEqual(run.requirements)
    expect((await f.call('/agent/messages', 'POST', body)).status).toBe(202)
    expect(f.submissions).toHaveLength(2)
  } finally { await f.close() }
})


test('manual recovery of ordinary Chat does not reactivate an earlier Goal, including repeated failures', async () => {
  const f = await fixture('normal', false, undefined, undefined, 0, { nativeGoalStatus: 'blocked' })
  try {
    await f.call('/agent/goal', 'POST', f.body)
    let run = await f.wait(r => Boolean(r.agentTurns?.[0]?.finishedAt))
    f.setMode('fail')
    expect((await f.call('/agent/messages', 'POST', { requestKey: 'question', runId: run.id, chatSessionId: run.chatSessionId,
      expectedVersion: run.version, requirementsRevision: run.requirements.revision, text: 'Explain progress only.' })).status).toBe(202)
    run = await f.wait(r => Boolean(r.agentTurns?.[1]?.finishedAt))
    for (let index = 2; index <= 3; index++) {
      expect((await f.call('/agent/messages', 'POST', { requestKey: 'retry-' + index, runId: run.id, chatSessionId: run.chatSessionId,
        expectedVersion: run.version, requirementsRevision: run.requirements.revision,
        intent: 'continue', continuationOf: run.agentTurns!.at(-1)!.attemptId, text: '' })).status).toBe(202)
      run = await f.wait(r => Boolean(r.agentTurns?.[index]?.finishedAt))
      expect(f.submissions[index]).toMatchObject({ nativeRecovery: true, prompt: [] })
      expect(f.submissions[index]!.nativeGoal).toBeUndefined()
    }
  } finally { await f.close() }
})


for(const kind of ['blocked','stalled','invalid'] as const)test('preparation final '+kind+' is visible and never requests a model retry',async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    await input.finalOutput!.writeDocument!.authorize()
    await mkdir(join(root,'docs'),{recursive:true})
    await writeFile(join(root,'docs/GDD.md'),'# Working draft\nUnfinished decisions.\n')
    if(kind==='stalled')throw new ProductionBlockedError('Two rechecks made no net progress')
    await input.finalOutput!.accept(kind==='blocked'
      ? {status:'blocked',summary:'Required source unavailable'}
      : {status:'ready',summary:'Unsupported complete-document format',document:'# Old format'})
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt) && f.sessions.transcript(r.chatSessionId).some(e=>e.payload?.category==='workflow-blocked'))
    expect(run.status).toBe('blocked')
    expect(run.writer).toBeUndefined()
    expect(run.agentTurns![0]!.productionHandoff).toBeUndefined()
    expect(f.submissions).toHaveLength(1)
    const notices=f.sessions.transcript(run.chatSessionId).filter(e=>e.payload?.category==='workflow-blocked')
    expect(notices).toHaveLength(1)
    expect(notices[0]!.text).toContain(kind==='blocked'?'Required source unavailable':kind==='stalled'?'Two rechecks made no net progress':'未提供有效交接')
    expect(run.agentTurns![0]!.status).toBe(kind==='invalid'?'failed':'ended')
    expect(f.sessions.transcript(run.chatSessionId).some(e=>e.type==='turn.failed')).toBe(kind==='invalid')
    if(kind!=='invalid')expect(run.blockedReason).toBe(kind==='blocked'?'Required source unavailable':'Two rechecks made no net progress')
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe('# Working draft\nUnfinished decisions.\n')
  }finally{await f.close()}
})


test('paused GDD rejects late writes and final submission while retaining its draft',async()=>{
  let accept:((value:unknown)=>Promise<string>)|undefined,authorize:(()=>Promise<void>)|undefined
  const source='# Existing GDD\nKeep existing decisions.\n'
  const f=await fixture('wait',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    await mkdir(join(root,'docs'),{recursive:true});await writeFile(join(root,'docs/GDD.md'),source)
    accept=input.finalOutput!.accept;authorize=input.finalOutput!.writeDocument!.authorize
    await authorize()
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>Boolean(accept))
    await f.call('/stop','POST')
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    await expect(authorize!()).rejects.toThrow('writer changed or paused')
    await expect(accept!({status:'ready',summary:'Late final'})).rejects.toThrow('writer changed or paused')
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(source)
    expect(run.agentTurns![0]!.productionHandoff).toBeUndefined()
    expect(f.submissions).toHaveLength(1)
  }finally{await f.close()}
})

for (const settings of [
  {platform:'PC',engine:'Godot'},
  {platform:'Web',engine:'Unity'},
  {platform:'Web',engine:'React',bgsVisualEditing:false},
]) test(`GDD host context preserves ${JSON.stringify(settings)} without assigning BGS editing`,async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true)
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings})
  await seedGddOnlyRun(f,true)
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.requirements.constraints).toMatchObject(settings)
    expect(f.submissions[0]!.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(f.starts[0].systemContext).toContain('Preserve the user-selected engine and platform')
    expect(f.starts[0].systemContext).not.toContain('This project requires BGS visual editing')
    expect(f.submissions[0]!.finalOutput?.readOnly).toBe(true)
    for (const clause of f.submissions[0]!.finalOutput!.designReview!.context.split('\n'))
      expect(f.starts[0].systemContext).toContain(clause)
  }finally{await f.close()}
})


test('GDD write capability rereads the current writer identity rather than caching workspace approval',async()=>{
  let authorize:(()=>Promise<void>)|undefined
  const f=await fixture('wait',false,undefined,undefined,0,{},undefined,true,async(_root,input)=>{
    authorize=input.finalOutput!.writeDocument!.authorize
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    let current=await f.wait(()=>Boolean(authorize))
    const original={...current.writer!}
    await authorize!()
    for(const stale of [{...original,attemptId:'other-attempt'},{...original,workerId:'other-worker'},{...original,fence:original.fence+1}]) {
      const next=structuredClone(current);next.version++;next.writer=stale
      await f.store.commit(current.projectId,current.ownerId,current.version,next,'synthetic-authority-change')
      await expect(authorize!()).rejects.toThrow('writer changed or paused')
      const restored=structuredClone(next);restored.version++;restored.writer=original
      await f.store.commit(next.projectId,next.ownerId,next.version,restored,'synthetic-authority-restore')
      current=restored
    }
    await authorize!()
    expect(current.agentTurns![0]!.productionHandoff).toBeUndefined()
  }finally{await f.close()}
})

for (const {settings,expected} of [
  {settings:{platform:'Web',engine:'React'},expected:true},
  {settings:{platform:'Mobile',engine:'React'},expected:false},
  {settings:{platform:'Web',engine:'React',bgsVisualEditing:false},expected:false},
  {settings:{platform:'PC',engine:'Godot'},expected:false},
  {settings:{platform:'PC',engine:'Unity'},expected:false},
  {settings:{platform:'PC',engine:'Unreal'},expected:false},
  {settings:{platform:'Mobile',engine:'Unity'},expected:false},
  {settings:{platform:'XR',engine:'Unity'},expected:false},
]) test(`restored creation flag follows current target in GDD and follow-up: ${JSON.stringify(settings)}`,async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true)
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings})
  try {
    const saved=createRun({projectId:'goal-project',ownerId:'owner',workspacePath:f.root,
      chatSessionId:f.body.chatSessionId,requestKey:f.body.requestKey,text:JSON.stringify(f.body.brief),constraints:settings,ids:['goal']})
    saved.creation={initialDelivery:'design-led-first-version',editableContent:true}
    saved.productionWorkflow=1
    await f.store.commit(saved.projectId,saved.ownerId,0,saved,'agent.goal-confirmed')
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(f.starts[0].systemContext.includes('This project requires BGS visual editing')).toBe(false)
    expect(f.starts[0].systemContext).not.toContain('BGS Editor reads BGS Scene/UI JSON')
    expect(f.starts[0].systemContext).not.toContain('uiLayoutContract')
    expect(f.submissions[0]!.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    const response=await f.call('/agent/messages','POST',{requestKey:'scoped-followup',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Inspect the existing design only.'})
    expect(response.status,await response.clone().text()).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.starts.length,run.agentTurns?.[1]?.error).toBe(2)
    expect(f.starts[1].systemContext.includes('This project requires BGS visual editing')).toBe(false)
    expect(run.requirements.constraints).toEqual(settings)
    expect(run.creation?.editableContent).toBe(true) // Historical facts are retained, not rewritten.
    await expect(readFile(join(f.root,'content/index.json'))).rejects.toThrow()
  }finally{await f.close()}
})


for(const intent of ['message','change'] as const)test(`confirmed platform and engine remain fixed across later ${intent}`,async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    if(!input.finalOutput?.designReview)return
    await input.finalOutput.writeDocument!.authorize()
    await mkdir(join(root,'docs'),{recursive:true})
    await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nRetain the confirmed target.\n')
    await recordSyntheticDesignReview(input)
    await input.finalOutput.accept({status:'ready',summary:'Reviewed target decisions'})
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings:{platform:'Web',engine:'React',dimension:'2D'}})
  try {
    await seedLegacyIsolatedRun(f,false)
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    let run=await f.wait(r=>r.agentTurns?.length===1 && Boolean(r.agentTurns[0]?.finishedAt) && !r.writer)
    expect(run.status).toBe('completed')
    const confirmed=structuredClone(run.requirements.constraints)
    const request={requestKey:'later-target-request',runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,intent,text:'Change the platform to PC and engine to Godot; revise only the design.'}
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(run.requirements.constraints).toEqual(confirmed)
    expect(JSON.parse(run.requirements.text).settings).toEqual(confirmed)
    expect(JSON.parse(f.submissions[1]!.confirmedBriefContext!).settings).toEqual(confirmed)
    expect(f.submissions[1]!.prompt).toContain(request.text) // Keep the actual request, without silently rewriting it.
    for(const start of f.starts) {
      expect(start.systemContext).toContain('These settings are fixed at project confirmation')
      expect(start.systemContext).toContain('Chat messages and design edits cannot change them')
    }
    expect(f.starts[1].systemContext).toContain('BGS Scene/UI editor JSON and content/index.json are not production deliverables on any platform')
    expect(f.starts[1].systemContext).not.toContain('Keep resources registered')
    const rejected={...request,requestKey:'unsupported-target-field',expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,targetSettings:{platform:'PC',engine:'Godot'}}
    expect((await f.call('/agent/messages','POST',rejected)).status).toBe(400)
    expect((await f.call('/agent/goal','POST',{...f.body,brief:{...f.body.brief,settings:{platform:'PC',engine:'Godot'}}})).status).toBe(409)
    expect(await f.store.read(run.projectId,run.ownerId)).toEqual(run)
    expect(f.submissions).toHaveLength(2)
  }finally{await f.close()}
})

for (const mode of ['missing', 'changed', 'blocking', 'reviewed'] as const)
  test('GDD handoff requires host review of the final source: ' + mode, async () => {
    const f = await fixture('normal', false, undefined, undefined, 0, {}, undefined, true, async (root, input) => {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs/GDD.md'), '# Synthetic candidate\nRules.\n')
      const contract = input.finalOutput!
      const value = { status: 'ready', summary: 'Synthetic handoff' }
      if (mode !== 'missing') {
        const {source} = await contract.designReview!.candidate(value)
        await contract.designReview!.record({ source, nativeThreadId: 'independent-fixture', nativeTurnId: 'review-turn',
          startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
          report: { summary: 'Synthetic report', findings: mode === 'blocking' ? [{ location: 'Rules',
            issue: 'Contradiction', evidence: 'The same event has two results', impact: 'The result cannot be implemented consistently' }] : [] } })
      }
      if (mode === 'changed') await writeFile(join(root, 'docs/GDD.md'), '# Changed after review\n')
      await contract.accept(value)
    })
    Object.assign(f.body.brief, { creation_mode: 'creative', build_source: null })
    await seedGddOnlyRun(f,true)
    try {
      await f.call('/agent/goal', 'POST', f.body)
      const run = await f.wait(r => Boolean(r.agentTurns?.[0]?.finishedAt) && !r.writer)
      const turn = run.agentTurns![0]!
      expect(turn.designReviews ?? []).toHaveLength(mode === 'missing' ? 0 : 1)
      if (mode === 'reviewed') {
        expect(turn.status).toBe('ended')
        expect(turn.productionHandoff!.sources[0]).toEqual(turn.designReviews![0]!.source)
      } else {
        expect(turn.status).toBe('failed')
        expect(turn.productionHandoff).toBeUndefined()
        expect(turn.error).toContain({ missing: 'no completed independent review', changed: 'changed after its independent review', blocking: 'unresolved review' }[mode])
      }
      expect(f.submissions.filter(input => input.finalOutput?.designReview)).toHaveLength(1)
      if (mode === 'reviewed') {
        expect(turn.productionHandoff!.next?.stage).toBe('implementation')
        // Settlement may already have dispatched the existing visual handoff.
        for (const input of f.submissions.slice(1)) expect(input.finalOutput).not.toHaveProperty('visualReview')
      } else expect(f.submissions).toHaveLength(1)
    } finally { await f.close() }
  })

for (const scenario of ['initial','focused','resume','legacy-focused'] as const)
test('startup failure leaves project usable for a new request: '+scenario,async()=>{
  const f=await fixture()
  try {
    const priorSuccess=scenario!=='initial'
    if(priorSuccess) {
      expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
      await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    }
    await initializeProjectRepository(f.root)
    await rm(join(f.root,'.git/objects'),{recursive:true})
    await rm(join(f.root,'.git/refs'),{recursive:true})
    const before=await f.store.read('goal-project','owner')
    const message=before?{requestKey:'startup-failure',runId:before.id,chatSessionId:before.chatSessionId,
      expectedVersion:before.version,requirementsRevision:before.requirements.revision,intent:'work',
      ...(scenario!=='resume'?{contextMode:'focused'}:{}),text:'Synthetic new assignment'}:f.body
    expect((await f.call(before?'/agent/messages':'/agent/goal','POST',message)).status).toBe(202)
    let failed=await f.wait(r=>Boolean(r.agentTurns?.[priorSuccess?1:0]?.finishedAt))
    const last=failed.agentTurns!.at(-1)!
    expect(last).toMatchObject({status:'failed',notStarted:true,quiescedAt:expect.any(String),turnId:expect.any(String)})
    expect(last.error).toContain('not a git repository')
    expect(last.usage).toBeUndefined()
    expect(f.starts).toHaveLength(priorSuccess?1:0)
    expect(f.submissions).toHaveLength(priorSuccess?1:0)
    expect(failed.writer).toBeUndefined()
    if(scenario==='legacy-focused') {
      // Reproduce the historical shape from before this fix, only in the temporary store.
      const path=join(f.hostRoot,'workflow-v3',digest(failed.projectId)+'.json')
      const saved=JSON.parse(await readFile(path,'utf8'));delete saved.run.agentTurns.at(-1).notStarted
      await writeFile(path,JSON.stringify(saved));failed=(await f.store.read(failed.projectId,failed.ownerId))!
    }
    for(const dir of ['objects/info','objects/pack','refs/heads','refs/tags'])await mkdir(join(f.root,'.git',dir),{recursive:true})
    await initializeProjectRepository(f.root)
    const body={runId:failed.id,chatSessionId:failed.chatSessionId,expectedVersion:failed.version,
      requirementsRevision:failed.requirements.revision}
    const continuation=await f.call('/agent/messages','POST',{...body,requestKey:'invalid-native-continue',intent:'continue',
      text:'',continuationOf:last.attemptId})
    expect(continuation.status).toBe(scenario==='legacy-focused'?409:400)
    expect(f.submissions).toHaveLength(priorSuccess?1:0)
    if(scenario==='legacy-focused') {
      const explicitResume=await f.call('/agent/messages','POST',{...body,requestKey:'explicit-resume',intent:'work',contextMode:'resume',text:'Resume original thread'})
      expect((await explicitResume.json()).code).toBe('conversation-unavailable')
    }
    if(scenario==='resume') {
      const path=f.sessions.metadata(failed.chatSessionId)!.transcriptPath
      const original=await readFile(path,'utf8')
      const kept=original.split('\n').filter(line=>!line || JSON.parse(line).turnId!==before!.agentTurns![0]!.turnId).join('\n')
      await writeFile(path,kept)
      const missingBaseline=await f.call('/agent/messages','POST',{...body,requestKey:'missing-baseline',text:'Inspect current work'})
      expect((await missingBaseline.json()).code).toBe('conversation-history-mismatch')
      await writeFile(path+'.restored',original)
      await rename(path+'.restored',path)
    }
    // The ordinary Chat path works: no added mode/button and no replay of the failed request.
    const request={...body,requestKey:'new-user-message',text:'Only inspect current files and explain their state.'}
    const accepted=await f.call('/agent/messages','POST',request)
    expect(accepted.status,await accepted.clone().text()).toBe(202)
    const ended=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey===request.requestKey && Boolean(r.agentTurns!.at(-1)?.finishedAt))
    expect(ended.agentTurns!.at(-1)!.status).toBe('ended')
    expect(ended.agentTurns!.slice(0,-1)).toEqual(failed.agentTurns!)
    expect(f.submissions).toHaveLength(priorSuccess?2:1)
    expect(f.submissions.at(-1)!.prompt).toBe('User message:\n'+request.text)
    if(scenario==='resume')expect(f.starts.at(-1).resumeSessionId).toBe(before!.agentTurns![0]!.nativeSessionId)
    else expect(f.starts.at(-1).resumeSessionId).toBeUndefined()
    expect((await f.call('/agent/messages','POST',request)).status).toBe(202)
    expect(f.submissions).toHaveLength(priorSuccess?2:1)
  }finally{await f.close()}
},30000)

test('explicit fresh work after settled missing native identity preserves the historical failure',async()=>{
  const f=await fixture('fail')
  try {
    await f.call('/agent/goal','POST',f.body)
    let failed=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    // A legacy record can lack native identity; do not backfill a no-start claim.
    const path=join(f.hostRoot,'workflow-v3',digest(failed.projectId)+'.json')
    const saved=JSON.parse(await readFile(path,'utf8'));delete saved.run.agentTurns[0].nativeSessionId
    await writeFile(path,JSON.stringify(saved));failed=(await f.store.read(failed.projectId,failed.ownerId))!
    f.setMode('normal')
    const response=await f.call('/agent/messages','POST',{requestKey:'authorized-new-context',runId:failed.id,
      chatSessionId:failed.chatSessionId,expectedVersion:failed.version,requirementsRevision:failed.requirements.revision,
      intent:'work',contextMode:'focused',text:'New task: inspect the current saved work; do not repeat old operations.'})
    expect(response.status,await response.clone().text()).toBe(202)
    const ended=await f.wait(r=>Boolean(r.agentTurns![1]?.finishedAt))
    expect(ended.agentTurns![0]).toEqual(failed.agentTurns![0])
    expect(ended.agentTurns![1].status).toBe('ended')
    expect(f.starts[1].resumeSessionId).toBeUndefined()
    expect(f.submissions).toHaveLength(2)
  }finally{await f.close()}
})

// Regression: the ordinary-message entry must not turn an implementation
// request into an implementation task when only the GDD has been handed off.
for (const entry of ['native','helper'] as const) for (const target of ['visual','resources','implement'] as const)
test(`production binding: ${entry}/${target} starts with missing preparation and respects the endpoint`,async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{nativeGoalStatus:'complete'},undefined,true,async(root,input,context)=>{
    const prompt=String(input.prompt),stage=(prompt+'\n'+context).match(/BGS current production stage: (\w+)\./)?.[1]
    if(prompt.includes('User message:\nProduce the requested deliverable.')) {
      const request={action:target,summary:'Requested deliverable',sections:['Decisions'],files:['docs/GDD.md']}
      const handoff=entry==='native'?await input.workflow!(request):await workflowCommand(root,context,request)
      expect((handoff as any).next.stage).toBe('visual')
    }else if(stage==='design') {
      await input.finalOutput!.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nSaved design.\n')
      await recordSyntheticDesignReview(input)
      await input.finalOutput!.accept({status:'ready',summary:'GDD ready'})
    }else if(stage==='visual'||stage==='resources') {
      expect(input.nativeGoal).toBeUndefined()
      const path=stage==='visual'?'docs/visual.png':'assets/resource.svg'
      await mkdir(join(root,stage==='visual'?'docs':'assets'),{recursive:true})
      await writeFile(join(root,path),stage==='visual'?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=','base64'):'<svg xmlns="http://www.w3.org/2000/svg"/>')
      const result={status:'ready' as const,summary:'Saved '+stage,sections:['Decisions'],files:[path]}
      if(stage==='visual')await acceptSyntheticVisualHandoff(input,result)
      else await input.finalOutput!.accept(result)
    }else if(stage==='implementation') expect(input.nativeGoal).toBeUndefined()
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    const response=await f.call('/agent/messages','POST',{requestKey:'production-request',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text:'Produce the requested deliverable.'})
    expect(response.status).toBe(202)
    const expected:Array<'visual'|'resources'|'implementation'>=target==='visual'?['visual']:target==='resources'?['visual','resources']:['visual','implementation']
    run=await f.wait(r=>!r.writer&&Boolean(r.agentTurns!.at(-1)?.finishedAt)&&
      (r.agentTurns!.some(t=>t.status==='failed')||r.agentTurns!.length===expected.length+2))
    expect(run.agentTurns!.slice(2).map(t=>t.production?.stage)).toEqual(expected)
    expect(run.agentTurns!.some(t=>t.status==='failed')).toBe(false)
    expect(run.agentTurns![1]!.production?.stage).toBe('visual')
    expect(f.submissions[1]!.nativeGoal).toBeUndefined()
    expect(f.submissions[1]!.finalOutput?.answer).toBeDefined()
    // A task/stage transition starts a new native context; no old implementation summary is reused.
    expect(f.starts[1].resumeSessionId).toBeUndefined()
    for(let i=2;i<f.starts.length;i++) expect(f.starts[i].resumeSessionId).toBeUndefined()
    if(target!=='implement') {
      expect(run.status).toBe('completed')
      expect(run.agentTurns!.at(-1)!.productionHandoff!.next).toBeUndefined()
      expect(f.submissions.every(input=>!input.nativeGoal)).toBe(true)
    }else { expect(run.status).toBe('completed');expect(run.blockedReason).toBeUndefined() }
  }finally{await f.close()}
},30000)

test('production binding: ordinary continue replaces an interrupted legacy implementation context without a workflow call',async()=>{
  let legacyTurnId:string|undefined
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input,context)=>{
    const prompt=String(input.prompt)
    if(prompt==='Historical implementation task') {
      await input.onMessage({type:'runtime_event',runtime:'bgs',eventType:'assistant.message',text:'Historical summary: current stage is implementation; continue writing the game.'})
      return
    }
    if(input.nativeRecovery) {
      expect(input.nativeGoal).toBeUndefined()
      expect(input.finalOutput?.answer).toBeDefined()
      return
    }
    if(prompt.includes('User message:\n继续')||prompt.includes('User message:\nWhat is still missing? Answer only.')) {
      // No BgsWorkflow call: exercise the route that bypassed the earlier patch.
      const facts=JSON.parse(context.split('BGS current assignment: ')[1]!)
      expect(facts.task.production).toMatchObject({stage:'visual',stopAfter:'visual'})
      expect(prompt).toBe('User message:\n'+(prompt.includes('继续')?'继续':'What is still missing? Answer only.'))
      expect(input.nativeGoal).toBeUndefined()
      expect(input.finalOutput?.answer).toBeDefined()
      return
    }
    await input.finalOutput!.writeDocument!.authorize()
    await mkdir(join(root,'docs'),{recursive:true})
    await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nSaved design.\n')
    await recordSyntheticDesignReview(input)
    await input.finalOutput!.accept({status:'ready',summary:'GDD ready'})
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    const original=structuredClone(run.agentTurns![0]!)
    // Construct a historical native turn using the real session manager, then
    // load its old host assignment. This is a temporary synthetic project only.
    f.sessions.start({workspacePath:f.root,projectId:run.projectId,userId:run.ownerId,transcriptSessionId:run.chatSessionId,
      userDataRoot:join(f.root,'owner-config'),resumeNativeSessionId:original.nativeSessionId})
    await f.sessions.sendWithDisplay(run.chatSessionId,'Historical implementation task',{
      confirmedBriefContext:run.requirements.text,onTurnAccepted:id=>{legacyTurnId=id}})
    await f.sessions.waitForSessionIdle(run.chatSessionId)
    f.sessions.stop(run.chatSessionId,'synthetic_legacy_interruption')
    await f.sessions.waitForSessionIdle(run.chatSessionId)
    const seeded=structuredClone(run);seeded.version++
    seeded.agentTurns!.push({...original,attemptId:'legacy-implementation',requestKey:'legacy-production',status:'interrupted',turnId:legacyTurnId,
      production:{stage:'implementation',originRequestKey:'legacy-visual-request'},productionHandoff:undefined,designReviews:undefined})
    await f.store.commit(run.projectId,run.ownerId,run.version,seeded,'agent.turn-settled')
    run=seeded
    const send=async(text:string,requestKey:string)=>{
      const response=await f.call('/agent/messages','POST',{requestKey,runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:run.version,requirementsRevision:run.requirements.revision,text})
      expect(response.status,await response.clone().text()).toBe(202)
      return f.wait(r=>!r.writer&&r.agentTurns!.at(-1)?.requestKey===requestKey&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    }
    run=await send('继续','plain-continue')
    expect(run.agentTurns!.at(-1)!.production).toMatchObject({stage:'visual',stopAfter:'visual'})
    expect(f.starts.at(-1).resumeSessionId).toBeUndefined()
    expect(f.starts.at(-1).systemContext).not.toContain('Historical summary:')
    expect(run.agentTurns![1]!).toEqual(seeded.agentTurns![1]!)
    expect(run.agentTurns!.at(-1)!.productionHandoff).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.status,run.agentTurns!.at(-1)!.error).toBe('ended')
    const visualSession=run.agentTurns!.at(-1)!.nativeSessionId
    const count=f.submissions.length
    run=await send('What is still missing? Answer only.','ordinary-question')
    expect(f.submissions).toHaveLength(count+1)
    expect(f.starts.at(-1).resumeSessionId).toBe(visualSession)
    expect(run.agentTurns!.at(-1)!.production?.stage).toBe('visual')
    expect(run.agentTurns!.at(-1)!.productionHandoff).toBeUndefined()
    expect(run.status).toBe('completed') // The question ended; no production stage was completed.
    expect(f.submissions.slice(2).every(input=>!input.nativeGoal&&Boolean(input.finalOutput?.answer))).toBe(true)
    f.setMode('fail')
    run=await send('继续','failed-chat')
    expect(run.agentTurns!.at(-1)!.status).toBe('failed')
    const failedChat=run.agentTurns!.at(-1)!
    f.setMode('normal')
    const resumed=await f.call('/agent/messages','POST',{requestKey:'chat-recovery',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',text:'',continuationOf:failedChat.attemptId})
    expect(resumed.status).toBe(202)
    run=await f.wait(r=>!r.writer&&r.agentTurns!.at(-1)?.requestKey==='chat-recovery'&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    expect(run.agentTurns!.at(-1)!.status,run.agentTurns!.at(-1)!.error).toBe('ended')
    expect(f.starts.at(-1).resumeSessionId).toBe(failedChat.nativeSessionId)
    expect(f.submissions.at(-1)!.nativeRecovery).toBe(true)
    await expect(readFile(join(f.root,'package.json'),'utf8')).rejects.toThrow()
  }finally{await f.close()}
},30000)

for(const continuation of ['message','native'] as const)test(`production binding: same visual task ${continuation} continuation keeps its native context and result contract`,async()=>{
  let resumed=false
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input,context)=>{
    const prompt=String(input.prompt),stage=(prompt+'\n'+context).match(/BGS current production stage: (\w+)\./)?.[1]
    if(prompt.includes('User message:\nRequest visuals.')) {
      await input.workflow!({action:'visual',summary:'Visual work only',sections:['Decisions'],files:['docs/GDD.md']})
    }else if(stage==='design') {
      await input.finalOutput!.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nSaved design.\n')
      await recordSyntheticDesignReview(input)
      await input.finalOutput!.accept({status:'ready',summary:'GDD ready'})
    }else if(!resumed) {
      expect(stage).toBe('visual')
      expect(input.finalOutput).toBeDefined()
      f.setMode('wait')
    }else if(continuation==='native') {
      expect(input.nativeRecovery).toBe(true)
      expect(input.prompt).toEqual([])
      expect(input.finalOutput).toBeDefined()
      await writeFile(join(root,'docs/visual.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=','base64'))
      await input.finalOutput!.accept({status:'ready',summary:'Visual ready',sections:['Decisions'],files:['docs/visual.png']})
    }else {
      const facts=JSON.parse(context.split('BGS current assignment: ')[1]!)
      expect(facts.task.production).toMatchObject({stage:'visual',stopAfter:'visual'})
      expect(prompt).toBe('User message:\n继续')
      expect(input.nativeRecovery).toBeUndefined()
      expect(input.finalOutput?.answer).toBeDefined()
      // Continue directly within the assigned stage, without a workflow entry call.
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    await f.call('/agent/messages','POST',{requestKey:'visual-request',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text:'Request visuals.'})
    await f.wait(r=>r.agentTurns!.length===3&&f.submissions.length===3)
    await f.call('/stop','POST')
    run=await f.wait(r=>!r.writer&&r.agentTurns!.at(-1)?.status==='interrupted')
    const previous=run.agentTurns!.at(-1)!,native=previous.nativeSessionId
    expect(previous.production).toMatchObject({stage:'visual',stopAfter:'visual'})
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    resumed=true;f.setMode('normal')
    const response=await f.call('/agent/messages','POST',{requestKey:'visual-continue',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,
      ...(continuation==='native'?{intent:'continue',continuationOf:previous.attemptId,text:''}:{text:'继续'})})
    expect(response.status,await response.clone().text()).toBe(202)
    run=await f.wait(r=>!r.writer&&r.agentTurns!.length===4&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    expect(run.agentTurns!.at(-1)!.status,run.agentTurns!.at(-1)!.error).toBe('ended')
    expect(run.agentTurns!.at(-1)!.production).toEqual(previous.production)
    expect(f.starts.at(-1).resumeSessionId).toBe(native)
    expect(f.submissions.at(-1)!.nativeGoal).toBeUndefined()
    if(continuation==='native')expect(run.agentTurns!.at(-1)!.productionHandoff!.next).toBeUndefined()
    else expect(run.agentTurns!.at(-1)!.productionHandoff).toBeUndefined()
  }finally{await f.close()}
},30000)

for(const outcome of ['blocked','changed','paused'] as const)test(`production binding: visual ${outcome} never starts resources`,async()=>{
  let visualSubmitted=false
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input,context)=>{
    const prompt=String(input.prompt),stage=(prompt+'\n'+context).match(/BGS current production stage: (\w+)\./)?.[1]
    if(prompt==='User message:\nProduce the full game.') {
      await input.workflow!({action:'implement',summary:'Full requested production',sections:['Decisions'],files:['docs/GDD.md']})
    }else if(stage==='design') {
      await input.finalOutput!.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nSaved design.\n')
      await recordSyntheticDesignReview(input)
      await input.finalOutput!.accept({status:'ready',summary:'GDD ready'})
    }else if(stage==='visual') {
      if(outcome==='blocked')await input.finalOutput!.accept({status:'blocked',summary:'Missing visual input',sections:[],files:[]})
      await writeFile(join(root,'docs/visual.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=','base64'))
      await acceptSyntheticVisualHandoff(input,{status:'ready',summary:'Saved visual',sections:['Decisions'],files:['docs/visual.png']})
      if(outcome==='changed')await writeFile(join(root,'docs/visual.png'),'<svg>changed after submission</svg>')
      if(outcome==='paused')f.setMode('wait')
      visualSubmitted=true
    }else throw Error('Unexpected production stage: '+stage)
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    await f.call('/agent/messages','POST',{requestKey:'full-production',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text:'Produce the full game.'})
    if(outcome==='paused'){await f.wait(()=>visualSubmitted);await f.call('/stop','POST')}
    run=await f.wait(r=>!r.writer&&r.agentTurns!.length===3&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    expect(run.status).toBe('blocked')
    expect(run.agentTurns!.at(-1)!.production?.stage).toBe('visual')
    expect(run.agentTurns!.some(t=>t.production?.stage==='resources')).toBe(false)
    expect(run.agentTurns!.some(t=>t.production?.stage==='implementation')).toBe(false)
    expect(f.submissions.every(input=>!input.nativeGoal)).toBe(true)
    if(outcome==='changed')expect(run.agentTurns!.at(-1)!.error).toContain('source changed')
    if(outcome==='paused')expect(run.agentTurns!.at(-1)!.status).toBe('interrupted')
  }finally{await f.close()}
},30000)

for(const outcome of ['ready','answer','changed-answer','reviewed-answer','missing-review','legacy-ready'] as const)
test('GDD ordinary continuation retains review and handoff: '+outcome,async()=>{
  let resumed=false,entered=false
  const userText=outcome==='answer'?'现在进行到哪里？只回答。':outcome==='ready'?'继续处理，保留3条生命和60秒时限':'继续完成当前 GDD。'
  const draft='# Saved GDD\n## Rules\nRetained draft.\n'
  const f=await fixture('wait',false,undefined,undefined,0,{},undefined,true,async(root,input,context)=>{
    if(!resumed) {
      await input.finalOutput!.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true});await writeFile(join(root,'docs/GDD.md'),draft)
      entered=true
      return
    }
    const contract=input.finalOutput!
    expect(context).toContain(DESIGN_DECISION_SCOPE)
    expect(contract.designReview!.context).toContain(DESIGN_DECISION_SCOPE)
    for(const value of [context,contract.designReview!.context])
      expect(value).not.toMatch(/Phaser|Three\.js|sandboxed opaque iframe|URL subpath|localStorage|sessionStorage/)
    expect(context.split(DESIGN_DECISION_SCOPE)).toHaveLength(2)
    expect(contract.designReview!.context).not.toContain('Select artwork sources and representations')
    expect(context).not.toContain('Record governing gameplay quantities')
    expect(contract.designReview!.context).not.toContain('Record governing gameplay quantities')
    expect(context).not.toContain('Save through WriteProjectFile/EditProjectFile')
    expect(contract?.readOnly).toBe(true)
    expect(contract?.designReview).toBeDefined()
    expect(contract.designReview!.context).toContain('Current GDD handoff: the current document assignment')
    expect(contract.designReview!.context).toContain(userText)
    expect(contract.designReview!.context).not.toContain('Current design handoff: screen concepts')
    expect(contract.designReview!.context).not.toContain('WriteProjectFile')
    expect(input.nativeGoal).toBeUndefined()
    expect(input.prompt).toBe('User message:\n'+userText)
    if(outcome==='answer'||outcome==='changed-answer'||outcome==='reviewed-answer') {
      if(outcome==='reviewed-answer')await recordSyntheticDesignReview(input)
      if(outcome==='changed-answer') {
        await contract.writeDocument!.authorize()
        await writeFile(join(root,'docs/GDD.md'),draft+'Changed without submission.\n')
      }
      expect(await contract.answer!({status:'answered',summary:'The draft remains pending.'})).toBe('The draft remains pending.')
      return
    }
    const value={status:'ready',summary:'Completed saved draft.'}
    // An unchanged saved candidate also needs review; file writes are not the completion signal.
    if(outcome!=='missing-review')await recordSyntheticDesignReview(input)
    await contract.accept(value)
  })
  Object.assign(f.body.brief,{creation_mode:'blueprint',build_source:null,settings:{platform:'Web',engine:'React',dimension:'2D'}})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    await f.wait(()=>entered);await f.call('/stop','POST')
    let run=await f.wait(r=>!r.writer&&r.agentTurns?.[0]?.status==='interrupted')
    const interrupted=structuredClone(run.agentTurns![0]!)
    expect(interrupted.error).not.toContain('Native goal')
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    if(outcome==='legacy-ready') {
      // Actual persisted failure shape: an interrupted design followed by an
      // ended ordinary Chat which wrote the GDD without a production binding.
      const legacy=structuredClone(interrupted)
      Object.assign(legacy,{attemptId:'legacy-unbound-chat',requestKey:'legacy-unbound-chat',status:'ended',
        message:{requestKey:'legacy-unbound-chat',runId:run.id,chatSessionId:run.chatSessionId,
          expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'message',text:'继续完成当前 GDD。'}})
      delete legacy.production;delete legacy.error
      const seeded=structuredClone(run);seeded.version++;seeded.agentTurns!.push(legacy)
      await f.store.commit(run.projectId,run.ownerId,run.version,seeded,'agent.turn-settled');run=seeded
    }
    const before=structuredClone(run.agentTurns!)
    resumed=true;f.setMode('normal')
    const response=await f.call('/agent/messages','POST',{requestKey:'plain-gdd-continue',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,
      text:userText})
    expect(response.status,await response.clone().text()).toBe(202)
    run=await f.wait(r=>!r.writer&&r.agentTurns!.at(-1)?.requestKey==='plain-gdd-continue'&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    const turn=run.agentTurns!.at(-1)!
    expect(turn.production).toEqual(interrupted.production)
    expect(run.agentTurns!.slice(0,-1)).toEqual(before)
    if(outcome==='ready'||outcome==='legacy-ready') {
      expect(turn.status,turn.error).toBe('ended')
      expect(turn.designReviews).toHaveLength(1)
      expect(turn.productionHandoff!.sources).toEqual([turn.designReviews![0]!.source])
      expect(turn.productionHandoff!.next).toBeUndefined()
    }else if(outcome==='answer') {
      expect(turn.status,turn.error).toBe('ended')
      expect(turn.designReviews).toBeUndefined()
      expect(turn.productionHandoff).toBeUndefined()
      expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe(draft)
    }else {
      expect(turn.status).toBe('failed')
      expect(turn.productionHandoff).toBeUndefined()
      expect(turn.error).toContain(outcome==='changed-answer'||outcome==='reviewed-answer'?'changed design':'no completed independent review')
    }
    expect(f.submissions).toHaveLength(2)
    if(outcome==='legacy-ready')expect(f.starts.at(-1).resumeSessionId).toBeUndefined()
    else expect(f.starts.at(-1).resumeSessionId).toBe(interrupted.nativeSessionId)
    await expect(readFile(join(f.root,'package.json'))).rejects.toThrow()
  }finally{await f.close()}
},30000)

for (const recovery of [false, true]) test('visual handoff and resume retain history without restarting image review: ' + recovery, async () => {
  const draft = '# Synthetic\n## UI\nMenu and required action.\n'
  const responses = [{ finding: 1, status: 'unresolved' as const, evidence: 'Historical image-review record' }]
  let visualVisited = 0
  const imageContexts: any[] = []
  const f = await fixture('normal', false, undefined, value => {
    imageContexts.push(value)
    return { fetch: (request:Request) => fetch(new Request('http://127.0.0.1:1/offline-image', request)), instruction: 'Existing fixture capability', close: async () => {} }
  }, 0, {}, undefined, true, async (root, input, context) => {
    const contract = input.finalOutput
    if (contract?.designReview) {
      await contract.writeDocument!.authorize()
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs/GDD.md'), draft)
      await recordSyntheticDesignReview(input)
      await contract.accept({ status: 'ready', summary: 'GDD ready' })
      return
    }
    const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(root,f.body.chatSessionId),'utf8'))
    expect((await fetch(capability.assets.imageEndpoint)).status).toBe(409)
    if (!contract) throw new ProductionBlockedError('Implementation is outside this visual fixture')
    visualVisited++
    expect(contract).not.toHaveProperty('visualReview')
    const facts = JSON.parse(context.split('BGS current assignment: ')[1]!)
    expect(facts).not.toHaveProperty('visualReview')
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'assets/concept.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=', 'base64'))
    const beforeWrongExit=await f.store.read('goal-project','owner')
    expect(await input.workflow!({action:'status'})).toMatchObject({assignment:{stage:'visual'}})
    await expect(input.workflow!({action:'advance',summary:'Wrong tool exit',sections:['UI'],files:['assets/concept.png']})).rejects.toThrow('Submit selected visual image sources through the final ready result')
    expect(await f.store.read('goal-project','owner')).toEqual(beforeWrongExit)
    if (recovery && visualVisited === 1) {
      const run = (await f.store.read('goal-project', 'owner'))!, next = structuredClone(run)
      const source = { path: 'docs/GDD.md' as const, sha256: createHash('sha256').update(draft).digest('hex') }
      next.agentTurns!.at(-1)!.visualBaseline = { ...source, text: draft }
      next.agentTurns!.at(-1)!.visualReviews = [{ source, baseline: source, files: [],
        nativeThreadId: 'archived-reviewer', nativeTurnId: 'archived-turn', startedAt: 'old-start', finishedAt: 'old-end',
        summary: 'Historical record', report: { summary: 'Historical issue', coverage: [{ state: 'menu', source: 'UI', representation: 'panel A' }],
          findings: [{ category: 'function', state: 'menu', issue: 'Old visual issue', evidence: 'Old sources' }] } }]
      next.version++
      await f.store.commit(run.projectId, run.ownerId, run.version, next, 'synthetic-retained-history')
      throw Error('Stopped before selected sources were handed off')
    }
    await contract.accept({ status: 'ready', summary: 'Selected design saved', sections: ['UI'], files: ['assets/concept.png'],
      ...(recovery ? { reviewResponses: responses } : {}) })
  })
  Object.assign(f.body.brief, { creation_mode: 'blueprint', build_source: null,
    settings: { platform: 'Web', engine: 'React', dimension: '2D', orientation: 'Landscape' } })
  try {
    const historical = await seedLegacyVisualRun(f, draft)
    expect((await f.call('/agent/continue-production', 'POST', { expectedVersion:historical.version, afterAttemptId:historical.agentTurns![0]!.attemptId })).status).toBe(202)
    if (recovery) {
      const paused = await f.wait(r => !r.writer && visualVisited === 1 && r.agentTurns!.at(-1)?.status === 'failed')
      expect(paused.agentTurns!.at(-1)!.error).toContain('Stopped before selected sources were handed off')
      const response = await f.call('/agent/continue-production','POST', { expectedVersion: paused.version, afterAttemptId: paused.agentTurns!.at(-1)!.attemptId })
      expect(response.status, await response.clone().text()).toBe(202)
    }
    const run = await f.wait(r => !r.writer && r.agentTurns!.length >= (recovery ? 4 : 3) && r.agentTurns!.at(-1)?.production?.stage === 'implementation')
    const turn = run.agentTurns!.at(-2)!
    expect(turn.status, turn.error).toBe('ended')
    expect(visualVisited).toBe(recovery ? 2 : 1)
    expect(turn.productionHandoff!.request).not.toHaveProperty('reviewResponses')
    expect(turn.productionHandoff!.next?.stage).toBe('implementation')
    expect(await readFile(join(f.root, 'docs/GDD.md'), 'utf8')).toBe(draft)
    if (recovery) expect(run.agentTurns![1]!.visualReviews?.[0]?.report.findings[0]?.issue).toBe('Old visual issue')
    for (const value of imageContexts.filter(value => value.requireGdd)) {
      expect(value.sessionId).toBe(f.body.chatSessionId)
      expect(JSON.parse(value.confirmedRequirements)).toMatchObject({ settings: f.body.brief.settings })
      expect(value.request).toBeInstanceOf(Request)
    }
    expect(imageContexts.filter(value => value.requireGdd)).toHaveLength(recovery ? 2 : 1)
    expect(imageContexts.filter(value => !value.requireGdd).length).toBeGreaterThan(0)
  } finally { await f.close() }
}, 30_000)


test('an explicitly requested resource handoff after implementation uses existing cleanup and no delivery gate',async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input,context)=>{
    const stage=(String(input.prompt)+'\n'+context).match(/BGS current production stage: (\w+)\./)?.[1]
    if(stage==='design') {
      await input.finalOutput!.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nSaved design.\n')
      await recordSyntheticDesignReview(input)
      await input.finalOutput!.accept({status:'ready',summary:'GDD ready'})
    }else if(input.prompt==='User message:\nProduce the missing resource.') {
      await writeFile(join(root,'correction.txt'),'Actual corrected source')
      await input.workflow!({action:'resources',summary:'Requested resource work',sections:['Decisions'],files:['docs/GDD.md']})
    }else if(stage==='resources') {
      await input.finalOutput!.accept({status:'ready',summary:'Requested resources ready',sections:['Decisions'],files:['docs/GDD.md']})
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>r.agentTurns!.length===2&&!r.writer&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    expect(run.status).toBe('completed')
    expect((await f.call('/agent/messages','POST',{requestKey:'resource-request',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text:'Produce the missing resource.'})).status).toBe(202)
    run=await f.wait(r=>r.agentTurns!.length===4&&!r.writer&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    expect(run.status).toBe('completed')
    expect(run.agentTurns!.map(t=>t.production?.stage)).toEqual(['design','implementation','implementation','resources'])
    expect(run.agentTurns!.every(t=>t.quiescedAt&&!t.deliverySubmission)).toBe(true)
    expect(f.submissions.every(t=>!t.nativeGoal)).toBe(true)
  }finally{await f.close()}
},30000)


for(const item of [
  {path:'src/game.js',before:'old behavior',after:'new behavior',delivery:true},
  {path:'assets/part.png',before:'old bytes',after:'new bytes',delivery:true},
  {path:'src/deleted.js',before:'existing behavior',delivery:true},
  {path:'node_modules/runtime/index.js',before:'old dependency',after:'new dependency',delivery:true},
  {path:'docs/GDD.md',before:'# Design',after:'# Supported design change',delivery:false},
  {path:'docs/TASKS.md',before:'pending',after:'progress only',delivery:false},
  {path:'reports/note.txt',before:'old note',after:'new note',delivery:false},
])test(`ordinary messages retain work without full-source snapshots or submission: ${item.path}`,async()=>{
  const text='Explain the current state; do not change files.'
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,false,async(root,input)=>{
    if(input.prompt==='User message:\n'+text) {
      if(item.after===undefined)await rm(join(root,item.path))
      else await writeFile(join(root,item.path),item.after)
    }
  })
  try {
    await mkdir(join(f.root,item.path.slice(0,item.path.lastIndexOf('/'))),{recursive:true})
    await writeFile(join(f.root,item.path),item.before)
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>!r.writer&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    const requirements=structuredClone(run.requirements),planRevision=run.planRevision
    expect((await f.call('/agent/messages','POST',{requestKey:'ordinary',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text})).status).toBe(202)
    run=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='ordinary'&&!r.writer)
    expect(run.requirements).toEqual(requirements)
    expect(run.planRevision).toBe(planRevision)
    expect(run.agentTurns!.at(-1)!.productionHandoff).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.projectInputs).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.projectFileChanges).toBeUndefined()
    expect(run.status).toBe('completed')
    expect(run.blockedReason).toBeUndefined()
    if(item.after===undefined)expect(await Bun.file(join(f.root,item.path)).exists()).toBe(false)
    else expect(await readFile(join(f.root,item.path),'utf8')).toBe(item.after)
    expect(f.submissions).toHaveLength(2)
    expect(f.submissions[1]!.prompt).toBe('User message:\n'+text)
    expect(f.starts[1].systemContext).not.toContain('projectInputs')
  }finally{await f.close()}
})


for(const entry of ['explicit','implicit','unreadable-baseline'] as const)
test(`implementation chat optionally binds work, resumes after stop and completes without mandatory submission: ${entry}`,async()=>{
  let resumeRepair=false,waitingRepair=false
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input,context)=>{
    const prompt=String(input.prompt),stage=(prompt+'\n'+context).match(/BGS current production stage: (\w+)\./)?.[1]
    if(stage==='design') {
      await input.finalOutput!.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Decisions\nSaved design.\n')
      await recordSyntheticDesignReview(input)
      await input.finalOutput!.accept({status:'ready',summary:'GDD ready'})
    }else if(stage==='visual') {
      await writeFile(join(root,'docs/visual.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=','base64'))
      await acceptSyntheticVisualHandoff(input,{status:'ready',summary:'Visual ready',sections:['Decisions'],files:['docs/visual.png']})
    }else if(prompt==='User message:\nApply the current correction.') {
      if(entry==='explicit') {
        const scope=await input.workflow!({action:'implement',summary:'Current correction only',sections:[],files:[]})
        expect(scope).not.toHaveProperty('next')
        expect(scope).toMatchObject({instruction:expect.stringContaining('current turn'),sources:[]})
      }
      await writeFile(join(root,'correction.txt'),'Actual corrected source')
    }else if(prompt==='User message:\nApply the next correction.') {
      if(entry==='explicit')await workflowCommand(root,context,{action:'implement',summary:'Next correction only',sections:[],files:[]})
      await writeFile(join(root,'correction.txt'),'Next corrected source')
      waitingRepair=true;f.setMode('wait')
    }else if(input.nativeRecovery) {
      expect(resumeRepair).toBe(true)
      expect(input.nativeGoal).toBeUndefined()
    }else if(prompt==='User message:\nSubmit the retained work.') { if(entry==='unreadable-baseline')await rm(join(root,'broken-input')); }else if(prompt==='User message:\nExplain only.') {
      expect(input.nativeGoal).toBeUndefined()
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>r.agentTurns!.length===2&&!r.writer&&Boolean(r.agentTurns!.at(-1)?.finishedAt))
    expect(run.agentTurns!.map(t=>t.production?.stage)).toEqual(['design','implementation'])
    const requirements=structuredClone(run.requirements)
    const send=async(text:string,requestKey:string)=>{
      const response=await f.call('/agent/messages','POST',{requestKey,runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:run.version,requirementsRevision:run.requirements.revision,text})
      expect(response.status,await response.clone().text()).toBe(202)
    }
    await send('Explain only.','question')
    run=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='question'&&!r.writer)
    expect(run.status).toBe('completed')
    expect(run.agentTurns).toHaveLength(3)
    expect(run.requirements).toEqual(requirements)
    await send('Apply the current correction.','repair')
    run=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='repair'&&!r.writer)
    expect(run.agentTurns).toHaveLength(4)
    expect(run.status).toBe('completed')
    expect(run.blockedReason).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.productionHandoff?.next).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.projectInputs).toBeUndefined()
    expect(await readFile(join(f.root,'correction.txt'),'utf8')).toBe('Actual corrected source')
    const retainedNative=run.agentTurns!.at(-1)!.nativeSessionId
    await send('Explain only.','second-question')
    run=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='second-question'&&!r.writer)
    expect(run.status).toBe('completed')
    expect(run.agentTurns!.at(-1)!.nativeSessionId).toBe(retainedNative)
    await send('Apply the next correction.','stopped-repair')
    const active=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='stopped-repair'&&waitingRepair)
    const forged=structuredClone(active);forged.version++;forged.agentTurns!.at(-1)!.message!.text='Forged request'
    await expect(f.store.commit(active.projectId,active.ownerId,active.version,forged,'forged.history')).rejects.toThrow('history')
    await f.call('/stop','POST')
    run=await f.wait(r=>!r.writer&&r.agentTurns!.at(-1)?.status==='interrupted')
    const stopped=run.agentTurns!.at(-1)!
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    resumeRepair=true;f.setMode('normal')
    expect((await f.call('/agent/messages','POST',{requestKey:'resume-repair',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:stopped.attemptId,text:''})).status).toBe(202)
    run=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='resume-repair'&&!r.writer)
    expect(run.status).toBe('completed')
    expect(run.blockedReason).toBeUndefined()
    expect(await readFile(join(f.root,'correction.txt'),'utf8')).toBe('Next corrected source')
    expect(run.agentTurns!.at(-1)!.projectInputs).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.message?.continuationOf).toBe(stopped.attemptId)
    const count=run.agentTurns!.length
    if(entry==='unreadable-baseline')await symlink(join(f.root,'correction.txt'),join(f.root,'broken-input'))
    await send('Submit the retained work.','submit')
    run=await f.wait(r=>r.agentTurns!.at(-1)?.requestKey==='submit'&&!r.writer)
    expect(run.agentTurns).toHaveLength(count+1)
    expect(run.agentTurns!.at(-1)!.deliverySubmission).toBeUndefined()
    expect(run.status).toBe('completed');expect(run.blockedReason).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.projectInputs).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.projectFileChanges).toBeUndefined()
    expect(run.agentTurns!.at(-1)!.status).toBe('ended')
    expect(run.requirements).toEqual(requirements)
    expect(run.agentTurns!.some(t=>t.status==='failed')).toBe(false)
    expect(f.submissions.every(input=>!input.nativeGoal)).toBe(true)
  }finally{await f.close()}
},30000)

test('a historical continuous implementation preserves visual selection, reusable checks and scope across stop and recovery', async () => {
  let selected=false,resumed=false
  const script='export async function check(page) { return await page.title() }\n'
  const results=JSON.stringify({checks:[{scenario:'core',expected:'The core path works',observed:'The core path works',passed:true}]})
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    expect(input.finalOutput?.designReview).toBeDefined()
    expect(input.finalOutput?.readOnly).not.toBe(true)
    expect(input.nativeGoal).toBeUndefined()
    expect(f.starts.at(-1).systemContext.split(DESIGN_DECISION_SCOPE)).toHaveLength(2)
    if(!resumed) {
      await mkdir(join(root,'tests'),{recursive:true})
      await writeFile(join(root,'tests/browser-check.mjs'),script)
      await writeFile(join(root,'tests/browser-results.json'),results)
      expect(JSON.stringify(input.prompt)).toContain('one continuous authoring task')
      await input.finalOutput!.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Synthetic\n## Look\nUse the retained target.\n')
      await mkdir(join(root,'assets'),{recursive:true})
      await writeFile(join(root,'assets/look.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1/8AAAAASUVORK5CYII=','base64'))
      await input.workflow!({action:'implement',summary:'Current complete-game implementation',sections:[],files:[]})
      const result=await input.workflow!({action:'select-visual',summary:'Adopt the supplied look sample',sections:[],files:['assets/look.png']}) as any
      expect(result.next).toBeUndefined()
      expect(result.instruction).toContain('same task')
      const pending = { checks: [{ id: 'core', requirement: 'Confirmed core path', expected: 'The core path works' }],
        attempts: [{ id: 'interrupted-batch', server: 'fixture-browser', script: { path: 'browser-check.mjs', sha256: 'unfinished' },
          startedAt: '2026-01-01T00:00:00Z' }] }
      const archived=(await f.store.read('goal-project','owner'))!
      const withArchive=structuredClone(archived);withArchive.version++;withArchive.agentTurns!.at(-1)!.browserVerification=pending
      await f.store.commit(archived.projectId,archived.ownerId,archived.version,withArchive,'agent.browser-verification')
      await recordSyntheticDesignReview(input)
      selected=true;f.setMode('wait')
    } else {
      expect(input.prompt).toEqual([])
      expect(f.starts.at(-1).systemContext).not.toContain('Saved design input at task preparation')
      expect(input.finalOutput!.designReview!.previousReviews).toHaveLength(1)
      await input.finalOutput!.accept({status:'ready',summary:'Completed using retained decisions and checks'})
      expect(await readFile(join(root,'tests/browser-check.mjs'),'utf8')).toBe(script)
      expect(await readFile(join(root,'tests/browser-results.json'),'utf8')).toBe(results)
    }

  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings:{platform:'Web',engine:'Three.js',dimension:'3D',orientation:'Landscape'}})
  try {
    await seedLegacyIsolatedRun(f,false)
    await f.call('/agent/goal','POST',f.body)
    await f.wait(run=>selected&&run.agentTurns!.length===1&&Boolean(run.agentTurns!.at(-1)!.visualSelection))
    await f.call('/stop','POST')
    let run=await f.wait(run=>!run.writer&&run.agentTurns!.at(-1)!.status==='interrupted')
    const previous=run.agentTurns!.at(-1)!,target=structuredClone(previous.visualSelection)
    expect(run.status).toBe('blocked')
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    resumed=true;f.setMode('normal')
    expect((await f.call('/agent/messages','POST',{requestKey:'resume-selected-design',runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:previous.attemptId,text:''})).status).toBe(202)
    run=await f.wait(run=>!run.writer&&run.agentTurns!.length===2)
    expect(run.agentTurns!.map(turn=>turn.production?.stage)).toEqual(['implementation','implementation'])
    expect(run.agentTurns![0]!.visualSelection).toEqual(target)
    expect(run.agentTurns![0]!.browserVerification?.attempts[0]?.id).toBe('interrupted-batch')
    expect(run.agentTurns![1]!.browserVerification).toBeUndefined()
    expect(run.agentTurns![1]!.deliverySubmission).toBeUndefined()
    expect(run.status).toBe('completed')
    expect(f.starts[1].resumeSessionId).toBe(previous.nativeSessionId)
    expect(f.starts).toHaveLength(2)
    expect(f.submissions[1]!.implementationHandoff).toBeUndefined()
    expect(f.submissions[1]!.finalOutput!.designReview!.previousReviews).toHaveLength(1)
    expect(run.agentTurns![1]!.productionHandoff!.sources.map(source=>source.path)).toEqual(['docs/GDD.md','assets/look.png'])
    expect(f.submissions.every(input=>!input.nativeGoal)).toBe(true)
  } finally {await f.close()}
},30_000)


for (const evidence of ['startup-only', 'submitted', 'changed-gdd'] as const)
test('implementation startup recovery requires matching no-submit evidence and reviewed GDD: '+evidence, async () => {
  const faults = { startupFailure: true }
  let recovering = false
  const f = await fixture('normal', false, undefined, undefined, 0, faults, undefined, true, async (root, input) => {
    if (input.finalOutput?.designReview) {
      await input.finalOutput.writeDocument!.authorize()
      await mkdir(join(root, 'docs'), {recursive:true})
      await writeFile(join(root, 'docs/GDD.md'), '# Synthetic\nRequired interaction.\n')
      await recordSyntheticDesignReview(input)
      await input.finalOutput.accept({status:'ready',summary:'Reviewed GDD ready'})
    } else if (recovering && !input.finalOutput) {
      const restart = input.restartFromDesign
      if (evidence === 'submitted') {
        expect(restart).toBeUndefined()
        throw Error('Synthetic native history missing after a prior submission')
      }
      else {
        expect(restart?.prompt).toContain('BGS current production stage: implementation')
        expect(restart?.prompt.split('Saved design input at task preparation')).toHaveLength(2)
        // The native runner propagates this guard failure; the fixture must too.
        await restart!.authorize()
      }
    }
  })
  Object.assign(f.body.brief, {creation_mode:'creative', build_source:null,
    settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Auto'}})
  await seedGddOnlyRun(f,true)
  let snapshotSpy: ReturnType<typeof spyOn> | undefined
  try {
    await f.call('/agent/goal','POST',f.body)
    let run = await f.wait(r=>r.agentTurns?.length===2 && !r.writer && r.agentTurns.at(-1)?.status==='failed')
    const failed = structuredClone(run.agentTurns!.at(-1)!)
    expect(failed.error).toBe('Synthetic runner startup failed')
    faults.startupFailure = false; recovering = true
    if (evidence === 'submitted') {
      const readSnapshot = f.sessions.runtimeSnapshot.bind(f.sessions)
      snapshotSpy = spyOn(f.sessions,'runtimeSnapshot').mockImplementation((...args:Parameters<typeof readSnapshot>) => {
        const value = readSnapshot(...args)
        return value.executionIdentity?.attemptId === failed.attemptId
          ? {...value,executionIdentity:{...value.executionIdentity,nativeSubmitted:true as const}} : value
      })
    }
    if (evidence === 'changed-gdd') await writeFile(join(f.root,'docs/GDD.md'),'# Changed after review\n')
    const response = await f.call('/agent/messages','POST',{requestKey:'retry-startup',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:failed.attemptId,text:''})
    expect(response.status,await response.clone().text()).toBe(202)
    run = await f.wait(r=>r.agentTurns?.length===3 && !r.writer && Boolean(r.agentTurns.at(-1)?.finishedAt))
    expect(run.agentTurns![1]).toEqual(failed)
    expect(run.agentTurns![2]!.production).toEqual(failed.production)
    expect(run.status).toBe(evidence==='startup-only'?'completed':'blocked')
  } finally { snapshotSpy?.mockRestore(); await f.close() }
})

test('continuous author startup-only recovery reuses the assignment without requiring an earlier design task',async()=>{
  const faults={startupFailure:true}
  const f=await fixture('normal',false,undefined,undefined,0,faults,undefined,true,async(root,input)=>{
    expect(input.finalOutput?.readOnly).not.toBe(true)
    expect(input.restartFromDesign?.prompt).toContain('one continuous authoring task')
    expect(input.restartFromDesign?.prompt).not.toContain('Saved design input at task preparation')
    await input.restartFromDesign!.authorize()
    await input.finalOutput!.writeDocument!.authorize()
    await mkdir(join(root,'docs'),{recursive:true})
    await writeFile(join(root,'docs/GDD.md'),'# Decisions\nThe current game rules.\n')
    await writeFile(join(root,'index.html'),'<canvas></canvas>')
    await recordSyntheticDesignReview(input)
    await input.finalOutput!.accept({status:'ready',summary:'Game with reviewed decisions'})
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings:{platform:'Web',engine:'React',dimension:'2D'}})
  try {
    await seedLegacyIsolatedRun(f,false)
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>!r.writer&&r.agentTurns?.[0]?.status==='failed')
    const failed=structuredClone(run.agentTurns![0]!)
    expect(failed.error).toBe('Synthetic runner startup failed')
    expect(f.submissions).toHaveLength(0)
    await expect(readFile(join(f.root,'docs/GDD.md'))).rejects.toThrow()
    faults.startupFailure=false
    expect((await f.call('/agent/messages','POST',{requestKey:'recover-author',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:failed.attemptId,text:''})).status).toBe(202)
    run=await f.wait(r=>!r.writer&&r.agentTurns?.length===2&&Boolean(r.agentTurns[1]?.finishedAt))
    expect(run.status,run.blockedReason).toBe('completed')
    expect(run.agentTurns![0]).toEqual(failed)
    expect(run.agentTurns![1]!.production).toEqual(failed.production)
    expect(run.agentTurns![1]!.designReviews).toHaveLength(1)
    expect(run.agentTurns![1]!.productionHandoff?.next).toBeUndefined()
    expect(f.submissions).toHaveLength(1)
    expect(f.starts[1].resumeSessionId).toBe(failed.nativeSessionId)
  }finally{await f.close()}
},30000)

test('historical continuous implementation builds, verifies and repairs in one native task without a separate report', async () => {
  const checks:string[]=[]
  let authorEntries=0
  const f = await fixture('normal', false, undefined, undefined, 0, {}, undefined, true, async (root, input) => {
    if (input.finalOutput?.designReview) {
      expect(input.finalOutput.readOnly).not.toBe(true)
      await input.finalOutput.writeDocument!.authorize()
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs/GDD.md'), '# Synthetic\nRequired interaction.\n')
      expect(input.implementationHandoff).toBeUndefined()
      expect(input.baseInstructions).toBeUndefined()
      if(++authorEntries>1)return
      const prompt=typeof input.prompt==='string'?input.prompt:input.prompt.map((block:any)=>block.type==='text'?block.text:'').join('\n')
      expect(prompt).toContain('repair observed deviations')
      expect(prompt).toContain('checks actually performed')
      expect(prompt).not.toContain('separate verification assignment')
      const entry=await input.workflow!({action:'implement',summary:'Current implementation',sections:[],files:[]})
      expect(entry).not.toHaveProperty('next')
      for(const step of ['build','check-failed','repair','check-passed']) {
        checks.push(step)
        await input.onMessage({type:'runtime_event',runtime:'bgs',eventType:'tool.completed',toolName:'Shell',toolUseID:step,output:step})
      }
      await input.onMessage({type:'runtime_event',runtime:'bgs',eventType:'assistant.message',text:'Affected behavior passed after repair; audio listening remains unverified.'})
      await recordSyntheticDesignReview(input)
      await input.finalOutput.accept({status:'ready',summary:'Game and current decisions ready'})
    } else {
      expect(input.finalOutput).toBeUndefined()
      expect(input.implementationHandoff).toBeUndefined()
    }
  })
  Object.assign(f.body.brief, { creation_mode: 'creative', build_source: null,
    settings: { platform: 'Web', engine: 'React', dimension: '2D', orientation: 'Auto' } })
  try {
    await seedLegacyIsolatedRun(f,false)
    await f.call('/agent/goal', 'POST', f.body)
    let run = await f.wait(r => r.agentTurns?.length === 1 && !r.writer && Boolean(r.agentTurns.at(-1)?.finishedAt))
    expect(run.agentTurns!.map(t=>t.production?.stage)).toEqual(['implementation'])
    expect(f.submissions).toHaveLength(1)
    expect(f.starts[0]!.workflowDescription).toContain('Complete the authorized implementation through native completion')
    expect(checks).toEqual(['build','check-failed','repair','check-passed'])
    expect(run.status,run.blockedReason).toBe('completed')
    expect(run.blockedReason).toBeUndefined()
    expect(run.agentTurns![0]!.productionHandoff).not.toHaveProperty('next')
    expect(run.agentTurns!.every(t=>!t.implementationVerification)).toBe(true)
    expect(run.deliveryEligible).toBe(false)
    const original=structuredClone(run.agentTurns![0])
    const before=f.submissions.length
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    expect(f.submissions).toHaveLength(before)
    expect((await f.call('/agent/messages','POST',{requestKey:'later-small-fix',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Fix the requested control label.'})).status).toBe(202)
    run=await f.wait(r=>r.agentTurns?.length===2&&!r.writer&&Boolean(r.agentTurns[1]?.finishedAt))
    expect(run.status,run.blockedReason).toBe('completed')
    expect(run.agentTurns![0]).toEqual(original)
    expect(f.submissions).toHaveLength(2)
    expect(f.submissions[1]!.finalOutput).toBeUndefined()
    expect(f.submissions[1]!.implementationHandoff).toBeUndefined()
  } finally { await f.close() }
})

test('automatic direction reaches the Agent unchanged without fixing the image capability to landscape or portrait',async()=>{
  const calls:any[]=[]
  const f=await fixture('normal',false,undefined,value=>{
    calls.push(value);return{fetch: (request:Request) => fetch(new Request('http://127.0.0.1:1/offline', request)),instruction:'No image generation',close:async()=>{}}
  },0,{},undefined,false,async root=>{
    const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(root,f.body.chatSessionId),'utf8'))
    expect((await fetch(capability.assets.imageEndpoint)).status).toBe(409)
  })
  Object.assign(f.body.brief.settings,{orientation:'Auto'})
  try{
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    const run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    expect(run.requirements.constraints.orientation).toBe('Auto')
    expect(calls).toHaveLength(1)
    expect(calls[0].screenOrientation).toBeUndefined()
    expect(JSON.parse(calls[0].confirmedRequirements).settings.orientation).toBe('Auto')
    const context=agentProfessionalContextForRun({...run,requirements:{...run.requirements,constraints:{...run.requirements.constraints,platform:'Web',engine:'React',dimension:'2D'}}})
    expect(context).toContain('orientation Auto means adapting the same game to landscape and portrait containers')
    expect(context).toContain('CSS viewport is the available game container')
    expect(context).toContain('not an implicit minimum playable window')
  }finally{await f.close()}
})

for (const mode of ['continue','continue-twice','continue-after-pass','work','change'] as const)
test('GDD review lineage survives interrupted design and stays isolated from new scope: '+mode,async()=>{
  let entered=0, waiting=0
  const findings=[{location:'Rules',issue:'Two incompatible outcomes',evidence:'Rule A and Rule B apply to the same event.',impact:'The result is undetermined.'}]
  const response={finding:1,status:'corrected' as const,evidence:'Saved Rules now specifies one outcome.'}
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    const review=input.finalOutput?.designReview
    if(!review)return
    const index=entered++
    await mkdir(join(root,'docs'),{recursive:true})
    if(index===0) {
      await writeFile(join(root,'docs/GDD.md'),'# Design\n## Rules\nInitial contradictory definitions.\n')
      const {source}=await review.candidate({status:'ready',summary:'Initial draft'})
      await review.record({source,nativeThreadId:'saved-review-1',nativeTurnId:'saved-review-turn-1',
        startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:01Z',report:{summary:'One supported issue',findings}})
      if(mode==='continue-after-pass') {
        await writeFile(join(root,'docs/GDD.md'),'# Design\n## Rules\nOne consistent outcome.\n')
        const result={status:'ready',summary:'Revised source',reviewResponses:[response]}
        const {source}=await review.candidate(result)
        await review.record({source,nativeThreadId:'saved-review-passed',nativeTurnId:'saved-review-passed-turn',
          startedAt:'2026-01-01T00:01:00Z',finishedAt:'2026-01-01T00:01:01Z',authorResponses:[response],response:result.summary,
          report:{summary:'Resolved',findings:[],resolutions:[response]}})
      }
    } else {
      if(mode==='continue-after-pass') {
        expect(review.previousReviews).toHaveLength(2)
        const result={status:'ready',summary:'Revised source',reviewResponses:[response]}
        expect(await review.candidate(result)).toMatchObject({reviewResponses:[response]})
        expect(await review.candidate({status:'ready',summary:'Same reviewed source, no author envelope'})).toHaveProperty('source')
        await input.finalOutput!.accept(result)
        return
      }
      const sameScope=mode==='continue'||mode==='continue-twice'
      expect(review.previousReviews).toHaveLength(sameScope?1:0)
      if(sameScope) {
        expect(review.previousReviews![0]!.nativeThreadId).toBe('saved-review-1')
        expect(input.finalOutput!.schema).toMatchObject({type:'object',required:['status','summary']})
        expect(input.finalOutput!.schema).not.toHaveProperty('anyOf')
        expect(await review.candidate({status:'ready',summary:'Saved revision without author envelope'})).toHaveProperty('source')
        await expect(input.finalOutput!.accept({status:'ready',summary:'No new review'})).rejects.toThrow()
      }
      if(mode!=='continue-twice'||index===2) {
        await writeFile(join(root,'docs/GDD.md'),'# Design\n## Rules\nOne consistent outcome.\n')
        const result={status:'ready',summary:'Saved consistent rules',...(sameScope?{reviewResponses:[response]}:{})}
        const {source}=await review.candidate(result)
        await review.record({source,nativeThreadId:'saved-review-2',nativeTurnId:'saved-review-turn-2',
          startedAt:'2026-01-01T00:01:00Z',finishedAt:'2026-01-01T00:01:01Z',
          ...(sameScope?{authorResponses:[response],response:result.summary}:{}),
          report:{summary:'Definitions agree',findings:[],...(sameScope?{resolutions:[response]}:{})}})
        await input.finalOutput!.accept(result)
        return
      }
    }
    waiting++
    await new Promise<void>(resolve=>{if(input.signal.aborted)resolve();else input.signal.addEventListener('abort',()=>resolve(),{once:true})})
  })
  Object.assign(f.body.brief,{creation_mode:'creative',settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Auto'}})
  await seedGddOnlyRun(f,true)
  try {
    await f.call('/agent/goal','POST',f.body)
    await f.wait(()=>waiting===1)
    await f.call('/stop','POST')
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.quiescedAt)&&!r.writer)
    const original=structuredClone(run.agentTurns![0]!)
    const originalRevision=run.requirements.revision
    expect(original.requirementsRevision).toBe(originalRevision)
    const cycles=mode==='continue-twice'?2:1
    for(let cycle=0;cycle<cycles;cycle++) {
      if(run.paused){await f.call('/resume','POST',{planRevision:run.planRevision});run=(await f.store.read(run.projectId,run.ownerId))!}
      const previous=run.agentTurns!.at(-1)!
      const intent=mode==='work'||mode==='change'?mode:'continue'
      const result=await f.call('/agent/messages','POST',{requestKey:'resume-gdd-'+mode+'-'+cycle,runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,
        ...(intent==='continue'?{continuationOf:previous.attemptId,text:''}:{text:'Revise the design assignment for this requested scope.'})})
      expect(result.status,await result.clone().text()).toBe(202)
      if(cycle<cycles-1) {
        await f.wait(()=>waiting===2)
        await f.call('/stop','POST')
        run=await f.wait(r=>r.agentTurns!.length===2&&Boolean(r.agentTurns![1]!.quiescedAt)&&!r.writer)
      }
    }
    run=await f.wait(r=>Boolean(r.agentTurns?.[cycles]?.finishedAt)&&!r.writer)
    expect(run.agentTurns![cycles]!.status,run.agentTurns![cycles]!.error).toBe('ended')
    if(mode==='continue-after-pass')expect(run.agentTurns![cycles]!.designReviews).toBeUndefined()
    else expect(run.agentTurns![cycles]!.designReviews).toHaveLength(1)
    expect(run.agentTurns![0]!.designReviews).toEqual(original.designReviews)
    expect(run.agentTurns![0]!.error).toEqual(original.error)
    expect(run.agentTurns![cycles]!.productionHandoff!.sources[0]).toEqual((mode==='continue-after-pass'?original.designReviews!.at(-1)!:run.agentTurns![cycles]!.designReviews![0]!).source)
    if(mode==='continue-twice')expect(run.agentTurns![1]!.designReviews).toBeUndefined()
    if(mode==='change')expect(run.requirements.revision).not.toBe(originalRevision)
    else expect(run.requirements.revision).toBe(originalRevision)
  }finally{await f.close()}
})


test('author preview reuses its service, cleans it on pause and opens again through normal continuation', async () => {
  let launches=0,stops=0,checks=0
  const manager=new BeeGamePreviewManager(()=>{launches++;let finish!:()=>void;return {kill(){stops++;finish()},exited:new Promise<void>(resolve=>{finish=resolve})}},
    63100,async()=>63100,async()=>true)
  const f=await fixture('wait',false,undefined,undefined,0,{},undefined,false,async(root,input)=>{
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs'}}))
    const before=await input.workflow!({action:'preview',operation:'status'},input.signal) as any
    expect(before.status).not.toBe('running');expect(before.url).toBeUndefined()
    const [a,b]=await Promise.all([input.workflow!({action:'preview',operation:'start'},input.signal),
      input.workflow!({action:'preview',operation:'start'},input.signal)]) as any[]
    expect(a.status).toBe('running');expect(a.url).toBe(new URL(manager.runningForWorkspace(root)!.url,'http://localhost').href)
    expect(b).toEqual(a);checks++
    await expect(input.workflow!({action:'preview',operation:'start',workspacePath:'/another-project'},input.signal)).rejects.toThrow()
  },()=>manager)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>checks===1)
    expect(launches).toBe(1)
    await f.call('/stop','POST');run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(stops).toBe(1);expect(manager.runningForWorkspace(f.root)).toBeUndefined()
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    f.setMode('normal')
    expect((await f.call('/agent/messages','POST',{requestKey:'preview-continue',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',text:'',
      continuationOf:run.agentTurns![0]!.attemptId})).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(checks).toBe(2);expect(launches).toBe(2);expect(stops).toBe(2)
    expect(run.agentTurns![1]!.status).toBe('ended');expect(run.writer).toBeUndefined()
    expect(run.agentTurns![1]!.productionHandoff).toBeUndefined()
  }finally{await f.close();manager.dispose()}
})

test('author inspection reuses an existing user preview without closing or restarting it', async () => {
  let launches=0,stops=0
  const manager=new BeeGamePreviewManager(()=>{launches++;let finish!:()=>void;return {kill(){stops++;finish()},exited:new Promise<void>(resolve=>{finish=resolve})}},
    63100,async()=>63100,async()=>true,'https://preview.example/previews')
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,false,async(_root,input)=>{
    const preview=await input.workflow!({action:'preview',operation:'start'},input.signal) as any
    expect(preview.status).toBe('running')
    expect(preview.url).toBe(new URL(manager.status('user-preview',f.root).url,'http://localhost').href)
  },()=>manager)
  try {
    await writeFile(join(f.root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs'}}))
    await manager.start({sessionId:'user-preview',workspacePath:f.root})
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.agentTurns![0]!.status).toBe('ended')
    expect(launches).toBe(1);expect(stops).toBe(0)
    expect(manager.status('user-preview',f.root).status).toBe('running')
  }finally{await f.close();manager.dispose()}
})


for (const transport of ['native','legacy-http'] as const) test(`pausing the author during preview startup cancels ${transport} and closes the acquired process`, async () => {
  let launches=0,stops=0
  const manager=new BeeGamePreviewManager(()=>{launches++;let finish!:()=>void;return {kill(){stops++;finish()},exited:new Promise<void>(resolve=>{finish=resolve})}},
    63100,async()=>63100,async()=>new Promise<boolean>(()=>{}))
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,false,async(root,input)=>{
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs'}}))
    if (transport === 'native') await input.workflow!({action:'preview',operation:'start'},input.signal)
    else {
      const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(root,f.body.chatSessionId),'utf8'))
      await fetch(capability.assets.registrationEndpoint,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({workflow:{action:'preview',operation:'start'}}),signal:input.signal})
    }
  },()=>manager)
  try {
    await f.call('/agent/goal','POST',f.body)
    await f.wait(()=>launches===1)
    expect((await f.call('/stop','POST')).status).toBe(202)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(stops).toBe(1);expect(run.writer).toBeUndefined()
    expect(run.agentTurns![0]!.status).toBe('interrupted')
    expect(manager.runningForWorkspace(f.root)).toBeUndefined()
  }finally{await f.close();manager.dispose()}
})


// The existing local session fixture exercises the real production scheduler,
// fresh/resume selection, CAS ownership and native-result callbacks.
test('isolated verification keeps build history out and returns aggregate repair to the original author',async()=>{
  let verifications=0
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    if(input.finalOutput?.designReview) {
      await input.finalOutput.writeDocument!.authorize()
      await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Required interaction\nDESIGN_BODY_ONLY_WHEN_READ\n')
      await recordSyntheticDesignReview(input)
      await input.finalOutput.accept({status:'ready',summary:'Current required interaction defined'})
    } else if(input.finalOutput?.readOnly) {
      verifications++
      expect(input.imageGenerationEntry).toBeUndefined()
      const context=String(f.starts.at(-1).systemContext)
      expect(context).not.toContain('AUTHOR_TOOL_HISTORY')
      expect(context).not.toContain('DESIGN_BODY_ONLY_WHEN_READ')
      expect(context).not.toContain('read the applicable artwork-production guidance')
      const prompt=typeof input.prompt==='string'?input.prompt:input.prompt.map((block:any)=>block.type==='text'?block.text:'').join('\n')
      expect(prompt.split('DESIGN_BODY_ONLY_WHEN_READ')).toHaveLength(2)
      expect(input).not.toHaveProperty('preferredSkill')
      expect(input.baseInstructions).toContain('You are the independent runtime verifier')
      expect(input.baseInstructions).toContain('rather than inferring completion from object or control presence')
      expect(input.baseInstructions).toContain('Ordinary aesthetic alternatives within a satisfied treatment are not product defects')
      expect(prompt).not.toContain('Return the final JSON result:')
      expect(input.baseInstructions).toContain('BGS derives the existing pass, repair or blocked outcome')
      expect(context).toContain('Observed input at 640x360; result captured in checks/result.json; remaining sound observation unverified')
      expect(context).toContain('checks/replay.mjs')
      expect(context).not.toContain('BRIEF_FINAL_WITHOUT_OBSERVATIONS')
      await expect(input.workflow!({action:'implement',summary:'Bypass repair',sections:[],files:[]})).rejects.toMatchObject({code:'verification-read-only'})
      await input.onMessage({type:'runtime_event',runtime:'bgs',eventType:'tool.completed',toolName:'Browser',toolUseID:'verification-only-'+verifications,output:'VERIFIER_TOOL_HISTORY'})
      await input.finalOutput.accept(verifications===1
        ? {summary:'Other required checks passed; the changed input path needs correction.',observations:[{outcome:'Required input feedback',status:'failed',evidence:'Input accepted but expected feedback absent in the captured passage.'}]}
        : {summary:'Affected input now produces feedback; unchanged observations reused.',observations:[{outcome:'Required input feedback',status:'passed',evidence:'Affected input now produces feedback under the same conditions; unchanged observations reused.'}]})
    } else {
      if(input.implementationHandoff)expect(input.baseInstructions).toContain('You are the implementation author')
      else expect(input.baseInstructions).toBeUndefined()
      if(verifications===1) {
        const context=String(f.starts.at(-1).systemContext)
        expect(context).toContain('Input accepted but expected feedback absent')
        expect(context).not.toContain('VERIFIER_TOOL_HISTORY')
      }
      await input.onMessage({type:'runtime_event',runtime:'bgs',eventType:'tool.completed',toolName:'Shell',toolUseID:'author-only-'+verifications,output:'AUTHOR_TOOL_HISTORY'})
      if(input.implementationHandoff) {
        const authorPrompt=typeof input.prompt==='string'?input.prompt:input.prompt.map((block:any)=>block.type==='text'?block.text:'').join('\n')
        expect(authorPrompt).toContain('Before specialist work, read the applicable Skills and necessary references from the available catalog')
        expect(authorPrompt).toContain('When existing evidence is insufficient for the current question, use available search tools')
        expect(String(f.starts.at(-1).systemContext)).not.toContain('Before specialist work,')
        await mkdir(join(root,'checks'),{recursive:true})
        await writeFile(join(root,'checks/replay.mjs'),'// Existing reusable fixture scenario\n')
        await writeFile(join(root,'checks/result.json'),JSON.stringify({condition:'640x360',observed:'input accepted'}))
        const summary='Observed input at 640x360; result captured in checks/result.json; remaining sound observation unverified'
        await input.workflow!({action:'advance',summary,sections:[],files:['checks/replay.mjs','checks/result.json']})
        expect(input.implementationHandoff()).toBe(summary)
        await input.onMessage({type:'runtime_event',runtime:'bgs',eventType:'assistant.message',text:'BRIEF_FINAL_WITHOUT_OBSERVATIONS'})
      }
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Auto'}})
  await seedLegacyIsolatedRun(f)
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(r=>r.agentTurns?.length===5 && r.status==='completed' && !r.writer)
    expect(run.agentTurns!.map(t=>t.production?.stage)).toEqual(['design','implementation','verification','implementation','verification'])
    const author=run.agentTurns![1]!,repair=run.agentTurns![3]!
    expect(f.submissions[1]!).not.toHaveProperty('preferredSkill')
    expect(f.submissions[3]!).not.toHaveProperty('preferredSkill')
    expect(f.submissions[2]!).not.toHaveProperty('preferredSkill')
    expect(f.starts[2].resumeSessionId).toBeUndefined()
    expect(f.starts[2].finalOutput.readOnly).toBe(true)
    expect(run.agentTurns![2]!.nativeSessionId).not.toBe(author.nativeSessionId)
    expect(f.starts[3].resumeSessionId).toBe(author.nativeSessionId)
    expect(repair.nativeSessionId).toBe(author.nativeSessionId)
    expect(f.starts[4].resumeSessionId).toBeUndefined()
    expect(run.agentTurns![4]!.nativeSessionId).not.toBe(run.agentTurns![2]!.nativeSessionId)
    expect(run.agentTurns![4]!.production!.verificationOf).toBe(repair.attemptId)
    expect(run.agentTurns![2]!.implementationVerification?.status).toBe('needs-repair')
    expect(run.agentTurns![4]!.implementationVerification?.status).toBe('passed')
    const forged=structuredClone(run);forged.version++;forged.agentTurns![4]!.implementationVerification!.summary='Rewritten result'
    await expect(f.store.commit(run.projectId,run.ownerId,run.version,forged,'forged.verification')).rejects.toThrow('history')
    expect(run.agentTurns!.every(t=>t.status==='ended'&&t.quiescedAt)).toBe(true)
    expect(f.sessions.transcript(run.chatSessionId).filter(e=>e.type==='user.message')).toHaveLength(1)
    expect(f.submissions.every(input=>!input.nativeGoal)).toBe(true)
    expect(run.deliveryEligible).toBe(false)
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    expect(f.submissions).toHaveLength(5)
    expect((await f.call('/agent/messages','POST',{requestKey:'question-after-check',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,text:'Explain the completed checks only.'})).status).toBe(202)
    run=await f.wait(r=>r.agentTurns?.length===6&&Boolean(r.agentTurns[5]!.finishedAt)&&!r.writer)
    expect(f.submissions).toHaveLength(6)
    // An ordinary user task must not inherit the custom staged-author base.
    expect(f.starts[5].resumeSessionId).toBeUndefined()
    expect(f.starts[5].baseInstructions).toBeUndefined()
    expect(f.submissions[5]!.baseInstructions).toBeUndefined()
    expect(run.agentTurns![1]!.nativeSessionId).toBe(author.nativeSessionId)
    expect(run.agentTurns![5]!.implementationVerification).toBeUndefined()
    expect(run.status).toBe('completed')
  }finally{await f.close()}
},30000)

for(const outcome of ['blocked','invalid','missing'] as const)test('isolated verification '+outcome+' cannot complete or schedule repair',async()=>{
  const f=await fixture('normal',false,undefined,undefined,0,{omitVerificationResult:true},undefined,true,async(root,input)=>{
    if(input.finalOutput?.designReview) {
      await input.finalOutput.writeDocument!.authorize();await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Required interaction\nOne runnable interaction.\n')
      await recordSyntheticDesignReview(input);await input.finalOutput.accept({status:'ready',summary:'Required interaction defined'})
    } else if(input.finalOutput?.readOnly && outcome!=='missing')
      await input.finalOutput.accept(outcome==='blocked'
        ? {summary:'All checks passed.',observations:[{outcome:'Required controlled player action',status:'unverified',evidence:'The required controlled input was not observed; only a stationary result was captured.'}]}
        : {summary:'No valid observations',observations:[]})
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedLegacyIsolatedRun(f)
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>r.agentTurns?.length===3&&Boolean(r.agentTurns[2]!.finishedAt)&&!r.writer)
    expect(run.status).toBe('blocked')
    expect(f.submissions).toHaveLength(3)
    expect(run.agentTurns![2]!.productionHandoff).toBeUndefined()
    expect(run.agentTurns![2]!.status).toBe(outcome==='blocked'?'ended':'failed')
    expect(run.agentTurns![2]!.implementationVerification?.status).toBe(outcome==='blocked'?'blocked':undefined)
    expect(run.blockedReason).toContain(outcome==='blocked'?'required controlled input':outcome==='invalid'?'observations':'without a valid native result')
  }finally{await f.close()}
})

test('isolated verification stop and native resume retain role, author link and read-only result boundary',async()=>{
  let entered=false,verifications=0,lateAccept:((value:unknown)=>Promise<string>)|undefined
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    if(input.finalOutput?.designReview) {
      await input.finalOutput.writeDocument!.authorize();await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Required interaction\nOne current target.\n')
      await recordSyntheticDesignReview(input);await input.finalOutput.accept({status:'ready',summary:'Ready to implement'})
    } else if(input.finalOutput?.readOnly && ++verifications===1) {
      const prompt=typeof input.prompt==='string'?input.prompt:input.prompt.map((block:any)=>block.type==='text'?block.text:'').join('\n')
      expect(prompt.split('One current target.')).toHaveLength(2)
      expect(input).not.toHaveProperty('preferredSkill')
      lateAccept=input.finalOutput.accept;entered=true
      await new Promise<void>(resolve=>input.signal.addEventListener('abort',()=>resolve(),{once:true}))
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedLegacyIsolatedRun(f)
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>entered)
    await f.call('/stop','POST');let run=await f.wait(r=>Boolean(r.paused)&&!r.writer)
    const stopped=run.agentTurns!.at(-1)!,author=run.agentTurns![1]!
    expect(stopped.production?.stage).toBe('verification')
    expect(stopped.status).toBe('interrupted')
    await expect(lateAccept!({summary:'Late result',observations:[{outcome:'Required current action',status:'passed',evidence:'Current action was observed'}]})).rejects.toMatchObject({code:'stale-attempt'})
    expect(f.submissions).toHaveLength(3)
    await f.call('/resume','POST',{planRevision:run.planRevision});run=(await f.store.read(run.projectId,run.ownerId))!
    expect(f.submissions).toHaveLength(3)
    expect((await f.call('/agent/messages','POST',{requestKey:'resume-check',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:stopped.attemptId,text:''})).status).toBe(202)
    run=await f.wait(r=>r.agentTurns?.length===4&&r.status==='completed'&&!r.writer)
    expect(f.starts[3].resumeSessionId).toBe(stopped.nativeSessionId)
    expect(f.starts[3].finalOutput.readOnly).toBe(true)
    expect(f.submissions[3]!.prompt).toEqual([])
    expect(f.submissions[3]!).not.toHaveProperty('preferredSkill')
    expect(f.starts[3].baseInstructions).toBe(f.starts[2].baseInstructions)
    expect(f.submissions[3]!.baseInstructions).toContain('independent runtime verifier')
    expect(f.starts[3]!.workflowDescription).toBe(f.starts[2]!.workflowDescription)
    expect(f.submissions[3]!.workflowDescription).toBe(f.submissions[2]!.workflowDescription)
    expect(run.agentTurns![3]!.production!.verificationOf).toBe(author.attemptId)
    expect(run.agentTurns![3]!.implementationVerification?.status).toBe('passed')
    expect(run.agentTurns![2]!).toEqual(stopped)
    expect(await readFile(join(f.root,'docs/GDD.md'),'utf8')).toBe('# Required interaction\nOne current target.\n')
  }finally{await f.close()}
},30000)

for(const mode of ['ready','source-changed','stop-after-ready'] as const)
test('explicit implementation readiness uses the existing isolated scheduler: '+mode,async()=>{
  let reached=false
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    if(input.finalOutput?.designReview){
      await input.finalOutput.writeDocument!.authorize();await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Confirmed interaction\nCurrent design.\n')
      await recordSyntheticDesignReview(input);await input.finalOutput.accept({status:'ready',summary:'Design ready'})
    }else if(input.finalOutput?.readOnly){
      await input.finalOutput.accept({summary:'Observed required behavior',observations:[{outcome:'Required current behavior',status:'passed',evidence:'Delivered runtime produced the required behavior'}]})
    }else{
      expect(input.baseInstructions).toContain('Your deliverable is runnable code and integrated resources')
      if(input.nativeRecovery){
        expect(input.baseInstructions).toBe(f.submissions[1]!.baseInstructions)
        expect(input.implementationHandoff?.()).toBe('Runnable source; systematic checks remain');return
      }
      expect(input.implementationHandoff?.()).toBeUndefined()
      const entry=await input.workflow!({action:'implement',summary:'Enter current work',sections:[],files:[]})
      expect(entry).not.toHaveProperty('next')
      expect(input.implementationHandoff?.()).toBeUndefined()
      await writeFile(join(root,'entry.js'),'export const ready=true;\n')
      const request={action:'advance',summary:'Runnable source; systematic checks remain',sections:[],files:['entry.js']}
      const handoff=await input.workflow!(request)
      expect(handoff).toMatchObject({next:{stage:'verification'}})
      expect(input.implementationHandoff?.()).toBe(request.summary)
      expect(await input.workflow!(request)).toEqual(handoff)
      reached=true
      if(mode==='source-changed')await writeFile(join(root,'entry.js'),'Changed after readiness')
      if(mode==='stop-after-ready')await new Promise<void>(resolve=>input.signal.addEventListener('abort',()=>resolve(),{once:true}))
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null})
  await seedLegacyIsolatedRun(f)
  try{
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>reached)
    if(mode==='stop-after-ready'){
      await f.call('/stop','POST');run=await f.wait(r=>Boolean(r.paused)&&!r.writer)
      const stopped=run.agentTurns!.at(-1)!
      expect(stopped.status).toBe('interrupted')
      expect(stopped.productionHandoff?.next?.stage).toBe('verification')
      await f.call('/resume','POST',{planRevision:run.planRevision});run=(await f.store.read(run.projectId,run.ownerId))!
      await f.call('/agent/messages','POST',{requestKey:'resume-ready',runId:run.id,chatSessionId:run.chatSessionId,
        expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',continuationOf:stopped.attemptId,text:''})
      run=await f.wait(r=>r.status==='completed'&&!r.writer)
      expect(f.submissions[2]!.prompt).toEqual([])
      expect(run.agentTurns!.map(t=>t.production?.stage)).toEqual(['design','implementation','implementation','verification'])
      expect(run.agentTurns!.at(-1)!.production!.verificationOf).toBe(run.agentTurns![2]!.attemptId)
      expect(run.agentTurns![1]!).toEqual(stopped)
    }else{
      run=await f.wait(r=>!r.writer && (mode==='source-changed'?r.agentTurns!.at(-1)!.status==='failed':r.status==='completed'))
      expect(run.status).toBe(mode==='source-changed'?'blocked':'completed')
      expect(run.agentTurns!.map(t=>t.production?.stage)).toEqual(mode==='source-changed'?['design','implementation']:['design','implementation','verification'])
      if(mode==='source-changed')expect(run.blockedReason).toContain('source changed')
      else expect(run.agentTurns![2]!.production!.verificationOf).toBe(run.agentTurns![1]!.attemptId)
    }
  }finally{await f.close()}
},20000)

for(const delivery of ['missing','intact','changed'] as const)
test('required library delivery is checked at native completion: '+delivery,async()=>{
  const example=assetManifestAuthoringExamples().canonical,item=example.resources[0]!
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    if(input.finalOutput?.designReview){
      await input.finalOutput.writeDocument!.authorize();await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Required scope\nUse the resource library.\n')
    }
    if(delivery!=='missing') {
      await mkdir(join(root,'assets/runtime/example'),{recursive:true})
      await writeFile(join(root,item.root_path),'{}')
      await produceResources(root,{operation:'register',
        projectTarget:{...example.project_target!,resource_library_usage:'required'},requirements:example.requirements,
        resources:[{id:item.id,fulfills:item.fulfills,root_path:item.root_path,file_paths:item.file_paths,provisional:false,
          reason:'Synthetic library data',selection_reason:['Required source'],source:{type:'resource-library',pack_id:'fixture-pack',pack_version:'1',element_id:'element',element_path:'data/item.json'}}]},undefined,'required')
      if(delivery==='changed')await writeFile(join(root,item.root_path),'corrupt')
    }
    await recordSyntheticDesignReview(input);await input.finalOutput!.accept({status:'ready',summary:'Game and design ready'})
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,resource_library_usage:'required',
    settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Auto',resourceLibraryUsage:'required'}})
  try{
    await seedLegacyIsolatedRun(f,false)
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    const run=await f.wait(r=>r.agentTurns?.length===1&&Boolean(r.agentTurns[0]!.finishedAt)&&!r.writer)
    expect(run.status).toBe(delivery==='intact'?'completed':'blocked')
    expect(run.agentTurns![0]!.status).toBe(delivery==='intact'?'ended':'failed')
    if(delivery==='missing')expect(run.agentTurns![0]!.error).toContain('resource_library_usage=required')
    if(delivery==='changed')expect(run.agentTurns![0]!.error).toContain('hash')
    expect(run.agentTurns![0]!.productionHandoff?.next).toBeUndefined()
    expect(run.deliveryEligible).toBe(false)
    expect(f.submissions).toHaveLength(1)
  }finally{await f.close()}
},30000)

test('an unsupported verifier pass for broken required library delivery uses the existing author repair loop',async()=>{
  let verifications=0
  const example=assetManifestAuthoringExamples().canonical,item=example.resources[0]!
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,true,async(root,input)=>{
    if(input.finalOutput?.designReview){
      await input.finalOutput.writeDocument!.authorize();await mkdir(join(root,'docs'),{recursive:true})
      await writeFile(join(root,'docs/GDD.md'),'# Required scope\nUse the resource library.\n')
      await recordSyntheticDesignReview(input);await input.finalOutput.accept({status:'ready',summary:'Design ready'})
    }else if(input.finalOutput?.readOnly){
      verifications++
      // Simulate an external resource change after the source-bound handoff.
      // A model claim cannot override the existing integrity evidence.
      if(verifications===1)await writeFile(join(root,item.root_path),'corrupt')
      await input.finalOutput.accept({summary:'Synthetic runtime observations passed',observations:[{outcome:'Required runtime outcome',status:'passed',evidence:'Current player outcome observed'}]})
    }else{
      await mkdir(join(root,'assets/runtime/example'),{recursive:true})
      await writeFile(join(root,item.root_path),'{}')
      if(!verifications)await produceResources(root,{operation:'register',
        projectTarget:{...example.project_target!,resource_library_usage:'required'},requirements:example.requirements,
        resources:[{id:item.id,fulfills:item.fulfills,root_path:item.root_path,file_paths:item.file_paths,provisional:false,
          reason:'Synthetic library data',selection_reason:['Required source'],source:{type:'resource-library',pack_id:'fixture-pack',pack_version:'1',element_id:'element',element_path:'data/item.json'}}]},undefined,'required')
    }
  })
  Object.assign(f.body.brief,{creation_mode:'creative',build_source:null,resource_library_usage:'required',
    settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Auto',resourceLibraryUsage:'required'}})
  await seedLegacyIsolatedRun(f)
  try{
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    const run=await f.wait(r=>r.status==='completed'&&r.agentTurns?.length===5&&!r.writer)
    expect(run.agentTurns!.map(t=>t.production?.stage)).toEqual(['design','implementation','verification','implementation','verification'])
    expect(run.agentTurns![2]!.implementationVerification?.status).toBe('needs-repair')
    expect(run.agentTurns![2]!.implementationVerification?.findings.join(' ')).toContain('hash')
    expect(run.agentTurns![4]!.implementationVerification?.status).toBe('passed')
    expect(verifications).toBe(2)
    expect(run.agentTurns![3]!.productionHandoff!.sources.some(source=>source.path===item.root_path)).toBe(true)
  }finally{await f.close()}
},30000)


test('GDD optional image access is reference-only on initial execution and stopped-task recovery', async () => {
  let seen = 0, reviewed = false, opened = 0, closed = 0
  const contexts: Array<{requireGdd:boolean}> = []
  const image = Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json({available:true})}})
  const f = await fixture('wait',false,undefined,value=>{
    contexts.push(value);opened++
    return {fetch: (request:Request) => fetch(new Request(image.url.origin, request)),instruction:'Existing reference service',close:async()=>{closed++}}
  },0,{},undefined,true,async(root,input,context)=>{
    const contract = input.finalOutput!
    expect(contract.readOnly).toBe(true)
    expect(contract.writeDocument!.path).toBe('docs/GDD.md')
    expect(input.workflow).toBeDefined()
    expect(input.imageGenerationEntry).toBeDefined()
    expect(input.prompt).not.toContain('and actual pictures')
    expect(context).not.toContain('and actual pictures')
    const prompt=typeof input.prompt==='string'?input.prompt:input.prompt.map((block:any)=>block.type==='text'?block.text:'').join('\n')
    if(input.nativeRecovery) expect(input.prompt).toEqual([])
    else {
      expect(prompt).not.toContain('Before specialist work, read the applicable Skills and necessary references from the available catalog')
      expect(prompt).not.toContain('When existing evidence is insufficient for the current question, use available search tools')
    }
    expect(context).not.toContain('Before specialist work,')
    expect(contract.designReview!.context).not.toContain('Before specialist work,')
    expect(contract.designReview!.context).not.toContain('use available search tools')
    expect(context).toContain('design-reference tools directory')
    expect(context).not.toContain('Register delivered files')
    expect(contract.designReview!.context).not.toContain('design-reference tools directory')
    expect(contract.designReview!.context).not.toContain('imagegen')
    const capability = JSON.parse(await readFile(projectPreviewCapabilityPath(root,f.body.chatSessionId),'utf8'))
    expect(capability.assets).not.toHaveProperty('registrationEndpoint')
    const denied = await fetch(capability.assets.imageEndpoint,{method:'POST',body:JSON.stringify({purpose:'production',prompt:'not authorized here'})})
    expect(denied.status).toBe(403)
    expect((await fetch(capability.assets.imageEndpoint)).status).toBe(200)
    seen++
    if (!input.workflow) throw Error('Expected existing selection capability')
    for (const action of ['advance','preview','implement','resources','visual'])
      await expect(input.workflow({action,summary:'Forbidden production',sections:[],files:[]})).rejects.toThrow('Design may inspect status or select reference images')
    if (seen === 1) {
      await mkdir(join(root,'assets/reference'),{recursive:true})
      await writeFile(join(root,'assets/reference/treatment.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
      const chosen=await input.workflow({action:'select-visual',summary:'Selected before writing GDD',sections:[],files:['assets/reference/treatment.svg']}) as any
      expect(chosen.next).toBeUndefined()
      expect(chosen.sources.map((s:any)=>s.path)).toEqual(['assets/reference/treatment.svg'])
      await mkdir(join(root,'docs'),{recursive:true})
      await contract.writeDocument!.authorize()
      await writeFile(join(root,'docs/GDD.md'),'# Synthetic GDD\n\n## Visual direction\nShared scene and UI treatment.\n')
      await recordSyntheticDesignReview(input)
      reviewed = true
    } else {
      expect(contract.designReview!.previousReviews).toHaveLength(1)
      const status=await input.workflow({action:'status'}) as any
      expect(status.assignment.precedingSources.files).toContain('assets/reference/treatment.svg')
      await contract.accept({status:'ready',summary:'Existing design and optional reference access retained.'})
    }
  })
  try {
    await seedGddOnlyRun(f)
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    await f.wait(()=>reviewed)
    await f.call('/stop','POST')
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt)&&!r.writer)
    expect(closed).toBe(1)
    await f.call('/resume','POST',{planRevision:run.planRevision})
    run=(await f.store.read(run.projectId,run.ownerId))!
    f.setMode('normal')
    expect((await f.call('/agent/messages','POST',{requestKey:'reference-continue',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'continue',text:'',
      continuationOf:run.agentTurns![0]!.attemptId})).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt)&&!r.writer)
    expect(seen).toBe(2);expect(opened).toBe(2);expect(closed).toBe(2)
    expect(contexts.map(x=>x.requireGdd)).toEqual([false,false])
    expect(run.agentTurns![1]!.status,JSON.stringify(run.agentTurns![1])).toBe('ended')
    expect(run.agentTurns![1]!.productionHandoff!.sources.map(x=>x.path)).toEqual(['docs/GDD.md','assets/reference/treatment.svg'])
  } finally {await f.close();image.stop(true)}
},30000)


for(const mode of ['development','production'] as const) test(`author preserves ownership and mode of a user preview still in planning: ${mode}`,async()=>{
  let entered!:()=>void,release!:()=>void,launches=0,stops=0
  const planning=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve)
  const manager=new BeeGamePreviewManager(()=>{
    launches++;let finish!:()=>void
    return {kill(){stops++;finish()},exited:new Promise<void>(resolve=>finish=resolve)}
  },63100,async()=>{entered();await gate;return 63100},async()=>true)
  const f=await fixture('normal',false,undefined,undefined,0,{},undefined,false,async(_root,input)=>{
    const joined=input.workflow!({action:'preview',operation:'start'},input.signal)
    if(mode==='production')await expect(joined).rejects.toMatchObject({code:'preview-conflict'})
    release()
    if(mode==='development')expect(await joined).toMatchObject({status:'running'})
  },()=>manager)
  try{
    await writeFile(join(f.root,'package.json'),JSON.stringify({scripts:{dev:'node dev.cjs',preview:'node preview.cjs'}}))
    const userStart=manager.start({sessionId:f.body.chatSessionId,workspacePath:f.root,mode})
    await planning
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.agentTurns![0]!.status).toBe('ended')
    expect(await userStart).toMatchObject({status:'running',mode})
    expect(launches).toBe(1);expect(stops).toBe(0)
    expect(manager.runningForWorkspace(f.root)?.status).toBe('running')
  }finally{release();await f.close();manager.dispose()}
})
