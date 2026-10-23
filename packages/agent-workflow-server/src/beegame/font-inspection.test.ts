import { test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { sharedFont } from './shared-sharp'
import { fontCodePoints } from './font-inspection'

test('installed font reader checks actual TTF/WOFF2 cmap, not browser fallback', async () => {
  const runtime = await sharedFont()
  process.env.BEEGAME_FONT_MODULE = runtime.moduleUrl
  const bytes = await readFile(process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
  expect((await fontCodePoints(bytes)).has(65)).toBe(true)
  expect((await fontCodePoints(bytes)).has(0x10ffff)).toBe(false)
  const module = await import(runtime.moduleUrl), api = module.default ?? module
  const compressed = Buffer.from(api.woff2.encode(bytes))
  expect((await fontCodePoints(compressed)).has(65)).toBe(true)
  expect((await fontCodePoints(compressed)).has(0x10ffff)).toBe(false)
  await expect(fontCodePoints(Buffer.from('bad'))).rejects.toThrow('Unsupported font signature')
}, 30000)
