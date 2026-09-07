import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { lstat, open, link, unlink } from 'node:fs/promises'
import { z } from 'zod/v4'
import {
  acceptRevisionRequest,
  readRevisionRequestByHandle,
} from './request-store'
import { prepareRevisionRequest } from './request-preparation'
import { revisionCanonicalJson, revisionDigest } from './json-digest'

/** The owner record is deliberately small: it is an identity claim, not a
 * heartbeat or a recovery instruction.  In particular, a dead pid never
 * authorizes another process to remove or replace this record.
 */
const MAX_OWNER_RECORD_BYTES = 4096
const ownerRecordSchema = z
  .object({
    protocolVersion: z.literal(1),
    producer: z.literal('foundation-revision'),
    handle: z.uuid(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    ownerToken: z.uuid(),
    pid: z.number().int().positive().safe(),
  })
  .strict()

export type RevisionExecutionOwnerRecord = z.infer<typeof ownerRecordSchema>
export type RevisionExecutionLeaseStatus = 'free' | 'busy' | 'stale'

export type RevisionExecutionLeaseOwned = {
  kind: 'owned'
  assertOwned: () => Promise<void>
  release: () => Promise<void>
}

export type RevisionExecutionLeaseAcquireResult =
  | { kind: 'busy' }
  | { kind: 'stale' }
  | RevisionExecutionLeaseOwned

export class RevisionExecutionLeaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RevisionExecutionLeaseError'
  }
}

async function assertDirectories(path: string): Promise<void> {
  let cursor = path
  while (cursor !== parse(cursor).root) {
    const entry = await lstat(cursor)
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new RevisionExecutionLeaseError(
        'Revision execution lease parent must be a real directory',
      )
    cursor = dirname(cursor)
  }
}

async function syncDirectory(path: string): Promise<void> {
  await assertDirectories(path)
  const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function readOwnerRecord(
  path: string,
): Promise<RevisionExecutionOwnerRecord | undefined> {
  await assertDirectories(dirname(path))
  let entry
  try {
    entry = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.size > MAX_OWNER_RECORD_BYTES
  )
    throw new RevisionExecutionLeaseError(
      'Revision execution owner record is not a small regular file',
    )

  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_OWNER_RECORD_BYTES)
      throw new RevisionExecutionLeaseError(
        'Revision execution owner record is not a small regular file',
      )
    const body = await file.readFile('utf8')
    if (Buffer.byteLength(body, 'utf8') > MAX_OWNER_RECORD_BYTES)
      throw new RevisionExecutionLeaseError(
        'Revision execution owner record is too large',
      )
    let value: unknown
    try {
      value = JSON.parse(body)
    } catch {
      throw new RevisionExecutionLeaseError(
        'Revision execution owner record is not valid JSON',
      )
    }
    let record: RevisionExecutionOwnerRecord
    try {
      record = ownerRecordSchema.parse(value)
    } catch {
      throw new RevisionExecutionLeaseError(
        'Revision execution owner record has invalid shape',
      )
    }
    if (body !== `${revisionCanonicalJson(record)}\n`)
      throw new RevisionExecutionLeaseError(
        'Revision execution owner record is not canonical',
      )
    return structuredClone(record)
  } finally {
    await file.close()
  }
}

function sameOwnerRecord(
  left: RevisionExecutionOwnerRecord,
  right: RevisionExecutionOwnerRecord,
): boolean {
  return revisionCanonicalJson(left) === revisionCanonicalJson(right)
}

function assertExpectedRecord(
  record: RevisionExecutionOwnerRecord,
  expected: Pick<RevisionExecutionOwnerRecord, 'handle' | 'requestDigest'>,
): void {
  if (
    record.handle !== expected.handle ||
    record.requestDigest !== expected.requestDigest
  )
    throw new RevisionExecutionLeaseError(
      'Revision execution owner record request binding mismatch',
    )
}

function processLiveness(pid: number): 'busy' | 'stale' {
  try {
    // Signal zero is an explicitly read-only liveness probe.  No other signal
    // is ever sent by this module, and an unknown error is fail-closed busy.
    process.kill(pid, 0)
    return 'busy'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'stale'
    return 'busy'
  }
}

async function publishOwnerRecord(
  path: string,
  record: RevisionExecutionOwnerRecord,
): Promise<boolean> {
  const body = `${revisionCanonicalJson(record)}\n`
  if (Buffer.byteLength(body, 'utf8') > MAX_OWNER_RECORD_BYTES)
    throw new RevisionExecutionLeaseError(
      'Revision execution owner record is too large',
    )
  const directory = dirname(path)
  await assertDirectories(directory)
  const temporary = join(directory, `.pending-owner-${randomUUID()}`)
  const file = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  )
  let created = false
  try {
    try {
      try {
        await file.writeFile(body)
        await file.sync()
      } finally {
        await file.close()
      }
      await assertDirectories(directory)
      try {
        // Hardlink is the compare-and-create commit point.  It cannot expose a
        // partially written owner record and never replaces an existing owner.
        await link(temporary, path)
        created = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw error
      }
      await syncDirectory(directory)
      return true
    } finally {
      try {
        await unlink(temporary)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  } catch (error) {
    // No owned token has escaped and no worker may have started. If creation
    // committed but its directory sync/temporary cleanup failed, roll back
    // only this exact unpublished ownership claim, never another contender.
    if (created) {
      const current = await readOwnerRecord(path)
      if (current && sameOwnerRecord(current, record)) {
        await unlink(path)
        await syncDirectory(directory)
      }
    }
    throw error
  }
}

export type RevisionExecutionLease = {
  status: () => Promise<RevisionExecutionLeaseStatus>
  acquire: () => Promise<RevisionExecutionLeaseAcquireResult>
}

/**
 * Open the one lifecycle owner lane for an accepted Revision request.
 *
 * Normal opens admit the request first; read-only opens resolve an existing
 * opaque handle and never create directories or an owner record.  A stale
 * record is observable but is never reclaimed by this API.
 */
export async function openRevisionExecutionLease(
  workspacePath: string,
  requestValue: unknown,
  options: { readOnlyHandle?: string } = {},
): Promise<RevisionExecutionLease> {
  // Capture before the first await, matching the Revision request-store
  // boundary and preventing caller mutation while admission is in flight.
  const request = JSON.parse(revisionCanonicalJson(requestValue)) as unknown
  const readOnlyHandle = options.readOnlyHandle
  const accepted = readOnlyHandle
    ? await readRevisionRequestByHandle(
        workspacePath,
        readOnlyHandle,
        prepareRevisionRequest(request).request.ownerId,
      )
    : await acceptRevisionRequest(workspacePath, request)
  if (accepted.record.requestDigest !== revisionDigest(request))
    throw new RevisionExecutionLeaseError(
      'Revision execution lease request binding mismatch',
    )

  const requestRoot = dirname(
    join(resolve(workspacePath), accepted.artifactPath),
  )
  // Request admission creates this canonical directory for normal opens;
  // handle lookup has already verified it for read-only opens. Recheck it at
  // the lease boundary so a namespace swap fails closed.
  await assertDirectories(requestRoot)
  const ownerPath = join(requestRoot, 'execution-owner.json')
  const expected = {
    handle: accepted.record.handle,
    requestDigest: accepted.record.requestDigest,
  }

  async function status(): Promise<RevisionExecutionLeaseStatus> {
    const record = await readOwnerRecord(ownerPath)
    if (!record) return 'free'
    assertExpectedRecord(record, expected)
    return processLiveness(record.pid)
  }

  async function acquire(): Promise<RevisionExecutionLeaseAcquireResult> {
    if (readOnlyHandle)
      throw new RevisionExecutionLeaseError(
        'Revision read-only execution lease cannot acquire',
      )
    const current = await readOwnerRecord(ownerPath)
    if (current) {
      assertExpectedRecord(current, expected)
      return { kind: processLiveness(current.pid) }
    }

    const record: RevisionExecutionOwnerRecord = {
      protocolVersion: 1,
      producer: 'foundation-revision',
      handle: accepted.record.handle,
      requestDigest: accepted.record.requestDigest,
      ownerToken: randomUUID(),
      pid: process.pid,
    }
    if (!(await publishOwnerRecord(ownerPath, record))) {
      const winner = await readOwnerRecord(ownerPath)
      if (!winner)
        throw new RevisionExecutionLeaseError(
          'Revision execution owner disappeared during acquire',
        )
      assertExpectedRecord(winner, expected)
      return { kind: processLiveness(winner.pid) }
    }

    let released = false
    let releasePromise: Promise<void> | undefined
    const assertOwned = async (): Promise<void> => {
      if (released || releasePromise)
        throw new RevisionExecutionLeaseError(
          'Revision execution lease is released',
        )
      const current = await readOwnerRecord(ownerPath)
      if (!current || !sameOwnerRecord(current, record))
        throw new RevisionExecutionLeaseError(
          'Revision execution lease ownership was lost',
        )
    }
    const releaseOnce = async (): Promise<void> => {
      const current = await readOwnerRecord(ownerPath)
      if (!current || !sameOwnerRecord(current, record))
        throw new RevisionExecutionLeaseError(
          'Revision execution lease ownership was lost',
        )
      const entry = await lstat(ownerPath)
      if (entry.isSymbolicLink() || !entry.isFile())
        throw new RevisionExecutionLeaseError(
          'Revision execution owner record is not a regular file',
        )
      await unlink(ownerPath)
      await syncDirectory(requestRoot)
      released = true
    }
    // One token may be released only once even if local cleanup paths race.
    // Otherwise a second read-before-unlink could delete a newly acquired
    // successor after the first release has removed our owner record.
    const release = (): Promise<void> => (releasePromise ??= releaseOnce())
    return { kind: 'owned', assertOwned, release }
  }

  return { status, acquire }
}
