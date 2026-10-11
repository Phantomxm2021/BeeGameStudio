import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadEnvFile } from './beegame-migration-cli'
import { createRemoteWorkflowStore } from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import { createRun, publishPlan, claimTask, pauseRun, digest, WorkflowError, V3_PROTOCOL, type Run, type AgentTurn } from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { changeRequirements } from '../packages/agent-workflow-server/src/beegame/workflow-v3/changes'

// Opt-in real database test. New explicitly synthetic project metadata only;
// no existing project/source, billing, account or schema mutation. Keep evidence.
const worker = process.argv[2] === '--worker'
if (worker) {
  const { config, run, expectedVersion, event, startAt } = JSON.parse(await Bun.stdin.text())
  await Bun.sleep(Math.max(0, startAt - Date.now()))
  let databaseError: { status: number; code?: string; message?: string } | undefined
  try {
    await createRemoteWorkflowStore({ ...config, fetchImpl: async (url, init) => {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
      if (!response.ok) {
        const detail = await response.clone().json().catch(()=>({})) as { code?:string; message?:string }
        // SQL error code and known workflow diagnostics only, never SQL detail/keys.
        databaseError={status:response.status,code:detail.code,message:detail.message?.startsWith('workflow_')?detail.message:undefined}
      }
      return response
    } }).commit(run.projectId, run.ownerId, expectedVersion, run, event)
    console.log(JSON.stringify({ pid: process.pid, ok: true }))
  } catch (error) {
    console.log(JSON.stringify({ pid: process.pid, ok: false, code: error instanceof WorkflowError ? error.code : 'worker-error', databaseError }))
  }
} else if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length !== 5 || args[0] !== '--apply' || args[1] !== '--env-file' || args[3] !== '--source-project')
    throw Error('Usage: bun scripts/verify-workflow-v3-database.ts --apply --env-file PATH --source-project OWNED_PROJECT_ID')
  loadEnvFile(args[2]!)
  const config = { url: process.env.BEEGAME_SUPABASE_URL!, serviceKey: process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY! }
  if (!config.url || !config.serviceKey) throw Error('Missing host database configuration')
  const headers = { apikey: config.serviceKey, authorization: 'Bearer '+config.serviceKey, 'content-type': 'application/json' }
  const rest = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(config.url.replace(/\/+$/, '')+'/rest/v1/'+path, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw Error('Acceptance database request failed (HTTP '+response.status+')')
    return response.status === 204 ? undefined : response.json()
  }
  const source = (await rest('beegame_projects?select=owner_id,workspace_id&id=eq.'+encodeURIComponent(args[4]!)))[0]
  if (!source) throw Error('Source project not found; no fixture provisioned')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-v3-remote-db-')))
  const ids = ['cas','writer-a','writer-b','native'].map(label => 'v3-db-'+label+'-'+randomUUID())
  await rest('beegame_projects', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(ids.map((id, i) => ({
    id, owner_id: source.owner_id, workspace_id: source.workspace_id, name: 'Synthetic V3 database acceptance '+i,
    root_path: root,
  }))) })
  console.log(JSON.stringify({ fixtureProjects: ids, fixtureRoot: root, retained: true, modelInvocations: 0 }))
  const store = createRemoteWorkflowStore(config)
  const assertions: string[] = []
  const verify = (condition: unknown, name: string) => { if (!condition) throw Error('FAIL: '+name); assertions.push(name) }
  const race = async (runs: Run[], versions: number[], event: string) => {
    const startAt = Date.now()+500
    const children = runs.map((run, i) => {
      const child = Bun.spawn([process.execPath, import.meta.path, '--worker'], { stdin: new TextEncoder().encode(JSON.stringify({ config, run, expectedVersion: versions[i], event, startAt })), stdout: 'pipe', stderr: 'pipe' })
      return child
    })
    const result = await Promise.all(children.map(async c => {
      const [code, output] = await Promise.all([c.exited, new Response(c.stdout).text()])
      if (code !== 0) throw Error('Acceptance worker exited unsuccessfully')
      return JSON.parse(output) as { pid: number; ok: boolean; code?: string }
    }))
    console.log(JSON.stringify({ race: event, workers: result })); return result
  }
  const original = createRun({ projectId: ids[0]!, ownerId: source.owner_id, workspacePath: root, chatSessionId: 'synthetic-db-chat',
    requestKey: 'synthetic-create', text: 'Synthetic DB concurrency only, not a game', constraints: {}, ids: ['req.fixture'] })
  let result = await race([original, original], [0,0], 'synthetic.run-created')
  verify(new Set(result.map(r=>r.pid)).size === 2, 'independent worker processes')
  verify(result.filter(r=>r.ok).length === 1 && result.some(r=>r.code === 'revision-conflict'), 'concurrent first insert: exactly one winner')
  let current = (await store.read(ids[0]!, source.owner_id))!
  verify(current.version === 1, 'first-insert revision persisted')
  result = await race([pauseRun(current),pauseRun(current)], [1,1], 'synthetic.pause')
  verify(result.filter(r=>r.ok).length === 1 && result.some(r=>r.code === 'revision-conflict'), 'concurrent update: exactly one CAS winner')
  current = (await createRemoteWorkflowStore(config).read(ids[0]!, source.owner_id))!
  const events = await rest('beegame_workflow_v3_events?project_id=eq.'+ids[0]+'&order=revision.asc')
  const mode = (await rest('beegame_projects?select=runtime_snapshot&id=eq.'+ids[0]))[0].runtime_snapshot
  verify(current.version === 2 && !!current.paused && events.length === 2 && events.every((e: any,i:number)=>e.revision === i+1 && e.snapshot.version === i+1), 'Run/event exact revisions survive independent reload')
  verify(mode.workflow_protocol === V3_PROTOCOL && mode.workflow_chat_session_id === original.chatSessionId, 'successful transaction commits project mode alongside Run/event')
  const task = { id: 'owner', kind: 'game.develop' as const, goal: 'Synthetic writer contention, no native work', dependsOn: [], requirementIds: ['req.fixture'],
    inputs: [], writablePaths: ['fixture.json'], expectedOutputs: ['fixture.json'], checks: ['artifact-json' as const] }
  const writers: Run[] = []
  for (const id of ids.slice(1,3)) {
    const run = createRun({ ...original, projectId: id, requestKey: 'synthetic-writer', text: original.requirements.text, constraints: {}, ids: ['req.fixture'] })
    await store.commit(id, source.owner_id, 0, run, 'synthetic.run-created')
    const planned = publishPlan(run, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: run.requirements.revision, tasks: [task] })
    await store.commit(id, source.owner_id, 1, planned, 'synthetic.plan')
    writers.push(claimTask(planned, { taskId: 'owner', requestKey: 'synthetic-claim', workerId: randomUUID(), sessionId: 'synthetic-no-execution', inputVersions: [] }))
  }
  result = await race(writers, [2,2], 'synthetic.writer-claim')
  verify(result.filter(r=>r.ok).length === 1 && result.some(r=>r.code === 'workspace-busy'), 'cross-project same-workspace writer race: exactly one winner')
  for (let i=0;i<2;i++) {
    const persisted = (await store.read(writers[i]!.projectId, source.owner_id))!
    const log = await rest('beegame_workflow_v3_events?project_id=eq.'+persisted.projectId+'&order=revision.asc')
    verify(persisted.version === (result[i]!.ok ? 3 : 2) && log.length === persisted.version && !!persisted.writer === result[i]!.ok,
      result[i]!.ok ? 'writer winner persisted atomically' : 'writer loser has no partial Run/event commit')
    if(result[i]!.ok) {
      // Synthetic claim never launched a process or touched outputs. Explicitly
      // settle as blocked, never forge successful completion or expire a lease.
      const ended=structuredClone(persisted); ended.version++; delete ended.writer
      ended.attempts.at(-1)!.status='blocked';ended.attempts.at(-1)!.error='Synthetic DB-only claim: no work launched';ended.attempts.at(-1)!.finishedAt=new Date().toISOString()
      ended.tasks.owner!.status='blocked';ended.status='blocked'
      await store.commit(ended.projectId, source.owner_id, persisted.version, ended, 'synthetic.no-execution-settled')
    }
  }
  const planned = publishPlan(current, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: current.requirements.revision, tasks: [
    {...task,writablePaths:['src/**','dist/**'],expectedOutputs:['src/index.html','dist/index.html'],checks:['build','runtime-smoke'],runtimeArtifact:'dist',editableProject:true},
  ] })
  await store.commit(planned.projectId, source.owner_id, current.version, planned, 'synthetic.plan')
  const next = changeRequirements(planned, { expectedVersion: planned.version, requirementsRevision: planned.requirements.revision, requestKey: 'synthetic-change',
    requirements: { text: 'Synthetic changed requirements', constraints: {}, ids: ['req.fixture'] }, tasks: Object.values(planned.tasks).map(t=>t.spec) })
  await store.commit(next.projectId, source.owner_id, planned.version, next, 'requirements.changed')
  const reload=(await createRemoteWorkflowStore(config).read(next.projectId, source.owner_id))!
  verify(reload.requirementChanges?.length === 1 && reload.requirements.sha256 === next.requirements.sha256, 'replacement RPC accepts append-only authorized requirement change')
  const forged={...reload,version:reload.version+1,requirementChanges:[]}
  let rejected=false
  try {await store.commit(forged.projectId,source.owner_id,reload.version,forged,'synthetic.history-rewrite')}catch(error){rejected=error instanceof WorkflowError&&error.code==='immutable-source'}
  verify(rejected && (await store.read(reload.projectId,source.owner_id))!.version===reload.version,'database rejects history rewrite without partial update')
  // Current autonomous records use the same RPC, no Task or new schema.
  // These claims NEVER launch a native process; outcomes deliberately remain
  // failed/unknown. This tests persistence, not model or game acceptance.
  const native=createRun({projectId:ids[3]!,ownerId:source.owner_id,workspacePath:root,
    chatSessionId:'synthetic-native-db',requestKey:'native-db',text:JSON.stringify({idea:'Synthetic database concurrency only'}),constraints:{},ids:['goal']})
  native.agentTurns=[]
  result=await race([native,native],[0,0],'synthetic.native-created')
  verify(result.filter(r=>r.ok).length===1 && result.some(r=>r.code==='revision-conflict'),'native first insert has one independent CAS winner')
  let saved=(await store.read(native.projectId,source.owner_id))!
  const claimed=structuredClone(saved);claimed.version++;claimed.fence++
  const turn:AgentTurn={attemptId:randomUUID(),requestKey:'native-db',sessionId:native.chatSessionId,workerId:randomUUID(),
    fence:claimed.fence,status:'running',startedAt:new Date().toISOString(),requirementsRevision:native.requirements.revision}
  claimed.agentTurns!.push(turn);claimed.writer={attemptId:turn.attemptId,workerId:turn.workerId,fence:turn.fence}
  result=await race([claimed,claimed],[saved.version,saved.version],'synthetic.native-claimed')
  verify(result.filter(r=>r.ok).length===1 && result.some(r=>r.code==='revision-conflict'),'native request/writer claim has one independent CAS winner')
  saved=(await store.read(native.projectId,source.owner_id))!
  const measured=structuredClone(saved);measured.version++
  measured.agentTurns![0]!.measurements=[{id:randomUUID(),requestKey:'not-executed',runtimeArtifact:'dist',reportPaths:[],
    requirementsRevision:saved.requirements.revision,startedAt:new Date().toISOString(),reports:[],checks:[]}]
  result=await race([pauseRun(saved),measured],[saved.version,saved.version],'synthetic.native-pause-or-reservation')
  verify(result.filter(r=>r.ok).length===1 && result.some(r=>r.code==='revision-conflict'),'pause and measurement reservation cannot overwrite each other')
  saved=(await store.read(native.projectId,source.owner_id))!
  const merged=structuredClone(saved);merged.version++
  // Persist the losing facts after reloading; never repeat execution.
  merged.paused ??= {at:new Date().toISOString()};merged.agentTurns![0]!.measurements ??= measured.agentTurns![0]!.measurements
  await store.commit(native.projectId,source.owner_id,saved.version,merged,'synthetic.native-facts-rebased')
  saved=(await createRemoteWorkflowStore(config).read(native.projectId,source.owner_id))!
  verify(saved.paused && saved.agentTurns![0]!.measurements?.[0]?.requestKey==='not-executed' &&
    !saved.agentTurns![0]!.measurements?.[0]?.finishedAt,'reload retains pause and unknown measurement without fabricating success')
  const ended=structuredClone(saved);ended.version++;delete ended.writer
  ended.agentTurns![0]!.status='failed';ended.agentTurns![0]!.error='Synthetic DB-only claim: no native process or measurement executed'
  ended.agentTurns![0]!.finishedAt=new Date().toISOString()
  await store.commit(native.projectId,source.owner_id,saved.version,ended,'synthetic.native-no-execution-settled')
  const changed=structuredClone(ended);changed.version++;changed.planRevision++
  const text=JSON.stringify({idea:'Synthetic database concurrency only',authorized_user_changes:[{requestKey:'native-change',text:'Synthetic change'}]})
  changed.requirements={...ended.requirements,revision:randomUUID(),text,sha256:digest(JSON.stringify({text,constraints:ended.requirements.constraints,ids:ended.requirements.ids}))}
  changed.requirementChanges=[{requestKey:'native-change',actorId:source.owner_id,at:new Date().toISOString(),before:ended.requirements,after:changed.requirements}]
  result=await race([changed,changed],[ended.version,ended.version],'requirements.changed')
  verify(result.filter(r=>r.ok).length===1 && result.some(r=>r.code==='revision-conflict'),'native requirement change uses one CAS without Task plan')
  saved=(await createRemoteWorkflowStore(config).read(native.projectId,source.owner_id))!
  const altered=structuredClone(saved);altered.version++;altered.agentTurns![0]!.measurements![0]!.error='rewritten'
  let historyRejected=false
  try{await store.commit(native.projectId,source.owner_id,saved.version,altered,'synthetic.rewrite-ended-turn')}
  catch(error){historyRejected=error instanceof WorkflowError&&error.code==='immutable-exit-evidence'}
  verify(historyRejected && (await store.read(native.projectId,source.owner_id))!.version===saved.version,'remote adapter preserves ended native measurement history')
  const nativeEvents=await rest('beegame_workflow_v3_events?project_id=eq.'+native.projectId+'&order=revision.asc')
  verify(nativeEvents.length===saved.version && nativeEvents.every((e:any,i:number)=>e.revision===i+1 && e.snapshot.version===i+1) &&
    saved.requirementChanges?.length===1 && !saved.plans.length && !saved.attempts.length && !Object.keys(saved.tasks).length && !saved.deliveryEligible,
    'native Run/event revisions and authorized history persist without host Tasks or game acceptance')
  console.log(JSON.stringify({ passed: assertions, fixtureProjects: ids, fixtureRoot: root, retained: true, modelInvocations: 0, deliveryEligible: false,
    limits:['Synthetic database-only records, no native model execution or measurement','Ended history guard is checked through the host store adapter, not a new SQL constraint'] },null,2))
}
