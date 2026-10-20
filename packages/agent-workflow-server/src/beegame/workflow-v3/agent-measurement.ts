import type { DesignFileChanges } from './state'
import { randomUUID } from 'node:crypto'
import { access, readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod/v4'
import { buildEditableProject, projectFiles, projectDependencies, sameFiles, AGENT_EVIDENCE_DIRECTORY } from './editable-project'
import { runArtifactCheck } from './runtime-checks'
import { runContentCheck } from './content-checks'
import { contentIndexSchema, isContentEntryKind } from '../game-content-schema'
import { readVersion, versionsMatch } from './checks'
import { projectPathSchema, taskSchema, isInitialSliceTurn, WorkflowError, type AgentTurn, type Run, type AgentMeasurement, type SkillUse, type CheckResult } from './state'
import { CHECK_VERSIONS } from './check-versions'
import { sameJson, type WorkflowStore } from './store'
import { inspectAgentMeasurementInputs } from './measured-build'
import { reviewSourceSnapshot } from '../design-source-reading'
import { projectNavigationSnapshot } from './project-guide'
import { priorMainSkillLoads } from './context'
import { inspectDesignAcceptance } from '../runtime-acceptance'
import { snapshotDesignRevisionFiles, designRevisionFileDigest, DESIGN_ACCEPTANCE_PATH, readDesignImplementationChecklist, readDesignAcceptanceRequirements } from '../design-handoff'
import { captureDesignBaseline, designBaselineIssue } from './design-baseline'
import { assertManagedWebBoot, installManagedWebBoot, MANAGED_WEB_BOOT_CONTRACT } from './managed-web-boot'

export const AGENT_CONSUMPTION_CHECKS = ['ui-data-consumption','scene-data-consumption','pixel-data-consumption','font-data-consumption','audio-data-consumption'] as const
export const AGENT_CONSUMPTION_SUPPORT = {
  ui:'Selected registered DOM geometry/text-fit plus marked composition visibility/bounds/fonts/control minima for explicit bindingValues scenarios; missing state inputs, private transitions, unmarked nodes and visual style remain unverified',
  scene:'Selected color-only 2D Sprite: stable enabled causality and source-derived pixel polygons under local and parent transforms; other materials, nodes/states and visual quality remain unverified',
  pixel:'Bound static 2D images/Tilemaps in a visible Canvas; not DOM/CSS images, procedural Canvas, dynamic graphics or 3D',
  font:'Bound custom-font plain DOM text, not system fonts, rich text or Canvas',
  audio:'Encoded HTML audio bindings, not WebAudio synthesis, concurrency or listening',
} as const
export const consumptionRequest = taskSchema.pick({uiProbes:true,sceneProbes:true,pixelProbes:true,audioProbes:true}).extend({
  checks:z.array(z.enum(AGENT_CONSUMPTION_CHECKS)).min(1),
}).superRefine((value,ctx)=>{
  if(new Set(value.checks).size!==value.checks.length)ctx.addIssue({code:'custom',message:'Select each consumption check once'})
  for(const [field,checks] of [['uiProbes',['ui-data-consumption','font-data-consumption']],
    ['sceneProbes',['scene-data-consumption']],
    ['pixelProbes',['pixel-data-consumption']],['audioProbes',['audio-data-consumption']]] as const) {
    const selected=checks.some(check=>value.checks.includes(check))
    if(selected!==Boolean(value[field]?.length))ctx.addIssue({code:'custom',path:[field],
      message:field+' must accompany its selected consumption check; unselected probes are not executed'})
  }
})
export const measurementRequest = z.object({
  requestKey: z.string().trim().min(1),
  runtimeArtifact: projectPathSchema.refine(path => !path.split('/').some(p => p.startsWith('.') || ['node_modules','transcripts'].includes(p)) &&
    path!==AGENT_EVIDENCE_DIRECTORY && !path.startsWith(AGENT_EVIDENCE_DIRECTORY+'/'), 'Use a public build directory outside reserved reports/ evidence and host/private metadata'),
  reportPaths: z.array(z.union([projectPathSchema, z.literal(DESIGN_ACCEPTANCE_PATH),
    z.string().regex(/^\.beegame\/tmp\/preview-test-[a-zA-Z0-9_-]+\/execution\.json$/)])).default([]),
  consumption:consumptionRequest.optional(),
}).strict()
export type MeasurementRequest = z.infer<typeof measurementRequest>

/** Use the existing deterministic checkers when a Web project declares BGS
 * content. Missing content is not guessed for older/source-only projects; a
 * present but invalid registry is a concrete failure, not a silent skip. */
export async function registeredContentChecks(root: string, constraints: Record<string, unknown>, required = false): Promise<CheckResult[]> {
  const manifestChecks = async () => await access(resolve(root,'assets/asset-manifest.json')).then(
    async () => [await runContentCheck(root,'content-resources',{expectedOutputs:[]},[],constraints)], () => [])
  let indexVersion
  try { indexVersion = await readVersion(root, 'content/index.json') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [
      ...(required ? [{id:'content-structure' as const,version:CHECK_VERSIONS['content-structure'],status:'failed' as const,inputs:[],
        observation:'Required editable Scene/UI content is missing: content/index.json.',createdAt:new Date().toISOString()}] : []),
      ...await manifestChecks()]
    return [{id:'content-structure',version:CHECK_VERSIONS['content-structure'],status:'unverified',inputs:[],
      observation:'Content registry cannot be read safely: '+String(error),createdAt:new Date().toISOString()},
      ...await manifestChecks()]
  }
  let files: string[]
  try {
    const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8')))
    const entries = index.documents ?? []
    const paths = entries.map(entry => entry.path)
    const valid = entries.length > 0 && new Set(paths).size === paths.length &&
      new Set(entries.map(entry => entry.id)).size === entries.length &&
      new Set(index.files).size === index.files.length &&
      index.files.length === paths.length && index.files.every(path => paths.includes(path)) &&
      entries.some(entry => entry.id === index.entryScene && isContentEntryKind(entry.kind, index.dimension) && entry.loadPhase === 'startup') &&
      entries.every(entry => entry.kind === 'vfx' ||
        /^(scenes|ui)\//.test(entry.path) && entry.path.endsWith('.json') && projectPathSchema.safeParse('content/'+entry.path).success &&
        (entry.path.startsWith('scenes/') ? entry.kind.startsWith('scene-') : entry.kind.startsWith('ui-')))
    if (!valid) throw Error('Content registry paths, IDs, kinds or files disagree')
    if (required && !entries.some(entry => entry.kind === 'ui-screen' || entry.kind === 'ui-hud'))
      throw Error('Required editable UI document is missing from the registry')
    files = entries.filter(entry => entry.kind !== 'vfx').map(entry => 'content/'+entry.path)
    if (!files.length) return [{id:'content-structure',version:CHECK_VERSIONS['content-structure'],status:'unverified',
      inputs:[indexVersion],observation:'No registered Scene/UI documents to check',createdAt:new Date().toISOString()}]
  } catch (error) {
    return [{id:'content-structure',version:CHECK_VERSIONS['content-structure'],status:'failed',inputs:[indexVersion],
      observation:'Invalid content/index.json: '+String(error),createdAt:new Date().toISOString()},
      ...await manifestChecks()]
  }
  const checks: CheckResult[] = []
  for (const id of ['content-structure','content-layout','content-resources'] as const)
    checks.push(await runContentCheck(root,id,{expectedOutputs:files},[indexVersion],constraints))
  return checks
}

// Capability and observed scope are facts, not another execution instruction.
// Expose them through the already-used handoff/inspect, including when the
// Agent has an old receipt or no receipt; help-only discovery was insufficient.
function measurementCheckScope(record?: AgentMeasurement) {
  return {build:'Host measurement scope: runs package.json scripts.build in an isolated source copy using installed dependencies. Source-copy describes the workspace, not a copy-only build requirement; project bundlers are allowed.',runtimeSmoke:'initial static-browser load only',
    consumptionOption:'--consumption-json',availableConsumptionChecks:AGENT_CONSUMPTION_CHECKS,
    consumptionSupport:AGENT_CONSUMPTION_SUPPORT,
    ...(record?.consumption?{consumption:record.consumption.checks}:{}),
    unmeasuredConsumptionChecks:AGENT_CONSUMPTION_CHECKS.filter(id=>!record?.checks.some(check=>check.id===id)),
  }
}

// Literal current authorization, separate from the selected receipt's turn.
// Shared by existing entry points; no inferred plan, domains or write scope.
export function activeUserTask(run:Run,turn:AgentTurn) {
  return {scope:'active-user-turn',attemptId:turn.attemptId,requestKey:turn.requestKey,intent:turn.message?.intent??'goal',
    ...(isInitialSliceTurn(run,turn) ? {deliveryScope:'playable-slice'} : {}),
    source:turn.message?'user-message':'requirements',requirementsRevision:turn.requirementsRevision,
    text:turn.message?.text??run.requirements.text,continuationOf:turn.message?.continuationOf}
}

export function agentSkillFacts(run:Run,turn:AgentTurn,liveUses?:SkillUse[]) {
  return {...priorMainSkillLoads(run,turn.attemptId),currentTurnUses:liveUses??turn.skillUses??[],
    currentTurnEvidence:liveUses!==undefined?'live-native-tool-events':turn.skillUses!==undefined?'saved-native-tool-events':'not-recorded-yet'}
}

/** Explicit optional static-Web measurement inside the existing native writer.
 * No Task, plan, model round or game-quality decision is created. A durable
 * request is recorded BEFORE executing scripts; unknown outcomes never replay. */
export function createAgentMeasurement(input: { run: Run; turn: AgentTurn; store: WorkflowStore; executionContext?: ()=>Record<string, unknown>|undefined;
  skillUses?: ()=>SkillUse[]; onDesignLocked?: () => void }) {
  // Capture once for this user turn, not at compact, context read or finalize.
  let before: Record<string, string | null> | undefined, snapshotError: string | undefined
  try { before = snapshotDesignRevisionFiles(input.run.workspacePath) }
  catch (error) { snapshotError = error instanceof Error ? error.message : String(error) }
  function designFileChanges(): DesignFileChanges {
    const identity = {scope: 'design-revision-files' as const, attemptId: input.turn.attemptId, requestKey: input.turn.requestKey}
    try {
      if (!before) return {...identity, status: 'unverified', files: [], error: snapshotError}
      const after = snapshotDesignRevisionFiles(input.run.workspacePath)
      // A removed index/reference must not hide deletion or editing of an old input.
      for (const path of Object.keys(before)) after[path] = designRevisionFileDigest(input.run.workspacePath, path)
      const files: DesignFileChanges['files'] = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
        .filter(path => (before![path] ?? null) !== (after[path] ?? null))
        .map(path => ({path, change: before![path] == null ? 'added' : after[path] == null ? 'deleted' : 'modified'}))
      return {...identity, status: 'observed', files}
    } catch (error) { return {...identity, status: 'unverified', files: [], error: error instanceof Error ? error.message : String(error)} }
  }
  const controller = new AbortController()
  let work: Promise<AgentMeasurement> | undefined
  const pendingBaselines = new Set<Promise<unknown>>()
  const sameWriter = (run: Run) => run.id === input.run.id && run.workspacePath === input.run.workspacePath &&
    run.writer?.attemptId === input.turn.attemptId && run.writer.fence === input.turn.fence && run.writer.workerId === input.turn.workerId
  async function current() {
    const run = await input.store.read(input.run.projectId, input.run.ownerId)
    if (!run || !sameWriter(run)) throw new WorkflowError('stale-attempt','Measurement no longer belongs to the active native writer')
    return run
  }
  function skillFacts(run:Run) {
    return agentSkillFacts(run,run.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)!,input.skillUses?.())
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
      if(prior.runtimeArtifact!==request.runtimeArtifact || JSON.stringify(prior.reportPaths)!==JSON.stringify(request.reportPaths) ||
          !sameJson(prior.consumption,request.consumption))
        throw new WorkflowError('measurement-conflict','Request identity belongs to different inputs. Use measure.mjs --inspect <request-id> to read its saved result/current freshness; do not vary report arguments or create a new request just to read evidence.')
      return prior
    }
    const record: AgentMeasurement={id:randomUUID(),...request,requirementsRevision:run.requirements.revision,
      sourceEditId:run.sourceEdits?.at(-1)?.attemptId,
      startedAt:new Date().toISOString(),reports:[],checks:[]}
    await save(record,true)
    const root=run.workspacePath
    try {
      const baselineIssue = designBaselineIssue(run)
      if (baselineIssue) throw new WorkflowError('design-baseline-changed', baselineIssue)
      await assertManagedWebBoot(run, true)
      // Refresh before hashing/building: guide maintenance must not stale the
      // just-created receipt when the turn settles without further source edits.
      // Only explicitly selected execution receipts may enter from host
      // metadata; never open arbitrary capabilities/settings or follow aliases.
      for (const path of request.reportPaths.filter(path=>path.startsWith('.beegame/')))
        if (await realpath(resolve(root,path)) !== resolve(await realpath(root),path))
          throw new WorkflowError('report-alias','Execution receipt must not resolve through an alias')
      record.reports=await Promise.all(request.reportPaths.map(path=>readVersion(root,path)))
      if (request.reportPaths.includes(DESIGN_ACCEPTANCE_PATH)) {
        const acceptance = await inspectDesignAcceptance(root,run.creation?.initialDelivery === 'design-led-first-version',run.creation?.editableContent,
          {runId:run.id,requirementsRevision:run.requirements.revision})
        // Reject unsupported PASS claims before building as well as malformed
        // reports. Honest blocked/failed reports remain diagnostic inputs.
        if (acceptance.diagnostic && (acceptance.diagnostic.category === 'report-invalid' ||
            acceptance.declaredStatus === 'passed'))
          throw new WorkflowError(acceptance.diagnostic.category, acceptance.summary)
        for (const evidence of acceptance.evidence)
          if (!record.reports.some(file=>file.path === evidence.path))
            record.reports.push(await readVersion(root,evidence.path))
      }
      const requirements={path:'requirement:'+run.requirements.revision,sha256:run.requirements.sha256}
      const build=await buildEditableProject(root,{editableProject:true,runtimeArtifact:request.runtimeArtifact,
        writablePaths:[request.runtimeArtifact+'/**']},[requirements,...record.reports],[AGENT_EVIDENCE_DIRECTORY],controller.signal)
      record.checks.push(build)
      record.checks.push(...await registeredContentChecks(root,run.requirements.constraints,run.creation?.editableContent))
      if(build.status==='passed' && build.projectBuild) {
        record.checks.push(await runArtifactCheck(root,'runtime-smoke',{runtimeArtifact:request.runtimeArtifact,expectedOutputs:[]},
          [requirements,...record.reports],run.requirements.constraints,controller.signal))
        // Run only explicitly selected existing drivers against this actual
        // build. No synthetic Task, model, source mutation or guessed probe.
        if(record.checks.at(-1)?.status==='passed' && request.consumption)
          for(const id of request.consumption.checks) {
            if(controller.signal.aborted)throw Error('Measurement cancelled; no automatic retry')
            record.checks.push(await runArtifactCheck(root,id,{runtimeArtifact:request.runtimeArtifact,expectedOutputs:[],
              ...request.consumption},[requirements,...record.reports],run.requirements.constraints,controller.signal,'selected'))
          }
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
    designFileChanges,
    async authorizeDesignChange(toolUseID: string) {
      if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability has expired')
      if (work || pendingBaselines.size) throw new WorkflowError('workspace-busy', 'Wait for the current measurement or baseline operation')
      const run = await current()
      if (run.paused) throw new WorkflowError('run-paused', 'Turn writes are paused')
      if (!toolUseID || !run.designBaseline) throw new WorkflowError('design-baseline-missing', 'No locked design is available to revise')
      const next = structuredClone(run)
      delete next.designBaseline
      next.version++; next.deliveryEligible = false
      if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability has expired')
      await input.store.commit(run.projectId,run.ownerId,run.version,next,'agent.design-change-authorized:'+toolUseID)
    },
    lockDesignBaseline() {
      const operation = (async()=>{
      if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability has expired')
      for (let retry = 0; retry < 2; retry++) {
        const run = await current()
        if (run.paused) throw new WorkflowError('run-paused', 'Turn writes are paused')
        const checklist = readDesignImplementationChecklist(run.workspacePath)
        const issue = designBaselineIssue(run)
        if (issue) throw new WorkflowError('design-baseline-changed', issue)
        if (!run.designBaseline || run.creation?.webBoot && !run.webBoot) {
          const next = structuredClone(run)
          next.designBaseline ??= await captureDesignBaseline(run)
          next.webBoot = await installManagedWebBoot(run, controller.signal)
          if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability has expired')
          next.version++
          try { await input.store.commit(run.projectId, run.ownerId, run.version, next, 'agent.design-baseline-locked') }
          catch (error) { if (!retry && error instanceof WorkflowError && error.code === 'revision-conflict') continue; throw error }
        }
        if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability has expired')
        input.onDesignLocked?.()
        const saved = await current(), changed = designBaselineIssue(saved)
        if (changed) throw new WorkflowError('design-baseline-changed', changed)
        await assertManagedWebBoot(saved, true)
        return { valid: true, ...checklist, requirements: readDesignAcceptanceRequirements(run.workspacePath),
          ...(saved.webBoot ? {webBoot:{...MANAGED_WEB_BOOT_CONTRACT,version:saved.webBoot.version,files:saved.webBoot.files,
            scope:'Installed startup wiring only, not proof of gameplay save events or state schema'}} : {}),
          designBaseline: { revision: saved.designBaseline!.revision, capturedAt: saved.designBaseline!.capturedAt,
            scope: 'Implementation constraint, not user approval or game acceptance' } }
      }
      throw new WorkflowError('revision-conflict', 'Design baseline could not be recorded')
      })().finally(()=>pendingBaselines.delete(operation))
      pendingBaselines.add(operation)
      return operation
    },
    async assertActive(write = false) {
      if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability has expired')
      const run = await current()
      if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability has expired')
      if (write && run.paused) throw new WorkflowError('run-paused', 'Turn writes are paused')
      if (write && run.designBaseline) throw new WorkflowError('design-baseline-locked', 'Planning records are locked; finalize cannot replace the implementation baseline')
      return {runId:run.id,requirementsRevision:run.requirements.revision}
    },
    async executionInputs() {
      if (controller.signal.aborted) throw new WorkflowError('measurement-closed', 'Turn capability closed')
      const run = await current()
      return { runId: run.id, attemptId: input.turn.attemptId, requirementsRevision: run.requirements.revision,
        files: await projectFiles(run.workspacePath, '', [AGENT_EVIDENCE_DIRECTORY]),
        dependencySha256: await projectDependencies(run.workspacePath),
        scope: 'Saved public source/build bytes, excluding reports and host metadata. Not proof of what a browser consumed or of test assertions.' }
    },
    async context() {
      if(controller.signal.aborted)throw new WorkflowError('measurement-closed','Turn capability has expired')
      const run=await current()
      const latest=run.agentTurns!.flatMap(t=>t.measurements??[]).at(-1)
      // Input inspection is diagnostic, not permission to block repair. Keep
      // unreadable/unsafe inputs explicitly unverified; writer fencing above
      // still fails closed and is never swallowed here.
      let freshness
      if(latest) {
        try {freshness=await inspectAgentMeasurementInputs(run,latest)}
        catch(error) {freshness={current:false,code:'measurement-inspection-failed',
          reason:error instanceof Error?error.message:String(error)}}
      }
      const turn=run.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)!
      // The actual user message follows startup facts; do not duplicate its
      // body here. Explicit evidence reads retain the literal task for delegates.
      const {text:_userText,...task}=activeUserTask(run,turn)
      return {...(input.executionContext?.()?{executionContext:input.executionContext!()}:{}),task,
        requirementsRevision:run.requirements.revision,
        designBaseline:run.designBaseline?{revision:run.designBaseline.revision,capturedAt:run.designBaseline.capturedAt,locked:true}:null,
        ...(run.creation?.webBoot ? {webBoot:{...MANAGED_WEB_BOOT_CONTRACT,installed:Boolean(run.webBoot)}} : {}),
        project:projectNavigationSnapshot(run.workspacePath),skills:skillFacts(run),
        measurement:latest?{id:latest.id,requestKey:latest.requestKey,runtimeArtifact:latest.runtimeArtifact,requirementsRevision:latest.requirementsRevision,
          freshness,
          checks:latest.checks.map(c=>({id:c.id,status:c.status})),reportPaths:latest.reportPaths}:null,
        // Startup stays unchanged. Availability/omissions travel in the normal
        // read-only handoff/inspection rather than every subsequent request.
        checkScope:{build:'Host measurement scope: runs package.json scripts.build in an isolated source copy using installed dependencies. Source-copy describes the workspace, not a copy-only build requirement; project bundlers are allowed.',runtimeSmoke:'initial static-browser load only',
          ...(latest?.consumption?{consumption:latest.consumption.checks}:{})},
        reportSemantics:'not-verified',quality:'unverified',deliveryEligible:false}
    },
    // Read-only handoff through the existing bound turn bridge. No new Task,
    // review round, source write or measurement execution is created.
    async handoff(paths: string[] = [], details = false) {
      if(controller.signal.aborted)throw new WorkflowError('measurement-closed','Turn capability has expired')
      const run=await current(),turn=run.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)!
      const sources=paths.length ? reviewSourceSnapshot(run.workspacePath,paths,details,details) :
        {scope:'no-sources-requested',valid:true,issues:[],sources:[],note:'No selected source text returned; navigation and freshness may read/hash current inputs. Source coverage and semantics are not verified.'}
      const records=run.agentTurns!.flatMap(t=>(t.measurements??[]).map(record=>({attemptId:t.attemptId,record})))
      const latest=records.at(-1),edit=run.sourceEdits?.at(-1)
      // Include interrupted/failed turns. Never select an older success in
      // place of the newest pending or failed record.
      const measurement=latest ? {freshness:await inspectAgentMeasurementInputs(run,latest.record),
        attemptId:latest.attemptId,...measurementSummary(latest.record,details)} : null
      const acceptance = await inspectDesignAcceptance(run.workspacePath,run.creation?.initialDelivery === 'design-led-first-version',run.creation?.editableContent,
        {runId:run.id,requirementsRevision:run.requirements.revision})
      return {
        ...(input.executionContext?.()?{executionContext:input.executionContext!()}:{}),
        designFileChanges:designFileChanges(),
        scope:'agent-task-evidence-handoff',runId:run.id,version:run.version,measurement,acceptance,status:run.status,
        checkScope:measurementCheckScope(latest?.record),
        // run.blockedReason describes the previous settled turn while this
        // writer is active. Do not present it as the current measurement cause.
        blockedReason:measurement ? (measurement.freshness.current ?
          'Measured inputs are current; game-quality acceptance remains unverified.' :
          measurement.freshness.code+': '+measurement.freshness.reason) :
          'No saved measurement; game-quality acceptance remains unverified.',
        task:activeUserTask(run,turn),
        requirements:{revision:run.requirements.revision,sha256:run.requirements.sha256,
          constraints:run.requirements.constraints,ids:run.requirements.ids,
          ...(details?{text:run.requirements.text}:{})},
        sources,
        project:projectNavigationSnapshot(run.workspacePath),skills:skillFacts(run),
        ...(details?{priorBlockedReason:run.blockedReason,measurements:records.map(({attemptId,record})=>({attemptId,id:record.id,requestKey:record.requestKey,
          runtimeArtifact:record.runtimeArtifact,finishedAt:record.finishedAt,error:record.error}))}:{}),
        sourceEdit:edit?{attemptId:edit.attemptId,status:edit.status,requirementsRevision:edit.requirementsRevision,
          finishedAt:edit.finishedAt,error:edit.error,sourceEdit:edit.sourceEdit}:undefined,
        deliveryEligible:false,quality:'unverified',
        note:'Original active user turn and current requirements, selected source bytes and saved host measurement facts only; this does not replace a delegated assignment or grant write scope. --details includes requirements and selected source text. No build, test, model, write or acceptance. File selection is not completeness; source hashes are not a lock or semantic verification. Native tests/observations are not auto-collected: include their actual source/report paths. An absent, stale, failed or unfinished measurement remains unverified.',
      }
    },
    async inspect(selector: string, details = false) {
      if(controller.signal.aborted)throw new WorkflowError('measurement-closed','Measurement capability has expired')
      const run=await current(),records=run.agentTurns!.flatMap(turn=>(turn.measurements??[]).map(record=>({turn,record})))
      // Measurement IDs are unique. Legacy request keys were turn-local; do
      // not silently select a newer/older PASS when a key has been reused.
      const byId=records.find(item=>item.record.id===selector)
      const matches=byId?[byId]:records.filter(item=>item.record.requestKey===selector)
      if(!matches.length)throw new WorkflowError('measurement-missing','No saved measurement in this Run for this ID or request key; inspection never creates or reruns one')
      if(matches.length!==1)throw new WorkflowError('measurement-ambiguous','Request key exists in multiple turns; inspect the exact measurement ID from the handoff, not a guessed PASS')
      const {turn,record}=matches[0]!
      const {id,...summary}=measurementSummary(record,details)
      return {id,freshness:await inspectAgentMeasurementInputs(run,record),attemptId:turn.attemptId,turnStatus:turn.status,
        ...summary,
        task:activeUserTask(run,run.agentTurns!.find(t=>t.attemptId===input.turn.attemptId)!),
        measurementTask:{attemptId:turn.attemptId,requestKey:turn.requestKey,status:turn.status,requirementsRevision:turn.requirementsRevision},
        skills:skillFacts(run)}
    },
    measure(raw: unknown) {
      if(controller.signal.aborted)throw new WorkflowError('measurement-closed','Measurement capability has expired')
      if(work)throw new WorkflowError('measurement-busy','A measurement is already running; inspect it rather than replaying')
      const consumption=raw && typeof raw==='object' && !Array.isArray(raw) ? (raw as Record<string,unknown>).consumption : undefined
      if(consumption && typeof consumption==='object' && !Array.isArray(consumption) && Object.hasOwn(consumption,'steps'))
        throw new WorkflowError('measurement-input','consumption.steps is not valid: put steps inside the relevant uiProbes item, for example uiProbes:[{document,nodeId,selector,viewport,steps:[{click:"#start"}]}]. No measurement was started.',400)
      const request=measurementRequest.parse(raw)
      work=execute(request).finally(()=>{work=undefined})
      return work
    },
    async close() {controller.abort();await Promise.allSettled([...pendingBaselines]);await work},
  }
}

// Response is compact; the existing Run retains full file/check evidence. A
// missing smoke, execution error or incomplete durable record is never PASS.
function uiObservationFeedback(id:string, observation:string) {
  if(id!=='ui-data-consumption')return undefined
  try {
    const actual=JSON.parse(observation)
    if(!actual || !Array.isArray(actual.probes) || actual.probes.some((p:unknown)=>!p || typeof p!=='object'))return undefined
    const fit=(value:any)=>value?{status:value.status,fragments:value.fragments,overflowCount:value.overflowCount,
      clippedCount:value.clippedCount,pseudo:value.pseudo}:undefined
    const probes=actual.probes.map((p:any)=>({document:p.document,nodeId:p.nodeId,viewport:p.viewport,status:p.status,reason:p.reason,
      conditions:p.conditions,
      ...(p.controlSize?{controlSize:p.controlSize}:{}),
      ...(p.enabled?{enabled:p.enabled}:{}),
      ...(p.composition ? { composition: Object.fromEntries(Object.entries(p.composition).map(([phase, value]: [string, any]) =>
        [phase, value ? { status: value.status, checkedCount: value.checked?.length,
          issues: value.issues?.map((issue: any) => ({ id: issue.id, kind: issue.kind })), unverified: value.unverified } : undefined])) } : {}),
      ...(p.status==='passed'?{}:{
      coordinateDomain:p.coordinateDomain,unobservedProperties:p.unobservedProperties,
      ...(p.textFit?{textFit:{before:fit(p.textFit.before),changed:p.textFit.changed?.map((v:any)=>({property:v.property,actual:fit(v.actual)})),
        restored:fit(p.textFit.restored)}}:{})})}))
    // Project only host-observed facts. No new verdict, geometry recalculation,
    // source modification or truncation of probe identities/reasons.
    return {driver:actual.driver,probes,errors:actual.errors,missingFiles:actual.missingFiles,unsupported:actual.unsupported,
      limitations:actual.limitations}
  }catch{return undefined} // Plain preparation/driver errors remain verbatim.
}
export function measurementSummary(record: AgentMeasurement, details = true) {
  const feedback=record.checks.map(c=>uiObservationFeedback(c.id,c.observation))
  const diagnostics=feedback.flatMap((value,i)=>value?.probes.map((probe:any)=>({checkId:record.checks[i]!.id,...probe}))??[])
  const registered=record.checks.find(c=>c.id==='content-structure')?.coverage?.files ?? []
  const sampled=new Set(record.checks.filter(c=>AGENT_CONSUMPTION_CHECKS.some(id=>id===c.id) && c.status==='passed')
    .flatMap(c=>c.coverage?.files??[]))
  const bindingCheck=record.checks.find(c=>c.id==='content-resources')
  const bindingInventory=bindingCheck?.coverage?.uiNodeBindings
  // Preserve individual host observations and their scope; a layout PASS is
  // never promoted to image use, nor a sampled node to a whole-screen PASS.
  const uiObservations=record.checks.flatMap(check=>{
    if (!['ui-data-consumption','scene-data-consumption','pixel-data-consumption','font-data-consumption','audio-data-consumption'].includes(check.id)) return []
    try {
      const observation=JSON.parse(check.observation)
      if (!Array.isArray(observation?.probes)) return []
      return observation.probes.filter((probe:any)=>probe && typeof probe.document==='string' && typeof probe.nodeId==='string' &&
        ['passed','failed','unverified','execution-error'].includes(probe.status)).map((probe:any)=>({
          document:probe.document,nodeId:probe.nodeId,checkId:check.id,checkStatus:check.status,status:probe.status,
          viewport:probe.viewport,reason:probe.reason,resource:probe.resource,
        }))
    } catch { return [] } // Preparation failures are retained in checks, not observations.
  })
  const sceneNodes=bindingCheck?.coverage?.sceneNodeBindings?.map(node=>({...node,
    observations:uiObservations.filter((probe:any)=>probe.document===node.document && probe.nodeId===node.nodeId)}))
  const uiNodes=bindingInventory?.map(node=>({...node,
    observations:uiObservations.filter((probe:any)=>probe.document===node.document && probe.nodeId===node.nodeId)}))
  const hasUnsuccessfulObservation=(node:{observations:{status:string}[]})=>node.observations.some(probe=>probe.status!=='passed')
  // Native failed-command formatting keeps head/tail, not the middle of large
  // stdout. Keep receipt identity first, then all selected probe diagnostics before bulky scope/geometry;
  // --details still returns exact saved observations, including historical ones.
  return {id:record.id,requestKey:record.requestKey,finishedAt:record.finishedAt,error:record.error,
    checkStatuses:record.checks.map(({id,status})=>({id,status})),
    ...(diagnostics.length?{diagnostics}:{}),requirementsRevision:record.requirementsRevision,
    runtimeArtifact:record.runtimeArtifact,reports:record.reports,
    reportEvidence:'Explicit attachment identities only. Execution receipts describe their recorded boundaries; attachment at build time does not rerun tests or certify coverage/quality.',
    checkScope:measurementCheckScope(record),
    resourceStructureCoverage:bindingCheck?.coverage?.assetContract ?? null,
    sceneBindingCoverage:{sourceCheckStatus:bindingCheck?.status ?? 'unverified',
      nodeCount:sceneNodes?.length ?? null,unobservedNodeCount:sceneNodes?.filter(node=>!node.observations.length).length ?? null,
      nodesScope:details?'all':'issues-only',
      nodes:(details?sceneNodes:sceneNodes?.filter(hasUnsuccessfulObservation)) ?? null,
      limitation:'Empty observations mean no saved node-level runtime evidence, not a working assembly. Component/behavior metadata is declared structure only. 3D/native-engine/XR device behavior, spatial interaction and comfort remain unverified by the current browser probes.'},
    uiBindingCoverage:{sourceCheckStatus:bindingCheck?.status ?? 'unverified',
      nodeCount:uiNodes?.length ?? null,unobservedNodeCount:uiNodes?.filter(node=>!node.observations.length).length ?? null,
      nodesScope:details?'all':'issues-only',
      nodes:(details?uiNodes:uiNodes?.filter(node=>node.issues.length || node.resolution==='invalid' || node.resolution==='unverified' || hasUnsuccessfulObservation(node))) ?? null,
      limitation:'Null means no saved node inventory; an empty observations list means no node-level runtime evidence in this receipt. Layout/text-fit observations do not verify image/frame consumption. No binding does not prove procedural intent. Compare required screens with the design reference; omitted elements and visual fidelity remain unverified.'},
    ...(registered.length?{contentRuntimeEvidence:{registeredDocuments:registered,
      sampledDocuments:registered.filter(path=>sampled.has(path)),unprobedDocuments:registered.filter(path=>!sampled.has(path)),
      limitation:'A passed consumption check samples selected nodes or bindings only; it does not prove all Scene/UI nodes, states or visual quality.'}}:{}),
    checks:record.checks.map((check,i)=>{
      const {id,status,observation,coverage,artifacts}=check
      // These inventories already have dedicated fields above. Keep one copy;
      // compact reads retain failed observations, not every successful binding.
      const {uiNodeBindings,sceneNodeBindings,assetContract,...scope}=coverage ?? {}
      return {id,status,...(coverage?{coverage:check===bindingCheck?scope:coverage}:{}),
        ...(details?{observation,artifacts,limitations:coverage?.limitations}:status!=='passed'?{
          observation:feedback[i]?JSON.stringify(feedback[i]):observation}:{})}
    }),
    sourceExclusions:record.checks.find(c=>c.id==='build')?.projectBuild?.excludedReports,
    packageComposition:record.checks.find(c=>c.id==='build')?.projectBuild?.packageComposition ?? null,
    measuredSourceFiles:record.checks.find(c=>c.id==='build')?.projectBuild?.files.length,
    ...(record.consumption?{consumption:details?record.consumption:{checks:record.consumption.checks}}:{}),
    ...(!details?{detailsHint:'Read this measurement ID with details:true (CLI: --inspect ID --details) for all node bindings and saved observations; no verification is rerun.'}:{}),
    deliveryEligible:false,quality:'unverified',note:record.consumption?
      'Receipt records source-copy build, static smoke and explicitly selected consumption probes only. Reference this ID, not a source/report footer. Probe results do not prove report semantics, complete gameplay or game quality.':
      'Receipt is saved in BGS; reference this ID in the final reply, not in measured source/report files. Only source-copy build and static browser smoke are measured, not report semantics or game quality.'}
}

