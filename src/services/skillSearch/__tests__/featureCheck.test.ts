import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from '../../../utils/envUtils.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import { isSkillSearchEnabled } from '../featureCheck.js'

let root: string
const originalEnv = { ...process.env }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-search-feature-check-'))
  process.env = { ...originalEnv }
  process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
  delete process.env.SKILL_SEARCH_ENABLED
  getClaudeConfigHomeDir.cache?.clear?.()
  resetSettingsCache()
})

afterEach(() => {
  process.env = { ...originalEnv }
  getClaudeConfigHomeDir.cache?.clear?.()
  resetSettingsCache()
  rmSync(root, { recursive: true, force: true })
})

describe('skill search feature check', () => {
  test('uses admin-provided runtime settings without requiring an env toggle', () => {
    mkdirSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true })
    writeFileSync(
      join(process.env.CLAUDE_CONFIG_DIR!, 'settings.json'),
      `${JSON.stringify({ skillSearchEnabled: true }, null, 2)}\n`,
      'utf8',
    )

    expect(isSkillSearchEnabled()).toBe(true)
  })
})
