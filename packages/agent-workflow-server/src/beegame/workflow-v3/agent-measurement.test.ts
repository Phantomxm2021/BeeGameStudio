import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {Hono} from 'hono'
import {createRun,digest,type AgentTurn} from './state'
import {createLocalWorkflowStore} from './store'
import {createAgentMeasurement} from './agent-measurement'
import {openAgentTools} from './agent-tools'
import {selectAgentMeasuredBuild,exportAgentMeasuredBuild,inspectAgentMeasurementInputs} from './measured-build'
import {buildEditableProject} from './editable-project'
import {createMeasuredPreview} from './measured-preview'
import {createPreviewCapabilityManager} from '../../auth/preview-capability'
import {registerV3Routes} from './routes'
import {BeeGameSessionManager} from '../session-manager'
import {projectPreviewCapabilityPath} from '../project-preview-capability'
import {uiLayoutFixture} from '../fixtures/layout-fixture'
import {createV3Executor} from './execution'
import {readContentView} from './content-view'
import {agentTurnHandoffReason} from './agent-goal'

const JSZip=createRequire(import.meta.resolve('exceljs'))('jszip')
const builder="import{cp,mkdir}from'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');"
async function fixture(script=builder,previousTurns:AgentTurn[]=[]) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-measure-'))),workspace=join(root,'project')
  await mkdir(join(workspace,'src'),{recursive:true})
  await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
  await writeFile(join(workspace,'build.mjs'),script)
  await writeFile(join(workspace,'src/index.html'),'<html><body><h1>Actual fixture</h1><button>Play</button></body></html>')
  await writeFile(join(workspace,'README.md'),'Merged eight-domain fixture; semantics not verified')
  const store=createLocalWorkflowStore(join(root,'host'))
  const run=createRun({projectId:'measure',ownerId:'owner',workspacePath:workspace,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
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
    expect((await command(f.workspace,'--help')).stdout).toContain('No build')
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
    expect((await command(f.workspace)).code).toBe(1)
    expect((await command(f.root,'README.md')).stderr).toContain('another workspace')
    expect(await f.current()).toEqual(before)
    await expect(readFile(join(f.workspace,'dist/index.html'))).rejects.toThrow()
    await tools.close()
    expect((await command(f.workspace,'README.md')).code).toBe(1)
    await expect(f.measurement.handoff(['README.md'])).rejects.toThrow('expired')
  }finally{await tools.close();await f.close()}
})

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
    const original=JSON.stringify(uiLayoutFixture())
    await writeFile(join(f.workspace,'content/ui/menu.json'),original)
    await writeFile(join(f.workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',
      documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json'],
      documents:[{path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'}]}))
    const measured=await f.measurement.measure(request),run=await f.settle()
    expect((await selectAgentMeasuredBuild(run,measured.id)).measurement.id).toBe(measured.id)
    const snapshot=await readContentView(f.workspace)
    if(snapshot.state!=='draft')throw Error('Missing fixture')
    const document=JSON.parse(original);document.data.nodes[1].layout.size[1]=64
    await executor.edit(run,{requestKey:'edit',path:'ui/menu.json',expectedRevision:snapshot.documents[0]!.revision,document,
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
    expect(record.freshness.current).toBe(true)
    expect(record.note).toContain('not in measured source/report files')
    expect(record.reports[0].path).toBe('README.md')
    const live=await f.current()
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
    expect(run.tasks).toEqual({});expect(run.plans).toEqual([]);expect(run.attempts).toEqual([])
    const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),readRun:f.current,isBusy:()=>false})
    try {
      const opened=await preview.openAgent(run,record.id)
      expect(opened.taskId).toBeUndefined();expect(opened.measurementId).toBe(record.id)
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
    const legacyBuild=await buildEditableProject(f.workspace,{editableProject:true,runtimeArtifact:'dist',writablePaths:['dist/**']},measured.checks[0]!.inputs,[],undefined,true)
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
    expect(await agentTurnHandoffReason(run,run.agentTurns![0]!)).toContain('measurement-stale: Reports changed or are missing: README.md')
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

