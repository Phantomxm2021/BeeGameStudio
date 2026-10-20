import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createAgentWorkflowApp } from '../../app'
import { createNativeCliProcessRunner } from '../native-cli-process-runner'
import { createLocalWorkflowStore } from './store'
import { createPreviewTestBrowser } from '../preview-test-browser'
import { sharedPlaywright } from '../shared-playwright'
import { agentGoalPrompt } from './agent-goal'
import { CONTENT_DRAFT_EXAMPLES } from '../game-content-validation-cli'
import { projectPreviewCapabilityPath } from '../project-preview-capability'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { digest } from './state'

// Actual native CLI and debug UI; only provider responses are scripted/offline.
// This establishes transport/control, not autonomous model reasoning/game quality.
test('full-goal independent debug drives real native plan, Skill, Question, failing check and repair',async()=>{
  const focusedContinuation=process.env.BGS_TEST_FOCUSED_CONTINUATION==='1'
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-agent-debug-')))
  const workspace=join(root,'projects/users/owner/agent-debug'),store=createLocalWorkflowStore(join(root,'host'))
  const browser=createPreviewTestBrowser(),native=createNativeCliProcessRunner(),cleanups:(()=>void|Promise<void>)[]=[]
  const prior=process.env.BEEGAME_WORKFLOW_V3_DEBUG;process.env.BEEGAME_WORKFLOW_V3_DEBUG='1'
  let driver:ReturnType<typeof Bun.spawn>|undefined,server:ReturnType<typeof Bun.serve>|undefined
  const requests:any[]=[]
  const nativeStarts:Array<string|undefined>=[]
  const nativeConfigs:string[]=[]
  let discussedSources:string[]|undefined
  const libraryRequests:string[]=[]
  const library=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    libraryRequests.push(request.headers.get('authorization') ?? '')
    return Response.json({items:[{packId:'offline-library-pack',license:'CC0'}]})
  }})
  const frame=(event:any)=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n'
  const provider=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const path=new URL(request.url).pathname
    if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    if(!path.endsWith('/messages'))return new Response('',{status:404})
    const body:any=await request.json();requests.push(body)
    const n=requests.length
    if(n===15) discussedSources=await Promise.all(['rules.mjs','rule.test.ts','notes.txt'].map(name=>readFile(join(workspace,name),'utf8')))
    let call:{name:string;input:unknown}|undefined
    if(n===1)call={name:'TodoWrite',input:{todos:[{content:'Inspect synthetic goal and use relevant Skill',status:'in_progress',activeForm:'Inspecting goal'},
      {content:'Write candidate, run rule test, fix failure and retest',status:'pending',activeForm:'Testing candidate'}]}}
    else if(n===2)call={name:'Skill',input:{skill:'bgs-builtins:gameplay-programmer'}}
    else if(n===3)call={name:'AskUserQuestion',input:{questions:[{header:'Color',question:'Choose synthetic color?',multiSelect:false,
      options:[{label:'Blue',description:'Blue fixture'},{label:'Green',description:'Green fixture'}]}]}}
    else if(n===4)call={name:'Write',input:{file_path:join(workspace,'rules.mjs'),content:'export const target = 2;\n'}}
    else if(n===5 || n===8)call={name:'Bash',input:{command:'bun test rule.test.ts',description:'Run synthetic rule verification'}}
    else if(n===6)call={name:'Read',input:{file_path:join(workspace,'rules.mjs')}}
    else if(n===7)call={name:'Edit',input:{file_path:join(workspace,'rules.mjs'),old_string:'target = 2',new_string:'target = 3'}}
    else if(n>=9 && n<=11) {
      const context=JSON.stringify(requests[0])
      const directory=context.match(/\.beegame\/tmp\/goal-tools-[A-Za-z0-9_-]+/)?.[0]
      if(!directory) throw Error('Actual native tool context must expose the tool directory')
      const assets=directory+'/assets.mjs'
      const checker=assets.replace('assets.mjs','check-content.mjs')
      call={name:'Bash',input:{command:n===9 ? 'bun '+JSON.stringify(assets)+' catalog' :
        'bun '+JSON.stringify(checker)+(n===10?' --format coordinates':' --layout-draft menu.json 960 540')+
        (n===11?' && node inspect-preview.mjs 3 && bun '+JSON.stringify(assets.replace('assets.mjs','measure.mjs'))+' --request first --artifact dist --report README.md'+
          ' && bun '+JSON.stringify(assets.replace('assets.mjs','handoff.mjs'))+' README.md rules.mjs --details':''),
        description:'Run actual optional BGS tool on synthetic inputs'}}
    }
    else if(n===13 || n===15 || n===26)call={name:'Read',input:{file_path:join(workspace,n===15?'rule.test.ts':'rules.mjs')}}
    else if(n===16)call={name:'Edit',input:{file_path:join(workspace,'rules.mjs'),old_string:'target = 3',new_string:'target = 4'}}
    else if(n===17)call={name:'Edit',input:{file_path:join(workspace,'rule.test.ts'),old_string:'toBe(3)',new_string:'toBe(4)'}}
    else if(n===18 || n===24) {
      const measure=[...JSON.stringify(body.messages).matchAll(/\.beegame\/tmp\/goal-tools-[A-Za-z0-9_-]+\/measure\.mjs/g)].at(-1)?.[0]
      if(!measure)throw Error('Current native turn must expose actual measurement entry')
      call={name:'Bash',input:{command:'bun test rule.test.ts && node inspect-preview.mjs 4 && bun '+JSON.stringify(measure)+' --request recheck-'+n+' --artifact dist --report README.md',description:'Retest changed rule and measure current source/build'}}
    }
    else if(n===20)call={name:'Write',input:{file_path:join(workspace,'progress.txt'),content:'partial'}}
    else if(n===21)call={name:'AskUserQuestion',input:{questions:[{header:'Pause',question:'Synthetic interruption checkpoint?',multiSelect:false,
      options:[{label:'Continue',description:'Synthetic option'},{label:'Wait',description:'Synthetic option'}]}]}}
    else if(n===22)call={name:'Read',input:{file_path:join(workspace,'progress.txt')}}
    else if(n===23)call={name:'Edit',input:{file_path:join(workspace,'progress.txt'),old_string:'partial',new_string:'complete'}}
    return new Response(frame({type:'message_start',message:{id:'offline-'+n,type:'message',role:'assistant',model:body.model,
      content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
      frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'goal-tool-'+n,name:call.name,input:{}}:{type:'text',text:''}})+
      frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Synthetic candidate saved; actual rule retest passed, not game acceptance.'}})+
      frame({type:'content_block_stop',index:0})+frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
      frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
  }})
  try {
    await mkdir(workspace,{recursive:true})
    await writeFile(join(workspace,'rule.test.ts'),"import{test,expect}from'bun:test';import{target}from'./rules.mjs';test('synthetic target',()=>expect(target).toBe(3));")
    await writeFile(join(workspace,'notes.txt'),'Independent fixture notes retained.')
    await writeFile(join(workspace,'CLAUDE.md'),'# Project navigation\nGUIDE_DEBUG_ACTUAL_ENTRY\nRoute: actual synthetic Web consumer\nEntry: rules.mjs; Scene/UI: content/\nVerify: bun test rule.test.ts\n')
    await writeFile(join(workspace,'README.md'),'# Synthetic merged design record\nExisting gameplay, technology, art, audio, UI, scene, balance and resources references; transport fixture only, not a complete design or quality PASS.\n')
    await writeFile(join(workspace,'menu.json'),JSON.stringify(CONTENT_DRAFT_EXAMPLES.ui))
    await mkdir(join(workspace,'content/ui'),{recursive:true});await mkdir(join(workspace,'content/scenes'),{recursive:true})
    await writeFile(join(workspace,'content/ui/menu.json'),JSON.stringify(uiLayoutFixture()))
    await writeFile(join(workspace,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(workspace,'asset-manifest.json'),'{}')
    await writeFile(join(workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'agent-debug',sceneModel:'game-object-v2',dimension:'2d',
      documentRevision:digest(await readFile(join(workspace,'README.md'))),assetManifestRevision:digest(await readFile(join(workspace,'asset-manifest.json'))),
      entryScene:'level',files:['ui/menu.json','scenes/level.json'],documents:[
        {path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},{path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
    // Pre-existing synthetic consumer, not a manually repaired BGS project.
    await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{dev:'node dev.mjs',build:'bun build.mjs'}}))
    await writeFile(join(workspace,'build.mjs'),"import{mkdir,readFile,cp}from'node:fs/promises';const source=await readFile('rules.mjs','utf8');const target=Number(source.match(/target = (\\d+)/)[1]);await mkdir('dist',{recursive:true});await cp('content','dist/content',{recursive:true});await Bun.write('dist/index.html','<!doctype html><title>Measured fixture</title><h1 id=target>'+target+'</h1><button id=editable-play>Play</button><output id=scene-x></output><script>fetch(\"content/ui/menu.json\").then(r=>r.json()).then(d=>document.querySelector(\"#editable-play\").style.height=d.data.nodes[1].layout.size[1]+\"px\");fetch(\"content/scenes/level.json\").then(r=>r.json()).then(d=>document.querySelector(\"#scene-x\").textContent=d.data.nodes[1].transform.position[0]);</script>');")
    await writeFile(join(workspace,'dev.mjs'),"import {createServer} from 'node:http';\nimport {readFile} from 'node:fs/promises';\ncreateServer(async (_req,res)=>{\n  const source=await readFile('rules.mjs','utf8');\n  const target=Number(source.match(/target = (\\d+)/)[1]);\n  res.writeHead(200,{'content-type':'text/html'});\n  res.end('<!doctype html><title>Synthetic rule consumer</title><h1 id=\"target\">'+target+'</h1><button id=\"step\">Step</button><output id=\"score\">0</output><output id=\"result\">Playing</output><script>let n=0;document.querySelector(\"#step\").onclick=()=>{document.querySelector(\"#score\").textContent=++n;document.querySelector(\"#result\").textContent=n==='+target+'?\"Won\":\"Playing\"}</script>');\n}).listen(Number(process.env.PORT),'127.0.0.1');")
    await writeFile(join(workspace,'inspect-preview.mjs'),"import assert from 'node:assert/strict';\nconst {resolvePreviewApi,withPreviewPage}=await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);\nconst api=await resolvePreviewApi();\nconst expected=Number(process.argv[2]);\nconst unsupported=await fetch(api+'/preview',{method:'POST',body:JSON.stringify({mode:'production'})});\nassert.equal(unsupported.status,503); // No preview script; no silent dev fallback.\nconst outcome=await withPreviewPage({mode:'development'},async({page,frame,context})=>{\n  const cdp=await context.newCDPSession(page);\n  const {targetInfo}=await cdp.send('Target.getTargetInfo');\n  const start=await fetch(api+'/recordings',{method:'POST',body:JSON.stringify({targetId:targetInfo.targetId,label:'Synthetic rule consumer',conditions:'Current source target '+expected})});\n  assert.equal(start.status,201);const {id}=await start.json();\n  assert.equal(await frame.locator('#target').innerText(),String(expected));\n  for(let i=0;i<expected;i++)await frame.locator('#step').click();\n  assert.equal(await frame.locator('#result').innerText(),'Won');\n  const finished=await fetch(api+'/recordings/'+id+'/finish',{method:'POST'});\n  assert.equal(finished.status,200);const report=await finished.json();\n  assert.equal(report.status,'finished');assert.equal(report.gameplayVerdict,'not-evaluated');\n  await cdp.detach();\n  return {managedPreviewTarget:expected,result:'Won',recordingId:id,productionWithoutBuild:'unsupported'};\n});\nconsole.log(JSON.stringify(outcome));")
    let app:ReturnType<typeof createAgentWorkflowApp>|undefined
    server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>app?app.fetch(r):new Response('Initializing',{status:503})})
    app=createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:join(root,'projects'),workflowV3Store:store,workflowV3PreviewOrigin:'http://localhost:'+server.port,
      modelConfigStore:false,skillsConfig:false,invitationService:false,
      resourceSelectionRuntimeConfig:{baseUrl:library.url.origin,serviceToken:'offline-service-key-never-given-to-native'},
      currentUserResolver:r=>r.headers.get('Authorization')==='Bearer synthetic-owner'?{id:'owner',role:'owner'}:undefined,
      registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(input){
        if(await realpath(input.cwd)!==workspace)throw Error('Offline native runner must stay in synthetic workspace')
        nativeStarts.push(input.resumeSessionId)
        nativeConfigs.push(input.env.BEEGAME_CONFIG_DIR!)
        return native.start({...input,env:{...input.env,BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_AUTH_TOKEN:'offline',
          ANTHROPIC_BASE_URL:provider.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',
          BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}})
      }}})
    const api=async(path:string,body:unknown)=>{
      const r=await app!.request('http://localhost'+path,{method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},body:JSON.stringify(body)})
      expect(r.status,await r.clone().text()).toBeLessThan(300)
    }
    await api('/api/model-configs',{name:'Offline native transport',provider:'openai-compatible',apiKey:'offline',models:{balanced:'offline'},isDefault:true})
    await api('/api/projects',{id:'agent-debug',name:'Synthetic full goal',root_path:workspace,created_at:Date.now()})
    // The debug reader reuses this API: lexical containment must not expose a
    // file outside the owned project through a symlink. Only synthetic data.
    await writeFile(join(root,'outside-report.md'),'SYNTHETIC_OUTSIDE_PROJECT')
    await symlink(join(root,'outside-report.md'),join(workspace,'outside-link.md'))
    const escaped=await app.request('http://localhost/api/projects/agent-debug/artifacts?path=outside-link.md',
      {headers:{Authorization:'Bearer synthetic-owner'}})
    expect(escaped.status).toBe(400)
    expect(await escaped.text()).not.toContain('SYNTHETIC_OUTSIDE_PROJECT')
    await symlink(join(workspace,'notes.txt'),join(workspace,'notes-link.md'))
    const internal=await app.request('http://localhost/api/projects/agent-debug/artifacts?path=notes-link.md',
      {headers:{Authorization:'Bearer synthetic-owner'}})
    expect(internal.status).toBe(200)
    expect((await internal.json()).content).toBe('Independent fixture notes retained.')
    await rm(join(workspace,'outside-link.md'));await rm(join(workspace,'notes-link.md'))
    const brief={kind:'confirmed_build_brief',idea:'Synthetic transport: produce target=3, check it and preserve independent notes',
      selected_option:{title:'Synthetic target',coreLoop:'increment and verify'},settings:{engine:'React',orientation:'Landscape'},
      document_language:'en',game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'}
    const {endpoint}=await browser.start(),node=Bun.which('node');if(!node)throw Error('Installed Node required')
    const launched=Bun.spawn([node,fileURLToPath(new URL('./agent-goal-browser.mjs',import.meta.url))],{
      env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
    driver=launched
    launched.stdin.write(JSON.stringify({endpoint,origin:server.url.origin,brief,focusedContinuation}));launched.stdin.end()
    const timer=setTimeout(()=>driver?.kill(),105000)
    const [output,errors,code]=await Promise.all([new Response(launched.stdout).text(),new Response(launched.stderr).text(),launched.exited]);clearTimeout(timer)
    expect(code,errors).toBe(0);const observed=JSON.parse(output);expect(observed.passed).toBe(true)
    const run=(await store.read('agent-debug','owner'))!,turn=run.agentTurns![0]!
    expect(requests).toHaveLength(28);expect(run.agentTurns).toHaveLength(7)
    // Real CLI transports stable responsibilities as system context, not a
    // growing duplicate in every user message. No model limit/history rewrite.
    expect(JSON.stringify(requests[0].system)).toContain('Professional coverage:')
    expect(JSON.stringify(requests[0].messages)).not.toContain('Professional coverage:')
    expect(JSON.stringify(requests[15].system)).toContain('Professional coverage:')
    expect(JSON.stringify(requests[15].messages)).not.toContain('Professional coverage:')
    for(const request of requests) {
      expect(JSON.stringify(request.system).split('GUIDE_DEBUG_ACTUAL_ENTRY')).toHaveLength(2)
      expect(JSON.stringify(request.messages)).not.toContain('GUIDE_DEBUG_ACTUAL_ENTRY')
    }
    expect(JSON.stringify(requests[12].system)).not.toContain('Professional coverage:')
    const latestFacts=requests[25].messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[])
      .findLast((block:any)=>block.type==='text' && block.text.startsWith('Optional BGS project tools'))?.text
      .split('BGS saved evidence (not game acceptance): ')[1]
    const facts=JSON.parse(latestFacts)
    expect(facts.task.requestKey).toBe(run.agentTurns![5]!.requestKey)
    expect(facts.executionContext.mode).toBe('focused')
    expect(JSON.stringify(facts.executionContext.answeredQuestions)).toContain('Blue')
    expect(JSON.stringify(facts.executionContext.answeredQuestions)).toContain('Choose synthetic color?')
    expect(JSON.stringify(requests[25].messages)).not.toContain('goal-tool-1')
    expect(JSON.stringify(requests[25].messages)).not.toContain('## Gameplay Programmer')
    expect(facts.task.intent).toBe('work')
    expect(facts.task).not.toHaveProperty('text') // actual user block already carries it
    expect(JSON.stringify(requests[25].messages)).toContain(run.agentTurns![5]!.message!.text)
    expect(facts.executionContext.previousExecution).toMatchObject({attemptId:run.agentTurns![4]!.attemptId,
      status:'ended',quiescedAt:run.agentTurns![4]!.quiescedAt,externalOutcomes:'not-inferred'})
    expect(facts.skills.currentTurnUses).toEqual([])
    expect(facts.measurement.freshness).toMatchObject({current:true,changes:{requirements:false,sources:[],reports:[]}})
    expect(facts.reportSemantics).toBe('not-verified');expect(facts.quality).toBe('unverified')
    expect(facts.project.commands).toHaveProperty('build')
    expect(facts.project.rootFiles).toEqual(expect.arrayContaining(['rules.mjs','build.mjs','package.json']))
    expect(facts.project.codeFiles).toEqual([]) // fixture maintains root code, not an invented src/ entry
    expect(facts.skills).toMatchObject({recordedMainLoads:[],contextPresence:'not-transferred'})
    expect(facts.skills.contextPresence).toBe('not-transferred');expect(facts.skills.application).toBe('unverified')
    expect(facts.measurement.id).toBe(run.agentTurns![4]!.measurements!.at(-1)!.id)
    expect(JSON.stringify(requests[25].messages)).not.toContain('Reuse applicable evidence and revise/retest actual affected results')
    expect(run.agentTurns![5]!.measurements).toBeUndefined()
    const runtime=(await readFile(join(workspace,'.beegame/logs/native-runtime.jsonl'),'utf8'))
      .trim().split('\n').map(line=>JSON.parse(line))
    expect(runtime.some(row=>row.type==='native_diagnostic' && row.diagnostic.event==='request_start' && row.diagnostic.evidenceSource==='cli_debug')).toBe(true)
    expect(runtime.some(row=>row.type==='native_diagnostic' && row.diagnostic.event==='response_headers' && row.diagnostic.status===200 && row.diagnostic.evidenceSource==='cli_debug')).toBe(true)
    expect(libraryRequests).toEqual(['Bearer synthetic-owner'])
    expect(JSON.stringify(requests[9].messages)).toContain('offline-library-pack')
    expect(JSON.stringify(requests[10].messages)).toContain('content-format-selection')
    expect(JSON.stringify(requests[11].messages)).toContain('layout-draft-inspection')
    expect(JSON.stringify(requests[11].messages)).toContain('agent-task-evidence-handoff')
    expect(JSON.stringify(requests[11].messages)).toContain('currentTurnUses')
    expect(JSON.stringify(requests[11].messages)).toContain('bgs-builtins:gameplay-programmer')
    const system=typeof requests[0].system==='string'?[{type:'text',text:requests[0].system}]:requests[0].system??[]
    const toolContext=[...system,...requests[0].messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[])]
      .find((block:any)=>block.type==='text' && block.text.includes('BGS saved evidence (not game acceptance): '))?.text
    expect(typeof toolContext).toBe('string')
    // Saved source names/task facts legitimately vary; do not impose a
    // combined character budget or repeat the goal just to fit this fixture.
    const startupFacts=JSON.parse(toolContext.split('BGS saved evidence (not game acceptance): ')[1].split('\n')[0])
    expect(startupFacts.task).not.toHaveProperty('text')
    expect(startupFacts.task.requestKey).toBe(turn.requestKey)
    expect(startupFacts.skills.currentTurnEvidence).toBe('live-native-load-events')
    expect(JSON.stringify(requests[11].messages)).toContain('managedPreviewTarget')
    expect(JSON.stringify(requests[11].messages)).toContain('productionWithoutBuild')
    expect(JSON.stringify(requests[18].messages)).toContain('managedPreviewTarget')
    expect(JSON.stringify(requests[24].messages)).toContain('managedPreviewTarget')
    const nativeEvents=(await app!.request(server.url.origin+'/api/projects/agent-debug/workflow-v3/events',
      {headers:{Authorization:'Bearer synthetic-owner'}}))
    expect(nativeEvents.status).toBe(200)
    expect(await readFile(projectPreviewCapabilityPath(workspace,run.chatSessionId),'utf8').catch(()=>undefined)).toBeUndefined()
    expect(['plans','tasks','attempts'].some(key=>key in run)).toBe(false)
    expect(run.sourceEdits).toHaveLength(2)
    expect(run.sourceEdits!.every(e=>e.sourceEdit.status==='saved' && e.quiescedAt)).toBe(true)
    expect(run.agentTurns![2]!.measurements!.at(-1)!.sourceEditId).toBe(run.sourceEdits!.at(-1)!.attemptId)
    expect(JSON.parse(await readFile(join(workspace,'dist/content/ui/menu.json'),'utf8')).data.nodes[1].layout.size[1]).toBe(64)
    expect(JSON.parse(await readFile(join(workspace,'dist/content/scenes/level.json'),'utf8')).data.nodes[1].transform.position[0]).toBe(30)
    expect(turn.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);expect(turn.quiescedAt).toBeDefined()
    expect(turn.skillUses).toContainEqual(expect.objectContaining({name:'bgs-builtins:gameplay-programmer',status:'loaded'}))
    expect((turn.usage as {total_tokens:number}).total_tokens).toBe(180)
    expect(JSON.stringify(requests[0].messages)).toContain('continue through implementation and actual runtime checks')
    expect(JSON.stringify(requests[0].system)).toContain('BALANCE_DESIGN.md')
    expect(JSON.stringify(requests[0].system)).toContain('ASSET_PLAN.md')
    expect(JSON.stringify(requests[15].messages)).not.toContain('only affected domains')
    expect(JSON.stringify(requests[15].messages)).toContain('User-authorized source saves since the preceding native turn')
    expect(JSON.stringify(requests[15].messages)).toContain('content/scenes/level.json')
    expect(JSON.stringify(requests)).not.toContain('offline-service-key-never-given-to-native')
    expect(JSON.stringify(requests[3].messages)).toContain('Blue')
    expect(await readFile(join(workspace,'rules.mjs'),'utf8')).toContain('target = 4')
    expect(await readFile(join(workspace,'progress.txt'),'utf8')).toBe('complete')
    expect(await readFile(join(workspace,'notes.txt'),'utf8')).toBe('Independent fixture notes retained.')
    expect(run.deliveryEligible).toBe(false)
    expect(new Set(run.agentTurns!.slice(0,5).map(t=>t.nativeSessionId)).size).toBe(focusedContinuation?2:1)
    expect(new Set(run.agentTurns!.map(t=>t.nativeSessionId)).size).toBe(focusedContinuation?3:2)
    expect(run.agentTurns![6]!.nativeSessionId).toBe(run.agentTurns![5]!.nativeSessionId)
    expect(nativeStarts).toEqual([undefined,...Array(3).fill(turn.nativeSessionId),focusedContinuation?undefined:turn.nativeSessionId,undefined,run.agentTurns![5]!.nativeSessionId])
    expect(nativeConfigs).toHaveLength(7)
    expect(new Set(nativeConfigs).size).toBe(1)
    expect(nativeConfigs[0]).toBe(join(root,'dashboard','users','owner','.runtime','app'))
    expect(discussedSources?.[0]).toBe('export const target = 3;\n')
    expect(discussedSources?.[1]).toContain('toBe(3)')
    expect(discussedSources?.[2]).toBe('Independent fixture notes retained.')
    expect(run.agentTurns!.map(t=>t.status)).toEqual(['ended','ended','ended','interrupted','ended','ended','ended'])
    expect(run.requirementChanges).toHaveLength(2)
    expect(run.agentTurns![0]!.requirementsRevision).not.toBe(run.requirements.revision)
    expect(run.agentTurns![4]!.requirementsRevision).toBe(run.requirements.revision)
    expect(JSON.stringify(requests[14].messages)).toContain('Explain the existing target')
    expect(JSON.stringify(requests[12].messages)).toContain('Blue')
    expect(JSON.stringify(requests[12].messages)).not.toContain('workflow_v3_repair')
    expect(JSON.stringify(requests[21].messages)).toContain('progress.txt')
    expect(JSON.stringify(requests[21].messages)).toContain('Do not blindly replay commands')
    if(focusedContinuation) {
      expect(JSON.stringify(requests[21].messages)).not.toContain('goal-tool-1')
      expect(JSON.stringify(requests[21].messages)).not.toContain('## Gameplay Programmer')
      expect(JSON.stringify(requests[21].messages)).toContain('Blue')
      expect(JSON.stringify(requests[21].messages)).toContain(run.agentTurns![3]!.attemptId)
    }
    console.log(JSON.stringify({agentGoalNativeDebug:true,...observed,requests:requests.length,
      goalPromptChars:agentGoalPrompt({...run,requirements:run.requirementChanges?.[0]?.before??run.requirements}).length,
      toolContextChars:toolContext.length,usage:turn.usage,paidModelCalls:0,
      messageChars:{beforeFocused:JSON.stringify(requests[24].messages).length,
        focused:JSON.stringify(requests[25].messages).length,followingResume:JSON.stringify(requests[27].messages).length},
      turnUsage:run.agentTurns!.map(t=>({intent:t.message?.intent??'goal',status:t.status,usage:t.usage})),
      professionalTools:['authenticated-library-catalog','pure-format-no-materialization','real-draft-layout',
        'managed-preview-current-source-3-to-4','real-browser-interaction','passive-recording','no-production-fallback','turn-revocation']}))
  }finally{
    if(driver?.exitCode===null){driver.kill();await driver.exited}
    await Promise.all(cleanups.map(fn=>fn()));server?.stop(true);provider.stop(true);library.stop(true);await browser.close()
    if(prior===undefined)delete process.env.BEEGAME_WORKFLOW_V3_DEBUG;else process.env.BEEGAME_WORKFLOW_V3_DEBUG=prior
    await rm(root,{recursive:true,force:true})
  }
},115000)
