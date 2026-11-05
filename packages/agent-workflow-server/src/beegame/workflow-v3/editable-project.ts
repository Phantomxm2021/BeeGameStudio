import { cp, lstat, mkdir, readdir, readlink, realpath, rm, symlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative, dirname, isAbsolute } from 'node:path'
import { WorkflowError } from './state'

// Keep the existing public imports while sharing only read-only input identity code.
export { projectFiles, projectDependencies, sameFiles, changedProjectPaths, AGENT_EVIDENCE_DIRECTORY, AGENT_SOURCE_EXCLUSIONS } from './checks'

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
/** Reuse installed packages in the private build tree without flattening links. */
export async function copyBuildDependencies(source:string, target:string):Promise<boolean> {
  const dependencies=join(source,'node_modules')
  try {
    if(!(await lstat(dependencies)).isDirectory() || await realpath(dependencies)!==dependencies)
      throw new WorkflowError('dependency-alias','Installed dependency root must be a project-local directory')
  } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error }
  await cp(dependencies,join(target,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE})
  await rebaseDependencyLinks(join(target,'node_modules'),source,target)
  return true
}
export async function prepareBuildCaches(root:string) {
  for(const name of ['.vite-temp','.tmp']) {
    const cache=join(await realpath(root),'node_modules',name)
    await mkdir(cache).catch(error=>{if(error.code!=='EEXIST')throw error})
    if(!(await lstat(cache)).isDirectory() || await realpath(cache)!==cache)
      throw new WorkflowError('dependency-alias','Build cache must be a canonical directory in the isolated copy')
  }
}
