import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentWorkflowApp } from '../../app'
import { createLocalWorkflowStore } from './store'
import { MANAGED_WEB_BOOT_PATHS } from './managed-web-boot'
import { PROJECT_DOCUMENTS } from '../project-content-authority'
import { projectPreviewCapabilityPath } from '../project-preview-capability'

// Real bootstrap, canonical brief, workflow, permissions and implementation
// handoff; only the author is replaced. No model, compiler or target device.
test.each([
  {engine:'React',platform:'Web'}, {engine:'Unity',platform:'Web'},
  {engine:'Godot',platform:'Mobile'}, {engine:'Unreal',platform:'PC'},
  {engine:'Unity',platform:'VR/AR'},
])('user settings reach the Agent unchanged and handoff leaves implementation to it: %j',async settings=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-engine-boundary-')))
  const store=createLocalWorkflowStore(join(root,'host')),cleanups:Array<()=>void|Promise<void>>=[]
  const failures:unknown[]=[],starts:any[]=[],submitted:any[]=[]
  let workspace=''
  const app=createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:join(root,'projects'),
    workflowV3Store:store,modelConfigStore:false,skillsConfig:false,invitationService:false,
    currentUserResolver:request=>request.headers.get('authorization')==='Bearer owner'?{id:'owner',role:'owner'}:undefined,
    registerCleanup:cleanup=>cleanups.push(cleanup),
    sessionRunner:{async start(start){
      workspace=start.cwd;starts.push(start)
      const nativeId=start.resumeSessionId??crypto.randomUUID();start.onNativeSessionId?.(nativeId)
      return {stop(){},async submit(turn){
        submitted.push(turn)
        try {
          const brief=JSON.parse(turn.confirmedBriefContext!)
          expect(brief.settings).toMatchObject(settings)
          expect(start).not.toHaveProperty('managedWebBoot')
          expect(start.systemContext).not.toContain('export async function createGame')
          expect(start.systemContext).not.toContain('src/game.jsx')
          const native=['Unity','Godot','Unreal'].includes(settings.engine)
          expect(start.systemContext?.includes('Register Scene/UI documents in content/index.json')).toBe(!native)
          if(submitted.length===1) {
            const guide=await readFile(join(workspace,'AGENTS.md'),'utf8')
            expect(guide).toContain('complete the eight design documents')
            expect(guide).not.toContain('4. UI/Scene JSON:')
            await mkdir(join(workspace,'docs'))
            for(const document of PROJECT_DOCUMENTS)
              await writeFile(join(workspace,'docs',document),'# '+document+'\nOffline fixture for '+settings.engine+' / '+settings.platform+'. Quality is unverified.\n')
          }
          const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(workspace,start.sessionId,'measurement'),'utf8'))
          const response=await fetch(capability.apiUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({designAction:'implementation'})})
          const handoff=await response.json()
          expect(response.status,JSON.stringify(handoff)).toBe(200)
          expect(handoff.valid).toBe(true)
          expect(handoff.webBoot).toBeUndefined()
          for(const path of ['index.html','package.json','src/game.jsx','content/index.json',...MANAGED_WEB_BOOT_PATHS])
            expect(await Bun.file(join(workspace,path)).exists()).toBe(false)
          // A retired creation policy must not reserve these ordinary source paths.
          for(const path of MANAGED_WEB_BOOT_PATHS) {
            const decision=await turn.requestPermission({toolName:'Write',toolUseID:crypto.randomUUID(),input:{file_path:join(workspace,path),content:'Fixture permission probe only'},message:'Local permission check'})
            expect(decision.behavior).toBe('allow')
          }
        }catch(error){failures.push(error);throw error}
        await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Offline author fixture; quality unverified' })
      }}
    }},
  })
  const request=(path:string,body:unknown)=>app.request(path,{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify(body)})
  const wait=async(count:number)=>{
    for(let i=0;i<1500;i++) {const run=await store.read('fixture','owner');if(run?.agentTurns?.length===count&&run.agentTurns.at(-1)?.finishedAt&&!run.writer)return run;await Bun.sleep(10)}
    throw Error('Local workflow did not settle')
  }
  try {
    expect((await request('/api/model-configs',{name:'Offline',provider:'openai-compatible',apiKey:'fake',model: 'fake',isDefault:true})).status).toBe(200)
    const goal=await request('/api/projects/bootstrap',{project:{id:'fixture',name:'Fixture',created_at:Date.now()},projectName:'Fixture',language:'en',
      brief:{creationMode:'creative',idea:'Only prepare the eight design documents using the selected engine and platform.',option:{title:'Fixture'},
        settings:{...settings,dimension:settings.platform==='VR/AR'?'VR':'2D',orientation:'Landscape',resourceLibraryUsage:'optional'},
        documentLanguage:'en',gameUserVisibleLanguage:'en',agentResponseLanguage:'en'}})
    expect(goal.status,await goal.clone().text()).toBe(202)
    let run=await wait(1)
    expect(failures).toEqual([])
    expect(run.requirements.constraints).toMatchObject(settings)
    expect(run.creation?.initialDelivery).toBe('design-led-first-version')
    expect(run.creation?.webBoot).toBeUndefined();expect(run.creation?.webStarter).toBeUndefined();expect(run.webBoot).toBeUndefined()
    const confirmed=submitted[0].confirmedBriefContext
    const changed=await request('/api/projects/fixture/workflow-v3/agent/messages',{requestKey:'inspect',runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Inspect the saved technical design only.'})
    expect(changed.status).toBe(202)
    run=await wait(2)
    expect(failures).toEqual([])
    expect(submitted).toHaveLength(2)
    expect(submitted[1].confirmedBriefContext).toBe(confirmed)
    expect(starts[1].resumeSessionId).toBe(run.agentTurns![0]!.nativeSessionId)
    expect(run.webBoot).toBeUndefined()
  }finally{for(const close of cleanups)await close();await rm(root,{recursive:true,force:true})}
},30000)
