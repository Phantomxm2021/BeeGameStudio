import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

type Event = { at: string; type: string; targetId: string; detail: unknown }
type Start = { targetId: string; label: string; conditions: string; preview: unknown }
type ObservedEnvironment = { status: 'observed'; viewport: { width: number; height: number };
  devicePixelRatio: number; maxTouchPoints: number; coarsePointer: boolean; hover: boolean }

export function pageEnvironmentFromCdp(value: unknown): ObservedEnvironment | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const page = value as Record<string, unknown>
  if (typeof page.width !== 'number' || !Number.isFinite(page.width) || page.width <= 0 ||
      typeof page.height !== 'number' || !Number.isFinite(page.height) || page.height <= 0 ||
      typeof page.devicePixelRatio !== 'number' || !Number.isFinite(page.devicePixelRatio) || page.devicePixelRatio <= 0 ||
      typeof page.maxTouchPoints !== 'number' || !Number.isSafeInteger(page.maxTouchPoints) || page.maxTouchPoints < 0 ||
      typeof page.coarsePointer !== 'boolean' || typeof page.hover !== 'boolean') return undefined
  return { status: 'observed',
    viewport: { width: page.width, height: page.height },
    devicePixelRatio: page.devicePixelRatio, maxTouchPoints: page.maxTouchPoints,
    coarsePointer: page.coarsePointer, hover: page.hover }
}

/** One passive CDP observer for one Agent-selected page and its child frames.
 * No navigation, input, interception, cache changes, retries or pass verdict. */
export async function startPreviewRecording(endpoint: string, input: Start, outputRoot?: string) {
  const id = randomUUID()
  const startedAt = new Date().toISOString()
  const startedEpoch = Date.parse(startedAt)
  const started = performance.now()
  let endedAt: string | undefined
  let durationMs: number | undefined
  let endReason: string | undefined
  let recording = true
  let droppedEvents = 0
  let truncatedEvents = 0
  let screenshot: Buffer | undefined
  let observedEnvironment: ObservedEnvironment | { status: 'unavailable' } | undefined
  let files: { report: string; screenshot?: string } | undefined
  let finishing: Promise<unknown> | undefined
  const events: Event[] = []
  const targets = new Map<string, string>()
  const requests = new Map<string, string>()
  const setup = new Set<Promise<unknown>>()
  const socket = new WebSocket(endpoint)
  let sequence = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const add = (type: string, targetId: string, detail: unknown) => {
    if (!recording) return
    if (events.length >= 1000) { droppedEvents++; return }
    // Preview route segments now carry the sandbox's grant, including in stacks.
    const serialized = JSON.stringify(detail).replace(/\/previews\/[^/\s"\\]+/g, '/previews/[redacted]')
    detail = JSON.parse(serialized)
    if (serialized.length > 4096) { truncatedEvents++; detail = { truncated: true, text: serialized.slice(0, 4096) } }
    events.push({ at: new Date().toISOString(), type, targetId, detail })
  }
  const command = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) return reject(new Error('Recording connection is closed'))
    const requestId = ++sequence
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)) }, 5000)
    pending.set(requestId, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const enable = async (session: string, targetId: string) => {
    targets.set(session, targetId)
    await Promise.all([command('Runtime.enable', {}, session), command('Network.enable', {}, session)])
    await command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session)
  }
  const failPending = () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Recording connection closed')) }
    pending.clear()
  }
  socket.onclose = () => { add('observer.disconnected', input.targetId, {}); failPending() }
  socket.onmessage = message => {
    const value = JSON.parse(String(message.data))
    if (value.id) {
      const request = pending.get(value.id)
      if (request) {
        clearTimeout(request.timer); pending.delete(value.id)
        value.error ? request.reject(new Error(value.error.message)) : request.resolve(value.result)
      }
      return
    }
    const params = value.params ?? {}
    // Runtime.enable can replay cached console/exception events from an earlier
    // test on the same page. They are not observations of this recording.
    if ((value.method === 'Runtime.consoleAPICalled' || value.method === 'Runtime.exceptionThrown') &&
        typeof params.timestamp === 'number' && params.timestamp < startedEpoch) return
    const target = targets.get(value.sessionId) ?? input.targetId
    if (value.method === 'Target.attachedToTarget' && !targets.has(params.sessionId)) {
      const work = enable(params.sessionId, params.targetInfo.targetId)
        .catch(error => add('observer.error', params.targetInfo.targetId, String(error)))
      setup.add(work); void work.finally(() => setup.delete(work))
    } else if (value.method === 'Target.detachedFromTarget') {
      targets.delete(params.sessionId)
      for (const key of requests.keys()) if (key.startsWith(params.sessionId + ':')) requests.delete(key)
      add('target.detached', target, {})
    } else if (value.method === 'Runtime.consoleAPICalled') {
      add('console.' + params.type, target, params.args.map((arg: any) => arg.value ?? arg.description ?? arg.type))
    } else if (value.method === 'Runtime.exceptionThrown') {
      const error = params.exceptionDetails
      add('page.error', target, { text: error.exception?.description ?? error.text, url: cleanPreviewUrl(error.url), line: error.lineNumber })
    } else if (value.method === 'Network.requestWillBeSent') {
      if (requests.size >= 4000) { requests.delete(requests.keys().next().value!); add('observer.request-index-overflow', target, {}) }
      requests.set(value.sessionId + ':' + params.requestId, cleanPreviewUrl(params.request.url))
      if (params.type === 'Document') add('navigation', target, { url: cleanPreviewUrl(params.request.url) })
    } else if (value.method === 'Network.responseReceived' && params.response.status >= 400) {
      add('network.http-error', target, { url: cleanPreviewUrl(params.response.url), status: params.response.status })
    } else if (value.method === 'Network.loadingFailed') {
      const key = value.sessionId + ':' + params.requestId
      add('network.failed', target, { url: requests.get(key), error: params.errorText, canceled: params.canceled,
        blockedReason: params.blockedReason, corsErrorStatus: params.corsErrorStatus })
      requests.delete(key)
    } else if (value.method === 'Network.loadingFinished') requests.delete(value.sessionId + ':' + params.requestId)
  }
  let page: string
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Recording connection timeout')), 5000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('Recording connection failed')) }
    })
    const { targetInfo } = await command('Target.getTargetInfo', { targetId: input.targetId })
    if (targetInfo.type !== 'page') throw new Error('Select a page target from this test browser')
    const result = await command('Target.attachToTarget', { targetId: input.targetId, flatten: true })
    page = result.sessionId
    if (!targets.has(page)) await enable(page, input.targetId)
    await Promise.all(setup)
    add('observer.started', input.targetId, { url: cleanPreviewUrl(targetInfo.url), earlierConsoleHistoryExcluded: true })
  } catch (error) { recording = false; socket.close(); failPending(); throw error }

  const report = () => ({
    id, label: input.label, conditions: { source: 'agent-declared', text: input.conditions }, preview: input.preview,
    ...(observedEnvironment ? { observedEnvironment } : {}),
    targetId: input.targetId, startedAt, endedAt, durationMs: durationMs ?? Math.round(performance.now() - started),
    status: endedAt ? 'finished' : 'recording', endReason,
    observationStatus: endedAt ? 'finished' : socket.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
    gameplayVerdict: 'not-evaluated', droppedEvents, truncatedEvents,
    counts: events.reduce<Record<string, number>>((counts, event) => { counts[event.type] = (counts[event.type] ?? 0) + 1; return counts }, {}),
    events: [...events], ...(files ? { files } : {}),
    screenshotAvailable: !!screenshot || !!files?.screenshot,
  })
  return {
    id, report, screenshot: async () => screenshot ?? (files?.screenshot ? await readFile(files.screenshot) : undefined),
    finish(reason = 'agent-finished', capture = true): Promise<unknown> {
      return finishing ??= (async () => {
        // Read the actual page environment. A narrow viewport alone does not
        // establish touch input; this observation never drives the page.
        try {
          const result = await command('Runtime.evaluate', {
            expression: '({width:innerWidth,height:innerHeight,devicePixelRatio:devicePixelRatio,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia("(pointer: coarse)").matches,hover:matchMedia("(hover: hover)").matches})',
            returnByValue: true,
          }, page)
          if (result.exceptionDetails) throw new Error('Page environment could not be observed')
          observedEnvironment = pageEnvironmentFromCdp(result.result?.value)
            ?? { status: 'unavailable' }
        } catch { observedEnvironment = { status: 'unavailable' } }
        if (capture) {
          try {
            const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page)
            if (result.data.length > 24 * 1024 * 1024) throw new Error('Screenshot exceeds 18 MiB retention limit')
            screenshot = Buffer.from(result.data, 'base64')
          } catch (error) { add('screenshot.error', input.targetId, String(error)) }
        }
        // A round-trip barrier delivers earlier CDP observations before closing.
        try { await command('Target.getTargetInfo', { targetId: input.targetId }) } catch {}
        endedAt = new Date().toISOString(); durationMs = Math.round(performance.now() - started); endReason = reason
        recording = false; socket.close(); failPending(); requests.clear()
        if (outputRoot) {
          try {
            await mkdir(outputRoot, { recursive: true, mode: 0o700 })
            files = { report: join(outputRoot, id + '.json') }
            if (screenshot) {
              const path = join(outputRoot, id + '.png')
              await writeFile(path, screenshot, { flag: 'wx', mode: 0o600 })
              files.screenshot = path
            }
            await writeFile(files.report, JSON.stringify(report(), null, 2), { flag: 'wx', mode: 0o600 })
            // Completed screenshots are read on demand; do not keep dozens of
            // full-resolution PNGs in the long-lived runtime heap.
            screenshot = undefined
          } catch (error) {
            files = undefined
            // Storage failure must be visible, without changing Agent execution.
            events.push({ at: new Date().toISOString(), type: 'storage.error', targetId: input.targetId, detail: String(error) })
          }
        }
        return report()
      })()
    },
  }
}

// Capability tokens, URL credentials and query payloads do not belong in reports.
export function cleanPreviewUrl(value: string | undefined): string {
  if (!value) return ''
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname.replace(/^\/previews\/[^/]+/, '/previews/[redacted]') : url.protocol }
  catch { return '[unparseable URL]' }
}
