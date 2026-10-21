import { expect, test } from 'bun:test'
import { createProcessIsolatedModelRuntimeHost } from '../beegame/model-runtime-host'

test('subscription worker accepts its terminal response without reading a failing tail, and rejects a missing terminal event', async () => {
  const authPath = new URL('./auth.ts', import.meta.url).pathname
  const workerPath = new URL('../beegame/model-runtime-worker.ts', import.meta.url).pathname
  for (const completed of [true, false]) {
    // Module mocks stay inside this child; no login or outbound request occurs.
    const script = `
      import { mock } from 'bun:test';
      mock.module(${JSON.stringify(authPath)}, () => ({
        getDefaultBgsModel: async () => 'fixture',
        createChatGPTResponsesStream: async () => (async function* () {
          yield { type: ${JSON.stringify(completed ? 'response.completed' : 'response.created')},
            response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Completed' }] }] } };
          throw Error('Synthetic transport tail');
        })(),
      }));
      const result = new Promise(resolve => { process.send = message => { resolve(message); return true }; });
      await import(${JSON.stringify(workerPath)});
      process.emit('message', { type: 'model.generate', requestId: 'offline', input: {
        runtimeEnv: { OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_CONFIG_DIR: '/private/tmp/synthetic', BEEGAME_MODEL: 'fixture' },
        approvedOutboundTargets: {}, systemPrompt: 'Offline', messages: [],
      } });
      console.log(JSON.stringify(await result));
    `
    const child = Bun.spawn([process.execPath, '-e', script], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    try {
      const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(error).toBe('')
      expect(exit).toBe(0)
      const result = JSON.parse(output)
      expect(result.type).toBe(completed ? 'model.result' : 'model.error')
      expect(result.usage).toMatchObject({ total_tokens: 0, incomplete: true })
      if (completed) expect(result.content).toBe('Completed')
      else expect(result.message).toBe('Synthetic transport tail')
    } finally { child.kill() }
  }
})

test('invalid or unsupported explicit temperatures fail before outbound work', async () => {
  let outbound = 0, workers = 0
  const host = createProcessIsolatedModelRuntimeHost({ outboundTargetPolicyOptions: {},
    resolveOutboundTarget: async () => { outbound++; return null },
    runWorker: async () => { workers++; return 'unexpected' },
  })
  const input = { cwd: '/private/tmp', runtimeEnv: {}, systemPrompt: 'Synthetic', messages: [], querySource: 'test' }
  for (const temperature of [NaN, Infinity, -1, 2.1])
    await expect(host.generate({ ...input, temperature })).rejects.toThrow('finite number')
  await expect(host.generate({ ...input, temperature: 0.2,
    runtimeEnv: { OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_CONFIG_DIR: '/private/tmp/synthetic-subscription' } })).rejects.toThrow('explicit temperature')
  expect(outbound).toBe(0); expect(workers).toBe(0)
})

test('the actual isolated intake worker uses a forced structured function and records cache usage once', async () => {
  const requests: any[] = []
  const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    const body = await request.json() as any
    requests.push({url:new URL(request.url).pathname,auth:request.headers.get('authorization'),body})
    return Response.json({status:'completed',output:[{type:'function_call',name:'intake',arguments:'{"accepted":true}'}],
      usage:{input_tokens:10,output_tokens:2,input_tokens_details:{cached_tokens:3}}})
  }})
  const host = createProcessIsolatedModelRuntimeHost({outboundTargetPolicyOptions:{},
    resolveOutboundTarget:async value => ({url:new URL(value),addresses:['127.0.0.1'],
      lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
  try {
    const result = await host.generateWithUsage!({cwd:'/private/tmp',modelType:'openai',
      runtimeEnv:{OPENAI_BASE_URL:server.url.toString()+'v1',OPENAI_API_KEY:'synthetic-secret',BEEGAME_MODEL:'synthetic-model'},
      systemPrompt:'Synthetic intake',messages:[{role:'user',content:'Synthetic request'}],querySource:'test',
      temperature:0,
      structuredOutput:{name:'intake',description:'Fixture',inputSchema:{type:'object',properties:{accepted:{type:'boolean'}},required:['accepted'],additionalProperties:false}}})
    expect(result).toEqual({content:'{"accepted":true}',usage:{input_tokens:7,output_tokens:2,cache_read_tokens:3,cache_creation_tokens:0,total_tokens:12}})
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({url:'/v1/responses',auth:'Bearer synthetic-secret',body:{model:'synthetic-model',tools:[{type:'function',name:'intake'}],tool_choice:{type:'function',name:'intake'},store:false,temperature:0}})
  } finally {server.stop(true)}
},15000)

for(const protocol of ['chat-completions','anthropic-messages','gemini'] as const) {
  test('isolated structured worker and image input use '+protocol+' without an agent process',async()=>{
    let received:any
    const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
      const body=await request.json() as any;received={body,path:new URL(request.url).pathname}
      const name=protocol==='chat-completions'?body.tools[0].function.name:protocol==='anthropic-messages'?body.tools[0].name:body.tools[0].functionDeclarations[0].name
      const args={accepted:true}
      const events=protocol==='chat-completions'?[{choices:[{delta:{tool_calls:[{index:0,id:'call_fixture',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:2,prompt_tokens_details:{cached_tokens:3}}}]
        :protocol==='anthropic-messages'?[{type:'message_start',message:{usage:{input_tokens:5,cache_read_input_tokens:3,cache_creation_input_tokens:2,output_tokens:0}}},
          {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'toolu_fixture',name,input:args}},
          {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:2}},{type:'message_stop'}]
        :[{candidates:[{content:{role:'model',parts:[{functionCall:{id:'call_fixture',name,args},thoughtSignature:'fixture-signature'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,cachedContentTokenCount:3}}]
      return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}})
    }})
    const type=protocol==='anthropic-messages'?'anthropic':protocol==='gemini'?'gemini':'openai',prefix=type.toUpperCase()
    const host=createProcessIsolatedModelRuntimeHost({outboundTargetPolicyOptions:{},resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
    try {
      const result=await host.generateWithUsage!({cwd:'/private/tmp',modelType:type,runtimeEnv:{BEEGAME_API_PROTOCOL:protocol,BEEGAME_MODEL:'fixture-model',[prefix+'_BASE_URL']:server.url.toString().replace(/\/$/,''),[prefix+'_API_KEY']:'fixture-secret'},
        systemPrompt:'Synthetic classification',messages:[{role:'user',content:[{type:'text',text:'Fixture'},{type:'image',source:{type:'base64',media_type:'image/png',data:'AQID'}}]}],
        temperature:0.2,querySource:'test',structuredOutput:{name:'intake',description:'Synthetic result',inputSchema:{type:'object',properties:{accepted:{type:'boolean'}},required:['accepted']}}})
      expect(result.content).toBe('{"accepted":true}')
      expect(result.usage).toMatchObject({input_tokens:protocol==='anthropic-messages'?5:7,cache_read_tokens:3,cache_creation_tokens:protocol==='anthropic-messages'?2:0,total_tokens:12})
      expect(JSON.stringify(received.body)).toContain('AQID')
      expect(JSON.stringify(received.body)).not.toContain('fixture-secret')
      expect(protocol==='gemini'?received.body.generationConfig.temperature:received.body.temperature).toBe(0.2)
    }finally{server.stop(true)}
  },15000)
}


test('large plain intake payload returns through the real worker IPC without tools',async()=>{
  let received=0
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const body=await request.json() as any;received=JSON.stringify(body).length
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'{"fixture":true}'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})
  }})
  const host=createProcessIsolatedModelRuntimeHost({outboundTargetPolicyOptions:{},resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
  try {
    const result=await host.generateWithUsage!({cwd:'/private/tmp',runtimeEnv:{OPENAI_BASE_URL:server.url.toString().replace(/\/$/,''),OPENAI_API_KEY:'synthetic',BEEGAME_MODEL:'fixture',BEEGAME_API_PROTOCOL:'chat-completions'},systemPrompt:'Synthetic intake requirements. '.repeat(4000),messages:[{role:'user',content:'Synthetic snake request'}],querySource:'test'})
    expect(result.content).toBe('{"fixture":true}')
    expect(received).toBeGreaterThan(100000)
    expect(result.usage?.total_tokens).toBe(12)
  }finally{server.stop(true)}
},10000)
