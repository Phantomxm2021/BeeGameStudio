import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkIsCurrent, versionsMatch } from './checks'
import { STATIC_ARTIFACT_CHECK_VERSION, staticArtifactFiles } from './runtime-checks'
import { createZipArchive } from '../session-manager'
import { digest, WorkflowError, type Run, type CheckResult, type FileVersion, type AgentMeasurement } from './state'
import { projectFiles, projectDependencies, sameFiles, changedProjectPaths } from './editable-project'
import { EDITABLE_BUILD_CHECK_VERSION, CHECK_VERSIONS } from './check-versions'
import { artifactDigest } from '../runtime-acceptance'
import { designInputRevision } from '../design-handoff'

export function blockingRegisteredContentChecks(measurement: AgentMeasurement) {
  return measurement.checks.filter(check =>
    ['content-structure','content-layout','content-resources'].includes(check.id) &&
    (check.status === 'failed' || check.status === 'execution-error' ||
      check.id === 'content-structure' && check.status === 'unverified'))
}

export async function selectAgentMeasuredBuild(run: Run, measurementId: string, busy = false,
  purpose: 'delivery' | 'preview' | 'publication' = 'delivery', confirmedMessages?: string[]) {
  if(run.writer || busy)throw new WorkflowError('workspace-busy','Wait for the native writer and owned tools to stop')
  const turn=run.agentTurns?.find(t=>t.measurements?.some(m=>m.id===measurementId))
  const measurement=turn?.measurements?.find(m=>m.id===measurementId)
  const latest=run.agentTurns?.flatMap(t=>t.measurements ?? []).findLast(m=>m.runtimeArtifact===measurement?.runtimeArtifact)
  if(measurement && latest?.id!==measurement.id)
    throw new WorkflowError('measurement-superseded','A newer measurement exists for this artifact; inspect its actual result, including failure or interruption')
  const build=measurement?.checks.find(c=>c.id==='build' && c.version===EDITABLE_BUILD_CHECK_VERSION && c.status==='passed')
  const smoke=measurement?.checks.find(c=>c.id==='runtime-smoke' && c.version===STATIC_ARTIFACT_CHECK_VERSION && c.status==='passed')
  const proof=build?.projectBuild, artifact=smoke?.artifacts?.find(a=>a.path===measurement?.runtimeArtifact)
  // Preview and explicit publication select measured bytes, not the author's
  // turn verdict. A settled failed/interrupted turn may still contain a current
  // build. Editable/static export retains the successful-turn requirement.
  const settled = turn?.status === 'ended' || purpose !== 'delivery' &&
    (turn?.status === 'failed' || turn?.status === 'interrupted')
  const failedChecks = measurement?.checks.filter(check => ['build','runtime-smoke'].includes(check.id) &&
    (check.status === 'failed' || check.status === 'execution-error')) ?? []
  if (measurement?.error || failedChecks.length)
    throw new WorkflowError('measurement-failed','Build/runtime measurement failed: '+
      (measurement?.error ?? failedChecks.map(check => check.id+': '+check.observation).join('; ')))
  if(!turn?.quiescedAt || !settled || !measurement?.finishedAt || measurement.error ||
      !build || !smoke || !proof || !artifact || proof.artifact.sha256!==artifact.sha256 || !smoke.coverage?.files.length)
    throw new WorkflowError('preview-unverified',purpose === 'delivery'
      ? 'Select a completed native turn with actual source-build and runtime-smoke evidence, not an author PASS or incomplete/failed turn'
      : 'Select a settled native turn with completed source-build and runtime-smoke evidence; an active writer, author PASS or failed measurement is insufficient')
  const freshness=await inspectAgentMeasurementInputs(run,measurement,
    purpose === 'publication' ? confirmedMessages : undefined, purpose)
  if(!freshness.current)
    throw new WorkflowError(freshness.code,freshness.reason)
  if (purpose !== 'preview') {
    const invalid = blockingRegisteredContentChecks(measurement)
    if (invalid.length) throw new WorkflowError('content-check-failed',
      'Saved Scene/UI checks need repair before delivery: '+invalid.map(check => check.id+' '+check.status+': '+check.observation).join('; ')+
      '. Inspect the measurement, repair affected sources and measure the new version. Preview remains available for diagnosis.')
  }
  const limitations = purpose==='preview' ? [
    ...('changes' in freshness && freshness.changes.requirements
      ? ['Later chat requirements remain unconfirmed. This Preview inspects unchanged measured bytes, not acceptance of the later request.'] : []),
    ...('unverifiedChecks' in freshness && freshness.unverifiedChecks.length
      ? ['Selected probes remain unverified: '+freshness.unverifiedChecks.join(', ')+'. Diagnostic Preview is not consumption or delivery acceptance.'] : []),
  ] : []
  return {turn,measurement,build,smoke,artifact,limitations}
}

/** Only plain, completed native chat messages can be confirmed as discussion.
 * An explicit change, attachment, missing history or broken revision chain
 * cannot be reclassified to reuse older measurement evidence. */
export function discussionMessagesSinceMeasurement(run: Run, measurement: AgentMeasurement) {
  if (measurement.requirementsRevision === run.requirements.revision) return []
  const result: Array<{requestKey:string;text:string}> = [], visited = new Set<string>()
  let revision = measurement.requirementsRevision
  while (revision !== run.requirements.revision) {
    if (visited.has(revision)) return null
    visited.add(revision)
    const change = run.requirementChanges?.find(item => item.before.revision === revision)
    const turn = run.agentTurns?.find(item => item.requestKey === change?.requestKey)
    if (!change || change.actorId !== run.ownerId || !turn?.quiescedAt || !turn.finishedAt || turn.status !== 'ended' ||
        turn.message?.intent !== 'message' || turn.message.attachmentDigests?.length ||
        turn.message.requirementsRevision !== change.before.revision ||
        turn.requirementsRevision !== change.after.revision)
      return null
    result.push({requestKey:change.requestKey,text:turn.message.text})
    revision = change.after.revision
  }
  return result
}

/** Read current inputs without building, settling the writer or certifying
 * quality. Also usable BEFORE native exit so handoff does not require another
 * model turn. Preview/export still require an ended, quiesced native writer. */
export async function inspectAgentMeasurementInputs(run: Run, measurement: AgentMeasurement, confirmedMessages?: string[],
  purpose: 'delivery' | 'preview' | 'publication' = 'delivery') {
  const fail=(code:string,reason:string)=>({current:false,code,reason})
  const latest=run.agentTurns?.flatMap(t=>t.measurements ?? []).findLast(m=>m.runtimeArtifact===measurement.runtimeArtifact)
  if(latest?.id!==measurement.id)return fail('measurement-superseded','A newer measurement exists for this artifact; inspect its result, not an earlier PASS')
  const build=measurement.checks.find(c=>c.id==='build' && c.version===EDITABLE_BUILD_CHECK_VERSION && c.status==='passed')
  const smoke=measurement.checks.find(c=>c.id==='runtime-smoke' && c.version===STATIC_ARTIFACT_CHECK_VERSION && c.status==='passed')
  const proof=build?.projectBuild,artifact=smoke?.artifacts?.find(a=>a.path===measurement.runtimeArtifact)
  if(!measurement.finishedAt || measurement.error || !build || !smoke || !proof || !artifact ||
      proof.artifact.sha256!==artifact.sha256 || !smoke.coverage?.files.length)
    return fail('preview-unverified','Measurement is incomplete or failed; inspect saved checks. No automatic rebuild or retry.')
  const consumption=measurement.consumption?.checks??[]
  const incomplete=consumption.filter(id=>!measurement.checks.some(c=>c.id===id && c.status==='passed' && c.version===CHECK_VERSIONS[id]))
  const unverifiedChecks=incomplete.filter(id=>measurement.checks.some(c=>c.id===id &&
    c.status==='unverified' && c.version===CHECK_VERSIONS[id]))
  // Diagnostic Preview is not delivery. Current, explicitly unverified probes
  // need not force a renderer change just to inspect a passed build/smoke.
  // Missing, failed, errored or obsolete checks still fail closed.
  const consumptionBlocked=incomplete.length>0 &&
    !(purpose==='preview' && incomplete.length===unverifiedChecks.length)
  const discussion=confirmedMessages?.length ? discussionMessagesSinceMeasurement(run,measurement) : null
  const discussionConfirmed=Boolean(discussion?.length &&
    discussion.length===confirmedMessages?.length && discussion.every((item,index)=>item.requestKey===confirmedMessages?.[index]))
  const requirementsChanged=measurement.requirementsRevision!==run.requirements.revision && !discussionConfirmed
  const sourceSaveChanged=measurement.sourceEditId!==run.sourceEdits?.at(-1)?.attemptId
  // Input reads may fail (permissions, aliases, concurrent filesystem changes).
  // Keep saved evidence inspectable with an explicitly negative freshness;
  // Preview/export still reject it. This does not catch caller auth/writer errors.
  try {
    // Identify the actual stale report instead of forcing source/registry
    // exploration. A missing report is stale too; never strip a receipt footer
    // or ignore edited evidence to make it pass.
    const changedReports=[]
    for(const report of measurement.reports)
      if(!await versionsMatch(run.workspacePath,[report]))changedReports.push(report.path)
    const changedSources=changedProjectPaths(proof.files,await projectFiles(run.workspacePath,artifact.path,proof.excludedReports))
    const designInputsChanged=measurement.designInputRevision !== undefined &&
      measurement.designInputRevision !== designInputRevision(run.workspacePath)
    const designInputsMissing=measurement.designInputRevision === undefined &&
      purpose !== 'preview' && run.creation?.initialDelivery === 'design-led-first-version'
    const dependenciesChanged=proof.dependencySha256!==await projectDependencies(run.workspacePath)
    // Export identity and observed runtime evidence are different facts. A
    // source-only edit must not be described as changed runtime bytes. These
    // comparisons do not accept a new build or rerun/reuse any test.
    const contentChecks=measurement.checks.filter(check =>
      ['content-structure','content-layout','content-resources'].includes(check.id))
    const checkInputs=await Promise.all([build,smoke,...contentChecks,
      ...consumption.flatMap(id=>measurement.checks.filter(c=>c.id===id))].map(async check=>({
      // Source/dependency drift has its own comparison above. It does not
      // change the saved check's inputs or checker version, so do not report
      // the same edit as an additional, unrelated build-check failure.
      id:check.id,savedStatus:check.status,inputsMatch:await checkIsCurrent(run.workspacePath,check,
        check.id==='build'?{editableProject:true}:undefined),
    })))
    const artifactMatches=await artifactDigest(run.workspacePath,artifact.path,true).then(hash=>hash===artifact.sha256,()=>false)
    const buildOrArtifactChanged=!artifactMatches || checkInputs.some(check=>!check.inputsMatch)
    const changes={requirements:requirementsChanged,authorizedSourceSave:sourceSaveChanged,
      sources:changedSources,reports:changedReports,dependencies:dependenciesChanged,designInputs:designInputsChanged,buildOrArtifact:buildOrArtifactChanged,
      artifact:!artifactMatches,checkInputs:checkInputs.filter(check=>!check.inputsMatch).map(check=>check.id)}
    // A new requirement must not hide concurrent source/report changes. Return
    // the whole deterministic comparison once, rather than forcing mtime guesses
    // and another request for each successive stale cause. No build is executed.
    // A settled plain message can be confirmed for publication, but the host
    // cannot decide from its text whether it changed the goal. Keep the gate
    // closed while distinguishing that decision from an actual input change.
    const pendingDiscussion=requirementsChanged && discussionMessagesSinceMeasurement(run,measurement)?.length &&
      !sourceSaveChanged && !changedReports.length && !changedSources.length && !dependenciesChanged &&
      !buildOrArtifactChanged && !designInputsChanged
    const previewDiscussion=purpose==='preview' && pendingDiscussion
    const reasons=[
      ...(designInputsChanged?['Design inputs changed since this measurement; inspect and revalidate affected evidence for the current version.']:[]),
      ...(designInputsMissing?['This historical measurement did not record design input identity; design freshness is unverified. Current inputs cannot be backfilled into old evidence.']:[]),
      ...(changedReports.length?['Reports changed or are missing: '+changedReports.join(', ')+'. Finalize evidence before measuring; the receipt is already saved in BGS, not in these files.']:[]),
      ...(pendingDiscussion && !previewDiscussion?['Source/build/report inputs are unchanged after a settled chat message. Confirm that it did not change the game before publication; a question alone does not require a rebuild. If it changed requirements, remeasure affected results.']:[]),
      ...(!pendingDiscussion && (requirementsChanged || sourceSaveChanged)?['Requirements or an authorized source save changed; remeasure affected results']:[]),
      ...(changedSources.length?['Exportable sources changed: '+changedSources.join(', ')]:[]),
      ...(dependenciesChanged?['Installed dependencies changed']:[]),
      ...(!artifactMatches?['Measured artifact bytes changed or are unreadable']:[]),
      ...(changes.checkInputs.length?['Saved check inputs or checker versions differ: '+changes.checkInputs.join(', ')]:[]),
      ...(consumptionBlocked?['Requested consumption checks have not passed: '+incomplete.join(', ')+'. Build/smoke observations remain separate from consumption evidence. Inspect actual failures and coverage; an unsupported probe does not mandate a renderer change or automatic retry.']:[]),
    ]
    const inputChanges=sourceSaveChanged || changedReports.length || changedSources.length || dependenciesChanged || buildOrArtifactChanged || designInputsChanged
    const code=!reasons.length ? 'current'
      : designInputsMissing && !inputChanges && (!requirementsChanged || pendingDiscussion) ? 'design-inputs-unverified'
      : consumptionBlocked && !inputChanges && (!requirementsChanged || pendingDiscussion) ? 'preview-unverified'
      : pendingDiscussion && !previewDiscussion ? 'discussion-confirmation-required' : 'measurement-stale'
    return {current:!reasons.length,code,changes,
      unverifiedChecks,
      evidence:{artifactMatches,designInputsMatch:measurement.designInputRevision === undefined ? null : !designInputsChanged,exportableSourcesMatch:!changedSources.length&&!dependenciesChanged,checks:checkInputs,
        scope:'Saved input identity only; matching checks describe the recorded artifact and conditions, not current source-to-build correspondence, new requirements, a new execution or game quality. Changed sources still require a verified build before export.'},
      reason:reasons.length?reasons.join('; '):previewDiscussion
        ? 'Unchanged measured build is available for diagnostic Preview only; later chat requirements remain unconfirmed. No new requirement or delivery acceptance.'
        : unverifiedChecks.length
          ? 'Build/source/report inputs are current for diagnostic Preview; selected probes remain unverified: '+unverifiedChecks.join(', ')+'. No consumption or delivery acceptance.'
          : 'Source/build/report inputs match now; this is not game-quality acceptance or permission to ignore later edits.'}
  } catch(error) {
    return fail('measurement-inspection-failed','Current inputs could not be inspected; saved checks are historical, not current acceptance: '+
      (error instanceof Error?error.message:String(error)))
  }
}
export async function measuredFiles(run: Run, selected: {artifact: FileVersion; smoke: CheckResult}) {
  const files = new Map<string, string>()
  for (const path of await staticArtifactFiles(run.workspacePath, selected.artifact.path)) {
    const relative = path.slice(selected.artifact.path.length + 1)
    if (relative.split('/').some(part => part.startsWith('.')))
      throw new WorkflowError('preview-private-file', 'Static artifact contains a private dot path; exclude it from the build')
    const recorded = selected.smoke.inputs.find(file => file.path === path)
    if (!recorded || !selected.smoke.coverage!.files.includes(path))
      throw new WorkflowError('preview-unverified', 'Static file is outside measured coverage: '+path)
    files.set(relative, recorded.sha256)
  }
  return files
}
export async function exportAgentMeasuredBuild(run:Run,measurementId:string,
  guard:{read():Promise<Run|undefined>;busy(run:Run):boolean},kind:'static'|'project'='static') {
  const selected=await selectAgentMeasuredBuild(run,measurementId,guard.busy(run))
  return exportSelection(run,selected,selected.build.projectBuild,selected.build.projectBuild!.excludedReports,
    {attemptId:selected.turn.attemptId,measurementId,requirementsRevision:selected.measurement.requirementsRevision,
      reports:selected.measurement.reports,...(selected.measurement.consumption?{
        consumption:selected.measurement.consumption,consumptionChecks:selected.measurement.checks.filter(c=>
          selected.measurement.consumption!.checks.some(id=>id===c.id)).map(({inputs:_inputs,...check})=>check)}: {})},
    guard,kind,()=>selectAgentMeasuredBuild(run,measurementId,guard.busy(run)),true)
}
async function exportSelection(run:Run,selected:{smoke:CheckResult;artifact:FileVersion},proof:CheckResult['projectBuild'],
  reports:string[],identity:{attemptId:string;measurementId?:string;requirementsRevision?:string;reports?:FileVersion[];
    consumption?:AgentMeasurement['consumption'];consumptionChecks?:Array<Omit<CheckResult,'inputs'>>},
  guard:{read():Promise<Run|undefined>;busy(run:Run):boolean},kind:'static'|'project',validate:()=>Promise<unknown>,editable:boolean) {
  const files = await measuredFiles(run, selected), entries = []
  const verifySources = async () => {
    if(!editable || proof?.version!==EDITABLE_BUILD_CHECK_VERSION ||
      proof.artifact.path!==selected.artifact.path || proof.artifact.sha256!==selected.artifact.sha256 || !proof.files.length)
      throw new WorkflowError('project-unverified','This measured build has no actual editable source-copy build evidence. Submit an authorized editableProject build/runtime-smoke task; download never rebuilds or upgrades old evidence.')
    if(!sameFiles(proof.files,await projectFiles(run.workspacePath,selected.artifact.path,reports)) ||
      proof.dependencySha256!==await projectDependencies(run.workspacePath))
      throw new WorkflowError('project-source-changed','Exportable source/dependencies changed since the measured build. Rebuild and remeasure the affected version; no automatic retry.')
  }
  if(kind==='project') {
    await verifySources()
    for(const file of proof!.files) {
      const target=resolve(run.workspacePath,file.path)
      if(await realpath(target)!==target)throw new WorkflowError('export-stale','Source became an alias: '+file.path)
      const data=await readFile(target)
      if(digest(data)!==file.sha256)throw new WorkflowError('export-stale','Source changed: '+file.path)
      entries.push({path:'project/'+file.path,data})
    }
  }
  for (const [path, sha256] of files) {
    const target = resolve(run.workspacePath, selected.artifact.path, path)
    if (await realpath(target) !== target) throw new WorkflowError('export-stale', 'Measured file became an alias: '+path)
    const data = await readFile(target)
    if (digest(data) !== sha256) throw new WorkflowError('export-stale', 'Measured file changed: '+path)
    entries.push({ path: (kind==='project'?'project/'+selected.artifact.path+'/':'build/')+path, data })
  }
  // Catch changed/added/removed files and upstream changes during collection.
  await validate()
  if(kind==='project')await verifySources()
  const after = await guard.read()
  if (!after || after.id !== run.id || after.workspacePath !== run.workspacePath || after.version !== run.version || after.writer || guard.busy(after))
    throw new WorkflowError('export-stale', 'Workflow changed during export; refresh. No partial package was returned.')
  const receipt = { protocol: kind==='project'?'bgs.measured-project-export.1':'bgs.measured-static-export.1', runId: run.id, ...identity,
    artifact: selected.artifact, files: entries.map(e=>({path:e.path,sha256:digest(e.data)})),
    check: selected.smoke, deliveryEligible: false,
    ...(kind==='project'?{sourceBuild:{version:proof!.version,runtime:proof!.runtime,dependencySha256:proof!.dependencySha256},
      instructions:['Open project/ as the editable project root. Use its package.json scripts and saved lockfile to install dependencies/build in a compatible Bun environment.',
        'To play the included tested version, serve project/'+selected.artifact.path+'/ as the HTTP root. Rebuilding or editing creates a new, unmeasured version.']} : {}),
    limitations: [kind==='project'?'Exact exportable source bytes actually built plus the same measured static output. Private dot config, host state, saved Review reports and installed node_modules are excluded. Fresh dependency installation, bit-reproducible rebuild, OS/network isolation and full game quality are not certified.':'Only the measured static build, not an editable source project or full game acceptance. Serve build/ as the HTTP root; file:// may not load modules/resources.', ...(selected.smoke.coverage?.limitations ?? [])] }
  // Receipt omits workflow input/requirement metadata, host state and tokens;
  // explicit project source paths are already listed with their archived bytes.
  const { inputs: _inputs, ...publicCheck } = selected.smoke
  entries.push({ path: 'measurement.json', data: Buffer.from(JSON.stringify({ ...receipt, check: publicCheck }, null, 2)) })
  // Existing ZIP32 writer: fail explicitly rather than silently wrapping fields.
  if (entries.length > 65535 || entries.some(f => Buffer.byteLength(f.path) > 65535) ||
      entries.reduce((n, f) => n + f.data.length + Buffer.byteLength(f.path)*2 + 76, 22) >= 0xffffffff)
    throw new WorkflowError('export-too-large', 'This package exceeds ZIP32 support; no truncated archive returned', 400)
  return { data: createZipArchive(entries), artifact: selected.artifact, filename: (kind==='project'?'project-':'measured-')+(identity.measurementId ?? identity.attemptId)+'.zip', kind }
}
