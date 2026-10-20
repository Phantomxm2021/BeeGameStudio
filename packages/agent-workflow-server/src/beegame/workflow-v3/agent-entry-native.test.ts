import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BeeGameSessionManager } from '../session-manager'
import { createNativeCliProcessRunner, nativeRuntimeCommand } from '../native-cli-process-runner'
import { agentGoalPrompt, agentMessagePrompt } from './agent-goal'
import { initializeProjectGuide } from './project-guide'
import { skillEvidence } from './context'
import type { Run } from './state'

// Actual CLI + plugin loader + BGS event projection. Provider replies are local
// constants: this verifies the first request, not autonomous design quality.
test('new complete-design entry loads its method before the first model request, and resume retains it', async () => {
  const checkout=fileURLToPath(new URL('../../../../..',import.meta.url))
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-entry-native-')))
  const workspace=join(root,'workspace'),config=join(root,'config'),requests:any[]=[]
  let sessions:BeeGameSessionManager|undefined
  const provider=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    if(!path.endsWith('/messages'))return new Response('',{status:404})
    const body:any=await request.json();requests.push(body)
    if (!body.stream) return Response.json({id:'offline-helper',type:'message',role:'assistant',model:body.model,
      content:[{type:'text',text:'Offline'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:1}})
    const tool = requests.length === 2 ? {name:'Skill',input:{skill:'bgs-builtins:game-systems-designer-expert'}} : undefined
    const frame=(value:any)=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n'
    return new Response(frame({type:'message_start',message:{id:'offline-'+requests.length,type:'message',role:'assistant',
      model:'claude-sonnet-4-6',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:tool ? {type:'tool_use',id:'offline-skill',name:tool.name,input:{}} : {type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:tool ? {type:'input_json_delta',partial_json:JSON.stringify(tool.input)} : {type:'text_delta',text:'Offline transport complete; quality unverified.'}})+
      frame({type:'content_block_stop',index:0})+
      frame({type:'message_delta',delta:{stop_reason:tool ? 'tool_use' : 'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
      frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
  }})
  try {
    await mkdir(workspace);await mkdir(config)
    await initializeProjectGuide(workspace)
    let cli=process.env.BGS_TEST_NATIVE_CLI
    if(!cli){
      const out=join(root,'native')
      const build=Bun.spawn([process.execPath,'build.ts','--outdir',out],{cwd:checkout,stdout:'pipe',stderr:'pipe'})
      const [code,output,error]=await Promise.all([build.exited,new Response(build.stdout).text(),new Response(build.stderr).text()])
      expect(code,error||output).toBe(0)
      await mkdir(join(out,'node_modules'))
      await symlink(resolve(checkout,'node_modules/sharp'),join(out,'node_modules/sharp'),'dir')
      cli=join(out,'cli-bun.js')
    }
    const environment={BEEGAME_CONFIG_DIR:config,BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_AUTH_TOKEN:'local-test-secret-not-in-tool-ids',
      ANTHROPIC_BASE_URL:provider.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',
      BEEGAME_NATIVE_BUILTIN_SKILLS_DIR:join(checkout,'.beegame/skills/builtinskills'),
      BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}
    sessions=new BeeGameSessionManager({start(input){
      const command=nativeRuntimeCommand(input);command.splice(0,2,process.execPath,cli!)
      return createNativeCliProcessRunner({command}).start({...input,env:{...input.env,...environment}})
    }},root,()=>environment,{},true)
    const input={workspacePath:workspace,projectId:'offline',userId:'offline',userDataRoot:config}
    const chat=sessions.start(input)
    const run={creation:{initialDelivery:'design-led-first-version'},requirements:{text:'OFFLINE_GAME_GOAL; budget 20000000'}} as Run
    const submit=async(prompt:string)=>{
      await sessions!.sendWithDisplay(chat.id,prompt,{displayText:prompt.startsWith('/')?'OFFLINE_GAME_GOAL':prompt})
      await sessions!.waitForSessionIdle(chat.id)
    }
    await submit(agentGoalPrompt(run))
    expect(requests,JSON.stringify(sessions.transcript(chat.id).filter(e=>e.type==='turn.failed'||e.type==='result'))).toHaveLength(1)
    const first=JSON.stringify(requests[0].messages)
    // A body heading, not just the Skill catalog/description.
    const skill=await readFile(join(environment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR,'game-creative-director-expert/SKILL.md'),'utf8')
    const heading=skill.split('\n').find(line=>line.startsWith('# '))!
    expect(heading).toBeDefined()
    expect(first).toContain(heading)
    expect(first).toContain('Base directory for this skill:')
    expect(first).toContain(run.requirements.text)
    const loads=skillEvidence(sessions.transcript(chat.id))
    expect(loads).toEqual([expect.objectContaining({name:'bgs-builtins:game-creative-director-expert',source:'command',status:'loaded'})])
    expect(loads[0]).not.toHaveProperty('toolUseID')
    sessions.stop(chat.id,'user_pause');await sessions.waitForSessionIdle(chat.id)
    sessions.start({...input,transcriptSessionId:chat.id})
    await submit(agentMessagePrompt({intent:'work',text:'继续处理'} as any))
    expect(requests).toHaveLength(3)
    expect(JSON.stringify(requests[1].messages)).toContain(heading)
    expect(JSON.stringify(requests[1].messages)).toContain('继续处理')
    expect(skillEvidence(sessions.transcript(chat.id))).toEqual([expect.objectContaining({source:'command'}),
      expect.objectContaining({name:'bgs-builtins:game-systems-designer-expert',toolUseID:'offline-skill',status:'loaded'})])
    const systems=await readFile(join(environment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR,'game-systems-designer-expert/SKILL.md'),'utf8')
    expect(JSON.stringify(requests[2].messages)).toContain(systems.split('\n').find(line=>line.startsWith('# '))!)
    // Focused is deliberately fresh; it must not claim the old load is present.
    sessions.stop(chat.id,'user_pause');await sessions.waitForSessionIdle(chat.id)
    sessions.start({...input,transcriptSessionId:chat.id,freshNativeContext:true})
    await submit(agentMessagePrompt({intent:'work',text:'Continue the existing design'} as any))
    expect(requests).toHaveLength(4)
    expect(JSON.stringify(requests[3].messages)).not.toContain(heading)
    expect(skillEvidence(sessions.transcript(chat.id))).toHaveLength(2)
  } finally {
    await sessions?.dispose();provider.stop(true);await rm(root,{recursive:true,force:true})
  }
},120000)
