import {expect,test} from 'bun:test'
import {providerHttpError} from './http-error'
import {startProviderBridge} from './bridge'

test('HTTP errors retain only known protocol identifiers, never raw messages or arbitrary identifiers',async()=>{
  const safe=await providerHttpError(Response.json({error:{type:'invalid_request_error',code:'unsupported_value',
    param:'response_format',message:'PRIVATE_PROMPT Bearer secret-token',request_id:'PRIVATE_ID'}},{status:400}),AbortSignal.timeout(3000))
  expect(safe.status).toBe(400)
  expect(safe.identifiers).toEqual({type:'invalid_request_error',code:'unsupported_value',param:'response_format'})
  expect(safe.message).toBe('The selected model provider request failed (HTTP 400; type=invalid_request_error; code=unsupported_value; param=response_format)')
  expect(JSON.stringify(safe)).not.toContain('PRIVATE')
  const unknown=await providerHttpError(Response.json({error:{type:'PRIVATE_TYPE',code:'PRIVATE_CODE',param:'PRIVATE_PARAM',message:'PRIVATE_MESSAGE'}},{status:403}),AbortSignal.timeout(3000))
  expect(unknown.message).toBe('The selected model provider request failed (HTTP 403)')
  expect(unknown.identifiers).toEqual({})
  expect(JSON.stringify(unknown)).not.toContain('PRIVATE')
  const gemini=await providerHttpError(Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:'PRIVATE'}},{status:400}),AbortSignal.timeout(3000))
  expect(gemini.message).toBe('The selected model provider request failed (HTTP 400; type=INVALID_ARGUMENT)')
  expect(gemini.identifiers).toEqual({type:'INVALID_ARGUMENT'})
  const empty=await providerHttpError(new Response(null,{status:503}),AbortSignal.timeout(3000))
  expect(empty.identifiers).toEqual({})
  expect(empty.status).toBe(503)
})

test('malformed or oversized error bodies retain HTTP status and close the reader',async()=>{
  expect((await providerHttpError(new Response('<html>PRIVATE_ERROR</html>',{status:502}),AbortSignal.timeout(3000))).message).toContain('HTTP 502)')
  let cancelled=false
  const response=new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode(JSON.stringify({error:{type:'invalid_request_error',message:'x'.repeat(17000)}})))
  },cancel(){cancelled=true}}),{status:502})
  expect((await providerHttpError(response,AbortSignal.timeout(3000))).message).toContain('HTTP 502)')
  expect(cancelled).toBe(true)
})

test('an interrupted error body does not delay cancellation or replace HTTP status',async()=>{
  let cancelled=false
  const abort=new AbortController()
  const pending=providerHttpError(new Response(new ReadableStream({cancel(){cancelled=true}}),{status:400}),abort.signal)
  abort.abort()
  const result=await pending
  expect(result.status).toBe(400)
  expect(cancelled).toBe(true)
})

test('an error body that never finishes is bounded by the diagnostic deadline',async()=>{
  let cancelled=false
  const result=await providerHttpError(new Response(new ReadableStream({cancel(){cancelled=true}}),{status:503}),new AbortController().signal)
  expect(result.message).toContain('HTTP 503)')
  expect(cancelled).toBe(true)
},4000)

test('converted provider errors reach the native bridge with safe details and no retries',async()=>{
  const cases=[
    {status:400,error:{type:'invalid_request_error',code:'unsupported_value',param:'response_format'},
      expected:{type:'invalid_request_error',code:'unsupported_value',param:'response_format'}},
    {status:429,error:{type:'insufficient_quota',code:'insufficient_quota'},
      expected:{type:'provider_error',code:'insufficient_quota'}},
    {status:429,error:{type:'rate_limit_error',code:'rate_limit_exceeded'},
      expected:{type:'rate_limit_error',code:'rate_limit_exceeded'}},
    {status:403,error:{type:'PRIVATE_TYPE',code:'PRIVATE_CODE',param:'PRIVATE_PARAM'},
      expected:{type:'provider_error'}},
    {status:503,error:{type:'api_error',code:'server_error'},expected:{type:'api_error',code:'server_error'}},
  ]
  let calls=0
  let fixture=cases[0]!
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){
    calls++
    return Response.json({error:{...fixture.error,message:'PRIVATE_PROMPT Bearer PRIVATE_CREDENTIAL',
      request_id:'PRIVATE_ID'}},{status:fixture.status})
  }})
  try{
    for(const protocol of ['chat-completions','anthropic-messages','gemini']){
      const type=protocol==='anthropic-messages'?'anthropic':protocol==='gemini'?'gemini':'openai'
      const prefix=type.toUpperCase(),usage:any[]=[]
      const bridge=await startProviderBridge({BEEGAME_MODEL_TYPE:type,BEEGAME_API_PROTOCOL:protocol,
        [prefix+'_API_KEY']:'fixture-only',[prefix+'_BASE_URL']:upstream.url.origin,BEEGAME_MODEL:'fixture'},
        {onUsage:value=>{usage.push(value)},resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],
          lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
      try{
        for(const scenario of cases){
        fixture=scenario
        const callsBefore=calls
        usage.length=0
        const response=await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+bridge.apiKey},
          body:JSON.stringify({model:'fixture',input:'Synthetic',stream:true})})
        expect(response.status).toBe(scenario.status)
        const text=await response.text()
        expect(text).not.toContain('PRIVATE')
        const {message,...identifiers}=JSON.parse(text).error
        expect(identifiers).toEqual(scenario.expected)
        expect(message).toContain(`HTTP ${scenario.status}`)
        expect(calls).toBe(callsBefore+1)
        expect(usage).toEqual([{input_tokens:0,output_tokens:0,cache_read_tokens:0,
          cache_creation_tokens:0,total_tokens:0,incomplete:true}])
        }
      }finally{await bridge.close()}
    }
    expect(calls).toBe(3*cases.length)
  }finally{upstream.stop(true)}
},10000)
