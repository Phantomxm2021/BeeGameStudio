import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeWorkspaceRevision } from './workspace-revision'

test('authored source bytes affect revision; excluded dependencies and outputs do not', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-source-revision-'))
  try {
    await writeFile(join(root, 'entry.js'), 'A')
    const before = await computeWorkspaceRevision(root)
    for (const name of ['node_modules', 'dist']) await symlink('missing-excluded-target', join(root, name))
    expect(await computeWorkspaceRevision(root)).toBe(before)
    await writeFile(join(root, 'entry.js'), 'B')
    expect(await computeWorkspaceRevision(root)).not.toBe(before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each(['file', 'directory', 'dangling'] as const)('source %s symlinks fail explicitly instead of receiving an incomplete identity', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-source-symlink-'))
  try {
    await mkdir(join(root, 'src'))
    if (kind === 'file') await writeFile(join(root, 'target'), 'A')
    if (kind === 'directory') await mkdir(join(root, 'target'))
    await symlink('../target', join(root, 'src/entry'))
    await expect(computeWorkspaceRevision(root)).rejects.toThrow('unsupported symbolic link: src/entry')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an unavailable workspace cannot receive a valid-looking empty revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-source-unavailable-'))
  try {
    await expect(computeWorkspaceRevision(join(root, 'missing'))).rejects.toThrow()
    await writeFile(join(root, 'not-a-directory'), 'fixture')
    await expect(computeWorkspaceRevision(join(root, 'not-a-directory'))).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
