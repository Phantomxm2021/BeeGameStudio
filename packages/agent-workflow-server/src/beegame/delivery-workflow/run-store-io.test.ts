import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunStore } from './run-store'

test.skipIf(process.getuid?.() === 0)('unwritable lock storage reports I/O failure instead of retrying lock contention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-lock-io-'))
  const directory = join(root, '.beegame/workflow')
  await mkdir(directory, { recursive: true })
  await chmod(directory, 0o500)
  try {
    await expect(createRunStore(root, 'owner').lock('run')).rejects.toMatchObject({ code: 'io' })
  } finally {
    await chmod(directory, 0o700)
    await rm(root, { recursive: true, force: true })
  }
}, 2000)
