import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatLayoutReport, retainLayoutReport } from './layout-report'
import { writeDesignDocumentsFixture, uiLayoutFixture, sceneLayoutFixture } from './fixtures/layout-fixture'
import { materializeSceneUiFormat } from './scene-ui-content-authoring'
import { sharedContentChecker } from './content-checker-runtime'
import { writeFileSync } from 'node:fs'

test('report groups identical failures without dropping scenes, geometry, conditions or unmatched issues', () => {
  const diagnostics = Array.from({ length: 10 }, (_, i) => ({ source: 'content/ui/hud.json', scene: `content/scenes/level-${i}.json`,
    node: 'action', viewport: [800, 600] as [number, number], kind: 'outside-parent', message: 'Action extends outside parent',
    geometry: { bounds: { x: 10, y: 20, width: 60, height: 50 }, parent: { contentBounds: { x: 0, y: 0, width: 40, height: 80 } } },
    closeWhen: 'Fit action within parent' }))
  const result = { valid: false, diagnostics, issues: diagnostics.map(d => `${d.source}: Scene ${d.scene} ${d.message}`),
    coverage: { checked: 10, unverified: ['Fonts unavailable'] }, deferred: ['Image bounds unavailable'] }
  result.issues.push('Missing planned screen')
  const report = formatLayoutReport(result, '.beegame/tmp/layout-reports/result.json')
  expect(report.match(/Measured geometry:/g)).toHaveLength(1)
  for (const diagnostic of diagnostics) expect(report).toContain(diagnostic.scene)
  expect(report).toContain(JSON.stringify(diagnostics[0]!.geometry))
  expect(report).toContain('Fit action within parent')
  expect(report).toContain('Missing planned screen')
  expect(report).toContain('Fonts unavailable')
  expect(report).toContain('Image bounds unavailable')
  expect(report.length).toBeLessThan(JSON.stringify(result).length / 2)
  const changed = structuredClone(diagnostics[0]!)
  changed.geometry.bounds.width = 90
  const varied = formatLayoutReport({ ...result, diagnostics: [...diagnostics, changed] }, 'result.json')
  expect(varied.match(/Measured geometry:/g)).toHaveLength(2)
})

test('full reports are separate immutable snapshots; symlinked caches cannot redirect writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-layout-report-'))
  const outside = mkdtempSync(join(tmpdir(), 'bgs-layout-outside-'))
  try {
    const result = { valid: false, issues: ['failure'], diagnostics: [], coverage: { checked: ['a', 'b'] } }
    const first = retainLayoutReport(root, result), second = retainLayoutReport(root, { ...result, valid: true })
    expect(first).not.toBe(second)
    expect(JSON.parse(readFileSync(join(root, first), 'utf8'))).toEqual(result)
    const linked = join(root, 'linked'); mkdirSync(linked)
    symlinkSync(outside, join(linked, '.beegame'))
    expect(() => retainLayoutReport(linked, result)).toThrow('symlink')
    expect(readdirSync(outside)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
})

test('different failures sharing measured geometry remain visible without repeating the evidence', () => {
  const geometry = { bounds: { left: 10, right: 110, top: 20, bottom: 80 }, parent: { id: 'panel' } }
  const diagnostics = ['outside-viewport', 'flow-overflow'].map(kind => ({
    source: 'content/ui/menu.json', node: 'play', viewport: [80, 60] as [number, number],
    kind, message: kind, geometry, scene: 'content/scenes/world.json', closeWhen: 'Fit within allocated bounds',
  }))
  const report = formatLayoutReport({ valid: false, issues: [], diagnostics }, 'saved-result.json')
  for (const kind of ['outside-viewport', 'flow-overflow']) expect(report).toContain(kind)
  expect(report.split(JSON.stringify(geometry))).toHaveLength(2)
  expect(report).toContain('Measured geometry: same as diagnostic #1')
  expect(report).toContain('Affected scenes: same as diagnostic #1')
  expect(report).toContain('2 distinct diagnostics')
})

test('pending resource coverage is printed once, not again as deferred evidence', () => {
  const pending = Array.from({ length: 8 }, (_, i) => 'UI/Scene ' + i + ': TileSet not available; check again after binding')
  const report = formatLayoutReport({ valid: true, issues: [], diagnostics: [],
    deferred: [...pending, 'Only in deferred'], coverage: { unverified: ['Fonts unverified', ...pending] } }, 'result.json')
  for (const item of pending) expect(report.split(item)).toHaveLength(2)
  expect(report).toContain('Only in deferred')
  expect(report).toContain('Fonts unverified')
  expect(report).toContain('PASS (reported scope only)')
})

test('actual materialized CLI report preserves failure exit, raw coverage and authored bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-readable-layout-cli-'))
  try {
    await writeDesignDocumentsFixture(root)
    await materializeSceneUiFormat(root)
    const runtime = await sharedContentChecker()
    for (const [height, expected] of [[28, 1], [52, 0]] as const) {
      const path = join(root, 'content/ui/menu.json'), body = JSON.stringify(uiLayoutFixture(height))
      writeFileSync(path, body)
      const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/check-content.mjs'), '--review-layouts', '--report'],
        { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(error).toBe(''); expect(code).toBe(expected)
      const retained = output.match(/^Full result: (.+)$/m)![1]!
      const raw = JSON.parse(readFileSync(join(root, retained), 'utf8'))
      expect(raw.valid).toBe(expected === 0)
      expect(raw.runtimeVerified).toBe(false)
      expect(raw.coverage).toBeDefined()
      expect(output).toContain(expected ? 'Measured geometry:' : 'PASS (reported scope only)')
      expect(readFileSync(path, 'utf8')).toBe(body)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Scene CLI report covers all sources and unique viewports without agent-side JSON parsing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-readable-scene-cli-'))
  try {
    await writeDesignDocumentsFixture(root)
    await materializeSceneUiFormat(root)
    const runtime = await sharedContentChecker()
    for (const body of ['{', JSON.stringify(sceneLayoutFixture())]) {
      writeFileSync(join(root, 'content/scenes/level.json'), body)
      const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/check-content.mjs'),
        '--scene-layouts', '960', '540', '960', '540', '--report'],
        { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(error).toBe(''); expect(code).toBe(body === '{' ? 1 : 0)
      const raw = JSON.parse(readFileSync(join(root, output.match(/^Full result: (.+)$/m)![1]!), 'utf8'))
      expect(raw.coverage.viewports).toHaveLength(1)
      expect(raw.runtimeVerified).toBe(false)
      expect(output).toContain('content/scenes/level.json')
      if (code === 0) { expect(output).toContain('Scene view:'); expect(output).toContain('unverified') }
      expect(readFileSync(join(root, 'content/scenes/level.json'), 'utf8')).toBe(body)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
