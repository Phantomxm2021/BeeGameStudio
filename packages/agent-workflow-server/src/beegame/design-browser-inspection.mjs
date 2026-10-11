// Native CLI tooling only. The BGS server never executes project preview code.
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const help = `Usage: node .beegame/delivery/inspect-design.mjs ui.json width height --font candidate-family
  [--samples samples.json] [--render] [--capture new-capture.png] [--details] [--report]
  --resources   Decode registered assets and check font cmap against saved UI labels, without a game or custom driver.
  --ui-all      Render all content/ui JSON at every root.data.targetViewports size, with final assets/fonts.
--render uses the same readonly renderer, styles, atlas and font loading as UI Editor.
Without --capture it saves a new screenshot in .beegame/tmp/ui-inspections/.
The current browser capability is read automatically on each invocation. Legacy
--preview-api current-url remains accepted; do not copy ephemeral URLs into source.
Static design reference: node .beegame/delivery/inspect-design.mjs --visual-sample docs/visual/OWNER/sample.html width height
OWNER is ART_DIRECTION or UI_UX_SPEC; self-contained SVG is also supported.
This mode needs no formal UI JSON, assets, game build or Content package.
It disables scripts and external requests, captures into a private tool cache
and reports the current source hash. Read the capture to inspect appearance.
It does not certify aesthetics, interaction, font delivery or runtime quality.
Run from the project root. Uses the existing isolated browser and shared Playwright;
no npm install, game package, Vite server or custom measurement script is required.
samples.json maps authored text IDs to arrays of legal label/counter strings, e.g.
{"play":["Play","Retry"],"score":["999999"]}. It never changes authored text.
--ui-all validates sample IDs across the batch, then sends only each UI's text-node samples to its inspection. Unknown/non-text IDs remain errors.
Legacy --preview composition.html --capture capture.png inspects an existing composition using final Scene/UI
inputs. Its relative assets/modules are served read-only within the workspace;
external network requests are blocked. The supplied helper is available at
/.beegame/delivery/content-consumer.mjs.
Without --render or --preview this measures text and geometry only, NOT a complete visual check.
With --preview, inspect the capture for world/UI completeness and intended art;
the tool cannot certify aesthetics or that arbitrary preview code obeys its inputs.
In legacy --preview mode delivered font references must be registered by that preview in
window.beegameDesignFontFaces (assetRef -> default FontFace; JSON.stringify([assetRef, member]) -> selected FontFace); absent references fail,
not silently use the candidate. Candidate measurements are preliminary.
Output is concise JSON with source hashes, text measurements, diagnostics and limits.
--report saves the complete JSON and prints readable status, failures, coverage and exact capture paths. Use it instead of writing JSON extraction scripts; --details is normally unnecessary.
Font coverage is cmap coverage, not canvas ink. Unbound UI labels are candidate comparisons, not a fallback-chain PASS. The font resource root_path selects its default face; data.font.member selects an explicit registered font file without fallback to root_path. Final UI fit is checked by --ui-all after binding. Do not build a custom browser driver for these checks.
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

export function formatInspectionReport(result, fullPath) {
  const rows = result.results ?? [result]
  // Hundreds of decoded font members are not hundreds of failures. Keep raw
  // evidence in the report, summarize successful/candidate checks by resource,
  // and print every failed/unverified selected face without truncation.
  const fontReport = coverage => {
    const groups = new Map()
    const problems = []
    for (const item of coverage.results) {
      if (item.status !== 'checked' || item.missing?.length || item.reason) {
        problems.push('Font issue: ' + JSON.stringify(item)); continue
      }
      const group = groups.get(item.resource) ?? { resource: item.resource, checkedFiles: 0,
        boundLabels: 0, candidateComparisons: 0, candidateFilesWithMissingGlyphs: 0 }
      group.checkedFiles++
      group.boundLabels += item.boundLabels?.length ?? 0
      if (item.candidateLabelCount) {
        group.candidateComparisons++
        if (item.candidateMissing?.length) group.candidateFilesWithMissingGlyphs++
      }
      groups.set(item.resource, group)
    }
    return ['Font scope: ' + coverage.basis + '; unbound labels=' + coverage.unboundLabels.length,
      ...[...groups.values()].map(group => 'Font summary (candidate comparisons are not binding approval): ' + JSON.stringify(group)),
      ...problems, ...(coverage.limits ?? []).map(limit => 'Font limit: ' + limit)]
  }
  return [
    'Static inspection (not gameplay, interaction or aesthetic acceptance).',
    'Full result: ' + fullPath,
    ...rows.flatMap(row => [
      (row.path ?? 'input') + ' ' + JSON.stringify(row.viewport ?? row.measurements?.viewport ?? {}) + ': ' + (row.status ?? 'unverified'),
      ...(row.capture ? ['Capture: ' + row.capture] : []),
      ...[...(row.environmentErrors ?? []), ...(row.measurements?.diagnostics ?? []),
        ...(row.rendering?.unverified ?? [])].map(item => 'Issue/unverified: ' + JSON.stringify(item)),
      ...(row.measurements?.cameraVariants ?? []).map(variant => 'Camera check: ' + JSON.stringify(variant)),
      ...(row.coverage ? ['Coverage: ' + JSON.stringify(row.coverage)] : []),
      ...(row.glyphCoverage ? fontReport(row.glyphCoverage) : []),
      // Candidate measurements must not be mistaken for delivered-font checks.
      ...[...new Set((row.measurements?.textMeasurements ?? []).map(item => item.basis))].map(basis => 'Text measurement basis: ' + String(basis)),
    ]),
    ...(result.issues ?? []).map(issue => 'Issue: ' + JSON.stringify(issue)),
    ...(result.resourceChecks?.diagnostics ?? []).map(issue => 'Resource: ' + JSON.stringify(issue)),
    ...(result.resourceChecks?.checked ? ['Decoded files by kind: ' + JSON.stringify(result.resourceChecks.checked.reduce((counts, item) => {
      counts[item.kind] = (counts[item.kind] ?? 0) + 1; return counts
    }, {}))] : []),
    'Visual acceptance: ' + (result.visualAcceptance ?? 'not-certified'),
    ...(result.limitations ?? []).map(limit => 'Limit: ' + limit),
  ].join('\n')
}

export async function outputInspectionReport(workspace, result, readable) {
  if (!readable) { console.log(JSON.stringify(result, null, 2)); return }
  const root = await realpath(workspace)
  for (const directory of ['.beegame', '.beegame/tmp', '.beegame/tmp/ui-inspections']) {
    const path = resolve(root, directory)
    await mkdir(path).catch(error => { if (error.code !== 'EEXIST') throw error })
    if (await realpath(path) !== path) throw Error('Inspection report directory must not be a symlink')
  }
  const path = '.beegame/tmp/ui-inspections/' + randomUUID() + '.json'
  await writeFile(resolve(root, path), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(formatInspectionReport(result, path))
}

/** Validate the whole batch before selecting each document's text samples.
 * Unknown IDs must not disappear just because no individual screen owns them. */
export function partitionUiTextSamples(samples, documents) {
  if (!samples || typeof samples !== 'object' || Array.isArray(samples)) throw Error('Text samples must be an object keyed by authored text node ID')
  const idsByPath = new Map(documents.map(({ path, doc }) => [path,
    new Set((Array.isArray(doc.data?.nodes) ? doc.data.nodes : []).filter(node => node.text !== undefined).map(node => node.id))]))
  for (const [id, values] of Object.entries(samples)) {
    if (![...idsByPath.values()].some(ids => ids.has(id))) throw Error('Text samples require an authored text node in the batch: ' + id)
    if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string'))
      throw Error('Text samples must be a nonempty string array: ' + id)
  }
  return new Map([...idsByPath].map(([path, ids]) => [path, Object.keys(samples).filter(id => ids.has(id))]))
}

/** Invocation-local browser ownership: no cross-project or persistent asset cache. */
export function createDesignInspectionBatch() {
  return { sources: new Map(), resourceLoads: 0,
    async close() {
      try { await this.page?.evaluate(() => {
        window.beegameInspectionApi?.clearInspectionUi()
        window.beegameDesignResources?.dispose()
      }) } finally { await this.context?.close() }
    } }
}

export async function inspectDesign(workspace, options, browser, sampleIds, batch) {
  const root = await realpath(workspace), sources = batch?.sources ?? new Map()
  if (batch) {
    if (!options.render || options.preview || options.resources) throw Error('Batch reuse is only for saved UI rendering')
    if (batch.root && batch.root !== root) throw Error('Inspection batch cannot cross workspaces')
    batch.root = root
  }
  if (![options.width, options.height].every(n => Number.isInteger(n) && n > 0 && n <= 16384))
    throw Error('Viewport must have positive finite dimensions no larger than 16384')
  if (options.render || options.resources) options = { font: 'sans-serif', ...options }
  if (typeof options.font !== 'string' || !options.font.trim()) throw Error('Choose an explicit candidate font')
  if (!options.render && !options.resources && Boolean(options.preview) !== Boolean(options.capture)) throw Error('--preview and --capture must be supplied together')
  if (options.render && options.preview) throw Error('Choose the shared JSON renderer or an existing preview, not both')
  const read = async path => {
    const bytes = await readFile(await workspaceFile(root, path))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (sources.has(path) && sources.get(path) !== hash) throw Error('Preview input changed during inspection')
    sources.set(path, hash)
    return bytes
  }
  const ui = options.resources ? undefined : JSON.parse((await read(options.ui)).toString())
  const declaredLinks = ui?.data?.nodes?.find(n => n.id === ui.data.rootId)?.data?.layoutCamera
  const links = declaredLinks ? Array.isArray(declaredLinks) ? declaredLinks : [declaredLinks] : []
  const cameraSources = await Promise.all(links.map(async link => JSON.parse((await read(link.path)).toString())))
  const allSamples = options.samples ? JSON.parse((await read(options.samples)).toString()) : {}
  const samples = sampleIds === undefined ? allSamples
    : Object.fromEntries(Object.entries(allSamples).filter(([id]) => sampleIds.includes(id)))
  let manifest, renderer, rendererCss, glyphCoverage, fontInspectorSource = ''
  if (options.render || options.resources) {
    if (!process.env.BEEGAME_CONTENT_CHECKER_MODULE || !process.env.BEEGAME_UI_INSPECTOR_MODULE)
      throw Error('INSPECTOR_RUNTIME_MISSING: Use the current BGS execution environment')
    // Validate the exact registered files through the same manifest reader.
    await read('assets/asset-manifest.json')
    const registry = await import(new URL('./inspection-manifest.mjs', process.env.BEEGAME_CONTENT_CHECKER_MODULE).href)
    for (const path of registry.readBeeGameAssetManifestModulePathsSync(root)) await read(path)
    manifest = registry.readBeeGameAssetManifestSync(root)
    renderer = await readFile(new URL(process.env.BEEGAME_UI_INSPECTOR_MODULE), 'utf8')
    rendererCss = await readFile(new URL('./ui-inspector.css', process.env.BEEGAME_UI_INSPECTOR_MODULE), 'utf8')
    const fontSources = ui ? [{ path: options.ui, nodes: ui.data.nodes }] : []
    if (options.resources) {
      const scan = async directory => {
        let entries
        try { entries = await readdir(await workspaceDirectory(directory), { withFileTypes: true }) }
        catch (error) { if (error.code === 'ENOENT') return; throw error }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) throw Error('Symlinked UI input is not inspected: ' + directory + '/' + entry.name)
          const path = directory + '/' + entry.name
          if (entry.isDirectory()) await scan(path)
          else if (entry.name.endsWith('.json')) fontSources.push({ path, nodes: JSON.parse((await read(path)).toString()).data.nodes })
        }
      }
      const workspaceDirectory = async directory => {
        const path = await realpath(resolve(root, directory))
        if (!inside(root, path)) throw Error('UI source directory is outside workspace')
        return path
      }
      await scan('content/ui')
    }
    const fontInspectorUrl = new URL('./font-inspection.mjs', process.env.BEEGAME_CONTENT_CHECKER_MODULE)
    fontInspectorSource = await readFile(fontInspectorUrl, 'utf8')
    const fontInspector = await import(fontInspectorUrl.href)
    glyphCoverage = await fontInspector.inspectFontCoverage(manifest.resources, fontSources, read, samples)
    if (options.render && !options.capture) {
      for (const directory of ['.beegame', '.beegame/tmp', '.beegame/tmp/ui-inspections']) {
        const path = resolve(root, directory)
        await mkdir(path).catch(error => { if (error.code !== 'EEXIST') throw error })
        if (await realpath(path) !== path) throw Error('Inspection cache must not follow a symlink')
      }
      options.capture = '.beegame/tmp/ui-inspections/' + randomUUID() + '.png'
    }
  }
  let capture
  if (options.capture) {
    if (isAbsolute(options.capture)) throw Error('Capture must be workspace-relative')
    const parent = await realpath(resolve(root, dirname(options.capture)))
    capture = resolve(root, options.capture)
    if (!(parent === root || inside(root, parent)) || !inside(root, capture)) throw Error('Capture is outside the workspace')
    try { await stat(capture); throw Error('Capture already exists; choose a new path') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const reused = !!batch?.page
  const context = batch?.context ?? await browser.newContext({ viewport: { width: options.width, height: options.height } })
  if (batch) batch.context = context
  try {
    const mime = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css',
      '.json':'application/json', '.txt':'text/plain', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp',
      '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.avif':'image/avif', '.bmp':'image/bmp',
      '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf',
      '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.opus':'audio/ogg', '.aac':'audio/aac', '.flac':'audio/flac', '.m4a':'audio/mp4' }
    const errors = []
    if (batch) batch.currentErrors = errors
    if (!reused) await context.route('**/*', async route => {
      try {
        const url = new URL(route.request().url())
        if (url.origin !== 'http://bgs-design.invalid') throw Error('External preview requests are blocked')
        const path = decodeURIComponent(url.pathname).slice(1)
        const type = mime[extname(path)]
        if ((!type && !options.resources) || /(^|\/)(\.git|config|node_modules)(\/|$)/.test(path)) throw Error('Unsupported preview file')
        await route.fulfill({ status: 200, contentType: type ?? 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: await read(path) })
      } catch (error) {
        ;(batch?.currentErrors ?? errors).push('Preview resource blocked or unavailable: ' + new URL(route.request().url()).pathname + ': ' + error.message)
        await route.abort()
      }
    })
    const page = batch?.page ?? await context.newPage()
    if (batch) batch.page = page
    if (!reused) page.on('pageerror', () => (batch?.currentErrors ?? errors).push('Preview script error; inspect the browser console'))
    if (reused) await page.setViewportSize({ width: options.width, height: options.height })
    if (options.preview) {
      await read(options.preview)
      await page.goto('http://bgs-design.invalid/' + options.preview.split('/').map(encodeURIComponent).join('/'),
        { waitUntil: 'networkidle', timeout: 15000 })
    } else if (!reused) await page.setContent('<!doctype html><html><body></body></html>')
    let resourceChecks, rendering
    if (renderer) {
      if (!reused) await page.addStyleTag({ content: rendererCss })
      const result = await page.evaluate(async ({ renderer, manifest, ui, options }) => {
        const url = URL.createObjectURL(new Blob([renderer], { type: 'text/javascript' }))
        try {
          const api = window.beegameInspectionApi ?? await import(url)
          const resourcesLoaded = !window.beegameDesignResources
          const resources = window.beegameDesignResources ?? await api.loadInspectionResources(manifest.resources)
          window.beegameInspectionApi = api
          window.beegameDesignFontFaces = resources.faces
          window.beegameDesignResources = resources
          const rendering = ui ? api.renderInspectionUi(ui.data, { width: options.width, height: options.height }, resources, options.font) : undefined
          await document.fonts.ready
          await Promise.all([...document.images].map(image => image.decode()))
          return { resourceChecks: { checked: resources.checked, diagnostics: resources.diagnostics }, rendering, resourcesLoaded }
        } finally { URL.revokeObjectURL(url) }
      }, { renderer, manifest, ui, options })
      if (batch && result.resourcesLoaded) batch.resourceLoads++
      resourceChecks = result.resourceChecks; rendering = result.rendering
    }
    // Blob imports avoid any dependency on a game server, package or temporary turn path.
    const helper = options.resources ? '' : (await read('.beegame/delivery/content-consumer.mjs')).toString()
    let timer
    let measurements
    try { measurements = options.resources ? { viewport: { width: options.width, height: options.height }, nodes: [], textMeasurements: [] } : await Promise.race([page.evaluate(async ({ helper, ui, cameraSources, links, font, samples, width, height }) => {
      const moduleUrl = URL.createObjectURL(new Blob([helper], { type: 'text/javascript' }))
      try {
        const api = await import(moduleUrl)
        const data = api.readUiData(ui)
        const variants = []
        for (const [index, link] of (links.length ? links : [undefined]).entries()) {
        const cameraSource = cameraSources[index]
        let camera
        if (link) camera = cameraSource.kind === 'scene-2d'
          ? { nodeId: link.nodeId, input: api.sceneCameraInput2d(api.readSceneData(cameraSource)).input }
          : { nodeId: link.nodeId, input: cameraSource }
        const result = await api.inspectUiLayoutInBrowser(data.nodes, data.rootId, { width, height }, {
          fontFamily: () => font, fontFaces: window.beegameDesignFontFaces, textSamples: samples, camera,
        })
        const game = camera && result.nodes.find(n => n.id === camera.nodeId)
        if (camera && !game?.active) throw Error('Connected game-view ' + JSON.stringify(camera.nodeId) +
          ' is missing or inactive. Check layoutCamera.nodeId/--game-view against this UI nodes[].id and parent/responsive visibility.')
        variants.push({ ...result, cameraPath: link?.path, ...(cameraSource?.kind === 'scene-2d' ? {
          sceneInspection: api.inspectSceneLayout2d(api.readSceneData(cameraSource),
            { width: game.layout.size[0], height: game.layout.size[1] }),
        } : {}) })
        }
        return { ...variants[0], ...(links.length > 1 ? { cameraVariants: variants.map(variant => ({ path: variant.cameraPath,
          requiredVisibility: variant.sceneInspection?.requiredVisibility ?? 'unverified',
          diagnostics: variant.nodes.filter(node => node.active && (node.outsideViewport || node.outsideParent || node.outsideContentArea || node.belowMinimumControlSize || node.outsideCameraView || node.occludedBy?.length || node.textFit === 'exceeds-intrinsic-bounds')),
        })) } : {}) }
      } finally { URL.revokeObjectURL(moduleUrl) }
    }, { helper, ui, cameraSources, links, font: options.font, samples, width: options.width, height: options.height }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Design font/layout inspection timed out')), 30000) }),
    ]) } catch (error) {
      if (!renderer) throw error
      errors.push('Layout/text measurement failed: ' + error.message)
      measurements = { viewport: { width: options.width, height: options.height }, nodes: [], textMeasurements: [], note: 'unverified: ' + error.message }
    } finally { clearTimeout(timer) }
    if (errors.length && !renderer) throw Error([...new Set(errors)].join('; '))
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
      ...(measurements.cameraVariants ? { cameraVariants: measurements.cameraVariants } : {}), note: measurements.note }
    return { measurements: options.details ? measurements : summary, sources: [...sources].map(([path, sha256]) => ({ path, sha256 })), glyphCoverage,
      ...(renderer ? { status: errors.length || resourceChecks.diagnostics.some(item => item.status === 'failed') || summary.diagnostics.length || glyphCoverage.results.some(item => item.status === 'failed')
        ? 'failed' : resourceChecks.diagnostics.length || rendering?.unverified.length || glyphCoverage.unboundLabels.length || glyphCoverage.results.some(item => item.status === 'unverified') ? 'partial' : 'checked' } : {}),
      ...(renderer ? { inspectorRevision: createHash('sha256').update(renderer + rendererCss + helper + fontInspectorSource).digest('hex'), resourceChecks, rendering,
        environmentErrors: [...new Set(errors)], coverage: { registeredFiles: manifest.resources.reduce((n, r) => n + r.file_paths.length, 0),
          measuredViews: 1, cameraVariants: links.length,
          suppliedTextSampleNodeIds: Object.keys(samples),
          unverified: ['Legal changing labels/counter extremes are not covered unless explicitly supplied as samples.',
            'Glyph fallback, aesthetics, dynamic states, input and game-world rendering require separate observation.'] } } : {}),
      capture: options.capture ?? null, visualAcceptance: 'not-certified',
      limitations: ['Inspect a complete Scene/UI composition against the art direction; a capture alone does not prove source consumption.',
        'Intrinsic candidate text metrics do not certify wrapping, glyph fallback, final fonts, runtime input or aesthetics.'] }
  } finally { if (!batch) await context.close() }
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
  const resourcesMode = args[0] === '--resources', batchMode = args[0] === '--ui-all'
  const [ui, w, h, ...flags] = sampleMode ? args.slice(1) : resourcesMode || batchMode ? [undefined, '800', '600', ...args.slice(1)] : args
  const options = { ...(sampleMode ? { sample: ui } : { ui }), ...(resourcesMode ? { resources: true } : {}), width: Number(w), height: Number(h) }
  const names = { '--preview-api':'previewApi', '--font':'font', '--samples':'samples', '--preview':'preview', '--capture':'capture' }
  for (let i = 0; i < flags.length;) {
    if (!sampleMode && flags[i] === '--report' && !options.report) { options.report = true; i++; continue }
    if (!sampleMode && flags[i] === '--details' && !options.details) { options.details = true; i++; continue }
    if (!sampleMode && flags[i] === '--render' && !options.render) { options.render = true; i++; continue }
    const name = names[flags[i]]
    if (!name || (sampleMode && name !== 'previewApi') || !flags[i+1] || options[name] !== undefined) throw Error(help)
    options[name] = flags[i+1]
    i += 2
  }
  if (!options.previewApi) {
    if (!process.env.BEEGAME_PREVIEW_TEST_MODULE) throw Error('PREVIEW_CAPABILITY_MISSING: Continue through BGS to acquire the current browser capability.')
    options.previewApi = await (await import(process.env.BEEGAME_PREVIEW_TEST_MODULE)).resolvePreviewApi()
  }
  const api = new URL(options.previewApi)
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.username || api.password || api.search || api.hash)
    throw Error('Expected the current local Preview API')
  let response
  try { response = await fetch(api.href.replace(/\/$/, '') + '/browser', { method: 'POST', signal: AbortSignal.timeout(20000) }) }
  catch { throw Error('PREVIEW_CAPABILITY_UNAVAILABLE: Current browser service is unavailable; resume through BGS, do not scan ports or reuse old URLs.') }
  if (!response.ok) throw Error('PREVIEW_BROWSER_START_FAILED: Current browser service rejected startup (HTTP ' + response.status + ').')
  const { endpoint } = await response.json()
  const cdp = new URL(endpoint)
  if (cdp.protocol !== 'ws:' || cdp.hostname !== '127.0.0.1') throw Error('Invalid local browser endpoint')
  if (!process.env.BEEGAME_PLAYWRIGHT_MODULE) throw Error('Shared Playwright module is unavailable')
  const { chromium } = await import(process.env.BEEGAME_PLAYWRIGHT_MODULE)
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 })
  try {
    if (batchMode) {
      const root = await realpath(process.cwd()), results = [], issues = [], documents = [], inputHashes = new Map()
      const scan = async directory => {
        for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
          const path = directory + '/' + entry.name
          if (entry.isSymbolicLink()) { issues.push({ path, reason: 'Symlinked UI source is not inspected' }); continue }
          if (entry.isDirectory()) { await scan(path); continue }
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue
          try {
            const bytes = await readFile(await workspaceFile(root, path))
            const doc = JSON.parse(bytes.toString())
            inputHashes.set(path, createHash('sha256').update(bytes).digest('hex'))
            documents.push({ path, doc })
            const views = doc.data?.nodes?.find(node => node.id === doc.data.rootId)?.data?.targetViewports
            if (!Array.isArray(views) || !views.length) { issues.push({ path, reason: 'No declared targetViewports; required coverage is unverified' }); continue }
            documents.at(-1).views = views
          } catch (error) { issues.push({ path, reason: error.message }) }
        }
      }
      await scan('content/ui')
      let samples = {}
      if (options.samples) {
        const bytes = await readFile(await workspaceFile(root, options.samples))
        samples = JSON.parse(bytes.toString())
        inputHashes.set(options.samples, createHash('sha256').update(bytes).digest('hex'))
      }
      const selected = partitionUiTextSamples(samples, documents)
      const batch = createDesignInspectionBatch()
      try {
        for (const { path, views = [] } of documents) for (const view of views) {
          try { results.push({ path, viewport: view, ...await inspectDesign(root,
            { ...options, ui: path, render: true, width: view[0], height: view[1] }, browser, selected.get(path), batch) }) }
          catch (error) { issues.push({ path, viewport: view, reason: error.message }) }
        }
      } finally { await batch.close() }
      if (!results.length) issues.push({ reason: 'No UI viewport was inspected' })
      // Shared assets/registry hashes and decoder results are reported once,
      // not once per screen/viewport back into the Agent's context.
      const sourceHashes = new Map(inputHashes), resourceDiagnostics = new Map(), checkedResources = new Map()
      for (const result of results) {
        for (const source of result.sources) {
          if (sourceHashes.has(source.path) && sourceHashes.get(source.path) !== source.sha256)
            issues.push({ path: source.path, reason: 'Shared input changed between viewport inspections; observations are not one consistent snapshot' })
          sourceHashes.set(source.path, source.sha256)
        }
        for (const item of result.resourceChecks?.diagnostics ?? []) resourceDiagnostics.set(JSON.stringify(item), item)
        for (const item of result.resourceChecks?.checked ?? []) checkedResources.set(JSON.stringify(item), item)
      }
      const compact = results.map(({ sources, resourceChecks, limitations, inspectorRevision, visualAcceptance, ...result }) => result)
      await outputInspectionReport(root, { results: compact, issues, resourceLoads: batch.resourceLoads, sources: [...sourceHashes].map(([path, sha256]) => ({ path, sha256 })),
        resourceChecks: { checked: [...checkedResources.values()], diagnostics: [...resourceDiagnostics.values()] },
        inspectorRevision: results[0]?.inspectorRevision, visualAcceptance: 'not-certified' }, options.report)
      if (issues.length || results.some(result => result.status === 'failed')) process.exitCode = 1
    } else {
      const result = await (sampleMode ? inspectVisualSample : inspectDesign)(process.cwd(), options, browser)
      await outputInspectionReport(process.cwd(), result, options.report)
      if (result.status === 'failed') process.exitCode = 1
    }
  }
  finally { await browser.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1 })
