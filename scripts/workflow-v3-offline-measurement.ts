import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createAgentWorkflowApp} from '../packages/agent-workflow-server/src/app'
import {createNativeCliProcessRunner} from '../packages/agent-workflow-server/src/beegame/native-cli-process-runner'
import {createLocalWorkflowStore} from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import {uiLayoutFixture} from '../packages/agent-workflow-server/src/beegame/fixtures/layout-fixture'
import {resolveBeeGameBillingConfig} from '../packages/beegame-billing-core/src/billing-config'
import {projectPreviewCapabilityPath} from '../packages/agent-workflow-server/src/beegame/project-preview-capability'

// A transport fixture, not a game author, planner or replacement workflow.
// Only local scripted provider responses; native CLI/tools and normal BGS
// goal/permission/measurement/inspection/handoff APIs execute unchanged.
export async function createOfflineMeasurementFixture(){
 assert.equal(resolveBeeGameBillingConfig().mode,'disabled','Offline fixture refuses real billing configuration; do not load the production env')
 const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-native-measurement-')))
 const workspace=join(root,'projects/users/owner/native-measurement'),projectId='native-measurement'
 await mkdir(join(workspace,'content/ui'),{recursive:true})
 const ui=uiLayoutFixture(60)as any;ui.data.nodes[0].layout.size=[1024,576];ui.data.nodes[0].data.referenceResolution=[1024,576];ui.data.nodes[0].data.targetViewports=[[1024,576]]
 ui.data.nodes[1].layout.position=[-240,0]
 ui.data.nodes.push({...structuredClone(ui.data.nodes[1]),id:'hidden',layout:{anchor:'middle-center',size:[200,60],position:[0,0]}},
  {...structuredClone(ui.data.nodes[1]),id:'clipped',layout:{anchor:'middle-center',size:[200,60],position:[240,0]}})
 const originalUi=JSON.stringify(ui),originalNotes='Independent synthetic note retained.\n'
 await writeFile(join(workspace,'content/ui/menu.json'),originalUi)
 await writeFile(join(workspace,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'native-measurement',sceneModel:'game-object-v2',dimension:'2d',entryScene:'level',
  documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),files:['ui/menu.json'],documents:[{id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'}]}))
 await writeFile(join(workspace,'notes.txt'),originalNotes)
 await writeFile(join(workspace,'README.md'),'Synthetic measurement transport fixture; not a game-quality verdict or complete professional design.\n')
 await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{build:'bun build.mjs'}}))
 await writeFile(join(workspace,'build.mjs'),"import{mkdir,cp}from'node:fs/promises';await mkdir('dist',{recursive:true});await cp('index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
 const defective='#hidden-wrapper{opacity:0}#clip-wrapper{height:270px;overflow:hidden}'
 const repaired='#hidden-wrapper{opacity:1}#clip-wrapper{height:576px;overflow:visible}'
 const html='<!doctype html><style>body{margin:0}button{position:absolute;border:0;padding:0;box-sizing:border-box;font:18px/22px sans-serif}#clip-wrapper{position:absolute;left:0;top:0;width:1024px}'+defective+'</style><button id="play">Play</button><div id="hidden-wrapper"><button id="hidden">Hidden</button></div><div id="clip-wrapper"><button id="clipped">Clipped</button></div><script>fetch("/content/ui/menu.json").then(r=>r.json()).then(d=>{for(const n of d.data.nodes.filter(n=>n.role==="button")){const b=document.getElementById(n.id),s=n.layout.size,p=n.layout.position||[0,0];b.style.width=s[0]+"px";b.style.height=s[1]+"px";b.style.left=(512-s[0]/2+p[0])+"px";b.style.top=(288-s[1]/2+p[1])+"px";}})</script>'
 await writeFile(join(workspace,'index.html'),html)
 const store=createLocalWorkflowStore(join(root,'host')),native=createNativeCliProcessRunner(),cleanups:Array<()=>void|Promise<void>>=[]
 const requests:any[]=[],seen:any[]=[],emitted:any[]=[],nativeStarts:any[]=[]
 let turnCapability:{path:string;apiUrl:string}|undefined
 const probe=(id:string,selector='#'+id)=>({document:'content/ui/menu.json',nodeId:id,selector,viewport:[1024,576]})
 const bad={checks:['ui-data-consumption'],uiProbes:[probe('play'),probe('hidden'),probe('clipped'),probe('play','['),probe('play')]}
 const good={checks:['ui-data-consumption'],uiProbes:[probe('play'),probe('hidden'),probe('clipped')]}
 const frame=(e:any)=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n'
 const provider=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const path=new URL(request.url).pathname
  if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
  if(!path.endsWith('/messages'))return new Response('',{status:404})
  const body:any=await request.json();requests.push(body);const n=requests.length
  const block=body.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).findLast((b:any)=>b.type==='tool_result'&&b.tool_use_id==='measure-fixture-'+(n-1))
  const text=typeof block?.content==='string'?block.content:Array.isArray(block?.content)?block.content.map((v:any)=>v.text??JSON.stringify(v)).join('\n'):JSON.stringify(block?.content??null)
  if(n>1)seen.push({request:n,toolUseId:block?.tool_use_id,text,isError:block?.is_error})
  await writeFile(join(root,'transport-model-inputs.json'),JSON.stringify({root,requests:requests.length,seen},null,2),{mode:0o600})
  const context=JSON.stringify(body.messages),measure=[...context.matchAll(/\.beegame\/tmp\/goal-tools-[A-Za-z0-9_-]+\/measure\.mjs/g)].at(-1)?.[0]
  let call:{name:string;input:any}|undefined
  if([1,2,3,6,7,8].includes(n)){
   if(!measure)throw Error('Normal native goal must expose its current measurement entry')
   const handoff=measure.replace('measure.mjs','handoff.mjs')
   const command=n===1||n===6?'bun '+JSON.stringify(measure)+' --request '+(n===1?'bad':'good')+' --artifact dist --consumption-json '+JSON.stringify(JSON.stringify(n===1?bad:good)):
    n===2||n===7?'bun '+JSON.stringify(measure)+' --inspect bad --details':
    'bun '+JSON.stringify(handoff)+' content/ui/menu.json --details'
   call={name:'Bash',input:{command,description:'Offline synthetic measurement/inspection/handoff boundary'}}
  }else if(n===4)call={name:'Read',input:{file_path:join(workspace,'index.html')}}
  else if(n===5)call={name:'Edit',input:{file_path:join(workspace,'index.html'),old_string:defective,new_string:repaired}}
  if(call)emitted.push({id:'measure-fixture-'+n,...call})
  return new Response(frame({type:'message_start',message:{id:'offline-measurement-'+n,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
   frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'measure-fixture-'+n,name:call.name,input:{}}:{type:'text',text:''}})+
   frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Synthetic inputs measured and handed off; not a game-quality verdict.'}})+
   frame({type:'content_block_stop',index:0})+frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
 }})
 let app:ReturnType<typeof createAgentWorkflowApp>|undefined
 const previousDebug=process.env.BEEGAME_WORKFLOW_V3_DEBUG;process.env.BEEGAME_WORKFLOW_V3_DEBUG='1'
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>app?app.fetch(r):new Response('Initializing',{status:503})})
 app=createAgentWorkflowApp({dashboardDataRoot:join(root,'dashboard'),defaultWorkspacePath:join(root,'projects'),workflowV3Store:store,
  workflowV3PreviewOrigin:'http://localhost:'+server.port,modelConfigStore:false,skillsConfig:false,invitationService:false,
  currentUserResolver:r=>r.headers.get('Authorization')==='Bearer synthetic-owner'?{id:'owner',role:'owner'}:undefined,
  registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(input){
   assert.equal(await realpath(input.cwd),workspace,'No native execution outside the independent fixture')
   // The native runner supplies execution env later; read the existing
   // published capability by the same bound workspace/session identity.
   const path=projectPreviewCapabilityPath(input.cwd,input.sessionId,'measurement')
   const capability=JSON.parse(await readFile(path,'utf8'))
   turnCapability={path,apiUrl:capability.apiUrl}
   nativeStarts.push({resumeSessionId:input.resumeSessionId,provider:provider.url.origin})
   return native.start({...input,env:{...input.env,BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_AUTH_TOKEN:'offline',ANTHROPIC_BASE_URL:provider.url.origin,
    BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}})
  }}})
 async function api(path:string,body?:unknown){return fetch(server.url.origin+path,{method:body===undefined?'GET':'POST',
  headers:{Authorization:'Bearer synthetic-owner',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
 for(const [path,body]of [
  ['/api/model-configs',{name:'Offline measurement transport',provider:'openai-compatible',apiKey:'offline',models:{balanced:'offline'},isDefault:true}],
  ['/api/projects',{id:projectId,name:'Independent native measurement fixture',root_path:workspace,created_at:Date.now()}],
 ]as const){const r=await api(path,body);assert.ok(r.status<300,await r.text())}
 const restored=await api('/api/projects/'+projectId+'/session/ensure',{});assert.equal(restored.status,200);const chatSessionId=(await restored.json()).session.id
 const goal={requestKey:'offline-measurement-goal',chatSessionId,brief:{kind:'confirmed_build_brief',idea:'Independent transport fixture: measure current UI, inspect failures, retain the batch, repair only the synthetic CSS and remeasure; preserve JSON and notes. No dependency or external service use.',
  selected_option:{title:'Measurement feedback fixture'},settings:{engine:'Web',orientation:'Landscape'},document_language:'en',game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'}}
 const prefix='/api/projects/'+projectId+'/workflow-v3'
 let finished:Promise<any>|undefined
 async function finish(){
  const deadline=Date.now()+120000
  while(true){
   const run=await store.read(projectId,'owner')
   if(run?.agentTurns?.length&&!run.writer){assert.equal(run.agentTurns.at(-1)!.status,'ended',JSON.stringify(run.agentTurns.at(-1)));break}
   assert.ok(Date.now()<deadline,'Test watchdog: native fixture has not settled; this does not limit production Agent turns')
   const runtime=await api('/api/projects/'+projectId+'/runtime-state'),state=await runtime.json()
   for(const p of state.pending_permissions??[]){
    assert.ok(['Bash','Read','Edit'].includes(p.tool_name),'Unexpected fixture permission: '+p.tool_name)
    // Normal one-time permission response, restricted to this isolated
    // scripted fixture. No global approval setting or sandbox bypass.
    const r=await api('/api/projects/'+projectId+'/permissions/'+encodeURIComponent(p.id),{decision:'allow',scope:'once'});assert.equal(r.status,200)
   }
   await Bun.sleep(50)
  }
  const run=(await store.read(projectId,'owner'))!,turn=run.agentTurns![0]!,records=turn.measurements!
  assert.equal(nativeStarts.length,1);assert.equal(requests.length,9);assert.equal(records.length,2)
  assert.deepEqual(run.tasks,{});assert.deepEqual(run.attempts,[]);assert.equal(run.plans.length,0)
  const old=records.find(r=>r.requestKey==='bad')!,latest=records.find(r=>r.requestKey==='good')!
  const oldProbe=JSON.parse(old.checks.find(c=>c.id==='ui-data-consumption')!.observation)
  assert.deepEqual(oldProbe.probes.map((p:any)=>p.status),['passed','unverified','unverified','unverified','passed'])
  assert.equal(old.checks.at(-1)!.status,'unverified');assert.equal(latest.checks.at(-1)!.status,'passed')
  const text=(n:number)=>seen.find(s=>s.request===n)?.text??''
  for(const [n,fragment]of [[2,'ui-data-consumption'],[3,'ancestor is hidden'],[3,'clippedCount'],[3,'Target selector is invalid'],
   [4,'agent-task-evidence-handoff'],[7,'"current": true'],[8,'measurement-superseded'],[9,'agent-task-evidence-handoff'],[9,'"current": true']]as const)
   assert.ok(text(n).includes(fragment),'Actual model input omitted '+fragment+' at request '+n)
  const feedback=await api(prefix+'/agent/measurements/'+latest.id),current=await feedback.json()
  assert.equal(feedback.status,200);assert.equal(current.freshness.current,true);assert.equal(current.quality,'unverified');assert.equal(current.deliveryEligible,false)
  const historical=await api(prefix+'/agent/measurements/'+old.id),past=await historical.json()
  assert.equal(historical.status,200);assert.equal(past.freshness.code,'measurement-superseded')
  const before=JSON.stringify(run),exported=await api(prefix+'/export',{measurementId:latest.id,requirementsRevision:run.requirements.revision,kind:'project'})
  assert.equal(exported.status,200);const archive=new Uint8Array(await exported.arrayBuffer());await writeFile(join(root,'measured-project.zip'),archive)
  // Reads/exports and a duplicate intake must not rebuild or start a model.
  const duplicate=await api(prefix+'/agent/goal',goal);assert.equal(duplicate.status,202)
  assert.equal((await duplicate.json()).turn.attemptId,turn.attemptId)
  await Bun.sleep(100);assert.equal(nativeStarts.length,1);assert.equal(requests.length,9)
  assert.equal(JSON.stringify(await store.read(projectId,'owner')),before)
  // Observe the actual old capability after normal exit. Retain its endpoint
  // only in test memory; do not republish it or log bearer-like URLs.
  assert.ok(turnCapability)
  let missingCapability=false
  try{await readFile(turnCapability.path,'utf8')}catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT')missingCapability=true;else throw error
  }
  assert.ok(missingCapability,'Normal exit must revoke the turn capability file')
  let retiredBridgeRejected=false
  try{
   const response=await fetch(turnCapability.apiUrl,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({inspectRequestKey:'bad'}),signal:AbortSignal.timeout(2000)})
   retiredBridgeRejected=!response.ok
  }catch{retiredBridgeRejected=true}
  assert.ok(retiredBridgeRejected,'Retired turn bridge must not serve inspection or execution')
  const denied=await fetch(server.url.origin+prefix+'/agent/measurements/'+latest.id)
  assert.equal(denied.status,401,'Saved results still require normal user authentication')
  assert.equal(JSON.stringify(await store.read(projectId,'owner')),before)
  assert.equal(nativeStarts.length,1);assert.equal(requests.length,9)
  assert.equal(await readFile(join(workspace,'content/ui/menu.json'),'utf8'),originalUi)
  assert.equal(await readFile(join(workspace,'notes.txt'),'utf8'),originalNotes)
  assert.equal(await readFile(join(workspace,'index.html'),'utf8'),html.replace(defective,repaired))
  const evidence={root,workspace,projectId,normalAgentEntry:true,nativeStarts,requests:requests.length,paidCalls:0,synthetic:true,
   runId:run.id,version:run.version,permissionExpiry:{capabilityRemoved:missingCapability,retiredBridgeRejected,unauthenticatedReadStatus:denied.status},
   turn:{attemptId:turn.attemptId,nativeSessionId:turn.nativeSessionId,status:turn.status,quiescedAt:turn.quiescedAt},
   old:past,current,oldProbe,uiCheckVersion:latest.checks.at(-1)!.version,modelInputs:seen,exportBytes:archive.byteLength,unrelatedSourcesUnchanged:true,passed:true,
   limits:['Local store and synthetic owner','Scripted loopback provider, not model reasoning','Not game quality or production remote database acceptance']}
  await writeFile(join(root,'native-measurement-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600})
  return evidence
 }
 async function start(){const response=await api(prefix+'/agent/goal',goal);assert.equal(response.status,202,await response.clone().text());const result=await response.json();
  finished??=finish();finished.catch(()=>{});return result}
 async function close(){await Promise.all(cleanups.map(fn=>fn()));server.stop(true);provider.stop(true)
  if(previousDebug===undefined)delete process.env.BEEGAME_WORKFLOW_V3_DEBUG;else process.env.BEEGAME_WORKFLOW_V3_DEBUG=previousDebug}
 return{root,workspace,origin:server.url.origin,projectId,api,start,async wait(){assert.ok(finished,'Start explicitly before waiting');return finished},close,
  snapshot:async()=>({run:await store.read(projectId,'owner'),modelRequests:requests.length,nativeStarts:nativeStarts.length,paidCalls:0})}
}
