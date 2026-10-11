import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Hono } from 'hono'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type TaskSpec, type Run } from './state'
import { bindInputs, runChecks, commandCheck } from './checks'
import { buildEditableProject, projectFiles } from './editable-project'
import { exportMeasuredBuild } from './measured-build'
import { artifactDigest } from '../runtime-acceptance'
import { createLocalWorkflowStore } from './store'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'
import { createAgentWorkflowApp } from '../../app'

const JSZip=createRequire(import.meta.resolve('exceljs'))('jszip')
const task:TaskSpec={id:'game',kind:'game.develop',goal:'Build editable static fixture',dependsOn:[],requirementIds:['req.play'],inputs:[],
  writablePaths:['dist/**'],expectedOutputs:['dist/index.html'],checks:['build','runtime-smoke'],runtimeArtifact:'dist',editableProject:true}
const builder=`import {cp,mkdir} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('src/main.js','dist/main.js');await cp('content','dist/content',{recursive:true});console.log('BUILD_CWD='+process.cwd());`
async function fixture() {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-editable-')))
  for(const path of ['src','content','dist','.beegame','reviews'])await mkdir(join(root,path))
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs'}}))
  await writeFile(join(root,'build.mjs'),builder)
  await writeFile(join(root,'src/index.html'),'<html><body><script src="/main.js"></script></body></html>')
  await writeFile(join(root,'src/main.js'),'document.body.append("Ready");')
  await writeFile(join(root,'content/rules.json'),'{"speed":4}')
  await writeFile(join(root,'dist/stale.txt'),'old build must not merge')
  await writeFile(join(root,'.env'),'SECRET=not-exported')
  await writeFile(join(root,'.beegame/host.json'),'host-only')
  await writeFile(join(root,'reviews/review.json'),'host review evidence')
  let run=createRun({projectId:'editable',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'run',text:'Static fixture',constraints:{},ids:['req.play']})
  run=publishPlan(run,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:run.requirements.revision,tasks:[task,
    {id:'review',kind:'game.verify',goal:'Future review',dependsOn:['game'],requirementIds:['req.play'],inputs:[],writablePaths:['reviews/review.json'],expectedOutputs:['reviews/review.json'],checks:['review-findings'],reviewReport:'reviews/review.json'}]})
  return {root,get run(){return run},set run(value:Run){run=value},
    async measure(){const claimed=claimTask(run,{taskId:'game',requestKey:crypto.randomUUID(),workerId:'worker',sessionId:'fixture',inputVersions:await bindInputs(run,task)}),attempt=claimed.attempts.at(-1)!
      const checked=await runChecks(root,task,attempt.inputVersions,undefined,{}, {run:claimed,attempt})
      expect(checked.checks.map(c=>[c.id,c.status,c.observation.slice(0,150)])).toEqual(expect.arrayContaining([['build','passed',expect.any(String)],['runtime-smoke','passed',expect.any(String)]]))
      run=finishTask(claimed,attempt.attemptId,claimed.fence,checked,true);expect(run.tasks.game!.status).toBe('succeeded')
    }, dispose:()=>rm(root,{recursive:true,force:true})}
}
const exportProject=(f:Awaited<ReturnType<typeof fixture>>,read=async()=>f.run)=>exportMeasuredBuild(f.run,'game',f.run.tasks.game!.attemptId!,{read,busy:()=>false},'project')

test('actual source-copy build -> browser measurement -> editable ZIP -> extracted rebuild; same tested bytes, no private/host evidence',async()=>{
  const f=await fixture(), extracted=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-editable-extracted-')))
  try {
    await f.measure();const before=JSON.stringify(f.run),checks=f.run.attempts.at(-1)!.checks!
    expect(checks[0]!.observation).toContain('bgs-editable-build-');expect(checks[0]!.observation).not.toContain('BUILD_CWD='+f.root)
    expect(await readdir(join(f.root,'dist'))).not.toContain('stale.txt')
    const packed=await exportProject(f),zip=await JSZip.loadAsync(packed.data)
    expect(packed.kind).toBe('project');expect(packed.filename).toStartWith('project-')
    expect(Object.keys(zip.files).sort()).toEqual(['measurement.json','project/build.mjs','project/content/rules.json','project/dist/content/rules.json','project/dist/index.html','project/dist/main.js','project/package.json','project/src/index.html','project/src/main.js'])
    const receipt=JSON.parse(await zip.file('measurement.json').async('string'))
    expect(receipt.protocol).toBe('bgs.measured-project-export.1');expect(receipt.artifact).toEqual(checks[1]!.artifacts![0])
    expect(receipt.deliveryEligible).toBe(false);expect(receipt.check.inputs).toBeUndefined();expect(receipt.sourceBuild.runtime).toContain('Bun '+Bun.version)
    for(const entry of receipt.files) {
      const data=await zip.file(entry.path).async('nodebuffer')
      const path=join(extracted,entry.path.slice('project/'.length));await mkdir(join(path,'..'),{recursive:true});await writeFile(path,data)
    }
    expect(await artifactDigest(extracted,'dist',true)).toBe(packed.artifact.sha256)
    expect((await commandCheck(extracted,'build')).code).toBe(0);expect(await artifactDigest(extracted,'dist',true)).toBe(packed.artifact.sha256)
    expect((await runChecks(extracted,{...task,checks:['runtime-smoke']},[])).checks[0]!.status).toBe('passed')
    await writeFile(join(extracted,'src/main.js'),'document.body.append("Edited");')
    expect((await commandCheck(extracted,'build')).code).toBe(0);expect(await artifactDigest(extracted,'dist',true)).not.toBe(packed.artifact.sha256)
    expect((await runChecks(extracted,{...task,checks:['runtime-smoke']},[])).checks[0]!.status).toBe('passed')
    expect(JSON.stringify(f.run)).toBe(before)
    // A new genuine review report is host evidence, not a new game source. It
    // may be excluded, but cannot hide a file that was a measured source.
    f.run=publishPlan(f.run,{protocol:V3_PROTOCOL,baseRevision:f.run.planRevision,requirementsRevision:f.run.requirements.revision,tasks:[task,
      {...f.run.tasks.review!.spec,id:'later-review',reviewReport:'reviews/later.json',writablePaths:['reviews/later.json'],expectedOutputs:['reviews/later.json']}]})
    await writeFile(join(f.root,'reviews/later.json'),'new host report')
    expect(Object.keys((await JSZip.loadAsync((await exportProject(f)).data)).files)).not.toContain('project/reviews/later.json')
    const data=await mkdtemp(join(tmpdir(),'bgs-v3-editable-store-'))
    try {const store=createLocalWorkflowStore(data);await store.commit('editable','owner',0,{...f.run,version:1},'fixture')
      const restored=(await createLocalWorkflowStore(data).read('editable','owner'))!;expect(restored.attempts.at(-1)!.checks![0]!.projectBuild).toEqual(checks[0]!.projectBuild)
    }finally{await rm(data,{recursive:true,force:true})}
  }finally{await f.dispose();await rm(extracted,{recursive:true,force:true})}
},30000)

test('undeclared source edits/additions/removals cannot masquerade as tested engineering; no unrelated source mutation on export',async()=>{
  const f=await fixture()
  try {
    await f.measure();const before=JSON.stringify(f.run),original=await readFile(join(f.root,'src/main.js'))
    for(const mode of ['changed','added','removed']) {
      if(mode==='changed')await writeFile(join(f.root,'src/main.js'),'changed')
      if(mode==='added')await writeFile(join(f.root,'src/extra.js'),'new')
      if(mode==='removed')await rm(join(f.root,'src/main.js'))
      await expect(exportProject(f)).rejects.toThrow('source/dependencies changed')
      // The already measured static bytes remain exportable, no full-project coupling.
      expect((await exportMeasuredBuild(f.run,'game',f.run.tasks.game!.attemptId!,{read:async()=>f.run,busy:()=>false})).kind).toBe('static')
      await writeFile(join(f.root,'src/main.js'),original);await rm(join(f.root,'src/extra.js'),{force:true})
    }
    expect(JSON.stringify(f.run)).toBe(before)
    await expect(exportProject(f,async()=>({...f.run,version:f.run.version+1}))).rejects.toThrow('Workflow changed')
    const proof=f.run.attempts.at(-1)!.checks![0]!.projectBuild!
    proof.artifact.sha256='0'.repeat(64);await expect(exportProject(f)).rejects.toThrow('no actual editable')
  }finally{await f.dispose()}
},30000)

test('old static measurements are never upgraded into editable provenance; HTTP export is read/export-only and restart safe',async()=>{
  const f=await fixture(),data=await mkdtemp(join(tmpdir(),'bgs-v3-editable-http-'));let starts=0
  const sessions=new BeeGameSessionManager({async start(){starts++;throw Error('No native dispatch')}},data,async()=>({}),{},true)
  try {
    await f.measure();const store=createLocalWorkflowStore(data);await store.commit('editable','owner',0,{...f.run,version:1},'fixture')
    let owned=true;const app=new Hono();registerV3Routes(app,{store,sessions,getUser:()=>({id:'owner',role:'viewer'}),getProject:async()=>owned?({id:'editable',root_path:f.root} as any):undefined,
      getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json()})
    const selection={taskId:'game',attemptId:f.run.tasks.game!.attemptId!,planRevision:f.run.planRevision,kind:'project'}
    const request=(body:unknown)=>app.request('/api/projects/editable/workflow-v3/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    const response=await request(selection);expect(response.status).toBe(200);expect(response.headers.get('x-bgs-export-kind')).toBe('project')
    expect(response.headers.get('x-bgs-artifact-sha256')).toBe(f.run.attempts.at(-1)!.checks![1]!.artifacts![0]!.sha256)
    expect(response.headers.get('content-disposition')).toContain('project-');expect(response.headers.get('cache-control')).toContain('no-store')
    expect((await request({...selection,planRevision:99})).status).toBe(409);expect((await request({...selection,kind:'source-PASS'})).status).toBe(400)
    owned=false;expect((await request(selection)).status).toBe(404);owned=true
    const current=(await store.read('editable','owner'))!;expect(current.version).toBe(1);expect(starts).toBe(0)
    delete f.run.attempts.at(-1)!.checks![0]!.projectBuild
    await expect(exportProject(f)).rejects.toThrow('no actual editable')
    expect((await exportMeasuredBuild(f.run,'game',selection.attemptId,{read:async()=>f.run,busy:()=>false})).kind).toBe('static')
  }finally{await sessions.dispose();await f.dispose();await rm(data,{recursive:true,force:true})}
},30000)

test('source-copy build rejects hidden config dependence, source mutation, cancellation and aliases without replacing prior build',async()=>{
  for(const mode of ['private','mutation','cancel','source-alias','output-alias'] as const) {
    const f=await fixture(),outside=await mkdtemp(join(tmpdir(),'bgs-v3-editable-outside-'))
    try {
      if(mode==='private')await writeFile(join(f.root,'build.mjs'),"await Bun.file('.env').text();"+builder)
      if(mode==='mutation')await writeFile(join(f.root,'build.mjs'),"await Bun.write('src/main.js','mutated');"+builder)
      if(mode==='source-alias'){await rm(join(f.root,'src/main.js'));await symlink(join(f.root,'package.json'),join(f.root,'src/main.js'))}
      if(mode==='output-alias'){await rm(join(f.root,'dist'),{recursive:true});await symlink(outside,join(f.root,'dist'));await writeFile(join(outside,'stale.txt'),'old build must not merge')}
      const controller=new AbortController()
      if(mode==='cancel'){await writeFile(join(f.root,'build.mjs'),"await Bun.write('waiting','entered');await new Promise(r=>setTimeout(r,60000));"+builder);setTimeout(()=>controller.abort(),200)}
      const checked=await runChecks(f.root,{...task,checks:['build']},[],controller.signal)
      expect(checked.checks[0]!.status).not.toBe('passed');expect(checked.checks[0]!.projectBuild).toBeUndefined()
      if(mode==='cancel')expect(checked.checks[0]!.observation).toContain('cancelled')
      expect(await Bun.file(join(f.root,'dist/stale.txt')).text()).toBe('old build must not merge')
      if(mode==='mutation')expect(await Bun.file(join(f.root,'src/main.js')).text()).toBe('document.body.append("Ready");')
      expect(await readdir(join(f.root,'.beegame'))).toEqual(['host.json'])
    }finally{await f.dispose();await rm(outside,{recursive:true,force:true})}
  }
},30000)

test('installed libraries are measured separately and require an exported lockfile, never included in project ZIP',async()=>{
  const f=await fixture()
  try {
    await mkdir(join(f.root,'node_modules/lib'),{recursive:true});await writeFile(join(f.root,'node_modules/lib/index.js'),'export const ready=true;')
    await writeFile(join(f.root,'node_modules/lib/package.json'),'{"type":"module","exports":"./index.js"}')
    await writeFile(join(f.root,'build.mjs'),"import {ready} from 'lib';if(!ready)throw Error('library missing');"+builder)
    let built=await buildEditableProject(f.root,task,[],['reviews/review.json'])
    expect(built.status).toBe('unverified');expect(built.observation).toContain('lockfile')
    await writeFile(join(f.root,'bun.lock'),'synthetic lockfile; no installation is certified')
    await f.measure();const proof=f.run.attempts.at(-1)!.checks![0]!.projectBuild!
    expect(proof.dependencySha256).toMatch(/^[a-f0-9]{64}$/)
    const zip=await JSZip.loadAsync((await exportProject(f)).data)
    expect(zip.file('project/bun.lock')).not.toBeNull();expect(Object.keys(zip.files).some(p=>p.includes('node_modules'))).toBe(false)
    await writeFile(join(f.root,'node_modules/lib/index.js'),'changed');await expect(exportProject(f)).rejects.toThrow('source/dependencies changed')
  }finally{await f.dispose()}
},30000)

test('editable build authority must explicitly include the whole output directory; enumerator cannot drop game data',async()=>{
  const f=await fixture()
  try {
    const plan={protocol:V3_PROTOCOL,baseRevision:f.run.planRevision,requirementsRevision:f.run.requirements.revision,tasks:[{...task,writablePaths:['dist/index.html']}]}
    expect(()=>publishPlan(f.run,plan)).toThrow('full runtimeArtifact/**')
    expect(()=>publishPlan(f.run,{...plan,tasks:[{...task,checks:['runtime-smoke']}]})).toThrow('build/runtime-smoke')
    const files=await projectFiles(f.root,'dist',['reviews/review.json'])
    expect(files.map(f=>f.path)).toContain('content/rules.json');expect(files.map(f=>f.path)).not.toContain('.env')
    await mkdir(join(f.root,'logs'));await mkdir(join(f.root,'transcripts'))
    for(const file of ['logs/index.json','logs/runtime-diagnostics.jsonl','logs/runtime-diagnostics.jsonl.1','transcripts/session.jsonl'])await writeFile(join(f.root,file),'private workflow records')
    await writeFile(join(f.root,'logs/game-notes.txt'),'real editable game file')
    const paths=(await projectFiles(f.root,'dist',['reviews/review.json'])).map(f=>f.path)
    expect(paths).toContain('logs/game-notes.txt');expect(paths.some(p=>p==='logs/index.json'||p.startsWith('transcripts/')||p.startsWith('logs/runtime-diagnostics'))).toBe(false)
  }finally{await f.dispose()}
})

test('real app CORS exposes only measured export identity to trusted dashboards, not an arbitrary origin',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-v3-editable-cors-')),cleanups:Array<()=>Promise<void>|void>=[]
  const app=createAgentWorkflowApp({currentUser:{id:'owner',role:'owner'},dashboardDataRoot:root,modelConfigStore:false,skillsConfig:false,workflowV3Store:false,
    registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(){throw Error('No dispatch')}}})
  try {
    const response=await app.request('/api/projects/missing/workflow-v3/export',{method:'POST',headers:{origin:'http://127.0.0.1:62173','content-type':'application/json'},body:'{}'})
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:62173')
    expect(response.headers.get('access-control-expose-headers')).toBe('X-BGS-Artifact-SHA256,X-BGS-Export-Kind')
    const denied=await app.request('/api/projects/missing/workflow-v3/export',{method:'POST',headers:{origin:'https://attacker.invalid','content-type':'application/json'},body:'{}'})
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  }finally{for(const fn of cleanups.reverse())await fn();await rm(root,{recursive:true,force:true})}
})
