import { afterAll, expect, mock, test } from 'bun:test'
// Only the upstream summary producers are mocked. Exercise the real summary,
// automatic-compact and reactive-compact error propagation without a provider.
const forkModule = {...await import('../../../utils/forkedAgent.js')}
const apiModule = {...await import('../../api/claude.js')}
const featureModule = {...await import('../../analytics/growthbook.js')}
let forkCalls=0, streamCalls=0, cacheSharing=true
let forkResult: any, forkError: Error | undefined, streamResult: any, streamError = true
mock.module('../../../utils/forkedAgent.js',()=>({...forkModule,runForkedAgent:async()=>{
  forkCalls++; if(forkError)throw forkError; return forkResult
}}))
mock.module('../../api/claude.js',()=>({...apiModule,queryModelWithStreaming:async function*(){
  streamCalls++; if(streamResult)yield streamResult; if(streamError)throw Error('stream disconnected')
}}))
mock.module('../../analytics/growthbook.js',()=>({...featureModule,getFeatureValue_CACHED_MAY_BE_STALE:(key:string,fallback:unknown)=>
  key==='tengu_compact_cache_prefix'?cacheSharing:fallback}))
const {streamCompactSummary,CompactRequestError} = await import('../compact.js')
const {autoCompactIfNeeded} = await import('../autoCompact.js')
const {reactiveCompactOnPromptTooLong,tryReactiveCompact} = await import('../reactiveCompact.js')
const {createUserMessage} = await import('../../../utils/messages.js')
const {resetStateForTests} = await import('../../../bootstrap/state.js')
afterAll(()=>{
  mock.module('../../../utils/forkedAgent.js',()=>forkModule)
  mock.module('../../api/claude.js',()=>apiModule)
  mock.module('../../analytics/growthbook.js',()=>featureModule)
  mock.restore();resetStateForTests()
})
function context() {
  return {options:{mainLoopModel:'claude-sonnet-4-6',tools:[],agentDefinitions:{activeAgents:[]}},
    getAppState:()=>({toolPermissionContext:{}}),abortController:new AbortController(),
    readFileState:new Map(),setSDKStatus:()=>{},onCompactProgress:()=>{},setStreamMode:()=>{},
    addNotification:()=>{}} as any
}
function reset() { forkCalls=streamCalls=0;cacheSharing=true;forkError=undefined;forkResult=undefined;streamResult=undefined;streamError=true }
const request=()=>({messages:[],summaryRequest:createUserMessage({content:'Summarize'}),appState:{} as any,
  context:context(),preCompactTokenCount:170000,cacheSafeParams:{} as any})

test('failed or incomplete fork never starts a second summary stream',async()=>{
  for(const value of [Error('ECONNRESET'),{messages:[]},{messages:[{type:'assistant',isApiErrorMessage:true,message:{content:[{type:'text',text:'API Error: stream ended'}]}}]}]) {
    reset();if(value instanceof Error)forkError=value;else forkResult=value
    await expect(streamCompactSummary(request())).rejects.toBeInstanceOf(CompactRequestError)
    expect(forkCalls).toBe(1);expect(streamCalls).toBe(0)
  }
})
test('successful fork returns its summary without a fallback',async()=>{
  reset()
  const assistant={type:'assistant',message:{content:[{type:'text',text:'Saved summary'}]}}
  forkResult={messages:[assistant],totalUsage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:0}}
  expect(await streamCompactSummary(request())).toBe(assistant as any)
  expect(streamCalls).toBe(0)
})
test('streaming-only summary failure is terminal and does not retry',async()=>{
  reset();cacheSharing=false
  await expect(streamCompactSummary(request())).rejects.toBeInstanceOf(CompactRequestError)
  expect(forkCalls).toBe(0);expect(streamCalls).toBe(1)
})
test('automatic and reactive compact propagate upstream failure instead of resuming the query',async()=>{
  reset();forkError=Error('ECONNRESET')
  const before=process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE='1'
  try {
    const messages=[createUserMessage({content:'x'.repeat(30000)})]
    const c=context(),params={toolUseContext:c,forkContextMessages:messages,systemPrompt:[],userContext:{},systemContext:{}} as any
    await expect(autoCompactIfNeeded(messages,c,params,'sdk')).rejects.toBeInstanceOf(CompactRequestError)
    expect(forkCalls).toBe(1);expect(streamCalls).toBe(0)
    await expect(reactiveCompactOnPromptTooLong(messages,params,{})).rejects.toBeInstanceOf(CompactRequestError)
    await expect(tryReactiveCompact({hasAttempted:false,querySource:'sdk',aborted:false,messages,cacheSafeParams:params})).rejects.toBeInstanceOf(CompactRequestError)
    expect(forkCalls).toBe(3);expect(streamCalls).toBe(0)
  } finally {if(before===undefined)delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;else process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=before}
})

test('streaming path discards partial summaries on disconnect, rejects empty/error summaries and retains success',async()=>{
  for(const value of [undefined, {type:'assistant',message:{content:[{type:'text',text:'API Error: disconnected'}]}},
    {type:'assistant',message:{content:[]}}]) {
    reset();cacheSharing=false;streamResult=value;streamError=false
    await expect(streamCompactSummary(request())).rejects.toBeInstanceOf(CompactRequestError)
    expect(streamCalls).toBe(1)
  }
  reset();cacheSharing=false;streamResult={type:'assistant',message:{content:[{type:'text',text:'partial summary'}]}}
  await expect(streamCompactSummary(request())).rejects.toBeInstanceOf(CompactRequestError)
  expect(streamCalls).toBe(1)
  reset();cacheSharing=false;streamError=false;streamResult={type:'assistant',message:{content:[{type:'text',text:'complete summary'}]}}
  expect(await streamCompactSummary(request())).toBe(streamResult)
  expect(streamCalls).toBe(1)
})
