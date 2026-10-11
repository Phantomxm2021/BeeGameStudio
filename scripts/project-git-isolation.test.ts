import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getMacroDefines } from './defines'
import { projectExecutionAccess } from '../packages/agent-workflow-server/src/beegame/project-execution-access'

Object.assign(globalThis, { MACRO: Object.fromEntries(Object.entries(getMacroDefines())
  .map(([key, value]) => [key.replace('MACRO.', ''), JSON.parse(value)])) })

test.skipIf(process.platform !== 'darwin')('implicit CLI Git queries cannot execute repository config outside the project sandbox', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'implicit-git-')))
  const workspace = join(root, 'game')
  await mkdir(workspace)
  await writeFile(join(root, 'private.txt'), 'PRIVATE_HOST_FIXTURE')
  const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'git-test', environment: {} })
  const oldEnv = { ...process.env }
  const oldCwd = process.cwd()
  Object.assign(process.env, access.environment, { BEEGAME_CONFIG_DIR: join(root, 'config'),
    BGS_SUBPROCESS_ENV_SCRUB: '1', ANTHROPIC_API_KEY: 'PRIVATE_MODEL_FIXTURE' })
  process.chdir(workspace)
  const state = await import('../src/bootstrap/state')
  const { resetSettingsCache } = await import('../src/utils/settings/settingsCache')
  const { SandboxManager, convertToSandboxRuntimeConfig } = await import('../src/utils/sandbox/sandbox-adapter')
  const { execFileNoThrowWithCwd } = await import('../src/utils/execFileNoThrow')
  state.setOriginalCwd(workspace)
  state.setCwdState(workspace)
  state.setFlagSettingsInline(access.settings)
  resetSettingsCache()
  try {
    const converted = convertToSandboxRuntimeConfig({ ...access.settings,
      permissions: { additionalDirectories: [root] },
      sandbox: { ...access.settings.sandbox, filesystem: { allowRead: ['/'], allowWrite: ['/'] } } })
    expect(converted.filesystem.allowRead).toEqual(access.settings.sandbox.filesystem.allowRead)
    expect(converted.filesystem.allowWrite).toEqual([workspace])
    expect(SandboxManager.areUnsandboxedCommandsAllowed()).toBe(false)
    expect(SandboxManager.getExcludedCommands()).toEqual([])
    await SandboxManager.initialize(async () => true)
    const git = (args: string[]) => execFileNoThrowWithCwd('git', args, { cwd: workspace, timeout: 5000 })
    const initialized = await git(['init', '-q'])
    expect(initialized.code, initialized.stderr).toBe(0)
    const probe = `#!/bin/sh\nprintf ran > probe-ran\ncat ../private.txt > leaked-file 2>/dev/null\nprintf '%s' "$ANTHROPIC_API_KEY" > leaked-env\nprintf '\\0'\n`
    await writeFile(join(workspace, 'monitor.sh'), probe, { mode: 0o700 })
    expect((await git(['config', 'core.fsmonitor', './monitor.sh'])).code).toBe(0)
    await git(['status', '--porcelain'])
    expect(await readFile(join(workspace, 'probe-ran'), 'utf8')).toBe('ran')
    expect(await readFile(join(workspace, 'leaked-file'), 'utf8')).toBe('')
    expect(await readFile(join(workspace, 'leaked-env'), 'utf8')).toBe('')
    expect(await readFile(join(root, 'private.txt'), 'utf8')).toBe('PRIVATE_HOST_FIXTURE')
  } finally {
    await SandboxManager.reset()
    state.setFlagSettingsInline(null)
    state.setOriginalCwd(oldCwd)
    state.setCwdState(oldCwd)
    process.chdir(oldCwd)
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
    resetSettingsCache()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
