import { mkdir, realpath, stat } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeTaskToolEnvironment } from '@bee-game-studio/agent-workflow/native-task-access'
import { standardCliProvider } from '@bee-game-studio/agent-workflow/standard-cli-provider'
import { nativeSessionTemporaryPath, nativeSessionOutputPath } from './native-runtime-process-path'
import { sharedPlaywright, preparePreviewRecorder } from './shared-playwright'
import { sharedSharp, sharedFont } from './shared-sharp'
import { sharedContentChecker } from './content-checker-runtime'
import { projectPreviewCapabilityPath } from './project-preview-capability'
import { PROJECT_DESIGN_PATHS } from './design-handoff'
import { MANAGED_WEB_BOOT_PATHS } from './workflow-v3/managed-web-boot'

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
  managedWebBoot?: true
}) {
  const root = await realpath(input.workspacePath)
  const toolReadPaths=await hostToolReadPaths(root)
  const playwright = sharedPlaywright()
  const sharp = await sharedSharp()
  const font = await sharedFont()
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
  const templates = resolve(temporary, 'git-templates')
  await mkdir(templates, { recursive: true, mode: 0o700 })
  if (await realpath(temporary) !== temporary || await realpath(templates) !== templates)
    throw new Error('Project execution directories must remain inside the workspace')
  await preparePreviewRecorder(resolve(temporary, 'browsers'))
  const environment: Record<string, string> = {
    ...nativeTaskToolEnvironment(temporary),
    CLAUDE_CODE_TMPDIR: nativeOutput,
    GIT_TEMPLATE_DIR: templates,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    XDG_CACHE_HOME: resolve(temporary, 'cache'),
    XDG_CONFIG_HOME: resolve(temporary, 'config'),
    NPM_CONFIG_USERCONFIG: '/dev/null',
    npm_config_userconfig: '/dev/null',
    PLAYWRIGHT_BROWSERS_PATH: resolve(temporary, 'browsers'),
    BEEGAME_PLAYWRIGHT_MODULE: playwright.moduleUrl,
    BEEGAME_PREVIEW_TEST_MODULE: previewClient.href,
    BEEGAME_PREVIEW_CAPABILITY_FILE: previewCapability,
    BEEGAME_MEASUREMENT_CAPABILITY_FILE: measurementCapability,
    BEEGAME_CONTENT_CHECKER_MODULE: checker.moduleUrl,
    BEEGAME_SHARP_MODULE: sharp.moduleUrl,
    BEEGAME_FONT_MODULE: font.moduleUrl,
    BEEGAME_UI_INSPECTOR_MODULE: new URL('./ui-inspector.mjs', checker.moduleUrl).href,
  }
  const readPaths = ['/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc', '/private/etc',
    '/System', '/Library/Apple', '/Library/Developer', '/dev', '/opt/homebrew',
    // Bun's module resolver needs directory access even for one bundled .mjs.
    // This private directory contains only the checker, no server/dependencies.
    await realpath(process.execPath), nativeOutput, playwright.root, previewClientPath, previewCapability, measurementCapability, checker.root, ...sharp.roots, ...font.roots]
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
  const { modelType } = standardCliProvider(input.environment)
  const settings = {
    ...(modelType ? { modelType } : {}),
    // Shell sandbox settings do not constrain native file tools. Route every
    // file mutation through the same host workspace boundary as file reads.
    permissions: { ask: [...new Set(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', ...input.scopedTools ?? []])] },
    ...(input.scopedTools ? { disableAllHooks: true } : {}),
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: !input.scopedTools,
      allowUnsandboxedCommands: false, excludedCommands: [],
      network: { allowedDomains: [], allowLocalBinding: true },
      filesystem: { denyRead: ['/'], allowRead: [root, ...readPaths, ...toolReadPaths],
        // Instructions are not a game output. Shell writes cannot bypass the
        // existing explicit file-tool approval for changing the root guide.
        allowWrite: [root, nativeOutput], denyWrite: ['CLAUDE.md', ...PROJECT_DESIGN_PATHS,
          ...(input.managedWebBoot ? MANAGED_WEB_BOOT_PATHS : [])].map(path => resolve(root, path)), allowGitConfig: true },
    },
  }
  // Keep trusted host/plugin settings; project settings cannot broaden access.
  return { root, temporary, nativeOutput, settings, environment, toolReadPaths,
    async isReferenceRead(tool: string | undefined, input: Record<string, unknown>) {
      if (!['Read', 'Glob', 'Grep'].includes(tool ?? '')) return false
      const path = tool === 'Read' ? input.file_path : input.path
      if (typeof path !== 'string') return false
      if (tool === 'Glob' && (typeof input.pattern !== 'string' ||
          isAbsolute(input.pattern) || input.pattern.split(/[\\/]/).includes('..'))) return false
      const target = await realpath(resolve(root, path)).catch(() => undefined)
      if (input.toolResultsDirectory && resolve(root, path).startsWith(input.toolResultsDirectory + '/') &&
          target !== resolve(root, path)) return false
      return Boolean(target && references.some(reference => {
        const part = relative(reference, target)
        return !isAbsolute(part) && part !== '..' && !part.startsWith('../')
      }))
    },
    // Native bypass skips routine prompts, while explicit ask/deny rules above
    // still route file effects through the host boundary. Scoped roles retain
    // their existing per-tool approvals; the OS sandbox remains mandatory.
    flags: ['--setting-sources', 'user', '--permission-mode', input.scopedTools ? 'default' : 'bypassPermissions',
      '--settings', JSON.stringify(settings)] }
}
