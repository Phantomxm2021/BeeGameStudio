import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  cleanupRuntimeLayout,
  mapRuntimeSettingsToEnv,
  syncRuntimeSettingsToDedicatedRuntimeConfig,
} from '../runtime-settings-store'

describe('runtime settings store', () => {
  test('migrates legacy runtime directories to the hidden runtime layout', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-layout-'))
    try {
      mkdirSync(join(dataDir, 'beegame-config'), { recursive: true })
      mkdirSync(join(dataDir, 'claude-config', 'projects', 'legacy-project'), {
        recursive: true,
      })
      writeFileSync(
        join(dataDir, 'beegame-config', '.dashboard-write-test'),
        '',
      )
      writeFileSync(
        join(dataDir, 'claude-config', '.claude.json'),
        '{"skillUsage":{}}\n',
      )
      writeFileSync(
        join(dataDir, 'claude-config', 'projects', 'legacy-project', 'run.jsonl'),
        '{}\n',
      )

      const env = mapRuntimeSettingsToEnv(
        { autoMemoryEnabled: true },
        { dataDir },
      )

      expect(env.BEEGAME_CONFIG_DIR).toBe(join(dataDir, '.runtime', 'app'))
      expect(env.CLAUDE_CONFIG_DIR).toBe(join(dataDir, '.runtime', 'app'))
      expect(existsSync(join(dataDir, 'beegame-config'))).toBe(false)
      expect(existsSync(join(dataDir, 'claude-config'))).toBe(false)
      expect(
        existsSync(join(dataDir, '.runtime', 'app', '.dashboard-write-test')),
      ).toBe(false)
      expect(
        readFileSync(join(dataDir, '.runtime', 'core', '.config.json'), 'utf8'),
      ).toBe('{"skillUsage":{}}\n')
      expect(
        existsSync(join(dataDir, '.runtime', 'core', 'projects', 'legacy-project')),
      ).toBe(false)
      const projectDirs = readdirSync(
        join(dataDir, '.runtime', 'core', 'projects'),
      )
      expect(projectDirs).toHaveLength(1)
      expect(projectDirs[0]?.startsWith('project-')).toBe(true)
      expect(
        existsSync(
          join(
            dataDir,
            '.runtime',
            'core',
            'projects',
            projectDirs[0] ?? '',
            'run.jsonl',
          ),
        ),
      ).toBe(true)
      expect(
        existsSync(join(dataDir, '.runtime', 'core', '.claude.json')),
      ).toBe(false)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('cleans empty runtime placeholders without removing runtime files', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-cleanup-'))
    try {
      mkdirSync(join(dataDir, '.runtime', 'app', '.dashboard-write-test'), {
        recursive: true,
      })
      mkdirSync(join(dataDir, '.runtime', 'core', 'modes'), {
        recursive: true,
      })
      mkdirSync(join(dataDir, '.runtime', 'core', 'plans'), {
        recursive: true,
      })
      mkdirSync(
        join(dataDir, '.runtime', 'core', 'session-env', 'session-empty'),
        { recursive: true },
      )
      mkdirSync(
        join(
          dataDir,
          '.runtime',
          'core',
          'projects',
          '-Users-example-project',
          'memory',
        ),
        { recursive: true },
      )
      mkdirSync(
        join(dataDir, '.runtime', 'core', 'projects', 'project-live'),
        { recursive: true },
      )
      mkdirSync(join(dataDir, '.runtime', 'core', 'shell-snapshots'), {
        recursive: true,
      })
      writeFileSync(
        join(dataDir, '.runtime', 'core', 'projects', 'project-live', 'run.jsonl'),
        '{}\n',
      )
      writeFileSync(
        join(dataDir, '.runtime', 'core', 'shell-snapshots', 'snapshot.sh'),
        'export TEST=1\n',
      )

      cleanupRuntimeLayout({ dataDir })

      expect(
        existsSync(join(dataDir, '.runtime', 'app', '.dashboard-write-test')),
      ).toBe(false)
      expect(existsSync(join(dataDir, '.runtime', 'app'))).toBe(false)
      expect(existsSync(join(dataDir, '.runtime', 'core', 'modes'))).toBe(false)
      expect(existsSync(join(dataDir, '.runtime', 'core', 'plans'))).toBe(false)
      expect(
        existsSync(join(dataDir, '.runtime', 'core', 'session-env')),
      ).toBe(false)
      expect(
        existsSync(
          join(
            dataDir,
            '.runtime',
            'core',
            'projects',
            '-Users-example-project',
          ),
        ),
      ).toBe(false)
      expect(
        readFileSync(
          join(dataDir, '.runtime', 'core', 'projects', 'project-live', 'run.jsonl'),
          'utf8',
        ),
      ).toBe('{}\n')
      expect(
        readFileSync(
          join(dataDir, '.runtime', 'core', 'shell-snapshots', 'snapshot.sh'),
          'utf8',
        ),
      ).toBe('export TEST=1\n')
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('syncs all admin runtime settings to the app runtime settings file', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-settings-'))
    try {
      syncRuntimeSettingsToDedicatedRuntimeConfig({
        autoMemoryEnabled: false,
        autoDreamEnabled: true,
        skillSearchEnabled: true,
        treeSitterBashEnabled: true,
        webBrowserToolEnabled: true,
        bashClassifierEnabled: false,
        mcpSkillsEnabled: true,
      }, { dataDir })

      expect(JSON.parse(readFileSync(
        join(dataDir, '.runtime', 'app', 'settings.json'),
        'utf8',
      ))).toEqual({
        autoMemoryEnabled: false,
        autoDreamEnabled: true,
        skillSearchEnabled: true,
        treeSitterBashEnabled: true,
        webBrowserToolEnabled: true,
        bashClassifierEnabled: false,
        mcpSkillsEnabled: true,
      })
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
