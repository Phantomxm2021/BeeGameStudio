import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, dirname, extname, isAbsolute } from 'node:path'
import { artifactDigest } from '../runtime-acceptance'
import { readBeeGameAssetManifest } from '../asset-contracts'
import { staticArtifactFiles } from './runtime-checks'
import { digest, WorkflowError, type CheckResult, type FileVersion, type TaskSpec, type PackageComposition } from './state'
import { EDITABLE_BUILD_CHECK_VERSION } from './check-versions'

// Keep the existing public imports while sharing only read-only input identity code.
export { projectFiles, projectDependencies, sameFiles, changedProjectPaths, AGENT_EVIDENCE_DIRECTORY } from './checks'
import { projectFiles, projectDependencies, sameFiles } from './checks'

async function rebaseDependencyLinks(directory:string, sourceRoot:string, copyRoot:string) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name)
    if (entry.isDirectory()) await rebaseDependencyLinks(path,sourceRoot,copyRoot)
    else if (entry.isSymbolicLink()) {
      const link=await readlink(path)
      if (!isAbsolute(link)) continue
      // Relative links already relocate with the tree. Absolute internal links
      // must not keep resolving back into the original project's dependencies.
      const target=relative(sourceRoot,await realpath(link))
      if (!target || target==='..' || target.startsWith('../') || isAbsolute(target))
        throw new WorkflowError('dependency-alias','Installed dependency link resolves outside the workspace')
      await rm(path)
      await symlink(relative(dirname(path),join(copyRoot,target)),path)
    }
  }
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
    // Preserve package-manager links: flattening .bin entries breaks their
    // package-relative imports. Copy bytes locally and verify before execution.
    if(dependencySha256) {
      await cp(join(base,'node_modules'),join(temporary,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE})
      await rebaseDependencyLinks(join(temporary,'node_modules'),base,temporary)
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
