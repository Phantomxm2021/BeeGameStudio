import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..')

describe('Docker dependency registry', () => {
  test('keeps Bun lockfile tarballs on the npm registry for reproducible Docker builds', () => {
    const lockfile = readFileSync(join(repoRoot, 'bun.lock'), 'utf8')

    expect(lockfile).not.toContain('registry.npmmirror.com')
    expect(lockfile).toContain('registry.npmjs.org')
  })
})
