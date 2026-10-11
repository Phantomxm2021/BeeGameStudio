import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Hono } from 'hono'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type Run, type TaskSpec, type CheckResult } from './state'
import { bindInputs, readVersion, runChecks, settlementInputs } from './checks'
import { STATIC_ARTIFACT_CHECK_VERSION, staticArtifactFiles } from './runtime-checks'
import { artifactDigest } from '../runtime-acceptance'
import { exportMeasuredBuild } from './measured-build'
import { recordPreviewIssue, prepareIssueReview, prepareReviewedRepair } from './preview-issues'
import { taskContext } from './context'
import { createLocalWorkflowStore } from './store'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'

// Synthetic host evidence tests protocol/versioning, not browser/game quality.
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-v3-export-feedback-')))
  await mkdir(join(root,'dist')); await mkdir(join(root,'reviews'))
  await writeFile(join(root,'rules.json'), '{"speed":4}')
  await writeFile(join(root,'unrelated.json'), '{}')
  await writeFile(join(root,'package.json'), JSON.stringify({scripts:{'test:rules':'bun -e "const r=await Bun.file(\'rules.json\').json();process.exit(r.speed===10?0:1)"'}}))
  await writeFile(join(root,'dist/index.html'), '<script src="/main.js"></script>')
  await writeFile(join(root,'dist/main.js'), 'console.log("synthetic")')
  const owner: TaskSpec = {id:'owner',kind:'game.develop',goal:'Rule owner',dependsOn:[],requirementIds:['req.loop'],inputs:[],writablePaths:['rules.json'],expectedOutputs:['rules.json'],checks:['artifact-json']}
  const build: TaskSpec = {id:'build',kind:'game.develop',goal:'Measured static build',dependsOn:['owner'],requirementIds:['req.loop'],inputs:['rules.json'],writablePaths:['dist/**'],expectedOutputs:['dist/index.html'],checks:['runtime-smoke'],runtimeArtifact:'dist'}
  let run = createRun({projectId:'test',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Speed 10',constraints:{},ids:['req.loop']})
  run = publishPlan(run,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:run.requirements.revision,tasks:[owner,build,{...owner,id:'unrelated',writablePaths:['unrelated.json'],expectedOutputs:['unrelated.json']}]})
  async function complete(id: string) {
    const spec = run.tasks[id]!.spec, claimed = claimTask(run,{taskId:id,requestKey:crypto.randomUUID(),workerId:'worker',sessionId:id,inputVersions:await bindInputs(run,spec)})
    let result
    if(id==='build') {
      const files = await staticArtifactFiles(root,'dist')
      const check: CheckResult = {id:'runtime-smoke',version:STATIC_ARTIFACT_CHECK_VERSION,status:'passed',inputs:[...claimed.attempts.at(-1)!.inputVersions,...await Promise.all(files.map(p=>readVersion(root,p)))],
        artifacts:[{path:'dist',sha256:await artifactDigest(root,'dist',true)}],coverage:{files,limitations:['Synthetic browser record; full game not accepted']},createdAt:new Date().toISOString(),observation:'Synthetic measurement'}
      result={checks:[check],outputs:[await readVersion(root,'dist/index.html')]}
    } else result=await runChecks(root,spec,claimed.attempts.at(-1)!.inputVersions)
    run=finishTask(claimed,claimed.writer!.attemptId,claimed.fence,result,true)
  }
  await complete('owner'); await complete('unrelated'); await complete('build')
  const selection=()=>({taskId:'build',attemptId:run.tasks.build!.attemptId!,planRevision:run.planRevision})
  const issueBody=()=>({...selection(),requestKey:'issue-1',artifactSha256:run.attempts.find(a=>a.attemptId===run.tasks.build!.attemptId)!.checks![0]!.artifacts![0]!.sha256,
    requirementIds:['req.loop'],steps:'Start and observe speed',expected:'Speed 10',observed:'Speed 4'})
  return {root,get run(){return run},set run(v:Run){run=v},selection,issueBody,complete,dispose:()=>rm(root,{recursive:true,force:true})}
}

test('measured ZIP contains exact build bytes plus receipt, no source/host/private files and no state mutation',async()=>{
  const f=await fixture()
  try{
    await writeFile(join(f.root,'.env'),'SECRET=never-export'); const before=JSON.stringify(f.run)
    const result=await exportMeasuredBuild(f.run,'build',f.selection().attemptId,{read:async()=>f.run,busy:()=>false})
    const JSZip=createRequire(import.meta.resolve('exceljs'))('jszip'), zip=await JSZip.loadAsync(result.data)
    expect(Object.keys(zip.files).sort()).toEqual(['build/index.html','build/main.js','measurement.json'])
    expect(await zip.file('build/main.js').async('string')).toBe(await Bun.file(join(f.root,'dist/main.js')).text())
    const receipt=JSON.parse(await zip.file('measurement.json').async('string'))
    expect(receipt.artifact).toEqual(result.artifact); expect(receipt.deliveryEligible).toBe(false)
    expect(receipt.check.inputs).toBeUndefined(); expect(receipt.check.status).toBe('passed')
    expect(JSON.stringify(f.run)).toBe(before)
  }finally{await f.dispose()}
})
for(const mutation of ['source','build','added','writer','alias','coverage','check-version','upstream-check-version','run-during-read'] as const) test('export refuses '+mutation+' without returning a partial ZIP',async()=>{
  const f=await fixture()
  try{
    if(mutation==='source') await writeFile(join(f.root,'rules.json'),'{}')
    if(mutation==='build') await writeFile(join(f.root,'dist/main.js'),'changed')
    if(mutation==='added') await writeFile(join(f.root,'dist/private.txt'),'new')
    if(mutation==='alias'){await rm(join(f.root,'dist/main.js'));await symlink(join(f.root,'rules.json'),join(f.root,'dist/main.js'))}
    if(mutation==='coverage')f.run.attempts.at(-1)!.checks![0]!.coverage!.files=['dist/index.html']
    if(mutation==='check-version')f.run.attempts.at(-1)!.checks![0]!.version='author-PASS'
    if(mutation==='upstream-check-version')f.run.attempts.find(a=>a.taskId==='owner')!.checks![0]!.version='obsolete.0'
    await expect(exportMeasuredBuild(f.run,'build',f.selection().attemptId,{busy:()=>mutation==='writer',read:async()=>mutation==='run-during-read'?{...f.run,version:f.run.version+1}:f.run})).rejects.toThrow()
  }finally{await f.dispose()}
})

test('Preview observation -> source-backed Review -> original owner Repair -> remeasurement -> directed closure, without unrelated rework',async()=>{
  const f=await fixture()
  try{
    const before=structuredClone(f.run.tasks.unrelated), recorded=await recordPreviewIssue(f.run,f.issueBody(),false); f.run=recorded.run
    expect((await recordPreviewIssue(f.run,f.issueBody(),false)).run).toBe(f.run)
    await expect(recordPreviewIssue(f.run,{...f.issueBody(),observed:'different'},false)).rejects.toThrow('different content')
    f.run=await prepareIssueReview(f.run,recorded.issue.id)
    expect(await prepareIssueReview(f.run,recorded.issue.id)).toBe(f.run)
    expect(f.run.tasks.build!.status).toBe('succeeded')
    const reviewTask=Object.values(f.run.tasks).find(t=>t.spec.previewIssues)!.spec
    const first=claimTask(f.run,{taskId:reviewTask.id,requestKey:'review',workerId:'worker',sessionId:'review',inputVersions:await bindInputs(f.run,reviewTask)})
    expect(taskContext(first,first.attempts.at(-1)!)).toContain('Saved user Preview observations')
    expect(taskContext(first,first.attempts.at(-1)!)).not.toContain('SECRET=')
    const source=await readVersion(f.root,'rules.json')
    const finding={id:'F1',requirementId:'req.loop',ownerTaskId:'owner',severity:'blocker',sources:[{...source,quote:'{"speed":4}'}],impact:'Wrong speed',close:'Use confirmed speed',verifyWith:['rule-tests']}
    const report={requirementsRevision:first.requirements.revision,planRevision:first.planRevision,findings:[finding],closed:[],limitations:['Synthetic semantic finding'],
      observations:[{id:recorded.issue.id,disposition:'finding',findingIds:['F1'],reason:'Observed current speed matches saved rule'}]}
    await writeFile(join(f.root,reviewTask.reviewReport!),JSON.stringify(report))
    await writeFile(join(f.root,'dist/added-during-review.js'),'new membership')
    const drift=await runChecks(f.root,reviewTask,first.attempts.at(-1)!.inputVersions,undefined,{}, {run:first,attempt:first.attempts.at(-1)!})
    expect(drift.checks[0]!.status).toBe('unverified');expect(drift.checks[0]!.observation).toContain('current measured consumer')
    await rm(join(f.root,'dist/added-during-review.js'))
    f.run=finishTask(first,first.writer!.attemptId,first.fence,await runChecks(f.root,reviewTask,first.attempts.at(-1)!.inputVersions,undefined,{}, {run:first,attempt:first.attempts.at(-1)!}),true)
    const reviewed=f.run.attempts.at(-1)!, historical=await Bun.file(join(f.root,reviewTask.reviewReport!)).text()
    expect(reviewed.status).toBe('failed');expect(reviewed.review).toBeDefined()
    await writeFile(join(f.root,reviewTask.reviewReport!),'{}')
    await expect(prepareReviewedRepair(f.run,reviewed.attemptId,['F1'])).rejects.toThrow('review report changed')
    await writeFile(join(f.root,reviewTask.reviewReport!),historical)
    f.run=await prepareReviewedRepair(f.run,reviewed.attemptId,['F1'])
    await expect(bindInputs(f.run,{...f.run.tasks[reviewTask.id]!.spec,previewIssues:[crypto.randomUUID()]})).rejects.toThrow('retain exactly')
    expect(f.run.tasks.owner!.status).toBe('pending');expect(f.run.tasks.build!.status).toBe('pending')
    const spec=f.run.tasks.owner!.spec, repair=claimTask(f.run,{taskId:'owner',requestKey:'repair',workerId:'worker',sessionId:'repair',inputVersions:await bindInputs(f.run,spec)})
    await writeFile(join(f.root,'rules.json'),'{"speed":10}')
    f.run=finishTask(repair,repair.writer!.attemptId,repair.fence,await runChecks(f.root,spec,await settlementInputs(f.root,spec,repair.attempts.at(-1)!.inputVersions),undefined,{}, {run:repair,attempt:repair.attempts.at(-1)!}),true)
    const repaired=f.run.attempts.at(-1)!;expect(repaired.status).toBe('succeeded')
    await f.complete('build')
    const follow=f.run.tasks[reviewTask.id]!.spec, final=claimTask(f.run,{taskId:follow.id,requestKey:'follow',workerId:'worker',sessionId:'follow',inputVersions:await bindInputs(f.run,follow)})
    await writeFile(join(f.root,follow.reviewReport!),JSON.stringify({...report,planRevision:final.planRevision,findings:[],
      closed:[{id:'F1',repairAttemptId:repaired.attemptId,sources:[{...await readVersion(f.root,'rules.json'),quote:'{"speed":10}'}],observed:'Actual rule check passed; measured build/source comparison completed'}]}))
    f.run=finishTask(final,final.writer!.attemptId,final.fence,await runChecks(f.root,follow,final.attempts.at(-1)!.inputVersions,undefined,{}, {run:final,attempt:final.attempts.at(-1)!}),true)
    expect(f.run.tasks[follow.id]!.status).toBe('succeeded');expect(f.run.tasks.unrelated).toEqual(before)
    expect(f.run.previewIssues).toEqual([recorded.issue]);expect(await Bun.file(join(f.root,reviewTask.reviewReport!)).text()).toBe(historical)
    expect(f.run.deliveryEligible).toBe(false)
  }finally{await f.dispose()}
})

test('unreviewed/stale feedback cannot authorize repair or silently pass when omitted',async()=>{
  const f=await fixture()
  try{
    await expect(recordPreviewIssue(f.run,{...f.issueBody(),artifactSha256:'0'.repeat(64)},false)).rejects.toThrow('measured build')
    await expect(recordPreviewIssue(f.run,{...f.issueBody(),requirementIds:['new-scope']},false)).rejects.toThrow('confirmed requirement')
    const saved=await recordPreviewIssue(f.run,f.issueBody(),false);f.run=saved.run
    await expect(prepareReviewedRepair(f.run,saved.issue.attemptId,['F1'])).rejects.toThrow('source-backed')
    f.run=await prepareIssueReview(f.run,saved.issue.id)
    const task=Object.values(f.run.tasks).find(t=>t.spec.previewIssues)!.spec, attempt={...f.run.attempts.at(-1)!,taskId:task.id,planRevision:f.run.planRevision}
    await writeFile(join(f.root,task.reviewReport!),JSON.stringify({requirementsRevision:f.run.requirements.revision,planRevision:f.run.planRevision,findings:[],closed:[],limitations:['No reproduction']}))
    const checked=await runChecks(f.root,task,await bindInputs(f.run,task),undefined,{}, {run:f.run,attempt})
    expect(checked.checks[0]!.status).toBe('failed');expect(checked.checks[0]!.observation).toContain('explicit disposition')
    await writeFile(join(f.root,'rules.json'),'{}')
    await expect(bindInputs(f.run,task)).rejects.toThrow()
  }finally{await f.dispose()}
})

test('HTTP export/feedback preserve separate permissions, CAS and recovery; no native dispatch',async()=>{
  const f=await fixture(), data=await mkdtemp(join(tmpdir(),'bgs-v3-feedback-store-'))
  let starts=0
  const sessions=new BeeGameSessionManager({async start(){starts++;throw Error('No dispatch permitted')}},data,async()=>({}),{},true), store=createLocalWorkflowStore(data)
  try{
    let role: 'developer' | 'viewer' = 'developer', owned = true
    await store.commit(f.run.projectId,f.run.ownerId,0,{...f.run,version:1},'fixture')
    const app=new Hono();registerV3Routes(app,{store,sessions,getUser:()=>({id:'owner',role}),getProject:async()=>owned?({id:'test',root_path:f.root}) as any:undefined,
      getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json()})
    const request=(path:string,body:unknown)=>app.request('/api/projects/test/workflow-v3/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    const exported=await request('export',f.selection());expect(exported.status).toBe(200);expect(exported.headers.get('content-type')).toBe('application/zip')
    role='viewer';expect((await request('export',f.selection())).status).toBe(200) // Existing viewer permission includes project.export, not Preview/manage.
    owned=false;expect((await request('export',f.selection())).status).toBe(404);owned=true
    expect((await request('preview-issues',f.issueBody())).status).toBe(403)
    role='developer'
    const recorded=await request('preview-issues',f.issueBody());expect(recorded.status).toBe(200)
    const issue=(await recorded.json()).issue
    const restored=createLocalWorkflowStore(data);expect((await restored.read('test','owner'))!.previewIssues![0]!.id).toBe(issue.id)
    const planned=await request('preview-issues/'+issue.id+'/review-plan',{planRevision:f.run.planRevision})
    expect(planned.status).toBe(200);expect((await planned.json()).dispatched).toBe(false)
    const current=(await store.read('test','owner'))!;expect(current.writer).toBeUndefined();expect(current.attempts).toHaveLength(f.run.attempts.length)
    expect(starts).toBe(0)
    expect((await request('export',f.selection())).status).toBe(409)
    const changed={...current,version:current.version+1,previewIssues:[]}
    await expect(store.commit('test','owner',current.version,changed,'bad')).rejects.toThrow('cannot be rewritten')
    expect((await store.read('test','owner'))!.version).toBe(current.version)
  }finally{await sessions.dispose();await f.dispose();await rm(data,{recursive:true,force:true})}
})
