import { afterEach, describe, expect, test } from 'bun:test'

import { getProjectStorageKey } from '../sessionStoragePortable.js'

const ORIGINAL_BEEGAME_CONFIG_DIR = process.env.BEEGAME_CONFIG_DIR

afterEach(() => {
  if (ORIGINAL_BEEGAME_CONFIG_DIR === undefined) {
    delete process.env.BEEGAME_CONFIG_DIR
  } else {
    process.env.BEEGAME_CONFIG_DIR = ORIGINAL_BEEGAME_CONFIG_DIR
  }
})

describe('getProjectStorageKey', () => {
  test('uses a neutral hash key for BeeGame runtime project storage', () => {
    process.env.BEEGAME_CONFIG_DIR = '/tmp/beegame-runtime/app'

    const storageKey = getProjectStorageKey(
      '/Users/example/claude-code-main/Projects/users/user-id/game',
    )

    expect(storageKey).toMatch(/^project-[a-z0-9-]+$/)
    expect(storageKey).not.toContain('Users')
    expect(storageKey).not.toMatch(/claude/i)
  })
})
