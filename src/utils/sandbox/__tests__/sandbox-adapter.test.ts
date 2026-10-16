import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Isolate settings and compile-time features without mocking the cleanup code.
const suiteRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-cleanup-test-')))
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
const previousBgsConfigDir = process.env.BEEGAME_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = join(suiteRoot, 'settings')
process.env.BEEGAME_CONFIG_DIR = join(suiteRoot, 'settings')
mock.module('bun:bundle', () => ({ feature: () => false }))
const { getOriginalCwd, getCwdState, setOriginalCwd, setCwdState } = await import('../../../bootstrap/state.js')
const { SandboxManager, convertToSandboxRuntimeConfig } = await import('../sandbox-adapter.js')
const originalCwd = getOriginalCwd()
const currentCwd = getCwdState()
const metadata = ['HEAD', 'objects', 'refs', 'hooks', 'config']
let root: string

beforeEach(() => {
  root = mkdtempSync(join(suiteRoot, 'project-'))
  setOriginalCwd(root)
  setCwdState(root)
})
afterEach(async () => {
  await SandboxManager.reset()
  setOriginalCwd(originalCwd)
  setCwdState(currentCwd)
})
afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  if (previousBgsConfigDir === undefined) delete process.env.BEEGAME_CONFIG_DIR
  else process.env.BEEGAME_CONFIG_DIR = previousBgsConfigDir
  rmSync(suiteRoot, { recursive: true, force: true })
})

function configure() {
  return convertToSandboxRuntimeConfig({ sandbox: { enabled: true }, permissions: {} }).filesystem.denyWrite
}
function writeBusinessDirectories() {
  for (const name of metadata.filter(name => name !== 'HEAD')) {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(join(root, name, 'game-config.json'), '{"offline":true}\n')
  }
}
function expectBusinessDirectories() {
  for (const name of metadata.filter(name => name !== 'HEAD')) {
    expect(readFileSync(join(root, name, 'game-config.json'), 'utf8')).toBe('{"offline":true}\n')
  }
}

for (const existing of [false, true]) {
  test(`business directories ${existing ? 'present at initialization' : 'created after initialization'} remain writable and survive cleanup`, () => {
    if (existing) writeBusinessDirectories()
    const denyWrite = configure()
    for (const name of metadata) expect(denyWrite).not.toContain(join(root, name))
    if (!existing) writeBusinessDirectories()
    // Reproduce the original write -> read-only command -> cleanup sequence.
    const command = Bun.spawnSync(['/bin/ls', '-a', root])
    expect(command.exitCode).toBe(0)
    expect(command.stdout.toString()).toContain('config')
    SandboxManager.cleanupAfterCommand()
    SandboxManager.cleanupAfterCommand()
    expectBusinessDirectories()
  })
}

test('a planted bare repository loses its HEAD before unsandboxed Git runs', () => {
  configure()
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CEILING_DIRECTORIES: suiteRoot }
  const git = (...args: string[]) => Bun.spawnSync(['git', '-C', root, ...args], { env: gitEnv })
  expect(git('init', '--bare').exitCode).toBe(0)
  expect(git('rev-parse', '--is-bare-repository').stdout.toString().trim()).toBe('true')
  // Preserve all data, including unrelated objects/refs/hooks directory contents.
  for (const name of ['objects', 'refs', 'hooks']) writeFileSync(join(root, name, 'keep.txt'), 'keep')
  SandboxManager.cleanupAfterCommand()
  expect(existsSync(join(root, 'HEAD'))).toBe(false)
  expect(git('rev-parse', '--git-dir').exitCode).not.toBe(0)
  for (const name of ['objects', 'refs', 'hooks']) expect(readFileSync(join(root, name, 'keep.txt'), 'utf8')).toBe('keep')
  expect(existsSync(join(root, 'config'))).toBe(true)
})

for (const target of ['file', 'directory', 'missing']) {
  test(`a planted HEAD symlink to a ${target} is unlinked without following its target`, () => {
    configure()
    const destination = join(suiteRoot, `target-${target}`)
    if (target === 'directory') mkdirSync(destination)
    if (target === 'file') writeFileSync(destination, 'keep')
    symlinkSync(destination, join(root, 'HEAD'))
    SandboxManager.cleanupAfterCommand()
    expect(() => lstatSync(join(root, 'HEAD'))).toThrow()
    if (target === 'directory') expect(lstatSync(destination).isDirectory()).toBe(true)
    if (target === 'file') expect(readFileSync(destination, 'utf8')).toBe('keep')
    if (target === 'missing') expect(existsSync(destination)).toBe(false)
  })
}

test('a directory named HEAD is preserved and cannot be replaced after configuration', () => {
  configure()
  mkdirSync(join(root, 'HEAD'))
  writeFileSync(join(root, 'HEAD', 'keep.txt'), 'keep')
  SandboxManager.cleanupAfterCommand()
  expect(readFileSync(join(root, 'HEAD', 'keep.txt'), 'utf8')).toBe('keep')
  const denyWrite = configure()
  expect(denyWrite).toContain(join(root, 'HEAD'))
  expect(denyWrite).not.toContain(join(root, 'config'))
})

for (const existing of ['HEAD file', 'dangling HEAD symlink', 'bare repository']) {
  test(`${existing} keeps all metadata protected, including missing paths`, () => {
    if (existing === 'bare repository') {
      expect(Bun.spawnSync(['git', 'init', '--bare', root], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).exitCode).toBe(0)
    } else if (existing === 'HEAD file') writeFileSync(join(root, 'HEAD'), 'ref: refs/heads/main\n')
    else symlinkSync(join(root, 'not-created-yet'), join(root, 'HEAD'))
    const denyWrite = configure()
    for (const name of metadata) expect(denyWrite).toContain(join(root, name))
    SandboxManager.cleanupAfterCommand()
    expect(lstatSync(join(root, 'HEAD'))).toBeDefined()
  })
}

test('both original and current working directories are guarded', () => {
  const other = mkdtempSync(join(suiteRoot, 'cwd-'))
  setCwdState(other)
  configure()
  for (const dir of [root, other]) {
    mkdirSync(join(dir, 'config'))
    writeFileSync(join(dir, 'config', 'game-config.json'), 'keep')
    writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n')
  }
  SandboxManager.cleanupAfterCommand()
  for (const dir of [root, other]) {
    expect(existsSync(join(dir, 'HEAD'))).toBe(false)
    expect(readFileSync(join(dir, 'config', 'game-config.json'), 'utf8')).toBe('keep')
  }
})

test('reset clears pending HEAD cleanup', async () => {
  configure()
  await SandboxManager.reset()
  writeFileSync(join(root, 'HEAD'), 'keep')
  SandboxManager.cleanupAfterCommand()
  expect(readFileSync(join(root, 'HEAD'), 'utf8')).toBe('keep')
})
