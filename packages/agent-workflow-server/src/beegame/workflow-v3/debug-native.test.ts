import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createAgentWorkflowApp } from '../../app'
import { createNativeCliProcessRunner } from '../native-cli-process-runner'
import { createLocalWorkflowStore } from './store'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'
import { uiLayoutFixture } from '../fixtures/layout-fixture'
import type { TaskSpec } from './state'
import { createOfflineNativeReviewFixture } from '../../../../../scripts/workflow-v3-offline-native'

// Closes a previously separate boundary: debug/API -> REAL CLI permission and
// file tools -> source-copy build -> independent data-use observation -> export.
// Only the model is deterministic/offline. Never attaches to user Chrome.
test.each([false,true])('debug drives actual CLI with fresh measurement (review/repair mode: %s)', async reviewMode => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-v3-debug-native-')))
  const workspace = join(root, 'projects/users/owner/native-debug')
  const store = createLocalWorkflowStore(join(root, 'host'))
  const browser = createPreviewTestBrowser(), native = createNativeCliProcessRunner()
  const cleanups: (() => void | Promise<void>)[] = []
  const requests: { attempt: string; body: any }[] = []
  const calls = new Map<string, number>()
  const prior = process.env.BEEGAME_WORKFLOW_V3_DEBUG
  process.env.BEEGAME_WORKFLOW_V3_DEBUG = '1'
  let driver: ReturnType<typeof Bun.spawn> | undefined
  let server: ReturnType<typeof Bun.serve> | undefined
  const frame = (event: unknown) => `event: ${(event as {type:string}).type}\ndata: ${JSON.stringify(event)}\n\n`
  const offline=reviewMode?createOfflineNativeReviewFixture(workspace,()=>store.read('native-debug','owner')):undefined
  const provider = offline?.provider ?? Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/count_tokens')) return Response.json({input_tokens:10})
    if (!path.endsWith('/messages')) return new Response('', {status:404})
    const run = (await store.read('native-debug', 'owner'))!
    const attempt = run.writer!.attemptId
    const body:any = await request.json(); requests.push({attempt,body})
    const count = (calls.get(attempt) ?? 0) + 1; calls.set(attempt,count)
    let call: {name:string;input:unknown} | undefined
    if (count === 1) call = {name:'AskUserQuestion',input:{questions:[{header:'Native',question:'Choose native fixture height?',multiSelect:false,
      options:[{label:'80',description:'80 pixels'},{label:'96',description:'96 pixels'}]}]}}
    else if (count === 2) call = {name:'Skill',input:{skill:'bgs-builtins:gameplay-programmer'}}
    else if (count === 3) call = {name:'Read',input:{file_path:join(workspace,'content/ui/menu.json')}}
    else if (count === 4) {
      // Deterministic answer for this transport test, not an LLM judgement.
      // The assertions below independently verify the REAL native tool result.
      const doc = JSON.parse(await readFile(join(workspace,'content/ui/menu.json'),'utf8'))
      doc.data.nodes[1].layout.size[1] = run.requirementChanges?.length ? 96 : 80
      call = {name:'Write',input:{file_path:join(workspace,'content/ui/menu.json'),content:JSON.stringify(doc)}}
    }
    return new Response(frame({type:'message_start',message:{id:'offline-'+requests.length,type:'message',role:'assistant',model:body.model,
      content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'native-tool-'+requests.length,name:call.name,input:{}}:{type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Saved synthetic source.'}})+
      frame({type:'content_block_stop',index:0})+frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
      frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
  }})
  try {
    await mkdir(join(workspace,'content/ui'),{recursive:true});await mkdir(join(workspace,'src'))
    const ui=uiLayoutFixture();ui.data.nodes[0]!.data!.referenceResolution=[1280,720]
    ui.data.nodes[0]!.data!.targetViewports=[[1280,720]];ui.data.nodes[0]!.layout.size=[1280,720]
    await writeFile(join(workspace,'content/ui/menu.json'),JSON.stringify(ui))
    await writeFile(join(workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'native-debug',sceneModel:'game-object-v2',dimension:'2d',
      documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',files:['ui/menu.json'],
      documents:[{id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'}]}))
    await writeFile(join(workspace,'notes.json'),'{"independent":"retained"}')
    await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs',
      'test:rules':'bun -e "const d=await Bun.file(\'content/ui/menu.json\').json();process.exit([80,96].includes(d.data.nodes[1].layout.size[1])?0:1)"'}}))
    await writeFile(join(workspace,'build.mjs'),"import{cp,mkdir}from'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
    await writeFile(join(workspace,'src/index.html'),`<!doctype html><style>body{margin:0}button{position:absolute;box-sizing:border-box}</style><button id="play">Play</button><output id="feedback"></output><script>fetch('/content/ui/menu.json').then(r=>r.json()).then(d=>{const n=d.data.nodes.find(n=>n.id==='play'),b=document.querySelector('#play'),s=n.layout.size,p=n.layout.position||[0,0];b.style.width=s[0]+'px';b.style.height=s[1]+'px';b.style.left=(innerWidth/2-s[0]/2+p[0])+'px';b.style.top=(innerHeight/2-s[1]/2+p[1])+'px';b.onclick=()=>document.querySelector('#feedback').textContent='Clicked';});</script>`)
    let app: ReturnType<typeof createAgentWorkflowApp> | undefined
    server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>app?app.fetch(r):new Response('Initializing',{status:503})})
    app=createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:join(root,'projects'),workflowV3Store:store,
      workflowV3PreviewOrigin:'http://localhost:'+server.port,modelConfigStore:false,skillsConfig:false,invitationService:false,
      currentUserResolver:r=>r.headers.get('Authorization')==='Bearer synthetic-owner'?{id:'owner',role:'owner'}:undefined,
      registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(input){
        if(await realpath(input.cwd)!==workspace)throw Error('Test runner must stay in its synthetic project')
        return native.start({...input,env:{BEEGAME_CONFIG_DIR:join(root,'config'),BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_AUTH_TOKEN:'offline',
          ANTHROPIC_BASE_URL:provider.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',
          BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}})
      }}})
    const api=async(path:string,body:unknown)=>{
      const r=await app!.request('http://localhost'+path,{method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},body:JSON.stringify(body)})
      expect(r.status,await r.clone().text()).toBeLessThan(300)
    }
    await api('/api/model-configs',{name:'Offline transport',provider:'openai-compatible',apiKey:'offline',models:{balanced:'offline'},isDefault:true})
    await api('/api/projects',{id:'native-debug',name:'Synthetic native debug',root_path:workspace,created_at:Date.now()})
    const task:TaskSpec={id:'game',kind:'game.develop',goal:'Use real native Question and save selected UI height; preserve notes',dependsOn:[],requirementIds:['req.height'],
      inputs:['src/index.html','content/ui/menu.json'],writablePaths:['content/ui/menu.json','dist/**'],expectedOutputs:['content/ui/menu.json','dist/index.html'],
      checks:['build','runtime-smoke','rule-tests','ui-data-consumption'],runtimeArtifact:'dist',editableProject:true,
      skills:['bgs-builtins:gameplay-programmer'],uiProbes:[{document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:[1280,720]}]}
    if(reviewMode){task.goal='Measure the existing synthetic fixture before the authorized selection';task.checks=task.checks.filter(id=>id!=='rule-tests')}
    const notesTask:TaskSpec={id:'notes',kind:'game.develop',goal:'Preserve independent notes',dependsOn:[],requirementIds:['req.height'],inputs:['notes.json'],writablePaths:['notes.json'],expectedOutputs:['notes.json'],checks:['artifact-json']}
    const {endpoint}=await browser.start(),node=Bun.which('node');if(!node)throw Error('Installed Node required')
    const launched=Bun.spawn([node,fileURLToPath(new URL(reviewMode?'./debug-native-review-browser.mjs':'./debug-native-browser.mjs',import.meta.url))],{env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
    driver=launched
    launched.stdin.write(JSON.stringify({endpoint,origin:server.url.origin,task,notesTask}));launched.stdin.end()
    const timer=setTimeout(()=>driver?.kill(),75000)
    const [output,errors,code]=await Promise.all([new Response(launched.stdout).text(),new Response(launched.stderr).text(),launched.exited]);clearTimeout(timer)
    expect(code,errors).toBe(0);const observed=JSON.parse(output);expect(observed.passed).toBe(true)
    const run=(await store.read('native-debug','owner'))!
    expect(run.attempts).toHaveLength(reviewMode?5:2)
    if(offline){
      expect(offline.counts.size).toBe(5);expect(offline.requests).toHaveLength(19)
      expect(offline.requests.filter(r=>r.tool==='AskUserQuestion')).toHaveLength(1)
      expect(offline.requests.filter(r=>r.toolResultAccepted===false)).toHaveLength(0)
      const initial=run.attempts.find(a=>a.review?.findings.length)!,followup=run.attempts.at(-1)!
      expect(initial.status).toBe('failed');expect(followup.status).toBe('succeeded')
      expect(followup.review!.closed[0]!.repairAttemptId).toBe(run.tasks.game!.attemptId!)
      expect(offline.requests.find(r=>r.answer)?.answer).toBe('80')
      expect(JSON.parse(await readFile(join(workspace,initial.review!.report.path),'utf8')).findings).toHaveLength(1)
      expect(run.attempts.find(a=>a.attemptId===run.tasks.game!.attemptId)!.decisions![0]!.findingIds).toEqual(['F1'])
      console.log(JSON.stringify({nativeReviewDebug:true,permissionTools:observed.permissionTools}))
    }else{expect(calls.size).toBe(2);expect(requests).toHaveLength(10)}
    const gameAttempts=run.attempts.filter(a=>a.taskId==='game')
    for(const [i,a] of gameAttempts.entries()){
      expect(a.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);expect(a.quiescedAt).toBeDefined();expect(a.usage).toBeDefined()
      expect(a.skillUses).toContainEqual(expect.objectContaining({name:'bgs-builtins:gameplay-programmer',status:'loaded'}))
      const expected=['build','runtime-smoke','ui-data-consumption','skill-use',...(!reviewMode||i===1?['rule-tests']:[])]
      expect(a.checks?.map(c=>[c.id,c.status])).toEqual(expect.arrayContaining(expected.map(id=>[id,'passed'])))
      if(!reviewMode){const answerResult=requests.filter(r=>r.attempt===a.attemptId)[1]!.body.messages.at(-1).content;expect(JSON.stringify(answerResult)).toContain(i===0?'80':'96')}
      const proof=JSON.parse(a.checks!.find(c=>c.id==='ui-data-consumption')!.observation).probes[0]
      expect(proof.changed).toHaveLength(2);expect(proof.before).toEqual(proof.restored)
    }
    expect(new Set(run.attempts.map(a=>a.nativeSessionId)).size).toBe(run.attempts.length)
    expect(await readFile(join(workspace,'notes.json'),'utf8')).toBe('{"independent":"retained"}')
    expect(run.paused).toBeDefined();expect(run.deliveryEligible).toBe(false)
  } finally {
    if(driver?.exitCode===null){driver.kill();await driver.exited}
    await Promise.all(cleanups.map(fn=>fn()));server?.stop(true);provider.stop(true);await browser.close()
    if(prior===undefined)delete process.env.BEEGAME_WORKFLOW_V3_DEBUG;else process.env.BEEGAME_WORKFLOW_V3_DEBUG=prior
    await rm(root,{recursive:true,force:true})
  }
},90000)
