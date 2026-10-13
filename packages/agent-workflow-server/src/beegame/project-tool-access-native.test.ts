import {test,expect} from 'bun:test'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createNativeCliProcessRunner} from './native-cli-process-runner'
import {nativeSessionOutputPath} from './native-runtime-process-path'

// Real CLI + OS sandbox, fixed localhost provider only. This is tool-access
// evidence, not engine planning, licensing or game-quality acceptance.
test.skipIf(process.platform!=='darwin')('actual native CLI honors a host project read grant without writes, sibling access or sandbox bypass',async()=>{
  const key='BEEGAME_PROJECT_TOOL_READ_PATHS',previous=process.env[key]
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-native-tool-grant-')))
  const tool=join(root,'tool'),privateDir=join(root,'private'),projects=[join(root,'granted'),join(root,'ungranted')]
  await Promise.all([tool,privateDir,...projects].map(path=>mkdir(path)))
  await writeFile(join(tool,'data.txt'),'EXPLICIT_TOOL_BYTES')
  await writeFile(join(privateDir,'secret.txt'),'SIBLING_PRIVATE_BYTES')
  await symlink(join(privateDir,'secret.txt'),join(tool,'escape.txt'))
  process.env[key]=JSON.stringify({[projects[0]!]:[tool]})
  const command='cat '+JSON.stringify(join(tool,'data.txt'))
  const guard='test ! -r '+JSON.stringify(join(tool,'escape.txt'))+' && test ! -r '+JSON.stringify(join(privateDir,'secret.txt'))+
    ' && ! (printf BAD > '+JSON.stringify(join(tool,'data.txt'))+')'
  let phase=0,step=0,requests=0
  const results:string[]=[],guards:unknown[]=[]
  const permissions:any[]=[]
  const frame=(event:any)=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n'
  const provider=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    if(!path.endsWith('/messages'))return new Response('',{status:404})
    const body:any=await request.json();requests++;step++
    if(step>3)return new Response('Unexpected fixture request; no production fallback',{status:409})
    if(step===2)results[phase]=JSON.stringify(body.messages.at(-1))
    if(phase===0 && step===3)guards.push(body.messages.at(-1))
    const call=step===1 ? {name:'Bash',input:{command,description:'Read explicitly scoped synthetic tool bytes'}} :
      phase===0 && step===2 ? {name:'Bash',input:{command:guard,description:'Check real sandbox denies external writes and symlink escapes'}}:undefined
    return new Response(frame({type:'message_start',message:{id:'offline-tool-'+requests,type:'message',role:'assistant',model:body.model,
      content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'tool-'+requests,name:call.name,input:{}}:{type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Synthetic tool access only.'}})+
      frame({type:'content_block_stop',index:0})+
      frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
      frame({type:'message_stop'}),{headers:{'Content-Type':'text/event-stream'}})
  }})
  let runtime:Awaited<ReturnType<ReturnType<typeof createNativeCliProcessRunner>['start']>>|undefined
  const outputs:string[]=[],abort=new AbortController(),timer=setTimeout(()=>abort.abort('offline fixture timeout'),25000)
  try {
    for(phase=0;phase<projects.length;phase++) {
      step=0
      const sessionId='native-tool-'+phase,workspace=projects[phase]!
      outputs.push(nativeSessionOutputPath(workspace,sessionId,await realpath(tmpdir())))
      runtime=await createNativeCliProcessRunner().start({sessionId,cwd:workspace,env:{
        BEEGAME_CONFIG_DIR:join(root,'config-'+phase),BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_API_KEY:'offline',
        ANTHROPIC_BASE_URL:provider.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',
        BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',
        // A selected model environment must not grant the unrelated workspace.
        [key]:JSON.stringify({[workspace]:[tool]}),
      }})
      await runtime.submit({prompt:'Run the synthetic tool-read and sandbox-boundary fixture.',signal:abort.signal,onMessage:()=>{},
        requestPermission:async request=>{
          permissions.push(request)
          const input=request.input as {command?:string;dangerouslyDisableSandbox?:boolean}
          return {behavior:request.toolName==='Bash' && [command,guard].includes(input.command??'') &&
            !input.dangerouslyDisableSandbox?'allow':'deny'}
        }})
      await runtime.dispose?.();runtime=undefined
    }
    expect(results[0]).toContain('EXPLICIT_TOOL_BYTES')
    expect(results[1]).not.toContain('EXPLICIT_TOOL_BYTES')
    expect(results[1]).toMatch(/denied|not permitted|is_error/i)
    expect((guards[0] as any)?.content?.some((b:any)=>b.type==='tool_result')).toBe(true)
    expect(JSON.stringify(guards)).not.toContain('"is_error":true')
    expect(guards).toHaveLength(1)
    expect(await readFile(join(tool,'data.txt'),'utf8')).toBe('EXPLICIT_TOOL_BYTES')
    expect(await readFile(join(privateDir,'secret.txt'),'utf8')).toBe('SIBLING_PRIVATE_BYTES')
    expect(permissions.every(p=>!p.input?.dangerouslyDisableSandbox)).toBe(true)
    expect(requests).toBe(5)
    console.log(JSON.stringify({projectToolReadNative:true,requests,paidModelCalls:0,
      coverage:['explicit-project-read','other-project-denied','model-env-not-authority','write-denied','symlink-denied'],
      limits:['fixed-provider','not-engine-runtime-or-quality']}))
  }finally{
    clearTimeout(timer);await runtime?.dispose?.();provider.stop(true)
    if(previous===undefined)delete process.env[key];else process.env[key]=previous
    for(const output of outputs)await rm(output,{recursive:true,force:true})
    await rm(root,{recursive:true,force:true})
  }
},30000)
