import { mkdir, realpath, stat } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeSessionTemporaryPath, nativeSessionOutputPath } from './native-runtime-process-path'
import { sharedPlaywright, preparePreviewRecorder } from './shared-playwright'
import { sharedSharp, sharedFont } from './shared-sharp'
import { sharedContentChecker } from './content-checker-runtime'
import { projectPreviewCapabilityPath } from './project-preview-capability'
import { PROJECT_DESIGN_PATHS } from './design-handoff'

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
  const protectedRoots=[root,await realpath(homedir()),await realpath(tmpdir()),await realpath(process.cwd()),
    ...(process.platform==='darwin'?['/Applications']:[])]
  const result:string[]=[]
  for(const path of paths) {
    if(typeof path!=='string' || !isAbsolute(path) || resolve(path)!==path || /[\x00*?\[\]{}]/.test(path))
      throw invalid('tool paths must be literal absolute canonical paths')
    if(within(root,path) || protectedRoots.some(target=>within(path,target)))
      throw invalid('tool path must be external and must not grant a broad host/project directory')
    const canonical=await realpath(path).catch(()=>{throw invalid('configured tool path is unavailable')})
    if(canonical!==path)throw invalid('tool path must not resolve through a link')
    const kind=await stat(canonical)
    if(!kind.isFile() && !kind.isDirectory())throw invalid('tool path must be a regular file or directory')
    result.push(canonical)
  }
  return [...new Set(result)]
}

/** Host-file boundary for a whole project, not the document-task policy.
 * Tools, delegation and public networking remain native capabilities. */
export async function projectExecutionAccess(input: {
  workspacePath: string
  sessionId: string
  environment: Record<string, string>
  scopedTools?: readonly string[]
  toolResultsDirectory?: string
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
  const [playwright, sharp, font] = await Promise.all([
    optional('browser inspection (Playwright)', sharedPlaywright),
    optional('image processing (Sharp)', sharedSharp),
    optional('font inspection', sharedFont),
  ])
  const checker = await sharedContentChecker()
  const previewClient = new URL('./preview-test-client.mjs', checker.moduleUrl)
  const previewClientPath = await realpath(fileURLToPath(previewClient))
  const temporary = nativeSessionTemporaryPath(root, input.sessionId)
  const nativeOutput = nativeSessionOutputPath(root, input.sessionId, await realpath(tmpdir()))
  await mkdir(nativeOutput, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  if (await realpath(nativeOutput) !== nativeOutput || !(await stat(nativeOutput)).isDirectory())
    throw new Error('Native output directory must not resolve through a link')
  const previewCapability = projectPreviewCapabilityPath(root, input.sessionId)
  const measurementCapability = projectPreviewCapabilityPath(root, input.sessionId, 'measurement')
  const assetCapability = projectPreviewCapabilityPath(root, input.sessionId, 'assets')
  const templates = resolve(temporary, 'git-templates')
  await mkdir(templates, { recursive: true, mode: 0o700 })
  if (await realpath(temporary) !== temporary || await realpath(templates) !== templates)
    throw new Error('Project execution directories must remain inside the workspace')
  if (playwright) await preparePreviewRecorder(resolve(temporary, 'browsers'))
  const environment: Record<string, string> = {
    TMPDIR: temporary,
    // zsh heredocs use TMPPREFIX, independently of TMPDIR's safe location.
    TMPPREFIX: resolve(temporary, 'zsh'),
    TEMP: temporary,
    TMP: temporary,
    GIT_TEMPLATE_DIR: templates,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    XDG_CACHE_HOME: resolve(temporary, 'cache'),
    XDG_CONFIG_HOME: resolve(temporary, 'config'),
    NPM_CONFIG_CACHE: resolve(temporary, 'npm-cache'),
    npm_config_cache: resolve(temporary, 'npm-cache'),
    NPM_CONFIG_USERCONFIG: '/dev/null',
    npm_config_userconfig: '/dev/null',
    PLAYWRIGHT_BROWSERS_PATH: resolve(temporary, 'browsers'),
    // Empty values also override stale inherited module paths.
    BEEGAME_PLAYWRIGHT_MODULE: playwright?.moduleUrl ?? '',
    BEEGAME_PREVIEW_TEST_MODULE: previewClient.href,
    BEEGAME_PREVIEW_CAPABILITY_FILE: previewCapability,
    BEEGAME_MEASUREMENT_CAPABILITY_FILE: measurementCapability,
    BEEGAME_ASSET_CAPABILITY_FILE: assetCapability,
    BEEGAME_CONTENT_CHECKER_MODULE: checker.moduleUrl,
    BEEGAME_SHARP_MODULE: sharp?.moduleUrl ?? '',
    BEEGAME_FONT_MODULE: font?.moduleUrl ?? '',
  }
  const readPaths = ['/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc', '/private/etc',
    '/System', '/Library/Apple', '/Library/Developer', '/dev', '/opt/homebrew',
    // Bun's module resolver needs directory access even for one bundled .mjs.
    // This private directory contains only the checker, no server/dependencies.
    await realpath(process.execPath), nativeOutput, previewClientPath, previewCapability, measurementCapability, assetCapability, checker.root,
    ...(playwright ? [playwright.root] : []), ...(sharp?.roots ?? []), ...(font?.roots ?? [])]
  if (process.platform === 'darwin') {
    const developer = await realpath('/var/select/developer_dir').catch(() => undefined)
    if (developer) {
      readPaths.push(developer)
      environment.DEVELOPER_DIR = developer
      // Use the selected toolchain directly, not xcrun's host-global cache.
      environment.PATH = `${developer}/usr/bin:${input.environment.PATH ?? process.env.PATH ?? '/usr/bin:/bin'}`
    }
  }
  const references: string[] = [nativeOutput]
  if (input.toolResultsDirectory) {
    readPaths.push(input.toolResultsDirectory)
    references.push(input.toolResultsDirectory)
  }
  for (const path of [
    input.environment.BEEGAME_CONFIG_DIR && resolve(input.environment.BEEGAME_CONFIG_DIR, 'skills'),
    input.environment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR,
  ]) {
    if (path) {
      const canonical = await realpath(path).catch(() => undefined)
      if (canonical) { readPaths.push(canonical); references.push(canonical) }
    }
  }
  const protectedPaths = ['AGENTS.md', ...PROJECT_DESIGN_PATHS].map(path => resolve(root, path))
  const filesystem: Record<string, string> = { ':root': 'deny', ':minimal': 'read', ':slash_tmp': 'deny', [root]: 'write', [nativeOutput]: 'write' }
  for (const path of [...readPaths, ...toolReadPaths]) filesystem[path] = 'read'
  for (const path of protectedPaths) filesystem[path] = 'read'
  // Keep credentials/configuration and BGS control data outside model writes.
  for (const name of ['.git', '.bgs', '.agents', '.aws']) filesystem[resolve(root, name)] = 'read'
  return { root, temporary, nativeOutput, environment, toolReadPaths, protectedPaths, unavailable,
    config: {
      default_permissions: 'bgs-project',
      permissions: { 'bgs-project': { filesystem, network: { enabled: true } } },
    },
  }
}
