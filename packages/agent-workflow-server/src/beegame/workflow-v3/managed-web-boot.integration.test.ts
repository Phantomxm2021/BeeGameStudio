import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { createAgentWorkflowApp } from '../../app'
import { createLocalWorkflowStore } from './store'
import type { Run } from './state'
import { MANAGED_WEB_BOOT_PATHS } from './managed-web-boot'
import { writeDesignDocumentsFixture } from '../fixtures/layout-fixture'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { previewTestHostDocument } from '../preview-test-access'
import { sharedPlaywright } from '../shared-playwright'

// Only the model is replaced. Intake, tool publication, implementation
// handoff, source-copy build, production Preview and continuation are real.
// The fake author never imports/calls createGameStorage or writes boot files.
test('new React/Web goal and resumed modification actually boot the game with initialized storage, without a game/UI template',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-web-boot-e2e-')))
  let workspace=''
  const store=createLocalWorkflowStore(join(root,'host'))
  const cleanups:Array<()=>void|Promise<void>>=[],failures:unknown[]=[],starts:any[]=[],snapshots:NonNullable<Run['webBoot']>[]=[],nativeIds:string[]=[]
  let submissions=0,projectProcesses=0,previewUrl='',browser:any,app:ReturnType<typeof createAgentWorkflowApp>
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>new URL(request.url).hostname==='localhost'&&new URL(request.url).pathname==='/fixture-host'
    ?new Response(previewTestHostDocument(new URL(previewUrl)).body,{headers:{'content-type':'text/html'}}):app.fetch(request)})
  const origin='http://localhost:'+server.port
  const read=async()=> (await store.read('fixture','owner'))!
  const request=(path:string,body?:unknown)=>app.request(path,{method:body===undefined?'GET':'POST',
    headers:{authorization:'Bearer owner','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const wait=async(turns:number)=>{
    for(let i=0;i<6000;i++) {const run=await read();if(run?.agentTurns?.length===turns&&run.agentTurns.at(-1)?.finishedAt&&!run.writer)return run;await Bun.sleep(10)}
    throw Error('Local fixture did not settle')
  }
  const game=(version:number)=>`import React from 'react';import {createRoot} from 'react-dom/client';
export async function createGame({root,storage}) {
  if(!storage)throw Error('Game factory received no storage');
  const initial=Number(await storage.getItem('fixture-count')??0);
  const mounted=createRoot(root);
  function Game(){const [count,setCount]=React.useState(initial);return React.createElement('main',{'data-storage-kind':storage.kind},
    React.createElement('h1',null,'Revision ${version}'),React.createElement('output',{id:'count'},String(count)),
    React.createElement('button',{id:'save',onClick:async()=>{try{await storage.setItem('fixture-count',String(count+1));setCount(count+1)}catch(error){console.error(error)}}},'Save'))}
  mounted.render(React.createElement(Game));return()=>mounted.unmount();
}`
  const inFrame=async(expected:number,click=false)=>{
    const {chromium}=await import(sharedPlaywright().moduleUrl)
    browser??=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()})
    const context=await browser.newContext(),page=await context.newPage(),errors:string[]=[]
    page.on('pageerror',(error:Error)=>errors.push(error.message))
    try {
      await page.goto(origin+'/fixture-host')
      const frame=page.frameLocator('#beegame-preview')
      await frame.locator('#count').filter({hasText:String(expected)}).waitFor({timeout:5000})
      expect(await frame.locator('#count').textContent()).toBe(String(expected))
      expect(await frame.locator('main').getAttribute('data-storage-kind')).toBe('preview')
      expect(await frame.locator('body').evaluate(()=>{try{localStorage.getItem('fixture-count');return false}catch{return globalThis.origin==='null'}})).toBe(true)
      if(click) {await frame.locator('#save').click();await frame.locator('#count').filter({hasText:String(expected+1)}).waitFor({timeout:5000})}
      expect(errors).toEqual([])
      return await frame.locator('h1').textContent()
    }finally{await context.close()}
  }
  const cli=async(name:string,args:string[],start:{sessionId:string;systemContext?:string})=>{
    const location=start.systemContext?.match(/Current BGS tools directory \(relative to project root\): ("[^"]+")/)
    expect(location,'The actual turn must publish its tools directory').toBeDefined()
    const directory=JSON.parse(location![1]!)
    const node=Bun.which('node');if(!node)throw Error('Installed Node required; no download attempted')
    // These are the actual advertised `node handoff/measure.mjs` commands.
    const child=Bun.spawn([node,join(workspace,directory,name+'.mjs'),...args],{cwd:workspace,
      env:{PATH:process.env.PATH,BEEGAME_MEASUREMENT_CAPABILITY_FILE:projectPreviewCapabilityPath(workspace,start.sessionId,'measurement')},stdin:'ignore',stdout:'pipe',stderr:'inherit'})
    // Bun can report an exited Node child yet never close a second stderr
    // ReadableStream after Chromium is launched. Inherit diagnostics instead
    // of awaiting that unused pipe; exit status and JSON remain asserted.
    const timer=setTimeout(()=>child.kill(),20000)
    try {
      const [output,code]=await Promise.all([new Response(child.stdout).text(),child.exited])
      expect(code,output||'Local CLI did not finish within its fixture budget').toBe(0);return JSON.parse(output)
    }finally{clearTimeout(timer)}
  }
  app=createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:join(root,'projects'),
    workflowV3PreviewOrigin:origin,workflowV3Store:store,modelConfigStore:false,skillsConfig:false,invitationService:false,
    currentUserResolver:request=>request.headers.get('authorization')==='Bearer owner'?{id:'owner',role:'owner'}:undefined,
    registerCleanup:cleanup=>cleanups.push(cleanup),previewRunner:()=>{projectProcesses++;throw Error('No legacy project process should start')},
    sessionRunner:{async start(start){
      workspace=start.cwd
      starts.push(start);const nativeId=start.resumeSessionId??crypto.randomUUID();nativeIds.push(nativeId);start.onNativeSessionId?.(nativeId)
      return {stop(){},async submit(turn){
        submissions++
        try {
          expect(start.managedWebBoot).toBe(true)
          for(const path of MANAGED_WEB_BOOT_PATHS) {
            const decision=await turn.requestPermission({toolName:'Write',toolUseID:crypto.randomUUID(),input:{file_path:join(workspace,path),content:'Must not write'},message:'Local fixture permission check'})
            expect(decision.behavior).toBe('deny')
          }
          if(submissions===1) {
            expect(await Bun.file(join(workspace,'index.html')).exists()).toBe(false)
            expect(await Bun.file(join(workspace,'src/game.jsx')).exists()).toBe(false)
            await writeDesignDocumentsFixture(workspace)
            expect(await Bun.file(join(workspace,'index.html')).exists()).toBe(false)
            const handoff=await cli('handoff',['--design','implementation'],start)
            expect(handoff.webBoot.gameModule).toBe('src/game.jsx')
            // The host installed routing/client only, not game logic or UI.
            expect(await Bun.file(join(workspace,'src/game.jsx')).exists()).toBe(false)
            expect(await Bun.file(join(workspace,'package.json')).exists()).toBe(false)
            const require=createRequire(new URL('../../../../../apps/frontend/package.json',import.meta.url))
            const domRequire=createRequire(require.resolve('react-dom/package.json'))
            const dependencies:Record<string,string>={}
            await mkdir(join(workspace,'node_modules'))
            for(const library of ['react','react-dom','scheduler']) {
              const manifest=(library==='scheduler'?domRequire:require).resolve(library+'/package.json')
              dependencies[library]=JSON.parse(await readFile(manifest,'utf8')).version
              await cp(await realpath(dirname(manifest)),join(workspace,'node_modules',library),{recursive:true})
            }
            await writeFile(join(workspace,'package.json'),JSON.stringify({type:'module',dependencies,scripts:{build:'bun build ./index.html --target=browser --outdir=dist'}}))
            // Copied installed operands are measured, not claimed as a fresh install.
            await writeFile(join(workspace,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{dependencies}}}))
          }else {
            expect((await read()).webBoot).toEqual(snapshots[0])
          }
          const allowed=await turn.requestPermission({toolName:'Write',toolUseID:crypto.randomUUID(),input:{file_path:join(workspace,'src/game.jsx'),content:game(submissions)},message:'Authorized fixture implementation'})
          expect(allowed.behavior).toBe('allow')
          await writeFile(join(workspace,'src/game.jsx'),game(submissions))
          snapshots.push((await read()).webBoot!)
          const measured=await cli('measure',['--request','build-'+submissions,'--artifact','dist'],start)
          expect(measured.error,JSON.stringify(measured)).toBeUndefined()
          const run=await read(),receipt=run.agentTurns!.at(-1)!.measurements!.at(-1)!
          expect(receipt.checks.find(c=>c.id==='build')?.status,receipt.checks[0]?.observation).toBe('passed')
          expect(receipt.checks.find(c=>c.id==='runtime-smoke')?.status,JSON.stringify(receipt.checks)).toBe('passed')
          const capability=JSON.parse(await readFile(projectPreviewCapabilityPath(workspace,start.sessionId),'utf8'))
          const opened=await fetch(capability.apiUrl+'/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{"mode":"production"}'})
          expect(opened.status,await opened.clone().text()).toBe(200)
          previewUrl=(await opened.json()).preview.url
          expect(await inFrame(submissions-1,true)).toBe('Revision '+submissions)
        }catch(error){failures.push(error);throw error}
        await turn.onMessage({type:'result',subtype:'success',session_id:nativeId,total_cost_usd:0,result:'Synthetic author only; not game acceptance'} as any)
      }}
    }},
  })
  try {
    const model=await request('/api/model-configs',{name:'Offline',provider:'openai-compatible',apiKey:'fake',models:{balanced:'fake'},isDefault:true})
    expect(model.status,await model.clone().text()).toBe(200)
    // Same payload/route as beeGameAdapter.bootstrapProjectFromBrief. Let BGS
    // create the workspace/session and canonical brief; do not set Run flags.
    const goal=await request('/api/projects/bootstrap',{project:{id:'fixture',name:'Fixture',created_at:Date.now()},projectName:'Fixture',language:'en',
      brief:{creationMode:'creative',idea:'Local storage wiring fixture',option:{title:'Fixture'},
        settings:{platform:'Web',engine:'React',dimension:'2D',orientation:'Landscape',bgsVisualEditing:false,resourceLibraryUsage:'optional'},
        documentLanguage:'en',gameUserVisibleLanguage:'en',agentResponseLanguage:'en'}})
    expect(goal.status,await goal.clone().text()).toBe(202)
    const bootstrapped=await goal.json(),chatSessionId=bootstrapped.session.id
    workspace=bootstrapped.project.root_path
    let run=await wait(1)
    expect(failures).toEqual([]);expect(run.webBoot).toBeDefined()
    expect(run.creation?.webBoot).toBe('react-web-storage-v1')
    const original=structuredClone(run.webBoot)
    // UI Preview after the author exits still reads that author's actual save.
    await browser?.close();browser=undefined
    const ordinary=await request('/api/projects/fixture/preview',{})
    expect(ordinary.status,await ordinary.clone().text()).toBe(200);previewUrl=(await ordinary.json()).url
    expect(await inFrame(1)).toBe('Revision 1')
    const message={requestKey:'requested-modification',runId:run.id,chatSessionId,expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent:'work',text:'Modify the fixture label; retain current saved data.'}
    const changed=await request('/api/projects/fixture/workflow-v3/agent/messages',message)
    expect(changed.status,await changed.clone().text()).toBe(202)
    run=await wait(2)
    expect(failures).toEqual([]);expect(run.webBoot).toEqual(original)
    expect(snapshots[1]).toEqual(snapshots[0]);expect(nativeIds[1]).toBe(nativeIds[0])
    expect(submissions).toBe(2);expect(projectProcesses).toBe(0)
    const after=await request('/api/projects/fixture/preview',{})
    expect(after.status,await after.clone().text()).toBe(200);previewUrl=(await after.json()).url
    expect(await inFrame(2)).toBe('Revision 2')
    // A duplicate cannot dispatch or reinstall, and an external alteration is
    // not repaired by overwriting sources or spending another model turn.
    expect((await request('/api/projects/fixture/workflow-v3/agent/messages',message)).status).toBe(202)
    expect(submissions).toBe(2)
    await writeFile(join(workspace,'src/bgs-entry.mjs'),'External fixture change')
    const broken=await request('/api/projects/fixture/workflow-v3/agent/messages',{...message,requestKey:'after-external-change',expectedVersion:run.version,requirementsRevision:run.requirements.revision})
    expect(broken.status,await broken.clone().text()).toBe(202)
    run=await wait(3)
    expect(submissions).toBe(2);expect(starts).toHaveLength(2)
    expect(run.agentTurns!.at(-1)?.error).toContain('startup/storage wiring')
    expect(await readFile(join(workspace,'src/bgs-entry.mjs'),'utf8')).toBe('External fixture change')
  }finally{await browser?.close();for(const close of cleanups)await close();server.stop(true);await rm(root,{recursive:true,force:true})}
},60000)
