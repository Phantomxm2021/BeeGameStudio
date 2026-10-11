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

export type FontTextSource = { path: string; nodes: Array<{ id: string; text?: string; data?: any }> }
export async function inspectFontCoverage(resources: Array<{ id: string; root_path: string; file_paths: string[] }>,
  sources: FontTextSource[], read: (path: string) => Promise<Buffer>, samples: Record<string, string[]> = {}) {
  const labels = sources.flatMap(source => source.nodes.flatMap(node => {
    const value = node.text ?? (typeof node.data?.label === 'string' ? node.data.label : node.data?.label?.content)
    const values = [...(typeof value === 'string' ? [value] : []),
      ...(Array.isArray(node.data?.options) ? node.data.options.filter((option: unknown) => typeof option === 'string') : []), ...samples[node.id] ?? []]
    return values.length ? [{ path: source.path, nodeId: node.id, font: node.data?.font?.assetRef,
      member: typeof node.data?.font?.member === 'string' && node.data.font.member ? node.data.font.member : undefined,
      codes: [...new Set(values.join('').replace(/[\r\n\t]/g, ''))].map(char => char.codePointAt(0)!) }] : []
  }))
  const results = []
  for (const label of labels.filter(label => label.font)) {
    const resource = resources.find(resource => resource.id === label.font)
    const path = label.member ?? resource?.root_path
    if (!path || !resource?.file_paths.includes(path) || !/\.(ttf|otf|woff2?)$/i.test(path))
      results.push({ resource: label.font as string, path: path ?? '', status: 'unverified',
        boundLabels: [{ path: label.path, nodeId: label.nodeId }], reason: 'Selected font resource/member is not registered as a font file' })
  }
  for (const resource of resources) for (const path of resource.file_paths.filter(path => /\.(ttf|otf|woff2?)$/i.test(path))) {
    const bound = labels.filter(label => label.font === resource.id && path === (label.member ?? resource.root_path))
    const candidates = labels.filter(label => !label.font)
    try {
      const codes = await fontCodePoints(await read(path))
      const missing = (items: typeof labels) => [...new Set(items.flatMap(label => label.codes).filter(code => !codes.has(code)))]
        .map(code => ({ character: String.fromCodePoint(code), codePoint: 'U+' + code.toString(16).toUpperCase().padStart(4, '0') }))
      const missingBound = missing(bound)
      results.push({ resource: resource.id, path, status: missingBound.length ? 'failed' : 'checked',
        boundLabels: bound.map(({ path, nodeId }) => ({ path, nodeId })), missing: missingBound,
        candidateMissing: missing(candidates), candidateLabelCount: candidates.length })
    } catch (error) { results.push({ resource: resource.id, path, status: 'unverified', reason: String(error) }) }
  }
  return { basis: 'font-cmap-not-system-fallback', parserVersion: 'fonteditor-core@2.6.3', sourceCount: sources.length, labelCount: labels.length, results,
    unboundLabels: labels.filter(label => !label.font).map(({ path, nodeId }) => ({ path, nodeId })),
    limits: ['Unbound labels are compared against each candidate, not an assigned fallback chain.',
      'Only saved labels and supplied samples are covered; shaping, variation sequences, future labels and final UI fit still require rendering.'] }
}
