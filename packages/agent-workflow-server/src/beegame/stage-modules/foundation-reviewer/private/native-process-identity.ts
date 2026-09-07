import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

/**
 * Read-only process identity used by the Reviewer recovery design.
 *
 * This module deliberately does not expose command lines, environments, or
 * signal/termination helpers.  A matching identity is diagnostic evidence
 * only; it never authorizes a later signal because observation and signaling
 * are separate operations with a TOCTOU window.
 */
export type NativeProcessPlatform = 'linux' | 'darwin'

export type NativeProcessBirthIdentity =
  | Readonly<{
      platform: 'linux'
      bootId: string
      startTimeTicks: string
      precision: 'clock-ticks'
      /** Diagnostic precision only; this snapshot is not signal authority. */
      reuseSafe: false
    }>
  | Readonly<{
      platform: 'darwin'
      bootId: string
      startTimeSeconds: number
      precision: 'seconds'
      reuseSafe: false
    }>

export type NativeProcessIdentity = Readonly<{
  platform: NativeProcessPlatform
  pid: number
  ppid: number
  pgid: number
  sessionId: number
  birth: NativeProcessBirthIdentity
}>

export type NativeProcessObservation =
  | Readonly<{
      status: 'matched'
      identity: NativeProcessIdentity
      /** Always false: observation is not an atomic signal authority. */
      safeForCleanup: false
    }>
  | Readonly<{
      status: 'mismatch'
      identity: NativeProcessIdentity
      safeForCleanup: false
    }>
  | Readonly<{ status: 'missing'; safeForCleanup: false }>
  | Readonly<{
      status: 'unknown'
      reason: 'unsupported' | 'permission' | 'unavailable' | 'malformed'
      safeForCleanup: false
    }>

type NativeProcessIdentityFailureReason = 'missing' | 'unsupported' | 'permission' | 'unavailable' | 'malformed'

class NativeProcessIdentityError extends Error {
  constructor(readonly reason: NativeProcessIdentityFailureReason, message: string) {
    super(message)
    this.name = 'NativeProcessIdentityError'
  }
}

const SAFE_COMMAND_ENV = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'C',
  LC_ALL: 'C',
  TZ: 'UTC',
}
const COMMAND_OUTPUT_LIMIT = 16 * 1024

function assertPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('native process PID must be a positive integer')
}

function supportedPlatform(platform: NodeJS.Platform): platform is NativeProcessPlatform {
  return platform === 'linux' || platform === 'darwin'
}

function classifyFsError(error: unknown, message: string): NativeProcessIdentityError {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'ENOENT' || code === 'ESRCH') return new NativeProcessIdentityError('missing', message)
  if (code === 'EACCES' || code === 'EPERM') return new NativeProcessIdentityError('permission', message)
  return new NativeProcessIdentityError('unavailable', message)
}

function parseNonnegativeInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new NativeProcessIdentityError('malformed', `native process ${field} is malformed`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new NativeProcessIdentityError('malformed', `native process ${field} is out of range`)
  return parsed
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = parseNonnegativeInteger(value, field)
  if (parsed === 0) throw new NativeProcessIdentityError('malformed', `native process ${field} is zero`)
  return parsed
}

async function readLinuxIdentity(pid: number): Promise<NativeProcessIdentity> {
  let stat: string
  let bootId: string
  try {
    ;[stat, bootId] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
    ])
  } catch (error) {
    throw classifyFsError(error, 'native Linux process identity is unavailable')
  }

  const closing = stat.lastIndexOf(')')
  if (closing < 0) throw new NativeProcessIdentityError('malformed', 'native Linux process stat is malformed')
  const statPid = parsePositiveInteger(stat.slice(0, stat.indexOf(' ')), 'PID')
  if (statPid !== pid) throw new NativeProcessIdentityError('unavailable', 'native Linux process PID changed while reading identity')
  const fields = stat.slice(closing + 1).trim().split(/\s+/)
  // After the executable name, field 3 is at index 0.  Linux field 22
  // (starttime) is therefore index 19.
  if (fields.length <= 19) throw new NativeProcessIdentityError('malformed', 'native Linux process stat is truncated')
  const normalizedBootId = bootId.trim()
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(normalizedBootId)) throw new NativeProcessIdentityError('malformed', 'native Linux boot identity is malformed')
  const startTimeTicks = fields[19]!
  if (!/^\d+$/.test(startTimeTicks)) throw new NativeProcessIdentityError('malformed', 'native Linux process birth identity is malformed')
  return {
    platform: 'linux',
    pid,
    ppid: parseNonnegativeInteger(fields[1]!, 'parent PID'),
    pgid: parsePositiveInteger(fields[2]!, 'process group ID'),
    sessionId: parseNonnegativeInteger(fields[3]!, 'session ID'),
    birth: { platform: 'linux', bootId: normalizedBootId, startTimeTicks, precision: 'clock-ticks', reuseSafe: false },
  }
}

type ReadOnlyCommandError = Error & { code?: number | string; stderr?: string; sourceCommand?: string }

/** Spawn a fixed system query without a shell, timeout, or termination path. */
function readOnlyCommand(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(file, [...args], { env: SAFE_COMMAND_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let tooLarge = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (Buffer.byteLength(stdout, 'utf8') < COMMAND_OUTPUT_LIMIT) stdout += String(chunk)
      if (Buffer.byteLength(stdout, 'utf8') > COMMAND_OUTPUT_LIMIT) tooLarge = true
    })
    child.stderr.on('data', chunk => {
      if (Buffer.byteLength(stderr, 'utf8') < COMMAND_OUTPUT_LIMIT) stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (tooLarge) {
        reject(Object.assign(new Error('native process identity command output is too large'), { code: 'OUTPUT_LIMIT', sourceCommand: file }))
        return
      }
      if (code !== 0) {
        const error: ReadOnlyCommandError = new Error(`native process identity command failed${signal ? ` (${signal})` : ''}`)
        error.code = code ?? 'SIGNAL'
        error.stderr = stderr
        error.sourceCommand = file
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

function parseDarwinBootIdentity(value: string): string {
  const match = value.match(/sec\s*=\s*(\d+)\s*,\s*usec\s*=\s*(\d+)/)
  if (!match) throw new NativeProcessIdentityError('malformed', 'native Darwin boot identity is malformed')
  return `${match[1]}:${match[2]}`
}

async function readDarwinIdentity(pid: number): Promise<NativeProcessIdentity> {
  let processLine: string
  let bootLine: string
  try {
    ;[processLine, bootLine] = await Promise.all([
      readOnlyCommand('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,sess=,lstart=']),
      readOnlyCommand('/usr/sbin/sysctl', ['-n', 'kern.boottime']),
    ])
  } catch (error) {
    const commandError = error as ReadOnlyCommandError
    // ps exits 1 with no row when a process disappeared between the caller's
    // snapshot and this observation.  A permission/spawn failure is unknown.
    if (commandError.sourceCommand === '/bin/ps' && commandError.code === 1 && !commandError.stderr)
      throw new NativeProcessIdentityError('missing', 'native Darwin process is missing')
    if (error instanceof NativeProcessIdentityError) throw error
    const code = commandError.code
    if (code === 'EACCES' || code === 'EPERM') throw new NativeProcessIdentityError('permission', 'native Darwin process identity is not readable')
    throw new NativeProcessIdentityError('unavailable', 'native Darwin process identity is unavailable')
  }
  const line = processLine.trim()
  if (!line) throw new NativeProcessIdentityError('missing', 'native Darwin process is missing')
  const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
  if (!match) throw new NativeProcessIdentityError('malformed', 'native Darwin process listing is malformed')
  const listedPid = parsePositiveInteger(match[1]!, 'PID')
  if (listedPid !== pid) throw new NativeProcessIdentityError('unavailable', 'native Darwin process PID changed while reading identity')
  const parsedStart = Date.parse(match[5]!.trim())
  if (!Number.isFinite(parsedStart)) throw new NativeProcessIdentityError('malformed', 'native Darwin process start time is malformed')
  const bootId = parseDarwinBootIdentity(bootLine)
  return {
    platform: 'darwin',
    pid,
    ppid: parseNonnegativeInteger(match[2]!, 'parent PID'),
    pgid: parsePositiveInteger(match[3]!, 'process group ID'),
    sessionId: parseNonnegativeInteger(match[4]!, 'session ID'),
    // macOS ps/lstart is wall-clock seconds here.  It is useful for
    // diagnostics and mismatch detection, but cannot prove PID non-reuse.
    birth: { platform: 'darwin', bootId, startTimeSeconds: Math.floor(parsedStart / 1000), precision: 'seconds', reuseSafe: false },
  }
}

export async function readNativeProcessIdentity(pid: number, platform: NodeJS.Platform = process.platform): Promise<NativeProcessIdentity> {
  assertPid(pid)
  if (!supportedPlatform(platform)) throw new NativeProcessIdentityError('unsupported', `native process identity is unsupported on ${platform}`)
  return platform === 'linux' ? readLinuxIdentity(pid) : readDarwinIdentity(pid)
}

export function sameNativeProcessIdentity(expected: NativeProcessIdentity, observed: NativeProcessIdentity): boolean {
  return expected.platform === observed.platform && expected.pid === observed.pid && expected.ppid === observed.ppid &&
    expected.pgid === observed.pgid && expected.sessionId === observed.sessionId &&
    expected.birth.platform === observed.birth.platform && expected.birth.bootId === observed.birth.bootId &&
    (expected.birth.platform === 'linux' && observed.birth.platform === 'linux'
      ? expected.birth.startTimeTicks === observed.birth.startTimeTicks
      : expected.birth.platform === 'darwin' && observed.birth.platform === 'darwin' && expected.birth.startTimeSeconds === observed.birth.startTimeSeconds)
}

export async function observeNativeProcessIdentity(expected: NativeProcessIdentity, platform: NodeJS.Platform = process.platform): Promise<NativeProcessObservation> {
  try {
    const observed = await readNativeProcessIdentity(expected.pid, platform)
    if (!sameNativeProcessIdentity(expected, observed)) return { status: 'mismatch', identity: observed, safeForCleanup: false }
    return { status: 'matched', identity: observed, safeForCleanup: false }
  } catch (error) {
    if (error instanceof NativeProcessIdentityError) {
      if (error.reason === 'missing') return { status: 'missing', safeForCleanup: false }
      return { status: 'unknown', reason: error.reason, safeForCleanup: false }
    }
    return { status: 'unknown', reason: 'unavailable', safeForCleanup: false }
  }
}

export function nativeProcessIdentityErrorReason(error: unknown): NativeProcessIdentityFailureReason | undefined {
  return error instanceof NativeProcessIdentityError ? error.reason : undefined
}
