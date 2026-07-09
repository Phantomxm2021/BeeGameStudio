import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearCommandsCache } from '../../../commands.js'
import { getTurnZeroSkillDiscovery } from '../prefetch.js'
import { clearSkillIndexCache, getSkillIndex } from '../localSearch.js'

let root: string
let previousCwd: string
const originalEnv = { ...process.env }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-search-prefetch-'))
  previousCwd = process.cwd()
  process.chdir(root)
  process.env = { ...originalEnv }
  process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
  process.env.CLAUDE_SKILL_LEARNING_HOME = join(root, 'learning')
  process.env.SKILL_SEARCH_ENABLED = '1'
  process.env.SKILL_LEARNING_ENABLED = '1'
  process.env.NODE_ENV = 'test'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  clearCommandsCache()
  clearSkillIndexCache()
})

afterEach(() => {
  process.chdir(previousCwd)
  process.env = { ...originalEnv }
  clearCommandsCache()
  clearSkillIndexCache()
  try {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  } catch {
    // Windows can keep transient handles after dynamic command loading.
  }
})

describe('skill search prefetch', () => {
  test('auto-loads high-confidence project skill content', async () => {
    const skillDir = join(root, '.claude', 'skills', 'feature-audit')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: feature-audit',
        'description: Audit feature flags and classify minimal implementations',
        '---',
        '',
        '# Feature Audit',
        '',
        'Use the feature flag audit workflow and classify flags as stub, shell, MVP, or thin-toggle.',
      ].join('\n'),
    )

    const attachment = await getTurnZeroSkillDiscovery(
      'audit feature flags for minimal implementation stubs',
      [],
      { agentId: undefined } as any,
    )

    expect(attachment?.type).toBe('skill_discovery')
    if (attachment?.type !== 'skill_discovery') {
      throw new Error('expected skill_discovery attachment')
    }
    expect(attachment.skills[0]?.name).toBe('feature-audit')
    expect(attachment.skills[0]?.autoLoaded).toBe(true)
    expect(attachment.skills[0]?.content).toContain(
      'feature flag audit workflow',
    )
  })

  test('records a pending skill gap on the first unmatched prompt (no draft file yet)', async () => {
    const attachment = await getTurnZeroSkillDiscovery(
      'frobnicate zephyr ledger workflow',
      [],
      { agentId: undefined } as any,
    )

    expect(attachment?.type).toBe('skill_discovery')
    if (attachment?.type !== 'skill_discovery') {
      throw new Error('expected skill_discovery attachment')
    }
    expect(attachment.skills).toEqual([])
    expect(attachment.gap?.status).toBe('pending')
    expect(attachment.gap?.draftPath).toBeUndefined()
  })

  test('keeps skill index scoped by CLAUDE_CONFIG_DIR for the same cwd', async () => {
    const cwd = join(root, 'game')
    const userAConfigDir = join(root, 'user-a-runtime')
    const userBConfigDir = join(root, 'user-b-runtime')
    mkdirSync(join(userAConfigDir, 'skills', 'user-a-index-skill'), {
      recursive: true,
    })
    mkdirSync(join(userBConfigDir, 'skills', 'user-b-index-skill'), {
      recursive: true,
    })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      join(userAConfigDir, 'skills', 'user-a-index-skill', 'SKILL.md'),
      [
        '---',
        'name: user-a-index-skill',
        'description: Indexed skill only visible to user A.',
        '---',
        '',
        '# User A Index Skill',
      ].join('\n'),
    )
    writeFileSync(
      join(userBConfigDir, 'skills', 'user-b-index-skill', 'SKILL.md'),
      [
        '---',
        'name: user-b-index-skill',
        'description: Indexed skill only visible to user B.',
        '---',
        '',
        '# User B Index Skill',
      ].join('\n'),
    )

    process.env.CLAUDE_CONFIG_DIR = userAConfigDir
    const userAIndex = await getSkillIndex(cwd)

    process.env.CLAUDE_CONFIG_DIR = userBConfigDir
    const userBIndex = await getSkillIndex(cwd)

    expect(userAIndex.map(skill => skill.name)).toContain('user-a-index-skill')
    expect(userAIndex.map(skill => skill.name)).not.toContain(
      'user-b-index-skill',
    )
    expect(userBIndex.map(skill => skill.name)).toContain('user-b-index-skill')
    expect(userBIndex.map(skill => skill.name)).not.toContain(
      'user-a-index-skill',
    )
  })
})
