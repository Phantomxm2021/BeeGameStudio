import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BgsClient } from './client'
import { bgsProviderConfig } from './runner'
import { loadBgsModelCatalog } from './model-catalog'
import { startProviderBridge } from '../model-providers/bridge'
import { getSafeRuntimeProcessEnvironment } from '../beegame/runtime-process-environment'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip

// Real CLI, production catalog loader and bridge, scripted localhost Responses.
// No provider capability probes, model generation, project work or capacity change.
nativeTest('BGS bridge catalog preserves native prompts, tools and capacity across cold resume', async () => {
  const root = await mkdtemp('/private/tmp/bgs-model-catalog-'), home = join(root, 'home'), model = 'offline-catalog-fixture'
  const requests: any[] = [], notifications: {method:string;params:any}[] = []
  let client: BgsClient | undefined, bridge: Awaited<ReturnType<typeof startProviderBridge>> | undefined
  let unexpectedRequests=0
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
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
        modelCatalog:await loadBgsModelCatalog({cwd:root,env}),onUsage(){},
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
    expect(models).toEqual(expect.arrayContaining([...baselineModels,model]))
    const explicit = await client.request('thread/start',{cwd:root,model})
    await submit(explicit.thread.id)
    expect(requests).toHaveLength(2)
    const developer = (body:any) => body.input.filter((item:any)=>item.role==='developer').map((item:any)=>item.content)
    expect(developer(requests[1])).toEqual(developer(requests[0]))
    expect(requests[1].tools).toEqual(requests[0].tools)
    expect(requests[1].reasoning).toEqual(requests[0].reasoning)
    expect(JSON.stringify(developer(requests[1]))).not.toContain('## Planning')
    expect(JSON.stringify(requests[1].tools)).not.toContain('"name":"update_plan"')
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
    expect(requests[2].tools).toEqual(requests[1].tools)
    const windows = notifications.filter(n=>n.method==='thread/tokenUsage/updated').map(n=>n.params.tokenUsage.modelContextWindow)
    expect(windows.length).toBeGreaterThanOrEqual(3)
    expect(windows.every(window=>window===258_400)).toBe(true)
    expect(unexpectedRequests).toBe(0)
  } finally {await client?.close();await bridge?.close();server.stop(true);await rm(root,{recursive:true,force:true})}
},60_000)
