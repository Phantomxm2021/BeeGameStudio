import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNativeCliProcessRunner, nativeRuntimeCommand } from './native-cli-process-runner'
import { nativeSessionOutputPath } from './native-runtime-process-path'
import { openAgentTools } from './workflow-v3/agent-tools'
import { openPreviewTestAccess } from './preview-test-access'

// Opt in with a separately built CLI, never substitute the live service binary.
// All model replies are fixed localhost fixtures; no external provider fallback.
for (const enabled of [false, true]) {
test.skipIf(!process.env.BGS_TEST_NATIVE_CLI)(`BGS runtime verification=${enabled} with one unchanged CLI binary`,async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-native-policy-'))),workspace=join(root,'project'),sessionId='policy-test'
  await mkdir(workspace)
  await writeFile(join(workspace,'probe.mjs'),`console.log(JSON.stringify({runtime:process.versions.bun?'bun':'node',checks:[false]}));`)
  const preview=openPreviewTestAccess({start:async()=>({status:'idle'}),status:()=>({status:'idle'}),stop(){},
    browser:{start:async()=>{throw Error('No browser requested')},status:()=>({status:'idle'}),close:async()=>{}}} as any)
  const tools=await openAgentTools({workspacePath:workspace,sessionId,getAuthToken:()=>undefined,openPreview:()=>preview})
  const command='node '+JSON.stringify(tools.directory+'/preview.mjs')+' --run probe.mjs'
  const requests:any[]=[],messages:any[]=[]
  const frame=(event:any)=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n'
  const provider=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    if(!path.endsWith('/messages'))return new Response('',{status:404})
    const body:any=await request.json();requests.push(body);const n=requests.length
    if(n>3)return new Response('Unexpected offline fixture request',{status:409})
    const call=n===1?{name:'TodoWrite',input:{todos:['First','Second','Third'].map(content=>({content,status:'completed',activeForm:content}))}}:
      n===2?{name:'Bash',input:{command,description:'Run synthetic Node probe'}}:undefined
    return new Response(frame({type:'message_start',message:{id:'offline-'+n,type:'message',role:'assistant',model:body.model,
      content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'tool-'+n,name:call.name,input:{}}:{type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Synthetic end.'}})+
      frame({type:'content_block_stop',index:0})+
      frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
      frame({type:'message_stop'}),{headers:{'Content-Type':'text/event-stream'}})
  }})
  const input={sessionId,cwd:workspace,env:{BEEGAME_CONFIG_DIR:join(root,'config'),BEEGAME_MODEL_TYPE:'anthropic',
    BEEGAME_RUNTIME_SETTINGS_JSON: JSON.stringify({ verificationAgentEnabled: enabled }),
    ANTHROPIC_API_KEY:'offline',ANTHROPIC_BASE_URL:provider.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}}
  const cli=nativeRuntimeCommand(input);cli[1]=process.env.BGS_TEST_NATIVE_CLI!
  let runtime:Awaited<ReturnType<ReturnType<typeof createNativeCliProcessRunner>['start']>>|undefined
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort('offline timeout'),25000)
  try {
    runtime=await createNativeCliProcessRunner({command:cli}).start(input)
    await runtime.submit({prompt:'Execute the synthetic fixture.',signal:abort.signal,onMessage:m=>{messages.push(m)},
      requestPermission:async request=>({behavior:request.toolName==='Bash' && request.input?.command===command &&
        !request.input?.dangerouslyDisableSandbox?'allow':'deny'})})
    expect(requests).toHaveLength(3)
    expect(JSON.stringify(requests[0].system).includes('independent adversarial verification must happen')).toBe(enabled)
    expect(JSON.stringify(requests[1].messages).includes('You just closed out 3+ tasks')).toBe(enabled)
    const init=messages.find(m=>m.type==='system'&&m.subtype==='init')
    expect(init.agents).toContain('general-purpose');expect(init.agents.includes('verification')).toBe(enabled)
    expect(requests[0].tools.map((tool:any)=>tool.name)).toEqual(expect.arrayContaining(['Agent','Bash','Skill']))
    const output=JSON.stringify(requests[2].messages.at(-1))
    expect(output).toContain('execution.json');expect(output).not.toContain('is_error":true')
    const {readdir}=await import('node:fs/promises')
    const retained=(await readdir(join(workspace,'.beegame/tmp'))).filter(name=>name.startsWith('preview-test-'))
    expect(retained).toHaveLength(1)
    const report=JSON.parse(await readFile(join(workspace,'.beegame/tmp',retained[0]!,'execution.json'),'utf8'))
    expect(report).toMatchObject({runtime:'node',exitCode:0,quality:'unverified'})
    expect(JSON.parse(await readFile(join(workspace,report.stdoutPath),'utf8'))).toEqual({runtime:'node',checks:[false]})
  }finally{
    clearTimeout(timer);await runtime?.dispose?.();await tools.close();provider.stop(true)
    await rm(nativeSessionOutputPath(workspace,sessionId,await realpath(tmpdir())),{recursive:true,force:true})
    await rm(root,{recursive:true,force:true})
  }
},30000)
}
