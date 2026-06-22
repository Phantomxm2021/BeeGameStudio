import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))

describe('BeeGame project config discovery', () => {
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

  test('discovers .beegame skills when BeeGame project config dir is enabled', async () => {
    process.env.BEEGAME_PROJECT_CONFIG_DIR_NAME = '.beegame'
    const { getProjectDirsUpToHome } = await import(
      '../markdownConfigLoader.js'
    )
    const root = await mkdtemp(join(tmpdir(), 'beegame-config-'))
    try {
      const cwd = join(root, 'Projects', 'snake-game')
      const skillsDir = join(root, '.beegame', 'skills')
      await mkdir(cwd, { recursive: true })
      await mkdir(skillsDir, { recursive: true })

      expect(getProjectDirsUpToHome('skills', cwd)).toContain(skillsDir)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
