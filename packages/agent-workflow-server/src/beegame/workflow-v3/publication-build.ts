import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { projectPathSchema, WorkflowError, type Run } from './state'
import { copyBuildDependencies, prepareBuildCaches, AGENT_SOURCE_EXCLUSIONS } from './editable-project'
import { commandCheck, isProjectSourcePath } from './checks'
import { artifactDigest } from '../runtime-acceptance'
import { runArtifactCheck, staticArtifactFiles } from './runtime-checks'
import { publicationBuildArgs, type PreparedPublication } from '../deployment-manager'

/** Read-only eligibility: old measurement verdicts do not gate a fresh build. */
export async function publicationBuildPlan(run: Run): Promise<{ runtimeArtifact: string }> {
  let manifest: { scripts?: { build?: unknown } }
  try { manifest = JSON.parse(await readFile(join(run.workspacePath, 'package.json'), 'utf8')) }
  catch { throw new WorkflowError('deployment-build-unavailable', 'Publishing requires a saved package.json with a build script') }
  if (typeof manifest.scripts?.build !== 'string' || !manifest.scripts.build.trim())
    throw new WorkflowError('deployment-build-unavailable', 'Publishing requires a package.json build script')
  // Reuse only the historical output location, never its bytes or verdict.
  const declared = run.agentTurns?.flatMap(turn => turn.measurements ?? []).at(-1)?.runtimeArtifact ?? 'dist'
  const parsed = projectPathSchema.refine(path => !path.split('/').some(p => p.startsWith('.') || ['node_modules','transcripts'].includes(p)) && !AGENT_SOURCE_EXCLUSIONS.some(record => path===record || path.startsWith(record+'/'))).safeParse(declared)
  if (!parsed.success) throw new WorkflowError('deployment-build-unavailable', 'The saved build output directory is invalid')
  return { runtimeArtifact: parsed.data }
}

/** Publish a frozen build, not an editable-source export or author acceptance report. */
export async function rebuildPublication(run: Run, plan: { runtimeArtifact: string }, directory: string,
  validateRun: () => Promise<void>): Promise<PreparedPublication> {
  await validateRun()
  const source=await realpath(run.workspacePath), artifact=plan.runtimeArtifact
  const temporary=await mkdtemp(join(tmpdir(),'bgs-publication-build-'))
  try {
    // Preserve links without following them. Unused tools/caches need not satisfy
    // an editable-source contract; the build sandbox still cannot read outside
    // this private copy. Final published files are checked separately below.
    await cp(source,temporary,{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE,
      filter:path=>path===source || isProjectSourcePath(relative(source,path).split('\\').join('/'),artifact,AGENT_SOURCE_EXCLUSIONS)})
    const dependencies=await copyBuildDependencies(source,temporary)
    if(dependencies)await prepareBuildCaches(temporary)
    const manifest=JSON.parse(await readFile(join(temporary,'package.json'),'utf8')) as {scripts?:{build?:string}}
    const observed=await commandCheck(temporary,'build',undefined,dependencies,publicationBuildArgs(manifest.scripts?.build))
    const observation='Host executed the project build in a private sandboxed copy; exit '+observed.code+'\n'+observed.log
    if(observed.code!==0)throw new Error('Publication build failed: '+observation)
    const files=await staticArtifactFiles(temporary,artifact)
    if(!files.includes(artifact+'/index.html'))throw new Error('Publication build failed: static artifact has no index.html')
    await mkdir(dirname(join(directory,artifact)),{recursive:true})
    await cp(join(temporary,artifact),join(directory,artifact),{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE})
    await staticArtifactFiles(directory,artifact)
    const proof={path:artifact,sha256:await artifactDigest(directory,artifact,true)}
    const build={id:'build',status:'passed',observation,artifacts:[proof]}
    const validate=async()=>{
      await validateRun()
      await staticArtifactFiles(directory,artifact)
      if(await artifactDigest(directory,artifact,true)!==proof.sha256)
        throw new WorkflowError('publication-artifact-changed','Built publication artifact changed; publish the current version again')
    }
    await validate()
    const smoke=await runArtifactCheck(directory,'runtime-smoke',{runtimeArtifact:artifact,expectedOutputs:[]},[],run.requirements.constraints,undefined,'http://bgs-runtime.invalid/deployments/publication/files/index.html')
    if(smoke.status!=='passed')throw new Error('Publication page check failed: '+smoke.observation)
    await validate()
    return {artifact:proof,validate,buildLog:JSON.stringify({protocol:run.protocol,runId:run.id,
      requirementsRevision:run.requirements.revision,operation:'Built an isolated project snapshot and checked the frozen static artifact before publication.',
      quality:'unverified',checks:[build,smoke]})}
  } finally {await rm(temporary,{recursive:true,force:true})}
}
