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
      expect(env.NPM_CONFIG_CACHE).toBe(join(dataDir, '.runtime', 'tooling', 'npm-cache'))
      expect(env.npm_config_cache).toBe(env.NPM_CONFIG_CACHE)
      expect(env.NPM_CONFIG_USERCONFIG).toBe(join(dataDir, '.runtime', 'tooling', 'npmrc'))
      expect(env.npm_config_userconfig).toBe(env.NPM_CONFIG_USERCONFIG)
      expect(existsSync(env.NPM_CONFIG_CACHE)).toBe(true)
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
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: true,
          failIfUnavailable: true,
          network: {
            allowLocalBinding: true,
          },
        },
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

  test('materializes host-owned native sandbox policy even without user feature settings', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-sandbox-'))
    const previousEnabled = process.env.BEEGAME_NATIVE_SANDBOX_ENABLED
    const previousRequired = process.env.BEEGAME_NATIVE_SANDBOX_FAIL_IF_UNAVAILABLE
    const previousLocalBinding = process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
    try {
      process.env.BEEGAME_NATIVE_SANDBOX_ENABLED = '0'
      process.env.BEEGAME_NATIVE_SANDBOX_FAIL_IF_UNAVAILABLE = '0'
      process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING = '0'
      syncRuntimeSettingsToDedicatedRuntimeConfig({}, { dataDir })

      expect(JSON.parse(readFileSync(
        join(dataDir, '.runtime', 'app', 'settings.json'),
        'utf8',
      ))).toEqual({
        sandbox: {
          enabled: false,
          autoAllowBashIfSandboxed: false,
          allowUnsandboxedCommands: true,
          failIfUnavailable: false,
          network: {
            allowLocalBinding: false,
          },
        },
      })
    } finally {
      if (previousEnabled === undefined) delete process.env.BEEGAME_NATIVE_SANDBOX_ENABLED
      else process.env.BEEGAME_NATIVE_SANDBOX_ENABLED = previousEnabled
      if (previousRequired === undefined) delete process.env.BEEGAME_NATIVE_SANDBOX_FAIL_IF_UNAVAILABLE
      else process.env.BEEGAME_NATIVE_SANDBOX_FAIL_IF_UNAVAILABLE = previousRequired
      if (previousLocalBinding === undefined) delete process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
      else process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING = previousLocalBinding
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('can explicitly disable native local binding without disabling the sandbox', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-local-binding-'))
    const previous = process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
    try {
      process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING = '0'
      syncRuntimeSettingsToDedicatedRuntimeConfig({}, { dataDir })

      expect(JSON.parse(readFileSync(
        join(dataDir, '.runtime', 'app', 'settings.json'),
        'utf8',
      )).sandbox.network).toEqual({ allowLocalBinding: false })
    } finally {
      if (previous === undefined) delete process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
      else process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING = previous
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('requires an explicit local-binding opt-in in production', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-production-binding-'))
    const previousBinding = process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
    const previousNodeEnv = process.env.NODE_ENV
    try {
      delete process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
      process.env.NODE_ENV = 'production'
      syncRuntimeSettingsToDedicatedRuntimeConfig({}, { dataDir })

      expect(JSON.parse(readFileSync(
        join(dataDir, '.runtime', 'app', 'settings.json'),
        'utf8',
      )).sandbox.network).toEqual({ allowLocalBinding: false })
    } finally {
      if (previousBinding === undefined) delete process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
      else process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING = previousBinding
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('allows native local binding in an explicitly isolated production worker', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-isolated-binding-'))
    const previousBinding = process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
    const previousNodeEnv = process.env.NODE_ENV
    try {
      process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING = '1'
      process.env.NODE_ENV = 'production'
      syncRuntimeSettingsToDedicatedRuntimeConfig({}, { dataDir })

      expect(JSON.parse(readFileSync(
        join(dataDir, '.runtime', 'app', 'settings.json'),
        'utf8',
      )).sandbox.network).toEqual({ allowLocalBinding: true })
    } finally {
      if (previousBinding === undefined) delete process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
      else process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING = previousBinding
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('propagates explicit admin feature disables instead of inheriting host flags', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'beegame-runtime-settings-disabled-'))
    try {
      const env = mapRuntimeSettingsToEnv({
        treeSitterBashEnabled: false,
        webBrowserToolEnabled: false,
        bashClassifierEnabled: false,
        mcpSkillsEnabled: false,
        resourceLibraryEnabled: false,
      }, { dataDir })

      expect(env.FEATURE_TREE_SITTER_BASH).toBe('0')
      expect(env.FEATURE_WEB_BROWSER_TOOL).toBe('0')
      expect(env.FEATURE_BASH_CLASSIFIER).toBe('0')
      expect(env.FEATURE_MCP_SKILLS).toBe('0')
      expect(env.BEEGAME_RESOURCE_LIBRARY_ENABLED).toBe('0')
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
