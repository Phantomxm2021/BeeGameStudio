import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type HostBootIdentity = { machine: string; boot: string }
const execute = promisify(execFile)

/** Kernel/platform facts, never hostname, uptime arithmetic, PID absence or
 * project files. Unsupported hosts retain the normal receipt-only recovery. */
export async function readHostBootIdentity(): Promise<HostBootIdentity | undefined> {
  // Start with the actual local host. Do not assume container machine-id or
  // cross-platform process ownership semantics have been validated.
  if (process.platform === 'darwin') {
    const options = { timeout: 2000, maxBuffer: 256 * 1024 }
    const [hardware, session] = await Promise.all([
      execute('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], options),
      execute('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], options),
    ])
    const machine = hardware.stdout.match(/"IOPlatformUUID"\s*=\s*"([a-f0-9-]{36})"/i)?.[1]
    const boot = session.stdout.trim()
    if (!machine || !/^[a-f0-9-]{36}$/i.test(boot)) throw Error('Invalid kernel host identity')
    return { machine, boot }
  }
  return undefined
}
