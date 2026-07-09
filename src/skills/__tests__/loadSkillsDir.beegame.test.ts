import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))

describe('BeeGame skill discovery', () => {
  const previousBeeGameProjectConfigDirName =
    process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

  afterEach(() => {
    if (previousBeeGameProjectConfigDirName === undefined) {
      delete process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME
    } else {
      process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME =
        previousBeeGameProjectConfigDirName
    }
    if (previousClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir
    }
  })

  test('discovers dynamic skills from .beegame before falling back to .claude', async () => {
    process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME = '.beegame'
    const { discoverSkillDirsForPaths } = await import('../loadSkillsDir.js')
    const root = await mkdtemp(join(tmpdir(), 'beegame-dynamic-skills-'))

    try {
      const cwd = join(root, 'game')
      const sourceFile = join(cwd, 'src', 'main.ts')
      const beegameSkillsDir = join(cwd, 'src', '.beegame', 'skills')
      const legacySkillsDir = join(cwd, 'src', '.claude', 'skills')
      await mkdir(beegameSkillsDir, { recursive: true })
      await mkdir(legacySkillsDir, { recursive: true })
      await writeFile(sourceFile, 'export {}\n')

      const discovered = await discoverSkillDirsForPaths([sourceFile], cwd)

      expect(discovered).toContain(beegameSkillsDir)
      expect(discovered).toContain(legacySkillsDir)
      expect(discovered.indexOf(beegameSkillsDir)).toBeLessThan(
        discovered.indexOf(legacySkillsDir),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('keeps user skill discovery scoped by CLAUDE_CONFIG_DIR for the same cwd', async () => {
    const { clearSkillCaches, getSkillDirCommands } = await import(
      '../loadSkillsDir.js'
    )
    const root = await mkdtemp(join(tmpdir(), 'beegame-user-skill-scope-'))

    try {
      const cwd = join(root, 'game')
      const userAConfigDir = join(root, 'user-a-runtime')
      const userBConfigDir = join(root, 'user-b-runtime')
      await mkdir(join(userAConfigDir, 'skills', 'user-a-skill'), {
        recursive: true,
      })
      await mkdir(join(userBConfigDir, 'skills', 'user-b-skill'), {
        recursive: true,
      })
      await mkdir(cwd, { recursive: true })
      await writeFile(
        join(userAConfigDir, 'skills', 'user-a-skill', 'SKILL.md'),
        [
          '---',
          'name: user-a-skill',
          'description: Skill only visible to user A.',
          '---',
          '',
          '# User A Skill',
        ].join('\n'),
      )
      await writeFile(
        join(userBConfigDir, 'skills', 'user-b-skill', 'SKILL.md'),
        [
          '---',
          'name: user-b-skill',
          'description: Skill only visible to user B.',
          '---',
          '',
          '# User B Skill',
        ].join('\n'),
      )

      clearSkillCaches()
      process.env.CLAUDE_CONFIG_DIR = userAConfigDir
      const userASkills = await getSkillDirCommands(cwd)

      process.env.CLAUDE_CONFIG_DIR = userBConfigDir
      const userBSkills = await getSkillDirCommands(cwd)

      expect(userASkills.map(skill => skill.name)).toContain('user-a-skill')
      expect(userASkills.map(skill => skill.name)).not.toContain(
        'user-b-skill',
      )
      expect(userBSkills.map(skill => skill.name)).toContain('user-b-skill')
      expect(userBSkills.map(skill => skill.name)).not.toContain(
        'user-a-skill',
      )
    } finally {
      clearSkillCaches()
      await rm(root, { recursive: true, force: true })
    }
  })
})
