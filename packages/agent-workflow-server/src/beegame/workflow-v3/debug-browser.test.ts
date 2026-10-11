import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { registerV3DebugPage } from './debug-page'
import { registerV3Routes } from './routes'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type TaskSpec } from './state'
import { createLocalWorkflowStore } from './store'
import { bindInputs, runChecks, readVersion } from './checks'
import { BeeGameSessionManager } from '../session-manager'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { createMeasuredPreview } from './measured-preview'
import { createPreviewCapabilityManager } from '../../auth/preview-capability'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'

test('isolated debug page closes edit/Preview observation/owner repair/remeasurement/review and export without production frontend or paid provider', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-v3-debug-')))
  const browser = createPreviewTestBrowser()
  let calls = 0, child: ReturnType<typeof Bun.spawn> | undefined
  const sessions = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    calls++;
    const current = (await store.read('p','owner'))!, attempt = current.attempts.find(a => a.attemptId === current.writer?.attemptId)!, task = current.tasks[attempt.taskId]!.spec
    if (task.repairOf) {
      // Synthetic author operation in a temporary fixture, never a real game.
      const doc=JSON.parse(await readFile(join(root,'content/ui/menu.json'),'utf8'));doc.data.nodes[1].layout.size[1]=80
      await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(doc))
    } else if (task.reviewReport) {
      const source=await readVersion(root,'content/ui/menu.json'),quote=await readFile(join(root,'content/ui/menu.json'),'utf8')
      const report={requirementsRevision:current.requirements.revision,planRevision:current.planRevision,
        findings:task.reviewOf?[]:[{id:'F1',requirementId:'req.play',ownerTaskId:'game',severity:'blocker',sources:[{...source,quote}],
          impact:'Measured button is 64px, not the confirmed fixture requirement of 80px',close:'Set confirmed 80px and verify rule plus new source-copy build and runtime',verifyWith:['rule-tests','build','runtime-smoke']}],
        closed:task.reviewOf?[{id:'F1',repairAttemptId:current.tasks.game!.attemptId,sources:[{...source,quote}],observed:'Actual rule/build/runtime checks match current repaired source; synthetic semantic judgement'}]:[],
        observations:task.previewIssues!.map(id=>({id,disposition:'finding',findingIds:['F1'],reason:'Inspected the registered UI source and confirmed fixture requirement'})),
        limitations:['Synthetic source-backed review judgement; does not test LLM review competence or game quality']}
      await mkdir(join(root,'reviews'),{recursive:true});await writeFile(join(root,task.reviewReport),JSON.stringify(report))
    }
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic native completion; actual checks run in host' })
  } } } }, join(root, '.beegame/native'), async () => ({}), {}, true)
  const app = new Hono(), store = createLocalWorkflowStore(join(root, '.beegame/store'))
  let preview: ReturnType<typeof createMeasuredPreview> | undefined
  const cleanups: (() => Promise<void>)[] = []
  let server: ReturnType<typeof Bun.serve> | undefined
  try {
    for (const dir of ['content/ui','content/scenes','src']) await mkdir(join(root, dir), { recursive: true })
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture()))
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(root, 'content/index.json'), JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',dimension:'2d',
      documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json','scenes/level.json'],
      documents:[{path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},{path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
    await writeFile(join(root, 'notes.json'), '{}')
    await writeFile(join(root, 'package.json'), JSON.stringify({scripts:{build:'bun run build.mjs',
      'test:rules':'bun -e "process.exit(JSON.parse(await Bun.file(\'content/ui/menu.json\').text()).data.nodes[1].layout.size[1]===80?0:1)"'}}))
    await writeFile(join(root, 'build.mjs'), "import {cp,mkdir} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
    await writeFile(join(root, 'src/index.html'), '<!doctype html><body><button id="play">Fixture</button><script>fetch("/content/ui/menu.json").then(r=>r.json()).then(d=>document.querySelector("#play").style.height=d.data.nodes[1].layout.size[1]+"px")</script></body>')
    let run = createRun({projectId:'p',ownerId:'owner',workspacePath:root,chatSessionId:'chat',requestKey:'fixture',text:'Synthetic fixture: the play button must have height 80px; preserve independent notes',constraints:{},ids:['req.play']})
    await store.commit('p','owner',0,run,'run.created')
    const tasks: TaskSpec[] = [{id:'game',kind:'game.develop',goal:'Maintain UI and actual source-copy build',dependsOn:[],requirementIds:['req.play'],
      inputs:['content/ui/menu.json','src/index.html'],writablePaths:['content/ui/menu.json','dist/**'],
      expectedOutputs:['content/ui/menu.json','dist/index.html'],checks:['build','runtime-smoke'],runtimeArtifact:'dist',editableProject:true},
      {id:'notes',kind:'game.develop',goal:'Independent notes',dependsOn:[],requirementIds:['req.play'],inputs:['notes.json'],
        writablePaths:['notes.json'],expectedOutputs:['notes.json'],checks:['artifact-json']}]
    const next = publishPlan(run,{protocol:V3_PROTOCOL,baseRevision:0,requirementsRevision:run.requirements.revision,tasks})
    await store.commit('p','owner',run.version,next,'plan.published'); run=next
    for (const task of tasks) {
      const claimed=claimTask(run,{taskId:task.id,requestKey:'baseline-'+task.id,workerId:'synthetic-host',sessionId:'synthetic-baseline',inputVersions:await bindInputs(run,task)})
      await store.commit('p','owner',run.version,claimed,'baseline.claimed')
      const attempt=claimed.attempts.at(-1)!, checked=await runChecks(root,task,attempt.inputVersions,undefined,{}, {run:claimed,attempt})
      expect(checked.checks.map(c=>[c.id,c.status,c.observation])).toEqual(checked.checks.map(c=>[c.id,'passed',expect.any(String)]))
      const done=finishTask(claimed,attempt.attemptId,attempt.fence,checked,true)
      await store.commit('p','owner',claimed.version,done,'baseline.checked');run=done
    }
    sessions.start({workspacePath:root,projectId:'p',userId:'owner',transcriptSessionId:'chat'})
    server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch})
    preview=createMeasuredPreview({origin:'http://localhost:'+server.port,capabilities:createPreviewCapabilityManager(),
      readRun:()=>store.read('p','owner'),isBusy:()=>false})
    app.use('*',async(c,next)=>{const response=await preview!.handle(c.req.raw);if(response)return response;await next()})
    registerV3DebugPage(app,true)
    app.use('/api/*',async(c,next)=>{
      if(c.req.header('Authorization')!=='Bearer synthetic-owner'&&c.req.header('Cookie')!=='debug_fixture_session=synthetic-owner')return c.json({code:'unauthorized',error:'Unauthorized'},401)
      await next()
    })
    // Synthetic Chat restoration response. Delay the BODY (not headers) on the
    // second call to exercise an identity change while response.json awaits.
    let restores = 0
    app.post('/api/projects/:id/session/ensure', c => {
      const text = JSON.stringify({session:{id:'chat'},binding:{projectId:c.req.param('id')}})
      if (++restores !== 2) return c.json(JSON.parse(text))
      return new Response(new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode(text.slice(0,10)))
        setTimeout(() => {controller.enqueue(new TextEncoder().encode(text.slice(10)));controller.close()},250)
      }}),{headers:{'content-type':'application/json'}})
    })
    const routes=registerV3Routes(app,{store,sessions,preview,getUser:()=>({id:'owner',role:'owner'}),getProject:async(_r,_u,id)=>id==='p'?{id:'p',name:'Synthetic',root_path:root,created_at:0} as any:undefined,
      getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:r=>r.json(),registerCleanup:fn=>cleanups.push(fn)})
    app.get('/api/projects/:id/game-content',async c=>c.json(await routes.contentView(c.req.raw,c.req.param('id'),false)))
    app.put('/api/projects/:id/game-content/document',async c=>{
      try{return c.json(await routes.saveContent(c.req.raw,c.req.param('id'),await c.req.json()))}
      catch(e:any){return c.json({code:e.code,error:e.message},e.status??400)}
    })
    const {endpoint}=await browser.start(), node=Bun.which('node')
    if(!node)throw Error('Installed Node required for existing pinned browser client')
    const driver=Bun.spawn([node,fileURLToPath(new URL('./debug-browser.mjs',import.meta.url))],{
      env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
    child=driver
    driver.stdin.write(JSON.stringify({endpoint,origin:server.url.origin}));driver.stdin.end()
    const timer=setTimeout(()=>child?.kill(),80000)
    const [output,errors,code]=await Promise.all([new Response(driver.stdout).text(),new Response(driver.stderr).text(),driver.exited])
    clearTimeout(timer)
    expect(code, errors).toBe(0);expect(JSON.parse(output).passed).toBe(true)
    expect(calls).toBe(4) // initial rebuild, targeted review, owner repair/rebuild, follow-up only
    expect(JSON.parse(await readFile(join(root,'dist/content/ui/menu.json'),'utf8')).data.nodes[1].layout.size[1]).toBe(80)
    expect(await readFile(join(root,'notes.json'),'utf8')).toBe('{}')
    expect((await store.read('p','owner'))!.paused).toBeDefined()
    expect((await store.read('p','owner'))!.previewIssues).toHaveLength(1)
    const initialReview=(await store.read('p','owner'))!.attempts.find(a=>a.review?.findings.length)
    expect(initialReview?.status).toBe('failed')
    expect(await readFile(join(root,initialReview!.review!.report.path),'utf8')).toContain('64px')
  } finally {
    if(child?.exitCode===null){child.kill();await child.exited}
    await Promise.all(cleanups.map(fn=>fn()));await sessions.dispose();preview?.dispose()
    server?.stop(true);await browser.close();await rm(root,{recursive:true,force:true})
  }
},90000)
