import { randomUUID } from 'node:crypto'
import {
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  lstat,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, join, parse, resolve } from 'node:path'

export type AuthorPersistence = {
  load<T>(key: string): Promise<T | undefined>
  save<T>(key: string, value: T): Promise<void>
  create<T>(key: string, value: T): Promise<boolean>
  withLock<T>(key: string, operation: () => T | Promise<T>): Promise<T>
}

type AuthorPersistenceOptions = {
  rootPath: string
}

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX_KEY = /^[0-9a-f]+$/i

function assertKey(key: string): void {
  if (typeof key !== 'string' || (!UUID_KEY.test(key) && !HEX_KEY.test(key))) {
    throw new Error('author persistence key must be a UUID or hexadecimal opaque ID')
  }
}

function jsonCopy<T>(value: T): T {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch (error) {
    throw new Error(`author persistence value is not JSON serializable: ${String(error)}`)
  }
  if (encoded === undefined) throw new Error('author persistence value is not JSON serializable')
  try {
    return JSON.parse(encoded) as T
  } catch (error) {
    throw new Error(`author persistence value is not valid JSON: ${String(error)}`)
  }
}

async function ensureRoot(rootPath: string): Promise<string> {
  const root = resolve(rootPath)
  await assertNoInjectedSymlink(root)
  await mkdir(root, { recursive: true })
  await assertNoInjectedSymlink(root)
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error('author persistence root must be a real directory')
  }
  return realpath(root)
}

async function assertNoInjectedSymlink(path: string): Promise<void> {
  const parsed = parse(path)
  let current = parsed.root
  for (const component of path.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, component)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (info.isSymbolicLink()) {
      // macOS commonly exposes /tmp as /private/tmp.  Treat that fixed OS
      // alias as the one platform alias, while rejecting injected links.
      const canonical = await realpath(current)
      if ((current === '/tmp' && canonical === '/private/tmp') ||
          (current === '/var' && canonical === '/private/var')) continue
      throw new Error('author persistence root contains a symlink component')
    }
  }
}

async function assertRealTarget(targetPath: string): Promise<boolean> {
  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) throw new Error('author persistence target must not be a symlink')
    if (!info.isFile()) throw new Error('author persistence target must be a regular file')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function flushDirectory(root: string): Promise<void> {
  // Directory fsync is supported on the production Unix hosts.  Keep this
  // best-effort for filesystems (and test runners) that do not expose it.
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(root, 'r')
    await handle.sync()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EINVAL' && code !== 'EISDIR' && code !== 'ENOTSUP') throw error
  } finally {
    await handle?.close()
  }
}

async function removeAndFlush(root: string, path: string): Promise<void> {
  await unlink(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
  await flushDirectory(root)
}

async function writeAtomically(root: string, target: string, contents: string): Promise<void> {
  const temporary = join(root, `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    await flushDirectory(root)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function createExclusively(root: string, target: string, contents: string): Promise<boolean> {
  const temporary = join(root, `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
    await flushDirectory(root)
    return true
  } finally {
    await unlink(temporary).catch(() => undefined)
    // The directory flush above makes the publication durable; this second
    // flush makes cleanup of the unlinked temporary name durable as well.
    await flushDirectory(root)
  }
}

type LockRecord = {
  pid: number
  token: string
  startedAt: number
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH is the only reliable indication available without making any
    // assumptions about a PID's replacement identity.  Every other outcome
    // is treated as busy, which is deliberately conservative about PID reuse.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function acquireLock(root: string, key: string): Promise<{ path: string; token: string }> {
  const path = join(root, `.${key}.lock`)
  const guardPath = join(root, `.${key}.recover.lock`)
  const guardToken = randomUUID()
  const guardTemporary = join(root, `.${key}.recover.${guardToken}.tmp`)
  let guardTemporaryCreated = false
  try {
    await assertRealTarget(guardPath)
    const guardHandle = await open(guardTemporary, 'wx', 0o600)
    guardTemporaryCreated = true
    try {
      await guardHandle.writeFile(guardToken, 'utf8')
      await guardHandle.sync()
    } finally {
      await guardHandle.close()
    }
    let guardOwned = false
    try {
      try {
        await link(guardTemporary, guardPath)
        guardOwned = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error('author persistence key recovery is busy; manual recovery is required')
        }
        throw error
      }
      await removeAndFlush(root, guardTemporary)

      const existing = await assertRealTarget(path)
      if (existing) {
        let record: LockRecord
        try {
          record = JSON.parse(await readFile(path, 'utf8')) as LockRecord
        } catch (error) {
          throw new Error(`author persistence lock is unreadable: ${String(error)}`)
        }
        if (!Number.isSafeInteger(record.pid) || typeof record.token !== 'string' || record.token.length === 0) {
          throw new Error('author persistence lock is invalid')
        }
        if (isProcessAlive(record.pid)) throw new Error('author persistence key is busy')
        // The guard serializes this check and deletion with every other acquire.
        // Never steal a live/reused PID and never TTL-steal an unknown lock.
        await removeAndFlush(root, path)
      }

      const token = randomUUID()
      const published = await createExclusively(
        root,
        path,
        JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }),
      )
      if (!published) throw new Error('author persistence key is busy')
      return { path, token }
    } finally {
      if (guardOwned) {
        if (await assertRealTarget(guardPath)) await removeAndFlush(root, guardPath)
      }
      else await unlink(guardTemporary).catch(() => undefined)
    }
  } catch (error) {
    if (guardTemporaryCreated) await unlink(guardTemporary).catch(() => undefined)
    throw error
  }
}

async function releaseLock(lock: { path: string; token: string }): Promise<void> {
  if (!(await assertRealTarget(lock.path))) return
  const record = JSON.parse(await readFile(lock.path, 'utf8')) as LockRecord
  if (record.token === lock.token && record.pid === process.pid) {
    await removeAndFlush(dirname(lock.path), lock.path)
  }
}

export function createAuthorPersistence({ rootPath }: AuthorPersistenceOptions): AuthorPersistence {
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    throw new Error('author persistence rootPath is required')
  }
  const root = resolve(rootPath)

  async function targetFor(key: string): Promise<string> {
    assertKey(key)
    const actualRoot = await ensureRoot(root)
    return join(actualRoot, `${key}.json`)
  }

  return {
    async load<T>(key: string): Promise<T | undefined> {
      const target = await targetFor(key)
      if (!(await assertRealTarget(target))) return undefined
      const contents = await readFile(target, 'utf8')
      // Do not turn malformed persisted state into a cache miss.
      return JSON.parse(contents) as T
    },

    async save<T>(key: string, value: T): Promise<void> {
      const contents = JSON.stringify(jsonCopy(value))
      const target = await targetFor(key)
      await assertRealTarget(target)
      if (contents === undefined) throw new Error('author persistence value is not JSON serializable')
      await writeAtomically(root, target, contents)
    },

    async create<T>(key: string, value: T): Promise<boolean> {
      const contents = JSON.stringify(jsonCopy(value))
      const target = await targetFor(key)
      await assertRealTarget(target)
      if (contents === undefined) throw new Error('author persistence value is not JSON serializable')
      return createExclusively(root, target, contents)
    },

    async withLock<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
      const target = await targetFor(key)
      const lock = await acquireLock(dirname(target), key)
      try {
        return await operation()
      } finally {
        await releaseLock(lock)
      }
    },
  }
}
