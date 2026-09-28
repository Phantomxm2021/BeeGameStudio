import { randomBytes } from 'node:crypto'
import { PREVIEW_IFRAME_SANDBOX, PREVIEW_ENVIRONMENT } from '@bee-game-studio/agent-workflow/preview-environment'
import { createPreviewTestBrowser } from './preview-test-browser'
import { cleanPreviewUrl, startPreviewRecording } from './preview-test-recording'

type Snapshot = { status: string; url?: string; mode?: string; message?: string }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

/** A temporary capability for one already-authorized implementation workspace.
 * No arbitrary workspace, command, browser flags or proxy URL are accepted. */
export function openPreviewTestAccess(input: {
  start: (mode: 'development' | 'production') => Promise<Snapshot>
  status: () => Snapshot
  stop: () => void
  browser?: ReturnType<typeof createPreviewTestBrowser>
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
        if (request.method === 'POST' && path === '/preview') {
          const body = await request.json() as { mode?: unknown }
          if (!body || Object.keys(body).some(key => key !== 'mode') || !['development', 'production'].includes(String(body.mode)))
            return json({ error: 'Expected {"mode":"development|production"}' }, 400)
          if (pending) return json({ error: 'Preview start already in progress; query /status.' }, 409)
          pending = input.start(body.mode as 'development' | 'production')
          try {
            const preview = await pending
            return json({ preview, ...host }, preview.status === 'running' ? 200 : 503)
          } finally { pending = undefined; if (closed) input.stop() }
        }
        if (request.method === 'POST' && path === '/browser') return json({ ...await browser.start(), playwrightRuntime: 'node' })
        if (request.method === 'GET' && path === '/recordings')
          return json([...recordings.values()].map(record => {
            const { events: _events, ...summary } = record.report(); return summary
          }))
        if (request.method === 'POST' && path === '/recordings') {
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
          return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bee Game Studio Preview Test</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe id="beegame-preview" title="Game preview" sandbox="${PREVIEW_IFRAME_SANDBOX}" src="${escapeHtml(source.href)}"></iframe></body></html>`, {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
              'referrer-policy': 'no-referrer', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; frame-src ${source.origin}; frame-ancestors 'none'` },
          })
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
      'POST /preview with {"mode":"development"} or {"mode":"production"}; GET /status. Read returned URLs from JSON. Production serves the existing build without rewriting it. Navigate to hostUrl and inspect its iframe; the sandbox matches Dashboard.',
      'POST /browser starts an isolated, muted Chromium and returns a CDP endpoint for Node Playwright or another CDP client. It avoids shell sandbox escape approvals and is closed with this capability. Native browser tools remain available; verification methods are yours.',
      'For reusable evidence, POST /recordings {targetId, label, conditions} before navigating (obtain targetId with CDP Target.getTargets). This passively records console, page and network errors for the page and child frames. POST /recordings/<id>/finish freezes observations and a screenshot; GET /recordings/<id> and /recordings/<id>/screenshot reread them without rerunning the game. Recording gaps and truncation are reported; reports never assign a gameplay pass.',
      'Save complete test output once. A browser connection, clean shell exit or failed automated route is not a gameplay verdict: distinguish product, environment and test-driver failures using evidence, and disclose unverified behavior. Keep this capability out of committed files.',
    ].join('\n'),
    close(): Promise<void> {
      return closing ??= (async () => {
        closed = true
        server.stop(true)
        input.stop()
        await startingRecording?.catch(() => undefined)
        await Promise.all([...recordings.values()].map(record => finish(record, 'session-closed', false)))
        await Promise.all([browser.close(), pending?.catch(() => undefined)])
      })()
    },
  }
}
