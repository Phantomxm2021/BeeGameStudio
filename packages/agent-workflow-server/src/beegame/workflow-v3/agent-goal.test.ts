import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BeeGameSessionManager, type BeeGameSessionSubmitInput } from '../session-manager'
import { registerV3Routes } from './routes'
import { createLocalWorkflowStore, createRemoteWorkflowStore, assertCommit, type WorkflowStore } from './store'
import { createAgentGoalExecutor, agentGoalPrompt, agentMessagePrompt, agentProfessionalContextForRun, focusedExecutionFacts } from './agent-goal'
import { createRun, digest, type Run } from './state'
import { openPreviewTestAccess } from '../preview-test-access'
import type { AgentPreviewAccess, AgentImageAccess } from './agent-tools'
import { initializeProjectGuide, PROJECT_WORKING_CONVENTIONS, VISUAL_REFERENCE_EXPECTATIONS, PRODUCTION_DEPENDENCIES } from './project-guide'
import { createAgentMeasurement } from './agent-measurement'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'
import { readContentView } from './content-view'
import { createV3Executor } from './execution'
import { openDesignActions } from './agent-tools'
import { projectPreviewCapabilityPath } from '../project-preview-capability'

test('implementation reads and exact visual saves preserve authorized requirements without freezing later work',async()=>{
  const f=await fixture('wait'),editor=createV3Executor({store:f.store,sessions:f.sessions})
  let measurement:ReturnType<typeof createAgentMeasurement>|undefined
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>f.submissions.length===1)
    await writeDesignDocumentsFixture(f.root)
    await writeFile(join(f.root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',entryScene:'level',
      files:['ui/menu.json','scenes/level.json'],documents:[{id:'menu',path:'ui/menu.json',kind:'ui-screen',loadPhase:'startup'},{id:'level',path:'scenes/level.json',kind:'scene-2d',loadPhase:'startup'}]}))
    measurement=createAgentMeasurement({run,turn:run.agentTurns![0]!,store:f.store})
    expect((await openDesignActions(f.root)('implementation')).valid).toBe(true)
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
    await editor.edit(run,{path:'ui/menu.json',expectedRevision:entry.revision,document,requestKey:'exact-save',
      workflow:{version:run.version,planRevision:run.planRevision,requirementsRevision:run.requirements.revision}})
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
  }finally{await measurement?.close();await editor.dispose();await f.close()}
},30000)

test('resource obligations retain authorization and provenance without prescribing a sourcing or atlas tour', () => {
  for (const prompt of [agentProfessionalContextForRun({} as Run), agentProfessionalContextForRun({} as Run, true)]) {
    expect(prompt).not.toContain('purpose: production')
    expect(prompt).not.toContain('file_paths')
    expect(prompt).not.toContain('local_path')
    expect(prompt).toContain('required licenses')
    expect(prompt).toContain('AI is not the default for all core art')
    expect(prompt).toContain('usage rights')
    expect(prompt).toContain('read-only quote')
    expect(prompt).toContain('no redundant per-image approval')
    expect(prompt).toContain('automatic paid retry')
    expect(prompt).not.toContain('fixed-order shelf packer')
    expect(prompt).not.toContain('Run assets.mjs ui-board-plan')
  }
})

test('task-specific countdown procedure stays in tool help instead of the universal production context', () => {
  expect(PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run)).not.toContain('--countdown-blur-sample')
  expect(PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run)).toContain('actual runtime')
  expect(PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run)).toContain('## Required design dependencies')
})

test('ended native goal exposes independent host evidence, never author acceptance',async()=>{
  const f=await fixture()
  try {
    await f.call('/agent/goal','POST',f.body)
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    const events=f.sessions.transcript(run.chatSessionId)
    const host=events.find(event=>event.payload?.subtype==='host_evidence')!
    expect(host).toBeDefined()
    expect(host.type).toBe('system.status')
    expect(host.payload).toMatchObject({execution:'ended',quality:'unverified',deliveryEligible:false,checkStatuses:[]})
    expect(host.payload!.unmeasured).toEqual([])
    expect(host.text).not.toContain('audio-data-consumption')
    expect(host.text).not.toContain('runtime-smoke')
    expect(host.turnId).toBe(run.agentTurns![0]!.turnId)
    expect(run.deliveryEligible).toBe(false)
    expect(run.status).toBe('blocked')
    const facts={attemptId:'synthetic-report',execution:'ended',measurementId:'scoped-receipt',
      checkStatuses:[{id:'build',status:'failed'},{id:'audio-data-consumption',status:'unverified'}],
      unmeasured:['ui-data-consumption'],note:'Only saved host facts, not 0-assertion author report'}
    f.sessions.recordHostEvidence(run.chatSessionId,facts)
    f.sessions.recordHostEvidence(run.chatSessionId,facts)
    const evidence=f.sessions.transcript(run.chatSessionId).filter(event=>event.payload?.attemptId==='synthetic-report')
    expect(evidence).toHaveLength(1)
    expect(evidence[0]!.payload).toMatchObject({quality:'unverified',deliveryEligible:false,checkStatuses:facts.checkStatuses})
    expect(evidence[0]!.text).toContain('audio-data-consumption')
  } finally {await f.close()}
})

test('image bridge binds real goal owner/project and never opens for duplicate intake',async()=>{
  const calls:any[]=[];let closes=0
  const f=await fixture('normal',false,undefined,undefined,value=>{
    calls.push(value);return {endpoint:'http://127.0.0.1:1/synthetic-image',instruction:'not a generation',
      close:async()=>{closes++}}
  })
  try {
    await f.call('/agent/goal','POST',f.body);let run=await f.wait(r=>Boolean(r.agentTurns![0]?.finishedAt))
    expect(calls).toEqual([{user:{id:'owner',role:'owner'},projectId:'goal-project',workspacePath:f.root,
      visualHandoffVersion:1,screenOrientation:'Landscape'}])
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
    expect(after.requirementChanges).toHaveLength(1)
    expect(after.agentTurns?.[1]?.message?.intent).toBe('message')
    expect(f.submissions[1]!.prompt).toBe('User message:\n'+message.text)
    expect(f.starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(f.events.filter(event=>event==='requirements.changed')).toHaveLength(1)
  }finally{await f.close()}
})


async function fixture(mode:'normal'|'fail'|'wait'='normal',failSettlement=false,resourceLibraryBaseUrl?:string,
  openAgentPreview?:(value:any)=>AgentPreviewAccess,openAgentImage?:(value:any)=>AgentImageAccess, extraEvents=0,
  faults:{claimResponses?:number;exitWrites?:boolean;exitFailures?:number;missingEntrySkill?:boolean}={},libraryAuthToken?:string,blankProject=false) {
  const container=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-goal-unit-')))
  const root=blankProject?join(container,'project'):container
  if(blankProject)await mkdir(root)
  const local=createLocalWorkflowStore(join(container,'host')), submissions:BeeGameSessionSubmitInput[]=[], events:string[]=[]
  const store:WorkflowStore={read:local.read,commit:async(...args)=>{
    if(failSettlement && args[4]==='agent.turn-settled') throw new Error('Synthetic settlement outage')
    if(faults.exitWrites && args[4]==='agent.writer-quiesced'){faults.exitFailures=(faults.exitFailures??0)+1;throw Error('Synthetic exit persistence outage')}
    await local.commit(...args)
    events.push(args[4])
    if((faults.claimResponses??0)>0 && ['agent.turn-claimed','requirements.changed'].includes(args[4])) {
      faults.claimResponses!--;throw Error('Synthetic committed claim response lost')
    }
  }}
  const starts:any[]=[]
  const sessions=new BeeGameSessionManager({async start(input){starts.push(input);const nativeId=input.resumeSessionId??(starts.length===1?'11111111':String(starts.length).padStart(8,'0'))+'-2222-4333-8444-555555555555';input.onNativeSessionId?.(nativeId);const onNativeUsage=input.onNativeUsage;return {
    async submit(input) {
      submissions.push(input)
      const prompt = typeof input.prompt === 'string' ? input.prompt : ''
      if (prompt.startsWith('/bgs-builtins:') && !faults.missingEntrySkill) await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'system.status', text: 'Loaded entry skill', skill: {name:prompt.slice(1,prompt.indexOf(' ')),messageId:'entry-body',source:'command',status:'loaded'} })
      await writeFile(join(root,'candidate.txt'),'Synthetic partial candidate')
      for(let i=0;i<extraEvents;i++)await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic audit event ' + i, assistantBlockId: 'synthetic-' + i })
      if(mode==='wait') await new Promise<void>(resolve=>{
        if(input.signal.aborted)resolve();else input.signal.addEventListener('abort',()=>resolve(),{once:true})
      })
      if(mode==='fail')throw new Error('Synthetic native failure')
      onNativeUsage?.({prompt_tokens:40,completion_tokens:8,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:48})
      await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic end, not game acceptance' })
    },stop(){},
  }}},join(container,'native'),async userDataRoot=>({BEEGAME_CONFIG_DIR:userDataRoot ?? join(root,'wrong-shared-config')}),{},true)
  const userDataRoot=join(root,'owner-config')
  const chat=sessions.start({workspacePath:root,projectId:'goal-project',userId:'owner',userDataRoot})
  let persistFails=false, owner='owner'
  const app=new Hono(),cleanup:(()=>Promise<void>)[]=[]
  registerV3Routes(app,{store,sessions,getUser:()=>({id:owner,role:'owner'}),
    resourceLibraryBaseUrl,
    openAgentPreview,
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
  return {root,store:local,sessions,submissions,starts,events,body,call,wait,setMode:(v:typeof mode)=>{mode=v},setOwner:(v:string)=>{owner=v},setPersistFailure:(v:boolean)=>{persistFails=v},setSettlementFailure:(v:boolean)=>{failSettlement=v},
    close:async()=>{await Promise.all(cleanup.map(fn=>fn()));await sessions.dispose();await rm(container,{recursive:true,force:true})}}
}

for (const creationMode of ['creative', 'blueprint']) test(`blank confirmed Web ${creationMode} intake uses the design-led first version without creating template content`,async()=>{
  const f=await fixture('normal',false,undefined,undefined,undefined,0,{},undefined,true)
  Object.assign(f.body.brief,{creation_mode:creationMode,build_source:null,
    settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape'}})
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(run.creation).toEqual({initialDelivery:'design-led-first-version',editableContent:true})
    const initialMessage = f.sessions.transcript(run.chatSessionId).find(event => event.type === 'user.message')!
    expect(initialMessage, run.blockedReason).toBeDefined()
    expect(initialMessage.payload?.displayText).toBe(f.body.brief.idea)
    expect(JSON.parse(String(initialMessage.payload?.confirmedBriefContext))).toEqual(f.body.brief)
    await expect(readFile(join(f.root,'content/index.json'),'utf8')).rejects.toThrow()
    expect(String(f.submissions[0]!.prompt)).not.toContain(JSON.stringify(f.body.brief))
    expect(f.submissions[0]!.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(String(f.submissions[0]!.prompt)).toStartWith('Complete the current user assignment')
    expect(String(f.submissions[0]!.prompt)).not.toContain('$game-creative-director-expert')
    expect(f.starts[0].systemContext).toContain('design records live under docs/')
    expect(f.starts[0].systemContext).toContain('Bgs loads applicable AGENTS.md instructions natively')
    const guide=await readFile(join(f.root,'AGENTS.md'),'utf8')
    expect(guide).not.toContain('Built-in Skill index')
    expect(guide).not.toContain('Collection navigator:')
    expect(guide).toContain('Select and read applicable Skills')
    expect(f.starts[0].systemContext).not.toContain(guide.slice(guide.indexOf('## Professional methods')))
    expect(run.blockedReason).not.toContain('not full-game completion')
    expect(f.submissions).toHaveLength(1)
    // Identical intake is read-only even after the model has authored new files.
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    expect(f.submissions).toHaveLength(1)
    expect(await readFile(join(f.root,'AGENTS.md'),'utf8')).toBe(guide)
    await mkdir(join(f.root,'src'),{recursive:true})
    await writeFile(join(f.root,'src/game.js'),'// retained user work')
    expect((await f.call('/agent/messages','POST',{requestKey:'feedback',runId:run.id,
      chatSessionId:run.chatSessionId,expectedVersion:run.version,requirementsRevision:run.requirements.revision,
      intent:'work',text:'After playtesting, continue only the requested slice correction.'})).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[1]?.finishedAt))
    expect(f.submissions).toHaveLength(2)
    expect(await readFile(join(f.root,'src/game.js'),'utf8')).toBe('// retained user work')
    expect(run.creation?.initialDelivery).toBe('design-led-first-version')
    const refreshed=await readFile(join(f.root,'AGENTS.md'),'utf8')
    expect(refreshed).toBe(guide)
    expect(refreshed.slice(refreshed.indexOf('## Professional methods'))).toBe(guide.slice(guide.indexOf('## Professional methods')))
  }finally{await f.close()}
},30000)

test('existing sources and an already-running goal never receive a backfilled guide',async()=>{
  const existing=await fixture()
  const running=await fixture('wait',false,undefined,undefined,undefined,0,{},undefined,true)
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
    expect(run.blockedReason).not.toContain('Project navigation refresh failed')
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
  const f=await fixture('normal',false,undefined,undefined,undefined,240)
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
  const f=await fixture('normal',false,undefined,undefined,undefined,240)
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
    const run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(f.submissions).toHaveLength(1)
    const submit=f.submissions[0]!
    expect(submit.language).toBe('zh')
    expect(submit.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(JSON.stringify(submit.prompt)).not.toContain('first assignment ends at visual-direction handoff')
    expect(JSON.stringify(submit.prompt)).not.toContain('Professional coverage:')
    expect(f.starts[0].systemContext).toContain(agentProfessionalContextForRun(run))
    expect(f.starts[0].systemContext).toContain('No root project guide exists')
    expect(f.starts[0].systemContext).toContain('Current BGS tools directory')
    expect(f.starts[0].systemContext).toContain('node measure.mjs, node handoff.mjs')
    expect(f.starts[0].systemContext).toContain('Document navigation: ReadDesignHandoff {} lists files')
    expect(f.starts[0].systemContext).toContain('Plain documents need no index or finalization')
    expect(f.starts[0].systemContext).not.toContain('Document authoring contract:')
    expect(f.starts[0].systemContext).not.toContain('Maintain root AGENTS.md')
    expect(f.starts[0].systemContext).toContain('project-navigation-sources')
    expect(JSON.stringify(submit.prompt)).not.toContain('BGS saved evidence')
    expect(f.starts[0].systemContext.split('Read contracts as needed:')).toHaveLength(2)
    expect(f.starts[0].systemContext).not.toContain('Optional BGS project tools')
    expect(JSON.stringify(submit.prompt)).not.toContain('Optional BGS project tools')
    expect(String(submit.prompt)).not.toContain(JSON.stringify(f.body.brief))
    expect(submit.confirmedBriefContext).toBe(JSON.stringify(f.body.brief))
    expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false)
    expect(run.agentTurns![0]).toMatchObject({sessionId:f.body.chatSessionId,status:'ended',
      usage:expect.objectContaining({prompt_tokens:40,completion_tokens:8})})
    expect(run.agentTurns![0]!.quiescedAt).toBeDefined();expect(run.writer).toBeUndefined();expect(run.deliveryEligible).toBe(false)
    expect(run.blockedReason).toContain('execution completion is not acceptance')
    expect(run.blockedReason).not.toContain('Itemized acceptance')
    expect(run.blockedReason).not.toContain('Visual boards')
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
  const f=await fixture('normal',false,upstream.url.origin,undefined,undefined,0,{},'synthetic-user')
  f.body.brief.idea='Synthetic goal: use the user-supplied character; AI only for the requested background.'
  try {
    expect((await f.call('/agent/goal','POST',f.body)).status).toBe(202)
    let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
    expect(calls).toHaveLength(0)
    const initial=f.starts[0].systemContext
    expect(initial).not.toContain('fixture-audio')
    expect(f.submissions[0]!.confirmedBriefContext).toContain(f.body.brief.idea)
    expect(initial).toContain('Honor explicit resource sources and usage rights')
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
    expect(f.starts[2].systemContext).not.toContain('New design-led first-version deliverables')
    expect(f.starts[2].systemContext).toContain('No root project guide exists')
    expect(f.starts[2].systemContext).not.toContain('## Required design dependencies')
    const locator = /Current BGS tools directory \(relative to project root\): ("[^"]+")/
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
    expect(JSON.parse(run.requirements.text).user_messages).toEqual([{requestKey:question.requestKey,text:question.text}])
    const change={...question,requestKey:'chat-change',expectedVersion:run.version,
      requirementsRevision:run.requirements.revision,text:'Make the level easier and update the design record.'}
    expect((await f.call('/agent/messages','POST',change)).status).toBe(202)
    run=await f.wait(r=>Boolean(r.agentTurns?.[2]?.finishedAt))
    expect(JSON.stringify(f.submissions[2]!.prompt)).toContain(change.text)
    expect(JSON.parse(run.requirements.text).user_messages).toEqual([
      {requestKey:question.requestKey,text:question.text},
      {requestKey:change.requestKey,text:change.text},
    ])
    expect(run.requirements.revision).not.toBe(question.requirementsRevision)
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
    expect(f.starts[1].systemContext).toContain('BGS saved evidence')
    expect(f.starts[1].systemContext).toContain('reportSemantics')
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
    expect(f.starts[0].systemContext).not.toContain(VISUAL_REFERENCE_EXPECTATIONS)
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
    expect(f.starts[1].systemContext).not.toContain(VISUAL_REFERENCE_EXPECTATIONS)
    expect(await readFile(file,'utf8')).toBe(first.replace('GUIDE_ROUTE_ONE','GUIDE_ROUTE_TWO'))
    expect(f.starts[1].systemContext).not.toContain('GUIDE_ROUTE_ONE')
    await writeFile(file, PROJECT_WORKING_CONVENTIONS)
    await send('work', 'guide-current')
    expect(f.starts[2].systemContext).not.toContain(VISUAL_REFERENCE_EXPECTATIONS)
    expect(f.starts[2].systemContext).not.toContain(PRODUCTION_DEPENDENCIES)
    expect(await readFile(file, 'utf8')).toBe(PROJECT_WORKING_CONVENTIONS)
    await rm(file);await send('work','guide-missing')
    expect(f.starts[3].systemContext).toContain('No root project guide exists')
    expect(f.starts[3].systemContext).not.toContain('GUIDE_ROUTE_TWO')
    expect(f.starts[3].systemContext).not.toContain(VISUAL_REFERENCE_EXPECTATIONS)
    expect(f.starts[3].systemContext).not.toContain(PRODUCTION_DEPENDENCIES)
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
    const facts=JSON.parse(f.starts[1].systemContext.split('BGS saved evidence (not game acceptance): ')[1]!)
    expect(facts.executionContext.requirements).toMatchObject({revision:run.requirements.revision})
    expect(facts.executionContext.requirements).not.toHaveProperty('text')
    expect(f.submissions[1].confirmedBriefContext).toBe(run.requirements.text)
    expect(f.starts[1].systemContext).toContain('not-transferred')
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
    const focusedFacts=JSON.parse(f.starts[4].systemContext.split('BGS saved evidence (not game acceptance): ')[1]!).executionContext
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
        .rejects.toThrow('No saved native conversation/exit evidence')
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
    measurements:[{id:'pending',requestKey:'pending-measure',startedAt:'started'}],
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
  for(const value of ['Keep the selected theme','Use keyboard controls'])expect(text).not.toContain(value) // Retained in the separate confirmed brief.
  expect(facts.priorUserRequests).toEqual([{requestKey:'prior',intent:'discuss',text:'Use the blue option'}])
  for(const value of ['PRIVATE_OLD_MODEL_HISTORY','PRIVATE_OLD_TOOL_OUTPUT','OLD_PERMISSION','CURRENT_WORK',
    'OLD_EXECUTION_INSTRUCTION','OLD_CONTINUATION_INSTRUCTION'])expect(text).not.toContain(value)
  expect(facts.answeredQuestions).toHaveLength(2)
  expect(facts.answeredQuestions[1]).toMatchObject({status:'deny',questions:[{question:'Unchosen route?'}]})
  expect(facts.answeredQuestions[1]).not.toHaveProperty('answers')
})

test('shared guide supplies design methods once without a compatibility fallback',()=>{
  const run={creation:{initialDelivery:'design-led-first-version',editableContent:true}} as Run
  for(const followup of [false,true]) {
    const savedGuide=PROJECT_WORKING_CONVENTIONS+'\nPROJECT_SPECIFIC_ROUTE'
    const professional=agentProfessionalContextForRun(run,followup)
    expect(professional).not.toContain('## Professional methods')
    expect(professional).not.toContain('## Required design dependencies')
    const context=professional+'\n'+savedGuide
    expect(context.split('## Professional methods')).toHaveLength(2)
    expect(context.split('## Required design dependencies')).toHaveLength(2)
    expect(context.split(PRODUCTION_DEPENDENCIES)).toHaveLength(2)
    for(const value of ['Select and read applicable Skills','TECHNICAL_DESIGN.md','PROJECT_SPECIFIC_ROUTE',
      'unknown paid replay or automatic paid retry','respect exclusions and the project budget','required licenses'])expect(context).toContain(value)
  }
})

test.each([undefined,'# Custom navigation\nRun the saved command'])('goal dispatch does not supplement a missing or custom guide: %s',async guide=>{
  const f=await fixture()
  try {
    if(guide!==undefined)await writeFile(join(f.root,'AGENTS.md'),guide)
    await f.call('/agent/goal','POST',f.body)
    await f.wait(run=>Boolean(run.agentTurns?.[0]?.finishedAt))
    const context=f.starts[0].systemContext
    expect(context).not.toContain('## Professional methods')
    expect(context).not.toContain('## Required design dependencies')
    expect(context).toContain('Current BGS tools directory')
    expect(context).toContain('actual runtime')
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
  expect(first).toContain('design dependencies and professional methods in the project guide')
  expect(first).not.toContain('GDD.md,')
  expect(first).not.toContain('Draft technical/resource plans first')
  expect(followup).not.toContain('eight documents')
  expect(followup).not.toContain('New design-led first-version deliverables')
  expect(followup).toContain('content/scenes/*.json')
  expect(followup).toContain('actual runtime')
  expect(followup).not.toContain(PROJECT_WORKING_CONVENTIONS)
  expect(followup).not.toContain('Before creating or changing visual implementation')
  expect(agentProfessionalContextForRun({...run,creation:undefined})).not.toContain('eight documents')
  expect(agentGoalPrompt(run)).not.toContain('ORIGINAL_CONFIRMED_GOAL')
  expect(agentGoalPrompt(run)).toContain('bgsConfirmedBrief')
})

test('stable system context preserves design authority and evidence boundaries, not implementation recipes', () => {
  const message={intent:'change',text:'Change only movement speed'} as Parameters<typeof agentMessagePrompt>[0]
  for(const prompt of [false,true].map(followup=>PROJECT_WORKING_CONVENTIONS+'\n'+agentProfessionalContextForRun({} as Run,followup))) {
    expect(prompt).toContain('Select and read applicable Skills')
    expect(prompt).toContain(PROJECT_WORKING_CONVENTIONS)
    expect(prompt).toContain('without a second hardcoded layout')
    expect(prompt).toContain('Prose, palettes and JSON geometry do not replace visual design')
    expect(prompt).toContain('do not create runtime scene/UI content here')
    expect(prompt).toContain('Resolve resource production methods and consuming interfaces from selected designs and actual resources')
    expect(prompt).not.toContain('Technical/resource plans start as drafts')
    expect(prompt).not.toContain('without waiting for production assets')
    expect(prompt).not.toContain('file_paths')
    expect(prompt).not.toContain('local_path')
    expect(prompt).not.toContain('request a separate shared PNG sheet')
    expect(prompt).not.toContain('computed equal-cell grid')
    expect(prompt.length).toBeLessThan(7000)
  }
  for(const intent of ['message','change','continue'] as const) {
    const prompt=agentMessagePrompt({...message,intent})
    expect(prompt).not.toContain('eight documents')
    expect(prompt).not.toContain('full design or resource-production cycle')
    expect(prompt).toContain('Change only movement speed')
  }
})
for(const contextMode of ['resume','focused'] as const) test(contextMode+' continuation preserves pause and identity without automatic execution',async()=>{
  const f=await fixture('wait')
  try {
    await f.call('/agent/goal','POST',f.body);await f.wait(()=>f.submissions.length===1)
    await f.call('/stop','POST');let run=await f.wait(r=>Boolean(r.agentTurns?.[0]?.finishedAt))
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
    if(contextMode==='resume')expect(run.agentTurns![1]!.nativeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    else {
      expect(f.starts[1].resumeSessionId).toBeUndefined()
      expect(run.agentTurns![1]!.nativeSessionId).not.toBe(run.agentTurns![0]!.nativeSessionId)
      const facts=JSON.parse(f.starts[1].systemContext.split('BGS saved evidence (not game acceptance): ')[1]!).executionContext
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
    const capabilityFile=projectPreviewCapabilityPath(f.root,run.chatSessionId,'assets')
    const config=JSON.parse(await readFile(capabilityFile,'utf8'))
    const url=config.assets.libraryBaseUrl+'/api/resource-search'
    expect((await fetch(url)).status).toBe(503) // no user token; upstream never called
    await f.call('/stop','POST');await f.wait(r=>Boolean(r.agentTurns![0]!.finishedAt))
    await expect(fetch(url)).rejects.toThrow()
    expect((await f.store.read('goal-project','owner'))!.writer).toBeUndefined()
  }finally{await f.close()}
})

test('Preview is bound by the route; duplicate intake never opens it; pause drains before unlock',async()=>{
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
    const msg=(key:string,intent:'change')=>({requestKey:key,runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text:'Synthetic message'})
    closing=false;f.setMode('wait');await f.call('/agent/messages','POST',msg('change','change'))
    await f.wait(()=>f.submissions.length===2)
    let stopFinished=false
    const stopping=Promise.resolve(f.call('/stop','POST')).then(response=>{stopFinished=true;return response})
    await f.wait(()=>closing)
    const paused=(await f.store.read('goal-project','owner'))!
    expect(paused.writer).toBeDefined();expect(stopFinished).toBe(false)
    const resuming=f.call('/resume','POST',{planRevision:paused.planRevision})
    release()
    expect((await stopping).status).toBe(202)
    expect((await resuming).status).toBe(200)
    run=(await f.store.read('goal-project','owner'))!
    expect(run.writer).toBeUndefined();expect(run.agentTurns![1]!.status).toBe('interrupted')
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
      .rejects.toThrow('No saved native conversation/exit evidence')
  }finally{await executor.dispose();await sessions.dispose();await rm(root,{recursive:true,force:true})}
})
test('proven no-start requires a new explicit work request; duplicate goal, pause and stale authorization never dispatch',async()=>{
  const f=await fixture('normal',false,undefined,undefined,undefined,0,{claimResponses:1})
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
test('original host can explicitly persist observed native exit after DB failure; restarted workers cannot infer it',async()=>{
  const faults={exitWrites:true,exitFailures:0},f=await fixture('normal',false,undefined,undefined,undefined,0,faults)
  const other=createAgentGoalExecutor({store:f.store,sessions:f.sessions})
  try {
    await f.call('/agent/goal','POST',f.body)
    let run=await f.wait(()=>faults.exitFailures>0)
    expect(run.agentTurns![0]!.quiescedAt).toBeUndefined();expect(f.submissions).toHaveLength(1)
    const detail=await (await f.call('')).json();expect(detail.recoveryEvidence).toBe('original-host')
    await expect(other.recover(run,{expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence})).rejects.toThrow('No durable native exit')
    faults.exitWrites=false
    const response=await f.call('/recover-writer','POST',{expectedVersion:run.version,attemptId:run.writer!.attemptId,fence:run.writer!.fence})
    expect(response.status,await response.clone().text()).toBe(200)
    run=(await f.store.read(run.projectId,run.ownerId))!
    expect(run.writer).toBeUndefined();expect(run.agentTurns![0]!.quiescedAt).toBeDefined()
    expect(run.agentTurns![0]!.status).toBe('interrupted');expect(run.agentTurns![0]!.nativeSessionId).toBeDefined()
    expect(f.submissions).toHaveLength(1);expect(run.deliveryEligible).toBe(false)
  }finally{await other.dispose();await f.close()}
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
    await expect(recovery.resume(run)).rejects.toThrow('No durable native exit')
    expect(f.submissions).toHaveLength(1);expect((await f.store.read('goal-project','owner'))!.writer).toEqual(run.writer)
  }finally{await recovery.dispose();await unknownSessions.dispose();await f.close()}
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
    for (const document of ['GDD.md','LEVEL_SCENE_DESIGN.md','BALANCE_DESIGN.md','ART_DIRECTION.md',
      'UI_UX_SPEC.md','AUDIO_DESIGN.md','ASSET_PLAN.md','TECHNICAL_DESIGN.md']) expect(prompt).toContain(document)
    expect(prompt).toContain('once the selected designs and resources for that content exist')
    expect(prompt).toContain('unrelated resources/content may remain planned')
    expect(prompt).toContain('Preserve confirmed requirements')
    expect(prompt).toContain('Skill invocation, complete documents, valid JSON and successful tools do not establish design quality')
  }
  expect(agentGoalPrompt(run)).toContain('Stop at the requested boundary')
  expect(agentGoalPrompt(run)).not.toContain('Plan and execute autonomously')
  expect(agentGoalPrompt(run)).not.toContain('CONFIRMED_GAME')
  expect(agentGoalPrompt(run)).toContain('bgsConfirmedBrief')
  const slice={...run,creation:{initialDelivery:'playable-slice'}} as Run
  expect(agentGoalPrompt(slice)).toContain('Reduced content quantity does not waive the required design dependencies')
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
  expect(agentGoalPrompt(run)).toContain('Select relevant Skills, organize the work')
  expect(agentGoalPrompt(run)).toContain('Stop at the requested boundary')
  expect(agentGoalPrompt(run)).toContain('Respect the production dependencies for work in scope')
  expect(agentGoalPrompt(run)).toContain('do not infer additional deliverables from the project creation mode')
  expect(agentGoalPrompt(run)).not.toContain(run.requirements.text)
  expect(agentGoalPrompt(run)).toContain('bgsConfirmedBrief')
  for(const other of [{...run,creation:undefined},{...run,creation:{initialDelivery:'playable-slice'}},
    {...run,agentTurns:[{nativeSessionId:'existing-context'}]}]) {
    expect(agentGoalPrompt(other as Run)).not.toStartWith('/')
    expect(agentGoalPrompt(other as Run)).not.toContain('$game-creative-director-expert')
  }
  for(const intent of ['message','work','continue','change'] as const)
    expect(agentMessagePrompt({intent,text:'继续处理'} as any)).not.toContain('/bgs-builtins:')
})

test('editable content describes data consumed by the confirmed engine, not an alternative game scaffold', () => {
  const run={creation:{initialDelivery:'design-led-first-version',editableContent:true}} as Run
  const context=agentProfessionalContextForRun(run)
  expect(context).toContain('editable data consumed by the confirmed engine')
  expect(context).toContain('optional browser consumer supports a subset')
  expect(context).toContain('UI-only games without a world scene need no empty Scene')
  expect(context).toContain('Canvas rendering or a single screen does not imply UI-only')
  expect(context).toContain('Dynamic simulation state and game logic belong in code')
  expect(agentProfessionalContextForRun({...run,creation:{...run.creation!,editableContent:false}}))
    .not.toContain('editable data consumed by the confirmed engine')
})
