import { mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { DEFAULT_LOCAL_USER_ID } from './auth/user-context'
import { getDefaultWorkspacePath } from './filesystem/default-workspace'

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
  return resolve(
    defaultWorkspacePath?.trim() ||
      process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      resolve(process.cwd(), 'Projects'),
  )
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
  if (!hasWorkspaceBoundary(defaultWorkspacePath)) {
    return resolvedWorkspace
  }
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
  const projectSegment = normalizeProjectDirName(
    options.projectName || options.projectId || 'beegame-project',
  )
  const workspacePath = join(userRoot, projectSegment)
  await mkdir(workspacePath, { recursive: true })
  return resolve(workspacePath)
}

export async function assertSessionWorkspaceIsProjectDirectory(
  workspacePath: string,
  defaultWorkspacePath?: string,
): Promise<void> {
  if (!hasWorkspaceBoundary(defaultWorkspacePath)) return
  const defaultWorkspace = resolve(
    await getDefaultWorkspacePath({ defaultWorkspacePath }),
  )
  const resolvedWorkspace = resolve(workspacePath)
  if (resolvedWorkspace !== defaultWorkspace) return
  throw new Error(
    `Workspace path must target a project directory under the default Projects directory, not the Projects root: ${defaultWorkspace}`,
  )
}

export function hasWorkspaceBoundary(defaultWorkspacePath?: string): boolean {
  return Boolean(
    process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      defaultWorkspacePath?.trim(),
  )
}

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

function canonicalizeWorkspaceCandidate(
  candidate: string,
  canonicalRoot: string,
  defaultWorkspacePath?: string,
): string {
  if (isInsideOrEqual(candidate, canonicalRoot)) return candidate
  const configuredRoot = resolve(
    defaultWorkspacePath?.trim() ||
      process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      resolve(process.cwd(), 'Projects'),
  )
  const rel = relative(configuredRoot, candidate)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolve(canonicalRoot, rel)
  }
  return candidate
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
