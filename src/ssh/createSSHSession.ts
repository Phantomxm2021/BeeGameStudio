import type { Subprocess } from 'bun'
import { SSHSessionManagerImpl } from './SSHSessionManager.js'
import type {
  SSHSessionManager,
  SSHSessionManagerOptions,
} from './SSHSessionManager.js'
import { createAuthProxy } from './SSHAuthProxy.js'
export type { SSHAuthProxy } from './SSHAuthProxy.js'
import type { SSHAuthProxy } from './SSHAuthProxy.js'
import { probeRemote } from './SSHProbe.js'
import { deployBinary } from './SSHDeploy.js'
import { buildCliLaunch } from '../utils/cliLaunch.js'
import { logForDebugging } from '../utils/debug.js'
import { randomUUID } from 'crypto'
import { resolve as resolvePosix } from 'node:path/posix'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { initializeSSHProcess } from './SSHInitialization.js'
import { remoteExecutable, shellQuote } from '../utils/shellArgument.js'
import { cleanupRemoteSocket } from './SSHSocketCleanup.js'

const STDERR_TAIL_LINES = 20
const STDERR_TAIL_BYTES = 16 * 1024
type StderrTail = { text: string }

export interface SSHSession {
  remoteCwd: string
  proc: Subprocess
  proxy: SSHAuthProxy
  createManager(options: SSHSessionManagerOptions): SSHSessionManager
  getStderrTail(): string
}

export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

/** Resume the session actually observed, never whichever transcript is newest. */
export function getReconnectCliArgs(args: string[], sessionId?: string): string[] {
  if (!sessionId) return [...args] // No init/transcript yet: restart the original launch.
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (['--continue', '-c', '--fork-session'].includes(arg)) continue
    if (['--resume', '-r', '--session-id', '--resume-session-at'].includes(arg)) {
      if (args[i + 1] && !args[i + 1]!.startsWith('-')) i++
      continue
    }
    if (/^--(?:resume|session-id|resume-session-at)=/.test(arg)) continue
    result.push(arg)
  }
  return [...result, '--resume', sessionId]
}

export async function createSSHSession(
  config: {
    host: string
    cwd?: string
    localVersion: string
    permissionMode?: string
    dangerouslySkipPermissions?: boolean
    extraCliArgs: string[]
    remoteBin?: string
  },
  callbacks?: {
    onProgress?: (msg: string) => void
  },
): Promise<SSHSession> {
  const { host, localVersion, extraCliArgs, remoteBin } = config
  const onProgress = callbacks?.onProgress

  let remoteBinaryPath: string
  let defaultCwd = '/'

  if (remoteBin) {
    onProgress?.('Using custom remote binary, skipping probe/deploy…')
    remoteBinaryPath = remoteBin
    logForDebugging(`[SSH] custom remoteBin: ${remoteBin}`)
    // Quick SSH to get remote home directory for default CWD
    let timer: ReturnType<typeof setTimeout> | undefined
    let pwdProc: Subprocess | undefined
    try {
      pwdProc = Bun.spawn(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', host, 'pwd'],
        {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'ignore',
        },
      )
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Remote directory probe timed out')), 15_000)
      })
      const [code, output] = await Promise.race([
        Promise.all([pwdProc.exited, new Response(pwdProc.stdout as ReadableStream<Uint8Array>).text()]), timeout,
      ])
      const pwd = output.trim()
      if (code !== 0 || !pwd.startsWith('/')) throw new Error('Unable to determine remote working directory')
      defaultCwd = pwd
    } catch (error) {
      pwdProc?.kill()
      throw new SSHSessionError(error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timer)
    }
  } else {
    // 1. Probe remote host
    const probe = await probeRemote(host, onProgress)
    logForDebugging(`[SSH] probe result: ${JSON.stringify(probe)}`)
    defaultCwd = probe.defaultCwd

    // 2. Deploy if binary missing or version mismatch
    remoteBinaryPath = probe.binaryPath ?? '~/.local/bin/bee-game-studio'
    if (!probe.hasBinary || probe.remoteVersion !== localVersion) {
      onProgress?.(
        probe.hasBinary
          ? `Updating remote binary (${probe.remoteVersion} → ${localVersion})…`
          : 'Deploying binary to remote…',
      )
      remoteBinaryPath = await deployBinary({
        host,
        remotePlatform: probe.remotePlatform,
        remoteArch: probe.remoteArch,
        localVersion,
        onProgress,
      })
    }
  }

  // 3. Start local auth proxy
  const { proxy, localAddress, authEnv } = await createAuthProxy()
  logForDebugging(`[SSH] auth proxy listening on ${localAddress}`)

  // 4. Build SSH command with -R reverse forward and remote CLI
  const isWindows = process.platform === 'win32'

  const remoteCli: string[] = [
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '-p',
  ]
  if (config.permissionMode)
    remoteCli.push('--permission-mode', config.permissionMode)
  if (config.dangerouslySkipPermissions)
    remoteCli.push('--dangerously-skip-permissions')
  remoteCli.push(...extraCliArgs)

  const remoteCwd = config.cwd?.startsWith('~/')
    ? resolvePosix(defaultCwd || '/', config.cwd.slice(2))
    : resolvePosix(defaultCwd || '/', config.cwd || '.')
  const command = (args: string[], attemptEnv: Record<string, string>) => `cd ${remoteExecutable(config.cwd?.startsWith('~/') ? config.cwd : remoteCwd)} && ` + [
    'exec', 'env',
    ...Object.entries(attemptEnv).map(([key, value]) => `${key}=${shellQuote(value)}`),
    remoteExecutable(remoteBinaryPath), ...args.map(shellQuote),
  ].join(' ')
  const spawnRemote = (args: string[]): Subprocess => {
    const sshArgs = ['ssh', '-o', 'ExitOnForwardFailure=yes']
    const attemptEnv = { ...authEnv }
    let remoteSocket: string | undefined
    // Remote sshd can leave a socket behind after disconnect. The client-side
    // StreamLocalBindUnlink option cannot remove that remote listener.
    if (!isWindows) {
      remoteSocket = `/tmp/bgs-ssh-auth-${randomUUID()}.sock`
      sshArgs.push('-R', `${remoteSocket}:${localAddress}`)
      attemptEnv.BGS_API_UNIX_SOCKET = remoteSocket
    } else {
      const localPort = localAddress.split(':')[1]
      const remotePort = 10000 + Math.floor(Math.random() * 50000)
      sshArgs.push('-R', `${remotePort}:127.0.0.1:${localPort}`)
      attemptEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${remotePort}`
    }
    const proc = Bun.spawn([...sshArgs, '--', host, command(args, attemptEnv)], {
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    if (remoteSocket) {
      const socket = remoteSocket
      void proc.exited.then(() => cleanupRemoteSocket(host, socket)).catch(() => {
        logForDebugging('[SSH] unable to observe SSH exit; remote socket may remain')
      })
    }
    return proc
  }
  const redact = stderrRedactor(authEnv)

  onProgress?.('Starting remote session…')
  logForDebugging('[SSH] spawning remote CLI (arguments and credentials omitted)')

  let proc: Subprocess
  try {
    proc = spawnRemote(remoteCli)
  } catch (err) {
    proxy.stop()
    throw new SSHSessionError(
      `Failed to spawn SSH process: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let stderrTail: StderrTail = { text: '' }

  try {
    proc = await initializeWithDiagnostics(proc, stderrTail, redact)
  } catch (err) {
    proxy.stop()
    throw err
  }

  logForDebugging(`[SSH] remote session initialized, remoteCwd=${remoteCwd}`)

  let currentProc = proc

  const reconnect = async (sessionId?: string, signal?: AbortSignal): Promise<Subprocess> => {
    signal?.throwIfAborted()
    logForDebugging('[SSH] reconnect: re-spawning the original session')
    stderrTail = { text: '' }
    let newProc = spawnRemote(getReconnectCliArgs(remoteCli, sessionId))

    newProc = await initializeWithDiagnostics(newProc, stderrTail, redact, signal)
    currentProc = newProc

    return newProc
  }

  return {
    remoteCwd,
    get proc() {
      return currentProc
    },
    proxy,
    createManager(options: SSHSessionManagerOptions): SSHSessionManager {
      return new SSHSessionManagerImpl(currentProc, {
        ...options,
        reconnect,
      })
    },
    getStderrTail(): string {
      return stderrTail.text
    },
  }
}

export async function createLocalSSHSession(config: {
  cwd?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
}): Promise<SSHSession> {
  const { proxy, authEnv } = await createAuthProxy()
  const redact = stderrRedactor(authEnv)

  const cliArgs: string[] = [
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '-p',
  ]
  const remoteCwd = resolve(config.cwd?.startsWith('~/') ? homedir() + config.cwd.slice(1) : config.cwd || process.cwd())
  if (config.permissionMode) {
    cliArgs.push('--permission-mode', config.permissionMode)
  }
  if (config.dangerouslySkipPermissions) {
    cliArgs.push('--dangerously-skip-permissions')
  }

  const spec = buildCliLaunch(cliArgs)

  let proc: Subprocess
  try {
    proc = Bun.spawn([spec.execPath, ...spec.args], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...spec.env, ...authEnv },
      cwd: remoteCwd,
    })
  } catch (err) {
    proxy.stop()
    throw new SSHSessionError(
      `Failed to spawn local CLI process: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  logForDebugging('[SSH] local session spawned, initializing SDK...')

  let stderrTail: StderrTail = { text: '' }

  try {
    proc = await initializeWithDiagnostics(proc, stderrTail, redact)
  } catch (err) {
    proxy.stop()
    throw err
  }

  logForDebugging(`[SSH] local session initialized, remoteCwd=${remoteCwd}`)

  let currentProc = proc

  const reconnect = async (sessionId?: string, signal?: AbortSignal): Promise<Subprocess> => {
    signal?.throwIfAborted()
    logForDebugging('[SSH] local reconnect: re-spawning the original session')
    const reconnectCliArgs = getReconnectCliArgs(cliArgs, sessionId)

    const reconnectSpec = buildCliLaunch(reconnectCliArgs)
    stderrTail = { text: '' }
    let newProc = Bun.spawn([reconnectSpec.execPath, ...reconnectSpec.args], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...reconnectSpec.env, ...authEnv },
      cwd: remoteCwd,
    })

    newProc = await initializeWithDiagnostics(newProc, stderrTail, redact, signal)
    currentProc = newProc

    return newProc
  }

  return {
    remoteCwd,
    get proc() {
      return currentProc
    },
    proxy,
    createManager(options: SSHSessionManagerOptions): SSHSessionManager {
      return new SSHSessionManagerImpl(currentProc, {
        ...options,
        reconnect,
      })
    },
    getStderrTail(): string {
      return stderrTail.text
    },
  }
}

function stderrRedactor(env: Record<string, string>): (text: string) => string {
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && /(?:nonce|token|secret|api_key|password)/i.test(key))
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length)
  return text => secrets.reduce((result, secret) => result.split(secret).join('[redacted]'), text)
}

async function initializeWithDiagnostics(
  proc: Subprocess,
  tail: StderrTail,
  redact: (text: string) => string,
  signal?: AbortSignal,
): Promise<Subprocess> {
  const drained = collectStderr(proc, tail, redact)
  try {
    return await initializeSSHProcess(proc, 30_000, signal)
  } catch (error) {
    // Initialization kills the failed process. Give its stderr time to drain,
    // but do not hang if a descendant keeps the pipe open.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (!signal?.aborted) await Promise.race([drained, new Promise<void>(resolve => {
        timer = setTimeout(resolve, 250)
      })])
    } finally {
      clearTimeout(timer)
    }
    const detail = tail.text.trim()
    throw new SSHSessionError(redact(`${error instanceof Error ? error.message : String(error)}${detail ? ': ' + detail : ''}`))
  }
}

async function collectStderr(proc: Subprocess, tail: StderrTail, redact: (text: string) => string): Promise<void> {
  const stderr = proc.stderr
  if (!stderr) return

  const reader = (stderr as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      const bytes = Buffer.from(redact(tail.text + decoder.decode(value, { stream: !done })))
      let start = Math.max(0, bytes.length - STDERR_TAIL_BYTES)
      // Do not start the retained UTF-8 suffix in the middle of a character.
      while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++
      const text = bytes.subarray(start).toString('utf8')
      const lines = text.split('\n')
      tail.text = lines.slice(-(text.endsWith('\n') ? STDERR_TAIL_LINES + 1 : STDERR_TAIL_LINES)).join('\n')
      if (done) break
    }
  } catch {
    // stderr closed — expected on process exit
  } finally {
    reader.releaseLock()
  }
}
