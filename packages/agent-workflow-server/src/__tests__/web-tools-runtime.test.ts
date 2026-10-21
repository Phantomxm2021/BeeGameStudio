import { test, expect } from 'bun:test'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveWebToolsConfig, loadWebToolsConfig } from '../web-tools-store'

test('preserves legacy search preferences without generating Claude runtime settings', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'web-store-'))
  try {
    saveWebToolsConfig({webSearchAdapter:'bing'}, {dataDir})
    expect(loadWebToolsConfig({dataDir})).toMatchObject({webSearchAdapter:'bing'})
    expect(existsSync(join(dataDir,'.runtime','app','settings.json'))).toBe(false)
  } finally { rmSync(dataDir,{recursive:true,force:true}) }
})
