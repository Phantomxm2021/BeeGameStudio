// Host-only static-build observation. Not an Agent-provided PASS report.
import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { PREVIEW_STORAGE_PATH, PREVIEW_STORAGE_HEADER, PREVIEW_STORAGE_VERSION, handlePreviewStorageRequest, setPreviewStorageItem } from '../preview-storage.mjs'

let input = ''
for await (const part of process.stdin) input += part
const { endpoint, artifact, files, hasTouch = false, previewHost, entryUrl = 'http://bgs-runtime.invalid/index.html' } = JSON.parse(input)
const entry = new URL(entryUrl), servingBase = new URL('.', entry)
if (!['http:', 'https:'].includes(entry.protocol) || entry.username || entry.password || entry.search || entry.hash)
  throw new Error('Expected a static publication entry URL')
const url = new URL(endpoint)
if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') throw new Error('Expected the host-owned local test browser')
const { chromium } = await import(process.env.BGS_PLAYWRIGHT_MODULE)
const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 })
try {
  const base = await realpath(artifact)
  const allowed = new Map(files.map(file => [file.path, file]))
  async function observe() {
  const errors = [], missing = new Set(), unsupported = new Set(), requested = new Set()
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false })
  try {
    const hostUrl = 'http://bgs-preview.invalid/'
    const saves = new Map()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': '*',
      'access-control-expose-headers': PREVIEW_STORAGE_HEADER, [PREVIEW_STORAGE_HEADER]: PREVIEW_STORAGE_VERSION }
    await context.routeWebSocket('**/*', socket => { unsupported.add('non-static WebSocket'); socket.close() })
    await context.route('**/*', async route => {
      try {
        const url = new URL(route.request().url())
        if (previewHost && url.href === hostUrl && route.request().method() === 'GET' &&
            route.request().isNavigationRequest() && !route.request().frame().parentFrame()) {
          await route.fulfill(previewHost); return
        }
        if (previewHost && url.origin === entry.origin && url.pathname === PREVIEW_STORAGE_PATH) {
          const source = route.request()
          const response = await handlePreviewStorageRequest(new Request(url, { method: source.method(), headers: source.headers(),
            ...(source.postDataBuffer() ? { body: source.postDataBuffer() } : {}) }), {
            getItem: key => saves.get(key) ?? null, setItem: (key, value) => setPreviewStorageItem(saves, key, value),
          })
          await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }); return
        }
        if (url.origin !== entry.origin || !['GET', 'HEAD', ...(previewHost ? ['OPTIONS'] : [])].includes(route.request().method())) {
          unsupported.add('external request or non-static method'); await route.abort(); return
        }
        if (!url.pathname.startsWith(servingBase.pathname)) {
          missing.add(url.pathname+' (outside publication base '+servingBase.pathname+')')
          await route.fulfill({ status: 404, body: 'Outside publication base' }); return
        }
        const path = decodeURIComponent(url.pathname.slice(servingBase.pathname.length)) || 'index.html'
        const expected = allowed.get(path)
        if (!expected) { missing.add(path); await route.fulfill({ status: 404, body: 'Not found' }); return }
        if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
        const real = await realpath(resolve(base, path)), rel = relative(base, real)
        if (!rel || rel === '..' || rel.startsWith('../')) throw new Error('Request escaped build directory')
        const body = await readFile(real)
        if (createHash('sha256').update(body).digest('hex') !== expected.sha256) throw new Error('Measured file changed before serving')
        await route.fulfill({ status: 200, headers: previewHost ? cors : undefined, contentType: expected.mime, body })
        requested.add(path)
      } catch {
        if (errors.length < 20) errors.push('Build changed or request could not be served')
        await route.abort().catch(() => undefined)
      }
    })
    const outer = await context.newPage()
    outer.on('pageerror', error => { if (errors.length < 20) errors.push(error.message.slice(0, 300)) })
    outer.on('console', message => {
      if (message.type() === 'error' && errors.length < 20) errors.push(message.text().slice(0, 300))
    })
    await outer.goto(previewHost ? hostUrl : entry.href, { waitUntil: 'networkidle', timeout: 15000 })
    let page = outer.mainFrame()
    if (previewHost) {
      const element = await outer.locator('#beegame-preview').elementHandle()
      const frame = await element?.contentFrame()
      await element?.dispose()
      if (!frame) throw Error('Preview measurement iframe is unavailable')
      page = frame
    }
    const environment = { embedding: previewHost ? 'sandboxed-iframe' : 'standalone', storage: previewHost ? 'disposable-preview' : 'deployment-native', ...await page.evaluate(() => ({origin:globalThis.origin,viewport:[innerWidth,innerHeight],devicePixelRatio,
      maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer: coarse)').matches,hover:matchMedia('(hover: hover)').matches})) }
    const surfacePresent = await page.locator('body').evaluate(body => {
      // Absolute-positioned UI/Canvas does not contribute to body height.
      // Observe a concrete visible surface, not the flow container's bounds.
      return [body, ...body.querySelectorAll('*')].some(element => {
        const visual = element.matches('canvas,svg,img,video,button,input,textarea,select') ||
          [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()))
        if (!visual) return false
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
            rect.left >= innerWidth || rect.top >= innerHeight) return false
        for (let parent = element; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent)
          if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) return false
        }
        return true
      })
    })
    return { driver: 'host-owned Chromium; actual static build', environment, viewport: [1280, 720], surfacePresent,
      requestedFiles: [...requested], missingFiles: [...missing], errors, unsupported: [...unsupported],
      limitations: 'Initial load/error smoke only. Container/text presence is NOT pixel/rendering proof. Fetching JSON is NOT proof its layout, hierarchy, resources or gameplay rules are consumed.' }
  } finally { await context.close() }
  }
  console.log(JSON.stringify(await observe()))
} finally { await browser.close() }
