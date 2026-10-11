import { mkdir, mkdtemp, realpath, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { loadEnvFile } from './beegame-migration-cli'
import { createAgentWorkflowApp } from '../packages/agent-workflow-server/src/app'
import { createRemoteWorkflowStore, type WorkflowStore } from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import { V3_PROTOCOL, type TaskSpec } from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { readVersion } from '../packages/agent-workflow-server/src/beegame/workflow-v3/checks'
import { uiLayoutFixture, sceneLayoutFixture } from '../packages/agent-workflow-server/src/beegame/fixtures/layout-fixture'
import { createNativeCliProcessRunner } from '../packages/agent-workflow-server/src/beegame/native-cli-process-runner'
import { createOfflineNativeReviewFixture } from './workflow-v3-offline-native'

// Opt-in, retained synthetic fixture only. Real DB + normal BGS auth/API;
// controlled runner never contacts a model. Not a game-quality experiment.
const args=process.argv.slice(2)
const nativeOffline=args.at(-1)==='--native-offline'
if(nativeOffline)args.pop()
if(args.length!==5||args[0]!=='--apply'||args[1]!=='--env-file'||!['--source-project','--resume-project'].includes(args[3]!))
  throw Error('Usage: bun scripts/verify-workflow-v3-remote-debug.ts --apply --env-file PATH (--source-project OWNED_PROJECT_ID | --resume-project SYNTHETIC_PROJECT_ID) [--native-offline]')
loadEnvFile(args[2]!)
const url=process.env.BEEGAME_SUPABASE_URL!,key=process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY!
if(!url||!key||process.env.BEEGAME_HTTPONLY_SESSIONS!=='1')throw Error('Real database and normal HttpOnly login configuration required')
const rest=async(path:string,init:RequestInit={})=>{
  const response=await fetch(url.replace(/\/+$/,'')+'/rest/v1/'+path,{...init,headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw Error('Synthetic fixture database operation failed (HTTP '+response.status+')')
  return response.status===204?undefined:response.json()
}
const source=(await rest('beegame_projects?select=id,owner_id,workspace_id,root_path,name&id=eq.'+encodeURIComponent(args[4]!)))[0]
if(!source)throw Error('Owned source metadata not found; no writes performed')
const resuming=args[3]==='--resume-project'
if(resuming&&(!source.id.startsWith('v3-remote-debug-')||source.name!=='Synthetic V3 Remote Debug Acceptance'))
  throw Error('Only this script’s retained synthetic fixtures can be resumed')
const root=resuming?await realpath(source.root_path):await realpath(await mkdtemp(join(tmpdir(),'bgs-v3-remote-debug-')))
if(resuming&&(dirname(root)!==await realpath(tmpdir())||!basename(root).startsWith('bgs-v3-remote-debug-')))
  throw Error('Retained fixture must be an exact synthetic temporary directory')
const projectId=resuming?source.id:'v3-remote-debug-'+randomUUID()
const base=createRemoteWorkflowStore({url,serviceKey:key,fetchImpl:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})})
const native=createNativeCliProcessRunner()
let calls=0,failRecoverySettlement=true
const decisions:unknown[]=[],cleanups:(()=>void|Promise<void>)[]=[]
const store:WorkflowStore={read:base.read,async commit(p,a,v,r,event){
  // Deliberate transport-boundary failure AFTER host quiescence, not a fake
  // exit receipt. The real DB holds its current writer until explicit recovery.
  if(event==='attempt.settled'&&r.attempts.at(-1)?.taskId==='recovery'&&failRecoverySettlement){failRecoverySettlement=false;throw Error('Synthetic lost settlement request; no remote commit sent')}
  await base.commit(p,a,v,r,event)
}}
if(!resuming){
for(const dir of ['content/ui','content/scenes','src'])await mkdir(join(root,dir),{recursive:true})
const ui=uiLayoutFixture()
if(nativeOffline){ui.data.nodes[0]!.data!.referenceResolution=[1280,720];ui.data.nodes[0]!.data!.targetViewports=[[1280,720]];ui.data.nodes[0]!.layout.size=[1280,720]}
await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(ui))
await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'synthetic-remote-debug',dimension:'2d',documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json','scenes/level.json'],documents:[{path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},{path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
await writeFile(join(root,'notes.json'),'{"synthetic":"independent immutable branch"}')
await writeFile(join(root,'recovery.json'),'{"synthetic":"interrupted settlement, not accepted"}')
await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs','test:rules':'bun -e "const d=await Bun.file(\'content/ui/menu.json\').json();process.exit([80,96].includes(d.data.nodes[1].layout.size[1])?0:1)"'}}))
await writeFile(join(root,'build.mjs'),"import {cp,mkdir} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
await writeFile(join(root,'src/index.html'),`<!doctype html><meta charset="utf-8"><title>Remote Debug Fixture</title><h1>Remote Debug Fixture</h1><p>Controlled synthetic fixture, not a game</p><button id="play">Ready</button><output id="feedback"></output><script>Promise.all([fetch('/content/ui/menu.json').then(r=>r.json()),fetch('/content/scenes/level.json').then(r=>r.json())]).then(([u,s])=>{const n=u.data.nodes.find(n=>n.id==='play'),b=document.querySelector('#play');b.style.width=n.layout.size[0]+'px';b.style.height=n.layout.size[1]+'px';${nativeOffline?"b.style.position='absolute';b.style.boxSizing='border-box';const p=n.layout.position||[0,0];b.style.left=(innerWidth/2-n.layout.size[0]/2+p[0])+'px';b.style.top=(innerHeight/2-n.layout.size[1]/2+p[1])+'px';":''}document.body.dataset.sceneX=s.data.nodes.find(n=>n.id==='board').transform.position[0];b.onclick=()=>document.querySelector('#feedback').textContent='Clicked';});</script>`)
await rest('beegame_projects',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id:projectId,owner_id:source.owner_id,workspace_id:source.workspace_id,root_path:root,name:'Synthetic V3 Remote Debug Acceptance'})})
}
console.log(JSON.stringify({projectId,fixtureRoot:root,resuming,retained:true,paidModelCalls:0}))
const game:TaskSpec={id:'game',kind:'game.develop',goal:'Consume saved UI and Scene in a real source-copy build; keep independent notes',dependsOn:[],requirementIds:['req.play'],inputs:['src/index.html','content/ui/menu.json','content/scenes/level.json'],writablePaths:['src/index.html','content/ui/menu.json','content/scenes/level.json','dist/**'],expectedOutputs:['src/index.html','content/ui/menu.json','content/scenes/level.json','dist/index.html'],checks:['build','runtime-smoke'],runtimeArtifact:'dist',editableProject:true}
if(nativeOffline){game.skills=['bgs-builtins:gameplay-programmer'];game.checks.push('ui-data-consumption');game.uiProbes=[{document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:[1280,720]}]}
const notes:TaskSpec={id:'notes',kind:'game.develop',goal:'Preserve independent notes',dependsOn:[],requirementIds:['req.play'],inputs:['notes.json'],writablePaths:['notes.json'],expectedOutputs:['notes.json'],checks:['artifact-json']}
const recovery:TaskSpec={...notes,id:'recovery',goal:'Synthetic interrupted settlement; no authored changes',inputs:['recovery.json'],writablePaths:['recovery.json'],expectedOutputs:['recovery.json']}
if(!resuming){
  await mkdir(join(root,'.beegame/host'),{recursive:true})
  await writeFile(join(root,'.beegame/host/fixture-plan.json'),JSON.stringify({protocol:V3_PROTOCOL,baseRevision:0,fixtureRunner:nativeOffline?'actual-native-cli-offline-model':'controlled-no-model',tasks:[game,notes,recovery]},null,2))
}else{
  const fixturePlan=JSON.parse(await readFile(join(root,'.beegame/host/fixture-plan.json'),'utf8'))
  if(fixturePlan.protocol!==V3_PROTOCOL||fixturePlan.tasks?.map((t:TaskSpec)=>t.id).join(',')!=='game,notes,recovery')
    throw Error('Retained synthetic fixture identity could not be verified')
  if((fixturePlan.fixtureRunner??'controlled-no-model')!==(nativeOffline?'actual-native-cli-offline-model':'controlled-no-model'))
    throw Error('Retained fixture runner differs; do not mix controlled and native evidence')
}
const offline=nativeOffline?createOfflineNativeReviewFixture(root,()=>base.read(projectId,source.owner_id)):undefined
// The actual Chat, Run, plan and attempts must be created through the normal
// authenticated debug/API path, not synthetic IDs or direct host PASS writes.
process.env.BEEGAME_WORKFLOW_V3_DEBUG='1'
// Reserve an ephemeral loopback port before creating the preview manager. The
// fixture must configure its real wildcard localhost origin, not bypass the
// production manager or fall back to an unmeasured development script.
let app:ReturnType<typeof createAgentWorkflowApp>|undefined
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>app?app.fetch(request):new Response('Initializing synthetic fixture',{status:503})})
app=createAgentWorkflowApp({dashboardDataRoot:join(root,'.beegame/host'),defaultWorkspacePath:root,workflowV3Store:store,workflowV3PreviewOrigin:'http://localhost:'+server.port,modelConfigStore:false,skillsConfig:false,invitationService:false,registerCleanup:fn=>cleanups.push(fn),sessionRunner:{async start(input){
  if(await realpath(input.cwd)!==root)throw Error('Controlled runner accepts only the freshly provisioned synthetic fixture')
  if(offline)return native.start({...input,env:offline.env})
  return{stop(){},async dispose(){},async submit(turn){
    calls++;const current=(await base.read(projectId,source.owner_id))!,attempt=current.attempts.find(a=>a.attemptId===current.writer?.attemptId)!,task=current.tasks[attempt.taskId]!.spec
    if(task.repairOf){
      const question='Choose the confirmed synthetic play-button height?'
      const decision=await turn.requestPermission({toolUseID:'height-'+attempt.attemptId,toolName:'AskUserQuestion',message:'Synthetic F1 needs the confirmed user selection, not reviewer preference',input:{questions:[{header:'F1',question,multiSelect:false,options:[{label:'80',description:'80 pixels'},{label:'96',description:'96 pixels'}]}]}})
      decisions.push({attemptId:attempt.attemptId,behavior:decision.behavior})
      if(decision.behavior==='allow'){
        const height=Number((decision.updatedInput as {answers?:Record<string,string>})?.answers?.[question]);if(![80,96].includes(height))throw Error('Unknown fixture answer')
        const doc=JSON.parse(await readFile(join(root,'content/ui/menu.json'),'utf8'));doc.data.nodes[1].layout.size[1]=height;await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(doc))
      }
    }else if(task.reviewReport){
      const sourceVersion=await readVersion(root,'content/ui/menu.json'),quote=await readFile(join(root,'content/ui/menu.json'),'utf8')
      const report={requirementsRevision:current.requirements.revision,planRevision:current.planRevision,
        findings:task.reviewOf?[]:[{id:'F1',requirementId:'req.play',ownerTaskId:'game',severity:'blocker',sources:[{...sourceVersion,quote}],impact:'Rendered fixture height is not one of the confirmed user choices',close:'Ask the user then set chosen height; verify current rule, real build and runtime',verifyWith:['rule-tests','build','runtime-smoke'],needsUserDecision:true}],
        closed:task.reviewOf?[{id:'F1',repairAttemptId:current.tasks.game!.attemptId,sources:[{...sourceVersion,quote}],observed:'Current saved source matches retained decision and actual host checks; controlled semantic judgement'}]:[],
        observations:task.previewIssues!.map(id=>({id,disposition:'finding',findingIds:['F1'],reason:'Controlled inspection of actual fixture source against confirmed options'})),limitations:['Controlled provider report; does not prove model competence or game quality']}
      await mkdir(join(root,'reviews'),{recursive:true});await writeFile(join(root,task.reviewReport),JSON.stringify(report))
    }
    await turn.onMessage({type:'result',subtype:'success',result:'Controlled synthetic runner ended; actual host checks determine status'})
  }}
}}})
console.log(JSON.stringify({ready:true,origin:server.url.origin,debugUrl:server.url.origin+'/debug/workflow-v3',projectId,fixtureRoot:root,runInitialized:false,normalAuth:true,realDatabase:true,runner:offline?'actual-native-cli-offline-model':'controlled-no-model',productionServicesChanged:false}))
let stopping=false
const stop=async()=>{if(stopping)return;stopping=true;await Promise.all(cleanups.map(fn=>fn()));server.stop(true);offline?.provider.stop(true);console.log(JSON.stringify({stopped:true,controlledSubmits:calls,decisions,nativeRequests:offline?.requests,retained:true}));process.exit(0)}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop())
