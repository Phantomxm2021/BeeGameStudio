import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createAgentWorkflowApp } from '../../app'
import { createLocalWorkflowStore, type WorkflowStore } from './store'
import { publishPlan, claimTask, finishTask, V3_PROTOCOL, type Run, type TaskSpec } from './state'
import { bindInputs, runChecks, readVersion } from './checks'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'

test('standalone debug answers real BGS permissions with source guard, denial/pause, and evidence-only recovery',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-debug-question-'))),browser=createPreviewTestBrowser()
  const prior=process.env.BEEGAME_WORKFLOW_V3_DEBUG;process.env.BEEGAME_WORKFLOW_V3_DEBUG='1'
  const base=createLocalWorkflowStore(join(root,'host')), cleanups:(()=>void|Promise<void>)[]=[], decisions:Record<string,any>={}
  let calls=0,child:ReturnType<typeof Bun.spawn>|undefined,server:ReturnType<typeof Bun.serve>|undefined
  const store:WorkflowStore={read:base.read,async commit(p,a,v,r,event){if(p==='recover'&&event==='attempt.settled')throw Error('Synthetic settlement failure');await base.commit(p,a,v,r,event)}}
  const app=createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:join(root,'projects'),workflowV3Store:store,modelConfigStore:false,skillsConfig:false,
    currentUserResolver:request=>request.headers.get('Authorization')==='Bearer synthetic-owner'?{id:'owner',role:'owner'}:undefined,
    registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(input){return{stop(){},async dispose(){},async submit(turn){
      calls++;const id=basename(input.cwd)
      if(id!=='recover'){
        const decision=await turn.requestPermission({toolUseID:'question-'+id,toolName:'AskUserQuestion',message:'Synthetic actual pending native question',
          input:{questions:[{header:'F1',question:'Choose fixture speed?',multiSelect:false,options:[{label:'10',description:'Use ten'},{label:'12',description:'Use twelve'}]}]}})
        decisions[id]=decision
        if(decision.behavior==='allow')await writeFile(join(input.cwd,'rules.json'),'{"speed":10}')
      }
      await turn.onMessage({type:'result',subtype:'success',result:'Synthetic native result, not semantic quality evidence'})
    }}}}})
  const api=async(path:string,method='GET',body?:unknown)=>{
    const response=await app.request('http://localhost'+path,{method,headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
    const value=await response.json();expect(response.status,JSON.stringify(value)).toBeLessThan(300);return value as any
  }
  try {
    await api('/api/model-configs','POST',{name:'Offline',provider:'openai-compatible',apiKey:'fake',models:{balanced:'fake'},isDefault:true})
    for(const id of ['answered','denied','stale','paused','recover','unknown']){
      const workspace=join(root,'projects','users','owner',id);await mkdir(join(workspace,'reviews'),{recursive:true})
      await writeFile(join(workspace,'rules.json'),'{"speed":4}');await writeFile(join(workspace,'notes.json'),'{}')
      await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{'test:rules':'bun -e "process.exit(JSON.parse(await Bun.file(\'rules.json\').text()).speed===10?0:1)"'}}))
      await api('/api/projects','POST',{id,name:'Synthetic '+id,root_path:workspace,created_at:Date.now()})
      const chat=(await api('/api/projects/'+id+'/session/ensure','POST',{})).session
      let run:Run=(await api('/api/projects/'+id+'/workflow-v3/runs','POST',{chatSessionId:chat.id,requestKey:'run',requirements:{text:'Synthetic fixture: user chooses speed 10 or 12; preserve notes',constraints:{},ids:['req.play']}})).run
      const owner:TaskSpec={id:'owner',kind:'game.develop',goal:'Rules',dependsOn:[],requirementIds:['req.play'],inputs:[],writablePaths:['rules.json'],expectedOutputs:['rules.json'],checks:['artifact-json']}
      const review:TaskSpec={id:'review',kind:'game.verify',goal:'Review',dependsOn:['owner'],requirementIds:['req.play'],inputs:['output:owner/rules.json'],writablePaths:['reviews/**'],expectedOutputs:['reviews/first.json'],checks:['review-findings'],reviewReport:'reviews/first.json'}
      run=(await api('/api/projects/'+id+'/workflow-v3/plan','PUT',{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:run.requirements.revision,tasks:[owner,review,{...owner,id:'notes',writablePaths:['notes.json'],expectedOutputs:['notes.json']}]})).run
      async function complete(taskId:string){
        const task=run.tasks[taskId]!.spec,claimed=claimTask(run,{taskId,requestKey:taskId,workerId:'synthetic',sessionId:taskId,inputVersions:await bindInputs(run,task)})
        await base.commit(id,'owner',run.version,claimed,'fixture.claimed')
        const attempt=claimed.attempts.at(-1)!,finished=finishTask(claimed,attempt.attemptId,attempt.fence,await runChecks(workspace,task,attempt.inputVersions,undefined,{}, {run:claimed,attempt}),true)
        await base.commit(id,'owner',claimed.version,finished,'fixture.checked');run=finished
      }
      await complete('owner');await complete('notes')
      if(['recover','unknown'].includes(id)){
        const plan=publishPlan(run,{...run.plans.at(-1)!.plan,baseRevision:run.planRevision,tasks:[{...owner,goal:'Explicitly revised fixture rule'},review,run.tasks.notes!.spec]})
        await base.commit(id,'owner',run.version,plan,'fixture.replanned');run=plan
        if(id==='unknown'){
          const claimed=claimTask(run,{taskId:'owner',requestKey:'old',workerId:'lost',sessionId:'missing',inputVersions:[]})
          await base.commit(id,'owner',run.version,claimed,'fixture.claimed');continue
        }
      }else{
        const source=await readVersion(workspace,'rules.json')
        await writeFile(join(workspace,'reviews/first.json'),JSON.stringify({requirementsRevision:run.requirements.revision,planRevision:run.planRevision,
          findings:[{id:'F1',requirementId:'req.play',ownerTaskId:'owner',severity:'blocker',sources:[{...source,quote:'{"speed":4}'}],impact:'Speed must be chosen',close:'Ask real user then verify rule',verifyWith:['rule-tests'],needsUserDecision:true}],closed:[],limitations:['Synthetic finding judgement']}))
        await complete('review')
        const previous=run.attempts.at(-1)!,next=publishPlan(run,{...run.plans.at(-1)!.plan,baseRevision:run.planRevision,tasks:[
          {...owner,inputs:['rules.json'],repairOf:{attemptId:previous.attemptId,findingIds:['F1']},checks:['rule-tests','repair-verification']},review,run.tasks.notes!.spec]})
        await base.commit(id,'owner',run.version,next,'fixture.repair-plan');run=next
      }
      await api('/api/projects/'+id+'/workflow-v3/tasks/owner/execute','POST',{requestKey:'once',planRevision:run.planRevision})
    }
    server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
      // Deterministic concurrent source edit ONLY inside this synthetic fixture,
      // immediately before the normal production permission route runs.
      if(new URL(request.url).pathname==='/api/projects/stale/permissions/question-stale'&&request.method==='POST')
        await writeFile(join(root,'projects/users/owner/stale/rules.json'),'{"speed":6}')
      return app.fetch(request)
    }})
    const {endpoint}=await browser.start(),node=Bun.which('node');if(!node)throw Error('Node required')
    const driver=Bun.spawn([node,fileURLToPath(new URL('./debug-question-browser.mjs',import.meta.url))],{env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
    child=driver
    driver.stdin.write(JSON.stringify({endpoint,origin:server.url.origin}));driver.stdin.end()
    const timer=setTimeout(()=>child?.kill(),45000)
    const [output,errors,code]=await Promise.all([new Response(driver.stdout).text(),new Response(driver.stderr).text(),driver.exited]);clearTimeout(timer)
    expect(code,errors).toBe(0);expect(JSON.parse(output).passed).toBe(true)
    expect(calls).toBe(5);expect(decisions.answered).toMatchObject({behavior:'allow',updatedInput:{answers:{'Choose fixture speed?':'10'}}})
    for(const id of ['denied','stale','paused'])expect(decisions[id]?.behavior).toBe('deny')
    expect(await readFile(join(root,'projects/users/owner/answered/rules.json'),'utf8')).toBe('{"speed":10}')
    expect(await readFile(join(root,'projects/users/owner/stale/rules.json'),'utf8')).toBe('{"speed":6}')
    for(const id of ['answered','denied','stale','paused','recover','unknown']){
      expect((await base.read(id,'owner'))!.tasks.notes!.status).toBe('succeeded')
      expect(await readFile(join(root,'projects/users/owner',id,'notes.json'),'utf8')).toBe('{}')
    }
    await Promise.all(cleanups.splice(0).map(fn=>fn()))
    const reloaded=createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:join(root,'projects'),
      workflowV3Store:createLocalWorkflowStore(join(root,'host')),modelConfigStore:false,skillsConfig:false,
      currentUserResolver:request=>request.headers.get('Authorization')==='Bearer synthetic-owner'?{id:'owner',role:'owner'}:undefined,
      registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(){throw Error('History read cannot execute a native task')}}})
    const history=await reloaded.request('http://localhost/api/projects/answered/workflow-v3/questions',{headers:{Authorization:'Bearer synthetic-owner'}})
    expect(history.status).toBe(200)
    const retained=await history.json() as any
    expect(retained.questions).toEqual([])
    expect(retained.decisions.some((d:any)=>d.type==='workflow.question.validated'&&d.payload.answers['Choose fixture speed?']==='10')).toBe(true)
  }finally{
    if(prior===undefined)delete process.env.BEEGAME_WORKFLOW_V3_DEBUG;else process.env.BEEGAME_WORKFLOW_V3_DEBUG=prior
    if(child?.exitCode===null){child.kill();await child.exited}
    await Promise.all(cleanups.map(fn=>fn()));server?.stop(true);await browser.close();await rm(root,{recursive:true,force:true})
  }
},60000)
