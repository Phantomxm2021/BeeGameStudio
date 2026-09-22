import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const within = (root: string, path: string) => {
  const part = relative(root, path)
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../')
}

export type NativeTaskAccessInput = {
  workspacePath: string
  readOnlyPaths?: readonly string[]
  writablePaths?: readonly string[]
  allowWorkingFiles?: boolean
}

type TaskPermission =
  | { behavior: 'allow'; updatedInput: Record<string, any> }
  | { behavior: 'deny'; message: string }

/** Tool caches belong to the task, not the host's private runtime directory. */
export function nativeTaskToolEnvironment(temporaryPath: string) {
  const npmCache = resolve(temporaryPath, 'npm-cache')
  return { TMPDIR: temporaryPath, CLAUDE_CODE_TMPDIR: temporaryPath,
    NPM_CONFIG_CACHE: npmCache, npm_config_cache: npmCache }
}

/** Execution permissions, not an agent/tool-selection policy. The native CLI
 * exposes its normal tools. File effects stay in the task workspace, shell
 * effects are enforced by the native OS sandbox, and delegates inherit both. */
export async function createNativeTaskAccess(input: NativeTaskAccessInput) {
  const root = await realpath(input.workspacePath)
  const temporaryPath = resolve(root, '.native-tmp')
  await mkdir(temporaryPath, { recursive: true, mode: 0o700 })
  if (await realpath(temporaryPath) !== temporaryPath) throw new Error('Invalid native task temporary directory')
  const toolResultsPath = resolve(root, '.native-tool-results')
  await mkdir(toolResultsPath, { recursive: true, mode: 0o700 })
  if (await realpath(toolResultsPath) !== toolResultsPath) throw new Error('Invalid native tool result directory')
  const protectedPaths = [...(input.readOnlyPaths ?? []), '.claude', '.git', '.native-tool-results']
    .map(path => resolve(root, path))
  const writable = (input.writablePaths ?? []).map(path => resolve(root, path))
  if ([...protectedPaths, ...writable].some(path => !within(root, path)))
    throw new Error('Invalid native task access boundary')

  // System/runtime executables are readable by shell commands, but other
  // project directories, personal configuration and provider credentials are not.
  const systemReadPaths = ['/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc',
    '/private/etc', '/System', '/Library/Apple', '/Library/Developer', '/dev',
    '/opt/homebrew', process.execPath]
  const settings = {
    disableAllHooks: true,
    permissions: {
      // Explicit ask rules also apply to normally auto-approved file reads and
      // sub-agent acceptEdits mode. No --tools/--disallowedTools filtering.
      ask: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'LSP', 'Agent', 'Bash'],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      network: { allowedDomains: [], allowAllUnixSockets: false, allowLocalBinding: false },
      filesystem: {
        denyRead: ['/'], allowRead: [root, ...systemReadPaths],
        allowWrite: [root], denyWrite: [...protectedPaths, ...(!input.allowWorkingFiles ? [root] : [])],
      },
    },
  }

  async function canonicalPath(path: string, mayCreate: boolean): Promise<boolean> {
    let current = path
    for (;;) {
      try {
        if (await realpath(current) !== current) return false
        const info = await lstat(current)
        return !info.isSymbolicLink() && (current !== path || !info.isFile() || info.nlink === 1)
      } catch (error) {
        if (!mayCreate || (error as NodeJS.ErrnoException).code !== 'ENOENT' || current === root) return false
        current = dirname(current)
        if (!within(root, current)) return false
      }
    }
  }

  async function permission(request: Record<string, any>): Promise<TaskPermission> {
    const name = request.tool_name
    const args = request.input
    const deny = (reason: string): TaskPermission => ({ behavior: 'deny',
      message: `${reason} Task working directory: ${JSON.stringify(root)}. File paths may be absolute or relative to this directory. No authorization request has been opened.` })
    const allow = (updatedInput: Record<string, any>): TaskPermission => ({ behavior: 'allow', updatedInput })
    if (!args || typeof args !== 'object' || Array.isArray(args)) return deny('Invalid tool input: expected an object.')
    if (name === 'Bash') {
      if (typeof args.command !== 'string' || !args.command.trim()) return deny('Invalid Bash input: command is empty.')
      // Never grant the SDK's escape hatch. CLI startup fails if the configured
      // sandbox cannot start, and native execution enforces the same restriction.
      return allow({ ...args, dangerouslyDisableSandbox: false })
    }
    if (name === 'Agent') {
      // Delegation is available, but cannot elevate the child's permission mode.
      return allow({ ...args, mode: 'default' })
    }
    const fileKey = name === 'NotebookEdit' ? 'notebook_path' : name === 'LSP' ? 'filePath'
      : ['Read', 'Edit', 'Write'].includes(name) ? 'file_path'
        : ['Glob', 'Grep'].includes(name) ? 'path' : undefined
    if (!fileKey) return deny(`Tool ${JSON.stringify(name)} has no task permission handler.`)
    if ((fileKey !== 'path' && typeof args[fileKey] !== 'string') ||
        (args[fileKey] !== undefined && typeof args[fileKey] !== 'string'))
      return deny(`Invalid ${fileKey}: expected a file path string.`)
    const path = resolve(root, args[fileKey] ?? '.')
    if (!within(root, path)) return deny(`Path ${JSON.stringify(path)} is outside this task workspace. Check the path against the working directory; no file was changed.`)
    if (name === 'Glob' && (typeof args.pattern !== 'string' || isAbsolute(args.pattern) ||
        args.pattern.split(/[\\/]/).includes('..'))) return deny('Glob pattern must be relative and cannot traverse parent directories.')
    const writing = ['Write', 'Edit', 'NotebookEdit'].includes(name)
    if (writing && protectedPaths.some(protectedPath => within(protectedPath, path)))
      return deny(`Path ${JSON.stringify(path)} is read-only for this task.`)
    if (writing && !input.allowWorkingFiles && !writable.includes(path))
      return deny(`Path ${JSON.stringify(path)} is not a writable output for this task.`)
    if (!await canonicalPath(path, name === 'Write'))
      return deny(`Cannot access ${JSON.stringify(path)}: the path is unavailable or resolves through a symbolic/hard link rather than a regular task file.`)
    return allow({ ...args, [fileKey]: path })
  }

  return {
    root, settings, permission,
    flags: ['--permission-mode', 'default', '--setting-sources', '', '--strict-mcp-config',
      '--settings', JSON.stringify(settings)],
    // Shell/MCP/LSP children do not need the parent model's credentials.
    environment: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', ...nativeTaskToolEnvironment(temporaryPath),
      BEEGAME_NATIVE_BACKGROUND_PERMISSIONS: '1',
      BEEGAME_NATIVE_TOOL_RESULTS_DIR: toolResultsPath,
    },
  }
}
