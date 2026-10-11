import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { materializeSceneUiFormat, DESIGN_INSPECTOR_PATH } from './scene-ui-content-authoring'
import { uiLayoutFixture } from './fixtures/layout-fixture'
import { sharedPlaywright } from './shared-playwright'
import { openPreviewTestAccess } from './preview-test-access'

const toolPath = fileURLToPath(new URL('./design-browser-inspection.mjs', import.meta.url))

test('batch text samples are selected per source without losing unknown/non-text diagnostics', async () => {
  const { partitionUiTextSamples } = await import(toolPath)
  const sources = [
    { path: 'first.json', doc: { data: { nodes: [{ id: 'root' }, { id: 'score', text: '0' }] } } },
    { path: 'second.json', doc: { data: { nodes: [{ id: 'score' }, { id: 'status', text: 'Ready' }] } } },
  ]
  expect([...partitionUiTextSamples({ score: ['999'], status: ['Finished'] }, sources)]).toEqual([
    ['first.json', ['score']], ['second.json', ['status']],
  ])
  for (const samples of [{ typo: ['x'] }, { root: ['x'] }, { score: [] }, { score: [3] }, []])
    expect(() => partitionUiTextSamples(samples, sources)).toThrow('Text samples')
})

test('static sample inspection rejects invalid sources and viewports before opening a browser', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-static-sample-path-'))
  try {
    await mkdir(join(root, 'docs/visual/ART_DIRECTION'), { recursive: true })
    await writeFile(join(root, 'source.html'), '<main>Not an owned sample</main>')
    await symlink(join(root, 'source.html'), join(root, 'docs/visual/ART_DIRECTION/alias.html'))
    const { inspectVisualSample } = await import(toolPath)
    const browser = { newContext() { throw Error('Browser should not open') } }
    for (const sample of ['source.html', '../source.html', 'docs/visual/ART_DIRECTION/../../source.html', 'docs/visual/ART_DIRECTION/run.js'])
      await expect(inspectVisualSample(root, { sample, width: 960, height: 540 }, browser)).rejects.toThrow('retained')
    await expect(inspectVisualSample(root, { sample: 'docs/visual/ART_DIRECTION/alias.html', width: 960, height: 540 }, browser)).rejects.toThrow('symlink')
    await expect(inspectVisualSample(root, { sample: 'docs/visual/ART_DIRECTION/sample.html', width: NaN, height: 540 }, browser)).rejects.toThrow('Viewport')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a changed static sample does not publish a stale capture and closes its context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-static-sample-change-'))
  let closed = 0
  try {
    await mkdir(join(root, 'docs/visual/UI_UX_SPEC'), { recursive: true })
    const sample = 'docs/visual/UI_UX_SPEC/sample.html'
    await writeFile(join(root, sample), '<main>First</main>')
    const page = { on() {}, async goto() {}, async evaluate() {}, async screenshot() {
      await writeFile(join(root, sample), '<main>Changed</main>'); return Buffer.from('not-published')
    } }
    const browser = { async newContext(options: any) {
      expect(options.javaScriptEnabled).toBe(false)
      expect(options.serviceWorkers).toBe('block')
      return { async route() {}, async newPage() { return page }, async close() { closed++ } }
    } }
    const { inspectVisualSample } = await import(toolPath)
    await expect(inspectVisualSample(root, { sample, width: 960, height: 540 }, browser)).rejects.toThrow('changed')
    expect(closed).toBe(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

/** Real local pixels, no model request, game product or billable generation. */
test.skipIf(process.env.BGS_DESIGN_BROWSER !== '1')('static sample CLI renders without formal Content, disables scripts and re-renders changed sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-static-sample-browser-'))
  const api = openPreviewTestAccess({ start: async () => ({ status: 'idle' }), status: () => ({ status: 'idle' }), stop() {} })
  try {
    await materializeSceneUiFormat(root)
    await mkdir(join(root, 'docs/visual/ART_DIRECTION'), { recursive: true })
    const sample = 'docs/visual/ART_DIRECTION/sample.html'
    const run = async () => {
      const child = Bun.spawn(['node', DESIGN_INSPECTOR_PATH, '--visual-sample', sample, '320', '180', '--preview-api', api.baseUrl],
        { cwd: root, env: { ...process.env, BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, stdout, stderr }
    }
    await writeFile(join(root, sample), '<!doctype html><html><body style="margin:0;background:#123456"><script>document.body.style.background="#ff0000"</script><main>Static reference</main></body></html>')
    const first = await run()
    expect(first.stderr).toBe('')
    expect(first.code).toBe(0)
    const before = JSON.parse(first.stdout)
    expect(before.visualAcceptance).toBe('not-certified')
    expect(before.source.path).toBe(sample)
    expect(before.capture).toStartWith('.beegame/tmp/visual-samples/')
    const sharp = (await import('sharp')).default
    const pixel = await sharp(await readFile(join(root, before.capture))).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    expect([...pixel]).toEqual([0x12, 0x34, 0x56]) // Project script was not executed.
    await writeFile(join(root, sample), '<!doctype html><body style="background:#654321">Revised static reference</body>')
    const second = await run()
    expect(second.code).toBe(0)
    const after = JSON.parse(second.stdout)
    expect(after.source.sha256).not.toBe(before.source.sha256)
    expect(after.capture).not.toBe(before.capture)
    expect((await readFile(join(root, after.capture))).subarray(1, 4).toString()).toBe('PNG')
    await writeFile(join(root, sample), '<!doctype html><img src="https://example.test/external.png">')
    expect((await run()).code).not.toBe(0)
  } finally { await api.close(); await rm(root, { recursive: true, force: true }) }
})

test('design inspector rejects escaping files and invalid viewports before opening a browser', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-design-inspection-path-'))
  const workspace = join(root, 'project')
  let opened = 0
  try {
    await mkdir(workspace)
    await writeFile(join(root, 'outside.json'), '{}')
    await symlink(join(root, 'outside.json'), join(workspace, 'escape.json'))
    const { workspaceFile, inspectDesign } = await import(toolPath)
    await expect(workspaceFile(workspace, '../outside.json')).rejects.toThrow('outside')
    await expect(workspaceFile(workspace, 'escape.json')).rejects.toThrow('outside')
    await expect(inspectDesign(workspace, { ui: 'ui.json', width: NaN, height: 540, font: 'Arial' },
      { newContext() { opened++; throw Error('Should not run') } })).rejects.toThrow('Viewport')
    expect(opened).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('changed inputs fail inspection and close the browser context without publishing a result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-design-inspection-change-'))
  let closed = 0
  try {
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    await writeFile(join(root, 'ui.json'), JSON.stringify(uiLayoutFixture()))
    await writeFile(join(root, '.beegame/delivery/content-consumer.mjs'), '// fixture helper')
    const page = { on() {}, async setContent() {}, async evaluate() {
      await writeFile(join(root, 'ui.json'), '{}')
      return { nodes: [] }
    } }
    const browser = { async newContext() { return { async route() {}, async newPage() { return page }, async close() { closed++ } } } }
    const { inspectDesign } = await import(toolPath)
    await expect(inspectDesign(root, { ui: 'ui.json', width: 960, height: 540, font: 'Arial' }, browser))
      .rejects.toThrow('inputs changed')
    expect(closed).toBe(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

/** Explicit free browser regression. No model request or BGS project product. */
test.skipIf(process.env.BGS_DESIGN_BROWSER !== '1')('published design entry measures final inputs, captures local compositions and reports failures honestly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-design-inspection-browser-'))
  const api = openPreviewTestAccess({ start: async () => ({ status: 'idle' }), status: () => ({ status: 'idle' }), stop() {} })
  try {
    await materializeSceneUiFormat(root)
    const ui = uiLayoutFixture()
    Object.assign(ui.data.nodes[1], { text: 'Play', style: { fontSize: 20, lineHeight: 28 } })
    await writeFile(join(root, 'ui.json'), JSON.stringify(ui))
    await writeFile(join(root, 'samples.json'), JSON.stringify({ play: ['Longest legal label'] }))
    await writeFile(join(root, 'composition.html'), '<!doctype html><body style="background:#123456"><main>Authored design fixture</main></body>')
    const run = async (...args: string[]) => {
      const child = Bun.spawn(['node', DESIGN_INSPECTOR_PATH, 'ui.json', '960', '540', '--preview-api', api.baseUrl,
        '--font', 'Arial', ...args], { cwd: root, env: { ...process.env, BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl },
        stdout: 'pipe', stderr: 'pipe' })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, stdout, stderr }
    }
    const measured = await run('--samples', 'samples.json')
    expect(measured.stderr).toBe('')
    expect(measured.code).toBe(0)
    const report = JSON.parse(measured.stdout)
    expect(report.capture).toBeNull()
    expect(report.visualAcceptance).toBe('not-certified')
    expect(report.measurements.textMeasurements[0]).toMatchObject({ nodeId: 'play', basis: 'candidate-font' })
    expect(report.measurements.textMeasurements[0].values.map((v: any) => v.text)).toEqual(['Play', 'Longest legal label'])
    expect(report.sources.map((s: any) => s.path)).toContain('ui.json')
    const linked = structuredClone(ui) as any
    linked.data.nodes[0].data.layoutCamera = { nodeId: 'root', path: 'scene.json' }
    const transform = (x: number, y: number) => ({ position: [x,y,0], rotation: [0,0,0], scale: [1,1,1] })
    await writeFile(join(root, 'scene.json'), JSON.stringify({ schema: 'beegame-content.v1', id: 'world', kind: 'scene-2d', assetRefs: [], data: {
      settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 960, height: 540, pixelsPerUnit: 1 },
        requiredVisibleNodeIds: ['shape'] }, cameraNodeId: 'camera', nodes: [
        { id: 'camera', transform: transform(480,270), components: [{ id: 'camera-component', type: 'camera', data: {
          orthographic: true, orthographicSize: 270, coordinateSpace: 'logical-pixels', viewport: { width:960, height:540 }, framing:'expand' } }] },
        { id: 'shape', transform: transform(100,100), components: [{ id: 'visual', type:'image', data: { size:[60,30], color:'#ffffff' } }] },
      ],
    } }))
    await writeFile(join(root, 'ui.json'), JSON.stringify(linked))
    const joint = await run()
    expect(joint.stderr).toBe('')
    expect(joint.code).toBe(0)
    expect(JSON.parse(joint.stdout).measurements.sceneInspection.requiredVisibility.status).toBe('passed')
    expect(JSON.parse(joint.stdout).sources.map((s: any) => s.path)).toContain('scene.json')
    await writeFile(join(root, 'ui.json'), JSON.stringify(ui))
    const captured = await run('--preview', 'composition.html', '--capture', 'capture.png')
    expect(captured.stderr).toBe('')
    expect(captured.code).toBe(0)
    expect(JSON.parse(captured.stdout).visualAcceptance).toBe('not-certified')
    expect((await readFile(join(root, 'capture.png'))).subarray(1, 4).toString()).toBe('PNG')
    expect((await run('--preview', 'composition.html', '--capture', 'capture.png')).stderr).toContain('already exists')
    expect(await readFile(join(root, 'ui.json'), 'utf8')).toBe(JSON.stringify(ui))
    const withFont = structuredClone(ui) as any
    withFont.data.nodes[1].data = { font: { assetRef: 'not-delivered' } }
    await writeFile(join(root, 'ui.json'), JSON.stringify(withFont))
    const missingFont = await run()
    expect(missingFont.code).toBe(1)
    expect(missingFont.stderr).toContain('Load and register the actual FontFace')
    await writeFile(join(root, 'ui.json'), JSON.stringify(ui))
    await writeFile(join(root, 'broken.html'), '<script>throw Error("fixture")</script>')
    const broken = await run('--preview', 'broken.html', '--capture', 'broken.png')
    expect(broken.code).toBe(1)
    expect(broken.stderr).toContain('Preview script error')
    expect(await Bun.file(join(root, 'broken.png')).exists()).toBe(false)
    await writeFile(join(root, 'external.html'), '<img src="https://example.invalid/asset.png">')
    const external = await run('--preview', 'external.html', '--capture', 'external.png')
    expect(external.code).toBe(1)
    expect(external.stderr).toContain('blocked or unavailable')
    expect(await Bun.file(join(root, 'external.png')).exists()).toBe(false)
  } finally { await api.close(); await rm(root, { recursive: true, force: true }) }
}, 60000)
