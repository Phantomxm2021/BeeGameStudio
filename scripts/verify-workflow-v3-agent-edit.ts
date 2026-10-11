import { mkdir, mkdtemp, realpath, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { loadEnvFile } from './beegame-migration-cli'
import { getMacroDefines } from './defines'
import { createRemoteWorkflowStore } from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import { digest } from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { uiLayoutFixture, sceneLayoutFixture } from '../packages/agent-workflow-server/src/beegame/fixtures/layout-fixture'

// Explicit retained synthetic fixture: real auth, remote store, native CLI,
// source-copy build and browser measurement. Only model responses are fixed.
// No production service, schema, account, model configuration or game edits.
const args = process.argv.slice(2)
if (args.length !== 5 || args[0] !== '--apply' || args[1] !== '--env-file' ||
    !['--source-project','--resume-project'].includes(args[3]!))
  throw Error('Usage: bun scripts/verify-workflow-v3-agent-edit.ts --apply --env-file PATH (--source-project OWNED_ID | --resume-project SYNTHETIC_ID)')
loadEnvFile(args[2]!)
const config = { url: process.env.BEEGAME_SUPABASE_URL!, serviceKey: process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY! }
if (!config.url || !config.serviceKey || process.env.BEEGAME_HTTPONLY_SESSIONS !== '1')
  throw Error('Normal database and HttpOnly authentication configuration required')
const rest = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(config.url.replace(/\/+$/, '')+'/rest/v1/'+path, {
    ...init, headers: { apikey: config.serviceKey, authorization: 'Bearer '+config.serviceKey,
      'content-type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw Error('Synthetic database request failed (HTTP '+response.status+')')
  return response.status === 204 ? undefined : response.json()
}
const source = (await rest('beegame_projects?select=id,owner_id,workspace_id,root_path,name&id=eq.'+encodeURIComponent(args[4]!)))[0]
if (!source) throw Error('Source metadata unavailable; no write performed')
const resuming = args[3] === '--resume-project', name = 'Synthetic V3 Autonomous Source Edit'
if (resuming && (!source.id.startsWith('v3-agent-edit-') || source.name !== name))
  throw Error('Only this script’s retained synthetic fixture may be resumed')
const root = resuming ? await realpath(source.root_path) : await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-agent-edit-')))
if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith('bgs-v3-agent-edit-'))
  throw Error('Fixture must remain in its exact synthetic temporary directory')
const projectId = resuming ? source.id : 'v3-agent-edit-'+randomUUID()
if (!resuming) {
  for (const dir of ['content/ui','content/scenes','docs','src']) await mkdir(join(root,dir),{recursive:true})
  await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(uiLayoutFixture()))
  await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
  await writeFile(join(root,'docs/README.md'),'# Synthetic transport fixture\nNot a game or eight-domain quality acceptance. Preserve registered UI/Scene and independent notes; measure their actual build.\n')
  await writeFile(join(root,'asset-manifest.json'),'{}')
  await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'synthetic-agent-edit',dimension:'2d',
    documentRevision:digest(await readFile(join(root,'docs/README.md'))),assetManifestRevision:digest(await readFile(join(root,'asset-manifest.json'))),
    entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json','scenes/level.json'],documents:[
      {path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},{path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
  await writeFile(join(root,'notes.json'),'{"synthetic":"independent retained record"}\n')
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs'}}))
  await writeFile(join(root,'build.mjs'),"import{cp,mkdir}from'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
  await writeFile(join(root,'src/index.html'),`<!doctype html><meta charset="utf-8"><title>Synthetic Remote Edit</title><h1>Synthetic Remote Edit</h1><button id="play">Ready</button><output id="scene-x"></output><output id="feedback"></output><script>Promise.all([fetch('/content/ui/menu.json').then(r=>r.json()),fetch('/content/scenes/level.json').then(r=>r.json())]).then(([u,s])=>{const n=u.data.nodes.find(n=>n.id==='play'),b=document.querySelector('#play');b.style.width=n.layout.size[0]+'px';b.style.height=n.layout.size[1]+'px';document.querySelector('#scene-x').textContent=s.data.nodes.find(n=>n.id==='board').transform.position[0];b.onclick=()=>document.querySelector('#feedback').textContent='Clicked';});</script>`)
  await rest('beegame_projects',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
    id:projectId,owner_id:source.owner_id,workspace_id:source.workspace_id,root_path:root,name})})
}
const store = createRemoteWorkflowStore({...config,fetchImpl:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})})
const counts = new Map<string,number>(), requests: Array<{attemptId:string;tool?:string}> = []
const frame = (event: {type:string;[key:string]:unknown}) => 'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n'
const provider = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
  const path = new URL(request.url).pathname
  if(path.endsWith('/count_tokens'))return Response.json({input_tokens:10})
  if(!path.endsWith('/messages'))return new Response('',{status:404})
  const body:any = await request.json(), run = await store.read(projectId,source.owner_id)
  if(!run?.writer || !run.agentTurns?.some(t=>t.attemptId===run.writer!.attemptId))return new Response('No active synthetic native turn',{status:409})
  const attemptId=run.writer.attemptId,n=(counts.get(attemptId)??0)+1;counts.set(attemptId,n)
  let call:{name:string;input:unknown}|undefined
  if(n<=2)call={name:'Read',input:{file_path:join(root,n===1?'content/ui/menu.json':'content/scenes/level.json')}}
  if(n===3) {
    const entry=[...JSON.stringify(body.messages).matchAll(/\.beegame\/tmp\/goal-tools-[A-Za-z0-9_-]+\/measure\.mjs/g)].at(-1)?.[0]
    if(!entry)return new Response('Actual measurement entry missing',{status:409})
    call={name:'Bash',input:{command:'bun '+JSON.stringify(entry)+' --request '+JSON.stringify(attemptId)+' --artifact dist --report docs/README.md',
      description:'Build and measure synthetic saved Scene/UI; no paid provider'}}
  }
  requests.push({attemptId,tool:call?.name})
  return new Response(frame({type:'message_start',message:{id:'offline-'+requests.length,type:'message',role:'assistant',model:body.model,
    content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
    frame({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:'fixture-'+requests.length,name:call.name,input:{}}:{type:'text',text:''}})+
    frame({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Synthetic measurement invocation ended; inspect host evidence. Not game acceptance.'}})+
    frame({type:'content_block_stop',index:0})+frame({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+
    frame({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
}})
// Isolated synthetic accounting only: never debit a user for fixed fake usage.
// This process-local setting does not change normal services or auth.
process.env.BEEGAME_BILLING_MODE='disabled'
process.env.BEEGAME_ALLOW_DEV_AUTH_TOKENS='0'
process.env.BEEGAME_WORKFLOW_V3_DEBUG='1'
process.env.NODE_ENV='development'
Object.assign(globalThis,{MACRO:Object.fromEntries(Object.entries(getMacroDefines()).map(([key,value])=>[key.replace('MACRO.',''),JSON.parse(value)]))})
const {createAgentWorkflowApp}=await import('../packages/agent-workflow-server/src/app')
const {createNativeCliProcessRunner}=await import('../packages/agent-workflow-server/src/beegame/native-cli-process-runner')
const native=createNativeCliProcessRunner(),cleanups:Array<()=>void|Promise<void>>=[]
let app:ReturnType<typeof createAgentWorkflowApp>|undefined
const server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:30,fetch:r=>app?app.fetch(r):new Response('Initializing',{status:503})})
process.env.BEEGAME_API_CORS_ORIGINS=[process.env.BEEGAME_API_CORS_ORIGINS,server.url.origin].filter(Boolean).join(',')
app=createAgentWorkflowApp({defaultWorkspacePath:root,dashboardDataRoot:join(root,'.beegame/host'),workflowV3Store:store,
  workflowV3PreviewOrigin:'http://localhost:'+server.port,modelConfigStore:false,skillsConfig:false,invitationService:false,
  registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(input) {
    const run=await store.read(projectId,source.owner_id)
    if(await realpath(input.cwd)!==root || run?.chatSessionId!==input.sessionId)throw Error('Only the exact synthetic fixture may execute')
    return native.start({...input,env:{...input.env,BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_AUTH_TOKEN:'offline',
      ANTHROPIC_BASE_URL:provider.url.origin,BGS_DEFAULT_BALANCED_MODEL:'claude-sonnet-4-6',
      BGS_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}})
  }}})
console.log(JSON.stringify({ready:true,origin:server.url.origin,debugUrl:server.url.origin+'/debug/workflow-v3',
  projectId,fixtureRoot:root,realDatabase:true,normalAuth:true,runner:'real-cli-fixed-loopback-model',
  retained:true,resuming,paidModelCalls:0,syntheticBilling:'disabled-in-this-process-only',automaticDispatch:false}))
let stopping=false
const stop=async()=>{if(stopping)return;stopping=true;await Promise.all(cleanups.map(fn=>fn()));server.stop(true);provider.stop(true);
  console.log(JSON.stringify({stopped:true,projectId,requests,paidModelCalls:0,retained:true}));process.exit(0)}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop())
await new Promise(()=>{})
