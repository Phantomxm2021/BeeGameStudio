import { expect, test } from 'bun:test'
import { openPreviewTestAccess } from './preview-test-access'
import { PREVIEW_IFRAME_SANDBOX } from '@bee-game-studio/agent-workflow/preview-environment'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGamePreviewManager } from './preview-manager'

test('preview capability exposes only its owned preview and revokes browser access on close', async () => {
  let started = 0, stopped = 0, browserClosed = 0
  let snapshot = { status: 'idle', url: '' }
  const access = openPreviewTestAccess({
    start: async mode => { started++; snapshot = { status: 'running', url: `http://127.0.0.1:62174/previews/owned/?mode=${mode}&token=test` }; return snapshot },
    status: () => snapshot,
    stop: () => { stopped++ },
    browser: { start: async () => ({ endpoint: 'ws://127.0.0.1:1234/owned' }),
      status: () => ({ status: 'not-running' }), close: async () => { browserClosed++ } },
  })
  try {
    expect((await fetch(access.baseUrl + '/host')).status).toBe(503)
    expect((await fetch(access.baseUrl + '/recordings', { method: 'POST', body: JSON.stringify({
      targetId: 'target', label: 'test', conditions: '', outputRoot: '/outside',
    }) })).status).toBe(400)
    expect((await fetch(access.baseUrl + '/recordings', { method: 'POST', body: JSON.stringify({
      targetId: 'target', label: 'test', conditions: '',
    }) })).status).toBe(409)
    expect((await fetch(access.baseUrl + '/recordings/00000000-0000-0000-0000-000000000000')).status).toBe(404)
    expect((await fetch(access.baseUrl + '/status', { headers: { origin: 'https://evil.test' } })).status).toBe(404)
    expect((await fetch(access.baseUrl + '/preview', { method: 'POST', body: JSON.stringify({ mode: 'production', workspacePath: '/other' }) })).status).toBe(400)
    const response = await fetch(access.baseUrl + '/preview', { method: 'POST', body: JSON.stringify({ mode: 'production' }) })
    const result = await response.json() as any
    expect(result.frameSelector).toBe('#beegame-preview')
    expect(result.environment.origin).toBe('opaque')
    const refreshed = await (await fetch(access.baseUrl + '/status')).json() as any
    expect(refreshed.hostUrl).toBe(result.hostUrl)
    expect(refreshed.environment.sandbox).toBe(PREVIEW_IFRAME_SANDBOX)
    expect(access.instruction).toContain('Read returned URLs from JSON')
    expect(access.instruction).toContain('avoids shell sandbox escape approvals')
    const helper = access.instruction.split('\n').find(line=>line.startsWith('Optional Node helper:'))!
    expect(helper).not.toContain(access.baseUrl)
    expect(helper).not.toContain('apiUrl:')
    expect(helper).toContain('gameFrame')
    expect(helper).toContain('node <test-script.mjs> (not bun)')
    expect(helper).toContain('beforeNavigate')
    const audioScope = access.instruction.split('\n').find(line => line.startsWith('Audio/custom probe scope:'))!
    for (const term of ['OUTER preview wrapper', 'context.addInitScript', 'separate window',
      'gameFrame.evaluate(() => window.__audioEvents ?? null)', 'never page.evaluate',
      'missing probe is unverified', 'do not prove audible output'])
      expect(audioScope).toContain(term)
    const html = await (await fetch(result.hostUrl)).text()
    expect(html).toContain(`sandbox="${PREVIEW_IFRAME_SANDBOX}"`)
    expect(html).not.toContain('allow-same-origin')
    expect(html).toContain('/previews/owned/')
    expect(html).toContain('&amp;token=test')
    const browser = await fetch(access.baseUrl + '/browser', { method: 'POST' })
    expect(browser.status).toBe(200)
    expect((await browser.json() as any).playwrightRuntime).toBe('node')
    expect(started).toBe(1)
  } finally { await access.close() }
  expect(stopped).toBe(1)
  expect(browserClosed).toBe(1)
  await expect(fetch(access.baseUrl + '/status')).rejects.toThrow()
})

test('browser startup failure is not reported as a ready test environment', async () => {
  const access = openPreviewTestAccess({ start: async () => ({ status: 'failed' }), status: () => ({ status: 'idle' }), stop() {},
    browser: { start: async () => { throw new Error('MachPort denied') }, status: () => ({ status: 'not-running' }), close: async () => {} } })
  try {
    const result = await fetch(access.baseUrl + '/browser', { method: 'POST' })
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ error: 'MachPort denied' })
  } finally { await access.close() }
})

test('browser start explicitly reports reuse; restart is a separate owned operation', async () => {
  let endpoint = 'ws://127.0.0.1:1234/first', running = false, restarts = 0
  const access = openPreviewTestAccess({ start: async () => ({ status: 'running' }), status: () => ({ status: 'idle' }), stop() {},
    browser: {
      start: async () => { running = true; return { endpoint } },
      restart: async () => { restarts++; endpoint = 'ws://127.0.0.1:1234/second'; return { endpoint } },
      status: () => ({ status: running ? 'running' : 'not-running', endpoint }), close: async () => {},
    } })
  try {
    const post = async (path: string) => await (await fetch(access.baseUrl + path, { method: 'POST' })).json()
    expect(await post('/browser')).toMatchObject({ reused: false, endpoint })
    expect(await post('/browser')).toMatchObject({ reused: true, endpoint })
    expect(restarts).toBe(0)
    expect(await post('/browser/restart')).toMatchObject({ reused: false, endpoint: 'ws://127.0.0.1:1234/second' })
    expect(restarts).toBe(1)
  } finally { await access.close() }
})

test('preview restart replaces the owned server and loads changed source without building', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'preview-restart-'))
  const manager = new BeeGamePreviewManager()
  const options = { sessionId: 'restart-fixture', workspacePath: workspace, mode: 'production' as const }
  const access = openPreviewTestAccess({
    start: mode => manager.start({ ...options, mode }),
    restart: mode => manager.restart({ ...options, mode }),
    status: () => manager.status(options.sessionId, workspace),
    stop: () => { manager.stop(options.sessionId, workspace) },
  })
  const serverSource = (version: string) =>
    `Bun.serve({hostname:"127.0.0.1",port:Number(process.env.PORT),fetch(){return Response.json({version:${JSON.stringify(version)},pid:process.pid})}})`
  try {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { preview: `${JSON.stringify(process.execPath)} server.ts`, build: 'exit 99' },
    }))
    await writeFile(join(workspace, 'server.ts'), serverSource('before'))
    const post = (path: string) => fetch(access.baseUrl + path, { method: 'POST', body: JSON.stringify({ mode: 'production' }) })
    expect((await post('/preview')).status).toBe(200)
    const readServer = async () => await (await fetch(manager.internalUrl(options.sessionId)!)).json() as { version: string; pid: number }
    const before = await readServer()
    expect(before.version).toBe('before')
    await writeFile(join(workspace, 'server.ts'), serverSource('after'))
    expect((await post('/preview')).status).toBe(200)
    expect(await readServer()).toEqual(before)
    const restarted = await post('/preview/restart')
    expect(restarted.status).toBe(200)
    expect((await restarted.json() as any).preview.mode).toBe('production')
    const after = await readServer()
    expect(after.version).toBe('after')
    expect(after.pid).not.toBe(before.pid)
    expect(() => process.kill(before.pid, 0)).toThrow()
    expect(access.instruction).toContain('POST /preview/restart')
  } finally {
    await access.close()
    manager.dispose()
    await rm(workspace, { recursive: true, force: true })
  }
})

test('preview restart validates scope, shares the startup lock and reports failure', async () => {
  let restarts = 0
  let resolveRestart!: (value: { status: string }) => void
  let entered!: () => void
  const entering = new Promise<void>(resolve => { entered = resolve })
  const access = openPreviewTestAccess({
    start: async () => ({ status: 'running' }),
    restart: () => {
      restarts++
      const pending = new Promise<{ status: string }>(resolve => { resolveRestart = resolve })
      entered()
      return pending
    },
    status: () => ({ status: 'idle' }), stop() {},
  })
  const post = (path: string, body: unknown, headers?: HeadersInit) =>
    fetch(access.baseUrl + path, { method: 'POST', body: JSON.stringify(body), headers })
  try {
    expect((await post('/preview/restart', { mode: 'production' }, { origin: 'https://evil.test' })).status).toBe(404)
    expect((await post('/preview/restart', { mode: 'production', workspacePath: '/other' })).status).toBe(400)
    expect((await post('/preview/restart', { mode: 'invalid' })).status).toBe(400)
    expect(restarts).toBe(0)
    const pending = post('/preview/restart', { mode: 'production' })
    await entering
    expect(restarts).toBe(1)
    expect((await post('/preview', { mode: 'production' })).status).toBe(409)
    expect((await post('/preview/restart', { mode: 'production' })).status).toBe(409)
    resolveRestart({ status: 'failed' })
    expect((await pending).status).toBe(503)
    expect((await post('/preview', { mode: 'production' })).status).toBe(200)
  } finally {
    resolveRestart?.({ status: 'failed' })
    await access.close()
  }
  const unsupported = openPreviewTestAccess({ start: async () => ({ status: 'running' }), status: () => ({ status: 'idle' }), stop() {} })
  try {
    expect((await fetch(unsupported.baseUrl + '/preview/restart', {
      method: 'POST', body: JSON.stringify({ mode: 'production' }),
    })).status).toBe(501)
  } finally { await unsupported.close() }
})
