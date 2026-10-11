import { logForDebugging } from 'src/utils/debug.js'

const PROBE_TIMEOUT_MS = 15_000

export interface ProbeResult {
  hasBinary: boolean
  remoteVersion: string | null
  remotePlatform: 'linux' | 'darwin'
  remoteArch: 'x64' | 'arm64'
  defaultCwd: string
  binaryPath: string | null
}

export class SSHProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHProbeError'
  }
}

export async function probeRemote(
  host: string,
  onProgress?: (msg: string) => void,
): Promise<ProbeResult> {
  onProgress?.('Probing remote host…')

  const proc = Bun.spawn(
    [
      'ssh',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '--',
      host,
      'BGS_BIN=$(test -x "$HOME/.local/bin/bee-game-studio" && echo "$HOME/.local/bin/bee-game-studio" || command -v bee-game-studio 2>/dev/null); echo "$BGS_BIN"; if [ -n "$BGS_BIN" ]; then "$BGS_BIN" --version 2>/dev/null; fi; uname -sm; pwd',
    ],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  )

  // Drain both pipes while the process is running, not after it exits.
  const output = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  let timer: ReturnType<typeof setTimeout> | undefined
  let result: number
  let stdout: string
  let stderr: string
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        proc.kill()
        reject(new SSHProbeError(`SSH probe timed out after ${PROBE_TIMEOUT_MS / 1000}s`))
      }, PROBE_TIMEOUT_MS)
    })
    ;[result, [stdout, stderr]] = await Promise.race([
      Promise.all([proc.exited, output]), timeout,
    ])
  } finally {
    clearTimeout(timer)
  }

  if (result !== 0) {
    const detail = stderr.trim() || `exit code ${result}`
    throw new SSHProbeError(`SSH probe failed: ${detail}`)
  }

  const lines = stdout
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  logForDebugging(`[SSHProbe] raw lines: ${JSON.stringify(lines)}`)

  const unameIdx = lines.findIndex(l => /^(Linux|Darwin)\s/.test(l))
  if (unameIdx === -1) {
    throw new SSHProbeError(
      'Could not detect remote platform (uname output missing)',
    )
  }

  const binaryPath = unameIdx >= 2 ? lines[unameIdx - 2] || null : null
  const versionLine = unameIdx >= 1 ? lines[unameIdx - 1] || null : null
  const remoteVersion =
    versionLine?.match(/^(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?:\s|$)/)?.[1] ?? null
  const hasBinary = binaryPath !== null && binaryPath.startsWith('/')
  const defaultCwd = lines[unameIdx + 1] || '/'

  const [osName, arch] = lines[unameIdx]!.split(/\s+/)

  const remotePlatform = osName === 'Darwin' ? 'darwin' : 'linux'
  if (!['aarch64', 'arm64', 'x86_64', 'amd64'].includes(arch ?? '')) {
    throw new SSHProbeError(`Unsupported remote architecture: ${arch}`)
  }
  const remoteArch: 'x64' | 'arm64' =
    arch === 'aarch64' || arch === 'arm64' ? 'arm64' : 'x64'

  onProgress?.(`Detected ${remotePlatform}/${remoteArch}`)

  return {
    hasBinary: hasBinary && remoteVersion !== null,
    remoteVersion,
    remotePlatform,
    remoteArch,
    defaultCwd,
    binaryPath: hasBinary ? binaryPath : null,
  }
}
