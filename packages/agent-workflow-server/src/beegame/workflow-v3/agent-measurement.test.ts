import { resolve } from 'node:path'
import { test, expect } from 'bun:test'
import sharp from 'sharp'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink } from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import { createRun, digest, type AgentTurn } from './state'
import { createLocalWorkflowStore } from './store'
import { measurementSummary } from './agent-measurement'
import * as editableProject from './editable-project'
import {createMeasuredPreview} from './measured-preview'
import {createPreviewCapabilityManager} from '../../auth/preview-capability'
import {createAgentWorkflowApp} from '../../app'

const JSZip=createRequire(import.meta.resolve('exceljs'))('jszip')
const builder="import{cp,mkdir}from'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');"
async function fixture(script=builder) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-agent-measure-'))),workspace=join(root,'project')
  await mkdir(join(workspace,'src'),{recursive:true})
  await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
  await writeFile(join(workspace,'build.mjs'),script)
  await writeFile(join(workspace,'src/index.html'),'<html><body><h1>Actual fixture</h1><button>Play</button></body></html>')
  await writeFile(join(workspace,'README.md'),'Publication fixture source')
  const store=createLocalWorkflowStore(join(root,'host'))
  const run=createRun({projectId:'measure',ownerId:'owner',workspacePath:workspace,chatSessionId:'chat',requestKey:'goal',text:'Fixture',constraints:{},ids:['goal']})
  const turn:AgentTurn={attemptId:crypto.randomUUID(),requestKey:'goal',sessionId:'chat',workerId:'worker',fence:1,status:'running',startedAt:new Date().toISOString(),requirementsRevision:run.requirements.revision}
  run.agentTurns=[turn];run.fence=1;run.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:turn.fence}
  await store.commit(run.projectId,run.ownerId,0,run,'fixture')
  const current=async()=>(await store.read(run.projectId,run.ownerId))!
  return {root,workspace,store,run,turn,current,
    async settle() {
      let next=await current();next.version++;next.agentTurns![0]!.quiescedAt=new Date().toISOString()
      await store.commit(run.projectId,run.ownerId,next.version-1,next,'synthetic.exit')
      next=await current();next.version++;next.agentTurns![0]!.status='ended';delete next.writer
      await store.commit(run.projectId,run.ownerId,next.version-1,next,'synthetic.settle')
      return current()
    },
    async close(){await rm(root,{recursive:true,force:true})}}
}

test('historical measurement reads retain saved observations without advertising removed commands',()=>{
  const record: import('./state').AgentMeasurement = {
    id:'historical',requestKey:'saved',runtimeArtifact:'dist',reportPaths:[],reports:[],
    requirementsRevision:'original',startedAt:'2026-01-01T00:00:00Z',
    consumption:{checks:['audio-data-consumption']},
    checks:[{id:'audio-data-consumption',version:'historical',status:'failed',inputs:[],
      observation:'Saved audio binding was not consumed',createdAt:'2026-01-01T00:00:00Z'}],
  }
  const before=JSON.stringify(record)
  for(const details of [false,true]) {
    const summary=measurementSummary(record,details)
    expect(summary.checkScope).toMatchObject({consumption:['audio-data-consumption']})
    expect(summary.checkScope).not.toHaveProperty('availableConsumptionChecks')
    expect(summary.checkScope).not.toHaveProperty('consumptionOption')
    expect(JSON.stringify(summary)).not.toContain('--consumption-json')
    expect(summary.checks[0]).toMatchObject({id:'audio-data-consumption',status:'failed',
      observation:'Saved audio binding was not consumed'})
  }
  expect(JSON.stringify(record)).toBe(before)
})

test.each([false,true])('V3 ordinary deployment rebuilds current sources without relying on old measurement bytes; publisher failure=%s',async failPublication=>{
  const f=await fixture(),cleanups:Array<()=>void|Promise<void>>=[]
  let calls=0,builds=0,native=0
  let role:'owner'|'viewer'='owner'
  try {
    await mkdir(join(f.workspace,'dist'),{recursive:true})
    await writeFile(join(f.workspace,'dist/index.html'),await readFile(join(f.workspace,'src/index.html')))
    const settled=await f.settle()
    const savedEvidence=structuredClone(settled.agentTurns)
    const oldArtifact=await readFile(join(f.workspace,'dist/index.html'),'utf8')
    const updatedSource='<html><body><h1>Rebuilt current source</h1></body></html>'
    await writeFile(join(f.workspace,'src/index.html'),updatedSource)
    const browser=join(f.workspace,'tmp/pw-browsers/chromium-1248/Framework.framework')
    await mkdir(join(browser,'Versions/156'),{recursive:true})
    await writeFile(join(browser,'Versions/156/Framework'),'UNUSED_BROWSER_BINARY')
    await symlink('156',join(browser,'Versions/Current'))
    await symlink('Versions/Current/Framework',join(browser,'Framework'))
    await writeFile(join(f.workspace,'tmp/build-input.txt'),'REAL_BUILD_INPUT')
    await writeFile(join(f.root,'private.txt'),'NOT_A_BUILD_INPUT')
    await symlink(join(f.root,'private.txt'),join(f.workspace,'external-link'))
    await mkdir(join(f.workspace,'node_modules/tiny'),{recursive:true})
    await writeFile(join(f.workspace,'node_modules/tiny/index.js'),'export default 1')
    await mkdir(join(f.workspace,'assets'))
    await writeFile(join(f.workspace,'assets/asset-manifest.json'),'{UNUSED_INVALID_REGISTRY')
    await writeFile(join(f.workspace,'build.mjs'),`import assert from 'node:assert/strict';
      import {readFileSync,writeFileSync} from 'node:fs';
      assert.equal(readFileSync('tmp/build-input.txt','utf8'),'REAL_BUILD_INPUT');
      assert.throws(()=>readFileSync('external-link'));
      assert.equal(readFileSync('node_modules/tiny/index.js','utf8'),'export default 1');
      assert.throws(()=>readFileSync(${JSON.stringify(join(f.workspace,'src/index.html'))}));
      assert.throws(()=>writeFileSync('node_modules/tiny/index.js','changed'));
      ${builder}`)
    const app=createAgentWorkflowApp({currentUserResolver:async()=>({id:'owner',role}),workflowV3Store:f.store,
      dashboardDataRoot:join(f.root,'dashboard'),defaultWorkspacePath:f.root,modelConfigStore:false,skillsConfig:false,
      sessionRunner:{async start(){native++;throw Error('No native execution')}},
      deploymentRunner:async()=>{builds++;throw Error('Do not rebuild')},
      deploymentPublisher:{async publishStaticDirectory(input){
        calls++
        expect(await input.files.find(x=>x.path==='index.html')!.text()).toBe(updatedSource)
        expect(input.files.some(file=>/pw-browsers|build-input|asset-manifest/.test(file.path))).toBe(false)
        const current=await f.current(),next=structuredClone(current)
        next.version++
        await f.store.commit(next.projectId,next.ownerId,current.version,next,'synthetic.publication-metadata')
        await writeFile(join(browser,'Versions/156/Framework'),'CACHE_CHANGED_DURING_UPLOAD')
        return {url:'https://offline.invalid/deployment/'}
      },async verifyPublished(){if(failPublication)throw Error('Synthetic delivery host failed')}},
      registerCleanup:fn=>cleanups.push(fn)})
    const post=(path:string,body:unknown={})=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    expect((await post('/api/projects',{id:'measure',name:'Synthetic measured publication',root_path:f.workspace,created_at:Date.now()})).status).toBe(200)
    const readiness=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(readiness).toMatchObject({allowed:true,quality:'unverified',destination:'remote'})
    role='viewer'
    expect((await post('/api/projects/measure/deployments')).status).toBe(403)
    role='owner'
    expect((await post('/api/projects/measure/deployments',{artifact:{path:'../private',sha256:'fake'}})).status).toBe(400)
    expect((await post('/api/projects/measure/deployments',{measurementId:crypto.randomUUID()})).status).toBe(400)
    const cover = await sharp({create:{width:160,height:90,channels:3,background:'#345678'}}).png().toBuffer()
    expect((await post('/api/projects/measure/deployments',{publicationDescription:{text:'Unconfirmed',confirmed:false}})).status).toBe(400)
    expect((await post('/api/projects/measure/deployments',{publicationCover:{mediaType:'image/png',filename:'cover.png',data:'invalid'}})).status).toBe(400)
    const start=await post('/api/projects/measure/deployments',{requirementsRevision:f.run.requirements.revision,
      publicationDescription:{text:'Creator-edited controls',confirmed:true},
      publicationCover:{mediaType:'image/png',filename:'cover.png',data:cover.toString('base64')}})
    expect(start.status).toBe(202)
    const queued=await start.json()
    expect((await post('/api/projects/measure/deployments')).status).toBe(409)
    let result:any
    for(let n=0;n<1000;n++){
      const history=await(await app.request('/api/projects/measure/deployments')).json()
      result=history.find((r:any)=>r.id===queued.id)
      if(['succeeded','failed'].includes(result?.status))break
      await Bun.sleep(10)
    }
    expect(result?.status).toBe(failPublication?'failed':'succeeded')
    expect(result.publicDescription).toBe('Creator-edited controls')
    expect(result.publicCoverUrl).toBe('https://offline.invalid/deployment/__bgs_publication/cover.webp')
    expect(JSON.parse(result.buildLog)).toMatchObject({protocol:'bgs.workflow.v3',quality:'unverified',
      checks:expect.arrayContaining([expect.objectContaining({id:'build',status:'passed'}),expect.objectContaining({id:'runtime-smoke',status:'passed'})])})
    expect(await readFile(join(f.workspace,'dist/index.html'),'utf8')).toBe(oldArtifact)
    expect((await f.current()).agentTurns).toEqual(savedEvidence)
    expect(calls).toBe(1);expect(builds).toBe(0);expect(native).toBe(0)
    if(failPublication)expect((await app.request('/deployments/'+queued.id+'/')).status).toBe(404)
    await writeFile(join(f.workspace,'src/index.html'),'Source edit after publication')
    expect((await(await app.request('/api/projects/measure/deployment-readiness')).json()).allowed).toBe(true)
    expect(calls).toBe(1)
    expect((await f.current()).deliveryEligible).toBe(false)
  }finally{for(const cleanup of cleanups.reverse())await cleanup();await f.close()}
},30000)

test('fresh publication rebuilds current sources independently of old discussion confirmations',async()=>{
  const f=await fixture(),cleanups:Array<()=>void|Promise<void>>=[]
  const preview=createMeasuredPreview({origin:'http://localhost:12345',capabilities:createPreviewCapabilityManager(),
    readRun:f.current,isBusy:()=>false})
  let published=0
  try {
    await mkdir(join(f.workspace,'dist'),{recursive:true})
    await writeFile(join(f.workspace,'dist/index.html'),await readFile(join(f.workspace,'src/index.html')))
    await f.settle()
    const app=createAgentWorkflowApp({currentUserResolver:async()=>({id:'owner',role:'owner'}),workflowV3Store:f.store,
      dashboardDataRoot:join(f.root,'dashboard'),defaultWorkspacePath:f.root,modelConfigStore:false,skillsConfig:false,
      sessionRunner:{async start(){throw Error('No native execution')}},
      deploymentPublisher:{async publishStaticDirectory(){published++;return {url:'https://offline.invalid/deployment/'}},
        async verifyPublished(){}},registerCleanup:fn=>cleanups.push(fn)})
    const post=(body:unknown)=>app.request('/api/projects/measure/deployments',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    await app.request('/api/projects',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({id:'measure',name:'Synthetic discussion confirmation',root_path:f.workspace,created_at:Date.now()})})
    const appendMessage=async(intent:'message'|'change',key:string,text:string)=>{
      const old=await f.current(),next=structuredClone(old),before=old.requirements
      const afterText=before.text+'\n'+text
      const after={...before,revision:crypto.randomUUID(),text:afterText,
        sha256:digest(JSON.stringify({text:afterText,constraints:before.constraints,ids:before.ids}))}
      const now=new Date().toISOString()
      next.version++;next.fence++;next.planRevision++;next.requirements=after
      next.requirementChanges=[...(next.requirementChanges??[]),{requestKey:key,actorId:'owner',at:now,before,after}]
      next.agentTurns!.push({attemptId:crypto.randomUUID(),requestKey:key,sessionId:'chat',workerId:'worker',fence:next.fence,
        status:'ended',startedAt:now,finishedAt:now,quiescedAt:now,requirementsRevision:after.revision,
        message:{requestKey:key,runId:next.id,chatSessionId:'chat',expectedVersion:old.version,
          requirementsRevision:before.revision,intent,text}})
      await f.store.commit(next.projectId,next.ownerId,old.version,next,'agent.turn-claimed')
      return next
    }
    const discussed=await appendMessage('message','question-1','What was tested?')
    const readiness=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(readiness).toMatchObject({allowed:true})
    expect(readiness.confirmationRequired).toBeUndefined()
    expect(published).toBe(0)
    const started=await post({})
    expect(started.status).toBe(202)
    const deploymentId=(await started.json()).id
    let saved:any
    for(let i=0;i<1000;i++) {
      saved=(await(await app.request('/api/projects/measure/deployments')).json()).find((item:any)=>item.id===deploymentId)
      if(saved?.status==='succeeded')break
      await Bun.sleep(10)
    }
    expect(saved?.status).toBe('succeeded')
    expect(JSON.parse(saved.buildLog).checks).toEqual(expect.arrayContaining([expect.objectContaining({id:'build',status:'passed'})]))
    expect(published).toBe(1)
    await writeFile(join(f.workspace,'src/index.html'),'Changed after confirmation')
    const drift=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(drift.allowed).toBe(true)
    expect(drift.confirmationRequired).toBeUndefined()
    await writeFile(join(f.workspace,'src/index.html'),'<html><body><h1>Actual fixture</h1><button>Play</button></body></html>')
    const changed=await appendMessage('change','change-1','Change the goal')
    const blocked=await(await app.request('/api/projects/measure/deployment-readiness')).json()
    expect(blocked.allowed).toBe(true)
    expect(blocked.confirmationRequired).toBeUndefined()
    expect(published).toBe(1)
  }finally{for(const cleanup of cleanups.reverse())await cleanup();await f.close()}
},30000)

test.each(['build','smoke','alias'])('fresh publication records %s failure without uploading or needing an agent measurement',async failure=>{
  const script=failure==='build'?"throw Error('Synthetic build failure')":builder+(failure==='alias'?"const{symlink}=await import('node:fs/promises');await symlink('index.html','dist/alias.html');":'')
  const f=await fixture(script),cleanups:Array<()=>void|Promise<void>>=[]
  let published=0
  try {
    await f.settle()
    if(failure==='smoke')await writeFile(join(f.workspace,'src/index.html'),"<html><body><script>throw Error('Synthetic smoke failure')</script></body></html>")
    const app=createAgentWorkflowApp({currentUserResolver:async()=>({id:'owner',role:'owner'}),workflowV3Store:f.store,
      dashboardDataRoot:join(f.root,'dashboard'),defaultWorkspacePath:f.root,modelConfigStore:false,skillsConfig:false,
      sessionRunner:{async start(){throw Error('No model or native task should run')}},
      deploymentPublisher:{async publishStaticDirectory(){published++;return {url:'https://offline.invalid/deployment/'}},async verifyPublished(){}},
      registerCleanup:fn=>cleanups.push(fn)})
    const post=(path:string,body:unknown={})=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    await post('/api/projects',{id:'measure',name:'Synthetic fresh publication',root_path:f.workspace,created_at:Date.now()})
    expect((await(await app.request('/api/projects/measure/deployment-readiness')).json()).allowed).toBe(true)
    const response=await post('/api/projects/measure/deployments')
    expect(response.status).toBe(202)
    const queued=await response.json()
    let result:any
    for(let n=0;n<1000;n++) {
      result=(await(await app.request('/api/projects/measure/deployments')).json()).find((r:any)=>r.id===queued.id)
      if(['failed','succeeded'].includes(result?.status))break
      await Bun.sleep(10)
    }
    expect(result?.status).toBe('failed')
    expect(result.message).toContain(failure==='build'?'Publication build failed':failure==='alias'?'symlinks are not supported':'Publication page check failed')
    expect(published).toBe(0)
    expect((await f.current()).agentTurns![0]!.measurements).toBeUndefined()
    expect((await f.current()).deliveryEligible).toBe(false)
  } finally {for(const cleanup of cleanups.reverse())await cleanup();await f.close()}
},30000)


test.each(['writer','fence','requirements','artifact'] as const)('publication still rejects actual %s changes during upload',async change=>{
  const f=await fixture(),cleanups:Array<()=>void|Promise<void>>=[]
  try {
    await f.settle()
    const app=createAgentWorkflowApp({currentUserResolver:async()=>({id:'owner',role:'owner'}),workflowV3Store:f.store,
      dashboardDataRoot:join(f.root,'dashboard'),defaultWorkspacePath:f.root,modelConfigStore:false,skillsConfig:false,
      sessionRunner:{async start(){throw Error('No model or native task')}},
      deploymentPublisher:{async publishStaticDirectory(input){
        if(change==='artifact')await writeFile(join(input.outputDir,'index.html'),'CHANGED_PUBLICATION')
        else {
          const current=await f.current(),next=structuredClone(current);next.version++
          if(change==='writer')next.writer={attemptId:'new',workerId:'writer',fence:next.fence}
          if(change==='fence')next.fence++
          if(change==='requirements') {
            const before=current.requirements,text=before.text+'\nAuthorized fixture change'
            const after={...before,revision:crypto.randomUUID(),text,
              sha256:digest(JSON.stringify({text,constraints:before.constraints,ids:before.ids}))}
            next.requirements=after;next.planRevision++
            next.requirementChanges=[...(next.requirementChanges??[]),{requestKey:'publication-change',actorId:'owner',
              at:new Date().toISOString(),before,after}]
          }
          await f.store.commit(next.projectId,next.ownerId,current.version,next,'synthetic.publication-change')
        }
        return {url:'https://offline.invalid/deployment/'}
      },async verifyPublished(){}},registerCleanup:fn=>cleanups.push(fn)})
    const post=(path:string,body:unknown={})=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    await post('/api/projects',{id:'measure',name:'Synthetic publication guard',root_path:f.workspace,created_at:Date.now()})
    const queued=await(await post('/api/projects/measure/deployments')).json()
    let result:any
    for(let n=0;n<1000;n++) {
      result=(await(await app.request('/api/projects/measure/deployments')).json()).find((r:any)=>r.id===queued.id)
      if(['failed','succeeded'].includes(result?.status))break
      await Bun.sleep(10)
    }
    expect(result?.status).toBe('failed')
    expect(result.message).toContain(change==='writer'?'writer':change==='artifact'?'artifact changed':'Project changed')
  }finally{for(const cleanup of cleanups.reverse())await cleanup();await f.close()}
},30000)

test('publication cover options capture three frames from an owned current Preview and preserve single-cover callers', async () => {
  const f = await fixture(), cleanups: Array<() => void | Promise<void>> = []
  let role: 'owner' | 'viewer' = 'owner', captures = 0, singles = 0, mutate = false, rejectCapture = false
  try {
    await mkdir(join(f.workspace, 'dist'))
    await writeFile(join(f.workspace, 'dist/index.html'), '<h1>Existing saved build</h1>')
    await f.settle()
    const image = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#345678' } }).webp().toBuffer()
    const app = createAgentWorkflowApp({ currentUserResolver: async () => ({ id: 'owner', role }), workflowV3Store: f.store,
      workflowV3PreviewOrigin: 'https://preview.example', dashboardDataRoot: join(f.root, 'dashboard'), defaultWorkspacePath: f.root,
      modelConfigStore: false, skillsConfig: false, registerCleanup: fn => cleanups.push(fn),
      sessionRunner: { async start() { throw Error('Must not start a model') } },
      publicationCoverCapture: async () => { singles++; return image },
      publicationCoversCapture: async url => {
        captures++
        expect(new URL(url).hostname).toMatch(/^[a-f0-9]+\.preview\.example$/)
        if (rejectCapture) throw Error('Internal capture URL must not leak')
        if (mutate) await writeFile(join(f.workspace, 'dist/index.html'), '<h1>Changed during capture</h1>')
        return [image, image, image]
      },
    })
    const post = (path: string, body: unknown = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await post('/api/projects', { id: 'measure', name: 'Cover fixture', root_path: f.workspace, created_at: Date.now() })
    const url = '/api/projects/measure/publication-cover'
    const response = await post(url, { count: 3 })
    expect(response.status).toBe(200)
    expect((await response.json()).covers).toEqual([1, 2, 3].map(n => ({ mediaType: 'image/webp', filename: `game-preview-${n}.webp`, data: image.toString('base64') })))
    expect(captures).toBe(1)
    expect((await post(url, { count: 2 })).status).toBe(400)
    expect((await post(url, { count: 3, previewUrl: 'https://unowned.invalid' })).status).toBe(400)
    role = 'viewer'
    expect((await post(url, { count: 3 })).status).toBe(403)
    role = 'owner'
    expect((await (await post(url)).json()).filename).toBe('game-preview.webp')
    expect(singles).toBe(1)
    rejectCapture = true
    const rejected = await post(url, { count: 3 })
    expect(rejected.status).toBe(400)
    expect(await rejected.text()).not.toContain('Internal capture URL')
    rejectCapture = false; mutate = true
    expect((await post(url, { count: 3 })).status).toBe(409)
  } finally { for (const cleanup of cleanups) await cleanup(); await f.close() }
})
