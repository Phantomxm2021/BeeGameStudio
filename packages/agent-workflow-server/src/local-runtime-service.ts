import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { DEFAULT_LOCAL_USER_ID } from './auth/user-context'
import { getDefaultWorkspacePath } from './filesystem/default-workspace'
import { assertWorkspacePath } from './filesystem/workspace-path'

export async function deleteWorkspaceDirectoryIfSafe(
  workspacePath: string,
  dashboardDataRoot: string,
): Promise<string | undefined> {
  const dataRoot = await realpath(resolve(dashboardDataRoot))
  const resolvedWorkspace = resolve(workspacePath)
  let workspaceRoot: string
  try {
    workspaceRoot = await realpath(resolvedWorkspace)
  } catch (err) {
    if (isNodeErrorCode(err, 'ENOENT')) {
      if (resolvedWorkspace === dataRoot) return undefined
      const rel = relative(dataRoot, resolvedWorkspace)
      if (rel.startsWith('..') || isAbsolute(rel)) return undefined
      return undefined
    }
    throw err
  }
  if (workspaceRoot === dataRoot) return undefined
  const rel = relative(dataRoot, workspaceRoot)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  await rm(workspaceRoot, { recursive: true, force: true })
  return workspaceRoot
}

export function getDashboardDataRoot(defaultWorkspacePath?: string): string {
  return resolveConfiguredWorkspaceRoot(defaultWorkspacePath)
}

export function getUserDashboardDataRoot(
  dashboardDataRoot: string,
  userId: string,
): string {
  const normalizedUserId = normalizeUserDataDirName(userId)
  if (!normalizedUserId || normalizedUserId === DEFAULT_LOCAL_USER_ID) {
    return dashboardDataRoot
  }
  return join(dashboardDataRoot, 'users', normalizedUserId)
}

export async function resolveSessionWorkspacePath(
  workspacePath: string,
  defaultWorkspacePath?: string,
): Promise<string> {
  const trimmed = workspacePath.trim()
  if (!isAbsolute(trimmed)) {
    throw new Error('Workspace path must be absolute')
  }
  const resolvedWorkspace = resolve(trimmed)
  const defaultWorkspace = resolve(
    await getDefaultWorkspacePath({ defaultWorkspacePath }),
  )
  const canonicalWorkspace = canonicalizeWorkspaceCandidate(
    resolvedWorkspace,
    defaultWorkspace,
    defaultWorkspacePath,
  )
  if (!isInsideOrEqual(canonicalWorkspace, defaultWorkspace)) {
    throw new Error(
      `Workspace path must stay inside the default Projects directory: ${defaultWorkspace}`,
    )
  }
  assertWorkspacePath(defaultWorkspace, canonicalWorkspace)
  return canonicalWorkspace
}

export async function createManagedProjectWorkspacePath(
  options: {
    defaultWorkspacePath?: string
    userId: string
    projectName?: string
    projectId?: string
  },
): Promise<string> {
  const defaultWorkspace = resolve(
    await getDefaultWorkspacePath({
      defaultWorkspacePath: options.defaultWorkspacePath,
    }),
  )
  const userRoot = getUserDashboardDataRoot(defaultWorkspace, options.userId)
  const projectSegment = createManagedProjectSegment(
    options.projectName,
    options.projectId,
  )
  const workspacePath = join(userRoot, projectSegment)
  assertWorkspacePath(defaultWorkspace, workspacePath)
  await mkdir(workspacePath, { recursive: true })
  assertWorkspacePath(defaultWorkspace, workspacePath)
  return resolve(workspacePath)
}

const execGit = promisify(execFile)

/** Initialize only the project root; an ancestor repository is not this project.
 * Existing repositories/worktrees retain their history, configuration and index. */
export async function initializeProjectRepository(
  workspacePath: string,
  options: { createIfMissing?: boolean; engine?: unknown } = {},
): Promise<void> {
  const root = await realpath(workspacePath)
  // A service may itself run under Git tooling. Its repository overrides must
  // not redirect a new project's initialization or repository checks.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  const git = (args: string[]) => execGit('git', ['-C', root, ...args], {
    env, timeout: 10_000, maxBuffer: 64 * 1024,
  })
  let existing = true
  try {
    if ((await lstat(join(root, '.git'))).isSymbolicLink())
      throw new Error('Project Git metadata must not be a symbolic link')
  }
  catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error
    existing = false
  }
  if (!existing && options.createIfMissing === false) return
  if (!existing) await git(['init', '--template=', '--initial-branch=main'])
  const { stdout } = await git(['rev-parse', '--show-toplevel'])
  if (await realpath(stdout.trim()) !== root)
    throw new Error('Project Git repository must be rooted in the project directory')
  // Linked worktrees share info/exclude: only common rules belong there.
  // Engine rules stay in each worktree, before its custom overrides.
  const { stdout: excludePath } = await git(['rev-parse', '--git-path', 'info/exclude'])
  const exclude = resolve(root, excludePath.trim())
  const info = dirname(exclude)
  await mkdir(info, { recursive: true })
  if ((await lstat(info)).isSymbolicLink())
    throw new Error('Project Git info directory must not be a symbolic link')
  await updateProjectGitIgnore(exclude, undefined)
  await updateProjectGitIgnore(join(root, '.gitignore'), options.engine)
}

const COMMON_GIT_IGNORES = [
  '/.beegame/chat/', '/.beegame/tmp/', '/.beegame/artifacts/', '/.runtime/',
  '/logs/index.json', '/logs/runtime-diagnostics.jsonl*', '/transcripts/',
  'node_modules/', '.DS_Store', '.env', '.env.*',
  '!.env.example', '!.env.sample', '!.env.template',
]
// Root-scoped engine caches must not hide similarly named asset folders.
// Keep Unity .meta/Packages/ProjectSettings, Godot .uid/*.import/export presets,
// and Unreal Build/Content/Config/Source and binary-only plugins versionable.
const ENGINE_GIT_IGNORES = {
  React: ['/dist/', '.vite/', '.cache/', '*.tsbuildinfo'],
  Unity: ['/[Ll]ibrary/', '/[Tt]emp/', '/[Oo]bj/', '/[Ll]ogs/', '/[Uu]ser[Ss]ettings/', '/.vs/'],
  Godot: ['/.godot/', '/.import/', '/.mono/'],
  Unreal: ['/Intermediate/', '/Saved/', '/DerivedDataCache/', '/.vs/', '/Plugins/*/Intermediate/'],
} as const

async function updateProjectGitIgnore(path: string, engine: unknown): Promise<void> {
  const file = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o644)
  try {
    const previous = await file.readFile('utf8')
    const bom = previous.startsWith('\uFEFF') ? '\uFEFF' : ''
    // Only replace BGS-owned text. An edited legacy template is custom text.
    const custom = previous.slice(bom.length)
      .replace(/^# BEGIN BGS managed ignores\r?\n[\s\S]*?^# END BGS managed ignores(?:\r?\n|$)/gm, '')
      .replaceAll(LEGACY_PROJECT_GIT_IGNORE, '')
      .replaceAll(LEGACY_PROJECT_GIT_IGNORE.replaceAll('\n', '\r\n'), '')
    const knownEngine = typeof engine === 'string' && Object.hasOwn(ENGINE_GIT_IGNORES, engine)
      ? engine as keyof typeof ENGINE_GIT_IGNORES : undefined
    const next = bom + [
      '# BEGIN BGS managed ignores',
      '# Generated from project settings; put custom rules and overrides below this block.',
      ...COMMON_GIT_IGNORES,
      ...(knownEngine ? ['# Engine: ' + knownEngine, ...ENGINE_GIT_IGNORES[knownEngine]] : []),
      '# END BGS managed ignores', '',
    ].join('\n') + custom
    if (next !== previous) {
      // Positional writes keep the file's permissions and never follow a link.
      const bytes = Buffer.from(next)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, offset)
        if (!bytesWritten) throw new Error('Could not write project Git ignore rules')
        offset += bytesWritten
      }
      await file.truncate(bytes.length)
    }
  } finally { await file.close() }
}

// Exact previous BGS template, retained only to migrate owned rules without
// accumulating stale Web exclusions when the selected engine changes.
const LEGACY_PROJECT_GIT_IGNORE = `# BGS: runtime records, dependencies and generated output
/.beegame/chat/
/.beegame/tmp/
/.beegame/artifacts/
/.runtime/
/logs/
node_modules/
/dist/
.vite/
.cache/
*.tsbuildinfo
.DS_Store
.env
.env.*
!.env.example
!.env.sample
!.env.template
`


function normalizeUserDataDirName(userId: string): string {
  return userId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function normalizeProjectDirName(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || 'beegame-project'
}

function createManagedProjectSegment(
  projectName?: string,
  projectId?: string,
): string {
  const normalizedProjectId = projectId?.trim()
  if (!normalizedProjectId) {
    return normalizeProjectDirName(projectName || 'beegame-project')
  }

  const suffix = createHash('sha256')
    .update(normalizedProjectId)
    .digest('hex')
    .slice(0, 12)
  const separator = '--'
  const maxNameLength = 80 - separator.length - suffix.length
  const name = normalizeProjectDirName(projectName || normalizedProjectId)
    .slice(0, maxNameLength)
    .replace(/[-_.]+$/g, '') || 'beegame-project'
  return `${name}${separator}${suffix}`
}

function canonicalizeWorkspaceCandidate(
  candidate: string,
  canonicalRoot: string,
  defaultWorkspacePath?: string,
): string {
  if (isInsideOrEqual(candidate, canonicalRoot)) return candidate
  const configuredRoot = resolveConfiguredWorkspaceRoot(defaultWorkspacePath)
  const rel = relative(configuredRoot, candidate)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolve(canonicalRoot, rel)
  }
  return candidate
}

function resolveConfiguredWorkspaceRoot(defaultWorkspacePath?: string): string {
  const configured =
    defaultWorkspacePath?.trim() ||
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim()
  if (!configured) {
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH is required')
  }
  if (!isAbsolute(configured)) {
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH must be absolute')
  }
  return resolve(configured)
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === code,
  )
}
