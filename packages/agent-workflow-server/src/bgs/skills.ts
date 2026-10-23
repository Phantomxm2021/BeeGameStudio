import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { BgsClient } from './client'

/** Register the shared catalog and this owner's private imports before starting
 * or resuming a thread. Native discovery reads both sources directly. */
export async function configureBgsSkills(client: Pick<BgsClient, 'request'>, home: string, builtins: string, user: string) {
  await client.request('skills/extraRoots/set', { extraRoots: [builtins, user] })
  // Remove only our old discovery links after registration succeeds. Preserve
  // user files, system skills and the canonical source directories.
  const directory = join(home, 'skills')
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || (!entry.name.startsWith('bgs-builtin-') && !entry.name.startsWith('bgs-user-'))) continue
    await unlink(join(directory, entry.name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
