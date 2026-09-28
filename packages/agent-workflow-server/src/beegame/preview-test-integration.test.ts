import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGamePreviewManager } from './preview-manager'
import { openPreviewTestAccess } from './preview-test-access'
import { proxyBeeGamePreviewRequest } from '../app'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'
import { createPreviewCapabilityManager } from '../auth/preview-capability'

// Entirely temporary fixture; no workflow, model call or generated project is touched.
test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('managed dev and built production execute inside the Dashboard sandbox', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-preview-fixture-'))
  const manager = new BeeGamePreviewManager()
  const sessionId = 'fixture'
  const capabilities = createPreviewCapabilityManager()
  const savedReports: any[] = []
  const proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
    if (!capabilities.verifyRequest(request, sessionId) && !capabilities.allowsSandboxedSubresource(request, sessionId))
      return new Response('Unauthorized', { status: 401 })
    return proxyBeeGamePreviewRequest(request, sessionId, manager.internalUrl(sessionId)!, manager.expectsPublicPath(sessionId))
  } })
  const status = () => ({ ...manager.status(sessionId, workspace),
    url: capabilities.issueUrl(new URL('/previews/fixture/', proxy.url).href, sessionId, 'fixture-owner') })
  const access = openPreviewTestAccess({
    recordingRoot: join(workspace, 'observations'),
    onRecordingFinished: report => { savedReports.push(report) },
    start: async mode => { await manager.start({ sessionId, workspacePath: workspace, mode }); return status() },
    status, stop: () => { manager.stop(sessionId, workspace) },
  })
  let ws: WebSocket | undefined
  let originalEnv = process.env.NODE_ENV
  try {
    const dependencies = new URL('../../../../apps/frontend/node_modules', import.meta.url).pathname
    await symlink(dependencies, join(workspace, 'node_modules'), 'dir')
    await mkdir(join(workspace, 'public'))
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, devDependencies: { vite: '*' } }))
    await writeFile(join(workspace, 'index.html'), '<html><body><script type="module" src="/main.js"></script></body></html>')
    await writeFile(join(workspace, 'public/data.json'), '{"ready":true}')
    await writeFile(join(workspace, 'main.js'), `const data = await fetch(import.meta.env.BASE_URL + 'data.json').then(r => r.json()); document.body.textContent = 'Ready'; console.log('BGS_FIXTURE', JSON.stringify({dev:import.meta.env.DEV, data, width:innerWidth, height:innerHeight, framed:window !== parent}));`)
    const browserResponse = await fetch(access.baseUrl + '/browser', { method: 'POST' })
    expect(browserResponse.status).toBe(200)
    const { endpoint } = await browserResponse.json() as { endpoint: string }
    ws = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = () => reject(new Error('CDP unavailable')) })
    let id = 0
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
    const observations: any[] = []
    const errors: any[] = []
    const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
      const requestId = ++id
      pending.set(requestId, { resolve, reject })
      ws!.send(JSON.stringify({ id: requestId, method, params, sessionId }))
    })
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const request = pending.get(message.id); pending.delete(message.id)
        message.error ? request?.reject(new Error(JSON.stringify(message.error))) : request?.resolve(message.result)
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.args[0]?.value === 'BGS_FIXTURE')
        observations.push(JSON.parse(message.params.args[1].value))
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params)
      if (message.method === 'Target.attachedToTarget') {
        void send('Runtime.enable', {}, message.params.sessionId).catch(error => errors.push(String(error)))
      }
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: page } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Runtime.enable', {}, page)
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, page)
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }, page)
    for (const mode of ['development', 'production'] as const) {
      if (mode === 'production') {
        // Deliberately leave BGS in development: the task build must not inherit it.
        process.env.NODE_ENV = 'development'
        const build = Bun.spawn([process.execPath, join(dependencies, 'vite/bin/vite.js'), 'build', '--base', '/previews/fixture/'], {
          cwd: workspace, env: getSafeRuntimeProcessEnvironment(), stdout: 'pipe', stderr: 'pipe',
        })
        const [code, output, error] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()])
        expect({ code, error: code ? error + output : '' }).toEqual({ code: 0, error: '' })
      }
      const response = await fetch(access.baseUrl + '/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })
      const result = await response.json() as any
      expect(result.preview.status).toBe('running')
      expect(response.status).toBe(200)
      const count = observations.length
      const begin = await fetch(access.baseUrl + '/recordings', { method: 'POST', body: JSON.stringify({
        targetId, label: mode, conditions: '800x600; normal controls; temporary fixture',
      }) })
      expect(begin.status).toBe(201)
      const record = await begin.json() as any
      const { targetId: unrelated } = await send('Target.createTarget', { url: 'about:blank' })
      const { sessionId: unrelatedSession } = await send('Target.attachToTarget', { targetId: unrelated, flatten: true })
      await send('Runtime.evaluate', { expression: "console.error('UNRELATED_PAGE')" }, unrelatedSession)
      await send('Target.closeTarget', { targetId: unrelated })
      await send('Page.navigate', { url: result.hostUrl }, page)
      const deadline = Date.now() + 10000
      while (observations.length === count && Date.now() < deadline) await Bun.sleep(20)
      expect(errors).toEqual([])
      expect(observations[count]).toEqual({ dev: mode === 'development', data: { ready: true }, width: 800, height: 600, framed: true })
      const screenshot = await send('Page.captureScreenshot', { format: 'png' }, page)
      expect(screenshot.data.length).toBeGreaterThan(100)
      // Explicit failures in the selected iframe must be observable without
      // making the collector drive or re-run the game.
      const { frameTree } = await send('Page.getFrameTree', {}, page)
      const childFrame = frameTree.childFrames[0].frame.id
      const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: childFrame }, page)
      await send('Runtime.evaluate', { contextId: executionContextId,
        expression: `console.warn('recorded-warning'); fetch('/missing-observation-file?private=value'); fetch('http://127.0.0.1:1').catch(()=>{}); setTimeout(() => { throw new Error('recorded-page-error') }, 0)` }, page)
      const recordingUrl = access.baseUrl + '/recordings/' + record.id
      const errorDeadline = Date.now() + 5000
      let current: any
      do {
        current = await (await fetch(recordingUrl)).json()
        if (current.counts['page.error'] && current.counts['network.http-error'] && current.counts['network.failed']) break
        await Bun.sleep(20)
      } while (Date.now() < errorDeadline)
      expect(current.counts['page.error']).toBeGreaterThan(0)
      expect(current.counts['network.http-error']).toBeGreaterThan(0)
      expect(current.counts['console.warning']).toBeGreaterThan(0)
      expect(current.counts['network.failed']).toBeGreaterThan(0)
      if (mode === 'production') {
        await send('Runtime.evaluate', { contextId: executionContextId,
          expression: `console.log('x'.repeat(10000)); for(let i=0;i<1005;i++) console.log('bounded-event',i)` }, page)
        const deadline = Date.now() + 5000
        do {
          current = await (await fetch(recordingUrl)).json()
          if (current.droppedEvents > 0) break
          await Bun.sleep(20)
        } while (Date.now() < deadline)
        expect(current.events).toHaveLength(1000)
        expect(current.droppedEvents).toBeGreaterThan(0)
        expect(current.truncatedEvents).toBeGreaterThan(0)
      }
      const finished = await (await fetch(recordingUrl + '/finish', { method: 'POST' })).json() as any
      expect(finished.gameplayVerdict).toBe('not-evaluated')
      expect(finished.preview.mode).toBe(mode)
      expect(finished.conditions.source).toBe('agent-declared')
      expect(finished.observedEnvironment).toMatchObject({
        status: 'observed', viewport: { width: 800, height: 600 },
      })
      expect(typeof finished.observedEnvironment.coarsePointer).toBe('boolean')
      expect(typeof finished.observedEnvironment.maxTouchPoints).toBe('number')
      expect(finished.screenshotAvailable).toBe(true)
      expect(JSON.stringify(finished)).not.toContain('__beegame_preview_capability')
      expect(JSON.stringify(finished)).not.toContain('private=value')
      expect(JSON.stringify(finished)).not.toContain('UNRELATED_PAGE')
      expect(await (await fetch(recordingUrl)).json()).toEqual(finished)
      expect(await (await fetch(recordingUrl + '/finish', { method: 'POST' })).json()).toEqual(finished)
      const observationsBeforeReads = observations.length
      for (let i = 0; i < 10; i++) expect(await (await fetch(recordingUrl)).json()).toEqual(finished)
      expect(observations.length).toBe(observationsBeforeReads)
      expect(JSON.parse(await readFile(finished.files.report, 'utf8'))).toEqual(finished)
      expect(await readFile(finished.files.screenshot)).toEqual(Buffer.from(await (await fetch(recordingUrl + '/screenshot')).arrayBuffer()))
      expect(finished.events.filter((event: any) => event.type === 'console.log' && event.detail[0] === 'BGS_FIXTURE')).toHaveLength(1)
      errors.length = 0
    }
    expect(savedReports).toHaveLength(2)
    // Releasing a cache entry leaves its persisted report intact.
    const release = await fetch(access.baseUrl + '/recordings/' + savedReports[0].id, { method: 'DELETE' })
    expect(await release.json()).toEqual({ released: true, archiveDeleted: false })
    expect(JSON.parse(await readFile(savedReports[0].files.report, 'utf8')).id).toBe(savedReports[0].id)
    // Closing access freezes active observations as interrupted, not as a pass.
    const live = await (await fetch(access.baseUrl + '/recordings', { method: 'POST', body: JSON.stringify({
      targetId, label: 'cancelled', conditions: 'stop before completing checks',
    }) })).json() as any
    await access.close()
    await access.close()
    expect(savedReports).toHaveLength(3)
    expect(savedReports[2].id).toBe(live.id)
    expect(savedReports[2].endReason).toBe('session-closed')
    expect(savedReports[2].gameplayVerdict).toBe('not-evaluated')
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv
    ws?.close()
    await access.close()
    manager.dispose(); proxy.stop(true)
    await rm(workspace, { recursive: true, force: true })
  }
}, 60000)
