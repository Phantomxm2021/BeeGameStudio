import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runNativeFileAgent,nativeFileAgentEnvironment} from '../native-file-agent'
const cli=process.env.BEEGAME_REVIEW_TEST_CLI??join(import.meta.dir,'../../../../dist/cli-bun.js')
test('stream activity is observable without leaking payloads', async () => {
 const dir=await realpath(await mkdtemp(join(tmpdir(),'native-stream-')))
 const workspace=join(dir,'workspace');await mkdir(workspace)
 const progress:any[]=[]
 try {
  const result=await runNativeFileAgent({command:[process.execPath,join(import.meta.dir,'fixtures/native-file-stream.ts')],env:{},
   workspacePath:workspace,writablePaths:[],prompt:'offline',schema:{type:'object'},logPath:join(dir,'log.jsonl'),
   onProgress:p=>{progress.push(p)}})
  expect(result.failure).toBeUndefined()
  const raw=await readFile(join(dir,'log.jsonl'),'utf8')
  expect(raw).not.toContain('PRIVATE_MODEL_TEXT');expect(raw).not.toContain('PRIVATE_STDERR_SECRET')
  const events=raw.trim().split('\n').map(line=>JSON.parse(line))
  expect(events.filter(e=>e.event==='native.task_lifecycle').map(e=>e.data.subtype))
   .toEqual(['task_started','task_progress','task_notification'])
  expect(raw).not.toContain('PRIVATE_TASK_')
  expect(events.filter(e=>e.event==='stream_event'&&e.data.deltaType==='text_delta')).toHaveLength(5)
  expect(events.some(e=>e.event==='stdout_activity')).toBe(true)
  expect(events.some(e=>e.event==='stderr_activity')).toBe(true)
  expect(events.filter(e=>e.event==='upstream_wait_started')).toHaveLength(1)
  expect(events.filter(e=>e.event==='upstream_first_stream')).toHaveLength(1)
  expect(events.find(e=>e.event==='upstream_first_stream').data.waitMs).toBeGreaterThanOrEqual(0)
  expect(events.at(-1).data).toMatchObject({streamEvents:6,stdoutDrained:true})
  expect(events.at(-1).data.lastStdoutAt).toBeTruthy()
  expect(progress.some(p=>p.message.includes('流事件'))).toBe(true)
  expect(progress.some(p=>p.message==='等待上游模型响应')).toBe(true)
 } finally {await rm(dir,{recursive:true,force:true})}
})
test('max-token truncation is correlated with an incomplete tool input', async () => {
 const dir=await realpath(await mkdtemp(join(tmpdir(),'native-truncated-tool-')))
 const workspace=join(dir,'workspace');await mkdir(workspace)
 try {
  const result=await runNativeFileAgent({command:[process.execPath,join(import.meta.dir,'fixtures/native-file-truncated-tool.ts')],env:{},
   workspacePath:workspace,writablePaths:['output.json'],prompt:'offline',logPath:join(dir,'log.jsonl')})
  expect(result.failure).toBeUndefined()
  const events=(await readFile(join(dir,'log.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  expect(events.find(event=>event.event==='tool_result')).toMatchObject({data:{
   responseStopReason:'max_tokens',failureCause:'response_truncated_tool_input'}})
  expect(events.find(event=>event.event==='response.truncated_tool_input')).toMatchObject({data:{
   tool:'Write',responseStopReason:'max_tokens',modelContinues:true}})
 } finally {await rm(dir,{recursive:true,force:true})}
})
for(const mode of ['files','working-files','retry-limit'] as const)test('real native CLI: '+mode,async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'native-file-boundary-')))
 const workspace=join(dir,'workspace');await mkdir(workspace)
 await writeFile(join(workspace,'target.md'),'ORIGINAL\n');await writeFile(join(dir,'outside.md'),'SECRET\n')
 await symlink(join(dir,'outside.md'),join(workspace,'link.md'))
 await mkdir(join(workspace,'docs'));await writeFile(join(workspace,'docs/GDD.md'),'Test geometry: legs 3 and 4.\n')
 const requests:any[]=[];let n=0;const abort=new AbortController()
 const calls=[
  {name:'Read',input:{file_path:join(workspace,'target.md')}},
  {name:'Read',input:{file_path:join(dir,'outside.md')}},
  {name:'Read',input:{file_path:join(workspace,'link.md')}},
  {name:'Edit',input:{file_path:join(workspace,'target.md'),old_string:'ORIGINAL',new_string:'EDITED'}},
  {name:'Write',input:{file_path:join(dir,'outside.md'),content:'BAD'}},
  {name:'Write',input:{file_path:join(workspace,'other.md'),content:'BAD'}},
  {name:'Write',input:{file_path:join(workspace,'target.md'),content:'FINAL\n'}},
  ...(mode==='working-files'?[{name:'Write',input:{file_path:join(workspace,'docs/GDD.md'),content:'BAD'}}]:[]),
  {name:'StructuredOutput',input:{ok:true}},
 ]
 const event=(x:any)=>'event: '+x.type+'\ndata: '+JSON.stringify(x)+'\n\n'
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const path=new URL(request.url).pathname
  if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
  if(!path.endsWith('/messages'))return new Response('',{status:404})
  const body=await request.json() as any;requests.push(body);n++
  if(n>12){abort.abort();return new Response('',{status:500})}
  const call=mode==='retry-limit'?{name:'StructuredOutput',input:{wrong:true}}:calls[n-1]
  const block=call?{type:'tool_use',id:'tool-'+n,...call}:{type:'text',text:'Done.'}
  const reason=call?'tool_use':'end_turn'
  return new Response(event({type:'message_start',message:{id:'m-'+n,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
   event({type:'content_block_start',index:0,content_block:call?{...block,input:{}}:{type:'text',text:''}})+
   event({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Done.'}})+
   event({type:'content_block_stop',index:0})+
   event({type:'message_delta',delta:{stop_reason:reason,stop_sequence:null},usage:{output_tokens:5}})+event({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
 }})
 const timer=setTimeout(()=>abort.abort(),25000)
 const messages:any[]=[];const progress:any[]=[]
 try {
  const result=await runNativeFileAgent({command:[process.execPath,cli],
   env:{...nativeFileAgentEnvironment({BEEGAME_CONFIG_DIR:join(dir,'config'),BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_API_KEY:'offline',ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.port,
    ANTHROPIC_DEFAULT_SONNET_MODEL:'claude-sonnet-4-6',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}),
    },
   workspacePath:workspace,writablePaths:['target.md'],allowWorkingFiles:mode==='working-files',readOnlyPaths:['docs'],
   prompt:'Test native files only.',
   schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},
   logPath:join(dir,'events.jsonl'),signal:abort.signal,onMessage:m=>{messages.push(m)},onProgress:p=>{progress.push(p)}})
  expect(result.completion.stdoutDrained).toBe(true)
  if(mode==='retry-limit'){expect(result.failure).toBe('model_failed');expect(n).toBe(5)}
  else {
   expect(result.failure).toBeUndefined();expect(result.result?.structured_output).toEqual({ok:true})
   expect(await readFile(join(workspace,'target.md'),'utf8')).toBe('FINAL\n')
   expect(await readFile(join(dir,'outside.md'),'utf8')).toBe('SECRET\n')
   const log=(await readFile(join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x))
   expect(log.filter(x=>x.event==='permission').map(x=>x.data.allowed)).toEqual(mode==='working-files'
    ?[true,false,false,true,false,true,true,false]:[true,false,false,true,false,false,true])
   if(mode==='working-files'){
    expect(await readFile(join(workspace,'other.md'),'utf8')).toBe('BAD')
    expect(await readFile(join(workspace,'docs/GDD.md'),'utf8')).toBe('Test geometry: legs 3 and 4.\n')
   }
   expect(progress.length).toBeGreaterThan(0)
   expect(requests[0].tools.map((t:any)=>t.name)).toEqual(expect.arrayContaining(['Read','Edit','Write','Glob','Grep','StructuredOutput']))
   expect(requests[0].tools.map((t:any)=>t.name)).toEqual(expect.arrayContaining(['Bash','Agent']))
   expect(requests[0].tools.some((t:any)=>t.name.startsWith('mcp__'))).toBe(false)
  }
  expect(messages.some(x=>x.type==='result'&&x.modelUsage)).toBe(true)
 }finally{clearTimeout(timer);server.stop(true);await rm(dir,{recursive:true,force:true})}
},30000)

for(const mode of ['observer-failure','stop','observer-mutation'] as const)test('native child drains: '+mode,async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'native-child-drain-')))
 const workspace=join(dir,'workspace');await mkdir(workspace)
 const messages:any[]=[];const abort=new AbortController()
 try {
  const result=await runNativeFileAgent({command:[process.execPath,join(import.meta.dir,'fixtures/native-file-meter.ts')],env:{},
   workspacePath:workspace,writablePaths:[],prompt:'offline',schema:{type:'object'},logPath:join(dir,'log.jsonl'),signal:abort.signal,
   onMessage:m=>{
    messages.push(structuredClone(m))
    if(messages.length===1){if(mode==='stop')abort.abort();if(mode==='observer-failure')throw new Error('observer')}
    if(mode==='observer-mutation'){m.structured_output={bad:true};m.type='mutated'}
   }})
  expect(messages).toHaveLength(3)
  expect(result.completion.stdoutDrained).toBe(true)
  expect(()=>process.kill(result.completion.pid!,0)).toThrow()
  if(mode==='observer-mutation')expect(result.result?.structured_output).toEqual({ok:true})
  else expect(result.failure).toBe(mode==='stop'?'stopped':'observation_failed')
 }finally{await rm(dir,{recursive:true,force:true})}
},5000)
