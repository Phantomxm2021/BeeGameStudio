import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BgsClient } from './client'
import { bgsProviderConfig, readNativeCommandExits, createBgsRunner } from './runner'
import { loadBgsModelCatalog } from './model-catalog'
import { startProviderBridge } from '../model-providers/bridge'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// Real CLI, production catalog loader and bridge, scripted localhost Responses.
// Metadata and generation use only the local fixture; native fallback owns unknown models.
nativeTest('BGS bridge catalog preserves native prompts, tools and capacity across cold resume', async () => {
  const root = await mkdtemp('/private/tmp/bgs-model-catalog-'), home = join(root, 'home'), model = 'offline-catalog-fixture'
  const requests: any[] = [], notifications: {method:string;params:any}[] = []
  let client: BgsClient | undefined, bridge: Awaited<ReturnType<typeof startProviderBridge>> | undefined
  let unexpectedRequests=0
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    if (new URL(request.url).pathname !== '/v1/responses' || request.method!=='POST') {
      unexpectedRequests++;return new Response('Unexpected route',{status:404})
    }
    const body = await request.json() as any
    requests.push(body)
    if (requests.length > 3) return new Response('Offline request limit exceeded',{status:429})
    const item = {id:'message-'+requests.length,type:'message',role:'assistant',status:'completed',
      content:[{type:'output_text',text:'Offline fixture complete.',annotations:[]}]}
    const response = {id:'response-'+requests.length,object:'response',created_at:1,model,status:'completed',output:[item],
      usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
    return new Response([
      {type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress'}},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response},
    ].map((event,sequence_number)=>'data: '+JSON.stringify({...event,sequence_number})+'\n\n').join(''),
    {headers:{'content-type':'text/event-stream'}})
  }})
  try {
    await mkdir(join(home,'skills','offline-fixture'),{recursive:true})
    await writeFile(join(home,'skills','offline-fixture','SKILL.md'),'---\nname: offline-fixture\ndescription: Offline catalog compatibility fixture.\n---\nOnly synthetic local work.')
    const env = {...getSafeRuntimeProcessEnvironment(),BGS_HOME:home,OPENAI_API_KEY:'offline-fixture-only',
      OPENAI_BASE_URL:server.url.origin+'/v1',BEEGAME_MODEL:model}
    const connect = async(withCatalog:boolean) => {
      if(withCatalog) bridge=await startProviderBridge(env,{
        modelCatalog: await loadBgsModelCatalog({cwd:root,env}),onUsage(){},
        resolveOutboundTarget:async value=>{
          const url=new URL(value)
          if(url.origin!==server.url.origin)throw Error('External fixture request forbidden')
          return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
        },
      })
      const runtimeEnv={...env,...(bridge?{OPENAI_API_KEY:bridge.apiKey,OPENAI_BASE_URL:bridge.baseUrl}:{})}
      return BgsClient.connect({cwd:root,env:runtimeEnv,
        config:{...bgsProviderConfig(runtimeEnv,{modelCatalogUrl:bridge?.modelCatalogUrl}),cli_auth_credentials_store:'file'},
        onNotification:(method,params)=>{notifications.push({method,params})}})
    }
    const submit = async(threadId:string) => {
      const before = notifications.filter(n=>n.method==='turn/completed').length
      await client!.request('turn/start',{threadId,input:[{type:'text',text:'Complete the offline fixture.'}]})
      const deadline = Date.now()+15_000
      while(notifications.filter(n=>n.method==='turn/completed').length===before) {
        if(Date.now()>deadline)throw Error('Offline native turn did not settle')
        await Bun.sleep(10)
      }
      expect(notifications.filter(n=>n.method==='turn/completed').at(-1)!.params.turn.status).toBe('completed')
    }
    client = await connect(false)
    const baselineModels = (await client.request('model/list',{includeHidden:true})).data.map((m:any)=>m.model)
    expect(baselineModels.length).toBeGreaterThan(1)
    const baseline = await client.request('thread/start',{cwd:root,model})
    await submit(baseline.thread.id)
    await client.close()
    client = await connect(true)
    const models=(await client.request('model/list',{includeHidden:true})).data.map((m:any)=>m.model)
    expect(models).toEqual([])
    const explicit = await client.request('thread/start',{cwd:root,model})
    await submit(explicit.thread.id)
    expect(requests).toHaveLength(2)
    const developer = (body:any) => body.input.filter((item:any)=>item.role==='developer').map((item:any)=>item.content)
    expect(developer(requests[0]).length).toBeGreaterThan(0)
    expect(developer(requests[1])).toEqual(developer(requests[0]))
    // The provider picker correctly drops models not selected for this connection.
    // All tool contracts and the rest of the spawn guidance remain native.
    const withoutPicker = (tools:any[]):any[] => tools.map(tool=>({ ...tool,
      ...(tool.tools ? {tools:withoutPicker(tool.tools)} : {}),
      ...(tool.name==='spawn_agent' ? {description:tool.description.slice(tool.description.indexOf('Spawn a sub-agent'))} : {}),
    }))
    expect(JSON.stringify(requests[1].tools)).toContain('No picker-visible model overrides are currently loaded.')
    expect(withoutPicker(requests[1].tools)).toEqual(withoutPicker(requests[0].tools))
    expect(requests[1].reasoning).toEqual(requests[0].reasoning)
    expect(requests[0].model).toBe(model)
    expect(requests[1].model).toBe(model)
    expect(JSON.stringify(requests[1])).toContain('offline-fixture')
    await client.close();await bridge!.close()
    const oldUrl=bridge!.modelCatalogUrl
    client = await connect(true)
    expect(bridge!.modelCatalogUrl).not.toBe(oldUrl)
    const resumed = await client.request('thread/resume',{threadId:explicit.thread.id,model})
    expect(resumed.thread.id).toBe(explicit.thread.id)
    await submit(explicit.thread.id)
    expect(requests).toHaveLength(3)
    expect(developer(requests[2])).toEqual(developer(requests[1]))
    expect(requests[2].model).toBe(model)
    expect(requests[2].tools).toEqual(requests[1].tools)
    const windows = notifications.filter(n=>n.method==='thread/tokenUsage/updated').map(n=>n.params.tokenUsage.modelContextWindow)
    expect(windows.length).toBeGreaterThanOrEqual(3)
    expect(windows.every(window=>window===258_400)).toBe(true)
    expect(unexpectedRequests).toBe(0)
  } finally {await client?.close();await bridge?.close();server.stop(true);await rm(root,{recursive:true,force:true})}
},60_000)

// Native MCP approval routing, using only the existing localhost fixture.
// A browser-like tool records execution; no browser, credentials or model service.
nativeTest.each(['canonical','qualified-name','bare-name','bare-empty','split-arguments','argument-conflict'] as const)('bridge catalog uses the parent reviewer and gates MCP actions on approval outcomes (%s)', async encoding => {
  const root = await mkdtemp('/private/tmp/bgs-model-catalog-'), model = 'offline-approval-fixture'
  let client: BgsClient | undefined, bridge: Awaited<ReturnType<typeof startProviderBridge>> | undefined
  const notifications: {method:string;params:any}[] = [], executed: {name:string;arguments:unknown}[] = [], reviews: any[] = [], parentRequests: any[] = []
  const toolName=encoding==='bare-empty'?'browser_snapshot':'browser_navigate'
  let mode: 'allow' | 'deny' | 'error' = 'allow', parentStep = 0, manualApprovals = 0
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method === 'GET') return new Response(null,{status:404})
    const body = await request.json() as any
    if (path === '/mcp') {
      if (body.method === 'initialize') return Response.json({jsonrpc:'2.0',id:body.id,result:{
        protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'approval-browser',version:'1'}}})
      if (body.id === undefined) return new Response(null,{status:202})
      if (body.method === 'tools/list') return Response.json({jsonrpc:'2.0',id:body.id,result:{tools:[{
        name:toolName,description:'Synthetic browser action; record this local call only.',
        inputSchema:encoding==='bare-empty'?{type:'object',properties:{filename:{type:'string'}},additionalProperties:false}:
          {type:'object',properties:{url:{type:'string'}},required:['url']},
        annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true},
      }]}})
      if (body.method === 'tools/call') {
        executed.push({name:body.params.name,arguments:body.params.arguments})
        return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:'Synthetic navigation completed.'}]}})
      }
      return Response.json({jsonrpc:'2.0',id:body.id,result:{}})
    }
    if (path !== '/v1/responses') return new Response('Unexpected fixture route',{status:404})
    if (parentRequests.length + reviews.length > 12) return new Response('Offline request limit',{status:400})
    const review = Boolean(body.text?.format?.schema?.properties?.outcome)
    let output: any[]
    if (review) {
      reviews.push(body)
      if (body.model !== model) return Response.json({error:{type:'server_error',message:'Model is unavailable.'}},{status:400})
      if (mode === 'error') return Response.json({error:{type:'server_error',message:'Model is unavailable.'}},{status:400})
      output = [{id:'assessment-'+reviews.length,type:'message',role:'assistant',status:'completed',content:[{
        type:'output_text',text:JSON.stringify({outcome:mode,risk_level:mode==='allow'?'low':'high',
          user_authorization:mode==='allow'?'high':'low',rationale:'Synthetic fixture assessment.'}),annotations:[],
      }]}]
    } else {
      parentRequests.push(body)
      const namespace = body.tools.find((tool:any)=>tool.type==='namespace' && tool.tools?.some((child:any)=>child.name===toolName))
      const tool = namespace?.tools.find((tool:any)=>tool.name===toolName) ?? body.tools.find((tool:any)=>tool.name?.endsWith('__'+toolName))
      if (!tool) return new Response('Browser fixture tool missing',{status:400})
      if(encoding!=='canonical')expect(namespace?.name).toEqual(expect.any(String))
      output = parentStep++ === 0 ? [{id:'action-'+mode,type:'function_call',call_id:'call-'+mode,status:'completed',
        name:namespace && encoding==='qualified-name' ? namespace.name+'.'+tool.name : tool.name,
        ...(namespace && encoding==='canonical' ? {namespace:namespace.name} : {}),arguments:encoding==='bare-empty'?'':JSON.stringify({url:'https://fixture.invalid/'+mode})}]
        : [{id:'done-'+mode,type:'message',role:'assistant',status:'completed',content:[{
          type:'output_text',text:'Offline approval fixture complete.',annotations:[],
        }]}]
    }
    const response = {id:'response-'+(parentRequests.length+reviews.length),object:'response',created_at:1,
      model:body.model,status:'completed',output,usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
    const split=encoding==='split-arguments'||encoding==='argument-conflict'
    return new Response([
      {type:'response.created',response:{...response,status:'in_progress',output:[]}},
      ...output.flatMap((item,output_index)=>[
        {type:'response.output_item.added',output_index,item:{...item,status:'in_progress',...(split&&item.type==='function_call'?{arguments:''}:{})}},
        ...(split&&item.type==='function_call'?[{type:'response.function_call_arguments.done',item_id:item.id,arguments:item.arguments}]:[]),
        {type:'response.output_item.done',output_index,item:split&&item.type==='function_call'?{...item,arguments:''}:item},
      ]),
      {type:'response.completed',response:split?{...response,output:output.map(item=>item.type==='function_call'
        ? {...item,arguments:encoding==='argument-conflict'?'{}':''}:item)}:response},
    ].map((event,sequence_number)=>'data: '+JSON.stringify({...event,sequence_number})+'\n\n').join(''),
    {headers:{'content-type':'text/event-stream'}})
  }})
  try {
    const env = {...getSafeRuntimeProcessEnvironment(),BGS_HOME:join(root,'home'),OPENAI_API_KEY:'offline-fixture-only',
      OPENAI_BASE_URL:server.url.origin+'/v1',BEEGAME_MODEL:model}
    await mkdir(env.BGS_HOME)
    bridge = await startProviderBridge(env,{modelCatalog: await loadBgsModelCatalog({cwd:root,env}),onUsage(){},
      resolveOutboundTarget:async value=>{
        const url=new URL(value)
        if(url.origin!==server.url.origin)throw Error('External fixture request forbidden')
        return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
      },
    })
    const runtimeEnv = {...env,OPENAI_API_KEY:bridge!.apiKey,OPENAI_BASE_URL:bridge!.baseUrl}
    client = await BgsClient.connect({cwd:root,env:runtimeEnv,config:{
      ...bgsProviderConfig(runtimeEnv,{modelCatalogUrl:bridge!.modelCatalogUrl}),
      cli_auth_credentials_store:'file',approval_policy:'on-request',approvals_reviewer:'auto_review',sandbox_mode:'workspace-write',
      mcp_servers:{'approval-browser':{url:server.url.origin+'/mcp'}},
    },onNotification:(method,params)=>{notifications.push({method,params})},
      onRequest:async()=>{manualApprovals++;throw Error('Unexpected manual approval in auto-review fixture')},
    })
    for (const outcome of ['allow','deny','error'] as const) {
      mode=outcome;parentStep=0
      const before=notifications.filter(n=>n.method==='turn/completed').length,reviewCount=reviews.length
      const {thread}=await client.request('thread/start',{cwd:root,model,approvalPolicy:'on-request',approvalsReviewer:'auto_review'})
      await client.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Perform the synthetic browser action for '+mode+'.'}]})
      const deadline=Date.now()+15_000
      while(notifications.filter(n=>n.method==='turn/completed').length===before) {
        if(Date.now()>deadline)throw Error('Offline MCP approval did not settle: '+mode)
        await Bun.sleep(10)
      }
      expect(notifications.filter(n=>n.method==='turn/completed').at(-1)!.params.turn.status).toBe(encoding==='argument-conflict'?'failed':'completed')
      if(encoding==='argument-conflict'){
        expect(parentRequests).toHaveLength(1)
        expect(reviews).toEqual([])
        expect(executed).toEqual([])
        break
      }
      expect(reviews.length).toBe(reviewCount+1)
      expect(reviews.at(-1).model).toBe(model)
      const completed=notifications.filter(n=>n.method==='item/completed' && n.params.item.type==='mcpToolCall').at(-1)?.params.item
      expect(completed).toBeDefined()
      const assessment = notifications.filter(n => n.method === 'item/autoApprovalReview/completed').at(-1)?.params
      expect(assessment).toBeDefined()
      expect(assessment.targetItemId).toBe(completed.id)
      if(mode==='allow') {
        expect(assessment.review.status).toBe('approved')
        expect(executed).toEqual([{name:toolName,arguments:encoding==='bare-empty'?{}:{url:'https://fixture.invalid/allow'}}])
        expect(completed.status).toBe('completed')
      } else {
        expect(assessment.review.status).toBe('denied')
        expect(executed).toEqual([{name:toolName,arguments:encoding==='bare-empty'?{}:{url:'https://fixture.invalid/allow'}}])
        expect(completed.status).toBe('failed')
        if(mode==='error') {
          expect(completed.error.message).toContain('Automatic approval review failed')
          expect(assessment.review).toMatchObject({ riskLevel: null, userAuthorization: null,
            rationale: expect.stringContaining('Automatic approval review failed:') })
        }
      }
    }
    expect(parentRequests.every(body=>body.model===model)).toBe(true)
    expect(manualApprovals).toBe(0)
  } finally {await client?.close();await bridge?.close();server.stop(true);await rm(root,{recursive:true,force:true})}
},60_000)


nativeTest('tool output policy follows native defaults and explicit home configuration across cold resume', async () => {
  const root=await mkdtemp('/private/tmp/bgs-model-catalog-'),home=join(root,'home'),model='offline-budget-fixture'
  let client:BgsClient|undefined,bridge:Awaited<ReturnType<typeof startProviderBridge>>|undefined
  let step=0,round=0,threadId='',unexpected=0
  const requests:any[]=[]
  const notifications:{method:string;params:any}[]=[]
  const source='GUIDANCE_START\n'+'Resource method details and contracts.\n'.repeat(700)+'GUIDANCE_END\n'
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET')return new Response(null,{status:404})
    if(new URL(request.url).pathname!=='/v1/responses'){unexpected++;return new Response('Unexpected route',{status:404})}
    const body=await request.json() as any;requests.push(body);step++
    if(step>2 || requests.length>14){unexpected++;return new Response('Unexpected extra request',{status:429})}
    const item=step===1
      ? {type:'function_call',id:'tool-'+round,call_id:'budget-'+round,name:'exec_command',
        arguments:JSON.stringify({cmd:'cat long-guidance.txt',max_output_tokens:10000})}
      : {type:'message',id:'message-'+round,role:'assistant',status:'completed',
        content:[{type:'output_text',text:'Offline check complete.',annotations:[]}]}
    const response={id:'response-'+round+'-'+step,object:'response',status:'completed',output:[item],
      usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
    return new Response([
      {type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response},
    ].map((event,sequence_number)=>'data: '+JSON.stringify({...event,sequence_number})+'\n\n').join(''),
      {headers:{'content-type':'text/event-stream'}})
  }})
  const env={...getSafeRuntimeProcessEnvironment(),BGS_HOME:home,OPENAI_API_KEY:'fixture-only',
    OPENAI_BASE_URL:server.url.origin+'/v1',BEEGAME_MODEL:model}
  const outputs:string[]=[]
  try {
    await mkdir(home)
    await writeFile(join(root,'long-guidance.txt'),source)
    for(const mode of ['native-default','bgs-default','configured','configured-resume','configured-disabled','configured-disabled-resume','native-resume'] as const){
      round++;step=0
      if(mode==='configured'||mode==='configured-disabled')await writeFile(join(home,'config.toml'),'tool_output_token_limit = 1000\n[agents]\nmax_concurrent_threads_per_session = 5\n[tools.update_plan]\nenabled = '+(mode==='configured')+'\n')
      if(mode==='native-resume')await rm(join(home,'config.toml'))
      bridge=await startProviderBridge(env,{modelCatalog: await loadBgsModelCatalog({cwd:root,env}),onUsage(){},
        resolveOutboundTarget:async value=>{
          const url=new URL(value);if(url.origin!==server.url.origin)throw Error('Non-local fixture request forbidden')
          return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
        }})
      const runtimeEnv={...env,OPENAI_API_KEY:bridge.apiKey,OPENAI_BASE_URL:bridge.baseUrl}
      const config:Record<string,unknown>={...bgsProviderConfig(runtimeEnv,{modelCatalogUrl:bridge.modelCatalogUrl}),cli_auth_credentials_store:'file'}
      // A real native baseline, even when the implementation under test overrides it.
      if(mode==='native-default')delete config.tool_output_token_limit
      client=await BgsClient.connect({cwd:root,env:runtimeEnv,config,onNotification:(method,params)=>{notifications.push({method,params})}})
      if(['configured','configured-resume','configured-disabled','configured-disabled-resume'].includes(mode)){
        const settings=await client.requestNative('config/read',{})
        expect(settings.config.agents).toMatchObject({max_concurrent_threads_per_session:5})
      }
      const thread=mode==='configured-resume'||mode==='configured-disabled-resume'||mode==='native-resume'
        ? await client.request('thread/resume',{threadId,model})
        : await client.request('thread/start',{cwd:root,model})
      threadId=thread.thread.id
      const before=notifications.filter(n=>n.method==='turn/completed').length
      await client.request('turn/start',{threadId,input:[{type:'text',text:'Read the synthetic guidance once.'}]})
      const deadline=Date.now()+15000
      while(notifications.filter(n=>n.method==='turn/completed').length===before){
        if(Date.now()>deadline)throw Error('Offline tool output turn did not settle')
        await Bun.sleep(10)
      }
      expect(notifications.filter(n=>n.method==='turn/completed').at(-1)!.params.turn.status).toBe('completed')
      expect(step).toBe(2)
      if(mode==='configured'||mode==='configured-resume')expect(JSON.stringify(requests.at(-1).tools)).toContain('\"name\":\"update_plan\"')
      if(mode==='configured-disabled'||mode==='configured-disabled-resume')expect(JSON.stringify(requests.at(-1).tools)).not.toContain('\"name\":\"update_plan\"')
      const output=requests.at(-1).input.findLast((item:any)=>item.type==='function_call_output').output
      const text=typeof output==='string'?output:output.map((part:any)=>part.text).join('\n')
      const view=await client.request('thread/read',{threadId,includeTurns:false})
      const turnId=notifications.filter(n=>n.method==='turn/completed').at(-1)!.params.turn.id
      const receipts=await readNativeCommandExits(view.thread.path,threadId,new Map([['budget-'+round,turnId]]))
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({id:'budget-'+round,turnId,exitCode:0})
      const markerIndex=text.indexOf('\nOutput:\n')
      expect(receipts[0]!.aggregatedOutput).toBe(text.slice(markerIndex+'\nOutput:\n'.length))
      expect(text).toContain('Process exited with code 0')
      const marker='\nOutput:\n';expect(text).toContain(marker)
      outputs.push(text.slice(text.indexOf(marker)+marker.length))
      await client.close();client=undefined;await bridge.close();bridge=undefined
    }
    expect(outputs[1]).toBe(outputs[0])
    expect(outputs[2]!.length).toBeLessThan(outputs[1]!.length)
    expect(outputs[3]).toBe(outputs[2])
    expect(outputs[4]).toBe(outputs[2])
    expect(outputs[5]).toBe(outputs[2])
    expect(outputs[6]).toBe(outputs[0])
    for(const output of outputs){
      expect(output).toContain('GUIDANCE_START')
      expect(output).toContain('GUIDANCE_END')
      expect(output).toContain('truncated')
    }
    expect(unexpected).toBe(0)
    expect(requests).toHaveLength(14)
  } finally {await client?.close();await bridge?.close();server.stop(true);await rm(root,{recursive:true,force:true})}
},60000)

// Real native MCP lifecycle; the server and model below are local synthetic fixtures.
nativeTest('native author and isolated verification preserve MCP, separate histories and resume the original writer',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-model-catalog-'),home=join(root,'home'),model='offline-native-browser-fixture'
  const checks=[{id:'input',requirement:'Required input',expected:'Expected feedback'}]
  const code='async (page) => ({checks: []})\n'
  const image='UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQ1VYVsf+BiOh/AAA=' // 2×2 lossless MCP viewing fixture.
  const calls:any[]=[],requests:any[]=[],verificationRequests:any[]=[],events:any[]=[]
  let authorNativeId='',verificationNativeId=''
  let runtime:import('../beegame/session-manager').BeeGameSessionRuntime|undefined
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(request.method==='GET')return new Response(null,{status:404})
    const body=await request.json() as any
    if(path==='/mcp'){
      if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'native-browser-fixture',version:'1'}}})
      if(body.id===undefined)return new Response(null,{status:202})
      if(body.method==='tools/list')return Response.json({jsonrpc:'2.0',id:body.id,result:{tools:[{
        name:'browser_run_code_unsafe',description:'Execute the local synthetic batch.',inputSchema:{type:'object',properties:{code:{type:'string'}},required:['code']},annotations:{readOnlyHint:true}
      }]}})
      if(body.method==='tools/call'){
        calls.push(body.params)
        return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:'### Result\n'+JSON.stringify({checks:[{id:'input',status:calls.length===1?'failed':'passed',observed:calls.length===1?'Current state=waiting':'Expected feedback'}]})+'\n### Ran Playwright code\nsynthetic'},{type:'image',mimeType:'image/webp',data:image}]}})
      }
      return Response.json({jsonrpc:'2.0',id:body.id,result:{}})
    }
    if(path!=='/v1/responses')throw Error('Unexpected non-local fixture route')
    const review=Boolean(body.text?.format?.schema?.properties?.outcome)
    let item:any
    if(review)item={type:'message',id:'approval',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({outcome:'allow',risk_level:'low',user_authorization:'high',rationale:'Local fixture authorization'}),annotations:[]}]}
    else{
      // Work execution no longer carries a whole-turn JSON schema. Identify the
      // fixture assignment from its user marker, as the isolated history asserts below.
      const verifying=JSON.stringify(body.input).includes('VERIFIER_HISTORY_ONLY')
      const activeRequests=verifying?verificationRequests:requests
      activeRequests.push(body)
      if(activeRequests.length>(verifying?2:4))return new Response('Unexpected extra model call',{status:429})
      const namespace=body.tools.find((entry:any)=>entry.type==='namespace'&&entry.tools?.some((tool:any)=>tool.name==='browser_run_code_unsafe'))
      const tool=namespace?.tools.find((tool:any)=>tool.name==='browser_run_code_unsafe')??body.tools.find((tool:any)=>tool.name?.endsWith('__browser_run_code_unsafe'))
      if(!tool)throw Error('Native author browser script tool was removed')
      item=(verifying?verificationRequests.length===1:calls.length<2)?{type:'function_call',id:'native-tool-'+(verifying?'verify-':'')+activeRequests.length,call_id:'native-call-'+(verifying?'verify-':'')+activeRequests.length,name:tool.name,...(namespace?{namespace:namespace.name}:{}),arguments:JSON.stringify({code})}
        :{type:'message',id:'late-final',role:'assistant',status:'completed',content:[{type:'output_text',text:verifying
          ? JSON.stringify({status:'passed',summary:'Required transition observed.',findings:[]})
          : 'Implementation complete; native browser observations retained.',annotations:[]}]}
    }
    const response={id:'local-response-'+(review?'review':requests.length),object:'response',status:'completed',output:[item],usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
    return new Response([{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]
      .map((event,sequence_number)=>'data: '+JSON.stringify({...event,sequence_number})+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
  }})
  try{
    await mkdir(home);await mkdir(join(root,'config'))
    await writeFile(join(root,'checks.mjs'),code)
    const network={resolveOutboundTarget:async(value:string)=>{
      const url=new URL(value);if(url.origin!==server.url.origin)throw Error('External fixture request forbidden')
      return {url,addresses:['127.0.0.1'],lookup:(_host:any,_options:any,callback:any)=>callback(null,'127.0.0.1',4)}
    }}
    const runtimeEnv={...getSafeRuntimeProcessEnvironment(),BGS_HOME:home,BEEGAME_CONFIG_DIR:join(root,'config'),OPENAI_API_KEY:'fixture-only',OPENAI_BASE_URL:server.url.origin+'/v1',BEEGAME_MODEL:model,
      BEEGAME_NATIVE_MCP_SERVERS_JSON:JSON.stringify([{id:'browser',name:'Browser',transport:'http',url:server.url.origin+'/mcp',enabled:true,autoStart:true,scope:'global',enabledTools:['browser_run_code_unsafe']}])}
    runtime=await createBgsRunner({...network,inspectOutboundTarget:async value=>({approved:true,target:await network.resolveOutboundTarget(value)})}).start({sessionId:'native-browser-fixture',cwd:root,confirmedBriefContext:'Synthetic local control check',env:runtimeEnv,onNativeSessionId:id=>{authorNativeId=id}})
    await runtime.submit({prompt:'AUTHOR_HISTORY_ONLY: complete the synthetic check.',signal:AbortSignal.timeout(25000),confirmedBriefContext:'Synthetic local control check',onMessage:message=>{events.push(message)},requestPermission:async()=>({behavior:'deny'})})
    expect(calls).toHaveLength(2)
    expect(calls.every(call=>call.arguments.code===code)).toBe(true)
    expect(events.filter(event=>event.eventType==='tool.completed'&&event.toolName==='browser_run_code_unsafe')).toHaveLength(2)
    expect(events.some(event=>event.toolName==='Browser batch')).toBe(false)
    expect(events.some(event=>event.text==='Implementation complete; native browser observations retained.')).toBe(true)
    expect(requests).toHaveLength(3)
    for(const request of requests.slice(1)) expect(JSON.stringify(request.input)).toContain('data:image/webp;base64,'+image)
    await runtime.dispose?.()
    const finalOutput={readOnly:true,schema:{type:'object',additionalProperties:false,properties:{
      status:{type:'string',enum:['passed','needs-repair','blocked']},summary:{type:'string'},findings:{type:'array',items:{type:'string'}},
    },required:['status','summary','findings']},accept:async(value:any)=>{
      expect(value).toEqual({status:'passed',summary:'Required transition observed.',findings:[]})
      return value.summary
    }}
    runtime=await createBgsRunner({...network,inspectOutboundTarget:async value=>({approved:true,target:await network.resolveOutboundTarget(value)})}).start({sessionId:'native-browser-fixture',cwd:root,env:runtimeEnv,confirmedBriefContext:'Synthetic local control check',finalOutput,onNativeSessionId:id=>{verificationNativeId=id}})
    await runtime.submit({prompt:'VERIFIER_HISTORY_ONLY: inspect the current delivered transition.',finalOutput,signal:AbortSignal.timeout(25000),confirmedBriefContext:'Synthetic local control check',onMessage:message=>{events.push(message)},requestPermission:async()=>({behavior:'deny'})})
    expect(JSON.stringify(requests[0].input)).toContain('game-content-pipeline-engineer')
    expect(JSON.stringify(requests[0].input)).not.toContain('# Game Content Pipeline Engineer')
    expect(JSON.stringify(requests[0].input)).not.toContain('For a new resource source or a change of source')
    const nativeBase=(request:any)=>request.input.filter((item:any)=>item.role==='developer').flatMap((item:any)=>item.content).find((part:any)=>part.text?.startsWith('You are a coding agent running in the BGS CLI'))?.text
    expect(nativeBase(requests[0])).toEqual(expect.any(String))
    expect(nativeBase(verificationRequests[0])).toBe(nativeBase(requests[0]))
    expect(verificationNativeId).not.toBe(authorNativeId)
    expect(verificationRequests).toHaveLength(2)
    expect(JSON.stringify(verificationRequests[0].input)).not.toContain('AUTHOR_HISTORY_ONLY')
    expect(JSON.stringify(verificationRequests[0].input)).not.toContain('Current state=waiting')
    expect(JSON.stringify(verificationRequests[0].input)).not.toContain('data:image/webp;base64,')
    expect(JSON.stringify(verificationRequests[1].input)).toContain('data:image/webp;base64,'+image)
    expect(calls).toHaveLength(3)
    await runtime.dispose?.()
    runtime=await createBgsRunner({...network,inspectOutboundTarget:async value=>({approved:true,target:await network.resolveOutboundTarget(value)})}).start({sessionId:'native-browser-fixture',cwd:root,env:runtimeEnv,resumeSessionId:authorNativeId,confirmedBriefContext:'Synthetic local control check'})
    await runtime.submit({prompt:'Apply only the reported correction.',signal:AbortSignal.timeout(25000),confirmedBriefContext:'Synthetic local control check',onMessage:message=>{events.push(message)},requestPermission:async()=>({behavior:'deny'})})
    expect(requests).toHaveLength(4)
    expect(nativeBase(requests[3])).toBe(nativeBase(requests[0]))
    expect(JSON.stringify(requests[3].input)).toContain('AUTHOR_HISTORY_ONLY')
    expect(JSON.stringify(requests[3].input)).not.toContain('VERIFIER_HISTORY_ONLY')
  }finally{await runtime?.dispose?.();server.stop(true);await rm(root,{recursive:true,force:true})}
},60000)


nativeTest('native shell polling retains the original process across decimal integer spellings',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-model-catalog-'),model='offline-poll-fixture'
  let client:BgsClient|undefined,bridge:Awaited<ReturnType<typeof startProviderBridge>>|undefined
  const requests:any[]=[],notifications:{method:string;params:any}[]=[]
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(request.method==='GET')return new Response(null,{status:404})
    const body=await request.json() as any;requests.push(body)
    if(requests.length>3)return new Response('Unexpected extra poll',{status:400})
    let item:any
    if(requests.length===1)item={type:'function_call',id:'poll-start',call_id:'poll-start',name:'exec_command',
      arguments:'{"cmd":"sleep 2; printf FIXTURE_INSTALL_DONE","yield_time_ms":1000.0,"max_output_tokens":1000.0}'}
    else if(requests.length===2){
      const output=body.input.findLast((value:any)=>value.type==='function_call_output').output
      const match=JSON.stringify(output).match(/session ID (\d+)/)
      if(!match)throw Error('Original exec did not return a running process: '+JSON.stringify(output))
      item={type:'function_call',id:'poll-wait',call_id:'poll-wait',name:'write_stdin',
        arguments:'{"session_id":'+match[1]+'.0,"chars":"","yield_time_ms":15000.0}'}
    }else item={type:'message',id:'poll-complete',role:'assistant',status:'completed',content:[{type:'output_text',text:'Fixture complete.',annotations:[]}]}
    const response={id:'poll-'+requests.length,object:'response',status:'completed',output:[item],usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
    return new Response([{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]
      .map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
  }})
  try{
    const home=join(root,'home');await mkdir(home)
    const env={...getSafeRuntimeProcessEnvironment(),BGS_HOME:home,OPENAI_API_KEY:'offline-only',OPENAI_BASE_URL:server.url.origin+'/v1',BEEGAME_MODEL:model}
    bridge=await startProviderBridge(env,{onUsage(){},resolveOutboundTarget:async value=>{
      const url=new URL(value);if(url.origin!==server.url.origin)throw Error('External fixture request forbidden')
      return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
    }})
    const runtimeEnv={...env,OPENAI_API_KEY:bridge.apiKey,OPENAI_BASE_URL:bridge.baseUrl}
    client=await BgsClient.connect({cwd:root,env:runtimeEnv,config:{...bgsProviderConfig(runtimeEnv),cli_auth_credentials_store:'file'},
      onNotification:(method,params)=>{notifications.push({method,params})}})
    const {thread}=await client.request('thread/start',{cwd:root,model,approvalPolicy:'never',sandbox:'workspace-write'})
    await client.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Complete the local process polling fixture.'}]})
    const deadline=Date.now()+15000
    while(!notifications.some(event=>event.method==='turn/completed')){
      if(Date.now()>deadline)throw Error('Local polling did not settle')
      await Bun.sleep(10)
    }
    expect(notifications.find(event=>event.method==='turn/completed')!.params.turn.status).toBe('completed')
    expect(requests).toHaveLength(3)
    const result=requests[2].input.findLast((value:any)=>value.type==='function_call_output').output
    expect(JSON.stringify(result)).toContain('FIXTURE_INSTALL_DONE')
    expect(JSON.stringify(result)).not.toContain('failed to parse')
    const commands=notifications.filter(event=>event.method==='item/completed'&&event.params.item.type==='commandExecution')
    expect(commands).toHaveLength(1)
    expect(commands[0].params.item.exitCode).toBe(0)
  }finally{await client?.close();await bridge?.close();server.stop(true);await rm(root,{recursive:true,force:true})}
},20000)


nativeTest('missing required MCP input reports an error and old empty history recovers without rewriting native records',async()=>{
  const root=await mkdtemp('/private/tmp/bgs-model-catalog-'),home=join(root,'home'),model='offline-empty-required-fixture'
  let client:BgsClient|undefined,bridge:Awaited<ReturnType<typeof startProviderBridge>>|undefined
  let phase:'seed'|'recover'='seed',seedCalls=0,recoverCalls=0,rejections=0,actions=0
  const notifications:{method:string;params:any}[]=[]
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(request.method==='GET')return new Response(null,{status:404})
    const body=await request.json() as any
    if(path==='/mcp'){
      if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'required-input-fixture',version:'1'}}})
      if(body.id===undefined)return new Response(null,{status:202})
      if(body.method==='tools/list')return Response.json({jsonrpc:'2.0',id:body.id,result:{tools:[{name:'browser_navigate',description:'Synthetic read-only URL check.',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']},annotations:{readOnlyHint:true}}]}})
      if(body.method==='tools/call'){
        if(typeof body.params.arguments?.url!=='string'){
          rejections++;return Response.json({jsonrpc:'2.0',id:body.id,result:{isError:true,content:[{type:'text',text:'Invalid arguments: url is required; no action executed.'}]}})
        }
        expect(body.params.arguments.url).toBe('https://fixture.invalid/corrected');actions++
        return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:'Corrected URL observed.'}]}})
      }
      throw Error('Unexpected MCP method')
    }
    if(path!=='/v1/responses')throw Error('Unexpected fixture route')
    const round=phase==='seed'?++seedCalls:++recoverCalls
    if(round>2)return new Response('No retry permitted',{status:400})
    const old=body.input.find((entry:any)=>entry.type==='function_call'&&entry.call_id==='missing-url')
    if(phase==='seed'&&round===2){
      expect(old.arguments).toBe('');return Response.json({error:{type:'invalid_request_error',param:'arguments',message:'`arguments` must be valid JSON'}},{status:400})
    }
    if(phase==='recover')expect(old.arguments).toBe('{}')
    const ns=body.tools.find((entry:any)=>entry.type==='namespace'&&entry.tools?.some((tool:any)=>tool.name==='browser_navigate'))
    expect(ns).toBeDefined()
    const item=round===1?{type:'function_call',id:phase+'-navigate',call_id:phase==='seed'?'missing-url':'correct-url',namespace:ns.name,name:'browser_navigate',arguments:phase==='seed'?'':'{"url":"https://fixture.invalid/corrected"}'}:
      {type:'message',id:'done',role:'assistant',status:'completed',content:[{type:'output_text',text:'Corrected call completed.',annotations:[]}]}
    const response={id:phase+'-'+round,object:'response',status:'completed',output:[item],usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
    return new Response([{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
  }})
  try{
    await mkdir(home)
    const env={...getSafeRuntimeProcessEnvironment(),BGS_HOME:home,OPENAI_API_KEY:'offline-only',OPENAI_BASE_URL:server.url.origin+'/v1',BEEGAME_MODEL:model}
    const connect=async()=>{
      const runtimeEnv={...env,...(bridge?{OPENAI_API_KEY:bridge.apiKey,OPENAI_BASE_URL:bridge.baseUrl}:{})}
      return BgsClient.connect({cwd:root,env:runtimeEnv,config:{...bgsProviderConfig(runtimeEnv),cli_auth_credentials_store:'file',mcp_servers:{'required-input-fixture':{url:server.url.origin+'/mcp'}}},onNotification:(method,params)=>{notifications.push({method,params})}})
    }
    const submit=async(threadId:string)=>{
      const count=notifications.filter(event=>event.method==='turn/completed').length
      await client!.request('turn/start',{threadId,input:[{type:'text',text:'Complete only the synthetic URL check.'}]})
      const deadline=Date.now()+10000
      while(notifications.filter(event=>event.method==='turn/completed').length===count){if(Date.now()>deadline)throw Error('Native error/recovery did not settle');await Bun.sleep(10)}
      return notifications.filter(event=>event.method==='turn/completed').at(-1)!.params.turn
    }
    client=await connect()
    const {thread}=await client.request('thread/start',{cwd:root,model,approvalPolicy:'never',sandbox:'workspace-write'})
    expect((await submit(thread.id)).status).toBe('failed')
    expect(actions).toBe(0);expect(rejections).toBe(1)
    const saved=await client.request('thread/read',{threadId:thread.id,includeTurns:false})
    const path=saved.thread.path
    await client.close();client=undefined;phase='recover'
    bridge=await startProviderBridge(env,{onUsage(){},resolveOutboundTarget:async value=>{
      const url=new URL(value);if(url.origin!==server.url.origin)throw Error('External fixture request forbidden')
      return {url,addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}
    }})
    client=await connect();await client.request('thread/resume',{threadId:thread.id,model})
    expect((await submit(thread.id)).status).toBe('completed')
    expect(actions).toBe(1);expect(rejections).toBe(1);expect(recoverCalls).toBe(2)
    const old=(await readFile(path,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(event=>event.type==='response_item'&&event.payload.type==='function_call'&&event.payload.call_id==='missing-url')
    expect(old.payload.arguments).toBe('')
  }finally{await client?.close();await bridge?.close();server.stop(true);await rm(root,{recursive:true,force:true})}
},30000)
