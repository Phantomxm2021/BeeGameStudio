import { mkdtemp, mkdir, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  readProjectArtifactPublicationToken,
  readCanonicalProjectArtifactConsistently,
} from './project-artifact-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'beegame-artifacts-'))
  temporaryDirectories.push(path)
  return path
}

async function writeLegacyCommit(root: string, token = 'a'.repeat(64)) {
  const directory = join(root, '.beegame/artifacts')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'materialization.json')
  await writeFile(path, JSON.stringify({ version: 1, publicationId: 'legacy-publication',
    snapshotDigest: 'b'.repeat(64), token }))
  return path
}

describe('canonical project artifact reads with legacy metadata', () => {
  it('reads current workspace bytes without creating a store when legacy metadata is absent', async () => {
    const root = await workspace()
    await writeFile(join(root, 'a.txt'), 'current bytes')
    expect(await readProjectArtifactPublicationToken(join(root, 'missing'))).toBeUndefined()
    expect(await readProjectArtifactPublicationToken(root)).toBeUndefined()
    expect(await readCanonicalProjectArtifactConsistently(root, () => readFile(join(root, 'a.txt'), 'utf8')))
      .toBe('current bytes')
    expect(await readdir(root)).toEqual(['a.txt'])
  })

  it('detects changed commits across a real read and fails closed on pending work', async () => {
    const root = await workspace()
    const commitPath = await writeLegacyCommit(root)
    const commit = await readFile(commitPath, 'utf8')
    await writeFile(join(root, 'a.txt'), 'one')
    expect(await readProjectArtifactPublicationToken(root)).toBe('a'.repeat(64))
    expect(await readCanonicalProjectArtifactConsistently(root, () => readFile(join(root, 'a.txt'), 'utf8'))).toBe('one')
    expect(await readFile(commitPath, 'utf8')).toBe(commit)

    await expect(readCanonicalProjectArtifactConsistently(root, async () => {
      const bytes = await readFile(join(root, 'a.txt'), 'utf8')
      await writeLegacyCommit(root, 'c'.repeat(64))
      return bytes
    })).rejects.toThrow(/changed during canonical read/i)

    const pending = join(root, '.beegame/artifacts/pending')
    await mkdir(pending)
    const pendingPath = join(pending, 'race.json')
    await writeFile(pendingPath, '{}')
    let called = false
    await expect(readCanonicalProjectArtifactConsistently(root, async () => { called = true }))
      .rejects.toThrow(/pending transaction/i)
    expect(called).toBe(false)
    expect(await readFile(pendingPath, 'utf8')).toBe('{}')
  })

  it.each(['{not-json', '{}', JSON.stringify({ version: 1, publicationId: 'legacy',
    snapshotDigest: 'b'.repeat(64), token: 'invalid' }), JSON.stringify({ version: 1,
    publicationId: 'legacy', snapshotDigest: 'b'.repeat(64), token: 'a'.repeat(64) }) + ' '])(
    'rejects corrupt or noncanonical legacy commit metadata: %s', async raw => {
      const root = await workspace(), path = await writeLegacyCommit(root)
      await writeFile(path, raw)
      await expect(readProjectArtifactPublicationToken(root)).rejects.toThrow(/metadata|materialization commit/i)
      expect(await readFile(path, 'utf8')).toBe(raw)
    })

  it('rejects oversized legacy metadata before reading its contents', async () => {
    const root = await workspace(), path = await writeLegacyCommit(root)
    await truncate(path, 32 * 1024 * 1024 + 1)
    await expect(readProjectArtifactPublicationToken(root)).rejects.toThrow(/maximum size/i)
  })

  it('rejects symlinked store parents and commit files', async () => {
    const root = await workspace(), outside = await workspace()
    await symlink(outside, join(root, '.beegame'))
    await expect(readProjectArtifactPublicationToken(root)).rejects.toThrow(/symlink/i)
    const clean = await workspace(), path = await writeLegacyCommit(clean)
    const target = join(outside, 'commit.json')
    await writeFile(target, await readFile(path))
    await rm(path)
    await symlink(target, path)
    await expect(readProjectArtifactPublicationToken(clean)).rejects.toThrow(/symlink/i)
  })
})
