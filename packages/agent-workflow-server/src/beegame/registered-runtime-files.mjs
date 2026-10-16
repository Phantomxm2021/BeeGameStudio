import { copyFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** Used by a project's existing build script. Copy only the existing content
 * registry and AssetManifest closure, never whole assets/source directories. */
export async function copyRegisteredRuntimeFiles(workspace, outputDirectory, additionalFiles = []) {
  const root = await realpath(workspace)
  const safePath = path => {
    if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') ||
        path.split('/').some(part => !part || part.startsWith('.')))
      throw Error('Expected an explicit public project-relative file path')
    return resolve(root,path)
  }
  const destination = safePath(outputDirectory)
  if (['assets','content','src','docs','node_modules'].includes(outputDirectory.split('/')[0]))
    throw Error('Publication output must not replace project sources')
  const bytes = async path => {
    const file = safePath(path)
    if (await realpath(file) !== file || !(await lstat(file)).isFile()) throw Error('Registered source must be a regular non-link file: ' + path)
    return readFile(file)
  }
  const json = async path => JSON.parse((await bytes(path)).toString('utf8'))
  const index = await json('content/index.json')
  if (!Array.isArray(index.files)) throw Error('Missing content file registry')
  const paths = new Set(['content/index.json',...index.files.map(path => 'content/' + path),...additionalFiles])
  const manifestPath = 'assets/asset-manifest.json'
  let manifest
  try { manifest = await json(manifestPath) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (manifest) {
    if (manifest.version !== 9 || typeof manifest.modules?.requirements !== 'string' || !Array.isArray(manifest.modules?.resources))
      throw Error('Expected modular AssetManifest v9')
    paths.add(manifestPath); paths.add(manifest.modules.requirements)
    for (const module of manifest.modules.resources) {
      paths.add(module)
      const resource = await json(module)
      if (!Array.isArray(resource.file_paths) || !resource.file_paths.includes(resource.root_path))
        throw Error('Invalid registered resource paths')
      for (const path of resource.file_paths) paths.add(path)
      for (const dependency of resource.dependencies ?? []) {
        if (!resource.file_paths.includes(dependency.local_path)) throw Error('Unregistered resource dependency')
        paths.add(dependency.local_path)
      }
    }
  } else for (const path of index.files) {
    if ((await json('content/' + path)).assetRefs?.length) throw Error('Content resources require AssetManifest')
  }
  // Resolve every input before copying, and never follow output aliases.
  const sources = await Promise.all([...paths].map(async path => {
    const file = safePath(path)
    const part = relative(destination,file)
    if (part === '' || !part.startsWith('..') && !isAbsolute(part)) throw Error('Publication cannot copy from its output')
    if (await realpath(file) !== file || !(await lstat(file)).isFile()) throw Error('Registered source must be a regular non-link file: ' + path)
    return {path,file}
  }))
  for (const {path,file} of sources) {
    const target = resolve(destination,path)
    let parent = root
    for (const part of relative(root,dirname(target)).split('/')) {
      parent = resolve(parent,part)
      await mkdir(parent).catch(error => { if (error.code !== 'EEXIST') throw error })
      if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory()) throw Error('Publication parent must not be a link')
    }
    try { if (!(await lstat(target)).isFile() || await realpath(target) !== target) throw Error('Publication target must not be a link') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await copyFile(file,target)
  }
  return [...paths].sort()
}
