import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink,chmod} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {Hono} from 'hono'
import {createRun,digest,type AgentTurn,type SkillUse} from './state'
import {createLocalWorkflowStore} from './store'
import {createAgentMeasurement,measurementSummary,measurementRequest} from './agent-measurement'
import {formatError} from '../../../../../src/utils/toolErrors'
import {openAgentTools} from './agent-tools'
import {selectAgentMeasuredBuild,exportAgentMeasuredBuild,inspectAgentMeasurementInputs,discussionMessagesSinceMeasurement} from './measured-build'
import {buildEditableProject} from './editable-project'
import {createMeasuredPreview} from './measured-preview'
import {createPreviewCapabilityManager} from '../../auth/preview-capability'
import {registerV3Routes} from './routes'
import {BeeGameSessionManager} from '../session-manager'
import {projectPreviewCapabilityPath} from '../project-preview-capability'
import {uiLayoutFixture,sceneLayoutFixture,writeDesignDocumentsFixture} from '../fixtures/layout-fixture'
import {createV3Executor} from './execution'
import {readContentView} from './content-view'
import {agentTurnHandoffReason} from './agent-goal'
import {openPreviewTestAccess} from '../preview-test-access'
import {sharedContentChecker} from '../content-checker-runtime'
import {createAgentWorkflowApp} from '../../app'
import {writeBeeGameAssetManifest} from '../asset-contracts'
import {DESIGN_ACCEPTANCE_PATH} from '../design-handoff'
import {initializeProjectGuide,refreshProjectGuide} from './project-guide'
import {CHECK_VERSIONS} from './check-versions'

const JSZip=createRequire(import.meta.resolve('exceljs'))('jszip')
const builder="import{cp,mkdir}from'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');"
async function fixture(script=builder,previousTurns:AgentTurn[]=[],requireEditable=false) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-measure-'))),workspace=join(root,'project')
  await mkdir(join(workspace,'src'),{recursive:true})
  await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
  await writeFile(join(workspace,'build.mjs'),script)
  await writeFile(join(workspace,'src/index.html'),'<html><body><h1>Actual fixture</h1><button>Play</button></body></html>')
  await writeFile(join(workspace,'README.md'),'Merged eight-domain fixture; semantics not verified')
  const store=createLocalWorkflowStore(join(root,'host'))
  const run=createRun({projectId:'measure',ownerId:'owner',workspacePath:workspace,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
  if(requireEditable)run.creation={initialDelivery:'playable-slice',editableContent:true}
  const turn:AgentTurn={attemptId:crypto.randomUUID(),requestKey:'goal',sessionId:'chat',workerId:'worker',fence:1,status:'running',startedAt:new Date().toISOString(),requirementsRevision:run.requirements.revision}
  run.agentTurns=[...previousTurns,turn];run.fence=1;run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:turn.fence}
  await store.commit(run.projectId,run.ownerId,0,run,'fixture')
  const measurement=createAgentMeasurement({run,turn,store})
  const current=async()=>(await store.read(run.projectId,run.ownerId))!
  return {root,workspace,store,run,turn,measurement,current,
    async settle() {
      await measurement.close()
      let next=await current();next.version++;next.agentTurns![0]!.quiescedAt=new Date().toISOString()
      await store.commit(run.projectId,run.ownerId,next.version-1,next,'synthetic.exit')
      next=await current();next.version++;next.agentTurns![0]!.status='ended';delete next.writer
      await store.commit(run.projectId,run.ownerId,next.version-1,next,'synthetic.settle')
      return current()
    },
    async close(){await measurement.close();await rm(root,{recursive:true,force:true})}}
}
const request={requestKey:'measure-1',runtimeArtifact:'dist',reportPaths:['README.md']}

test('unverified optional probes allow only diagnostic measured Preview; failure, missing checks and stale bytes remain blocked',async()=>{
  const f=await fixture()
  try {
    const record=await f.measurement.measure(request)
    const saved=await f.settle()
    const run=structuredClone(saved), measured=run.agentTurns![0]!.measurements![0]!
    // Synthetic checker facts test selection policy, not font consumption.
    measured.consumption={checks:['font-data-consumption']}
    measured.checks.push({id:'font-data-consumption',version:CHECK_VERSIONS['font-data-consumption'],
      status:'unverified',inputs:[],observation:'Canvas fonts are outside this DOM-font driver',
      coverage:{files:[],limitations:['No actual font verdict']},createdAt:new Date().toISOString()})
    const selected=await selectAgentMeasuredBuild(run,record.id,false,'preview')
    expect(selected.limitations.join(' ')).toContain('font-data-consumption')
    expect(measurementSummary(measured)).toMatchObject({quality:'unverified',deliveryEligible:false,
      checkStatuses:expect.arrayContaining([{id:'font-data-consumption',status:'unverified'}])})
    for(const purpose of ['delivery','publication'] as const)
      await expect(selectAgentMeasuredBuild(run,record.id,false,purpose)).rejects.toThrow('consumption checks')
    const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),
      readRun:async()=>run,isBusy:()=>false})
    try {
      const opened=await preview.openAgent(run,record.id)
      expect(opened.limitations.join(' ')).toContain('Diagnostic Preview is not consumption or delivery acceptance')
      expect((await preview.handle(new Request(opened.url)))!.status).toBe(200)
      const probe=measured.checks.at(-1)!
      for(const status of ['failed','execution-error'] as const) {
        probe.status=status
        await expect(selectAgentMeasuredBuild(run,record.id,false,'preview')).rejects.toThrow('consumption checks')
      }
      probe.status='unverified';probe.version='obsolete-driver'
      await expect(selectAgentMeasuredBuild(run,record.id,false,'preview')).rejects.toThrow('checker versions')
      probe.version=CHECK_VERSIONS['font-data-consumption']
      measured.checks.pop()
      await expect(selectAgentMeasuredBuild(run,record.id,false,'preview')).rejects.toThrow('consumption checks')
      measured.checks.push(probe)
      await writeFile(join(f.workspace,'dist/index.html'),'<button>Changed after measurement</button>')
      await expect(selectAgentMeasuredBuild(run,record.id,false,'preview')).rejects.toThrow('artifact bytes changed')
      expect((await preview.handle(new Request(opened.url)))!.status).toBe(409)
    }finally{preview.dispose()}
    expect((await f.current()).agentTurns![0]!.measurements).toHaveLength(1)
  }finally{await f.close()}
},30000)

test.each(['closed','paused','stale'] as const)('design finalize respects the existing %s writer boundary',async state=>{
  const f=await fixture()
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined
  try {
    await writeDesignDocumentsFixture(f.workspace,['GDD.md'])
    tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
    const path=join(f.workspace,'docs/GDD.md')
    await writeFile(path,(await readFile(path,'utf8')).replace('Fixture decision.','Changed decision.'))
    const before=await readFile(path,'utf8')
    if(state==='closed') await f.measurement.close()
    else {
      const next=await f.current();next.version++
      if(state==='paused') next.paused={at:new Date().toISOString()}
      else next.agentTurns![0]!.quiescedAt=new Date().toISOString()
      await f.store.commit(next.projectId,next.ownerId,next.version-1,next,'fixture.boundary')
      if(state==='stale') {
        const settled=await f.current();settled.version++
        settled.agentTurns![0]!.status='ended';delete settled.writer
        await f.store.commit(settled.projectId,settled.ownerId,settled.version-1,settled,'fixture.settled')
      }
    }
    const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(f.workspace,'chat','measurement'),'utf8'))
    const response=await fetch(capability.apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({designAction:'finalize',documents:['GDD.md']})})
    expect(response.status).toBe(409)
    expect(await readFile(path,'utf8')).toBe(before)
  }finally{await tools?.close();await f.close()}
})

test('existing handoff exposes acceptance and measures its evidence without treating a build as delivery PASS',async()=>{
  const f=await fixture()
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined
  try {
    await mkdir(join(f.workspace,'.beegame/delivery'),{recursive:true})
    await mkdir(join(f.workspace,'reports'),{recursive:true})
    await writeFile(join(f.workspace,'reports/observation.txt'),'Synthetic retained observation')
    await writeFile(join(f.workspace,DESIGN_ACCEPTANCE_PATH),JSON.stringify({scope:'delivery',status:'blocked',
      summary:'Gameplay observation remains unverified',environment:'Synthetic fixture',evidencePaths:['reports/observation.txt']}))
    const measured=await f.measurement.measure({...request,reportPaths:[DESIGN_ACCEPTANCE_PATH]})
    expect(measured.checks.find(check=>check.id==='build')?.status).toBe('passed')
    expect(measured.reports.map(file=>file.path)).toEqual([DESIGN_ACCEPTANCE_PATH,'reports/observation.txt'])
    const handoff=await f.measurement.handoff()
    expect(handoff.acceptance).toMatchObject({valid:false,status:'blocked',quality:'unverified'})
    expect(handoff.deliveryEligible).toBe(false)
    tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
    const read=async(action:string)=>{
      const child=Bun.spawn([process.execPath,join(f.workspace,tools!.directory,'handoff.mjs'),'--design',action],{
        cwd:f.workspace,env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'chat','measurement')},
        stdout:'pipe',stderr:'pipe'})
      const result=JSON.parse(await new Response(child.stdout).text())
      return {code:await child.exited,result}
    }
    expect((await read('help')).result.acceptanceInstruction).toContain('designRevision')
    expect(await read('acceptance')).toMatchObject({code:1,result:{valid:false,status:'blocked'}})
    const before=await f.current()
    await writeFile(join(f.workspace,'reports/observation.txt'),'Changed observation, unchanged report')
    expect((await f.measurement.handoff()).measurement?.freshness).toMatchObject({current:false,
      changes:{reports:['reports/observation.txt']}})
    expect(await f.current()).toEqual(before)
  } finally { await tools?.close();await f.close() }
},30000)

test('required editable content cannot be omitted behind a successful build; diagnostic preview remains available',async()=>{
  const f=await fixture(builder,[],true)
  try {
    const record=await f.measurement.measure(request)
    expect(record.checks.find(c=>c.id==='build')?.status).toBe('passed')
    expect(record.checks.find(c=>c.id==='runtime-smoke')?.status).toBe('passed')
    expect(record.checks.find(c=>c.id==='content-structure')).toMatchObject({status:'failed',
      observation:'Required editable Scene/UI content is missing: content/index.json.'})
    const run=await f.settle()
    await expect(selectAgentMeasuredBuild(run,record.id,false,'delivery')).rejects.toThrow('content/index.json')
    await expect(selectAgentMeasuredBuild(run,record.id,false,'preview')).resolves.toBeDefined()
  }finally{await f.close()}
},30000)

test('measurement audits registered requirements even in source-only projects without BGS Scene/UI JSON',async()=>{
  const f=await fixture()
  try {
    await writeBeeGameAssetManifest(f.workspace,{version:9,resources:[],requirements:[
      {id:'required-model',required:true,acquisition_profile:{dimensions:['3D'],asset_kinds:['model'],styles:[]}},
    ]})
    const record=await f.measurement.measure(request)
    const resources=record.checks.find(check=>check.id==='content-resources')
    expect(resources?.status).toBe('failed')
    expect(resources?.coverage?.assetContract?.requirements.map(row=>row.id)).toEqual(['required-model'])
    expect(resources?.inputs.some(file=>file.path.startsWith('assets/manifest/requirements/') && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
    expect(measurementSummary(record,false).resourceStructureCoverage?.requirements[0]?.id).toBe('required-model')
  }finally{await f.close()}
},30000)

test.each([true,false])('measurement checks registered Scene/UI without rejecting intentional unbound visuals; invalid layout=%s',async invalid=>{
  const f=await fixture()
  try {
    await mkdir(join(f.workspace,'content/ui'),{recursive:true})
    await mkdir(join(f.workspace,'content/scenes'),{recursive:true})
    const ui=uiLayoutFixture() as any
    if(invalid)delete ui.data.nodes[0].data.orientation
    await writeFile(join(f.workspace,'content/ui/menu.json'),JSON.stringify(ui))
    await writeFile(join(f.workspace,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(f.workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',
      dimension:'2d',documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',
      sceneModel:'game-object-v2',files:['scenes/level.json','ui/menu.json'],documents:[
        {id:'level',path:'scenes/level.json',kind:'scene-2d',loadPhase:'startup'},
        {id:'menu',path:'ui/menu.json',kind:'ui-screen',loadPhase:'startup'}]}))
    const record=await f.measurement.measure(request),run=await f.settle()
    expect(record.error).toBeUndefined()
    expect(record.checks.map(check=>[check.id,check.status])).toEqual([
      ['build','passed'],['content-structure','passed'],['content-layout',invalid?'failed':'passed'],
      ['content-resources','passed'],['runtime-smoke','passed']])
    expect(record.checks.find(check=>check.id==='content-resources')?.observation).toContain('final resource coverage and runtime use remain unverified')
    expect(measurementSummary(record).contentRuntimeEvidence).toMatchObject({
      sampledDocuments:[],unprobedDocuments:['content/scenes/level.json','content/ui/menu.json']})
    const composition=record.checks[0]!.projectBuild!.packageComposition!
    expect(composition).toMatchObject({fileCount:1,totalBytes:Buffer.byteLength(await readFile(join(f.workspace,'dist/index.html'))),
      productionMaterials:{status:'unverified',candidates:null}})
    expect(measurementSummary(record,false).packageComposition).toEqual(composition)
    expect(run.agentTurns![0]!.measurements![0]!.checks[0]!.projectBuild!.packageComposition).toEqual(composition)
    expect(measurementSummary(record,false).uiBindingCoverage.nodes).toEqual(
      ui.data.nodes.map((node:any)=>({document:'content/ui/menu.json',nodeId:node.id,role:node.role,
        bindings:[],resolution:'not-declared',issues:[],observations:[]})))
    if(invalid)expect(record.checks.find(check=>check.id==='content-layout')?.observation).toContain('root.data.orientation')
    expect((await selectAgentMeasuredBuild(run,record.id,false,'preview')).measurement.id).toBe(record.id)
    if(invalid) {
      await expect(selectAgentMeasuredBuild(run,record.id,false,'publication')).rejects.toThrow('content-layout failed')
      expect(await agentTurnHandoffReason(run,run.agentTurns![0]!)).toContain('content-layout failed')
    } else expect((await selectAgentMeasuredBuild(run,record.id,false,'publication')).measurement.id).toBe(record.id)
  }finally{await f.close()}
},30000)

test('a saved but invalid content registry cannot disappear behind a passing build and smoke',async()=>{
  const f=await fixture()
  try {
    await mkdir(join(f.workspace,'content'),{recursive:true})
    await writeFile(join(f.workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',
      dimension:'2d',documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'missing',
      sceneModel:'game-object-v2',files:['ui/menu.json'],documents:[
        {id:'menu',path:'ui/menu.json',kind:'ui-screen',loadPhase:'startup'}]}))
    const record=await f.measurement.measure(request),run=await f.settle()
    expect(record.checks.map(check=>[check.id,check.status])).toEqual([
      ['build','passed'],['content-structure','failed'],['runtime-smoke','passed']])
    expect(record.checks[1]?.observation).toContain('Content registry paths, IDs, kinds or files disagree')
    await expect(selectAgentMeasuredBuild(run,record.id,false,'publication')).rejects.toThrow('content-structure failed')
  }finally{await f.close()}
},30000)

test.each([false,true])('V3 ordinary deployment publishes exact measured bytes without rebuilding; publisher failure=%s',async failPublication=>{
  const f=await fixture(),cleanups:Array<()=>void|Promise<void>>=[]
  let calls=0,builds=0,native=0
  let role:'owner'|'viewer'='owner'
  try {
    const record=await f.measurement.measure(request)
    expect(record.error).toBeUndefined()
    await f.settle()
    const app=createAgentWorkflowApp({currentUserResolver:async()=>({id:'owner',role}),workflowV3Store:f.store,
      dashboardDataRoot:join(f.root,'dashboard'),defaultWorkspacePath:f.root,modelConfigStore:false,skillsConfig:false,
      sessionRunner:{async start(){native++;throw Error('No native execution')}},
      deploymentRunner:async()=>{builds++;throw Error('Do not rebuild')},
      deploymentPublisher:{async publishStaticDirectory(input){
        calls++
        expect(await input.files.find(x=>x.path==='index.html')!.text()).toBe(await readFile(join(f.workspace,'dist/index.html'),'utf8'))
        return {url:'https://offline.invalid/deployment/'}
      },async verifyPublished(){if(failPublication)throw Error('Synthetic delivery host failed')}},
      registerCleanup:fn=>cleanups.push(fn)})
    const post=(path:string,body:unknown={})=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    expect((await post('/api/projects',{id:'measure',name:'Synthetic measured publication',root_path:f.workspace,created_at:Date.now()})).status).toBe(200)
    const readiness=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(readiness).toMatchObject({allowed:true,measurementId:record.id,quality:'unverified',destination:'remote'})
    role='viewer'
    expect((await post('/api/projects/measure/deployments')).status).toBe(403)
    role='owner'
    expect((await post('/api/projects/measure/deployments',{artifact:{path:'../private',sha256:'fake'}})).status).toBe(400)
    expect((await post('/api/projects/measure/deployments',{measurementId:crypto.randomUUID()})).status).toBe(409)
    const start=await post('/api/projects/measure/deployments',{measurementId:record.id,requirementsRevision:f.run.requirements.revision})
    expect(start.status).toBe(202)
    const queued=await start.json()
    expect((await post('/api/projects/measure/deployments')).status).toBe(409)
    let result:any
    for(let n=0;n<1000;n++){
      const history=await(await app.request('/api/projects/measure/deployments')).json()
      result=history.find((r:any)=>r.id===queued.id)
      if(['succeeded','failed'].includes(result?.status))break
      await Bun.sleep(10)
    }
    expect(result?.status).toBe(failPublication?'failed':'succeeded')
    expect(JSON.parse(result.buildLog)).toMatchObject({protocol:'bgs.workflow.v3',measurementId:record.id,quality:'unverified'})
    expect(calls).toBe(1);expect(builds).toBe(0);expect(native).toBe(0)
    if(failPublication)expect((await app.request('/deployments/'+queued.id+'/')).status).toBe(404)
    await writeFile(join(f.workspace,'src/index.html'),'Source edit after publication')
    expect((await(await app.request('/api/projects/measure/deployment-readiness')).json()).allowed).toBe(false)
    expect((await post('/api/projects/measure/deployments')).status).toBe(409)
    expect(calls).toBe(1)
    expect((await f.current()).deliveryEligible).toBe(false)
  }finally{for(const cleanup of cleanups.reverse())await cleanup();await f.close()}
},30000)

test('publication may confirm only settled plain chat after measurement, never changed source or explicit requirements',async()=>{
  const f=await fixture(),cleanups:Array<()=>void|Promise<void>>=[]
  const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),
    readRun:f.current,isBusy:()=>false})
  let published=0
  try {
    const record=await f.measurement.measure(request)
    await f.settle()
    const originalPreview=await preview.openAgent(await f.current(),record.id)
    const app=createAgentWorkflowApp({currentUserResolver:async()=>({id:'owner',role:'owner'}),workflowV3Store:f.store,
      dashboardDataRoot:join(f.root,'dashboard'),defaultWorkspacePath:f.root,modelConfigStore:false,skillsConfig:false,
      sessionRunner:{async start(){throw Error('No native execution')}},
      deploymentPublisher:{async publishStaticDirectory(){published++;return {url:'https://offline.invalid/deployment/'}},
        async verifyPublished(){}},registerCleanup:fn=>cleanups.push(fn)})
    const post=(body:unknown)=>app.request('/api/projects/measure/deployments',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    await app.request('/api/projects',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({id:'measure',name:'Synthetic discussion confirmation',root_path:f.workspace,created_at:Date.now()})})
    const appendMessage=async(intent:'message'|'change',key:string,text:string)=>{
      const old=await f.current(),next=structuredClone(old),before=old.requirements
      const afterText=before.text+'\n'+text
      const after={...before,revision:crypto.randomUUID(),text:afterText,
        sha256:digest(JSON.stringify({text:afterText,constraints:before.constraints,ids:before.ids}))}
      const now=new Date().toISOString()
      next.version++;next.fence++;next.planRevision++;next.requirements=after
      next.requirementChanges=[...(next.requirementChanges??[]),{requestKey:key,actorId:'owner',at:now,before,after}]
      next.agentTurns!.push({attemptId:crypto.randomUUID(),requestKey:key,sessionId:'chat',workerId:'worker',fence:next.fence,
        status:'ended',startedAt:now,finishedAt:now,quiescedAt:now,requirementsRevision:after.revision,
        message:{requestKey:key,runId:next.id,chatSessionId:'chat',expectedVersion:old.version,
          requirementsRevision:before.revision,intent,text}})
      await f.store.commit(next.projectId,next.ownerId,old.version,next,'agent.turn-claimed')
      return next
    }
    const discussed=await appendMessage('message','question-1','What was tested?')
    const pending=await inspectAgentMeasurementInputs(discussed,record)
    expect(pending).toMatchObject({current:false,code:'discussion-confirmation-required',
      changes:{requirements:true,sources:[],reports:[],artifact:false}})
    expect(pending.reason).toContain('Confirm that it did not change the game')
    expect(pending.reason).toContain('a question alone does not require a rebuild')
    try {
      const status=await preview.status('measure','owner')
      expect(status.preview?.url).toBe(originalPreview.url)
      expect(status.preview?.limitations.join(' ')).toContain('Later chat requirements remain unconfirmed')
      const opened=await preview.openAgent(discussed,record.id)
      expect(opened.url).toBe(originalPreview.url)
      expect(opened.limitations.join(' ')).toContain('Later chat requirements remain unconfirmed')
      expect((await preview.handle(new Request(opened.url)))!.status).toBe(200)
      await expect(selectAgentMeasuredBuild(discussed,record.id)).rejects.toThrow('Confirm that it did not change the game')
      expect((await f.current()).agentTurns!.flatMap(t=>t.measurements??[])).toHaveLength(1)
    }finally{preview.dispose()}
    expect(await agentTurnHandoffReason(discussed,discussed.agentTurns!.at(-1)!)).toContain('discussion-confirmation-required')
    expect((await inspectAgentMeasurementInputs(discussed,record,['question-1'])).current).toBe(true)
    const attached=structuredClone(discussed)
    attached.agentTurns!.at(-1)!.message!.attachmentDigests=[{filename:'requirements.txt',mediaType:'text/plain',sha256:'hash'}]
    expect(discussionMessagesSinceMeasurement(attached,record)).toBeNull()
    const unfinished=structuredClone(discussed)
    unfinished.agentTurns!.at(-1)!.status='failed'
    expect(discussionMessagesSinceMeasurement(unfinished,record)).toBeNull()
    const readiness=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(readiness).toMatchObject({allowed:false,confirmationRequired:{measurementId:record.id,
      requirementsRevision:discussed.requirements.revision,messages:[{requestKey:'question-1',text:'What was tested?'}]}})
    expect((await post({measurementId:record.id,requirementsRevision:discussed.requirements.revision})).status).toBe(409)
    expect((await post({measurementId:record.id,requirementsRevision:discussed.requirements.revision,
      discussionConfirmation:{messageRequestKeys:['wrong-message']}})).status).toBe(409)
    expect(published).toBe(0)
    const confirmation={measurementId:record.id,requirementsRevision:discussed.requirements.revision,
      discussionConfirmation:{messageRequestKeys:['question-1']}}
    const started=await post(confirmation)
    expect(started.status).toBe(202)
    const deploymentId=(await started.json()).id
    let saved:any
    for(let i=0;i<100;i++) {
      saved=(await(await app.request('/api/projects/measure/deployments')).json()).find((item:any)=>item.id===deploymentId)
      if(saved?.status==='succeeded')break
      await Bun.sleep(10)
    }
    expect(saved?.status).toBe('succeeded')
    expect(JSON.parse(saved.buildLog)).toMatchObject({discussionConfirmation:{
      requirementsRevision:discussed.requirements.revision,messageRequestKeys:['question-1']}})
    expect(published).toBe(1)
    await writeFile(join(f.workspace,'src/index.html'),'Changed after confirmation')
    const drift=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(drift.allowed).toBe(false)
    expect(drift.confirmationRequired).toBeUndefined()
    expect((await inspectAgentMeasurementInputs(discussed,record)).code).toBe('measurement-stale')
    expect((await post(confirmation)).status).toBe(409)
    await writeFile(join(f.workspace,'src/index.html'),'<html><body><h1>Actual fixture</h1><button>Play</button></body></html>')
    const changed=await appendMessage('change','change-1','Change the goal')
    expect((await inspectAgentMeasurementInputs(changed,record)).code).toBe('measurement-stale')
    const blocked=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(blocked.allowed).toBe(false)
    expect(blocked.confirmationRequired).toBeUndefined()
    expect((await post({...confirmation,requirementsRevision:changed.requirements.revision})).status).toBe(409)
    expect(published).toBe(1)
  }finally{for(const cleanup of cleanups.reverse())await cleanup();await f.close()}
},30000)

test('execution identity observes saved sources and builds without running or claiming acceptance',async()=>{
  const f=await fixture()
  try {
    const first=await f.measurement.executionInputs()
    await mkdir(join(f.workspace,'dist'));await writeFile(join(f.workspace,'dist/index.html'),'Built bytes')
    const second=await f.measurement.executionInputs()
    expect(first.files.some(x=>x.path==='src/index.html')).toBe(true)
    expect(second.files.some(x=>x.path==='dist/index.html')).toBe(true)
    expect(second.files).not.toEqual(first.files)
    expect((await f.current()).agentTurns![0]!.measurements).toBeUndefined()
    await f.measurement.close()
    await expect(f.measurement.executionInputs()).rejects.toThrow('closed')
  } finally {await f.close()}
})

test('Node test receipts retain before/after identities and inspect later drift without executing again',async()=>{
  const f=await fixture()
  const preview=openPreviewTestAccess({start:async()=>({status:'idle'}),status:()=>({status:'idle'}),stop(){},
    browser:{start:async()=>{throw Error('No browser requested')},status:()=>({status:'idle'}),close:async()=>{}} as any})
  const tools=await openAgentTools({workspacePath:f.workspace,sessionId:'identity-test',getAuthToken:()=>undefined,
    measurement:f.measurement,openPreview:()=>preview})
  const run=async(...args:string[])=>{
    const child=Bun.spawn([Bun.which('node')!,join(f.workspace,tools.directory,'preview.mjs'),...args],{cwd:f.workspace,
      env:{PATH:process.env.PATH,BEEGAME_CONTENT_CHECKER_MODULE:(await sharedContentChecker()).moduleUrl,
        BEEGAME_PREVIEW_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'identity-test'),
        BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'identity-test','measurement')},
      stdout:'pipe',stderr:'pipe'})
    const result=JSON.parse(await new Response(child.stdout).text())
    expect(await child.exited).toBe(0)
    return result
  }
  try {
    await writeFile(join(f.workspace,'test.mjs'),"console.log('one execution')")
    const executed=await run('--run','test.mjs')
    expect(executed).toMatchObject({inputIdentity:'unchanged-at-boundaries',quality:'unverified'})
    expect((await run('--inspect',executed.reportPath)).freshness.status).toBe('unchanged-at-boundaries')
    await writeFile(join(f.workspace,'src/index.html'),'Changed source')
    expect((await run('--inspect',executed.reportPath)).freshness).toMatchObject({status:'changed',changedPaths:['src/index.html']})
    expect(await readFile(join(f.workspace,executed.stdoutPath),'utf8')).toBe('one execution\n')
    const retained=JSON.parse(await readFile(join(f.workspace,executed.reportPath),'utf8'))
    expect(retained.before.inputs.files).toEqual(retained.after.inputs.files)
    expect(measurementRequest.parse({...request,reportPaths:[executed.reportPath]}).reportPaths).toEqual([executed.reportPath])
    for (const path of ['.beegame/settings.json','.beegame/tmp/preview-test-a/../secret','../secret'])
      expect(measurementRequest.safeParse({...request,reportPaths:[path]}).success).toBe(false)
    expect((await f.current()).agentTurns![0]!.measurements).toBeUndefined()
    await writeFile(join(f.workspace,'test.mjs'),"import{writeFile}from'node:fs/promises';await writeFile('src/index.html','Changed during test')")
    expect((await run('--run','test.mjs')).inputIdentity).toBe('changed')
    await tools.close()
    expect((await run('--inspect',executed.reportPath)).freshness.status).toBe('unverified')
  } finally {await tools.close();await f.close()}
})

test('source, report and artifact identity changes stay distinct without accepting a changed export or rerunning checks',async()=>{
  const f=await fixture()
  try {
    await mkdir(join(f.workspace,'docs'));await writeFile(join(f.workspace,'docs/notes.md'),'Original design')
    const record=await f.measurement.measure(request),run=await f.settle(),version=run.version
    await writeFile(join(f.workspace,'docs/notes.md'),'Revised design')
    const source=await inspectAgentMeasurementInputs(run,record)
    expect(source).toMatchObject({current:false,changes:{sources:['docs/notes.md'],artifact:false,checkInputs:[]},
      evidence:{artifactMatches:true,exportableSourcesMatch:false,checks:[
        {id:'build',savedStatus:'passed',inputsMatch:true},{id:'runtime-smoke',savedStatus:'passed',inputsMatch:true}]}})
    expect(source.reason).toContain('Exportable sources changed: docs/notes.md')
    expect(source.reason).not.toContain('Saved check inputs or checker versions differ')
    await expect(selectAgentMeasuredBuild(run,record.id)).rejects.toThrow('Exportable sources changed')
    expect(measurementSummary(record).quality).toBe('unverified')
    await writeFile(join(f.workspace,'README.md'),'Revised report')
    expect(await inspectAgentMeasurementInputs(run,record)).toMatchObject({current:false,
      changes:{reports:['README.md'],artifact:false},evidence:{artifactMatches:true}})
    await writeFile(join(f.workspace,'dist/index.html'),'<html>Actual runtime edit</html>')
    const runtime=await inspectAgentMeasurementInputs(run,record)
    expect(runtime).toMatchObject({current:false,changes:{artifact:true,checkInputs:['build','runtime-smoke']},
      evidence:{artifactMatches:false}})
    expect(runtime.reason).toContain('Measured artifact bytes changed')
    expect((await f.current()).version).toBe(version)
    expect((await f.current()).agentTurns![0]!.measurements).toEqual([record])
    await expect(exportAgentMeasuredBuild(run,record.id,{read:f.current,busy:()=>false})).rejects.toThrow()
  } finally {await f.close()}
},30000)

test('measurement read API separates Preview inspection from delivery selection on a settled interrupted turn',async()=>{
  const f=await fixture(),sessions=new BeeGameSessionManager({async start(){throw Error('Read must not dispatch')}},join(f.root,'sessions'))
  let preview:ReturnType<typeof createMeasuredPreview>|undefined
  try {
    await mkdir(join(f.workspace,'docs'));await writeFile(join(f.workspace,'docs/notes.md'),'Original design')
    const record=await f.measurement.measure(request),saved=await f.settle()
    let view=structuredClone(saved),owned=true
    const store={...f.store,read:async()=>structuredClone(view)}
    preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),readRun:store.read,isBusy:()=>false})
    const app=new Hono(),path='/api/projects/measure/workflow-v3'
    registerV3Routes(app,{store,sessions,preview,getUser:()=>({id:'owner',role:'owner'}),
      getProject:async()=>owned?({id:'measure',root_path:f.workspace} as any):undefined,getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,
      assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json()})
    const inspect=async()=>{
      const r=await app.request(path+'/agent/measurements/'+record.id)
      expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store')
      const body=await r.json();expect(body.quality).toBe('unverified');return body
    }
    const refused=async()=>{
      for(const endpoint of ['preview','export']) {
        const r=await app.request(path+'/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({measurementId:record.id,requirementsRevision:view.requirements.revision,...(endpoint==='export'?{kind:'project'}:{})})})
        expect(r.status).toBe(409)
      }
      const ordinary=await app.request('/api/projects/measure/preview',{method:'POST',
        headers:{'content-type':'application/json'},body:'{}'})
      expect(ordinary.status).toBe(view.writer?409:200)
    }
    expect(await inspect()).toMatchObject({freshness:{current:true,inputsCurrent:true,evidence:{artifactMatches:true}},selection:{eligible:true}})
    const ordinary=await app.request('/api/projects/measure/preview',{method:'POST',
      headers:{'content-type':'application/json'},body:'{}'})
    expect(ordinary.status).toBe(200)
    expect(await ordinary.json()).toMatchObject({status:'running',mode:'production'})
    expect((await (await app.request('/api/projects/measure/preview')).json()).status).toBe('running')
    expect((await (await app.request('/api/projects/measure/deployment-readiness')).json())).toMatchObject({
      code:'deployment-unavailable'})
    expect((await app.request('/api/projects/measure/deployments',{method:'POST',body:'{}'})).status).toBe(503)
    expect((await (await app.request('/api/projects/measure/preview',{method:'DELETE'})).json()).status).toBe('stopped')
    // Retained capture evidence/host drivers are not exportable sources.
    await mkdir(join(f.workspace,'.beegame/tmp'),{recursive:true})
    await writeFile(join(f.workspace,'.beegame/tmp/capture-observation.json'),'{}')
    expect((await inspect()).freshness.inputsCurrent).toBe(true)
    // A settled interrupted turn may be inspected without becoming exportable.
    view.agentTurns![0]!.status='interrupted'
    expect(await inspect()).toMatchObject({freshness:{current:false,inputsCurrent:true,code:'preview-unverified',evidence:{artifactMatches:true}},
      selection:{eligible:false},previewSelection:{eligible:true}})
    const inspectedPreview=await app.request('/api/projects/measure/preview',{method:'POST',
      headers:{'content-type':'application/json'},body:'{}'})
    expect(inspectedPreview.status).toBe(200)
    expect(await inspectedPreview.json()).toMatchObject({status:'running',mode:'production'})
    expect((await app.request(path+'/export',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({measurementId:record.id,requirementsRevision:view.requirements.revision,kind:'project'})})).status).toBe(409)
    expect((await (await app.request('/api/projects/measure/preview',{method:'DELETE'})).json()).status).toBe('stopped')
    view.writer={attemptId:f.turn.attemptId,workerId:f.turn.workerId,fence:f.turn.fence}
    expect(await inspect()).toMatchObject({freshness:{current:false,inputsCurrent:true,code:'workspace-busy',changes:{artifact:false}},selection:{eligible:false}})
    await refused()
    view=structuredClone(saved)
    await mkdir(join(f.workspace,'tests'))
    await writeFile(join(f.workspace,'tests/capture.mjs'),'// Added after measurement')
    const stalePreview=await app.request('/api/projects/measure/preview',{method:'POST',
      headers:{'content-type':'application/json'},body:'{}'})
    expect(stalePreview.status).toBe(200)
    expect(await stalePreview.json()).toMatchObject({status:'running',mode:'production'})
    await rm(join(f.workspace,'tests'),{recursive:true})
    await writeFile(join(f.workspace,'docs/notes.md'),'Revised design')
    expect(await inspect()).toMatchObject({freshness:{current:false,inputsCurrent:false,
      changes:{sources:['docs/notes.md'],artifact:false,checkInputs:[]},
      evidence:{artifactMatches:true,checks:[{id:'build',inputsMatch:true},{id:'runtime-smoke',inputsMatch:true}]}},selection:{eligible:false}})
    await refused()
    await writeFile(join(f.workspace,'README.md'),'Revised report')
    expect(await inspect()).toMatchObject({freshness:{changes:{reports:['README.md'],artifact:false},evidence:{artifactMatches:true}}})
    await writeFile(join(f.workspace,'dist/index.html'),'<html>Changed runtime</html>')
    expect(await inspect()).toMatchObject({freshness:{changes:{artifact:true,checkInputs:['build','runtime-smoke']},evidence:{artifactMatches:false}}})
    await refused()
    // Unreadable/aliased source inputs remain historical diagnostics, not PASS.
    await symlink(join(f.workspace,'docs/notes.md'),join(f.workspace,'alias.md'))
    expect(await inspect()).toMatchObject({freshness:{current:false,inputsCurrent:false,code:'measurement-inspection-failed'},selection:{eligible:false}})
    await refused()
    owned=false;expect((await app.request(path+'/agent/measurements/'+record.id)).status).toBe(404)
    expect(await f.current()).toEqual(saved) // reads never persist/rebuild or dispatch
  }finally{preview?.dispose();await sessions.dispose();await f.close()}
},30000)

test('inspection separates the active user task and live Skill facts from a historical measured turn without rerunning it',async()=>{
  const f=await fixture()
  let active:ReturnType<typeof createAgentMeasurement>|undefined
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined
  try {
    const record=await f.measurement.measure(request),exiting=await f.current()
    const exitingTurn=exiting.agentTurns![0]!
    exitingTurn.quiescedAt='exited';exitingTurn.nativeSessionId='same-lineage'
    exitingTurn.skillUses=[{name:'old-general-method',toolUseID:'old-skill',eventId:1,status:'loaded'}]
    exiting.version++;await f.store.commit(exiting.projectId,exiting.ownerId,exiting.version-1,exiting,'fixture.quiesced')
    const settled=await f.current()
    settled.agentTurns![0]!.status='failed';settled.agentTurns![0]!.error='Retained native failure';settled.agentTurns![0]!.finishedAt='finished'
    delete settled.writer;settled.version++
    await f.store.commit(settled.projectId,settled.ownerId,settled.version-1,settled,'fixture.failed')
    const next=await f.current(),original=next.agentTurns![0]!
    const message={requestKey:'full-acceptance',runId:next.id,chatSessionId:next.chatSessionId,expectedVersion:next.version,
      requirementsRevision:next.requirements.revision,intent:'work' as const,
      text:'Inspect all eight domains, professional methods and the complete player journey; preserve unrelated sources.'}
    const turn:AgentTurn={...f.turn,attemptId:'active-turn',requestKey:message.requestKey,fence:2,message,skillUses:[]}
    delete turn.measurements
    next.agentTurns!.push(turn);next.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:2};next.fence=2;next.version++
    await f.store.commit(next.projectId,next.ownerId,next.version-1,next,'fixture.new-task')
    let liveUses:SkillUse[]=[]
    active=createAgentMeasurement({run:next,turn,store:f.store,skillUses:()=>liveUses})
    const before=await f.current(),context=await active.context(),handoff=await active.handoff()
    const {text:_text,...taskIdentity}=handoff.task
    expect(context.task).toEqual(taskIdentity)
    expect(context.task).toMatchObject({scope:'active-user-turn',attemptId:turn.attemptId})
    expect(JSON.stringify(context)).not.toContain(message.text)
    const inspected=await active.inspect(record.id)
    expect(inspected.task).toEqual(handoff.task)
    expect((await active.inspect(record.id,true)).task).toEqual(handoff.task)
    expect(inspected.attemptId).toBe(original.attemptId)
    expect(inspected.measurementTask).toMatchObject({attemptId:original.attemptId,status:'failed',requestKey:original.requestKey})
    expect(inspected.skills).toMatchObject({currentTurnUses:[],currentTurnEvidence:'live-native-tool-events',
      recordedMainLoads:[{name:'old-general-method'}],application:'unverified'})
    liveUses=[{name:'domain-method',toolUseID:'child-skill',eventId:2,parentToolUseID:'delegated',status:'unverified'}]
    expect((await active.inspect(record.id)).skills.currentTurnUses[0]?.status).toBe('unverified')
    liveUses=[{...liveUses[0]!,eventId:3,status:'loaded'}]
    tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:active})
    const command=Bun.spawn([process.execPath,join(f.workspace,tools.directory,'measure.mjs'),'--inspect',record.id],{cwd:f.workspace,
      env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
    const result=JSON.parse(await new Response(command.stdout).text())
    expect(await command.exited).toBe(0)
    expect(result.task.text).toBe(message.text)
    expect(result.skills.currentTurnUses).toEqual(liveUses)
    expect(result.skills.application).toBe('unverified')
    expect(result.checkScope.unmeasuredConsumptionChecks).toHaveLength(5)
    expect(result.quality).toBe('unverified');expect(result.deliveryEligible).toBe(false)
    expect(result.freshness.current).toBe(true)
    expect(await f.current()).toEqual(before)
    // History remains useful after the ephemeral native bridge is revoked.
    const activeExit=structuredClone(before);activeExit.agentTurns!.at(-1)!.quiescedAt='active-exit'
    activeExit.agentTurns!.at(-1)!.skillUses=structuredClone(liveUses);activeExit.version++
    await f.store.commit(activeExit.projectId,activeExit.ownerId,activeExit.version-1,activeExit,'fixture.active-quiesced')
    const ended=await f.current();ended.agentTurns!.at(-1)!.status='ended';ended.agentTurns!.at(-1)!.finishedAt='active-finished'
    delete ended.writer;ended.version++
    await f.store.commit(ended.projectId,ended.ownerId,ended.version-1,ended,'fixture.active-ended')
    const sessions=new BeeGameSessionManager({async start(){throw Error('History must not execute')}},join(f.root,'sessions'))
    try {
      const app=new Hono();registerV3Routes(app,{store:f.store,sessions,getUser:()=>({id:'owner',role:'owner'}),
        getProject:async()=>({id:'measure',root_path:f.workspace} as any),getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,
        assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json()})
      const response=await app.request('/api/projects/measure/workflow-v3/agent/measurements/'+record.id)
      expect(response.status).toBe(200)
      const historical=await response.json()
      expect(historical.task).toEqual(result.task)
      expect(historical.measurementTask).toEqual(result.measurementTask)
      expect(historical.skills).toMatchObject({currentTurnUses:liveUses,currentTurnEvidence:'saved-native-tool-events',application:'unverified'})
      expect(historical.quality).toBe('unverified');expect(historical.deliveryEligible).toBe(false)
      expect(await f.current()).toEqual(ended)
    }finally{await sessions.dispose()}
    await active.close();await expect(active.inspect(record.id)).rejects.toThrow('expired')
  }finally{await tools?.close();await active?.close();await f.close()}
},30000)

test('native failed-command formatting retains front-loaded UI identities and causes; full geometry stays on demand',()=>{
  const observation=JSON.stringify({driver:'synthetic host observation',probes:[{document:'content/ui/menu.json',nodeId:'hidden',viewport:[1024,576],
    status:'unverified',reason:'Target UI ancestor is hidden',changed:[{geometry:'X'.repeat(15000)}]},
    {document:'content/ui/menu.json',nodeId:'clipped',viewport:[1024,576],status:'unverified',reason:'Complete visible text fit could not be established',
      textFit:{before:{status:'unverified',clippedCount:1,overflowCount:0},changed:[],restored:{status:'unverified',clippedCount:1}}}],errors:[],missingFiles:[],unsupported:[]})
  const record:any={id:'saved',requestKey:'bad',requirementsRevision:'r',runtimeArtifact:'dist',reportPaths:[],reports:[],
    checks:[{id:'ui-data-consumption',status:'unverified',observation}],consumption:{checks:['ui-data-consumption']}}
  const before=JSON.stringify(record),compact=measurementSummary(record,false),details=measurementSummary(record,true)
  expect(Object.keys(compact)[0]).toBe('id')
  expect(compact.checkStatuses).toEqual([{id:'ui-data-consumption',status:'unverified'}])
  expect(compact.diagnostics?.map(p=>p.nodeId)).toEqual(['hidden','clipped'])
  expect(compact.diagnostics?.[1]?.textFit.before.clippedCount).toBe(1)
  expect('observation' in compact.checks[0]! ? compact.checks[0].observation : undefined).not.toContain('X'.repeat(100))
  expect('observation' in details.checks[0]! ? details.checks[0].observation : undefined).toBe(observation)
  const output=formatError(Object.assign(new Error('Exit code 1'),{stdout:JSON.stringify({...details,
    task:{scope:'active-user-turn',text:'CURRENT_FULL_ACCEPTANCE_REQUEST'},
    skills:{currentTurnUses:[],currentTurnEvidence:'live-native-tool-events',application:'unverified'}},null,2)}))
  expect(output).toContain('characters truncated')
  expect(output).toContain('Target UI ancestor is hidden');expect(output).toContain('clippedCount')
  expect(output.indexOf('Target UI ancestor is hidden')).toBeLessThan(output.indexOf('characters truncated'))
  expect(output).toContain('CURRENT_FULL_ACCEPTANCE_REQUEST')
  expect(output).toContain('currentTurnUses')
  expect(JSON.stringify(record)).toBe(before)
  const error:any={...record,checks:[{id:'ui-data-consumption',status:'unverified',observation:'UI probe file#node [source]: source unavailable'}]}
  const plain=measurementSummary(error,false).checks[0]!
  expect('observation' in plain ? plain.observation : undefined).toBe(error.checks[0].observation)
})

test('compact composition diagnostics retain failing node identities without repeating full geometry', () => {
  const composition = { before: { status: 'failed', checked: ['control', 'badge-letter'],
    issues: [{ id: 'badge-letter', kind: 'geometry', expected: { left: 10 }, actual: { left: 110 } }],
    unverified: [{ id: 'dynamic-label', reason: 'State-dependent visibility' }] } }
  const observation = JSON.stringify({ probes: [{ document: 'content/ui/result.json', nodeId: 'control', viewport: [960, 540],
    status: 'failed', reason: 'Rendered composition differs', composition }] })
  const record: any = { id: 'saved', requestKey: 'composition', requirementsRevision: 'r', runtimeArtifact: 'dist', reports: [], reportPaths: [],
    checks: [{ id: 'ui-data-consumption', status: 'failed', observation }] }
  const before = JSON.stringify(record), compact = measurementSummary(record, false)
  expect(compact.diagnostics![0].composition.before).toEqual({ status: 'failed', checkedCount: 2,
    issues: [{ id: 'badge-letter', kind: 'geometry' }], unverified: composition.before.unverified })
  expect(JSON.stringify(record)).toBe(before)
  const detailed = measurementSummary(record, true).checks[0]!
  expect('observation' in detailed ? detailed.observation : undefined).toBe(observation)
})

test('compact inspection retains every batch identity and failure while omitting passed text-fit detail',()=>{
  const probes=Array.from({length:12},(_,i)=>({document:'content/ui/menu.json',nodeId:'node-'+i,viewport:[1280,720],
    status:i===7?'failed':'passed',reason:i===7?'Visible text exceeds node bounds':undefined,
    conditions:{environment:{devicePixelRatio:2}},textFit:{before:{status:i===7?'failed':'passed',overflowCount:i===7?1:0}},
    controlSize:{unit:'CSS pixels',minimum:[44,44],before:[100,28],restored:[100,28]},
    enabled:{beforeVisible:true,disabledVisible:false,restoredVisible:true},
    changed:[{geometry:'x'.repeat(3000)}]}))
  const record:any={id:'batch',requestKey:'request',requirementsRevision:'r',runtimeArtifact:'dist',reports:[],
    checks:[{id:'ui-data-consumption',status:'failed',observation:JSON.stringify({probes})}]}
  const compact=measurementSummary(record,false)
  expect(compact.diagnostics).toHaveLength(12)
  expect(compact.diagnostics![7].controlSize).toEqual(probes[7]!.controlSize)
  expect(compact.diagnostics![0].enabled).toEqual(probes[0]!.enabled)
  expect(compact.diagnostics![0].textFit).toBeUndefined()
  expect(compact.diagnostics![7]).toMatchObject({nodeId:'node-7',reason:'Visible text exceeds node bounds',
    textFit:{before:{overflowCount:1}},conditions:{environment:{devicePixelRatio:2}}})
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(measurementSummary(record,true)).length/2)
  const full=measurementSummary(record,true).checks[0]!
  expect('observation' in full).toBe(true)
  if('observation' in full)expect(JSON.parse(full.observation).probes).toEqual(probes)
})

test('task context exposes current comparison before optional tool parsing; does not build or accept report semantics',async()=>{
  const f=await fixture()
  try {
    expect((await f.measurement.context()).measurement).toBeNull()
    const record=await f.measurement.measure(request),before=await f.current()
    const context=await f.measurement.context()
    expect(context.measurement).toMatchObject({id:record.id,requestKey:record.requestKey,freshness:{current:true,changes:{requirements:false,sources:[],reports:[]}}})
    expect(context).toMatchObject({quality:'unverified',reportSemantics:'not-verified',deliveryEligible:false})
    expect(context.project).toMatchObject({testFiles:[],codeFiles:['src/index.html'],commands:{build:'bun build.mjs'}})
    expect(context.skills).toEqual({recordedMainLoads:[],contextPresence:'unverified',application:'unverified',currentTurnUses:[],currentTurnEvidence:'not-recorded-yet'})
    expect(context.checkScope.runtimeSmoke).toBe('initial static-browser load only')
    const handoff=await f.measurement.handoff()
    expect(handoff.checkScope.consumptionOption).toBe('--consumption-json')
    expect(handoff.checkScope.availableConsumptionChecks).toContain('ui-data-consumption')
    expect(handoff.checkScope.consumptionSupport.pixel).toContain('not DOM/CSS images, procedural Canvas')
    expect(handoff.checkScope.consumptionSupport.audio).toContain('not WebAudio')
    expect(handoff.checkScope.unmeasuredConsumptionChecks).toEqual([...handoff.checkScope.availableConsumptionChecks])
    expect(JSON.stringify(context)).not.toContain('LONG_BUILD_LOG')
    expect(await f.current()).toEqual(before)
    await writeFile(join(f.workspace,'src/index.html'),'<h1>Changed runtime</h1>')
    const changed=await f.measurement.context()
    expect(changed.measurement?.freshness).toMatchObject({current:false,changes:{sources:['src/index.html']}})
    expect(await readFile(join(f.workspace,'dist/index.html'),'utf8')).not.toContain('Changed runtime')
    await symlink(join(f.workspace,'README.md'),join(f.workspace,'src','linked.html'))
    const unsafe=await f.measurement.context()
    expect(unsafe.measurement?.freshness).toMatchObject({current:false,code:'measurement-inspection-failed'})
    expect(unsafe.deliveryEligible).toBe(false)
    expect(await f.current()).toEqual(before)
    await f.measurement.close()
    await expect(f.measurement.context()).rejects.toThrow('expired')
  }finally{await f.close()}
},30000)

for(const fault of ['source-alias','unreadable-directory'] as const)test('saved measurement remains inspectable without certifying '+fault,async()=>{
  const f=await fixture()
  const tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
  try {
    const measured=await f.measurement.measure(request),before=await f.current()
    expect(measured.checks.every(c=>c.status==='passed')).toBe(true)
    if(fault==='source-alias'){
      await writeFile(join(f.root,'outside.txt'),'UNRELATED_PRIVATE_SOURCE')
      await symlink(join(f.root,'outside.txt'),join(f.workspace,'src','linked.html'))
    }
    else await chmod(join(f.workspace,'src'),0)
    const inspected=await f.measurement.inspect(measured.id,true)
    expect(inspected.freshness).toMatchObject({current:false,code:'measurement-inspection-failed'})
    expect(inspected.freshness.reason).toContain(fault==='source-alias'?'aliases':'EACCES')
    expect(inspected.checks.map(c=>c.status)).toEqual(['passed','passed'])
    expect(inspected.deliveryEligible).toBe(false)
    expect(JSON.stringify(inspected)).not.toContain('UNRELATED_PRIVATE_SOURCE')
    const handoff=await f.measurement.handoff()
    expect(handoff.measurement?.id).toBe(measured.id)
    expect(handoff.measurement?.freshness.current).toBe(false)
    expect(handoff.blockedReason).toContain('measurement-inspection-failed')
    expect(JSON.stringify(handoff)).not.toContain('UNRELATED_PRIVATE_SOURCE')
    const command=Bun.spawn([process.execPath,join(f.workspace,tools.directory,'measure.mjs'),'--inspect',measured.id],{cwd:f.workspace,
      env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
    const feedback=JSON.parse(await new Response(command.stdout).text())
    expect(await command.exited).toBe(1)
    expect(feedback.id).toBe(measured.id)
    expect(feedback.freshness).toMatchObject({current:false,code:'measurement-inspection-failed'})
    expect(await f.current()).toEqual(before)
    const settled=await f.settle()
    await expect(exportAgentMeasuredBuild(settled,measured.id,{read:f.current,busy:()=>false},'project')).rejects.toThrow()
  }finally{await chmod(join(f.workspace,'src'),0o755);await tools.close();await f.close()}
},30000)

test('owned HTTP history survives unreadable current inputs; export and other ownership remain refused',async()=>{
  const f=await fixture(),sessions=new BeeGameSessionManager({async start(){throw Error('No model dispatch')}},join(f.root,'sessions'))
  let owned=true
  const app=new Hono()
  registerV3Routes(app,{store:f.store,sessions,getUser:()=>({id:'owner',role:'viewer'}),
    getProject:async()=>owned?({id:'measure',root_path:f.workspace} as any):undefined,getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,
    assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json()})
  try{
    const measured=await f.measurement.measure(request),run=await f.settle(),before=await f.current()
    await chmod(join(f.workspace,'src'),0)
    const prefix='/api/projects/measure/workflow-v3'
    const response=await app.request(prefix+'/agent/measurements/'+measured.id)
    expect(response.status).toBe(200)
    const body=await response.json()
    expect(body.id).toBe(measured.id);expect(body.checks.map((c:any)=>c.status)).toEqual(['passed','passed'])
    expect(body.freshness).toMatchObject({current:false,code:'measurement-inspection-failed'})
    expect(body.freshness.reason).toContain('EACCES')
    expect(body.deliveryEligible).toBe(false);expect(body.quality).toBe('unverified')
    const exported=await app.request(prefix+'/export',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({measurementId:measured.id,requirementsRevision:run.requirements.revision,kind:'project'})})
    expect(exported.status).toBe(409)
    expect((await exported.json()).code).toBe('measurement-inspection-failed')
    owned=false;expect((await app.request(prefix+'/agent/measurements/'+measured.id)).status).toBe(404)
    expect(await f.current()).toEqual(before)
  }finally{await chmod(join(f.workspace,'src'),0o755);await sessions.dispose();await f.close()}
},30000)

test('project navigation remains a measured source; guide edits do not silently reuse an old build receipt',async()=>{
  const f=await fixture()
  try {
    const file=join(f.workspace,'CLAUDE.md')
    await writeFile(file,'# Project navigation\nEntry: src/index.html\n')
    const measured=await f.measurement.measure(request),before=await f.current()
    expect(measured.checks.find(c=>c.id==='build')!.projectBuild!.files.some(p=>p.path==='CLAUDE.md')).toBe(true)
    expect((await f.measurement.context()).measurement?.freshness?.current).toBe(true)
    await writeFile(file,'# Project navigation\nEntry: src/index.html\nRun: actual existing command\n')
    expect((await f.measurement.context()).measurement?.freshness).toMatchObject({current:false,
      changes:{requirements:false,sources:['CLAUDE.md']}})
    expect(await f.current()).toEqual(before)
    expect(await readFile(join(f.workspace,'dist/index.html'),'utf8')).toContain('Actual fixture')
  }finally{await f.close()}
},30000)

test('generated guide refreshes before build input capture and does not stale the resulting receipt at turn end',async()=>{
  const f=await fixture()
  try {
    await initializeProjectGuide(f.workspace)
    await mkdir(join(f.workspace,'docs'))
    await writeFile(join(f.workspace,'docs/new-design.md'),'New saved design')
    const measured=await f.measurement.measure(request)
    expect(measured.checks.find(c=>c.id==='build')!.status).toBe('passed')
    expect(await readFile(join(f.workspace,'CLAUDE.md'),'utf8')).toContain('docs/new-design.md')
    expect(await refreshProjectGuide(f.workspace)).toBe(false)
    expect((await f.measurement.context()).measurement?.freshness?.current).toBe(true)
  }finally{await f.close()}
},30000)

test('one handoff diagnoses simultaneous requirement, report and source drift without mtime guessing',async()=>{
  const f=await fixture()
  try {
    await mkdir(join(f.workspace,'reports'))
    await writeFile(join(f.workspace,'reports/result.txt'),'Saved evidence')
    const measured=await f.measurement.measure({...request,reportPaths:['reports/result.txt']})
    expect(measured.checks.every(c=>c.status==='passed')).toBe(true)
    await writeFile(join(f.workspace,'src/index.html'),'<h1>Changed source</h1>')
    await writeFile(join(f.workspace,'reports/result.txt'),'Changed evidence')
    const run=await f.current();run.requirements.revision='new-requirement'
    run.blockedReason='Old turn measurement-stale'
    // Read-only snapshot of a later authorized requirement. Do not overwrite
    // requirements through a fake store commit or weaken its append-only guard.
    const reader=createAgentMeasurement({run,turn:f.turn,store:{...f.store,async read(){return run}}})
    const before=await f.current(),result=await reader.handoff(['src/index.html'])
    expect(result.measurement?.freshness).toMatchObject({current:false,changes:{requirements:true,
      sources:['src/index.html'],reports:['reports/result.txt'],dependencies:false}})
    expect(result.blockedReason).toContain('src/index.html')
    expect(result.blockedReason).toContain('reports/result.txt')
    expect(result.blockedReason).not.toContain('Old turn')
    expect(result.measurement?.measuredSourceFiles).toBe(4)
    expect(await f.current()).toEqual(before)
    expect(await readFile(join(f.workspace,'dist/index.html'),'utf8')).not.toContain('Changed')
    await reader.close()
  }finally{await f.close()}
},30000)

test('current handoff never reports a previous blocked reason as the cause of a valid measurement',async()=>{
  const f=await fixture()
  try {
    await f.measurement.measure(request)
    const run=await f.current();run.blockedReason='Old turn measurement-stale';run.version++
    await f.store.commit(run.projectId,run.ownerId,run.version-1,run,'fixture.old-reason')
    const before=await f.current(),compact=await f.measurement.handoff(['README.md'])
    expect(compact.measurement?.freshness).toMatchObject({current:true,changes:{requirements:false,
      sources:[],reports:[],dependencies:false,buildOrArtifact:false}})
    expect(compact.blockedReason).toContain('inputs are current')
    expect(compact.blockedReason).not.toContain('stale')
    expect(compact).not.toHaveProperty('priorBlockedReason')
    const details=await f.measurement.handoff(['README.md'],true)
    expect(details.priorBlockedReason).toBe('Old turn measurement-stale')
    expect(details.blockedReason).toBe(compact.blockedReason)
    expect(await f.current()).toEqual(before)
  }finally{await f.close()}
},30000)

test('handoff returns the exact latest user task and full current requirements, not an author summary or latest-change-only brief',async()=>{
  const f=await fixture(),live=structuredClone(await f.current())
  const text=JSON.stringify({original:'Deliver a game',changes:['Keep the earlier muted-by-default decision','Change only score colour']})
  live.requirements={...live.requirements,text,sha256:digest(JSON.stringify({text,constraints:live.requirements.constraints,ids:live.requirements.ids}))}
  live.agentTurns![0]!.message={requestKey:'current-change',runId:live.id,chatSessionId:live.chatSessionId,
    expectedVersion:live.version,requirementsRevision:live.requirements.revision,intent:'change',text:'Change only score colour'}
  const handoff=createAgentMeasurement({run:live,turn:live.agentTurns![0]!,store:{...f.store,async read(){return live}}})
  try {
    const before=structuredClone(live),result=await handoff.handoff(['README.md'],true)
    expect(result.task.text).toBe('Change only score colour')
    expect(result.requirements.text).toBe(text)
    expect(result.requirements.text).toContain('muted-by-default')
    expect(result.measurement).toBeNull();expect(result.quality).toBe('unverified')
    expect(result.checkScope.unmeasuredConsumptionChecks).toEqual([...result.checkScope.availableConsumptionChecks])
    expect(result.project.commands).toEqual({build:'bun build.mjs'})
    expect(result.skills.application).toBe('unverified')
    expect(live).toEqual(before)
  }finally{await handoff.close();await f.close()}
})

test('handoff is read-only and returns current source bytes and newest interrupted evidence, never an older PASS',async()=>{
  const previous:AgentTurn={attemptId:'prior',requestKey:'prior',sessionId:'chat',workerId:'worker',fence:0,
    status:'interrupted',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),measurements:[
      {id:'old-success',requestKey:'old',runtimeArtifact:'dist',requirementsRevision:'old',startedAt:'earlier',
        finishedAt:'earlier',reportPaths:['README.md'],reports:[],checks:[]},
      {id:'unfinished',requestKey:'unknown',runtimeArtifact:'dist',requirementsRevision:'old',startedAt:'later',
        reportPaths:['README.md'],reports:[],checks:[],error:'Writer interrupted'},
    ]}
  const f=await fixture(builder,[previous])
  const tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
  const command=async(cwd:string,...args:string[])=>{
    const child=Bun.spawn([process.execPath,join(f.workspace,tools.directory,'handoff.mjs'),...args],{cwd,
      env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
    return {stdout:await new Response(child.stdout).text(),stderr:await new Response(child.stderr).text(),code:await child.exited}
  }
  try {
    const before=await f.current(),original=await readFile(join(f.workspace,'README.md'),'utf8')
    expect((await command(f.workspace,'--help')).code).toBe(0)
    const compact=await command(f.workspace,'README.md')
    expect(compact.code).toBe(0)
    const saved=JSON.parse(compact.stdout)
    expect(saved.task.attemptId).toBe(f.turn.attemptId)
    expect(saved.requirements.sha256).toBe(before.requirements.sha256)
    expect(saved.requirements.text).toBeUndefined()
    expect(saved.sources.sources[0].text).toBeUndefined()
    expect(saved.measurement.id).toBe('unfinished')
    expect(saved.measurement.attemptId).toBe('prior')
    expect(saved.measurement.freshness.current).toBe(false)
    expect(saved.quality).toBe('unverified');expect(saved.deliveryEligible).toBe(false)
    const details=JSON.parse((await command(f.workspace,'README.md','--details')).stdout)
    expect(details.requirements.text).toBe(before.requirements.text)
    expect(details.sources.sources[0].text).toBe(original)
    await writeFile(join(f.workspace,'README.md'),'Changed current source')
    const changed=JSON.parse((await command(f.workspace,'README.md','--details')).stdout)
    expect(changed.sources.sources[0].text).toBe('Changed current source')
    expect(changed.sources.sources[0].sha256).not.toBe(saved.sources.sources[0].sha256)
    await symlink(join(f.root,'host'),join(f.workspace,'linked'))
    for(const path of ['missing.md','../outside.md','.beegame/private','linked/run.json']) {
      const result=await command(f.workspace,path)
      expect(result.code).toBe(1);expect(JSON.parse(result.stdout).sources.valid).toBe(false)
    }
    const noFiles=await command(f.workspace)
    expect(noFiles.code).toBe(0)
    expect(JSON.parse(noFiles.stdout)).toMatchObject({sources:{scope:'no-sources-requested',sources:[]},
      measurement:{id:'unfinished',freshness:{current:false}},quality:'unverified',deliveryEligible:false})
    const taskOnly=JSON.parse((await command(f.workspace,'--details')).stdout)
    expect(taskOnly.requirements.text).toBe(before.requirements.text)
    expect((await command(f.workspace,'--unknown')).code).toBe(1)
    expect((await command(f.root,'README.md')).stderr).toContain('another workspace')
    expect(await f.current()).toEqual(before)
    await expect(readFile(join(f.workspace,'dist/index.html'))).rejects.toThrow()
    await tools.close()
    expect((await command(f.workspace,'README.md')).code).toBe(1)
    await expect(f.measurement.handoff(['README.md'])).rejects.toThrow('expired')
  }finally{await tools.close();await f.close()}
})

test('later turn inspects prior receipts without replay, source selection or inventing current-turn evidence',async()=>{
  const f=await fixture()
  let reader:ReturnType<typeof createAgentMeasurement>|undefined
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined
  try {
    const measured=await f.measurement.measure(request),before=await f.current()
    const artifactBefore=await readFile(join(f.workspace,'dist/index.html'),'utf8')
    const live=structuredClone(before),previous=live.agentTurns![0]!
    previous.status='ended';previous.quiescedAt=new Date().toISOString()
    const next:AgentTurn={...f.turn,attemptId:'followup',requestKey:'followup',fence:2,measurements:undefined,
      message:{requestKey:'followup',runId:live.id,chatSessionId:live.chatSessionId,expectedVersion:live.version,
        requirementsRevision:live.requirements.revision,intent:'work',text:'Inspect the existing measured project'}}
    live.agentTurns!.push(next);live.writer={attemptId:next.attemptId,workerId:next.workerId,fence:next.fence}
    const unchanged=structuredClone(live)
    reader=createAgentMeasurement({run:live,turn:next,store:{...f.store,async read(){return live},
      async commit(){throw Error('Readonly inspection must never save or build')}}})
    const byId=await reader.inspect(measured.id),byKey=await reader.inspect(measured.requestKey)
    expect(byKey).toEqual(byId)
    expect(byId).toMatchObject({id:measured.id,attemptId:previous.attemptId,turnStatus:'ended',freshness:{current:true},
      quality:'unverified',deliveryEligible:false})
    expect((await reader.context()).measurement?.requestKey).toBe(measured.requestKey)
    expect((await reader.handoff()).sources).toMatchObject({scope:'no-sources-requested',sources:[]})
    expect(await agentTurnHandoffReason(live,next)).toContain('measured inputs are current')
    expect(live).toEqual(unchanged)
    tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:reader})
    const command=async(entry:string,...args:string[])=>{
      const child=Bun.spawn([process.execPath,join(f.workspace,tools!.directory,entry),...args],{cwd:f.workspace,
        env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
      return {stdout:await new Response(child.stdout).text(),stderr:await new Response(child.stderr).text(),code:await child.exited}
    }
    const viaCLI=await command('measure.mjs','--inspect',measured.id)
    expect(viaCLI.code).toBe(0)
    expect(JSON.parse(viaCLI.stdout)).toEqual(byId)
    const taskCLI=await command('handoff.mjs')
    expect(taskCLI.code).toBe(0)
    expect(JSON.parse(taskCLI.stdout).measurement.id).toBe(measured.id)
    expect(live).toEqual(unchanged)
    await expect(reader.inspect('another-run-measurement')).rejects.toThrow('No saved measurement in this Run')
    live.requirements.revision='changed-requirement'
    expect((await reader.inspect(measured.id)).freshness).toMatchObject({current:false,changes:{requirements:true}})
    expect(await agentTurnHandoffReason(live,next)).toContain('measurement-stale')
    // Pending/failed latest evidence cannot fall back to an earlier success.
    const pending={...measured,id:'interrupted-receipt',finishedAt:undefined,checks:[],error:'Interrupted'}
    next.measurements=[pending]
    await expect(reader.inspect(measured.requestKey)).rejects.toThrow('multiple turns')
    expect((await reader.inspect(measured.id)).freshness.code).toBe('measurement-superseded')
    expect((await reader.inspect(pending.id)).freshness.code).toBe('preview-unverified')
    expect((await reader.handoff()).measurement?.id).toBe(pending.id)
    expect(await agentTurnHandoffReason(live,next)).toContain('preview-unverified')
    const ambiguousCLI=await command('measure.mjs','--inspect',measured.requestKey)
    expect(ambiguousCLI.code).toBe(1)
    expect(ambiguousCLI.stdout).toContain('multiple turns')
    const interruptedCLI=await command('measure.mjs','--inspect',pending.id)
    expect(interruptedCLI.code).toBe(1)
    expect(JSON.parse(interruptedCLI.stdout).freshness.code).toBe('preview-unverified')
    expect(await readFile(join(f.workspace,'dist/index.html'),'utf8')).toBe(artifactBefore)
    expect(await f.current()).toEqual(before)
    await tools.close()
    expect((await command('handoff.mjs')).code).toBe(1)
    await expect(reader.inspect(measured.id)).rejects.toThrow('expired')
  }finally{await tools?.close();await reader?.close();await f.close()}
},30000)

test('handoff and inspection put freshness before verbose sources/logs; details is readonly and on demand',async()=>{
  const previous:AgentTurn={attemptId:'previous',requestKey:'previous',sessionId:'chat',workerId:'worker',fence:0,
    status:'interrupted',startedAt:'earlier',measurements:[{id:'latest-interrupted',requestKey:'saved',runtimeArtifact:'dist',
      requirementsRevision:'old',startedAt:'earlier',reportPaths:[],reports:[],checks:[{id:'build',status:'passed',
        version:'fixture',inputs:[],createdAt:'earlier',observation:'LONG_BUILD_LOG'.repeat(2000)}]}]}
  const f=await fixture(builder,[previous])
  try {
    await writeFile(join(f.workspace,'README.md'),Array.from({length:160},(_,i)=>'# Section '+i+'\nSaved decision '+i).join('\n'))
    const before=await f.current(),compact=await f.measurement.handoff(['README.md'])
    const output=JSON.stringify(compact,null,2),prefix=output.slice(0,2500)
    expect(prefix).toContain('"freshness"');expect(prefix).toContain('"current": false')
    expect(output.split('\n').slice(0,120).join('\n')).toContain('latest-interrupted')
    expect(compact.sources.sources[0]).not.toHaveProperty('sections')
    expect(compact.sources.sources[0]).not.toHaveProperty('text')
    expect(compact).not.toHaveProperty('measurements')
    expect(output).not.toContain('LONG_BUILD_LOG')
    const details=await f.measurement.handoff(['README.md'],true)
    expect(details.sources.sources[0]).toHaveProperty('sections')
    expect(details.sources.sources[0]).toHaveProperty('text')
    expect(JSON.stringify(details)).toContain('LONG_BUILD_LOG')
    expect(details).toHaveProperty('measurements')
    expect(await f.current()).toEqual(before)
  }finally{await f.close()}
})

test('a saved autonomous edit invalidates earlier measurements even if external restoration makes every source byte identical',async()=>{
  const f=await fixture(builder+"await cp('content','dist/content',{recursive:true});")
  const sessions=new BeeGameSessionManager({async start(){throw Error('No model dispatch')}},join(f.root,'sessions'),async()=>({}),{},true)
  const executor=createV3Executor({store:f.store,sessions})
  try {
    await mkdir(join(f.workspace,'content/ui'),{recursive:true})
    await mkdir(join(f.workspace,'content/scenes'),{recursive:true})
    const original=JSON.stringify(uiLayoutFixture())
    await writeFile(join(f.workspace,'content/ui/menu.json'),original)
    await writeFile(join(f.workspace,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(f.workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',
      documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',
      files:['scenes/level.json','ui/menu.json'],documents:[
        {path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'},
        {path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'}]}))
    const measured=await f.measurement.measure(request),run=await f.settle()
    expect((await selectAgentMeasuredBuild(run,measured.id)).measurement.id).toBe(measured.id)
    const snapshot=await readContentView(f.workspace)
    if(snapshot.state!=='draft')throw Error('Missing fixture')
    const document=JSON.parse(original);document.data.nodes[1].layout.size[1]=64
    await executor.edit(run,{requestKey:'edit',path:'ui/menu.json',expectedRevision:snapshot.documents.find(item=>item.path==='ui/menu.json')!.revision,document,
      workflow:{version:run.version,planRevision:run.planRevision,requirementsRevision:run.requirements.revision}})
    await expect(selectAgentMeasuredBuild(await f.current(),measured.id)).rejects.toThrow('changed')
    // Deliberate synthetic external byte restoration tests the historical
    // qualification, not just the ordinary content hash freshness check.
    await writeFile(join(f.workspace,'content/ui/menu.json'),original)
    await expect(selectAgentMeasuredBuild(await f.current(),measured.id)).rejects.toThrow('changed')
    await expect(exportAgentMeasuredBuild(await f.current(),measured.id,{read:f.current,busy:()=>false})).rejects.toThrow('changed')
    expect((await f.current()).agentTurns![0]!.measurements).toEqual(run.agentTurns![0]!.measurements)
  }finally{await executor.dispose();await sessions.dispose();await f.close()}
},30000)

test('native-turn capability records real build/report/smoke; dedup, export and read-only debug routes require no Task',async()=>{
  const f=await fixture(),tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
  const sessions=new BeeGameSessionManager({async start(){throw Error('No model dispatch')}},join(f.root,'sessions'),async()=>({}),{},true)
  try {
    const entry=join(f.workspace,tools.directory,'measure.mjs')
    const command=async(...args:string[])=>{
      const child=Bun.spawn([process.execPath,entry,...args],{cwd:f.workspace,env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
      return {stdout:await new Response(child.stdout).text(),stderr:await new Response(child.stderr).text(),code:await child.exited}
    }
    expect((await command('--help')).stdout).toContain('Does not install')
    const beforeInvalid = (await f.current()).version
    for (const args of [[], ['--request','only-key'], ['--inspect'], ['--request','a','--artifact'],
      ['--request','a','--request','b','--artifact','dist']]) {
      const invalid = await command(...args)
      expect(invalid.code).toBe(1); expect(invalid.stderr).toContain('--request <stable-id> --artifact')
      expect((await f.current()).version).toBe(beforeInvalid)
    }
    const first=await command('--request','measure-1','--artifact','dist','--report','README.md')
    expect(first.code,first.stdout+first.stderr).toBe(0)
    const record=JSON.parse(first.stdout),version=(await f.current()).version
    expect(record.checks.map((c:any)=>c.status)).toEqual(['passed','passed']);expect(record.quality).toBe('unverified')
    expect(record.checkScope.unmeasuredConsumptionChecks).toHaveLength(5)
    expect(record.freshness.current).toBe(true)
    expect(record.note).toContain('not in measured source/report files')
    expect(record.reports[0].path).toBe('README.md')
    const live=await f.current()
    live.agentTurns![0]!.message={requestKey:'authorized-work',runId:live.id,chatSessionId:live.chatSessionId,
      expectedVersion:live.version,requirementsRevision:live.requirements.revision,intent:'work',text:'Measure the saved project'}
    expect(await agentTurnHandoffReason(live,live.agentTurns![0]!)).toContain('measured inputs are current')
    expect(await agentTurnHandoffReason(live,live.agentTurns![0]!)).toContain('Game-quality acceptance remains unverified')
    expect(JSON.parse((await command('--inspect','measure-1')).stdout).freshness.current).toBe(true)
    const compact=JSON.parse((await command('--inspect','measure-1')).stdout)
    expect(compact.checks[0].observation).toBeUndefined()
    expect(compact.sourceExclusions).toEqual(['reports'])
    expect((await command('--inspect','measure-1','--details','--extra')).code).toBe(1)
    const details=JSON.parse((await command('--inspect','measure-1','--details')).stdout)
    expect(details.checks[0].observation).toContain('Host executed')
    expect(details.id).toBe(compact.id)
    expect((await command('--inspect','not-measured')).code).toBe(1)
    expect(JSON.parse((await command('--request','measure-1','--artifact','dist','--report','README.md')).stdout).id).toBe(record.id)
    expect((await f.current()).version).toBe(version)
    const conflict=await command('--request','measure-1','--artifact','other')
    expect(conflict.code).toBe(1)
    expect(conflict.stdout).toContain('--inspect <request-id>')
    expect((await f.current()).version).toBe(version)
    await expect(selectAgentMeasuredBuild(await f.current(),record.id)).rejects.toThrow('writer')
    const run=await f.settle()
    expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false)
    const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),readRun:f.current,isBusy:()=>false})
    try {
      const opened=await preview.openAgent(run,record.id)
      expect(opened.measurementId).toBe(record.id)
      const response=await preview.handle(new Request(opened.url));expect(response!.status).toBe(200)
      expect(await response!.text()).toContain('Actual fixture')
      const zip=await JSZip.loadAsync((await exportAgentMeasuredBuild(run,record.id,{read:f.current,busy:()=>false},'project')).data)
      expect(await zip.file('project/src/index.html').async('string')).toBe(await readFile(join(f.workspace,'src/index.html'),'utf8'))
      expect(await zip.file('project/dist/index.html').async('string')).toBe(await readFile(join(f.workspace,'dist/index.html'),'utf8'))
      const receipt=JSON.parse(await zip.file('measurement.json').async('string'))
      expect(receipt.measurementId).toBe(record.id);expect(receipt.reports).toEqual(record.reports);expect(receipt.deliveryEligible).toBe(false)
      expect(Object.keys(zip.files).some(p=>p.includes('.beegame'))).toBe(false)
      const app=new Hono();let owned=true
      registerV3Routes(app,{store:f.store,sessions,preview,getUser:()=>({id:'owner',role:'viewer'}),
        getProject:async()=>owned?({id:'measure',root_path:f.workspace} as any):undefined,getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,
        assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json()})
      const path='/api/projects/measure/workflow-v3'
      const detail=await app.request(path+'/agent/measurements/'+record.id)
      expect(detail.status).toBe(200);expect((await detail.json()).freshness.current).toBe(true)
      const body={measurementId:record.id,requirementsRevision:run.requirements.revision,kind:'project'}
      const exported=await app.request(path+'/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
      expect(exported.status).toBe(200)
      owned=false;expect((await app.request(path+'/agent/measurements/'+record.id)).status).toBe(404);owned=true
      await writeFile(join(f.workspace,'README.md'),'PASS with a different report')
      const stale=await app.request(path+'/agent/measurements/'+record.id)
      expect((await stale.json()).freshness.current).toBe(false)
      await expect(exportAgentMeasuredBuild(run,record.id,{read:f.current,busy:()=>false},'project')).rejects.toThrow('changed')
      expect((await preview.handle(new Request(opened.url)))!.status).toBe(409)
      expect((await f.current()).version).toBe(run.version)
    }finally{preview.dispose()}
    await tools.close()
    expect((await command('--request','measure-1','--artifact','dist','--report','README.md')).code).not.toBe(0)
  }finally{await tools.close();await sessions.dispose();await f.close()}
},30000)

test('new verification attachments do not stale a source-copy build or project export; tracked evidence still does',async()=>{
  const f=await fixture()
  const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),readRun:f.current,isBusy:()=>false})
  try {
    await mkdir(join(f.workspace,'reports/first'),{recursive:true})
    await writeFile(join(f.workspace,'reports/first/result.json'),'Actual saved fixture evidence')
    const measured=await f.measurement.measure({...request,reportPaths:['reports/first/result.json']})
    expect(measured.checks.map(c=>c.status)).toEqual(['passed','passed'])
    expect(measured.checks[0]!.projectBuild!.excludedReports).toEqual(['reports'])
    expect(measured.checks[0]!.projectBuild!.files.some(f=>f.path.startsWith('reports/'))).toBe(false)
    // Later verification creates NEW attachments, never rewrites the measured report.
    await mkdir(join(f.workspace,'reports/another-check'),{recursive:true})
    await writeFile(join(f.workspace,'reports/another-check/shot.png'),'Synthetic screenshot bytes')
    expect((await f.measurement.inspect(request.requestKey)).freshness.current).toBe(true)
    const saved=await f.current(),run=await f.settle()
    const opened=await preview.openAgent(run,measured.id)
    expect((await preview.handle(new Request(opened.url)))!.status).toBe(200)
    const zip=await JSZip.loadAsync((await exportAgentMeasuredBuild(run,measured.id,{read:f.current,busy:()=>false},'project')).data)
    expect(Object.keys(zip.files).some(p=>p.startsWith('project/reports/'))).toBe(false)
    expect(JSON.parse(await zip.file('measurement.json').async('string')).reports).toEqual(measured.reports)
    expect((await f.current()).agentTurns![0]!.measurements).toEqual(saved.agentTurns![0]!.measurements)
    // Evidence hash remains a separate exact operand despite the directory exclusion.
    await writeFile(join(f.workspace,'reports/first/result.json'),'Changed assertion')
    const stale=await inspectAgentMeasurementInputs(run,measured)
    expect(stale.current).toBe(false);expect(stale.reason).toContain('reports/first/result.json')
    expect((await preview.handle(new Request(opened.url)))!.status).toBe(409)
    await expect(exportAgentMeasuredBuild(run,measured.id,{read:f.current,busy:()=>false},'project')).rejects.toThrow('Reports changed')
  }finally{preview.dispose();await f.close()}
},30000)

test('report exclusions are build operands, not a retroactive acceptance of old receipts or omitted production inputs',async()=>{
  const f=await fixture()
  try {
    await mkdir(join(f.workspace,'reports'),{recursive:true})
    await writeFile(join(f.workspace,'reports/result.txt'),'Evidence')
    const measured=await f.measurement.measure(request)
    // Actual old-style source-copy build retained every exportable report file.
    const legacyBuild=await buildEditableProject(f.workspace,{editableProject:true,runtimeArtifact:'dist',writablePaths:['dist/**']},measured.checks[0]!.inputs,[])
    expect(legacyBuild.status).toBe('passed')
    const legacy={...measured,id:'legacy',checks:[legacyBuild,measured.checks[1]!]}
    const oldRun=structuredClone(await f.current());oldRun.agentTurns![0]!.measurements=[legacy]
    expect((await inspectAgentMeasurementInputs(oldRun,legacy)).current).toBe(true)
    await writeFile(join(f.workspace,'reports/new-result.txt'),'Later verification')
    expect((await inspectAgentMeasurementInputs(oldRun,legacy)).reason).toContain('reports/new-result.txt')
    expect((await f.measurement.inspect(request.requestKey)).freshness.current).toBe(true)
    // A similarly named production directory is not evidence and still invalidates the source proof.
    await mkdir(join(f.workspace,'reports-assets'),{recursive:true})
    await writeFile(join(f.workspace,'reports-assets/data.json'),'{}')
    expect((await f.measurement.inspect(request.requestKey)).freshness.reason).toContain('reports-assets/data.json')
    const before=await f.current()
    for(const artifact of ['reports','reports/dist'])expect(()=>f.measurement.measure({...request,requestKey:artifact,runtimeArtifact:artifact})).toThrow('reserved reports/')
    expect(await f.current()).toEqual(before)
    // Misplaced production dependencies fail the actual copied build; they are not silently accepted.
    await writeFile(join(f.workspace,'build.mjs'),"await Bun.file('reports/result.txt').text();"+builder)
    const fails=await f.measurement.measure({...request,requestKey:'misplaced-input'})
    expect(fails.checks[0]!.status).toBe('failed')
    expect(fails.checks[0]!.observation).toContain('reports/result.txt')
    const failure=await f.measurement.inspect('misplaced-input')
    expect(failure.checks[0]).toMatchObject({observation:expect.stringContaining('reports/result.txt')})
    expect(failure.freshness.current).toBe(false)
  }finally{await f.close()}
},30000)

test('post-measure receipt edit is identified by read-only inspection; original evidence is not rewritten or replayed',async()=>{
  const f=await fixture(),tools=await openAgentTools({workspacePath:f.workspace,sessionId:'chat',getAuthToken:()=>undefined,measurement:f.measurement})
  try {
    const entry=join(f.workspace,tools.directory,'measure.mjs')
    const command=async(...args:string[])=>{
      const child=Bun.spawn([process.execPath,entry,...args],{cwd:f.workspace,
        env:{...process.env,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(f.workspace,'chat','measurement')},stdout:'pipe',stderr:'pipe'})
      const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
      return {stdout,stderr,code}
    }
    const measured=await command('--request','measure-1','--artifact','dist','--report','README.md')
    expect(measured.code,measured.stdout+measured.stderr).toBe(0)
    const original=JSON.parse(measured.stdout),saved=await f.current()
    const artifact=await readFile(join(f.workspace,'dist/index.html'))
    // This is the observed general failure: any tracked report modified after
    // measurement is stale, even if the modification is only a receipt.
    await writeFile(join(f.workspace,'README.md'),'Fixture\nMeasurement '+original.id)
    const inspected=await command('--inspect','measure-1'),result=JSON.parse(inspected.stdout)
    expect(inspected.code).toBe(1)
    expect(result.freshness).toMatchObject({current:false,code:'measurement-stale'})
    expect(result.freshness.reason).toContain('README.md')
    expect(result.freshness.reason).toContain('receipt is already saved in BGS')
    expect(result.reports).toEqual(original.reports)
    const handoff=await f.measurement.handoff(['README.md'])
    expect(handoff.measurement?.id).toBe(original.id)
    expect(handoff.measurement?.freshness).toMatchObject({current:false,code:'measurement-stale'})
    const currentSource=handoff.sources.sources[0]
    if(!currentSource || !('sha256' in currentSource))throw Error('Expected the actual changed report source')
    expect(currentSource.sha256).not.toBe(original.reports[0].sha256)
    expect((await command('--request','measure-1','--artifact','dist','--report','README.md')).code).toBe(1)
    expect((await f.current()).version).toBe(saved.version)
    expect((await f.current()).agentTurns![0]!.measurements).toEqual(saved.agentTurns![0]!.measurements)
    expect(await readFile(join(f.workspace,'dist/index.html'))).toEqual(artifact)
    const run=await f.settle()
    const authorizedTurn={...run.agentTurns![0]!,message:{requestKey:'authorized-work',runId:run.id,
      chatSessionId:run.chatSessionId,expectedVersion:run.version,requirementsRevision:run.requirements.revision,
      intent:'work' as const,text:'Measure the saved project'}}
    expect(await agentTurnHandoffReason(run,authorizedTurn)).toContain('measurement-stale: Reports changed or are missing: README.md')
    await expect(selectAgentMeasuredBuild(run,original.id)).rejects.toThrow('README.md')
    for(const kind of ['static','project'] as const)
      await expect(exportAgentMeasuredBuild(run,original.id,{read:f.current,busy:()=>false},kind)).rejects.toThrow('README.md')
    const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),readRun:f.current,isBusy:()=>false})
    try {await expect(preview.openAgent(run,original.id)).rejects.toThrow('README.md')}
    finally{preview.dispose()}
  }finally{await tools.close();await f.close()}
},30000)

test('missing reports, failed builds, unknown reservations and new failures stay visible, never auto-retry or select an old PASS',async()=>{
  const f=await fixture()
  try {
    const missing=await f.measurement.measure({...request,reportPaths:['missing.md']})
    expect(missing.error).toContain('ENOENT');expect(missing.checks).toEqual([])
    expect((await f.measurement.measure({...request,reportPaths:['missing.md']})).id).toBe(missing.id)
    const good=await f.measurement.measure({...request,requestKey:'good'})
    expect(good.checks.map(c=>c.status)).toEqual(['passed','passed'])
    await writeFile(join(f.workspace,'build.mjs'),'process.exit(9)')
    const failed=await f.measurement.measure({...request,requestKey:'failed'})
    expect(failed.checks[0]!.status).toBe('failed');expect(failed.checks).toHaveLength(1)
    const before=await f.current(),handoff=await f.measurement.handoff(['README.md'])
    expect(handoff.measurement?.id).toBe(failed.id)
    expect(handoff.measurement?.checks[0]?.status).toBe('failed')
    expect(handoff.measurement?.freshness.current).toBe(false)
    expect(await f.current()).toEqual(before)
    await writeFile(join(f.workspace,'build.mjs'),builder)
    const run=await f.settle()
    await expect(selectAgentMeasuredBuild(run,good.id)).rejects.toThrow('newer measurement')
    await expect(selectAgentMeasuredBuild(run,failed.id)).rejects.toThrow('actual source-build')
  }finally{await f.close()}
},30000)

test('close cancels and drains actual build; reservation survives without replay',async()=>{
  const f=await fixture("await new Promise(r=>setTimeout(r,60000));"+builder)
  try {
    const pending=f.measurement.measure(request)
    for(let i=0;i<100 && !(await f.current()).agentTurns![0]!.measurements?.length;i++)await Bun.sleep(5)
    await Bun.sleep(300)
    await f.measurement.close();const stopped=await pending
    expect(stopped.error).toContain('cancelled')
    const saved=await f.current()
    const restored=createAgentMeasurement({run:saved,turn:saved.agentTurns![0]!,store:f.store})
    try {
      expect((await restored.measure(request)).id).toBe(stopped.id)
      expect((await f.current()).version).toBe(saved.version)
    }finally{await restored.close()}
    expect(()=>f.measurement.measure(request)).toThrow('expired')
  }finally{await f.close()}
},10000)

test('agent measurement build cannot read/write other project files or use the network through the host bridge',async()=>{
  const f=await fixture();let calls=0
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){calls++;return new Response('must not reach')}})
  const outside=join(f.root,'outside.txt')
  try {
    await writeFile(outside,'SYNTHETIC_PRIVATE')
    for(const [key,code] of [
      ['read','await Bun.file('+JSON.stringify(outside)+').text();'],
      ['write','await Bun.write('+JSON.stringify(outside)+',"overwritten");'],
      ['original-source','await Bun.file('+JSON.stringify(join(f.workspace,'README.md'))+').text();'],
      ['network','await fetch('+JSON.stringify(upstream.url.origin)+',{signal:AbortSignal.timeout(2000)});'],
    ]) {
      await writeFile(join(f.workspace,'build.mjs'),code+builder)
      const result=await f.measurement.measure({...request,requestKey:key!})
      expect(result.checks[0]?.status,JSON.stringify(result)).toBe('failed')
      expect(result.checks).toHaveLength(1)
      expect(await readFile(outside,'utf8')).toBe('SYNTHETIC_PRIVATE')
    }
    expect(calls).toBe(0)
  }finally{upstream.stop(true);await f.close()}
},15000)

test('lost settlement leaves a durable unknown result; repeated request does not replay build',async()=>{
  const f=await fixture()
  const uncertain=createAgentMeasurement({run:f.run,turn:f.turn,store:{read:f.store.read,async commit(...args) {
    if(args[4]==='agent.measurement-ended')throw Error('synthetic settlement unavailable')
    return f.store.commit(...args)
  }}})
  try {
    await expect(uncertain.measure(request)).rejects.toThrow('settlement unavailable')
    const before=await readFile(join(f.workspace,'dist/index.html'))
    await writeFile(join(f.workspace,'build.mjs'),'throw Error("must not replay")')
    const record=await f.measurement.measure(request)
    expect(record.finishedAt).toBeUndefined();expect(record.checks).toEqual([])
    expect(await readFile(join(f.workspace,'dist/index.html'))).toEqual(before)
    await expect(selectAgentMeasuredBuild(await f.settle(),record.id)).rejects.toThrow('actual source-build')
  }finally{await uncertain.close();await f.close()}
},10000)


test('design file diff spans the entire user turn, survives repeated reads and detects removed references',async()=>{
  const f=await fixture()
  let reader:ReturnType<typeof createAgentMeasurement>|undefined
  try {
    await writeDesignDocumentsFixture(f.workspace)
    const path='content/ui/menu.json'
    const original=await readFile(join(f.workspace,path),'utf8')
    reader=createAgentMeasurement({run:f.run,turn:f.turn,store:f.store})
    expect(reader.designFileChanges()).toMatchObject({status:'observed',files:[]})
    await writeFile(join(f.workspace,path),original+'\n')
    expect((await reader.handoff()).designFileChanges.files).toContainEqual({path,change:'modified'})
    // A context/handoff read (as happens after compact) cannot reset the start.
    await reader.context()
    expect(reader.designFileChanges().files).toContainEqual({path,change:'modified'})
    const doc=join(f.workspace,'docs/UI_UX_SPEC.md')
    await writeFile(doc,'# Design\n- Version: v1.0\nReference removed.\n')
    await rm(join(f.workspace,path))
    expect(reader.designFileChanges().files).toContainEqual({path,change:'deleted'})
    const snapshot=reader.designFileChanges()
    expect(snapshot.attemptId).toBe(f.turn.attemptId)
    expect(snapshot.scope).toBe('design-revision-files')
    await reader.close()
    expect(reader.designFileChanges()).toEqual(snapshot) // exit facts remain readable after capability cleanup
  } finally {await reader?.close();await f.close()}
})

test('missing documents are captured as absent; unsafe snapshot is unverified rather than an empty successful diff',async()=>{
  const f=await fixture()
  try {
    expect(f.measurement.designFileChanges()).toMatchObject({status:'observed',files:[]})
    await mkdir(join(f.workspace,'docs'),{recursive:true})
    await writeFile(join(f.workspace,'docs/GDD.md'),'# New saved design\n')
    expect(f.measurement.designFileChanges().files).toContainEqual({path:'docs/GDD.md',change:'added'})
    await rm(join(f.workspace,'docs/GDD.md'))
    await symlink(join(f.workspace,'README.md'),join(f.workspace,'docs/GDD.md'))
    expect(f.measurement.designFileChanges()).toMatchObject({status:'unverified',files:[]})
  } finally {await f.close()}
})

test('turn snapshot discovers unlinked unregistered UI/Scene drafts, including malformed, added and removed files',async()=>{
  const f=await fixture()
  let reader:ReturnType<typeof createAgentMeasurement>|undefined
  try {
    await mkdir(join(f.workspace,'content/ui/nested'),{recursive:true})
    await mkdir(join(f.workspace,'content/scenes/nested'),{recursive:true})
    // No design documents, content index or valid draft schema is required to observe bytes.
    for(const path of ['content/ui/title.json','content/scenes/nested/level.json','content/scenes/removed.json'])
      await writeFile(join(f.workspace,path),'{unfinished')
    reader=createAgentMeasurement({run:f.run,turn:f.turn,store:f.store})
    expect(reader.designFileChanges()).toMatchObject({status:'observed',files:[]})
    await writeFile(join(f.workspace,'content/ui/title.json'),'{still unfinished')
    await writeFile(join(f.workspace,'content/scenes/nested/level.json'),'{}')
    await rm(join(f.workspace,'content/scenes/removed.json'))
    await writeFile(join(f.workspace,'content/ui/nested/new.json'),'{}')
    await writeFile(join(f.workspace,'content/index.json'),'{}')
    await writeFile(join(f.workspace,'src/unrelated.json'),'{}')
    const expected:{path:string;change:'added'|'modified'|'deleted'}[]=[
      {path:'content/scenes/nested/level.json',change:'modified'},
      {path:'content/scenes/removed.json',change:'deleted'},
      {path:'content/ui/nested/new.json',change:'added'},
      {path:'content/ui/title.json',change:'modified'},
    ]
    expect(reader.designFileChanges()).toMatchObject({status:'observed',files:expected})
    expect((await reader.handoff()).designFileChanges.files).toEqual(expected)
    expect(f.measurement.designFileChanges().files).toEqual([
      {path:'content/scenes/nested/level.json',change:'added'},
      {path:'content/ui/nested/new.json',change:'added'},
      {path:'content/ui/title.json',change:'added'},
    ]) // Directories absent at turn start are normal; later additions are observed.
  } finally {await reader?.close();await f.close()}
})

test.each(['file','directory','root','broken-parent','not-directory'] as const)('unsafe content discovery (%s) makes the turn snapshot unverified',async kind=>{
  const f=await fixture()
  let reader:ReturnType<typeof createAgentMeasurement>|undefined
  try {
    await mkdir(join(f.workspace,'content/ui'),{recursive:true})
    await writeFile(join(f.workspace,'content/ui/title.json'),'{}')
    reader=createAgentMeasurement({run:f.run,turn:f.turn,store:f.store})
    expect(reader.designFileChanges()).toMatchObject({status:'observed',files:[]})
    const outside=join(f.root,'outside');await mkdir(outside)
    await writeFile(join(outside,'private.json'),'PRIVATE_SENTINEL')
    if(kind==='file')await symlink(join(outside,'private.json'),join(f.workspace,'content/ui/escape.json'))
    if(kind==='directory')await symlink(outside,join(f.workspace,'content/ui/nested'))
    if(kind==='root'||kind==='not-directory') {
      await rm(join(f.workspace,'content/ui'),{recursive:true})
      if(kind==='root')await symlink(outside,join(f.workspace,'content/ui'))
      else await writeFile(join(f.workspace,'content/ui'),'not a directory')
    }
    if(kind==='broken-parent') {
      await rm(join(f.workspace,'content'),{recursive:true})
      await symlink(join(f.root,'missing'),join(f.workspace,'content'))
    }
    expect(reader.designFileChanges()).toMatchObject({status:'unverified',files:[],error:expect.any(String)})
    // An unsafe initial snapshot must also remain unverified, never a partial baseline.
    const unsafe=createAgentMeasurement({run:f.run,turn:f.turn,store:f.store})
    try {expect(unsafe.designFileChanges()).toMatchObject({status:'unverified',files:[]})}
    finally {await unsafe.close()}
    expect(await readFile(join(outside,'private.json'),'utf8')).toBe('PRIVATE_SENTINEL')
  } finally {await reader?.close();await f.close()}
})
