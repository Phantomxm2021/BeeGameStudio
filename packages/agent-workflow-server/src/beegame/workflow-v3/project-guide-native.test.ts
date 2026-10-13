import {test,expect} from 'bun:test'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createNativeCliProcessRunner} from '../native-cli-process-runner'
import {readProjectGuide,projectGuideContext} from './project-guide'
import {agentProfessionalContext} from './agent-goal'
import {projectExecutionAccess} from '../project-execution-access'
import {createRun,type AgentTurn} from './state'
import {createLocalWorkflowStore} from './store'
import {createAgentMeasurement} from './agent-measurement'
import {openAgentTools} from './agent-tools'

// Real parent/child CLI, controlled provider only. Tests transport and input
// size, not whether a real model reasons correctly or chooses these tools.
test('root guide reaches native child without project settings/hooks or duplicated user history; resume refreshes it',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-guide-native-'))),workspace=join(root,'game')
  await mkdir(workspace);await mkdir(join(workspace,'.claude/rules'),{recursive:true})
  await writeFile(join(workspace,'entry.txt'),'Actual synthetic entry')
  await writeFile(join(workspace,'.claude/CLAUDE.md'),'UNREQUESTED_NESTED_GUIDE')
  await writeFile(join(root,'CLAUDE.md'),'UNREQUESTED_PARENT_GUIDE')
  await writeFile(join(workspace,'.claude/rules/extra.md'),'UNREQUESTED_PROJECT_RULE')
  await writeFile(join(workspace,'extra.md'),'UNREQUESTED_INCLUDE_CONTENT')
  await writeFile(join(workspace,'.claude/settings.json'),JSON.stringify({
    hooks:{Stop:[{hooks:[{type:'command',command:'touch PROJECT_HOOK_RAN'}]}]},
  }))
  const requests:any[]=[],metrics:any[]=[]
  let phase=0,parentCount=0,childCount=0,nativeId:string|undefined,handoffEntry=''
  const nativeIds:string[]=[]
  const abort=new AbortController(),frame=(event:any)=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n'
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    if(!path.endsWith('/messages'))return new Response('',{status:404})
    const body:any=await request.json()
    const isChild=body.messages.some((m:any)=>m.role==='user' && Array.isArray(m.content) &&
      m.content.some((b:any)=>b.type==='text' && b.text.includes('CHILD_GUIDE_PROBE')))
    requests.push({phase,isChild,body})
    const call=isChild ? (childCount++===0?{name:'Bash',input:{command:'bun '+JSON.stringify(handoffEntry)+' --details',description:'Read current authorized task, not a previous fix list'}}:
      childCount===2?{name:'Read',input:{file_path:'entry.txt'}}:null) :
      (parentCount++===0?{name:'Agent',input:{description:'Inspect actual entry',subagent_type:'general-purpose',
        prompt:'CHILD_GUIDE_PROBE Read entry.txt in this project and report its actual content. Project navigation is CLAUDE.md.'}}:null)
    return new Response(frame({type:'message_start',message:{id:'offline-guide-'+requests.length,type:'message',
      role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'guide-tool-'+requests.length,name:call.name,input:{}}:{type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Synthetic entry observed; not game acceptance.'}})+
      frame({type:'content_block_stop',index:0})+
      frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
      frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
  }})
  let runtime:Awaited<ReturnType<ReturnType<typeof createNativeCliProcessRunner>['start']>>|undefined
  let tools:Awaited<ReturnType<typeof openAgentTools>>|undefined
  let measurement:ReturnType<typeof createAgentMeasurement>|undefined
  const timer=setTimeout(()=>abort.abort('offline test timeout'),45000)
  const env={BEEGAME_CONFIG_DIR:join(root,'config'),BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_API_KEY:'offline',
    ANTHROPIC_BASE_URL:server.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',BGS_DEFAULT_FAST_MODEL:'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}
  try {
    const access=await projectExecutionAccess({workspacePath:workspace,sessionId:'guide-native',environment:env})
    expect(access.flags.slice(0,2)).toEqual(['--setting-sources','user'])
    expect(access.settings).not.toHaveProperty('hooks')
    for(phase=0;phase<2;phase++) {
      parentCount=0;childCount=0
      const marker='ROOT_GUIDE_ROUTE_'+phase
      const text='# Project navigation\nRoute: '+marker+'\nEntry: entry.txt\n@extra.md\n'
      await writeFile(join(workspace,'CLAUDE.md'),text)
      const guide=await readProjectGuide(workspace),reference=projectGuideContext(guide)
      const systemContext=agentProfessionalContext+'\n\n'+reference
      const task='PARENT_WORK_ONLY CURRENT_FULL_ACCEPTANCE_'+phase+' Inspect all design domains, professional methods and complete player flow; preserve existing entry.'
      const store=createLocalWorkflowStore(join(root,'host')),run=createRun({projectId:'guide-task-'+phase,ownerId:'owner',workspacePath:workspace,
        chatSessionId:'guide-native',requestKey:'task-'+phase,text:'Original synthetic goal',constraints:{},ids:['goal']})
      const turn:AgentTurn={attemptId:'attempt-'+phase,requestKey:run.requestKey,sessionId:run.chatSessionId,workerId:'offline',fence:1,
        status:'running',startedAt:new Date().toISOString(),requirementsRevision:run.requirements.revision,
        message:{requestKey:run.requestKey,runId:run.id,chatSessionId:run.chatSessionId,expectedVersion:1,
          requirementsRevision:run.requirements.revision,intent:'work',text:task}}
      run.agentTurns=[turn];run.fence=1;run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:turn.fence}
      await store.commit(run.projectId,run.ownerId,0,run,'synthetic-task')
      measurement=createAgentMeasurement({run,turn,store})
      tools=await openAgentTools({workspacePath:workspace,sessionId:run.chatSessionId,getAuthToken:()=>undefined,measurement})
      handoffEntry=join(workspace,tools.directory,'handoff.mjs')
      runtime=await createNativeCliProcessRunner().start({sessionId:'guide-native',cwd:workspace,env,systemContext,
        ...(nativeId?{resumeSessionId:nativeId}:{}),onNativeSessionId:id=>{nativeId=id;nativeIds.push(id)}})
      await runtime.submit({prompt:task,
        signal:abort.signal,onMessage:()=>{},requestPermission:async()=>({behavior:'allow'})})
      await runtime.dispose?.();runtime=undefined;await tools.close();tools=undefined
      await measurement.close();measurement=undefined
      const stopped=(await store.read(run.projectId,run.ownerId))!
      stopped.agentTurns![0]!.quiescedAt=new Date().toISOString();stopped.agentTurns![0]!.nativeSessionId=nativeId
      stopped.version++;await store.commit(stopped.projectId,stopped.ownerId,stopped.version-1,stopped,'synthetic-observed-exit')
      const settled=(await store.read(run.projectId,run.ownerId))!
      settled.agentTurns![0]!.status='ended';settled.agentTurns![0]!.finishedAt=new Date().toISOString()
      delete settled.writer;settled.version++
      await store.commit(settled.projectId,settled.ownerId,settled.version-1,settled,'synthetic-settled')
      const current=requests.filter(r=>r.phase===phase)
      expect(current).toHaveLength(5)
      expect(current.filter(r=>r.isChild)).toHaveLength(3)
      for(const {body,isChild} of current) {
        const system=JSON.stringify(body.system),messages=JSON.stringify(body.messages)
        expect(system.split(marker)).toHaveLength(2)
        expect(messages).not.toContain('ROOT_GUIDE_ROUTE_')
        for(const forbidden of ['UNREQUESTED_PARENT_GUIDE','UNREQUESTED_NESTED_GUIDE','UNREQUESTED_PROJECT_RULE','UNREQUESTED_INCLUDE_CONTENT'])
          expect(system+messages).not.toContain(forbidden)
        if(phase===1)expect(system).not.toContain('ROOT_GUIDE_ROUTE_0')
      }
      const children=current.filter(r=>r.isChild)
      expect(JSON.stringify(children[0].body.messages)).not.toContain('PARENT_WORK_ONLY') // no parent history inheritance
      expect(JSON.stringify(children[1].body.messages)).toContain(task) // literal task read through the existing bridge
      expect(JSON.stringify(children[1].body.messages)).toContain('agent-task-evidence-handoff')
      expect(JSON.stringify(children[1].body.messages)).toContain('currentTurnUses')
      expect(JSON.stringify(children[1].body.messages)).toContain('not-recorded-yet')
      metrics.push({phase,guideBytes:Buffer.byteLength(text),referenceChars:reference.length,
        systemContextAddedChars:systemContext.length-agentProfessionalContext.length,
        parentRequests:2,childRequests:3,userHistoryGuideCopies:0,
        firstParentSystemChars:JSON.stringify(current[0].body.system).length,
        firstChildSystemChars:JSON.stringify(current.find(r=>r.isChild)!.body.system).length})
    }
    expect(nativeId).toMatch(/^[a-f0-9-]{36}$/)
    expect(new Set(nativeIds).size).toBe(1)
    expect(await Bun.file(join(workspace,'PROJECT_HOOK_RAN')).exists()).toBe(false)
    expect(await readFile(join(workspace,'entry.txt'),'utf8')).toBe('Actual synthetic entry')
    console.log(JSON.stringify({projectGuideNative:true,requests:requests.length,metrics,paidModelCalls:0,
      limits:['controlled-model','ordinary-same-workspace-child','not-autonomous-selection','not-real-token-savings']}))
  }finally{
    clearTimeout(timer);await runtime?.dispose?.();await tools?.close();await measurement?.close()
    server.stop(true);await rm(root,{recursive:true,force:true})
  }
},50000)
