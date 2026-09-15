import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { journalImmutableFiles } from './journal-storage'

export const files = journalImmutableFiles

/** Atomic mutable compiler evidence; never follow a symlink while reading. */
export async function readFile(path: string, _encoding: 'utf8'): Promise<string> {
  await files.assertDirectories(dirname(path))
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('IR evidence must be a regular file')
    return await handle.readFile('utf8')
  } finally { await handle.close() }
}

export async function durableWrite(path: string, content: string): Promise<void> {
  await files.ensureDirectories(dirname(path))
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
  try {
    await files.assertDirectories(dirname(path))
    await rename(temporary, path)
    const directory = await open(dirname(path), constants.O_RDONLY)
    try { await directory.sync() } finally { await directory.close() }
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}
