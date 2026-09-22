import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeSessionTestBrowsers, isSessionTestBrowser } from './native-test-browser-cleanup'
import { resolveTestBrowserExecutable } from './preview-test-browser'

test('only claims headless Chromium with a canonical profile inside this session scratch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-browser-scope-')))
  const scratch = join(root, 'session-a')
  const profile = join(scratch, 'path with spaces', 'profile')
  const other = join(root, 'session-b', 'profile')
  await mkdir(profile, { recursive: true })
  await mkdir(other, { recursive: true })
  await symlink(other, join(scratch, 'escape'), 'dir')
  const browser = (command: string, executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') =>
    ({ pid: 12345, executable, command })
  try {
    for (const args of [
      `--headless=new --user-data-dir=${profile} about:blank`,
      `--headless --user-data-dir="${profile}" --mute-audio`,
      `--headless --user-data-dir '${profile}'`,
    ]) expect(await isSessionTestBrowser(browser(args), scratch)).toBe(true)
    for (const args of [
      `--user-data-dir=${profile} about:blank`, // Personal/headful browser.
      `--headless --user-data-dir=${other} about:blank`,
      `--headless --user-data-dir=${scratch}/../session-b/profile`,
      `--headless --user-data-dir=${scratch}/escape`,
      `--headless --user-data-dir=${scratch}`, // Require a dedicated subdirectory.
      `--headless --user-data-dir=relative/profile`,
      `--headless --type=renderer --user-data-dir=${profile}`,
      `--headless --user-data-dir=${profile} --user-data-dir=${other}`,
    ]) expect(await isSessionTestBrowser(browser(args), scratch)).toBe(false)
    expect(await isSessionTestBrowser(browser(`--headless --user-data-dir=${profile}`, '/usr/bin/node'), scratch)).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('reaps an independently launched test browser, not a browser from another session', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-browser-cleanup-')))
  const scratch = join(root, 'session')
  const profile = join(scratch, 'chrome-profile')
  const other = join(root, 'other-session', 'chrome-profile')
  await mkdir(profile, { recursive: true })
  await mkdir(other, { recursive: true })
  const executable = await resolveTestBrowserExecutable()
  const launch = (path: string) => Bun.spawn([executable, '--headless', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${path}`, 'about:blank'],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
  const owned = launch(profile)
  const unrelated = launch(other)
  const ready = async (child: typeof owned) => {
    let text = ''
    for await (const bytes of child.stderr) {
      text += new TextDecoder().decode(bytes)
      if (text.includes('DevTools listening')) return
    }
    throw new Error('Test browser exited before readiness')
  }
  try {
    await Promise.all([ready(owned), ready(unrelated)])
    await closeSessionTestBrowsers(scratch)
    await owned.exited
    expect(owned.exitCode).not.toBeNull()
    expect(unrelated.exitCode).toBeNull()
  } finally {
    for (const child of [owned, unrelated]) { if (child.exitCode === null) child.kill('SIGKILL'); await child.exited }
    await rm(root, { recursive: true, force: true })
  }
}, 20000)
