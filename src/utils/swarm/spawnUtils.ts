/**
 * Shared utilities for spawning teammates across different backends.
 */

import {
  getChromeFlagOverride,
  getFlagSettingsPath,
  getFlagSettingsInline,
  getInlinePlugins,
  getMainLoopModelOverride,
  getSessionBypassPermissionsMode,
  getAllowedSettingSources,
} from '../../bootstrap/state.js'
import { quote } from '../bash/shellQuote.js'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CustomAgentDefinition } from '@bee-game-studio/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  normalizeRuntimeEnvironment,
  RUNTIME_ENV_ALIASES,
} from '../runtimeEnvironment.js'
import {
  isProviderManagedEnvVar,
  getProviderManagedEnvVarNames,
  PROVIDER_CONNECTION_ENV_VARS,
} from '../managedEnvConstants.js'
import { isInBundledMode } from '../bundledMode.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getTeammateModeFromSnapshot } from './backends/teammateModeSnapshot.js'
import { TEAMMATE_COMMAND_ENV_VAR } from './constants.js'

/**
 * Gets the command to use for spawning teammate processes.
 * Uses TEAMMATE_COMMAND_ENV_VAR if set, otherwise falls back to the
 * current process executable path.
 */
export function getTeammateCommand(): string {
  if (process.env[TEAMMATE_COMMAND_ENV_VAR]) {
    return process.env[TEAMMATE_COMMAND_ENV_VAR]
  }
  return isInBundledMode() ? process.execPath : process.argv[1]!
}

export function getTeammateCommandParts(): string[] {
  const command = getTeammateCommand()
  return process.env[TEAMMATE_COMMAND_ENV_VAR] || isInBundledMode()
    ? [command]
    : [process.execPath, ...getInheritedRuntimeArgs(process.execArgv), command]
}

/** Keep runtime defines/features, not debugger ports or eval/loader commands. */
export function getInheritedRuntimeArgs(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (
      ['-d', '--define', '--feature'].includes(arg) &&
      args[i + 1] !== undefined
    ) {
      result.push(arg, args[++i]!)
    } else if (/^(?:--define|--feature)=/.test(arg)) {
      result.push(arg)
    }
  }
  return result
}

/** Only snapshot explicit flag settings, never the whole merged configuration.
 * Keep the file in the original flag root so relative permission/hook paths
 * retain their meaning. Credentials must not be placed on command lines. */
export async function writeInheritedFlagSettings(): Promise<
  string | undefined
> {
  const inline = getFlagSettingsInline()
  if (!inline || Object.keys(inline).length === 0) return undefined
  const { getSettingsForSource, getSettingsRootPathForSource } = await import(
    '../settings/settings.js'
  )
  const { SettingsSchema } = await import('../settings/types.js')
  if (!SettingsSchema().safeParse(inline).success) {
    throw new Error(
      'Cannot inherit invalid inline settings; fix the explicit configuration before spawning',
    )
  }
  const path = join(
    getSettingsRootPathForSource('flagSettings'),
    `.bgs-pane-settings-${randomUUID()}.json`,
  )
  try {
    await writeFile(
      path,
      JSON.stringify(getSettingsForSource('flagSettings')),
      { mode: 0o600, flag: 'wx' },
    )
    return path
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      await rm(path, { force: true })
    throw error
  }
}

/**
 * Builds CLI flags to propagate from the current session to spawned teammates.
 * This ensures teammates inherit important settings like permission mode,
 * model selection, and plugin configuration from their parent.
 *
 * @param options.planModeRequired - If true, don't inherit bypass permissions (plan mode takes precedence)
 * @param options.permissionMode - Permission mode to propagate
 */
export function buildInheritedCliFlags(options?: {
  planModeRequired?: boolean
  permissionMode?: PermissionMode
}): string {
  return quote(buildInheritedCliArgParts(options))
}

export function buildInheritedCliArgParts(options?: {
  planModeRequired?: boolean
  permissionMode?: PermissionMode
}): string[] {
  const flags: string[] = []
  const { planModeRequired, permissionMode } = options || {}
  flags.push(
    '--setting-sources',
    getAllowedSettingSources()
      .flatMap(source =>
        source === 'userSettings'
          ? ['user']
          : source === 'projectSettings'
            ? ['project']
            : source === 'localSettings'
              ? ['local']
              : [],
      )
      .join(','),
  )

  // Propagate permission mode to teammates, but NOT if plan mode is required
  // Plan mode takes precedence over bypass permissions for safety
  if (planModeRequired) {
    // Don't inherit bypass permissions when plan mode is required
  } else if (
    permissionMode === 'bypassPermissions' ||
    getSessionBypassPermissionsMode()
  ) {
    flags.push('--dangerously-skip-permissions')
  } else if (permissionMode === 'acceptEdits') {
    flags.push('--permission-mode', 'acceptEdits')
  } else if (permissionMode === 'auto') {
    // Teammates inherit auto mode so the classifier evaluates their tool calls too.
    flags.push('--permission-mode', 'auto')
  }

  // Propagate --model if explicitly set via CLI
  const modelOverride = getMainLoopModelOverride()
  if (modelOverride) {
    flags.push('--model', modelOverride)
  }

  // Propagate --settings if set via CLI
  const settingsPath = getFlagSettingsPath()
  if (settingsPath) {
    flags.push('--settings', settingsPath)
  }

  // Propagate --plugin-dir for each inline plugin
  const inlinePlugins = getInlinePlugins()
  for (const pluginDir of inlinePlugins) {
    flags.push('--plugin-dir', pluginDir)
  }

  // Propagate --teammate-mode so tmux teammates use the same mode as leader
  const sessionMode = getTeammateModeFromSnapshot()
  flags.push('--teammate-mode', sessionMode)

  // Propagate --chrome / --no-chrome if explicitly set on the CLI
  const chromeFlagOverride = getChromeFlagOverride()
  if (chromeFlagOverride === true) {
    flags.push('--chrome')
  } else if (chromeFlagOverride === false) {
    flags.push('--no-chrome')
  }

  return flags
}

/**
 * Environment variables that must be explicitly forwarded to tmux-spawned
 * teammates. Tmux may start a new login shell that doesn't inherit the
 * parent's env, so we forward any that are set in the current process.
 */
const TEAMMATE_ENV_VARS = [
  // Non-routing product switches must survive fresh login shells.
  // These names do not include API credentials.
  ...Object.values(RUNTIME_ENV_ALIASES).filter(
    key => !isProviderManagedEnvVar(key),
  ),
  // Config directory override
  'BEEGAME_CONFIG_DIR',
  // CCR marker — teammates need this for CCR-aware code paths. Auth finds
  // its own way via /home/claude/.claude/remote/.oauth_token regardless;
  // the FD env var wouldn't help (pipe FDs don't cross tmux).
  'CLAUDE_CODE_REMOTE',
  // Auto-memory gate (memdir/paths.ts) checks REMOTE && !MEMORY_DIR to
  // disable memory on ephemeral CCR filesystems. Forwarding REMOTE alone
  // would flip teammates to memory-off when the parent has it on.
  'CLAUDE_CODE_REMOTE_MEMORY_DIR',
  // TLS certificate paths contain no credentials. Proxy URLs go in the private environment file.
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
] as const

/**
 * Builds the `env KEY=VALUE ...` string for teammate spawn commands.
 * Always includes CLAUDECODE=1 and CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1,
 * plus any provider/config env vars that are set in the current process.
 */
export function buildInheritedEnvVars(): string {
  return getInheritedEnvVarAssignments()
    .map(([key, value]) => `${key}=${quote([value])}`)
    .join(' ')
}

export function getInheritedEnvVarAssignments(): Array<[string, string]> {
  const environment = normalizeRuntimeEnvironment(process.env)
  const envVars: Array<[string, string]> = [
    ['CLAUDECODE', '1'],
    ['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', '1'],
  ]

  for (const key of TEAMMATE_ENV_VARS) {
    const value = environment[key]
    if (value !== undefined) {
      envVars.push([key, value])
    }
  }

  return envVars
}

// SDK credentials and connection settings not covered by the model-slot list.
const PROVIDER_SDK_ENV_KEYS = new Set<string>(PROVIDER_CONNECTION_ENV_VARS)

export function getInheritedProviderEnvironment(): Record<string, string> {
  const environment = normalizeRuntimeEnvironment(process.env)
  // Read known SDK keys directly: Bun can expose proxy values without enumerating them.
  for (const key of PROVIDER_SDK_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) =>
        value !== undefined &&
        (isProviderManagedEnvVar(key) || PROVIDER_SDK_ENV_KEYS.has(key)),
    ),
  ) as Record<string, string>
}

/** Private shell environment handoff. Do not relocate native settings: their
 * location determines permission roots, and settings filters strip SSH auth. */
export async function writeInheritedProviderEnvironment(
  powershell = false,
): Promise<{ directory: string; path: string }> {
  const environment = getInheritedProviderEnvironment()
  // A login shell may carry a provider that is absent in the parent. Clear its
  // fixed routing names and old aliases before restoring this session's route.
  const clearedKeys = [
    ...new Set([
      ...getProviderManagedEnvVarNames(),
      ...Object.keys(RUNTIME_ENV_ALIASES).filter(key =>
        isProviderManagedEnvVar(RUNTIME_ENV_ALIASES[key]!),
      ),
      ...Object.keys(environment),
    ]),
  ]
  const directory = await mkdtemp(join(tmpdir(), 'bgs-pane-runtime-'))
  try {
    await chmod(directory, 0o700)
    const path = join(
      directory,
      powershell ? 'environment.ps1' : 'environment.sh',
    )
    const lines = Object.entries(environment).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        throw new Error('Invalid inherited environment variable name')
      return powershell
        ? `$env:${key} = '${value.replace(/'/g, "''")}'`
        : `export ${key}=${quote([value])}`
    })
    // Windows PowerShell 5.1 needs a BOM to read non-ASCII UTF-8 reliably.
    // A tmux shell may have tracing enabled by its rc file. Disable it before
    // exporting secrets, then restore the caller's trace flag after loading.
    const script = powershell
      ? '\uFEFF' +
        clearedKeys
          .map(
            key =>
              `Remove-Item -LiteralPath 'Env:${key}' -ErrorAction SilentlyContinue`,
          )
          .concat(lines)
          .join('\n') +
        '\n'
      : [
          '__bgs_pane_trace_flags=$-; set +x +v',
          `unset ${clearedKeys.join(' ')}`,
          ...lines,
          'case "$__bgs_pane_trace_flags" in *v*) set -v ;; esac',
          'case "$__bgs_pane_trace_flags" in *x*) set -x ;; esac',
          'unset __bgs_pane_trace_flags',
          '',
        ].join('\n')
    await writeFile(path, script, { mode: 0o600, flag: 'wx' })
    return { directory, path }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

/** Inline CLI definitions exist only in the parent's memory. Forward the
 * selected definition privately; ordinary disk/plugin agents reload natively. */
export async function writeInheritedAgentDefinition(
  directory: string,
  agent?: CustomAgentDefinition,
): Promise<string | undefined> {
  if (!agent || agent.source !== 'flagSettings') return undefined
  const {
    agentType,
    whenToUse,
    getSystemPrompt,
    source,
    baseDir,
    filename,
    pendingSnapshotUpdate,
    ...options
  } = agent
  const path = join(directory, 'agents.json')
  await writeFile(
    path,
    JSON.stringify({
      [agentType]: {
        ...options,
        description: whenToUse,
        prompt: getSystemPrompt(),
      },
    }),
    { mode: 0o600, flag: 'wx' },
  )
  return path
}

/** Remove only private files created by pane handoff, never arbitrary roots. */
export async function removePanePrivateFiles(cleanup: {
  environmentDirectory?: string
  inlineSettingsPath?: string
}): Promise<void> {
  if (cleanup.environmentDirectory) {
    const { basename, dirname, resolve } = await import('node:path')
    const path = resolve(cleanup.environmentDirectory)
    if (
      dirname(path) !== resolve(tmpdir()) ||
      !/^bgs-pane-runtime-[A-Za-z0-9]+$/.test(basename(path))
    ) {
      throw new Error(
        'Unrecognized private pane environment path; cleanup retained',
      )
    }
    await rm(path, { recursive: true, force: true })
  }
  if (cleanup.inlineSettingsPath) {
    const { basename } = await import('node:path')
    if (
      !/^\.bgs-pane-settings-[0-9a-f-]{36}\.json$/.test(
        basename(cleanup.inlineSettingsPath),
      )
    ) {
      throw new Error(
        'Unrecognized private pane settings path; cleanup retained',
      )
    }
    await rm(cleanup.inlineSettingsPath, { force: true })
  }
}
