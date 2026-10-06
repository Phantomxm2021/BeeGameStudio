// Native CLI tooling only. The BGS server never executes project preview code.
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const help = `Usage: node .beegame/delivery/inspect-design.mjs ui.json width height --preview-api current-url --font candidate-family
  [--samples samples.json] [--preview composition.html --capture capture.png] [--details]
Static design reference: node .beegame/delivery/inspect-design.mjs --visual-sample docs/visual/OWNER/sample.html width height --preview-api current-url
OWNER is ART_DIRECTION or UI_UX_SPEC; self-contained SVG is also supported.
This mode needs no formal UI JSON, assets, game build or Content package.
It disables scripts and external requests, captures into a private tool cache
and reports the current source hash. Read the capture to inspect appearance.
It does not certify aesthetics, interaction, font delivery or runtime quality.
Run from the project root. Uses the existing isolated browser and shared Playwright;
no npm install, game package, Vite server or custom measurement script is required.
samples.json maps authored text IDs to arrays of legal label/counter strings, e.g.
{"play":["Play","Retry"],"score":["999999"]}. It never changes authored text.
The preview is an existing project-local HTML composition using final Scene/UI
inputs. Its relative assets/modules are served read-only within the workspace;
external network requests are blocked. The supplied helper is available at
/.beegame/delivery/content-consumer.mjs. No renderer or substitute layout is built.
Without --preview this measures text and geometry only, NOT a complete visual check.
With --preview, inspect the capture for world/UI completeness and intended art;
the tool cannot certify aesthetics or that arbitrary preview code obeys its inputs.
Delivered font references must be registered by the preview in
window.beegameDesignFontFaces (assetRef -> loaded FontFace); absent references fail,
not silently use the candidate. Candidate measurements are preliminary.
Output is concise JSON with source hashes, text measurements, diagnostics and limits.
--details includes every computed node/Scene rectangle; do not repeatedly dump it
into agent context when a concise result is sufficient.
measurements.nodes (details only) contains computed id/bounds/layout/diagnostics,
NOT authored role/style/text. Match id to the original input for content/style;
bounds/corners use host space while layout remains local. Browser helper
inspectUiLayout returns an array; inspectUiLayoutInBrowser returns
{viewport,nodes,textMeasurements,note}. Neither helper renders a screen.
Existing captures are never overwritten. Browser/context cleanup happens on failure.
The current Preview API URL is ephemeral: do not save it in project source.`

const inside = (root, file) => {
  const rel = relative(root, file)
  return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
export async function workspaceFile(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw Error('Expected a workspace-relative file')
  const file = await realpath(resolve(root, path))
  if (!inside(root, file) || !(await stat(file)).isFile()) throw Error('File is outside the workspace or not a regular file')
  return file
}

export async function inspectDesign(workspace, options, browser) {
  const root = await realpath(workspace), sources = new Map()
  if (![options.width, options.height].every(n => Number.isInteger(n) && n > 0 && n <= 16384))
    throw Error('Viewport must have positive finite dimensions no larger than 16384')
  if (typeof options.font !== 'string' || !options.font.trim()) throw Error('Choose an explicit candidate font')
  if (Boolean(options.preview) !== Boolean(options.capture)) throw Error('--preview and --capture must be supplied together')
  const read = async path => {
    const bytes = await readFile(await workspaceFile(root, path))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (sources.has(path) && sources.get(path) !== hash) throw Error('Preview input changed during inspection')
    sources.set(path, hash)
    return bytes
  }
  const ui = JSON.parse((await read(options.ui)).toString())
  const link = ui.data?.nodes?.find(n => n.id === ui.data.rootId)?.data?.layoutCamera
  const cameraSource = link ? JSON.parse((await read(link.path)).toString()) : undefined
  const samples = options.samples ? JSON.parse((await read(options.samples)).toString()) : {}
  let capture
  if (options.capture) {
    if (isAbsolute(options.capture)) throw Error('Capture must be workspace-relative')
    const parent = await realpath(resolve(root, dirname(options.capture)))
    capture = resolve(root, options.capture)
    if (!(parent === root || inside(root, parent)) || !inside(root, capture)) throw Error('Capture is outside the workspace')
    try { await stat(capture); throw Error('Capture already exists; choose a new path') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const context = await browser.newContext({ viewport: { width: options.width, height: options.height } })
  try {
    const mime = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css',
      '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp',
      '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf' }
    const errors = []
    await context.route('**/*', async route => {
      try {
        const url = new URL(route.request().url())
        if (url.origin !== 'http://bgs-design.invalid') throw Error('External preview requests are blocked')
        const path = decodeURIComponent(url.pathname).slice(1)
        const type = mime[extname(path)]
        if (!type || /(^|\/)(\.git|config|node_modules)(\/|$)/.test(path)) throw Error('Unsupported preview file')
        await route.fulfill({ status: 200, contentType: type, body: await read(path) })
      } catch {
        errors.push('A preview resource was blocked or unavailable')
        await route.abort()
      }
    })
    const page = await context.newPage()
    page.on('pageerror', () => errors.push('Preview script error; inspect the browser console'))
    if (options.preview) {
      await read(options.preview)
      await page.goto('http://bgs-design.invalid/' + options.preview.split('/').map(encodeURIComponent).join('/'),
        { waitUntil: 'networkidle', timeout: 15000 })
    } else await page.setContent('<!doctype html><html><body></body></html>')
    // Blob imports avoid any dependency on a game server, package or temporary turn path.
    const helper = (await read('.beegame/delivery/content-consumer.mjs')).toString()
    let timer
    let measurements
    try { measurements = await Promise.race([page.evaluate(async ({ helper, ui, cameraSource, link, font, samples, width, height }) => {
      const moduleUrl = URL.createObjectURL(new Blob([helper], { type: 'text/javascript' }))
      try {
        const api = await import(moduleUrl)
        const data = api.readUiData(ui)
        let camera
        if (link) camera = cameraSource.kind === 'scene-2d'
          ? { nodeId: link.nodeId, input: api.sceneCameraInput2d(api.readSceneData(cameraSource)).input }
          : { nodeId: link.nodeId, input: cameraSource }
        const result = await api.inspectUiLayoutInBrowser(data.nodes, data.rootId, { width, height }, {
          fontFamily: () => font, fontFaces: window.beegameDesignFontFaces, textSamples: samples, camera,
        })
        const game = camera && result.nodes.find(n => n.id === camera.nodeId)
        if (camera && !game?.active) throw Error('Connected game-view is missing or inactive')
        return { ...result, ...(cameraSource?.kind === 'scene-2d' ? {
          sceneInspection: api.inspectSceneLayout2d(api.readSceneData(cameraSource),
            { width: game.layout.size[0], height: game.layout.size[1] }),
        } : {}) }
      } finally { URL.revokeObjectURL(moduleUrl) }
    }, { helper, ui, cameraSource, link, font: options.font, samples, width: options.width, height: options.height }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Design font/layout inspection timed out')), 30000) }),
    ]) } finally { clearTimeout(timer) }
    if (errors.length) throw Error([...new Set(errors)].join('; '))
    const image = capture ? await page.screenshot({ type: 'png' }) : undefined
    for (const [path, hash] of sources)
      if (createHash('sha256').update(await readFile(await workspaceFile(root, path))).digest('hex') !== hash)
        throw Error('Preview inputs changed during inspection; no capture published')
    if (capture) {
      // Write once; another check cannot replace an existing observation.
      const { writeFile } = await import('node:fs/promises')
      await writeFile(capture, image, { flag: 'wx' })
    }
    const flags = ['outsideViewport','outsideParent','outsideContentArea','belowMinimumControlSize','outsideCameraView']
    const summary = { viewport: measurements.viewport, textMeasurements: measurements.textMeasurements,
      diagnostics: measurements.nodes.filter(node => node.active && (flags.some(flag => node[flag]) ||
        node.textFit === 'exceeds-intrinsic-bounds' || node.occludedBy?.length)).map(node => ({
          nodeId: node.id, issues: flags.filter(flag => node[flag]), textFit: node.textFit, occludedBy: node.occludedBy,
        })), ...(measurements.sceneInspection ? { sceneInspection: { requiredVisibility: measurements.sceneInspection.requiredVisibility } } : {}),
      note: measurements.note }
    return { measurements: options.details ? measurements : summary, sources: [...sources].map(([path, sha256]) => ({ path, sha256 })),
      capture: options.capture ?? null, visualAcceptance: 'not-certified',
      limitations: ['Inspect a complete Scene/UI composition against the art direction; a capture alone does not prove source consumption.',
        'Intrinsic candidate text metrics do not certify wrapping, glyph fallback, final fonts, runtime input or aesthetics.'] }
  } finally { await context.close() }
}

/** Render static references, never execute project scripts during Review. */
export async function inspectVisualSample(workspace, options, browser) {
  const root = await realpath(workspace)
  if (![options.width, options.height].every(n => Number.isInteger(n) && n > 0 && n <= 16384))
    throw Error('Viewport must have positive finite dimensions no larger than 16384')
  if (typeof options.sample !== 'string' || options.sample.split('/').includes('..') ||
      !/^docs\/visual\/(?:ART_DIRECTION|UI_UX_SPEC)\/[A-Za-z0-9_./-]+\.(?:html|svg)$/.test(options.sample))
    throw Error('Expected a retained Art/UI HTML or SVG sample')
  const file = await workspaceFile(root, options.sample)
  if (file !== resolve(root, options.sample)) throw Error('Sample must not resolve through a symlink')
  const bytes = await readFile(file)
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Error('Sample must be nonempty and no larger than 10 MiB')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height }, javaScriptEnabled: false, serviceWorkers: 'block',
  })
  try {
    const blocked = []
    await context.route('**/*', async route => {
      if (route.request().url() !== 'http://bgs-visual.invalid/sample') {
        blocked.push('Sample requires an external dependency; embed it in the static sample')
        await route.abort()
        return
      }
      await route.fulfill({ status: 200, body: bytes,
        contentType: extname(file) === '.svg' ? 'image/svg+xml' : 'text/html',
        headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; frame-src 'none'; object-src 'none'" } })
    })
    const page = await context.newPage()
    page.on('console', message => { if (message.type() === 'error') blocked.push('Static sample resource or markup error: ' + message.text()) })
    await page.goto('http://bgs-visual.invalid/sample', { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    if (blocked.length) throw Error(blocked[0])
    const image = await page.screenshot({ type: 'png' })
    if (createHash('sha256').update(await readFile(file)).digest('hex') !== sha256)
      throw Error('Sample changed during inspection; no capture published')
    // Validate each parent before creating its child; never follow a cache alias.
    for (const directory of ['.beegame', '.beegame/tmp', '.beegame/tmp/visual-samples']) {
      const path = resolve(root, directory)
      await mkdir(path).catch(error => { if (error.code !== 'EEXIST') throw error })
      if (await realpath(path) !== path) throw Error('Sample capture cache must not be a symlink')
    }
    const capture = '.beegame/tmp/visual-samples/' + randomUUID() + '.png'
    await writeFile(resolve(root, capture), image, { flag: 'wx' })
    return { source: { path: options.sample, sha256 }, viewport: { width: options.width, height: options.height },
      capture, visualAcceptance: 'not-certified',
      limitations: ['Static reference only; inspect its pixels against the owning design.',
        'No project scripts, runtime interaction or formal Content consumption were checked.'] }
  } finally { await context.close() }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') { console.log(help); return }
  const sampleMode = args[0] === '--visual-sample'
  const [ui, w, h, ...flags] = sampleMode ? args.slice(1) : args
  const options = { ...(sampleMode ? { sample: ui } : { ui }), width: Number(w), height: Number(h) }
  const names = { '--preview-api':'previewApi', '--font':'font', '--samples':'samples', '--preview':'preview', '--capture':'capture' }
  for (let i = 0; i < flags.length;) {
    if (!sampleMode && flags[i] === '--details' && !options.details) { options.details = true; i++; continue }
    const name = names[flags[i]]
    if (!name || (sampleMode && name !== 'previewApi') || !flags[i+1] || options[name] !== undefined) throw Error(help)
    options[name] = flags[i+1]
    i += 2
  }
  const api = new URL(options.previewApi)
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.username || api.password || api.search || api.hash)
    throw Error('Expected the current local Preview API')
  let response
  try { response = await fetch(api.href.replace(/\/$/, '') + '/browser', { method: 'POST', signal: AbortSignal.timeout(20000) }) }
  catch { throw Error('Preview browser capability is unavailable') }
  if (!response.ok) throw Error('Preview browser startup failed')
  const { endpoint } = await response.json()
  const cdp = new URL(endpoint)
  if (cdp.protocol !== 'ws:' || cdp.hostname !== '127.0.0.1') throw Error('Invalid local browser endpoint')
  if (!process.env.BEEGAME_PLAYWRIGHT_MODULE) throw Error('Shared Playwright module is unavailable')
  const { chromium } = await import(process.env.BEEGAME_PLAYWRIGHT_MODULE)
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 })
  try { console.log(JSON.stringify(await (sampleMode ? inspectVisualSample : inspectDesign)(process.cwd(), options, browser), null, 2)) }
  finally { await browser.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
