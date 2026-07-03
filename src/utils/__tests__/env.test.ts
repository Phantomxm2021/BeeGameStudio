import { afterEach, describe, expect, test } from 'bun:test'

import { getGlobalClaudeFile } from '../env.js'

const ORIGINAL_BEEGAME_CONFIG_DIR = process.env.BEEGAME_CONFIG_DIR
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR

function clearGlobalConfigPathCache(): void {
  getGlobalClaudeFile.cache?.clear?.()
}

afterEach(() => {
  if (ORIGINAL_BEEGAME_CONFIG_DIR === undefined) {
    delete process.env.BEEGAME_CONFIG_DIR
  } else {
    process.env.BEEGAME_CONFIG_DIR = ORIGINAL_BEEGAME_CONFIG_DIR
  }
  if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR
  }
  clearGlobalConfigPathCache()
})

describe('getGlobalClaudeFile', () => {
  test('uses a neutral config filename inside BeeGame runtime sessions', () => {
    process.env.BEEGAME_CONFIG_DIR = '/tmp/beegame-runtime/app'
    process.env.CLAUDE_CONFIG_DIR = '/tmp/beegame-runtime/core'
    clearGlobalConfigPathCache()

    const configPath = getGlobalClaudeFile()

    expect(configPath).toBe('/tmp/beegame-runtime/core/.config.json')
    expect(configPath).not.toMatch(/claude/i)
  })
})
