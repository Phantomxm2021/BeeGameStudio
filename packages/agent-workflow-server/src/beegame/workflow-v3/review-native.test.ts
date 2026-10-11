import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type TaskSpec, type Run } from './state'
import { bindInputs, runChecks, readVersion } from './checks'
import { createLocalWorkflowStore } from './store'
import { createV3Executor } from './execution'
import { BeeGameSessionManager } from '../session-manager'
import { createNativeCliProcessRunner } from '../native-cli-process-runner'
import { taskContext } from './context'
import { recordPreviewIssue } from './preview-issues'

// Actual native Read/Skill/AskUserQuestion/Write and host process checks.
// Deterministic local provider tests protocol, NOT LLM review competence.
test('real CLI Preview observation review -> source-bound user question/owner repair -> remeasured follow-up, without legacy business flags', async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-review-native-')))
  await mkdir(join(root,'reviews')); await writeFile(join(root,'rules.json'),'{"lives":1}');await writeFile(join(root,'ui.json'),'{}')
  await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'<html><body>Native protocol fixture only</body></html>')
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{'test:rules':'bun -e "const r=await Bun.file(\'rules.json\').json();process.exit(r.lives===3?0:1)"'}}))
  const store=createLocalWorkflowStore(join(root,'host'))
  let stage:'inspect'|'repair'|'recheck'='inspect',calls=0,questionCount=0
  let previousId='',repairId='',issueId=''
  const requests:any[]=[]
  const frame=(event:any)=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  const provider=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    if(!path.endsWith('/messages'))return new Response('',{status:404})
    const body:any=await request.json();requests.push(body);calls++
    let call:{name:string;input:unknown}|undefined
    if(calls===1)call=stage==='repair'?{name:'AskUserQuestion',input:{questions:[{header:'F1',question:'Use 3 lives for this fixture?',multiSelect:false,
      options:[{label:'3',description:'Use three lives'},{label:'5',description:'Use five lives'}]}]}}:{name:'Skill',input:{skill:'bgs-builtins:gameplay-programmer'}}
    else if(calls===2)call={name:'Read',input:{file_path:join(root,'rules.json')}}
    else if(calls===3){
      const run=(await store.read('native-review','owner'))!, source=await readVersion(root,'rules.json'),quote=await readFile(join(root,'rules.json'),'utf8')
      const report={requirementsRevision:run.requirements.revision,planRevision:run.planRevision,
        findings:stage==='inspect'?[{id:'F1',requirementId:'req.lives',ownerTaskId:'owner',severity:'blocker',sources:[{...source,quote}],
          impact:'One life is outside the confirmed selectable options',close:'Ask user, then implement chosen value and check actual rules',verifyWith:['rule-tests'],needsUserDecision:true}]:[],
        closed:stage==='recheck'?[{id:'F1',repairAttemptId:repairId,sources:[{...source,quote}],observed:'Current rule matches the retained user answer and actual host rule check'}]:[],
        observations:[{id:issueId,disposition:'finding',findingIds:['F1'],reason:'Inspected actual saved rule against confirmed selectable lives; synthetic judgement'}],
        limitations:['Synthetic provider judgement, not proof of model quality or full game coverage']}
      call={name:'Write',input:{file_path:join(root,stage==='repair'?'rules.json':stage==='inspect'?'reviews/first.json':'reviews/second.json'),content:stage==='repair'?'{"lives":3}':JSON.stringify(report)}}
    }
    return new Response(frame({type:'message_start',message:{id:'fixture-'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'tool-'+requests.length,name:call.name,input:{}}:{type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Saved actual fixture result.'}})+
      frame({type:'content_block_stop',index:0})+frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
  }})
  const sessions=new BeeGameSessionManager(createNativeCliProcessRunner(),join(root,'host'),async()=>({BEEGAME_CONFIG_DIR:join(root,'config'),BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_AUTH_TOKEN:'offline',
    ANTHROPIC_BASE_URL:`http://127.0.0.1:${provider.port}`,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}),{},true)
  const executor=createV3Executor({store,sessions})
  const off=sessions.subscribeProjectEvents({userId:'owner',projectId:'native-review',workspacePath:root},event=>{
    if(event.type!=='permission.requested')return
    const p=sessions.pendingPermissionsForProject('owner','native-review',root).at(-1)
    if(!p)return
    if(p.toolName==='AskUserQuestion'){
      expect(event.payload?.workflowQuestion).toMatchObject({findingIds:['F1']})
      questionCount++;sessions.resolvePermission(p.sessionId,p.toolUseID,{behavior:'allow',answers:{'Use 3 lives for this fixture?':'3'}})
    }else sessions.resolvePermission(p.sessionId,p.toolUseID,{behavior:['Read','Write','Skill'].includes(p.toolName)?'allow':'deny',scope:'once'})
  })
  const timer=setTimeout(()=>{void sessions.dispose()},25000)
  try{
    const original=createRun({projectId:'native-review',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Synthetic fixture: user must choose 3 or 5 lives; preserve the independent UI',constraints:{},ids:['req.lives']})
    await store.commit(original.projectId,original.ownerId,0,original,'created')
    const owner:TaskSpec={id:'owner',kind:'game.develop',goal:'Implement chosen lives',dependsOn:[],requirementIds:['req.lives'],inputs:[],writablePaths:['rules.json'],expectedOutputs:['rules.json'],checks:['artifact-json']}
    let review:TaskSpec={id:'review',kind:'game.verify',goal:'Review selectable lives source',dependsOn:['owner','build'],requirementIds:['req.lives'],inputs:['output:owner/rules.json'],writablePaths:['reviews/**'],expectedOutputs:['reviews/first.json'],checks:['review-findings'],reviewReport:'reviews/first.json',skills:['bgs-builtins:gameplay-programmer']}
    const build:TaskSpec={id:'build',kind:'game.develop',goal:'Measure static protocol fixture',dependsOn:['owner'],requirementIds:['req.lives'],inputs:['rules.json'],writablePaths:['dist/**'],expectedOutputs:['dist/index.html'],checks:['runtime-smoke'],runtimeArtifact:'dist'}
    let run=publishPlan(original,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:original.requirements.revision,tasks:[owner,review,{...owner,id:'ui',writablePaths:['ui.json'],expectedOutputs:['ui.json']},build]})
    await store.commit(run.projectId,run.ownerId,original.version,run,'planned')
    // Pre-existing synthetic producer results are actual parsed files, not native author tests.
    for(const id of ['owner','ui','build']){
      const claimed=claimTask(run,{taskId:id,requestKey:id,workerId:'fixture',sessionId:id,inputVersions:await bindInputs(run,run.tasks[id]!.spec)})
      await store.commit(run.projectId,run.ownerId,run.version,claimed,'claimed')
      const finished=finishTask(claimed,claimed.writer!.attemptId,claimed.fence,await runChecks(root,claimed.tasks[id]!.spec,claimed.attempts.at(-1)!.inputVersions),true)
      await store.commit(run.projectId,run.ownerId,claimed.version,finished,'settled');run=finished
    }
    const measured=run.attempts.at(-1)!
    const recorded=await recordPreviewIssue(run,{requestKey:'native-issue',taskId:'build',attemptId:measured.attemptId,planRevision:run.planRevision,
      artifactSha256:measured.checks![0]!.artifacts![0]!.sha256,requirementIds:['req.lives'],steps:'Read life count',expected:'User-selected 3 or 5',observed:'Saved rule is 1'},false)
    issueId=recorded.issue.id;await store.commit(run.projectId,run.ownerId,run.version,recorded.run,'preview.observed');run=recorded.run
    review={...review,previewIssues:[issueId]}
    const observedPlan=publishPlan(run,{...run.plans.at(-1)!.plan,baseRevision:run.planRevision,tasks:[owner,review,run.tasks.ui!.spec,build]})
    await store.commit(run.projectId,run.ownerId,run.version,observedPlan,'preview.review-authorized');run=observedPlan
    const ui=structuredClone(run.tasks.ui)
    async function wait(){for(let n=0;n<2500;n++){const value=(await store.read(run.projectId,run.ownerId))!;if(!value.writer)return value;await Bun.sleep(10)}throw new Error('Native workflow fixture did not settle')}
    await executor.start(run,'review','inspect',{});run=await wait()
    expect(run.tasks.review!.status).toBe('failed');previousId=run.attempts.at(-1)!.attemptId
    const originalReport=await readFile(join(root,'reviews/first.json'),'utf8')
    const plan={...structuredClone(run.plans.at(-1)!.plan),baseRevision:run.planRevision}
    plan.tasks[0]={...owner,goal:'Repair F1 after actual user decision',inputs:['rules.json'],checks:['rule-tests','repair-verification'],repairOf:{attemptId:previousId,findingIds:['F1']}}
    plan.tasks[1]={...review,goal:'Directed recheck after owner repair',reviewOf:previousId,reviewReport:'reviews/second.json',expectedOutputs:['reviews/second.json']}
    const next=publishPlan(run,plan);await store.commit(run.projectId,run.ownerId,run.version,next,'repair.plan');run=next
    stage='repair';calls=0;await executor.start(run,'owner','repair',{});run=await wait()
    expect(run.tasks.owner!.status).toBe('succeeded');repairId=run.attempts.at(-1)!.attemptId
    expect(run.attempts.at(-1)!.decisions?.[0]?.findingIds).toEqual(['F1'])
    expect(run.attempts.at(-1)!.checks?.find(c=>c.id==='rule-tests')?.observation).toContain('exit 0')
    const followupContext=taskContext(run,{...run.attempts.at(-1)!,taskId:'review'})
    expect(followupContext).toContain(repairId)
    expect(followupContext).toContain('Use 3 lives for this fixture?')
    expect(followupContext).toContain('"3"')
    expect(followupContext).toContain(issueId)
    expect(followupContext).toContain('Saved user Preview observations')
    const claimedBuild=claimTask(run,{taskId:'build',requestKey:'remeasure',workerId:'fixture',sessionId:'build',inputVersions:await bindInputs(run,build)})
    await store.commit(run.projectId,run.ownerId,run.version,claimedBuild,'build.claimed')
    const remeasured=finishTask(claimedBuild,claimedBuild.writer!.attemptId,claimedBuild.fence,await runChecks(root,build,claimedBuild.attempts.at(-1)!.inputVersions),true)
    await store.commit(run.projectId,run.ownerId,claimedBuild.version,remeasured,'build.remeasured');run=remeasured
    stage='recheck';calls=0;await executor.start(run,'review','recheck',{});run=await wait()
    expect(run.tasks.review!.status).toBe('succeeded');expect(run.tasks.ui).toEqual(ui);expect(questionCount).toBe(1)
    expect(await readFile(join(root,'reviews/first.json'),'utf8')).toBe(originalReport)
    const nativeAttempts=run.attempts.filter(a=>['review','owner'].includes(a.taskId) && a.nativeSessionId)
    expect(new Set(nativeAttempts.map(a=>a.nativeSessionId)).size).toBe(3)
    for(const attempt of nativeAttempts){expect(attempt.usage).toBeDefined();expect(attempt.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/)}
    expect(requests).toHaveLength(12)
    expect(JSON.stringify(requests)).not.toContain('beegame_direction_authors')
    expect(run.deliveryEligible).toBe(false)
  }finally{clearTimeout(timer);off();await executor.dispose();await sessions.dispose();provider.stop(true);await rm(root,{recursive:true,force:true})}
},30000)
