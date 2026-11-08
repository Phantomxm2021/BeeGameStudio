import { expect, test, spyOn } from 'bun:test'
import { createProcessIsolatedModelRuntimeHost, BeeGameModelRuntimeError } from './model-runtime-host'

test('real auxiliary worker pins serialized addresses and returns usage on success, truncation and validation failure', async () => {
  let requests = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests++
    const body = await request.json() as any
    if (new URL(request.url).pathname === '/v1/messages') {
      const events = body.model === 'missing-terminal-usage'
        ? [
            { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'offline partial usage' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
            { type: 'message_stop' },
          ]
        : [{ type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } }]
      return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''))
    }
    if (['max_output_tokens', 'content_filter', 'unknown'].includes(body.model)) {
      return Response.json({ status: 'incomplete', incomplete_details: { reason: body.model },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'PRIVATE_TRUNCATED_DRAFT' }] }],
        usage: { input_tokens: 100, output_tokens: 2048 } })
    }
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'offline success' }] }],
      ...(body.model !== 'missing-usage' ? { usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } } } : {}) })
  } })
  const host = createProcessIsolatedModelRuntimeHost({ outboundTargetPolicyOptions: {},
    resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  const base = { cwd: process.cwd(), systemPrompt: 'Offline fixture', messages: [{ role: 'user' as const, content: 'Offline' }], querySource: 'offline-test' }
  const endpoint = `http://synthetic-worker.invalid:${upstream.port}`
  try {
    const result = await host.generateWithUsage!({ ...base,
      runtimeEnv: { OPENAI_API_KEY: 'synthetic', OPENAI_BASE_URL: endpoint, BEEGAME_MODEL: 'fixture' } })
    expect(result.content).toBe('offline success')
    expect(result.usage).toMatchObject({ input_tokens: 90, cache_read_tokens: 10, output_tokens: 20, total_tokens: 120 })
    for (const partial of [true, false]) {
      try {
        await host.generateWithUsage!({ ...base,
          runtimeEnv: partial ? { BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_API_KEY: 'synthetic', ANTHROPIC_BASE_URL: endpoint, BEEGAME_MODEL: 'fixture' }
            : { OPENAI_API_KEY: 'synthetic', OPENAI_BASE_URL: endpoint, BEEGAME_MODEL: 'fixture' },
          structuredOutput: { name: 'required', description: 'Offline', inputSchema: { type: 'object' } },
        })
        throw Error('Expected a model failure')
      } catch (error) {
        expect(error).toBeInstanceOf(BeeGameModelRuntimeError)
        expect((error as BeeGameModelRuntimeError).diagnosticId).toEqual(expect.any(String))
        if(!partial) {
          expect((error as BeeGameModelRuntimeError).failureCode).toBe('structured-output-missing')
          expect((error as Error).message).toContain('matching=0, functions=0, messages=1, items=1')
          expect((error as Error).message).not.toContain('offline success')
        }
        const usage = (error as BeeGameModelRuntimeError).usage
        expect(usage?.total_tokens).toBe(partial ? 100 : 120)
        expect(usage?.incomplete).toBe(partial ? true : undefined)
      }
    }
    const unknown = await host.generateWithUsage!({ ...base,
      runtimeEnv: { OPENAI_API_KEY: 'synthetic', OPENAI_BASE_URL: endpoint, BEEGAME_MODEL: 'missing-usage' } })
    expect(unknown.content).toBe('offline success')
    expect(unknown.usage).toMatchObject({ total_tokens: 0, incomplete: true })
    try {
      await host.generateWithUsage!({ ...base,
        runtimeEnv: { BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_API_KEY: 'synthetic', ANTHROPIC_BASE_URL: endpoint, BEEGAME_MODEL: 'missing-terminal-usage' },
        structuredOutput: { name: 'required', description: 'Offline', inputSchema: { type: 'object' } },
      })
      throw Error('Expected structured output validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(BeeGameModelRuntimeError)
      expect((error as BeeGameModelRuntimeError).usage).toMatchObject({ total_tokens: 100, incomplete: true })
    }
    for (const [model, message] of [
      ['max_output_tokens', 'Model response reached its output token limit before completion'],
      ['content_filter', 'Model response was stopped by the provider content filter'],
      ['unknown', 'Model response was incomplete'],
    ]) {
      try {
        await host.generateWithUsage!({ ...base, runtimeEnv: {
          OPENAI_API_KEY: 'synthetic', OPENAI_BASE_URL: endpoint, BEEGAME_MODEL: model!,
        } })
        throw Error('Expected incomplete output to be rejected')
      } catch (error) {
        expect(error).toBeInstanceOf(BeeGameModelRuntimeError)
        expect((error as Error).message).toBe(message!)
        expect((error as BeeGameModelRuntimeError).failureCode).toBe(model==='max_output_tokens'?'max-output-tokens':model==='content_filter'?'content-filter':'incomplete-response')
        expect((error as Error).message).not.toContain('PRIVATE_TRUNCATED_DRAFT')
        expect((error as BeeGameModelRuntimeError).usage).toMatchObject({ output_tokens: 2048, total_tokens: 2148 })
      }
    }
    expect(requests).toBe(8) // One request per operation, no retries on truncation.
  } finally { upstream.stop(true) }
}, 15_000)


test.each(['responses','chat-completions','anthropic-messages','gemini'])(
  'real auxiliary worker preserves %s HTTP failures across IPC without retry or private body leakage', async protocol => {
  let calls = 0
  const id = '01a1aff8-b9b5-7b65-98c3-87411d962d3e'
  const upstream = Bun.serve({hostname:'127.0.0.1',port:0,fetch() {
    calls++
    return Response.json({error:{type:'server_error',code:'inference_failed',message:'PRIVATE_PROMPT Bearer PRIVATE_TOKEN'}},
      {status:429,headers:{'x-opencode-log-id':id,'retry-after':'2'}})
  }})
  const host = createProcessIsolatedModelRuntimeHost({outboundTargetPolicyOptions:{},
    resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],
      lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
  const type = protocol==='anthropic-messages'?'anthropic':protocol==='gemini'?'gemini':'openai'
  const env = {BEEGAME_MODEL_TYPE:type,BEEGAME_API_PROTOCOL:protocol,BEEGAME_MODEL:'fixture',
    [type.toUpperCase()+'_API_KEY']:'synthetic',[type.toUpperCase()+'_BASE_URL']:`http://synthetic-worker.invalid:${upstream.port}`}
  try {
    await host.generate({cwd:process.cwd(),systemPrompt:'Offline fixture',messages:[{role:'user',content:'Offline'}],
      maxTokens:8192,querySource:'beegame_idea_intake',runtimeEnv:env})
    throw Error('Expected provider rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(BeeGameModelRuntimeError)
    const failure = error as BeeGameModelRuntimeError
    expect(failure).toMatchObject({stage:'model_request',httpStatus:429,failureCode:'upstream-http-error',
      providerDiagnostics:{bodyStatus:'parsed',type:'server_error',code:'inference_failed',requestId:id,retryAfter:2}})
    expect(failure.message).toContain('HTTP 429')
    expect(failure.message).toContain('inference_failed')
    expect(JSON.stringify(failure)).not.toContain('PRIVATE')
    expect(failure.diagnosticId).toEqual(expect.any(String))
    expect(calls).toBe(1)
  } finally { upstream.stop(true) }
},15000)


test('structured output failures retain count diagnostics without model text, names or arguments',async()=>{
  const logged:unknown[][]=[]
  const log=spyOn(console,'warn').mockImplementation((...args)=>{logged.push(args)})
  let requests=0
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    requests++
    const body=await request.json() as any
    const call={type:'function_call',name:'required',arguments:'{"private":"PRIVATE_ARGUMENTS"}'}
    const output=body.model==='text-only'?[{type:'message',content:[{type:'output_text',text:'PRIVATE_RESPONSE_TEXT'}]}]
      :body.model==='wrong-name'?[{...call,name:'PRIVATE_FUNCTION_NAME'}]:[call,call]
    return Response.json({status:'completed',output,usage:{input_tokens:10,output_tokens:2,total_tokens:12}})
  }})
  const host=createProcessIsolatedModelRuntimeHost({outboundTargetPolicyOptions:{},
    resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
  try{
    for(const [model,summary] of [['text-only','matching=0, functions=0, messages=1, items=1'],
      ['wrong-name','matching=0, functions=1, messages=0, items=1'],['duplicate','matching=2, functions=2, messages=0, items=2']]){
      await expect(host.generate({cwd:process.cwd(),systemPrompt:'Fixture',messages:[{role:'user',content:'Fixture'}],querySource:'offline-counts',
        runtimeEnv:{OPENAI_API_KEY:'PRIVATE_API_KEY',OPENAI_BASE_URL:`http://synthetic-worker.invalid:${upstream.port}`,BEEGAME_MODEL:model!},
        structuredOutput:{name:'required',description:'Fixture result',inputSchema:{type:'object'}}})).rejects.toMatchObject({failureCode:'structured-output-missing'})
      expect(logged.at(-1)?.[1]).toMatchObject({failureCode:'structured-output-missing',responseSummary:expect.stringContaining(summary!)})
    }
    expect(requests).toBe(3)
    for(const text of ['PRIVATE_RESPONSE_TEXT','PRIVATE_ARGUMENTS','PRIVATE_FUNCTION_NAME','PRIVATE_API_KEY'])expect(JSON.stringify(logged)).not.toContain(text)
  }finally{log.mockRestore();upstream.stop(true)}
},15000)
