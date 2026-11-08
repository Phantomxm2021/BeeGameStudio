import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeSessionTemporaryPath, nativeSessionOutputPath } from './native-runtime-process-path'
import { sharedSharp } from './shared-sharp'
import { sharedContentChecker } from './content-checker-runtime'
import { projectPreviewCapabilityPath } from './project-preview-capability'
import { PROJECT_DESIGN_PATHS } from './design-handoff'
import { projectHostDirectory, projectWorkDirectory } from './project-storage-paths'

const TOOL_READ_PATHS='BEEGAME_PROJECT_TOOL_READ_PATHS'
const within=(parent:string,path:string)=>{
  const part=relative(parent,path)
  return !isAbsolute(part) && part!=='..' && !part.startsWith('..'+sep)
}

/** Explicit operator grants, not paths from a brief, model env or project file.
 * Only the current canonical workspace entry is consulted; there is no global
 * engine discovery, write grant or per-command sandbox bypass. */
async function hostToolReadPaths(root:string):Promise<string[]> {
  const raw=process.env[TOOL_READ_PATHS]
  if(raw===undefined)return []
  const invalid=(reason:string)=>new Error(TOOL_READ_PATHS+': '+reason)
  let value:unknown
  try {value=JSON.parse(raw)}catch{throw invalid('expected a JSON object mapping canonical workspaces to read-only tool paths')}
  if(!value || typeof value!=='object' || Array.isArray(value))throw invalid('expected a workspace map')
  if(!Object.hasOwn(value,root))return []
  const paths=(value as Record<string,unknown>)[root]
  if(!Array.isArray(paths))throw invalid('current workspace entry must be an array')
  const protectedRoots=[root,projectHostDirectory(root),await realpath(homedir()),await realpath(tmpdir()),await realpath(process.cwd()),
    ...(process.platform==='darwin'?['/Applications']:[])]
  const result:string[]=[]
  for(const path of paths) {
    if(typeof path!=='string' || !isAbsolute(path) || resolve(path)!==path || /[\x00*?\[\]{}]/.test(path))
      throw invalid('tool paths must be literal absolute canonical paths')
    if(within(root,path) || within(projectHostDirectory(root),path) || protectedRoots.some(target=>within(path,target)))
      throw invalid('tool path must be external and must not grant a broad host/project directory')
    const canonical=await realpath(path).catch(()=>{throw invalid('configured tool path is unavailable')})
    if(canonical!==path)throw invalid('tool path must not resolve through a link')
    const kind=await stat(canonical)
    if(!kind.isFile() && !kind.isDirectory())throw invalid('tool path must be a regular file or directory')
    result.push(canonical)
  }
  return [...new Set(result)]
}

/** Native filesystem profiles; an authorized document assignment opens docs/,
 * while review access remains read-only. Execution stays with the native runtime. */
export async function projectExecutionAccess(input: {
  workspacePath: string
  sessionId: string
  environment: Record<string, string>
  readOnly?: boolean
  documentPath?: string
}) {
  const root = await realpath(input.workspacePath)
  const toolReadPaths=await hostToolReadPaths(root)
  // Optional inspection clients must not prevent unrelated project work.
  // Failed preparations grant no paths and are disclosed to the native runner.
  const unavailable: string[] = []
  const optional = async <T>(name: string, prepare: () => T | Promise<T>): Promise<T | undefined> => {
    try { return await prepare() }
    catch (error) {
      unavailable.push(name)
      console.warn('[BGS optional runtime] ' + name + ':', error)
      return undefined
    }
  }
  const [sharp, checker] = await Promise.all([
    input.readOnly ? undefined : optional('image processing (Sharp)', sharedSharp),
    input.readOnly ? undefined : optional('resource/media tools', sharedContentChecker),
  ])
  const temporary = nativeSessionTemporaryPath(root, input.sessionId)
  const nativeOutput = nativeSessionOutputPath(root, input.sessionId)
  // Package caches contain source/tests. Keep them outside the game tree so
  // ordinary project scans do not treat cached dependencies as game sources.
  const cache = resolve(nativeOutput, 'cache')
  const work = projectWorkDirectory(root, input.sessionId)
  for (const path of [work, nativeOutput, cache]) {
    await mkdir(path, { recursive: true, mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    if (await realpath(path) !== path || !(await stat(path)).isDirectory())
      throw new Error('Native runtime directory must not resolve through a link')
  }
  const assetCapability = projectPreviewCapabilityPath(root, input.sessionId)
  const templates = resolve(temporary, 'git-templates')
  await mkdir(templates, { recursive: true, mode: 0o700 })
  if (await realpath(temporary) !== temporary || await realpath(templates) !== templates)
    throw new Error('Project execution directories must not resolve through links')
  const environment: Record<string, string> = {
    TMPDIR: temporary,
    // zsh heredocs use TMPPREFIX, independently of TMPDIR's safe location.
    TMPPREFIX: resolve(temporary, 'zsh'),
    TEMP: temporary,
    TMP: temporary,
    GIT_TEMPLATE_DIR: templates,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    XDG_CACHE_HOME: resolve(cache, 'xdg'),
    BUN_INSTALL_CACHE_DIR: resolve(cache, 'bun'),
    XDG_CONFIG_HOME: resolve(temporary, 'config'),
    NPM_CONFIG_CACHE: resolve(cache, 'npm'),
    npm_config_cache: resolve(cache, 'npm'),
    NPM_CONFIG_USERCONFIG: '/dev/null',
    npm_config_userconfig: '/dev/null',
  }
  const readPaths = ['/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc', '/private/etc',
    '/System', '/Library/Apple', '/Library/Developer', '/dev', '/opt/homebrew',
    await realpath(process.execPath), nativeOutput]
  // Bun's module resolver needs the private checker directory as well as its file.
  const runtimeReadPaths = [assetCapability,
    ...(checker ? [checker.root] : []),
    ...(sharp?.roots ?? [])]
  if (process.platform === 'darwin') {
    const developer = await realpath('/var/select/developer_dir').catch(() => undefined)
    if (developer) {
      readPaths.push(developer)
      environment.DEVELOPER_DIR = developer
      // Use the selected toolchain directly, not xcrun's host-global cache.
      environment.PATH = `${developer}/usr/bin:${input.environment.PATH ?? process.env.PATH ?? '/usr/bin:/bin'}`
    }
  }
  const reviewEnvironment = { ...environment }
  Object.assign(environment, {
    // Empty values also override stale inherited module paths.
    BEEGAME_ASSET_CAPABILITY_FILE: assetCapability,
    BEEGAME_CONTENT_CHECKER_MODULE: checker?.moduleUrl ?? '',
    BEEGAME_SHARP_MODULE: sharp?.moduleUrl ?? '',
  })
  for (const path of [
    input.environment.BEEGAME_CONFIG_DIR && resolve(input.environment.BEEGAME_CONFIG_DIR, 'skills'),
    input.environment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR,
  ]) {
    if (path) {
      const canonical = await realpath(path).catch(() => undefined)
      if (canonical) runtimeReadPaths.push(canonical)
    }
  }
  // Host registration owns these canonical files. Keep the directory present so
  // the native sandbox also denies rename/unlink of its existing parent entry.
  if (!input.readOnly) {
    let registryParent = root
    for (const name of ['assets', 'manifest']) {
      registryParent = resolve(registryParent, name)
      await mkdir(registryParent, { mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      if (await realpath(registryParent) !== registryParent) throw Error('Resource registry must not resolve through a link')
    }
  }
  const protectedPaths = ['AGENTS.md', ...PROJECT_DESIGN_PATHS].map(path => resolve(root, path))
  const filesystem: Record<string, string> = { ':root': 'deny', ':minimal': 'read', ':slash_tmp': 'deny', [root]: input.readOnly ? 'read' : 'write', [cache]: 'write' }
  for (const path of [...readPaths, ...toolReadPaths]) filesystem[path] = 'read'
  filesystem[projectHostDirectory(root)] = 'deny'
  filesystem[work] = 'read'
  filesystem[temporary] = 'write'
  const reviewFilesystem = { ...filesystem, [root]: 'read', [temporary]: 'write' }
  for (const path of runtimeReadPaths) filesystem[path] = 'read'
  if (input.readOnly) filesystem[temporary] = 'write'
  // Preserve confirmed design records outside an authorized document assignment.
  for (const path of protectedPaths) filesystem[path] = 'read'
  if (input.documentPath) {
    const docs=resolve(root,'docs'), document=resolve(root,input.documentPath)
    if (!within(docs,document) || document===docs || isAbsolute(input.documentPath))
      throw Error('Document authoring requires a project-relative docs/ path')
    await mkdir(docs,{recursive:true})
    if (await realpath(docs)!==docs) throw Error('Document directory must not resolve through a link')
    try { if (await realpath(document)!==document) throw Error('Document file must not resolve through a link') }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error }
    filesystem[docs]='write'
    filesystem[document]='write'
  }
  for (const path of ['assets/asset-manifest.json', 'assets/manifest']) filesystem[resolve(root, path)] = 'read'
  // Keep credentials/configuration and BGS control data outside model writes.
  for (const name of ['.git', '.bgs', '.agents', '.aws']) filesystem[resolve(root, name)] = 'read'
  // Retain the stable scratch tree for saved work. Unix socket consumers need
  // a short, private IPC/temp root; granting only this unique directory keeps
  // other sessions and the host temp root outside both permission profiles.
  const runtimeTemporary = await realpath(await mkdtemp(resolve(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'bgs-')))
  const tempEnvironment = { TMPDIR: runtimeTemporary, TEMP: runtimeTemporary, TMP: runtimeTemporary,
    TMPPREFIX: resolve(runtimeTemporary, 'zsh') }
  Object.assign(environment, tempEnvironment)
  Object.assign(reviewEnvironment, tempEnvironment)
  filesystem[runtimeTemporary] = 'write'
  reviewFilesystem[runtimeTemporary] = 'write'
  return { root, temporary: runtimeTemporary, nativeOutput, environment, reviewEnvironment, toolReadPaths, protectedPaths, unavailable,
    close: () => rm(runtimeTemporary, { recursive: true, force: true }),
    config: {
      default_permissions: 'bgs-project',
      permissions: {
        'bgs-project': { filesystem, network: { enabled: true } },
        'bgs-project-review': { filesystem: reviewFilesystem, network: { enabled: false } },
      },
    },
  }
}
