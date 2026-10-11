import { test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { sharedFont } from './shared-sharp'
import { fontCodePoints, inspectFontCoverage } from './font-inspection'

test('installed font reader checks actual TTF/WOFF2 cmap, not browser fallback', async () => {
  const runtime = await sharedFont()
  process.env.BEEGAME_FONT_MODULE = runtime.moduleUrl
  const bytes = await readFile(process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
  expect((await fontCodePoints(bytes)).has(65)).toBe(true)
  expect((await fontCodePoints(bytes)).has(0x10ffff)).toBe(false)
  const module = await import(runtime.moduleUrl), api = module.default ?? module
  const compressed = Buffer.from(api.woff2.encode(bytes))
  expect((await fontCodePoints(compressed)).has(65)).toBe(true)
  const resource = { id: 'font', root_path: 'assets/font.woff2', file_paths: ['assets/font.woff2'] }
  const result = await inspectFontCoverage([resource], [{ path: 'content/ui/test.json', nodes: [
    { id: 'present', text: 'A\n\t ', data: { font: { assetRef: 'font' } } },
    { id: 'missing', text: '\u{10ffff}', data: { font: { assetRef: 'font' } } },
    { id: 'unbound', text: 'A' },
  ] }], async () => compressed)
  expect(result.results[0]).toMatchObject({ status: 'failed', missing: [{ character: '\u{10ffff}', codePoint: 'U+10FFFF' }], candidateMissing: [] })
  expect(result.unboundLabels).toEqual([{ path: 'content/ui/test.json', nodeId: 'unbound' }])
  const corrupt = await inspectFontCoverage([resource], [], async () => Buffer.from('bad'))
  expect(corrupt.results[0]!.status).toBe('unverified')
  const explicit = await inspectFontCoverage([{ ...resource, file_paths: [resource.root_path, 'assets/member.ttf'] }], [{
    path: 'content/ui/member.json', nodes: [
      { id: 'member', text: 'A', data: { font: { assetRef: 'font', member: 'assets/member.ttf' } } },
      { id: 'unknown', text: 'A', data: { font: { assetRef: 'font', member: 'assets/missing.ttf' } } },
    ],
  }], async path => path === 'assets/member.ttf' ? bytes : Buffer.from('bad default'))
  expect(explicit.results.find(item => item.path === 'assets/member.ttf')).toMatchObject({
    status: 'checked', boundLabels: [{ path: 'content/ui/member.json', nodeId: 'member' }], missing: [],
  })
  expect(explicit.results.find(item => item.path === 'assets/missing.ttf')).toMatchObject({
    status: 'unverified', boundLabels: [{ path: 'content/ui/member.json', nodeId: 'unknown' }],
  })
}, 30000)
