import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile, readdir, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const repository = resolve(import.meta.dir, '../../../../../../../..')
const archive = join(repository, 'archive/reviewer-pre-native-file')
type Entry = { source: string; archive: string; bytes: number; sha256: string }

test('retired source snapshots remain byte-verifiable, non-executable and absent from active strategy paths', async () => {
  const manifests = (await readdir(archive)).filter(name => name.endsWith('.manifest.json'))
  expect(manifests.length).toBeGreaterThan(0)
  for (const name of manifests) {
    const { entries } = JSON.parse(await readFile(join(archive, name), 'utf8')) as { entries: Entry[] }
    for (const entry of entries) {
      expect(entry.archive).toBe('archive/reviewer-pre-native-file/sources/' + entry.source + '.txt')
      expect(entry.source.split('/')).not.toContain('..')
      const bytes = await readFile(join(repository, entry.archive))
      expect(bytes.length).toBe(entry.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      if (name === 'modules.manifest.json' || (name === 'reliability.manifest.json' && !entry.source.endsWith('/README.md')))
        await expect(access(join(repository, entry.source))).rejects.toThrow()
    }
  }
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      expect(entry.isSymbolicLink()).toBe(false)
      if (entry.isDirectory()) await walk(join(directory, entry.name))
      else expect(entry.name).not.toMatch(/\.[cm]?[jt]sx?$/)
    }
  }
  await walk(archive)
})
