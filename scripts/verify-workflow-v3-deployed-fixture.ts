import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadEnvFile } from './beegame-migration-cli'
import { createRemoteWorkflowStore } from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type TaskSpec } from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { bindInputs, runChecks } from '../packages/agent-workflow-server/src/beegame/workflow-v3/checks'
import { uiLayoutFixture, sceneLayoutFixture } from '../packages/agent-workflow-server/src/beegame/fixtures/layout-fixture'

// Explicit synthetic test data, never a repair of generated game artifacts.
// Initialize runs actual host checks, not a fabricated provider/Review PASS.
const args=process.argv.slice(2)
if(args.length!==5||!['--provision','--initialize'].includes(args[0]!)||args[1]!=='--env-file'||args[3]!=='--project')
  throw Error('Usage: bun scripts/verify-workflow-v3-deployed-fixture.ts --provision|--initialize --env-file PATH --project ID')
loadEnvFile(args[2]!)
const url=process.env.BEEGAME_SUPABASE_URL!,key=process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY!
if(!url||!key)throw Error('Host database configuration missing')
const rest=async(path:string,init:RequestInit={})=>{
  const response=await fetch(url+'/rest/v1/'+path,{...init,headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw Error('Fixture database operation failed (HTTP '+response.status+')')
  return response.status===204?undefined:response.json()
}
const project=(await rest('beegame_projects?select=id,owner_id,workspace_id,root_path&id=eq.'+encodeURIComponent(args[4]!)))[0]
if(!project)throw Error('Owned source project not found')
if(args[0]==='--provision'){
  if(!process.env.AGENT_WORKFLOW_WORKSPACE_PATH)throw Error('Configured Projects root is required; no out-of-root fixture')
  const projectsRoot=await realpath(process.env.AGENT_WORKFLOW_WORKSPACE_PATH)
  const root=await realpath(await mkdtemp(join(projectsRoot,'bgs-v3-deployed-synthetic-'))),id='v3-deployed-fixture-'+randomUUID()
  for(const dir of ['content/ui','content/scenes','src'])await mkdir(join(root,dir),{recursive:true})
  const ui:any=uiLayoutFixture();ui.data.nodes[1].text='READY';ui.data.nodes[1].style={background:'#21b38a',color:'#ffffff'}
  await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(ui))
  await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
  await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'synthetic-deployed',dimension:'2d',documentRevision:'a'.repeat(64),
    assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',files:['ui/menu.json','scenes/level.json'],documents:[
      {path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},{path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'bun run build.mjs'}}))
  await writeFile(join(root,'build.mjs'),"import {cp,mkdir} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('src/index.html','dist/index.html');await cp('content','dist/content',{recursive:true});")
  await writeFile(join(root,'src/index.html'),`<!doctype html><html><meta charset="utf-8"><title>V3 Synthetic Fixture</title><body style="background:#101e2a;color:white;font:24px sans-serif"><h1>V3 Synthetic Fixture</h1><p>Actual saved UI and Scene fixture, not game acceptance</p><button id="play">Loading</button><output id="result"></output><script>fetch('/content/ui/menu.json').then(r=>r.json()).then(d=>{const n=d.data.nodes.find(n=>n.id==='play'),b=document.querySelector('#play');b.textContent=n.text;b.style.width=n.layout.size[0]+'px';b.style.height=n.layout.size[1]+'px';b.style.background='#21b38a';b.onclick=()=>document.querySelector('#result').textContent='Clicked';document.body.dataset.height=n.layout.size[1];});fetch('/content/scenes/level.json').then(r=>r.json()).then(d=>{document.body.dataset.sceneX=d.data.nodes.find(n=>n.id==='board').transform.position[0];});</script></body></html>`)
  await writeFile(join(root,'notes.json'),'{"purpose":"independent synthetic branch"}')
  await rest('beegame_projects',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id,owner_id:project.owner_id,workspace_id:project.workspace_id,root_path:root,name:'V3 Synthetic Edit/Change Acceptance'})})
  console.log(JSON.stringify({projectId:id,root,synthetic:true,modelInvocations:0,next:'Open in normal Dashboard to create the real user Chat binding; then initialize once.'}))
}else{
  if(!project.id.startsWith('v3-deployed-fixture-')||!project.root_path.includes('/bgs-v3-deployed-synthetic-'))throw Error('Only this explicitly synthetic fixture may be initialized')
  const sessions=await rest('beegame_sessions?select=id&project_id=eq.'+project.id+'&owner_id=eq.'+project.owner_id+'&order=created_at.desc&limit=1')
  if(!sessions.length)throw Error('Open fixture via normal Dashboard first; real user Chat binding missing')
  const store=createRemoteWorkflowStore({url,serviceKey:key})
  const prior=await store.read(project.id,project.owner_id)
  if(prior && !(prior.attempts.length===1 && prior.attempts[0]?.workerId==='synthetic-host-checks' &&
    prior.attempts[0].checks?.some(c=>c.id==='content-schema'&&c.status==='unverified') && !prior.requirementChanges?.length))
    throw Error('Already initialized; preserve current fixture, no overwrite')
  let run=prior??createRun({projectId:project.id,ownerId:project.owner_id,workspacePath:project.root_path,chatSessionId:sessions[0].id,requestKey:'synthetic-initialize',
    text:'独立合成闭环验收：页面标题 V3 Synthetic Fixture；实际消费 content/ui/menu.json 和 content/scenes/level.json。保留已保存的 UI/Scene 候选，不重新生成内容或引入依赖。不是游戏品质验收。',constraints:{},ids:['req.fixture']})
  if(!prior)await store.commit(project.id,project.owner_id,0,run,'synthetic.run-created')
  const tasks:TaskSpec[]=[{id:'game',kind:'game.develop',goal:'合成维护任务：读取当前需求和 src/index.html、UI/Scene JSON；仅在需求确实要求时调整 src/index.html 标题，完整保留候选 JSON（包括用户编辑的高度）与构建脚本，不生成新资源或依赖。完成后宿主重新构建与测量。',dependsOn:[],requirementIds:['req.fixture'],
    inputs:['src/index.html','content/ui/menu.json','content/scenes/level.json'],writablePaths:['src/index.html','content/ui/menu.json','content/scenes/level.json','dist/**'],
    expectedOutputs:['src/index.html','content/ui/menu.json','content/scenes/level.json','dist/index.html'],checks:['build','runtime-smoke'],runtimeArtifact:'dist',editableProject:true},
    {id:'independent',kind:'game.develop',goal:'保留独立合成记录',dependsOn:[],requirementIds:['req.fixture'],inputs:['notes.json'],writablePaths:['notes.json'],expectedOutputs:['notes.json'],checks:['artifact-json']}]
  let next=publishPlan(run,{protocol:V3_PROTOCOL,baseRevision:run.planRevision,requirementsRevision:run.requirements.revision,tasks});await store.commit(project.id,project.owner_id,run.version,next,'synthetic.plan');run=next
  for(const spec of tasks){
    const claimed=claimTask(run,{taskId:spec.id,requestKey:randomUUID(),workerId:'synthetic-host-checks',sessionId:'synthetic-baseline-no-provider',inputVersions:await bindInputs(run,spec)})
    await store.commit(project.id,project.owner_id,run.version,claimed,'synthetic.check-claimed')
    const attempt=claimed.attempts.at(-1)!,result=await runChecks(project.root_path,spec,attempt.inputVersions,undefined,{}, {run:claimed,attempt})
    next=finishTask(claimed,attempt.attemptId,attempt.fence,result,true);await store.commit(project.id,project.owner_id,claimed.version,next,'synthetic.check-settled');run=next
    if(run.tasks[spec.id]!.status!=='succeeded')throw Error('Actual baseline checks failed; inspect persisted evidence, do not overwrite')
  }
  console.log(JSON.stringify({projectId:project.id,root:project.root_path,version:run.version,planRevision:run.planRevision,requirementsRevision:run.requirements.revision,
    chatSessionId:run.chatSessionId,measuredAttempt:run.tasks.game!.attemptId,synthetic:true,modelInvocations:0,deliveryEligible:false,checks:run.attempts.flatMap(a=>a.checks?.map(c=>({id:c.id,status:c.status,version:c.version}))??[])},null,2))
}
