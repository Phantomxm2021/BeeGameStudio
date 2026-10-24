// Runs in Node: the shared Playwright CDP client is not reliable inside Bun.
let input = ''
for await (const part of process.stdin) input += part
const { endpoint, previewUrl, host } = JSON.parse(input)
const { chromium } = await import(process.env.BGS_PLAYWRIGHT_MODULE)
const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block' })
  // Keep the wrapper on the Preview origin so browser local-network rules match the actual Preview.
  const hostUrl = new URL('/__bgs_publication_capture__', previewUrl).href
  await context.route(hostUrl, route => route.fulfill({ status: 200, ...host }))
  const page = await context.newPage()
  let loaded = false, loadFailure = ''
  page.on('requestfailed', request => {
    if (request.url() === previewUrl) loadFailure = request.failure()?.errorText ?? 'Navigation failed'
  })
  page.on('response', response => {
    if (response.url() === previewUrl && response.request().isNavigationRequest()) loaded = response.ok()
  })
  await page.goto(hostUrl, { waitUntil: 'networkidle', timeout: 15_000 })
  if (!loaded) throw Error('Current game preview did not load: ' + loadFailure)
  const frame = page.frames().find(frame => frame.url() === previewUrl)
  if (!frame) throw Error('Current game frame is unavailable')
  await frame.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  // Initial rendered game screen only. No automatic Start button or gameplay input.
  process.stdout.write(await page.screenshot({ type: 'jpeg', quality: 85, timeout: 5_000 }))
  await context.close()
} finally { await browser.close() }
