import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRun} from './state'
import {previewRunState} from './store'
import {createMeasuredPreview} from './measured-preview'
import {createPreviewCapabilityManager} from '../../auth/preview-capability'
import {previewTestHostDocument} from '@bee-game-studio/agent-workflow/preview-environment'
import {sharedPlaywright} from '../shared-playwright'

test('ordinary Preview preserves its opaque frame and rejects active writers',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-writer-preview-')))
  let preview:ReturnType<typeof createMeasuredPreview>|undefined,browser:any,viewUrl=''
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    if(new URL(request.url).hostname==='localhost'&&new URL(request.url).pathname==='/host')return new Response(previewTestHostDocument(new URL(viewUrl)).body,{headers:{'content-type':'text/html'}})
    return await preview?.handle(request) ?? new Response('No API on Preview origin',{status:404})
  }})
  try {
    await mkdir(join(root,'dist/assets'),{recursive:true});await mkdir(join(root,'dist/content'))
    await writeFile(join(root,'dist/index.html'),'<!doctype html><div id="ready"></div><button id="play">Play</button><script type="module" src="/assets/main.js"></script>')
    await writeFile(join(root,'dist/assets/main.js'),`const data=await fetch('/content/state.json').then(r=>r.json());document.querySelector('#ready').textContent=data.text;document.querySelector('#play').onclick=()=>document.querySelector('#ready').textContent='PLAYING';`)
    await writeFile(join(root,'dist/content/state.json'),JSON.stringify({text:'ROOT_OK'}))
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'touch MUST_NOT_BUILD'}}))
    const run=createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
    run.writer={attemptId:'first',workerId:'worker',fence:1};run.fence=1
    preview=createMeasuredPreview({origin:'http://localhost:'+server.port,capabilities:createPreviewCapabilityManager(),
      readRun:async(id,owner)=>id===run.projectId&&owner===run.ownerId?structuredClone(run):undefined,isBusy:()=>Boolean(run.writer)})
    await expect(preview.openCandidate(run)).rejects.toThrow('writer to stop')
    delete run.writer
    const first=await preview.openCandidate(run)
    expect((await preview.openCandidate(run)).id).toBe(first.id)
    expect((await preview.candidateStatus('project','owner')).preview?.id).toBe(first.id)
    expect((await preview.handle(new Request(new URL('/assets/main.js',first.url))))?.status).toBe(200)
    expect((await preview.handle(new Request(new URL('/content/state.json',first.url))))?.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect((await preview.handle(new Request(new URL('/api/projects',first.url))))?.status).toBe(404)
    expect((await preview.handle(new Request(first.url,{method:'POST'})))?.status).toBe(405)
    const {chromium}=await import(sharedPlaywright().moduleUrl)
    browser=await chromium.launch({headless:true,executablePath:process.env.BGS_LAYOUT_BROWSER_EXECUTABLE??chromium.executablePath()})
    viewUrl=first.url
    const page=await browser.newPage(),errors:string[]=[]
    page.on('pageerror',(error:Error)=>errors.push(error.message))
    await page.goto('http://localhost:'+server.port+'/host')
    const frame=page.frameLocator('#beegame-preview')
    await frame.locator('#ready').waitFor()
    await frame.locator('#ready').filter({hasText:'ROOT_OK'}).waitFor()
    expect(await frame.locator('#ready').textContent()).toBe('ROOT_OK')
    await frame.locator('#play').click()
    expect(await frame.locator('#ready').textContent()).toBe('PLAYING')
    expect(await frame.locator('body').evaluate(()=>{try{localStorage.setItem('fixture','x');return false}catch{return true}})).toBe(true)
    expect(errors).toEqual([])
    // Metadata-only commits must not kill an in-progress browser test.
    run.version++
    expect((await preview.handle(new Request(first.url)))?.status).toBe(200)
    run.writer={attemptId:'second',workerId:'worker',fence:2};run.fence=2
    expect((await preview.handle(new Request(first.url)))?.status).toBe(409)
    delete run.writer
    const second=await preview.openCandidate(run)
    expect(second.id).not.toBe(first.id)
    expect((await preview.handle(new Request(first.url)))?.status).toBe(404)
    run.version++
    expect((await preview.handle(new Request(second.url)))?.status).toBe(200)
    const ordinary=await preview.openCandidate(run)
    expect((await preview.handle(new Request(new URL('/assets/main.js',ordinary.url))))?.status).toBe(200)
    expect((await preview.candidateStatus('project','owner')).preview?.id).toBe(ordinary.id)
    expect(await Bun.file(join(root,'MUST_NOT_BUILD')).exists()).toBe(false)
  }finally{await browser?.close();preview?.dispose();server.stop(true);await rm(root,{recursive:true,force:true})}
},30000)


test('candidate files minimize state reads while retaining identity, race, capability and byte guards',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-preview-state-')))
  try {
    await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'fixture')
    for(const failure of ['none','version','writer','writer-ended','binding','owner','run-id','missing','capability','capability-before','bytes'] as const) {
      const run=createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
      let full=0,small=0,armed=false,capabilitySession=''
      const capabilities=createPreviewCapabilityManager()
      const issueRoute=capabilities.issueRouteId
      capabilities.issueRouteId=(session,owner)=>{capabilitySession=session;return issueRoute(session,owner)}
      const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities,isBusy:()=>false,
        readRun:async()=>{full++;return structuredClone(run)},
        readPreviewState:async()=>{
          small++
          if(armed && small===2) {
            if(failure==='version')run.version++
            if(failure==='writer')run.writer={attemptId:'other',workerId:'w',fence:2}
            if(failure==='writer-ended')delete run.writer
            if(failure==='run-id')run.id='other'
            if(failure==='missing')return undefined
            if(failure==='binding')run.workspacePath+='/other'
            if(failure==='owner')run.ownerId='other'
            if(failure==='capability')capabilities.revokeSession(capabilitySession)
          }
          return previewRunState(run)
        }})
      try {
        const opened=await preview.openCandidate(run);full=0;small=0;armed=true
        if(failure==='capability-before')capabilities.revokeSession(capabilitySession)
        if(failure==='bytes')await writeFile(join(root,'dist/index.html'),'changed')
        const response=await preview.handle(new Request(opened.url))
        const allowed=failure==='none'||failure==='writer-ended'
        expect(response?.status).toBe(allowed?200:409)
        if(!allowed)expect(await response?.text()).not.toBe('fixture')
        expect(full).toBe(0)
        expect(small).toBe(failure==='capability-before'?0:failure==='bytes'?1:2)
        if(failure==='none') {
          for(const method of ['HEAD','OPTIONS']) {
            small=0
            const result=await preview.handle(new Request(opened.url,{method}))
            expect(result?.status).toBe(method==='HEAD'?200:204)
            expect(await result?.text()).toBe('')
            expect(small).toBe(method==='OPTIONS'?1:2)
          }
          small=0
          const responses=await Promise.all(Array.from({length:6},()=>preview.handle(new Request(opened.url))))
          expect(responses.map(item=>item?.status)).toEqual(Array(6).fill(200))
          expect(small).toBe(12)
        }
      }finally{preview.dispose();await writeFile(join(root,'dist/index.html'),'fixture')}
    }
  }finally{await rm(root,{recursive:true,force:true})}
})
