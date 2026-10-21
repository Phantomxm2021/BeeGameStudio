import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { loadEnvFile } from './beegame-migration-cli'
import { getSecretEncryptionKey } from '../packages/agent-workflow-server/src/security/secret-crypto'
import { getDashboardDataRoot } from '../packages/agent-workflow-server/src/local-runtime-service'
import { createRemoteWorkflowStore, type WorkflowStore } from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import { createHostExitReceipts } from '../packages/agent-workflow-server/src/beegame/workflow-v3/host-exit-receipt'
import { createAgentGoalExecutor } from '../packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal'
import { createV3Executor } from '../packages/agent-workflow-server/src/beegame/workflow-v3/execution'
import { BeeGameSessionManager } from '../packages/agent-workflow-server/src/beegame/session-manager'
import { createRun, digest, type Run } from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { readContentView } from '../packages/agent-workflow-server/src/beegame/workflow-v3/content-view'
import { uiLayoutFixture, sceneLayoutFixture } from '../packages/agent-workflow-server/src/beegame/fixtures/layout-fixture'

// Explicit retained synthetic fault setup, real RPC + real BGS executors.
// The normal deployed runtime performs recovery through its authenticated
// debug UI afterwards. No model, receipt fabrication, old game edits or retry.
type Scenario = 'source-exit' | 'no-start-exit' | 'before-exit'
type Job = { envFile: string; root: string; scenario: Scenario; run: Run; body?: unknown }
const args = process.argv.slice(2)
const serverRequire=createRequire(new URL('../packages/agent-workflow-server/package.json',import.meta.url))
const {createTLSAwareFetch}=await import(serverRequire.resolve('@bee-game-studio/security-core'))
const initialize = (envFile: string) => {
  loadEnvFile(envFile)
  const url=process.env.BEEGAME_SUPABASE_URL ?? process.env.SUPABASE_URL
  const serviceKey=process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url || !serviceKey || !process.env.AGENT_WORKFLOW_WORKSPACE_PATH || !getSecretEncryptionKey())
    throw Error('Existing migrated database, workspace root and host key required; no fallback or new key')
  return {url,serviceKey,fetchImpl:createTLSAwareFetch()}
}
const remote = (config: ReturnType<typeof initialize>) => createRemoteWorkflowStore({...config,
  fetchImpl:(input,init)=>config.fetchImpl(input,{...init,signal:AbortSignal.timeout(15000)})})
async function worker(job: Job) {
  const config=initialize(job.envFile),root=await realpath(job.root),host=await realpath(getDashboardDataRoot(process.env.AGENT_WORKFLOW_WORKSPACE_PATH))
  if(dirname(root)!==host || !basename(root).startsWith('bgs-v3-host-restart-') || job.run.workspacePath!==root ||
      !job.run.projectId.startsWith('v3-host-restart-') || !['source-exit','no-start-exit','before-exit'].includes(job.scenario))
    throw Error('Only this exact synthetic fixture can execute')
  const base=remote(config)
  const stored=await base.read(job.run.projectId,job.run.ownerId)
  assert.deepEqual(stored,job.run)
  const checkpoint=async(event:string)=>{
    console.log(JSON.stringify({checkpoint:event,pid:process.pid,scenario:job.scenario}))
    for(;;)await Bun.sleep(1000) // Parent kills this exact child; never retries.
  }
  const store:WorkflowStore={read:base.read,async commit(...values){
    if(['writer.quiesced','agent.writer-quiesced'].includes(values[4]))await checkpoint('host-receipt-before-database')
    await base.commit(...values)
    if(job.scenario==='before-exit' && values[4]==='agent.turn-claimed')await checkpoint('before-exit-observation')
    if(job.scenario==='no-start-exit' && values[4]==='agent.turn-claimed')throw Error('Synthetic committed claim response lost')
  }}
  const sessions=new BeeGameSessionManager({async start(){throw Error('NO MODEL PERMITTED in host-restart acceptance')}},
    join(root,'.beegame/synthetic-session-host'),async()=>({}),{},true)
  const exitReceipts=createHostExitReceipts({dataRoot:host,key:getSecretEncryptionKey()})!
  if(job.scenario==='source-exit')await createV3Executor({store,sessions,exitReceipts}).edit(job.run,job.body)
  else await createAgentGoalExecutor({store,sessions,exitReceipts}).start(job.run,{})
  for(;;)await Bun.sleep(1000)
}

if(args.length===1 && args[0]==='--child')await worker(JSON.parse(await Bun.stdin.text()))
else {
  if(args.length!==5 || args[0]!=='--apply' || args[1]!=='--env-file' || args[3]!=='--source-project')
    throw Error('Usage: bun scripts/verify-workflow-v3-host-restart.ts --apply --env-file PATH --source-project OWNED_ID')
  const envFile=args[2]!,config=initialize(envFile),base=remote(config)
  const rest=async(path:string,init:RequestInit={})=>{
    const response=await config.fetchImpl(config.url.replace(/\/+$/,'')+'/rest/v1/'+path,{...init,
      headers:{apikey:config.serviceKey,authorization:'Bearer '+config.serviceKey,'content-type':'application/json',...init.headers},
      signal:AbortSignal.timeout(15000)})
    if(!response.ok)throw Error('Synthetic metadata operation failed (HTTP '+response.status+')')
    return response.status===204?undefined:response.json()
  }
  const source=(await rest('beegame_projects?select=id,owner_id,workspace_id&id=eq.'+encodeURIComponent(args[4]!)))[0]
  if(!source)throw Error('Owned source metadata missing; no fixture provisioned')
  const host=await realpath(getDashboardDataRoot(process.env.AGENT_WORKFLOW_WORKSPACE_PATH)),receipts=createHostExitReceipts({dataRoot:host,key:getSecretEncryptionKey()})!
  const results:unknown[]=[]
  for(const scenario of ['source-exit','no-start-exit','before-exit'] as const) {
    const root=await realpath(await mkdtemp(join(host,'bgs-v3-host-restart-'))),projectId='v3-host-restart-'+randomUUID()
    for(const dir of ['content/ui','content/scenes'])await mkdir(join(root,dir),{recursive:true})
    await writeFile(join(root,'content/ui/menu.json'),JSON.stringify(uiLayoutFixture()))
    await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(sceneLayoutFixture()))
    await writeFile(join(root,'notes.txt'),'Independent synthetic result; retain exactly\n')
    await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'synthetic-host-restart',dimension:'2d',
      documentRevision:'a'.repeat(64),assetManifestRevision:'b'.repeat(64),entryScene:'level',sceneModel:'game-object-v2',
      files:['ui/menu.json','scenes/level.json'],documents:[{path:'ui/menu.json',id:'menu',kind:'ui-screen',loadPhase:'startup'},
        {path:'scenes/level.json',id:'level',kind:'scene-2d',loadPhase:'startup'}]}))
    await rest('beegame_projects',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id:projectId,
      owner_id:source.owner_id,workspace_id:source.workspace_id,root_path:root,name:'Synthetic host restart boundary: '+scenario})})
    const run=createRun({projectId,ownerId:source.owner_id,workspacePath:root,chatSessionId:'beegame_'+randomUUID().replaceAll('-',''),
      requestKey:'synthetic-only-'+scenario,text:JSON.stringify({kind:'confirmed_build_brief',idea:'Synthetic host exit recovery only; no model or game quality acceptance',
        selected_option:{title:scenario},settings:{},document_language:'en',game_user_visible_language:'en',agent_response_language:'en',resource_library_usage:'optional'}),constraints:{},ids:['goal']})
    run.agentTurns=[];await base.commit(projectId,source.owner_id,0,run,'synthetic.run-created')
    const versions=async()=>Promise.all(['content/ui/menu.json','content/scenes/level.json','notes.txt'].map(async path=>({path,sha256:digest(await readFile(join(root,path)))})))
    const before=await versions()
    const view=await readContentView(root)
    if(view.state!=='draft')throw Error('Initial synthetic content not registered')
    const item=view.documents.find(d=>d.path==='ui/menu.json')!
    if(!('document' in item)||!item.document)throw Error('Initial UI missing')
    const document=structuredClone(item.document);(document.data as any).nodes[1].layout.size[1]=64
    const body={requestKey:'synthetic-save',path:'ui/menu.json',expectedRevision:item.revision,document,
      workflow:{version:run.version,planRevision:run.planRevision,requirementsRevision:run.requirements.revision}}
    console.log(JSON.stringify({fixtureCreated:true,scenario,projectId,root,retained:true,modelCalls:0}))
    const child=Bun.spawn([process.execPath,import.meta.path,'--child'],{stdin:'pipe',stdout:'pipe',stderr:'pipe',cwd:process.cwd()})
    child.stdin.write(JSON.stringify({envFile,root,run,scenario,...(scenario==='source-exit'?{body}:{})}));child.stdin.end()
    let output='',error='',reached=false
    const stdout=(async()=>{for await(const bytes of child.stdout){output+=new TextDecoder().decode(bytes);if(output.includes('"checkpoint"'))reached=true}})()
    const stderr=(async()=>{for await(const bytes of child.stderr)error+=new TextDecoder().decode(bytes)})()
    try {
      for(let i=0;i<3000&&!reached&&child.exitCode===null;i++)await Bun.sleep(10)
      if(!reached)throw Error('Synthetic checkpoint absent; retained without retry: '+error.slice(-1000))
      const event=output.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return {}}}).find(e=>e.checkpoint)
      assert.equal(event.pid,child.pid);assert.equal(event.scenario,scenario)
      assert.equal(event.checkpoint,scenario==='before-exit'?'before-exit-observation':'host-receipt-before-database')
      const claimed=(await base.read(projectId,source.owner_id))!,facts=await receipts.read(claimed)
      assert.ok(claimed.writer);assert.equal((claimed.sourceEdits?.at(-1)??claimed.agentTurns!.at(-1))!.quiescedAt,undefined)
      assert.equal(Boolean(facts),scenario!=='before-exit')
      if(scenario==='no-start-exit')assert.equal(facts!.notStarted,true)
      child.kill('SIGKILL');await child.exited;await Promise.all([stdout,stderr])
      const after=await versions()
      assert.deepEqual(after.slice(1),before.slice(1))
      if(scenario==='source-exit')assert.notEqual(after[0]!.sha256,before[0]!.sha256)
      else assert.deepEqual(after,before)
      const saved=await base.read(projectId,source.owner_id)
      assert.deepEqual(saved,claimed) // Kill did not forge database exit proof.
      results.push({scenario,projectId,root,runId:claimed.id,version:claimed.version,writer:claimed.writer,originalPid:child.pid,
        originalHostKilled:true,databaseQuiescence:false,hostReceipt:Boolean(facts),exitFacts:facts,before,after,modelCalls:0,retained:true})
    }finally{if(child.exitCode===null)child.kill('SIGKILL');await child.exited}
  }
  console.log(JSON.stringify({results,modelCalls:0,awaitingNormalDebugRecovery:true,
    limits:['Synthetic fixture initialization; not real game intake or quality.','No native process/model submitted. Actual BGS source-save/no-start cleanup and real remote RPC.','Normal runtime recovery still needs browser confirmation; no automatic release/retry.']},null,2))
}
