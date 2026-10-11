import { getSessionId } from '../../../bootstrap/state.js'
import type { ToolUseContext } from '../../../Tool.js'
import { formatAgentId, parseAgentId } from '../../../utils/agentId.js'
import { quote } from '../../../utils/bash/shellQuote.js'
import { registerCleanup } from '../../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../../utils/debug.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import { writeToMailbox } from '../../../utils/teammateMailbox.js'
import {
  buildInheritedCliArgParts,
  buildInheritedEnvVars,
  getInheritedEnvVarAssignments,
  getTeammateCommandParts,
  writeInheritedFlagSettings,
  writeInheritedProviderEnvironment,
  writeInheritedAgentDefinition,
  removePanePrivateFiles,
} from '../spawnUtils.js'
import { assignTeammateColor } from '../teammateLayoutManager.js'
import { isInsideTmux } from './detection.js'
import type {
  BackendType,
  PaneBackend,
  TeammateExecutor,
  TeammateMessage,
  TeammateSpawnConfig,
  TeammateSpawnResult,
  PaneCleanupMetadata,
} from './types.js'

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function withoutCliOption(args: string[], option: string): string[] {
  const filtered: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === option) {
      i += 1
      continue
    }
    filtered.push(args[i]!)
  }
  return filtered
}

function buildPowerShellSpawnCommand(
  commandParts: string[],
  args: string[],
  cwd: string,
  environmentPath?: string,
): string {
  const envAssignments = getInheritedEnvVarAssignments().map(
    ([key, value]) => `$env:${key} = ${quotePowerShellString(value)}`,
  )
  // Share the runtime-aware command parts with POSIX; explicit executable
  // overrides must not be treated as source files.
  const invocation = `& ${commandParts.map(quotePowerShellString).join(' ')}`
  return [
    `Set-Location -LiteralPath ${quotePowerShellString(cwd)}`,
    ...envAssignments,
    ...(environmentPath ? [`. ${quotePowerShellString(environmentPath)}`] : []),
    `${invocation} ${args.map(quotePowerShellString).join(' ')}`,
  ].join('; ')
}

/**
 * PaneBackendExecutor adapts a PaneBackend to the TeammateExecutor interface.
 *
 * This allows pane-based backends (tmux, iTerm2) to be used through the same
 * TeammateExecutor abstraction as InProcessBackend, making getTeammateExecutor()
 * return a meaningful executor regardless of execution mode.
 *
 * The adapter handles:
 * - spawn(): Creates a pane and sends the Claude CLI command to it
 * - sendMessage(): Writes to the teammate's file-based mailbox
 * - terminate(): Sends a shutdown request via mailbox
 * - kill(): Kills the pane via the backend
 * - isActive(): Checks if the pane is still running
 */
export class PaneBackendExecutor implements TeammateExecutor {
  readonly type: BackendType

  private backend: PaneBackend
  private context: ToolUseContext | null = null

  /**
   * Track spawned teammates by agentId -> paneId mapping.
   * This allows us to find the pane for operations like kill/terminate.
   */
  private spawnedTeammates: Map<
    string,
    {
      paneId: string
      insideTmux: boolean
      settingsDirectory?: string
      inlineSettingsPath?: string
      cleanup?: PaneCleanupMetadata
      paneClosed?: boolean
      closing?: Promise<boolean>
    }
  >
  private cleanupRegistered = false
  private pendingSpawns = new Map<
    string,
    { cancelled: boolean; done: Promise<void>; finish: () => void }
  >()
  private shuttingDown = false

  constructor(backend: PaneBackend) {
    this.backend = backend
    this.type = backend.type
    this.spawnedTeammates = new Map()
  }

  /**
   * Sets the ToolUseContext for this executor.
   * Must be called before spawn() to provide access to AppState and permissions.
   */
  setContext(context: ToolUseContext): void {
    this.context = context
  }

  /**
   * Checks if the underlying pane backend is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable()
  }

  private registerPaneCleanup(): void {
    if (this.cleanupRegistered) return
    this.cleanupRegistered = true
    registerCleanup(async () => {
      this.shuttingDown = true
      for (const pending of this.pendingSpawns.values())
        pending.cancelled = true
      await Promise.all(
        [...this.pendingSpawns.values()].map(pending => pending.done),
      )
      const results = await Promise.allSettled(
        [...this.spawnedTeammates.keys()].map(async agentId => {
          if (!(await this.kill(agentId))) {
            throw new Error(
              `Pane cleanup failed for ${agentId}; tracking retained.`,
            )
          }
        }),
      )
      // Wait for every pane before reporting failure; one failed close must not
      // allow parent shutdown to abandon the other in-flight cleanups.
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    })
  }

  /**
   * Spawns a teammate in a new pane.
   *
   * Creates a pane via the backend, builds the CLI command with teammate
   * identity flags, and sends it to the pane.
   */
  async spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    const agentId = formatAgentId(config.name, config.teamName)
    if (this.shuttingDown)
      return {
        success: false,
        agentId,
        error: 'Pane executor is shutting down',
      }

    // A failed close must not be hidden by replacing its tracking record.
    if (this.spawnedTeammates.has(agentId) || this.pendingSpawns.has(agentId)) {
      return {
        success: false,
        agentId,
        error:
          'A pane is still tracked for this teammate; close it before spawning again.',
      }
    }

    if (!this.context) {
      logForDebugging(
        `[PaneBackendExecutor] spawn() called without context for ${config.name}`,
      )
      return {
        success: false,
        agentId,
        error:
          'PaneBackendExecutor not initialized. Call setContext() before spawn().',
      }
    }

    let finish!: () => void
    const pending = {
      cancelled: false,
      done: new Promise<void>(resolve => {
        finish = resolve
      }),
      finish: () => finish(),
    }
    this.pendingSpawns.set(agentId, pending)
    this.registerPaneCleanup()
    let createdPane:
      | {
          paneId: string
          insideTmux: boolean
          settingsDirectory?: string
          inlineSettingsPath?: string
          cleanup?: PaneCleanupMetadata
        }
      | undefined
    const checkCancelled = () => {
      if (pending.cancelled || this.shuttingDown)
        throw new Error('Teammate spawn cancelled before completion')
    }
    try {
      // Assign a unique color to this teammate
      const teammateColor = config.color ?? assignTeammateColor(agentId)

      const paneResult =
        config.useSplitPane === false &&
        this.backend.createTeammateWindowInSwarmView
          ? await this.backend.createTeammateWindowInSwarmView(
              config.name,
              teammateColor,
            )
          : await this.backend.createTeammatePaneInSwarmView(
              config.name,
              teammateColor,
            )
      const { paneId, isFirstTeammate } = paneResult

      // Check if we're inside tmux to determine how to send commands
      const insideTmux = paneResult.cleanup
        ? !paneResult.cleanup.useExternalSession
        : await isInsideTmux()
      createdPane = { paneId, insideTmux, cleanup: paneResult.cleanup }
      this.spawnedTeammates.set(agentId, createdPane)
      checkCancelled()

      // Enable pane border status on first teammate when inside tmux
      if (isFirstTeammate && insideTmux) {
        await this.backend.enablePaneBorderStatus()
      }

      // Build the command to spawn Claude Code with teammate identity
      const commandParts = getTeammateCommandParts()

      // Build teammate identity CLI args
      const teammateArgs = [
        '--agent-id',
        agentId,
        '--agent-name',
        config.name,
        '--team-name',
        config.teamName,
        '--agent-color',
        teammateColor,
        '--parent-session-id',
        config.parentSessionId || getSessionId(),
        ...(config.planModeRequired ? ['--plan-mode-required'] : []),
        ...(config.agentType ? ['--agent-type', config.agentType] : []),
      ]

      // Build CLI flags to propagate to teammate
      const appState = this.context.getAppState()
      let inheritedArgParts = buildInheritedCliArgParts({
        planModeRequired: config.planModeRequired,
        permissionMode: appState.toolPermissionContext.mode,
      })

      // If teammate has a custom model, add --model flag (or replace inherited one)
      if (config.model) {
        inheritedArgParts = withoutCliOption(inheritedArgParts, '--model')
        inheritedArgParts.push('--model', config.model)
      }

      const workingDir = config.cwd

      const providerSettings = await writeInheritedProviderEnvironment(
        this.type === 'windows-terminal',
      )
      if (providerSettings) {
        createdPane.settingsDirectory = providerSettings.directory
      }
      checkCancelled()
      const agentsPath = await writeInheritedAgentDefinition(
        providerSettings.directory,
        config.agentDefinition,
      )
      if (agentsPath) inheritedArgParts.push('--agents', `@${agentsPath}`)
      checkCancelled()
      const inlineSettingsPath = await writeInheritedFlagSettings()
      if (inlineSettingsPath) {
        createdPane.inlineSettingsPath = inlineSettingsPath
        inheritedArgParts = withoutCliOption(inheritedArgParts, '--settings')
        inheritedArgParts.push('--settings', inlineSettingsPath)
      }

      // Build environment variables to forward to teammate
      const envStr = buildInheritedEnvVars()

      const allArgs = [...teammateArgs, ...inheritedArgParts]
      const spawnCommand =
        this.type === 'windows-terminal'
          ? buildPowerShellSpawnCommand(
              commandParts,
              allArgs,
              workingDir,
              providerSettings?.path,
            )
          : `cd ${quote([workingDir])} && ${providerSettings ? `. ${quote([providerSettings.path])} && ` : ''}env ${envStr} ${quote(commandParts)} ${quote(allArgs)}`

      // Send the command to the new pane
      // Use swarm socket when running outside tmux (external swarm session)
      await this.backend.sendCommandToPane(paneId, spawnCommand, !insideTmux)
      createdPane.cleanup = {
        ...createdPane.cleanup,
        ...this.backend.getPaneCleanupMetadata?.(paneId),
        useExternalSession: !insideTmux,
        environmentDirectory: createdPane.settingsDirectory,
        inlineSettingsPath: createdPane.inlineSettingsPath,
        agentsPath,
      }
      checkCancelled()

      // Send initial instructions to teammate via mailbox
      await writeToMailbox(
        config.name,
        {
          from: 'team-lead',
          text: config.prompt,
          timestamp: new Date().toISOString(),
        },
        config.teamName,
      )
      checkCancelled()

      logForDebugging(
        `[PaneBackendExecutor] Spawned teammate ${agentId} in pane ${paneId}`,
      )

      return {
        success: true,
        agentId,
        paneId,
        backendType: this.type,
        color: teammateColor,
        insideTmux,
        paneCleanup: createdPane.cleanup,
        windowName:
          'windowName' in paneResult
            ? (paneResult as { windowName: string }).windowName
            : undefined,
        isSplitPane: config.useSplitPane !== false,
      }
    } catch (error) {
      let cleanupFailed = false
      try {
        if (createdPane && !(await this.closeSpawnedPane(agentId)))
          cleanupFailed = true
      } catch {
        cleanupFailed = true
      }
      const errorMessage =
        (error instanceof Error ? error.message : String(error)) +
        (cleanupFailed ? '; pane or private-environment cleanup failed' : '')
      logForDebugging(
        `[PaneBackendExecutor] Failed to spawn ${agentId}: ${errorMessage}`,
      )
      return {
        success: false,
        agentId,
        error: errorMessage,
      }
    } finally {
      this.pendingSpawns.delete(agentId)
      pending.finish()
    }
  }

  /**
   * Sends a message to a pane-based teammate via file-based mailbox.
   *
   * All teammates (pane and in-process) use the same mailbox mechanism.
   */
  async sendMessage(agentId: string, message: TeammateMessage): Promise<void> {
    logForDebugging(
      `[PaneBackendExecutor] sendMessage() to ${agentId}: ${message.text.substring(0, 50)}...`,
    )

    const parsed = parseAgentId(agentId)
    if (!parsed) {
      throw new Error(
        `Invalid agentId format: ${agentId}. Expected format: agentName@teamName`,
      )
    }

    const { agentName, teamName } = parsed

    await writeToMailbox(
      agentName,
      {
        text: message.text,
        from: message.from,
        color: message.color,
        timestamp: message.timestamp ?? new Date().toISOString(),
      },
      teamName,
    )

    logForDebugging(
      `[PaneBackendExecutor] sendMessage() completed for ${agentId}`,
    )
  }

  /**
   * Gracefully terminates a pane-based teammate.
   *
   * For pane-based teammates, we send a shutdown request via mailbox and
   * let the teammate process handle exit gracefully.
   */
  async terminate(agentId: string, reason?: string): Promise<boolean> {
    logForDebugging(
      `[PaneBackendExecutor] terminate() called for ${agentId}: ${reason}`,
    )

    const parsed = parseAgentId(agentId)
    if (!parsed) {
      logForDebugging(
        `[PaneBackendExecutor] terminate() failed: invalid agentId format`,
      )
      return false
    }

    const { agentName, teamName } = parsed

    // Send shutdown request via mailbox
    const shutdownRequest = {
      type: 'shutdown_request',
      requestId: `shutdown-${agentId}-${Date.now()}`,
      from: 'team-lead',
      reason,
    }

    await writeToMailbox(
      agentName,
      {
        from: 'team-lead',
        text: jsonStringify(shutdownRequest),
        timestamp: new Date().toISOString(),
      },
      teamName,
    )

    logForDebugging(
      `[PaneBackendExecutor] terminate() sent shutdown request to ${agentId}`,
    )

    return true
  }

  /**
   * Force kills a pane-based teammate by killing its pane.
   */
  async kill(agentId: string): Promise<boolean> {
    const pending = this.pendingSpawns.get(agentId)
    if (pending) {
      pending.cancelled = true
      await pending.done
      if (!this.spawnedTeammates.has(agentId)) return true
    }
    return this.closeSpawnedPane(agentId)
  }

  private async closeSpawnedPane(agentId: string): Promise<boolean> {
    logForDebugging(`[PaneBackendExecutor] kill() called for ${agentId}`)

    const teammateInfo = this.spawnedTeammates.get(agentId)
    if (!teammateInfo) {
      logForDebugging(
        `[PaneBackendExecutor] kill() failed: teammate ${agentId} not found in spawned map`,
      )
      return false
    }

    const { paneId, insideTmux } = teammateInfo

    if (teammateInfo.closing) return teammateInfo.closing
    const closing = (async () => {
      // Once closed, retries only remove the private file. Do not kill a stale
      // pane identifier again just because the first file removal failed.
      const killed =
        teammateInfo.paneClosed ||
        (await this.backend.killPane(paneId, !insideTmux, teammateInfo.cleanup))

      if (killed) {
        teammateInfo.paneClosed = true
        await removePanePrivateFiles({
          environmentDirectory: teammateInfo.settingsDirectory,
          inlineSettingsPath: teammateInfo.inlineSettingsPath,
        })
        this.spawnedTeammates.delete(agentId)
        logForDebugging(`[PaneBackendExecutor] kill() succeeded for ${agentId}`)
      } else {
        logForDebugging(`[PaneBackendExecutor] kill() failed for ${agentId}`)
      }

      return killed
    })()
    teammateInfo.closing = closing
    try {
      return await closing
    } finally {
      delete teammateInfo.closing
    }
  }

  /**
   * Checks if a pane-based teammate is still active.
   *
   * For pane-based teammates, we check if the pane still exists.
   * This is a best-effort check - the pane may exist but the process inside
   * may have exited.
   */
  async isActive(agentId: string): Promise<boolean> {
    logForDebugging(`[PaneBackendExecutor] isActive() called for ${agentId}`)

    const teammateInfo = this.spawnedTeammates.get(agentId)
    if (!teammateInfo) {
      logForDebugging(
        `[PaneBackendExecutor] isActive(): teammate ${agentId} not found`,
      )
      return false
    }

    // For now, assume active if we have a record of it
    // A more robust check would query the backend for pane existence
    // but that would require adding a new method to PaneBackend
    return !teammateInfo.paneClosed
  }

  /** Close a tracked pane without losing its private-file cleanup ownership. */
  async killPane(
    paneId: string,
    useExternalSession: boolean,
  ): Promise<boolean | undefined> {
    const matches = [...this.spawnedTeammates].filter(
      ([, info]) => info.paneId === paneId,
    )
    const entry =
      matches.length === 1
        ? matches[0]
        : matches.find(([, info]) => !info.insideTmux === useExternalSession)
    return entry ? this.kill(entry[0]) : undefined
  }
}

/**
 * Creates a PaneBackendExecutor wrapping the given PaneBackend.
 */
export function createPaneBackendExecutor(
  backend: PaneBackend,
): PaneBackendExecutor {
  return new PaneBackendExecutor(backend)
}
