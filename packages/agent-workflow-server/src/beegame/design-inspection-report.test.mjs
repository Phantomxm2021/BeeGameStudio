import { expect, test, spyOn } from 'bun:test'
import { mkdtemp, realpath, readFile, rm, symlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { formatInspectionReport, outputInspectionReport } from './design-browser-inspection.mjs'

test('readable static report retains every failure, partial coverage and exact capture without repeating measurements', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-inspection-report-'))
  const result = { results: [{ path: 'content/ui/hud.json', viewport: [700, 400], status: 'failed',
    capture: '.beegame/tmp/ui-inspections/capture.png',
    measurements: { diagnostics: [{ nodeId: 'label', textFit: 'exceeds-intrinsic-bounds' }],
      textMeasurements: Array.from({ length: 100 }, (_, i) => ({ nodeId: String(i), basis: 'candidate-font', values: [{ text: 'Measured', width: 150, height: 40 }] })) },
    environmentErrors: ['font unavailable'], rendering: { unverified: ['world rendering'] },
    coverage: { unverified: ['dynamic states'] } }],
    issues: [{ path: 'content/ui/missing.json', reason: 'missing viewport' }],
    resourceChecks: { diagnostics: [{ path: 'font.ttf', status: 'failed' }] }, visualAcceptance: 'not-certified' }
  const log = spyOn(console, 'log').mockImplementation(() => {})
  try {
    await outputInspectionReport(root, result, true)
    const output = log.mock.calls[0][0], path = output.match(/^Full result: (.+)$/m)[1]
    expect(JSON.parse(await readFile(join(root, path), 'utf8'))).toEqual(result)
    for (const term of ['failed', 'label', 'capture.png', 'font unavailable', 'world rendering', 'dynamic states', 'missing viewport', 'font.ttf', 'candidate-font', 'not-certified'])
      expect(output).toContain(term)
    expect(output.length).toBeLessThan(JSON.stringify(result).length / 3)
    expect(formatInspectionReport({ ...result, results: [] }, 'result.json')).toContain('missing viewport')
    await outputInspectionReport(root, result, false)
    expect(JSON.parse(log.mock.calls[1][0])).toEqual(result)
  } finally { log.mockRestore(); await rm(root, { recursive: true, force: true }) }
})

test('readable inspection reports cannot write through a symlinked private cache', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-inspection-link-'))
  const outside = await realpath(await mkdtemp('/private/tmp/bgs-inspection-outside-'))
  try {
    await symlink(outside, join(root, '.beegame'))
    await expect(outputInspectionReport(root, {}, true)).rejects.toThrow('symlink')
    expect(await readdir(outside)).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('hundreds of successful font members stay in raw evidence, not repeated candidate-glyph dumps', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/bgs-font-report-'))
  const result = { status: 'partial', glyphCoverage: { basis: 'font-cmap-not-system-fallback', unboundLabels: [{ nodeId: 'title' }],
    limits: ['Candidate comparison is not delivered-font fit'],
    results: [...Array.from({ length: 300 }, (_, i) => ({ resource: 'font', path: 'font-' + i + '.woff2', status: 'checked',
      boundLabels: [], missing: [], candidateLabelCount: 1,
      candidateMissing: Array.from({ length: 30 }, (_, j) => ({ character: String.fromCodePoint(0x4e00 + j), codePoint: 'U+' + j })) })),
      { resource: 'font', path: 'broken.woff2', status: 'failed', boundLabels: [{ nodeId: 'score' }], missing: [{ character: '9' }] },
      { resource: 'missing-font', path: 'absent.woff2', status: 'unverified', reason: 'unavailable face' }] },
    resourceChecks: { checked: Array.from({ length: 300 }, (_, i) => ({ kind: 'font', path: String(i) })),
      diagnostics: [{ path: 'licence.txt', status: 'unverified', reason: 'No media decoder' }] } }
  const log = spyOn(console, 'log').mockImplementation(() => {})
  try {
    await outputInspectionReport(root, result, true)
    const output = log.mock.calls[0][0], path = output.match(/^Full result: (.+)$/m)[1]
    expect(JSON.parse(await readFile(join(root, path), 'utf8'))).toEqual(result)
    for (const term of ['partial', 'checkedFiles":300', 'candidateFilesWithMissingGlyphs":300', 'unbound labels=1',
      'broken.woff2', 'score', 'absent.woff2', 'unavailable face', 'licence.txt', 'Candidate comparison'])
      expect(output).toContain(term)
    expect(output).not.toContain('font-299.woff2')
    expect(output.length).toBeLessThan(JSON.stringify(result).length / 50)
  } finally { log.mockRestore(); await rm(root, { recursive: true, force: true }) }
})
