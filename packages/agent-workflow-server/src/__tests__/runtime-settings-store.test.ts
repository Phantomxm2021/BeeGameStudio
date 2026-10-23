import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRuntimeSettingsConfig, saveRuntimeSettingsConfig, mapRuntimeSettingsToEnv } from '../runtime-settings-store'

test('retains the resource setting and isolates BGS configuration per owner', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bgs-runtime-settings-'))
  try {
    writeFileSync(join(dataDir, 'runtime-settings.json'), JSON.stringify({version:1,config:{resourceLibraryEnabled:false,autoDreamEnabled:true}}))
    expect(loadRuntimeSettingsConfig({dataDir})).toEqual({resourceLibraryEnabled:false})
    expect(saveRuntimeSettingsConfig({resourceLibraryEnabled:true},{dataDir})).toEqual({resourceLibraryEnabled:true})
    const env = mapRuntimeSettingsToEnv({resourceLibraryEnabled:false},{dataDir})
    expect(env.BGS_HOME).toBe(join(dataDir,'.runtime','app','bgs'))
    expect(env.BEEGAME_RESOURCE_LIBRARY_ENABLED).toBe('0')
    expect(existsSync(env.NPM_CONFIG_CACHE)).toBe(true)
    expect(existsSync(join(env.BEEGAME_CONFIG_DIR,'settings.json'))).toBe(false)
    expect(mapRuntimeSettingsToEnv({}, {dataDir:join(dataDir,'other')}).BGS_HOME).not.toBe(env.BGS_HOME)
  } finally { rmSync(dataDir,{recursive:true,force:true}) }
})
