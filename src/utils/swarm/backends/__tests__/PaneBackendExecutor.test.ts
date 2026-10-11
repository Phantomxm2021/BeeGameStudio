import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaneBackendExecutor } from '../PaneBackendExecutor'
import type { PaneBackend } from '../types'
import { getInheritedProviderEnvironment, writeInheritedProviderEnvironment, writeInheritedFlagSettings, buildInheritedCliArgParts, getInheritedEnvVarAssignments, getTeammateCommandParts } from '../../spawnUtils'
import { quote } from '../../../bash/shellQuote'
import { tryParseShellCommand } from '../../../bash/shellQuote'
import { getFlagSettingsInline, setFlagSettingsInline, getFlagSettingsPath, setFlagSettingsPath, getOriginalCwd, setOriginalCwd } from '../../../../bootstrap/state'
import { resetSettingsCache } from '../../../settings/settingsCache'
import { getSettingsRootPathForSource } from '../../../settings/settings'
import { runCleanupFunctions } from '../../../cleanupRegistry'

let tempHome: string
let previousConfigDir: string | undefined
let previousProviderEnvironment: Map<string, string | undefined>
let previousInlineSettings: Record<string, unknown> | null

function commandEnvironmentPath(command: string): string {
  const parsed = tryParseShellCommand(command)
  if (!parsed.success) throw new Error('Synthetic pane command did not parse')
  const index = parsed.tokens.indexOf('.')
  const path = parsed.tokens[index + 1]
  if (index < 0 || typeof path !== 'string') throw new Error('No private environment path')
  return path
}

function readEnvironment(path: string, keys: string[]): Record<string, string> {
  // Source the actual generated shell file in a clean subprocess. Values are
  // synthetic; no provider request or teammate process is started.
  const result = Bun.spawnSync([
    '/bin/sh', '-c', '. "$1" && exec "$2" -e "$3"', 'fixture', path, process.execPath,
    `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, process.env[k]]))))`,
  ], { env: { PATH: process.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' })
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout.toString())
}

beforeEach(() => {
  const providerKeys = new Set([
    ...Object.keys(getInheritedProviderEnvironment()),
    'BGS_USE_OPENAI', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_DEFAULT_SONNET_MODEL',
    'HTTPS_PROXY', 'XAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID', 'AWS_PROFILE',
    'BGS_API_UNIX_SOCKET', 'CLAUDE_CODE_OAUTH_TOKEN',
  ])
  previousProviderEnvironment = new Map([...providerKeys].map(key => [key, process.env[key]]))
  for (const key of providerKeys) delete process.env[key]
  previousInlineSettings = getFlagSettingsInline()
  setFlagSettingsInline(null)
  resetSettingsCache()
  previousConfigDir = process.env.BEEGAME_CONFIG_DIR
  tempHome = join(
    tmpdir(),
    `pane-backend-executor-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.BEEGAME_CONFIG_DIR = tempHome
})

afterEach(() => {
  for (const [key, value] of previousProviderEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  setFlagSettingsInline(previousInlineSettings)
  resetSettingsCache()
  if (previousConfigDir === undefined) {
    delete process.env.BEEGAME_CONFIG_DIR
  } else {
    process.env.BEEGAME_CONFIG_DIR = previousConfigDir
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('PaneBackendExecutor', () => {
  test('spawns process teammates with agent type and inherited auto permission mode', async () => {
    process.env.BGS_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://fixture.invalid/v1?api_key=private-url-fixture'
    process.env.OPENAI_API_KEY = 'private-pane-fixture'
    process.env.OPENAI_DEFAULT_SONNET_MODEL = 'fixture-balanced-model'
    process.env.HTTPS_PROXY = 'http://fixture-user:fixture-password@proxy.invalid:8080'
    process.env.XAI_API_KEY = 'fixture-xai-secret'
    process.env.OPENAI_ORG_ID = 'fixture-org'
    process.env.OPENAI_PROJECT_ID = 'fixture-project'
    process.env.AWS_PROFILE = 'fixture-profile'
    let sentCommand = ''
    const backend: PaneBackend = {
      type: 'tmux',
      displayName: 'tmux',
      supportsHideShow: true,
      async isAvailable() {
        return true
      },
      async isRunningInside() {
        return false
      },
      async createTeammatePaneInSwarmView() {
        return { paneId: '%1', isFirstTeammate: false }
      },
      async sendCommandToPane(_paneId, command) {
        sentCommand = command
      },
      async setPaneBorderColor() {},
      async setPaneTitle() {},
      async enablePaneBorderStatus() {},
      async rebalancePanes() {},
      async killPane() {
        return true
      },
      async hidePane() {
        return true
      },
      async showPane() {
        return true
      },
    }

    const executor = createPaneBackendExecutor(backend)
    executor.setContext({
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'auto',
        },
      }),
    } as any)

    const result = await executor.spawn({
      name: 'reviewer',
      teamName: 'alpha',
      prompt: 'review the change',
      cwd: tempHome,
      parentSessionId: 'parent-session',
      agentType: 'code-reviewer',
      planModeRequired: false,
    })

    expect(result.success).toBe(true)
    expect(result.backendType).toBe('tmux')
    expect(result.paneId).toBe('%1')
    expect(sentCommand).toContain('--agent-type code-reviewer')
    expect(sentCommand).toContain('--permission-mode auto')
    expect(sentCommand).not.toContain('private-pane-fixture')
    expect(sentCommand).not.toContain('private-url-fixture')
    expect(sentCommand).not.toContain('fixture-password')
    expect(sentCommand).not.toContain('fixture-xai-secret')
    const path = commandEnvironmentPath(sentCommand)
    const saved = readEnvironment(path, [
      'BGS_USE_OPENAI', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_DEFAULT_SONNET_MODEL',
      'HTTPS_PROXY', 'XAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID', 'AWS_PROFILE',
    ])
    expect(saved).toMatchObject({
      BGS_USE_OPENAI: '1',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_API_KEY: 'private-pane-fixture',
      OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced-model',
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      XAI_API_KEY: 'fixture-xai-secret',
      OPENAI_ORG_ID: 'fixture-org',
      OPENAI_PROJECT_ID: 'fixture-project',
      AWS_PROFILE: 'fixture-profile',
    })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(await executor.kill(result.agentId)).toBe(true)
    expect(existsSync(path)).toBe(false)

    // No native process is started: the synthetic backend only records commands.
    backend.sendCommandToPane = async (_pane, command) => {
      sentCommand = command
      throw new Error('synthetic send failure')
    }
    const failed = await executor.spawn({
      name: 'failed-worker', teamName: 'alpha', prompt: 'synthetic',
      cwd: tempHome, parentSessionId: 'parent-session',
    })
    expect(failed.success).toBe(false)
    expect(existsSync(commandEnvironmentPath(sentCommand))).toBe(false)

    backend.killPane = async () => { throw new Error('synthetic cleanup failure') }
    const cleanupFailed = await executor.spawn({
      name: 'cleanup-failed-worker', teamName: 'alpha', prompt: 'synthetic',
      cwd: tempHome, parentSessionId: 'parent-session',
    })
    expect(cleanupFailed.success).toBe(false)
    expect(cleanupFailed.error).toContain('cleanup failed')
    expect(existsSync(commandEnvironmentPath(sentCommand))).toBe(true)
    expect(await executor.isActive(cleanupFailed.agentId)).toBe(true)
    const duplicate = await executor.spawn({
      name: 'cleanup-failed-worker', teamName: 'alpha', prompt: 'synthetic',
      cwd: tempHome, parentSessionId: 'parent-session',
    })
    expect(duplicate.success).toBe(false)
    expect(duplicate.error).toContain('still tracked')

    backend.killPane = async () => true
    expect(await executor.kill(cleanupFailed.agentId)).toBe(true)
    expect(existsSync(commandEnvironmentPath(sentCommand))).toBe(false)
    expect(await executor.isActive(cleanupFailed.agentId)).toBe(false)
    backend.sendCommandToPane = async (_pane, command) => { sentCommand = command }
    const parentExit = await executor.spawn({
      name: 'parent-exit-worker', teamName: 'alpha', prompt: 'synthetic',
      cwd: tempHome, parentSessionId: 'parent-session',
    })
    expect(parentExit.success).toBe(true)
    const exitPath = commandEnvironmentPath(sentCommand)
    expect(existsSync(exitPath)).toBe(true)
    backend.createTeammatePaneInSwarmView = async () => ({ paneId: '%2', isFirstTeammate: false })
    const otherExit = await executor.spawn({
      name: 'other-exit-worker', teamName: 'alpha', prompt: 'synthetic',
      cwd: tempHome, parentSessionId: 'parent-session',
    })
    expect(otherExit.success).toBe(true)
    const otherPath = commandEnvironmentPath(sentCommand)
    backend.killPane = async paneId => {
      if (paneId === '%1') return false
      await new Promise(resolve => setTimeout(resolve, 5))
      return true
    }
    await expect(runCleanupFunctions()).rejects.toThrow('Pane cleanup failed')
    expect(await executor.isActive(otherExit.agentId)).toBe(false)
    expect(existsSync(otherPath)).toBe(false)
    expect(await executor.isActive(parentExit.agentId)).toBe(true)
    expect(existsSync(exitPath)).toBe(true)
    backend.killPane = async () => { throw new Error('synthetic parent cleanup failure') }
    await expect(runCleanupFunctions()).rejects.toThrow('synthetic parent cleanup failure')
    expect(await executor.isActive(parentExit.agentId)).toBe(true)
    expect(existsSync(exitPath)).toBe(true)
    backend.killPane = async () => true
    await runCleanupFunctions()
    expect(existsSync(exitPath)).toBe(false)
    expect(await executor.isActive(parentExit.agentId)).toBe(false)

    // Exercise the PowerShell command builder without starting Windows or a process.
    const windowsExecutor = createPaneBackendExecutor({ ...backend, type: 'windows-terminal' })
    windowsExecutor.setContext({
      getAppState: () => ({ toolPermissionContext: { mode: 'auto' } }),
    } as any)
    const windowsResult = await windowsExecutor.spawn({
      name: 'windows-worker', teamName: 'alpha', prompt: 'synthetic',
      cwd: tempHome, parentSessionId: 'parent-session',
    })
    expect(windowsResult.success).toBe(true)
    expect(sentCommand).toContain('Set-Location -LiteralPath')
    expect(sentCommand).not.toContain('fixture-password')
    expect(sentCommand).not.toContain('fixture-xai-secret')
    const windowsPath = sentCommand.match(/\. '([^']+environment\.ps1)'/)?.[1]
    expect(windowsPath).toBeDefined()
    expect(readFileSync(windowsPath!, 'utf8').charCodeAt(0)).toBe(0xfeff)
    expect(readFileSync(windowsPath!, 'utf8')).toContain(`$env:HTTPS_PROXY = '${process.env.HTTPS_PROXY}'`)
    expect(await windowsExecutor.kill(windowsResult.agentId)).toBe(true)
    expect(existsSync(windowsPath!)).toBe(false)
  })

  test('environment handoff preserves native settings origin, empty values and SSH auth', async () => {
    process.env.BGS_USE_OPENAI = '0'
    process.env.OPENAI_BASE_URL = ''
    process.env.BGS_API_UNIX_SOCKET = '/fixture/socket'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "ssh-'fixture;$(exit 9)\nsecond-line"
    setFlagSettingsInline({
      modelType: 'openai', permissions: { deny: ['Bash(rm:*)'] },
      env: { CLAUDE_CODE_SIMPLE: '0' },
    })
    resetSettingsCache()
    const previousFlagPath = getFlagSettingsPath()
    setFlagSettingsPath(join(tempHome, 'config', 'settings.json'))
    const root = getSettingsRootPathForSource('flagSettings')
    const snapshot = await writeInheritedProviderEnvironment()
    expect(snapshot).toBeDefined()
    try {
      const environment = readEnvironment(snapshot!.path, [
        'BGS_USE_OPENAI', 'OPENAI_BASE_URL', 'BGS_API_UNIX_SOCKET', 'CLAUDE_CODE_OAUTH_TOKEN',
      ])
      expect(environment.BGS_USE_OPENAI).toBe('0')
      expect(environment.OPENAI_BASE_URL).toBe('')
      // Transport and its OAuth placeholder travel through the private file.
      expect(getInheritedProviderEnvironment().BGS_API_UNIX_SOCKET).toBe('/fixture/socket')
      expect(getInheritedEnvVarAssignments()).not.toContainEqual(['BGS_API_UNIX_SOCKET', '/fixture/socket'])
      expect(environment.CLAUDE_CODE_OAUTH_TOKEN).toBe(process.env.CLAUDE_CODE_OAUTH_TOKEN)
      expect(statSync(snapshot!.directory).mode & 0o777).toBe(0o700)
      expect(getSettingsRootPathForSource('flagSettings')).toBe(root)
      expect(root).toBe(join(tempHome, 'config'))
      const args = buildInheritedCliArgParts({ permissionMode: 'default' })
      expect(args[args.indexOf('--settings') + 1]).toBe(getFlagSettingsPath()!)
      // Do not clone settings or turn security policy into a temporary file.
      expect(readFileSync(snapshot!.path, 'utf8')).not.toContain('permissions')
      expect(getFlagSettingsInline()?.permissions).toEqual({ deny: ['Bash(rm:*)'] })
    } finally {
      setFlagSettingsPath(previousFlagPath)
      resetSettingsCache()
      rmSync(snapshot!.directory, { recursive: true, force: true })
    }
  })

  test('pane routing shares concurrent close and retries file cleanup without another kill', async () => {
    let kills = 0
    const executor = createPaneBackendExecutor({
      type: 'tmux',
      async killPane() { kills += 1; await Promise.resolve(); return true },
    } as unknown as PaneBackend)
    // Synthetic tracking: no terminal is created. Invalid path forces a real
    // file-removal error without changing filesystem permissions.
    const tracked = { paneId: '%fixture', insideTmux: false, settingsDirectory: 'invalid\0fixture' }
    ;(executor as any).spawnedTeammates.set('fixture@alpha', tracked)
    const results = await Promise.allSettled([
      executor.killPane('%fixture', true), executor.kill('fixture@alpha'),
    ])
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(kills).toBe(1)
    expect(await executor.isActive('fixture@alpha')).toBe(false)
    tracked.settingsDirectory = (await writeInheritedProviderEnvironment()).directory
    expect(await executor.killPane('%fixture', true)).toBe(true)
    expect(kills).toBe(1)
    expect(await executor.killPane('%fixture', true)).toBeUndefined()
  })

  test('private environment loading hides secrets with xtrace/verbose and restores shell flags', async () => {
    process.env.OPENAI_API_KEY = 'synthetic-trace-secret'
    const environment = await writeInheritedProviderEnvironment()
    expect(environment).toBeDefined()
    try {
      const result = Bun.spawnSync(['/bin/sh', '-xv', '-c',
        '. "$1"; case $- in *x*) echo trace-restored ;; esac; case $- in *v*) echo verbose-restored ;; esac; set +x +v; test "$OPENAI_API_KEY" = "$2"',
        'fixture', environment!.path, 'synthetic-trace-secret',
      ], { env: { PATH: process.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' })
      expect(result.exitCode).toBe(0)
      expect(result.stderr.toString()).not.toContain('synthetic-trace-secret')
      expect(result.stdout.toString()).toContain('trace-restored')
      expect(result.stdout.toString()).toContain('verbose-restored')
    } finally {
      rmSync(environment!.directory, { recursive: true, force: true })
    }
  })

  test('only explicit inline flag settings are snapshotted at their original root and cleaned after close', async () => {
    const previousPath = getFlagSettingsPath()
    const originalCwd = getOriginalCwd()
    const root = join(tempHome, 'config')
    mkdirSync(root, { recursive: true })
    const originalPath = join(root, 'settings.json')
    writeFileSync(originalPath, JSON.stringify({ permissions: { allow: ['Read(./source/**)'] } }))
    setFlagSettingsPath(originalPath)
    let command = ''
    const backend = {
      type: 'tmux',
      async createTeammatePaneInSwarmView() { return { paneId: '%inline', isFirstTeammate: false } },
      async sendCommandToPane(_id: string, value: string) { command = value },
      async killPane() { return true },
    } as unknown as PaneBackend
    const executor = createPaneBackendExecutor(backend)
    executor.setContext({ getAppState: () => ({ toolPermissionContext: { mode: 'default' } }) } as any)
    try {
      expect(await writeInheritedFlagSettings()).toBeUndefined()
      setFlagSettingsInline({ modelType: 'invalid-fixture' })
      resetSettingsCache()
      await expect(writeInheritedFlagSettings()).rejects.toThrow('invalid inline settings')
      setFlagSettingsInline({ modelType: 'openai', permissions: { deny: ['Bash(rm:*)'] }, env: { OPENAI_API_KEY: 'private-inline-key' } })
      resetSettingsCache()
      const result = await executor.spawn({ name: 'inline', teamName: 'alpha', prompt: 'synthetic', cwd: tempHome, parentSessionId: 'parent' })
      expect(result.success).toBe(true)
      const parsed = tryParseShellCommand(command)
      if (!parsed.success) throw new Error('Fixture command failed to parse')
      const path = parsed.tokens[parsed.tokens.indexOf('--settings') + 1] as string
      expect(path.startsWith(root + '/')).toBe(true)
      const saved = JSON.parse(readFileSync(path, 'utf8'))
      expect(saved.modelType).toBe('openai')
      expect(saved.permissions).toEqual({ allow: ['Read(./source/**)'], deny: ['Bash(rm:*)'] })
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(command).not.toContain('private-inline-key')
      // Parent origin and original file are untouched.
      expect(getFlagSettingsPath()).toBe(originalPath)
      expect(getSettingsRootPathForSource('flagSettings')).toBe(root)
      expect(JSON.parse(readFileSync(originalPath, 'utf8'))).not.toHaveProperty('modelType')
      expect(await executor.kill(result.agentId)).toBe(true)
      expect(existsSync(path)).toBe(false)
      setFlagSettingsPath(undefined)
      setOriginalCwd(tempHome)
      resetSettingsCache()
      const inlineOnly = await writeInheritedFlagSettings()
      expect(inlineOnly!.startsWith(tempHome + '/')).toBe(true)
      expect(JSON.parse(readFileSync(inlineOnly!, 'utf8')).modelType).toBe('openai')
      rmSync(inlineOnly!)
    } finally {
      setOriginalCwd(originalCwd)
      setFlagSettingsPath(previousPath)
      setFlagSettingsInline(null)
      resetSettingsCache()
    }
  })

  test('concurrent same-agent spawns create one pane and POSIX dev launch uses the runtime', async () => {
    let creates = 0
    let command = ''
    const backend = {
      type: 'tmux',
      async createTeammatePaneInSwarmView() { creates++; await Promise.resolve(); return { paneId: '%concurrent', isFirstTeammate: false } },
      async sendCommandToPane(_id: string, value: string) { command = value },
      async killPane() { return true },
    } as unknown as PaneBackend
    const executor = createPaneBackendExecutor(backend)
    executor.setContext({ getAppState: () => ({ toolPermissionContext: { mode: 'default' } }) } as any)
    const config = { name: 'concurrent', teamName: 'alpha', prompt: 'synthetic', cwd: tempHome, parentSessionId: 'parent' }
    const results = await Promise.all([executor.spawn(config), executor.spawn(config)])
    expect(creates).toBe(1)
    expect(results.filter(r => r.success)).toHaveLength(1)
    expect(command).toContain(quote(getTeammateCommandParts()))
    expect(getTeammateCommandParts()[0]).toBe(process.execPath)
    expect(await executor.kill(results[0]!.agentId)).toBe(true)
  })

  test('preserves legacy separate-window spawning when useSplitPane is false', async () => {
    let paneSpawned = false
    let windowSpawned = false
    const backend: PaneBackend = {
      type: 'tmux',
      displayName: 'tmux',
      supportsHideShow: true,
      async isAvailable() {
        return true
      },
      async isRunningInside() {
        return false
      },
      async createTeammatePaneInSwarmView() {
        paneSpawned = true
        return { paneId: '%pane', isFirstTeammate: false }
      },
      async createTeammateWindowInSwarmView() {
        windowSpawned = true
        return {
          paneId: '%window',
          windowName: 'teammate-worker',
          isFirstTeammate: false,
        }
      },
      async sendCommandToPane() {},
      async setPaneBorderColor() {},
      async setPaneTitle() {},
      async enablePaneBorderStatus() {},
      async rebalancePanes() {},
      async killPane() {
        return true
      },
      async hidePane() {
        return true
      },
      async showPane() {
        return true
      },
    }

    const executor = createPaneBackendExecutor(backend)
    executor.setContext({
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'default',
        },
      }),
    } as any)

    const result = await executor.spawn({
      name: 'worker',
      teamName: 'alpha',
      prompt: 'do work',
      cwd: tempHome,
      parentSessionId: 'parent-session',
      useSplitPane: false,
    })

    expect(result.success).toBe(true)
    expect(paneSpawned).toBe(false)
    expect(windowSpawned).toBe(true)
    expect(result.paneId).toBe('%window')
    expect(result.windowName).toBe('teammate-worker')
    expect(result.isSplitPane).toBe(false)
    expect(await executor.kill(result.agentId)).toBe(true)
  })
})
