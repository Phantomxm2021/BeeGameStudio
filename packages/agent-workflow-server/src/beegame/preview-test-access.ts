import { randomBytes } from 'node:crypto'
import { PREVIEW_IFRAME_SANDBOX, PREVIEW_ENVIRONMENT } from '@bee-game-studio/agent-workflow/preview-environment'
import { createPreviewTestBrowser } from './preview-test-browser'
import { cleanPreviewUrl, startPreviewRecording } from './preview-test-recording'

// Existing helper contracts, exposed on demand by preview.mjs --client.
export const PREVIEW_CLIENT_API = {
  runtime: 'node',
  withPreviewPage: 'await withPreviewPage({apiUrl?,mode?,contextOptions?,beforeNavigate?,runtimeErrorPolicy?}, async ({page,frame,gameFrame,context,browser,environment,observedEnvironment,observeEnvironment,runtimeErrors,runtimeErrorDetails}) => {...})',
  options: 'Omit apiUrl to use current workspace access. mode is development or production; omitted mode uses the running preview. contextOptions are Playwright browser-context options, including viewport and deviceScaleFactor. beforeNavigate({page,context}) runs before the first request. runtimeErrorPolicy defaults to observe; fail rejects recorded runtime errors even if the callback returns PASS.',
  frames: 'page is the OUTER preview wrapper; frame is a FrameLocator; gameFrame is the actual game Frame. Use frame.locator(...) for DOM interaction and gameFrame.evaluate/waitForFunction for game code. Reload can detach gameFrame: reacquire the Frame before using it again; a FrameLocator has no evaluate/waitForFunction. page.keyboard targets the focused iframe.',
  lifecycle: 'withPreviewPage returns the callback result; callback/runtime-policy failures reject. It closes its context/CDP connection on success or failure. Render readiness and interaction assertions belong to the caller. No automatic retry or gameplay verdict.',
  observations: 'observedEnvironment contains game-frame viewport, DPR, touch and pointer facts at first load; observeEnvironment() rereads the original Frame after resize, not after replacement. runtimeErrors counts pageErrors, consoleErrors, failedRequests and httpErrors from before navigation; runtimeErrorDetails retains the first 5 redacted samples per category. Both are attached to thrown Errors. Zero errors is not gameplay acceptance.',
  probes: 'Install startup hooks through beforeNavigate: async ({context}) => { await context.addInitScript(...); }. Each frame has a separate window. Read game probes with gameFrame.evaluate, never page.evaluate. A missing probe is unverified; fetch/decode/source-start observations do not prove audible output. Do not add game debug globals to compensate for a mis-scoped probe.',
  checkNumericSamples: 'checkNumericSamples(allRetainedValues,{minimum?,maximum?}) returns {status,count,observedMinimum?,observedMaximum?,violations,note}. status is passed/failed/unverified: violations return failed, without throwing; empty samples are unverified. Invalid samples/bounds throw. Bounds must include at least one finite limit; their suitability and unseen behavior are not validated. Preserve separate runs.',
  checkTextSeparation: 'await checkTextSeparation(gameFrame,[selectorA,selectorB,...]) returns {status,groups,overlaps,note} for rendered text-node rectangles including nested spans. status is passed/failed/unverified: overlap returns failed, without throwing; missing/hidden text is unverified. Invalid selectors or browser errors reject. Not Canvas, clipping, occlusion or visual taste.',
  playCapture: 'await withPlayCapture({mode,viewport?,outputParent?,audio?,audioLimitMs?}, async ({page,gameFrame,mark,captureFrame,runtimeErrors}) => {...})',
  capture: 'Returns a report with directory, observations (callback result), runtimeErrors, marks, frames and available video/audio evidence. Driver failures retain observation.json then reject with error.report; setup/write failures may reject without a report. audio:true exposes __bgsPlayAudioTap.start(actualAudioNode,"source label") in the game frame; selected-node audio is separate from silent video, not the whole game/device mix. Recording alone does not establish game feel.',
  playwright: 'Import chromium from playwrightModule for direct CDP use with the endpoint returned by POST /browser. The pinned client needs no package/browser installation; close owned contexts and disconnect afterward. Test tooling is not a game dependency.',
} as const

type Snapshot = { status: string; url?: string; mode?: string; message?: string }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

/** The managed Preview shell also embeds isolated measurement copies. */
export function previewTestHostDocument(source: URL) {
  return { body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bee Game Studio Preview Test</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe id="beegame-preview" title="Game preview" sandbox="${PREVIEW_IFRAME_SANDBOX}" src="${escapeHtml(source.href)}"></iframe></body></html>`,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; frame-src ${source.origin}; frame-ancestors 'none'` } }
}

/** A temporary capability for one already-authorized implementation workspace.
 * No arbitrary workspace, command, browser flags or proxy URL are accepted. */
export function openPreviewTestAccess(input: {
  start: (mode: 'development' | 'production') => Promise<Snapshot>
  restart?: (mode: 'development' | 'production') => Promise<Snapshot>
  status: () => Snapshot
  stop: () => void
  browser?: Pick<ReturnType<typeof createPreviewTestBrowser>, 'start' | 'status' | 'close'> &
    Partial<Pick<ReturnType<typeof createPreviewTestBrowser>, 'restart'>>
  recordingRoot?: string
  onRecordingFinished?: (report: any) => void
}) {
  const browser = input.browser ?? createPreviewTestBrowser()
  const prefix = '/' + randomBytes(32).toString('hex')
  let closed = false
  let closing: Promise<void> | undefined
  let pending: Promise<Snapshot> | undefined
  const recordings = new Map<string, Awaited<ReturnType<typeof startPreviewRecording>>>()
  const published = new Set<string>()
  let startingRecording: Promise<Awaited<ReturnType<typeof startPreviewRecording>>> | undefined
  let restartingBrowser: Promise<{ endpoint: string }> | undefined
  const finish = async (record: Awaited<ReturnType<typeof startPreviewRecording>>, reason: string, capture: boolean) => {
    const report = await record.finish(reason, capture)
    if (!published.has(record.id)) {
      published.add(record.id)
      try { input.onRecordingFinished?.(report) } catch { /* Diagnostics never interrupt the Agent. */ }
    }
    return report
  }
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 0, maxRequestBodySize: 4096,
    async fetch(request) {
      const url = new URL(request.url)
      if (closed || request.headers.has('origin') || !url.pathname.startsWith(prefix + '/'))
        return new Response('Not found', { status: 404 })
      const path = url.pathname.slice(prefix.length)
      const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
      const host = { hostUrl: `${url.origin}${prefix}/host`, frameSelector: '#beegame-preview', environment: PREVIEW_ENVIRONMENT }
      try {
        if (request.method === 'GET' && path === '/status') return json({ preview: input.status(), browser: browser.status(), ...host })
        if (request.method === 'POST' && (path === '/preview' || path === '/preview/restart')) {
          const body = await request.json() as { mode?: unknown }
          if (!body || Object.keys(body).some(key => key !== 'mode') || !['development', 'production'].includes(String(body.mode)))
            return json({ error: 'Expected {"mode":"development|production"}' }, 400)
          if (pending) return json({ error: 'Preview start or restart already in progress; query /status.' }, 409)
          const start = path === '/preview/restart' ? input.restart : input.start
          if (!start) return json({ error: 'Preview restart is unavailable.' }, 501)
          pending = start(body.mode as 'development' | 'production')
          try {
            const preview = await pending
            return json({ preview, ...host }, preview.status === 'running' ? 200 : 503)
          } finally { pending = undefined; if (closed) input.stop() }
        }
        if (request.method === 'POST' && path === '/browser') {
          if (restartingBrowser) return json({ error: 'Browser restart in progress.' }, 409)
          const reused = browser.status().status === 'running'
          return json({ ...await browser.start(), reused, playwrightRuntime: 'node' })
        }
        if (request.method === 'POST' && path === '/browser/restart') {
          if (restartingBrowser) return json({ error: 'Browser restart in progress.' }, 409)
          if (!browser.restart) return json({ error: 'This browser does not support restart.' }, 501)
          restartingBrowser = (async () => {
            await startingRecording?.catch(() => undefined)
            await Promise.all([...recordings.values()].filter(record => record.report().status === 'recording')
              .map(record => finish(record, 'browser-restarted', false)))
            return browser.restart!()
          })()
          try { return json({ ...await restartingBrowser, reused: false, playwrightRuntime: 'node' }) }
          finally { restartingBrowser = undefined }
        }
        if (request.method === 'GET' && path === '/recordings')
          return json([...recordings.values()].map(record => {
            const { events: _events, ...summary } = record.report(); return summary
          }))
        if (request.method === 'POST' && path === '/recordings') {
          if (restartingBrowser) return json({ error: 'Browser restart in progress.' }, 409)
          const body = await request.json().catch(() => undefined)
          if (!body || Object.keys(body).some(key => !['targetId', 'label', 'conditions'].includes(key)) ||
              typeof body.targetId !== 'string' || !/^[\w-]{1,128}$/.test(body.targetId) ||
              typeof body.label !== 'string' || !body.label.trim() || body.label.length > 120 ||
              typeof body.conditions !== 'string' || body.conditions.length > 2048)
            return json({ error: 'Expected {targetId, label, conditions}; conditions describe your test settings, not a pass verdict.' }, 400)
          if (startingRecording || [...recordings.values()].some(record => record.report().targetId === body.targetId && record.report().status === 'recording'))
            return json({ error: 'Recording is already starting or active for that page.' }, 409)
          if (recordings.size >= 32) return json({ error: '32 retained recordings reached. Export and DELETE a finished recording before creating another.' }, 429)
          const current = browser.status()
          if (current.status !== 'running' || !current.endpoint) return json({ error: 'Start the test browser first.' }, 409)
          const preview = input.status()
          startingRecording = startPreviewRecording(current.endpoint, { ...body,
            preview: { mode: preview.mode, status: preview.status, url: cleanPreviewUrl(preview.url) } }, input.recordingRoot)
          try {
            const record = await startingRecording; recordings.set(record.id, record)
            return json(record.report(), 201)
          } finally { startingRecording = undefined }
        }
        const recordPath = path.match(/^\/recordings\/([a-f0-9-]{36})(?:\/(finish|screenshot))?$/)
        if (recordPath) {
          const record = recordings.get(recordPath[1]!)
          if (!record) return json({ error: 'Unknown recording in this session.' }, 404)
          if (request.method === 'GET' && !recordPath[2]) return json(record.report())
          if (request.method === 'DELETE' && !recordPath[2]) {
            if (record.report().status !== 'finished') return json({ error: 'Finish the recording before releasing its cache.' }, 409)
            recordings.delete(record.id); published.delete(record.id)
            return json({ released: true, archiveDeleted: false })
          }
          if (request.method === 'POST' && recordPath[2] === 'finish')
            return json(await finish(record, 'agent-finished', true))
          if (request.method === 'GET' && recordPath[2] === 'screenshot') {
            const png = await record.screenshot()
            return png ? new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
              : json({ error: 'No captured screenshot. Inspect the report for details.' }, 404)
          }
        }
        if (request.method === 'GET' && path === '/host') {
          const snapshot = input.status()
          if (snapshot.status !== 'running' || !snapshot.url) return json({ error: 'Start a preview first', preview: snapshot }, 503)
          const source = new URL(snapshot.url)
          if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Invalid managed preview URL')
          const host = previewTestHostDocument(source)
          return new Response(host.body, { headers: host.headers })
        }
        return new Response('Not found', { status: 404 })
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Preview test unavailable' }, 503)
      }
    },
  })
  const base = `http://127.0.0.1:${server.port}${prefix}`
  return {
    baseUrl: base,
    instruction: [
      `Optional project-scoped Preview test API (native Bash/fetch, no account credentials): ${base}`,
      'POST /preview starts or reuses the preview server; POST /preview/restart restarts that server after server/config changes (not the browser). Both accept {"mode":"development"} or {"mode":"production"}; GET /status. Read returned URLs from JSON. Production serves the existing build without rewriting it. Navigate to hostUrl and inspect its iframe; the sandbox matches Dashboard.',
      'The game may be mounted under a URL subpath. Resolve game JSON, images, fonts and audio relative to the game/build base, not the host origin root. Vite development receives the preview base from BGS; production uses your existing build base. Resolve registered content documents relative to content/index.json. Do not hardcode a session URL into source or build output.',
      'POST /browser starts or reuses an isolated, muted Chromium (reused is returned); it does not restart it. POST /browser/restart explicitly closes the old browser/pages and finishes active recordings, then returns a new CDP endpoint. It avoids shell sandbox escape approvals and is closed with this capability. Native browser tools remain available; verification methods are yours.',
      'Node helper contracts and module paths: preview.mjs --client. Run project test scripts through node preview.mjs --run <script.mjs>; --help covers commands and host access.',
      'For reusable evidence, POST /recordings {targetId, label, conditions} before navigating (obtain targetId with CDP Target.getTargets). This passively records console, page and network errors for the page and child frames. POST /recordings/<id>/finish freezes observations and a screenshot; GET /recordings/<id> and /recordings/<id>/screenshot reread them without rerunning the game. Recording gaps and truncation are reported; reports never assign a gameplay pass.',
      'Save complete test output once. A browser connection, clean shell exit or failed automated route is not a gameplay verdict: distinguish product, environment and test-driver failures using evidence, and disclose unverified behavior. Keep this capability out of committed files.',
      'A missing locator or failed test precondition is inconclusive, not a product failure. Inspect the actual page errors, requests and input hit target before attributing the symptom to game logic. Keep reusable test scripts in the project; pass current URLs and CDP endpoints at execution time rather than saving session credentials. If temporary debug hooks are removed, update or retire dependent checks explicitly in the handoff.',
    ].join('\n'),
    close(): Promise<void> {
      return closing ??= (async () => {
        closed = true
        server.stop(true)
        input.stop()
        await restartingBrowser?.catch(() => undefined)
        await startingRecording?.catch(() => undefined)
        await Promise.all([...recordings.values()].map(record => finish(record, 'session-closed', false)))
        await Promise.all([browser.close(), pending?.catch(() => undefined)])
      })()
    },
  }
}
