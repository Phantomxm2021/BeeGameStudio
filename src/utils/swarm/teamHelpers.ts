import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'fs'
import { randomUUID } from 'node:crypto'
import { lockSync } from '../lockfile.js'
import { lstat, readFile, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod/v4'
import { getSessionCreatedTeams } from '../../bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getTeamsDir } from '../envUtils.js'
import { errorMessage, getErrnoCode } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { gitExe } from '../git.js'
import { lazySchema } from '../lazySchema.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getTasksDir, notifyTasksUpdated } from '../tasks.js'
import { getAgentName, getTeamName, isTeammate } from '../teammate.js'
import {
  type BackendType,
  type PaneCleanupMetadata,
  isPaneBackend,
} from './backends/types.js'
import { TEAM_LEAD_NAME } from './constants.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .enum(['spawnTeam', 'cleanup'])
      .describe(
        'Operation: spawnTeam to create a team, cleanup to remove team and task directories.',
      ),
    agent_type: z
      .string()
      .optional()
      .describe(
        'Type/role of the team lead (e.g., "researcher", "test-runner"). ' +
          'Used for team file and inter-agent coordination.',
      ),
    team_name: z
      .string()
      .optional()
      .describe('Name for the new team to create (required for spawnTeam).'),
    description: z
      .string()
      .optional()
      .describe('Team description/purpose (only used with spawnTeam).'),
  }),
)

// Output types for different operations
export type SpawnTeamOutput = {
  team_name: string
  team_file_path: string
  lead_agent_id: string
}

export type CleanupOutput = {
  success: boolean
  message: string
  team_name?: string
}

export type TeamAllowedPath = {
  path: string // Directory path (absolute)
  toolName: string // The tool this applies to (e.g., "Edit", "Write")
  addedBy: string // Agent name who added this rule
  addedAt: number // Timestamp when added
}

export type TeamFile = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId?: string // Actual session UUID of the leader (for discovery)
  hiddenPaneIds?: string[] // Pane IDs that are currently hidden from the UI
  teamAllowedPaths?: TeamAllowedPath[] // Paths all teammates can edit without asking
  members: Array<{
    agentId: string
    name: string
    agentType?: string
    model?: string
    prompt?: string
    color?: string
    planModeRequired?: boolean
    joinedAt: number
    tmuxPaneId: string
    cwd: string
    worktreePath?: string
    sessionId?: string
    subscriptions: string[]
    backendType?: BackendType
    paneCleanup?: PaneCleanupMetadata
    isActive?: boolean // false when idle, undefined/true when active
    mode?: PermissionMode // Current permission mode for this teammate
  }>
}

export type Input = z.infer<ReturnType<typeof inputSchema>>
// Export SpawnTeamOutput as Output for backward compatibility
export type Output = SpawnTeamOutput

/**
 * Sanitizes a name for use in tmux window names, worktree paths, and file paths.
 * Replaces all non-alphanumeric characters with hyphens and lowercases.
 */
export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
}

/**
 * Sanitizes an agent name for use in deterministic agent IDs.
 * Replaces @ with - to prevent ambiguity in the agentName@teamName format.
 */
export function sanitizeAgentName(name: string): string {
  return name.replace(/@/g, '-')
}

/**
 * Gets the path to a team's directory
 */
export function getTeamDir(teamName: string): string {
  return join(getTeamsDir(), sanitizeName(teamName))
}

/**
 * Gets the path to a team's config.json file
 */
export function getTeamFilePath(teamName: string): string {
  return join(getTeamDir(teamName), 'config.json')
}

/**
 * Reads a team file by name (sync — for sync contexts like React render paths)
 * @internal Exported for team discovery UI
 */
// sync IO: called from sync context
export function readTeamFile(teamName: string): TeamFile | null {
  try {
    const content = readFileSync(getTeamFilePath(teamName), 'utf-8')
    return jsonParse(content) as TeamFile
  } catch (e) {
    if (getErrnoCode(e) === 'ENOENT') return null
    logForDebugging(
      `[TeammateTool] Failed to read team file for ${teamName}: ${errorMessage(e)}`,
    )
    return null
  }
}

/**
 * Reads a team file by name (async — for tool handlers and other async contexts)
 */
export async function readTeamFileAsync(
  teamName: string,
): Promise<TeamFile | null> {
  try {
    const content = await readFile(getTeamFilePath(teamName), 'utf-8')
    return jsonParse(content) as TeamFile
  } catch (e) {
    if (getErrnoCode(e) === 'ENOENT') return null
    logForDebugging(
      `[TeammateTool] Failed to read team file for ${teamName}: ${errorMessage(e)}`,
    )
    return null
  }
}

/**
 * Writes a team file (sync — for sync contexts)
 */
// sync IO: called from sync context
function writeTeamFile(teamName: string, teamFile: TeamFile): void {
  const teamDir = getTeamDir(teamName)
  mkdirSync(teamDir, { recursive: true })
  const target = getTeamFilePath(teamName)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, jsonStringify(teamFile, null, 2), {
      mode: 0o600,
      flag: 'wx',
    })
    renameSync(temporary, target)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if (getErrnoCode(error) !== 'ENOENT') throw error
    }
  }
}

/** Keep the entire read/modify/atomic-write inside one cross-process lock.
 * No await is allowed inside: sync UI updates must share the same lock. */
function withTeamFileLock<T>(teamName: string, update: () => T): T {
  const directory = getTeamDir(teamName)
  mkdirSync(directory, { recursive: true })
  const release = lockSync(directory, {
    lockfilePath: join(directory, '.config.lock'),
  })
  try {
    return update()
  } finally {
    release()
  }
}

export async function mutateTeamFileAsync(
  teamName: string,
  update: (team: TeamFile) => void,
  missingIsNoop = false,
): Promise<void> {
  // Retry lock contention, not the mutation. Failures are never success.
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      withTeamFileLock(teamName, () => {
        const team = readTeamFile(teamName)
        if (!team) {
          if (missingIsNoop) return
          throw new Error(`Team "${teamName}" no longer exists`)
        }
        update(team)
        writeTeamFile(teamName, team)
      })
      return
    } catch (error) {
      if (getErrnoCode(error) !== 'ELOCKED' || Date.now() >= deadline)
        throw error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
}

/**
 * Writes a team file (async — for tool handlers)
 */
export async function writeTeamFileAsync(
  teamName: string,
  teamFile: TeamFile,
): Promise<void> {
  withTeamFileLock(teamName, () => writeTeamFile(teamName, teamFile))
}

/**
 * Removes a teammate from the team file by agent ID or name.
 * Used by the leader when processing shutdown approvals.
 */
export function removeTeammateFromTeamFile(
  teamName: string,
  identifier: { agentId?: string; name?: string },
): boolean {
  return withTeamFileLock(teamName, () => {
    const identifierStr = identifier.agentId || identifier.name
    if (!identifierStr) {
      logForDebugging(
        '[TeammateTool] removeTeammateFromTeamFile called with no identifier',
      )
      return false
    }

    const teamFile = readTeamFile(teamName)
    if (!teamFile) {
      logForDebugging(
        `[TeammateTool] Cannot remove teammate ${identifierStr}: failed to read team file for "${teamName}"`,
      )
      return false
    }

    const originalLength = teamFile.members.length
    teamFile.members = teamFile.members.filter(m => {
      if (identifier.agentId && m.agentId === identifier.agentId) return false
      if (identifier.name && m.name === identifier.name) return false
      return true
    })

    if (teamFile.members.length === originalLength) {
      logForDebugging(
        `[TeammateTool] Teammate ${identifierStr} not found in team file for "${teamName}"`,
      )
      return false
    }

    writeTeamFile(teamName, teamFile)
    logForDebugging(
      `[TeammateTool] Removed teammate from team file: ${identifierStr}`,
    )
    return true
  })
}

/**
 * Adds a pane ID to the hidden panes list in the team file.
 * @param teamName - The name of the team
 * @param paneId - The pane ID to hide
 * @returns true if the pane was added to hidden list, false if team doesn't exist
 */
export function addHiddenPaneId(teamName: string, paneId: string): boolean {
  return withTeamFileLock(teamName, () => {
    const teamFile = readTeamFile(teamName)
    if (!teamFile) {
      return false
    }

    const hiddenPaneIds = teamFile.hiddenPaneIds ?? []
    if (!hiddenPaneIds.includes(paneId)) {
      hiddenPaneIds.push(paneId)
      teamFile.hiddenPaneIds = hiddenPaneIds
      writeTeamFile(teamName, teamFile)
      logForDebugging(
        `[TeammateTool] Added ${paneId} to hidden panes for team ${teamName}`,
      )
    }
    return true
  })
}

/**
 * Removes a pane ID from the hidden panes list in the team file.
 * @param teamName - The name of the team
 * @param paneId - The pane ID to show (remove from hidden list)
 * @returns true if the pane was removed from hidden list, false if team doesn't exist
 */
export function removeHiddenPaneId(teamName: string, paneId: string): boolean {
  return withTeamFileLock(teamName, () => {
    const teamFile = readTeamFile(teamName)
    if (!teamFile) {
      return false
    }

    const hiddenPaneIds = teamFile.hiddenPaneIds ?? []
    const index = hiddenPaneIds.indexOf(paneId)
    if (index !== -1) {
      hiddenPaneIds.splice(index, 1)
      teamFile.hiddenPaneIds = hiddenPaneIds
      writeTeamFile(teamName, teamFile)
      logForDebugging(
        `[TeammateTool] Removed ${paneId} from hidden panes for team ${teamName}`,
      )
    }
    return true
  })
}

/**
 * Removes a teammate from the team config file by pane ID.
 * Also removes from hiddenPaneIds if present.
 * @param teamName - The name of the team
 * @param tmuxPaneId - The pane ID of the teammate to remove
 * @returns true if the member was removed, false if team or member doesn't exist
 */
export function removeMemberFromTeam(
  teamName: string,
  tmuxPaneId: string,
): boolean {
  return withTeamFileLock(teamName, () => {
    const teamFile = readTeamFile(teamName)
    if (!teamFile) {
      return false
    }

    const memberIndex = teamFile.members.findIndex(
      m => m.tmuxPaneId === tmuxPaneId,
    )
    if (memberIndex === -1) {
      return false
    }

    // Remove from members array
    teamFile.members.splice(memberIndex, 1)

    // Also remove from hiddenPaneIds if present
    if (teamFile.hiddenPaneIds) {
      const hiddenIndex = teamFile.hiddenPaneIds.indexOf(tmuxPaneId)
      if (hiddenIndex !== -1) {
        teamFile.hiddenPaneIds.splice(hiddenIndex, 1)
      }
    }

    writeTeamFile(teamName, teamFile)
    logForDebugging(
      `[TeammateTool] Removed member with pane ${tmuxPaneId} from team ${teamName}`,
    )
    return true
  })
}

/**
 * Removes a teammate from a team's member list by agent ID.
 * Use this for in-process teammates which all share the same tmuxPaneId.
 * @param teamName - The name of the team
 * @param agentId - The agent ID of the teammate to remove (e.g., "researcher@my-team")
 * @returns true if the member was removed, false if team or member doesn't exist
 */
export function removeMemberByAgentId(
  teamName: string,
  agentId: string,
): boolean {
  return withTeamFileLock(teamName, () => {
    const teamFile = readTeamFile(teamName)
    if (!teamFile) {
      return false
    }

    const memberIndex = teamFile.members.findIndex(m => m.agentId === agentId)
    if (memberIndex === -1) {
      return false
    }

    // Remove from members array
    teamFile.members.splice(memberIndex, 1)

    writeTeamFile(teamName, teamFile)
    logForDebugging(
      `[TeammateTool] Removed member ${agentId} from team ${teamName}`,
    )
    return true
  })
}

/**
 * Sets a team member's permission mode.
 * Called when the team leader changes a teammate's mode via the TeamsDialog.
 * @param teamName - The name of the team
 * @param memberName - The name of the member to update
 * @param mode - The new permission mode
 */
export function setMemberMode(
  teamName: string,
  memberName: string,
  mode: PermissionMode,
): boolean {
  return withTeamFileLock(teamName, () => {
    const teamFile = readTeamFile(teamName)
    if (!teamFile) {
      return false
    }

    const member = teamFile.members.find(m => m.name === memberName)
    if (!member) {
      logForDebugging(
        `[TeammateTool] Cannot set member mode: member ${memberName} not found in team ${teamName}`,
      )
      return false
    }

    // Only write if the value is actually changing
    if (member.mode === mode) {
      return true
    }

    // Create updated members array immutably
    const updatedMembers = teamFile.members.map(m =>
      m.name === memberName ? { ...m, mode } : m,
    )
    writeTeamFile(teamName, { ...teamFile, members: updatedMembers })
    logForDebugging(
      `[TeammateTool] Set member ${memberName} in team ${teamName} to mode: ${mode}`,
    )
    return true
  })
}

/**
 * Sync the current teammate's mode to config.json so team lead sees it.
 * No-op if not running as a teammate.
 * @param mode - The permission mode to sync
 * @param teamNameOverride - Optional team name override (uses env var if not provided)
 */
export function syncTeammateMode(
  mode: PermissionMode,
  teamNameOverride?: string,
): void {
  if (!isTeammate()) return
  const teamName = teamNameOverride ?? getTeamName()
  const agentName = getAgentName()
  if (teamName && agentName) {
    setMemberMode(teamName, agentName, mode)
  }
}

/**
 * Sets multiple team members' permission modes in a single atomic operation.
 * Avoids race conditions when updating multiple teammates at once.
 * @param teamName - The name of the team
 * @param modeUpdates - Array of {memberName, mode} to update
 */
export function setMultipleMemberModes(
  teamName: string,
  modeUpdates: Array<{ memberName: string; mode: PermissionMode }>,
): boolean {
  return withTeamFileLock(teamName, () => {
    const teamFile = readTeamFile(teamName)
    if (!teamFile) {
      return false
    }

    // Build a map of updates for efficient lookup
    const updateMap = new Map(modeUpdates.map(u => [u.memberName, u.mode]))

    // Create updated members array immutably
    let anyChanged = false
    const updatedMembers = teamFile.members.map(member => {
      const newMode = updateMap.get(member.name)
      if (newMode !== undefined && member.mode !== newMode) {
        anyChanged = true
        return { ...member, mode: newMode }
      }
      return member
    })

    if (anyChanged) {
      writeTeamFile(teamName, { ...teamFile, members: updatedMembers })
      logForDebugging(
        `[TeammateTool] Set ${modeUpdates.length} member modes in team ${teamName}`,
      )
    }
    return true
  })
}

/**
 * Sets a team member's active status.
 * Called when a teammate becomes idle (isActive=false) or starts a new turn (isActive=true).
 * @param teamName - The name of the team
 * @param memberName - The name of the member to update
 * @param isActive - Whether the member is active (true) or idle (false)
 */
export async function setMemberActive(
  teamName: string,
  memberName: string,
  isActive: boolean,
): Promise<void> {
  await mutateTeamFileAsync(
    teamName,
    teamFile => {
      const member = teamFile.members.find(m => m.name === memberName)
      if (!member) {
        logForDebugging(
          `[TeammateTool] Cannot set member active: member ${memberName} not found in team ${teamName}`,
        )
        return
      }

      // Only write if the value is actually changing
      if (member.isActive === isActive) {
        return
      }

      member.isActive = isActive
      logForDebugging(
        `[TeammateTool] Set member ${memberName} in team ${teamName} to ${isActive ? 'active' : 'idle'}`,
      )
    },
    true,
  )
}

/**
 * Destroys a git worktree at the given path.
 * Only Git may remove a registered, clean worktree. Never fall back to rm.
 * Safe to call on non-existent paths.
 */
async function destroyWorktree(worktreePath: string): Promise<void> {
  try {
    await lstat(worktreePath)
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') return
    throw error
  }
  // Read the .git file in the worktree to find the main repo
  const gitFilePath = join(worktreePath, '.git')
  let mainRepoPath: string | null = null

  try {
    const gitFileContent = (await readFile(gitFilePath, 'utf-8')).trim()
    // The .git file contains something like: gitdir: /path/to/repo/.git/worktrees/worktree-name
    const match = gitFileContent.match(/^gitdir:\s*(.+)$/)
    if (match && match[1]) {
      // Extract the main repo .git directory (go up from .git/worktrees/name to .git)
      const worktreeGitDir = resolve(worktreePath, match[1])
      // Go up 2 levels from .git/worktrees/name to get to .git, then get parent for repo root
      const mainGitDir = join(worktreeGitDir, '..', '..')
      mainRepoPath = join(mainGitDir, '..')
    }
  } catch {
    throw new Error(
      'Cannot verify teammate worktree; directory and team record retained',
    )
  }

  // Try to remove using git worktree remove command
  if (mainRepoPath) {
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      ['worktree', 'remove', '--', worktreePath],
      { cwd: mainRepoPath },
    )

    if (result.code === 0) {
      logForDebugging(
        `[TeammateTool] Removed worktree via git: ${worktreePath}`,
      )
      return
    }

    throw new Error(
      `Git could not remove teammate worktree; directory and team record retained. Resolve Git's refusal before retrying: ${result.stderr?.trim() || 'no diagnostic available'}`,
    )
  }

  throw new Error(
    'Cannot verify teammate worktree; directory and team record retained',
  )
}

/**
 * Mark a team as created this session so it gets cleaned up on exit.
 * Call this right after the initial writeTeamFile. TeamDelete should
 * call unregisterTeamForSessionCleanup to prevent double-cleanup.
 * Backing Set lives in bootstrap/state.ts so resetStateForTests()
 * clears it between tests (avoids the PR #17615 cross-shard leak class).
 */
export function registerTeamForSessionCleanup(teamName: string): void {
  getSessionCreatedTeams().add(teamName)
}

/**
 * Remove a team from session cleanup tracking (e.g., after explicit
 * TeamDelete — already cleaned, don't try again on shutdown).
 */
export function unregisterTeamForSessionCleanup(teamName: string): void {
  getSessionCreatedTeams().delete(teamName)
}

/**
 * Clean up all teams created this session that weren't explicitly deleted.
 * Registered with gracefulShutdown from init.ts.
 */
export async function cleanupSessionTeams(): Promise<void> {
  const sessionCreatedTeams = getSessionCreatedTeams()
  if (sessionCreatedTeams.size === 0) return
  const teams = Array.from(sessionCreatedTeams)
  logForDebugging(
    `cleanupSessionTeams: removing ${teams.length} orphan team dir(s): ${teams.join(', ')}`,
  )
  // Kill panes first — on SIGINT the teammate processes are still running;
  // deleting directories alone would orphan them in open tmux/iTerm2 panes.
  // cleanupTeamDirectories also closes idle panes for the TeamDelete entry.
  const results = await Promise.allSettled(
    teams.map(async name => {
      await cleanupTeamDirectories(name)
      sessionCreatedTeams.delete(name)
    }),
  )
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

/**
 * Best-effort kill of all pane-backed teammate panes for a team.
 * Called from cleanupSessionTeams on ungraceful leader exit (SIGINT/SIGTERM).
 * Dynamic imports avoid adding registry/detection to this module's static
 * dep graph — this only runs at shutdown, so the import cost is irrelevant.
 */
async function killOrphanedTeammatePanes(
  teamFile: TeamFile | null,
): Promise<void> {
  if (!teamFile) return

  const paneMembers = teamFile.members.filter(
    m =>
      m.name !== TEAM_LEAD_NAME &&
      m.tmuxPaneId &&
      m.backendType &&
      isPaneBackend(m.backendType),
  )
  if (paneMembers.length === 0) return

  const [{ ensureBackendsRegistered, closeTeammatePane }, { isInsideTmux }] =
    await Promise.all([
      import('./backends/registry.js'),
      import('./backends/detection.js'),
    ])
  await ensureBackendsRegistered()
  const useExternalSession = !(await isInsideTmux())

  const results = await Promise.allSettled(
    paneMembers.map(async m => {
      // filter above guarantees these; narrow for the type system
      if (!m.tmuxPaneId || !m.backendType || !isPaneBackend(m.backendType)) {
        return
      }
      const ok = await closeTeammatePane(
        m.backendType,
        m.tmuxPaneId,
        m.paneCleanup?.useExternalSession ?? useExternalSession,
        m.paneCleanup,
      )
      logForDebugging(
        `cleanupSessionTeams: killPane ${m.name} (${m.backendType} ${m.tmuxPaneId}) → ${ok}`,
      )
      if (!ok)
        throw new Error(
          'Orphan teammate pane cleanup incomplete; team files retained',
        )
    }),
  )
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

/**
 * Cleans up team and task directories for a given team name.
 * Also cleans up git worktrees created for teammates.
 * Called when a swarm session is terminated.
 */
export async function cleanupTeamDirectories(teamName: string): Promise<void> {
  const sanitizedName = sanitizeName(teamName)

  // Read team file to get worktree paths BEFORE deleting the team directory
  let teamFile: TeamFile | null = null
  try {
    teamFile = JSON.parse(
      await readFile(getTeamFilePath(teamName), 'utf-8'),
    ) as TeamFile
    if (!teamFile || !Array.isArray(teamFile.members))
      throw new Error('Invalid team metadata')
  } catch (error) {
    if (getErrnoCode(error) !== 'ENOENT') {
      throw new Error(
        'Cannot read team cleanup metadata; directories and retry ownership retained',
      )
    }
  }
  const worktreePaths: string[] = []
  if (teamFile) {
    for (const member of teamFile.members) {
      if (member.worktreePath) {
        worktreePaths.push(member.worktreePath)
      }
    }
  }

  // Idle is not exited. Every deletion entry must close remaining panes
  // through their owner before removing mailbox or cleanup metadata.
  await killOrphanedTeammatePanes(teamFile)

  // Clean up worktrees first
  for (const worktreePath of worktreePaths) {
    await destroyWorktree(worktreePath)
  }

  // Keep team metadata until all dependent cleanup succeeded, so failures
  // propagate and the same owner can retry.
  const tasksDir = getTasksDir(sanitizedName)
  await rm(tasksDir, { recursive: true, force: true })
  notifyTasksUpdated()
  const teamDir = getTeamDir(teamName)
  await rm(teamDir, { recursive: true, force: true })
  logForDebugging(`[TeammateTool] Cleaned up team directory: ${teamDir}`)
}
