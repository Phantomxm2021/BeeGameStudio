import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { nativeTaskToolEnvironment } from '@bee-game-studio/agent-workflow/native-task-access'
import { nativeSessionTemporaryPath } from './native-runtime-process-path'
import { sharedPlaywright } from './shared-playwright'

/** Host-file boundary for a whole project, not the document-task policy.
 * Tools, delegation and public networking remain native capabilities. */
export async function projectExecutionAccess(input: {
  workspacePath: string
  sessionId: string
  environment: Record<string, string>
}) {
  const root = await realpath(input.workspacePath)
  const playwright = sharedPlaywright()
  const temporary = nativeSessionTemporaryPath(root, input.sessionId)
  const templates = resolve(temporary, 'git-templates')
  await mkdir(templates, { recursive: true, mode: 0o700 })
  if (await realpath(temporary) !== temporary || await realpath(templates) !== templates)
    throw new Error('Project execution directories must remain inside the workspace')
  const environment: Record<string, string> = {
    ...nativeTaskToolEnvironment(temporary),
    BEEGAME_PROJECT_EXECUTION: '1',
    GIT_TEMPLATE_DIR: templates,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    XDG_CACHE_HOME: resolve(temporary, 'cache'),
    XDG_CONFIG_HOME: resolve(temporary, 'config'),
    NPM_CONFIG_USERCONFIG: '/dev/null',
    npm_config_userconfig: '/dev/null',
    PLAYWRIGHT_BROWSERS_PATH: resolve(temporary, 'browsers'),
    BEEGAME_PLAYWRIGHT_MODULE: playwright.moduleUrl,
  }
  const readPaths = ['/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc', '/private/etc',
    '/System', '/Library/Apple', '/Library/Developer', '/dev', '/opt/homebrew',
    await realpath(process.execPath), playwright.root]
  if (process.platform === 'darwin') {
    const developer = await realpath('/var/select/developer_dir').catch(() => undefined)
    if (developer) {
      readPaths.push(developer)
      environment.DEVELOPER_DIR = developer
      // Use the selected toolchain directly, not xcrun's host-global cache.
      environment.PATH = `${developer}/usr/bin:${input.environment.PATH ?? process.env.PATH ?? '/usr/bin:/bin'}`
    }
  }
  const references: string[] = []
  for (const path of [
    input.environment.BEEGAME_CONFIG_DIR && resolve(input.environment.BEEGAME_CONFIG_DIR, 'skills'),
    input.environment.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR,
  ]) {
    if (path) {
      const canonical = await realpath(path).catch(() => undefined)
      if (canonical) { readPaths.push(canonical); references.push(canonical) }
    }
  }
  const settings = {
    permissions: { ask: ['Read', 'Grep', 'Glob'] },
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false, excludedCommands: [],
      network: { allowedDomains: [], allowLocalBinding: true },
      filesystem: { denyRead: ['/'], allowRead: [root, ...readPaths],
        allowWrite: [root], denyWrite: [], allowGitConfig: true },
    },
  }
  // Keep trusted host/plugin settings; project settings cannot broaden access.
  return { root, temporary, settings, environment,
    async isReferenceRead(tool: string | undefined, input: Record<string, unknown>) {
      if (!['Read', 'Glob', 'Grep'].includes(tool ?? '')) return false
      const path = tool === 'Read' ? input.file_path : input.path
      if (typeof path !== 'string') return false
      if (tool === 'Glob' && (typeof input.pattern !== 'string' ||
          isAbsolute(input.pattern) || input.pattern.split(/[\\/]/).includes('..'))) return false
      const target = await realpath(resolve(root, path)).catch(() => undefined)
      return Boolean(target && references.some(reference => {
        const part = relative(reference, target)
        return !isAbsolute(part) && part !== '..' && !part.startsWith('../')
      }))
    },
    flags: ['--setting-sources', 'user', '--settings', JSON.stringify(settings)] }
}
