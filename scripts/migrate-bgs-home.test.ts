import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateBgsHome } from './migrate-bgs-home'
import { bgsHomeDirectory } from '../packages/agent-workflow-server/src/bgs/home'

test('home migration preserves bytes and old absolute references, writes new data under BGS, and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-migration-')), old = join(root, 'codex'), home = join(root, 'bgs')
  try {
    await mkdir(join(old, 'sessions'), { recursive: true })
    await writeFile(join(old, 'auth.json'), '{"fixture":"never-a-real-secret"}')
    await writeFile(join(old, 'sessions', 'saved.jsonl'), '{"runtime":"codex","original":true}\n')
    expect(() => bgsHomeDirectory(root)).toThrow('offline migration')
    expect((await migrateBgsHome(old, home)).migrated).toBe(false)
    expect(await readFile(join(old, 'auth.json'), 'utf8')).toContain('fixture')
    await expect(migrateBgsHome(old, home, true, () => { throw Error('busy') })).rejects.toThrow('busy')
    expect((await migrateBgsHome(old, home, true, () => {})).migrated).toBe(true)
    expect(await realpath(old)).toBe(await realpath(home))
    expect(await readFile(join(home, 'sessions', 'saved.jsonl'), 'utf8')).toBe('{"runtime":"codex","original":true}\n')
    expect(bgsHomeDirectory(root)).toBe(home)
    await writeFile(join(home, 'new.json'), '{}')
    expect(await readFile(join(old, 'new.json'), 'utf8')).toBe('{}')
    expect((await migrateBgsHome(old, home, true)).alreadyMigrated).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('migration refuses an existing destination instead of merging account data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-migration-collision-'))
  try {
    await mkdir(join(root, 'codex')); await mkdir(join(root, 'bgs'))
    await expect(migrateBgsHome(join(root, 'codex'), join(root, 'bgs'), true)).rejects.toThrow('refusing to merge')
  } finally { await rm(root, { recursive: true, force: true }) }
})
