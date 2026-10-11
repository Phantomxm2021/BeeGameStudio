/**
 * Protocol Handler Registration
 *
 * Registers the `claude-cli://` custom URI scheme with the OS,
 * so that clicking a `claude-cli://` link in a browser (or any app) will
 * invoke `claude --handle-uri <url>`.
 *
 * Platform details:
 *   macOS  — Creates a minimal .app trampoline in ~/Applications with
 *            CFBundleURLTypes in its Info.plist
 *   Linux  — Creates a .desktop file in $XDG_DATA_HOME/applications
 *            (default ~/.local/share/applications) and registers it with xdg-mime
 *   Windows — Writes registry keys under HKEY_CURRENT_USER\Software\Classes
 */

import { DEEP_LINK_PROTOCOL } from './parseDeepLink.js'
import { constants as fsConstants, promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { getInitialSettings } from '../settings/settings.js'
import { which } from '../which.js'
import { getUserBinDir, getXDGDataHome } from '../xdg.js'
import { isInBundledMode } from '../bundledMode.js'
import { shellQuote } from '../shellArgument.js'

export const MACOS_BUNDLE_ID = 'com.phantomlab.bgs-url-handler'
const APP_NAME = 'BGS URL Handler'
const DESKTOP_FILE_NAME = 'bgs-url-handler.desktop'
const MACOS_APP_NAME = 'BGS URL Handler.app'

// Shared between register* (writes these paths/values) and
// isProtocolHandlerCurrent (reads them back). Keep the writer and reader
// in lockstep — drift here means the check returns a perpetual false.
const MACOS_APP_DIR = path.join(os.homedir(), 'Applications', MACOS_APP_NAME)
const MACOS_TARGET_MARKER = path.join(MACOS_APP_DIR, 'Contents', 'Resources', 'bgs-cli-path')
function linuxDesktopPath(): string {
  return path.join(getXDGDataHome(), 'applications', DESKTOP_FILE_NAME)
}
const WINDOWS_REG_KEY = `HKEY_CURRENT_USER\\Software\\Classes\\${DEEP_LINK_PROTOCOL}`
const WINDOWS_COMMAND_KEY = `${WINDOWS_REG_KEY}\\shell\\open\\command`

const FAILURE_BACKOFF_MS = 24 * 60 * 60 * 1000

export function linuxExecLine(claudePath: string): string {
  if (/[\r\n\0]/.test(claudePath)) throw new Error('Invalid BGS executable path')
  // Exec argument quoting, followed by Desktop Entry string escaping. Percent
  // signs are field codes, even in quotes; %% means a literal percent sign.
  const quoted = claudePath.replace(/[\\"`$]/g, '\\$&').replaceAll('%', '%%')
  return `Exec="${quoted.replaceAll('\\', '\\\\')}" --handle-uri %u`
}
function windowsCommandValue(claudePath: string): string {
  return `"${claudePath}" --handle-uri "%1"`
}

/** Build an OS-native AppleScript applet that forwards Apple Events as CLI args. */
export function macosUrlHandlerScript(executable: string, searchPath = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'): string {
  if (/[\r\n\0]/.test(executable)) throw new Error('Invalid BGS executable path')
  // AppleScript's shell uses a minimal PATH. Preserve runtime discovery for
  // npm/Bun executable wrappers, without persisting any authentication env.
  const command = (`PATH=${shellQuote(searchPath)} ${shellQuote(executable)} --handle-uri `).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `on open location incomingURL
  do shell script "${command}" & quoted form of incomingURL
end open location`
}

export const MACOS_PLIST_EDITS = [
  `Add :CFBundleIdentifier string ${MACOS_BUNDLE_ID}`,
  'Add :LSBackgroundOnly bool true',
  'Add :CFBundleURLTypes array',
  'Add :CFBundleURLTypes:0 dict',
  'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
  `Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${DEEP_LINK_PROTOCOL}`,
]

async function registerMacos(claudePath: string): Promise<void> {
  await fs.mkdir(path.dirname(MACOS_APP_DIR), { recursive: true })
  const staging = await fs.mkdtemp(path.join(path.dirname(MACOS_APP_DIR), '.bgs-url-handler-'))
  const app = path.join(staging, MACOS_APP_NAME)
  try {
    const compiled = await execFileNoThrow('/usr/bin/osacompile', ['-o', app, '-e', macosUrlHandlerScript(claudePath)], { useCwd: false })
    if (compiled.code !== 0) throw new Error(`Could not compile BGS URL handler: ${compiled.stderr}`)
    const plist = path.join(app, 'Contents', 'Info.plist')
    for (const edit of MACOS_PLIST_EDITS) {
      const result = await execFileNoThrow('/usr/libexec/PlistBuddy', ['-c', edit, plist], { useCwd: false })
      if (result.code !== 0) throw new Error(`Could not configure BGS URL handler: ${result.stderr}`)
    }
    // Replace only our named bundle, and only after compilation succeeded.
    await fs.rm(MACOS_APP_DIR, { recursive: true, force: true })
    await fs.rename(app, MACOS_APP_DIR)
    const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    const registered = await execFileNoThrow(lsregister, ['-R', MACOS_APP_DIR], { useCwd: false })
    if (registered.code !== 0) throw new Error(`LaunchServices registration failed: ${registered.stderr}`)
    await fs.writeFile(MACOS_TARGET_MARKER, claudePath)
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

/**
 * Register the protocol handler on Linux.
 * Creates a .desktop file and registers it with xdg-mime.
 */
async function registerLinux(claudePath: string): Promise<void> {
  await fs.mkdir(path.dirname(linuxDesktopPath()), { recursive: true })

  const desktopEntry = `[Desktop Entry]
Name=${APP_NAME}
Comment=Handle ${DEEP_LINK_PROTOCOL}:// deep links for BGS
${linuxExecLine(claudePath)}
Type=Application
NoDisplay=true
MimeType=x-scheme-handler/${DEEP_LINK_PROTOCOL};
`

  await fs.writeFile(linuxDesktopPath(), desktopEntry)

  // Register as the default handler for the scheme. On headless boxes
  // (WSL, Docker, CI) xdg-utils isn't installed — not a failure: there's
  // no desktop to click links from, and some apps read the .desktop
  // MimeType line directly. The artifact check still short-circuits
  // next session since the .desktop file is present.
  const xdgMime = await which('xdg-mime')
  if (xdgMime) {
    const { code } = await execFileNoThrow(
      xdgMime,
      ['default', DESKTOP_FILE_NAME, `x-scheme-handler/${DEEP_LINK_PROTOCOL}`],
      { useCwd: false },
    )
    if (code !== 0) {
      throw Object.assign(new Error(`xdg-mime exited with code ${code}`), {
        code: 'XDG_MIME_FAILED',
      })
    }
  }

  logForDebugging(
    `Registered ${DEEP_LINK_PROTOCOL}:// protocol handler at ${linuxDesktopPath()}`,
  )
}

/**
 * Register the protocol handler on Windows via the registry.
 */
async function registerWindows(claudePath: string): Promise<void> {
  for (const args of [
    ['add', WINDOWS_REG_KEY, '/ve', '/d', `URL:${APP_NAME}`, '/f'],
    ['add', WINDOWS_REG_KEY, '/v', 'URL Protocol', '/d', '', '/f'],
    [
      'add',
      WINDOWS_COMMAND_KEY,
      '/ve',
      '/d',
      windowsCommandValue(claudePath),
      '/f',
    ],
  ]) {
    const { code } = await execFileNoThrow('reg', args, { useCwd: false })
    if (code !== 0) {
      throw Object.assign(new Error(`reg add exited with code ${code}`), {
        code: 'REG_FAILED',
      })
    }
  }

  logForDebugging(
    `Registered ${DEEP_LINK_PROTOCOL}:// protocol handler in Windows registry`,
  )
}

/**
 * Register the `claude-cli://` protocol handler with the operating system.
 * After registration, clicking a `claude-cli://` link will invoke claude.
 */
export async function registerProtocolHandler(
  claudePath?: string,
): Promise<void> {
  const resolved = claudePath ?? (await resolveClaudePath())
  if (!resolved) throw new Error('No installed BGS executable available for URI registration')

  switch (process.platform) {
    case 'darwin':
      await registerMacos(resolved)
      break
    case 'linux':
      await registerLinux(resolved)
      break
    case 'win32':
      await registerWindows(resolved)
      break
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

/**
 * Resolve the claude binary path for protocol registration. Prefers the
 * native installer's stable symlink (~/.local/bin/claude) which survives
 * auto-updates; falls back to process.execPath when the symlink is absent
 * (dev builds, non-native installs).
 */
export async function resolveClaudePath(): Promise<string | undefined> {
  const binaryName = process.platform === 'win32' ? 'bee-game-studio.exe' : 'bee-game-studio'
  const stablePath = path.join(getUserBinDir(), binaryName)
  try {
    await fs.realpath(stablePath)
    return stablePath
  } catch {
    // Node/Bun alone cannot handle a CLI URI. Do not register a broken runtime
    // trampoline or accidentally select an unrelated vendor installation.
    const installed = await which('bee-game-studio')
    if (installed) return installed
    if (isInBundledMode()) return process.execPath
    return undefined
  }
}

/**
 * Check whether the OS-level protocol handler is already registered AND
 * points at the expected `claude` binary. Reads the registration artifact
 * directly (applet target marker, .desktop Exec line, registry value) rather than
 * a cached flag in ~/.claude.json, so:
 *   - the check is per-machine (config can sync across machines; OS state can't)
 *   - stale paths self-heal (install-method change → re-register next session)
 *   - deleted artifacts self-heal
 *
 * Any read error (ENOENT, EACCES, reg nonzero) → false → re-register.
 */
export async function isProtocolHandlerCurrent(
  claudePath: string,
): Promise<boolean> {
  try {
    switch (process.platform) {
      case 'darwin': {
        const target = await fs.readFile(MACOS_TARGET_MARKER, 'utf8')
        if (target !== claudePath) return false
        const plist = await fs.readFile(path.join(MACOS_APP_DIR, 'Contents', 'Info.plist'), 'utf8')
        if (!plist.includes(MACOS_BUNDLE_ID) || !plist.includes(DEEP_LINK_PROTOCOL)) return false
        await fs.access(path.join(MACOS_APP_DIR, 'Contents', 'MacOS', 'applet'), fsConstants.X_OK)
        await fs.access(path.join(MACOS_APP_DIR, 'Contents', 'Resources', 'Scripts', 'main.scpt'))
        return true
      }
      case 'linux': {
        const content = await fs.readFile(linuxDesktopPath(), 'utf8')
        return content.split(/\r?\n/).includes(linuxExecLine(claudePath))
      }
      case 'win32': {
        const { stdout, code } = await execFileNoThrow(
          'reg',
          ['query', WINDOWS_COMMAND_KEY, '/ve'],
          { useCwd: false },
        )
        return code === 0 && stdout.includes(windowsCommandValue(claudePath))
      }
      default:
        return false
    }
  } catch {
    return false
  }
}

/**
 * Auto-register the claude-cli:// deep link protocol handler when missing
 * or stale. Runs every session from backgroundHousekeeping (fire-and-forget),
 * but the artifact check makes it a no-op after the first successful run
 * unless the install path moves or the OS artifact is deleted.
 */
export async function ensureDeepLinkProtocolRegistered(): Promise<void> {
  if (getInitialSettings().disableDeepLinkRegistration === 'disable') {
    return
  }
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_lodestone_enabled', false)) {
    return
  }

  const claudePath = await resolveClaudePath()
  if (!claudePath) return
  if (await isProtocolHandlerCurrent(claudePath)) {
    return
  }

  // EACCES/ENOSPC are deterministic — retrying next session won't help.
  // Throttle to once per 24h so a read-only ~/.local/share/applications
  // doesn't generate a failure event on every startup. Marker lives in
  // ~/.claude (per-machine, not synced) rather than ~/.claude.json (can sync).
  const failureMarkerPath = path.join(
    getClaudeConfigHomeDir(),
    '.deep-link-register-failed',
  )
  try {
    const stat = await fs.stat(failureMarkerPath)
    if (Date.now() - stat.mtimeMs < FAILURE_BACKOFF_MS) {
      return
    }
  } catch {
    // Marker absent — proceed.
  }

  try {
    await registerProtocolHandler(claudePath)
    logEvent('tengu_deep_link_registered', { success: true })
    logForDebugging('Auto-registered claude-cli:// deep link protocol handler')
    await fs.rm(failureMarkerPath, { force: true }).catch(() => {})
  } catch (error) {
    const code = getErrnoCode(error)
    logEvent('tengu_deep_link_registered', {
      success: false,
      error_code:
        code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logForDebugging(
      `Failed to auto-register deep link protocol handler: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    if (code === 'EACCES' || code === 'ENOSPC') {
      await fs.writeFile(failureMarkerPath, '').catch(() => {})
    }
  }
}
