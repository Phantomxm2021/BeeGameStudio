import {expect,spyOn,test} from 'bun:test'
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
  expect((await providerHttpError(new Response('<html>PRIVATE_ERROR</html>',{status:502}),AbortSignal.timeout(3000))).diagnostics.bodyStatus).toBe('invalid')
  let cancelled=false
  const response=new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode(JSON.stringify({error:{type:'invalid_request_error',message:'x'.repeat(17000)}})))
  },cancel(){cancelled=true}}),{status:502,headers:{'retry-after':'30'}})
  const result=await providerHttpError(response,AbortSignal.timeout(3000))
  expect(result.status).toBe(502)
  expect(result.diagnostics).toEqual({bodyStatus:'too-large',retryAfter:30})
  expect(cancelled).toBe(true)
})

test('an interrupted error body does not delay cancellation or replace HTTP status',async()=>{
  let cancelled=false
  const abort=new AbortController()
  const pending=providerHttpError(new Response(new ReadableStream({cancel(){cancelled=true}}),{status:400}),abort.signal)
  abort.abort()
  const result=await pending
  expect(result.status).toBe(400)
  expect(result.diagnostics.bodyStatus).toBe('incomplete')
  expect(cancelled).toBe(true)
})

test('an error body that never finishes is bounded by the diagnostic deadline',async()=>{
  let cancelled=false
  const result=await providerHttpError(new Response(new ReadableStream({cancel(){cancelled=true}}),{status:503}),new AbortController().signal)
  expect(result.message).toContain('HTTP 503)')
  expect(result.diagnostics.bodyStatus).toBe('incomplete')
  expect(cancelled).toBe(true)
},4000)

test('converted provider errors reach the native bridge with safe details and no retries',async()=>{
  const cases=[
    {status:400,error:{type:'invalid_request_error',code:'unsupported_value',param:'response_format'},
      expected:{type:'invalid_request_error',code:'unsupported_value',param:'response_format'}},
    {status:429,error:{type:'insufficient_quota',code:'insufficient_quota'},
      expected:{type:'insufficient_quota',code:'insufficient_quota'}},
    {status:429,error:{type:'rate_limit_error',code:'rate_limit_exceeded'},
      expected:{type:'rate_limit_error',code:'rate_limit_exceeded'}},
    {status:403,error:{type:'PRIVATE_TYPE',code:'PRIVATE_CODE',param:'PRIVATE_PARAM'},
      expected:{type:'provider_error'}},
    {status:503,error:{type:'api_error',code:'server_error'},expected:{type:'api_error',code:'server_error'}},
  ]
  let calls=0
  let fixture=cases[0]!
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
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

test('top-level Go envelopes and message-only upstream reasons retain safe evidence without guessing from 429', async () => {
  for (const [body, expected] of [
    [{type:'GoUsageLimitError',message:'Monthly usage limit reached. PRIVATE_ACCOUNT https://private.invalid'},
      {type:'GoUsageLimitError',messageReason:'monthly_usage_limit'}],
    [{error:{type:'GoUsageLimitError',message:'5-hour usage limit reached. PRIVATE_ACCOUNT'}},
      {type:'GoUsageLimitError',messageReason:'rolling_usage_limit'}],
    [{type:'rate_limit_error',message:'Error from provider (Console Go): Upstream request failed: [rate_limit_exceeded] Output token rate limit exceeded. PRIVATE_PROMPT'},
      {type:'rate_limit_error',messageCode:'rate_limit_exceeded',messageReason:'output_token_rate_limit'}],
    [{error:{type:'server_error',message:'Upstream request failed: Endpoint is unavailable. PRIVATE_URL'}},
      {type:'server_error',messageReason:'endpoint_unavailable'}],
    [{error:{code:'inference_failed',message:'PRIVATE_UNKNOWN'}}, {code:'inference_failed'}],
    [{error:{message:'PRIVATE_PROMPT says insufficient_quota or Rate limit exceeded.'}}, {}],
  ] as const) {
    const result = await providerHttpError(Response.json(body,{status:429}),new AbortController().signal)
    expect(result.diagnostics).toEqual({bodyStatus:'parsed',...expected})
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  }
})

test('diagnostic headers retain only typed retry, rate counters and correlation IDs even when the body is invalid', async () => {
  const id='01a185aa-eb4f-7583-98c8-3edc62c207a2'
  const result=await providerHttpError(new Response('PRIVATE_HTML',{status:429,headers:{
    'x-request-id':id,'retry-after':'120','x-ratelimit-limit-requests':'100',
    'x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'1m30s',
    'x-ratelimit-limit-tokens':'10000','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'6s',
    authorization:'Bearer PRIVATE_CREDENTIAL','set-cookie':'PRIVATE_COOKIE','x-private':'PRIVATE_HEADER',
  }}),new AbortController().signal)
  expect(result.diagnostics).toEqual({bodyStatus:'invalid',requestId:id,retryAfter:120,rateLimits:{
    'x-ratelimit-limit-requests':100,'x-ratelimit-remaining-requests':0,'x-ratelimit-reset-requests':'1m30s',
    'x-ratelimit-limit-tokens':10000,'x-ratelimit-remaining-tokens':0,'x-ratelimit-reset-tokens':'6s',
  }})
  const date='Thu, 29 Oct 2026 04:00:00 GMT'
  const dated=await providerHttpError(new Response(null,{status:429,headers:{'retry-after':date}}),new AbortController().signal)
  expect(dated.diagnostics).toEqual({bodyStatus:'empty',retryAfter:date})
  const invalid=await providerHttpError(Response.json({error:{type:'PRIVATE_TYPE',code:'PRIVATE_CODE',
    param:'PRIVATE_PARAM',request_id:'sk-PRIVATE_KEY',message:'Bearer PRIVATE_KEY'}},{status:400,headers:{
    'x-request-id':'Bearer PRIVATE_KEY','retry-after':'https://PRIVATE.invalid/120',
    'x-ratelimit-limit-requests':'PRIVATE_ACCOUNT','x-ratelimit-reset-tokens':'PRIVATE January 1, 2026',
  }}),new AbortController().signal)
  expect(invalid.diagnostics).toEqual({bodyStatus:'parsed'})
  expect(JSON.stringify([result,dated,invalid])).not.toContain('PRIVATE')
})

test.each(['chat-completions','anthropic-messages','gemini','responses'])(
  '%s HTTP failure persists bounded diagnostics on the actual bridge path without retries or fallback',async protocol=>{
  const records:Record<string,any>[]=[]
  const capture=spyOn(console,'info').mockImplementation((value:unknown)=>{
    if(typeof value==='string' && value.startsWith('[model-request] ')) records.push(JSON.parse(value.slice(16)))
  })
  let calls=0
  const paths:string[]=[],models:string[]=[]
  let envelope:unknown={type:'GoUsageLimitError',message:'Weekly usage limit reached. PRIVATE_ACCOUNT'}
  let status=429
  const id='01a185aa-eb4f-7583-98c8-3edc62c207a2'
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    calls++;paths.push(new URL(request.url).pathname)
    const input=await request.json() as {model?:string}; if(input.model)models.push(input.model)
    return Response.json(envelope,{status,headers:{'retry-after':'90','x-request-id':id,
      'x-ratelimit-remaining-tokens':'0','set-cookie':'PRIVATE_COOKIE'}})
  }})
  const prefix=protocol==='anthropic-messages'?'ANTHROPIC':protocol==='gemini'?'GEMINI':'OPENAI'
  const bridge=await startProviderBridge({BEEGAME_MODEL_TYPE:prefix.toLowerCase(),BEEGAME_API_PROTOCOL:protocol,
    [prefix+'_API_KEY']:'PRIVATE_KEY',[prefix+'_BASE_URL']:upstream.url.origin,BEEGAME_MODEL:'fixture-model'},
    {sessionId:'PRIVATE_SESSION',onUsage(){},resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],
      lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
  try{
    for(const scenario of [
      {status:429,body:envelope,expected:{type:'GoUsageLimitError',messageReason:'weekly_usage_limit'}},
      {status:429,body:{error:{message:'Upstream request failed: [rate_limit_exceeded] Rate limit exceeded. PRIVATE_PROMPT'}},
        expected:{messageCode:'rate_limit_exceeded',messageReason:'rate_limit'}},
      {status:400,body:{error:{type:'invalid_request_error',code:'unsupported_parameter',param:'tools',message:'PRIVATE_PROMPT'}},
        expected:{type:'invalid_request_error',code:'unsupported_parameter',param:'tools'}},
      {status:429,body:{error:{code:'inference_failed',message:'PRIVATE_UNKNOWN'}},expected:{code:'inference_failed'}},
    ]){
      envelope=scenario.body;status=scenario.status;records.length=0
      const before=calls
      const response=await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+bridge.apiKey},
        body:JSON.stringify({model:'fixture-model',input:'PRIVATE_INPUT',stream:true})})
      const body=await response.text()
      expect(response.status).toBe(status)
      if(protocol==='responses') {
        expect(body).toBe(JSON.stringify(envelope)) // native error transport is unchanged
        expect(response.headers.get('retry-after')).toBe('90')
      } else {
        expect(body).not.toContain('PRIVATE')
        expect(response.headers.has('retry-after')).toBe(false) // diagnostics do not add retry policy
      }
      expect(records.map(row=>row.event)).toEqual(['received','upstream-started','upstream-headers','finished'])
      const finished=records[3]!
      expect(finished.error).toEqual({bodyStatus:'parsed',requestId:id,retryAfter:90,
        rateLimits:{'x-ratelimit-remaining-tokens':0},...scenario.expected})
      expect(finished.httpStatus).toBe(status)
      expect(finished.requestId).toBe(records[0]!.requestId)
      expect(JSON.stringify(records)).not.toContain('PRIVATE')
      expect(calls).toBe(before+1)
    }
    expect(calls).toBe(4)
    expect(new Set(paths).size).toBe(1)
    expect(models.every(model=>model==='fixture-model')).toBe(true)
  }finally{await bridge.close();upstream.stop(true);capture.mockRestore()}
},10000)
