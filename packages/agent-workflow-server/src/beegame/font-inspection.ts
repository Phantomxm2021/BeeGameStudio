import { inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'

type FontParser = typeof import('fonteditor-core')
let parser: Promise<FontParser> | undefined
const decodedFonts = new Map<string, Set<number>>()
async function fontParser(moduleUrl = process.env.BEEGAME_FONT_MODULE): Promise<FontParser> {
  if (!moduleUrl) throw Error('Shared font parser unavailable; resume through BGS, do not install a project toolchain')
  return parser ??= import(moduleUrl).then(async module => {
    const api = module.default ?? module
    await api.woff2.init()
    return api
  }).catch(error => { parser = undefined; throw error })
}

/** Checks the delivered cmap, never canvas ink or OS font fallback. Does not
 * certify shaping, font styling, line wrapping, future strings or appearance. */
export async function fontCodePoints(bytes: Buffer, moduleUrl?: string) {
  if (bytes.length > 32 * 1024 * 1024) throw Error('Font exceeds the supported 32 MiB decoding limit')
  const signature = bytes.toString('ascii', 0, 4)
  const type = signature === 'wOF2' ? 'woff2' : signature === 'wOFF' ? 'woff' :
    signature === 'OTTO' ? 'otf' : bytes.length >= 12 && bytes.readUInt32BE(0) === 0x10000 ? 'ttf' : undefined
  if (!type) throw Error('Unsupported font signature')
  if ((type === 'woff2' || type === 'woff') && (bytes.length < 48 || bytes.readUInt32BE(16) > 64 * 1024 * 1024))
    throw Error('Font declares unsupported decompressed size')
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (decodedFonts.has(hash)) return decodedFonts.get(hash)!
  const api = await fontParser(moduleUrl)
  const font = api.Font.create(bytes, { type, inflate: data => [...inflateSync(Uint8Array.from(data))] })
  const codes = new Set(Object.entries(font.get().cmap).filter(([, glyph]) => glyph > 0).map(([code]) => Number(code)))
  decodedFonts.set(hash, codes)
  return codes
}
