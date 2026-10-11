import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { buildEditableProject, projectFiles, projectDependencies, sameFiles, AGENT_EVIDENCE_DIRECTORY } from './editable-project'
import { runArtifactCheck } from './runtime-checks'
import { readVersion, versionsMatch } from './checks'
import { projectPathSchema, WorkflowError, type AgentTurn, type Run, type AgentMeasurement } from './state'
import type { WorkflowStore } from './store'
import { inspectAgentMeasurementInputs } from './measured-build'
import { reviewSourceSnapshot } from '../design-source-reading'

export const measurementRequest = z.object({
  requestKey: z.string().trim().min(1),
  runtimeArtifact: projectPathSchema.refine(path => !path.split('/').some(p => p.startsWith('.') || ['node_modules','transcripts'].includes(p)) &&
    path!==AGENT_EVIDENCE_DIRECTORY && !path.startsWith(AGENT_EVIDENCE_DIRECTORY+'/'), 'Use a public build directory outside reserved reports/ evidence and host/private metadata'),
  reportPaths: z.array(projectPathSchema).default([]),
}).strict()
export type MeasurementRequest = z.infer<typeof measurementRequest>

/** Explicit optional static-Web measurement inside the existing native writer.
 * No Task, plan, model round or game-quality decision is created. A durable
 * request is recorded BEFORE executing scripts; unknown outcomes never replay. */
export function createAgentMeasurement(input: { run: Run; turn: AgentTurn; store: WorkflowStore }) {
  const controller = new AbortController()
  let work: Promise<AgentMeasurement> | undefined
  const sameWriter = (run: Run) => run.id === input.run.id && run.workspacePath === input.run.workspacePath &&
    run.writer?.attemptId === input.turn.attemptId && run.writer.fence === input.turn.fence && run.writer.workerId === input.turn.workerId
  async function current() {
    const run = await input.store.read(input.run.projectId, input.run.ownerId)
    if (!run || !sameWriter(run)) throw new WorkflowError('stale-attempt','Measurement no longer belongs to the active native writer')
    return run
  }
  async function save(record: AgentMeasurement, starting: boolean) {
    // CAS retries persist facts only, never repeat build or browser work.
    for(let i=0;i<2;i++) {
      const run=await current()
      if(starting && (controller.signal.aborted || run.paused)) throw new WorkflowError('run-paused','Measurement capability is closed or paused')
      const next=structuredClone(run), turn=next.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)!
      turn.measurements ??= []
      if(starting) {
        if(turn.measurements.some(m=>m.requestKey===record.requestKey)) throw new WorkflowError('measurement-conflict','Request was already reserved; inspect its result')
        turn.measurements.push(record)
      } else {
        const index=turn.measurements.findIndex(m=>m.id===record.id)
        if(index<0)throw new WorkflowError('measurement-conflict','Measurement reservation is missing')
        turn.measurements[index]=record
      }
      next.version++
      try {await input.store.commit(run.projectId,run.ownerId,run.version,next,starting?'agent.measurement-started':'agent.measurement-ended');return}
      catch(error){if(!(error instanceof WorkflowError)||error.code!=='revision-conflict'||i===1)throw error}
    }
  }
  async function execute(request: MeasurementRequest) {
    const run=await current(), prior=run.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)?.measurements?.find(m=>m.requestKey===request.requestKey)
    if(prior) {
      if(prior.runtimeArtifact!==request.runtimeArtifact || JSON.stringify(prior.reportPaths)!==JSON.stringify(request.reportPaths))
        throw new WorkflowError('measurement-conflict','Request identity belongs to different inputs. Use measure.mjs --inspect <request-id> to read its saved result/current freshness; do not vary report arguments or create a new request just to read evidence.')
      return prior
    }
    const record: AgentMeasurement={id:randomUUID(),...request,requirementsRevision:run.requirements.revision,
      sourceEditId:run.sourceEdits?.at(-1)?.attemptId,
      startedAt:new Date().toISOString(),reports:[],checks:[]}
    await save(record,true)
    const root=run.workspacePath
    try {
      record.reports=await Promise.all(request.reportPaths.map(path=>readVersion(root,path)))
      const requirements={path:'requirement:'+run.requirements.revision,sha256:run.requirements.sha256}
      const build=await buildEditableProject(root,{editableProject:true,runtimeArtifact:request.runtimeArtifact,
        writablePaths:[request.runtimeArtifact+'/**']},[requirements,...record.reports],[AGENT_EVIDENCE_DIRECTORY],controller.signal,true)
      record.checks.push(build)
      if(build.status==='passed' && build.projectBuild) {
        record.checks.push(await runArtifactCheck(root,'runtime-smoke',{runtimeArtifact:request.runtimeArtifact,expectedOutputs:[]},
          [requirements,...record.reports],run.requirements.constraints,controller.signal))
        // The browser measured this output, but a concurrent native/background
        // edit can still sever its source association. Keep the failed fact.
        if(!sameFiles(build.projectBuild.files,await projectFiles(root,request.runtimeArtifact,build.projectBuild.excludedReports)) ||
          build.projectBuild.dependencySha256!==await projectDependencies(root) || !await versionsMatch(root,record.reports))
          throw new WorkflowError('measurement-stale','Source, dependency or report changed during measurement; rebuild/recheck the affected version')
      }
      if(controller.signal.aborted)throw Error('Measurement cancelled; no automatic retry')
    } catch(error) {record.error=error instanceof Error?error.message:'Measurement failed'}
    record.finishedAt=new Date().toISOString()
    await save(record,false)
    return record
  }
  return {
    // Read-only handoff through the existing bound turn bridge. No new Task,
    // review round, source write or measurement execution is created.
    async handoff(paths: string[], details = false) {
      if(controller.signal.aborted)throw new WorkflowError('measurement-closed','Turn capability has expired')
      const run=await current(),turn=run.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)!
      const sources=reviewSourceSnapshot(run.workspacePath,paths,details,details)
      const records=run.agentTurns!.flatMap(t=>(t.measurements??[]).map(record=>({attemptId:t.attemptId,record})))
      const latest=records.at(-1),edit=run.sourceEdits?.at(-1)
      // Include interrupted/failed turns. Never select an older success in
      // place of the newest pending or failed record.
      const measurement=latest ? {freshness:await inspectAgentMeasurementInputs(run,latest.record),
        attemptId:latest.attemptId,...measurementSummary(latest.record,details)} : null
      return {
        scope:'agent-task-evidence-handoff',runId:run.id,version:run.version,measurement,status:run.status,
        blockedReason:run.blockedReason,
        task:{scope:'active-user-turn',attemptId:turn.attemptId,requestKey:turn.requestKey,intent:turn.message?.intent??'goal',
          source:turn.message?'user-message':'requirements',requirementsRevision:turn.requirementsRevision,
          text:turn.message?.text,continuationOf:turn.message?.continuationOf},
        requirements:{revision:run.requirements.revision,sha256:run.requirements.sha256,
          constraints:run.requirements.constraints,ids:run.requirements.ids,
          ...(details?{text:run.requirements.text}:{})},
        sources,
        ...(details?{measurements:records.map(({attemptId,record})=>({attemptId,id:record.id,requestKey:record.requestKey,
          runtimeArtifact:record.runtimeArtifact,finishedAt:record.finishedAt,error:record.error}))}:{}),
        sourceEdit:edit?{attemptId:edit.attemptId,status:edit.status,requirementsRevision:edit.requirementsRevision,
          finishedAt:edit.finishedAt,error:edit.error,sourceEdit:edit.sourceEdit}:undefined,
        deliveryEligible:false,quality:'unverified',
        note:'Original active user turn and current requirements, selected source bytes and saved host measurement facts only; this does not replace a delegated assignment or grant write scope. --details includes requirements and selected source text. No build, test, model, write or acceptance. File selection is not completeness; source hashes are not a lock or semantic verification. Native tests/observations are not auto-collected: include their actual source/report paths. An absent, stale, failed or unfinished measurement remains unverified.',
      }
    },
    async inspect(requestKey: string, details = false) {
      if(controller.signal.aborted)throw new WorkflowError('measurement-closed','Measurement capability has expired')
      const run=await current(),record=run.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)?.measurements?.find(m=>m.requestKey===requestKey)
      if(!record)throw new WorkflowError('measurement-missing','No saved measurement for this request; inspection never creates or reruns one')
      return {freshness:await inspectAgentMeasurementInputs(run,record),...measurementSummary(record,details)}
    },
    measure(raw: unknown) {
      if(controller.signal.aborted)throw new WorkflowError('measurement-closed','Measurement capability has expired')
      if(work)throw new WorkflowError('measurement-busy','A measurement is already running; inspect it rather than replaying')
      const request=measurementRequest.parse(raw)
      work=execute(request).finally(()=>{work=undefined})
      return work
    },
    async close() {controller.abort();await work},
  }
}

// Response is compact; the existing Run retains full file/check evidence. A
// missing smoke, execution error or incomplete durable record is never PASS.
export function measurementSummary(record: AgentMeasurement, details = true) {
  return {id:record.id,requestKey:record.requestKey,requirementsRevision:record.requirementsRevision,
    runtimeArtifact:record.runtimeArtifact,reports:record.reports,finishedAt:record.finishedAt,error:record.error,
    checks:record.checks.map(({id,status,observation,coverage,artifacts})=>({id,status,
      ...(details?{observation,artifacts,limitations:coverage?.limitations}:status!=='passed'?{observation}:{})})),
    sourceExclusions:record.checks.find(c=>c.id==='build')?.projectBuild?.excludedReports,
    deliveryEligible:false,quality:'unverified',note:'Receipt is saved in BGS; reference this ID in the final reply, not in measured source/report files. Only source-copy build and static browser smoke are measured, not report semantics or game quality.'}
}

