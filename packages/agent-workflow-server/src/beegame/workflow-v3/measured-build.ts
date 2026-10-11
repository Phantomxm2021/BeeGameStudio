import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertFreshDependencies, checkIsCurrent, versionsMatch } from './checks'
import { STATIC_ARTIFACT_CHECK_VERSION, staticArtifactFiles } from './runtime-checks'
import { createZipArchive } from '../session-manager'
import { digest, WorkflowError, type Run, type CheckResult, type FileVersion, type AgentMeasurement } from './state'
import { projectFiles, projectDependencies, sameFiles, changedProjectPaths } from './editable-project'
import { EDITABLE_BUILD_CHECK_VERSION } from './check-versions'

/** One source of measurement selection for Preview, feedback and export. */
export async function selectMeasuredBuild(run: Run, taskId: string, attemptId: string, busy = false) {
  if (run.writer || busy) throw new WorkflowError('workspace-busy', 'Wait for the current writer to stop before previewing or exporting')
  const task = run.tasks[taskId], attempt = run.attempts.find(a => a.attemptId === attemptId && a.taskId === taskId)
  const smoke = attempt?.checks?.find(c => c.id === 'runtime-smoke' && c.status === 'passed' && c.version === STATIC_ARTIFACT_CHECK_VERSION)
  const artifact = smoke?.artifacts?.find(a => a.path === task?.spec.runtimeArtifact)
  if (task?.attemptId !== attemptId || task.status !== 'succeeded' || attempt?.status !== 'succeeded' ||
      !task.spec.runtimeArtifact || !artifact || !smoke?.coverage?.files.length)
    throw new WorkflowError('preview-unverified', 'Select the current successful attempt with measured runtime-smoke evidence; a build or author PASS is insufficient')
  await assertFreshDependencies(run, { ...task.spec, dependsOn: [taskId] })
  return { task, attempt, smoke, artifact }
}
export async function selectAgentMeasuredBuild(run: Run, measurementId: string, busy = false) {
  if(run.writer || busy)throw new WorkflowError('workspace-busy','Wait for the native writer and owned tools to stop')
  const turn=run.agentTurns?.find(t=>t.measurements?.some(m=>m.id===measurementId))
  const measurement=turn?.measurements?.find(m=>m.id===measurementId)
  const latest=run.agentTurns?.flatMap(t=>t.measurements ?? []).findLast(m=>m.runtimeArtifact===measurement?.runtimeArtifact)
  if(measurement && latest?.id!==measurement.id)
    throw new WorkflowError('measurement-superseded','A newer measurement exists for this artifact; inspect its actual result, including failure or interruption')
  const build=measurement?.checks.find(c=>c.id==='build' && c.version===EDITABLE_BUILD_CHECK_VERSION && c.status==='passed')
  const smoke=measurement?.checks.find(c=>c.id==='runtime-smoke' && c.version===STATIC_ARTIFACT_CHECK_VERSION && c.status==='passed')
  const proof=build?.projectBuild, artifact=smoke?.artifacts?.find(a=>a.path===measurement?.runtimeArtifact)
  if(!turn?.quiescedAt || turn.status!=='ended' || !measurement?.finishedAt || measurement.error ||
      !build || !smoke || !proof || !artifact || proof.artifact.sha256!==artifact.sha256 || !smoke.coverage?.files.length)
    throw new WorkflowError('preview-unverified','Select a completed native turn with actual source-build and runtime-smoke evidence, not an author PASS or incomplete/failed turn')
  const freshness=await inspectAgentMeasurementInputs(run,measurement)
  if(!freshness.current)
    throw new WorkflowError(freshness.code,freshness.reason)
  return {turn,measurement,build,smoke,artifact}
}

/** Read current inputs without building, settling the writer or certifying
 * quality. Also usable BEFORE native exit so handoff does not require another
 * model turn. Preview/export still require an ended, quiesced native writer. */
export async function inspectAgentMeasurementInputs(run: Run, measurement: AgentMeasurement) {
  const fail=(code:string,reason:string)=>({current:false,code,reason})
  const latest=run.agentTurns?.flatMap(t=>t.measurements ?? []).findLast(m=>m.runtimeArtifact===measurement.runtimeArtifact)
  if(latest?.id!==measurement.id)return fail('measurement-superseded','A newer measurement exists for this artifact; inspect its result, not an earlier PASS')
  const build=measurement.checks.find(c=>c.id==='build' && c.version===EDITABLE_BUILD_CHECK_VERSION && c.status==='passed')
  const smoke=measurement.checks.find(c=>c.id==='runtime-smoke' && c.version===STATIC_ARTIFACT_CHECK_VERSION && c.status==='passed')
  const proof=build?.projectBuild,artifact=smoke?.artifacts?.find(a=>a.path===measurement.runtimeArtifact)
  if(!measurement.finishedAt || measurement.error || !build || !smoke || !proof || !artifact ||
      proof.artifact.sha256!==artifact.sha256 || !smoke.coverage?.files.length)
    return fail('preview-unverified','Measurement is incomplete or failed; inspect saved checks. No automatic rebuild or retry.')
  if(measurement.sourceEditId!==run.sourceEdits?.at(-1)?.attemptId || measurement.requirementsRevision!==run.requirements.revision)
    return fail('measurement-stale','Requirements or an authorized source save changed; remeasure affected results')
  // Identify the actual stale report instead of forcing source/registry
  // exploration. A missing report is stale too; never strip a receipt footer
  // or ignore edited evidence to make it pass.
  const changedReports=[]
  for(const report of measurement.reports)
    if(!await versionsMatch(run.workspacePath,[report]))changedReports.push(report.path)
  if(changedReports.length)return fail('measurement-stale','Reports changed or are missing: '+changedReports.join(', ')+'. Finalize evidence before measuring; the receipt is already saved in BGS, not in these files.')
  if(!await checkIsCurrent(run.workspacePath,build,{editableProject:true}) || !await checkIsCurrent(run.workspacePath,smoke))
    return fail('measurement-stale','Build inputs or measured artifact changed; inspect and remeasure affected results')
  const changedSources=changedProjectPaths(proof.files,await projectFiles(run.workspacePath,artifact.path,proof.excludedReports))
  if(changedSources.length)
    return fail('measurement-stale','Exportable sources changed: '+changedSources.join(', ')+'. Inspect and remeasure affected results')
  if(proof.dependencySha256!==await projectDependencies(run.workspacePath))
    return fail('measurement-stale','Installed dependencies changed; inspect and remeasure affected results')
  return {current:true,code:'current',reason:'Source/build/report inputs match now; this is not game-quality acceptance or permission to ignore later edits.'}
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
export async function exportMeasuredBuild(run: Run, taskId: string, attemptId: string,
  guard: { read(): Promise<Run | undefined>; busy(run: Run): boolean }, kind: 'static' | 'project' = 'static') {
  const selected = await selectMeasuredBuild(run, taskId, attemptId, guard.busy(run))
  const build = selected.attempt.checks?.find(c => c.id==='build' && c.status==='passed' && c.version===EDITABLE_BUILD_CHECK_VERSION)
  const proof = build?.projectBuild
  const reports = [...new Set([...(proof?.excludedReports ?? []), ...run.plans.flatMap(p=>p.plan.tasks.flatMap(t=>t.reviewReport?[t.reviewReport]:[]))])].sort()
  return exportSelection(run,selected,proof,reports,{taskId,attemptId,planRevision:run.planRevision},guard,kind,
    ()=>selectMeasuredBuild(run,taskId,attemptId,guard.busy(run)),Boolean(selected.task.spec.editableProject))
}
export async function exportAgentMeasuredBuild(run:Run,measurementId:string,
  guard:{read():Promise<Run|undefined>;busy(run:Run):boolean},kind:'static'|'project'='static') {
  const selected=await selectAgentMeasuredBuild(run,measurementId,guard.busy(run))
  return exportSelection(run,selected,selected.build.projectBuild,selected.build.projectBuild!.excludedReports,
    {attemptId:selected.turn.attemptId,measurementId,requirementsRevision:selected.measurement.requirementsRevision,
      reports:selected.measurement.reports},guard,kind,()=>selectAgentMeasuredBuild(run,measurementId,guard.busy(run)),true)
}
async function exportSelection(run:Run,selected:{smoke:CheckResult;artifact:FileVersion},proof:CheckResult['projectBuild'],
  reports:string[],identity:{attemptId:string;taskId?:string;planRevision?:number;measurementId?:string;requirementsRevision?:string;reports?:FileVersion[]},
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
