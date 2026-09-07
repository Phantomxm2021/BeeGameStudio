import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAuthorPersistence } from './persistence'

const key = '550e8400-e29b-41d4-a716-446655440000'

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'foundation-author-persistence-'))
}

describe('foundation author private persistence', () => {
  test('deep-copies JSON values and treats a missing key as absent', async () => {
    const root = await temporaryRoot()
    try {
      const persistence = createAuthorPersistence({ rootPath: root })
      expect(await persistence.load(key)).toBeUndefined()

      const value = { nested: { items: ['before'] } }
      await persistence.save(key, value)
      value.nested.items[0] = 'after'
      const loaded = await persistence.load<typeof value>(key)
      expect(loaded).toEqual({ nested: { items: ['before'] } })
      if (!loaded) throw new Error('expected persisted value')
      loaded.nested.items[0] = 'changed-in-memory'
      expect(await persistence.load<typeof value>(key)).toEqual({ nested: { items: ['before'] } })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('accepts UUID and hexadecimal opaque keys but rejects path-like keys', async () => {
    const root = await temporaryRoot()
    try {
      const persistence = createAuthorPersistence({ rootPath: root })
      await persistence.save('abcdef0123456789', { ok: true })
      await persistence.save('A'.repeat(64), { ok: true })
      for (const invalid of ['', '.', '..', '../escape', 'not-an-id', 'uuid/child']) {
        await expect(persistence.load(invalid)).rejects.toThrow()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('create is exclusive across competing instances', async () => {
    const root = await temporaryRoot()
    try {
      const instances = Array.from({ length: 12 }, () => createAuthorPersistence({ rootPath: root }))
      const results = await Promise.all(instances.map((persistence, index) => persistence.create(key, { winner: index })))
      expect(results.filter(Boolean)).toHaveLength(1)
      expect((await instances[0].load<{ winner: number }>(key))?.winner).toBeGreaterThanOrEqual(0)
      expect((await readFile(join(root, `${key}.json`), 'utf8')).endsWith('\n')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('save uses replacement writes that never expose partial JSON', async () => {
    const root = await temporaryRoot()
    try {
      const persistence = createAuthorPersistence({ rootPath: root })
      await persistence.save(key, { version: 0, payload: 'x'.repeat(2000) })
      const writes = Array.from({ length: 20 }, (_, version) =>
        persistence.save(key, { version, payload: 'x'.repeat(2000) }),
      )
      const reads = Array.from({ length: 40 }, async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const value = await persistence.load<{ version: number; payload: string }>(key)
          if (value) {
            expect(Number.isInteger(value.version)).toBe(true)
            expect(value.payload).toHaveLength(2000)
          }
          await Promise.resolve()
        }
      })
      await Promise.all([...writes, ...reads])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not turn corrupt JSON into an absent value', async () => {
    const root = await temporaryRoot()
    try {
      await writeFile(join(root, `${key}.json`), '{broken', 'utf8')
      const persistence = createAuthorPersistence({ rootPath: root })
      await expect(persistence.load(key)).rejects.toThrow(SyntaxError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects a symlink root and a symlink target', async () => {
    const parent = await temporaryRoot()
    const realRoot = join(parent, 'real')
    const rootLink = join(parent, 'root-link')
    const targetLink = join(parent, 'target-link.json')
    const ancestorLink = join(parent, 'ancestor-link')
    try {
      await mkdir(realRoot)
      await symlink(realRoot, rootLink)
      await expect(createAuthorPersistence({ rootPath: rootLink }).load(key)).rejects.toThrow(/symlink/)

      await symlink(realRoot, ancestorLink)
      await expect(createAuthorPersistence({ rootPath: join(ancestorLink, 'child') }).load(key)).rejects.toThrow(/symlink component/)

      await symlink(join(realRoot, 'outside.json'), targetLink)
      const persistence = createAuthorPersistence({ rootPath: realRoot })
      await symlink(join(realRoot, 'outside.json'), join(realRoot, `${key}.json`))
      await expect(persistence.load(key)).rejects.toThrow(/symlink/)
      await expect(persistence.save(key, { value: 1 })).rejects.toThrow(/symlink/)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test('withLock serializes instances and releases after failure', async () => {
    const root = await temporaryRoot()
    try {
      const first = createAuthorPersistence({ rootPath: root })
      const second = createAuthorPersistence({ rootPath: root })
      let acquired!: () => void
      let release!: () => void
      const acquiredSignal = new Promise<void>(resolve => { acquired = resolve })
      const held = new Promise<void>(resolve => { release = resolve })
      const running = first.withLock(key, async () => { acquired(); await held; return 'done' })
      await acquiredSignal
      await expect(second.withLock(key, () => 'nope')).rejects.toThrow(/busy/)
      release()
      await expect(running).resolves.toBe('done')
      await expect(first.withLock(key, () => { throw new Error('operation failed') })).rejects.toThrow('operation failed')
      await expect(first.withLock(key, () => 'recovered')).resolves.toBe('recovered')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('recovers only a lock whose recorded PID is definitely gone', async () => {
    const root = await temporaryRoot()
    try {
      await writeFile(join(root, `.${key}.lock`), JSON.stringify({
        pid: 999999999,
        token: 'stale-token',
        startedAt: Date.now(),
      }), 'utf8')
      const persistence = createAuthorPersistence({ rootPath: root })
      await expect(persistence.withLock(key, () => 'recovered')).resolves.toBe('recovered')

      await writeFile(join(root, `.${key}.lock`), '{broken', 'utf8')
      await expect(persistence.withLock(key, () => 'must-not-run')).rejects.toThrow(/unreadable/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('serializes concurrent stale-lock recovery so a loser cannot delete the new lease', async () => {
    const root = await temporaryRoot()
    try {
      await writeFile(join(root, `.${key}.lock`), JSON.stringify({
        pid: 999999999,
        token: 'stale-token',
        startedAt: Date.now(),
      }), 'utf8')
      const first = createAuthorPersistence({ rootPath: root })
      const second = createAuthorPersistence({ rootPath: root })
      let acquired!: () => void
      let release!: () => void
      const acquiredSignal = new Promise<void>(resolve => { acquired = resolve })
      const held = new Promise<void>(resolve => { release = resolve })
      const owner = first.withLock(key, async () => {
        acquired()
        await held
        return 'owner'
      })
      await acquiredSignal
      await expect(second.withLock(key, () => 'loser')).rejects.toThrow(/busy/)
      release()
      await expect(owner).resolves.toBe('owner')
      await expect(second.withLock(key, () => 'after')).resolves.toBe('after')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
