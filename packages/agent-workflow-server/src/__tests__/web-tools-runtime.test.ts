import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncWebToolsToRuntimeConfig } from '../web-tools-store'
import { mapRuntimeSettingsToEnv, syncRuntimeSettingsToDedicatedRuntimeConfig } from '../runtime-settings-store'

test('materializes native web settings, preserves platform fields and clears stale credentials', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'web-runtime-'))
  try {
    syncRuntimeSettingsToDedicatedRuntimeConfig({ skillSearchEnabled: true }, { dataDir })
    const path = join(mapRuntimeSettingsToEnv({}, { dataDir }).BEEGAME_CONFIG_DIR!, 'settings.json')
    const config = {
      webSearchAdapter: 'exa' as const, webFetchAdapter: 'http' as const,
      exaApiKey: 'test-secret', exaEndpointUrl: 'https://example.test/mcp',
      braveApiKey: 'test-brave', tavilyEndpointUrl: 'https://example.test',
      webFetchHttpTimeoutMs: 15000,
    }
    syncWebToolsToRuntimeConfig(config, { dataDir })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ ...config, skillSearchEnabled: true })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    syncWebToolsToRuntimeConfig({ webSearchAdapter: 'bing' }, { dataDir })
    const next = JSON.parse(readFileSync(path, 'utf8'))
    expect(next).toMatchObject({ webSearchAdapter: 'bing', skillSearchEnabled: true })
    for (const key of Object.keys(config).filter(key => key !== 'webSearchAdapter')) expect(next).not.toHaveProperty(key)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
