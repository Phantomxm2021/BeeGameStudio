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

  afterEach(() => {
    if (previousBeeGameProjectConfigDirName === undefined) {
      delete process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME
    } else {
      process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME =
        previousBeeGameProjectConfigDirName
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
})
