import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { acceptRevisionRequest } from '../request-store'
import { openRevisionExecutionLease } from '../execution-lease'

/**
 * This file is a deliberately isolated child-process fixture.  The fs
 * prototype is patched here, never in the parent Bun test process, so one
 * directory-sync failure cannot contaminate unrelated tests.
 */
export async function runPostLinkDirectorySyncFault(
  workspacePath: string,
  request: unknown,
) {
  const accepted = await acceptRevisionRequest(workspacePath, request)
  const requestRoot = dirname(join(workspacePath, accepted.artifactPath))
  const lease = await openRevisionExecutionLease(workspacePath, request)
  const directoryHandle = await open(requestRoot, constants.O_RDONLY | constants.O_NOFOLLOW)
  type SyncTarget = { stat: () => Promise<{ ino: number; dev: number }> }
  const prototype = Object.getPrototypeOf(directoryHandle) as {
    sync: (this: SyncTarget) => Promise<void>
  }
  const originalSync = prototype.sync
  const target = await directoryHandle.stat()
  let injected = false
  prototype.sync = async function patchedSync(this: SyncTarget) {
    const current = await this.stat()
    if (!injected && current.ino === target.ino && current.dev === target.dev) {
      injected = true
      throw new Error('injected post-link directory sync failure')
    }
    return originalSync.call(this)
  }

  try {
    const first = await lease.acquire().then(
      () => ({ ok: false as const, error: 'acquire unexpectedly succeeded' }),
      error => ({ ok: true as const, error: String(error instanceof Error ? error.message : error) }),
    )
    if (!first.ok) return first
  } finally {
    prototype.sync = originalSync
    await directoryHandle.close()
  }

  const ownerPath = join(requestRoot, 'execution-owner.json')
  const afterFailure = await lease.status()
  if (afterFailure !== 'free') return { ok: false as const, error: `expected free after rollback, got ${afterFailure}` }
  const reacquired = await lease.acquire()
  if (reacquired.kind !== 'owned') return { ok: false as const, error: `expected reacquire, got ${reacquired.kind}` }
  await reacquired.assertOwned()
  await reacquired.release()
  return { ok: true as const, ownerPath, injected }
}

if (import.meta.main) {
  const workspacePath = process.argv[2]
  const requestJson = process.argv[3]
  if (!workspacePath || requestJson === undefined) throw new Error('fixture requires workspace and JSON request')
  const result = await runPostLinkDirectorySyncFault(workspacePath, JSON.parse(requestJson))
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) process.exitCode = 1
}
