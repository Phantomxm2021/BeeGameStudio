import {expect,test} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createBgsRunner} from './runner'
import {createRun,type AgentTurn} from '../beegame/workflow-v3/state'
import {productionOutputSchema,parseProductionResult,prepareDesignDocumentHandoff} from '../beegame/workflow-v3/production-workflow'

const nativeTest=process.env.BGS_SANDBOX_TESTS==='1'?test:test.skip
for(const protocol of ['responses','chat-completions'] as const) nativeTest(
  protocol+' GDD task keeps Shell read-only, writes its working document and allows ordinary follow-up',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-production-output-'),game=join(root,'game')
  await mkdir(join(game,'docs'),{recursive:true})
  await writeFile(join(game,'docs/GDD.md'),'# Synthetic\n## Decisions\nSynthetic design.\n')
  await writeFile(join(game,'board.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>')
  const run=createRun({projectId:'synthetic',ownerId:'owner',workspacePath:game,chatSessionId:'chat',requestKey:'start',text:'Synthetic scope',constraints:{},ids:['goal']})
  const turn={production:{stage:'design',originRequestKey:'start'}} as AgentTurn
  const document='# Complete synthetic GDD\nFinal document.\n'
  const result={status:'ready',summary:'GDD saved'}
  const schema=productionOutputSchema(turn.production!)
  const requests:any[]=[],events:any[]=[],handoffs:any[]=[],permissions:any[]=[],authorizations:string[]=[]
  const probe = `const fs=require('node:fs'); for(const file of ['docs/GDD.md','ordinary.txt']) { let denied=false; try {fs.writeFileSync(file,'Forbidden')} catch {denied=true} if(!denied) throw Error('Unexpected project write: '+file) } fs.writeFileSync(process.env.TMPDIR+'/document-probe','Temporary research'); console.log('Project write denied; temporary research available')`
  const probeArgs=JSON.stringify({cmd:process.execPath+' -e '+"'"+probe.replaceAll("'", "'\\''")+"'",max_output_tokens:100})
  let phase=0,nativeSessionId='',preparationRequests=0
  // Scripted localhost only. Reject API format constraints to model an endpoint
  // without that capability; a tool call precedes the final JSON response.
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(new URL(request.url).pathname!=='/v1/'+(protocol==='responses'?'responses':'chat/completions'))return new Response('Unexpected route',{status:404})
    const body=await request.json() as any;requests.push(body)
    if(body.response_format||body.text?.format?.type==='json_schema')return new Response('Unsupported response format',{status:400})
    const tool=!phase && preparationRequests++ < 2
    const write=tool && preparationRequests===2
    const text=phase?'Ordinary follow-up answer':JSON.stringify(result)
    const functionCall=write
      ? {id:'fc_write',call_id:'write-design',name:'WriteProjectFile',arguments:JSON.stringify({file_path:'docs/GDD.md',content:document}),status:'completed'}
      : {id:'fc_probe',call_id:'probe',name:'exec_command',arguments:probeArgs,status:'completed'}
    if(protocol==='chat-completions')return new Response([
      {choices:[{index:0,delta:tool?{tool_calls:[{index:0,id:functionCall.call_id,type:'function',function:{name:functionCall.name,arguments:functionCall.arguments}}]}:{content:text},finish_reason:null}]},
      {choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}},
    ].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}})
    const item=tool?{type:'function_call',...functionCall}:
      {id:'final-'+phase,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}
    const response={id:'fixture-'+requests.length,object:'response',created_at:1,model:body.model,status:'completed',output:[item],usage:{input_tokens:100,output_tokens:20,total_tokens:120}}
    return new Response([
      {type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress'}},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response},
    ].map((event,sequence_number)=>`data: ${JSON.stringify({...event,sequence_number})}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}})
  }})
  const runner=createBgsRunner({resolveOutboundTarget:async value=>{
    const url=new URL(value)
    if(url.origin!==server.url.origin)throw Error('External fixture request forbidden')
    return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
  }})
  let runtime:Awaited<ReturnType<typeof runner.start>>|undefined
  const finalOutput={readOnly:true,writeDocument:{path:'docs/GDD.md',authorize:async()=>{authorizations.push('docs/GDD.md')}},schema,accept:async (value:unknown)=>{
    const request=parseProductionResult(turn.production!,value)
    expect(request).toEqual({action:'advance',summary:result.summary})
    expect(await readFile(join(game,'docs/GDD.md'),'utf8')).toBe(document)
    handoffs.push(prepareDesignDocumentHandoff(run.workspacePath,request.summary))
    return request.summary
  }}
  const startup={sessionId:'production-output-fixture',cwd:game,systemContext:'Synthetic current runtime.',confirmedBriefContext:'Synthetic confirmed brief.',finalOutput,
    env:{BEEGAME_CONFIG_DIR:join(root,'private'),OPENAI_API_KEY:'fixture-only',BEEGAME_API_PROTOCOL:protocol,
      OPENAI_BASE_URL:server.url.origin+'/v1',BEEGAME_MODEL:'fixture-unknown-model'},
    onNativeSessionId:(id:string)=>{nativeSessionId=id},requestPermission:async(request:any)=>{
      permissions.push(request)
      return request.toolName==='Write'?{behavior:'allow' as const}:{behavior:'deny' as const}
    }}
  try {
    runtime=await runner.start(startup)
    await runtime.submit({prompt:'Complete the synthetic preparation assignment.',signal:AbortSignal.timeout(20_000),
      finalOutput,confirmedBriefContext:startup.confirmedBriefContext,onMessage:message=>{events.push(message)},requestPermission:startup.requestPermission})
    expect(requests).toHaveLength(3)
    for(const request of requests){
      expect(request.response_format).toBeUndefined()
      expect(request.text?.format?.type).not.toBe('json_schema')
      const context=protocol==='responses'?request.input.filter((item:any)=>item.role==='developer').flatMap((item:any)=>item.content.map((part:any)=>part.text)).join('\n'):
        request.messages.filter((item:any)=>item.role==='system').map((item:any)=>item.content).join('\n')
      for(const marker of [JSON.stringify(schema),startup.systemContext,startup.confirmedBriefContext])
        expect(context.split(marker)).toHaveLength(2)
    }
    expect(permissions.map(request=>request.phase)).toEqual([undefined,'recheck'])
    expect(authorizations).toEqual(['docs/GDD.md'])
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0].next).toBeUndefined()
    expect(await readFile(join(game,'docs/GDD.md'),'utf8')).toBe(document)
    expect(events.find(e=>e.toolName==='Shell' && e.eventType==='tool.completed')?.output).toContain('Project write denied')
    expect(handoffs[0].sources.map((source:any)=>source.path)).toEqual(['docs/GDD.md'])
    expect(events.filter(e=>e.eventType.startsWith('assistant.')).map(e=>e.text)).toEqual(['GDD saved'])
    expect(events.some(e=>e.toolName==='BgsWorkflow')).toBe(false)
    await runtime.dispose?.();phase=1
    const followUpEvents=events.length
    runtime=await runner.start({...startup,finalOutput:undefined,resumeSessionId:nativeSessionId})
    await runtime.submit({prompt:'An ordinary follow-up question.',confirmedBriefContext:startup.confirmedBriefContext,signal:AbortSignal.timeout(20_000),onMessage:message=>{events.push(message)},requestPermission:async()=>({behavior:'deny'})})
    expect(requests).toHaveLength(4)
    // Native history retains earlier developer messages. The current context
    // replaces their keyed values; it does not erase the conversation.
    const lastContext=protocol==='responses'?requests[3].input.filter((item:any)=>item.role==='developer').flatMap((item:any)=>item.content.map((part:any)=>part.text)).join('\n'):
      requests[3].messages.filter((item:any)=>item.role==='system').map((item:any)=>item.content).join('\n')
    expect([...lastContext.matchAll(/<bgsRuntime_part_000001>([\s\S]*?)<\/bgsRuntime_part_000001>/g)].at(-1)?.[1]).toBe(startup.systemContext)
    expect(events.slice(followUpEvents).filter(e=>e.eventType.startsWith('assistant.')).map(e=>e.text).join('')).toBe('Ordinary follow-up answer')
    expect(handoffs).toHaveLength(1)
    expect(JSON.stringify(requests[3])).toContain('Complete the synthetic preparation assignment.')
  }finally{await runtime?.dispose?.();server.stop(true);await rm(root,{recursive:true,force:true})}
},30_000)
