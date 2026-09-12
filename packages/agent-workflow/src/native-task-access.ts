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

/** Execution permissions, not an agent/tool-selection policy. The native CLI
 * exposes its normal tools. File effects stay in the task workspace, shell
 * effects are enforced by the native OS sandbox, and delegates inherit both. */
export async function createNativeTaskAccess(input: NativeTaskAccessInput) {
  const root = await realpath(input.workspacePath)
  const temporaryPath = resolve(root, '.native-tmp')
  await mkdir(temporaryPath, { recursive: true, mode: 0o700 })
  if (await realpath(temporaryPath) !== temporaryPath) throw new Error('Invalid native task temporary directory')
  const protectedPaths = [...(input.readOnlyPaths ?? []), '.claude', '.git']
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

  async function permission(request: Record<string, any>): Promise<Record<string, any> | undefined> {
    const name = request.tool_name
    const args = request.input
    if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
    if (name === 'Bash') {
      if (typeof args.command !== 'string' || !args.command.trim()) return undefined
      // Never grant the SDK's escape hatch. CLI startup fails if the configured
      // sandbox cannot start, and native execution enforces the same restriction.
      return { ...args, dangerouslyDisableSandbox: false }
    }
    if (name === 'Agent') {
      // Delegation is available, but cannot elevate the child's permission mode.
      return { ...args, mode: 'default' }
    }
    const fileKey = name === 'NotebookEdit' ? 'notebook_path' : name === 'LSP' ? 'filePath'
      : ['Read', 'Edit', 'Write'].includes(name) ? 'file_path'
        : ['Glob', 'Grep'].includes(name) ? 'path' : undefined
    if (!fileKey) return undefined // A new privileged effect needs execution-layer authorization.
    if (fileKey !== 'path' && typeof args[fileKey] !== 'string') return undefined
    if (args[fileKey] !== undefined && typeof args[fileKey] !== 'string') return undefined
    const path = resolve(root, args[fileKey] ?? '.')
    if (!within(root, path)) return undefined
    if (name === 'Glob' && (typeof args.pattern !== 'string' || isAbsolute(args.pattern) ||
        args.pattern.split(/[\\/]/).includes('..'))) return undefined
    const writing = ['Write', 'Edit', 'NotebookEdit'].includes(name)
    if (writing && (protectedPaths.some(protectedPath => within(protectedPath, path)) ||
        (!input.allowWorkingFiles && !writable.includes(path)))) return undefined
    if (!await canonicalPath(path, name === 'Write')) return undefined
    return { ...args, [fileKey]: path }
  }

  return {
    root, settings, permission,
    flags: ['--permission-mode', 'default', '--setting-sources', '', '--strict-mcp-config',
      '--settings', JSON.stringify(settings)],
    // Shell/MCP/LSP children do not need the parent model's credentials.
    environment: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', CLAUDE_CODE_TMPDIR: temporaryPath },
  }
}
