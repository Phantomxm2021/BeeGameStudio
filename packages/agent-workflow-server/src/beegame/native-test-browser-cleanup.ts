import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
type BrowserProcess = { pid: number; executable: string; command: string }
const isChromium = (executable: string) =>
  /^(?:Google Chrome(?: for Testing)?|Chromium|chrome|chromium|chromium-browser|headless_shell|chrome-headless-shell)(?:\.exe)?$/i.test(basename(executable))

/** Fail closed: a dedicated headless browser AND a canonical profile under the
 * session's private scratch directory are both required. No process-name kills,
 * project-wide cleanup, personal profiles, dev servers, or command rewriting. */
export async function isSessionTestBrowser(browser: BrowserProcess, scratch: string): Promise<boolean> {
  if (!Number.isSafeInteger(browser.pid) || browser.pid <= 1 || !isChromium(browser.executable) ||
      !/(?:^|\s)--headless(?:=(?:new|old))?(?=\s|$)/.test(browser.command) ||
      /(?:^|\s)--type=/.test(browser.command)) return false
  const profiles = [...browser.command.matchAll(/(?:^|\s)--user-data-dir(?:=|\s+)("[^"]+"|'[^']+'|.*?)(?=\s+--|\s+(?:about:|https?:|file:)|$)/g)]
  if (profiles.length !== 1) return false
  const profile = profiles[0]![1]!.replace(/^(['"])(.*)\1$/, '$2').trim()
  if (!isAbsolute(profile)) return false
  try {
    const root = await realpath(scratch)
    const path = relative(root, await realpath(profile))
    return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\')
  } catch { return false }
}

async function listBrowsers(): Promise<BrowserProcess[]> {
  const options = { timeout: 2000, maxBuffer: 4 * 1024 * 1024 }
  if (process.platform === 'win32') {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("chrome.exe","chromium.exe","headless_shell.exe","chrome-headless-shell.exe") } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'], options)
    const value = stdout.trim() ? JSON.parse(stdout) : []
    return (Array.isArray(value) ? value : [value]).map(item => ({
      pid: Number(item.ProcessId), executable: String(item.ExecutablePath || ''), command: String(item.CommandLine || ''),
    }))
  }
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,comm='], options)
  const candidates = stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    return match && isChromium(match[2]!) ? [{ pid: Number(match[1]), executable: match[2]! }] : []
  })
  if (!candidates.length) return []
  const args = await execute('/bin/ps', ['-ww', '-p', candidates.map(item => item.pid).join(','), '-o', 'pid=,args='], options)
    .catch((error: { code?: number; stdout?: string }) => {
      if (error.code === 1) return { stdout: error.stdout || '' } // Candidates exited.
      throw error
    })
  const commands = new Map(args.stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    return match ? [[Number(match[1]), match[2]!] as const] : []
  }))
  return candidates.map(item => ({ ...item, command: commands.get(item.pid) || '' }))
}

/** Also catches browsers orphaned by "chrome &": their shell has already exited
 * and a process-tree kill of the native CLI can no longer find them. */
export async function closeSessionTestBrowsers(scratch: string): Promise<void> {
  const candidates = await listBrowsers()
  const owned = (await Promise.all(candidates.map(async browser =>
    await isSessionTestBrowser(browser, scratch) ? browser : undefined))).filter(Boolean) as BrowserProcess[]
  if (!owned.length) return
  const signal = (pid: number, value: NodeJS.Signals) => {
    try { process.kill(pid, value) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  for (const browser of owned) signal(browser.pid, 'SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 500))
  // Revalidate identity and scope before escalating; do not blindly kill a reused PID.
  for (const browser of await listBrowsers()) {
    if (owned.some(item => item.pid === browser.pid && item.executable === browser.executable && item.command === browser.command) &&
        await isSessionTestBrowser(browser, scratch)) signal(browser.pid, 'SIGKILL')
  }
}
