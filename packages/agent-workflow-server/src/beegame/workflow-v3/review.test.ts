import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type Run, type Plan, type TaskSpec } from './state'
import { bindInputs, readVersion, runChecks, staleTaskIds, settlementInputs } from './checks'
import { repairFindings, reviewQuestionGuard, validateRepairPlans, type Finding } from './review'
import { createLocalWorkflowStore } from './store'
import { createV3Executor } from './execution'
import { BeeGameSessionManager } from '../session-manager'

async function startFixture(needsUserDecision = false, verifyWith: Finding['verifyWith'] = ['rule-tests']) {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-directed-review-'))
  await mkdir(join(root, 'reviews')); await writeFile(join(root,'rules.json'), '{"speed":4}'); await writeFile(join(root,'ui.json'),'{}')
  await writeFile(join(root,'package.json'), JSON.stringify({ scripts: { 'test:rules': 'bun -e "const r=await Bun.file(\'rules.json\').json();process.exit(r.speed===10?0:1)"' } }))
  const original = createRun({ projectId:'review',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Synthetic rule: use speed 10, with independent UI',constraints:{},ids:['req.loop'] })
  const producer: TaskSpec = { id:'owner',kind:'game.develop',goal:'Implement rule',dependsOn:[],requirementIds:['req.loop'],inputs:[],writablePaths:['rules.json'],expectedOutputs:['rules.json'],checks:['artifact-json'] }
  const inspect: TaskSpec = { id:'review',kind:'game.verify',goal:'Review actual rule',dependsOn:['owner'],requirementIds:['req.loop'],inputs:['output:owner/rules.json'],
    writablePaths:['reviews/**'],expectedOutputs:['reviews/first.json'],checks:['review-findings'],reviewReport:'reviews/first.json' }
  let run = publishPlan(original,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:original.requirements.revision,tasks:[producer,inspect,{...producer,id:'ui',writablePaths:['ui.json'],expectedOutputs:['ui.json']}]})
  async function complete(id:string) {
    const spec=run.tasks[id]!.spec, next=claimTask(run,{taskId:id,requestKey:id,workerId:'worker',sessionId:id,inputVersions:await bindInputs(run,spec)})
    run=finishTask(next,next.writer!.attemptId,next.fence,await runChecks(root,spec,next.attempts.at(-1)!.inputVersions),true)
  }
  await complete('owner'); await complete('ui')
  const version=await readVersion(root,'rules.json')
  const finding={id:'F1',requirementId:'req.loop',ownerTaskId:'owner',severity:'blocker' as const,sources:[{...version,quote:'{"speed":4}'}],impact:'Wrong gameplay speed',close:'Set confirmed speed and run rule test',verifyWith,needsUserDecision}
  const body={requirementsRevision:run.requirements.revision,planRevision:run.planRevision,findings:[finding],closed:[],limitations:['Synthetic semantic judgement; actual rule evidence still required']}
  await writeFile(join(root,'reviews/first.json'),JSON.stringify(body))
  const claimed=claimTask(run,{taskId:'review',requestKey:'review',workerId:'worker',sessionId:'review',inputVersions:await bindInputs(run,inspect)})
  run=finishTask(claimed,claimed.writer!.attemptId,claimed.fence,await runChecks(root,inspect,claimed.attempts.at(-1)!.inputVersions,undefined,{}, {run:claimed,attempt:claimed.attempts.at(-1)!}),true)
  const prior=run.attempts.at(-1)!
  const plan:Plan={...structuredClone(run.plans[0]!.plan),baseRevision:run.planRevision}
  plan.tasks[0]={...producer,goal:'Repair F1 with actual rule evidence',inputs:['rules.json'],repairOf:{attemptId:prior.attemptId,findingIds:['F1']},checks:[...verifyWith,'repair-verification']}
  plan.tasks[1]={...inspect,goal:'Directed recheck of F1 and repaired consumer',reviewOf:prior.attemptId,reviewReport:'reviews/second.json',expectedOutputs:['reviews/second.json']}
  return {root,run,prior,plan,original,finding,body}
}

test('source-backed review -> owner repair -> directed follow-up closes with actual evidence, preserving unrelated result/history',async()=>{
  const f=await startFixture()
  try {
    expect(f.run.tasks.review!.status).toBe('failed'); expect(f.prior.review!.findings[0]!.id).toBe('F1')
    let run=publishPlan(f.run,f.plan,await staleTaskIds(f.run)), spec=run.tasks.owner!.spec
    const ui=structuredClone(run.tasks.ui), history=structuredClone(run.attempts), originalReport=await Bun.file(join(f.root,'reviews/first.json')).text()
    const claimed=claimTask(run,{taskId:'owner',requestKey:'repair',workerId:'worker',sessionId:'repair',inputVersions:await bindInputs(run,spec)})
    await writeFile(join(f.root,'rules.json'),'{"speed":10}')
    const input=await settlementInputs(f.root,spec,claimed.attempts.at(-1)!.inputVersions)
    run=finishTask(claimed,claimed.writer!.attemptId,claimed.fence,await runChecks(f.root,spec,input,undefined,{}, {run:claimed,attempt:claimed.attempts.at(-1)!}),true)
    expect(run.tasks.owner!.status).toBe('succeeded'); expect(await staleTaskIds(run)).not.toContain('owner')
    const repaired=run.attempts.at(-1)!, source=await readVersion(f.root,'rules.json')
    await writeFile(join(f.root,'reviews/second.json'),JSON.stringify({requirementsRevision:run.requirements.revision,planRevision:run.planRevision,findings:[],
      closed:[{id:'F1',repairAttemptId:repaired.attemptId,sources:[{...source,quote:'{"speed":10}'}],observed:'Actual test:rules exit zero; directed requirement comparison agrees'}],limitations:['No aesthetics or full gameplay coverage']}))
    spec=run.tasks.review!.spec
    const reviewed=claimTask(run,{taskId:'review',requestKey:'recheck',workerId:'worker',sessionId:'recheck',inputVersions:await bindInputs(run,spec)})
    const result=await runChecks(f.root,spec,reviewed.attempts.at(-1)!.inputVersions,undefined,{}, {run:reviewed,attempt:reviewed.attempts.at(-1)!})
    const final=finishTask(reviewed,reviewed.writer!.attemptId,reviewed.fence,result,true)
    expect(final.tasks.review!.status).toBe('succeeded'); expect(final.tasks.ui).toEqual(ui)
    expect(final.attempts.slice(0,history.length)).toEqual(history)
    expect(await Bun.file(join(f.root,'reviews/first.json')).text()).toBe(originalReport)
    expect(final.deliveryEligible).toBe(false)
    const oldRuleCheck = reviewed.attempts.find(a=>a.attemptId===repaired.attemptId)!.checks!.find(c=>c.id==='rule-tests')!
    const originalVersion = oldRuleCheck.version
    oldRuleCheck.version = 'obsolete-rule-checker.0'
    const obsolete = await runChecks(f.root,spec,reviewed.attempts.at(-1)!.inputVersions,undefined,{}, {run:reviewed,attempt:reviewed.attempts.at(-1)!})
    expect(obsolete.checks[0]!.status).toBe('failed')
    expect(obsolete.checks[0]!.observation).toContain('stale')
    oldRuleCheck.version = originalVersion
    await writeFile(join(f.root,'package.json'),JSON.stringify({scripts:{'test:rules':'bun -e "process.exit(0)"'}}))
    const stale=await runChecks(f.root,spec,reviewed.attempts.at(-1)!.inputVersions,undefined,{}, {run:reviewed,attempt:reviewed.attempts.at(-1)!})
    expect(stale.checks[0]!.status).toBe('failed')
    expect(stale.checks[0]!.observation).toContain('stale')
  }finally{await rm(f.root,{recursive:true,force:true})}
})

test('review cannot fabricate quotes, silently drop prior blockers, or close without an accepted consumer-verified repair',async()=>{
  const f=await startFixture()
  try {
    const run=publishPlan(f.run,f.plan), spec=run.tasks.review!.spec
    // Bind current inputs as a standalone checker fixture, not a dependency success.
    const inputs=[await readVersion(f.root,'rules.json'),await readVersion(f.root,'reviews/first.json')]
    for(const mode of ['quote','omit','fake-repair'] as const){
      const report={requirementsRevision:run.requirements.revision,planRevision:run.planRevision,
        findings:mode==='quote'?[{...f.finding,sources:[{...f.finding.sources[0]!,quote:'nonexistent quote'}]}]:[],
        closed:mode==='fake-repair'?[{id:'F1',repairAttemptId:f.prior.attemptId,sources:f.finding.sources,observed:'claimed fixed'}]:[],limitations:['Fixture']}
      await writeFile(join(f.root,'reviews/second.json'),JSON.stringify(report))
      const attempt={...f.prior,taskId:'review',planRevision:run.planRevision}
      const checked=await runChecks(f.root,spec,inputs,undefined,{}, {run,attempt})
      expect(checked.checks[0]!.status).toBe('failed')
    }
  }finally{await rm(f.root,{recursive:true,force:true})}
})

test('repair authority uses historical owner scope, not a newly widened plan or source hash guess',async()=>{
  const f=await startFixture()
  try {
    const task={...f.plan.tasks[0]!,writablePaths:['rules.json','other/**'],expectedOutputs:['rules.json','other/game.json']}
    const run=publishPlan(f.run,{...f.plan,tasks:[task,...f.plan.tasks.slice(1)]})
    expect(()=>repairFindings(run,run.tasks.owner!.spec)).toThrow('write scope')
    expect(()=>validateRepairPlans(run)).toThrow('write scope')
    await writeFile(join(f.root,'rules.json'),'{"speed":5}')
    const valid=publishPlan(f.run,f.plan)
    await expect(bindInputs(valid,valid.tasks.owner!.spec)).rejects.toThrow('Finding source changed')
  }finally{await rm(f.root,{recursive:true,force:true})}
})

test('pending decision and failed rule evidence remain unverified',async()=>{
  for(const decision of [false,true]){
    const f=await startFixture(decision)
    try {
      const run=publishPlan(f.run,f.plan),spec=run.tasks.owner!.spec
      const claimed=claimTask(run,{taskId:'owner',requestKey:'repair',workerId:'worker',sessionId:'repair',inputVersions:await bindInputs(run,spec)})
      const checked=await runChecks(f.root,spec,claimed.attempts.at(-1)!.inputVersions,undefined,{}, {run:claimed,attempt:claimed.attempts.at(-1)!})
      expect(checked.checks.find(check=>check.id==='repair-verification')!.status).toBe('unverified')
      expect(checked.checks.find(check=>check.id==='rule-tests')!.status).toBe('failed')
    }finally{await rm(f.root,{recursive:true,force:true})}
  }
})

test('valid JSON and even an answered decision do not prove semantic/consumer closure',async()=>{
  for(const answered of [false,true]){
    const f=await startFixture(answered,['artifact-json'])
    try{
      const run=publishPlan(f.run,f.plan),spec=run.tasks.owner!.spec
      const claimed=claimTask(run,{taskId:'owner',requestKey:'repair',workerId:'worker',sessionId:'repair',inputVersions:await bindInputs(run,spec)})
      await writeFile(join(f.root,'rules.json'),'{"speed":10}')
      const attempt=claimed.attempts.at(-1)!, inputs=await settlementInputs(f.root,spec,attempt.inputVersions)
      const checked=await runChecks(f.root,spec,inputs,undefined,{}, {run:claimed,attempt,decisions:answered?[{toolUseID:'synthetic-answer',findingIds:['F1'],requirementsRevision:run.requirements.revision,planRevision:run.planRevision,sources:f.finding.sources,answers:{choice:'10'}}]:[]})
      expect(checked.checks.find(c=>c.id==='artifact-json')!.status).toBe('passed')
      expect(checked.checks.find(c=>c.id==='repair-verification')!.status).toBe('unverified')
      expect(checked.checks.find(c=>c.id==='repair-verification')!.observation).toContain('No actual close verification')
    }finally{await rm(f.root,{recursive:true,force:true})}
  }
})

test('finding-bound question rejects wrong headers and answers after pause',async()=>{
  const f=await startFixture(true)
  try{
    let run=publishPlan(f.run,f.plan)
    run=claimTask(run,{taskId:'owner',requestKey:'repair',workerId:'worker',sessionId:'repair',inputVersions:await bindInputs(run,run.tasks.owner!.spec)})
    const store: Parameters<typeof reviewQuestionGuard>[2]={async read(){return run}}
    const guard=reviewQuestionGuard(run,run.attempts.at(-1)!,store)
    await expect(guard({toolUseID:'q',input:{questions:[{header:'unrelated',question:'Choose?'}]}})).rejects.toThrow('headers')
    const request={toolUseID:'q',input:{questions:[{header:'F1',question:'Choose?'}]}}
    expect(await guard(request)).toMatchObject({findingIds:['F1']})
    run={...run,paused:{at:new Date().toISOString()}}
    await expect(guard(request,{source:'user',updatedInput:{...request.input,answers:{'Choose?':'10'}}})).rejects.toThrow('no longer owns')
  }finally{await rm(f.root,{recursive:true,force:true})}
})

test('real BGS question waits for user; changed sources deny a late answer before it reaches the repair runner',async()=>{
  for(const stale of [false,true]){
    const f=await startFixture(true),store=createLocalWorkflowStore(join(f.root,'host'))
    let received='',submits=0
    const sessions=new BeeGameSessionManager({async start(start){return {stop(){},async submit(turn){
      submits++
      const answer=await turn.requestPermission({toolUseID:'question-F1',toolName:'AskUserQuestion',message:'Select confirmed F1 resolution',input:{questions:[{header:'F1',question:'Use the confirmed speed 10?',options:[{label:'10'},{label:'Stop'}]}]}})
      received=answer.behavior
      if(answer.behavior==='allow')await writeFile(join(start.cwd,'rules.json'),'{"speed":10}')
      await turn.onMessage({type:'result',subtype:'success',result:'Finished authorized work'})
    }}}},join(f.root,'native'),async()=>({}),{},true)
    const executor=createV3Executor({store,sessions})
    try{
      // Persist each existing monotonic snapshot without altering its identity.
      await store.commit(f.run.projectId,f.run.ownerId,0,f.original,'created')
      let current=f.original
      current=publishPlan(current,f.run.plans[0]!.plan)
      await store.commit(current.projectId,current.ownerId,1,current,'planned')
      // Use the verified prior history as fixture state, preserving consecutive version.
      const history={...f.run,version:current.version+1}
      await store.commit(current.projectId,current.ownerId,current.version,history,'fixture.reviewed')
      const run=publishPlan(history,{...f.plan,baseRevision:history.planRevision})
      await store.commit(run.projectId,run.ownerId,history.version,run,'repair.authorized')
      await executor.start(run,'owner','repair',{})
      let permission
      for(let i=0;i<150;i++){permission=sessions.pendingPermissionsForProject(run.ownerId,run.projectId,f.root)[0];if(permission)break;await Bun.sleep(10)}
      expect(permission).toBeDefined(); expect(received).toBe('')
      if(stale)await writeFile(join(f.root,'rules.json'),'{"speed":5}')
      sessions.resolvePermission(permission!.sessionId,permission!.toolUseID,{behavior:'allow',answers:{'Use the confirmed speed 10?':'10'}})
      for(let i=0;i<150 && (await store.read(run.projectId,run.ownerId))?.writer;i++)await Bun.sleep(10)
      const result=(await store.read(run.projectId,run.ownerId))!
      expect(received).toBe(stale?'deny':'allow');expect(submits).toBe(1)
      expect(result.tasks.owner!.status).toBe(stale?'failed':'succeeded')
      if(!stale)expect(result.attempts.at(-1)!.decisions?.[0]?.findingIds).toEqual(['F1'])
      else expect(sessions.transcript(permission!.sessionId).some(event=>event.type==='workflow.question.rejected')).toBe(true)
    }finally{await executor.dispose();await sessions.dispose();await rm(f.root,{recursive:true,force:true})}
  }
})
