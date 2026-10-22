import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { contentConsumerDistribution } from './game-content-consumer-cli'
import { uiLayoutFixture } from './fixtures/layout-fixture'
import { projectExecutionAccess } from './project-execution-access'
import { publishProjectPreviewCapability } from './project-preview-capability'
import { openPreviewTestAccess } from './preview-test-access'

test.skipIf(process.env.BGS_DESIGN_BROWSER !== '1')('fixed browser entry decodes registered assets and renders saved JSON with the Editor renderer', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-production-browser-')))
  const api = openPreviewTestAccess({ start: async () => ({ status: 'idle' }), status: () => ({ status: 'idle' }), stop() {} })
  let revoke: (() => Promise<void>) | undefined
  try {
    await mkdir(join(root, '.beegame/delivery'), { recursive: true })
    for (const [name, body] of Object.entries(await contentConsumerDistribution()))
      await writeFile(join(root, '.beegame/delivery', name), body)
    await writeFile(join(root, '.beegame/delivery/inspect-design.mjs'),
      await readFile(new URL('./design-browser-inspection.mjs', import.meta.url)))
    await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    const sharp = (await import('sharp')).default
    await writeFile(join(root, 'assets/runtime/example/atlas.png'), await sharp({ create: { width: 8, height: 4, channels: 4, background: '#ff0000' } }).png().toBuffer())
    await writeFile(join(root, 'assets/runtime/example/atlas.json'), JSON.stringify({ frames: { play: { frame: { x: 0, y: 0, w: 4, h: 4 } } } }))
    const manifest = assetManifestAuthoringExamples().canonical
    const resource = manifest.resources[0]!
    resource.root_path = 'assets/runtime/example/atlas.png'; resource.file_paths = ['assets/runtime/example/atlas.png', 'assets/runtime/example/atlas.json']
    const fontPath = process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    await writeFile(join(root, 'assets/runtime/example/font.ttf'), await readFile(fontPath))
    manifest.resources.push({ ...resource, id: 'font', root_path: 'assets/runtime/example/font.ttf', file_paths: ['assets/runtime/example/font.ttf'] })
    await writeBeeGameAssetManifest(root, manifest)
    const ui: any = uiLayoutFixture()
    ui.data.nodes[0].data.background = { color: '#123456' }
    ui.data.nodes[1].text = 'Play'
    ui.data.nodes[1].data = { image: { assetRef: resource.id, member: resource.root_path, frame: 'play' }, font: { assetRef: 'font' } }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const access = await projectExecutionAccess({ workspacePath: root, sessionId: 'browser-test', environment: {} })
    revoke = await publishProjectPreviewCapability(root, 'browser-test', api.baseUrl)
    const run = async (...args: string[]) => {
      const child = Bun.spawn(['node', '.beegame/delivery/inspect-design.mjs', ...args], { cwd: root,
        env: { ...process.env, ...access.environment }, stdout: 'pipe', stderr: 'pipe' })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, stdout, stderr }
    }
    const result = await run('content/ui/menu.json', '600', '360', '--render')
    expect(result.stderr).toBe(''); expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.rendering.rendered).toEqual(['root', 'play'])
    expect(report.rendering.unverified).toEqual([])
    expect(report.environmentErrors).toEqual([])
    expect(report.resourceChecks.diagnostics).toEqual([])
    expect(report.glyphCoverage.basis).toBe('font-cmap-not-system-fallback')
    expect(report.glyphCoverage.results[0].missing).toEqual([])
    expect(report.measurements.textMeasurements[0].basis).toBe('registered-font')
    const pixel = await sharp(await readFile(join(root, report.capture))).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    expect([...pixel]).toEqual([0x12, 0x34, 0x56])
    const buttonPixel = await sharp(await readFile(join(root, report.capture))).extract({ left: 210, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    expect([...buttonPixel]).toEqual([255, 0, 0]) // The named frame, not just an empty node.
    const batch = await run('--ui-all')
    expect(batch.stderr).toBe(''); expect(batch.code).toBe(0)
    expect(JSON.parse(batch.stdout).results).toHaveLength(1)
    const readable = await run('--ui-all', '--report')
    expect(readable.stderr).toBe(''); expect(readable.code).toBe(0)
    expect(readable.stdout).toContain('Capture: .beegame/tmp/ui-inspections/')
    expect(readable.stdout).toContain('registered-font')
    const retained = readable.stdout.match(/^Full result: (.+)$/m)![1]!
    expect(JSON.parse(await readFile(join(root, retained), 'utf8')).results).toHaveLength(1)
    // Multiple files can be decoded without pretending all are one fallback face.
    await writeFile(join(root, 'assets/runtime/example/second.ttf'), await readFile(fontPath))
    manifest.resources.find(item => item.id === 'font')!.file_paths.push('assets/runtime/example/second.ttf')
    await writeBeeGameAssetManifest(root, manifest)
    const multiple = await run('--resources', '--report')
    expect(multiple.code, multiple.stderr).toBe(0)
    expect(multiple.stdout).toContain('font-cmap-not-system-fallback')
    expect(multiple.stdout).not.toContain('multiple files')
    ui.data.nodes[1].data.font.member = 'assets/runtime/example/second.ttf'
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const selectedMember = await run('content/ui/menu.json', '600', '360', '--render')
    expect(selectedMember.code, selectedMember.stderr).toBe(0)
    const selected = JSON.parse(selectedMember.stdout)
    expect(selected.measurements.textMeasurements[0]).toMatchObject({ assetRef: 'font', member: 'assets/runtime/example/second.ttf', basis: 'registered-font' })
    expect(selected.glyphCoverage.results.find((font: any) => font.path.endsWith('second.ttf')).boundLabels)
      .toEqual([{ path: 'content/ui/menu.json', nodeId: 'play' }])
    expect(selected.rendering.unverified).toEqual([])
    // A registered licence is a readable supporting file, not a failed font
    // download or a successful media decode. Keep its coverage limit explicit.
    const licence = 'assets/runtime/example/OFL.txt'
    await writeFile(join(root, licence), 'Synthetic licence text')
    manifest.resources.find(item => item.id === 'font')!.file_paths.push(licence)
    await writeBeeGameAssetManifest(root, manifest)
    const licensed = await run('content/ui/menu.json', '600', '360', '--render')
    expect(licensed.code, licensed.stderr).toBe(0)
    const licensedReport = JSON.parse(licensed.stdout)
    expect(licensedReport.environmentErrors).toEqual([])
    expect(licensedReport.resourceChecks.diagnostics.find((item: any) => item.path === licence))
      .toMatchObject({ status: 'unverified', reason: 'No browser decoder for this resource type' })
    delete ui.data.nodes[1].data.font.member
    const other = structuredClone(ui)
    other.data.nodes[0].data.background = { color: '#321654' }
    other.data.nodes[0].data.targetViewports = [[600, 360], [640, 360]]
    other.data.nodes[1].id = 'status'
    other.data.nodes[1].text = 'OK'
    await writeFile(join(root, 'content/ui/status.json'), JSON.stringify(other))
    await writeFile(join(root, 'samples.json'), JSON.stringify({ play: ['Play'], status: ['Ready'] }))
    const sampled = await run('--ui-all', '--samples', 'samples.json')
    expect(sampled.code, sampled.stderr).toBe(0)
    const sampledReport = JSON.parse(sampled.stdout)
    expect(sampledReport.results).toHaveLength(3)
    expect(sampledReport.resourceLoads).toBe(1)
    for (const result of sampledReport.results.filter((item: any) => item.path.endsWith('status.json'))) {
      const corner = await sharp(await readFile(join(root, result.capture))).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
      expect([...corner]).toEqual([0x32, 0x16, 0x54]) // Prior screen was unmounted, not stacked above this one.
    }
    expect(sampledReport.issues).toEqual([])
    expect(sampledReport.results.filter((item: any) => item.path.endsWith('menu.json'))
      .every((item: any) => item.measurements.textMeasurements.every((node: any) => node.nodeId === 'play'))).toBe(true)
    expect(sampledReport.results.filter((item: any) => item.path.endsWith('status.json'))
      .every((item: any) => item.measurements.textMeasurements.every((node: any) => node.nodeId === 'status'))).toBe(true)
    // Exercise the reusable session directly: one context/load, and no stale
    // capture when a cached resource changes between two views.
    const batchProbe = `
      import { readFile, writeFile } from 'node:fs/promises';
      import { createDesignInspectionBatch, inspectDesign } from ${JSON.stringify(new URL('./design-browser-inspection.mjs', import.meta.url).href)};
      const { endpoint } = await (await fetch(process.env.TEST_PREVIEW_API + '/browser', { method: 'POST' })).json();
      const { chromium } = await import(process.env.BEEGAME_PLAYWRIGHT_MODULE);
      const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
      const batch = createDesignInspectionBatch();
      let contexts = 0, changedRejected = false;
      const countedBrowser = { async newContext(options) { contexts++; return browser.newContext(options); } };
      const asset = 'assets/runtime/example/atlas.png', original = await readFile(asset);
      try {
        await inspectDesign(process.cwd(), { ui: 'content/ui/menu.json', render: true, width: 600, height: 360 }, countedBrowser, undefined, batch);
        await inspectDesign(process.cwd(), { ui: 'content/ui/status.json', render: true, width: 640, height: 360 }, countedBrowser, undefined, batch);
        await writeFile(asset, 'synthetic changed asset');
        try { await inspectDesign(process.cwd(), { ui: 'content/ui/menu.json', render: true, width: 600, height: 360 }, countedBrowser, undefined, batch); }
        catch (error) { if (!error.message.includes('inputs changed during inspection')) throw error; changedRejected = true; }
        console.log(JSON.stringify({ contexts, resourceLoads: batch.resourceLoads, changedRejected }));
      } finally { await batch.close(); await browser.close(); await writeFile(asset, original); }
    `
    const probe = Bun.spawn(['node', '--input-type=module', '-e', batchProbe], { cwd: root,
      env: { ...process.env, ...access.environment, TEST_PREVIEW_API: api.baseUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [probeCode, probeOut, probeError] = await Promise.all([probe.exited, new Response(probe.stdout).text(), new Response(probe.stderr).text()])
    expect(probeCode, probeError).toBe(0)
    expect(JSON.parse(probeOut)).toEqual({ contexts: 1, resourceLoads: 1, changedRejected: true })
    await writeFile(join(root, 'samples.json'), JSON.stringify({ mistyped: ['Ready'] }))
    const unknown = await run('--ui-all', '--samples', 'samples.json')
    expect(unknown.code).toBe(1); expect(unknown.stderr).toContain('authored text node in the batch: mistyped')
    // Browser fallback can display a label; cmap still rejects its missing glyph.
    ui.data.nodes[1].text = '\u{10ffff}'
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const missingGlyph = await run('--resources')
    expect(missingGlyph.code, missingGlyph.stderr).toBe(1)
    expect(JSON.parse(missingGlyph.stdout).glyphCoverage.results[0].missing[0].codePoint).toBe('U+10FFFF')
    ui.data.nodes[1].text = 'Play'
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    // Invalid data is not transformed into success by a verified Manifest flag.
    await writeFile(join(root, 'assets/runtime/example/atlas.png'), 'not an image')
    const invalid = await run('--resources')
    expect(invalid.stderr).toBe('')
    expect(JSON.parse(invalid.stdout).resourceChecks.diagnostics.some((item: any) => item.status === 'failed' && item.path.endsWith('atlas.png'))).toBe(true)
    expect(invalid.code).toBe(1)
    await revoke(); revoke = undefined
    const expired = await run('--resources')
    expect(expired.code).toBe(1); expect(expired.stderr).toContain('PREVIEW_CAPABILITY_EXPIRED')
  } finally { await revoke?.(); await api.close(); await rm(root, { recursive: true, force: true }) }
}, 60000)
