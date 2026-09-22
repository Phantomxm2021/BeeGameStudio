import { access, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'

/** Only launches a dedicated test browser. It never executes an agent's shell
 * command, uses a personal profile, or disables Chromium's own sandbox. */
export function createPreviewTestBrowser(options: { executable?: string; startupTimeoutMs?: number } = {}) {
  let child: ReturnType<typeof Bun.spawn> | undefined
  let profile: string | undefined
  let endpoint: string | undefined
  let pending: Promise<{ endpoint: string }> | undefined
  let closed = false
  let stderr = ''
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => closePromise ??= (async () => {
    closed = true
    // A start in flight checks closed after each asynchronous preparation step.
    await pending?.catch(() => undefined)
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      const timer = setTimeout(() => { if (child?.exitCode === null) child.kill('SIGKILL') }, 2000)
      await child.exited
      clearTimeout(timer)
    }
    endpoint = undefined
    if (profile) await rm(profile, { recursive: true, force: true })
  })()
  async function launch(): Promise<{ endpoint: string }> {
    if (closed) throw new Error('Preview test access is closed')
    const executable = await resolveTestBrowserExecutable(options.executable)
    if (closed) throw new Error('Preview test access is closed')
    profile = await realpath(await mkdtemp(join(tmpdir(), 'beegame-test-browser-')))
    if (closed) throw new Error('Preview test access is closed')
    child = Bun.spawn([executable, '--headless', '--mute-audio', '--no-first-run',
      '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, 'about:blank'], {
      env: { ...getSafeRuntimeProcessEnvironment(), TMPDIR: profile },
      cwd: profile, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe',
    })
    const process = child
    const drained = (async () => {
      for await (const bytes of process.stderr as ReadableStream<Uint8Array>) {
        stderr = (stderr + new TextDecoder().decode(bytes)).slice(-8192)
      }
    })()
    const deadline = Date.now() + (options.startupTimeoutMs ?? 15000)
    while (!closed && process.exitCode === null && Date.now() < deadline) {
      const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/)
      if (match) {
        const ws = new URL(match[1]!)
        try {
          const response = await fetch(`http://${ws.host}/json/version`, { signal: AbortSignal.timeout(1000) })
          const version = await response.json() as { webSocketDebuggerUrl?: string }
          if (response.ok && version.webSocketDebuggerUrl === match[1] && !closed) {
            endpoint = match[1]
            return { endpoint }
          }
        } catch { /* Readiness is not inferred from spawn or a log line alone. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (process.exitCode === null) process.kill('SIGKILL')
    await process.exited
    await drained
    if (profile) await rm(profile, { recursive: true, force: true })
    const detail = stderr.replace(/ws:\/\/\S+/g, '[debug endpoint]').slice(-2000)
    throw new Error(`Test browser unavailable (exit ${process.exitCode}). ${detail}`)
  }
  return {
    start(): Promise<{ endpoint: string }> {
      if (closed) return Promise.reject(new Error('Preview test access is closed'))
      if (endpoint && child?.exitCode === null) return Promise.resolve({ endpoint })
      if (endpoint) return Promise.reject(new Error('Test browser exited; this session no longer has a live endpoint'))
      // A failed launch is reported, not retried by a hidden loop. New access
      // can be explicitly requested after fixing the host configuration.
      return pending ??= launch()
    },
    status: () => ({ status: closed ? 'closed' : endpoint && child?.exitCode === null ? 'running' : 'not-running',
      ...(endpoint && child?.exitCode === null ? { endpoint } : {}) }),
    close,
  }
}

export async function resolveTestBrowserExecutable(explicit = process.env.BEEGAME_TEST_BROWSER_EXECUTABLE): Promise<string> {
  const usable = async (file: string) => {
    try { await access(file, constants.X_OK); return true } catch { return false }
  }
  if (explicit) {
    if (!isAbsolute(explicit) || !await usable(explicit)) throw new Error('BEEGAME_TEST_BROWSER_EXECUTABLE must be an executable absolute path')
    return explicit
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin'
    ? join(homedir(), 'Library/Caches/ms-playwright') : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'ms-playwright')
      : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'))
  const versions = (await readdir(cache).catch(() => [])).filter(name => /^chromium_headless_shell-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))
  const binaries = process.platform === 'darwin'
    ? [`chrome-headless-shell-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/chrome-headless-shell`, 'chrome-mac/headless_shell']
    : process.platform === 'win32' ? ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win/headless_shell.exe']
      : ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell']
  for (const version of versions) for (const binary of binaries) {
    const candidate = join(cache, version, binary)
    if (await usable(candidate)) return candidate
  }
  throw new Error('No installed test Chromium found. Configure BEEGAME_TEST_BROWSER_EXECUTABLE; no browser was downloaded or launched.')
}
