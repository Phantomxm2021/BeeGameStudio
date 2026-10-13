import {test,expect} from 'bun:test'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {randomBytes} from 'node:crypto'
import {createAgentWorkflowApp} from '../../app'
import {createNativeCliProcessRunner,nativeRuntimeEnvironment} from '../native-cli-process-runner'
import {createPreviewTestBrowser} from '../preview-test-browser'
import {sharedPlaywright} from '../shared-playwright'
import {createLocalWorkflowStore,type WorkflowStore} from './store'

// Test-owned temporary project/browser only. Actual CLI and tool permissions;
// controlled loopback responses prove transport, not model/game quality.
for(const recoverAfterRestart of [false,true])test('independent debug explicitly authorizes first native work after no-start and recovers '+
  (recoverAfterRestart?'signed host exit after app reconstruction':'original observed exit'),async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-no-start-debug-'))),workspace=join(root,'project')
  const base=createLocalWorkflowStore(join(root,'store')),browser=createPreviewTestBrowser(),native=createNativeCliProcessRunner()
  const cleanup:Array<()=>void|Promise<void>>=[],requests:any[]=[],starts:Array<string|undefined>=[]
  let loseClaim=true,loseExit=true,reconstructions=0,driver:ReturnType<typeof Bun.spawn>|undefined,server:ReturnType<typeof Bun.serve>|undefined
  const store:WorkflowStore={read:base.read,async commit(...args){
    if(loseExit && args[4]==='agent.writer-quiesced' && !args[3].agentTurns!.at(-1)!.notStarted) {
      loseExit=false;throw Error('Synthetic exit persistence unavailable')
    }
    await base.commit(...args)
    if(loseClaim && args[4]==='agent.turn-claimed'){loseClaim=false;throw Error('Synthetic claim response lost')}
  }}
  const frame=(e:any)=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n'
  const provider=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(r){
    const path=new URL(r.url).pathname
    if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    if(!path.endsWith('/messages'))return new Response('',{status:404})
    const body:any=await r.json();requests.push(body);const n=requests.length
    let call:{name:string;input:unknown}|undefined
    if(n===1)call={name:'Skill',input:{skill:'bgs-builtins:gameplay-programmer'}}
    if(n===2)call={name:'AskUserQuestion',input:{questions:[{header:'Synthetic',question:'Proceed with this synthetic new request?',multiSelect:false,
      options:[{label:'Proceed',description:'Execute synthetic work'},{label:'Wait',description:'Keep waiting'}]}]}}
    if(n===3) {
      const answer=body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[])
        .find((b:any)=>b.type==='tool_result' && b.tool_use_id==='fault-tool-2')
      if(!answer || !JSON.stringify(answer.content).includes('Proceed'))throw Error('Actual native Question result missing')
      call={name:'Write',input:{file_path:join(workspace,'work.txt'),content:'Explicit new authorization only\n'}}
    }
    return new Response(frame({type:'message_start',message:{id:'offline-'+n,type:'message',role:'assistant',model:body.model,
      content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'fault-tool-'+n,name:call.name,input:{}}:{type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:
        {type:'text_delta',text:'Synthetic transport ended, not game acceptance.'}})+frame({type:'content_block_stop',index:0})+
      frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
      frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
  }})
  const prior=process.env.BEEGAME_WORKFLOW_V3_DEBUG,priorKey=process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_WORKFLOW_V3_DEBUG='1'
  if(recoverAfterRestart)process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('base64')
  try {
    await mkdir(workspace);await writeFile(join(workspace,'notes.txt'),'Independent notes retained\n')
    let app:ReturnType<typeof createAgentWorkflowApp>|undefined
    let makeApp:()=>ReturnType<typeof createAgentWorkflowApp>
    server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(r){
      if(new URL(r.url).pathname==='/fixture/reconstruct') {
        if(r.method!=='POST' || r.headers.get('Authorization')!=='Bearer synthetic-owner')return new Response('',{status:403})
        const run=await base.read('no-start-debug','owner')
        const initial=!starts.length && !run?.writer && run?.agentTurns![0]!.notStarted
        const observed=recoverAfterRestart && reconstructions===1 && starts.length===1 && run?.writer && !run.agentTurns!.at(-1)!.quiescedAt
        if(!initial && !observed)return new Response('',{status:409})
        await Promise.all(cleanup.splice(0).map(fn=>fn()));app=makeApp();reconstructions++
        return Response.json({reconstructed:true})
      }
      return app?app.fetch(r):new Response('Initializing',{status:503})
    }})
    makeApp=()=>createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:workspace,workflowV3Store:store,
      modelConfigStore:false,skillsConfig:false,invitationService:false,
      currentUserResolver:r=>r.headers.get('Authorization')==='Bearer synthetic-owner'?{id:'owner',role:'owner'}:undefined,
      registerCleanup:fn=>cleanup.push(fn),sessionRunner:{async start(input){
        if(await realpath(input.cwd)!==workspace)throw Error('Only exact synthetic project may execute')
        starts.push(input.resumeSessionId)
        return native.start({...input,env:{...input.env,BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_AUTH_TOKEN:'offline',
          ANTHROPIC_BASE_URL:provider.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',
          BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}})
      }}})
    app=makeApp()
    const created=await app.request('/api/projects',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},
      body:JSON.stringify({id:'no-start-debug',name:'Synthetic no-start/recovery only',root_path:workspace,created_at:Date.now()})})
    expect(created.status,await created.clone().text()).toBe(200)
    const {endpoint}=await browser.start()
    const launched=Bun.spawn([Bun.which('node')!,fileURLToPath(new URL('./no-start-debug-browser.mjs',import.meta.url))],{
      env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
    driver=launched
    launched.stdin.write(JSON.stringify({endpoint,origin:server.url.origin,recoverAfterRestart}));launched.stdin.end()
    const timer=setTimeout(()=>driver?.kill(),60000)
    const [out,error,exit]=await Promise.all([new Response(launched.stdout).text(),new Response(launched.stderr).text(),launched.exited]);clearTimeout(timer)
    expect(exit,error).toBe(0);expect(JSON.parse(out)).toMatchObject({passed:true,answered:true})
    const run=(await base.read('no-start-debug','owner'))!
    expect(run.agentTurns).toHaveLength(2);expect(run.agentTurns![0]!.notStarted).toBe(true)
    expect(run.agentTurns![1]!.status).toBe('interrupted');expect(run.agentTurns![1]!.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(run.agentTurns![1]!.skillUses).toContainEqual(expect.objectContaining({name:'bgs-builtins:gameplay-programmer',status:'loaded'}))
    expect(run.writer).toBeUndefined();expect(run.deliveryEligible).toBe(false);expect(run.tasks).toEqual({})
    expect(starts).toEqual([undefined]);expect(requests).toHaveLength(4)
    expect(reconstructions).toBe(recoverAfterRestart?2:1)
    if(recoverAfterRestart)expect(nativeRuntimeEnvironment({}).BEEGAME_CONFIG_ENCRYPTION_KEY).toBeUndefined()
    expect(JSON.stringify(requests[0].messages)).not.toContain('Develop the game from this complete confirmed goal')
    expect(JSON.stringify(requests[0].messages)).toContain('Explicit synthetic new work')
    expect(await readFile(join(workspace,'notes.txt'),'utf8')).toBe('Independent notes retained\n')
    expect(await readFile(join(workspace,'work.txt'),'utf8')).toBe('Explicit new authorization only\n')
    console.log(JSON.stringify({noStartDebug:true,controlledProviderRequests:requests.length,paidCalls:0,firstNativeStartOnly:true,
      recoverAfterRestart,screenshot:recoverAfterRestart?'/private/tmp/bgs-v3-178-debug-controlled.png':'/private/tmp/bgs-v3-177-debug-controlled.png',quality:'unverified'}))
  }finally{
    if(driver?.exitCode===null){driver.kill();await driver.exited}
    await Promise.all(cleanup.map(fn=>fn()));server?.stop(true);provider.stop(true);await browser.close()
    if(prior===undefined)delete process.env.BEEGAME_WORKFLOW_V3_DEBUG;else process.env.BEEGAME_WORKFLOW_V3_DEBUG=prior
    if(priorKey===undefined)delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY;else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=priorKey
    await rm(root,{recursive:true,force:true})
  }
},75000)
