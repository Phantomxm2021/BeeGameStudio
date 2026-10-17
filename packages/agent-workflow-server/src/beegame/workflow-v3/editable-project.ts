import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, dirname, extname } from 'node:path'
import { artifactDigest } from '../runtime-acceptance'
import { readBeeGameAssetManifest } from '../asset-contracts'
import { staticArtifactFiles } from './runtime-checks'
import { digest, WorkflowError, type CheckResult, type FileVersion, type TaskSpec, type PackageComposition } from './state'
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
/** Inventory the entire built artifact, never an author-selected probe list.
 * Registration is only a hint for production materials, not proof of runtime use. */
async function packageComposition(root:string, artifact:FileVersion, files:string[]):Promise<PackageComposition> {
  const measured: {path:string;bytes:number;sha256:string}[]=[]
  for(const path of files) {
    const data=await readFile(join(root,path))
    measured.push({path:relative(artifact.path,path).split('\\').join('/'),bytes:data.length,sha256:digest(data)})
  }
  const directories=new Map<string,{fileCount:number;bytes:number}>(), types=new Map<string,{fileCount:number;bytes:number}>()
  const hashes=new Map<string,typeof measured>()
  for(const file of measured) {
    for(const [map,key] of [[directories,dirname(file.path)],[types,extname(file.path).toLowerCase()||'(none)']] as const) {
      const group=map.get(key)??{fileCount:0,bytes:0}
      group.fileCount++;group.bytes+=file.bytes;map.set(key,group)
    }
    const group=hashes.get(file.sha256)??[];group.push(file);hashes.set(file.sha256,group)
  }
  const duplicates=[...hashes.entries()].filter(([,group])=>group.length>1).map(([sha256,group])=>({
    sha256,bytesPerFile:group[0]!.bytes,duplicateBytes:group[0]!.bytes*(group.length-1),paths:group.map(file=>file.path),
  })).sort((a,b)=>b.duplicateBytes-a.duplicateBytes||a.paths[0]!.localeCompare(b.paths[0]!))
  let productionMaterials:PackageComposition['productionMaterials']
  try {
    // The shared reader returns an empty manifest when absent. Missing evidence
    // must instead stay unverified here, not label every source file unregistered.
    await readFile(join(root,'assets/asset-manifest.json'))
    const manifest=await readBeeGameAssetManifest(root)
    const registered=new Set(manifest.resources.flatMap(resource=>[
      ...resource.file_paths,...(resource.dependencies??[]).map(dependency=>dependency.local_path),
    ]))
    productionMaterials={status:'manifest-read',candidates:measured.filter(file=>
      /^assets\/(source|visual)\//.test(file.path)&&!registered.has(file.path)).map(({path,bytes})=>({path,bytes}))}
  } catch(error) {
    productionMaterials={status:'unverified',candidates:null,reason:(error as NodeJS.ErrnoException).code==='ENOENT'?
      'AssetManifest is absent; production-material classification was not performed.':
      'AssetManifest could not be read completely; production-material classification was not performed.'}
  }
  return {artifact,fileCount:measured.length,totalBytes:measured.reduce((sum,file)=>sum+file.bytes,0),
    directories:[...directories].sort(([a],[b])=>a.localeCompare(b)).map(([path,counts])=>({path,...counts})),
    fileTypes:[...types].sort(([a],[b])=>a.localeCompare(b)).map(([extension,counts])=>({extension,...counts})),
    largestFiles:[...measured].sort((a,b)=>b.bytes-a.bytes||a.path.localeCompare(b.path)).slice(0,10).map(({path,bytes})=>({path,bytes})),
    duplicateBytes:duplicates.reduce((sum,group)=>sum+group.duplicateBytes,0),duplicates,productionMaterials,
    limitations:[
      'Raw file bytes, not ZIP size or network transfer size. Paths are artifact-relative; directory totals group immediate parents without double counting.',
      'Identical SHA-256 groups show repeated bytes, not safe-to-delete files or guaranteed savings.',
      'Production-material candidates are unregistered assets/source or assets/visual paths compared with the source-copy AssetManifest. They may still be needed; other paths and actual runtime use are not classified. This is not a quality gate and no files were removed.',
    ]}
}
/** Source-copy build with OS/network isolation. This does not prove fresh
 * dependency installation, bit-reproducibility or full game quality. */
export async function buildEditableProject(root:string, task:Pick<TaskSpec,'editableProject'|'runtimeArtifact'|'writablePaths'>, inputs:FileVersion[], excludedReports:string[], signal?:AbortSignal):Promise<CheckResult> {
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
    // Keep dependency resolution inside the isolated copy. A root symlink back
    // to the original project made Bun traverse/read original ancestor folders
    // for React's transitive imports, which the sandbox correctly denied.
    // Materialize the same measured bytes (reflink where supported), not a
    // fresh install or a broader host read grant. Verify BEFORE executing code.
    if(dependencySha256) {
      await cp(join(base,'node_modules'),join(temporary,'node_modules'),{recursive:true,dereference:true,mode:constants.COPYFILE_FICLONE})
      if(await artifactDigest(temporary,'node_modules',true)!==dependencySha256 || await projectDependencies(base)!==dependencySha256)
        throw new WorkflowError('dependency-copy-changed','Installed dependencies changed while materializing the isolated build; no code was executed')
    }
    const {commandCheck}=await import('./checks')
    const observed=await commandCheck(temporary,'build',signal)
    result.observation='Host executed bun run build in the exportable source copy; exit '+observed.code+'\n'+observed.log
    if(observed.code!==0) {result.status='failed';return result}
    if(!sameFiles(files,await projectFiles(base,artifact,excludedReports)) || !sameFiles(files,await projectFiles(temporary,artifact,excludedReports)) || dependencySha256!==await projectDependencies(base))
      throw new WorkflowError('project-source-changed','Source/dependencies changed during build; no candidate was installed')
    const built=await staticArtifactFiles(temporary,artifact)
    if(!built.includes(artifact+'/index.html')) {result.observation+='\nBuilt static artifact has no index.html';return result}
    const sha256=await artifactDigest(temporary,artifact,true)
    const composition=await packageComposition(temporary,{path:artifact,sha256},built)
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
    result.projectBuild={version:EDITABLE_BUILD_CHECK_VERSION,files,excludedReports,artifact:{path:artifact,sha256},packageComposition:composition,...(dependencySha256?{dependencySha256}:{}),runtime:'Bun '+Bun.version+' (Node '+process.version+') '+process.platform+'/'+process.arch}
    result.coverage={files:files.map(f=>f.path),limitations:[
      'Actual source-copy build and installed artifact identity only. Not a fresh dependency installation, bit-reproducible rebuild or full game acceptance.',
      'Build script ran in the supported host OS sandbox with no network and writes confined to the source copy; installed dependencies were read-only.',
    ]}
    return result
  } finally {
    await rm(temporary,{recursive:true,force:true})
    // Never delete the only prior build if restoration itself failed.
    if(stage && (!backup||installed))await rm(stage,{recursive:true,force:true})
  }
}
