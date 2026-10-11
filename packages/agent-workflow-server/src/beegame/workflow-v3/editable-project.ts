import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, dirname } from 'node:path'
import { artifactDigest } from '../runtime-acceptance'
import { staticArtifactFiles } from './runtime-checks'
import { digest, WorkflowError, type CheckResult, type FileVersion, type TaskSpec } from './state'
import { EDITABLE_BUILD_CHECK_VERSION } from './check-versions'

const safeDots = new Set(['.gitignore', '.editorconfig', '.browserslistrc'])
const excludedNames = new Set(['node_modules', '.git', '.beegame', '.DS_Store'])
// Autonomous Web builds reserve this directory for validation attachments.
// It is absent from the measured build copy, not merely ignored after building.
// Existing receipts retain their own recorded exclusions (often exact files).
export const AGENT_EVIDENCE_DIRECTORY = 'reports'
// SessionManager's reserved workspace records live outside .beegame too.
// Keep other files in logs/ (they may be real game inputs), not a name-only
// exclusion of every logging directory in the editable project.
const hostRecord = (path:string) => path==='transcripts' || /^logs\/(index\.json|runtime-diagnostics\.jsonl(?:\.\d+)?)$/.test(path)
/** No author-selected file list: enumerate the exportable project before build.
 * Private dot files are absent from the build copy, not silently required inputs.
 * Reports are host workflow evidence, not editable game source. */
export async function projectFiles(root: string, artifact: string, excludedReports: string[]): Promise<FileVersion[]> {
  const base = await realpath(root), files: FileVersion[] = []
  async function visit(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      const target = resolve(dir,entry.name), path = relative(base,target).split('\\').join('/')
      if (path===artifact || hostRecord(path) || excludedReports.some(report=>path===report || path.startsWith(report+'/')) || excludedNames.has(entry.name) || entry.name.startsWith('.') && !safeDots.has(entry.name)) continue
      if (entry.name.includes('\\') || entry.isSymbolicLink() || await realpath(target)!==target)
        throw new WorkflowError('project-alias', 'Editable project sources must not contain aliases: '+path)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) files.push({path,sha256:digest(await readFile(target))})
      else throw new WorkflowError('project-file-invalid','Editable project contains a non-regular source: '+path)
    }
  }
  await visit(base)
  if (!files.some(f=>f.path==='package.json')) throw new WorkflowError('project-incomplete','Editable export needs a saved package.json',400)
  return files.sort((a,b)=>a.path.localeCompare(b.path))
}
export const sameFiles = (a: FileVersion[], b: FileVersion[]) => JSON.stringify(a)===JSON.stringify(b)
export function changedProjectPaths(previous: FileVersion[], current: FileVersion[]) {
  const before=new Map(previous.map(f=>[f.path,f.sha256])),after=new Map(current.map(f=>[f.path,f.sha256]))
  return [...new Set([...before.keys(),...after.keys()])].filter(path=>before.get(path)!==after.get(path)).sort()
}
export async function projectDependencies(root:string) {
  try {
    const dir=join(root,'node_modules'), info=await lstat(dir)
    if (!info.isDirectory() || await realpath(dir)!==dir) throw new WorkflowError('dependency-alias','Installed dependency root must be a project-local directory')
    return await artifactDigest(root,'node_modules',true)
  } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error }
}
async function canonicalParents(base:string, parent:string) {
  let current=base
  for(const part of relative(base,parent).split('/').filter(Boolean)) {
    current=join(current,part)
    try { if(await realpath(current)!==current || !(await lstat(current)).isDirectory()) throw new WorkflowError('project-alias','Build output parent must be a canonical directory') }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await mkdir(current) }
  }
}
/** Explicit source-copy build. Autonomous entry requests OS/network isolation;
 * legacy callers retain their existing mode. Neither proves a fresh dependency
 * installation, bit-reproducibility or full game quality. */
export async function buildEditableProject(root:string, task:Pick<TaskSpec,'editableProject'|'runtimeArtifact'|'writablePaths'>, inputs:FileVersion[], excludedReports:string[], signal?:AbortSignal, isolated = false):Promise<CheckResult> {
  const result:CheckResult={id:'build',version:EDITABLE_BUILD_CHECK_VERSION,status:'unverified',inputs,createdAt:new Date().toISOString(),observation:'Editable build has not completed'}
  if(!task.editableProject || !task.runtimeArtifact || !task.writablePaths.includes(task.runtimeArtifact+'/**')) return result
  const base=await realpath(root), artifact=task.runtimeArtifact, temporary=await mkdtemp(join(tmpdir(),'bgs-editable-build-'))
  let stage:string|undefined, backup=false, installed=false
  try {
    const files=await projectFiles(base,artifact,excludedReports)
    const pkg=JSON.parse(await readFile(join(base,'package.json'),'utf8'))
    if(typeof pkg.scripts?.build!=='string'||!pkg.scripts.build.trim()) {result.observation='No actual package script: build';return result}
    const dependencySha256=await projectDependencies(base)
    if(dependencySha256&&!files.some(f=>['bun.lock','bun.lockb','package-lock.json','pnpm-lock.yaml','yarn.lock'].includes(f.path))) {
      result.observation='Installed dependencies require an exported lockfile; no guessed dependency versions';return result
    }
    for(const file of files) {
      if(signal?.aborted)throw Error('Build cancelled')
      const data=await readFile(join(base,file.path))
      if(digest(data)!==file.sha256)throw new WorkflowError('project-source-changed','Source changed while copying: '+file.path)
      await mkdir(dirname(join(temporary,file.path)),{recursive:true});await Bun.write(join(temporary,file.path),data)
    }
    if(!sameFiles(files,await projectFiles(temporary,artifact,excludedReports)))throw new WorkflowError('project-copy-invalid','Build copy differs from exportable source bytes')
    // Installed libraries are an explicit measured external build operand. They
    // are never exported as sources or silently treated as a fresh installation.
    if(dependencySha256) {
      const {symlink}=await import('node:fs/promises');await symlink(join(base,'node_modules'),join(temporary,'node_modules'),'junction')
    }
    const {commandCheck}=await import('./checks')
    const observed=await commandCheck(temporary,'build',signal,isolated)
    result.observation='Host executed bun run build in the exportable source copy; exit '+observed.code+'\n'+observed.log
    if(observed.code!==0) {result.status='failed';return result}
    if(!sameFiles(files,await projectFiles(base,artifact,excludedReports)) || !sameFiles(files,await projectFiles(temporary,artifact,excludedReports)) || dependencySha256!==await projectDependencies(base))
      throw new WorkflowError('project-source-changed','Source/dependencies changed during build; no candidate was installed')
    const built=await staticArtifactFiles(temporary,artifact)
    if(!built.includes(artifact+'/index.html')) {result.observation+='\nBuilt static artifact has no index.html';return result}
    const sha256=await artifactDigest(temporary,artifact,true)
    const target=join(base,artifact), parent=dirname(target)
    await canonicalParents(base,parent)
    try{if(await realpath(target)!==target || !(await lstat(target)).isDirectory())throw new WorkflowError('project-alias','Existing build output is not a canonical directory')}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    // Same-volume staging replaces only the fully authorized artifact directory;
    // old stale files cannot sneak into the measured build through a merge.
    const host=join(base,'.beegame');await mkdir(host,{recursive:true})
    if(await realpath(host)!==host)throw new WorkflowError('project-alias','Host build staging must not be an alias')
    stage=await mkdtemp(join(host,'editable-build-'))
    await cp(join(temporary,artifact),join(stage,'candidate'),{recursive:true})
    if(await artifactDigest(base,relative(base,join(stage,'candidate')),true)!==sha256)throw Error('Build copy changed before installation')
    if(!sameFiles(files,await projectFiles(base,artifact,excludedReports)))throw new WorkflowError('project-source-changed','Source changed before build installation')
    if(signal?.aborted)throw Error('Build cancelled')
    try{await rename(target,join(stage,'previous'));backup=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    try{await rename(join(stage,'candidate'),target);installed=true}catch(error){if(backup){await rename(join(stage,'previous'),target);backup=false}throw error}
    result.status='passed';result.artifacts=[{path:artifact,sha256}]
    result.projectBuild={version:EDITABLE_BUILD_CHECK_VERSION,files,excludedReports,artifact:{path:artifact,sha256},...(dependencySha256?{dependencySha256}:{}),runtime:'Bun '+Bun.version+' (Node '+process.version+') '+process.platform+'/'+process.arch}
    result.coverage={files:files.map(f=>f.path),limitations:[
      'Actual source-copy build and installed artifact identity only. Not a fresh dependency installation, bit-reproducible rebuild or full game acceptance.',
      isolated ? 'Build script ran in the supported host OS sandbox with no network and writes confined to the source copy; installed dependencies were read-only.' : 'Legacy build mode is not an OS/network sandbox.',
    ]}
    return result
  } finally {
    await rm(temporary,{recursive:true,force:true})
    // Never delete the only prior build if restoration itself failed.
    if(stage && (!backup||installed))await rm(stage,{recursive:true,force:true})
  }
}
