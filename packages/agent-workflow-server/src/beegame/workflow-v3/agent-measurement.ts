import { productionAssignmentFacts } from './production-workflow'
import { isInitialSliceTurn, type AgentTurn, type Run, type AgentMeasurement, type SkillUse, type CheckResult } from './state'
import { priorMainSkillLoads } from './context'

// Assignment facts and historical data readers only. No Agent
// build, browser, measurement, submission or completion capability is exposed.
const AGENT_CONSUMPTION_CHECKS = ['ui-data-consumption','scene-data-consumption','pixel-data-consumption','font-data-consumption','audio-data-consumption'] as const
function measurementCheckScope(record: AgentMeasurement) {
  return {build:'Historical source-copy static-Web build using the saved build command and installed dependencies; not native/server export verification.',runtimeSmoke:'saved initial static-browser load only',
    ...(record.consumption?{consumption:record.consumption.checks}:{}),
  }
}


export type AgentDeliverySubmission = {
  attemptId:string; requirementsRevision:string; reportPath:string; reportSha256:string;
  measurementId?:string; sourceSha256:string; summary:string; status:'passed'|'failed'|'blocked';
}

export function activeUserTask(run:Run,turn:AgentTurn) {
  return {scope:'active-user-turn',attemptId:turn.attemptId,requestKey:turn.requestKey,intent:turn.message?.intent??'goal',
    ...(isInitialSliceTurn(run,turn) ? {deliveryScope:'playable-slice'} : {}),
    ...(turn.production ? {production:productionAssignmentFacts(run,turn.production,turn.attemptId)} : {}),
    source:turn.message?'user-message':'requirements',requirementsRevision:turn.requirementsRevision,
    text:turn.message?.text??run.requirements.text,continuationOf:turn.message?.continuationOf}
}

export function agentSkillFacts(run:Run,turn:AgentTurn,liveUses?:SkillUse[]) {
  const currentTurnUses:SkillUse[]=(liveUses??turn.skillUses??[]).map(use=>{
    if(use.source!=='shell')return use
    // Expose old Shell records as event links too; never rewrite saved history.
    const {status:_legacyReadStatus,...link}=use
    return link
  })
  return {...priorMainSkillLoads(run,turn.attemptId),currentTurnUses,
    currentTurnEvidence:liveUses!==undefined?'live-skill-access-events':turn.skillUses!==undefined?'saved-skill-access-events':'not-recorded-yet',
    nativeInvocations:'not-exposed-by-app-server',
    evidenceLimit:'Shell entries link catalog files to command events; inspect those events for execution status and exit code. Loader receipts and read commands are not native Skill invocation telemetry or proof of effective application. Neither full reading nor context retention is certified. Missing links do not establish no use.'}
}

function uiObservationFeedback(id:string, observation:string, compact = true) {
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
    return {driver:actual.driver,probes,errors:actual.errors,missingFiles:actual.missingFiles,
      // A browser batch can report the same host limitation once per probe.
      // Keep the fact, but do not repeat identical prose in the compact view.
      unsupported:compact ? [...new Set(actual.unsupported ?? [])] : actual.unsupported,
      limitations:actual.limitations}
  }catch{return undefined} // Plain preparation/driver errors remain verbatim.
}
export function measurementSummary(record: AgentMeasurement, details = true) {
  const feedback=record.checks.map(c=>uiObservationFeedback(c.id,c.observation,!details))
  const diagnostics=feedback.flatMap((value,i)=>value?.probes.map((probe:any)=>({checkId:record.checks[i]!.id,...probe}))??[])
  const registered=record.checks.find(c=>c.id==='content-structure')?.coverage?.files ?? []
  const sampled=new Set(record.checks.filter(c=>AGENT_CONSUMPTION_CHECKS.some(id=>id===c.id) && c.status==='passed')
    .flatMap(c=>c.coverage?.files??[]))
  const bindingCheck=record.checks.find(c=>c.id==='content-resources')
  const bindingInventory=bindingCheck?.coverage?.uiNodeBindings
  const assetContract=bindingCheck?.coverage?.assetContract
  // Keep failures and provisional resources fully inspectable in the compact
  // receipt; routine file evidence remains in the saved record and --details.
  // Compact reads expose only resources that need attention. The count keeps
  // the saved evidence's routine-resource scope visible without copying a
  // repetitive inventory; details:true remains the complete source of IDs and
  // file evidence.
  const resourceStructureCoverage=assetContract && !details ? (()=>{
    const routine=assetContract.resources.filter(resource=>resource.status==='verified' && !resource.provisional && !resource.issues.length)
    return {...assetContract,routineVerifiedResourceCount:routine.length,resourcesScope:'issues-only',
      resources:assetContract.resources.filter(resource=>!routine.includes(resource))}
  })() : assetContract
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
    resourceStructureCoverage:resourceStructureCoverage ?? null,
    sceneBindingCoverage:{sourceCheckStatus:bindingCheck?.status ?? 'unverified',
      nodeCount:sceneNodes?.length ?? null,unobservedNodeCount:sceneNodes?.filter(node=>!node.observations.length).length ?? null,
      nodesScope:details?'all':'issues-only',
      nodes:(details?sceneNodes:sceneNodes?.filter(hasUnsuccessfulObservation)) ?? null,
      ...(details ? {limitation:'Empty observations mean no saved node-level runtime evidence, not a working assembly. Component/behavior metadata is declared structure only. 3D/native-engine/XR device behavior, spatial interaction and comfort remain unverified by the current browser probes.'} : {})},
    uiBindingCoverage:{sourceCheckStatus:bindingCheck?.status ?? 'unverified',
      nodeCount:uiNodes?.length ?? null,unobservedNodeCount:uiNodes?.filter(node=>!node.observations.length).length ?? null,
      nodesScope:details?'all':'issues-only',
      nodes:(details?uiNodes:uiNodes?.filter(node=>node.issues.length || node.resolution==='invalid' || node.resolution==='unverified' || hasUnsuccessfulObservation(node))) ?? null,
      ...(details ? {limitation:'Null means no saved node inventory; an empty observations list means no node-level runtime evidence in this receipt. Layout/text-fit observations do not verify image/frame consumption. No binding does not prove procedural intent. Compare required screens with the design reference; omitted elements and visual fidelity remain unverified.'} : {})},
    ...(registered.length?{contentRuntimeEvidence:{registeredDocuments:registered,
      sampledDocuments:registered.filter(path=>sampled.has(path)),unprobedDocuments:registered.filter(path=>!sampled.has(path)),
      limitation:'A passed consumption check samples selected nodes or bindings only; it does not prove all Scene/UI nodes, states or visual quality.'}}:{}),
    checks:record.checks.map((check,i)=>{
      const {id,status,observation,coverage,artifacts}=check
      // These inventories already have dedicated fields above. Keep one copy;
      // compact reads retain failed observations, not every successful binding.
      const compactCoverage=!details && coverage ? {...coverage,limitations:[...new Set(coverage.limitations)]} : coverage
      const {uiNodeBindings,sceneNodeBindings,assetContract,...scope}=compactCoverage ?? {}
      const reportedCoverage: Partial<NonNullable<CheckResult['coverage']>> | undefined = !coverage ? undefined : details
        ? check===bindingCheck?scope:compactCoverage
        : AGENT_CONSUMPTION_CHECKS.some(selected=>selected===id) ? compactCoverage
        : {limitations:[...new Set(coverage.limitations)]}
      return {id,status,coverage:reportedCoverage,
        ...(details?{observation,artifacts,limitations:coverage?.limitations}:status!=='passed'?{
          observation:feedback[i]?JSON.stringify(feedback[i]):observation}:{})}
    }),
    ...(details ? {sourceExclusions:record.checks.find(c=>c.id==='build')?.projectBuild?.excludedReports,
      packageComposition:record.checks.find(c=>c.id==='build')?.projectBuild?.packageComposition ?? null} : {}),
    measuredSourceFiles:record.checks.find(c=>c.id==='build')?.projectBuild?.files.length,
    ...(record.consumption?{consumption:details?record.consumption:{checks:record.consumption.checks}}:{}),
    ...(!details?{detailsHint:'Read this historical measurement with details:true for full resource file evidence, all node bindings and saved observations; no verification is rerun.'}:{}),
    deliveryEligible:false,quality:'unverified',note:record.consumption?
      'Receipt records source-copy build, static smoke and explicitly selected consumption probes only. Do not add its ID to measured source/report files. Probe results do not prove report semantics, complete gameplay or game quality.':
      'Receipt is saved in BGS; do not add its ID to measured source/report files. Only source-copy build and static browser smoke are measured, not report semantics or game quality.'}
}

